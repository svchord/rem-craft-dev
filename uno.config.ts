import { defineConfig, presetWind3, transformerDirectives } from 'unocss';

export default defineConfig({
  presets: [
    // 不引入 preflight/reset：思源 base.css 已有自己的重置
    presetWind3({
      // dark: 变体映射到思源的 html 属性（主题不使用 .dark class）
      dark: { dark: '[data-theme-mode="dark"]', light: '[data-theme-mode="light"]' },
    }),
  ],
  // 允许在 CSS 里写 @apply
  transformers: [transformerDirectives()],
  // 主题只有 CSS 源；@apply 之外的工具类不会被用到
  content: {
    filesystem: ['src/styles/**/*.css'],
    pipeline: { include: [/.css$/] },
  },
  theme: {
    colors: {
      brand: 'rgb(var(--rc-brand-base) / <alpha-value>)',
      surface: 'rgb(var(--rc-bg-surface) / <alpha-value>)',
      onSurface: 'rgb(var(--rc-text-secondary) / <alpha-value>)',
    },
    borderRadius: { base: 'var(--rc-radius-base)', large: 'var(--rc-radius-large)' },
  },
  shortcuts: {
    'rc-menu-item': 'flex items-center gap-2 px-3 py-2 rounded-base hover:bg-surface',
  },
});
