/**
 * Vite 插件形态：把开发会话挂进宿主已有的 Vite 生命周期。
 *
 * 用法（父项目 vite.config.ts）：
 *
 *   import siyuan from 'vite-plugin-siyuan/plugin';
 *
 *   export default defineConfig({
 *     plugins: [siyuan()],   // 类型从 public/ 清单自动推断
 *   });
 *
 * 然后照常 `vite build --watch`。
 *
 * ## 为什么是 `apply: 'build'` 而不是 `'serve'`
 *
 * vite-plugin-electron 挂的是 `apply: 'serve'`，因为 Electron 从 dev server
 * 加载页面，不需要磁盘产物。思源相反：它从磁盘读
 * `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存里编译
 * （实测不产生任何磁盘文件）。插件 JS 更严格——思源用
 * `window.eval("(function anonymous(require, module, exports){…})")` 执行，
 * 需要 CJS 单文件，dev server 给的是 ESM 模块图。
 *
 * 所以本插件只挂 `build`，父项目必须跑 `vite build --watch`。
 *
 * ## 为什么用 writeBundle 而不是 closeBundle
 *
 * `writeBundle(options, bundle)` 直接给出本次产出的文件名，不用自己 watch
 * 目录猜。实测在 `build --watch` 下每次重建都会触发。
 *
 * ## 与 CLI 形态的关系
 *
 * 两者共用 dev-session.ts。差别只在「谁跑构建」：
 *   CLI     dev.ts 自己 spawn vite build --watch
 *   插件    宿主 vite 跑构建，本插件在 writeBundle 里喂变更给会话
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import siyuanAssets from './assets.ts';
import { startDevSession } from '../dev/dev-session.ts';
import type { DevSession } from '../dev/dev-session.ts';
import { createTarget } from '../core/targets.ts';
import { detectTargetType } from '../core/target-types.ts';
import type { BuildContext, TargetBuildSpec } from '../core/target-types.ts';
import type { Frontend } from '../core/siyuan.ts';
// 静态 import：内置类型是在 targets.ts 求值时注册进注册表的。
// 只 import target-types 会拿到空注册表——这个坑踩过一次。
import '../core/targets.ts';

/** 插件名，用于日志前缀。 */
const NAME = 'vite-plugin-siyuan';

/** 插件选项。 */
export interface SiYuanPluginOptions {
  /**
   * 被测类型，显式指定时跳过自动推断。
   *
   *   'theme'   主题项目
   *   'plugin'  插件项目
   *
   * 缺省从 `public/` 下的清单推断（theme.json → theme，plugin.json → plugin）。
   * 显式指定的意义：自动推断靠清单存在与否，同一项目里若有多个清单、
   * 或清单还没创建时不猜。
   */
  target?: string | null;
  /**
   * 同上，旧名。两者等价，`target` 优先。
   * @deprecated 用 `target`
   */
  kind?: string | null;
  /** 显式指定名字；缺省从清单读。 */
  name?: string | null;
  /**
   * 构建入口，相对项目根。两种类型都接受：
   *
   *   主题  entry: 'src/styles/index.css'   → rollupOptions.input
   *   插件  entry: 'src/index.tsx'          → rollupOptions.input + output.format='cjs'
   *
   * 为什么要统一：入口本来就只是「从哪开始构建」，主题是 CSS、插件是 TSX，
   * 差别在产物形态而不在入口概念。产物形态由类型描述符决定（主题产出
   * theme.css、插件产出 index.js CJS 单文件），项目只需要说清楚入口在哪。
   *
   * 不传则保留项目自己写在 `rollupOptions.input` / `build.lib` 里的配置。
   * 注意**不要用 `build.lib`**：lib 隐含 `cssCodeSplit: false`，与 CSS 入口冲突
   * （实测 Vite 报错），而且插件会产出 `index.cjs` 而非 `index.js`。
   */
  entry?: string | null;
  /** 产物目录；缺省取类型描述符的值（通常是 ./dev）。 */
  outDir?: string | null;
  /** 是否建立链接，缺省 true。 */
  link?: boolean;
  /** 浏览器是否无头，缺省 false。 */
  headless?: boolean;
  /** 打开哪个前端，缺省 desktop。 */
  frontend?: Frontend;
  /** 整体开关，便于在生产构建里关掉。 */
  enabled?: boolean;
  /**
   * 是否附带产物资产插件（搬运 README/icon 等 + 监听 public/）。
   *
   * 缺省 true。关掉它意味着你自己处理 `public/` 变更监听——
   * 注意 Vite 不监听 publicDir，改清单不会触发重建。
   */
  assets?: boolean;
  /** 清单路径，缺省按类型取 `public/theme.json` 或 `public/plugin.json`。 */
  manifestPath?: string | null;
}

/**
 * 思源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：一个负责热重载，一个负责产物资产。
 * 将来要加 `:prod` 之类的插件时，不用改调用方的写法。
 */
export default function siyuanDev(options: SiYuanPluginOptions = {}): Plugin[] {
  const {
    target = null,
    kind = null,
    name = null,
    entry = null,
    outDir = null,
    link = true,
    headless = false,
    frontend = 'desktop',
    enabled = true,
    assets = true,
    manifestPath = null,
  } = options;

  /** `target` 是新名，`kind` 是旧名。 */
  const requestedKind = target ?? kind;

  let session: DevSession | null = null;
  let starting: Promise<DevSession> | null = null;
  /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
  let firstBundle = true;
  let root = process.cwd();

  const log = (message: string): void => console.log(`[${NAME}] ${message}`);

  /**
   * 在 `config()` 阶段解析构建配置片段。
   *
   * `config()` 早于 `configResolved`，此时 `root` 还是 process.cwd()——
   * 但 Vite 调用 `config()` 时 cwd 就是项目根，所以够用。
   */
  function resolveBuildSpec(context: BuildContext, entryOption: string | null): TargetBuildSpec | null {
    let resolvedKind = requestedKind;
    if (!resolvedKind) {
      const detected = detectTargetType(context.root);
      if (!detected.ok) {
        // 没有清单就不知道产物该叫什么；交给项目自己配，不在这里报错。
        log(`跳过构建配置注入：${detected.reason}`);
        return null;
      }
      resolvedKind = detected.kind;
    }
    try {
      const target = createTarget(resolvedKind, { cwd: context.root });
      // entry 是相对项目根的路径，解析成绝对路径再交给 rollup。
      const entry = entryOption ? resolve(context.root, entryOption) : null;
      return target.buildSpec(context, { entry });
    } catch {
      return null;
    }
  }

  /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
  async function ensureSession(): Promise<DevSession> {
    if (session) return session;
    if (starting) return starting;

    starting = (async () => {
      let resolvedKind = requestedKind;
      if (!resolvedKind) {
        const detected = detectTargetType(root);
        if (!detected.ok) throw new Error(detected.reason);
        resolvedKind = detected.kind;
        log(`类型：${resolvedKind}（从清单推断；可用 target 显式指定）`);
      } else {
        log(`类型：${resolvedKind}（入参指定）`);
      }

      const created = await startDevSession({
        kind: resolvedKind,
        name,
        cwd: root,
        outDir,
        link,
        headless,
        frontend,
        log,
        // 变更由宿主的 writeBundle 喂进来，不自己 watch 目录。
        watch: false,
      });
      session = created;
      return created;
    })();

    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  return [
    {
      name: `${NAME}:dev`,
      apply: 'build',

      /**
       * 注入构建配置：入口、产物名、模块格式都由思源的加载机制决定。
       *
       * 全部用 `??=` 补缺，**不覆盖用户已写的值**——社区里 electron-vite 与
       * @samrum/vite-plugin-web-extension 都是这个模式（`config.build ??= {}`）。
       * 这样项目想换个产物目录时仍能覆盖，不需要关掉插件。
       *
       * 只注入「思源决定的」部分；minify / sourcemap / target 归项目。
       */
      config(userConfig, env) {
        const watch = Boolean(userConfig.build?.watch);
        const context = { command: env.command, watch, root };
        const spec = resolveBuildSpec(context, entry);
        if (!spec) return undefined;

        const build = (userConfig.build ??= {});
        build.outDir ??= outDir ?? spec.outDir;

        if (spec.emptyOutDir !== undefined) build.emptyOutDir ??= spec.emptyOutDir;

        if (spec.input || spec.rollupOutput || spec.external) {
          const rollupOptions = (build.rollupOptions ??= {});
          if (spec.input) rollupOptions.input ??= spec.input;
          if (spec.external) rollupOptions.external ??= spec.external;

          // output 可能是数组（多入口拆分），那种情况不插手——项目自己在管。
          if (spec.rollupOutput && !Array.isArray(rollupOptions.output)) {
            const output: Record<string, unknown> = (rollupOptions.output ??= {}) as Record<string, unknown>;
            const specOutput = spec.rollupOutput;
            output.format ??= specOutput.format;
            output.entryFileNames ??= specOutput.entryFileNames;
            output.assetFileNames ??= specOutput.assetFileNames;
          }
        }

        // 原地改，不返回：返回对象会被 Vite 当作用户配置合并，语义容易搞混。
        return undefined;
      },

      configResolved(resolved) {
        root = resolved.root;
        // 只在「本该 watch 却没 watch」时提示；生产构建不需要热重载，别制造噪音。
        if (enabled && !resolved.build.watch) {
          log('提示：当前不是 watch 模式，热重载不会生效。开发请用 `vite build --watch`。');
        }
      },

      async writeBundle(_options, bundle) {
        if (!enabled) return;
        const files = Object.keys(bundle);

        // 第一次构建不是「变更」：此时会话可能还没起来，启动它即可，
        // 不要触发一次多余的重载（vite-plugin-electron 用同样的 firstBundle 标志规避）。
        if (firstBundle) {
          firstBundle = false;
          try {
            await ensureSession();
            log('会话就绪，改源码会自动重载');
          } catch (cause) {
            log(`启动失败：${cause instanceof Error ? cause.message : String(cause)}`);
          }
          return;
        }

        try {
          const current = await ensureSession();
          current.notifyChange(files);
        } catch (cause) {
          log(`重载失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      },

      async closeBundle() {
        // watch 模式下每次重建后也会走到这里，不能在这里关会话。
        // 只有非 watch（一次性构建）才清理。
        if (this.meta?.watchMode) return;
        if (session) {
          await session.stop();
          session = null;
        }
      },
    },

    // 产物资产：监听 public/（Vite 不监听 publicDir）+ 搬运清单声明的元数据文件。
    // 默认带上——没有它，改 theme.json 不会触发重建，这让「改清单不生效」很难查。
    ...(assets
      ? [
          siyuanAssets({
            cwd: root,
            manifestPath: manifestPath ?? `public/${requestedKind === 'plugin' ? 'plugin.json' : 'theme.json'}`,
          }),
        ]
      : []),
  ];
}
