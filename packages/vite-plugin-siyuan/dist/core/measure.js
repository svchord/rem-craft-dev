import { probeTokens } from './probes.js';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 页面元素计算样式：任意选择器 × 任意属性。 */
export async function elementStyles(page, selector, props) {
    return page.evaluate((sel, propertyList) => {
        // 不能用 offsetParent：position:fixed 的元素 offsetParent 恒为 null，
        // 思源的菜单就是这种（实测 .b3-menu offsetParent=null，但 236×649 完全可见）。
        const visible = (el) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width && !rect.height)
                return false;
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
        };
        const elements = [...document.querySelectorAll(sel)];
        const shown = elements.filter(visible);
        const target = shown[0] ?? elements[0];
        if (!target)
            return { found: false, count: 0, visible: 0, styles: {} };
        const style = getComputedStyle(target);
        const styles = {};
        for (const prop of propertyList)
            styles[prop] = style.getPropertyValue(prop);
        return {
            found: true,
            count: elements.length,
            visible: shown.length,
            tag: target.tagName.toLowerCase(),
            className: String(target.className || '').slice(0, 120),
            styles,
        };
    }, selector, props);
}
/** 选择器命中数（含可见数）。 */
export async function selectorCounts(page, selectors) {
    return page.evaluate((list) => {
        const visible = (el) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width && !rect.height)
                return false;
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
        };
        return Object.fromEntries(list.map((sel) => {
            try {
                const elements = [...document.querySelectorAll(sel)];
                return [sel, { total: elements.length, visible: elements.filter(visible).length }];
            }
            catch {
                return [sel, { total: -1, visible: -1, error: '非法选择器' }];
            }
        }));
    }, selectors);
}
/** 一组令牌的计算值。 */
export async function tokens(page, names) {
    return probeTokens(page, names);
}
/**
 * 在页面上插一段 HTML 再量——用于量页面上不存在的组件。
 *
 * 与直接量真实元素的区别：探针元素只带你给的类名，能验证「这个选择器本身
 * 算出来是什么」，不受当前 UI 状态影响。
 */
export async function probeHtml(page, { html, target, props }) {
    return page.evaluate((markup, selector, propertyList) => {
        const host = document.createElement('div');
        host.setAttribute('style', 'position:fixed;left:-99999px;top:0;width:1200px;');
        host.innerHTML = markup;
        document.body.appendChild(host);
        try {
            const element = host.querySelector(selector);
            if (!element)
                return { found: false, styles: {} };
            const style = getComputedStyle(element);
            const styles = {};
            for (const prop of propertyList)
                styles[prop] = style.getPropertyValue(prop);
            return { found: true, styles };
        }
        finally {
            host.remove();
        }
    }, html, target, props);
}
/**
 * 元素盒模型尺寸（触摸目标、间距判断用）。
 * 只给宽高与位置，不给「够不够大」的判断。
 */
export async function elementBox(page, selector, limit = 5) {
    return page.evaluate((sel, max) => {
        const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
        const elements = [...document.querySelectorAll(sel)].filter(visible).slice(0, max);
        return elements.map((el, index) => {
            const box = el.getBoundingClientRect();
            return {
                index,
                tag: el.tagName.toLowerCase(),
                className: String(el.className || '').slice(0, 80),
                x: Math.round(box.x * 10) / 10,
                y: Math.round(box.y * 10) / 10,
                width: Math.round(box.width * 10) / 10,
                height: Math.round(box.height * 10) / 10,
            };
        });
    }, selector, limit);
}
/**
 * 同一元素在「动作前 / 动作后」的样式对比。
 *
 * 只返回差异，不判断「该不该变」——变不变是否符合预期由调用方决定。
 */
export async function diffAfter(page, { selector, props, run }) {
    const read = () => page.evaluate((sel, propertyList) => {
        const el = document.querySelector(sel);
        if (!el)
            return null;
        const style = getComputedStyle(el);
        return Object.fromEntries(propertyList.map((prop) => [prop, style.getPropertyValue(prop)]));
    }, selector, props);
    // 先移开指针：位置在会话间持续，否则 before 可能已经是 hover 态。
    await page.mouse.move(1, 1);
    await sleep(250);
    const before = await read();
    if (!before)
        return { found: false, before: null, after: null, changed: {} };
    await run(page);
    await sleep(350);
    const after = await read();
    if (!after)
        return { found: false, before, after: null, changed: {} };
    const changed = {};
    for (const prop of Object.keys(after)) {
        const from = before[prop] ?? '';
        const to = after[prop];
        if (to !== undefined && from !== to)
            changed[prop] = { from, to };
    }
    return { found: true, before, after, changed };
}
/** 页面环境快照。 */
export async function environment(page) {
    return page.evaluate(() => {
        const root = document.documentElement;
        return {
            frontend: root.getAttribute('data-frontend'),
            backend: root.getAttribute('data-backend'),
            themeMode: root.getAttribute('data-theme-mode'),
            density: root.getAttribute('data-ui-density'),
            themeStyle: document.getElementById('themeStyle')?.getAttribute('href') ?? null,
            url: location.href,
            domNodes: document.querySelectorAll('*').length,
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        };
    });
}
//# sourceMappingURL=measure.js.map