import { defineConfig, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';

/* UnoCSS 构建期生成器：theme key 全部来自 --rc-* 契约。 */

const TYPESCALE = [
  'display-large',
  'display-medium',
  'display-small',
  'headline-large',
  'headline-medium',
  'headline-small',
  'title-large',
  'title-medium',
  'title-small',
  'body-large',
  'body-medium',
  'body-small',
  'label-large',
  'label-medium',
  'label-small',
] as const;

const COLOR_ROLES = [
  'background',
  'on-background',
  'surface',
  'on-surface',
  'surface-variant',
  'on-surface-variant',
  'surface-dim',
  'surface-bright',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'inverse-surface',
  'inverse-on-surface',
  'outline',
  'outline-variant',
  'shadow',
  'scrim',
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'inverse-primary',
  'primary-fixed',
  'primary-fixed-dim',
  'on-primary-fixed',
  'on-primary-fixed-variant',
  'secondary',
  'on-secondary',
  'secondary-container',
  'on-secondary-container',
  'secondary-fixed',
  'secondary-fixed-dim',
  'on-secondary-fixed',
  'on-secondary-fixed-variant',
  'tertiary',
  'on-tertiary',
  'tertiary-container',
  'on-tertiary-container',
  'tertiary-fixed',
  'tertiary-fixed-dim',
  'on-tertiary-fixed',
  'on-tertiary-fixed-variant',
  'error',
  'on-error',
  'error-container',
  'on-error-container',
] as const;

const DERIVED_ROLES = [
  'success',
  'on-success',
  'success-container',
  'on-success-container',
  'warning',
  'on-warning',
  'warning-container',
  'on-warning-container',
  'info',
  'on-info',
  'info-container',
  'on-info-container',
] as const;

const STATIC_COLORS = [
  'red-40',
  'red-90',
  'orange-40',
  'orange-90',
  'yellow-40',
  'yellow-90',
  'yellow-80',
  'green-40',
  'green-90',
  'green-30',
  'pink-40',
  'pink-90',
  'blue-40',
  'blue-90',
  'purple-40',
  'purple-90',
  'cyan-40',
  'cyan-90',
] as const;

const DURATIONS = [
  'short1',
  'short2',
  'short3',
  'short4',
  'medium1',
  'medium2',
  'medium3',
  'medium4',
  'long1',
  'long2',
  'long3',
  'long4',
  'extra-long1',
  'extra-long2',
  'extra-long3',
  'extra-long4',
] as const;

const EASINGS = [
  'standard',
  'standard-accelerate',
  'standard-decelerate',
  'emphasized',
  'emphasized-accelerate',
  'emphasized-decelerate',
  'legacy',
  'legacy-accelerate',
  'legacy-decelerate',
  'linear',
] as const;

/* <alpha-value> 占位符必须有，否则 bg-surface/50 会被静默丢弃（§8.4）。 */
const color = (variable: string) => `color-mix(in oklab, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

export default defineConfig({
  presets: [
    // 不引入 preflight/reset：思源 base.css 已有自己的重置。
    // dark: 变体映射到思源的 html 属性（主题不使用 .dark class）。
    presetWind3({
      dark: { dark: '[data-theme-mode="dark"]', light: '[data-theme-mode="light"]' },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  // 主题只有 SCSS 源；工具类只经 @apply 出现在组件层。
  content: {
    filesystem: ['src/**/*.scss', 'src/**/*.css'],
    pipeline: { include: [/\.(scss|css)$/] },
  },
  theme: {
    colors: {
      ...Object.fromEntries(COLOR_ROLES.map((role) => [role, color(`--rc-color-${role}`)])),
      ...Object.fromEntries(DERIVED_ROLES.map((role) => [role, color(`--rc-${role}`)])),
      ...Object.fromEntries(STATIC_COLORS.map((tone) => [`static-${tone}`, color(`--rc-static-${tone}`)])),
    },
    // 官方名是 corner-value-{none,extra-small,small,medium,large,large-increased,
    // extra-large,extra-large-increased,extra-extra-large}；UnoCSS 侧用短键名。
    borderRadius: {
      none: 'var(--rc-shape-corner-value-none)',
      xs: 'var(--rc-shape-corner-value-extra-small)',
      sm: 'var(--rc-shape-corner-value-small)',
      md: 'var(--rc-shape-corner-value-medium)',
      lg: 'var(--rc-shape-corner-value-large)',
      'lg-inc': 'var(--rc-shape-corner-value-large-increased)',
      xl: 'var(--rc-shape-corner-value-extra-large)',
      'xl-inc': 'var(--rc-shape-corner-value-extra-large-increased)',
      xxl: 'var(--rc-shape-corner-value-extra-extra-large)',
      full: 'var(--rc-shape-corner-full)',
      'xs-top': 'var(--rc-shape-corner-extra-small-top)',
      'lg-top': 'var(--rc-shape-corner-large-top)',
      'xl-top': 'var(--rc-shape-corner-extra-large-top)',
      'lg-start': 'var(--rc-shape-corner-large-start)',
      'lg-end': 'var(--rc-shape-corner-large-end)',
    },
    spacing: {
      xs: 'var(--rc-space-xs)',
      sm: 'var(--rc-space-sm)',
      md: 'var(--rc-space-md)',
      lg: 'var(--rc-space-lg)',
      xl: 'var(--rc-space-xl)',
    },
    height: {
      row: 'var(--rc-size-row)',
      control: 'var(--rc-size-control)',
      dock: 'var(--rc-size-dock)',
      panel: 'var(--rc-size-panel)',
    },
    width: {
      row: 'var(--rc-size-row)',
      control: 'var(--rc-size-control)',
      dock: 'var(--rc-size-dock)',
      panel: 'var(--rc-size-panel)',
    },
    // 字号键名带层级（body-large / label-small），与颜色键名零交集（B22）。
    fontSize: Object.fromEntries(
      TYPESCALE.map((level): [string, [string, { lineHeight: string }]] => [
        level,
        [`var(--rc-typescale-${level}-size)`, { lineHeight: `var(--rc-typescale-${level}-line-height)` }],
      ])
    ),
    lineHeight: Object.fromEntries(TYPESCALE.map((level) => [level, `var(--rc-typescale-${level}-line-height)`])),
    // 字重取自 typescale 契约：uno.config.ts 只能消费 --rc-*，不得读原料层 --md-ref-*。
    fontWeight: {
      regular: 'var(--rc-typescale-body-large-weight)',
      medium: 'var(--rc-typescale-label-large-weight)',
      bold: 'var(--rc-typescale-emphasized-label-large-weight)',
    },
    // M3 elevation 是 dp 数值，box-shadow 需要完整配方（B21）。
    boxShadow: Object.fromEntries(
      ['level0', 'level1', 'level2', 'level3', 'level4', 'level5'].map((level) => [level, `var(--rc-shadow-${level})`])
    ),
    duration: Object.fromEntries(DURATIONS.map((key) => [key, `var(--rc-motion-duration-${key})`])),
    easing: Object.fromEntries(EASINGS.map((key) => [key, `var(--rc-motion-easing-${key})`])),
  },
});
