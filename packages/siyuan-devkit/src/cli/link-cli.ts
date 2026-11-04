/**
 * 链接 CLI：把构建产物目录链接到思源安装目录。
 *
 *   syt link                     类型从 public/ 清单自动推断
 *   syt link --kind plugin       显式指定类型
 *   syt link --check             只检查现状，不修改
 *   syt link --workspace D:\ws   显式指定工作区
 *   syt link --src ./dist        链接别的目录（缺省 dev/）
 *
 * 与 `dev` 的关系：`dev` 默认会自己建链接，所以单独跑这个命令主要用于
 * 「先链好、再单独起构建」的场景，以及 CI 里检查链接是否正确。
 *
 * 退出码：链接正确/已建立为 0，冲突或失败为 1，参数错误为 2。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lastValue, parseArgs, wantsHelp } from './cli-args.ts';
import { checkLinkedFiles, ensureLink, inspectLink } from '../core/link.ts';
import { createTarget, readManifestName } from '../core/targets.ts';
import { detectTargetType, targetType, targetTypes } from '../core/target-types.ts';

const PREFIX = '[link] ';

const USAGE = [
  '用法：syt link [选项]',
  '',
  '  --kind <类型>        被测类型（缺省从 public/ 清单推断）',
  '  --name <名字>        显式指定名字（缺省从清单读）',
  '  --dir <路径>         项目目录，缺省当前目录',
  '  --src <目录>         要链接的产物目录，缺省 dev',
  '  --workspace <路径>   显式指定思源工作区',
  '  --check              只检查现状，不修改',
].join('\n');

const VALUE_FLAGS = ['--kind', '--name', '--dir', '--src', '--workspace'] as const;
const BOOLEAN_FLAGS = ['--check', '--help', '-h'] as const;

/** 供 bin/ 与统一 CLI 调用；不在模块顶层自动执行，便于被 import。 */
export async function runLinkCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return;
  }

  const parsed = parseArgs(argv, { valueFlags: VALUE_FLAGS, booleanFlags: BOOLEAN_FLAGS });
  const cwd = lastValue(parsed, '--dir') ?? process.cwd();
  const workspace = lastValue(parsed, '--workspace') ?? null;
  const checkOnly = parsed.flags.has('--check');

  let kind = lastValue(parsed, '--kind');
  if (!kind) {
    const detected = detectTargetType(cwd);
    if (!detected.ok) {
      console.error(`${PREFIX}${detected.reason}`);
      console.error(`${PREFIX}可用类型：${targetTypes().join(' / ')}`);
      process.exit(2);
    }
    kind = detected.kind;
  }

  const descriptor = targetType(kind).descriptor;
  const name = lastValue(parsed, '--name') ?? readManifestName(cwd, descriptor.manifestName());
  if (!name) {
    console.error(`${PREFIX}读不到${kind}的名字（public/${descriptor.manifestName()} 的 name），用 --name 指定`);
    process.exit(2);
  }

  const target = createTarget(kind, { name, cwd });
  const srcDir = resolve(cwd, lastValue(parsed, '--src') ?? 'dev');

  let installDir: string;
  try {
    installDir = await target.installDir({ workspace, port: null });
  } catch (cause) {
    console.error(`${PREFIX}${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }

  const targetPath = join(installDir, name);

  if (checkOnly) {
    const state = inspectLink(srcDir, targetPath);
    console.log(`${PREFIX}类型：${kind}`);
    console.log(`${PREFIX}源：  ${srcDir}`);
    console.log(`${PREFIX}目标：${targetPath}`);
    console.log(`${PREFIX}状态：${state.state}${state.reason ? `（${state.reason}）` : ''}`);
    process.exit(state.state === 'linked' ? 0 : 1);
  }

  if (!existsSync(srcDir)) {
    console.error(`${PREFIX}源目录不存在：${srcDir}`);
    console.error(`${PREFIX}提示：先跑一次构建（syt dev）`);
    process.exit(1);
  }

  const result = ensureLink(srcDir, targetPath, { kind });
  if (!result.ok) {
    console.error(`${PREFIX}${result.reason ?? '建立链接失败'}`);
    process.exit(1);
  }

  console.log(`${PREFIX}${result.changed ? `已建立链接（${result.linkType}）：` : '链接已存在：'}${targetPath}`);

  const files = checkLinkedFiles(targetPath, target.buildConfig().expectedFiles);
  if (!files.ok) {
    console.log(`${PREFIX}提示：链接目录里还缺 ${files.missing.join('、')}，思源可能加载不到`);
  }
  process.exit(0);
}
