# Clerk authentication (Phase 0 — identity gate)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §13, §14; tenancy spine spec; entitlements spec

## Purpose

Replace the dev-header-only identity stub with **verified Clerk sessions** at the Worker edge, while keeping OrgDO as the sole authorization plane. This closes the last Phase 0 **correctness** gap: every route today trusts `X-Dev-Actor` when unsafe-local flags are on, and returns 401 otherwise — there is no production auth path.

Clerk answers: *who is this caller?* OrgDO answers: *what may they do in this org?*

## Decided question: Clerk Organizations vs OrgDO membership

**OrgDO `member` is authoritative. Clerk Organizations are unused.**

§13 already decided this; this spec makes it operational:

| Question | Answer |
|---|---|
| Where does org membership live? | OrgDO `member(user_id, role, created_at)` |
| Are Clerk Organizations enabled? | **No.** Do not enable in the Clerk dashboard. If enabled accidentally, ignore — no reads, no webhooks, no sync. |
| What if Clerk org membership and OrgDO disagree? | **OrgDO wins.** Clerk org state is irrelevant to this system. |
| What does Clerk provide? | Authentication only: verified `sub` → `userId`, session validity, MFA/credentials/SAML handshake |
| What about ARCHITECTURE's `org_id` JWT claim? | **Deferred.** Phase 0 verifies identity (`sub`) only. Custom session claims (`org_id`, `entitlement_version`) land with org-switching UI and observability — not in this slice. |
| How is active org chosen? | Route param (`/v1/orgs/:orgId/…`) or registry lookup (`property.org_id` from D1) — **then validated** against OrgDO membership. The route is a *hint*, not proof. |

**Why not Clerk orgs.** Two partially-authoritative membership systems with webhook-delayed revocation in an industry with high staff turnover and shared workstations. Revoking access must be **one write to OrgDO**, effective immediately (§13). SCIM, invitations, and org switching are Phase 0/1 work **on OrgDO**, not Clerk.

**Standing rule (unchanged):** property roles never live in Clerk — not as metadata, not temporarily.

## Scope

**In**

- `@clerk/backend` in `pms-core` Worker: networkless JWT verification via `CLERK_JWT_KEY` (PEM)
- Env bindings: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`
- `resolveActor(request, env)` — Clerk session **or** gated `X-Dev-Actor` (tests/local only)
- Map verified Clerk `sub` → `userId` (Clerk user IDs are `user_…` — matches existing convention)
- OrgDO: `getMemberRole(userId)` → `'owner' | 'admin' | 'staff' | null`
- **`createOrg`** insert-only registry write; `POST /v1/orgs` returns **409** on duplicate `orgId` (prerequisite — see **Org creation**)
- **`getOrg`** D1 existence check before any OrgDO RPC in membership paths (prevents DO materialization on unknown orgs)
- Edge: **membership check** on every org-scoped and property-scoped `/v1/*` route (see **Route matrix**)
- HTTP **404** when org unknown or caller not a member (same response — no existence oracle); **401** when unauthenticated
- Vitest: existing 227 tests unchanged (dev-actor path); new tests for membership enforcement + Clerk path (mocked verify)

**Out**

- Clerk Organizations feature, org webhooks, Clerk role metadata
- Custom JWT claims (`org_id`, `entitlement_version`) — entitlements spec already defers token claims
- Invitation UI, org switching UI, SCIM receiver (Phase 0/1 OrgDO work, not Clerk)
- Property-scoped RBAC (Phase 1)
- Frontend / SPA Clerk SDK setup (separate repo; this slice is Worker-only)
- Session refresh, sign-in redirects (SPA concern; Worker accepts `Authorization: Bearer <session_jwt>`)

## Current state

```ts
requireDevActor() → X-Dev-Actor header → startsWith('user_')
```

- `POST /v1/orgs/:orgId/properties` takes `orgId` from the path with **no membership check**
- `GET /v1/orgs/:orgId/properties` — same hole
- `GET /v1/properties/:propertyId` — auth only; no org membership check
- `ensureMember(actor, 'owner')` runs on org create and provision, but nothing **reads** membership at the edge
- **`POST /v1/orgs` is an org takeover** (see **Org creation — prerequisite fix**): `upsertOrg` silently no-ops when the org exists, then `ensureMember(actor, 'owner')` runs unconditionally — any authenticated user who knows an `orgId` becomes `owner`. This defeats every membership check the slice adds, because Mallory passes `requireOrgMember` as a legit member she inserted herself.

The entitlement plane gates on `orgId` from the route. Jurisdiction routing uses D1 registry. Both assume the actor belongs to the org — they don't verify it.

## Org creation — prerequisite fix (blocker)

**This fix ships in the same slice as Clerk.** Membership enforcement is only as strong as the write path that populates `member`; an open create path makes every downstream check agree with the attacker.

### Current bug

```ts
await upsertOrg(env, body.orgId, body.name);   // returns early if org exists — no error
const org = resolveOrgStub(env.ORG_DO, { orgId: body.orgId });
await org.ensureMember(actor, 'owner');        // runs unconditionally
```

Demonstrated: Alice creates `victimorg`; Mallory `POST /v1/orgs` with the same `orgId` → **201**, Mallory inserted as `owner`, can provision properties in Alice's org. `orgId` is caller-supplied and tenant-visible (every route path), so guessing is realistic.

### Fix

Replace silent upsert on the create route with an **insert-only** registry write that reports whether the row was created:

```ts
/** Insert org row + seed Starter subscription. Returns false if org_id already exists. */
export async function createOrg(env: PmsEnv, orgId: string, name: string): Promise<boolean> {
  validateTenantId(orgId);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const existing = await env.PLATFORM_DB.prepare(`SELECT org_id FROM org WHERE org_id = ?`)
    .bind(orgId)
    .first();
  if (existing) return false;
  await env.PLATFORM_DB.prepare(
    `INSERT INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  )
    .bind(orgId, name, Date.now())
    .run();
  await seedSubscription(env, orgId, 'starter');
  return true;
}
```

Route handler:

```ts
const created = await createOrg(env, body.orgId, body.name);
if (!created) {
  return json({ error: 'org_exists' }, 409);
}
const org = resolveOrgStub(env.ORG_DO, { orgId: body.orgId });
await org.ensureMember(actor, 'owner');   // only on genuine creation
return json({ orgId: body.orgId, name: body.name }, 201);
```

`upsertOrg` remains for **internal** provisioning paths (`provisionProperty` sync) where idempotent org row ensure is correct — but **`POST /v1/orgs` must not call it**. **Every HTTP route that reaches `provisionProperty` must call `requireOrgMember` in the handler first** — not inside the helper. `provisionProperty` still runs `upsertOrg` + `ensureMember`; without the edge gate that is the same privilege-granting write behind an unauthenticated or unscoped door. **`requireOrgMember` gates the handler; helpers assume the caller already authorized.**

Adding members to an existing org is **out of scope** — Phase 1 invitation/SCIM work with its own authorized write path.

### Bootstrap semantics change

With the D1 existence gate, `POST /v1/orgs/:orgId/properties` for a **brand-new** org returns **404** — the org must exist in D1 first (via `POST /v1/orgs`). That is correct; the old behaviour where `upsertOrg` inside `provisionProperty` created the org implicitly is retired for HTTP. Internal/test callers may still use `provisionProperty` or `seedSubscription` + `ensureMember` directly. Verify the existing suite after the membership gate lands — tests that hit the property route without a D1 org row will 404; tests that relied on the property route *creating* the org will break.



## Auth resolution

```ts
type Actor = { userId: string; source: 'clerk' | 'dev' };

async function resolveActor(request: Request, env: PmsEnv): Promise<Actor | Response> {
  // 1. Dev path (vitest + local only) — unchanged gate
  if (isDevActorAllowed(env)) {
    const dev = request.headers.get('x-dev-actor');
    if (dev?.startsWith('user_')) return { userId: dev, source: 'dev' };
  }

  // 2. Production path — Clerk session JWT
  const state = await clerk.authenticateRequest(request, {
    jwtKey: env.CLERK_JWT_KEY,
    authorizedParties: env.CLERK_AUTHORIZED_PARTIES?.split(',') ?? [],
  });
  if (!state.isAuthenticated) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = state.toAuth()?.userId;
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  return { userId, source: 'clerk' };
}
```

**Precedence:** when unsafe-local + dev-actor flags are on **and** `X-Dev-Actor` is present, dev path wins. This keeps all existing integration tests on the header without Clerk mocks. Production deploys omit both flags; Clerk is the only path.

**Why this precedence is safe:** `assertEnvSafeForRequest` returns **500** if `HOSPAI_ALLOW_DEV_ACTOR=1` without `HOSPAI_UNSAFE_LOCAL=1` — the dev path cannot activate in a mis-deployed production config. Do not "simplify" ordering by checking dev-actor before the safety gate; the gate must run first on every request.

**Token transport:** `Authorization: Bearer <session_jwt>` (SPA). `__session` cookie support optional if same-origin; not required for Phase 0 Worker slice.

**Misconfiguration:** missing `CLERK_*` secrets when dev-actor is disabled → 401 on all `/v1/*` (fail closed), not 500. `assertEnvSafeForRequest` unchanged.

## Membership enforcement

**D1 existence gate (required).** Any RPC to OrgDO instantiates the object; the constructor runs migrations and creates `__meta` storage. Without the gate, a membership check against a nonexistent `orgId` would materialize a fully-migrated empty OrgDO on every probe. An authenticated user iterating `orgId` values would create one DO per attempt; `validateTenantId` bounds identifier *shape*, not *count*.

Confirm the org row exists in **Platform D1** before touching OrgDO. Property routes already load `property.org_id` from D1; org-scoped routes add one indexed `SELECT org_id FROM org WHERE org_id = ?`.

**404 for both unknown org and non-member.** Returning 403 for a known org the caller doesn't belong to leaks org existence (authenticated enumeration oracle). Both cases return **404** `{ error: 'not_found' }` — indistinguishable to the caller. Debug detail belongs in logs, not status codes.

**Absent org (no D1 row):** `getOrg` returns null → 404 with **no OrgDO RPC** — the D1 gate prevents materialization.

**Known org, non-member:** D1 row exists → `getMemberRole` RPC runs → OrgDO may materialize. That is unavoidable without a D1 membership mirror; only the status code is unified to 404.

```ts
async function requireOrgMember(
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
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}
```

OrgDO implementation:

```ts
async getMemberRole(userId: string): Promise<'owner' | 'admin' | 'staff' | null> {
  const row = this.ctx.storage.sql
    .exec(`SELECT role FROM member WHERE user_id = ?`, userId)
    .toArray()[0] as { role: string } | undefined;
  return row ? (row.role as 'owner' | 'admin' | 'staff') : null;
}
```

Phase 0 does **not** enforce role hierarchy on routes — any member (`owner | admin | staff`) passes. Role-based restrictions are Phase 1 RBAC. Org **creation** calls `ensureMember(actor, 'owner')` **only when `createOrg` returns true** (see **Org creation**).

## Route matrix

| Route | Auth | Gate |
|---|---|---|
| `POST /v1/orgs` | required | **`createOrg` insert-only** — duplicate `orgId` → **409**; `ensureMember(actor, 'owner')` only on insert. Highest-privilege write in the system. |
| `POST /v1/orgs/:orgId/properties` | required | D1 org exists → actor ∈ org `:orgId` |
| `GET /v1/orgs/:orgId/properties` | required | D1 org exists → actor ∈ org `:orgId` |
| `GET /v1/properties/:propertyId` | required | D1 `property.org_id` → actor ∈ that org |
| `GET /v1/registry/properties/:propertyId` | required | D1 `property.org_id` → actor ∈ that org |

Property routes load org from **Platform D1** (routing SoR), then check OrgDO membership — same pattern as entitlement resolution.

**Handler ordering (normative).** For `POST /v1/orgs/:orgId/properties`: `resolveActor` → `requireOrgMember` → kill-switch → entitlement → `provisionProperty`. Membership **before** any helper that calls `upsertOrg` / `ensureMember`. Never move the check inside `provisionProperty` or after entitlement resolution that assumes org access.

## Wrangler / env

```jsonc
// secrets (wrangler secret put / .dev.vars — never top-level vars)
// CLERK_SECRET_KEY
// CLERK_PUBLISHABLE_KEY
// CLERK_JWT_KEY          — PEM public key for networkless verify
// CLERK_AUTHORIZED_PARTIES — comma-separated azp allowlist (SPA origin)
```

Vitest bindings: omit `CLERK_*`; keep `HOSPAI_UNSAFE_LOCAL=1` + `HOSPAI_ALLOW_DEV_ACTOR=1`. No Clerk mock needed for the existing suite.

## Package

Add to `apps/pms-core` (pin exact version at implementation — do not merge major and API shape):

```json
"@clerk/backend": "3.13.2"
```

Pinned at implementation. v3 exposes `state.isAuthenticated` and `state.toAuth()?.userId` on `authenticateRequest` — confirm if upgrading.

Use `jwtKey` for zero-network verification in the Workers isolate.

## File layout

| File | Role |
|---|---|
| `apps/pms-core/src/auth.ts` | `resolveActor`, `requireOrgMember`, Clerk client factory |
| `apps/pms-core/src/env.ts` | `CLERK_*` on `PmsEnv` |
| `apps/pms-core/src/registry.ts` | `createOrg` (insert-only), `getOrg`; keep `upsertOrg` for internal provision paths |
| `apps/pms-core/src/index.ts` | replace `requireDevActor` with `resolveActor`; `createOrg` + membership checks per route matrix |
| `apps/pms-core/src/org-do.ts` | `getMemberRole` |
| `apps/pms-core/test/auth.spec.ts` | membership 404/404, cross-org denial, org takeover 409, absent-org DO gate, mocked Clerk path |

## Success tests

1. **Existing suite green** — all 227+ tests pass unchanged via dev-actor path.
2. **Org takeover blocked** — Alice `POST /v1/orgs` with `orgId` X → **201**; Mallory `POST /v1/orgs` with same `orgId` → **409** `{ error: 'org_exists' }`; Mallory **not** in `listMembers`; Mallory `POST /v1/orgs/X/properties` → **404**.
3. **Cross-org property create denied** — `user_a` creates org A; `user_b` (member of org B only) `POST /v1/orgs/A/properties` → **404**.
4. **Non-member property read denied** — provision as `user_a`; `GET /v1/properties/:id` as `user_b` → **404**.
5. **Member property read allowed** — same property, `user_a` → **200**.
6. **Clerk path (mocked)** — with dev flags off and `authenticateRequest` mocked to return `userId`, route succeeds when member; **401** when mock returns unauthenticated.
7. **Org list requires membership** — `GET /v1/orgs/:orgId/properties` as non-member → **404** (same body as unknown org).
8. **Absent org (no D1 row) does not materialize OrgDO** — GET + POST probe → **404**; `listDurableObjectIds(ORG_DO)` count unchanged. (Calling `listMembers()` on the stub afterward **will** materialize — that is not the HTTP path.)
9. **Non-member indistinguishable from absent org** — existing org + stranger vs absent org both **404** `{ error: 'not_found' }`.
10. **Org create still works** — `POST /v1/orgs` with dev actor → creator in `listMembers` as `owner`.

## Deployment ordering

This slice is **Worker-only**. SPA Clerk SDK integration is a separate deploy in the frontend repo and should follow this Worker slice (or ship together). The SPA sends `Authorization: Bearer`; the Worker verifies.

**Consumer-before-producer rule** (from queues spec) does not apply here — auth is edge-only.

## Non-goals reminder

Observability tagging (`org_id`, `actor` on spans) is the natural **next** slice after Clerk — instrument once with real `userId`. LaneGuard, migration Workflow, and property RBAC remain deferred per build order §14.

## Relationship to §13 token claims

ARCHITECTURE lists future session claims: `user_id, org_id, entitlement_version, session_id`. This slice delivers **`user_id` only** (from Clerk `sub` after verify). `org_id` in the token would duplicate OrgDO membership and create a second source of truth — **do not add** until org-switching UX defines how active org is selected, and even then treat it as a hint validated against OrgDO, not as authorization.

`entitlement_version` stays deferred per entitlements spec; edge continues to resolve from OrgEntitlementDO/KV.
