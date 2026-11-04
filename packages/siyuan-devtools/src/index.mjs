/**
 * siyuan-devtools：在真实思源前端里测量渲染事实、驱动交互、人工复审。
 *
 * 设计原则：**只提供能力，不预设该查什么**。
 * 工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算「对」。
 * 它只负责把页面事实读出来，判断交给调用方。
 *
 * 三层：
 *
 *   会话层   session.mjs   浏览器生命周期、打开哪个前端、attach 复用
 *   测量层   measure.mjs   读令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
 *            actions.mjs   驱动交互（真实指针才能驱动 :hover）
 *            targets.mjs   被测对象适配（主题读 dev/theme.css，插件读 index.css）
 *            color.mjs     对比度计算（纯函数）
 *            lints.mjs     CSS 文本静态检查
 *   入口层   measure-cli.mjs / open.mjs / watch.mjs
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
export { callKernel, selectTheme, reloadThemeCss, currentTheme } from './theme-dev.mjs';
export { findChrome, findKernelPort, frontendUrl, findWorkspaceDir, MOBILE_VIEWPORT } from './siyuan.mjs';
