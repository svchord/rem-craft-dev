/** 所有类型共有的能力名，用于注册时校验。 */
const REQUIRED_CAPABILITIES = [
    'manifestName',
    'installSubdir',
    'outDir',
    'artifact',
    'expectedFiles',
    'matchArtifact',
    'reload',
    'resolveCss',
    'mountState',
];
/** 类型注册表。key 是类型名（theme / plugin / 未来新增）。 */
const TYPES = new Map();
/**
 * 注册一类被测对象。
 *
 * 缺能力会在**注册时**就抛错，而不是等到运行到一半才炸。
 */
export function registerTargetType(kind, descriptor, options = {}) {
    const record = descriptor;
    const missing = REQUIRED_CAPABILITIES.filter((name) => typeof record[name] !== 'function');
    if (missing.length) {
        throw new Error(`注册被测类型 ${kind} 失败：缺少 ${missing.join('、')}\n` +
            '  这些能力是开发链路必需的，缺一个就会让编排层长出类型分支。');
    }
    TYPES.set(kind, { kind, detect: options.detect ?? null, descriptor });
    return kind;
}
/** 已注册的类型名。 */
export function targetTypes() {
    return [...TYPES.keys()];
}
/** 取某个类型的注册项；未注册时把可用类型列出来。 */
export function targetType(kind) {
    const found = TYPES.get(kind);
    if (!found) {
        throw new Error(`未知的被测类型：${kind}（已注册：${targetTypes().join(' / ')}）`);
    }
    return found;
}
/**
 * 从项目目录推断类型：看 public/ 下存在哪份清单。
 *
 * 这是「不用在引用项目里写配置」的关键——插件不带 kind 时，
 * 靠 theme.json / plugin.json 的存在与否自己判断。
 */
export function detectTargetType(cwd) {
    const matches = [];
    for (const entry of TYPES.values()) {
        if (entry.detect?.(cwd))
            matches.push(entry.kind);
    }
    if (matches.length === 1)
        return { ok: true, kind: matches[0] };
    if (matches.length === 0) {
        return {
            ok: false,
            reason: `在 ${cwd} 的 public/ 下找不到任何已知清单（${targetTypes().join(' / ')}），请用 kind 显式指定类型`,
        };
    }
    return {
        ok: false,
        reason: `同时匹配到多种类型：${matches.join('、')}，请用 kind 指定`,
    };
}
//# sourceMappingURL=target-types.js.map