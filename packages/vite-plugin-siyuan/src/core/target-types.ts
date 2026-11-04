/**
 * 被测目标的**契约**与注册表。
 *
 * 思源里主题、插件、未来的 widget / iconset 各有一套清单与加载方式。
 * 与其在代码里写死 `kind === 'theme'` 分支，不如把「一类被测对象」抽象成
 * 一份描述符，让新类型能注册进来：
 *
 *   registerTargetType('widget', { ... })
 *
 * 描述符的每个能力都对应开发链路的一步。缺一个，编排层就会长出类型分支——
 * 所以注册时会校验，缺哪个直接报哪个。
 */
import type { Page } from 'puppeteer-core';

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

/** 重载结果。 */
export interface ReloadResult {
  ok: boolean;
  /** 人类可读的一句话，直接进日志。 */
  message: string;
}

/** 激活结果（开发前让宿主用上本对象）。 */
export interface ActivateResult {
  ok: boolean;
  message: string;
}

/**
 * 描述符收到的上下文：名字、项目目录、以及预绑定好的 resolveCss。
 *
 * `resolveCss` 由 createTarget 预先绑好——描述符内部（比如插件的 reload）
 * 需要读磁盘产物时直接用它，不必回调 target 的方法，也就不会出现 this 绑不上的问题。
 */
export interface TargetContext {
  /** 被测对象的名字（清单里的 name）。 */
  readonly name: string;
  /** 项目目录。 */
  readonly cwd: string;
  /** 读磁盘上的 CSS；插件无 CSS 时返回空数组。 */
  readonly resolveCss: () => Promise<CssSheet[]>;
}

/** 重载时由编排层传进来的事实。 */
export interface ReloadContext extends TargetContext {
  /** 变化的产物文件名。 */
  readonly filename: string;
  /** kernel 端口；需要经 kernel 重载的类型（插件 JS）才用得上。 */
  readonly port: number | null;
}

/** 激活时由编排层传进来的事实。 */
export interface ActivateContext extends TargetContext {
  readonly port: number | null;
}

/**
 * 一类被测对象的描述符。
 *
 * 除标注为可选的外，全部必需——缺一个就说明抽象漏了。
 */
/**
 * 构建配置的生成参数。
 *
 * 由插件注入，描述符据此产出 `build.rollupOptions.output` 等。
 * 项目侧不该再写这些——产物命名是思源的加载机制决定的，不是项目偏好。
 */
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
 * 只放「思源加载机制决定的」部分；`minify` / `sourcemap` / `target` 这些归项目。
 *
 * 统一用 `rollupOptions.input` 而不是 `lib`：
 *   实测 CSS 入口不能走 lib —— lib 隐含 `cssCodeSplit: false`，Vite 直接报错
 *   （"rolldownOptions.input should not include CSS files"），而主题是纯 CSS 入口。
 *   插件那边用普通 input + `output.format: 'cjs'` 产出的仍是 CJS 单文件，
 *   文件名还能用 `entryFileNames` 精确控制（lib 模式会产出 `index.cjs`，得再改名）。
 *   所以两种模式共用 input，差别只在 output。
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
   * 一批产物同时变化时挑哪个作为重载依据。
   * 缺省取第一个；插件要优先 JS，因为它能连带更新 CSS。
   */
  primaryArtifact?(filenames: string[]): string;

  /**
   * 生成构建配置片段（可选）。
   *
   * 产物命名与模块格式由思源的加载机制决定：主题读 `theme.css`、插件读
   * `index.js` + `index.css`，且插件必须是 CJS 单文件（`window.eval` 执行）。
   * 让每个项目自己写，写错就是静默失效——思源找不到文件不会报错。
   */
  buildSpec?(context: BuildContext, options: TargetBuildSpecOptions): TargetBuildSpec;

  /**
   * 让页面用上新产物。
   * 主题换 `<link>` 的 href；插件 CSS 换 `<style>` 文本、JS 走 kernel 重建实例。
   */
  reload(page: Page, context: ReloadContext): Promise<ReloadResult>;

  /** 要审计的 CSS 文本。 */
  resolveCss(context: TargetContext): Promise<CssSheet[]>;

  /** 确认被测对象确实加载了。 */
  mountState(page: Page, context: TargetContext): Promise<MountState>;

  /**
   * 开发前让宿主用上本对象（可选）。
   * 主题需要经 kernel 切 themeLight/themeDark；插件由思源自己管启用状态，不实现。
   */
  activate?(page: Page | null, context: ActivateContext): Promise<ActivateResult>;
}

/** 注册时可选的额外信息。 */
export interface RegisterOptions {
  /** 给定项目目录返回 true 表示「这个目录是该类型」，用于自动推断。 */
  detect?: ((cwd: string) => boolean) | null;
}

/** 注册表里存的是描述符 + 类型名。 */
export interface TargetTypeEntry {
  readonly kind: string;
  readonly detect: ((cwd: string) => boolean) | null;
  readonly descriptor: TargetDescriptor;
}

/** 所有类型共有的能力名，用于注册时校验。 */
const REQUIRED_CAPABILITIES = [
  'manifestName',
  'installSubdir',
  'outDir',
  'artifact',
  'expectedFiles',
  'matchArtifact',
  'reload',
  'resolveCss',
  'mountState',
] as const;

/** 类型注册表。key 是类型名（theme / plugin / 未来新增）。 */
const TYPES = new Map<string, TargetTypeEntry>();

/**
 * 注册一类被测对象。
 *
 * 缺能力会在**注册时**就抛错，而不是等到运行到一半才炸。
 */
export function registerTargetType<T extends TargetDescriptor>(
  kind: string,
  descriptor: T,
  options: RegisterOptions = {}
): string {
  const record = descriptor as unknown as Record<string, unknown>;
  const missing = REQUIRED_CAPABILITIES.filter((name) => typeof record[name] !== 'function');
  if (missing.length) {
    throw new Error(
      `注册被测类型 ${kind} 失败：缺少 ${missing.join('、')}\n` +
        '  这些能力是开发链路必需的，缺一个就会让编排层长出类型分支。'
    );
  }
  TYPES.set(kind, { kind, detect: options.detect ?? null, descriptor });
  return kind;
}

/** 已注册的类型名。 */
export function targetTypes(): string[] {
  return [...TYPES.keys()];
}

/** 取某个类型的注册项；未注册时把可用类型列出来。 */
export function targetType(kind: string): TargetTypeEntry {
  const found = TYPES.get(kind);
  if (!found) {
    throw new Error(`未知的被测类型：${kind}（已注册：${targetTypes().join(' / ')}）`);
  }
  return found;
}

/** 类型推断结果。 */
export type DetectResult = { ok: true; kind: string } | { ok: false; reason: string };

/**
 * 从项目目录推断类型：看 public/ 下存在哪份清单。
 *
 * 这是「不用在引用项目里写配置」的关键——插件不带 kind 时，
 * 靠 theme.json / plugin.json 的存在与否自己判断。
 */
export function detectTargetType(cwd: string): DetectResult {
  const matches: string[] = [];
  for (const entry of TYPES.values()) {
    if (entry.detect?.(cwd)) matches.push(entry.kind);
  }
  if (matches.length === 1) return { ok: true, kind: matches[0] as string };
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `在 ${cwd} 的 public/ 下找不到任何已知清单（${targetTypes().join(' / ')}），请用 kind 显式指定类型`,
    };
  }
  return {
    ok: false,
    reason: `同时匹配到多种类型：${matches.join('、')}，请用 kind 指定`,
  };
}
