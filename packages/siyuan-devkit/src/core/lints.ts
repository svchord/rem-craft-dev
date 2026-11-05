/**
 * 样式表静态检查：不碰浏览器，只读 CSS 文本。
 *
 * 有些错误在源码里完全看不出来，浏览器又会**静默丢弃**整条声明；静态检查能
 * 直接指出是哪一行写错了，不必等渲染断言绕一圈。
 */
import type { CssSheet } from './target-types.ts';

/** 一份样式表。与 target-types.ts 的 CssSheet 是同一份形状，保留名字兼容既有导入。 */
export type Sheet = CssSheet;

/**
 * 去掉 CSS 注释：静态检查只看规则，注释里常写着「base.css 未使用 @layer」
 * 这类说明，直接 includes 会误报（watch 产物不压缩，实测踩过）。
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

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

/**
 * 统计 CSS 自身的「可疑声明」：值里出现 rgb(var(--b3-... 这类双重包装。
 *
 * 实测它真的发生过：l2-bridge 把 --b3-* 桥成完整色值，l3 又包一层 rgb()，
 * 得到非法值 `rgb(rgb(...))`，整条声明被丢弃。`rgb(var(--rc-*))` 是**正确**的
 * （--rc-* 存的是 "R G B" 三通道），所以这里只查 --b3-*。
 */
export function findDoubleWrappedColors(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  const pattern = /rgb\(\s*var\(\s*(--b3-[\w-]+)\s*\)\s*\)/g;
  const text = stripCssComments(css);
  for (const match of text.matchAll(pattern)) {
    const token = match[1];
    if (token !== undefined) problems.push({ token, snippet: match[0] ?? '' });
  }
  return problems;
}

/** 从多份样式表里汇总可疑声明，按来源标注（插件 CSS 动辄 50 万字符）。 */
export function findProblemsIn(sheets: Sheet[]): SourcedCssProblem[] {
  return sheets.flatMap((sheet) =>
    findDoubleWrappedColors(sheet.text).map((problem) => ({ ...problem, sheet: sheet.label }))
  );
}
