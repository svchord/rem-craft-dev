/**
 * 通用测量原语：只提供能力，不预设「该查什么」。
 *
 * 工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算对；
 * 它只把页面上的事实读出来，查什么、怎么判断由调用方组合这些原语决定。
 *
 * 浏览器侧读数（可见性判定、探针注入、样式/盒模型/环境）统一在 page-read.ts；
 * 本文件只组装 spec、编排动作前后差异，不再自己写 page.evaluate。
 */
import type { Page } from 'puppeteer-core';
import { probeTokens } from './probes.ts';
import {
  DEFAULT_BOX_LIMIT,
  readBoxes,
  readCounts,
  readEnvironment,
  readProbe,
  readStyles,
  readStyleOf,
} from './page-read.ts';
import { sleep, TIMING } from './timing.ts';
import type { ElementBox, ElementStyleReading, PageEnvironment, ProbeHtmlReading, SelectorCount } from './page-read.ts';

// 类型仍从 measure.ts 对外导出（index.ts 与 CLI 都从这里 import）。
export type { ElementBox, ElementStyleReading, PageEnvironment, ProbeHtmlReading, SelectorCount } from './page-read.ts';

/** diff 前把指针停到页面角落，让 :hover 态退掉（位置在会话间会保留）。 */
const PARKED_POINTER = { x: 1, y: 1 } as const;

/** 页面元素计算样式：任意选择器 × 任意属性。 */
export function elementStyles(page: Page, selector: string, props: string[]): Promise<ElementStyleReading> {
  return readStyles(page, selector, props);
}

/** 选择器命中数（含可见数）。 */
export function selectorCounts(page: Page, selectors: string[]): Promise<Record<string, SelectorCount>> {
  return readCounts(page, selectors);
}

/** 一组令牌的计算值。probeTokens 是唯一实现，这里保留公开的短名字。 */
export function tokens(page: Page, names: string[]): Promise<Record<string, string>> {
  return probeTokens(page, names);
}

/** 在页面上插一段 HTML 再量——用于量页面上不存在的组件。 */
export function probeHtml(
  page: Page,
  { html, target, props }: { html: string; target: string; props: string[] }
): Promise<ProbeHtmlReading> {
  return readProbe(page, html, target, props);
}

/** 元素盒模型尺寸（触摸目标、间距判断用）；只给宽高与位置，不给判断。 */
export function elementBox(page: Page, selector: string, limit = DEFAULT_BOX_LIMIT): Promise<ElementBox[]> {
  return readBoxes(page, selector, limit);
}

/** 动作前后的样式差异。 */
export interface DiffResult {
  found: boolean;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
  changed: Record<string, { from: string; to: string }>;
}

/** 同一元素在「动作前 / 动作后」的样式对比；只返回差异，不判断该不该变。 */
export async function diffAfter(
  page: Page,
  { selector, props, run }: { selector: string; props: string[]; run: (page: Page) => Promise<unknown> }
): Promise<DiffResult> {
  const read = (): Promise<Record<string, string> | null> => readStyleOf(page, selector, props);

  await page.mouse.move(PARKED_POINTER.x, PARKED_POINTER.y);
  await sleep(TIMING.diffBeforeSettle);

  const before = await read();
  if (!before) return { found: false, before: null, after: null, changed: {} };

  await run(page);
  await sleep(TIMING.diffAfterSettle);

  const after = await read();
  if (!after) return { found: false, before, after: null, changed: {} };

  const changed: Record<string, { from: string; to: string }> = {};
  for (const prop of Object.keys(after)) {
    const from = before[prop] ?? '';
    const to = after[prop];
    if (to !== undefined && from !== to) changed[prop] = { from, to };
  }
  return { found: true, before, after, changed };
}

/** 页面环境快照（含 URL 与视口）。 */
export function environment(page: Page): Promise<PageEnvironment> {
  return readEnvironment(page);
}
