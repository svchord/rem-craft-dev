import fs from 'node:fs';
import path from 'node:path';
import { error, getThisThemeName, log, makeSymbolicLink, resolveTargetDir } from './utils.js';

const targetDir = await resolveTargetDir();
if (!fs.existsSync(targetDir)) {
  error(`Failed! Theme directory does not exist: ${targetDir}`);
  error('Check the workspace path, or set SIYUAN_THEME_DIR to <workspace>/data/themes.');
  process.exit(1);
}

const devDir = path.join(process.cwd(), 'dev');
fs.mkdirSync(devDir, { recursive: true });
log(`>>> Dev directory: ${devDir}`);
if (!fs.existsSync(path.join(devDir, 'theme.css'))) {
  log('>>> dev/theme.css does not exist yet; run "pnpm dev" to build before enabling the theme.');
}
log('>>> Tip: run "pnpm dev" in another terminal to build and watch.');

const name = getThisThemeName();
if (!name) {
  process.exit(1);
}

makeSymbolicLink(devDir, path.join(targetDir, name));
