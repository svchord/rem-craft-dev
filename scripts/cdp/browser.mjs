import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  if (!found) throw new Error('未找到 Chrome/Edge，请安装或修改 CHROME_CANDIDATES');
  return found;
}

function run(command) {
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
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 定位 kernel 端口，优先级：
 *   1. SIYUAN_PORT
 *   2. 运行中 kernel 进程 PID -> %USERPROFILE%/.config/siyuan/port.json 的 PID->端口映射
 *   3. 常见端口探测
 */
export async function findKernelPort() {
  const explicit = process.env.SIYUAN_PORT?.trim();
  if (explicit) return Number(explicit);

  const pidText = await run('(Get-Process SiYuan-Kernel -ErrorAction SilentlyContinue | Select-Object -First 1).Id');
  const pid = pidText.split(/\s+/).filter(Boolean)[0];

  const mapFiles = [
    join(process.env.USERPROFILE || '', '.config', 'siyuan', 'port.json'),
    join(process.env.APPDATA || '', 'SiYuan', 'port.json'),
  ];

  for (const file of mapFiles) {
    if (!existsSync(file)) continue;
    try {
      const map = JSON.parse(readFileSync(file, 'utf8'));
      if (pid && map[pid]) return Number(map[pid]);
      const values = Object.values(map).map(Number);
      if (values.length > 0) {
        // 取最后一个（最新启动的实例通常最后写入）
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
  throw new Error('无法定位 SiYuan kernel 端口，请设置 SIYUAN_PORT');
}

/** 浏览器前端 URL。?r= 参数是随机的客户端标识，缺失时思源会自行补上，不影响加载。 */
export function frontendUrl(port) {
  const r = Math.random().toString(36).slice(2, 9);
  return 'http://127.0.0.1:' + port + '/stage/build/desktop/?r=' + r;
}

async function waitJson(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return await res.json();
    } catch {
      // 继续等
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等待超时: ' + url);
}

/** 启动无头浏览器，返回 { evaluate, send, screenshot, close }。 */
export async function openBrowser({ url, width = 1600, height = 1000, headless = true } = {}) {
  const chrome = findChrome();
  const debugPort = 9333 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'rc-chrome-'));
  const windowArgs = headless ? ['--headless=new'] : ['--new-window', '--window-position=40,40'];
  const child = spawn(
    chrome,
    [
      ...windowArgs,
      '--remote-debugging-port=' + debugPort,
      '--window-size=' + width + ',' + height,
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let ws;
  try {
    await waitJson('http://127.0.0.1:' + debugPort + '/json/version');
    await fetch('http://127.0.0.1:' + debugPort + '/json/new?' + encodeURIComponent('about:blank'), {
      method: 'PUT',
    });
    const targets = await waitJson('http://127.0.0.1:' + debugPort + '/json');
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('未找到浏览器页面 target');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });

    function send(method, params = {}, timeoutMs = 25000) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('CDP 超时: ' + method));
          }
        }, timeoutMs);
      });
    }

    async function evaluate(expression, timeoutMs = 25000) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
      return result.result.value;
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url });

    // 等思源前端就绪
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const ready = await evaluate('!!(window.siyuan && window.siyuan.config)').catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 2500));

    return {
      debugPort,
      evaluate,
      send,
      async screenshot(file) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        return file;
      },
      close() {
        try {
          ws.close();
        } catch {
          // 忽略
        }
        try {
          child.kill();
        } catch {
          // 忽略
        }
        try {
          rmSync(profile, { recursive: true, force: true });
        } catch {
          // 忽略
        }
      },
    };
  } catch (cause) {
    try {
      ws?.close();
    } catch {
      // 忽略
    }
    try {
      child.kill();
    } catch {
      // 忽略
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // 忽略
    }
    throw cause;
  }
}
