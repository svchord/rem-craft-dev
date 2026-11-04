/**
 * audit 子命令：一次会话跑完计划里的全部测量。
 *
 * 之所以独立成一个文件而不是 measure-cli 里的一支：计划决定 frontend /
 * viewport / target，这些都必须在 createSession() 之前定下来；而且它自带
 * 配置加载、计划校验、结果输出，已经有 200 行，不该挤在 400 行的 switch 文件里。
 *
 * 计划来源与优先级（对齐 pa11y）：命令行参数 > 配置文件 > 内置默认值。
 */
import { createSession, parseViewport } from '../core/session.js';
import { planIsEmpty, runPlan, validatePlan } from '../core/audit.js';
import { DEFAULT_CONFIG_NAME, loadConfig, mergePlan } from '../core/audit-config.js';
import { lastValue, allValues } from './cli-args.js';
import { resolveTargetFromPlan } from './targets.js';
const PREFIX = '[measure] ';
/**
 * 执行审计计划。
 */
export async function runAudit(parsed) {
    const cwd = process.cwd();
    const explicitConfig = lastValue(parsed, '--config') ?? null;
    // 1) 加载配置文件（可能没有）
    let loaded;
    try {
        loaded = await loadConfig(explicitConfig, cwd);
    }
    catch (cause) {
        console.error(`${PREFIX}${cause instanceof Error ? cause.message : String(cause)}`);
        process.exit(2);
    }
    // 2) 命令行覆盖
    const split = (value) => value
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const overrides = {
        frontend: lastValue(parsed, '--frontend'),
        viewport: lastValue(parsed, '--viewport'),
        props: split(lastValue(parsed, '--props')),
        tokens: split(lastValue(parsed, '--tokens')),
        styles: split(lastValue(parsed, '--styles')),
        counts: split(lastValue(parsed, '--counts')),
        boxes: split(lastValue(parsed, '--boxes')),
        setup: allValues(parsed, '--setup'),
        actions: allValues(parsed, '--do'),
    };
    if (parsed.flags.has('--attach'))
        overrides.attach = true;
    const kind = lastValue(parsed, '--kind');
    const css = lastValue(parsed, '--css');
    const plugin = lastValue(parsed, '--plugin');
    if (kind || css || plugin)
        overrides.target = { kind, css, plugin };
    const plan = mergePlan(loaded.config, overrides);
    // 3) 校验（在建会话之前，避免白起浏览器）
    const validated = validatePlan(plan);
    if (!validated.ok) {
        console.error(`${PREFIX}计划有问题：`);
        for (const error of validated.errors)
            console.error(`${PREFIX}  - ${error}`);
        process.exit(2);
    }
    if (planIsEmpty(validated.plan)) {
        console.error(`${PREFIX}计划里没有任何测量项（tokens / styles / counts / boxes / probes / contrast / diffs）`);
        if (!loaded.path) {
            console.error(`${PREFIX}提示：缺省读 ${DEFAULT_CONFIG_NAME}，或用 --config <path> 指定`);
        }
        process.exit(2);
    }
    if (loaded.path) {
        console.log(`${PREFIX}计划：${loaded.path}${loaded.discovered ? '（自动发现）' : ''}`);
    }
    else {
        console.log(`${PREFIX}计划：仅命令行参数`);
    }
    // 4) 建会话并执行
    const frontend = plan.frontend ?? 'desktop';
    const viewport = parseViewport(plan.viewport, null) ?? parseViewport(frontend === 'mobile' ? '390x844@3' : '1600x1000@1', null);
    const target = resolveTargetFromPlan(plan.target, parsed);
    const session = await createSession({
        frontend: frontend === 'mobile' ? 'mobile' : 'desktop',
        viewport,
        attach: Boolean(plan.attach),
    });
    try {
        const mount = target ? await target.mountState(session.page) : null;
        if (mount && !mount.ok) {
            console.log(`${PREFIX}注意：${target?.kind} 未挂载 — ${mount.reason ?? '未知原因'}`);
        }
        const result = await runPlan(session.page, validated.plan);
        if (parsed.flags.has('--json')) {
            console.log(JSON.stringify({
                command: 'audit',
                frontend,
                viewport: session.viewport,
                target: target ? { kind: target.kind, name: target.name } : null,
                mount,
                ...result,
            }, null, 2));
            return;
        }
        printAuditHuman(result, target, mount);
    }
    finally {
        await session.dispose();
    }
}
/** 人读格式的审计结果。 */
function printAuditHuman(result, target, mount) {
    const pad = (text, width) => text.padEnd(width);
    if (result.environment) {
        const env = result.environment;
        console.log(`${PREFIX}前端=${env.frontend ?? '?'} 后端=${env.backend ?? '?'} 模式=${env.themeMode ?? '?'}`);
        console.log(`${PREFIX}themeStyle=${env.themeStyle ?? '(无)'}`);
    }
    if (target) {
        console.log(`${PREFIX}目标=${target.kind}/${target.name}${mount?.ok ? '（已挂载）' : ''}`);
    }
    if (result.actions?.length) {
        console.log(`${PREFIX}动作：${result.actions.join(' → ')}`);
    }
    if (result.tokens) {
        const width = Math.max(...Object.keys(result.tokens).map((key) => key.length));
        for (const [name, value] of Object.entries(result.tokens)) {
            console.log(`${PREFIX}${pad(name, width)}  ${value || '(空)'}`);
        }
    }
    for (const style of result.styles ?? []) {
        if (!style.found) {
            console.log(`${PREFIX}未找到元素`);
            continue;
        }
        console.log(`${PREFIX}${style.tag ?? '?'}（共 ${style.count} 个，可见 ${style.visible}）`);
        for (const [prop, value] of Object.entries(style.styles)) {
            if (!value)
                continue;
            console.log(`  ${pad(prop, 18)}${value}`);
        }
    }
    if (result.counts) {
        const width = Math.max(...Object.keys(result.counts).map((key) => key.length));
        for (const [selector, info] of Object.entries(result.counts)) {
            console.log(`${PREFIX}${pad(selector, width)}  总数=${info.total} 可见=${info.visible}`);
        }
    }
    for (const [selector, boxes] of Object.entries(result.boxes ?? {})) {
        if (!boxes.length) {
            console.log(`${PREFIX}${selector}：没有可见的匹配元素`);
            continue;
        }
        for (const box of boxes) {
            console.log(`${PREFIX}${selector}[${box.index}] ${box.width}×${box.height} @(${box.x},${box.y})`);
        }
    }
    for (const [index, probe] of (result.probes ?? []).entries()) {
        if (!probe.found) {
            console.log(`${PREFIX}探针 ${index}：没有匹配元素`);
            continue;
        }
        console.log(`${PREFIX}探针 ${index}：`);
        for (const [prop, value] of Object.entries(probe.styles)) {
            if (!value)
                continue;
            console.log(`  ${pad(prop, 18)}${value}`);
        }
    }
    for (const entry of result.contrast ?? []) {
        console.log(`${PREFIX}${entry.foreground || '(空)'} on ${entry.background || '(空)'} = ` +
            `${entry.ratio === null ? '解析失败' : `${entry.ratio}:1`}`);
    }
    for (const diff of result.diffs ?? []) {
        if (!diff.found) {
            console.log(`${PREFIX}diff：未找到元素`);
            continue;
        }
        if (!Object.keys(diff.changed).length) {
            console.log(`${PREFIX}diff：无变化`);
            continue;
        }
        console.log(`${PREFIX}diff：`);
        for (const [prop, change] of Object.entries(diff.changed)) {
            console.log(`  ${pad(prop, 18)}${change.from} → ${change.to}`);
        }
    }
}
//# sourceMappingURL=audit.js.map