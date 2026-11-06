import { describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendLinks, frontendUrl } from '../src/core/siyuan.ts';
import { CONTROL_DIR } from '../src/core/control-server.ts';
import { box, fail, info, linkRow, list, section, status, table } from '../src/cli/ui.ts';
import { runCli } from '../src/cli/cli.ts';
import { runMeasureCli } from '../src/cli/measure-cli.ts';
import { runShotCli } from '../src/cli/shot.ts';
import { runVerifyCli } from '../src/cli/verify-cli.ts';

/** 捕获 console.log / console.error，便于断言 CLI 的纯文本输出。 */
function capture(run: () => void | Promise<void>): string | Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  const restore = (): string => {
    console.log = originalLog;
    console.error = originalError;
    return lines.join('\n');
  };
  try {
    const result = run();
    if (result instanceof Promise) {
      return result.then(restore, (cause) => {
        restore();
        throw cause;
      });
    }
    return restore();
  } catch (cause) {
    restore();
    throw cause;
  }
}

describe('frontend links', () => {
  it('exposes stable desktop and mobile preview URLs', () => {
    expect(frontendLinks(6806)).toEqual([
      { frontend: 'desktop', url: 'http://127.0.0.1:6806/stage/build/desktop/' },
      { frontend: 'mobile', url: 'http://127.0.0.1:6806/stage/build/mobile/' },
    ]);
  });

  it('keeps cache busting as the default but can be disabled for display', () => {
    expect(frontendUrl(6806, 'desktop')).toMatch(/\/stage\/build\/desktop\/\?r=/);
    expect(frontendUrl(6806, 'mobile', { cacheBust: false })).toBe('http://127.0.0.1:6806/stage/build/mobile/');
  });
});

describe('cli ui primitives', () => {
  it('renders plain status, info and section lines', () => {
    const output = capture(() => {
      status('已链接', 'D:/ws/data/themes/Rem Craft Dev');
      info('提示');
      section('预览');
    }) as string;
    expect(output).toContain('已链接');
    expect(output).toContain('D:/ws/data/themes/Rem Craft Dev');
    expect(output).toContain('预览');
  });

  it('renders tab-separated tables and two-column lists', () => {
    const output = capture(() => {
      table(['令牌', '值'], [['--rc-text-primary', '#333333']]);
      list([['dev', '构建 + 链接 + 重载']]);
    }) as string;
    expect(output).toContain('令牌');
    expect(output).toContain('--rc-text-primary');
    expect(output).toContain('#333333');
    expect(output).toContain('构建 + 链接 + 重载');
  });

  it('renders a plain box and a full URL for links', () => {
    const output = capture(() => {
      box('syt measure', ['构建 → 链接 → 重载']);
      linkRow('桌面端', 'http://127.0.0.1:6806/stage/build/desktop/');
    }) as string;
    expect(output).toContain('syt measure');
    expect(output).toContain('http://127.0.0.1:6806/stage/build/desktop/');
  });
});

describe('cli help output', () => {
  it('prints the audit-oriented command map', async () => {
    const root = (await capture(() => runCli(['--help']))) as string;
    expect(root).toContain('syt · 思源主题 / 插件开发工具');
    for (const command of ['measure', 'shot', 'verify']) {
      expect(root).toContain(command);
    }
    expect(root, 'syt link 已由插件接管，CLI 不再暴露').not.toMatch(/^\s*link\s{2,}/m);
    expect(root, 'syt watch 对 agent 没有价值，CLI 不再暴露').not.toMatch(/^\s*watch\s{2,}/m);
    expect(root).toContain('desktop | mobile');

    const measure = (await capture(() => runMeasureCli(['--help']))) as string;
    for (const subcommand of ['env', 'tokens', 'styles', 'count', 'box', 'probe', 'diff', 'contrast', 'audit']) {
      expect(measure).toContain(subcommand);
    }

    const shot = (await capture(() => runShotCli(['--help']))) as string;
    expect(shot).toContain('syt shot');
    expect(shot).toContain('--frontend');

    const verify = (await capture(() => runVerifyCli(['--help']))) as string;
    expect(verify).toContain('syt verify');
  });
});

describe('cli error styling', () => {
  it('writes errors with a readable message', () => {
    const output = capture(() => fail('启动失败'));
    expect(output).toContain('启动失败');
  });
});

describe('measurement provenance', () => {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli');
  const read = (name: string) => readFileSync(join(cliDir, name), 'utf8');

  it('exposes whether the reading came from the attached dev browser', () => {
    // 没带 --attach 时量的是新开的无头页面，不是 dev 会话的常驻页。
    // agent 必须能从输出判断读数出处，否则会把"新页面读磁盘"误当成"量了 dev 窗口"。
    const measure = read('measure-cli.ts');
    expect(measure, 'MeasureOutput 必须带 attached 字段').toMatch(/attached: boolean/);
    expect(measure, 'JSON 输出要带上实际值').toMatch(/attached: session\.attached/);
    expect(measure, '人读输出也要说明来源').toMatch(/读数来源/);

    const audit = read('audit.ts');
    expect(audit, 'audit 的 JSON 同样要带 attached').toMatch(/attached: session\.attached/);
    expect(audit, 'audit 的人读输出同样要说明来源').toMatch(/读数来源/);
  });
});

describe('--attach when no resident page is available', () => {
  it('reports the reason to the agent instead of silently opening a browser', async () => {
    // 清掉端点，模拟 auditBrowser:false（默认）或 dev 没跑。
    // 以前会静默新开无头浏览器，agent 会以为量的是常驻页。
    rmSync(CONTROL_DIR, { recursive: true, force: true });
    await expect(runMeasureCli(['env', '--attach'])).rejects.toThrow(/--attach 连不上/);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'session.ts'),
      'utf8'
    );
    expect(source, '错误信息要给出两条出路').toMatch(/去掉 --attach/);
    expect(source, '错误信息要说明怎么开启').toMatch(/auditBrowser: true/);
  });
});
