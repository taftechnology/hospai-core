import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

function expectSecurityHeaders(res: Response, opts?: { https?: boolean }) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers.get('Permissions-Policy')).toMatch(/camera=\(\)/);
  expect(res.headers.get('Permissions-Policy')).toMatch(/microphone=\(\)/);
  expect(res.headers.get('Permissions-Policy')).toMatch(/geolocation=\(\)/);
  if (opts?.https) {
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age=31536000/);
  } else {
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  }
}

describe('same-origin SPA assets', () => {
  it('unmatched non-/v1 path serves SPA shell via ASSETS', async () => {
    const res = await worker.fetch(new Request('http://localhost/arrivals'), env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain('html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('GET / serves SPA index (banner retired)', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('HospAI PMS');
  });
});

describe('security headers (N5)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('GET / HTML carries full security header set (T8)', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res, { https: false });
  });

  it('GET /v1/properties/:id/me carries headers on 200 and 401 (T9)', async () => {
    const orgId = `org_hdr_${crypto.randomUUID()}`;
    const propertyId = `prop_hdr_${crypto.randomUUID()}`;

    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_hdr' },
            body: JSON.stringify({ orgId, name: 'Header Org' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_hdr' },
            body: JSON.stringify({
              propertyId,
              name: 'Header Hotel',
              timeZone: 'UTC',
              currency: 'USD',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const authed = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/me`, {
        headers: { 'x-dev-actor': 'user_hdr' },
      }),
      env,
    );
    expect(authed.status).toBe(200);
    expectSecurityHeaders(authed, { https: false });

    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/me`),
      env,
    );
    expect(denied.status).toBe(401);
    expectSecurityHeaders(denied, { https: false });
  });
});
