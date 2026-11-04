/**
 * vite-plugin-siyuan：思源主题/插件开发工具。
 *
 * 两种形态，同一套能力：
 *
 *   Vite 插件（推荐）          父项目 vite.config.ts 里加一行
 *     import siyuan from 'vite-plugin-siyuan/plugin'
 *     然后 `vite build --watch`，产物变了自动让思源重载。
 *
 *   CLI                        不用改 vite 配置，换任何构建器都能用
 *     siyuan-devtools dev
 *
 * 测量原语两者共用：在真实思源前端里读令牌/样式/盒模型、驱动交互。
 *
 * 设计原则：**只提供能力，不预设该查什么**。
 * 工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算「对」。
 * 它只负责把页面事实读出来，判断交给调用方。
 *
 * 分层：
 *
 *   会话层  session.ts        测量会话：浏览器生命周期、打开哪个前端、attach 复用
 *   测量层  measure.ts        读令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
 *           actions.ts        驱动交互（真实指针才能驱动 :hover）
 *           color.ts          对比度计算（纯函数）
 *           lints.ts          CSS 文本静态检查
 *           probes.ts         页面探针
 *   目标层  target-types.ts   被测类型的契约与注册表（可扩展）
 *           targets.ts        内置类型（theme / plugin）的描述符 + createTarget
 *           workspace.ts      工作区与安装目录解析
 *           link.ts           产物目录链接到安装目录
 *           theme.ts          主题身份与挂载判定
 *           kernel.ts         kernel 调用、主题/插件重载原语
 *   开发层  build.ts          起构建进程（默认 vite，可换），监听产物
 *           dev-session.ts    链接→激活→浏览器→重载的会话层（两形态共用）
 *           dev.ts            CLI 形态：自己起构建 + 会话
 *           plugin.ts         插件形态：挂进宿主 vite 的 writeBundle
 *           control-server.ts dev 会话的本地控制服务与端点发现
 *   入口层  cli.ts            统一命令，各 *-cli.ts 为独立命令
 */

// 会话层
export { createSession, parseViewport, viewportFor } from './session.ts';
export type { Session, CreateSessionOptions, ResolvedViewport } from './session.ts';

// 测量层
export { tokens, elementStyles, selectorCounts, elementBox, probeHtml, diffAfter, environment } from './measure.ts';
export type {
  DiffResult,
  ElementBox,
  ElementStyleReading,
  PageEnvironment,
  ProbeHtmlReading,
  SelectorCount,
} from './measure.ts';
export { runActions, snapshotRoot, ACTIONS } from './actions.ts';
export type { ActionSession, ActionVerb } from './actions.ts';
export { parseColor, luminance, contrastRatio } from './color.ts';
export type { Rgb } from './color.ts';
export { findDoubleWrappedColors, findProblemsIn } from './lints.ts';
export type { CssProblem, SourcedCssProblem, Sheet } from './lints.ts';
export { probeTokens, probeLive, probeEnvironment } from './probes.ts';
export type { ProbeLiveResult, ProbeLiveSpec, EnvironmentSnapshot } from './probes.ts';

// 目标层
export { createTarget, pluginTarget, themeTarget, readManifestName } from './targets.ts';
export type { Target, TargetBuildConfig, CreateTargetOptions } from './targets.ts';
export { detectTargetType, registerTargetType, targetType, targetTypes } from './target-types.ts';
export type {
  ActivateResult,
  CssSheet,
  DetectResult,
  MountState,
  RegisterOptions,
  ReloadResult,
  TargetDescriptor,
} from './target-types.ts';
export { judgeMount, readThemeName } from './theme.ts';
export type { MountJudgement } from './theme.ts';
export { callKernel, selectTheme, reloadThemeCss, reloadPluginCss, reloadPlugin, currentTheme } from './kernel.ts';
export type { KernelResponse, ReloadPluginResult, SelectThemeResult } from './kernel.ts';
export { listWorkspaces, readWorkspaceManifest, resolveInstallDir } from './workspace.ts';
export type { Workspace } from './workspace.ts';
export { checkLinkedFiles, detectLinkType, ensureLink, inspectLink, samePath } from './link.ts';
export type { EnsureLinkResult, LinkState } from './link.ts';
export { findChrome, findKernelPort, frontendUrl, findWorkspaceDir, MOBILE_VIEWPORT } from './siyuan.ts';
export type { Frontend } from './siyuan.ts';

// 开发层
export { startBuild, resolveViteBin, watchArtifact } from './build.ts';
export type { BuildCommand, BuildHandle, ArtifactWatcher } from './build.ts';
export { startDevSession } from './dev-session.ts';
export type { DevSession, StartDevSessionOptions } from './dev-session.ts';
export { startDev } from './dev.ts';
export type { DevHandle, StartDevOptions } from './dev.ts';
export { discover, endpointFiles, startControlServer, CONTROL_DIR } from './control-server.ts';
export type { ControlServer, DevSessionInfo, DiscoverResult } from './control-server.ts';

// 插件形态
export { default as siyuan } from './plugin.ts';
export type { SiYuanPluginOptions } from './plugin.ts';
