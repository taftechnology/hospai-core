import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, buildContentSecurityPolicy, clerkFrontendOrigin } from './index.js';

describe('applySecurityHeaders', () => {
  const req = (url: string) => new Request(url);

  it('sets the full header set, with HSTS only on https', () => {
    const https = applySecurityHeaders(new Response('x'), req('https://example.test/'));
    expect(https.headers.get('x-content-type-options')).toBe('nosniff');
    expect(https.headers.get('referrer-policy')).toBe('no-referrer');
    expect(https.headers.get('x-frame-options')).toBe('DENY');
    expect(https.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(https.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(https.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const http = applySecurityHeaders(new Response('x'), req('http://localhost/'));
    expect(http.headers.get('strict-transport-security')).toBeNull();
  });

  it('keeps pms-core defaults and lets a caller name its own Clerk origins', () => {
    expect(buildContentSecurityPolicy()).toContain('https://caring-drake-8317.clerk.accounts.dev');
    const csp = buildContentSecurityPolicy({ scriptOrigins: ['https://ops.clerk.example'] });
    expect(csp).toContain("script-src 'self' https://ops.clerk.example");
    expect(csp).not.toContain('caring-drake');
    expect(buildContentSecurityPolicy({ scriptOrigins: [] })).toContain("script-src 'self'");
  });

  it('passes a 101 upgrade through untouched', () => {
    const res = { status: 101 } as Response;
    expect(applySecurityHeaders(res, req('https://x.test/'))).toBe(res);
  });

  it('decodes the Frontend API origin from a publishable key', () => {
    expect(clerkFrontendOrigin('pk_test_Y2FyaW5nLWRyYWtlLTgzMTcuY2xlcmsuYWNjb3VudHMuZGV2JA')).toBe(
      'https://caring-drake-8317.clerk.accounts.dev',
    );
    expect(clerkFrontendOrigin('nope')).toBeNull();
    expect(clerkFrontendOrigin(undefined)).toBeNull();
    expect(clerkFrontendOrigin('pk_test_!!!')).toBeNull();
  });
});
