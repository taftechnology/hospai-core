import { describe, expect, it } from 'vitest';
import { readTenantConfig } from './tenant.js';

describe('readTenantConfig', () => {
  it('is an optional default: null when either id is missing, never throws', () => {
    expect(readTenantConfig({} as ImportMetaEnv)).toBeNull();
    expect(readTenantConfig({ VITE_ORG_ID: 'o' } as ImportMetaEnv)).toBeNull();
    expect(readTenantConfig({ VITE_PROPERTY_ID: 'p' } as ImportMetaEnv)).toBeNull();
    expect(
      readTenantConfig({ VITE_ORG_ID: 'o', VITE_PROPERTY_ID: 'p' } as ImportMetaEnv),
    ).toEqual({ orgId: 'o', propertyId: 'p' });
  });
});
