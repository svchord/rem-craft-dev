import { existsSync, readFileSync } from 'node:fs';
import { findKernelPort, frontendUrl, openBrowser } from './browser.mjs';

const manifest = JSON.parse(readFileSync('./public/theme.json', 'utf8'));

// 优先 dev/（watch 产物），其次 dist/（生产构建产物）
const cssPath = process.argv[2] || (existsSync('./dev/theme.css') ? './dev/theme.css' : './dist/theme.css');
if (!existsSync(cssPath)) {
  console.error('[audit] 找不到 theme.css：先运行 pnpm dev（推荐）或 pnpm build');
  process.exit(1);
}

const port = await findKernelPort();
console.log('[audit] kernel port: ' + port + ' | css: ' + cssPath);

const browser = await openBrowser({ url: frontendUrl(port) });
try {
  const state = await browser.evaluate(`(() => {
    const cfg = window.siyuan.config.appearance;
    const cs = getComputedStyle(document.documentElement);
    const link = document.getElementById('themeStyle');
    return {
      frontend: document.documentElement.getAttribute('data-frontend'),
      themeMode: document.documentElement.getAttribute('data-theme-mode'),
      themeLight: cfg.themeLight,
      themeJS: cfg.themeJS,
      themeVer: cfg.themeVer,
      themeStyleHref: link ? link.getAttribute('href') : null,
      brand8: cs.getPropertyValue('--rc-brand-8').trim(),
      b3Primary: cs.getPropertyValue('--b3-theme-primary').trim(),
      domNodes: document.querySelectorAll('*').length,
    };
  })()`);

  console.log(
    '[audit] frontend=' +
      state.frontend +
      ' mode=' +
      state.themeMode +
      ' theme=' +
      state.themeLight +
      ' themeJS=' +
      state.themeJS
  );
  console.log('[audit] themeStyle=' + state.themeStyleHref);
  console.log('[audit] --rc-brand-8=' + (state.brand8 || '(空)') + '  --b3-theme-primary=' + state.b3Primary);
  console.log('[audit] domNodes=' + state.domNodes);

  if (!state.themeStyleHref) {
    console.log('[audit] 警告：当前没有加载自定义主题（可能选的是内置 daylight/midnight）');
  } else if (!state.brand8) {
    console.log('[audit] 警告：主题已加载但 --rc-brand-8 为空——主题目录内容可能为空（pnpm build 会清空 dev/）');
  }

  // CSSOM 对非 CORS 样式表受限，直接从源码解析选择器（CSS 由我们自己构建）
  const css = readFileSync(cssPath, 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  for (const match of stripped.matchAll(/([^{}]+)\{/g)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('@')) continue;
    for (const part of raw.split(',')) {
      const sel = part.trim();
      if (sel) selectors.push(sel);
    }
  }

  const unique = [...new Set(selectors)];
  const probe = await browser.evaluate(
    '(() => { const sels = ' +
      JSON.stringify(unique) +
      '; return sels.map((sel) => { let n = 0; try { n = document.querySelectorAll(sel).length; } catch (e) { n = -1; } return [sel, n]; }); })()'
  );

  const hit = probe.filter(([, n]) => n > 0);
  const miss = probe.filter(([, n]) => n === 0);
  const invalid = probe.filter(([, n]) => n < 0);

  console.log(
    '[audit] selectors=' +
      probe.length +
      ' hit=' +
      hit.length +
      ' miss=' +
      miss.length +
      (invalid.length ? ' invalid=' + invalid.length : '')
  );
  for (const [sel, n] of hit) console.log('  hit ' + n + 'x ' + sel);
  if (miss.length) {
    console.log('[audit] 未命中（不一定是失效，取决于 UI 状态）:');
    for (const [sel] of miss) console.log('  miss   ' + sel);
  }
  if (invalid.length) {
    console.log('[audit] 无效选择器:');
    for (const [sel] of invalid) console.log('  invalid ' + sel);
  }

  const shot = await browser.screenshot('./audit-browser.png');
  console.log('[audit] screenshot: ' + shot);
} finally {
  browser.close();
}
