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

#### 设计来源

语义层参考 **Material 3 的「角色配对」思想**（每个前景色都有一条配对的背景色，如 `primary` / `on-primary`），命名采用 **shadcn 的直觉词汇**（`foreground`、`muted`、`ring`）。

| 我们的角色            | M3 对应                  | shadcn 对应            |
| --------------------- | ------------------------ | ---------------------- |
| `--rc-brand-base`     | `primary`                | `primary`              |
| `--rc-text-on-brand`  | `on-primary`             | `primary-foreground`   |
| `--rc-brand-soft`     | `primary-container`      | `secondary` / `accent` |
| `--rc-brand-on-soft`  | `on-primary-container`   | `secondary-foreground` |
| `--rc-bg-base`        | `surface`                | `background`           |
| `--rc-bg-surface`     | `surface-container`      | `card`                 |
| `--rc-bg-raised`      | `surface-container-high` | `popover`              |
| `--rc-bg-sunken`      | `surface-container-low`  | `muted`                |
| `--rc-text-primary`   | `on-surface`             | `foreground`           |
| `--rc-text-secondary` | `on-surface-variant`     | `muted-foreground`     |
| `--rc-border-subtle`  | `outline-variant`        | `border`               |
| `--rc-border-strong`  | `outline`                | `input`                |
| `--rc-border-focus`   | `outline`（focus）       | `ring`                 |
| `--rc-danger-base`    | `error`                  | `destructive`          |

**为什么不直接用 M3 命名**：

- `container` 在 CSS 里与容器查询（`@container`）语义冲突；
- `on-*` 前缀在中文语境不直观；
- `primary-container` 这类名字无法表达「浅色背景块」的直觉。

**为什么不直接用 shadcn 命名**：

- shadcn 只有约 20 个角色，表达不了 `raised` / `sunken` / `scrim` 这些层级；
- 没有「状态层」（hover / pressed 透明度）概念。

结论：**M3 的完整度 + shadcn 的直觉性 = 自研命名**。

#### 角色与刻度的关系

角色是**语义别名**，指向某个 tone。同一个角色在明暗模式下指向不同 tone：

```css
/* 亮色 */
:root {
  --rc-brand-base: var(--rc-brand-40);
  --rc-text-primary: var(--rc-neutral-10);
}

/* 暗色 */
:root[data-theme-mode='dark'] {
  --rc-brand-base: var(--rc-brand-80);
  --rc-text-primary: var(--rc-neutral-90);
}
```

这是 M3 的既有规则（亮色主色 tone 40、暗色主色 tone 80），不需要重新发明。

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

#### 「变量」指什么

指 **CSS 自定义属性（CSS Custom Properties）**，即 `--rc-*` 这些 `:root` 上声明的键值对：

```css
:root {
  --rc-brand-40: 0.55 0.18 264;
}
```

与 Sass 变量的区别：

|                | CSS 变量                       | Sass 变量            |
| -------------- | ------------------------------ | -------------------- |
| 生效时机       | **运行时**（浏览器解析）       | 编译时（构建后消失） |
| 能否被覆盖     | ✅ 层叠覆盖                    | ❌                   |
| 能否被 JS 读写 | ✅ `element.style.setProperty` | ❌                   |
| 用途           | **运行时换肤的基础**           | 构建期常量           |

本架构中「配色可运行时切换」「插件可写内联变量」全部依赖 CSS 变量的这一特性。

#### 存储格式

统一存 `L C H` **三通道数值**（不带函数名）：

```css
:root {
  --rc-brand-40: 0.55 0.18 264;
  --rc-bg-surface: 0.98 0.01 300;
}
```

#### 为什么必须只存数值（实测）

OKLCH **本身完全支持透明度**，`oklch(0.55 0.18 264 / 0.5)` 是合法的。问题出在 UnoCSS 生成透明度工具类时，要把 `<alpha-value>` 插进颜色模板。

三种写法实测结果：

| 变量存什么                         | UnoCSS 颜色模板                   | `bg-brand/50` 生成结果                       | 有效 |
| ---------------------------------- | --------------------------------- | -------------------------------------------- | ---- |
| `0.55 0.18 264`（三通道）          | `oklch(var(--x) / <alpha-value>)` | `oklch(var(--rc-brand-40) / 0.5)`            | ✅   |
| `oklch(0.55 0.18 264)`（完整函数） | 同上                              | 展开为 `oklch(oklch(…) / 0.5)`，**嵌套非法** | ❌   |
| `oklch(0.55 0.18 264)`（完整函数） | `var(--x)`                        | `var(--rc-brand-40)`，`/50` 被丢弃           | ❌   |

结论：**函数必须由使用处提供，变量里只放能重新组装的裸数值。**

#### 使用方式

```css
/* 不透明 */
color: oklch(var(--rc-brand-40));

/* 半透明 */
background: oklch(var(--rc-brand-40) / 0.5);

/* UnoCSS 工具类（模板已含 oklch()） */
/* uno.config: brand: 'oklch(var(--rc-brand-40) / <alpha-value>)' */
/* 得到 bg-brand-40/50 → oklch(var(--rc-brand-40) / 0.5) */
```

**代价**：变量值不能直接当颜色用。`color: var(--rc-brand-40)` 是无效的，必须包一层 `oklch()`。

> RGB 三通道方案同理：`--x: 103 80 164` + `rgb(var(--x) / 0.5)`。

#### 为什么选 OKLCH 而非 RGB

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

只保留三件事对应的工具，外加一个人工入口：

| 工具                | 用途                                                        |
| ------------------- | ----------------------------------------------------------- |
| `pnpm dev`          | 构建 watch + 可见浏览器 + 让思源重载主题（F5 后仍是本主题） |
| `pnpm watch:theme`  | 监听源码，改动后自动跑 `audit:theme`                        |
| `pnpm audit:theme`  | 样式与交互审计：跑客观不变量 + 输出完整事实                 |
| `pnpm open:theme`   | 人工复审：打开桌面 + 移动端页面（可截图），自己看效果       |
| `pnpm audit:plugin` | 同一套审计跑在已装插件上（CSS 读磁盘 index.css）            |

日常闭环：`pnpm dev` 与 `pnpm watch:theme` 各开一个终端，改 `src/styles/**` 后页面立刻变、
终端立刻报违规项和全部事实。`open:theme` 留给只有眼睛能判断的事（间距协调、观感），
它不是替代 `audit:theme`，而是第二双眼睛。

#### 审计输出的是「不变量 + 事实」，不是数值快照

早期版本让用例比对一份 `expectations.json`，里面记着「上次跑出来是什么」。这有个根本问题：
**它只能回答「变了没」，回答不了「对不对」**。改个 padding 要手动更新基线，而如果基线里
抄了一个错值（比如某个被 base.css 覆盖的值），它就永远绿。

现在分成两层：

| 层         | 内容                                                                                  | 谁判断             |
| ---------- | ------------------------------------------------------------------------------------- | ------------------ |
| **不变量** | 对比度 ≥ 4.5、触摸目标 ≥ 44px、令牌无断链、桥接值等于源值、暗色覆盖中性色、交互能驱动 | 代码，error 级失败 |
| **事实**   | 每个令牌的值、每对颜色的对比度、每个探针的全部计算样式、交互前后差异                  | agent / 人         |

不变量的关键性质是**与具体数值无关**：把 padding 从 8px 改成 12px 不会误报，只要意图还成立。
`--facts-only` 只输出事实，供 agent 判断「是否符合预期」；`--json` 输出结构化数据。

实测这条链路立刻抓到一个真问题：`--rc-text-placeholder` 在背景上的对比度只有 **2.42:1**，
低于 WCAG 大字/图形要求的 3:1。这种问题在任何数值快照里都看不出来——除非有人事先知道
「2.42 是错的」并把它写进基线。

#### 主题与插件共用同一套审计

主题和插件在思源里是两套东西，但**审计方法相同**：在真实页面上量计算样式
→ 判不变量 + 输出事实。差异只在两处，收敛在 `scripts/cdp/targets.mjs`：

| 维度       | 主题                                   | 插件                                            |
| ---------- | -------------------------------------- | ----------------------------------------------- |
| CSS 从哪来 | 读磁盘 `dev/theme.css`（回退 `dist/`） | 读磁盘 `<workspace>/data/plugins/<n>/index.css` |
| 加载判定   | `<link id="themeStyle">` 的 href       | 插件是否注入 `<style id="pluginsStyle<n>">`     |
| 额外状态   | 无                                     | `activate()` 打开面板（面板 DOM 才存在）        |

**两者都读磁盘。** 实测插件的 `index.css` 与思源注入的 `<style id="pluginsStyle<name>">`
**逐字节相同**（arco-calendar 275334 字符、siyuan-plugin-publisher 492618 字符），
所以没有理由绕道从页面读。读磁盘的好处：不依赖插件是否已加载，插件出问题时审计照常跑；
不需要先把插件点开，纯 CSS 断言不受 UI 状态影响。

插件目录按思源约定推导 `<workspace>/data/plugins/<name>/`，工作区从 `workspace.json` 读；
也可用 `pluginDir` 显式指定（插件源码在别处、或做 CI 时）。

**没有 CSS 时不允许假通过。** 无 `index.css` 的插件（如 Calendar-heatmap）会返回空数组。
此时若基线里还有样式断言，探针插入的元素无论如何都有默认计算值——那些断言会「通过」
但毫无意义。所以 `verify` 直接失败并提示换基线，而不是给一条绿的假结论。

`audit.mjs` 里没有任何「是主题还是插件」的分支——测试强制它必须通过 `targets.mjs` 拿被测
对象。加第三类被测对象时只改 `targets.mjs`。

> 插件的可观测面比主题窄：面板 DOM 只在打开后才存在，所以纯 CSS 断言（令牌/选择器/
> 计算样式）是主力，需要真实 DOM 的断言要先用 `activate()` 打开面板。

**`pnpm dev` 让思源真正选中本主题，而不是在页面上打补丁。** 启动时经 kernel API 把
`themeLight`/`themeDark` 切成 `Rem Craft Dev`（已是它则不动），重建后换 `#themeStyle`
的 href 让思源重新加载。这样预览、`audit:theme`、生产用的是同一套级联。

对比过另一种做法（注入 `<style>` + 临时禁用宿主主题）：注入只能模拟「本主题叠在宿主之上」，
而真实级联里本主题是**替代**宿主主题，两者在 `--b3-*` 上结果不同——注入方式下
`--b3-theme-background` 读到宿主的 `#feffff`，切主题后才是本主题的 `rgb(246 246 246)`。

**为什么在真实页面上量，而不是 iframe 隔离**：早期用 iframe 是为了挡住宿主主题
（Neo 1.1MB、上万条规则）的覆盖。但 `pnpm dev` 现在经 kernel API 让思源真正选中本主题，
宿主主题根本不参与级联——隔离的前提消失了。而 iframe 只注入被测 CSS，会漏掉思源
`base.css` 与运行时样式：实测同一元素 `line-height` 在 iframe 里是 `normal`、
真实页面是 `28px`。

所以探针插进主文档（`position:fixed` 放到视口外），拿到的是与生产完全一致的级联：
`base.css` + 本主题 + 插件样式 + 运行时样式。变体（dark / density / 移动端 backend）
用 `actions` 驱动 `<html>` 属性，测完 `reset`。

#### 交互审计

纯静态断言有个盲区：**思源升级后 CSS 选择器还在、但 DOM 结构变了，静态断言照样绿，
实际交互已经烂了**。所以基线用例支持驱动真实交互再量：

```json
{
  "name": "交互：右键菜单打开后菜单项样式生效",
  "actions": ["contextmenu:.b3-list-item", "wait:600"],
  "probes": [{ "label": "menu-item", "target": ".b3-menu__item", "expect": { "display": "flex" } }]
}
```

可用动作（`scripts/cdp/actions.mjs`）：`click` / `hover` / `press` / `focus` / `type` /
`move` / `wait` / `contextmenu` / `dock` / `attr` / `reset`。

实测确认的四个事实：

| 事实                                                                         | 影响                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.b3-menu__item` 在菜单打开前**根本不存在**（实测 0 个）                     | 菜单类断言必须先 `contextmenu` 或 `dock`                            |
| JS 派发 `contextmenu` 事件不触发菜单（仍是 0 个）                            | 必须用真实鼠标右键，见 `contextmenu` 动作                           |
| 真实指针移动能驱动 `:hover`                                                  | `hover` 是唯一能测伪类的方式                                        |
| hover 后背景是 `rgba(0,0,0,0.075)`（来自 base.css），不是主题的 `bg-surface` | 主题 hover 规则被 base.css 覆盖——这本身就是靠交互审计发现的真实问题 |

#### 移动端

桌面与移动是**两个独立构建入口**（`/stage/build/desktop/` 与 `/stage/build/mobile/`），
`audit:theme` 按前端各开一次会话，各自开一次会话，移动端用 390x844@3 视口。

**移动端要能加载自定义主题，`theme.json` 必须有 `frontends` 字段。** 思源的判定逻辑是：

```js
const canLoad = (theme, frontend) => {
  if (theme.name === 'daylight' || theme.name === 'midnight') return true;
  const meta = findThemeMeta(theme); // 从 lightThemes/darkThemes 找
  return !!meta && (meta.frontends.includes('all') || meta.frontends.includes(frontend));
};
```

没有 `frontends` 时 `meta.frontends` 为 undefined，移动端（`browser-mobile`）就永远不加载
——桌面端不受影响，所以很容易漏。写 `["all"]` 最省事。

> 改 `theme.json` 后**必须重启思源内核**：清单只在启动时索引，内核不会热重载它。
> 验证方式：`lightThemes` 里该主题的条目应带上 `frontends: ["all"]`。

模拟切换：浏览器控制台执行

```js
document.documentElement.dataset.rcStyle = 'fluent';
document.documentElement.dataset.rcPalette = 'shadcn';
```

再跑 `pnpm audit:theme` 核对渲染是否随之变化。

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
