// 追加 audit 相关测试。
import { appendFileSync } from 'node:fs';

const block = `
describe('audit plan', () => {
  it('rejects a plan with the wrong shape before opening a browser', () => {
    // 计划是给人/agent 写的 JSON。写错了如果在浏览器里才发现，
    // 每次都要白起一个会话（实测约 1.2 秒），所以校验必须在建会话之前。
    const bad = validatePlan({ tokens: 'not-an-array' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join()).toMatch(/tokens 必须是数组/);

    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan({ tokens: [1, 2] }).ok).toBe(false);

    const badContrast = validatePlan({ contrast: [['only-one']] });
    expect(badContrast.ok).toBe(false);
    if (!badContrast.ok) expect(badContrast.errors.join()).toMatch(/contrast\\[0\\]/);
  });

  it('accepts both shorthand and object forms for styles/boxes', () => {
    const parsed = validatePlan({
      styles: ['.a', { selector: '.b', props: ['color'] }],
      boxes: ['.c', { selector: '.d', limit: 3 }],
    });
    expect(parsed.ok).toBe(true);
  });

  it('detects an empty plan so we do not launch a browser for nothing', () => {
    expect(planIsEmpty({}), '空计划不该起浏览器').toBe(true);
    expect(planIsEmpty({ tokens: [] })).toBe(true);
    expect(planIsEmpty({ tokens: ['--x'] })).toBe(false);
    expect(planIsEmpty({ diffs: [{ selector: '.a', do: ['click:.a'] }] })).toBe(false);
  });
});

describe('audit config', () => {
  it('discovers .siyuan-audit.json in the working directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-cfg-'));
    try {
      writeFileSync(join(dir, DEFAULT_CONFIG_NAME), JSON.stringify({ tokens: ['--rc-brand-8'] }));
      const loaded = await loadConfig(null, dir);
      expect(loaded.path, '应该自动发现默认配置文件').toBe(join(dir, DEFAULT_CONFIG_NAME));
      expect(loaded.discovered).toBe(true);
      expect(loaded.config.tokens).toEqual(['--rc-brand-8']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty config when nothing is found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-none-'));
    try {
      const loaded = await loadConfig(null, dir);
      expect(loaded.path).toBeNull();
      expect(loaded.config).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly when an explicit --config path does not exist', async () => {
    // 显式指定却找不到时必须报错，不能静默退回默认配置——
    // 否则用户以为在用自己那份计划，实际跑的是别的。
    await expect(loadConfig('./definitely-missing.json', tmpdir())).rejects.toThrow(/不存在/);
  });

  it('lets command-line values win over the config file', () => {
    // 优先级：命令行 > 配置文件 > 默认值（与 pa11y 一致）。
    const merged = mergePlan(
      { tokens: ['--from-file'], frontend: 'mobile', props: ['color'] },
      { tokens: ['--from-cli'] }
    );
    expect(merged.tokens, '命令行整体替换同名字段').toEqual(['--from-cli']);
    expect(merged.frontend, '没传的字段保留文件里的值').toBe('mobile');
    expect(merged.props).toEqual(['color']);
  });

  it('keeps config values when the command line says nothing', () => {
    const merged = mergePlan({ tokens: ['--a'], counts: ['.x'] }, {});
    expect(merged.tokens).toEqual(['--a']);
    expect(merged.counts).toEqual(['.x']);
  });
});
`;

appendFileSync('tests/devtools.test.ts', block);
console.log('已追加 audit 测试');
