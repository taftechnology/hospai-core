import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15_000,
    environmentMatchGlobs: [
      ['src/screens/**/*.test.tsx', 'jsdom'],
      ['src/auth/**/*.test.tsx', 'jsdom'],
      ['src/api/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/dist/**'],
    },
  },
});
