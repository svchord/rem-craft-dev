/**
 * 构建看护：起 `vite build --watch`，等产物出现，报告每一次重建。
 *
 * 为什么用子进程而不是 `import('vite')` 调 API：
 *   项目的 `vite.config.ts` 靠 `minimist(process.argv)` 判断 `--watch` 来决定
 *   输出到 `dev/` 还是 `dist/`、要不要打 zip。用 API 调用拿不到这个 argv 语义，
 *   等于要改每个项目的配置——那就不通用了。
 *
 * vite 可执行文件从**调用方工作目录**解析，不从包内解析：vite 是被测项目自己的
 * 依赖（版本要对得上），本包只是替它起进程。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 解析调用方项目里的 vite 可执行文件。
 *
 * `vite/package.json` 在 exports 里是公开的，用它定位包根再拼 `bin` 字段，
 * 比硬编码 `node_modules/vite/bin/vite.js` 靠谱（pnpm 的软链目录结构不固定）。
 *
 * **解析结果必须落在 cwd 的某个祖先 node_modules 里**，否则一律拒绝：
 * 光靠 `createRequire` 不够——它在某些运行环境（实测 vitest）会被替换，
 * 从而解析到与本项目无关的 vite。用错版本的 vite 构建会给出莫名其妙的错误，
 * 比直接说「你没装 vite」难查得多。
 */
export function resolveViteBin(cwd = process.cwd()) {
  const root = resolve(cwd);
  const require = createRequire(join(root, 'package.json'));

  let manifestPath;
  try {
    manifestPath = require.resolve('vite/package.json');
  } catch (cause) {
    throw new Error(
      '找不到 vite：' +
        root +
        ' 里没装 vite。\n' +
        '  本包只负责起 `vite build --watch`，vite 由被测项目自己提供（版本要匹配）。\n' +
        '  原始错误：' +
        (cause.message ?? cause)
    );
  }

  if (!isReachableFrom(manifestPath, root)) {
    throw new Error(
      '找不到 vite：' +
        root +
        ' 里没装 vite。\n' +
        '  本包只负责起 `vite build --watch`，vite 由被测项目自己提供（版本要匹配）。\n' +
        '  注意：解析到的 ' +
        manifestPath +
        ' 不属于这个项目，已拒绝使用——\n' +
        '  用别的项目的 vite 构建会得到难以定位的错误，比直接说没装更难查。'
    );
  }

  const manifest = require(manifestPath);
  const binField = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vite;
  if (!binField) throw new Error('vite 的 package.json 里没有 bin.vite：' + manifestPath);

  const bin = join(dirname(manifestPath), binField);
  if (!existsSync(bin)) throw new Error('vite 可执行文件不存在：' + bin);
  return bin;
}

/** path 是否位于 root 或 root 的某个祖先的 node_modules 之下。 */
function isReachableFrom(path, root) {
  const normalized = resolve(path).replaceAll('\\', '/').toLowerCase();
  let dir = root;
  for (;;) {
    const prefix = (dir.replaceAll('\\', '/').toLowerCase() + '/node_modules/').replaceAll('//', '/');
    if (normalized.startsWith(prefix)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 起构建进程并等首个产物出现。
 *
 * @param cwd         项目目录（vite 在这里找 vite.config.ts）
 * @param outDir      输出目录，缺省 ./dev
 * @param artifact    首个产物的相对路径，缺省 theme.css；插件传 index.js
 * @param timeoutMs   等产物的上限
 * @param extraArgs   附加给 vite 的参数
 * @returns {{ proc, ready: boolean, reason: string|null, stop: () => void }}
 */
export async function startBuild({
  cwd = process.cwd(),
  outDir = './dev',
  artifact = 'theme.css',
  timeoutMs = 60000,
  extraArgs = [],
  onOutput = null,
} = {}) {
  const bin = resolveViteBin(cwd);
  const artifactPath = resolve(cwd, outDir, artifact);

  // --emptyOutDir false：watch 模式下每次重建都清空会把思源正在读的文件删掉。
  const argv = [bin, 'build', '--watch', '--outDir', outDir, '--emptyOutDir', 'false', ...extraArgs];
  const proc = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  const forward = (chunk) => {
    const text = chunk.toString();
    if (onOutput) onOutput(text);
  };
  proc.stdout.on('data', forward);
  proc.stderr.on('data', forward);

  let exited = null;
  proc.on('exit', (code) => {
    exited = code;
  });

  const deadline = Date.now() + timeoutMs;
  while (!existsSync(artifactPath) && Date.now() < deadline) {
    if (exited !== null) {
      return {
        proc,
        ready: false,
        reason: '构建进程提前退出（退出码 ' + exited + '），产物未生成：' + artifactPath,
        stop: () => {},
      };
    }
    await sleep(200);
  }

  if (!existsSync(artifactPath)) {
    return {
      proc,
      ready: false,
      reason: '等 ' + timeoutMs + 'ms 仍未生成 ' + artifactPath,
      stop: () => stopProcess(proc),
    };
  }

  return { proc, ready: true, reason: null, stop: () => stopProcess(proc) };
}

function stopProcess(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    proc.kill();
  } catch {
    // 已经没了
  }
}

/**
 * 监听产物目录，合并短时间内的多次写入后回调。
 *
 * 构建会同时写多个文件（css + js + json），不合并就会一次改动触发好几轮重载。
 * 用 fs.watch 而不是 chokidar：本包不想多一个依赖，而产物目录的结构是已知的。
 */
export function watchArtifact(dir, { match, debounceMs = 150, onChange }) {
  let timer = null;

  const watcher = watch(resolve(dir), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = String(filename).replaceAll('\\', '/');
    if (match && !match(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(name), debounceMs);
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}
