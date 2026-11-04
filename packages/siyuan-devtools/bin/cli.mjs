#!/usr/bin/env node
/**
 * siyuan-devtools：统一入口。
 *
 * 这是推荐用法——不用在引用项目里写任何脚本，直接
 *   npx siyuan-devtools dev
 * 就能构建、链接、热重载，类型从 public/ 清单自动推断。
 */
import { runCli } from '../src/cli.mjs';

await runCli();
