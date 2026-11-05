/**
 * 思源相关的少量胶水（不可避免的部分）：
 *  - 找 kernel 端口（读 port.json 的 PID → 端口映射）
 *  - 拼前端 URL
 *  - 找本机 Chrome
 * 其余浏览器自动化交给 puppeteer-core。
 *
 * 端口/工作区文件的候选路径来自 paths.ts，HTTP 探测来自 net.ts，时长来自
 * timing.ts——之前这些在 siyuan.ts 与 workspace.ts / control-server.ts 各写一份。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fetchOk } from './net.ts';
import { portMapCandidates, readWorkspacePaths } from './paths.ts';
import { isRecord, isString } from './guards.ts';
import { isRecoverable, requireRecoverable, UserFacingError } from './errors.ts';
import { TIMING } from './timing.ts';

// 兼容既有导入：视口常量统一放在 viewport.ts。
export { MOBILE_VIEWPORT } from './viewport.ts';

/** 各平台浏览器候选路径；CHROME_PATH 可覆盖。 */
const CHROME_CANDIDATES: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ],
};

/** 兜底端口：思源默认从 6806 起，多实例时依次递增。 */
const DEFAULT_KERNEL_PORTS = [6806, 6807, 6808, 6809] as const;

/** 找本机 Chrome/Edge；CHROME_PATH 覆盖。 */
export function findChrome(): string {
  const override = process.env.CHROME_PATH?.trim();
  if (override) return override;
  const candidates = CHROME_CANDIDATES[process.platform] ?? [];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('未找到 Chrome/Edge，请安装或设置 CHROME_PATH');
  return found;
}

/**
 * 跑一段 PowerShell 查 kernel 进程 PID。
 * stderr 设为 ignore：Get-Process 的进度/警告不是错误；spawn 失败只接受 ENOENT
 * （没装 PowerShell）作为可恢复，其余重抛，不再一律 resolve('')。
 */
function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('close', () => resolve(out.trim()));
    child.on('error', (cause) => {
      if (isRecoverable(cause, ['ENOENT'])) {
        resolve('');
        return;
      }
      reject(cause);
    });
  });
}

/** 找 kernel 进程 PID（Windows 用 PowerShell；macOS/Linux 用 pgrep），找不到返回空串。 */
async function findKernelPid(): Promise<string> {
  if (process.platform === 'win32') {
    return runPowerShell('(Get-Process SiYuan-Kernel -ErrorAction SilentlyContinue | Select-Object -First 1).Id');
  }
  return new Promise((resolve) => {
    const child = spawn('pgrep', ['-f', 'SiYuan-Kernel'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

/** 探一个端口上是不是思源 kernel。 */
async function probeKernelPort(port: number): Promise<boolean> {
  if (!Number.isFinite(port)) return false;
  return (await fetchOk(`http://127.0.0.1:${port}/api/system/status`, TIMING.kernelProbe)) !== null;
}

/** 找运行中的 kernel 端口：SIYUAN_PORT → PID 查 port.json → 兜底端口。 */
export async function findKernelPort(): Promise<number> {
  const explicit = process.env.SIYUAN_PORT?.trim();
  if (explicit) {
    const port = Number(explicit);
    // 显式端口也必须探测：否则思源没起时会返回一个死端口，插件形态（没有 activate
    // 这条兜底）会一路走到「会话就绪」并打印必然 404 的预览链接，看着活着其实全废。
    if (!Number.isFinite(port) || port <= 0) {
      throw new UserFacingError(`SIYUAN_PORT 不是有效端口：${explicit}（应为正整数）`);
    }
    if (await probeKernelPort(port)) return port;
    throw new UserFacingError(
      `SIYUAN_PORT=${port} 上的思源内核没有响应：确认思源已启动、端口正确，或去掉该环境变量让工具自动探测。`
    );
  }

  const pidText = await findKernelPid().catch((cause: unknown) => {
    requireRecoverable(cause);
    return '';
  });
  const pid = pidText.split(/\s+/).filter(Boolean)[0];

  for (const file of portMapCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(data)) continue;
      const byPid = pid ? data[pid] : undefined;
      if (isString(byPid) && (await probeKernelPort(Number(byPid)))) return Number(byPid);
      const values = Object.values(data).map(Number);
      const candidate = values[values.length - 1];
      if (candidate !== undefined && (await probeKernelPort(candidate))) return candidate;
    } catch (cause) {
      requireRecoverable(cause);
    }
  }

  for (const port of DEFAULT_KERNEL_PORTS) {
    if (await probeKernelPort(port)) return port;
  }
  throw new UserFacingError('无法定位 SiYuan kernel 端口：确认思源已启动，或设置 SIYUAN_PORT');
}

/** 前端入口。桌面与移动是两个独立构建，路径不同。 */
export type Frontend = 'desktop' | 'mobile';

/** 拼前端 URL。默认带随机参数避免缓存；展示给人时可用 `cacheBust: false` 得到稳定地址。 */
export function frontendUrl(
  port: number,
  frontend: Frontend = 'desktop',
  options: { cacheBust?: boolean } = {}
): string {
  if (frontend !== 'desktop' && frontend !== 'mobile') {
    throw new Error(`未知前端：${String(frontend)}（可用：desktop / mobile）`);
  }
  const base = `http://127.0.0.1:${port}/stage/build/${frontend}/`;
  if (options.cacheBust === false) return base;
  const random = Math.random().toString(36).slice(2, 9);
  return `${base}?r=${random}`;
}

/** 一个前端的稳定预览入口。 */
export interface FrontendLink {
  frontend: Frontend;
  url: string;
}

/** 桌面端 + 移动端两个稳定入口，供 CLI / 开发日志同时展示。 */
export function frontendLinks(port: number): readonly [FrontendLink, FrontendLink] {
  return [
    { frontend: 'desktop', url: frontendUrl(port, 'desktop', { cacheBust: false }) },
    { frontend: 'mobile', url: frontendUrl(port, 'mobile', { cacheBust: false }) },
  ];
}

/**
 * 找思源工作区路径（用于定位 data/plugins/、data/themes/）。
 * 只读桌面端记录的 workspace.json，不启动内核——审计插件 CSS 时插件可能
 * 根本没运行。SIYUAN_WORKSPACE 可直接指定；找不到返回 null 由调用方兜底。
 */
export function findWorkspaceDir(): string | null {
  const explicit = process.env.SIYUAN_WORKSPACE?.trim();
  if (explicit) return explicit;
  return readWorkspacePaths()[0] ?? null;
}
