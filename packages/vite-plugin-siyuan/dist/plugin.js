import { startDevSession } from './dev-session.js';
import { detectTargetType } from './target-types.js';
// 静态 import：内置类型是在 targets.ts 求值时注册进注册表的。
// 只 import target-types 会拿到空注册表——这个坑踩过一次。
import './targets.js';
/** 插件名，用于日志前缀。 */
const NAME = 'vite-plugin-siyuan';
/**
 * 智源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：将来要加 `:prod` 之类的插件时，
 * 不用改调用方的写法。
 */
export default function siyuanDev(options = {}) {
    const { kind = null, name = null, outDir = null, link = true, headless = false, frontend = 'desktop', enabled = true, } = options;
    let session = null;
    let starting = null;
    /** 第一次构建不是「变更」：只启动会话，不触发重载。 */
    let firstBundle = true;
    let root = process.cwd();
    const log = (message) => console.log(`[${NAME}] ${message}`);
    /** 会话是懒启动的：首次构建完成、产物真的在磁盘上之后才开始。 */
    async function ensureSession() {
        if (session)
            return session;
        if (starting)
            return starting;
        starting = (async () => {
            let resolvedKind = kind;
            if (!resolvedKind) {
                const detected = detectTargetType(root);
                if (!detected.ok)
                    throw new Error(detected.reason);
                resolvedKind = detected.kind;
                log(`类型：${resolvedKind}（从清单推断）`);
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
            configResolved(resolved) {
                root = resolved.root;
                if (!resolved.build.watch) {
                    log('警告：没有开启 watch，热重载不会生效。父项目请用 `vite build --watch`。');
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
    ];
}
//# sourceMappingURL=plugin.js.map