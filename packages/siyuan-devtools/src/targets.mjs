/**
 * 被测目标适配器：把「主题」「插件」以及未来其它类型的差异收敛到一个接口后面。
 *
 * 思源里这些东西的开发链路是同一条：
 *
 *   构建到 dev/  →  链接到 <workspace>/data/<subdir>/<name>  →  让思源重新加载
 *
 * 差别只在四处，全部由**类型描述符**吸收（见 target-types.mjs）：
 *   1. 产物叫什么        主题 theme.css；插件 index.js + index.css
 *   2. 清单叫什么        主题 theme.json；插件 plugin.json
 *   3. 装到哪个目录      data/themes；data/plugins
 *   4. 怎么重载          主题换 #themeStyle 的 href；插件只能重注入 CSS 或整页刷新
 *
 * 本文件提供两个东西：
 *   - 内置类型的描述符（theme / plugin），在模块加载时注册进注册表
 *   - `createTarget(kind, options)`：把描述符 + 具体参数组合成一个可用的 target 对象
 *
 * 加第三种类型（widget / iconset / 自定义）时只需要 registerTargetType()，
 * 不用改 dev.mjs、不用改 CLI——这条约束由测试钉住。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspaceDir } from './siyuan.mjs';
import { registerTargetType, targetType } from './target-types.mjs';
import { reloadPlugin, reloadPluginCss, reloadThemeCss, selectTheme } from './kernel.mjs';
import { resolveInstallDir } from './workspace.mjs';

const readText = (file) => readFileSync(file, 'utf8');

/** 项目目录下某个清单文件是否存在（detect 用）。 */
const hasManifest = (cwd, manifest) =>
  existsSync(join(cwd, 'public', manifest)) || existsSync(join(cwd, 'dist', manifest));

/**
 * 从清单读名字。
 *
 * 主题和插件的清单都有 name 字段，缺了就没法定位安装目录，
 * 所以这里返回 null 而不是猜一个默认值。
 */
export function readManifestName(cwd, manifest) {
  for (const file of [join(cwd, 'public', manifest), join(cwd, 'dist', manifest)]) {
    if (!existsSync(file)) continue;
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (name) return String(name).trim();
    } catch {
      // 继续下一个候选
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 内置类型：主题
// ---------------------------------------------------------------------------

registerTargetType(
  'theme',
  {
    manifestName: () => 'theme.json',
    installSubdir: () => 'themes',
    dirEnv: () => 'SIYUAN_THEME_DIR',
    outDir: () => './dev',
    artifact: () => 'theme.css',
    expectedFiles: () => ['theme.css', 'theme.json'],
    matchArtifact: (name) => name.endsWith('theme.css'),

    /**
     * 主题换 #themeStyle 的 href 即可，级联位置不变。纯前端动作，不需要 kernel、
     * 也不需要整页刷新——这是主题与插件最根本的差别。
     */
    async reload(page) {
      const ok = await reloadThemeCss(page);
      return { ok, message: ok ? '主题 CSS 已更新' : '主题 CSS 重载失败' };
    },

    /**
     * 开发前让思源真正选中本主题：否则预览的是宿主主题，量到的级联
     * （尤其 --b3-* 的取值）与生产不一致。这是主题独有的动作，插件不需要。
     */
    async activate(_page, { name, port }) {
      const selected = await selectTheme(port, name);
      if (!selected.ok) return { ok: false, message: selected.reason };
      return { ok: true, message: selected.changed ? '已切换到：' + name : '思源已选中：' + name };
    },

    /**
     * CSS 读磁盘产物：它就是思源真正加载的那份，也是生产交付的那份。
     * 路径由调用方给（本仓约定 dev/ 优先、回退 dist/，但不写死在包里）。
     */
    async resolveCss({ cssPath, cssPaths } = {}) {
      const candidates = cssPaths ?? (cssPath ? [cssPath] : ['./dev/theme.css', './dist/theme.css']);
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
  },
  { detect: (cwd) => hasManifest(cwd, 'theme.json') }
);

// ---------------------------------------------------------------------------
// 内置类型：插件
// ---------------------------------------------------------------------------

registerTargetType(
  'plugin',
  {
    manifestName: () => 'plugin.json',
    installSubdir: () => 'plugins',
    dirEnv: () => 'SIYUAN_PLUGIN_DIR',
    outDir: () => './dev',
    artifact: () => 'index.js',
    expectedFiles: () => ['index.js', 'plugin.json'],
    matchArtifact: (name) => name.endsWith('index.js') || name.endsWith('index.css'),

    /**
     * 一次构建会同时写 index.js 和 index.css。JS 变更会走 kernel 重建插件实例，
     * 新 CSS 会随之一起注入，所以优先按 JS 处理——一次重载就够，不用再补一次。
     */
    primaryArtifact: (filenames) => filenames.find((name) => name.endsWith('index.js')) ?? filenames[0],

    /**
     * 插件重载要分两种情况，因为思源用两种完全不同的机制加载它们：
     *
     *   index.css → 换 `<style id="pluginsStyle<name>">` 的 textContent。
     *               纯前端动作，页面不动，最快。
     *   index.js  → 插件 JS 是 `window.eval` 执行的、带副作用（注册 dock、顶栏、
     *               事件监听），换 style 撤销不了。必须经 kernel 的
     *               `/api/petal/setPetalEnabled` 禁用再启用，让思源完整重跑
     *               unload → 重新 eval → onload。也不能用整页刷新，那会丢掉
     *               用户正在编辑的文档和打开的面板。
     *
     * 分流逻辑留在描述符里，dev.mjs 不需要知道插件是怎么加载的。
     *
     * @returns {{ ok: boolean, message: string }}
     */
    async reload(page, { name, resolveCss, filename = '', port = null }) {
      if (filename.endsWith('.js')) {
        if (!port) return { ok: false, message: '插件 JS 重载需要 kernel 端口' };
        const result = await reloadPlugin(port, name);
        return result.ok ? { ok: true, message: '插件已重新加载' } : { ok: false, message: result.reason };
      }

      const sheets = await resolveCss();
      if (!sheets.length) return { ok: false, message: '找不到插件 CSS' };
      const ok = await reloadPluginCss(page, name, sheets[0].text);
      return { ok, message: ok ? '插件 CSS 已更新' : '插件 CSS 重载失败' };
    },

    /**
     * CSS 读磁盘 `index.css`，与主题读 `dev/theme.css` 对称。实测磁盘文件与
     * 思源注入的 `<style id="pluginsStyle<name>">` **逐字节相同**
     * （arco-calendar 275334 字符、siyuan-plugin-publisher 492618 字符）。
     *
     * 好处：不依赖插件是否已加载，插件出问题时审计照常跑；不需要先把插件点开。
     * 无 index.css 的插件（如 Calendar-heatmap）返回空数组，退化成只做 DOM 断言。
     */
    async resolveCss({ name, pluginDir = null } = {}) {
      const workspace = process.env.SIYUAN_WORKSPACE || findWorkspaceDir();
      const candidates = [
        pluginDir ? join(pluginDir, 'index.css') : null,
        workspace ? join(workspace, 'data', 'plugins', name, 'index.css') : null,
      ].filter(Boolean);

      for (const candidate of candidates) {
        try {
          return [{ label: candidate, text: await readText(candidate) }];
        } catch {
          // 试下一个
        }
      }
      return [];
    },

    async mountState(page, { name }) {
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
  },
  { detect: (cwd) => hasManifest(cwd, 'plugin.json') }
);

// ---------------------------------------------------------------------------
// 组合成 target 对象
// ---------------------------------------------------------------------------

/**
 * 造一个被测目标。
 *
 * @param kind     已注册的类型名
 * @param options.name      名字；缺省从清单读
 * @param options.cwd       项目目录（读清单用）
 * @param options.cssPath   显式指定 CSS 路径（主题）
 * @param options.pluginDir 显式指定插件目录
 * @param options.workspace 显式工作区（解析安装目录用）
 */
export function createTarget(kind, { name = null, cwd = process.cwd(), ...rest } = {}) {
  const descriptor = targetType(kind);
  const resolvedName = name ?? readManifestName(cwd, descriptor.manifestName());
  if (!resolvedName) {
    throw new Error(
      '读不到' +
        kind +
        '的名字：确认 ' +
        join(cwd, 'public', descriptor.manifestName()) +
        ' 里有 name 字段，或用 --name 指定'
    );
  }

  // context 里预先绑好 resolveCss：描述符内部（比如插件的 reload）需要读磁盘
  // 产物时直接用它，不必回调 target 的方法，也就不会出现 this 绑不上的问题。
  const resolveCss = () => descriptor.resolveCss(context);
  const context = { ...rest, cwd, name: resolvedName, resolveCss };

  const target = {
    kind,
    name: resolvedName,

    /** 供审计读取的 CSS 文本（都来自磁盘）。 */
    resolveCss,

    /** 确认被测对象确实加载了。 */
    mountState: (page) => descriptor.mountState(page, context),

    /** 构建看护用的参数。 */
    buildConfig: () => ({
      outDir: descriptor.outDir(context),
      artifact: descriptor.artifact(context),
      expectedFiles: descriptor.expectedFiles(context),
      match: (filename) => descriptor.matchArtifact(filename, context),
      /**
       * 一批产物同时变化时挑哪个作为重载依据。
       * 缺省取第一个；类型可覆盖（插件要优先 JS，因为它能连带更新 CSS）。
       */
      primary: (filenames) =>
        typeof descriptor.primaryArtifact === 'function'
          ? descriptor.primaryArtifact(filenames, context)
          : filenames[0],
    }),

    /** 链接目标目录：<workspace>/data/<subdir>。 */
    installDir: (options) =>
      resolveInstallDir({
        kind,
        subdir: descriptor.installSubdir(context),
        dirEnv: descriptor.dirEnv(context),
        ...options,
      }),

    /**
     * 让页面用上新产物。
     *
     * 通用层只负责把事实传进去（哪个文件变了、kernel 端口是多少），
     * 怎么重载由各类型的描述符自己决定。主题是纯 DOM 换 href，
     * 插件 CSS 换 <style>、JS 要经 kernel 重建实例——这些知识不进本文件。
     */
    reload: (page, { filename = '', port = null } = {}) => descriptor.reload(page, { ...context, filename, port }),

    /**
     * 开发前让宿主用上这个对象（可选）。
     * 主题需要经 kernel 切 themeLight/themeDark；插件由思源自己管启用状态，
     * 没有实现这个方法。通用层只问「有没有这个能力」，不做类型判断。
     */
    activate:
      typeof descriptor.activate === 'function'
        ? (_page, { port } = {}) => descriptor.activate(_page, { ...context, port })
        : null,
  };

  return target;
}

/**
 * 主题目标。保留这个名字是因为它比 createTarget('theme') 读起来清楚，
 * 且已有调用方（measure-cli、测试）在用。
 */
export function themeTarget(options = {}) {
  return createTarget('theme', options);
}

/** 插件目标。理由同上。 */
export function pluginTarget(options = {}) {
  return createTarget('plugin', options);
}
