import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 纯 Node 环境：用例会起本地 HTTP 服务、建临时目录与 symlink、改 process.env，
    // 但不启动真实浏览器（浏览器相关能力只做契约与静态验证）。
    environment: 'node',
    // 与根 vitest.config.ts 保持一致的 mock 语义，避免用例之间互相污染。
    globals: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
