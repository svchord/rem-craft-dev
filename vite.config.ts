import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import minimist from 'minimist';
import zipPack from 'vite-plugin-zip-pack';
import siyuan from 'vite-plugin-siyuan/plugin';

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;
const devDistDir = './dev';
const distDir = isWatch ? devDistDir : './dist';

console.log('isWatch=>', isWatch);
console.log('distDir=>', distDir);

// public/ 只放「浏览器可直接访问」的静态资源：theme.json / icon.png / preview.png / assets/**
// README*.md 属于仓库元数据（GitHub 首页 + theme.json.readme 指向包根）。
//
// 清单与 README 的搬运、以及 public/ 变更监听，都由 siyuan() 插件负责：
// Vite 只在启动时复制 publicDir，之后不再监听它——改 theme.json 不会触发重建。
// 所以这里不再需要 vite-plugin-static-copy 或手写的 watch-external。

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    // 开发热重载 + 产物资产。类型从 public/theme.json 推断（也可传 target 显式指定）。
    // enabled: isWatch —— 生产构建不需要浏览器，也不该去连 kernel。
    siyuan({ enabled: isWatch }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },

  build: {
    outDir: distDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: !isWatch,
    target: 'es2022',
    // Vite 原生支持以 CSS 为入口：产物只有 theme.css，不会生成 JS。
    // 注意：不能设置 cssCodeSplit: false —— 该选项只适用于 JS 入口，会导致构建报错。
    rollupOptions: {
      // 生产构建打 package.zip。主题没有 JS，不需要 livereload。
      plugins: isWatch ? [] : [zipPack({ inDir: './dist', outDir: './', outFileName: 'package.zip' })],
      input: resolve(import.meta.dirname, 'src/styles/index.css'),
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'theme.css';
          }
          return assetInfo.name ?? 'asset';
        },
      },
    },
  },
});
