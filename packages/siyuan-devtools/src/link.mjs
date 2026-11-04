/**
 * 把构建产物目录链接到思源的安装目录，让思源直接读你的 `dev/`。
 *
 * 为什么不复制：复制要每次构建后重来一遍，且思源读的是副本，改完不生效。
 * 链接让 `dev/` 就是 `<workspace>/data/<themes|plugins>/<name>`，构建产物落盘即生效。
 *
 * Windows 上建目录链接有两种方式，差别是真实的：
 *
 *   symlink   真正的符号链接，需要开发者模式或管理员权限；思源（Go）按
 *             `ModeSymlink` 识别它。
 *   junction  目录联接，普通用户就能建；但 Go 的 `Lstat` 报的是
 *             `ModeDir|ModeIrregular`，**不认作符号链接**。
 *
 * 实测：本仓主题用 junction 能正常加载（`data/themes/Rem Craft Dev` 就是
 * junction），所以主题这边 junction 是可用的兜底。插件这边按 symlink 优先，
 * 建不出来时**如实报错并说明原因**，不擅自换成 junction 假装成功——真跑不起来
 * 时沉默比报错更糟。
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 比较两个路径是否指向同一处（忽略分隔符方向与末尾斜杠）。 */
export function samePath(left, right) {
  const normalize = (value) => resolve(value).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * 检查链接现状，不修改任何东西。
 *
 * @returns {{ state: 'absent'|'linked'|'conflict', target: string|null, reason: string|null }}
 *   absent   目标不存在，可以建
 *   linked   已经是链接，且指向 src
 *   conflict 存在但不是指向 src 的链接（普通目录，或指向别处）
 */
export function inspectLink(srcPath, targetPath) {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (cause) {
    if (cause.code === 'ENOENT') return { state: 'absent', target: null, reason: null };
    throw cause;
  }

  if (!stat.isSymbolicLink()) {
    // 注意：junction 在 Windows 上 lstat 也报 isSymbolicLink() === true，
    // 所以走到这里一定是真目录或文件。
    return {
      state: 'conflict',
      target: null,
      reason: targetPath + ' 已存在且不是链接（是个普通目录/文件）',
    };
  }

  const existing = resolve(dirname(targetPath), readlinkSync(targetPath));
  if (samePath(existing, srcPath)) {
    return { state: 'linked', target: existing, reason: null };
  }
  return { state: 'conflict', target: existing, reason: targetPath + ' 已链接到别处：' + existing };
}

/**
 * 建立链接（已存在且指向同一处时是幂等的）。
 *
 * @param srcPath      产物目录（会被创建，若不存在）
 * @param targetPath   思源安装目录下的目标路径
 * @param mode         'symlink' | 'junction' | 'auto'
 *                     auto：先试 symlink，权限不足时对 theme 退 junction；
 *                     对 plugin 不退——Go 不认 junction，退过去只会让思源静默加载不到。
 * @param kind         'theme' | 'plugin'，决定 auto 的兜底行为
 * @returns {{ ok: boolean, changed: boolean, linkType: string|null, reason: string|null }}
 */
export function ensureLink(srcPath, targetPath, { mode = 'auto', kind = 'theme' } = {}) {
  mkdirSync(srcPath, { recursive: true });

  const current = inspectLink(srcPath, targetPath);
  if (current.state === 'linked') {
    return { ok: true, changed: false, linkType: detectLinkType(targetPath), reason: null };
  }
  if (current.state === 'conflict') {
    return { ok: false, changed: false, linkType: null, reason: current.reason };
  }

  mkdirSync(dirname(targetPath), { recursive: true });

  const attempts = mode === 'auto' ? (kind === 'plugin' ? ['symlink'] : ['symlink', 'junction']) : [mode];
  let lastError = null;

  for (const linkType of attempts) {
    try {
      symlinkSync(srcPath, targetPath, linkType === 'junction' ? 'junction' : 'dir');
      return { ok: true, changed: true, linkType, reason: null };
    } catch (cause) {
      lastError = cause;
      // 权限不足才值得换一种方式重试；其它错误（目标已存在等）重试也没用。
      if (cause.code !== 'EPERM' && cause.code !== 'EACCES') break;
    }
  }

  return {
    ok: false,
    changed: false,
    linkType: null,
    reason: describeLinkFailure(lastError, { srcPath, targetPath, kind, attempts }),
  };
}

/** 读已存在链接的类型，仅用于日志。 */
export function detectLinkType(targetPath) {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  // Windows 上 junction 的 readlink 返回绝对路径，symlink 通常是原样存进去的值，
  // 两者不可靠区分；用 EPERM 特征判断需要重建，这里只区分「是不是链接」。
  return process.platform === 'win32' ? 'link' : 'symlink';
}

function describeLinkFailure(error, { srcPath, targetPath, kind, attempts }) {
  const lines = [];
  lines.push('无法建立目录链接：' + (error?.message ?? '未知错误'));
  lines.push('  源目录：' + srcPath);
  lines.push('  目标：  ' + targetPath);
  lines.push('  尝试过：' + attempts.join(' / '));

  if (process.platform === 'win32') {
    lines.push('  解决办法（任选其一）：');
    lines.push('    1. 开启 Windows 开发者模式：设置 → 系统 → 开发者选项');
    lines.push('    2. 用管理员身份运行终端后重试');
    if (kind === 'plugin') {
      lines.push('  注意：插件目录不能用 junction 兜底——思源的 Go 运行时按符号链接判定，');
      lines.push('         junction 会被当成普通目录，插件静默加载不到。');
    }
  } else {
    lines.push('  解决办法：修正 ' + dirname(targetPath) + ' 的写权限后重试');
  }
  return lines.join('\n');
}

/** 链接建好后，确认思源该读的文件真的在（防止链到空目录还以为成功）。 */
export function checkLinkedFiles(targetPath, expectedFiles) {
  const missing = expectedFiles.filter((file) => !existsSync(resolve(targetPath, file)));
  return { ok: missing.length === 0, missing };
}
