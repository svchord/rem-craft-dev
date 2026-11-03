import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 工具脚本是纯 .mjs 且没有 .d.ts，tsc 无法推断其类型；本文件按下面用例里的形状使用它们。
import { parseSelectors, probeTokens } from '../scripts/cdp/probes.mjs';
// @ts-expect-error 同上；补齐声明文件属于 scripts/cdp 的改动范围，不在本测试文件里做。
import { parseViewport, runActions } from '../scripts/cdp/session.mjs';

const root = join(import.meta.dirname, '..');
const cdpDir = join(root, 'scripts', 'cdp');
const readCdp = (file: string) => readFileSync(join(cdpDir, file), 'utf8');

/**
 * 架构断言只看代码本身：注释里提到 puppeteer.launch / console.log 不算违规。
 * 行注释用 `(?<!:)` 保护 `http://`，否则 siyuan.mjs 里的 URL 会把后半行吃掉。
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');

describe('parseSelectors', () => {
  it('ignores selectors that only live in comments', () => {
    const css = `/* .commented-out { color: red } */
    .b3-menu__item { color: red }`;
    expect(parseSelectors(css), '注释里的选择器不得进入清单').toEqual(['.b3-menu__item']);
  });

  it('splits comma groups into separate selectors', () => {
    const selectors = parseSelectors('.b3-menu__item, .b3-menu__separator { color: red }');
    expect(selectors, '逗号分组必须拆开，否则命中率统计会把整串当成一个选择器').toEqual([
      '.b3-menu__item',
      '.b3-menu__separator',
    ]);
  });

  it('skips at-rules but keeps the rules nested inside them', () => {
    const css = `@import './l0-tokens.css';
    @font-face { font-family: X; src: url(x.woff2) }
    @media (max-width: 600px) { .dock__item { display: none } }`;
    const selectors = parseSelectors(css);
    expect(selectors, '@media 自身的 prelude 不是选择器，内层规则必须保留').toEqual(['.dock__item']);
    expect(
      selectors.some((selector: string) => selector.startsWith('@')),
      'at-rule prelude 泄漏进选择器清单会让命中率统计失真'
    ).toBe(false);
  });

  it('deduplicates repeated selectors', () => {
    const css = `.b3-menu__item { color: red }
    .b3-menu__item { padding: 0 }
    .dock__item { color: blue }`;
    expect(parseSelectors(css), '同一选择器多次出现应只保留一次').toEqual(['.b3-menu__item', '.dock__item']);
  });

  // @keyframes 的 from/to/百分比是动画关键帧，不是选择器；漏掉会让 audit 报出一堆永远 miss 的假条目。
  it('drops @keyframes blocks instead of treating keyframes as selectors', () => {
    const css = `@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
    @-webkit-keyframes k { 0% { opacity: 0 } 100% { opacity: 1 } }
    .b3-menu__item { color: red }`;
    expect(parseSelectors(css), '关键帧不得进入选择器清单').toEqual(['.b3-menu__item']);
  });

  // 属性值与 :is()/:not() 里可以合法出现逗号，按裸逗号切分会切出永远 miss 的假选择器。
  it('splits only on top-level commas', () => {
    const css = `[data-x="a,b"] { color: red }
    :is(.a, .b) .c { color: blue }
    .d, .e { color: green }`;
    expect(parseSelectors(css), '引号与括号内的逗号不是分隔符').toEqual([
      '[data-x="a,b"]',
      ':is(.a, .b) .c',
      '.d',
      '.e',
    ]);
  });

  // 构建产物不在版本库里（.gitignore 忽略 dist/dev），CI 上跳过，本地构建后自动生效。
  const builtCss = [join(root, 'dist', 'theme.css'), join(root, 'dev', 'theme.css')].find(existsSync) ?? '';

  it.skipIf(!builtCss)('parses a real theme build', () => {
    const selectors = parseSelectors(readFileSync(builtCss, 'utf8'));
    expect(selectors.length, '真实产物应解析出多个选择器').toBeGreaterThan(5);
    expect(selectors, '主题产物必须包含 .b3-menu__item 规则').toContain('.b3-menu__item');
    expect(
      selectors.some((selector: string) => selector.includes('/*') || selector.startsWith('@')),
      '真实产物里不应残留注释或 at-rule'
    ).toBe(false);
  });

  // dist 与 dev 都被 .gitignore 忽略，CI 上没有产物；源码是版本库里的，能保证这条断言始终有效。
  it('parses the committed theme sources', () => {
    const stylesDir = join(root, 'src', 'styles');
    const css = readdirSync(stylesDir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(join(stylesDir, file), 'utf8'))
      .join('\n');
    const selectors = parseSelectors(css);

    expect(selectors.length, '主题源码应解析出多个选择器').toBeGreaterThan(5);
    expect(selectors, '主题源码必须包含 .b3-menu__item 规则').toContain('.b3-menu__item');
    expect(
      selectors.filter((selector: string) => selector.startsWith('@') || selector.includes('/*')),
      '注释与 at-rule 不得进入选择器清单'
    ).toEqual([]);
  });
});

describe('parseViewport', () => {
  it('parses 宽x高 with the default device scale factor', () => {
    expect(parseViewport('1280x764'), '缺省 DPR 必须是 1').toEqual({
      width: 1280,
      height: 764,
      deviceScaleFactor: 1,
    });
  });

  it('parses the @DPR suffix', () => {
    expect(parseViewport('1280x764@2').deviceScaleFactor, '@DPR 必须覆盖默认值').toBe(2);
    expect(parseViewport('1280x764@1.5').deviceScaleFactor, 'DPR 允许小数').toBe(1.5);
  });

  it('returns the fallback when no value is given', () => {
    expect(parseViewport(undefined), '未传 --viewport 时用桌面视口').toEqual({
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
    });
    expect(parseViewport(''), '空串等同于未传，不能抛错').toEqual({
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
    });
    const fallback = { width: 800, height: 600, deviceScaleFactor: 2 };
    expect(parseViewport(undefined, fallback), '显式 fallback 必须被采用').toEqual(fallback);
  });

  it('throws on malformed values', () => {
    for (const value of ['1280', 'abc', '1280x764@', '1280 x 764']) {
      expect(() => parseViewport(value), '非法视口必须报错而不是静默套用默认值：' + value).toThrow(/viewport/);
    }
  });
});

describe('probeTokens', () => {
  /**
   * probeTokens 的读数逻辑跑在浏览器里，Node 侧只拿返回值；用最小 DOM 桩执行它注入的函数，
   * 钉住「扁平 { 令牌: 值 }」这个对外契约——写成 { resolved, declared } 会让调用方静默读到 undefined。
   */
  function stubPage(values: Record<string, string>) {
    return {
      evaluate: (fn: (names: string[]) => Record<string, string>, names: string[]) => {
        const globals = globalThis as unknown as Record<string, unknown>;
        // 只还原真的存在的键：把 document 留成 undefined 会污染同进程里后续的用例。
        const patched = {
          document: { documentElement: {} },
          getComputedStyle: () => ({ getPropertyValue: (name: string) => values[name] ?? '' }),
        };
        const missing = Object.keys(patched).filter((key) => !(key in globals));
        Object.assign(globals, patched);
        try {
          return fn(names);
        } finally {
          for (const key of missing) delete globals[key];
        }
      },
    };
  }

  it('returns a flat { token: value } map with trimmed values', async () => {
    const tokens = await probeTokens(stubPage({ '--rc-brand-8': ' 0 82 217 ', '--rc-radius-base': '6px' }), [
      '--rc-brand-8',
      '--rc-radius-base',
      '--rc-missing',
    ]);

    expect(tokens, 'probeTokens 返回扁平对象，不是 { resolved, declared }').toEqual({
      '--rc-brand-8': '0 82 217',
      '--rc-radius-base': '6px',
      '--rc-missing': '',
    });
    expect(tokens['--rc-missing'], '未定义的令牌在计算样式里就是空串，不能变成 undefined').toBe('');
  });
});

describe('runActions validation', () => {
  // 只覆盖「在碰页面之前就抛错」的分支，因此不需要浏览器。
  const session = { page: {} };

  it('accepts an empty action list without touching the page', async () => {
    await expect(runActions(session, []), '空动作列表应原样返回空日志').resolves.toEqual([]);
  });

  it('rejects unknown verbs with the available verb list', async () => {
    await expect(runActions(session, ['nope:1']), '拼错动词必须报错，而不是静默跳过').rejects.toThrow(/未知动作/);
  });

  it('rejects axis actions without a value', async () => {
    for (const action of ['style:', 'palette:', 'mode:', 'density:']) {
      await expect(runActions(session, [action]), action + ' 缺取值必须报错').rejects.toThrow(/需要一个取值/);
    }
  });

  it('rejects malformed attr and doc actions', async () => {
    await expect(runActions(session, ['attr:data-frontend']), 'attr 缺 = 必须报错').rejects.toThrow(/名=值/);
    await expect(runActions(session, ['doc:custom-rc-width']), 'doc 缺 = 必须报错').rejects.toThrow(/名=值/);
    await expect(runActions(session, ['feature:']), 'feature 缺名称必须报错').rejects.toThrow(/需要名称/);
  });
});

describe('cdp layering', () => {
  const cliFiles = ['inspect.mjs', 'audit.mjs'];
  const allFiles = ['session.mjs', 'probes.mjs', 'siyuan.mjs', ...cliFiles];

  it('starts the browser only in session.mjs', () => {
    for (const file of allFiles) {
      const source = stripComments(readCdp(file));
      for (const call of ['puppeteer.launch', 'puppeteer.connect']) {
        const found = source.includes(call);
        const detail = found ? '不该出现 ' + call + '：' : 'session.mjs 里找不到 ' + call + '：';
        expect(found, detail + file).toBe(file === 'session.mjs');
      }
    }
  });

  it('imports puppeteer-core only in session.mjs', () => {
    const importers = allFiles.filter((file) => /from\s+['"]puppeteer-core['"]/.test(stripComments(readCdp(file))));
    expect(importers, '浏览器依赖必须收敛在 session.mjs，否则生命周期无人统一管理').toEqual(['session.mjs']);
  });

  it('keeps probes.mjs free of console output', () => {
    expect(stripComments(readCdp('probes.mjs')), '探针只返回数据，打印交给 CLI 层').not.toMatch(/console\.\w+/);
  });

  it('has the CLI layer reuse session.mjs and probes.mjs', () => {
    for (const file of cliFiles) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 必须复用 session.mjs 的浏览器生命周期').toMatch(/from\s+['"]\.\/session\.mjs['"]/);
      expect(source, file + ' 必须复用 probes.mjs 的探针').toMatch(/from\s+['"]\.\/probes\.mjs['"]/);
      expect(source, file + ' 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
    }
  });

  it('has probes.mjs stay independent of session.mjs', () => {
    // 反向依赖会让探针被迫关心浏览器生命周期，分层就失效了。
    expect(stripComments(readCdp('probes.mjs')), 'probes.mjs 不得依赖 session.mjs').not.toMatch(
      /from\s+['"]\.\/session\.mjs['"]/
    );
  });
});
