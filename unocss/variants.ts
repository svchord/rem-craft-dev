/*
 * 变体维度注册表：匹配一段前缀 → 生成选择器前缀。
 *
 * 选项的默认值等同于「没有该属性」，所以 opt:<name>:<默认值>: 走 :not([data-rc-<name>])。
 * 默认值来自 unocss/options.ts（构建期契约）。
 */
export interface Dimension {
  /** 必须有一个名为 rest 的捕获组，内容是这一层之后剩余的 utility。 */
  pattern: RegExp;
  build(match: RegExpMatchArray): ((selector: string) => string) | null;
}

export function createDimensionVariants(optionDefaults: Record<string, string>) {
  /** 单条件片段（不含 :root），多条件时拼成复合选择器。 */
  const optionCondition = (name: string, value: string): string =>
    optionDefaults[name] === value ? ':not([data-rc-' + name + '])' : '[data-rc-' + name + '="' + value + '"]';

  const dimensions: Dimension[] = [
    {
      pattern:
        /^p:((?:desktop|mobile|windows|linux|mac|android|ios|harmony)(?::(?:desktop|mobile|windows|linux|mac|android|ios|harmony))*):(?<rest>.+)$/,
      build(match) {
        const platforms = match[1] as string;
        const groups: Record<string, string[]> = {
          desktop: ['windows', 'linux', 'mac'],
          mobile: ['android', 'ios', 'harmony'],
        };
        const list = [...new Set(platforms.split(':').flatMap((platform) => groups[platform] ?? [platform]))];
        return (selector) => ':is(' + list.map((platform) => '.body--' + platform).join(', ') + ') ' + selector;
      },
    },
    {
      // 链式多条件：opt:a:x:b:y: 表示两个条件同时成立。
      // 条件都在同一个 <html> 上，必须拼复合选择器；后代链永不命中。
      pattern: /^opt:((?:[a-z0-9-]+:[a-z0-9-]+:)+)(?<rest>.+)$/,
      build(match) {
        const pairs = (match[1] as string).split(':').filter(Boolean);
        // 条件都在同一个 <html> 上，必须拼复合选择器；后代链永不命中。
        const conditions: string[] = [];
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          conditions.push(optionCondition(pairs[i], pairs[i + 1]));
        }
        const prefix = ':root' + conditions.join('');
        return (target: string) => prefix + ' ' + target;
      },
    },
  ];

  return dimensions.map(({ pattern, build }) => (matcher: string) => {
    const match = matcher.match(pattern);
    if (!match) return matcher;
    const selector = build(match);
    if (!selector) return matcher;
    const rest = match.groups?.['rest'];
    if (!rest) return matcher;
    return { matcher: rest, selector };
  });
}
