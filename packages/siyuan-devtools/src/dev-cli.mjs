/**
 * 开发循环 CLI：构建 → 链接 → 让思源加载 → 改完自动重载。
 *
 *   siyuan-devtools dev                       类型从 public/ 清单自动推断
 *   siyuan-devtools dev --kind plugin         显式指定类型
 *   siyuan-devtools dev --name foo            显式指定名字
 *   siyuan-devtools dev --build-command "..." 用别的构建工具（默认 vite build --watch）
 *   siyuan-devtools dev --headless            无头
 *   siyuan-devtools dev --frontend mobile     打开移动端
 *   siyuan-devtools dev --no-link             只构建+重载，不动链接
 *
 * 为什么类型能自动推断：主题项目有 public/theme.json，插件项目有 public/plugin.json，
 * 注册表里的 detect 各自认领。用户什么都不用配，这正是「不用在引用项目里写脚本」的关键。
 *
 * 退出码：正常 Ctrl+C 为 0，参数错误或启动失败为 2。
 */
import { startDev } from './dev.mjs';
import { detectTargetType, targetTypes } from './target-types.mjs';

const PREFIX = '[dev] ';

const USAGE = [
  '用法：siyuan-devtools dev [选项]',
  '',
  '  --kind <类型>            被测类型（缺省从 public/ 清单推断）',
  '  --name <名字>            显式指定名字（缺省从清单读）',
  '  --dir <路径>             项目目录，缺省当前目录',
  '  --build-command <命令>   自定义构建命令（默认 vite build --watch）',
  '  --out <目录>             产物目录，缺省 ./dev',
  '  --frontend desktop|mobile  打开哪个前端，缺省 desktop',
  '  --headless               无头模式',
  '  --no-link                只构建+重载，不建立链接',
].join('\n');

/** 解析参数。惰性执行，避免被 import 时读错 argv。 */
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

  const kind = takeValue('--kind');
  const cwd = takeValue('--dir') ?? process.cwd();

  // 没给 --kind 就自动推断；推断不出来把可用类型和原因一起说清楚。
  let resolvedKind = kind;
  if (!resolvedKind) {
    const detected = detectTargetType(cwd);
    if (!detected.ok) {
      console.error(PREFIX + detected.reason);
      console.error(PREFIX + '可用类型：' + targetTypes().join(' / '));
      process.exit(2);
    }
    resolvedKind = detected.kind;
  }

  return {
    kind: resolvedKind,
    kindWasDetected: !kind,
    name: takeValue('--name'),
    cwd,
    headless: has('--headless'),
    frontend: takeValue('--frontend') ?? 'desktop',
    link: !has('--no-link'),
    buildCommand: takeValue('--build-command'),
    outDir: takeValue('--out'),
  };
}

/** 供 bin/ 与统一 CLI 调用；不在模块顶层自动执行，便于被 import。 */
export async function runDevCli() {
  const options = parseArgs(process.argv.slice(2));

  let session = null;
  let closing = false;

  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    try {
      await session?.stop();
    } catch {}
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  if (options.kindWasDetected) console.log(PREFIX + '类型：' + options.kind + '（从清单推断）');

  try {
    session = await startDev({
      kind: options.kind,
      name: options.name,
      cwd: options.cwd,
      headless: options.headless,
      frontend: options.frontend,
      link: options.link,
      buildCommand: options.buildCommand,
      outDir: options.outDir,
      log: (message) => console.log(PREFIX + message),
    });
  } catch (cause) {
    console.error(PREFIX + (cause instanceof Error ? cause.message : String(cause)));
    await shutdown(2);
    return;
  }

  console.log(PREFIX + 'Ctrl+C 结束');
  await new Promise(() => {});
}
