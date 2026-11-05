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
 *   3. 可选：auditBrowser 打开时起常驻无头浏览器（桌面 + 移动各一页）并登记控制服务
 *   4. 产物一变就广播整页刷新；有常驻页时等它们回来再解除读租约屏障
 *
 * auditBrowser 默认关闭：常驻 Chrome 内存开销不小，不需要 agent 审计就不付这个成本。
 * 关闭时刷新照常发给思源本体窗口，只是没有 --attach 可复用的目标。
 *
 * 为什么统一整页刷新：主题 CSS、插件 CSS、插件 JS 三种产物的加载机制不同，
 * 各写一条外科式分支既脆弱又会互相污染测量。整页刷新让思源自己重新走一遍
 * 启动流程，三种产物一并拿到磁盘真值，交互态也天然清空。
 *
 * 代价（明确接受）：本体窗口会被一起刷新，丢光标/滚动/打开面板；人工摆好的
 * 交互场景会被冲掉。测量侧靠「每次 --setup 重建场景」应对。
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
import { callKernel } from '../core/kernel.ts';
import { createTarget } from '../core/targets.ts';
import type { Target, TargetBuildConfig } from '../core/targets.ts';
import type { MountState } from '../core/target-types.ts';
import type { Logger } from '../core/log.ts';
import { TIMING } from '../core/timing.ts';

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
  /**
   * 是否起常驻无头浏览器供 agent 审计复用（--attach），缺省 false。
   * 关闭时不启动 Chrome、不登记控制服务，省内存；但产物变化仍会刷新思源本体窗口。
   */
  auditBrowser?: boolean;
  /** 日志回调。 */
  log?: Logger;
  /**
   * 是否自己监听产物目录。
   * 插件形态由宿主 vite 的 writeBundle 驱动，传 false。
   */
  watch?: boolean;
}

/**
 * 启动本机 Chrome 并接上 CDP。常驻页固定无头：测量页不需要被人看见，
 * 也就没有「开哪个前端 / 要不要窗口」这些入参。
 */
async function launchChromeBrowser(profile: string): Promise<Browser> {
  const chrome = findChrome();
  const debugPort = 9333 + Math.floor(Math.random() * 400);
  const args = [
    '--headless=new',
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
  /** 桌面端常驻页；auditBrowser:false 时为 null。 */
  page: Page | null;
  /** 移动端常驻页；auditBrowser:false 时为 null。 */
  mobilePage: Page | null;
  kernelPort: number;
  /** 链接目标（`<workspace>/data/<subdir>/<name>`）；未建立链接（link:false）时为 null。 */
  installPath: string | null;
  /** 启动时的挂载检查结果；未起常驻页（auditBrowser:false）时为 null。 */
  mount: MountState | null;
  /** 控制服务；未起常驻页时为 null，此时 --attach 无可复用目标。 */
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

/** 等页面回到可用状态：整页刷新后思源要重新挂载 config 与样式表。 */
async function waitForApp(page: Page, log: Logger): Promise<boolean> {
  try {
    await page.waitForFunction('window.siyuan && window.siyuan.config' as never, { timeout: 20000 });
    await page
      .waitForFunction(() => Boolean(document.getElementById('themeStyle')?.getAttribute('href')) as never, {
        timeout: 10000,
      })
      .catch(() => undefined);
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
  auditBrowser = false,
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

    // 3) 常驻无头浏览器：仅 auditBrowser 打开时启动。默认关闭，省一个 Chrome 的内存。
    let page: Page | null = null;
    let mobilePage: Page | null = null;
    if (auditBrowser) {
      profile = mkdtempSync(join(tmpdir(), 'vps-dev-'));
      browser = await launchChromeBrowser(profile);
      control = await startControlServer({
        ws: browser.wsEndpoint(),
        cwd,
        kind: target.kind,
        name: target.name,
      });

      /** 打开一个前端的常驻页，视口与 shot.ts 保持一致。 */
      const openFrontend = async (frontend: 'desktop' | 'mobile'): Promise<Page> => {
        const opened = await browser!.newPage();
        await opened.setViewport(
          frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { width: 1600, height: 1000, deviceScaleFactor: 1 }
        );
        await opened.goto(frontendUrl(kernelPort, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await opened.waitForFunction('window.siyuan && window.siyuan.config' as never, { timeout: 30000 });
        return opened;
      };

      page = await openFrontend('desktop');
      mobilePage = await openFrontend('mobile');
      mount = await waitForMount(target, page, 10000);
      log(`挂载：${mount.loaded ?? mount.reason ?? '(无样式表)'}`, mount.ok ? 'success' : 'warn');
      log('常驻测量页：桌面端 + 移动端（无头）', 'info');
    } else {
      log('常驻测量页未开启（auditBrowser: false）；产物变化仍会刷新思源本体窗口', 'info');
    }

    // 4) 产物变化 → 统一整页刷新。刷新前关屏障，页面都回来后开屏障。
    let reloads = 0;
    let pending = new Set<string>();
    let batchTimer: NodeJS.Timeout | null = null;
    let refreshing = false;

    const applyReload = async (): Promise<boolean> => {
      if (refreshing) return false;
      refreshing = true;
      // 先关屏障：新的测量会被挡在 /acquire 之外重试，不会撞进刷新。
      control?.setReady(false);
      try {
        // 等已经在读数的人释放租约。只检查 ready 有竞态——有人检查完才开始刷新。
        // 超时说明有崩溃的测量进程没释放，照常刷新但如实警告。
        const idle = control ? await control.waitForIdle(TIMING.readLeaseDrainTimeout) : true;
        if (!idle) log('有测量会话未释放读租约（进程可能崩溃），仍继续刷新', 'warn');
        const result = await callKernel(kernelPort, '/api/ui/reloadUI', {});
        if (result.code !== 0) {
          log(`刷新失败：${result.msg || '未知错误'}`, 'warn');
          return false;
        }
        // 广播是全局的（本体 + 有时的两个常驻页）。有常驻页时等它们重新挂载完
        // 再放行测量，否则 agent 会撞进 themeStyle 还没挂上的空窗。
        const waiting: Array<Promise<boolean>> = [];
        if (page) waiting.push(waitForApp(page, log));
        if (mobilePage) waiting.push(waitForApp(mobilePage, log));
        const settled = await Promise.all(waiting);
        if (settled.some((ok) => !ok)) return false;
        return true;
      } finally {
        control?.setReady(true);
        refreshing = false;
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
      const label = `已刷新 #${reloads}：${primary}${suffix}`;
      try {
        const ok = await applyReload();
        const scope = auditBrowser ? '（本体 + 桌面端 + 移动端）' : '（仅思源本体窗口）';
        log(ok ? `${label}${scope}` : `${label}（未生效）`, ok ? 'success' : 'warn');
      } catch (cause) {
        log(`刷新出错：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
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
      mobilePage,
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
