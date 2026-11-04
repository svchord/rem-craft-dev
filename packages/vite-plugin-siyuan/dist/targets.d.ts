import type { Page } from 'puppeteer-core';
import type { ActivateResult, CssSheet, MountState, ReloadResult } from './target-types.ts';
/**
 * 从清单读名字。
 *
 * 主题和插件的清单都有 name 字段，缺了就没法定位安装目录，
 * 所以返回 null 而不是猜一个默认值。
 */
export declare function readManifestName(cwd: string, manifest: string): string | null;
/** 主题独有的构造参数。 */
export interface ThemeTargetOptions {
    /** 显式指定 CSS 路径，覆盖默认的 dev/ → dist/ 探测。 */
    cssPath?: string;
    /** 多个候选路径，按顺序试。 */
    cssPaths?: string[];
    /** 名字；缺省从清单读。 */
    name?: string | null;
    /** 项目目录。 */
    cwd?: string;
}
/** 插件独有的构造参数。 */
export interface PluginTargetOptions {
    /** 插件名（plugin.json 的 name）。 */
    name: string;
    /** 显式指定插件目录（源码在别处、或做 CI 时）。 */
    pluginDir?: string | null;
    /** 项目目录。 */
    cwd?: string;
}
/** 构建看护需要的参数。 */
export interface TargetBuildConfig {
    outDir: string;
    artifact: string;
    expectedFiles: string[];
    match(filename: string): boolean;
    /** 一批产物变化时挑主产物。 */
    primary(filenames: string[]): string;
}
/** 对外的被测目标。编排层只认这个接口。 */
export interface Target {
    readonly kind: string;
    readonly name: string;
    resolveCss(): Promise<CssSheet[]>;
    mountState(page: Page): Promise<MountState>;
    buildConfig(): TargetBuildConfig;
    installDir(options?: {
        workspace?: string | null;
        port?: number | null;
    }): Promise<string>;
    reload(page: Page, options?: {
        filename?: string;
        port?: number | null;
    }): Promise<ReloadResult>;
    /** 开发前让宿主用上它（可选）。 */
    activate: ((page: Page | null, options?: {
        port?: number | null;
    }) => Promise<ActivateResult>) | null;
}
export interface CreateTargetOptions {
    name?: string | null;
    cwd?: string;
    /** 主题专用：显式 CSS 路径。 */
    cssPath?: string;
    /** 主题专用：多个 CSS 候选。 */
    cssPaths?: string[];
    /** 插件专用：显式插件目录。 */
    pluginDir?: string | null;
}
/**
 * 造一个被测目标。
 */
export declare function createTarget(kind: string, options?: CreateTargetOptions): Target;
/** 主题目标。比 createTarget('theme') 读起来清楚。 */
export declare function themeTarget(options?: ThemeTargetOptions): Target;
/** 插件目标。理由同上。 */
export declare function pluginTarget(options: PluginTargetOptions): Target;
//# sourceMappingURL=targets.d.ts.map