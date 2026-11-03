# Rem Craft 主题架构设计

> 版本：v2（从零重构）
> 目标：一套 CSS 主题，内置多套**组件风格**与**配色方案**，由插件在运行时切换。
> 硬约束：产物只有 `theme.css` + `theme.json`，**不允许任何 JS**。

---

## 1. 约束与前提

### 1.1 硬约束

| 约束                                             | 来源                                        | 影响                                    |
| ------------------------------------------------ | ------------------------------------------- | --------------------------------------- |
| 产物无 JS                                        | 思源主题通道只认 `theme.css` + `theme.json` | 所有切换能力必须落在 CSS 属性上         |
| 思源 `base.css` 无 `@layer`、144 处 `!important` | 3.8.9 实测                                  | 产物**绝不能**用 `@layer`，否则整包失效 |
| 一个主题 = 一个 `package.zip`                    | 思源市场                                    | 多风格必须打进同一个包                  |

### 1.2 核心判断：配色与风格必须分开

**配色是参数，风格是配方。** 两者的实现机制不同：

|          | 配色（palette）      | 风格（style）              |
| -------- | -------------------- | -------------------------- |
| 本质     | 一组 CSS 变量取值    | 一组真实 CSS 规则          |
| 实现     | 变量覆盖（天然层叠） | 选择器互斥（必须显式隔离） |
| 切换成本 | 几乎为零             | 需要整套规则切换           |
| 能否混搭 | 可以                 | 不能（结构不同）           |

把风格塞进变量，最终只会得到「多套配色 + 一套长得一样的组件」；把配色写成规则，则无法运行时切换。

### 1.3 默认即 Material

**没有名为 `default` 的风格与配色。** 未设置任何属性时，生效的是 Material 风格 + Material 配色。

```css
/* Material 是默认：属性缺失 或 显式写 material 都命中 */
:root:is(:not([data-rc-style]), [data-rc-style='material']) { … }
```

---

## 2. 两个正交轴

```
                  <html> 属性
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  data-rc-style                   data-rc-palette
  （组件配方轴）                    （配色轴）
  material（默认）                  material（默认）
  fluent                           fluent
  shadcn                           shadcn
  …可扩展                          …可扩展
        │                               │
        └───────────────┬───────────────┘
                        ▼
              语义令牌（--rc-*）
                        ▼
              思源桥接（--b3-*）
```

两轴可自由组合：`style=fluent` + `palette=material` 合法（Fluent 形状 + Material 配色）。

---

## 3. 分层

```
0  刻度 scale       M3 tone 0–100 色阶、间距、圆角、字体、动效
        ↓
1  语义 semantic     契约层：--rc-bg-surface 等，组件唯一可读的变量
        ↑ 由 palette 覆盖取值
        ↓
2  桥接 bridge       --b3-* ← --rc-*，思源原生 UI 的唯一入口
        ↓
3  骨架 base         所有风格共享的结构规则，只消费语义令牌
        ↑ 由 style 覆盖
        ↓
4  风格 style/<n>    每套风格的真实配方，互斥生效
        ↓
5  变体 variants     暗色 / 密度 / 移动端 / 功能开关 / 文档级属性
```

### 3.1 依赖方向（严格单向，测试强制）

| 层       | 可引用        | 禁止引用                     |
| -------- | ------------- | ---------------------------- |
| scale    | 无（纯数值）  | 任何变量                     |
| semantic | `--rc-*` 刻度 | `--b3-*`                     |
| bridge   | `--rc-*` 语义 | 定义 `--rc-*`                |
| base     | `--rc-*` 语义 | `--b3-*`、`--m3-*`、`--tw-*` |
| style    | `--rc-*` 语义 | `--b3-*`、`--m3-*`、`--tw-*` |
| variants | `--rc-*` 语义 | 同上                         |

**唯一例外**：`bridge` 是 `--b3-*` 的唯一定义处。除此之外任何层出现 `--b3-` 都视为违规。

---

## 4. 目录结构

```
src/
  theme.css                     # 唯一入口，只有 @import，顺序即层级
  foundation/
    scale.css                   # 0 刻度（M3 tone 13 档，OKLCH 三通道）
    semantic.css                # 1 语义契约 + --rc-contract-version
    bridge.css                  # 2 --b3-* 桥接
  palettes/
    material.css                # 默认（:root）
    fluent.css                  # [data-rc-palette=fluent]
    shadcn.css                  # [data-rc-palette=shadcn]
  base/
    skeleton.css                # 3 共享结构规则（含 .rc-ripple 预留）
  styles/
    material/
      index.css                 # @import 该风格的各区域文件
      dock.css  toolbar.css  tabs.css  editor.css  sidebar.css
      menus.css  dialogs.css  statusbar.css  scrollbar.css
    fluent/                     # 仅桌面
      index.css  …同构
    shadcn/                     # 仅桌面
      index.css  …同构
  variants/
    dark.css                    # [data-theme-mode=dark]
    density.css                 # [data-ui-density=compact]
    mobile.css                  # [data-backend=ios|android|harmony]
    features.css                # 功能开关 data-rc-<feature>
    document.css                # [custom-rc-*] 文档级属性
contract/
  tokens.json                   # 契约包（过渡期在主题仓库，稳定后发 npm）
scripts/palette/
  argb-to-oklch.mjs             # ARGB/hex → OKLCH 三通道
  gen-palette.mjs               # 种子色 → palettes/*.css
```

### 4.1 新增一套风格的成本

1. 建 `styles/<name>/` 目录，按区域写文件；
2. 在 `styles/<name>/index.css` 里 `@import` 各区域；
3. 在 `src/theme.css` 里加一行 `@import`；
4. 在 `contract/tokens.json` 的风格列表里加一项。

没有中心注册表，没有构建配置改动。

---

## 5. 隔离机制

### 5.1 风格互斥

```css
/* styles/material/dock.css —— Material 是默认 */
:root:is(:not([data-rc-style]), [data-rc-style='material']) .dock__item {
  border-radius: var(--rc-radius-full);
  padding: var(--rc-space-1);
}

/* styles/fluent/dock.css —— 只在自己的属性下生效 */
@media (hover: hover) and (pointer: fine) {
  :root[data-rc-style='fluent'] .dock__item {
    border-radius: var(--rc-radius-sm);
    padding: var(--rc-space-2);
  }
}
```

- 属性缺失 → 只有 Material 命中；
- 属性为 `fluent` → Material 的 `:not()` 不再匹配，Fluent 命中；
- 属性为 `material` → Material 显式命中。

特异性：`:root:is(…)` 取参数最高者（属性 0,1,0）+ `:root`（0,1,0）= 0,2,0；叠加组件选择器后 0,3,0，稳定压过 `base.css` 的 0,1,0 / 0,2,0。

### 5.2 配色覆盖

变量天然层叠，不需要 `:not()`：

```css
/* palettes/material.css —— 默认值挂在 :root */
:root {
  --rc-brand-40: 0.52 0.16 264;
  --rc-bg-surface: 0.98 0.01 300;
}

/* palettes/fluent.css —— 更具体的选择器胜出 */
:root[data-rc-palette='fluent'] {
  --rc-brand-40: 0.55 0.14 250;
  --rc-bg-surface: 0.96 0 0;
}
```

**必须保证每个 palette 覆盖全部必需角色**，否则会与默认值混色（测试强制）。

### 5.3 功能开关（opt-out）

默认启用，属性为 `off` 时整段规则不生效，自然回落 `base.css`：

```css
:root:not([data-rc-link-underline='off']) .protyle-wysiwyg a {
  text-decoration: underline;
}
```

### 5.4 不使用 CSS 嵌套

产物要同时被 UnoCSS 处理并直接下发，嵌套会增加构建不确定性。**统一写平铺选择器**，靠 `:is()` 降低重复。

### 5.5 桌面限定（非 Material 风格）

`fluent` / `shadcn` 只做桌面，用媒体查询限定，移动端自动回落思源默认：

```css
@media (hover: hover) and (pointer: fine) {
  :root[data-rc-style='fluent'] .dock__item { … }
}
```

移动端是 `pointer: coarse`，规则自然不生效。Material 不加这层限制。

---

## 6. 语义契约

`foundation/semantic.css` 是主题与插件之间唯一的耦合点。

### 6.1 版本号

```css
:root {
  --rc-contract-version: 1;
}
```

规则：**只增不改**。新增角色 → 版本不变；改名或删除 → 版本 +1，插件检测到不匹配则降级为「只切属性、不写内联变量」。

### 6.2 刻度：M3 tone 13 档

色阶直接采用 **Material 3 的 tone 刻度**：

```
tone:  0   5   10   20   30   40   50   60   70   80   90   95   100
```

| 色族     | 变量前缀                      | 用途         |
| -------- | ----------------------------- | ------------ |
| 品牌     | `--rc-brand-{tone}`           | 主色         |
| 次要     | `--rc-secondary-{tone}`       | 次要色       |
| 第三     | `--rc-tertiary-{tone}`        | 强调色       |
| 中性     | `--rc-neutral-{tone}`         | 背景、文字   |
| 中性变体 | `--rc-neutral-variant-{tone}` | 边框、分隔线 |
| 错误     | `--rc-error-{tone}`           | 危险状态     |

状态色（success / warning / info）没有 M3 原生 tone 带，用同样 13 档手工定义，保持结构一致。

#### 刻度选择的依据

M3 的 tone 就是 HCT 色彩空间里的**感知亮度**（L*），与 OKLCH 的 L 通道同源：

- tone 值与 OKLCH 三通道可以直接换算，不需要额外的映射表；
- 种子色算法输出的就是 tone，落到变量上无损；
- `--rc-brand-40` 在亮色主题是主色、`--rc-brand-80` 在暗色主题是主色，这是 M3 的既有规则。

#### UnoCSS 接入（实测可行）

```js
// uno.config.ts
const TONES = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
const ramp = (name) => Object.fromEntries(TONES.map((t) => [t, `oklch(var(--rc-${name}-${t}) / <alpha-value>)`]));

export default defineConfig({
  theme: {
    colors: {
      brand: ramp('brand'),
      neutral: ramp('neutral'),
      surface: 'oklch(var(--rc-bg-surface) / <alpha-value>)',
    },
  },
});
```

生成结果（实测）：

```css
.bg-brand-40/50  { background-color: oklch(var(--rc-brand-40) / 0.5); }
.text-brand-90/25 { color: oklch(var(--rc-brand-90) / 0.25); }
```

#### 种子色生成：何时需要转换

`material-color-utilities` 输出 ARGB / hex，而变量要存 OKLCH 三通道，中间需要一次转换。

| 场景                                  | 需要脚本吗              |
| ------------------------------------- | ----------------------- |
| 手写色板，直接写 OKLCH 三通道         | ❌ 不需要               |
| 用 M3 种子算法生成                    | ✅ 需要 `argb → oklch`  |
| 采用 shadcn / Tailwind v4 的 OKLCH 值 | ❌ 不需要（已是三通道） |

```js
// scripts/palette/argb-to-oklch.mjs
import { hexFromArgb } from '@material/material-color-utilities';
import { converter } from 'culori';

const toOklch = converter('oklch');

export function argbToTriplet(argb) {
  const { l, c, h } = toOklch(hexFromArgb(argb));
  return `${l.toFixed(4)} ${c.toFixed(4)} ${(h ?? 0).toFixed(2)}`;
}
```

构建时与插件运行时共用同一份，保证结果一致。

#### 变量格式的硬性要求（实测）

| 变量内容                         | `bg-brand/50` 生成结果     | 可用 |
| -------------------------------- | -------------------------- | ---- |
| `0.52 0.16 264`（三通道）        | `oklch(var(--x) / 0.5)`    | ✅   |
| `#6750a4`（hex）                 | `rgb(103 80 164 / 0.5)`    | ✅   |
| `oklch(0.52 0.16 264)`（完整值） | `var(--x)`，**透明度丢失** | ❌   |

**规则：变量只存数值，不存完整函数。**

---

### 6.3 颜色角色

组件只允许引用这一层的变量。

| 分组   | 角色                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 背景   | `--rc-bg-base` `--rc-bg-surface` `--rc-bg-raised` `--rc-bg-sunken` `--rc-bg-inverse` `--rc-bg-scrim`                                          |
| 文字   | `--rc-text-primary` `--rc-text-secondary` `--rc-text-tertiary` `--rc-text-disabled` `--rc-text-on-brand` `--rc-text-inverse` `--rc-text-link` |
| 边框   | `--rc-border-subtle` `--rc-border-default` `--rc-border-strong` `--rc-border-focus`                                                           |
| 品牌   | `--rc-brand-base` `--rc-brand-hover` `--rc-brand-active` `--rc-brand-soft` `--rc-brand-on-soft`                                               |
| 状态   | `--rc-{success,warning,danger,info}-base` / `-soft` / `-on-soft`                                                                              |
| 状态层 | `--rc-state-hover` `--rc-state-focus` `--rc-state-pressed` `--rc-state-drag`（透明度数值）                                                    |

角色与刻度的关系：角色是**语义别名**，指向某个 tone。例如亮色主题下 `--rc-brand-base: var(--rc-brand-40)`，暗色主题下改为 `var(--rc-brand-80)`。

### 6.4 形状 / 间距 / 字体 / 动效

| 分组 | 角色                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 圆角 | `--rc-radius-none` `-xs` `-sm` `-md` `-lg` `-xl` `-full`                                                |
| 间距 | `--rc-space-0` … `--rc-space-12`（4dp 网格）                                                            |
| 阴影 | `--rc-elevation-0` … `--rc-elevation-5`                                                                 |
| 字体 | `--rc-font-sans` `--rc-font-mono` `--rc-font-display`                                                   |
| 字号 | `--rc-text-display` `-headline` `-title` `-body` `-label`（各含 size / line-height / weight）           |
| 动效 | `--rc-duration-short` `-medium` `-long`；`--rc-ease-standard` `-emphasized` `-decelerate` `-accelerate` |
| 布局 | `--rc-editor-max-width` `--rc-gutter-width` `--rc-tab-height` `--rc-dock-width` `--rc-touch-min`        |

### 6.5 色彩格式：OKLCH 三通道

统一存 `L C H` 三通道（不带函数）：

```css
:root {
  --rc-brand-40: 0.55 0.18 264;
  --rc-bg-surface: 0.98 0.01 300;
}

/* 使用 */
color: oklch(var(--rc-brand-40));
background: oklch(var(--rc-brand-40) / 0.5);
```

| 维度       | RGB 三通道                 | OKLCH 三通道                        |
| ---------- | -------------------------- | ----------------------------------- |
| 感知均匀性 | 差（同亮度差在暗处更明显） | 好（L 通道线性感知）                |
| 色阶生成   | 需在 HSL/Lab 空间转换      | 直接调 L 即可                       |
| 状态色派生 | 提亮/压暗会偏色            | 只改 L，色相不变                    |
| 与生态一致 | shadcn v3                  | shadcn v4、Tailwind v4、M3 HCT 同源 |

**兼容性**：思源 3.8.9 内嵌 Chromium 156，实测支持 `oklch()`、`color-mix()`、`light-dark()`、相对颜色语法，无风险。

约定：

- 中性色 C 值接近 0，仍保留三通道格式以统一处理；
- 需要 fallback 时在语义层写 `color: oklch(var(--x))`，不硬编码 RGB。

---

## 7. 插件契约

### 7.1 契约包的维护方式

两个仓库（主题 / 插件）互相独立，契约必须有可版本化的载体。分两阶段：

| 阶段               | 方式                                                             | 说明                             |
| ------------------ | ---------------------------------------------------------------- | -------------------------------- |
| **过渡（当前）**   | 主题仓库 `contract/tokens.json`，插件仓库用 `file:` 依赖本地路径 | 开发期无需发包，改契约立即生效   |
| **正式（稳定后）** | 发布 `@rem-craft/contract` 到 npm                                | 有语义化版本，插件可声明兼容范围 |

为什么不用 monorepo / submodule：

| 方案          | 问题                                                         |
| ------------- | ------------------------------------------------------------ |
| monorepo      | 思源市场要求「一个仓库一个 package.zip」，主题与插件必须分仓 |
| git submodule | 更新繁琐，CI 容易漏 `--recursive`                            |
| 复制文件      | 手工同步，必然漂移                                           |
| **npm 包**    | 唯一有版本、可追溯、无需 submodule 的通道                    |

契约包内容（刻意保持极小）：

```
contract/
  tokens.json     # 角色清单 + 版本号 + 各体系映射
  index.d.ts      # 角色名类型（可选）
  package.json
```

```json
{
  "contractVersion": 1,
  "tones": [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
  "scaleFamilies": ["brand", "secondary", "tertiary", "neutral", "neutral-variant", "error"],
  "colorRoles": ["brand-base", "bg-surface", "text-primary", "…"],
  "shapeRoles": ["radius-md", "elevation-2", "space-4", "…"],
  "styles": ["material", "fluent", "shadcn"],
  "palettes": ["material", "fluent", "shadcn"]
}
```

### 7.2 属性（写在 `<html>`）

| 属性                | 取值                                 | 缺省行为             |
| ------------------- | ------------------------------------ | -------------------- |
| `data-rc-style`     | `material` / `fluent` / `shadcn` / … | 缺失 = `material`    |
| `data-rc-palette`   | `material` / `fluent` / `shadcn` / … | 缺失 = `material`    |
| `data-rc-custom`    | `on`                                 | 插件动态配色生效标记 |
| `data-rc-<feature>` | `on` / `off`                         | 缺失 = 使用主题默认  |

复用思源原生属性：

| 原生属性          | 取值                                                               | 用途                      |
| ----------------- | ------------------------------------------------------------------ | ------------------------- |
| `data-theme-mode` | `light` / `dark`                                                   | 明暗模式                  |
| `data-ui-density` | `compact` / 其它                                                   | 密度                      |
| `data-backend`    | `ios` / `android` / `harmony` / `win` / `mac` / `linux` / `docker` | 平台判定                  |
| `data-frontend`   | `desktop` / `desktop-window` / `browser-desktop`                   | 前端类型（**无 mobile**） |
| `custom-rc-*`     | 自定义                                                             | 文档级 / 块级属性         |

### 7.3 插件职责

```
设置面板
  ├─ 风格：material / fluent / shadcn / …
  ├─ 配色：material / fluent / shadcn / 自定义种子色
  └─ 功能开关：见 §8.2

运行时
  ├─ 写 <html> 上的 data-rc-* 属性
  ├─ 自定义种子色：material-color-utilities → 写内联变量 + data-rc-custom
  ├─ 监听 data-theme-mode 变化 → 重新生成对应 scheme
  ├─ 水波纹：监听 pointerdown → 写 --rc-ripple-x/y + 触发动画类
  └─ 持久化（loadData / saveData）
```

### 7.4 启动兼容检测

```js
const root = document.documentElement;
const version = Number(getComputedStyle(root).getPropertyValue('--rc-contract-version').trim());

if (!version) {
  // 没装主题：禁用面板，提示先安装主题
} else if (version < REQUIRED_VERSION) {
  // 主题过旧：只切属性，不写内联变量
} else {
  // 全部功能可用
}
```

### 7.5 优先级

```
主题默认变量（:root）
  < 调色板变量（[data-rc-palette]）
    < 插件内联变量（element.style.setProperty）   ← 最高
```

插件写内联变量时必须同时设置 `data-rc-custom="on"`；切回内置配色时清空内联变量并移除该属性。

---

## 8. 能力边界与功能开关

### 8.1 能力边界

| 能力                   | 支持           | 机制                                |
| ---------------------- | -------------- | ----------------------------------- |
| 运行时切换配色         | ✅             | `data-rc-palette`                   |
| 运行时切换组件风格     | ✅             | `data-rc-style`（多套配方全量打包） |
| 自定义种子色生成配色   | ✅（需插件）   | 插件写内联变量                      |
| 明暗模式               | ✅             | `data-theme-mode`                   |
| 紧凑密度               | ✅             | `data-ui-density`                   |
| 功能开关               | ✅             | `data-rc-<feature>`                 |
| 文档级样式             | ✅             | `custom-rc-*`                       |
| 移动端适配             | ✅ 仅 Material | `data-backend`                      |
| Material 水波纹        | ✅（需插件）   | 插件监听 `pointerdown` + CSS 动画   |
| 无插件时的多风格切换   | ❌             | 无 JS 无法写属性；用户可用代码片段  |
| 完整 M3 motion 编排    | ⚠️             | CSS 只能对属性变化加 transition     |
| Cupertino（Apple）风格 | ❌ 暂缓        | 无官方 Web 组件库，只有 HIG 文档    |

### 8.2 功能开关（`data-rc-<feature>`）

**这是功能开关，不是区域开关。** 每个开关对应一段可独立启用的功能样式。

约定：

- 属性值 `on` / `off`；缺失时使用主题默认；
- 由插件设置面板控制（写 `<html>`），或用 `custom-rc-<feature>` 按文档生效；
- 主题侧用 `:root:not([data-rc-<feature>='off'])` 或 `:root[data-rc-<feature>='on']` 表达。

当前候选清单（结构先落地，内容后续增补）：

| 功能       | 属性                     | 默认 | 作用                        |
| ---------- | ------------------------ | ---- | --------------------------- |
| 专注模式   | `data-rc-focus-mode`     | off  | 隐藏侧栏与 dock，编辑区居中 |
| 宽屏编辑   | `data-rc-wide-editor`    | off  | 解除编辑区最大宽度限制      |
| 块聚焦高亮 | `data-rc-block-focus`    | on   | 当前编辑块加背景/描边       |
| 链接下划线 | `data-rc-link-underline` | on   | 正文链接显示下划线          |
| 标题锚点   | `data-rc-heading-anchor` | on   | hover 标题时显示锚点标记    |
| 列表紧凑   | `data-rc-list-tight`     | off  | 收紧列表项行距              |
| 代码行号   | `data-rc-line-numbers`   | off  | 代码块显示行号              |
| 水波纹     | `data-rc-ripple`         | on   | 点击反馈（需插件）          |
| 动效降级   | `data-rc-reduce-motion`  | off  | 关闭过渡与动画              |

---

### 8.3 移动端策略

#### 事实（查思源源码与打包产物核实）

`data-frontend` **只有三个值**，没有 `mobile`：

```js
// app/src/util/compatibility.ts
const N$ = () =>
  window.navigator.userAgent.startsWith('SiYuan/')
    ? hasNoToolbar()
      ? 'desktop-window'
      : 'desktop'
    : 'browser-desktop';
```

移动端是**独立构建入口**：

| 入口 | URL                     | 特征                               |
| ---- | ----------------------- | ---------------------------------- |
| 桌面 | `/stage/build/desktop/` | 无 `#mobileTopBar`                 |
| 移动 | `/stage/build/mobile/`  | **有 `#mobileTopBar`**（实测确认） |

移动端判定的可靠依据：

| 依据                   | 取值                                                               | 可靠性     |
| ---------------------- | ------------------------------------------------------------------ | ---------- |
| `data-backend`         | `ios` / `android` / `harmony` / `docker` / `win` / `mac` / `linux` | ⭐ 推荐    |
| `body` class           | `body--ios` / `body--android` / `body--harmony`                    | 可用       |
| `window.siyuan.mobile` | 移动端才存在                                                       | 仅 JS 可用 |

#### 适配策略

```css
/* variants/mobile.css */
:root[data-backend='ios'],
:root[data-backend='android'],
:root[data-backend='harmony'] {
  --rc-touch-min: 44px;
  --rc-tab-height: 40px;
  --rc-space-2: 6px;
}
```

#### 只有 Material 做移动端

`styles/fluent/`、`styles/shadcn/` 的规则全部限定在桌面（见 §5.5），移动端自动回落思源默认样式。

### 8.4 水波纹实现（需插件）

主题侧预留（`base/skeleton.css`）：

```css
.rc-ripple-host {
  position: relative;
  overflow: hidden;
}

.rc-ripple::after {
  content: '';
  position: absolute;
  left: var(--rc-ripple-x, 50%);
  top: var(--rc-ripple-y, 50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.24;
  transform: translate(-50%, -50%) scale(0);
  animation: rc-ripple var(--rc-duration-long) var(--rc-ease-decelerate) forwards;
}

@keyframes rc-ripple {
  to {
    transform: translate(-50%, -50%) scale(40);
    opacity: 0;
  }
}
```

插件侧（事件委托，无需关心动态插入的 DOM）：

```js
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.b3-menu__item, .b3-button');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--rc-ripple-x', `${e.clientX - r.left}px`);
  el.style.setProperty('--rc-ripple-y', `${e.clientY - r.top}px`);
  el.classList.remove('rc-ripple');
  void el.offsetWidth;
  el.classList.add('rc-ripple');
});
```

限制：

1. 需要元素有 `position: relative; overflow: hidden`（主题侧给宿主加 `.rc-ripple-host`）；
2. 无法复刻 M3 精确的扩散曲线与多段淡出，视觉近似；
3. `data-rc-ripple='off'` 时不触发。

---

## 9. 构建

```
pnpm build
  → clean
  → check:manifest      theme.json 校验（版本与 package.json 一致）
  → type-check
  → vite build          UnoCSS 展开 @apply → dist/theme.css
  → check:dist          守卫：无 JS、无 @layer、体积预算
  → package.zip
```

| 决策      | 取值                                  |
| --------- | ------------------------------------- |
| 输出      | 单文件 `theme.css`                    |
| 体积预算  | < 120 KB（思源 `base.css` 为 585 KB） |
| sourcemap | 关闭                                  |
| 压缩      | 默认                                  |
| `@layer`  | **禁用**                              |

---

## 10. 测试

### 10.1 静态守卫（CI 可跑）

| 编号 | 规则                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| A1   | `theme.css` 的 `@import` 顺序必须 0→1→2→3→4→5                                                |
| A2   | 产物与源码均不含 `@layer`                                                                    |
| A3   | `base/`、`styles/`、`variants/` 不得出现 `--b3-`                                             |
| A4   | `semantic.css` 不得出现 `--b3-`                                                              |
| A5   | `styles/`、`variants/` 不得出现 `--m3-`、`--tw-`、`--fluent-`                                |
| A6   | 每个 palette 必须覆盖 §6.3 的全部颜色角色                                                    |
| A7   | 每个 style 目录必须包含 `index.css` 且被 `theme.css` 引用                                    |
| A8   | `styles/` 中必须使用 `:is(:not([data-rc-style]), [data-rc-style=<name>])` 或自己的属性作用域 |
| A9   | 体积预算、`!important` 数量预算                                                              |
| A10  | 契约版本号存在且为整数                                                                       |
| A11  | 非 material 风格的规则必须包在 `@media (hover: hover) and (pointer: fine)` 内                |

### 10.2 本地验证（需要思源）

| 工具                      | 用途                                    |
| ------------------------- | --------------------------------------- |
| `pnpm dev`                | Vite dev server + 可见浏览器 + 自动 HMR |
| `pnpm inspect <selector>` | 读取真实计算样式与命中规则              |
| `pnpm audit`              | 选择器命中率扫描（思源升级回归）        |

模拟切换：浏览器控制台执行

```js
document.documentElement.dataset.rcStyle = 'fluent';
document.documentElement.dataset.rcPalette = 'shadcn';
```

再用 `pnpm inspect` 核对计算样式是否随之变化。

---

## 11. UnoCSS 的定位

**UnoCSS 是构建期 CSS 生成器，不是运行时工具类系统。**

| 用途                      | 说明                                                     |
| ------------------------- | -------------------------------------------------------- |
| `@apply`                  | 在 `styles/` 中把工具类展开进真实选择器                  |
| `theme` 配置              | 把 `--rc-*` 映射成 UnoCSS 主题，使 `bg-brand-40/50` 可用 |
| `shortcuts`               | 复用片段（如 `rc-menu-item`）                            |
| `transformerDirectives`   | 支持 `@apply`                                            |
| `transformerVariantGroup` | 支持 `hover:(bg-surface text-brand)`                     |

禁用项：

| 禁用                             | 原因                                    |
| -------------------------------- | --------------------------------------- |
| preflight / reset                | 思源 `base.css` 已有重置                |
| `presetAttributify`              | 只影响 HTML 标记，主题无自有 HTML       |
| `presetIcons` / `presetWebFonts` | 体积与网络成本，思源已有图标与字体      |
| `outputToCssLayers`              | 会让产物进 `@layer`，被 `base.css` 压制 |

`@apply` 仅允许出现在 `styles/` 与 `base/`；`foundation/`、`palettes/`、`variants/` 写纯 CSS。

---

## 12. 从零实施顺序

| 步骤 | 内容                                                         | 验收                      |
| ---- | ------------------------------------------------------------ | ------------------------- |
| 1    | 清空 `src/styles/`，建立新目录骨架                           | `pnpm build` 产出空壳 CSS |
| 2    | `foundation/scale.css`（M3 tone 13 档，OKLCH 三通道）        | 变量在页面上可读          |
| 3    | `foundation/semantic.css` + `bridge.css`                     | 语义角色与 `--b3-*` 生效  |
| 4    | `contract/tokens.json` + 守卫测试 A6/A10                     | 测试能拦住缺角色          |
| 5    | `palettes/material.css`                                      | 默认配色生效              |
| 6    | `base/skeleton.css`（含 `.rc-ripple` 预留）                  | 基础布局正确              |
| 7    | `styles/material/`（按区域逐个）                             | 默认风格完整              |
| 8    | `variants/`（dark / density / mobile / features / document） | 变体生效                  |
| 9    | 测试 A1–A11 全绿                                             | `pnpm check` 通过         |
| 10   | `scripts/palette/argb-to-oklch.mjs` + 生成脚本               | 种子色可生成配色          |
| 11   | `palettes/shadcn.css` + `styles/shadcn/`（仅桌面）           | 切换验证                  |
| 12   | `palettes/fluent.css` + `styles/fluent/`（仅桌面）           | 切换验证                  |
| 13   | 文档与体积复核                                               | 预算内                    |

---

## 13. 已定决策

| 议题           | 决策                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| Cupertino 风格 | 暂缓（Apple 无官方 Web 组件库，只有 HIG 文档）                               |
| 刻度层         | **M3 tone 13 档**（0/5/10/20/30/40/50/60/70/80/90/95/100），无损对接种子生成 |
| 语义层         | 参考 M3 的配对思路（前景/背景成对），命名自研                                |
| 色彩格式       | **OKLCH 三通道**（变量只存数值，不存完整函数）                               |
| UnoCSS 接入    | tone 色阶约 20 行配置，`bg-brand-40/50` 实测可用                             |
| 移动端判定     | `data-backend ∈ {ios, android, harmony}`；`data-frontend` 无 mobile          |
| 移动端范围     | 只有 Material 做；其他风格用媒体查询限定桌面                                 |
| 功能开关       | 见 §8.2，结构先落地，清单后续增补                                            |
| 插件契约       | 过渡期 `file:` 本地依赖，稳定后发 `@rem-craft/contract`                      |
| 水波纹         | 插件实现（`pointerdown` + CSS 动画），主题侧预留                             |

---

## 14. 待补充

1. 功能开关清单（§8.2）尚未定稿。
2. `contract/tokens.json` 的完整角色清单需在步骤 4 逐项确认。
3. 是否引入 `cupertino` 风格，等前几套稳定后评估。
4. 移动端 Material 适配的具体尺寸表（间距/字号/触摸目标）待实测确定。
