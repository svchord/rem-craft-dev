/**
 * 不变量：与「当前值是多少」无关、可以客观判定对错的规则。
 *
 * 与 expectations.json 的区别（这是设计上的关键分界）：
 *
 *   expectations.json（旧）记录「上次跑出来是什么」，只能回答「变了没」，
 *   回答不了「对不对」。改个 padding 就要手动 --update，而如果基线里抄了
 *   一个错值，它就永远绿。
 *
 *   本文件编码「设计意图」：对比度够不够、触摸目标够不够大、令牌有没有断链、
 *   桥接值是否等于源值、暗色是否真的和亮色不同。这些与具体数值无关，
 *   改了样式也不会误报——只要意图还成立。
 *
 * 每条不变量返回 { ok, detail }，detail 是给人（和 agent）看的证据。
 */

const PREFIX = '[invariant] ';

// ---------- 颜色工具（纯函数，可单测） ----------

/** "32 32 36" / "rgb(32 32 36)" / "#202024" → [32,32,36]；解析不了返回 null。 */
export function parseColor(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) {
      return [...hex].map((c) => parseInt(c + c, 16));
    }
    if (hex.length === 6) {
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    return null;
  }

  const numbers = text.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;
  return numbers.slice(0, 3).map(Number);
}

/** WCAG 相对亮度。 */
export function luminance([r, g, b]) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度，返回 1–21 的两位小数；任一侧解析不了返回 null。 */
export function contrastRatio(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// ---------- 不变量定义 ----------

/**
 * 每一条不变量：
 *   name     标识
 *   severity 'error'（违反即失败）| 'warn'（提示，不失败）
 *   run(facts) → { ok, detail }
 *
 * facts 由 verify 在真实页面上采集，形状见 collectFacts 的注释。
 */
export const INVARIANTS = [
  {
    name: '令牌无断链',
    severity: 'error',
    run(facts) {
      const broken = facts.tokens.filter((t) => !t.value);
      if (!broken.length) return { ok: true, detail: '所有 ' + facts.tokens.length + ' 个令牌都有值' };
      return {
        ok: false,
        detail: '这些令牌解析为空（可能只定义在别的模式，或 var() 链断了）：' + broken.map((t) => t.name).join('、'),
      };
    },
  },

  {
    name: '桥接令牌与源令牌一致',
    severity: 'error',
    run(facts) {
      const mismatched = [];
      for (const pair of facts.bridgePairs ?? []) {
        // 比较归一化后的颜色，避免 "rgb(0 82 217)" 与 "#0052d9" 被当成不同。
        const a = parseColor(pair.bridgeValue);
        const b = parseColor(pair.sourceValue);
        if (!a || !b) {
          mismatched.push(
            pair.bridge + '（' + pair.bridgeValue + '）或 ' + pair.source + '（' + pair.sourceValue + '）解析不了'
          );
          continue;
        }
        if (a.join() !== b.join()) {
          mismatched.push(pair.bridge + '=' + pair.bridgeValue + ' ≠ ' + pair.source + '=' + pair.sourceValue);
        }
      }
      if (!mismatched.length) {
        return { ok: true, detail: (facts.bridgePairs ?? []).length + ' 对桥接令牌一致' };
      }
      return { ok: false, detail: '桥接值与源值不一致：' + mismatched.join('；') };
    },
  },

  {
    name: '正文对比度 ≥ 4.5（WCAG AA）',
    severity: 'error',
    run(facts) {
      const failures = [];
      for (const pair of facts.contrastPairs.filter((p) => p.role === 'body')) {
        const ratio = contrastRatio(pair.foreground, pair.background);
        if (ratio === null) {
          failures.push(pair.label + '（颜色解析失败）');
        } else if (ratio < 4.5) {
          failures.push(pair.label + ' = ' + ratio + ':1');
        }
      }
      if (!failures.length) return { ok: true, detail: '全部达标' };
      return { ok: false, detail: '低于 4.5:1：' + failures.join('；') };
    },
  },

  {
    name: '次要文本/占位符对比度 ≥ 3（WCAG AA 大字）',
    severity: 'warn',
    run(facts) {
      const failures = [];
      for (const pair of facts.contrastPairs.filter((p) => p.role === 'secondary')) {
        const ratio = contrastRatio(pair.foreground, pair.background);
        if (ratio !== null && ratio < 3) failures.push(pair.label + ' = ' + ratio + ':1');
      }
      if (!failures.length) return { ok: true, detail: '全部达标' };
      return { ok: false, detail: '低于 3:1（大字/占位符可放宽，但请确认）: ' + failures.join('；') };
    },
  },

  {
    name: '暗色模式确实覆盖了中性色',
    severity: 'error',
    run(facts) {
      if (!facts.darkTokens) return { ok: true, detail: '未采集暗色令牌，跳过' };
      // 只查颜色类令牌：品牌色与尺寸（radius/space）在暗色下**本来就不该变**，
      // 查它们会把正确实现判成错误。
      const shouldChange = facts.darkTokens.filter((token) =>
        /^--(rc|b3)-(neutral-\d|bg-|text-|border-\d|border-color|theme-background|theme-on)/.test(token.name)
      );
      if (!shouldChange.length) return { ok: true, detail: '没有需要随明暗切换的令牌' };

      const unchanged = [];
      for (const token of shouldChange) {
        const light = facts.tokens.find((t) => t.name === token.name);
        if (light && light.value && token.value && light.value === token.value) unchanged.push(token.name);
      }
      if (!unchanged.length) {
        return { ok: true, detail: shouldChange.length + ' 个中性/背景令牌在暗色下都变了' };
      }
      return {
        ok: false,
        detail: '这些中性/背景令牌在暗色下没变（可能忘了写覆盖）：' + unchanged.join('、'),
      };
    },
  },

  {
    name: '移动端触摸目标 ≥ 44px',
    severity: 'error',
    run(facts) {
      if (!facts.touchTargets?.length) return { ok: true, detail: '无移动端触摸目标数据，跳过' };
      const small = facts.touchTargets.filter((t) => t.height < 44 || t.width < 44);
      if (!small.length) return { ok: true, detail: facts.touchTargets.length + ' 个目标全部达标' };
      return {
        ok: false,
        detail: small.map((t) => t.label + ' = ' + Math.round(t.width) + '×' + Math.round(t.height)).join('；'),
      };
    },
  },

  {
    name: '交互能被驱动（伪类确实命中）',
    severity: 'error',
    run(facts) {
      // 注意：这里只判「交互是否真的发生」，不判「必须变化」。
      // 主题没给某个元素写 :hover 是正常设计，交互后不变不算错；
      // 但伪类没命中说明交互根本没驱动起来，那后面所有交互断言都不可信。
      //
      // 移动端例外：触摸设备没有 hover，驱动不到是正常的，跳过。
      if (facts.frontend?.includes('mobile')) {
        return { ok: true, detail: '移动端无 hover 概念，跳过' };
      }
      const notTriggered = (facts.interactionDiffs ?? []).filter((diff) => diff.found && diff.triggered === false);
      if (!notTriggered.length) return { ok: true, detail: '交互均已驱动' };
      return {
        ok: false,
        detail: '这些交互没有命中目标（伪类未激活）：' + notTriggered.map((d) => d.label).join('、'),
      };
    },
  },

  {
    name: '交互态若有样式声明则应有可见变化',
    severity: 'warn',
    run(facts) {
      // 移动端无 hover，这条不适用。
      if (facts.frontend?.includes('mobile')) return { ok: true, detail: '移动端无 hover，跳过' };
      // 主题 CSS 里写了 :hover 之类，实际却没变化 —— 多半被外部样式覆盖了。
      const noChange = (facts.interactionDiffs ?? []).filter(
        (diff) => diff.found && diff.triggered && diff.expectChange && diff.changedCount === 0
      );
      if (!noChange.length) return { ok: true, detail: '声明了交互样式的元素都有可见变化' };
      return {
        ok: false,
        detail: '主题声明了交互样式但没生效（可能被 base.css 覆盖）：' + noChange.map((d) => d.label).join('、'),
      };
    },
  },

  {
    name: '组件配方未被外部样式覆盖',
    severity: 'warn',
    run(facts) {
      // 主题自己的规则如果被思源 base.css 盖掉，计算值会来自 base.css。
      // 判据：主题 CSS 里写了这个属性，但计算值与主题声明的不符。
      const overridden = [];
      for (const probe of facts.probes ?? []) {
        for (const [prop, declared] of Object.entries(probe.declared ?? {})) {
          const actual = probe.styles?.[prop];
          if (actual && declared && actual !== declared) {
            overridden.push(probe.label + ' ' + prop + '：主题声明 ' + declared + '，实际 ' + actual);
          }
        }
      }
      if (!overridden.length) return { ok: true, detail: '主题声明都生效了' };
      return { ok: false, detail: overridden.join('；') };
    },
  },
];

/** 跑所有不变量，返回 { passed, failed, warned, results }。 */
export function runInvariants(facts) {
  const results = [];
  for (const invariant of INVARIANTS) {
    let outcome;
    try {
      outcome = invariant.run(facts);
    } catch (error) {
      outcome = { ok: false, detail: '不变量自身出错：' + (error instanceof Error ? error.message : String(error)) };
    }
    results.push({ name: invariant.name, severity: invariant.severity, ...outcome });
  }

  const failed = results.filter((r) => !r.ok && r.severity === 'error');
  const warned = results.filter((r) => !r.ok && r.severity === 'warn');
  return {
    results,
    passed: results.filter((r) => r.ok).length,
    failed,
    warned,
    ok: failed.length === 0,
  };
}

export { PREFIX };
