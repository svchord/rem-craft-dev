/**
 * 审计计划：一次会话里跑完多项测量。
 *
 * ## 为什么需要
 *
 * 单个 `measure <子命令>` 每次都要起进程、加载 puppeteer、连 CDP、等页面。
 * 实测一次真实审计（令牌 + 样式 + 命中数 + 盒模型 + 对比度）要 **6.18 秒、5 次调用**，
 * 其中每次约 1.1 秒是固定的进程与连接开销。对 agent 尤其糟：既是时间，也是上下文。
 *
 * 计划把「要查什么」一次说清，工具用**一个会话**跑完。
 *
 * ## 形状（对齐 pa11y 的 config 约定）
 *
 * 配置文件是普通 JSON（或 JS，走 require）。默认找 `./.siyuan-audit.json`，
 * 用 `--config <path>` 覆盖。优先级：**命令行参数 > 配置文件 > 默认值**。
 *
 * ```json
 * {
 *   "frontend": "desktop",
 *   "viewport": "1600x1000@1",
 *   "target": { "kind": "theme", "name": "Rem Craft Dev" },
 *   "setup": ["dock:file"],
 *   "actions": ["hover:.b3-menu__item"],
 *   "tokens": ["--rc-radius-base", "--rc-brand-8"],
 *   "styles": [{ "selector": ".b3-menu__item", "props": ["color", "background-color"] }],
 *   "counts": [".dock__item", ".b3-menu__item"],
 *   "boxes": [".dock__item"],
 *   "probes": [{ "html": "<div class='x'></div>", "target": ".x", "props": ["color"] }],
 *   "contrast": [["--rc-text-primary", "--rc-bg-page"]],
 *   "diffs": [{ "selector": ".b3-menu__item", "props": ["background-color"], "do": ["hover:.b3-menu__item"] }]
 * }
 * ```
 *
 * 只提供能力：计划里查什么完全由调用方决定，工具不预设任何断言。
 */
import type { Page } from 'puppeteer-core';
import { runActions, snapshotRoot } from './actions.ts';
import type { ActionSession } from './actions.ts';
import { contrastRatio } from './color.ts';
import { diffAfter, elementBox, elementStyles, environment, probeHtml, selectorCounts, tokens } from './measure.ts';
import type {
  DiffResult,
  ElementBox,
  ElementStyleReading,
  PageEnvironment,
  ProbeHtmlReading,
  SelectorCount,
} from './measure.ts';
import { probeTokens } from './probes.ts';

/** 一条样式读取。 */
export interface StyleQuery {
  selector: string;
  props?: string[];
}

/** 一条探针。 */
export interface ProbeQuery {
  html: string;
  target: string;
  props?: string[];
}

/** 一条交互前后对比。 */
export interface DiffQuery {
  selector: string;
  props?: string[];
  /** 相对基线要做的动作。 */
  do: string[];
}

/** 审计计划。 */
export interface AuditPlan {
  /** 打开哪个前端，缺省 desktop。 */
  frontend?: string;
  /** 视口，`宽x高[@DPR]`。 */
  viewport?: string;
  /** 被测目标；缺省按当前目录推断。 */
  target?: { kind?: string; name?: string; css?: string; plugin?: string } | null;
  /** 是否复用正在跑的 dev 浏览器，缺省 false。 */
  attach?: boolean;
  /** 场景准备动作，在全部测量前执行（先 reset）。 */
  setup?: string[];
  /** 测量前要执行的动作。 */
  actions?: string[];
  /** 令牌名。 */
  tokens?: string[];
  /** 元素样式。 */
  styles?: Array<string | StyleQuery>;
  /** 选择器命中数。 */
  counts?: string[];
  /** 盒模型。 */
  boxes?: Array<string | { selector: string; limit?: number }>;
  /** 探针 HTML。 */
  probes?: ProbeQuery[];
  /** 对比度对：`[前景, 背景]`，每项是令牌名或颜色值。 */
  contrast?: Array<[string, string]>;
  /** 交互前后差异。 */
  diffs?: DiffQuery[];
  /** 要读的默认属性（style/diff/probe 没指定 props 时用）。 */
  props?: string[];
}

/** 计划执行结果。每一项都可能缺省，取决于计划里要了什么。 */
export interface AuditResult {
  environment?: PageEnvironment;
  mount?: { ok: boolean; loaded: string | null; reason: string | null };
  actions?: string[];
  tokens?: Record<string, string>;
  styles?: ElementStyleReading[];
  counts?: Record<string, SelectorCount>;
  boxes?: Record<string, ElementBox[]>;
  probes?: ProbeHtmlReading[];
  contrast?: Array<{ foreground: string | undefined; background: string | undefined; ratio: number | null }>;
  diffs?: DiffResult[];
}

/** 默认要读的 CSS 属性。与单子命令保持一致。 */
export const DEFAULT_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-radius',
  'font-size',
  'font-weight',
  'line-height',
  'padding-top',
  'padding-left',
  'margin-top',
  'min-width',
  'min-height',
  'max-width',
  'display',
  'gap',
  'position',
  'z-index',
  'overflow',
  'opacity',
];

/** 计划的名字字段允许是字符串或 `{ selector }`。 */
const selectorOf = (entry: string | { selector: string }): string =>
  typeof entry === 'string' ? entry : entry.selector;

/**
 * 校验计划形状，把明显的错误提前说清楚。
 *
 * 计划是给人/agent 写的 JSON，写错了在浏览器里才发现会很浪费
 * （每次都要起会话）。所以这里在开浏览器**之前**就校验完。
 */
export function validatePlan(plan: unknown): { ok: true; plan: AuditPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['计划必须是一个对象'] };
  }
  const value = plan as Record<string, unknown>;

  const arrayOf = (key: string): unknown[] => {
    const field = value[key];
    if (field === undefined || field === null) return [];
    if (!Array.isArray(field)) {
      errors.push(`${key} 必须是数组`);
      return [];
    }
    return field;
  };

  arrayOf('tokens').forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`tokens[${index}] 必须是字符串`);
  });
  arrayOf('counts').forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`counts[${index}] 必须是字符串`);
  });
  arrayOf('setup').forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`setup[${index}] 必须是字符串动作`);
  });
  arrayOf('actions').forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`actions[${index}] 必须是字符串动作`);
  });

  arrayOf('styles').forEach((item, index) => {
    if (typeof item === 'string') return;
    if (!item || typeof item !== 'object') {
      errors.push(`styles[${index}] 必须是选择器字符串或 { selector, props }`);
      return;
    }
    const query = item as Record<string, unknown>;
    if (typeof query.selector !== 'string') errors.push(`styles[${index}].selector 必须是字符串`);
    if (query.props !== undefined && !Array.isArray(query.props)) {
      errors.push(`styles[${index}].props 必须是数组`);
    }
  });

  arrayOf('contrast').forEach((item, index) => {
    if (!Array.isArray(item) || item.length !== 2 || !item.every((part) => typeof part === 'string')) {
      errors.push(`contrast[${index}] 必须是 [前景, 背景] 两个字符串`);
    }
  });

  arrayOf('diffs').forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`diffs[${index}] 必须是 { selector, do }`);
      return;
    }
    const query = item as Record<string, unknown>;
    if (typeof query.selector !== 'string') errors.push(`diffs[${index}].selector 必须是字符串`);
    if (!Array.isArray(query.do) || !query.do.length) errors.push(`diffs[${index}].do 必须是非空动作数组`);
  });

  arrayOf('probes').forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`probes[${index}] 必须是 { html, target }`);
      return;
    }
    const query = item as Record<string, unknown>;
    if (typeof query.html !== 'string') errors.push(`probes[${index}].html 必须是字符串`);
    if (typeof query.target !== 'string') errors.push(`probes[${index}].target 必须是字符串`);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: value as AuditPlan };
}

/**
 * 在一个已打开的页面上执行计划。
 *
 * 顺序是有意的：先 setup（建立场景），再 actions，最后逐项测量。
 * 这样「交互后的状态」和「静态值」会出现在同一份结果里，方便对照。
 */
export async function runPlan(
  page: Page,
  plan: AuditPlan,
  options: { defaultProps?: string[] } = {}
): Promise<AuditResult> {
  const props = options.defaultProps ?? plan.props ?? DEFAULT_PROPS;
  const result: AuditResult = {};

  result.environment = await environment(page);

  // 动作：先 reset 到干净状态，再跑 setup，最后跑 actions。
  const setup = plan.setup ?? [];
  const actions = plan.actions ?? [];
  if (setup.length || actions.length) {
    const rootSnapshot = await snapshotRoot(page);
    const session: ActionSession = { page, rootSnapshot };
    result.actions = await runActions(session, ['reset', ...setup, ...actions]);
  }

  if (plan.tokens?.length) {
    result.tokens = await tokens(page, plan.tokens);
  }

  if (plan.styles?.length) {
    result.styles = [];
    for (const entry of plan.styles) {
      const selector = selectorOf(entry);
      const entryProps = typeof entry === 'string' ? props : (entry.props ?? props);
      result.styles.push(await elementStyles(page, selector, entryProps));
    }
  }

  if (plan.counts?.length) {
    result.counts = await selectorCounts(page, plan.counts);
  }

  if (plan.boxes?.length) {
    result.boxes = {};
    for (const entry of plan.boxes) {
      const selector = selectorOf(entry);
      const limit = typeof entry === 'string' ? 5 : (entry.limit ?? 5);
      result.boxes[selector] = await elementBox(page, selector, limit);
    }
  }

  if (plan.probes?.length) {
    result.probes = [];
    for (const probe of plan.probes) {
      result.probes.push(
        await probeHtml(page, { html: probe.html, target: probe.target, props: probe.props ?? props })
      );
    }
  }

  if (plan.contrast?.length) {
    // 令牌名以 -- 开头时先解析成计算值；否则当作颜色值直接用。
    const resolveColor = async (input: string): Promise<string | undefined> => {
      if (!input.startsWith('--')) return input;
      const values = await probeTokens(page, [input]);
      return values[input];
    };
    result.contrast = [];
    for (const [foreground, background] of plan.contrast) {
      const fg = await resolveColor(foreground);
      const bg = await resolveColor(background);
      result.contrast.push({ foreground: fg, background: bg, ratio: contrastRatio(fg, bg) });
    }
  }

  if (plan.diffs?.length) {
    result.diffs = [];
    for (const query of plan.diffs) {
      const rootSnapshot = await snapshotRoot(page);
      // 每个 diff 先用同一个 setup 建立基线场景，再执行它自己的动作。
      if (setup.length) {
        await runActions({ page, rootSnapshot }, ['reset', ...setup]);
      }
      result.diffs.push(
        await diffAfter(page, {
          selector: query.selector,
          props: query.props ?? props,
          run: async (target) => runActions({ page: target, rootSnapshot }, query.do),
        })
      );
    }
  }

  return result;
}

/** 计划里是否真的要做点什么（空计划不该白起一个浏览器）。 */
export function planIsEmpty(plan: AuditPlan): boolean {
  const fields: Array<keyof AuditPlan> = ['tokens', 'styles', 'counts', 'boxes', 'probes', 'contrast', 'diffs'];
  return !fields.some((field) => {
    const value = plan[field];
    return Array.isArray(value) && value.length > 0;
  });
}
