/**
 * 开发会话：把「产物已经在了」之后的全部工作收在一处。
 *
 * 谁负责构建不是这里的事——`startDev()` 自己 spawn `vite build --watch`，
 * 插件形态挂在宿主 vite 的 `writeBundle` 上。两种形态共用本文件，
 * 所以这里不含任何构建器知识。
 *
 * 一次会话做四件事：
 *   1. 把产物目录链接到 <workspace>/data/<subdir>/<name>
 *   2. 让思源用上它（主题切 themeLight/themeDark；插件由思源自己管）
 *   3. 开浏览器、登记控制服务（measure / open 靠它找到本会话）
 *   4. 等挂载就绪，之后每次产物变化按类型重载
 *
 * 为什么刷新后不需要额外处理：
 *   主题选择与插件启用状态都在思源配置里，F5 之后思源自己会恢复，
 *   不依赖任何注入的存活。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { watchArtifact } from './build.ts';
import type { ArtifactWatcher } from './build.ts';
import { startControlServer } from '../core/control-server.ts';
import type { ControlServer } from '../core/control-server.ts';
import { checkLinkedFiles, ensureLink } from '../core/link.ts';
import { findChrome, findKernelPort, frontendUrl, MOBILE_VIEWPORT } from '../core/siyuan.ts';
import type { Frontend } from '../core/siyuan.ts';
import { createTarget } from '../core/targets.ts';
import type { Target, TargetBuildConfig } from '../core/targets.ts';
import type { MountState } from '../core/target-types.ts';
import type { Logger } from '../core/log.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 一批产物变化的合并窗口（一次构建常同时写多个文件）。 */
const BATCH_MS = 250;

/** 日志级别的公共契约在 core/log.ts；这里重导出，保持既有导入路径可用。 */
export type { LogLevel, Logger } from '../core/log.ts';

/** startDevSession 的选项。 */
export interface StartDevSessionOptions {
  /** 已注册的类型名。 */
  kind: string;
  /** 名字；缺省从该类型的清单读。 */
  name?: string | null;
  /** 项目目录。 */
  cwd?: string;
  /** 产物目录；缺省取类型描述符的值。 */
  outDir?: string | null;
  /** 是否建立链接，缺省 true。 */
  link?: boolean;
  /** 是否无头。 */
  headless?: boolean;
  /** 是否启动浏览器，缺省 true。false 时桌面端靠思源本体温热重载。 */
  browser?: boolean;
  /** 打开哪个前端。 */
  frontend?: Frontend;
  /** 日志回调。 */
  log?: Logger;
  /**
   * 是否自己监听产物目录。
   * 插件形态由宿主 vite 的 writeBundle 驱动，传 false。
   */
  watch?: boolean;
}

/**
 * 启动本机 Chrome 浏览器并接上 CDP。
 *
 * 恢复最早（fa053ae）的实现方式：`spawn` 启动 Chrome + `puppeteer.connect`，
 * 而不是 `puppeteer.launch`。headful 时显式带 `--new-window --window-position`，
 * 保证窗口真的被创建并显示；跨平台（Node 的 spawn，各平台传各自 Chrome 路径）。
 */
async function launchChromeBrowser(profile: string, headless: boolean): Promise<Browser> {
  const chrome = findChrome();
  const debugPort = 9333 + Math.floor(Math.random() * 400);
  const args = [
    ...(headless ? ['--headless=new'] : ['--new-window', '--window-position=40,40']),
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1600,1000',
    '--enable-automation',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'about:blank',
  ];
  spawn(chrome, args, { stdio: 'ignore', windowsHide: false });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      if (data.webSocketDebuggerUrl) {
        return await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null });
      }
    } catch {
      // CDP 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等待 Chrome DevTools 端口超时');
}

/** 开发会话句柄。 */
export interface DevSession {
  target: Target;
  buildConfig: TargetBuildConfig;
  browser: Browser | null;
  page: Page | null;
  kernelPort: number;
  /** 链接目标（`<workspace>/data/<subdir>/<name>`）；未建立链接（link:false）时为 null。 */
  installPath: string | null;
  /** 启动时的挂载检查结果；未启动浏览器（browser:false）时为 null。 */
  mount: MountState | null;
  control: ControlServer | null;
  /** 外部（插件形态的 writeBundle）直接把变更文件喂进来。 */
  notifyChange(filenames: string | string[]): void;
  stop(): Promise<void>;
}

/**
 * 等被测对象真的挂上，而不是拍一个固定时长。
 *
 * 主题样式、插件实例都在思源壳子之后异步出现，固定 sleep 会时快时慢。
 * 这里轮询 mountState，超时才如实报告。
 */
async function waitForMount(
  target: Target,
  page: Page,
  timeoutMs: number
): Promise<{ ok: boolean; loaded: string | null; reason: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let last: { ok: boolean; loaded: string | null; reason: string | null } = {
    ok: false,
    loaded: null,
    reason: '尚未检查',
  };
  while (Date.now() < deadline) {
    try {
      last = await target.mountState(page);
      // ok 表示「这个类型允许没有样式表」，loaded/reason 给出实际状态。
      // 两者有一个就说明检查已经完成，不再空等到超时（无 CSS 插件就是 loaded=null + reason）。
      if (last.ok && (last.loaded || last.reason)) return last;
    } catch {
      // 页面还在导航，继续等
    }
    await sleep(200);
  }
  return last;
}

/** 等页面回到可用状态（导航、手动 F5 之后）。 */
async function waitForApp(page: Page, log: Logger): Promise<boolean> {
  try {
    await page.waitForFunction('window.siyuan && window.siyuan.config' as never, { timeout: 20000 });
    return true;
  } catch {
    log('页面刷新后没能恢复（可能仍在导航），下一次改动会再试', 'warn');
    return false;
  }
}

/**
 * 开会话。产物目录应当已经存在（或即将被构建写入）。
 */
export async function startDevSession({
  kind,
  name = null,
  cwd = process.cwd(),
  outDir = null,
  link = true,
  headless = false,
  browser: startBrowser = true,
  frontend = 'mobile',
  log = (message) => console.log(message),
  watch = true,
}: StartDevSessionOptions): Promise<DevSession> {
  const target = createTarget(kind, { name, cwd });
  const buildConfig = target.buildConfig();
  const resolvedOutDir = outDir ?? buildConfig.outDir;

  let browser: Browser | null = null;
  let watcher: ArtifactWatcher | null = null;
  let profile: string | null = null;
  let control: ControlServer | null = null;
  let installPath: string | null = null;
  let mount: MountState | null = null;
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    for (const cleanup of [() => watcher?.close(), () => control?.stop()]) {
      try {
        cleanup();
      } catch {
        // 已经没了
      }
    }
    try {
      if (browser) await browser.close();
    } catch {
      // 已经没了
    }
    try {
      if (profile) rmSync(profile, { recursive: true, force: true });
    } catch {
      // 已经没了
    }
  };

  try {
    // 1) 链接
    const kernelPort = await findKernelPort();
    if (link) {
      const installDir = await target.installDir({ port: kernelPort });
      const targetPath = join(installDir, target.name);
      const result = ensureLink(join(cwd, resolvedOutDir), targetPath, { kind });
      if (!result.ok) throw new Error(result.reason ?? '建立链接失败');
      installPath = targetPath;
      if (result.changed) log(`已链接：${targetPath}（${result.linkType}）`, 'success');
      else log(`链接已存在：${targetPath}`, 'info');

      const check = checkLinkedFiles(targetPath, buildConfig.expectedFiles);
      if (!check.ok) {
        log(`提示：链接目录里还缺 ${check.missing.join('、')}（构建可能还没写完）`, 'warn');
      }
    }

    // 2) 让思源用上它。只问「有没有 activate 能力」，不做类型判断。
    if (target.activate) {
      const activation = await target.activate(null, { port: kernelPort });
      log(activation.message, activation.ok ? 'success' : 'error');
      if (!activation.ok) throw new Error(activation.message);
    }

    // 3) 浏览器 + 控制服务（browser:false 时不起；桌面端靠思源本体温热重载）
    let page: Page | null = null;
    if (startBrowser) {
      profile = mkdtempSync(join(tmpdir(), 'vps-dev-'));
      browser = await launchChromeBrowser(profile, headless);
      control = await startControlServer({
        ws: browser.wsEndpoint(),
        cwd,
        kind: target.kind,
        name: target.name,
      });

      const pages = await browser.pages();
      page = pages[0] ?? (await browser.newPage());
      // 桌面与移动是两个独立构建入口；移动端用 390x844@3 视口（与 shot.ts 一致）。
      await page.setViewport(frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { width: 1600, height: 1000 });
      await page.goto(frontendUrl(kernelPort, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction('window.siyuan && window.siyuan.config' as never, { timeout: 30000 });

      mount = await waitForMount(target, page, 10000);
      log(`挂载：${mount.loaded ?? mount.reason ?? '(无样式表)'}`, mount.ok ? 'success' : 'warn');
    }

    // 4) 重载：一批改动只处理一次
    let reloads = 0;
    let pending = new Set<string>();
    let batchTimer: NodeJS.Timeout | null = null;

    const applyReload = async (filename: string): Promise<boolean> => {
      if (!page) return false;
      try {
        const result = await target.reload(page, { filename, port: kernelPort });
        if (result.message) log(result.message, result.ok ? 'success' : 'warn');
        return result.ok;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // 页面恰好被手动刷新（F5）时 evaluate 会抛上下文销毁，不是错误。
        if (/Execution context|detached|navigat|Target closed/i.test(message)) {
          return waitForApp(page, log);
        }
        throw cause;
      }
    };

    const flush = async (): Promise<void> => {
      batchTimer = null;
      const files = [...pending];
      pending = new Set();
      if (!files.length) return;
      const primary = buildConfig.primary(files);
      reloads += 1;
      const suffix = files.length > 1 ? `（+ ${files.length - 1}）` : '';
      // 主题 CSS 的重载只能靠「我们控制的那个页面」换 #themeStyle href：
      // 思源没有外科式的内核接口（/api/ui/reloadUI 会整页刷新，丢掉编辑状态）。
      // 没起浏览器时如实说明，而不是打一条误导的「重载失败」。
      if (!page) {
        log(`已重建 #${reloads}：${primary}${suffix}（未启动浏览器，未热重载）`, 'info');
        return;
      }
      const label = `已重载 #${reloads}：${primary}${suffix}`;
      try {
        const ok = await applyReload(primary);
        log(label + (ok ? '' : '（失败）'), ok ? 'success' : 'warn');
      } catch (cause) {
        log(`重载出错：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
      }
    };

    const notifyChange = (filenames: string | string[]): void => {
      for (const filename of ([] as string[]).concat(filenames)) {
        if (buildConfig.match(filename)) pending.add(filename);
      }
      if (!pending.size) return;
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => void flush(), BATCH_MS);
    };

    if (watch) {
      watcher = watchArtifact(join(cwd, resolvedOutDir), {
        match: buildConfig.match,
        onChange: notifyChange,
      });
    }

    log(`kernel: http://127.0.0.1:${kernelPort}`, 'info');

    return {
      target,
      buildConfig,
      browser,
      page,
      kernelPort,
      installPath,
      mount,
      control,
      notifyChange,
      stop: shutdown,
    };
  } catch (cause) {
    await shutdown();
    throw cause;
  }
}
