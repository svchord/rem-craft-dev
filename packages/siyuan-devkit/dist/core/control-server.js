/**
 * dev 会话的本地控制服务与端点发现。
 *
 * 设计：dev 进程（无论 CLI 形态还是插件形态）本来就是常驻的，让它自己监听一个
 * 本地 HTTP 端口，`measure` / `open` 作为客户端去问「浏览器在哪」。这样：
 *
 *   - 端点存活 = 端口能连上并能返回信息，不再靠 `process.kill(pid, 0)` 猜
 *   - 每个会话写自己的文件（control-<pid>.json），没有共享 JSON 的写竞争
 *   - 进程被 SIGKILL 后残留的文件无害，因为发现时一律实际连一次
 *   - 多会话按 cwd 精确匹配；有歧义时如实列出候选，不猜
 *
 * 端口文件只存一个端口号，不含浏览器状态——状态在 dev 进程内存里。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/** 端点文件目录（机器级，不在任何项目目录里）。 */
export const CONTROL_DIR = join(tmpdir(), 'siyuan-devkit');
const FILE_PREFIX = 'control-';
const PROBE_TIMEOUT_MS = 800;
function endpointFile(pid) {
    return join(CONTROL_DIR, `${FILE_PREFIX}${pid}.json`);
}
const sameDir = (left, right) => resolve(left).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() ===
    resolve(right).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
/** 实际连一次控制服务，能返回 info 才算活着。 */
async function probe(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/info`, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok)
            return null;
        const info = (await response.json());
        return info && typeof info.ws === 'string' ? info : null;
    }
    catch {
        return null;
    }
}
/**
 * 起控制服务，由 dev 进程持有。
 *
 * @param info 客户端拿到的会话信息
 */
export async function startControlServer(info) {
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
    await new Promise((done, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', done);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const file = endpointFile(process.pid);
    writeFileSync(file, JSON.stringify({ port, pid: process.pid }));
    let stopped = false;
    return {
        port,
        stop() {
            if (stopped)
                return;
            stopped = true;
            rmSync(file, { force: true });
            server.close();
        },
    };
}
/**
 * 找可复用的 dev 会话。
 *
 * @param cwd 优先选这个项目启动的会话
 */
export async function discover({ cwd = process.cwd() } = {}) {
    let files = [];
    try {
        files = readdirSync(CONTROL_DIR).filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.json'));
    }
    catch {
        return { ok: false, reason: '没有正在运行的 dev 会话（先跑 syt dev）', candidates: [] };
    }
    const alive = [];
    for (const name of files) {
        const file = join(CONTROL_DIR, name);
        try {
            const { port } = JSON.parse(readFileSync(file, 'utf8'));
            if (!port)
                continue;
            const info = await probe(port);
            if (info)
                alive.push(info);
            // 探测失败 = 进程已被强杀（SIGKILL 来不及清理）。顺手删掉孤儿文件，
            // 避免长期堆积；判活靠探测而不是文件存在，所以删错也无副作用。
            else
                rmSync(file, { force: true });
        }
        catch {
            rmSync(file, { force: true });
        }
    }
    if (!alive.length) {
        return { ok: false, reason: '没有正在运行的 dev 会话（先跑 syt dev）', candidates: [] };
    }
    const mine = alive.find((info) => sameDir(info.cwd, cwd));
    if (mine)
        return { ok: true, ...mine };
    if (alive.length === 1)
        return { ok: true, ...alive[0] };
    return {
        ok: false,
        reason: '有多个 dev 会话在跑，且都不属于当前目录，请用 --attach <cwd> 指定',
        candidates: alive.map((info) => ({ cwd: info.cwd, kind: info.kind, name: info.name, pid: info.pid })),
    };
}
/** 供测试/诊断：当前登记的端点文件（不校验存活）。 */
export function endpointFiles() {
    if (!existsSync(CONTROL_DIR))
        return [];
    return readdirSync(CONTROL_DIR).filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.json'));
}
//# sourceMappingURL=control-server.js.map