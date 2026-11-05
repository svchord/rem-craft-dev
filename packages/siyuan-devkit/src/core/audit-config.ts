/**
 * 审计计划的加载：配置文件自动发现 + 命令行参数覆盖。
 *
 *   1. 默认找 `./.siyuan-audit.json`
 *   2. `-c/--config <path>` 指定别的文件
 *   3. 文件可以是 JSON，也可以是 ES 模块（`.ts` / `.js`，**走动态 import**，
 *      方便写表达式与注释；不是 CommonJS require）
 *   4. 优先级：命令行参数 > 配置文件 > 内置默认值
 *
 * 不用 cosmiconfig 之类：只要一个固定文件名，多一层依赖不划算。
 * 配置读进来立刻用 validatePlan 逐字段校验并构造 AuditPlan，不做类型断言。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePlan } from './audit.ts';
import type { AuditPlan } from './audit.ts';
import { isRecord } from './guards.ts';

/** 默认的配置文件名。 */
export const DEFAULT_CONFIG_NAME = '.siyuan-audit.json';

/** 自动发现时依次尝试的文件名（JSON 优先，之后是源码形态的模块）。 */
const CONFIG_CANDIDATES = [DEFAULT_CONFIG_NAME, '.siyuan-audit.ts', '.siyuan-audit.js'];

/** 加载结果。 */
export interface LoadedConfig {
  /** 实际读到的文件；没找到为 null。 */
  path: string | null;
  /** 配置内容；没找到为 {}。 */
  config: AuditPlan;
  /** 是否用了自动发现（而非显式 --config）。 */
  discovered: boolean;
}

/** 与 validatePlan 共用同一份形状校验，避免断言 unknown → AuditPlan。 */
function asPlan(value: unknown, path: string): AuditPlan {
  const validated = validatePlan(value);
  if (!validated.ok) throw new Error(`配置文件 ${path} 无效：${validated.errors.join('；')}`);
  return validated.plan;
}

/** 读一个配置文件：JSON 直接 parse，其余当 ES 模块动态 import。 */
async function readConfigFile(path: string): Promise<AuditPlan> {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) {
    const parsed: unknown = JSON.parse(text);
    return asPlan(parsed, path);
  }
  const module: unknown = await import(pathToFileURL(path).href);
  const plan: unknown = isRecord(module) && 'default' in module ? module['default'] : module;
  return asPlan(plan, path);
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
 * 规则：**显式传了的命令行参数整体替换配置文件里的同名字段**（不是逐项合并），
 * 这样语义可预测——`--tokens a,b` 就是「只查 a 和 b」，需要追加就把要查的写全。
 * 例外是 `target`：它是嵌套对象，命令行只覆盖传了的那个子字段，其余保留文件里的值。
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
