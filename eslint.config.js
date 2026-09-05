import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import hospai from 'eslint-plugin-hospai';

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  fetch: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/vitest.config.ts',
      '**/vite.config.ts',
      'packages/client-core/test/**',
    ],
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: eslint.configs.recommended.rules,
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: eslint.configs.recommended.rules,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      hospai,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...hospai.configs.recommended.rules,
      '@typescript-eslint/no-floating-promises': 'error',
      // TypeScript resolves globals (Workers, DOM); base no-undef false-positives on typed code.
      'no-undef': 'off',
      // Dropped @typescript-eslint recommended — base no-unused-vars floods TS (args, enums, types).
      'no-unused-vars': 'off',
    },
  },
);
