/**
 * 测量 CLI：把 measure.mjs 的原语暴露成命令行，供 agent 按需组合。
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
 *
 * 通用选项：
 *   --frontend desktop|mobile   缺省 desktop
 *   --viewport 390x844@3
 *   --do <action>               驱动交互（可重复，见 actions.mjs）
 *   --css <path>                被测 CSS（缺省 dev/theme.css，回退 dist/）
 *   --plugin <name>             被测插件（读 index.css）
 *   --attach                    复用 pnpm dev / siyuan-open --attach 的浏览器
 *   --json                      结构化输出
 *   --props a,b,c               要读的样式属性
 *
 * 例子（agent 按任务临时组合，不需要改工具）：
 *   siyuan-measure tokens --rc-text-primary --rc-bg-page
 *   siyuan-measure styles .b3-menu__item --props color,background-color
 *   siyuan-measure diff .b3-menu__item --do contextmenu:.b3-list-item --do hover:.b3-menu__item
 *   siyuan-measure box .dock__item --frontend mobile
 *   siyuan-measure count .b3-menu__item .dock__item --do click:.dock__item[data-type=file]
 *
 * 退出码：成功 0，参数/运行错误 2。
 */
import { createSession, parseViewport } from './session.mjs';
import { runActions, snapshotRoot } from './actions.mjs';
import { contrastRatio } from './color.mjs';
import { diffAfter, elementBox, elementStyles, environment, probeHtml, selectorCounts, tokens } from './measure.mjs';
import { createTarget } from './targets.mjs';
import { detectTargetType } from './target-types.mjs';

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

/**
 * 逐项摘出选项，其余是位置参数。
 *
 * 特殊处理：令牌名本身以 `--` 开头（`--rc-brand-8`），不能当成选项。
 * 所以先认「已知选项」，其余以 `--` 开头的都算位置参数。
 */
const KNOWN_FLAGS = new Set([
  '--frontend',
  '--viewport',
  '--do',
  '--setup',
  '--css',
  '--plugin',
  '--kind',
  '--props',
  '--limit',
]);
const BOOLEAN_FLAGS = new Set(['--attach', '--json']);

function parseArgs(argv) {
  const values = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (BOOLEAN_FLAGS.has(arg)) {
      (values[arg] ??= []).push(true);
      continue;
    }

    if (!KNOWN_FLAGS.has(arg)) {
      // 未知的 --xxx 当作位置参数（令牌名就是这种形状）
      positional.push(arg);
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined) throw new Error(arg + ' 需要一个参数');
    (values[arg] ??= []).push(next);
    index += 1;
  }

  return { values, positional };
}

const flag = (values, name) => values['--' + name]?.at(-1);
const list = (values, name) => (values['--' + name] ?? []).filter((v) => v !== true);

function usage() {
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
      '',
      '通用选项：--kind --frontend --viewport --do --setup --css --plugin --attach --json --props',
    ].join('\n')
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const { values, positional } = parseArgs(argv.slice(1));
  const args = positional;

  if (!command || command === 'help') {
    usage();
    process.exit(command ? 0 : 2);
  }

  const frontend = flag(values, 'frontend') ?? 'desktop';
  const viewport =
    parseViewport(flag(values, 'viewport'), undefined) ??
    parseViewport(frontend === 'mobile' ? '390x844@3' : '1600x1000@1', undefined);
  const asJson = values['--json']?.includes(true);
  const props =
    flag(values, 'props')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? DEFAULT_PROPS;
  const actions = list(values, 'do');
  const setupActions = list(values, 'setup');
  const kindFlag = flag(values, 'kind');
  const pluginName = flag(values, 'plugin');
  const cssPath = flag(values, 'css');

  // 目标类型：--kind 优先；兼容旧的 --plugin / --css 写法。
  // 都没给就按「当前目录是哪种项目」推断，推断不出则只量页面不绑定目标。
  const kind = kindFlag ?? (pluginName ? 'plugin' : cssPath ? 'theme' : null);
  let target = null;
  if (kind) {
    target = createTarget(kind, { name: pluginName ?? undefined, cssPath: cssPath ?? undefined });
  } else {
    const detected = detectTargetType(process.cwd());
    if (detected.ok) {
      try {
        target = createTarget(detected.kind, { cssPath: cssPath ?? undefined });
      } catch {
        // 清单里没有 name 也不该挡住纯页面测量
      }
    }
  }

  const session = await createSession({ frontend, viewport, attach: values['--attach']?.includes(true) });
  const output = {
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
        if (!args.length) throw new Error('styles 需要一个选择器');
        output.styles = await elementStyles(session.page, args[0], props);
        break;
      }

      case 'count': {
        if (!args.length) throw new Error('count 需要至少一个选择器');
        output.counts = await selectorCounts(session.page, args);
        break;
      }

      case 'box': {
        if (!args.length) throw new Error('box 需要一个选择器');
        output.boxes = await elementBox(session.page, args[0], Number(flag(values, 'limit') ?? 5));
        break;
      }

      case 'probe': {
        if (args.length < 2) throw new Error('probe 需要 <html> <target>');
        output.probe = await probeHtml(session.page, { html: args[0], target: args[1], props });
        break;
      }

      case 'diff': {
        // 语义：--setup 先把页面带到目标场景（如打开菜单），--do 是「相对基线要做的动作」。
        // 没有 --setup 时，--do 就是全部动作，但那样元素可能还不存在（菜单项就是）。
        if (!args.length) throw new Error('diff 需要一个选择器');
        if (!actions.length) throw new Error('diff 需要 --do 指定要执行的交互');
        const rootSnapshot = await snapshotRoot(session.page);

        // 1) 复位 + 执行 setup，建立可测量的基线场景
        await runActions({ page: session.page, rootSnapshot }, ['reset', ...setupActions]);

        // 2) 读基线 → 执行 --do 动作 → 读结果
        //    注意：run 里不能再 reset，否则 setup 打开的菜单会被关掉。
        output.diff = await diffAfter(session.page, {
          selector: args[0],
          props,
          run: async (page) => runActions({ page, rootSnapshot }, actions),
        });
        if (setupActions.length) output.setup = setupActions;
        break;
      }

      case 'contrast': {
        // 便捷：直接算两个令牌（或两个颜色值）的对比度
        if (args.length < 2) throw new Error('contrast 需要 <前景> <背景>（令牌名或颜色值）');
        const resolve = async (input) => {
          if (input.startsWith('--')) return (await tokens(session.page, [input]))[input];
          return input;
        };
        const fg = await resolve(args[0]);
        const bg = await resolve(args[1]);
        output.contrast = { foreground: fg, background: bg, ratio: contrastRatio(fg, bg) };
        break;
      }

      default:
        usage();
        throw new Error('未知子命令：' + command);
    }
  } finally {
    await session.dispose();
  }

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 人读格式：尽量紧凑，字段名对齐
  const pad = (text, width) => String(text).padEnd(width);

  // 只在没挂上时提醒，正常情况不打扰。
  if (output.mount && !output.mount.ok) {
    console.log(PREFIX + '注意：' + output.target?.kind + ' 未挂载 — ' + (output.mount.reason ?? '未知原因'));
  }

  if (output.environment) {
    const env = output.environment;
    console.log(
      PREFIX + '前端=' + (env.frontend ?? '?') + ' 后端=' + (env.backend ?? '?') + ' 模式=' + (env.themeMode ?? '?')
    );
    console.log(
      PREFIX +
        '视口=' +
        env.viewport.width +
        'x' +
        env.viewport.height +
        '@' +
        env.viewport.dpr +
        ' DOM节点=' +
        env.domNodes
    );
    console.log(PREFIX + 'themeStyle=' + (env.themeStyle ?? '(无)'));
  }

  if (output.tokens) {
    const width = Math.max(...Object.keys(output.tokens).map((k) => k.length));
    for (const [name, value] of Object.entries(output.tokens)) {
      console.log(PREFIX + pad(name, width) + '  ' + (value || '(空)'));
    }
  }

  if (output.styles) {
    const s = output.styles;
    if (!s.found) {
      console.log(PREFIX + '未找到元素');
    } else {
      console.log(
        PREFIX +
          s.tag +
          (s.className ? '.' + s.className.split(' ')[0] : '') +
          '（共 ' +
          s.count +
          ' 个，可见 ' +
          s.visible +
          '）'
      );
      for (const [prop, value] of Object.entries(s.styles)) {
        if (!value) continue;
        console.log('  ' + pad(prop, 18) + value);
      }
    }
  }

  if (output.counts) {
    const width = Math.max(...Object.keys(output.counts).map((k) => k.length));
    for (const [sel, info] of Object.entries(output.counts)) {
      console.log(PREFIX + pad(sel, width) + '  总数=' + info.total + ' 可见=' + info.visible);
    }
  }

  if (output.boxes) {
    if (!output.boxes.length) {
      // 空结果是正常读数（比如移动端没有 .dock__item），必须明说，
      // 否则会被误当成「命令没跑」。
      console.log(PREFIX + '没有可见的匹配元素（选择器可能不适用于 ' + frontend + ' 端）');
    }
    for (const box of output.boxes) {
      console.log(
        PREFIX +
          '[' +
          box.index +
          '] ' +
          box.tag +
          '.' +
          (box.className.split(' ')[0] || '') +
          '  ' +
          box.width +
          '×' +
          box.height +
          '  @(' +
          box.x +
          ',' +
          box.y +
          ')'
      );
    }
  }

  if (output.probe) {
    if (!output.probe.found) {
      console.log(PREFIX + '探针里没有匹配元素');
    } else {
      for (const [prop, value] of Object.entries(output.probe.styles)) {
        if (!value) continue;
        console.log('  ' + pad(prop, 18) + value);
      }
    }
  }

  if (output.diff) {
    const d = output.diff;
    if (!d.found) {
      console.log(PREFIX + '未找到元素');
    } else if (!Object.keys(d.changed).length) {
      console.log(PREFIX + '无变化');
    } else {
      for (const [prop, change] of Object.entries(d.changed)) {
        console.log('  ' + pad(prop, 18) + change.from + ' → ' + change.to);
      }
    }
  }

  if (output.contrast) {
    const c = output.contrast;
    console.log(
      PREFIX +
        (c.foreground || '(空)') +
        ' on ' +
        (c.background || '(空)') +
        ' = ' +
        (c.ratio === null ? '解析失败' : c.ratio + ':1')
    );
  }
}

/** 供 bin/ 与测试调用；不在模块顶层自动执行，便于被 import。 */
export async function runMeasureCli() {
  try {
    await main();
  } catch (error) {
    console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
