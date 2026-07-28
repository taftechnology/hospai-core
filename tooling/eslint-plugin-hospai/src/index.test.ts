import { describe, expect, it } from 'vitest';
import plugin from './index.js';

describe('eslint-plugin-hospai', () => {
  it('exports the §11 rules', () => {
    expect(plugin.rules['no-id-from-name-outside-tenant-router']).toBeDefined();
    expect(plugin.rules['no-domain-config-from-kv']).toBeDefined();
    expect(plugin.rules['no-entitlement-in-domain']).toBeDefined();
    expect(plugin.rules['no-reservations-import-in-bookability']).toBeDefined();
    expect(plugin.rules['no-reservation-scan-availability']).toBeDefined();
    expect(plugin.rules['no-platform-import-in-domain']).toBeDefined();
    expect(plugin.rules['no-pms-importing-addons']).toBeDefined();
  });

  it('aliases the abandoned AST scan rule to the bookability boundary', () => {
    expect(plugin.rules['no-reservation-scan-availability']).toBe(
      plugin.rules['no-reservations-import-in-bookability'],
    );
  });

  it('enables all seven §11 rules in recommended', () => {
    const rules = plugin.configs.recommended.rules;
    expect(rules['hospai/no-id-from-name-outside-tenant-router']).toBe('error');
    expect(rules['hospai/no-domain-config-from-kv']).toBe('error');
    expect(rules['hospai/no-entitlement-in-domain']).toBe('error');
    expect(rules['hospai/no-reservation-scan-availability']).toBe('error');
    expect(rules['hospai/no-reservations-import-in-bookability']).toBe('error');
    expect(rules['hospai/no-platform-import-in-domain']).toBe('error');
    expect(rules['hospai/no-pms-importing-addons']).toBe('error');
  });
});
