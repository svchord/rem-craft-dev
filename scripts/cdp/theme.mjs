/**
 * 主题身份与挂载判定：只读文件 + 纯字符串处理，不碰浏览器。
 *
 * 回答两个问题：
 *   1. 本主题叫什么（目录名与 manifest 的 name 一致）
 *   2. 页面上跑的是不是本主题
 */
import { readFileSync } from 'node:fs';

const FALLBACK_THEME_NAME = 'Rem Craft';

export function readThemeName() {
  for (const file of ['./public/theme.json', './dist/theme.json']) {
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (name) return String(name).trim();
    } catch {
      // 继续下一个候选
    }
  }
  return FALLBACK_THEME_NAME;
}

/** 目录名与 manifest 的 name 一致；比较时忽略大小写与空格/连字符的写法差异。 */
const normalizeThemeName = (name) => name.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * 判断页面挂的是不是本主题。
 *
 * 允许前缀匹配：装了发布版 `Rem Craft` 而本地目录叫 `Rem Craft Dev` 时仍是本主题，
 * 但要把「测的不是 dev 目录」讲清楚，否则回归结论会被张冠李戴。
 */
export function judgeMount(href, themeName) {
  if (!href) {
    return { ok: false, exact: false, loaded: null, reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）' };
  }

  const segment = href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
  if (!segment) {
    return { ok: false, exact: false, loaded: null, reason: 'themeStyle 的 href 不是主题目录路径：' + href };
  }

  const loaded = decodeURIComponent(segment);
  const expected = normalizeThemeName(themeName);
  const actual = normalizeThemeName(loaded);
  const exact = actual === expected;
  const ok =
    exact ||
    (actual.length >= 4 && expected.startsWith(actual)) ||
    (expected.length >= 4 && actual.startsWith(expected));

  return { ok, exact, loaded, reason: ok ? null : '宿主加载的是 ' + loaded + '，不是 ' + themeName };
}
