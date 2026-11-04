/**
 * dev 浏览器的 CDP 端点登记处。
 *
 * 为什么不是项目目录下的一个 `.rc-cdp-ws` 文件：
 *   浏览器是**机器级**资源，一个 Chrome 实例可以同时被多个项目复用。
 *   而工作目录是项目级的——在插件项目里起 `pnpm dev`、在主题项目里跑
 *   `pnpm measure --attach`，两边 cwd 不同，写死的相对路径就找不到了。
 *
 * 所以登记处放在系统临时目录，并支持**多个并发 dev 会话**（主题一个、插件一个）：
 *
 *   { "endpoints": [ { cwd, ws, pid, startedAt } ] }
 *
 * 挑选顺序：同 cwd 的优先 → 只有一个存活的就是它 → 多个存活则要求显式指定，
 * 不猜。猜错会量到另一个项目的页面，比报错糟得多。
 *
 * 进程退出后登记项会残留（SIGKILL 来不及清理），所以读取时按 pid 存活过滤。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** 登记处文件（机器级，不在项目目录里）。 */
export const REGISTRY_FILE = join(tmpdir(), 'siyuan-devtools', 'cdp-endpoints.json');

function readRegistry() {
  if (!existsSync(REGISTRY_FILE)) return { endpoints: [] };
  try {
    const data = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
    return { endpoints: Array.isArray(data?.endpoints) ? data.endpoints : [] };
  } catch {
    return { endpoints: [] };
  }
}

function writeRegistry(registry) {
  mkdirSync(join(REGISTRY_FILE, '..'), { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/** 进程还活着吗（用来剔除异常退出留下的登记项）。 */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM 说明进程存在但没权限发信号，仍算活着
    return cause.code === 'EPERM';
  }
}

const sameDir = (left, right) =>
  resolve(left).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() ===
  resolve(right).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/**
 * 登记一个 dev 浏览器端点。
 *
 * @param cwd  该 dev 会话所属项目目录
 * @param ws   CDP WebSocket 端点
 * @param pid  拥有它的进程（缺省当前进程）
 * @returns 清理函数：调用后移除这条登记
 */
export function registerEndpoint(ws, { cwd = process.cwd(), pid = process.pid } = {}) {
  const registry = readRegistry();
  // 同一进程重复登记（重启会话）时覆盖旧的
  const endpoints = registry.endpoints.filter((item) => item.pid !== pid && isAlive(item.pid));
  endpoints.push({ cwd: resolve(cwd), ws, pid, startedAt: new Date().toISOString() });
  writeRegistry({ endpoints });

  return () => unregisterEndpoint(pid);
}

/** 移除某个进程的登记（幂等）。 */
export function unregisterEndpoint(pid = process.pid) {
  const registry = readRegistry();
  const endpoints = registry.endpoints.filter((item) => item.pid !== pid);
  if (endpoints.length === registry.endpoints.length) return;
  if (endpoints.length) writeRegistry({ endpoints });
  else rmSync(REGISTRY_FILE, { force: true });
}

/**
 * 找可复用的端点。
 *
 * @param cwd 优先选这个项目登记的端点
 * @returns {{ ok: true, ws, cwd } | { ok: false, reason, candidates }}
 */
export function findEndpoint({ cwd = process.cwd() } = {}) {
  const alive = readRegistry().endpoints.filter((item) => isAlive(item.pid));

  if (!alive.length) {
    return { ok: false, reason: '没有正在运行的 dev 浏览器（先跑 siyuan-dev 或 pnpm dev）', candidates: [] };
  }

  const mine = alive.find((item) => sameDir(item.cwd, cwd));
  if (mine) return { ok: true, ws: mine.ws, cwd: mine.cwd };

  if (alive.length === 1) return { ok: true, ws: alive[0].ws, cwd: alive[0].cwd };

  // 多个存活且都不属于当前项目：不猜，把选择权交回去。
  return {
    ok: false,
    reason: '有多个 dev 浏览器在跑，且都不属于当前目录，无法确定复用哪一个',
    candidates: alive.map((item) => ({ cwd: item.cwd, pid: item.pid })),
  };
}
