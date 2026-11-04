/**
 * 被测目标适配器：把「主题」和「插件」的差异收敛到一个接口后面。
 *
 * 主题与插件在思源里是两套东西，但**开发链路是同一条**：
 *
 *   构建到 dev/  →  链接到 <workspace>/data/<themes|plugins>/<name>  →  让思源重新加载
 *
 * 差别只有四处，全部由这里吸收：
 *   1. 产物叫什么        主题 theme.css；插件 index.js + index.css
 *   2. 清单叫什么        主题 public/theme.json；插件 public/plugin.json
 *   3. 装到哪个目录      data/themes；data/plugins
 *   4. 怎么重载          主题换 #themeStyle 的 href；插件只能整页刷新或重注入 CSS
 *
 * 所以适配器对外提供同一组能力：
 *   resolveCss()       → [{ label, text }]     要审计的 CSS 文本（都读磁盘）
 *   mountState(page)   → { ok, loaded, reason } 确认被测对象确实加载了
 *   buildConfig()      → { outDir, artifact }   构建看护用的参数
 *   installDir()       → string                 链接目标目录
 *   reload(page)       → boolean                让页面用上新产物
 *
 * 插件额外的「面板打开后才有 DOM」用 activate(page) 表达，只对需要真实 DOM 的
 * 断言有用；纯 CSS 审计不需要它。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspaceDir } from './siyuan.mjs';
import { reloadPluginCss, reloadThemeCss } from './theme-dev.mjs';
import { resolveInstallDir } from './workspace.mjs';

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

    /** 构建产物：只有一个 theme.css。 */
    buildConfig() {
      return {
        outDir: './dev',
        artifact: 'theme.css',
        expectedFiles: ['theme.css', 'theme.json'],
        match: (name) => name.endsWith('theme.css'),
      };
    },

    installDir(options) {
      return resolveInstallDir({ kind: 'theme', ...options });
    },

    /** 主题换 #themeStyle 的 href 即可，级联位置不变。 */
    reload(page) {
      return reloadThemeCss(page);
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

    /** 构建产物：插件有 js 和 css 两份，任一变化都要重载。 */
    buildConfig() {
      return {
        outDir: './dev',
        artifact: 'index.js',
        expectedFiles: ['index.js', 'plugin.json'],
        match: (name) => name.endsWith('index.js') || name.endsWith('index.css'),
      };
    },

    installDir(options) {
      return resolveInstallDir({ kind: 'plugin', ...options });
    },

    /**
     * 插件重载只能重注入 CSS。
     *
     * 查过内核：没有 `/api/plugin/*` 写接口（实测 404），`reloadPlugin` 是
     * WebSocket 推送的分支，HTTP 侧触发不了。所以产物变了之后：
     *   - CSS 可以直接换 <style> 的 textContent，页面立即生效
     *   - JS 必须整页刷新（换 style 不会重新执行 index.js）
     *
     * 这里只做 CSS 重注入；JS 变化时调用方应当 page.reload()。
     */
    async reload(page) {
      const sheets = await this.resolveCss();
      if (!sheets.length) return false;
      return reloadPluginCss(page, name, sheets[0].text);
    },
  };
}
