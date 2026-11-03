/**
 * 测量会话：只负责浏览器生命周期与页面驱动，读数交给 probes.mjs。
 *
 *   const session = await createSession({ viewport });
 *   await runActions(session, ['style:fluent', 'mode:dark']);
 *   // ...probe...
 *   await session.dispose();
 *
 * 主题没有自己的面板，测量对象就是宿主 UI 本身；因此插件工程里的「打开面板」
 * 在这里换成「等主题挂载完成」，动作集合换成主题契约（architecture.md §7.2）
 * 里的两轴属性与变体属性，这样任意状态都能用命令行拼出来。
 */
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome, findKernelPort, frontendUrl } from './siyuan.mjs';

const WS_FILE = '.rc-cdp-ws';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `宽x高[@DPR]`，缺省给桌面视口。 */
export function parseViewport(value, fallback = { width: 1600, height: 1000, deviceScaleFactor: 1 }) {
  if (!value) return fallback;
  const match = value.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
  if (!match) throw new Error('viewport 格式应为 宽x高[@DPR]，例如 1280x764@2');
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    deviceScaleFactor: Number(match[3] ?? 1),
  };
}

/** 附加到 dev 会话时窗口尺寸由用户决定，只能实测。 */
function readViewport(page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio || 1,
  }));
}

/**
 * 打开会话。带 `attach` 且存在 `.rc-cdp-ws` 时复用 `pnpm dev` 暴露的浏览器，
 * 否则新开无头 Chrome。
 */
export async function createSession({ viewport, attach = false } = {}) {
  let browser;
  let attached = false;

  if (attach && existsSync(WS_FILE)) {
    browser = await puppeteer.connect({
      browserWSEndpoint: readFileSync(WS_FILE, 'utf8').trim(),
      defaultViewport: null,
    });
    attached = true;
  } else {
    const port = await findKernelPort();
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      defaultViewport: viewport,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    const fresh = await browser.newPage();
    await fresh.goto(frontendUrl(port), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await fresh.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
    await sleep(1500);
  }

  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes('stage/build'));
  if (!page) throw new Error('浏览器里没有思源页面');

  await page.waitForFunction('window.siyuan && window.siyuan.config', { timeout: 30000 });
  // 主题样式在壳子之后异步挂载；不等待会读到尚未生效的令牌值。
  await page
    .waitForFunction("document.getElementById('themeStyle')?.getAttribute('href')", { timeout: 5000 })
    .catch(() => {});
  await sleep(400);

  // 快照 <html> 的原始属性，reset 时据此还原，避免手写的属性残留在后续测量里。
  const initialAttributes = await page.evaluate(() => {
    const attributes = {};
    for (const attribute of document.documentElement.attributes) {
      attributes[attribute.name] = attribute.value;
    }
    return attributes;
  });

  return {
    browser,
    page,
    attached,
    viewport: attached ? await readViewport(page) : viewport,
    initialAttributes,
    async dispose() {
      if (attached) await browser.disconnect();
      else await browser.close();
    },
  };
}

/** 动词到 <html> 属性的映射，取值即主题契约里的两轴与变体。 */
const AXIS_ATTRIBUTES = {
  style: 'data-rc-style',
  palette: 'data-rc-palette',
  mode: 'data-theme-mode',
  density: 'data-ui-density',
};

/**
 * 把页面驱动到某个状态。每个动作是一小段字符串，场景因此能直接写在命令行上：
 *
 *   style:<name> | palette:<name> | mode:<light|dark> | density:<compact|...>
 *   feature:<name>:<on|off> | attr:<name>=<value> | doc:<name>=<value>
 *   click:<selector> | hover:<selector> | move:<x>,<y> | wait:<ms>
 *   css:<stylesheet text> | reset
 */
export async function runActions(session, actions = []) {
  const { page } = session;
  const log = [];

  const setRootAttribute = (name, value) =>
    page.evaluate((attribute, next) => document.documentElement.setAttribute(attribute, next), name, value);

  for (const action of actions) {
    const [verb, ...rest] = action.split(':');
    const argument = rest.join(':');

    switch (verb) {
      case 'style':
      case 'palette':
      case 'mode':
      case 'density':
        if (!argument) throw new Error(verb + ' 需要一个取值，例如 ' + verb + ':dark');
        await setRootAttribute(AXIS_ATTRIBUTES[verb], argument);
        await sleep(300);
        log.push(verb + ' -> ' + argument);
        break;

      case 'feature': {
        const [name, state = 'on'] = argument.split(':');
        if (!name) throw new Error('feature 需要名称，例如 feature:wide-editor:on');
        await setRootAttribute('data-rc-' + name, state);
        await sleep(300);
        log.push('feature ' + name + ' -> ' + state);
        break;
      }

      case 'attr': {
        const index = argument.indexOf('=');
        if (index < 0) throw new Error('attr 需要 名=值，例如 attr:data-frontend=desktop');
        await setRootAttribute(argument.slice(0, index), argument.slice(index + 1));
        await sleep(200);
        log.push('attr -> ' + argument);
        break;
      }

      case 'doc': {
        // 文档级 / 块级属性：主题用 .protyle[custom-rc-*] 和 [custom-rc-*] 表达。
        const index = argument.indexOf('=');
        if (index < 0) throw new Error('doc 需要 名=值，例如 doc:custom-rc-width=wide');
        const name = argument.slice(0, index);
        const value = argument.slice(index + 1);
        const count = await page.evaluate(
          (attribute, next) => {
            const elements = document.querySelectorAll('.protyle');
            for (const element of elements) element.setAttribute(attribute, next);
            return elements.length;
          },
          name,
          value
        );
        if (!count) throw new Error('页面里没有 .protyle，无法设置文档级属性');
        await sleep(300);
        log.push('doc -> ' + argument);
        break;
      }

      case 'click':
        await page.click(argument);
        await sleep(600);
        log.push('click -> ' + argument);
        break;

      case 'hover': {
        // 真实移动指针才能驱动 :hover，CSS 注入做不到。
        const point = await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }, argument);
        if (!point) throw new Error('找不到要悬停的元素：' + argument);
        await page.mouse.move(point.x, point.y);
        await sleep(400);
        log.push('hover -> ' + argument);
        break;
      }

      case 'move': {
        const [x, y] = argument.split(',').map(Number);
        await page.mouse.move(x, y);
        await sleep(300);
        log.push('move -> ' + argument);
        break;
      }

      case 'wait':
        await sleep(Number(argument) || 0);
        log.push('wait -> ' + argument + 'ms');
        break;

      case 'css':
        await page.evaluate((sheet) => {
          document.getElementById('inspect-inject')?.remove();
          const style = document.createElement('style');
          style.id = 'inspect-inject';
          style.textContent = sheet;
          document.head.append(style);
        }, argument);
        await sleep(300);
        log.push('css -> injected');
        break;

      case 'reset':
        await page.evaluate((snapshot) => {
          const root = document.documentElement;
          for (const name of root.getAttributeNames()) {
            if (!(name in snapshot)) root.removeAttribute(name);
          }
          for (const [name, value] of Object.entries(snapshot)) {
            if (root.getAttribute(name) !== value) root.setAttribute(name, value);
          }
        }, session.initialAttributes);
        await sleep(300);
        log.push('reset');
        break;

      default:
        throw new Error(
          '未知动作：' + verb + '（可用：style/palette/mode/density/feature/attr/doc/click/hover/move/wait/css/reset）'
        );
    }
  }

  return log;
}
