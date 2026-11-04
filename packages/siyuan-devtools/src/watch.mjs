/**
 * 改完重跑：盯着指定目录，改动后重跑**你指定的命令**。
 *
 * 工具不预设该查什么——查哪些令牌、量哪些选择器、什么算对，由你通过 --exec 传入。
 *
 *   siyuan-watch                                        # 只跑默认的 env 快照
 *   siyuan-watch --exec "siyuan-measure styles .b3-menu__item"
 *   siyuan-watch --dir src/styles --ext .css            # 监听目录与扩展名
 *   siyuan-watch --once --exec "siyuan-measure env"     # 只跑一次（CI / 提交前）
 *   siyuan-watch --no-attach                            # 不复用 dev 浏览器
 *
 * 默认只跑 `siyuan-measure env`：确认页面活着、看当前环境，不做任何判断。
 * 要断言就自己写命令——工具不替你决定什么算「对」。
 *
 * 退出码：--once 模式下沿用 --exec 命令的退出码；常驻模式 Ctrl+C 结束。
 */
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEBOUNCE_MS = 600;
const SELF_DIR = fileURLToPath(new URL('.', import.meta.url));
/** 包内自带的 measure CLI，默认命令用它（不依赖调用方的 package.json）。 */
const MEASURE_CLI = join(SELF_DIR, 'measure-cli.mjs');

const argv = process.argv.slice(2);
const once = argv.includes('--once');
const attach = !argv.includes('--no-attach');

const takeValue = (flag) => {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error('[watch] ' + flag + ' 需要一个参数');
    process.exit(2);
  }
  return value;
};

// --exec 取一个完整命令字符串（可能含空格，所以不能用通用的 flag 解析）
const execCommand = takeValue('--exec');
// --dir 可重复，缺省监听 src/styles
const dirs = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--dir') {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error('[watch] --dir 需要一个目录');
      process.exit(2);
    }
    dirs.push(value);
  }
}
const WATCH_DIRS = dirs.length ? dirs : ['src/styles'];
const extensions = (takeValue('--ext') ?? '.css').split(',').map((s) => s.trim());

/** 把 --exec 的命令拼上 --attach（如果用户没自己指定）。 */
function buildCommand() {
  const base = execCommand ?? `node "${MEASURE_CLI}" env`;
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

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runCli() {
  if (once) {
    run('单次执行：' + buildCommand());
    return;
  }

  console.log(
    '[watch] 监听 ' + WATCH_DIRS.join(' / ') + '（' + extensions.join('/') + '），改动后执行：' + buildCommand()
  );
  if (!attach) console.log('[watch] 未复用 pnpm dev 的浏览器，每次会新开无头窗口');

  for (const dir of WATCH_DIRS) {
    if (!existsSync(dir)) {
      console.error('[watch] 目录不存在：' + dir);
      process.exit(2);
    }
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!extensions.some((ext) => String(filename).endsWith(ext))) return;
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
