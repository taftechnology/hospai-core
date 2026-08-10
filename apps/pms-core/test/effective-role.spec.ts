import { describe, expect, it } from 'vitest';
import { provisionedOrg } from './fixtures.js';

describe('OrgDO getEffectiveRole (property_member independent grant)', () => {
  it('property-only member: override grants effective role when no org member row', async () => {
    const orgId = `org_eff_${crypto.randomUUID()}`;
    const propertyId = `prop_eff_${crypto.randomUUID()}`;
    const targetId = 'user_property_only';
    const org = await provisionedOrg(orgId);

    await org.upsertPropertyMember(targetId, propertyId, 'staff');
    expect(await org.getMemberRole(targetId)).toBeNull();
    expect(await org.getEffectiveRole(targetId, propertyId)).toBe('staff');
  });

  it('org scope (propertyId null) ignores property_member override', async () => {
    const orgId = `org_eff_${crypto.randomUUID()}`;
    const propertyId = `prop_eff_${crypto.randomUUID()}`;
    const targetId = 'user_override_only';
    const org = await provisionedOrg(orgId);

    await org.upsertPropertyMember(targetId, propertyId, 'admin');
    expect(await org.getEffectiveRole(targetId, null)).toBeNull();
  });

  it('org member + override: override wins; without override org role', async () => {
    const orgId = `org_eff_${crypto.randomUUID()}`;
    const propertyId = `prop_eff_${crypto.randomUUID()}`;
    const targetId = 'user_org_staff';
    const org = await provisionedOrg(orgId);

    await org.ensureMember(targetId, 'staff');
    expect(await org.getEffectiveRole(targetId, propertyId)).toBe('staff');
    await org.upsertPropertyMember(targetId, propertyId, 'admin');
    expect(await org.getEffectiveRole(targetId, propertyId)).toBe('admin');
  });
});
