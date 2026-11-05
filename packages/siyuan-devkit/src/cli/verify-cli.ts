/**
 * syt verify：独立校验清单与产物，不依赖 vite、不启动浏览器、不跑构建。
 *
 * 构建时的收尾插件已经在 writeBundle 里做同样的校验；这个子命令把它单独暴露出来，
 * 用于三种场景：
 *   1. CI 里显式校验构建产物（不必靠 vite build 的副作用）；
 *   2. 发布前检查 dist/ 是否可交付；
 *   3. 解包 package.zip 后校验产物是否完整（--dir 指向解包目录）。
 *
 *   syt verify                              # 校验 ./dist（不存在则 ./dev）
 *   syt verify --out-dir dist --kind plugin
 *   syt verify --dir ../siyuan-arco-calendar
 *
 * 退出码：通过 0，校验有问题 1，参数/运行错误 2。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTarget } from '../core/targets.ts';
import { detectTargetType } from '../core/target-types.ts';
import { formatIssues, verifyTarget } from '../core/verify.ts';
import { lastValue, parseArgs, wantsHelp } from './cli-args.ts';

const PREFIX = '[verify] ';
const VALUE_FLAGS = ['--kind', '--dir', '--out-dir'] as const;

const USAGE = [
  '用法：syt verify [选项]',
  '',
  '独立校验清单与产物（不启动浏览器、不跑构建）。',
  '',
  '  --dir <路径>      项目根目录，缺省当前目录',
  '  --out-dir <路径>  产物目录，缺省 dist（不存在则 dev）',
  '  --kind <类型>     被测类型，缺省按 public/ 清单推断',
  '  --help            显示本帮助',
  '',
  '退出码：通过 0，校验有问题 1，参数/运行错误 2。',
].join('\n');

/** 处理 `syt verify`。 */
export async function runVerifyCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return;
  }

  const parsed = parseArgs(argv, { valueFlags: VALUE_FLAGS });
  const root = resolve(lastValue(parsed, '--dir') ?? process.cwd());

  let kind = lastValue(parsed, '--kind');
  if (!kind) {
    const detected = detectTargetType(root);
    if (detected.ok) kind = detected.kind;
  }
  if (!kind) {
    console.error(`${PREFIX}识别不到被测类型（public/ 下没有 theme.json / plugin.json），请用 --kind 指定`);
    process.exitCode = 2;
    return;
  }

  let target;
  try {
    target = createTarget(kind, { cwd: root });
  } catch (cause) {
    console.error(`${PREFIX}${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
    return;
  }

  // 缺省校验生产产物 dist；没有 dist 再看 dev；都没有就用描述符的默认 outDir。
  const fallbackOut = existsSync(resolve(root, 'dist'))
    ? 'dist'
    : existsSync(resolve(root, 'dev'))
      ? 'dev'
      : target.buildConfig().outDir;
  const outDir = lastValue(parsed, '--out-dir') ?? fallbackOut;

  const result = verifyTarget(target, { root, outDir });
  if (result.ok) {
    console.log(`${PREFIX}校验通过（${kind} / ${outDir}）`);
    return;
  }

  console.error(`${PREFIX}校验未通过（${kind} / ${outDir}）：`);
  console.error(formatIssues(result.issues));
  process.exitCode = 1;
}
