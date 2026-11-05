/**
 * 交互驱动：把页面从「初始状态」推到「要审计的状态」，然后就地测量。
 *
 * 只量初始页面测不到 :hover / :focus / :active（需要真实指针）、菜单项（打开前
 * DOM 里没有）、插件面板（激活前不存在）、点击后的展开态——这些恰是主题/插件
 * 容易坏的地方：CSS 选择器还在但 DOM 结构变了，静态断言照样绿。
 *
 * 动作是可组合的小字符串，场景因此能直接写在命令行参数里。每个动作后等一小段，
 * 时长统一来自 timing.ts（按触发原因命名，不是散落的裸数字）。
 *
 * 任何一步失败都抛错：静默跳过一个没找到的选择器，会让后面的断言在错误
 * 状态下运行，得到「通过」的假结论。
 */
import type { Page } from 'puppeteer-core';
import { readPoint } from './page-read.ts';
import { sleep, TIMING } from './timing.ts';

/** 动作动词 → 用法说明；报错时列出来，避免拼错动词静默跳过。 */
export const ACTIONS = {
  click: 'click:<selector>',
  hover: 'hover:<selector>',
  move: 'move:<x>,<y>',
  press: 'press:<selector>',
  focus: 'focus:<selector>',
  type: 'type:<selector>:<text>',
  wait: 'wait:<ms>',
  menu: 'menu:<id>',
  contextmenu: 'contextmenu:<selector>',
  dock: 'dock:<type>',
  attr: 'attr:<name>=<value>',
  reset: 'reset',
} as const;

/** 动作动词。switch 的 default 用 never 校验：加了动词却漏了分支会编译不过。 */
export type ActionVerb = keyof typeof ACTIONS;

/** 执行动作用的会话形状（只需要 page）。 */
export interface ActionSession {
  page: Page;
  /** 会话初始的 <html> 属性快照；不给则现取一次。 */
  rootSnapshot?: Record<string, string>;
}

/** <html> 的属性快照，供 reset 还原。 */
export async function snapshotRoot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const attributes: Record<string, string> = {};
    for (const attribute of document.documentElement.attributes) {
      attributes[attribute.name] = attribute.value;
    }
    return attributes;
  });
}

/** 执行一串动作，返回执行日志（用于报告里说明「测的是哪个状态」）。 */
export async function runActions(session: ActionSession, actions: string[] = []): Promise<string[]> {
  const { page } = session;
  const log: string[] = [];
  const rootSnapshot = session.rootSnapshot ?? (await snapshotRoot(page));

  for (const action of actions) {
    const separator = action.indexOf(':');
    const verb = (separator < 0 ? action : action.slice(0, separator)) as ActionVerb;
    const argument = separator < 0 ? '' : action.slice(separator + 1);

    switch (verb) {
      case 'click':
        await page.click(argument);
        await sleep(TIMING.clickSettle);
        log.push(`click ${argument}`);
        break;

      case 'hover': {
        // 真实移动指针才能驱动 :hover；中心点与可见性判定由 page-read.ts 统一提供。
        const point = await readPoint(page, argument);
        if (!point) throw new Error(`hover 找不到可悬停的元素：${argument}`);
        await page.mouse.move(point.x, point.y);
        await sleep(TIMING.hoverSettle);
        log.push(`hover ${argument}`);
        break;
      }

      case 'move': {
        const [x, y] = argument.split(',').map(Number);
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error('move 需要 坐标:例如 move:100,200');
        }
        await page.mouse.move(x, y);
        await sleep(TIMING.actionSettle);
        log.push(`move ${x},${y}`);
        break;
      }

      case 'press': {
        const point = await readPoint(page, argument);
        if (!point) throw new Error(`press 找不到元素：${argument}`);
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await sleep(TIMING.actionSettle);
        log.push(`press ${argument}`);
        break;
      }

      case 'focus':
        await page.focus(argument);
        await sleep(TIMING.actionSettle);
        log.push(`focus ${argument}`);
        break;

      case 'type': {
        const index = argument.indexOf(':');
        if (index < 0) throw new Error('type 需要 选择器:文本');
        const selector = argument.slice(0, index);
        const text = argument.slice(index + 1);
        await page.click(selector);
        await page.type(selector, text);
        await sleep(TIMING.actionSettle);
        log.push(`type ${selector}`);
        break;
      }

      case 'wait':
        await sleep(Number(argument) || 0);
        log.push(`wait ${argument}ms`);
        break;

      case 'menu': {
        // 思源菜单是异步渲染的；用 Reflect.get 逐层取全局对象，避免类型断言。
        const opened = await page.evaluate((id: string) => {
          const get = (obj: object, key: string): unknown => Reflect.get(obj, key);
          const siyuan = get(globalThis, 'siyuan');
          if (!siyuan || typeof siyuan !== 'object') return false;
          const menus = get(siyuan, 'menus');
          if (!menus || typeof menus !== 'object') return false;
          const menu = get(menus, 'menu');
          if (!menu || typeof menu !== 'object') return false;
          const entry = get(menu, id);
          if (!entry || typeof entry !== 'object') return false;
          const element = get(entry, 'element');
          if (!(element instanceof HTMLElement)) return false;
          element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }, argument);
        if (!opened) throw new Error(`menu 找不到可打开的菜单：${argument}`);
        await sleep(TIMING.menuSettle);
        log.push(`menu ${argument}`);
        break;
      }

      case 'contextmenu': {
        // 真实右键才能弹出思源上下文菜单：JS 派发 contextmenu 不触发。
        const point = await readPoint(page, argument);
        if (!point) throw new Error(`contextmenu 找不到元素：${argument}`);
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y, { button: 'right' });
        await sleep(TIMING.contextMenuSettle);
        log.push(`contextmenu ${argument}`);
        break;
      }

      case 'dock': {
        const clicked = await page.evaluate((type: string) => {
          const button = [...document.querySelectorAll('.dock__item')].find(
            (el) => el.getAttribute('data-type') === type
          );
          if (!button) return false;
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }, argument);
        if (!clicked) throw new Error(`dock 找不到停靠栏按钮：${argument}`);
        await sleep(TIMING.dockSettle);
        log.push(`dock ${argument}`);
        break;
      }

      case 'attr': {
        const index = argument.indexOf('=');
        if (index < 0) throw new Error('attr 需要 名=值，例如 attr:data-theme-mode=dark');
        await page.evaluate(
          (name: string, value: string) => document.documentElement.setAttribute(name, value),
          argument.slice(0, index),
          argument.slice(index + 1)
        );
        await sleep(TIMING.attrSettle);
        log.push(`attr ${argument}`);
        break;
      }

      case 'reset':
        await page.evaluate((snapshot: Record<string, string>) => {
          const root = document.documentElement;
          for (const name of root.getAttributeNames()) {
            if (!(name in snapshot)) root.removeAttribute(name);
          }
          for (const [name, value] of Object.entries(snapshot)) {
            if (root.getAttribute(name) !== value) root.setAttribute(name, value);
          }
        }, rootSnapshot);
        await sleep(TIMING.attrSettle);
        log.push('reset');
        break;

      default: {
        // 编译期穷尽检查：ACTIONS 里新增动词却没在这里加 case 时，verb 不是 never。
        const exhaustive: never = verb;
        throw new Error(`未知动作：${String(exhaustive)}（可用：${Object.keys(ACTIONS).join(' / ')}）`);
      }
    }
  }

  return log;
}
