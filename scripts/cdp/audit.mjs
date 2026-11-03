/**
 * 主题契约体检：思源升级后确认「主题挂得上、令牌解析得出、选择器命中」。
 *
 * 注意：`pnpm audit` 是 pnpm 内置的安全审计命令，会盖掉同名脚本，
 * 本工具必须用 `pnpm run audit`（或直接 node 调用）才能跑起来。
 *
 *   pnpm run audit                      # 缺省读 ./dev/theme.css，回退 ./dist/theme.css
 *   pnpm run audit ./dist/theme.css     # 指定产物
 *   pnpm run audit --json               # 结构化输出，便于 CI 消费
 *   pnpm run audit --viewport 1280x764@2
 *   pnpm run audit --attach             # 复用 pnpm dev 的浏览器，窗口尺寸实测
 *   pnpm run audit --do mode:dark       # 先把页面驱动到某状态再体检（可重复）
 *
 * 与 pnpm inspect 的分工：inspect 看单个选择器的计算样式（细节），
 * audit 只看契约整体是否成立（回归），因此输出是清单 + 一行结论。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createSession, parseViewport, runActions } from './session.mjs';
import { parseSelectors, probeEnvironment, probeSelectorHits, probeTokens } from './probes.mjs';

/** dev 是本机构建、dist 是发布构建，按此优先级探测。 */
const CSS_CANDIDATES = ['./dev/theme.css', './dist/theme.css'];
/** 主题目录名取自 manifest；读不到时用发布名兜底，避免挂载判定直接失效。 */
const FALLBACK_THEME_NAME = 'Rem Craft';
/** 暗色专属令牌在亮色模式下必然解析为空，不能当成缺失。 */
const DARK_ONLY = /(data-theme-mode\s*=\s*['"]?dark|prefers-color-scheme:\s*dark)/i;
const STATE_PSEUDO =
  /:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|placeholder-shown|target)\b/;
const STATE_ATTRIBUTE = /\[(data-theme-mode|data-ui-density|data-backend|data-frontend|data-rc-|custom-rc-)/;
/** 契约齐全的主题有上百个令牌，逐条打印会淹没结论；缺失项始终全列。 */
const TOKEN_VALUE_LINES = 40;

function parseArgs(argv) {
  const rest = [...argv];
  const takeValues = (flag) => {
    const values = [];
    let index = rest.indexOf(flag);
    while (index >= 0) {
      const candidate = rest[index + 1];
      if (candidate === undefined || candidate.startsWith('--')) throw new Error(flag + ' 需要一个参数');
      values.push(candidate);
      rest.splice(index, 2);
      index = rest.indexOf(flag);
    }
    return values;
  };

  // 先把带值的选项摘掉，否则 --do 的取值会被当成位置参数（CSS 路径）。
  const viewport = takeValues('--viewport')[0];
  // 与 inspect 一致支持逗号分隔；但 css: 的样式表本身含逗号，只能整段当一个动作。
  const actions = takeValues('--do').flatMap((value) =>
    value.startsWith('css:')
      ? [value]
      : value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
  );

  return {
    css: rest.find((arg) => !arg.startsWith('--')) ?? null,
    asJson: rest.includes('--json'),
    attach: rest.includes('--attach'),
    viewport: parseViewport(viewport),
    actions,
  };
}

function resolveCssPath(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error('找不到 CSS：' + explicit);
    return explicit;
  }
  const found = CSS_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('找不到 theme.css：先运行 pnpm build 或 pnpm dev');
  return found;
}

/** 去掉注释，避免注释里的示例令牌被当成真实定义或引用。 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 抽出令牌定义及其所在规则的选择器。
 * 记录选择器是为了把「暗色专属令牌在亮色模式下为空」和真正的缺失区分开。
 */
function collectDefinitions(css) {
  const definitions = new Map();
  for (const rule of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    // @media 等 at-rule 的外层块不含声明，内层规则会单独命中。
    if (!selector || selector.startsWith('@')) continue;
    for (const declaration of rule[2].matchAll(/(--[\w-]+)\s*:/g)) {
      const name = declaration[1];
      const owners = definitions.get(name) ?? [];
      if (!owners.includes(selector)) owners.push(selector);
      definitions.set(name, owners);
    }
  }
  return definitions;
}

/** 引用了却没定义，通常是改名后的漏改，属于静态就能查出的失效信号。 */
function collectReferences(css) {
  return new Set([...stripComments(css).matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
}

/** querySelectorAll 不接受伪元素，这类选择器只能跳过，记成 invalid 会污染报告。 */
const isPseudoElement = (selector) => /::/.test(selector) || /:(before|after|first-line|first-letter)\b/.test(selector);

/** 带状态钩子的选择器默认状态不命中是正常的，用于区分真失效与「需要先进入某状态」。 */
const isStateDependent = (selector) => STATE_PSEUDO.test(selector) || STATE_ATTRIBUTE.test(selector);

function readThemeName() {
  for (const file of ['./public/theme.json', './dist/theme.json']) {
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (name) return String(name).trim();
    } catch {
      // 继续下一个候选
    }
  }
  return FALLBACK_THEME_NAME;
}

/** 目录名与 manifest 的 name 一致；比较时忽略大小写与空格/连字符的写法差异。 */
const normalizeThemeName = (name) => name.toLowerCase().replace(/[\s_-]+/g, '');

function judgeMount(href, themeName) {
  if (!href) {
    return { ok: false, exact: false, loaded: null, reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）' };
  }

  const segment = href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
  if (!segment) {
    return { ok: false, exact: false, loaded: null, reason: 'themeStyle 的 href 不是主题目录路径：' + href };
  }

  const loaded = decodeURIComponent(segment);
  const expected = normalizeThemeName(themeName);
  const actual = normalizeThemeName(loaded);
  // 允许前缀匹配：装了发布版 `Rem Craft` 而本地目录叫 `Rem Craft Dev` 时仍是本主题，
  // 但要把「测的不是 dev 目录」讲清楚，否则回归结论会被张冠李戴。
  const exact = actual === expected;
  const ok =
    exact ||
    (actual.length >= 4 && expected.startsWith(actual)) ||
    (expected.length >= 4 && actual.startsWith(expected));

  return { ok, exact, loaded, reason: ok ? null : '宿主加载的是 ' + loaded + '，不是 ' + themeName };
}

function buildVerdict(report, unexpectedMissing) {
  const problems = [];
  if (!report.mount.ok) problems.push('主题未挂载（宿主 ' + (report.environment.hostThemeLight ?? '未知') + '）');
  else if (report.tokens.defined > 0 && unexpectedMissing.length === report.tokens.defined) {
    problems.push('主题已挂载但 --rc-* 令牌全部为空（主题目录可能是空的）');
  }

  // 令牌数量始终报：CI 里要能一眼看出「少了几个」，缺失项明细在正文清单里。
  if (unexpectedMissing.length) problems.push('令牌缺失 ' + unexpectedMissing.length + ' 个');

  const realMisses = report.selectors.misses.filter((miss) => !miss.stateDependent);
  const stateMisses = report.selectors.misses.length - realMisses.length;
  if (realMisses.length) {
    problems.push(
      '选择器 miss ' + realMisses.length + ' 个' + (stateMisses ? '（另有 ' + stateMisses + ' 个状态依赖）' : '')
    );
  }
  if (report.selectors.invalid.length) problems.push('非法选择器 ' + report.selectors.invalid.length + ' 个');
  if (report.tokens.undefinedRefs.length)
    problems.push('引用了未定义的令牌 ' + report.tokens.undefinedRefs.length + ' 个');
  // 主题挂载后 --b3-* 仍为空，说明 l2-bridge 没生效；未挂载时为空是宿主的正常状态，不算问题。
  if (report.mount.ok && report.bridge.empty.length) {
    problems.push('桥接令牌未生效 ' + report.bridge.empty.length + ' 个（l2-bridge）');
  }
  // 未挂载时契约版本必然为空，重复报警只会淹没真正的原因。
  if (report.mount.ok && !report.contractVersion) {
    problems.push('--rc-contract-version 缺失（插件无法做启动兼容检测，见 architecture.md §6.1）');
  }

  return problems.length ? problems.join('；') : '通过：主题已挂载，令牌与选择器均正常';
}

function formatReport(report) {
  const lines = [];
  const { environment: env, axes, tokens, bridge, selectors: sel } = report;
  const viewport = report.viewport;

  lines.push(
    '[audit] css=' +
      report.css +
      ' 会话=' +
      report.opened +
      ' 视口=' +
      viewport.width +
      'x' +
      viewport.height +
      '@' +
      viewport.deviceScaleFactor +
      (report.actions.length ? ' 动作=' + report.actions.join(' -> ') : '')
  );
  lines.push(
    '[audit] 环境：frontend=' +
      (env.frontend ?? '(空)') +
      ' data-theme-mode=' +
      (env.themeMode ?? '(空)') +
      ' themeLight=' +
      (env.hostThemeLight ?? '(空)') +
      ' domNodes=' +
      env.domNodes
  );
  lines.push(
    '[audit] 挂载：' +
      (report.mount.ok ? '✓ ' : '✗ ') +
      (env.themeStyle ?? '(没有 themeStyle)') +
      (report.mount.ok ? '' : '（期望 ' + report.mount.expected + '；' + report.mount.reason + '）')
  );
  // --attach 在没有 dev 会话时会静默改成新开浏览器，不说明就会误以为测的是自己那个窗口。
  if (report.attachRequested && !report.attached) {
    lines.push('[audit] 警告：要求 --attach 但没找到 .rc-cdp-ws，已改为新开浏览器（pnpm dev 是否在运行？）');
  }
  if (!report.mount.ok) {
    lines.push('[audit] 警告：本主题未挂载，下面的令牌与选择器数据反映宿主状态，不能当成本主题的回归基线');
  } else if (!report.mount.exact) {
    lines.push(
      '[audit] 警告：加载的是 ' +
        report.mount.loaded +
        '，与期望的 ' +
        report.mount.expected +
        ' 不完全一致（测的可能不是当前源码构建）'
    );
  }
  lines.push(
    '[audit] 两轴：data-rc-style=' +
      (axes.style ?? '(缺省 material)') +
      ' data-rc-palette=' +
      (axes.palette ?? '(缺省 material)') +
      ' data-rc-custom=' +
      (axes.custom ?? '(未设置)')
  );
  lines.push(
    '[audit] 变体：data-ui-density=' +
      (env.density ?? '(缺省)') +
      ' 特性属性=' +
      (report.featureAttributes.length
        ? report.featureAttributes.map(([name, value]) => name + '=' + value).join(' ')
        : '(无)')
  );
  // 思源会在运行时把 data-ui-density 摘掉（实测：写入后 ~1s 内消失），
  // 所以密度变体只能靠 inspect --do density:compact 现场量，不能指望 audit 的静态快照。
  if (report.actions.some((action) => action.startsWith('density ')) && !env.density) {
    lines.push('[audit] 注：density 动作已被思源运行时还原，密度变体需用 pnpm inspect --do density:compact 现场量');
  }
  lines.push(
    '[audit] 契约：--rc-contract-version=' +
      (report.contractVersion ??
        (report.contractVersionDefined ? '(源码已定义但解析为空)' : '(源码未定义，见 architecture.md §6.1)'))
  );

  lines.push(
    '[audit] 令牌：源码定义 ' +
      tokens.defined +
      ' 个 --rc-*，解析成功 ' +
      (tokens.defined - tokens.missing.length) +
      '，缺失 ' +
      tokens.missing.length +
      (tokens.darkOnly.length ? '（其中 ' + tokens.darkOnly.length + ' 个暗色专属，亮色模式下为空属正常）' : '')
  );
  for (const name of tokens.definedNames.slice(0, TOKEN_VALUE_LINES)) {
    const value = tokens.resolved[name];
    lines.push(
      '[audit]   ' +
        (value ? name + ' = ' + value : '缺失 ' + name + (tokens.darkOnly.includes(name) ? '（暗色专属）' : ''))
    );
  }
  if (tokens.definedNames.length > TOKEN_VALUE_LINES) {
    const rest = tokens.definedNames.slice(TOKEN_VALUE_LINES);
    const restMissing = rest.filter((name) => !tokens.resolved[name]);
    lines.push(
      '[audit]   …其余 ' +
        rest.length +
        ' 个令牌略（缺失 ' +
        restMissing.length +
        ' 个' +
        (restMissing.length ? '：' + restMissing.join(' ') : '') +
        '；完整清单见 --json）'
    );
  }
  if (tokens.undefinedRefs.length) {
    lines.push('[audit] 引用但源码未定义：' + tokens.undefinedRefs.join(' ') + '（可能由插件运行时提供）');
  }

  lines.push(
    '[audit] 桥接：源码定义 ' +
      bridge.defined.length +
      ' 个 --b3-*，浏览器解析非空 ' +
      (bridge.defined.length - bridge.empty.length) +
      (report.mount.ok ? '' : '（主题未挂载，这些值来自思源 base.css，不能证明桥接生效）')
  );
  for (const name of bridge.defined) {
    const value = bridge.resolved[name];
    lines.push('[audit]   ' + (value ? name + ' = ' + value : '空 ' + name));
  }

  lines.push(
    '[audit] 选择器：共 ' +
      sel.total +
      ' 个' +
      (sel.skipped.length ? '（跳过伪元素 ' + sel.skipped.length + ' 个）' : '') +
      '，hit ' +
      sel.hits.length +
      ' / miss ' +
      sel.misses.length +
      ' / invalid ' +
      sel.invalid.length
  );
  for (const hit of sel.hits) lines.push('[audit]   hit  ' + hit.count + 'x ' + hit.selector);
  for (const miss of sel.misses) {
    lines.push('[audit]   miss ' + (miss.stateDependent ? '[状态依赖] ' : '') + miss.selector);
  }
  for (const selector of sel.invalid) lines.push('[audit]   invalid ' + selector);
  if (sel.misses.some((miss) => !miss.stateDependent)) {
    lines.push('[audit]   注：非状态依赖的 miss 也可能取决于 UI 状态（如菜单未展开），需结合 inspect 复核');
  }

  lines.push('[audit] 结论：' + report.verdict);
  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cssPath = resolveCssPath(options.css);
  const css = readFileSync(cssPath, 'utf8');

  const definitions = collectDefinitions(css);
  const rcDefined = [...definitions.keys()].filter((name) => name.startsWith('--rc-'));
  const b3Defined = [...definitions.keys()].filter((name) => name.startsWith('--b3-'));
  const allSelectors = parseSelectors(css);
  const skippedSelectors = allSelectors.filter(isPseudoElement);
  const probeableSelectors = allSelectors.filter((selector) => !isPseudoElement(selector));
  const undefinedRefs = [...collectReferences(css)].filter((name) => !definitions.has(name));

  const session = await createSession({ viewport: options.viewport, attach: options.attach });
  try {
    // 先驱动状态再体检：暗色令牌、密度变体等只有进入对应状态才解析得出。
    const appliedActions = options.actions.length ? await runActions(session, options.actions) : [];
    const environment = await probeEnvironment(session.page, session);
    // 契约版本由语义层定义；源码里还没有时也要读，才能区分「未实现」与「已实现但没生效」。
    const tokenValues = await probeTokens(session.page, [...rcDefined, '--rc-contract-version']);
    const bridgeValues = await probeTokens(session.page, b3Defined);
    const selectorHits = await probeSelectorHits(session.page, probeableSelectors);

    const themeName = readThemeName();
    const mount = judgeMount(environment.href, themeName);
    const missing = rcDefined.filter((name) => !tokenValues[name]);
    const darkOnly = missing.filter((name) => definitions.get(name).every((selector) => DARK_ONLY.test(selector)));
    const unexpectedMissing = missing.filter((name) => !darkOnly.includes(name));
    const resolved = Object.fromEntries(rcDefined.map((name) => [name, tokenValues[name]]));

    const report = {
      css: cssPath,
      opened: environment.opened,
      attachRequested: options.attach,
      attached: environment.opened === 'attached',
      viewport: session.viewport,
      actions: appliedActions,
      environment: {
        frontend: environment.frontend,
        themeMode: environment.themeMode,
        density: environment.density,
        hostThemeLight: environment.theme,
        themeStyle: environment.href,
        domNodes: environment.domNodes,
      },
      mount: { ok: mount.ok, exact: mount.exact, expected: themeName, loaded: mount.loaded, reason: mount.reason },
      axes: {
        style: environment.rcStyle,
        palette: environment.rcPalette,
        custom: environment.rcCustom,
      },
      featureAttributes: Object.entries(environment.features).filter(
        ([name]) => !['data-rc-style', 'data-rc-palette', 'data-rc-custom'].includes(name)
      ),
      contractVersion: tokenValues['--rc-contract-version'] || null,
      contractVersionDefined: definitions.has('--rc-contract-version'),
      tokens: {
        defined: rcDefined.length,
        definedNames: rcDefined,
        resolved,
        missing,
        darkOnly,
        undefinedRefs,
      },
      bridge: {
        defined: b3Defined,
        resolved: bridgeValues,
        empty: b3Defined.filter((name) => !bridgeValues[name]),
      },
      selectors: {
        total: allSelectors.length,
        skipped: skippedSelectors,
        hits: selectorHits.hits.map(([selector, count]) => ({ selector, count })),
        misses: selectorHits.misses.map(([selector]) => ({ selector, stateDependent: isStateDependent(selector) })),
        invalid: selectorHits.invalid.map(([selector]) => selector),
      },
      verdict: '',
    };
    report.verdict = buildVerdict(report, unexpectedMissing);

    if (options.asJson) console.log(JSON.stringify(report));
    else for (const line of formatReport(report)) console.log(line);
  } finally {
    await session.dispose();
  }
}

try {
  await main();
} catch (error) {
  console.error('[audit] ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
