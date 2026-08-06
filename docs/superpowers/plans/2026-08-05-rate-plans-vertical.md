# Rate Plans Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a property-local `rate_plan` entity, validate every `rate_day` write against an active plan (closing silent-`CORP`), route plan CRUD + `update_room_type_rate` + `bulk_update`, and replace hardcoded `'BAR'` with `DEFAULT_RATE_PLAN_ID`.

**Architecture:** Additive PropertyDO schema (v12: `rate_plan` + BAR seed, **no FK** from `rate_day`). Application-level active-plan checks on upsert/bulk. Defaulting lives in the DO (`ratePlanId?: string`); HTTP normalizes with the same default **before** fingerprinting so alias + bulk idempotency commute. All five `rates.*` commands stay `FAIL_CLOSED` with `entitlement: 'pms.core'`; opt-outs deleted in the same commit. No `REPLAY_DISPATCH` changes.

**Tech Stack:** Cloudflare Durable Objects SQLite, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, pnpm workspaces, existing `gatePermission` / `gateCoreEntitlement` / `runIdempotent` / `V1_HTTP_ROUTE_AUDIT` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md`](../specs/2026-08-05-rate-plans-vertical-design.md) (v2, settled)

**Prerequisite (already on main):** `7f1b569` — event-consumer catalog allowlist. Do not regress `test/events-queue.spec.ts` catalog allowlist. Plan CRUD keeps emitting `rate_plan.changed` (already accepted).

## Global Constraints

- **No FK** from `rate_day` → `rate_plan`. Seed BAR in v12; `ensureDefaultRatePlanSync` is belt-and-braces only.
- Restriction writes stay on `TYPE_WIDE_RATE_PLAN` (`'*'`) — never validate against `rate_plan`.
- `LaneGuard`: `touchInteractive()` only — no `touchBulk` for `rates.bulk_update`.
- Six new route rows: `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` must append in **identical order** in the same commit (`check:permissions` is element-wise by index).
- Catalog entitlement + opt-out deletion are **one commit** (`check:entitlements` fails either half alone).
- Daily rate writes emit `rate.changed`; plan CRUD emits `rate_plan.changed`. Never invent a new event type without a consumer case (allowlist test).
- Spec + plan may ride in the final implementation commit (folio/rooms precedent); do not leave the spec untracked across a partial ship.
- TDD: adversarial tests (7, 8, 11a, 13a, 16b) must be written so the mutations below fail.

### Reviewer mutation targets (construct tests so these fail)

| Mutation | Must be caught by |
|---|---|
| Fingerprint **before** defaulting (omit vs `'BAR'` hash differently) | Tests **11a** and **13a** — both reuse **one** `idempotencyKey` across the two shapes; fresh keys make them pass vacuously |
| Drop the active-plan check on `rate_day` writes | Test **8** (silent-`CORP`) |
| Un-archive on create-with-archived-id | Test **16b** |
| Allow BAR to be archived | Test **7** |

**Same-key lock for 11a / 13a (copy into the test file):**

```ts
// CRITICAL: one key string for both requests. crypto.randomUUID() per request
// makes these tests pass even if fingerprint normalization is broken.
const sharedKey = `idem-norm-${crypto.randomUUID()}`;
```

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | Four rate-plan wire codes |
| `packages/contracts/src/idempotency.test.ts` | Constant string locks |
| `packages/contracts/src/commands/catalog.ts` | Entitlements; `rate.changed` on update/bulk; delete_plan notes |
| `packages/contracts/src/entitlements.ts` | Delete five `rates.*` opt-out rows |
| `packages/contracts/src/register.test.ts` | Catalog / entitlement assertions |
| `packages/contracts/src/v1-http-routes.ts` | Six audit rows (indices 33–38) |
| `packages/do-runtime/src/property-migrations.ts` | `DEFAULT_RATE_PLAN_ID` + v12 statements |
| `packages/do-runtime/src/index.ts` | Re-exports |
| `packages/do-runtime/src/migrate.test.ts` | DDL sync for `0012_*.sql` |
| `scripts/property-ddl.mjs` | Wire `0012_*.sql` target |
| `migrations/do-property/0012_*.sql` | Generated |
| `apps/pms-core/src/property-do.ts` | Plan CRUD, upsert/bulk, ensure, de-hardcode readers |
| `apps/pms-core/src/v1-dispatch.ts` | `normalizeRateDayCell`, six handlers, error map, `V1_ROUTES` |
| `apps/pms-core/test/rate-plans-routes.spec.ts` | HTTP matrix (cases 1–22 + 11a/13a/16a/16b) |
| `apps/pms-core/test/restrictions-rates.spec.ts` | Actor arg + `DEFAULT_RATE_PLAN_ID` |
| `apps/pms-core/test/night-audit-room-charges.spec.ts` | Actor arg + constant |
| `apps/pms-core/test/degraded-mode.spec.ts` | Case 26 smoke |
| `docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md` | Include in final commit |
| `docs/superpowers/plans/2026-08-05-rate-plans-vertical.md` | Include in final commit |

---

### Task 1: Contracts — wire codes + catalog + entitlements

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/entitlements.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `RATE_PLAN_NOT_FOUND = 'rate_plan_not_found'`, `RATE_PLAN_CODE_EXISTS = 'rate_plan_code_exists'`, `RATE_PLAN_ID_EXISTS = 'rate_plan_id_exists'`, `DEFAULT_RATE_PLAN_PROTECTED = 'default_rate_plan_protected'`
- Produces: five `rates.*` catalog entries with `entitlement: 'pms.core'`; `update_room_type_rate` / `bulk_update` with `events: ['rate.changed']`; `delete_plan.notes` mentioning archive + BAR
- Produces: `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` with **zero** `rates.*` rows

- [ ] **Step 1: Add wire codes + failing register tests (RED)**

```ts
// idempotency.ts
export const RATE_PLAN_NOT_FOUND = 'rate_plan_not_found' as const;
export const RATE_PLAN_CODE_EXISTS = 'rate_plan_code_exists' as const;
export const RATE_PLAN_ID_EXISTS = 'rate_plan_id_exists' as const;
export const DEFAULT_RATE_PLAN_PROTECTED = 'default_rate_plan_protected' as const;
```

Lock strings in `idempotency.test.ts`. In `register.test.ts`:

```ts
it('rates plan commands are FAIL_CLOSED with pms.core and no opt-out', () => {
  const ids = [
    'rates.create_plan',
    'rates.update_plan',
    'rates.delete_plan',
    'rates.update_room_type_rate',
    'rates.bulk_update',
  ] as const;
  for (const id of ids) {
    const c = COMMAND_CATALOG.find((x) => x.id === id);
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('rates:write');
    expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((r) => r.id === id)).toBe(false);
  }
});

it('rates.update_room_type_rate and rates.bulk_update emit rate.changed', () => {
  for (const id of ['rates.update_room_type_rate', 'rates.bulk_update'] as const) {
    expect(COMMAND_CATALOG.find((x) => x.id === id)?.events).toEqual(['rate.changed']);
  }
});

it('rates.create_plan / update_plan / delete_plan emit rate_plan.changed', () => {
  for (const id of ['rates.create_plan', 'rates.update_plan', 'rates.delete_plan'] as const) {
    expect(COMMAND_CATALOG.find((x) => x.id === id)?.events).toEqual(['rate_plan.changed']);
  }
});
```

- [ ] **Step 2: Run register tests — expect FAIL**

Run: `pnpm --filter @hospai/contracts test -- register.test.ts`
Expected: FAIL — missing entitlements / wrong events / opt-outs still present.

- [ ] **Step 3: Catalog + opt-out edits (GREEN)**

For each of the five commands, add `entitlement: 'pms.core'`.
Change `rates.update_room_type_rate` and `rates.bulk_update` `events` to `['rate.changed']`.
Add `notes` on `rates.delete_plan`:
`'Archives (status=archived); never hard-deletes. BAR is not archivable.'`

Delete these five rows from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` in the **same** edit:
`rates.create_plan`, `rates.update_plan`, `rates.delete_plan`, `rates.update_room_type_rate`, `rates.bulk_update`.

- [ ] **Step 4: Re-run contracts tests + entitlements check**

Run:
```bash
pnpm --filter @hospai/contracts test
pnpm check:entitlements
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts packages/contracts/src/entitlements.ts \
  packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): gate rates.* commands and add rate-plan wire codes

Retire Phase-1 entitlement opt-outs for the five rates commands, emit
rate.changed for daily rate writes, and add precise plan error codes.
EOF
)"
```

---

### Task 2: Migration v12 + `DEFAULT_RATE_PLAN_ID`

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `migrations/do-property/0012_rate_plan.sql` (via generator)

**Interfaces:**
- Produces: `DEFAULT_RATE_PLAN_ID = 'BAR' as const` (next to `TYPE_WIDE_RATE_PLAN`)
- Produces: `RATE_PLAN_V12_STATEMENTS` / `RATE_PLAN_V12_SQL`; `PROPERTY_MIGRATIONS` version **12**
- Produces: generated `0012_rate_plan.sql`

- [ ] **Step 1: Add constant + statements + migration entry**

In `property-migrations.ts` immediately after `TYPE_WIDE_RATE_PLAN`:

```ts
/** Default rate plan id — seeded per property; readers/writers must use this constant. */
export const DEFAULT_RATE_PLAN_ID = 'BAR' as const;
```

Append:

```ts
/** v12 — rate_plan entity + seed DEFAULT_RATE_PLAN_ID. No FK from rate_day. */
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

export const RATE_PLAN_V12_SQL =
  RATE_PLAN_V12_STATEMENTS.join(';\n\n') + ';\n';
```

Add `{ version: 12, name: 'rate_plan', statements: RATE_PLAN_V12_STATEMENTS }` to `PROPERTY_MIGRATIONS`.

Re-export from `index.ts`: `DEFAULT_RATE_PLAN_ID`, `RATE_PLAN_V12_STATEMENTS`, `RATE_PLAN_V12_SQL`.

- [ ] **Step 2: Wire DDL generator + sync test**

In `scripts/property-ddl.mjs`: import `RATE_PLAN_V12_SQL`; append target:

```js
{
  path: join(root, 'migrations/do-property/0012_rate_plan.sql'),
  header: `-- PropertyDO rate_plan + BAR seed — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
  sql: RATE_PLAN_V12_SQL,
},
```

In `migrate.test.ts`, mirror the v11 sync test for `0012_rate_plan.sql` / `RATE_PLAN_V12_SQL`.

- [ ] **Step 3: Generate DDL and verify**

```bash
pnpm generate:ddl
pnpm --filter @hospai/do-runtime test
pnpm check:ddl
```
Expected: PASS; `migrations/do-property/0012_rate_plan.sql` exists with BAR seed and **no** `FOREIGN KEY` on `rate_day`.

- [ ] **Step 4: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts scripts/property-ddl.mjs \
  migrations/do-property/0012_rate_plan.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): add rate_plan table and seed BAR default plan

Property-local plan entity with active-code uniqueness; no FK from
rate_day so pre-existing orphan plan ids cannot abort deploy.
EOF
)"
```

---

### Task 3: PropertyDO — plan CRUD + ensure helper

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`

**Interfaces:**
- Consumes: `DEFAULT_RATE_PLAN_ID`, four wire codes, `ActorContext`, `IdempotencyKey`
- Produces:
  - `ensureDefaultRatePlanSync(): void`
  - `tryCreateRatePlan(actor, { ratePlanId, code, name }, idem)`
  - `tryUpdateRatePlan(actor, { ratePlanId, code?, name? }, idem)`
  - `tryDeleteRatePlan(actor, { ratePlanId }, idem)` — archives
  - `listRatePlans(): Promise<Array<{ ratePlanId, code, name, status }>>` — active only

- [ ] **Step 1: Implement `ensureDefaultRatePlanSync`**

Private sync method:

```ts
private ensureDefaultRatePlanSync(): void {
  const now = Date.now();
  this.ctx.storage.sql.exec(
    `INSERT OR IGNORE INTO rate_plan (rate_plan_id, code, name, status, created_at, updated_at)
     VALUES (?, ?, 'Best Available Rate', 'active', ?, ?)`,
    DEFAULT_RATE_PLAN_ID,
    DEFAULT_RATE_PLAN_ID,
    now,
    now,
  );
}
```

- [ ] **Step 2: Implement `tryCreateRatePlan`**

Gates: `touchInteractive`, `gateCoreEntitlement`, `gatePermission(actor, 'rates:write')`.
Fingerprint allowlist: `{ ratePlanId, code, name }`.

Inside `execute()`:
1. `SELECT status FROM rate_plan WHERE rate_plan_id = ?` — if any row → throw/return `RATE_PLAN_ID_EXISTS` (active **or** archived — never un-archive).
2. Active code collision → `RATE_PLAN_CODE_EXISTS`.
3. Insert `status = 'active'`; emit `rate_plan.changed` with `{ propertyId, ratePlanId, op: 'create', at }`.

Return precise union including `RATE_PLAN_ID_EXISTS` | `RATE_PLAN_CODE_EXISTS` | entitlement / permission / idem errors.

- [ ] **Step 3: Implement `tryUpdateRatePlan` / `tryDeleteRatePlan`**

Update: target must be `active` else `RATE_PLAN_NOT_FOUND`. If `code` changes away from `BAR` on `DEFAULT_RATE_PLAN_ID` → `DEFAULT_RATE_PLAN_PROTECTED`. Code collision → `RATE_PLAN_CODE_EXISTS`. Emit `op: 'update'`.

Delete (archive): if `ratePlanId === DEFAULT_RATE_PLAN_ID` → `DEFAULT_RATE_PLAN_PROTECTED`. Missing/archived → `RATE_PLAN_NOT_FOUND`. Else `UPDATE … SET status = 'archived'`. Emit `op: 'archive'`. **Never** `DELETE FROM rate_plan`.

- [ ] **Step 4: Implement `listRatePlans`**

`SELECT … WHERE status = 'active' ORDER BY code`.

- [ ] **Step 5: Smoke via DO test or wait for Task 6 HTTP tests**

If writing a thin DO smoke now:

```ts
const stub = await provisionedPropertyStub(...);
const plans = await stub.listRatePlans();
expect(plans.some((p) => p.ratePlanId === DEFAULT_RATE_PLAN_ID)).toBe(true);
```

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): rate plan create/update/archive and BAR ensure helper

Archive-only delete; BAR protected; id collisions reject without revive.
EOF
)"
```

---

### Task 4: PropertyDO — gated `tryUpsertRateDay` + de-hardcode readers

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/restrictions-rates.spec.ts`
- Modify: `apps/pms-core/test/night-audit-room-charges.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_RATE_PLAN_ID`, `RATE_PLAN_NOT_FOUND`, `ActorContext`
- Produces: `tryUpsertRateDay(actor, input: { roomTypeId, ratePlanId?, stayDate, amountMinor, currency }, idem)` with precise error union including `RATE_PLAN_NOT_FOUND` | `ENTITLEMENT_REQUIRED` | `ENTITLEMENT_UNAVAILABLE` | `FORBIDDEN` | `'not_member'` | `IDEM_KEY_REUSED`

- [ ] **Step 1: Update call sites to pass actor (compile RED then fix)**

```ts
// restrictions-rates.spec.ts / night-audit-room-charges.spec.ts
await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, { ...rate, ratePlanId: DEFAULT_RATE_PLAN_ID }, idem);
```

Import `DEFAULT_RATE_PLAN_ID` from `@hospai/do-runtime`; stop using bare `'BAR'` when meaning the default.

- [ ] **Step 2: Rewrite `tryUpsertRateDay`**

```ts
async tryUpsertRateDay(
  actor: ActorContext,
  input: {
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
  },
  idem: IdempotencyKey,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' }
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof IDEM_KEY_REUSED }
  | { ok: false; error: string }
> {
  this.lanes.touchInteractive();
  // orgId / propertyId guards…
  const denied = await this.gateCoreEntitlement(orgId);
  if (denied) return denied;
  const permDenied = await this.gatePermission(actor, 'rates:write');
  if (permDenied) return permDenied;

  const ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID;

  return this.ctx.storage.transactionSync(() =>
    runIdempotent(this.ctx.storage.sql, idem, () => {
      if (ratePlanId === DEFAULT_RATE_PLAN_ID) this.ensureDefaultRatePlanSync();
      const planRows = this.ctx.storage.sql
        .exec(
          `SELECT status FROM rate_plan WHERE rate_plan_id = ?`,
          ratePlanId,
        )
        .toArray() as Array<{ status: string }>;
      if (!planRows[0] || planRows[0].status !== 'active') {
        throw new RatePlanNotFoundError(); // map to RATE_PLAN_NOT_FOUND in catch
      }
      // existing INSERT … ON CONFLICT upsert + rate.changed outbox
      // use ratePlanId (resolved), not input.ratePlanId
      return { ok: true as const };
    }),
  );
}
```

Add a small `RatePlanNotFoundError` class (or return-style inside execute if the codebase prefers — match `RoomTypeNotFoundError` throw→map pattern used nearby).

- [ ] **Step 3: De-hardcode `quoteStay` and `postRoomChargesSync`**

```ts
const ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID;
// …
DEFAULT_RATE_PLAN_ID, // was 'BAR' in postRoomChargesSync
```

- [ ] **Step 4: Run existing rate + night-audit tests**

```bash
cd apps/pms-core && pnpm test -- test/restrictions-rates.spec.ts test/night-audit-room-charges.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/restrictions-rates.spec.ts \
  apps/pms-core/test/night-audit-room-charges.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): validate rate_day writes against active rate plans

Default ratePlanId inside the DO, reject missing/archived plans, and
replace hardcoded BAR literals on quote and night-audit paths.
EOF
)"
```

---

### Task 5: PropertyDO — `tryBulkUpdateRates`

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`

**Interfaces:**
- Produces: `tryBulkUpdateRates(actor, { updates: Array<{ roomTypeId, ratePlanId?, stayDate, amountMinor, currency }> }, idem)`
- Fingerprint input (after normalize+sort): `{ updates: NormalizedCell[] }`

- [ ] **Step 1: Implement**

```ts
async tryBulkUpdateRates(
  actor: ActorContext,
  input: {
    updates: Array<{
      roomTypeId: string;
      ratePlanId?: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
    }>;
  },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; count: number }
  | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' }
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof IDEM_KEY_REUSED }
  | { ok: false; error: string }
> {
  // gates identical to tryUpsertRateDay
  // Inside execute:
  // 1. normalize each cell: ratePlanId = u.ratePlanId ?? DEFAULT_RATE_PLAN_ID
  // 2. sort by (roomTypeId, ratePlanId, stayDate)
  // 3. for each: ensure if default; active-plan check; upsert; append rate.changed
  // Any failure throws → whole txn rolls back
}
```

Call `touchInteractive()` — not a bulk lane API.

Note: HTTP layer also normalizes+sorts before fingerprint (§2.5a). The DO must re-normalize so direct stub calls are safe; fingerprint at the edge must use the **same** normalize+sort order as documented in Task 6.

- [ ] **Step 2: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): all-or-nothing rates.bulk_update

Normalize ratePlanId before applying cells; one rate.changed per cell.
EOF
)"
```

---

### Task 6: HTTP routes — normalize helper + six handlers

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`

**Interfaces:**
- Produces: `normalizeRateDayCell(input) => { roomTypeId, ratePlanId, stayDate, amountMinor, currency }` with `ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID`
- Produces: audit rows indices 33–38 + matching `V1_ROUTES` entries in the same order
- Produces: error map — `RATE_PLAN_CODE_EXISTS` / `RATE_PLAN_ID_EXISTS` / `DEFAULT_RATE_PLAN_PROTECTED` → 422; `RATE_PLAN_NOT_FOUND` → 404 (via existing not-found path or explicit)

- [ ] **Step 1: Append audit rows**

In `v1-http-routes.ts` after `get_housekeeping_assignments`:

```ts
  { id: 'post_rate_plans', scope: 'property', permission: 'rates:write', commandId: 'rates.create_plan' },
  { id: 'patch_rate_plan', scope: 'property', permission: 'rates:write', commandId: 'rates.update_plan' },
  { id: 'delete_rate_plan', scope: 'property', permission: 'rates:write', commandId: 'rates.delete_plan' },
  { id: 'get_rate_plans', scope: 'property', permission: 'rates:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
  { id: 'put_room_type_rate', scope: 'property', permission: 'rates:write', commandId: 'rates.update_room_type_rate' },
  { id: 'post_rates_bulk', scope: 'property', permission: 'rates:write', commandId: 'rates.bulk_update' },
```

- [ ] **Step 2: Shared normalize + rewrite `handlePutRateDays`**

```ts
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';

export function normalizeRateDayCell(input: {
  roomTypeId: string;
  ratePlanId?: string;
  stayDate: string;
  amountMinor: number;
  currency: string;
}) {
  return {
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanId ?? DEFAULT_RATE_PLAN_ID,
    stayDate: input.stayDate,
    amountMinor: input.amountMinor,
    currency: input.currency,
  };
}
```

In `handlePutRateDays`: build cell via `normalizeRateDayCell`, fingerprint **normalized** cell, call `tryUpsertRateDay(actor, normalized, idem)`. Pass actor from `ctx.actor` (`{ kind: 'user', userId: ctx.actor.userId }`).

- [ ] **Step 3: Implement remaining handlers**

| Handler | Notes |
|---|---|
| `handlePostRatePlans` | Body `{ ratePlanId, code, name, idempotencyKey }` → `tryCreateRatePlan` |
| `handlePatchRatePlan` | Path id + `{ code?, name?, idempotencyKey }` |
| `handleDeleteRatePlan` | Idempotency via `x-idempotency-key` or `?idempotencyKey=` — copy `handleDeleteRoomType` |
| `handleGetRatePlans` | `listRatePlans()` → 200 |
| `handlePutRoomTypeRate` | Path `roomTypeId` + body; **same** `normalizeRateDayCell` + fingerprint as put_rate_days |
| `handlePostRatesBulk` | Normalize each cell, sort by `(roomTypeId, ratePlanId, stayDate)`, fingerprint `{ updates: sorted }`, call `tryBulkUpdateRates` |

Extend `mapReservationCommandErrorStatus`:

```ts
error === RATE_PLAN_CODE_EXISTS ||
error === RATE_PLAN_ID_EXISTS ||
error === DEFAULT_RATE_PLAN_PROTECTED
// → 422

// RATE_PLAN_NOT_FOUND → 404: either add explicit branch or ensure mapAddRoomTypeErrorStatus / NOT_FOUND path covers it.
```

Prefer an explicit `if (error === RATE_PLAN_NOT_FOUND) return 404` for clarity.

- [ ] **Step 4: Append `V1_ROUTES` in identical order to audit rows**

Patterns from the spec §4 dispatch table. `FAIL_CLOSED` routes use normal DO invoke (transport failure → degraded 503) — no queueing.

- [ ] **Step 5: Run permission / degraded checks**

```bash
pnpm check:permissions
pnpm check:degraded
pnpm --filter @hospai/pms-core typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): HTTP routes for rate plans, alias rate write, and bulk

Normalize ratePlanId before fingerprinting so alias and bulk idempotency
keys commute across omitted vs explicit BAR.
EOF
)"
```

---

### Task 7: HTTP test matrix — including mutation-discriminating cases

**Files:**
- Create: `apps/pms-core/test/rate-plans-routes.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts` (case 26)

**Interfaces:**
- Consumes: HTTP surface from Task 6; `DEFAULT_RATE_PLAN_ID`; wire codes
- Produces: coverage for spec cases 1–22 (incl. 11a, 13a, 16a, 16b), 23–25 locks as needed, 26 degraded smoke

- [ ] **Step 1: Scaffold helpers** (mirror `rooms-routes.spec.ts`: `postOrg`, `postProperty`, `postRoomType`, actor headers)

- [ ] **Step 2: Write mutation-critical tests FIRST (RED until Tasks 3–6 complete — should already be GREEN if prior tasks done; if implementing out of order, write these before green paths)**

**Test 8 — silent CORP (must fail if plan check dropped):**

```ts
it('8. PUT rate-days with unknown CORP plan is 404', async () => {
  // provision property + room type; do NOT create CORP plan
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${propertyId}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        ratePlanId: 'CORP',
        stayDate: '2026-08-10',
        amountMinor: 10000,
        currency: 'USD',
        idempotencyKey: `idem-corp-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error ?? body).toMatchObject({ error: RATE_PLAN_NOT_FOUND });
  // or expect(await res.json()).toEqual({ ok: false, error: RATE_PLAN_NOT_FOUND })
  // match whatever shape siblings use (folio/rooms)
});
```

**Test 7 — BAR archive protected:**

```ts
it('7. DELETE BAR is 422 default_rate_plan_protected', async () => {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${propertyId}/rate-plans/${DEFAULT_RATE_PLAN_ID}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': owner,
          'x-idempotency-key': `idem-del-bar-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ ok: false, error: DEFAULT_RATE_PLAN_PROTECTED });
});
```

**Test 11a — same key across omit vs explicit BAR:**

```ts
it('11a. alias and rate-days share fingerprint for omitted vs BAR', async () => {
  const sharedKey = `idem-norm-${crypto.randomUUID()}`; // ONE key — do not regenerate
  const stayDate = '2026-08-10';
  const base = {
    stayDate,
    amountMinor: 15000,
    currency: 'USD',
    idempotencyKey: sharedKey,
  };

  const first = await worker.fetch(
    new Request(`http://localhost/v1/properties/${propertyId}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
      body: JSON.stringify({ roomTypeId: 'rt_king', ...base }), // omit ratePlanId
    }),
    env,
  );
  expect(first.status).toBe(200);

  const second = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${propertyId}/room-types/rt_king/rates`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          ...base,
          ratePlanId: DEFAULT_RATE_PLAN_ID, // same cell, different wire shape
        }),
      },
    ),
    env,
  );
  expect(second.status).toBe(200);
  const body = await second.json();
  expect(body).not.toMatchObject({ error: IDEM_KEY_REUSED });
  expect(body.ok !== false).toBe(true);
});
```

**Test 13a — bulk same key:**

```ts
it('13a. bulk omit vs explicit BAR is idempotent under one key', async () => {
  const sharedKey = `idem-bulk-norm-${crypto.randomUUID()}`;
  const cellOmit = {
    roomTypeId: 'rt_king',
    stayDate: '2026-08-11',
    amountMinor: 11000,
    currency: 'USD',
  };
  const cellBar = { ...cellOmit, ratePlanId: DEFAULT_RATE_PLAN_ID };

  const first = await postBulk(propertyId, owner, { updates: [cellOmit], idempotencyKey: sharedKey });
  expect(first.status).toBe(200);
  const second = await postBulk(propertyId, owner, { updates: [cellBar], idempotencyKey: sharedKey });
  expect(second.status).toBe(200);
  expect(await second.json()).not.toMatchObject({ error: IDEM_KEY_REUSED });
});
```

**Test 16b — archived id recreate rejects:**

```ts
it('16b. create with archived ratePlanId does not un-archive', async () => {
  await postRatePlan(propertyId, owner, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
  await deleteRatePlan(propertyId, owner, 'CORP');
  const res = await postRatePlan(propertyId, owner, {
    ratePlanId: 'CORP',
    code: 'CORP2',
    name: 'Corp Again',
  });
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ ok: false, error: RATE_PLAN_ID_EXISTS });
  // GET rate-plans must not list CORP
  const listed = await getRatePlans(propertyId, owner);
  expect(listed.map((p) => p.ratePlanId)).not.toContain('CORP');
});
```

- [ ] **Step 3: Fill remaining matrix** (1–6, 9–10, 12–16, 16a, 17–22) per spec §5

Include:
- Case 1: fresh property has BAR seed (`listRatePlans` or GET)
- Case 16: adoption — SQL-insert orphan `rate_day` under `'ORPHAN'`, then create plan with that id → 201, subsequent rate write OK
- Case 17/18: staff 403 on write, 200 on GET
- Case 22: optional — rely on `pnpm check:entitlements` in Task 8; a unit assertion in register.test already covers catalog half

- [ ] **Step 4: Degraded smoke (case 26)**

In `degraded-mode.spec.ts`: block PropertyDO, `POST /rate-plans` → degraded 503, not queued (no pending command row).

- [ ] **Step 5: Run**

```bash
cd apps/pms-core && pnpm test -- test/rate-plans-routes.spec.ts test/degraded-mode.spec.ts
```
Expected: PASS. Manually sanity-check: temporarily break normalize (fingerprint raw wire) → 11a/13a must fail with `idempotency_key_reused`.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/test/rate-plans-routes.spec.ts apps/pms-core/test/degraded-mode.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): rate plans HTTP matrix with fingerprint and archive locks

11a/13a reuse one idempotency key across omit vs BAR; 7/8/16b pin
BAR protection, silent-CORP rejection, and no revive-on-create.
EOF
)"
```

---

### Task 8: Final verification + docs commit

**Files:**
- `docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md`
- `docs/superpowers/plans/2026-08-05-rate-plans-vertical.md`

- [ ] **Step 1: Full gate**

```bash
pnpm build
pnpm check:ddl
pnpm check:degraded
pnpm check:entitlements
pnpm check:permissions
pnpm check:class-denylist
pnpm typecheck
pnpm test --force
pnpm lint
```
Expected: all green. Confirm `events-queue` catalog allowlist still passes (no new undeclared event types).

- [ ] **Step 2: Grep guard**

```bash
# No remaining hardcoded BAR defaults in the three retired sites (allow DEFAULT_RATE_PLAN_ID and SQL seed)
rg -n "'BAR'" apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts
```
Expected: no `?? 'BAR'` / lookup `'BAR'` literals — only acceptable if comments. Seed SQL and `DEFAULT_RATE_PLAN_ID = 'BAR'` live in do-runtime.

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md \
  docs/superpowers/plans/2026-08-05-rate-plans-vertical.md
git commit -m "$(cat <<'EOF'
docs: rate plans vertical spec and implementation plan
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| v12 `rate_plan` + BAR seed, no FK | Task 2 |
| `ensureDefaultRatePlanSync` | Task 3 |
| create / update / archive + BAR protect + id collisions | Task 3, tests 7/16a/16b |
| Validate rate_day writes; DO defaulting | Task 4, test 8/10 |
| `update_room_type_rate` alias + normalize before fingerprint | Task 6, test 11a |
| `bulk_update` normalize-before-sort | Task 5–6, test 13a |
| De-hardcode BAR readers | Task 4 |
| Entitlement + opt-out same commit | Task 1 |
| `rate.changed` vs `rate_plan.changed` | Task 1 |
| Six routes 33–38 | Task 6 |
| Restrictions stay `*` | untouched; case 25 optional lock |
| No REPLAY_DISPATCH | none added |
| Consumer allowlist prerequisite | Task 8 verifies no regression |
| Precise unions + `ENTITLEMENT_UNAVAILABLE` | Task 4 |

No TBD/placeholder steps remain.
