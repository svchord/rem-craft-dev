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

| 命令                             | 作用                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                       | **唯一开发命令**：Vite dev + 可见浏览器 + 自动 HMR（替代 build --watch） |
| `pnpm build`                     | clean → 清单校验 → 类型检查 → 构建 → 产物校验，并生成 `package.zip`      |
| `pnpm check`                     | 清单 + 格式 + 类型 + 单测                                                |
| `pnpm lint` / `pnpm format`      | oxlint / oxfmt                                                           |
| `pnpm make-link`                 | 把 `dev/` 软链到 `<workspace>/data/themes/<theme.name>`（只需一次）      |
| `pnpm make-install`              | 构建后把 `dist/` 复制到主题目录（正式体验用）                            |
| `pnpm inspect [选择器] [--shot]` | 读取真实 DOM 计算样式 + 命中规则（可选截图）                             |
| `pnpm audit`                     | 一次性完整体检：新开浏览器扫描选择器命中率（回归用）                     |

> 发版：合并到 `main` 后由 **semantic-release** 全自动完成——按 Conventional Commits 计算版本、更新 `package.json` 与 `public/theme.json`、写 `CHANGELOG.md`、打 tag、构建并上传 `package.zip`。无需手动操作，也不需要 Release PR。

## 4. 开发流程

```bash
pnpm install
pnpm dev            # 一条命令：起 Vite + 打开可见浏览器（自动 HMR）
pnpm make-link      # 只需一次：把 dev/ 软链到主题目录
# 首次还需在思源里选一次「Rem Craft Dev」
```

- 默认 `pnpm dev` 只做重建，改完需手动刷新；想保存即生效用 §4.2 的片段方案。
- 思源未启动时，`make-link` 会自动读取 `~/.config/siyuan/workspace.json` 兜底；也可显式指定：
  `SIYUAN_THEME_DIR="D:\Document\siyuan\data\themes" pnpm make-link`。
- 若工作区开了 API token，脚本会自动从 `conf/conf.json` 读取（也可用 `SIYUAN_TOKEN` 覆盖）。

## 4.1 一条命令开发（`pnpm dev`）

```bash
pnpm dev        # 起 Vite dev server + 可见浏览器窗口 + 自动注入 HMR
```

它做四件事：启动 Vite（5273）、打开可见浏览器窗口（思源前端）、**自动注入 HMR 客户端**、暴露 CDP 端口（9444）。

实测日志：

```text
[dev] vite ready: http://127.0.0.1:5273
[dev] opened: http://127.0.0.1:58535/stage/build/desktop/?r=...
[dev] HMR injected: ok
```

改 `src/styles/**` 后约 300ms 浏览器自动生效，不用刷新，也不用代码片段。

## 4.2 查看渲染结果（`pnpm inspect`）

```bash
pnpm inspect .protyle-wysiwyg        # 读计算样式 + 命中规则
pnpm inspect .protyle-wysiwyg --shot # 附带截图 inspect.png
pnpm audit                           # 一次性体检：选择器命中率 hit/miss（回归用）
```

`inspect` 输出真实计算样式与命中规则来源。实测（临时加 `.protyle-wysiwyg { max-width: 900px }`）：

```text
[inspect] theme=Rem Craft Dev hmr=true
=== .protyle-wysiwyg (匹配 1) ===
  color: rgb(32, 32, 36)
  font-size: 22px
  max-width: 900px          <- 规则确实生效
  -- 命中规则 (9 条，其中主题相关 1) --
    [(inline <style>)] .protyle-wysiwyg { max-width: 900px }
```

`audit` 与 `inspect` 的区别：`audit` 每次新开浏览器，额外对**所有选择器**做命中扫描，输出 `miss` 清单，适合思源升级后回归。

## 5. 已知坑（本机实测）

1. **`pnpm build` 会清理 `dev/`**（复用 arco 的 clean 脚本）。`dev/` 正是主题目录软链的目标，构建期间已安装的主题会短暂变空；开发时用 `pnpm dev`，不要并行跑 `pnpm build`。
2. **软链权限**：Windows 未开开发者模式时 `fs.symlinkSync` 报 EPERM；脚本已自动回退到 **junction**（本地目录无需管理员）。若 junction 也失败，用 `pnpm make-install`。
3. **新建/改名主题目录后** 内核需重启才能索引（运行中新建目录可能 404）。
4. **`public/` 本身不被 Vite 监听**：`vite.config.ts` 用 `watch-external`（`fast-glob` 扫 `public/**` 与 `README*.md`）把这两类文件加入 watch，改动会触发重建（与 arco 一致）；新增其它静态目录时记得同步这里。
5. **TypeScript 7 移除了 `baseUrl`**；项目引用模式下必须用 `tsc -b --force`（`--noEmit` 会假绿）。

## 6. 脚本与 arco 的差异（复用说明）

脚本文件、结构与错误处理均照搬 `siyuan-arco-calendar/scripts/`，仅做主题必需的最小改动：
