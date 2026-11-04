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
import type { Plugin } from 'vite';
import { startDevSession } from './dev-session.ts';
import type { DevSession } from './dev-session.ts';
import { detectTargetType } from './target-types.ts';
import type { Frontend } from './siyuan.ts';
// 静态 import：内置类型是在 targets.ts 求值时注册进注册表的。
// 只 import target-types 会拿到空注册表——这个坑踩过一次。
import './targets.ts';

/** 插件名，用于日志前缀。 */
const NAME = 'vite-plugin-siyuan';

/** 插件选项。 */
export interface SiYuanPluginOptions {
  /** 被测类型；缺省从 public/ 清单推断。 */
  kind?: string | null;
  /** 显式指定名字；缺省从清单读。 */
  name?: string | null;
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
}

/**
 * 智源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：将来要加 `:prod` 之类的插件时，
 * 不用改调用方的写法。
 */
export default function siyuanDev(options: SiYuanPluginOptions = {}): Plugin[] {
  const {
    kind = null,
    name = null,
    outDir = null,
    link = true,
    headless = false,
    frontend = 'desktop',
    enabled = true,
  } = options;

  let session: DevSession | null = null;
  let starting: Promise<DevSession> | null = null;
  /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
  let firstBundle = true;
  let root = process.cwd();

  const log = (message: string): void => console.log(`[${NAME}] ${message}`);

  /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
  async function ensureSession(): Promise<DevSession> {
    if (session) return session;
    if (starting) return starting;

    starting = (async () => {
      let resolvedKind = kind;
      if (!resolvedKind) {
        const detected = detectTargetType(root);
        if (!detected.ok) throw new Error(detected.reason);
        resolvedKind = detected.kind;
        log(`类型：${resolvedKind}（从清单推断）`);
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

      configResolved(resolved) {
        root = resolved.root;
        if (!resolved.build.watch) {
          log('警告：没有开启 watch，热重载不会生效。父项目请用 `vite build --watch`。');
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
  ];
}
