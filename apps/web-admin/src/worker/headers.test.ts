import { afterEach, describe, expect, it } from 'vitest';
import worker from './index.js';
import { __setAuthenticateRequestForTest } from './auth.js';
import { fakePms, makeEnv } from './test-helpers.js';
import { vi } from 'vitest';

afterEach(() => __setAuthenticateRequestForTest(null));

function expectSecure(res: Response) {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('permissions-policy')).toContain('camera=()');
  expect(res.headers.get('strict-transport-security')).toContain('max-age');
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  // The ops Clerk Frontend API origin comes from the publishable key.
  expect(csp).toContain('https://caring-drake-8317.clerk.accounts.dev');
}

describe('security headers on every response', () => {
  it('API success', async () => {
    __setAuthenticateRequestForTest((async () => ({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'u', sessionClaims: { fva: [1, 1] } }),
    })) as never);
    const res = await worker.fetch(
      new Request('https://ops.example.test/api/me', { headers: { authorization: 'Bearer t' } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expectSecure(res);
  });

  it('API 401', async () => {
    const res = await worker.fetch(new Request('https://ops.example.test/api/me'), makeEnv({ CLERK_AUTHORIZED_PARTIES: '' }));
    expect(res.status).toBe(401);
    expectSecure(res);
  });

  it('asset HTML, including the SPA fallback path', async () => {
    const res = await worker.fetch(new Request('https://ops.example.test/customers/org_a'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('HospAI Ops Console');
    expectSecure(res);
  });

  it('405 on a non-GET outside /api', async () => {
    const res = await worker.fetch(new Request('https://ops.example.test/', { method: 'POST' }), makeEnv());
    expect(res.status).toBe(405);
    expectSecure(res);
  });

  it('an unexpected throw is a 500 with headers and no detail', async () => {
    const pms = fakePms({ listOperators: vi.fn(async () => { throw new Error('secret internals'); }) });
    __setAuthenticateRequestForTest((async () => ({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'u', sessionClaims: { fva: [1, 1] } }),
    })) as never);
    const res = await worker.fetch(
      new Request('https://ops.example.test/api/operators', { headers: { authorization: 'Bearer t' } }),
      makeEnv({ PMS_OPS: pms }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    expectSecure(res);
  });

  it('with no publishable key the CSP drops the Clerk origin but stays strict', async () => {
    const res = await worker.fetch(new Request('https://ops.example.test/'), makeEnv({ CLERK_PUBLISHABLE_KEY: undefined }));
    expect(res.headers.get('content-security-policy')).not.toContain('clerk');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
