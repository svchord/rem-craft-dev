/**
 * 被测目标适配器：把「主题」和「插件」的差异收敛到一个接口后面。
 *
 * 为什么需要这一层：主题与插件在思源里是两套东西，但**渲染审计的方法相同**——
 * 都是「拿到 CSS → 在真实页面上量 → 与基线比」。差别只在两处：
 *   1. CSS 从哪来：主题读 dev/theme.css，插件读 index.css
 *   2. 怎么算「加载成功」：主题看 <link id="themeStyle">，插件看插件是否在运行
 *
 * 所以适配器只需要两个能力，测量与基线比对完全共用：
 *   resolveCss()       → [{ label, text }]        要审计的 CSS 文本（都读磁盘）
 *   mountState(page)   → { ok, loaded, reason }   确认被测对象确实加载了
 *
 * 插件额外的「面板打开后才有 DOM」用 activate(page) 表达，只对需要真实 DOM 的
 * 断言有用；纯 CSS 审计不需要它。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspaceDir } from './siyuan.mjs';

const readText = (file) => readFileSync(file, 'utf8');

/**
 * 主题适配器。
 *
 * CSS 读磁盘产物：它就是思源真正加载的那份，也是生产交付的那份。
 * 路径由调用方给（本仓约定是 dev/ 优先、回退 dist/，但不写死在包里）。
 */
export function themeTarget({ cssPath, cssPaths, themeName } = {}) {
  const candidates = cssPaths ?? (cssPath ? [cssPath] : ['./dev/theme.css', './dist/theme.css']);
  return {
    kind: 'theme',
    name: themeName ?? 'theme',

    async resolveCss() {
      for (const candidate of candidates) {
        try {
          return [{ label: candidate, text: await readText(candidate) }];
        } catch {
          // 试下一个
        }
      }
      throw new Error('找不到主题 CSS：试过 ' + candidates.join('、'));
    },

    async mountState(page) {
      const href = await page.evaluate(() => document.getElementById('themeStyle')?.getAttribute('href') ?? null);
      if (!href) {
        return { ok: false, loaded: null, reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）' };
      }
      const segment = href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
      if (!segment) {
        return { ok: false, loaded: null, reason: 'themeStyle 的 href 不是主题目录路径：' + href };
      }
      return { ok: true, loaded: decodeURIComponent(segment), reason: null };
    },
  };
}

/**
 * 插件适配器。
 *
 * CSS 读磁盘 `index.css`，与主题读 `dev/theme.css` 对称。实测磁盘文件与思源
 * 注入的 `<style id="pluginsStyle<name>">` **逐字节相同**（arco-calendar
 * 275334 字符、siyuan-plugin-publisher 492618 字符），所以没有理由绕道从页面读：
 *   - 读磁盘不依赖插件是否已加载，审计可以在插件出问题时照常跑
 *   - 不需要先把插件点开，纯 CSS 断言不受 UI 状态影响
 *
 * 插件目录按思源约定推导：`<workspace>/data/plugins/<name>/`，工作区从
 * workspace.json 读。也可以用 pluginDir 显式指定（插件源码在别处、或做 CI 时）。
 *
 * 无 index.css 的插件（如 Calendar-heatmap）返回空数组，退化成只做 DOM 断言。
 */
export function pluginTarget({ name, pluginDir = null } = {}) {
  if (!name) throw new Error('pluginTarget 需要插件名（plugin.json 的 name）');

  return {
    kind: 'plugin',
    name,

    /** 插件 CSS 的候选路径，按优先级排。找不到不是错误（有的插件只有 index.js）。 */
    cssCandidates() {
      const workspace = process.env.SIYUAN_WORKSPACE || findWorkspaceDir();
      return [
        pluginDir ? join(pluginDir, 'index.css') : null,
        workspace ? join(workspace, 'data', 'plugins', name, 'index.css') : null,
      ].filter(Boolean);
    },

    async resolveCss() {
      const candidates = this.cssCandidates();
      for (const candidate of candidates) {
        try {
          return [{ label: candidate, text: await readText(candidate) }];
        } catch {
          // 试下一个
        }
      }
      // 没有 index.css 不算失败：部分插件只有 index.js，退化成 DOM 断言。
      return [];
    },

    async mountState(page) {
      // 插件是否在运行：有 CSS 的插件会被思源注入 style 标签。
      // 没有该标签不算失败——可能是无 CSS 插件，也可能是插件没启用，
      // 后者会让 DOM 断言失败，比在这里硬判更准确。
      const state = await page.evaluate((pluginName) => {
        const styleEl = document.getElementById('pluginsStyle' + pluginName);
        return { hasStyle: Boolean(styleEl), styleLength: styleEl?.textContent?.length ?? 0 };
      }, name);

      if (!state) {
        return { ok: false, loaded: null, reason: '页面不可用，读不到插件状态' };
      }
      return {
        ok: true,
        loaded: state.hasStyle ? 'pluginsStyle' + name + '（' + state.styleLength + ' 字符）' : null,
        reason: state.hasStyle ? null : '插件没有注入样式表，只做 DOM 断言',
      };
    },
  };
}
