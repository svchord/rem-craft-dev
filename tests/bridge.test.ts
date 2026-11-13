import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* 桥接层断言（架构 §5、§13.4 B3 / B25）。
 *
 * bridge.scss 是唯一允许定义 --b3-* 的文件，覆盖 147 个颜色槽位里 137 个：
 * 剩下 10 个是关键字值槽位（6 个 initial + 4 个 inherit），必须保持关键字。
 * 依赖方向：只引用 --rc-*，不得出现 --md-ref-* 或字面色值；带 alpha 的原值一律 color-mix()。
 */

const repoRoot = join(import.meta.dirname, '..');
const bridgePath = join(repoRoot, 'src', 'tokens', 'bridge.scss');

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const source = stripComments(readFileSync(bridgePath, 'utf8'));

interface Declaration {
  name: string;
  value: string;
}

const declarations: Declaration[] = [...source.matchAll(/(--b3-[\w-]+)\s*:\s*([^;{}]*);/g)].map((match) => ({
  name: match[1],
  value: match[2].trim(),
}));

/** 10 个不接管的槽位：mindmap 6 条为 initial，protyle-inline 4 条为 inherit（§5.2）。 */
const EXCLUDED_SLOTS = [
  '--b3-mindmap-line-hover-color',
  '--b3-mindmap-line-selected-color',
  '--b3-mindmap-relation-hover-color',
  '--b3-mindmap-relation-selected-color',
  '--b3-mindmap-summary-hover-color',
  '--b3-mindmap-summary-selected-color',
  '--b3-protyle-inline-strong-color',
  '--b3-protyle-inline-em-color',
  '--b3-protyle-inline-u-color',
  '--b3-protyle-inline-s-color',
];

const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

describe('bridge layer / B3 coverage', () => {
  it('declares exactly 137 --b3-* slots', () => {
    expect(declarations).toHaveLength(137);
  });

  it('uses a unique variable name per slot', () => {
    const names = declarations.map((declaration) => declaration.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(137);
  });

  it('accounts for all 147 color slots: 137 taken over + 10 keyword slots', () => {
    expect(declarations.length + EXCLUDED_SLOTS.length).toBe(147);
  });

  it('never defines the 10 excluded keyword slots', () => {
    const names = new Set(declarations.map((declaration) => declaration.name));
    expect(EXCLUDED_SLOTS.filter((slot) => names.has(slot))).toEqual([]);
  });

  it('defines every slot on a bare :root selector (no dark variant)', () => {
    const selectors = [...source.matchAll(/([^{}]+)\{/g)]
      .map((match) => match[1].trim())
      .filter((selector) => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((selector) => !selector.startsWith(':root'))).toEqual([]);
    // 明暗由 --rc-color-* 自动切换（§7.2），bridge 不得出现任何 data-theme-mode 分支。
    expect(selectors.filter((selector) => selector.includes('data-theme-mode'))).toEqual([]);
  });
});

describe('bridge layer / dependency direction', () => {
  it('only forwards to --rc-* contract variables', () => {
    const violations = declarations.flatMap((declaration) => {
      const references = [...declaration.value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
      return references.filter((name) => !name.startsWith('--rc-')).map((name) => declaration.name + ' -> ' + name);
    });
    expect(violations).toEqual([]);
  });

  it('never touches the --md-ref-* raw layer', () => {
    expect(source).not.toContain('--md-ref-');
  });

  it('never writes a literal color value', () => {
    const violations = declarations
      .filter((declaration) => LITERAL_COLOR.test(declaration.value))
      .map((declaration) => declaration.name + ': ' + declaration.value);
    expect(violations).toEqual([]);
  });
});

describe('bridge layer / B25 alpha slots use color-mix()', () => {
  const withColorMix = declarations.filter((declaration) => declaration.value.includes('color-mix('));

  it('expresses at least the 25 alpha slots with color-mix()', () => {
    expect(withColorMix.length).toBeGreaterThanOrEqual(25);
  });

  it('contains no rgba() literal anywhere', () => {
    expect(source).not.toMatch(/\brgba?\(/);
  });

  it('writes color-mix() in oklab with a transparent tail', () => {
    for (const declaration of withColorMix) {
      expect(declaration.value).toContain('color-mix(in oklab,');
      expect(declaration.value).toContain('transparent');
    }
  });
});
