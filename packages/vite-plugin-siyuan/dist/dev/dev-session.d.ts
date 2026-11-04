import type { Browser, Page } from 'puppeteer-core';
import type { ControlServer } from '../core/control-server.ts';
import type { Frontend } from '../core/siyuan.ts';
import type { Target, TargetBuildConfig } from '../core/targets.ts';
/** 开局的日志函数。 */
export type Logger = (message: string) => void;
/** startDevSession 的选项。 */
export interface StartDevSessionOptions {
    /** 已注册的类型名。 */
    kind: string;
    /** 名字；缺省从该类型的清单读。 */
    name?: string | null;
    /** 项目目录。 */
    cwd?: string;
    /** 产物目录；缺省取类型描述符的值。 */
    outDir?: string | null;
    /** 是否建立链接，缺省 true。 */
    link?: boolean;
    /** 是否无头。 */
    headless?: boolean;
    /** 打开哪个前端。 */
    frontend?: Frontend;
    /** 日志回调。 */
    log?: Logger;
    /**
     * 是否自己监听产物目录。
     * 插件形态由宿主 vite 的 writeBundle 驱动，传 false。
     */
    watch?: boolean;
}
/** 开发会话句柄。 */
export interface DevSession {
    target: Target;
    buildConfig: TargetBuildConfig;
    browser: Browser;
    page: Page;
    kernelPort: number;
    control: ControlServer;
    /** 外部（插件形态的 writeBundle）直接把变更文件喂进来。 */
    notifyChange(filenames: string | string[]): void;
    stop(): Promise<void>;
}
/**
 * 开会话。产物目录应当已经存在（或即将被构建写入）。
 */
export declare function startDevSession({ kind, name, cwd, outDir, link, headless, frontend, log, watch, }: StartDevSessionOptions): Promise<DevSession>;
//# sourceMappingURL=dev-session.d.ts.map