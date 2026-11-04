/**
 * 开发循环：一条命令走完「构建 → 链接 → 让思源用上 → 改完自动重载」。
 *
 * 主题和插件走的是同一条链路，差别已经收敛在 targets.mjs 里，这里只做编排：
 *
 *   1. 起 `vite build --watch`，等首个产物出现
 *   2. 把 dev/ 链接到 <workspace>/data/<themes|plugins>/<name>
 *   3. 让思源用上它（主题：切 themeLight/themeDark；插件：确认已启用）
 *   4. 开浏览器并暴露 CDP 端点，供 measure / open 复用
 *   5. 监听产物，变了就让页面重新加载
 *
 * 为什么不注入 <style>、也不禁用宿主主题（主题模式）：
 *   注入只能模拟「本主题叠在宿主主题之上」，而真实级联里本主题是**替代**宿主。
 *   两者在 --b3-* 上结果不同：注入时宿主的 --b3-* 仍然存在且往往胜出。
 *   让思源自己加载，预览、测量、生产就是同一套级联。
 *
 * 为什么刷新后不需要额外处理：
 *   主题选择与插件启用状态都在思源配置里，F5 之后思源自己会恢复，不依赖任何注入的存活。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { registerEndpoint } from './cdp-registry.mjs';
import { startBuild, watchArtifact } from './build.mjs';
import { checkLinkedFiles, ensureLink } from './link.mjs';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.mjs';
import { pluginTarget, themeTarget } from './targets.mjs';
import { reloadPluginCss, selectTheme } from './theme-dev.mjs';
import { readThemeName } from './theme.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 开发会话。
 *
 * @param kind        'theme' | 'plugin'
 * @param name        主题名 / 插件名；主题可省略（从 theme.json 读）
 * @param cwd         项目目录
 * @param headless    是否无头
 * @param frontend    'desktop' | 'mobile'
 * @param link        是否建立链接（false 时只构建+重载，假设用户已自己链接）
 * @param log         日志回调
 * @returns {{ stop, page, browser, target, kernelPort }}
 */
export async function startDev({
  kind = 'theme',
  name = null,
  cwd = process.cwd(),
  headless = false,
  frontend = 'desktop',
  link = true,
  log = (message) => console.log('[dev] ' + message),
} = {}) {
  const target =
    kind === 'plugin'
      ? pluginTarget({ name: name ?? readPluginName(cwd) })
      : themeTarget({ themeName: name ?? readThemeName() });

  if (kind === 'plugin' && !target.name) {
    throw new Error('读不到插件名：确认 ' + join(cwd, 'public', 'plugin.json') + ' 里有 name 字段');
  }

  const state = {
    browser: null,
    build: null,
    watcher: null,
    profile: null,
    page: null,
    kernelPort: null,
    closing: false,
    unregister: null,
  };

  const shutdown = async () => {
    if (state.closing) return;
    state.closing = true;
    try {
      state.watcher?.close();
    } catch {}
    try {
      state.build?.stop();
    } catch {}
    try {
      state.unregister?.();
    } catch {}
    try {
      if (state.browser) await state.browser.close();
    } catch {}
    try {
      if (state.profile) rmSync(state.profile, { recursive: true, force: true });
    } catch {}
  };

  try {
    // 1) 构建
    const buildConfig = target.buildConfig();
    state.build = await startBuild({
      cwd,
      outDir: buildConfig.outDir,
      artifact: buildConfig.artifact,
      onOutput: (text) => {
        // vite 的输出已经带了自己的前缀，原样透传会让日志噪音很大；
        // 只把错误行转出来，其余交给产物监听去报告。
        for (const line of text.split('\n')) {
          if (/error|failed|cannot|ENOENT/i.test(line) && line.trim()) log('构建：' + line.trim());
        }
      },
    });
    if (!state.build.ready) throw new Error(state.build.reason);
    log('构建就绪：' + join(buildConfig.outDir, buildConfig.artifact));

    // 2) 链接
    state.kernelPort = await findKernelPort();
    if (link) {
      const installDir = await target.installDir({ port: state.kernelPort });
      const targetPath = join(installDir, target.name);
      const result = ensureLink(join(cwd, buildConfig.outDir), targetPath, { kind });
      if (!result.ok) throw new Error(result.reason);
      log(result.changed ? '已链接：' + targetPath + '（' + result.linkType + '）' : '链接已存在：' + targetPath);

      const expected = buildConfig.expectedFiles;
      const check = checkLinkedFiles(targetPath, expected);
      if (!check.ok) log('提示：链接目录里还缺 ' + check.missing.join('、') + '（构建可能还没写完）');
    }

    // 3) 让思源用上它
    if (kind === 'theme') {
      const selected = await selectTheme(state.kernelPort, target.name);
      if (!selected.ok) {
        throw new Error(
          selected.reason +
            '\n  提示：确认 <workspace>/data/themes/' +
            target.name +
            ' 已存在且主题名与 theme.json 一致'
        );
      }
      log(selected.changed ? '已切换到主题：' + target.name : '思源已选中：' + target.name);
    } else {
      log('插件：' + target.name + '（启用状态由思源管理，见 data/storage/petal/petals.json）');
    }

    // 4) 浏览器：可见窗口交给用户看，生命周期由 dev.mjs 持有
    state.profile = mkdtempSync(join(tmpdir(), 'rc-dev-'));
    state.browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless,
      defaultViewport: null,
      args: [
        '--window-size=1600,1000',
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' + state.profile,
      ],
    });
    // 登记到机器级注册表，别的项目（或别的终端）也能 attach 到同一个浏览器。
    state.unregister = registerEndpoint(state.browser.wsEndpoint(), { cwd });

    const pages = await state.browser.pages();
    state.page = pages.length ? pages[0] : await state.browser.newPage();
    await state.page.goto(frontendUrl(state.kernelPort, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await state.page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
    await sleep(1200);

    const mount = await target.mountState(state.page);
    log('挂载：' + (mount.ok ? (mount.loaded ?? '(无样式表)') : '未挂上 — ' + mount.reason));
    if (!mount.ok && kind === 'theme') {
      log('提示：主题没挂上，检查 theme.json 的 frontends 是否含 all，或重启内核让它重新索引');
    }

    // 5) 监听产物，按类型精确重载
    //
    // 有些项目的 vite 配置自带 rollup-plugin-livereload（例如本机插件项目），
    // 它会对任何产物变化整页刷新，与本包的重载逻辑打架。检测到就明确警告：
    // 两者只能留一个，而本包的重载更细（CSS 不刷新页面）。
    if (hasLivereload(cwd)) {
      log('警告：检测到 vite 配置里用了 rollup-plugin-livereload');
      log('      它会对任何改动整页刷新，与本包按类型重载冲突（改 CSS 也会刷新页面）。');
      log('      建议从 vite.config.ts 去掉 livereload —— 本包已经负责热重载。');
    }

    let reloads = 0;
    state.watcher = watchArtifact(join(cwd, buildConfig.outDir), {
      match: buildConfig.match,
      onChange: async (filename) => {
        reloads += 1;
        const label = '已重载 #' + reloads + '：' + filename;
        try {
          const outcome = await applyReload({ state, target, kind, filename, log });
          log(label + (outcome ? '' : '（失败）'));
        } catch (cause) {
          log('重载出错：' + (cause instanceof Error ? cause.message : String(cause)));
        }
      },
    });

    log('kernel: http://127.0.0.1:' + state.kernelPort);
    log('改源码自动重建 + 自动重载（F5 后仍是这个' + (kind === 'theme' ? '主题' : '插件') + '）');
    log('另开终端：pnpm measure <子命令> --attach   # 量真实渲染');

    return { ...state, target, stop: shutdown };
  } catch (cause) {
    await shutdown();
    throw cause;
  }
}

/** 插件名从 public/plugin.json 读。 */
function readPluginName(cwd) {
  for (const file of [join(cwd, 'public', 'plugin.json'), join(cwd, 'dist', 'plugin.json')]) {
    if (!existsSync(file)) continue;
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (name) return String(name).trim();
    } catch {
      // 继续下一个候选
    }
  }
  return null;
}

/**
 * 让页面用上新产物。
 *
 * 按产物类型决定重载粒度——这是本包存在的意义之一，比整页刷新精细：
 *
 *   主题 theme.css      换 #themeStyle 的 href        页面不动，滚动位置/打开的面板都保留
 *   插件 index.css      换 #pluginsStyle<name> 文本    页面不动
 *   插件 index.js       整页 reload                   JS 无法热替换，只能重来
 *
 * 为什么不用 rollup-plugin-livereload：它对任何产物变化都整页刷新，
 * 改一行 CSS 也会把用户正在编辑的文档、打开的面板全部重置。而且它需要额外
 * 起一个 35729 服务、往产物里注入客户端脚本（那行注入还会进生产包的风险）。
 * 本包已经能按类型精确重载，那套机制就是纯冗余。
 *
 * @returns true 表示产物已生效
 */
async function applyReload({ state, target, kind, filename, log }) {
  const page = state.page;

  try {
    if (kind === 'theme') return await target.reload(page);

    // 插件 JS 变了必须整页刷新：换 <style> 不会重新执行 index.js。
    if (filename.endsWith('.js')) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      return await waitForApp(page, log);
    }

    const sheets = await target.resolveCss();
    if (!sheets.length) return false;
    return await reloadPluginCss(page, target.name, sheets[0].text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // 页面恰好被手动刷新（F5）时 evaluate 会抛上下文销毁，不是错误。
    if (/Execution context|detached|navigat|Target closed/i.test(message)) {
      return waitForApp(page, log);
    }
    throw cause;
  }
}

/** 等页面回到可用状态（导航、手动 F5 之后）。 */
async function waitForApp(page, log) {
  try {
    await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 20000 });
    return true;
  } catch {
    log('页面刷新后没能恢复（可能仍在导航），下一次改动会再试');
    return false;
  }
}

/**
 * 项目自己的 vite 配置里是否真的**用了** rollup-plugin-livereload。
 *
 * 只读配置文本做检测，不解析 AST：这一步是为了给出一条准确的警告，
 * 检测失败最多是漏掉警告，不该影响开发循环。
 *
 * 必须排除注释——很多项目在移除 livereload 后会在配置里留一行说明
 * （「之前用 rollup-plugin-livereload，它……」），把注释当成使用会误报。
 */
function hasLivereload(cwd) {
  const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
  for (const name of candidates) {
    const file = join(cwd, name);
    if (!existsSync(file)) continue;
    try {
      const source = readFileSync(file, 'utf8');
      // 去掉块注释与行注释后再判断，避免把说明文字当成实际使用。
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // 实际使用有两种形态：import ... from 'rollup-plugin-livereload'，或直接调用 livereload(...)
      if (/from\s+['"]rollup-plugin-livereload['"]/.test(code)) return true;
      if (/\blivereload\s*\(/.test(code)) return true;
    } catch {
      // 读不到就当没有
    }
  }
  return false;
}
