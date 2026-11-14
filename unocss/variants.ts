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
      selector: (s: string) => list.map((platform) => '.body--' + platform + ' ' + s).join(', '),
    };
  },
];
