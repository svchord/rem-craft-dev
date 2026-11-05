# siyuan-devkit

思源主题/插件开发工具：**Vite 插件**做热重载，**CLI** 提供测量原语。

**只提供能力，不预设该查什么。** 工具不知道你的项目有哪些组件、哪些颜色该配在一起、
什么值算「对」。它负责把页面事实读出来，判断交给调用方（人或 agent）。

## 两种形态

### 1. Vite 插件（推荐）

父项目 `vite.config.ts` 加一行：

```ts
import siyuanPlugin from 'siyuan-devkit/plugin';

export default defineConfig({
  plugins: [
    siyuanPlugin(), // 类型从 public/ 清单自动推断
  ],
});
```

### 选项

```ts
siyuanPlugin({
  target: 'theme', // 'theme' | 'plugin'，缺省从 public/ 清单推断
  entry: 'src/styles/index.css', // 入口；主题给 CSS，插件给 TSX/TS
  outDir: './dev', // 覆盖产物目录；缺省由类型决定（watch→dev，否则→dist）
  browser: false, // 是否打开受控预览窗口（热重载依赖它，见下）
  frontend: 'desktop', // browser:true 时打开 desktop 还是 mobile
  headless: false, // browser:true 时是否无头
  manifestPath: 'config/theme.json', // 清单不在 public/ 时指定；缺省 public/theme.json / plugin.json
});
```

**没有 `enabled` / `isWatch` / `pack` 这类开关。** 开发还是生产由 `build.watch`
判断，打包跟着走：watch 一定不打包、生产一定打包。项目再传一个开关只是重复
同一件事，还多一处可能不一致的输入。

**链接、产物校验、`public/` 资产监听都是固定行为，不做成入参**：
它们不是偏好，关掉只会让热重载或发布静默失效。需要单独组合时可以直接
`import { siyuanAssets, siyuanPost } from 'siyuan-devkit'` 自行拼装。

- 链接：开发会话启动时自动建立到 `<workspace>/data/<subdir>/<name>`
- 校验：两个环境都跑，watch 失败只警告，生产失败中断构建
- 资产：监听 `public/` 并把清单声明的 readme/icon/preview 搬进产物
- 清单路径：缺省 `public/theme.json` / `public/plugin.json`，可用 `manifestPath` 覆盖

**`browser` 是主题热重载的开关。** 主题 CSS 的重载方式是在受浏览器控制的页面里换
`#themeStyle` 的 href；思源没有等价的轻量内核接口（详见「热重载的粒度」）。
所以 `browser: false` 时只重建产物、不热重载，日志会如实写「未热重载」而不是谎报成功。
不打开窗口时仍打印桌面端/移动端预览链接，需要视觉复核可用 `syt shot`。

插件 JS 是例外：它经内核「禁用→启用」广播，**不需要受控页面**，所有前端（含本体）都会更新。
只有**插件 CSS** 必须依赖受控页面，没有窗口时会如实报「未热重载」。

> 文中标注「实测」的结论是 2026-11 在 Vite 8 + 思源桌面端上的一次性观察，
> 随版本升级可能变化；可复跑的验证在 `tests/`，性能数字不进单测。

**`target` 与自动推断**：缺省看 `public/` 下有 `theme.json` 还是 `plugin.json`。
清单还没创建、或两者并存时，显式传 `target` 更可靠；清单不在 `public/` 时，
需要同时传 `target` 与 `manifestPath`。

### entry 统一，产物形态随类型

入口只是「从哪开始构建」，两种类型都传同一个 `entry`：

```ts
siyuanPlugin({ target: 'theme', entry: 'src/styles/index.css' }); // → theme.css
siyuanPlugin({ target: 'plugin', entry: 'src/index.tsx' }); // → index.js (CJS) + index.css
```

差别在产物形态，由类型描述符决定，项目不用管。父项目**不用写**
`build.outDir`、`rollupOptions.input`、`rollupOptions.output`：

|            | 主题                     | 插件                      |
| ---------- | ------------------------ | ------------------------- |
| 产物目录   | `dev/`（watch）/ `dist/` | 同上                      |
| CSS 产物名 | `theme.css`              | `index.css`               |
| JS 产物名  | 无                       | `[name].js`（CJS 单文件） |
| 模块格式   | 不需要                   | `cjs`                     |
| external   | 无                       | `siyuan`、`process`       |

> **为什么不用 `build.lib`？** 实测两个问题：lib 隐含 `cssCodeSplit: false`，
> CSS 入口直接报错（`rolldownOptions.input should not include CSS files`）；
> 且 lib 让插件产出 `index.cjs` 而非 `index.js`，还得再改名。
> 普通 `input` + `output.format: 'cjs'` 反而更直接。

**注入是补缺，不覆盖**（和 `electron-vite`、`@samrum/vite-plugin-web-extension`
的做法一致）：所有字段用 `??=`，项目自己写了就优先用项目的。

这些名字由思源的加载机制定死：主题读 `<theme>/theme.css`，插件读 `index.js` +
`index.css` 并 `window.eval` 执行。**名字写错思源不报错，只是静默加载不到**，
所以不该让每个项目自己写。

仍然归项目的：`rollupOptions.input`、`lib`、`sourcemap`、`target`。
`minify` 默认由插件按 watch 决定（watch 不压缩、生产用默认压缩器），项目自己写了就以项目为准。
`package.zip` 不由项目决定：生产构建固定产出（见「打包」）。

然后照常跑：

```bash
vite build --watch
```

产物一变，插件就让思源重载——不用改你的构建配置，也不用学新命令。
插件开发日志用 `consola` 做级别/颜色/图标，预览入口用 `boxen` 排版；
CLI 命令的输出则保持纯文本。首次会话就绪后会给出桌面端与移动端两个稳定预览链接。

> **watch 需要本地思源在运行**：热重载靠连 kernel + 起浏览器。连不上会**明确报错并让构建失败**，
> 不会静默假成功。纯生产构建（`vite build`）与 `syt verify` 都不需要思源。

> **为什么必须是 `build --watch` 而不是 `vite dev`？**
> 思源从磁盘读 `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存里
> 编译（实测不产生任何磁盘文件）。插件 JS 更严格：思源用
> `window.eval("(function anonymous(require, module, exports){…})")` 执行，
> 需要 CJS 单文件，dev server 给的是 ESM 模块图。所以必须落盘。

### 产物资产（自动带上）

`siyuanPlugin()` 返回三个插件：热重载 + 产物资产 + 收尾（校验与打包）。

**产物资产**解决两件项目里容易漏的事：

1. **监听 `public/`**。Vite 只在启动时复制 `publicDir`，之后**不再监听**它。
   实测：`build --watch` 下改 `public/theme.json`，构建次数不变，`dev/theme.json`
   仍是旧内容。所以改清单（版本号、`frontends`）不重启就永远不生效。
2. **搬运清单声明的元数据文件**。从 `theme.json` / `plugin.json` 的
   `readme` / `icon` / `preview` 字段推导要复制哪些文件到产物。

有了它，项目里不再需要 `vite-plugin-static-copy` 和手写的 `watch-external`。
资产插件固定启用；需要单独组合时可以直接使用导出的 `siyuanAssets`。

### 产物校验（收尾插件，`enforce: 'post'`）

**思源的失败模式是静默的**——这点和 Electron 生态根本不同。Electron 的产物指错
地方会启动崩溃、报错可见；思源则什么都不显示：

| 问题                             | 后果                         |
| -------------------------------- | ---------------------------- |
| 清单缺 `modes` / `minAppVersion` | 主题/插件不出现在列表里      |
| 产物缺 `index.js`                | 插件加载不到，无任何提示     |
| 清单与 `package.json` 版本不一致 | 集市判为旧版，用户收不到更新 |
| 主题 CSS 带 `@layer`             | 被 base.css 压制，样式不生效 |
| `public/i18n` 缺 key             | 界面显示原始 key 或空白      |

这些规则每个思源项目都要写一遍。收进包后由描述符声明「我这个类型独有的是什么」，
通用的部分统一在 `core/verify.ts`。

**两个环境都校验，失败处理不同：**

|      | 开发（`build --watch`）               | 生产（`vite build`）                   |
| ---- | ------------------------------------- | -------------------------------------- |
| 校验 | 跑                                    | 跑                                     |
| 失败 | **警告并继续**（中断会让 watch 退出） | **中断构建**（坏包代价远大于构建失败） |

**CI 不需要特殊处理**：`vite build` 就是生产模式，插件的 `config()` 注入、
产物资产、校验、打包全都会跑。实测：

```
$ pnpm build
[siyuan-devkit] 生产构建：不启动热重载会话；会校验产物并打包。开发请用 `vite build --watch`。
[siyuan-devkit] 产物校验通过
[siyuan-devkit] 已打包：package.zip（4 个文件，6098 字节）
```

> **顺序为什么可靠**：实测 Vite 的 `writeBundle` 按 `enforce` 分三段执行
> （`pre` → 普通 → `post`）。收尾插件是 `post`，所以能看到完整产物，
> 且校验抛错时不会往下走到打包。

### 打包（固定行为，无开关）

打包只由 `build.watch` 决定，且在**校验通过之后**执行：

| 构建                 | 是否打 `package.zip`                           |
| -------------------- | ---------------------------------------------- |
| `vite build --watch` | 否（开发时产物目录正被思源读取，不生成发布包） |
| `vite build`         | **是**（生产构建一定产出包）                   |

产物名固定为 `package.zip`——主题项目、插件项目、思源官方 sample 一致，
是集市的产物约定，所以不像 `theme.css` / `index.js` 那样随类型变化，
也不由项目指定。`.releaserc.json` 只是引用它。

zip 由包自己写（`node:zlib`，零运行时依赖）；`tests/` 里用标准解压读回并
校验每个文件的内容与 CRC。打包失败会让构建失败，不会静默丢掉发布包。

### 2. CLI（面向 agent 自动审计与 CI）

**开发热重载走 Vite 插件**：`vite build --watch`（或项目里的 `pnpm dev`）。
链接与热重载都由插件负责，CLI 不再提供 `syt dev` / `syt link` / `syt watch`，
只保留审计、截图与校验入口：

```bash
syt measure audit                    # 一次会话跑完审计计划
syt measure tokens --rc-text-primary --attach
syt shot                             # 桌面端 / 移动端各截一张图
syt verify
```

| 命令      | 作用                                                            |
| --------- | --------------------------------------------------------------- |
| `measure` | 在真实前端里量渲染事实、驱动交互（agent 审计主力）              |
| `shot`    | 无头截取桌面端/移动端页面，供 agent 视觉复核                    |
| `verify`  | 独立校验清单与产物（不跑构建，可用于 CI / 发布前 / 解包后检查） |

**终端输出**：CLI 命令保持纯文本，不做颜色、图标、边框或表格对齐——CLI 的主要
消费者是 agent，这些排版只是 token 开销。需要结构化数据时用 `--json`，stdout
只包含 JSON。开发日志（Vite 插件）是给人看的，才使用 `consola` / `boxen` 排版。

开发模式（Vite 插件）首次会话就绪后会打印桌面端与移动端两个稳定入口：

```text
开发预览（F5 后仍是当前主题）
桌面端  http://127.0.0.1:6806/stage/build/desktop/
移动端  http://127.0.0.1:6806/stage/build/mobile/
```

## 热重载的粒度

主题和插件的加载机制不同，所以重载方式也不同——但**都不刷新页面**，
不会丢掉你正在编辑的文档和打开的面板：

| 产物             | 怎么重载                          | 作用范围                     |
| ---------------- | --------------------------------- | ---------------------------- |
| 主题 `theme.css` | 换受控页面 `#themeStyle` 的 href  | 那一个页面（需要 `browser`） |
| 插件 `index.js`  | kernel 禁用→启用，让思源重新 eval | **所有已打开的前端，含本体** |
| 插件 `index.css` | 换受控页面 `<style>` 的文本       | 那一个页面（需要 `browser`） |

三条都不整页刷新。**不要同时开 `rollup-plugin-livereload`**：它对任何改动整页刷新，会和上面冲突。

### 实测边界（2026-11，思源桌面端）

想让「用户自己的思源本体窗口」也不刷新地更新主题 CSS，逐条试过的内核路径：

| 手段                              | 对已打开前端的效果                     | 结论       |
| --------------------------------- | -------------------------------------- | ---------- |
| `/api/ui/reloadTheme`             | 无任何效果                             | 不可用     |
| `/api/ui/reloadUI`                | 有效，但**整页刷新**                   | 丢编辑态   |
| 代码片段 `setSnippet`             | 只在页面初始化时注入，已打开页面拿不到 | 不可用     |
| bump `themeVer`                   | 无任何效果                             | 不可用     |
| 切走主题再切回（`setAppearance`） | 有效不刷新，但约 870ms 挂在内置主题上  | **不采用** |

最后一条虽然不刷新页面，但实测会让本体先显示内置 `daylight` 约 870ms：既闪眼，
**这段时间内的测量会读到宿主主题的值而不是本主题**——对以 `measure` 为依据的 agent
审计是致命的。还会在中途改动用户的 appearance 配置。所以主题热重载只保留
「受控页面换 href」这一条干净路径；不开窗口时如实报「未热重载」，本体手动 F5。

另一个可行方向是主题自带 `theme.js`（思源会在每个客户端执行它，并提供
`destroyTheme` 生命周期），由它自己换 href。实测无闪烁、不刷新、约 1s 生效，
但需要 `appearance.themeJS` 打开、且会把一段轮询脚本放进主题产物，故未采用。

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
| `audit`    | 一次会话跑完计划里的全部  |

通用选项：`--frontend desktop|mobile`、`--viewport 390x844@3`、`--props a,b,c`、
`--do <action>`、`--setup <action>`、`--kind theme|plugin`、`--attach`、`--json`。

### `audit`：一次会话跑完，而不是跑 N 次

每个子命令都要起进程、加载 puppeteer、连 CDP、等页面。一次 `audit` 把这些测量
合并进同一个会话，省掉重复的连接与加载开销。下面这组数字是 2026-11 在本机的
一次性观察（不是性能保证，也不进单测）：

查令牌 + 样式 + 命中数 + 盒模型 + 对比度，分成 5 次调用约 **5.9 秒**，
一次 `audit` 约 **1.16 秒**。

计划写在配置文件里（格式对齐 pa11y）：

```json
// .siyuan-audit.json
{
  "frontend": "desktop",
  "setup": ["contextmenu:.b3-list-item"],
  "tokens": ["--rc-text-primary", "--rc-bg-page"],
  "styles": [".b3-menu__item", { "selector": ".x", "props": ["color"] }],
  "counts": [".b3-menu__item", ".dock__item"],
  "boxes": [".dock__item"],
  "contrast": [["--rc-text-primary", "--rc-bg-page"]],
  "diffs": [{ "selector": ".b3-menu__item", "do": ["hover:.b3-menu__item"] }]
}
```

```bash
syt measure audit                    # 自动发现 ./.siyuan-audit.json
syt measure audit --config ./ci.json
syt measure audit --tokens a,b --counts .x   # 命令行覆盖
```

**优先级：命令行参数 > 配置文件 > 内置默认值**（与 pa11y 一致）。
命令行传了的字段整体替换文件里的同名字段——`--tokens a,b` 就是只查这两个，
不是追加。需要更多就把要查的写全。

配置文件也可以是 `.siyuan-audit.js` / `.mjs`（走模块加载，能写表达式）。

`setup` 在全部测量前执行（先 `reset`），用来把页面推到目标场景——
菜单项、插件面板在打开前根本不在 DOM 里，不先 setup 就量不到。

### `--attach`：量你眼前那个窗口

```bash
vite build --watch                       # 终端 A：起开发会话
syt measure tokens --attach  # 终端 B：量同一个页面
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
import { createSession, tokens, contrastRatio } from 'siyuan-devkit';

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
import { registerTargetType } from 'siyuan-devkit';

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

- **运行时依赖**：`puppeteer-core`（浏览器自动化）；Vite 插件开发日志用
  `consola` / `boxen`（CLI 输出不依赖它们）
- **`vite`**：optional peerDependency。插件形态需要它；`startDev()` 程序 API
  默认也用它，但可以换成任意构建命令，CLI 审计命令则完全不碰 vite
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

源码按目录分四层，依赖方向 `core → dev → plugin / cli`；`tests/` 用导入方向做
架构检查，不再另手写一份分层清单：

```
core/    被测对象契约、测量原语与运行时胶水。不依赖 vite、不含 bin、不碰 process.exit。
         measure.ts / page-read.ts / actions.ts / probes.ts        页面读取与交互
         color.ts / lints.ts / theme.ts / semver.ts                纯函数与静态检查
         session.ts / viewport.ts / siyuan.ts / kernel.ts / net.ts 会话、端口与 kernel
         workspace.ts / link.ts / paths.ts                         工作区与目录
         target-types.ts / targets.ts / builtin-targets.ts         类型契约、注册表、内置描述符
         verify.ts / audit.ts / audit-config.ts                    校验与审计
         log.ts / control-server.ts / errors.ts / timing.ts        共享契约与运行支撑
dev/     两种形态共用的开发链路：build.ts / dev-session.ts / dev.ts（startDev 程序 API）
plugin/  Vite 插件形态：plugin.ts / assets.ts / post.ts / state.ts / shared.ts
cli/     唯一入口 cli.ts + 纯导出的子命令处理函数（不自动执行）
```

**共享契约必须落在 `core/`。** 例如日志级别 `LogLevel` 由 `core/log.ts` 定义：
主题、插件、CLI 三条链路都要用它。若把它留在 `dev/dev-session.ts`，`plugin/`
就得反向 import `dev/` 才能拿到类型——那是假解耦，`tests/` 里有断言拦这种情况。

`plugin/` 对 `dev/` 的唯一依赖是 `startDevSession`（会话层是两种形态共用的编排）。
两者是并列形态，谁都不该成为对方的实现依赖：所有「主题 vs 插件」的差异都收敛在
`core/builtin-targets.ts` 的各自描述符里，`dev-session.ts` 里没有任何类型分支。

`puppeteer-core` 的**运行时**导入只出现在 `session.ts`、`shot.ts`、`dev-session.ts`
三个浏览器所有者里；其余模块只 `import type`，编译后擦除。
