/**
 * audit 子命令：一次会话跑完计划里的全部测量。
 *
 * 之所以独立成一个文件而不是 measure-cli 里的一支：计划决定 frontend /
 * viewport / target，这些都必须在 createSession() 之前定下来；而且它自带
 * 配置加载、计划校验、结果输出，已经有 200 行，不该挤在 400 行的 switch 文件里。
 *
 * 计划来源与优先级（对齐 pa11y）：命令行参数 > 配置文件 > 内置默认值。
 */
import { createSession, parseViewport } from '../core/session.ts';
import { planIsEmpty, runPlan, validatePlan } from '../core/audit.ts';
import type { AuditResult } from '../core/audit.ts';
import { DEFAULT_CONFIG_NAME, loadConfig, mergePlan } from '../core/audit-config.ts';
import type { LoadedConfig, PlanOverrides } from '../core/audit-config.ts';
import type { MountState } from '../core/target-types.ts';
import type { Target } from '../core/targets.ts';
import { lastValue, allValues } from './cli-args.ts';
import type { ParsedArgs } from './cli-args.ts';
import { resolveTargetFromPlan } from './targets.ts';
import { fail, info, list, section, table, warn } from './ui.ts';

/**
 * 执行审计计划。
 */
export async function runAudit(parsed: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const asJson = parsed.flags.has('--json');
  const explicitConfig = lastValue(parsed, '--config') ?? null;

  // 1) 加载配置文件（可能没有）
  let loaded: LoadedConfig;
  try {
    loaded = await loadConfig(explicitConfig, cwd);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
    process.exit(2);
  }

  // 2) 命令行覆盖
  const split = (value: string | undefined): string[] | undefined =>
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const overrides: PlanOverrides = {
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
  if (parsed.flags.has('--attach')) overrides.attach = true;

  const kind = lastValue(parsed, '--kind');
  const css = lastValue(parsed, '--css');
  const plugin = lastValue(parsed, '--plugin');
  if (kind || css || plugin) overrides.target = { kind, css, plugin };

  const plan = mergePlan(loaded.config, overrides);

  // 3) 校验（在建会话之前，避免白起浏览器）
  const validated = validatePlan(plan);
  if (!validated.ok) {
    fail('计划有问题：');
    for (const error of validated.errors) fail(`  - ${error}`);
    process.exit(2);
  }
  if (planIsEmpty(validated.plan)) {
    fail('计划里没有任何测量项（tokens / styles / counts / boxes / probes / contrast / diffs）');
    if (!loaded.path) {
      fail(`提示：缺省读 ${DEFAULT_CONFIG_NAME}，或用 --config <path> 指定`);
    }
    process.exit(2);
  }

  // --json 时 stdout 只允许 JSON：计划来源这类人类日志全部延后到非 JSON 分支。
  if (!asJson) {
    if (loaded.path) {
      info(`计划：${loaded.path}${loaded.discovered ? '（自动发现）' : ''}`);
    } else {
      info('计划：仅命令行参数');
    }
  }

  // 4) 建会话并执行
  const frontend = plan.frontend ?? 'desktop';
  // 只在计划显式给了 viewport 时传给 createSession；缺省交给 session 按前端取预设。
  // parseViewport(空值) 会返回桌面预设，直接传会让「复用常驻页」误判成用户指定了视口。
  const viewport = plan.viewport ? parseViewport(plan.viewport, null) : null;

  const target = resolveTargetFromPlan(plan.target, parsed);

  const session = await createSession({
    frontend: frontend === 'mobile' ? 'mobile' : 'desktop',
    viewport,
    attach: Boolean(plan.attach),
  });

  try {
    const mount = target ? await target.mountState(session.page) : null;
    if (mount && !mount.ok && !asJson) {
      warn(`注意：${target?.kind} 未挂载 — ${mount.reason ?? '未知原因'}`);
    }

    const result = await runPlan(session.page, validated.plan);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            command: 'audit',
            frontend,
            viewport: session.viewport,
            attached: session.attached,
            target: target ? { kind: target.kind, name: target.name } : null,
            mount,
            ...result,
          },
          null,
          2
        )
      );
      return;
    }

    printAuditHuman(result, target, mount, session.attached);
  } finally {
    await session.dispose();
  }
}

/** 非空样式值转成两列表格行。 */
function styleRows(styles: Record<string, string>): Array<[string, string]> {
  return Object.entries(styles)
    .filter(([, value]) => Boolean(value))
    .map(([prop, value]) => [prop, value]);
}

/** 人读格式的审计结果。 */
function printAuditHuman(
  result: AuditResult,
  target: Target | null,
  mount: MountState | null,
  attached: boolean
): void {
  if (result.environment) {
    const env = result.environment;
    section('环境');
    list([
      ['前端', env.frontend ?? '?'],
      ['后端', env.backend ?? '?'],
      ['模式', env.themeMode ?? '?'],
      ['视口', `${env.viewport.width}x${env.viewport.height}@${env.viewport.dpr}`],
      ['读数来源', attached ? 'dev 会话浏览器（--attach 生效）' : '新开无头浏览器'],
      ['DOM 节点', String(env.domNodes)],
      ['themeStyle', env.themeStyle ?? '(无)'],
    ]);
  }

  if (target) {
    section('目标');
    const rows: Array<[string, string]> = [
      ['目标', `${target.kind}/${target.name}`],
      ['挂载', mount?.ok ? '已挂载' : `未挂载${mount?.reason ? ` — ${mount.reason}` : ''}`],
    ];
    if (result.actions?.length) rows.push(['动作', result.actions.join(' → ')]);
    list(rows);
  } else if (result.actions?.length) {
    section('动作');
    info(result.actions.join(' → '));
  }

  if (result.tokens) {
    section('令牌');
    list(Object.entries(result.tokens).map(([name, value]) => [name, value || '(空)'] as const));
  }

  if (result.styles?.length) {
    section('样式');
    for (const style of result.styles) {
      if (!style.found) {
        warn('未找到元素');
        continue;
      }
      const firstClass = style.className?.split(' ')[0];
      list([
        ['元素', `${style.tag ?? '?'}${style.className ? `.${firstClass}` : ''}`],
        ['命中', `共 ${style.count} 个，可见 ${style.visible}`],
      ]);
      const rows = styleRows(style.styles);
      if (rows.length) table([], rows);
    }
  }

  if (result.counts) {
    section('命中数');
    list(
      Object.entries(result.counts).map(
        ([selector, selection]) => [selector, `总数=${selection.total} 可见=${selection.visible}`] as const
      )
    );
  }

  if (result.boxes && Object.keys(result.boxes).length) {
    section('盒模型');
    const rows: Array<Array<string | number>> = [];
    for (const [selector, boxes] of Object.entries(result.boxes)) {
      if (!boxes.length) {
        warn(`${selector}：没有可见的匹配元素`);
        continue;
      }
      for (const entry of boxes) {
        rows.push([
          selector,
          String(entry.index),
          `${entry.tag}.${entry.className.split(' ')[0] ?? ''}`,
          `${entry.width}×${entry.height}`,
          `@(${entry.x},${entry.y})`,
        ]);
      }
    }
    if (rows.length) table(['选择器', '#', '元素', '尺寸', '位置'], rows);
  }

  if (result.probes?.length) {
    section('探针');
    for (const [index, probe] of result.probes.entries()) {
      if (!probe.found) {
        warn(`探针 ${index}：没有匹配元素`);
        continue;
      }
      info(`探针 ${index}`);
      const rows = styleRows(probe.styles);
      if (rows.length) table([], rows);
    }
  }

  if (result.contrast?.length) {
    section('对比度');
    table(
      ['前景', '背景', '对比度'],
      result.contrast.map((entry) => [
        entry.foreground || '(空)',
        entry.background || '(空)',
        entry.ratio === null ? '解析失败' : `${entry.ratio}:1`,
      ])
    );
  }

  if (result.diffs?.length) {
    section('差异');
    for (const diff of result.diffs) {
      if (!diff.found) {
        warn('diff：未找到元素');
        continue;
      }
      if (!Object.keys(diff.changed).length) {
        info('diff：无变化');
        continue;
      }
      info('diff：');
      table(
        ['属性', '变化前', '变化后'],
        Object.entries(diff.changed).map(([prop, change]) => [prop, change.from, change.to])
      );
    }
  }
}
