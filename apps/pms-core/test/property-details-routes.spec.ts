import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDEM_KEY_REUSED } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  getProperty,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string, name = 'Details Hotel') {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name,
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_details_${crypto.randomUUID()}`;
  const propertyId = `prop_details_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Details Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  return { orgId, propertyId, actor };
}

async function patchPropertyDetails(
  propertyId: string,
  actor: string,
  body: { name: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('property details HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: PATCH name updates D1 + OrgDO mirror and emits property.updated from org', async () => {
    const owner = 'user_details_owner_1';
    const { orgId, propertyId } = await provisionHotel(owner);
    const res = await patchPropertyDetails(propertyId, owner, {
      name: 'Renamed Hotel',
      idempotencyKey: 'idem-details-1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; propertyId: string; name: string };
    expect(body).toMatchObject({ propertyId, name: 'Renamed Hotel' });

    const d1 = await getProperty(env, propertyId);
    expect(d1?.name).toBe('Renamed Hotel');

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const refs = await org.listPropertyRefs();
    expect(refs.find((r) => r.propertyId === propertyId)?.name).toBe('Renamed Hotel');

    const payloads = await org.listOutboxPayloads();
    const updated = payloads.find((p) => p.eventType === 'property.updated');
    expect(updated).toBeDefined();
    const payload = JSON.parse(updated!.payload) as { orgId: string; propertyId: string; name: string };
    expect(payload).toMatchObject({ orgId, propertyId, name: 'Renamed Hotel' });
  });

  it('2: replay same idempotency key is safe', async () => {
    const owner = 'user_details_owner_2';
    const { orgId, propertyId } = await provisionHotel(owner);
    const req = { name: 'Replay Name', idempotencyKey: 'idem-details-replay' };
    expect((await patchPropertyDetails(propertyId, owner, req)).status).toBe(200);
    expect((await patchPropertyDetails(propertyId, owner, req)).status).toBe(200);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const events = (await org.listOutboxPayloads()).filter((p) => p.eventType === 'property.updated');
    expect(events.length).toBe(1);
  });

  it('3: fingerprint conflict returns idempotency_key_reused', async () => {
    const owner = 'user_details_owner_3';
    const { orgId, propertyId } = await provisionHotel(owner);
    const key = 'idem-details-conflict';
    expect(
      (await patchPropertyDetails(propertyId, owner, { name: 'First', idempotencyKey: key })).status,
    ).toBe(200);
    const conflict = await patchPropertyDetails(propertyId, owner, { name: 'Second', idempotencyKey: key });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    // D1 write precedes OrgDO idempotency — conflicting replay updates D1 but not the mirror.
    expect((await getProperty(env, propertyId))?.name).toBe('Second');
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect((await org.listPropertyRefs()).find((r) => r.propertyId === propertyId)?.name).toBe('First');
  });

  it('4: staff cannot PATCH property details', async () => {
    const owner = 'user_details_owner_4';
    const staff = 'user_details_staff_4';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const res = await patchPropertyDetails(propertyId, staff, {
      name: 'Staff Rename',
      idempotencyKey: 'idem-details-staff',
    });
    expect(res.status).toBe(403);
  });

  it('5: non-member receives 404', async () => {
    const owner = 'user_details_owner_5';
    const outsider = 'user_details_outsider_5';
    const { propertyId } = await provisionHotel(owner);

    const res = await patchPropertyDetails(propertyId, outsider, {
      name: 'Outsider Rename',
      idempotencyKey: 'idem-details-outsider',
    });
    expect(res.status).toBe(404);
  });

  it('6: unentitled org can still rename (opt-out / unkillable)', async () => {
    const owner = 'user_details_owner_6';
    const { orgId, propertyId } = await provisionHotel(owner);
    await cancelSubscription(env, orgId);
    await setKillSwitch(env, 'pms.core', true);

    const res = await patchPropertyDetails(propertyId, owner, {
      name: 'Unentitled Rename',
      idempotencyKey: 'idem-details-unentitled',
    });
    expect(res.status).toBe(200);
    expect((await getProperty(env, propertyId))?.name).toBe('Unentitled Rename');
  });

  it('7: OrgDO transport blocked after D1 — error; D1 ahead; retry converges', async () => {
    const owner = 'user_details_owner_7';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);

    const req = { name: 'After Fault', idempotencyKey: 'idem-details-fault' };
    const res = await patchPropertyDetails(propertyId, owner, req);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'org_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'property.update_details',
    });

    expect((await getProperty(env, propertyId))?.name).toBe('After Fault');
    // Unblock before probing the mirror — listPropertyRefs now honors transport block
    // (needed for get_org_properties FAIL_CLOSED). Staleness is from the failed write.
    await org.setTransportBlockedForTest(false);
    const refsBefore = await org.listPropertyRefs();
    expect(refsBefore.find((r) => r.propertyId === propertyId)?.name).not.toBe('After Fault');

    expect((await patchPropertyDetails(propertyId, owner, req)).status).toBe(200);
    expect((await org.listPropertyRefs()).find((r) => r.propertyId === propertyId)?.name).toBe(
      'After Fault',
    );
  });
});
