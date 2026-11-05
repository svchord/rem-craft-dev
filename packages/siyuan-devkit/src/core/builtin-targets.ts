/**
 * 内置被测类型（theme / plugin）的描述符。
 *
 * 这里只有**纯常量**：声明 BUILTIN_TYPES，不在模块加载时往任何全局注册表写东西。
 * target-types.ts 的默认注册表在第一次被查询时用这份常量惰性播种，因此
 * 「只 import target-types.ts 会拿到空注册表、必须副作用 import targets.ts」
 * 这个坑不再存在（plugin.ts 里那行副作用 import 可以删了）。
 *
 * 外部项目（arco-calendar 等）仍用 registerTargetType() 注册自己的 widget/iconset；
 * TargetDescriptor 是公开契约，编排层不需要为新类型改代码。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { isSemver } from './semver.ts';
import { judgeMount } from './theme.ts';
import { stripCssComments } from './lints.ts';
import { reloadPlugin, reloadPluginCss, reloadThemeCss, selectTheme } from './kernel.ts';
import { findWorkspaceDir } from './siyuan.ts';
import { requireRecoverable } from './errors.ts';
import { isString } from './guards.ts';
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
  TargetTypeEntry,
  VerifyIssue,
} from './target-types.ts';

/** 读磁盘产物时的可恢复错误码（缺文件、无权限、路径是目录）。 */
const CSS_READ_CODES = ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR'] as const;

/** 读第一个存在的候选文件；都不在时返回 null，其余错误重抛。 */
function readFirstText(candidates: readonly string[]): CssSheet | null {
  for (const candidate of candidates) {
    try {
      return { label: candidate, text: readFileSync(candidate, 'utf8') };
    } catch (cause) {
      requireRecoverable(cause, CSS_READ_CODES);
    }
  }
  return null;
}

/** 项目目录下某个清单文件是否存在（类型自动推断用）。 */
function hasManifest(cwd: string, manifest: string): boolean {
  return existsSync(join(cwd, 'public', manifest)) || existsSync(join(cwd, 'dist', manifest));
}

/** 把 i18n 对象摊平成点分 key 列表，用于比较各语言是否齐全。 */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child) ? flattenKeys(child, path) : [path];
  });
}

/** 读一份 i18n JSON；坏文件返回 null，由调用方报「key 不一致」。 */
function readLocale(dir: string, file: string): unknown {
  try {
    const data: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    return data;
  } catch (cause) {
    requireRecoverable(cause);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------

const themeDescriptor = {
  manifestName: () => 'theme.json',
  installSubdir: () => 'themes',
  dirEnv: () => 'SIYUAN_THEME_DIR',
  outDir: () => './dev',
  artifact: () => 'theme.css',
  expectedFiles: () => ['theme.css', 'theme.json'],
  matchArtifact: (name: string) => name.endsWith('theme.css'),

  /**
   * 产物命名由思源的加载机制决定（固定读 <theme>/theme.css）。
   * 不能走 lib 模式：lib 隐含 cssCodeSplit:false，CSS 入口与它冲突、Vite 直接报错。
   * watch 时不能清空产物目录——思源正从那里读文件。
   */
  buildSpec({ watch }: BuildContext, { entry }: TargetBuildSpecOptions): TargetBuildSpec {
    return {
      outDir: watch ? './dev' : './dist',
      emptyOutDir: false,
      input: entry ?? undefined,
      rollupOutput: {
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'theme.css' : (info.name ?? 'asset')),
      },
    };
  },

  /** 缺 modes 的后果是主题不出现在列表里，没有任何报错。 */
  verifyManifest({ manifest }): VerifyIssue[] {
    if (!manifest) return [];
    const issues: VerifyIssue[] = [];
    const modes: unknown = manifest['modes'];
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

  /** 出现 .js 说明构建配置跑偏；@layer 会被未分层的 base.css 压制。 */
  verifyArtifact({ files, readOutput }): VerifyIssue[] {
    const issues: VerifyIssue[] = [];
    const scripts = files.filter((file) => file.endsWith('.js'));
    if (scripts.length) {
      issues.push({
        message: `主题产物里出现 JavaScript：${scripts.join('、')}`,
        hint: '主题只交付 CSS。检查 rollupOptions.input 与 lib 配置。',
      });
    }
    // 只看规则不看注释：watch 产物没压缩，注释里常写着「base.css 未使用 @layer」。
    if (stripCssComments(readOutput('theme.css') ?? '').includes('@layer')) {
      issues.push({
        message: 'theme.css 含 @layer，会被 base.css（未分层）压制',
        hint: '移除 @layer 包装，让主题规则保持 unlayered。',
      });
    }
    return issues;
  },

  /**
   * 换 #themeStyle 的 href 即可，纯前端动作，不需要 kernel、也不整页刷新。
   *
   * 只有受控页面这一条路。实测（2026-11 桌面端）内核侧没有等价的外科式接口：
   *   /api/ui/reloadTheme  对已打开前端无效果
   *   /api/ui/reloadUI     有效，但整页刷新（丢编辑状态）
   *   「切走主题再切回」     有效且不刷新，但会有约 870ms 挂在内置 daylight 上
   * 最后一条既闪用户的眼，又会让这段时间内的测量读到宿主值，所以不采用；
   * 没有页面时如实报「未热重载」。
   */
  async reload(page: Page | null): Promise<ReloadResult> {
    if (!page) return { ok: false, message: '没有受控页面，主题 CSS 未热重载（传 browser: true 可启用）' };
    const ok = await reloadThemeCss(page);
    return { ok, message: ok ? '主题 CSS 已更新' : '主题 CSS 重载失败' };
  },

  /** 开发前让思源真正选中本主题，否则量到的是宿主主题的级联。 */
  async activate(_page: Page | null, { name, port }): Promise<ActivateResult> {
    if (port === null) return { ok: false, message: '切换主题需要 kernel 端口' };
    const selected = await selectTheme(port, name);
    if (!selected.ok) return { ok: false, message: selected.reason ?? '切换主题失败' };
    return { ok: true, message: selected.changed ? `已切换到：${name}` : `思源已选中：${name}` };
  },

  /** 读磁盘产物：它就是思源真正加载的那份，也是生产交付的那份。 */
  async resolveCss(context: TargetContext): Promise<CssSheet[]> {
    const candidates =
      context.cssPaths ?? (context.cssPath ? [context.cssPath] : ['./dev/theme.css', './dist/theme.css']);
    const sheet = readFirstText(candidates);
    if (!sheet) throw new Error(`找不到主题 CSS：试过 ${candidates.join('、')}`);
    return [sheet];
  },

  /** 复用 judgeMount：前缀匹配（发布版 X 与本地 X Dev）与名称归一化只有一份。 */
  async mountState(page: Page, { name }): Promise<MountState> {
    const href = await page.evaluate(() => document.getElementById('themeStyle')?.getAttribute('href') ?? null);
    const judgement = judgeMount(href, name);
    return { ok: judgement.ok, loaded: judgement.loaded, reason: judgement.reason };
  },
} satisfies TargetDescriptor;

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

const pluginDescriptor = {
  manifestName: () => 'plugin.json',
  installSubdir: () => 'plugins',
  dirEnv: () => 'SIYUAN_PLUGIN_DIR',
  outDir: () => './dev',
  artifact: () => 'index.js',
  expectedFiles: () => ['index.js', 'plugin.json'],
  matchArtifact: (name: string) => name.endsWith('index.js') || name.endsWith('index.css'),

  /**
   * 产物名是思源写死的：index.js（CJS 单文件，被 window.eval 执行）+ index.css。
   * siyuan / process 必须 external：前者由前端 polyfill，后者由思源注入。
   */
  buildSpec({ watch }: BuildContext, { entry }: TargetBuildSpecOptions): TargetBuildSpec {
    const spec: TargetBuildSpec = {
      outDir: watch ? './dev' : './dist',
      emptyOutDir: false,
      external: ['siyuan', 'process'],
    };
    // 插件入口是 `export default class ...`，必须走 lib：lib cjs 产出
    // `module.exports = 类`；普通 input 只得到 `exports.default`，思源报
    // "plugin xxx has no export"。entry 缺省时交给项目自己配 lib/input。
    if (entry) {
      spec.lib = { entry, fileName: 'index', cssFileName: 'index', formats: ['cjs'] };
      // lib + cjs 默认产 index.cjs；思源按固定名读 index.js，用 entryFileNames 覆盖扩展名。
      // CSS 也要固定名 index.css（默认会落到 assets/[name]-[hash].css）。
      spec.rollupOutput = {
        entryFileNames: '[name].js',
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'index.css' : (info.name ?? 'asset')),
      };
    }
    return spec;
  },

  /**
   * minAppVersion 必须是 semver（思源用它判断能否安装）；public/i18n 必须含
   * en.json / zh-CN.json 且 key 集合一致，缺 key 时界面显示原始 key 或空白。
   */
  verifyManifest({ root, manifest }): VerifyIssue[] {
    if (!manifest) return [];
    const issues: VerifyIssue[] = [];

    const minAppVersion: unknown = manifest['minAppVersion'];
    if (!minAppVersion) {
      issues.push({
        message: 'plugin.json 缺少 minAppVersion',
        hint: '思源用它判断能否安装，缺了会导致旧版思源装上但跑不起来。',
      });
    } else if (!isSemver(minAppVersion)) {
      issues.push({
        message: `plugin.json 的 minAppVersion 不是 semver：${String(minAppVersion)}`,
        hint: '应为 主.次.修订，如 3.1.0。',
      });
    }

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

    if (localeFiles.includes('en.json')) {
      const reference = flattenKeys(readLocale(i18nDir, 'en.json')).sort();
      for (const file of localeFiles) {
        if (file === 'en.json') continue;
        const keys = flattenKeys(readLocale(i18nDir, file)).sort();
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
   * index.css 换 <style> 文本即可；index.js 带副作用，必须经 kernel 禁用再启用
   * 让思源重跑 unload → eval → onload，也不能整页刷新（会丢用户文档与面板）。
   * 分流留在描述符里，编排层不需要知道插件是怎么加载的。
   */
  async reload(page: Page | null, { name, resolveCss, filename, port }): Promise<ReloadResult> {
    // 插件 JS 走内核广播（不依赖我们自己的页面）；CSS 只能改受控页面里的 <style>。
    if (filename.endsWith('.js')) {
      if (port === null) return { ok: false, message: '插件 JS 重载需要 kernel 端口' };
      const result = await reloadPlugin(port, name);
      return result.ok ? { ok: true, message: '插件已重新加载' } : { ok: false, message: result.reason ?? '' };
    }
    if (!page) return { ok: false, message: '没有受控页面，插件 CSS 未热重载（传 browser: true 可启用）' };

    const sheets = await resolveCss();
    const first = sheets[0];
    if (!first) return { ok: false, message: '找不到插件 CSS' };
    const ok = await reloadPluginCss(page, name, first.text);
    return { ok, message: ok ? '插件 CSS 已更新' : '插件 CSS 重载失败' };
  },

  /**
   * 读磁盘 index.css，与思源注入的 <style id="pluginsStyle<name>"> 逐字节相同；
   * 不依赖插件是否已加载。无 index.css 的插件返回空数组，退化成只做 DOM 断言。
   */
  async resolveCss(context: TargetContext): Promise<CssSheet[]> {
    const workspace = findWorkspaceDir();
    const candidates = [
      context.pluginDir ? join(context.pluginDir, 'index.css') : null,
      workspace ? join(workspace, 'data', 'plugins', context.name, 'index.css') : null,
    ].filter(isString);
    const sheet = readFirstText(candidates);
    return sheet ? [sheet] : [];
  },

  async mountState(page: Page, { name }): Promise<MountState> {
    // 没有 style 标签不算失败：可能是无 CSS 插件，也可能是插件没启用，
    // 后者会让 DOM 断言失败，比在这里硬判更准确。
    const state = await page.evaluate((pluginName: string) => {
      const styleEl = document.getElementById(`pluginsStyle${pluginName}`);
      return { hasStyle: Boolean(styleEl), styleLength: styleEl?.textContent?.length ?? 0 };
    }, name);
    // 页面还没就绪时 evaluate 可能返回 null，要变成可读的错误而不是崩掉。
    if (!state) {
      return { ok: false, loaded: null, reason: '页面不可用（evaluate 返回空），无法确认插件挂载状态' };
    }
    return {
      ok: true,
      // 不把 DOM id（pluginsStyle<name>）直接抛给用户；说明「插件名 + 样式表长度」更有意义。
      loaded: state.hasStyle ? `插件 ${name} 已注入样式表（${state.styleLength} 字符）` : null,
      reason: state.hasStyle ? null : '插件没有注入样式表，只做 DOM 断言',
    };
  },
} satisfies TargetDescriptor;

/** 显式常量：默认注册表由它惰性播种；不依赖任何模块的加载副作用。 */
export const BUILTIN_TYPES: readonly TargetTypeEntry[] = [
  { kind: 'theme', detect: (cwd) => hasManifest(cwd, 'theme.json'), descriptor: themeDescriptor },
  { kind: 'plugin', detect: (cwd) => hasManifest(cwd, 'plugin.json'), descriptor: pluginDescriptor },
];
