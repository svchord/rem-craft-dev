import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';
import { theme } from './unocss/theme';
import { OPTION_DEFAULTS } from './unocss/options';
import { createDimensionVariants } from './unocss/variants';

/* UnoCSS 构建期生成器：theme key 全部来自 --rc-* 契约。 */
export default defineConfig({
  presets: [
    // 不引入 preflight/reset：思源 base.css 已有自己的重置。
    // dark: 变体映射到思源的 html 属性（主题不使用 .dark class）。
    presetWind3({
      dark: { dark: '[data-theme-mode="dark"]', light: '[data-theme-mode="light"]' },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  variants: createDimensionVariants(assertDimensionsDeclared(OPTION_DEFAULTS)),
  content: {
    filesystem: ['src/**/*.scss', 'src/**/*.css'],
    pipeline: { include: [/.(scss|css)$/] },
  },
  theme,
});

/**
 * 源码用到的每个 opt:<name>: 都必须在 OPTION_DEFAULTS 里登记。
 * 未登记的维度会编译成 [data-rc-<name>="..."]，而 applier 对默认值不写属性，
 * 这类选择器永不命中——样式静默全灭，构建却仍然成功。
 */
function assertDimensionsDeclared<T extends Record<string, string>>(defaults: T): T {
  const used = new Set<string>();
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.(scss|css)$/.test(entry.name)) continue;
      // opt: 后可跟多对 name:value:（opt:style:m3:field:filled:），逐对收集。
      for (const block of readFileSync(path, 'utf8').matchAll(/opt:((?:[a-z0-9-]+:[a-z0-9-]+:)+)/g)) {
        const pairs = block[1].split(':').filter(Boolean);
        for (let i = 0; i < pairs.length; i += 2) used.add(pairs[i]);
      }
    }
  };
  scan(resolve(process.cwd(), 'src'));

  const unknown = [...used].filter((name) => !(name in defaults));
  if (unknown.length) {
    throw new Error(`opt: 维度 ${unknown.join('、')} 没有在 unocss/options.ts 登记默认值`);
  }
  return defaults;
}

/**
 * theme-setting.json 是可选运行时数据；存在时其 default 必须与上面的契约一致，
 * 否则插件显示的值和 CSS 认定的默认态会错位（选了默认值却套上另一套样式）。
 * 主题不带这个文件时直接跳过。
 */
function assertConfigAgrees(defaults: Record<string, string>): void {
  const file = resolve(process.cwd(), 'public/theme-setting.json');
  if (!existsSync(file)) return;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { items?: Array<Record<string, unknown>> };
  for (const item of raw.items ?? []) {
    const apply = item['apply'];
    if (!apply || typeof apply !== 'object') continue;
    const rule = apply as Record<string, unknown>;
    if (rule['kind'] !== 'attribute' || typeof rule['name'] !== 'string') continue;
    const name = rule['name'].replace(/^data-rc-/, '');
    if (!(name in defaults)) continue;
    const value = item['type'] === 'switch' ? (item['default'] ? 'on' : 'off') : item['default'];
    if (value !== defaults[name]) {
      throw new Error(
        `theme-setting.json 里 ${name} 的默认值是 ${String(value)}，与 unocss/options.ts 的 ${defaults[name]} 不一致`
      );
    }
  }
}

assertConfigAgrees(OPTION_DEFAULTS);
