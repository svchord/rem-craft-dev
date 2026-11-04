/**
 * 开发循环 CLI：一条命令走完构建、链接、热重载。
 *
 *   siyuan-dev                        # 主题模式（从 public/theme.json 读名字）
 *   siyuan-dev --plugin               # 插件模式（从 public/plugin.json 读名字）
 *   siyuan-dev --plugin --name foo    # 显式指定名字
 *   siyuan-dev --headless             # 无头
 *   siyuan-dev --frontend mobile      # 打开移动端
 *   siyuan-dev --no-link              # 只构建+重载，不动链接
 *   siyuan-dev --dir . --out ./dev    # 项目目录与产物目录
 *
 * 为什么主题和插件用同一个命令：两者的开发链路是同一条，差别（产物名、清单名、
 * 安装目录、重载方式）全部在 targets.mjs 里收敛掉了。加第三种被测对象时改
 * targets.mjs 即可，这里不用动。
 *
 * 退出码：正常 Ctrl+C 为 0，参数错误或启动失败为 2。
 */
import { startDev } from './dev.mjs';

const PREFIX = '[dev] ';

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

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runCli() {
  const kind = has('--plugin') ? 'plugin' : 'theme';
  const name = takeValue('--name');
  const cwd = takeValue('--dir') ?? process.cwd();

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

  try {
    session = await startDev({
      kind,
      name,
      cwd,
      headless: has('--headless'),
      frontend: takeValue('--frontend') ?? 'desktop',
      link: !has('--no-link'),
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
