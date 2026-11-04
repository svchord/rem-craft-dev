/**
 * CLI 参数解析的小工具。
 *
 * 各子命令共享一套「裸参数」解析：本包的命令行里有**令牌名本身以 `--` 开头**
 * 这种形状（`--rc-brand-8`），不能用通用的 flag 解析器，所以统一在这里
 * 用「已知选项白名单 + 其余当位置参数」的规则。
 */
/** 解析结果。 */
export interface ParsedArgs {
    /** 带值的选项，可重复。 */
    values: Record<string, string[]>;
    /** 布尔选项。 */
    flags: Set<string>;
    /** 其余位置参数。 */
    positional: string[];
}
/** 解析选项。 */
export interface ParseSpec {
    /** 需要取值的选项名（如 `--frontend`）。 */
    valueFlags?: readonly string[];
    /** 纯布尔选项名（如 `--attach`）。 */
    booleanFlags?: readonly string[];
}
/**
 * 解析 argv。
 *
 * 不在白名单里的 `--xxx` 一律当位置参数——令牌名就是这种形状。
 */
export declare function parseArgs(argv: string[], spec?: ParseSpec): ParsedArgs;
/** 取某个选项的最后一个值。 */
export declare function lastValue(parsed: ParsedArgs, name: string): string | undefined;
/** 取某个选项的所有值。 */
export declare function allValues(parsed: ParsedArgs, name: string): string[];
/** 是否要打印帮助。 */
export declare function wantsHelp(argv: string[]): boolean;
//# sourceMappingURL=cli-args.d.ts.map