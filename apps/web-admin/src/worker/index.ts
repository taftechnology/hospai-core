/**
 * HospAI Ops Console Worker. `/api/*` is the thin JSON layer over `PMS_OPS`; everything else is the
 * Vite build served from static assets, with single-page-application fallback. Every response, API
 * or asset or error, goes through the one shared security-header helper.
 */
import { applySecurityHeaders, clerkFrontendOrigin } from '@hospai/http-security';
import { handleApi } from './api.js';
import type { AdminEnv } from './env.js';

export type { AdminEnv } from './env.js';

const TURNSTILE = 'https://challenges.cloudflare.com';

function scriptOrigins(env: AdminEnv): string[] {
  const clerk = clerkFrontendOrigin(env.CLERK_PUBLISHABLE_KEY);
  return clerk ? [clerk, TURNSTILE] : [TURNSTILE];
}

async function serve(request: Request, env: AdminEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    let response: Response;
    try {
      response = await serve(request, env);
    } catch {
      response = Response.json({ error: 'internal_error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
    }
    return applySecurityHeaders(response, request, { scriptOrigins: scriptOrigins(env) });
  },
};
