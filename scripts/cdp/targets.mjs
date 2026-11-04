/**
 * 被测目标适配器：把「主题」和「插件」的差异收敛到一个接口后面。
 *
 * 为什么需要这一层：主题与插件在思源里是两套东西，但**渲染审计的方法相同**——
 * 都是「拿到 CSS 文本 → 注入 iframe 沙箱 → 量计算样式」。差别只在两处：
 *   1. CSS 从哪来：主题读磁盘产物；插件由思源注入成 <style id="pluginsStyle<name>">，
 *      从页面里读更权威（那是实际加载的那份）。
 *   2. 怎么算「加载成功」：主题看 <link id="themeStyle"> 的 href；插件看 style 标签存在。
 *
 * 所以适配器只需要两个能力，沙箱与基线比对完全共用：
 *   resolveCss(page)   → [{ label, text }]   要审计的 CSS 文本
 *   mountState(page)   → { ok, loaded, reason }  确认被测对象确实加载了
 *
 * 插件额外的「面板打开后才有 DOM」是另一个维度，用 activate(page) 表达，
 * 只对需要真实 DOM 的断言有用；纯 CSS 审计不需要它。
 */

const readText = async (file) => {
  const { readFileSync } = await import('node:fs');
  return readFileSync(file, 'utf8');
};

/**
 * 主题适配器。
 *
 * CSS 读磁盘产物（dev/ 优先，回退 dist/）：它就是思源真正加载的那份，也是
 * 生产交付的那份，审计它才有意义。
 */
export function themeTarget({ cssPath, themeName } = {}) {
  return {
    kind: 'theme',
    name: themeName ?? 'theme',

    async resolveCss() {
      const candidates = cssPath ? [cssPath] : ['./dev/theme.css', './dist/theme.css'];
      for (const candidate of candidates) {
        try {
          const text = await readText(candidate);
          return [{ label: candidate, text }];
        } catch {
          // 试下一个
        }
      }
      throw new Error('找不到 theme.css：先运行 pnpm dev 或 pnpm build');
    },

    async mountState(page) {
      const state = await page.evaluate(() => {
        const link = document.getElementById('themeStyle');
        return { href: link?.getAttribute('href') || null };
      });
      if (!state.href) {
        return { ok: false, loaded: null, reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）' };
      }
      const segment = state.href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
      if (!segment) {
        return { ok: false, loaded: null, reason: 'themeStyle 的 href 不是主题目录路径：' + state.href };
      }
      const loaded = decodeURIComponent(segment);
      return { ok: true, loaded, reason: null };
    },
  };
}

/**
 * 插件适配器。
 *
 * CSS 从页面里读（`<style id="pluginsStyle<name>">` 的 textContent），而不是读磁盘：
 *   - 思源注入的就是这份，读到什么就是什么
 *   - 插件可能没有 index.css（如 Calendar-heatmap），此时返回空数组，只做 DOM 断言
 *   - 不需要知道插件装在哪个目录，换机器也能跑
 *
 * `activate` 用于打开插件面板（面板 DOM 只在打开后才存在）。默认不激活。
 */
export function pluginTarget({ name, activate = null } = {}) {
  if (!name) throw new Error('pluginTarget 需要插件名（plugin.json 的 name）');
  const styleId = 'pluginsStyle' + name;

  return {
    kind: 'plugin',
    name,

    async resolveCss(page) {
      const text = await page.evaluate((id) => document.getElementById(id)?.textContent ?? null, styleId);
      if (text === null) return [];
      if (!text.trim()) return [];
      return [{ label: styleId, text }];
    },

    async mountState(page) {
      const state = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return { present: Boolean(el), length: el?.textContent?.length ?? 0 };
      }, styleId);
      if (!state.present) {
        // 没有样式表不一定是失败：无 CSS 的插件本来就不会有这个标签。
        return { ok: true, loaded: null, reason: '插件无样式表（' + styleId + ' 不存在），只做 DOM 断言' };
      }
      return { ok: true, loaded: styleId, reason: null };
    },

    activate: activate ?? (async () => {}),
  };
}
