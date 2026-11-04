/**
 * 产物与清单校验。
 *
 * ## 为什么这件事该由包做
 *
 * 思源的失败模式是**静默的**——这和我们对照过的 Electron 生态根本不同：
 * Electron 的产物指错地方会启动崩溃、报错可见；思源则是什么都不显示。
 *
 *   theme.json 缺 modes      → 主题不出现在列表里
 *   frontends 缺 mobile      → 移动端不加载，桌面端看着正常
 *   版本号与 package.json 不一致 → 集市判为旧版，不推送更新
 *   产物缺 index.js          → 插件加载不到，没有任何提示
 *
 * 这些规则每个思源项目都要写一遍，写成什么样全凭各自的理解。收进包后
 * 只需描述符声明「我这个类型独有的是什么」，通用的部分统一在这里。
 *
 * ## 分层
 *
 *   通用（本文件）       版本一致、必需字段、semver、i18n 的 default 项、
 *                        产物里的 expectedFiles
 *   类型特有（描述符）   verifyManifest() / verifyArtifact()
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/** 读 JSON；读不到或解析失败返回 null。 */
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/** 是不是 semver（只认 `x.y.z`，与思源集市一致）。 */
export const isSemver = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
/** 清单里某个字段是不是「必须带 default 的 i18n 对象」。 */
function checkI18nField(manifest, field) {
    const value = manifest[field];
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return 'default' in value
        ? null
        : {
            message: `${field} 是 i18n 对象但没有 default 项`,
            hint: '思源按 default 回退，缺了会显示空白。加上 {"default": "..."}。',
        };
}
/** 递归列出目录下所有文件名（相对路径）。 */
function walk(dir, base = '') {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [rel];
    });
}
/**
 * 校验一个目标的清单与产物。
 *
 * @returns 问题列表；空表示通过
 */
export function verifyTarget(target, { root, outDir }) {
    const issues = [];
    const config = target.buildConfig();
    const absOutDir = outDir.startsWith(root) ? outDir : join(root, outDir);
    const manifestName = target.descriptor.manifestName();
    const manifestPath = join(root, 'public', manifestName);
    const manifest = readJson(manifestPath) ?? readJson(join(root, 'dist', manifestName));
    const packageJson = readJson(join(root, 'package.json'));
    // ---- 通用：清单存在与必需字段 ----
    if (!manifest) {
        issues.push({
            message: `读不到清单：public/${manifestName}`,
            hint: '思源按清单识别主题/插件，缺了它不会出现在列表里。',
        });
    }
    else {
        for (const field of ['name', 'author', 'url', 'version']) {
            if (!manifest[field]) {
                issues.push({ message: `清单缺少必需字段：${field}` });
            }
        }
        // ---- 通用：版本一致 ----
        // 不一致的后果不是报错，而是集市判为旧版、用户收不到更新。
        if (packageJson && manifest.version && packageJson.version !== manifest.version) {
            issues.push({
                message: `版本不一致：package.json=${String(packageJson.version)}，清单=${String(manifest.version)}`,
                hint: '集市按清单版本判新旧，不一致会导致更新不推送。',
            });
        }
        // ---- 通用：清单 version 必须是 semver ----
        if (manifest.version && !isSemver(manifest.version)) {
            issues.push({
                message: `清单 version 不是 semver：${String(manifest.version)}`,
                hint: '应为 主.次.修订，如 1.2.3。',
            });
        }
        // ---- 通用：i18n 字段必须带 default ----
        for (const field of ['displayName', 'description', 'readme']) {
            const issue = checkI18nField(manifest, field);
            if (issue)
                issues.push(issue);
        }
    }
    // ---- 产物目录存在与必需文件 ----
    if (!existsSync(absOutDir)) {
        issues.push({
            message: `产物目录不存在：${absOutDir}`,
            hint: '先跑一次构建。',
        });
    }
    else {
        const files = walk(absOutDir);
        for (const expected of config.expectedFiles) {
            if (!files.includes(expected)) {
                issues.push({
                    message: `产物缺少 ${expected}`,
                    hint: `思源按固定文件名加载，缺了不会报错、只是加载不到。`,
                });
            }
        }
    }
    // ---- 类型特有 ----
    const context = {
        root,
        files: existsSync(absOutDir) ? readdirSync(absOutDir) : [],
        readOutput: (file) => {
            try {
                return readFileSync(join(absOutDir, file), 'utf8');
            }
            catch {
                return null;
            }
        },
        manifest,
        packageJson,
    };
    const descriptor = target.descriptor;
    if (typeof descriptor.verifyManifest === 'function') {
        issues.push(...descriptor.verifyManifest(context));
    }
    if (typeof descriptor.verifyArtifact === 'function' && existsSync(absOutDir)) {
        issues.push(...descriptor.verifyArtifact(context));
    }
    return { ok: issues.length === 0, issues };
}
/** 把问题列表打印成可读文本。 */
export function formatIssues(issues) {
    return issues
        .map((issue) => {
        const head = `  ✗ ${issue.message}`;
        return issue.hint ? `${head}\n    ${issue.hint}` : head;
    })
        .join('\n');
}
//# sourceMappingURL=verify.js.map