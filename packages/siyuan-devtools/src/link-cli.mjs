/**
 * 链接 CLI：把构建产物目录链接到思源安装目录。
 *
 *   siyuan-link                       # 主题模式：dev/ → <workspace>/data/themes/<name>
 *   siyuan-link --plugin              # 插件模式：dev/ → <workspace>/data/plugins/<name>
 *   siyuan-link --check               # 只检查现状，不修改
 *   siyuan-link --workspace D:\ws     # 显式指定工作区
 *   siyuan-link --src ./dist          # 链接别的目录（缺省 dev/）
 *
 * 与 `siyuan-dev` 的关系：`siyuan-dev` 默认会自己建链接，所以单独跑这个命令
 * 主要用于「先链好、再单独起构建」的场景，以及 CI 里检查链接是否正确。
 *
 * 退出码：链接正确/已建立为 0，冲突或失败为 1，参数错误为 2。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkLinkedFiles, ensureLink, inspectLink } from './link.mjs';
import { pluginTarget, themeTarget } from './targets.mjs';
import { readThemeName } from './theme.mjs';

const PREFIX = '[link] ';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const takeValue = (flag) => {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(PREFIX + flag + ' 需要一个参数');
    process.exit(2);
  }
  return value;
};

function readPluginName(cwd) {
  for (const file of [join(cwd, 'public', 'plugin.json'), join(cwd, 'dist', 'plugin.json')]) {
    if (!existsSync(file)) continue;
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      if (name) return String(name).trim();
    } catch {
      // 继续
    }
  }
  return null;
}

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runCli() {
  const kind = has('--plugin') ? 'plugin' : 'theme';
  const cwd = takeValue('--dir') ?? process.cwd();
  const srcDir = resolve(cwd, takeValue('--src') ?? 'dev');
  const workspace = takeValue('--workspace');
  const checkOnly = has('--check');

  // 先定名字，再构造 target：pluginTarget 缺少 name 会直接抛错。
  const name = takeValue('--name') ?? (kind === 'plugin' ? readPluginName(cwd) : readThemeName());
  if (!name) {
    console.error(PREFIX + '读不到' + (kind === 'plugin' ? '插件' : '主题') + '名，用 --name 指定');
    process.exit(2);
  }

  const target = kind === 'plugin' ? pluginTarget({ name }) : themeTarget({ themeName: name });

  let installDir;
  try {
    installDir = await target.installDir({ workspace, port: null });
  } catch (cause) {
    console.error(PREFIX + (cause instanceof Error ? cause.message : String(cause)));
    process.exit(1);
  }

  const targetPath = join(installDir, name);

  if (checkOnly) {
    const state = inspectLink(srcDir, targetPath);
    console.log(PREFIX + '源：  ' + srcDir);
    console.log(PREFIX + '目标：' + targetPath);
    console.log(PREFIX + '状态：' + state.state + (state.reason ? '（' + state.reason + '）' : ''));
    process.exit(state.state === 'linked' ? 0 : 1);
  }

  if (!existsSync(srcDir)) {
    console.error(PREFIX + '源目录不存在：' + srcDir);
    console.error(PREFIX + '提示：先跑一次构建（siyuan-dev 或 pnpm build）');
    process.exit(1);
  }

  const result = ensureLink(srcDir, targetPath, { kind });
  if (!result.ok) {
    console.error(PREFIX + result.reason);
    process.exit(1);
  }

  console.log(PREFIX + (result.changed ? '已建立链接（' + result.linkType + '）：' : '链接已存在：') + targetPath);

  const expected = kind === 'plugin' ? ['index.js', 'plugin.json'] : ['theme.css', 'theme.json'];
  const files = checkLinkedFiles(targetPath, expected);
  if (!files.ok) {
    console.log(PREFIX + '提示：链接目录里还缺 ' + files.missing.join('、') + '，思源可能加载不到');
  }
  process.exit(0);
}
