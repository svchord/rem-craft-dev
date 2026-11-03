/**
 * 探针只读事实，返回纯数据：不打印、不改页面。因此任意动作序列都能和任意探针组合。
 */

const STYLE_PROPS = [
  'display',
  'width',
  'height',
  'color',
  'background-color',
  'background-image',
  'background-size',
  'font-size',
  'font-weight',
  'line-height',
  'padding-top',
  'padding-left',
  'margin-top',
  'margin-left',
  'border-radius',
  'box-shadow',
  'gap',
  'max-width',
  'overflow',
  'position',
  'z-index',
  'opacity',
  'transition-property',
  'transition-duration',
];

const EMPTY_VALUES = new Set(['auto', 'none', 'normal', '0px', 'rgba(0, 0, 0, 0)']);
/** 这些属性上 `none` 是有意义的取值，不能被过滤掉。 */
const KEEP_NONE = new Set(['display', 'visibility', 'opacity']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 最多 `limit` 个匹配元素的计算样式。 */
export async function probeStyles(page, selector, limit = 1) {
  const data = await page.evaluate(
    (target, props, maxItems) => {
      const elements = Array.from(document.querySelectorAll(target));
      return {
        count: elements.length,
        items: elements.slice(0, maxItems).map((element) => {
          const style = getComputedStyle(element);
          const values = {};
          for (const prop of props) {
            values[prop] = style.getPropertyValue(prop);
          }
          return {
            tag: element.tagName.toLowerCase(),
            className: String(element.className || ''),
            props: values,
          };
        }),
      };
    },
    selector,
    STYLE_PROPS,
    limit
  );

  return {
    selector,
    count: data.count,
    items: data.items.map((item) => ({
      ...item,
      props: Object.fromEntries(
        Object.entries(item.props).filter(([name, value]) => value && (KEEP_NONE.has(name) || !EMPTY_VALUES.has(value)))
      ),
    })),
  };
}

/** 首个匹配元素命中的 CSS 规则，来自 CSS domain。 */
export async function probeRules(client, documentNodeId, selector, sheets) {
  const query = await client.send('DOM.querySelector', { nodeId: documentNodeId, selector });
  if (!query.nodeId) return [];

  const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId: query.nodeId });
  const rules = [];
  for (const match of matched.matchedCSSRules || []) {
    if (match.rule.origin === 'user-agent') continue;
    const url = sheets.get(match.rule.styleSheetId) || '';

    let source = '(inline <style>)';
    if (url) {
      const themeIndex = url.indexOf('/appearance/themes/');
      source = themeIndex >= 0 ? url.slice(themeIndex + '/appearance/themes/'.length) : url.slice(-64);
    }

    rules.push({
      source,
      selector: match.rule.selectorList.text,
      properties: (match.rule.cssProperties || [])
        .filter((property) => property.value !== '')
        .slice(0, 6)
        .map((property) => property.name + ': ' + property.value),
    });
  }
  return rules.slice(0, 8);
}

/**
 * 读取令牌的计算值。
 *
 * 计算样式里的自定义属性**已经展开 var() 链**，未定义的令牌返回空串，
 * 因此一个 getPropertyValue 就够：既能判断「定义了没有」，也能看到最终值。
 * 注意 L0 刻度存的是 "R G B" 三通道（`0 82 217`），不是颜色值，
 * 直接当 color 用会失效——所以这里只取原文，不做任何颜色求值。
 */
export async function probeTokens(page, names) {
  return page.evaluate((tokens) => {
    const root = getComputedStyle(document.documentElement);
    const values = {};
    for (const token of tokens) {
      values[token] = root.getPropertyValue(token).trim();
    }
    return values;
  }, names);
}

/**
 * 主题契约体检：确认主题确实挂载、契约版本、两轴属性与变体属性。
 * 这是 `pnpm run audit:theme` 的头部数据，也是判断「测的到底是不是本主题」的唯一依据。
 */
export async function probeEnvironment(page, session) {
  const head = await page.evaluate(() => {
    const config = window.siyuan?.config?.appearance;
    const themeLink = document.getElementById('themeStyle');
    const root = document.documentElement;
    // `pnpm dev` 不挂载主题，而是用 Vite 的 import() 注入 CSS；此时 themeStyle 仍指向宿主题，
    // 光看 href 会把「正在开发的本主题」误判成未挂载。__RC_DEV_HMR__ 是注入成功的标记。
    const hmr = Boolean(window.__RC_DEV_HMR__);
    return {
      theme: config?.themeLight,
      mode: config?.mode,
      href: themeLink?.getAttribute('href') || null,
      hmr,
      frontend: root.getAttribute('data-frontend'),
      themeMode: root.getAttribute('data-theme-mode'),
      density: root.getAttribute('data-ui-density'),
      rcStyle: root.getAttribute('data-rc-style'),
      rcPalette: root.getAttribute('data-rc-palette'),
      rcCustom: root.getAttribute('data-rc-custom'),
      features: Object.fromEntries(
        Array.from(root.attributes)
          .filter((attribute) => attribute.name.startsWith('data-rc-'))
          .map((attribute) => [attribute.name, attribute.value])
      ),
      domNodes: document.querySelectorAll('*').length,
    };
  });

  const client = await page.createCDPSession();
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const sheets = new Map();
  client.on('CSS.styleSheetAdded', (event) => {
    if (event.header) sheets.set(event.header.styleSheetId, event.header.sourceURL || '');
  });
  await sleep(300);
  const document = await client.send('DOM.getDocument', { depth: 1 });

  return { ...head, opened: session.attached ? 'attached' : 'launched', client, document, sheets };
}

/**
 * 按顶层逗号切分选择器列表。
 *
 * 不能用 `split(',')`：属性选择器与 :is()/:not() 里都可以合法出现逗号
 * （`[data-x="a,b"]`、`:is(.a,.b)`），切开后会变成永远 miss 的假选择器。
 * 引号内的逗号同样要保护。
 */
function splitSelectorList(raw) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

/**
 * 从样式表源码里抽出所有选择器。
 *
 * 用源码而不是 CSSOM：思源的样式表经 `link` 加载，跨域下 CSSOM 读不到规则；
 * 而主题的失效往往正是「选择器在新版思源里不再命中」，所以必须拿到全量选择器清单。
 */
export function parseSelectors(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // @keyframes 块里是 from/to/百分比关键帧，不是选择器。整块剔除，
  // 否则主题一旦加动画，命中率统计就会冒出 from、0% 这类永远 miss 的假条目。
  const withoutKeyframes = withoutComments.replace(/@(?:-\w+-)?keyframes\b[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

  const selectors = [];
  for (const match of withoutKeyframes.matchAll(/([^{}]+)\{/g)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('@')) continue;
    for (const part of splitSelectorList(raw)) {
      const selector = part.trim();
      if (!selector) continue;
      // 兜底：百分比只可能出现在关键帧里，残留即说明上面的整块剔除没覆盖到。
      if (/^\d+(?:\.\d+)?%$/.test(selector)) continue;
      selectors.push(selector);
    }
  }
  return [...new Set(selectors)];
}

/** 批量统计选择器命中数；非法选择器记 -1。 */
export async function probeSelectorHits(page, selectors) {
  const counts = await page.evaluate(
    (list) =>
      list.map((selector) => {
        try {
          return [selector, document.querySelectorAll(selector).length];
        } catch {
          return [selector, -1];
        }
      }),
    selectors
  );

  return {
    total: counts.length,
    hits: counts.filter(([, count]) => count > 0),
    misses: counts.filter(([, count]) => count === 0),
    invalid: counts.filter(([, count]) => count < 0),
  };
}
