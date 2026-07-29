import tsParser from '@typescript-eslint/parser';
import hospai from 'eslint-plugin-hospai';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', '**/coverage/**'],
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
      'hospai/no-id-from-name-outside-tenant-router': 'error',
      'hospai/no-domain-config-from-kv': 'error',
      'hospai/no-entitlement-in-domain': 'error',
      'hospai/no-reservations-import-in-bookability': 'error',
      'hospai/no-platform-import-in-domain': 'error',
      'hospai/no-pms-importing-addons': 'error',
    },
  },
];

