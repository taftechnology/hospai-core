# Entitlements + kill-switch (Phase 0 — commercial gate)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §1, §6.1–§6.7, §15.3; command catalog; lint rule `hospai/no-entitlement-in-domain`

## Purpose

Close the last retrofittable Phase 0 gap that every mutating command must pass through: a real entitlement plane (Platform D1 → OrgEntitlementDO → version-keyed KV) plus a **separate** operational kill-switch — before command count grows past nine and the enabled lint rule is guarding an empty room.

## Scope

**In**

- Platform D1 migration **0002**: `feature`, `plan`, `plan_feature`, `subscription` (+ seed: **Starter**, **Growth**)
- **PropertyDO `__meta.org_id`** — write-once, provision-populated (prerequisite for six PropertyDO commands; see below)
- `OrgEntitlementDO` (v1): resolve snapshot from D1, own `hard` meter counters
- Package `@hospai/entitlement-client`: types, `loadSnapshot`, `require`, `checkKillSwitch`, hard-limit helpers
- Wrangler: `ORG_ENTITLEMENT_DO`, `ENTITLEMENT_KV` bindings
- **Enforcement map** (normative — see below): kill-switch at edge; entitlement at edge **and** DO `try*` boundary
- `COMMAND_CATALOG` optional field `entitlement?: FeatureKey` — single source for command → feature mapping
- Wire code: `entitlement_required`; HTTP **402** (missing feature), **503** (kill-switch **or** resolution failure)
- Gate all **nine implemented** mutating commands (see table)
- Test helper `seedSubscription(env, orgId, planCode)`; entitlement seeded inside shared provision helpers; one denial test per DO
- `check:entitlements` — catalog `entitlement` values ⊆ `FEATURE_KEYS`; D1 seed feature keys ⊆ `FEATURE_KEYS`
- Vitest: entitled org passes existing suites; unentitled org gets stable `{ ok: false, error: 'entitlement_required' }` without mutation

**Out**

- Clerk / session token `entitlement_version` claim (Phase 0 reads version from snapshot / D1)
- Add-ons, trials, overrides, delinquency policy, `usage_counter` rollup (schema hooks only where trivial; resolution chain steps 2–5 deferred)
- `sso.saml`, channel manager, POS, and other §6.7 features beyond seed rows
- HTTP routes for individual commands (edge pattern is set; only tenancy routes exist today)
- LaneGuard, Queues consumer, observability
- UI upgrade CTAs (layer 4)
- Kill-switch on alarm handlers (note for next slice — see **Deferred hazards**)

## Enforcement map (normative)

The edge is an optimization, never the only check (ARCHITECTURE Rule 3, §6.5, §15.9).

| Layer | Location | Runs | On deny / failure |
|---|---|---|---|
| Kill-switch | Edge Worker `/v1/*` (and future non-HTTP entry points: alarms, queue consumers) | `KV.get('kill:${featureKey}', { cacheTtl: 60 })` **before** entitlement resolution (amended 2026-11-24: 10 s was never accepted by KV; 60 s until the test runtime accepts 30) | **503**, empty body |
| Entitlement (fast path) | Edge Worker `/v1/*` when route carries a required feature | `loadSnapshot` → `require(feature)` | **402** `{ error: 'entitlement_required', feature }` on missing feature; **503** on resolution failure |
| Entitlement (authoritative) | DO `try*` method entry, **async, before** `transactionSync` | `assertEntitled` resolves via **OrgEntitlementDO service binding** (never a caller-supplied snapshot) | `{ ok: false, error: 'entitlement_required' }` on missing feature; `{ ok: false, error: 'entitlement_unavailable' }` on resolution failure |
| Hard limits | DO `try*` when catalog maps a meter (Phase 0: stub only — see limits) | OrgEntitlementDO counter increment/check | `{ ok: false, error: 'limit_exceeded' }` |
| **Not here** | `tenant-router` | tenancy resolution only | — |
| **Not here** | `domain/` | pure invariants | lint enforced |

**402 vs 503:** **402** means the org is known and entitled resolution succeeded but the feature is absent — a commercial denial. **503** means kill-switch active **or** entitlement resolution failed (D1 unreachable, OrgEntitlementDO error, KV miss with DO fallback failure). An infrastructure incident must not surface as 402.

**Unentitled org and DO access:** tenant-router **may** resolve OrgDO / PropertyDO stubs (org exists in registry). Mutating `try*` commands **must** fail closed at the DO boundary. Routing ≠ entitlement.

**Bootstrap exception:** `POST /v1/orgs` and platform provisioning **do not** require `pms.core`. Org creation auto-seeds a **Starter** subscription so the first property provision is entitled unless tests explicitly omit it.

## PropertyDO org identity (prerequisite)

Six of nine gated commands run on **PropertyDO**, which today has no org context: the DO name is `idFromName(propertyId)` with no org component, and the object cannot recover `orgId` from its identity. **OrgDO already solves this** via `__meta.org_id` + `getOrgIdSync()`.

**Fix — mirror the OrgDO pattern into PropertyDO:**

```ts
async ensureMetaOrgId(orgId: string): Promise<void>   // property_config key '__meta.org_id', ON CONFLICT DO NOTHING
private getOrgIdSync(): string | null                 // read '__meta.org_id'
```

Populate at provision in `syncOrgAndPropertyDo` (alongside `ensureMetaPropertyId`) where `property.orgId` is already available from the D1 row.

**Which binding wins on conflict**

| Source | Role |
|---|---|
| **Platform D1** `property.org_id` | **Authoritative** — tenant registry SoR; every HTTP/registry resolve path loads org from here |
| **PropertyDO** `__meta.org_id` | **Write-once cache** — set at first provision from the D1 value; never overwritten on re-provision (`ON CONFLICT DO NOTHING`, same as `__meta.property_id`) |
| **DO name** (`propertyId`) | Routing identity only — **not** used for org lookup or entitlement |

Mismatch between D1 and meta is a provisioning bug; Phase 0 does not add a runtime reconcile loop. Tests that open PropertyDO without going through `provisionProperty` must call `ensureMetaOrgId(orgId)` explicitly (same as `ensureMetaPropertyId` today).

PropertyDO `try*` guards: `const orgId = this.getOrgIdSync(); if (!orgId) return { ok: false, error: 'org_id_unset' };` then `assertEntitled`.

## Data model (Platform D1)

Generated from `packages/do-runtime/src/platform-migrations.ts` (same pattern as tenant registry).

```
feature (key PK, name, type CHECK BOOLEAN|LIMIT|CONFIG, module_id NULL)
plan (code PK, name, tier, base_price, billing_interval)
plan_feature (plan_code FK, feature_key FK, value TEXT NOT NULL)
subscription (org_id PK FK, plan_code FK, status, entitlement_version INTEGER NOT NULL, trial_ends_at NULL, current_period_end NULL)
```

**Subscription invariants (Platform D1 triggers — §6.3, migration 0003):** rows are never deleted (cancellation = `status` update); `entitlement_version` is monotonic per org and must increase on any plan or status change; `status` ∈ `{active, cancelled}`. Triggers are retroactive on existing databases. Version bumps live in D1 write helpers (`seedSubscription`, future billing paths), not in OrgEntitlementDO.

**Phase 0 seed**

| Plan | `pms.core` | `pms.units.limit` |
|---|---|---|
| `starter` | `true` | `20` |
| `growth` | `true` | `100` |

Additional feature keys may be inserted as D1 rows with no plan grant — they remain denied until a plan maps them. New keys require extending `FEATURE_KEYS` (Invariant 6).

**Resolution (Phase 0 — plan features only)**

```
1. Load subscription for org_id (must be status = 'active')
2. Union plan_feature rows for subscription.plan_code
3. Emit EntitlementSnapshot { orgId, version, features, limits, computedAt }
```

Steps 2–5 from §6.2 (add-ons, trial, overrides, delinquency) are deferred.

```ts
export const FEATURE_KEYS = ['pms.core', 'pms.units.limit'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureValue = boolean | number | string;

export type EntitlementSnapshot = {
  orgId: string;
  version: number;
  features: Partial<Record<FeatureKey, FeatureValue>>;
  limits: Record<string, { limit: number; used: number; behavior: 'soft' | 'hard' | 'grace' }>;
  computedAt: string;
};
```

`subscription.entitlement_version` increments on any subscription/plan change (D1 write path + triggers in 0003); KV key `ent:${orgId}:v${version}` (§6.3). Phase 0 passes `version` from the loaded snapshot (no signed session yet).

## OrgEntitlementDO

- **Name:** `orgId` (same id as OrgDO; distinct class — §6, diagram)
- **Migration v1:** `meter_counter (meter_key, period, value)` for `hard` limits; `meta (key, value)` for last resolved version
- **`resolveEntitlements()`:** read Platform D1 → compute snapshot → persist counters' limits slice → return snapshot
- **`checkHardLimit(meterKey, delta)`:** atomic increment/reject inside DO storage (never stale via KV)

Version bumps are **not** an OrgEntitlementDO concern — they happen in Platform D1 subscription writes, enforced by D1 triggers (0003). A new KV key follows automatically from the incremented `entitlement_version`.

Phase 0 **does not** enforce `pms.units.limit` on room-type add (counter wiring deferred); DO and client exist so the next slice only adds the catalog meter mapping.

## Kill-switch (§6.4)

- **Not** in `EntitlementSnapshot`; **not** version-keyed
- Key: `kill:${featureKey}` in `ENTITLEMENT_KV`
- Edge checks with `{ cacheTtl: 60 }` (amended 2026-11-24; see ARCHITECTURE.md §6.4) before `loadSnapshot`
- Value truthy → 503; absence → proceed
- Operational tooling (Vitest helper `setKillSwitch(env, featureKey, active)`) for tests only in Phase 0

## `@hospai/entitlement-client`

Exports (no Cloudflare types in `packages/contracts` — client may import workers types):

```ts
loadSnapshot(env, orgId, opts?: { version?: number }): Promise<EntitlementSnapshot>;
require(snapshot, featureKey: FeatureKey): void; // throws EntitlementRequiredError
assertEntitled(env, orgId, featureKey): Promise<void>; // resolve via OrgEntitlementDO + require; for DO entry
checkKillSwitch(env, featureKey): Promise<boolean>;
mapCommandEntitlement(commandId: string): FeatureKey | undefined; // from COMMAND_CATALOG
```

**DO entry:** `assertEntitled` runs **async, before** `transactionSync`. Unlike `prepareGuestRecord` (local CPU, no external dependency), this is a cross-DO network hop — it adds fleet-wide availability coupling and a longer yield window across all nine commands. Mitigation (implementation detail, map unchanged): cache the **version-keyed** snapshot inside the calling DO (in-memory keyed by `version`); hit OrgEntitlementDO / KV only on cache miss or version bump. §6.3 distributes snapshots as version-keyed KV precisely so they are safe to cache for the lifetime of that version.

**Authoritative DO check:** `assertEntitled` always resolves through OrgEntitlementDO (with version-keyed KV as the DO's read-through cache). Callers **must not** pass a snapshot into the DO guard — that would validate hand-me-down input and void Invariant 3.

## Command → feature mapping

Extend `CommandEntry`:

```ts
entitlement?: FeatureKey;
```

| Command id | Implemented `try*` | Org source | Feature (Phase 0) |
|---|---|---|---|
| `reservations.create` | `PropertyDO.tryCreateReservation` | `getOrgIdSync()` | `pms.core` |
| `reservations.cancel` | `PropertyDO.tryCancelReservation` | `getOrgIdSync()` | `pms.core` |
| `reservations.modify` | `PropertyDO.tryModifyReservation` | `getOrgIdSync()` | `pms.core` |
| `inventory.add_room_type` | `PropertyDO.tryAddRoomType` | `getOrgIdSync()` | `pms.core` |
| `restrictions.upsert_day` | `PropertyDO.tryUpsertRestrictionDay` | `getOrgIdSync()` | `pms.core` |
| `rates.upsert_day` | `PropertyDO.tryUpsertRateDay` | `getOrgIdSync()` | `pms.core` |
| `guests.create` | `OrgDO.tryCreateGuest` | `getOrgIdSync()` | `pms.core` |
| `guests.update` | `OrgDO.tryUpdateGuest` | `getOrgIdSync()` | `pms.core` |
| `guests.erase` | `OrgDO.tryEraseGuest` | `getOrgIdSync()` | `pms.core` |

Catalog entries without an implemented `try*` in Phase 0 carry `entitlement` for documentation but need no DO wiring yet.

## HTTP edge (Phase 0 routes)

Apply to existing `/v1/*` mutating routes when they gain feature requirements:

| Route | Kill-switch | Entitlement |
|---|---|---|
| `POST /v1/orgs` | — | bootstrap (auto Starter) |
| `POST /v1/orgs/:orgId/properties` | `kill:pms.core` | `pms.core` |
| `GET /v1/properties/:id` | — | none (read) |

Future command HTTP handlers: kill-switch → snapshot → 402 or 503 → dispatch.

## Wire codes

```ts
export const ENTITLEMENT_REQUIRED = 'entitlement_required' as const;
export const ENTITLEMENT_UNAVAILABLE = 'entitlement_unavailable' as const;
export const LIMIT_EXCEEDED = 'limit_exceeded' as const;
```

HTTP mapping: `entitlement_required` → 402; kill-switch or resolution failure → 503 (no JSON body at edge; DO returns structured `{ ok: false, error }`).

## Test contract

1. **`seedSubscription(env, orgId, planCode)`** — upsert D1 subscription (bumps `entitlement_version` on plan/status change; triggers enforce monotonicity)
2. **Entitlement follows the org under test** — call `seedSubscription` inside **`provisionedOrg(orgId)`** and **`provisionedStub(…)`** (and `syncOrgAndPropertyDo` / HTTP provision paths), using the **same** `orgId` the test passes. Do **not** hardcode `org_test` in a global `beforeAll`; guest tests override `orgId` per case (`org-${name}`, `org-erase-${uuid}`, …) and seven call sites never use the default.
3. **Denial without mutation** — org with no subscription: `tryCreateReservation` → `{ ok: false, error: 'entitlement_required' }`; availability ledger unchanged
4. **Kill-switch** — with subscription present, `setKillSwitch(env, 'pms.core', true)` → edge `POST …/properties` returns 503
5. **Resolution failure** — simulate OrgEntitlementDO / D1 unreachable → edge returns **503**, not 402
6. **Growth plan** — `seedSubscription(…, 'growth')` resolves higher `pms.units.limit` in snapshot (assert features map only; no enforcement yet)
7. **Lint** — existing `hospai/no-entitlement-in-domain` stays green; no imports under `domain/`
8. **`check:entitlements`** — `COMMAND_CATALOG` entitlement values and D1 seed keys are subsets of `FEATURE_KEYS`

## Invariants

1. **No entitlement logic in `domain/`** — application-layer entry only (`try*` before txn).
2. **Kill-switch is not an entitlement** — separate KV key space, low TTL, never cached behind version.
3. **Edge + DO both check** — stub/RPC/alarm paths cannot bypass by skipping HTTP; DO never trusts a caller-passed snapshot.
4. **tenant-router stays tenancy-only** — no commercial imports.
5. **Feature keys, not columns** — new gates are data + catalog, not DO schema migrations.
6. **Closed `FeatureKey` union** — `FEATURE_KEYS` const + `check:entitlements`; catalog and D1 seed must agree.

## Deferred hazards

**Kill-switch on alarms (post–Phase 0):** `AlarmScheduler.run()` treats a handler that returns while still due as failure and applies exponential backoff + `last_error`. A kill-switch that makes the handler return without running will leave the alarm buried after un-kill. When alarm gating lands, distinguish **killed** (intentional suppress, no backoff) from **failed** (retry).

## Acceptance

1. PropertyDO provision writes `__meta.org_id`; `getOrgIdSync()` returns it; re-provision does not overwrite
2. Starter subscription seeded on org create → existing reservation/guest/inventory tests pass unchanged
3. Org without subscription → `tryCreateReservation` and `tryCreateGuest` return `entitlement_required`; no outbox events
4. Kill-switch active → property provision HTTP returns 503 before D1/DO mutation
5. Entitlement resolution failure → HTTP 503 (not 402); DO returns `entitlement_unavailable`
6. `resolveEntitlements()` returns version ≥ 1; KV key `ent:org:vN` populated on first load
7. `pnpm check:ddl` · `check:entitlements` · typecheck · lint · full test count green
8. Two plans seeded in Platform D1; Growth snapshot differs from Starter on `pms.units.limit`
9. `const bogus: FeatureKey = 'totally.made.up.key'` fails typecheck
