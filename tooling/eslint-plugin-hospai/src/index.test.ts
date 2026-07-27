import { describe, expect, it } from 'vitest';
import plugin, { DOMAIN_KEY_PREFIXES } from './index.js';

describe('eslint-plugin-hospai', () => {
  it('exports the §11 rules', () => {
    expect(plugin.rules['no-id-from-name-outside-tenant-router']).toBeDefined();
    expect(plugin.rules['no-domain-config-from-kv']).toBeDefined();
    expect(plugin.rules['no-entitlement-in-domain']).toBeDefined();
    expect(plugin.rules['no-reservation-scan-availability']).toBeDefined();
    expect(plugin.rules['no-platform-import-in-domain']).toBeDefined();
    expect(plugin.rules['no-pms-importing-addons']).toBeDefined();
  });

  it('lists DOMAIN key prefixes for KV rule', () => {
    expect(DOMAIN_KEY_PREFIXES).toContain('pms.availability');
    expect(DOMAIN_KEY_PREFIXES).toContain('pms.night_audit');
  });
});
