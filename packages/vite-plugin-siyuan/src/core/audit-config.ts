/**
 * 审计计划的加载：配置文件自动发现 + 命令行参数覆盖。
 *
 * 约定照搬 pa11y（它能跑通这么多年说明这套够用）：
 *
 *   1. 默认找 `./.siyuan-audit.json`
 *   2. `-c/--config <path>` 指定别的文件
 *   3. 文件可以是 JSON 也可以是 JS（走 require，方便写表达式）
 *   4. **优先级：命令行参数 > 配置文件 > 内置默认值**
 *
 * 为什么不用 cosmiconfig 之类：我们只要一个固定文件名，多一层依赖不划算。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditPlan } from './audit.ts';

/** 默认的配置文件名。 */
export const DEFAULT_CONFIG_NAME = '.siyuan-audit.json';

/** 自动发现时依次尝试的文件名（JSON 优先，JS 次之）。 */
const CONFIG_CANDIDATES = [DEFAULT_CONFIG_NAME, '.siyuan-audit.js', '.siyuan-audit.mjs'];

/** 加载结果。 */
export interface LoadedConfig {
  /** 实际读到的文件；没找到为 null。 */
  path: string | null;
  /** 配置内容；没找到为 {}。 */
  config: AuditPlan;
  /** 是否用了自动发现（而非显式 --config）。 */
  discovered: boolean;
}

/** 读一个配置文件：JSON 直接 parse，JS 走动态 import。 */
async function readConfigFile(path: string): Promise<AuditPlan> {
  const text = readFileSync(path, 'utf8');
  // .json 走 JSON.parse（比 require 快，且不受 ESM/CJS 影响）；
  // 其余当模块加载，允许写表达式与注释。
  if (path.endsWith('.json')) {
    return JSON.parse(text) as AuditPlan;
  }
  const loaded = (await import(pathToFileURL(path).href)) as { default?: AuditPlan };
  return loaded.default ?? (loaded as unknown as AuditPlan);
}

/**
 * 找配置文件。
 *
 * @param explicit `--config` 给的值；给了就只用它（找不到要报错）
 * @param cwd      从哪个目录开始找（只找这一层，不向上递归）
 */
export async function loadConfig(explicit: string | null, cwd = process.cwd()): Promise<LoadedConfig> {
  if (explicit) {
    // 显式指定时支持相对路径；找不到就报错，不静默退回默认。
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(path)) {
      throw new Error(`指定的配置文件不存在：${path}`);
    }
    return { path, config: await readConfigFile(path), discovered: false };
  }

  for (const name of CONFIG_CANDIDATES) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    return { path, config: await readConfigFile(path), discovered: true };
  }

  return { path: null, config: {}, discovered: false };
}

/** 命令行给出的覆盖值。缺省（undefined）表示「没传，用配置文件或默认值」。 */
export interface PlanOverrides {
  frontend?: string;
  viewport?: string;
  attach?: boolean;
  target?: { kind?: string; name?: string; css?: string; plugin?: string };
  setup?: string[];
  actions?: string[];
  tokens?: string[];
  styles?: string[];
  counts?: string[];
  boxes?: string[];
  props?: string[];
}

/**
 * 合并配置与命令行覆盖。
 *
 * 规则：**显式传了的命令行参数整体替换配置文件里的同名字段**（不是逐项合并）。
 * 这样语义可预测——`--tokens a,b` 就是「只查 a 和 b」，而不是「在文件基础上追加」。
 * 需要追加时把要查的写全。
 */
export function mergePlan(config: AuditPlan, overrides: PlanOverrides): AuditPlan {
  const merged: AuditPlan = { ...config };

  if (overrides.frontend !== undefined) merged.frontend = overrides.frontend;
  if (overrides.viewport !== undefined) merged.viewport = overrides.viewport;
  if (overrides.attach !== undefined) merged.attach = overrides.attach;
  if (overrides.props !== undefined) merged.props = overrides.props;

  if (overrides.target) {
    merged.target = { ...(config.target ?? {}), ...overrides.target };
  }

  if (overrides.setup?.length) merged.setup = overrides.setup;
  if (overrides.actions?.length) merged.actions = overrides.actions;
  if (overrides.tokens?.length) merged.tokens = overrides.tokens;
  if (overrides.counts?.length) merged.counts = overrides.counts;
  if (overrides.boxes?.length) merged.boxes = overrides.boxes;
  if (overrides.styles?.length) {
    // 命令行传的样式查询没有 props，统一用默认值；文件里的对象形式保留。
    merged.styles = overrides.styles;
  }

  return merged;
}
