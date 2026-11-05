/**
 * CLI 共用的目标解析。
 *
 * measure 与 audit 都要「按 --kind / --plugin / --css 或目录推断」造 Target，
 * 之前 audit 里为绕过这个又写了一份 resolveTargetFrom。集中在这一处。
 */
import { createTarget } from '../core/targets.ts';
import type { Target } from '../core/targets.ts';
import { detectTargetType } from '../core/target-types.ts';
import { UserFacingError, requireRecoverable } from '../core/errors.ts';
import { lastValue } from './cli-args.ts';
import type { ParsedArgs } from './cli-args.ts';

/**
 * createTarget 失败的统一处理：只把「清单缺 name」这类可恢复的输入问题降级成
 * target=null（纯页面测量仍可做），其余（含编程错误）如实抛出。
 * 以前五处裸 catch{return null} 连 TypeError 都吞，结果命令退出 0、
 * mount 检查跳过，agent 拿到一份看似正常的读数却量错了对象。
 */
function createTargetOrReport(kind: string, options: Parameters<typeof createTarget>[1]): Target {
  try {
    return createTarget(kind, options);
  } catch (cause) {
    requireRecoverable(cause);
    throw new UserFacingError(
      `无法按 --kind ${kind} 解析被测对象：${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

/** 已解析过参数时用这个（measure 与 audit 都先 parseArgs 再调）。 */
export function resolveTargetFromParsed(parsed: ParsedArgs): Target | null {
  const kindFlag = lastValue(parsed, '--kind');
  const pluginName = lastValue(parsed, '--plugin');
  const cssPath = lastValue(parsed, '--css');

  // 目标类型：--kind 优先；兼容 --plugin / --css 写法。
  const kind = kindFlag ?? (pluginName ? 'plugin' : cssPath ? 'theme' : null);
  if (kind) {
    return createTargetOrReport(kind, {
      name: pluginName ?? undefined,
      cssPath: cssPath ?? undefined,
    });
  }

  const detected = detectTargetType(process.cwd());
  if (!detected.ok) return null;
  return createTargetOrReport(detected.kind, { cssPath: cssPath ?? undefined });
}

/** 从计划里的 target 字段造目标；没给就退回命令行推断。 */
export function resolveTargetFromPlan(
  planTarget: { kind?: string; name?: string; css?: string; plugin?: string } | null | undefined,
  parsed: ParsedArgs
): Target | null {
  const kind = planTarget?.kind;
  if (kind) {
    return createTargetOrReport(kind, {
      name: planTarget.name ?? undefined,
      cssPath: planTarget.css ?? undefined,
    });
  }
  if (planTarget?.plugin) return createTargetOrReport('plugin', { name: planTarget.plugin });
  if (planTarget?.css) return createTargetOrReport('theme', { cssPath: planTarget.css });
  return resolveTargetFromParsed(parsed);
}
