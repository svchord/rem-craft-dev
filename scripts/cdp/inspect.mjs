/**
 * 在真实思源前端里测量主题的渲染结果。
 *
 * 本文件只是 CLI 层：解析参数 -> 调用 session/probes -> 格式化输出。浏览器生命周期在
 * session.mjs，读数在 probes.mjs；加能力请改那两层，不要在这里内联。
 *
 * 选择器（位置参数，可多个；缺省为主题关键节点）：
 *   pnpm inspect
 *   pnpm inspect '.b3-menu__item' '.protyle-wysiwyg'
 *
 * 动作（--do 可重复，逗号分隔；动词见 session.mjs 的 runActions）：
 *   --do style:fluent          切换视觉风格轴
 *   --do palette:shadcn        切换配色轴
 *   --do mode:dark,wait:300    切明暗后等过渡结束
 *   --do 'css:.b3-menu__item{outline:1px solid red}'   注入临时样式（不进产物）
 *     注意：逗号是动作分隔符，因此 css 取值里不能带逗号；需要多属性时用多次 --do。
 *
 * 测量项：
 *   --rules            列出命中该元素的 CSS 规则与来源样式表
 *   --all              每个选择器最多取 5 个匹配元素，而不是首个
 *   --token <name>     解析令牌的真实取值，可重复，例如 --token --rc-brand-8
 *
 * 环境与输出：
 *   --json               结构化输出，便于脚本消费
 *   --shot               整页截图到 ./inspect.png
 *   --viewport WxH[@DPR] 视口，例如 1280x764@2
 *   --attach             复用 pnpm dev 暴露的浏览器，而不是新开无头窗口
 *
 * 例子：
 *   pnpm inspect '.b3-menu__item' --rules
 *   pnpm inspect --do style:fluent --token --rc-brand-8 --token --rc-surface-base
 *   pnpm inspect --do mode:dark,mode:light --viewport 1280x764@2 --shot --json
 */
import { createSession, parseViewport, runActions } from './session.mjs';
import { probeEnvironment, probeRules, probeStyles, probeTokens } from './probes.mjs';

const PREFIX = '[inspect] ';
const DEFAULT_SELECTORS = [
  '.b3-menu__item',
  '.b3-menu__separator',
  '.protyle-wysiwyg',
  '.dock__item',
  '.layout-tab-bar',
];
const BOOLEAN_FLAGS = ['--rules', '--all', '--json', '--shot', '--attach'];
const VALUE_FLAGS = ['--do', '--viewport', '--token'];
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

/**
 * 拆出 `--flag value` 形式的选项，其余留给位置参数。
 *
 * 令牌名本身以 `--` 开头（`--rc-brand-8`），所以 `--token` 是唯一允许取值形如 `--x` 的选项；
 * 但真正的开关仍要判缺参，否则 `--token --json` 会被静默吃成令牌名。
 */
function takeOptions(args) {
  const values = {};
  const rest = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!VALUE_FLAGS.includes(arg)) {
      rest.push(arg);
      continue;
    }

    const value = args[index + 1];
    const absent = value === undefined || (value.startsWith('--') && KNOWN_FLAGS.has(value));
    if (absent || (arg !== '--token' && value.startsWith('--'))) {
      throw new Error(arg + ' 需要一个参数');
    }
    (values[arg] ??= []).push(value);
    index += 1;
  }

  return { values, rest };
}

function parseArgs(argv) {
  const { values, rest } = takeOptions(argv);
  const flags = new Set(rest.filter((arg) => arg.startsWith('--')));

  // 拼错的选项静默变成选择器会误导读数，直接报错。
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) throw new Error('未知选项：' + flag);
  }

  // css: 的样式表本身常含逗号（rgba(0,0,0,.5)、font-family 列表），不能按逗号拆，
  // 否则一段合法的注入样式会被切成多个「未知动作」。与 audit.mjs 保持一致。
  const actions = (values['--do'] ?? []).flatMap((value) =>
    value.startsWith('css:')
      ? [value]
      : value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
  );

  return {
    selectors: rest.filter((arg) => !arg.startsWith('--')),
    actions,
    tokens: values['--token'] ?? [],
    viewport: parseViewport(values['--viewport']?.[0]),
    asJson: flags.has('--json'),
    includeRules: flags.has('--rules'),
    includeAll: flags.has('--all'),
    shot: flags.has('--shot'),
    attach: flags.has('--attach'),
  };
}

function formatStyles(result) {
  if (!result.count) return [result.selector + ' (未命中)'];
  return result.items.map((item) => {
    const values = Object.entries(item.props)
      .map(([name, value]) => name + '=' + value)
      .join(' ');
    return result.selector + ' (' + result.count + 'x) <' + item.tag + '> ' + values;
  });
}

function formatRules(rules) {
  return rules.map((rule) => '    [' + rule.source + '] ' + rule.selector + ' { ' + rule.properties.join('; ') + ' }');
}

/**
 * 空串即未定义：probeTokens 读的是计算样式，未定义的令牌在 Chrome 里就是空串。
 * 宿主主题不是本主题时，`--rc-*` 全为空是正确读数，不是故障。
 */
function formatTokens(tokens) {
  return Object.entries(tokens).map(([token, value]) => token + ' = ' + (value || '(未定义)'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = await createSession({ viewport: options.viewport, attach: options.attach });

  try {
    const actions = await runActions(session, options.actions);
    const env = await probeEnvironment(session.page, session);

    const targets = options.selectors.length ? options.selectors : DEFAULT_SELECTORS;
    const selectors = [];
    for (const selector of targets) {
      const result = await probeStyles(session.page, selector, options.includeAll ? 5 : 1);
      if (options.includeRules && result.count) {
        result.rules = await probeRules(env.client, env.document.root.nodeId, selector, env.sheets);
      }
      selectors.push(result);
    }

    const tokens = options.tokens.length ? await probeTokens(session.page, options.tokens) : null;

    const report = {
      opened: env.opened,
      theme: env.theme,
      mode: env.mode,
      actions,
      viewport: session.viewport,
      injected: options.actions.filter((action) => action.startsWith('css:')).map((action) => action.slice(4)),
      selectors,
      ...(tokens ? { tokens } : {}),
    };

    if (options.asJson) {
      console.log(JSON.stringify(report));
    } else {
      const print = (line) => console.log(PREFIX + line);
      print('theme=' + env.theme + ' mode=' + env.mode + ' opened=' + env.opened + ' href=' + (env.href || '(无)'));
      print(
        'style=' +
          (env.rcStyle || '(未设置)') +
          ' palette=' +
          (env.rcPalette || '(未设置)') +
          ' viewport=' +
          report.viewport.width +
          'x' +
          report.viewport.height +
          '@' +
          report.viewport.deviceScaleFactor
      );
      // runActions 的日志条目本身已含 `动词 -> 取值`，再用 `->` 连接会读成一条链。
      if (actions.length) print('actions: ' + actions.join(', '));

      for (const result of selectors) {
        for (const line of formatStyles(result)) print(line);
        for (const line of formatRules(result.rules ?? [])) print(line);
      }

      if (tokens) {
        for (const line of formatTokens(tokens)) print(line);
      }
    }

    if (options.shot) {
      await session.page.screenshot({ path: './inspect.png' });
      console.log(PREFIX + 'screenshot: ./inspect.png');
    }
  } finally {
    await session.dispose();
  }
}

try {
  await main();
} catch (error) {
  console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
