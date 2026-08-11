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
        name: 'Members Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provision(actor: string) {
  const orgId = `org_memh_${crypto.randomUUID()}`;
  const propertyId = `prop_memh_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Members Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  return { orgId, propertyId, actor };
}

function headers(actor: string) {
  return { 'content-type': 'application/json', 'x-dev-actor': actor };
}

describe('membership HTTP families', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
    __setLookupUserIdByEmailForTest(async (_env, email) => {
      if (email === 'missing@example.com') return { ok: false, error: 'no_such_user' };
      if (email === 'down@example.com') return { ok: false, error: 'clerk_unreachable' };
      if (email === 'ambig@example.com') return { ok: false, error: 'email_ambiguous' };
      return { ok: true, userId: `user_from_${email.split('@')[0]}` };
    });
  });

  afterEach(() => {
    __setLookupUserIdByEmailForTest(null);
    __setLookupDirectoryByUserIdsForTest(null);
  });

  it('#1 HTTP: admin → org members routes forbidden/not_found gate', async () => {
    const owner = 'user_memh_owner_1';
    const { orgId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember('user_memh_admin', 'admin');

    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        method: 'GET',
        headers: headers('user_memh_admin'),
      }),
      env,
    );
    // admin lacks org:manage → forbidden
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission?: string };
    expect(body.error).toBe('forbidden');
    expect(body.permission).toBe('org:manage');
  });

  it('#2a HTTP+DO: admin property POST staff OK; admin/owner body rejected 422', async () => {
    const owner = 'user_memh_owner_2a';
    const { orgId, propertyId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember('user_memh_admin_2a', 'admin');

    const ok = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers('user_memh_admin_2a'),
        body: JSON.stringify({ email: 'staffer@example.com', role: 'staff' }),
      }),
      env,
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ ok: true, userId: 'user_from_staffer', role: 'staff' });

    const adminBody = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers('user_memh_admin_2a'),
        body: JSON.stringify({ email: 'peer@example.com', role: 'admin' }),
      }),
      env,
    );
    expect(adminBody.status).toBe(422);
    expect(await adminBody.json()).toMatchObject({ error: 'role_escalation' });

    const ownerBody = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers('user_memh_admin_2a'),
        body: JSON.stringify({ email: 'boss@example.com', role: 'owner' }),
      }),
      env,
    );
    expect(ownerBody.status).toBe(422);
    expect(await ownerBody.json()).toMatchObject({ error: 'invalid_role' });
  });

  it('#2b HTTP: owner property POST owner → 422', async () => {
    const owner = 'user_memh_owner_2b';
    const { propertyId } = await provision(owner);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ email: 'co@example.com', role: 'owner' }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_role' });
  });

  it('#4 HTTP: property-only member → property read OK; 404 on org-scope', async () => {
    const owner = 'user_memh_owner_4';
    const { orgId, propertyId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setPropertyMember(
      { kind: 'user', userId: owner },
      propertyId,
      { targetUserId: 'user_prop_only_4', role: 'staff', mode: 'create' },
    );

    const me = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/me`, {
        headers: { 'x-dev-actor': 'user_prop_only_4' },
      }),
      env,
    );
    expect(me.status).toBe(200);

    const orgProps = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        headers: { 'x-dev-actor': 'user_prop_only_4' },
      }),
      env,
    );
    expect(orgProps.status).toBe(404);
    expect(await orgProps.json()).toMatchObject({ error: 'not_found' });
  });

  it('#6 HTTP: unknown email → 422 no_such_user; clerk failure → 503 clerk_unreachable', async () => {
    const owner = 'user_memh_owner_6';
    const { propertyId } = await provision(owner);

    const missing = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ email: 'missing@example.com', role: 'staff' }),
      }),
      env,
    );
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: 'no_such_user' });

    const down = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ email: 'down@example.com', role: 'staff' }),
      }),
      env,
    );
    expect(down.status).toBe(503);
    const body = (await down.json()) as { error: string; degraded: string; commandId?: string };
    expect(body).toMatchObject({ error: 'clerk_unreachable', degraded: 'FAIL_CLOSED' });
    expect(body).not.toHaveProperty('commandId');
    expect(down.headers.get('Retry-After')).toBe('30');
  });

  it('#7 HTTP: query email ignored; body email wins', async () => {
    const owner = 'user_memh_owner_7';
    const { propertyId } = await provision(owner);
    const emails: string[] = [];
    __setLookupUserIdByEmailForTest(async (_env, email) => {
      emails.push(email);
      return { ok: true, userId: 'user_from_body' };
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members?email=query@example.com`,
        {
          method: 'POST',
          headers: headers(owner),
          body: JSON.stringify({ email: 'body@example.com', role: 'staff' }),
        },
      ),
      env,
    );
    expect(res.status).toBe(201);
    expect(emails).toEqual(['body@example.com']);
  });

  it('#8 HTTP: OrgDO blocked → org_unreachable, no commandId', async () => {
    const owner = 'user_memh_owner_8';
    const { orgId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);
    try {
      const res = await worker.fetch(
        new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
          headers: headers(owner),
        }),
        env,
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
      expect(body).not.toHaveProperty('commandId');
    } finally {
      await org.setTransportBlockedForTest(false);
    }
  });

  it('#11 HTTP: role_escalation status === 422', async () => {
    const owner = 'user_memh_owner_11';
    const { orgId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember('user_staff_11', 'staff');

    // Owner trying to… wait, owner can grant admin. Escalation: use admin calling org route → 403.
    // Property: admin grant admin → 422 role_escalation
    await org.ensureMember('user_admin_11', 'admin');
    const { propertyId } = await (async () => {
      const propertyId = `prop_memh_${crypto.randomUUID()}`;
      expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
      return { propertyId };
    })();

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers('user_admin_11'),
        body: JSON.stringify({ email: 'peer11@example.com', role: 'admin' }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'role_escalation' });
  });

  it('org list/create/update/delete happy path', async () => {
    const owner = 'user_memh_owner_happy';
    const { orgId } = await provision(owner);

    const created = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ email: 'newadmin@example.com', role: 'admin' }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const listed = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { members: Array<{ userId: string }> };
    expect(listBody.members.some((m) => m.userId === 'user_from_newadmin')).toBe(true);

    const patched = await worker.fetch(
      new Request(
        `http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent('user_from_newadmin')}`,
        {
          method: 'PATCH',
          headers: headers(owner),
          body: JSON.stringify({ role: 'staff' }),
        },
      ),
      env,
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      role: 'staff',
      previousRole: 'admin',
    });

    const deleted = await worker.fetch(
      new Request(
        `http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent('user_from_newadmin')}`,
        { method: 'DELETE', headers: headers(owner) },
      ),
      env,
    );
    expect(deleted.status).toBe(200);
  });

  it('#1 list: Clerk fault → 200 rows + directory unavailable', async () => {
    const owner = 'user_memh_dir_1';
    const { orgId } = await provision(owner);
    __setLookupDirectoryByUserIdsForTest(async () => ({
      ok: false,
      error: 'clerk_unreachable',
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as {
      ok: true;
      members: Array<{ userId: string; displayName: string | null }>;
      directory?: string;
    };
    expect(body.directory).toBe('unavailable');
    expect(body.members.some((m) => m.userId === owner)).toBe(true);
    expect(body.members.every((m) => m.displayName === null)).toBe(true);
  });

  it('#2 list: inject ok → displayName/email populated', async () => {
    const owner = 'user_memh_dir_2';
    const { orgId } = await provision(owner);
    __setLookupDirectoryByUserIdsForTest(async (_env, userIds) => ({
      ok: true,
      byUserId: new Map(
        userIds.map((id) => [
          id,
          { displayName: `Name ${id}`, email: `${id}@example.com` },
        ]),
      ),
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<{ userId: string; displayName: string | null; email: string | null }>;
      directory?: string;
    };
    expect(body.directory).toBeUndefined();
    const row = body.members.find((m) => m.userId === owner);
    expect(row).toMatchObject({
      displayName: `Name ${owner}`,
      email: `${owner}@example.com`,
    });
  });

  it('#3 list: directory ok + unresolved id → nulls without page marker (dangling)', async () => {
    const owner = 'user_memh_dir_3';
    const { orgId } = await provision(owner);
    __setLookupDirectoryByUserIdsForTest(async () => ({
      ok: true,
      byUserId: new Map(), // no entries resolved
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    const body = (await res.json()) as {
      members: Array<{ displayName: string | null; email: string | null }>;
      directory?: string;
    };
    expect(body.directory).toBeUndefined();
    expect(body.members[0]).toMatchObject({ displayName: null, email: null });
  });

  it('#5+#6: Cache-Control on property list; 409 already_member has userId+role', async () => {
    const owner = 'user_memh_dir_56';
    const { propertyId } = await provision(owner);
    __setLookupDirectoryByUserIdsForTest(async () => ({
      ok: true,
      byUserId: new Map(),
    }));

    const list = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    expect(list.status).toBe(200);
    expect(list.headers.get('Cache-Control')).toBe('private, no-store');

    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
            method: 'POST',
            headers: headers(owner),
            body: JSON.stringify({ email: 'dup@example.com', role: 'staff' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const dup = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ email: 'dup@example.com', role: 'admin' }),
      }),
      env,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({
      error: 'already_member',
      userId: 'user_from_dup',
      role: 'staff',
    });
  });

  it('#7 list: inject throw → 200 + directory unavailable (not 500)', async () => {
    const owner = 'user_memh_dir_7';
    const { orgId } = await provision(owner);
    __setLookupDirectoryByUserIdsForTest(async () => {
      throw new Error('injected clerk blowup');
    });
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { directory?: string; members: unknown[] };
    expect(body.directory).toBe('unavailable');
    expect(body.members.length).toBeGreaterThan(0);
  });

  it('property list includes hasOrgRole', async () => {
    const owner = 'user_memh_hasorg';
    const { orgId, propertyId } = await provision(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setPropertyMember(
      { kind: 'user', userId: owner },
      propertyId,
      { targetUserId: 'user_only', role: 'staff', mode: 'create' },
    );
    __setLookupDirectoryByUserIdsForTest(async () => ({
      ok: true,
      byUserId: new Map(),
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        headers: headers(owner),
      }),
      env,
    );
    const body = (await res.json()) as {
      members: Array<{ userId: string; hasOrgRole: boolean }>;
    };
    expect(body.members.find((m) => m.userId === 'user_only')?.hasOrgRole).toBe(false);
  });
});
