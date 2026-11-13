import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'sass';
import { createGenerator, transformerDirectives } from 'unocss';
import { describe, expect, it } from 'vitest';

import unoConfig from '../uno.config';

/* 组件层断言（架构 §8、§9、§13.4 B2 / B15 / B16 / B21 / B22 / B23）。
 *
 * 组件层本轮只有这一个样式测试：用真实的 uno.config 对一个内联 fixture 做 @apply 展开，
 * 断言工具类确实解析到 --rc-* 契约；再对 src/components/ 做静态守卫扫描。
 * src/components/ 尚未落地时，扫描断言按空目录处理，不 fail。
 */

const repoRoot = join(import.meta.dirname, '..');
const componentsDir = join(repoRoot, 'src', 'components');

interface MagicStringLike {
  toString(): string;
}

type MagicStringConstructor = new (code: string) => MagicStringLike;

/** transformerDirectives 需要 MagicString 实例；它不在本包直接依赖里，从 unocss 的依赖图里取。 */
const loadMagicString = async (): Promise<MagicStringConstructor> => {
  const requireFromHere = createRequire(import.meta.url);
  const unocssEntry = requireFromHere.resolve('unocss');
  const magicStringEntry = createRequire(unocssEntry).resolve('magic-string');
  const loaded = (await import(pathToFileURL(magicStringEntry).href)) as { default: MagicStringConstructor };
  if (typeof loaded.default !== 'function') {
    throw new Error('magic-string 无法从 unocss 依赖图解析：' + magicStringEntry);
  }
  return loaded.default;
};

const FIXTURE = [
  '.rc-fixture {',
  '  @apply bg-surface text-on-surface shadow-level1 rounded-md p-md text-body-large hover:bg-surface-container;',
  '}',
].join('\n');

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const collectScss = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectScss(fullPath);
    return entry.name.endsWith('.scss') ? [fullPath] : [];
  });
};

const expandFixture = async (): Promise<string> => {
  const uno = await createGenerator(unoConfig);
  const MagicString = await loadMagicString();
  const source = new MagicString(FIXTURE);
  const transform = transformerDirectives().transform as unknown as (
    code: MagicStringLike,
    id: string,
    ctx: { uno: unknown }
  ) => Promise<void>;
  await transform(source, 'rc-fixture.scss', { uno });
  return source.toString();
};

const expanded = await expandFixture();

describe('components / @apply resolves to --rc-* contracts', () => {
  it('bg-surface expands to a color-mix() over --rc-color-surface', () => {
    expect(expanded).toContain('color-mix(in oklab, var(--rc-color-surface)');
    expect(expanded).toContain('--un-bg-opacity');
  });

  it('text-on-surface expands to a color, not to a font size', () => {
    expect(expanded).toContain('color:color-mix(in oklab, var(--rc-color-on-surface)');
  });

  it('text-body-large expands to the typescale size variable', () => {
    expect(expanded).toContain('font-size:var(--rc-typescale-body-large-size)');
    expect(expanded).toContain('var(--rc-typescale-body-large-line-height)');
  });

  it('shadow-level1 points at --rc-shadow-level1, never at elevation', () => {
    expect(expanded).toContain('var(--rc-shadow-level1)');
    expect(expanded).not.toContain('--rc-elevation-');
  });

  it('p-md expands to --rc-space-md', () => {
    expect(expanded).toContain('padding:var(--rc-space-md)');
  });

  it('rounded-md expands to the shape token', () => {
    expect(expanded).toContain('border-radius:var(--rc-shape-corner-value-medium)');
  });

  it('hover: variant expands into a :hover rule with the container role', () => {
    expect(expanded).toContain(':hover');
    expect(expanded).toContain('var(--rc-color-surface-container)');
  });
});

describe('components / B22 colors and fontSize keys are disjoint', () => {
  const theme = unoConfig.theme as {
    colors?: Record<string, unknown>;
    fontSize?: Record<string, unknown>;
  };

  it('shares no key between theme.colors and theme.fontSize', () => {
    const colorKeys = Object.keys(theme.colors ?? {});
    const fontSizeKeys = Object.keys(theme.fontSize ?? {});
    expect(colorKeys.length).toBeGreaterThan(0);
    expect(fontSizeKeys.length).toBeGreaterThan(0);
    expect(colorKeys.filter((key) => fontSizeKeys.includes(key))).toEqual([]);
  });
});

describe('components / B8 theme keys all come from the --rc-* contract', () => {
  const theme = unoConfig.theme as Record<string, unknown>;

  const collectVariables = (value: unknown, into: string[] = []): string[] => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/var\((--[\w-]+)/g)) into.push(match[1]);
    } else if (Array.isArray(value)) {
      for (const item of value) collectVariables(item, into);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) collectVariables(item, into);
    }
    return into;
  };

  const themeVariables = [...new Set(collectVariables(theme))];

  it('references only --rc-* contract variables, never the --md-ref-* raw layer', () => {
    expect(themeVariables.length).toBeGreaterThan(0);
    expect(themeVariables.filter((name) => !name.startsWith('--rc-'))).toEqual([]);
  });

  it('resolves every referenced variable to a real contract name', () => {
    const contractNames = new Set(
      [
        ...stripComments(
          compile(join(repoRoot, 'src', 'theme.scss'), { loadPaths: [join(repoRoot, 'node_modules')] }).css
        ).matchAll(/(--rc-[\w-]+)\s*:/g),
      ].map((match) => match[1])
    );
    expect(themeVariables.filter((name) => !contractNames.has(name))).toEqual([]);
  });

  it('maps all 48 color roles to --rc-color-*', () => {
    const colors = (theme.colors ?? {}) as Record<string, string>;
    const mapped = new Set(
      Object.values(colors)
        .flatMap((value) => [...value.matchAll(/var\((--rc-color-[\w-]+)/g)])
        .map((match) => match[1])
    );
    expect(mapped.size).toBe(48);
  });

  it('maps all 12 derived roles and all 18 static colors', () => {
    const colors = (theme.colors ?? {}) as Record<string, string>;
    const values = Object.values(colors).join(' ');
    const derived = new Set(
      [
        ...values.matchAll(
          /var\(--rc-(?:success|warning|info|on-success|on-warning|on-info|success-container|warning-container|info-container|on-success-container|on-warning-container|on-info-container)\)/g
        ),
      ].map((match) => match[0])
    );
    const staticColors = new Set([...values.matchAll(/var\(--rc-static-[\w-]+\)/g)].map((match) => match[0]));
    expect(derived.size).toBe(12);
    expect(staticColors.size).toBe(18);
  });
});

describe('components / B21 boxShadow uses shadow recipes', () => {
  const boxShadow = (unoConfig.theme as { boxShadow?: Record<string, string> }).boxShadow ?? {};

  it('maps every level to --rc-shadow-level*', () => {
    const values = Object.entries(boxShadow);
    expect(values).toHaveLength(6);
    for (const [key, value] of values) {
      expect(value).toMatch(/var\(--rc-shadow-level[0-5]\)/);
      expect(key).toMatch(/^level[0-5]$/);
    }
  });

  it('never references --rc-elevation-*', () => {
    expect(Object.values(boxShadow).filter((value) => value.includes('--rc-elevation-'))).toEqual([]);
  });
});

describe('components / B2 B15 B16 B23 component style guards', () => {
  const files = collectScss(componentsDir);

  it('treats a missing component layer as empty', () => {
    // 组件层本轮尚未落地；目录不存在时按空层处理，落地后本断言自动让位给下面的守卫。
    if (!existsSync(componentsDir)) expect(files).toEqual([]);
    else expect(files.every((file) => file.endsWith('.scss'))).toBe(true);
  });

  it('never writes a literal color value', () => {
    const violations = files.filter((file) =>
      /#[0-9a-fA-F]{3,8}|\b(?:rgba?|hsla?|oklch|oklab)\b/.test(stripComments(readFileSync(file, 'utf8')))
    );
    expect(violations).toEqual([]);
  });

  it('never reads --rc-* directly (only short utility classes)', () => {
    const violations = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes('var(--rc-'));
    expect(violations).toEqual([]);
  });

  it('never reads --b3-ui-*', () => {
    const violations = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes('--b3-ui-'));
    expect(violations).toEqual([]);
  });

  it('never uses @media (prefers-color-scheme: dark)', () => {
    const violations = files.filter((file) =>
      /@media[^{]*prefers-color-scheme\s*:\s*dark/.test(stripComments(readFileSync(file, 'utf8')))
    );
    expect(violations).toEqual([]);
  });

  it('never uses a .dark class selector', () => {
    const violations = files.filter((file) =>
      /(^|[\s,{>+~])\.dark(?![\w-])/.test(stripComments(readFileSync(file, 'utf8')))
    );
    expect(violations).toEqual([]);
  });

  it('never uses numeric spacing scale utilities', () => {
    const numericScale = /(^|[\s"'@])(?:-)?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\d+(?![\w-])/;
    const violations = files.filter((file) => numericScale.test(stripComments(readFileSync(file, 'utf8'))));
    expect(violations).toEqual([]);
  });
});
