import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import minimist from 'minimist';
import zipPack from 'vite-plugin-zip-pack';
import siyuan from 'vite-plugin-siyuan/plugin';

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;

// 产物目录、产物名（theme.css）、public/ 监听、README 搬运，全部由 siyuan() 注入。
// 这里只剩「项目自己的事」：入口在哪、怎么压缩、要不要打 zip。

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    siyuan({
      enabled: isWatch,
      entry: 'src/styles/index.css',
    }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },

  build: {
    sourcemap: false,
    minify: !isWatch,
    target: 'es2022',
    // 生产构建打 package.zip。主题没有 JS，不需要 livereload。
    rollupOptions: {
      plugins: isWatch ? [] : [zipPack({ inDir: './dist', outDir: './', outFileName: 'package.zip' })],
    },
  },
});
