# vite-plugin-siyuan

思源主题/插件开发工具：**Vite 插件**做热重载，**CLI** 提供测量原语。

**只提供能力，不预设该查什么。** 工具不知道你的项目有哪些组件、哪些颜色该配在一起、
什么值算「对」。它负责把页面事实读出来，判断交给调用方（人或 agent）。

## 两种形态

### 1. Vite 插件（推荐）

父项目 `vite.config.ts` 加一行：

```ts
import siyuan from 'vite-plugin-siyuan/plugin';

export default defineConfig({
  plugins: [
    siyuan(), // 类型从 public/ 清单自动推断
  ],
});
```

### 选项

```ts
siyuan({
  target: 'theme', // 'theme' | 'plugin'，缺省从 public/ 清单推断
  name: 'My Theme', // 缺省从清单读
  outDir: './dev', // 缺省按类型取
  link: true, // 是否链接到 <workspace>/data/<subdir>/
  headless: false, // 浏览器是否无头
  frontend: 'desktop', // 'desktop' | 'mobile'
  assets: true, // 是否带产物资产插件（见下）
  enabled: isWatch, // 全局开关，生产构建时关掉
});
```

**`target` 与自动推断**：缺省看 `public/` 下有 `theme.json` 还是 `plugin.json`。
清单还没创建、或两者并存时，显式传 `target` 更可靠。

然后照常跑：

```bash
vite build --watch
```

产物一变，插件就让思源重载——不用改你的构建配置，也不用学新命令。

> **为什么必须是 `build --watch` 而不是 `vite dev`？**
> 思源从磁盘读 `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存里
> 编译（实测不产生任何磁盘文件）。插件 JS 更严格：思源用
> `window.eval("(function anonymous(require, module, exports){…})")` 执行，
> 需要 CJS 单文件，dev server 给的是 ESM 模块图。所以必须落盘。

### 产物资产（自动带上）

`siyuan()` 默认返回两个插件：热重载 + 产物资产。后者解决两件项目里容易漏的事：

1. **监听 `public/`**。Vite 只在启动时复制 `publicDir`，之后**不再监听**它。
   实测：`build --watch` 下改 `public/theme.json`，构建次数不变，`dev/theme.json`
   仍是旧内容。所以改清单（版本号、`frontends`）不重启就永远不生效。
2. **搬运清单声明的元数据文件**。从 `theme.json` / `plugin.json` 的
   `readme` / `icon` / `preview` 字段推导要复制哪些文件到产物。

有了它，项目里不再需要 `vite-plugin-static-copy` 和手写的 `watch-external`。
要自己接管就传 `assets: false`。

### 2. CLI

不改 vite 配置，或者想换构建器时用：

```bash
siyuan-devtools dev                              # 构建 + 链接 + 热重载
siyuan-devtools dev --build-command "npx sass --watch src:dev"
siyuan-devtools measure tokens --rc-text-primary --attach
siyuan-devtools link --check
```

| 命令      | 作用                                          |
| --------- | --------------------------------------------- |
| `dev`     | 构建 → 链接 → 让思源加载 → 改完自动重载       |
| `link`    | 把构建产物目录链接到思源安装目录（`--check`） |
| `measure` | 在真实前端里量渲染事实、驱动交互              |
| `open`    | 开可见浏览器人工复审（可截图）                |
| `watch`   | 盯着源码目录，改动后重跑你给的命令            |

## 热重载的粒度

主题和插件的加载机制不同，所以重载方式也不同——但**都不刷新页面**，
不会丢掉你正在编辑的文档和打开的面板：

| 产物             | 怎么重载                          | 依据                                 |
| ---------------- | --------------------------------- | ------------------------------------ |
| 主题 `theme.css` | 换 `#themeStyle` 的 href          | `<link>` 加载，换地址即可            |
| 插件 `index.css` | 换 `<style>` 的文本               | 磁盘 CSS 与注入内容逐字节相同        |
| 插件 `index.js`  | kernel 禁用→启用，让思源重新 eval | `window.eval` 带副作用，必须重建实例 |

**不要同时开 `rollup-plugin-livereload`**：它对任何改动整页刷新，会和上面冲突。

## measure 子命令

| 子命令     | 能力                      |
| ---------- | ------------------------- |
| `env`      | 页面环境 + 挂载状态       |
| `tokens`   | 令牌计算值                |
| `styles`   | 元素计算样式              |
| `count`    | 选择器命中数（总数/可见） |
| `box`      | 盒模型尺寸                |
| `probe`    | 插入 HTML 再量            |
| `diff`     | 动作前后差异              |
| `contrast` | 两色对比度                |

通用选项：`--frontend desktop|mobile`、`--viewport 390x844@3`、`--props a,b,c`、
`--do <action>`、`--setup <action>`、`--kind theme|plugin`、`--attach`、`--json`。

### `--attach`：量你眼前那个窗口

```bash
vite build --watch                       # 终端 A：起开发会话
siyuan-devtools measure tokens --attach  # 终端 B：量同一个页面
```

`--attach` 通过本地控制服务找到正在跑的 dev 会话（跨项目也能连）。
**连不上时会静默新开一个无头浏览器**，量到的是另一个页面。读数可疑时，
先跑 `measure env` 看 `mount` 和 `themeStyle`。

### 挂载事实

`--json` 输出带 `mount` 字段：

```json
"mount": { "ok": true, "loaded": "Rem Craft Dev", "reason": null }
```

`mount.ok=false` 表示页面里没有你的主题/插件——此时量到的所有值都是**宿主**的。
这不是工具坏了，是量错了对象。

## 编程方式

```ts
import { createSession, tokens, contrastRatio } from 'vite-plugin-siyuan';

const session = await createSession({ frontend: 'desktop' });
try {
  const values = await tokens(session.page, ['--rc-text-primary', '--rc-bg-page']);
  console.log(contrastRatio(values['--rc-text-primary'], values['--rc-bg-page']));
} finally {
  await session.dispose();
}
```

## 扩展新的被测类型

主题和插件是内置类型。思源还有 widgets、icons 等，它们各有各的清单和加载方式——
这些差异可以**注册**进来，不需要改编排层：

```ts
import { registerTargetType } from 'vite-plugin-siyuan';

registerTargetType(
  'widget',
  {
    manifestName: () => 'widget.json',
    installSubdir: () => 'widgets',
    dirEnv: () => 'SIYUAN_WIDGET_DIR',
    outDir: () => './dev',
    artifact: () => 'index.html',
    expectedFiles: () => ['index.html', 'widget.json'],
    matchArtifact: (name) => name.endsWith('.html'),
    primaryArtifact: (files) => files[0] ?? '',
    reload: async () => ({ ok: true, message: 'widget 已更新' }),
    resolveCss: async () => [],
    mountState: async () => ({ ok: true, loaded: 'widget', reason: null }),
  },
  { detect: (cwd) => existsSync(join(cwd, 'public', 'widget.json')) }
);
```

注册后 `--kind widget` 就能用，`detect` 让它还能被自动推断。
描述符的字段由 TypeScript 接口 `TargetDescriptor` 约束，缺一个编译期就报错。

## 依赖关系

- **运行时依赖**：只有 `puppeteer-core`
- **`vite`**：optional peerDependency。插件形态需要它，CLI 形态不需要；
  走 CLI 且用别的构建器时完全不碰 vite
- 包本身不 import vite 的运行时 API，插件形态只用到类型

## 实测踩过的坑（都已在代码里处理）

| 事实                                               | 影响                                  |
| -------------------------------------------------- | ------------------------------------- |
| `.b3-menu__item` 在菜单打开前根本不存在            | 菜单类测量必须先 `contextmenu`/`dock` |
| JS 派发 `contextmenu` 不触发思源菜单               | 必须真实鼠标右键                      |
| 只有真实指针移动能驱动 `:hover`                    | CSS 注入 / JS 派发无效                |
| `position:fixed` 元素 `offsetParent` 恒为 null     | 不能用它判可见性                      |
| 移动端没有 hover                                   | 交互类测量在移动端无意义              |
| 磁盘 `index.css` 与页面注入的 `<style>` 逐字节相同 | 插件 CSS 读磁盘即可                   |
| 插件目录不能用 junction                            | Go 不认 junction，必须真 symlink      |
| 主题异步挂载，比壳子晚                             | 要轮询 `mountState` 而不是 sleep      |

## 分层

```
会话层  session.ts        测量会话：浏览器生命周期、打开哪个前端、attach 复用
测量层  measure.ts        令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
        actions.ts        交互驱动
        color.ts          对比度计算（纯函数）
        lints.ts          CSS 文本静态检查
        probes.ts         页面探针
目标层  target-types.ts   被测类型的契约与注册表（可扩展）
        targets.ts        内置类型描述符 + createTarget
        workspace.ts      工作区与安装目录解析
        link.ts           产物目录链接到安装目录
        theme.ts          主题身份与挂载判定
        kernel.ts         kernel 调用、主题/插件重载原语
开发层  build.ts          起构建进程（默认 vite，可换），监听产物
        dev-session.ts    链接→激活→浏览器→重载（两种形态共用）
        dev.ts            CLI 形态：自己起构建 + 会话
        plugin.ts         插件形态：挂进宿主 vite 的 writeBundle
        control-server.ts dev 会话的本地控制服务与端点发现
入口层  cli.ts            统一命令，各 *-cli.ts 为独立命令
```

`puppeteer-core` 的**运行时**导入只出现在 `session.ts`、`open.ts`、`dev-session.ts`
三个浏览器所有者里；其余模块只 `import type`，编译后擦除。
