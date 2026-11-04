import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 这些用例都是纯函数/字符串处理，不启动浏览器，可以跑得很快。
    environment: 'node',
  },
});
