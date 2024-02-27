import { fileURLToPath, URL } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig } from 'vite';

const args = process.argv.slice(2);
const isWatch = args[1] === '--watch';
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        { src: './theme.json', dest: './' },
        { src: './README*.md', dest: './' },
        { src: './preview.png', dest: './' },
        { src: './config.json', dest: './' },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    // 预处理器配置项
    // preprocessorOptions: {// ..... },
    devSourcemap: true,
  },
  build: {
    // 设置入口文件
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        assetFileNames: (assetInfo) => {
          return assetInfo.name?.endsWith('.css') ? 'theme.css' : 'assets/[name][extname]';
        },
        entryFileNames: 'theme.js',
      },
    },
    // 打包文件所在目录
    outDir: isWatch ? 'dev' : 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
