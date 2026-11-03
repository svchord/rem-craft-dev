# Rem Craft 主题架构设计

> 状态：**待评审**（v1 提案）
> 目标：一套 CSS 主题，内置多套「组件风格 + 配色方案」，由插件在运行时切换。
> 硬约束：产物只有 theme.css + theme.json，**不允许任何 JS**。

---

## 1. 设计前提

### 1.1 三条硬约束

| 约束                                       | 来源                                | 影响                                        |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------- |
| 产物无 JS                                  | 思源主题只认 theme.css + theme.json | 所有切换能力必须落在 CSS 属性上             |
| 思源 base.css 无 @layer、144 处 !important | 3.8.9 实测                          | 我们的产物**绝不能**用 @layer，否则整包失效 |
| 一个主题 = 一个 package.zip                | 思源市场                            | 多风格必须打进同一个包                      |

### 1.2 核心判断

**配色是参数，风格是配方。两者实现机制不同，必须分开设计。**

|          | 配色（palette）      | 风格（style）              |
| -------- | -------------------- | -------------------------- |
| 本质     | 一组 CSS 变量取值    | 一组真实 CSS 规则          |
| 实现     | 变量覆盖（天然层叠） | 选择器互斥（必须显式隔离） |
| 切换成本 | 几乎为零             | 需要整套规则切换           |
| 能否混搭 | 可以                 | 不能（结构不同）           |

把风格塞进变量，最终只会得到「三套配色 + 一套长得一样的组件」；把配色写成规则，则无法运行时切换。所以两者分开。

### 1.3 默认即 Material

没有名为 default 的风格。**未设置任何属性时，生效的是 Material 风格 + Material 配色。**

```css
/* Material 是默认：属性缺失 或 显式写 material 都命中 */
:root:is(:not([data-rc-style]), [data-rc-style='material']) {
  /* … */
}
```

---

## 2. 两个正交轴

```
                     ┌─────────────────┐
                     │  <html> 属性     │
                     └────────┬────────┘
              ┌───────────────┴───────────────┐
              ▼                               ▼
   data-rc-style                     data-rc-palette
   （组件配方轴）                      （配色轴）
   material（默认）                    material（默认）
   fluent                             fluent
   shadcn                             shadcn
   …可扩展                            …可扩展
              │                               │
              └───────────────┬───────────────┘
                              ▼
                     语义令牌（--rc-*）
                              ▼
                     思源桥接（--b3-*）
```

两个轴可自由组合：style=fluent + palette=material 是合法的（Fluent 形状 + Material 配色）。

---

## 3. 分层

```
┌─ 0  刻度（scale）        原始数值：色阶 50–950、间距、圆角、字体、动效
│
├─ 1  语义（semantic）     契约层：--rc-bg-surface 等，组件唯一可读的变量
│      ↑ 由 palette 覆盖取值
│
├─ 2  桥接（bridge）       --b3-* ← --rc-*，思源原生 UI 的唯一入口
│
├─ 3  骨架（base）         所有风格共享的结构规则，只消费语义令牌
│      ↑ 由 style 覆盖
│
└─ 4  风格（style/<name>） 每个风格的真实配方，互斥生效
       └ 5  变体（variants）暗色 / 密度 / 区域开关 / 文档级属性
```

### 依赖方向（严格单向，测试强制）

```
scale → semantic → bridge
            ↓
          base → style/<name>
            ↓
        variants
```

| 层       | 可引用       | 禁止引用               |
| -------- | ------------ | ---------------------- |
| scale    | 无（纯数值） | 任何变量               |
| semantic | --rc-* 刻度  | --b3-*                 |
| bridge   | --rc-* 语义  | 定义 --rc-*            |
| base     | --rc-* 语义  | --b3-_、--m3-_、--tw-* |
| style    | --rc-* 语义  | --b3-_、--m3-_、--tw-* |
| variants | --rc-* 语义  | 同上                   |

**唯一例外**：bridge 是 --b3-* 的唯一定义处；除此之外任何层出现 --b3- 都视为架构违规。

---

## 4. 目录结构

```
src/
  theme.css                     # 只有 @import，顺序即层级
  foundation/
    scale.css                   # 0 刻度默认值（Material 基准，OKLCH 三通道）
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
    fluent/
      index.css
      …同构
    shadcn/
      index.css
      …同构
  variants/
    dark.css                    # [data-theme-mode=dark]
    density.css                 # [data-ui-density=compact]
    mobile.css                  # [data-frontend=mobile] 布局适配
    features.css                # 功能开关 data-rc-<feature>
    document.css                # [custom-rc-*] 文档级属性
contract/
  tokens.json                   # 契约包（过渡期在主题仓库，稳定后发 npm）
scripts/
  palette/
    m3-to-scale.mjs             # tone → 11 阶映射（构建时/插件运行时共用）
    gen-palette.mjs             # 生成 palettes/*.css
```

### 新增一套风格的成本

1. 建 `styles/<name>/` 目录，按区域写文件；
2. 在 `styles/<name>/index.css` 里 `@import` 各区域；
3. 在 `src/theme.css` 里加一行 `@import`；
4. 在 `contract/tokens.json` 的风格列表里加一项。

没有中心注册表、没有构建配置改动。

---

## 5. 隔离机制（关键实现细节）

### 5.1 风格互斥

```css
/* styles/material/dock.css —— Material 是默认，用 :is() 合并两种情况 */
:root:is(:not([data-rc-style]), [data-rc-style='material']) .dock__item {
  border-radius: var(--rc-radius-full);
  padding: var(--rc-space-1);
}

/* styles/fluent/dock.css —— 只在自己的属性下生效 */
:root[data-rc-style='fluent'] .dock__item {
  border-radius: var(--rc-radius-sm);
  padding: var(--rc-space-2);
}
```

- 属性缺失 → 只有 Material 命中；
- 属性为 fluent → Material 的 :not() 不再匹配，Fluent 命中；
- 属性为 material → Material 显式命中。

特异性：:root:is(…) 取参数最高者（属性 0,1,0）+ :root（0,1,0）= 0,2,0；叠加组件选择器后 0,3,0，稳定压过 base.css。

### 5.2 配色覆盖

变量天然层叠，不需要 :not()：

```css
/* palettes/material.css —— 默认值挂在 :root */
:root {
  --rc-brand-600: 103 80 164;
  --rc-bg-surface: 254 247 255;
}

/* palettes/fluent.css —— 更具体的选择器胜出 */
:root[data-rc-palette='fluent'] {
  --rc-brand-600: 0 120 212;
  --rc-bg-surface: 243 243 243;
}
```

**但必须保证每个 palette 覆盖全部必需角色**，否则会与默认值混色（测试强制）。

### 5.3 区域开关（opt-out）

默认启用，属性为 off 时整段规则不生效，自然回落 base.css：

```css
:root:not([data-rc-dock='off']) .dock__item { … }
```

### 5.4 不使用 CSS 嵌套

产物要同时被 UnoCSS 处理并直接下发，嵌套会增加构建不确定性。**统一写平铺选择器**，靠 :is() 降低重复。

---

## 6. 语义契约

foundation/semantic.css 是主题与插件之间唯一的耦合点。

### 6.1 版本号

```css
:root {
  --rc-contract-version: 1;
}
```

规则：**只增不改**。新增角色 → 版本不变（向后兼容）；改名或删除 → 版本 +1，插件检测到不匹配则降级为「只切属性、不写内联变量」。

### 6.2 刻度（canonical scale）

所有色阶统一为 **11 阶：50 / 100 / 200 / 300 / 400 / 500 / 600 / 700 / 800 / 900 / 950**（Tailwind 刻度）。

| 色族     | 变量前缀                                                              | 用途             |
| -------- | --------------------------------------------------------------------- | ---------------- |
| 品牌     | `--rc-brand-*`                                                        | 主色             |
| 中性     | `--rc-neutral-*`                                                      | 背景、文字、边框 |
| 中性变体 | `--rc-neutral-variant-*`                                              | 次要边框、分隔线 |
| 状态     | `--rc-success-*` / `--rc-warning-*` / `--rc-danger-*` / `--rc-info-*` | 语义状态         |

#### 为什么刻度用 Tailwind 而不是 M3 tone

刻度是**存储格式**，不是设计哲学。选 Tailwind 11 阶的原因：与 UnoCSS `presetWind3` 原生一致（`bg-brand-600` 直接可用）、与 shadcn 1:1、11 阶粒度足够。

#### 种子色生成怎么接（关键）

Material 的种子功能（seed → 整套 scheme）**在刻度层之上工作**，不冲突：

```
seed color
   ↓ material-color-utilities（构建时或插件运行时）
HCT tone 0–100 色带（每个角色一条）
   ↓ 采样映射到 11 阶
--rc-brand-50 … --rc-brand-950
   ↓
语义角色 --rc-brand-base / --rc-bg-surface …
```

映射表（tone → 阶）：

| M3 tone | 11 阶 |
| ------- | ----- |
| 98      | 50    |
| 95      | 50    |
| 90      | 100   |
| 80      | 200   |
| 70      | 300   |
| 60      | 400   |
| 50      | 500   |
| 40      | 600   |
| 30      | 700   |
| 20      | 800   |
| 10      | 900   |
| 5       | 950   |

两种生成路径：

| 路径   | 时机                              | 产物     | 适用             |
| ------ | --------------------------------- | -------- | ---------------- |
| 构建时 | `pnpm gen:palette --seed #6750a4` | 静态 CSS | 内置配色包       |
| 运行时 | 插件调用同一套 API                | 内联变量 | 用户自定义种子色 |

两条路径**共用同一份映射函数**（`scripts/palette/m3-to-scale.mjs`），保证构建时与运行时结果一致。

如果以后想直接用 M3 的 tone 命名（`--rc-primary-40`），只需新增一层别名，不需要重构刻度。

### 6.3 颜色角色

| 分组   | 角色                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 背景   | --rc-bg-base --rc-bg-surface --rc-bg-raised --rc-bg-sunken --rc-bg-inverse --rc-bg-scrim                                        |
| 文字   | --rc-text-primary --rc-text-secondary --rc-text-tertiary --rc-text-disabled --rc-text-on-brand --rc-text-inverse --rc-text-link |
| 边框   | --rc-border-subtle --rc-border-default --rc-border-strong --rc-border-focus                                                     |
| 品牌   | --rc-brand-base --rc-brand-hover --rc-brand-active --rc-brand-soft --rc-brand-on-soft                                           |
| 状态   | --rc-{success,warning,danger,info}-base / -soft / -on-soft                                                                      |
| 状态层 | --rc-state-hover --rc-state-focus --rc-state-pressed --rc-state-drag（透明度数值）                                              |

### 6.4 形状 / 间距 / 字体 / 动效

| 分组 | 角色                                                                                      |
| ---- | ----------------------------------------------------------------------------------------- |
| 圆角 | --rc-radius-none -xs -sm -md -lg -xl -full                                                |
| 间距 | --rc-space-0 … --rc-space-12（4dp 网格）                                                  |
| 阴影 | --rc-elevation-0 … --rc-elevation-5                                                       |
| 字体 | --rc-font-sans --rc-font-mono --rc-font-display                                           |
| 字号 | --rc-text-display -headline -title -body -label（各含 size / line-height / weight）       |
| 动效 | --rc-duration-short -medium -long；--rc-ease-standard -emphasized -decelerate -accelerate |
| 布局 | --rc-editor-max-width --rc-gutter-width --rc-tab-height --rc-dock-width                   |

### 6.5 色彩格式：OKLCH 三通道

统一存 **`L C H` 三通道**：

```css
:root {
  --rc-brand-base: 0.55 0.18 264;
  --rc-bg-surface: 0.98 0.01 300;
}

/* 使用 */
color: oklch(var(--rc-brand-base));
background: oklch(var(--rc-brand-base) / 0.5);
```

**为什么不是 RGB：**

| 维度         | RGB 三通道                 | OKLCH 三通道                        |
| ------------ | -------------------------- | ----------------------------------- |
| 感知均匀性   | 差（同亮度差在暗处更明显） | 好（L 通道线性感知）                |
| 色阶生成     | 需在 HSL/Lab 空间转换      | 直接调 L 即可得到自然色阶           |
| 状态色派生   | 提亮/压暗会偏色            | 只改 L，色相不变                    |
| 与生态一致   | shadcn v3                  | shadcn v4、Tailwind v4、M3 HCT 同源 |
| 透明度工具类 | `bg-brand/50` ✅           | `bg-brand/50` ✅（已实测）          |

**实测确认**（UnoCSS 66.12）：

```css
/* uno.config.ts: colors: { brand: 'oklch(var(--rc-brand-base) / <alpha-value>)' } */
.bg-brand/50 { background-color: oklch(var(--rc-brand-base) / 0.5); }
.text-surface/25 { color: oklch(var(--rc-bg-surface) / 0.25); }
```

生成结果正确，`<alpha-value>` 在 oklch 下同样有效。

**兼容性**：思源 3.8.9 内嵌 Chromium 156，实测支持 `oklch()`、`color-mix()`、`light-dark()`、相对颜色语法，无兼容风险。

**约定：**

- 三通道变量只存数值，不带单位/函数（`0.55 0.18 264`，不是 `oklch(0.55 0.18 264)`）；
- 中性色 C 值接近 0，仍保留三通道格式以统一处理；
- 需要 fallback 时在语义层写 `color: oklch(var(--x))` 而非硬编码 RGB。

## 7. 插件契约

### 7.1 契约包的维护方式（过渡 → 正式）

两个仓库（主题 / 插件）互相独立，契约必须有一个可版本化的载体。分两阶段：

| 阶段               | 方式                                                             | 说明                             |
| ------------------ | ---------------------------------------------------------------- | -------------------------------- |
| **过渡（当前）**   | 主题仓库 `contract/tokens.json`，插件仓库用 `file:` 依赖本地路径 | 开发期无需发包，改契约立即生效   |
| **正式（稳定后）** | 发布 `@rem-craft/contract` 到 npm                                | 有语义化版本，插件可声明兼容范围 |

契约包内容（刻意保持极小）：

```
contract/
  tokens.json     # 角色清单 + 版本号 + 各体系映射表
  index.d.ts      # 角色名类型（可选）
  package.json
```

`tokens.json` 结构：

```json
{
  "contractVersion": 1,
  "colorRoles": ["brand-base", "bg-surface", "text-primary", "…"],
  "scaleRoles": ["brand", "neutral", "neutral-variant", "success", "…"],
  "shapeRoles": ["radius-md", "elevation-2", "space-4", "…"],
  "paletteMap": { "material": { "brand-base": "primary", "…": "…" } },
  "m3ToneToScale": { "95": 50, "90": 100, "…": "…" }
}
```

**为什么不用 git submodule / monorepo：**

| 方案          | 问题                                                         |
| ------------- | ------------------------------------------------------------ |
| monorepo      | 思源市场要求「一个仓库一个 package.zip」，主题和插件必须分仓 |
| git submodule | 更新繁琐，CI 里容易忘记 `--recursive`                        |
| 复制文件      | 手工同步，必然漂移                                           |
| **npm 包**    | 唯一有版本、可追溯、无需 submodule 的通道                    |

### 7.2 属性（写在 `<html>`）

| 属性                | 取值                                 | 缺省行为                  |
| ------------------- | ------------------------------------ | ------------------------- |
| `data-rc-style`     | `material` / `fluent` / `shadcn` / … | 缺失 = `material`         |
| `data-rc-palette`   | `material` / `fluent` / `shadcn` / … | 缺失 = `material`         |
| `data-rc-custom`    | `on`                                 | 插件动态配色生效标记      |
| `data-rc-<feature>` | `on` / `off`                         | 缺失 = 使用该功能的默认值 |

复用思源原生属性，不重复发明：

| 原生属性          | 用途                                     |
| ----------------- | ---------------------------------------- |
| `data-theme-mode` | `light` / `dark`                         |
| `data-ui-density` | `compact` / 其它                         |
| `data-frontend`   | `desktop` / `mobile` / `browser-desktop` |
| `custom-rc-*`     | 文档级 / 块级属性（属性面板可编辑）      |

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
  ├─ 水波纹：监听 pointerdown → 写 --ripple-x/y + 触发动画类
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

插件写内联变量时必须同时设置 `data-rc-custom="on"`，切回内置配色时清空内联变量并移除该属性。

---

## 8. 能力边界与功能开关

### 8.1 能力边界（诚实版）

| 能力                              | 支持         | 机制                                         |
| --------------------------------- | ------------ | -------------------------------------------- |
| 运行时切换配色                    | ✅           | `data-rc-palette`                            |
| 运行时切换组件风格                | ✅           | `data-rc-style`（多套配方全量打包）          |
| 自定义种子色生成配色              | ✅（需插件） | 插件写内联变量                               |
| 亮/暗模式                         | ✅           | `data-theme-mode`                            |
| 紧凑密度                          | ✅           | `data-ui-density`                            |
| 功能开关                          | ✅           | `data-rc-<feature>`                          |
| 文档级样式（宽屏等）              | ✅           | `custom-rc-*`                                |
| 移动端布局适配                    | ✅           | `data-frontend='mobile'`                     |
| **Material 水波纹**               | ✅（需插件） | 插件监听 `pointerdown` 写坐标变量 + CSS 动画 |
| 无插件时的多风格切换              | ❌           | 无 JS 无法写属性；用户可用代码片段           |
| 完整 M3 motion 编排（容器变换等） | ⚠️           | CSS 只能对属性变化加 transition              |
| Cupertino（Apple）风格            | ❌ 暂缓      | 无官方 Web 参考，只能照 HIG 手写             |

### 8.2 功能开关（`data-rc-<feature>`）

**注意：这是功能开关，不是区域开关。** 每个开关对应一段可独立启用的功能样式，默认值由主题决定。

约定：

- 属性值 `on` / `off`；缺失时使用主题默认；
- 由插件设置面板控制（写入 `<html>`），或用文档级属性 `custom-rc-<feature>` 按文档生效；
- 主题侧统一用 `:root:not([data-rc-<feature>='off'])` 或 `:root[data-rc-<feature>='on']` 表达。

当前已定清单（后续可增补）：

| 功能       | 属性                     | 默认 | 作用                            |
| ---------- | ------------------------ | ---- | ------------------------------- |
| 专注模式   | `data-rc-focus-mode`     | off  | 隐藏侧栏与 dock，编辑区居中     |
| 宽屏编辑   | `data-rc-wide-editor`    | off  | 解除编辑区最大宽度限制          |
| 块聚焦高亮 | `data-rc-block-focus`    | on   | 当前编辑块加背景/描边           |
| 链接下划线 | `data-rc-link-underline` | on   | 正文链接显示下划线              |
| 标题锚点   | `data-rc-heading-anchor` | on   | hover 标题时显示锚点标记        |
| 列表紧凑   | `data-rc-list-tight`     | off  | 收紧列表项行距                  |
| 行号       | `data-rc-line-numbers`   | off  | 代码块显示行号                  |
| 水波纹     | `data-rc-ripple`         | on   | 按钮/菜单项的点击反馈（需插件） |
| 动效降级   | `data-rc-reduce-motion`  | off  | 关闭所有过渡与动画              |

> 清单尚未定稿，先按此结构实现，后续增补不改架构。

### 8.3 移动端策略

**不单独做移动端风格**，而是在同一套风格内做布局适配：

| 做法                    | 说明                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `variants/mobile.css`   | `:root[data-frontend='mobile']` 下的间距、字号、触摸目标调整 |
| 触摸目标 ≥ 44px         | `--rc-touch-min: 44px`，移动端覆盖                           |
| 不新增 `styles/mobile/` | 避免每套风格都维护两份                                       |

理由：思源移动端 DOM 与桌面差异大，但**设计语言应保持一致**；Material 本身就是响应式体系，用同一套令牌 + 尺寸适配即可，不需要第二套配方。

若将来移动端差异确实过大，再评估是否拆独立风格目录。

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

1. 需要元素有 `position: relative; overflow: hidden`（主题侧给宿主加 `.rc-ripple-host` 或用现有类）；
2. 无法复刻 M3 精确的扩散曲线与多段淡出，视觉近似；
3. 关闭方式：`data-rc-ripple='off'` 时不触发。

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

| 决策      | 取值                                |
| --------- | ----------------------------------- |
| 输出      | 单文件 theme.css                    |
| 体积预算  | < 120 KB（思源 base.css 为 585 KB） |
| sourcemap | 关闭                                |
| 压缩      | 默认                                |
| @layer    | **禁用**                            |

---

## 10. 测试

## 11. 从零实施顺序

| 步骤 | 内容                                                                   | 验收                      |
| ---- | ---------------------------------------------------------------------- | ------------------------- |
| 1    | 清空 `src/styles/`，建立新目录骨架                                     | `pnpm build` 产出空壳 CSS |
| 2    | `foundation/scale.css` + `semantic.css` + `bridge.css`（OKLCH 三通道） | 变量在页面上可读          |
| 3    | `contract/tokens.json` + 契约守卫测试 A6/A10                           | 测试能拦住缺角色          |
| 4    | `palettes/material.css`                                                | 默认配色生效              |
| 5    | `base/skeleton.css`（含 `.rc-ripple` 预留）                            | 基础布局正确              |
| 6    | `styles/material/`（按区域逐个）                                       | 默认风格完整              |
| 7    | `variants/`（dark / density / mobile / features / document）           | 变体生效                  |
| 8    | 测试 A1–A10 全绿                                                       | `pnpm check` 通过         |
| 9    | `scripts/palette/m3-to-scale.mjs` + 生成脚本                           | 种子色可生成配色          |
| 10   | `palettes/shadcn.css` + `styles/shadcn/`                               | 切换验证                  |
| 11   | `palettes/fluent.css` + `styles/fluent/`                               | 切换验证                  |
| 12   | 文档与体积复核                                                         | 预算内                    |

---

## 12. 已定决策

| 议题           | 决策                                                        |
| -------------- | ----------------------------------------------------------- |
| Cupertino 风格 | 暂缓（无官方 Web 参考，只有 HIG 文档）                      |
| 刻度层         | Tailwind 11 阶（50–950）；M3 种子色通过 tone→阶映射接入     |
| 语义层         | 参考 M3 的「配对」思路，命名自研（`soft` 而非 `container`） |
| 色彩格式       | **OKLCH 三通道**（已实测 UnoCSS 透明度工具类可用）          |
| 移动端         | 不单独做风格，用 `variants/mobile.css` 布局适配             |
| 功能开关       | 见 §8.2，清单未定稿，结构先落地                             |
| 插件契约       | 过渡期 `file:` 本地依赖，稳定后发 `@rem-craft/contract`     |
| 水波纹         | 插件实现（pointerdown + CSS 动画），主题侧预留              |

---

## 13. 待补充

1. 功能开关清单（§8.2）尚未定稿，后续增补。
2. `contract/tokens.json` 的完整角色清单需在步骤 3 时逐项确认。
3. 是否引入 `cupertino` 风格，等前几套稳定后再评估。
