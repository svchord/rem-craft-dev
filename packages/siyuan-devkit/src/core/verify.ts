/**
 * 产物与清单校验。
 *
 * 思源的失败模式是**静默的**：theme.json 缺 modes → 主题不出现在列表里；
 * frontends 缺 mobile → 移动端不加载；版本号不一致 → 集市判为旧版；
 * 产物缺 index.js → 插件加载不到。这些规则每个项目都要写一遍，收进包后
 * 描述符只声明「我这个类型独有的是什么」，通用的部分统一在这里。
 *
 * 分层：通用（本文件）版本一致 / 必需字段 / semver / i18n default / expectedFiles；
 *       类型特有（描述符）verifyManifest() / verifyArtifact()。
 * 本文件只依赖 target-types.ts 的契约类型，不 import targets.ts（避免循环依赖）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isSemver } from './semver.ts';
import { isRecord } from './guards.ts';
import { requireRecoverable } from './errors.ts';
import type { TargetDescriptor, VerifyContext, VerifyIssue } from './target-types.ts';

/** 校验结果。 */
export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}

/** verifyTarget 只需要目标的这两项能力，不必依赖整个 Target 类型。 */
interface VerifiableTarget {
  buildConfig(): { expectedFiles: string[] };
  descriptor: Pick<TargetDescriptor, 'manifestName' | 'verifyManifest' | 'verifyArtifact'>;
}

/** 读 JSON；读不到/解析失败返回 null，其余错误重抛。 */
function readJson(path: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(data) ? data : null;
  } catch (cause) {
    requireRecoverable(cause);
    return null;
  }
}

/** 清单里某个字段是不是「必须带 default 的 i18n 对象」。 */
function checkI18nField(manifest: Record<string, unknown>, field: string): VerifyIssue | null {
  const value: unknown = manifest[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return 'default' in value
    ? null
    : {
        message: `${field} 是 i18n 对象但没有 default 项`,
        hint: '思源按 default 回退，缺了会显示空白。加上 {"default": "..."}。',
      };
}

/** 递归列出目录下所有文件（相对路径）；一次遍历供通用与类型特有校验共用。 */
function walk(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [rel];
  });
}

/** outDir 可能已经是绝对路径，也可能相对 root。 */
function resolveOutDir(root: string, outDir: string): string {
  return isAbsolute(outDir) ? outDir : join(root, outDir);
}

/** 校验参数。 */
export interface VerifyOptions {
  /** 项目根目录。 */
  root: string;
  /** 产物目录（绝对路径或相对 root）。 */
  outDir: string;
}

/** 校验一个目标的清单与产物；返回问题列表，空表示通过。 */
export function verifyTarget(target: VerifiableTarget, { root, outDir }: VerifyOptions): VerifyResult {
  const issues: VerifyIssue[] = [];
  const config = target.buildConfig();
  const absOutDir = resolveOutDir(root, outDir);
  // 一次遍历，通用与类型特有校验共用同一份文件列表。
  const files = walk(absOutDir);
  const readOutput = (file: string): string | null => {
    try {
      return readFileSync(join(absOutDir, file), 'utf8');
    } catch (cause) {
      requireRecoverable(cause);
      return null;
    }
  };

  const manifestName = target.descriptor.manifestName();
  const manifestPath = join(root, 'public', manifestName);
  const manifest = readJson(manifestPath) ?? readJson(join(root, 'dist', manifestName));
  const packageJson = readJson(join(root, 'package.json'));

  // ---- 通用：清单存在与必需字段 ----
  if (!manifest) {
    issues.push({
      message: `读不到清单：public/${manifestName}`,
      hint: '思源按清单识别主题/插件，缺了它不会出现在列表里。',
    });
  } else {
    for (const field of ['name', 'author', 'url', 'version']) {
      if (!manifest[field]) {
        issues.push({ message: `清单缺少必需字段：${field}` });
      }
    }

    // 不一致的后果不是报错，而是集市判为旧版、用户收不到更新。
    if (packageJson && manifest.version && packageJson.version !== manifest.version) {
      issues.push({
        message: `版本不一致：package.json=${String(packageJson.version)}，清单=${String(manifest.version)}`,
        hint: '集市按清单版本判新旧，不一致会导致更新不推送。',
      });
    }

    if (manifest.version && !isSemver(manifest.version)) {
      issues.push({
        message: `清单 version 不是 semver：${String(manifest.version)}`,
        hint: '应为 主.次.修订，如 1.2.3。',
      });
    }

    for (const field of ['displayName', 'description', 'readme']) {
      const issue = checkI18nField(manifest, field);
      if (issue) issues.push(issue);
    }
  }

  // ---- 产物目录存在与必需文件 ----
  if (!existsSync(absOutDir)) {
    issues.push({
      message: `产物目录不存在：${absOutDir}`,
      hint: '先跑一次构建。',
    });
  } else {
    for (const expected of config.expectedFiles) {
      if (!files.includes(expected)) {
        issues.push({
          message: `产物缺少 ${expected}`,
          hint: '思源按固定文件名加载，缺了不会报错、只是加载不到。',
        });
      }
    }
  }

  // ---- 类型特有 ----
  const context: VerifyContext = {
    root,
    files,
    readOutput,
    manifest,
    packageJson,
  };

  const descriptor = target.descriptor;
  if (typeof descriptor.verifyManifest === 'function') {
    issues.push(...descriptor.verifyManifest(context));
  }
  if (typeof descriptor.verifyArtifact === 'function' && existsSync(absOutDir)) {
    issues.push(...descriptor.verifyArtifact(context));
  }

  return { ok: issues.length === 0, issues };
}

/** 把问题列表打印成可读文本。 */
export function formatIssues(issues: VerifyIssue[]): string {
  return issues
    .map((issue) => {
      const head = `  ✗ ${issue.message}`;
      return issue.hint ? `${head}\n    ${issue.hint}` : head;
    })
    .join('\n');
}
