import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const log = (info) => console.log('\x1B[36m%s\x1B[0m', info);
export const error = (info) => console.error('\x1B[31m%s\x1B[0m', info);

const POST_HEADER = {
  'Content-Type': 'application/json',
};

async function myfetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: () => JSON.parse(data) });
        } catch (cause) {
          reject(cause);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** 工作区若配置了 api.token，getWorkspaces 需要带 Authorization；优先用环境变量，其次读工作区配置。 */
function resolveApiToken() {
  const explicit = process.env.SIYUAN_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }
  const manifest = readWorkspaceManifest();
  for (const workspace of manifest ?? []) {
    try {
      const conf = JSON.parse(fs.readFileSync(path.join(workspace.path, 'conf', 'conf.json'), 'utf8'));
      if (conf?.api?.token) {
        return conf.api.token;
      }
    } catch {
      // 忽略：继续找下一个工作区
    }
  }
  return null;
}

/** 桌面端记录工作区路径的清单文件。 */
function readWorkspaceManifest() {
  const candidates = [
    path.join(os.homedir(), '.config', 'siyuan', 'workspace.json'),
    path.join(process.env.APPDATA ?? '', 'SiYuan', 'workspace.json'),
    path.join(process.env.APPDATA ?? '', 'SiYuan-Electron', 'workspace.json'),
  ];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) {
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        return data.map((workspacePath) => ({ path: workspacePath }));
      }
    } catch {
      // 忽略：继续找下一个候选
    }
  }
  return null;
}

export async function getSiYuanDir() {
  const url = 'http://127.0.0.1:6806/api/system/getWorkspaces';
  const headers = { ...POST_HEADER };
  const token = resolveApiToken();
  if (token) {
    headers.Authorization = `Token ${token}`;
  }
  try {
    const response = await myfetch(url, { method: 'POST', headers });
    if (response.status !== 200) {
      error(`\tHTTP-Error: ${response.status}`);
      return null;
    }
    const conf = await response.json();
    return Array.isArray(conf?.data) ? conf.data : null;
  } catch (cause) {
    error(`\tError: ${cause}`);
    error('\tPlease make sure SiYuan is running!');
    return null;
  }
}

async function chooseTarget(workspaces) {
  const count = workspaces.length;
  log(`>>> Got ${count} SiYuan ${count > 1 ? 'workspaces' : 'workspace'}`);
  workspaces.forEach((workspace, index) => {
    log(`\t[${index}] ${workspace.path}`);
  });

  if (count === 1) {
    return path.join(workspaces[0].path, 'data', 'themes');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`\tPlease select a workspace[0-${count - 1}]: `, resolve);
  });
  rl.close();
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    error(`Invalid workspace index: ${answer}`);
    process.exit(1);
  }
  return path.join(workspaces[index].path, 'data', 'themes');
}

/**
 * Resolve `<workspace>/data/themes` or the explicit `SIYUAN_THEME_DIR`.
 * 环境变量优先，便于 CI 与自定义工作区绕过运行中内核的探测。
 * 注意：主题装到 data/themes，不是 data/plugins。
 */
export async function resolveTargetDir() {
  const explicit = process.env.SIYUAN_THEME_DIR?.trim();
  if (explicit) {
    log(`>>> Using SIYUAN_THEME_DIR: ${explicit}`);
    return path.resolve(explicit);
  }

  log('>>> Looking for a running SiYuan workspace...');
  let workspaces = await getSiYuanDir();
  if (!workspaces || workspaces.length === 0) {
    log('>>> Kernel API unavailable, falling back to workspace manifest...');
    workspaces = readWorkspaceManifest();
  }
  if (!workspaces || workspaces.length === 0) {
    error('>>> Could not find a SiYuan workspace.');
    error('\tMake sure SiYuan is running, or set SIYUAN_THEME_DIR to <workspace>/data/themes.');
    process.exit(1);
  }
  const targetDir = await chooseTarget(workspaces);
  log(`>>> Theme directory: ${targetDir}`);
  return targetDir;
}

export function getThisThemeName() {
  const manifestPath = './public/theme.json';
  if (!fs.existsSync(manifestPath)) {
    process.chdir('..');
    if (!fs.existsSync(manifestPath)) {
      error('Failed! public/theme.json not found');
      return null;
    }
  }
  const theme = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!theme?.name) {
    error('Failed! Please set theme name in public/theme.json');
    return null;
  }
  return theme.name;
}

export function cmpPath(path1, path2) {
  const normalize = (value) => path.resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  return normalize(path1) === normalize(path2);
}

export function copyDirectory(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  fs.cpSync(srcDir, dstDir, { recursive: true });
}

/**
 * Make a directory symlink.
 * 与 arco 的差异：Windows 未开开发者模式时 symlink 会 EPERM，
 * 这里回退到 junction（本地目录不需要管理员权限；思源按路径读取主题文件，junction 可用）。
 */
export function makeSymbolicLink(srcPath, targetPath) {
  let targetStat;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch (cause) {
    if (cause.code !== 'ENOENT') {
      throw cause;
    }
  }

  if (targetStat) {
    if (!targetStat.isSymbolicLink()) {
      error(`Failed! ${targetPath} already exists and is not a symbolic link.`);
      error('Rename or remove it first, or use "pnpm make-install" to copy the build instead.');
      process.exit(1);
    }
    const existingTarget = path.resolve(path.dirname(targetPath), fs.readlinkSync(targetPath));
    if (cmpPath(existingTarget, srcPath)) {
      log(`Good! ${targetPath} is already linked to ${srcPath}`);
      return;
    }
    error(`Error! ${targetPath} already links to ${existingTarget}`);
    process.exit(1);
  }

  try {
    fs.symlinkSync(srcPath, targetPath, 'dir');
    log(`Done! Created symlink: ${targetPath}`);
  } catch (cause) {
    if (cause.code !== 'EPERM' && cause.code !== 'EACCES') {
      throw cause;
    }
    log('>>> symlink not permitted (no Developer Mode), falling back to junction...');
    try {
      fs.symlinkSync(srcPath, targetPath, 'junction');
      log(`Done! Created junction: ${targetPath}`);
      return;
    } catch (junctionCause) {
      error('Cannot create the directory link (permission denied).');
      error('Choose one of these options:');
      error('  1. Windows: enable Developer Mode (Settings -> System -> For developers), then retry.');
      error('  2. Run the terminal as Administrator, then retry.');
      error('  3. Run "pnpm make-install" to copy dist/ into the theme directory instead.');
      error(`\tJunction error: ${junctionCause.message}`);
      process.exit(1);
    }
  }
}
