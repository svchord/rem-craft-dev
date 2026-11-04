/**
 * 开发循环：一条命令走完「构建 → 链接 → 让思源用上 → 改完自动重载」。
 *
 * 主题、插件、以及未来任何注册过的类型走的是同一条链路，差别已经收敛在
 * target-types.mjs 的类型描述符里。**本文件不含任何类型分支**——这条约束由测试钉住。
 *
 *   1. 起构建进程（默认 vite build --watch，可用 --build-command 换掉），等首个产物
 *   2. 把产物目录链接到 <workspace>/data/<subdir>/<name>
 *   3. 让思源用上它（主题：切 themeLight/themeDark；插件：启用状态由思源自己管）
 *   4. 开浏览器并登记 CDP 端点，供 measure / open 复用
 *   5. 监听产物，按类型精确重载
 *
 * 为什么刷新后不需要额外处理：
 *   主题选择与插件启用状态都在思源配置里，F5 之后思源自己会恢复，不依赖任何注入的存活。
 *
 * 为什么不用 rollup-plugin-livereload：
 *   它对任何产物变化都整页刷新，改一行 CSS 也会把正在编辑的文档和打开的面板重置。
 *   本包按产物类型决定粒度（CSS 换 <style> 内容、JS 才整页刷新），那套机制是纯冗余。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startBuild, watchArtifact } from './build.mjs';
import { registerEndpoint } from './cdp-registry.mjs';
import { checkLinkedFiles, ensureLink } from './link.mjs';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.mjs';
import { createTarget } from './targets.mjs';
import { selectTheme } from './theme-dev.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 开发会话。
 *
 * @param kind         已注册的类型名（theme / plugin / 自定义）
 * @param name         名字；缺省从该类型的清单读
 * @param cwd          项目目录
 * @param headless     是否无头
 * @param frontend     'desktop' | 'mobile'
 * @param link         是否建立链接（false 时只构建+重载，假设用户已自己链接）
 * @param buildCommand 自定义构建命令（字符串或 { file, args }）；不给则用 vite
 * @param outDir       产物目录覆盖（缺省取类型描述符的值）
 * @param log          日志回调
 * @returns {{ stop, page, browser, target, kernelPort }}
 */
export async function startDev({
  kind,
  name = null,
  cwd = process.cwd(),
  headless = false,
  frontend = 'desktop',
  link = true,
  buildCommand = null,
  outDir = null,
  log = (message) => console.log('[dev] ' + message),
} = {}) {
  const target = createTarget(kind, { name, cwd });
  const buildConfig = target.buildConfig();
  const resolvedOutDir = outDir ?? buildConfig.outDir;

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
    for (const cleanup of [() => state.watcher?.close(), () => state.build?.stop(), () => state.unregister?.()]) {
      try {
        cleanup();
      } catch {}
    }
    try {
      if (state.browser) await state.browser.close();
    } catch {}
    try {
      if (state.profile) rmSync(state.profile, { recursive: true, force: true });
    } catch {}
  };

  try {
    // 1) 构建
    state.build = await startBuild({
      cwd,
      outDir: resolvedOutDir,
      artifact: buildConfig.artifact,
      command: buildCommand,
      onOutput: (text) => {
        // 构建器自己的输出前缀已经很啰嗦，只把错误行转出来，
        // 其余交给产物监听去报告。
        for (const line of text.split('\n')) {
          if (/error|failed|cannot|ENOENT/i.test(line) && line.trim()) log('构建：' + line.trim());
        }
      },
    });
    if (!state.build.ready) throw new Error(state.build.reason);
    log('构建就绪：' + join(resolvedOutDir, buildConfig.artifact));

    // 2) 链接
    state.kernelPort = await findKernelPort();
    if (link) {
      const installDir = await target.installDir({ port: state.kernelPort });
      const targetPath = join(installDir, target.name);
      const result = ensureLink(join(cwd, resolvedOutDir), targetPath, { kind });
      if (!result.ok) throw new Error(result.reason);
      log(result.changed ? '已链接：' + targetPath + '（' + result.linkType + '）' : '链接已存在：' + targetPath);

      const check = checkLinkedFiles(targetPath, buildConfig.expectedFiles);
      if (!check.ok) log('提示：链接目录里还缺 ' + check.missing.join('、') + '（构建可能还没写完）');
    }

    // 3) 让思源用上它。
    //    只有主题需要主动切换；其它类型的启用状态由思源自己管，
    //    这里只把「该怎么确认」交给类型描述符，不做类型判断。
    const activation = await activateInSiYuan(target, state.kernelPort);
    log(activation.message);
    if (!activation.ok) throw new Error(activation.message);

    // 4) 浏览器：可见窗口交给用户看，生命周期由本函数持有
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

    // 5) 监听产物，按类型精确重载
    if (hasLivereload(cwd)) {
      log('警告：检测到 vite 配置里用了 rollup-plugin-livereload');
      log('      它会对任何改动整页刷新，与本包按类型重载冲突（改 CSS 也会刷新页面）。');
      log('      建议从 vite.config.ts 去掉 livereload —— 本包已经负责热重载。');
    }

    let reloads = 0;
    state.watcher = watchArtifact(join(cwd, resolvedOutDir), {
      match: buildConfig.match,
      onChange: async (filename) => {
        reloads += 1;
        const label = '已重载 #' + reloads + '：' + filename;
        try {
          const outcome = await applyReload({ state, target, filename, log });
          log(label + (outcome ? '' : '（失败）'));
        } catch (cause) {
          log('重载出错：' + (cause instanceof Error ? cause.message : String(cause)));
        }
      },
    });

    log('kernel: http://127.0.0.1:' + state.kernelPort);
    log('改源码自动重建 + 自动重载（F5 后仍是这个' + target.name + '）');
    log('另开终端：siyuan-devtools measure <子命令> --attach   # 量真实渲染');

    return { ...state, target, stop: shutdown };
  } catch (cause) {
    await shutdown();
    throw cause;
  }
}

/**
 * 让思源用上被测对象。
 *
 * 主题需要经 kernel API 切换（否则预览的是宿主主题，量到的级联是错的）。
 * 其它类型不需要这一步——插件、widget 的启用状态在思源配置里，由用户管。
 *
 * 这里用「有没有 selectTheme 这个能力」而不是 `kind === 'theme'` 来区分：
 * 未来若出现另一种需要切换的类型（比如 iconset），注册时声明即可。
 */
async function activateInSiYuan(target, kernelPort) {
  if (!target.requiresSelection) {
    return { ok: true, message: target.name + '：启用状态由思源管理（data/storage/petal/）' };
  }
  const selected = await selectTheme(kernelPort, target.name);
  if (!selected.ok) return { ok: false, message: selected.reason };
  return {
    ok: true,
    message: selected.changed ? '已切换到：' + target.name : '思源已选中：' + target.name,
  };
}

/**
 * 让页面用上新产物。
 *
 * 按产物类型决定重载粒度——这是本包存在的意义之一，比整页刷新精细：
 *   CSS 产物    交给类型描述符的 reload()（主题换 href、插件换 <style> 文本）
 *   JS 产物     整页 reload（JS 无法热替换，只能重来）
 *
 * @returns true 表示产物已生效
 */
async function applyReload({ state, target, filename, log }) {
  const page = state.page;

  try {
    if (filename.endsWith('.js')) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      return await waitForApp(page, log);
    }
    return await target.reload(page);
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
 * 必须排除注释——很多项目在移除 livereload 后会在配置里留一行说明，
 * 把注释当成使用会误报。
 */
function hasLivereload(cwd) {
  const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
  for (const name of candidates) {
    const file = join(cwd, name);
    if (!existsSync(file)) continue;
    try {
      const source = readFileSync(file, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      if (/from\s+['"]rollup-plugin-livereload['"]/.test(code)) return true;
      if (/\blivereload\s*\(/.test(code)) return true;
    } catch {
      // 读不到就当没有
    }
  }
  return false;
}
