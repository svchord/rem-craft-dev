/**
 * 令牌探针：在真实页面里读计算样式，返回纯数据，不打印。
 *
 * 读数逻辑跑在浏览器里：计算样式里的自定义属性**已展开 var() 链**，未定义的
 * 令牌返回空串，一个 getPropertyValue 就够。注意 L0 刻度存的是 "R G B" 三通道，
 * 不是颜色值，这里只取原文、不做任何颜色求值。
 *
 * 其余浏览器侧读数（元素可见性、探针注入、样式/盒模型/环境）统一在 page-read.ts；
 * 曾经 iframe 隔离测量会漏掉 base.css（实测 line-height 在 iframe 里是 normal、
 * 真实页面是 28px），已整体删除。本文件只保留 probeTokens 这一个最小公开入口。
 */
import type { Page } from 'puppeteer-core';

export async function probeTokens(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((tokenNames: string[]) => {
    const root = getComputedStyle(document.documentElement);
    const values: Record<string, string> = {};
    for (const name of tokenNames) {
      values[name] = root.getPropertyValue(name).trim();
    }
    return values;
  }, names);
}
