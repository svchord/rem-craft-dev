import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const fail = (message) => {
  console.error(`[check-dist] ${message}`);
  process.exit(1);
};

for (const file of ['theme.json', 'theme.css']) {
  if (!existsSync(join(dist, file))) {
    fail(`dist/${file} is missing; run "pnpm build" first`);
  }
}

// 产物契约：主题只允许 CSS，不允许 theme.js
if (readdirSync(dist).some((file) => file.endsWith('.js'))) {
  fail('dist/ contains JavaScript files; themes must ship CSS only');
}

const themeCss = readFileSync(join(dist, 'theme.css'), 'utf8');
// 架构约束：思源 base.css 未使用 @layer，主题覆盖规则必须保持 unlayered
if (themeCss.includes('@layer')) {
  fail('dist/theme.css contains @layer; unlayered app CSS would win the cascade');
}

console.log('[check-dist] OK');
