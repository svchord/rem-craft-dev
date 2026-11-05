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
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
}

/** 控制服务句柄。 */
export interface ControlServer {
  port: number;
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
    };
  } catch (cause) {
    requireRecoverable(cause);
    return null;
  }
}

/** 起控制服务，由 dev 进程持有。 */
export async function startControlServer(info: Omit<DevSessionInfo, 'pid'>): Promise<ControlServer> {
  mkdirSync(CONTROL_DIR, { recursive: true });

  const server = createServer((req, res) => {
    if (req.url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...info, pid: process.pid }));
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
  const file = endpointFile(process.pid);
  writeFileSync(file, JSON.stringify({ port, pid: process.pid }));

  let stopped = false;
  return {
    port,
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

/** 找可复用的 dev 会话；只读，不删文件。 */
export async function discover({ cwd = process.cwd() }: { cwd?: string } = {}): Promise<DiscoverResult> {
  let files: string[] = [];
  try {
    files = endpointFiles();
  } catch (cause) {
    requireRecoverable(cause);
    return { ok: false, reason: '没有正在运行的 dev 会话（先跑 syt dev）', candidates: [] };
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
    return { ok: false, reason: '没有正在运行的 dev 会话（先跑 syt dev）', candidates: [] };
  }

  const mine = alive.find((info) => samePath(info.cwd, cwd));
  if (mine) return { ok: true, ...mine };
  const only = alive[0];
  if (alive.length === 1 && only) return { ok: true, ...only };

  return {
    ok: false,
    reason:
      '有多个 dev 会话在跑，且都不属于当前目录：切到对应项目目录再跑，或把该会话的 cwd 作为 discover({ cwd }) 传入',
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
