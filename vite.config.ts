import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import minimist from 'minimist';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import zipPack from 'vite-plugin-zip-pack';
import fg from 'fast-glob';
import siyuanDev from 'vite-plugin-siyuan/plugin';

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;
const devDistDir = './dev';
const distDir = isWatch ? devDistDir : './dist';

console.log('isWatch=>', isWatch);
console.log('distDir=>', distDir);

// public/ 只放「浏览器可直接访问」的静态资源：theme.json / icon.png / preview.png / assets/**
// README*.md 属于仓库元数据（GitHub 首页 + theme.json.readme 指向包根），构建时从仓库根复制进包。
// LICENSE 只留仓库根（仓库法律元数据，不进主题包）。

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    // README 留在仓库根（GitHub 首页 + theme.json.readme 指向包根），构建时复制进主题包；LICENSE 不复制
    viteStaticCopy({ targets: [{ src: 'README*.md', dest: './' }] }),
    // 开发热重载：挂进宿主 vite 的 build 生命周期，产物变了自动让思源重载。
    // 只在 watch 模式启用——生产构建不需要浏览器，也不该去连 kernel。
    siyuanDev({ enabled: isWatch }),
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
      // 与 arco 一致：watch 模式监听 public/ 与 README（Vite 不监听 publicDir）；
      // 生产构建打 package.zip。主题没有 JS，因此不需要 livereload。
      plugins: isWatch
        ? [
            {
              name: 'watch-external',
              async buildStart() {
                const files = await fg(['public/**', 'README*.md']);
                for (const file of files) {
                  this.addWatchFile(file);
                }
              },
            },
          ]
        : [zipPack({ inDir: './dist', outDir: './', outFileName: 'package.zip' })],
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
