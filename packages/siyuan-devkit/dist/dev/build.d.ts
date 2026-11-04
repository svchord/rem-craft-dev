import type { ChildProcess } from 'node:child_process';
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
export declare function viteCommand({ cwd, outDir, extraArgs, }?: {
    cwd?: string;
    outDir?: string;
    extraArgs?: string[];
}): Promise<BuildCommand>;
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
export declare function resolveViteBin(cwd?: string): string;
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
export declare function startBuild({ cwd, outDir, artifact, command, timeoutMs, extraArgs, onOutput, }?: StartBuildOptions): Promise<BuildHandle>;
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
export declare function watchArtifact(dir: string, { match, debounceMs, onChange }: WatchArtifactOptions): ArtifactWatcher;
//# sourceMappingURL=build.d.ts.map