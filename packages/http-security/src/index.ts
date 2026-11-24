/**
 * The one security-header helper (AGENTS §1): every HTTP and SPA HTML response of pms-core and of
 * the Ops Console Worker goes through `applySecurityHeaders`. A new response path (download, error
 * page, WebSocket upgrade failure) uses it too; there is no second copy.
 */

/** Clerk Frontend API + Turnstile for the hotel app's staging publishable key (pms-core's default). */
export const DEFAULT_SCRIPT_ORIGINS: readonly string[] = [
  'https://caring-drake-8317.clerk.accounts.dev',
  'https://challenges.cloudflare.com',
];

export type SecurityHeaderOptions = {
  /** Origins allowed in `script-src` and `connect-src` (Clerk Frontend API, Turnstile). */
  scriptOrigins?: readonly string[];
};

/**
 * The Clerk Frontend API origin encoded in a publishable key (`pk_test_<base64(host$)>`), or null
 * when the key is not a Clerk publishable key.
 */
export function clerkFrontendOrigin(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey);
  if (!m) return null;
  try {
    const host = atob(m[1]!).replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const origins = (options.scriptOrigins ?? DEFAULT_SCRIPT_ORIGINS).join(' ');
  const extra = origins ? ` ${origins}` : '';
  return [
    "default-src 'self'",
    "img-src 'self' blob:",
    "frame-ancestors 'none'",
    `connect-src 'self'${extra}`,
    `script-src 'self'${extra}`,
  ].join('; ');
}

export function applySecurityHeaders(
  response: Response,
  request: Request,
  options: SecurityHeaderOptions = {},
): Response {
  // WebSocket upgrade (101) cannot be reconstructed via Response constructor.
  if (response.status === 101) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', buildContentSecurityPolicy(options));
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (request.url.startsWith('https:')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
