/**
 * 探针：只读事实，返回纯数据，不打印、不改页面。
 *
 * 只保留渲染回归真正要用的两个读数：
 *   - 令牌计算值（probeTokens）
 *   - 页面环境快照（probeEnvironment，用于确认打开的是哪个前端）
 *
 * 单点样式测量与命中规则查询已随 inspect 一起移除——判断「渲染对不对」用
 * verify 的基线比对即可，不需要临时手查某个选择器的计算样式。
 */

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
 * 页面环境快照：确认打开的是桌面还是移动端、主题挂没挂上。
 *
 * `pnpm verify:theme` 用它判断「这次量的是不是该量的那个前端」——移动端和桌面端
 * 是两个独立构建入口，量错地方结论就没有意义。
 */
export async function probeEnvironment(page, session) {
  const head = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      frontend: root.getAttribute('data-frontend'),
      backend: root.getAttribute('data-backend'),
      themeMode: root.getAttribute('data-theme-mode'),
      themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
      themeDefaultStyle: document.getElementById('themeDefaultStyle')?.getAttribute('href') || null,
      domNodes: document.querySelectorAll('*').length,
    };
  });

  return { ...head, opened: session.attached ? 'attached' : 'launched' };
}
