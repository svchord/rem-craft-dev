/**
 * 开发会话：把「产物已经在了」之后的全部工作收在一处。
 *
 * 谁负责构建不是这里的事——CLI 形态自己 spawn `vite build --watch`，
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { watchArtifact } from './build.js';
import { startControlServer } from './control-server.js';
import { checkLinkedFiles, ensureLink } from './link.js';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.js';
import { createTarget } from './targets.js';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 一批产物变化的合并窗口（一次构建常同时写多个文件）。 */
const BATCH_MS = 250;
/**
 * 等被测对象真的挂上，而不是拍一个固定时长。
 *
 * 主题样式、插件实例都在思源壳子之后异步出现，固定 sleep 会时快时慢。
 * 这里轮询 mountState，超时才如实报告。
 */
async function waitForMount(target, page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = {
        ok: false,
        loaded: null,
        reason: '尚未检查',
    };
    while (Date.now() < deadline) {
        try {
            last = await target.mountState(page);
            // ok 只表示「这个类型允许没有样式表」，不代表已经挂上。
            // 要等真正读到东西（loaded 有值）才算就绪。
            if (last.ok && last.loaded)
                return last;
        }
        catch {
            // 页面还在导航，继续等
        }
        await sleep(200);
    }
    return last;
}
/** 等页面回到可用状态（导航、手动 F5 之后）。 */
async function waitForApp(page, log) {
    try {
        await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 20000 });
        return true;
    }
    catch {
        log('页面刷新后没能恢复（可能仍在导航），下一次改动会再试');
        return false;
    }
}
/**
 * 开会话。产物目录应当已经存在（或即将被构建写入）。
 */
export async function startDevSession({ kind, name = null, cwd = process.cwd(), outDir = null, link = true, headless = false, frontend = 'desktop', log = (message) => console.log(`[dev] ${message}`), watch = true, }) {
    const target = createTarget(kind, { name, cwd });
    const buildConfig = target.buildConfig();
    const resolvedOutDir = outDir ?? buildConfig.outDir;
    let browser = null;
    let watcher = null;
    let profile = null;
    let control = null;
    let closing = false;
    const shutdown = async () => {
        if (closing)
            return;
        closing = true;
        for (const cleanup of [() => watcher?.close(), () => control?.stop()]) {
            try {
                cleanup();
            }
            catch {
                // 已经没了
            }
        }
        try {
            if (browser)
                await browser.close();
        }
        catch {
            // 已经没了
        }
        try {
            if (profile)
                rmSync(profile, { recursive: true, force: true });
        }
        catch {
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
            if (!result.ok)
                throw new Error(result.reason ?? '建立链接失败');
            log(result.changed ? `已链接：${targetPath}（${result.linkType}）` : `链接已存在：${targetPath}`);
            const check = checkLinkedFiles(targetPath, buildConfig.expectedFiles);
            if (!check.ok)
                log(`提示：链接目录里还缺 ${check.missing.join('、')}（构建可能还没写完）`);
        }
        // 2) 让思源用上它。只问「有没有 activate 能力」，不做类型判断。
        if (target.activate) {
            const activation = await target.activate(null, { port: kernelPort });
            log(activation.message);
            if (!activation.ok)
                throw new Error(activation.message);
        }
        // 3) 浏览器 + 控制服务
        profile = mkdtempSync(join(tmpdir(), 'vps-dev-'));
        browser = await puppeteer.launch({
            executablePath: findChrome(),
            headless,
            defaultViewport: null,
            args: ['--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`],
        });
        control = await startControlServer({
            ws: browser.wsEndpoint(),
            cwd,
            kind: target.kind,
            name: target.name,
        });
        const pages = await browser.pages();
        const page = pages[0] ?? (await browser.newPage());
        await page.goto(frontendUrl(kernelPort, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
        const mount = await waitForMount(target, page, 10000);
        log(`挂载：${mount.ok ? (mount.loaded ?? '(无样式表)') : `未挂上 — ${mount.reason}`}`);
        // 4) 重载：一批改动只处理一次
        let reloads = 0;
        let pending = new Set();
        let batchTimer = null;
        const applyReload = async (filename) => {
            try {
                const result = await target.reload(page, { filename, port: kernelPort });
                if (result.message)
                    log(result.message);
                return result.ok;
            }
            catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                // 页面恰好被手动刷新（F5）时 evaluate 会抛上下文销毁，不是错误。
                if (/Execution context|detached|navigat|Target closed/i.test(message)) {
                    return waitForApp(page, log);
                }
                throw cause;
            }
        };
        const flush = async () => {
            batchTimer = null;
            const files = [...pending];
            pending = new Set();
            if (!files.length)
                return;
            const primary = buildConfig.primary(files);
            reloads += 1;
            const label = `已重载 #${reloads}：${primary}${files.length > 1 ? `（+ ${files.length - 1}）` : ''}`;
            try {
                const ok = await applyReload(primary);
                log(label + (ok ? '' : '（失败）'));
            }
            catch (cause) {
                log(`重载出错：${cause instanceof Error ? cause.message : String(cause)}`);
            }
        };
        const notifyChange = (filenames) => {
            for (const filename of [].concat(filenames)) {
                if (buildConfig.match(filename))
                    pending.add(filename);
            }
            if (!pending.size)
                return;
            if (batchTimer)
                clearTimeout(batchTimer);
            batchTimer = setTimeout(() => void flush(), BATCH_MS);
        };
        if (watch) {
            watcher = watchArtifact(join(cwd, resolvedOutDir), {
                match: buildConfig.match,
                onChange: notifyChange,
            });
        }
        log(`kernel: http://127.0.0.1:${kernelPort}`);
        log('另开终端：siyuan-devtools measure <子命令> --attach   # 量真实渲染');
        return {
            target,
            buildConfig,
            browser,
            page,
            kernelPort,
            control,
            notifyChange,
            stop: shutdown,
        };
    }
    catch (cause) {
        await shutdown();
        throw cause;
    }
}
//# sourceMappingURL=dev-session.js.map