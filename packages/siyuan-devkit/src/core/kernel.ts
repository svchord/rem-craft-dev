/**
 * 思源 kernel 侧的通用能力。
 *
 * 只放「与被测类型无关」的原语：调 kernel API、让思源选中主题。
 * 产物变化的刷新是 dev 会话统一广播整页刷新（/api/ui/reloadUI），
 * 不再按主题/插件/JS 分叉重注入。
 */
import { isRecord } from './guards.ts';
import { requireRecoverable } from './errors.ts';

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
