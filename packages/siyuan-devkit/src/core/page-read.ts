/**
 * 浏览器侧读数的唯一实现。
 *
 * puppeteer 会把传给 `page.evaluate` 的函数**序列化**后在浏览器里执行，函数体不能
 * 引用 Node 侧的模块作用域变量。因此 isVisible / centerOf / 探针注入这些 helper
 * 只能有一份——就是本文件 `browserRead` 函数体里的那一份；measure.ts /
 * actions.ts / probes.ts 都只负责组装 spec 并取回结果。
 *
 * 之前 measure.ts 的 elementStyles/selectorCounts 用 rect + computedStyle 判可见，
 * elementBox 和 probes.ts 却用 offsetParent（position:fixed 的思源菜单恒为 null），
 * 同一选择器在不同原语里「可见数」对不上。现在统一成一份实现。
 */
import type { Page } from 'puppeteer-core';

/** 视口外宿主容器的样式：插进主文档才吃得到 base.css 与运行时样式。 */
export const OFFSCREEN_HOST_STYLE = 'position:fixed;left:-99999px;top:0;width:1200px;';
/** className 截断长度，避免把思源生成的长类名整段塞进报告。 */
export const CLASS_NAME_MAX = 120;
/** 盒模型默认取前几个元素。 */
export const DEFAULT_BOX_LIMIT = 5;

/** 元素计算样式读数。 */
export interface ElementStyleReading {
  found: boolean;
  count: number;
  visible: number;
  tag?: string;
  className?: string;
  styles: Record<string, string>;
}

/** 单个选择器的命中数。 */
export interface SelectorCount {
  total: number;
  visible: number;
  error?: string;
}

/** 探针 HTML 的读数。 */
export interface ProbeHtmlReading {
  found: boolean;
  styles: Record<string, string>;
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

/** 元素中心点（真实指针动作需要）。 */
export interface ElementPoint {
  x: number;
  y: number;
}

interface BrowserConsts {
  offscreenHostStyle: string;
  classNameMax: number;
}

/** 通过 evaluate 的参数传进浏览器，避免函数体引用 Node 模块作用域。 */
const BROWSER_CONSTS: BrowserConsts = {
  offscreenHostStyle: OFFSCREEN_HOST_STYLE,
  classNameMax: CLASS_NAME_MAX,
};

export type ReadSpec =
  | { kind: 'styles'; selector: string; props: string[] }
  | { kind: 'counts'; selectors: string[] }
  | { kind: 'boxes'; selector: string; limit: number }
  | { kind: 'probe'; html: string; target: string; props: string[] }
  | { kind: 'environment' }
  | { kind: 'styleOf'; selector: string; props: string[] }
  | { kind: 'point'; selector: string };

type ReadResult =
  | { kind: 'styles'; value: ElementStyleReading }
  | { kind: 'counts'; value: Record<string, SelectorCount> }
  | { kind: 'boxes'; value: ElementBox[] }
  | { kind: 'probe'; value: ProbeHtmlReading }
  | { kind: 'environment'; value: PageEnvironment }
  | { kind: 'styleOf'; value: Record<string, string> | null }
  | { kind: 'point'; value: ElementPoint | null };

/**
 * 这个函数整体跑在浏览器里：不引用任何 Node 模块作用域变量。
 * 所有 helper 只在这里定义一次；spec.kind 决定读什么。
 */
function browserRead(spec: ReadSpec, consts: BrowserConsts): ReadResult {
  // 不能用 offsetParent 判可见：position:fixed 的元素 offsetParent 恒为 null，
  // 思源的菜单就是这种（实测 .b3-menu 完全可见但 offsetParent=null）。
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  };

  const readStyles = (el: Element, props: string[]): Record<string, string> => {
    const style = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const prop of props) out[prop] = style.getPropertyValue(prop);
    return out;
  };

  const classNameOf = (el: Element): string => (el.getAttribute('class') ?? '').slice(0, consts.classNameMax);

  const centerOf = (el: Element): ElementPoint => {
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const injectProbe = (html: string, target: string, props: string[]): ProbeHtmlReading => {
    const host = document.createElement('div');
    host.setAttribute('style', consts.offscreenHostStyle);
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      const element = host.querySelector(target);
      if (!element) return { found: false, styles: {} };
      return { found: true, styles: readStyles(element, props) };
    } finally {
      host.remove();
    }
  };

  switch (spec.kind) {
    case 'styles': {
      const elements = [...document.querySelectorAll(spec.selector)];
      const shown = elements.filter(isVisible);
      const target = shown[0] ?? elements[0];
      if (!target) {
        return { kind: 'styles', value: { found: false, count: 0, visible: 0, styles: {} } };
      }
      return {
        kind: 'styles',
        value: {
          found: true,
          count: elements.length,
          visible: shown.length,
          tag: target.tagName.toLowerCase(),
          className: classNameOf(target),
          styles: readStyles(target, spec.props),
        },
      };
    }
    case 'counts': {
      const counts: Record<string, SelectorCount> = {};
      for (const sel of spec.selectors) {
        try {
          const elements = [...document.querySelectorAll(sel)];
          counts[sel] = { total: elements.length, visible: elements.filter(isVisible).length };
        } catch {
          counts[sel] = { total: -1, visible: -1, error: '非法选择器' };
        }
      }
      return { kind: 'counts', value: counts };
    }
    case 'boxes': {
      const round = (n: number): number => Math.round(n * 10) / 10;
      const elements = [...document.querySelectorAll(spec.selector)].filter(isVisible).slice(0, spec.limit);
      return {
        kind: 'boxes',
        value: elements.map((el, index) => {
          const box = el.getBoundingClientRect();
          return {
            index,
            tag: el.tagName.toLowerCase(),
            className: classNameOf(el),
            x: round(box.x),
            y: round(box.y),
            width: round(box.width),
            height: round(box.height),
          };
        }),
      };
    }
    case 'probe':
      return { kind: 'probe', value: injectProbe(spec.html, spec.target, spec.props) };
    case 'environment': {
      const root = document.documentElement;
      return {
        kind: 'environment',
        value: {
          frontend: root.getAttribute('data-frontend'),
          backend: root.getAttribute('data-backend'),
          themeMode: root.getAttribute('data-theme-mode'),
          density: root.getAttribute('data-ui-density'),
          themeStyle: document.getElementById('themeStyle')?.getAttribute('href') ?? null,
          url: location.href,
          domNodes: document.querySelectorAll('*').length,
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        },
      };
    }
    case 'styleOf': {
      const el = document.querySelector(spec.selector);
      return { kind: 'styleOf', value: el ? readStyles(el, spec.props) : null };
    }
    case 'point': {
      const elements = [...document.querySelectorAll(spec.selector)];
      const target = elements.find(isVisible) ?? elements[0];
      return { kind: 'point', value: target ? centerOf(target) : null };
    }
  }
}

async function evaluateRead(page: Page, spec: ReadSpec): Promise<ReadResult> {
  return page.evaluate(browserRead, spec, BROWSER_CONSTS);
}

/** 每个包装器都做一次判别校验：puppeteer 序列化后无法静态关联 spec.kind 与返回值。 */
function mismatched(kind: string, result: ReadResult): Error {
  return new Error(`页面读数与请求不符：期望 ${kind}，得到 ${result.kind}`);
}

export async function readStyles(page: Page, selector: string, props: string[]): Promise<ElementStyleReading> {
  const result = await evaluateRead(page, { kind: 'styles', selector, props });
  if (result.kind !== 'styles') throw mismatched('styles', result);
  return result.value;
}

export async function readCounts(page: Page, selectors: string[]): Promise<Record<string, SelectorCount>> {
  const result = await evaluateRead(page, { kind: 'counts', selectors });
  if (result.kind !== 'counts') throw mismatched('counts', result);
  return result.value;
}

export async function readBoxes(page: Page, selector: string, limit: number): Promise<ElementBox[]> {
  const result = await evaluateRead(page, { kind: 'boxes', selector, limit });
  if (result.kind !== 'boxes') throw mismatched('boxes', result);
  return result.value;
}

export async function readProbe(page: Page, html: string, target: string, props: string[]): Promise<ProbeHtmlReading> {
  const result = await evaluateRead(page, { kind: 'probe', html, target, props });
  if (result.kind !== 'probe') throw mismatched('probe', result);
  return result.value;
}

export async function readEnvironment(page: Page): Promise<PageEnvironment> {
  const result = await evaluateRead(page, { kind: 'environment' });
  if (result.kind !== 'environment') throw mismatched('environment', result);
  return result.value;
}

/** 单个元素的计算样式；diffAfter 用它读 before/after。 */
export async function readStyleOf(
  page: Page,
  selector: string,
  props: string[]
): Promise<Record<string, string> | null> {
  const result = await evaluateRead(page, { kind: 'styleOf', selector, props });
  if (result.kind !== 'styleOf') throw mismatched('styleOf', result);
  return result.value;
}

/** 第一个可见元素的中心点；hover/press/contextmenu 共用。 */
export async function readPoint(page: Page, selector: string): Promise<ElementPoint | null> {
  const result = await evaluateRead(page, { kind: 'point', selector });
  if (result.kind !== 'point') throw mismatched('point', result);
  return result.value;
}
