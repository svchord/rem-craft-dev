/**
 * 改完重跑：盯着 src/styles/**，改动后重跑**你指定的命令**。
 *
 * 工具不预设该查什么——查哪些令牌、量哪些选择器、什么算对，由你通过 --exec 传入。
 *
 *   pnpm watch:theme                                        # 只报「已重建」+ 环境快照
 *   pnpm watch:theme --exec "pnpm measure styles .b3-menu__item"
 *   pnpm watch:theme --exec "pnpm measure count .b3-menu__item .dock__item"
 *   pnpm watch:theme --once --exec "pnpm measure env"       # 只跑一次（CI / 提交前）
 *   pnpm watch:theme --no-attach                            # 不复用 dev 浏览器
 *
 * 默认只跑 `measure env`：确认页面活着、看当前环境，不做任何判断。
 * 要断言就自己写命令——工具不替你决定什么算「对」。
 *
 * 退出码：--once 模式下沿用 --exec 命令的退出码；常驻模式 Ctrl+C 结束。
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { watch } from 'node:fs';

const DEBOUNCE_MS = 600;
const WATCH_DIRS = ['src/styles'];
const MEASURE = join(process.cwd(), 'scripts', 'cdp', 'measure-cli.mjs');

const argv = process.argv.slice(2);
const once = argv.includes('--once');
const attach = !argv.includes('--no-attach');

// --exec 取一个完整命令字符串（可能含空格，所以不能用通用的 flag 解析）
const execIndex = argv.indexOf('--exec');
const execCommand = execIndex >= 0 ? argv[execIndex + 1] : null;
if (execIndex >= 0 && (!execCommand || execCommand.startsWith('--'))) {
  console.error('[watch] --exec 需要一个命令，例如 --exec "pnpm measure styles .b3-menu__item"');
  process.exit(2);
}

/** 把 --exec 的命令拼上 --attach（如果用户没自己指定）。 */
function buildCommand() {
  const base = execCommand ?? `node "${MEASURE}" env`;
  if (!attach) return base;
  if (base.includes('--attach')) return base;
  return base + ' --attach';
}

let running = false;
let queued = false;
let timer = null;
let failures = 0;

function run(reason) {
  if (running) {
    // 上一次还没跑完就又有改动：记下来，跑完再补一次，避免并发抢同一个浏览器。
    queued = true;
    return;
  }
  running = true;
  if (reason) console.log('[watch] ' + reason);

  const command = buildCommand();
  const child = spawn(command, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    running = false;
    if (code !== 0) {
      failures += 1;
      console.log('[watch] 命令失败（退出码 ' + code + '），累计 ' + failures + ' 次');
    }
    if (queued) {
      queued = false;
      run('补跑一次（期间又有改动）');
    }
  });
}

if (once) {
  run('单次执行：' + buildCommand());
} else {
  console.log('[watch] 监听 ' + WATCH_DIRS.join(' / ') + '，改动后执行：' + buildCommand());
  if (!attach) console.log('[watch] 未复用 pnpm dev 的浏览器，每次会新开无头窗口');

  for (const dir of WATCH_DIRS) {
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('.css')) return;
        clearTimeout(timer);
        timer = setTimeout(() => run('改动：' + filename), DEBOUNCE_MS);
      });
    } catch (error) {
      console.error('[watch] 无法监听 ' + dir + '：' + (error instanceof Error ? error.message : String(error)));
      process.exit(2);
    }
  }

  // 先把当前状态跑一遍，否则要等到第一次改动才知道现状。
  run('初始执行');
}
