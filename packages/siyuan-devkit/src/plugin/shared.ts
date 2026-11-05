/**
 * plugin/ 三个插件共用的小工具。
 *
 * 放这里是为了不让 assets.ts 与 post.ts 各写一遍递归目录遍历，
 * 也让 JSON 解析 / catch 错误处理用显式的守卫而不是类型断言。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** walkFiles 返回的一项。 */
export interface WalkedFile {
  /** 相对起始目录的路径，统一用 / 分隔（也用作 zip 条目名）。 */
  name: string;
  /** 磁盘上的绝对路径。 */
  path: string;
}

/** 递归列出目录下所有文件；目录不存在时返回空数组，不抛错。 */
export function walkFiles(dir: string, base = ''): WalkedFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full, name) : [{ name, path: full }];
  });
}

/** JSON 解析后的值必须是普通对象；用它替代 `as Record<string, unknown>` 断言。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把 catch 到的任意值变成可读文本。 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
