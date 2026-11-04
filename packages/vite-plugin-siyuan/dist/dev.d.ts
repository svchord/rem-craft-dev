import type { BuildCommand } from './build.ts';
import type { DevSession } from './dev-session.ts';
import type { Frontend } from './siyuan.ts';
/** startDev 的选项。 */
export interface StartDevOptions {
    /** 已注册的类型名（theme / plugin / 自定义）。 */
    kind: string;
    /** 名字；缺省从该类型的清单读。 */
    name?: string | null;
    /** 项目目录。 */
    cwd?: string;
    /** 是否无头。 */
    headless?: boolean;
    /** 打开哪个前端。 */
    frontend?: Frontend;
    /** 是否建立链接。 */
    link?: boolean;
    /** 自定义构建命令；不给则用 vite。 */
    buildCommand?: string | BuildCommand | null;
    /** 产物目录覆盖。 */
    outDir?: string | null;
    /** 日志回调。 */
    log?: (message: string) => void;
}
/** 开发会话（在会话层之上多一个构建进程）。 */
export interface DevHandle extends DevSession {
    stop(): Promise<void>;
}
/**
 * 开发会话。
 */
export declare function startDev({ kind, name, cwd, headless, frontend, link, buildCommand, outDir, log, }: StartDevOptions): Promise<DevHandle>;
//# sourceMappingURL=dev.d.ts.map