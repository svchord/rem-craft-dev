/**
 * 主题身份与挂载判定：只读文件 + 纯字符串处理，不碰浏览器。
 *
 * 这里是**纯逻辑**，具体实现见 targets.ts 的 theme 描述符：
 *   mountState() 用 judgeMount() 判断页面挂的是不是本主题
 *
 * 之前这里另写了一份挂载解析、描述符又另写一份，行为不一致
 * （judgeMount 支持前缀匹配，mountState 不支持）。现在单一来源。
 *
 * 不 import targets.ts，避免循环依赖（那边要 import 本文件）。
 */
import { readFileSync } from 'node:fs';
/**
 * 读主题名：从清单的 name 字段取。
 *
 * 缺省按「当前工作目录下 public/theme.json → dist/theme.json」找。
 * 与 targets.ts 的 readManifestName 是同一件事，但那边要造 Target、
 * 这里只想显示个名字；为避免循环依赖，各自保留一小段读文件的代码。
 *
 * @param manifestPaths 候选清单路径，按顺序试
 * @param fallback      都读不到时的兜底值（缺省 null，表示「不知道」）
 */
export function readThemeName(manifestPaths, fallback = null) {
    const candidates = manifestPaths ?? ['./public/theme.json', './dist/theme.json'];
    for (const file of candidates) {
        try {
            const name = JSON.parse(readFileSync(file, 'utf8')).name;
            if (name)
                return String(name).trim();
        }
        catch {
            // 继续下一个候选
        }
    }
    return fallback;
}
/** 目录名与 manifest 的 name 一致；比较时忽略大小写与空格/连字符的写法差异。 */
const normalizeThemeName = (name) => name.toLowerCase().replace(/[\s_-]+/g, '');
/**
 * 判断页面挂的是不是指定主题。
 *
 * 允许前缀匹配：装了发布版 `X` 而本地目录叫 `X Dev` 时仍是同一个主题，
 * 但要把「测的不是 dev 目录」讲清楚，否则结论会被张冠李戴。
 *
 * themeName 为空时只判断「有没有挂自定义主题」，不比对具体名字。
 */
export function judgeMount(href, themeName) {
    if (!href) {
        return {
            ok: false,
            exact: false,
            loaded: null,
            reason: '页面里没有 themeStyle（用的是内置 daylight/midnight）',
        };
    }
    const segment = href.match(/\/appearance\/themes\/([^/]+)\//)?.[1] ?? null;
    if (!segment) {
        return { ok: false, exact: false, loaded: null, reason: `themeStyle 的 href 不是主题目录路径：${href}` };
    }
    const loaded = decodeURIComponent(segment);
    // 没给期望名时只报「加载了谁」，不判对错。
    if (!themeName) {
        return { ok: true, exact: false, loaded, reason: null };
    }
    const expected = normalizeThemeName(themeName);
    const actual = normalizeThemeName(loaded);
    const exact = actual === expected;
    const ok = exact ||
        (actual.length >= 4 && expected.startsWith(actual)) ||
        (expected.length >= 4 && actual.startsWith(expected));
    return { ok, exact, loaded, reason: ok ? null : `宿主加载的是 ${loaded}，不是 ${themeName}` };
}
//# sourceMappingURL=theme.js.map