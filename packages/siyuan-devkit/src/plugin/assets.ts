/**
 * 思源产物契约：让 `public/` 的改动也触发重建，并搬运清单声明的元数据文件。
 *
 * ## 为什么必须有这一层
 *
 * Vite 的 `publicDir` 只在**启动时**把 `public/` 复制进产物，之后不再监听它。
 * 现象：`vite build --watch` 下改 `public/theme.json`，构建次数不变，
 * `dev/theme.json` 仍是旧内容。而思源的清单恰恰在 `public/` 里——
 * 改个 `theme.json` 的 `frontends` 或版本号，不重启就永远不生效。
 *
 * 所以需要 `addWatchFile()` 把 `public/**` 显式加进 rollup 的监听集合。
 *
 * ## 为什么还要搬 README
 *
 * 思源清单的 `readme` 字段指向包内文件。这些文件属于仓库元数据（GitHub 首页
 * 也用它们），留在仓库根更合适，但产物里必须有一份。`LICENSE` 通常不需要。
 *
 * 这一层把「哪些文件进产物」收敛成一个函数，主题/插件各自的清单字段差异
 * 由 manifestFiles() 处理。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { applyResolvedConfig, createPluginState } from './state.ts';
import type { PluginState } from './state.ts';
import { isRecord, messageOf, walkFiles } from './shared.ts';
import type { WalkedFile } from './shared.ts';

/** 诊断日志函数；单独使用资产插件时可省略。 */
export type AssetLog = (message: string) => void;

const defaultLog: AssetLog = (message) => console.log(`[siyuan-devkit:assets] ${message}`);

/** 资产插件的选项。 */
export interface AssetsPluginOptions {
  /** 项目根目录，缺省当前工作目录；与 siyuan() 组合时以 Vite 解析出的 root 为准。 */
  cwd?: string;
  /**
   * 清单文件相对项目根的路径。也可传函数，在 Vite 解析出 root 之后惰性求值
   * （注册新类型时由描述符的 manifestName() 取，不硬编码 theme.json）。
   */
  manifestPath: string | ((root: string) => string);
  /**
   * 要搬运进产物的额外文件规则，缺省从清单推导；传了就**整体替换**推导结果
   * （被跳过的清单声明会打日志，不会静默丢文件）。
   * 每条是 `{ src: glob, dest: 相对产物根 }`。
   *
   * `src` 只支持文件名里的 `*`（等价「本段路径内任意字符」），可带目录前缀，
   * 例如 `README*.md`、`docs/*.md`、`docs/i18n/*.json`。不支持 `**`、`?`、
   * 绝对路径或 `..`；`dest` 同样只能是产物根内的相对路径。
   * 带目录前缀时，源文件的目录结构会保留到产物里（除非另给 dest）。
   */
  extraFiles?: Array<{ src: string; dest?: string }> | null;
  /** 是否监听 `public/`，缺省 true。 */
  watchPublic?: boolean;
  /** 与 siyuan() 组合时共享同一状态；单独使用时留空，插件自建并自行 configResolved。 */
  state?: PluginState;
  /** 诊断日志；缺省 console.log。 */
  log?: AssetLog;
}

/** 归一化后的搬运规则。 */
interface CopyRule {
  src: string;
  /** 相对项目根的源目录前缀，空串表示项目根一级。 */
  srcDir: string;
  /** 在源目录内匹配文件名的模式。 */
  pattern: string;
  /** 相对产物根的目标前缀。 */
  dest: string;
  /** 是否来自清单声明（用于兜底/静默场景的诊断措辞）。 */
  fromManifest: boolean;
}

/** 从清单的 readme / icon / preview 收集要搬的文件名。读失败都给诊断，不静默。 */
function manifestFiles(manifestPath: string, log: AssetLog): string[] {
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (cause) {
    log(`读不到清单 ${manifestPath}：${messageOf(cause)}；元数据按 README*.md 兜底`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    log(`清单 ${manifestPath} 不是合法 JSON：${messageOf(cause)}；元数据按 README*.md 兜底`);
    return [];
  }
  if (!isRecord(parsed)) {
    log(`清单 ${manifestPath} 顶层不是对象；元数据按 README*.md 兜底`);
    return [];
  }

  const files = new Set<string>();

  // readme 可能是字符串，也可能是 { default, 'zh-CN', ... } 的 i18n 对象。
  const readme: unknown = parsed.readme;
  if (typeof readme === 'string') files.add(readme);
  else if (isRecord(readme)) {
    for (const value of Object.values(readme)) {
      if (typeof value === 'string') files.add(value);
    }
  }

  // icon / preview 是包内必需资源，清单里写了名字就确保它进产物。
  for (const key of ['icon', 'preview']) {
    const value: unknown = parsed[key];
    if (typeof value === 'string') files.add(value);
  }

  return [...files];
}

/**
 * 极简文件名通配：只支持 `*`，等价「本段路径内任意字符」`[^/]*`。
 *
 * 明确的能力边界（包要保持零运行时依赖，不引 glob 库）：
 *   - 不支持 `**`（跨目录）、`?`、字符集、取反；
 *   - 不匹配路径分隔符，所以不会意外命中子目录；
 *   - 目录前缀由 normalizeRule 拆出，这里只看文件名/相对名。
 * 不符合的规则会在 normalizeRule 里被**明确报出来并跳过**，不会静默失效。
 */
function matchGlob(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(name);
}

/** 校验并拆解一条规则；不合法时打日志并返回 null，绝不静默忽略。 */
function normalizeRule(rule: { src: string; dest?: string }, fromManifest: boolean, log: AssetLog): CopyRule | null {
  const src = rule.src.replace(/\\/g, '/');
  const dest = (rule.dest ?? '').replace(/\\/g, '/');

  const escapes = (value: string): boolean =>
    isAbsolute(value) || value.split('/').includes('..') || value.startsWith('..');
  if (escapes(src) || escapes(dest)) {
    log(`跳过资产规则 ${rule.src}：src/dest 必须是项目根、产物根内的相对路径，不能是绝对路径或含 ..`);
    return null;
  }
  if (src.includes('**') || src.includes('?')) {
    log(`跳过资产规则 ${rule.src}：只支持文件名里的 *，不支持 ** / ?（可写成 docs/*.md 这样的目录前缀）`);
    return null;
  }

  const slash = src.lastIndexOf('/');
  const srcDir = slash >= 0 ? src.slice(0, slash) : '';
  const pattern = slash >= 0 ? src.slice(slash + 1) : src;
  return { src, srcDir, pattern, dest, fromManifest };
}

/**
 * 清单声明的文件若其实位于 `public/` 下，Vite 的 publicDir 会自动把它复制到
 * 产物根，devkit 不必再搬、也不该报「没匹配到」。这里判断 public/ 下是否有匹配。
 */
function publicHasMatch(publicDir: string | null, rule: CopyRule): boolean {
  if (!publicDir || !existsSync(publicDir)) return false;
  const base = rule.srcDir ? join(publicDir, rule.srcDir) : publicDir;
  try {
    const names = rule.srcDir
      ? walkFiles(base).map((file) => file.name)
      : readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
    return names.some((name) => matchGlob(name, rule.pattern));
  } catch {
    return false;
  }
}

/**
 * 思源产物资产插件。
 *
 * 两个职责：把 `public/**` 加进监听（否则改了不重建），
 * 把清单声明的元数据文件搬进产物。可单独 import 使用。
 */
export function siyuanAssets(options: AssetsPluginOptions): Plugin {
  const { cwd = process.cwd(), manifestPath, extraFiles = null, watchPublic = true, log = defaultLog } = options;
  const state: PluginState = options.state ?? createPluginState(resolve(cwd));

  const resolveManifest = (root: string): string =>
    typeof manifestPath === 'function' ? manifestPath(root) : manifestPath;

  return {
    name: 'siyuan-devkit:assets',
    apply: 'build',

    // 单独使用时自己填充状态；由 siyuan() 组合时 :dev 也会填同一份，
    // applyResolvedConfig 用 Vite 归一化配置写入，重复调用结果一致。
    configResolved(resolved) {
      applyResolvedConfig(state, resolved);
    },

    /**
     * Vite 不会为 publicDir 建立监听，必须手动 addWatchFile。
     * 放在 buildStart：watch 模式下每次重建前都会重新收集，新建文件也能纳入。
     */
    buildStart() {
      if (!watchPublic) return;
      const publicDir = state.publicDir;
      if (!publicDir) {
        log('publicDir 未配置，跳过监听');
        return;
      }
      if (!existsSync(publicDir)) {
        log(`publicDir 不存在，跳过监听：${publicDir}`);
        return;
      }
      for (const file of walkFiles(publicDir)) {
        this.addWatchFile(file.path);
      }
    },

    /** 把清单声明的元数据文件复制进产物目录。 */
    writeBundle(bundleOptions) {
      // state.outDir 已经 resolve(root, build.outDir) 成绝对路径；
      // bundleOptions.dir 若给出也一起 resolve，避免把相对路径当 cwd 相对路径写错地方。
      const rawOutDir = bundleOptions.dir ?? state.outDir;
      if (!rawOutDir) {
        log('跳过元数据搬运：拿不到产物目录');
        return;
      }
      const outDir = resolve(state.root, rawOutDir);

      // 清单在 configResolved 之后才按真实 root 解析，不再在工厂调用时固化 cwd。
      const manifestAbs = resolve(state.root, resolveManifest(state.root));
      const declared = manifestFiles(manifestAbs, log);
      let ruleSpecs: Array<{ src: string; dest?: string; fromManifest: boolean }>;
      if (extraFiles) {
        ruleSpecs = extraFiles.map((rule) => ({ ...rule, fromManifest: false }));
        // extraFiles 整体替换清单推导出的规则；把被跳过的声明列出来，避免静默丢文件。
        if (declared.length) {
          log(`传了 extraFiles，清单声明的这些文件不再自动搬运：${declared.join('、')}`);
        }
      } else if (declared.length) {
        ruleSpecs = declared.map((src) => ({ src, fromManifest: true }));
      } else {
        log(`清单 ${manifestAbs} 没声明 readme/icon/preview，按 README*.md 兜底搬运`);
        ruleSpecs = [{ src: 'README*.md', fromManifest: false }];
      }

      const rules = ruleSpecs
        .map((spec) => normalizeRule(spec, spec.fromManifest, log))
        .filter((rule): rule is CopyRule => rule !== null);

      mkdirSync(outDir, { recursive: true });
      for (const rule of rules) {
        const srcRoot = rule.srcDir ? join(state.root, rule.srcDir) : state.root;
        let candidates: WalkedFile[];
        try {
          // 根一级规则只列根一级文件，避免递归遍历整个仓库（含 node_modules）。
          // 带目录前缀的规则才递归该子目录，并保留其子路径。
          candidates = rule.srcDir
            ? walkFiles(srcRoot)
            : readdirSync(srcRoot, { withFileTypes: true })
                .filter((entry) => entry.isFile())
                .map((entry) => ({ name: entry.name, path: join(srcRoot, entry.name) }));
        } catch (cause) {
          log(`资产规则 ${rule.src} 读不到源目录 ${srcRoot}：${messageOf(cause)}`);
          continue;
        }

        let matched = 0;
        for (const file of candidates) {
          if (!matchGlob(file.name, rule.pattern)) continue;
          matched += 1;
          const relative = rule.srcDir ? `${rule.srcDir}/${file.name}` : file.name;
          const destination = join(outDir, rule.dest, relative);
          try {
            // dest 允许带子目录，必须先建父目录；否则 copyFileSync 会 ENOENT。
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(file.path, destination);
          } catch (cause) {
            log(`资产复制失败 ${relative} → ${destination}：${messageOf(cause)}`);
          }
        }
        if (matched === 0) {
          // 清单声明的 icon/preview 常在 public/ 下：Vite 会自动复制，devkit 不必再搬，
          // 也不该报「没匹配到」吓人。只有项目根和 public/ 都没有时才提示。
          if (rule.fromManifest && publicHasMatch(state.publicDir, rule)) continue;
          log(`资产规则 ${rule.src} 没匹配到文件（源目录 ${srcRoot}）`);
        }
      }
    },
  };
}

export default siyuanAssets;
