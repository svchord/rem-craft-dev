import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import minimist from 'minimist';
import siyuan from 'vite-plugin-siyuan/plugin';

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;

// 产物目录、产物名（theme.css）、public/ 监听、README 搬运、产物校验、打 zip，
// 全部由 siyuan() 负责。开发/生产由 build.watch 自动判断，不用传 isWatch。
// 这里只剩「项目自己的偏好」：压缩、sourcemap、别名。

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    siyuan({
      entry: 'src/styles/index.css',
      // 非 watch 时打 package.zip（思源集市的产物名，.releaserc.json 引用它）
      pack: true,
    }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },

  build: {
    sourcemap: false,
    minify: !isWatch,
    target: 'es2022',
  },
});
