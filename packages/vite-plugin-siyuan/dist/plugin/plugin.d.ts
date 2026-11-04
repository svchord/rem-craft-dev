import type { Plugin } from 'vite';
import type { Frontend } from '../core/siyuan.ts';
import '../core/targets.ts';
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
    /** 显式指定名字；缺省从清单读。 */
    name?: string | null;
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
     * （实测 Vite 报错），而且插件会产出 `index.cjs` 而非 `index.js`。
     */
    entry?: string | null;
    /** 产物目录；缺省取类型描述符的值（通常是 ./dev）。 */
    outDir?: string | null;
    /** 是否建立链接，缺省 true。 */
    link?: boolean;
    /** 浏览器是否无头，缺省 false。 */
    headless?: boolean;
    /** 打开哪个前端，缺省 desktop。 */
    frontend?: Frontend;
    /**
     * 是否校验产物，缺省 true。
     *
     * 两种环境都校验，但失败处理不同：watch（开发）只警告，
     * 非 watch（CI / 发布）中断构建——产物要发布，坏了代价更大。
     */
    verify?: boolean;
    /**
     * 是否打包为 `package.zip`，缺省 false。
     *
     * 名字是思源集市的产物约定（主题/插件/官方 sample 一致），不由项目指定。
     * 只在非 watch（生产构建）时执行，且在**校验通过之后**——
     * 不会把一个有问题的包发出去。
     */
    pack?: boolean;
    /**
     * 是否附带产物资产插件（搬运 README/icon 等 + 监听 public/）。
     *
     * 缺省 true。关掉它意味着你自己处理 `public/` 变更监听——
     * 注意 Vite 不监听 publicDir，改清单不会触发重建。
     */
    assets?: boolean;
    /** 清单路径，缺省按类型取 `public/theme.json` 或 `public/plugin.json`。 */
    manifestPath?: string | null;
}
/**
 * 思源开发插件。
 *
 * 返回数组（和 vite-plugin-electron 一致）：一个负责热重载，一个负责产物资产。
 * 将来要加 `:prod` 之类的插件时，不用改调用方的写法。
 */
export default function siyuanDev(options?: SiYuanPluginOptions): Plugin[];
//# sourceMappingURL=plugin.d.ts.map