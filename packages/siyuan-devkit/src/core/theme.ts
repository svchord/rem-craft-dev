/**
 * 主题身份与挂载判定：只读文件 + 纯字符串处理，不碰浏览器。
 *
 * 挂载判定只有本文件一份：theme 描述符的 mountState() 直接调 judgeMount()。
 * 之前描述符另写一份简单解析，行为不一致（judgeMount 支持前缀匹配，那份不支持）。
 *
 * 清单读名字也只有一份：targets.ts / open 的 readThemeName / readManifestName
 * 都走同一个 readNameFromCandidates，不再各自复制读文件 + JSON.parse。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireRecoverable } from './errors.ts';

/**
 * 前缀匹配允许的最短名字。
 * 发布版 `X` 与本地目录 `X Dev` 要算同一个主题；但短名（如 `a`、`ab`）之间
 * 前缀相同纯属巧合，至少 4 个字符才允许前缀匹配，避免张冠李戴。
 */
const MOUNT_PREFIX_MIN_LENGTH = 4;

/** 从若干候选清单里读 name；文件不存在/无权限/JSON 坏了就试下一个，其余错误重抛。 */
function readNameFromCandidates(paths: readonly string[], fallback: string | null): string | null {
  for (const file of paths) {
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (data && typeof data === 'object' && 'name' in data) {
        const name: unknown = data.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
    } catch (cause) {
      requireRecoverable(cause);
    }
  }
  return fallback;
}

/** 读被测对象清单里的 name（public/ 优先，回退 dist/）；缺了返回 null 不猜默认值。 */
export function readManifestName(cwd: string, manifest: string): string | null {
  return readNameFromCandidates([join(cwd, 'public', manifest), join(cwd, 'dist', manifest)], null);
}

/** open 命令只想显示个主题名：同一份实现，允许自定义候选路径与兜底值。 */
export function readThemeName(manifestPaths?: string[], fallback: string | null = null): string | null {
  return readNameFromCandidates(manifestPaths ?? ['./public/theme.json', './dist/theme.json'], fallback);
}

/** 目录名与 manifest 的 name 一致；比较时忽略大小写与空格/连字符的写法差异。 */
const normalizeThemeName = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, '');

/** 挂载判定结果。 */
export interface MountJudgement {
  /** 是否算「挂的是这个主题」。 */
  ok: boolean;
  /** 是否精确同名（false 可能是前缀匹配）。 */
  exact: boolean;
  /** 实际加载的主题名。 */
  loaded: string | null;
  reason: string | null;
}

/**
 * 判断页面挂的是不是指定主题。
 * 允许前缀匹配（发布版 X 与本地 X Dev 算同一个），但要如实报出 loaded。
 * themeName 为空时只判断「有没有挂自定义主题」，不比对具体名字。
 */
export function judgeMount(href: string | null, themeName?: string | null): MountJudgement {
  if (!href) {
    return {
      ok: false,
      exact: false,
      loaded: null,
      reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）',
    };
  }

  const segment = href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
  if (!segment) {
    return { ok: false, exact: false, loaded: null, reason: `themeStyle 的 href 不是主题目录路径：${href}` };
  }

  const loaded = decodeURIComponent(segment);

  if (!themeName) {
    return { ok: true, exact: false, loaded, reason: null };
  }

  const expected = normalizeThemeName(themeName);
  const actual = normalizeThemeName(loaded);
  const exact = actual === expected;
  const ok =
    exact ||
    (actual.length >= MOUNT_PREFIX_MIN_LENGTH && expected.startsWith(actual)) ||
    (expected.length >= MOUNT_PREFIX_MIN_LENGTH && actual.startsWith(expected));

  return { ok, exact, loaded, reason: ok ? null : `宿主加载的是 ${loaded}，不是 ${themeName}` };
}
