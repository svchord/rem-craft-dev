# Rem Craft 主题架构设计

> 目标：一个主题包，内置多套设计系统风格，运行时切换。
> 产物：`theme.css` + `theme.json`（+ 清单声明的 icon / preview），**产物内不允许任何 JS**。
> 当前范围：只做 Material。M3 设计层 token 全量复刻，弃用 token 不落地但逐条标注。

## 版本锚点

| 对象             | 锚点                                                          | 取值                                        |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------- |
| Material 3 token | `material-components/material-web` → `tokens/versions/latest` | **34.0.21**                                 |
| MWC 组件库       | `@material/web`                                               | **2.5.0**（维护模式，token 流水线仍在更新） |
| 思源             | `siyuan-note/siyuan`                                          | **v3.8.10**                                 |
| MCU              | `@material/material-color-utilities`                          | **0.4.0**                                   |

`tokens/versions/latest/sass/_index.scss` 共 194 个 `@forward`：组件层 179 个，设计层 15 个（`md-ref-*` 2 + `md-sys-*` 13）。**本项目只复刻设计层。**

---

## 1. 架构总览

### 1.1 四层

| 层           | 命名空间                                                          | 内容                                                         | 谁消费                               |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| **原料层**   | `--md-ref-palette-*` / `--md-ref-typeface-*`（**M3 原名，不改**） | 239 + 5 条                                                   | 只有 `sys-*` 与 `derived.scss`       |
| **契约层**   | `--rc-*`（简化名）                                                | `sys-*` 843 条 + 派生 12 角色（24 条）+ 静态标注 18 个唯一名 | 组件、`bridge.scss`、`uno.config.ts` |
| **项目扩展** | `--rc-*`                                                          | `space-*` 5 + `size-*` 4 + `shadow-*` 6                      | 组件                                 |
| **桥接层**   | `--b3-*`                                                          | 137 条颜色声明                                               | 思源原生 UI                          |

### 1.2 数据流

```
M3 ref-palette (239) / ref-typeface (5)        --md-ref-*    原料层
        ↓ 只有 sys-* 与 derived.scss 可引用
M3 sys-* (843 条) + 派生 (24 条) + 标注 (18 个唯一名)  --rc-*   契约层
        ↓ 只有 bridge 与组件可引用
bridge.scss (137 条 → 49 个目标)                --b3-*        桥接层
        ↓
components
```

### 1.3 核心规则

| #   | 规则                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 依赖严格单向：ref → sys → bridge / UnoCSS theme → components，禁止反向引用。                                  |
| 2   | M3 设计层全量复刻：非弃用 token 一条不少、取值照抄；变量名可简化，但必须 1:1 双射（不合并、不拆分、不丢弃）。 |
| 3   | Token 存完整颜色值；透明度统一用 `color-mix()`；组件不出现字面色值。                                          |
| 4   | 明暗由 token 自动切换，不是变体；风格、密度、平台是变体。                                                     |
| 5   | 思源内置主题的 **185** 个 `--b3-*` 中，**147 个颜色语义变量全量接管**。                                       |
| 6   | 产物无 JS；插件只写属性与注入 palette，不参与渲染。                                                           |
| 7   | UnoCSS 只做构建期 CSS 生成器：`@apply` 展开进组件选择器，产物是普通 CSS。                                     |
| 8   | 当前只实现 Material；Fluent、shadcn 只保留目录与覆盖入口。                                                    |

---

## 2. 目录与分层

### 2.1 两层定义与依赖

| 层           | 内容     | 选择器形态                   |
| ------------ | -------- | ---------------------------- |
| `tokens`     | 全部变量 | 只有 `:root` / `:root[attr]` |
| `components` | 全部样式 | 组件选择器 + 变体链          |

「层」只表示覆盖顺序，判断标准是写变量还是写选择器。`foundation/` 只放 UnoCSS 基线变量（§8.2），不是设计层。

**依赖方向：**

| 文件                     | 可以引用                                                        | 禁止引用                             |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------ |
| `tokens/material/*.scss` | `@material/web` 包内 `tokens/versions/latest/sass` 的 Sass 变量 | 任何 `--b3-*`、组件类名              |
| `tokens/derived.scss`    | `--md-ref-palette-*` 的 static 档位、`sys-color`                | `--b3-*`、组件类名                   |
| `tokens/bridge.scss`     | `--rc-*`（sys 角色 / 派生角色 / 静态标注 token）                | `--md-ref-*`、定义新角色             |
| `components/*.scss`      | 短工具类                                                        | 字面色值、`var(--rc-*)`、`--b3-ui-*` |

`bridge.scss` 是唯一允许定义 `--b3-*` 的文件。

### 2.2 目录

```
node_modules/@material/web/tokens/versions/latest/sass/   11 个官方 SCSS（devDependency，不复制进仓库）
  _md-ref-palette.scss  _md-ref-typeface.scss
  _md-sys-color.scss  _md-sys-color__dark.scss
  _md-sys-shape.scss  _md-sys-elevation.scss  _md-sys-motion.scss
  _md-sys-state.scss  _md-sys-state-focus-indicator.scss
  _md-sys-typescale.scss  _md-sys-typescale-emphasized.scss
  版本 34.0.21（各文件头 "Version:" 注释），由 @material/web@2.5.0 精确锁定

src/
├── theme.scss                唯一入口，只有 @use
├── foundation/
│   └── _un-baseline.scss     9 条 UnoCSS 基线变量（§8.2）
├── tokens/
│   ├── material/_index.scss  严格复刻 M3 设计层：843 条 --rc-*（按族生成）
│   ├── derived.scss          12 派生 + 18 静态标注 + 6 阴影配方
│   ├── _extend.scss          项目扩展 space-* / size-*
│   ├── bridge.scss           137 条 --b3-*（手写）
│   └── fluent/  shadcn/      预留
└── components/
    menu.scss  dialog.scss  dock.scss  editor.scss  tree.scss  mobile.scss
```

`theme.scss` 的 `@use` 顺序固定：**foundation → tokens（material → derived）→ bridge → components**。

### 2.3 当前实际状态

Token 层（实施顺序第 1–7 步）与桥接层（第 8 步）已落地，组件层尚未开始：

| 文件                               | 状态      | 内容                                                                                     |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `src/theme.scss`                   | ✅ 已落地 | 唯一入口，只有 `@use`：foundation → material → derived → extend → bridge → fluent/shadcn |
| `src/foundation/_un-baseline.scss` | ✅ 已落地 | 9 条 `--un-*` 基线变量（§8.2）                                                           |
| `src/tokens/material/_index.scss`  | ✅ 已落地 | `meta.module-variables()` 生成 843 条声明 / 795 唯一名，弃用 6 条剔除                    |
| `src/tokens/derived.scss`          | ✅ 已落地 | 12 派生角色 × 亮暗（24 条）+ 18 静态标注 + 6 阴影配方                                    |
| `src/tokens/_extend.scss`          | ✅ 已落地 | 项目扩展 `space-*` 5 + `size-*` 4                                                        |
| `src/tokens/bridge.scss`           | ✅ 已落地 | 137 条 `--b3-*`，映射到 49 个目标，alpha 全用 `color-mix()`                              |
| `src/tokens/fluent/_index.scss`    | ✅ 空壳   | `:root[data-rc-style='fluent']` 覆盖入口                                                 |
| `src/tokens/shadcn/_index.scss`    | ✅ 空壳   | `:root[data-rc-style='shadcn']` 覆盖入口                                                 |
| `src/components/`                  | 🟡 初版   | menu / dialog / dock 三个基础组件                                                        |
| `@material/web`（devDependency）   | ✅ 已引入 | **2.5.0 精确锁定**（`"@material/web": "2.5.0"`，无 `^`）；内置 token 34.0.21             |

旧文件已按计划处理：`src/theme.css` 改名重写为 `theme.scss`，`src/foundation/semantic.css` 与 `tests/theme-entry.test.ts` 一并删除。`--rc-contract-version` 已从架构中移除：插件不读它，`vite-plugin-siyuan` 不读它，唯一引用它的旧测试已删除。

产物现状：`dist/theme.css` 46.2 kB（gzip 6.4 kB），1046 条声明 / 986 唯一名，无 JS、无 `@layer`。`pnpm check` 全绿（64 个测试）。

官方 token 不再复制进仓库：`@material/web` 以 **精确版本 2.5.0** 挂在 devDependencies，`src/tokens/material/` 下各族文件直接 `@use` 包内的 `tokens/versions/latest/sass/*`。Vite 能解析裸包名；测试里的 `sass.compile()` 需要显式 `loadPaths: [node_modules]`（已写进 `tests/tokens.test.ts` 与 `tests/components.test.ts`）。

---

## 3. Token 体系

### 3.1 全景与落地

| 族              | 官方文件                    | 官方条数 | 弃用                        | 落地    | 说明                                                         |
| --------------- | --------------------------- | -------- | --------------------------- | ------- | ------------------------------------------------------------ |
| 颜色·色阶       | `ref-palette`               | 239      | 0                           | **239** | 无语义原始色阶，`--md-ref-palette-*`                         |
| 颜色·语义（亮） | `sys-color`                 | 50       | 2                           | **48**  | 背景 / 文字 / 边框 / 品牌                                    |
| 颜色·语义（暗） | `sys-color__dark`           | 50       | 2                           | **48**  | 与亮色同键同序                                               |
| 排版·字族       | `ref-typeface`              | 5        | 0                           | **5**   | brand / plain / weight-bold / weight-medium / weight-regular |
| 排版·字号       | `sys-typescale`             | 213      | 3                           | **210** | 15 层级 × 14 属性                                            |
| 排版·强调       | `sys-typescale-emphasized`  | 210      | 0                           | **210** | 仅 `weight` / `wght` 更重                                    |
| 形状            | `sys-shape`                 | 24       | 0                           | **24**  | 9 个 `corner-value-*` + 15 个 `corner.*`                     |
| 高度            | `sys-elevation`             | 7        | 1                           | **6**   | level0–5 = 0/1/3/6/8/12 px（dp）                             |
| 动效            | `sys-motion`                | 45       | 0                           | **45**  | 16 时长 + 10 曲线 + 18 spring + 1 path                       |
| 状态            | `sys-state`                 | 5        | 0                           | **5**   | hover / focus / pressed / dragged / disabled                 |
| 状态·焦点       | `sys-state-focus-indicator` | 3        | 0                           | **3**   | inner-offset / outer-offset / thickness                      |
| **合计**        |                             | **1051** | **16 处（6 个唯一 token）** | **843** | 843 条声明 / **795 个唯一变量名**                            |

产物另加派生状态色 **24** 条 + 静态标注色 **22** 条 + 阴影配方 **6** 条 = **895 条声明**。

**不启用**：4 个对比度变体文件（light/dark × medium/high，各 50 条，共 200 条）。思源没有对比度开关；MCU 的 `DynamicScheme` 有 `contrastLevel` 参数可运行时生成（§10.4）。将来需要时按 `:root[data-rc-contrast='high']` 追加，不改架构。

> M3 设计层没有第 7 个族——没有「间距」「密度」「z-index」「图标尺寸」，它们要么在 comp 层，要么是项目自建（§4.3 的 `space-*` / `size-*`）。

### 3.2 `ref-palette` 的 239 条

| 色族                                                        | 档位                                                                  | 条数    |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| black / white                                               | —                                                                     | 2       |
| primary / secondary / tertiary / error                      | 0,10,20,30,40,50,60,70,80,90,95,98,99（error 另有 100）               | 56      |
| neutral                                                     | 0,4,6,10,12,17,20,22,24,30,40,50,60,70,80,87,90,92,94,95,96,98,99,100 | 24      |
| neutral-variant                                             | 0,10,20,30,40,50,60,70,80,90,95,98,99,100                             | 14      |
| blue / cyan / green / orange / pink / purple / red / yellow | 0,10,20,30,40,50,60,70,80,90,95,98,100                                | 104     |
| blue-variant / grey / grey-variant                          | 0,10,20,30,40,50,60,70,80,90,95,98,100                                | 39      |
| **合计**                                                    |                                                                       | **239** |

19 个色族分两类：

| 类别           | 色族                                                                                                             | 被 `sys-color` 引用 | 消费者             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| **动态**（6）  | primary / secondary / tertiary / neutral / neutral-variant / error                                               | ✅ 49 个 tone       | 插件莫奈覆盖       |
| **静态**（13） | blue / cyan / green / orange / pink / purple / red / yellow / grey / grey-variant / blue-variant / black / white | ❌ 一个都不引用     | 派生色、静态标注色 |

静态色族必须全量落地：派生色需要 container 对（`green90`/`green10` 等），标注色需要 7 个色族 × 2 档，缺档位则无源可引。静态色族不参与莫奈覆盖。

### 3.3 `sys-color` 的 48 条

```
background, on-background, surface, on-surface, surface-variant, on-surface-variant,
surface-dim, surface-bright,
surface-container-lowest, surface-container-low, surface-container,
surface-container-high, surface-container-highest,
inverse-surface, inverse-on-surface,
outline, outline-variant, shadow, scrim,
primary, on-primary, primary-container, on-primary-container, inverse-primary,
primary-fixed, primary-fixed-dim, on-primary-fixed, on-primary-fixed-variant,
secondary, on-secondary, secondary-container, on-secondary-container,
secondary-fixed, secondary-fixed-dim, on-secondary-fixed, on-secondary-fixed-variant,
tertiary, on-tertiary, tertiary-container, on-tertiary-container,
tertiary-fixed, tertiary-fixed-dim, on-tertiary-fixed, on-tertiary-fixed-variant,
error, on-error, error-container, on-error-container
```

亮色、暗色、4 个对比度变体文件里这 50 个键**顺序完全一致**，可按位置断言（B20）。

### 3.4 排版（420 条）

15 个层级（5 类 × 3 档）：

| 层级              | 字号             | 行高           | 字重（常规 / 强调） | 字族  | 用途        |
| ----------------- | ---------------- | -------------- | ------------------- | ----- | ----------- |
| `display-large`   | 3.5625rem (57px) | 4rem (64px)    | 400 / 500           | brand | 超大标题    |
| `display-medium`  | 2.8125rem (45px) | 3.25rem (52px) | 400 / 500           | brand |             |
| `display-small`   | 2.25rem (36px)   | 2.75rem (44px) | 400 / 500           | brand |             |
| `headline-large`  | 2rem (32px)      | 2.5rem (40px)  | 400 / 500           | brand | 页面标题    |
| `headline-medium` | 1.75rem (28px)   | 2.25rem (36px) | 400 / 500           | brand |             |
| `headline-small`  | 1.5rem (24px)    | 2rem (32px)    | 400 / 500           | brand |             |
| `title-large`     | 1.375rem (22px)  | 1.75rem (28px) | 400 / 500           | brand | 卡片标题    |
| `title-medium`    | 1rem (16px)      | 1.5rem (24px)  | 500 / 700           | plain |             |
| `title-small`     | 0.875rem (14px)  | 1.25rem (20px) | 500 / 700           | plain |             |
| `body-large`      | 1rem (16px)      | 1.5rem (24px)  | 400 / 500           | plain | **正文**    |
| `body-medium`     | 0.875rem (14px)  | 1.25rem (20px) | 400 / 500           | plain |             |
| `body-small`      | 0.75rem (12px)   | 1rem (16px)    | 400 / 500           | plain |             |
| `label-large`     | 0.875rem (14px)  | 1.25rem (20px) | 500 / 700           | plain | 按钮 / 标签 |
| `label-medium`    | 0.75rem (12px)   | 1rem (16px)    | 500 / 700           | plain |             |
| `label-small`     | 0.6875rem (11px) | 1rem (16px)    | 500 / 700           | plain |             |

14 个属性：`size`、`line-height`、`weight`、`font`、`tracking`（思源实际消费这 5 个）+ `wght`、`opsz`、`slnt`、`wdth`、`crsv`、`fill`、`grad`、`hexp`、`rond`（可变字体轴 9 个，照抄不消费）。

**emphasized 与常规版的唯一差别**：15 个层级的 `weight` / `wght` 各提高一档（400→500、500→700），其余 12 个属性完全相同。

### 3.5 形状 / 高度 / 动效 / 状态

**形状 24 条**，分两组，数值重复但必须各自独立成变量：

| 组               | 条数 | 取值                                                                                    |
| ---------------- | ---- | --------------------------------------------------------------------------------------- |
| `corner-value-*` | 9    | none 0 / xs 4 / sm 8 / md 12 / lg 16 / lg-inc 20 / xl 28 / xl-inc 32 / xxl 48           |
| `corner.*`       | 15   | 上述 9 个 + `corner-full` 9999px + `corner-{xs,lg,xl}-top` + `corner-large-{start,end}` |

**高度 6 条**：level0–5 = 0 / 1 / 3 / 6 / 8 / 12 px。第 7 条 `surface-tint-color` 已弃用。

**动效 45 条：**

| 类别   | 条数 | 取值                                                                                                                                                                        |
| ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 时长   | 16   | short1–4（50/100/150/200ms）、medium1–4（250/300/350/400ms）、long1–4（450/500/550/600ms）、extra-long1–4（700/800/900/1000ms）                                             |
| 曲线   | 10   | standard / standard-accelerate / standard-decelerate / emphasized / emphasized-accelerate / emphasized-decelerate / legacy / legacy-accelerate / legacy-decelerate / linear |
| spring | 18   | default / fast / slow × spatial / effects，各含 damping 与 stiffness                                                                                                        |
| path   | 1    | 官方值 `null`（类型不支持），照抄                                                                                                                                           |

`easing-emphasized` 官方直接等于 `easing-standard`，不是笔误。

**状态 8 条**：hover 0.08 / focus 0.1 / pressed 0.1 / dragged 0.16 / disabled 0.38；焦点环 inner-offset -3px / outer-offset 2px / thickness 3px。

### 3.6 弃用 token（6 个）

官方设计层共 **6 个唯一 token** 带 `@deprecated`，源码里实际 **16 处**标注（颜色类在 6 个文件中重复）。

| #   | 文件                       | Token                           | 官方说明                    | 替代方案                                   |
| --- | -------------------------- | ------------------------------- | --------------------------- | ------------------------------------------ |
| 1   | `md-sys-color`（6 处）     | `surface-tint`                  | 已被 tonal surface 色系取代 | 无直接替代；层次用 `surface-container-*`   |
| 2   | `md-sys-color`（6 处）     | `surface-tint-color`            | 请替换为 `surface-tint`     | `surface-tint`（同样已弃用）               |
| 3   | `md-sys-elevation`（1 处） | `surface-tint-color`            | 已移到 `*.color.*`          | 同上                                       |
| 4   | `md-sys-typescale`（1 处） | `label-medium-text-transform`   | Token 已弃用                | 无                                         |
| 5   | `md-sys-typescale`（1 处） | `label-large-weight-prominent`  | 改用 emphasized             | `typescale-emphasized.label-large-weight`  |
| 6   | `md-sys-typescale`（1 处） | `label-medium-weight-prominent` | 改用 emphasized             | `typescale-emphasized.label-medium-weight` |

**标注要求（强制）：**

1. 每个 token 文件头部必须有 `/* 弃用：<token>（官方 @deprecated）→ <替代方案>。本项目不落地。 */` 形式的注释。
2. `bridge.scss` 与 `material/` 下所有文件禁止出现这 6 个名字；B17 断言产物中不存在。
3. 官方恢复/改名时按新名追加，不复用旧名。
4. 「弃用但无替代」也要写明「无替代」，不能留空。

> `surface-tint` 弃用是规范级变化：M3 暗色层次已改由 `surface-container-*` 的亮度差表达。

---

## 4. 命名与生成

### 4.1 命名规则：`--rc-<族>-<官方变量名原样>`

| 官方 Sass 变量                      | 项目变量                         | 规则                           |
| ----------------------------------- | -------------------------------- | ------------------------------ |
| `$md-ref-palette.primary40`         | `--md-ref-palette-primary40`     | **不改名**，只把 `$` 换成 `--` |
| `$md-ref-typeface.weight-bold`      | `--md-ref-typeface-weight-bold`  | **不改名**                     |
| `$md-sys-color.on-surface-variant`  | `--rc-color-on-surface-variant`  | 去 `md-sys-`，加 `--rc-`       |
| `$md-sys-shape.corner-value-medium` | `--rc-shape-corner-value-medium` | 去 `md-sys-`，其余保留         |
| `$md-sys-shape.corner-medium`       | `--rc-shape-corner-medium`       | **必须与上一行是两个不同变量** |
| `$md-sys-elevation.level2`          | `--rc-elevation-level2`          | 去 `md-sys-`                   |
| `$md-sys-motion.duration-short2`    | `--rc-motion-duration-short2`    | 去 `md-sys-`                   |
| `$md-sys-typescale.body-large-size` | `--rc-typescale-body-large-size` | 去 `md-sys-`                   |

**1:1 双射**：每个官方 token 恰好对应一个项目变量，反之亦然。禁止合并、拆分、丢弃；取值与官方向量一字不改。

`corner-value-medium` 与 `corner-medium` 数值相同但是两个官方 token，Sass 遍历会各自产出一个变量。

### 4.2 生成机制

```scss
// src/tokens/material/_index.scss
@use 'sass:list';
@use 'sass:meta';

$deprecated:
  'surface-tint', 'surface-tint-color', 'label-medium-text-transform', 'label-large-weight-prominent',
  'label-medium-weight-prominent';

@mixin emit($module, $prefix) {
  @each $name, $value in meta.module-variables($module) {
    @if not list.index($deprecated, $name) {
      --#{$prefix}-#{$name}: #{$value};
    }
  }
}

:root {
  @include emit('ref-palette', 'md-ref-palette');
  @include emit('ref-typeface', 'md-ref-typeface');
}

:root {
  @include emit('sys-color', 'rc-color');
  @include emit('sys-shape', 'rc-shape');
  @include emit('sys-elevation', 'rc-elevation');
  @include emit('sys-motion', 'rc-motion');
  @include emit('sys-state', 'rc-state');
  @include emit('sys-focus', 'rc-state-focus-indicator');
  @include emit('typescale', 'rc-typescale');
  @include emit('typescale-emphasized', 'rc-typescale-emphasized');
}

:root[data-theme-mode='dark'] {
  @include emit('sys-color-dark', 'rc-color');
}
```

实测产出 843 条，与 §3.1 的逐文件计数一致。

### 4.3 契约层 `--rc-*` 全表

| 分组          | 契约名（均带 `--rc-` 前缀）                                                                      | 数量      |
| ------------- | ------------------------------------------------------------------------------------------------ | --------- |
| 颜色          | `color-background`、`color-surface`、`color-on-surface`、`color-primary` …                       | 48 × 亮暗 |
| 圆角          | `shape-corner-value-none` … `shape-corner-full`                                                  | 24        |
| 高度          | `elevation-level0` … `elevation-level5`（dp 数值）                                               | 6         |
| 动效          | `motion-duration-*`、`motion-easing-*`、`motion-spring-*`、`motion-path`                         | 45        |
| 状态          | `state-hover-state-layer-opacity` … `state-disabled-state-layer-opacity`                         | 5         |
| 焦点环        | `state-focus-indicator-inner-offset` / `-outer-offset` / `-thickness`                            | 3         |
| 字号          | `typescale-body-large-size` / `-line-height` / `-weight` …                                       | 210       |
| 强调字号      | `typescale-emphasized-body-large-size` …                                                         | 210       |
| 派生状态色    | `success` / `on-success` / `success-container` / `on-success-container` × success、warning、info | 12        |
| 静态标注色    | `static-{red,orange,yellow,green,pink,blue,purple,cyan}-{40,90,30,80}`                           | 22        |
| 项目扩展·间距 | `space-xs` / `sm` / `md` / `lg` / `xl`                                                           | 5         |
| 项目扩展·尺寸 | `size-row` / `size-control` / `size-dock` / `size-panel`                                         | 4         |
| 项目扩展·阴影 | `shadow-level0` … `shadow-level5`                                                                | 6         |

- 组件、`bridge.scss`、`uno.config.ts` 只消费 `--rc-*`，不得直接消费 `--md-ref-*`。
- 变量不得自引用，自引用会让该变量整条失效（B11）。

### 4.4 派生色与静态标注色 `derived.scss`

M3 只有 `error` 一个状态色。**danger 直接复用 M3 `error` 系列**，不新增变量；其余三个状态各 4 个角色：

| 角色                   | 亮色                 | 暗色                 |
| ---------------------- | -------------------- | -------------------- |
| `success`              | `green40` `#006c35`  | `green80` `#80da88`  |
| `on-success`           | `green100` `#fff`    | `green20` `#00381f`  |
| `success-container`    | `green90` `#beefbb`  | `green30` `#00522c`  |
| `on-success-container` | `green10` `#002110`  | `green90` `#beefbb`  |
| `warning`              | `yellow40` `#8f4e06` | `yellow80` `#fcbd00` |
| `on-warning`           | `yellow100` `#fff`   | `yellow20` `#4d2600` |
| `warning-container`    | `yellow90` `#ffe07c` | `yellow30` `#6d3a01` |
| `on-warning-container` | `yellow10` `#2f1400` | `yellow90` `#ffe07c` |
| `info`                 | `blue40` `#1157ce`   | `blue80` `#a1c9ff`   |
| `on-info`              | `blue100` `#fff`     | `blue20` `#012c6f`   |
| `info-container`       | `blue90` `#d0e4ff`   | `blue30` `#04409f`   |
| `on-info-container`    | `blue10` `#001944`   | `blue90` `#d0e4ff`   |

**12 个派生角色 × 亮暗 = 24 条声明。**

**静态标注色 18 个唯一名**（下表 22 处引用里 `green-40/-90`、`purple-40/-90` 各重复一次；CSS 同名重复声明会互相覆盖，故唯一名 18 个）：

| Token 组                                                    | 数量 | 用途                  |
| ----------------------------------------------------------- | ---- | --------------------- |
| `--rc-static-{red,orange,yellow,green,pink,blue,purple}-40` | 7    | PDF 7 种标注色        |
| `--rc-static-{red,orange,yellow,green,pink,blue,purple}-90` | 7    | 标注底色 / 行内底色   |
| `--rc-static-{cyan,green,purple}-40`                        | 3    | 图表补充色            |
| `--rc-static-{cyan,green,purple}-90`                        | 3    | 图表补充底色          |
| `--rc-static-yellow-80` / `--rc-static-green-30`            | 2    | 高亮当前项 / 暗色选区 |

**6 条阴影配方**（`--rc-shadow-level0..5`，key 30% + ambient 15%，即 `#0000004D` / `#00000026`）：

| 层级   | dp   | 配方                                              |
| ------ | ---- | ------------------------------------------------- |
| level0 | 0px  | `0 0 0 0 #0000004D, 0 0 0 0 #00000026`            |
| level1 | 1px  | `0 1px 2px 0 #0000004D, 0 1px 3px 1px #00000026`  |
| level2 | 3px  | `0 1px 2px 0 #0000004D, 0 2px 6px 2px #00000026`  |
| level3 | 6px  | `0 1px 3px 0 #0000004D, 0 4px 8px 3px #00000026`  |
| level4 | 8px  | `0 2px 3px 0 #0000004D, 0 6px 10px 4px #00000026` |
| level5 | 12px | `0 4px 4px 0 #0000004D, 0 8px 12px 6px #00000026` |

规则：只允许引用 `--md-ref-palette-*` 的 static / baseline 色阶，不得写死绝对色值，不得用相对颜色语法（B12）。三项均**不随莫奈变化**。

---

## 5. 桥接层 `bridge.scss`

### 5.1 思源的颜色事实

颜色变量定义在 `app/appearance/themes/{daylight,midnight}/theme.css`，两个内置主题各定义 **185** 个 `--b3-*`，变量名集合完全一致。`base.css` 是 webpack 产物，源码 `base.scss` 里零条 `--b3-theme-*` 颜色声明。

185 个 `--b3-*` 分类：

| 类别                                                    | 数量    | 说明                                  |
| ------------------------------------------------------- | ------- | ------------------------------------- |
| 字面色值                                                | 104     | `#` / `rgba()` / `hsl()`              |
| `var()` 转发到颜色                                      | 31      | 递归解析后仍是颜色                    |
| 颜色关键字                                              | 12      | `inherit` / `initial` / `transparent` |
| **颜色语义合计**                                        | **147** | 必须全部接管                          |
| 字体族转发                                              | 5       | `--b3-font-family*`                   |
| 非颜色（字号 / 尺寸 / 圆角 / 阴影 / 过渡 / 线宽 / URL） | 33      | 不接管                                |

### 5.2 手写 137 条 → 49 个目标

147 个槽位中 10 个是关键字值不接管，剩下 **137 条**映射到 **49 个不同目标**：

| 来源池              | 目标数 | 覆盖槽位 |
| ------------------- | ------ | -------- |
| `sys-color` 48 角色 | **24** | 约 80 个 |
| 派生状态角色        | **8**  | 约 24 个 |
| 静态标注 token      | **17** | 约 33 个 |
| **合计**            | **49** | **137**  |

**分组映射：**

| 分组                                        | 槽数 | 主来源         | 说明                                                                                                                                                       |
| ------------------------------------------- | ---- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--b3-theme-*`                              | 19   | sys 角色       | `primary` / `secondary` / `background` / `surface` / `error` / `on-*` 直接对应；`primary-light/lighter/lightest` 用 `color-mix()` 做 54% / 38% / 12% alpha |
| `--b3-card-*`                               | 8    | error + 派生   | error 用 M3 `error-container` / `on-error-container`；warning / info / success 用派生 container 对                                                         |
| `--b3-callout-*`                            | 5    | sys + 派生     | note→primary、tip→success、caution→error、important→info、warning→warning-container                                                                        |
| `--b3-font-color1..13`                      | 13   | 混合           | 1–4 状态 `on-*-container`；5–8 on-surface / primary / secondary / error；9–12 静态色族；13 background                                                      |
| `--b3-font-background1..13`                 | 13   | 混合           | 1–4 状态 `*-container`；5 surface-container；6–12 静态色族；13 on-background                                                                               |
| `--b3-pdf-*`                                | 17   | 静态标注 token | 7 种标注色 + selection + pdf-dark                                                                                                                          |
| `--b3-graph-*`                              | 22   | 静态标注 token | 15 个节点色 + 5 条线 + 2 个高亮                                                                                                                            |
| `--b3-mindmap-*-color`                      | 6    | **不接管**     | 值为 `initial`                                                                                                                                             |
| `--b3-protyle-inline-{strong,em,u,s}-color` | 4    | **不接管**     | 值为 `inherit`                                                                                                                                             |
| 其余 UI 单点                                | 40   | sys 角色       | 菜单 / 边框 / 滚动条 / 开关 / 提示气泡 / 表格斑马纹等                                                                                                      |

**三条规则：**

1. **扇入是设计，不是缺陷。** `--b3-menu-background`、`--b3-parent-background`、`--b3-embed-background` 指向同一个 `color-surface-container` 是合理的。
2. **标注色用静态 token。** PDF 7 色、graph 22 色不随莫奈变化，否则同一篇文档的标注颜色会随主题漂移。
3. **bridge 允许 `color-mix()`。** `--b3-theme-primary-light` 这类 alpha 变体没有对应 M3 token，用 `color-mix(in oklab, var(--rc-color-primary) 54%, transparent)` 生成。

---

## 6. 调色板与莫奈取色

### 6.1 链路

```css
/* ref-palette：M3 原名 */
:root {
  --md-ref-palette-primary40: #6750a4;
}

/* sys-color：引用 palette */
:root {
  --rc-color-primary: var(--md-ref-palette-primary40);
}
```

**插件只覆盖 `--md-ref-palette-*`，`--rc-color-*` 通过 `var()` 自动跟随。**

### 6.2 MCU 生成的就是 palette

`DynamicScheme` 有 6 个 `TonalPalette`（primary / secondary / tertiary / neutral / neutralVariant / error），每个都能 `.tone(t)`（t = 0–100）算出任意 tone。M3 的 `sys-color` 本就是「角色 → 某 palette 的某 tone」的静态映射表。

**实测（MCU 0.4.0，`SchemeTonalSpot`，种子 `#6750a4`）**：把 48 个 `sys-color` 按官方 tone 映射投影到 palette，与 MCU 算出的 48 个角色值 **48/48 完全一致**（亮暗都是）。所以插件只需覆盖 palette，不需要生成任何 sys 值。

### 6.3 MCU 的 palette 行为（实测）

| 变量                                        | 结果                                 |
| ------------------------------------------- | ------------------------------------ |
| `isDark` 变化时 6 个色族的 tone 值          | **完全相同**（0 处差异）             |
| `contrastLevel` 0 → 1 时 6 个色族的 tone 值 | **完全相同**（0 处差异）             |
| `contrastLevel` 0 → 1 时 48 个角色的值      | **有变化**（8 个采样里 6 个变了）    |
| `error` 色族是否随种子色变化                | **不变化**（所有种子都是 `#ba1a1a`） |

1. **palette 与明暗无关**——一个种子色只产出一套 palette，插件覆盖一次同时服务亮暗。
2. **palette 与 `contrastLevel` 无关**——变的是角色取哪个 tone，不是 tone 本身。对比度只能靠覆盖 `--rc-color-*`（不做）。
3. 全量 239 条的理由见 §3.2；对比度变体额外需要 18 个 tone，全量已覆盖。

### 6.4 插件侧契约

> 插件只写 `--md-ref-palette-<family>-<tone>`，主题保证 `--rc-color-*` 只引用这张表里的 tone。

- family：6 个动态色族（静态色族不动）；tone：主题定义了哪些就填哪些
- 覆盖选择器：`:root:root`（特异性 (0,2,0)，压过主题 `:root`）
- **不需要写亮暗两份**：palette 与 `isDark` 无关
- 派生色由插件用 HCT 从种子色生成（§10.3）

```ts
import { Hct, SchemeTonalSpot, hexFromArgb } from '@material/material-color-utilities';

const scheme = new SchemeTonalSpot(Hct.fromInt(seedArgb), false, 0);
const families = {
  primary: scheme.primaryPalette,
  secondary: scheme.secondaryPalette,
  tertiary: scheme.tertiaryPalette,
  neutral: scheme.neutralPalette,
  'neutral-variant': scheme.neutralVariantPalette,
  error: scheme.errorPalette,
} as const;

const css: string[] = [];
for (const [family, palette] of Object.entries(families)) {
  for (const tone of THEME_TONES) {
    css.push(`--md-ref-palette-${family}-${tone}: ${hexFromArgb(palette.tone(tone))};`);
  }
}
// 注入 <style>：:root:root { ...css }
```

---

## 7. 维度与变体

### 7.1 四个维度

| 维度 | 属性              | 改什么   | 实现                     |
| ---- | ----------------- | -------- | ------------------------ |
| 风格 | `data-rc-style`   | 角色取值 | 变体 `s:<style>`         |
| 明暗 | `data-theme-mode` | 颜色     | Token 自动切换，不是变体 |
| 密度 | `data-ui-density` | 组件尺寸 | 变体 `s:compact`         |
| 平台 | `data-backend`    | 组件集合 | 变体 `s:mobile`          |

配色不是独立维度：各风格的品牌词汇不同，配色天然属于风格。

### 7.2 明暗只走 Token

- 颜色全部由 `--rc-color-*` 的两份值自动切换，组件只写一次颜色工具类。
- 不允许为颜色写 `s:dark:` 变体，否则 bridge 要维护两份 137 条映射。
- `s:dark:` 只用于非 token 差异：`box-shadow` 减弱或关闭、`filter: brightness(0.9)`、`opacity: 0.9`、渐变切换、`border-width: 0`。

### 7.3 思源写入的 HTML 属性

| 属性              | 值域                                                                           | 写入方           | 备注                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------- |
| `data-theme-mode` | `light` / `dark`                                                               | `assets.ts`      | 跟随系统由 `getThemeMode()` 读 `modeOS` + `prefers-color-scheme` 计算一次 |
| `data-frontend`   | `desktop` / `desktop-window` / `mobile` / `browser-desktop` / `browser-mobile` | `functions.ts`   | 5 个值                                                                    |
| `data-backend`    | `windows` / `linux` / `darwin` / `docker` / `android` / `ios` / `harmony`      | `functions.ts`   | 7 个值                                                                    |
| `data-ui-density` | `compact` / 缺失                                                               | `compactMode.ts` | 仅 desktop / desktop-window / browser-desktop 会写                        |

`color-scheme` 已由思源 `_reset.scss` 按 `:root[data-theme-mode=…]` 声明，主题不重复声明。

### 7.4 变体清单与实现约束

| 变体               | 产物                                                                               | 用途               |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------ |
| `s:<style>:`       | `[data-rc-style="<style>"] .x`                                                     | 风格维度           |
| `s:dark:`          | `[data-theme-mode="dark"] .x`                                                      | 非颜色差异         |
| `s:compact:`       | `[data-ui-density="compact"] .x`                                                   | 紧凑尺寸           |
| `s:mobile:`        | `:is([data-backend="ios"], [data-backend="android"], [data-backend="harmony"]) .x` | 移动端             |
| `off:<flag>:`      | `:root:not([data-rc-<flag>="off"]) .x`                                             | 功能开关，默认开   |
| `on:<flag>:`       | `:root[data-rc-<flag>="on"] .x`                                                    | 功能开关，默认关   |
| `doc:<name>=<v>:`  | `[custom-rc-<name>="<v>"] .x`                                                      | 文档级，属性在祖先 |
| `self:<name>=<v>:` | `.x[custom-rc-<name>="<v>"]`                                                       | 块级，属性在自身   |

约束：

- 多个维度段可叠加（`s:dark:fluent:`）。
- 必须使用裸属性选择器，不能写 `:root[data-rc-style="fluent"]`——叠加 `dark:` 后会变成永不命中的后代选择器。
- 多值选择器必须包 `:is()`，否则第一个分支变成裸选择器，规则会应用到整个平台页面。
- 同一维度重复出现要去重。
- **Token 层不能用 `s:` 变体**，必须手写 `:root[data-*]` 属性选择器。

---

## 8. UnoCSS 集成

### 8.1 定位与配置

UnoCSS 只做构建期 CSS 生成：`@apply` 把工具类展开进组件选择器，产物是普通 CSS，无运行时，不需要给 DOM 加类名。

固定配置：`presetWind3` + `transformerDirectives` + `transformerVariantGroup`；内容扫描 `src` 下的 `.scss` / `.css` 文件。

`dark` 变体映射到思源属性（`dark: { dark: '[data-theme-mode="dark"]', light: '[data-theme-mode="light"]' }`），不使用 `.dark` 类。只能用于非颜色属性（§7.2）。

### 8.2 `--un-*` 基础变量：必须手写 9 条

**思源主题走 Vite 的 `input` 模式，不是 app 模式，UnoCSS preflight 根本不会注入。**

preflight 通过 `transformIndexHtml` 钩子注入，只有存在 `index.html` 的 app 模式才触发。`vite-plugin-siyuan` 把主题配置成 `build.rolldownOptions.input = 'src/theme.scss'`，没有 HTML 入口。

**后果**：`shadow-*` / `ring-*` 引用的 `--un-ring-offset-shadow` 等变量没有定义，`box-shadow` 整条失效。

```scss
// src/foundation/_un-baseline.scss
*,
::before,
::after {
  --un-ring-inset: ;
  --un-ring-offset-width: 0px;
  --un-ring-offset-color: #fff;
  --un-ring-width: 0px;
  --un-ring-color: #93c5fd80;
  --un-ring-offset-shadow: 0 0 #0000;
  --un-ring-shadow: 0 0 #0000;
  --un-shadow-inset: ;
  --un-shadow: 0 0 #0000;
}
```

实测：加上这 9 条后，`--un-*` 未定义引用从 3 个降到 **0 个**。

`presetWind3({ preflight: true })` 无效（那是默认值，问题在注入通道）；`@import 'uno.css'` 在 input 模式下直接报错。

这 9 条不含 `box-sizing` / `margin` 等重置——那是 Tailwind 的 preflight，且思源 `base.css` 已有自己的重置。

### 8.3 `theme` 映射与四个陷阱

| `theme` key                 | 命名空间                       | 映射来源                                                 |
| --------------------------- | ------------------------------ | -------------------------------------------------------- |
| `colors`                    | `bg-*` / `text-*` / `border-*` | 48 个 `color-*` + 12 个派生 + 22 个静态标注              |
| `borderRadius`              | `rounded-*`                    | 24 个 `shape-*`                                          |
| `spacing`                   | `p-*` / `gap-*`                | `space-xs` / `sm` / `md` / `lg` / `xl`                   |
| `height` / `width`          | `h-*` / `w-*`                  | `size-row` / `size-control` / `size-dock` / `size-panel` |
| `fontSize`                  | `text-*`                       | 15 组 `typescale-<level>-size` + line-height             |
| `lineHeight` / `fontWeight` | `leading-*` / `font-*`         | 各组 `typescale-*` 对应值                                |
| `boxShadow`                 | `shadow-*`                     | **`--rc-shadow-level*`**（不是 `elevation-*`）           |
| `duration` / `easing`       | `duration-*` / `ease-*`        | `motion-duration-*` / `motion-easing-*`                  |

**陷阱 1：`fontSize` 与 `colors` 同占 `text-*`，颜色赢。** 同名时 `text-body` 只解析成颜色，字号静默失效。约定两者键名不得重名（字号带层级：`body-large` / `label-small`）。

**陷阱 2：`borderRadius` 会被合并。** `corner-value-medium` 与 `corner-medium` 数值相同，UnoCSS 产出 `.rounded-medium, .rounded-value-medium { ... }`。变量层仍独立，但 B18 不能用工具类断言。

**陷阱 3：覆盖 `spacing` 不会关掉默认刻度。** `p-4` / `p-13` 依然有效。组件只用 `space-*` 语义名，B23 断言不出现数字刻度。

**陷阱 4：`elevation-*` 不能当 `box-shadow`。** M3 的 `sys-elevation` 是 dp 数值（`level1: 1px`），`box-shadow` 需要 x/y/blur/color。`theme.boxShadow` 必须指向 `--rc-shadow-level*`（§4.4）。

### 8.4 `color-mix()` 的使用边界

| 写法                                            | `bg-surface` | `/50` 是否生效                |
| ----------------------------------------------- | ------------ | ----------------------------- |
| `var(--rc-color-surface)`                       | 直接输出     | ❌ 静默丢弃                   |
| `color-mix(... calc(<alpha-value> * 100%) ...)` | 完整表达式   | ✅ `/8` → `calc(0.08 * 100%)` |

**`<alpha-value>` 占位符必须有**，否则 `/50` 会被丢掉。

| 需求                                     | 是否用 `color-mix()` |
| ---------------------------------------- | -------------------- |
| 纯不透明颜色                             | ❌ 裸 `var()`        |
| `bg-surface/50` 这类 alpha               | ✅                   |
| 25 个带 alpha 的思源槽位                 | ✅                   |
| M3 state layer（hover 8% / pressed 10%） | ✅                   |

`color-mix()` 支持：Chrome 111+ / Safari 16.2+ / Firefox 113+，思源 Electron 与 iOS 17 均满足。

`@apply` 实测不增加体积：单个工具类 +1 B、四工具类组合 +1 B、变体组 +2 B，压缩后归零；带 alpha 时反而比手写短 34 B。

### 8.5 不要配置 UnoCSS `layers`

`layers` 只影响 UnoCSS 自身生成选择器的排序。项目全部用 `@apply`，UnoCSS 不产出规则，配置 `layers` 没有意义。也不要开 `outputToCssLayers`——真正的 `@layer` 会被思源未分层的 `base.[contenthash].css` 压制（插件 `verify.ts` 也会报错）。

### 8.6 Sass 与 UnoCSS 的关系

Sass 管 token 层（§4.2），UnoCSS 管组件层。两者处理不同输入，**无冲突**：`@apply` 写在 `.scss` 内正常展开；Sass 变量插值 `@apply bg-#{$name}`、`&:hover` 嵌套、`@include` 混用、`@media` 内 `@apply` 均正常；Sass `//` 注释里的 `@apply` 不会被误处理。

---

## 9. 组件层

### 9.1 编写规则

- 按界面区域拆分文件，不按平台拆目录；同一组件的桌面与移动端规则放同一文件。
- 组件只写短工具类，不出现 `var(--rc-*)`，也不读 `--b3-ui-*`。
- 颜色默认由 `bridge.scss` 接管（思源原生选择器已消费 `--b3-*`）；只有实测确认 bridge 的取值不符合 M3（如 nav rail 选中态需要 secondary-container）时，组件层才用颜色工具类覆盖。
- 不得出现颜色字面量，不得重复实现派生逻辑。

### 9.2 尺寸与紧凑

- M3 的尺寸 token 在 comp 层，没有独立 metrics 层，尺寸写在 components。
- 紧凑不能用统一乘数：思源各组件的普通/紧凑比值不统一，必须逐组件给值。
- **主题不使用 `--b3-ui-*`。** 思源在 `util/_density.scss` 用 `:where(:root[data-ui-density="compact"])` 定义 31 个 `--b3-ui-*`，同时用 `:where(.protyle-wysiwyg), :where(.b3-typography)` 重置为 `initial`；思源自己消费时全部带回退值（`var(--b3-ui-menu-height, 28px)`）。普通模式下这些变量不存在，主题读了只是重复思源的默认值，还会在思源改默认值时产生隐性耦合。
- 尺寸全部走项目自己的 `--rc-size-*`，紧凑差异用 `:root[data-ui-density="compact"]` 覆盖。

---

## 10. 插件契约

### 10.1 优先级与注入规则

| 优先级 | 来源                                                               | 生效条件               |
| ------ | ------------------------------------------------------------------ | ---------------------- |
| 低     | `tokens/*.scss` 产出的 `:root`（含 `--md-ref-palette-*` 静态基线） | 没有插件时生效         |
| 中     | 预设 palette（`data-rc-palette` 属性）                             | 插件提供预设配色时生效 |
| 高     | 插件注入的 `<style>`                                               | 动态生成               |

- 必须注入 `<style>`，不能写内联变量（内联优先级高于任何选择器，切换暗色会坏）。
- 注入样式必须同时写亮色与暗色两块。**例外**：覆盖 `--md-ref-palette-*` 只写一份（palette 与明暗无关）。
- 选择器 `:root:root`，特异性 (0,2,0)，压过主题 `:root` (0,1,0)。
- 卸载时删除注入的 `<style>`，清理 `data-rc-palette` 属性。
- 水波纹由插件实现；主题侧只预留 `.rc-ripple` 宿主样式。

### 10.2 MCU API 现状

| 问题                 | 答案                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| MCU 还在维护吗       | **在**。未归档，最新版 0.4.0（2026-01-21），最后推送 2026-11-06                                               |
| 莫奈功能还在吗       | **在**，是库的核心卖点                                                                                        |
| 什么被 DEPRECATED 了 | ① `Scheme` 类及配套的 `themeFromSourceColor` / `applyTheme`；② `MaterialDynamicColors` 上的 **55 个静态属性** |
| 新 API               | `DynamicScheme` + `SchemeTonalSpot` 等 11 个 variant 子类 + `MaterialDynamicColors` 的实例方法                |

**本项目走 palette 路线，不需要 `MaterialDynamicColors`**（§6.4）。它只在将来要直接算角色值时才用得到。

旧 API 不够用的原因：`themeFromSourceColor` 返回的 `Scheme` 只有 29 个 getter，而 M3 `sys-color` 有 48 个角色——`surface-container-*`、`surface-bright`、`*-fixed` 全都没有。

### 10.3 派生色在莫奈下的处理

MCU 不生成 success / warning / info。插件有两种处理：

| 方案           | 做法                                                                       | 代价                 |
| -------------- | -------------------------------------------------------------------------- | -------------------- |
| A. 保持静态    | 派生色用 static 色族固定值                                                 | 与动态主色可能不协调 |
| B. 用 HCT 生成 | 用 `Hct.from(hue, chroma, tone)` 从种子色取 hue，按固定 chroma / tone 生成 | 插件侧增加逻辑       |

推荐 B：`Hct` 类直接可用，派生色用与主色相同的 hue 生成，视觉协调；tone 仍按「40 亮 / 80 暗」保持对比度。

### 10.4 对比度变体（不落地）

```ts
const normal = new SchemeTonalSpot(hct, isDark, 0.0);
const medium = new SchemeTonalSpot(hct, isDark, 0.5);
const high = new SchemeTonalSpot(hct, isDark, 1.0);
```

| 需求                   | 做法                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| 插件提供对比度开关     | 改 `contrastLevel` 重建 scheme，**覆盖 `--rc-color-*`（不是 palette）** |
| 纯静态主题也要高对比度 | 才需要把 4 个静态文件落地，用 `:root[data-rc-contrast='high']` 覆盖     |
| 两者都没有             | 不落地                                                                  |

---

## 11. 移动端

### 11.1 事实

| 事实                   | 结论                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 移动端 CSS             | 独立构建，不是桌面 CSS 的媒体查询分支                                                                    |
| 移动端独有变量         | **17** 个                                                                                                |
| 移动端独有组件         | `.mobile-topbar`、`.mobile-bottom-bar`、`.mobile-safe-area`、`body.mobile-keyboard--open`                |
| 两端共有组件           | `.b3-menu`、`.b3-list-item`、`.b3-dialog`、`.protyle-breadcrumb`、`.layout-tab-bar`、`.dock`             |
| 移动端 `data-frontend` | `mobile` / `browser-mobile`                                                                              |
| 移动端 `data-backend`  | `ios` / `android` / `harmony`                                                                            |
| 移动端紧凑模式         | 不生效。JS 会写属性，但 `isCompactModeAvailable()` 白名单只含 desktop / desktop-window / browser-desktop |

17 个移动端变量（`_mobile.scss`）：`--mobile-topbar-height` 48px、`--mobile-bottom-bar-height` 48px、`--mobile-breadcrumb-height` 42px、`--mobile-status-height` 24px、`--mobile-top-safe-area` `env(safe-area-inset-top)`、`--mobile-bottom-bar-safe-area` `env(safe-area-inset-bottom)`、`--mobile-bottom-bar-gap` 8px、`--mobile-bottom-bar-bottom` `calc(...)`、`--mobile-bottom-bar-offset` `calc(...)`、`--android-navigation-overlay` 1、`--file-tree-indent` / `--file-tree-toggle-size` / `--file-tree-toggle-padding` 30px / 32px / 8px、`--b3-snackbar-gap` / `--b3-snackbar-right` / `--b3-snackbar-top` 16px / 30px / `max(22px, …)`、`--b3-protyle-page-scroll-gutter` 0px。

### 11.2 组织方式

- 不按平台拆目录，同一组件的规则留在同一区域文件，用 `s:mobile:` 写差异。
- 移动端独有组件集中放 `components/mobile.scss`，桌面端天然不匹配。
- 移动端判定必须用 `data-backend ∈ {ios, android, harmony}`，不能用 `@media (max-width: 768px)`——平板横屏和浏览器访问桌面版会被宽度误判。
- 移动端 token：颜色两端共用；尺寸用 `:root[data-backend=…]` 追加移动端分支，并提供 `touch-min`（44px）。Token 层不能用 `s:` 变体。

---

## 12. 启动与切换

| 场景       | 行为                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| 冷启动     | 思源有启动遮罩，覆盖整个主题加载窗口；`data-theme-mode` 与 `themeStyle` 同时到达，第一帧已是主题样式 |
| 明暗切换   | `data-theme-mode` 属性立即变化，颜色 token 同帧跟随，无网络请求                                      |
| 多风格切换 | 插件写 `data-rc-style` 后 CSS 变体生效；插件在 `onload` 第一件事就写该属性                           |
| Monet 取色 | 必然晚于首帧；页面底色由静态 `:root` 兜住，注入后颜色平滑过渡                                        |

---

## 13. 构建与校验

### 13.1 构建流程

`pnpm build`：`type-check` → `vite build`（Vite 调 Sass 编译 `theme.scss`，UnoCSS 展开 `@apply`，`siyuan()` 插件负责产物目录 / 产物名 / public 复制 / 产物校验 / 打 zip）→ `package.zip`。

`vite-plugin-siyuan` 的 `verify.ts` 已覆盖：清单存在与形状、`package.json` 与清单版本一致、产物无 JS、无 `@layer`、无 `rgb(var(--b3-*))` 双重包装、清单声明的资源在产物里。**这些主题侧测试不重复实现。**

### 13.2 构建决策

| 项目      | 取值                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| 输出      | `theme.css` + `theme.json`（+ icon / preview）                                  |
| sourcemap | 关闭                                                                            |
| `@layer`  | 禁用，`layers` 配置不配                                                         |
| 预处理器  | `sass`（devDependency），Vite 原生支持 `.scss` 入口                             |
| token 源  | `@material/web`（devDependency，**2.5.0 精确锁定**，无 `^`）                    |
| Sass 解析 | Vite 自动解析裸包名；测试里 `sass.compile()` 需显式 `loadPaths: [node_modules]` |
| 体积      | 只记录，不设硬限                                                                |

### 13.3 性能预算

| 指标            | 上限      |
| --------------- | --------- |
| `:has()` 规则数 | ≤ 20 条   |
| 选择器最大深度  | ≤ 4 层    |
| 规则总数        | ≤ 3000 条 |

### 13.4 测试清单

| 编号 | 规则                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | 产物无 `@layer`（插件已覆盖，主题侧不重复）                                                                                                                                                                                              |
| B2   | `components/` 内只能写短工具类；不得出现颜色字面量、`var(--rc-*)`、`--b3-ui-*`                                                                                                                                                           |
| B3   | `bridge.scss` 覆盖全部 **147** 个颜色 `--b3-*`（对照 daylight/midnight 快照）                                                                                                                                                            |
| B4   | `tokens/` 里不得出现组件类名（分层守卫）                                                                                                                                                                                                 |
| B5   | 产物中不存在 `[data-theme-mode="dark"] :root`                                                                                                                                                                                            |
| B6   | 各 token 文件落地条数符合 §3.1：合计 **843 条声明**                                                                                                                                                                                      |
| B7   | `--rc-*` 契约名覆盖完整（唯一变量名口径）：颜色 48 + 圆角 24 + 高度 6 + 动效 45 + 状态 5 + 焦点 3 + 字号 210 + 强调字号 210 + 派生 12 + 静态标注 18 + 间距 5 + 尺寸 4 + 阴影 6 = **596 个唯一名**（颜色按亮暗两份声明算则为 644 条声明） |
| B8   | `uno.config.ts` 每个 theme key 必须来自 `--rc-*` 契约，全部颜色契约名必须有对应映射                                                                                                                                                      |
| B9   | 其他风格的覆盖文件里所有 `:root` 必须带 `[data-rc-style='<style>']`                                                                                                                                                                      |
| B10  | Token 文件里不得出现嵌套颜色函数写法（`oklch()` / `rgb()` 的通道位置放变量）                                                                                                                                                             |
| B11  | 不得有变量自引用，否则该变量整条失效                                                                                                                                                                                                     |
| B12  | `derived.scss` 里的颜色只能引用 `--md-ref-palette-*` 的 static / baseline 色阶，不得写死色值，不得用相对颜色语法                                                                                                                         |
| B13  | 产物里每个 `var(--un-*)` 引用都要有定义                                                                                                                                                                                                  |
| B14  | `--rc-color-*` 的 `:root` 和 `:root[data-theme-mode='dark']` 必须定义完全相同的 **48** 个键；palette 只定义一次                                                                                                                          |
| B15  | `components/` 里不得出现 `@media (prefers-color-scheme: dark)`                                                                                                                                                                           |
| B16  | `components/` 里不得出现 `.dark` 类选择器                                                                                                                                                                                                |
| B17  | 产物中不得出现 §3.6 的 6 个弃用 token 名                                                                                                                                                                                                 |
| B18  | 1:1 双射：产物中每个 `--md-ref-*` / `--rc-*` 变量恰好对应一个官方 M3 变量，断言无合并/拆分/丢弃（**795 个唯一变量名**）                                                                                                                  |
| B19  | 每个 token 文件头部必须有弃用标注注释，逐条列出 `@deprecated` 项与替代方案                                                                                                                                                               |
| B20  | `--rc-color-*` 亮暗两份必须按键序一致排列（48 个键顺序完全一致）                                                                                                                                                                         |
| B21  | `uno.config.ts` 的 `theme.boxShadow` 不得引用 `--rc-elevation-*`，必须引用 `--rc-shadow-level*`                                                                                                                                          |
| B22  | `theme.colors` 与 `theme.fontSize` 的键名集合不得有交集                                                                                                                                                                                  |
| B23  | `components/` 里不得出现数字间距刻度（`p-4` / `m-2` / `gap-8`），只能用 `space-*` 语义名                                                                                                                                                 |
| B24  | `--rc-shadow-level*` 必须覆盖 level0–level5 共 6 条，每条含 key + ambient 双层阴影                                                                                                                                                       |
| B25  | 带 alpha 的思源槽位（25 个 `rgba()` 原值）在 `bridge.scss` 中必须用 `color-mix()` 表达                                                                                                                                                   |
| B26  | 产物中每个 `var(--un-*)` 引用都必须有定义；`foundation/_un-baseline.scss` 的 9 条基线变量必须存在                                                                                                                                        |

### 13.5 与插件校验的分工

| 层                               | 负责                                                    | 覆盖            |
| -------------------------------- | ------------------------------------------------------- | --------------- |
| `vite-plugin-siyuan` `verify.ts` | 清单 / 版本 / 无 JS / 无 `@layer` / 双重包装 / 声明资源 | B1 及产物完整性 |
| 主题侧 `tests/*.test.ts`         | 分层守卫、映射双射、弃用标注、bridge 覆盖、契约完整性   | B2–B26          |

---

## 14. 实施顺序

| 步骤 | 内容                                                                                                                                        | 验收                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1    | `uno.config.ts` 按 §8.3 重写；`theme.css` 改名 `theme.scss`；删除 `foundation/semantic.css` 与对应测试；新建 `foundation/_un-baseline.scss` | B10 / B13 / B26 绿          |
| 2    | 引入 devDependency `@material/web@2.5.0`（精确锁定）；`@use` 其内置 11 个设计层 SCSS；写 `tokens/material/_index.scss`                      | B18 绿                      |
| 3    | 补齐 color / shape / elevation 三段                                                                                                         | B6 / B10 / B14 / B17 绿     |
| 4    | 补齐 motion / state / focus-indicator 三段                                                                                                  | B6 / B18 绿                 |
| 5    | 补齐 typescale / emphasized，加 3 条弃用标注                                                                                                | B6 / B17 / B19 绿           |
| 6    | 校验 `--rc-*` 契约完整性 + 项目扩展                                                                                                         | B4 / B7 / B8 / B11 绿       |
| 7    | `derived.scss`：12 派生 + 22 静态标注 + 6 阴影配方                                                                                          | B12 / B24 绿                |
| 8    | `bridge.scss` 手写 137 条                                                                                                                   | B3 / B25 绿                 |
| 9    | `components/` 按区域逐个（先菜单、对话框、停靠栏）                                                                                          | B2 / B15 / B16 / B21–B23 绿 |
| 10   | `components/mobile.scss` + 各文件的 `s:mobile:` 分支                                                                                        | 移动端复核                  |
| 11   | `tokens/fluent/`、`tokens/shadcn/` 空覆盖文件占位                                                                                           | B9 绿                       |
| 12   | 插件：`<style>` 注入 + Monet 取色                                                                                                           | 运行时切换验证              |
| 13   | B2–B26 全绿                                                                                                                                 | `pnpm check` 通过           |

---

## 15. 已知限制

| #   | 限制                                | 影响                                                                                      |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `fontSize` / `colors` 同占 `text-*` | 颜色赢，字号静默失效。靠命名约定规避，无强制手段                                          |
| 2   | `spacing` 默认刻度无法关闭          | `p-4` 永远有效，只能靠 lint 规则禁止                                                      |
| 3   | `bridge.scss` 137 条无自动化来源    | 思源升级时变量可能增删，只能靠 B3 快照测试发现                                            |
| 4   | 多风格覆盖文件为空壳                | `tokens/fluent/` 与 `tokens/shadcn/` 只有占位，B9 断言其 `:root` 必须带 `[data-rc-style]` |
