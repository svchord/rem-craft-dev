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

## [3.2.0](https://github.com/svchord/rem-craft-dev/compare/v3.1.0...v3.2.0) (2026-11-19)


### Features

* **devkit:** measure 复用页面时先跟磁盘对齐 CSS，不再每次新开浏览器 ([b236379](https://github.com/svchord/rem-craft-dev/commit/b236379eab3cfcbb61f90178ce710c3980a9c7c7))
* **devkit:** 主题热更新可作用到本体（内核广播），并删掉 syncCopy ([0d75dfe](https://github.com/svchord/rem-craft-dev/commit/0d75dfe42c3a960910b01357f7d4b93cdccaac06))
* **devkit:** 加 auditBrowser 开关，默认关闭常驻测量页；--attach 连不上报错给 agent ([2dcaa6a](https://github.com/svchord/rem-craft-dev/commit/2dcaa6aa3e6debfb71f20d3e927d6b366ed8f81f))
* dock 与菜单项接入水波纹 ([75674f5](https://github.com/svchord/rem-craft-dev/commit/75674f51938d3b344537e298286109a674520f62))
* **theme:** 增加 shared field mixin 与 input 样式 ([2967483](https://github.com/svchord/rem-craft-dev/commit/29674830c4df81984f5ef75aed0377719b960cbd))
* **theme:** 增加种子色选项 ([1c7e7f0](https://github.com/svchord/rem-craft-dev/commit/1c7e7f0260af266415bd53c7ad10bf10a112b9d8))
* **theme:** 复刻按钮、开关、进度、下拉基础组件 ([165cd22](https://github.com/svchord/rem-craft-dev/commit/165cd22d71d93634b8496fbf9261ff325db273f2))
* **theme:** 复刻菜单、对话框、停靠栏基础组件样式 ([098514a](https://github.com/svchord/rem-craft-dev/commit/098514afa9d7f37a8da54cbfa7d0036d2205f35a))
* **theme:** 按 GM3 语义角色重建默认调色板 ([9d54327](https://github.com/svchord/rem-craft-dev/commit/9d5432786f4b5d23c42b5f2946ff836556fdbfae))
* **theme:** 按 Google Account 设置页样式重做设置弹窗 ([7beb996](https://github.com/svchord/rem-craft-dev/commit/7beb9968aa082d63efa7d2560818e760135dec96))
* **theme:** 按 M3 规格实现 slider ([f56e8d8](https://github.com/svchord/rem-craft-dev/commit/f56e8d867bca67c1eff106c038a737b024d2465e))
* **theme:** 按架构落地 M3 token 层与思源桥接 ([ee372d3](https://github.com/svchord/rem-craft-dev/commit/ee372d35d96dd558f35240097b3fc1739c44c049))
* **theme:** 支持 theme-setting.json 驱动组件选项 ([991ccc5](https://github.com/svchord/rem-craft-dev/commit/991ccc5deae32668af494741c1e190ee3beaac4f))
* **theme:** 移动端设置抽屉沿用桌面配色 ([a68552d](https://github.com/svchord/rem-craft-dev/commit/a68552dc497e8feeab0c00dff69b8de09d518f29))
* **theme:** 统一 field 样式并补齐按钮、链接与图标按钮 ([f34a390](https://github.com/svchord/rem-craft-dev/commit/f34a39051acfdee8bf7b3586154c6bc9ae678819))
* **theme:** 统一滑块与动态滚动条样式并支持插件增强 ([2ff0151](https://github.com/svchord/rem-craft-dev/commit/2ff01518c31c1f6cc78f8b28868f6b7bce9d8484))
* **theme:** 统一设置页与移动端菜单的 M3 样式 ([f69ca0e](https://github.com/svchord/rem-craft-dev/commit/f69ca0e8d098b8cf1951e64f0983d1bc464077d0))
* **theme:** 设置页左侧导航按 M3 navigation rail 重构 ([f2cb63f](https://github.com/svchord/rem-craft-dev/commit/f2cb63f55c1f836759569a554218f581e4369592))
* **theme:** 配置改为 tabs → groups 结构 ([13f7e02](https://github.com/svchord/rem-craft-dev/commit/13f7e029ea02a126081dde8a32a6b136855745d5))
* **theme:** 静态 palette 切换为 Google Blue 种子 ([fd8da3a](https://github.com/svchord/rem-craft-dev/commit/fd8da3a8fe41015e14277629e8c265bd363215aa))
* **theme:** 顶栏图标按钮按 button XS 档统一并接入水波纹 ([ab21d19](https://github.com/svchord/rem-craft-dev/commit/ab21d19c09abfe147350bd89bf95318607a0f555))


### Bug Fixes

* **devkit:** 修 Windows 链接类型误判与一批审查发现的问题 ([9f7e358](https://github.com/svchord/rem-craft-dev/commit/9f7e3584977515157f63e9b2497b286e3152da51))
* **devkit:** 修回主题热重载，并如实报告「未热重载」 ([146096f](https://github.com/svchord/rem-craft-dev/commit/146096fc978e07cf6bb238e033ac35ea88fa7281))
* **devkit:** 复用页面测量时把插件 CSS 也跟磁盘对齐 ([f99ddfe](https://github.com/svchord/rem-craft-dev/commit/f99ddfea806ada6619851c00b9b73c4b0b4cc4bc))
* **devkit:** 插件 JS 的热重载不再被「没有受控页面」挡掉 ([51274c7](https://github.com/svchord/rem-craft-dev/commit/51274c71a0cd399c4dd153fb90c0b038bcb97ba8))
* **devkit:** 收尾审计：堵住异常状态下的静默降级与资源泄漏 ([34a07ac](https://github.com/svchord/rem-craft-dev/commit/34a07acd04f48102c683294a7600d5dba7445b0a))
* **theme:** dock 顶部对齐面板并让激活态使用主色 ([aa51750](https://github.com/svchord/rem-craft-dev/commit/aa517503a2d89b384230934df3771289003bbdc6))
* **theme:** menu 圆角放大、行高收紧并补子菜单 ([2d4a4fa](https://github.com/svchord/rem-craft-dev/commit/2d4a4fa14c68e9582a34971bbbfcb6bab22b2ddc))
* **theme:** menu 容器裁切溢出，dock 间距收紧到 4px ([7906b5c](https://github.com/svchord/rem-craft-dev/commit/7906b5c646f8e4e2eabc16bbbcf25fe4130c2e12))
* **theme:** menu 对齐 M3 规格，dock 改用 flex gap ([37a2e14](https://github.com/svchord/rem-craft-dev/commit/37a2e1484bb32a0606fa38f14c0dbbd5e1166323))
* **theme:** select 恢复全圆角，switch 手柄改为固定尺寸线性滑动 ([4097f4b](https://github.com/svchord/rem-craft-dev/commit/4097f4bd6f81e0c5ee511b0d2d637fd41ae24c01))
* **theme:** switch 回到 M3 原尺寸与 16/24 手柄 ([196c9f1](https://github.com/svchord/rem-craft-dev/commit/196c9f1850a9570706600574fbee653e501ffc41))
* **theme:** switch 手柄改为垂直居中位移，消除斜向漂移 ([a4ee63e](https://github.com/svchord/rem-craft-dev/commit/a4ee63ef7e7c9667817c641753edd7c7f7f29931))
* **theme:** switch 按下态放大到 M3 的 28dp ([3f7dc51](https://github.com/svchord/rem-craft-dev/commit/3f7dc51d329cfadc247917a10ebb751a5c3a3086))
* **theme:** switch 放大到 32x20 并改用 M3 emphasized 缓动 ([baaa48c](https://github.com/svchord/rem-craft-dev/commit/baaa48c038ea479a5fb609c4b9d58c9abe5e7ec4))
* **theme:** 修复开关伪元素定位，组件回到 M3 实际规格 ([6c322c5](https://github.com/svchord/rem-craft-dev/commit/6c322c5531918d676e613628fca8943b417f4072))
* **theme:** 修正 select 悬浮与选中态 ([c14bba6](https://github.com/svchord/rem-craft-dev/commit/c14bba62b748820a24b69179ff0d3fce94b94569))
* **theme:** 修正窄屏设置栏首个胶囊与正文的错位 ([eb5da9d](https://github.com/svchord/rem-craft-dev/commit/eb5da9dd2eec979d10868111b61bf64b9587ec88))
* **theme:** 停靠栏按 M3 icon button 复刻 ([0d2f038](https://github.com/svchord/rem-craft-dev/commit/0d2f038d10d7a306053e1a8e1e0a21fd9edbd8d5))
* **theme:** 停靠栏按 M3 nav rail 等比缩放 ([d524af6](https://github.com/svchord/rem-craft-dev/commit/d524af6ea115a43c410f6a2cf10c55c1b743915f))
* **theme:** 停靠栏改用 M3 square icon button ([0c50bd1](https://github.com/svchord/rem-craft-dev/commit/0c50bd10b751d7322a371efaa42be06f6945c8cb))
* **theme:** 停靠栏激活态保留浅色底、图标用主色 ([00808a1](https://github.com/svchord/rem-craft-dev/commit/00808a111cc412622dfc26da513aded08e04a4e0))
* **theme:** 关闭思源原生 body 渐变并重调停靠栏比例 ([b3de5c8](https://github.com/svchord/rem-craft-dev/commit/b3de5c8b78932605fee79dc5ae037fa85ba5359b))
* **theme:** 动态滚动条复用旋转后的 slider 手柄 ([91706cf](https://github.com/svchord/rem-craft-dev/commit/91706cf27be96e97dd773097a1c5f068a0a0f4f1))
* **theme:** 固定 slider 手柄宽度并恢复竖版滚动条 ([0faf3b8](https://github.com/svchord/rem-craft-dev/commit/0faf3b8e6da43a1ca77c6dcbd1c3ae18bd17befa))
* **theme:** 基础组件按思源桌面密度缩放 ([9ea0e2f](https://github.com/svchord/rem-craft-dev/commit/9ea0e2ffde529d9c14731581864a6748d9f539a6))
* **theme:** 开关手柄改回 50% 居中定位，恢复关闭态描边 ([f4925ea](https://github.com/svchord/rem-craft-dev/commit/f4925eaa6c9bcdeded6640df394f234ff4dc929a))
* **theme:** 恢复 dock 图标间距并收紧 menu 行高 ([4ff153b](https://github.com/svchord/rem-craft-dev/commit/4ff153beee1c9f64fa80ee7d808c050c8e1aeae3))
* **theme:** 按 M3 token 实测修正按钮、开关、下拉、进度 ([9a3f529](https://github.com/svchord/rem-craft-dev/commit/9a3f5292b6f7ffa660a4990508fb89eb2fe1ffa3))
* **theme:** 按 M3 token 统一 field 与按钮状态层 ([dada8b0](https://github.com/svchord/rem-craft-dev/commit/dada8b06d847d15442675de63a47b3bb8d0cf03d))
* **theme:** 按钮改用 M3 XS 32dp 并移除 size token ([612e0d6](https://github.com/svchord/rem-craft-dev/commit/612e0d6e6d7f740d8ace2719be2c100ac25123fe))
* **theme:** 用 config--mobile 直接覆盖移动端设置底色 ([0d49899](https://github.com/svchord/rem-craft-dev/commit/0d49899a97a50dcc03057aa57383e01597f21ac1))
* **theme:** 移动端设置页背景与条目样式对齐桌面 ([bb28328](https://github.com/svchord/rem-craft-dev/commit/bb28328d941eab70046ab73c27237caaefc1b09a))
* **theme:** 移动端设置项与开关按 M3 原尺寸 ([e55be1c](https://github.com/svchord/rem-craft-dev/commit/e55be1c144f7cc55a7332f9253a8484004700a2f))
* **theme:** 组件按逐组件映射收紧，补尺寸规则 ([bcb8af8](https://github.com/svchord/rem-craft-dev/commit/bcb8af8d715714d78fec889eea3c8f216a9fdcc0))
* **theme:** 统一 32px 控件与设置侧栏尺寸 ([e571f98](https://github.com/svchord/rem-craft-dev/commit/e571f98a80772fa95b5c1b85aaa7c3b4dc4dc64a))
* **theme:** 统一移动端设置与主菜单列表样式 ([67eab29](https://github.com/svchord/rem-craft-dev/commit/67eab29db2c9b6f998accbb8c4c9c1c14e17e9b0))
* **theme:** 统一组件尺寸换算并修正 field 与 switch 尺寸 ([6284aba](https://github.com/svchord/rem-craft-dev/commit/6284aba9919987f3f3f53d7f40b04a7a96dc1648))
* **theme:** 补充桌面设置项间距 ([42c625e](https://github.com/svchord/rem-craft-dev/commit/42c625e17addbbe6e47ac3f759e35f2ad18503e8))
* **theme:** 调整设置左栏 tab 尺寸与间距 ([617a18c](https://github.com/svchord/rem-craft-dev/commit/617a18cdf6306397ed348e92ac922c533fb43293))
* **theme:** 页面底色改用 M3 surface 容器层级 ([3af0d37](https://github.com/svchord/rem-craft-dev/commit/3af0d372988f3ffd71decc52e895cfd0ffc48700))
* **unocss:** 让 opt: 与 p: 变体可链式组合 ([92b9e9c](https://github.com/svchord/rem-craft-dev/commit/92b9e9c6359eac746223bb4efe7e44544a404f70))


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
