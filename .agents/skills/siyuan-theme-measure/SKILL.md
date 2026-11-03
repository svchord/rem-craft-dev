---
name: siyuan-theme-measure
description: 用 scripts/cdp 的测量工具在真实思源前端里读取主题的渲染结果。当需要确认「某个选择器渲染成什么样」「主题令牌解析出什么值」「思源升级后主题是否还挂得上」，或需要在暗色/hover/变体等特定状态下测量时使用。不要为此新写脚本。
---

# 思源主题测量工具

回答「渲染出来到底是什么样」时用这套工具，**不要新写脚本**。两个命令：`pnpm inspect` 看细节，`pnpm audit:theme` 看整体。

## 前置条件

1. **思源必须在运行**（工具靠 `port.json` 的 PID→端口映射找 kernel；找不到会提示设 `SIYUAN_PORT`）。
2. 需要 Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）。
3. 需要 CSS 产物 `./dev/theme.css` 或 `./dist/theme.css`；缺失时先 `pnpm dev` 或 `pnpm exec vite build`。

## 命令名（别猜）

| 用途           | 命令                        |
| -------------- | --------------------------- |
| 测量单个选择器 | `pnpm inspect '<selector>'` |
| 契约体检       | `pnpm audit:theme`          |

> **不要写 `pnpm audit`**。它是 pnpm 内置的安全审计命令，会盖掉同名脚本，输出 `No known vulnerabilities found` —— 看起来像成功，实际根本没跑本工具。

## pnpm inspect：测量细节

```bash
pnpm inspect '.b3-menu__item'                 # 计算样式
pnpm inspect '.b3-menu__item' --rules         # 命中的 CSS 规则与来源样式表
pnpm inspect '.dock__item' --all              # 每个选择器取 5 个匹配，而非首个
pnpm inspect '.protyle-wysiwyg' --json        # 结构化输出
pnpm inspect '.protyle-wysiwyg' --shot        # 整页截图到 ./inspect.png
pnpm inspect --viewport 1280x764@2 --shot     # 指定视口与 DPR
```

位置参数是选择器，可给多个；不给则测一组缺省节点。

### `--do`：先把页面驱动到目标状态

**暗色、hover、变体、功能开关这些默认状态测不到的东西，必须用 `--do` 进入状态再测。** 这是本工具区别于「直接读 CSS 源码」的关键。

```bash
pnpm inspect --do mode:dark --token --b3-theme-background
pnpm inspect --do style:fluent --token --rc-brand-8
pnpm inspect --do 'hover:.b3-menu__item' --rules
pnpm inspect --do mode:dark,wait:300 '.protyle-wysiwyg'
```

`--do` 可重复；单个 `--do` 内用逗号分隔多个动作。可用动词：

| 动词                                           | 作用                                          |
| ---------------------------------------------- | --------------------------------------------- |
| `style:<name>` / `palette:<name>`              | 切 `data-rc-style` / `data-rc-palette`        |
| `mode:<light\|dark>`                           | 切 `data-theme-mode`                          |
| `density:<compact\|...>`                       | 切 `data-ui-density`                          |
| `feature:<name>:<on\|off>`                     | 切功能开关 `data-rc-<name>`                   |
| `attr:<name>=<value>`                          | 设任意 `<html>` 属性                          |
| `doc:<name>=<value>`                           | 设 `.protyle` 上的文档级属性（`custom-rc-*`） |
| `click:<sel>` / `hover:<sel>` / `move:<x>,<y>` | 指针交互；只有 `hover` 能驱动真实 `:hover`    |
| `wait:<ms>`                                    | 等过渡结束                                    |
| `css:<样式表>`                                 | 临时注入样式，不进产物                        |
| `reset`                                        | 把 `<html>` 还原到会话开始时的属性快照        |

**`css:` 的取值不按逗号拆分**（其余动作仍按逗号分隔），所以样式表里可以放心写 `rgba(0,0,0,.5)` 这类逗号。

### `--token`：读令牌

```bash
pnpm inspect --do mode:dark --token --rc-brand-8 --token --b3-theme-primary
```

- 返回**计算值**，`var()` 链已由浏览器展开；未定义的令牌显示 `(未定义)`（底层是空串）。
- L0 刻度存的是 **"R G B" 三通道**（如 `0 82 217`），不是合法颜色值 —— 这是设计如此，**不要**把它当颜色去断言。它经 L2 桥接后才成为 `rgb(0 82 217)`。

## pnpm audit:theme：契约体检

不做单点测量，只回答「契约整体是否成立」，最后给一行结论。

```bash
pnpm audit:theme                      # 缺省读 ./dev/theme.css，回退 ./dist/theme.css
pnpm audit:theme ./dist/theme.css     # 指定产物
pnpm audit:theme --json               # 结构化输出，CI 用
pnpm audit:theme --attach             # 复用 pnpm dev 的浏览器
pnpm audit:theme --do mode:dark       # 先驱动状态再体检
```

输出包含：环境快照、挂载判定、两轴/变体属性、契约令牌（缺失 / 暗色专属 / 未定义引用 三分类）、桥接令牌、选择器 hit/miss/invalid，末尾 `[audit] 结论：...`。

**典型流程**：思源升级后先跑 `audit:theme` 看结论行；结论指出问题后，再用 `inspect` 下钻到具体选择器。

## `--attach`：在你的可见窗口里测量

`pnpm dev` 会把浏览器 WebSocket 端点写进 `.rc-cdp-ws`，`--attach` 复用它：

```bash
pnpm dev                                    # 终端 A
pnpm inspect --attach '.protyle-wysiwyg'    # 终端 B
```

没有 `.rc-cdp-ws` 时会**静默回退**成新开无头浏览器。看 `opened=attached` 才说明复用成功；`opened=launched` 就是没复用上。`--attach` 的视口是实测的真实窗口尺寸，不受 `--viewport` 影响。

## 常见误读

| 现象                          | 含义                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `--rc-*` 全为空               | 宿主跑的不是本主题（看输出的 `themeStyle` href）。**不是工具坏了** |
| `.b3-menu__item` 未命中       | 菜单没展开，DOM 里没这个节点。用 `--do click:<触发>` 打开后再测    |
| 选择器 miss 但标 `[状态依赖]` | 需要 hover/暗色/属性等状态，默认状态不命中属正常                   |
| 令牌 `(未定义)` 但源码里有    | 主题没挂上，或该令牌只定义在暗色作用域（亮色下为空属正常）         |
| 截图和实际窗口不一致          | 没加 `--attach`，量的是新开的无头视口                              |
| 挂载显示「HMR 注入」          | 说明在 `pnpm dev` 会话里量，令牌来自本主题源码，属正常             |

## 使用要点

1. **`data-ui-density` 会被思源运行时还原**（实测写入后约 1 秒内消失）。密度变体只能用 `pnpm inspect --do density:compact` 现场量，不要指望 audit 的静态快照。
2. 不要为一次测量新写探针脚本 —— 用 `--do` 组合 + `--rules`/`--token` 表达场景。
3. 没有真实输出就不要声称「样式已生效」，贴命令的真实结果。
4. 未挂载就如实报未挂载，不要为了让结果好看而放宽判定或伪造数值。
