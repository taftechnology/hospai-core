import tsParser from '@typescript-eslint/parser';
import hospai from 'eslint-plugin-hospai';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist/*',
      '**/dist',
      'dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/coverage/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: { hospai },
    rules: {
      ...hospai.configs.recommended.rules,
    },
  },
];
