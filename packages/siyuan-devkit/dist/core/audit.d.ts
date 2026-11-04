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
import type { DiffResult, ElementBox, ElementStyleReading, PageEnvironment, ProbeHtmlReading, SelectorCount } from './measure.ts';
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
    target?: {
        kind?: string;
        name?: string;
        css?: string;
        plugin?: string;
    } | null;
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
    boxes?: Array<string | {
        selector: string;
        limit?: number;
    }>;
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
    mount?: {
        ok: boolean;
        loaded: string | null;
        reason: string | null;
    };
    actions?: string[];
    tokens?: Record<string, string>;
    styles?: ElementStyleReading[];
    counts?: Record<string, SelectorCount>;
    boxes?: Record<string, ElementBox[]>;
    probes?: ProbeHtmlReading[];
    contrast?: Array<{
        foreground: string | undefined;
        background: string | undefined;
        ratio: number | null;
    }>;
    diffs?: DiffResult[];
}
/** 默认要读的 CSS 属性。与单子命令保持一致。 */
export declare const DEFAULT_PROPS: string[];
/**
 * 校验计划形状，把明显的错误提前说清楚。
 *
 * 计划是给人/agent 写的 JSON，写错了在浏览器里才发现会很浪费
 * （每次都要起会话）。所以这里在开浏览器**之前**就校验完。
 */
export declare function validatePlan(plan: unknown): {
    ok: true;
    plan: AuditPlan;
} | {
    ok: false;
    errors: string[];
};
/**
 * 在一个已打开的页面上执行计划。
 *
 * 顺序是有意的：先 setup（建立场景），再 actions，最后逐项测量。
 * 这样「交互后的状态」和「静态值」会出现在同一份结果里，方便对照。
 */
export declare function runPlan(page: Page, plan: AuditPlan, options?: {
    defaultProps?: string[];
}): Promise<AuditResult>;
/** 计划里是否真的要做点什么（空计划不该白起一个浏览器）。 */
export declare function planIsEmpty(plan: AuditPlan): boolean;
//# sourceMappingURL=audit.d.ts.map