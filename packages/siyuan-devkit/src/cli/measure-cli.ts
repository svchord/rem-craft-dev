/**
 * 测量 CLI：把测量原语暴露成命令行，供 agent 按需组合。
 *
 * **工具不预设该查什么。** 查哪些令牌、量哪些选择器、什么值算对，
 * 全部由调用方在命令行上传入。工具只负责把页面事实读出来。
 *
 * 子命令：
 *
 *   env                         页面环境（前端/后端/模式/视口/DOM 节点数）
 *   tokens <name...>            令牌计算值
 *   styles <selector> [--props] 元素计算样式
 *   count <selector...>         选择器命中数（总数 / 可见数）
 *   box <selector>              元素盒模型尺寸（触摸目标、间距）
 *   probe <html> <target> [--props]  插入一段 HTML 再量
 *   diff <selector> --do <actions>   动作前后的样式差异
 *   contrast <fg> <bg>          两色对比度
 *
 * 通用选项：
 *   --kind theme|plugin         被测类型；缺省按当前目录推断
 *   --frontend desktop|mobile   缺省 desktop
 *   --viewport 390x844@3
 *   --do <action>               驱动交互（可重复）
 *   --setup <action>            场景准备（可重复，diff 用）
 *   --css <path>                被测 CSS（主题）
 *   --plugin <name>             被测插件
 *   --attach                    复用 dev 会话的浏览器
 *   --json                      结构化输出
 *   --props a,b,c               要读的样式属性
 *   --limit <n>                 box 的最大条数
 *
 * 例子（agent 按任务临时组合，不需要改工具）：
 *   syt measure tokens --rc-text-primary --rc-bg-page
 *   syt measure styles .b3-menu__item --props color,background-color
 *   syt measure diff .b3-menu__item --do contextmenu:.b3-list-item --do hover:.b3-menu__item
 *   syt measure box .dock__item --frontend mobile
 *
 * 退出码：成功 0，参数/运行错误 2。
 */
import { createSession, parseViewport, viewportFor } from '../core/session.ts';
import type { Session } from '../core/session.ts';
import { runActions, snapshotRoot } from '../core/actions.ts';
import { contrastRatio } from '../core/color.ts';
import {
  diffAfter,
  elementBox,
  elementStyles,
  environment,
  probeHtml,
  selectorCounts,
  tokens,
} from '../core/measure.ts';
import type {
  DiffResult,
  ElementBox,
  ElementStyleReading,
  PageEnvironment,
  ProbeHtmlReading,
  SelectorCount,
} from '../core/measure.ts';
import { lastValue, allValues, parseArgs, wantsHelp } from './cli-args.ts';
import type { MountState } from '../core/target-types.ts';
import { DEFAULT_PROPS } from '../core/audit.ts';
import { resolveTargetFromParsed } from './targets.ts';
import { runAudit } from './audit.ts';
import { box, info, list, section, table, warn } from './ui.ts';

const VALUE_FLAGS = [
  '--frontend',
  '--viewport',
  '--do',
  '--setup',
  '--css',
  '--plugin',
  '--kind',
  '--props',
  '--limit',
  // audit 专用
  '--config',
  '--tokens',
  '--styles',
  '--counts',
  '--boxes',
] as const;

const BOOLEAN_FLAGS = ['--attach', '--json', '--help', '-h'] as const;

const usage = (): void => {
  box('syt measure', ['在真实思源前端里量渲染事实、驱动交互。', '用法：syt measure <子命令> [参数] [选项]']);

  section('子命令');
  table(
    ['子命令', '说明'],
    [
      ['env', '页面环境'],
      ['tokens <name...>', '令牌计算值'],
      ['styles <selector>', '元素计算样式'],
      ['count <selector...>', '选择器命中数'],
      ['box <selector>', '元素盒模型尺寸'],
      ['probe <html> <target>', '插入 HTML 再量'],
      ['diff <selector> --do <action>', '动作前后差异'],
      ['contrast <fg> <bg>', '两色对比度'],
      ['audit [--config <path>]', '一次会话跑完计划里的全部测量'],
    ]
  );

  section('通用选项');
  list([
    ['--kind <类型>', 'theme | plugin，缺省按当前目录推断'],
    ['--frontend <端>', 'desktop | mobile，缺省 desktop'],
    ['--viewport <视口>', '如 390x844@3'],
    ['--props <属性>', '逗号分隔的样式属性'],
    ['--do <action>', '驱动交互，可重复'],
    ['--setup <action>', '场景准备，可重复'],
    ['--attach', '复用 dev 会话的浏览器'],
    ['--json', '结构化输出（stdout 只有 JSON）'],
  ]);

  section('audit 计划文件');
  info('缺省读 ./.siyuan-audit.json，优先级：命令行 > 文件 > 默认值。');
  info('{ "tokens": [...], "styles": [...], "counts": [...], "boxes": [...], "probes": [...],');
  info('  "contrast": [[fg, bg]], "diffs": [...], "setup": [...], "actions": [...], "frontend": "mobile" }');
};

/** 输出结构。 */
interface MeasureOutput {
  command: string;
  frontend: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  target: { kind: string; name: string } | null;
  /**
   * 读数来源：true=复用了 dev 会话的浏览器（你眼前那个窗口），
   * false=新开的无头浏览器。`--attach` 连不上时会静默新开，
   * 没有这个字段就无法判断读的是不是同一个页面。
   */
  attached: boolean;
  mount?: MountState;
  actions?: string[];
  setup?: string[];
  environment?: PageEnvironment;
  tokens?: Record<string, string>;
  styles?: ElementStyleReading;
  counts?: Record<string, SelectorCount>;
  boxes?: ElementBox[];
  probe?: ProbeHtmlReading;
  diff?: DiffResult;
  contrast?: { foreground: string | undefined; background: string | undefined; ratio: number | null };
}

/** 非空样式值转成两列表格行。 */
function styleRows(styles: Record<string, string>): Array<[string, string]> {
  return Object.entries(styles)
    .filter(([, value]) => Boolean(value))
    .map(([prop, value]) => [prop, value]);
}

function printHuman(output: MeasureOutput, frontend: string): void {
  // 只在没挂上时提醒，正常情况不打扰。
  if (output.mount && !output.mount.ok) {
    warn(`注意：${output.target?.kind ?? ''} 未挂载 — ${output.mount.reason ?? '未知原因'}`);
  }

  if (output.environment) {
    const env = output.environment;
    section('环境');
    list([
      ['前端', env.frontend ?? '?'],
      ['后端', env.backend ?? '?'],
      ['模式', env.themeMode ?? '?'],
      ['视口', `${env.viewport.width}x${env.viewport.height}@${env.viewport.dpr}`],
      // 读数出处必须显式给出：--attach 连不上会静默新开无头浏览器，
      // 不说明的话无法判断这些值来自哪个页面。
      ['读数来源', output.attached ? 'dev 会话浏览器（--attach 生效）' : '新开无头浏览器'],
      ['DOM 节点', String(env.domNodes)],
      ['themeStyle', env.themeStyle ?? '(无)'],
    ]);
  }

  if (output.tokens) {
    section('令牌');
    list(Object.entries(output.tokens).map(([name, value]) => [name, value || '(空)'] as const));
  }

  if (output.styles) {
    section('样式');
    const style = output.styles;
    if (!style.found) {
      warn('未找到元素');
    } else {
      const firstClass = style.className?.split(' ')[0];
      list([
        ['元素', `${style.tag ?? '?'}${style.className ? `.${firstClass}` : ''}`],
        ['命中', `共 ${style.count} 个，可见 ${style.visible}`],
      ]);
      const rows = styleRows(style.styles);
      if (rows.length) table([], rows);
    }
  }

  if (output.counts) {
    section('命中数');
    list(
      Object.entries(output.counts).map(
        ([selector, selection]) => [selector, `总数=${selection.total} 可见=${selection.visible}`] as const
      )
    );
  }

  if (output.boxes) {
    section('盒模型');
    if (!output.boxes.length) {
      // 空结果是正常读数（比如移动端没有 .dock__item），必须明说，
      // 否则会被误当成「命令没跑」。
      warn(`没有可见的匹配元素（选择器可能不适用于 ${frontend} 端）`);
    } else {
      table(
        ['#', '元素', '尺寸', '位置'],
        output.boxes.map((entry) => [
          String(entry.index),
          `${entry.tag}.${entry.className.split(' ')[0] ?? ''}`,
          `${entry.width}×${entry.height}`,
          `@(${entry.x},${entry.y})`,
        ])
      );
    }
  }

  if (output.probe) {
    section('探针');
    if (!output.probe.found) {
      warn('探针里没有匹配元素');
    } else {
      const rows = styleRows(output.probe.styles);
      if (rows.length) table([], rows);
    }
  }

  if (output.diff) {
    section('差异');
    const diff = output.diff;
    if (!diff.found) {
      warn('未找到元素');
    } else if (!Object.keys(diff.changed).length) {
      info('无变化');
    } else {
      table(
        ['属性', '变化前', '变化后'],
        Object.entries(diff.changed).map(([prop, change]) => [prop, change.from, change.to])
      );
    }
  }

  if (output.contrast) {
    section('对比度');
    const contrast = output.contrast;
    table(
      ['前景', '背景', '对比度'],
      [
        [
          contrast.foreground || '(空)',
          contrast.background || '(空)',
          contrast.ratio === null ? '解析失败' : `${contrast.ratio}:1`,
        ],
      ]
    );
  }
}

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runMeasureCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  // --help 必须只打印用法、不执行动作。否则 `measure env --help` 会真的去开浏览器量一遍。
  if (wantsHelp(argv)) {
    usage();
    if (!command) process.exitCode = 2;
    return;
  }

  if (!command) {
    usage();
    process.exitCode = 2;
    return;
  }

  const parsed = parseArgs(argv.slice(1), { valueFlags: VALUE_FLAGS, booleanFlags: BOOLEAN_FLAGS });
  const args = parsed.positional;

  // audit 走单独路径：计划本身决定 frontend / viewport，所以要在建会话之前解析。
  if (command === 'audit') {
    await runAudit(parsed);
    return;
  }

  const frontend = (lastValue(parsed, '--frontend') ?? 'desktop') === 'mobile' ? 'mobile' : 'desktop';
  const viewport = viewportFor(frontend, parseViewport(lastValue(parsed, '--viewport'), null));
  const asJson = parsed.flags.has('--json');
  const props =
    lastValue(parsed, '--props')
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? DEFAULT_PROPS;
  const actions = allValues(parsed, '--do');
  const setupActions = allValues(parsed, '--setup');

  const target = resolveTargetFromParsed(parsed);

  const session: Session = await createSession({
    frontend,
    viewport,
    attach: parsed.flags.has('--attach'),
  });

  const output: MeasureOutput = {
    command,
    frontend,
    viewport: session.viewport,
    target: target ? { kind: target.kind, name: target.name } : null,
    attached: session.attached,
  };

  try {
    // 挂载状态是审计的前提事实：没挂上却量到值，说明量的是宿主主题/别的插件，
    // 读数会被张冠李戴。这里只如实输出，不替调用方判断「算不算对」。
    if (target) {
      output.mount = await target.mountState(session.page);
    }

    // 动作先跑（如果有），让后续测量发生在目标状态下。
    // 例外：diff 自己管动作（要先 setup 建立基线再 do），外层不能预先执行，
    // 否则 --do 会在 setup 之前跑一次，目标元素可能还不存在。
    if (actions.length && command !== 'diff') {
      const rootSnapshot = await snapshotRoot(session.page);
      output.actions = await runActions({ page: session.page, rootSnapshot }, ['reset', ...setupActions, ...actions]);
    } else if (setupActions.length && command !== 'diff') {
      const rootSnapshot = await snapshotRoot(session.page);
      output.actions = await runActions({ page: session.page, rootSnapshot }, ['reset', ...setupActions]);
    }

    switch (command) {
      case 'env':
        output.environment = await environment(session.page);
        break;

      case 'tokens': {
        if (!args.length) throw new Error('tokens 需要至少一个令牌名');
        output.tokens = await tokens(session.page, args);
        break;
      }

      case 'styles': {
        const selector = args[0];
        if (!selector) throw new Error('styles 需要一个选择器');
        output.styles = await elementStyles(session.page, selector, props);
        break;
      }

      case 'count': {
        if (!args.length) throw new Error('count 需要至少一个选择器');
        output.counts = await selectorCounts(session.page, args);
        break;
      }

      case 'box': {
        const selector = args[0];
        if (!selector) throw new Error('box 需要一个选择器');
        output.boxes = await elementBox(session.page, selector, Number(lastValue(parsed, '--limit') ?? 5));
        break;
      }

      case 'probe': {
        const [html, probeTarget] = args;
        if (!html || !probeTarget) throw new Error('probe 需要 <html> <target>');
        output.probe = await probeHtml(session.page, { html, target: probeTarget, props });
        break;
      }

      case 'diff': {
        // 语义：--setup 先把页面带到目标场景（如打开菜单），--do 是「相对基线要做的动作」。
        // 没有 --setup 时，--do 就是全部动作，但那样元素可能还不存在（菜单项就是）。
        const selector = args[0];
        if (!selector) throw new Error('diff 需要一个选择器');
        if (!actions.length) throw new Error('diff 需要 --do 指定要执行的交互');
        const rootSnapshot = await snapshotRoot(session.page);

        // 1) 复位 + 执行 setup，建立可测量的基线场景
        await runActions({ page: session.page, rootSnapshot }, ['reset', ...setupActions]);

        // 2) 读基线 → 执行 --do 动作 → 读结果
        //    注意：run 里不能再 reset，否则 setup 打开的菜单会被关掉。
        output.diff = await diffAfter(session.page, {
          selector,
          props,
          run: async (page) => runActions({ page, rootSnapshot }, actions),
        });
        if (setupActions.length) output.setup = setupActions;
        break;
      }

      case 'contrast': {
        // 便捷：直接算两个令牌（或两个颜色值）的对比度
        const [fgArg, bgArg] = args;
        if (!fgArg || !bgArg) throw new Error('contrast 需要 <前景> <背景>（令牌名或颜色值）');
        const resolveColor = async (input: string): Promise<string | undefined> => {
          if (input.startsWith('--')) return (await tokens(session.page, [input]))[input];
          return input;
        };
        const fg = await resolveColor(fgArg);
        const bg = await resolveColor(bgArg);
        output.contrast = { foreground: fg, background: bg, ratio: contrastRatio(fg, bg) };
        break;
      }

      default:
        // --json 时 stdout 只能有 JSON，用法说明不混进来。
        if (!asJson) usage();
        throw new Error(`未知子命令：${command}`);
    }
  } finally {
    await session.dispose();
  }

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printHuman(output, frontend);
}
