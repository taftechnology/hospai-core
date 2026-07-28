import { env } from 'cloudflare:test';
import { describe, expect, it, beforeEach } from 'vitest';
import { ENTITLEMENT_REQUIRED } from '@hospai/contracts';
import { loadSnapshot, readActiveEntitlementVersion } from '@hospai/entitlement-client';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index';
import type { OrgDO } from '../src/org-do';
import {
  cancelSubscription,
  ensureOrgRegistryRow,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  seedSubscription,
  setKillSwitch,
  tryDeleteSubscription,
} from '../src/registry';
import { idemFor, propertyStub, provisionedPropertyStub } from './guest-helpers';

const LEGACY_GUEST = { guestRef: 'legacy', piiKeyId: 'legacy' } as const;

describe('entitlements + kill-switch', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('denies PropertyDO reservation without subscription', async () => {
    const orgId = `org-unent-${crypto.randomUUID()}`;
    const propName = `prop-unent-${crypto.randomUUID()}`;
    await ensureOrgRegistryRow(env, orgId, orgId);
    const stub = propertyStub(propName, orgId);
    await stub.ensureMetaPropertyId(propName);
    await stub.ensureMetaOrgId(orgId);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 2,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect(await stub.tryAddRoomType(addInput, await idemFor('add-unent', addInput))).toEqual({
      ok: false,
      error: ENTITLEMENT_REQUIRED,
    });

    const bookInput = {
      reservationId: 'res_unent',
      roomTypeId: 'rt_king',
      ...LEGACY_GUEST,
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-02',
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-unent', bookInput))).toEqual({
      ok: false,
      error: ENTITLEMENT_REQUIRED,
    });
    expect(await stub.listOutboxPayloads()).toEqual([]);
  });

  it('denies OrgDO guest create without subscription', async () => {
    const orgId = `org-g-unent-${crypto.randomUUID()}`;
    await ensureOrgRegistryRow(env, orgId, orgId);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMetaOrgId(orgId);

    const input = { guestId: 'guest_x', profile: { displayName: 'X' } };
    expect(await org.tryCreateGuest(input, await idemFor('guest-unent', input))).toEqual({
      ok: false,
      error: ENTITLEMENT_REQUIRED,
    });
    expect(await org.listOutboxPayloads()).toEqual([]);
  });

  it('growth plan resolves higher unit limit in snapshot', async () => {
    const orgId = `org-growth-${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'growth');
    const snap = await loadSnapshot(env, orgId);
    expect(snap.features['pms.units.limit']).toBe(100);
    expect(snap.features['pms.core']).toBe(true);
  });

  it('kill-switch returns 503 on property provision HTTP', async () => {
    const orgId = `org-kill-${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'starter');
    await setKillSwitch(env, 'pms.core', true);

    const req = new Request(`https://example.com/v1/orgs/${orgId}/properties`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dev-actor': 'user_kill_test',
      },
      body: JSON.stringify({
        propertyId: `prop_kill_${crypto.randomUUID()}`,
        name: 'Kill Test',
        timeZone: 'UTC',
      }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(503);
  });

  it('PropertyDO __meta.org_id is write-once', async () => {
    const orgId = `org-meta-${crypto.randomUUID()}`;
    const propName = `prop-meta-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(propName, 'UTC', orgId);
    expect(await stub.getOrgId()).toBe(orgId);
    await stub.ensureMetaOrgId('org_other');
    expect(await stub.getOrgId()).toBe(orgId);
  });

  it('subscription rows cannot be deleted and version bumps on cancel/resubscribe', async () => {
    const orgId = `org-ver-${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'starter');
    const starterSnap = await loadSnapshot(env, orgId);
    expect(starterSnap.version).toBe(1);
    expect(starterSnap.features['pms.units.limit']).toBe(20);

    const del = await tryDeleteSubscription(env, orgId);
    expect(del.ok).toBe(false);
    expect(del.ok === false && /retained/i.test(del.error)).toBe(true);

    await cancelSubscription(env, orgId);
    expect(await readActiveEntitlementVersion(env, orgId)).toBe(0);

    await seedSubscription(env, orgId, 'growth');
    const growthSnap = await loadSnapshot(env, orgId);
    expect(growthSnap.version).toBeGreaterThan(starterSnap.version);
    expect(growthSnap.features['pms.units.limit']).toBe(100);

    const cachedStarter = await loadSnapshot(env, orgId, { version: starterSnap.version });
    expect(cachedStarter.features['pms.units.limit']).toBe(20);
    expect(cachedStarter.version).toBe(1);
  });
});
