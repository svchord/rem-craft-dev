/** 端点文件目录（机器级，不在任何项目目录里）。 */
export declare const CONTROL_DIR: string;
/** 一个 dev 会话对外暴露的信息。 */
export interface DevSessionInfo {
    /** CDP WebSocket 端点。 */
    ws: string;
    /** 该会话所属项目目录。 */
    cwd: string;
    /** 被测类型（theme / plugin / ...）。 */
    kind: string;
    /** 被测对象名。 */
    name: string;
    /** 拥有该会话的进程。 */
    pid?: number;
}
/** 控制服务句柄。 */
export interface ControlServer {
    port: number;
    stop(): void;
}
/** 发现结果。 */
export type DiscoverResult = ({
    ok: true;
} & DevSessionInfo) | {
    ok: false;
    reason: string;
    candidates: Array<Pick<DevSessionInfo, 'cwd' | 'kind' | 'name' | 'pid'>>;
};
/**
 * 起控制服务，由 dev 进程持有。
 *
 * @param info 客户端拿到的会话信息
 */
export declare function startControlServer(info: Omit<DevSessionInfo, 'pid'>): Promise<ControlServer>;
/**
 * 找可复用的 dev 会话。
 *
 * @param cwd 优先选这个项目启动的会话
 */
export declare function discover({ cwd }?: {
    cwd?: string;
}): Promise<DiscoverResult>;
/** 供测试/诊断：当前登记的端点文件（不校验存活）。 */
export declare function endpointFiles(): string[];
//# sourceMappingURL=control-server.d.ts.map