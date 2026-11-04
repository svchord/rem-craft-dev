/**
 * 开发循环（CLI 形态）：一条命令走完「构建 → 链接 → 让思源用上 → 改完自动重载」。
 *
 * 本文件只负责**构建这一件事**：起 `vite build --watch`（或自定义命令），
 * 等首个产物出现。之后的所有工作交给 dev-session.ts。
 *
 * 插件形态（plugin.ts）复用同一个会话层，只是构建由宿主的 vite 负责。
 * 两种形态的区别只在「谁跑构建」，不在「怎么重载」。
 *
 * 为什么默认是 `build --watch` 而不是 `vite dev`：
 *   思源从磁盘读 `<workspace>/data/themes/<name>/theme.css`，dev server 只在内存里
 *   编译（实测 `vite dev` 不产生任何磁盘产物）。插件 JS 更严格：思源用
 *   `window.eval("(function anonymous(require, module, exports){…})")` 执行，
 *   需要 CJS 单文件，而 dev server 给的是 ESM 模块图。所以必须落盘。
 */
import { join } from 'node:path';
import { startBuild } from './build.ts';
import type { BuildCommand, BuildHandle } from './build.ts';
import { startDevSession } from './dev-session.ts';
import type { DevSession } from './dev-session.ts';
import type { Frontend } from '../core/siyuan.ts';
import { createTarget } from '../core/targets.ts';

/** startDev 的选项。 */
export interface StartDevOptions {
  /** 已注册的类型名（theme / plugin / 自定义）。 */
  kind: string;
  /** 名字；缺省从该类型的清单读。 */
  name?: string | null;
  /** 项目目录。 */
  cwd?: string;
  /** 是否无头。 */
  headless?: boolean;
  /** 打开哪个前端。 */
  frontend?: Frontend;
  /** 是否建立链接。 */
  link?: boolean;
  /** 自定义构建命令；不给则用 vite。 */
  buildCommand?: string | BuildCommand | null;
  /** 产物目录覆盖。 */
  outDir?: string | null;
  /** 日志回调。 */
  log?: (message: string) => void;
}

/** 开发会话（在会话层之上多一个构建进程）。 */
export interface DevHandle extends DevSession {
  stop(): Promise<void>;
}

/**
 * 开发会话。
 */
export async function startDev({
  kind,
  name = null,
  cwd = process.cwd(),
  headless = false,
  frontend = 'desktop',
  link = true,
  buildCommand = null,
  outDir = null,
  log = (message) => console.log(`[dev] ${message}`),
}: StartDevOptions): Promise<DevHandle> {
  let session: DevSession | null = null;
  let build: BuildHandle | null = null;

  const shutdown = async (): Promise<void> => {
    try {
      build?.stop();
    } catch {
      // 已经没了
    }
    try {
      await session?.stop();
    } catch {
      // 已经没了
    }
  };

  try {
    // 产物目录由类型描述符决定，但这里要提前知道才能等产物出现。
    // 用 createTarget 拿配置，和 dev-session 内部保持一致。
    const buildConfig = createTarget(kind, { name, cwd }).buildConfig();
    const resolvedOutDir = outDir ?? buildConfig.outDir;

    build = await startBuild({
      cwd,
      outDir: resolvedOutDir,
      artifact: buildConfig.artifact,
      command: buildCommand,
      onOutput: (text) => {
        // 构建器自己的输出前缀已经很啰嗦，只把错误行转出来。
        for (const line of text.split('\n')) {
          if (/error|failed|cannot|ENOENT/i.test(line) && line.trim()) log(`构建：${line.trim()}`);
        }
      },
    });
    if (!build.ready) throw new Error(build.reason ?? '构建失败');
    log(`构建就绪：${join(resolvedOutDir, buildConfig.artifact)}`);

    // 之后全部交给会话层（链接 / 激活 / 浏览器 / 监听 / 重载）
    session = await startDevSession({
      kind,
      name,
      cwd,
      outDir: resolvedOutDir,
      link,
      headless,
      frontend,
      log,
      watch: true,
    });

    log(`改源码自动重建 + 自动重载（F5 后仍是这个${session.target.name}）`);

    return {
      ...session,
      stop: shutdown,
    };
  } catch (cause) {
    await shutdown();
    throw cause;
  }
}
