/**
 * 工作区与安装目录解析：主题装到 `data/themes`，插件装到 `data/plugins`。
 *
 * 两种发现方式：问运行中的内核（多工作区时最准）、读桌面端 workspace.json
 * （内核没起来时也能用）。候选路径与解析统一在 paths.ts，不再各写一份。
 * 环境变量优先（SIYUAN_THEME_DIR / SIYUAN_PLUGIN_DIR）：CI 与自定义工作区
 * 要能绕过内核探测，否则一台机器上跑多工作区就没法脚本化。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { callKernel } from './kernel.ts';
import { readWorkspacePaths } from './paths.ts';
import { isRecord, isString } from './guards.ts';
import { requireRecoverable, UserFacingError } from './errors.ts';
import { TIMING } from './timing.ts';

/** 一个工作区。 */
export interface Workspace {
  path: string;
}

/** 从 workspace.json 读工作区路径列表（文件内容是一个字符串数组）。 */
export function readWorkspaceManifest(): Workspace[] {
  return readWorkspacePaths().map((path) => ({ path }));
}

/** 列工作区：先问内核，问不到再读文件；内核不可用不是错误。 */
export async function listWorkspaces({ port = null }: { port?: number | null } = {}): Promise<Workspace[]> {
  if (port !== null) {
    try {
      // 复用 callKernel：请求头（SIYUAN_TOKEN）与响应处理只有一份。
      const response = await callKernel(port, '/api/system/getWorkspaces', {}, TIMING.workspacesProbe);
      const data: unknown = response.data;
      const list = Array.isArray(data) ? data : [];
      const paths = list
        .map((item) => (isRecord(item) ? item['path'] : undefined))
        .filter((value): value is string => isString(value));
      if (paths.length) return paths.map((path) => ({ path }));
    } catch (cause) {
      requireRecoverable(cause);
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
 * 子目录名与环境变量名由调用方（描述符）给，这里不写死——外部项目注册
 * widget / iconset 时各有各的安装位置，写死就意味着每加一种类型都要改本文件。
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
  if (explicitDir) {
    const dir = resolve(explicitDir);
    // 显式覆盖也要校验：写错一层 data 就递归造目录、在错误位置建链接还报成功，
    // 思源根本不读那里，用户只会看到「改源码不生效」却无从查起。
    if (!existsSync(dir)) {
      throw new UserFacingError(
        `${dirEnv} 指向的目录不存在：${dir}\n` +
          `  请指向思源工作区的 <workspace>/data/${subdir}（当前类型：${kind}），或去掉该环境变量让工具自动探测。`
      );
    }
    return dir;
  }

  const root = workspace ?? (await listWorkspaces({ port }))[0]?.path;
  if (!root) {
    throw new UserFacingError(
      `找不到思源工作区：确认思源已启动，或设置 ${dirEnv} 为 <workspace>/data/${subdir}（当前类型：${kind}）`
    );
  }
  // workspace.json 里可能残留旧工作区路径。data 目录不存在就说明这个 root 不是
  // 可用的思源工作区，别让 ensureLink 递归造出一个看似合法的空壳。
  const dataDir = join(root, 'data');
  if (!existsSync(dataDir)) {
    throw new UserFacingError(
      `工作区路径下没有 data 目录：${root}\n` +
        `  workspace.json 可能残留了旧路径。请确认当前打开的工作区，或设置 ${dirEnv} 指向正确的 <workspace>/data/${subdir}。`
    );
  }
  return resolve(join(dataDir, subdir));
}
