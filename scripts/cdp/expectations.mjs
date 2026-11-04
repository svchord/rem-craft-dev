/**
 * 渲染基线：把「页面实际渲染」与 expectations.json 逐项比对。
 *
 * 本模块是纯函数（读文件 + 字符串比较），不碰浏览器，因此可以在单测里直接验证
 * 「期望值怎么写、不符怎么报」，不需要思源在跑。
 *
 * 两种审计模式（用例用 mode 选，缺省 static）：
 *
 *   static  把 CSS 注入 iframe 沙箱再量。快、稳、不受宿主主题影响，适合
 *           「令牌解析对不对」「组件配方算出来是什么」这类纯级联问题。
 *
 *   live    在真实页面上先跑 actions 驱动状态，再就地量。适合只有交互才出现的
 *           东西：:hover、展开的菜单、点击后的选中态、激活的插件面板。
 *           静态沙箱永远测不到这些——思源升级后 CSS 选择器还在但 DOM 结构变了，
 *           静态断言照样绿，实际交互已经烂了。
 *
 * 用例形状：
 *   {
 *     name: '...',                 必填
 *     mode: 'live',                可选，缺省 static
 *     frontend: 'mobile',          可选，缺省 desktop（桌面/移动是两个独立构建）
 *     viewport: '390x844@3',       可选，覆盖文件级与默认值
 *     attributes: { 'data-backend': 'ios' },   可选，沙箱根属性（仅 static）
 *     actions: ['hover:.b3-menu__item'],       可选，驱动状态（仅 live）
 *     tokens: { '--rc-radius-base': '6px' },
 *     selectors: { mustHit: [...], mustMiss: [...] },
 *     probes: [{ label, html, target, expect: { 'padding-top': '8px' } }]
 *   }
 *
 * probes.html 只用于 static 模式（在沙箱里插标记）；live 模式必须给 target，
 * 直接量页面上的真实元素。
 *
 * 取值写法：
 *   "6px"            精确匹配（比较前 trim）
 *   null             必须为空（未定义令牌 / 空串）
 *   "re:^rgb\\(0 82" 正则匹配（正则写在 re: 之后）
 */

/** 一个期望值是否命中实际读数。 */
function matchValue(expected, actual) {
  const value = String(actual ?? '').trim();

  if (expected === null) return value === '';

  const pattern = String(expected).trim();
  if (pattern.startsWith('re:')) {
    try {
      return new RegExp(pattern.slice(3)).test(value);
    } catch {
      return false;
    }
  }

  return value === pattern;
}

function assertCase(testCase, index) {
  const at = '用例 #' + (index + 1);
  if (!testCase || typeof testCase !== 'object') throw new Error(at + ' 必须是对象');
  if (!testCase.name || typeof testCase.name !== 'string') throw new Error(at + ' 缺少 name');
  if (testCase.mode !== undefined && !['static', 'live'].includes(testCase.mode)) {
    throw new Error(at + ' 的 mode 只能是 static / live');
  }
  if (testCase.frontend !== undefined && !['desktop', 'mobile'].includes(testCase.frontend)) {
    throw new Error(at + ' 的 frontend 只能是 desktop / mobile');
  }
  if (testCase.attributes !== undefined && (typeof testCase.attributes !== 'object' || testCase.attributes === null)) {
    throw new Error(at + '（' + testCase.name + '）的 attributes 必须是对象');
  }
  if (testCase.actions !== undefined && !Array.isArray(testCase.actions)) {
    throw new Error(at + '（' + testCase.name + '）的 actions 必须是数组');
  }
  // live 用例靠 actions 进入状态，没给 actions 就只是在量初始页面，容易误以为是交互断言。
  if (testCase.mode === 'live' && !(testCase.actions ?? []).length) {
    throw new Error(at + '（' + testCase.name + '）是 live 用例，必须给 actions 说明要驱动到什么状态');
  }
  for (const key of ['tokens', 'selectors']) {
    if (testCase[key] !== undefined && (typeof testCase[key] !== 'object' || testCase[key] === null)) {
      throw new Error(at + '（' + testCase.name + '）的 ' + key + ' 必须是对象');
    }
  }
  for (const probe of testCase.probes ?? []) {
    if (!probe || typeof probe !== 'object') throw new Error(at + ' 的 probes 项必须是对象');
    if (!probe.label) throw new Error(at + ' 的 probes 项缺少 label');
    // static 在沙箱里插 html，live 直接量页面上的真实元素——后者必须有 target。
    if (testCase.mode === 'live') {
      if (!probe.target) throw new Error(at + ' 的 live probe ' + probe.label + ' 缺少 target');
    } else if (!probe.html) {
      throw new Error(at + ' 的 probe ' + probe.label + ' 缺少 html');
    }
    if (!probe.expect || typeof probe.expect !== 'object') {
      throw new Error(at + ' 的 probe ' + probe.label + ' 缺少 expect');
    }
  }
}

/** 读取并校验基线文件；结构错误必须报错，不能静默跳过。 */
export function parseExpectations(raw, source = 'expectations.json') {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(source + ' 不是合法 JSON：' + (error instanceof Error ? error.message : String(error)));
  }

  if (!Array.isArray(data.cases) || !data.cases.length) {
    throw new Error(source + ' 必须包含非空 cases 数组');
  }
  data.cases.forEach(assertCase);

  return {
    source,
    viewport: data.viewport ?? null,
    cases: data.cases,
  };
}

/**
 * 比对单个用例。actual 的形状固定为：
 *   { tokens: {name: value}, hits: {selector: count}, probes: [{label, styles: {prop: value}}] }
 *
 * 只做判定，不做打印：CLI 层负责把 checks 变成人能读的行。
 */
export function evaluateCase(testCase, actual) {
  const checks = [];

  for (const [name, expected] of Object.entries(testCase.tokens ?? {})) {
    const value = actual.tokens?.[name] ?? '';
    checks.push({
      kind: 'token',
      label: name,
      expected,
      actual: value,
      ok: matchValue(expected, value),
    });
  }

  for (const selector of testCase.selectors?.mustHit ?? []) {
    const count = actual.hits?.[selector] ?? 0;
    checks.push({
      kind: 'selector',
      label: selector,
      expected: '至少命中 1 个',
      actual: count + ' 个匹配',
      ok: count > 0,
    });
  }

  for (const selector of testCase.selectors?.mustMiss ?? []) {
    const count = actual.hits?.[selector] ?? 0;
    checks.push({
      kind: 'selector',
      label: selector,
      expected: '不得命中',
      actual: count + ' 个匹配',
      ok: count === 0,
    });
  }

  for (const probe of testCase.probes ?? []) {
    const measured = (actual.probes ?? []).find((item) => item.label === probe.label);
    if (!measured || !measured.found) {
      checks.push({
        kind: 'style',
        label: probe.label,
        expected: '元素可测量',
        actual: measured ? '目标元素不存在' : '探针未执行',
        ok: false,
      });
      continue;
    }
    for (const [prop, expected] of Object.entries(probe.expect)) {
      const value = measured.styles?.[prop] ?? '';
      checks.push({
        kind: 'style',
        label: probe.label + ' ' + prop,
        expected,
        actual: value,
        ok: matchValue(expected, value),
      });
    }
  }

  return checks;
}

/** 把实际读数整理成「和基线同构」的对象，供 --baseline 生成新基线。 */
export function toBaselineCase(testCase, actual) {
  return {
    name: testCase.name,
    ...(testCase.mode ? { mode: testCase.mode } : {}),
    ...(testCase.frontend ? { frontend: testCase.frontend } : {}),
    ...(testCase.viewport ? { viewport: testCase.viewport } : {}),
    ...(testCase.attributes ? { attributes: testCase.attributes } : {}),
    ...(testCase.actions?.length ? { actions: testCase.actions } : {}),
    tokens: Object.fromEntries(Object.keys(testCase.tokens ?? {}).map((name) => [name, actual.tokens?.[name] ?? ''])),
    ...(testCase.selectors
      ? {
          selectors: {
            ...(testCase.selectors.mustHit ? { mustHit: testCase.selectors.mustHit } : {}),
            ...(testCase.selectors.mustMiss ? { mustMiss: testCase.selectors.mustMiss } : {}),
          },
        }
      : {}),
    ...(testCase.probes?.length
      ? {
          probes: testCase.probes.map((probe) => {
            const measured = (actual.probes ?? []).find((item) => item.label === probe.label);
            return {
              label: probe.label,
              // live 用例没有 html（量的是页面上的真实元素），不要凭空造一个。
              ...(probe.html ? { html: probe.html } : {}),
              ...(probe.target ? { target: probe.target } : {}),
              expect: Object.fromEntries(
                Object.keys(probe.expect).map((prop) => [prop, measured?.styles?.[prop] ?? ''])
              ),
            };
          }),
        }
      : {}),
  };
}
