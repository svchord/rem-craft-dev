/**
 * CLI 参数解析的小工具。
 *
 * 各子命令共享一套「裸参数」解析：本包的命令行里有**令牌名本身以 `--` 开头**
 * 这种形状（`--rc-brand-8`），不能用通用的 flag 解析器，所以统一在这里
 * 用「已知选项白名单 + 其余当位置参数」的规则。
 */
/**
 * 解析 argv。
 *
 * 不在白名单里的 `--xxx` 一律当位置参数——令牌名就是这种形状。
 */
export function parseArgs(argv, spec = {}) {
    const valueFlags = new Set(spec.valueFlags ?? []);
    const booleanFlags = new Set(spec.booleanFlags ?? []);
    const values = {};
    const flags = new Set();
    const positional = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === undefined)
            continue;
        if (booleanFlags.has(arg)) {
            flags.add(arg);
            continue;
        }
        if (valueFlags.has(arg)) {
            const next = argv[index + 1];
            if (next === undefined)
                throw new Error(`${arg} 需要一个参数`);
            (values[arg] ??= []).push(next);
            index += 1;
            continue;
        }
        positional.push(arg);
    }
    return { values, flags, positional };
}
/** 取某个选项的最后一个值。 */
export function lastValue(parsed, name) {
    return parsed.values[name]?.at(-1);
}
/** 取某个选项的所有值。 */
export function allValues(parsed, name) {
    return parsed.values[name] ?? [];
}
/** 是否要打印帮助。 */
export function wantsHelp(argv) {
    return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}
//# sourceMappingURL=cli-args.js.map