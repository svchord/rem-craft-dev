/**
 * 一条命令开发：改 src/styles/** → 自动重建 → 自动热更新页面。
 *
 *   pnpm dev              可见浏览器
 *   pnpm dev --headless   无头
 *
 * 核心思路：**让思源自己加载本主题**，而不是在页面上打补丁。
 *
 *   1. 构建产物进 dev/，`pnpm make-link` 已把它 junction 到 <workspace>/data/themes/<name>
 *   2. 通过 kernel API 把 themeLight/themeDark 切成该主题（已经是它时不做任何事）
 *   3. 重建后换掉 #themeStyle 的 href，由思源重新加载 theme.css
 *
 * 第 2、3 步是任何思源主题项目都需要的通用能力，来自 siyuan-devtools 的
 * theme-dev.mjs（selectTheme / reloadThemeCss）。本文件只保留本仓特有的部分：
 * 用 Vite 构建到 dev/、产物叫 theme.css。
 *
 * 为什么不注入 <style>、也不禁用宿主主题：
 *   注入只能模拟「本主题叠在宿主主题之上」这一种情形，而真实级联里本主题是
 *   **替代**宿主主题。两者在 --b3-* 上结果不同：注入时宿主的 --b3-* 仍然存在且
 *   往往胜出，真实挂载时宿主主题根本不参与。实测过这个差异——注入方式下
 *   --b3-theme-background 读到的是宿主的 #feffff，切主题后才是本主题的值。
 *   让思源自己加载，预览、测量、生产就是同一套级联。
 *
 * 为什么刷新后不需要额外处理：
 *   主题状态在思源配置里，F5 之后思源自己会重新加载它，不依赖任何注入的存活。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChrome, findKernelPort, frontendUrl, readThemeName, reloadThemeCss, selectTheme } from 'siyuan-devtools';

const BUILD_DIR = './dev';
const CSS_FILE = join(BUILD_DIR, 'theme.css');
const DEBOUNCE_MS = 150;
const headless = process.argv.includes('--headless');

let browser = null;
let buildProc = null;
let profile = null;
let closing = false;
let page = null;
let kernelPort = null;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    buildProc?.kill();
  } catch {}
  try {
    if (browser) await browser.close();
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1) 构建：vite build --watch
// 必须带 --watch：否则 vite.config.ts 的 isWatch 为 false，会走 zipPack 分支重写 package.zip。
const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
buildProc = spawn(process.execPath, [viteBin, 'build', '--watch', '--outDir', BUILD_DIR, '--emptyOutDir', 'false'], {
  stdio: 'inherit',
});
buildProc.on('exit', (code) => {
  if (!closing) {
    console.error('[dev] 构建进程退出：' + code);
    shutdown(1);
  }
});

const deadline = Date.now() + 30000;
while (!existsSync(CSS_FILE) && Date.now() < deadline) await sleep(200);
if (!existsSync(CSS_FILE)) {
  console.error('[dev] 构建超时：' + CSS_FILE + ' 未生成');
  await shutdown(1);
}
console.log('[dev] 构建就绪：' + CSS_FILE);

// 2) 让思源选中本主题（通用能力来自 siyuan-devtools）
kernelPort = await findKernelPort();
const themeName = readThemeName();
const selected = await selectTheme(kernelPort, themeName);
if (!selected.ok) {
  console.error('[dev] ' + selected.reason);
  console.error('[dev] 提示：先运行 pnpm make-link，把 dev/ 链接到 <workspace>/data/themes/' + themeName);
} else if (selected.changed) {
  console.log('[dev] 已切换到主题：' + themeName);
} else {
  console.log('[dev] 思源已选中：' + themeName);
}

// 3) 浏览器
const target = frontendUrl(kernelPort);
profile = mkdtempSync(join(tmpdir(), 'rc-dev-'));
browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless,
  defaultViewport: null,
  args: ['--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile],
});
writeFileSync('.rc-cdp-ws', browser.wsEndpoint());
console.log('[dev] browser launched');

const pages = await browser.pages();
page = pages.length ? pages[0] : await browser.newPage();
await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
console.log('[dev] opened: ' + target);

// 首屏确认主题确实挂上了；没挂上说明 make-link 或主题名不对，直接说清楚。
const mounted = await page.evaluate(() => document.getElementById('themeStyle')?.getAttribute('href') || null);
console.log('[dev] themeStyle: ' + (mounted ?? '(无)'));

// 4) 监听产物，重建后让思源重载主题（reloadThemeCss 来自 siyuan-devtools）
let timer = null;
watch(BUILD_DIR, { recursive: true }, (_event, filename) => {
  if (!filename || !String(filename).endsWith('theme.css')) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const reloaded = await reloadThemeCss(page);
    console.log(
      '[dev] css updated: ' +
        readFileSync(CSS_FILE, 'utf8').length +
        ' chars' +
        (reloaded ? '' : '（重载失败，页面可能正在导航）')
    );
  }, DEBOUNCE_MS);
});

console.log('[dev] kernel: http://127.0.0.1:' + kernelPort);
console.log('[dev] 改 src/styles/** 自动重建 + 思源重载主题（F5 后仍是本主题）');
console.log('[dev] 另开终端：pnpm watch:theme   # 改完自动比对真实渲染');
console.log('[dev] Ctrl+C 结束');

await new Promise(() => {});
