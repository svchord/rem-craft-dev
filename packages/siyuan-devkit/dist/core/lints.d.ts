/**
 * 样式表静态检查：不碰浏览器，只读 CSS 文本。
 *
 * 为什么需要静态检查：有些错误在源码里完全看不出来，浏览器又会**静默丢弃**
 * 整条声明——不报错、不警告，只是「样式没生效」。等渲染断言发现「值不对」时，
 * 已经绕了一圈。静态检查能直接指出是哪一行写错了。
 */
/** 一条可疑声明。 */
export interface CssProblem {
    /** 涉及的令牌，如 `--b3-theme-on-surface`。 */
    token: string;
    /** 原始片段。 */
    snippet: string;
}
/** 带来源的问题。 */
export interface SourcedCssProblem extends CssProblem {
    /** 来自哪份样式表。 */
    sheet: string;
}
/** 一份样式表。 */
export interface Sheet {
    label: string;
    text: string;
}
/**
 * 统计 CSS 自身的「可疑声明」：值里出现 rgb(var(--b3-... 这类双重包装。
 *
 * 实测它真的发生过：l2-bridge 把 --b3-* 桥成完整色值（`rgb(95 99 104)`），
 * l3 又包了一层 rgb()，得到 `rgb(rgb(...))` —— 非法值，整条声明被丢弃，
 * 导致 .b3-menu__item 的 color 与分隔线的 border-top 实际都没生效。
 *
 * 注意 `rgb(var(--rc-*))` 是**正确**的：--rc-* 存的是 "R G B" 三通道，
 * 必须由 rgb() 组装。所以这里只查 --b3-*。
 */
export declare function findDoubleWrappedColors(css: string): CssProblem[];
/**
 * 从多份样式表里汇总可疑声明，按来源标注。
 * 插件动辄 50 万字符的 CSS，不标来源就不知道去改哪个文件。
 */
export declare function findProblemsIn(sheets: Sheet[]): SourcedCssProblem[];
//# sourceMappingURL=lints.d.ts.map