/**
 * 渲染回归：把「主题此刻真实渲染成什么样」与基线 expectations.json 逐项比对。
 *
 * 这是三件事里的第三件：改完样式，判断渲染是否符合预期。
 *
 *   pnpm verify:theme                     # 桌面 + 移动端，跑全部用例
 *   pnpm verify:theme --frontend mobile   # 只跑移动端
 *   pnpm verify:theme --filter menu       # 只跑名字含 menu 的用例
 *   pnpm verify:theme --json              # 结构化输出
 *   pnpm verify:theme --update            # 只更新通过用例的实际值
 *   pnpm verify:theme --baseline          # 把当前渲染写成新基线（谨慎）
 *   pnpm verify:theme --attach            # 复用 pnpm dev 的浏览器
 *
 * 退出码：全部通过 0，有不符 1，跑不起来 2。CI 可以直接靠它卡门禁。
 *
 * 为什么在 iframe 隔离沙箱里量：宿主主题会覆盖 `.b3-menu__item`、`--b3-*` 等
 * 一大批属性，在主文档里量读到的是「宿主 + 本主题」的混合结果，改自己的 CSS
 * 反而看不到变化。沙箱只注入 dev/theme.css，级联与生产一致，且能一次覆盖
 * 多个变体（dark / density / 移动端 backend）而不用真的把思源切来切去。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createSession, parseViewport } from './session.mjs';
import { probeEnvironment } from './probes.mjs';
import { evaluateCase, parseExpectations, toBaselineCase } from './expectations.mjs';
import { findDoubleWrappedColors, measureIsolated } from './sandbox.mjs';
import { judgeMount, readThemeName } from './theme.mjs';

const EXPECTATIONS = './expectations.json';
const CSS_CANDIDATES = ['./dev/theme.css', './dist/theme.css'];
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
    file: takeValue('--expect') ?? EXPECTATIONS,
    css: takeValue('--css'),
    filter: takeValue('--filter'),
    frontend: takeValue('--frontend'),
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

function resolveCssPath(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error('找不到 CSS：' + explicit);
    return explicit;
  }
  const found = CSS_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('找不到 theme.css：先运行 pnpm dev 或 pnpm build');
  return found;
}

function formatChecks(name, checks) {
  const lines = [];
  const failed = checks.filter((check) => !check.ok);
  lines.push(PREFIX + (failed.length ? '✗ ' : '✓ ') + name + '（' + checks.length + ' 项）');
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
  const cssPath = resolveCssPath(options.css);
  const css = readFileSync(cssPath, 'utf8');

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

  // 静态可查的问题先报：这类声明在浏览器里会被静默丢弃，光看渲染值只会看到「没生效」。
  const staticProblems = findDoubleWrappedColors(css).map(
    (problem) =>
      'rgb(var(' + problem.token + ')) 双重包装：' + problem.token + ' 已是完整色值，再包 rgb() 会让整条声明失效'
  );

  const results = [];
  const notes = [];

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
      const mount = judgeMount(environment.themeStyle, readThemeName());

      if (!options.asJson && !options.quiet) {
        console.log(
          PREFIX +
            frontend +
            '：css=' +
            cssPath +
            ' 会话=' +
            environment.opened +
            ' 视口=' +
            session.viewport.width +
            'x' +
            session.viewport.height +
            ' 用例=' +
            cases.length
        );
      }
      // 沙箱不依赖宿主挂的是哪个主题，但「测的是不是本主题」要说清楚。
      if (!mount.ok) {
        notes.push(frontend + ' 前端未挂载本主题（' + (mount.loaded ?? '内置主题') + '），沙箱读数不受影响');
      }

      for (const testCase of cases) {
        const actual = await measureIsolated(session.page, css, {
          tokens: Object.keys(testCase.tokens ?? {}),
          selectors: [...new Set([...(testCase.selectors?.mustHit ?? []), ...(testCase.selectors?.mustMiss ?? [])])],
          attributes: testCase.attributes ?? {},
          probes: (testCase.probes ?? []).map((probe) => ({
            label: probe.label,
            html: probe.html,
            target: probe.target ?? probe.label,
            props: STYLE_PROPS,
          })),
        });
        results.push({
          frontend,
          name: testCase.name,
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
        css: cssPath,
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
      for (const line of formatChecks('[' + result.frontend + '] ' + result.name, result.checks)) console.log(line);
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
    console.log(PREFIX + '结论：全部通过（' + frontends + '，' + results.length + ' 个用例，' + totalChecks + ' 项）');
  }
}

try {
  await main();
} catch (error) {
  console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}
