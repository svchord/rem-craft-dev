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
import type { Frontend } from './siyuan.ts';
import './targets.ts';
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
export default function siyuanDev(options?: SiYuanPluginOptions): Plugin[];
//# sourceMappingURL=plugin.d.ts.map