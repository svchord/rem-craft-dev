/**
 * 统一入口：一个命令，若干子命令。
 *
 *   syt measure <子命令>  在真实页面上量渲染事实（agent 自动审计的主力）
 *   syt shot              无头截取桌面端/移动端页面，供视觉复核
 *   syt verify            独立校验清单与产物
 *
 * 设计要点：
 *   - **开发走 Vite 插件**（`pnpm dev` / `vite build --watch`），链接、热重载都由插件负责；
 *     CLI 不提供 `syt dev` / `syt link` / `syt watch`，定位是 agent 自动审计与 CI 检查。
 *   - 类型是可扩展的：registerTargetType() 加一种，--kind 就多一个取值。
 *   - 只有一个命令入口 `syt`，所有能力都走子命令，不再有等价的独立命令。
 */
import { runMeasureCli } from './measure-cli.ts';
import { runShotCli } from './shot.ts';
import { runVerifyCli } from './verify-cli.ts';
import { targetTypes } from '../core/target-types.ts';
import { UserFacingError } from '../core/errors.ts';
import { box, fail, info, list, section } from './ui.ts';

type Handler = (argv: string[]) => Promise<void>;

// 用无原型对象：普通对象字面量会命中 Object.prototype 上的键，
// `syt constructor` / `syt toString` 会被当成命令调起来（不报错、退出码 0）。
const COMMANDS: Record<string, Handler> = Object.assign(Object.create(null) as Record<string, Handler>, {
  measure: runMeasureCli,
  shot: runShotCli,
  verify: runVerifyCli,
});

/** 打印 `syt --help`：分区排版，命令/选项/示例/退出码各一块。 */
function usage(): void {
  box('syt · 思源主题 / 插件开发工具', [
    '开发用 Vite 插件热重载；CLI 专供 agent 自动审计与 CI 检查。',
    '用法：syt <命令> [参数]',
  ]);

  section('命令');
  list([
    ['measure', '在真实思源前端里量渲染事实、驱动交互（agent 审计主力）'],
    ['shot', '无头截取桌面端/移动端页面，供视觉复核'],
    ['verify', '独立校验清单与产物（不跑构建，可用于 CI / 发布前 / 解包后检查）'],
  ]);

  section('常用选项');
  list([
    ['--kind <类型>', `被测对象类型（${targetTypes().join(' / ')}）；缺省从 public/ 清单自动推断`],
    ['--frontend <端>', 'desktop | mobile，缺省 desktop'],
    ['--attach', '复用正在跑的 dev 浏览器（仅 measure / measure audit）'],
    ['--dir <路径>', '项目目录，缺省当前目录（仅 verify）'],
    ['--help', '显示本帮助'],
  ]);

  section('示例');
  list([
    ['syt measure tokens --rc-brand-8 --attach', '量令牌，复用 dev 浏览器'],
    ['syt measure audit', '一次会话跑完审计计划'],
    ['syt shot', '桌面端/移动端各截一张图'],
    ['syt verify', '校验 dist 产物与清单'],
  ]);

  section('退出码');
  list([
    ['0', '成功（或正常退出）'],
    ['1', '校验未通过等业务失败'],
    ['2', '参数错误或运行错误'],
  ]);

  info('各子命令的具体约定见 syt <命令> --help。');
  info("开发热重载：import siyuan from 'siyuan-devkit/plugin' 后跑 vite build --watch（或 pnpm dev）");
}

/** 供 bin/ 调用。 */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === '--help' || command === 'help' || command === '-h') {
    usage();
    if (!command) process.exitCode = 2;
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    fail(`未知命令：${command}`);
    info(`可用命令：${Object.keys(COMMANDS).join(' / ')}`);
    process.exitCode = 2;
    return;
  }

  try {
    await handler(argv.slice(1));
  } catch (cause) {
    // 统一兜底：子命令抛错不再变成 unhandled rejection。退出码固定 2（参数/运行错误）。
    // 预期内错误只打原因；堆栈对 agent 是纯 token 开销，留给真正的编程错误。
    const message = cause instanceof Error ? cause.message : String(cause);
    fail(message);
    if (cause instanceof Error && !(cause instanceof UserFacingError) && cause.stack) {
      // stack 首行就是 message，已经打过了；只输出调用栈，避免同一句重复刷屏。
      const frames = cause.stack.split('\n').slice(1).join('\n');
      if (frames.trim()) console.error(frames);
    }
    process.exitCode = 2;
  }
}
