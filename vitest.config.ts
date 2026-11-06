import { defineConfig } from 'vitest/config';

// 测试文件全部显式 import { describe, it, expect } from 'vitest'，
// 不用 globals；也全仓没有 vi.mock/vi.fn，所以不开 restoreMocks/clearMocks。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
