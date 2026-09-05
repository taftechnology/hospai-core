import { env, listDurableObjectIds } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import { __setAuthenticateRequestForTest, resolveActor } from '../src/auth.js';
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

describe('Clerk azp enforcement (mocked)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    __setAuthenticateRequestForTest(null);
  });

  it('staging-shaped empty CLERK_AUTHORIZED_PARTIES refuses Clerk auth (G12)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_owner' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      HOSPAI_UNSAFE_LOCAL: undefined,
      HOSPAI_JURISDICTION_MODE: undefined,
      HOSPAI_PSP_MODE: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: '',
    };

    const orgId = `org_empty_azp_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Empty Parties Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('wrong azp → 401 (regression guard)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: false,
      toAuth: () => null,
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: 'https://allowed.example',
    };

    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId: `org_wrong_azp_${crypto.randomUUID()}`, name: 'Wrong Azp' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(authenticateRequest.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ authorizedParties: ['https://allowed.example'] }),
    );
  });

  it('matching azp → 201 and passes authorizedParties to Clerk', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_match' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: 'http://localhost',
    };

    const orgId = `org_match_azp_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Match Azp Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(authenticateRequest.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ authorizedParties: ['http://localhost'] }),
    );
  });

  it('HOSPAI_UNSAFE_LOCAL=1 empty parties may authenticate (local only)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_unsafe_local' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_UNSAFE_LOCAL: '1',
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: '',
    };

    const orgId = `org_unsafe_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Unsafe Local Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });
});

describe('Clerk WebSocket protocol (mocked)', () => {
  const clerkEnv = {
    ...env,
    HOSPAI_ALLOW_DEV_ACTOR: undefined,
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_PUBLISHABLE_KEY: 'pk_test',
    CLERK_JWT_KEY: 'pem',
  };

  afterEach(() => {
    __setAuthenticateRequestForTest(null);
  });

  it('dev-actor protocol unchanged when flags on', async () => {
    const authenticateRequest = vi.fn();
    __setAuthenticateRequestForTest(authenticateRequest);

    const devEnv = {
      ...env,
      HOSPAI_UNSAFE_LOCAL: '1',
      HOSPAI_ALLOW_DEV_ACTOR: '1',
    };

    const result = await resolveActor(
      new Request('http://localhost/v1/properties/prop_x/front-desk/stream', {
        headers: { 'Sec-WebSocket-Protocol': 'hospai.dev-actor.user_x' },
      }),
      devEnv,
    );

    expect(result).toEqual({ userId: 'user_x', source: 'dev' });
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('Clerk protocol success builds Bearer request', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_ws' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const result = await resolveActor(
      new Request('http://localhost/v1/properties/prop_x/front-desk/stream', {
        headers: { 'Sec-WebSocket-Protocol': 'hospai.clerk.session_jwt' },
      }),
      clerkEnv,
    );

    expect(result).toEqual({ userId: 'user_clerk_ws', source: 'clerk' });
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    const authHeader = authenticateRequest.mock.calls[0]?.[0]?.headers.get('authorization');
    expect(authHeader).toBe('Bearer session_jwt');
  });

  it('bad JWT on Clerk protocol returns 401', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: false,
      toAuth: () => null,
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const result = await resolveActor(
      new Request('http://localhost/v1/properties/prop_x/front-desk/stream', {
        headers: { 'Sec-WebSocket-Protocol': 'hospai.clerk.session_jwt' },
      }),
      clerkEnv,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(await (result as Response).json()).toEqual({
      error: 'unauthenticated',
      message: 'Invalid or missing session.',
    });
  });

  it('Clerk unconfigured returns 401 without treating JWT as dev actor', async () => {
    const authenticateRequest = vi.fn();
    __setAuthenticateRequestForTest(authenticateRequest);

    const unconfiguredEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined,
    };

    const result = await resolveActor(
      new Request('http://localhost/v1/properties/prop_x/front-desk/stream', {
        headers: { 'Sec-WebSocket-Protocol': 'hospai.clerk.session_jwt' },
      }),
      unconfiguredEnv,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    const body = (await (result as Response).json()) as { message: string };
    expect(body.message).toMatch(/^Authentication unavailable\./);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('prefix isolation: hospai.clerk protocol uses Clerk path even when dev flags on', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_ws' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const devAndClerkEnv = {
      ...env,
      HOSPAI_UNSAFE_LOCAL: '1',
      HOSPAI_ALLOW_DEV_ACTOR: '1',
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
    };

    const result = await resolveActor(
      new Request('http://localhost/v1/properties/prop_x/front-desk/stream', {
        headers: { 'Sec-WebSocket-Protocol': 'hospai.clerk.session_jwt, leftover' },
      }),
      devAndClerkEnv,
    );

    expect(result).toEqual({ userId: 'user_clerk_ws', source: 'clerk' });
    const authHeader = authenticateRequest.mock.calls[0]?.[0]?.headers.get('authorization');
    expect(authHeader).toBe('Bearer session_jwt');
  });
});
