#!/usr/bin/env node
/**
 * syt：统一入口。
 *
 * 推荐用法——不用在引用项目里写任何脚本：
 *   npx syt measure audit
 * 就能在真实思源页面里跑审计计划；开发热重载走 Vite 插件（vite build --watch / pnpm dev）。
 */
import { runCli } from '../dist/cli/cli.js';

await runCli();
