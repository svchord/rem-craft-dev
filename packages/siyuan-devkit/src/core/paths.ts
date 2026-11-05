/**
 * core 内共用的路径处理：归一化比较 + 思源配置文件的候选路径与解析。
 *
 * 之前 samePath / sameDir 在 link.ts 与 control-server.ts 各写一份；
 * workspace.json 的候选路径与解析在 siyuan.ts（用 process.env.USERPROFILE）和
 * workspace.ts（用 homedir()）各写一份，行为会随环境变量漂移。现在单一来源。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireRecoverable } from './errors.ts';
import { isString } from './guards.ts';

/** 比较两个路径是否指向同一处（忽略分隔符方向、末尾斜杠与大小写）。 */
export function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const normalized = resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
    // Linux 文件系统大小写敏感；Windows/macOS（默认）不敏感。
    return process.platform === 'linux' ? normalized : normalized.toLowerCase();
  };
  return normalize(left) === normalize(right);
}

/** 在调用时读环境，避免模块加载即固化一份隐式全局状态。 */
function siyuanConfigDirs(): string[] {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? [join(appData, 'SiYuan'), join(appData, 'SiYuan-Electron')] : [];
  }
  if (process.platform === 'darwin') {
    return [join(homedir(), 'Library', 'Application Support', 'SiYuan')];
  }
  return [join(homedir(), '.config', 'siyuan')];
}

/** 桌面端记录工作区路径的清单文件（不同发行版放的位置不一样）。 */
export function workspaceManifestCandidates(): string[] {
  return siyuanConfigDirs().map((dir) => join(dir, 'workspace.json'));
}

/** kernel 的 PID→端口映射文件（前两种发行版位置）。 */
export function portMapCandidates(): string[] {
  return siyuanConfigDirs().map((dir) => join(dir, 'port.json'));
}

/**
 * 读 workspace.json：内容是一个字符串数组，元素为工作区绝对路径。
 * 只忽略「文件不存在/无权限/JSON 坏了」这类可恢复错误，其余重抛。
 */
export function readWorkspacePaths(): string[] {
  for (const file of workspaceManifestCandidates()) {
    if (!file || !existsSync(file)) continue;
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(data)) return data.filter(isString);
    } catch (cause) {
      requireRecoverable(cause);
    }
  }
  return [];
}
