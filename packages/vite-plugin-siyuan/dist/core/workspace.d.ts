/** 一个工作区。 */
export interface Workspace {
    path: string;
}
/**
 * 从 workspace.json 读工作区路径列表。
 * 文件内容是一个字符串数组，元素就是工作区绝对路径。
 */
export declare function readWorkspaceManifest(): Workspace[];
/**
 * 列工作区：先问内核，问不到再读文件。
 *
 * 内核可用时优先用它——用户可能开着好几个工作区，文件里记录的未必是当前那个。
 * 内核不可用不是错误，退回文件即可（审计插件 CSS 时插件可能根本没运行）。
 */
export declare function listWorkspaces({ port }?: {
    port?: number | null;
}): Promise<Workspace[]>;
/** 解析安装目录的参数。 */
export interface ResolveInstallDirOptions {
    /** 类型名，只用于报错信息。 */
    kind: string;
    /** data 下的子目录，如 'themes' / 'plugins'。 */
    subdir: string;
    /** 覆盖安装目录的环境变量名，如 'SIYUAN_THEME_DIR'。 */
    dirEnv: string;
    /** 显式工作区路径（跳过探测）。 */
    workspace?: string | null;
    /** 内核端口（用于问工作区列表）。 */
    port?: number | null;
}
/**
 * 解析 `<workspace>/data/<subdir>`。
 *
 * 子目录名与环境变量名由**调用方**给（来自被测类型描述符），这里不写死：
 * 思源的安装目录不止 themes / plugins，widgets、icons 各有各的位置，
 * 写死在这里就意味着每加一种类型都要改这个文件。
 *
 * @returns 绝对路径；找不到时抛错而不是静默返回一个不存在的路径
 */
export declare function resolveInstallDir({ kind, subdir, dirEnv, workspace, port, }: ResolveInstallDirOptions): Promise<string>;
//# sourceMappingURL=workspace.d.ts.map