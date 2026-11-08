import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests use a real Postgres (Docker) and, for the pipeline, local anvil nodes.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
  },
});
