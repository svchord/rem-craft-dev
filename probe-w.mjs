// 关键验证：config() 里判断 build.watch 可靠吗？
//   -w 短参数、config 里写 watch 对象、都不写
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const viteBin = join(require.resolve('vite/package.json').replace(/package\.json$/, ''), 'bin', 'vite.js');

async function probe(label, configExtra, args) {
  const dir = join(process.cwd(), '.pw' + Math.random().toString(36).slice(2, 7));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }));
  writeFileSync(join(dir, 'src', 'index.css'), '.a{color:red}');
  writeFileSync(
    join(dir, 'vite.config.mjs'),
    `const p = () => ({
  name: 'probe',
  config(userConfig) {
    console.log('[PROBE] watch=' + JSON.stringify(userConfig.build?.watch) + ' bool=' + Boolean(userConfig.build?.watch));
    return {};
  },
  configResolved(c) {
    console.log('[RESOLVED] watch=' + Boolean(c.build.watch));
  },
});
export default {
  build: { outDir: 'dev', rollupOptions: { input: 'src/index.css' }${configExtra} },
  plugins: [p()],
};
`
  );

  const proc = spawn(process.execPath, [viteBin, 'build', ...args], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 3500);
    proc.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  const configLine = out.split('\n').find((l) => l.includes('[PROBE]'));
  const resolvedLine = out.split('\n').find((l) => l.includes('[RESOLVED]'));
  console.log(
    `${label.padEnd(24)} ${configLine ? configLine.replace('[PROBE] ', '').trim() : '?'}  |  ${resolvedLine ? resolvedLine.replace('[RESOLVED] ', '').trim() : '?'}`
  );

  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 临时目录删不掉就算了 */
  }
}

console.log('场景                       config() 里看到            configResolved() 里');
await probe('都不传', '', []);
await probe('--watch', '', ['--watch']);
await probe('-w', '', ['-w']);
await probe('config 写 watch:{}', ', watch: {}', []);
await probe('config 写 watch:true', ', watch: true', []);

process.exit(0);
