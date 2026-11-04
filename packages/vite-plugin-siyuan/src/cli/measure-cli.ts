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
 *   siyuan-devtools measure tokens --rc-text-primary --rc-bg-page
 *   siyuan-devtools measure styles .b3-menu__item --props color,background-color
 *   siyuan-devtools measure diff .b3-menu__item --do contextmenu:.b3-list-item --do hover:.b3-menu__item
 *   siyuan-devtools measure box .dock__item --frontend mobile
 *
 * 退出码：成功 0，参数/运行错误 2。
 */
import { createSession, parseViewport } from '../core/session.ts';
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
import { resolveTargetFromArgs } from './targets.ts';
import { runAudit } from './audit.ts';

const PREFIX = '[measure] ';

const DEFAULT_PROPS = [
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

interface UsageLine {
  (): void;
}

const usage: UsageLine = () => {
  console.log(
    [
      '用法：siyuan-devtools measure <子命令> [参数] [选项]',
      '',
      '  env                              页面环境',
      '  tokens <name...>                 令牌计算值',
      '  styles <selector>                元素计算样式',
      '  count <selector...>              选择器命中数',
      '  box <selector>                   元素盒模型尺寸',
      '  probe <html> <target>            插入 HTML 再量',
      '  diff <selector> --do <action>    动作前后差异',
      '  contrast <fg> <bg>               两色对比度',
      '  audit [--config <path>]          一次会话跑完计划里的全部测量',
      '',
      '通用选项：--kind --frontend --viewport --do --setup --css --plugin --attach --json --props',
      '',
      'audit 的计划文件（缺省 ./.siyuan-audit.json，优先级：命令行 > 文件 > 默认值）：',
      '  { "tokens": [...], "styles": [...], "counts": [...], "boxes": [...],',
      '    "probes": [...], "contrast": [[fg, bg]], "diffs": [...],',
      '    "setup": [...], "actions": [...], "frontend": "mobile" }',
    ].join('\n')
  );
};

/** 输出结构。 */
interface MeasureOutput {
  command: string;
  frontend: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  target: { kind: string; name: string } | null;
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

function printHuman(output: MeasureOutput, frontend: string): void {
  const pad = (text: string, width: number): string => text.padEnd(width);

  // 只在没挂上时提醒，正常情况不打扰。
  if (output.mount && !output.mount.ok) {
    console.log(`${PREFIX}注意：${output.target?.kind ?? ''} 未挂载 — ${output.mount.reason ?? '未知原因'}`);
  }

  if (output.environment) {
    const env = output.environment;
    console.log(`${PREFIX}前端=${env.frontend ?? '?'} 后端=${env.backend ?? '?'} 模式=${env.themeMode ?? '?'}`);
    console.log(
      `${PREFIX}视口=${env.viewport.width}x${env.viewport.height}@${env.viewport.dpr} DOM节点=${env.domNodes}`
    );
    console.log(`${PREFIX}themeStyle=${env.themeStyle ?? '(无)'}`);
  }

  if (output.tokens) {
    const width = Math.max(...Object.keys(output.tokens).map((key) => key.length));
    for (const [name, value] of Object.entries(output.tokens)) {
      console.log(`${PREFIX}${pad(name, width)}  ${value || '(空)'}`);
    }
  }

  if (output.styles) {
    const style = output.styles;
    if (!style.found) {
      console.log(`${PREFIX}未找到元素`);
    } else {
      console.log(
        `${PREFIX}${style.tag ?? '?'}${style.className ? `.${style.className.split(' ')[0]}` : ''}` +
          `（共 ${style.count} 个，可见 ${style.visible}）`
      );
      for (const [prop, value] of Object.entries(style.styles)) {
        if (!value) continue;
        console.log(`  ${pad(prop, 18)}${value}`);
      }
    }
  }

  if (output.counts) {
    const width = Math.max(...Object.keys(output.counts).map((key) => key.length));
    for (const [selector, info] of Object.entries(output.counts)) {
      console.log(`${PREFIX}${pad(selector, width)}  总数=${info.total} 可见=${info.visible}`);
    }
  }

  if (output.boxes) {
    if (!output.boxes.length) {
      // 空结果是正常读数（比如移动端没有 .dock__item），必须明说，
      // 否则会被误当成「命令没跑」。
      console.log(`${PREFIX}没有可见的匹配元素（选择器可能不适用于 ${frontend} 端）`);
    }
    for (const box of output.boxes) {
      console.log(
        `${PREFIX}[${box.index}] ${box.tag}.${box.className.split(' ')[0] ?? ''}  ` +
          `${box.width}×${box.height}  @(${box.x},${box.y})`
      );
    }
  }

  if (output.probe) {
    if (!output.probe.found) {
      console.log(`${PREFIX}探针里没有匹配元素`);
    } else {
      for (const [prop, value] of Object.entries(output.probe.styles)) {
        if (!value) continue;
        console.log(`  ${pad(prop, 18)}${value}`);
      }
    }
  }

  if (output.diff) {
    const diff = output.diff;
    if (!diff.found) {
      console.log(`${PREFIX}未找到元素`);
    } else if (!Object.keys(diff.changed).length) {
      console.log(`${PREFIX}无变化`);
    } else {
      for (const [prop, change] of Object.entries(diff.changed)) {
        console.log(`  ${pad(prop, 18)}${change.from} → ${change.to}`);
      }
    }
  }

  if (output.contrast) {
    const contrast = output.contrast;
    console.log(
      `${PREFIX}${contrast.foreground || '(空)'} on ${contrast.background || '(空)'} = ` +
        `${contrast.ratio === null ? '解析失败' : `${contrast.ratio}:1`}`
    );
  }
}

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runMeasureCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  // --help 必须只打印用法、不执行动作。否则 `measure env --help` 会真的去开浏览器量一遍。
  if (wantsHelp(argv)) {
    usage();
    if (!command) process.exit(2);
    return;
  }

  if (!command) {
    usage();
    process.exit(2);
  }

  const parsed = parseArgs(argv.slice(1), { valueFlags: VALUE_FLAGS, booleanFlags: BOOLEAN_FLAGS });
  const args = parsed.positional;

  // audit 走单独路径：计划本身决定 frontend / viewport，所以要在建会话之前解析。
  if (command === 'audit') {
    await runAudit(parsed);
    return;
  }

  const frontend = lastValue(parsed, '--frontend') ?? 'desktop';
  const viewport =
    parseViewport(lastValue(parsed, '--viewport'), null) ??
    parseViewport(frontend === 'mobile' ? '390x844@3' : '1600x1000@1', null);
  const asJson = parsed.flags.has('--json');
  const props =
    lastValue(parsed, '--props')
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? DEFAULT_PROPS;
  const actions = allValues(parsed, '--do');
  const setupActions = allValues(parsed, '--setup');

  const target = resolveTargetFromArgs(argv.slice(1));

  const session: Session = await createSession({
    frontend: frontend === 'mobile' ? 'mobile' : 'desktop',
    viewport,
    attach: parsed.flags.has('--attach'),
  });

  const output: MeasureOutput = {
    command,
    frontend,
    viewport: session.viewport,
    target: target ? { kind: target.kind, name: target.name } : null,
  };

  // 挂载状态是审计的前提事实：没挂上却量到值，说明量的是宿主主题/别的插件，
  // 读数会被张冠李戴。这里只如实输出，不替调用方判断「算不算对」。
  if (target) {
    output.mount = await target.mountState(session.page);
  }

  try {
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
        usage();
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
