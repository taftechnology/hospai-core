import { describe, expect, it } from 'vitest';
import plugin from './index.js';

const RULE_IDS = [
  'no-id-from-name-outside-tenant-router',
  'no-domain-config-from-kv',
  'no-entitlement-in-domain',
  'no-reservations-import-in-bookability',
  'no-platform-import-in-domain',
  'no-pms-importing-addons',
  'no-non-cloneable-boundary-types',
  'no-dom-in-client-core',
  'no-fetch-in-components',
] as const;

describe('eslint-plugin-hospai', () => {
  it('exports the §11 + SPA boundary rules', () => {
    expect(Object.keys(plugin.rules)).toEqual([...RULE_IDS]);
  });

  it('enables all rules in recommended', () => {
    const rules = plugin.configs.recommended.rules;
    expect(Object.keys(rules)).toEqual(RULE_IDS.map((id) => `hospai/${id}`));
    for (const rule of Object.values(rules)) {
      expect(rule).toBe('error');
    }
  });
});
