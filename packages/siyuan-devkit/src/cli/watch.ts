/**
 * 改完重跑：盯着指定目录，改动后重跑**你指定的命令**。
 *
 * 工具不预设该查什么——查哪些令牌、量哪些选择器、什么算对，由你通过 --exec 传入。
 *
 *   syt watch                                   # 只跑默认的 env 快照
 *   syt watch --exec "syt measure styles .b3-menu__item"
 *   syt watch --dir src/styles --ext .css       # 监听目录与扩展名
 *   syt watch --once --exec "..."               # 只跑一次（CI / 提交前）
 *   syt watch --no-attach                       # 不复用 dev 浏览器
 *
 * 默认只跑 `measure env`：确认页面活着、看当前环境，不做任何判断。
 * 要断言就自己写命令——工具不替你决定什么算「对」。
 *
 * 退出码：--once 模式下沿用 --exec 命令的退出码；常驻模式 Ctrl+C 结束。
 */
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsHelp } from './cli-args.ts';

const DEBOUNCE_MS = 600;
const SELF_DIR = fileURLToPath(new URL('.', import.meta.url));

/** 包内自带的 measure CLI，默认命令用它（不依赖调用方的 package.json）。 */
const MEASURE_ENTRY = join(SELF_DIR, 'measure-cli.js');

const USAGE = [
  '用法：syt watch [选项]',
  '',
  '  --exec <命令>     改动后要执行的命令（缺省跑 measure env）',
  '  --dir <目录>      监听目录，可重复，缺省 src/styles',
  '  --ext <扩展名>    监听的文件类型，逗号分隔，缺省 .css',
  '  --once            只跑一次（CI / 提交前）',
  '  --no-attach       不复用 dev 浏览器',
].join('\n');

interface WatchOptions {
  once: boolean;
  attach: boolean;
  execCommand: string | null;
  dirs: string[];
  extensions: string[];
}

/**
 * 解析参数。**惰性**——不在模块顶层执行，否则被 import 时会拿错 argv。
 */
function parseArgv(argv: string[]): WatchOptions {
  const takeValue = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`[watch] ${flag} 需要一个参数`);
      process.exit(2);
    }
    return value;
  };

  const execCommand = takeValue('--exec');
  const dirs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--dir') continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error('[watch] --dir 需要一个目录');
      process.exit(2);
    }
    dirs.push(value);
  }

  return {
    once: argv.includes('--once'),
    attach: !argv.includes('--no-attach'),
    execCommand,
    dirs: dirs.length ? dirs : ['src/styles'],
    extensions: (takeValue('--ext') ?? '.css').split(',').map((item) => item.trim()),
  };
}

/** 供 bin/ 调用；不在模块顶层自动执行，便于被 import。 */
export async function runWatchCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return;
  }

  const { once, attach, execCommand, dirs, extensions } = parseArgv(argv);

  /** 把 --exec 的命令拼上 --attach（如果用户没自己指定）。 */
  const buildCommand = (): string => {
    const base = execCommand ?? `node "${MEASURE_ENTRY}" env`;
    if (!attach) return base;
    if (base.includes('--attach')) return base;
    return `${base} --attach`;
  };

  let running = false;
  let queued = false;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;

  const run = (reason: string): void => {
    if (running) {
      // 上一次还没跑完就又有改动：记下来，跑完再补一次，避免并发抢同一个浏览器。
      queued = true;
      return;
    }
    running = true;
    if (reason) console.log(`[watch] ${reason}`);

    const child = spawn(buildCommand(), { stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      running = false;
      if (code !== 0) {
        failures += 1;
        console.log(`[watch] 命令失败（退出码 ${code}），累计 ${failures} 次`);
      }
      if (queued) {
        queued = false;
        run('补跑一次（期间又有改动）');
      }
    });
  };

  if (once) {
    run(`单次执行：${buildCommand()}`);
    return;
  }

  console.log(`[watch] 监听 ${dirs.join(' / ')}（${extensions.join('/')}），改动后执行：${buildCommand()}`);
  if (!attach) console.log('[watch] 未复用 dev 的浏览器，每次会新开无头窗口');

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`[watch] 目录不存在：${dir}`);
      process.exit(2);
    }
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!extensions.some((ext) => String(filename).endsWith(ext))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => run(`改动：${String(filename)}`), DEBOUNCE_MS);
      });
    } catch (error) {
      console.error(`[watch] 无法监听 ${dir}：${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }

  // 先把当前状态跑一遍，否则要等到第一次改动才知道现状。
  run('初始执行');
}
