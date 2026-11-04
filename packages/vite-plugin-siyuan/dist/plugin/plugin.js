/**
 * Vite 插件形态：把开发会话挂进宿主已有的 Vite 生命周期。
 *
 * 用法（父项目 vite.config.ts）：
 *
 *   import siyuan from 'vite-plugin-siyuan/plugin';
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
 * `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存里编译
 * （实测不产生任何磁盘文件）。插件 JS 更严格——思源用
 * `window.eval("(function anonymous(require, module, exports){…})")` 执行，
 * 需要 CJS 单文件，dev server 给的是 ESM 模块图。
 *
 * 所以本插件只挂 `build`，父项目必须跑 `vite build --watch`。
 *
 * ## 为什么用 writeBundle 而不是 closeBundle
 *
 * `writeBundle(options, bundle)` 直接给出本次产出的文件名，不用自己 watch
 * 目录猜。实测在 `build --watch` 下每次重建都会触发。
 *
 * ## 与 CLI 形态的关系
 *
 * 两者共用 dev-session.ts。差别只在「谁跑构建」：
 *   CLI     dev.ts 自己 spawn vite build --watch
 *   插件    宿主 vite 跑构建，本插件在 writeBundle 里喂变更给会话
 */
import { resolve } from 'node:path';
import siyuanAssets from './assets.js';
import { siyuanPost } from './post.js';
import { startDevSession } from '../dev/dev-session.js';
import { createTarget } from '../core/targets.js';
import { detectTargetType, targetType } from '../core/target-types.js';
// 静态 import：内置类型是在 targets.ts 求值时注册进注册表的。
// 只 import target-types 会拿到空注册表——这个坑踩过一次。
import '../core/targets.js';
/** 插件名，用于日志前缀。 */
const NAME = 'vite-plugin-siyuan';
/**
 * 思源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：一个负责热重载，一个负责产物资产。
 * 将来要加 `:prod` 之类的插件时，不用改调用方的写法。
 */
export default function siyuanDev(options = {}) {
    const { target = null, name = null, entry = null, outDir = null, link = true, headless = false, frontend = 'desktop', verify = true, pack = false, assets = true, manifestPath = null, } = options;
    /** 显式指定的类型；null 表示从清单推断。 */
    const requestedKind = target;
    let session = null;
    let starting = null;
    /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
    let firstBundle = true;
    let root = process.cwd();
    /**
     * 开发还是生产。由 `build.watch` 判断，不额外传参。
     *
     * 实测五种写法都能拿到：`--watch`、`-w`、config 里 `watch:{}`、
     * `watch:true`、都不写。Vite 自己已经把命令行归一化进 build.watch，
     * 项目再传一个 `isWatch` 只是重复同一件事，还多一个可能不一致的输入。
     */
    let dev = false;
    const log = (message) => console.log(`[${NAME}] ${message}`);
    /**
     * 解析被测类型与对象。
     *
     * 这是「target / kind 入参 → 类型名 → 描述符 → Target」的唯一入口。
     * 之前 config()、ensureSession()、post 的 resolveTarget 各写了一遍，
     * 加一种类型时要改三处——注册表可扩展的承诺就毁在这上面。
     *
     * @param cwd  项目根目录（config() 早于 configResolved，只能用 cwd）
     * @param announce 是否打日志（只有会话启动时需要）
     */
    function resolveTarget(cwd, announce = false) {
        let resolvedKind = requestedKind;
        if (!resolvedKind) {
            const detected = detectTargetType(cwd);
            if (!detected.ok)
                return { ok: false, reason: detected.reason };
            resolvedKind = detected.kind;
            if (announce)
                log(`类型：${resolvedKind}（从清单推断；可用 target 显式指定）`);
        }
        else if (announce) {
            log(`类型：${resolvedKind}（入参指定）`);
        }
        try {
            return { kind: resolvedKind, target: createTarget(resolvedKind, { name, cwd }) };
        }
        catch (cause) {
            return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
        }
    }
    /** 从 resolveTarget 的结果里取 Target；失败返回 null。 */
    function targetOrNull(result) {
        return 'target' in result ? result.target : null;
    }
    /**
     * 从描述符拿清单文件名，不硬编码 theme.json / plugin.json。
     *
     * 注意这里不能用 resolveTarget()：它会 createTarget（要读清单里的 name），
     * 而 asset 插件在 config() 阶段就得构造好，那时清单可能还没建。
     */
    function manifestFile(cwd) {
        let kind = requestedKind;
        if (!kind) {
            const detected = detectTargetType(cwd);
            if (!detected.ok)
                return 'theme.json';
            kind = detected.kind;
        }
        try {
            return targetType(kind).descriptor.manifestName();
        }
        catch {
            return 'theme.json';
        }
    }
    /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
    async function ensureSession() {
        if (session)
            return session;
        if (starting)
            return starting;
        starting = (async () => {
            const resolved = resolveTarget(root, true);
            if (!('target' in resolved))
                throw new Error(resolved.reason);
            const created = await startDevSession({
                kind: resolved.kind,
                name,
                cwd: root,
                outDir,
                link,
                headless,
                frontend,
                log,
                // 变更由宿主的 writeBundle 喂进来，不自己 watch 目录。
                watch: false,
            });
            session = created;
            return created;
        })();
        try {
            return await starting;
        }
        finally {
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
                const watch = Boolean(userConfig.build?.watch);
                const context = { command: env.command, watch, root };
                const resolved = resolveTarget(context.root);
                const resolvedTarget = targetOrNull(resolved);
                if (!resolvedTarget) {
                    // 没有清单就不知道产物该叫什么；交给项目自己配，不在这里报错。
                    log('跳过构建配置注入：识别不到被测类型');
                    return undefined;
                }
                // entry 是相对项目根的路径，解析成绝对路径再交给 rollup。
                const input = entry ? resolve(context.root, entry) : null;
                const spec = resolvedTarget.buildSpec(context, { entry: input });
                if (!spec)
                    return undefined;
                const build = (userConfig.build ??= {});
                build.outDir ??= outDir ?? spec.outDir;
                if (spec.emptyOutDir !== undefined)
                    build.emptyOutDir ??= spec.emptyOutDir;
                if (spec.input || spec.rollupOutput || spec.external) {
                    const rollupOptions = (build.rollupOptions ??= {});
                    if (spec.input)
                        rollupOptions.input ??= spec.input;
                    if (spec.external)
                        rollupOptions.external ??= spec.external;
                    // output 可能是数组（多入口拆分），那种情况不插手——项目自己在管。
                    if (spec.rollupOutput && !Array.isArray(rollupOptions.output)) {
                        const output = (rollupOptions.output ??= {});
                        const specOutput = spec.rollupOutput;
                        output.format ??= specOutput.format;
                        output.entryFileNames ??= specOutput.entryFileNames;
                        output.assetFileNames ??= specOutput.assetFileNames;
                    }
                }
                // 原地改，不返回：返回对象会被 Vite 当作用户配置合并，语义容易搞混。
                return undefined;
            },
            configResolved(resolved) {
                root = resolved.root;
                // 开发/生产由 `build.watch` 判断，不额外传参——实测五种写法
                // （--watch / -w / config 里 watch:{} / watch:true / 都不写）都能拿到。
                dev = Boolean(resolved.build.watch);
                if (!dev) {
                    log('生产构建：不启动热重载会话，会校验产物。开发请用 `vite build --watch`。');
                }
            },
            async writeBundle(_options, bundle) {
                // 生产构建没有浏览器、也不需要热重载——但校验和打包由 :post 插件负责，
                // 它们不看 dev，所以 CI 里仍然会跑。
                if (!dev)
                    return;
                const files = Object.keys(bundle);
                // 第一次构建不是「变更」：此时会话可能还没起来，启动它即可，
                // 不要触发一次多余的重载（vite-plugin-electron 用同样的 firstBundle 标志规避）。
                if (firstBundle) {
                    firstBundle = false;
                    try {
                        await ensureSession();
                        log('会话就绪，改源码会自动重载');
                    }
                    catch (cause) {
                        log(`启动失败：${cause instanceof Error ? cause.message : String(cause)}`);
                    }
                    return;
                }
                try {
                    const current = await ensureSession();
                    current.notifyChange(files);
                }
                catch (cause) {
                    log(`重载失败：${cause instanceof Error ? cause.message : String(cause)}`);
                }
            },
            async closeBundle() {
                // watch 模式下每次重建后也会走到这里，不能在这里关会话。
                // 只有非 watch（一次性构建）才清理。
                if (this.meta?.watchMode)
                    return;
                if (session) {
                    await session.stop();
                    session = null;
                }
            },
        },
        // 产物资产：监听 public/（Vite 不监听 publicDir）+ 搬运清单声明的元数据文件。
        // 默认带上——没有它，改 theme.json 不会触发重建，这让「改清单不生效」很难查。
        ...(assets
            ? [
                siyuanAssets({
                    cwd: root,
                    // 清单名从描述符取，不硬编码——注册新类型时这里自动跟着变。
                    manifestPath: manifestPath ?? `public/${manifestFile(root)}`,
                }),
            ]
            : []),
        // 收尾：校验产物 + 打包。用 enforce: 'post' 确保在所有产物写完之后跑，
        // 且校验失败时不打包。它不看 dev——两个环境都校验，只是失败处理不同。
        siyuanPost({
            verify,
            pack,
            resolveTarget: () => targetOrNull(resolveTarget(root)),
            log,
        }),
    ];
}
//# sourceMappingURL=plugin.js.map