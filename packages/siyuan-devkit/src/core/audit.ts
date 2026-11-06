/**
 * 审计计划：一次会话里跑完多项测量。
 *
 * 单个 `measure <子命令>` 每次都要起进程、加载 puppeteer、连 CDP、等页面。
 * 实测一次真实审计（令牌 + 样式 + 命中数 + 盒模型 + 对比度）要 6.18 秒、5 次调用，
 * 其中每次约 1.1 秒是固定的进程与连接开销。计划把「要查什么」一次说清，
 * 工具用**一个会话**跑完。
 *
 * 配置文件是普通 JSON（或 JS/TS 模块，走动态 import）。默认找 `./.siyuan-audit.json`，
 * 用 `--config <path>` 覆盖。优先级：命令行参数 > 配置文件 > 默认值。
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
import { DEFAULT_BOX_LIMIT } from './page-read.ts';
import { isRecord, isString } from './guards.ts';

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

/**
 * 默认要读的 CSS 属性。**单一来源**：CLI 的单子命令也 import 它，
 * 之前 audit.ts 与 measure-cli.ts 各存一份逐字相同的 20 项清单，会静默漂移。
 */
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
 * 计划是给人/agent 写的 JSON，写错了在浏览器里才发现会很浪费（每次都要起
 * 会话）。这里在开浏览器**之前**逐字段构造一个 AuditPlan：用类型守卫，而不是
 * 校验完再把 unknown 断言成 AuditPlan——那样返回值的形状根本没有保证。
 */
export function validatePlan(plan: unknown): { ok: true; plan: AuditPlan } | { ok: false; errors: string[] } {
  if (!isRecord(plan)) return { ok: false, errors: ['计划必须是一个对象'] };
  const errors: string[] = [];
  const result: AuditPlan = {};

  const arrayOf = (key: string): unknown[] | null => {
    const field = plan[key];
    if (field === undefined || field === null) return [];
    if (!Array.isArray(field)) {
      errors.push(`${key} 必须是数组`);
      return null;
    }
    return field;
  };

  /** 可选的 props 数组；非法时记错误并返回 null。 */
  const optionalProps = (value: unknown, label: string): string[] | null => {
    if (value === undefined) return null;
    if (!Array.isArray(value)) {
      errors.push(`${label} 必须是数组`);
      return null;
    }
    const valid = value.filter(isString);
    if (valid.length !== value.length) {
      errors.push(`${label} 的每一项都必须是字符串`);
      return null;
    }
    return valid;
  };

  // ---- 标量 ----
  for (const key of ['frontend', 'viewport'] as const) {
    const value = plan[key];
    if (value === undefined || value === null) continue;
    if (!isString(value)) {
      errors.push(`${key} 必须是字符串`);
      continue;
    }
    result[key] = value;
  }
  if (plan['attach'] !== undefined && plan['attach'] !== null) {
    if (typeof plan['attach'] === 'boolean') result.attach = plan['attach'];
    else errors.push('attach 必须是布尔值');
  }

  // ---- target ----
  const targetValue = plan['target'];
  if (targetValue !== undefined && targetValue !== null) {
    if (!isRecord(targetValue)) {
      errors.push('target 必须是对象');
    } else {
      const target: NonNullable<AuditPlan['target']> = {};
      for (const key of ['kind', 'name', 'css', 'plugin'] as const) {
        const value = targetValue[key];
        if (value === undefined || value === null) continue;
        if (!isString(value)) {
          errors.push(`target.${key} 必须是字符串`);
          continue;
        }
        target[key] = value;
      }
      result.target = target;
    }
  }

  // ---- 字符串数组 ----
  for (const key of ['tokens', 'counts', 'setup', 'actions', 'props'] as const) {
    if (plan[key] === undefined || plan[key] === null) continue;
    const items = arrayOf(key);
    if (!items) continue;
    const strings = items.filter(isString);
    if (strings.length !== items.length) {
      errors.push(`${key} 的每一项都必须是字符串`);
      continue;
    }
    result[key] = strings;
  }

  // ---- boxes：字符串或 { selector, limit? } ----
  const boxesField = arrayOf('boxes');
  if (boxesField) {
    const boxes: NonNullable<AuditPlan['boxes']> = [];
    boxesField.forEach((item, index) => {
      if (isString(item)) {
        boxes.push(item);
        return;
      }
      if (!isRecord(item)) {
        errors.push(`boxes[${index}] 必须是选择器字符串或 { selector, limit }`);
        return;
      }
      if (!isString(item['selector'])) {
        errors.push(`boxes[${index}].selector 必须是字符串`);
        return;
      }
      const entry: { selector: string; limit?: number } = { selector: item['selector'] };
      const limit = item['limit'];
      if (limit !== undefined) {
        if (typeof limit !== 'number' || !Number.isFinite(limit)) {
          errors.push(`boxes[${index}].limit 必须是数字`);
          return;
        }
        entry.limit = limit;
      }
      boxes.push(entry);
    });
    result.boxes = boxes;
  }

  // ---- styles：字符串或 { selector, props? } ----
  const stylesField = arrayOf('styles');
  if (stylesField) {
    const styles: NonNullable<AuditPlan['styles']> = [];
    stylesField.forEach((item, index) => {
      if (isString(item)) {
        styles.push(item);
        return;
      }
      if (!isRecord(item)) {
        errors.push(`styles[${index}] 必须是选择器字符串或 { selector, props }`);
        return;
      }
      if (!isString(item['selector'])) {
        errors.push(`styles[${index}].selector 必须是字符串`);
        return;
      }
      const query: StyleQuery = { selector: item['selector'] };
      const props = optionalProps(item['props'], `styles[${index}].props`);
      if (props) query.props = props;
      styles.push(query);
    });
    result.styles = styles;
  }

  // ---- contrast：[前景, 背景] ----
  const contrastField = arrayOf('contrast');
  if (contrastField) {
    const contrast: NonNullable<AuditPlan['contrast']> = [];
    contrastField.forEach((item, index) => {
      const label = `contrast[${index}] 必须是 [前景, 背景] 两个字符串`;
      if (!Array.isArray(item) || item.length !== 2) {
        errors.push(label);
        return;
      }
      const foreground: unknown = item[0];
      const background: unknown = item[1];
      if (!isString(foreground) || !isString(background)) {
        errors.push(label);
        return;
      }
      contrast.push([foreground, background]);
    });
    result.contrast = contrast;
  }

  // ---- diffs ----
  const diffsField = arrayOf('diffs');
  if (diffsField) {
    const diffs: DiffQuery[] = [];
    diffsField.forEach((item, index) => {
      if (!isRecord(item)) {
        errors.push(`diffs[${index}] 必须是 { selector, do }`);
        return;
      }
      if (!isString(item['selector'])) {
        errors.push(`diffs[${index}].selector 必须是字符串`);
        return;
      }
      const doActions = item['do'];
      if (!Array.isArray(doActions) || doActions.length === 0) {
        errors.push(`diffs[${index}].do 必须是非空动作数组`);
        return;
      }
      const actions = doActions.filter(isString);
      if (actions.length !== doActions.length) {
        errors.push(`diffs[${index}].do 的每一项都必须是字符串`);
        return;
      }
      const query: DiffQuery = { selector: item['selector'], do: actions };
      const props = optionalProps(item['props'], `diffs[${index}].props`);
      if (props) query.props = props;
      diffs.push(query);
    });
    result.diffs = diffs;
  }

  // ---- probes ----
  const probesField = arrayOf('probes');
  if (probesField) {
    const probes: ProbeQuery[] = [];
    probesField.forEach((item, index) => {
      if (!isRecord(item)) {
        errors.push(`probes[${index}] 必须是 { html, target }`);
        return;
      }
      if (!isString(item['html'])) {
        errors.push(`probes[${index}].html 必须是字符串`);
        return;
      }
      if (!isString(item['target'])) {
        errors.push(`probes[${index}].target 必须是字符串`);
        return;
      }
      const query: ProbeQuery = { html: item['html'], target: item['target'] };
      const props = optionalProps(item['props'], `probes[${index}].props`);
      if (props) query.props = props;
      probes.push(query);
    });
    result.probes = probes;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: result };
}

/**
 * 在一个已打开的页面上执行计划。
 * 顺序是有意的：先 setup（建立场景），再 actions，最后逐项测量，
 * 这样「交互后的状态」和「静态值」会出现在同一份结果里，方便对照。
 */
export async function runPlan(page: Page, plan: AuditPlan): Promise<AuditResult> {
  const props = plan.props ?? DEFAULT_PROPS;
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
      const limit = typeof entry === 'string' ? DEFAULT_BOX_LIMIT : (entry.limit ?? DEFAULT_BOX_LIMIT);
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
    // 基线快照必须在循环外拍一次：放在循环内会让第 2 个 diff 的「before」
    // 是第 1 个 diff 的「after」，多个 diff 之间状态串味。
    const rootSnapshot = await snapshotRoot(page);
    for (const query of plan.diffs) {
      // 每个 diff 都先用同一个 setup 重建基线场景。无条件 reset 而不是
      // `if (setup.length)`：没有 setup 时同样要把上一个 diff 的动作退掉，
      // 否则 diff2 的基线就是 diff1 留下的状态。
      await runActions({ page, rootSnapshot }, ['reset', ...setup]);
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
