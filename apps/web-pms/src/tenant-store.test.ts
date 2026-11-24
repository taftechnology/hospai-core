// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantOrg } from '@hospai/client-core';
import {
  chooseTenant,
  configureTenantDefault,
  createTenantAccessor,
  readSavedTenant,
  saveTenant,
  setTenantSelection,
  TENANT_STORAGE_KEY,
} from './tenant-store.js';

function org(orgId: string, propertyIds: string[], multiProperty = true): TenantOrg {
  return {
    orgId,
    name: orgId,
    multiProperty,
    properties: propertyIds.map((propertyId) => ({ propertyId, name: propertyId, timeZone: 'UTC' })),
  };
}

const orgs = [org('org_1', ['prop_1a', 'prop_1b']), org('org_2', ['prop_2a'])];

describe('chooseTenant selection order', () => {
  it('uses the saved choice when it is still in the list', () => {
    expect(
      chooseTenant(orgs, { orgId: 'org_2', propertyId: 'prop_2a' }, { orgId: 'org_1', propertyId: 'prop_1b' }),
    ).toEqual({ orgId: 'org_2', propertyId: 'prop_2a' });
  });

  it('ignores a saved choice that is no longer in the list and falls to the env default', () => {
    expect(
      chooseTenant(orgs, { orgId: 'org_gone', propertyId: 'prop_x' }, { orgId: 'org_1', propertyId: 'prop_1b' }),
    ).toEqual({ orgId: 'org_1', propertyId: 'prop_1b' });
    // a saved property that moved out of the org is also ignored
    expect(
      chooseTenant(orgs, { orgId: 'org_1', propertyId: 'prop_2a' }, null),
    ).toEqual({ orgId: 'org_1', propertyId: 'prop_1a' });
  });

  it('ignores an env default that is not in the list; falls to the first property of the first org', () => {
    expect(chooseTenant(orgs, null, { orgId: 'org_demo', propertyId: 'prop_demo' })).toEqual({
      orgId: 'org_1',
      propertyId: 'prop_1a',
    });
  });

  it('is null for an empty list', () => {
    expect(chooseTenant([], null, { orgId: 'org_1', propertyId: 'prop_1a' })).toBeNull();
  });
});

describe('tenant accessor', () => {
  beforeEach(() => {
    setTenantSelection(null);
    configureTenantDefault(null);
  });
  afterEach(() => {
    setTenantSelection(null);
    configureTenantDefault({ orgId: 'org_demo', propertyId: 'prop_demo' });
  });

  it('throws tenant_not_selected with no selection and no default', () => {
    const tenant = createTenantAccessor();
    expect(() => tenant.propertyId).toThrow('tenant_not_selected');
    expect(() => tenant.orgId).toThrow('tenant_not_selected');
  });

  it('reads the env default until a selection is set, then the selection', () => {
    configureTenantDefault({ orgId: 'org_d', propertyId: 'prop_d' });
    const tenant = createTenantAccessor();
    expect(tenant.propertyId).toBe('prop_d');
    setTenantSelection({ orgId: 'org_s', propertyId: 'prop_s' });
    expect(tenant.orgId).toBe('org_s');
    expect(tenant.propertyId).toBe('prop_s');
  });
});

describe('saved choice (hospai.tenant)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips and survives corrupt or blocked storage', () => {
    saveTenant({ orgId: 'o', propertyId: 'p' });
    expect(JSON.parse(localStorage.getItem(TENANT_STORAGE_KEY)!)).toEqual({ orgId: 'o', propertyId: 'p' });
    expect(readSavedTenant()).toEqual({ orgId: 'o', propertyId: 'p' });

    localStorage.setItem(TENANT_STORAGE_KEY, '{not json');
    expect(readSavedTenant()).toBeNull();
    localStorage.setItem(TENANT_STORAGE_KEY, JSON.stringify({ orgId: 1 }));
    expect(readSavedTenant()).toBeNull();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSavedTenant()).toBeNull();
    expect(() => saveTenant({ orgId: 'o', propertyId: 'p' })).not.toThrow();
  });
});
