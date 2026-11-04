import type { Plugin } from 'vite';
/** 资产插件的选项。 */
export interface AssetsPluginOptions {
    /** 项目根目录，缺省当前工作目录。 */
    cwd?: string;
    /** 清单文件相对路径，缺省 `public/theme.json`；插件传 `public/plugin.json`。 */
    manifestPath?: string;
    /** 额外搬运规则，缺省从清单推导。每条是 `{ src: glob, dest: 相对产物根 }`。 */
    extraFiles?: Array<{
        src: string;
        dest?: string;
    }> | null;
    /** 是否监听 `public/`，缺省 true。 */
    watchPublic?: boolean;
}
/**
 * 思源产物资产插件。
 *
 * 两个职责：把 `public/**` 加进监听（否则改了不重建），
 * 把清单声明的元数据文件搬进产物。
 */
export default function siyuanAssets(options?: AssetsPluginOptions): Plugin;
//# sourceMappingURL=assets.d.ts.map