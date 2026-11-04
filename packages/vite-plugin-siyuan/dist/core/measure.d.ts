/**
 * 通用测量原语：只提供能力，不预设「该查什么」。
 *
 * 设计原则（这是本工具的核心约定）：
 *
 *   工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算对。
 *   它只负责「把页面上的事实读出来」，查什么、怎么判断，由调用方在命令行上
 *   或脚本里组合这些原语决定。
 *
 * 为什么这样设计：之前把「查哪几对颜色、查哪几个组件」写死在工具里，
 * 等于替使用者决定审计范围——新增组件不会自动覆盖，改设计还要改工具。
 * 通用原语让 agent 按当前任务临时组合，不需要改代码。
 */
import type { Page } from 'puppeteer-core';
import type { EnvironmentSnapshot } from './probes.ts';
/** 元素计算样式读数。 */
export interface ElementStyleReading {
    found: boolean;
    count: number;
    visible: number;
    tag?: string;
    className?: string;
    styles: Record<string, string>;
}
/** 页面元素计算样式：任意选择器 × 任意属性。 */
export declare function elementStyles(page: Page, selector: string, props: string[]): Promise<ElementStyleReading>;
/** 单个选择器的命中数。 */
export interface SelectorCount {
    total: number;
    visible: number;
    error?: string;
}
/** 选择器命中数（含可见数）。 */
export declare function selectorCounts(page: Page, selectors: string[]): Promise<Record<string, SelectorCount>>;
/** 一组令牌的计算值。 */
export declare function tokens(page: Page, names: string[]): Promise<Record<string, string>>;
/** 探针 HTML 的读数。 */
export interface ProbeHtmlReading {
    found: boolean;
    styles: Record<string, string>;
}
/**
 * 在页面上插一段 HTML 再量——用于量页面上不存在的组件。
 *
 * 与直接量真实元素的区别：探针元素只带你给的类名，能验证「这个选择器本身
 * 算出来是什么」，不受当前 UI 状态影响。
 */
export declare function probeHtml(page: Page, { html, target, props }: {
    html: string;
    target: string;
    props: string[];
}): Promise<ProbeHtmlReading>;
/** 一个元素的盒模型。 */
export interface ElementBox {
    index: number;
    tag: string;
    className: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * 元素盒模型尺寸（触摸目标、间距判断用）。
 * 只给宽高与位置，不给「够不够大」的判断。
 */
export declare function elementBox(page: Page, selector: string, limit?: number): Promise<ElementBox[]>;
/** 动作前后的样式差异。 */
export interface DiffResult {
    found: boolean;
    before: Record<string, string> | null;
    after: Record<string, string> | null;
    changed: Record<string, {
        from: string;
        to: string;
    }>;
}
/**
 * 同一元素在「动作前 / 动作后」的样式对比。
 *
 * 只返回差异，不判断「该不该变」——变不变是否符合预期由调用方决定。
 */
export declare function diffAfter(page: Page, { selector, props, run }: {
    selector: string;
    props: string[];
    run: (page: Page) => Promise<unknown>;
}): Promise<DiffResult>;
/** 页面环境快照（含 URL 与视口）。 */
export interface PageEnvironment {
    frontend: string | null;
    backend: string | null;
    themeMode: string | null;
    density: string | null;
    themeStyle: string | null;
    url: string;
    domNodes: number;
    viewport: {
        width: number;
        height: number;
        dpr: number;
    };
}
/** 页面环境快照。 */
export declare function environment(page: Page): Promise<PageEnvironment>;
export type { EnvironmentSnapshot };
//# sourceMappingURL=measure.d.ts.map