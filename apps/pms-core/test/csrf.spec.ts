import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setAuthenticateRequestForTest } from '../src/auth.js';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

const STAGING_ORIGIN = 'https://hospai-pms-core-staging.hospai.workers.dev';

function stagingClerkEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    HOSPAI_ALLOW_DEV_ACTOR: undefined,
    HOSPAI_UNSAFE_LOCAL: undefined,
    HOSPAI_JURISDICTION_MODE: undefined,
    HOSPAI_PSP_MODE: undefined,
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_PUBLISHABLE_KEY: 'pk_test',
    CLERK_JWT_KEY: 'pem',
    CLERK_AUTHORIZED_PARTIES: STAGING_ORIGIN,
    ...overrides,
  };
}

describe('mutating /v1 CSRF gate (mocked Clerk)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    __setAuthenticateRequestForTest(null);
  });

  it('POST /v1/orgs with Cookie session only, no Bearer, no Origin → 401 (CSRF)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_cookie_attack' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: '__session=attacker_session',
        },
        body: JSON.stringify({ orgId: `org_csrf_${crypto.randomUUID()}`, name: 'CSRF Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('POST /v1/orgs with Bearer passes CSRF gate (mock Clerk)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_bearer_ok' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const orgId = `org_bearer_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Bearer Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });

  it('POST /v1/orgs with permitted Origin, no Bearer, passes CSRF gate', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_origin_ok' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const orgId = `org_origin_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: STAGING_ORIGIN,
        },
        body: JSON.stringify({ orgId, name: 'Origin Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });
});
