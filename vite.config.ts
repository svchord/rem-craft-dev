import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import minimist from 'minimist';
import zipPack from 'vite-plugin-zip-pack';
import siyuan from 'vite-plugin-siyuan/plugin';

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;

// public/ 只放「浏览器可直接访问」的静态资源：theme.json / icon.png / preview.png
// README*.md 属于仓库元数据（GitHub 首页 + theme.json.readme 指向包根）。
//
// 产物名（theme.css）、产物目录（dev/ 或 dist/）、清单搬运、public/ 变更监听，
// 全部由 siyuan() 插件按「主题」的约定注入。
// 所以这里不再需要 assetFileNames / outDir / vite-plugin-static-copy / watch-external。

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    // enabled 关掉时插件什么也不做——生产构建不需要浏览器，也不该去连 kernel。
    siyuan({ enabled: isWatch }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },

  build: {
    sourcemap: false,
    minify: !isWatch,
    target: 'es2022',
    // Vite 原生支持以 CSS 为入口：产物只有 theme.css，不会生成 JS。
    // 注意：不能设置 cssCodeSplit: false —— 该选项只适用于 JS 入口，会导致构建报错。
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/styles/index.css'),
      // 生产构建打 package.zip。主题没有 JS，不需要 livereload。
      plugins: isWatch ? [] : [zipPack({ inDir: './dist', outDir: './', outFileName: 'package.zip' })],
    },
  },
});
