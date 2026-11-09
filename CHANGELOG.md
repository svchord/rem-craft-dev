# [3.1.0](https://github.com/svchord/rem-craft-dev/compare/v3.0.1...v3.1.0) (2026-11-04)


### Bug Fixes

* **dev:** pluginTarget 改为读磁盘 index.css，与主题对称 ([d5e831d](https://github.com/svchord/rem-craft-dev/commit/d5e831d4d4e332ec242d227d761cc721c9f59d4c))
* **devtools:** 修正 setPetalEnabled 的请求字段，去掉无效的 frontend ([2ff69db](https://github.com/svchord/rem-craft-dev/commit/2ff69dbecbe1f762a605631eb8cf6de926842e6a))
* **devtools:** 插件 JS 变更走 kernel 重载，主题侧不受影响 ([bee5d79](https://github.com/svchord/rem-craft-dev/commit/bee5d7996f691b68f3451c844d3ebf8d03224340))
* **dev:** 修复 open:theme 人工复审入口的截图挂起 ([52f8796](https://github.com/svchord/rem-craft-dev/commit/52f8796ab3fef73742add96ea8dd1355dcf051d3))
* **dev:** 重命名 audit 脚本并修正挂载与选择器解析 ([1fa8b14](https://github.com/svchord/rem-craft-dev/commit/1fa8b14b0b75ffe7e8f39b17a6305cb052620516))
* **styles:** 修复桥接色双重包装，补齐移动端 frontends ([ed7c93b](https://github.com/svchord/rem-craft-dev/commit/ed7c93b39e8acf818c497624167c422cca399d19))


### Features

* **audit:** 加 measure audit，一次会话跑完计划里的全部测量 ([6ff4967](https://github.com/svchord/rem-craft-dev/commit/6ff49675196a92a01aa978cb253021bf27abfdf5))
* **devtools:** 统一 CLI、可扩展类型注册表、与构建工具解耦 ([390ec15](https://github.com/svchord/rem-craft-dev/commit/390ec1530010eb06956e10548bb2c13e9b620487))
* **dev:** 审计改为真实页面测量并支持交互驱动 ([6b07975](https://github.com/svchord/rem-craft-dev/commit/6b07975b5b88e750db982675d33385c183a1eee6))
* **dev:** 审计能力泛化到插件，收敛到 targets 适配器 ([a6fcfd4](https://github.com/svchord/rem-craft-dev/commit/a6fcfd4cb866761eafff695a65e4498f41a702bd))
* **dev:** 拆分 CDP 工具为 session/probes 模块并增强 audit ([ec71cae](https://github.com/svchord/rem-craft-dev/commit/ec71cae739cc8277371e70cfe7a9c3f542da6078))
* **dev:** 重写为「改样式→热更新→自动审计渲染」闭环 ([389af57](https://github.com/svchord/rem-craft-dev/commit/389af57f0298e463659a9f528a0c3d70ef6af52f)), closes [#themeStyle](https://github.com/svchord/rem-craft-dev/issues/themeStyle)
* **plugin:** 删掉 enabled 参数，加产物校验与打包（收尾插件） ([209f79b](https://github.com/svchord/rem-craft-dev/commit/209f79b9b50254d1506c1dc1e5a26e611b72eb4b))
* **plugin:** 把清单搬运与 public 监听收进包，支持 target 入参 ([26c085c](https://github.com/svchord/rem-craft-dev/commit/26c085cf673d690e4e435eef13aef1ccbd7ff58c))
* **plugin:** 构建配置改由插件按类型注入，项目只传入参 ([f10f2ec](https://github.com/svchord/rem-craft-dev/commit/f10f2ecf5f064e14f28080bb77a9b01e56bb93fb))
* **plugin:** 统一 entry 入参，构建配置按类型注入且补缺不覆盖 ([747e182](https://github.com/svchord/rem-craft-dev/commit/747e182669d70b0b135fb7313974cb5a7754891c))

## [3.2.0](https://github.com/svchord/rem-craft-dev/compare/v3.1.0...v3.2.0) (2026-11-09)


### Features

* **devkit:** measure 复用页面时先跟磁盘对齐 CSS，不再每次新开浏览器 ([b236379](https://github.com/svchord/rem-craft-dev/commit/b236379eab3cfcbb61f90178ce710c3980a9c7c7))
* **devkit:** 主题热更新可作用到本体（内核广播），并删掉 syncCopy ([0d75dfe](https://github.com/svchord/rem-craft-dev/commit/0d75dfe42c3a960910b01357f7d4b93cdccaac06))
* **devkit:** 加 auditBrowser 开关，默认关闭常驻测量页；--attach 连不上报错给 agent ([2dcaa6a](https://github.com/svchord/rem-craft-dev/commit/2dcaa6aa3e6debfb71f20d3e927d6b366ed8f81f))


### Bug Fixes

* **devkit:** 修 Windows 链接类型误判与一批审查发现的问题 ([9f7e358](https://github.com/svchord/rem-craft-dev/commit/9f7e3584977515157f63e9b2497b286e3152da51))
* **devkit:** 修回主题热重载，并如实报告「未热重载」 ([146096f](https://github.com/svchord/rem-craft-dev/commit/146096fc978e07cf6bb238e033ac35ea88fa7281))
* **devkit:** 复用页面测量时把插件 CSS 也跟磁盘对齐 ([f99ddfe](https://github.com/svchord/rem-craft-dev/commit/f99ddfea806ada6619851c00b9b73c4b0b4cc4bc))
* **devkit:** 插件 JS 的热重载不再被「没有受控页面」挡掉 ([51274c7](https://github.com/svchord/rem-craft-dev/commit/51274c71a0cd399c4dd153fb90c0b038bcb97ba8))
* **devkit:** 收尾审计：堵住异常状态下的静默降级与资源泄漏 ([34a07ac](https://github.com/svchord/rem-craft-dev/commit/34a07acd04f48102c683294a7600d5dba7445b0a))


### Reverts

* **devkit:** 撤回「切主题再切回」广播，补上测量读数出处 ([99afc88](https://github.com/svchord/rem-craft-dev/commit/99afc882d44054ebc45d67a1a8b3e3ad036d5c11))

## [3.0.1](https://github.com/svchord/rem-craft-dev/compare/v3.0.0...v3.0.1) (2026-11-01)


### Bug Fixes

* **docs:** 说明 pnpm dev 需要思源正在运行 ([1a78c97](https://github.com/svchord/rem-craft-dev/commit/1a78c97c20648c6e97bad4f016dde595f9d50581))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.0.14](https://github.com/svchord/rem-craft-dev/compare/v0.0.13...v0.0.14) (2023-05-17)


### Bug Fixes

* test ([34ce102](https://github.com/svchord/rem-craft-dev/commit/34ce10205562d7b866b5c294b6973d33be5ae761))

### [0.0.13](https://github.com/svchord/rem-craft-dev/compare/v0.0.12...v0.0.13) (2023-05-17)

### [0.0.12](https://github.com/svchord/rem-craft-dev/compare/v0.0.11...v0.0.12) (2023-05-17)

### [0.0.11](https://github.com/svchord/rem-craft-dev/compare/v0.0.10...v0.0.11) (2023-05-17)

### [0.0.10](https://github.com/svchord/rem-craft-dev/compare/v0.0.9...v0.0.10) (2023-05-17)

### [0.0.9](https://github.com/svchord/rem-craft-dev/compare/v0.0.8...v0.0.9) (2023-05-17)

### [0.0.8](https://github.com/svchord/rem-craft-dev/compare/v0.0.7...v0.0.8) (2023-05-11)

### [0.0.7](https://github.com/svchord/rem-craft-dev/compare/v0.0.6...v0.0.7) (2023-05-11)

### [0.0.6](https://github.com/svchord/rem-craft-dev/compare/v0.0.5...v0.0.6) (2023-05-11)

### [0.0.5](https://github.com/svchord/rem-craft-dev/compare/v0.0.4...v0.0.5) (2023-05-11)

### [0.0.4](https://github.com/svchord/rem-craft-dev/compare/v0.0.3...v0.0.4) (2023-05-11)

### [0.0.3](https://github.com/svchord/rem-craft-dev/compare/v0.0.2...v0.0.3) (2023-05-11)

### [0.0.2](https://github.com/svchord/rem-craft-dev/compare/v0.0.1...v0.0.2) (2023-05-11)

### 0.0.1 (2023-05-11)


### Features

* 初次尝试 ([a2a168f](https://github.com/svchord/rem-craft-dev/commit/a2a168fb19b829053b70be8c3ac6f55cc8b4f042))
