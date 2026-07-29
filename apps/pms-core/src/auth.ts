import { createClerkClient } from '@clerk/backend';
import { resolveOrgStub } from '@hospai/tenant-router';
import type { Permission } from '@hospai/contracts';
import { isDevActorAllowed, type PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import { getOrg, getProperty } from './registry.js';

const DEV_ACTOR_HEADER = 'x-dev-actor';

export type Actor = { userId: string; source: 'clerk' | 'dev' };

function unauthorized(message: string): Response {
  return Response.json({ error: 'unauthenticated', message }, { status: 401 });
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

function authorizedParties(env: PmsEnv): string[] {
  const raw = env.CLERK_AUTHORIZED_PARTIES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

type AuthenticateRequestFn = ReturnType<typeof createClerkClient>['authenticateRequest'];

/** Vitest-only override — avoids vi.mock in the Workers pool. */
let authenticateRequestOverride: AuthenticateRequestFn | null = null;

export function __setAuthenticateRequestForTest(fn: AuthenticateRequestFn | null): void {
  authenticateRequestOverride = fn;
}

async function authenticateClerkSession(
  request: Request,
  env: PmsEnv,
): Promise<Awaited<ReturnType<AuthenticateRequestFn>>> {
  const parties = authorizedParties(env);
  const options = {
    jwtKey: env.CLERK_JWT_KEY,
    ...(parties.length > 0 ? { authorizedParties: parties } : {}),
  };
  if (authenticateRequestOverride) {
    return authenticateRequestOverride(request, options);
  }
  return clerkClient(env).authenticateRequest(request, options);
}

/** Verified Clerk session or gated dev header. Dev path wins when both flags + header present. */
export async function resolveActor(request: Request, env: PmsEnv): Promise<Actor | Response> {
  if (isDevActorAllowed(env)) {
    const dev = request.headers.get(DEV_ACTOR_HEADER);
    if (dev?.startsWith('user_')) return { userId: dev, source: 'dev' };
  }

  if (!clerkConfigured(env)) {
    return unauthorized(
      'Authentication unavailable. Configure Clerk secrets or enable local dev actor (HOSPAI_UNSAFE_LOCAL + HOSPAI_ALLOW_DEV_ACTOR).',
    );
  }

  const state = await authenticateClerkSession(request, env);

  if (!state.isAuthenticated) {
    return unauthorized('Invalid or missing session.');
  }

  const auth = state.toAuth();
  const userId = auth?.userId;
  if (!userId) {
    return unauthorized('Invalid or missing session.');
  }

  return { userId, source: 'clerk' };
}

/** D1 org must exist; actor must be in OrgDO member table. Unknown org or non-member → 404. */
export async function requireOrgMember(
  env: PmsEnv,
  orgId: string,
  userId: string,
): Promise<Response | null> {
  const orgRow = await getOrg(env, orgId);
  if (!orgRow) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const role = await org.getMemberRole(userId);
  if (!role) {
    // Same status + body as unknown org — do not distinguish (org existence oracle).
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

/** Resolve property org from D1, then membership check. Unknown property → 404. */
export async function requirePropertyOrgMember(
  env: PmsEnv,
  propertyId: string,
  userId: string,
): Promise<Response | null> {
  const property = await getProperty(env, propertyId);
  if (!property) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return requireOrgMember(env, property.orgId, userId);
}

/** Caller must have confirmed org/property exists in D1 via resolveTenant. */
export async function requirePermission(
  env: PmsEnv,
  orgId: string,
  propertyId: string | null,
  userId: string,
  permission: Permission,
): Promise<Response | null> {
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const result = await org.assertPermission({ userId, propertyId, permission });
  if (result.ok) return null;
  if (result.error === 'not_member') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ error: 'forbidden', permission }, { status: 403 });
}
