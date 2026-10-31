# 基于 UnoCSS 的多层主题架构 · 讨论稿（CSS-only 版）

> 状态：**待评审**。硬约束：**主题产物不允许有 `theme.js`，只能交付 `theme.css` + `theme.json`**。
> 其它事实来自实测：思源 3.8.9 的 `base.css` 无任何 `@layer`（144 处 `!important`），主题 CSS 以 `<link id="themeStyle">` 追加在内置主题之后。

---

## 1. 旧架构（已备份到 `src-legacy/`）为什么推倒

| 现状                                                                        | 问题                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| SCSS + `@use` 手写分层（base/common/component/dialog/layout/panel/protyle） | 分层靠目录约定，跨层依赖没有约束，容易反向引用       |
| `style/common/var.scss` 用 Sass map 描述色板，`css-var.scss` 映射 `--b3-*`  | 色板在编译期，无法按皮肤/模式组合                    |
| `theme/{tdesign,semi-design,one-dark}` 三套 palette                         | 皮肤与组件层耦合在同一份 CSS，新增皮肤要重新构建整包 |
| 选择器直接抄思源 DOM，多年累积                                              | 思源升级后大量选择器失效，且没有回归手段             |
| `script/config.js` 的布尔开关是编译期常量                                   | 用户不可调，改开关要重新发版                         |

---

## 2. 约束下的能力边界（必须先接受）

没有 `theme.js`，主题不能在运行时执行任何代码。因此：

| 能力                                 | 能否做到 | 靠什么                                                |
| ------------------------------------ | -------- | ----------------------------------------------------- |
| 亮/暗两套配色                        | 可以     | `html[data-theme-mode]`                               |
| 按平台差异化（桌面/移动、Win/macOS） | 可以     | `data-frontend` / `data-backend`                      |
| 跟随「紧凑模式」                     | 可以     | `data-ui-density="compact"`                           |
| 文档级 / 块级样式开关                | 可以     | 文档、块的自定义属性 `custom-*`（属性面板原生可编辑） |
| 全局自定义开关（如圆角开/关）        | 受限     | 只能由用户片段或插件写属性                            |
| 主题内置「换皮肤」按钮               | 不行     | 只能做成多个主题包                                    |
| 持久化任何设置                       | 不行     | 无 JS、无存储 API                                     |

**结论：架构要围绕思源已有的属性设计，而不是自己发明开关。**

---

## 3. UnoCSS 的角色

思源主题没有自己的 HTML，所以 Tailwind 式「工具类优先」不成立。唯一可行定位：**UnoCSS = 构建期 CSS 生成器**——

- `@apply` 把工具类展开进真实选择器（`.b3-menu__item` 等）；
- `theme` 配置生成设计令牌与 `dark:` 变体；
- 产物是普通 CSS，不引入任何运行时。

「靠 JS 给 DOM 加 class 再用工具类」的方案已被产物约束排除。

---

## 4. 五层架构

```
L0 tokens      --rc-*: 色阶、圆角、间距、字号、阴影      唯一数值来源（含 dark 覆盖）
L1 semantic    --rc-bg-page / --rc-text-primary          语义别名
L2 bridge      --b3-* <- var(--rc-*)                     适配思源内置变量
L3 components  .b3-menu__item { @apply ... }             只读 L1/L2
L4 variants    [data-theme-mode] / [data-ui-density] / [custom-*]
```

规则：

1. L0 是唯一允许出现字面色值的地方；L3/L4 出现 `#hex` 或 `rgb(数字)` 视为违规（测试会拦）。
2. L2 是思源 API 适配层，思源升级只改这里。
3. L3 用 `@apply`，禁止 `@layer`。
4. L4 不新增色值，只做条件包裹。

已落地：`src/styles/l0-tokens.css` … `l4-variants.css`，以及 `tests/css-architecture.test.ts` 的四条守卫（无 `@layer`、token 完整、组件层无字面色、层次顺序正确）。

---

## 5. 多主题 / 皮肤：CSS-only 下的三种方案

| 方案                             | 机制                                                                                     | 优点                                  | 代价                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| 1. 单主题 + 亮暗两套（最小可用） | 只做一套设计，`[data-theme-mode]` 切亮暗                                                 | 最简单、包最小                        | 没有多皮肤概念                                 |
| 2. 多主题包（推荐做多皮肤时）    | 每套皮肤生成一个主题目录（`theme.json.name` 不同），共享同一套组件 CSS，只换 L0/L1 token | 用户仍用思源原生主题列表切换；无需 JS | 构建脚本需支持按皮肤产出多个包；市场多几个条目 |
| 3. 用户片段（JS）                | 用户自己写片段设置 `html[data-rc-skin]`                                                  | 灵活                                  | 不属于主题；普通用户体验差，不作为产品方案     |

**推荐**：默认按方案 1 发布；若要保留 tdesign / one-dark 等皮肤，用方案 2——构建脚本增加 `SKIN=<name>` 参数，输出 `dist/<skin>/`（每个目录独立 theme.json + 同一份 theme.css 的 token 覆盖）。这一层尚未实现，列入 P1 决策。

---

## 6. 区域样式开关：全部基于思源原生属性

| 粒度             | 属性                                                                     | 谁写入       | 例子                                      |
| ---------------- | ------------------------------------------------------------------------ | ------------ | ----------------------------------------- |
| 全局（思源内置） | `data-theme-mode` / `data-ui-density` / `data-frontend` / `data-backend` | 思源设置     | 亮暗、紧凑模式、平台差异                  |
| 文档             | `.protyle[custom-rc-*]`                                                  | 文档属性面板 | `custom-rc-width=wide` 单文档宽屏         |
| 块               | `[custom-rc-*]`                                                          | 块属性面板   | `custom-rc-flat=true` 单个 callout 扁平化 |

```css
/* 文档级：文档属性里加 custom-rc-width=wide */
.protyle[custom-rc-width='wide'] .protyle-wysiwyg {
  max-width: 96ch;
}

/* 块级：块属性里加 custom-rc-flat=true */
[custom-rc-flat='true'] {
  border-radius: 0;
}
```

**产品化建议**：把可用的 `custom-*` 属性做成「自定义属性速查表」写进 README（属性名、取值、效果截图），用户通过思源原生属性面板即可开启——这是 CSS-only 下唯一不依赖外部代码的开关路径。

---

## 7. 文件布局提案

```
src/
├─ styles/
│  ├─ l0-tokens.css      # 唯一数值来源 + [data-theme-mode=dark] 覆盖
│  ├─ l1-semantic.css    # --rc-* 语义
│  ├─ l2-bridge.css      # --b3-* <- --rc-*
│  ├─ l3-components/     # 按界面拆分：menu / dialog / sidebar / protyle ...
│  ├─ l4-variants.css
│  └─ index.css          # L0->L4 顺序 @import
└─ skins/                # 仅方案 2 需要：<skin>/{light,dark}.css（纯 token）
```

---

## 8. 需要你拍板的问题

1. **样式语言**：纯 CSS + 原生嵌套（推荐，已按此落地）还是保留 SCSS？旧 `var.scss` 的色板计算建议迁成构建期脚本。
2. **皮肤策略**：只做「单主题 + 亮暗」（方案 1），还是实现「多主题包」构建（方案 2）？若选 2，保留哪几套皮肤？
3. **旧选择器处置**：按新分层重写，还是先搬再修？建议先产出「思源 3.8.9 选择器失效清单」，用真机页面逐块核对。
4. **`custom-*` 开关清单**：先做哪些文档/块级开关（例如宽屏、callout 扁平、表格紧凑）？这决定 L4 的范围。
5. **一期验收标准**：接受「关键页面像素对比 + `pnpm check` 全绿 + `theme.css` < 150 KB」吗？

---

## 9. 分阶段路线

| 阶段         | 内容                                                                | 产出                                         |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------- |
| P0（已完成） | CSS-only 工程环境、构建/校验/软链、产物契约守卫                     | `pnpm dev/build/check` 可用，产物无 theme.js |
| P1           | 定稿 L0/L1（亮暗两套）、组件层按页面重写（菜单/对话框/侧栏/编辑器） | 覆盖主要界面                                 |
| P2           | L4 变体：亮暗细节、紧凑模式、文档/块 `custom-*` 开关                | 开关清单可用                                 |
| P3           | 选择器回归清单与 CI 校验；按需扩展多主题包构建                      | 升级思源后能快速定位失效规则                 |

---

## 10. 当前脚手架已落地的约定

- `vite.config.ts`：直接以 `src/styles/index.css` 作为 `rollupOptions.input`（Vite 原生支持 CSS 入口，不产生 JS），产物只有 `theme.css` + `theme.json`。
- `uno.config.ts`：`presetWind3`（无 preflight）、`dark` 变体映射 `[data-theme-mode="dark"]`、`transformerDirectives` 支持 `@apply`。
- `scripts/check_dist.mjs`：断言产物无 `.js`、`theme.css` 无 `@layer`。
- `tests/css-architecture.test.ts`：四条静态守卫，保证分层不被破坏。
