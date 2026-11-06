import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import { siyuanPlugin } from 'siyuan-devkit';

// 产物目录、产物名（theme.css）、public/ 监听、README 搬运、产物校验、打 zip，
// 全部由 siyuanPlugin() 负责。开发/生产由 build.watch 自动判断：watch 不打包，
// 非 watch 一定打包。minify 也由插件统一管（watch 不压缩、生产压缩），
// 这里不再重复实现——项目要覆盖就自己写 build.minify。

export default defineConfig({
  plugins: [
    UnoCSS(),
    siyuanPlugin({
      entry: 'src/styles/index.css',
    }),
  ],

  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
