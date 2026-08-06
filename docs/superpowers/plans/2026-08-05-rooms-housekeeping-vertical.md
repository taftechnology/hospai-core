# Rooms & Housekeeping Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship physical `room` units, `reservation.room_id` assignment, room-status / housekeeping commands, and their HTTP + degraded-replay surfaces — without touching the availability ledger or `tryCheckIn`.

**Architecture:** Additive PropertyDO schema (v11: `room`, `reservation.room_id`, `housekeeping_assignment`). Assignment/housekeeping layer on top of `room_count`-authoritative `availability_day`. `reservations.assign_room` / `rooms.create` / `rooms.update` are `FAIL_CLOSED`; status + housekeeping assign stay `QUEUE_PROVISIONAL` with `REPLAY_DISPATCH` entries. Check-in stays unchanged (option B).

**Tech Stack:** Cloudflare Durable Objects SQLite, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, pnpm workspaces, existing `invokePropertyDo` / `REPLAY_DISPATCH` / `LaneGuard` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md`](../specs/2026-08-05-rooms-housekeeping-vertical-design.md) (v2, settled)

## Global Constraints

- Never touch `availability_day` / `ariVersion` / `availability.changed` from room create/update/status/assign/housekeeping paths.
- Keep `room_count` authoritative for `physical`; OOO→`blocked` stays in `PLATFORM_GAPS`.
- Do **not** modify `tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn`.
- `LaneGuard`: call `touchInteractive()` only — no `touchBulk`.
- Fingerprint allowlists: mirror `tryUpdateRoomType` style (`{ roomId, code?, floor? }` for `rooms.update`) — document in the method JSDoc.
- Eight new route rows: `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` must append in **identical order** in the same commit (`check:permissions` is element-wise by index).
- Spec + plan may ride in the final implementation commit (folio precedent); do not leave the spec untracked across a partial ship.
- Stay nights for assignment overlap are half-open `[arrival, departure)` — overlap query uses strict `<` / `>`.
- TDD: write the adversarial tests (9/10/11, 6) before or with the implementation that makes them pass; they must fail under the mutations listed in the handoff notes below.

### Reviewer mutation targets (construct tests so these fail)

| Mutation | Must be caught by |
|---|---|
| Restore `availability.changed` on `rooms.update_status` (catalog and/or emit) | Test 6 + contracts register assertion on catalog events |
| Weaken overlap to `arrival_date <= ? AND departure_date >= ?` | Test **11** (adjacent stays) — not only test 10 |
| Remove `ROOM_TYPE_MISMATCH` guard | Test 9 |

**Adversarial date fixtures (lock these exact dates in tests):**

```
// Half-open [arrival, departure). Touching at noon checkout/check-in must NOT conflict.
const A = { arrival: '2026-08-10', departure: '2026-08-12' }; // nights 10, 11
const B_adjacent = { arrival: '2026-08-12', departure: '2026-08-14' }; // nights 12, 13 — test 11
const B_overlap = { arrival: '2026-08-11', departure: '2026-08-13' }; // nights 11, 12 — test 10
```

Under correct SQL (`arrival_date < candDeparture AND departure_date > candArrival`):
- A vs `B_adjacent`: `12 > 12` is false → no conflict.
- A vs `B_overlap`: `12 > 11` is true and `10 < 13` → conflict.

Under broken `<=`/`>=`: A vs `B_adjacent` falsely conflicts → test 11 fails.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | Six room wire codes |
| `packages/contracts/src/idempotency.test.ts` | Constant string locks |
| `packages/contracts/src/commands/catalog.ts` | Reclassify assign; create/update; drop `availability.changed`; notes |
| `packages/contracts/src/register.test.ts` | Catalog event / degraded / entitlement assertions |
| `packages/contracts/src/v1-http-routes.ts` | Eight audit rows (indices 25–32) |
| `packages/do-runtime/src/property-migrations.ts` | v11 statements + SQL export |
| `packages/do-runtime/src/index.ts` | Re-export v11 SQL |
| `packages/do-runtime/src/migrate.test.ts` | Head → 11; DDL sync test |
| `scripts/property-ddl.mjs` | Wire `0011_*.sql` target |
| `migrations/do-property/0011_*.sql` | Generated |
| `apps/pms-core/src/property-do.ts` | All `try*` / read RPCs + `tryUpdateRoomType` gate |
| `apps/pms-core/src/v1-dispatch.ts` | Eight handlers + `V1_ROUTES` + error map |
| `apps/pms-core/src/pending-commands-consumer.ts` | Three `REPLAY_DISPATCH` entries |
| `apps/pms-core/test/rooms-routes.spec.ts` | HTTP matrix |
| `apps/pms-core/test/rooms.spec.ts` | DO-level assign/overlap/check-in-B locks (or fold into rooms-routes if preferred — prefer separate DO file for 9/10/11/27–29) |
| `apps/pms-core/test/degraded-mode.spec.ts` | Cases 22–26 |
| `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md` | Include in final commit |

---

### Task 1: Contracts — wire codes + catalog

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `ROOM_CODE_EXISTS`, `ROOM_COUNT_EXCEEDED`, `ROOM_UNITS_EXCEED_COUNT`, `ROOM_TYPE_MISMATCH`, `ROOM_ALREADY_ASSIGNED`, `ROOM_NOT_ASSIGNABLE` (all `as const` strings matching their snake_case values)
- Produces: catalog entries `rooms.create`, `rooms.update`; `reservations.assign_room` with `degraded: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`; `rooms.update_status.events === ['room.status_changed']`

- [ ] **Step 1: Add wire codes + failing register tests (RED)**

In `idempotency.ts` (near other inventory/reservation codes):

```ts
export const ROOM_CODE_EXISTS = 'room_code_exists' as const;
export const ROOM_COUNT_EXCEEDED = 'room_count_exceeded' as const;
export const ROOM_UNITS_EXCEED_COUNT = 'room_units_exceed_count' as const;
export const ROOM_TYPE_MISMATCH = 'room_type_mismatch' as const;
export const ROOM_ALREADY_ASSIGNED = 'room_already_assigned' as const;
export const ROOM_NOT_ASSIGNABLE = 'room_not_assignable' as const;
```

In `register.test.ts` add (names can vary):

```ts
it('rooms.update_status does not claim availability.changed', () => {
  const c = COMMAND_CATALOG.find((x) => x.id === 'rooms.update_status');
  expect(c?.events).toEqual(['room.status_changed']);
});

it('reservations.assign_room is FAIL_CLOSED with pms.core', () => {
  const c = COMMAND_CATALOG.find((x) => x.id === 'reservations.assign_room');
  expect(c?.degraded).toBe('FAIL_CLOSED');
  expect(c?.entitlement).toBe('pms.core');
});

it('rooms.create and rooms.update are FAIL_CLOSED net-new surface', () => {
  for (const id of ['rooms.create', 'rooms.update'] as const) {
    const c = COMMAND_CATALOG.find((x) => x.id === id);
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('inventory:write');
    expect(c?.prototypeAction).toBeNull();
    expect(c?.notes).toMatch(/net-new surface/i);
  }
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @hospai/contracts test
```

Expected: new register tests fail (entries missing / events still include `availability.changed`).

- [ ] **Step 3: Catalog + constants (GREEN)**

Apply spec §2.1–2.3a / §2.8 catalog edits:

1. `reservations.assign_room`: `degraded: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`.
2. `rooms.update_status`: `events: ['room.status_changed']` only.
3. Insert `rooms.create` and `rooms.update` (after the rooms status entries is fine) with the `notes` strings from the spec.
4. `housekeeping.assign`: add `notes` that client `businessDate` is deliberately unbounded vs open business date.

Wire-code assertions in `idempotency.test.ts` (string equality locks).

- [ ] **Step 4: GREEN + commit**

```bash
pnpm --filter @hospai/contracts test
pnpm check:entitlements
```

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): rooms catalog + wire codes for housekeeping vertical

Reclassify assign_room to FAIL_CLOSED, drop availability.changed from
room status, and add rooms.create/update plus room error codes.
EOF
)"
```

---

### Task 2: Migration v11 — `room`, `reservation.room_id`, `housekeeping_assignment`

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Generate: `migrations/do-property/0011_room_and_housekeeping.sql` (exact name from generator)

**Interfaces:**
- Produces: `ROOM_AND_HOUSEKEEPING_V11_STATEMENTS`, `ROOM_AND_HOUSEKEEPING_V11_SQL`
- Produces: `PROPERTY_MIGRATIONS` version 11; `PROPERTY_SCHEMA_HEAD === 11`

- [ ] **Step 1: Failing migrate head test (RED)**

Change `migrate.test.ts` expectation from `10` → `11` (and length/array). Run:

```bash
pnpm --filter @hospai/do-runtime test
```

Expected: FAIL (head still 10).

- [ ] **Step 2: Statements — order is load-bearing**

In `property-migrations.ts`, append (comment required):

```ts
/**
 * v11 — physical room units + reservation.room_id + housekeeping_assignment.
 * ORDER: CREATE room BEFORE reservation rebuild — outbound FK room_id → room.
 */
export const ROOM_AND_HOUSEKEEPING_V11_STATEMENTS: string[] = [
  `CREATE TABLE room (
  room_id       TEXT PRIMARY KEY,
  room_type_id  TEXT NOT NULL,
  code          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'clean'
                CHECK (status IN ('clean', 'dirty', 'inspected', 'out_of_order')),
  floor         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_type_id) REFERENCES room_type(room_type_id)
)`,
  `CREATE UNIQUE INDEX room_code_uidx ON room(code)`,
  `CREATE INDEX room_type_idx ON room(room_type_id)`,
  `CREATE INDEX room_status_idx ON room(status)`,
  // reservation rebuild — copy all v8 columns + room_id NULL
  `CREATE TABLE reservation_v11 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  guest_ref        TEXT NOT NULL,
  pii_key_id       TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  room_id          TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `INSERT INTO reservation_v11 (
     reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, NULL, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v11 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
  `CREATE INDEX reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL`,
  `CREATE TABLE housekeeping_assignment (
  assignment_id  TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  assignee_ref   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  UNIQUE (room_id, business_date)
)`,
];

export const ROOM_AND_HOUSEKEEPING_V11_SQL =
  ROOM_AND_HOUSEKEEPING_V11_STATEMENTS.join(';\n\n') + ';\n';
```

Append `{ version: 11, name: 'room_and_housekeeping', statements: ROOM_AND_HOUSEKEEPING_V11_STATEMENTS }` to `PROPERTY_MIGRATIONS`.

Export from `index.ts`. Wire `scripts/property-ddl.mjs` import + `doPropertyTargets` entry for `0011_*.sql`. Add migrate.test DDL body sync like prior versions.

- [ ] **Step 3: Generate + verify**

```bash
pnpm generate:ddl
pnpm check:ddl
pnpm --filter @hospai/do-runtime test
```

Expected: PASS; new SQL file present; head 11.

- [ ] **Step 4: Commit**

```bash
git add packages/do-runtime scripts/property-ddl.mjs migrations/do-property/0011_*.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v11 room + reservation.room_id + housekeeping_assignment

Create room before reservation rebuild so the outbound FK is valid.
EOF
)"
```

---

### Task 3: PropertyDO — create / update room + count gates + listRooms

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/rooms.spec.ts` (DO-level cases for create/update/count/list; assign tests land in Task 5)

**Interfaces:**
- `tryCreateRoom(actor, { roomId, roomTypeId, code, floor? }, idem)` → `{ ok: true, roomId } | { ok: false; error: ... }`
- `tryUpdateRoom(actor, { roomId, code?, floor? }, idem)` — **Fingerprint allowlist: `{ roomId, code?, floor? }`** (mirror `tryUpdateRoomType` at property-do.ts:1631)
- `listRooms({ roomTypeId?, status? })` → `{ ok: true, rooms: [...] }`
- `tryUpdateRoomType` gains `ROOM_UNITS_EXCEED_COUNT` when lowering `roomCount` below `COUNT(room)`

- [ ] **Step 1: RED — create/update/count tests in `rooms.spec.ts`**

Cover at minimum: create happy path + `room.created`; duplicate code → `ROOM_CODE_EXISTS`; count exceeded; update rename; update code conflict; update with `roomTypeId` key must not be in the TypeScript input type (dispatcher test 4c covers wire reject); lower `roomCount` below COUNT → `ROOM_UNITS_EXCEED_COUNT`; list filter; count invariant after filling to `room_count`.

Pattern: provision property via existing test helpers / `resolvePropertyFromRegistry` like `reservations.spec.ts`.

- [ ] **Step 2: Implement methods**

`tryCreateRoom` / `tryUpdateRoom`:
- `touchInteractive()`, `gatePermission(actor, 'inventory:write')`, `gateCoreEntitlement`
- Fingerprint via caller-supplied `idem` (edge computes from allowlist — document allowlist in JSDoc; dispatcher Task 7 builds fingerprint from allowlist fields only)
- Active room type or `NOT_FOUND`; unique code; create checks `COUNT(room) < room_count` else `ROOM_COUNT_EXCEEDED`
- Emit `room.created` / `room.updated` — **never** `availability.changed`

`tryUpdateRoomType`: after computing `nextRoomCount`, if decreasing:

```ts
const unitCount = Number(
  this.ctx.storage.sql
    .exec(`SELECT COUNT(*) AS c FROM room WHERE room_type_id = ?`, input.roomTypeId)
    .toArray()[0]?.c ?? 0,
);
if (nextRoomCount < unitCount) {
  return { ok: false as const, error: ROOM_UNITS_EXCEED_COUNT };
}
```

(Return **before** `runIdempotent` or throw a dedicated error class inside execute that maps without caching — match existing oversell precondition style in that method.)

- [ ] **Step 3: GREEN**

```bash
pnpm --filter @hospai/pms-core test -- rooms.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/rooms.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): tryCreateRoom / tryUpdateRoom and room_count unit gate

Fingerprint allowlist for update mirrors tryUpdateRoomType optional fields.
EOF
)"
```

---

### Task 4: PropertyDO — room status + bulk status

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/rooms.spec.ts`

**Interfaces:**
- `tryUpdateRoomStatus(actor, { roomId, status }, idem, provisional?)`
- `tryBulkUpdateRoomStatus(actor, { updates: Array<{ roomId, status }> }, idem, provisional?)`
- Fingerprint allowlists: `{ roomId, status }` and `{ updates }` with `updates` sorted by `roomId` before edge fingerprinting

- [ ] **Step 1: RED — status tests including mutation target for test 6**

Assert after status change:
- outbox has `room.status_changed`
- outbox does **not** contain `availability.changed`
- ARI version unchanged (read whatever helper `reservations.spec.ts` uses for ARI, or `getAriVersionForTest` if present)

Bulk: two rooms OK; one bad id → zero writes (transaction rollback).

- [ ] **Step 2: Implement**

- `gatePermission(actor, 'housekeeping:write')` — **no** `gateCoreEntitlement`
- `assertProvisionalBusinessDateOpen(provisional)` first inside `execute()`
- Valid status enum; missing room → `NOT_FOUND`
- Bulk: validate all ids first, then apply; one event per room
- `touchInteractive()` only

- [ ] **Step 3: GREEN + commit**

```bash
pnpm --filter @hospai/pms-core test -- rooms.spec.ts
git add apps/pms-core/src/property-do.ts apps/pms-core/test/rooms.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): room status update and bulk status without ledger touch
EOF
)"
```

---

### Task 5: PropertyDO — assign room + readReservation.roomId (adversarial overlap)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/rooms.spec.ts`

**Interfaces:**
- `tryAssignRoom(actor, { reservationId, roomId }, idem)` — `FAIL_CLOSED`, no `provisional`
- Fingerprint allowlist: `{ reservationId, roomId }`
- `readReservation` includes `roomId: string | null`

**Overlap SQL (must be exact — half-open):**

```sql
SELECT reservation_id FROM reservation
 WHERE room_id = ?
   AND reservation_id != ?
   AND status IN ('confirmed', 'checked_in')
   AND arrival_date < ?
   AND departure_date > ?
 LIMIT 1
```

Bindings: `(targetRoomId, candidateReservationId, candidateDeparture, candidateArrival)`.

- [ ] **Step 1: RED — tests 9, 10, 11, 27, 28 with adversarial dates**

```ts
const A = { arrival: '2026-08-10', departure: '2026-08-12' };
const B_overlap = { arrival: '2026-08-11', departure: '2026-08-13' };
const B_adjacent = { arrival: '2026-08-12', departure: '2026-08-14' };

it('9: assign room of wrong room_type_id → room_type_mismatch', async () => {
  // room type King + room type Twin; reservation on King; assign Twin room
  // expect ROOM_TYPE_MISMATCH
});

it('10: overlapping stays on same room → room_already_assigned', async () => {
  // resA dates A, resB dates B_overlap; assign same room to A then B
  // expect second → ROOM_ALREADY_ASSIGNED
});

it('11: adjacent half-open stays on same room both succeed', async () => {
  // resA dates A, resB dates B_adjacent — departure of A === arrival of B
  // BOTH assign_room OK. If overlap uses <=/>=, this fails.
});

it('27: tryCheckIn with room_id NULL still ok', async () => {
  // confirmed reservation, never assign; tryCheckIn → ok
});

it('28: readReservation roomId null then set', async () => { /* ... */ });
```

Also: assign on `cancelled` → `ROOM_NOT_ASSIGNABLE`; re-assign A→B allowed when B free.

- [ ] **Step 2: Implement `tryAssignRoom` + extend `readReservation` SELECT**

Gates: `gateCoreEntitlement` + `gatePermission(actor, 'reservations:write')`.
Emit `reservation.room_assigned` with `previousRoomId` (null or prior).

- [ ] **Step 3: Mutation self-check (before commit)**

Temporarily flip the SQL to `<=` / `>=`, run test 11 — must FAIL. Revert.
Temporarily remove type-mismatch check — test 9 must FAIL. Restore.

- [ ] **Step 4: GREEN + commit**

```bash
pnpm --filter @hospai/pms-core test -- rooms.spec.ts
git add apps/pms-core/src/property-do.ts apps/pms-core/test/rooms.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): tryAssignRoom with half-open overlap invariant

Adversarial adjacent-date test locks < /> boundaries; type mismatch guarded.
EOF
)"
```

---

### Task 6: PropertyDO — housekeeping assign + read

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/rooms.spec.ts`

**Interfaces:**
- `tryAssignHousekeeping(actor, { roomId, businessDate, assigneeRef }, idem, provisional?)`
- Fingerprint allowlist: `{ roomId, businessDate, assigneeRef }`
- `readHousekeepingAssignments(businessDate)` → rows for that date only
- `businessDate`: format-validate only (same stay-date parse used elsewhere) — **do not** compare to open business date

- [ ] **Step 1: RED** — upsert same room/date with new idem key → one row, two events; far-future date (open+30) succeeds (spec test 13a); GET filters by date.

- [ ] **Step 2: Implement** — `INSERT ... ON CONFLICT(room_id, business_date) DO UPDATE SET assignee_ref = excluded.assignee_ref, updated_at = excluded.updated_at` (keep or rotate `assignment_id` — lock: keep original `assignment_id` on conflict so the row identity is stable). Emit `housekeeping.assigned` every successful apply (including re-assign).

- [ ] **Step 3: GREEN + commit**

```bash
pnpm --filter @hospai/pms-core test -- rooms.spec.ts
git add apps/pms-core/src/property-do.ts apps/pms-core/test/rooms.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): housekeeping.assign upsert with unbounded businessDate
EOF
)"
```

---

### Task 7: HTTP routes + audit + replay (eight-row append — order-critical)

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append indices 25–32 **in this exact order**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — append `V1_ROUTES` in the **same** order; handlers; error map
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`

**Exact append order (both arrays):**

1. `post_rooms` → `rooms.create`
2. `patch_room` → `rooms.update`
3. `get_rooms` → `housekeeping:read`, `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'`
4. `post_room_status` → `rooms.update_status`
5. `post_rooms_bulk_status` → `rooms.bulk_update_status`
6. `post_reservation_assign_room` → `reservations.assign_room`
7. `post_housekeeping_assign` → `housekeeping.assign`
8. `get_housekeeping_assignments` → `housekeeping:read`, `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'`

- [ ] **Step 1: Audit rows + stubs that 404 (optional) OR implement handlers in one pass**

Prefer one pass: audit + `V1_ROUTES` + handlers together so `check:permissions` / `check:degraded` never see half-wired state on `main`.

Patterns:
- Fingerprints at the edge — for `patch_room`, compute:

```ts
const fingerprintInput: { roomId: string; code?: string; floor?: string } = { roomId };
if (body.code !== undefined) fingerprintInput.code = body.code;
if (body.floor !== undefined) fingerprintInput.floor = body.floor;
// reject if body.roomTypeId !== undefined → 422 invalid_body
// reject if code/floor both undefined → 422 invalid_body
```

- `QUEUE_PROVISIONAL` routes go through `invokePropertyDo` with `commandId` (same as check-in / folio.add_item).
- `FAIL_CLOSED` routes: transport failure → degraded 503, never queue.

Extend `mapReservationCommandErrorStatus` (or sibling) for the six room codes → `422`.

- [ ] **Step 2: REPLAY_DISPATCH only for provisional trio**

```ts
'rooms.update_status': { /* tryUpdateRoomStatus + REPLAY_ACTOR */ },
'rooms.bulk_update_status': { /* tryBulkUpdateRoomStatus */ },
'housekeeping.assign': { /* tryAssignHousekeeping */ },
```

No entries for create/update/assign_room.

- [ ] **Step 3: Checks**

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: OK; route counts 33/33; every HTTP `QUEUE_PROVISIONAL` has a replay entry and vice versa for new commands.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/pending-commands-consumer.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): rooms and housekeeping HTTP routes + replay dispatch

Append eight audit/dispatcher rows in identical order; provisional trio only.
EOF
)"
```

---

### Task 8: HTTP route matrix — `rooms-routes.spec.ts`

**Files:**
- Create: `apps/pms-core/test/rooms-routes.spec.ts`

Mirror `folio-routes.spec.ts` helpers (`postOrg`, `postProperty`, `postRoomType`, actor headers).

- [ ] **Step 1: Implement cases 1–21 from the spec** (including 4a–4c, 13a)

Critical locks:
- **4c:** `PATCH` body includes `roomTypeId` → `422` (not ignored).
- **6:** status change → no `availability.changed` in outbox; ARI unchanged. (HTTP-level duplicate of DO test — either assert via DO stub `listOutboxEventTypes` after the HTTP call, or skip if Task 4 already covers DO; prefer HTTP+stub so the route path is proven.)
- **9/10/11:** same adversarial dates as Task 5, through HTTP assign-room.
- **15/16:** staff forbidden on create/patch; allowed on status.
- **13a:** `businessDate` = open+30 → 200.

- [ ] **Step 2: Run**

```bash
pnpm --filter @hospai/pms-core test -- rooms-routes.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/test/rooms-routes.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): rooms-routes HTTP matrix for housekeeping vertical
EOF
)"
```

---

### Task 9: Degraded-mode suite — cases 22–26

**Files:**
- Modify: `apps/pms-core/test/degraded-mode.spec.ts`

- [ ] **Step 1: Add tests**

| # | Behavior |
|---|---|
| 22 | `POST .../rooms/:id/status` while blocked → 202; unblock + drain → status applied once; one `room.status_changed` |
| 23 | housekeeping assign while blocked → 202 → replay upsert once |
| 24 | assign-room while blocked → degraded **503**, not queued |
| 25 | `POST /rooms` and `PATCH /rooms/:id` while blocked → 503 |
| 26 | check-in while blocked with **no** `room_id` → 202 → replay succeeds (B regression lock) |

Follow existing `setTransportBlockedForTest` + queue drain patterns in that file.

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @hospai/pms-core test -- degraded-mode.spec.ts
git add apps/pms-core/test/degraded-mode.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): degraded suite for room status, housekeeping, FAIL_CLOSED assign
EOF
)"
```

---

### Task 10: Full pipeline + land spec

- [ ] **Step 1: Pipeline**

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

Expected: all green.

- [ ] **Step 2: Mutation spot-check (manual, local)**

1. Restore `availability.changed` in catalog `rooms.update_status.events` → `register.test` fails; also temporarily emit it from `tryUpdateRoomStatus` → test 6 fails. Revert.
2. Flip overlap to `<=`/`>=` → test 11 fails. Revert.
3. Remove type-mismatch branch → test 9 fails. Revert.

- [ ] **Step 3: Final commit including spec + plan if not already tracked**

```bash
git add docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md \
  docs/superpowers/plans/2026-08-05-rooms-housekeeping-vertical.md
git status # ensure no leftover room WIP
git commit -m "$(cat <<'EOF'
docs: rooms & housekeeping vertical spec and implementation plan
EOF
)"
```

(If you prefer a single squash-style landing commit at the end instead of per-task commits, keep the same file sets and message themes; per-task commits are preferred for review.)

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Drop `availability.changed` on `rooms.update_status` | 1, 4, 8 (test 6) |
| `assign_room` → `FAIL_CLOSED` + entitlement | 1, 7, 9 (test 24) |
| `rooms.create` / `rooms.update` + notes | 1, 3, 7, 8 |
| v11 schema, FK order | 2 |
| Count gates + deploy-safe `tryUpdateRoomType` | 3 |
| Status / bulk status + no ledger | 4 |
| Double-assignment half-open + type match | 5 (tests 9–11) |
| Check-in untouched (B) | 5 (test 27), 9 (test 26) |
| Housekeeping assign unbounded date | 6, 8 (13a), 9 (23) |
| Eight routes identical order + replay trio | 7 |
| HTTP matrix / RBAC / entitlements | 8 |
| Degraded suite | 9 |
| Full checks | 10 |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-rooms-housekeeping-vertical.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — execute tasks in this session with executing-plans and checkpoints  

Which approach?
