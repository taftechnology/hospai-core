import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['src/**/*.boot.test.tsx', 'jsdom'],
      ['src/screens/**/*.test.tsx', 'jsdom'],
      ['src/shell/**/*.test.tsx', 'jsdom'],
      ['src/providers/**/*.test.tsx', 'jsdom'],
      ['src/dev/**/*.test.tsx', 'jsdom'],
    ],
  },
});
