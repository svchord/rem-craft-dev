/**
 * 读主题名：从清单的 name 字段取。
 *
 * 缺省按「当前工作目录下 public/theme.json → dist/theme.json」找。
 * 与 targets.ts 的 readManifestName 是同一件事，但那边要造 Target、
 * 这里只想显示个名字；为避免循环依赖，各自保留一小段读文件的代码。
 *
 * @param manifestPaths 候选清单路径，按顺序试
 * @param fallback      都读不到时的兜底值（缺省 null，表示「不知道」）
 */
export declare function readThemeName(manifestPaths?: string[], fallback?: string | null): string | null;
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
 *
 * 允许前缀匹配：装了发布版 `X` 而本地目录叫 `X Dev` 时仍是同一个主题，
 * 但要把「测的不是 dev 目录」讲清楚，否则结论会被张冠李戴。
 *
 * themeName 为空时只判断「有没有挂自定义主题」，不比对具体名字。
 */
export declare function judgeMount(href: string | null, themeName?: string | null): MountJudgement;
//# sourceMappingURL=theme.d.ts.map