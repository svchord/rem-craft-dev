import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = join(import.meta.dirname, '..', 'src', 'styles');
const read = (file: string) => readFileSync(join(stylesDir, file), 'utf8');
/** 去掉注释后再做语法检查，注释里提到 @layer 不算违规。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styleFiles = readdirSync(stylesDir).filter((file) => file.endsWith('.css'));

/** 收集所有 --rc-* 定义（含 fallback 之外的定义行）。 */
function definedTokens(): Set<string> {
  const defined = new Set<string>();
  for (const file of styleFiles) {
    for (const match of read(file).matchAll(/^\s*(--rc-[\w-]+)\s*:/gm)) {
      defined.add(match[1]);
    }
  }
  return defined;
}

/** 收集组件/变体层里引用到的 --rc-* 变量。 */
function usedTokens(): Set<string> {
  const used = new Set<string>();
  for (const file of styleFiles) {
    if (file.startsWith('l0-') || file.startsWith('l1-')) {
      continue;
    }
    for (const match of read(file).matchAll(/var\((--rc-[\w-]+)/g)) {
      used.add(match[1]);
    }
  }
  return used;
}

describe('css architecture', () => {
  it('never uses @layer (unlayered app css would win the cascade)', () => {
    for (const file of styleFiles) {
      expect(stripComments(read(file)), file).not.toContain('@layer');
    }
  });

  it('every referenced --rc-* token is defined', () => {
    const defined = definedTokens();
    const missing = [...usedTokens()].filter((token) => !defined.has(token));
    expect(missing).toEqual([]);
  });

  it('component and variant layers do not hardcode colors', () => {
    for (const file of styleFiles.filter((name) => name.startsWith('l3-') || name.startsWith('l4-'))) {
      expect(read(file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(read(file), file).not.toMatch(/rgba?\(\s*\d/);
    }
  });

  it('imports layers in order', () => {
    const index = read('index.css');
    const order = ['l0-tokens', 'l1-semantic', 'l2-bridge', 'l3-components', 'l4-variants'];
    const positions = order.map((name) => index.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
