/**
 * dev 会话的本地控制服务与端点发现。
 *
 * dev 进程（CLI 形态或插件形态）本来常驻，让它自己监听一个本地 HTTP 端口，
 * measure / open 作为客户端去问「浏览器在哪」：
 *
 *   - 端点存活 = 端口能连上并能返回信息，不再靠 process.kill(pid, 0) 猜
 *   - 每个会话写自己的文件（control-<pid>.json），没有共享 JSON 的写竞争
 *   - 多会话按 cwd 精确匹配；有歧义时如实列出候选，不猜
 *
 * 端口文件只存端口号，不含浏览器状态——状态在 dev 进程内存里。
 * 残留孤儿文件由显式的 pruneDeadEndpoints() 清理：discover 是只读发现，
 * 不再顺手删文件（之前 JSON 解析失败也 rmSync，把 IO 错误一起吞了）。
 *
 * 刷新屏障：产物变化时 dev 会话会广播整页刷新。刷新期间 /info 的 ready=false，
 * measure 连上后会等它变回 true 再读数，避免撞进页面重新加载的空窗。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { samePath } from './paths.ts';
import { fetchOk } from './net.ts';
import { isRecord } from './guards.ts';
import { requireRecoverable } from './errors.ts';
import { TIMING } from './timing.ts';

/** 端点文件目录（机器级，不在任何项目目录里）。 */
export const CONTROL_DIR = join(tmpdir(), 'siyuan-devkit');
const FILE_PREFIX = 'control-';

/** 一个 dev 会话对外暴露的信息。 */
export interface DevSessionInfo {
  /** CDP WebSocket 端点。 */
  ws: string;
  /** 该会话所属项目目录。 */
  cwd: string;
  /** 被测类型（theme / plugin / ...）。 */
  kind: string;
  /** 被测对象名。 */
  name: string;
  /** 拥有该会话的进程。 */
  pid?: number;
  /** 控制服务端口，measure 用它轮询刷新屏障。 */
  port?: number;
  /** 页面是否可测（false = 正在整页刷新）。 */
  ready?: boolean;
}

/** 控制服务句柄。 */
export interface ControlServer {
  port: number;
  /** 刷新期间置 false，页面重新挂载后置 true。 */
  setReady(ready: boolean): void;
  /** 当前正在读数的测量会话数。 */
  activeReaders(): number;
  /**
   * 等所有读租约释放再刷新。超时返回 false（有崩溃的读者没释放），
   * 由调用方决定是强刷还是跳过，不在这里死等。
   */
  waitForIdle(timeoutMs: number): Promise<boolean>;
  stop(): void;
}

/** 发现结果。 */
export type DiscoverResult =
  | ({ ok: true } & DevSessionInfo)
  | { ok: false; reason: string; candidates: Array<Pick<DevSessionInfo, 'cwd' | 'kind' | 'name' | 'pid'>> };

function endpointFile(pid: number): string {
  return join(CONTROL_DIR, `${FILE_PREFIX}${pid}.json`);
}

/** 端点文件过滤：discover / pruneDeadEndpoints / endpointFiles 共用一份。 */
const isEndpointFile = (name: string): boolean => name.startsWith(FILE_PREFIX) && name.endsWith('.json');

/** 实际连一次控制服务，能返回合法 info 才算活着。 */
async function probeEndpoint(port: number): Promise<DevSessionInfo | null> {
  const response = await fetchOk(`http://127.0.0.1:${port}/info`, TIMING.controlProbe);
  if (!response) return null;
  try {
    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data['ws'] !== 'string') return null;
    return {
      ws: data['ws'],
      cwd: typeof data['cwd'] === 'string' ? data['cwd'] : '',
      kind: typeof data['kind'] === 'string' ? data['kind'] : '',
      name: typeof data['name'] === 'string' ? data['name'] : '',
      pid: typeof data['pid'] === 'number' ? data['pid'] : undefined,
      port: typeof data['port'] === 'number' ? data['port'] : undefined,
      ready: typeof data['ready'] === 'boolean' ? data['ready'] : true,
    };
  } catch (cause) {
    requireRecoverable(cause);
    return null;
  }
}

/** 起控制服务，由 dev 进程持有。 */
export async function startControlServer(info: Omit<DevSessionInfo, 'pid' | 'port' | 'ready'>): Promise<ControlServer> {
  mkdirSync(CONTROL_DIR, { recursive: true });

  // 读租约用「客户端给的 token」标识，Set.add/delete 天然幂等：
  //   - 客户端即使拿不到响应体也知道自己的 token，可以无条件归还；
  //   - 崩溃的读者由 TTL 清理，不会让 waitForIdle 永远等不到 0。
  let ready = true;
  const leases = new Map<string, number>();
  let boundPort = 0;
  /** 清掉超过 TTL 的租约（测量进程崩溃没归还的情况）。 */
  const pruneLeases = (): void => {
    const cutoff = Date.now() - TIMING.readLeaseTtl;
    for (const [token, since] of leases) if (since < cutoff) leases.delete(token);
  };
  const server = createServer((req, res) => {
    const json = (body: unknown): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/info') {
      json({ ...info, pid: process.pid, ready, port: boundPort });
      return;
    }
    if (url.pathname === '/ready') {
      pruneLeases();
      json({ ready, readers: leases.size });
      return;
    }
    // 申请读租约：刷新期间拒绝（不占用名额），刷新结束后由调用方重试。
    if (url.pathname === '/acquire') {
      if (!ready) {
        json({ ok: false, reason: 'refreshing' });
        return;
      }
      const token = url.searchParams.get('token');
      if (!token) {
        json({ ok: false, reason: 'missing token' });
        return;
      }
      pruneLeases();
      leases.set(token, Date.now());
      json({ ok: true });
      return;
    }
    if (url.pathname === '/release') {
      const token = url.searchParams.get('token');
      if (token) leases.delete(token);
      json({ ok: true });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    server.close();
    throw new Error('控制服务没能拿到监听端口');
  }
  const port = address.port;
  boundPort = port;
  const file = endpointFile(process.pid);
  try {
    writeFileSync(file, JSON.stringify({ port, pid: process.pid }));
  } catch (cause) {
    // 端点文件写不出去时，已 listen 的 server 必须关掉，否则留一个没人能发现的孤儿端口。
    server.close();
    throw cause;
  }

  let stopped = false;
  return {
    port,
    setReady(value: boolean): void {
      ready = value;
    },
    activeReaders(): number {
      pruneLeases();
      return leases.size;
    },
    async waitForIdle(timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        pruneLeases();
        if (leases.size === 0) return true;
        await new Promise((resolve) => setTimeout(resolve, TIMING.controlProbe));
      }
      pruneLeases();
      return leases.size === 0;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      rmSync(file, { force: true });
      server.close();
    },
  };
}

/** 供测试/诊断：当前登记的端点文件（不校验存活）。 */
export function endpointFiles(): string[] {
  if (!existsSync(CONTROL_DIR)) return [];
  return readdirSync(CONTROL_DIR).filter(isEndpointFile);
}

/**
 * 申请一次读租约：刷新期间会一直重试，直到 dev 会话把页面刷新完。
 * 拿到租约后 dev 会等所有人释放才广播下一次刷新，所以「检查完才开始的刷新」
 * 也能挡住，不只是刷新中才开始的那些。
 *
 * 返回释放函数；调用方必须在读数结束后调它（包括异常路径），否则 dev 会一直等。
 */
export async function acquireReadLease(port: number, timeoutMs: number): Promise<(() => Promise<void>) | null> {
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  const endpoint = (path: string): string => `http://127.0.0.1:${port}${path}?token=${encodeURIComponent(token)}`;
  // token 由客户端给，release 无条件幂等：响应体坏掉、进程中途失败都能归还，
  // 不会像「计数器 + 盲目 -1」那样泄漏读者或误减别人的名额。
  const release = async (): Promise<void> => {
    await fetchOk(endpoint('/release'), TIMING.controlProbe);
  };
  while (Date.now() < deadline) {
    const response = await fetchOk(endpoint('/acquire'), TIMING.controlProbe);
    if (response) {
      let acquired = false;
      try {
        const data: unknown = await response.json();
        acquired = isRecord(data) && data['ok'] === true;
      } catch (cause) {
        requireRecoverable(cause);
      }
      if (acquired) {
        let released = false;
        return async (): Promise<void> => {
          if (released) return;
          released = true;
          await release();
        };
      }
      // 被拒绝（refreshing）或响应坏掉：先归还再重试。
      await release();
    }
    await new Promise((resolve) => setTimeout(resolve, TIMING.controlProbe));
  }
  return null;
}

/** 找可复用的 dev 会话；只读，不删文件。 */
export async function discover({ cwd = process.cwd() }: { cwd?: string } = {}): Promise<DiscoverResult> {
  let files: string[] = [];
  try {
    files = endpointFiles();
  } catch (cause) {
    requireRecoverable(cause);
    return { ok: false, reason: '没有正在运行的 dev 会话（先跑 pnpm dev 或 vite build --watch）', candidates: [] };
  }

  const alive: DevSessionInfo[] = [];
  for (const name of files) {
    const file = join(CONTROL_DIR, name);
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const port = isRecord(data) ? data['port'] : undefined;
      if (typeof port !== 'number') continue; // 坏端点文件：跳过，由 pruneDeadEndpoints 清理
      const info = await probeEndpoint(port);
      if (info) alive.push(info);
    } catch (cause) {
      // 坏 JSON / 读不到文件都只是孤儿，跳过；其它错误重抛。
      requireRecoverable(cause);
    }
  }

  if (!alive.length) {
    return { ok: false, reason: '没有正在运行的 dev 会话（先跑 pnpm dev 或 vite build --watch）', candidates: [] };
  }

  const mine = alive.find((info) => samePath(info.cwd, cwd));
  if (mine) return { ok: true, ...mine };
  // 单端点也校验 cwd：在 A 项目 --attach 却连到 B 项目的 dev 浏览器，
  // 会输出 attached:true 并量错页面，agent 完全无从察觉。
  return {
    ok: false,
    reason:
      `找到 dev 会话，但它的项目目录不是当前目录（${cwd}）。\n` +
      '  --attach 只复用同一项目的常驻页：请切到对应项目目录，或在那个目录下跑 pnpm dev。',
    candidates: alive.map((info) => ({ cwd: info.cwd, kind: info.kind, name: info.name, pid: info.pid })),
  };
}

/**
 * 显式清理孤儿端点文件：进程被 SIGKILL 来不及 stop() 时残留的那些。
 * 判活靠真实探测而不是文件存在；只在「文件坏了」或「探测不到端口」时删，
 * 其它 IO 错误会重抛，不会误删。返回被删掉的文件名。
 */
export async function pruneDeadEndpoints(): Promise<string[]> {
  const removed: string[] = [];
  for (const name of endpointFiles()) {
    const file = join(CONTROL_DIR, name);
    let dead = false;
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const port = isRecord(data) ? data['port'] : undefined;
      dead = typeof port !== 'number' || (await probeEndpoint(port)) === null;
    } catch (cause) {
      requireRecoverable(cause);
      dead = true;
    }
    if (dead) {
      rmSync(file, { force: true });
      removed.push(name);
    }
  }
  return removed;
}
