/**
 * Every /api request is authenticated here (spec §15):
 *  - Bearer token verified with `@clerk/backend` against the OPS Clerk instance, with
 *    `authorizedParties` from CLERK_AUTHORIZED_PARTIES. Empty parties or missing Clerk config fail
 *    closed (401 on every request).
 *  - A second factor is required: the session token's `fva` claim is `[firstAge, secondAge]` and a
 *    second age of -1 (or no claim) means no second factor was ever verified: 401 `mfa_required`.
 *  - The operator is then resolved by Clerk user id; only when that fails is the Clerk user fetched
 *    once, and only a VERIFIED primary email is passed to `resolveOperator`.
 *  - `x-dev-operator` works only with both local flags (HOSPAI_UNSAFE_LOCAL and OPS_ALLOW_DEV_OPERATOR).
 */
import { createClerkClient } from '@clerk/backend';
import type { OperatorView } from '@hospai/contracts';
import { isDevOperatorAllowed, type AdminEnv } from './env.js';

const DEV_OPERATOR_HEADER = 'x-dev-operator';

export type AuthResult = { operator: OperatorView } | { response: Response };

function deny(status: number, error: string, message?: string): { response: Response } {
  return {
    response: Response.json({ error, ...(message ? { message } : {}) }, { status, headers: { 'cache-control': 'no-store' } }),
  };
}

export function authorizedParties(env: AdminEnv): string[] {
  const raw = env.CLERK_AUTHORIZED_PARTIES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function clerkConfigured(env: AdminEnv): boolean {
  return Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

function clerkClient(env: AdminEnv) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY!,
    publishableKey: env.CLERK_PUBLISHABLE_KEY!,
    jwtKey: env.CLERK_JWT_KEY,
  });
}

type AuthenticateRequestFn = ReturnType<typeof createClerkClient>['authenticateRequest'];

/** The subset of a Clerk user this module reads. */
export type ClerkUserLike = {
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
};
type ClerkUserLookupFn = (env: AdminEnv, userId: string) => Promise<ClerkUserLike>;

/** Vitest-only overrides: no vi.mock, no network. */
let authenticateRequestOverride: AuthenticateRequestFn | null = null;
let clerkUserLookupOverride: ClerkUserLookupFn | null = null;

export function __setAuthenticateRequestForTest(fn: AuthenticateRequestFn | null): void {
  authenticateRequestOverride = fn;
}
export function __setClerkUserLookupForTest(fn: ClerkUserLookupFn | null): void {
  clerkUserLookupOverride = fn;
}

async function lookupClerkUser(env: AdminEnv, userId: string): Promise<ClerkUserLike> {
  if (clerkUserLookupOverride) return clerkUserLookupOverride(env, userId);
  return (await clerkClient(env).users.getUser(userId)) as ClerkUserLike;
}

/** The primary email address, only if Clerk marks it verified. Null otherwise. */
export function verifiedPrimaryEmail(user: ClerkUserLike): string | null {
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  return primary && primary.verification?.status === 'verified' ? primary.emailAddress : null;
}

/** `fva[1] >= 0` means a second factor was verified in this session. */
export function hasSecondFactor(claims: unknown): boolean {
  const fva = (claims as { fva?: unknown } | null | undefined)?.fva;
  return Array.isArray(fva) && typeof fva[1] === 'number' && fva[1] >= 0;
}

function displayNameOf(user: ClerkUserLike, email: string | null): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || (email ? email.split('@')[0]! : null);
}

export async function authenticateOperator(request: Request, env: AdminEnv): Promise<AuthResult> {
  if (isDevOperatorAllowed(env)) {
    const dev = request.headers.get(DEV_OPERATOR_HEADER)?.trim().toLowerCase();
    if (dev) {
      const resolved = await env.PMS_OPS.resolveOperator({
        clerkUserId: `dev:${dev}`,
        verifiedEmail: dev,
        displayName: dev.split('@')[0] ?? dev,
      });
      return resolved.ok ? { operator: resolved.operator } : deny(403, 'not_an_operator');
    }
  }

  if (!clerkConfigured(env)) {
    return deny(401, 'unauthenticated', 'Authentication unavailable: Clerk is not configured.');
  }
  const parties = authorizedParties(env);
  if (parties.length === 0) {
    return deny(401, 'unauthenticated', 'Authorized parties not configured.');
  }

  const options: Parameters<AuthenticateRequestFn>[1] = {
    jwtKey: env.CLERK_JWT_KEY,
    authorizedParties: parties,
  };
  const state = authenticateRequestOverride
    ? await authenticateRequestOverride(request, options)
    : await clerkClient(env).authenticateRequest(request, options);
  if (!state.isAuthenticated) return deny(401, 'unauthenticated', 'Invalid or missing session.');
  const auth = state.toAuth();
  const userId = auth?.userId;
  if (!userId) return deny(401, 'unauthenticated', 'Invalid or missing session.');

  if (!hasSecondFactor(auth.sessionClaims)) {
    return deny(401, 'mfa_required', 'Verify a second factor to use the Ops Console.');
  }

  // Known operator: one RPC, no Clerk call.
  const byId = await env.PMS_OPS.resolveOperator({ clerkUserId: userId, verifiedEmail: null });
  if (byId.ok) return { operator: byId.operator };

  // Not linked yet: fetch the Clerk user once and pass its VERIFIED primary email, nothing else.
  let user: ClerkUserLike;
  try {
    user = await lookupClerkUser(env, userId);
  } catch {
    return deny(502, 'identity_unavailable', 'Could not read the signed-in user.');
  }
  const email = verifiedPrimaryEmail(user);
  if (email === null) return deny(403, 'not_an_operator');
  const linked = await env.PMS_OPS.resolveOperator({
    clerkUserId: userId,
    verifiedEmail: email,
    displayName: displayNameOf(user, email),
  });
  return linked.ok ? { operator: linked.operator } : deny(403, 'not_an_operator');
}
