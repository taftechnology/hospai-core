import { env, listDurableObjectIds } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import { __setAuthenticateRequestForTest } from '../src/auth.js';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

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
        name: 'Test Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

describe('auth + membership (Phase 0)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('org takeover blocked — second create returns 409 and does not add member', async () => {
    const orgId = `victimorg_${crypto.randomUUID().slice(0, 8)}`;
    expect((await postOrg(orgId, 'Alice Org', 'user_alice')).status).toBe(201);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect(await org.listMembers()).toEqual([{ userId: 'user_alice', role: 'owner' }]);

    const malloryCreate = await postOrg(orgId, 'anything', 'user_mallory');
    expect(malloryCreate.status).toBe(409);
    expect(await malloryCreate.json()).toEqual({ error: 'org_exists' });

    const members = await org.listMembers();
    expect(members.some((m) => m.userId === 'user_mallory')).toBe(false);

    const provision = await postProperty(orgId, `prop_${crypto.randomUUID()}`, 'user_mallory');
    expect(provision.status).toBe(404);
  });

  it('cross-org property create denied for non-member', async () => {
    const orgA = `org_a_${crypto.randomUUID()}`;
    const orgB = `org_b_${crypto.randomUUID()}`;
    expect((await postOrg(orgA, 'Org A', 'user_a')).status).toBe(201);
    expect((await postOrg(orgB, 'Org B', 'user_b')).status).toBe(201);

    const denied = await postProperty(orgA, `prop_${crypto.randomUUID()}`, 'user_b');
    expect(denied.status).toBe(404);
  });

  it('non-member and absent org are indistinguishable (404/404)', async () => {
    const existingOrg = `org_exist_${crypto.randomUUID()}`;
    const absentOrg = `org_absent_${crypto.randomUUID()}`;
    expect((await postOrg(existingOrg, 'Exists', 'user_owner')).status).toBe(201);

    const onExisting = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${existingOrg}/properties`, {
        headers: { 'x-dev-actor': 'user_stranger' },
      }),
      env,
    );
    const onAbsent = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${absentOrg}/properties`, {
        headers: { 'x-dev-actor': 'user_stranger' },
      }),
      env,
    );
    expect(onExisting.status).toBe(404);
    expect(onAbsent.status).toBe(404);
    expect(await onExisting.json()).toEqual({ error: 'not_found' });
    expect(await onAbsent.json()).toEqual({ error: 'not_found' });
  });

  it('member can provision property in their org', async () => {
    const orgId = `org_ok_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'OK Org', 'user_owner')).status).toBe(201);

    const propertyId = `prop_ok_${crypto.randomUUID()}`;
    const created = await postProperty(orgId, propertyId, 'user_owner');
    expect(created.status).toBe(201);
  });

  it('non-member property read denied', async () => {
    const orgId = `org_read_${crypto.randomUUID()}`;
    const propertyId = `prop_read_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Read Org', 'user_a')).status).toBe(201);
    expect((await postProperty(orgId, propertyId, 'user_a')).status).toBe(201);

    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}`),
      env,
    );
    expect(denied.status).toBe(401);

    const forbidden = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}`, {
        headers: { 'x-dev-actor': 'user_b' },
      }),
      env,
    );
    expect(forbidden.status).toBe(404);
  });

  it('member property read allowed', async () => {
    const orgId = `org_get_${crypto.randomUUID()}`;
    const propertyId = `prop_get_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Get Org', 'user_a')).status).toBe(201);
    expect((await postProperty(orgId, propertyId, 'user_a')).status).toBe(201);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}`, {
        headers: { 'x-dev-actor': 'user_a' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { property: { propertyId: string } };
    expect(body.property.propertyId).toBe(propertyId);
  });

  it('org list requires membership', async () => {
    const orgId = `org_list_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'List Org', 'user_a')).status).toBe(201);

    const forbidden = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
        headers: { 'x-dev-actor': 'user_b' },
      }),
      env,
    );
    expect(forbidden.status).toBe(404);
  });

  it('absent org (no D1 row) probe does not materialize OrgDO', async () => {
    const orgId = `org_missing_${crypto.randomUUID()}`;
    const before = await listDurableObjectIds(env.ORG_DO as unknown as DurableObjectNamespace);

    const getRes = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
        headers: { 'x-dev-actor': 'user_probe' },
      }),
      env,
    );
    expect(getRes.status).toBe(404);

    const postRes = await postProperty(orgId, `prop_${crypto.randomUUID()}`, 'user_probe');
    expect(postRes.status).toBe(404);

    const after = await listDurableObjectIds(env.ORG_DO as unknown as DurableObjectNamespace);
    expect(after.length).toBe(before.length);
  });

  it('property create on unknown org returns 404', async () => {
    const orgId = `org_nobody_${crypto.randomUUID()}`;
    const res = await postProperty(orgId, `prop_${crypto.randomUUID()}`, 'user_x');
    expect(res.status).toBe(404);
  });
});

describe('Clerk path (mocked)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    __setAuthenticateRequestForTest(null);
  });

  it('verified Clerk session succeeds when member; unauthenticated returns 401', async () => {
    const authenticateRequest = vi.fn();
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
    };

    const orgId = `org_clerk_${crypto.randomUUID()}`;
    const propertyId = `prop_clerk_${crypto.randomUUID()}`;

    authenticateRequest.mockResolvedValueOnce({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_owner' }),
    });
    const createOrgRes = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Clerk Org' }),
      }),
      clerkEnv,
    );
    expect(createOrgRes.status).toBe(201);

    authenticateRequest.mockResolvedValueOnce({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_owner' }),
    });
    const provisionRes = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({
          propertyId,
          name: 'Clerk Hotel',
          timeZone: 'UTC',
          currency: 'USD',
        }),
      }),
      clerkEnv,
    );
    expect(provisionRes.status).toBe(201);

    authenticateRequest.mockResolvedValueOnce({
      isAuthenticated: false,
      toAuth: () => null,
    });
    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}`, {
        headers: { authorization: 'Bearer bad' },
      }),
      clerkEnv,
    );
    expect(denied.status).toBe(401);
  });
});
