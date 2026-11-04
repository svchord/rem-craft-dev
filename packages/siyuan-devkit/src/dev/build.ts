/**
 * 构建看护：起一个「持续重建」的进程，等产物出现，报告每次变化。
 *
 * **本包不依赖 vite。** vite 只是内置的默认驱动，因为它是思源主题/插件项目
 * 最常见的选择；但工具本身只关心「有个进程在重建、产物落在哪个目录」。
 * 用别的构建工具（esbuild watch、tsc --watch、sass --watch、自己写的脚本）
 * 就传 `command` 进来，包一样能跑。
 *
 * 注意：走插件形态时**不需要**这个模块——构建由宿主的 vite 负责。
 * 它只服务于 CLI 形态（`syt dev`）。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** 一个可执行的构建命令。 */
export interface BuildCommand {
  file: string;
  args: string[];
  shell: boolean;
}

/**
 * 内置驱动：vite build --watch。
 *
 * 用子进程而不是 `import('vite')` 调 API：项目的 `vite.config.ts` 靠
 * `minimist(process.argv)` 判断 `--watch` 来决定输出目录、要不要打 zip。
 * 用 API 调用拿不到这个 argv 语义，等于要改每个项目的配置——那就不通用了。
 *
 * vite 可执行文件从**调用方项目**解析，不从包内解析：vite 是被测项目自己的
 * 依赖（版本要对得上），本包只是替它起进程。
 */
export async function viteCommand({
  cwd = process.cwd(),
  outDir = './dev',
  extraArgs = [],
}: { cwd?: string; outDir?: string; extraArgs?: string[] } = {}): Promise<BuildCommand> {
  const bin = resolveViteBin(cwd);
  // --emptyOutDir false：watch 模式下每次重建都清空会把思源正在读的文件删掉。
  return {
    file: process.execPath,
    args: [bin, 'build', '--watch', '--outDir', outDir, '--emptyOutDir', 'false', ...extraArgs],
    shell: false,
  };
}

/**
 * 解析调用方项目里的 vite 可执行文件。
 *
 * `vite/package.json` 在 exports 里是公开的，用它定位包根再拼 `bin` 字段，
 * 比硬编码 `node_modules/vite/bin/vite.js` 靠谱（pnpm 的软链目录结构不固定）。
 *
 * **解析结果必须落在 cwd 的某个祖先 node_modules 里**，否则一律拒绝：
 * 光靠 createRequire 不够——它在某些运行环境（实测 vitest）会被替换，
 * 从而解析到与本项目无关的 vite。用错版本的 vite 构建会给出莫名其妙的错误，
 * 比直接说「你没装 vite」难查得多。
 */
export function resolveViteBin(cwd = process.cwd()): string {
  const root = resolve(cwd);
  const require = createRequire(join(root, 'package.json'));

  let manifestPath: string;
  try {
    manifestPath = require.resolve('vite/package.json');
  } catch (cause) {
    throw new Error(
      `找不到 vite：${root} 里没装 vite。\n` +
        '  内置构建驱动用的是 `vite build --watch`，需要项目自己装 vite。\n' +
        '  用别的构建工具就传 buildCommand，本包不依赖任何具体构建器。\n' +
        `  原始错误：${cause instanceof Error ? cause.message : String(cause)}`
    );
  }

  if (!isReachableFrom(manifestPath, root)) {
    throw new Error(
      `找不到 vite：${root} 里没装 vite。\n` +
        `  注意：解析到的 ${manifestPath} 不属于这个项目，已拒绝使用——\n` +
        '  用别的项目的 vite 构建会得到难以定位的错误，比直接说没装更难查。\n' +
        '  用别的构建工具就传 buildCommand。'
    );
  }

  const manifest = require(manifestPath) as { bin?: string | Record<string, string> };
  const binField = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vite;
  if (!binField) throw new Error(`vite 的 package.json 里没有 bin.vite：${manifestPath}`);

  const bin = join(dirname(manifestPath), binField);
  if (!existsSync(bin)) throw new Error(`vite 可执行文件不存在：${bin}`);
  return bin;
}

/** path 是否位于 root 或 root 的某个祖先的 node_modules 之下。 */
function isReachableFrom(path: string, root: string): boolean {
  const normalized = resolve(path).replaceAll('\\', '/').toLowerCase();
  let dir = resolve(root);
  for (;;) {
    const prefix = `${dir.replaceAll('\\', '/').toLowerCase()}/node_modules/`.replaceAll('//', '/');
    if (normalized.startsWith(prefix)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** 构建进程句柄。 */
export interface BuildHandle {
  proc: ChildProcess;
  ready: boolean;
  reason: string | null;
  stop(): void;
}

/** startBuild 的选项。 */
export interface StartBuildOptions {
  cwd?: string;
  outDir?: string;
  artifact?: string;
  /** 自定义构建命令；不给则用内置的 vite build --watch。 */
  command?: string | BuildCommand | null;
  timeoutMs?: number;
  extraArgs?: string[];
  onOutput?: ((text: string) => void) | null;
}

/**
 * 起构建进程并等首个产物出现。
 */
export async function startBuild({
  cwd = process.cwd(),
  outDir = './dev',
  artifact = 'theme.css',
  command = null,
  timeoutMs = 60000,
  extraArgs = [],
  onOutput = null,
}: StartBuildOptions = {}): Promise<BuildHandle> {
  const artifactPath = resolve(cwd, outDir, artifact);

  let file: string;
  let args: string[];
  let shell = false;
  if (typeof command === 'string') {
    // 字符串命令交给 shell：用户可能写 `npx sass --watch ...` 或带引号的重定向。
    file = command;
    args = [];
    shell = true;
  } else if (command && typeof command === 'object') {
    file = command.file;
    args = command.args;
    shell = command.shell;
  } else {
    const built = await viteCommand({ cwd, outDir, extraArgs });
    file = built.file;
    args = built.args;
    shell = built.shell;
  }

  const proc = spawn(file, args, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });

  const forward = (chunk: Buffer): void => {
    onOutput?.(chunk.toString());
  };
  proc.stdout?.on('data', forward);
  proc.stderr?.on('data', forward);

  let exited: number | null = null;
  proc.on('exit', (code) => {
    exited = code;
  });

  const deadline = Date.now() + timeoutMs;
  while (!existsSync(artifactPath) && Date.now() < deadline) {
    if (exited !== null) {
      return {
        proc,
        ready: false,
        reason: `构建进程提前退出（退出码 ${exited}），产物未生成：${artifactPath}`,
        stop: () => {},
      };
    }
    await sleep(200);
  }

  if (!existsSync(artifactPath)) {
    return {
      proc,
      ready: false,
      reason: `等 ${timeoutMs}ms 仍未生成 ${artifactPath}`,
      stop: () => stopProcess(proc),
    };
  }

  return { proc, ready: true, reason: null, stop: () => stopProcess(proc) };
}

function stopProcess(proc: ChildProcess | null): void {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    proc.kill();
  } catch {
    // 已经没了
  }
}

/** 产物监听的句柄。 */
export interface ArtifactWatcher {
  close(): void;
}

/** watchArtifact 的选项。 */
export interface WatchArtifactOptions {
  match?: ((filename: string) => boolean) | null;
  debounceMs?: number;
  onChange: (filename: string) => void;
}

/**
 * 监听产物目录，合并短时间内的多次写入后回调。
 *
 * 构建会同时写多个文件（css + js + json），不合并就会一次改动触发好几轮重载。
 * 用 fs.watch 而不是 chokidar：本包不想多一个依赖，而产物目录的结构是已知的。
 */
export function watchArtifact(
  dir: string,
  { match, debounceMs = 150, onChange }: WatchArtifactOptions
): ArtifactWatcher {
  let timer: NodeJS.Timeout | null = null;

  const watcher = watch(resolve(dir), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = String(filename).replaceAll('\\', '/');
    if (match && !match(name)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(name), debounceMs);
  });

  return {
    close(): void {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
