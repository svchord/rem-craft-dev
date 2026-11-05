/**
 * 颜色计算：WCAG 对比度。纯函数，可单测；只提供能力，不预设阈值。
 */
/** RGB 三元组，各通道 0–255。 */
export type Rgb = [number, number, number];

/** 把三个通道收成 Rgb；NaN / 越界一律返回 null，不让脏值流进亮度计算。 */
function toRgb(channels: number[]): Rgb | null {
  const r = channels[0];
  const g = channels[1];
  const b = channels[2];
  if (r === undefined || g === undefined || b === undefined) return null;
  if (![r, g, b].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) return null;
  return [r, g, b];
}

/**
 * "32 32 36" / "rgb(32 32 36)" / "#202024" → [32,32,36]；
 * 解析不了**或通道越界**都返回 null（之前 `#gggggg` 会返回 [NaN,NaN,NaN]）。
 */
export function parseColor(value: string | null | undefined): Rgb | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) return toRgb([...hex].map((char) => parseInt(char + char, 16)));
    if (hex.length === 6) return toRgb([0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)));
    return null;
  }

  const numbers = text.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;
  return toRgb(numbers.slice(0, 3).map(Number));
}

/** WCAG 相对亮度。 */
export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度，1–21 的两位小数；任一侧解析不了返回 null。 */
export function contrastRatio(
  foreground: string | null | undefined,
  background: string | null | undefined
): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
