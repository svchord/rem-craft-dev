const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 动作动词 → 说明，报错时列出来，避免拼错动词静默跳过。 */
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
};
/** <html> 的属性快照，供 reset 还原。 */
export async function snapshotRoot(page) {
    return page.evaluate(() => {
        const attributes = {};
        for (const attribute of document.documentElement.attributes) {
            attributes[attribute.name] = attribute.value;
        }
        return attributes;
    });
}
/**
 * 执行一串动作。返回执行日志（用于报告里说明「测的是哪个状态」）。
 *
 * 任何一步失败都抛错：静默跳过一个没找到的选择器，会让后面的断言在错误
 * 状态下运行，得到「通过」的假结论。
 */
export async function runActions(session, actions = []) {
    const { page } = session;
    const log = [];
    const rootSnapshot = session.rootSnapshot ?? (await snapshotRoot(page));
    for (const action of actions) {
        const separator = action.indexOf(':');
        const verb = (separator < 0 ? action : action.slice(0, separator));
        const argument = separator < 0 ? '' : action.slice(separator + 1);
        switch (verb) {
            case 'click':
                await page.click(argument);
                await sleep(500);
                log.push(`click ${argument}`);
                break;
            case 'hover': {
                // 真实移动指针才能驱动 :hover，CSS 注入或 JS 派发都做不到。
                const point = await page.evaluate((selector) => {
                    const element = document.querySelector(selector);
                    if (!element)
                        return null;
                    const box = element.getBoundingClientRect();
                    // 不用 offsetParent 判可见：position:fixed 的元素 offsetParent 恒为 null，
                    // 思源菜单就是这种（实测可见，offsetParent=null）。
                    if (!box.width && !box.height)
                        return null;
                    const cs = getComputedStyle(element);
                    if (cs.display === 'none' || cs.visibility === 'hidden')
                        return null;
                    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                }, argument);
                if (!point)
                    throw new Error(`hover 找不到可悬停的元素：${argument}`);
                await page.mouse.move(point.x, point.y);
                await sleep(350);
                log.push(`hover ${argument}`);
                break;
            }
            case 'move': {
                const [x, y] = argument.split(',').map(Number);
                if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
                    throw new Error('move 需要 坐标:例如 move:100,200');
                }
                await page.mouse.move(x, y);
                await sleep(250);
                log.push(`move ${x},${y}`);
                break;
            }
            case 'press': {
                const box = await page.evaluate((selector) => {
                    const element = document.querySelector(selector);
                    if (!element)
                        return null;
                    const rect = element.getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                }, argument);
                if (!box)
                    throw new Error(`press 找不到元素：${argument}`);
                await page.mouse.move(box.x, box.y);
                await page.mouse.down();
                await sleep(250);
                log.push(`press ${argument}`);
                break;
            }
            case 'focus':
                await page.focus(argument);
                await sleep(250);
                log.push(`focus ${argument}`);
                break;
            case 'type': {
                const index = argument.indexOf(':');
                if (index < 0)
                    throw new Error('type 需要 选择器:文本');
                const selector = argument.slice(0, index);
                const text = argument.slice(index + 1);
                await page.click(selector);
                await page.type(selector, text);
                await sleep(250);
                log.push(`type ${selector}`);
                break;
            }
            case 'wait':
                await sleep(Number(argument) || 0);
                log.push(`wait ${argument}ms`);
                break;
            case 'menu': {
                // 思源菜单是异步渲染的，打开后要等 DOM 出现。
                const opened = await page.evaluate((id) => {
                    const menu = globalThis.siyuan?.menus?.menu?.[id];
                    const element = menu?.element;
                    if (!element)
                        return false;
                    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    return true;
                }, argument);
                if (!opened)
                    throw new Error(`menu 找不到可打开的菜单：${argument}`);
                await sleep(600);
                log.push(`menu ${argument}`);
                break;
            }
            case 'contextmenu': {
                // 真实右键才能弹出思源的上下文菜单：JS 派发 contextmenu 事件不触发
                // （实测派发后 .b3-menu__item 仍是 0 个，真实鼠标右键才有 14 个）。
                const point = await page.evaluate((selector) => {
                    const element = document.querySelector(selector);
                    if (!element)
                        return null;
                    const box = element.getBoundingClientRect();
                    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                }, argument);
                if (!point)
                    throw new Error(`contextmenu 找不到元素：${argument}`);
                await page.mouse.move(point.x, point.y);
                await page.mouse.click(point.x, point.y, { button: 'right' });
                await sleep(900);
                log.push(`contextmenu ${argument}`);
                break;
            }
            case 'dock': {
                const clicked = await page.evaluate((type) => {
                    const button = [...document.querySelectorAll('.dock__item')].find((el) => el.getAttribute('data-type') === type);
                    if (!button)
                        return false;
                    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    return true;
                }, argument);
                if (!clicked)
                    throw new Error(`dock 找不到停靠栏按钮：${argument}`);
                await sleep(800);
                log.push(`dock ${argument}`);
                break;
            }
            case 'attr': {
                const index = argument.indexOf('=');
                if (index < 0)
                    throw new Error('attr 需要 名=值，例如 attr:data-theme-mode=dark');
                await page.evaluate((name, value) => document.documentElement.setAttribute(name, value), argument.slice(0, index), argument.slice(index + 1));
                await sleep(300);
                log.push(`attr ${argument}`);
                break;
            }
            case 'reset':
                await page.evaluate((snapshot) => {
                    const root = document.documentElement;
                    for (const name of root.getAttributeNames()) {
                        if (!(name in snapshot))
                            root.removeAttribute(name);
                    }
                    for (const [name, value] of Object.entries(snapshot)) {
                        if (root.getAttribute(name) !== value)
                            root.setAttribute(name, value);
                    }
                }, rootSnapshot);
                await sleep(300);
                log.push('reset');
                break;
            default:
                throw new Error(`未知动作：${String(verb)}（可用：${Object.keys(ACTIONS).join(' / ')}）`);
        }
    }
    return log;
}
//# sourceMappingURL=actions.js.map