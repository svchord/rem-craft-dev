/**
 * 测量会话：只负责浏览器生命周期与打开哪个前端，读数交给 page-read.ts。
 *
 *   const session = await createSession({ frontend: 'mobile' });
 *   // ...读数...
 *   await session.dispose();
 *
 * 两个常驻页：desktop /stage/build/desktop/ 与 mobile /stage/build/mobile/
 * （独立构建，需 theme.json 的 frontends 含 mobile/browser-mobile/all）。
 * `frontend` 在这里的语义是「从 dev 会话的两个常驻页里选哪个」，不是「打开哪个前端」。
 *
 * 端点通过本地控制服务发现（control-server.ts），不是项目目录下的相对文件——
 * 在插件项目起的 dev 浏览器，也能被主题项目的 measure 复用。
 *
 * 复用时先等 dev 会话的刷新屏障：整页刷新期间读数会是空的，等页面重新挂载完再量。
 */
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { acquireReadLease, discover } from './control-server.ts';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.ts';
import type { Frontend } from './siyuan.ts';
import { DEFAULT_VIEWPORT, MOBILE_VIEWPORT } from './viewport.ts';
import type { ResolvedViewport } from './viewport.ts';
import { isNavigationError, requireRecoverable, UserFacingError } from './errors.ts';
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
  /** 从两个常驻页里选哪个（缺省 desktop）。 */
  frontend?: Frontend;
  /** 仅在新开浏览器时生效；复用常驻页时视口已固定，见下方检查。 */
  viewport?: ResolvedViewport | null;
  /** 复用正在跑的 dev 会话的两个常驻页之一。 */
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

/** 打开会话。attach 时复用 dev 浏览器的常驻页；没指定 attach 才新开无头 Chrome。 */
export async function createSession({
  frontend = 'desktop',
  viewport = null,
  attach = false,
}: CreateSessionOptions = {}): Promise<Session> {
  let browser: Browser;
  let attached = false;
  let releaseLease: (() => Promise<void>) | null = null;
  const targetViewport = viewportFor(frontend, viewport);

  const discovered = attach ? await discover() : null;
  // --attach 是明确要求复用常驻页。连不上就报错，不静默退化成新开浏览器——
  // 否则 agent 会以为自己量的是 dev 会话那个页面，其实是另一个新页面，结论全建立在错前提上。
  if (attach && !discovered?.ok) {
    const reason = discovered ? discovered.reason : '无可用端点';
    throw new UserFacingError(
      `--attach 连不上 dev 会话的常驻测量页：${reason}\n` +
        '常见原因是该会话未开启 auditBrowser（默认关闭），或 pnpm dev 没在跑。\n' +
        '两条出路：去掉 --attach，会新开无头页面读数（每次约 4s）；\n' +
        '或在 siyuanPlugin({ auditBrowser: true }) 下运行 pnpm dev，再带 --attach 复用常驻页。'
    );
  }
  if (discovered?.ok) {
    // 常驻页的视口在建页时就定死了，--viewport 覆盖不了它。
    // 静默忽略会让 agent 以为自己量的是 390 宽，实际是 1600——必须报错。
    if (viewport) {
      throw new UserFacingError(
        '复用 dev 常驻页时不能用 --viewport：该页视口已固定。去掉 --attach 会新开一个指定视口的页面。'
      );
    }
    // 读租约：刷新期间会等待，拿到后 dev 会等我们释放才广播下一次刷新。
    // 只检查 ready 有竞态——检查完、读数前刷新才开始的那种挡不住。
    // 没有 port 就没法申请租约，必须报错，不能静默降级成「无屏障读数」。
    if (discovered.port === undefined) {
      throw new UserFacingError(
        '--attach 连上的 dev 会话没有提供控制端口，无法申请读租约；请重启 pnpm dev（升级到支持读租约的版本）后重试。'
      );
    }
    releaseLease = await acquireReadLease(discovered.port, TIMING.refreshReadyTimeout);
    if (!releaseLease) {
      throw new UserFacingError('等待 dev 会话刷新完成超时（页面可能卡住），本次测量已取消');
    }
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: discovered.ws,
        defaultViewport: null,
      });
    } catch (cause) {
      await releaseLease?.();
      throw cause;
    }
    attached = true;
  } else {
    const port = await findKernelPort();
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      defaultViewport: targetViewport,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    // goto / 等 config 失败时必须关掉刚起的 Chrome，否则进程会挂住不退出。
    try {
      const fresh = await browser.newPage();
      if (frontend === 'mobile') await fresh.setViewport(targetViewport);
      await fresh.goto(frontendUrl(port, frontend), {
        waitUntil: 'domcontentloaded',
        timeout: TIMING.navigationTimeout,
      });
      await waitForSiyuanConfig(fresh);
      await sleep(TIMING.pageReady);
    } catch (cause) {
      try {
        await browser.close();
      } catch {
        // 已经关了
      }
      if (cause instanceof Error && /net::ERR_|ECONNREFUSED|ERR_CONNECTION/i.test(cause.message)) {
        throw new UserFacingError(
          `打不开思源前端页面（kernel 端口 ${port} 不可达）：${cause.message}\n` +
            '确认思源已启动、端口正确，或设置 SIYUAN_PORT 指向运行中的内核。'
        );
      }
      throw cause;
    }
  }

  try {
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

    // 复用的常驻页由 dev 会话负责保持最新（产物一变就整页刷新，屏障解除后才放行测量）。
    // 这里不需要、也不该再对页面做任何 DOM 修改：那会污染共享页，且和刷新机制重复。
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
        try {
          if (attached) await browser.disconnect();
          else await browser.close();
        } finally {
          await releaseLease?.();
        }
      },
    };
  } catch (cause) {
    // 失败路径也要断开 CDP / 关掉新开的 Chrome，否则 CLI 用 exitCode 不 exit 时
    // 泄漏的进程会吊住 event loop，退出码都交不出去。
    try {
      if (attached) await browser.disconnect();
      else await browser.close();
    } catch {
      // 清理尽力而为，不能盖掉原始错误
    }
    await releaseLease?.();
    throw cause;
  }
}
