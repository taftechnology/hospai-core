import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The multi-step dialog tests (Requests lifecycle, Inspections record) run 4-5 s under v8
    // coverage on CI runners, against a 5 s default; same headroom as web-admin.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
});
