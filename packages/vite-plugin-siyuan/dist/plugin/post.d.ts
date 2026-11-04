import type { Plugin } from 'vite';
import type { Target } from '../core/targets.ts';
/** 打包选项。 */
export interface PackOptions {
    /** 输出 zip 相对项目根的路径，如 `package.zip`。 */
    outFile: string;
    /** 要打包的目录，缺省产物目录。 */
    inDir?: string;
}
/** 收尾插件的选项。 */
export interface PostPluginOptions {
    /** 取被测目标；拿不到就跳过校验。 */
    resolveTarget: () => Target | null;
    /** 项目根目录。 */
    cwd: string;
    /** 产物目录（绝对路径）。 */
    outDir: string;
    /** 是否校验。 */
    verify: boolean;
    /** 打包配置；null 表示不打包。 */
    pack: PackOptions | null;
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