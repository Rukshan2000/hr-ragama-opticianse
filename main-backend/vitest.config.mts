import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/server.ts', 'src/database/**'],
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
          // Files share one test database; run them serially to keep cleanup deterministic.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
