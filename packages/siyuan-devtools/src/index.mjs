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
 *   目标层   target-types.mjs 被测类型的契约与注册表（可扩展）
 *            targets.mjs   内置类型（theme / plugin）的描述符 + createTarget
 *            workspace.mjs 工作区与安装目录解析
 *            link.mjs      产物目录链接到安装目录
 *            theme.mjs     主题身份与挂载判定
 *            theme-dev.mjs 切换主题、重载主题/插件 CSS
 *   开发层   build.mjs     起构建进程（默认 vite，可换），监听产物
 *            dev.mjs       构建→链接→加载→热重载的完整循环
 *
 * 入口层   cli.mjs 统一命令，各 *-cli.mjs 为独立命令
 *
 * 典型用法（命令行，不用写脚本）：
 *
 *   npx siyuan-devtools dev              # 类型从 public/ 清单自动推断
 *   npx siyuan-devtools measure tokens --rc-brand-8 --attach
 *
 * 典型用法（编程方式）：
 *
 *   import { createSession, tokens, contrastRatio } from 'siyuan-devtools';
 *
 *   const session = await createSession({ frontend: 'desktop' });
 *   try {
 *     const values = await tokens(session.page, ['--rc-text-primary', '--rc-bg-page']);
 *     const ratio = contrastRatio(values['--rc-text-primary'], values['--rc-bg-page']);
 *   } finally {
 *     await session.dispose();
 *   }
 */
export { createSession, parseViewport, viewportFor } from './session.mjs';
export { tokens, elementStyles, selectorCounts, elementBox, probeHtml, diffAfter, environment } from './measure.mjs';
export { runActions, snapshotRoot, ACTIONS } from './actions.mjs';
export { createTarget, pluginTarget, themeTarget, readManifestName } from './targets.mjs';
export { detectTargetType, registerTargetType, targetType, targetTypes } from './target-types.mjs';
export { parseColor, luminance, contrastRatio } from './color.mjs';
export { findDoubleWrappedColors, findProblemsIn } from './lints.mjs';
export { judgeMount, readThemeName } from './theme.mjs';
export { callKernel, selectTheme, reloadThemeCss, reloadPluginCss, reloadPlugin, currentTheme } from './theme-dev.mjs';
export { findChrome, findKernelPort, frontendUrl, findWorkspaceDir, MOBILE_VIEWPORT } from './siyuan.mjs';
export { listWorkspaces, readWorkspaceManifest, resolveInstallDir } from './workspace.mjs';
export { checkLinkedFiles, detectLinkType, ensureLink, inspectLink, samePath } from './link.mjs';
export { findEndpoint, registerEndpoint, unregisterEndpoint, REGISTRY_FILE } from './cdp-registry.mjs';
export { resolveViteBin, startBuild, watchArtifact } from './build.mjs';
export { startDev } from './dev.mjs';
