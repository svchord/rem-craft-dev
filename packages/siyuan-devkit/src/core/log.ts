/**
 * 日志级别的公共契约。
 *
 * 放在 core 而不是 dev/：主题、插件、CLI 三条链路都要用它标注日志级别，
 * 若由 dev/dev-session.ts 定义，plugin/ 就得反向 import dev/ 才能拿到类型。
 * 这里只定义类型与默认级别，不含任何输出实现——打印由各层的展示代码负责。
 */

/** 日志级别；debug 只在 SYT_DEBUG=1 时显示。 */
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

/**
 * 日志回调。
 *
 * level 可选，缺省按 info 处理——简单场景不必逐个标注。
 */
export type Logger = (message: string, level?: LogLevel) => void;

/** 缺省级别；未标注 level 的调用点按它处理。 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
