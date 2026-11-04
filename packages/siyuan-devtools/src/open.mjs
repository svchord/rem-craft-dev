/**
 * 人工复审入口：打开可见浏览器，把桌面端和移动端摆出来自己看。
 *
 * 自动回归（pnpm verify:theme）回答「数值对不对」，但有些东西只有眼睛能判断：
 * 间距是否协调、暗色下对比度够不够、移动端触摸目标挤不挤、动画过渡顺不顺。
 * 这个命令就是给那类判断用的——它不是替代 verify，而是第二双眼睛。
 *
 *   pnpm open:theme                  # 桌面 + 移动端两个标签页
 *   pnpm open:theme --frontend mobile
 *   pnpm open:theme --shot           # 各截一张图到 ./shots/
 *   pnpm open:theme --state dark     # 打开时直接切到某状态（dark / light / compact）
 *   pnpm open:theme --attach         # 复用 pnpm dev 的浏览器
 *   pnpm open:theme --headless       # 无头（只用于 --shot，见下）
 *
 * 两种模式，别混用：
 *
 *   可见模式（默认）——给人看。
 *     新开一个可见浏览器，每个前端一个标签页。复用时连 pnpm dev 的浏览器。
 *     注意：**可见模式下不要用 --shot**。Chrome 会把非前台标签页标记为
 *     `visibility: hidden` 并暂停渲染，截图会永久挂起（实测 CDP 的
 *     Page.captureScreenshot 也一样卡住）。要截图用无头模式。
 *
 *   无头模式（--headless）——给 CI / 存档。
 *     不开窗口，每个前端独立一页，截图稳定。这也是 verify 的测量环境。
 *
 * Ctrl+C 结束（复用时只断开连接，不关掉 dev 窗口）。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findEndpoint } from './cdp-registry.mjs';
import { findChrome, findKernelPort, frontendUrl, MOBILE_VIEWPORT } from './siyuan.mjs';
import { readThemeName } from './theme.mjs';

const PREFIX = '[open] ';
const SHOT_DIR = './shots';
const args = process.argv.slice(2);

const frontendArg = args.indexOf('--frontend');
const wanted = frontendArg >= 0 ? [args[frontendArg + 1]] : ['desktop', 'mobile'];
const shot = args.includes('--shot');
const attach = args.includes('--attach');
const headless = args.includes('--headless');
const stateArg = args.indexOf('--state');
const state = stateArg >= 0 ? args[stateArg + 1] : null;

let browser = null;
let attached = false;
let profile = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    if (browser) {
      // 复用时只断开，别把用户的 dev 窗口关掉。
      if (attached) await browser.disconnect();
      else await browser.close();
    }
  } catch {}
  try {
    if (profile) rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 把 <html> 推到目标状态（暗色/密度），复用时也只影响这个页面。 */
async function applyState(page, value) {
  if (!value) return;
  const mapping = {
    dark: ['data-theme-mode', 'dark'],
    light: ['data-theme-mode', 'light'],
    compact: ['data-ui-density', 'compact'],
  };
  const entry = mapping[value];
  if (!entry) {
    console.log(PREFIX + '警告：未知状态 ' + value + '（可用：' + Object.keys(mapping).join(' / ') + '）');
    return;
  }
  await page.evaluate((name, v) => document.documentElement.setAttribute(name, v), entry[0], entry[1]);
  await sleep(400);
}

/**
 * 找/开一个前端页面并等到主题挂载。复用时优先复用已开着的同前端页面。
 *
 * `bringToFront` 只在可见模式调用：无头模式没有前台概念，调用它反而会打乱
 * 截图时序（实测在无头下 bringToFront + 两页共存时 captureScreenshot 超时）。
 */
async function openFrontend(port, frontend, { visible }) {
  const marker = 'stage/build/' + frontend;
  const existing = (await browser.pages()).find((p) => p.url().includes(marker));
  let page = existing;
  const reused = Boolean(existing);

  if (!page) {
    page = await browser.newPage();
    await page.setViewport(frontend === 'mobile' ? MOBILE_VIEWPORT : { width: 1600, height: 1000 });
    await page.goto(frontendUrl(port, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  if (visible) await page.bringToFront().catch(() => {});
  await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
  // 主题异步挂载，等它出现再报告，否则日志会误导。
  await page
    .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')", { timeout: 8000 })
    .catch(() => {});
  await sleep(800);
  await applyState(page, state);

  const info = await page.evaluate(() => ({
    themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
    frontend: document.documentElement.getAttribute('data-frontend'),
    backend: document.documentElement.getAttribute('data-backend'),
    themeMode: document.documentElement.getAttribute('data-theme-mode'),
    rcRadius: getComputedStyle(document.documentElement).getPropertyValue('--rc-radius-base').trim(),
  }));

  console.log(
    PREFIX +
      frontend +
      (reused ? '（复用已开页面）' : '（新开页面）') +
      '：' +
      (info.themeStyle ? '已挂主题' : '未挂主题') +
      ' frontend=' +
      (info.frontend ?? '?') +
      ' backend=' +
      (info.backend ?? '?') +
      ' mode=' +
      (info.themeMode ?? '?') +
      ' --rc-radius-base=' +
      (info.rcRadius || '(空)')
  );
  if (!info.themeStyle) {
    console.log(PREFIX + '提示：' + frontend + ' 端没挂上主题，检查 theme.json 的 frontends 是否含 all');
  }

  return page;
}

async function main() {
  // 截图必须无头：可见模式下非前台标签页被 Chrome 暂停渲染，截图会永久挂起。
  if (shot && !headless && !attach) {
    console.log(PREFIX + '提示：--shot 会自动使用无头模式（可见窗口里非前台标签页会被暂停渲染，截图挂起）');
  }
  const useHeadless = headless || shot;

  if (attach && !useHeadless) {
    const endpoint = findEndpoint();
    if (!endpoint.ok) {
      console.error(PREFIX + '--attach 需要有一个正在运行的 dev 浏览器：' + endpoint.reason);
      for (const candidate of endpoint.candidates ?? []) {
        console.error(PREFIX + '  候选：' + candidate.cwd + '（pid ' + candidate.pid + '）');
      }
      process.exit(2);
    }
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint.ws,
      defaultViewport: null,
    });
    attached = true;
    console.log(PREFIX + '复用 dev 浏览器：' + endpoint.cwd);
  } else {
    profile = mkdtempSync(join(tmpdir(), 'rc-open-'));
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: useHeadless,
      defaultViewport: null,
      // 截图偶尔会等渲染稳定，默认 180s 太长；给一个明确上限，卡住就报错而不是静默挂起。
      protocolTimeout: 60000,
      args: useHeadless
        ? ['--no-first-run', '--no-default-browser-check']
        : ['--window-size=1700,1000', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile],
    });
    console.log(PREFIX + (useHeadless ? '无头浏览器' : '可见浏览器'));
  }

  const port = await findKernelPort();
  console.log(PREFIX + '主题：' + readThemeName() + ' kernel=' + port + (state ? ' 状态=' + state : ''));

  const pages = [];
  for (const frontend of wanted) {
    if (!['desktop', 'mobile'].includes(frontend)) {
      console.log(PREFIX + '警告：跳过未知前端 ' + frontend + '（可用：desktop / mobile）');
      continue;
    }
    pages.push({ frontend, page: await openFrontend(port, frontend, { visible: !useHeadless }) });
  }

  if (shot) {
    mkdirSync(SHOT_DIR, { recursive: true });
    for (const { frontend, page } of pages) {
      const file = join(SHOT_DIR, frontend + '.png');
      // 截图前必须把目标页提到前台：Chrome 对后台标签页会节流渲染，
      // captureScreenshot 会一直等不到帧而超时（实测无头下也如此）。
      // 先 bringToFront，再等一小段让重绘落定。
      await page.bringToFront().catch(() => {});
      await sleep(700);
      await page.screenshot({ path: file, fullPage: false });
      console.log(PREFIX + '截图：' + file);
    }
    console.log(PREFIX + '截图完成，退出');
    await shutdown(0);
    return;
  }

  console.log(PREFIX + '浏览器已打开，可直接交互（点菜单、切暗色、缩窗口都是真实渲染）。');
  if (!attached) console.log(PREFIX + '想让改样式即时生效：另开终端跑 pnpm dev');
  console.log(PREFIX + 'Ctrl+C 结束' + (attached ? '（只断开连接，不关掉 dev 窗口）' : ''));

  await new Promise(() => {});
}

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runCli() {
  try {
    await main();
  } catch (error) {
    console.error(PREFIX + (error instanceof Error ? error.message : String(error)));
    await shutdown(2);
  }
}
