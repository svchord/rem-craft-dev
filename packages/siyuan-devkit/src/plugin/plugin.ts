/**
 * Vite 插件形态：把开发会话挂进宿主已有的 Vite 生命周期。
 *
 * 用法（父项目 vite.config.ts）：
 *
 *   import siyuan from 'siyuan-devkit/plugin';
 *
 *   export default defineConfig({
 *     plugins: [siyuan()],   // 类型从 public/ 清单自动推断
 *   });
 *
 * 然后照常 `vite build --watch`。
 *
 * ## 为什么是 `apply: 'build'` 而不是 `'serve'`
 *
 * vite-plugin-electron 挂的是 `apply: 'serve'`，因为 Electron 从 dev server
 * 加载页面，不需要磁盘产物。思源相反：它从磁盘读
 * `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存里编译、
 * 不落盘。插件 JS 更严格——思源用
 * `window.eval("(function anonymous(require, module, exports){…})")` 执行，
 * 需要 CJS 单文件，dev server 给的是 ESM 模块图。
 *
 * 所以本插件只挂 `build`，父项目必须跑 `vite build --watch`。
 *
 * ## 为什么用 writeBundle 驱动重载
 *
 * `writeBundle(options, bundle)` 直接给出本次产出的文件名，不用自己 watch
 * 目录猜；在 `build --watch` 下每次重建都会触发。
 * 会话的**释放**不在这里：见下。
 *
 * ## 会话什么时候释放
 *
 * watch 时每次重建都会走 writeBundle / closeBundle，绝不能在那里关会话；
 * 会话要跨重建存活。释放放在 `closeWatcher`——Vite/Rolldown 关闭 watcher
 * 时只调用一次，正好对应「进程退出」。非 watch 构建根本不启动会话，
 * 也没有 watcher，无需清理。另有进程 exit 时的同步兜底。
 *
 * ## 与程序 API 的关系
 *
 * 两者共用 dev-session.ts。差别只在「谁跑构建」：
 *   startDev() 自己 spawn vite build --watch
 *   插件形态    宿主 vite 跑构建，本插件在 writeBundle 里喂变更给会话
 */
import { resolve } from 'node:path';
import boxen from 'boxen';
import { createConsola } from 'consola';
import type { Plugin } from 'vite';
import { siyuanAssets } from './assets.ts';
import { siyuanPost } from './post.ts';
import { applyResolvedConfig, createPluginState, isWatchBuild } from './state.ts';
import type { PluginState } from './state.ts';
import { messageOf } from './shared.ts';
import { startDevSession } from '../dev/dev-session.ts';
import type { DevSession, LogLevel } from '../dev/dev-session.ts';
import { createTarget } from '../core/targets.ts';
import type { Target } from '../core/targets.ts';
import { detectTargetType, targetType } from '../core/target-types.ts';
import { frontendLinks } from '../core/siyuan.ts';
import type { Frontend } from '../core/siyuan.ts';

/** 插件名，用于日志前缀。 */
const NAME = 'siyuan-devkit';

/** 插件日志用 consola：只优化给人看的开发日志，CLI 输出仍保持纯文本。 */
const rootLogger = createConsola({
  level: process.env.SYT_DEBUG ? 5 : 3,
  formatOptions: { compact: false },
});
const logger = rootLogger.withTag(NAME);

/** 插件选项。 */
export interface SiYuanPluginOptions {
  /**
   * 被测类型，显式指定时跳过自动推断。
   *
   *   'theme'   主题项目
   *   'plugin'  插件项目
   *
   * 缺省从 `public/` 下的清单推断（theme.json → theme，plugin.json → plugin）。
   * 显式指定的意义：自动推断靠清单存在与否，同一项目里若有多个清单、
   * 或清单还没创建时不猜。
   */
  target?: string | null;
  /**
   * 构建入口，相对项目根。两种类型都接受：
   *
   *   主题  entry: 'src/styles/index.css'   → rollupOptions.input
   *   插件  entry: 'src/index.tsx'          → rollupOptions.input + output.format='cjs'
   *
   * 为什么要统一：入口本来就只是「从哪开始构建」，主题是 CSS、插件是 TSX，
   * 差别在产物形态而不在入口概念。产物形态由类型描述符决定（主题产出
   * theme.css、插件产出 index.js CJS 单文件），项目只需要说清楚入口在哪。
   *
   * 不传则保留项目自己写在 `rollupOptions.input` / `build.lib` 里的配置。
   * 注意**不要用 `build.lib`**：lib 隐含 `cssCodeSplit: false`，与 CSS 入口冲突
   * （Vite 会报错），而且插件会产出 `index.cjs` 而非 `index.js`。
   */
  entry?: string | null;
  /** 产物目录；缺省取类型描述符的值（通常是 ./dev）。 */
  outDir?: string | null;
  /**
   * 开发时是否打开一个受本工具控制的预览窗口，缺省 false。
   *
   * **热重载依赖它**：主题 CSS 的重载方式是在受控页面里换 `#themeStyle` 的 href。
   * 思源没有等价的外科式内核接口（`/api/ui/reloadUI` 会整页刷新、丢掉编辑状态），
   * 所以不打开窗口时只重建产物、不热重载，日志会如实说明。
   *
   * 不打开窗口时仍打印桌面端/移动端预览链接，方便手动打开或截图。
   */
  browser?: boolean;
  /** `browser: true` 时打开哪个前端，缺省 desktop。 */
  frontend?: Frontend;
  /** `browser: true` 时是否无头，缺省 false（可见窗口）。 */
  headless?: boolean;
  /**
   * 清单路径（相对项目根）。缺省按类型取 `public/theme.json` 或 `public/plugin.json`；
   * 清单不放在 `public/` 时显式传这个值。
   */
  manifestPath?: string | null;
}

/**
 * 思源开发插件。
 *
 * 返回三个插件（和 vite-plugin-electron 的数组形态一致）：
 *   :dev     注入构建配置 + 驱动热重载会话
 *   :assets  监听 public/ + 搬运清单声明的元数据文件
 *   :post    校验产物 + 打包（enforce: 'post'，必须看到完整产物）
 * 三者共享同一份 PluginState，见 state.ts。也可以分别 import
 * siyuanAssets / siyuanPost 自行组合。
 */
export default function siyuanDev(options: SiYuanPluginOptions = {}): Plugin[] {
  const {
    target = null,
    entry = null,
    outDir = null,
    browser = false,
    frontend = 'desktop',
    headless = false,
    manifestPath = null,
  } = options;

  /** 显式指定的类型；null 表示从清单推断。 */
  const requestedKind = target;

  /** 三个插件共享的只读状态；只有 configResolved 写它。 */
  const state: PluginState = createPluginState(process.cwd());

  /** 插件日志：按级别交给 consola，与 CLI 的纯文本输出分开。 */
  const log = (message: string, level: LogLevel = 'info'): void => {
    switch (level) {
      case 'success':
        logger.success(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
      case 'debug':
        logger.debug(message);
        break;
      default:
        logger.info(message);
    }
  };

  /** 首次会话就绪后给出桌面端/移动端两个稳定预览入口。 */
  const logPreviewLinks = (port: number): void => {
    const [desktop, mobile] = frontendLinks(port);
    rootLogger.log(
      boxen([`桌面端  ${desktop.url}`, `移动端  ${mobile.url}`].join('\n'), {
        title: '开发预览（F5 后仍是当前主题）',
        titleAlignment: 'left',
        borderStyle: 'round',
        borderColor: 'cyan',
        dimBorder: true,
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      })
    );
  };

  let session: DevSession | null = null;
  let starting: Promise<DevSession> | null = null;
  /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
  let firstBundle = true;
  /** config() 阶段看到的 watch，用来和 Vite 归一化后的值对账。 */
  let configWatch: boolean | null = null;
  let exitHandler: (() => void) | null = null;

  /**
   * 释放会话（幂等）。closeWatcher 与进程 exit 兜底都走这里。
   * DevSession.stop() 自己也是幂等的，会关浏览器、控制服务、产物 watcher 与临时 profile。
   */
  async function stopSession(): Promise<void> {
    const current = session;
    if (!current) return;
    session = null;
    if (exitHandler) {
      process.off('exit', exitHandler);
      exitHandler = null;
    }
    try {
      await current.stop();
      log('开发会话已释放', 'success');
    } catch (cause) {
      log(`开发会话释放失败：${messageOf(cause)}`, 'error');
    }
  }

  /**
   * 进程硬退出时的同步兜底。'exit' 回调不能 await，所以这里只做同步能完成的
   * 部分：关控制服务、kill 浏览器子进程；完整清理由 closeWatcher 完成。
   */
  function onProcessExit(): void {
    if (!session) return;
    const current = session;
    try {
      current.control?.stop();
    } catch {
      // 已经关了
    }
    try {
      const child = current.browser?.process();
      if (child && !child.killed) child.kill();
    } catch {
      // 浏览器已经退出
    }
  }

  /**
   * 解析被测类型与对象。
   *
   * 这是「target / kind 入参 → 类型名 → 描述符 → Target」的唯一入口。
   * 之前 config()、ensureSession()、post 的 resolveTarget 各写了一遍，
   * 加一种类型时要改三处——注册表可扩展的承诺就毁在这上面。
   *
   * @param cwd  项目根目录
   * @param announce 是否打日志（只有会话启动时需要）
   */
  function resolveTarget(
    cwd: string,
    announce = false
  ): { kind: string; target: Target } | { ok: false; reason: string } {
    let resolvedKind = requestedKind;
    if (!resolvedKind) {
      const detected = detectTargetType(cwd);
      if (!detected.ok) return { ok: false, reason: detected.reason };
      resolvedKind = detected.kind;
      if (announce) log(`类型：${resolvedKind}（从清单推断；可用 target 显式指定）`);
    } else if (announce) {
      log(`类型：${resolvedKind}（入参指定）`);
    }

    try {
      return { kind: resolvedKind, target: createTarget(resolvedKind, { cwd }) };
    } catch (cause) {
      return { ok: false, reason: messageOf(cause) };
    }
  }

  /** 从 resolveTarget 的结果里取 Target；失败返回 null。 */
  function targetOrNull(result: ReturnType<typeof resolveTarget>): Target | null {
    return 'target' in result ? result.target : null;
  }

  /**
   * 从描述符拿清单文件名，不硬编码 theme.json / plugin.json。
   *
   * 注意这里不能用 resolveTarget()：它会 createTarget（要读清单里的 name），
   * 而资产插件在 Vite 解析出 root 之前就得拿到清单相对路径。
   * 兜底值不再是静默的：识别不到或拿不到描述符都会打日志。
   */
  function manifestFile(cwd: string): string {
    let kind = requestedKind;
    if (!kind) {
      const detected = detectTargetType(cwd);
      if (!detected.ok) {
        log(`识别不到清单，资产清单暂按 theme.json：${detected.reason}（可用 target 显式指定）`, 'warn');
        return 'theme.json';
      }
      kind = detected.kind;
    }
    try {
      return targetType(kind).descriptor.manifestName();
    } catch (cause) {
      // 注册了新类型却取不到描述符时必须让人看见，不能悄悄退回内置类型。
      log(`取清单名失败（target=${kind}），暂按 theme.json：${messageOf(cause)}`, 'warn');
      return 'theme.json';
    }
  }

  /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
  async function ensureSession(): Promise<DevSession> {
    if (session) return session;
    if (starting) return starting;

    starting = (async () => {
      const resolved = resolveTarget(state.root, true);
      if (!('target' in resolved)) throw new Error(resolved.reason);

      const created = await startDevSession({
        kind: resolved.kind,
        cwd: state.root,
        outDir,
        browser,
        frontend,
        headless,
        log,
        // 变更由宿主的 writeBundle 喂进来，不自己 watch 目录。
        watch: false,
      });
      session = created;
      if (!exitHandler) {
        exitHandler = onProcessExit;
        process.once('exit', exitHandler);
      }
      return created;
    })();

    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  return [
    {
      name: `${NAME}:dev`,
      apply: 'build',

      /**
       * 注入构建配置：入口、产物名、模块格式都由思源的加载机制决定。
       *
       * 全部用 `??=` 补缺，**不覆盖用户已写的值**——社区里 electron-vite 与
       * @samrum/vite-plugin-web-extension 都是这个模式（`config.build ??= {}`）。
       * 这样项目想换个产物目录时仍能覆盖，不需要关掉插件。
       *
       * 只注入「思源决定的」部分；minify / sourcemap / target 归项目。
       */
      config(userConfig, env) {
        // config() 早于 configResolved，拿不到 ResolvedConfig：root 只能先取
        // 用户配置里的 root（若有），否则用 state 的初值；configResolved 会覆盖。
        const root = typeof userConfig.root === 'string' ? resolve(userConfig.root) : state.root;
        // buildSpec 必须在这个阶段决定 outDir / emptyOutDir，只能用同一个
        // isWatchBuild() 归一化；归一化后的权威值在 configResolved 写入 state。
        const watch = isWatchBuild(userConfig.build?.watch);
        configWatch = watch;
        const context = { command: env.command, watch, root };
        const resolved = resolveTarget(context.root);
        const resolvedTarget = targetOrNull(resolved);
        if (!resolvedTarget) {
          // 没有清单就不知道产物该叫什么；交给项目自己配，不在这里报错。
          log('跳过构建配置注入：识别不到被测类型', 'warn');
          return undefined;
        }
        // entry 是相对项目根的路径，解析成绝对路径再交给 rollup。
        const input = entry ? resolve(context.root, entry) : null;
        const spec = resolvedTarget.buildSpec(context, { entry: input });
        if (!spec) return undefined;

        const build = (userConfig.build ??= {});
        build.outDir ??= outDir ?? spec.outDir;
        if (spec.lib) build.lib ??= spec.lib;
        // minify 归插件统一管：watch 不压缩（便于直接看落盘产物），生产用默认压缩器；项目写了优先。
        build.minify ??= watch ? false : true;

        // 插件在思源前端 eval 执行，而思源前端没有 process 对象；React 等依赖会读
        // process.env.NODE_ENV，默认补一条 define（项目自己写了以项目为准）。
        const define = (userConfig.define ??= {});
        define['process.env.NODE_ENV'] ??= JSON.stringify(watch ? 'development' : 'production');

        if (spec.emptyOutDir !== undefined) build.emptyOutDir ??= spec.emptyOutDir;

        if (spec.input || spec.rollupOutput || spec.external) {
          const rollupOptions = (build.rollupOptions ??= {});
          if (spec.input) rollupOptions.input ??= spec.input;
          if (spec.external) rollupOptions.external ??= spec.external;

          // output 可能是数组（多入口拆分），那种情况不插手——项目自己在管。
          // 先取局部引用：直接对联合类型的属性用 ??= 会丢掉 Array.isArray 的收窄，
          // 局部引用被收窄成 OutputOptions 后就能按字段补缺，不必断言成 Record。
          if (spec.rollupOutput) {
            const existingOutput = rollupOptions.output;
            if (!Array.isArray(existingOutput)) {
              const output = existingOutput ?? {};
              const specOutput = spec.rollupOutput;
              output.format ??= specOutput.format;
              output.entryFileNames ??= specOutput.entryFileNames;
              output.assetFileNames ??= specOutput.assetFileNames;
              // 原来没写 output 时才挂上去；已有对象是原地补缺，不覆盖项目的值。
              if (existingOutput === undefined) rollupOptions.output = output;
            }
          }
        }

        // 原地改，不返回：返回对象会被 Vite 当作用户配置合并，语义容易搞混。
        return undefined;
      },

      configResolved(resolvedConfig) {
        // 唯一的写入点：Vite 已把 --watch / -w / config 里的 watch:{} / watch:true
        // 归一化成 resolved.build.watch（applyResolvedConfig 内部即
        // Boolean(resolved.build.watch)），三个插件只读 state，不再各自读
        // this.meta.watchMode 或 userConfig.build.watch。
        applyResolvedConfig(state, resolvedConfig);
        if (configWatch !== null && configWatch !== state.watch) {
          log(`注意：config() 看到 watch=${configWatch}，Vite 归一化后为 ${state.watch}，以归一化值为准`, 'warn');
        }
        if (!state.watch) {
          log('生产构建：不启动热重载会话；会校验产物并打包。开发请用 `vite build --watch`。');
        }
      },

      async writeBundle(_options, bundle) {
        // 生产构建没有浏览器、也不需要热重载——但校验和打包由 :post 插件负责，
        // 它同样只读 state.watch，所以 CI 里仍然会跑。
        if (!state.watch) return;
        const files = Object.keys(bundle);

        // 第一次构建不是「变更」：此时会话可能还没起来，启动它即可，
        // 不要触发一次多余的重载（vite-plugin-electron 用同样的 firstBundle 标志规避）。
        if (firstBundle) {
          firstBundle = false;
          try {
            const created = await ensureSession();
            log('会话就绪，改源码会自动重载', 'success');
            logPreviewLinks(created.kernelPort);
          } catch (cause) {
            // watch 形态必须有思源在跑（热重载依赖 kernel + 浏览器）。连不上就明确报错、
            // 并让构建失败，而不是静默继续——否则会以为改源码在生效，其实热重载没起来。
            throw new Error(`watch 模式需要思源在运行：${messageOf(cause)}`);
          }
          return;
        }

        try {
          const current = await ensureSession();
          current.notifyChange(files);
        } catch (cause) {
          log(`重载失败：${messageOf(cause)}`, 'error');
        }
      },

      /**
       * watcher 关闭时只调用一次，这才是「进程退出」的正确清理点。
       * 每次重建走到的是 writeBundle / closeBundle，那里绝不能关会话；
       * 非 watch 构建不启动会话、也没有 watcher，因此不需要在这里清理。
       */
      async closeWatcher() {
        await stopSession();
      },
    },

    // 产物资产：监听 public/（Vite 不监听 publicDir）+ 搬运清单声明的元数据文件。
    // 固定开启——没有它，改 theme.json 不会触发重建，这让「改清单不生效」很难查。
    siyuanAssets({
      state,
      // 清单名从描述符取，不硬编码；惰性求值，等 Vite 解析出 root 再定清单路径。
      manifestPath: (projectRoot: string) => manifestPath ?? `public/${manifestFile(projectRoot)}`,
      log,
    }),

    // 收尾：校验产物 + 打包。用 enforce: 'post' 确保在所有产物写完之后跑，
    // 且校验失败时不打包。它只读共享 state，两个环境都校验，只是失败处理不同。
    siyuanPost({
      state,
      resolveTarget: () => targetOrNull(resolveTarget(state.root)),
      log,
    }),
  ];
}
