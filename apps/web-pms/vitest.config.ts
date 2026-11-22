import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // CI has no gitignored .env; pin the demo tenant so modules that
    // call readTenantConfig(import.meta.env) at load (client.ts) don't throw.
    env: {
      VITE_ORG_ID: 'org_demo',
      VITE_PROPERTY_ID: 'prop_demo',
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // jsdom screen tests under v8 coverage on the 2-core CI runner run past
    // the 5s default (a different test each run); one budget, not per-test.
    testTimeout: 15_000,
    environmentMatchGlobs: [
      ['src/**/*.boot.test.tsx', 'jsdom'],
      ['src/auth/**/*.test.tsx', 'jsdom'],
      ['src/screens/**/*.test.tsx', 'jsdom'],
      ['src/shell/**/*.test.tsx', 'jsdom'],
      ['src/providers/**/*.test.tsx', 'jsdom'],
      ['src/dev/**/*.test.tsx', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/dist/**'],
    },
  },
});
