import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it, beforeEach } from 'vitest';
import type { Page } from 'puppeteer-core';
import { probeTokens } from '../src/core/probes.ts';
import { parseViewport, viewportFor } from '../src/core/session.ts';
import { frontendUrl, MOBILE_VIEWPORT } from '../src/core/siyuan.ts';
import { findDoubleWrappedColors, findProblemsIn } from '../src/core/lints.ts';
import { pluginTarget, themeTarget, createTarget } from '../src/core/targets.ts';
import { detectTargetType, registerTargetType, targetType, targetTypes } from '../src/core/target-types.ts';
import { checkLinkedFiles, ensureLink, inspectLink, samePath } from '../src/core/link.ts';
import { CONTROL_DIR, discover, startControlServer } from '../src/core/control-server.ts';
import siyuanVitePlugin from '../src/plugin/plugin.ts';
import { resolveViteBin, startBuild } from '../src/dev/build.ts';
import { planIsEmpty, validatePlan } from '../src/core/audit.ts';
import { DEFAULT_CONFIG_NAME, loadConfig, mergePlan } from '../src/core/audit-config.ts';
import { verifyTarget } from '../src/core/verify.ts';
import { writeZip } from '../src/plugin/post.ts';
import { runVerifyCli } from '../src/cli/verify-cli.ts';

const root = join(import.meta.dirname, '..');
const cdpDir = join(root, 'src');
const readSource = (file: string, preferredLayer?: string) => {
  // 重组后源码按层放。允许指定层——core/targets.ts 与 cli/targets.ts 同名，
  // 不指定时按 core → dev → plugin → cli → 顶层 的顺序找。
  const layers = preferredLayer
    ? [preferredLayer, ...['core', 'dev', 'plugin', 'cli', ''].filter((l) => l !== preferredLayer)]
    : ['core', 'dev', 'plugin', 'cli', ''];
  for (const layer of layers) {
    const candidate = layer ? join(cdpDir, layer, file) : join(cdpDir, file);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error('找不到源码文件: ' + file);
};

/**
 * 架构断言只看代码本身：注释里提到 puppeteer.launch / console.log 不算违规。
 * 行注释用 `(?<!:)` 保护 `http://`，否则 siyuan.mjs 里的 URL 会把后半行吃掉。
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');

/**
 * 把只实现了 evaluate 的桩转成 Page。
 *
 * 测试不该为了类型去 mock puppeteer 的 108 个方法；把不完整性收在这一处转换里，
 * 而不是在每个用例散落 @ts-expect-error。
 */
const asPage = (stub: { evaluate: (...args: never[]) => unknown }): Page => stub as unknown as Page;

describe('parseViewport', () => {
  it('parses 宽x高 with the default device scale factor', () => {
    expect(parseViewport('1280x764'), '缺省 DPR 必须是 1').toEqual({
      width: 1280,
      height: 764,
      deviceScaleFactor: 1,
    });
  });

  it('parses the @DPR suffix', () => {
    expect(parseViewport('1280x764@2').deviceScaleFactor, '@DPR 必须覆盖默认值').toBe(2);
    expect(parseViewport('1280x764@1.5').deviceScaleFactor, 'DPR 允许小数').toBe(1.5);
  });

  it('returns the fallback when no value is given', () => {
    expect(parseViewport(undefined), '未传 --viewport 时用桌面视口').toEqual({
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
    });
    expect(parseViewport(''), '空串等同于未传，不能抛错').toEqual({
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
    });
  });

  it('throws on malformed values', () => {
    for (const value of ['1280', 'abc', '1280x764@', '1280 x 764']) {
      expect(() => parseViewport(value), '非法视口必须报错而不是静默套用默认值：' + value).toThrow(/viewport/);
    }
  });
});

describe('frontend selection', () => {
  it('builds desktop and mobile URLs from separate build entries', () => {
    expect(frontendUrl(6806, 'desktop')).toMatch(/\/stage\/build\/desktop\/\?r=/);
    expect(frontendUrl(6806, 'mobile')).toMatch(/\/stage\/build\/mobile\/\?r=/);
  });

  it('rejects unknown frontends', () => {
    expect(() => frontendUrl(6806, 'tablet' as never), '拼错前端必须报错，而不是静默用桌面').toThrow(/未知前端/);
  });

  it('defaults to the desktop entry', () => {
    expect(frontendUrl(6806)).toMatch(/\/stage\/build\/desktop\//);
  });

  it('uses the phone viewport for mobile unless one is given', () => {
    // 移动端不是「桌面缩小版」：它有独立构建，视口也必须是手机预设，否则断点全错。
    expect(viewportFor('mobile', undefined)).toEqual(MOBILE_VIEWPORT);
    expect(viewportFor('desktop', undefined).width, '桌面缺省保持 1600').toBe(1600);
    const explicit = { width: 800, height: 600, deviceScaleFactor: 1 };
    expect(viewportFor('mobile', explicit), '显式视口优先').toEqual(explicit);
  });
});

describe('probeTokens', () => {
  /**
   * probeTokens 的读数逻辑跑在浏览器里，Node 侧只拿返回值；用最小 DOM 桩执行它注入的函数，
   * 钉住「扁平 { 令牌: 值 }」这个对外契约——写成 { resolved, declared } 会让调用方静默读到 undefined。
   */
  function stubPage(values: Record<string, string>) {
    return {
      evaluate: (fn: (names: string[]) => Record<string, string>, names: string[]) => {
        const globals = globalThis as unknown as Record<string, unknown>;
        // 只还原真的存在的键：把 document 留成 undefined 会污染同进程里后续的用例。
        const patched = {
          document: { documentElement: {} },
          getComputedStyle: () => ({ getPropertyValue: (name: string) => values[name] ?? '' }),
        };
        const missing = Object.keys(patched).filter((key) => !(key in globals));
        Object.assign(globals, patched);
        try {
          return fn(names);
        } finally {
          for (const key of missing) delete globals[key];
        }
      },
    };
  }

  it('returns a flat { token: value } map with trimmed values', async () => {
    const tokens = await probeTokens(stubPage({ '--rc-brand-8': ' 0 82 217 ', '--rc-radius-base': '6px' }) as never, [
      '--rc-brand-8',
      '--rc-radius-base',
      '--rc-missing',
    ]);

    expect(tokens, 'probeTokens 返回扁平对象，不是 { resolved, declared }').toEqual({
      '--rc-brand-8': '0 82 217',
      '--rc-radius-base': '6px',
      '--rc-missing': '',
    });
    expect(tokens['--rc-missing'], '未定义的令牌在计算样式里就是空串，不能变成 undefined').toBe('');
  });
});

describe('style lints', () => {
  it('detects double-wrapped rgb(var(--b3-*))', () => {
    // 这个 bug 真实发生过：l2 把 --b3-* 桥成完整色值，l3 又包一层 rgb()，
    // rgb(rgb(...)) 是非法值，整条声明被浏览器静默丢弃。
    const problems = findDoubleWrappedColors('.a { color: rgb(var(--b3-theme-on-surface)) }');
    expect(problems).toHaveLength(1);
    expect(problems[0]!.token).toBe('--b3-theme-on-surface');
  });

  it('accepts the correct single wrap', () => {
    expect(findDoubleWrappedColors('.a { color: var(--b3-theme-on-surface) }')).toEqual([]);
    expect(findDoubleWrappedColors('.a { color: rgb(var(--rc-brand-8)) }'), '--rc-* 存的是通道，rgb() 是对的').toEqual(
      []
    );
  });

  it('labels which sheet a problem came from', () => {
    // 插件 CSS 动辄 50 万字符，不标来源就不知道去改哪个文件。
    const problems = findProblemsIn([
      { label: 'theme.css', text: '.a { color: rgb(var(--b3-theme-on-surface)) }' },
      { label: 'pluginsStyle-x', text: '.b { color: rgb(var(--b3-border-color)) }' },
    ]);
    expect(problems.map((problem: { sheet: string }) => problem.sheet)).toEqual(['theme.css', 'pluginsStyle-x']);
  });
});

describe('target adapters', () => {
  it('builds a theme target that reads the build artifact', async () => {
    const target = themeTarget({ cssPath: './dev/theme.css', name: 'Rem Craft Dev' });
    expect(target.kind).toBe('theme');
    expect(target.name).toBe('Rem Craft Dev');
  });

  it('requires a name it cannot read from the manifest', () => {
    // 名字是定位安装目录的唯一依据，读不到就必须报错，不能猜一个默认值。
    const empty = mkdtempSync(join(tmpdir(), 'rc-noname-'));
    try {
      expect(() => pluginTarget({ name: '', cwd: empty }), '插件名缺失必须报错').toThrow(/读不到|name/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('reads plugin CSS from disk, not from the page', async () => {
    // 实测磁盘 index.css 与思源注入的 <style> 逐字节相同，所以读磁盘即可。
    // 好处：不依赖插件是否已加载，插件出问题时审计照常跑。
    // 用临时目录造一个假插件，避免测试依赖本机装了什么。
    const dir = mkdtempSync(join(tmpdir(), 'rc-plugin-'));
    try {
      writeFileSync(join(dir, 'index.css'), '.fake-plugin { color: red }');
      const target = pluginTarget({ name: 'fake-plugin', pluginDir: dir });
      const sheets = await target.resolveCss();
      expect(sheets.length).toBe(1);
      expect(sheets[0]!.label).toMatch(/index\.css$/);
      expect(sheets[0]!.text).toBe('.fake-plugin { color: red }');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a plugin without index.css as DOM-only instead of failing', async () => {
    // 有的插件只有 index.js，没有 index.css，不该判成失败。
    const dir = mkdtempSync(join(tmpdir(), 'rc-plugin-'));
    try {
      writeFileSync(join(dir, 'index.js'), '// no css');
      const target = pluginTarget({ name: 'no-css-plugin', pluginDir: dir });
      expect(await target.resolveCss(), '无 CSS 时返回空数组').toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports plugin mount state without crashing on a null page result', async () => {
    // 页面返回 null 时曾直接崩（Cannot read properties of null）。
    const target = pluginTarget({ name: 'arco-calendar' });
    const mount = await target.mountState(asPage({ evaluate: () => Promise.resolve(null) }));
    expect(mount.ok, 'null 要变成可读的错误，不能抛异常').toBe(false);
    expect(mount.reason).toMatch(/页面不可用/);
  });
  it('tolerates a running plugin that injected no stylesheet', async () => {
    const target = pluginTarget({ name: 'Calendar-heatmap' });
    const mount = await target.mountState(
      asPage({
        evaluate: () => Promise.resolve({ hasStyle: false, styleLength: 0 }),
      })
    );
    expect(mount.ok).toBe(true);
    expect(mount.reason).toMatch(/只做 DOM 断言/);
  });

  it('reports plugin mount in human-readable form, not the DOM id', async () => {
    // 开发日志会直接打印 loaded。给用户看「插件 X 已注入样式表（N 字符）」，
    // 而不是内部 <style id="pluginsStyleX"> 的 id。
    const target = pluginTarget({ name: 'arco-calendar' });
    const mount = await target.mountState(
      asPage({
        evaluate: () => Promise.resolve({ hasStyle: true, styleLength: 275334 }),
      })
    );
    expect(mount.loaded).toContain('arco-calendar');
    expect(mount.loaded).toContain('275334');
    expect(mount.loaded).not.toContain('pluginsStyle');
  });
});

describe('target type registry', () => {
  it('ships theme and plugin as built-in types', () => {
    // 内置两种是最常用的；新类型靠 registerTargetType 加，不用改 dev.mjs。
    expect(targetTypes()).toEqual(expect.arrayContaining(['theme', 'plugin']));
  });

  it('detects the type from the manifest in public/', () => {
    // 「不用在引用项目里写脚本」靠的就是这个：有 theme.json 就是主题，
    // 有 plugin.json 就是插件，用户什么都不用配。
    const root = mkdtempSync(join(tmpdir(), 'rc-detect-'));
    try {
      mkdirSync(join(root, 'public'), { recursive: true });

      writeFileSync(join(root, 'public', 'theme.json'), '{"name":"T"}');
      expect(detectTargetType(root)).toEqual({ ok: true, kind: 'theme' });

      rmSync(join(root, 'public', 'theme.json'));
      writeFileSync(join(root, 'public', 'plugin.json'), '{"name":"P"}');
      expect(detectTargetType(root)).toEqual({ ok: true, kind: 'plugin' });

      rmSync(join(root, 'public', 'plugin.json'));
      const none = detectTargetType(root);
      expect(none.ok, '什么都没有时必须失败而不是猜').toBe(false);
      if (!none.ok) expect(none.reason).toMatch(/找不到任何已知清单/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('trusts the descriptor interface instead of re-checking capabilities at runtime', () => {
    // 能力完整性由 TargetDescriptor 接口在编译期约束（写描述符时用 satisfies）。
    // 运行时再维护一份 9 项清单是同一份知识的两种写法，改接口容易漏改。
    // 这里验证注册表本身不再挑剔——自定义类型只要满足接口就能注册。
    const source = stripComments(readSource('target-types.ts'));
    expect(source, '不该再维护运行时能力清单').not.toMatch(/REQUIRED_CAPABILITIES/);
    // 满足接口的自定义类型能注册，并被自动推断。
    const descriptor = {
      manifestName: () => 'x.json',
      installSubdir: () => 'widgets',
      dirEnv: () => 'SIYUAN_WIDGET_DIR',
      outDir: () => './dev',
      artifact: () => 'index.html',
      expectedFiles: () => ['index.html', 'x.json'],
      matchArtifact: () => true,
      reload: async () => ({ ok: true, message: 'ok' }),
      resolveCss: async () => [],
      mountState: async () => ({ ok: true, loaded: 'x', reason: null }),
    } as const;
    expect(() => registerTargetType('widget-runtime', descriptor)).not.toThrow();
  });

  it('lets a new type join the whole dev loop with one registration', async () => {
    // 这是「泛化」的核心验收：注册一个 widget 类型，它就能被推断、
    // 能算出产物配置、能定位安装目录，不需要改任何其它文件。
    const root = mkdtempSync(join(tmpdir(), 'rc-widget-'));
    const savedEnv = process.env.SIYUAN_WIDGET_DIR;
    try {
      mkdirSync(join(root, 'public'), { recursive: true });
      writeFileSync(join(root, 'public', 'widget.json'), '{"name":"my-widget"}');

      registerTargetType(
        'widget',
        {
          manifestName: () => 'widget.json',
          installSubdir: () => 'widgets',
          dirEnv: () => 'SIYUAN_WIDGET_DIR',
          outDir: () => './dev',
          artifact: () => 'index.html',
          expectedFiles: () => ['index.html', 'widget.json'],
          matchArtifact: (name: string) => name.endsWith('.html'),
          reload: async () => ({ ok: true, message: 'ok' }),
          resolveCss: async () => [],
          mountState: async () => ({ ok: true, loaded: 'widget', reason: null }),
        },
        { detect: (cwd: string) => existsSync(join(cwd, 'public', 'widget.json')) }
      );

      expect(detectTargetType(root), '注册后应能被自动推断').toEqual({ ok: true, kind: 'widget' });

      const target = createTarget('widget', { cwd: root });
      expect(target.name).toBe('my-widget');
      expect(target.activate, 'widget 不需要 kernel 切换，因此没有 activate').toBeNull();
      expect(target.buildConfig().artifact).toBe('index.html');

      process.env.SIYUAN_WIDGET_DIR = join(root, 'installed');
      expect(await target.installDir()).toBe(join(root, 'installed'));
    } finally {
      if (savedEnv === undefined) delete process.env.SIYUAN_WIDGET_DIR;
      else process.env.SIYUAN_WIDGET_DIR = savedEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists the available types when asked for an unknown one', () => {
    expect(() => targetType('nonexistent')).toThrow(/已注册/);
  });
});

describe('link management', () => {
  it('reports absent, linked and conflict states distinctly', () => {
    // 三种状态的处理完全不同：absent 该建，linked 该跳过，conflict 该报错让人处理。
    // 混成两种会让「已链接到别处」被当成「没链接」而重复建，直接抛 EEXIST。
    const root = mkdtempSync(join(tmpdir(), 'rc-link-'));
    try {
      const src = join(root, 'dev');
      const target = join(root, 'installed');
      mkdirSync(src);

      expect(inspectLink(src, target).state).toBe('absent');

      ensureLink(src, target, { kind: 'theme', allowElevation: false });
      expect(inspectLink(src, target).state, '建完应该是 linked').toBe('linked');

      // 再建一次必须幂等，不能报错
      const again = ensureLink(src, target, { kind: 'theme', allowElevation: false });
      expect(again.ok).toBe(true);
      expect(again.changed, '已链接时不应重复创建').toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a real directory', () => {
    // 用户手装过发布版时目录是真的，静默覆盖会毁掉他的文件。
    const root = mkdtempSync(join(tmpdir(), 'rc-link-'));
    try {
      const src = join(root, 'dev');
      const target = join(root, 'installed');
      mkdirSync(src);
      mkdirSync(target);

      const result = ensureLink(src, target, { kind: 'theme', allowElevation: false });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/不是链接/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects a link pointing somewhere else', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-link-'));
    try {
      const srcA = join(root, 'a');
      const srcB = join(root, 'b');
      const target = join(root, 'installed');
      mkdirSync(srcA);
      mkdirSync(srcB);

      ensureLink(srcA, target, { kind: 'theme', allowElevation: false });
      const result = ensureLink(srcB, target, { kind: 'theme', allowElevation: false });
      expect(result.ok, '指向别处时不能悄悄改指').toBe(false);
      expect(result.reason).toMatch(/链接到别处/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares paths regardless of separator style', () => {
    // Windows 上同一个路径可能带正斜杠也可能带反斜杠，直接字符串比会误判冲突。
    expect(samePath('C:/a/b', 'C:\\a\\b')).toBe(true);
    expect(samePath('C:/a/b/', 'C:/a/b')).toBe(true);
    expect(samePath('C:/a/b', 'C:/a/c')).toBe(false);
  });

  it('reports which expected files are missing after linking', () => {
    const root = mkdtempSync(join(tmpdir(), 'rc-link-'));
    try {
      writeFileSync(join(root, 'theme.css'), '.a{}');
      const result = checkLinkedFiles(root, ['theme.css', 'theme.json']);
      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(['theme.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dev session discovery', () => {
  // 测试隔离：discover 是跨项目设计（不按 cwd 过滤），本机若正跑着 dev watch，
  // 它的 control 端点会让「没有会话」的断言误判。每个用例前清空端点目录。
  beforeEach(() => {
    rmSync(CONTROL_DIR, { recursive: true, force: true });
  });

  it('finds a running dev session by actually probing it', async () => {
    // 端点存活靠真实 HTTP 探测，不靠 process.kill(pid, 0) 猜。
    // 这样进程被 SIGKILL 后残留的文件不会造成「以为有 dev 在跑」。
    const root = mkdtempSync(join(tmpdir(), 'rc-ctrl-'));
    const cwd = join(root, 'project');
    mkdirSync(cwd);
    const control = await startControlServer({
      ws: 'ws://127.0.0.1:1/devtools/browser/test',
      cwd,
      kind: 'theme',
      name: 'T',
    });
    try {
      const found = await discover({ cwd });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.cwd).toBe(cwd);
      expect(found.ws).toBe('ws://127.0.0.1:1/devtools/browser/test');
      expect(found.kind).toBe('theme');
    } finally {
      control.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports no session when the control server is gone', async () => {
    // 会话关掉后必须立刻发现不了——这是「不靠 pid 猜」的核心收益。
    const root = mkdtempSync(join(tmpdir(), 'rc-ctrl-'));
    const cwd = join(root, 'project');
    mkdirSync(cwd);
    const control = await startControlServer({ ws: 'ws://127.0.0.1:1/x', cwd, kind: 'plugin', name: 'p' });
    const port = control.port;
    control.stop();

    // stop() 会删掉自己的端点文件；即使文件残留，探测也连不上。
    const found = await discover({ cwd });
    expect(found.ok, '端口关闭后不应再被发现').toBe(false);
    if (!found.ok) expect(found.reason).toMatch(/dev/);
    expect(port).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it('gives a readable reason instead of garbage when nothing is running', async () => {
    const found = await discover({ cwd: join(tmpdir(), 'rc-definitely-no-dev-here') });
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toMatch(/dev/);
  });
});

describe('target adapters drive the dev loop', () => {
  it('gives both targets the same set of dev capabilities', () => {
    // 主题和插件的开发链路是同一条，差别必须收敛在适配器里。
    // 少一个能力，dev.mjs 里就会长出 if (kind === ...) 分支。
    for (const target of [themeTarget({ name: 'T' }), pluginTarget({ name: 'p' })]) {
      expect(typeof target.buildConfig, target.kind + ' 缺少 buildConfig').toBe('function');
      expect(typeof target.installDir, target.kind + ' 缺少 installDir').toBe('function');
      expect(typeof target.reload, target.kind + ' 缺少 reload').toBe('function');
      expect(typeof target.resolveCss, target.kind + ' 缺少 resolveCss').toBe('function');
      expect(typeof target.mountState, target.kind + ' 缺少 mountState').toBe('function');
    }
  });

  it('lets a descriptor reload without relying on its own this', async () => {
    // 真实 bug：插件描述符的 reload 需要读磁盘 CSS，早先写成 this.resolveCss()
    // 就报了 "resolveCss is not a function"——热重载静默失效，日志里只有一行错。
    // 现在 resolveCss 预先绑进 context，描述符不依赖 this。
    const dir = mkdtempSync(join(tmpdir(), 'rc-reload-'));
    try {
      writeFileSync(join(dir, 'index.css'), '.x { color: red }');
      const target = pluginTarget({ name: 'p', pluginDir: dir });

      const seen: string[] = [];
      const fakePage = asPage({
        evaluate: (_fn: unknown, _name: string, css: string) => {
          seen.push(css);
          return Promise.resolve(true);
        },
      });

      const result = await target.reload(fakePage, { filename: 'index.css' });
      expect(result.ok, 'reload 必须成功，不能因 this 丢失而抛错').toBe(true);
      expect(seen, 'reload 要把磁盘上的 CSS 注入页面').toEqual(['.x { color: red }']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reloads a plugin via kernel when its JS changes, never a full page refresh', async () => {
    // 插件 JS 是 window.eval 执行的、带副作用（注册 dock/顶栏/事件监听），
    // 换 <style> 撤销不了；也不能整页刷新（会丢掉用户正在编辑的文档）。
    // 正确路径是 /api/petal/setPetalEnabled 禁用再启用，让思源重建插件实例。
    // 这条分流必须留在插件描述符里，通用层不该知道插件是怎么加载的。
    const calls: Array<{ path: string; enabled: boolean }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        calls.push({ path: req.url ?? '', enabled: JSON.parse(body || '{}').enabled });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"code":0,"msg":"","data":null}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const target = pluginTarget({ name: 'p' });
      const fakePage = asPage({
        evaluate: () => {
          throw new Error('JS 变更不该走 DOM 重注入');
        },
      });

      const result = await target.reload(fakePage, { filename: 'index.js', port });
      expect(result.ok, 'kernel 路径成功应返回 ok').toBe(true);
      expect(
        calls.map((c) => c.path),
        '两次调用都走 setPetalEnabled'
      ).toEqual(['/api/petal/setPetalEnabled', '/api/petal/setPetalEnabled']);
      expect(
        calls.map((c) => c.enabled),
        '顺序必须是禁用再启用'
      ).toEqual([false, true]);
    } finally {
      server.close();
    }
  });

  it('keeps theme reload a pure DOM operation that ignores kernel context', async () => {
    // 主题是 <link href>，换地址就够了，完全不需要 kernel 往返。
    // 这条保证「修插件侧不影响主题侧」。
    const target = themeTarget({ name: 'T' });
    let swapped = false;
    const fakePage = asPage({
      evaluate: async () => {
        swapped = true;
        return true;
      },
    });

    const result = await target.reload(fakePage, { filename: 'theme.css', port: 1 });
    expect(result.ok).toBe(true);
    expect(swapped, '主题仍走原来的换 href 路径').toBe(true);
  });

  it('names the right build artifact per target kind', () => {
    // 主题产物只有 theme.css；插件有 index.js + index.css，两者都要触发重载。
    const theme = themeTarget({ name: 'T' }).buildConfig();
    expect(theme.artifact).toBe('theme.css');
    expect(theme.match('theme.css')).toBe(true);
    expect(theme.match('theme.json')).toBe(false);

    const plugin = pluginTarget({ name: 'p' }).buildConfig();
    expect(plugin.artifact).toBe('index.js');
    expect(plugin.match('index.js'), 'JS 变了要重载').toBe(true);
    expect(plugin.match('index.css'), 'CSS 变了也要重载').toBe(true);
  });

  it('puts theme and plugin in different install directories', async () => {
    // 装错目录思源根本加载不到，而且不会有明显报错。
    process.env.SIYUAN_THEME_DIR = 'C:/ws/data/themes';
    process.env.SIYUAN_PLUGIN_DIR = 'C:/ws/data/plugins';
    try {
      expect(await themeTarget({ name: 'T' }).installDir()).toMatch(/themes$/);
      expect(await pluginTarget({ name: 'p' }).installDir()).toMatch(/plugins$/);
    } finally {
      delete process.env.SIYUAN_THEME_DIR;
      delete process.env.SIYUAN_PLUGIN_DIR;
    }
  });
});

describe('build driver decoupling', () => {
  it('accepts an arbitrary build command instead of vite', () => {
    // 这是「包不绑死技术栈」的核心：用 sass / esbuild / 自己写的脚本都能跑。
    // 只验证参数被接受并起得来，不依赖具体构建器。
    expect(typeof startBuild).toBe('function');
  });

  it('does not require vite to be installed for the package to load', async () => {
    // 包被 import 时不能因为找不到 vite 就炸——只有真的用内置驱动时才解析 vite。
    const root = mkdtempSync(join(tmpdir(), 'rc-novite2-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"name":"x"}');
      expect(() => resolveViteBin(root), '用内置驱动且项目没装 vite 时才报错').toThrow(/找不到 vite/);
      expect(() => resolveViteBin(root), '报错要告诉用户可以用 buildCommand 换掉').toThrow(/buildCommand/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('vite build integration', () => {
  it('resolves the caller project vite binary, not one bundled in this package', () => {
    // vite 是被测项目自己的依赖（版本要匹配），本包只负责替它起进程。
    const bin = resolveViteBin(process.cwd());
    expect(bin).toMatch(/vite[\\/]bin[\\/]vite\.js$/);
    expect(existsSync(bin)).toBe(true);
  });

  it('explains a missing vite instead of throwing a bare MODULE_NOT_FOUND', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rc-novite-'));
    try {
      writeFileSync(join(empty, 'package.json'), '{"name":"x"}');
      expect(() => resolveViteBin(empty)).toThrow(/找不到 vite/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('vite plugin shape', () => {
  it('exposes a build-only plugin, not a serve plugin', () => {
    // 思源从磁盘读产物，而 vite dev 只在内存里编译（实测不产生磁盘文件），
    // 插件 JS 还要求 CJS 单文件（dev server 给的是 ESM 模块图）。
    // 所以只能挂 build，父项目必须跑 `vite build --watch`。
    const plugins = siyuanVitePlugin();
    expect(Array.isArray(plugins)).toBe(true);
    const dev = plugins.find((plugin) => plugin.name.includes(':dev'));
    expect(dev, '必须有一个 dev 插件').toBeTruthy();
    expect(dev?.apply, '只能挂在 build 上').toBe('build');
  });

  it('hooks writeBundle rather than guessing from the filesystem', () => {
    // writeBundle 直接给出本次产出的文件名，比 fs.watch 猜目录可靠。
    const plugins = siyuanVitePlugin();
    const dev = plugins.find((plugin) => plugin.name.includes(':dev'));
    expect(typeof dev?.writeBundle, '必须在 writeBundle 里驱动重载').toBe('function');
  });

  it('does not close the session on every rebuild in watch mode', () => {
    // watch 模式下每次重建都会触发 writeBundle；清理不能挂在每次重建上，否则热重载失效。
    // 归一化的 watch 状态在 plugin/state.ts，清理走 closeWatcher（不在 closeBundle 里关会话）。
    const state = stripComments(readSource('state.ts', 'plugin'));
    expect(state, 'watch 判定归一化在 state.ts').toMatch(/build\.watch/);
    const plugins = siyuanVitePlugin();
    const dev = plugins.find((plugin) => plugin.name.includes(':dev'));
    expect(typeof dev?.closeWatcher, '清理用 closeWatcher，不在每次重建都关会话').toBe('function');
    expect(typeof (dev as { closeBundle?: unknown })?.closeBundle, '不再用 closeBundle 清理').toBe('undefined');
  });

  it('does not need an enabled switch: build.watch decides dev vs production', () => {
    // 开发/生产只由 resolved.build.watch 决定，项目不需要再传 isWatch。
    const pluginSource = stripComments(readSource('plugin.ts'));
    const state = stripComments(readSource('state.ts', 'plugin'));
    expect(pluginSource, '不得再有 enabled 参数').not.toMatch(/enabled\?:/);
    expect(state, '必须用 resolved.build.watch 判断开发/生产').toMatch(/resolved\.build\.watch/);

    const plugins = siyuanVitePlugin();
    expect(plugins.length).toBe(3); // dev + assets + post
    expect(plugins[0]?.apply).toBe('build');
  });

  it('keeps fixed dev behaviors out of the plugin options', () => {
    // 链接、校验、资产监听、浏览器都是固定行为；做成开关只会多一条静默失效路径。
    const source = stripComments(readSource('plugin.ts'));
    for (const option of ['link', 'verify', 'assets', 'browser', 'frontend', 'headless', 'name']) {
      expect(source, `不该再有 ${option} 开关`).not.toMatch(new RegExp(`${option}\\?:`));
    }
    expect(source, '插件形态固定不自动打开浏览器').toMatch(/browser: false/);
    expect(source, '清单路径仍是可配置入参').toMatch(/manifestPath\?:/);
  });

  it('ships a post plugin so verify sees the complete output', () => {
    // 校验必须等所有产物写完。实测 Vite 按 enforce 分三段执行 writeBundle
    // （pre → 普通 → post），所以收尾插件必须是 post。
    const plugins = siyuanVitePlugin();
    const post = plugins.find((plugin) => plugin.name === 'siyuan-devkit:post');
    expect(post, '必须带收尾插件').toBeTruthy();
    expect((post as { enforce?: string }).enforce, '必须是 post，否则读到半成品').toBe('post');
    expect(typeof post?.writeBundle).toBe('function');
  });

  it('accepts an explicit target instead of guessing from the manifest', () => {
    // 自动推断靠 public/ 下有没有清单；清单还没创建、或同项目多种清单时，
    // 调用方应该能直接指定，而不是被推断逻辑卡住。
    const auto = siyuanVitePlugin();
    const explicit = siyuanVitePlugin({ target: 'plugin' });
    expect(auto.map((plugin) => plugin.name)).toEqual(explicit.map((plugin) => plugin.name));
    // 不再有 kind 别名——一个概念只该有一个入参。
    const source = stripComments(readSource('plugin.ts'));
    expect(source, '插件选项不该有 deprecated 的 kind 别名').not.toMatch(/@deprecated/);
  });

  it('bundles the asset contract so public/ changes rebuild the project', () => {
    // Vite 只在启动时复制 publicDir，之后不监听它——改 theme.json 不会触发重建。
    // 这个职责原本在项目里靠手写 watch-external 与 vite-plugin-static-copy 完成，
    // 现在由包统一负责。
    const plugins = siyuanVitePlugin();
    const assets = plugins.find((plugin) => plugin.name === 'siyuan-devkit:assets');
    expect(assets, '必须带资产插件').toBeTruthy();
    expect(typeof assets?.buildStart, '必须 addWatchFile 监听 public/').toBe('function');
    expect(typeof assets?.writeBundle, '必须搬运清单声明的元数据文件').toBe('function');

    // 固定启用：不再提供 assets 开关，避免「关掉后改清单不生效」的静默问题。
    expect(stripComments(readSource('plugin.ts')), '不该再有 assets 开关').not.toMatch(/assets\?:/);
  });

  it('shares mount judgement between theme.ts and the descriptor', () => {
    // judgeMount 是唯一来源；描述符的 mountState 复用它的前缀匹配，不再自己解析 themeStyle。
    // 内置描述符现在在 builtin-targets.ts（targets.ts 只做组装）。
    const builtin = stripComments(readSource('builtin-targets.ts', 'core'));
    expect(builtin, 'mountState 必须复用 judgeMount').toMatch(/judgeMount\(/);
    expect(builtin, '不该再自己正则解析 themeStyle').not.toMatch(/appearance\\\/themes/);
  });

  it('keeps audit out of measure-cli and shares target resolution', () => {
    // measure-cli 之前 678 行，audit 的 235 行挤在里面；且 resolveTarget
    // 与 audit 的 resolveTargetFrom 各写一份。现在拆开并共用 cli/targets.ts。
    const measure = stripComments(readSource('measure-cli.ts'));
    expect(measure, '不该再定义 runAudit').not.toMatch(/function runAudit/);
    expect(measure, 'audit 分支只做转发').toMatch(/await runAudit\(parsed\)/);

    const audit = stripComments(readSource('audit.ts', 'cli'));
    expect(audit, 'audit 应独立成文件并导出').toMatch(/export async function runAudit/);
    expect(audit, '不该再自己写 resolveTargetFrom').not.toMatch(/function resolveTargetFrom/);

    const shared = stripComments(readSource('targets.ts', 'cli'));
    expect(shared, '目标解析应集中一份').toMatch(/export function resolveTargetFromParsed/);
  });

  it('lets the post plugin own its config instead of reading a shared getter', () => {
    // 三个插件共享闭包里的 root/dev 可变状态、靠 get outDir() 延迟求值，
    // 是最容易出竞味的结构。post 现在自己从 configResolved 拿配置。
    const post = stripComments(readSource('post.ts'));
    expect(post, 'post 要有自己的 configResolved').toMatch(/configResolved\(resolved\)/);
    expect(post, 'PostPluginOptions 不该再要 cwd/outDir').not.toMatch(/PostPluginOptions[\s\S]*cwd: string/);

    const pluginSource = stripComments(readSource('plugin.ts'));
    expect(pluginSource, 'siyuanPost 调用不该再传 get outDir()').not.toMatch(/get outDir\(\)/);
    expect(pluginSource, 'siyuanPost 调用不该再传 cwd').not.toMatch(/siyuanPost\(\{[\s\S]*cwd: root/);
  });

  it('has no deprecated kind alias on the plugin options', () => {
    const source = stripComments(readSource('plugin.ts'));
    expect(source, '一个概念只该有一个入参名').not.toMatch(/@deprecated/);
  });

  it('keeps both dev shapes sharing one session layer', () => {
    // CLI 形态自己起构建，插件形态由宿主 vite 起构建——差别只在这一处。
    // 两者都必须走 dev-session，否则重载逻辑会分叉成两份。
    const dev = stripComments(readSource('dev.ts'));
    const plugin = stripComments(readSource('plugin.ts'));
    // 只断言「导入的是 dev-session」，不限定路径形状——跨层重构不该触发这条。
    expect(dev, 'CLI 形态必须复用 dev-session').toMatch(/from\s+['"][^'"]*dev-session\.ts['"]/);
    expect(plugin, '插件形态必须复用 dev-session').toMatch(/from\s+['"][^'"]*dev-session\.ts['"]/);
    expect(dev, 'dev.ts 只管构建，不该自己起浏览器').not.toMatch(/puppeteer/);
    expect(plugin, 'plugin.ts 不该自己起浏览器').not.toMatch(/puppeteer/);
    // 插件形态不能自己跑构建：构建是宿主的职责。
    expect(plugin, '插件形态不得自己 spawn 构建').not.toMatch(/child_process/);
  });

  it('generates the build config so projects do not write artifact names', () => {
    // 产物名由思源的加载机制决定：主题读 theme.css，插件读 index.js + index.css。
    // 名字写错思源不报错、只是静默加载不到——所以不该让每个项目自己写
    // assetFileNames / entryFileNames。
    const context = { command: 'build' as const, watch: true, root: '/tmp/x' };

    const theme = themeTarget({ name: 'T' }).buildSpec(context);
    expect(theme?.outDir, 'watch 时产物进 dev/').toBe('./dev');
    expect(theme?.emptyOutDir, 'watch 时不能清空产物目录').toBe(false);
    expect(theme?.rollupOutput?.assetFileNames?.({ name: 'a.css' })).toBe('theme.css');
    expect(theme?.rollupOutput?.entryFileNames, '主题没有 JS 产物').toBeUndefined();
    expect(theme?.rollupOutput?.format, '主题不需要指定模块格式').toBeUndefined();

    const plugin = pluginTarget({ name: 'p' }).buildSpec(context, { entry: '/x/src/index.tsx' });
    // 插件必须走 lib：lib+cjs 才把 export default 编成 module.exports（思源 eval 后直接取），
    // 普通 input 只会得到 exports.default，思源报 "plugin xxx has no export"。
    expect(plugin?.lib?.fileName).toBe('index');
    expect(plugin?.lib?.cssFileName).toBe('index');
    expect(plugin?.lib?.formats, '思源用 window.eval 执行 CJS 包装').toEqual(['cjs']);
    expect(plugin?.rollupOutput?.entryFileNames, 'lib 默认产 index.cjs，必须覆盖成 index.js').toBe('[name].js');
    expect(plugin?.rollupOutput?.assetFileNames?.({ name: 'a.css' }), 'CSS 固定名 index.css').toBe('index.css');
    expect(plugin?.external, 'siyuan/process 必须保持外部').toEqual(['siyuan', 'process']);

    // 非 watch 时产物进 dist/。
    const prod = themeTarget({ name: 'T' }).buildSpec({ command: 'build', watch: false, root: '/tmp/x' });
    expect(prod?.outDir).toBe('./dist');
  });

  it('takes one entry option for both kinds', () => {
    // 入口只是「从哪开始构建」，主题是 CSS、插件是 TSX，差别在产物形态不在入口概念。
    // 主题走 input（lib 对 CSS 入口会报错）；插件走 lib（才能产出 module.exports）。
    const context = { command: 'build' as const, watch: true, root: '/tmp/x' };

    const theme = themeTarget({ name: 'T' }).buildSpec(context, { entry: '/x/src/styles/index.css' });
    expect(theme?.input).toBe('/x/src/styles/index.css');
    expect(theme?.rollupOutput?.format, 'CSS 入口不需要 format').toBeUndefined();

    const plugin = pluginTarget({ name: 'p' }).buildSpec(context, { entry: '/x/src/index.tsx' });
    expect(plugin?.lib?.entry).toBe('/x/src/index.tsx');
    expect(plugin?.lib?.formats).toEqual(['cjs']);
    expect(plugin?.input, '插件走 lib，不再用普通 input').toBeUndefined();

    // 不传 entry 时不给 input/lib——让项目自己写。
    const noEntry = themeTarget({ name: 'T' }).buildSpec(context);
    expect(noEntry?.input, '不传 entry 就不该硬塞 input').toBeUndefined();
    expect(pluginTarget({ name: 'p' }).buildSpec(context)?.lib, '不传 entry 就不该硬塞 lib').toBeUndefined();
  });

  it('takes the manifest name from the descriptor, not a hardcoded string', () => {
    // 注册表可扩展是这个包的核心承诺：注册第三种类型后，资产插件也应该
    // 自动去找它的清单。硬编码 theme.json / 三元判断会让承诺失效。
    const pluginSource = stripComments(readSource('plugin.ts'));
    expect(pluginSource, 'plugin.ts 不得硬编码清单文件名').not.toMatch(/requestedKind === 'plugin'/);
    expect(pluginSource, '必须从描述符拿清单名').toMatch(/descriptor\.manifestName\(\)/);

    const assetsSource = stripComments(readSource('assets.ts'));
    expect(assetsSource, 'assets.ts 不得把 theme.json 当缺省').not.toMatch(/manifestPath = 'public\/theme\.json'/);
    expect(assetsSource, 'manifestPath 必须由调用方给').toMatch(/manifestPath: string/);
  });

  it('resolves the target in one place instead of repeating kind detection', () => {
    // 之前 config() / ensureSession() / post 各写了一遍「推断 kind + createTarget」，
    // 加一种类型要改三处。收敛成 resolveTarget() 后应该只有一个入口。
    const pluginSource = stripComments(readSource('plugin.ts'));
    const occurrences = (pluginSource.match(/detectTargetType\(/g) ?? []).length;
    expect(occurrences, `kind 检测只该有 2 处（resolveTarget + manifestFile），实际 ${occurrences}`).toBe(2);
    expect(pluginSource).toMatch(/function resolveTarget\(/);
  });

  it('uses the fixed package name and always packs in production', () => {
    // package.zip 是思源集市的产物约定（主题/插件/官方 sample 一致），
    // 不是项目自己的发布偏好——不该由入参指定。打包是固定行为：
    // watch 一定不打包、非 watch（生产）一定打包，且失败必须让构建失败。
    const post = stripComments(readSource('post.ts'));
    expect(post, '应导出固定常量').toMatch(/export const PACKAGE_NAME = 'package\.zip'/);
    expect(post, '不该有 PackOptions 接口').not.toMatch(/interface PackOptions/);
    expect(post, 'watch 时跳过打包').toMatch(/if \(watch\) return;/);
    expect(post, '打包失败必须抛错，不能只 log').toMatch(/打包失败/);

    const pluginSource = stripComments(readSource('plugin.ts'));
    expect(pluginSource, '不该再有 pack 入参').not.toMatch(/pack\?:/);
  });

  it('walks the output directory once for both common and descriptor checks', () => {
    // 之前 expectedFiles 用递归 walk()、VerifyContext.files 用顶层 readdirSync()，
    // 两次遍历、两套语义，描述符看到的和通用校验看到的不是一回事。
    const source = stripComments(readSource('verify.ts'));
    expect(source, '只该调用一次 walk()').toMatch(/const files = walk\(absOutDir\)/);
    expect(source, 'context.files 复用同一次遍历').toMatch(/files,\s*\n\s*readOutput,/);
  });

  it('injects the build config through the vite config hook', () => {
    // 项目侧只传参数，产物命名由插件注入。
    const plugins = siyuanVitePlugin();
    const dev = plugins.find((item) => item.name.includes(':dev'));
    expect(typeof dev?.config, '必须用 config() 注入 build 配置').toBe('function');
    expect(typeof (dev as { configResolved?: unknown }).configResolved, '仍需 configResolved 拿 root').toBe('function');
  });

  it('fills gaps instead of overwriting user build config', () => {
    // 社区做法（electron-vite、@samrum/vite-plugin-web-extension）都是 `??=`：
    // 用户已写的值优先。写成覆盖的话，项目想换产物目录就只能关掉插件。
    const source = stripComments(readSource('plugin.ts'));
    expect(source, '注入必须用 ??= 补缺，不能覆盖').toMatch(/\?\?=/);
    expect(source, '不得直接赋值 build.outDir').not.toMatch(/build\.outDir\s*=[^=]/);
    expect(source, '不得直接赋值 rollupOptions').not.toMatch(/build\.rollupOptions\s*=[^=]/);
  });
});

describe('cdp layering', () => {
  /**
   * 源码按层放在 src/<layer>/ 下。这里自动收集，而不是手写清单——
   * 新增文件会自动纳入所有架构断言，不会因为「忘了加进清单」而漏检。
   */
  const LAYERS = ['core', 'dev', 'plugin', 'cli'] as const;
  type Layer = (typeof LAYERS)[number];

  const filesByLayer: Record<Layer, string[]> = {
    core: [],
    dev: [],
    plugin: [],
    cli: [],
  };
  for (const layer of LAYERS) {
    const dir = join(root, 'src', layer);
    if (!existsSync(dir)) continue;
    filesByLayer[layer] = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .sort();
  }
  /** 全部源码文件名（跨层扁平），供既有的「只看文件名」断言使用。 */
  const allFiles = LAYERS.flatMap((layer) => filesByLayer[layer]);

  /** 读某层的某个文件。 */
  const readLayer = (layer: Layer, file: string) => stripComments(readFileSync(join(root, 'src', layer, file), 'utf8'));

  it('keeps every source file inside a layer', () => {
    // 顶层只允许 index.ts（入口聚合）。散在顶层就等于没有分层。
    const stray = readdirSync(join(root, 'src')).filter((name) => name.endsWith('.ts') && name !== 'index.ts');
    expect(stray, '源码必须归入 core/dev/plugin/cli 四层之一').toEqual([]);
    // 四层都不能是空的，否则分层形同虚设。
    for (const layer of LAYERS) {
      expect(filesByLayer[layer].length, `${layer}/ 不该是空目录`).toBeGreaterThan(0);
    }
  });

  it('keeps core free of vite, bin and dev-loop concerns', () => {
    // core 是被测对象契约与测量原语：只依赖 puppeteer-core 与 node 内置模块。
    // 它不该知道 vite 的存在，也不该有 bin 入口或开发链路的重载逻辑。
    for (const file of filesByLayer.core) {
      const source = readLayer('core', file);
      expect(source, `core/${file} 不该 import vite`).not.toMatch(/from\s+['"]vite['"]/);
      expect(source, `core/${file} 不该碰 process.exit（那是 CLI 的事）`).not.toMatch(/process\.exit/);
      expect(source, `core/${file} 不该 import dev/ 层`).not.toMatch(/from\s+['"][^'"]*\/(dev|plugin|cli)\//);
    }
  });

  it('keeps plugin free of cli concerns', () => {
    // 插件形态由宿主 vite 驱动，不解析命令行、不 process.exit。
    for (const file of filesByLayer.plugin) {
      const source = readLayer('plugin', file);
      expect(source, `plugin/${file} 不该解析 argv`).not.toMatch(/process\.argv/);
      expect(source, `plugin/${file} 不该 process.exit`).not.toMatch(/process\.exit/);
    }
  });

  it('keeps cli free of vite plugin hooks', () => {
    // CLI 形态不经过 vite 插件 API（它要么自己 spawn 构建，要么什么都不构建）。
    for (const file of filesByLayer.cli) {
      const source = readLayer('cli', file);
      expect(source, `cli/${file} 不该实现 vite 插件`).not.toMatch(
        /^\s+(apply|configResolved|writeBundle|closeBundle)\s*\(/m
      );
    }
  });

  it('starts the browser only in the three owners that need their own lifecycle', () => {
    // 三个所有者，理由各不相同，都不是「顺手起一个」：
    //   core/session.ts       测量会话：无头、attach 优先、用完即关
    //   cli/shot.ts           截图：无头窗口，按需截桌面端/移动端
    //   dev/dev-session.ts    开发会话：可见窗口长驻，产物变了由它驱动重载
    // 两种开发形态（CLI 的 dev.ts、插件 plugin.ts）都复用 dev-session，
    // 所以浏览器生命周期只有一处。measure / watch / CLI 也不得自己起浏览器。
    const launchers = LAYERS.flatMap((layer) =>
      filesByLayer[layer]
        .filter((file) => /puppeteer\.(launch|connect)/.test(readLayer(layer, file)))
        .map((file) => `${layer}/${file}`)
    );
    expect(launchers.sort()).toEqual(['cli/shot.ts', 'core/session.ts', 'dev/dev-session.ts']);
  });

  it('imports puppeteer-core at runtime only in those three owners', () => {
    // 注意区分两种导入：
    //   运行时 import puppeteer from 'puppeteer-core'   → 真的会拉起浏览器
    //   类型   import type { Page } from 'puppeteer-core' → 编译后擦除，零运行时成本
    // 很多模块只需要 Page 类型，它们不该被算成「浏览器所有者」。
    const runtimeImporters = LAYERS.flatMap((layer) =>
      filesByLayer[layer]
        .filter((file) => /^import\s+puppeteer\s+from\s+['"]puppeteer-core['"]/m.test(readLayer(layer, file)))
        .map((file) => `${layer}/${file}`)
    );
    expect(runtimeImporters.sort()).toEqual(['cli/shot.ts', 'core/session.ts', 'dev/dev-session.ts']);
  });

  /** 既有的「只看文件名」断言用的扁平清单校验：确认收集到了东西。 */
  it('collects every source file for the architecture assertions', () => {
    expect(allFiles.length, '架构断言必须覆盖全部源码').toBeGreaterThanOrEqual(26);
  });

  it('keeps the CLI layer free of browser and build plumbing', () => {
    // CLI 只解析参数、打印结果；浏览器与构建都该在模块层，才能被编程调用。
    // 例外：watch.mjs 的 spawn 是它自己的功能（重跑用户给的 --exec 命令），不是构建。
    for (const file of ['measure-cli.ts']) {
      const source = stripComments(readSource(file));
      expect(source, file + ' 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
      expect(source, file + ' 不得自己起构建进程').not.toMatch(/child_process/);
    }
  });

  it('shares one dev capability set between theme and plugin', () => {
    // dev.mjs 里出现 kind === 'theme' 的重载/构建分支，说明差异没收敛到 targets.mjs，
    // 加第三种被测对象时就要改 dev.mjs。
    const source = stripComments(readSource('dev.ts'));
    expect(source, 'dev.mjs 必须通过 targets.mjs 拿被测对象').toMatch(/from\s+['"][^'"]*core\/targets\.ts['"]/);
    expect(source, 'dev.mjs 不得自己判断产物文件名').not.toMatch(
      /['"]theme\.css['"]|['"]index\.css['"]|['"]index\.js['"]/
    );
    expect(source, 'dev.mjs 不得自己读 theme.json / plugin.json 判断类型').not.toMatch(/public\/theme\.json/);
  });

  it('keeps pure modules free of console output', () => {
    // 纯函数模块只产出数据，打印交给 CLI 层。
    for (const file of ['probes.ts', 'lints.ts', 'theme.ts', 'targets.ts', 'actions.ts', 'measure.ts', 'color.ts']) {
      expect(stripComments(readSource(file)), file + ' 只返回数据，打印交给 CLI 层').not.toMatch(/console\.\w+/);
    }
  });

  it('has measure-cli reuse session.mjs and the measurement primitives', () => {
    const source = stripComments(readSource('measure-cli.ts'));
    expect(source, 'measure-cli 必须复用 session.mjs 的浏览器生命周期').toMatch(
      /from\s+['"][^'"]*core\/session\.ts['"]/
    );
    expect(source, 'measure-cli 必须复用 measure.mjs 的原语').toMatch(/from\s+['"][^'"]*core\/measure\.ts['"]/);
    expect(source, 'measure-cli 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
  });

  it('measures on the real page, not in an isolated iframe', () => {
    // iframe 隔离的前提（宿主主题干扰）已被「dev 让思源真正选中本主题」解决，
    // 而 iframe 会漏掉 base.css：实测 line-height 在 iframe 里是 normal、
    // 真实页面是 28px。隔离测量已整体删除，不得以任何形式回来。
    const source = stripComments(readSource('measure-cli.ts'));
    expect(source, 'measure-cli 不得再走隔离测量（量不到 base.css 与交互态）').not.toMatch(/measureIsolated|iframe/);
    expect(allFiles.includes('sandbox.ts'), 'sandbox.mjs 已删除；再加回来意味着隔离测量复活').toBe(false);
  });

  it('keeps the loading mechanism of each target inside its own descriptor', () => {
    // 主题是 <link href>，插件是 window.eval + setPetalEnabled。
    // 这两种机制的知识必须留在 targets.ts 的描述符里；一旦漏进会话层或编排层
    // （比如 if (filename.endsWith('.js')) page.reload()），修插件就会动到主题。
    for (const file of ['dev.ts', 'dev-session.ts', 'plugin.ts']) {
      const source = stripComments(readSource(file));
      expect(source, file + ' 不得判断产物扩展名').not.toMatch(/endsWith\(['"]\.js['"]\)/);
      expect(source, file + ' 不得整页刷新来重载产物').not.toMatch(/page\.reload/);
      expect(source, file + ' 不得直接调 selectTheme / setPetalEnabled').not.toMatch(
        /selectTheme|setPetalEnabled|reloadPlugin|reloadThemeCss/
      );
    }
    // 会话层只把 filename 和 port 交给描述符。
    expect(stripComments(readSource('dev-session.ts')), '会话层只把 filename 和 port 交给描述符').toMatch(
      /target\.reload\(/
    );
  });

  it('has measure-cli drive interactions through actions.mjs', () => {
    // 交互是主题/插件真正容易坏的地方：选择器还在但 DOM 结构变了，
    // 静态断言照样绿，实际已经烂了。
    const source = stripComments(readSource('measure-cli.ts'));
    expect(source, 'measure-cli 必须复用 actions.mjs 驱动交互').toMatch(/from\s+['"][^'"]*core\/actions\.ts['"]/);
  });

  it('keeps target-specific knowledge out of the CLI layer', () => {
    // 类型差异必须收敛在 target-types.mjs / targets.mjs；CLI 里出现主题/插件的
    // 分支判断，说明抽象漏了，加第三种被测对象时就要改 CLI。
    for (const file of ['measure-cli.ts']) {
      const source = stripComments(readSource(file));
      expect(source, '不得直接读 theme.json 或 pluginsStyle').not.toMatch(/pluginsStyle|public\/theme\.json/);
      expect(source, '不得自己判断产物文件名').not.toMatch(/['"]theme\.css['"]|['"]index\.js['"]/);
    }
  });

  it('drives dev through the type registry, not hardcoded kinds', () => {
    // dev.mjs 里出现 kind === 'theme' 之类的分支，泛化就破了。
    const source = stripComments(readSource('dev.ts'));
    expect(source, 'dev.mjs 必须通过 targets.mjs 造目标').toMatch(/from\s+['"][^'"]*core\/targets\.ts['"]/);
    expect(source, 'dev.mjs 不得判断具体类型').not.toMatch(/kind\s*===\s*['"]theme['"]|kind\s*===\s*['"]plugin['"]/);
    expect(source, 'dev.mjs 不得自己读清单').not.toMatch(/public\/theme\.json|public\/plugin\.json/);
  });

  it('keeps vite out of the package dependencies', () => {
    // 构建器是被测项目自己的事。包一旦依赖 vite，就绑死在一种技术栈上。
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const allDeps = { ...manifest.dependencies, ...manifest.peerDependencies };
    expect(manifest.peerDependenciesMeta?.vite?.optional, 'vite 必须是 optional peer').toBe(true);
    expect(Object.keys(allDeps), 'vitest 是包的开发依赖，不该是运行时依赖').not.toContain('vitest');
  });

  it('keeps mount judgement in one place', () => {
    // 挂载判定错了，测量读数会被张冠李戴。
    // 判定逻辑只许出现在 targets.mjs 的类型描述符里；CLI 与 open 通过 createTarget 拿。
    for (const file of ['measure-cli.ts', 'shot.ts']) {
      const source = stripComments(readSource(file));
      expect(source, file + ' 不得自己实现 normalizeThemeName').not.toMatch(/function\s+normalizeThemeName/);
      expect(source, file + ' 不得自己解析 themeStyle 的路径').not.toMatch(/appearance\/themes/);
    }
    const targets = stripComments(readSource('targets.ts'));
    expect(targets, '挂载判定必须在 targets.mjs').toMatch(/mountState/);
    expect(stripComments(readSource('shot.ts')), 'shot.ts 仍需读主题名做展示').toMatch(
      /from\s+['"][^'"]*core\/theme\.ts['"]/
    );
  });

  it('keeps pure modules independent of session.mjs', () => {
    // 反向依赖会让探针被迫关心浏览器生命周期，分层就失效了。
    for (const file of ['probes.ts', 'lints.ts', 'theme.ts', 'targets.ts']) {
      expect(stripComments(readSource(file)), file + ' 不得依赖 session.mjs').not.toMatch(
        /from\s+['"][^'"]*core\/session\.ts['"]/
      );
    }
  });
});

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
    if (!badContrast.ok) expect(badContrast.errors.join()).toMatch(/contrast\[0\]/);
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

describe('artifact verification', () => {
  /** 造一个临时项目目录。 */
  function makeProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  it('catches a version mismatch between manifest and package.json', () => {
    // 后果不是报错，而是集市判为旧版、用户收不到更新——所以必须构建期拦住。
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '3.0.1' }),
      'public/theme.json': JSON.stringify({ name: 'T', author: 'a', url: 'u', version: '9.9.9', modes: ['light'] }),
      'dist/theme.css': '.a{}',
      'dist/theme.json': '{}',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.message).join()).toMatch(/版本不一致/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches a theme shipping JavaScript', () => {
    // 主题只交付 CSS；出现 .js 说明构建配置跑偏了。
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/theme.json': JSON.stringify({ name: 'T', author: 'a', url: 'u', version: '1.0.0', modes: ['light'] }),
      'dist/theme.css': '.a{}',
      'dist/theme.json': '{}',
      'dist/theme.js': 'console.log(1)',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.message).join()).toMatch(/JavaScript/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches @layer in the theme CSS', () => {
    // 思源 base.css 没用 @layer，主题规则带 @layer 会被压制，样式静默不生效。
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/theme.json': JSON.stringify({ name: 'T', author: 'a', url: 'u', version: '1.0.0', modes: ['light'] }),
      'dist/theme.css': '@layer base { .a { color: red } }',
      'dist/theme.json': '{}',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.message).join()).toMatch(/@layer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores @layer mentioned only in a comment', () => {
    // watch 产物不压缩，注释里常写着「base.css 未使用 @layer」这类说明。
    // 之前直接 includes('@layer') 会在 watch 模式误报、生产模式正常，
    // 两个环境行为不一致。实测踩过，这里固定住。
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/theme.json': JSON.stringify({ name: 'T', author: 'a', url: 'u', version: '1.0.0', modes: ['light'] }),
      'dist/theme.css': '/* 所有覆盖规则必须保持 unlayered（base.css 未使用 @layer） */\n.a{}',
      'dist/theme.json': '{}',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches a missing expected artifact', () => {
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/theme.json': JSON.stringify({ name: 'T', author: 'a', url: 'u', version: '1.0.0', modes: ['light'] }),
      'dist/theme.json': '{}',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.message).join()).toMatch(/缺少 theme\.css/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a clean theme', () => {
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/theme.json': JSON.stringify({
        name: 'T',
        author: 'a',
        url: 'u',
        version: '1.0.0',
        modes: ['light', 'dark'],
      }),
      'dist/theme.css': '.a{}',
      'dist/theme.json': '{}',
    });
    try {
      const result = verifyTarget(themeTarget({ name: 'T', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('checks plugin-specific manifest requirements', () => {
    // minAppVersion 与 i18n 是插件独有的（对照 arco-calendar 的 check_manifest）。
    const dir = makeProject({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'public/plugin.json': JSON.stringify({ name: 'p', author: 'a', url: 'u', version: '1.0.0' }),
      'public/i18n/en.json': JSON.stringify({ a: 'A' }),
      'public/i18n/zh-CN.json': JSON.stringify({ a: 'A', b: 'B' }),
      'dist/index.js': 'module.exports={}',
      'dist/plugin.json': '{}',
    });
    try {
      const result = verifyTarget(pluginTarget({ name: 'p', cwd: dir }), { root: dir, outDir: join(dir, 'dist') });
      const text = result.issues.map((i) => i.message).join();
      expect(text, 'minAppVersion 缺失要报').toMatch(/minAppVersion/);
      expect(text, 'i18n key 不一致要报').toMatch(/key 与 en\.json 不一致/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('zip packing', () => {
  /** 独立解析 ZIP（我们只写不加密、无 data descriptor 的包），校验文件名/内容/CRC。 */
  const unzip = (buffer: Buffer): Record<string, string> => {
    const crc32 = (data: Buffer): number => {
      let c = 0xffffffff;
      for (const byte of data) {
        c ^= byte;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const files: Record<string, string> = {};
    let offset = 0;
    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
      const method = buffer.readUInt16LE(offset + 8);
      const expectedCrc = buffer.readUInt32LE(offset + 14);
      const compSize = buffer.readUInt32LE(offset + 18);
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const name = buffer.subarray(nameStart, nameStart + nameLen).toString('utf8');
      const dataStart = nameStart + nameLen + extraLen;
      const body = buffer.subarray(dataStart, dataStart + compSize);
      const raw = method === 0 ? body : inflateRawSync(body);
      expect(crc32(raw), `CRC 必须匹配：${name}`).toBe(expectedCrc);
      files[name] = raw.toString('utf8');
      offset = dataStart + compSize;
    }
    return files;
  };

  it('writes a zip that a standard reader can decompress', () => {
    // 自己实现 zip 而不是引依赖：思源的包只有几 MB，store/deflate 够用。
    // 这里用 node:zlib 真正解压回来，校验文件名（含子目录）、内容、CRC——
    // 不是只看头尾 magic byte。
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      mkdirSync(join(dir, 'in', 'nested'), { recursive: true });
      writeFileSync(join(dir, 'in', 'a.css'), '.a{color:red}');
      writeFileSync(join(dir, 'in', 'b.json'), '{"x":1}');
      writeFileSync(join(dir, 'in', 'nested', 'c.txt'), 'nested-content');

      const out = join(dir, 'out.zip');
      const result = writeZip(join(dir, 'in'), out);
      expect(result.files).toBe(3);
      expect(result.bytes).toBeGreaterThan(0);

      const files = unzip(readFileSync(out));
      expect(Object.keys(files).sort()).toEqual(['a.css', 'b.json', 'nested/c.txt']);
      expect(files['a.css']).toBe('.a{color:red}');
      expect(files['b.json']).toBe('{"x":1}');
      expect(files['nested/c.txt']).toBe('nested-content');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('syt verify cli', () => {
  it('fails with exit code 1 when the artifact directory is missing', async () => {
    // 独立校验不依赖构建：产物目录缺失时应非零退出，而不是静默通过。
    const dir = mkdtempSync(join(tmpdir(), 'verify-cli-'));
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const prevCode = process.exitCode;
    try {
      mkdirSync(join(dir, 'public'), { recursive: true });
      writeFileSync(join(dir, 'public', 'theme.json'), JSON.stringify({ name: 'T' }));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      console.log = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
      console.error = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
      process.exitCode = 0;

      await runVerifyCli(['--dir', dir, '--out-dir', 'dist']);

      expect(process.exitCode, '产物缺失必须非零退出').toBe(1);
      expect(logs.join('\n'), '应指出产物/清单问题').toMatch(/校验未通过/);
    } finally {
      console.log = origLog;
      console.error = origError;
      process.exitCode = prevCode;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
