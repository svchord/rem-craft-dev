import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const fail = (message) => {
  console.error(`[check-manifest] ${message}`);
  process.exit(1);
};

const packageJson = readJson('package.json');
const themeJson = readJson('public/theme.json');

if (packageJson.version !== themeJson.version) {
  fail(`version mismatch: package.json=${packageJson.version}, theme.json=${themeJson.version}`);
}

// 主题清单必需字段（与插件不同：没有 minAppVersion，必须有 modes）
const requiredThemeFields = ['name', 'author', 'url', 'version', 'modes'];
for (const field of requiredThemeFields) {
  if (!themeJson[field]) {
    fail(`theme.json is missing required field: ${field}`);
  }
}

if (!Array.isArray(themeJson.modes) || themeJson.modes.length === 0) {
  fail('theme.json modes must be a non-empty array');
}
for (const mode of themeJson.modes) {
  if (!['light', 'dark'].includes(mode)) {
    fail(`theme.json modes contains invalid value: ${mode} (expected light|dark)`);
  }
}

if (!/^\d+\.\d+\.\d+$/.test(themeJson.version)) {
  fail(`theme.json version must be a semver version: ${themeJson.version}`);
}

for (const field of ['displayName', 'description', 'readme']) {
  const value = themeJson[field];
  if (value && typeof value === 'object' && !Array.isArray(value) && !value.default) {
    fail(`theme.json ${field} must contain a "default" entry`);
  }
}

// 主题不允许出现 theme.js（产物契约：只交付 CSS）
for (const file of ['theme.js', 'src/theme.js', 'src/index.ts']) {
  if (existsSync(join(root, file))) {
    fail(`${file} must not exist: themes ship CSS only (no theme.js)`);
  }
}

if (existsSync(join(root, 'src'))) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(path);
      }
      return [path];
    });

  const sourceFiles = walk(join(root, 'src'));
  const vueFiles = sourceFiles.filter((file) => file.endsWith('.vue'));
  if (vueFiles.length > 0) {
    fail(`Vue source files remain: ${vueFiles.map((file) => file.replace(root, '')).join(', ')}`);
  }
}

const dependencyNames = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
const vueDependencies = dependencyNames.filter(
  (name) => name === 'vue' || name.startsWith('@vue/') || name.includes('vue-') || name.includes('plugin-vue')
);
if (vueDependencies.length > 0) {
  fail(`Vue dependencies remain: ${vueDependencies.join(', ')}`);
}

console.log('[check-manifest] OK');
