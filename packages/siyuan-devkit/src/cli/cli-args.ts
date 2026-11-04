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
export function parseArgs(argv: string[], spec: ParseSpec = {}): ParsedArgs {
  const valueFlags = new Set(spec.valueFlags ?? []);
  const booleanFlags = new Set(spec.booleanFlags ?? []);
  const values: Record<string, string[]> = {};
  const flags = new Set<string>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (booleanFlags.has(arg)) {
      flags.add(arg);
      continue;
    }

    if (valueFlags.has(arg)) {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} 需要一个参数`);
      (values[arg] ??= []).push(next);
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  return { values, flags, positional };
}

/** 取某个选项的最后一个值。 */
export function lastValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.values[name]?.at(-1);
}

/** 取某个选项的所有值。 */
export function allValues(parsed: ParsedArgs, name: string): string[] {
  return parsed.values[name] ?? [];
}

/** 是否要打印帮助。 */
export function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}
