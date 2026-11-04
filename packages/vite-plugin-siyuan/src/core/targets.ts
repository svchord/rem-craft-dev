/**
 * 内置类型的描述符 + `createTarget`。
 *
 * 主题和插件的开发链路是同一条：
 *
 *   构建到 dev/  →  链接到 <workspace>/data/<subdir>/<name>  →  让思源重新加载
 *
 * 差别只在几处，全部由描述符吸收：
 *   产物名、清单名、安装目录、以及**怎么重载**——
 *   主题是 `<link href>`，插件是 `window.eval` + `setPetalEnabled`。
 *
 * 加第三种类型（widget / iconset）时只需要 registerTargetType()，
 * 不用改编排层——这条约束由测试钉住。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { reloadPlugin, reloadPluginCss, reloadThemeCss, selectTheme } from './kernel.ts';
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
  VerifyIssue,
} from './target-types.ts';
import { registerTargetType, targetType } from './target-types.ts';
import { isSemver } from './verify.ts';
import { judgeMount } from './theme.ts';
import { findWorkspaceDir } from './siyuan.ts';
import { resolveInstallDir } from './workspace.ts';

const readText = (file: string): Promise<string> => Promise.resolve(readFileSync(file, 'utf8'));

/** 项目目录下某个清单文件是否存在（detect 用）。 */
const hasManifest = (cwd: string, manifest: string): boolean =>
  existsSync(join(cwd, 'public', manifest)) || existsSync(join(cwd, 'dist', manifest));

/**
 * 从清单读名字。
 *
 * 主题和插件的清单都有 name 字段，缺了就没法定位安装目录，
 * 所以返回 null 而不是猜一个默认值。
 */
export function readManifestName(cwd: string, manifest: string): string | null {
  for (const file of [join(cwd, 'public', manifest), join(cwd, 'dist', manifest)]) {
    if (!existsSync(file)) continue;
    try {
      const name = (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name;
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

/** 主题独有的构造参数。 */
export interface ThemeTargetOptions {
  /** 显式指定 CSS 路径，覆盖默认的 dev/ → dist/ 探测。 */
  cssPath?: string;
  /** 多个候选路径，按顺序试。 */
  cssPaths?: string[];
  /** 名字；缺省从清单读。 */
  name?: string | null;
  /** 项目目录。 */
  cwd?: string;
}

interface ThemeContext extends TargetContext {
  cssPath?: string;
  cssPaths?: string[];
}

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
     * 主题产物只有一份 CSS，且思源按固定文件名 `<theme>/theme.css` 加载。
     * 名字错了不会报错，只是主题不生效——所以由描述符定死。
     *
     * 注意不能走 lib 模式：lib 隐含 `cssCodeSplit: false`，而 CSS 入口与那个选项
     * 冲突（Vite 直接报错）。所以统一用普通 input。
     */
    buildSpec({ watch }, { entry }) {
      return {
        outDir: watch ? './dev' : './dist',
        // watch 时不能清空产物目录：思源正从那里读文件。
        emptyOutDir: false,
        input: entry ?? undefined,
        rollupOutput: {
          assetFileNames: (info) => (info.name?.endsWith('.css') ? 'theme.css' : (info.name ?? 'asset')),
        },
      };
    },

    /**
     * 主题清单独有的要求：必须有 modes，且只能是 light / dark。
     *
     * 缺 modes 的后果是主题不出现在列表里——没有任何报错。
     */
    verifyManifest({ manifest }) {
      if (!manifest) return [];
      const issues = [];
      const modes = manifest.modes;

      if (!Array.isArray(modes) || modes.length === 0) {
        issues.push({
          message: 'theme.json 的 modes 必须是非空数组',
          hint: '如 ["light", "dark"]。缺了主题不会出现在思源的主题列表里。',
        });
        return issues;
      }

      for (const mode of modes) {
        if (mode !== 'light' && mode !== 'dark') {
          issues.push({ message: `theme.json 的 modes 含无效值：${String(mode)}（只接受 light / dark）` });
        }
      }
      return issues;
    },

    /**
     * 主题产物独有的要求：只交付 CSS。
     *
     * 两条都来自实测：
     *   - 出现 .js 说明构建配置跑偏了（主题不需要 JS）
     *   - 带 @layer 的规则会被 base.css（未分层）压制，样式不生效
     */
    verifyArtifact({ files, readOutput }) {
      const issues = [];

      const scripts = files.filter((file) => file.endsWith('.js'));
      if (scripts.length) {
        issues.push({
          message: `主题产物里出现 JavaScript：${scripts.join('、')}`,
          hint: '主题只交付 CSS。检查 rollupOptions.input 与 lib 配置。',
        });
      }

      const css = readOutput('theme.css');
      // 只看规则，不看注释：watch 产物没压缩，注释里常写着
      // 「base.css 未使用 @layer」这类说明，直接 includes 会误报（实测踩过）。
      const withoutComments = css?.replace(/\/\*[\s\S]*?\*\//g, '') ?? '';
      if (withoutComments.includes('@layer')) {
        issues.push({
          message: 'theme.css 含 @layer，会被 base.css（未分层）压制',
          hint: '移除 @layer 包装，让主题规则保持 unlayered。',
        });
      }

      return issues;
    },

    /**
     * 主题换 #themeStyle 的 href 即可，级联位置不变。纯前端动作，不需要 kernel、
     * 也不需要整页刷新——这是主题与插件最根本的差别。
     */
    async reload(page: Page): Promise<ReloadResult> {
      const ok = await reloadThemeCss(page);
      return { ok, message: ok ? '主题 CSS 已更新' : '主题 CSS 重载失败' };
    },

    /**
     * 开发前让思源真正选中本主题：否则预览的是宿主主题，量到的级联
     * （尤其 --b3-* 的取值）与生产不一致。这是主题独有的动作，插件不需要。
     */
    async activate(_page: Page | null, { name, port }): Promise<ActivateResult> {
      if (port === null) return { ok: false, message: '切换主题需要 kernel 端口' };
      const selected = await selectTheme(port, name);
      if (!selected.ok) return { ok: false, message: selected.reason ?? '切换主题失败' };
      return { ok: true, message: selected.changed ? `已切换到：${name}` : `思源已选中：${name}` };
    },

    /**
     * CSS 读磁盘产物：它就是思源真正加载的那份，也是生产交付的那份。
     * 路径由调用方给（本仓约定 dev/ 优先、回退 dist/，但不写死在包里）。
     */
    async resolveCss(context: TargetContext): Promise<CssSheet[]> {
      const { cssPath, cssPaths } = context as ThemeContext;
      const candidates = cssPaths ?? (cssPath ? [cssPath] : ['./dev/theme.css', './dist/theme.css']);
      for (const candidate of candidates) {
        try {
          return [{ label: candidate, text: await readText(candidate) }];
        } catch {
          // 试下一个
        }
      }
      throw new Error(`找不到主题 CSS：试过 ${candidates.join('、')}`);
    },

    async mountState(page: Page, { name }): Promise<MountState> {
      const href = await page.evaluate(
        () => (document.getElementById('themeStyle') as HTMLLinkElement | null)?.getAttribute('href') ?? null
      );
      // 复用 judgeMount：它处理了前缀匹配（发布版 X 与本地目录 X Dev 算同一个主题）
      // 和名称归一化，之前这里自己写一遍简单解析会漏掉这些。
      const judgement = judgeMount(href, name);
      return { ok: judgement.ok, loaded: judgement.loaded, reason: judgement.reason };
    },
  } satisfies TargetDescriptor,
  { detect: (cwd) => hasManifest(cwd, 'theme.json') }
);

// ---------------------------------------------------------------------------
// 内置类型：插件
// ---------------------------------------------------------------------------

/** 插件独有的构造参数。 */
export interface PluginTargetOptions {
  /** 插件名（plugin.json 的 name）。 */
  name: string;
  /** 显式指定插件目录（源码在别处、或做 CI 时）。 */
  pluginDir?: string | null;
  /** 项目目录。 */
  cwd?: string;
}

interface PluginContext extends TargetContext {
  pluginDir?: string | null;
}

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
     * 插件的产物名是思源写死的：`index.js`（CJS 单文件，被 window.eval 执行）
     * 与 `index.css`（内联进 `<style>`）。名字错了思源静默加载不到。
     *
     * 不用 lib 模式：lib 会产出 `index.cjs`，还得再改名；普通 input +
     * `output.format: 'cjs'` 反而更直接，`entryFileNames` 就能精确控制。
     *
     * `siyuan` 与 `process` 必须 external：前者由前端 polyfill，后者由思源注入。
     */
    buildSpec({ watch }, { entry }) {
      return {
        outDir: watch ? './dev' : './dist',
        emptyOutDir: false,
        input: entry ?? undefined,
        external: ['siyuan', 'process'],
        rollupOutput: {
          entryFileNames: '[name].js',
          assetFileNames: (info) => (info.name?.endsWith('.css') ? 'index.css' : (info.name ?? 'asset')),
          format: 'cjs',
        },
      };
    },

    /**
     * 插件清单独有的要求（对照 siyuan-arco-calendar 的 check_manifest.mjs）：
     *
     *   minAppVersion  必须是 semver。思源用它判断「这个版本的思源能不能装」，
     *                  格式错了插件在旧版思源上会装上但跑不起来。
     *   displayName / description  清单里的 i18n 字段，必须带 default（通用校验已覆盖）。
     *   public/i18n    必须存在且含 en.json、zh-CN.json，且 key 集合一致——
     *                  缺 key 时界面上显示原始 key 或空白。
     */
    verifyManifest({ root, manifest }) {
      if (!manifest) return [];
      const issues: VerifyIssue[] = [];

      if (!manifest.minAppVersion) {
        issues.push({
          message: 'plugin.json 缺少 minAppVersion',
          hint: '思源用它判断能否安装，缺了会导致旧版思源装上但跑不起来。',
        });
      } else if (!isSemver(manifest.minAppVersion)) {
        issues.push({
          message: `plugin.json 的 minAppVersion 不是 semver：${String(manifest.minAppVersion)}`,
          hint: '应为 主.次.修订，如 3.1.0。',
        });
      }

      // i18n 目录与 key 一致性
      const i18nDir = join(root, 'public', 'i18n');
      if (!existsSync(i18nDir)) {
        issues.push({
          message: '缺少 public/i18n 目录',
          hint: '插件需要 en.json 与 zh-CN.json 提供界面文案。',
        });
        return issues;
      }

      const localeFiles = readdirSync(i18nDir).filter((file) => file.endsWith('.json'));
      for (const required of ['en.json', 'zh-CN.json']) {
        if (!localeFiles.includes(required)) {
          issues.push({ message: `public/i18n 缺少 ${required}` });
        }
      }

      // key 集合必须一致：缺 key 的界面上会显示原始 key 或空白。
      const flattenKeys = (value: unknown, prefix = ''): string[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
        return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
          const path = prefix ? `${prefix}.${key}` : key;
          return child && typeof child === 'object' && !Array.isArray(child) ? flattenKeys(child, path) : [path];
        });
      };

      const readLocale = (file: string): unknown => {
        try {
          return JSON.parse(readFileSync(join(i18nDir, file), 'utf8'));
        } catch {
          return null;
        }
      };

      if (localeFiles.includes('en.json')) {
        const reference = flattenKeys(readLocale('en.json')).sort();
        for (const file of localeFiles) {
          if (file === 'en.json') continue;
          const keys = flattenKeys(readLocale(file)).sort();
          if (keys.join('|') !== reference.join('|')) {
            issues.push({
              message: `public/i18n/${file} 的 key 与 en.json 不一致`,
              hint: '各语言 key 必须完全相同，缺的会显示原始 key。',
            });
          }
        }
      }

      return issues;
    },

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
     * 分流逻辑留在描述符里，编排层不需要知道插件是怎么加载的。
     */
    async reload(page: Page, { name, resolveCss, filename, port }): Promise<ReloadResult> {
      if (filename.endsWith('.js')) {
        if (port === null) return { ok: false, message: '插件 JS 重载需要 kernel 端口' };
        const result = await reloadPlugin(port, name);
        return result.ok ? { ok: true, message: '插件已重新加载' } : { ok: false, message: result.reason ?? '' };
      }

      const sheets = await resolveCss();
      const first = sheets[0];
      if (!first) return { ok: false, message: '找不到插件 CSS' };
      const ok = await reloadPluginCss(page, name, first.text);
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
    async resolveCss(context: TargetContext): Promise<CssSheet[]> {
      const { name, pluginDir } = context as PluginContext;
      const workspace = process.env.SIYUAN_WORKSPACE || findWorkspaceDir();
      const candidates = [
        pluginDir ? join(pluginDir, 'index.css') : null,
        workspace ? join(workspace, 'data', 'plugins', name, 'index.css') : null,
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of candidates) {
        try {
          return [{ label: candidate, text: await readText(candidate) }];
        } catch {
          // 试下一个
        }
      }
      return [];
    },

    async mountState(page: Page, { name }): Promise<MountState> {
      // 插件是否在运行：有 CSS 的插件会被思源注入 style 标签。
      // 没有该标签不算失败——可能是无 CSS 插件，也可能是插件没启用，
      // 后者会让 DOM 断言失败，比在这里硬判更准确。
      const state = await page.evaluate((pluginName) => {
        const styleEl = document.getElementById(`pluginsStyle${pluginName}`);
        return { hasStyle: Boolean(styleEl), styleLength: styleEl?.textContent?.length ?? 0 };
      }, name);

      if (!state) {
        return { ok: false, loaded: null, reason: '页面不可用，读不到插件状态' };
      }
      return {
        ok: true,
        loaded: state.hasStyle ? `pluginsStyle${name}（${state.styleLength} 字符）` : null,
        reason: state.hasStyle ? null : '插件没有注入样式表，只做 DOM 断言',
      };
    },
  } satisfies TargetDescriptor,
  { detect: (cwd) => hasManifest(cwd, 'plugin.json') }
);

// ---------------------------------------------------------------------------
// 组合成 target 对象
// ---------------------------------------------------------------------------

/** 构建看护需要的参数。 */
export interface TargetBuildConfig {
  outDir: string;
  artifact: string;
  expectedFiles: string[];
  match(filename: string): boolean;
  /** 一批产物变化时挑主产物。 */
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
  reload(page: Page, options?: { filename?: string; port?: number | null }): Promise<ReloadResult>;
  /**
   * 生成构建配置片段；描述符没实现时返回 null。
   * 插件用它注入 `build.rollupOptions.output`，项目不必自己写产物命名。
   */
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

/**
 * 造一个被测目标。
 */
export function createTarget(kind: string, options: CreateTargetOptions = {}): Target {
  const { name = null, cwd = process.cwd(), ...rest } = options;
  const entry = targetType(kind);
  const descriptor = entry.descriptor;
  const resolvedName = name ?? readManifestName(cwd, descriptor.manifestName());
  if (!resolvedName) {
    throw new Error(
      `读不到${kind}的名字：确认 ${join(cwd, 'public', descriptor.manifestName())} 里有 name 字段，或用 name 指定`
    );
  }

  // context 里预先绑好 resolveCss：描述符内部（比如插件的 reload）需要读磁盘
  // 产物时直接用它，不必回调 target 的方法，也就不会出现 this 绑不上的问题。
  const context: TargetContext & Record<string, unknown> = {
    ...rest,
    cwd,
    name: resolvedName,
    resolveCss: () => descriptor.resolveCss(context as TargetContext),
  };

  const target: Target = {
    kind,
    name: resolvedName,
    descriptor,

    /** 供审计读取的 CSS 文本（都来自磁盘）。 */
    resolveCss: () => descriptor.resolveCss(context as TargetContext),

    /** 确认被测对象确实加载了。 */
    mountState: (page) => descriptor.mountState(page, context as TargetContext),

    /** 构建看护用的参数。 */
    buildConfig: () => ({
      outDir: descriptor.outDir(),
      artifact: descriptor.artifact(),
      expectedFiles: descriptor.expectedFiles(),
      match: (filename: string) => descriptor.matchArtifact(filename),
      primary: (filenames: string[]) =>
        descriptor.primaryArtifact ? descriptor.primaryArtifact(filenames) : (filenames[0] ?? ''),
    }),

    /** 生成构建配置片段；描述符没实现就返回 null。 */
    buildSpec: (context: BuildContext, options: TargetBuildSpecOptions = {}) =>
      typeof descriptor.buildSpec === 'function' ? descriptor.buildSpec(context, options) : null,

    /** 链接目标目录：<workspace>/data/<subdir>。 */
    installDir: (opts = {}) =>
      resolveInstallDir({
        kind,
        subdir: descriptor.installSubdir(),
        dirEnv: descriptor.dirEnv(),
        workspace: opts.workspace ?? null,
        port: opts.port ?? null,
      }),

    /**
     * 让页面用上新产物。
     *
     * 通用层只负责把事实传进去（哪个文件变了、kernel 端口是多少），
     * 怎么重载由各类型的描述符自己决定。
     */
    reload: (page, { filename = '', port = null } = {}) =>
      descriptor.reload(page, { ...(context as TargetContext), filename, port }),

    activate: descriptor.activate
      ? (_page, opts = {}) => descriptor.activate!(_page, { ...(context as TargetContext), port: opts.port ?? null })
      : null,
  };

  return target;
}

/** 主题目标。比 createTarget('theme') 读起来清楚。 */
export function themeTarget(options: ThemeTargetOptions = {}): Target {
  return createTarget('theme', options);
}

/** 插件目标。理由同上。 */
export function pluginTarget(options: PluginTargetOptions): Target {
  return createTarget('plugin', options);
}
