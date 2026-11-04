/**
 * 链接 CLI：把构建产物目录链接到思源安装目录。
 *
 *   siyuan-devtools link                     类型从 public/ 清单自动推断
 *   siyuan-devtools link --kind plugin       显式指定类型
 *   siyuan-devtools link --check             只检查现状，不修改
 *   siyuan-devtools link --workspace D:\ws   显式指定工作区
 *   siyuan-devtools link --src ./dist        链接别的目录（缺省 dev/）
 *
 * 与 `dev` 的关系：`dev` 默认会自己建链接，所以单独跑这个命令主要用于
 * 「先链好、再单独起构建」的场景，以及 CI 里检查链接是否正确。
 *
 * 退出码：链接正确/已建立为 0，冲突或失败为 1，参数错误为 2。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkLinkedFiles, ensureLink, inspectLink } from './link.mjs';
import { createTarget, readManifestName } from './targets.mjs';
import { detectTargetType, targetType, targetTypes } from './target-types.mjs';

const PREFIX = '[link] ';

const USAGE = [
  '用法：siyuan-devtools link [选项]',
  '',
  '  --kind <类型>        被测类型（缺省从 public/ 清单推断）',
  '  --name <名字>        显式指定名字（缺省从清单读）',
  '  --dir <路径>         项目目录，缺省当前目录',
  '  --src <目录>         要链接的产物目录，缺省 dev',
  '  --workspace <路径>   显式指定思源工作区',
  '  --check              只检查现状，不修改',
].join('\n');

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

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

  const cwd = takeValue('--dir') ?? process.cwd();

  let kind = takeValue('--kind');
  if (!kind) {
    const detected = detectTargetType(cwd);
    if (!detected.ok) {
      console.error(PREFIX + detected.reason);
      console.error(PREFIX + '可用类型：' + targetTypes().join(' / '));
      process.exit(2);
    }
    kind = detected.kind;
  }

  return {
    kind,
    cwd,
    name: takeValue('--name'),
    src: takeValue('--src') ?? 'dev',
    workspace: takeValue('--workspace'),
    checkOnly: has('--check'),
  };
}

/** 供 bin/ 与统一 CLI 调用；不在模块顶层自动执行，便于被 import。 */
export async function runLinkCli() {
  const { kind, cwd, name: nameOption, src, workspace, checkOnly } = parseArgs(process.argv.slice(2));

  const descriptor = targetType(kind);
  const name = nameOption ?? readManifestName(cwd, descriptor.manifestName());
  if (!name) {
    console.error(
      PREFIX + '读不到' + kind + '的名字（public/' + descriptor.manifestName() + ' 的 name），用 --name 指定'
    );
    process.exit(2);
  }

  const target = createTarget(kind, { name, cwd });
  const srcDir = resolve(cwd, src);

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
    console.log(PREFIX + '类型：' + kind);
    console.log(PREFIX + '源：  ' + srcDir);
    console.log(PREFIX + '目标：' + targetPath);
    console.log(PREFIX + '状态：' + state.state + (state.reason ? '（' + state.reason + '）' : ''));
    process.exit(state.state === 'linked' ? 0 : 1);
  }

  if (!existsSync(srcDir)) {
    console.error(PREFIX + '源目录不存在：' + srcDir);
    console.error(PREFIX + '提示：先跑一次构建（siyuan-devtools dev）');
    process.exit(1);
  }

  const result = ensureLink(srcDir, targetPath, { kind });
  if (!result.ok) {
    console.error(PREFIX + result.reason);
    process.exit(1);
  }

  console.log(PREFIX + (result.changed ? '已建立链接（' + result.linkType + '）：' : '链接已存在：') + targetPath);

  const files = checkLinkedFiles(targetPath, target.buildConfig().expectedFiles);
  if (!files.ok) {
    console.log(PREFIX + '提示：链接目录里还缺 ' + files.missing.join('、') + '，思源可能加载不到');
  }
  process.exit(0);
}
