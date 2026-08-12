import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_EXITED, STAFF_REF_RE } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
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

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Roster Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_roster_${crypto.randomUUID()}`;
  const propertyId = `prop_roster_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Roster Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

function rosterUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/roster${suffix}`;
}

async function postRoster(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(rosterUrl(propertyId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-roster-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function patchRoster(
  propertyId: string,
  actor: string,
  staffId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-roster-upd-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function postRosterStatus(
  propertyId: string,
  actor: string,
  staffId: string,
  status: 'active' | 'inactive',
) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}/status`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        status,
        idempotencyKey: `idem-roster-status-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postRosterExit(propertyId: string, actor: string, staffId: string) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}/exit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-roster-exit-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function getRosterList(propertyId: string, actor: string, kind?: string) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return worker.fetch(
    new Request(rosterUrl(propertyId, q), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function getRosterOne(propertyId: string, actor: string, staffId: string) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}`), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

describe('roster HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1a: POST body with staffId → 400 invalid_body; no row with that id', async () => {
    const actor = 'user_roster_1a';
    const { propertyId } = await provisionHotel(actor);
    const staffId = 'staff_client_supplied';
    const res = await postRoster(propertyId, actor, {
      staffId,
      displayName: 'Ada',
      kinds: ['housekeeper'],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });

    const getRes = await getRosterOne(propertyId, actor, staffId);
    expect(getRes.status).toBe(404);
  });

  it('1 HTTP: POST /roster 200 { staffId, piiKeyId }; staffId matches STAFF_REF_RE', async () => {
    const actor = 'user_roster_1http';
    const { propertyId } = await provisionHotel(actor);
    const res = await postRoster(propertyId, actor, {
      displayName: 'Ada Lovelace',
      kinds: ['housekeeper'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { staffId: string; piiKeyId: string };
    expect(body.staffId).toMatch(STAFF_REF_RE);
    expect(typeof body.piiKeyId).toBe('string');
  });

  it('10 HTTP: PATCH / status after exit → 409 staff_exited', async () => {
    const actor = 'user_roster_10http';
    const { propertyId } = await provisionHotel(actor);
    const created = (await (
      await postRoster(propertyId, actor, { displayName: 'Ada', kinds: ['housekeeper'] })
    ).json()) as { staffId: string };
    expect((await postRosterExit(propertyId, actor, created.staffId)).status).toBe(200);

    const patchRes = await patchRoster(propertyId, actor, created.staffId, { displayName: 'After' });
    expect(patchRes.status).toBe(409);
    expect(await patchRes.json()).toMatchObject({ ok: false, error: STAFF_EXITED });

    const statusRes = await postRosterStatus(propertyId, actor, created.staffId, 'active');
    expect(statusRes.status).toBe(409);
    expect(await statusRes.json()).toMatchObject({ ok: false, error: STAFF_EXITED });
  });

  it('14: staff role POST/exit → 403 roster:write', async () => {
    const owner = 'user_roster_owner14';
    const staff = 'user_roster_staff14';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const postRes = await postRoster(propertyId, staff, {
      displayName: 'Staff Made',
      kinds: ['housekeeper'],
    });
    expect(postRes.status).toBe(403);
    expect(await postRes.json()).toMatchObject({ error: 'forbidden', permission: 'roster:write' });

    const created = (await (
      await postRoster(propertyId, owner, { displayName: 'Ada', kinds: ['housekeeper'] })
    ).json()) as { staffId: string };
    const exitRes = await postRosterExit(propertyId, staff, created.staffId);
    expect(exitRes.status).toBe(403);
    expect(await exitRes.json()).toMatchObject({ error: 'forbidden', permission: 'roster:write' });
  });

  it('15: staff role GET list is operational only — no hourlyRate/rating/skills/email/phone even if blob has them', async () => {
    const owner = 'user_roster_owner15';
    const staff = 'user_roster_staff15';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    expect(
      (
        await postRoster(propertyId, owner, {
          displayName: 'Ada',
          kinds: ['housekeeper'],
          email: 'ada@example.com',
          phone: '+15551212',
          hourlyRate: { amountMinor: 1500, currency: 'USD' },
          rating: 4,
          skills: ['rooms'],
        })
      ).status,
    ).toBe(200);

    const res = await getRosterList(propertyId, staff);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { staff: Array<Record<string, unknown>> };
    expect(body.staff).toHaveLength(1);
    const row = body.staff[0]!;
    expect(row.displayName).toBe('Ada');
    expect(row).not.toHaveProperty('hourlyRate');
    expect(row).not.toHaveProperty('rating');
    expect(row).not.toHaveProperty('skills');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('phone');
  });

  it('16: owner GET includes contact + hourlyRate as Money', async () => {
    const actor = 'user_roster_16';
    const { propertyId } = await provisionHotel(actor);
    const created = (await (
      await postRoster(propertyId, actor, {
        displayName: 'Ada',
        kinds: ['housekeeper'],
        email: 'ada@example.com',
        phone: '+15551212',
        hourlyRate: { amountMinor: 1500, currency: 'USD' },
      })
    ).json()) as { staffId: string };

    const res = await getRosterOne(propertyId, actor, created.staffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as {
      email?: string;
      phone?: string;
      hourlyRate?: { amountMinor: number; currency: string };
    };
    expect(body.email).toBe('ada@example.com');
    expect(body.phone).toBe('+15551212');
    expect(body.hourlyRate).toEqual({ amountMinor: 1500, currency: 'USD' });
  });

  it('18: OrgDO blocked on add → 503 org_unreachable FAIL_CLOSED, not 500', async () => {
    const actor = 'user_roster_18';
    const { orgId, propertyId } = await provisionHotel(actor);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);

    const res = await postRoster(propertyId, actor, {
      displayName: 'Blocked',
      kinds: ['housekeeper'],
      idempotencyKey: 'idem-roster-blocked',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'org_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'roster.add',
    });
    expect(res.headers.get('Retry-After')).toBe('30');

    await org.setTransportBlockedForTest(false);
    const read = await getRosterList(propertyId, actor);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { staff: unknown[] };
    expect(body.staff).toEqual([]);
  });

  it('19: kill-switch → 503 empty body', async () => {
    const actor = 'user_roster_19';
    const { propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const res = await postRoster(propertyId, actor, {
      displayName: 'X',
      kinds: ['housekeeper'],
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });
});
