/**
 * 本仓的一条命令开发入口。
 *
 * 通用能力全部来自 siyuan-devtools 包：
 *   - 起 `vite build --watch`         build.mjs
 *   - dev/ 链接到 data/themes          link.mjs + workspace.mjs
 *   - 让思源选中本主题                 theme-dev.mjs
 *   - 产物变了让页面重载               theme-dev.mjs
 *   - 浏览器与 CDP 端点                dev.mjs
 *
 * 本文件只保留本仓特有的部分：主题名从 public/theme.json 读、产物叫 theme.css。
 *
 *   pnpm dev              可见浏览器
 *   pnpm dev --headless   无头
 *
 * 核心思路：**让思源自己加载本主题**，而不是在页面上打补丁。
 * 注入只能模拟「本主题叠在宿主主题之上」，而真实级联里本主题是**替代**宿主主题。
 * 实测差异：注入方式下 --b3-theme-background 读到的是宿主的 #feffff，
 * 切主题后才是本主题的值。让思源自己加载，预览、测量、生产就是同一套级联。
 *
 * 为什么刷新后不需要额外处理：
 *   主题状态在思源配置里，F5 之后思源自己会重新加载它，不依赖任何注入的存活。
 */
import { startDev } from 'siyuan-devtools';

const headless = process.argv.includes('--headless');

let session = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    await session?.stop();
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  session = await startDev({
    kind: 'theme',
    headless,
    log: (message) => console.log('[dev] ' + message),
  });
} catch (cause) {
  console.error('[dev] ' + (cause instanceof Error ? cause.message : String(cause)));
  await shutdown(1);
}

console.log('[dev] Ctrl+C 结束');
await new Promise(() => {});
