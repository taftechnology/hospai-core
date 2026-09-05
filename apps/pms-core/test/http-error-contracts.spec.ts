import { env } from 'cloudflare:test';
import {
  DECRYPT_UNRESOLVED,
  ENTITLEMENT_REQUIRED,
  INTERNAL_ERROR,
  NOT_MEMBER,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, provisionedOrg, TEST_OWNER_ACTOR } from './guest-helpers.js';

// T11/T12 — lands in Task 2; import fails until command-error-http.ts exists
import { commandErrorHttpStatus } from '../src/command-error-http.js';

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'HTTP Error Org' }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'HTTP Error Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHttpHotel(actor: string) {
  const orgId = `org_hec_${crypto.randomUUID()}`;
  const propertyId = `prop_hec_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(orgId);
  return { orgId, propertyId, org };
}

async function getGuestHttp(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      { method: 'GET', headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function postGuestsBatch(propertyId: string, actor: string, refs: string[]) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ refs }),
    }),
    env,
  );
}

describe('HTTP error contracts (R0.10)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // T7 — GET decrypt miss (today 500 via readGuest throw + catch)
  it('T7: shredded key GET guest → 422 decrypt_unresolved not 500', async () => {
    const actor = 'user_hec_get_decrypt';
    const { propertyId, org } = await provisionHttpHotel(actor);
    const guestId = 'guest_hec_decrypt';
    const refs = await createGuest(org, propertyId, guestId, 'Live Guest', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const res = await getGuestHttp(propertyId, actor, guestId);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: DECRYPT_UNRESOLVED });
  });

  // T8 — batch unchanged
  it('T8: same guest batch → 200 per-row decrypt_unresolved', async () => {
    const actor = 'user_hec_batch_decrypt';
    const { propertyId, org } = await provisionHttpHotel(actor);
    const guestId = 'guest_hec_batch';
    const refs = await createGuest(org, propertyId, guestId, 'Live Guest', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const res = await postGuestsBatch(propertyId, actor, [guestId]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      guests: Record<string, { ok: boolean; guestId: string; error?: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.guests[guestId]).toEqual({
      ok: false,
      guestId,
      error: DECRYPT_UNRESOLVED,
    });
  });

  // T9 — DO direct readGuest Result, no throw
  it('T9: OrgDO readGuest returns decrypt_unresolved Result without throw', async () => {
    const org = await provisionedOrg(`org_hec_do_${crypto.randomUUID()}`);
    const propertyId = 'prop_hec_do';
    const guestId = 'guest_hec_do';
    const refs = await createGuest(org, propertyId, guestId, 'Live', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const result = await org.readGuest(TEST_OWNER_ACTOR, propertyId, guestId);
    expect(result).toEqual({ ok: false, guestId, error: DECRYPT_UNRESOLVED });
  });

  // T10 — membership storage fault (today forbidden)
  it('T10: setOrgMember after member table drop → internal_error not forbidden', async () => {
    const org = await provisionedOrg(`org_hec_mem_${crypto.randomUUID()}`);
    await org.execSqlForTest(`DROP TABLE member`);
    const r = await org.setOrgMember(TEST_OWNER_ACTOR, {
      targetUserId: 'user_new_member',
      role: 'staff',
      mode: 'create',
    });
    expect(r).toEqual({ ok: false, error: INTERNAL_ERROR });
  });

  // T11 — table unit
  it('T11: commandErrorHttpStatus(entitlement_required) === 402', () => {
    expect(commandErrorHttpStatus(ENTITLEMENT_REQUIRED)).toBe(402);
  });

  // T12 — table unit
  it('T12: commandErrorHttpStatus(not_member) === 404', () => {
    expect(commandErrorHttpStatus(NOT_MEMBER)).toBe(404);
  });
});
