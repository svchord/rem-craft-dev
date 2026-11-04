import type { AuditPlan } from './audit.ts';
/** 默认的配置文件名。 */
export declare const DEFAULT_CONFIG_NAME = ".siyuan-audit.json";
/** 加载结果。 */
export interface LoadedConfig {
    /** 实际读到的文件；没找到为 null。 */
    path: string | null;
    /** 配置内容；没找到为 {}。 */
    config: AuditPlan;
    /** 是否用了自动发现（而非显式 --config）。 */
    discovered: boolean;
}
/**
 * 找配置文件。
 *
 * @param explicit `--config` 给的值；给了就只用它（找不到要报错）
 * @param cwd      从哪个目录开始找（只找这一层，不向上递归）
 */
export declare function loadConfig(explicit: string | null, cwd?: string): Promise<LoadedConfig>;
/** 命令行给出的覆盖值。缺省（undefined）表示「没传，用配置文件或默认值」。 */
export interface PlanOverrides {
    frontend?: string;
    viewport?: string;
    attach?: boolean;
    target?: {
        kind?: string;
        name?: string;
        css?: string;
        plugin?: string;
    };
    setup?: string[];
    actions?: string[];
    tokens?: string[];
    styles?: string[];
    counts?: string[];
    boxes?: string[];
    props?: string[];
}
/**
 * 合并配置与命令行覆盖。
 *
 * 规则：**显式传了的命令行参数整体替换配置文件里的同名字段**（不是逐项合并）。
 * 这样语义可预测——`--tokens a,b` 就是「只查 a 和 b」，而不是「在文件基础上追加」。
 * 需要追加时把要查的写全。
 */
export declare function mergePlan(config: AuditPlan, overrides: PlanOverrides): AuditPlan;
//# sourceMappingURL=audit-config.d.ts.map