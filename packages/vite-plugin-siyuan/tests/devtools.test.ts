import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { probeTokens } from '../src/probes.ts';
import { parseViewport, viewportFor } from '../src/session.ts';
import { frontendUrl, MOBILE_VIEWPORT } from '../src/siyuan.ts';
import { findDoubleWrappedColors, findProblemsIn } from '../src/lints.ts';
import { pluginTarget, themeTarget, createTarget } from '../src/targets.ts';
import { detectTargetType, registerTargetType, targetType, targetTypes } from '../src/target-types.ts';
import { checkLinkedFiles, ensureLink, inspectLink, samePath } from '../src/link.ts';
import { discover, startControlServer } from '../src/control-server.ts';
import siyuanVitePlugin from '../src/plugin.ts';
import { resolveViteBin, startBuild } from '../src/build.ts';

const root = join(import.meta.dirname, '..');
const cdpDir = join(root, 'src');
const readCdp = (file: string) => readFileSync(join(cdpDir, file), 'utf8');

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

  it('refuses to register a type that is missing capabilities', () => {
    // 少一个能力，dev.mjs 就会为它长出分支。宁可注册时就拒绝。
    expect(() => registerTargetType('broken', { manifestName: () => 'x.json' } as never)).toThrow(/缺少/);
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

      ensureLink(src, target, { kind: 'theme' });
      expect(inspectLink(src, target).state, '建完应该是 linked').toBe('linked');

      // 再建一次必须幂等，不能报错
      const again = ensureLink(src, target, { kind: 'theme' });
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

      const result = ensureLink(src, target, { kind: 'theme' });
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

      ensureLink(srcA, target, { kind: 'theme' });
      const result = ensureLink(srcB, target, { kind: 'theme' });
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
    // watch 模式下每次重建都会走 closeBundle；在那里关会话会让热重载失效。
    const source = stripComments(readCdp('plugin.ts'));
    expect(source, 'closeBundle 必须判断 watchMode').toMatch(/watchMode/);
    const plugins = siyuanVitePlugin();
    const dev = plugins.find((plugin) => plugin.name.includes(':dev'));
    expect(typeof dev?.closeBundle).toBe('function');
  });

  it('lets the plugin be disabled for production builds', () => {
    const plugins = siyuanVitePlugin({ enabled: false });
    expect(plugins.length).toBe(2); // dev + assets
    expect(plugins[0]?.apply).toBe('build');
  });

  it('accepts an explicit target instead of guessing from the manifest', () => {
    // 自动推断靠 public/ 下有没有清单；清单还没创建、或同项目多种清单时，
    // 调用方应该能直接指定，而不是被推断逻辑卡住。
    const auto = siyuanVitePlugin();
    const explicit = siyuanVitePlugin({ target: 'plugin' });
    expect(auto.map((plugin) => plugin.name)).toEqual(explicit.map((plugin) => plugin.name));
    // 旧名 kind 仍可用（兼容），target 优先。
    const legacy = siyuanVitePlugin({ kind: 'theme' });
    expect(legacy.map((plugin) => plugin.name)).toEqual(auto.map((plugin) => plugin.name));
  });

  it('bundles the asset contract so public/ changes rebuild the project', () => {
    // Vite 只在启动时复制 publicDir，之后不监听它——改 theme.json 不会触发重建。
    // 这个职责原本在项目里靠手写 watch-external 与 vite-plugin-static-copy 完成，
    // 现在由包统一负责。
    const plugins = siyuanVitePlugin();
    const assets = plugins.find((plugin) => plugin.name === 'vite-plugin-siyuan:assets');
    expect(assets, '必须带资产插件').toBeTruthy();
    expect(typeof assets?.buildStart, '必须 addWatchFile 监听 public/').toBe('function');
    expect(typeof assets?.writeBundle, '必须搬运清单声明的元数据文件').toBe('function');

    // 可关闭：调用方自己接管时不该被强制。
    const bare = siyuanVitePlugin({ assets: false });
    expect(bare.some((plugin) => plugin.name === 'vite-plugin-siyuan:assets')).toBe(false);
  });

  it('keeps both dev shapes sharing one session layer', () => {
    // CLI 形态自己起构建，插件形态由宿主 vite 起构建——差别只在这一处。
    // 两者都必须走 dev-session，否则重载逻辑会分叉成两份。
    const dev = stripComments(readCdp('dev.ts'));
    const plugin = stripComments(readCdp('plugin.ts'));
    expect(dev, 'CLI 形态必须复用 dev-session').toMatch(/from\s+['"]\.\/dev-session\.ts['"]/);
    expect(plugin, '插件形态必须复用 dev-session').toMatch(/from\s+['"]\.\/dev-session\.ts['"]/);
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

    const plugin = pluginTarget({ name: 'p' }).buildSpec(context);
    expect(plugin?.rollupOutput?.assetFileNames?.({ name: 'a.css' })).toBe('index.css');
    expect(plugin?.rollupOutput?.entryFileNames, '插件必须是 CJS 单文件').toBe('[name].js');

    // 非 watch 时产物进 dist/。
    const prod = themeTarget({ name: 'T' }).buildSpec({ command: 'build', watch: false, root: '/tmp/x' });
    expect(prod?.outDir).toBe('./dist');
  });

  it('injects the build config through the vite config hook', () => {
    // 项目侧只传参数，产物命名由插件注入。
    const plugins = siyuanVitePlugin();
    const dev = plugins.find((item) => item.name.includes(':dev'));
    expect(typeof dev?.config, '必须用 config() 注入 build 配置').toBe('function');
    expect(typeof (dev as { configResolved?: unknown }).configResolved, '仍需 configResolved 拿 root').toBe('function');
  });
});

describe('cdp layering', () => {
  const cliFiles = ['measure-cli.ts', 'watch.ts', 'open.ts', 'dev-cli.ts', 'link-cli.ts'];
  // 全部源码文件：架构断言要能覆盖每一个，漏一个就等于放弃一处约束。
  const allFiles = [
    'session.ts',
    'probes.ts',
    'siyuan.ts',
    'theme.ts',
    'targets.ts',
    'target-types.ts',
    'actions.ts',
    'lints.ts',
    'measure.ts',
    'color.ts',
    'workspace.ts',
    'link.ts',
    'kernel.ts',
    'build.ts',
    'control-server.ts',
    'dev-session.ts',
    'dev.ts',
    'plugin.ts',
    'assets.ts',
    'cli-args.ts',
    ...cliFiles,
  ];

  it('starts the browser only in the three owners that need their own lifecycle', () => {
    // 三个所有者，理由各不相同，都不是「顺手起一个」：
    //   session.mjs  测量会话：无头、attach 优先、用完即关
    //   open.mjs     人工复审：必须可见窗口，且要能 --shot / 多前端标签页
    //   dev.mjs      开发循环：可见窗口长驻，产物变了由它自己驱动重载
    // measure / watch / 两个 CLI 必须复用上面的入口，否则浏览器生命周期无人统一管理。
    const launchers = allFiles.filter((file) => /puppeteer\.(launch|connect)/.test(stripComments(readCdp(file))));
    expect(launchers.sort()).toEqual(['dev-session.ts', 'open.ts', 'session.ts']);
  });

  it('imports puppeteer-core at runtime only in those three owners', () => {
    // 注意区分两种导入：
    //   运行时 import puppeteer from 'puppeteer-core'   → 真的会拉起浏览器
    //   类型   import type { Page } from 'puppeteer-core' → 编译后擦除，零运行时成本
    // 很多模块只需要 Page 类型，它们不该被算成「浏览器所有者」。
    const runtimeImporters = allFiles.filter((file) =>
      /^import\s+puppeteer\s+from\s+['"]puppeteer-core['"]/m.test(stripComments(readCdp(file)))
    );
    expect(runtimeImporters.sort()).toEqual(['dev-session.ts', 'open.ts', 'session.ts']);
  });

  it('keeps the CLI layer free of browser and build plumbing', () => {
    // CLI 只解析参数、打印结果；浏览器与构建都该在模块层，才能被编程调用。
    // 例外：watch.mjs 的 spawn 是它自己的功能（重跑用户给的 --exec 命令），不是构建。
    for (const file of ['measure-cli.ts', 'dev-cli.ts', 'link-cli.ts']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
      expect(source, file + ' 不得自己起构建进程').not.toMatch(/child_process/);
    }
  });

  it('shares one dev capability set between theme and plugin', () => {
    // dev.mjs 里出现 kind === 'theme' 的重载/构建分支，说明差异没收敛到 targets.mjs，
    // 加第三种被测对象时就要改 dev.mjs。
    const source = stripComments(readCdp('dev.ts'));
    expect(source, 'dev.mjs 必须通过 targets.mjs 拿被测对象').toMatch(/from\s+['"]\.\/targets\.ts['"]/);
    expect(source, 'dev.mjs 不得自己判断产物文件名').not.toMatch(
      /['"]theme\.css['"]|['"]index\.css['"]|['"]index\.js['"]/
    );
    expect(source, 'dev.mjs 不得自己读 theme.json / plugin.json 判断类型').not.toMatch(/public\/theme\.json/);
  });

  it('keeps pure modules free of console output', () => {
    // 纯函数模块只产出数据，打印交给 CLI 层。
    for (const file of ['probes.ts', 'lints.ts', 'theme.ts', 'targets.ts', 'actions.ts', 'measure.ts', 'color.ts']) {
      expect(stripComments(readCdp(file)), file + ' 只返回数据，打印交给 CLI 层').not.toMatch(/console\.\w+/);
    }
  });

  it('has measure-cli reuse session.mjs and the measurement primitives', () => {
    const source = stripComments(readCdp('measure-cli.ts'));
    expect(source, 'measure-cli 必须复用 session.mjs 的浏览器生命周期').toMatch(/from\s+['"]\.\/session\.ts['"]/);
    expect(source, 'measure-cli 必须复用 measure.mjs 的原语').toMatch(/from\s+['"]\.\/measure\.ts['"]/);
    expect(source, 'measure-cli 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
  });

  it('measures on the real page, not in an isolated iframe', () => {
    // iframe 隔离的前提（宿主主题干扰）已被「dev 让思源真正选中本主题」解决，
    // 而 iframe 会漏掉 base.css：实测 line-height 在 iframe 里是 normal、
    // 真实页面是 28px。隔离测量已整体删除，不得以任何形式回来。
    const source = stripComments(readCdp('measure-cli.ts'));
    expect(source, 'measure-cli 不得再走隔离测量（量不到 base.css 与交互态）').not.toMatch(/measureIsolated|iframe/);
    expect(allFiles.includes('sandbox.ts'), 'sandbox.mjs 已删除；再加回来意味着隔离测量复活').toBe(false);
  });

  it('keeps the loading mechanism of each target inside its own descriptor', () => {
    // 主题是 <link href>，插件是 window.eval + setPetalEnabled。
    // 这两种机制的知识必须留在 targets.ts 的描述符里；一旦漏进会话层或编排层
    // （比如 if (filename.endsWith('.js')) page.reload()），修插件就会动到主题。
    for (const file of ['dev.ts', 'dev-session.ts', 'plugin.ts']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 不得判断产物扩展名').not.toMatch(/endsWith\(['"]\.js['"]\)/);
      expect(source, file + ' 不得整页刷新来重载产物').not.toMatch(/page\.reload/);
      expect(source, file + ' 不得直接调 selectTheme / setPetalEnabled').not.toMatch(
        /selectTheme|setPetalEnabled|reloadPlugin|reloadThemeCss/
      );
    }
    // 会话层只把 filename 和 port 交给描述符。
    expect(stripComments(readCdp('dev-session.ts')), '会话层只把 filename 和 port 交给描述符').toMatch(
      /target\.reload\(/
    );
  });

  it('has measure-cli drive interactions through actions.mjs', () => {
    // 交互是主题/插件真正容易坏的地方：选择器还在但 DOM 结构变了，
    // 静态断言照样绿，实际已经烂了。
    const source = stripComments(readCdp('measure-cli.ts'));
    expect(source, 'measure-cli 必须复用 actions.mjs 驱动交互').toMatch(/from\s+['"]\.\/actions\.ts['"]/);
  });

  it('keeps target-specific knowledge out of the CLI layer', () => {
    // 类型差异必须收敛在 target-types.mjs / targets.mjs；CLI 里出现主题/插件的
    // 分支判断，说明抽象漏了，加第三种被测对象时就要改 CLI。
    for (const file of ['measure-cli.ts', 'dev-cli.ts', 'link-cli.ts']) {
      const source = stripComments(readCdp(file));
      expect(source, '不得直接读 theme.json 或 pluginsStyle').not.toMatch(/pluginsStyle|public\/theme\.json/);
      expect(source, '不得自己判断产物文件名').not.toMatch(/['"]theme\.css['"]|['"]index\.js['"]/);
    }
    // 允许出现类型名的唯一地方是「默认值」，不允许用它做分支。
    const devCli = stripComments(readCdp('dev-cli.ts'));
    expect(devCli, 'dev-cli 必须通过注册表推断类型').toMatch(/detectTargetType/);
  });

  it('drives dev through the type registry, not hardcoded kinds', () => {
    // dev.mjs 里出现 kind === 'theme' 之类的分支，泛化就破了。
    const source = stripComments(readCdp('dev.ts'));
    expect(source, 'dev.mjs 必须通过 targets.mjs 造目标').toMatch(/from\s+['"]\.\/targets\.ts['"]/);
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
    for (const file of ['measure-cli.ts', 'open.ts', 'link-cli.ts', 'dev-cli.ts']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 不得自己实现 normalizeThemeName').not.toMatch(/function\s+normalizeThemeName/);
      expect(source, file + ' 不得自己解析 themeStyle 的路径').not.toMatch(/appearance\/themes/);
    }
    const targets = stripComments(readCdp('targets.ts'));
    expect(targets, '挂载判定必须在 targets.mjs').toMatch(/mountState/);
    expect(stripComments(readCdp('open.ts')), 'open.mjs 仍需读主题名做展示').toMatch(/from\s+['"]\.\/theme\.ts['"]/);
  });

  it('keeps pure modules independent of session.mjs', () => {
    // 反向依赖会让探针被迫关心浏览器生命周期，分层就失效了。
    for (const file of ['probes.ts', 'lints.ts', 'theme.ts', 'targets.ts']) {
      expect(stripComments(readCdp(file)), file + ' 不得依赖 session.mjs').not.toMatch(
        /from\s+['"]\.\/session\.ts['"]/
      );
    }
  });
});
