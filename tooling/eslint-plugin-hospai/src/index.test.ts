import { describe, expect, it } from 'vitest';
import plugin from './index.js';

describe('eslint-plugin-hospai', () => {
  it('exports the seven §11 rules', () => {
    expect(Object.keys(plugin.rules)).toEqual([
      'no-id-from-name-outside-tenant-router',
      'no-domain-config-from-kv',
      'no-entitlement-in-domain',
      'no-reservations-import-in-bookability',
      'no-platform-import-in-domain',
      'no-pms-importing-addons',
      'no-non-cloneable-boundary-types',
    ]);
  });

  it('enables all seven §11 rules in recommended', () => {
    const rules = plugin.configs.recommended.rules;
    expect(Object.keys(rules)).toEqual([
      'hospai/no-id-from-name-outside-tenant-router',
      'hospai/no-domain-config-from-kv',
      'hospai/no-entitlement-in-domain',
      'hospai/no-reservations-import-in-bookability',
      'hospai/no-platform-import-in-domain',
      'hospai/no-pms-importing-addons',
      'hospai/no-non-cloneable-boundary-types',
    ]);
    for (const rule of Object.values(rules)) {
      expect(rule).toBe('error');
    }
  });
});
