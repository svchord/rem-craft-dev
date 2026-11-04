/**
 * 探针：只读事实，返回纯数据，不打印、不改页面。
 *
 * 测量策略——一律在真实页面上量：
 *
 *   曾经用 iframe 隔离，理由是要挡住宿主主题的覆盖。但让思源真正选中本主题之后，
 *   宿主主题根本不参与级联——隔离的前提消失了。而 iframe 只注入被测 CSS，
 *   会漏掉思源 `base.css` 与运行时样式：实测 `line-height` 在 iframe 里是
 *   `normal`、真实页面是 `28px`。
 *
 *   所以探针插进主文档（`position:fixed` 放到视口外），拿到的是与生产完全一致的
 *   级联：base.css + 本主题 + 插件样式 + 运行时样式。
 */
import type { Page } from 'puppeteer-core';
/** 一个探针用例。 */
export interface ProbeSpec {
    label: string;
    /** 要插入的 HTML；不给我表示量页面上既有元素。 */
    html?: string;
    /** 探针 html 里的选择器。 */
    target: string;
    /** 要读的样式属性。 */
    props: string[];
}
/** probeLive 的输入。 */
export interface ProbeLiveSpec {
    tokens: string[];
    selectors: string[];
    /** 选择器命中数是否只数可见的。 */
    requireVisible?: boolean;
    probes: ProbeSpec[];
}
/** 单个探针的读数。 */
export interface ProbeReading {
    label: string;
    found: boolean;
    styles: Record<string, string>;
    count?: number;
    reason?: string;
}
/** probeLive 的输出。 */
export interface ProbeLiveResult {
    tokens: Record<string, string>;
    hits: Record<string, number>;
    probes: ProbeReading[];
}
/**
 * 读取令牌的计算值。
 *
 * 计算样式里的自定义属性**已经展开 var() 链**，未定义的令牌返回空串，
 * 因此一个 getPropertyValue 就够：既能判断「定义了没有」，也能看到最终值。
 * 注意 L0 刻度存的是 "R G B" 三通道（`0 82 217`），不是颜色值，
 * 直接当 color 用会失效——所以这里只取原文，不做任何颜色求值。
 */
export declare function probeTokens(page: Page, names: string[]): Promise<Record<string, string>>;
/**
 * 在真实页面上量一组读数。
 *
 * 探针元素插进主文档、放到视口外（`left:-99999px`），因此：
 *   - 拿到完整级联（base.css + 主题 + 插件 + 运行时样式），与生产一致
 *   - 不影响页面外观
 *   - 测完立即移除
 *
 * `requireVisible` 默认 false：探针本身在视口外，按可见性过滤会全部被排除。
 * 只有量页面上既有元素（live 用例）时才开 true——菜单关闭时元素仍在 DOM 但不可见，
 * 读到的是继承值，会让断言假通过。
 */
export declare function probeLive(page: Page, spec: ProbeLiveSpec): Promise<ProbeLiveResult>;
/** 环境快照。 */
export interface EnvironmentSnapshot {
    frontend: string | null;
    backend: string | null;
    themeMode: string | null;
    density: string | null;
    themeStyle: string | null;
    domNodes: number;
    /** attached 表示复用 dev 浏览器，launched 表示新开的。 */
    opened: 'attached' | 'launched';
}
/**
 * 页面环境快照：确认打开的是桌面还是移动端、被测对象挂没挂上。
 *
 * 移动端和桌面端是两个独立构建入口，量错地方结论就没有意义。
 */
export declare function probeEnvironment(page: Page, session: {
    attached: boolean;
}): Promise<EnvironmentSnapshot>;
//# sourceMappingURL=probes.d.ts.map