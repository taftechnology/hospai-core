import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

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

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Crypto Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postGuest(
  propertyId: string,
  actor: string,
  body: { guestId: string; displayName: string; email?: string; phone?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-guest-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function eraseGuest(propertyId: string, actor: string, guestId: string, idempotencyKey?: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}/erase`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: idempotencyKey ?? `idem-guest-erase-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function getGuest(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function provisionTwoOrgsSamePlatformKey(actor: string) {
  const orgA = `org_crypto_a_${crypto.randomUUID()}`;
  const orgB = `org_crypto_b_${crypto.randomUUID()}`;
  const propertyA = `prop_crypto_a_${crypto.randomUUID()}`;
  const propertyB = `prop_crypto_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgA, 'Crypto Org A', actor)).status).toBe(201);
  expect((await postOrg(orgB, 'Crypto Org B', actor)).status).toBe(201);
  expect((await postProperty(orgA, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgB, propertyB, actor)).status).toBe(201);
  return { orgA, orgB, propertyA, propertyB, actor };
}

describe('per-org crypto isolation (N6)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('T6: two orgs, same profile → different cipher and blind hash', async () => {
    const actor = 'user_crypto_t6';
    const profile = { guestId: 'guest_same', displayName: 'Same Person', email: 'same@example.com' };
    const { orgA, orgB, propertyA, propertyB } = await provisionTwoOrgsSamePlatformKey(actor);

    await postGuest(propertyA, actor, profile);
    await postGuest(propertyB, actor, { ...profile, guestId: 'guest_same_b' });

    const orgStubA = resolveOrgStub(env.ORG_DO, { orgId: orgA }) as DurableObjectStub<OrgDO>;
    const orgStubB = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;

    const matA = await orgStubA.readGuestCryptoMaterialForTest('guest_same');
    const matB = await orgStubB.readGuestCryptoMaterialForTest('guest_same_b');
    expect(matA).not.toBeNull();
    expect(matB).not.toBeNull();
    expect(hexOf(matA!.profileCipher)).not.toBe(hexOf(matB!.profileCipher));

    const hashA = await orgStubA.readGuestBlindIndexHashForTest('guest_same', 'email');
    const hashB = await orgStubB.readGuestBlindIndexHashForTest('guest_same_b', 'email');
    expect(hashA).not.toBeNull();
    expect(hashB).not.toBeNull();
    expect(hexOf(hashA!)).not.toBe(hexOf(hashB!));
  });

  it('T7: shred org A guest; org B guest still decrypts', async () => {
    const actor = 'user_crypto_t7';
    const profile = { displayName: 'Shred Isolation', email: 'shred@example.com' };
    const { orgA, orgB, propertyA, propertyB } = await provisionTwoOrgsSamePlatformKey(actor);

    await postGuest(propertyA, actor, { guestId: 'guest_a', ...profile });
    await postGuest(propertyB, actor, { guestId: 'guest_b', ...profile });

    expect((await eraseGuest(propertyA, actor, 'guest_a')).status).toBe(200);

    const tombA = await getGuest(propertyA, actor, 'guest_a');
    expect(tombA.status).toBe(200);
    expect(await tombA.json()).toMatchObject({ guestId: 'guest_a', erased: true, profile: null });

    const liveB = await getGuest(propertyB, actor, 'guest_b');
    expect(liveB.status).toBe(200);
    expect(await liveB.json()).toMatchObject({
      ok: true,
      guestId: 'guest_b',
      profile: { displayName: 'Shred Isolation', email: 'shred@example.com' },
    });
  });
});
