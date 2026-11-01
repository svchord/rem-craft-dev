/**
 * 思源相关的少量胶水（不可避免的部分）：
 *  - 找 kernel 端口（读 port.json 的 PID -> 端口映射）
 *  - 拼前端 URL
 *  - 找本机 Chrome
 * 其余浏览器自动化交给 puppeteer-core。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('未找到 Chrome/Edge，请安装或设置 CHROME_PATH');
  return process.env.CHROME_PATH || found;
}

function runPowerShell(command) {
  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

async function probe(url, timeoutMs = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function findKernelPort() {
  const explicit = process.env.SIYUAN_PORT && process.env.SIYUAN_PORT.trim();
  if (explicit) return Number(explicit);

  const pidText = await runPowerShell(
    '(Get-Process SiYuan-Kernel -ErrorAction SilentlyContinue | Select-Object -First 1).Id'
  );
  const pid = pidText.split(/\s+/).filter(Boolean)[0];

  const mapFiles = [
    join(process.env.USERPROFILE || '', '.config', 'siyuan', 'port.json'),
    join(process.env.APPDATA || '', 'SiYuan', 'port.json'),
  ];

  for (const file of mapFiles) {
    if (!existsSync(file)) continue;
    try {
      const map = JSON.parse(readFileSync(file, 'utf8'));
      if (pid && map[pid]) {
        const port = Number(map[pid]);
        if (await probe('http://127.0.0.1:' + port + '/api/system/status')) return port;
      }
      const values = Object.values(map).map(Number);
      if (values.length) {
        const candidate = values[values.length - 1];
        if (await probe('http://127.0.0.1:' + candidate + '/api/system/status')) return candidate;
      }
    } catch {
      // 继续下一个候选
    }
  }

  for (const port of [6806, 6807, 6808, 6809]) {
    if (await probe('http://127.0.0.1:' + port + '/api/system/status')) return port;
  }
  throw new Error('无法定位 SiYuan kernel 端口：确认思源已启动，或设置 SIYUAN_PORT');
}

export function frontendUrl(port) {
  const r = Math.random().toString(36).slice(2, 9);
  return 'http://127.0.0.1:' + port + '/stage/build/desktop/?r=' + r;
}
