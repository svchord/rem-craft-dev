/**
 * CLI 输出：纯文本，不做颜色、图标、边框、表格对齐。
 *
 * CLI 的主要消费者是 agent：ANSI、box 边框、表格补空格都只是 token 开销。
 * 需要结构化数据时用 `--json`；这里的函数只保证输出简单、稳定、可解析。
 */

/** 状态级别；纯文本下级别不改变排版，只为调用方保留语义。 */
export type Level = 'info' | 'success' | 'warn' | 'error';

/** 一行状态输出。 */
export function status(_level: Level, label: string, detail?: string): void {
  console.log(detail ? `${label}: ${detail}` : label);
}

/** 简短说明行。 */
export function info(message: string): void {
  console.log(message);
}

/** 警告行。 */
export function warn(message: string): void {
  console.warn(message);
}

/** 错误行。 */
export function fail(message: string): void {
  console.error(message);
}

/** 段落标题。 */
export function section(title: string): void {
  console.log(title);
}

/** 带标题的块：标题 + 逐行内容，不画边框。 */
export function box(title: string, lines: readonly string[]): void {
  console.log(title);
  for (const line of lines) console.log(line);
}

/** 制表符分隔的表格，保留列语义但不做宽度对齐。 */
export function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): void {
  if (headers.length) console.log(headers.join('\t'));
  for (const row of rows) console.log(row.join('\t'));
}

/** 两列清单。 */
export function list(rows: ReadonlyArray<readonly [string, string]>): void {
  for (const [name, value] of rows) console.log(`${name}\t${value}`);
}

/** 链接行：标签 + 完整 URL，不做终端超链接。 */
export function linkRow(label: string, url: string): void {
  console.log(`${label}\t${url}`);
}
