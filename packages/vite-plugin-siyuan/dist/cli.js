/**
 * 统一入口：一个命令，若干子命令。
 *
 *   siyuan-devtools dev              构建 + 链接 + 热重载（类型自动推断）
 *   siyuan-devtools link             链接产物目录到思源安装目录
 *   siyuan-devtools measure <子命令>  在真实页面上量渲染事实
 *   siyuan-devtools open             开浏览器人工复审
 *   siyuan-devtools watch            改完自动重跑指定命令
 *
 * 设计要点：
 *   - **不用在引用项目里写脚本**。`siyuan-devtools dev` 直接跑，
 *     类型靠 public/ 下的清单自动推断，构建命令默认用 vite、也可换掉。
 *   - 类型是可扩展的：registerTargetType() 加一种，--kind 就多一个取值。
 *   - 旧的独立命令（siyuan-measure 等）仍保留，等价于这里的子命令。
 */
import { runDevCli } from './dev-cli.js';
import { runLinkCli } from './link-cli.js';
import { runMeasureCli } from './measure-cli.js';
import { runOpenCli } from './open.js';
import { runWatchCli } from './watch.js';
import { targetTypes } from './target-types.js';
const PREFIX = '[devtools] ';
const COMMANDS = {
    dev: runDevCli,
    link: runLinkCli,
    measure: runMeasureCli,
    open: runOpenCli,
    watch: runWatchCli,
};
function usage() {
    console.log([
        '用法：siyuan-devtools <命令> [参数]',
        '',
        '命令：',
        '  dev       构建 + 链接 + 让思源加载 + 改完自动重载',
        '  link      把构建产物目录链接到思源安装目录',
        '  measure   在真实思源前端里量渲染事实、驱动交互',
        '  open      开可见浏览器人工复审（可截图）',
        '  watch     盯着源码目录，改动后重跑你给的命令',
        '',
        '常用选项：',
        `  --kind <类型>        被测对象类型（${targetTypes().join(' / ')}）；缺省从 public/ 清单自动推断`,
        '  --dir <路径>         项目目录，缺省当前目录',
        '  --frontend <端>      desktop | mobile，缺省 desktop',
        '  --build-command <命令>  自定义构建命令（默认用 vite build --watch）',
        '  --attach             复用正在跑的 dev 浏览器',
        '  --help               显示本帮助',
        '',
        '例子：',
        '  siyuan-devtools dev                      # 主题/插件自动识别',
        '  siyuan-devtools dev --kind plugin        # 显式指定类型',
        '  siyuan-devtools measure tokens --rc-brand-8 --attach',
        '  siyuan-devtools link --check',
        '',
        '也可以直接用独立命令：siyuan-measure / siyuan-open / siyuan-watch / siyuan-dev / siyuan-link',
        "作为 Vite 插件使用时：import siyuan from 'vite-plugin-siyuan/plugin'",
    ].join('\n'));
}
/** 供 bin/ 调用。 */
export async function runCli(argv = process.argv.slice(2)) {
    const command = argv[0];
    if (!command || command === '--help' || command === 'help' || command === '-h') {
        usage();
        process.exit(command ? 0 : 2);
    }
    const handler = COMMANDS[command];
    if (!handler) {
        console.error(`${PREFIX}未知命令：${command}`);
        console.error(`${PREFIX}可用命令：${Object.keys(COMMANDS).join(' / ')}`);
        process.exit(2);
    }
    await handler(argv.slice(1));
}
//# sourceMappingURL=cli.js.map