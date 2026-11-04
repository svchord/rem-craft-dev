/**
 * 工作区与安装目录解析：主题装到 `data/themes`，插件装到 `data/plugins`。
 *
 * 两种发现方式，各有用途：
 *   1. 问运行中的内核（`/api/system/getWorkspaces`）——多工作区时最准
 *   2. 读桌面端记录的 `workspace.json`——内核没起来时也能用
 *
 * 环境变量优先（`SIYUAN_THEME_DIR` / `SIYUAN_PLUGIN_DIR`）：CI 和自定义
 * 工作区要能绕过内核探测，否则一台机器上跑多工作区就没法脚本化。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 一个工作区。 */
export interface Workspace {
  path: string;
}

/** 桌面端记录工作区路径的清单文件（不同发行版放的位置不一样）。 */
const MANIFEST_CANDIDATES = [
  join(homedir(), '.config', 'siyuan', 'workspace.json'),
  join(process.env.APPDATA ?? '', 'SiYuan', 'workspace.json'),
  join(process.env.APPDATA ?? '', 'SiYuan-Electron', 'workspace.json'),
];

/**
 * 从 workspace.json 读工作区路径列表。
 * 文件内容是一个字符串数组，元素就是工作区绝对路径。
 */
export function readWorkspaceManifest(): Workspace[] {
  for (const file of MANIFEST_CANDIDATES) {
    if (!file || !existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(data) && data.length && typeof data[0] === 'string') {
        return (data as string[]).map((path) => ({ path }));
      }
    } catch {
      // 继续下一个候选
    }
  }
  return [];
}

/**
 * 列工作区：先问内核，问不到再读文件。
 *
 * 内核可用时优先用它——用户可能开着好几个工作区，文件里记录的未必是当前那个。
 * 内核不可用不是错误，退回文件即可（审计插件 CSS 时插件可能根本没运行）。
 */
export async function listWorkspaces({ port = null }: { port?: number | null } = {}): Promise<Workspace[]> {
  if (port) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.SIYUAN_TOKEN) headers.Authorization = `Token ${process.env.SIYUAN_TOKEN}`;
      const response = await fetch(`http://127.0.0.1:${port}/api/system/getWorkspaces`, {
        method: 'POST',
        headers,
        body: '{}',
        signal: AbortSignal.timeout(3000),
      });
      const data = (await response.json()) as { data?: Array<{ path?: unknown }> };
      const list = Array.isArray(data?.data) ? data.data : [];
      const paths = list.map((item) => item?.path).filter((path): path is string => typeof path === 'string');
      if (paths.length) return paths.map((path) => ({ path }));
    } catch {
      // 内核没起来或接口不可用，退回文件
    }
  }
  return readWorkspaceManifest();
}

/** 解析安装目录的参数。 */
export interface ResolveInstallDirOptions {
  /** 类型名，只用于报错信息。 */
  kind: string;
  /** data 下的子目录，如 'themes' / 'plugins'。 */
  subdir: string;
  /** 覆盖安装目录的环境变量名，如 'SIYUAN_THEME_DIR'。 */
  dirEnv: string;
  /** 显式工作区路径（跳过探测）。 */
  workspace?: string | null;
  /** 内核端口（用于问工作区列表）。 */
  port?: number | null;
}

/**
 * 解析 `<workspace>/data/<subdir>`。
 *
 * 子目录名与环境变量名由**调用方**给（来自被测类型描述符），这里不写死：
 * 思源的安装目录不止 themes / plugins，widgets、icons 各有各的位置，
 * 写死在这里就意味着每加一种类型都要改这个文件。
 *
 * @returns 绝对路径；找不到时抛错而不是静默返回一个不存在的路径
 */
export async function resolveInstallDir({
  kind,
  subdir,
  dirEnv,
  workspace = null,
  port = null,
}: ResolveInstallDirOptions): Promise<string> {
  if (!subdir) throw new Error('resolveInstallDir 需要 subdir（如 themes / plugins）');

  const explicitDir = dirEnv ? process.env[dirEnv]?.trim() : undefined;
  if (explicitDir) return resolve(explicitDir);

  const root = workspace ?? (await listWorkspaces({ port }))[0]?.path;
  if (!root) {
    throw new Error(
      `找不到思源工作区：确认思源已启动，或设置 ${dirEnv} 为 <workspace>/data/${subdir}（当前类型：${kind}）`
    );
  }
  return resolve(join(root, 'data', subdir));
}
