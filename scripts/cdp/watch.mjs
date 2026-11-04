/**
 * 改完自动审计：盯着 src/styles/**，防抖后跑一次样式与交互审计。
 *
 * 这是把「改代码 → 热更新 → 看对不对」串成闭环的那一环：
 *   pnpm dev          负责热更新（页面自动变）
 *   pnpm watch:theme  负责审计（不变量是否还成立，事实是什么）
 *
 * 两者可以同时开：watch:theme 用 --attach 复用 dev 的浏览器，量的是你眼前那个窗口。
 *
 *   pnpm watch:theme              # 默认监听 src/styles/**
 *   pnpm watch:theme --once       # 只审一次就退出（CI / 提交前）
 *   pnpm watch:theme --no-attach  # 不复用 dev 浏览器，新开无头窗口
 *   pnpm watch:theme --json       # 每次输出结构化事实
 *
 * 退出码：--once 模式下沿用 audit 的语义；常驻模式下 Ctrl+C 结束。
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { watch } from 'node:fs';

const DEBOUNCE_MS = 600;
const WATCH_DIRS = ['src/styles'];

const args = process.argv.slice(2);
const once = args.includes('--once');
const attach = !args.includes('--no-attach');
const extra = args.filter((arg) => !['--once', '--no-attach'].includes(arg));
const auditArgs = [join(process.cwd(), 'scripts', 'cdp', 'audit.mjs'), ...(attach ? ['--attach'] : []), ...extra];

let running = false;
let queued = false;
let timer = null;
let failures = 0;

function runAudit(reason) {
  if (running) {
    // 上一次还没跑完就又有改动：记下来，跑完再补一次，避免并发抢同一个浏览器。
    queued = true;
    return;
  }
  running = true;
  if (reason) console.log('[watch] ' + reason);

  const child = spawn(process.execPath, auditArgs, { stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    if (code !== 0) {
      failures += 1;
      console.log('[watch] 有不变量违规（退出码 ' + code + '），累计 ' + failures + ' 次');
    }
    if (queued) {
      queued = false;
      runAudit('补跑一次（期间又有改动）');
    }
  });
}

if (once) {
  runAudit('单次审计');
} else {
  console.log('[watch] 监听 ' + WATCH_DIRS.join(' / ') + '，改动后自动跑 pnpm audit:theme');
  if (!attach) console.log('[watch] 未复用 pnpm dev 的浏览器，每次会新开无头窗口');

  for (const dir of WATCH_DIRS) {
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('.css')) return;
        clearTimeout(timer);
        timer = setTimeout(() => runAudit('改动：' + filename), DEBOUNCE_MS);
      });
    } catch (error) {
      console.error('[watch] 无法监听 ' + dir + '：' + (error instanceof Error ? error.message : String(error)));
      process.exit(2);
    }
  }

  // 先把当前状态审一遍，否则要等到第一次改动才知道现状。
  runAudit('初始审计');
}
