---
name: siyuan-theme-measure
description: 用 scripts/cdp 的工具改主题样式并验证真实渲染。当需要「改完样式看效果」「判断渲染是否符合预期」「在桌面端或移动端审计实际渲染」「人工打开页面看效果」时使用。不要为此新写脚本。
---

# 思源主题测量工具

回答「渲染出来到底是什么样」时用这套工具，**不要新写脚本**。四个命令覆盖三件事加一个人工入口：

| 用途                 | 命令                |
| -------------------- | ------------------- |
| 改样式自动热更新     | `pnpm dev`          |
| 渲染回归（自动审计） | `pnpm verify:theme` |
| 改完自动回归         | `pnpm watch:theme`  |
| 人工审计（看页面）   | `pnpm open:theme`   |

## 前置条件

1. **思源必须在运行**（工具靠 `port.json` 的 PID→端口映射找 kernel；找不到会提示设 `SIYUAN_PORT`）。
2. 需要 Chrome 或 Edge（自动按候选路径查找，可用 `CHROME_PATH` 覆盖）。
3. 需要 CSS 产物 `./dev/theme.css` 或 `./dist/theme.css`；缺失时先 `pnpm dev` 或 `pnpm exec vite build`。
4. **移动端用例要求 `theme.json` 有 `frontends` 字段**（见下）。

## 日常闭环（改样式时用这个）

```bash
# 终端 A：构建 watch + 可见浏览器 + 让思源重载主题（改完立刻变，F5 后仍生效）
pnpm dev

# 终端 B：监听 src/styles/**，改动后自动跑桌面 + 移动端渲染回归
pnpm watch:theme
```

改 `src/styles/**` → A 里页面自动更新 → B 里自动打印 `✓` 或具体哪项不符（期望 vs 实际），
并按 `[desktop]` / `[mobile]` 标注前端。不符项直接给出令牌名/选择器名，照着改即可。

## pnpm open:theme：人工审计

自动回归回答「数值对不对」，但间距协调、暗色对比度、移动端触摸目标挤不挤只有眼睛能判断。

```bash
pnpm open:theme                 # 桌面 + 移动端两个标签页，可直接交互
pnpm open:theme --frontend mobile
pnpm open:theme --shot          # 各截一张图到 ./shots/
pnpm open:theme --dev           # 同时起 pnpm dev，改样式即时生效
```

窗口是可见的：点开菜单、切暗色、缩窗口都是真实渲染。Ctrl+C 结束。

## 移动端

桌面与移动是**两个独立构建入口**（`/stage/build/desktop/` 与 `/stage/build/mobile/`），
`verify:theme` 按用例的 `frontend` 字段分组，移动端用 390x844@3 视口。

**`theme.json` 必须有 `frontends` 字段，否则移动端永远不加载本主题。** 思源的判定是
「`frontends` 含 `all` 或含当前 frontend（`browser-mobile`）」，没有该字段时判定为 false，
而桌面端不受影响——所以这个坑很容易漏。写 `["all"]` 最省事。

> 改 `theme.json` 后**必须重启思源内核**：清单只在启动时索引，内核不会热重载它。
> 验证：`lightThemes` 里该主题的条目应带上 `frontends: ["all"]`。

移动端变体靠 `<html data-backend="ios|android|harmony">` 生效，用例里用 `attributes` 表达。

## pnpm verify:theme：渲染回归

把「主题此刻真实渲染成什么样」与基线 `expectations.json` 逐项比对，不符时**退出码 1**，CI 可直接卡门禁。

```bash
pnpm verify:theme                     # 桌面 + 移动端，跑全部用例
pnpm verify:theme --frontend mobile   # 只跑移动端
pnpm verify:theme --attach            # 桌面复用 pnpm dev 的浏览器（移动端仍单独启动）
pnpm verify:theme --filter menu       # 只跑名字含 menu 的用例
pnpm verify:theme --json              # 结构化输出
pnpm verify:theme --update            # 把通过用例的实际值写回基线
pnpm verify:theme --baseline          # 把当前渲染整体写成新基线（谨慎：会掩盖回归）
```

基线用例字段：

| 字段         | 说明                                                                |
| ------------ | ------------------------------------------------------------------- |
| `name`       | 必填                                                                |
| `frontend`   | `desktop`（缺省）/ `mobile`；移动端用例必须写 `viewport`            |
| `viewport`   | `390x844@3` 这种手机视口；移动端不继承文件级的桌面视口              |
| `attributes` | 设 `<html>` 属性，变体靠它生效（`data-theme-mode`、`data-backend`） |
| `actions`    | 交互动作，如 `["contextmenu:.b3-list-item", "wait:600"]`            |
| `tokens`     | 令牌期望值                                                          |
| `selectors`  | `mustHit` / `mustMiss`                                              |
| `probes`     | `{ label, html, target, expect }`；`html` 是插进页面的探针标记      |

期望值可写精确串、`null`（必须为空）或 `re:` 正则。

**关键：verify 在真实页面上量，不是 iframe。** 探针插进主文档（视口外），拿到与生产一致的级联：`base.css` + 本主题 + 插件样式 + 运行时样式。变体用 `attributes` 驱动 `<html>` 属性，测完 reset。

早先用 iframe 隔离是为了挡宿主主题，但 `pnpm dev` 已让思源真正选中本主题，隔离前提消失；而 iframe 会漏掉 `base.css`——实测 `line-height` 在 iframe 里是 `normal`、真实页面是 `28px`。

### 交互审计

只量初始页面测不到交互态，而交互恰恰最容易坏（选择器还在但 DOM 结构变了，静态断言照样绿）。用 `actions` 驱动：

```json
{
  "name": "交互：右键菜单打开后菜单项样式生效",
  "actions": ["contextmenu:.b3-list-item", "wait:600"],
  "probes": [{ "label": "menu-item", "target": ".b3-menu__item", "expect": { "display": "flex" } }]
}
```

可用动作：`click` / `hover` / `press` / `focus` / `type` / `move` / `wait` / `contextmenu` / `dock` / `attr` / `reset`。

实测要点：`.b3-menu__item` 在菜单打开前**根本不存在**；JS 派发 `contextmenu` **不触发**思源菜单，必须真实鼠标右键；真实指针移动是唯一能驱动 `:hover` 的方式。

## pnpm dev：热更新

三步：`vite build --watch` 产出 `dev/theme.css` → 经 kernel API 把 `themeLight`/`themeDark` 切成 `Rem Craft Dev`（已是它则不动）→ 重建后换 `#themeStyle` 的 href 让思源重新加载。

**让思源真正选中本主题，而不是在页面上打补丁。** 注入 `<style>` 只能模拟「本主题叠在宿主之上」，真实级联里本主题是**替代**宿主主题，两者在 `--b3-*` 上结果不同：注入方式下 `--b3-theme-background` 读到宿主的 `#feffff`，切主题后才是本主题的 `rgb(246 246 246)`。

因为主题状态在思源配置里，**F5 后仍是本主题**，不依赖任何注入的存活。

前置：`pnpm make-link` 已把 `dev/` junction 到 `<workspace>/data/themes/Rem Craft Dev`。

## 常见误读

| 现象                                     | 含义                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `--rc-*` 全为空                          | 宿主跑的不是本主题（看输出的 `themeStyle` href）。**不是工具坏了**   |
| 移动端不加载主题                         | `theme.json` 缺 `frontends`，或改了没重启内核。看 `lightThemes` 条目 |
| 选择器在真实页面未命中                   | 菜单没展开等 UI 状态问题；交互用例要先 `contextmenu`/`dock` 打开     |
| 令牌 `(未定义)` 但源码里有               | 主题没挂上，或该令牌只定义在暗色作用域（亮色下为空属正常）           |
| 截图和实际窗口不一致                     | 没加 `--attach`，量的是新开的无头视口                                |
| verify 报「静态检查 rgb(var(--b3-...))」 | 双重包装：`--b3-*` 已是完整色值，再包 `rgb()` 整条声明失效           |

## 使用要点

1. **`data-ui-density` 会被思源运行时还原**（实测写入后约 1 秒内消失）。密度变体用
   `attributes` 表达，测完靠 `reset` 还原，不要指望它一直留在页面上。
2. 不要为一次测量新写探针脚本 —— 要断言就往 `expectations.json` 加用例；要看效果用
   `pnpm open:theme`。
3. 没有真实输出就不要声称「样式已生效」，贴命令的真实结果。
4. 基线变了要区分「预期内的改动」与「回归」：确认是前者才 `--update`；`--baseline` 会整体
   覆盖，慎用。
5. 改 `theme.json` 后必须重启内核，否则移动端判定不生效。
6. **交互用例要真的覆盖交互**：断言 `.b3-menu__item` 却不先打开菜单，会因元素不存在而
   失败；反过来，断言一个不随状态变化的属性（如 `display`），则可能假通过。
