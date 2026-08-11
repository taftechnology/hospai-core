import { createClerkClient } from '@clerk/backend';
import type { PmsEnv } from './env.js';

export type ClerkEmailLookupResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'no_such_user' | 'email_ambiguous' | 'clerk_unreachable' };

export type DirectoryEntry = { displayName: string | null; email: string | null };

export type DirectoryLookupResult =
  | { ok: true; byUserId: Map<string, DirectoryEntry> }
  | { ok: false; error: 'clerk_unreachable' };

type EmailLookupFn = (env: PmsEnv, email: string) => Promise<ClerkEmailLookupResult>;
type DirectoryLookupFn = (env: PmsEnv, userIds: string[]) => Promise<DirectoryLookupResult>;

/** Vitest-only override — avoids vi.mock in the Workers pool. */
let emailLookupOverride: EmailLookupFn | null = null;
let directoryLookupOverride: DirectoryLookupFn | null = null;

export function __setLookupUserIdByEmailForTest(fn: EmailLookupFn | null): void {
  emailLookupOverride = fn;
}

export function __setLookupDirectoryByUserIdsForTest(fn: DirectoryLookupFn | null): void {
  directoryLookupOverride = fn;
}

function clerkConfigured(env: PmsEnv): boolean {
  return Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

function clerkClient(env: PmsEnv) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY!,
    publishableKey: env.CLERK_PUBLISHABLE_KEY!,
    jwtKey: env.CLERK_JWT_KEY,
  });
}

export async function lookupUserIdByEmail(
  env: PmsEnv,
  email: string,
): Promise<ClerkEmailLookupResult> {
  if (emailLookupOverride) return emailLookupOverride(env, email);

  if (!clerkConfigured(env)) {
    return { ok: false, error: 'clerk_unreachable' };
  }

  try {
    const { data } = await clerkClient(env).users.getUserList({
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

/**
 * Per-request directory enrichment. Result union — never throws.
 * Unconfigured secrets and SDK failures → clerk_unreachable.
 */
export async function lookupDirectoryByUserIds(
  env: PmsEnv,
  userIds: string[],
): Promise<DirectoryLookupResult> {
  if (directoryLookupOverride) return directoryLookupOverride(env, userIds);

  if (userIds.length === 0) {
    return { ok: true, byUserId: new Map() };
  }

  if (!clerkConfigured(env)) {
    return { ok: false, error: 'clerk_unreachable' };
  }

  try {
    const byUserId = new Map<string, DirectoryEntry>();
    // Clerk getUserList accepts up to 100 user ids per call — chunk if needed.
    const chunkSize = 100;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const { data } = await clerkClient(env).users.getUserList({
        userId: chunk,
        limit: chunk.length,
      });
      for (const u of data) {
        const email =
          u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
          u.emailAddresses[0]?.emailAddress ??
          null;
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        byUserId.set(u.id, {
          displayName: name.length > 0 ? name : null,
          email,
        });
      }
    }
    return { ok: true, byUserId };
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
