import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import UnoCSS from 'unocss/vite';

import { siyuanPlugin } from 'siyuan-devkit';

// 产物目录、产物名（theme.css）、public/ 监听、README 搬运、产物校验、打 zip，
// 全部由 siyuan() 负责。开发/生产由 build.watch 自动判断：watch 不打包，
// 非 watch 一定打包，不需要（也不再提供）pack 开关。

/**
 * watch 时不压缩，便于直接看落盘的 theme.css；生产用 Vite 默认的 esbuild 压缩。
 *
 * 判据只从 `configResolved` 的 `resolved.build.watch` 取——和 siyuan() 插件用的是
 * 同一个来源。早期这里自己用 minimist 解析 argv 得到 isWatch，与插件判据重复，
 * 遇到 config 里写 `watch: {}` 而命令行不带 `--watch` 时两边会不一致。
 */
const minifyInWatch = (): Plugin => {
  let userSetMinify = false;
  return {
    name: 'local:minify-in-watch',
    config(userConfig) {
      userSetMinify = userConfig.build?.minify !== undefined;
      return undefined;
    },
    configResolved(resolved) {
      if (!userSetMinify) resolved.build.minify = resolved.build.watch ? false : 'esbuild';
    },
  };
};

export default defineConfig({
  publicDir: 'public',
  plugins: [
    UnoCSS(),
    minifyInWatch(),
    siyuanPlugin({
      entry: 'src/styles/index.css',
    }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },

  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
