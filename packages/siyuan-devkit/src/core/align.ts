/**
 * 复用测量页面时，把页面上的 CSS 跟磁盘对齐。
 *
 * 主题 CSS 是 `<link id="themeStyle">` → 换 href 即可；插件 CSS 是思源注入的
 * 内联 `<style id="pluginsStyle<name>">` → 得把 textContent 换成磁盘上的新文本。
 * 两者互不冲突，所以不需要判断被测类型：有插件 CSS 就更新，没有就跳过。
 *
 * 这样测量的正确性不依赖热重载是否成功——哪怕插件 CSS 改了但没热重载，
 * 复用页面量到的仍是磁盘真值。
 */
import type { Page } from 'puppeteer-core';
import { refreshThemeStylesheet } from './session.ts';
import type { Target } from './targets.ts';

/** 把复用页面上的主题与插件 CSS 都跟磁盘对齐。 */
export async function alignStylesheets(page: Page, target: Target | null): Promise<void> {
  await refreshThemeStylesheet(page);
  if (!target) return;

  let text: string;
  try {
    const sheets = await target.resolveCss();
    text = sheets.map((sheet) => sheet.text).join('\n');
  } catch {
    // 找不到 CSS（比如插件未安装）时保持页面现状，由 mount 字段如实反映。
    return;
  }
  if (!text) return;

  await page.evaluate(
    (name: string, css: string) => {
      const element = document.getElementById(`pluginsStyle${name}`);
      if (element) element.textContent = css;
    },
    target.name,
    text
  );
}
