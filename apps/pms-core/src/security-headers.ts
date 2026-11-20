/** Clerk Frontend API + Turnstile for staging publishable key in wrangler.jsonc. */
const CLERK_SCRIPT_ORIGINS = [
  'https://caring-drake-8317.clerk.accounts.dev',
  'https://challenges.cloudflare.com',
];

function buildContentSecurityPolicy(): string {
  const clerk = CLERK_SCRIPT_ORIGINS.join(' ');
  return [
    "default-src 'self'",
    "img-src 'self' blob:",
    "frame-ancestors 'none'",
    `connect-src 'self' ${clerk}`,
    `script-src 'self' ${clerk}`,
  ].join('; ');
}

export function applySecurityHeaders(response: Response, request: Request): Response {
  // WebSocket upgrade (101) cannot be reconstructed via Response constructor.
  if (response.status === 101) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', buildContentSecurityPolicy());
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
