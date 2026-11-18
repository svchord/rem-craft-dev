import type { PresetWind3Theme } from 'unocss';
import {
  COLOR_ROLES,
  DERIVED_ROLES,
  STATIC_COLORS,
  TYPESCALE,
  DURATIONS,
  EASINGS,
  STATE_LAYERS,
  color,
  stateColor,
} from './tokens';

export const theme: PresetWind3Theme = {
  colors: {
    ...Object.fromEntries(COLOR_ROLES.map((role) => [role, color(`--rc-color-${role}`)])),
    ...Object.fromEntries(
      STATE_LAYERS.flatMap((state) => [
        [`state-${state}-transparent`, stateColor('transparent', state)],
        ...COLOR_ROLES.map((role) => [`state-${state}-${role}`, stateColor(`var(--rc-color-${role})`, state)]),
        ...DERIVED_ROLES.map((role) => [`state-${state}-${role}`, stateColor(`var(--rc-${role})`, state)]),
      ])
    ),
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
    TYPESCALE.map((level): [string, [string, string]] => [
      level,
      [`var(--rc-typescale-${level}-size)`, `var(--rc-typescale-${level}-line-height)`],
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
};
