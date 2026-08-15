# Rate Plans Vertical

**Date:** 2026-08-05
**Status:** Revised (v2 — fingerprint normalization before hash; create id-collision semantics; `tryUpsertRateDay` precise error union incl. `ENTITLEMENT_UNAVAILABLE`; defaulting moved into the DO; 11a/13a same-key lock; prerequisite event-consumer allowlist fix)
**Sources:** ARCHITECTURE.md §7.2 (rates vs restrictions; derivation graph — Phase 1 honesty below); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) (entity + archive + partial unique index pattern this repeats); [folio charges vertical](./2026-08-05-folio-charges-vertical-design.md) (deploy-day lazy-creation hazard class; `'BAR'` hardcoding this slice retires); [reservations vertical](./2026-08-04-reservations-vertical-design.md) (`rates.upsert_day` / `PUT …/rate-days` already shipped without plan validation)

**Prerequisite (landed):** `7f1b569` — `fix(pms-core): accept rooms/housekeeping events in queue consumer`. Five rooms/housekeeping event types were DLQ-ing on flush (`default: throw unknown event type`). That commit also accepts every `COMMAND_CATALOG` `events[]` entry (including `rate_plan.changed`) and locks it with an allowlist test. This slice must not introduce a new event type without a consumer case; plan CRUD keeps `rate_plan.changed` (already handled).

---

## 1. Context & Motivation

28 of 48 catalog commands are unrouted. They cluster into three real candidates (staff, payments, rate plans). Rate plans has the exact structural shape rooms had: a dimension wired into live tables with **no entity behind it**.

There is no `rate_plan` table. `rate_day.rate_plan_id TEXT NOT NULL DEFAULT 'BAR'` and `restriction_day.rate_plan_id TEXT NOT NULL DEFAULT '*'` — two tables, two different defaults, zero plan rows. `'BAR'` is a string literal in three source locations:

1. `quoteStay`'s default ([property-do.ts:3842](../../../apps/pms-core/src/property-do.ts:3842))
2. `POST_ROOM_CHARGES` ([property-do.ts:4000](../../../apps/pms-core/src/property-do.ts:4000))
3. `handlePutRateDays` ([v1-dispatch.ts:859](../../../apps/pms-core/src/v1-dispatch.ts:859))

**Live consequence today:** `PUT …/rate-days` accepts `body.ratePlanId ?? 'BAR'` with **no validation**. A revenue manager can load a full season under `ratePlanId: 'CORP'`, get `200`s, and have every row permanently invisible to quoting and night audit — both look up `'BAR'`. Silent, accepted, unreadable writes.

**Why this over staff / payments.** Staff (7 commands) carries a genuine fork — is a housekeeper a Clerk user or a property-local record? — overlapping OrgDO membership, `ROLE_GRANTS`, and the `housekeeping_assignment.assignee_ref` string rooms deliberately left dangling. Deferred twice for that reason. Payments (3) still wants a cashier/shift model (wants staff) and is the only slice with an external PSP boundary. Rate plans is pure domain modelling: all five `rates.*` commands are already `FAIL_CLOSED` (structural config), so this slice introduces **no new degraded-mode protocol questions**. It is the shape this codebase's verification loop handles best.

**Scope in:**

1. **`rate_plan` table** — `rate_plan_id`, `code`, `name`, `status` (`active` / `archived`). Commands: `rates.create_plan` / `update_plan` / `delete_plan` (archive).
2. **Validation on `rate_day.rate_plan_id`** — writes referencing a missing or archived plan rejected; the silent-`CORP` class ends.
3. **`rates.update_room_type_rate` and `rates.bulk_update`** — revenue manager's daily operation, routed and gated.
4. **De-hardcode `'BAR'`** — seeded default plan per property; three call sites reference `DEFAULT_RATE_PLAN_ID`, not a string literal.
5. **Entitlement opt-outs retired** — all five commands gain `entitlement: 'pms.core'`; matching `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` rows deleted in the same commit.

**Scope out:**

- ~~Derived / linked plans ("BAR minus 10%"). ARCHITECTURE §7.2's derivation graph and OrgDO-hosted plan definitions stay deferred~~ **Closed (property-local half)** in [2026-08-15 derived rate plans](./2026-08-15-derived-rate-plans-design.md): one-level percent-of-parent on PropertyDO `rate_plan` with sync `rate_day` rematerialization; OrgDO chain-wide stays out.
- Plan-scoped restrictions — `restriction_day` keeps `TYPE_WIDE_RATE_PLAN` (`'*'`); see §2.3.
- Channel rate mapping, LOS pricing, tax-inclusive vs exclusive rate flags.
- Hard FK from `rate_day` → `rate_plan` (§2.1 — orphans and deploy safety).
- Staff, payments, cashier shifts.

---

## 2. Design Decisions

### 2.1 Deploy day — seed BAR, do not gate-orphan existing `rate_day` rows

Existing properties have `rate_day` rows under `'BAR'` with no plan entity. A hard FK or a validation gate that fires before a plan row exists orphans them and breaks `quoteStay` / `POST_ROOM_CHARGES` on deploy — the same hazard class as folio's missing `folio_window` and rooms' "zero `room` rows on check-in."

**Rejected: migration-time FK from `rate_day.rate_plan_id` → `rate_plan`.** Even after seeding `BAR`, any property that already wrote orphan rows under `'CORP'` (or any non-BAR id) fails the migration under `PRAGMA foreign_keys = ON`. The silent-write bug this slice exists to close may already have left orphans in the field; a deploy must not punish them with a migration abort.

**Resolution: seed + lazy ensure, application-level validation on write, no FK.**

1. **Migration v12** creates `rate_plan` and seeds the default row in the same statement list:

```sql
INSERT INTO rate_plan (rate_plan_id, code, name, status, created_at, updated_at)
VALUES ('BAR', 'BAR', 'Best Available Rate', 'active', 0, 0);
```

`rate_plan_id = 'BAR'` is load-bearing — it matches the string already stored in every existing `rate_day` row and every reader. Renaming the id would orphan the world; the display `name` is what operators edit.

2. **`ensureDefaultRatePlanSync()`** — private synchronous `INSERT OR IGNORE` with the same deterministic id, called from plan/rate write paths that default to BAR. Belt-and-braces for any DO that somehow skipped the seed (test fixtures that apply a subset of migrations, etc.). Same shape as `ensureGuestFolioWindowSync`.

3. **Validation is write-path only** (§2.4). Pre-existing orphan `rate_day` rows under unknown plan ids remain readable if a caller passes that id explicitly; they become first-class the moment an operator `rates.create_plan`s with that `rate_plan_id` (adoption by create). Default readers (`quoteStay`, `POST_ROOM_CHARGES`) keep looking up `DEFAULT_RATE_PLAN_ID` and are unaffected by orphans.

### 2.2 `rates.delete_plan` archives — never hard-deletes; BAR is protected

`room_type` set the precedent: `status ∈ {active, archived}`, partial unique index `WHERE status = 'active'`, `inventory.delete_room_type` archives. Follow it.

**Resolution:**

| Rule | Behaviour |
|---|---|
| `rates.delete_plan` | Sets `status = 'archived'`. Never `DELETE FROM rate_plan`. |
| Rate days under an archived plan | **Remain.** No cascade, no scrub. Historical prices stay queryable by explicit `ratePlanId`. |
| New writes to an archived plan | Reject with `RATE_PLAN_NOT_FOUND` (same privacy/absence shape as a missing plan — do not leak archive state via a distinct wire code on the write path). |
| `quoteStay` / `POST_ROOM_CHARGES` | Continue to use `DEFAULT_RATE_PLAN_ID` only; they never select an archived plan as a default. |
| Archiving `BAR` | **Rejected** with `DEFAULT_RATE_PLAN_PROTECTED`. Night audit and quoting hard-depend on it; allowing archive re-creates the deploy-day outage with an operator foot-gun. |
| Re-creating a plan with an archived code | Allowed — partial unique index scopes uniqueness to `status = 'active'`, same as `room_type_code_active`. New row gets a new `rate_plan_id`; it does **not** automatically adopt the archived plan's `rate_day` rows (those stay keyed to the old id). Adoption of orphans is only via create-with-matching-id (§2.1.3). |

Catalog id stays `rates.delete_plan` (prototype `DELETE_RATE_PLAN`) — matching `inventory.delete_room_type`'s archive-under-delete-name convention. Catalog `notes` record that the operation archives.

### 2.3 The `'*'` convention stays — restrictions remain type-wide in Phase 1

`TYPE_WIDE_RATE_PLAN = '*'` ([property-migrations.ts:3](../../../packages/do-runtime/src/property-migrations.ts:3)) is the deliberate default on `restriction_day`. Restriction evaluation already reads type-wide rows only ([modules/pms/restrictions](../../../modules/pms/restrictions/src/domain/evaluation.ts)). That is coherent, not a bug.

Once plans are real entities, "type-wide" vs "plan-scoped" becomes a visible product choice. **Phase 1 keeps restrictions type-wide:**

- `handlePutRestrictionDays` continues to default `body.ratePlanId ?? TYPE_WIDE_RATE_PLAN`.
- Restriction writes do **not** validate `rate_plan_id` against `rate_plan` — `'*'` is not a plan entity and must not become one.
- Plan-scoped restriction rows (`rate_plan_id = some real plan`) are out of scope; the column and PK already allow them, but no writer in this slice produces them on purpose, and evaluation stays type-wide.

Say so explicitly so a later reader does not treat the asymmetry (rates validated, restrictions not) as an incomplete gate.

### 2.4 Validate `rate_day` writes against an active plan; default inside the DO

Every path that inserts or updates `rate_day` must resolve `rate_plan_id` to an **active** `rate_plan` row before writing:

1. `tryUpsertRateDay` (existing — implements `rates.upsert_day` and, per §2.5, `rates.update_room_type_rate`)
2. `tryBulkUpdateRates` (new — implements `rates.bulk_update`)

Missing or archived → `RATE_PLAN_NOT_FOUND`. No silent accept.

**Defaulting moves into the DO.** Today `tryUpsertRateDay` requires `ratePlanId: string` and `handlePutRateDays` applies `?? 'BAR'` at the edge — so a v1 draft clause that called `ensureDefaultRatePlanSync` "when defaulting" inside the DO was moot (the DO never saw an omitted id). Change the input to `ratePlanId?: string`. Resolution order inside `tryUpsertRateDay` / each bulk cell:

1. `ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID`
2. If `ratePlanId === DEFAULT_RATE_PLAN_ID`, `ensureDefaultRatePlanSync()` (belt-and-braces for the seed)
3. Active-plan check → else `RATE_PLAN_NOT_FOUND`
4. Upsert

HTTP handlers pass `ratePlanId` through optionally and **normalize with the same `?? DEFAULT_RATE_PLAN_ID` before `fingerprintPayload`** (§2.5a) so edge fingerprint and DO write agree.

### 2.5 `rates.update_room_type_rate` vs existing `rates.upsert_day`

`PUT …/rate-days` already ships under `commandId: 'rates.upsert_day'` (`prototypeAction: null`, events: `['rate.changed']`). The catalog also has `rates.update_room_type_rate` (`UPDATE_ROOM_TYPE_RATE`, events: `['rate_plan.changed']`) — same cell-level write, divergent event name, no route.

**Resolution:**

- **One DO method** — `tryUpsertRateDay` — owns the single-day write. Gains actor + `gatePermission(actor, 'rates:write')` + plan validation + optional `ratePlanId` (§2.4). Signature becomes `(actor, input, idem)` to match the rooms/folio gate pattern; the HTTP handler passes the resolved actor.
- **`PUT …/rate-days` stays on `rates.upsert_day`.** No second URL for the same cell write.
- **`rates.update_room_type_rate` is implemented by that same method.** Add one alias route (`PUT …/room-types/:roomTypeId/rates`, `commandId: 'rates.update_room_type_rate'`) so the catalog command is HTTP-reachable; handler shares `tryUpsertRateDay` with `roomTypeId` taken from the path. Both routes emit **`rate.changed`** — see event fix below. No third single-day URL.
- **Catalog event fix (same commit):** `rates.update_room_type_rate` and `rates.bulk_update` currently declare `events: ['rate_plan.changed']`. A daily price write is not a plan-definition change; `rate.changed` is what [event-consumer.ts](../../../apps/pms-core/src/event-consumer.ts) already handles for `rates.upsert_day`. Emitting `rate_plan.changed` for a cell write would lie to any future derivation workflow. Change both to `events: ['rate.changed']`. Plan CRUD (`create` / `update` / `delete`) keeps `rate_plan.changed` (consumer case already present after the prerequisite fix).

### 2.5a Normalize before fingerprint — alias route and bulk

Idempotency fingerprints must hash the **resolved** cell, not the wire shape.

| Surface | Trap | Rule |
|---|---|---|
| Alias vs `PUT …/rate-days` | Same logical write, same idempotency key, different route — if one fingerprints omitted `ratePlanId` and the other fingerprints `'BAR'`, the second call hits `IdempotencyKeyReused` instead of a replay | Both handlers build `{ roomTypeId, ratePlanId: body.ratePlanId ?? DEFAULT_RATE_PLAN_ID, stayDate, amountMinor, currency }` **then** `fingerprintPayload`. Extract a shared helper (e.g. `normalizeRateDayCell`) used by both. |
| Bulk | A cell omitting `ratePlanId` and a cell passing `'BAR'` are the same cell but sort/hash differently if defaulted after sort | Resolve `ratePlanId` on every cell **before** sorting by `(roomTypeId, ratePlanId, stayDate)` and before hashing |

### 2.6 `rates.bulk_update` — all-or-nothing cell list

Catalog: `lane: 'BULK'`, `FAIL_CLOSED`, `permission: 'rates:write'`.

**Resolution:** body is an explicit list of cells, not a date-range fill (range fill invites LOS/derivation questions this slice scoped out):

```ts
{
  updates: Array<{
    roomTypeId: string;
    ratePlanId?: string;  // default DEFAULT_RATE_PLAN_ID — resolved before sort/fingerprint (§2.5a)
    stayDate: string;
    amountMinor: number;
    currency: string;
  }>;
  idempotencyKey: string;
}
```

- Fingerprint: normalize each cell (§2.5a), sort by `(roomTypeId, ratePlanId, stayDate)`, then hash `{ updates }`.
- One `transactionSync` / `runIdempotent` `execute()`; each cell runs the same resolve → ensure → active-plan check as `tryUpsertRateDay`; any failure aborts the whole batch.
- One `rate.changed` outbox event per updated cell (matching single-day's per-write emission) so the existing consumer path does not need a bulk payload shape.
- `LaneGuard` today only exposes `touchInteractive` / `admitBackground` / `bulkDeadline`. Call `this.lanes.touchInteractive()` — do **not** invent `touchBulk` (rooms §3 item 5 precedent).

### 2.6a `tryCreateRatePlan` id collisions — adoption only when no row exists

§2.1.3's "adoption by create-with-matching-id" is a create with a client-chosen `ratePlanId` that already appears on orphan `rate_day` rows. Define both collisions:

| Existing `rate_plan` row | Behaviour |
|---|---|
| None | Insert succeeds — orphans under that id become first-class (adoption) |
| Active, same `rate_plan_id` | Reject `RATE_PLAN_ID_EXISTS` |
| Archived, same `rate_plan_id` | Reject `RATE_PLAN_ID_EXISTS` — **do not un-archive**. Un-archive is out of scope; a new plan with a new id is the path if the operator wants a live CORP again. Orphans/history stay keyed to the archived id. |
| Active, different id, same `code` | Reject `RATE_PLAN_CODE_EXISTS` (partial unique index) |

Adoption therefore applies **only** when no `rate_plan` row exists for that id. Archived-id recreate is not a back door to revive.

### 2.7 De-hardcode `'BAR'` — one constant, readers + DO default

```ts
// packages/do-runtime/src/property-migrations.ts (next to TYPE_WIDE_RATE_PLAN)
export const DEFAULT_RATE_PLAN_ID = 'BAR' as const;
```

Re-export from `@hospai/do-runtime`. Replace literals / own the default:

| Site | Change |
|---|---|
| `quoteStay` | `input.ratePlanId ?? DEFAULT_RATE_PLAN_ID` |
| `postRoomChargesSync` | lookup uses `DEFAULT_RATE_PLAN_ID` |
| `tryUpsertRateDay` / `tryBulkUpdateRates` | `input.ratePlanId ?? DEFAULT_RATE_PLAN_ID` (§2.4) — **source of truth for writes** |
| `handlePutRateDays` / `handlePutRoomTypeRate` / bulk handler | Same `?? DEFAULT_RATE_PLAN_ID` **before fingerprint** (§2.5a); pass the **resolved** id into the DO. DO still re-applies `?? DEFAULT_RATE_PLAN_ID` as defense in depth so a direct stub call cannot skip the default. |

Production call sites must import the constant. Tests should import it too when they mean "the default plan," so a future id change fails loudly.

### 2.8 Entitlement opt-outs retire in the same commit

All five commands sit in `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` with *"Phase 1 — not yet gated at a DO boundary."* This slice **is** that boundary.

```diff
   { id: 'rates.create_plan', ..., permission: 'rates:write',
+    entitlement: 'pms.core',
   },
   // same for update_plan, delete_plan, update_room_type_rate, bulk_update
```

Delete the five matching rows from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` in [entitlements.ts](../../../packages/contracts/src/entitlements.ts) **in the same commit**. `check:entitlements` enforces both directions — an opted-out id that also has `entitlement` set is itself an error — so catalog edit and opt-out deletion are one atomic change or CI goes red either way. Same pairing `reservations.no_show` already proved.

`rates.upsert_day` already carries `entitlement: 'pms.core'` — untouched.

### 2.9 Precise error codes — and widen `tryUpsertRateDay`'s union

New constants in `packages/contracts/src/idempotency.ts`:

```ts
export const RATE_PLAN_NOT_FOUND = 'rate_plan_not_found' as const;
export const RATE_PLAN_CODE_EXISTS = 'rate_plan_code_exists' as const;
export const RATE_PLAN_ID_EXISTS = 'rate_plan_id_exists' as const;
export const DEFAULT_RATE_PLAN_PROTECTED = 'default_rate_plan_protected' as const;
```

HTTP mapping: `RATE_PLAN_CODE_EXISTS` / `RATE_PLAN_ID_EXISTS` / `DEFAULT_RATE_PLAN_PROTECTED` → `422`; `RATE_PLAN_NOT_FOUND` → `404` (privacy/absence — archived and missing share this code on mutating rate-day writes and on update/delete of a missing/archived plan). `GET /rate-plans` returns active plans only; this slice does not add `GET /rate-plans/:id`.

**Widen `tryUpsertRateDay`'s return type** — today `{ ok: true } | { ok: false; error: string }`, the wide-`string` gap folio closed for `tryAddFolioLine`. Adding `RATE_PLAN_NOT_FOUND` without widening forces the HTTP mapper to string-compare a magic value:

```ts
Promise<
  | { ok: true }
  | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' }
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof IDEM_KEY_REUSED }
  | { ok: false; error: string } // narrow escape hatch, not the contract
>
```

`tryBulkUpdateRates` and the plan CRUD methods use the same precise style for their domain errors (`RATE_PLAN_*` / `DEFAULT_RATE_PLAN_PROTECTED`).

---

## 3. Schema

**Migration version 12** (rooms shipped v11). Regenerate via `pnpm generate:ddl` — let the generator assign the SQL filename number.

```ts
/** v12 — rate_plan entity + seed DEFAULT_RATE_PLAN_ID (BAR). No FK from rate_day. */
export const RATE_PLAN_V12_STATEMENTS: string[] = [
  `CREATE TABLE rate_plan (
  rate_plan_id   TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX rate_plan_code_active ON rate_plan(code) WHERE status = 'active'`,
  `INSERT INTO rate_plan (rate_plan_id, code, name, status, created_at, updated_at)
   VALUES ('BAR', 'BAR', 'Best Available Rate', 'active', 0, 0)`,
];
```

No rebuild of `rate_day`. No FK. Seed `created_at` / `updated_at` of `0` is intentional for the migration-inserted system row — operator-visible `updated_at` changes if they rename BAR via `rates.update_plan`.

---

## 4. File Changes

### `packages/do-runtime/src/property-migrations.ts` [MODIFY]

- Export `DEFAULT_RATE_PLAN_ID = 'BAR'`.
- Append `RATE_PLAN_V12_STATEMENTS` as migration version 12.
- Re-export from `packages/do-runtime/src/index.ts`.

### `packages/contracts/src/commands/catalog.ts` [MODIFY]

1. Add `entitlement: 'pms.core'` to `rates.create_plan` / `update_plan` / `delete_plan` / `update_room_type_rate` / `bulk_update` (§2.8).
2. `rates.update_room_type_rate` and `rates.bulk_update`: `events` → `['rate.changed']` (§2.5).
3. `rates.delete_plan` — add `notes: 'Archives (status=archived); never hard-deletes. BAR is not archivable.'`

### `packages/contracts/src/entitlements.ts` [MODIFY]

Delete the five `rates.*` rows from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` (§2.8) — same commit as the catalog entitlement fields.

### `packages/contracts/src/idempotency.ts` [MODIFY]

Four new wire codes (§2.9). Re-export from `packages/contracts/src/index.ts`.

### `apps/pms-core/src/property-do.ts` [MODIFY]

1. **`ensureDefaultRatePlanSync()`** — `INSERT OR IGNORE` for `DEFAULT_RATE_PLAN_ID` / code `BAR` / name `Best Available Rate` / `active`.
2. **`tryCreateRatePlan(actor, input, idem)`** — `FAIL_CLOSED`.
   - `gateCoreEntitlement` + `gatePermission(actor, 'rates:write')`
   - Fingerprint: `{ ratePlanId, code, name }`
   - Guards: any existing row with that `rate_plan_id` (active or archived) → `RATE_PLAN_ID_EXISTS` (§2.6a); active-code unique → `RATE_PLAN_CODE_EXISTS`; insert `status = 'active'`; emit `rate_plan.changed` with `{ propertyId, ratePlanId, op: 'create' }`
3. **`tryUpdateRatePlan(actor, input, idem)`** — `FAIL_CLOSED`.
   - Fingerprint: `{ ratePlanId, code?, name? }`
   - Target must be active (else `RATE_PLAN_NOT_FOUND`); code collision → `RATE_PLAN_CODE_EXISTS`
   - BAR: `code` may not change away from `BAR` (→ `DEFAULT_RATE_PLAN_PROTECTED`); `name` may change
   - Emit `rate_plan.changed` with `op: 'update'`
4. **`tryDeleteRatePlan(actor, input, idem)`** — archive (§2.2).
   - BAR → `DEFAULT_RATE_PLAN_PROTECTED`
   - Already archived / missing → `RATE_PLAN_NOT_FOUND`
   - Emit `rate_plan.changed` with `op: 'archive'`
5. **`tryUpsertRateDay(actor, input, idem)`** — signature gains `actor` and `ratePlanId?: string` (update every direct call site: handlers + DO tests); add `gatePermission`; resolve default → `ensureDefaultRatePlanSync` when default → validate active plan (§2.4); precise error union (§2.9); keep emitting `rate.changed`.
6. **`tryBulkUpdateRates(actor, input, idem)`** — §2.6 / §2.5a (normalize before sort).
7. **`listRatePlans()`** — read RPC for `GET …/rate-plans`; returns `status = 'active'` rows only.
8. **`quoteStay` / `postRoomChargesSync`** — `DEFAULT_RATE_PLAN_ID` (§2.7). No plan-table read required on these paths (rate_day lookup by id is enough; seed guarantees BAR exists for writes that matter).

### `packages/contracts/src/v1-http-routes.ts` [MODIFY]

Append after housekeeping routes (current array ends at `get_housekeeping_assignments`, index 32 → new indices 33–38):

```ts
  { id: 'post_rate_plans', scope: 'property', permission: 'rates:write', commandId: 'rates.create_plan' },
  { id: 'patch_rate_plan', scope: 'property', permission: 'rates:write', commandId: 'rates.update_plan' },
  { id: 'delete_rate_plan', scope: 'property', permission: 'rates:write', commandId: 'rates.delete_plan' },
  { id: 'get_rate_plans', scope: 'property', permission: 'rates:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
  { id: 'put_room_type_rate', scope: 'property', permission: 'rates:write', commandId: 'rates.update_room_type_rate' },
  { id: 'post_rates_bulk', scope: 'property', permission: 'rates:write', commandId: 'rates.bulk_update' },
```

`get_rate_plans` is `FAIL_CLOSED` — no KV projection; same honesty rule as `get_folio` / `get_rooms`. Existing `put_rate_days` (`rates.upsert_day`) unchanged except its handler's default constant (§2.7) and the DO-side validation it inherits.

### `apps/pms-core/src/v1-dispatch.ts` [MODIFY]

| Route | Pattern | Notes |
|---|---|---|
| `post_rate_plans` | `POST` `/^\/v1\/properties\/([^/]+)\/rate-plans$/` | Body: `{ ratePlanId, code, name, idempotencyKey }` — `FAIL_CLOSED` |
| `patch_rate_plan` | `PATCH` `/^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/` | Body: `{ code?, name?, idempotencyKey }` — at least one of `code`/`name` |
| `delete_rate_plan` | `DELETE` `/^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/` | Idempotency via `x-idempotency-key` header or `idempotencyKey` query param — same as `handleDeleteRoomType` ([v1-dispatch.ts:451](../../../apps/pms-core/src/v1-dispatch.ts:451)); fingerprint `{ ratePlanId }` |
| `get_rate_plans` | `GET` `/^\/v1\/properties\/([^/]+)\/rate-plans$/` | Active plans only |
| `put_room_type_rate` | `PUT` `/^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)\/rates$/` | Body: `{ ratePlanId?, stayDate, amountMinor, currency, idempotencyKey }` — `roomTypeId` from path; shared normalize+fingerprint helper with `put_rate_days` (§2.5a); same DO call |
| `post_rates_bulk` | `POST` `/^\/v1\/properties\/([^/]+)\/rates\/bulk$/` | Body: `{ updates: [...], idempotencyKey }` — normalize each cell before sort/fingerprint (§2.5a, §2.6) |

`handlePutRateDays` / alias: normalize `ratePlanId` before fingerprint (§2.5a). Restriction handler untouched (`TYPE_WIDE_RATE_PLAN`).

Map new codes in the shared error-status helper (§2.9) — switch on the precise union, not string equality against undeclared magic.

### `apps/pms-core/src/pending-commands-consumer.ts`

**No changes.** All five commands (and `rates.upsert_day`) are `FAIL_CLOSED` — nothing queues, nothing replays.

---

## 5. Test Matrix

New file `apps/pms-core/test/rate-plans-routes.spec.ts`:

| # | Test | Assertion |
|---|---|---|
| 1 | Fresh property (migrations applied) | `rate_plan` row exists: id/code `BAR`, status `active` — proves seed |
| 2 | `POST /rate-plans` valid | `201`, `rate_plan.changed` outbox, row active |
| 3 | `POST /rate-plans` duplicate active `code` | `422 rate_plan_code_exists` |
| 4 | `PATCH /rate-plans/:id` rename `name` | `200`, `rate_plan.changed` |
| 5 | `PATCH` BAR's `code` away from `BAR` | `422 default_rate_plan_protected` |
| 6 | `DELETE /rate-plans/:id` (non-BAR) | `200`, status `archived`; active-code unique allows a new plan with the same `code` later |
| 7 | `DELETE` BAR | `422 default_rate_plan_protected` |
| 8 | `PUT …/rate-days` with `ratePlanId: 'CORP'` and no CORP plan | `404 rate_plan_not_found` — **the silent-write bug is closed** |
| 9 | Create CORP plan, then `PUT …/rate-days` with `CORP` | `200`, row stored under `CORP`; `quoteStay` without plan id still reads `BAR` only |
| 10 | `PUT …/rate-days` omitting `ratePlanId` | Defaults to `DEFAULT_RATE_PLAN_ID`, `200` |
| 11 | `PUT …/room-types/:id/rates` (update_room_type_rate alias) | Same DO effect as test 10; emits `rate.changed` not `rate_plan.changed` |
| 11a | **One** `idempotencyKey` string reused across both requests: (1) `PUT …/rate-days` omitting `ratePlanId`, (2) alias route with `ratePlanId: DEFAULT_RATE_PLAN_ID` (or reverse). Fresh keys make this test pass vacuously. | Second is an idempotent replay (`200`), **not** `IdempotencyKeyReused` — proves §2.5a normalization |
| 12 | Archive CORP, then `PUT …/rate-days` with `CORP` | `404 rate_plan_not_found`; pre-archive `rate_day` rows still in SQLite |
| 13 | `POST …/rates/bulk` two cells, both valid | `200`, two `rate_day` rows, two `rate.changed` events |
| 13a | **One** `idempotencyKey` reused: (1) bulk with a cell omitting `ratePlanId`, (2) identical bulk except that cell is `DEFAULT_RATE_PLAN_ID`. Fresh keys make this pass vacuously. | Idempotent replay (`200`), not `IdempotencyKeyReused` — default resolved before sort/hash (§2.5a) |
| 14 | `POST …/rates/bulk` one valid + one unknown plan | Whole batch aborted — zero new/updated rows from this command |
| 15 | Orphan pre-slice rows: SQL-insert `rate_day` under `'ORPHAN'` with no plan; `quoteStay` default | Still quotes `BAR` only; explicit quote with `ORPHAN` can still read the orphan amounts (read path does not require plan row) |
| 16 | Create plan with `ratePlanId: 'ORPHAN'` after orphan rows exist (no `rate_plan` row) | `201`; subsequent rate writes under `ORPHAN` succeed — adoption (§2.6a) |
| 16a | `POST /rate-plans` with an `ratePlanId` that already has an **active** plan | `422 rate_plan_id_exists` |
| 16b | Archive CORP, then `POST /rate-plans` with the same `ratePlanId` | `422 rate_plan_id_exists` — does **not** un-archive (§2.6a) |
| 17 | `staff` on `POST /rate-plans` | `403` (`rates:write` not granted to staff — owner/admin only per `ROLE_GRANTS`) |
| 18 | `staff` on `GET /rate-plans` | `200` (`rates:read` granted) |
| 19 | Non-member on any rate-plan route | `404` (RBAC privacy) |
| 20 | Kill-switch on plan / bulk routes | `503`, empty body |
| 21 | Unentitled org on `POST /rate-plans` / bulk | `402 entitlement_required` |
| 22 | `check:entitlements` after catalog edit | Five commands have `entitlement`; opt-out list has no `rates.*` rows; removing either half fails the script |

Extend existing rate / night-audit tests lightly:

| # | Scenario | Assertion |
|---|---|---|
| 23 | `quoteStay` with no `ratePlanId` | Uses `DEFAULT_RATE_PLAN_ID` (refactor lock — behaviour unchanged) |
| 24 | `POST_ROOM_CHARGES` happy path | Still posts from `DEFAULT_RATE_PLAN_ID` rates (constant, not literal `'BAR'` in source) |
| 25 | `PUT …/restriction-days` omitting `ratePlanId` | Still defaults to `TYPE_WIDE_RATE_PLAN`; no plan-table validation — §2.3 lock |

One degraded smoke (not a new protocol surface):

| # | Scenario | Assertion |
|---|---|---|
| 26 | `POST /rate-plans` while PropertyDO blocked | Degraded `503`, **not** queued — locks `FAIL_CLOSED` at the dispatcher |

---

## 6. Open Questions — Resolved

1. **Deploy day / existing `'BAR'` rate days.** **Seed in v12 + `ensureDefaultRatePlanSync`; no FK.** Application validation on write only. Orphans under non-BAR ids remain readable and are adoptable by create-with-matching-id **when no plan row exists** (§2.1, §2.6a).
2. **`rates.delete_plan` with existing `rate_day` rows.** **Archive; leave rate days; reject new writes; BAR is not archivable** (`DEFAULT_RATE_PLAN_PROTECTED`) (§2.2).
3. **`'*'` on restrictions.** **Stays. Type-wide only in Phase 1.** Restriction writes do not consult `rate_plan`. Plan-scoped restrictions are a later slice (§2.3).
4. **Entitlement opt-outs.** **Deleted in the same commit as `entitlement: 'pms.core'` on all five commands** (§2.8).
5. **Create with an existing `rate_plan_id`.** **Reject `RATE_PLAN_ID_EXISTS` for both active and archived** — never un-archive via create (§2.6a).
6. **Where does `ratePlanId` default?** **Inside the DO** (`ratePlanId?: string`), with the same normalize-before-fingerprint at every HTTP edge (§2.4, §2.5a).

---

## 7. Implementation Checklist

- [x] **Prerequisite:** event-consumer accepts rooms/housekeeping + all catalog event types (`7f1b569`) — do not regress the allowlist test.
- [ ] `DEFAULT_RATE_PLAN_ID` export next to `TYPE_WIDE_RATE_PLAN`; readers + DO write default (§2.7).
- [ ] Migration **v12** — `rate_plan` table + partial unique index + BAR seed; regenerate DDL; **no FK** from `rate_day` (§2.1, §3).
- [ ] Catalog: `entitlement: 'pms.core'` on five commands; `events` → `rate.changed` on `update_room_type_rate` / `bulk_update`; `delete_plan` notes; **delete five opt-out rows** — one commit (§2.5, §2.8). Confirm `rate_plan.changed` still passes the catalog allowlist test (already in consumer).
- [ ] Four wire codes + re-exports (§2.9).
- [ ] `ensureDefaultRatePlanSync` + `tryCreateRatePlan` (id collisions §2.6a) / `tryUpdateRatePlan` / `tryDeleteRatePlan` / actor-gated `tryUpsertRateDay` (optional `ratePlanId`, precise union) / `tryBulkUpdateRates` / `listRatePlans` (§4).
- [ ] Shared `normalizeRateDayCell` (or equivalent) used by `put_rate_days`, alias route, and bulk before fingerprint (§2.5a).
- [ ] Six route-audit rows (indices 33–38) + dispatcher handlers + error-status mapping on the precise union.
- [ ] **Do not** validate restriction writes against `rate_plan`; **do not** add `REPLAY_DISPATCH` entries; **do not** invent a new event type without a consumer case.
- [ ] `rate-plans-routes.spec.ts` (cases 1–22 incl. 11a / 13a / 16a / 16b) + quote/night-audit/restriction locks (23–25) + degraded smoke (26).
- [ ] `pnpm build`, `check:ddl`, `check:degraded`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`.

---

## 8. Explicitly deferred (do not pull into implementation)

| Item | Why deferred |
|---|---|
| OrgDO-hosted / chain-wide rate plans | ARCHITECTURE §7.2; Phase 1 is property-local like `room_type` |
| ~~Derived / linked plans ("BAR − 10%") \| Needs derivation workflow + `rate_plan.changed` rematerialization~~ **Closed (property-local half)** in [2026-08-15 derived rate plans](./2026-08-15-derived-rate-plans-design.md). |
| Plan-scoped restrictions | Type-wide `'*'` is correct for Phase 1 (§2.3) |
| FK `rate_day` → `rate_plan` | Deploy-day orphan hazard (§2.1) |
| Date-range fill / LOS pricing on bulk | Explicit cell list only (§2.6) |
| Channel rate mapping | Distribution surface, separate vertical |
| Staff / payments | Different risk class; staff fork still open |
| `READ_STALE` rate-plan projection | No projection consumer yet |
| Hard-delete of archived plans | Archive-only; YAGNI until a purge policy exists |
| Un-archive / revive archived plan | Create rejects archived ids (§2.6a); no revive command this slice |

`GET /rate-days` added by [property setup SPA](./2026-08-13-property-setup-spa-design.md). Plan-scoped `rate_plan_id ≠ '*'` restrictions stay out.
