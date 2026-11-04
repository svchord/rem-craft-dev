/** 找本机 Chrome/Edge；CHROME_PATH 覆盖。 */
export declare function findChrome(): string;
/**
 * 找运行中的 kernel 端口。
 *
 * 顺序：SIYUAN_PORT → 按 PID 查 port.json → 端口映射里的最后一个 → 6806~6809 兜底。
 */
export declare function findKernelPort(): Promise<number>;
/** 前端入口。桌面与移动是两个独立构建，路径不同。 */
declare const FRONTENDS: {
    readonly desktop: 'desktop';
    readonly mobile: 'mobile';
};
export type Frontend = keyof typeof FRONTENDS;
/** 拼前端 URL，带随机参数避免缓存。 */
export declare function frontendUrl(port: number, frontend?: Frontend): string;
/** 移动端视口预设：390x844 覆盖主流手机宽度。 */
export declare const MOBILE_VIEWPORT: {
    readonly width: 390;
    readonly height: 844;
    readonly deviceScaleFactor: 3;
    readonly isMobile: true;
    readonly hasTouch: true;
};
/**
 * 找思源工作区路径（用于定位 `data/plugins/`、`data/themes/`）。
 *
 * 只读桌面端记录的 workspace.json，不启动内核——审计插件 CSS 时插件可能
 * 根本没运行，不能依赖 kernel 可用。找不到返回 null，调用方自行兜底。
 */
export declare function findWorkspaceDir(): string | null;
export {};
//# sourceMappingURL=siyuan.d.ts.map