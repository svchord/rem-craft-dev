/**
 * 本机回环 HTTP 探测：带超时、只把可恢复的网络错误降级成 null。
 * siyuan.ts（探 kernel 端口）与 control-server.ts（探 dev 会话）共用。
 */
import { isRecoverable } from './errors.ts';

export async function fetchOk(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? response : null;
  } catch (cause) {
    if (!isRecoverable(cause)) throw cause;
    return null;
  }
}
