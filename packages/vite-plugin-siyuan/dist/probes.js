/**
 * 读取令牌的计算值。
 *
 * 计算样式里的自定义属性**已经展开 var() 链**，未定义的令牌返回空串，
 * 因此一个 getPropertyValue 就够：既能判断「定义了没有」，也能看到最终值。
 * 注意 L0 刻度存的是 "R G B" 三通道（`0 82 217`），不是颜色值，
 * 直接当 color 用会失效——所以这里只取原文，不做任何颜色求值。
 */
export async function probeTokens(page, names) {
    return page.evaluate((tokenNames) => {
        const root = getComputedStyle(document.documentElement);
        const values = {};
        for (const name of tokenNames) {
            values[name] = root.getPropertyValue(name).trim();
        }
        return values;
    }, names);
}
/**
 * 在真实页面上量一组读数。
 *
 * 探针元素插进主文档、放到视口外（`left:-99999px`），因此：
 *   - 拿到完整级联（base.css + 主题 + 插件 + 运行时样式），与生产一致
 *   - 不影响页面外观
 *   - 测完立即移除
 *
 * `requireVisible` 默认 false：探针本身在视口外，按可见性过滤会全部被排除。
 * 只有量页面上既有元素（live 用例）时才开 true——菜单关闭时元素仍在 DOM 但不可见，
 * 读到的是继承值，会让断言假通过。
 */
export async function probeLive(page, spec) {
    return page.evaluate((payload) => {
        // 注意：这个函数在浏览器里执行，不能引用 Node 侧的模块作用域变量，
        // 所以 isVisible 必须定义在函数内部。
        const visible = (element) => element.offsetParent !== null || element.getClientRects().length > 0;
        const tokens = {};
        const rootStyle = getComputedStyle(document.documentElement);
        for (const name of payload.tokens) {
            tokens[name] = rootStyle.getPropertyValue(name).trim();
        }
        // 选择器命中数：在真实页面里数（可含探针容器，由调用方决定要不要插）
        const counts = {};
        for (const selector of payload.selectors) {
            try {
                const elements = [...document.querySelectorAll(selector)];
                counts[selector] = payload.requireVisible ? elements.filter(visible).length : elements.length;
            }
            catch {
                counts[selector] = -1;
            }
        }
        // 探针：每个用例独立插一段标记到主文档，量完移除。
        // 主文档里的探针能吃到 base.css 与运行时样式，这是 iframe 做不到的。
        const probes = [];
        for (const probe of payload.probes) {
            if (!probe.html) {
                // 没有 html 表示量页面上既有的真实元素（交互后的状态）。
                let elements;
                try {
                    elements = [...document.querySelectorAll(probe.target)];
                }
                catch {
                    probes.push({ label: probe.label, found: false, styles: {}, reason: '非法选择器' });
                    continue;
                }
                const shown = elements.filter(visible);
                const first = shown[0];
                if (!first) {
                    probes.push({ label: probe.label, found: false, styles: {}, reason: '页面上没有可见的匹配元素' });
                    continue;
                }
                const style = getComputedStyle(first);
                const styles = {};
                for (const property of probe.props)
                    styles[property] = style.getPropertyValue(property);
                probes.push({ label: probe.label, found: true, styles, count: shown.length });
                continue;
            }
            const host = document.createElement('div');
            host.setAttribute('style', 'position:fixed;left:-99999px;top:0;width:1200px;');
            host.innerHTML = probe.html;
            document.body.appendChild(host);
            try {
                const element = host.querySelector(probe.target);
                if (!element) {
                    probes.push({ label: probe.label, found: false, styles: {}, reason: '探针 html 里没有匹配元素' });
                    continue;
                }
                const style = getComputedStyle(element);
                const styles = {};
                for (const property of probe.props)
                    styles[property] = style.getPropertyValue(property);
                probes.push({ label: probe.label, found: true, styles });
            }
            finally {
                host.remove();
            }
        }
        return { tokens, hits: counts, probes };
    }, spec);
}
/**
 * 页面环境快照：确认打开的是桌面还是移动端、被测对象挂没挂上。
 *
 * 移动端和桌面端是两个独立构建入口，量错地方结论就没有意义。
 */
export async function probeEnvironment(page, session) {
    const head = await page.evaluate(() => {
        const root = document.documentElement;
        return {
            frontend: root.getAttribute('data-frontend'),
            backend: root.getAttribute('data-backend'),
            themeMode: root.getAttribute('data-theme-mode'),
            density: root.getAttribute('data-ui-density'),
            themeStyle: document.getElementById('themeStyle')?.getAttribute('href') || null,
            domNodes: document.querySelectorAll('*').length,
        };
    });
    return { ...head, opened: session.attached ? 'attached' : 'launched' };
}
//# sourceMappingURL=probes.js.map