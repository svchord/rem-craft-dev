/**
 * `createTarget`：把描述符 + 调用方给的选项绑成一个 Target。
 *
 * 内置描述符（theme / plugin）在 builtin-targets.ts，由 target-types.ts 的默认
 * 注册表惰性播种——不需要为了「有注册表」而副作用 import 本文件。
 *
 * Target 只做两件事：把 context（名字/cwd/选项/预绑定的 resolveCss）绑好，
 * 以及把「一次批量产物该挑哪个」这类编排事实补进描述符入参。之前这里把
 * 描述符的每个方法逐个包一层、还写了 45 行重复的 JSDoc，现在收敛成一次绑定。
 */
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { resolveInstallDir } from './workspace.ts';
import { readManifestName } from './theme.ts';
import { targetType } from './target-types.ts';
import type {
  ActivateResult,
  BuildContext,
  CssSheet,
  MountState,
  ReloadResult,
  TargetBuildSpec,
  TargetBuildSpecOptions,
  TargetContext,
  TargetDescriptor,
} from './target-types.ts';

/** 兼容既有导入：读清单名字的实现现在只在 theme.ts 一份。 */
export { readManifestName } from './theme.ts';

/** 构建看护需要的参数。 */
export interface TargetBuildConfig {
  outDir: string;
  artifact: string;
  expectedFiles: string[];
  match(filename: string): boolean;
  /** 一批产物变化时挑主产物：一律取第一个（插件 JS 能连带更新 CSS 的假设已移除）。 */
  primary(filenames: string[]): string;
}

/** 对外的被测目标。编排层只认这个接口。 */
export interface Target {
  readonly kind: string;
  readonly name: string;
  resolveCss(): Promise<CssSheet[]>;
  mountState(page: Page): Promise<MountState>;
  buildConfig(): TargetBuildConfig;
  installDir(options?: { workspace?: string | null; port?: number | null }): Promise<string>;
  reload(page: Page | null, options?: { filename?: string; port?: number | null }): Promise<ReloadResult>;
  /** 生成构建配置片段；描述符没实现时返回 null。 */
  buildSpec(context: BuildContext, options?: TargetBuildSpecOptions): TargetBuildSpec | null;
  /** 描述符本身：校验时要用它的 verifyManifest / verifyArtifact。 */
  readonly descriptor: TargetDescriptor;
  /** 开发前让宿主用上它（可选）。 */
  activate: ((page: Page | null, options?: { port?: number | null }) => Promise<ActivateResult>) | null;
}

export interface CreateTargetOptions {
  name?: string | null;
  cwd?: string;
  /** 主题专用：显式 CSS 路径。 */
  cssPath?: string;
  /** 主题专用：多个 CSS 候选。 */
  cssPaths?: string[];
  /** 插件专用：显式插件目录。 */
  pluginDir?: string | null;
}

/** 主题独有的构造参数。 */
export interface ThemeTargetOptions {
  cssPath?: string;
  cssPaths?: string[];
  name?: string | null;
  cwd?: string;
}

/** 插件独有的构造参数。 */
export interface PluginTargetOptions {
  name: string;
  pluginDir?: string | null;
  cwd?: string;
}

/** 造一个被测目标。 */
export function createTarget(kind: string, options: CreateTargetOptions = {}): Target {
  const { name = null, cwd = process.cwd(), cssPath, cssPaths, pluginDir } = options;
  const descriptor = targetType(kind).descriptor;
  const resolvedName = name ?? readManifestName(cwd, descriptor.manifestName());
  if (!resolvedName) {
    throw new Error(
      `读不到${kind}的名字：确认 ${join(cwd, 'public', descriptor.manifestName())} 里有 name 字段，或用 name 指定`
    );
  }

  // 显式字段、无动态属性袋；resolveCss 预绑定后描述符内部直接用，不依赖 this。
  const context: TargetContext = {
    name: resolvedName,
    cwd,
    cssPath,
    cssPaths,
    pluginDir,
    resolveCss: () => descriptor.resolveCss(context),
  };

  const buildConfig = (): TargetBuildConfig => ({
    outDir: descriptor.outDir(),
    artifact: descriptor.artifact(),
    expectedFiles: descriptor.expectedFiles(),
    match: (filename) => descriptor.matchArtifact(filename),
    primary: (filenames) => filenames[0] ?? '',
  });

  const activate = descriptor.activate;

  return {
    kind,
    name: resolvedName,
    descriptor,
    resolveCss: context.resolveCss,
    mountState: (page) => descriptor.mountState(page, context),
    buildConfig,
    buildSpec: (buildContext: BuildContext, specOptions: TargetBuildSpecOptions = {}) =>
      descriptor.buildSpec ? descriptor.buildSpec(buildContext, specOptions) : null,
    installDir: (opts = {}) =>
      resolveInstallDir({
        kind,
        subdir: descriptor.installSubdir(),
        dirEnv: descriptor.dirEnv(),
        workspace: opts.workspace ?? null,
        port: opts.port ?? null,
      }),
    reload: (page, { filename = '', port = null } = {}) => descriptor.reload(page, { ...context, filename, port }),
    activate: activate ? (page, opts = {}) => activate(page, { ...context, port: opts.port ?? null }) : null,
  };
}

/** 主题目标。比 createTarget('theme') 读起来清楚。 */
export function themeTarget(options: ThemeTargetOptions = {}): Target {
  return createTarget('theme', options);
}

/** 插件目标。理由同上。 */
export function pluginTarget(options: PluginTargetOptions): Target {
  return createTarget('plugin', options);
}
