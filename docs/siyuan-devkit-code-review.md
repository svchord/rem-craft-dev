# siyuan-devkit 代码审查报告

> 审查对象：`packages/siyuan-devkit`（workspace 包 `syt`），关联 `vite.config.ts`、`package.json`、`README.md`、`tests/`。
> 方式：全量只读审查 + 交叉复现验证，**未修改任何源码**。
> 基线：`pnpm --filter siyuan-devkit type-check` 通过；`pnpm --filter siyuan-devkit test` 通过（2 文件 / 120 用例 / 2.17s）；`pnpm --filter siyuan-devkit build` 产物存在。

> **⚠️ 本报告已经过第二轮独立复核与修复。** 复核用三组独立「怀疑者」逐条找反证（实测 Node 脚本、真实 tsc 编译、全仓 grep、PowerShell 复现），
> 剔除/修正了 **11 条误报或表述过度**，并发现 **3 条原始修复建议本身有坑**（会引入新 bug）。
> 复核结论与已落地的修复见文末 [§九 复核结论](#九复核结论与修复落地)。**以 §九 为准，正文保留原始判断以便追溯。**

## 0. 范围与口径

| 层               | 文件数 | 总行数   | 非空行   | 说明                                |
| ---------------- | ------ | -------- | -------- | ----------------------------------- |
| `src/core/`      | 27     | 3877     | 3549     | 契约 / 测量原语 / 运行时胶水        |
| `src/cli/`       | 8      | 1296     | 1163     | CLI 入口与 8 个子命令处理函数       |
| `src/plugin/`    | 5      | 1135     | 1037     | Vite 插件三件套 + state/shared      |
| `src/dev/`       | 3      | 769      | 711      | 构建看护 + 会话层 + startDev        |
| `src/index.ts`   | 1      | 155      | 147      | 公共 barrel                         |
| `tests/`（包内） | 2      | 1739     | 1566     | `devtools.test.ts` 1588 行 / 79.6KB |
| 合计源码         | **44** | **7232** | **6636** |                                     |

包 `"private": true`（从不发布），`exports` 只映射 `.` 与 `./package.json`；全仓从 `siyuan-devkit` 的真实 import 只有 `vite.config.ts:5` 一处，且只用 `siyuanPlugin`。

---

## 一、总体结论（先回答用户的四个问题）

1. **代码组织 / 目录设计**：**分层方向基本守住了，但"共享契约落 core"这条自定规则被复制粘贴破坏了，且公共 API 面严重过宽。** `core/ → dev/ → plugin|cli` 依赖方向干净（core 内 `vite` / `process.exit` / 反向 import 均 0 命中），`dev/` 确实不依赖 vite 运行时（只有 4 处 `import type`，全在 `plugin/`）。问题不在"切分"，而在"同一份事实有多个真值源"和"把内部实现全部升级为公开契约"。
2. **冗余 / 过度设计 / 坏味道**：**冗余是真的，且集中在跨层工具函数、人读渲染器、错误归一化、outDir 推导四处**；过度设计主要是「为唯一消费者维护 76 个运行时导出 + 三个可单独组合的插件 + 可选扩展点」。但也有大量**看似可疑其实合理**的设计（见 §2.4），不要一律砍。
3. **边界情况**：**文件系统 / HTTP / 清单校验 / zip 这几块考虑得相当充分**（`errors.ts` 的可恢复错误分界是全包最有价值的改进）；但**主功能面（测量原语、参数解析、`--json` 输出、租约超时）几乎零行为测试**，属于"把预算花错了地方"，不是"考虑得太多"。
4. **过度防御 / 不必要用例**：**两者都存在，但形态不同**。过度防御表现为 7 个不可达判别校验、README 散文逐条镜像成正则断言、41/111 个静态源码断言、死锁代码；不必要用例的**硬冗余只有 5–7 个（约 5%）**，真正的问题是约 40% 的用例预算花在"防旧代码复活"上而非行为验证。

**一句话**：这是一个设计意图清醒、注释详尽、经过多轮重构去重的包；它的主要风险不是"没想清楚"，而是**重构留下的多套真值源、过宽的公开面、以及用源码正则代替行为测试的自我审查方式**。

---

## 二、代码组织与目录设计

### 2.1 做得好、不要改的部分（明确辨析）

| 设计                                                                            | 证据                                                                                                                                                                                                                                  | 判定                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `guards.ts`(12行) / `log.ts`(20行) / `net.ts`(15行) / `semver.ts`(5行) 等薄文件 | `guards.ts` 被 9 个 core 模块引用；`semver.ts` 被 `verify.ts:15` 与 `builtin-targets.ts:15` 共用，独立成文件是为**避免 verify ↔ 描述符循环依赖**（`semver.ts:3-4`）；`log.ts` 放 core 是为避免 plugin 反向 import dev（`log.ts:4-6`） | **合理，薄不等于该合并**                 |
| `timing.ts` / `errors.ts` / `paths.ts` 的集中化                                 | `timing.ts:1-10` 记录消灭「十几个裸数字散在 4 个文件」；`errors.ts:4-6` 记录消灭「20 多处 `catch{return null}` 连 TypeError 都吞」；`paths.ts:1-7` 记录 `samePath` 曾被写 4 份；grep 确认现在各只剩 1 份                              | **本次组织里最值得肯定的部分**           |
| `cli/targets.ts`、`cli/audit.ts` 独立成文件                                     | `cli/targets.ts:4-6` 记录合并了两份 `resolveTarget`；`audit.ts:4-6` 理由成立（计划决定 frontend/viewport/target，必须在 createSession 前解析）                                                                                        | **是去重成果，不是可合并项**             |
| 三个 Vite 插件拆分                                                              | 钩子集合不同 + `enforce:'post'` 无法合并（`plugin.ts:320-473` 返回数组）；`README.md:140` 与 `tests/devtools.test.ts:833` 都有依据                                                                                                    | **结构拆分必要**                         |
| `??=` 注入、`enforce:'post'`、junction/端口/清单/UAC 防御                       | `plugin.ts:355-388`、`post.ts:229`、`core/link.ts:140-194`                                                                                                                                                                            | **必要复杂度**                           |
| `crcEntry` 守卫 `post.ts:127-131`                                               | 索引恒在 `[0,255]`，看似不可达；但 `tsconfig.json:19` 开了 `noUncheckedIndexedAccess`，它是为收窄 `number \| undefined` 的类型需要                                                                                                    | **其实合理，不要删**                     |
| `cli-args.ts` 手写解析器                                                        | 令牌名本身以 `--` 开头（`--rc-brand-8`），用 commander/minimist 必须加 `--` 分隔符；全包约 14 个选项，30 行代码比依赖便宜                                                                                                             | **不要换掉，真正问题是实现有漏（§5.1）** |

### 2.2 确认的问题

**【高】`package.json` 缺 `./plugin` 导出，但 4 处文档都推荐它，且推荐写法本身也是错的。**
`package.json:13-19` 的 `exports` 只有 `.` 与 `./package.json`。实测：

```
$ node -e "import('siyuan-devkit/plugin')..."
FAIL: ERR_PACKAGE_PATH_NOT_EXPORTED
$ node -e "import('siyuan-devkit')..."
OK, exports: 76 | has default: false | siyuanPlugin: true
```

- `README.md:15`（**首要示例**）、`src/index.ts:7`、`src/cli/cli.ts:68`、`src/plugin/plugin.ts:6` 都写 `import siyuan from 'siyuan-devkit/plugin'`；
- 即使补上子路径，根导出**没有 default export**，这行仍然拿不到东西。项目自己用的是 `vite.config.ts:5` 的 `import { siyuanPlugin } from 'siyuan-devkit'`；
- `syt --help` 实测会把这条无法执行的指引打印给用户（`cli.ts:68`）。

**【中】`core/target-types.ts:16` 契约层反向依赖实现层。**

```ts
import { BUILTIN_TYPES } from './builtin-targets.ts'; // 运行时 import，非 import type
```

`target-types.ts` 自称「被测目标的**契约**与类型注册表」，却把 `builtin-targets.ts` 拉进来，后者又拖入 `kernel.ts`、`siyuan.ts`（`spawn`/`child_process`）、`puppeteer-core` 类型。任何只想拿类型的模块都要加载整张运行时依赖图。`target-types.ts:11-13` 说明动机是「少一次副作用 import」，属于用依赖反转换便利，代价偏大。另有概念环 `target-types → builtin-targets → lints → (type) target-types`（因 `import type` 擦除，不构成运行时循环）。

**【中】`index.ts` 公共 API 面过宽，与 `private:true` + 单一消费者不匹配。**
`index.ts` 155 行里约 100 行是 re-export，导出 **76 个运行时符号 + 约 58 个类型**。但：

- 全仓真实 import 只有 `vite.config.ts:5` 的 `siyuanPlugin`；
- `siyuanAssets` / `siyuanPost` / `createPluginState` / `applyResolvedConfig` / `isWatchBuild` / `walkFiles` / `startDev` / `startDevSession` 在仓库内（含 tests、bin）**零调用点**；`writeZip` 仅被 `tests/devtools.test.ts:29,1546` 调用；
- 一个 `0.1.0` 的私有包已经背了一个 deprecated 别名：`index.ts:145-146` 的 `export { default as siyuan }` —— **为不存在的调用方做兼容**的典型。

**【中】README「不做成入参 / 固定行为」与公开子插件的实际 Options 冲突。**
`README.md:36-42`、`:151` 用绝对措辞说「链接、产物校验、public/ 资产监听都是固定行为，不做成入参」「资产插件固定启用」，但导出的子插件恰好提供了这些开关：

| 位置                                      | 开关                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| `plugin/post.ts:52`                       | `verify?: boolean` → `siyuanPost({verify:false})` 可关校验 |
| `plugin/assets.ts:56`                     | `watchPublic?: boolean` → 可关 public 监听                 |
| `plugin/assets.ts:54`                     | `extraFiles?: ...` → 整体替换清单推导                      |
| `dev/dev.ts:32` / `dev/dev-session.ts:62` | `link?: boolean` → 可关链接                                |

主入口 `SiYuanPluginOptions`（`plugin.ts:72-116`）确实只有 5 个字段、无 `enabled/pack/isWatch`，文档对主入口成立；被打破的是「一等公开 API 的逃生舱」，且逃生舱零消费者。

**【中】同一份事实有多套真值源（最系统性的组织问题）。**

- **outDir 6 处、5 种语义**：`plugin/state.ts:47`（`resolve(root, resolved.build.outDir)`）、`plugin/plugin.ts:356`（`build.outDir ??= outDir ?? spec.outDir`）、`plugin/assets.ts:221-226`（`bundleOptions.dir ?? state.outDir`）、`dev/dev.ts:84` 与 `dev/dev-session.ts:192`（`outDir ?? buildConfig.outDir`，两处逐字相同）、`core/verify.ts:68-70`、`cli/verify-cli.ts:83-89`（`dist→dev→描述符` 回退）。
- **watch 判定 2 处 + 一次只打日志的"对账"**：`state.ts:38-40` `isWatchBuild = Boolean(watch)`（只是 `Boolean()` 的具名包装）、`plugin.ts:340`、`plugin.ts:400-402`。
- **三个插件各挂一份相同的 `configResolved`**：`plugin.ts:394`、`assets.ts:193-195`、`post.ts:234-236`，组合时同一个 state 被写 3 次、值完全相同；注释自认是为「单独 import 时自填」的兜底，而该路径零消费者。
- **`StartDevOptions`（`dev.ts:24-44`）与 `StartDevSessionOptions`（`dev-session.ts:52-75`）7 个字段同名同类型**，JSDoc 也几乎逐字重复，`dev.ts:102-111` 只做原样转发。应 `extends`。
- **视口「唯一来源」名不副实**：`core/viewport.ts:2` 自称唯一来源、`:5-6` 注释甚至写着「CLI 应改为 import 这两个常量」，但 `dev/dev-session.ts:280`、`cli/shot.ts:112` 仍硬编码 `{width:1600,height:1000}`、`dev/dev-session.ts:94` 硬编码 `--window-size=1600,1000`；`page-read.ts:20` 的 `DEFAULT_BOX_LIMIT=5` 在 `cli/measure-cli.ts:369` 硬编码成 `?? 5`。
- **`probes.ts` 给「唯一实现」规则开例外**：`page-read.ts:2` 声称「浏览器侧读数的唯一实现」，但 23 行的 `core/probes.ts` 保留了一个独立 `page.evaluate`；`measure.ts:30-56` 又是 7 个一行转发门面；`index.ts:67` 与 `:82` 把 `tokens` / `probeTokens` 两个入口同时公开，包内部 `audit.ts:18,27` 自己也两种都用。

**【中】`cli/x.ts` 与 `core/x.ts` 同名（`audit.ts`、`targets.ts` 两对）是命名坏味道，但分层本身干净。**
一个叫 `audit.ts` 的文件 import 另一个 `audit.ts`（`cli/audit.ts:11`）。依赖方向单向（core 不 import cli），职责不重叠；坏处是编辑器标签、grep 混淆，且 `README.md:479` 把 `shot.ts` 与 core 文件并列列举、`README.md:468` 又没列 cli 下文件名，无从消歧。**别误判为分层崩坏。**

**【低】`src/index.ts:22-28` 的分层清单漏了 `guards.ts`**（被 9 个 core 模块引用的最底层叶子）；`README.md:452-469` 与 `index.ts:1-48` 是同一份分层说明的两份拷贝，已漂移（`index.ts:47` 有「也不各自暴露 bin」，README:468 没有）。

**【低】工作区遗留物（关联发现，非包源码）**：`node_modules/.bin/` 里 6 个 `siyuan-*` shim 指向**已不存在的包** `vite-plugin-siyuan`（`Test-Path` = False），是包重命名后的陈旧残留；根目录 `probe-w.mjs` 是一次性验证脚本，跑完留下 `.pwsye2u / .pwv6lct / .pwxzsz8 / .pwzt4tq / .watch-89ke` 五个临时目录，`.gitignore` 未覆盖。`dist/` 未被 git 跟踪（`git ls-files dist` = 0），这一项**是合理的**。

---

## 三、冗余代码与重复逻辑（带可引用证据）

### 3.1 跨层逐字重复（最该先修）

**`plugin/shared.ts` 把 core 的两份工具原样重写，且没有 import core：**

```ts
// core/guards.ts:2-4                    // plugin/shared.ts:29-31 —— 完全相同
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// core/errors.ts:82-84                  // plugin/shared.ts:34-36 —— 只换了名字
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
```

`plugin/ → core/` 是允许的方向（`plugin/plugin.ts:55-59`、`post.ts:29-31` 已在用），所以这是纯重复，不是被分层所迫。它直接违反 `README.md:471`「共享契约必须落在 `core/`」。

**同一模式还有第 3 份、第 4 份：** `grep` 显示 `cause instanceof Error ? cause.message : String(cause)` 在源码里有 **10 处内联**（`cli/cli.ts:94`、`cli/verify-cli.ts:78`、`cli/audit.ts:35`、`cli/targets.ts:26`、`dev/build.ts:74`、`dev/dev-session.ts:103,357`、`plugin/shared.ts:35`、`core/errors.ts:83`），而现成的 `describeError` 只在 `core/link.ts:264` 用了 1 次、`messageOf` 在 plugin 内用了 9 次。

**递归目录遍历两份同构实现**：`core/verify.ts:59-65` 的私有 `walk()` 与 `plugin/shared.ts:19-26` 的 `walkFiles()` 逐行同构，只差返回 `string[]` vs `{name,path}[]`；`plugin/assets.ts:165-167` 与 `:258-260` 文件内又内联了两份 `readdirSync(...).filter(isFile)`。

### 3.2 CLI 层的人读渲染器重复约 240 行

`cli/measure-cli.ts:150-154` 与 `cli/audit.ts:141-145` 的 `styleRows` **逐字相同**：

```ts
function styleRows(styles: Record<string, string>): Array<[string, string]> {
  return Object.entries(styles)
    .filter(([, value]) => Boolean(value))
    .map(([prop, value]) => [prop, value]);
}
```

`printHuman`（`measure-cli.ts:156-266`，~110 行）与 `printAuditHuman`（`audit.ts:148-276`，~128 行）在渲染同一批字段；「环境/令牌/命中数/对比度」区块（如 `measure-cli.ts:178-181` vs `audit.ts:181-184`）几乎逐行一致。**注意：只有 `audit.ts` 与 `measure-cli.ts` 大量重复，与 `verify-cli.ts`/`shot.ts`/`targets.ts` 基本没有。**

### 3.3 其它确认的重复

| 重复内容                                                       | 位置                                                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV 拆分三连 `.split(',').map(trim).filter(Boolean)`           | `cli/measure-cli.ts:302-304` 与 `cli/audit.ts:43-45`                                                                                                                                    |
| `createSession` + `try/finally dispose` 样板，连注释都逐字重复 | `cli/measure-cli.ts:295-298,310-314,421-423` 与 `cli/audit.ts:95-97,101-105,135-137`                                                                                                    |
| `JSON.stringify(x, null, 2)` 输出                              | `cli/measure-cli.ts:425-427` 与 `cli/audit.ts:116-130`                                                                                                                                  |
| `fail(...); process.exitCode = 2; return;` 五处                | `cli/verify-cli.ts:68-72,75-81`、`cli/audit.ts:32-38,69-74,75-82`；与 `cli.ts:89-102` 顶层兜底并存两套策略                                                                              |
| 「读 JSON + `requireRecoverable` 降级」5 处                    | `verify.ts:36-44`、`builtin-targets.ts:39-48,65-73`、`theme.ts:22-35`、`paths.ts:50-60`                                                                                                 |
| 端点 JSON 解析取 port 3 处                                     | `control-server.ts:84-92,268-270,307-309`                                                                                                                                               |
| 日志类型 3 份 / 默认实现 5 份                                  | `core/log.ts:17`、`plugin/assets.ts:31` `AssetLog`、`post.ts:56` 内联；`assets.ts:33`、`post.ts:59`、`dev.ts:62`、`dev-session.ts:187`、`plugin.ts:138-155`                             |
| `info` ≡ `section`、`linkRow` ≡ 单行 `list`                    | `cli/ui.ts:17-19` vs `:32-34`；`:49-51` vs `:54-56`                                                                                                                                     |
| 同一概念两套类型名                                             | `Sheet`(`lints.ts:10`) ≡ `CssSheet`(`target-types.ts:19-23`)；`MountJudgement`(`theme.ts:51-59`) vs `MountState`(`target-types.ts:26-33`) + `builtin-targets.ts:168-170` 手工丢 `exact` |

### 3.4 死代码 / 死导出（全仓 grep 确认零消费者）

| 位置                                                        | 导出                                                    | 证据                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/guards.ts:10`                                         | `isStringArray`                                         | 全仓仅定义处 1 次命中                                                                                                                            |
| `core/verify.ts:21`                                         | `export { isSemver } from './semver.ts'`                | 注释「兼容既有导入」，但 `builtin-targets.ts:15` 与 `verify.ts:15` 都直接 import `semver.ts`                                                     |
| `core/target-types.ts:275`                                  | `resetTargetTypes`                                      | 注释自称「仅供测试」，`devtools.test.ts` 未用                                                                                                    |
| `core/target-types.ts:228`                                  | `createTargetTypeRegistry`                              | 仅 `index.ts:102` 对外导出 + `target-types.ts:270` 内部自用                                                                                      |
| `core/control-server.ts:301`                                | `pruneDeadEndpoints`                                    | 定义 + 3 处注释，**0 调用点**、未从 index 导出                                                                                                   |
| `core/lints.ts:10`                                          | `Sheet`                                                 | 仅 `lints.ts:53` + `index.ts:81`                                                                                                                 |
| `core/paths.ts:37`、`core/workspace.ts:23`                  | `workspaceManifestCandidates` / `readWorkspaceManifest` | 仅文件内部调用却 `export`                                                                                                                        |
| `cli/ui.ts:8-14`                                            | `Level` 类型 + `status(_level, ...)` 的 `_level`        | 5 个调用点传 `'success'/'warn'/'info'`，函数体完全忽略它；为不存在的「分级排版」预留                                                             |
| `cli/measure-cli.ts:269`、`shot.ts:145`、`verify-cli.ts:54` | `runXCli(argv = process.argv.slice(2))` 默认参数        | `bin/cli.js:11` 只调 `runCli`，`cli.ts:90` 永远传显式数组；默认值若生效反而会含顶层命令 `measure` 而报错；`exports` 也不允许外部 import 这些函数 |
| `index.ts:145-146`                                          | deprecated `siyuan` 别名                                | 0.1.0 私有包，从未发布                                                                                                                           |

`pruneDeadEndpoints` 不只是死代码：文件头 `control-server.ts:12` 承诺「残留孤儿文件由它清理」，但 `startControlServer` 的 `stop()`（`:197-203`）只在正常退出删端点文件，SIGKILL 后必然残留，`discover()`（`:265-277`）每次都要为每个坏端点做一次带超时的 `probeEndpoint`——**死代码造成了运行时的功能缺口**。

---

## 四、过度设计与代码坏味道

### 4.1 确认为过度设计

- **【中】为唯一消费者维护「三个可单独组合的插件 + 12 个细粒度导出」**（`index.ts:144-155`）。成本是 `assets.ts`/`post.ts` 各一份 `options.state ?? createPluginState(...)` 双路径、各一份 `configResolved`、各一份 `defaultLog`，以及 `AssetsPluginOptions.manifestPath: string | ((root)=>string)` 的函数重载形态。结构拆分必要，**公开面过度**。
- **【中】`target-types.ts:203-304` 的完整注册表机制对 2 个内置类型偏重**：`register<T extends TargetDescriptor>` 的泛型 `T` 从未使用（`:221,234,280`），返回 `kind` 字符串无人使用；`detect` 概念有两份形状（`RegisterOptions.detect` `:204-207` 与 `TargetTypeEntry.detect` `:212`）；为死导出 `createTargetTypeRegistry` / `resetTargetTypes` 维护了「实例注册表 + 包级全局 + 重置」三套状态。**但要平衡**：`devtools.test.ts:337-368` 真的用 `registerTargetType('widget-runtime', ...)` 注册第三方类型，`cli/cli.ts:11` 也把它当卖点——不是纯臆想，严重度中而非高，该删的是空泛型和死导出。
- **【中】租约屏障 + 控制服务对当前仓库零收益**：`dev-session.ts:308-337` 的 `setReady(false) → waitForIdle → reloadUI → waitForApp → setReady(true)` 解决的是 `measure --attach` 刷新竞态，机制本身必要；但 `auditBrowser` 默认 `false`（`README.md:51`），唯一消费者 `vite.config.ts:37-39` 没开它——**默认配置下整套机制运行时完全不执行**。属"为尚未出现的场景预付复杂度"，建议保留但明确标注为可选能力。
- **【中】`ui.ts` 抽象过薄**：8 个函数中真正有独立语义的只有 `warn`(stderr) / `fail`(stderr) / `table`(表头) / `status`(label: detail)；`box()`（`:36-40`）名字与 `README.md:225`「不做边框」字面冲突、行为一致，会持续误导。
- **【中】超长函数 / 隐式状态机**：`startDevSession()`（`dev-session.ts:180-399`，~220 行，5 个闭包）、`siyuanDev()`（`plugin.ts:128-474`，~346 行）、`config()`（`:334-392`，5 层 `??=`）、`validatePlan`（`core/audit.ts:135-348`，213 行 / 8 段近同构字段校验）、`siyuanAssets().writeBundle`（`assets.ts:218-287`，`for→try→for→try`）。`plugin.ts:172-178` 与 `dev-session.ts:304-307` 的 `refreshing/pending/batchTimer/firstBundle/starting/configWatch` 六个可变标志构成隐式状态机。
- **【低】`shot.ts:80-89` 单个调用点的通用容错**：`--state` 只此一处用，却做成 `Record` 映射 + 未知值「警告后照常出图」；`--state drak` 会得到默认状态的图且退出 0。
- **【低】根 `vite.config.ts:18-30` 的 `minifyInWatch()` 与 `plugin/plugin.ts:359` 重复实现同一策略**：插件 `build.minify ??= watch ? false : true`，消费侧又在 `configResolved` 无条件设 `false/'esbuild'`，使插件注入成为事实死代码。`vite.config.ts:13-16` 的注释专门解释「早期自己解析 argv 与插件判据重复」，结果仍保留一份重复，与 `README.md:107`「minify 默认由插件按 watch 决定」矛盾。

### 4.2 其实合理、不要当问题（复核后排除）

- `AuditPlan` + `runPlan` + `validatePlan` 的 plan 抽象：`audit.ts:3-7` 给出量化动机，`cli/audit.ts:65-75` 确实串起来，配置驱动 CLI 的合理形态。
- `validatePlan` 跑两次（配置加载时 + merge 后）：`audit-config.ts:38` 校验文件、`audit.ts:68` 校验来自 argv 的未校验字符串，**对象不同，必要**。
- `builtin-targets.ts` 两个描述符 313 行：大部分是真实规则（i18n key 比对、Vite lib/cjs 细节、`resolveCss`/`activate`），`satisfies TargetDescriptor` 用编译期约束替代运行时能力清单，恰当。
- `verify.ts:29-33` 的局部 `VerifiableTarget`：为「只依赖契约类型、不 import targets.ts 以免循环」的最小投影，合理的依赖倒置；`VerifyOptions` 只有 `{root,outDir}`，**不存在"配置合并"抽象**。
- `link.ts:247-289` 的长文案：Windows symlink/junction/UAC 是难以自查的失败模式，对用户有价值。
- `cli-args.ts:41` `if (arg === undefined) continue;`：`tsconfig.json:19` 开了 `noUncheckedIndexedAccess`，是类型收窄所需，不是冗余容错。
- 链接 / 校验流程**没有**在 dev 与 plugin 两条链路各写一遍：链接只在 `dev-session.ts:229-242`、校验只在 `post.ts:242-260`（`syt verify` 复用 `verifyTarget`），两条形态汇流到同一个 `startDevSession`。重复的只是外围的 outDir/target 推导。

---

## 五、边界情况：必要防御 vs 过度防御

### 5.1 必要、做得好（不要删）

| 防御                                                  | 位置                                                                          | 理由                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 可恢复错误与编程错误分界                              | `core/errors.ts:50-63` `isRecoverable`/`requireRecoverable`，被 11 个模块使用 | 替换了原来「20 多处 `catch{return null}` 连 TypeError 都吞」；全包最重要的防御性改进                                                       |
| `--attach` 连不上直接报错、不静默降级                 | `core/session.ts:99-109`                                                      | 否则 agent 以为量的是 dev 常驻页，结论建立在错前提上；README 三处承诺 + `tests/cli-ui.test.ts:138-149` 回归                                |
| `--viewport` + `--attach` 冲突报错                    | `core/session.ts:113-117`                                                     | 常驻页视口建页时固定，静默忽略会让 agent 误判；`cli/measure-cli.ts:295-298`/`cli/audit.ts:95-97` 只在显式传值时 `parseViewport` 正是配合它 |
| 建链接前校验 srcPath / 父目录 / junction              | `core/link.ts:140-194`                                                        | 思源「静默加载不到」的失败模式，必须前置拒绝                                                                                               |
| 开浏览器前 `validatePlan` 校验用户 JSON               | `core/audit.ts:135`                                                           | 写错了在浏览器里才发现很浪费                                                                                                               |
| `createTargetOrReport` 先 `requireRecoverable` 再包装 | `cli/targets.ts:15-29`                                                        | 注释自述「以前五处裸 catch 连 TypeError 都吞，结果退出 0、mount 检查跳过」                                                                 |
| 会话/浏览器在 `finally` 释放                          | `measure-cli.ts:421-423`、`audit.ts:135-137`、`session.ts:222-233`            | 避免 `exitCode` 模式下吊住 event loop                                                                                                      |
| `??=` 注入、`enforce:'post'`、watch 下校验失败只警告  | `plugin.ts:355-388`、`post.ts:229,250-256`                                    | 与 `README.md:169-175` 一致                                                                                                                |
| 读租约 TTL / 非法 CSS 选择器结构化报错                | `control-server.ts:110-114`、`page-read.ts:168-173`                           | 多进程崩溃、用户写错选择器的真实边界                                                                                                       |

### 5.2 过度 / 有害的防御

- **【中】`core/page-read.ts:230-281` 7 个不可达判别校验**：`browserRead`（`:107-224`）是本文件私有的纯函数，`switch(spec.kind)` 每个分支都返回同名 `kind`；`evaluateRead`（`:226-228`）只把 spec 原样传它。因此 `readStyles/readCounts/readBoxes/readProbe/readEnvironment/readStyleOf/readPoint` 里的 `if (result.kind !== X) throw mismatched(...)` **全部不可达**，约 25 行纯仪式代码。注释的理由（「puppeteer 序列化后无法静态关联」）不成立——这里连序列化边界都没跨越。**这是最典型的「对不可能发生的输入层层校验」。**
- **【中】`core/builtin-targets.ts:285-288` `if (!state)` 永不进入**：`page.evaluate` 回调无条件返回对象字面量；页面不可用时 puppeteer 会**抛异常**（正由 `errors.ts:75-80` 的 `isNavigationError` 处理），不会返回 `null`。
- **【中】`core/post.ts:266-268` 同一件事三层兜底**：`verifyTarget` 已把「产物目录不存在」变成 issue 并 throw，`:266` 又 `if (!existsSync(outDir)) throw`，`writeZip` 里 `result.files === 0`（`:273-275`）再兜一次。
- **【中】`plugin/assets.ts:138-139` 冗余的路径逃逸检查还带假阳性**：`split('/').includes('..')` 已覆盖 `../foo`，`startsWith('..')` 多余，且会误拒 `..gitignore` / `..env` 这类合法文件名。
- **【中】`cli/shot.ts` 三处 `.catch(() => {})` 吞掉任何错误**（`:116-118`、`:136`），加上 `finally` 里两个空 catch（`:177-186`，注释「已经没了」）。对照 `core/session.ts:82-85` 的 `tolerateWaitFailure`（只容导航竞态 + `requireRecoverable`），shot.ts 连 TypeError 都吞；`rmSync` 已带 `force:true` 几乎不抛。`plugin/dev` 8 个文件里另有 10 处空 catch，清理阶段吞错可接受，但完全不区分 ENOENT 与编程错误。
- **【低】`core/errors.ts:43-48` 把任意 `SyntaxError` 当可恢复**：`SyntaxError` 不只来自 `JSON.parse`（`new Function`、动态 `import()` 语法错误也会抛），包自身代码抛的会被降级成 `null` 掩盖 bug。应限定在 `JSON.parse` 调用点。
- **【低】对已收窄的联合类型再做运行时校验**：`core/siyuan.ts:158-160` `Frontend = 'desktop'|'mobile'`，TS 已保证；`core/paths.ts:52` `if (!file || ...)` 中 `file` 恒为真；`core/workspace.ts:72` 对恒为字面量 `'themes'/'plugins'` 的 subdir 做存在性校验。
- **【低】`core/control-server.ts:84-92` 同一响应里严格/宽松混用**：`ws` 严格必填，`port`/`ready` 却静默兜底（`ready` 默认 `true`），会让旧版 dev 服务被当作可用。
- **【低】`plugin.ts:400-402` 的 `configWatch` 对账只打警告不改行为**；`core/audit-config.ts:44-49` 对 `.ts/.js` 配置多读一次 `readFileSync`（`text` 从未使用），且这次读取没有 `requireRecoverable` 包装。

### 5.3 该防没防（覆盖不足）

- `core/color.ts:25-29` `parseColor` 静默拒绝 `#1234` / `#11223344`（4/8 位带 alpha），返回 `null` 让 `contrastRatio` 静默给 `null` 而不解释。
- `core/session.ts:33-39` `parseViewport` 接受 `@0`、负值、`1280x764@2@3`，交给 puppeteer 才报错。
- `validatePlan`（`core/audit.ts:166-170`）只校验 `frontend` 是字符串、不校验取值；`cli/measure-cli.ts:294` 与 `cli/audit.ts:102` 把 `--frontend typo` 静默归一化成 desktop，而 `shot.ts:65-67` 会抛错——同包三种语义。
- 未知顶层 `--xxx` 选项静默变位置参数（`cli-args.ts:56`），`verify`/`shot` 直接丢弃。
- `--json` 契约：仅 `measure`/`measure audit` 实现（`verify-cli.ts:24` 的 `VALUE_FLAGS` 无 booleanFlags、`shot.ts:59-73` 只认 3 个选项），但 `README.md:225-227` 宣称「结构化数据走 --json，stdout 只包含 JSON」；且 `--json --help` 会把人读 usage 打进 stdout，`--json` + 错误时 stdout 完全为空。

---

## 六、测试用例：必要的 vs 不必要的

**定量**（`tests/devtools.test.ts` 1588 行 / 79.6KB）：19 个 describe、**111 个 it**、299 个 expect；`cli-ui.test.ts` 6 describe / 9 it；根 `css-architecture.test.ts` 1 / 4。合计 **26 describe / 124 it**，全部通过。`toMatch` 130 次、`not.toMatch` 52 次、`readSource` 47 次、`mkdtempSync` 24 次、`finally{rmSync}` 31 次、`beforeEach` **仅 1 处**。**41/111（37%）个 it 是「读源码文本 + 正则断言」的纯静态检查**。

### 6.1 不必要 / 冗余用例（硬口径约 5–7 个，占 5–6%）

| 证据                                                               | 问题                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `devtools.test.ts:918-921`                                         | 唯一断言 `not.toMatch(/@deprecated/)`，与 `:866` **逐字相同**（同一文件 plugin.ts、同一正则、同一含义），整条可删         |
| `devtools.test.ts:757-761`                                         | `it('accepts an arbitrary build command…')` 实际只有 `expect(typeof startBuild).toBe('function')`，标题承诺的行为完全没测 |
| `devtools.test.ts:1158-1160`                                       | `expect(allFiles.length).toBeGreaterThanOrEqual(26)` 测的是**测试自己的辅助变量**，硬编码 26 会随新增源码文件偶发变红     |
| `devtools.test.ts:639-648` / `:687-700`                            | 8 条 `typeof … === 'function'` 只验证方法存在；与 `theme.activate` 检查同类，应合并为一个表驱动契约用例                   |
| `:680/:845`、`:670/:1220`、`:1176/:1245`、`:841/:880`、`:768/:788` | 5–6 组同断言跨 describe 重复（`auditBrowser?:`、`reloadUI` 正则、`core/targets.ts` 导入、`resolveViteBin` 报错）          |
| `cli-ui.test.ts:94-95`                                             | `not.toMatch(/^\s*link\s{2,}/m)` 等，把 README「不再提供 syt link/watch」逐条翻成正则                                     |

### 6.2 更大的问题：40% 预算花在「防旧代码复活」而非行为验证

- **README 散文 1:1 镜像成断言**：「没有 `enabled`/`isWatch`/`pack` 开关」→ `:829/:1017/:823-830`；「链接/校验/资产固定行为」→ `:837-846`；「没有 browser/frontend/headless 入参」→ `:678-684` + `:841-843` 各查一遍；「打包固定行为、产物名 package.zip」→ `:1006-1018`。**改文档措辞或把 `??=` 重构成 `Object.assign` 都会误报，而产品行为毫无变化。**
- **为已删除的私有代码写守卫**：`:323` `not.toMatch(/REQUIRED_CAPABILITIES/)`、`:124` `existsSync(align.ts)===false`、`:1205` `sandbox.ts 已删除`、`:895` `not.toMatch(/function runAudit/)`、`:1213-1217` 禁 `page.reload` 等。
- **自研 TS 解析器**：`stripComments`（`:51`）自己实现注释剥离，含 `(?<!:)` 保护 `http://` 的 hack；`readSource`（`:34-45`）按层回退查找，把测试与目录结构焊死。`README.md:454-455` / `index.ts:19` 说「用导入方向做架构检查」——这该交给 `eslint import/no-restricted-imports` / `dependency-cruiser`，而非正则近似解析 TypeScript。
- **锁死实现内部字符串**：`:1011` 锁 `export const PACKAGE_NAME = 'package.zip'` 的源码拼写、`:1024` 锁局部变量名 `const files = walk(absOutDir)`、`:1040` 锁 `??=` 运算符、`:910` 锁形参名 `configResolved(resolved)`、`:1002` 硬编码「`detectTargetType(` 只该有 2 处」；精确错误消息（`:102` `/未知前端/`、`:399` `/产物目录不存在/`、`cli-ui.test.ts:142` `/--attach 连不上/`）让任何文案润色都变红。
- **「只测形状不测代码」**：`vite plugin shape` 分组 7 个 it 只检查 `typeof hook === 'function'`（`:807-812`、`:1028-1034`），**从不调用** `config()`/`writeBundle()`/`buildStart()`。插件三大核心行为零运行时覆盖。对照 `:937-963` / `:965-983` 直接调 `buildSpec()` 断言返回对象——那两个才有价值。
- **「实测」注释实为静态断言**：`:228`「实测磁盘 index.css 与注入 `<style>` 逐字节相同」实际只 `writeFileSync` 一个假文件再读回；`:797`「实测不产生磁盘文件」、`:849`「实测 writeBundle 分三段」实际是 `enforce==='post'` 形状检查；`:1201`「实测 line-height 在 iframe 里是 normal」实际 `not.toMatch(/iframe/)`。
- **组织坏味道**：单文件跨 13+ 被测模块（`devtools.test.ts:16-30` import 横跨 core/dev/plugin/cli 四层）；`cdp layering`(20 it) 名实不符（内容是源码分层检查，与 CDP 无关）；`vite plugin shape`(21 it) + `cdp layering`(20 it) 占 37% 用例；7 份复制粘贴的 `package.json`+`theme.json` fixture（`:1378,1395,1413,1432,1447,1462,1484`）；`registerTargetType` 全局注册**从不注销**（`:337/:349`）造成隐含顺序依赖；`:406-409` `if (process.platform !== 'win32') return;` 让非 Windows CI 上该用例静默空跑；两份 `vitest.config.ts` 里 `globals/restoreMocks/clearMocks` 全未使用（三个测试文件都显式 import，全仓无 `vi.*`）。

### 6.3 覆盖扎实、应原样保留的部分

真实 HTTP 控制服务 + 租约屏障（`:537-635`，全文件最有价值的 5 个 it）、链接状态机（`:388-528`，含 junction/win32/幂等/拒覆盖）、`verifyTarget` 7 例（`:1364-1500`）、zip 真解压 + 自算 CRC（`:1534-1558`）、纯函数（`parseViewport` 非法值已参数化、`frontendUrl`、`planIsEmpty/validatePlan`、`loadConfig/mergePlan`、`buildSpec`）、根 `css-architecture.test.ts` 4 例。

**最严重的覆盖缺口**：配置注释 `vitest.config.ts(包):6-7` 说「不启动真实浏览器，浏览器相关能力只做契约与静态验证」，但"契约验证"退化成了源码正则。`index.ts:59-79` 导出的**全部测量原语与颜色纯函数零行为测试**：`core/measure.ts` 7 个函数、`core/actions.ts`、`core/color.ts`（`parseColor/luminance/contrastRatio`，**纯数学，根本不需要浏览器**）、`core/page-read.ts`、`theme.ts` 的 `judgeMount`。另有：`cli-args.ts` 参数解析 0 覆盖、`--json` 输出从未被 `JSON.parse` 断言（只有正则检查源码里有 `attached: boolean`）、租约超时/崩溃不释放与多端点并发 0 覆盖、`--config` 模块加载 0 覆盖。

**直接回答用户**：① 边界情况在文件系统/HTTP/校验/zip 上考虑得不错，但主功能面几乎留空；② 过度防御性设计**明显存在**（41 个静态断言、README 镜像、锁死内部字符串）；③ 不必要用例确实存在但**只占 5–6%**，更大的问题是「**把 40% 的用例预算花在架构自检而非行为验证上**」。

---

## 七、确认的 bug 清单（含实测复现）

| #   | 严重度 | 位置                                                                     | 现象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **高** | `core/link.ts:234-245` + `:150-167`                                      | **Windows 真 symlink 被误判 junction**。`dev-session.ts:232` 传的 `srcPath = join(cwd, resolvedOutDir)` 是绝对路径，`symlinkSync` 原样存储，`readlinkSync` 返回绝对路径 → `isAbsolute(target)` 为真 → `detectLinkType` 返回 `'junction'`（注释却写「绝不谎报成 junction」）；二次启动 `pnpm dev` 命中幂等分支时 `kind==='plugin'` 使 `mustBeSymlink=true`，于是**拒绝自己建的真 symlink**。首次建链接不走检测，所以只在重复启动暴露。                                                |
| 2   | **高** | `plugin/plugin.ts:294`                                                   | **传原始 `outDir` 给会话层，与 Vite 产物目录分叉**。`build.outDir ??= outDir ?? spec.outDir`（`:356`）尊重项目自定义，`state.outDir`（`state.ts:47`）用 resolved 值，但 `startDevSession` 收到的是默认 `null` → 落到 `dev-session.ts:192` 的常量 `'./dev'`。父项目一旦在 `vite.config.ts` 自己写 `build.outDir`，产物写到 A、链接指向 `./dev`、zip/校验看 `state.outDir`，**静默失败**（思源加载不到不报错）。`README.md:99-100` 明确承诺支持这种配置。应改 `outDir: state.outDir`。 |
| 3   | **高** | `cli/cli-args.ts:48-54`                                                  | **带值选项吞掉下一个 flag**。`next` 只查 `undefined` 不查是否也是 flag。实测 `node bin/cli.js measure tokens --rc-x --frontend --json` → `--json` 被当作 `--frontend` 的值并丢失，输出人读文本「令牌 --rc-x (空)」、退出码 0。同类：`--frontend --attach` 吃掉 `--attach`、`syt verify --dir --kind plugin` 把 `--kind` 当目录。                                                                                                                                                     |
| 4   | **中** | `cli/cli.ts:23-27,81-87`                                                 | **命令分派表用普通对象，原型链导致静默成功**。实测 `node bin/cli.js constructor` 与 `toString` 均**退出码 0、无任何输出**；`__proto__` 才走到 `handler is not a function`。应 `Object.create(null)` / `Map` / `Object.hasOwn`。                                                                                                                                                                                                                                                      |
| 5   | **中** | `core/audit.ts:420-436`                                                  | **多个 diffs 状态串味**。`if (setup.length)` 使最常见的「无 setup」场景完全不 reset，第 2 个 diff 直接在第 1 个 `query.do` 留下的状态上跑；且 `rootSnapshot`（`:423`）是在 `setup+actions` 全部执行完之后才拍的，`reset` 恢复的不是初始状态。注释「每个 diff 先用同一个 setup 建立基线」与实现不符。                                                                                                                                                                                 |
| 6   | **中** | `core/audit-config.ts:105-122`                                           | **`mergePlan` 覆盖语义自相矛盾**。标量用 `!== undefined`（`:105-108`），数组一律用 `?.length`（`:114-118`），导致命令行**无法用空数组清空**配置字段，且与 `:98-100`「显式传了的整体替换」文档不符。                                                                                                                                                                                                                                                                                  |
| 7   | **中** | `core/builtin-targets.ts:56-62,248-259`                                  | **坏 i18n 文件静默通过校验**。`flattenKeys(null)` 返回 `['']`；若 `en.json` 与另一语言文件都是坏 JSON，两者 `keys` 都等于 `['']`，比较相等 → **不报任何问题**，反而正常的语言文件会被误报「key 不一致」。                                                                                                                                                                                                                                                                            |
| 8   | **中** | `cli/cli.ts:96-100`                                                      | **输入错误泄漏堆栈**。`cli.ts` 只给「非 `UserFacingError`」打堆栈，但 `cli-args.ts:50`、`measure-cli.ts` 9 处、`shot.ts:66` 全用 `new Error`。「少传一个参数」也把内部路径打到 stderr，与 `cli.ts:93` 注释、`README.md:59-60`「不带堆栈」冲突。                                                                                                                                                                                                                                      |
| 9   | **中** | `cli/shot.ts:59-73`                                                      | `parseArgv` 自写、`indexOf` 取**第一个** `--frontend`，其余命令 `lastValue`（`cli-args.ts:63-65`）取**最后一个**；`--frontend`/`--out` 缺值静默兜底，与 `cli-args.ts:50` 抛错相反。                                                                                                                                                                                                                                                                                                  |
| 10  | **中** | `plugin/plugin.ts:423,434`                                               | 所有会话启动失败一律归因「watch 模式需要思源在运行」，实际可能是清单缺 `name`、产物目录不存在、junction 冲突、Chrome 启动失败；前缀误导。                                                                                                                                                                                                                                                                                                                                            |
| 11  | **中** | `README.md:359` vs `core/audit-config.ts:24`                             | 文档说配置支持 `.siyuan-audit.js`/`.mjs`，实现自动发现是 `.json/.ts/.js`；`.ts` 未写进文档，且在 `engines.node >=20.19.0` 上 `import()` 一个 `.ts` 会抛 `ERR_UNKNOWN_FILE_EXTENSION`。                                                                                                                                                                                                                                                                                               |
| 12  | **中** | `cli/measure-cli.ts:130-134,170-172`、`tests/cli-ui.test.ts:124-125,140` | 注释/测试注释写「`--attach` 连不上会静默新开」，与 `core/session.ts:99-109` 抛错、README 三处承诺、以及同文件 `:142` 的 `rejects.toThrow` 断言**完全相反**。行为改过之后注释没同步。                                                                                                                                                                                                                                                                                                 |
| 13  | **低** | `cli/cli.ts:43-50`                                                       | 顶层 help 把 `--dir` 列为常用选项，但只有 `verify` 实现；按 help 跑 `syt measure tokens --dir /x --rc-x` 会把 `--dir` 和 `/x` 当两个令牌名，**静默量错对象**。                                                                                                                                                                                                                                                                                                                       |
| 14  | **低** | `plugin/assets.ts:221-226` vs `post.ts:239`                              | `bundleOptions.dir` 是第二真值源；一旦与 `resolved.build.outDir` 不一致，元数据搬到一个目录、zip/verify 看另一个。                                                                                                                                                                                                                                                                                                                                                                   |
| 15  | **低** | `core/control-server.ts:301`                                             | `pruneDeadEndpoints` 未接线 → SIGKILL 后端点文件永久残留，`discover()` 每次为每个坏端点做带超时探测，孤儿多了拖慢发现。                                                                                                                                                                                                                                                                                                                                                              |

---

## 八、优先改进建议（按收益排序）

1. **修两个高严重度正确性 bug**：`link.ts:234-245` 不要用 `isAbsolute(readlink)` 区分 symlink/junction（改用 lstat reparse tag 或把链接类型记进旁车文件），并补「绝对路径 srcPath 建 symlink 后二次 `ensureLink(...,{kind:'plugin'})` 必须 ok」的回归；`plugin.ts:294` 改 `outDir: state.outDir`，让 `PluginState` 成为唯一真值源。
2. **修 CLI 参数解析与分派**：`cli-args.ts:48-54` 检查 `next` 是否也是已知 flag；`cli.ts` 的 `COMMANDS` 改 `Object.create(null)`/`Object.hasOwn`；让 `shot.ts` 改用 `parseArgs` 消除 `indexOf` vs `lastValue` 语义分裂；输入类错误统一改 `UserFacingError`，删除 `verify-cli.ts`/`audit.ts` 的就地 `fail+exitCode+return`，只留 `cli.ts:89-102` 一个兜底。
3. **消除跨层重复**：删 `plugin/shared.ts` 的 `isRecord`/`messageOf`/`walkFiles`，改为 import `core/guards.ts`、`core/errors.ts`；把 `core/verify.ts:59` 的 `walk` 提升为共享 `walkFiles`；用 `describeError` 替掉 10 处内联归一化；合并 `printHuman`/`printAuditHuman`（约省 150–200 行），抽 `emitJson()` 与 CSV 拆分 helper；`StartDevOptions extends StartDevSessionOptions`。
4. **收敛 outDir/watch 到单一真值源**：6 处写法收成 `core/` 一个 `resolveOutDir` + `state.ts` 一个 `isWatchBuild`；`assets.ts:221-226` 不再读 `bundleOptions.dir`；顺手把硬编码 `1600/1000/5` 换成 `DEFAULT_VIEWPORT`/`DEFAULT_BOX_LIMIT`，兑现 `viewport.ts:2` 的「唯一来源」。
5. **修剪公开面 + 修文档**：`package.json` 补 `"./plugin"` 导出，或把 `README.md:15`、`index.ts:7`、`cli.ts:68` 统一改成 `import { siyuanPlugin } from 'siyuan-devkit'`；把 `siyuanAssets`/`siyuanPost`/`state`/`shared` 降为内部（随之删三份重复 `configResolved`、两份 `defaultLog`、两份 `createPluginState` 兜底），或让 `PostPluginOptions.verify`/`AssetsPluginOptions.watchPublic`/`StartDevOptions.link` 与 README 措辞对齐；清理 8 个死导出与 deprecated 别名。
6. **把 40% 测试预算从「防旧代码复活」挪到「测真实行为」**：`devtools.test.ts` 按模块拆成 8–10 个文件；`cdp layering`(20) 与静态源码断言迁到独立 `architecture.test.ts` 并改用 lint/dependency-cruiser 做导入方向检查，停用手写 `stripComments`；删除 `:918/:757/:1158` 与 README 镜像断言；给 `core/color.ts`、`cli-args.ts`、`--json` 的 `JSON.parse` 结构、租约超时/并发补行为用例（**这些大多不需要浏览器**）；把 7 个「只查 `typeof hook`」的 it 改为真正调用 `config()`/`writeBundle()`/`buildStart()`。
7. **删掉不可达防御、收敛超长函数**：移除 `page-read.ts:230-281` 的 7 个判别校验、`builtin-targets.ts:285-288` 的 `if (!state)`、`post.ts:266` 的不可达目录检查、`assets.ts:139` 冗余的 `startsWith('..')`；`validatePlan`（213 行）抽 `objectArray` 辅助；`startDevSession`(220 行) / `siyuanDev`(346 行) 拆分；10 处空 catch 至少清理链路改成 `requireRecoverable` 式按错误码过滤。
8. **修 audit 语义与文档漂移**：`audit.ts:420-436` 无条件对每个 diff `['reset', ...setup]` 并使用循环外拍的初始快照；`audit-config.ts:114-118` 数组统一 `!== undefined`；`builtin-targets.ts:248-259` 对 `readLocale` 返回 null 直接 push issue；同步 `measure-cli.ts:130-134,170-172` 与 `cli-ui.test.ts` 的「静默新开」注释；README 补 `.ts` / 去掉 `.mjs`、把 `--json` 限定为「仅 measure / measure audit 支持」；`errors.ts:43` 的 `SyntaxError` 判定收窄到 `JSON.parse` 调用点。
9. **工程清理**：合并两份 `vitest.config.ts`、删掉未使用的 `globals/restoreMocks/clearMocks`、给 `registerTargetType` 全局注册加注销；清理 `node_modules/.bin` 里指向已删除 `vite-plugin-siyuan` 的 6 个陈旧 shim、`probe-w.mjs` 与 5 个 `.pw*`/`.watch-*` 临时目录，并在 `.gitignore` 覆盖 `.pw*`；`lint` 脚本（`package.json:18`）补上 `packages/siyuan-devkit/tests`。

---

## 附录：验证方法

| 验证项            | 命令 / 方法                                               | 结果                                                                                              |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 类型检查          | `pnpm --filter siyuan-devkit type-check`                  | exit 0                                                                                            |
| 测试              | `pnpm --filter siyuan-devkit test`                        | 2 文件 / **120 用例全通过** / 2.17s                                                               |
| `./plugin` 子路径 | `node -e "import('siyuan-devkit/plugin')..."`             | `ERR_PACKAGE_PATH_NOT_EXPORTED`                                                                   |
| 根导出形状        | `node -e "import('siyuan-devkit')..."`                    | 76 个运行时导出、`default` 不存在、`siyuanPlugin` 存在                                            |
| 原型链分派        | `node bin/cli.js constructor` / `toString`                | 退出码 **0**、无输出                                                                              |
| 参数吞噬          | `node bin/cli.js measure tokens --rc-x --frontend --json` | 输出人读文本、退出码 0（`--json` 被吞）                                                           |
| 用户可见指引      | `node bin/cli.js --help`                                  | 打印 `import siyuan from 'siyuan-devkit/plugin'`（不可用）                                        |
| dist 是否入库     | `git ls-files dist`                                       | 0（`.gitignore` 已忽略，合理）                                                                    |
| 陈旧 bin          | `Get-Content node_modules/.bin/siyuan-measure.CMD`        | 指向 `vite-plugin-siyuan/bin/measure.js`，该目录不存在                                            |
| 静态统计          | `grep` / PowerShell 计数                                  | 44 源文件 7232 行；67 个 catch；196 处 nullish/guard；10 处内联错误归一化；41/111 静态源码断言 it |

> 本报告所有结论均带【文件路径:行号】，并区分「确实是问题」与「其实合理、不算问题」。审查过程未修改任何源码。

---

## 九、复核结论与修复落地

三组独立复核（core / cli+tests / plugin+dev+docs）逐条找反证。**净结果：原始 30 条判断里 19 条确认成立、11 条属误报或表述过度、3 条修复建议本身有害。**

### 9.1 确认的误报（已从结论中剔除）

| #   | 原始结论                                                                                 | 复核裁定                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `page-read.ts:230-281` 7 个判别校验「不可达、纯仪式、应删」                              | **假（且删了会编译失败）**。`evaluateRead` 返回联合类型 `ReadResult`，必须靠 `if (result.kind !== X) throw` 收窄到单变体才能满足返回类型；tsc 实测裸删报 `TS2322`。**保留**                                                                                    |
| 2   | `workspace.ts:72` 对「恒为字面量的 subdir」做冗余校验                                    | **假**。`subdir` 是公开函数 `resolveInstallDir` 的普通 `string` 形参，由外部注册类型的 `descriptor.installSubdir()` 传入。**保留**                                                                                                                             |
| 3   | `control-server.ts:84-92` 会让「旧版 dev 服务被当作可用」                                | **假**。`port===undefined` 被 `session.ts:121-125` 明确抛错；`ready` 字段全仓无调用方读取。仅「写法不一致」，非误判                                                                                                                                            |
| 4   | `plugin/post.ts:266-268`「同一件事三层兜底」                                             | **表述过度**。`verify:false` 或 `resolveTarget()` 返回 null 时 `:266` 是唯一守卫；`:273 files===0` 判的是「目录为空」不是「目录不存在」。**保留**                                                                                                              |
| 5   | 「全仓零消费者」的 8 个死导出                                                            | **4 条不成立**。`createTargetTypeRegistry`/`Sheet`/`workspaceManifestCandidates`/`readWorkspaceManifest` 都有内部调用或是 barrel 再导出源，属「多余公开面」而非死代码。只有 `isStringArray`/`isSemver` 重导出/`resetTargetTypes`/`pruneDeadEndpoints` 真零调用 |
| 6   | `register<T>` 的泛型 `T`「从未使用」                                                     | **不精确**。`T` 用作 `descriptor: T` 形参，属「无收益泛型」（返回 `string` 丢弃 T），不是未使用                                                                                                                                                                |
| 7   | `errors.ts:43-48`「包自身 SyntaxError 被吞掩盖 bug」                                     | **无可达触发点**。全仓无 `new Function`/`eval(`。且该分支是 5 处坏 JSON 降级的必需条件，**不可收窄**                                                                                                                                                           |
| 8   | `siyuan.ts:158-160` 联合类型运行时校验可删                                               | **假**。`devtools.test.ts:102` 用 `'tablet' as never` 断言 `.toThrow(/未知前端/)`，删了测试变红。**保留**                                                                                                                                                      |
| 9   | §7 #11「`engines.node >=20.19.0` 上 `import()` `.ts` 会抛 `ERR_UNKNOWN_FILE_EXTENSION`」 | **假**。Node ≥22.18 原生类型剥离默认开启，实测 v26.11.1 正常。只有 Node 20.x 会抛                                                                                                                                                                              |
| 10  | §2.1「即使补上子路径，根导出没有 default，这行仍拿不到东西」                             | **假**。那 4 处 import 的是**子路径**；`plugin.ts:128` 有 `export default`，`dist/plugin/plugin.js` 实测 `default: function`。补上 `./plugin` 即可用（已修）                                                                                                   |
| 11  | §4.1「租约屏障默认完全不执行」                                                           | **表述过度**。`auditBrowser:false` 时屏障/控制服务是空操作，但 `reloadUI` 广播每次变更都真实执行                                                                                                                                                               |

另有若干计数/措辞偏差：`measure.ts` 一行转发是 6 个不是 7；内联错误归一化是 7 处不是 10（含 2 处定义共 9）；「41/111 静态断言」的正确口径是「含 `readSource`/`stripComments` 的 35 个 ∪ 含 `readLayer` 的 6 个」= 41（复核者独立复现吻合）；`:918` 与 `:866` 正则相同但 `expect` 文案不同，非「逐字相同」；`cli-args.ts` 并非「0 覆盖」——happy path 被 2 条集成测试真实调用，缺的是边界用例；`tests/cli-ui.test.ts:140` 写的是「**以前会**静默新开」，是准确的历史陈述，**不是误报**。

### 9.2 原始修复建议里 3 个坑（复核拦下，已改道）

| 原始建议                                                   | 坑                                                                                                                                                                                              | 实际采用的修法                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.ts:294` 改传 `outDir: state.outDir`                | `state.outDir` 是**绝对路径**，而 `dev-session.ts:232/371` 用 `join(cwd, outDir)`——`join` 不重置绝对路径，实测 `join('C:\\proj','C:\\proj\\dev')` = `C:\proj\C:\proj\dev`，**连默认情况一起坏** | 传 `relative(state.root, state.outDir)`，会话层 `join` 后恰好等于产物目录。实测 `build.outDir='./dev'` 与 `'D:/proj/custom-dist'` 两种配置下都一致 |
| `audit-config.ts` 数组字段统一改 `!== undefined`           | `allValues()` 在没传 `--setup`/`--do` 时**恒返回 `[]`**，统一改会让**每次 audit 都静默清空配置文件里的 setup/actions**                                                                          | 只把 `tokens/counts/boxes/styles`（来自 `split()`）改成 `!== undefined`；`setup/actions` 保留 `?.length`，并加注释说明来源差异                     |
| `errors.ts:43` 把 `SyntaxError` 收窄到 `JSON.parse` 调用点 | `discover`/`pruneDeadEndpoints`/`probeEndpoint`/`readWorkspacePaths`/`verify` 都靠它吞坏 JSON，收窄后遇到任一损坏端点文件就抛错，比原问题更糟                                                   | **不改**                                                                                                                                           |

### 9.3 已落地的修复（23 文件，+271/−161）

全部通过 `type-check`（含根 `tsc --build --force`）、`test`（devkit 120 用例 + 根 4 用例）、`lint`（oxlint 0 warning 0 error）、`build`。

**高价值 bug（实测验证）**

1. **`core/link.ts` — Windows symlink 判据**：新增 `linkTargetFor()`，建 symlink 时存**相对** target（跨盘符退回绝对）。根因：Node 在 Windows 上把 junction 的 `readlink` 规范化成绝对路径，若 symlink 也用绝对 target 就无法区分，插件目录会被误判 junction 而拒绝启动。实测：junction（reparse tag `0xa0000003`）仍正确识别为 `junction`；同盘符 target 为相对路径、跨盘符退回绝对。`detectLinkType` 注释写明判据前提。
2. **`plugin/plugin.ts:294` — outDir 分叉**：改传 `relative(state.root, state.outDir)`。实测父项目自定义 `build.outDir` 时，链接目录与产物目录现已一致（原为链接指向 `./dev`、产物在别处）。
3. **`cli/cli-args.ts` — 带值选项吞 flag**：下一个 token 若是**白名单内的已知选项**则报缺参。只判已知选项、不用笼统 `/^--/`，因为 `--props --rc-brand-8`（CSS 自定义属性名）是合法用法——实测两种合法用法仍通过，`--frontend --json` 现在报 `UserFacingError` 且 exit 2。
4. **`cli/cli.ts` — 原型链**：`COMMANDS` 改用 `Object.create(null)`。实测 `syt constructor` 从「exit 0 无输出」变为「未知命令 + exit 2」。

**中价值修复**

5. `core/audit.ts` — diffs 基线快照提到循环外 + 无条件 `reset`，消除多 diff 状态串味。
6. `core/audit-config.ts` — mergePlan 按来源区分覆盖语义（实测空数组能清空 tokens，未传时 setup/actions 保留）；去掉模块分支多余的一次 `readFileSync`。
7. `core/builtin-targets.ts` — 新增 `readLocaleKeys()` 区分「读不出来」与「读出来是空的」；坏/空 i18n 现在显式报 issue（实测两个都坏的 `en.json`/`zh-CN.json` 从「静默通过」变为「en.json 无法解析或为空」）。
8. `core/control-server.ts` — `pruneDeadEndpoints()` 接线到 `startControlServer()`，孤儿端点文件不再累积。
9. CLI 输入类错误统一为 `UserFacingError`（`cli-args.ts` + `measure-cli.ts` 9 处 + `shot.ts`）：实测 `measure tokens --frontend` 从 **9 行堆栈**降到 **1 行干净消息**。
10. `cli/shot.ts` — 改用 `parseArgs`（消除 `indexOf` 取第一个 vs `lastValue` 取最后一个的语义分裂）；未知 `--state`/`--frontend` 改为报错而非 warn 后照常出图。
11. `cli/ui.ts` — 删掉被函数体完全忽略的 `Level`/`_level` 死参数，`status()` 改为两参；同步 5 个调用点。**保留全部 8 个导出名**（`cli-ui.test.ts:7` 一次性具名导入，删任一会全红）。
12. 消除重复：`styleRows` 提到 `ui.ts`（原 `measure-cli.ts` 与 `cli/audit.ts` 逐字相同两份）、`splitList` 提到 `cli-args.ts`（CSV 拆分三连重复）；`plugin/shared.ts` 删掉 `isRecord`/`messageOf`，改 import `core/guards.ts` 与 `core/errors.ts`（原为跨层逐字重复）。
13. 删真死代码：`isStringArray`、`verify.ts` 的 `isSemver` 兼容重导出、`resetTargetTypes`、`paths.ts` 恒假 `!file` 守卫。
14. `plugin/assets.ts` — 去掉 `startsWith('..')`（`split('/').includes('..')` 已覆盖，且它会误拒 `..gitignore`/`..env` 等合法文件名）。
15. `plugin/plugin.ts` — 会话启动失败不再一律归因「思源未运行」，按原因分前缀（清单缺 name / 目录不存在 / junction / Chrome 都会显示「开发会话启动失败」）。
16. `package.json` — 补 `"./plugin"` 子路径导出。实测 `import('siyuan-devkit/plugin')` 从 `ERR_PACKAGE_PATH_NOT_EXPORTED` 变为成功且 `default: function`——README 首要示例现在真的可用。
17. 文档同步：README 配置扩展名（`.ts` 需 Node ≥22.18，Node 20.x 用 `.js`；`.mjs` 显式 `--config` 可用但不在自动发现里）、`--json` 仅 `measure`/`measure audit` 支持、分层清单补 `guards.ts` 与 cli 文件名 + 同名文件辨析、把「固定行为不做成入参」限定到主入口并说明子插件是逃生舱；`measure-cli.ts` 与 `cli-ui.test.ts` 的「`--attach` 静默新开」陈旧注释改为「连不上直接报错」。

### 9.4 复核后决定「不修」的项及理由

| 项                                                    | 理由                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `page-read.ts` 7 个判别校验                           | 类型收窄承重代码，裸删编译失败（要删需先重构 `evaluateRead` 为按 kind 重载/泛型）                                       |
| `builtin-targets.ts:285-288` `if (!state)`            | 虽运行时不可达，但 `devtools.test.ts:256-262` 明确断言「null 要变成可读错误」，删它要连带删测试——保留分支与测试一致更稳 |
| `errors.ts` SyntaxError 判定                          | 5 处坏 JSON 降级依赖，收窄会引入更严重的失败                                                                            |
| `workspace.ts:72` / `siyuan.ts:158-160` 守卫          | 公开 API 的合法防御，且有回归测试                                                                                       |
| `plugin/post.ts:266-268`                              | 与 verify 的条件不同，非重复兜底                                                                                        |
| `index.ts` 76 个导出                                  | 是设计选择（对下游开放的 API），仓库内零消费者不等于该删；本轮不动公开面（属破坏性变更，需用户确认）                    |
| `devtools.test.ts` 静态源码断言（41/111）             | 属「测试组织方式」问题，改动面大且需与架构检查方案一起迁移（见 §6.2 建议 6），本轮不动                                  |
| `ui.ts` 的 `info≡section`、`linkRow≡list`、`box` 改名 | 收益低、风险高（`cli-ui.test.ts` 一次性导入 8 个名，改名即全红）                                                        |
| `.bin` 陈旧 shim、`probe-w.mjs`、`.pw*` 临时目录      | 属工作区卫生，与包源码无关；`.bin` 由 pnpm 重新 install 自动修复                                                        |

### 9.5 复核给出的新增发现（已修复）

- `measure audit --frontend typo --json` 输出的 `frontend` 仍是 `"typo"`，而 `createSession` 收到的是 `desktop`——JSON **自相矛盾**。本轮未单独修（属 `--frontend` 取值校验缺失，建议后续在 `validatePlan` 里校验取值域）。
- `plugin.ts:423/434` 两处相同前缀——已合并为 `describeSessionFailure()`。

### 9.6 用户实测反馈后的二次修正：`detectLinkType` 判据根本是错的

第一轮修复只让**新建**链接存相对 target，等于绕过症状。用户实测发现旧链接仍被判成 junction，由此暴露真根因：

**`isAbsolute(readlink)` 这个判据永远不可靠**——junction 的 readlink 被 Node 规范化成绝对路径，而 symlink 若用绝对 target 创建，readlink 同样是绝对路径。所以任何**旧版本用绝对路径创建的 symlink** 都会被误判成 junction，插件目录因此被拒绝启动。这不是"新建链接时避免"就能解决的问题。

**已改为读 Windows 重解析点 tag**（`fsutil reparsepoint query`）：

- junction → `0xa0000003`（`IO_REPARSE_TAG_MOUNT_POINT`）
- symlink → `0xa000000c`（`IO_REPARSE_TAG_SYMLINK`）
- 读不到 tag 时返回 `null`（宁可说「不知道」，也不谎报 junction 去拒绝插件目录）

实测对照（对真实链接）：

| 路径                                           | 实际类型                                                               | `detectLinkType` |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `D:\Document\siyuan\data\themes\Rem Craft Dev` | junction（`fsutil` tag `0xa0000003`、`cmd dir /AL` 显示 `<JUNCTION>`） | `junction` ✓     |
| `node_modules\siyuan-devkit`（pnpm）           | junction                                                               | `junction` ✓     |
| 普通目录                                       | 非链接                                                                 | `null` ✓         |
| 不存在的路径                                   | —                                                                      | `null` ✓         |

**关键收益**：历史链接现在也能判对。旧判据下，用开发者模式创建的绝对 target symlink 会被误判 junction；新判据只看 tag，与创建方式无关。

`linkTargetFor`（相对 target）保留，但理由变了——不再是判定前提，而是「链接目录整体搬动后仍指向正确位置」+「readlink 便于人工核对」。已实测相对 target 的 junction 仍能正确 `realpath` 与读取文件内容。

**仍存的局限（如实记录）**：本机无法创建真 symlink（`EPERM`，未开开发者模式），所以 symlink 分支（`0xa000000c`）未能端到端实测，其正确性依据是 `fsutil` 的 tag 语义而非本机样本。

> **更新：上述"无法实测"的结论是错的，已通过 UAC 提权补齐实测。** 用 `Start-Process -Verb RunAs` 提权执行 `New-Item -ItemType SymbolicLink` 成功建出真 symlink，三项证据确认：
>
> | 检查项                      | 结果                                                                   |
> | --------------------------- | ---------------------------------------------------------------------- |
> | `fsutil reparsepoint query` | `Reparse Tag Value : 0xa000000c`（`IO_REPARSE_TAG_SYMLINK`）           |
> | PowerShell `LinkType`       | `SymbolicLink`                                                         |
> | `readlinkSync`              | `C:\...\syt-uac2-98a632\target`（**绝对路径**）、`isAbsolute === true` |
>
> 对同一个真 symlink 对比两种判据：
>
> | 判据                                           | 结果                      |
> | ---------------------------------------------- | ------------------------- |
> | 旧：`isAbsolute(readlink) ? 'junction' : null` | **`junction` ← 误报确认** |
> | 新：`fsutil` reparse tag                       | **`symlink` ← 正确**      |
>
> 这完整闭环了原始 bug：真 symlink 用绝对 target 创建时，旧判据必然误判成 junction；插件项目（`mustBeSymlink=true`）会因此拒绝启动。用户的实测反馈"之前误报、改后不再误报"与本证据一致。
>
> **更正**："本机建不出来 symlink"应表述为"**非提权进程**建不出来（开发者模式未开、完整性级别 Medium）；UAC 提权后可以，这正是 `elevateSymlink()` 存在的意义。

**关于用户报的「pnpm dev 启动时报错拒绝」**：本仓库实测 `pnpm dev` 完全正常（类型识别为 `theme`，链接成功，会话就绪），因为 `mustBeSymlink` 只在 `kind === 'plugin'` 时为 true，而本仓库无 `plugin.json`、`detectTargetType` 返回 `theme`。用原始代码对同一链接实测：`kind:'theme'` → `ok:true`；`kind:'plugin'` → `ok:false` 并给出「插件目录必须是真正的符号链接」文案。即该错误只出现在**插件项目**场景，符合设计意图（Go 运行时按 ModeSymlink 判定，junction 会让插件静默加载不到）。若用户是在插件项目里遇到，需用开发者模式或接受 UAC 提权创建真 symlink。
