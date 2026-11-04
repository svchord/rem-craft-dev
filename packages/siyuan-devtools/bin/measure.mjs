#!/usr/bin/env node
/**
 * siyuan-measure：通用测量 CLI。
 *
 * 用法与仓库内 `pnpm measure` 一致，见 src/measure-cli.mjs 顶部的说明。
 */
import { runCli } from '../src/measure-cli.mjs';

await runCli();
