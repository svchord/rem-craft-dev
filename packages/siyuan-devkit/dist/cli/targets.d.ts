import type { Target } from '../core/targets.ts';
import type { ParsedArgs } from './cli-args.ts';
/** 这些选项用于从命令行推断被测目标。 */
export declare const TARGET_VALUE_FLAGS: readonly ['--kind', '--css', '--plugin'];
/** 按当前目录 / 显式参数决定被测目标。 */
export declare function resolveTargetFromArgs(argv: string[]): Target | null;
/** 已解析过参数时用这个（audit 里已经有 parsed）。 */
export declare function resolveTargetFromParsed(parsed: ParsedArgs): Target | null;
/** 从计划里的 target 字段造目标；没给就退回命令行推断。 */
export declare function resolveTargetFromPlan(planTarget: {
    kind?: string;
    name?: string;
    css?: string;
    plugin?: string;
} | null | undefined, parsed: ParsedArgs): Target | null;
//# sourceMappingURL=targets.d.ts.map