/**
 * 被测目标的**契约**与类型注册表。
 *
 * 思源里主题、插件、以及外部项目未来注册的 widget / iconset 各有一套清单与加载
 * 方式。把「一类被测对象」抽象成一份描述符（TargetDescriptor），新类型用
 * registerTargetType() 注册即可，编排层不需要长出 kind 分支。
 *
 * 能力完整性由 TargetDescriptor **接口在编译期**约束（`satisfies TargetDescriptor`），
 * 运行时不再维护一份能力清单：那和接口是同一份知识的两种写法，改接口容易漏改。
 *
 * 内置类型（theme / plugin）在 builtin-targets.ts 里以显式常量 BUILTIN_TYPES
 * 声明，由默认注册表**惰性播种**。因此单独 import 本文件就有一个可用的注册表，
 * 不需要为了触发注册而副作用 import targets.ts。
 */
import type { Page } from 'puppeteer-core';
import { BUILTIN_TYPES } from './builtin-targets.ts';

/** 要审计的 CSS 文本（都来自磁盘）。 */
export interface CssSheet {
  /** 来源标签，报错/输出时用（通常是文件路径）。 */
  label: string;
  text: string;
}

/** 挂载判定结果。 */
export interface MountState {
  /** 是否可以用来测量。插件没有样式表时仍算 ok（退化成 DOM 断言）。 */
  ok: boolean;
  /** 读到的东西；`null` 表示确实没有样式表。 */
  loaded: string | null;
  /** ok=false 时说明原因。 */
  reason: string | null;
}

/** 激活结果（开发前让宿主用上本对象）。 */
export interface ActivateResult {
  ok: boolean;
  message: string;
}

/**
 * 描述符收到的上下文：名字、项目目录、预绑定好的 resolveCss，
 * 以及各内置类型专有的可选参数。
 *
 * 字段全部显式声明——之前用 `TargetContext & Record<string, unknown>` 当属性袋，
 * 描述符里到处是 `context as ThemeContext` 这类断言。现在靠字段就能取到选项。
 * `resolveCss` 预先绑好：描述符内部读磁盘产物时直接用，
 * 不必回调 target 的方法，也就不会出现 this 绑不上的问题。
 */
export interface TargetContext {
  /** 被测对象的名字（清单里的 name）。 */
  readonly name: string;
  /** 项目目录。 */
  readonly cwd: string;
  /** 读磁盘上的 CSS；插件无 CSS 时返回空数组。 */
  readonly resolveCss: () => Promise<CssSheet[]>;
  /** 主题专用：显式 CSS 路径。 */
  readonly cssPath?: string;
  /** 主题专用：多个 CSS 候选路径，按顺序试。 */
  readonly cssPaths?: string[];
  /** 插件专用：显式插件目录。 */
  readonly pluginDir?: string | null;
}

/** 激活时由编排层传进来的事实。 */
export interface ActivateContext extends TargetContext {
  readonly port: number | null;
}

/** 构建配置的生成参数（由插件注入，描述符据此产出产物命名等片段）。 */
export interface BuildContext {
  /** Vite 命令：build 时才有产物。 */
  readonly command: 'build' | 'serve';
  /** 是否 watch 模式（开发）。 */
  readonly watch: boolean;
  /** 项目根目录。 */
  readonly root: string;
}

/**
 * 描述符产出的构建片段，会被 mergeConfig 进用户配置。
 *
 * 只放「思源加载机制决定的」部分；minify / sourcemap / target 这些归项目。
 * 统一用 rollupOptions.input 而不是 lib：lib 隐含 cssCodeSplit:false，CSS 入口
 * 与它冲突（Vite 直接报错），而主题是纯 CSS 入口。两种类型的差别只在 output。
 */
export interface TargetBuildSpec {
  /** 产物相对目录，如 `./dev`。 */
  outDir?: string;
  /** rollup 的 input；entry 入参解析后的绝对路径。 */
  input?: string;
  /** rollup 产物命名与模块格式。 */
  rollupOutput?: {
    /** 资源文件命名（CSS 就在这里定名）。 */
    assetFileNames?: (info: { name?: string | null }) => string;
    /** JS 入口命名。 */
    entryFileNames?: string;
    /** 模块格式。插件必须是 cjs（思源用 window.eval 执行 CJS 包装）。 */
    format?: 'cjs' | 'es';
  };
  /**
   * 走 Vite 的 `build.lib`（插件用）。lib + `formats:['cjs']` 会把 `export default`
   * 编成 `module.exports = ...`，正是思源 `window.eval(...)` 后要取的东西；而普通
   * input + `output.format:'cjs'` 只产出 `exports.default`，思源会报
   * "plugin xxx has no export"（rolldown 也不支持 `output.exports:'default'`）。
   * 主题是纯 CSS 入口，仍走 input。
   */
  lib?: {
    entry: string;
    fileName?: string;
    cssFileName?: string;
    formats?: Array<'cjs' | 'es'>;
  };
  /** 必须保持外部的模块。 */
  external?: string[];
  /** 产物目录不该在 watch 时清空——思源正读着它。 */
  emptyOutDir?: boolean;
}

/** buildSpec 的输入。 */
export interface TargetBuildSpecOptions {
  /** 入口文件的绝对路径；不给则用描述符的默认入口。 */
  entry?: string | null;
}

/** 校验时收到的事实。 */
export interface VerifyContext {
  /** 项目根目录。 */
  readonly root: string;
  /**
   * 产物目录里的所有文件，**相对产物根的路径**（如 `i18n/en.json`）。
   * 与通用校验用的是同一份列表，一次遍历得到。
   */
  readonly files: string[];
  /** 读产物目录里的文件内容；路径相对产物根；不存在返回 null。 */
  readOutput(file: string): string | null;
  /** 读清单（已解析）；读不到返回 null。 */
  readonly manifest: Record<string, unknown> | null;
  /** package.json（已解析）；读不到返回 null。 */
  readonly packageJson: Record<string, unknown> | null;
}

/** 一条校验问题。 */
export interface VerifyIssue {
  /** 一句话说明哪里错了。 */
  message: string;
  /** 建议怎么改（可选）。 */
  hint?: string;
}

/**
 * 一类被测对象的描述符（公开契约，外部项目注册新类型时实现它）。
 * 除标注为可选的外全部必需；缺一个就说明抽象漏了，写描述符时用
 * `satisfies TargetDescriptor` 在编译期报错。
 */
export interface TargetDescriptor {
  /** 清单文件名，如 'theme.json'。 */
  manifestName(): string;
  /** 安装子目录，如 'themes'。 */
  installSubdir(): string;
  /** 覆盖安装目录的环境变量名，如 'SIYUAN_THEME_DIR'。 */
  dirEnv(): string;
  /** 构建产物目录。 */
  outDir(): string;
  /** 首个产物；等它出现即视为构建就绪。 */
  artifact(): string;
  /** 链接后必须存在的文件。 */
  expectedFiles(): string[];

  /** 产物变化时是否触发重载。 */
  matchArtifact(filename: string): boolean;

  /**
   * 生成构建配置片段（可选）。产物命名与模块格式由思源的加载机制决定：
   * 主题读 theme.css、插件读 index.js + index.css，且插件必须是 CJS 单文件。
   */
  buildSpec?(context: BuildContext, options: TargetBuildSpecOptions): TargetBuildSpec;

  /**
   * 类型特有的清单校验（可选）。通用规则（版本一致、必需字段、semver、
   * i18n 的 default 项）在 core/verify.ts 里，这里只放各类型独有的部分。
   */
  verifyManifest?(context: VerifyContext): VerifyIssue[];

  /** 产物校验（可选）。通用部分（expectedFiles 齐不齐）在 core/verify.ts 里。 */
  verifyArtifact?(context: VerifyContext): VerifyIssue[];

  /** 要审计的 CSS 文本。 */
  resolveCss(context: TargetContext): Promise<CssSheet[]>;

  /** 确认被测对象确实加载了。 */
  mountState(page: Page, context: TargetContext): Promise<MountState>;

  /**
   * 开发前让宿主用上本对象（可选）。主题需要经 kernel 切主题；
   * 插件由思源自己管启用状态，不实现。
   */
  activate?(page: Page | null, context: ActivateContext): Promise<ActivateResult>;
}

/** 注册时可选的额外信息。 */
export interface RegisterOptions {
  /** 给定项目目录返回 true 表示「这个目录是该类型」，用于自动推断。 */
  detect?: ((cwd: string) => boolean) | null;
}

/** 注册表里存的是描述符 + 类型名 + 可选的自动推断函数。 */
export interface TargetTypeEntry {
  readonly kind: string;
  readonly detect: ((cwd: string) => boolean) | null;
  readonly descriptor: TargetDescriptor;
}

/** 类型推断结果。 */
export type DetectResult = { ok: true; kind: string } | { ok: false; reason: string };

/** 一个显式的注册表实例：想隔离状态（比如测试）就自己造一个。 */
export interface TargetTypeRegistry {
  register<T extends TargetDescriptor>(kind: string, descriptor: T, options?: RegisterOptions): string;
  list(): string[];
  get(kind: string): TargetTypeEntry;
  detect(cwd: string): DetectResult;
}

/** 由一份种子显式构造注册表，没有模块级可变状态。 */
export function createTargetTypeRegistry(seed: readonly TargetTypeEntry[] = []): TargetTypeRegistry {
  const types = new Map<string, TargetTypeEntry>(seed.map((entry) => [entry.kind, entry]));

  const list = (): string[] => [...types.keys()];

  return {
    register(kind, descriptor, options = {}) {
      types.set(kind, { kind, detect: options.detect ?? null, descriptor });
      return kind;
    },
    list,
    get(kind) {
      const found = types.get(kind);
      if (!found) throw new Error(`未知的被测类型：${kind}（已注册：${list().join(' / ')}）`);
      return found;
    },
    detect(cwd) {
      const matches: string[] = [];
      for (const entry of types.values()) {
        if (entry.detect?.(cwd)) matches.push(entry.kind);
      }
      const only = matches[0];
      if (matches.length === 1 && only !== undefined) return { ok: true, kind: only };
      if (matches.length === 0) {
        return {
          ok: false,
          reason: `在 ${cwd} 的 public/ 下找不到任何已知清单（${list().join(' / ')}），请用 kind 显式指定类型`,
        };
      }
      return { ok: false, reason: `同时匹配到多种类型：${matches.join('、')}，请用 kind 指定` };
    },
  };
}

/**
 * 包级默认注册表：惰性由 BUILTIN_TYPES 播种。
 * 这是唯一一处全局状态，且只在第一次查询时创建；需要隔离时改用
 * createTargetTypeRegistry() 自己造实例，或用 resetTargetTypes() 重置。
 */
let defaultRegistry: TargetTypeRegistry | null = null;

function defaultTypes(): TargetTypeRegistry {
  defaultRegistry ??= createTargetTypeRegistry(BUILTIN_TYPES);
  return defaultRegistry;
}

/** 仅供测试/多租户隔离：丢弃默认实例，下次查询会用 BUILTIN_TYPES 重新播种。 */
export function resetTargetTypes(): void {
  defaultRegistry = null;
}

/** 注册一类被测对象（公开 API：外部项目用它加 widget / iconset）。 */
export function registerTargetType<T extends TargetDescriptor>(
  kind: string,
  descriptor: T,
  options: RegisterOptions = {}
): string {
  return defaultTypes().register(kind, descriptor, options);
}

/** 已注册的类型名。 */
export function targetTypes(): string[] {
  return defaultTypes().list();
}

/** 取某个类型的注册项；未注册时把可用类型列出来。 */
export function targetType(kind: string): TargetTypeEntry {
  return defaultTypes().get(kind);
}

/**
 * 从项目目录推断类型：看 public/ 下存在哪份清单。
 * 这是「不用在引用项目里写配置」的关键，也支持外部项目提供的 detect。
 */
export function detectTargetType(cwd: string): DetectResult {
  return defaultTypes().detect(cwd);
}
