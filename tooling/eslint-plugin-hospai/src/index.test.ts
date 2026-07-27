import { describe, expect, it } from 'vitest';
import plugin from './index.js';

describe('eslint-plugin-hospai', () => {
  it('exports the §11 rules', () => {
    expect(plugin.rules['no-id-from-name-outside-tenant-router']).toBeDefined();
    expect(plugin.rules['no-domain-config-from-kv']).toBeDefined();
    expect(plugin.rules['no-entitlement-in-domain']).toBeDefined();
    expect(plugin.rules['no-reservation-scan-availability']).toBeDefined();
  });
});
