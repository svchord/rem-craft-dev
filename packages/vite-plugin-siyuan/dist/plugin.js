import siyuanAssets from './assets.js';
import { startDevSession } from './dev-session.js';
import { createTarget } from './targets.js';
import { detectTargetType } from './target-types.js';
// 静态 import：内置类型是在 targets.ts 求值时注册进注册表的。
// 只 import target-types 会拿到空注册表——这个坑踩过一次。
import './targets.js';
/** 插件名，用于日志前缀。 */
const NAME = 'vite-plugin-siyuan';
/**
 * 思源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：一个负责热重载，一个负责产物资产。
 * 将来要加 `:prod` 之类的插件时，不用改调用方的写法。
 */
export default function siyuanDev(options = {}) {
    const { target = null, kind = null, name = null, outDir = null, link = true, headless = false, frontend = 'desktop', enabled = true, assets = true, manifestPath = null, } = options;
    /** `target` 是新名，`kind` 是旧名。 */
    const requestedKind = target ?? kind;
    let session = null;
    let starting = null;
    /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
    let firstBundle = true;
    let root = process.cwd();
    const log = (message) => console.log(`[${NAME}] ${message}`);
    /**
     * 在 `config()` 阶段解析构建配置片段。
     *
     * `config()` 早于 `configResolved`，此时 `root` 还是 process.cwd()——
     * 但 Vite 调用 `config()` 时 cwd 就是项目根，所以够用。
     */
    function resolveBuildSpec(context) {
        let resolvedKind = requestedKind;
        if (!resolvedKind) {
            const detected = detectTargetType(context.root);
            if (!detected.ok) {
                // 没有清单就不知道产物该叫什么；交给项目自己配，不在这里报错。
                log(`跳过构建配置注入：${detected.reason}`);
                return null;
            }
            resolvedKind = detected.kind;
        }
        try {
            return createTarget(resolvedKind, { cwd: context.root }).buildSpec(context);
        }
        catch {
            return null;
        }
    }
    /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
    async function ensureSession() {
        if (session)
            return session;
        if (starting)
            return starting;
        starting = (async () => {
            let resolvedKind = requestedKind;
            if (!resolvedKind) {
                const detected = detectTargetType(root);
                if (!detected.ok)
                    throw new Error(detected.reason);
                resolvedKind = detected.kind;
                log(`类型：${resolvedKind}（从清单推断；可用 target 显式指定）`);
            }
            else {
                log(`类型：${resolvedKind}（入参指定）`);
            }
            const created = await startDevSession({
                kind: resolvedKind,
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
             * 注入构建配置：产物名由思源的加载机制决定，不该让每个项目自己写。
             *
             * 主题读固定文件名 `theme.css`；插件读 `index.js` + `index.css`。
             * 名字写错思源不会报错，只是静默加载不到——这类错误交给项目去防太不可靠，
             * 所以由类型描述符定死。
             *
             * 只注入「思源决定的」部分；`input` / `lib` / `minify` 仍归项目。
             */
            config(userConfig, env) {
                const watch = Boolean(userConfig.build?.watch);
                const context = { command: env.command, watch, root };
                const spec = resolveBuildSpec(context);
                if (!spec)
                    return undefined;
                const resolvedOutDir = outDir ?? spec.outDir;
                return {
                    build: {
                        ...(resolvedOutDir ? { outDir: resolvedOutDir } : {}),
                        ...(spec.emptyOutDir === undefined ? {} : { emptyOutDir: spec.emptyOutDir }),
                        ...(spec.rollupOutput
                            ? {
                                rollupOptions: {
                                    output: {
                                        ...(spec.rollupOutput.entryFileNames
                                            ? { entryFileNames: spec.rollupOutput.entryFileNames }
                                            : {}),
                                        ...(spec.rollupOutput.assetFileNames
                                            ? { assetFileNames: spec.rollupOutput.assetFileNames }
                                            : {}),
                                    },
                                },
                            }
                            : {}),
                    },
                };
            },
            configResolved(resolved) {
                root = resolved.root;
                // 只在「本该 watch 却没 watch」时提示；生产构建不需要热重载，别制造噪音。
                if (enabled && !resolved.build.watch) {
                    log('提示：当前不是 watch 模式，热重载不会生效。开发请用 `vite build --watch`。');
                }
            },
            async writeBundle(_options, bundle) {
                if (!enabled)
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
                    manifestPath: manifestPath ?? `public/${requestedKind === 'plugin' ? 'plugin.json' : 'theme.json'}`,
                }),
            ]
            : []),
    ];
}
//# sourceMappingURL=plugin.js.map