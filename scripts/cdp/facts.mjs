/**
 * 事实采集：在真实页面上把「当前渲染成什么样」一次性采全，交给不变量判定。
 *
 * 与 probes.mjs 的分工：
 *   probes   按用例量指定元素（用于交互断言）
 *   facts    一次性采全量证据（令牌表、对比度对、触摸目标、交互差异）
 *
 * 为什么要采全量而不是逐条断言：审计的目标是让 agent / 人能「基于证据判断」，
 * 而不是让工具替人拍板。所以这里尽量多给事实（每个令牌的值、每对颜色的对比度、
 * 每个目标的尺寸），判断交给 invariants.mjs 和读报告的人。
 */

const STYLE_PROPS = [
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
 * 从 CSS 文本里抽出**主题契约令牌**名。
 *
 * 只取 --rc-* 与 --b3-*：这两类才是主题对外的契约。工具链自己产生的运行时变量
 * （UnoCSS 的 --un-*、Tailwind 的 --tw-*）是规则内部的临时值，不该进审计——
 * 它们只在某条规则里定义并使用，脱离那条规则当然读不到值。
 */
export function tokensIn(css) {
  const all = [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))];
  return all.filter((name) => name.startsWith('--rc-') || name.startsWith('--b3-'));
}

/**
 * 在真实页面上采全量事实。
 *
 * @param page    puppeteer page（已在目标状态）
 * @param options { tokens, contrastPairs, bridgePairs, touchTargets, probes }
 */
export async function collectFacts(page, options = {}) {
  return page.evaluate(
    (spec) => {
      const rootStyle = getComputedStyle(document.documentElement);

      const tokens = (spec.tokens ?? []).map((name) => ({
        name,
        value: rootStyle.getPropertyValue(name).trim(),
      }));

      const contrastPairs = (spec.contrastPairs ?? []).map((pair) => {
        const fg = rootStyle.getPropertyValue(pair.foreground).trim();
        const bg = rootStyle.getPropertyValue(pair.background).trim();
        return {
          label: pair.label ?? pair.foreground + ' on ' + pair.background,
          role: pair.role ?? 'body',
          foreground: fg,
          background: bg,
        };
      });

      const bridgePairs = (spec.bridgePairs ?? []).map((pair) => ({
        bridge: pair.bridge,
        bridgeValue: rootStyle.getPropertyValue(pair.bridge).trim(),
        source: pair.source,
        sourceValue: rootStyle.getPropertyValue(pair.source).trim(),
      }));

      // 触摸目标：量真实元素，跳过不可见的
      const touchTargets = (spec.touchTargets ?? []).flatMap((entry) => {
        let elements;
        try {
          elements = [...document.querySelectorAll(entry.selector)];
        } catch {
          return [];
        }
        return elements
          .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
          .slice(0, entry.limit ?? 5)
          .map((el, index) => {
            const box = el.getBoundingClientRect();
            return {
              label: (entry.label ?? entry.selector) + '[' + index + ']',
              width: Math.round(box.width * 10) / 10,
              height: Math.round(box.height * 10) / 10,
            };
          });
      });

      // 探针：插进页面量，同时记录主题 CSS 里声明的值（用于判断是否被覆盖）
      const probes = [];
      for (const probe of spec.probes ?? []) {
        if (!probe.html) continue;
        const host = document.createElement('div');
        host.setAttribute('style', 'position:fixed;left:-99999px;top:0;width:1200px;');
        host.innerHTML = probe.html;
        document.body.appendChild(host);
        try {
          const el = host.querySelector(probe.target ?? probe.label);
          if (!el) {
            probes.push({ label: probe.label, found: false, styles: {} });
            continue;
          }
          const style = getComputedStyle(el);
          const styles = {};
          for (const prop of probe.props ?? []) styles[prop] = style.getPropertyValue(prop);
          probes.push({ label: probe.label, found: true, styles, declared: probe.declared ?? {} });
        } finally {
          host.remove();
        }
      }

      return {
        frontend: document.documentElement.getAttribute('data-frontend'),
        themeMode: document.documentElement.getAttribute('data-theme-mode'),
        themeStyle: document.getElementById('themeStyle')?.getAttribute('href') ?? null,
        domNodes: document.querySelectorAll('*').length,
        tokens,
        contrastPairs,
        bridgePairs,
        touchTargets,
        probes,
      };
    },
    {
      tokens: options.tokens ?? [],
      contrastPairs: options.contrastPairs ?? [],
      bridgePairs: options.bridgePairs ?? [],
      touchTargets: options.touchTargets ?? [],
      probes: (options.probes ?? []).map((probe) => ({
        ...probe,
        props: probe.props ?? STYLE_PROPS,
      })),
    }
  );
}

/**
 * 采交互前后差异：同一元素在静止态与交互态下的样式对比。
 *
 * 这是「交互是否符合预期」的客观证据——如果 hover 后什么都没变，
 * 几乎可以断定样式没生效（或选择了错误的断言目标）。
 *
 * 关键：先把握针移到角落再读「静止态」。指针位置在会话间是持续的，
 * 上一次交互留下的 hover 会让 before 一开始就是交互后的值，
 * 于是差异恒为 0（实测踩过）。
 */
/**
 * 采交互前后差异：同一元素在静止态与交互态下的样式对比。
 *
 * 这是「交互是否符合预期」的客观证据。
 *
 * 两种情形，用 `requireBefore` 区分：
 *
 *   requireBefore: true（默认）——元素本来就在（停靠栏图标）。
 *     先移开指针读静止态，再交互读交互态。指针位置在会话间是持续的，
 *     上一次交互留下的 hover 会让 before 一开始就是交互后的值，差异恒为 0
 *     （实测踩过），所以必须先 move(1,1)。
 *
 *   requireBefore: false——元素交互后才出现（菜单项）。
 *     交互前 DOM 里根本没有这个节点（实测 0 个），无法采 before。
 *     这时只采交互态，并把 before 记为 null；不变量用 triggered 判断是否驱动成功。
 */
export async function collectInteractionDiff(page, spec) {
  const read = () =>
    page.evaluate(
      (target, props) => {
        const el = document.querySelector(target);
        if (!el) return null;
        const style = getComputedStyle(el);
        return Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]));
      },
      spec.selector,
      spec.props ?? STYLE_PROPS
    );

  const requireBefore = spec.requireBefore !== false;

  // 移到窗口左上角，确保没有元素处于 hover
  await page.mouse.move(1, 1);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const before = requireBefore ? await read() : null;
  if (requireBefore && !before) {
    return { label: spec.label, found: false, before: {}, after: {} };
  }

  await spec.interact(page);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const after = await read();
  if (!after) return { label: spec.label, found: false, before: {}, after: {} };

  // 伪类是否真的命中：用 :hover 之类的选择器反查，确认交互驱动成功。
  // 不能靠「样式变了没」推断——主题可以合法地不给这个元素写 hover 样式。
  const triggered = spec.hoverProbe
    ? await page
        .evaluate((selector) => {
          try {
            return Boolean(document.querySelector(selector));
          } catch {
            return null;
          }
        }, spec.hoverProbe)
        .catch(() => null)
    : null;

  const changedCount = before ? Object.keys(after).filter((prop) => before[prop] !== after[prop]).length : 0;

  return {
    label: spec.label,
    found: true,
    before,
    after,
    triggered,
    // 主题 CSS 里是否声明了这个交互态——声明了却没变化才值得怀疑
    expectChange: Boolean(spec.expectChange),
    changedCount,
  };
}

export { STYLE_PROPS };
