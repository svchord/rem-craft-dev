/**
 * 构建收尾：产物校验 + 打包。
 *
 * ## 为什么单独一个插件，而且 `enforce: 'post'`
 *
 * 校验必须在**所有产物写完**之后才能做，否则会读到半成品。实测 Vite 的
 * `writeBundle` 按 `enforce` 分三段执行：
 *
 *   pre → 普通 → post        （实测输出：pre-d → plain-a → plain-c → post-b → post-e）
 *
 * 所以 `enforce: 'post'` 保证我们看到的产物目录是完整的。
 *
 * 同一插件内**顺序**做校验和打包：校验失败就不打包，避免发布坏包。
 *
 * ## 为什么不传 dev 开关
 *
 * 用 `this.meta.watchMode`——Vite 自己提供的真实状态。-w 短参数、
 * config 里写 `watch:{}` 都会被归一化进去，项目不用另传参数。
 *
 * ## 两个环境都校验，失败处理不同
 *
 *   开发（watch）  失败只警告——中断会让 `vite build --watch` 退出，得手动重开
 *   生产（构建）   失败中断——产物要发布，坏包代价远大于构建失败
 *
 * 打包只在生产做（开发时打 zip 没意义）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { Plugin } from 'vite';
import type { Target } from '../core/targets.ts';
import { formatIssues, verifyTarget } from '../core/verify.ts';

/**
 * 思源集市的发布产物名。
 *
 * 两个项目以及官方 sample 一致使用 `package.zip`：
 *   主题项目 .releaserc.json 的 assets 指向它
 *   插件项目 vite.config 的 outFileName 是它
 * 所以这是思源生态的约定，不是项目自己的偏好——不该由入参指定。
 *
 * 放在这里而不是描述符里：主题和插件用的是同一个名字，
 * 没有必要让每个描述符重复声明。将来自定义类型如果不同，再提升为能力。
 */
export const PACKAGE_NAME = 'package.zip';

/** 收尾插件的选项。 */
export interface PostPluginOptions {
  /** 取被测目标；拿不到就跳过校验。 */
  resolveTarget: () => Target | null;
  /** 项目根目录。 */
  cwd: string;
  /** 产物目录（绝对路径）。 */
  outDir: string;
  /** 是否校验。 */
  verify: boolean;
  /** 是否打包（名字固定为 package.zip）。 */
  pack: boolean;
  /** 日志函数。 */
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// 极简 zip 写入（store / deflate，零依赖）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 递归收集目录下的文件（保留相对路径）。 */
function collectFiles(dir: string, base = ''): Array<{ name: string; path: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full, rel) : [{ name: rel, path: full }];
  });
}

/**
 * 写一个 zip 文件。
 *
 * 同步实现：`writeBundle` 之后构建随时可能结束，用异步流有写不完的风险。
 * 思源主题/插件包只有几 MB，同步写完全可接受。
 */
export function writeZip(dir: string, outFile: string): { files: number; bytes: number } {
  const files = collectFiles(dir);
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
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.concat([...locals, centralBuffer, end]));

  return { files: files.length, bytes: statSync(outFile).size };
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

/**
 * 收尾插件：产物校验 + 打包。
 */
export function siyuanPost(options: PostPluginOptions): Plugin {
  const { resolveTarget, cwd, outDir, verify, pack, log } = options;

  return {
    name: 'vite-plugin-siyuan:post',
    // post 保证在所有产物写完之后跑。
    enforce: 'post',
    apply: 'build',

    writeBundle() {
      // Vite 自己提供的真实状态：-w / --watch / config 里的 watch 都已归一化。
      const isWatch = Boolean(this.meta?.watchMode);

      // ---- 1. 校验 ----
      if (verify) {
        const target = resolveTarget();
        if (!target) {
          log('跳过校验：识别不到被测类型');
        } else {
          const result = verifyTarget(target, { root: cwd, outDir });
          if (!result.ok) {
            const text = formatIssues(result.issues);
            if (isWatch) {
              // 开发中中断会让 vite build --watch 退出，得手动重开，代价太大。
              log(`产物校验未通过（开发模式，仅警告）：\n${text}`);
            } else {
              // 生产构建：产物要发布，坏包代价远大于构建失败。
              throw new Error(`产物校验未通过：\n${text}`);
            }
          } else {
            log('产物校验通过');
          }
        }
      }

      // ---- 2. 打包（只在不 watch 时；校验抛错时不会走到这里） ----
      if (pack && !isWatch) {
        if (!existsSync(outDir)) {
          log(`跳过打包：目录不存在 ${outDir}`);
          return;
        }
        try {
          const outFile = join(cwd, PACKAGE_NAME);
          const result = writeZip(outDir, outFile);
          log(`已打包：${PACKAGE_NAME}（${result.files} 个文件，${result.bytes} 字节）`);
        } catch (cause) {
          log(`打包失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    },
  };
}
