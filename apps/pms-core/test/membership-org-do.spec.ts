import { describe, expect, it } from 'vitest';
import type { ActorContext } from '@hospai/contracts';
import { provisionedOrg, TEST_OWNER_ACTOR } from './fixtures.js';

const owner: ActorContext = TEST_OWNER_ACTOR;
const adminActor = (userId = 'user_admin'): ActorContext => ({ kind: 'user', userId });
const staffActor = (userId = 'user_staff'): ActorContext => ({ kind: 'user', userId });

describe('OrgDO membership RPCs', () => {
  describe('#3 DO peer-owner symmetry + last-owner + self-raise', () => {
    it('owner grants peer owner', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      const r = await org.setOrgMember(owner, {
        targetUserId: 'user_owner_2',
        role: 'owner',
        mode: 'create',
      });
      expect(r).toEqual({ ok: true, userId: 'user_owner_2', role: 'owner' });
      expect(await org.getMemberRole('user_owner_2')).toBe('owner');
    });

    it('owner demotes peer owner', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.setOrgMember(owner, {
        targetUserId: 'user_owner_2',
        role: 'owner',
        mode: 'create',
      });
      const r = await org.setOrgMember(owner, {
        targetUserId: 'user_owner_2',
        role: 'admin',
        mode: 'update',
      });
      expect(r).toMatchObject({ ok: true, userId: 'user_owner_2', role: 'admin', previousRole: 'owner' });
      expect(await org.getMemberRole('user_owner_2')).toBe('admin');
    });

    it('owner removes peer owner', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.setOrgMember(owner, {
        targetUserId: 'user_owner_2',
        role: 'owner',
        mode: 'create',
      });
      const r = await org.removeOrgMember(owner, 'user_owner_2');
      expect(r).toEqual({ ok: true, userId: 'user_owner_2' });
      expect(await org.getMemberRole('user_owner_2')).toBeNull();
    });

    it('self-raise → role_escalation', async () => {
      // After peer demotes the bootstrap owner to admin, that admin still lacks org:manage.
      // Self-raise canary: second owner demotes first; first (now admin) cannot regain owner
      // through setOrgMember — forbidden. Property path: admin cannot set own override to admin.
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propertyId = `prop_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.ensureMember('user_admin', 'admin');
      // Admin holds staff:write; setting own property role to admin is not strictly-below → escalation
      const raise = await org.setPropertyMember(adminActor(), propertyId, {
        targetUserId: 'user_admin',
        role: 'admin',
        mode: 'create',
      });
      expect(raise).toEqual({ ok: false, error: 'role_escalation' });
    });

    it('last owner cannot remove self; second owner then self-remove OK', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      const last = await org.removeOrgMember(owner, 'user_owner');
      expect(last).toEqual({ ok: false, error: 'last_owner' });

      await org.setOrgMember(owner, {
        targetUserId: 'user_owner_2',
        role: 'owner',
        mode: 'create',
      });
      const ok = await org.removeOrgMember(owner, 'user_owner');
      expect(ok).toEqual({ ok: true, userId: 'user_owner' });
    });

    it('last owner cannot demote self to admin', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      const r = await org.setOrgMember(owner, {
        targetUserId: 'user_owner',
        role: 'admin',
        mode: 'update',
      });
      expect(r).toEqual({ ok: false, error: 'last_owner' });
    });
  });

  describe('#5 DO cascade + 1+N outbox', () => {
    it('org DELETE removes property_member; re-add does not restore; outbox 1+N', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propA = `prop_a_${crypto.randomUUID()}`;
      const propB = `prop_b_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);

      await org.setOrgMember(owner, {
        targetUserId: 'user_target',
        role: 'staff',
        mode: 'create',
      });
      await org.setPropertyMember(owner, propA, {
        targetUserId: 'user_target',
        role: 'admin',
        mode: 'create',
      });
      await org.setPropertyMember(owner, propB, {
        targetUserId: 'user_target',
        role: 'staff',
        mode: 'create',
      });

      await org.flushOutbox(); // clear prior events from creates

      const removed = await org.removeOrgMember(owner, 'user_target');
      expect(removed).toEqual({ ok: true, userId: 'user_target' });
      expect(await org.getEffectiveRole('user_target', propA)).toBeNull();
      expect(await org.getEffectiveRole('user_target', propB)).toBeNull();

      const payloads = await org.listOutboxPayloads();
      const staffChanged = payloads.filter((p) => p.eventType === 'staff.changed');
      expect(staffChanged).toHaveLength(3); // 1 org + 2 property
      const parsed = staffChanged.map((p) => JSON.parse(p.payload) as {
        propertyId: string | null;
        action: string;
        targetUserId: string;
      });
      expect(parsed.filter((p) => p.propertyId === null)).toHaveLength(1);
      expect(parsed.filter((p) => p.propertyId === propA)).toHaveLength(1);
      expect(parsed.filter((p) => p.propertyId === propB)).toHaveLength(1);
      expect(parsed.every((p) => p.action === 'removed' && p.targetUserId === 'user_target')).toBe(true);

      await org.setOrgMember(owner, {
        targetUserId: 'user_target',
        role: 'staff',
        mode: 'create',
      });
      expect(await org.getEffectiveRole('user_target', propA)).toBe('staff'); // org role only, no override
      expect(await org.getEffectiveRole('user_target', propB)).toBe('staff');
    });

    it('org demote does not cascade property_member', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propA = `prop_a_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.setOrgMember(owner, {
        targetUserId: 'user_target',
        role: 'admin',
        mode: 'create',
      });
      await org.setPropertyMember(owner, propA, {
        targetUserId: 'user_target',
        role: 'staff',
        mode: 'create',
      });
      await org.setOrgMember(owner, {
        targetUserId: 'user_target',
        role: 'staff',
        mode: 'update',
      });
      expect(await org.getEffectiveRole('user_target', propA)).toBe('staff'); // override still present
    });
  });

  describe('property DO rank + never owner', () => {
    it('admin can create staff property-only member', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propertyId = `prop_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.ensureMember('user_admin', 'admin');

      const r = await org.setPropertyMember(adminActor(), propertyId, {
        targetUserId: 'user_prop_only',
        role: 'staff',
        mode: 'create',
      });
      expect(r).toEqual({ ok: true, userId: 'user_prop_only', role: 'staff' });
      expect(await org.getMemberRole('user_prop_only')).toBeNull();
      expect(await org.getEffectiveRole('user_prop_only', propertyId)).toBe('staff');
    });

    it('admin cannot create admin or owner on property', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propertyId = `prop_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.ensureMember('user_admin', 'admin');

      const adminGrant = await org.setPropertyMember(adminActor(), propertyId, {
        targetUserId: 'user_x',
        role: 'admin',
        mode: 'create',
      });
      expect(adminGrant).toEqual({ ok: false, error: 'role_escalation' });

      const ownerGrant = await org.setPropertyMember(adminActor(), propertyId, {
        targetUserId: 'user_y',
        role: 'owner',
        mode: 'create',
      });
      expect(ownerGrant).toEqual({ ok: false, error: 'invalid_role' });
    });

    it('#2b owner cannot set property owner', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propertyId = `prop_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      const r = await org.setPropertyMember(owner, propertyId, {
        targetUserId: 'user_z',
        role: 'owner',
        mode: 'create',
      });
      expect(r).toEqual({ ok: false, error: 'invalid_role' });
    });
  });

  describe('#12 ensureMember DO NOTHING on conflict', () => {
    it('does not change existing role', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.ensureMember('user_owner', 'staff');
      expect(await org.getMemberRole('user_owner')).toBe('owner');
    });
  });

  describe('DO gates + create/update semantics', () => {
    it('direct-DO not_member when actor lacks membership', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      const r = await org.listOrgMembers(staffActor('user_nobody'));
      expect(r).toEqual({ ok: false, error: 'not_member' });
    });

    it('create → already_member; update → not_member when absent', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      await org.setOrgMember(owner, {
        targetUserId: 'user_a',
        role: 'staff',
        mode: 'create',
      });
      const dup = await org.setOrgMember(owner, {
        targetUserId: 'user_a',
        role: 'admin',
        mode: 'create',
      });
      expect(dup).toEqual({ ok: false, error: 'already_member', role: 'staff' });

      const missing = await org.setOrgMember(owner, {
        targetUserId: 'user_missing',
        role: 'staff',
        mode: 'update',
      });
      expect(missing).toEqual({ ok: false, error: 'not_member' });
    });

    it('property create → already_member includes role; hasOrgRole true/false', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const propertyId = `prop_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);

      await org.setPropertyMember(owner, propertyId, {
        targetUserId: 'user_prop_only',
        role: 'staff',
        mode: 'create',
      });
      const dup = await org.setPropertyMember(owner, propertyId, {
        targetUserId: 'user_prop_only',
        role: 'admin',
        mode: 'create',
      });
      expect(dup).toEqual({ ok: false, error: 'already_member', role: 'staff' });

      await org.setOrgMember(owner, {
        targetUserId: 'user_org_staff',
        role: 'staff',
        mode: 'create',
      });
      await org.setPropertyMember(owner, propertyId, {
        targetUserId: 'user_org_staff',
        role: 'admin',
        mode: 'create',
      });

      const listed = await org.listPropertyMembers(owner, propertyId);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.members.find((m) => m.userId === 'user_prop_only')).toMatchObject({
        hasOrgRole: false,
      });
      expect(listed.members.find((m) => m.userId === 'user_org_staff')).toMatchObject({
        hasOrgRole: true,
      });
    });

    it('admin cannot grant org admin (rank-below)', async () => {
      const orgId = `org_mem_${crypto.randomUUID()}`;
      const org = await provisionedOrg(orgId);
      // admin has no org:manage — forbidden
      await org.ensureMember('user_admin', 'admin');
      const r = await org.setOrgMember(adminActor(), {
        targetUserId: 'user_x',
        role: 'staff',
        mode: 'create',
      });
      expect(r).toEqual({ ok: false, error: 'forbidden' });
    });
  });
});
