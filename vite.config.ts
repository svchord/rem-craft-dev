import { defineConfig } from 'vite';
import UnoCSS from 'unocss/vite';

import siyuan from 'vite-plugin-siyuan';

// 入口 src/theme.scss：Sass 编译 + UnoCSS @apply 展开；产物打包、校验、watch 由 siyuan() 负责。

export default defineConfig({
  plugins: [
    UnoCSS(),
    siyuan({
      entry: 'src/theme.scss',
    }),
  ],

  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
