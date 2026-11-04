/**
 * 交互驱动：把页面从「初始状态」推到「要审计的状态」，然后就地测量。
 *
 * 为什么必须有这一层：
 *   只量初始页面只能回答「静态级联算出来是什么」，它永远测不到：
 *     - :hover / :focus / :active 等伪类（需要真实指针）
 *     - 菜单项（菜单打开前 DOM 里根本没有，实测 0 个）
 *     - 插件面板（激活前不存在）
 *     - 点击后的展开/选中态
 *   这些是主题和插件真正容易坏的地方——思源升级后 CSS 选择器还在，但 DOM 结构
 *   变了，静态断言照样绿，实际交互已经烂了。
 *
 * 设计：动作是可组合的小字符串，场景因此能直接写在命令行参数里：
 *   click:<selector>     真实点击
 *   hover:<selector>     真实指针悬停（唯一能驱动 :hover 的方式）
 *   move:<x>,<y>         指针移动
 *   press:<selector>     按下（配合 :active）
 *   focus:<selector>     聚焦
 *   type:<selector>:<text>  输入
 *   wait:<ms>            等过渡/异步
 *   menu:<id>            用思源菜单 API 打开菜单
 *   contextmenu:<selector>  真实右键（JS 派发不触发思源菜单）
 *   dock:<type>          点击停靠栏按钮（file/outline/graph/...）
 *   attr:<name>=<value>  设 <html> 属性（暗色/密度变体）
 *   reset                还原 <html> 属性到会话初始快照
 *
 * 每个动作后都等一小段，让过渡与异步渲染落定。
 */
import type { Page } from 'puppeteer-core';
/** 动作动词 → 说明，报错时列出来，避免拼错动词静默跳过。 */
export declare const ACTIONS: {
    readonly click: 'click:<selector>';
    readonly hover: 'hover:<selector>';
    readonly move: 'move:<x>,<y>';
    readonly press: 'press:<selector>';
    readonly focus: 'focus:<selector>';
    readonly type: 'type:<selector>:<text>';
    readonly wait: 'wait:<ms>';
    readonly menu: 'menu:<id>';
    readonly contextmenu: 'contextmenu:<selector>';
    readonly dock: 'dock:<type>';
    readonly attr: 'attr:<name>=<value>';
    readonly reset: 'reset';
};
/** 动作动词。 */
export type ActionVerb = keyof typeof ACTIONS;
/** 执行动作用的会话形状（只需要 page）。 */
export interface ActionSession {
    page: Page;
    /** 会话初始的 <html> 属性快照；不给则现取一次。 */
    rootSnapshot?: Record<string, string>;
}
/** <html> 的属性快照，供 reset 还原。 */
export declare function snapshotRoot(page: Page): Promise<Record<string, string>>;
/**
 * 执行一串动作。返回执行日志（用于报告里说明「测的是哪个状态」）。
 *
 * 任何一步失败都抛错：静默跳过一个没找到的选择器，会让后面的断言在错误
 * 状态下运行，得到「通过」的假结论。
 */
export declare function runActions(session: ActionSession, actions?: string[]): Promise<string[]>;
//# sourceMappingURL=actions.d.ts.map