/**
 * 一次性体检：新开无头浏览器打开思源前端，输出主题加载状态、令牌值、
 * 选择器命中率（hit/miss）并截图。用于思源升级后的回归检查。
 *
 *   pnpm audit
 *   pnpm audit ./dist/theme.css
 */
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.mjs';

const cssPath = process.argv[2] || (existsSync('./dev/theme.css') ? './dev/theme.css' : './dist/theme.css');
if (!existsSync(cssPath)) {
  console.error('[audit] 找不到 theme.css：先运行 pnpm dev 或 pnpm build');
  process.exit(1);
}

const port = await findKernelPort();
console.log('[audit] kernel port: ' + port + ' | css: ' + cssPath);

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  defaultViewport: { width: 1600, height: 1000 },
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const page = await browser.newPage();
  await page.goto(frontendUrl(port), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  const state = await page.evaluate(() => {
    const cfg = window.siyuan.config.appearance;
    const cs = getComputedStyle(document.documentElement);
    const l = document.getElementById('themeStyle');
    return {
      frontend: document.documentElement.getAttribute('data-frontend'),
      mode: document.documentElement.getAttribute('data-theme-mode'),
      theme: cfg.themeLight,
      themeJS: cfg.themeJS,
      href: l && l.getAttribute('href'),
      brand8: cs.getPropertyValue('--rc-brand-8').trim(),
      primary: cs.getPropertyValue('--b3-theme-primary').trim(),
      domNodes: document.querySelectorAll('*').length,
    };
  });

  console.log(
    '[audit] frontend=' + state.frontend + ' mode=' + state.mode + ' theme=' + state.theme + ' themeJS=' + state.themeJS
  );
  console.log('[audit] themeStyle=' + state.href);
  console.log('[audit] --rc-brand-8=' + (state.brand8 || '(空)') + '  --b3-theme-primary=' + state.primary);
  console.log('[audit] domNodes=' + state.domNodes);
  if (!state.href) console.log('[audit] 警告：没有加载自定义主题（可能是内置 daylight/midnight）');
  else if (!state.brand8) console.log('[audit] 警告：主题已加载但 --rc-brand-8 为空（主题目录可能为空）');

  // 从源码解析选择器（CSSOM 跨域受限）
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('@')) continue;
    for (const part of raw.split(',')) {
      const s = part.trim();
      if (s) selectors.push(s);
    }
  }
  const unique = [...new Set(selectors)];
  const counts = await page.evaluate(
    (sels) =>
      sels.map((s) => {
        let n = 0;
        try {
          n = document.querySelectorAll(s).length;
        } catch {
          n = -1;
        }
        return [s, n];
      }),
    unique
  );

  const hit = counts.filter(([, n]) => n > 0);
  const miss = counts.filter(([, n]) => n === 0);
  const invalid = counts.filter(([, n]) => n < 0);
  console.log(
    '[audit] selectors=' +
      counts.length +
      ' hit=' +
      hit.length +
      ' miss=' +
      miss.length +
      (invalid.length ? ' invalid=' + invalid.length : '')
  );
  for (const [s, n] of hit) console.log('  hit ' + n + 'x ' + s);
  if (miss.length) {
    console.log('[audit] 未命中（不一定是失效，取决于 UI 状态）:');
    for (const [s] of miss) console.log('  miss   ' + s);
  }

  await page.screenshot({ path: './audit-browser.png' });
  console.log('[audit] screenshot: ./audit-browser.png');
} finally {
  await browser.close();
}
