import { defineConfig, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';
import { theme } from './unocss/theme';
import { platformVariants } from './unocss/variants';

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
  variants: platformVariants,
  content: {
    filesystem: ['src/**/*.scss', 'src/**/*.css'],
    pipeline: { include: [/.(scss|css)$/] },
  },
  theme,
});
