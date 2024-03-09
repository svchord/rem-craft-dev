import { fileURLToPath, URL } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig } from 'vite';
import livereload from 'rollup-plugin-livereload';
import zipPack from 'vite-plugin-zip-pack';
import fg from 'fast-glob';

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
  build: {
    // 设置入口文件
    emptyOutDir: false,
    // 打包文件所在目录
    outDir: isWatch ? 'dev' : 'dist',
    minify: !isWatch,
    sourcemap: true,
    rollupOptions: {
      input: 'src/main.ts',
      plugins: isWatch
        ? [
            livereload('./dev'),
            {
              //监听静态资源文件
              name: 'watch-external',
              async buildStart() {
                const files = await fg([
                  'public/**',
                  'README*.md',
                  'plugin.json',
                  'icon.png',
                  'preview.png',
                ]);
                for (const file of files) {
                  this.addWatchFile(file);
                }
              },
            },
          ]
        : [zipPack({ inDir: './dist', outDir: './', outFileName: 'package.zip' })],
      output: {
        assetFileNames: (assetInfo) => {
          return assetInfo.name?.endsWith('.css') ? 'theme.css' : 'assets/[name][extname]';
        },
        entryFileNames: 'theme.js',
      },
    },
  },
  server: {
    port: 5173,
  },
});
