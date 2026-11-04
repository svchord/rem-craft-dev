/**
 * 渲染回归：把「被测对象此刻真实渲染成什么样」与基线 expectations.json 比对。
 *
 * 主题与插件共用这一套：差异被 targets.mjs 收敛成「CSS 从哪来 + 怎么算加载成功」，
 * 注入沙箱与基线比对完全一样。
 *
 *   pnpm verify:theme                     # 主题，桌面 + 移动端
 *   pnpm verify:theme --frontend mobile   # 只跑移动端
 *   pnpm verify:theme --filter menu       # 只跑名字含 menu 的用例
 *   pnpm verify:theme --json              # 结构化输出
 *   pnpm verify:theme --update            # 只更新通过用例的实际值
 *   pnpm verify:theme --baseline          # 把当前渲染写成新基线（谨慎）
 *   pnpm verify:theme --attach            # 复用 pnpm dev 的浏览器
 *
 *   pnpm verify:plugin arco-calendar      # 审计已装插件（CSS 从页面读）
 *   pnpm verify:plugin arco-calendar --frontend mobile
 *
 * 退出码：全部通过 0，有不符 1，跑不起来 2。CI 可以直接靠它卡门禁。
 *
 * 为什么在 iframe 隔离沙箱里量：宿主主题会覆盖 `.b3-menu__item`、`--b3-*` 等
 * 一大批属性，在主文档里量读到的是「宿主 + 被测对象」的混合结果，改自己的 CSS
 * 反而看不到变化。沙箱只注入被测 CSS，级联与生产一致，且能一次覆盖多个变体
 * （dark / density / 移动端 backend）而不用真的把思源切来切去。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createSession, parseViewport } from './session.mjs';
import { probeEnvironment, probeLive } from './probes.mjs';
import { runActions, snapshotRoot } from './actions.mjs';
import { evaluateCase, parseExpectations, toBaselineCase } from './expectations.mjs';
import { findProblemsIn } from './lints.mjs';
import { pluginTarget, themeTarget } from './targets.mjs';
import { judgeMount, readThemeName } from './theme.mjs';

const PREFIX = '[verify] ';
/** 用到的样式属性固定成一张表：只量关心的，避免整份 computed style 进报告。 */
const STYLE_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-top-width',
  'border-radius',
  'font-size',
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
  'box-shadow',
];

function parseArgs(argv) {
  const rest = [...argv];
  const takeValue = (flag) => {
    const index = rest.indexOf(flag);
    if (index < 0) return null;
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(flag + ' 需要一个参数');
    rest.splice(index, 2);
    return value;
  };

  return {
    file: takeValue('--expect') ?? './expectations.json',
    css: takeValue('--css'),
    filter: takeValue('--filter'),
    frontend: takeValue('--frontend'),
    plugin: takeValue('--plugin'),
    // 显式传 undefined 作为 fallback：没给 --viewport 时不能返回默认值，
    // 否则下面「按前端挑视口」的分支永远进不去。
    viewport: parseViewport(takeValue('--viewport'), undefined),
    asJson: rest.includes('--json'),
    attach: rest.includes('--attach'),
    baseline: rest.includes('--baseline'),
    update: rest.includes('--update'),
    quiet: rest.includes('--quiet'),
  };
}

function formatChecks(result) {
  const lines = [];
  const failed = result.checks.filter((check) => !check.ok);
  // live 用例要把「驱动了什么状态」写进标题：同一元素在不同状态下值不同，
  // 不写状态就不知道这条断言测的是哪个交互。
  const state = result.actions?.length ? ' 动作=' + result.actions.join(' → ') : '';
  lines.push(
    PREFIX +
      (failed.length ? '✗ ' : '✓ ') +
      '[' +
      result.frontend +
      '/' +
      result.mode +
      '] ' +
      result.name +
      '（' +
      result.checks.length +
      ' 项）' +
      state
  );
  for (const check of failed) {
    lines.push(PREFIX + '    不符 ' + check.label);
    lines.push(PREFIX + '      期望 ' + JSON.stringify(check.expected));
    lines.push(PREFIX + '      实际 ' + JSON.stringify(check.actual));
  }
  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const expectations = parseExpectations(readFileSync(options.file, 'utf8'), options.file);

  const target = options.plugin
    ? pluginTarget({ name: options.plugin })
    : themeTarget({ cssPath: options.css, themeName: readThemeName() });

  const allCases = options.filter
    ? expectations.cases.filter((testCase) => testCase.name.includes(options.filter))
    : expectations.cases;
  if (!allCases.length) {
    console.error(PREFIX + '没有匹配的用例' + (options.filter ? '：' + options.filter : ''));
    process.exit(2);
  }

  // 按前端分组：桌面与移动是两个独立构建入口，各自开一次会话。
  const byFrontend = new Map();
  for (const testCase of allCases) {
    const frontend = testCase.frontend ?? 'desktop';
    if (options.frontend && frontend !== options.frontend) continue;
    if (!byFrontend.has(frontend)) byFrontend.set(frontend, []);
    byFrontend.get(frontend).push(testCase);
  }
  if (!byFrontend.size) {
    console.error(PREFIX + '没有 ' + options.frontend + ' 前端的用例');
    process.exit(2);
  }

  const results = [];
  const notes = [];
  const staticProblems = [];
  let cssLabels = [];

  for (const [frontend, cases] of byFrontend) {
    // 视口优先级：命令行 > 该前端第一个写了 viewport 的用例 > 文件级（仅桌面）> 前端预设。
    // 文件级 viewport 是给桌面写的，移动端绝不继承——手机视口错了一切断点都错。
    const caseViewport = cases.find((testCase) => testCase.viewport)?.viewport;
    const spec = caseViewport ?? (frontend === 'mobile' ? null : expectations.viewport);
    const viewport = options.viewport ?? parseViewport(spec, undefined);

    // --attach 连的是 pnpm dev 那个只开了桌面的窗口，里面没有移动端页面。
    // 与其让移动端用例失败，不如明确降级：桌面复用 dev 浏览器，移动端自己开。
    const canAttach = options.attach && frontend === 'desktop';
    if (options.attach && !canAttach) {
      notes.push(frontend + ' 前端不复用 pnpm dev 的浏览器（其中只有桌面页），单独启动');
    }

    const session = await createSession({ frontend, viewport, attach: canAttach });

    try {
      const environment = await probeEnvironment(session.page, session);
      const mount = await target.mountState(session.page);

      if (!options.asJson && !options.quiet) {
        console.log(
          PREFIX +
            target.kind +
            '/' +
            target.name +
            ' ' +
            frontend +
            '：会话=' +
            environment.opened +
            ' 视口=' +
            session.viewport.width +
            'x' +
            session.viewport.height +
            ' 用例=' +
            cases.length
        );
      }
      if (!mount.ok) notes.push(frontend + ' 前端：' + mount.reason);
      else if (mount.reason) notes.push(frontend + ' 前端：' + mount.reason);
      // 主题还要额外确认挂的是不是本主题（插件没有这个歧义）。
      if (target.kind === 'theme' && environment.themeStyle) {
        const judged = judgeMount(environment.themeStyle, target.name);
        if (!judged.ok)
          notes.push(frontend + ' 前端未挂载本主题（' + (judged.loaded ?? '内置主题') + '），沙箱读数不受影响');
      }

      // 插件：面板 DOM 只在打开后存在，需要真实 DOM 的断言必须先激活。
      if (target.activate) await target.activate(session.page);

      // CSS 从磁盘读（主题 dev/theme.css、插件 index.css），不需要页面。
      const sheets = await target.resolveCss();
      if (!sheets.length) {
        // 没有 CSS 时基线里的样式断言会「假通过」：探针插的元素无论如何都有
        // 默认计算值。与其给出一条绿的假结论，不如明确失败并让人换基线。
        const hasStyleAssertions = cases.some((testCase) => (testCase.probes ?? []).length > 0);
        if (hasStyleAssertions) {
          console.error(
            PREFIX +
              '✗ ' +
              target.kind +
              '/' +
              target.name +
              ' 没有可审计的 CSS，但基线里有样式断言——' +
              '这些断言会在默认值上假通过。请换用匹配该目标的基线，或改用 selectors/DOM 断言。'
          );
          process.exit(1);
        }
        notes.push(frontend + ' 前端：' + target.name + ' 没有可审计的 CSS，只做 DOM 断言');
      }
      cssLabels = sheets.map((sheet) => sheet.label);
      for (const problem of findProblemsIn(sheets)) {
        staticProblems.push(
          problem.sheet +
            '：rgb(var(' +
            problem.token +
            ')) 双重包装，' +
            problem.token +
            ' 已是完整色值，再包 rgb() 会让整条声明失效'
        );
      }

      const rootSnapshot = await snapshotRoot(session.page);

      for (const testCase of cases) {
        const selectorList = [
          ...new Set([...(testCase.selectors?.mustHit ?? []), ...(testCase.selectors?.mustMiss ?? [])]),
        ];

        // 两种用例走同一条测量路径：都在真实页面上量。
        // 区别只是 live 用例先用 actions 把页面推到目标状态（hover/菜单/面板），
        // static 用例用 attributes 设 <html> 属性（暗色/密度变体）。
        // 早先用 iframe 隔离是为了挡宿主主题，但 dev 已让思源真正选中本主题，
        // 隔离的前提消失，而 iframe 会漏掉 base.css 的影响。
        let actionLog = [];
        if ((testCase.actions ?? []).length || testCase.attributes) {
          const setup = ['reset'];
          for (const [name, value] of Object.entries(testCase.attributes ?? {})) {
            setup.push('attr:' + name + '=' + value);
          }
          setup.push(...(testCase.actions ?? []));
          actionLog = (await runActions({ page: session.page, rootSnapshot }, setup)).filter(
            (entry) => entry !== 'reset'
          );
        }

        const actual = await probeLive(session.page, {
          tokens: Object.keys(testCase.tokens ?? {}),
          selectors: selectorList,
          // 交互后的状态要按可见性过滤；纯静态探针在视口外，不能过滤。
          requireVisible: (testCase.actions ?? []).length > 0,
          probes: (testCase.probes ?? []).map((probe) => ({
            label: probe.label,
            html: probe.html,
            target: probe.target ?? probe.label,
            // 用例里断言了哪些属性就量哪些：固定表会漏掉表外属性（如 position/z-index），
            // 读成空串后既看不出问题又会让「期望 vs 实际」失真。
            props: [...new Set([...Object.keys(probe.expect), ...STYLE_PROPS])],
          })),
        });
        actual.actions = actionLog;

        results.push({
          frontend,
          mode: (testCase.actions ?? []).length ? 'live' : 'static',
          name: testCase.name,
          actions: actionLog,
          checks: evaluateCase(testCase, actual),
          actual,
        });
      }
    } finally {
      await session.dispose();
    }
  }

  const failedCases = results.filter((result) => result.checks.some((check) => !check.ok));
  const totalChecks = results.reduce((sum, result) => sum + result.checks.length, 0);
  const failedChecks = results.reduce((sum, result) => sum + result.checks.filter((c) => !c.ok).length, 0);

  if (options.baseline || options.update) {
    // 写回时保持文件里已有的用例顺序与结构，只替换实际值。
    const byKey = new Map(results.map((result) => [result.frontend + '/' + result.name, result]));
    const next = {
      ...JSON.parse(readFileSync(options.file, 'utf8')),
      cases: expectations.cases.map((testCase) => {
        const key = (testCase.frontend ?? 'desktop') + '/' + testCase.name;
        const result = byKey.get(key);
        if (!result) return testCase;
        if (options.update && result.checks.some((check) => !check.ok)) return testCase;
        return toBaselineCase(testCase, result.actual);
      }),
    };
    writeFileSync(options.file, JSON.stringify(next, null, 2) + '\n');
    console.log(PREFIX + (options.baseline ? '已重写基线' : '已更新通过用例') + '：' + options.file);
  }

  if (options.asJson) {
    console.log(
      JSON.stringify({
        target: { kind: target.kind, name: target.name, css: cssLabels },
        source: expectations.source,
        staticProblems,
        notes,
        cases: results.map((result) => ({
          frontend: result.frontend,
          name: result.name,
          ok: result.checks.every((check) => check.ok),
          checks: result.checks,
        })),
        total: totalChecks,
        failed: failedChecks,
      })
    );
  } else if (!options.quiet) {
    for (const line of staticProblems) console.log(PREFIX + '✗ ' + line);
    for (const note of notes) console.log(PREFIX + '注：' + note);
    for (const result of results) {
      for (const line of formatChecks(result)) console.log(line);
    }
  }

  if (staticProblems.length || failedCases.length) {
    if (!options.asJson) {
      const parts = [];
      if (staticProblems.length) parts.push('静态检查 ' + staticProblems.length + ' 项');
      if (failedCases.length) {
        parts.push(failedCases.length + '/' + results.length + ' 个用例不符（' + failedChecks + ' 项）');
      }
      console.error(PREFIX + '结论：' + parts.join('，'));
    }
    process.exit(1);
  }

  if (!options.asJson) {
    const frontends = [...new Set(results.map((result) => result.frontend))].join('+');
    console.log(
      PREFIX +
        '结论：全部通过（' +
        target.kind +
        '/' +
        target.name +
        '，' +
        frontends +
        '，' +
        results.length +
        ' 个用例，' +
        totalChecks +
        ' 项）'
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}
