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
import { probeTokens } from './probes.ts';
import type { EnvironmentSnapshot } from './probes.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
export async function elementStyles(page: Page, selector: string, props: string[]): Promise<ElementStyleReading> {
  return page.evaluate(
    (sel: string, propertyList: string[]) => {
      // 不能用 offsetParent：position:fixed 的元素 offsetParent 恒为 null，
      // 思源的菜单就是这种（实测 .b3-menu offsetParent=null，但 236×649 完全可见）。
      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
      };
      const elements = [...document.querySelectorAll(sel)];
      const shown = elements.filter(visible);
      const target = shown[0] ?? elements[0];
      if (!target) return { found: false, count: 0, visible: 0, styles: {} };

      const style = getComputedStyle(target);
      const styles: Record<string, string> = {};
      for (const prop of propertyList) styles[prop] = style.getPropertyValue(prop);
      return {
        found: true,
        count: elements.length,
        visible: shown.length,
        tag: target.tagName.toLowerCase(),
        className: String((target as HTMLElement).className || '').slice(0, 120),
        styles,
      };
    },
    selector,
    props
  );
}

/** 单个选择器的命中数。 */
export interface SelectorCount {
  total: number;
  visible: number;
  error?: string;
}

/** 选择器命中数（含可见数）。 */
export async function selectorCounts(page: Page, selectors: string[]): Promise<Record<string, SelectorCount>> {
  return page.evaluate((list: string[]) => {
    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
    };
    return Object.fromEntries(
      list.map((sel) => {
        try {
          const elements = [...document.querySelectorAll(sel)];
          return [sel, { total: elements.length, visible: elements.filter(visible).length }];
        } catch {
          return [sel, { total: -1, visible: -1, error: '非法选择器' }];
        }
      })
    );
  }, selectors);
}

/** 一组令牌的计算值。 */
export async function tokens(page: Page, names: string[]): Promise<Record<string, string>> {
  return probeTokens(page, names);
}

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
export async function probeHtml(
  page: Page,
  { html, target, props }: { html: string; target: string; props: string[] }
): Promise<ProbeHtmlReading> {
  return page.evaluate(
    (markup: string, selector: string, propertyList: string[]) => {
      const host = document.createElement('div');
      host.setAttribute('style', 'position:fixed;left:-99999px;top:0;width:1200px;');
      host.innerHTML = markup;
      document.body.appendChild(host);
      try {
        const element = host.querySelector(selector);
        if (!element) return { found: false, styles: {} };
        const style = getComputedStyle(element);
        const styles: Record<string, string> = {};
        for (const prop of propertyList) styles[prop] = style.getPropertyValue(prop);
        return { found: true, styles };
      } finally {
        host.remove();
      }
    },
    html,
    target,
    props
  );
}

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
export async function elementBox(page: Page, selector: string, limit = 5): Promise<ElementBox[]> {
  return page.evaluate(
    (sel: string, max: number) => {
      const visible = (el: Element): boolean =>
        (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0;
      const elements = [...document.querySelectorAll(sel)].filter(visible).slice(0, max);
      return elements.map((el, index) => {
        const box = el.getBoundingClientRect();
        return {
          index,
          tag: el.tagName.toLowerCase(),
          className: String((el as HTMLElement).className || '').slice(0, 80),
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      });
    },
    selector,
    limit
  );
}

/** 动作前后的样式差异。 */
export interface DiffResult {
  found: boolean;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
  changed: Record<string, { from: string; to: string }>;
}

/**
 * 同一元素在「动作前 / 动作后」的样式对比。
 *
 * 只返回差异，不判断「该不该变」——变不变是否符合预期由调用方决定。
 */
export async function diffAfter(
  page: Page,
  { selector, props, run }: { selector: string; props: string[]; run: (page: Page) => Promise<unknown> }
): Promise<DiffResult> {
  const read = (): Promise<Record<string, string> | null> =>
    page.evaluate(
      (sel: string, propertyList: string[]) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const style = getComputedStyle(el);
        return Object.fromEntries(propertyList.map((prop) => [prop, style.getPropertyValue(prop)]));
      },
      selector,
      props
    );

  // 先移开指针：位置在会话间持续，否则 before 可能已经是 hover 态。
  await page.mouse.move(1, 1);
  await sleep(250);

  const before = await read();
  if (!before) return { found: false, before: null, after: null, changed: {} };

  await run(page);
  await sleep(350);

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
export interface PageEnvironment {
  frontend: string | null;
  backend: string | null;
  themeMode: string | null;
  density: string | null;
  themeStyle: string | null;
  url: string;
  domNodes: number;
  viewport: { width: number; height: number; dpr: number };
}

/** 页面环境快照。 */
export async function environment(page: Page): Promise<PageEnvironment> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      frontend: root.getAttribute('data-frontend'),
      backend: root.getAttribute('data-backend'),
      themeMode: root.getAttribute('data-theme-mode'),
      density: root.getAttribute('data-ui-density'),
      themeStyle: document.getElementById('themeStyle')?.getAttribute('href') ?? null,
      url: location.href,
      domNodes: document.querySelectorAll('*').length,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    };
  });
}

export type { EnvironmentSnapshot };
