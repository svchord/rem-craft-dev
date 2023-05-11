import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    build: {
        // 设置入口文件
        emptyOutDir: false,
        rollupOptions: {
            input: 'src/main.ts',
            output: {
                assetFileNames: (assetInfo) => {
                    return assetInfo.name?.endsWith('.css') ? 'theme.css' : 'assets/[name][extname]'
                },
                entryFileNames: 'theme.js'
            }
        },
        // 打包文件所在目录
        outDir: './dist'
    }
})
