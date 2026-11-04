---
name: siyuan-theme-measure
description: 用 scripts/cdp 的通用测量工具，在真实思源前端里读取主题/插件的渲染事实并驱动交互。当需要「某个选择器渲染成什么样」「令牌解析出什么值」「桌面端/移动端尺寸」「交互前后变化」「改完样式对不对」时使用。工具只给原语，查什么由你决定。不要为此新写脚本。
---

# 思源主题/插件测量

回答「渲染出来到底是什么样」时用这套工具，**不要新写脚本**。

工具只提供**测量原语**，不预设该查什么。查哪些令牌、量哪些选择器、什么值算对，
全部由你在命令行上组合。

## 前置条件

1. **思源必须在运行**（靠 `port.json` 的 PID→端口映射找 kernel；找不到会提示设 `SIYUAN_PORT`）。
2. 需要 Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）。
3. 测量主题需产物 `./dev/theme.css`；测量插件读 `<workspace>/data/plugins/<name>/index.css`。

## 命令

| 用途               | 命令                            |
| ------------------ | ------------------------------- |
| 改样式自动热更新   | `pnpm dev`                      |
| 通用测量           | `pnpm measure <子命令>`         |
| 改完重跑你的命令   | `pnpm watch:theme --exec "..."` |
| 人工复审（看页面） | `pnpm open:theme`               |

## pnpm measure：通用测量原语

| 子命令     | 能力                      | 例子                                                                |
| ---------- | ------------------------- | ------------------------------------------------------------------- |
| `env`      | 页面环境                  | `pnpm measure env`                                                  |
| `tokens`   | 令牌计算值                | `pnpm measure tokens --rc-text-primary --rc-bg-page`                |
| `styles`   | 元素计算样式              | `pnpm measure styles .b3-menu__item --props color,background-color` |
| `count`    | 选择器命中数（总数/可见） | `pnpm measure count .b3-menu__item .dock__item`                     |
| `box`      | 盒模型尺寸                | `pnpm measure box .dock__item --frontend mobile`                    |
| `probe`    | 插入 HTML 再量            | `pnpm measure probe '<div class="x">' .x`                           |
| `diff`     | 动作前后差异              | 见下                                                                |
| `contrast` | 两色对比度                | `pnpm measure contrast --rc-text-placeholder --rc-bg-page`          |

通用选项：`--frontend desktop|mobile`、`--viewport 390x844@3`、`--props a,b,c`、
`--do <action>`、`--setup <action>`、`--css <path>`、`--plugin <name>`、`--attach`、`--json`。

### 交互：`--do` / `--setup` / `diff`

`--setup` 先把页面带到目标场景，`--do` 是相对基线要做的动作。

```bash
# 打开右键菜单，再 hover 菜单项，看背景变了什么
pnpm measure diff .b3-menu__item \
  --setup contextmenu:.b3-list-item --setup wait:600 \
  --do hover:.b3-menu__item --props background-color

# 直接数「菜单打开后」有多少菜单项
pnpm measure count .b3-menu__item --do contextmenu:.b3-list-item --do wait:600
```

可用动作（`scripts/cdp/actions.mjs`）：`click` / `hover` / `press` / `focus` / `type` /
`move` / `wait` / `contextmenu` / `dock` / `attr` / `reset`。

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

## 典型用法：判断改完是否符合预期

工具不给结论，只给事实。判断由你根据设计意图做。

```bash
# 1) 令牌有没有断链
pnpm measure tokens --rc-text-primary --rc-text-placeholder --b3-theme-background

# 2) 对比度够不够（WCAG AA 正文要 4.5:1，大字/图形 3:1）
pnpm measure contrast --rc-text-placeholder --rc-bg-page
#   → 2.42:1  ← 低于 3:1，是否接受按设计意图判断

# 3) 组件算出来的样式
pnpm measure styles .b3-menu__item --props display,gap,padding-top,color,border-radius

# 4) 交互有没有生效
pnpm measure diff .b3-menu__item --setup contextmenu:.b3-list-item --setup wait:600 \
  --do hover:.b3-menu__item --props background-color
#   → background-color  rgb(246,246,246) → rgba(0,0,0,0.075)
#     注意：这是 base.css 的值，不是主题声明的 bg-surface —— 说明主题 hover 规则被覆盖了

# 5) 移动端触摸目标
pnpm measure box .dock__item --frontend mobile --limit 6
```

## 常见误读

| 现象                           | 含义                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `tokens` 全为空                | 宿主跑的不是本主题（`measure env` 看 themeStyle）。**不是工具坏了** |
| `box` 返回空                   | 选择器不适用于该前端（移动端结构不同），不是工具坏了                |
| `diff` 报「无变化」            | 元素没有该状态的样式声明，或被更高特异性规则覆盖                    |
| `count` 总数>0 但可见=0        | 元素在 DOM 里但被隐藏（display/visibility/opacity）                 |
| 移动端不加载主题               | `theme.json` 缺 `frontends`，或改了没重启内核                       |
| 报 `rgb(var(--b3-*))` 双重包装 | `--b3-*` 已是完整色值，再包 `rgb()` 整条声明会被静默丢弃            |

## 使用要点

1. **不要为一次测量新写脚本**。用 `measure` 的子命令组合，或 `--json` 读结构化数据。
2. 工具不给「对不对」的结论——它给事实，判断按设计意图做。
3. 没有真实输出就不要声称「样式已生效」，贴命令的真实结果。
4. 改 `theme.json` 后必须重启思源内核，否则移动端判定不生效。
