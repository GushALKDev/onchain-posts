import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests start local anvil nodes and send real transactions.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
  },
});
