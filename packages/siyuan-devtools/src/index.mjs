/**
 * siyuan-devtools：在真实思源前端里测量渲染事实、驱动交互、开发主题与插件。
 *
 * 设计原则：**只提供能力，不预设该查什么**。
 * 工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算「对」。
 * 它只负责把页面事实读出来，判断交给调用方。
 *
 * 四层：
 *
 *   会话层   session.mjs   浏览器生命周期、打开哪个前端、attach 复用
 *   测量层   measure.mjs   读令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
 *            actions.mjs   驱动交互（真实指针才能驱动 :hover）
 *            color.mjs     对比度计算（纯函数）
 *            lints.mjs     CSS 文本静态检查
 *   目标层   targets.mjs   主题与插件的差异（产物名、清单名、安装目录、重载方式）
 *            workspace.mjs 工作区与 data/themes|plugins 解析
 *            link.mjs      dev/ 链接到安装目录（symlink / junction）
 *            theme.mjs     主题身份与挂载判定
 *            theme-dev.mjs 切换主题、重载主题/插件 CSS
 *   开发层   build.mjs     起 vite build --watch，监听产物
 *            dev.mjs       构建→链接→加载→热重载的完整循环
 *
 * 入口层   measure-cli.mjs / open.mjs / watch.mjs / dev-cli.mjs / link-cli.mjs
 *
 * 典型用法（编程方式）：
 *
 *   import { createSession, tokens, elementStyles, contrastRatio } from 'siyuan-devtools';
 *
 *   const session = await createSession({ frontend: 'desktop' });
 *   try {
 *     const values = await tokens(session.page, ['--rc-text-primary', '--rc-bg-page']);
 *     const ratio = contrastRatio(values['--rc-text-primary'], values['--rc-bg-page']);
 *     const styles = await elementStyles(session.page, '.b3-menu__item', ['display', 'gap']);
 *   } finally {
 *     await session.dispose();
 *   }
 */
export { createSession, parseViewport, viewportFor } from './session.mjs';
export { tokens, elementStyles, selectorCounts, elementBox, probeHtml, diffAfter, environment } from './measure.mjs';
export { runActions, snapshotRoot, ACTIONS } from './actions.mjs';
export { themeTarget, pluginTarget } from './targets.mjs';
export { parseColor, luminance, contrastRatio } from './color.mjs';
export { findDoubleWrappedColors, findProblemsIn } from './lints.mjs';
export { judgeMount, readThemeName } from './theme.mjs';
export { callKernel, selectTheme, reloadThemeCss, reloadPluginCss, currentTheme } from './theme-dev.mjs';
export { findChrome, findKernelPort, frontendUrl, findWorkspaceDir, MOBILE_VIEWPORT } from './siyuan.mjs';
export { listWorkspaces, readWorkspaceManifest, resolveInstallDir } from './workspace.mjs';
export { checkLinkedFiles, detectLinkType, ensureLink, inspectLink, samePath } from './link.mjs';
export { findEndpoint, registerEndpoint, unregisterEndpoint, REGISTRY_FILE } from './cdp-registry.mjs';
export { resolveViteBin, startBuild, watchArtifact } from './build.mjs';
export { startDev } from './dev.mjs';
