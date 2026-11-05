/**
 * 思源 kernel / 页面侧的通用能力。
 *
 * 只放「与被测类型无关」的原语：调 kernel API、换主题 link、重注入某段 CSS、
 * 让思源重新加载某个插件。至于「什么情况下该用哪个」由描述符决定（见
 * builtin-targets.ts），本文件不做类型判断。
 */
import type { Page } from 'puppeteer-core';
import { isRecord } from './guards.ts';
import { isNavigationError, requireRecoverable } from './errors.ts';
import { TIMING } from './timing.ts';

/** kernel API 的统一响应形状。 */
export interface KernelResponse<T = unknown> {
  code: number;
  msg?: string;
  data: T | null;
}

/** 思源 appearance 配置里我们用到的字段。 */
interface AppearanceConfig {
  themeLight?: string;
  themeDark?: string;
  mode?: number;
}

interface SystemConf {
  conf?: { appearance?: AppearanceConfig };
}

/**
 * 调 kernel API。开了 API token 时从环境变量 SIYUAN_TOKEN 读。
 * timeoutMs > 0 时加超时（问工作区列表这类探测用得上），默认不限时保留旧行为。
 */
export async function callKernel<T = unknown>(
  port: number,
  path: string,
  body: unknown = {},
  timeoutMs = 0
): Promise<KernelResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SIYUAN_TOKEN) headers.Authorization = `Token ${process.env.SIYUAN_TOKEN}`;

  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  const text = await response.text();
  // 思源有些接口成功时返回空体
  if (!text) return { code: 0, data: null };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { code: -1, data: null, msg: text.slice(0, 200) };
    return {
      code: typeof parsed['code'] === 'number' ? parsed['code'] : -1,
      msg: typeof parsed['msg'] === 'string' ? parsed['msg'] : undefined,
      // 泛型边界：data 是外部 JSON，具体形状由调用方指定的 T 决定。
      data: ('data' in parsed ? parsed['data'] : null) as T | null,
    };
  } catch (cause) {
    // 只有坏 JSON（SyntaxError）算可恢复；其它错误重抛，不伪装成「调用失败」。
    requireRecoverable(cause);
    return { code: -1, data: null, msg: text.slice(0, 200) };
  }
}

/** 切换主题的结果。 */
export interface SelectThemeResult {
  ok: boolean;
  /** 是否真的做了切换（本来就是这个主题时为 false）。 */
  changed: boolean;
  reason: string | null;
}

/** 让思源选中指定主题（明暗都设成它）；已经是它时不动，避免无谓重载。 */
export async function selectTheme(port: number, themeName: string): Promise<SelectThemeResult> {
  const conf = await callKernel<SystemConf>(port, '/api/system/getConf');
  const appearance = conf.data?.conf?.appearance;
  if (!appearance) {
    return { ok: false, changed: false, reason: '读不到思源配置（appearance）' };
  }

  if (appearance.themeLight === themeName && appearance.themeDark === themeName) {
    return { ok: true, changed: false, reason: null };
  }

  const result = await callKernel(port, '/api/setting/setAppearance', {
    themeLight: themeName,
    themeDark: themeName,
  });
  if (result.code !== 0) {
    return { ok: false, changed: false, reason: `切换主题失败：${result.msg || '未知错误'}` };
  }
  return { ok: true, changed: true, reason: null };
}

/**
 * 让页面重新加载主题 CSS：换 #themeStyle 的 href 并加时间戳，只动那一个 link，
 * 级联位置不变。返回是否成功（页面里没有 themeStyle 时返回 false）。
 *
 * 之前把任何 page.evaluate 异常都吞成 false，连选择器写错/代码 bug 都被伪装成
 * 「导航中」；现在只接受导航竞态，其余重抛。
 */
export async function reloadThemeCss(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(async (loadTimeout: number) => {
      const link = document.getElementById('themeStyle');
      if (!link) return false;
      const base = (link.getAttribute('href') || '').split('?')[0];
      link.setAttribute('href', `${base}?v=${Date.now()}`);

      // 等新样式表真正生效，避免量到旧的
      await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        link.addEventListener('load', done, { once: true });
        link.addEventListener('error', done, { once: true });
        setTimeout(done, loadTimeout);
      });
      return true;
    }, TIMING.stylesheetLoad);
  } catch (cause) {
    if (!isNavigationError(cause)) throw cause;
    return false;
  }
}

/**
 * 让页面重新加载某个插件的 CSS（不重新执行 JS）。
 * 插件 CSS 内联在 `<style id="pluginsStyle<name>">` 里（实测与磁盘 index.css
 * 逐字节相同），换 textContent 即可，不用整页刷新、不丢用户文档与面板。
 * 只适用于 CSS 变化；JS 带副作用，那种情况要用 reloadPlugin。
 */
export async function reloadPluginCss(
  page: Page | null,
  pluginName: string,
  cssText: string | null = null
): Promise<boolean> {
  if (!page) return false;
  if (!cssText) return false;
  try {
    return await page.evaluate(
      (name: string, css: string) => {
        const el = document.getElementById(`pluginsStyle${name}`);
        if (!el) return false;
        el.textContent = css;
        return true;
      },
      pluginName,
      cssText
    );
  } catch (cause) {
    if (!isNavigationError(cause)) throw cause;
    return false;
  }
}

/** 插件重载结果。 */
export interface ReloadPluginResult {
  ok: boolean;
  reason: string | null;
}

/**
 * 让思源重新加载某个插件（重新执行它的 JS）。
 *
 * 插件 JS 是 window.eval 执行的、带副作用（注册 dock/顶栏/事件监听），换 <style>
 * 撤销不了；必须让思源走 unload → 重新拉产物 → eval → onload。
 * 触发方式是 /api/petal/setPetalEnabled 禁用再启用：内核写配置后通过 WebSocket
 * 推送 reloadPlugin，前端据此重建实例与 <style> 节点。
 *
 * `app` 是每个前端窗口启动时随机生成的标识，外部无法预知；不传则内核广播到
 * 所有前端。传一个猜的值只会被忽略，反而让人以为定向生效了。
 */
export async function reloadPlugin(
  port: number,
  pluginName: string,
  { app = null, gapMs = TIMING.pluginReloadGap }: { app?: string | null; gapMs?: number } = {}
): Promise<ReloadPluginResult> {
  const body = (enabled: boolean): Record<string, unknown> => ({
    packageName: pluginName,
    enabled,
    ...(app ? { app } : {}),
  });

  const off = await callKernel(port, '/api/petal/setPetalEnabled', body(false));
  if (off.code !== 0) return { ok: false, reason: `禁用插件失败：${off.msg || '未知错误'}` };

  await new Promise((resolve) => setTimeout(resolve, gapMs));

  const on = await callKernel(port, '/api/petal/setPetalEnabled', body(true));
  if (on.code !== 0) return { ok: false, reason: `启用插件失败：${on.msg || '未知错误'}` };

  return { ok: true, reason: null };
}
