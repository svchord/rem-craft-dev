/**
 * 人工复审入口：打开可见浏览器，把桌面端和移动端摆出来自己看。
 *
 * 自动测量回答「数值是多少」，但有些东西只有眼睛能判断：间距是否协调、
 * 暗色下对比度够不够、移动端触摸目标挤不挤、动画过渡顺不顺。这个命令就是
 * 给那类判断用的——它不是替代测量，而是第二双眼睛。
 *
 *   syt open                  # 桌面 + 移动端两个标签页
 *   syt open --frontend mobile
 *   syt open --shot           # 各截一张图到 ./shots/
 *   syt open --state dark     # 打开时直接切到某状态
 *   syt open --attach         # 复用 dev 会话的浏览器
 *
 * 两种模式，别混用：
 *
 *   可见模式（默认）——给人看。新开一个可见浏览器，每个前端一个标签页。
 *     注意：**可见模式下不要用 --shot**。Chrome 会把非前台标签页标记为
 *     `visibility: hidden` 并暂停渲染，截图会永久挂起。
 *
 *   无头模式（--headless）——给 CI / 存档。不开窗口，截图稳定。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { wantsHelp } from './cli-args.js';
import { discover } from '../core/control-server.js';
import { findChrome, findKernelPort, frontendUrl, MOBILE_VIEWPORT } from '../core/siyuan.js';
import { readThemeName } from '../core/theme.js';
const PREFIX = '[open] ';
const SHOT_DIR = './shots';
const USAGE = [
    '用法：syt open [选项]',
    '',
    '  --frontend desktop|mobile  只开某一个前端（缺省两个都开）',
    '  --shot                     截图到 ./shots/（自动无头）',
    '  --state dark|light|compact 打开时切到某状态',
    '  --attach                   复用正在跑的 dev 浏览器',
    '  --headless                 无头模式',
].join('\n');
const KNOWN_FRONTENDS = ['desktop', 'mobile'];
/** 解析参数。惰性执行——模块顶层解析会在被 import 时拿错 argv。 */
function parseArgv(argv) {
    const frontendIndex = argv.indexOf('--frontend');
    const stateIndex = argv.indexOf('--state');
    return {
        wanted: frontendIndex >= 0 ? [argv[frontendIndex + 1] ?? ''] : ['desktop', 'mobile'],
        shot: argv.includes('--shot'),
        attach: argv.includes('--attach'),
        headless: argv.includes('--headless'),
        state: stateIndex >= 0 ? (argv[stateIndex + 1] ?? null) : null,
    };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 把 <html> 推到目标状态（暗色/密度），复用时也只影响这个页面。 */
async function applyState(page, value) {
    if (!value)
        return;
    const mapping = {
        dark: ['data-theme-mode', 'dark'],
        light: ['data-theme-mode', 'light'],
        compact: ['data-ui-density', 'compact'],
    };
    const entry = mapping[value];
    if (!entry) {
        console.log(`${PREFIX}警告：未知状态 ${value}（可用：${Object.keys(mapping).join(' / ')}）`);
        return;
    }
    await page.evaluate((name, state) => document.documentElement.setAttribute(name, state), entry[0], entry[1]);
    await sleep(400);
}
/**
 * 找/开一个前端页面并等到主题挂载。复用时优先复用已开着的同前端页面。
 *
 * `bringToFront` 只在可见模式调用：无头模式没有前台概念，调用它反而会打乱
 * 截图时序（实测在无头下 bringToFront + 两页共存时 captureScreenshot 超时）。
 */
async function openFrontend(state, port, frontend, { visible, themeState = null }) {
    const browser = state.browser;
    if (!browser)
        throw new Error('浏览器未就绪');
    const marker = `stage/build/${frontend}`;
    const existing = (await browser.pages()).find((candidate) => candidate.url().includes(marker));
    let page = existing;
    const reused = Boolean(existing);
    if (!page) {
        page = await browser.newPage();
        await page.setViewport(frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { width: 1600, height: 1000 });
        await page.goto(frontendUrl(port, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    if (visible)
        await page.bringToFront().catch(() => { });
    await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
    // 主题异步挂载，等它出现再报告，否则日志会误导。
    await page
        .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')", { timeout: 8000 })
        .catch(() => { });
    await sleep(800);
    await applyState(page, themeState);
    const info = await page.evaluate(() => ({
        themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
        frontend: document.documentElement.getAttribute('data-frontend'),
        backend: document.documentElement.getAttribute('data-backend'),
        themeMode: document.documentElement.getAttribute('data-theme-mode'),
    }));
    console.log(`${PREFIX}${frontend}${reused ? '（复用已开页面）' : '（新开页面）'}：` +
        `${info.themeStyle ? '已挂主题' : '未挂主题'} frontend=${info.frontend ?? '?'} ` +
        `backend=${info.backend ?? '?'} mode=${info.themeMode ?? '?'}`);
    if (!info.themeStyle) {
        console.log(`${PREFIX}提示：${frontend} 端没挂上主题，检查 theme.json 的 frontends 是否含 all`);
    }
    return page;
}
/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runOpenCli(argv = process.argv.slice(2)) {
    if (wantsHelp(argv)) {
        console.log(USAGE);
        return;
    }
    const { wanted, shot, attach, headless, state: themeState } = parseArgv(argv);
    const state = { browser: null, attached: false, profile: null, closing: false };
    const shutdown = async (code = 0) => {
        if (state.closing)
            return;
        state.closing = true;
        try {
            if (state.browser) {
                // 复用时只断开，别把用户的 dev 窗口关掉。
                if (state.attached)
                    await state.browser.disconnect();
                else
                    await state.browser.close();
            }
        }
        catch {
            // 已经没了
        }
        try {
            if (state.profile)
                rmSync(state.profile, { recursive: true, force: true });
        }
        catch {
            // 已经没了
        }
        process.exit(code);
    };
    process.on('SIGINT', () => void shutdown(0));
    process.on('SIGTERM', () => void shutdown(0));
    try {
        // 截图必须无头：可见模式下非前台标签页被 Chrome 暂停渲染，截图会永久挂起。
        if (shot && !headless && !attach) {
            console.log(`${PREFIX}提示：--shot 会自动使用无头模式（可见窗口里非前台标签页会被暂停渲染，截图挂起）`);
        }
        const useHeadless = headless || shot;
        if (attach && !useHeadless) {
            const session = await discover();
            if (!session.ok) {
                console.error(`${PREFIX}--attach 需要有一个正在运行的 dev 会话：${session.reason}`);
                for (const candidate of session.candidates) {
                    console.error(`${PREFIX}  候选：${candidate.cwd}（${candidate.kind} / ${candidate.name}）`);
                }
                await shutdown(2);
                return;
            }
            state.browser = await puppeteer.connect({ browserWSEndpoint: session.ws, defaultViewport: null });
            state.attached = true;
            console.log(`${PREFIX}复用 dev 会话：${session.cwd}（${session.kind} / ${session.name}）`);
        }
        else {
            state.profile = mkdtempSync(join(tmpdir(), 'vps-open-'));
            state.browser = await puppeteer.launch({
                executablePath: findChrome(),
                headless: useHeadless,
                defaultViewport: null,
                // 截图偶尔会等渲染稳定，默认 180s 太长；给一个明确上限，卡住就报错而不是静默挂起。
                protocolTimeout: 60000,
                args: useHeadless
                    ? ['--no-first-run', '--no-default-browser-check']
                    : [
                        '--window-size=1700,1000',
                        '--no-first-run',
                        '--no-default-browser-check',
                        `--user-data-dir=${state.profile}`,
                    ],
            });
            console.log(`${PREFIX}${useHeadless ? '无头浏览器' : '可见浏览器'}`);
        }
        const port = await findKernelPort();
        console.log(`${PREFIX}主题：${readThemeName() ?? '(未知)'} kernel=${port}${themeState ? ` 状态=${themeState}` : ''}`);
        const opened = [];
        for (const name of wanted) {
            const frontend = KNOWN_FRONTENDS.find((known) => known === name);
            if (!frontend) {
                console.log(`${PREFIX}警告：跳过未知前端 ${name}（可用：desktop / mobile）`);
                continue;
            }
            const page = await openFrontend(state, port, frontend, { visible: !useHeadless, themeState });
            opened.push({ frontend, page });
        }
        if (shot) {
            mkdirSync(SHOT_DIR, { recursive: true });
            for (const { frontend, page } of opened) {
                const file = join(SHOT_DIR, `${frontend}.png`);
                // 截图前必须把目标页提到前台：Chrome 对后台标签页会节流渲染，
                // captureScreenshot 会一直等不到帧而超时（实测无头下也如此）。
                await page.bringToFront().catch(() => { });
                await sleep(700);
                await page.screenshot({ path: file, fullPage: false });
                console.log(`${PREFIX}截图：${file}`);
            }
            console.log(`${PREFIX}截图完成，退出`);
            await shutdown(0);
            return;
        }
        console.log(`${PREFIX}浏览器已打开，可直接交互（点菜单、切暗色、缩窗口都是真实渲染）。`);
        if (!state.attached)
            console.log(`${PREFIX}想让改样式即时生效：另开终端跑 vite build --watch`);
        console.log(`${PREFIX}Ctrl+C 结束${state.attached ? '（只断开连接，不关掉 dev 窗口）' : ''}`);
        await new Promise(() => { });
    }
    catch (error) {
        console.error(`${PREFIX}${error instanceof Error ? error.message : String(error)}`);
        await shutdown(2);
    }
}
//# sourceMappingURL=open.js.map