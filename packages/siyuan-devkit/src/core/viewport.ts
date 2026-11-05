/**
 * 视口预设的唯一来源（core 内）。
 *
 * 之前 session.ts 有 1600x1000 的 DEFAULT_VIEWPORT、siyuan.ts 有 390x844 的
 * MOBILE_VIEWPORT，而 CLI 又把两者硬编码成 '1600x1000@1' / '390x844@3' 字符串。
 * 现在 session.ts 从这里取，siyuan.ts 只做兼容重导出；CLI 应改为 import 这两个常量。
 */
export interface ResolvedViewport {
  width: number;
  height: number;
  /** 一定有一个 DPR：移动端判定与报告都依赖它，不用 puppeteer 的可选 Viewport。 */
  deviceScaleFactor: number;
}

/** 桌面缺省：够放思源的停靠栏 + 编辑器 + 面板。 */
export const DEFAULT_VIEWPORT: ResolvedViewport = { width: 1600, height: 1000, deviceScaleFactor: 1 };

/** 移动端预设：390x844 覆盖主流手机宽度，DPR 3 对齐真机。 */
export const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;
