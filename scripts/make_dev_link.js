/**
 * 把 dev/ 链接到 <workspace>/data/themes/<name>，让思源直接读构建产物。
 *
 * 通用能力来自 siyuan-devtools：
 *   - 工作区解析与目标目录     workspace.mjs
 *   - 建链接（symlink/junction）link.mjs
 *
 * 本文件只负责本仓的约定：产物目录叫 dev/、名字来自 public/theme.json。
 *
 * Windows 未开开发者模式时 symlink 会 EPERM，这里由包内的 ensureLink 自动
 * 回退到 junction（本地目录不需要管理员权限；思源按路径读主题文件，junction 可用）。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkLinkedFiles, ensureLink, readThemeName, resolveInstallDir } from 'siyuan-devtools';

const devDir = resolve('dev');

if (!existsSync(join(devDir, 'theme.css'))) {
  console.log('[link] 提示：dev/theme.css 还不存在，先跑 pnpm dev 构建一次');
}

const name = readThemeName();
if (!name) {
  console.error('[link] 读不到主题名：确认 public/theme.json 里有 name 字段');
  process.exit(1);
}

const installDir = await resolveInstallDir({ kind: 'theme' });
const targetPath = join(installDir, name);

const result = ensureLink(devDir, targetPath, { kind: 'theme' });
if (!result.ok) {
  console.error('[link] ' + result.reason);
  process.exit(1);
}

console.log('[link] ' + (result.changed ? '已建立链接（' + result.linkType + '）：' : '链接已存在：') + targetPath);

const files = checkLinkedFiles(targetPath, ['theme.css', 'theme.json']);
if (!files.ok) {
  console.log('[link] 提示：链接目录里还缺 ' + files.missing.join('、') + '，思源可能加载不到');
}
