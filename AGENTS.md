# AGENTS.md

## 依赖

`siyuan-devtools`（`../siyuan-devtools`）和 `vite-plugin-siyuan`（`../vite-plugin-siyuan`）通过 `link:` 指向本地仓库。开发中碰到问题直接去这两个本地项目改源码，不要在本仓库里绕开。改完执行 `pnpm build`，否则链接到的还是旧的 `dist`。

## 提交

- `package.json` 和 `pnpm-lock.yaml` 里的 `link:` 改动禁止提交，留在工作区。
- 用户没有明确说“提交”时，改完只汇报结果，不要 `git commit`；等用户确认后再提交。

## 代码

- 注释只保留解释「为什么这么做」的必要说明（约束、陷阱、外部契约）。不要复述代码在做什么，不要写段落式设计文档，设计文档在 `docs/`。
- 组件样式优先用 UnoCSS 短工具类（`@apply`）：能用工具类表达的尺寸、间距、字体、圆角、阴影、布局都不要再写原生 CSS 声明。只有工具类表达不了的（复杂选择器、未知属性、浏览器前缀）才写原生属性。
- 用最简单的方式实现：能用 `gap` 就不用相邻选择器，能用一个属性就不用两个，能靠容器布局就不用额外包裹。不要为同一效果叠多层补偿写法。

## 样式验证

- 改基础组件前先读对应的 M3 comp token；改完必须用 `siyuan-devtools` 读取实际渲染的计算样式（尺寸、圆角、颜色、间距），逐项对照 M3 token。没测量过不得声称符合 M3。
- M3 comp token 是移动端触控尺寸。按 `docs/architecture.md` §9.2 的映射：switch 52×32→40×24（0.75）、select 56→28（0.5）、button 40→28（0.7，M3 density -3）、progress 4→4（1）。字体不随几何缩放，按钮/Select 保持 14/20。
- 除非用户明确要求，不要为了汇报反复截图；测量优先用 `siyuan-devtools read element` / `read tokens`，需要最终视觉确认时再截一次。
