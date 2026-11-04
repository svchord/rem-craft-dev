# siyuan-devtools

思源主题/插件开发与审计工具：在真实前端里测量渲染事实、驱动交互、构建链接热重载。

**只提供能力，不预设该查什么。** 工具不知道你的项目有哪些组件、哪些颜色该配在一起、
什么值算「对」。它负责把页面事实读出来，判断交给调用方（人或 agent）。

## 为什么独立成包

它不依赖任何具体主题/插件，也**不依赖任何具体构建工具**：

- 被测类型靠 `public/` 下的清单自动推断（`theme.json` → 主题，`plugin.json` → 插件）
- 构建默认用 `vite build --watch`，但可以用 `--build-command` 换成任何命令
- `vite` 与 `vitest` 都不是本包的依赖——它们属于引用项目自己

复制到别的思源项目里可以直接用，不需要在那边写任何脚本。

## 安装

```bash
pnpm add -D siyuan-devtools
```

前置条件：

1. 思源正在运行（靠 `port.json` 的 PID→端口映射找 kernel，可用 `SIYUAN_PORT` 覆盖）
2. Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）

## 命令行（推荐）

一条命令，类型自动推断，**不用在引用项目里写 scripts**：

```bash
siyuan-devtools dev                  # 构建 + 链接 + 热重载
siyuan-devtools dev --kind plugin    # 显式指定类型
siyuan-devtools dev --build-command "npx sass --watch src:dev"
siyuan-devtools measure tokens --rc-brand-8 --attach
siyuan-devtools link --check
```

| 命令      | 作用                                          |
| --------- | --------------------------------------------- |
| `dev`     | 构建 → 链接 → 让思源加载 → 改完自动重载       |
| `link`    | 把构建产物目录链接到思源安装目录（`--check`） |
| `measure` | 在真实前端里量渲染事实、驱动交互              |
| `open`    | 开可见浏览器人工复审（可截图）                |
| `watch`   | 盯着源码目录，改动后重跑你给的命令            |

也提供等价的独立命令：`siyuan-dev` / `siyuan-link` / `siyuan-measure` / `siyuan-open` / `siyuan-watch`。

### dev 做了什么

```
1. 起构建进程（默认 vite build --watch）      等首个产物出现
2. 产物目录 → <workspace>/data/<themes|plugins>/<name>   链接（symlink/junction）
3. 让思源用上它（主题：切 themeLight/themeDark；插件：启用状态由思源管）
4. 开浏览器并登记 CDP 端点                    供 measure / open 复用
5. 监听产物，按类型精确重载
```

热重载粒度按产物类型区分，比整页刷新精细：

| 产物             | 重载方式                      | 页面是否刷新 |
| ---------------- | ----------------------------- | ------------ |
| 主题 `theme.css` | 换 `#themeStyle` 的 href      | 否           |
| 插件 `index.css` | 换 `#pluginsStyle<name>` 文本 | 否           |
| 插件 `index.js`  | 整页 reload                   | 是           |

**不要同时用 `rollup-plugin-livereload`**：它对任何变化都整页刷新，会把正在编辑的
文档和打开的面板全部重置。检测到项目里还在用会给出警告。

### measure 子命令

| 子命令                         | 能力                                       |
| ------------------------------ | ------------------------------------------ |
| `env`                          | 页面环境（前端/后端/模式/视口/DOM 节点数） |
| `tokens <name...>`             | 令牌计算值                                 |
| `styles <selector> [--props]`  | 元素计算样式                               |
| `count <selector...>`          | 选择器命中数（总数/可见）                  |
| `box <selector>`               | 盒模型尺寸                                 |
| `probe <html> <target>`        | 插入 HTML 再量                             |
| `diff <selector> --setup/--do` | 动作前后差异                               |
| `contrast <fg> <bg>`           | 两色对比度                                 |

通用选项：`--kind`、`--frontend desktop|mobile`、`--viewport 390x844@3`、
`--props a,b,c`、`--do <action>`、`--setup <action>`、`--css <path>`、
`--plugin <name>`、`--attach`、`--json`

```bash
siyuan-devtools measure tokens --rc-text-primary --rc-bg-page
siyuan-devtools measure contrast --rc-text-placeholder --rc-bg-page     # → 2.42:1
siyuan-devtools measure count .b3-menu__item --do contextmenu:.b3-list-item --do wait:600
siyuan-devtools measure box .dock__item --frontend mobile
siyuan-devtools measure diff .b3-menu__item --setup contextmenu:.b3-list-item \
  --setup wait:600 --do hover:.b3-menu__item --props background-color
```

## 编程方式

```js
import { createSession, tokens, elementStyles, contrastRatio } from 'siyuan-devtools';

const session = await createSession({ frontend: 'desktop' });
try {
  const values = await tokens(session.page, ['--rc-text-primary', '--rc-bg-page']);
  console.log(contrastRatio(values['--rc-text-primary'], values['--rc-bg-page']));

  const styles = await elementStyles(session.page, '.b3-menu__item', ['display', 'gap']);
  console.log(styles.styles);
} finally {
  await session.dispose();
}
```

## 扩展新的被测类型

主题和插件是内置类型。思源的安装目录还有 widgets、icons 等，它们各有各的清单和
加载方式——这些差异可以**注册**进来，不需要改 `dev.mjs` 或 CLI：

```js
import { registerTargetType, detectTargetType } from 'siyuan-devtools';

registerTargetType(
  'widget',
  {
    manifestName: () => 'widget.json', // public/ 下的清单
    installSubdir: () => 'widgets', // data/ 下的子目录
    dirEnv: () => 'SIYUAN_WIDGET_DIR', // 覆盖安装目录的环境变量
    outDir: () => './dev',
    artifact: () => 'index.html', // 等它出现即视为构建就绪
    expectedFiles: () => ['index.html', 'widget.json'],
    matchArtifact: (name) => name.endsWith('.html'),
    reload: async (page) => true,
    resolveCss: async () => [],
    mountState: async () => ({ ok: true, loaded: 'widget', reason: null }),
  },
  { detect: (cwd) => existsSync(join(cwd, 'public', 'widget.json')) }
);
```

注册后 `siyuan-devtools dev --kind widget` 就能用，`detect` 让它还能被自动推断。
缺任何一个必需能力，注册时就会报错并列出缺哪几个。

类型描述符必须提供：`manifestName` / `installSubdir` / `dirEnv` / `outDir` /
`artifact` / `expectedFiles` / `matchArtifact` / `reload` / `resolveCss` / `mountState`。

可选：`requiresSelection`（开发前是否必须经 kernel API 让思源选中，主题需要）、
`activate(page, ctx)`（面板类目标让元素出现在页面上）。

## 动作（`--do` / `--setup`）

| 动作                                                          | 作用                              |
| ------------------------------------------------------------- | --------------------------------- |
| `click:<sel>` / `hover:<sel>` / `press:<sel>` / `focus:<sel>` | 真实指针交互                      |
| `move:<x>,<y>`                                                | 移动指针                          |
| `type:<sel>:<text>`                                           | 输入                              |
| `wait:<ms>`                                                   | 等过渡/异步                       |
| `contextmenu:<sel>`                                           | 真实右键（JS 派发不触发思源菜单） |
| `dock:<type>`                                                 | 点停靠栏按钮                      |
| `attr:<name>=<value>`                                         | 设 `<html>` 属性（暗色/密度变体） |
| `reset`                                                       | 还原 `<html>` 属性到会话初始快照  |

## 实测踩过的坑（都已在代码里处理）

| 事实                                               | 影响                                  |
| -------------------------------------------------- | ------------------------------------- |
| `.b3-menu__item` 在菜单打开前根本不存在            | 菜单类测量必须先 `contextmenu`/`dock` |
| JS 派发 `contextmenu` 不触发思源菜单               | 必须真实鼠标右键                      |
| 只有真实指针移动能驱动 `:hover`                    | CSS 注入 / JS 派发无效                |
| 指针位置在会话间持续                               | 采「动作前」状态前必须先 `move(1,1)`  |
| `position:fixed` 元素 `offsetParent` 恒为 null     | 不能用它判可见性                      |
| 移动端没有 hover                                   | 交互类测量在移动端无意义              |
| `data-ui-density` 会被运行时还原（约 1s）          | 密度变体要立刻量                      |
| 磁盘 `index.css` 与页面注入的 `<style>` 逐字节相同 | 插件 CSS 读磁盘即可                   |
| 内核没有 `/api/plugin/*` 写接口                    | 插件重载只能重注入 CSS 或整页刷新     |
| 插件目录不能用 junction                            | Go 不认 junction，必须真 symlink      |

## 分层

```
会话层  session.mjs        浏览器生命周期、打开哪个前端、attach 复用
测量层  measure.mjs        令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
        actions.mjs        交互驱动
        color.mjs          对比度计算（纯函数）
        lints.mjs          CSS 文本静态检查
目标层  target-types.mjs   被测类型的契约与注册表（可扩展）
        targets.mjs        内置类型描述符 + createTarget
        workspace.mjs      工作区与安装目录解析
        link.mjs           产物目录链接到安装目录
        theme.mjs          主题身份与挂载判定
        theme-dev.mjs      切换主题、重载主题/插件 CSS
开发层  build.mjs          起构建进程（默认 vite，可换），监听产物
        dev.mjs            构建→链接→加载→热重载的完整循环
        cdp-registry.mjs   dev 浏览器端点登记（机器级，跨项目复用）
入口层  cli.mjs            统一命令，各 *-cli.mjs 为独立命令
```

`puppeteer-core` 只出现在 `session.mjs`、`open.mjs`、`dev.mjs` 三个浏览器所有者里，
其余模块纯数据、可单测。
