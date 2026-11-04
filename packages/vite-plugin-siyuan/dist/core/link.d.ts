/** 链接类型。 */
export type LinkType = 'symlink' | 'junction';
/** 链接现状。 */
export interface LinkState {
    /** absent 可建；linked 已就绪；conflict 存在但不是指向 src 的链接。 */
    state: 'absent' | 'linked' | 'conflict';
    target: string | null;
    reason: string | null;
}
/** 建链接的结果。 */
export interface EnsureLinkResult {
    ok: boolean;
    changed: boolean;
    linkType: string | null;
    reason: string | null;
}
/** 比较两个路径是否指向同一处（忽略分隔符方向与末尾斜杠）。 */
export declare function samePath(left: string, right: string): boolean;
/**
 * 检查链接现状，不修改任何东西。
 */
export declare function inspectLink(srcPath: string, targetPath: string): LinkState;
/** 建链接的选项。 */
export interface EnsureLinkOptions {
    /**
     * auto：先试 symlink，权限不足时对 theme 退 junction；
     * 对 plugin 不退——Go 不认 junction，退过去只会让思源静默加载不到。
     */
    mode?: LinkType | 'auto';
    /** 被测类型，决定 auto 的兜底行为。 */
    kind?: string;
}
/**
 * 建立链接（已存在且指向同一处时是幂等的）。
 *
 * @param srcPath      产物目录（会被创建，若不存在）
 * @param targetPath   思源安装目录下的目标路径
 */
export declare function ensureLink(srcPath: string, targetPath: string, { mode, kind }?: EnsureLinkOptions): EnsureLinkResult;
/** 读已存在链接的类型，仅用于日志。 */
export declare function detectLinkType(targetPath: string): string | null;
/** 链接建好后，确认思源该读的文件真的在（防止链到空目录还以为成功）。 */
export declare function checkLinkedFiles(targetPath: string, expectedFiles: string[]): {
    ok: boolean;
    missing: string[];
};
//# sourceMappingURL=link.d.ts.map