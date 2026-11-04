# siyuan-devtools

在真实思源前端里测量渲染事实、驱动交互、人工复审。适用于主题和插件开发。

**只提供能力，不预设该查什么。** 工具不知道你的项目有哪些组件、哪些颜色该配在一起、
什么值算「对」。它负责把页面事实读出来，判断交给调用方（人或 agent）。

## 为什么独立成包

它不依赖任何具体主题/插件——`readThemeName` 从 `public/theme.json` 读，
`themeTarget` 的 CSS 路径可配置，插件目录从 `workspace.json` 推导。
复制到别的思源主题/插件项目里可以直接用。

## 安装

```bash
pnpm add -D siyuan-devtools puppeteer-core
```

前置条件：

1. 思源正在运行（靠 `port.json` 的 PID→端口映射找 kernel，可用 `SIYUAN_PORT` 覆盖）
2. Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）

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

### 主题开发（`theme-dev`）

自己写 `pnpm dev` 这类热更新脚本时需要两个通用能力：

```js
import { findKernelPort, readThemeName, selectTheme, reloadThemeCss } from 'siyuan-devtools';

const port = await findKernelPort();
const themeName = readThemeName(); // 从 public/theme.json 读

// 1) 让思源真正选中本主题（否则预览的是宿主主题）
const result = await selectTheme(port, themeName);
// → { ok, changed, reason }；changed=false 表示本来就是它

// 2) 产物变了之后，让页面重新加载 theme.css
await reloadThemeCss(page); // 换 #themeStyle 的 href 并加时间戳
```

`selectTheme` 只动思源的 `themeLight`/`themeDark`，`reloadThemeCss` 只动
`#themeStyle` 那一个 link——不碰其它样式表，级联位置不变。

还提供 `callKernel(port, path, body)` 调任意 kernel API，`currentTheme(port)` 读当前选中的主题。

## CLI

### siyuan-measure：通用测量

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

通用选项：`--frontend desktop|mobile`、`--viewport 390x844@3`、`--props a,b,c`、
`--do <action>`、`--setup <action>`、`--css <path>`、`--plugin <name>`、`--attach`、`--json`

```bash
siyuan-measure tokens --rc-text-primary --rc-bg-page
siyuan-measure contrast --rc-text-placeholder --rc-bg-page     # → 2.42:1
siyuan-measure count .b3-menu__item --do contextmenu:.b3-list-item --do wait:600
siyuan-measure box .dock__item --frontend mobile
siyuan-measure diff .b3-menu__item --setup contextmenu:.b3-list-item \
  --setup wait:600 --do hover:.b3-menu__item --props background-color
```

### siyuan-open：人工复审

打开桌面 + 移动端页面，可交互、可截图。

```bash
siyuan-open                       # 桌面 + 移动端
siyuan-open --frontend mobile
siyuan-open --state dark          # 打开即进暗色
siyuan-open --shot                # 截图到 ./shots/（自动无头）
siyuan-open --attach              # 复用 pnpm dev 的浏览器
```

### siyuan-watch：改完重跑

```bash
siyuan-watch --dir src/styles --exec "siyuan-measure styles .b3-menu__item"
siyuan-watch --once --exec "siyuan-measure env"
```

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

## 分层

```
会话层  session.mjs   浏览器生命周期、打开哪个前端、attach 复用
        theme-dev.mjs 主题开发：让思源选中主题、重载 theme.css
测量层  measure.mjs   令牌 / 计算样式 / 命中数 / 盒模型 / 动作前后差异
        actions.mjs   交互驱动
        targets.mjs   被测对象适配（主题 / 插件）
        color.mjs     对比度计算（纯函数）
        lints.mjs     CSS 文本静态检查
入口层  measure-cli.mjs / open.mjs / watch.mjs
```

`puppeteer-core` 只出现在 `session.mjs` 和 `open.mjs`，其余模块纯数据、可单测。
