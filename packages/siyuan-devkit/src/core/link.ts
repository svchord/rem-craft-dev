/**
 * 把构建产物目录链接到思源的安装目录，让思源直接读你的 `dev/`。
 *
 * 为什么不复制：复制要每次构建后重来一遍，且思源读的是副本，改完不生效。
 *
 * Windows 上建目录链接有两种方式，差别是真实的：
 *   symlink   真正的符号链接，需要开发者模式或管理员权限；思源（Go）按
 *             ModeSymlink 识别它。
 *   junction  目录联接，普通用户就能建；但 Go 的 Lstat 报的是
 *             ModeDir|ModeIrregular，**不认作符号链接**。
 * 实测主题用 junction 能正常加载，所以主题允许 junction 兜底；插件目录必须
 * 是真 symlink，建不出来时如实报错，不擅自换成 junction 假装成功。
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { samePath } from './paths.ts';
import { errorCode, requireRecoverable, describeError } from './errors.ts';

// 兼容既有导入：路径归一化实现只在 paths.ts 一份。
export { samePath } from './paths.ts';

/** 链接类型。 */
export type LinkType = 'symlink' | 'junction';

/**
 * 把产物目录**复制**到插件安装目录（覆盖），不需要任何符号链接权限。
 *
 * 用于 Windows 未开开发者模式 / 非管理员、symlink 报 EPERM 时兜底：思源认真实
 * 目录（junction 不行，真实目录可以），只是每次构建后要重新同步一次。
 */
export function syncCopy(srcDir: string, targetDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(srcDir, targetDir, { recursive: true });
}

/** 链接现状。 */
export interface LinkState {
  /** absent 可建；linked 已就绪；conflict 存在但不是指向 src 的链接。 */
  state: 'absent' | 'linked' | 'conflict';
  target: string | null;
  reason: string | null;
}

/** 建链接的结果。 */
export interface EnsureLinkResult {
  ok: boolean;
  changed: boolean;
  linkType: LinkType | null;
  reason: string | null;
}

/** 检查链接现状，不修改任何东西。 */
export function inspectLink(srcPath: string, targetPath: string): LinkState {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return { state: 'absent', target: null, reason: null };
    throw cause;
  }

  if (!stat.isSymbolicLink()) {
    // junction 在 Windows 上 lstat 也报 isSymbolicLink() === true，
    // 所以走到这里一定是真目录或文件。
    return {
      state: 'conflict',
      target: null,
      reason: `${targetPath} 已存在且不是链接（是个普通目录/文件）`,
    };
  }

  const existing = resolve(dirname(targetPath), readlinkSync(targetPath));
  if (samePath(existing, srcPath)) {
    return { state: 'linked', target: existing, reason: null };
  }
  return { state: 'conflict', target: existing, reason: `${targetPath} 已链接到别处：${existing}` };
}

/** 建链接的选项。 */
export interface EnsureLinkOptions {
  /** auto：先试 symlink，权限不足时按 requireSymlink 决定是否退 junction。 */
  mode?: LinkType | 'auto';
  /**
   * 目标是否必须被 Go 识别为 symlink（插件目录）。true 时 auto 只试 symlink。
   * 不传表示「普通目录，可以用 junction 兜底」。
   */
  requireSymlink?: boolean;
  /**
   * 权限不足时是否允许弹 UAC 提权。默认 true（面向真实用户）；
   * 测试、CI 等无人值守场景传 false，避免卡在系统弹窗上。
   */
  allowElevation?: boolean;
  /** @deprecated 用 requireSymlink；kind === 'plugin' 等价于 requireSymlink: true。 */
  kind?: string;
}

/** 显式副作用：确保产物目录存在（symlink 不能指向不存在的源）。 */
function prepareSourceDir(srcPath: string): void {
  mkdirSync(srcPath, { recursive: true });
}

/** 显式副作用：确保安装父目录存在。 */
function prepareParentDir(targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
}

/**
 * 无符号链接权限时（Windows 普通用户默认没有 SeCreateSymbolicLinkPrivilege），
 * 弹一次 UAC 提权创建符号链接，而不是要求用户开开发者模式或常驻管理员。
 * 只提权这一条 `New-Item -ItemType SymbolicLink` 命令，用户点「是」即可。
 * 返回是否成功建出真正的符号链接。
 */
function elevateSymlink(srcPath: string, targetPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `New-Item -ItemType SymbolicLink -Path ${quote(targetPath)} -Target ${quote(srcPath)} | Out-Null`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const command = [
    "$p = Start-Process -FilePath 'powershell.exe'",
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')`,
    '-Verb RunAs -Wait -PassThru',
    '; exit $p.ExitCode',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: 'inherit',
    windowsHide: false,
  });
  if (result.status !== 0) return false;
  try {
    return lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 建立链接（已存在且指向同一处时幂等）。
 * 注意本函数会创建产物目录与安装父目录——这是它的显式副作用，不是隐藏行为。
 */
export function ensureLink(
  srcPath: string,
  targetPath: string,
  { mode = 'auto', requireSymlink, allowElevation = true, kind }: EnsureLinkOptions = {}
): EnsureLinkResult {
  prepareSourceDir(srcPath);

  const current = inspectLink(srcPath, targetPath);
  if (current.state === 'linked') {
    return { ok: true, changed: false, linkType: detectLinkType(targetPath), reason: null };
  }
  if (current.state === 'conflict') {
    return { ok: false, changed: false, linkType: null, reason: current.reason };
  }

  prepareParentDir(targetPath);

  const mustBeSymlink = requireSymlink ?? kind === 'plugin';
  const attempts: LinkType[] = mode === 'auto' ? (mustBeSymlink ? ['symlink'] : ['symlink', 'junction']) : [mode];
  let lastError: unknown = null;

  for (const linkType of attempts) {
    try {
      symlinkSync(srcPath, targetPath, linkType === 'junction' ? 'junction' : 'dir');
      return { ok: true, changed: true, linkType, reason: null };
    } catch (cause) {
      lastError = cause;
      const code = errorCode(cause);
      // 权限不足（Windows symlink 需要 SeCreateSymbolicLinkPrivilege）：不要求开发者模式，
      // 直接弹一次 UAC 提权建符号链接，用户点「是」即可，之后热重载正常。
      if ((code === 'EPERM' || code === 'EACCES') && linkType === 'symlink') {
        if (allowElevation && elevateSymlink(srcPath, targetPath)) {
          return { ok: true, changed: true, linkType: 'symlink', reason: null };
        }
        continue;
      }
      // 其它错误重试也没用，且不吞掉编程错误。
      requireRecoverable(cause, ['EEXIST', 'ENOENT', 'EISDIR', 'ENOTDIR']);
      break;
    }
  }

  return {
    ok: false,
    changed: false,
    linkType: null,
    reason: describeLinkFailure(lastError, { srcPath, targetPath, mustBeSymlink, attempts }),
  };
}

/**
 * 读已存在链接的类型，仅用于日志。
 * 返回 LinkType | null：区分不了时返回 null，绝不谎报成 junction。
 */
export function detectLinkType(targetPath: string): LinkType | null {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) return null;
    const target = readlinkSync(targetPath);
    if (process.platform !== 'win32') return 'symlink';
    // Windows junction 的 readlink 返回绝对路径；symlink 通常是原样存进去的值。
    return isAbsolute(target) ? 'junction' : null;
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return null;
    throw cause;
  }
}

function describeLinkFailure(
  error: unknown,
  {
    srcPath,
    targetPath,
    mustBeSymlink,
    attempts,
  }: { srcPath: string; targetPath: string; mustBeSymlink: boolean; attempts: LinkType[] }
): string {
  const lines = [
    `无法建立目录链接：${describeError(error)}`,
    `  源目录：${srcPath}`,
    `  目标：  ${targetPath}`,
    `  尝试过：${attempts.join(' / ')}`,
  ];

  if (process.platform === 'win32') {
    lines.push('  解决办法（任选其一）：');
    lines.push('    1. 开启 Windows 开发者模式：设置 → 系统 → 开发者选项');
    lines.push('    2. 用管理员身份运行终端后重试');
    if (mustBeSymlink) {
      lines.push('  注意：该目录不能用 junction 兜底——思源的 Go 运行时按符号链接判定，');
      lines.push('         junction 会被当成普通目录，插件静默加载不到。');
    }
  } else {
    lines.push(`  解决办法：修正 ${dirname(targetPath)} 的写权限后重试`);
  }
  return lines.join('\n');
}

/** 链接建好后，确认思源该读的文件真的在（防止链到空目录还以为成功）。 */
export function checkLinkedFiles(targetPath: string, expectedFiles: string[]): { ok: boolean; missing: string[] } {
  const missing = expectedFiles.filter((file) => !existsSync(resolve(targetPath, file)));
  return { ok: missing.length === 0, missing };
}
