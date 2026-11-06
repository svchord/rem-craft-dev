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
  auditBrowser: false, // 是否起常驻无头浏览器供 agent 审计复用，缺省关闭
  manifestPath: 'config/theme.json', // 清单不在 public/ 时指定；缺省 public/theme.json / plugin.json
});
```

**没有 `enabled` / `isWatch` / `pack` 这类开关。** 开发还是生产由 `build.watch`
判断，打包跟着走：watch 一定不打包、生产一定打包。项目再传一个开关只是重复
同一件事，还多一处可能不一致的输入。

**主入口 `siyuanPlugin()` 里，链接、产物校验、`public/` 资产监听都是固定行为，
不做成入参**：它们不是偏好，关掉只会让热重载或发布静默失效。

需要单独组合时才用导出的子插件（`siyuanAssets` / `siyuanPost`）或 `startDev()`：
那条路径上保留了 `verify` / `watchPublic` / `link` 等开关，供确实要自定义链路的
场景使用——它们是逃生舱，不是日常配置项。

- 链接：开发会话启动时自动建立到 `<workspace>/data/<subdir>/<name>`
- 校验：两个环境都跑，watch 失败只警告，生产失败中断构建
- 资产：监听 `public/` 并把清单声明的 readme/icon/preview 搬进产物
- 清单路径：缺省 `public/theme.json` / `public/plugin.json`，可用 `manifestPath` 覆盖

### `auditBrowser`：是否给 agent 开一个常驻测量页

**默认 `false`（关闭）**。开一个常驻无头 Chrome（桌面端 / 移动端各一页）内存开销
不小，而且有的项目不希望给大模型留审计入口，所以默认不付这个成本。

- **开着**：dev 会话起两个常驻页 + 本地控制服务 + 读租约屏障；`syt measure --attach`
  复用其中一个，约 0.65s 一次，比每次新开页面（约 4s）快得多。
- **关着**：产物变化仍会广播 `/api/ui/reloadUI` 刷新思源本体窗口（改样式看得到效果），
  只是没有常驻页、也没有 `--attach` 可复用的目标。

`--attach` 连不上时**直接报错给 agent**（非零退出、不带堆栈、说明两条出路：
去掉 `--attach` 新开页面读数，或开 `auditBrowser: true` 后跑 `pnpm dev`）。
不静默降级，否则 agent 会以为量的是常驻页，结论建立在错前提上。

**没有 `browser` / `frontend` / `headless` 入参**：这些和「两个前端各一页、固定
无头、由 `auditBrowser` 统一控制」冲突。CLI 侧 `--frontend` 保留，含义是
「从两个常驻页里选哪个」。

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

> **watch 需要本地思源在运行**：热重载靠连 kernel 广播整页刷新。`SIYUAN_PORT` 显式
> 指定时也会真实探测端口，思源没起就**明确报错并让每次重建都打红**，不会静默假成功
> 也不会给必然 404 的预览链接；用户后来启动思源，下一次重建会自动重试并显示就绪日志。
> 常驻测量页由可选的 `auditBrowser` 控制，默认不起浏览器。
> 纯生产构建（`vite build`）与 `syt verify` 都不需要思源。

> **目录校验**：产物目录（`outDir`）不存在、或安装父目录 `<workspace>/data` 不存在
> 时会当场报错，不会递归造空目录再报「已链接」——那会让思源静默加载不到。
> `SIYUAN_THEME_DIR` / `SIYUAN_PLUGIN_DIR` 指向的目录也会校验存在。
> 插件安装目录必须是真正的符号链接；已是 junction 时会明确拒绝（思源 Go 运行时
> 按 ModeSymlink 判定，junction 会让插件静默加载不到）。

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
消费者是 agent，这些排版只是 token 开销。需要结构化数据时用 `--json`（**仅
`measure` 与 `measure audit` 支持**，`shot` / `verify` 没有 JSON 输出）：此时
stdout 只有 JSON；失败时错误走 stderr、stdout 为空。开发日志（Vite 插件）是给人
看的，才使用 `consola` / `boxen` 排版。

开发模式（Vite 插件）启动后会打印会话状态和桌面端 / 移动端两个稳定入口：

```text
类型：theme
已链接到思源 D:\Document\siyuan\data\themes\Rem Craft Dev
思源已选中：Rem Craft Dev
未开启常驻测量页，--attach 不可用
会话就绪，改源码会自动刷新页面

开发预览
桌面端  http://127.0.0.1:6806/stage/build/desktop/
移动端  http://127.0.0.1:6806/stage/build/mobile/
```

日志只保留能行动的信息：装到哪、思源有没有用上、`--attach` 能不能用、改源码会怎样；
不带配置项名、内部术语或解释性括号。

## 热重载：统一整页刷新

产物一变，dev 会话广播 `/api/ui/reloadUI`，**所有前端一起刷新**（思源本体 +
开启 `auditBrowser` 时的两个常驻测量页）。思源重走启动流程，主题 CSS、插件 CSS、
插件 JS 一并拿到磁盘真值，交互态也天然清空。不再按类型写外科式分支，测量侧也不做
任何 DOM 补丁。`auditBrowser: false`（默认）时仍刷新本体窗口，只是没有常驻页要等。

**首次运行也会自动启用**：建链接、让思源选中主题或启用插件之后，宿主前端还不知道
新对象。会话启动时会额外广播一次刷新，所以第一次 `pnpm dev` 就能直接看到主题/插件
生效，不需要手动 F5。只有「首次建链接」或「主题被切走后切回」这类真正改变了宿主
状态时才广播，重复启动 dev 不会多刷一次。

| 产物             | 刷新后谁负责更新           |
| ---------------- | -------------------------- |
| 主题 `theme.css` | 思源重新加载 `<link>`      |
| 插件 `index.css` | 思源重新注入内联 `<style>` |
| 插件 `index.js`  | 思源重新 `eval` 并重建实例 |

三条实测都随刷新生效（插件 JS 用磁盘标记验证过 V1→V2 重新执行）。

**代价（明确接受）**：整页刷新会丢光标/滚动/打开面板/撤销栈，人工摆好的交互场景
会被冲掉。测量侧靠「每次 `--setup` 重建场景」应对；这正是工具既有的工作方式。
刷新是全局广播、无法定向（实测 `{app:...}` 无效），所以本体窗口也会一起刷。

**读租约**（仅 `auditBrowser: true` 时存在）：dev 刷新前把控制服务 `ready` 置 false，
等所有在读数的人释放租约才广播刷新；常驻页重新挂载后再置 true。`measure --attach`
必须先拿到读租约才读数，读完释放。只检查一个 `ready` 标志有竞态——检查完、读数前
才开始的刷新挡不住，租约才行。租约超时（崩溃进程没释放）会照常刷新并日志警告，不会死等。

### 为什么不用其它路径（2026-11 实测）

| 手段                              | 对已打开前端的效果                     | 结论   |
| --------------------------------- | -------------------------------------- | ------ |
| `/api/ui/reloadTheme`             | 无任何效果                             | 不可用 |
| 代码片段 `setSnippet`             | 只在页面初始化时注入，已打开页面拿不到 | 不可用 |
| bump `themeVer`                   | 无任何效果                             | 不可用 |
| 切走主题再切回（`setAppearance`） | 有效不刷新，但约 870ms 挂在内置主题上  | 不采用 |
| 主题自带 `theme.js`               | 无闪烁不刷新、约 1s 生效               | 不采用 |
| 换 href / 覆盖内联 `<style>`      | 只动一个页面，测插件 CSS 会读到旧值    | 不采用 |

「切走再切回」既闪眼又会让那 870ms 内的测量读到宿主值，还改动用户 appearance 配置；
`theme.js` 需要 `appearance.themeJS` 开关且把轮询脚本放进主题产物。统一刷新把这些
分支全部收掉，代价只是明确接受的一次整页刷新。

**不要同时开 `rollup-plugin-livereload`**：它也整页刷新，会和 dev 会话重复触发。

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

`--frontend` 选的是「dev 会话的两个常驻页里量哪个」——桌面端和移动端是两个独立
构建，DOM、视口、DPR 都不同，必须显式指定。`--viewport` 只在**不带** `--attach` 时
生效：常驻页视口建页时就定死了，复用时传 `--viewport` 会直接报错而不是静默忽略。

### 读数出处与正确性

`measure` 不带 `--attach` 时新开无头页面，从磁盘重新加载 CSS，读到的永远是当前产物。
带 `--attach` 时**必须**有 dev 会话的常驻页（需 `auditBrowser: true`），连不上就直接报错，
不会静默降级。复用时约 0.65s，新开约 4s；先拿读租约再读数。常驻页由 dev 会话统一整页
刷新保持最新，测量侧不改页面 DOM，所以读数不依赖「热重载是否恰好跑成功」这类隐藏状态。

输出里的 `attached` 字段（人读输出为「读数来源」）说明量了哪个页面：`true` 是 dev
常驻页，`false` 是不带 `--attach` 时新开的页面。不说明出处的话，无法判断读数来自
哪个页面，agent 的审计结论就可能建立在错误前提上。

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

配置文件也可以是 `.siyuan-audit.js`（走模块加载，能写表达式）。自动发现依次尝试
`.siyuan-audit.json` / `.siyuan-audit.ts` / `.siyuan-audit.js`；`--config` 显式指定时
支持任意后缀（`.mjs` 也行）。注意 `.ts` 依赖运行时原生类型剥离：Node ≥ 22.18 可直接
加载，Node 20.x 会报 `ERR_UNKNOWN_FILE_EXTENSION`，那时请用 `.js`。

`setup` 在全部测量前执行（先 `reset`），用来把页面推到目标场景——
菜单项、插件面板在打开前根本不在 DOM 里，不先 setup 就量不到。

### `--attach`：复用 dev 会话的常驻页

```bash
pnpm dev   # 需 siyuanPlugin({ auditBrowser: true })，起两个常驻无头页
syt measure tokens --attach  # 复用其中一个
```

`--attach` 通过本地控制服务找到正在跑的 dev 会话（跨项目也能连）。
**连不上就报错**，说明原因和两条出路（去掉 `--attach` 新开页面，或开
`auditBrowser: true` 后跑 `pnpm dev`），不静默降级。默认 `auditBrowser: false`
时没有常驻页，`--attach` 会明确失败。

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
         guards.ts / log.ts / control-server.ts / errors.ts / timing.ts  共享契约与运行支撑
dev/     两种形态共用的开发链路：build.ts / dev-session.ts / dev.ts（startDev 程序 API）
plugin/  Vite 插件形态：plugin.ts / assets.ts / post.ts / state.ts / shared.ts
cli/     唯一入口 cli.ts + 纯导出的子命令处理函数（不自动执行）：
         cli.ts / cli-args.ts / ui.ts / targets.ts / measure-cli.ts / audit.ts / shot.ts / verify-cli.ts
```

> 注意 `cli/` 与 `core/` 有两对同名文件：`audit.ts` 与 `targets.ts`。它们是不同层
> 的不同职责（`core/audit.ts` 是计划执行与校验，`cli/audit.ts` 是命令编排与输出；
> `core/targets.ts` 是 `createTarget` 工厂，`cli/targets.ts` 是「参数 → Target」适配）。
> 看文件时按目录区分，不要当成重复实现。

**共享契约必须落在 `core/`。** 例如日志级别 `LogLevel` 由 `core/log.ts` 定义：
主题、插件、CLI 三条链路都要用它。若把它留在 `dev/dev-session.ts`，`plugin/`
就得反向 import `dev/` 才能拿到类型——那是假解耦，`tests/` 里有断言拦这种情况。

`plugin/` 对 `dev/` 的唯一依赖是 `startDevSession`（会话层是两种形态共用的编排）。
两者是并列形态，谁都不该成为对方的实现依赖：所有「主题 vs 插件」的差异都收敛在
`core/builtin-targets.ts` 的各自描述符里，`dev-session.ts` 里没有任何类型分支。

`puppeteer-core` 的**运行时**导入只出现在 `session.ts`、`shot.ts`、`dev-session.ts`
三个浏览器所有者里；其余模块只 `import type`，编译后擦除。
