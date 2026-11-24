import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { __setAuthenticateRequestForTest, __setClerkUserLookupForTest, type ClerkUserLike } from './auth.js';
import { OPERATOR, fakePms, makeEnv } from './test-helpers.js';

type AuthFn = NonNullable<Parameters<typeof __setAuthenticateRequestForTest>[0]>;

function signedIn(userId = 'user_ops', claims: Record<string, unknown> = { fva: [5, 5] }): AuthFn {
  return vi.fn(async () => ({
    isAuthenticated: true,
    toAuth: () => ({ userId, sessionClaims: claims }),
  })) as unknown as AuthFn;
}
const signedOut: AuthFn = vi.fn(async () => ({
  isAuthenticated: false,
  toAuth: () => null,
})) as unknown as AuthFn;

const get = (path = '/api/customers', headers: Record<string, string> = {}) =>
  new Request(`https://ops.example.test${path}`, { headers: { authorization: 'Bearer t', ...headers } });

afterEach(() => {
  __setAuthenticateRequestForTest(null);
  __setClerkUserLookupForTest(null);
});

describe('/api authentication (spec §15)', () => {
  it('no token -> 401', async () => {
    __setAuthenticateRequestForTest(signedOut);
    const res = await worker.fetch(new Request('https://ops.example.test/api/me'), makeEnv());
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'unauthenticated' });
  });

  it('a token from another Clerk instance (authenticateRequest says unauthenticated) -> 401, no PMS call', async () => {
    __setAuthenticateRequestForTest(signedOut);
    const env = makeEnv();
    const res = await worker.fetch(get('/api/me'), env);
    expect(res.status).toBe(401);
    expect(env.PMS_OPS.resolveOperator).not.toHaveBeenCalled();
  });

  it('passes the configured authorizedParties to authenticateRequest, so a foreign azp is refused', async () => {
    const authFn = signedIn();
    __setAuthenticateRequestForTest(authFn);
    await worker.fetch(get('/api/me'), makeEnv({ CLERK_AUTHORIZED_PARTIES: ' https://a.test , https://b.test ' }));
    expect(authFn).toHaveBeenCalledTimes(1);
    const options = (authFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as {
      authorizedParties?: string[];
    };
    expect(options.authorizedParties).toEqual(['https://a.test', 'https://b.test']);
  });

  it.each(['', '   ', undefined])('CLERK_AUTHORIZED_PARTIES %j -> 401 on every request, Clerk never asked', async (parties) => {
    const authFn = signedIn();
    __setAuthenticateRequestForTest(authFn);
    const env = makeEnv({ CLERK_AUTHORIZED_PARTIES: parties });
    for (const path of ['/api/me', '/api/customers', '/api/operators']) {
      const res = await worker.fetch(get(path), env);
      expect(res.status).toBe(401);
    }
    expect(authFn).not.toHaveBeenCalled();
  });

  it('missing Clerk config -> 401', async () => {
    __setAuthenticateRequestForTest(signedIn());
    const res = await worker.fetch(get('/api/me'), makeEnv({ CLERK_SECRET_KEY: undefined }));
    expect(res.status).toBe(401);
  });

  it.each([[{ fva: [5, -1] }], [{}], [{ fva: [5] }], [{ fva: 'x' }]])('claims %j -> 401 mfa_required', async (claims) => {
    __setAuthenticateRequestForTest(signedIn('user_ops', claims));
    const env = makeEnv();
    const res = await worker.fetch(get('/api/me'), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('mfa_required');
    expect(env.PMS_OPS.resolveOperator).not.toHaveBeenCalled();
  });

  it('valid session with a known operator resolves by clerk user id and never calls the Clerk API', async () => {
    __setAuthenticateRequestForTest(signedIn());
    const lookup = vi.fn();
    __setClerkUserLookupForTest(lookup);
    const env = makeEnv();
    const res = await worker.fetch(get('/api/me'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      operator: { operatorId: 'op_1', displayName: 'Ops One', role: 'ops_admin' },
    });
    expect(env.PMS_OPS.resolveOperator).toHaveBeenCalledWith({ clerkUserId: 'user_ops', verifiedEmail: null });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('valid token, resolveOperator fails and no verified email -> 403 not_an_operator', async () => {
    __setAuthenticateRequestForTest(signedIn());
    const user: ClerkUserLike = { primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'x@example.test', verification: { status: 'verified' } }] };
    __setClerkUserLookupForTest(async () => user);
    const pms = fakePms({ resolveOperator: vi.fn(async () => ({ ok: false, error: 'not_an_operator', status: 403 })) });
    const res = await worker.fetch(get('/api/me'), makeEnv({ PMS_OPS: pms }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('not_an_operator');
    // Retried once with the verified email, then refused.
    expect(pms.resolveOperator).toHaveBeenCalledTimes(2);
  });

  it('links through the verified primary email only', async () => {
    __setAuthenticateRequestForTest(signedIn());
    __setClerkUserLookupForTest(async () => ({
      firstName: 'Ada',
      lastName: 'Lovelace',
      primaryEmailAddressId: 'e2',
      emailAddresses: [
        { id: 'e1', emailAddress: 'other@example.test', verification: { status: 'verified' } },
        { id: 'e2', emailAddress: 'Ops@Example.test', verification: { status: 'verified' } },
      ],
    }));
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'not_an_operator', status: 403 })
      .mockResolvedValueOnce({ ok: true, operator: OPERATOR, via: 'link' });
    const res = await worker.fetch(get('/api/me'), makeEnv({ PMS_OPS: fakePms({ resolveOperator: resolve }) }));
    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenLastCalledWith({
      clerkUserId: 'user_ops',
      verifiedEmail: 'Ops@Example.test',
      displayName: 'Ada Lovelace',
    });
  });

  it('an unverified email is never passed as verifiedEmail', async () => {
    __setAuthenticateRequestForTest(signedIn());
    __setClerkUserLookupForTest(async () => ({
      primaryEmailAddressId: 'e1',
      emailAddresses: [
        { id: 'e1', emailAddress: 'ops@example.test', verification: { status: 'unverified' } },
        { id: 'e2', emailAddress: 'verified-but-not-primary@example.test', verification: { status: 'verified' } },
      ],
    }));
    const resolve = vi.fn(async () => ({ ok: false, error: 'not_an_operator', status: 403 }));
    const res = await worker.fetch(get('/api/me'), makeEnv({ PMS_OPS: fakePms({ resolveOperator: resolve }) }));
    expect(res.status).toBe(403);
    for (const call of resolve.mock.calls as unknown as Array<[{ verifiedEmail: string | null }]>) {
      expect(call[0].verifiedEmail).toBeNull();
    }
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a Clerk API failure is a 502, not an operator', async () => {
    __setAuthenticateRequestForTest(signedIn());
    __setClerkUserLookupForTest(async () => {
      throw new Error('clerk down');
    });
    const pms = fakePms({ resolveOperator: vi.fn(async () => ({ ok: false, error: 'not_an_operator', status: 403 })) });
    const res = await worker.fetch(get('/api/me'), makeEnv({ PMS_OPS: pms }));
    expect(res.status).toBe(502);
  });
});

describe('dev operator header', () => {
  const dev = { 'x-dev-operator': 'Dev@Example.test' };

  it.each([
    [{ HOSPAI_UNSAFE_LOCAL: undefined, OPS_ALLOW_DEV_OPERATOR: undefined }],
    [{ HOSPAI_UNSAFE_LOCAL: '1', OPS_ALLOW_DEV_OPERATOR: undefined }],
    [{ HOSPAI_UNSAFE_LOCAL: undefined, OPS_ALLOW_DEV_OPERATOR: '1' }],
    [{ HOSPAI_UNSAFE_LOCAL: '0', OPS_ALLOW_DEV_OPERATOR: '1' }],
  ])('is ignored unless both flags are 1 (%j)', async (flags) => {
    __setAuthenticateRequestForTest(signedOut);
    const env = makeEnv(flags);
    const res = await worker.fetch(new Request('https://ops.example.test/api/me', { headers: dev }), env);
    expect(res.status).toBe(401);
    expect(env.PMS_OPS.resolveOperator).not.toHaveBeenCalled();
  });

  it('with both flags it resolves a synthetic clerk id and the header email as verified, with no Clerk config', async () => {
    const env = makeEnv({
      HOSPAI_UNSAFE_LOCAL: '1',
      OPS_ALLOW_DEV_OPERATOR: '1',
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined,
      CLERK_AUTHORIZED_PARTIES: undefined,
    });
    const res = await worker.fetch(new Request('https://ops.example.test/api/me', { headers: dev }), env);
    expect(res.status).toBe(200);
    expect(env.PMS_OPS.resolveOperator).toHaveBeenCalledWith({
      clerkUserId: 'dev:dev@example.test',
      verifiedEmail: 'dev@example.test',
      displayName: 'dev',
    });
  });

  it('a dev email that is not an operator is 403', async () => {
    const pms = fakePms({ resolveOperator: vi.fn(async () => ({ ok: false, error: 'not_an_operator', status: 403 })) });
    const env = makeEnv({ PMS_OPS: pms, HOSPAI_UNSAFE_LOCAL: '1', OPS_ALLOW_DEV_OPERATOR: '1' });
    const res = await worker.fetch(new Request('https://ops.example.test/api/me', { headers: dev }), env);
    expect(res.status).toBe(403);
  });
});
