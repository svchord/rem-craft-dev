/**
 * siyuan-devkit：思源主题/插件开发工具。
 *
 * 两种形态，同一套能力：
 *
 *   Vite 插件（推荐）          父项目 vite.config.ts 里加一行
 *     import siyuan from 'siyuan-devkit/plugin'
 *     然后 `vite build --watch`，产物变了自动让思源重载。
 *
 *   CLI                        给 agent / CI 用的审计与检查入口
 *     syt measure audit
 *
 * 测量原语两者共用：在真实思源前端里读令牌/样式/盒模型、驱动交互。
 *
 * 设计原则：**只提供能力，不预设该查什么**。
 * 工具不知道你的主题/插件有哪些组件、哪些颜色该配在一起、什么值算「对」。
 * 它只负责把页面事实读出来，判断交给调用方。
 *
 * 分层（源码按目录对应；`tests/` 用导入方向做架构检查）：
 *
 *   core/    被测对象契约、测量原语与运行时胶水。不依赖 vite、不含 bin、不碰 process.exit。
 *            measure.ts / page-read.ts / actions.ts / probes.ts        页面读取与交互
 *            color.ts / lints.ts / theme.ts / semver.ts                纯函数与静态检查
 *            session.ts / viewport.ts / siyuan.ts / kernel.ts / net.ts 会话、端口与 kernel
 *            workspace.ts / link.ts / paths.ts                         工作区与目录
 *            target-types.ts / targets.ts / builtin-targets.ts         类型契约、注册表、内置描述符
 *            verify.ts / audit.ts / audit-config.ts                    校验与审计
 *            log.ts / control-server.ts / errors.ts / timing.ts       共享契约与运行支撑
 *
 *   dev/     两种形态共用的开发链路。会起浏览器，但不依赖 vite 插件 API。
 *            build.ts          构建看护（默认 vite，可换），监听产物
 *            dev-session.ts    链接→激活→浏览器→重载的会话层（两形态共用）
 *            dev.ts            startDev 程序 API：自己起构建 + 会话
 *
 *   plugin/  依赖 vite 的插件形态。
 *            plugin.ts         挂进宿主 vite 的 config / writeBundle
 *            assets.ts         public/ 监听 + 清单声明的元数据搬运
 *            post.ts           enforce:'post' 收尾：校验产物 + 打 package.zip
 *            state.ts          共享的 watch 状态与 root/outDir 归一化
 *            shared.ts         walkFiles / 类型守卫等小工具
 *
 *   cli/     命令行入口与子命令。不实现 vite 插件钩子。
 *            cli.ts            唯一入口，分派到各子命令处理函数
 *            cli-args.ts       裸参数解析（令牌名以 -- 开头，不能用通用解析器）
 *            ui.ts             纯文本输出（无颜色/图标/边框；结构化数据走 --json）
 *            measure-cli / shot / verify-cli / audit / targets
 *            各 runXCli 是纯导出的处理函数，不自动执行，也不各自暴露 bin。
 */

// 日志契约：三条链路（主题/插件/CLI）共用，放在 core 以免 plugin 反向依赖 dev
export type { LogLevel, Logger } from './core/log.ts';
export { DEFAULT_LOG_LEVEL } from './core/log.ts';

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
export { probeTokens } from './core/probes.ts';

// 审计计划：一次会话跑完多项测量（避免每次子命令都要重新起进程连 CDP）
export { runPlan, validatePlan, planIsEmpty, DEFAULT_PROPS } from './core/audit.ts';
export type { AuditPlan, AuditResult, DiffQuery, ProbeQuery, StyleQuery } from './core/audit.ts';
export { loadConfig, mergePlan, DEFAULT_CONFIG_NAME } from './core/audit-config.ts';
export type { LoadedConfig, PlanOverrides } from './core/audit-config.ts';

// 产物校验（构建时由收尾插件调用；也可直接调用，或用 `syt verify` 子命令）
export { verifyTarget, formatIssues } from './core/verify.ts';
export type { VerifyResult, VerifyOptions } from './core/verify.ts';

// 目标层
export { createTarget, pluginTarget, themeTarget, readManifestName } from './core/targets.ts';
export type { Target, TargetBuildConfig, CreateTargetOptions } from './core/targets.ts';
export {
  detectTargetType,
  registerTargetType,
  targetType,
  targetTypes,
  createTargetTypeRegistry,
} from './core/target-types.ts';
export type {
  ActivateResult,
  CssSheet,
  DetectResult,
  MountState,
  RegisterOptions,
  TargetDescriptor,
  TargetTypeEntry,
  TargetTypeRegistry,
} from './core/target-types.ts';
export { BUILTIN_TYPES } from './core/builtin-targets.ts';
export { judgeMount, readThemeName } from './core/theme.ts';
export type { MountJudgement } from './core/theme.ts';
export { callKernel, selectTheme } from './core/kernel.ts';
export type { KernelResponse, SelectThemeResult } from './core/kernel.ts';
export { listWorkspaces, readWorkspaceManifest, resolveInstallDir } from './core/workspace.ts';
export type { Workspace } from './core/workspace.ts';
export { checkLinkedFiles, detectLinkType, ensureLink, inspectLink, samePath } from './core/link.ts';
export type { EnsureLinkResult, LinkState } from './core/link.ts';
export {
  findChrome,
  findKernelPort,
  frontendUrl,
  frontendLinks,
  findWorkspaceDir,
  MOBILE_VIEWPORT,
} from './core/siyuan.ts';
export type { Frontend, FrontendLink } from './core/siyuan.ts';

// 开发层
export { startBuild, resolveViteBin, watchArtifact } from './dev/build.ts';
export type { BuildCommand, BuildHandle, ArtifactWatcher } from './dev/build.ts';
export { startDevSession } from './dev/dev-session.ts';
export type { DevSession, StartDevSessionOptions } from './dev/dev-session.ts';
export { startDev } from './dev/dev.ts';
export type { DevHandle, StartDevOptions } from './dev/dev.ts';
export { discover, endpointFiles, startControlServer, CONTROL_DIR } from './core/control-server.ts';
export type { ControlServer, DevSessionInfo, DiscoverResult } from './core/control-server.ts';

// 插件形态：三个可单独组合的插件（热重载 / 产物资产 / 收尾校验+打包）
export { default as siyuanPlugin } from './plugin/plugin.ts';
/** @deprecated 用 `siyuanPlugin`；`siyuan` 与思源官方 SDK 包同名，容易混淆。 */
export { default as siyuan } from './plugin/plugin.ts';
export type { SiYuanPluginOptions } from './plugin/plugin.ts';
export { default as siyuanAssets } from './plugin/assets.ts';
export type { AssetsPluginOptions, AssetLog } from './plugin/assets.ts';
export { siyuanPost, writeZip, PACKAGE_NAME } from './plugin/post.ts';
export type { PostPluginOptions } from './plugin/post.ts';
export { createPluginState, applyResolvedConfig, isWatchBuild } from './plugin/state.ts';
export type { PluginState } from './plugin/state.ts';
export { walkFiles } from './plugin/shared.ts';
export type { WalkedFile } from './plugin/shared.ts';
