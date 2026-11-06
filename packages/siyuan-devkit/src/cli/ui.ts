/**
 * CLI 输出：纯文本，不做颜色、图标、边框、表格对齐。
 *
 * CLI 的主要消费者是 agent：ANSI、box 边框、表格补空格都只是 token 开销。
 * 需要结构化数据时用 `--json`；这里的函数只保证输出简单、稳定、可解析。
 */

/**
 * 一行状态输出。
 *
 * 不带级别参数：CLI 输出是纯文本，级别不改变任何排版。真正区分通道的只有
 * warn / fail 走 stderr，其余走 stdout。之前这里有个被函数体完全忽略的
 * `_level` 首参，是给不存在的「分级排版」预留的。
 */
export function status(label: string, detail?: string): void {
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

/**
 * 把样式读数转成两列行，跳过空值（未定义的自定义属性读出来是空串）。
 *
 * 放在这里而不是各命令里：measure 与 audit 的输出用的是同一份形状，
 * 之前两边各写了一份逐字相同的实现。
 */
export function styleRows(styles: Record<string, string>): Array<[string, string]> {
  return Object.entries(styles)
    .filter(([, value]) => Boolean(value))
    .map(([prop, value]) => [prop, value]);
}

/** 链接行：标签 + 完整 URL，不做终端超链接。 */
export function linkRow(label: string, url: string): void {
  console.log(`${label}\t${url}`);
}
