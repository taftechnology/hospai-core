# Migration orchestrator (Phase 0 — fleet schema sweep)

**Date:** 2026-07-28  
**Status:** Draft — pending review  
**Sources:** ARCHITECTURE.md §4.3, §12, §14; `migrateSql`; tenancy spine; NightAuditWorkflow pattern

## Purpose

Ship a **Workflow-based migration sweeper** that fan-outs from the Platform D1 tenant registry, wakes every registered OrgDO / PropertyDO / OrgEntitlementDO, and reports `schema_version` against the codebase head. Lazy migration in the DO constructor handles tenants as they are touched; the sweeper closes the gap for **cold DOs** after a deploy adds a new migration — the §12 failure mode where a tenant becomes invisible to migration if never woken.

Phase 0 delivers: Workflow + registry list queries + version report RPC + manual trigger. Not a general expand/contract CLI (that stays in `do-runtime` + `pnpm generate:ddl`).

## Why now

| Factor | State |
|---|---|
| Lazy migration | `migrateSql` in PropertyDO / OrgDO / OrgEntitlementDO constructors |
| Registry SoR | Platform D1 `org` + `property` tables — fan-out source of truth (§12) |
| Head versions | Property v7, Org v3, OrgEntitlement v1 — exported from `@hospai/do-runtime` |
| `getSchemaVersion()` | PropertyDO + OrgDO — **OrgEntitlementDO lacks it** |
| Workflow pattern | `NightAuditWorkflow` + wrangler binding proven |
| `tools/migrate-orchestrator/` | **Absent** — Workflow lives in `pms-core` (same as night audit) |

Observability tags sweep steps. LaneGuard independent.

## Scope

**In**

- `@hospai/do-runtime` exports: `PROPERTY_SCHEMA_HEAD`, `ORG_SCHEMA_HEAD`, `ORG_ENTITLEMENT_SCHEMA_HEAD` (derived from migration arrays — single source)
- `OrgEntitlementDO.getSchemaVersion()` RPC
- `registry.ts`: `listOrgIds(env, opts)`, `listPropertyIds(env, opts)` — paginated, **`ORDER BY` primary key** (`org_id` / `property_id`); cursor is last id from previous page (keyset on sort key)
- `MigrationSweepWorkflow` — Cloudflare Workflow on same Worker
- Wrangler: `MIGRATION_SWEEP_WORKFLOW` binding
- Trigger: `POST /v1/admin/migration-sweep` — registered **only when `isDevActorAllowed(env)`**; otherwise path falls through to existing 404 (see **Admin route**)
- Workflow steps: **one `step.do` per registry page** — loop tenants inside the step; collect `{ tenantKind, id, version, head, ok }` per tenant
- Terminal step: structured log summary via `@hospai/observability` (`msg: 'migration.sweep.complete'`, counts of ok/mismatch/error)
- Vitest: fake Workflow step (mirror `night-audit.spec.ts`) runs sweep against 1 org + 1 property; all `ok: true`

**Out**

- Cron / scheduled trigger (Phase 1 ops — document wrangler `[triggers]` as follow-on)
- Expand/contract code generation, blue/green fleet cutover
- Writing migration results to Platform D1 (Phase 0 logs only; D1 audit table is Phase 1)
- Migrating DOs **not** in registry (by design — registry drift is a provisioning bug, §12)
- Cross-jurisdiction batch without `tenant-router` (every resolve goes through existing helpers)
- HTTP response body listing every tenant (log summary only; HTTP returns workflow id)

## Architecture

```
POST /v1/admin/migration-sweep (dev-actor gate only)
        │
        ▼
MigrationSweepWorkflow.run()
        │
        ├─ step `orgs-page-0`: list org ids (page 0) → loop: resolveOrgStub → getSchemaVersion → compare ORG_SCHEMA_HEAD
        ├─ step `orgs-page-1`: …
        ├─ step `properties-page-0`: list property ids → loop: resolvePropertyFromRegistry → getSchemaVersion → compare PROPERTY_SCHEMA_HEAD
        ├─ step `properties-page-1`: …
        ├─ step `entitlements-page-0`: list org ids → loop: resolveOrgEntitlementStub → getSchemaVersion → compare ORG_ENTITLEMENT_SCHEMA_HEAD
        └─ step `summary`: log migration.sweep.complete (ok / mismatch / error counts)
```

**One step per D1 page, not per tenant.** Cloudflare Workflows default to 10,000 steps per instance (Paid; 1,024 on Free). Step-per-tenant hits ~3× fleet size (org + property + entitlement) — a 400-property fleet is ~1,200 steps before pagination even matters. Batching tenants inside each page step keeps step count ≈ `3 × ceil(fleet / pageSize)` and makes a page a natural retry unit.

**Registry-only resolution.** Property sweep uses `resolvePropertyFromRegistry` (D1 → jurisdiction → stub), never raw `idFromName`. Org sweep uses `resolveOrgStub`. Entitlement uses `resolveOrgEntitlementStub` from `@hospai/tenant-router`.

**Constructor migration.** RPC to `getSchemaVersion()` instantiates cold DOs and runs pending migrations before returning — the sweep *is* the migration action, not a separate `migrate()` RPC.

## Head version constants

```ts
// packages/do-runtime/src/schema-head.ts
export const PROPERTY_SCHEMA_HEAD = Math.max(...PROPERTY_MIGRATIONS.map((m) => m.version));
export const ORG_SCHEMA_HEAD = Math.max(...ORG_MIGRATIONS.map((m) => m.version));
export const ORG_ENTITLEMENT_SCHEMA_HEAD = Math.max(...ORG_ENTITLEMENT_MIGRATIONS.map((m) => m.version));
```

When a developer adds migration v8, head auto-advances; sweep reports mismatches until fleet catches up.

## Registry pagination (normative)

Keyset pagination requires the **cursor column to be the sort key**. Do not mix `ORDER BY created_at, org_id` with a cursor on `org_id` alone — rows are skipped and repeated whenever timestamp order disagrees with id order (most of the time for UUID-ish ids). For a migration sweep, silently skipping tenants is the exact failure the sweep exists to prevent.

**Sort by primary key only:**

```sql
SELECT org_id FROM org WHERE org_id > ? ORDER BY org_id ASC LIMIT ?
SELECT property_id FROM property WHERE property_id > ? ORDER BY property_id ASC LIMIT ?
```

```ts
export type PageOpts = { limit?: number; after?: string | null };

export async function listOrgIds(
  env: PmsEnv,
  opts?: PageOpts,
): Promise<{ ids: string[]; nextAfter: string | null }>;

export async function listPropertyIds(
  env: PmsEnv,
  opts?: PageOpts,
): Promise<{ ids: string[]; nextAfter: string | null }>;
```

Default `limit = 50`. `after` is the last id from the previous page (`null` for first page). `nextAfter` is the last id returned, or `null` when the page is short (end of table).

**Property page query returns full rows** (`property_id`, `org_id`, `jurisdiction`, `time_zone`) so the sweep loop resolves stubs from the page result — one D1 query per page, not 1 + N re-reads via `getProperty` per id.

D1 pagination bounds the query; Workflow **page batching** bounds step count — both are required at production scale.

## Workflow

```ts
export type MigrationSweepParams = { triggeredBy: string }; // userId from dev actor

export class MigrationSweepWorkflow extends WorkflowEntrypoint<PmsEnv, MigrationSweepParams> {
  async run(event: WorkflowEvent<MigrationSweepParams>, step: WorkflowStep): Promise<void> {
    // Paginate orgs, properties, entitlements.
    // One step.do(`orgs-page-${n}`, …) per D1 page — loop all ids inside the callback.
    // Re-resolve stubs inside the callback (same NightAuditWorkflow pattern — stubs not cloneable across steps).
    // Accumulate counts in step return values; terminal step logs summary.
  }
}
```

**Step naming:** `orgs-page-0`, `properties-page-0`, `entitlements-page-0`, `summary` — visible in dashboard.

**Error isolation:** one tenant RPC failure logs `migration.sweep.error` and continues within the page step (do not fail the page for one bad row). Summary includes `errors: N`.

**Mismatch:** `version !== head` → increment mismatch count; log at `warn`.

## Admin route (normative)

A route that can wake **every DO in the fleet** needs a single, definite production behaviour — not "404 or 401".

```ts
// Inside /v1/* — only when isDevActorAllowed(env):
if (request.method === 'POST' && pathname === '/v1/admin/migration-sweep') {
  const actor = await resolveActor(request, env);
  if (actor instanceof Response) return actor;
  const instance = await env.MIGRATION_SWEEP_WORKFLOW.create({
    id: `migration-sweep-${Date.now()}`,
    params: { triggeredBy: actor.userId },
  });
  return json({ workflowId: instance.id }, 202);
}
```

When `isDevActorAllowed(env)` is **false** (production), this branch is **not registered** — the request falls through to the existing `{ error: 'not_found' }` **404**. One condition; composes with `assertEnvSafeForRequest`, which already **500s** if unsafe flags are set without `HOSPAI_UNSAFE_LOCAL=1`.

Do **not** expose dev-actor flags in production wrangler `vars`.

Response: `202 { workflowId: string }`.

## Wrangler

```jsonc
{
  "workflows": [
    { "binding": "MIGRATION_SWEEP_WORKFLOW", "name": "hospai-migration-sweep", "class_name": "MigrationSweepWorkflow" }
  ]
}
```

## File layout

| File | Role |
|---|---|
| `packages/do-runtime/src/schema-head.ts` | head constants |
| `apps/pms-core/src/migration-sweep-workflow.ts` | Workflow class |
| `apps/pms-core/src/registry.ts` | list pagination |
| `apps/pms-core/src/org-entitlement-do.ts` | `getSchemaVersion()` |
| `apps/pms-core/src/index.ts` | admin route + export Workflow |
| `apps/pms-core/src/env.ts` | `MIGRATION_SWEEP_WORKFLOW` on `PmsEnv` |
| `apps/pms-core/wrangler.jsonc` | workflow binding |
| `apps/pms-core/test/migration-sweep.spec.ts` | integration |

## Success tests

1. **Existing suite green** — 237+ tests.
2. **Head constants match** — `PROPERTY_SCHEMA_HEAD === 7`, `ORG_SCHEMA_HEAD === 3`, `ORG_ENTITLEMENT_SCHEMA_HEAD === 1` (update if migrations change — test pins current head).
3. **Provision + sweep** — one org, one property; workflow run → all tenants `ok: true`.
4. **Cold DO migrated** — insert registry row without prior RPC; sweep → `getSchemaVersion()` returns head (constructor ran).
5. **Registry pagination** — seed 3 orgs with `limit: 2` → two pages via keyset on `org_id`; union of ids equals all seeded orgs (no skips).
6. **Admin route gated** — without `isDevActorAllowed` → **404** (path not registered); with flags + actor → **202** + workflow created.
7. **Entitlement DO included** — org with entitlement stub reports v1.
8. **Error isolation** — one RPC throw inside a page loop → page step completes; summary `errors >= 1`.
9. **Step count bounded** — sweep of N orgs + M properties uses O(`ceil(N/limit) + ceil(M/limit) + ceil(N/limit) + 1`) workflow steps, not O(N + M).

## Deployment ordering

Deploy Worker with Workflow binding **before** relying on sweep in CI/CD. Consumer-before-producer rule does not apply.

Recommended post-deploy runbook: `curl -X POST …/v1/admin/migration-sweep` in staging after every migration bump.

## Relationship to §12

| Challenge | This slice |
|---|---|
| Migration fan-out | Workflow sweeper from D1 registry |
| DOs cannot be enumerated | Registry is SoR; sweep never calls `listDurableObjectIds` |
| Registry drift | Out of scope — provisioning must remain transactional; sweep does not heal drift |

Expand/contract remains mandatory for schema changes; this slice does not replace careful migration authorship in `do-runtime`.

## Non-goals reminder

`tools/migrate-orchestrator/` as a separate CLI package is deferred — Phase 0 proves the Workflow in the shipping Worker. Extract to `tools/` when cron + CI integration needs a standalone runner.

Phase 0 completes the ARCHITECTURE §14 tail alongside observability and LaneGuard. **`pms.inventory` through the whole stack** remains the exit criterion; these three slices are infrastructure, not product features.
