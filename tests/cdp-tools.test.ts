import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 工具脚本是纯 .mjs 且没有 .d.ts，tsc 无法推断其类型；本文件按下面用例里的形状使用它们。
import { probeTokens } from '../scripts/cdp/probes.mjs';
// @ts-expect-error 同上。
import { parseViewport, viewportFor } from '../scripts/cdp/session.mjs';
// @ts-expect-error 同上。
import { frontendUrl, MOBILE_VIEWPORT } from '../scripts/cdp/siyuan.mjs';
// @ts-expect-error 同上。
import { parseExpectations, evaluateCase } from '../scripts/cdp/expectations.mjs';
// @ts-expect-error 同上。
import { findDoubleWrappedColors } from '../scripts/cdp/sandbox.mjs';

const root = join(import.meta.dirname, '..');
const cdpDir = join(root, 'scripts', 'cdp');
const readCdp = (file: string) => readFileSync(join(cdpDir, file), 'utf8');

/** .mjs 没有 .d.ts，这里把基线结构显式写出来，避免 tsc 把参数推成 any。 */
type BaselineCase = { name: string; frontend?: string; viewport?: string; tokens?: Record<string, string> };
type BaselineCheck = { ok: boolean; expected: unknown; actual: string };

/**
 * 架构断言只看代码本身：注释里提到 puppeteer.launch / console.log 不算违规。
 * 行注释用 `(?<!:)` 保护 `http://`，否则 siyuan.mjs 里的 URL 会把后半行吃掉。
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');

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
  });

  it('throws on malformed values', () => {
    for (const value of ['1280', 'abc', '1280x764@', '1280 x 764']) {
      expect(() => parseViewport(value), '非法视口必须报错而不是静默套用默认值：' + value).toThrow(/viewport/);
    }
  });
});

describe('frontend selection', () => {
  it('builds desktop and mobile URLs from separate build entries', () => {
    expect(frontendUrl(6806, 'desktop')).toMatch(/\/stage\/build\/desktop\/\?r=/);
    expect(frontendUrl(6806, 'mobile')).toMatch(/\/stage\/build\/mobile\/\?r=/);
  });

  it('rejects unknown frontends', () => {
    expect(() => frontendUrl(6806, 'tablet'), '拼错前端必须报错，而不是静默用桌面').toThrow(/未知前端/);
  });

  it('defaults to the desktop entry', () => {
    expect(frontendUrl(6806)).toMatch(/\/stage\/build\/desktop\//);
  });

  it('uses the phone viewport for mobile unless one is given', () => {
    // 移动端不是「桌面缩小版」：它有独立构建，视口也必须是手机预设，否则断点全错。
    expect(viewportFor('mobile', undefined)).toEqual(MOBILE_VIEWPORT);
    expect(viewportFor('desktop', undefined).width, '桌面缺省保持 1600').toBe(1600);
    const explicit = { width: 800, height: 600, deviceScaleFactor: 1 };
    expect(viewportFor('mobile', explicit), '显式视口优先').toEqual(explicit);
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

describe('expectations baseline', () => {
  const file = join(root, 'expectations.json');

  it('is valid and non-empty', () => {
    const parsed = parseExpectations(readFileSync(file, 'utf8'), 'expectations.json');
    expect(parsed.cases.length, '基线至少要有一个用例').toBeGreaterThan(0);
    for (const testCase of parsed.cases) {
      expect(testCase.name.length, '用例必须有名字，否则报告里分不清是哪条').toBeGreaterThan(0);
    }
  });

  it('only asserts tokens the theme actually defines', () => {
    // 断言一个主题不存在的令牌，会永远读成空串并永远失败——基线写错最难查。
    const parsed = parseExpectations(readFileSync(file, 'utf8'), 'expectations.json');
    const sources = readdirSync(join(root, 'src', 'styles'))
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(root, 'src', 'styles', name), 'utf8'))
      .join('\n');
    const defined = new Set([...sources.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));

    for (const testCase of parsed.cases) {
      for (const token of Object.keys(testCase.tokens ?? {})) {
        expect(defined.has(token), testCase.name + ' 断言了未定义的令牌：' + token).toBe(true);
      }
    }
  });

  it('covers both frontends', () => {
    // 桌面与移动是两个独立构建入口，只测一个等于放弃另一半。
    const parsed = parseExpectations(readFileSync(file, 'utf8'), 'expectations.json');
    const frontends = new Set(parsed.cases.map((testCase: BaselineCase) => testCase.frontend ?? 'desktop'));
    expect(frontends.has('desktop'), '基线必须覆盖桌面端').toBe(true);
    expect(frontends.has('mobile'), '基线必须覆盖移动端').toBe(true);
  });

  it('marks mobile cases with a phone viewport', () => {
    const parsed = parseExpectations(readFileSync(file, 'utf8'), 'expectations.json');
    for (const testCase of parsed.cases as BaselineCase[]) {
      if (testCase.frontend !== 'mobile') continue;
      expect(testCase.viewport, testCase.name + ' 是移动端用例，必须写明手机视口').toBeTruthy();
    }
  });

  it('evaluates a matching case as passing', () => {
    const checks = evaluateCase(
      { name: 't', tokens: { '--rc-a': '6px' }, probes: [{ label: 'p', html: '<i></i>', expect: { color: 'red' } }] },
      { tokens: { '--rc-a': '6px' }, probes: [{ label: 'p', found: true, styles: { color: 'red' } }] }
    );
    expect(checks.every((check: BaselineCheck) => check.ok)).toBe(true);
  });

  it('evaluates a mismatching case as failing with expected/actual', () => {
    const checks = evaluateCase(
      { name: 't', tokens: { '--rc-a': '6px' } },
      { tokens: { '--rc-a': '8px' }, probes: [] }
    );
    expect(checks[0].ok).toBe(false);
    expect(checks[0].expected).toBe('6px');
    expect(checks[0].actual, '不符项必须带上实际值，否则报告没法定位').toBe('8px');
  });
});

describe('sandbox measurement guards', () => {
  it('detects double-wrapped rgb(var(--b3-*))', () => {
    // 这个 bug 真实发生过：l2 把 --b3-* 桥成完整色值，l3 又包一层 rgb()，
    // rgb(rgb(...)) 是非法值，整条声明被浏览器静默丢弃。
    const problems = findDoubleWrappedColors('.a { color: rgb(var(--b3-theme-on-surface)) }');
    expect(problems).toHaveLength(1);
    expect(problems[0].token).toBe('--b3-theme-on-surface');
  });

  it('accepts the correct single wrap', () => {
    expect(findDoubleWrappedColors('.a { color: var(--b3-theme-on-surface) }')).toEqual([]);
    expect(findDoubleWrappedColors('.a { color: rgb(var(--rc-brand-8)) }'), '--rc-* 存的是通道，rgb() 是对的').toEqual(
      []
    );
  });
});

describe('cdp layering', () => {
  const cliFiles = ['verify.mjs', 'watch.mjs', 'open.mjs'];
  const allFiles = [
    'session.mjs',
    'probes.mjs',
    'siyuan.mjs',
    'theme.mjs',
    'expectations.mjs',
    'sandbox.mjs',
    ...cliFiles,
  ];

  it('starts the browser only in session.mjs and open.mjs', () => {
    // open.mjs 是人工审计入口，需要可见窗口，天然要自己 launch；
    // verify/watch 必须复用 session.mjs，否则生命周期无人统一管理。
    const launchers = allFiles.filter((file) => /puppeteer\.(launch|connect)/.test(stripComments(readCdp(file))));
    expect(launchers.sort()).toEqual(['open.mjs', 'session.mjs']);
  });

  it('imports puppeteer-core only in the two browser owners', () => {
    const importers = allFiles.filter((file) => /from\s+['"]puppeteer-core['"]/.test(stripComments(readCdp(file))));
    expect(importers.sort()).toEqual(['open.mjs', 'session.mjs']);
  });

  it('keeps probes.mjs and sandbox.mjs free of console output', () => {
    for (const file of ['probes.mjs', 'sandbox.mjs', 'expectations.mjs', 'theme.mjs']) {
      expect(stripComments(readCdp(file)), file + ' 只返回数据，打印交给 CLI 层').not.toMatch(/console\.\w+/);
    }
  });

  it('has verify reuse session.mjs and probes.mjs', () => {
    const source = stripComments(readCdp('verify.mjs'));
    expect(source, 'verify 必须复用 session.mjs 的浏览器生命周期').toMatch(/from\s+['"]\.\/session\.mjs['"]/);
    expect(source, 'verify 必须复用 probes.mjs 的探针').toMatch(/from\s+['"]\.\/probes\.mjs['"]/);
    expect(source, 'verify 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
  });

  it('keeps mount judgement in one place', () => {
    // 挂载判定错了，verify 的读数会被张冠李戴。
    for (const file of ['verify.mjs', 'open.mjs']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 必须复用 theme.mjs 的挂载判定/主题名').toMatch(/from\s+['"]\.\/theme\.mjs['"]/);
      expect(source, file + ' 不得自己实现 normalizeThemeName').not.toMatch(/function\s+normalizeThemeName/);
    }
  });

  it('keeps probes.mjs and sandbox.mjs independent of session.mjs', () => {
    // 反向依赖会让探针被迫关心浏览器生命周期，分层就失效了。
    for (const file of ['probes.mjs', 'sandbox.mjs', 'expectations.mjs', 'theme.mjs']) {
      expect(stripComments(readCdp(file)), file + ' 不得依赖 session.mjs').not.toMatch(
        /from\s+['"]\.\/session\.mjs['"]/
      );
    }
  });
});
