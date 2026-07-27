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
});
