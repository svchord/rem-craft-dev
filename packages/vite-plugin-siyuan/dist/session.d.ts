import type { Browser, Page } from 'puppeteer-core';
import type { Frontend } from './siyuan.ts';
/**
 * 本包自己的视口类型。
 *
 * 不用 puppeteer 的 `Viewport`：它的 `deviceScaleFactor` 是可选的，
 * 而我们需要「一定有一个 DPR」来做移动端判定与报告。
 */
export interface ResolvedViewport {
    width: number;
    height: number;
    deviceScaleFactor: number;
}
/**
 * `宽x高[@DPR]`，缺省给桌面视口。
 *
 * 第二个参数用「有没有传」判断而不是默认参数：调用方显式传 undefined
 * 表示「本前端不要文件级视口，用前端预设」，默认参数会把这种意图静默覆盖掉。
 * TS 里用 `arguments.length` 不划算，改成用哨兵重载：传 `null` 表示显式无回退。
 */
export declare function parseViewport(value?: string | null, fallback?: ResolvedViewport | null): ResolvedViewport;
/** 按前端取视口：给了就用，没给则移动端用手机预设、桌面端用桌面预设。 */
export declare function viewportFor(frontend: Frontend, viewport?: ResolvedViewport | null): ResolvedViewport;
/** 测量会话。 */
export interface Session {
    browser: Browser;
    page: Page;
    /** 是否复用了正在跑的 dev 浏览器。 */
    attached: boolean;
    frontend: Frontend;
    viewport: ResolvedViewport;
    dispose(): Promise<void>;
}
/** 开会话的选项。 */
export interface CreateSessionOptions {
    frontend?: Frontend;
    viewport?: ResolvedViewport | null;
    /** 复用正在跑的 dev 会话（省一次启动，且量的是你眼前那个窗口）。 */
    attach?: boolean;
}
/**
 * 打开会话。
 *
 * `attach` 时复用 `vite-plugin-siyuan` 暴露的浏览器；找不到就新开无头 Chrome。
 *
 * 端点通过本地控制服务发现（见 control-server.ts），不是项目目录下的
 * 相对文件——在插件项目起的 dev 浏览器，也能被主题项目的 measure 复用。
 */
export declare function createSession({ frontend, viewport, attach, }?: CreateSessionOptions): Promise<Session>;
//# sourceMappingURL=session.d.ts.map