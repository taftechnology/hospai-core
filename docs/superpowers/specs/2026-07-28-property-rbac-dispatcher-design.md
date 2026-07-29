# Property-scoped RBAC + typed command dispatcher (Phase 1 entry)

**Date:** 2026-07-28  
**Status:** Approved  
**Sources:** ARCHITECTURE.md §1 (three planes), §4.3 (KV projection — deferred), §13 (OrgDO authority), §14 (Phase 1); [Clerk auth](./2026-07-28-clerk-auth-design.md); [entitlements + kill-switch](./2026-07-28-entitlements-killswitch-design.md); [inventory whole-stack seam](./2026-07-28-pms-inventory-stack-design.md); command catalog `inventory.add_room_type`

## Purpose

Close the first **Phase 1 authorization gap**: OrgDO stores roles (`owner` | `admin` | `staff`) and the edge verifies membership, but **never checks what the role may do**. Today `staff` and `owner` are equivalent on every route — including `POST /v1/properties/:propertyId/room-types`.

This slice adds:

1. A **closed `Permission` union** on the command catalog (same pattern as `FeatureKey`).
2. **Property-scoped role resolution** in OrgDO (org role + optional per-property override).
3. A **single HTTP dispatcher** with a **frozen gate order** so auth, kill-switch, tenant resolution, permission, and entitlement cannot be reordered per route.
4. **CI drift checks** (`check:permissions`) so catalog entries and route registry cannot ship without valid permissions.
5. **Proof:** extend the inventory seam — `staff` → **403**, `owner` → **201** on the same command.

Clerk remains authentication-only (§13). All authorization stays in OrgDO.

## Why now

| Factor | State |
|---|---|
| Membership at edge | Done — `requireOrgMember` / `requirePropertyOrgMember` (404 oracle) |
| Role stored | OrgDO `member(user_id, role)` — org-wide only |
| Property-scoped roles | **Not modeled** — ARCHITECTURE §13 requires them; Clerk auth spec explicitly deferred |
| Permission on catalog | **Absent** — `CommandEntry` has `entitlement` only |
| Gate order | **Ad hoc** — each route in `v1-handler.ts` calls gates inline in varying order |
| Entitlement before permission | **Wrong order today** — once permission lands, it must run **before** entitlement so a denied user gets **403**, not **402** (entitlement leak) |
| Phase 0 seam | Proves stack through `inventory.add_room_type` with **owner** actor only |

## Decided questions

| Question | Answer |
|---|---|
| Where do permissions live? | `packages/contracts` — closed union + role→grant matrix (like `FEATURE_KEYS`) |
| Where is authorization evaluated? | **OrgDO** — edge calls OrgDO RPC **only after D1 confirms tenant exists**; token carries no permissions (§13) |
| Org-wide vs property-scoped role? | **Effective role:** `property_member` row if present for `(userId, propertyId)`, else fall back to org `member.role` |
| Non-member vs member-without-permission? | Non-member → **404** (unchanged oracle). Member lacking permission → **403** `{ error: 'forbidden', permission }` |
| Gate order at HTTP edge? | **Frozen:** auth → kill-switch (when route is entitlement-gated) → D1 tenant resolve → permission → entitlement → handler |
| Kill-switch vs permission order? | **Kill-switch first** — global KV read (`kill:${featureKey}`), no tenant input; sheds load before OrgDO hop |
| First permission-gated command? | `inventory.add_room_type` → `inventory:write`; `staff` denied, `owner`/`admin` allowed |
| `staff` vs `inventory:write`? | **Correct split** — front desk books; it does not define room types |
| `shell:internal` on owner? | **No** — platform-only; granted to no role; `PLATFORM_ONLY_PERMISSIONS` + CI |
| `owner` auto-grants future permissions? | **Yes, intentional** — owner list is all grantable permissions (excludes platform-only); new union members land on owner by default |
| DO re-check permission? | **Deferred** — edge gate proves the plane; PropertyDO assert is fast follow-on |
| KV permission projection (§4.3)? | **Out of scope** |
| Property-group scoping? | **Out of scope** |
| Module manifest permission contributions? | **Out of scope** — static matrix in contracts for Phase 1 |
| UI / Clerk org roles? | **Out of scope** |

## Three planes — gate order (normative)

ARCHITECTURE §1: a gated capability passes **entitlement AND permission AND flag** independently. At the HTTP edge:

```
1. resolveActor                              → 401 unauthenticated
2. kill-switch (when route is entitlement-gated) → 503 empty body
   — global KV read: kill:${featureKey}, cacheTtl 60, no tenant input
   — skipped on read-only / bootstrap / dev routes
3. resolve tenant (D1 only — no OrgDO stub yet) → 404 not_found
4. membership + permission (OrgDO assertPermission) → 404 / 403
5. entitlement snapshot (per-org)            → 402 / 503
6. handler → DO command
```

**Permission before entitlement** is mandatory: a `staff` user must not learn whether the org lacks `pms.core` when denied for lacking `inventory:write`.

**Kill-switch before permission** is mandatory: the switch is global and tenant-independent — a 503 is identical for every org and user. Moving it earlier sheds load before the OrgDO round-trip; it does not leak org-specific entitlement state (unlike step 5).

### D1-before-stub invariant (normative)

**No OrgDO stub is resolved until D1 confirms the tenant exists.**

Today `requireOrgMember` checks D1 (`getOrg`) before `resolveOrgStub` ([auth.ts:91](apps/pms-core/src/auth.ts:91)). Every stub call runs `migrateSql` inside `blockConcurrencyWhile` ([org-do.ts:80](apps/pms-core/src/org-do.ts:80)) — constructing a DO writes the full schema to persistent, billed storage.

`resolveTenant` in the dispatcher **must** perform the D1 lookup and return 404 before any OrgDO RPC:

| Scope | D1 check | `orgId` source |
|---|---|---|
| `org` | `getOrg(env, orgId)` | route param |
| `property` | `getProperty(env, propertyId)` | property row → `orgId` |

Property routes get org id from the property row (same as today). Org-scoped routes need an explicit `getOrg` gate — dropping it reintroduces the ghost-DO problem from the auth round.

`requirePermission` does **not** replace the D1 gate; it runs **after** `resolveTenant` succeeds.

## Permission model

### Closed union

New file: `packages/contracts/src/permissions.ts`

```ts
/** Never granted to any role; never on HTTP route registry. DO/workflow only. */
export const PLATFORM_ONLY_PERMISSIONS = ['shell:internal'] as const;
export type PlatformOnlyPermission = (typeof PLATFORM_ONLY_PERMISSIONS)[number];

/** Org-scoped — assertPermission rejects when propertyId != null. */
export const ORG_SCOPED_PERMISSIONS = [
  'org:read',
  'org:manage',
  'property:provision',
] as const;

/** Property-scoped — require propertyId != null at assertPermission. */
export const PROPERTY_SCOPED_PERMISSIONS = [
  'property:read',
  'inventory:read',
  'inventory:write',
  'inventory:configure',
  'reservations:read',
  'reservations:write',
  'guests:read',
  'guests:write',
  'guests:erase',
  'rates:read',
  'rates:write',
  'folio:read',
  'folio:post',
  'folio:adjust',
  'channels:read',
  'channels:configure',
  'staff:read',
  'staff:write',
  'housekeeping:read',
  'housekeeping:write',
  'night_audit:run',
  'config:write',
] as const;

export const PERMISSIONS = [
  ...ORG_SCOPED_PERMISSIONS,
  ...PROPERTY_SCOPED_PERMISSIONS,
  ...PLATFORM_ONLY_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type OrgScopedPermission = (typeof ORG_SCOPED_PERMISSIONS)[number];
export type PropertyScopedPermission = (typeof PROPERTY_SCOPED_PERMISSIONS)[number];

export type OrgRole = 'owner' | 'admin' | 'staff';

/** All grantable permissions — owner receives this set (auto-includes future union members). */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter(
  (p) => !(PLATFORM_ONLY_PERMISSIONS as readonly string[]).includes(p),
) as readonly Exclude<Permission, PlatformOnlyPermission>[];

export const ROLE_GRANTS: Record<OrgRole, readonly Permission[]> = {
  owner: GRANTABLE_PERMISSIONS,
  admin: [
    'org:read',
    'property:provision',
    'property:read',
    'inventory:read',
    'inventory:write',
    'inventory:configure',
    'reservations:read',
    'reservations:write',
    'guests:read',
    'guests:write',
    'guests:erase',
    'rates:read',
    'rates:write',
    'folio:read',
    'folio:post',
    'folio:adjust',
    'channels:read',
    'channels:configure',
    'staff:read',
    'staff:write',
    'housekeeping:read',
    'housekeeping:write',
    'night_audit:run',
    'config:write',
  ],
  staff: [
    'org:read',
    'property:read',
    'inventory:read',
    'reservations:read',
    'reservations:write',
    'guests:read',
    'guests:write',
    'rates:read',
    'folio:read',
    'folio:post',
    'housekeeping:read',
    'housekeeping:write',
  ],
};
```

**Folio split (reversibility, not read/write):** `folio:post` — routine charge posting (staff). `folio:adjust` — void, refund, transfer (admin/owner). Front-desk cashiering requires post; fraud vectors stay elevated.

**Guest erasure split:** `guests:erase` — crypto-shred, irreversible — admin and owner only. Staff retains `guests:write` for profile edits.

Extend `CommandEntry`:

```ts
import type { Permission } from '../permissions.js';

export type CommandEntry = {
  // ...existing fields...
  permission: Permission;
};
```

**Type guard:** `permission: Permission` — not `Permission | string`. CI regex scan mirrors `check:entitlements`.

### Catalog permission assignment (normative)

Every `COMMAND_CATALOG` entry receives a `permission` field in the same PR:

| Catalog prefix / id | Permission |
|---|---|
| `shell.*` | `shell:internal` |
| `inventory.add_room_type`, `inventory.update_room_type`, `inventory.delete_room_type` | `inventory:write` |
| `config.put_domain` | `inventory:configure` |
| `restrictions.*`, `rates.upsert_day`, `availability.book` | `rates:write` |
| `reservations.*` (mutations) | `reservations:write` |
| `guests.create`, `guests.update` | `guests:write` |
| `guests.erase` | `guests:erase` |
| `folio.add_item`, routine posts | `folio:post` |
| `folio.*` void/refund/transfer/split (non-routine) | `folio:adjust` |
| `channels.*` | `channels:configure` |
| `staff.*`, `housekeeping.staff_*` | `staff:write` |
| `housekeeping.assign`, room status updates | `housekeeping:write` |
| `night_audit.run` | `night_audit:run` |
| `audit.append` | `shell:internal` |

Semantic review is human; CI enforces presence, union membership, grant coverage, and platform-only rules.

## OrgDO — property-scoped roles

### Schema (migration v4)

Add to `packages/do-runtime/src/org-migrations.ts` (migration version 4):

```sql
CREATE TABLE property_member (
  user_id     TEXT NOT NULL,
  property_id TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, property_id),
  CHECK (role IN ('owner', 'admin', 'staff'))
);
```

Additive DDL, no FK — avoids the `data_key` rebuild trap. Regenerate checked-in SQL:

```bash
pnpm generate:ddl && pnpm check:ddl
```

(`scripts/property-ddl.mjs` covers org migrations; v4 adds a new generated file under `migrations/do-org/`.)

Org-wide `member` table unchanged. `property_member` is optional per user — when absent, org role applies.

### Effective role resolution

```ts
async getEffectiveRole(
  userId: string,
  propertyId: string | null,
): Promise<OrgRole | null> {
  const orgRole = await this.getMemberRole(userId);
  if (!orgRole) return null;
  if (!propertyId) return orgRole;

  const row = /* SELECT role FROM property_member WHERE user_id = ? AND property_id = ? */;
  return (row?.role as OrgRole | undefined) ?? orgRole;
}
```

Property-scoped assignment narrows or elevates relative to org role for that property only. **Scope partition:** org-scoped permissions must use `propertyId: null` at the edge — see `assertPermission` below. Without this, org `staff` + `property_member` role `owner` would inherit `org:manage` on property routes.

### Permission check RPC

```ts
async assertPermission(input: {
  userId: string;
  propertyId: string | null;
  permission: Permission;
}): Promise<
  | { ok: true; role: OrgRole }
  | { ok: false; error: 'not_member' | 'forbidden' | 'scope_mismatch' }
> {
  if (isOrgScopedPermission(input.permission) && input.propertyId !== null) {
    return { ok: false, error: 'scope_mismatch' };
  }
  if (isPropertyScopedPermission(input.permission) && input.propertyId === null) {
    return { ok: false, error: 'scope_mismatch' };
  }

  const role = await this.getEffectiveRole(input.userId, input.propertyId);
  if (!role) return { ok: false, error: 'not_member' };
  const grants = ROLE_GRANTS[role];
  if (!grants.includes(input.permission)) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, role };
}
```

Edge maps `scope_mismatch` → **403** `{ error: 'forbidden', permission }` (same body as missing grant — no oracle).

`ROLE_GRANTS` is imported from `@hospai/contracts` inside OrgDO.

### Edge helper

New in `apps/pms-core/src/auth.ts`:

```ts
/** Caller must have already confirmed org/property exists in D1 via resolveTenant. */
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
```

Membership is subsumed by `assertPermission`, but **D1 tenant existence is not** — `resolveTenant` runs first.

## Typed HTTP dispatcher

New module: `apps/pms-core/src/v1-dispatch.ts` (single owner of route registry).

### Catalog lookup (module scope — fail closed)

```ts
const COMMAND_BY_ID = new Map(COMMAND_CATALOG.map((e) => [e.id, e]));

/** Throws at module load if id missing — typo fails deploy, not runtime. */
function requireCatalogEntry(commandId: string): CommandEntry {
  const entry = COMMAND_BY_ID.get(commandId);
  if (!entry) throw new Error(`Unknown commandId in route registry: ${commandId}`);
  return entry;
}
```

Route registration for command-backed routes calls `requireCatalogEntry` at **module load**. No per-request `find()`; no silent skip when entitlement is undefined.

### Route registry — discriminated union

**One literal `scope` per union member** — `scope: 'bootstrap' | 'dev'` on a single member does *not* narrow (TypeScript keeps the whole member after `=== 'dev'` and `=== 'bootstrap'` checks). Use four members so `route.permission` compiles after early returns with no `!`.

```ts
type V1RouteBase = {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: (ctx: V1DispatchContext) => Promise<Response>;
};

type CommandLink =
  | { commandId: string; entitlement?: never }
  | { entitlement: FeatureKey; commandId?: never }
  | { commandId?: never; entitlement?: never }; // read-only

type V1RouteDef =
  | (V1RouteBase & { scope: 'bootstrap' })
  | (V1RouteBase & { scope: 'dev' })
  | (V1RouteBase & { scope: 'org' } & { permission: Permission } & CommandLink)
  | (V1RouteBase & { scope: 'property' } & { permission: Permission } & CommandLink);
```

- **`permission` is required** on `org` | `property` routes — omitting is a type error; excess `permission` on `bootstrap` | `dev` is TS2353.
- **`commandId`** when present: resolved via `requireCatalogEntry` at load; entitlement taken from catalog entry.
- **`entitlement`** when present without `commandId`: non-catalog orchestration (e.g. property provision → `pms.core`).

### `dispatchV1` contract

```ts
export async function dispatchV1(
  request: Request,
  env: PmsEnv,
  observability: ObservabilityContext,
  route: V1RouteDef,
): Promise<Response> {
  const actor = await resolveActor(request, env);
  if (actor instanceof Response) return actor;
  observability.userId = actor.userId;

  if (route.scope === 'dev') {
    /* isDevActorAllowed gate → handler */
  }

  if (route.scope === 'bootstrap') {
    return route.handler(ctx);
  }

  // Entitlement-gated routes: kill-switch before any tenant / DO work
  const feature: FeatureKey | undefined =
    'commandId' in route && route.commandId
      ? requireCatalogEntry(route.commandId).entitlement
      : 'entitlement' in route
        ? route.entitlement
        : undefined;

  if (feature && (await checkKillSwitch(env, feature))) {
    return new Response(null, { status: 503 });
  }

  const tenant = await resolveTenant(ctx, route); // D1 only → 404
  if (tenant instanceof Response) return tenant;

  const denied = await requirePermission(
    env,
    tenant.orgId,
    tenant.propertyId ?? null,
    actor.userId,
    route.permission,
  );
  if (denied) return denied;

  if (feature) {
    /* loadSnapshot + require — existing gatePmsCore logic */
  }

  return route.handler(ctx);
}
```

### HTTP route matrix (migrate all seven)

| Route | Scope | Command id | Permission | Entitlement gate |
|---|---|---|---|---|
| `POST /v1/orgs` | bootstrap | — | — | — |
| `POST /v1/admin/migration-sweep` | dev | — | — | — |
| `POST /v1/orgs/:orgId/properties` | org | — | `property:provision` | `pms.core` (explicit) |
| `GET /v1/orgs/:orgId/properties` | org | — | `org:read` | — |
| `GET /v1/properties/:propertyId` | property | — | `property:read` | — |
| `GET /v1/registry/properties/:propertyId` | property | — | `property:read` | — |
| `POST /v1/properties/:propertyId/room-types` | property | `inventory.add_room_type` | `inventory:write` | from catalog |

Property provision is orchestration, not a catalog command — `entitlement: 'pms.core'` on the route def.

Org-scoped routes pass `propertyId: null` to `requirePermission`. Property-scoped routes pass the route's `propertyId`.

### Wire codes

```ts
export const FORBIDDEN = 'forbidden' as const;
```

HTTP: **403** `{ error: 'forbidden', permission: 'inventory:write' }`.

## CI — `check:permissions`

New script: `scripts/permissions-check.mjs` (pattern copy from `entitlements-check.mjs`).

Build `@hospai/contracts` first, then:

1. Every `COMMAND_CATALOG` entry has `permission` defined.
2. Every `entry.permission ∈ PERMISSIONS`.
3. For each catalog permission `p`, either ∃ role `r` with `ROLE_GRANTS[r]` includes `p`, **or** `p ∈ PLATFORM_ONLY_PERMISSIONS`.
4. Source scan: `CommandEntry` type does not declare `permission` as `Permission | string`.
5. **Route registry:** import `V1_ROUTES` (exported from `v1-dispatch.ts`); no route with `scope ∈ {org, property}` uses a member of `PLATFORM_ONLY_PERMISSIONS`.
6. **Route registry:** every `commandId` on a route resolves in `COMMAND_BY_ID` (duplicate of module-load throw — belt and suspenders for CI).

Wire in `package.json` and `.github/workflows/ci.yml` alongside `check:entitlements`.

## Test contract

### Required — RBAC on inventory command

Extend `apps/pms-core/test/inventory-stack.spec.ts` (preferred) or add `rbac.spec.ts`.

New `it` (separate from the whole-stack seam — seam stays owner-only):

1. `POST /v1/orgs` as `user_owner` → 201.
2. `POST /v1/orgs/:orgId/properties` as `user_owner` → 201.
3. Resolve OrgDO stub → `ensureMember('user_staff', 'staff')`.
4. `POST /v1/properties/:propertyId/room-types` as `user_staff` → **403** `{ error: 'forbidden', permission: 'inventory:write' }`.
5. Same POST as `user_owner` → **201** (distinct body fields from seam test).

**Do not** weaken the existing whole-stack seam test.

### Regression

- Auth tests — membership 404 oracle unchanged.
- Entitlement / kill-switch negatives on property provision — unchanged.
- Ghost-DO: authenticated request to `GET /v1/orgs/nonexistent_org/properties` → **404**, no OrgDO materialization (assert via test or documented manual check).
- Full suite green.

### Optional (same PR if cheap)

- `admin` actor → room-type POST **201**.
- `property_member` override: use a **distinct user** (not re-`ensureMember` on an existing row — `ON CONFLICT DO NOTHING` at [org-do.ts:258](apps/pms-core/src/org-do.ts:258) will not change role). Insert org `staff` + `property_member` admin for `user_prop_admin` → room-type POST **201**.

## Scope

**In**

- `packages/contracts/src/permissions.ts` + export from index
- `CommandEntry.permission` on all catalog entries (incl. `guests:erase`, `folio:post` / `folio:adjust` splits)
- OrgDO migration v4 `property_member` + `generate:ddl` + `check:ddl`
- `getEffectiveRole` + `assertPermission` (scope partition)
- `resolveTenant` (D1-before-stub) + `requirePermission`
- `v1-dispatch.ts` + refactor `v1-handler.ts` to registry + frozen gates
- `COMMAND_BY_ID` map; module-load throw on unknown `commandId`
- `scripts/permissions-check.mjs` + CI + `pnpm check:permissions` (catalog + route registry)
- RBAC test (`staff` 403 / `owner` 201)
- `FORBIDDEN` wire code in contracts

**Out**

- KV permission projection (§4.3)
- Property-group roles
- Module manifest `permissions[]` contributions
- DO-internal permission assert before `tryAddRoomType` (fast follow-on)
- HTTP for `inventory.update_room_type` / `inventory.delete_room_type`
- Member invitation / SCIM / org-switch UI
- Clerk session claims for permissions
- SPA rebuild (§14)

## Implementation notes

- **`ensureMember` for tests:** OrgDO stub directly — no HTTP member-admin route. Fresh org ids per test; do not rely on role change via re-insert.
- **Dispatcher purity:** handlers parse + DO call only — no inline gate duplicates.
- **`mapCommandPermission(commandId)`** — optional export for DO follow-on.
- **README:** one line under Phase 1 linking this spec.

## Verification checklist

- [ ] `pnpm generate:ddl && pnpm check:ddl`
- [ ] `pnpm check:permissions` passes (catalog + route registry)
- [ ] `pnpm check:entitlements` still passes
- [ ] `pnpm typecheck` / lint / full test suite
- [ ] Staff 403 body includes `permission`, not `entitlement_required`
- [ ] Gate order: kill-switch before `resolveTenant`; permission before `loadSnapshot`
- [ ] Unknown `commandId` in registry throws at module load (not runtime fail-open)

## References

- ARCHITECTURE.md §1, §13, §14
- `apps/pms-core/src/auth.ts` — D1 gate before stub
- `apps/pms-core/src/org-do.ts` — migration on first stub touch
- `packages/contracts/src/commands/catalog.ts` — `inventory.add_room_type`
- `apps/pms-core/test/inventory-stack.spec.ts` — seam harness to extend
- `packages/entitlement-client/src/index.ts` — `kill:${featureKey}` global KV
