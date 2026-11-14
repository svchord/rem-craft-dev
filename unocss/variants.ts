/* 平台变体：p:windows / p:linux / p:desktop / p:mobile 等。 */
export const platformVariants = [
  (matcher: string) => {
    const m = matcher.match(
      /^p:((?:desktop|mobile|windows|linux|mac|android|ios|harmony)(?::(?:desktop|mobile|windows|linux|mac|android|ios|harmony))*):(.+)$/
    );
    if (!m) return matcher;
    const [, platforms, rest] = m;
    const groups: Record<string, string[]> = {
      desktop: ['windows', 'linux', 'mac'],
      mobile: ['android', 'ios', 'harmony'],
    };
    const list = [...new Set(platforms.split(':').flatMap((platform) => groups[platform] ?? [platform]))];
    return {
      matcher: rest,
      selector: (s: string) => ':is(' + list.map((platform) => '.body--' + platform).join(', ') + ') ' + s,
    };
  },
];

/* 风格变体：s:m3 / s:fluent / s:shadcn；无 data-rc-style 时按 m3 处理。 */
export const styleVariants = [
  (matcher: string) => {
    const m = matcher.match(/^s:([a-z0-9-]+):(.+)$/);
    if (!m) return matcher;
    const [, style, rest] = m;
    return {
      matcher: rest,
      selector: (s: string) =>
        style === 'm3' ? 'html:not([data-rc-style]) ' + s : '[data-rc-style="' + style + '"] ' + s,
    };
  },
];
