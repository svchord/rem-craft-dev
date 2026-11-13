# AGENTS.md

## 本地依赖可以直接改

`siyuan-devtools`（`../siyuan-devtools`）和 `vite-plugin-siyuan`（`../vite-plugin-siyuan`）通过
`link:` 指向本地仓库。开发中碰到问题直接去这两个本地项目改源码，不要在本仓库里绕开。改完执行
`pnpm build`，否则链接到的还是旧的 `dist`。

## 这两个 link 不要提交

`package.json` 和 `pnpm-lock.yaml` 里的 `link:` 改动禁止提交，留在工作区即可。

## 注释只写必要的

代码里的注释只保留解释「为什么这么做」的必要说明（约束、陷阱、外部契约）。
不要复述代码在做什么，不要写段落式设计文档——设计文档在 `docs/`。
