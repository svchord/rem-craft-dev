# Rem Craft 主题开发环境（CSS-only）

> 工程骨架与 `make-link` 等脚本复用自 `D:\Code\siyuan-arco-calendar`（插件工程），按**主题**契约做了最小适配。
> 依赖：Node 24.21 / pnpm 11.28 / Vite 8.3 / TypeScript 7.0 / UnoCSS 66.12 / Vitest 5.0 / oxlint + oxfmt。

## 0. 产物契约（最重要）

**主题只交付 CSS，不产出 `theme.js`。**

```
主题包（dist/）：
  theme.json        # 清单（源文件在 public/theme.json）
  theme.css         # 唯一样式产物
  README*.md        # 构建时从仓库根复制（theme.json.readme 指向包根）
  icon.png / preview.png / assets/**   # 来自 public/

不放进主题包：
  LICENSE           # 仓库法律元数据，只留仓库根
```

`scripts/check_dist.mjs` 会在构建后强制校验：`dist/` 里不得出现任何 `.js`；`theme.css` 不得包含 `@layer`。

> 为什么不能有 `theme.js`：思源虽然支持主题 JS，但需要用户手动开启「使用主题 JS」（`appearance.themeJS`），且远程内核模式下 `customAppearance` 为 false 时整体失效。CSS-only 可以保证任何环境下表现一致，也避免主题包被当作可执行内容审查。

## 1. 主题 vs 插件：边界对照

| 维度              | 主题（本仓库）                    | 插件（arco-calendar）                    |
| ----------------- | --------------------------------- | ---------------------------------------- |
| 清单              | `theme.json`                      | `plugin.json`                            |
| 安装目录          | `<workspace>/data/themes/<name>/` | `<workspace>/data/plugins/<name>/`       |
| 产物              | `theme.css` + `theme.json`        | `index.js` + `index.css` + `plugin.json` |
| JS                | **无**                            | `index.js`（CJS，由 petal 管理器 eval）  |
| 生命周期/设置面板 | 无                                | `onload/onunload`、`Setting`、`saveData` |
| 打包格式          | 纯 CSS（Vite 以 CSS 为入口）      | `cjs`                                    |

## 2. 目录结构

```
rem-craft-dev/
├─ src/
│  └─ styles/
│     ├─ index.css          # 按 L0→L4 顺序 @import
│     ├─ l0-tokens.css      # 调色板（唯一数值来源，含 dark 覆盖）
│     ├─ l1-semantic.css    # 语义别名 --rc-*
│     ├─ l2-bridge.css      # --b3-* ← --rc-*
│     ├─ l3-components.css  # @apply 组件配方
│     └─ l4-variants.css    # 属性选择器变体（data-theme-mode / data-ui-density / custom-*）
├─ tests/css-architecture.test.ts   # CSS 架构守卫（无 @layer、token 完整性、层次顺序）
├─ src-legacy/              # 旧架构备份（原 src + 旧构建配置在 _build/）
├─ scripts/                 # 复用 arco 的工程脚本（见 §6）
├─ dist/                    # 生产产物：theme.css + theme.json
├─ dev/                     # 开发产物（软链到 data/themes/<name>）
├─ public/                  # 随包原样分发的静态资源（Vite 自动复制到产物根）
│  ├─ theme.json           # 主题清单（脚本从这里读）
│  ├─ icon.png             # 市场图标（可选）
│  ├─ preview.png          # 市场预览图（可选）
│  └─ assets/**            # 字体/图片等运行时资源
├─ README*.md               # 仓库根：GitHub 首页 + 构建时复制进主题包
├─ LICENSE                  # 仓库根：只做仓库元数据，不进主题包
├─ uno.config.ts
└─ vite.config.ts           # CSS 入口（Vite 原生支持，产物只有 theme.css）
```

## 3. 命令

| 命令                        | 作用                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                  | 类型检查后进入 watch，产物写 `dev/`                                 |
| `pnpm build`                | clean → 清单校验 → 类型检查 → 构建 → 产物校验，并生成 `package.zip` |
| `pnpm check`                | 清单 + 格式 + 类型 + 单测                                           |
| `pnpm lint` / `pnpm format` | oxlint / oxfmt                                                      |
| `pnpm make-link`            | 把 `dev/` 软链到 `<workspace>/data/themes/<theme.json name>`        |
| `pnpm audit`                | 用无头浏览器打开思源前端，扫描主题选择器命中率、计算变量并截图      |
| `pnpm dev:hmr`              | 一键开发：Vite HMR，改样式保存即生效（无需手动刷新）                |
| `pnpm make-install`         | 构建后把 `dist/` 复制到主题目录（覆盖软链，用于稳定体验）           |
| `pnpm update-version`       | 交互式 bump `package.json` 与 `public/theme.json` 版本              |

## 4. 开发流程

```bash
pnpm install
pnpm dev            # 终端 A：watch 构建
pnpm make-link      # 终端 B：建立链接（只需一次）
# 思源 → 设置 → 外观 → 主题选「Rem Craft Dev」
```

- 改完 CSS 需手动刷新（`Ctrl+R` / 重新切换主题）；想保存即生效可看 `pnpm audit` 相关流程。
- 思源未启动时，`make-link` 会自动读取 `~/.config/siyuan/workspace.json` 兜底；也可显式指定：
  `SIYUAN_THEME_DIR="D:\Document\siyuan\data\themes" pnpm make-link`。
- 若工作区开了 API token，脚本会自动从 `conf/conf.json` 读取（也可用 `SIYUAN_TOKEN` 覆盖）。

## 4.1 实时预览与测量（浏览器，推荐）

不需要调试端口、不需要重启思源、不碰你的桌面会话。原理：kernel 自己就把前端托管在 `http://127.0.0.1:<port>/stage/build/desktop/`，用无头浏览器打开即可。

```bash
pnpm dev     # 终端 A：watch 构建 dev/theme.css
pnpm audit   # 随时：无头浏览器打开前端，扫描选择器 + 截图
```

`pnpm audit` 自动从 `port.json`（PID → 端口）定位 kernel 端口，不用手填。实测输出：

```text
[audit] kernel port: 58535
[audit] frontend=browser-desktop mode=light theme=Rem Craft Dev themeJS=false
[audit] themeStyle=/appearance/themes/Rem Craft Dev/theme.css?v=3.0.0
[audit] --rc-brand-8=0 82 217  --b3-theme-primary=rgb(0 82 217)
[audit] css=./dev/theme.css selectors=9 hit=1 miss=8
```

**未命中不等于失效**：`.b3-menu__item` 要菜单打开、`[data-theme-mode='dark']` 要暗色模式、`custom-rc-*` 要先在属性面板设置。这个命令的价值是「按 UI 条件筛出可疑选择器」，而不是直接判死刑。

## 5. 已知坑（本机实测）

1. **`pnpm build` 会清理 `dev/`**（复用 arco 的 clean 脚本）。`dev/` 正是主题目录软链的目标，构建期间已安装的主题会短暂变空；开发时用 `pnpm dev`，不要并行跑 `pnpm build`。
2. **软链权限**：Windows 未开开发者模式时 `fs.symlinkSync` 报 EPERM；脚本已自动回退到 **junction**（本地目录无需管理员）。若 junction 也失败，用 `pnpm make-install`。
3. **新建/改名主题目录后** 内核需重启才能索引（运行中新建目录可能 404）。
4. **`public/` 本身不被 Vite 监听**：`vite.config.ts` 用 `watch-external`（`fast-glob` 扫 `public/**` 与 `README*.md`）把这两类文件加入 watch，改动会触发重建（与 arco 一致）；新增其它静态目录时记得同步这里。
5. **TypeScript 7 移除了 `baseUrl`**；项目引用模式下必须用 `tsc -b --force`（`--noEmit` 会假绿）。

## 6. 脚本与 arco 的差异（复用说明）

脚本文件、结构与错误处理均照搬 `siyuan-arco-calendar/scripts/`，仅做主题必需的最小改动：
