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
