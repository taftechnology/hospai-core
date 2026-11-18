import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GUEST_SETTINGS,
  GUEST_DUPLICATE,
  GUEST_EMAIL_REQUIRED,
  GUEST_PHONE_REQUIRED,
  GUEST_SETTINGS_KEY,
  IDEM_KEY_REUSED,
  VALIDATION_ERROR,
  type GuestSettings,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

const OFF: GuestSettings = { ...DEFAULT_GUEST_SETTINGS };

function withSettings(patch: Partial<GuestSettings>): GuestSettings {
  return { ...OFF, ...patch };
}

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

async function postProperty(orgId: string, propertyId: string, actor: string, name: string) {
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

async function provisionHotel(actor: string, name = 'Guests Hotel') {
  const orgId = `org_gs_${crypto.randomUUID()}`;
  const propertyId = `prop_gs_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, name, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor, name)).status).toBe(201);
  return { orgId, propertyId, actor };
}

async function getSettings(orgId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/guest-settings`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function putSettings(
  orgId: string,
  actor: string,
  body: { value: unknown; reason: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/guest-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function postGuest(
  propertyId: string,
  actor: string,
  body: {
    guestId: string;
    displayName: string;
    email?: string;
    phone?: string;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function patchGuest(
  propertyId: string,
  actor: string,
  guestId: string,
  body: { displayName: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
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
        body: JSON.stringify({ idempotencyKey: `idem-erase-${guestId}-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function listOperational(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/operational-config`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

function orgStub(orgId: string) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

describe('guest settings', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('defaults: no row is all false, and a create without email or phone succeeds', async () => {
    const actor = 'user_gs_defaults';
    const { orgId, propertyId } = await provisionHotel(actor);
    const read = await getSettings(orgId, actor);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ ok: true, value: OFF, version: 0 });

    // The client keys a save on this version, so the GET must move with every write.
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ requireEmail: true }),
          reason: 'Email on',
          idempotencyKey: 'idem-gs-defaults-v1',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await putSettings(orgId, actor, {
          value: OFF,
          reason: 'Email off',
          idempotencyKey: 'idem-gs-defaults-v2',
        })
      ).status,
    ).toBe(200);
    expect(await (await getSettings(orgId, actor)).json()).toEqual({ ok: true, value: OFF, version: 2 });

    const created = await postGuest(propertyId, actor, {
      guestId: 'guest_plain',
      displayName: 'Plain Guest',
      idempotencyKey: 'idem-gs-plain',
    });
    // guests.create success stays 200 (existing route contract).
    expect(created.status).toBe(200);

    const listed = await listOperational(propertyId, actor);
    expect(listed.status).toBe(200);
    const items = ((await listed.json()) as { items: Array<{ key: string }> }).items;
    expect(items.map((item) => item.key)).not.toContain(GUEST_SETTINGS_KEY);
  });

  it('requireEmail and requirePhone refuse a blank contact and accept one', async () => {
    const actor = 'user_gs_required';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ requireEmail: true, requirePhone: true }),
          reason: 'Require both',
          idempotencyKey: 'idem-gs-require',
        })
      ).status,
    ).toBe(200);

    const noEmail = await postGuest(propertyId, actor, {
      guestId: 'guest_no_email',
      displayName: 'No Email',
      phone: '14155550100',
      idempotencyKey: 'idem-gs-no-email',
    });
    expect(noEmail.status).toBe(422);
    expect(await noEmail.json()).toEqual({ ok: false, error: GUEST_EMAIL_REQUIRED });

    const blankEmail = await postGuest(propertyId, actor, {
      guestId: 'guest_blank_email',
      displayName: 'Blank Email',
      email: '   ',
      phone: '14155550100',
      idempotencyKey: 'idem-gs-blank-email',
    });
    expect(blankEmail.status).toBe(422);
    expect(await blankEmail.json()).toEqual({ ok: false, error: GUEST_EMAIL_REQUIRED });

    const noPhone = await postGuest(propertyId, actor, {
      guestId: 'guest_no_phone',
      displayName: 'No Phone',
      email: 'ada@ex.com',
      idempotencyKey: 'idem-gs-no-phone',
    });
    expect(noPhone.status).toBe(422);
    expect(await noPhone.json()).toEqual({ ok: false, error: GUEST_PHONE_REQUIRED });

    const blankPhone = await postGuest(propertyId, actor, {
      guestId: 'guest_blank_phone',
      displayName: 'Blank Phone',
      email: 'ada@ex.com',
      phone: 'abc',
      idempotencyKey: 'idem-gs-blank-phone',
    });
    expect(blankPhone.status).toBe(422);
    expect(await blankPhone.json()).toEqual({ ok: false, error: GUEST_PHONE_REQUIRED });

    const ok = await postGuest(propertyId, actor, {
      guestId: 'guest_both',
      displayName: 'Ada',
      email: 'ada@ex.com',
      phone: '+1 (415) 555-0100',
      idempotencyKey: 'idem-gs-both',
    });
    expect(ok.status).toBe(200);
  });

  it('matchOnEmail is case-insensitive and leaves no row, index, or created event', async () => {
    const actor = 'user_gs_email';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ matchOnEmail: true }),
          reason: 'Match email',
          idempotencyKey: 'idem-gs-match-email',
        })
      ).status,
    ).toBe(200);

    const first = await postGuest(propertyId, actor, {
      guestId: 'guest_email_1',
      displayName: 'Ada',
      email: 'ada@ex.com',
      idempotencyKey: 'idem-gs-email-1',
    });
    expect(first.status).toBe(200);

    const second = await postGuest(propertyId, actor, {
      guestId: 'guest_email_2',
      displayName: 'Ada Two',
      email: ' Ada@Ex.com ',
      idempotencyKey: 'idem-gs-email-2',
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      ok: false,
      error: GUEST_DUPLICATE,
      match: 'email',
      guestRef: 'guest_email_1',
    });

    const org = orgStub(orgId);
    expect(await org.getGuestPiiKeyId('guest_email_2')).toBeNull();
    expect(await org.countGuestBlindIndexForTest('guest_email_2')).toBe(0);
    const payloads = await org.listOutboxPayloads();
    expect(
      payloads.some(
        (row) => row.eventType === 'guest.created' && row.payload.includes('guest_email_2'),
      ),
    ).toBe(false);
  });

  it('matchOnPhone uses digits only', async () => {
    const actor = 'user_gs_phone';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ matchOnPhone: true }),
          reason: 'Match phone',
          idempotencyKey: 'idem-gs-match-phone',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_phone_1',
          displayName: 'Bea',
          phone: '+1 (415) 555-0199',
          idempotencyKey: 'idem-gs-phone-1',
        })
      ).status,
    ).toBe(200);
    const second = await postGuest(propertyId, actor, {
      guestId: 'guest_phone_2',
      displayName: 'Bea Two',
      phone: '14155550199',
      idempotencyKey: 'idem-gs-phone-2',
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      ok: false,
      error: GUEST_DUPLICATE,
      match: 'phone',
      guestRef: 'guest_phone_1',
    });
  });

  it('email match wins when both email and phone match different guests', async () => {
    const actor = 'user_gs_order';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ matchOnEmail: true, matchOnPhone: true }),
          reason: 'Match both',
          idempotencyKey: 'idem-gs-match-both',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_order_a',
          displayName: 'Email Guest',
          email: 'a@ex.com',
          phone: '1111111111',
          idempotencyKey: 'idem-gs-order-a',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_order_b',
          displayName: 'Phone Guest',
          email: 'b@ex.com',
          phone: '2222222222',
          idempotencyKey: 'idem-gs-order-b',
        })
      ).status,
    ).toBe(200);
    const clash = await postGuest(propertyId, actor, {
      guestId: 'guest_order_c',
      displayName: 'Clash',
      email: 'a@ex.com',
      phone: '2222222222',
      idempotencyKey: 'idem-gs-order-c',
    });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({
      error: GUEST_DUPLICATE,
      match: 'email',
      guestRef: 'guest_order_a',
    });
  });

  it('a guest linked only to hotel B does not block hotel A, and A’s 409 is A’s guest', async () => {
    const actor = 'user_gs_two';
    const orgId = `org_gs_two_${crypto.randomUUID()}`;
    const propertyA = `prop_gs_a_${crypto.randomUUID()}`;
    const propertyB = `prop_gs_b_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Two Hotel Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyA, actor, 'Hotel A')).status).toBe(201);
    expect((await postProperty(orgId, propertyB, actor, 'Hotel B')).status).toBe(201);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ matchOnEmail: true }),
          reason: 'Match email',
          idempotencyKey: 'idem-gs-two-put',
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await postGuest(propertyB, actor, {
          guestId: 'guest_hotel_b',
          displayName: 'Only B',
          email: 'shared@ex.com',
          idempotencyKey: 'idem-gs-hotel-b',
        })
      ).status,
    ).toBe(200);
    const atA = await postGuest(propertyA, actor, {
      guestId: 'guest_hotel_a',
      displayName: 'At A',
      email: 'shared@ex.com',
      idempotencyKey: 'idem-gs-hotel-a',
    });
    expect(atA.status).toBe(200);
    expect(JSON.stringify(await atA.clone().json())).not.toContain('guest_hotel_b');

    const dupA = await postGuest(propertyA, actor, {
      guestId: 'guest_hotel_a2',
      displayName: 'At A Again',
      email: 'shared@ex.com',
      idempotencyKey: 'idem-gs-hotel-a2',
    });
    expect(dupA.status).toBe(409);
    const body = await dupA.json();
    expect(body).toEqual({
      ok: false,
      error: GUEST_DUPLICATE,
      match: 'email',
      guestRef: 'guest_hotel_a',
    });
    expect(JSON.stringify(body)).not.toContain('guest_hotel_b');
  });

  it('an erased guest does not match', async () => {
    const actor = 'user_gs_erased';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ matchOnEmail: true }),
          reason: 'Match email',
          idempotencyKey: 'idem-gs-erased-put',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_erased',
          displayName: 'Gone',
          email: 'gone@ex.com',
          idempotencyKey: 'idem-gs-erased-1',
        })
      ).status,
    ).toBe(200);
    expect((await eraseGuest(propertyId, actor, 'guest_erased')).status).toBe(200);
    const again = await postGuest(propertyId, actor, {
      guestId: 'guest_after_erase',
      displayName: 'Next',
      email: 'gone@ex.com',
      idempotencyKey: 'idem-gs-erased-2',
    });
    expect(again.status).toBe(200);
  });

  it('replay of a successful create still returns that result after the rule turns on', async () => {
    const actor = 'user_gs_replay';
    const { orgId, propertyId } = await provisionHotel(actor);
    const first = await postGuest(propertyId, actor, {
      guestId: 'guest_replay',
      displayName: 'Replay',
      idempotencyKey: 'idem-gs-replay',
    });
    expect(first.status).toBe(200);
    const stored = (await first.json()) as { piiKeyId: string };

    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ requireEmail: true }),
          reason: 'Now required',
          idempotencyKey: 'idem-gs-replay-put',
        })
      ).status,
    ).toBe(200);

    const replay = await postGuest(propertyId, actor, {
      guestId: 'guest_replay',
      displayName: 'Replay',
      idempotencyKey: 'idem-gs-replay',
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      ok: true,
      guestId: 'guest_replay',
      piiKeyId: stored.piiKeyId,
    });

    const blocked = await postGuest(propertyId, actor, {
      guestId: 'guest_replay_new',
      displayName: 'New',
      idempotencyKey: 'idem-gs-replay-new',
    });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toEqual({ ok: false, error: GUEST_EMAIL_REQUIRED });
  });

  it('PUT validates the object, the reason, the key, the role, and the org', async () => {
    const owner = 'user_gs_put_owner';
    const staff = 'user_gs_put_staff';
    const { orgId, propertyId } = await provisionHotel(owner, 'Org Alpha');
    await orgStub(orgId).ensureMember(staff, 'staff');

    const unknown = await putSettings(orgId, owner, {
      value: { ...OFF, vipThreshold: 1 },
      reason: 'Extra',
      idempotencyKey: 'idem-gs-unknown',
    });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({ ok: false, error: VALIDATION_ERROR });

    const nonBool = await putSettings(orgId, owner, {
      value: { ...OFF, requireEmail: 'yes' },
      reason: 'Wrong type',
      idempotencyKey: 'idem-gs-bool',
    });
    expect(nonBool.status).toBe(422);
    expect(await nonBool.json()).toEqual({ ok: false, error: VALIDATION_ERROR });

    const missing = await putSettings(orgId, owner, {
      value: { requirePhone: false, matchOnEmail: false, matchOnPhone: false },
      reason: 'Missing email flag',
      idempotencyKey: 'idem-gs-missing',
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toEqual({ ok: false, error: VALIDATION_ERROR });

    const blank = await putSettings(orgId, owner, {
      value: OFF,
      reason: '   ',
      idempotencyKey: 'idem-gs-blank',
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'invalid_body' });

    const key = 'idem-gs-reuse';
    expect(
      (
        await putSettings(orgId, owner, {
          value: withSettings({ requireEmail: true }),
          reason: 'First write',
          idempotencyKey: key,
        })
      ).status,
    ).toBe(200);
    const reused = await putSettings(orgId, owner, {
      value: OFF,
      reason: 'First write',
      idempotencyKey: key,
    });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ ok: false, error: IDEM_KEY_REUSED });

    const staffPut = await putSettings(orgId, staff, {
      value: OFF,
      reason: 'Staff try',
      idempotencyKey: 'idem-gs-staff',
    });
    expect(staffPut.status).toBe(403);
    expect(await staffPut.json()).toEqual({ error: 'forbidden', permission: 'org:manage' });

    const otherOwner = 'user_gs_other_owner';
    const other = await provisionHotel(otherOwner, 'Org Beta Secret');
    const foreign = await putSettings(other.orgId, owner, {
      value: OFF,
      reason: 'Cross org',
      idempotencyKey: 'idem-gs-foreign',
    });
    expect(foreign.status).toBe(404);
    const foreignBody = await foreign.json();
    expect(foreignBody).toEqual({ error: 'not_found' });
    const foreignJson = JSON.stringify(foreignBody);
    expect(foreignJson).not.toContain('Org Beta Secret');
    expect(foreignJson).not.toContain(other.orgId);
    expect(foreignJson).not.toContain(other.propertyId);

    const listed = await listOperational(propertyId, owner);
    const items = ((await listed.json()) as { items: Array<{ key: string }> }).items;
    expect(items.map((item) => item.key)).not.toContain(GUEST_SETTINGS_KEY);
  });

  it('PATCH of an existing guest without email still succeeds when requireEmail is on', async () => {
    const actor = 'user_gs_patch';
    const { orgId, propertyId } = await provisionHotel(actor);
    expect(
      (
        await postGuest(propertyId, actor, {
          guestId: 'guest_patch',
          displayName: 'Before',
          idempotencyKey: 'idem-gs-patch-create',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await putSettings(orgId, actor, {
          value: withSettings({ requireEmail: true }),
          reason: 'Require email',
          idempotencyKey: 'idem-gs-patch-put',
        })
      ).status,
    ).toBe(200);
    const patched = await patchGuest(propertyId, actor, 'guest_patch', {
      displayName: 'After',
      idempotencyKey: 'idem-gs-patch-update',
    });
    expect(patched.status).toBe(200);
  });

  it('kill-switch 503 and unentitled 402 on guest settings', async () => {
    const actor = 'user_gs_kill';
    const { orgId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    expect(
      (
        await putSettings(orgId, actor, {
          value: OFF,
          reason: 'During kill',
          idempotencyKey: 'idem-gs-kill',
        })
      ).status,
    ).toBe(503);
    expect((await getSettings(orgId, actor)).status).toBe(503);

    await setKillSwitch(env, 'pms.core', false);
    await cancelSubscription(env, orgId);
    expect(
      (
        await putSettings(orgId, actor, {
          value: OFF,
          reason: 'Unentitled',
          idempotencyKey: 'idem-gs-unentitled',
        })
      ).status,
    ).toBe(402);
    expect((await getSettings(orgId, actor)).status).toBe(402);
  });
});
