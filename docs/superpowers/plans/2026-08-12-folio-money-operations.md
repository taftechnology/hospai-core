# Folio Money Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship folio window close/reopen, transfer, split v2, void/refund, check-out auto-capture with an explicit `autoCapture` outcome, §16.1 extras (no-post / damage hold / discount), and quote-snapshot pricing.

**Architecture:** Append-only ledger. Closed windows reject every `insertFolioLineSync`. Transfers and splits are reverse + new postings. Payments stay FAIL_CLOSED; live check-out awaits capture-due inline after the status txn commits and never fails the departure. Quote snapshot is the price source; consumed nights are retained on shorten.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/do-runtime` v21, `@hospai/money` `allocate` / `roundHalfAwayFromZero`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` (Approved v2). Spec commit: `eb7ae0acc4e66193d882e3302ea05a3994ba7490`.

## Global Constraints

- Folio is append-only. Never `UPDATE` `folio_line` amounts.
- CLOSED window rejects every insert (tax, reverse, night audit, transfer, capture). Never silently reopen.
- Payments stay `FAIL_CLOSED`. Nothing auto-resolves into money on provisional replay.
- Live `tryCheckOut` **awaits** capture-due inline (no `ctx.waitUntil`). Capture failure does not fail check-out. Success body always includes `autoCapture`.
- `NIGHT_AUDIT_STEPS` stays seven. No auto-transfer step.
- Route audit append-only: indices **95–103**. Catalog/routes are **different commits** (`check:permissions` stays green).
- `AUDIT_WRITER_COMMAND_IDS.size` goes 35 → **44** in Task 1.
- Drop `folio.transfer_charge` and `folio.split_charge_v2` from `PLATFORM_GAPS` in Task 1 (ids exist as real catalog rows).
- Fixture dates from property-local `business_date`. New tests key fixtures with `crypto.randomUUID()`.
- Living plan checkboxes: tick `- [x]` on the merged task in this file in the same PR. Do not backfill historical plans.
- No either/or forks. Do not reopen auto-close default `false`, reopen-as-explicit-exception, full-refund-only, or promo-deferred.
- Staff cannot `folio:adjust`. Void and capture-due use `folio:post`.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Nine commands; authorize `purpose`; drop two PLATFORM_GAPS |
| `packages/contracts/src/idempotency.ts` | Wire codes §10.3 |
| `packages/contracts/src/commands/audit-writers.ts` | +9; size 44 |
| `packages/contracts/src/config/register.ts` | Two keys |
| `packages/contracts/src/register.test.ts` | Size 44 (Task 1); route pins 95–103 (Task 12) |
| `apps/pms-core/src/event-consumer.ts` | Six new events (Task 1) |
| `packages/do-runtime/src/property-migrations.ts` | v21 + `SYSTEM_CHARGE_CODES` length 6 |
| `migrations/do-property/0021_folio_money_ops.sql` | Generated |
| `scripts/property-ddl.mjs` | 0021 target |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql + head 21 + on-disk match |
| `packages/do-runtime/src/folio-money-ops-migration.sqlite.test.ts` | Real-SQLite FK-on + CHECK |
| `apps/pms-core/src/psp-simulate.ts` | void + refund (Task 8) |
| `apps/pms-core/src/property-do.ts` | Gate, snapshot, windows, transfer, split v2, void/refund/capture-due, discount, check-out hook |
| `apps/pms-core/src/v1-dispatch.ts` | Routes 95–103; GET folio widen; check-out `autoCapture` (Task 12) |
| `packages/contracts/src/v1-http-routes.ts` | Indices 95–103 (Task 12 only) |
| `packages/client-core/src/api.ts` | Client methods (Task 13) |
| `apps/web-pms/src/screens/FolioScreen.tsx` | §14 (Task 13) |
| Sibling specs | Bidirectional one-liners (Task 14) |

## Test file split (spec §17 → file)

| Spec # | File |
|---|---|
| 1–14 | `apps/pms-core/test/folio-windows.spec.ts` (new) |
| 7 (CLOSED add_item, helper) | also Task 3 in `folio-windows.spec.ts` once helper exists; Task 6 reuses |
| 15–25 | `apps/pms-core/test/folio-transfer-split.spec.ts` (new) |
| 20 (v1 regression) | extend `apps/pms-core/test/folio-routes.spec.ts` Test 6 shape if already there; still assert in new file |
| 26–36, 39 | `apps/pms-core/test/folio-payment-lifecycle.spec.ts` (new) |
| 33, 34 | `apps/pms-core/test/reservations-check-out.spec.ts` (extend) |
| 37, 42–46 | `apps/pms-core/test/folio-quote-snapshot.spec.ts` (new) + `night-audit-room-charges.spec.ts` for 37 |
| 38, 40, 41 | `apps/pms-core/test/folio-extras.spec.ts` (new) |
| 47, 51 | `packages/contracts/src/register.test.ts` (Task 12) |
| 48 | `packages/do-runtime` migrate + sqlite tests (Task 2) |
| 49 | Task 15 gates |
| 50 | `apps/pms-core/test/events-queue.spec.ts` (Task 1 allowlist is the coverage) |
| 52–55 | `apps/web-pms/src/screens/FolioScreen.test.tsx` |

---

### Task 1: Contracts (own commit, no HTTP routes)

**Spec:** §10.1, §10.2 (catalog field notes), §10.3, §12, §17 tests 47 (size only), 50 (allowlist).

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/event-consumer.ts`
- Test: `packages/contracts` vitest + `apps/pms-core/test/events-queue.spec.ts`

**Interfaces:**
- Produces: nine catalog ids; wire codes below; `AUDIT_WRITER_COMMAND_IDS.size === 44`; two config keys; event-consumer cases; `PLATFORM_GAPS` without transfer/split_v2
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any `/folio/windows` handler, any DO method body.

- [x] **Step 1: Write the failing register + idempotency tests**

In `packages/contracts/src/idempotency.test.ts` add:

```ts
it('folio money-ops wire codes', () => {
  expect(WINDOW_CLOSED).toBe('window_closed');
  expect(WINDOW_NOT_CLOSABLE).toBe('window_not_closable');
  expect(WINDOW_BALANCE_DUE).toBe('window_balance_due');
  expect(WINDOW_NOT_REOPENABLE).toBe('window_not_reopenable');
  expect(WINDOW_NOT_OPENABLE).toBe('window_not_openable');
  expect(GUEST_WINDOW_NOT_OPENABLE).toBe('guest_window_not_openable');
  expect(TRANSFER_CROSS_RESERVATION).toBe('transfer_cross_reservation');
  expect(TRANSFER_SAME_WINDOW).toBe('transfer_same_window');
  expect(LINE_NOT_TRANSFERABLE).toBe('line_not_transferable');
  expect(LINE_NOT_DISCOUNTABLE).toBe('line_not_discountable');
  expect(PAYMENT_NOT_VOIDABLE).toBe('payment_not_voidable');
  expect(PAYMENT_NOT_REFUNDABLE).toBe('payment_not_refundable');
  expect(DISCOUNT_REASON_REQUIRED).toBe('discount_reason_required');
});
```

In `packages/contracts/src/register.test.ts`:

```ts
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(44);

it('folio money-ops commands are entitled FAIL_CLOSED INTERACTIVE', () => {
  const rows: Array<{
    id: string;
    permission: 'folio:adjust' | 'folio:post';
    events: string[];
  }> = [
    { id: 'folio.open_window', permission: 'folio:adjust', events: ['folio.window_opened'] },
    { id: 'folio.close_window', permission: 'folio:adjust', events: ['folio.window_closed'] },
    { id: 'folio.reopen_window', permission: 'folio:adjust', events: ['folio.window_reopened'] },
    {
      id: 'folio.transfer_charge',
      permission: 'folio:adjust',
      events: ['folio.line_posted', 'folio.charge_transferred'],
    },
    { id: 'folio.split_charge_v2', permission: 'folio:adjust', events: ['folio.line_posted'] },
    { id: 'folio.void', permission: 'folio:post', events: ['folio.payment_voided'] },
    {
      id: 'folio.refund',
      permission: 'folio:adjust',
      events: ['folio.payment_refunded', 'folio.line_posted'],
    },
    { id: 'folio.post_discount', permission: 'folio:adjust', events: ['folio.line_posted'] },
    {
      id: 'folio.capture_due',
      permission: 'folio:post',
      events: ['folio.payment_captured', 'folio.line_posted'],
    },
  ];
  for (const row of rows) {
    const c = COMMAND_CATALOG.find((x) => x.id === row.id);
    expect(c?.lane).toBe('INTERACTIVE');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.idempotent).toBe(true);
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe(row.permission);
    expect(c?.events).toEqual(row.events);
    expect(AUDIT_WRITER_COMMAND_IDS.has(row.id)).toBe(true);
    expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((e) => e.id === row.id)).toBe(false);
  }
});

it('PLATFORM_GAPS no longer lists transfer_charge or split_charge_v2', () => {
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.transfer_charge');
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.split_charge_v2');
  expect(PLATFORM_GAPS.map((g) => g.id)).toContain('rooms.set_ooo_range');
});
```

Remove/replace the existing `PLATFORM_GAPS.find((g) => g.id === 'folio.split_charge_v2')` assertion (~685).

Also assert config keys `pms.folio.close_window_on_check_out` and `pms.folio.auto_capture_on_check_out` exist, DOMAIN, default `false`.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts`

Expected: FAIL — missing exports / size 35 / PLATFORM_GAPS still lists the two ids.

- [x] **Step 3: Add wire codes, catalog rows, audit writers, config, event-consumer cases**

`packages/contracts/src/idempotency.ts` (with the other wire codes):

```ts
export const WINDOW_CLOSED = 'window_closed' as const;
export const WINDOW_NOT_CLOSABLE = 'window_not_closable' as const;
export const WINDOW_BALANCE_DUE = 'window_balance_due' as const;
export const WINDOW_NOT_REOPENABLE = 'window_not_reopenable' as const;
export const WINDOW_NOT_OPENABLE = 'window_not_openable' as const;
export const GUEST_WINDOW_NOT_OPENABLE = 'guest_window_not_openable' as const;
export const TRANSFER_CROSS_RESERVATION = 'transfer_cross_reservation' as const;
export const TRANSFER_SAME_WINDOW = 'transfer_same_window' as const;
export const LINE_NOT_TRANSFERABLE = 'line_not_transferable' as const;
export const LINE_NOT_DISCOUNTABLE = 'line_not_discountable' as const;
export const PAYMENT_NOT_VOIDABLE = 'payment_not_voidable' as const;
export const PAYMENT_NOT_REFUNDABLE = 'payment_not_refundable' as const;
export const DISCOUNT_REASON_REQUIRED = 'discount_reason_required' as const;
```

`catalog.ts` — insert the nine commands immediately after `folio.record_cash_payment`. Delete the two `PLATFORM_GAPS` entries. Re-export nothing new.

`audit-writers.ts` — append the nine ids.

`config/register.ts` — two DOMAIN bool keys, default `false`, `consumersExempt: true`, prototype keys `pms_folio_close_on_checkout` / `pms_folio_auto_capture_checkout`.

`event-consumer.ts` — add cases (presence is enough, same as `folio.payment_authorized`):

```ts
case 'folio.window_opened':
case 'folio.window_closed':
case 'folio.window_reopened':
case 'folio.charge_transferred':
case 'folio.payment_voided':
case 'folio.payment_refunded':
```

`folio.charge_transferred` should `assertStringField` `propertyId`, `reservationId`, `sourceFolioLineId` (spec payload). Others can share the payment-authorized presence branch.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts`

Run: `pnpm check:permissions` — still green (no route rows).

Run: `pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts`

Expected: PASS. Catalog events allowlist includes the six new types.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/config/register.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/event-consumer.ts
git commit -m "$(cat <<'EOF'
feat(contracts): catalog folio money-ops commands, wire codes, and audit writers

EOF
)"
```

---

### Task 2: v21 schema

**Spec:** §9, §17 test 48.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `packages/do-runtime/src/folio-money-ops-migration.sqlite.test.ts`
- Create (generated): `migrations/do-property/0021_folio_money_ops.sql`

**Interfaces:**
- Produces: `FOLIO_MONEY_OPS_V21_STATEMENTS` / `_SQL`; `PROPERTY_SCHEMA_HEAD === 21`; `SYSTEM_CHARGE_CODES` length 6 including `DISCOUNT` / `DAMAGE`
- Consumes: Task 1 (nothing runtime — schema only)
- **Forbidden:** DO command methods, HTTP routes.

- [x] **Step 1: Write the failing head + sqlite tests**

`migrate.test.ts`:

```ts
it('applies property migrations through version 21', () => {
  const sql = new MemorySql();
  expect(migrateSql(sql, [...PROPERTY_MIGRATIONS])).toBe(21);
});

it('property schema head is 21 after folio money ops', () => {
  expect(PROPERTY_SCHEMA_HEAD).toBe(21);
  expect(Math.max(...PROPERTY_MIGRATIONS.map((m) => m.version))).toBe(21);
  const v21 = PROPERTY_MIGRATIONS.find((m) => m.version === 21);
  expect(v21?.name).toBe('folio_money_ops');
  expect(v21?.statements.some((s) => s.includes('folio_window_v21'))).toBe(true);
  expect(v21?.statements.some((s) => s.includes('reservation_rate_night'))).toBe(true);
  expect(v21?.statements[0]).toMatch(/PRAGMA foreign_keys = OFF/i);
  expect(v21?.statements.at(-1)).toMatch(/PRAGMA foreign_keys = ON/i);
});
```

Change the existing “through version 20” test to 21.

`folio-money-ops-migration.sqlite.test.ts` (pattern: `charge-code-migration.sqlite.test.ts`):

```ts
it('v21 CHECKs accept voided/CLOSED and reject BOGUS', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);
  db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
           VALUES ('fw_closed', 'res1', 'GUEST', 'CLOSED')`);
  db.exec(`INSERT INTO payment (
             payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
             idempotency_key, request_fingerprint, created_at, updated_at
           ) VALUES ('pay_void', 'res1', 'fw_closed', 100, 'USD', 'voided', 'k', 'fp', 0, 0)`);
  expect(() =>
    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw_bad', 'res1', 'GUEST', 'BOGUS')`),
  ).toThrow();
  expect(() =>
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at
             ) VALUES ('pay_bad', 'res1', 'fw_closed', 100, 'USD', 'BOGUS', 'k2', 'fp2', 0, 0)`),
  ).toThrow();
});
```

Payment insert must include NOT NULL columns after rebuild (`purpose` defaults `STAY`; `tender_type` defaults `CARD`). Adjust the INSERT list to match the rebuilt table.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/folio-money-ops-migration.sqlite.test.ts`

Expected: FAIL — head still 20 / missing file.

- [x] **Step 3: Land v21 statements**

Keep the wrap **exactly** as spec §9: first statement `PRAGMA foreign_keys = OFF`, last `PRAGMA foreign_keys = ON`.

`folio_window_v21` + copy + drop + rename + `folio_window_reservation_idx`.

`payment_v21` copies every v13+v16 column plus `purpose`, `refunded_amount_minor`, `void_fingerprint`, `refund_fingerprint`, expanded status CHECK (`voided`,`refunded`). Backfill `purpose = 'STAY'`. Recreate `payment_idempotency_uidx` and `payment_reservation_idx`.

```sql
ALTER TABLE reservation ADD COLUMN no_post INTEGER NOT NULL DEFAULT 0
  CHECK (no_post IN (0, 1));
```

`reservation_rate_night` + index as spec §8.1.

Seed `DISCOUNT` / `DAMAGE`; `UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'DAMAGE'`.

```ts
export const SYSTEM_CHARGE_CODES = [
  'ROOM', 'PAYMENT', 'CANCEL', 'NO_SHOW', 'DISCOUNT', 'DAMAGE',
] as const;
```

MemorySql (`migrate.test.ts`): handle `PRAGMA foreign_keys`, `INSERT INTO folio_window_v21`, `DROP TABLE folio_window`, `ALTER TABLE folio_window_v21 RENAME`, same for `payment_v21`, `ALTER TABLE reservation ADD COLUMN no_post`. Unhandled SQL throws — add a stub for each new statement prefix.

Export `FOLIO_MONEY_OPS_V21_SQL` from `property-migrations.ts` and `index.ts`.

`scripts/property-ddl.mjs`: destructure `FOLIO_MONEY_OPS_V21_SQL`; append a `doPropertyTargets` row for `migrations/do-property/0021_folio_money_ops.sql` (header ORDER: PRAGMA OFF → folio_window rebuild → payment rebuild → no_post → reservation_rate_night → seeds → PRAGMA ON).

- [x] **Step 4: generate DDL and run tests**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/folio-money-ops-migration.sqlite.test.ts
pnpm check:ddl
```

Expected: PASS. On-disk `0021_*.sql` matches `FOLIO_MONEY_OPS_V21_SQL`.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/folio-money-ops-migration.sqlite.test.ts \
  migrations/do-property/0021_folio_money_ops.sql \
  scripts/property-ddl.mjs
git commit -m "$(cat <<'EOF'
feat(do-runtime): PropertyDO v21 folio money-ops schema

EOF
)"
```

---

### Task 3: `insertFolioLineSync` CLOSED gate

**Spec:** §9 F, §3.3 late charge, §17 test 7 (helper path). Lands **before** any command that can hit a closed window.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`insertFolioLineSync` ~8475; error classes ~509)
- Test: `apps/pms-core/test/folio-windows.spec.ts` (create; only the gate cases)

**Interfaces:**
- Produces: `WindowClosedError` whose `message` contains `window_closed`; `stampFolioWindowClosedForTest`; `tryAddFolioLine` maps to `WINDOW_CLOSED`
- Consumes: v21 CHECK allowing `CLOSED`
- **Forbidden:** `tryCloseFolioWindow` / HTTP close (Task 6). Gate must not depend on the close command.

- [x] **Step 1: Write the failing test**

```ts
it('7: add_item on CLOSED window returns WINDOW_CLOSED and does not reopen', async () => {
  const propertyId = crypto.randomUUID();
  const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
  // create reservation + GUEST window via existing create path
  await stub.stampFolioWindowClosedForTest(`${reservationId}:GUEST`);
  const result = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, {
    folioLineId: crypto.randomUUID(),
    reservationId,
    chargeCode: 'MISC',
    amountMinor: 100,
  }, await idemFor({ k: 'late' }));
  expect(result).toMatchObject({ ok: false, error: WINDOW_CLOSED });
  const folio = await stub.readFolio(reservationId);
  expect(folio.ok && folio.window?.status).toBe('CLOSED');
});
```

Use the same guest/reservation helpers as `reservations-lifecycle.spec.ts`. Charge code `MISC` is seeded.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-windows.spec.ts`

Expected: FAIL — `stampFolioWindowClosedForTest` missing and add_item succeeds.

- [x] **Step 3: Implement the gate**

```ts
class WindowClosedError extends Error {
  constructor() {
    super(WINDOW_CLOSED);
    this.name = 'WindowClosedError';
  }
}
```

First statements of `insertFolioLineSync` after property-id:

```ts
const win = this.ctx.storage.sql
  .exec(`SELECT status FROM folio_window WHERE folio_window_id = ?`, input.folioWindowId)
  .toArray() as Array<{ status: string }>;
if (!win[0]) throw new Error(NOT_FOUND);
if (win[0].status === 'CLOSED') throw new WindowClosedError();
```

`tryAddFolioLine` catch: `if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };`

Test helper (`assertUnsafeLocal`):

```ts
async stampFolioWindowClosedForTest(folioWindowId: string): Promise<void> {
  this.assertUnsafeLocal('stampFolioWindowClosedForTest');
  this.ctx.storage.sql.exec(
    `UPDATE folio_window SET status = 'CLOSED', closed_at = ? WHERE folio_window_id = ?`,
    Date.now(),
    folioWindowId,
  );
}
```

`ensureGuestFolioWindowSync` stays `INSERT OR IGNORE` as OPEN — must not `UPDATE` a CLOSED row.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-windows.spec.ts`

Also run an existing folio add-item test (`test/folio-routes.spec.ts` or charges spec) to prove OPEN still posts.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-windows.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): reject folio inserts against a CLOSED window

EOF
)"
```

---

### Task 4: Quote snapshot writers (inventory commit)

**Spec:** §8.2 write path, §17 tests 42 (insert), 44. **Readers must not ship in this commit.**

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCreateReservation` ~4936, `tryHold`, `tryConfirm`)
- Modify: `apps/pms-core/src/property-do.ts` `insertReservationForTest` (~10210) — optional nights not required; writers run on real create
- Test: `apps/pms-core/test/folio-quote-snapshot.spec.ts`

**Interfaces:**
- Produces: `snapshotRateNightsSync(reservationId, roomTypeId, ratePlanId, nights: string[]): void`
- Consumes: v21 `reservation_rate_night`; `enumerateStayDates`; `rate_day`
- **Forbidden:** changing `penaltyMinor` / `postRoomChargesSync` lookups (Task 5).

- [x] **Step 1: Write the failing tests**

Test 44: create pending, no `rate_day` → `RATE_MISSING`, no reservation row, `SELECT COUNT(*) FROM reservation_rate_night` is 0, `sold` unchanged.

Test 42 write half: create confirmed 2-night stay with `rate_day` filled → two snapshot rows equal to those amounts.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-quote-snapshot.spec.ts`

Expected: FAIL — no snapshot rows.

- [x] **Step 3: Implement `snapshotRateNightsSync`**

Call it in the same txn as `sold + 1` after the reservation INSERT, when `commitsInventory` (create pending/confirmed) and on hold/confirm (inquiry → pending/confirmed). Missing `rate_day` → `RateMissingError` **before** the reservation insert if possible; if after, the txn rolls back.

```ts
private snapshotRateNightsSync(
  reservationId: string,
  roomTypeId: string,
  ratePlanId: string,
  nights: string[],
): void {
  const currency = this.readStoredLedgerCurrencySync();
  if (!currency) throw new Error(CURRENCY_UNSET);
  for (const stayDate of nights) {
    const amount = this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate); // throws RateMissingError
    this.ctx.storage.sql.exec(
      `INSERT INTO reservation_rate_night (reservation_id, stay_date, amount_minor, currency, rate_plan_id)
       VALUES (?, ?, ?, ?, ?)`,
      reservationId, stayDate, amount, currency, ratePlanId,
    );
  }
}
```

Inquiry create: do **not** call it.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-quote-snapshot.spec.ts`

Existing create/cancel tests stay green (`pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts`).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-quote-snapshot.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): freeze rate_day onto reservation_rate_night at inventory commit

EOF
)"
```

---

### Task 5: Snapshot readers + consumed-night retention on modify

**Spec:** §8.2 modify, §8.3, invariant 9, §17 tests 42 (rate edit), 43, 45, 46.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`penaltyMinor` ~4601, `postRoomChargesSync` ~8668, `tryModifyReservation`)
- Test: `apps/pms-core/test/folio-quote-snapshot.spec.ts` (extend); `apps/pms-core/test/night-audit-room-charges.spec.ts` if 42b needs audit

**Interfaces:**
- Produces: `rateNightAmountSync(reservationId, roomTypeId, ratePlanId, stayDate): number` — snapshot hit, else `rate_day` + lazy `INSERT OR IGNORE`
- Consumes: Task 4 writers
- **Forbidden:** shipping readers in Task 4.

- [x] **Step 1: Write the failing tests**

42 remainder: after snapshot exists, `UPDATE rate_day` for night 1 → `penaltyMinor` / `POST_ROOM_CHARGES` still use snapshot amount.

43: `insertReservationForTest` (no night rows) + live `rate_day` → ROOM posts at `rate_day`, snapshot lazily inserted; second `rate_day` edit does not change a COMPLETED re-run.

45: modify add a night → new snapshot from current `rate_day`; overlapping unchanged.

46: 2-night stay, run `POST_ROOM_CHARGES` for night 1, modify departure so night 2 drops → night-1 snapshot **retained**, night-2 **deleted**. Edit `rate_day` night 1 → snapshot still old.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-quote-snapshot.spec.ts`

Expected: FAIL — readers still use `rate_day`; modify deletes consumed nights.

- [x] **Step 3: Implement readers + modify sync**

Replace `rateDayAmountSync` calls in `penaltyMinor` and `postRoomChargesSync` with `rateNightAmountSync`.

Modify dates: compute old vs new `enumerateStayDates`. For nights leaving the stay:

```sql
SELECT 1 FROM folio_line
 WHERE reservation_id = ? AND business_date = ? AND charge_code IN ('ROOM', 'NO_SHOW')
 LIMIT 1
```

If a row exists → keep snapshot. Else `DELETE FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`. New nights: `snapshotRateNightsSync` for those dates only (`INSERT`; do not overwrite overlapping).

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-quote-snapshot.spec.ts test/night-audit-room-charges.spec.ts test/night-audit-no-shows.spec.ts`

Expected: PASS. `P === R` still holds (both read snapshot).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-quote-snapshot.spec.ts \
  apps/pms-core/test/night-audit-room-charges.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): price penalties and room charges from quote snapshot

EOF
)"
```

---

### Task 6: Open / close / reopen windows + check-out auto-close

**Spec:** §3, §17 tests 1–14.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCheckOut` ~5893; `createFolioWindow` ~8438)
- Test: `apps/pms-core/test/folio-windows.spec.ts`

**Interfaces:**
- Produces: `tryOpenFolioWindow` / `tryCloseFolioWindow` / `tryReopenFolioWindow`; `closeFolioWindowSync`; check-out auto-close when config true and `balanceMinor === 0`
- Consumes: Task 3 gate; Task 1 catalog ids; config keys
- Also: `assertUnsafeLocal` on `createFolioWindow` (spec §1.1 / nit 2) now that `open_window` is the real path.

- [x] **Step 1: Write the failing tests** for 1–6, 8–14 (7 already green from Task 3). Cover default check-out leaves OPEN; config true + zero closes; override with balance stays OPEN; in-house GUEST close → `WINDOW_NOT_CLOSABLE`; reopen; COMPANY close while in-house; staff 403 on close (`gatePermission` `folio:adjust`).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-windows.spec.ts`

- [x] **Step 3: Implement window commands**

`tryOpenFolioWindow`: kind `COMPANY` | `MASTER` only; GUEST → `GUEST_WINDOW_NOT_OPENABLE`. Deterministic ids per spec §3.6. Inquiry → `WINDOW_NOT_OPENABLE`. Idempotent via `runIdempotent` + deterministic PK.

`tryCloseFolioWindow`: gates spec §3.2. Window balance = `SUM(ledger_amount_minor)` for that `folio_window_id`. Already CLOSED → `{ ok: true, alreadyClosed: true }`.

`tryReopenFolioWindow`: CLOSED → OPEN, `closed_at = NULL`. Already OPEN → `{ alreadyOpen: true }`.

Check-out: inside the **same** status txn, if `readConfigValueSync('pms.folio.close_window_on_check_out') === true` and `balanceMinor === 0`, `closeFolioWindowSync` the GUEST window. Do not close when `balanceMinor > 0`.

`createFolioWindow`: first line `this.assertUnsafeLocal('createFolioWindow')`.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-windows.spec.ts test/reservations-check-out.spec.ts`

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-windows.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): folio window open, close, reopen, and optional check-out close

EOF
)"
```

---

### Task 7: Transfer + split v2

**Spec:** §4, §5, §17 tests 15–25.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`splitFolioLineSync` ~8542; new `tryTransferCharge` / `trySplitChargeV2`)
- Test: `apps/pms-core/test/folio-transfer-split.spec.ts`

**Interfaces:**
- Produces: `tryTransferCharge`, `trySplitChargeV2`; `splitFolioLineSync` gains per-split `folioWindowId?`
- Consumes: Task 3 CLOSED gate; Task 6 dest windows; `allocate`

- [x] **Step 1: Write the failing tests** 15–25 (transfer ROOM+tax, CLOSED dest, cross-reservation, TAX reject, idempotent transfer, v1 regression, v2 same-window, v2 cross-window, CLOSED dest abort, foot mismatch, PLATFORM_GAPS already dropped in Task 1 — assert catalog ids exist).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts`

- [x] **Step 3: Implement**

Transfer: spec §4.2. Deterministic ids `${sourceFolioLineId}:xfer-rev:${destWindowId}` and `:xfer:`. Reverse `source = 'TRANSFER_REVERSAL'`; dest `source = 'TRANSFER'` (never `NIGHT_AUDIT`). Tax: reverse in source, `stampTaxForChargeSync` on dest parent. `payment_id` NULL on reverse/dest. Event `folio.charge_transferred`.

Split v2: extend helper so each child uses `split.folioWindowId ?? source.folio_window_id`. Dest ≠ source → dest OPEN + same reservation; child `source = 'TRANSFER'`. Tax allocate with `allocate(Math.abs(tax.amount_minor), childAmounts.map(Math.abs), { policy: 'LAST' })` then re-apply tax sign. v1 `trySplitFolioLine` / `trySplitChargePayment` call the helper **without** dest (unchanged contracts, UUID reverse ids). v2 reverse id `${sourceFolioLineId}:v2-rev`.

One txn; any CLOSED → `WINDOW_CLOSED`, nothing written.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts test/folio-routes.spec.ts`

Expected: v1 split Test 6 still green.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-transfer-split.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): folio.transfer_charge and folio.split_charge_v2

EOF
)"
```

---

### Task 8: Simulate void / refund adapter

**Spec:** §6.5. **No DO payment methods in this commit.**

**Files:**
- Modify: `apps/pms-core/src/psp-simulate.ts`
- Test: `apps/pms-core/src/psp-simulate.test.ts` (create if missing) or a tiny unit next to existing simulate tests

**Interfaces:**
- Produces: `simulateVoid`, `simulateRefund`; `PspSimulateOutcome` gains `void?` / `refund?`
- Consumes: existing `simulateAuthorize` shape

- [x] **Step 1: Write failing unit tests** — default approve; lever `declined` / `timeout`; `failAfterAdapter` is still a DO concern (do not implement it here).

- [x] **Step 2: Run tests to verify they fail**

- [x] **Step 3: Implement**

```ts
export async function simulateVoid(
  input: { paymentId: string; gatewayReference: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspAuthorizeResult> { /* same approved/declined/timeout as authorize */ }

export async function simulateRefund(
  input: { paymentId: string; amountMinor: number; gatewayReference: string; currency: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspCaptureResult> { /* approved returns capturedAmountMinor = input.amountMinor */ }
```

Mirror `simulateCapture` for refund so timeout/decline exist. Extend `PspSimulateOutcome`.

- [x] **Step 4: Run tests to verify they pass**

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/psp-simulate.ts apps/pms-core/src/psp-simulate.test.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): simulate PSP void and refund adapters

EOF
)"
```

---

### Task 9: `tryVoidPayment` / `tryRefundPayment` / `tryCaptureDueHolds`

**Spec:** §6.2–6.4.1–3, §6.6, §7.2 capture-due skip, §17 tests 26–32, 35–36, 39.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`PaymentStatus` union ~165; `tryAuthorizePayment` purpose; new try*)
- Test: `apps/pms-core/test/folio-payment-lifecycle.spec.ts`

**Interfaces:**
- Produces: `tryVoidPayment`, `tryRefundPayment`, `tryCaptureDueHolds`
- Consumes: Task 8 adapters; v21 payment columns; Task 3 CLOSED gate on refund line insert
- **Forbidden:** wiring into `tryCheckOut` (Task 10).

- [x] **Step 1: Write the failing tests** 26–32, 35–36, 39.

Widen `PaymentStatus` to include `'voided' | 'refunded'` in the test assertions via `readPayment`.

- [x] **Step 2: Run tests to verify they fail**

- [x] **Step 3: Implement**

Void: async seam like authorize (assert `authorized` + CARD, await `simulateVoid`, txn2 `UPDATE … WHERE status='authorized'`). No folio line. Cash → `PAYMENT_NOT_VOIDABLE`. `unknown` → not voidable. Timeout on void → stay `authorized` (do not write `unknown`). Event `folio.payment_voided`. Fingerprint `{ paymentId }`. `void_fingerprint` column.

Refund: full only. Card: await `simulateRefund`; cash: skip PSP. Positive `PAYMENT_REFUND` line, `split_of` = capture line id (`${paymentId}:capture`), **`payment_id` NULL**. Status `refunded`. `refund_fingerprint`. Event `folio.payment_refunded`. Permission `folio:adjust`.

`tryCaptureDueHolds`: STAY holds FIFO; `min(amount, remaining balance)`; existing capture seam; skip DAMAGE; `{ captured: PaymentId[] }` or empty.

Authorize: accept optional `purpose`, default `'STAY'`, store on insert, fingerprint includes `purpose`.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts test/folio-payments.spec.ts`

Existing authorize/capture tests stay green (`purpose` default).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-payment-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): folio void, refund, and capture-due

EOF
)"
```

---

### Task 10: Live check-out awaits capture-due; return `autoCapture`

**Spec:** §6.4.4–7, invariant 7, §10.2 check_out, §17 tests 33–34.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` `tryCheckOut`
- Test: `apps/pms-core/test/reservations-check-out.spec.ts`

**Interfaces:**
- Produces: `{ ok: true; reservationId: string; autoCapture: 'captured' | 'failed' | 'skipped' | 'disabled' }`
- Consumes: `tryCaptureDueHolds` from Task 9
- **Forbidden:** `ctx.waitUntil`. HTTP mapping waits for Task 12 (RPC tests call the stub directly). Existing check-out tests must be updated to expect `autoCapture: 'disabled'` (config default false) or they fail on extra field — **update them in this commit**.

- [x] **Step 1: Write tests 33 and 34**

33: config `pms.folio.auto_capture_on_check_out = true`, live check-out, authorized STAY hold, `require_zero` false → `checked_out`, hold `captured`, **`autoCapture: 'captured'`**. Do not call `tryCaptureDueHolds` from the test — the RPC must have awaited it.

34: enqueue/replay check-out with config true and an eligible hold → still `authorized`, **`autoCapture: 'skipped'`**.

Also: adapter `failAfterAdapter` / throw after commit → guest `checked_out`, **`autoCapture: 'failed'`** (can live as 33’s sibling in the same file; not a second definition of 33).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out.spec.ts`

Existing tests that `expect(result).toEqual({ ok: true, reservationId })` will fail until Step 3 adds `autoCapture: 'disabled'`.

- [x] **Step 3: Implement**

After the checkout `transactionSync` returns ok:

```ts
let autoCapture: 'captured' | 'failed' | 'skipped' | 'disabled' = 'disabled';
if (!provisional) {
  const enabled = this.readConfigValueSync('pms.folio.auto_capture_on_check_out') === true;
  if (!enabled) autoCapture = 'disabled';
  else {
    try {
      const due = await this.tryCaptureDueHolds(actor, { reservationId: input.reservationId }, /* internal */);
      autoCapture = due.captured.length > 0 ? 'captured' : 'skipped';
    } catch {
      autoCapture = 'failed';
    }
  }
} else {
  const enabled = this.readConfigValueSync('pms.folio.auto_capture_on_check_out') === true;
  autoCapture = enabled ? 'skipped' : 'disabled';
}
return { ok: true, reservationId, autoCapture };
```

`tryCaptureDueHolds` as an RPC still uses `runIdempotent` / actor gates. From check-out, call a **private** `captureDueHoldsAfterCheckout(reservationId)` that skips permission re-entry (already gated `reservations:write`) but uses the same capture seam. Do not fail check-out if that helper throws.

**Locked (replaces cached-blob):** `runIdempotent` stays sync and caches the status-txn base `{ ok, reservationId }` — atomic mutation+idem-row unchanged. Peek the idempotency row **before** `runIdempotent` to detect a cache hit. First live call (no prior row, not provisional): after `runIdempotent` returns, `await` the capture-due helper inside try/catch. `autoCapture` = actual outcome: helper captured ≥1 → `'captured'`; config on but nothing to capture → `'skipped'`; helper threw → `'failed'` (check-out still succeeds); config off → `'disabled'`. Cache hit (same key, live): **recompute** `autoCapture` from current state, do **not** re-await the helper — config off → `'disabled'`; ≥1 captured STAY payment → `'captured'`; ≥1 authorized STAY hold remains → `'failed'`; else `'skipped'`. Provisional replay: config on → `'skipped'`, off → `'disabled'`. Desk retry after `'failed'` is `POST …/capture-due` with a fresh idempotency key, never a check-out replay. No post-cache UPDATE. Spec §6.4 documents the one benign divergence (hold already captured before check-out: first-call `'skipped'`, replay `'captured'`).

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out.spec.ts test/folio-payment-lifecycle.spec.ts test/degraded-mode.spec.ts`

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/reservations-check-out.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): await auto-capture on live check-out and return autoCapture

EOF
)"
```

---

### Task 11: No-post, damage purpose (already partly in 9), discounts

**Spec:** §7.1, §7.3, §17 tests 37–38, 40–41. (39 landed in Task 9.)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`postRoomChargesSync` skip; `tryUpdateFrontOffice`; `tryPostDiscount`; create/modify/hold/confirm `noPost`)
- Test: `apps/pms-core/test/folio-extras.spec.ts`; extend `night-audit-room-charges.spec.ts` for 37

**Interfaces:**
- Produces: `tryPostDiscount`; `noPost` on create/modify/hold/confirm/`update_status`; night-audit skip
- Consumes: v21 `no_post` + `DISCOUNT` seed; Task 3 gate

- [x] **Step 1: Write failing tests** 37, 38, 40, 41.

- [x] **Step 2: Run tests to verify they fail**

- [x] **Step 3: Implement**

`postRoomChargesSync`: `AND COALESCE(no_post, 0) = 0` on the reservation SELECT (or skip in the loop).

`tryUpdateFrontOffice`: optional `noPost` boolean; statuses `inquiry`–`checked_in`; terminal → `NOT_MODIFIABLE`; event payload includes `noPost`.

Create/modify/hold/confirm: optional `noPost`, fingerprint includes it.

`tryPostDiscount`: spec §7.3. `folio:adjust`. Reason 1–500. Percent via `roundHalfAwayFromZero`. Charge code `DISCOUNT`, `source = 'DESK'`, `split_of` = source. Window OPEN.

- [x] **Step 4: Run tests to verify they pass**

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-extras.spec.ts \
  apps/pms-core/test/night-audit-room-charges.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): folio no-post, discounts, and reservation extras fields

EOF
)"
```

---

### Task 12: HTTP routes 95–103 + GET folio widen

**Spec:** §11, §10.3 HTTP map, §17 tests 47, 51. **This is the first commit that touches `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES`.**

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts` (pins `[94]`, `[95]`, `[103]`)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (nine handlers; `mapReservationCommandErrorStatus` 422 list; GET folio; check-out JSON already `json(result, 200)` — `autoCapture` flows once the stub returns it)
- Test: `apps/pms-core/test/folio-routes.spec.ts` (extend) and/or `folio-windows.spec.ts` HTTP if the suite uses SELF

**Interfaces:**
- Produces: route ids 95–103 in **identical order** in audit + `V1_ROUTES`
- Consumes: Task 6–11 DO methods

- [x] **Step 1: Write failing pin tests**

```ts
expect(V1_HTTP_ROUTE_AUDIT[94]?.id).toBe('post_reservation_front_office');
expect(V1_HTTP_ROUTE_AUDIT[95]?.id).toBe('post_folio_window');
expect(V1_HTTP_ROUTE_AUDIT[103]?.id).toBe('post_folio_capture_due');
```

GET folio: assert `windows` array, `lines[].folioWindowId`, `noPost`, `window.closedAt`.

Kill-switch `pms.core` + POST close → 503 (test 51).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts`

Run: `pnpm check:permissions` — still green until Step 3 adds **both** arrays together.

- [x] **Step 3: Append audit rows and handlers in the same commit**

Audit rows per spec §11 (entitlement `pms.core` on all nine). `V1_ROUTES` append matching `pattern` / `handler` in the same order. `check:permissions` requires identical order.

`mapReservationCommandErrorStatus`: all §10.3 codes → 422.

GET folio handler: pass through widened `readFolio`.

Fingerprints: body `idempotencyKey` on the nine POSTs (key-in-body; they ship with a body).

- [x] **Step 4: Run tests + `pnpm check:permissions`**

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/folio-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): folio money-ops HTTP routes 95–103

EOF
)"
```

---

### Task 13: SPA §14 (including split v2 dest picker)

**Spec:** §14, §17 tests 52–55.

**Files:**
- Modify: `packages/client-core/src/api.ts` + `packages/client-core/test/api-folio.test.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Interfaces:**
- Consumes: Task 12 routes
- **Lock: ship dest picker** (spec §14). Existing split A/B amount fields stay; add per-slice window `<select>` (default source GUEST). Submit `split-v2` when any dest ≠ source; otherwise v1 route is acceptable **only if** both dests are source — simpler lock: **always call split-v2** now that it is a same-window superset. Do that: FolioScreen split uses `splitFolioLineV2` always.

- [x] **Step 1: Write failing SPA tests** 52–55 plus dest picker: transfer picker lists other OPEN windows; staff hides refund; check-out reads `autoCapture` (`'failed'` shows retry copy, does not infer from payments refetch).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx`

- [x] **Step 3: Implement client methods + FolioScreen**

Client: `openFolioWindow`, `closeFolioWindow`, `reopenFolioWindow`, `transferFolioLine`, `splitFolioLineV2`, `voidPayment`, `refundPayment`, `postDiscount`, `captureDue`. Widen `getFolio` types (`windows`, `folioWindowId`, `noPost`, `closedAt`). `checkOut` already returns body as-is — type `autoCapture`.

FolioScreen: window list/chips; close/reopen gated `folio:adjust`; COMPANY open; transfer dest picker; split dest selects; discount + reason; void on authorized; refund on captured (`folio:adjust`); capture-due button; no-post toggle via front-office (`reservations:write`); check-out uses `body.autoCapture`.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx`

Run: `pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts`

- [x] **Step 5: Commit**

```bash
git add packages/client-core apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): folio windows, transfer, split v2 dest picker, void/refund

EOF
)"
```

---

### Task 14: Bidirectional spec pointers

**Spec:** header **Amends**.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` leftover 2 / 4 / 5 — one sentence each: quote snapshot, window close, capture seam now specified in folio-money-ops.
- Modify: `docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md` leftovers (window wire-lie, closed-window reject, voids/refunds) — pointer.
- Modify: `docs/superpowers/specs/2026-08-07-charge-code-registry-design.md` leftover “window routing rules table” — auto-transfer still deferred; primitive is folio-money-ops.

Do **not** rewrite those specs. One sentence per leftover.

- [x] **Step 1: Edit the three specs**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md \
  docs/superpowers/specs/2026-08-07-charge-code-registry-design.md
git commit -m "$(cat <<'EOF'
docs: point lifecycle, payments, and charge-code specs at folio money-ops

EOF
)"
```

---

### Task 15: Full CI locally

**Spec:** §17 test 49, §20 last bullet, §21.

- [x] **Step 1: Run the `checks` job commands in order**

```bash
pnpm build
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
```

Expected: all exit 0.

- [x] **Step 2: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

- [x] **Step 3: Tick living checkboxes on this plan**

Mark Tasks 1–15 steps `- [x]` in this file. Same PR as the last implementation commit, or a docs commit in that PR.

- [x] **Step 4: Commit only if Step 3 left docs dirty**

```bash
git add docs/superpowers/plans/2026-08-12-folio-money-operations.md
git commit -m "$(cat <<'EOF'
docs: tick folio money-ops plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip the commit.

---

## Spec coverage (self-review)

| Spec §17 / requirement | Task |
|---|---|
| Catalog 9 commands, size 44, drop PLATFORM_GAPS, events | 1 |
| v21 schema + CHECK voided/CLOSED + PRAGMA wrap | 2 |
| `insertFolioLineSync` CLOSED gate (test 7 helper) | 3 |
| Snapshot write 42/44 | 4 |
| Snapshot read + consumed retain 42/43/45/46 | 5 |
| Windows 1–14 | 6 |
| Transfer/split 15–25 | 7 |
| Simulate void/refund | 8 |
| Void/refund/capture-due 26–32, 35–36, 39 | 9 |
| Check-out `autoCapture` 33–34 | 10 |
| Extras 37–38, 40–41 | 11 |
| Routes 95–103, GET folio, kill-switch 47/51 | 12 |
| SPA 52–55 + dest picker | 13 |
| Bidirectional pointers | 14 |
| Full CI 49 | 15 |
| Auto-transfer / promo / city ledger / partial refund | not implemented (leftovers) |
