import type { Target } from './targets.ts';
import type { VerifyIssue } from './target-types.ts';
/** 校验结果。 */
export interface VerifyResult {
    ok: boolean;
    issues: VerifyIssue[];
}
/** 是不是 semver（只认 `x.y.z`，与思源集市一致）。 */
export declare const isSemver: (value: unknown) => boolean;
/** 校验参数。 */
export interface VerifyOptions {
    /** 项目根目录。 */
    root: string;
    /** 产物目录（绝对路径或相对 root）。 */
    outDir: string;
}
/**
 * 校验一个目标的清单与产物。
 *
 * @returns 问题列表；空表示通过
 */
export declare function verifyTarget(target: Target, { root, outDir }: VerifyOptions): VerifyResult;
/** 把问题列表打印成可读文本。 */
export declare function formatIssues(issues: VerifyIssue[]): string;
//# sourceMappingURL=verify.d.ts.map