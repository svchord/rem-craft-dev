/**
 * 思源产物契约：让 `public/` 的改动也触发重建，并搬运清单声明的元数据文件。
 *
 * ## 为什么必须有这一层
 *
 * Vite 的 `publicDir` 只在**启动时**把 `public/` 复制进产物，之后不再监听它。
 * 实测：`vite build --watch` 下改 `public/theme.json`，构建次数不变，
 * `dev/theme.json` 仍是旧内容。而思源的清单恰恰在 `public/` 里——
 * 改个 `theme.json` 的 `frontends` 或版本号，不重启就永远不生效。
 *
 * 所以需要 `addWatchFile()` 把 `public/**` 显式加进 rollup 的监听集合。
 *
 * ## 为什么还要搬 README
 *
 * 思源清单的 `readme` 字段指向包内文件。这些文件属于仓库元数据（GitHub 首页
 * 也用它们），留在仓库根更合适，但产物里必须有一份。`LICENSE` 通常不需要。
 *
 * 这一层把「哪些文件进产物」收敛成一个函数，主题/插件各自的清单字段差异
 * 由 manifestFiles() 处理。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
/** 从清单的 readme / icon / preview 收集要搬的文件名。 */
function manifestFiles(manifestPath) {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }
    catch {
        return [];
    }
    const files = new Set();
    // readme 可能是字符串，也可能是 { default, 'zh-CN', ... } 的 i18n 对象。
    const readme = manifest.readme;
    if (typeof readme === 'string')
        files.add(readme);
    else if (readme && typeof readme === 'object') {
        for (const value of Object.values(readme)) {
            if (typeof value === 'string')
                files.add(value);
        }
    }
    // icon / preview 是包内必需资源，清单里写了名字就确保它进产物。
    for (const key of ['icon', 'preview']) {
        const value = manifest[key];
        if (typeof value === 'string')
            files.add(value);
    }
    return [...files];
}
/** 极简 glob：只支持 `*`，够用且不引依赖。 */
function matchGlob(name, pattern) {
    if (!pattern.includes('*'))
        return name === pattern;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(name);
}
/** 递归列出目录下所有文件。 */
function walk(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}
/**
 * 思源产物资产插件。
 *
 * 两个职责：把 `public/**` 加进监听（否则改了不重建），
 * 把清单声明的元数据文件搬进产物。
 */
export default function siyuanAssets(options) {
    const { cwd = process.cwd(), manifestPath, extraFiles = null, watchPublic = true } = options;
    const root = resolve(cwd);
    const resolvedManifest = join(root, manifestPath);
    // 缺省规则：清单里声明的文件；推导不出就用 README 通配。
    const declared = manifestFiles(resolvedManifest);
    const rules = extraFiles ?? (declared.length ? declared.map((src) => ({ src })) : [{ src: 'README*.md' }]);
    let config = null;
    return {
        name: 'vite-plugin-siyuan:assets',
        configResolved(resolved) {
            config = resolved;
        },
        /**
         * Vite 不会为 publicDir 建立监听，必须手动 addWatchFile。
         * 放在 buildStart：watch 模式下每次重建前都会重新收集，新建文件也能纳入。
         */
        buildStart() {
            if (!watchPublic)
                return;
            const publicDir = config?.publicDir;
            if (!publicDir)
                return;
            for (const file of walk(publicDir)) {
                this.addWatchFile(file);
            }
        },
        /** 把清单声明的元数据文件复制进产物目录。 */
        writeBundle(bundleOptions) {
            const outDir = bundleOptions.dir ?? config?.build.outDir;
            if (!outDir)
                return;
            // 只处理仓库根一级的文件（README*.md 这种），不递归。
            let entries;
            try {
                entries = readdirSync(root, { withFileTypes: true })
                    .filter((entry) => entry.isFile())
                    .map((entry) => entry.name);
            }
            catch {
                return;
            }
            mkdirSync(outDir, { recursive: true });
            for (const rule of rules) {
                for (const name of entries) {
                    if (!matchGlob(name, rule.src))
                        continue;
                    try {
                        copyFileSync(join(root, name), join(outDir, rule.dest ?? '', name));
                    }
                    catch {
                        // 复制失败不该让整个构建挂掉——CSS 产物已经写好了。
                    }
                }
            }
        },
    };
}
//# sourceMappingURL=assets.js.map