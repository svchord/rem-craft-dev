/**
 * CLI 共用的目标解析。
 *
 * measure 与 audit 都要「按 --kind / --plugin / --css 或目录推断」造 Target，
 * 之前 audit 里为绕过这个又写了一份 resolveTargetFrom。集中在这一处。
 */
import { createTarget } from '../core/targets.ts';
import type { Target } from '../core/targets.ts';
import { detectTargetType } from '../core/target-types.ts';
import { lastValue, parseArgs } from './cli-args.ts';
import type { ParsedArgs } from './cli-args.ts';

/** 这些选项用于从命令行推断被测目标。 */
export const TARGET_VALUE_FLAGS = ['--kind', '--css', '--plugin'] as const;

/** 按当前目录 / 显式参数决定被测目标。 */
export function resolveTargetFromArgs(argv: string[]): Target | null {
  const parsed: ParsedArgs = parseArgs(argv, { valueFlags: TARGET_VALUE_FLAGS });
  return resolveTargetFromParsed(parsed);
}

/** 已解析过参数时用这个（audit 里已经有 parsed）。 */
export function resolveTargetFromParsed(parsed: ParsedArgs): Target | null {
  const kindFlag = lastValue(parsed, '--kind');
  const pluginName = lastValue(parsed, '--plugin');
  const cssPath = lastValue(parsed, '--css');

  // 目标类型：--kind 优先；兼容 --plugin / --css 写法。
  const kind = kindFlag ?? (pluginName ? 'plugin' : cssPath ? 'theme' : null);
  if (kind) {
    try {
      return createTarget(kind, {
        name: pluginName ?? undefined,
        cssPath: cssPath ?? undefined,
      });
    } catch {
      return null;
    }
  }

  const detected = detectTargetType(process.cwd());
  if (!detected.ok) return null;
  try {
    return createTarget(detected.kind, { cssPath: cssPath ?? undefined });
  } catch {
    // 清单里没有 name 也不该挡住纯页面测量
    return null;
  }
}

/** 从计划里的 target 字段造目标；没给就退回命令行推断。 */
export function resolveTargetFromPlan(
  planTarget: { kind?: string; name?: string; css?: string; plugin?: string } | null | undefined,
  parsed: ParsedArgs
): Target | null {
  const kind = planTarget?.kind;
  if (kind) {
    try {
      return createTarget(kind, {
        name: planTarget.name ?? undefined,
        cssPath: planTarget.css ?? undefined,
      });
    } catch {
      return null;
    }
  }
  if (planTarget?.plugin) {
    try {
      return createTarget('plugin', { name: planTarget.plugin });
    } catch {
      return null;
    }
  }
  if (planTarget?.css) {
    try {
      return createTarget('theme', { cssPath: planTarget.css });
    } catch {
      return null;
    }
  }
  return resolveTargetFromParsed(parsed);
}
