/**
 * semver 只认 `x.y.z`（与思源集市一致）。
 * 独立小模块：verify.ts 与描述符都要用它，放其中一边就会形成循环依赖。
 */
export const isSemver = (value: unknown): boolean => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
