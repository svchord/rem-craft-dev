/**
 * 颜色计算：WCAG 对比度。纯函数，可单测。
 *
 * 只提供能力，不预设阈值——多少算够由调用方决定。
 */
/** RGB 三元组，各通道 0–255。 */
export type Rgb = [number, number, number];
/** "32 32 36" / "rgb(32 32 36)" / "#202024" → [32,32,36]；解析不了返回 null。 */
export declare function parseColor(value: string | null | undefined): Rgb | null;
/** WCAG 相对亮度。 */
export declare function luminance([r, g, b]: Rgb): number;
/** WCAG 对比度，1–21 的两位小数；任一侧解析不了返回 null。 */
export declare function contrastRatio(foreground: string | null | undefined, background: string | null | undefined): number | null;
//# sourceMappingURL=color.d.ts.map