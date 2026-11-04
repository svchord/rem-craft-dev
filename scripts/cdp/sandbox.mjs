/**
 * 隔离测量沙箱：在页面里开一个 iframe，只注入主题 CSS，量真实渲染。
 *
 * 为什么必须隔离：思源的宿主主题（本机是 Neo，1.1MB、上万条规则）会覆盖
 * `.b3-menu__item` 的颜色、`--b3-*` 等一大批属性。直接在主文档里量，读到的是
 * 「宿主 + 我们」的混合结果，改自己的 CSS 反而看不到变化——测不出东西。
 *
 * 为什么用 iframe 而不是 display:none 的容器：iframe 有独立的样式作用域和
 * 独立的级联根，宿主主题的规则一条都进不来；同时它有自己的布局，宽度类读数
 * 才真实。用 `position:fixed;left:-99999px` 放到视口外，避免闪屏。
 *
 * 测量对象是**磁盘上的 theme.css**（不是 HMR 注入的那份）：
 *   - 它和生产产物同源，断言才有意义
 *   - pnpm dev 的 `vite build --watch` 会持续重建它，所以改完源码它是最新的
 */

/** 在 iframe 里建一个只含主题 CSS 的文档，返回该 iframe。 */
async function createCleanFrame(page, cssText, rootAttributes) {
  const frameId = 'rc-measure-frame';
  await page.evaluate(
    (id, css, attributes) => {
      document.getElementById(id)?.remove();
      const frame = document.createElement('iframe');
      frame.id = id;
      frame.setAttribute('style', 'position:fixed;left:-99999px;top:0;width:1400px;height:900px;border:0;');
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      doc.open();
      doc.write('<!doctype html><html><head></head><body></body></html>');
      doc.close();

      // 变体用例靠 <html> 上的属性生效（data-theme-mode / data-ui-density …），
      // 必须写在 iframe 自己的 documentElement 上，主文档的属性不会继承进 iframe。
      for (const [name, value] of Object.entries(attributes ?? {})) {
        doc.documentElement.setAttribute(name, value);
      }

      const style = doc.createElement('style');
      style.id = 'rc-clean-style';
      style.textContent = css;
      doc.head.appendChild(style);
    },
    frameId,
    cssText,
    rootAttributes
  );
  return frameId;
}

/**
 * 在隔离沙箱里量一组读数。
 *
 * @param page   puppeteer page
 * @param cssText 主题 CSS 全文（读磁盘产物）
 * @param spec   { tokens, selectors, probes, attributes }
 */
export async function measureIsolated(page, cssText, spec) {
  const frameId = await createCleanFrame(page, cssText, spec.attributes);

  try {
    return await page.evaluate(
      (id, payload) => {
        const frame = document.getElementById(id);
        const doc = frame.contentDocument;
        const win = frame.contentWindow;

        // 1) 令牌：读 <html> 的计算样式（var() 链已展开，未定义为空串）
        const rootStyle = win.getComputedStyle(doc.documentElement);
        const tokens = {};
        for (const name of payload.tokens) {
          tokens[name] = rootStyle.getPropertyValue(name).trim();
        }

        // 2) 选择器命中数：在沙箱里插一份最小结构再数
        const host = doc.createElement('div');
        host.id = 'rc-measure-host';
        doc.body.appendChild(host);

        const hits = {};
        for (const selector of payload.selectors) {
          try {
            hits[selector] = host.querySelectorAll(selector).length;
          } catch {
            hits[selector] = -1;
          }
        }

        // 3) 探针：每个用例独立插一段标记，量完移除
        const probes = [];
        for (const probe of payload.probes) {
          const wrapper = doc.createElement('div');
          wrapper.innerHTML = probe.html;
          host.appendChild(wrapper);
          try {
            const element = host.querySelector(probe.target);
            if (!element) {
              probes.push({ label: probe.label, found: false, styles: {} });
            } else {
              const style = win.getComputedStyle(element);
              const styles = {};
              for (const property of probe.props) styles[property] = style.getPropertyValue(property);
              probes.push({ label: probe.label, found: true, styles });
            }
          } finally {
            wrapper.remove();
          }
        }

        host.remove();
        return { tokens, hits, probes };
      },
      frameId,
      spec
    );
  } finally {
    await page.evaluate((id) => document.getElementById(id)?.remove(), frameId);
  }
}

/**
 * 统计主题 CSS 自身的「可疑声明」：值里出现 rgb(var(--b3-... 这类双重包装。
 *
 * 这类错误在源码里看不出来（构建后才是 rgb(rgb(...))），浏览器又会静默丢弃整条
 * 声明，所以必须显式查。实测它真的发生过：l2 把 --b3-* 桥成完整色值，l3 又包了
 * 一层 rgb()，导致 .b3-menu__item 的 color 与分隔线整条失效。
 */
export function findDoubleWrappedColors(css) {
  const problems = [];
  const pattern = /rgb\(\s*var\(\s*(--b3-[\w-]+)\s*\)\s*\)/g;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of text.matchAll(pattern)) {
    problems.push({ token: match[1], snippet: match[0] });
  }
  return problems;
}
