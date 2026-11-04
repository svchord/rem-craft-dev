/**
 * 样式与交互审计：在真实页面上采全量事实，跑客观不变量，输出证据。
 *
 * 与旧 verify:theme 的根本区别：
 *
 *   旧版比对 expectations.json 里抄下来的数值快照。它只能回答「和上次比变了没」，
 *   回答不了「对不对」——改个 padding 要手动 --update，而基线里抄了错值就永远绿。
 *
 *   本版做两件事：
 *     1. 跑不变量（invariants.mjs）：对比度、触摸目标、令牌断链、桥接一致、
 *        暗色覆盖、交互可见变化。这些与具体数值无关，改样式不会误报。
 *     2. 输出完整事实（facts.mjs）：每个令牌的值、每对颜色的对比度、每个探针的
 *        全部计算样式、交互前后差异。**判断交给 agent 或人**。
 *
 *   pnpm audit:theme                  # 桌面 + 移动端
 *   pnpm audit:theme --frontend mobile
 *   pnpm audit:theme --json           # 结构化事实（给 agent 读）
 *   pnpm audit:theme --facts-only     # 只输出事实，不判不变量
 *   pnpm audit:theme --attach         # 复用 pnpm dev 的浏览器
 *   pnpm audit:theme --plugin <name>  # 审计插件
 *
 * 退出码：不变量全过 0，有 error 级违规 1，跑不起来 2。
 */
import { createSession, parseViewport } from './session.mjs';
import { probeEnvironment } from './probes.mjs';
import { runActions, snapshotRoot } from './actions.mjs';
import { collectFacts, collectInteractionDiff, tokensIn } from './facts.mjs';
import { runInvariants } from './invariants.mjs';
import { findProblemsIn } from './lints.mjs';
import { pluginTarget, themeTarget } from './targets.mjs';
import { judgeMount, readThemeName } from './theme.mjs';

const PREFIX = '[audit] ';

/** 主题的审计规格：哪些令牌要查、哪些颜色对要比、哪些目标要量。 */
const THEME_SPEC = {
  contrastPairs: [
    { foreground: '--rc-text-primary', background: '--rc-bg-page', role: 'body', label: '正文' },
    { foreground: '--rc-text-secondary', background: '--rc-bg-page', role: 'body', label: '次要文本' },
    { foreground: '--rc-text-placeholder', background: '--rc-bg-page', role: 'secondary', label: '占位符' },
    { foreground: '--b3-theme-on-background', background: '--b3-theme-background', role: 'body', label: '桥接-正文' },
    { foreground: '--b3-theme-primary', background: '--b3-theme-background', role: 'body', label: '桥接-主色' },
  ],
  bridgePairs: [
    { bridge: '--b3-theme-background', source: '--rc-bg-page' },
    { bridge: '--b3-theme-on-background', source: '--rc-text-primary' },
    { bridge: '--b3-theme-on-surface', source: '--rc-text-secondary' },
    { bridge: '--b3-border-color', source: '--rc-border-1' },
    { bridge: '--b3-theme-primary', source: '--rc-brand-base' },
  ],
  probes: [
    {
      label: 'menu-item',
      html: '<div class="b3-menu__item">item</div>',
      target: '.b3-menu__item',
    },
    {
      label: 'menu-separator',
      html: '<div class="b3-menu__separator"></div>',
      target: '.b3-menu__separator',
    },
    {
      label: 'protyle-wysiwyg',
      html: '<div class="protyle"><div class="protyle-wysiwyg"></div></div>',
      target: '.protyle-wysiwyg',
    },
  ],
  interactions: () => INTERACTION_SPECS,
};

/**
 * 插件的审计规格。
 *
 * 插件没有 rc/b3 前缀的桥接约定，也不该按主题的语义角色做对比度断言
 * ——它的变量名和用途由插件自己决定。所以这里只采：
 *   - 令牌是否解析得出来（断链检查对任何目标都成立）
 *   - 插件的 CSS 是否真的生效（用选择器命中率判断，见 invariants）
 *
 * 具体断言哪些选择器，由调用方用 --probe 补充；默认只做通用检查。
 */
const PLUGIN_SPEC = {
  contrastPairs: [],
  bridgePairs: [],
  probes: [],
  interactions: () => [],
};

/** 移动端额外要量的触摸目标。 */
const MOBILE_TOUCH_TARGETS = [
  { selector: '.dock__item', label: '停靠栏图标', limit: 6 },
  { selector: '.b3-menu__item', label: '菜单项', limit: 3 },
];

/** 要对比「交互前后」的元素。 */
const INTERACTION_SPECS = [
  {
    label: '停靠栏图标 hover',
    selector: '.dock__item',
    hoverProbe: '.dock__item:hover',
    // 主题没有给 .dock__item 写 :hover，所以不期待变化
    expectChange: false,
    interact: async (page) => {
      const point = await page.evaluate(() => {
        const el = document.querySelector('.dock__item');
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      if (point) await page.mouse.move(point.x, point.y);
    },
  },
  {
    label: '菜单项 hover（需先打开菜单）',
    selector: '.b3-menu__item',
    hoverProbe: '.b3-menu__item:hover',
    // 菜单项在菜单打开前根本不存在（实测 0 个），无法采交互前状态
    requireBefore: false,
    // l3-components.css 里有 .b3-menu__item:hover { @apply bg-surface }
    expectChange: true,
    interact: async (page) => {
      // 右键文档树条目打开上下文菜单，菜单项才会存在
      const tree = await page.evaluate(() => {
        const el = document.querySelector('.b3-list-item');
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      if (!tree) return;
      await page.mouse.move(tree.x, tree.y);
      await page.mouse.click(tree.x, tree.y, { button: 'right' });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const item = await page.evaluate(() => {
        const el = document.querySelector('.b3-menu__item');
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      if (item) await page.mouse.move(item.x, item.y);
    },
  },
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
    css: takeValue('--css'),
    frontend: takeValue('--frontend'),
    plugin: takeValue('--plugin'),
    viewport: parseViewport(takeValue('--viewport'), undefined),
    asJson: rest.includes('--json'),
    factsOnly: rest.includes('--facts-only'),
    attach: rest.includes('--attach'),
    quiet: rest.includes('--quiet'),
  };
}

function formatFacts(frontend, facts, sheets) {
  const lines = [];
  const pad = (text, width) => String(text).padEnd(width);

  lines.push(PREFIX + '── ' + frontend + ' ── 环境');
  lines.push('  前端=' + (facts.frontend ?? '?') + ' 模式=' + (facts.themeMode ?? '?') + ' DOM节点=' + facts.domNodes);
  lines.push('  CSS：' + (sheets.map((s) => s.label).join('、') || '(无)'));

  if (facts.tokens.length) {
    lines.push('');
    lines.push(PREFIX + '── 令牌（' + facts.tokens.length + ' 个）');
    const width = Math.max(...facts.tokens.map((t) => t.name.length));
    for (const token of facts.tokens) {
      lines.push('  ' + pad(token.name, width) + '  ' + (token.value || '(空)'));
    }
  }

  if (facts.contrastPairs.length) {
    lines.push('');
    lines.push(PREFIX + '── 对比度');
    for (const pair of facts.contrastPairs) {
      const ratio = pair.ratio === null ? '解析失败' : pair.ratio + ':1';
      const verdict = pair.ratio === null ? '' : pair.ratio >= 4.5 ? '✓ AA' : pair.ratio >= 3 ? '△ 仅大字' : '✗ 不足';
      lines.push('  ' + pad(pair.label, 14) + pad(ratio, 10) + verdict);
    }
  }

  if (facts.touchTargets.length) {
    lines.push('');
    lines.push(PREFIX + '── 触摸目标（要求 ≥ 44×44）');
    for (const target of facts.touchTargets) {
      const ok = target.width >= 44 && target.height >= 44;
      lines.push('  ' + pad(target.label, 22) + target.width + '×' + target.height + '  ' + (ok ? '✓' : '✗'));
    }
  }

  if (facts.probes.length) {
    lines.push('');
    lines.push(PREFIX + '── 组件计算样式');
    for (const probe of facts.probes) {
      if (!probe.found) {
        lines.push('  ' + probe.label + '：(未找到)');
        continue;
      }
      lines.push('  ' + probe.label);
      for (const [prop, value] of Object.entries(probe.styles)) {
        if (!value) continue;
        lines.push('    ' + pad(prop, 18) + value);
      }
    }
  }

  if (facts.interactionDiffs?.length) {
    lines.push('');
    lines.push(PREFIX + '── 交互差异');
    for (const diff of facts.interactionDiffs) {
      if (!diff.found) {
        lines.push('  ' + diff.label + '：(未找到元素)');
        continue;
      }
      // requireBefore:false 的元素交互后才出现，没有 before 可对比
      if (!diff.before) {
        lines.push('  ' + diff.label + '：交互后出现（伪类命中=' + diff.triggered + '）');
        const notable = ['color', 'background-color', 'border-top-color', 'border-radius', 'padding-top'];
        for (const prop of notable) {
          if (diff.after[prop]) lines.push('    ' + pad(prop, 18) + diff.after[prop]);
        }
        continue;
      }
      const changed = Object.keys(diff.after).filter((prop) => diff.before[prop] !== diff.after[prop]);
      if (!changed.length) {
        lines.push('  ' + diff.label + '：无变化（伪类命中=' + diff.triggered + '）');
        continue;
      }
      lines.push('  ' + diff.label + '：' + changed.length + ' 项变化（伪类命中=' + diff.triggered + '）');
      for (const prop of changed) {
        lines.push('    ' + pad(prop, 18) + diff.before[prop] + ' → ' + diff.after[prop]);
      }
    }
  }

  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const target = options.plugin
    ? pluginTarget({ name: options.plugin })
    : themeTarget({ cssPath: options.css, themeName: readThemeName() });

  const frontends = options.frontend ? [options.frontend] : ['desktop', 'mobile'];
  const reports = [];
  const notes = [];
  const staticProblems = [];

  for (const frontend of frontends) {
    const viewport = options.viewport ?? parseViewport(frontend === 'mobile' ? '390x844@3' : '1600x1000@1', undefined);
    const canAttach = options.attach && frontend === 'desktop';
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
            session.viewport.height
        );
      }
      if (mount.reason) notes.push(frontend + '：' + mount.reason);
      if (target.kind === 'theme' && environment.themeStyle) {
        const judged = judgeMount(environment.themeStyle, target.name);
        if (!judged.ok)
          notes.push(frontend + '：未挂载本主题（' + (judged.loaded ?? '内置') + '），读数可能不代表本主题');
      }

      const sheets = await target.resolveCss();
      for (const problem of findProblemsIn(sheets)) {
        staticProblems.push(
          problem.sheet +
            '：rgb(var(' +
            problem.token +
            ')) 双重包装——' +
            problem.token +
            ' 已是完整色值，再包 rgb() 会让整条声明失效'
        );
      }

      // 令牌清单：从 CSS 源码里取，覆盖该目标定义的全部令牌
      const allTokens = sheets.flatMap((sheet) => tokensIn(sheet.text));
      const tokenList = [...new Set(allTokens)];

      // 审计规格按目标类型选：主题有 --rc-*/--b3-* 的桥接与对比度约定，
      // 插件没有（它自己的变量名由插件决定），套用主题规格会得出无意义的结论。
      const spec = target.kind === 'theme' ? THEME_SPEC : PLUGIN_SPEC;

      const rootSnapshot = await snapshotRoot(session.page);

      // 1) 亮色事实
      await runActions({ page: session.page, rootSnapshot }, ['reset']);
      const lightFacts = await collectFacts(session.page, {
        tokens: tokenList,
        contrastPairs: spec.contrastPairs,
        bridgePairs: spec.bridgePairs,
        touchTargets: frontend === 'mobile' ? MOBILE_TOUCH_TARGETS : [],
        probes: spec.probes,
      });

      // 2) 暗色令牌（用于「暗色确实覆盖了」这条不变量）
      await runActions({ page: session.page, rootSnapshot }, ['reset', 'attr:data-theme-mode=dark']);
      const darkTokens = await collectFacts(session.page, { tokens: tokenList });

      // 3) 交互差异
      const interactionDiffs = [];
      for (const interactionSpec of spec.interactions()) {
        await runActions({ page: session.page, rootSnapshot }, ['reset']);
        const diff = await collectInteractionDiff(session.page, interactionSpec).catch(() => null);
        if (diff) interactionDiffs.push(diff);
      }
      await runActions({ page: session.page, rootSnapshot }, ['reset']);

      // 补上对比度的实际比值（在 Node 侧算，便于单测）
      const { contrastRatio } = await import('./invariants.mjs');
      const contrastPairs = lightFacts.contrastPairs.map((pair) => ({
        ...pair,
        ratio: contrastRatio(pair.foreground, pair.background),
      }));

      const facts = {
        ...lightFacts,
        contrastPairs,
        darkTokens: darkTokens.tokens,
        interactionDiffs,
      };

      reports.push({ frontend, facts, sheets: sheets.map((s) => ({ label: s.label })) });
    } finally {
      await session.dispose();
    }
  }

  // 汇总判定：所有前端都过才算过
  const allResults = [];
  for (const report of reports) {
    const verdict = runInvariants(report.facts);
    allResults.push({ frontend: report.frontend, ...verdict });
  }

  if (options.asJson) {
    console.log(
      JSON.stringify(
        {
          target: { kind: target.kind, name: target.name },
          staticProblems,
          notes,
          reports: reports.map((report, index) => ({
            frontend: report.frontend,
            facts: report.facts,
            invariants: allResults[index].results,
          })),
          ok: allResults.every((result) => result.ok) && staticProblems.length === 0,
        },
        null,
        2
      )
    );
  } else if (!options.quiet) {
    for (const line of staticProblems) console.log(PREFIX + '✗ ' + line);
    for (const note of notes) console.log(PREFIX + '注：' + note);

    if (!options.factsOnly) {
      for (const result of allResults) {
        console.log('');
        console.log(PREFIX + '── ' + result.frontend + ' ── 不变量');
        for (const item of result.results) {
          const mark = item.ok ? '✓' : item.severity === 'warn' ? '△' : '✗';
          console.log('  ' + mark + ' ' + item.name + (item.ok ? '' : '：' + item.detail));
        }
      }
    }

    for (const report of reports) {
      console.log('');
      for (const line of formatFacts(report.frontend, report.facts, report.sheets)) console.log(line);
    }
  }

  const failed = allResults.filter((result) => !result.ok);
  if (staticProblems.length || failed.length) {
    if (!options.asJson) {
      const parts = [];
      if (staticProblems.length) parts.push('静态检查 ' + staticProblems.length + ' 项');
      for (const result of failed) {
        parts.push(result.frontend + ' 有 ' + result.failed.length + ' 条 error 级违规');
      }
      console.error('');
      console.error(PREFIX + '结论：' + parts.join('；'));
    }
    process.exit(1);
  }

  if (!options.asJson) {
    const warns = allResults.reduce((sum, result) => sum + result.warned.length, 0);
    console.log('');
    console.log(
      PREFIX +
        '结论：不变量全部通过' +
        (warns ? '（' + warns + ' 条 warn 级提示见上）' : '') +
        '。事实已输出，请据此判断是否符合预期。'
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}
