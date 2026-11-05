/**
 * 测量会话：只负责浏览器生命周期与打开哪个前端，读数交给 page-read.ts。
 *
 *   const session = await createSession({ frontend: 'mobile' });
 *   // ...读数...
 *   await session.dispose();
 *
 * 两个入口：desktop /stage/build/desktop/（默认）、mobile /stage/build/mobile/
 * （独立构建，需 theme.json 的 frontends 含 mobile/browser-mobile/all）。
 *
 * 端点通过本地控制服务发现（control-server.ts），不是项目目录下的相对文件——
 * 在插件项目起的 dev 浏览器，也能被主题项目的 measure 复用。
 */
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { discover } from './control-server.ts';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.ts';
import type { Frontend } from './siyuan.ts';
import { DEFAULT_VIEWPORT, MOBILE_VIEWPORT } from './viewport.ts';
import type { ResolvedViewport } from './viewport.ts';
import { isNavigationError, requireRecoverable } from './errors.ts';
import { sleep, TIMING } from './timing.ts';

// 类型仍从 session.ts 对外导出（index.ts 从这里 import）。
export type { ResolvedViewport } from './viewport.ts';

/** `宽x高[@DPR]`，缺省给桌面视口。 */
export function parseViewport(value?: string | null, fallback?: ResolvedViewport | null): ResolvedViewport {
  if (!value) return fallback ?? DEFAULT_VIEWPORT;
  const match = value.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
  if (!match) throw new Error('viewport 格式应为 宽x高[@DPR]，例如 1280x764@2');
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    deviceScaleFactor: Number(match[3] ?? 1),
  };
}

/** 按前端取视口：给了就用，没给则移动端用手机预设、桌面端用桌面预设。 */
export function viewportFor(frontend: Frontend, viewport?: ResolvedViewport | null): ResolvedViewport {
  if (viewport) return viewport;
  return frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : DEFAULT_VIEWPORT;
}

/** 测量会话。 */
export interface Session {
  browser: Browser;
  page: Page;
  /** 是否复用了正在跑的 dev 浏览器。 */
  attached: boolean;
  frontend: Frontend;
  viewport: ResolvedViewport;
  dispose(): Promise<void>;
}

/** 开会话的选项。 */
export interface CreateSessionOptions {
  frontend?: Frontend;
  viewport?: ResolvedViewport | null;
  /** 复用正在跑的 dev 会话（省一次启动，且量的是你眼前那个窗口）。 */
  attach?: boolean;
}

/** 等思源前端把 config 挂上来（函数体在浏览器里跑，不引用 Node 作用域）。 */
function waitForSiyuanConfig(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => {
      const raw: unknown = Reflect.get(globalThis, 'siyuan');
      if (!raw || typeof raw !== 'object') return false;
      return Boolean(Reflect.get(raw, 'config'));
    },
    { timeout: TIMING.navigationTimeout }
  );
}

/** 等待类失败中，只容许导航竞态与超时；其它错误重抛。 */
function tolerateWaitFailure(cause: unknown): void {
  if (isNavigationError(cause)) return;
  requireRecoverable(cause);
}

/** 打开会话。attach 时复用 dev 浏览器；找不到就新开无头 Chrome。 */
export async function createSession({
  frontend = 'desktop',
  viewport = null,
  attach = false,
}: CreateSessionOptions = {}): Promise<Session> {
  let browser: Browser;
  let attached = false;
  const targetViewport = viewportFor(frontend, viewport);

  const discovered = attach ? await discover() : null;
  if (discovered?.ok) {
    browser = await puppeteer.connect({
      browserWSEndpoint: discovered.ws,
      defaultViewport: null,
    });
    attached = true;
  } else {
    const port = await findKernelPort();
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      defaultViewport: targetViewport,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    const fresh = await browser.newPage();
    if (frontend === 'mobile') await fresh.setViewport(targetViewport);
    await fresh.goto(frontendUrl(port, frontend), {
      waitUntil: 'domcontentloaded',
      timeout: TIMING.navigationTimeout,
    });
    await waitForSiyuanConfig(fresh);
    await sleep(TIMING.pageReady);
  }

  // 按前端挑页面：attach 时浏览器里可能同时开着桌面和移动端，选错就量错地方。
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes(`stage/build/${frontend}`));
  if (!page) {
    try {
      await browser.disconnect();
    } catch (cause) {
      tolerateWaitFailure(cause);
    }
    throw new Error(
      `浏览器里没有 ${frontend} 页面（已有页面：${pages.map((candidate) => candidate.url()).join(' | ')}）`
    );
  }

  await waitForSiyuanConfig(page);
  // 主题样式在壳子之后异步挂载；等不到不报错，由 environment 读数如实反映。
  await page
    .waitForFunction(() => Boolean(document.getElementById('themeStyle')?.getAttribute('href')), {
      timeout: TIMING.themeStyleWait,
    })
    .catch((cause: unknown) => tolerateWaitFailure(cause));
  await sleep(TIMING.navSettle);

  return {
    browser,
    page,
    attached,
    frontend,
    viewport: attached
      ? await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio || 1,
        }))
      : targetViewport,
    async dispose(): Promise<void> {
      if (attached) await browser.disconnect();
      else await browser.close();
    },
  };
}
