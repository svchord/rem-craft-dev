import { describe, expect, it } from 'vitest';
// @ts-expect-error 工具脚本是纯 .mjs 且没有 .d.ts，tsc 无法推断其类型。
import { contrastRatio, parseColor, luminance, runInvariants } from '../scripts/cdp/invariants.mjs';
// @ts-expect-error 同上。
import { tokensIn } from '../scripts/cdp/facts.mjs';

describe('color math', () => {
  it('parses the three token formats the theme uses', () => {
    // L0 存 "R G B" 三通道、l2 桥成 rgb(...)、思源 base.css 用 #hex
    expect(parseColor('32 32 36')).toEqual([32, 32, 36]);
    expect(parseColor('rgb(32 32 36)')).toEqual([32, 32, 36]);
    expect(parseColor('#202024')).toEqual([32, 32, 36]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('')).toBeNull();
    expect(parseColor('none')).toBeNull();
  });

  it('computes WCAG contrast for known pairs', () => {
    // 黑白对比度必须是 21:1，这是 WCAG 的定义
    expect(contrastRatio('rgb(0 0 0)', 'rgb(255 255 255)')).toBe(21);
    expect(contrastRatio('#000', '#fff')).toBe(21);
    // 同色对比度是 1:1
    expect(contrastRatio('rgb(32 32 36)', 'rgb(32 32 36)')).toBe(1);
    // 解析失败返回 null，不能当成 0 或 1
    expect(contrastRatio('rgb(32 32 36)', '')).toBeNull();
  });

  it('orders luminance by perceived brightness', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    // 绿色权重高于红色（WCAG 系数 0.7152 vs 0.2126）
    expect(luminance([0, 255, 0])).toBeGreaterThan(luminance([255, 0, 0]));
  });
});

describe('token extraction', () => {
  it('keeps only contract tokens, drops toolchain runtime vars', () => {
    // --un-* 是 UnoCSS 规则内部的临时变量，脱离那条规则当然读不到值，
    // 把它当令牌会让「令牌无断链」永远失败。
    const css =
      ':root { --rc-brand-8: 0 82 217; --b3-theme-primary: rgb(var(--rc-brand-8)); } .a { --un-bg-opacity: 1; }';
    expect(tokensIn(css)).toEqual(['--rc-brand-8', '--b3-theme-primary']);
  });
});

describe('invariants', () => {
  const baseFacts = {
    frontend: 'browser-desktop',
    tokens: [{ name: '--rc-text-primary', value: '32 32 36' }],
    contrastPairs: [{ label: '正文', role: 'body', foreground: '32 32 36', background: '246 246 246' }],
    bridgePairs: [],
    touchTargets: [],
    probes: [],
    darkTokens: null,
    interactionDiffs: [],
  };

  it('passes when everything holds', () => {
    const verdict = runInvariants(baseFacts);
    expect(verdict.ok).toBe(true);
  });

  it('fails on a broken token', () => {
    const verdict = runInvariants({ ...baseFacts, tokens: [{ name: '--rc-x', value: '' }] });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.map((f: { name: string }) => f.name)).toContain('令牌无断链');
  });

  it('fails when body contrast is below 4.5', () => {
    const verdict = runInvariants({
      ...baseFacts,
      contrastPairs: [{ label: '低对比', role: 'body', foreground: '200 200 200', background: '246 246 246' }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.map((f: { name: string }) => f.name)).toContain('正文对比度 ≥ 4.5（WCAG AA）');
  });

  it('warns but does not fail on low placeholder contrast', () => {
    // 占位符对比度低是常见设计取舍，报 warn 而不是 error
    const verdict = runInvariants({
      ...baseFacts,
      contrastPairs: [{ label: '占位符', role: 'secondary', foreground: '160 160 160', background: '246 246 246' }],
    });
    expect(verdict.ok, 'warn 不应导致失败').toBe(true);
    expect(verdict.warned.length).toBeGreaterThan(0);
  });

  it('fails when a bridge token does not match its source', () => {
    const verdict = runInvariants({
      ...baseFacts,
      bridgePairs: [
        {
          bridge: '--b3-theme-background',
          bridgeValue: 'rgb(255 255 255)',
          source: '--rc-bg-page',
          sourceValue: '246 246 246',
        },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.map((f: { name: string }) => f.name)).toContain('桥接令牌与源令牌一致');
  });

  it('only requires color tokens to change in dark mode', () => {
    // 品牌色与尺寸（radius/space）在暗色下本来就不该变，
    // 把它们算进来会把正确实现判成错误。
    const verdict = runInvariants({
      ...baseFacts,
      tokens: [
        { name: '--rc-brand-8', value: '0 82 217' },
        { name: '--rc-radius-base', value: '6px' },
        { name: '--rc-neutral-1', value: '255 255 255' },
      ],
      darkTokens: [
        { name: '--rc-brand-8', value: '0 82 217' },
        { name: '--rc-radius-base', value: '6px' },
        { name: '--rc-neutral-1', value: '28 29 32' },
      ],
    });
    expect(verdict.ok, '品牌色与尺寸不变是正常的').toBe(true);
  });

  it('fails when a neutral token does not change in dark mode', () => {
    const verdict = runInvariants({
      ...baseFacts,
      tokens: [{ name: '--rc-neutral-1', value: '255 255 255' }],
      darkTokens: [{ name: '--rc-neutral-1', value: '255 255 255' }],
    });
    expect(verdict.ok).toBe(false);
  });

  it('skips hover invariants on mobile', () => {
    // 触摸设备没有 hover，驱动不到是正常的
    const verdict = runInvariants({
      ...baseFacts,
      frontend: 'browser-mobile',
      interactionDiffs: [{ label: '菜单项 hover', found: true, triggered: false, changedCount: 0 }],
    });
    expect(verdict.ok).toBe(true);
  });

  it('fails on desktop when a hover pseudo-class is not triggered', () => {
    const verdict = runInvariants({
      ...baseFacts,
      interactionDiffs: [{ label: '菜单项 hover', found: true, triggered: false, changedCount: 0 }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.map((f: { name: string }) => f.name)).toContain('交互能被驱动（伪类确实命中）');
  });

  it('survives an invariant that throws', () => {
    // 不变量自身出错不能把整个审计带崩
    const verdict = runInvariants({ ...baseFacts, tokens: null });
    expect(verdict.results.length).toBeGreaterThan(0);
    expect(verdict.failed.some((f: { detail: string }) => /不变量自身出错/.test(f.detail))).toBe(true);
  });
});
