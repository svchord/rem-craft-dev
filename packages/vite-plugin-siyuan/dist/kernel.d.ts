/**
 * 思源 kernel / 页面侧的通用能力。
 *
 * 这里只放「与被测类型无关」的原语：调 kernel API、换主题 link、重注入某段 CSS、
 * 让思源重新加载某个插件。至于「什么情况下该用哪个」，由各类型的描述符决定
 * （见 targets.ts），本文件不做类型判断。
 *
 * 主题走 `<link id="themeStyle">`，插件走 `window.eval` + `<style id="pluginsStyle…">`，
 * 两者的重载机制根本不同，所以各自的重载入参也不同——这里只是提供积木。
 */
import type { Page } from 'puppeteer-core';
/** kernel API 的统一响应形状。 */
export interface KernelResponse<T = unknown> {
    code: number;
    msg?: string;
    data: T | null;
}
/**
 * 调 kernel API。开了 API token 时从环境变量 SIYUAN_TOKEN 读。
 *
 * @param port kernel 端口
 * @param path 接口路径，如 '/api/system/getConf'
 * @param body 请求体（POST）
 */
export declare function callKernel<T = unknown>(port: number, path: string, body?: unknown): Promise<KernelResponse<T>>;
/** 切换主题的结果。 */
export interface SelectThemeResult {
    ok: boolean;
    /** 是否真的做了切换（本来就是这个主题时为 false）。 */
    changed: boolean;
    reason: string | null;
}
/**
 * 让思源选中指定主题（明暗都设成它）。
 *
 * 已经是它时不做任何事——避免每次启动都触发一次无谓的重载。
 */
export declare function selectTheme(port: number, themeName: string): Promise<SelectThemeResult>;
/**
 * 让页面重新加载主题 CSS。
 *
 * 换 `#themeStyle` 的 href 并加时间戳：只动主题那一个 link，不碰其它样式表，
 * 级联位置不变。这是思源重载主题的等价操作。
 *
 * 返回是否成功（页面里没有 themeStyle 时返回 false）。
 */
export declare function reloadThemeCss(page: Page, { styleId, stamp }?: {
    styleId?: string;
    stamp?: number;
}): Promise<boolean>;
/** 当前主题（明/暗）。 */
export interface CurrentTheme {
    light: string | undefined;
    dark: string | undefined;
    mode: number | undefined;
}
/**
 * 读当前思源选中的主题（明/暗）。
 * 用于「切换前备份、结束后还原」这类场景。
 */
export declare function currentTheme(port: number): Promise<CurrentTheme | null>;
/**
 * 让页面重新加载某个插件的 CSS（不重新执行 JS）。
 *
 * 插件 CSS 是内联在 `<style id="pluginsStyle<name>">` 里的（实测磁盘 index.css
 * 与 textContent 逐字节相同），所以换 textContent 就能让新样式立即生效，
 * 不用整页刷新、也不会丢掉用户正在编辑的文档和打开的面板。
 *
 * 只适用于 CSS 变化。插件 JS 是 `window.eval` 执行的、带副作用（注册 dock、
 * 顶栏、事件监听），换 style 撤销不了，那种情况要用 `reloadPlugin`。
 */
export declare function reloadPluginCss(page: Page | null, pluginName: string, cssText?: string | null): Promise<boolean>;
/** 插件重载结果。 */
export interface ReloadPluginResult {
    ok: boolean;
    reason: string | null;
}
/**
 * 让思源重新加载某个插件（重新执行它的 JS）。
 *
 * 插件 JS 是 `window.eval("(function anonymous(require, module, exports){…})")`
 * 执行的，带副作用；换 `<style>` 内容不会重跑 JS，必须让思源走完整的
 * unload → 重新拉产物 → eval → onload。
 *
 * 触发方式是 `/api/petal/setPetalEnabled` 禁用再启用：内核写配置后通过
 * WebSocket 推送 `reloadPlugin`，前端据此重建实例与 `<style>` 节点。
 * 实测确认 styleNodeReplaced / instanceReplaced 都为 true。
 * `/api/plugin/*` 没有写接口（实测 404），这条路是思源官方 sample 用的。
 *
 * 请求体（内核 apicontract.SetPetalEnabledRequest）：
 *   packageName  string   必填，插件名
 *   enabled      bool     必填
 *   app          string   可选，前端实例 ID（SIYUAN_APPID）
 *
 * `app` 是每个前端窗口启动时随机生成的标识（Math.random().toString(36)），
 * 外部无法预先知道；不传则由内核广播到所有前端。所以这里默认不传——
 * 传一个猜的值只会被忽略，反而让人以为定向生效了。
 *
 * 这比整页刷新好：不打断用户正在编辑的文档、不重置面板状态。
 */
export declare function reloadPlugin(port: number, pluginName: string, { app, gapMs }?: {
    app?: string | null;
    gapMs?: number;
}): Promise<ReloadPluginResult>;
//# sourceMappingURL=kernel.d.ts.map