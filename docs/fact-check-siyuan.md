# 思源事实核实

> 核实对象：`docs/architecture.md` 中关于思源（SiYuan）本体的 7 条事实性说法。
> 核实基准：siyuan-note/siyuan 仓库 `master`，本地 sparse clone 的 commit `be17ed1e0510bb6371cb8a162e16898a697fa118`。
> 最新 release：**v3.8.10**（发布于 2026-11-10T04:13:26Z，取自 GitHub Releases API）。
> 核实日期：2026-11-13。

## 结论表

| #   | 文档说法                                                                                                       | 结论                           | 实测值                                                                                                                                                                                       | 证据                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 「思源内置主题的 130 个颜色 `--b3-*` 必须全量接管」                                                            | **不属实（数字错，位置也错）** | `--b3-*` 共 **185** 个；其中**取值为颜色**的 **138** 个（104 个字面色值 + 34 个 `var(--b3-*)` 引用）。定义在 `themes/daylight/theme.css` 与 `themes/midnight/theme.css`，**不在 `base.css`** | [daylight/theme.css](https://github.com/siyuan-note/siyuan/blob/master/app/appearance/themes/daylight/theme.css)                                                                              |
| 2   | `data-theme-mode` 只有 light/dark；跟随系统由 JS 写入；已声明 `color-scheme`                                   | **属实**                       | 值域 `light` \| `dark`；`getThemeMode()` 读 `modeOS` + `prefers-color-scheme` 后由 `assets.ts` 写入；`color-scheme` 在 `_reset.scss` 按属性声明                                              | [assets.ts](https://github.com/siyuan-note/siyuan/blob/master/app/src/util/assets.ts) / [_reset.scss](https://github.com/siyuan-note/siyuan/blob/master/app/src/assets/scss/util/_reset.scss) |
| 3   | `data-backend` ∈ {ios, android, harmony}；`data-frontend` ∈ {desktop, mobile, browser-mobile, browser-desktop} | **不属实（两边都漏值）**       | `data-backend` 共 **7** 值：`windows`/`linux`/`darwin`/`docker`/`android`/`ios`/`harmony`；`data-frontend` 共 **5** 值，多一个 `desktop-window`                                              | [functions.ts](https://github.com/siyuan-note/siyuan/blob/master/app/src/util/functions.ts)                                                                                                   |
| 4   | 「`data-ui-density` 移动端没有；**JS 从不写**」                                                                | **前半属实，后半不属实**       | 属性真实存在（`constants.ts:111`），JS **确实会写**（`compactMode.ts:14-18`）。但紧凑模式仅对 `desktop`/`desktop-window`/`browser-desktop` 开放，移动端实际不会出现                          | [compactMode.ts](https://github.com/siyuan-note/siyuan/blob/master/app/src/config/tabs/compactMode.ts)                                                                                        |
| 5   | 移动端独有变量 14 个；topbar 48 / bottom-bar 48 / breadcrumb 42 / status 24                                    | **数值属实，数量不属实**       | 四个数值**全部正确**；变量数：`_mobile.scss` body 块 **12** 个唯一声明，全文件 **16** 个唯一名（19 条声明）。**无法复现「14」**                                                              | [_mobile.scss](https://github.com/siyuan-note/siyuan/blob/master/app/src/assets/scss/main/_mobile.scss)                                                                                       |
| 6   | `--b3-ui-*` 在紧凑模式下用零特异性选择器定义                                                                   | **属实**                       | `:where(:root[data-ui-density="compact"])`，`:where()` 内层特异性归零；共定义 **31** 个 `--b3-ui-*`                                                                                          | [_density.scss](https://github.com/siyuan-note/siyuan/blob/master/app/src/assets/scss/util/_density.scss)                                                                                     |
| 7   | 最新版本号；daylight / midnight 各自定义 `--b3-*`                                                              | **属实**                       | v3.8.10；两个内置主题**各定义 185 个 `--b3-*`**，变量名集合完全一致（差集为空）                                                                                                              | [Releases API](https://api.github.com/repos/siyuan-note/siyuan/releases/latest)                                                                                                               |

---

## 细节

### 1. `--b3-*` 到底有多少个、定义在哪

**抓取方式**：`git clone --depth 1 --filter=blob:none --sparse` 后 `git sparse-checkout set app/appearance app/src`，本地统计，避免 web_fetch 的 HTML 包装干扰。

**统计口径**（`themes/daylight/theme.css`，全文 272 行）：

| 口径                                                               | 数量    |
| ------------------------------------------------------------------ | ------- |
| `--b3-*` 唯一变量名总数                                            | **185** |
| 其中值以字面色值开头（`#` / `rgba(` / `rgb(` / `hsl(` / `oklch(`） | 104     |
| 其中值为 `var(--b3-*)` 引用（间接颜色）                            | 34      |
| **颜色语义合计（104 + 34）**                                       | **138** |
| 值为 `inherit` / `initial` / `transparent` 关键字                  | 12      |
| 非颜色（字体族、字号、px 尺寸、transition、线宽）                  | 47      |
| 文件内非 `--b3-` 变量（`--sidebar-width`）                         | 1       |

**关键否证：`base.css` 在仓库里根本不存在。**

`git ls-tree -r --name-only HEAD | grep '\.css$'` 中，`app/appearance/` 下只有两个 CSS：

```
app/appearance/themes/daylight/theme.css
app/appearance/themes/midnight/theme.css
```

`base.css` 是 **webpack 构建产物**，不是源文件：

```js
// app/webpack.config.js:150
filename: "base.[contenthash].css",
```

其源码是 `app/src/assets/scss/base.scss`。而且 `base.scss` 里**没有任何 `--b3-theme-*` 颜色声明**（对 `app/src/assets/scss/**` 搜索 `--b3-theme-[\w-]+\s*:` 返回 0 条）。颜色全部来自主题目录的 `theme.css`。

**原始片段**（`themes/daylight/theme.css` 开头）：

```css
:root {
    /* 主色 */
    --b3-theme-primary: #3575f0;
    --b3-theme-primary-light: rgba(53, 117, 240, .54);
    --b3-theme-background: #fff;
    --b3-theme-surface: #f6f6f6;
    --b3-theme-error: #d23f31;
    --b3-theme-success: #65b84d;
```

> 注：`--b3-tooltips-shadow` / `--b3-point-shadow` 等 5 个阴影值以 `0 ` 开头，未被计入「字面色值」，这是有意为之——它们是阴影而非颜色。

### 2. `data-theme-mode` / `color-scheme`

**值域**：只有 `light` 与 `dark`。

```ts
// app/src/util/assets.ts — getThemeMode()
const OSTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
if (window.siyuan.config.appearance.modeOS) {
  return OSTheme;
} else {
  return window.siyuan.config.appearance.mode === 0 ? 'light' : 'dark';
}
```

**「跟随系统」确由思源 JS 写入**（不是 CSS 媒体查询）：

```ts
// app/src/util/assets.ts:156-163
const previousThemeMode = htmlElement.getAttribute('data-theme-mode');
const themeMode = getThemeMode();
htmlElement.setAttribute('lang', window.siyuan.config.appearance.lang);
applyCompactMode();
htmlElement.setAttribute('data-frontend', getFrontend());
htmlElement.setAttribute('data-backend', getBackend());
htmlElement.setAttribute('data-theme-mode', themeMode);
```

**`color-scheme` 已声明**，且是**按属性**声明（不是 `prefers-color-scheme`）：

```scss
// app/src/assets/scss/util/_reset.scss:18-26
:root[data-theme-mode="dark"] {
  color-scheme: dark;
  --b3-legacy-light-color: ;
  --b3-legacy-dark-color: initial;
}
:root[data-theme-mode="light"] {
  color-scheme: light;
```

> 文档说「已由思源 `base.css` 声明」——效果正确，但源文件是 `_reset.scss`（编译进 `base.[contenthash].css`），仓库中无 `base.css`。

### 3. `data-backend` / `data-frontend` 取值集合

```ts
// app/src/util/functions.ts:13-33
// "windows" | "linux" | "darwin" | "docker" | "android" | "ios" | "harmony"
export const getBackend = () => {
    if (isKernelInContainer()) {
        return window.siyuan.config.system.container;
    } else {
        return window.siyuan.config.system.os;
    }
};

// "desktop" | "desktop-window" | "mobile" | "browser-desktop" | "browser-mobile"
export const getFrontend = () => {
```

- `data-backend`：**7 个值**。文档只列了 `ios`/`android`/`harmony`，漏了 `windows`/`linux`/`darwin`/`docker`。
- `data-frontend`：**5 个值**。文档只列了 4 个，漏了 `desktop-window`。

> 影响评估：`s:mobile:` 变体只需匹配 `ios`/`android`/`harmony`，**该用法仍然正确**；但「`data-backend` 的取值集合」这一事实陈述不完整。

### 4. `data-ui-density` 是否真实存在

**存在，且 JS 会写。**

```ts
// app/src/constants.ts:111
public static readonly ATTRIBUTE_UI_DENSITY = "data-ui-density";
```

```ts
// app/src/config/tabs/compactMode.ts:12-21
export const applyCompactMode = () => {
    const root = document.documentElement;
    const enabled = isCompactModeEnabled();
    const changed = root.hasAttribute(Constants.ATTRIBUTE_UI_DENSITY) !== enabled;
    if (enabled) {
        root.setAttribute(Constants.ATTRIBUTE_UI_DENSITY, "compact");
    } else {
        root.removeAttribute(Constants.ATTRIBUTE_UI_DENSITY);
    }
```

`applyCompactMode()` 由 `loadAssets()` 调用（`assets.ts`），即每次外观刷新都会执行。

**但移动端确实不会出现该属性**——可用性白名单把移动端排除了：

```ts
// app/src/config/tabs/compactMode.ts:5-6
export const isCompactModeAvailable = () => ['desktop', 'desktop-window', 'browser-desktop'].includes(getFrontend());
```

结论：文档「移动端没有 `data-ui-density`」**属实**；「JS 从不写 `data-ui-density`」**不属实**。

### 5. 移动端变量数量与尺寸

```scss
// app/src/assets/scss/main/_mobile.scss:5-20
body {
  --b3-snackbar-gap: 16px;
  --b3-snackbar-right: 30px;
  --b3-snackbar-top: max(22px, calc(var(--b3-window-controls-height, 0px) + 16px));
  --mobile-top-safe-area: env(safe-area-inset-top);
  --mobile-topbar-height: 48px;
  --mobile-breadcrumb-height: 42px;
  --mobile-bottom-bar-height: 48px;
  --mobile-bottom-bar-gap: 8px;
  --mobile-status-height: 24px;
  --mobile-bottom-bar-safe-area: env(safe-area-inset-bottom);
```

**四个数值全部属实**：topbar `48px`、bottom-bar `48px`、breadcrumb `42px`、status `24px`。

**数量统计**（三种口径，都不等于 14）：

| 口径                                               | 数量                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `body` 块内唯一变量声明                            | 12（3 个 `--b3-snackbar-*` + 9 个 `--mobile-*`）                                                                             |
| 全文件唯一变量名                                   | 16（另加 `--android-navigation-overlay` 与 `--file-tree-indent` / `--file-tree-toggle-size` / `--file-tree-toggle-padding`） |
| 全文件声明条数（含 android / keyboard 块重复声明） | 19                                                                                                                           |

「14 个」**无法复现**，建议改为「约 12–16 个」或直接引用具体变量名。

### 6. `--b3-ui-*` 的零特异性

**属实，且确认使用 `:where()`。**

```scss
// app/src/assets/scss/util/_density.scss
$compact-sizes: (
  "panel-height": 34px,
  "list-height": max(24px, 1.5em),
  ...
  "config-nav-margin": 6px
);

:where(:root[data-ui-density="compact"]) {
  @each $name, $value in $compact-sizes {
    --b3-ui-#{$name}: #{$value};
  }
}

// 编辑器及预览正文内复用的控件保持内容布局，浮层菜单仍使用界面密度。
:where(.protyle-wysiwyg),
:where(.b3-typography) {
  @each $name, $value in $compact-sizes {
    --b3-ui-#{$name}: initial;
  }
}
```

- `$compact-sizes` 共 **31** 条，即紧凑模式定义 31 个 `--b3-ui-*`。
- 选择器为 `:where(:root[data-ui-density="compact"])`，`:where()` 特异性恒为 0，整体特异性 **(0,0,0)**。
- 因此主题在 `:root`（特异性 (0,1,0)）写同名变量**会覆盖紧凑值**——文档 §3.5 / §6.2 的警告**正确**。
- 补充事实：非紧凑态的默认值**不在** `_density.scss` 里（源码注释：「低优先级默认值允许主题通过根变量覆盖」），scss 中仅 `markdown.scss` 有一处默认声明 `--b3-ui-list-height: 44px`。默认值散落在各组件 scss 中。

### 7. 版本号与内置主题

- 最新 release：`v3.8.10`，`published_at = 2026-11-10T04:13:26Z`。
- 内置主题：**2 个**，`daylight`（亮）与 `midnight`（暗），由 `app/appearance/.gitignore` 显式保留（`!themes/daylight/`、`!themes/midnight/`，其余主题被忽略）。
- 两者**各定义 185 个 `--b3-*`**（加上 `--sidebar-width` 共 186 个唯一名），**变量名集合完全一致**，差集为空（`onlyDay = []`，`onlyNight = []`）。差异只在取值（如 `--b3-theme-background` 为 `#fff` vs `#1e1e1e`）。

---

## 对设计文档的修改建议

### 建议 1：`--b3-*` 数量（§1.1 决策 6、§1.2、§2.2、§3.9、§10.4 B3）

> **原文**：「思源内置主题的 130 个颜色 `--b3-*` 必须全量接管，漏一个就会回落到内置蓝灰色。」
>
> **建议**：「思源内置主题共定义 **185** 个 `--b3-*` 变量，其中 **138** 个取值为颜色（104 个字面色值 + 34 个变量引用），其余为字体、尺寸、阴影与动画。bridge 必须覆盖这 138 个颜色变量；未覆盖的会回落到内置主题值。」

同步修改 §1.2 数据流「bridge（130 个颜色 `--b3-*`）」→「bridge（138 个颜色 `--b3-*`）」，§2.2 表格「`src/tokens/bridge.css`｜共用：130 个颜色」→ 138，§3.9 全部 4 处 130 → 138，§10.4 B3「覆盖全部 130 个」→ 138，§2.2 `scripts/bridge.config.mjs`「130 条映射表」→ 138。

### 建议 2：`base.css` 的定义位置（§3.9、§4.4）

> **原文**：「思源 `base.css` 需要接管的颜色 `--b3-*` 共 130 个。」
>
> **建议**：「思源颜色 `--b3-*` 定义在 `app/appearance/themes/{daylight,midnight}/theme.css`，共 138 个颜色变量。`base.css` 是 webpack 构建产物（源码 `app/src/assets/scss/base.scss`），其中不含颜色变量定义。」

> **原文（§4.4）**：「`color-scheme` 已由思源 `base.css` 声明，主题不重复声明。」
>
> **建议**：「`color-scheme` 已由思源在 `:root[data-theme-mode="dark"|"light"]` 上声明（源码 `app/src/assets/scss/util/_reset.scss`，编译进 `base.[contenthash].css`），主题不重复声明。」

### 建议 3：`data-backend` 取值集合（§4.6、§8.2）

> **原文（§8.2）**：「移动端判定必须用 `data-backend ∈ {ios, android, harmony}`」
>
> **建议**：判定逻辑本身**正确，保留**；但需补一句事实澄清：「`data-backend` 的完整值域为 `windows`/`linux`/`darwin`/`docker`/`android`/`ios`/`harmony` 共 7 个，移动端判定取其中 3 个。」

### 建议 4：`data-frontend` 取值集合（§8.1）

> **原文**：「移动端 `data-frontend`｜`mobile` / `browser-mobile`」
>
> **建议**：该行**正确，保留**。但若文档别处声称 `data-frontend` 全集为 4 个值，应改为：「`data-frontend` 完整值域为 `desktop`/`desktop-window`/`mobile`/`browser-desktop`/`browser-mobile` 共 5 个。」

### 建议 5：`data-ui-density`（§8.1、§8.2）

> **原文**：「移动端紧凑模式｜没有；JS 从不写 `data-ui-density`」
>
> **建议**：「移动端没有紧凑模式：`isCompactModeAvailable()` 只对 `desktop`/`desktop-window`/`browser-desktop` 返回 true，移动端 JS 不会写入 `data-ui-density`。桌面端 JS 会在用户开启紧凑模式时写入 `data-ui-density="compact"`（`compactMode.ts`）。」

> **原文（§8.2）**：「移动端没有 `data-ui-density`，`s:compact:` 规则永远不会命中，不需要额外处理。」
>
> **建议**：保留结论，但把理由改成上面的白名单机制，避免「JS 从不写」这一错误论据。

### 建议 6：移动端变量数量（§8.1）

> **原文**：「移动端独有变量｜14 个（topbar 48px / bottom-bar 48px / breadcrumb 42px / status 24px / 安全区等）」
>
> **建议**：「移动端独有变量｜`_mobile.scss` 中 `body` 块声明 12 个（含 `--mobile-topbar-height: 48px`、`--mobile-bottom-bar-height: 48px`、`--mobile-breadcrumb-height: 42px`、`--mobile-status-height: 24px` 及安全区、snackbar 变量），全文件共 16 个唯一变量名。」
>
> 四个尺寸数值**无需修改，全部正确**。

### 建议 7：零特异性选择器的措辞（§3.5、§6.2）

> **原文（§3.5）**：「思源在紧凑模式下用零特异性选择器定义那批变量」
>
> **建议**：**保留，并补上确切写法**：「思源在 `:where(:root[data-ui-density="compact"])` 中定义 31 个 `--b3-ui-*` 紧凑值，`:where()` 使特异性归零为 (0,0,0)。」
>
> 文档此处判断**正确**，是本次核实中唯一无需实质修正的架构性论断。

---

## 核实方法与环境

- 仓库：`git clone --depth 1 --filter=blob:none --sparse https://github.com/siyuan-note/siyuan.git`，`git sparse-checkout set app/appearance app/src`。
- HEAD commit：`be17ed1e0510bb6371cb8a162e16898a697fa118`。
- 版本号：`https://api.github.com/repos/siyuan-note/siyuan/releases/latest` → `v3.8.10`。
- 统计脚本口径：正则 `/(--[\w-]+)\s*:\s*([^;]*);/g` 提取声明，按变量名去重取首次出现值；颜色判定为正则以 `#`/`rgba(`/`rgb(`/`hsl(`/`oklch(`/`color(` 开头，或值为 `var(--b3-*)`。
- **未核实项**：无。7 条说法全部拿到源码证据。
