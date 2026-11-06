/**
 * plugin/ 三个插件共用的小工具。
 *
 * 只放「plugin/ 独有」的东西：递归目录遍历。类型守卫与错误文案归一化是
 * 跨层共享契约，直接在 core/ 定义一份，这里不再各养一份（plugin → core
 * 是允许的依赖方向）。
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
