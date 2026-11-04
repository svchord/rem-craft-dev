/**
 * 主题开发通用能力：让思源选中某个主题、让页面重新加载它的 CSS。
 *
 * 这两个动作是**所有思源主题项目都需要的**，与用什么构建工具无关：
 *   - `pnpm dev` 起 watch 之后，得让思源真正选中本主题，否则预览的是宿主主题
 *   - 产物变了之后，得让页面重新加载 theme.css，否则看到的是旧样式
 *
 * 只碰 kernel API 与 `#themeStyle` 那一个 link，不动其它样式表，级联位置不变。
 */

/**
 * 调 kernel API。开了 API token 时从环境变量 SIYUAN_TOKEN 读。
 *
 * @param port kernel 端口
 * @param path 接口路径，如 '/api/system/getConf'
 * @param body 请求体（POST）
 */
export async function callKernel(port, path, body = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SIYUAN_TOKEN) headers.Authorization = 'Token ' + process.env.SIYUAN_TOKEN;

  const response = await fetch('http://127.0.0.1:' + port + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  // 思源有些接口成功时返回空体
  if (!text) return { code: 0, data: null };
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, data: null, msg: text.slice(0, 200) };
  }
}

/**
 * 让思源选中指定主题（明暗都设成它）。
 *
 * 已经是它时不做任何事——避免每次启动都触发一次无谓的重载。
 * 返回 { ok, changed, reason }，调用方决定怎么打日志。
 */
export async function selectTheme(port, themeName) {
  const conf = await callKernel(port, '/api/system/getConf');
  const appearance = conf.data?.conf?.appearance;
  if (!appearance) {
    return { ok: false, changed: false, reason: '读不到思源配置（appearance）' };
  }

  if (appearance.themeLight === themeName && appearance.themeDark === themeName) {
    return { ok: true, changed: false, reason: null };
  }

  const result = await callKernel(port, '/api/setting/setAppearance', {
    themeLight: themeName,
    themeDark: themeName,
  });
  if (result.code !== 0) {
    return { ok: false, changed: false, reason: '切换主题失败：' + (result.msg || '未知错误') };
  }
  return { ok: true, changed: true, reason: null };
}

/**
 * 让页面重新加载主题 CSS。
 *
 * 换 `#themeStyle` 的 href 并加时间戳：只动主题那一个 link，不碰其它样式表，
 * 级联位置不变。这是思源重载主题的等价操作。
 *
 * 返回是否成功（页面里没有 themeStyle 时返回 false）。
 */
export async function reloadThemeCss(page, { styleId = 'themeStyle', stamp = Date.now() } = {}) {
  if (!page) return false;
  try {
    return await page.evaluate(
      async (id, version) => {
        const link = document.getElementById(id);
        if (!link) return false;
        const base = (link.getAttribute('href') || '').split('?')[0];
        link.setAttribute('href', base + '?v=' + version);

        // 等新样式表真正生效，避免量到旧的
        await new Promise((resolve) => {
          const done = () => resolve();
          link.addEventListener('load', done, { once: true });
          link.addEventListener('error', done, { once: true });
          setTimeout(done, 1500);
        });
        return true;
      },
      styleId,
      stamp
    );
  } catch {
    // 导航中，等下一次
    return false;
  }
}

/**
 * 读当前思源选中的主题（明/暗）。
 * 用于「切换前备份、结束后还原」这类场景。
 */
export async function currentTheme(port) {
  const conf = await callKernel(port, '/api/system/getConf');
  const appearance = conf.data?.conf?.appearance;
  if (!appearance) return null;
  return { light: appearance.themeLight, dark: appearance.themeDark, mode: appearance.mode };
}

/**
 * 让页面重新加载某个插件的 CSS。
 *
 * 查过内核：没有 `/api/plugin/*` 写接口（实测 404），`reloadPlugin` 是 WebSocket
 * 推送的分支，HTTP 侧触发不了。但插件 CSS 是内联在 `<style id="pluginsStyle<name>">`
 * 里的（实测磁盘 index.css 与 textContent 逐字节相同），所以直接换 textContent
 * 就能让新样式立即生效，不用整页刷新。
 *
 * 注意：**只对 CSS 有效**。index.js 变了必须整页刷新，换 style 不会重新执行 JS。
 *
 * @param cssText 显式传入的 CSS 文本；不给则从磁盘读（需要传 file 参数）
 */
export async function reloadPluginCss(page, pluginName, cssText = null) {
  if (!page) return false;
  if (!cssText) return false;
  try {
    return await page.evaluate(
      (name, css) => {
        const el = document.getElementById('pluginsStyle' + name);
        if (!el) return false;
        el.textContent = css;
        return true;
      },
      pluginName,
      cssText
    );
  } catch {
    // 导航中，等下一次
    return false;
  }
}
