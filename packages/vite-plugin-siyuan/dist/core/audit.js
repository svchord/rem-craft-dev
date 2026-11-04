import { runActions, snapshotRoot } from './actions.js';
import { contrastRatio } from './color.js';
import { diffAfter, elementBox, elementStyles, environment, probeHtml, selectorCounts, tokens, } from './measure.js';
import { probeTokens } from './probes.js';
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
const selectorOf = (entry) => typeof entry === 'string' ? entry : entry.selector;
/**
 * 校验计划形状，把明显的错误提前说清楚。
 *
 * 计划是给人/agent 写的 JSON，写错了在浏览器里才发现会很浪费
 * （每次都要起会话）。所以这里在开浏览器**之前**就校验完。
 */
export function validatePlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object') {
        return { ok: false, errors: ['计划必须是一个对象'] };
    }
    const value = plan;
    const arrayOf = (key) => {
        const field = value[key];
        if (field === undefined || field === null)
            return [];
        if (!Array.isArray(field)) {
            errors.push(`${key} 必须是数组`);
            return [];
        }
        return field;
    };
    arrayOf('tokens').forEach((item, index) => {
        if (typeof item !== 'string')
            errors.push(`tokens[${index}] 必须是字符串`);
    });
    arrayOf('counts').forEach((item, index) => {
        if (typeof item !== 'string')
            errors.push(`counts[${index}] 必须是字符串`);
    });
    arrayOf('setup').forEach((item, index) => {
        if (typeof item !== 'string')
            errors.push(`setup[${index}] 必须是字符串动作`);
    });
    arrayOf('actions').forEach((item, index) => {
        if (typeof item !== 'string')
            errors.push(`actions[${index}] 必须是字符串动作`);
    });
    arrayOf('styles').forEach((item, index) => {
        if (typeof item === 'string')
            return;
        if (!item || typeof item !== 'object') {
            errors.push(`styles[${index}] 必须是选择器字符串或 { selector, props }`);
            return;
        }
        const query = item;
        if (typeof query.selector !== 'string')
            errors.push(`styles[${index}].selector 必须是字符串`);
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
        const query = item;
        if (typeof query.selector !== 'string')
            errors.push(`diffs[${index}].selector 必须是字符串`);
        if (!Array.isArray(query.do) || !query.do.length)
            errors.push(`diffs[${index}].do 必须是非空动作数组`);
    });
    arrayOf('probes').forEach((item, index) => {
        if (!item || typeof item !== 'object') {
            errors.push(`probes[${index}] 必须是 { html, target }`);
            return;
        }
        const query = item;
        if (typeof query.html !== 'string')
            errors.push(`probes[${index}].html 必须是字符串`);
        if (typeof query.target !== 'string')
            errors.push(`probes[${index}].target 必须是字符串`);
    });
    if (errors.length)
        return { ok: false, errors };
    return { ok: true, plan: value };
}
/**
 * 在一个已打开的页面上执行计划。
 *
 * 顺序是有意的：先 setup（建立场景），再 actions，最后逐项测量。
 * 这样「交互后的状态」和「静态值」会出现在同一份结果里，方便对照。
 */
export async function runPlan(page, plan, options = {}) {
    const props = options.defaultProps ?? plan.props ?? DEFAULT_PROPS;
    const result = {};
    result.environment = await environment(page);
    // 动作：先 reset 到干净状态，再跑 setup，最后跑 actions。
    const setup = plan.setup ?? [];
    const actions = plan.actions ?? [];
    if (setup.length || actions.length) {
        const rootSnapshot = await snapshotRoot(page);
        const session = { page, rootSnapshot };
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
            result.probes.push(await probeHtml(page, { html: probe.html, target: probe.target, props: probe.props ?? props }));
        }
    }
    if (plan.contrast?.length) {
        // 令牌名以 -- 开头时先解析成计算值；否则当作颜色值直接用。
        const resolveColor = async (input) => {
            if (!input.startsWith('--'))
                return input;
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
            result.diffs.push(await diffAfter(page, {
                selector: query.selector,
                props: query.props ?? props,
                run: async (target) => runActions({ page: target, rootSnapshot }, query.do),
            }));
        }
    }
    return result;
}
/** 计划里是否真的要做点什么（空计划不该白起一个浏览器）。 */
export function planIsEmpty(plan) {
    const fields = [
        'tokens',
        'styles',
        'counts',
        'boxes',
        'probes',
        'contrast',
        'diffs',
    ];
    return !fields.some((field) => {
        const value = plan[field];
        return Array.isArray(value) && value.length > 0;
    });
}
//# sourceMappingURL=audit.js.map