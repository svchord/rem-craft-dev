/**
 * 隔离测量沙箱：在页面里开一个 iframe，只注入被测 CSS，量真实渲染。
 *
 * 为什么必须隔离：思源的宿主主题（本机是 Neo，1.1MB、上万条规则）会覆盖
 * `.b3-menu__item` 的颜色、`--b3-*` 等一大批属性。直接在主文档里量，读到的是
 * 「宿主 + 被测对象」的混合结果，改自己的 CSS 反而看不到变化——测不出东西。
 *
 * 为什么用 iframe 而不是 display:none 的容器：iframe 有独立的样式作用域和
 * 独立的级联根，宿主主题的规则一条都进不来；同时它有自己的布局，宽度类读数
 * 才真实。用 `position:fixed;left:-99999px` 放到视口外，避免闪屏。
 *
 * 主题与插件共用这个沙箱：差异只在「CSS 文本从哪来」（见 targets.mjs），
 * 注入与测量本身完全一样。
 */

/**
 * 在 iframe 里建一个只含被测 CSS 的文档，返回该 iframe。
 *
 * `sheets` 是 [{ label, text }]：按顺序注入，后注入的优先级更高，与页面里
 * 多个 <style> 的层叠顺序一致。
 */
async function createCleanFrame(page, sheets, rootAttributes) {
  const frameId = 'rc-measure-frame';
  await page.evaluate(
    (id, cssSheets, attributes) => {
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

      for (const sheet of cssSheets) {
        const style = doc.createElement('style');
        style.setAttribute('data-sheet', sheet.label);
        style.textContent = sheet.text;
        doc.head.appendChild(style);
      }
    },
    frameId,
    sheets,
    rootAttributes
  );
  return frameId;
}

/**
 * 在隔离沙箱里量一组读数。
 *
 * @param page   puppeteer page
 * @param sheets 要注入的 CSS：[{ label, text }]（主题一份，插件可能一份或空）
 * @param spec   { tokens, selectors, probes, attributes }
 */
export async function measureIsolated(page, sheets, spec) {
  const frameId = await createCleanFrame(page, sheets, spec.attributes);

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
 * 统计 CSS 自身的「可疑声明」：值里出现 rgb(var(--b3-... 这类双重包装。
 *
 * 这类错误在源码里看不出来（构建后才是 rgb(rgb(...))），浏览器又会静默丢弃整条
 * 声明，所以必须显式查。实测它真的发生过：l2 把 --b3-* 桥成完整色值，l3 又包了
 * 一层 rgb()，导致 .b3-menu__item 的 color 与分隔线整条失效。
 *
 * 主题与插件都可能踩到同一个坑，所以对每份样式表都跑。
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

/**
 * 从多份样式表里汇总可疑声明，按来源标注。
 * 插件动辄 50 万字符的 CSS，不标来源就不知道去改哪个文件。
 */
export function findProblemsIn(sheets) {
  return sheets.flatMap((sheet) =>
    findDoubleWrappedColors(sheet.text).map((problem) => ({ ...problem, sheet: sheet.label }))
  );
}
