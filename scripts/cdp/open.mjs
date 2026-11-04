/**
 * 人工审计入口：打开可见浏览器，把桌面端和移动端页面并排摆出来看。
 *
 * 自动回归（pnpm verify:theme）回答「数值对不对」，但有些东西只有眼睛能判断：
 * 间距是否协调、暗色下对比度够不够、移动端触摸目标会不会太挤。这个命令就是给
 * 那类判断用的——它不是替代 verify，而是 verify 之外的第二双眼睛。
 *
 *   pnpm open:theme                  # 桌面 + 移动端，两个标签页
 *   pnpm open:theme --frontend mobile
 *   pnpm open:theme --frontend desktop
 *   pnpm open:theme --shot           # 各截一张图存到 ./shots/
 *   pnpm open:theme --dev            # 同时起 pnpm dev（改样式即时生效）
 *
 * 窗口是可见的、可以直接交互：点开菜单、切暗色、缩窗口，都是真实渲染。
 * Ctrl+C 结束。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChrome, findKernelPort, frontendUrl, MOBILE_VIEWPORT } from './siyuan.mjs';
import { readThemeName } from './theme.mjs';

const PREFIX = '[open] ';
const SHOT_DIR = './shots';
const args = process.argv.slice(2);
const wantMobile = !args.includes('--frontend') || args.includes('mobile');
const wantDesktop = !args.includes('--frontend') || args.includes('desktop');
const shot = args.includes('--shot');
const withDev = args.includes('--dev');

let browser = null;
let devProc = null;
let profile = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    devProc?.kill();
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}
  try {
    if (profile) rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 打开一个前端页面并等到主题挂载完成。 */
async function openFrontend(port, frontend, viewport) {
  const page = await browser.newPage();
  if (frontend === 'mobile') await page.setViewport(MOBILE_VIEWPORT);
  else await page.setViewport(viewport);
  await page.goto(frontendUrl(port, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
  // 主题异步挂载，等它出现再报告，否则日志会误导。
  await page
    .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')", { timeout: 8000 })
    .catch(() => {});
  await sleep(1200);

  const state = await page.evaluate(() => ({
    themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
    frontend: document.documentElement.getAttribute('data-frontend'),
    backend: document.documentElement.getAttribute('data-backend'),
    themeMode: document.documentElement.getAttribute('data-theme-mode'),
    rcRadius: getComputedStyle(document.documentElement).getPropertyValue('--rc-radius-base').trim(),
  }));

  console.log(
    PREFIX +
      frontend +
      '：' +
      (state.themeStyle ? '已挂主题' : '未挂主题') +
      ' frontend=' +
      (state.frontend ?? '?') +
      ' backend=' +
      (state.backend ?? '?') +
      ' mode=' +
      (state.themeMode ?? '?') +
      ' --rc-radius-base=' +
      (state.rcRadius || '(空)')
  );
  if (!state.themeStyle) {
    console.log(PREFIX + '提示：' + frontend + ' 端没挂上主题，检查 theme.json 的 frontends 是否含 all');
  }

  return page;
}

async function main() {
  if (withDev) {
    // 复用 pnpm dev：它负责构建 watch + 让思源重载主题。
    devProc = spawn(process.execPath, [join(process.cwd(), 'scripts', 'dev-live.mjs')], { stdio: 'inherit' });
    await sleep(6000);
  }

  const port = await findKernelPort();
  profile = mkdtempSync(join(tmpdir(), 'rc-open-'));
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1700,1000', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile],
  });

  const themeName = readThemeName();
  console.log(PREFIX + '主题：' + themeName + ' kernel=' + port);

  const pages = [];
  if (wantDesktop)
    pages.push({ frontend: 'desktop', page: await openFrontend(port, 'desktop', { width: 1600, height: 1000 }) });
  if (wantMobile) pages.push({ frontend: 'mobile', page: await openFrontend(port, 'mobile', MOBILE_VIEWPORT) });

  if (shot) {
    mkdirSync(SHOT_DIR, { recursive: true });
    for (const { frontend, page } of pages) {
      const file = join(SHOT_DIR, frontend + '.png');
      await page.screenshot({ path: file, fullPage: false });
      console.log(PREFIX + '截图：' + file);
    }
  }

  console.log(PREFIX + '浏览器已打开，可直接交互。Ctrl+C 结束。');
  if (!withDev) console.log(PREFIX + '想让改样式即时生效：另开终端跑 pnpm dev，或加 --dev');

  await new Promise(() => {});
}

try {
  await main();
} catch (error) {
  console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
  await shutdown(2);
}
