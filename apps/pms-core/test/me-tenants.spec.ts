import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import {
  __setLookupDirectoryByUserIdsForTest,
  __setLookupUserIdByEmailForTest,
} from '../src/clerk-lookup.js';
import type { OrgDO } from '../src/org-do.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  seedSubscription,
  setKillSwitch,
} from '../src/registry.js';

type TenantOrg = {
  orgId: string;
  name: string | null;
  multiProperty: boolean;
  properties: Array<{ propertyId: string; name: string; timeZone: string | null }>;
};

function headers(actor: string) {
  return { 'content-type': 'application/json', 'x-dev-actor': actor };
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: headers(actor),
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, name: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: headers(actor),
      body: JSON.stringify({ propertyId, name, timeZone: 'UTC', currency: 'USD' }),
    }),
    env,
  );
}

/** One org, owner, and the named hotels. */
async function provisionOrg(
  owner: string,
  orgName: string,
  hotelNames: string[],
  plan: 'growth' | 'group' = hotelNames.length > 1 ? 'group' : 'growth',
) {
  const orgId = `org_mt_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, orgName, owner)).status).toBe(201);
  // Growth allows one hotel, Group ten (pms.properties.limit).
  await seedSubscription(env, orgId, plan);
  const propertyIds: string[] = [];
  for (const name of hotelNames) {
    const propertyId = `prop_mt_${crypto.randomUUID()}`;
    expect((await postProperty(orgId, propertyId, name, owner)).status).toBe(201);
    propertyIds.push(propertyId);
  }
  return { orgId, propertyIds, owner };
}

async function fetchTenants(actor: string | null) {
  const res = await worker.fetch(
    new Request('http://localhost/v1/me/tenants', {
      headers: actor ? { 'x-dev-actor': actor } : {},
    }),
    env,
  );
  return res;
}

async function tenantsFor(actor: string): Promise<TenantOrg[]> {
  const res = await fetchTenants(actor);
  expect(res.status).toBe(200);
  return ((await res.json()) as { tenants: TenantOrg[] }).tenants;
}

async function addPropertyMember(propertyId: string, email: string, byActor: string, role = 'staff') {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
      method: 'POST',
      headers: headers(byActor),
      body: JSON.stringify({ email, role }),
    }),
    env,
  );
  expect(res.status).toBe(201);
}

async function removePropertyMember(propertyId: string, userId: string, byActor: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: headers(byActor) },
    ),
    env,
  );
  expect(res.status).toBe(200);
}

async function addOrgMember(orgId: string, email: string, byActor: string, role = 'staff') {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
      method: 'POST',
      headers: headers(byActor),
      body: JSON.stringify({ email, role }),
    }),
    env,
  );
  expect(res.status).toBe(201);
}

async function removeOrgMember(orgId: string, userId: string, byActor: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: headers(byActor) },
    ),
    env,
  );
  expect(res.status).toBe(200);
}

async function indexRow(userId: string, orgId: string): Promise<boolean> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT 1 AS one FROM user_org WHERE user_id = ? AND org_id = ?`,
  )
    .bind(userId, orgId)
    .first();
  return row !== null;
}

describe('GET /v1/me/tenants (R4.4)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
    __setLookupUserIdByEmailForTest(async (_env, email) => ({
      ok: true,
      userId: email === 'multi3@example.com' ? 'user_mt_multi_3' : `user_from_${email.split('@')[0]}`,
    }));
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    __setLookupUserIdByEmailForTest(null);
    __setLookupDirectoryByUserIdsForTest(null);
  });

  it('#1 property-only member lists only their hotel; the other hotel is 404', async () => {
    const { orgId, propertyIds, owner } = await provisionOrg('user_mt_owner_1', 'Org One', [
      'Hotel Alpha',
      'Hotel Bravo',
    ]);
    const [a, b] = propertyIds as [string, string];
    await addPropertyMember(a, 'pa1@example.com', owner);

    const tenants = await tenantsFor('user_from_pa1');
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.orgId).toBe(orgId);
    expect(tenants[0]!.name).toBe('Org One');
    expect(tenants[0]!.properties).toEqual([
      { propertyId: a, name: 'Hotel Alpha', timeZone: 'UTC' },
    ]);
    expect(JSON.stringify(tenants)).not.toContain(b);

    const meB = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(b)}/me`, {
        headers: { 'x-dev-actor': 'user_from_pa1' },
      }),
      env,
    );
    expect(meB.status).toBe(404);
    expect(await meB.json()).toMatchObject({ error: 'not_found' });

    const dataB = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(b)}`, {
        headers: { 'x-dev-actor': 'user_from_pa1' },
      }),
      env,
    );
    expect(dataB.status).toBe(404);
    expect(await dataB.json()).toMatchObject({ error: 'not_found' });
  });

  it('#2 org member (staff) lists every active hotel in the org', async () => {
    const { orgId, propertyIds, owner } = await provisionOrg('user_mt_owner_2', 'Org Two', [
      'Hotel Bravo',
      'Hotel Alpha',
    ]);
    await addOrgMember(orgId, 'orgstaff2@example.com', owner);

    const tenants = await tenantsFor('user_from_orgstaff2');
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.properties.map((p) => p.name)).toEqual(['Hotel Alpha', 'Hotel Bravo']);
    expect(tenants[0]!.properties.map((p) => p.propertyId).sort()).toEqual([...propertyIds].sort());
  });

  it('#3 user in two orgs lists both, each with only accessible hotels; an org with none is omitted', async () => {
    const user = 'user_mt_multi_3';
    const org1 = await provisionOrg(user, 'Zulu Org', ['Zulu Hotel']);
    const org2 = await provisionOrg('user_mt_owner_3b', 'Alpha Org', ['Hotel C', 'Hotel D']);
    await addPropertyMember(org2.propertyIds[0]!, 'multi3@example.com', org2.owner);
    // Owns an org with no hotel at all: nothing to open, so it is omitted.
    const org3 = await provisionOrg(user, 'Empty Org', []);

    const tenants = await tenantsFor(user);
    expect(tenants.map((t) => t.orgId)).toEqual([org2.orgId, org1.orgId]);
    expect(tenants.map((t) => t.orgId)).not.toContain(org3.orgId);
    expect(tenants[0]!.properties).toEqual([
      { propertyId: org2.propertyIds[0], name: 'Hotel C', timeZone: 'UTC' },
    ]);
    expect(tenants[1]!.properties).toEqual([
      { propertyId: org1.propertyIds[0], name: 'Zulu Hotel', timeZone: 'UTC' },
    ]);
  });

  it('#4 a stale index row (membership gone in OrgDO) lists nothing for that org', async () => {
    const { orgId, propertyIds, owner } = await provisionOrg('user_mt_owner_4', 'Org Four', [
      'Hotel Alpha',
    ]);
    const a = propertyIds[0]!;
    await addPropertyMember(a, 'stale4@example.com', owner);
    expect(await indexRow('user_from_stale4', orgId)).toBe(true);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.removePropertyMemberForTest('user_from_stale4', a);
    // The D1 row is still there; the OrgDO re-check is what decides.
    expect(await indexRow('user_from_stale4', orgId)).toBe(true);
    expect(await tenantsFor('user_from_stale4')).toEqual([]);
  });

  it('#5 membership writes keep the index', async () => {
    const { orgId, propertyIds, owner } = await provisionOrg('user_mt_owner_5', 'Org Five', [
      'Hotel Alpha',
      'Hotel Bravo',
    ]);
    const [a, b] = propertyIds as [string, string];

    // Owner row from POST /v1/orgs.
    expect(await indexRow(owner, orgId)).toBe(true);

    // create → row present
    await addPropertyMember(a, 'idx5@example.com', owner);
    expect(await indexRow('user_from_idx5', orgId)).toBe(true);

    // delete of one of two property grants → row stays
    await addPropertyMember(b, 'idx5@example.com', owner);
    await removePropertyMember(a, 'user_from_idx5', owner);
    expect(await indexRow('user_from_idx5', orgId)).toBe(true);

    // delete of the last membership → row gone
    await removePropertyMember(b, 'user_from_idx5', owner);
    expect(await indexRow('user_from_idx5', orgId)).toBe(false);

    // org member: create → row; delete → row gone
    await addOrgMember(orgId, 'idx5org@example.com', owner);
    expect(await indexRow('user_from_idx5org', orgId)).toBe(true);
    await removeOrgMember(orgId, 'user_from_idx5org', owner);
    expect(await indexRow('user_from_idx5org', orgId)).toBe(false);
  });

  it('#6 get_property_me back-fills a missing row', async () => {
    const { orgId, propertyIds, owner } = await provisionOrg('user_mt_owner_6', 'Org Six', [
      'Hotel Alpha',
    ]);
    await env.PLATFORM_DB.prepare(`DELETE FROM user_org WHERE user_id = ?`).bind(owner).run();
    expect(await indexRow(owner, orgId)).toBe(false);
    expect(await tenantsFor(owner)).toEqual([]);

    const me = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyIds[0]!)}/me`, {
        headers: { 'x-dev-actor': owner },
      }),
      env,
    );
    expect(me.status).toBe(200);
    expect(await indexRow(owner, orgId)).toBe(true);
    expect((await tenantsFor(owner)).map((t) => t.orgId)).toEqual([orgId]);
  });

  it('#7 multiProperty follows the org entitlement (Growth false, Group true)', async () => {
    const growth = await provisionOrg('user_mt_owner_7g', 'Growth Org', ['Hotel Alpha'], 'growth');
    const group = await provisionOrg('user_mt_owner_7h', 'Group Org', ['Hotel Alpha'], 'group');

    expect((await tenantsFor(growth.owner))[0]!.multiProperty).toBe(false);
    expect((await tenantsFor(group.owner))[0]!.multiProperty).toBe(true);
  });

  it('#9 user-scope route: no tenant gate, reachable while the org kill-switch is on; no actor is 401', async () => {
    const { orgId, owner } = await provisionOrg('user_mt_owner_9', 'Org Nine', ['Hotel Alpha']);
    expect((await fetchTenants(null)).status).toBe(401);

    await setKillSwitch(env, 'pms.core', true);
    const res = await fetchTenants(owner);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as { tenants: TenantOrg[] };
    expect(body.tenants.map((t) => t.orgId)).toContain(orgId);
  });
});
