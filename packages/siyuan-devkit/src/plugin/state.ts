/**
 * 三个插件共享的构建状态。
 *
 * 之前每个插件各自判断「是不是 watch」、各自用 process.cwd() 猜项目根：
 *   config()        userConfig.build?.watch
 *   configResolved() resolved.build.watch
 *   post/closeBundle this.meta?.watchMode
 * 三套判据可能给出不同答案，产物目录与校验行为就会错配。
 *
 * 现在只有一份 PluginState：由 siyuan() 的 configResolved 用 Vite **归一化后**的
 * ResolvedConfig 写入一次，三个插件只读它。单独使用 siyuanAssets / siyuanPost
 * 时（不传 state）插件会自建一份，并自己挂 configResolved 填充。
 */
import { resolve } from 'node:path';
import type { ResolvedConfig } from 'vite';

/** Vite 归一化后的构建事实。三个插件只读，写入点只有 applyResolvedConfig。 */
export interface PluginState {
  /** 项目根目录（绝对路径）。 */
  root: string;
  /** 产物目录（绝对路径，已 resolve(root, build.outDir)）；build.outDir 常是 './dev'。 */
  outDir: string;
  /** publicDir 的绝对路径；publicDir: false 时为空串。 */
  publicDir: string;
  /** 是否 watch 构建。唯一来源是 resolved.build.watch。 */
  watch: boolean;
}

/** 造一份初值；cwd 只作为 configResolved 之前（config() 阶段）的回退。 */
export function createPluginState(cwd: string = process.cwd()): PluginState {
  return { root: cwd, outDir: '', publicDir: '', watch: false };
}

/**
 * 唯一的 watch 归一化：Vite 已把 --watch / -w / config 里的 watch:{} /
 * watch:true 收进 build.watch，Boolean 即可，不需要再传 isWatch 入参。
 */
export function isWatchBuild(watch: unknown): boolean {
  return Boolean(watch);
}

/** 用 Vite 归一化后的配置填充状态。三个插件共享同一份，值必然一致。 */
export function applyResolvedConfig(state: PluginState, resolved: ResolvedConfig): void {
  state.root = resolved.root;
  // build.outDir 通常是相对项目根的 './dev' / './dist'，必须解析成绝对路径；
  // 若项目写的是绝对路径，path.resolve 会原样保留。
  state.outDir = resolve(resolved.root, resolved.build.outDir);
  state.publicDir = resolved.publicDir;
  state.watch = isWatchBuild(resolved.build.watch);
}
