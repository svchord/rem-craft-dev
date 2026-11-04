/**
 * 开发循环 CLI：构建 → 链接 → 让思源加载 → 改完自动重载。
 *
 *   syt dev                       类型从 public/ 清单自动推断
 *   syt dev --kind plugin         显式指定类型
 *   syt dev --name foo            显式指定名字
 *   syt dev --build-command "..." 用别的构建工具（默认 vite build --watch）
 *   syt dev --headless            无头
 *   syt dev --frontend mobile     打开移动端
 *   syt dev --no-link             只构建+重载，不动链接
 *
 * 为什么类型能自动推断：主题项目有 public/theme.json，插件项目有 public/plugin.json，
 * 注册表里的 detect 各自认领。用户什么都不用配。
 *
 * 退出码：正常 Ctrl+C 为 0，参数错误或启动失败为 2。
 */
import { startDev } from '../dev/dev.js';
import { lastValue, parseArgs, wantsHelp } from './cli-args.js';
import { detectTargetType, targetTypes } from '../core/target-types.js';
const PREFIX = '[dev] ';
const USAGE = [
    '用法：syt dev [选项]',
    '',
    '  --kind <类型>            被测类型（缺省从 public/ 清单推断）',
    '  --name <名字>            显式指定名字（缺省从清单读）',
    '  --dir <路径>             项目目录，缺省当前目录',
    '  --build-command <命令>   自定义构建命令（默认 vite build --watch）',
    '  --out <目录>             产物目录，缺省 ./dev',
    '  --frontend desktop|mobile  打开哪个前端，缺省 desktop',
    '  --headless               无头模式',
    '  --no-link                只构建+重载，不建立链接',
].join('\n');
const VALUE_FLAGS = ['--kind', '--name', '--dir', '--build-command', '--out', '--frontend'];
const BOOLEAN_FLAGS = ['--headless', '--no-link', '--help', '-h'];
/** 供 bin/ 与统一 CLI 调用；不在模块顶层自动执行，便于被 import。 */
export async function runDevCli(argv = process.argv.slice(2)) {
    if (wantsHelp(argv)) {
        console.log(USAGE);
        return;
    }
    const parsed = parseArgs(argv, { valueFlags: VALUE_FLAGS, booleanFlags: BOOLEAN_FLAGS });
    const cwd = lastValue(parsed, '--dir') ?? process.cwd();
    // 没给 --kind 就自动推断；推断不出来把可用类型和原因一起说清楚。
    let kind = lastValue(parsed, '--kind');
    const kindWasDetected = !kind;
    if (!kind) {
        const detected = detectTargetType(cwd);
        if (!detected.ok) {
            console.error(`${PREFIX}${detected.reason}`);
            console.error(`${PREFIX}可用类型：${targetTypes().join(' / ')}`);
            process.exit(2);
        }
        kind = detected.kind;
    }
    const frontendArg = lastValue(parsed, '--frontend') ?? 'desktop';
    const frontend = frontendArg === 'mobile' ? 'mobile' : 'desktop';
    let session = null;
    let closing = false;
    const shutdown = async (code = 0) => {
        if (closing)
            return;
        closing = true;
        try {
            await session?.stop();
        }
        catch {
            // 已经没了
        }
        process.exit(code);
    };
    process.on('SIGINT', () => void shutdown(0));
    process.on('SIGTERM', () => void shutdown(0));
    if (kindWasDetected)
        console.log(`${PREFIX}类型：${kind}（从清单推断）`);
    try {
        session = await startDev({
            kind,
            name: lastValue(parsed, '--name') ?? null,
            cwd,
            headless: parsed.flags.has('--headless'),
            frontend,
            link: !parsed.flags.has('--no-link'),
            buildCommand: lastValue(parsed, '--build-command') ?? null,
            outDir: lastValue(parsed, '--out') ?? null,
            log: (message) => console.log(`${PREFIX}${message}`),
        });
    }
    catch (cause) {
        console.error(`${PREFIX}${cause instanceof Error ? cause.message : String(cause)}`);
        await shutdown(2);
        return;
    }
    console.log(`${PREFIX}Ctrl+C 结束`);
    await new Promise(() => { });
}
//# sourceMappingURL=dev-cli.js.map