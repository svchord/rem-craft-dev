/**
 * 构建收尾：产物校验 + 打包。
 *
 * ## 为什么单独一个插件，而且 `enforce: 'post'`
 *
 * 校验必须在**所有产物写完**之后才能做，否则会读到半成品。Vite 的
 * `writeBundle` 按 `enforce` 分三段执行：pre → 普通 → post，
 * 所以 `enforce: 'post'` 保证我们看到的产物目录是完整的。
 *
 * 同一插件内**顺序**做校验和打包：校验失败就不打包，避免发布坏包。
 *
 * ## watch 状态从哪来
 *
 * 三个插件共享同一份 PluginState，由 siyuan() 的 configResolved 用 Vite
 * 归一化后的 resolved.build.watch 填充；这里只读 state.watch，不再读
 * this.meta.watchMode。单独使用 siyuanPost 时（不传 state）会自建状态并
 * 自己挂 configResolved 填充。
 *
 * ## 校验与打包
 *
 *   校验  两个环境都跑：watch 失败只警告，非 watch 失败中断构建。
 *   打包  watch 一定不打包，非 watch 一定打包；产物名固定为 package.zip。
 *         打包失败一律中断构建，不能让 CI 绿着丢掉发布包。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { Plugin } from 'vite';
import type { Target } from '../core/targets.ts';
import { formatIssues, verifyTarget } from '../core/verify.ts';
import type { LogLevel } from '../core/log.ts';
import { applyResolvedConfig, createPluginState } from './state.ts';
import type { PluginState } from './state.ts';
import { messageOf, walkFiles } from './shared.ts';

/**
 * 思源集市的发布产物名。
 *
 * 主题项目、插件项目与思源官方 sample 一致使用 `package.zip`：
 *   主题项目 .releaserc.json 的 assets 指向它
 *   插件项目 vite.config 的 outFileName 是它
 * 主题与插件共用同一个名字，所以固定在这里、不随类型描述符变化，也不作为入参。
 * 外部项目若走自己的发布渠道，可以直接调用 writeZip() 指定任意输出文件名。
 */
export const PACKAGE_NAME = 'package.zip';

/** 收尾插件的选项。 */
export interface PostPluginOptions {
  /** 取被测目标；拿不到就跳过校验。单独使用本插件时可省略。 */
  resolveTarget?: () => Target | null;
  /** 是否校验，缺省 true。 */
  verify?: boolean;
  /** 与 siyuan() 组合时共享同一状态；单独使用时留空，插件自建并自行 configResolved。 */
  state?: PluginState;
  /** 诊断日志；缺省 console.log。 */
  log?: (message: string, level?: LogLevel) => void;
}

const defaultLog = (message: string): void => console.log(`[siyuan-devkit:post] ${message}`);

// ---------------------------------------------------------------------------
// 极简 zip 写入（store / deflate，零运行时依赖）
// ---------------------------------------------------------------------------

/** PKWARE APPNOTE 的签名与固定字段值。 */
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_NEEDED = 20;
const ZIP_VERSION_MADE_BY = 20;
const ZIP_FLAG_UTF8_NAMES = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_INITIAL = 0xffffffff;
const CRC32_FINAL_XOR = 0xffffffff;
const CRC32_TABLE_SIZE = 256;
const CRC32_BITS_PER_BYTE = 8;
const CRC32_BYTE_MASK = 0xff;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const ZIP_MAX_ENTRIES = 0xffff;

/** 各字段在头部里的字节偏移。 */
const OFF = {
  localSignature: 0,
  localVersionNeeded: 4,
  localFlags: 6,
  localMethod: 8,
  localCrc32: 14,
  localCompressedSize: 18,
  localUncompressedSize: 22,
  localNameLength: 26,
  centralSignature: 0,
  centralVersionMadeBy: 4,
  centralVersionNeeded: 6,
  centralFlags: 8,
  centralMethod: 10,
  centralCrc32: 16,
  centralCompressedSize: 20,
  centralUncompressedSize: 24,
  centralNameLength: 28,
  centralLocalHeaderOffset: 42,
  eocdSignature: 0,
  eocdEntryCount: 8,
  eocdTotalEntryCount: 10,
  eocdCentralSize: 12,
  eocdCentralOffset: 16,
};

const CRC_TABLE: ReadonlyArray<number> = (() => {
  const table: number[] = [];
  for (let index = 0; index < CRC32_TABLE_SIZE; index += 1) {
    let value = index;
    for (let bit = 0; bit < CRC32_BITS_PER_BYTE; bit += 1) {
      value = value & 1 ? CRC32_POLYNOMIAL ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
})();

/** 索引恒在 0..255；用显式守卫代替 `as number` / 非空断言。 */
function crcEntry(index: number): number {
  const entry = CRC_TABLE[index];
  if (entry === undefined) throw new RangeError(`CRC32 表索引越界：${index}`);
  return entry;
}

function crc32(buffer: Buffer): number {
  let crc = CRC32_INITIAL;
  for (const byte of buffer) {
    crc = crcEntry((crc ^ byte) & CRC32_BYTE_MASK) ^ (crc >>> CRC32_BITS_PER_BYTE);
  }
  return (crc ^ CRC32_FINAL_XOR) >>> 0;
}

/**
 * 把一个目录下的文件写成一个 zip（store / deflate，零运行时依赖）。
 *
 * **公开导出**：外部项目可以单独用它给任意目录打包或做产物校验；
 * siyuanPost 在非 watch 构建里调用它生成固定的 package.zip。
 *
 * 条目名是相对 dir 的路径（统一 `/` 分隔），UTF-8 文件名标志位固定置位；
 * 不加密、不写目录项、不写数据描述符。压缩后更大就退回 store。
 *
 * 同步实现：writeBundle 之后构建随时可能结束，用异步流有写不完的风险；
 * 思源主题/插件包只有几 MB，同步写完全可接受。
 *
 * @returns 打包的文件数与生成 zip 的字节数。
 * @throws 产物目录超过 65535 个文件、或写盘失败时抛错。
 */
export function writeZip(dir: string, outFile: string): { files: number; bytes: number } {
  const files = walkFiles(dir);
  if (files.length > ZIP_MAX_ENTRIES) {
    throw new Error(`文件数 ${files.length} 超过 zip 格式上限 ${ZIP_MAX_ENTRIES}`);
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.path);
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const deflated = deflateRawSync(data);
    // 压缩后更大就 store，避免负收益。
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;
    const crc = crc32(data);

    const local = Buffer.alloc(LOCAL_HEADER_BYTES);
    local.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, OFF.localSignature);
    local.writeUInt16LE(ZIP_VERSION_NEEDED, OFF.localVersionNeeded);
    local.writeUInt16LE(ZIP_FLAG_UTF8_NAMES, OFF.localFlags);
    local.writeUInt16LE(method, OFF.localMethod);
    local.writeUInt32LE(crc, OFF.localCrc32);
    local.writeUInt32LE(body.length, OFF.localCompressedSize);
    local.writeUInt32LE(data.length, OFF.localUncompressedSize);
    local.writeUInt16LE(nameBuffer.length, OFF.localNameLength);
    locals.push(local, nameBuffer, body);

    const central = Buffer.alloc(CENTRAL_HEADER_BYTES);
    central.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, OFF.centralSignature);
    central.writeUInt16LE(ZIP_VERSION_MADE_BY, OFF.centralVersionMadeBy);
    central.writeUInt16LE(ZIP_VERSION_NEEDED, OFF.centralVersionNeeded);
    central.writeUInt16LE(ZIP_FLAG_UTF8_NAMES, OFF.centralFlags);
    central.writeUInt16LE(method, OFF.centralMethod);
    central.writeUInt32LE(crc, OFF.centralCrc32);
    central.writeUInt32LE(body.length, OFF.centralCompressedSize);
    central.writeUInt32LE(data.length, OFF.centralUncompressedSize);
    central.writeUInt16LE(nameBuffer.length, OFF.centralNameLength);
    central.writeUInt32LE(offset, OFF.centralLocalHeaderOffset);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(EOCD_BYTES);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, OFF.eocdSignature);
  end.writeUInt16LE(files.length, OFF.eocdEntryCount);
  end.writeUInt16LE(files.length, OFF.eocdTotalEntryCount);
  end.writeUInt32LE(centralBuffer.length, OFF.eocdCentralSize);
  end.writeUInt32LE(offset, OFF.eocdCentralOffset);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.concat([...locals, centralBuffer, end]));

  return { files: files.length, bytes: statSync(outFile).size };
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

/** 收尾插件：产物校验 + 打包。可单独 import 使用。 */
export function siyuanPost(options: PostPluginOptions = {}): Plugin {
  const { resolveTarget, verify = true, log = defaultLog } = options;
  const state: PluginState = options.state ?? createPluginState(process.cwd());

  return {
    name: 'siyuan-devkit:post',
    // post 保证在所有产物写完之后跑。
    enforce: 'post',
    apply: 'build',

    // 单独使用时自己填充状态；由 siyuan() 组合时 :dev 也会填同一份，
    // applyResolvedConfig 用 Vite 归一化配置写入，重复调用结果一致。
    configResolved(resolved) {
      applyResolvedConfig(state, resolved);
    },

    writeBundle() {
      const { root, outDir, watch } = state;

      // ---- 1. 校验（两个环境都跑，失败处理不同） ----
      if (verify) {
        const target = resolveTarget?.() ?? null;
        if (!target) {
          log('跳过校验：识别不到被测类型', 'warn');
        } else {
          const result = verifyTarget(target, { root, outDir });
          if (!result.ok) {
            const text = formatIssues(result.issues);
            if (watch) {
              // 开发中中断会让 vite build --watch 退出，得手动重开，代价太大。
              log(`产物校验未通过，开发模式仅提示：\n${text}`, 'warn');
            } else {
              // 生产构建：产物要发布，坏包代价远大于构建失败。
              throw new Error(`产物校验未通过：\n${text}`);
            }
          } else {
            log('产物校验通过', 'success');
          }
        }
      }

      // ---- 2. 打包：watch 一定不打包，非 watch 一定打包 ----
      if (watch) return;

      if (!existsSync(outDir)) {
        throw new Error(`打包失败：产物目录不存在 ${outDir}；请确认 build.outDir 与本次构建一致`);
      }

      const outFile = join(root, PACKAGE_NAME);
      try {
        const result = writeZip(outDir, outFile);
        if (result.files === 0) {
          throw new Error(`产物目录 ${outDir} 里没有文件`);
        }
        log(`已打包：${PACKAGE_NAME}，${result.files} 个文件，${result.bytes} 字节`, 'success');
      } catch (cause) {
        // 生产构建里打包失败必须让构建失败；同时清掉可能写了一半的坏包。
        rmSync(outFile, { force: true });
        throw new Error(`打包失败（${PACKAGE_NAME} 未正确生成）：${messageOf(cause)}`, { cause });
      }
    },
  };
}
