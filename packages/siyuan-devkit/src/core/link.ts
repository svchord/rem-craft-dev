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
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { samePath } from './paths.ts';
import { errorCode, requireRecoverable, describeError } from './errors.ts';
import { TIMING } from './timing.ts';

// 兼容既有导入：路径归一化实现只在 paths.ts 一份。
export { samePath } from './paths.ts';

/** 链接类型。 */
export type LinkType = 'symlink' | 'junction';

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

/** 显式副作用：只补建安装目录的最后一层 subdir（父目录已由调用方校验存在）。 */
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
    // UAC 弹窗没人点时会无限阻塞 Node 主线程，整个 vite build --watch 停摆。
    // 给一个明确上限；超时/被拒统一走下面「提权失败」的专门文案。
    timeout: TIMING.uacPromptTimeout,
  });
  if (result.status !== 0) return false;
  try {
    return lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 建链接（已存在且指向同一处时幂等）。
 *
 * 不再无条件创建源目录：outDir 配错 / 构建没产出时，造一个空目录再链过去
 * 会让思源静默加载不到，而工具还报「已链接」。源目录必须已经存在。
 * 安装父目录只在它本身已存在时补建 subdir，避免在错误工作区递归造目录。
 */
export function ensureLink(
  srcPath: string,
  targetPath: string,
  { mode = 'auto', requireSymlink, allowElevation = true, kind }: EnsureLinkOptions = {}
): EnsureLinkResult {
  if (!existsSync(srcPath)) {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason:
        `产物目录不存在：${srcPath}\n` +
        '  构建产物还没落盘，或 build.outDir / outDir 配置指错了。请先跑一次构建再启动开发会话。',
    };
  }
  const mustBeSymlink = requireSymlink ?? kind === 'plugin';

  const current = inspectLink(srcPath, targetPath);
  if (current.state === 'linked') {
    const existingType = detectLinkType(targetPath);
    // Go 的 Lstat 把 junction 当普通目录，插件会静默加载不到。
    // 文件头承诺「插件目录必须是真 symlink」——已存在的链接也要兑现，不能只在新建时检查。
    if (mustBeSymlink && existingType === 'junction') {
      return {
        ok: false,
        changed: false,
        linkType: 'junction',
        reason:
          `${targetPath} 是 junction，插件目录必须是真正的符号链接（思源 Go 运行时按 ModeSymlink 判定）。\n` +
          '  请在思源中卸载/停用该插件，或手动移除这个 junction 后重试；工具不会覆盖已有目录。',
      };
    }
    return { ok: true, changed: false, linkType: existingType, reason: null };
  }
  if (current.state === 'conflict') {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason:
        `${current.reason}\n` +
        '  请在思源中卸载/停用同名主题（插件），或手动移除/改名该目录后重试；工具不会覆盖已有目录。',
    };
  }

  // 父目录（如 <workspace>/data）必须已存在；只补建最后一层 subdir。
  // 若连父目录都没有，说明工作区路径不对，递归造目录只会把链接建到错误位置还报成功。
  const parent = dirname(targetPath);
  if (!existsSync(parent)) {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason:
        `安装父目录不存在：${parent}\n` +
        '  思源工作区路径可能不对，或该工作区还没初始化。请确认思源已启动并打开过工作区，' +
        '或设置 SIYUAN_THEME_DIR / SIYUAN_PLUGIN_DIR 指向正确的 <workspace>/data/<subdir>。',
    };
  }
  prepareParentDir(targetPath);

  const attempts: LinkType[] = mode === 'auto' ? (mustBeSymlink ? ['symlink'] : ['symlink', 'junction']) : [mode];
  let lastError: unknown = null;
  let elevationFailed = false;

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
        if (allowElevation) {
          elevationFailed = !elevateSymlink(srcPath, targetPath);
          if (!elevationFailed) return { ok: true, changed: true, linkType: 'symlink', reason: null };
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
    reason: describeLinkFailure(lastError, { srcPath, targetPath, mustBeSymlink, attempts, elevationFailed }),
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
    elevationFailed,
  }: {
    srcPath: string;
    targetPath: string;
    mustBeSymlink: boolean;
    attempts: LinkType[];
    elevationFailed: boolean;
  }
): string {
  const lines = [
    `无法建立目录链接：${describeError(error)}`,
    `  源目录：${srcPath}`,
    `  目标：  ${targetPath}`,
    `  尝试过：${attempts.join(' / ')}`,
  ];

  if (elevationFailed) {
    // 用户刚在 UAC 弹窗点了「否」或超时，再建议「用管理员身份运行终端」是无效的。
    lines.push('  UAC 提权被拒绝或超时：请重新运行并在弹窗点「是」，或预先开启 Windows 开发者模式。');
    lines.push('  插件目录必须是真 symlink，不能用 junction 兜底（思源 Go 运行时按 ModeSymlink 判定）。');
    return lines.join('\n');
  }

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
