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
 * 分层（源码按目录对应，架构测试强制依赖方向）：
 *
 *   core/    被测对象契约与测量原语。不依赖 vite、不含 bin、不碰 process.exit。
 *            target-types.ts   被测类型的契约与注册表（可扩展）
 *            targets.ts        内置类型（theme / plugin）的描述符 + createTarget
 *            session.ts        测量会话：浏览器生命周期、打开哪个前端、attach 复用
 *            measure.ts        读令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
 *            actions.ts        驱动交互（真实指针才能驱动 :hover）
 *            probes.ts         页面探针
 *            color.ts          对比度计算（纯函数）
 *            lints.ts          CSS 文本静态检查
 *            theme.ts          主题身份与挂载判定
 *            workspace.ts      工作区与安装目录解析
 *            link.ts           产物目录链接到安装目录
 *            kernel.ts         kernel 调用、主题/插件重载原语
 *            siyuan.ts         找 kernel 端口 / Chrome / 拼前端 URL
 *            control-server.ts dev 会话的本地控制服务与端点发现
 *
 *   dev/     两种形态共用的开发链路。会起浏览器，但不依赖 vite 插件 API。
 *            build.ts          CLI 形态的构建看护（默认 vite，可换），监听产物
 *            dev-session.ts    链接→激活→浏览器→重载的会话层（两形态共用）
 *            dev.ts            CLI 形态：自己起构建 + 会话
 *
 *   plugin/  依赖 vite 的插件形态。
 *            plugin.ts         挂进宿主 vite 的 config / writeBundle
 *            assets.ts         public/ 监听 + 清单声明的元数据搬运
 *
 *   cli/     命令行入口与子命令。不实现 vite 插件钩子。
 *            cli.ts            统一入口，分派到各子命令
 *            cli-args.ts       裸参数解析（令牌名以 -- 开头，不能用通用解析器）
 *            dev-cli / link-cli / measure-cli / open / watch
 *   入口层  cli.ts            统一命令，各 *-cli.ts 为独立命令
 */

// 会话层
export { createSession, parseViewport, viewportFor } from './core/session.ts';
export type { Session, CreateSessionOptions, ResolvedViewport } from './core/session.ts';

// 测量层
export {
  tokens,
  elementStyles,
  selectorCounts,
  elementBox,
  probeHtml,
  diffAfter,
  environment,
} from './core/measure.ts';
export type {
  DiffResult,
  ElementBox,
  ElementStyleReading,
  PageEnvironment,
  ProbeHtmlReading,
  SelectorCount,
} from './core/measure.ts';
export { runActions, snapshotRoot, ACTIONS } from './core/actions.ts';
export type { ActionSession, ActionVerb } from './core/actions.ts';
export { parseColor, luminance, contrastRatio } from './core/color.ts';
export type { Rgb } from './core/color.ts';
export { findDoubleWrappedColors, findProblemsIn } from './core/lints.ts';
export type { CssProblem, SourcedCssProblem, Sheet } from './core/lints.ts';
export { probeTokens, probeLive, probeEnvironment } from './core/probes.ts';
export type { ProbeLiveResult, ProbeLiveSpec, EnvironmentSnapshot } from './core/probes.ts';

// 目标层
export { createTarget, pluginTarget, themeTarget, readManifestName } from './core/targets.ts';
export type { Target, TargetBuildConfig, CreateTargetOptions } from './core/targets.ts';
export { detectTargetType, registerTargetType, targetType, targetTypes } from './core/target-types.ts';
export type {
  ActivateResult,
  CssSheet,
  DetectResult,
  MountState,
  RegisterOptions,
  ReloadResult,
  TargetDescriptor,
} from './core/target-types.ts';
export { judgeMount, readThemeName } from './core/theme.ts';
export type { MountJudgement } from './core/theme.ts';
export { callKernel, selectTheme, reloadThemeCss, reloadPluginCss, reloadPlugin, currentTheme } from './core/kernel.ts';
export type { KernelResponse, ReloadPluginResult, SelectThemeResult } from './core/kernel.ts';
export { listWorkspaces, readWorkspaceManifest, resolveInstallDir } from './core/workspace.ts';
export type { Workspace } from './core/workspace.ts';
export { checkLinkedFiles, detectLinkType, ensureLink, inspectLink, samePath } from './core/link.ts';
export type { EnsureLinkResult, LinkState } from './core/link.ts';
export { findChrome, findKernelPort, frontendUrl, findWorkspaceDir, MOBILE_VIEWPORT } from './core/siyuan.ts';
export type { Frontend } from './core/siyuan.ts';

// 开发层
export { startBuild, resolveViteBin, watchArtifact } from './dev/build.ts';
export type { BuildCommand, BuildHandle, ArtifactWatcher } from './dev/build.ts';
export { startDevSession } from './dev/dev-session.ts';
export type { DevSession, StartDevSessionOptions } from './dev/dev-session.ts';
export { startDev } from './dev/dev.ts';
export type { DevHandle, StartDevOptions } from './dev/dev.ts';
export { discover, endpointFiles, startControlServer, CONTROL_DIR } from './core/control-server.ts';
export type { ControlServer, DevSessionInfo, DiscoverResult } from './core/control-server.ts';

// 插件形态
export { default as siyuan } from './plugin/plugin.ts';
export type { SiYuanPluginOptions } from './plugin/plugin.ts';
export { default as siyuanAssets } from './plugin/assets.ts';
export type { AssetsPluginOptions } from './plugin/assets.ts';
