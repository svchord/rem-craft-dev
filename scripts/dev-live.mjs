/**
 * 一条命令替代 vite build --watch：
 *   Vite dev server（HMR）+ 可见浏览器（思源前端）+ 自动注入 HMR 客户端
 *   浏览器由 puppeteer-core 启动，同时开放 CDP 端口给 pnpm inspect 使用。
 *
 *   pnpm dev              可见窗口
 *   pnpm dev --headless   无头
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChrome, findKernelPort, frontendUrl } from './cdp/siyuan.mjs';

const VITE_PORT = Number(process.env.RC_VITE_PORT || 5273);
const CDP_PORT = Number(process.env.RC_CDP_PORT || 9444);
const headless = process.argv.includes('--headless');

let browser = null;
let viteProc = null;
let profile = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    if (browser) await browser.close();
  } catch {}
  try {
    if (viteProc) viteProc.kill();
  } catch {}
  try {
    if (profile) rmSync(profile, { recursive: true, force: true });
  } catch {}
  try {
    rmSync('.rc-cdp-ws', { force: true });
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// 1) Vite dev server
const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
viteProc = spawn(process.execPath, [viteBin, '--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'inherit',
});
viteProc.on('exit', (code) => {
  if (!closing) {
    console.error('[dev] vite exited ' + code);
    shutdown(1);
  }
});
if (!(await waitUrl('http://127.0.0.1:' + VITE_PORT + '/@vite/client', 20000))) {
  console.error('[dev] vite dev server 启动超时');
  await shutdown(1);
}
console.log('[dev] vite ready: http://127.0.0.1:' + VITE_PORT);

// 1.5) 先补一次静态构建，保证 dev/theme.css 存在（pnpm build 会清空 dev/）
await new Promise((resolve) => {
  const b = spawn(process.execPath, [viteBin, 'build', '--outDir', 'dev', '--emptyOutDir', 'false'], {
    stdio: 'ignore',
  });
  b.on('exit', () => resolve());
});
console.log('[dev] static dev/theme.css refreshed');

// 2) 浏览器（puppeteer-core）
const kernelPort = await findKernelPort();
const target = frontendUrl(kernelPort);
profile = mkdtempSync(join(tmpdir(), 'rc-dev-'));
browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: headless ? true : false,
  defaultViewport: null,
  args: ['--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile],
});
writeFileSync('.rc-cdp-ws', browser.wsEndpoint());
console.log('[dev] browser launched');

const pages = await browser.pages();
const page = pages.length ? pages[0] : await browser.newPage();
await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
console.log('[dev] opened: ' + target);

// 3) 注入 HMR 客户端
const injected = await page.evaluate(async (viteOrigin) => {
  if (window.__RC_DEV_HMR__) return 'already';
  await import(viteOrigin + '/@vite/client');
  await import(viteOrigin + '/src/styles/index.css');
  window.__RC_DEV_HMR__ = true;
  return 'ok';
}, 'http://127.0.0.1:' + VITE_PORT);
console.log('[dev] HMR injected: ' + injected);

console.log('[dev] kernel: http://127.0.0.1:' + kernelPort);
console.log('[dev] 改 src/styles/** 自动热更新；另开终端：pnpm inspect / pnpm audit');
console.log('[dev] Ctrl+C 结束');

await new Promise(() => {});
