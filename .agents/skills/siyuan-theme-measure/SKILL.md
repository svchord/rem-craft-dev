---
name: siyuan-theme-measure
description: 用 syt 在真实思源前端里读取主题/插件的渲染事实、驱动交互、开发热重载。当需要「某个选择器渲染成什么样」「令牌解析出什么值」「桌面端/移动端尺寸」「交互前后变化」「改完样式对不对」「起一个带热重载的开发环境」时使用。工具只给原语，查什么由你决定。不要为此新写脚本。
---

# 思源主题/插件开发与测量

两件事都在这套工具里：**开发热重载**（`dev`）和**渲染审计**（`measure`）。

工具只提供**事实与原语**，不预设该查什么、什么算对。查哪些令牌、量哪些选择器、
改完是否合格，全部由你根据设计意图判断。

## 前置条件

1. **思源必须在运行**（靠 `port.json` 的 PID→端口映射找 kernel；可用 `SIYUAN_PORT` 覆盖）。
2. 需要 Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）。
3. **不需要**预先构建产物：`measure` 量的是思源当前真实渲染的页面，
   不读磁盘 CSS。`dev` 才会构建。

## 命令

命令名是 `syt`，所有功能都走子命令，没有其它入口。
在父项目里可用 `pnpm dev` / `pnpm measure` / `pnpm shot` 这些别名。

| 用途              | 命令                    |
| ----------------- | ----------------------- |
| 开发：构建+热重载 | `pnpm dev`（Vite 插件） |
| **多项一起量**    | `syt measure audit`     |
| 单项测量          | `syt measure <子命令>`  |
| 视觉复核（截图）  | `syt shot`              |

开发链路（构建、链接、热重载）由 Vite 插件负责，CLI 只做审计与人工复审。
`pnpm dev` 首次会话就绪后会打印桌面端/移动端两个预览链接。
Vite 插件会**自动推断被测类型**（看 `public/` 下有 `theme.json` 还是 `plugin.json`），
不需要写任何配置或脚本。要显式指定用 `--kind theme|plugin`。

### 多项测量：优先用 audit，别连跑 N 个子命令

每个子命令都要起进程、连 CDP、等页面，**每次约 1.2 秒与测量无关的开销**。
实测查 5 项分 5 次调用要 **5.9 秒**，一次 `audit` 只要 **1.16 秒**。

写计划文件（缺省 `./.siyuan-audit.json`，也可 `--config <path>`）：

```json
{
  "setup": ["contextmenu:.b3-list-item"],
  "tokens": ["--rc-text-primary", "--rc-bg-page"],
  "styles": [".b3-menu__item"],
  "counts": [".b3-menu__item"],
  "contrast": [["--rc-text-primary", "--rc-bg-page"]]
}
```

```bash
syt measure audit --attach            # 用计划文件
syt measure audit --attach --json     # 结构化输出
syt measure audit --tokens a,b        # 命令行覆盖文件里的 tokens
```

- 优先级：**命令行 > 配置文件 > 默认值**（同 pa11y）。命令行传了的字段整体替换，不追加。
- `setup` 在全部测量前跑（先 reset）。**菜单项、插件面板在打开前不在 DOM 里**，
  不 setup 会量到「未找到元素」。
- 一次 audit 只开一个会话，结果里各项都在同一个页面状态下。

### dev 的热重载粒度

| 产物             | 怎么重载                          | 页面刷新吗 |
| ---------------- | --------------------------------- | ---------- |
| 主题 `theme.css` | 换 `#themeStyle` 的 href          | 否         |
| 插件 `index.css` | 换 `#pluginsStyle<name>` 的文本   | 否         |
| 插件 `index.js`  | kernel 禁用→启用，让思源重新 eval | 否         |

插件 JS 是 `window.eval` 执行的、带副作用，换样式撤销不了，必须让思源重建实例；
这条走 `/api/petal/setPetalEnabled`，约 0.5s。三条都不会整页刷新，不打断编辑。

**不要同时开 `rollup-plugin-livereload`**：它对任何改动整页刷新，会和上面冲突。
`dev` 检测到会警告。

## measure：通用测量原语

| 子命令     | 能力                      | 例子                                                            |
| ---------- | ------------------------- | --------------------------------------------------------------- |
| `env`      | 页面环境 + 挂载状态       | `syt measure env`                                               |
| `tokens`   | 令牌计算值                | `syt measure tokens --rc-text-primary --rc-bg-page`             |
| `styles`   | 元素计算样式              | `syt measure styles .b3-menu__item --props color,border-radius` |
| `count`    | 选择器命中数（总数/可见） | `syt measure count .b3-menu__item .dock__item`                  |
| `box`      | 盒模型尺寸                | `syt measure box .dock__item --frontend mobile`                 |
| `probe`    | 插入 HTML 再量            | `syt measure probe '<div class="x">' .x`                        |
| `diff`     | 动作前后差异              | 见下                                                            |
| `contrast` | 两色对比度                | `syt measure contrast --rc-text-placeholder --rc-bg-page`       |

通用选项：`--frontend desktop|mobile`、`--viewport 390x844@3`、`--props a,b,c`、
`--do <action>`、`--setup <action>`、`--kind theme|plugin`、`--css <path>`、
`--plugin <name>`、`--attach`、`--json`。`--help` 只打印用法、不执行动作。

### `--attach`：量你眼前那个窗口

```bash
pnpm dev                   # 终端 A：Vite 插件开发会话（持有浏览器）
syt measure tokens --attach  # 终端 B：量同一个页面
```

`--attach` 会连到正在跑的 `dev` 会话（本地控制服务发现，跨项目也能连），**复用同一个页面**，
比每次新开无头浏览器快得多（实测约 0.65s vs 4s）。量之前会先换一次 `#themeStyle` 的 href
把该页面跟磁盘上的 CSS 对齐，所以**读数不依赖热重载是否成功**。

`--attach` 连不上时会静默新开一个无头浏览器，量到的是另一个页面。输出里的
`attached` 字段（人读输出为「读数来源」）会说明到底量了哪个，先看它再判断读数可不可信。
不带 `--attach` 时每次新开页面，同样读磁盘真值，只是慢。

### 挂载事实

`--json` 输出里带 `mount` 字段，文本模式只在未挂载时提醒：

```json
"mount": { "ok": true, "loaded": "Rem Craft Dev", "reason": null }
```

`mount.ok=false` 表示页面里没有你的主题/插件——此时量到的所有值都是**宿主**的，
不是你的。这不是工具坏了，是量错了对象。

### 交互：`--do` / `--setup` / `diff`

`--setup` 先把页面带到目标场景，`--do` 是相对基线要做的动作。

```bash
# 打开右键菜单，再 hover 菜单项，看背景变了什么
syt measure diff .b3-menu__item \
  --setup contextmenu:.b3-list-item --setup wait:600 \
  --do hover:.b3-menu__item --props background-color

# 直接数「菜单打开后」有多少菜单项
syt measure count .b3-menu__item --do contextmenu:.b3-list-item --do wait:600
```

可用动作（`packages/siyuan-devkit/src/core/actions.ts`）：`click` / `hover` / `press` /
`focus` / `type` / `move` / `wait` / `contextmenu` / `dock` / `attr` / `reset`。

## 实测要点（都是踩过的坑）

| 事实                                                | 影响                                                           |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `.b3-menu__item` 在菜单打开前**根本不存在**（0 个） | 菜单类测量必须先 `contextmenu` 或 `dock`                       |
| JS 派发 `contextmenu` **不触发**思源菜单            | 必须真实鼠标右键                                               |
| 真实指针移动是唯一能驱动 `:hover` 的方式            | CSS 注入 / JS 派发都无效                                       |
| 指针位置在会话间持续                                | 采「动作前」状态前工具会先 `move(1,1)`                         |
| `position:fixed` 元素 `offsetParent` 恒为 null      | 不能用它判可见性；思源菜单就是这样（可见但 offsetParent=null） |
| 移动端无 hover                                      | 交互类测量在移动端无意义                                       |
| `data-ui-density` 会被运行时还原（约 1s）           | 密度变体要在设置后立刻量                                       |
| 主题异步挂载，比壳子晚                              | 启动后立刻量可能读到宿主值，稍等或用 `mount` 确认              |

## 典型用法：判断改完是否符合预期

工具不给结论，只给事实。判断由你根据设计意图做。

```bash
# 0) 先确认量的是自己的主题/插件
syt measure env --json          # 看 mount.ok 和 themeStyle

# 1) 令牌有没有断链
syt measure tokens --rc-text-primary --rc-text-placeholder --b3-theme-background

# 2) 对比度够不够（WCAG AA 正文 4.5:1，大字/图形 3:1）
syt measure contrast --rc-text-placeholder --rc-bg-page
#   → 2.42:1  ← 低于 3:1，是否接受按设计意图判断

# 3) 组件算出来的样式
syt measure styles .b3-menu__item --props display,gap,padding-top,color,border-radius

# 4) 交互有没有生效
syt measure diff .b3-menu__item --setup contextmenu:.b3-list-item --setup wait:600 \
  --do hover:.b3-menu__item --props background-color
#   → background-color  rgb(246,246,246) → rgba(0,0,0,0.075)
#     注意：这是 base.css 的值，不是主题声明的 bg-surface —— 说明主题 hover 规则被覆盖了

# 5) 移动端触摸目标
syt measure box .dock__item --frontend mobile --limit 6
```

## 常见误读

| 现象                           | 含义                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `tokens` 全为空                | 宿主跑的不是你的主题（`measure env` 看 mount/themeStyle）。不是工具坏了 |
| `box` 返回空                   | 选择器不适用于该前端（移动端结构不同），不是工具坏了                    |
| `diff` 报「无变化」            | 元素没有该状态的样式声明，或被更高特异性规则覆盖                        |
| `count` 总数>0 但可见=0        | 元素在 DOM 里但被隐藏（display/visibility/opacity）                     |
| 移动端不加载主题               | `theme.json` 缺 `frontends`，或改了没重启内核                           |
| 报 `rgb(var(--b3-*))` 双重包装 | `--b3-*` 已是完整色值，再包 `rgb()` 整条声明会被静默丢弃                |
| 插件改了 JS 但页面没变         | 确认 `dev` 在跑；JS 重载走 kernel，约 0.5s，不是即时                    |

## 使用要点

1. **不要为一次测量新写脚本**。用 `measure` 子命令组合，或 `--json` 读结构化数据。
2. 工具不给「对不对」的结论——它给事实，判断按设计意图做。
3. 没有真实输出就不要声称「样式已生效」，贴命令的真实结果。
4. 改 `theme.json` 后必须重启思源内核，否则移动端判定不生效。
5. 量之前先确认 `mount`——量错对象的结论比没有结论更糟。
