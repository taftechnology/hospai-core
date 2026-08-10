import { createClerkClient } from '@clerk/backend';
import type { PmsEnv } from './env.js';

export type ClerkEmailLookupResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'no_such_user' | 'email_ambiguous' | 'clerk_unreachable' };

type LookupFn = (env: PmsEnv, email: string) => Promise<ClerkEmailLookupResult>;

/** Vitest-only override — avoids vi.mock in the Workers pool. */
let lookupOverride: LookupFn | null = null;

export function __setLookupUserIdByEmailForTest(fn: LookupFn | null): void {
  lookupOverride = fn;
}

function clerkConfigured(env: PmsEnv): boolean {
  return Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

export async function lookupUserIdByEmail(
  env: PmsEnv,
  email: string,
): Promise<ClerkEmailLookupResult> {
  if (lookupOverride) return lookupOverride(env, email);

  if (!clerkConfigured(env)) {
    return { ok: false, error: 'clerk_unreachable' };
  }

  try {
    const client = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY!,
      publishableKey: env.CLERK_PUBLISHABLE_KEY!,
      jwtKey: env.CLERK_JWT_KEY,
    });
    const { data } = await client.users.getUserList({
      emailAddress: [email],
      limit: 2,
    });
    if (data.length === 0) return { ok: false, error: 'no_such_user' };
    if (data.length > 1) return { ok: false, error: 'email_ambiguous' };
    return { ok: true, userId: data[0]!.id };
  } catch {
    return { ok: false, error: 'clerk_unreachable' };
  }
}

export function clerkUnreachableResponse(): Response {
  return Response.json(
    { error: 'clerk_unreachable', degraded: 'FAIL_CLOSED' },
    { status: 503, headers: { 'Retry-After': '30' } },
  );
}
