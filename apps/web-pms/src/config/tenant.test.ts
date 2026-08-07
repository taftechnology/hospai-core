import { describe, expect, it } from 'vitest';
import { readTenantConfig } from './tenant.js';

describe('readTenantConfig', () => {
  it('requires org and property', () => {
    expect(() => readTenantConfig({} as ImportMetaEnv)).toThrow(/tenant_config_missing/);
    expect(
      readTenantConfig({ VITE_ORG_ID: 'o', VITE_PROPERTY_ID: 'p' } as ImportMetaEnv),
    ).toEqual({ orgId: 'o', propertyId: 'p' });
  });
});
