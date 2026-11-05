/**
 * 可恢复错误与编程错误的分界。
 *
 * 之前 core 里二十多处 `catch { return null/false }` 把「文件不存在 / 端口没开 /
 * JSON 写坏了」和「代码写错了」一并吞掉，排查时只看到「重载失败」。这里只把
 * **可枚举的环境错误**当成可恢复，其余一律重抛。
 */
/** 取错误码；Node 的 fetch 会把系统错误包在 cause 里，所以向下展开几层。 */
function codeOf(value: unknown, depth = 0): string | null {
  if (depth > 3 || typeof value !== 'object' || value === null) return null;
  if ('code' in value) {
    const code: unknown = value.code;
    if (typeof code === 'string') return code;
  }
  if (value instanceof Error && value.cause !== undefined) return codeOf(value.cause, depth + 1);
  return null;
}

/** 取 Node/DOM 错误里带的 code；不是带 code 的错误返回 null。 */
export function errorCode(cause: unknown): string | null {
  return codeOf(cause);
}

/** 环境类错误码：文件不存在/无权限、连接被拒/超时、目标忙。 */
export const RECOVERABLE_CODES = [
  'ENOENT',
  'EACCES',
  'EPERM',
  'EEXIST',
  'EISDIR',
  'ENOTDIR',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ABORT_ERR',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
] as const;

/** 坏配置/坏 JSON 是用户输入的错，不是包的 bug，也按可恢复处理。 */
function isBadInput(cause: unknown): boolean {
  if (cause instanceof SyntaxError) return true;
  if (typeof cause !== 'object' || cause === null || !('name' in cause)) return false;
  const name: unknown = cause.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** 是否是可恢复的环境错误；其余（TypeError/ReferenceError…）返回 false。 */
export function isRecoverable(cause: unknown, codes: readonly string[] = RECOVERABLE_CODES): boolean {
  const code = errorCode(cause);
  if (code !== null && codes.includes(code)) return true;
  return isBadInput(cause);
}

/**
 * 不可恢复就重抛。调用方在 catch 里先过这一关，再写降级逻辑，
 * 避免把编程错误伪装成「读不到」「重载失败」。
 */
export function requireRecoverable(cause: unknown, codes?: readonly string[]): void {
  if (!isRecoverable(cause, codes)) throw cause;
}

/** puppeteer 在导航/页面销毁期间的固定报错，属于预期竞态。 */
export function isNavigationError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return /Execution context was destroyed|Target closed|Navigation failed|Protocol error|detached|Cannot find context with specified id|Navigating frame was detached/i.test(
    cause.message
  );
}

export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
