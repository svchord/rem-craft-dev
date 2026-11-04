/**
 * 被测目标的**契约**与注册表。
 *
 * 主题和插件是思源里现成的两类，但思源的安装目录不止这两种（widgets、icons、
 * templates 各有一套清单与加载方式）。与其在代码里写死 `kind === 'theme'` 分支，
 * 不如把「一类被测对象」抽象成一个描述符，让新类型能注册进来：
 *
 *   registerTargetType('widget', { ... })    // 未来要支持 widget 时加这一处
 *
 * 描述符必须提供的能力（缺一个 dev.mjs 就会长出类型分支，测试会拦住）：
 *
 *   manifestName()                   清单文件名，如 'theme.json'
 *   installSubdir()                  安装子目录，如 'themes'
 *   dirEnv()                         覆盖安装目录的环境变量名
 *   outDir()                         构建产物目录
 *   artifact()                       首个产物（等它出现即视为构建就绪）
 *   expectedFiles()                  链接后必须存在的文件
 *   matchArtifact(name)              产物变化时是否触发重载
 *   reload(page, ctx)                让页面用上新产物
 *   resolveCss(ctx)                  要审计的 CSS 文本
 *   mountState(page, ctx)            确认被测对象确实加载了
 *
 * 可选能力：
 *   activate(page, ctx)               开发前让宿主用上这个对象。
 *                                     （主题需经 kernel 切 themeLight/themeDark；
 *                                      插件由思源自己管启用状态，不实现）
 */

/** 所有类型共有的字段校验：缺哪个就明确说哪个，不要等到运行到一半才炸。 */
const REQUIRED_CAPABILITIES = [
  'manifestName',
  'installSubdir',
  'outDir',
  'artifact',
  'expectedFiles',
  'matchArtifact',
  'reload',
  'resolveCss',
  'mountState',
];

/** 类型注册表。key 是类型名（theme / plugin / 未来新增）。 */
const TYPES = new Map();

/**
 * 注册一类被测对象。
 *
 * @param kind         类型名，同时用作 CLI 的 --kind 取值
 * @param descriptor   能力描述符（见文件头）
 * @param options.detect  可选：给定项目目录返回 true 表示「这个目录是该类型」，
 *                        用于从 public/*.json 自动推断类型
 */
export function registerTargetType(kind, descriptor, { detect = null } = {}) {
  const missing = REQUIRED_CAPABILITIES.filter((name) => typeof descriptor[name] !== 'function');
  if (missing.length) {
    throw new Error(
      '注册被测类型 ' +
        kind +
        ' 失败：缺少 ' +
        missing.join('、') +
        '\n' +
        '  这些能力是开发链路必需的，缺一个就会让 dev.mjs 长出类型分支。'
    );
  }
  TYPES.set(kind, { ...descriptor, kind, detect });
  return kind;
}

/** 已注册的类型名。 */
export function targetTypes() {
  return [...TYPES.keys()];
}

/** 取某个类型的描述符；未注册时把可用类型列出来。 */
export function targetType(kind) {
  const found = TYPES.get(kind);
  if (!found) {
    throw new Error('未知的被测类型：' + kind + '（已注册：' + targetTypes().join(' / ') + '）');
  }
  return found;
}

/**
 * 从项目目录推断类型：看 public/ 下存在哪份清单。
 *
 * 这是「不用在引用项目里写脚本」的关键——`siyuan-devtools dev` 不带 --kind 时，
 * 靠 theme.json / plugin.json 的存在与否自己判断，用户什么都不用配。
 *
 * @returns { ok: true, kind } | { ok: false, reason }
 */
export function detectTargetType(cwd) {
  const matches = [];
  for (const [kind, entry] of TYPES) {
    if (entry.detect && entry.detect(cwd)) matches.push(kind);
  }
  if (matches.length === 1) return { ok: true, kind: matches[0] };
  if (matches.length === 0) {
    return {
      ok: false,
      reason:
        '在 ' + cwd + ' 的 public/ 下找不到任何已知清单（' + targetTypes().join(' / ') + '），请用 --kind 显式指定类型',
    };
  }
  return {
    ok: false,
    reason: '同时匹配到多种类型：' + matches.join('、') + '，请用 --kind 指定',
  };
}
