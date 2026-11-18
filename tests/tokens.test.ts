import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileString } from 'sass';
import { describe, expect, it } from 'vitest';

/* Token 层断言（架构 §13.4 B4 / B6 / B7 / B11 / B12 / B14 / B17 / B20 / B24）。
 *
 * 全部基于 sass 编译 src/theme.scss 的真实产物，不读中间文件、不做源码字符串猜测。
 * 条数口径与 §3.1 / §4.3 一致：颜色 48 唯一 × 亮暗两份 = 96 条声明；
 * 静态标注落地 18 个唯一名（§4.4 的 22 是含 green-40/-90、purple-40/-90 各重复一次的计数）。
 */

const repoRoot = join(import.meta.dirname, '..');
const srcDir = join(repoRoot, 'src');
const tokensDir = join(srcDir, 'tokens');

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/@charset[^;]*;/g, '');

interface Declaration {
  name: string;
  value: string;
}

const toDeclarations = (css: string): Declaration[] =>
  [...stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]*);/g)].map((match) => ({
    name: match[1],
    value: match[2].trim(),
  }));

interface Block {
  selector: string;
  declarations: Declaration[];
}

const toBlocks = (css: string): Block[] =>
  [...stripComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: toDeclarations(match[2]),
  }));

const compiledCss = compile(join(srcDir, 'theme.scss'), { loadPaths: [join(repoRoot, 'node_modules')] }).css;
const declarations = toDeclarations(compiledCss);
const blocks = toBlocks(compiledCss);
const uniqueNames = [...new Set(declarations.map((declaration) => declaration.name))];

const countMatching = (pattern: RegExp) => declarations.filter((declaration) => pattern.test(declaration.name)).length;
const namesMatching = (pattern: RegExp) => uniqueNames.filter((name) => pattern.test(name));

/** 48 个 sys-color 角色（M3 官方 50 条减去 surface-tint / surface-tint-color 两条弃用）。 */
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
];

const SHAPE_VALUES = [
  'none',
  'extra-small',
  'small',
  'medium',
  'large',
  'large-increased',
  'extra-large',
  'extra-large-increased',
  'extra-extra-large',
];

const SHAPE_CORNERS = [
  ...SHAPE_VALUES,
  'full',
  'extra-small-top',
  'large-top',
  'extra-large-top',
  'large-start',
  'large-end',
];

const MOTION_DURATIONS = [
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
];

const MOTION_EASINGS = [
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
];

/** spring 18 条 = 3 速度 × 2 种类 × {本体, -damping, -stiffness}。 */
const MOTION_SPRINGS = ['default', 'fast', 'slow'].flatMap((speed) =>
  ['spatial', 'effects'].flatMap((kind) => [
    'spring-' + speed + '-' + kind,
    'spring-' + speed + '-' + kind + '-damping',
    'spring-' + speed + '-' + kind + '-stiffness',
  ])
);

const STATE_LAYERS = ['hover', 'focus', 'pressed', 'dragged', 'disabled'].map(
  (state) => 'state-' + state + '-state-layer-opacity'
);

/** 焦点环 3 条：模块 md-sys-state-focus-indicator 去 md-sys- 加 --rc-（§4.1）。 */
const STATE_FOCUS = ['inner-offset', 'outer-offset', 'thickness'].map((part) => 'state-focus-indicator-' + part);

const TYPESCALE_LEVELS = [
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
];

const TYPESCALE_PROPERTIES = [
  'size',
  'line-height',
  'weight',
  'font',
  'tracking',
  'wght',
  'opsz',
  'slnt',
  'wdth',
  'crsv',
  'fill',
  'grad',
  'hexp',
  'rond',
];

const DERIVED_ROLES = ['success', 'warning', 'info'].flatMap((role) => [
  role,
  'on-' + role,
  role + '-container',
  'on-' + role + '-container',
]);

const STATIC_TONES = [
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
];

const DEPRECATED_TOKENS = [
  'surface-tint',
  'surface-tint-color',
  'label-medium-text-transform',
  'label-large-weight-prominent',
  'label-medium-weight-prominent',
];

/** 按顶层逗号切分 box-shadow 的多层值，括号内的逗号不算。 */
const splitTopLevel = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
};

const collectScss = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectScss(fullPath));
    else if (entry.name.endsWith('.scss')) files.push(fullPath);
  }
  return files;
};

/** Sass 插值 #{...} 里的花括号不是选择器边界，先抹掉再找规则头。 */
const selectorsOf = (scss: string) =>
  [
    ...stripComments(scss)
      .replace(/#\{[^}]*\}/g, 'x')
      .matchAll(/([^{}]*)\{/g),
  ]
    .map((match) => match[1].trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'));

describe('token layer / B6 declaration counts', () => {
  it('lands the exact number of declarations per token family', () => {
    expect(countMatching(/^--md-ref-palette-/)).toBe(239);
    expect(countMatching(/^--md-ref-typeface-/)).toBe(5);
    expect(countMatching(/^--rc-shape-/)).toBe(24);
    expect(countMatching(/^--rc-elevation-/)).toBe(6);
    expect(countMatching(/^--rc-motion-/)).toBe(45);
    // 注意：--rc-state-focus-indicator-* 不会命中 focus-state-layer-opacity（后者没有 indicator 段），
    // 但两者共用 --rc-state-* 前缀，所以仍用完整名断言，不用前缀计数。
    expect(countMatching(/^--rc-state-(hover|focus|pressed|dragged|disabled)-state-layer-opacity$/)).toBe(5);
    expect(countMatching(/^--rc-state-focus-indicator-(inner-offset|outer-offset|thickness)$/)).toBe(3);
    expect(countMatching(/^--rc-typescale-(?!emphasized-)/)).toBe(210);
    expect(countMatching(/^--rc-typescale-emphasized-/)).toBe(210);
  });

  it('totals 843 declarations / 795 unique names for the M3 design layer', () => {
    // 843 = 239 palette + 5 typeface + 48×2 color + 24 shape + 6 elevation + 45 motion
    //      + 5 state + 3 focus + 210 typescale + 210 emphasized（§3.1）。
    const materialDeclarations = declarations
      .filter((declaration) => declaration.name.startsWith('--md-ref-') || declaration.name.startsWith('--rc-'))
      .filter(
        (declaration) =>
          !/^--rc-(?:success|warning|info|on-success|on-warning|on-info|success-container|warning-container|info-container|on-success-container|on-warning-container|on-info-container)$/.test(
            declaration.name
          ) &&
          !declaration.name.startsWith('--rc-static-') &&
          !declaration.name.startsWith('--rc-shadow-') &&
          !declaration.name.startsWith('--rc-space-') &&
          !declaration.name.startsWith('--rc-size-')
      );
    expect(materialDeclarations).toHaveLength(843);
    expect(new Set(materialDeclarations.map((declaration) => declaration.name)).size).toBe(795);
  });

  it('lands 48 colors per mode, 96 declarations in total', () => {
    expect(countMatching(/^--rc-color-/)).toBe(96);
    expect(namesMatching(/^--rc-color-/)).toHaveLength(48);
  });

  it('lands 24 derived declarations (12 roles x light/dark) with 12 unique names', () => {
    expect(
      countMatching(
        /^--rc-(?:success|warning|info|on-success|on-warning|on-info|success-container|warning-container|info-container|on-success-container|on-warning-container|on-info-container)$/
      )
    ).toBe(24);
    expect(
      namesMatching(
        /^--rc-(?:success|warning|info|on-success|on-warning|on-info|success-container|warning-container|info-container|on-success-container|on-warning-container|on-info-container)$/
      )
    ).toHaveLength(12);
  });

  it('lands 18 unique static annotation colors', () => {
    // 架构 §4.4 的 22 含 4 处重复（green-40/-90、purple-40/-90 在 PDF 组与图表组各一次）；
    // CSS 同名重复声明会互相覆盖，所以唯一名只有 18 个。
    expect(countMatching(/^--rc-static-/)).toBe(18);
    expect(namesMatching(/^--rc-static-/)).toHaveLength(18);
  });

  it('lands 5 spacing and 6 shadow extension tokens', () => {
    expect(countMatching(/^--rc-space-/)).toBe(5);
    expect(countMatching(/^--rc-shadow-level[0-5]$/)).toBe(6);
  });
});

describe('token layer / B14 + B20 light and dark color blocks', () => {
  /** 只保留颜色声明：亮色 :root 块同时承载 shape / typescale 等其它族。 */
  const colorBlocks = blocks
    .filter((block) => block.declarations.some((declaration) => declaration.name.startsWith('--rc-color-')))
    .map((block) => ({
      selector: block.selector,
      declarations: block.declarations.filter((declaration) => declaration.name.startsWith('--rc-color-')),
    }));

  it('defines exactly two color blocks: :root and :root[data-theme-mode=dark]', () => {
    expect(colorBlocks.map((block) => block.selector)).toEqual([':root', ':root[data-theme-mode=dark]']);
  });

  it('defines the same 48 keys in both modes', () => {
    const [light, dark] = colorBlocks.map((block) => block.declarations.map((declaration) => declaration.name));
    expect(light).toHaveLength(48);
    expect(dark).toHaveLength(48);
    expect([...dark].sort()).toEqual([...light].sort());
  });

  it('keeps the key order identical in both modes', () => {
    const [light, dark] = colorBlocks.map((block) => block.declarations.map((declaration) => declaration.name));
    expect(dark).toEqual(light);
  });

  it('defines the palette exactly once (mode independent)', () => {
    const paletteBlocks = blocks.filter((block) =>
      block.declarations.some((declaration) => declaration.name.startsWith('--md-ref-palette-'))
    );
    expect(paletteBlocks).toHaveLength(1);
    expect(paletteBlocks[0].selector).toBe(':root');
  });
});

describe('token layer / Google Account surface alignment', () => {
  // 同一变量在亮暗两份里重复；取首次出现（亮色）即可，palette 本身只定义一次。
  const firstDeclarations = new Map<string, string>();
  for (const declaration of declarations) {
    if (!firstDeclarations.has(declaration.name)) firstDeclarations.set(declaration.name, declaration.value);
  }
  const resolve = (name: string): string => {
    let value = firstDeclarations.get(name) ?? '';
    const seen = new Set<string>();
    while (value.startsWith('var(') && value.endsWith(')') && !seen.has(value)) {
      seen.add(value);
      const inner = value.slice(4, -1);
      value = firstDeclarations.get(inner) ?? value;
    }
    return value;
  };

  it('uses the Google Account GM3 neutral surface ramp', () => {
    const expected: Record<string, string> = {
      '--rc-color-background': '#ffffff',
      '--rc-color-surface': '#ffffff',
      '--rc-color-surface-bright': '#ffffff',
      '--rc-color-surface-container-lowest': '#ffffff',
      '--rc-color-surface-container-low': '#f8fafd',
      '--rc-color-surface-container': '#f0f4f9',
      '--rc-color-surface-container-high': '#e9eef6',
      '--rc-color-surface-container-highest': '#dde3ea',
      '--rc-color-surface-dim': '#d3dbe5',
      '--rc-color-surface-variant': '#e1e3e1',
    };
    expect(Object.fromEntries(Object.keys(expected).map((name) => [name, resolve(name)]))).toEqual(expected);
  });

  it('uses GM3 brand roles for accents and text', () => {
    const expected: Record<string, string> = {
      '--rc-color-primary': '#0b57d0',
      '--rc-color-secondary': '#00639b',
      '--rc-color-tertiary': '#146c2e',
      '--rc-color-error': '#b3261e',
      '--rc-color-on-surface': '#1f1f1f',
      '--rc-color-outline': '#747775',
    };
    expect(Object.fromEntries(Object.keys(expected).map((name) => [name, resolve(name)]))).toEqual(expected);
  });
});

describe('token layer / B7 contract completeness', () => {
  const expectedNames = [
    ...COLOR_ROLES.map((role) => '--rc-color-' + role),
    ...SHAPE_VALUES.map((value) => '--rc-shape-corner-value-' + value),
    ...SHAPE_CORNERS.map((corner) => '--rc-shape-corner-' + corner),
    ...[0, 1, 2, 3, 4, 5].map((level) => '--rc-elevation-level' + level),
    ...MOTION_DURATIONS.map((duration) => '--rc-motion-duration-' + duration),
    ...MOTION_EASINGS.map((easing) => '--rc-motion-easing-' + easing),
    ...MOTION_SPRINGS.map((spring) => '--rc-motion-' + spring),
    '--rc-motion-path',
    ...STATE_LAYERS.map((state) => '--rc-' + state),
    ...STATE_FOCUS.map((focus) => '--rc-' + focus),
    ...TYPESCALE_LEVELS.flatMap((level) =>
      TYPESCALE_PROPERTIES.map((property) => '--rc-typescale-' + level + '-' + property)
    ),
    ...TYPESCALE_LEVELS.flatMap((level) =>
      TYPESCALE_PROPERTIES.map((property) => '--rc-typescale-emphasized-' + level + '-' + property)
    ),
    ...DERIVED_ROLES.map((role) => '--rc-' + role),
    ...STATIC_TONES.map((tone) => '--rc-static-' + tone),
    ...['xs', 'sm', 'md', 'lg', 'xl'].map((step) => '--rc-space-' + step),
    ...[0, 1, 2, 3, 4, 5].map((level) => '--rc-shadow-level' + level),
  ];

  const rcNames = namesMatching(/^--rc-/);

  it('has no missing contract name', () => {
    expect(expectedNames.filter((name) => !rcNames.includes(name))).toEqual([]);
  });

  it('has no contract name outside the documented set', () => {
    expect(rcNames.filter((name) => !expectedNames.includes(name))).toEqual([]);
  });

  it('counts 592 unique --rc-* names (48 + 24 + 6 + 45 + 5 + 3 + 210 + 210 + 12 + 18 + 5 + 6)', () => {
    // 架构 §13.4 B7 写的 648 是「颜色算亮暗 96 + 静态算含重复 22」的口径；
    // 唯一变量名口径是 592，二者差异全部来自重复声明，不是契约缺失。
    expect(rcNames).toHaveLength(592);
  });
});

describe('token layer / B17 deprecated tokens', () => {
  it('never emits any of the deprecated token names', () => {
    const css = stripComments(compiledCss);
    for (const token of DEPRECATED_TOKENS) {
      expect(css).not.toContain(token);
    }
  });
});

describe('token layer / B12 derived.scss color sourcing', () => {
  const derived = stripComments(readFileSync(join(tokensDir, 'derived.scss'), 'utf8'));
  const references = [...derived.matchAll(/var\((--[\w-]+)\)/g)].map((match) => match[1]);

  it('only references the --md-ref-palette-* raw layer', () => {
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter((name) => !name.startsWith('--md-ref-palette-'))).toEqual([]);
  });

  it('contains no literal or relative color syntax', () => {
    expect(derived).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(derived).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
  });
});

describe('token layer / B24 shadow recipes', () => {
  const shadows = declarations.filter((declaration) => /^--rc-shadow-level[0-5]$/.test(declaration.name));

  it('covers level0-level5 exactly once', () => {
    expect(shadows.map((shadow) => shadow.name)).toEqual(
      [0, 1, 2, 3, 4, 5].map((level) => '--rc-shadow-level' + level)
    );
  });

  it('expresses each level as two layers (key + ambient)', () => {
    for (const shadow of shadows) {
      const layers = splitTopLevel(shadow.value);
      expect(layers).toHaveLength(2);
      for (const layer of layers) expect(layer).toContain('color-mix(');
    }
  });
});

describe('token layer / B11 no variable self reference', () => {
  it('never references its own name from a value', () => {
    const selfReferences = declarations.filter((declaration) =>
      declaration.value.includes('var(' + declaration.name + ')')
    );
    expect(selfReferences.map((declaration) => declaration.name)).toEqual([]);
  });
});

describe('token layer / B26 UnoCSS baseline variables', () => {
  const UN_BASELINE = [
    '--un-ring-inset',
    '--un-ring-offset-width',
    '--un-ring-offset-color',
    '--un-ring-width',
    '--un-ring-color',
    '--un-ring-offset-shadow',
    '--un-ring-shadow',
    '--un-shadow-inset',
    '--un-shadow',
  ];

  it('defines all 9 --un-* baseline variables', () => {
    const defined = new Set(uniqueNames.filter((name) => name.startsWith('--un-')));
    expect(UN_BASELINE.filter((name) => !defined.has(name))).toEqual([]);
    expect(defined.size).toBe(9);
  });

  it('resolves every var(--un-*) reference in the product', () => {
    const defined = new Set(uniqueNames.filter((name) => name.startsWith('--un-')));
    const referenced = [...stripComments(compiledCss).matchAll(/var\((--un-[\w-]+)/g)].map((match) => match[1]);
    expect(referenced.filter((name) => !defined.has(name))).toEqual([]);
  });
});

describe('token layer / B4 no component selectors', () => {
  const tokenFiles = collectScss(tokensDir);

  it('only declares :root / :root[attr] selectors', () => {
    const violations = tokenFiles.flatMap((file) =>
      selectorsOf(readFileSync(file, 'utf8'))
        .filter((selector) => !/^:root(\[[^\]]*\])?$/.test(selector))
        .map((selector) => file + ': ' + selector)
    );
    expect(violations).toEqual([]);
  });

  it('never writes a class or id selector', () => {
    const violations = tokenFiles.flatMap((file) =>
      selectorsOf(readFileSync(file, 'utf8'))
        .filter((selector) => /[.#]/.test(selector))
        .map((selector) => file + ': ' + selector)
    );
    expect(violations).toEqual([]);
  });

  it('only bridge.scss is allowed to define --b3-*', () => {
    const violations = tokenFiles
      .filter((file) => !file.endsWith(join('tokens', 'bridge.scss')))
      .filter((file) => /--b3-[\w-]+\s*:/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(violations).toEqual([]);
  });
});

/* ── B18 1:1 双射：产物变量 ↔ @material/web 内置的 11 个官方模块 ───────── */

/** 官方 token 由 devDependency @material/web@2.5.0 提供，不再复制进仓库。 */
const M3_SASS_DIR = join(repoRoot, 'node_modules', '@material', 'web', 'tokens', 'versions', 'latest', 'sass');
const M3_SASS_SPEC = '@material/web/tokens/versions/latest/sass/';

/** 暗色颜色模块的文件名带双下划线，按目录实际文件名取，避免硬编码。 */
const darkColorModule = readdirSync(M3_SASS_DIR)
  .filter((name) => /^_md-sys-color.*dark\.scss$/.test(name))
  .map((name) => name.replace(/^_/, '').replace(/\.scss$/, ''))[0];

interface VendorModule {
  alias: string;
  path: string;
  prefix: string;
}

/** §4.1 命名规则的机械映射：模块名去 md-sys- / md-ref-，加 --rc- / --md-ref-。 */
const M3_MODULES: VendorModule[] = [
  { alias: 'palette', path: M3_SASS_SPEC + 'md-ref-palette', prefix: '--md-ref-palette-' },
  { alias: 'typeface', path: M3_SASS_SPEC + 'md-ref-typeface', prefix: '--md-ref-typeface-' },
  { alias: 'color', path: M3_SASS_SPEC + 'md-sys-color', prefix: '--rc-color-' },
  { alias: 'color-dark', path: M3_SASS_SPEC + darkColorModule, prefix: '--rc-color-' },
  { alias: 'shape', path: M3_SASS_SPEC + 'md-sys-shape', prefix: '--rc-shape-' },
  { alias: 'elevation', path: M3_SASS_SPEC + 'md-sys-elevation', prefix: '--rc-elevation-' },
  { alias: 'motion', path: M3_SASS_SPEC + 'md-sys-motion', prefix: '--rc-motion-' },
  { alias: 'state', path: M3_SASS_SPEC + 'md-sys-state', prefix: '--rc-state-' },
  { alias: 'focus', path: M3_SASS_SPEC + 'md-sys-state-focus-indicator', prefix: '--rc-state-focus-indicator-' },
  { alias: 'typescale', path: M3_SASS_SPEC + 'md-sys-typescale', prefix: '--rc-typescale-' },
  {
    alias: 'typescale-emphasized',
    path: M3_SASS_SPEC + 'md-sys-typescale-emphasized',
    prefix: '--rc-typescale-emphasized-',
  },
];

/** 每个模块单独一个 [data-probe] 块，别名之间的前缀包含关系就不会互相污染。 */
const m3ProbeSource = (() => {
  const lines = ["@use 'sass:meta';"];
  for (const module of M3_MODULES) {
    lines.push("@use '" + module.path + "' as " + module.alias.replace(/-/g, '_') + ';');
  }
  for (const module of M3_MODULES) {
    const namespace = module.alias.replace(/-/g, '_');
    lines.push(":root[data-probe='" + module.alias + "'] {");
    lines.push("  @each $name, $value in meta.module-variables('" + namespace + "') { --probe-#{$name}: 1; }");
    lines.push('}');
  }
  return lines.join('\n');
})();

const moduleVariablesByModule = (() => {
  const css = stripComments(compileString(m3ProbeSource, { loadPaths: [join(repoRoot, 'node_modules')] }).css);
  const result = new Map<string, string[]>();
  for (const block of css.matchAll(/:root\[data-probe=['"]?([\w-]+)['"]?\]\s*\{([^}]*)\}/g)) {
    const names = [...new Set([...block[2].matchAll(/(--probe-[\w-]+)\s*:/g)].map((match) => match[1]))];
    result.set(
      block[1],
      names.map((name) => name.replace('--probe-', ''))
    );
  }
  return result;
})();

/** 官方模块变量按 §4.1 映射成产物变量名，并剔除 6 处弃用标注（5 个唯一名）。 */
const officialVariables = (() => {
  const names: string[] = [];
  for (const module of M3_MODULES) {
    for (const variable of moduleVariablesByModule.get(module.alias) ?? []) {
      if (DEPRECATED_TOKENS.includes(variable)) continue;
      names.push(module.prefix + variable);
    }
  }
  return [...new Set(names)];
})();

/** M3 设计层：--md-ref-* 原料层 + 契约层，排除派生 / 静态 / 阴影 / 间距 / 尺寸扩展。 */
const designLayer = declarations.filter(
  (declaration) =>
    (declaration.name.startsWith('--md-ref-') || declaration.name.startsWith('--rc-')) &&
    !/^--rc-(?:success|warning|info|on-success|on-warning|on-info|success-container|warning-container|info-container|on-success-container|on-warning-container|on-info-container)$/.test(
      declaration.name
    ) &&
    !declaration.name.startsWith('--rc-static-') &&
    !declaration.name.startsWith('--rc-shadow-') &&
    !declaration.name.startsWith('--rc-space-') &&
    !declaration.name.startsWith('--rc-size-')
);

describe('token layer / B18 one-to-one bijection with the official M3 modules', () => {
  it('lands 843 design-layer declarations and 795 unique names', () => {
    expect(designLayer).toHaveLength(843);
    expect(new Set(designLayer.map((declaration) => declaration.name)).size).toBe(795);
  });

  it('explains the 48 declaration surplus as the light/dark color duplicate', () => {
    const unique = new Set(designLayer.map((declaration) => declaration.name)).size;
    expect(designLayer.length - unique).toBe(48);
    expect(namesMatching(/^--rc-color-/)).toHaveLength(48);
  });

  it('matches the official module variable counts exactly', () => {
    const counts = Object.fromEntries(
      M3_MODULES.map((module) => [module.alias, moduleVariablesByModule.get(module.alias)?.length ?? 0])
    );
    expect(counts).toEqual({
      palette: 239,
      typeface: 5,
      color: 50,
      'color-dark': 50,
      shape: 24,
      elevation: 7,
      motion: 45,
      state: 5,
      focus: 3,
      typescale: 213,
      'typescale-emphasized': 210,
    });
  });

  it('has exactly one product variable per non-deprecated official variable', () => {
    const product = [...new Set(designLayer.map((declaration) => declaration.name))].sort();
    expect(officialVariables.sort()).toEqual(product);
    expect(product).toHaveLength(795);
  });
});

/* ── B19 弃用标注：每个 token 文件头部必须交代弃用项 ───────────────── */

describe('token layer / B19 deprecation notes in token file headers', () => {
  const head = (file: string) => readFileSync(join(tokensDir, file), 'utf8').split('\n').slice(0, 40).join('\n');

  it('lists every deprecated token with a replacement in material/_index.scss', () => {
    const header = head(join('material', '_index.scss'));
    expect(header).toContain('弃用');
    for (const token of DEPRECATED_TOKENS) {
      const line = header
        .split('\n')
        .find((text) => text.includes(token) && (text.includes('→') || text.includes('替代')));
      expect(line, token).toBeDefined();
    }
  });

  it('marks derived / extend / bridge headers as deprecation-aware', () => {
    const missing = ['derived.scss', '_extend.scss', 'bridge.scss'].filter((file) => {
      const header = head(file);
      return !header.includes('弃用') && !header.includes('无弃用项');
    });
    expect(missing).toEqual([]);
  });
});

/* ── B9 风格覆盖占位文件：每个 :root 必须带 [data-rc-style] ─────────── */

describe('token layer / B9 style override placeholders', () => {
  const STYLE_FILES = [
    { file: join(tokensDir, 'fluent', '_index.scss'), style: 'fluent' },
    { file: join(tokensDir, 'shadcn', '_index.scss'), style: 'shadcn' },
  ];

  it('ships a fluent and a shadcn override entry', () => {
    expect(STYLE_FILES.filter((entry) => !existsSync(entry.file))).toEqual([]);
  });

  it('scopes every :root selector to [data-rc-style=<style>]', () => {
    const violations = STYLE_FILES.flatMap((entry) => {
      const selectors = selectorsOf(readFileSync(entry.file, 'utf8')).filter((selector) => selector.includes(':root'));
      expect(selectors.length).toBeGreaterThan(0);
      return selectors
        .filter((selector) => !selector.includes("[data-rc-style='" + entry.style + "']"))
        .map((selector) => entry.file + ': ' + selector);
    });
    expect(violations).toEqual([]);
  });
});
