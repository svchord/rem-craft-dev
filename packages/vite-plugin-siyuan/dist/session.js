/**
 * 测量会话：只负责浏览器生命周期与打开哪个前端，读数交给 probes。
 *
 *   const session = await createSession({ frontend: 'mobile' });
 *   // ...probe...
 *   await session.dispose();
 *
 * 两个入口：
 *   desktop  /stage/build/desktop/   （默认）
 *   mobile   /stage/build/mobile/    （独立构建，需 theme.json 的 frontends 含 mobile/browser-mobile/all）
 */
import puppeteer from 'puppeteer-core';
import { discover } from './control-server.js';
import { findChrome, findKernelPort, frontendUrl, MOBILE_VIEWPORT } from './siyuan.js';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 1 };
/**
 * `宽x高[@DPR]`，缺省给桌面视口。
 *
 * 第二个参数用「有没有传」判断而不是默认参数：调用方显式传 undefined
 * 表示「本前端不要文件级视口，用前端预设」，默认参数会把这种意图静默覆盖掉。
 * TS 里用 `arguments.length` 不划算，改成用哨兵重载：传 `null` 表示显式无回退。
 */
export function parseViewport(value, fallback) {
    if (!value)
        return fallback ?? DEFAULT_VIEWPORT;
    const match = value.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
    if (!match)
        throw new Error('viewport 格式应为 宽x高[@DPR]，例如 1280x764@2');
    return {
        width: Number(match[1]),
        height: Number(match[2]),
        deviceScaleFactor: Number(match[3] ?? 1),
    };
}
/** 按前端取视口：给了就用，没给则移动端用手机预设、桌面端用桌面预设。 */
export function viewportFor(frontend, viewport) {
    if (viewport)
        return viewport;
    return frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : DEFAULT_VIEWPORT;
}
/**
 * 打开会话。
 *
 * `attach` 时复用 `vite-plugin-siyuan` 暴露的浏览器；找不到就新开无头 Chrome。
 *
 * 端点通过本地控制服务发现（见 control-server.ts），不是项目目录下的
 * 相对文件——在插件项目起的 dev 浏览器，也能被主题项目的 measure 复用。
 */
export async function createSession({ frontend = 'desktop', viewport = null, attach = false, } = {}) {
    let browser;
    let attached = false;
    const targetViewport = viewportFor(frontend, viewport);
    const session = attach ? await discover() : { ok: false };
    if (session.ok) {
        browser = await puppeteer.connect({
            browserWSEndpoint: session.ws,
            defaultViewport: null,
        });
        attached = true;
    }
    else {
        const port = await findKernelPort();
        browser = await puppeteer.launch({
            executablePath: findChrome(),
            headless: true,
            defaultViewport: targetViewport,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const fresh = await browser.newPage();
        if (frontend === 'mobile')
            await fresh.setViewport(targetViewport);
        await fresh.goto(frontendUrl(port, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await fresh.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
        await sleep(1500);
    }
    // 按前端挑页面：attach 时浏览器里可能同时开着桌面和移动端，选错就量错地方。
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().includes(`stage/build/${frontend}`));
    if (!page) {
        await browser.disconnect().catch(() => { });
        throw new Error(`浏览器里没有 ${frontend} 页面（已有页面：${pages.map((candidate) => candidate.url()).join(' | ')}）`);
    }
    await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
    // 主题样式在壳子之后异步挂载；不等待会读到尚未生效的令牌值。
    await page
        .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')", { timeout: 5000 })
        .catch(() => { });
    await sleep(400);
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
        async dispose() {
            if (attached)
                await browser.disconnect();
            else
                await browser.close();
        },
    };
}
//# sourceMappingURL=session.js.map