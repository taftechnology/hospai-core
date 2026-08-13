# Room Operations & Housekeeping Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `rooms.set_ooo_range` (per-room OOO ranges that increment `availability_day.blocked`), close the last `PLATFORM_GAPS` row, amend assign/check-in/modify/check-out gates for stay ∩ range, and finish the HK board (dropdown, filters, workload, roster-error isolation, inventory-gated OOO form).

**Architecture:** OOO is inventory, not housekeeping. `room_ooo` is the source of the delta; `availability_day.blocked` is type-level. Validate-then-mutate: set-difference nights, increment/decrement in-horizon rows only, skip past-horizon tails, throw `LedgerInconsistentError` on a missing in-horizon row. `reconcileHorizon` INSERT is born-blocked from `COUNT(room_ooo)` — load-bearing for those tails. `room.status === 'out_of_order'` is derived (covers open business date). Cleanliness writes stay `QUEUE_PROVISIONAL`; OOO is `FAIL_CLOSED` `inventory:write`.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/do-runtime` v22, vitest + cloudflare:test, React SPA in `apps/web-pms` / `modules/pms/housekeeping`.

**Spec:** `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` (Approved). Spec commit: `7385249d3ab31a20fef119d0745198496cfd208a`.

## Global Constraints

- OOO increments `blocked`, never `physical`. Delta, not recompute. Free may go negative (no `OOO_WOULD_OVERSELL`).
- Half-open `[startDate, endDate)`. Adjacent ranges are not overlap and are not auto-merged.
- Create `startDate < openDate` → `OOO_INVALID_RANGE`. On **edit**, that reject applies to **newly added nights only**.
- Past-horizon nights: store on `room_ooo`, skip ledger; `reconcileHorizon` born-blocked is the only writer. Not `UNBOOKABLE`.
- `NIGHT_AUDIT_STEPS` stays **7**. Status sync folds into `runRollStepSync` after `reconcileHorizon`. Occupancy snapshot shape unchanged.
- Route audit append-only: index **[104]** = `post_room_ooo_range`. Catalog/routes are **different commits** (`check:permissions` stays green). Task 1 must not touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT`.
- `AUDIT_WRITER_COMMAND_IDS.size` goes 44 → **45** in Task 1. Status/assign audit from the DO binder stays **off** that set.
- Drop `rooms.set_ooo_range` from `PLATFORM_GAPS` in Task 1. `register.test.ts` pins `PLATFORM_GAPS` `toEqual([])`.
- Fixture dates from property-local `business_date`. New tests key fixtures with `crypto.randomUUID()`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 9). Do not backfill historical plans.
- No either/or forks. Do not reopen DND-as-status, OOS as a second CHECK, auto-merge, force-OOO, or atomic move+OOO.
- Staff cannot `inventory:write`. HK dropdown drops `out_of_order`.
- **Label-era rewrite owner = Task 4** (gates), after `trySetOooRange` exists (Task 3) and **before** the cleanliness-only split (Task 5) which would break those tests if they still called `tryUpdateRoomStatus({ status: 'out_of_order' })`.
- `status_before` CHECK is `clean|dirty|inspected` only. If live `room.status` is already `out_of_order` when inserting a placeholder, copy the covering row’s `status_before`, else `'clean'`.
- Check-out skip when status is OOO is product-unreachable under invariant 4. Test 28 uses documented `setRoomStatusRawForTest` (unsafe-local), not a product path.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Promote `rooms.set_ooo_range`; empty `PLATFORM_GAPS`; status notes |
| `packages/contracts/src/idempotency.ts` | Four wire codes |
| `packages/contracts/src/commands/audit-writers.ts` | +1; size 45 |
| `packages/contracts/src/config/register.ts` | `pms.housekeeping.require_inspection` |
| `packages/contracts/src/register.test.ts` | Size 45 (Task 1); `[104]` pin (Task 6); `PLATFORM_GAPS` empty |
| `apps/pms-core/src/event-consumer.ts` | `room.ooo_changed` (Task 1) |
| `apps/pms-core/src/property-do.ts` | Comment pin (Task 1); `trySetOooRange` + delta + born-blocked + roll sync (Task 3); gates (Task 4); binder audit (Task 5); `listRooms` `oooRanges` (Task 6) |
| `packages/do-runtime/src/property-migrations.ts` | v22 `room_ooo` + backfill |
| `migrations/do-property/0022_room_ooo.sql` | Generated |
| `scripts/property-ddl.mjs` | 0022 target |
| `packages/do-runtime/src/migrate.test.ts` | Head 22; on-disk match |
| `packages/do-runtime/src/room-ooo-migration.sqlite.test.ts` | Real-SQLite CHECK / FK |
| `modules/pms/housekeeping/src/domain/room-status.ts` | `CLEANLINESS_STATUSES` (Task 5) |
| `apps/pms-core/src/v1-dispatch.ts` | Route [104] + handler (Task 6) |
| `packages/contracts/src/v1-http-routes.ts` | `[104] = post_room_ooo_range` (Task 6) |
| `packages/client-core/src/api.ts` | `setOooRange`; `listRooms` type widen (Task 6) |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | Board (Task 7) |
| `apps/web-pms/src/screens/HousekeepingScreen.tsx` | `canReadRoster` / `canSetOoo` (Task 7) |
| Sibling specs | Bidirectional one-liners (Task 8) |

## Test file split (spec §17 → file)

| Spec # | File | Task |
|---|---|---|
| 40 size/empty-gaps, 43 allowlist | `packages/contracts/src/register.test.ts` + `apps/pms-core/test/events-queue.spec.ts` | 1 |
| 41, 44 | `packages/do-runtime` migrate + sqlite tests | 2 |
| 1–3, 5–8, 12–19, 19b, 21; test 4 create-half | `apps/pms-core/test/rooms-ooo.spec.ts` (new) | 3 |
| 20 | extend `apps/pms-core/test/night-audit-reports.spec.ts` | 3 |
| 4 assign-half, 15–17 (already in Task 3 if assignment SQL is in `trySetOooRange`), 25 rewrite, 26–28, 31–33 | `rooms-ooo.spec.ts` + rewrite in `reservations-check-in.spec.ts` / `reservations-lifecycle.spec.ts` | **4 owns the two label-era rewrites**; 15–17 land in Task 3 with the delta path |
| 22–24, 29–30 | `rooms-ooo.spec.ts` + HK module unit tests | 5 |
| 8 HTTP, 9–11, 40 `[104]`, GET `oooRanges` | `apps/pms-core/test/rooms-ooo-routes.spec.ts` (new) + `register.test.ts` | 6 |
| 34–39 | `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx` | 7 |
| Bidirectional pointers | sibling specs | 8 |
| 42 | Task 9 CI | 9 |

Tests 15–17 (`OOO_ROOM_ASSIGNED`) are the OOO **command** refusing an assigned room — they belong in **Task 3** with the delta path, not Task 4. Task 4 is stay-side gates (`assertRoomAssignableSync`, check-in, modify §4.6, check-out skip) plus the two label-era rewrites.

---

### Task 1: Contracts (own commit, no HTTP routes)

**Spec:** §3.2, §10, §11, §13, §17 tests 40 (size + empty gaps only — not `[104]`), 43.

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/event-consumer.ts`
- Modify: `apps/pms-core/src/property-do.ts` (comment pin only)
- Test: `packages/contracts` vitest + `apps/pms-core/test/events-queue.spec.ts`

**Interfaces:**
- Produces: catalog id `rooms.set_ooo_range`; four wire codes; `AUDIT_WRITER_COMMAND_IDS.size === 45`; config key `pms.housekeeping.require_inspection`; event-consumer case `room.ooo_changed`; `PLATFORM_GAPS` `toEqual([])`
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any `/ooo` handler, any DO method body, any `listRooms` shape change.

- [x] **Step 1: Write the failing register + idempotency tests**

In `packages/contracts/src/idempotency.test.ts` add:

```ts
it('room OOO wire codes', () => {
  expect(OOO_VIA_RANGE).toBe('ooo_via_range');
  expect(OOO_ROOM_ASSIGNED).toBe('ooo_room_assigned');
  expect(OOO_RANGE_OVERLAP).toBe('ooo_range_overlap');
  expect(OOO_INVALID_RANGE).toBe('ooo_invalid_range');
});
```

Import the four new consts.

In `packages/contracts/src/register.test.ts`:

1. Change `expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(44)` → `toBe(45)`.
2. Replace `documents platform gaps` (`PLATFORM_GAPS.length` `toBeGreaterThanOrEqual(1)`) with:

```ts
it('documents platform gaps', () => {
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('availability.book');
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('config.put_domain');
  expect(PLATFORM_GAPS).toEqual([]);
});
```

3. Replace `PLATFORM_GAPS no longer lists transfer_charge or split_charge_v2` (the line that still `toContain('rooms.set_ooo_range')`) with:

```ts
it('PLATFORM_GAPS is empty after rooms.set_ooo_range promotion', () => {
  expect(PLATFORM_GAPS).toEqual([]);
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.transfer_charge');
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.split_charge_v2');
  expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('rooms.set_ooo_range');
});
```

4. Add:

```ts
it('rooms.set_ooo_range is entitled FAIL_CLOSED INTERACTIVE inventory:write', () => {
  const c = COMMAND_CATALOG.find((x) => x.id === 'rooms.set_ooo_range');
  expect(c?.prototypeAction).toBeNull();
  expect(c?.lane).toBe('INTERACTIVE');
  expect(c?.degraded).toBe('FAIL_CLOSED');
  expect(c?.idempotent).toBe(true);
  expect(c?.entitlement).toBe('pms.core');
  expect(c?.permission).toBe('inventory:write');
  expect(c?.events).toEqual(['room.ooo_changed', 'availability.changed', 'room.status_changed']);
  expect(c?.notes).toMatch(/INVENTORY_FAIL_CLOSED_NOTES|Inventory-affecting/);
  expect(AUDIT_WRITER_COMMAND_IDS.has('rooms.set_ooo_range')).toBe(true);
});

it('require_inspection is DOMAIN bool default false consumersExempt', () => {
  const e = CONFIG_REGISTER.find((x) => x.key === 'pms.housekeeping.require_inspection');
  expect(e?.class).toBe('DOMAIN');
  expect(e?.default).toBe(false);
  expect(e?.consumersExempt).toBe(true);
});
```

Do **not** add `[104]` assertions this commit (`V1_HTTP_ROUTE_AUDIT[103]` stays `post_folio_capture_due`; `[104]` is undefined until Task 6).

In `apps/pms-core/test/events-queue.spec.ts`, add `'room.ooo_changed'` to the rooms/housekeeping loop (or rely on the existing `accepts every COMMAND_CATALOG event type` test — that test **fails** until `event-consumer.ts` allowlists the new type).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
```

Expected: FAIL — missing exports / size still 44 / `PLATFORM_GAPS` still lists `rooms.set_ooo_range` / unknown event type.

- [x] **Step 3: Implement contracts**

`packages/contracts/src/idempotency.ts` — after the Room / housekeeping wire codes block:

```ts
export const OOO_VIA_RANGE = 'ooo_via_range' as const;
export const OOO_ROOM_ASSIGNED = 'ooo_room_assigned' as const;
export const OOO_RANGE_OVERLAP = 'ooo_range_overlap' as const;
export const OOO_INVALID_RANGE = 'ooo_invalid_range' as const;
```

`packages/contracts/src/commands/audit-writers.ts` — add `'rooms.set_ooo_range'` after `'rooms.update'`.

`packages/contracts/src/commands/catalog.ts`:

- Insert immediately after `rooms.update` (before `rooms.update_status`):

```ts
{
  id: 'rooms.set_ooo_range',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['room.ooo_changed', 'availability.changed', 'room.status_changed'],
  entitlement: 'pms.core',
  permission: 'inventory:write',
  notes:
    INVENTORY_FAIL_CLOSED_NOTES +
    ' prototypeAction null: no SET_OOO_RANGE in PROTOTYPE_ACTIONS ' +
    '(prototype folded OOO into room-status / inventory screens). ' +
    'Null here records that no prototype action exists to cite, same family as rooms.create.',
},
```

- On `rooms.update_status`, add `notes: 'Payload out_of_order is not legal; use rooms.set_ooo_range (OOO_VIA_RANGE).'`
- Replace `PLATFORM_GAPS` with `export const PLATFORM_GAPS: PlatformGap[] = [];`

`packages/contracts/src/config/register.ts` — after `pms.reservations.check_in_cleanliness`:

```ts
entry({
  key: 'pms.housekeeping.require_inspection',
  prototypeKey: 'pms_hk_require_inspection',
  class: 'DOMAIN',
  schema: bool,
  default: false,
  consumersExempt: true,
}),
```

`apps/pms-core/src/event-consumer.ts` — add `case 'room.ooo_changed':` next to `room.status_changed` in the presence allowlist.

`apps/pms-core/src/property-do.ts` — extend the `appendAuditLogSync` comment so the source-scan pin passes before the method exists:

```
 * Room OOO audit writer (method lands in a later task):
 * 'rooms.set_ooo_range'
```

The `PropertyDO source wires every AUDIT_WRITER_COMMAND_IDS literal` test matches `'rooms.set_ooo_range'` as a quoted string in that file.

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
```

Expected: all exit 0. `check:permissions` stays green because no route was added.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/config/register.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(contracts): promote rooms.set_ooo_range and empty PLATFORM_GAPS

EOF
)"
```

Never stage `package.json`.

---

### Task 2: v22 `room_ooo` + backfill

**Spec:** §3.3, §3.10, §17 tests 41, 44.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `scripts/property-ddl.mjs`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Create: `packages/do-runtime/src/room-ooo-migration.sqlite.test.ts`
- Create (generated): `migrations/do-property/0022_room_ooo.sql`

**Interfaces:**
- Produces: `ROOM_OOO_V22_SQL` / `ROOM_OOO_V22_STATEMENTS`; `PROPERTY_SCHEMA_HEAD === 22`; table `room_ooo`; backfill of label-era `out_of_order`
- Consumes: Task 1 (nothing runtime)
- Forbidden: DO methods, HTTP routes

- [x] **Step 1: Write the failing migrate + sqlite tests**

In `packages/do-runtime/src/migrate.test.ts` `schema head constants`:

```ts
it('property schema head is 22 after room_ooo', () => {
  expect(PROPERTY_SCHEMA_HEAD).toBe(22);
  expect(Math.max(...PROPERTY_MIGRATIONS.map((m) => m.version))).toBe(22);
  const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22);
  expect(v22?.name).toBe('room_ooo');
  expect(v22?.statements.some((s) => s.includes('CREATE TABLE room_ooo'))).toBe(true);
  expect(v22?.statements.some((s) => s.includes('ooo_backfill_'))).toBe(true);
});

it('migrations/do-property/0022_room_ooo.sql matches ROOM_OOO_V22_SQL', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '../../../migrations/do-property/0022_room_ooo.sql');
  const onDisk = readFileSync(path, 'utf8');
  const body = onDisk
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n')
    .trim();
  expect(body).toBe(ROOM_OOO_V22_SQL.trim());
});
```

Change the existing `expect(PROPERTY_SCHEMA_HEAD).toBe(21)` in `match current migration array tails` to `toBe(22)`. Leave the v21 pin test as historical (`property schema head is 21 after folio money ops` still asserts v21 exists).

Create `packages/do-runtime/src/room-ooo-migration.sqlite.test.ts` (folio sqlite pattern: `DatabaseSync`, `PRAGMA foreign_keys = ON`, apply every `PROPERTY_MIGRATIONS` statement):

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

function seedRoom(db: DatabaseSync) {
  db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, status, created_at, updated_at)
           VALUES ('rt_1', 'KING', 'King', 5, 'active', 0, 0)`);
  db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
           VALUES ('rm_1', 'rt_1', '101', 'clean', NULL, 0, 0)`);
}

describe('room_ooo v22 real sqlite', () => {
  it('CHECK start_date < end_date rejects equals; FK to room holds; overlapping rows are allowed by SQL', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);
    seedRoom(db);

    db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
             VALUES ('ooo_a', 'rm_1', '2026-08-12', '2026-08-15', NULL, 'clean', 0, 0)`);
    db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
             VALUES ('ooo_b', 'rm_1', '2026-08-13', '2026-08-16', NULL, 'clean', 0, 0)`);

    expect(() =>
      db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
               VALUES ('ooo_eq', 'rm_1', '2026-08-12', '2026-08-12', NULL, 'clean', 0, 0)`),
    ).toThrow();

    expect(() =>
      db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
               VALUES ('ooo_fk', 'rm_missing', '2026-08-12', '2026-08-15', NULL, 'clean', 0, 0)`),
    ).toThrow();
  });

  it('backfill: label-era out_of_order with business_date becomes a range and blocked >= 1', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const until21 = PROPERTY_MIGRATIONS.filter((m) => m.version <= 21);
    for (const m of until21) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 'active', 0, 0)`);
    db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
             VALUES ('rm_ooo', 'rt_1', '109', 'out_of_order', NULL, 0, 0)`);
    db.exec(`INSERT INTO property_config (key, value_json, version, updated_at)
             VALUES ('__meta.business_date', '"2026-08-12"', 1, 0)`);
    db.exec(`INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
             VALUES ('rt_1', '2026-08-12', 5, 0, 0, 0, 0, 1)`);
    const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22)!;
    execAll(db, v22.statements!);
    const ranges = db.prepare(`SELECT ooo_id, start_date, end_date, status_before FROM room_ooo`).all() as Array<{
      ooo_id: string; start_date: string; end_date: string; status_before: string;
    }>;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start_date).toBe('2026-08-12');
    expect(ranges[0]!.end_date).toBe('2027-08-12');
    expect(ranges[0]!.status_before).toBe('clean');
    const day = db.prepare(`SELECT blocked FROM availability_day WHERE stay_date = '2026-08-12'`).get() as { blocked: number };
    expect(day.blocked).toBeGreaterThanOrEqual(1);
  });

  it('backfill skips when business_date unset', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const until21 = PROPERTY_MIGRATIONS.filter((m) => m.version <= 21);
    for (const m of until21) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 'active', 0, 0)`);
    db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
             VALUES ('rm_ooo', 'rt_1', '109', 'out_of_order', NULL, 0, 0)`);
    const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22)!;
    execAll(db, v22.statements!);
    const n = db.prepare(`SELECT COUNT(*) AS c FROM room_ooo`).get() as { c: number };
    expect(n.c).toBe(0);
  });
});
```

Adjust `room_type` / `room` INSERT column lists to match v11 DDL if the sqlite test fails on NOT NULL columns — read `ROOM_AND_HOUSEKEEPING_V11_SQL` and copy the live column set. Do not invent columns.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/room-ooo-migration.sqlite.test.ts
```

Expected: FAIL — head still 21 / missing file / missing statements.

- [x] **Step 3: Implement v22**

In `packages/do-runtime/src/property-migrations.ts` append (no PRAGMA wrap — this is CREATE + DML, not a table rebuild):

```ts
export const ROOM_OOO_V22_STATEMENTS: string[] = [
  `CREATE TABLE room_ooo (
  ooo_id        TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  reason        TEXT,
  status_before TEXT NOT NULL
                CHECK (status_before IN ('clean', 'dirty', 'inspected')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  CHECK (start_date < end_date)
)`,
  `CREATE INDEX room_ooo_room_dates ON room_ooo (room_id, start_date, end_date)`,
  `INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
SELECT
  'ooo_backfill_' || room.room_id,
  room.room_id,
  json_extract(pc.value_json, '$'),
  date(json_extract(pc.value_json, '$'), '+365 days'),
  NULL,
  'clean',
  0,
  0
FROM room
CROSS JOIN property_config pc
WHERE room.status = 'out_of_order'
  AND pc.key = '__meta.business_date'`,
  `UPDATE availability_day
SET blocked = blocked + (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
), version = version + 1
WHERE (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
) > 0`,
];

export const ROOM_OOO_V22_SQL = ROOM_OOO_V22_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```ts
{
  version: 22,
  name: 'room_ooo',
  statements: ROOM_OOO_V22_STATEMENTS,
},
```

The blocked UPDATE **must** use `COUNT(*)`, not `EXISTS` — two OOO rooms of the same type must increment `blocked` by 2.

`packages/do-runtime/src/index.ts` — re-export `ROOM_OOO_V22_SQL` and `ROOM_OOO_V22_STATEMENTS` next to the v21 exports.

`scripts/property-ddl.mjs` — add `let ROOM_OOO_V22_SQL;` to the declaration list, destructure it from the dynamic import next to `FOLIO_MONEY_OPS_V21_SQL`, and append a `doPropertyTargets` entry:

```js
{
  path: join(root, 'migrations/do-property/0022_room_ooo.sql'),
  header: `-- PropertyDO room OOO ranges — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE room_ooo → index → label-era backfill INSERT → blocked increment.

`,
  sql: ROOM_OOO_V22_SQL,
},
```

Then:

```bash
pnpm generate:ddl
```

(`pnpm generate:ddl` = `pnpm --filter @hospai/do-runtime build && node scripts/property-ddl.mjs --write`.)

If `room_type` INSERT in the sqlite test is missing columns, fix the **test seed**, not the migration.

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/room-ooo-migration.sqlite.test.ts
pnpm check:ddl
```

Expected: all exit 0. `PROPERTY_SCHEMA_HEAD === 22`.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/room-ooo-migration.sqlite.test.ts \
  scripts/property-ddl.mjs \
  migrations/do-property/0022_room_ooo.sql
git commit -m "$(cat <<'EOF'
feat(schema): add v22 room_ooo ranges and label-era backfill

EOF
)"
```

---

### Task 3: Delta helper + `trySetOooRange` + born-blocked horizon + roll status sync

**Spec:** §3.4, §3.5, §3.7, §3.8, §9.1, §14, §17 tests 1–3, 5–8, 12–19, **19b**, 21, test 4 **create-half** (status stays clean; blocked +=). Tests 15–17 (`OOO_ROOM_ASSIGNED`) live here. Test 20 occupancy snapshot. Test 4 **assign-half** waits for Task 4.

**Files:**
- Create: `apps/pms-core/test/rooms-ooo.spec.ts`
- Modify: `apps/pms-core/test/night-audit-reports.spec.ts` (test 20)
- Modify: `apps/pms-core/src/property-do.ts`

**Interfaces:**
- Produces: `trySetOooRange(actor, input, idem)` as specified below; `reconcileHorizon` INSERT `blocked` from `COUNT(room_ooo)`; `syncOooStatusForRoomSync` / `syncOooStatusAllRoomsSync` called from OOO txn and `runRollStepSync`
- Consumes: v22 table (Task 2); catalog id + wire codes (Task 1)
- Forbidden: HTTP routes; `CLEANLINESS_STATUSES` split; `assertRoomAssignableSync` range SQL (Task 4); `listRooms` `oooRanges` (Task 6)

`trySetOooRange` signature:

```ts
async trySetOooRange(
  actor: ActorContext,
  input: {
    roomId: string;
    startDate: string;
    endDate: string;
    oooId?: string;
    reason?: string;
  },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; roomId: string; oooId: string; alreadyApplied?: true }
  | { ok: false; error: typeof NOT_FOUND }
  | { ok: false; error: typeof OOO_INVALID_RANGE }
  | { ok: false; error: typeof OOO_RANGE_OVERLAP }
  | { ok: false; error: typeof OOO_ROOM_ASSIGNED; reservationId?: string }
  | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
  | { ok: false; error: typeof IDEM_KEY_REUSED }
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
  | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' }
  | { ok: false; error: typeof PROPERTY_ID_UNSET }
  | { ok: false; error: 'org_id_unset' }
  | { ok: false; error: string }
>
```

Fingerprint allowlist: `{ roomId, startDate, endDate, oooId? }` (omit `oooId` when absent so create keys match). Copy `tryCreateRoom`: `assertRpcAvailable`, `touchInteractive`, `gatePermission(actor, 'inventory:write')`, `gateCoreEntitlement`, `runIdempotent` inside `transactionSync`. No provisional parameter.

**Throw vs return inside `runIdempotent`:** `runIdempotent` caches every returned value, including `{ ok: false }`. Spec §4.6 (and the same retry story for OOO after a room-move): throw `OooRoomAssignedError` / `OooRangeOverlapError` / `OooInvalidRangeError` / `LedgerInconsistentError` **inside** the callback so the idempotency row is not written. Map them in the outer `catch` (extend `mapReservationPreconditionError`). `NOT_FOUND` may throw `RoomNotFoundError` / `RoomTypeNotFoundError` as today.

- [x] **Step 1: Write the failing tests**

Create `apps/pms-core/test/rooms-ooo.spec.ts`. Copy the local `addRoomType` / `createRoom` / `bookConfirmed` helpers from `reservations-check-in.spec.ts`. Shared setup:

```ts
async function setupOoo(name: string) {
  const { stub, orgId, guestRef } = await provisionedPropertyWithGuest(name);
  const added = await addRoomType(stub, 'rt_king', 5);
  await createRoom(stub, 'rm_1', '101');
  return { stub, orgId, guestRef, open: added.fromDate };
}
```

Assert via `stub.readAvailabilityDay('rt_king', date)`, `stub.listRooms()`, `stub.listAuditLog`, `stub.flushOutbox` / outbox inspection used by sibling specs, `NIGHT_AUDIT_STEPS.length`.

Minimum cases this commit (names match spec §17):

1. Vacant `[open, open+3)` → blocked += 1 on those three nights only; physical/sold unchanged; `listRooms` status `out_of_order`; one `availability.changed`; `room.ooo_changed` action `created`; `readAvailabilityDay.free` down by 1.
2. Same idempotency key replay → `alreadyApplied: true` (or equivalent ok); audit row count unchanged; blocked still +1.
3. Book type on a blocked night → `NO_AVAILABILITY`; book a night after `endDate` → ok.
5. Two disjoint ranges → both apply; overlapping second create → `OOO_RANGE_OVERLAP`; blocked unchanged on failure.
6. `startDate >= endDate` → `OOO_INVALID_RANGE`.
7. Past-start create (`startDate = open-1`, `endDate = open+1`) → `OOO_INVALID_RANGE`; blocked unchanged.
8. Unknown `roomId` → `NOT_FOUND`.
12. Extend `endDate` by two nights → those two blocked += 1; `action: 'updated'`.
13. Early-release shrink `endDate` so open is uncovered → blocked -= dropped; status restores `status_before`.
14. Full release (`endDate` equal to `startDate` is invalid — delete by posting `endDate === startDate` is **not** the API; full release is edit whose new range is empty, i.e. caller sends `endDate` equal to `startDate` after shrink-to-nothing). Spec: full release = edit that would make `startDate >= endDate`, **or** explicit end equal to start → **delete** the row. Implement: when `oooId` is present and `startDate >= endDate` after normalize, treat as release-delete (do **not** return `OOO_INVALID_RANGE` on edit-to-empty). Create with `startDate >= endDate` still `OOO_INVALID_RANGE`. Second release of missing `oooId` → `NOT_FOUND`. `action: 'released'`.
15. Extend onto a night with assigned `confirmed` → `OOO_ROOM_ASSIGNED`; no ledger change. `assign_room` move, then extend succeeds.
16. `checked_in` covering today → `OOO_ROOM_ASSIGNED`. `cancel_check_in` (keeps `room_id`) still `OOO_ROOM_ASSIGNED` until `assign_room` moves it.
17. `pending` assigned overlap → `OOO_ROOM_ASSIGNED`. Cancel that reservation (leftover `room_id`) does **not** block.
18. Backdate `setBusinessDateForTest` **before** `tryAddRoomType` (night-audit.spec.ts test 4 pattern) so ROLL has work. Range `[open, horizonEnd+3)` succeeds (not `UNBOOKABLE`). In-horizon nights blocked += 1. `SELECT`/`readAvailabilityDay` for `horizonEnd+1` is null. After `startNightAudit({ pendingOpenCount: 0 })`, the new last day is born `blocked = 1`. `expect(NIGHT_AUDIT_STEPS).toHaveLength(7)`.
19. Future-start range; dirty the room; `setBusinessDateForTest` to `startDate-1` then `startNightAudit` until `openDate === startDate` → status `out_of_order` without a second OOO command.
19b. **Roll-out restores `status_before`, not `'clean'`.** Room dirty → `trySetOooRange` covering `[open, open+2)` → status `out_of_order`, `status_before` dirty → `setBusinessDateForTest` / `startNightAudit` until `openDate === endDate` → `room.status` restores `'dirty'` (not `'clean'`). Pins the uncover query: covering (`end_date > openDate`) is empty on natural expiry; restore must read the just-ended row.
21. After a normal create, call a second `startNightAudit` that is already current (no ROLL insert) — existing in-horizon `blocked` unchanged (delta path still owns them). Also: `reconcileHorizon` is not a public RPC; this is the roll no-op path.

Test 4 **create-half** (Task 3): future-only `[open+5, open+8)` → status stays `clean`; those three nights blocked += 1. Do **not** assert assign yet.

Staff 403 / HTTP 503 / kill-switch (tests 9–11) wait for Task 6. DO-level `gatePermission` staff → `FORBIDDEN` may be asserted here with `org.ensureMember('user_staff_ooo', 'staff')` and actor `{ kind: 'user', userId: 'user_staff_ooo' }` — optional extra; HTTP 403 is Task 6.

Test 20 in `night-audit-reports.spec.ts`: clone the existing occupancy snapshot test; add one OOO covering `d`; expect `blocked === 1`, `physical` unchanged, `inHouseCount` unchanged vs the control; occupancy keys unchanged (`businessDate`, `physical`, `sold`, `blocked`, `held`, `inHouseCount`, `confirmedCount`, `noShowCount`, `pendingCount`).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo.spec.ts test/night-audit-reports.spec.ts
```

Expected: FAIL — `trySetOooRange` is not a function / blocked stays 0.

- [x] **Step 3: Implement**

In `property-do.ts`:

1. Import `OOO_*` codes, `HORIZON_DAYS`, `enumerateStayDates` (already used). Add error classes next to `RoomOutOfOrderError`:

```ts
class OooInvalidRangeError extends Error {
  constructor() { super(OOO_INVALID_RANGE); this.name = 'OooInvalidRangeError'; }
}
class OooRangeOverlapError extends Error {
  constructor() { super(OOO_RANGE_OVERLAP); this.name = 'OooRangeOverlapError'; }
}
class OooRoomAssignedError extends Error {
  reservationId?: string;
  constructor(reservationId?: string) {
    super(OOO_ROOM_ASSIGNED);
    this.name = 'OooRoomAssignedError';
    this.reservationId = reservationId;
  }
}
```

Extend `mapReservationPreconditionError` to map those three plus keep `LedgerInconsistentError` → `{ error: LEDGER_INCONSISTENT, date }`. Map `OooRoomAssignedError` to `{ ok: false, error: OOO_ROOM_ASSIGNED, reservationId }`.

2. Private helpers (same file; do not extract into the housekeeping module):

```ts
private oooNights(startDate: string, endDate: string): string[] {
  return enumerateStayDates(startDate, endDate);
}

private setDifference(a: string[], b: string[]): string[] {
  const drop = new Set(b);
  return a.filter((d) => !drop.has(d));
}

private placeholderStatusBeforeSync(roomId: string, liveStatus: string): string {
  if (liveStatus === 'clean' || liveStatus === 'dirty' || liveStatus === 'inspected') return liveStatus;
  const covering = this.ctx.storage.sql
    .exec(
      `SELECT status_before FROM room_ooo
        WHERE room_id = ? AND start_date <= ? AND end_date > ?
        LIMIT 1`,
      roomId,
      this.readBusinessDateSync(),
      this.readBusinessDateSync(),
    )
    .toArray() as Array<{ status_before: string }>;
  return covering[0]?.status_before ?? 'clean';
}

private applyBlockedDeltaSync(roomTypeId: string, nightsToAdd: string[], nightsToRemove: string[]): {
  fromDate: string;
  toDate: string;
} | null {
  const openDate = this.readBusinessDateSync();
  if (!openDate) throw new Error(BUSINESS_DATE_UNSET);
  const horizon = enumerateFromDate(openDate, HORIZON_DAYS);
  const horizonEnd = horizon[horizon.length - 1]!;
  const touched: string[] = [];
  for (const d of nightsToAdd) {
    if (d < openDate) throw new OooInvalidRangeError();
    if (d > horizonEnd) continue;
    const row = this.ctx.storage.sql
      .exec(
        `SELECT blocked FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        d,
      )
      .toArray() as Array<{ blocked: number }>;
    if (!row[0]) throw new LedgerInconsistentError(d);
    this.ctx.storage.sql.exec(
      `UPDATE availability_day SET blocked = blocked + 1, version = version + 1
        WHERE room_type_id = ? AND stay_date = ?`,
      roomTypeId,
      d,
    );
    touched.push(d);
  }
  for (const d of nightsToRemove) {
    if (d < openDate || d > horizonEnd) continue;
    const row = this.ctx.storage.sql
      .exec(
        `SELECT blocked FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        d,
      )
      .toArray() as Array<{ blocked: number }>;
    if (!row[0] || row[0].blocked < 1) throw new LedgerInconsistentError(d);
    this.ctx.storage.sql.exec(
      `UPDATE availability_day SET blocked = blocked - 1, version = version + 1
        WHERE room_type_id = ? AND stay_date = ?`,
      roomTypeId,
      d,
    );
    touched.push(d);
  }
  if (touched.length === 0) return null;
  touched.sort();
  return { fromDate: touched[0]!, toDate: touched[touched.length - 1]! };
}

private syncOooStatusForRoomSync(roomId: string, releasedStatusBefore?: string): void {
  const openDate = this.readBusinessDateSync();
  if (!openDate) return;
  const room = this.ctx.storage.sql
    .exec(`SELECT status, room_type_id FROM room WHERE room_id = ?`, roomId)
    .toArray() as Array<{ status: string; room_type_id: string }>;
  if (!room[0]) return;
  const covering = this.ctx.storage.sql
    .exec(
      `SELECT ooo_id, status_before FROM room_ooo
        WHERE room_id = ? AND start_date <= ? AND end_date > ?
        LIMIT 1`,
      roomId,
      openDate,
      openDate,
    )
    .toArray() as Array<{ ooo_id: string; status_before: string }>;
  const desiredOoo = covering.length > 0;
  const currentlyOoo = room[0].status === 'out_of_order';
  const propertyId = this.getPropertyIdSync();
  const now = Date.now();
  if (desiredOoo && !currentlyOoo) {
    this.ctx.storage.sql.exec(
      `UPDATE room_ooo SET status_before = ?, updated_at = ? WHERE ooo_id = ?`,
      room[0].status,
      now,
      covering[0]!.ooo_id,
    );
    this.ctx.storage.sql.exec(
      `UPDATE room SET status = 'out_of_order', updated_at = ? WHERE room_id = ?`,
      now,
      roomId,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'room.status_changed',
      payload: {
        propertyId,
        roomId,
        fromStatus: room[0].status,
        toStatus: 'out_of_order',
      },
    });
  } else if (!desiredOoo && currentlyOoo) {
    // covering is empty here (its query requires end_date > openDate). On roll-out
    // the row still exists with end_date === openDate; do not fall through to 'clean'.
    let restore = releasedStatusBefore;
    if (restore == null) {
      const justEnded = this.ctx.storage.sql
        .exec(
          `SELECT status_before FROM room_ooo
            WHERE room_id = ? AND start_date <= ?
            ORDER BY end_date DESC
            LIMIT 1`,
          roomId,
          openDate,
        )
        .toArray() as Array<{ status_before: string }>;
      restore = justEnded[0]?.status_before ?? 'clean';
    }
    this.ctx.storage.sql.exec(
      `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
      restore,
      now,
      roomId,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'room.status_changed',
      payload: { propertyId, roomId, fromStatus: 'out_of_order', toStatus: restore },
    });
  }
}

private syncOooStatusAllRoomsSync(): void {
  const rows = this.ctx.storage.sql.exec(`SELECT room_id FROM room`).toArray() as Array<{ room_id: string }>;
  for (const r of rows) this.syncOooStatusForRoomSync(r.room_id);
}
```

Call `syncOooStatusForRoomSync` **after** upsert/delete. On delete, pass the doomed row’s `status_before` as `releasedStatusBefore` (the covering SELECT will miss it). On roll-out, `syncOooStatusAllRoomsSync` does not pass that arg — the just-ended query (`start_date <= openDate ORDER BY end_date DESC`) is load-bearing (test 19b).

3. `trySetOooRange` body inside `runIdempotent`, after loading room (active type else `RoomTypeNotFoundError`):

- Validate `STAY_DATE_RE` on both dates; trim `reason` (empty → null, max 256).
- Create vs edit: omit `oooId` → mint `ooo_${crypto.randomUUID()}`; present → load row (`room_id` must match) else `RoomNotFoundError`.
- **Release-delete:** edit and `input.startDate >= input.endDate` → `nightsToAdd = []`, `nightsToRemove = old nights`, DELETE row, sync, events `released`, audit `afterJson: null`. Create with `startDate >= endDate` → `OooInvalidRangeError`.
- Create: if `startDate < openDate` → `OooInvalidRangeError`.
- Overlap against **other** rows (`ooo_id != ?`): `start_date < newEnd AND end_date > newStart` → `OooRangeOverlapError`. Adjacent half-open is fine.
- `nightsToAdd = new \ old`, `nightsToRemove = old \ new`.
- Empty delta (same range): return `{ ok: true, roomId, oooId, alreadyApplied: true }` with **no** outbox, **no** second audit.
- Assignment SQL on `nightsToAdd` only (skip if empty). Use min added as `departure`/`arrival` bounds: `arrival_date < addEnd AND departure_date > addStart` with `status IN ('pending','confirmed','checked_in')`. Hit → `OooRoomAssignedError(reservation_id)`.
- `applyBlockedDeltaSync`.
- Upsert `room_ooo`. Placeholder `status_before` via `placeholderStatusBeforeSync`. Then `syncOooStatusForRoomSync` (first-cover overwrites placeholder from live cleanliness).
- If delta returned a span: `bumpAriVersionSync` once; one `availability.changed` with that `fromDate`/`toDate` and `roomTypeId`. Entirely past-horizon create: **no** `availability.changed`.
- Always emit `room.ooo_changed` `{ propertyId, roomId, roomTypeId, oooId, startDate, endDate, action, reason }` unless `alreadyApplied`.
- `appendAuditLogSync` `{ commandId: 'rooms.set_ooo_range', entityType: 'room', entityId: roomId, actor: this.auditActorSync(actor), beforeJson: old range or null, afterJson: new range or null }`.

4. `reconcileHorizon` INSERT — replace the literal `0` for `blocked` with a per-`stayDate` count:

```ts
const blockedBorn = Number(
  (
    sql
      .exec(
        `SELECT COUNT(*) AS c FROM room_ooo ooo
           JOIN room r ON r.room_id = ooo.room_id
          WHERE r.room_type_id = ?
            AND ooo.start_date <= ?
            AND ooo.end_date > ?`,
        rt.room_type_id,
        stayDate,
        stayDate,
      )
      .toArray() as Array<{ c: number }>
  )[0]?.c ?? 0,
);
sql.exec(
  `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
   VALUES (?, ?, ?, ?, 0, 0, ?, 1)`,
  rt.room_type_id,
  stayDate,
  rt.room_count,
  blockedBorn,
  ledgerOversell,
);
```

Do **not** change `tryAddRoomType` seed (`blocked = 0`). Existing rows still never overwritten.

5. `runRollStepSync` after `reconcileHorizon` returns:

```ts
this.syncOooStatusAllRoomsSync();
if (insertedCount > 0) {
  // existing ARI bump + availability.changed
}
// if insertedCount === 0, do not bump ARI even if status flipped
```

`SNAPSHOT_REPORTS` is unchanged (already sums `blocked`).

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo.spec.ts test/night-audit-reports.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

Expected: PASS. Source-scan still finds `'rooms.set_ooo_range'` (now as a live `commandId` literal).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/rooms-ooo.spec.ts \
  apps/pms-core/test/night-audit-reports.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): set OOO ranges with blocked delta and born-blocked horizon

EOF
)"
```

---

### Task 4: Stay-side gates + rewrite the two label-era tests

**Spec:** §4.1–§4.6, §6 `require_inspection` behaviour, §17 tests 4 assign-half, 25–28, 31–33.

**This task owns the rewrite** of:

- `apps/pms-core/test/reservations-check-in.spec.ts` ~190 (test 28 OOO + override)
- `apps/pms-core/test/reservations-lifecycle.spec.ts` ~723 (assign OOO)

Replace `tryUpdateRoomStatus(..., { status: 'out_of_order' })` with `trySetOooRange` covering `[arrival, departure)` (or `[open, open+1)`). Assert `ROOM_OUT_OF_ORDER` unchanged. Must land **before** Task 5.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`assertRoomAssignableSync`, `tryCheckIn`, `tryModifyReservation`, `tryCheckOut`, `setRoomStatusRawForTest`)
- Modify: `apps/pms-core/test/reservations-check-in.spec.ts`
- Modify: `apps/pms-core/test/reservations-lifecycle.spec.ts`
- Modify: `apps/pms-core/test/rooms-ooo.spec.ts` (tests 4 assign-half, 26–28, 31–33, 27)

**Interfaces:**
- Produces: range overlap in `assertRoomAssignableSync`; modify re-check when `room_id` set and dates **or** type change; check-in stay ∩ range; check-out skip dirty if OOO; `require_inspection` gate
- Consumes: `trySetOooRange` (Task 3), config key (Task 1)

- [x] **Step 1: Write the failing tests**

Rewrite check-in test 28:

```ts
expect(
  await stub.trySetOooRange(
    TEST_OWNER_ACTOR,
    { roomId: 'rm_28', startDate: arrival, endDate: departure },
    await idemFor('ooo28', { roomId: 'rm_28', startDate: arrival, endDate: departure }),
  ),
).toMatchObject({ ok: true });
```

Rewrite lifecycle assign-OOO the same way (`roomId: 'rm_1'`, `[arrival, departure)`).

Add to `rooms-ooo.spec.ts`:

4 assign-half: after the Task 3 future-only range, assign a stay overlapping `[open+5, open+8)` → `ROOM_OUT_OF_ORDER`; assign a stay that **ends** on `startDate` (half-open adjacent) → ok.

26. Stay overlaps a future range, current status `clean` → check-in `ROOM_OUT_OF_ORDER`; assign `ROOM_OUT_OF_ORDER`.

27. `putDomainConfig` / existing config RPC to set `pms.housekeeping.require_inspection` true (copy the config-put helper from a sibling spec). Strict + `clean` → `ROOM_NOT_READY`; `inspected` → allow. Default (unset/false): `clean` still allows.

28. Check-out of a cleanliness room → `dirty` + `room.status_changed`. Check-out skip when OOO: after check-in, call `setRoomStatusRawForTest({ roomId, status: 'out_of_order' })`, then check-out → room stays `out_of_order`, no `room.status_changed` from the dirty flip. Comment in the test: product-unreachable under invariant 4; hook-only.

31. Assigned stay `[open+1, open+3)`; future OOO `[open+4, open+6)`; modify extends departure to `open+5` → `ROOM_OUT_OF_ORDER`; `readAvailabilityDay.sold` unchanged; dates unchanged.

32. Same fixtures; modify with unchanged dates and type → success (cheap short-circuit).

33. Two confirmed stays on the same room, adjacent half-open; modify extends the earlier into the later → `ROOM_ALREADY_ASSIGNED`; sold unchanged.

Keep existing dirty+override check-in assertions (test 25 lifecycle regression) — they already live in `reservations-check-in.spec.ts`.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/rooms-ooo.spec.ts \
  test/reservations-check-in.spec.ts \
  test/reservations-lifecycle.spec.ts
```

Expected: FAIL — assign/check-in still allow a clean room with a future OOO; modify does not SELECT `room_id`; label-era tests fail if you already swapped the call without the range existing… after the rewrite, check-in 28 should still pass via **status** defense until Task 5, but assign-OOO already fails today on `room.status`. The **new** failures are tests 4/26/31/33. Rewrite the two call sites in the same commit as the gate so they never go red-then-green on cleanliness-only.

- [x] **Step 3: Implement gates**

`assertRoomAssignableSync` — after the existing overlap check, before `return room`:

```ts
const oooHit = this.ctx.storage.sql
  .exec(
    `SELECT ooo_id FROM room_ooo
      WHERE room_id = ?
        AND start_date < ?
        AND end_date > ?
      LIMIT 1`,
    roomId,
    reservation.departureDate,
    reservation.arrivalDate,
  )
  .toArray();
if (oooHit.length > 0) throw new RoomOutOfOrderError();
```

Keep `room.status === 'out_of_order'` as defense-in-depth (already above).

`tryCheckIn` — after resolving `resolvedRoomId` and the existing status === OOO check, add the same stay ∩ `room_ooo` SQL against `reservation.arrival_date` / `departure_date`. Also apply `require_inspection`:

```ts
const requireInspection =
  this.readConfigValueSync('pms.housekeeping.require_inspection') === true;
if (
  requireInspection &&
  cleanliness === 'strict' &&
  room.status === 'clean' &&
  !(input.overrideCleanliness === true && allowDirtyOverride)
) {
  throw new RoomNotReadyError();
}
```

Treat `clean` like `dirty` only when that config is on **and** cleanliness is `strict`. `inspected` still allows. `off` still allows `clean`.

`tryModifyReservation` — add `room_id` to the SELECT list (~5767). After the unchanged-dates-and-type short-circuit (~5789) and the active-type check, **before** any `sold` writes:

```ts
if (reservation.room_id) {
  this.assertRoomAssignableSync(reservation.room_id, {
    reservationId: input.reservationId,
    roomTypeId: input.roomTypeId,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
  });
}
```

Widen the Promise union with `ROOM_OUT_OF_ORDER` | `ROOM_ALREADY_ASSIGNED` | `ROOM_TYPE_MISMATCH` (already mapped to 422 by `mapReservationCommandErrorStatus`). Unchanged dates **and** type still return before this check. Type change with `room_id` set **does** re-check (locked).

`tryCheckOut` dirty block (~6260):

```ts
if (reservation.room_id) {
  const roomRows = this.ctx.storage.sql
    .exec(`SELECT status FROM room WHERE room_id = ?`, reservation.room_id)
    .toArray() as Array<{ status: string }>;
  const fromStatus = roomRows[0]?.status ?? 'clean';
  if (fromStatus !== 'out_of_order') {
    this.ctx.storage.sql.exec(
      `UPDATE room SET status = 'dirty', updated_at = ? WHERE room_id = ?`,
      now,
      reservation.room_id,
    );
    // existing room.status_changed outbox
  }
}
```

Add next to other unsafe-local helpers:

```ts
async setRoomStatusRawForTest(input: { roomId: string; status: string }): Promise<void> {
  this.assertUnsafeLocal('setRoomStatusRawForTest');
  this.ctx.storage.sql.exec(
    `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
    input.status,
    Date.now(),
    input.roomId,
  );
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/rooms-ooo.spec.ts \
  test/reservations-check-in.spec.ts \
  test/reservations-lifecycle.spec.ts \
  test/reservations-check-out.spec.ts
```

Expected: PASS. The two rewritten tests no longer call `tryUpdateRoomStatus` with `out_of_order` (`rg` the string in those two files → only historical comments if any).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/rooms-ooo.spec.ts \
  apps/pms-core/test/reservations-check-in.spec.ts \
  apps/pms-core/test/reservations-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): gate assign, check-in, modify, and check-out against OOO ranges

EOF
)"
```

---

### Task 5: HK cleanliness-only split + DO binder audit

**Spec:** §3.6, §7, §17 tests 22–24, 29–30.

**Files:**
- Modify: `modules/pms/housekeeping/src/domain/room-status.ts`
- Modify: `modules/pms/housekeeping/src/domain/room-status.test.ts`
- Modify: `modules/pms/housekeeping/src/domain/errors.ts`
- Modify: `modules/pms/housekeeping/src/index.ts`
- Modify: `modules/pms/housekeeping/src/application/update-room-status.ts`
- Modify: `modules/pms/housekeeping/src/application/update-room-status.test.ts`
- Modify: `modules/pms/housekeeping/src/application/bulk-update-room-status.ts`
- Modify: `modules/pms/housekeeping/src/application/bulk-update-room-status.test.ts`
- Modify: `apps/pms-core/src/property-do.ts` (`tryUpdateRoomStatus`, `tryBulkUpdateRoomStatus`, `tryAssignHousekeeping`)
- Modify: `apps/pms-core/test/rooms-ooo.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts` (test 29 queued `out_of_order` if a status-queue test lives there; otherwise add in `rooms-ooo.spec.ts`)

**Interfaces:**
- Produces: `CLEANLINESS_STATUSES` / `isCleanlinessStatus`; payload `out_of_order` → `OOO_VIA_RANGE`; current status OOO → `ROOM_OUT_OF_ORDER`; binder `appendAuditLogSync` for status/assign
- Consumes: Task 4 rewrite (label-era tests already off `tryUpdateRoomStatus`)
- Forbidden: HTTP OOO route; SPA dropdown (Task 7)

- [x] **Step 1: Write the failing tests**

`room-status.test.ts`:

```ts
it('isCleanlinessStatus accepts clean/dirty/inspected and rejects out_of_order', () => {
  for (const s of ['clean', 'dirty', 'inspected']) expect(isCleanlinessStatus(s)).toBe(true);
  expect(isCleanlinessStatus('out_of_order')).toBe(false);
  expect(isRoomStatus('out_of_order')).toBe(true);
});
```

`update-room-status.test.ts`: current status `out_of_order` + payload `clean` → throws `HousekeepingRoomOutOfOrderError`; no UPDATE.

`bulk-update-room-status.test.ts`: one of two updates `out_of_order` current → throw; neither row changed (MemorySql).

`rooms-ooo.spec.ts`:

22. `tryUpdateRoomStatus({ status: 'out_of_order' })` → `OOO_VIA_RANGE`; blocked unchanged; status unchanged. (HTTP 422 waits for Task 6 if you also hit the route; DO-level is enough here.)

23. Bulk including one `out_of_order` payload → fail all-or-nothing; no row changed.

24. After `trySetOooRange` covering today, `tryUpdateRoomStatus({ status: 'clean' })` → `ROOM_OUT_OF_ORDER`.

29. Queue `rooms.update_status` with `out_of_order` via the existing degraded/provisional helper (copy `degraded-mode.spec.ts` enqueue + drain). Drain → `provisional_exception` reason `OOO_VIA_RANGE`.

30. Dirty→clean writes `audit_log` with `commandId: 'rooms.update_status'` and `{ status }` from/to; `AUDIT_WRITER_COMMAND_IDS.has('rooms.update_status')` is **false** (assert in register.test or here).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-housekeeping exec vitest run
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo.spec.ts
```

Expected: FAIL.

- [x] **Step 3: Implement**

`room-status.ts`:

```ts
export const CLEANLINESS_STATUSES = new Set(['clean', 'dirty', 'inspected']);
export const ROOM_STATUSES = new Set([...CLEANLINESS_STATUSES, 'out_of_order']);
export function isCleanlinessStatus(value: string): boolean {
  return CLEANLINESS_STATUSES.has(value);
}
export function isRoomStatus(value: string): boolean {
  return ROOM_STATUSES.has(value);
}
```

`errors.ts`:

```ts
export class HousekeepingRoomOutOfOrderError extends Error {
  constructor() {
    super('room_out_of_order');
    this.name = 'HousekeepingRoomOutOfOrderError';
  }
}
export class HousekeepingOooViaRangeError extends Error {
  constructor() {
    super('ooo_via_range');
    this.name = 'HousekeepingOooViaRangeError';
  }
}
```

Re-export both from `index.ts`.

`updateRoomStatus`: if `!isCleanlinessStatus(input.status)` throw `HousekeepingOooViaRangeError` (DO preamble should catch this first; belt). If `rows[0].status === 'out_of_order'` throw `HousekeepingRoomOutOfOrderError`. Do not UPDATE.

`bulkUpdateRoomStatus`: same checks per item **before** any UPDATE (validate all, then write) so one `out_of_order` payload / current OOO fails the whole batch.

`tryUpdateRoomStatus` preamble:

```ts
if (!isRoomStatus(input.status)) return { ok: false, error: 'invalid_status' };
if (!isCleanlinessStatus(input.status)) return { ok: false, error: OOO_VIA_RANGE };
```

Inside `runIdempotent`, after `updateRoomStatus` returns, `appendAuditLogSync` with `commandId: 'rooms.update_status'`, `entityType: 'room'`, `entityId: input.roomId`, `beforeJson: { status: fromStatus }`, `afterJson: { status: input.status }`. SELECT status before the module call for `fromStatus`. Catch `HousekeepingRoomOutOfOrderError` → `ROOM_OUT_OF_ORDER`; `HousekeepingOooViaRangeError` → `OOO_VIA_RANGE`.

`tryBulkUpdateRoomStatus`: reject if any payload fails `isCleanlinessStatus` **before** the txn (`OOO_VIA_RANGE`). Inside the txn, audit one row per room with `commandId: 'rooms.bulk_update_status'`.

`tryAssignHousekeeping`: after `assignHousekeeping` succeeds, `appendAuditLogSync` `{ commandId: 'housekeeping.assign', entityType: 'room', entityId: input.roomId, afterJson: { roomId, businessDate, assigneeRef } }`. Names never on PropertyDO.

Widen `tryUpdateRoomStatus` / bulk return unions with `typeof OOO_VIA_RANGE` and `typeof ROOM_OUT_OF_ORDER`.

Queued replay: no `REPLAY_DISPATCH` change. Drain hits the same preamble → exception `OOO_VIA_RANGE`.

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/pms-housekeeping exec vitest run
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo.spec.ts test/degraded-mode.spec.ts test/rooms.spec.ts
```

Expected: PASS. `AUDIT_WRITER_COMMAND_IDS.size` still 45 (status/assign not added).

- [x] **Step 5: Commit**

```bash
git add modules/pms/housekeeping \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/rooms-ooo.spec.ts \
  apps/pms-core/test/degraded-mode.spec.ts
git commit -m "$(cat <<'EOF'
feat(hk): restrict status writes to cleanliness and audit from the DO binder

EOF
)"
```

---

### Task 6: HTTP route [104] + `listRooms` `oooRanges`

**Spec:** §8, §12, §15, §17 tests 8 HTTP, 9–11, 40 (`[104]`), GET additive field.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/src/property-do.ts` (`listRooms` only)
- Modify: `packages/client-core/src/api.ts`
- Create: `apps/pms-core/test/rooms-ooo-routes.spec.ts`

**Interfaces:**
- Produces: `V1_HTTP_ROUTE_AUDIT[104] = post_room_ooo_range`; `POST /v1/properties/:pid/rooms/:roomId/ooo`; GET rooms passthrough of `oooRanges`; client `setOooRange`
- Consumes: `trySetOooRange` (Task 3)
- Forbidden: SPA (Task 7)

- [x] **Step 1: Write the failing tests**

`register.test.ts`:

```ts
expect(V1_HTTP_ROUTE_AUDIT[103]?.id).toBe('post_folio_capture_due');
expect(V1_HTTP_ROUTE_AUDIT[104]?.id).toBe('post_room_ooo_range');
expect(V1_HTTP_ROUTE_AUDIT[104]).toMatchObject({
  permission: 'inventory:write',
  commandId: 'rooms.set_ooo_range',
  entitlement: 'pms.core',
});
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(45);
```

`rooms-ooo-routes.spec.ts` — copy `provisionHotel` / `postRoom` / `setKillSwitch` from `rooms-routes.spec.ts`. Cases:

- POST create → 200/201 with `oooId`; GET `/rooms` includes `oooRanges: [{ oooId, startDate, endDate, reason }]`.
- Unknown room → 404.
- Staff member (`ensureMember(..., 'staff')`, `x-dev-actor` staff) → 403 `inventory:write`.
- `setTransportBlockedForTest(true)` on the property stub (via a helper the rooms-routes/degraded tests already use) → POST 503, empty or classified fail-closed body, no `room_ooo` row after unblock.
- `setKillSwitch(env, 'pms.core', true)` → 503 empty body (copy rooms-routes 18/19).
- Body `roomId` conflicting with path → 400 `invalid_body`.
- `OOO_INVALID_RANGE` / `OOO_RANGE_OVERLAP` / `OOO_ROOM_ASSIGNED` → 422 `{ error, reservationId? }`.
- `LEDGER_INCONSISTENT` maps 409 (reuse `mapReservationCommandErrorStatus` — add the four `OOO_*` codes to the 422 list).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo-routes.spec.ts
```

Expected: FAIL — `[104]` undefined / 404 on POST.

- [x] **Step 3: Implement**

`v1-http-routes.ts` append:

```ts
{
  id: 'post_room_ooo_range',
  scope: 'property',
  permission: 'inventory:write',
  commandId: 'rooms.set_ooo_range',
  entitlement: 'pms.core',
},
```

`v1-dispatch.ts` — append after the room status routes in `V1_ROUTES`:

```ts
{
  scope: 'property',
  method: 'POST',
  pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/ooo$/,
  permission: 'inventory:write',
  commandId: 'rooms.set_ooo_range',
  handler: handlePostRoomOooRange,
},
```

Handler: copy `handlePostRooms` FAIL_CLOSED `invokePropertyDo` with `commandId: 'rooms.set_ooo_range'`, `routeId: 'post_room_ooo_range'`. Path `roomId`; body `{ startDate, endDate, oooId?, reason?, idempotencyKey }`. If body.roomId is present and ≠ path → 400. Fingerprint `{ roomId, startDate, endDate, oooId? }`. Map `FORBIDDEN` → 403 `{ error: 'forbidden', permission: 'inventory:write' }`. Map `OOO_*` via `mapReservationCommandErrorStatus` (add the four codes next to `ROOM_OUT_OF_ORDER` in that function — they fall through to 422 today if you add them to the long 422 list explicitly). Include `reservationId` on `OOO_ROOM_ASSIGNED`.

`listRooms`: after fetching rooms, load all `room_ooo` rows for those ids (one `WHERE room_id IN (...)` or per-room — tens of rooms). Attach:

```ts
oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>
```

`status` filter still means current `room.status`, not “has a future range”.

`packages/client-core/src/api.ts`: widen `listRooms` return type with `oooRanges`. Add:

```ts
async setOooRange(
  propertyId: string,
  roomId: string,
  input: {
    startDate: string;
    endDate: string;
    oooId?: string;
    reason?: string;
    idempotencyKey: string;
  },
): Promise<{ ok: true; roomId: string; oooId: string; alreadyApplied?: true }>
```

POST `/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}/ooo`.

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo-routes.spec.ts test/rooms-routes.spec.ts
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
```

Expected: all exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/rooms-ooo-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add POST room OOO range [104] and listRooms oooRanges

EOF
)"
```

---

### Task 7: SPA board

**Spec:** §5, §17 tests 34–39.

**Files:**
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx`
- Modify: `apps/web-pms/src/screens/HousekeepingScreen.tsx`

**Interfaces:**
- Consumes: client `setOooRange` + `oooRanges` (Task 6); `hasPropertyPermission`
- Produces: cleanliness-only dropdown; roster-error isolation; client-side filters; workload; OOO form gated on `canSetOoo`

- [x] **Step 1: Write the failing tests**

Extend `HousekeepingApp.test.tsx`. Widen `renderApp` to accept `{ canAssign, canReadRoster, canSetOoo, defaultBusinessDate }`.

34. Staff-shaped: `canAssign=true`, `canReadRoster=true`, `canSetOoo=false`. Status `<select>` options are `clean/dirty/inspected` only (no `out_of_order`). No OOO form (`queryByTestId('hk-ooo-form')` null). Picker visible when roster has Ada.

35. Owner-shaped: `canSetOoo=true`. Form present. Submit start/return → `api.setOooRange` called. Range text from `oooRanges` renders.

36. **Rewrite** the existing `listRoster failure shows the board error alert` test: rooms table still renders (`getByTestId('hk-board')`); picker hidden; alert text matches `/Unable to load housekeepers/` and does **not** match `/Unable to load housekeeping board/`. Status dropdowns still in the document.

37. Two rooms (dirty 101, clean 102). Filter status=`dirty` hides 102. Assigned/unassigned filter uses `defaultBusinessDate` assignments.

38. Two rooms assigned to Ada, one unassigned → workload shows Ada count 2 and unassigned 1. No extra HTTP (spy `listRooms` / `listHousekeepingAssignments` / `listRoster` only).

39. Existing tests 20 / 31 / 28 stay green; `queryByRole('textbox')` still null.

`HousekeepingApi` gains optional `setOooRange`. `HousekeepingRoom` gains optional `oooRanges` and `floor`.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-housekeeping exec vitest run src/ui/HousekeepingApp.test.tsx
```

Expected: FAIL.

- [x] **Step 3: Implement**

`STATUSES = ['clean', 'dirty', 'inspected'] as const`. If `room.status === 'out_of_order'`, render text `out_of_order` (not a dropdown option), still no `out_of_order` `<option>`.

Props: `canReadRoster?: boolean` (default `canAssign` for back-compat in unit tests that omit it), `canSetOoo?: boolean` (default false).

Picker: `canAssign && canReadRoster && assignable.length > 0`.

Queries: `roomsQuery` / `assignmentsQuery` errors → existing board alert. `rosterQuery.isError` → separate alert `Unable to load housekeepers` and hide picker. Do **not** include `rosterQuery.isError` in the board-alert condition.

Filters (useState): status (incl. OOO), floor, assigned/unassigned. Filter the already-fetched `rooms` + `assignments` in memory.

Workload: `GROUP BY assigneeRef` in memory from assignments for `businessDate`. Render `{displayName || staffId}: {count}` plus `Unassigned: {rooms.length - assignedRoomIdSet.size}`.

OOO form (`data-testid="hk-ooo-form"`) when `canSetOoo`: start date, return date, optional reason, submit → `api.setOooRange`. Early-release: `window.confirm` then POST `{ oooId, startDate: existing.startDate, endDate: defaultReturn }` where `defaultReturn = openDate > existing.startDate ? openDate : addOneDay(existing.startDate)`. Display `oooRanges` as read-only text.

`HousekeepingScreen.tsx`:

```ts
const canAssign = Boolean(me && hasPropertyPermission(me, 'housekeeping:write'));
const canReadRoster = Boolean(me && hasPropertyPermission(me, 'roster:read'));
const canSetOoo = Boolean(me && hasPropertyPermission(me, 'inventory:write'));
```

Pass all three. `api` already has `listRooms` / `listRoster` / `assignHousekeeping`; after Task 6 it has `setOooRange`.

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/pms-housekeeping exec vitest run src/ui/HousekeepingApp.test.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/HousekeepingScreen.test.tsx src/auth/me.test.ts
```

(If `HousekeepingScreen.test.tsx` does not exist, do not create it unless a current test imports the screen and fails.)

- [x] **Step 5: Commit**

```bash
git add modules/pms/housekeeping/src/ui/HousekeepingApp.tsx \
  modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx \
  apps/web-pms/src/screens/HousekeepingScreen.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): housekeeping board filters, workload, and inventory OOO form

EOF
)"
```

---

### Task 8: Doc-debt amends (sibling specs)

**Spec:** §9 pointers / file map “Specs”; §17 none (docs only).

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md`
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md`
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md`
- Modify: `docs/superpowers/specs/2026-08-11-housekeeping-module-mechanism-design.md`

One sentence each, bidirectional to `2026-08-12-room-operations-hk-completion-design.md`. Do not rewrite those specs.

- [x] **Step 1: Amend**

Rooms-vertical (`§2.1` / leftover OOO→blocked, around the `PLATFORM_GAPS` bullets):

> Superseded: `out_of_order` is no longer a housekeeping label — `rooms.set_ooo_range` writes `room_ooo` and increments `blocked`; see [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md).

Lifecycle (modify / §4.2 cleanliness table):

> Amended: assign/check-in refuse stay ∩ `room_ooo` (not only `room.status === 'out_of_order'`); `tryModifyReservation` re-runs assignability when `room_id` is set and dates or type change; see [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) §4.

Folio (`PLATFORM_GAPS` line ~33):

> `PLATFORM_GAPS` no longer lists `rooms.set_ooo_range` (closed by [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md)).

Housekeeping-module §4.2 / leftover assign affordance:

> Board completion (dropdown trim, roster-error isolation, filters, workload, inventory-gated OOO form) landed in [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) §5; the picker itself remains the roster chunk.

The room-ops spec already points at these four; no change required there unless a cite is stale.

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md \
  docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-11-housekeeping-module-mechanism-design.md
git commit -m "$(cat <<'EOF'
docs: point sibling specs at room operations and HK completion

EOF
)"
```

---

### Task 9: Full CI locally

**Spec:** §17 tests 42, §20 last bullet, §21.

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

Mark Tasks 1–9 steps `- [x]` in this file. Same PR as the last implementation commit, or a docs commit in that PR. **Not** before merge.

- [x] **Step 4: Commit only if Step 3 left docs dirty**

```bash
git add docs/superpowers/plans/2026-08-12-room-operations-hk-completion.md
git commit -m "$(cat <<'EOF'
docs: tick room operations HK completion plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip the commit.

---

## Spec coverage (self-review)

| Spec §17 / requirement | Task |
|---|---|
| Catalog promote, size 45, `PLATFORM_GAPS` `[]`, events allowlist, `require_inspection` key, no HTTP | 1 |
| v22 `room_ooo` + backfill + CHECK/FK + head 22 | 2 |
| Delta + `trySetOooRange` + born-blocked INSERT + roll status sync; tests 1–3, 5–8, 12–19, **19b** (roll-out restores `status_before`), 21; 4 create-half; 15–17; 20 snapshot | 3 |
| `assertRoomAssignableSync` range; check-in ∩ range; modify §4.6; check-out skip; `require_inspection` behaviour; tests 4 assign-half, 25–28, 31–33; **rewrite check-in ~190 and lifecycle ~723** | 4 |
| `CLEANLINESS_STATUSES`; DO binder audit; tests 22–24, 29–30 | 5 |
| Route [104] + handler + `listRooms` `oooRanges`; tests 8–11 HTTP, 40 pin | 6 |
| SPA 34–39 | 7 |
| Bidirectional pointers (rooms-vertical, lifecycle, folio PLATFORM_GAPS line, housekeeping-module) | 8 |
| Full CI 42 | 9 |
| DND / OOS / auto-merge / `OOO_WOULD_OVERSELL` / maintenance tickets / WS tape chart | not implemented (leftovers 1–12) |

| Spec section | Task |
|---|---|
| §3.1–3.2 command | 1, 3 |
| §3.3 schema / §3.10 backfill | 2 |
| §3.4 delta / §3.5 born-blocked / §3.7–3.8 sync + events / §9.1 roll-out restores `status_before` (test 19b) | 3 |
| §3.6 cleanliness-only | 5 |
| §3.9 event only (no ticket table) | 3 (emit `room.ooo_changed` only) |
| §4 gates + modify hole | 4 |
| §5 HK board | 7 |
| §6 `require_inspection` | 1 (key), 4 (behaviour) |
| §7 audit depth | 1 (OOO in set), 5 (binder) |
| §8 `oooRanges` | 6 |
| §10–12 codes / catalog / route [104] | 1 then 6 |
| §13 config | 1, 4 |
| §14 occupancy / 7 steps | 3 |
| §15 degraded | 1, 6 |
