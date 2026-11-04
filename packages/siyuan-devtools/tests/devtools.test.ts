import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 工具脚本是纯 .mjs 且没有 .d.ts，tsc 无法推断其类型；本文件按下面用例里的形状使用它们。
import { probeTokens } from '../src/probes.mjs';
// @ts-expect-error 同上。
import { parseViewport, viewportFor } from '../src/session.mjs';
// @ts-expect-error 同上。
import { frontendUrl, MOBILE_VIEWPORT } from '../src/siyuan.mjs';
// @ts-expect-error 同上。
import { findDoubleWrappedColors, findProblemsIn } from '../src/lints.mjs';
// @ts-expect-error 同上。
import { pluginTarget, themeTarget } from '../src/targets.mjs';
// @ts-expect-error 同上。
import { checkLinkedFiles, ensureLink, inspectLink, samePath } from '../src/link.mjs';
// @ts-expect-error 同上。
import { findEndpoint, registerEndpoint } from '../src/cdp-registry.mjs';
// @ts-expect-error 同上。
import { resolveViteBin } from '../src/build.mjs';

const root = join(import.meta.dirname, '..');
const cdpDir = join(root, 'src');
const readCdp = (file: string) => readFileSync(join(cdpDir, file), 'utf8');

/**
 * 架构断言只看代码本身：注释里提到 puppeteer.launch / console.log 不算违规。
 * 行注释用 `(?<!:)` 保护 `http://`，否则 siyuan.mjs 里的 URL 会把后半行吃掉。
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');

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
    expect(() => frontendUrl(6806, 'tablet'), '拼错前端必须报错，而不是静默用桌面').toThrow(/未知前端/);
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
    const tokens = await probeTokens(stubPage({ '--rc-brand-8': ' 0 82 217 ', '--rc-radius-base': '6px' }), [
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
    expect(problems[0].token).toBe('--b3-theme-on-surface');
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
    const target = themeTarget({ cssPath: './dev/theme.css', themeName: 'Rem Craft Dev' });
    expect(target.kind).toBe('theme');
    expect(target.name).toBe('Rem Craft Dev');
  });

  it('requires a plugin name', () => {
    expect(() => pluginTarget({}), '插件名是定位插件目录的依据，不能缺').toThrow(/插件名/);
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
      expect(sheets[0].label).toMatch(/index\.css$/);
      expect(sheets[0].text).toBe('.fake-plugin { color: red }');
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
    const mount = await target.mountState({ evaluate: () => Promise.resolve(null) });
    expect(mount.ok, 'null 要变成可读的错误，不能抛异常').toBe(false);
    expect(mount.reason).toMatch(/页面不可用/);
  });

  it('tolerates a running plugin that injected no stylesheet', async () => {
    const target = pluginTarget({ name: 'Calendar-heatmap' });
    const mount = await target.mountState({
      evaluate: () => Promise.resolve({ hasStyle: false, styleLength: 0 }),
    });
    expect(mount.ok).toBe(true);
    expect(mount.reason).toMatch(/只做 DOM 断言/);
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

describe('cdp endpoint registry', () => {
  it('picks the endpoint registered for the current directory', () => {
    // 浏览器是机器级资源，工作目录是项目级：在插件项目起 dev、在主题项目
    // attach 时必须能找回同一个端点，否则 --attach 在跨项目场景下直接失效。
    const root = mkdtempSync(join(tmpdir(), 'rc-reg-'));
    const cwd = join(root, 'project');
    mkdirSync(cwd);
    const unregister = registerEndpoint('ws://127.0.0.1:1/devtools/browser/test', { cwd });
    try {
      const found = findEndpoint({ cwd });
      expect(found.ok).toBe(true);
      expect(found.cwd).toBe(cwd);
    } finally {
      unregister();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('explains why no endpoint is available instead of returning garbage', () => {
    const found = findEndpoint({ cwd: join(tmpdir(), 'rc-definitely-no-dev-here') });
    // 没有 dev 会话时必须给出可读原因，让 CLI 能直接打印出来
    if (!found.ok) expect(found.reason).toMatch(/dev|浏览器/);
  });
});

describe('target adapters drive the dev loop', () => {
  it('gives both targets the same set of dev capabilities', () => {
    // 主题和插件的开发链路是同一条，差别必须收敛在适配器里。
    // 少一个能力，dev.mjs 里就会长出 if (kind === ...) 分支。
    for (const target of [themeTarget({ themeName: 'T' }), pluginTarget({ name: 'p' })]) {
      expect(typeof target.buildConfig, target.kind + ' 缺少 buildConfig').toBe('function');
      expect(typeof target.installDir, target.kind + ' 缺少 installDir').toBe('function');
      expect(typeof target.reload, target.kind + ' 缺少 reload').toBe('function');
      expect(typeof target.resolveCss, target.kind + ' 缺少 resolveCss').toBe('function');
      expect(typeof target.mountState, target.kind + ' 缺少 mountState').toBe('function');
    }
  });

  it('names the right build artifact per target kind', () => {
    // 主题产物只有 theme.css；插件有 index.js + index.css，两者都要触发重载。
    const theme = themeTarget({ themeName: 'T' }).buildConfig();
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
      expect(await themeTarget({ themeName: 'T' }).installDir()).toMatch(/themes$/);
      expect(await pluginTarget({ name: 'p' }).installDir()).toMatch(/plugins$/);
    } finally {
      delete process.env.SIYUAN_THEME_DIR;
      delete process.env.SIYUAN_PLUGIN_DIR;
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

describe('cdp layering', () => {
  const cliFiles = ['measure-cli.mjs', 'watch.mjs', 'open.mjs', 'dev-cli.mjs', 'link-cli.mjs'];
  const allFiles = [
    'session.mjs',
    'probes.mjs',
    'siyuan.mjs',
    'theme.mjs',
    'targets.mjs',
    'actions.mjs',
    'lints.mjs',
    'measure.mjs',
    'color.mjs',
    'workspace.mjs',
    'link.mjs',
    'build.mjs',
    'cdp-registry.mjs',
    'dev.mjs',
    ...cliFiles,
  ];

  it('starts the browser only in the three owners that need their own lifecycle', () => {
    // 三个所有者，理由各不相同，都不是「顺手起一个」：
    //   session.mjs  测量会话：无头、attach 优先、用完即关
    //   open.mjs     人工复审：必须可见窗口，且要能 --shot / 多前端标签页
    //   dev.mjs      开发循环：可见窗口长驻，产物变了由它自己驱动重载
    // measure / watch / 两个 CLI 必须复用上面的入口，否则浏览器生命周期无人统一管理。
    const launchers = allFiles.filter((file) => /puppeteer\.(launch|connect)/.test(stripComments(readCdp(file))));
    expect(launchers.sort()).toEqual(['dev.mjs', 'open.mjs', 'session.mjs']);
  });

  it('imports puppeteer-core only in those three owners', () => {
    const importers = allFiles.filter((file) => /from\s+['"]puppeteer-core['"]/.test(stripComments(readCdp(file))));
    expect(importers.sort()).toEqual(['dev.mjs', 'open.mjs', 'session.mjs']);
  });

  it('keeps the CLI layer free of browser and build plumbing', () => {
    // CLI 只解析参数、打印结果；浏览器与构建都该在模块层，才能被编程调用。
    // 例外：watch.mjs 的 spawn 是它自己的功能（重跑用户给的 --exec 命令），不是构建。
    for (const file of ['measure-cli.mjs', 'dev-cli.mjs', 'link-cli.mjs']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
      expect(source, file + ' 不得自己起构建进程').not.toMatch(/child_process/);
    }
  });

  it('shares one dev capability set between theme and plugin', () => {
    // dev.mjs 里出现 kind === 'theme' 的重载/构建分支，说明差异没收敛到 targets.mjs，
    // 加第三种被测对象时就要改 dev.mjs。
    const source = stripComments(readCdp('dev.mjs'));
    expect(source, 'dev.mjs 必须通过 targets.mjs 拿被测对象').toMatch(/from\s+['"]\.\/targets\.mjs['"]/);
    expect(source, 'dev.mjs 不得自己判断产物文件名').not.toMatch(
      /['"]theme\.css['"]|['"]index\.css['"]|['"]index\.js['"]/
    );
    expect(source, 'dev.mjs 不得自己读 theme.json / plugin.json 判断类型').not.toMatch(/public\/theme\.json/);
  });

  it('keeps pure modules free of console output', () => {
    // 纯函数模块只产出数据，打印交给 CLI 层。
    for (const file of [
      'probes.mjs',
      'lints.mjs',
      'theme.mjs',
      'targets.mjs',
      'actions.mjs',
      'measure.mjs',
      'color.mjs',
    ]) {
      expect(stripComments(readCdp(file)), file + ' 只返回数据，打印交给 CLI 层').not.toMatch(/console\.\w+/);
    }
  });

  it('has measure-cli reuse session.mjs and the measurement primitives', () => {
    const source = stripComments(readCdp('measure-cli.mjs'));
    expect(source, 'measure-cli 必须复用 session.mjs 的浏览器生命周期').toMatch(/from\s+['"]\.\/session\.mjs['"]/);
    expect(source, 'measure-cli 必须复用 measure.mjs 的原语').toMatch(/from\s+['"]\.\/measure\.mjs['"]/);
    expect(source, 'measure-cli 不得自己碰 puppeteer').not.toMatch(/puppeteer/);
  });

  it('measures on the real page, not in an isolated iframe', () => {
    // iframe 隔离的前提（宿主主题干扰）已被「dev 让思源真正选中本主题」解决，
    // 而 iframe 会漏掉 base.css：实测 line-height 在 iframe 里是 normal、
    // 真实页面是 28px。隔离测量已整体删除，不得以任何形式回来。
    const source = stripComments(readCdp('measure-cli.mjs'));
    expect(source, 'measure-cli 不得再走隔离测量（量不到 base.css 与交互态）').not.toMatch(/measureIsolated|iframe/);
    expect(allFiles.includes('sandbox.mjs'), 'sandbox.mjs 已删除；再加回来意味着隔离测量复活').toBe(false);
  });

  it('has measure-cli drive interactions through actions.mjs', () => {
    // 交互是主题/插件真正容易坏的地方：选择器还在但 DOM 结构变了，
    // 静态断言照样绿，实际已经烂了。
    const source = stripComments(readCdp('measure-cli.mjs'));
    expect(source, 'measure-cli 必须复用 actions.mjs 驱动交互').toMatch(/from\s+['"]\.\/actions\.mjs['"]/);
  });

  it('keeps target-specific knowledge out of measure-cli', () => {
    // 主题与插件的差异必须收敛在 targets.mjs；measure-cli 里出现主题/插件的分支判断，
    // 说明抽象漏了，加第三个被测对象时就要改 measure-cli。
    const source = stripComments(readCdp('measure-cli.mjs'));
    expect(source, 'measure-cli 必须通过 targets.mjs 拿被测对象').toMatch(/from\s+['"]\.\/targets\.mjs['"]/);
    expect(source, 'measure-cli 不得直接读 theme.json 或 pluginsStyle').not.toMatch(/pluginsStyle|public\/theme\.json/);
  });

  it('keeps mount judgement in one place', () => {
    // 挂载判定错了，测量读数会被张冠李戴。
    for (const file of ['measure-cli.mjs', 'open.mjs']) {
      const source = stripComments(readCdp(file));
      expect(source, file + ' 必须复用 theme.mjs 的挂载判定/主题名').toMatch(/from\s+['"]\.\/theme\.mjs['"]/);
      expect(source, file + ' 不得自己实现 normalizeThemeName').not.toMatch(/function\s+normalizeThemeName/);
    }
  });

  it('keeps pure modules independent of session.mjs', () => {
    // 反向依赖会让探针被迫关心浏览器生命周期，分层就失效了。
    for (const file of ['probes.mjs', 'lints.mjs', 'theme.mjs', 'targets.mjs']) {
      expect(stripComments(readCdp(file)), file + ' 不得依赖 session.mjs').not.toMatch(
        /from\s+['"]\.\/session\.mjs['"]/
      );
    }
  });
});
