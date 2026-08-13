# Reservation Lifecycle Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `inquiry` / `pending`, finish check-in/out interlocks, and post snapshotted cancel/no-show penalties so the shipped machine matches ARCHITECTURE §7.4.

**Architecture:** PENDING commits `sold` (not `held`). Expiry is lazy-on-touch plus a fold into `PROCESS_NO_SHOWS`. Check-in stays `QUEUE_PROVISIONAL` and re-validates room + cleanliness on replay. Check-out gates on existing `readFolio` `balanceMinor`. Penalty is snapshotted onto the reservation; night audit reconciles `P` vs posted ROOM without ever halting. `POST_ROOM_CHARGES` prices from `reservation.rate_plan_id`.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/do-runtime` v20, `@hospai/money` `roundHalfAwayFromZero`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` (Approved v2). Spec commit: `b0cbe8ce1a50c7ae0571970238237089f5a94204`.

## Global Constraints

- `held` stays 0. PENDING writes `sold`.
- Validate-then-mutate on every inventory command. `{ ok: false }` leaves no partial `sold`.
- `availability.changed` ⇒ `FAIL_CLOSED` (`check:degraded`, no opt-out). New inventory commands use `INVENTORY_FAIL_CLOSED_NOTES`.
- Check-in / check-out / cancel_check_in stay `QUEUE_PROVISIONAL` and entitlement-ungated. They never read `availability_day`.
- `PROCESS_NO_SHOWS` no-show predicate stays `status = 'confirmed' AND arrival_date <= D`. Pending past arrival → `cancelled` (expired), not `no_show`.
- `POST_ROOM_CHARGES` predicate stays `confirmed | checked_in`. Rate lookup is `reservation.rate_plan_id`.
- `P !== R` must not fail the audit step. Reverse ROOM then post `NO_SHOW` / `NIGHT_AUDIT` for **P**.
- After `expireIfDueSync` fires: every caller returns `HOLD_EXPIRED` / `INQUIRY_EXPIRED` except `tryCancelReservation` (ok, no penalty, one release).
- Single alarm slot is not a hold timer. No new `NIGHT_AUDIT_STEPS` entry.
- Route audit append-only: indices 92–94. Catalog/routes are **different commits** (`check:permissions` stays green).
- `AUDIT_WRITER_COMMAND_IDS.size` goes 33 → 35 in Task 1 (`confirm` + `hold` only). Check-in/out/front-office stay off the set.
- `RESERVATION_STATUSES` and the v8 sync test must **not** change in Task 1 — they land with v20 in Task 2.
- Fixture dates from property-local `business_date`. New tests key fixtures with `crypto.randomUUID()`.
- Living plan checkboxes: tick `- [x]` on the merged task in this file in the same PR. Do not backfill historical plans.
- No either/or forks. Do not reopen sold-vs-held, QUEUE_PROVISIONAL check-in, or P/R halt.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | `confirm` / `hold`; event/notes edits |
| `packages/contracts/src/idempotency.ts` | Seven new wire codes |
| `packages/contracts/src/commands/audit-writers.ts` | +confirm, +hold; size **35** |
| `packages/contracts/src/config/register.ts` | Six keys |
| `packages/contracts/src/reservation-status.ts` | Task 2 only |
| `packages/contracts/src/register.test.ts` | Size 35 (Task 1); route pins 92–94 (Task 8) |
| `apps/pms-core/src/event-consumer.ts` | `folio.balance_due`, `reservation.front_office_updated` (Task 1) |
| `packages/do-runtime/src/property-migrations.ts` | v20 + `SYSTEM_CHARGE_CODES` |
| `migrations/do-property/0020_reservation_lifecycle.sql` | Generated |
| `scripts/property-ddl.mjs` | 0020 target |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql + version 20 + on-disk match |
| `packages/do-runtime/src/reservation-status-sync.test.ts` | Point at v20 CHECK |
| `apps/pms-core/src/property-do.ts` | All `try*` + expiry + penalty + audit bodies |
| `apps/pms-core/src/pending-commands-consumer.ts` | Widen check-in/out; add `update_status` |
| `apps/pms-core/src/v1-dispatch.ts` | Routes 92–94; widen create/patch/check-in/out/lists |
| `packages/contracts/src/v1-http-routes.ts` | Indices 92–94 (Task 8 only) |
| `packages/client-core/src/api.ts` | Client methods (Task 9) |
| `apps/web-pms` | Wizard Hold/Quote; CheckInScreen; FolioScreen; board (Task 9) |
| `ARCHITECTURE.md` + sibling specs | Bidirectional one-liners (Task 10) |

## Test file split (spec §15 → file)

| Spec # | File |
|---|---|
| 1–8, 9–14, 12a, 12b, 40–45 | `apps/pms-core/test/reservations-lifecycle.spec.ts` (new) |
| 15 | `apps/pms-core/test/reservations-ledger.property.spec.ts` |
| 16–22a | `apps/pms-core/test/night-audit-no-shows.spec.ts` (extend) |
| 22b | `apps/pms-core/test/night-audit-room-charges.spec.ts` (extend) |
| 23–30, 33 | `apps/pms-core/test/reservations-check-in.spec.ts` (new) |
| 31, 32, 39 | `apps/pms-core/test/degraded-mode.spec.ts` (extend) |
| 34–38 | `apps/pms-core/test/reservations-check-out.spec.ts` (new) |
| 46–47, 50 (HTTP pins) | `apps/pms-core/test/reservations-routes.spec.ts` |
| 48 | `apps/pms-core/test/front-desk-reads.spec.ts` |
| 49 | `packages/do-runtime/src/reservation-status-sync.test.ts` + `packages/contracts/src/reservation-status.ts` |
| 51 | Task 11 gates |
| 52 | `apps/web-pms/src/screens/BookingScreen.test.tsx` |
| 53 | `apps/web-pms/src/screens/CheckInScreen.test.tsx` (new) |
| 54 | `apps/web-pms/src/screens/FolioScreen.test.tsx` |
| 55 | `apps/web-pms/src/status/board-row-severity.test.ts` |

**Helper discovery (do not skip):** `insertReservationForTest` (~8732) uses an explicit column list omitting the new v20 columns. SQLite applies `DEFAULT` (`adults=1`, `rate_plan_id='BAR'`, `cancel_penalty_type='none'`, …). Existing callers stay green after Task 2 **without** edits. Extend the helper with optional fields in Task 2 so later tasks can set `confirmBy` / `ratePlanId` / policy snapshot. Night-audit-reports test 11 **will break in Task 7** (see that task) — not in Task 2.

**`postRoomChargesSync` rides with Task 2** (same commit as the column). Existing room-charge tests stay BAR via the default. The tree is never “column exists, reader still hardcodes BAR.” Test 22b (non-BAR amount) waits until Task 7, when we have a helper that can set `ratePlanId`.

---

### Task 1: Contracts (own commit, no HTTP routes, no status-set change)

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
- Produces: catalog ids `reservations.confirm`, `reservations.hold`; events `folio.balance_due`, `reservation.front_office_updated`; wire codes below; `AUDIT_WRITER_COMMAND_IDS.size === 35`; six config keys
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, `RESERVATION_STATUSES` (v8 sync + `boardRowSeverity` exhaustiveness would go red), any DO method body, any `/confirm` handler.

- [x] **Step 1: Write the failing register + idempotency tests**

In `packages/contracts/src/idempotency.test.ts` add:

```ts
it('reservation lifecycle wire codes', () => {
  expect(HOLD_EXPIRED).toBe('hold_expired');
  expect(INQUIRY_EXPIRED).toBe('inquiry_expired');
  expect(ROOM_REQUIRED).toBe('room_required');
  expect(ROOM_NOT_READY).toBe('room_not_ready');
  expect(ROOM_OUT_OF_ORDER).toBe('room_out_of_order');
  expect(BALANCE_DUE).toBe('balance_due');
  expect(OCCUPANCY_EXCEEDED).toBe('occupancy_exceeded');
});
```

In `packages/contracts/src/register.test.ts`:

```ts
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(35);

it('inventory-affecting reservation commands share INVENTORY_FAIL_CLOSED_NOTES', () => {
  for (const id of [
    'reservations.create',
    'reservations.modify',
    'reservations.cancel',
    'reservations.no_show',
    'reservations.confirm',
    'reservations.hold',
  ] as const) {
    expect(COMMAND_CATALOG.find((c) => c.id === id)?.notes).toBe(INVENTORY_FAIL_CLOSED_NOTES);
  }
});

it('reservations.confirm / hold are entitled FAIL_CLOSED INTERACTIVE', () => {
  for (const id of ['reservations.confirm', 'reservations.hold'] as const) {
    const c = COMMAND_CATALOG.find((x) => x.id === id);
    expect(c?.lane).toBe('INTERACTIVE');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('reservations:write');
    expect(c?.events).toEqual(['reservation.status_changed', 'availability.changed']);
    expect(AUDIT_WRITER_COMMAND_IDS.has(id)).toBe(true);
  }
});
```

Also assert `reservations.update_status.events` is `['reservation.front_office_updated']` and `reservations.check_out.events` includes `folio.balance_due` + `room.status_changed`.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts`

Expected: FAIL — missing exports / size 33 / missing catalog ids.

- [x] **Step 3: Add codes, catalog edits, audit writers, config keys, event-consumer cases**

`packages/contracts/src/idempotency.ts`:

```ts
export const HOLD_EXPIRED = 'hold_expired' as const;
export const INQUIRY_EXPIRED = 'inquiry_expired' as const;
export const ROOM_REQUIRED = 'room_required' as const;
export const ROOM_NOT_READY = 'room_not_ready' as const;
export const ROOM_OUT_OF_ORDER = 'room_out_of_order' as const;
export const BALANCE_DUE = 'balance_due' as const;
export const OCCUPANCY_EXCEEDED = 'occupancy_exceeded' as const;
```

`catalog.ts` — insert immediately after `reservations.modify`:

```ts
{
  id: 'reservations.confirm',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['reservation.status_changed', 'availability.changed'],
  entitlement: 'pms.core',
  permission: 'reservations:write',
  notes: INVENTORY_FAIL_CLOSED_NOTES,
},
{
  id: 'reservations.hold',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['reservation.status_changed', 'availability.changed'],
  entitlement: 'pms.core',
  permission: 'reservations:write',
  notes: INVENTORY_FAIL_CLOSED_NOTES,
},
```

Existing catalog edits (same commit):

- `reservations.cancel` / `reservations.no_show` events: add `'folio.line_posted'`
- `reservations.check_in` events: add `'reservation.room_assigned'`
- `reservations.check_out` events: `['reservation.status_changed', 'room.status_changed', 'folio.balance_due']`
- `reservations.update_status` events: `['reservation.front_office_updated']`; notes: `'Front-office comment + VIP flag. Not the status-machine column.'`

`audit-writers.ts`: add `'reservations.confirm'` and `'reservations.hold'`.

`config/register.ts` — after the `pms.folio.configs` entry:

```ts
entry({
  key: 'pms.reservations.pending_hold_hours',
  prototypeKey: 'pms_res_pending_hold_hours',
  class: 'DOMAIN',
  schema: z.number().int().min(1).max(168),
  default: 24,
  consumersExempt: true,
}),
entry({
  key: 'pms.reservations.inquiry_ttl_days',
  prototypeKey: 'pms_res_inquiry_ttl_days',
  class: 'DOMAIN',
  schema: z.number().int().min(1).max(90),
  default: 7,
  consumersExempt: true,
}),
entry({
  key: 'pms.reservations.check_in_cleanliness',
  prototypeKey: 'pms_res_check_in_cleanliness',
  class: 'DOMAIN',
  schema: z.enum(['strict', 'off']),
  default: 'strict',
  consumersExempt: true,
}),
entry({
  key: 'pms.reservations.check_out_require_zero_balance',
  prototypeKey: 'pms_res_checkout_zero_bal',
  class: 'DOMAIN',
  schema: bool,
  default: true,
  consumersExempt: true,
}),
entry({
  key: 'pms.reservations.allow_dirty_check_in_override',
  prototypeKey: 'pms_res_allow_dirty_override',
  class: 'OPERATIONAL',
  schema: bool,
  default: true,
}),
entry({
  key: 'pms.reservations.allow_balance_override',
  prototypeKey: 'pms_res_allow_balance_override',
  class: 'OPERATIONAL',
  schema: bool,
  default: true,
}),
```

`event-consumer.ts` — add `case 'folio.balance_due':` (assert `propertyId`, `reservationId`) and `case 'reservation.front_office_updated':` next to the other reservation cases. Catalog allowlist test in `events-queue.spec.ts` stays mechanical.

- [x] **Step 4: Run contracts + events-queue**

Run: `pnpm --filter @hospai/contracts exec vitest run && pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts && pnpm check:entitlements && pnpm check:degraded && pnpm check:permissions`

Expected: PASS. `check:permissions` green because audit length still matches dispatcher.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts packages/contracts/src/commands/audit-writers.ts packages/contracts/src/config/register.ts packages/contracts/src/register.test.ts apps/pms-core/src/event-consumer.ts
git commit -m "$(cat <<'EOF'
feat(contracts): reservation lifecycle commands, codes, and config keys

confirm/hold are FAIL_CLOSED inventory commands. Wire codes and
front-office/balance-due events land before any route or schema change.

EOF
)"
```

---

### Task 2: v20 schema + statuses + POST_ROOM_CHARGES plan lookup

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `packages/do-runtime/src/reservation-status-sync.test.ts`
- Modify: `packages/contracts/src/reservation-status.ts`
- Modify: `apps/web-pms/src/status/board-row-severity.ts` (exhaustiveness only)
- Modify: `apps/web-pms/src/status/board-row-severity.test.ts` (pending/inquiry cases)
- Modify: `scripts/property-ddl.mjs`
- Create: `migrations/do-property/0020_reservation_lifecycle.sql` (via `pnpm generate:ddl`)
- Modify: `apps/pms-core/src/property-do.ts` (`insertReservationForTest` optional fields; `postRoomChargesSync` SELECT + lookup; `countConfirmedReservationsCovering` rename)
- Test: `packages/do-runtime` vitest; existing `night-audit-room-charges.spec.ts` (must stay green on BAR default)

**Interfaces:**
- Produces: table `reservation` with v20 columns; `RESERVATION_STATUSES` includes `inquiry`/`pending`; `SYSTEM_CHARGE_CODES = ['ROOM','PAYMENT','CANCEL','NO_SHOW']`; `postRoomChargesSync` reads `reservation.rate_plan_id`; helper `insertReservationForTest` optional `ratePlanId?`, `adults?`, `children?`, `confirmBy?`, `expiresAt?`, `cancelPenaltyType?`, `cancelGraceHours?`, `cancelPenaltyNights?`, `cancelPenaltyBps?`, `frontOfficeComment?`, `vipFlag?`, `roomId?`
- Consumes: Task 1 config keys (unread yet)
- **Forbidden:** `tryConfirm` / expiry / HTTP routes.

**Quoted indexes to recreate** (from `property-migrations.ts`, do not paraphrase):

v11 (`ROOM_AND_HOUSEKEEPING_V11_STATEMENTS` ~324–327):

```sql
CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)
CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)
CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)
CREATE INDEX reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL
```

v18 (`FRONT_DESK_READS_V18_STATEMENTS` ~541–543):

```sql
CREATE INDEX reservation_departure_idx ON reservation (departure_date)
CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in'
```

Plus spec §8C new:

```sql
CREATE INDEX reservation_pending_expiry_idx ON reservation (confirm_by) WHERE status = 'pending'
CREATE INDEX reservation_inquiry_expiry_idx ON reservation (expires_at) WHERE status = 'inquiry'
```

- [x] **Step 1: Write the failing migrate + status-sync tests**

In `migrate.test.ts` change the version pin **first** (it will fail until statements exist):

```ts
it('applies property migrations through version 20', () => {
  const sql = new MemorySql();
  const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
  expect(v1).toBe(20);
  // ...
  expect(sql.schemaVersion).toHaveLength(20);
  expect(sql.schemaVersion.map((r) => r.version)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ]);
});
```

Add MemorySql handlers **or the migrate run throws `Unhandled SQL`**:

```ts
if (q.startsWith('INSERT INTO reservation_v20')) return { toArray: () => [] };
if (q.startsWith('ALTER TABLE reservation_v20 RENAME TO reservation')) return { toArray: () => [] };
if (q.startsWith('ALTER TABLE rate_plan ADD COLUMN')) return { toArray: () => [] };
```

(`UPDATE charge_code SET tax_group` is already handled.)

Point `reservation-status-sync.test.ts` at `RESERVATION_V20_SQL` (export it). Change `RESERVATION_STATUSES` to:

```ts
export const RESERVATION_STATUSES = [
  'inquiry',
  'pending',
  'confirmed',
  'cancelled',
  'checked_in',
  'checked_out',
  'no_show',
] as const;
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/reservation-status-sync.test.ts`

Expected: FAIL — no v20 / CHECK still 5 statuses.

- [x] **Step 3: Implement v20 statements, generate DDL, POST lookup, helper, board exhaustiveness**

`RESERVATION_LIFECYCLE_V20_STATEMENTS` order:

1. Five `ALTER TABLE rate_plan ADD COLUMN …` (spec §6.1).
2. `INSERT OR IGNORE INTO charge_code … CANCEL, NO_SHOW` + `UPDATE charge_code SET tax_group = 'ROOM' WHERE code IN ('CANCEL', 'NO_SHOW')`.
3. `CREATE TABLE reservation_v20 (…)` exactly as spec §8C (CHECK includes `inquiry`/`pending`; all new NOT NULL columns have DEFAULT).
4. `INSERT INTO reservation_v20 (old columns + room_id)` `SELECT` from `reservation` (new columns take DEFAULT).
5. `DROP TABLE reservation` / `ALTER TABLE reservation_v20 RENAME TO reservation`.
6. Recreate the eight indexes quoted above.

`SYSTEM_CHARGE_CODES = ['ROOM', 'PAYMENT', 'CANCEL', 'NO_SHOW'] as const`.

Append `{ version: 20, name: 'reservation_lifecycle', statements: RESERVATION_LIFECYCLE_V20_STATEMENTS }` to `PROPERTY_MIGRATIONS`.

Export `RESERVATION_LIFECYCLE_V20_SQL` / `STATEMENTS` from `packages/do-runtime/src/index.ts`.

`scripts/property-ddl.mjs`: destructure `RESERVATION_LIFECYCLE_V20_SQL`; append a `doPropertyTargets` row for `migrations/do-property/0020_reservation_lifecycle.sql` (header: rebuild reservation + rate_plan ALTERs + CANCEL/NO_SHOW seed). Add the on-disk match test in `migrate.test.ts` (copy the 0019 test shape).

Run: `pnpm generate:ddl`

`postRoomChargesSync` (~7194–7213):

```ts
const reservations = this.ctx.storage.sql
  .exec(
    `SELECT reservation_id, room_type_id, rate_plan_id
     FROM reservation
     WHERE status IN ('confirmed', 'checked_in')
       AND arrival_date <= ? AND departure_date > ?`,
    businessDate,
    businessDate,
  )
  .toArray() as Array<{ reservation_id: string; room_type_id: string; rate_plan_id: string }>;

// lookup:
`SELECT amount_minor FROM rate_day
 WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
reservation.room_type_id,
reservation.rate_plan_id,
businessDate,
```

Rename `countConfirmedReservationsCovering` → `countSoldHoldingReservationsCovering` and change SQL to `status IN ('pending', 'confirmed', 'checked_in', 'checked_out')`. Update the one call site in `reservations-ledger.property.spec.ts`.

`insertReservationForTest`: keep the existing INSERT column list (defaults cover new NOT NULL). Add optional fields; when any optional is present, use a wider INSERT that sets them. Existing callers that omit them stay on the short INSERT.

`boardRowSeverity.ts`: add `case 'pending': return 'attention'` in arrivals; `case 'inquiry':` and `case 'pending':` in the other switches as spec §7.4 (`informational` except arrivals pending = `attention`). Update `board-row-severity.test.ts`.

- [x] **Step 4: Run do-runtime + room-charges + ledger property + board severity**

Run: `pnpm --filter @hospai/do-runtime exec vitest run && pnpm check:ddl && pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts test/reservations-ledger.property.spec.ts && pnpm --filter @hospai/web-pms exec vitest run src/status/board-row-severity.test.ts`

Expected: PASS. Room-charges still BAR (default `rate_plan_id`).

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime packages/contracts/src/reservation-status.ts apps/web-pms/src/status/board-row-severity.ts apps/web-pms/src/status/board-row-severity.test.ts scripts/property-ddl.mjs migrations/do-property/0020_reservation_lifecycle.sql apps/pms-core/src/property-do.ts apps/pms-core/test/reservations-ledger.property.spec.ts
git commit -m "$(cat <<'EOF'
feat(do-runtime): v20 reservation lifecycle schema and plan-priced room charges

Inquiry/pending CHECK, snapshotted policy columns, CANCEL/NO_SHOW codes.
POST_ROOM_CHARGES reads reservation.rate_plan_id so BAR stays the default.

EOF
)"
```

---

### Task 3: Create / hold / confirm / expireIfDueSync

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/reservations-lifecycle.spec.ts`
- Test: spec §15 items **1–8, 9, 12, 12a, 12b**

**Interfaces:**
- Consumes: v20 columns; config `pending_hold_hours` / `inquiry_ttl_days`; wire codes
- Produces: `tryCreateReservation` optional `status` / party / `ratePlanId` / `confirmBy` / `expiresAt`; `tryConfirm`; `tryHold`; `expireIfDueSync(reservationId): 'pending' | 'inquiry' | null`

```ts
async tryConfirm(
  actor: ActorContext,
  input: { reservationId: string; ratePlanId?: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
  | { ok: false; error: typeof NOT_FOUND | typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED | typeof INVALID_STATUS_TRANSITION | typeof NO_AVAILABILITY; date?: string; ariVersion?: number }
  | { ok: false; error: string }
>

async tryHold(
  actor: ActorContext,
  input: { reservationId: string; ratePlanId?: string; confirmBy?: string },
  idem: IdempotencyKey,
): Promise< /* same shape as tryConfirm */ >
```

Fingerprint create: add `status`, `adults`, `children`, `ratePlanId`, `confirmBy`, `expiresAt` to the existing allowlist. Confirm: `{ reservationId, ratePlanId }`. Hold: `{ reservationId, ratePlanId, confirmBy }`.

- [x] **Step 1: Write failing lifecycle tests 1–8, 9, 12, 12a, 12b**

In `reservations-lifecycle.spec.ts` use `provisionedPropertyStub` + `createGuest` + `tryCreateReservation` (not the test insert) for sold-accounting tests. For 12/12a/12b, create pending then `UPDATE reservation SET confirm_by = ?` via a tiny `setConfirmByForTest` **or** pass `confirmBy` as an ISO instant in the past on create.

```ts
it('12a: expire-then-no-show → HOLD_EXPIRED, single release, no NO_SHOW line', async () => {
  // create pending with confirmBy in the past (or setConfirmByForTest)
  const before = await stub.readAvailabilityDay('rt_king', arrival);
  const ns = await stub.tryNoShow(TEST_OWNER_ACTOR, { reservationId }, await idemFor('ns', { reservationId }));
  expect(ns).toMatchObject({ ok: false, error: HOLD_EXPIRED });
  expect((await stub.readReservation(reservationId)).reservation.status).toBe('cancelled');
  expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe((before?.sold ?? 0) - 1);
  expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
});

it('12b: expire-then-cancel → ok, single release, no penalty, no second events', async () => {
  await stub.flushOutbox();
  const cancel = await stub.tryCancelReservation(TEST_OWNER_ACTOR, { reservationId }, await idemFor('c', { reservationId }));
  expect(cancel.ok).toBe(true);
  const types = await stub.listOutboxEventTypes();
  expect(types.filter((t) => t === 'availability.changed')).toHaveLength(1);
  const again = await stub.tryCancelReservation(TEST_OWNER_ACTOR, { reservationId }, await idemFor('c2', { reservationId }));
  expect(again).toMatchObject({ ok: false, error: ALREADY_CANCELLED });
});
```

Test 9: check-in from live pending → `INVALID_STATUS_TRANSITION` (not expired).

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts`

Expected: FAIL — no `tryConfirm` / create ignores `status`.

- [x] **Step 3: Implement create branch, expireIfDueSync, tryConfirm, tryHold**

`expireIfDueSync` (private, inside the caller’s `transactionSync`):

```ts
private expireIfDueSync(reservationId: string, nowMs: number): 'pending' | 'inquiry' | null {
  // SELECT status, confirm_by, expires_at, room_type_id, arrival_date, departure_date, guest_ref, pii_key_id
  // pending && confirm_by <= nowMs → cancel + sold-1 + events reason:'expired' + return 'pending'
  // inquiry && expires_at != null && expires_at <= nowMs → cancel, no ledger + return 'inquiry'
  // else return null
}
```

Caller pattern:

```ts
const expired = this.expireIfDueSync(input.reservationId, Date.now());
if (expired === 'pending') {
  if (/* this is tryCancelReservation */) { /* fall through to ok after expiry already wrote */ }
  else throw new HoldExpiredError(); // map to HOLD_EXPIRED
}
if (expired === 'inquiry') {
  if (/* tryCancelReservation */) { /* ok */ }
  else throw new InquiryExpiredError();
}
```

Create: `status = input.status ?? 'confirmed'`. `inquiry` skips availability/restrictions/`sold`. `pending`/`confirmed` keep today’s loop, snapshot policy from `rate_plan` (default `DEFAULT_RATE_PLAN_ID` + `ensureDefaultRatePlanSync`), set `confirm_by` for pending (`input.confirmBy` ms or `now + pending_hold_hours * 3600_000`). Party defaults `adults=1`, `children=0`; occupancy check vs `room_type.max_adults` / `max_occupancy` → `OCCUPANCY_EXCEEDED` (implement the throw here even if test 45 is Task 4 — cheap and keeps create honest).

`tryHold`: only `inquiry → pending`; commit `sold` + restrictions like create; snapshot policy; set `confirm_by`.

`tryConfirm`: `inquiry → confirmed` commits `sold`; `pending → confirmed` is status-only (no second `availability.changed`). Other statuses → `INVALID_STATUS_TRANSITION`.

Both new methods: `gatePermission(reservations:write)` + `gateCoreEntitlement` + `appendAuditLogSync` + `INVENTORY_FAIL_CLOSED` shape.

Map `HoldExpiredError` / `InquiryExpiredError` in `mapReservationPreconditionError` so `super(...)` contains `hold_expired` / `inquiry_expired`.

`tryCancelReservation` in this commit: widen the status gate to `inquiry | pending | confirmed` **and** apply the expire-then-ok rule. Live pending cancel without being due still only releases (penalty is Task 4; type `none` default means 0 anyway). Do **not** implement `penaltyMinor` yet.

`tryNoShow` in this commit: call `expireIfDueSync` first so 12a passes. Do not add folio posting yet.

- [x] **Step 4: Run lifecycle tests**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations.spec.ts test/reservations-routes.spec.ts`

Expected: PASS. Existing create-as-confirmed tests still pass (default status).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/reservations-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): inquiry/pending create, hold, confirm, and lazy expiry

Pending commits sold. Due holds expire in-txn; cancel succeeds, every
other caller gets HOLD_EXPIRED / INQUIRY_EXPIRED.

EOF
)"
```

---

### Task 4: Cancel / modify / assign / party / desk penalty

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCancelReservation`, `tryModifyReservation`, `tryAssignRoom`, `tryNoShow`, `tryUpdateRatePlan`, `penaltyMinor`)
- Modify: `apps/pms-core/test/reservations-lifecycle.spec.ts` (10, 11, 13–15 setup, 40–45)
- Modify: `apps/pms-core/test/reservations-ledger.property.spec.ts` (include a pending create + check-in in the random sequence — check-in still today’s bare flip until Task 5; sold still holds)
- Modify: `apps/pms-core/test/rate-plans-routes.spec.ts` or lifecycle file for `rates.update_plan` policy fields
- Test: spec §15 **10, 11, 13, 14, 15, 40–45** (29 stays Task 5 with check-in overlap)

**Interfaces:**
- Produces: `penaltyMinor(reservation, nowMs): number` using `roundHalfAwayFromZero`; desk `CANCEL` / `NO_SHOW` posts; `tryUpdateRatePlan` accepts policy fields
- Consumes: `expireIfDueSync`; charge codes from Task 2

```ts
private penaltyMinor(row: {
  status: string;
  arrival_date: string;
  departure_date: string;
  room_type_id: string;
  rate_plan_id: string;
  cancel_penalty_type: string;
  cancel_grace_hours: number;
  cancel_penalty_nights: number | null;
  cancel_penalty_bps: number | null;
}, nowMs: number): number
```

Percent: `Number(roundHalfAwayFromZero(BigInt(stayTotal) * BigInt(bps), 10000n))`. Missing `rate_day` when type needs it → throw `RateMissingError`.

Desk post (same txn as status/ledger):

```ts
this.insertFolioLineSync({
  folioLineId: `${reservationId}:cancel:${businessDate}`, // or `:noshow:${businessDate}` for tryNoShow
  folioWindowId,
  reservationId,
  chargeCode: 'CANCEL', // or 'NO_SHOW'
  posted,
  source: 'DESK',
  businessDate,
});
this.stampTaxForChargeSync({ /* parent = that line, chargeCode same, postingDate = businessDate */ });
```

- [x] **Step 1: Write failing tests 10, 11, 13, 14, 40–45**

40/41: `rates.create_plan` + `rates.update_plan` with `cancelPenaltyType: 'first_night', cancelGraceHours: 24`, create confirmed on that plan, cancel 48h before arrival (0 lines) vs after grace (`CANCEL` line = first-night `rate_day`).

42: delete/omit `rate_day` after grace → `RATE_MISSING`, still `confirmed`.

44: update plan after snapshot → existing stay still `none` or old type.

45: `adults + children > max_occupancy` → `OCCUPANCY_EXCEEDED`.

13: modify pending dates (create pending, then `tryModifyReservation`).

- [x] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts`

Expected: FAIL on 40–45 / modify pending.

- [x] **Step 3: Implement gates + penaltyMinor + assign OOO + update_plan policy**

- `tryModifyReservation`: allow `inquiry | pending | confirmed`; inquiry skips ledger; call `expireIfDueSync` first.
- `tryCancelReservation`: if `expireIfDueSync` fired → return ok (already done in Task 3). Else if live pending/confirmed → `penaltyMinor`; if `> 0` post `CANCEL` / `DESK`; then today’s release.
- `tryNoShow`: expire first; then existing confirmed gate; post `NO_SHOW` / `DESK` when `P > 0`.
- `tryAssignRoom`: allowed `pending | confirmed | checked_in`; `SELECT status FROM room`; `out_of_order` → `ROOM_OUT_OF_ORDER` (new mapping; do not reuse `ROOM_NOT_ASSIGNABLE` for OOO).
- `tryUpdateRatePlan`: persist policy columns; fingerprint includes them; validate nights/bps required by type.

- [x] **Step 4: Run lifecycle + ledger property + existing cancel/modify tests**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations.spec.ts test/reservations-ledger.property.spec.ts test/rate-plans-routes.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/reservations-lifecycle.spec.ts apps/pms-core/test/reservations-ledger.property.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): cancel penalty, pending modify, and occupancy fields

Desk cancel/no-show post CANCEL/NO_SHOW from the snapshotted plan.
Assign rejects OOO. Modify accepts inquiry and pending.

EOF
)"
```

---

### Task 5: Check-in triangle + replay canaries 31/32

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCheckIn`, `tryCancelCheckIn` keep-room already true)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts` (`reservations.check_in` payload type)
- Create: `apps/pms-core/test/reservations-check-in.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts`
- Test: spec §15 **23–33** (33 kill-switch is DO/HTTP — DO here, HTTP asserted again in Task 8)

**Interfaces:**
- Consumes: config `check_in_cleanliness`, `allow_dirty_check_in_override`
- Produces: `tryCheckIn(actor, { reservationId, roomId?: string, overrideCleanliness?: boolean }, idem, provisional?)`

- [x] **Step 1: Write failing tests 23–30, 31, 32, 33**

23: confirmed, no `room_id`, no payload → `ROOM_REQUIRED`.
24: `assign_room` then check-in without payload → `checked_in`, one `reservation.room_assigned` (the assign), check-in does not emit a second.
25: payload `roomId` on unassigned → both events in one txn.
26–28: dirty/OOO/override matrix.
30: `cancel_check_in` keeps `room_id`, room still `clean`.
31/32: follow existing `degraded-mode.spec.ts` enqueue + drain pattern (`enqueueProvisionalCommand` / consumer). 31: queue check-in with `roomId` A, live-assign A to another stay, drain → exception, first still `confirmed`. 32: queue check-in with no room → exception `ROOM_REQUIRED`.

- [x] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-in.spec.ts test/degraded-mode.spec.ts`

Expected: FAIL — check-in still ignores `room_id`.

- [x] **Step 3: Implement tryCheckIn interlocks**

Inside `runIdempotent`, after `assertProvisionalBusinessDateOpen` and `expireIfDueSync`:

1. Status must be `confirmed` else `INVALID_STATUS_TRANSITION`.
2. `resolvedRoomId = input.roomId ?? reservation.room_id`; if null → `ROOM_REQUIRED`.
3. If `input.roomId` differs from current, run assign-room checks (type, overlap, not OOO) and `UPDATE reservation.room_id`; emit `reservation.room_assigned` only when the id changed.
4. Load `room.status`. OOO → `ROOM_OUT_OF_ORDER`. Dirty + `strict` + !(override && allow config) → `ROOM_NOT_READY`.
5. Status flip + `reservation.status_changed` + `appendAuditLogSync` (include `overrideCleanliness` when set).

`REPLAY_DISPATCH['reservations.check_in']`:

```ts
invoke: (stub, payload, idem, ctx) =>
  stub.tryCheckIn(
    REPLAY_ACTOR,
    payload as { reservationId: string; roomId?: string; overrideCleanliness?: boolean },
    idem,
    ctx,
  ),
```

- [x] **Step 4: Run check-in + degraded + existing reservations-routes check-in cases**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-in.spec.ts test/degraded-mode.spec.ts test/reservations-routes.spec.ts`

Expected: existing HTTP check-in tests that use unassigned fixtures will now get `ROOM_REQUIRED` — **update those fixtures in this commit** to assign a clean room first (or the routes file goes red). Grep `check-in` in `reservations-routes.spec.ts` and `property-do.spec.ts` and fix fixtures.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/pending-commands-consumer.ts apps/pms-core/test/reservations-check-in.spec.ts apps/pms-core/test/degraded-mode.spec.ts apps/pms-core/test/reservations-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): check-in requires a room and a clean/inspected unit

Assignment may land in the same txn. Replay re-validates; conflicts
become provisional_exception. cancel_check_in keeps room_id.

EOF
)"
```

---

### Task 6: Check-out depth + replay canary 39

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCheckOut`)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Create: `apps/pms-core/test/reservations-check-out.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts`
- Test: spec §15 **34–39**

**Interfaces:**
- Produces: `tryCheckOut(actor, { reservationId, overrideBalance?: boolean }, idem, provisional?)`
- Consumes: `readFolio` reduction (inline the same `SUM(ledger_amount_minor)` — do not call the async `readFolio` from inside `transactionSync`; copy the reduce). Config `check_out_require_zero_balance`, `allow_balance_override`.

- [ ] **Step 1: Write failing tests 34–39**

34: checked_in, assigned clean room, zero folio → `checked_out`, room `dirty`, `room.status_changed`, no `folio.balance_due`.
35: post a MISC line so `balanceMinor > 0`, no override → `BALANCE_DUE`, still `checked_in`, room still clean.
36: same + `overrideBalance: true` → out + dirty + `folio.balance_due` `{ overridden: true }`.
37: set config `check_out_require_zero_balance` false → out without flag, event `{ overridden: false }`.
38: `insertReservationForTest` checked_in with no `roomId` → status flip, no room update.
39: enqueue check-out (no override) and enqueue `folio.add_item`; assert both replay orderings (charge-first → exception `BALANCE_DUE`; checkout-first → `checked_out` then late charge on still-OPEN window).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out.spec.ts`

Expected: FAIL — bare status flip, room stays clean.

- [ ] **Step 3: Implement tryCheckOut**

After status-is-`checked_in`:

```ts
const balanceMinor = /* SUM ledger_amount_minor */;
const requireZero = this.readConfigValueSync('pms.reservations.check_out_require_zero_balance') !== false;
const allowOverride = this.readConfigValueSync('pms.reservations.allow_balance_override') !== false;
if (requireZero && balanceMinor > 0 && !(input.overrideBalance && allowOverride)) {
  throw new BalanceDueError(balanceMinor);
}
// UPDATE reservation status checked_out
// if room_id: UPDATE room SET status = 'dirty'; emit room.status_changed
// if balanceMinor > 0: emit folio.balance_due { propertyId, reservationId, balanceMinor, currency, overridden }
```

Widen `REPLAY_DISPATCH['reservations.check_out']` payload. Add `BALANCE_DUE` to `mapReservationCommandErrorStatus` → 422 (Task 8 can also do this; do it here so DO tests that go through HTTP later compile — the mapper is HTTP-only, so DO tests just see `error: 'balance_due'`).

- [ ] **Step 4: Run check-out + degraded + folio-routes checkout if any**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out.spec.ts test/degraded-mode.spec.ts test/folio-routes.spec.ts`

Grep `check_out` / `check-out` in pms-core tests and fix fixtures that assume a bare flip with open balance.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/pending-commands-consumer.ts apps/pms-core/test/reservations-check-out.spec.ts apps/pms-core/test/degraded-mode.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): check-out balance gate, folio.balance_due, and HK dirty

Open balance blocks unless overridden. Departure marks the assigned
room dirty. Replay re-checks the folio sum.

EOF
)"
```

---

### Task 7: `processNoShowsSync` expiry + P/R (highest risk)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`processNoShowsSync`; occupancy snapshot `pendingCount`)
- Modify: `apps/pms-core/test/night-audit-no-shows.spec.ts` (16–22a)
- Modify: `apps/pms-core/test/night-audit-room-charges.spec.ts` (22b)
- Modify: `apps/pms-core/test/night-audit-reports.spec.ts` (**required assertion update** — see below)
- Test: spec §15 **16–22b**

**Why reports test 11 breaks:** it POSTs ROOM for `res_ci` + `res_ns`, then PROCESS no-shows `res_ns`. Today ROOM stays (`roomNet === 20000`). After this task `res_ns` has snapshotted `none` (`P === 0`) → ROOM reversed. `roomNet` must become **10000** (checked-in only). Occupancy counts stay `inHouseCount: 1, confirmedCount: 0, noShowCount: 1`. Add `pendingCount: 0` once the snapshot field exists.

Existing no-shows tests 7–10 run PROCESS **without** POST (`R === 0`, `P === 0`) → still zero folio lines. Leave them; add 16–22a alongside.

**Do not call `splitFolioLineSync`.** Split semantics ≠ reversal semantics (the helper writes a `SPLIT_REVERSAL` plus caller-provided child splits; the reverse line itself uses `${source.folio_line_id}:rev:${crypto.randomUUID()}`). Spec requires deterministic reversal ids. Write `reverseNightAuditRoomSync(reservationId, businessDate)` with `${reservationId}:noshow:audit:${D}:room-rev` and `${taxLineId}:noshow:audit:${D}:tax-rev`.

- [ ] **Step 1: Write failing tests 16–22b and update reports 11 expectation**

16: insert pending (`insertReservationForTest` + `confirmBy` in the past or `arrival_date = D`) with `bumpSoldForTest`; PROCESS → `cancelled`, sold 0, no folio, sibling confirmed → `no_show`.
17: `auto_no_show = false` → confirmed stays; due pending still expires.
18: inquiry `arrival_date = D` → cancelled.
20: POST then PROCESS on confirmed `none` → ROOM reversed (`SPLIT_REVERSAL`), no `NO_SHOW`.
21: snapshot `first_night` (extend helper), `arrival_date = D`, POST then PROCESS → ROOM remains, no `NO_SHOW`.
22: `full` on 2-night stay → reverse ROOM, post `${id}:noshow:audit:${D}` for **P**; raw second `NIGHT_AUDIT`/`NO_SHOW` insert throws; COMPLETED re-run adds zero lines.
22a: `percent` 50% 1-night → `P < R`, same reverse-then-post-P, COMPLETED, not halted.
22b: create CORP plan, `rate_day` CORP=15000 BAR=10000, reservation `ratePlanId: 'CORP'`, POST → ROOM 15000.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-no-shows.spec.ts test/night-audit-room-charges.spec.ts test/night-audit-reports.spec.ts`

Expected: FAIL on new cases; reports 11 still 20000 until Step 3 (if you change the expectation in Step 1 first, reports 11 fails immediately — **change the expectation in Step 3 with the implementation** so Step 2’s fail is the new tests).

- [ ] **Step 3: Implement processNoShowsSync**

```ts
private processNoShowsSync(businessDate: string): void {
  const now = Date.now();
  this.expirePendingAndInquirySync(businessDate, now); // always — inventory hygiene
  const auto = this.readConfigValueSync('pms.night_audit.auto_no_show');
  if (auto === false) return;
  // existing confirmed loop, plus after status/sold:
  this.reconcileNoShowPenaltySync(reservation, businessDate);
}
```

`expirePendingAndInquirySync` predicates (spec §3.4):

```sql
-- pending
status = 'pending' AND (confirm_by <= ? OR arrival_date <= ?)
-- inquiry
status = 'inquiry' AND (
  (expires_at IS NOT NULL AND expires_at <= ?) OR arrival_date <= ?
)
```

Actor `system:night_audit`, `command_id: 'night_audit.run'`. No penalty.

`reconcileNoShowPenaltySync`:

```
R = ROOM/NIGHT_AUDIT ledger for (res, D) or 0
P = penaltyMinor(row, now)
if P === 0: reverse ROOM+TAX if R > 0
else if P === R: no-op
else: reverse ROOM+TAX if R > 0; insert NO_SHOW / NIGHT_AUDIT / D / id `${res}:noshow:audit:${D}` for P; stampTax
```

Occupancy snapshot: add `pendingCount` (`status = 'pending' AND arrival_date <= D AND departure_date > D`).

- [ ] **Step 4: Run all night-audit specs**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-no-shows.spec.ts test/night-audit-room-charges.spec.ts test/night-audit-reports.spec.ts test/night-audit-double-post.spec.ts test/night-audit.spec.ts test/night-audit-routes.spec.ts test/night-audit-precheck.spec.ts`

Expected: PASS. reports 11 `roomNet === 10000`.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/night-audit-no-shows.spec.ts apps/pms-core/test/night-audit-room-charges.spec.ts apps/pms-core/test/night-audit-reports.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): night-audit pending expiry and no-show penalty reconciliation

Expiry always runs. auto_no_show gates only confirmed no-shows.
P!==R reverses ROOM and posts NO_SHOW for P; the audit never halts.

EOF
)"
```

---

### Task 8: HTTP routes 92–94 + list/read enrich + front-office

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts` (pins 92–94)
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/src/property-do.ts` (`tryUpdateFrontOffice`, `readReservation`, `listArrivals` filter + `mapFrontDeskListRow`)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts` (`reservations.update_status`)
- Modify: `apps/pms-core/test/reservations-routes.spec.ts`
- Modify: `apps/pms-core/test/front-desk-reads.spec.ts`
- Test: spec §15 **46–48, 50, 33 (HTTP kill-switch)**

**Interfaces:**
- Produces: routes 92–94; `tryUpdateFrontOffice(actor, { reservationId, frontOfficeComment?, vipFlag? }, idem, provisional?)`
- Consumes: Task 3–6 DO methods

- [ ] **Step 1: Write failing route + list tests**

`register.test.ts`:

```ts
expect(V1_HTTP_ROUTE_AUDIT[91]?.id).toBe('post_provisional_exception_resolve');
expect(V1_HTTP_ROUTE_AUDIT[92]?.id).toBe('post_reservation_confirm');
expect(V1_HTTP_ROUTE_AUDIT[93]?.id).toBe('post_reservation_hold');
expect(V1_HTTP_ROUTE_AUDIT[94]?.id).toBe('post_reservation_front_office');
```

`front-desk-reads.spec.ts`: arrivals on D includes a pending arriving D and a confirmed arriving D; excludes an inquiry arriving D.

`reservations-routes.spec.ts`: POST confirm/hold/front-office; GET reservation returns `adults`, `vipFlag`, `ratePlanId`; kill-switch 402 on confirm, 200 on check-in (33); front-office on `checked_out` → 422 `not_modifiable`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts && pnpm check:permissions`

Expected: FAIL — audit length mismatch / missing pins.

- [ ] **Step 3: Implement routes + handlers + list SQL + tryUpdateFrontOffice**

Append audit rows 92–94 (spec §10). Matching `V1_ROUTES` at the **end** of the array.

`listArrivals` SQL: `arrival_date = ? AND status IN ('confirmed', 'pending')`.

`mapFrontDeskListRow` / `readReservation`: add `adults`, `children`, `frontOfficeComment`, `vipFlag`, `confirmBy`, `ratePlanId`.

`handlePostReservationCheckIn`: parse optional JSON `{ roomId?, overrideCleanliness? }`; keep **header** `x-idempotency-key`; fingerprint `{ reservationId, roomId, overrideCleanliness }`. Same for check-out `{ overrideBalance? }`.

`mapReservationCommandErrorStatus`: add `HOLD_EXPIRED`, `INQUIRY_EXPIRED`, `ROOM_REQUIRED`, `ROOM_NOT_READY`, `ROOM_OUT_OF_ORDER`, `BALANCE_DUE`, `OCCUPANCY_EXCEEDED` → 422.

`tryUpdateFrontOffice`: expire first; reject terminal statuses `NOT_MODIFIABLE`; LWW comment/vip; event `reservation.front_office_updated`; `appendAuditLogSync`; no entitlement gate; add `REPLAY_DISPATCH` entry.

Create/patch handlers: pass through new optional body fields; create fingerprint must include `status` (wizard remint).

- [ ] **Step 4: Run routes + front-desk + permissions**

Run: `pnpm check:permissions && pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts test/front-desk-reads.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/property-do.ts apps/pms-core/src/pending-commands-consumer.ts apps/pms-core/test/reservations-routes.spec.ts apps/pms-core/test/front-desk-reads.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): confirm/hold/front-office routes and enriched desk lists

Arrivals include pending. Check-in/out keep header idempotency keys.
update_status writes the stay comment and VIP flag.

EOF
)"
```

---

### Task 9: SPA + client-core

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` + `.test.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Create: `apps/web-pms/src/screens/CheckInScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` + `.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` (pending Confirm control if rows expose status)
- Test: spec §15 **52–55** (55 also covered by Task 2 severity; add pending-row board assertion here if BoardScreen filters status)

**Interfaces:**
- Consumes: Task 8 HTTP
- Produces: `createReservation({ status? })`; `confirmReservation`; `holdReservation`; `updateFrontOffice`; `checkIn(..., { roomId?, overrideCleanliness? })`; `checkOut(..., { overrideBalance? })`

- [ ] **Step 1: Write failing SPA tests 52–54**

52: Booking Hold vs Confirm — assert `createReservation` called with `status: 'pending'` vs omitted/`confirmed`, and opId contains the status (inspect the mock’s idempotency/opId argument).
53: CheckInScreen — Check-in button disabled without a room; on `ROOM_NOT_READY` show override checkbox.
54: FolioScreen — confirm dialog yes → `checkOut` called with `overrideBalance: true`; dismiss → `checkOut` not called. Delete the “does not require settlement” copy (assert it is gone).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx src/screens/CheckInScreen.test.tsx src/screens/FolioScreen.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement client-core + screens**

Wizard: secondary Hold/Quote buttons; extend `bookingReservationOpId`'s composition with `status` so Hold vs Confirm vs Quote remint the key.

CheckInScreen: require room (pre-assigned from `getReservation` or input); remove “assignment is optional” copy; pass `roomId` on check-in.

FolioScreen: `window.confirm` → `overrideBalance: true`; remove settlement copy.

- [ ] **Step 4: Run web-pms tests + me-gating / colors if screens add classes**

Run: `pnpm --filter @hospai/web-pms exec vitest run && pnpm --filter @hospai/client-core exec vitest run && pnpm check:web-pms-colors && pnpm check:web-pms-me-gating`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts apps/web-pms
git commit -m "$(cat <<'EOF'
feat(web-pms): Hold/Quote, required check-in room, and checkout override

Wizard stays direct-confirm. Hold and Quote are secondary actions.
Folio checkout override is the server BALANCE_DUE flag.

EOF
)"
```

---

### Task 10: ARCHITECTURE + bidirectional spec pointers

**Files:**
- Modify: `ARCHITECTURE.md` (§7.1 sold sentence; assign-at-check-in one-liner; §16.5 drift paragraph retired; still-unnamed rows for party / FO comments / cancel policy marked keep)
- Modify: `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` (one sentence: PROCESS_NO_SHOWS expires pending; POST prices `reservation.rate_plan_id`; leftover 2 closed)
- Modify: `docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md` (arrivals filter `confirmed | pending`)
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` (leftover 1 schema landed; leftover 7 `update_status` retargeted)

- [ ] **Step 1: Edit the four documents**

§7.1 replace “sold equals the count of confirmed reservations” with “sold equals the count of reservations in `pending | confirmed | checked_in | checked_out` covering that night.”

§7.1 assign sentence: add “Pre-assign is allowed; check-in without a resolved room is rejected.”

§16.5: delete the “shipped machine is confirmed|… only” drift paragraph (or replace with “restored 2026-08-12”). Mark the three still-unnamed rows keep.

- [ ] **Step 2: Grep-check the pointers exist in both directions**

Run: `rg -n "reservation.rate_plan_id|confirmed \\| pending|update_status" docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md docs/superpowers/specs/2026-08-11-booking-wizard-design.md`

Expected: each file has the one-sentence amend.

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md docs/superpowers/specs/2026-08-11-booking-wizard-design.md
git commit -m "$(cat <<'EOF'
docs: align ARCHITECTURE and sibling specs with reservation lifecycle

Sold invariant includes pending and in-house. Night audit, desk lists,
and the wizard leftovers point at this chunk.

EOF
)"
```

---

### Task 11: Full CI (`ci.yml` order)

**Files:** none expected. Fix anything this sequence turns red. Tick living checkboxes on this plan in the same PR.

- [ ] **Step 1: Run the `checks` job locally, in this order**

```
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

- [ ] **Step 2: Run the pms-core shard matrix**

```
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Do not put `--` before `--shard`. Expected: all four exit 0.

- [ ] **Step 3: Tick living checkboxes on this plan**

Mark Tasks 1–11 steps `- [x]` in this file. Same PR as the last implementation commit, or a docs commit in that PR.

- [ ] **Step 4: Commit only if Step 3 left docs dirty**

```bash
git add docs/superpowers/plans/2026-08-12-reservations-lifecycle-completion.md
git commit -m "$(cat <<'EOF'
docs: tick reservation lifecycle plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip the commit.

---

## Spec coverage (self-review)

| Spec §15 / requirement | Task |
|---|---|
| 1–8, 9, 12, 12a, 12b | 3 |
| 10, 11, 13, 14, 40–45 | 4 |
| 15 ledger property | 2 (rename) + 4 (sequence) |
| 16–22a | 7 |
| 22b | 7 (`night-audit-room-charges`) |
| 23–33 | 5 (+ 8 for HTTP 33) |
| 31, 32 | 5 (`degraded-mode.spec.ts`) |
| 34–38 | 6 |
| 39 | 6 (`degraded-mode.spec.ts`) |
| 46–48, 50 | 8 |
| 49 statuses ↔ v20 CHECK | 2 |
| 51 gates | 11 |
| 52–55 SPA | 9 (55 severity also Task 2) |
| v20 indexes v11+v18+new | 2 |
| `AUDIT_WRITER` 35 | 1 |
| Routes 92–94 | 8 |
| `postRoomChargesSync` plan lookup | 2 |
| `processNoShowsSync` + `auto_no_show` split | 7 |
| `expireIfDueSync` cancel-ok vs HOLD_EXPIRED | 3 |
| ARCHITECTURE / sibling pointers | 10 |
| Out of scope (groups, deposits, tape, `held`) | not implemented |
