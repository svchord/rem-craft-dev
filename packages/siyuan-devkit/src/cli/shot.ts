/**
 * 截图入口：无头截取桌面端 / 移动端页面，供 agent 做视觉复核。
 *
 * 测量命令回答「计算值是多少」，截图回答「看起来对不对」——间距、层级、
 * 暗色对比、移动端挤压这类问题，读图比读数字直观。命令始终无头运行，
 * 不打开可见窗口，适合 agent 与 CI 调用。
 *
 *   syt shot                              # 桌面端 + 移动端各截一张到 ./shots/
 *   syt shot --frontend mobile            # 只截移动端
 *   syt shot --state dark                 # 截暗色状态
 *   syt shot --out .tmp/shots             # 指定输出目录
 *
 * 退出码：成功 0，参数/运行错误 2。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { wantsHelp } from './cli-args.ts';
import { findChrome, findKernelPort, frontendLinks, frontendUrl, MOBILE_VIEWPORT } from '../core/siyuan.ts';
import type { Frontend } from '../core/siyuan.ts';
import { readThemeName } from '../core/theme.ts';
import { box, info, linkRow, list, section, status, table, warn } from './ui.ts';

const DEFAULT_OUT = './shots';

const KNOWN_FRONTENDS: readonly Frontend[] = ['desktop', 'mobile'];

/** 给人看的端名。 */
const FRONTEND_LABELS: Record<Frontend, string> = {
  desktop: '桌面端',
  mobile: '移动端',
};

const usage = (): void => {
  box('syt shot', ['无头截取桌面端/移动端页面，供 agent 做视觉复核。', '用法：syt shot [选项]']);

  section('选项');
  table(
    ['选项', '说明'],
    [
      ['--frontend <端>', 'desktop | mobile，只截一个（缺省两个都截）'],
      ['--state <状态>', 'dark | light | compact，截图前切到某状态'],
      ['--out <目录>', `输出目录，缺省 ${DEFAULT_OUT}`],
      ['--help, -h', '显示本帮助'],
    ]
  );

  section('示例');
  list([
    ['syt shot', '桌面端 + 移动端各截一张'],
    ['syt shot --state dark', '截暗色状态'],
    ['syt shot --frontend mobile --out .tmp/shots', '只截移动端到指定目录'],
  ]);
};

/** 解析参数。惰性执行——模块顶层解析会在被 import 时拿错 argv。 */
function parseArgv(argv: string[]): { wanted: Frontend[]; state: string | null; outDir: string } {
  const frontendIndex = argv.indexOf('--frontend');
  const stateIndex = argv.indexOf('--state');
  const outIndex = argv.indexOf('--out');
  const requested = frontendIndex >= 0 ? argv[frontendIndex + 1] : undefined;
  const wanted = requested ? KNOWN_FRONTENDS.filter((frontend) => frontend === requested) : [...KNOWN_FRONTENDS];
  if (requested && !wanted.length) {
    throw new Error(`未知前端：${requested}（可用：desktop / mobile）`);
  }
  return {
    wanted,
    state: stateIndex >= 0 ? (argv[stateIndex + 1] ?? null) : null,
    outDir: outIndex >= 0 ? (argv[outIndex + 1] ?? DEFAULT_OUT) : DEFAULT_OUT,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 把 <html> 推到目标状态（暗色/密度）。 */
async function applyState(page: Page, value: string | null): Promise<void> {
  if (!value) return;
  const mapping: Record<string, [string, string]> = {
    dark: ['data-theme-mode', 'dark'],
    light: ['data-theme-mode', 'light'],
    compact: ['data-ui-density', 'compact'],
  };
  const entry = mapping[value];
  if (!entry) {
    warn(`未知状态 ${value}（可用：${Object.keys(mapping).join(' / ')}）`);
    return;
  }
  await page.evaluate(
    (name: string, state: string) => document.documentElement.setAttribute(name, state),
    entry[0],
    entry[1]
  );
  await sleep(400);
}

/**
 * 打开一个前端页面并等到主题挂载，然后截图。
 *
 * 无头模式下仍要 `bringToFront`：Chrome 对后台标签页会节流渲染，
 * captureScreenshot 会一直等不到帧而超时（实测如此）。
 */
async function captureFrontend(
  browser: Browser,
  port: number,
  frontend: Frontend,
  outDir: string,
  themeState: string | null
): Promise<void> {
  const page = await browser.newPage();
  await page.setViewport(frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { width: 1600, height: 1000 });
  await page.goto(frontendUrl(port, frontend), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.siyuan && window.siyuan.config' as never, { timeout: 30000 });
  // 主题异步挂载，等它出现再截图，否则拍到的是宿主样式。
  await page
    .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')" as never, { timeout: 8000 })
    .catch(() => {});
  await sleep(800);
  await applyState(page, themeState);

  const info = await page.evaluate(() => ({
    themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
    frontend: document.documentElement.getAttribute('data-frontend'),
    backend: document.documentElement.getAttribute('data-backend'),
    themeMode: document.documentElement.getAttribute('data-theme-mode'),
  }));
  const detail =
    `${info.themeStyle ? '已挂主题' : '未挂主题'} frontend=${info.frontend ?? '?'} ` +
    `backend=${info.backend ?? '?'} mode=${info.themeMode ?? '?'}`;
  status(info.themeStyle ? 'success' : 'warn', FRONTEND_LABELS[frontend], detail);
  if (!info.themeStyle) {
    warn(`提示：${FRONTEND_LABELS[frontend]}没挂上主题，检查 theme.json 的 frontends 是否含 all`);
  }

  await page.bringToFront().catch(() => {});
  await sleep(700);
  const file = resolve(outDir, `${frontend}.png`);
  await page.screenshot({ path: file, fullPage: false });
  status('success', '截图', file);
  await page.close();
}

/** 供 bin/ 与统一 CLI 调用；不在模块顶层自动执行，便于被 import。 */
export async function runShotCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (wantsHelp(argv)) {
    usage();
    return;
  }

  const { wanted, state: themeState, outDir } = parseArgv(argv);
  let browser: Browser | null = null;
  let profile: string | null = null;

  try {
    profile = mkdtempSync(join(tmpdir(), 'syt-shot-'));
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      defaultViewport: null,
      // 截图偶尔要等渲染稳定，默认 180s 太长；给一个明确上限，卡住就报错。
      protocolTimeout: 60000,
      args: ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`],
    });

    const port = await findKernelPort();
    status('info', '主题', `${readThemeName() ?? '(未知)'}  kernel=${port}${themeState ? ` 状态=${themeState}` : ''}`);

    mkdirSync(outDir, { recursive: true });
    const links = new Map(frontendLinks(port).map((entry) => [entry.frontend, entry.url]));
    for (const frontend of wanted) {
      linkRow(FRONTEND_LABELS[frontend], links.get(frontend) ?? frontendUrl(port, frontend, { cacheBust: false }));
      await captureFrontend(browser, port, frontend, outDir, themeState);
    }
    info(`截图完成：${resolve(outDir)}`);
  } finally {
    try {
      await browser?.close();
    } catch {
      // 已经没了
    }
    try {
      if (profile) rmSync(profile, { recursive: true, force: true });
    } catch {
      // 已经没了
    }
  }
}
