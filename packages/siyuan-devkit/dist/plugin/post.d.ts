import type { Plugin } from 'vite';
import type { Target } from '../core/targets.ts';
/**
 * 思源集市的发布产物名。
 *
 * 两个项目以及官方 sample 一致使用 `package.zip`：
 *   主题项目 .releaserc.json 的 assets 指向它
 *   插件项目 vite.config 的 outFileName 是它
 * 所以这是思源生态的约定，不是项目自己的偏好——不该由入参指定。
 *
 * 放在这里而不是描述符里：主题和插件用的是同一个名字，
 * 没有必要让每个描述符重复声明。将来自定义类型如果不同，再提升为能力。
 */
export declare const PACKAGE_NAME = "package.zip";
/** 收尾插件的选项。 */
export interface PostPluginOptions {
    /** 取被测目标；拿不到就跳过校验。 */
    resolveTarget: () => Target | null;
    /** 是否校验。 */
    verify: boolean;
    /** 是否打包（名字固定为 package.zip）。 */
    pack: boolean;
    /** 日志函数。 */
    log: (message: string) => void;
}
/**
 * 写一个 zip 文件。
 *
 * 同步实现：`writeBundle` 之后构建随时可能结束，用异步流有写不完的风险。
 * 思源主题/插件包只有几 MB，同步写完全可接受。
 */
export declare function writeZip(dir: string, outFile: string): {
    files: number;
    bytes: number;
};
/**
 * 收尾插件：产物校验 + 打包。
 */
export declare function siyuanPost(options: PostPluginOptions): Plugin;
//# sourceMappingURL=post.d.ts.map