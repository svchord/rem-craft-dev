/**
 * 读取真实 DOM 的渲染样式与命中规则。需要先跑 pnpm dev（会话在 9444）。
 *
 *   pnpm inspect .protyle-wysiwyg
 *   pnpm inspect .protyle-wysiwyg --shot
 */
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const target = args[0] || null;
const SHOT = process.argv.includes('--shot');
if (!existsSync('.rc-cdp-ws')) {
  console.error('[inspect] 没有发现运行中的 dev 会话，先运行 pnpm dev');
  process.exit(1);
}
const wsEndpoint = readFileSync('.rc-cdp-ws', 'utf8').trim();
let browser;
try {
  browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
} catch {
  console.error('[inspect] 连接会话失败，可能 pnpm dev 已退出；请重新运行 pnpm dev');
  process.exit(1);
}

const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('stage/build'));
if (!page) {
  console.error('[inspect] 会话里没有思源页面');
  process.exit(1);
}

const PROPS = [
  'color',
  'background-color',
  'font-size',
  'padding-top',
  'padding-left',
  'margin-top',
  'border-radius',
  'max-width',
  'display',
  'gap',
];
const SELECTORS = target ? [target] : ['.protyle-wysiwyg', '.protyle-title', '.layout-tab-bar', '.dock__item'];

const head = await page.evaluate(() => {
  const c = window.siyuan && window.siyuan.config ? window.siyuan.config.appearance : null;
  const l = document.getElementById('themeStyle');
  return { theme: c && c.themeLight, hmr: !!window.__RC_DEV_HMR__, href: l && l.getAttribute('href') };
});
console.log('[inspect] theme=' + head.theme + ' hmr=' + head.hmr);
console.log('[inspect] href=' + head.href);

const client = await page.createCDPSession();
await client.send('DOM.enable');
await client.send('CSS.enable');
const sheets = new Map();
client.on('CSS.styleSheetAdded', (e) => {
  if (e.header) sheets.set(e.header.styleSheetId, e.header.sourceURL || '');
});
await new Promise((r) => setTimeout(r, 400));
const doc = await client.send('DOM.getDocument', { depth: 1 });

for (const sel of SELECTORS) {
  const data = await page.evaluate(
    (selector, props) => {
      const els = Array.from(document.querySelectorAll(selector));
      return {
        count: els.length,
        items: els.slice(0, 2).map((el) => {
          const cs = getComputedStyle(el);
          const out = {};
          for (const p of props) out[p] = cs.getPropertyValue(p);
          return { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 70), props: out };
        }),
      };
    },
    sel,
    PROPS
  );

  console.log('\n=== ' + sel + ' (匹配 ' + data.count + ') ===');
  if (!data.count) {
    console.log('  (未命中)');
    continue;
  }
  for (const it of data.items) {
    console.log('  <' + it.tag + ' class="' + it.cls + '">');
    for (const [k, v] of Object.entries(it.props)) {
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') console.log('      ' + k + ': ' + v);
    }
  }

  const q = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
  if (!q.nodeId) continue;
  const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId: q.nodeId });
  const themed = [];
  for (const m of matched.matchedCSSRules || []) {
    const url = sheets.get(m.rule.styleSheetId) || '';
    let source = m.rule.origin === 'user-agent' ? '(UA)' : '(inline <style>)';
    if (url) {
      const i = url.indexOf('/appearance/themes/');
      source = i >= 0 ? url.slice(i + '/appearance/themes/'.length) : url.slice(-48);
    }
    if (source === '(UA)') continue;
    const props = (m.rule.style.cssProperties || []).filter((p) => p.value !== '').map((p) => p.name + ': ' + p.value);
    themed.push('[' + source + '] ' + m.rule.selectorList.text + ' { ' + props.slice(0, 5).join('; ') + ' }');
  }
  console.log('  -- 命中规则（主题/站点样式 ' + themed.length + ' 条）--');
  for (const t of themed.slice(0, 10)) console.log('    ' + t);
}

if (SHOT) {
  await page.screenshot({ path: './inspect.png' });
  console.log('\n[inspect] screenshot: ./inspect.png');
}
await browser.disconnect();
