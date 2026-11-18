import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GUEST_NOTES_LENGTH_MAX,
  GUEST_TAG_LENGTH_MAX,
  GUEST_TAGS_MAX,
  IDEM_KEY_REUSED,
  LIMIT_EXCEEDED,
  commandFingerprint,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, seedSubscription, setKillSwitch } from '../src/registry.js';
import { idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './fixtures.js';
import { createGuest } from './guest-helpers.js';

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
        name: 'CRM Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_crm_${crypto.randomUUID()}`;
  const propertyId = `prop_crm_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'CRM Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  return { orgId, propertyId, actor };
}

async function provisionTwoHotels(actor: string) {
  const orgId = `org_crm2_${crypto.randomUUID()}`;
  const propertyA = `prop_crm_a_${crypto.randomUUID()}`;
  const propertyB = `prop_crm_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Two CRM Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor)).status).toBe(201);
  await seedSubscription(env, orgId, 'group');
  expect((await postProperty(orgId, propertyB, actor)).status).toBe(201);
  expect((await postRoomType(propertyA, actor)).status).toBe(201);
  expect((await postRoomType(propertyB, actor)).status).toBe(201);
  return { orgId, propertyA, propertyB, actor };
}

type GuestBody = {
  guestId?: string;
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  vip?: boolean;
  notes?: string;
  idempotencyKey?: string;
};

async function postGuest(propertyId: string, actor: string, body: GuestBody & { guestId: string }) {
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

async function patchGuest(
  propertyId: string,
  actor: string,
  guestId: string,
  body: GuestBody,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: body.idempotencyKey ?? `idem-guest-upd-${crypto.randomUUID()}`,
        }),
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

async function getGuests(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function postGuestsSearch(propertyId: string, actor: string, q: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ q }),
    }),
    env,
  );
}

async function eraseGuest(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}/erase`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-erase-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

describe('R1.8 guest CRM depth', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: create and update round-trip tags, vip, notes; get_guest returns them', async () => {
    const actor = 'user_crm_1';
    const { propertyId } = await provisionHotel(actor);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_crm_1',
          displayName: 'CRM Guest',
          tags: ['Feather allergy'],
          vip: true,
          notes: 'Prefers high floor',
        })
      ).status,
    ).toBe(200);

    let getBody = (await (await getGuest(propertyId, actor, 'guest_crm_1')).json()) as {
      profile: Record<string, unknown>;
    };
    expect(getBody.profile).toMatchObject({
      displayName: 'CRM Guest',
      tags: ['Feather allergy'],
      vip: true,
      notes: 'Prefers high floor',
    });

    expect(
      (
        await patchGuest(propertyId, actor, 'guest_crm_1', {
          displayName: 'CRM Guest',
          tags: ['Updated tag'],
          notes: 'New note',
        })
      ).status,
    ).toBe(200);

    getBody = (await (await getGuest(propertyId, actor, 'guest_crm_1')).json()) as {
      profile: Record<string, unknown>;
    };
    expect(getBody.profile).toMatchObject({
      displayName: 'CRM Guest',
      tags: ['Updated tag'],
      notes: 'New note',
    });
    expect(getBody.profile).not.toHaveProperty('vip');
  });

  it('2: normalisation stores collapsed tags; vip false and blank notes absent', async () => {
    const actor = 'user_crm_2';
    const { propertyId, orgId } = await provisionHotel(actor);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await postGuest(propertyId, actor, {
      guestId: 'guest_norm',
      displayName: 'Norm',
      tags: [' High floor ', 'high  FLOOR', ''],
      vip: false,
      notes: '  ',
    });
    expect(await org.readGuestProfile('guest_norm')).toEqual({
      displayName: 'Norm',
      tags: ['High floor'],
    });
  });

  it('3: full replace — update without tags clears tags', async () => {
    const actor = 'user_crm_3';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_replace',
      displayName: 'Replace',
      tags: ['Keep briefly'],
    });
    expect(
      (await patchGuest(propertyId, actor, 'guest_replace', { displayName: 'Replace' })).status,
    ).toBe(200);
    const getBody = (await (await getGuest(propertyId, actor, 'guest_replace')).json()) as {
      profile: Record<string, unknown>;
    };
    expect(getBody.profile).toEqual({ displayName: 'Replace' });
  });

  it('4: HTTP caps and invalid types', async () => {
    const actor = 'user_crm_4';
    const { propertyId } = await provisionHotel(actor);

    const tooManyTags = Array.from({ length: GUEST_TAGS_MAX + 1 }, (_, i) => `tag${i}`);
    let res = await postGuest(propertyId, actor, {
      guestId: 'guest_cap_tags',
      displayName: 'Cap',
      tags: tooManyTags,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    res = await postGuest(propertyId, actor, {
      guestId: 'guest_cap_tag_len',
      displayName: 'Cap',
      tags: ['x'.repeat(GUEST_TAG_LENGTH_MAX + 1)],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    res = await postGuest(propertyId, actor, {
      guestId: 'guest_cap_notes',
      displayName: 'Cap',
      notes: 'n'.repeat(GUEST_NOTES_LENGTH_MAX + 1),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          guestId: 'guest_bad_types',
          displayName: 'Bad',
          tags: 'not-array',
          idempotencyKey: 'idem-bad',
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('5: RPC cap on tryUpdateGuest leaves stored profile unchanged', async () => {
    const org = await provisionedOrg(`org-rpc-cap-${crypto.randomUUID()}`);
    const propertyId = 'prop_rpc_cap';
    await createGuest(org, propertyId, 'guest_rpc_cap', 'Before');
    const withTag = { guestId: 'guest_rpc_cap', profile: { displayName: 'Before', tags: ['saved'] } };
    await org.tryUpdateGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      withTag,
      await idemFor('rpc-cap-seed', withTag),
    );
    const tooMany = {
      guestId: 'guest_rpc_cap',
      profile: {
        displayName: 'Before',
        tags: Array.from({ length: GUEST_TAGS_MAX + 1 }, (_, i) => `t${i}`),
      },
    };
    expect(
      await org.tryUpdateGuest(TEST_OWNER_ACTOR, propertyId, tooMany, await idemFor('rpc-cap', tooMany)),
    ).toEqual({ ok: false, error: LIMIT_EXCEEDED });
    expect(await org.readGuestProfile('guest_rpc_cap')).toEqual({
      displayName: 'Before',
      tags: ['saved'],
    });
  });

  it('6: idempotency — differing tags reuse key; same normalised profile replays', async () => {
    const actor = 'user_crm_6';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_idem', displayName: 'Idem' });

    const key = 'shared-idem-key';
    const resA = await patchGuest(propertyId, actor, 'guest_idem', {
      displayName: 'Idem',
      tags: ['A'],
      idempotencyKey: key,
    });
    expect(resA.status).toBe(200);

    const resB = await patchGuest(propertyId, actor, 'guest_idem', {
      displayName: 'Idem',
      tags: ['B'],
      idempotencyKey: key,
    });
    expect(resB.status).toBe(409);
    expect(await resB.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });

    const replayKey = 'shared-idem-replay-key';
    const resFirst = await patchGuest(propertyId, actor, 'guest_idem', {
      displayName: 'Idem',
      tags: [' High floor ', 'high  FLOOR', ''],
      idempotencyKey: replayKey,
    });
    expect(resFirst.status).toBe(200);
    const resSecond = await patchGuest(propertyId, actor, 'guest_idem', {
      displayName: 'Idem',
      tags: ['High floor'],
      idempotencyKey: replayKey,
    });
    expect(resSecond.status).toBe(200);
    const afterReplay = (await (await getGuest(propertyId, actor, 'guest_idem')).json()) as {
      profile: { tags: string[] };
    };
    expect(afterReplay.profile.tags).toEqual(['High floor']);

    const org = await provisionedOrg(`org-idem-replay-${crypto.randomUUID()}`);
    const propId = 'prop_idem_replay';
    await createGuest(org, propId, 'guest_replay', 'Idem');
    const fp = await commandFingerprint('guests.update', {
      guestId: 'guest_replay',
      displayName: 'Idem',
      tags: ['High floor'],
    });
    const idem = { key: 'replay-key', fingerprint: fp };
    const first = await org.tryUpdateGuest(
      TEST_OWNER_ACTOR,
      propId,
      { guestId: 'guest_replay', profile: { displayName: 'Idem', tags: [' High floor ', 'high  FLOOR'] } },
      idem,
    );
    const second = await org.tryUpdateGuest(
      TEST_OWNER_ACTOR,
      propId,
      { guestId: 'guest_replay', profile: { displayName: 'Idem', tags: ['high  FLOOR', ' High floor '] } },
      idem,
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
  });

  it('7: list and search omit notes but keep tags and vip', async () => {
    const actor = 'user_crm_7';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_list',
      displayName: 'List Guest',
      tags: ['Quiet'],
      vip: true,
      notes: 'Secret note',
    });

    const listBody = (await (await getGuests(propertyId, actor)).json()) as {
      items: Array<{ profile: Record<string, unknown> }>;
    };
    expect(listBody.items[0]!.profile).toMatchObject({
      displayName: 'List Guest',
      tags: ['Quiet'],
      vip: true,
    });
    expect(listBody.items[0]!.profile).not.toHaveProperty('notes');

    const searchBody = (await (await postGuestsSearch(propertyId, actor, 'List')).json()) as {
      items: Array<{ profile: Record<string, unknown> }>;
    };
    expect(searchBody.items[0]!.profile).not.toHaveProperty('notes');
    expect(searchBody.items[0]!.profile.tags).toEqual(['Quiet']);
  });

  it('8: after erase get_guest returns profile null', async () => {
    const actor = 'user_crm_8';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_erase_crm',
      displayName: 'Erase',
      tags: ['X'],
      notes: 'Y',
    });
    await eraseGuest(propertyId, actor, 'guest_erase_crm');
    expect(await (await getGuest(propertyId, actor, 'guest_erase_crm')).json()).toMatchObject({
      erased: true,
      profile: null,
    });
  });

  it('9: two properties — tag visible at B only when guest linked at B', async () => {
    const actor = 'user_crm_9';
    const { orgId, propertyA, propertyB } = await provisionTwoHotels(actor);
    await postGuest(propertyA, actor, {
      guestId: 'guest_two_prop',
      displayName: 'Shared',
      tags: ['Prop A tag'],
      vip: true,
      notes: 'Only on the profile',
    });

    expect(
      ((await (await getGuests(propertyB, actor)).json()) as { items: unknown[] }).items,
    ).toEqual([]);
    expect((await getGuest(propertyB, actor, 'guest_two_prop')).status).toBe(404);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect(
      await org.upsertGuestPropertyAssociation(
        { kind: 'user', userId: actor },
        propertyB,
        'guest_two_prop',
      ),
    ).toEqual({ ok: true });

    const linked = await getGuest(propertyB, actor, 'guest_two_prop');
    expect(linked.status).toBe(200);
    expect(((await linked.json()) as { profile: Record<string, unknown> }).profile).toMatchObject({
      tags: ['Prop A tag'],
      vip: true,
      notes: 'Only on the profile',
    });

    const dirB = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string; profile: Record<string, unknown> }>;
    };
    expect(dirB.items).toHaveLength(1);
    expect(dirB.items[0]!.guestId).toBe('guest_two_prop');
    expect(dirB.items[0]!.profile.tags).toEqual(['Prop A tag']);
    expect(dirB.items[0]!.profile.vip).toBe(true);
    expect(dirB.items[0]!.profile).not.toHaveProperty('notes');
  });

  it('10: guest.created and guest.updated outbox omit CRM fields', async () => {
    const actor = 'user_crm_10';
    const { orgId, propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_outbox',
      displayName: 'Outbox',
      tags: ['T'],
      vip: true,
      notes: 'N',
    });
    await patchGuest(propertyId, actor, 'guest_outbox', {
      displayName: 'Outbox',
      tags: ['T2'],
    });
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    for (const row of await org.listOutboxPayloads()) {
      if (row.eventType !== 'guest.created' && row.eventType !== 'guest.updated') continue;
      expect(row.payload).not.toMatch(/tags|vip|notes|"T"/);
    }
  });
});
