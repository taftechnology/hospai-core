# Rooms & Housekeeping Vertical

**Date:** 2026-08-05
**Status:** Revised (v2 — `rooms.update` for code/floor correction; `prototypeAction: null` notes on create/update; `tryUpdateRoomType` gate deploy-safety rationale; `housekeeping.assign` `businessDate` deliberately unbounded; catalog line cite + migration FK order comment)
**Sources:** ARCHITECTURE.md §4.6 (degraded mode — *may never create an obligation the property cannot honour*), §7.1 (availability ledger / OOO → `blocked`); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [reservations vertical](./2026-08-04-reservations-vertical-design.md) (explicitly deferred `reservations.assign_room` and the physical-room schema to this slice); [degraded-mode server slice](./2026-08-04-degraded-mode-server-design.md) (§7.3 actor/`gatePermission`, §7.4 `REPLAY_DISPATCH`); [folio charges vertical](./2026-08-05-folio-charges-vertical-design.md) (commutativity → `FAIL_CLOSED` reclassification precedent; lazy-creation / deploy-day hazard class)

---

## 1. Context & Motivation

32 of 46 catalog commands are unrouted. They cluster. The largest cluster is blocked on one missing entity: there is no `room` table. Only `room_type` with a `room_count` integer. `reservation` has `room_type_id` but **no `room_id`**.

Today the PMS sells room *types* and checks a guest in to nothing. `reservations.assign_room`, `rooms.update_status`, `rooms.bulk_update_status`, and `housekeeping.assign` are all catalogued, all currently `QUEUE_PROVISIONAL`, and all unimplementable — blocked on the same absent entity. The reservations-vertical spec deferred `assign_room` for exactly this reason ([§1](./2026-08-04-reservations-vertical-design.md)).

**Why this over payments.** Payments completes a flow (charges without payments means no checkout). Rooms creates an entity the rest of the product already assumes exists — check-in today is fictional. This slice lands **six mutation commands** (the four above plus new `rooms.create` / `rooms.update`) versus payments' three, has no external PSP dependency, and is the right second proving surface for degraded mode: housekeepers on phones in a concrete building is the canonical `QUEUE_PROVISIONAL` scenario, and those commands are already classified that way. `CLOSE_CASHIER_SHIFTS` still needs a staff/shift model that pairs with payments; payments lands better after staff exists.

**Scope in:**

1. **`room` table + room status machine** — `room_id`, `room_type_id`, `code` (room number), `status` (`clean` / `dirty` / `inspected` / `out_of_order`), `floor`. Commands: `rooms.create` / `rooms.update` (**new**), `rooms.update_status`, `rooms.bulk_update_status`.
2. **`reservation.room_id`** + `reservations.assign_room` — with the double-assignment invariant (two active reservations cannot hold one room on overlapping nights).
3. **`housekeeping.assign`** — assign a room to a housekeeper for a business date (opaque assignee ref; no staff table).
4. **HTTP routes** + route-audit rows, plus `REPLAY_DISPATCH` entries for the commands that remain `QUEUE_PROVISIONAL`.

**Scope out:**

- Housekeeping *staff* management (`housekeeping.staff_add` / `staff_status` / `staff_update` / `staff_delete`). Needs a staff/user model overlapping OrgDO membership and `ROLE_GRANTS` — a genuinely separate question.
- **`rooms.delete` / archive** — `rooms.update` covers typo correction (§2.3a); removing a physical unit (and freeing a `room_count` slot) is a later lifecycle question, parallel to room-type archive.
- **`rooms.set_ooo_range`** — remains in `PLATFORM_GAPS` (*"Explicit OOO delta on blocked"*, [catalog.ts:465](../../../packages/contracts/src/commands/catalog.ts:465)). Phase 1 does **not** wire OOO status into the availability ledger.
- **Auto-assignment at check-in** — deferred (§2.4). Existing properties have `room_type` rows and zero `room` rows; auto-assign on deploy would fail every front-desk check-in until rooms are created — the folio-window deploy-day hazard class, hitting the desk rather than night audit.
- **Requiring an assigned room on check-in** — deferred (§2.4). Correct hotel policy, wrong Phase 1 given `assign_room → FAIL_CLOSED`.
- Payments, cashier shifts, `CLOSE_CASHIER_SHIFTS`.

---

## 2. Design Decisions

### 2.1 Availability stays on `room_count` — rooms are an assignment/housekeeping layer

This is the decision that can regress proven work. Today `availability_day.physical = room_type.room_count`, seeded by `reconcileHorizon` ([property-do.ts:243–282](../../../apps/pms-core/src/property-do.ts)), and the oversell ledger is built on it.

ARCHITECTURE §7.1 eventually wants OOO per room to increment `blocked` in the same atomic write as the status change. The catalog already encodes the Phase 1 honesty: `rooms.set_ooo_range` sits in `PLATFORM_GAPS` with reason *"Explicit OOO delta on blocked"* — so OOO increments `blocked`, it does **not** decrement `physical`.

**Resolution for this slice:**

- Keep `room_count` / `reconcileHorizon` / `tryAddRoomType` / `tryUpdateRoomType` authoritative for `physical`. No change to the ledger formula.
- `room` rows are an assignment and housekeeping layer on top. Creating, status-changing, or assigning a room never touches `availability_day`, never bumps `ariVersion`, never emits `availability.changed`.
- Intended steady state for each active `room_type`: `COUNT(room) == room_count`. Hard gates on the write paths that would drive permanent divergence (§2.5); a DO test asserts equality after the happy-path create-up-to-count flow. Raising `room_count` without creating rooms is a temporary under-count (allowed); the gates forbid over-count.
- `rooms.set_ooo_range` and the ARCHITECTURE OOO→`blocked` path remain deferred. Status `out_of_order` is a housekeeping label only in Phase 1 — visible to operators, inert to the ledger. That temporary inconsistency with §7.1 is explicit and bounded by the existing `PLATFORM_GAPS` entry, not invented here.

**Catalog honesty fix required by this decision.** Today `rooms.update_status` declares `events: ['room.status_changed', 'availability.changed']` ([catalog.ts:135](../../../packages/contracts/src/commands/catalog.ts:135)). Emitting `availability.changed` without touching the ledger is a lie that would kick ARI projection consumers for no reason. Drop `availability.changed` from that entry in the same commit that lands this slice. `rooms.bulk_update_status` already emits only `room.status_changed` — leave it.

### 2.2 `reservations.assign_room` does not commute → `FAIL_CLOSED`

`reservations.assign_room` is catalogued `QUEUE_PROVISIONAL`. Its payload references a `roomId`. Two assignments queued during an outage can replay in either order onto the same room for overlapping nights — the double-assignment invariant fails depending on order. Same shape as `folio.split_charge` last slice.

§4.6's admission test is commutativity, not importance. Assignment reads-then-decides on shared reservation/room occupancy state.

**Resolution: `reservations.assign_room` becomes `FAIL_CLOSED` for Phase 1.**

```diff
   {
     id: 'reservations.assign_room',
     prototypeAction: 'ASSIGN_ROOM',
     lane: 'INTERACTIVE',
-    degraded: 'QUEUE_PROVISIONAL',
+    degraded: 'FAIL_CLOSED',
     idempotent: true,
     events: ['reservation.room_assigned'],
+    entitlement: 'pms.core',
     permission: 'reservations:write',
   },
```

`entitlement: 'pms.core'` lands in the same edit — a newly-`FAIL_CLOSED` command with a non-empty `events` array needs either an entitlement or an opt-out row (`check:entitlements`), and this slice **is** the DO boundary, so gate it. Matching `folio.split_charge`'s reclassification.

**Consequence:** `handlePostAssignRoom` never goes through `invokePropertyDo`'s `QUEUE_PROVISIONAL` branch — transport failure returns degraded `503` with `Retry-After`. No `REPLAY_DISPATCH` entry for `reservations.assign_room`.

Room *status* updates remain `QUEUE_PROVISIONAL` — last-writer-wins per `room_id`, commutative across rooms. `housekeeping.assign` stays `QUEUE_PROVISIONAL` — last-writer-wins per `(room_id, business_date)`. See §2.8 for why the client-supplied `businessDate` on that command is deliberately unbounded.

### 2.3 What creates rooms — `rooms.create`, not derivation from `room_count`

There is no `rooms.create` in the catalog today — only status commands. Deriving rooms from `room_count` at room-type creation is tempting and wrong: room numbers aren't sequential and change independently of count.

**Resolution: add `rooms.create` to the catalog.**

```ts
{
  id: 'rooms.create',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['room.created'],
  entitlement: 'pms.core',
  permission: 'inventory:write', // structural inventory, same plane as room_type
  notes:
    'prototypeAction null: net-new surface — the prototype never had CREATE_ROOM. ' +
    'Null here is not a platform-only split of a compound action (the field\'s documented meaning); ' +
    'it records that no prototype action exists to cite.',
}
```

`FAIL_CLOSED` because creating a room is structural inventory configuration, not a front-desk provisional act — same class as `inventory.add_room_type`. Permission is `inventory:write` (owner/admin; **not** granted to `staff`), distinct from `housekeeping:write` which staff *does* hold for status updates. `prototypeAction: null` is type-legal (`string | null`, eleven entries already use it) and events are a free `string[]` — no registry to update for `room.created`. The `notes` line is load-bearing: without it, null silently overloads the field's documented "platform-only split" meaning.

### 2.3a Correcting a room — minimal `rooms.update` (code / floor only)

There is no `rooms.delete` and `room.status` is housekeeping state, not lifecycle — unlike `room_type`, which scopes its unique index to `status = 'active'` and has an archive path. Combined with §2.5's `ROOM_COUNT_EXCEEDED` gate, a mistyped create is permanent and permanently consumes a slot: operator creates `10I` instead of `101` on a type at `room_count = 20` → the typo can't be renamed, can't be deleted, and `101` can never be created.

**Resolution: add `rooms.update` — `code` and `floor` only.** Never `room_type_id` (that would move a physical unit between inventory pools and bypass the per-type count gates). Same gates as `tryCreateRoom` (`FAIL_CLOSED`, `entitlement: 'pms.core'`, `permission: 'inventory:write'`).

```ts
{
  id: 'rooms.update',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['room.updated'],
  entitlement: 'pms.core',
  permission: 'inventory:write',
  notes:
    'prototypeAction null: net-new surface (no prototype UPDATE_ROOM). ' +
    'code/floor only — room_type_id is immutable after create.',
}
```

Re-pointing `code` to a value already held by another room returns `ROOM_CODE_EXISTS`. Omitting both `code` and `floor` is a no-op success under idempotency (fingerprint includes the supplied fields). No slot arithmetic — update does not change `COUNT(room)`.

### 2.4 Check-in does **not** require an assigned room (and does not auto-assign)

**Rejected: require `room_id` on `tryCheckIn` (option A).** Premises collide.

`reservations.check_in` is `QUEUE_PROVISIONAL` and wired into `REPLAY_DISPATCH` ([pending-commands-consumer.ts:30](../../../apps/pms-core/src/pending-commands-consumer.ts:30)). `reservations.assign_room` is `FAIL_CLOSED` (§2.2). During a PropertyDO outage:

1. Operator tries to assign → `503`, refused (`FAIL_CLOSED` working).
2. Operator checks the guest in → `202`, queued (degraded machinery working).
3. Replay runs `tryCheckIn`, finds no `room_id`, returns `ROOM_NOT_ASSIGNED` → `provisional_exception`.

The guest was told they're checked in and is standing at the desk. §4.6: *degraded mode may never create an obligation the property cannot honour* — and A manufactures one in exactly the scenario the degraded slice was built for. A is unshippable as stated while assign stays `FAIL_CLOSED`.

This is also a different risk class from the folio edit to `tryCreateReservation`: that was **additive** (opened a window that never fails). Requiring a room is **restrictive** — a new failure mode on a shipped, verified command (`tryCheckIn` has call sites across ~5 files including `degraded-mode.spec.ts`).

**Rejected for this slice: auto-assignment inside `tryCheckIn`.** Assigning a free room of the booked type when `room_id` is unset, inside the same `execute()` closure, would survive the degraded path (sync query, DO input gate prevents double-pick). But existing properties have `room_type` rows and zero `room` rows — on deploy, auto-assign fails every check-in until someone creates rooms. "Fall back to checking in without one" is option C wearing a different hat. Auto-assign needs the no-rooms-configured path designed up front; treat it as its own decision once rooms exist in the field.

**Resolution: option B for this slice.** `tryCheckIn` is untouched. Assignment is independent — before or after check-in, on any `confirmed` or `checked_in` reservation. Check-in stops being *structurally* fictional the moment operators can assign rooms and see `roomId` on `GET .../reservations/:rid`; **requiring** assignment is policy layered on that capability and lands once the room is normally already assigned before anyone reaches check-in. Tightening to A later is cheap — nothing about B makes A more expensive.

**Also out:** soft-warning-only (option C) — cost of A with none of the benefit.

**Also out of this slice:** `tryCheckOut` does not auto-flip the assigned room to `dirty`. Keeps the status-machine methods' blast radius at zero. Operators (or a later slice) use `rooms.update_status`.

### 2.5 Schema

**Migration version 11** (folio's `folio_window_reservation_idx` is already v10). Regenerate via `pnpm generate:ddl` — let the generator assign the SQL filename number.

**Statement order is load-bearing:** `CREATE TABLE room` must precede the `reservation` rebuild. This is the first reservation rebuild that adds an **outbound** FK (`room_id → room`); reordering so the rebuild runs first fails the migration under `PRAGMA foreign_keys = ON`. Put a one-line comment in the statements array recording that — do not rely on reviewers noticing.

#### `room` (new table)

```sql
CREATE TABLE room (
  room_id       TEXT PRIMARY KEY,
  room_type_id  TEXT NOT NULL,
  code          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'clean'
                CHECK (status IN ('clean', 'dirty', 'inspected', 'out_of_order')),
  floor         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_type_id) REFERENCES room_type(room_type_id)
);
CREATE UNIQUE INDEX room_code_uidx ON room(code);
CREATE INDEX room_type_idx ON room(room_type_id);
CREATE INDEX room_status_idx ON room(status);
```

`floor` is nullable free text (`"3"`, `"Lobby"`) — properties disagree on floor schemes; don't invent an integer constraint. Status transitions are unrestricted among the four values (last-writer-wins); no separate transition graph.

#### `reservation` rebuild — add nullable `room_id`

Same table-rebuild pattern as v5/v7/v8. New column:

```sql
room_id  TEXT  -- nullable; FK to room(room_id)
```

`NULL` means unassigned. Index for the double-assignment query:

```sql
CREATE INDEX reservation_room_idx ON reservation (room_id)
  WHERE room_id IS NOT NULL;
```

Copy existing rows with `room_id = NULL`.

#### `housekeeping_assignment` (new table)

```sql
CREATE TABLE housekeeping_assignment (
  assignment_id  TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  assignee_ref   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  UNIQUE (room_id, business_date)
);
```

`assignee_ref` is an opaque string — no FK to a staff table (scoped out). Re-assigning the same room on the same business date is an upsert on `(room_id, business_date)` (last-writer-wins), which is what makes `housekeeping.assign` commute under `QUEUE_PROVISIONAL`.

#### Count invariant — hard gates

| Path | Gate |
|---|---|
| `tryCreateRoom` | Reject with `ROOM_COUNT_EXCEEDED` if `COUNT(room) WHERE room_type_id = ?` would exceed `room_type.room_count` after insert |
| `tryUpdateRoomType` when `roomCount` decreases | Reject with `ROOM_UNITS_EXCEED_COUNT` if `COUNT(room) WHERE room_type_id = ?` > new `roomCount` (in addition to the existing oversell/`sold` guard) |
| Raising `roomCount` | Allowed; does **not** auto-create rooms — operator creates them via `rooms.create` |
| Archiving a room type | Existing `tryDeleteRoomType` rules unchanged; rooms of an archived type remain queryable but `tryCreateRoom` / `tryAssignRoom` reject non-active types |

**Why the `tryUpdateRoomType` gate is allowed even though §2.4 refused the same class of edit on `tryCheckIn`.** Adding `ROOM_UNITS_EXCEED_COUNT` is a **new failure mode on a shipped, verified method** — the restrictive-edit class §2.4 correctly rejected for check-in. It stays because the deploy-day hazard does not exist: on every property that predates this slice, `COUNT(room) = 0`, so the gate cannot fire against existing data. The folio slice needed lazy window creation precisely because a missing window *would* halt night audit on deploy; this gate cannot reject a lowering of `room_count` until operators have created rooms, which can only happen *after* this slice ships. Stated consequence: once rooms exist, lowering `room_count` below `COUNT(room)` fails closed — operators must rename/correct via `rooms.update` or wait for a future delete/archive path, not silently orphan units under a smaller sellable count.

### 2.6 Double-assignment invariant

`tryAssignRoom` inside `execute()`:

1. Load reservation — must exist; status ∈ `{confirmed, checked_in}` (not `cancelled` / `checked_out` / `no_show`).
2. Load room — must exist; `room.room_type_id === reservation.room_type_id` (else `ROOM_TYPE_MISMATCH`).
3. Overlap query — reject with `ROOM_ALREADY_ASSIGNED` if any other reservation holds this `room_id` with status ∈ `{confirmed, checked_in}` and date ranges overlap:

```sql
SELECT reservation_id FROM reservation
 WHERE room_id = ?
   AND reservation_id != ?
   AND status IN ('confirmed', 'checked_in')
   AND arrival_date < ?   -- candidate departure
   AND departure_date > ? -- candidate arrival
 LIMIT 1
```

4. `UPDATE reservation SET room_id = ?, updated_at = ?`.
5. Emit `reservation.room_assigned` with `{ propertyId, reservationId, roomId, previousRoomId }`.

Re-assignment (changing `room_id` from A to B) is allowed and is the same path — step 3 checks the *target* room. Clearing an assignment (`room_id → NULL`) is **out of scope** this slice; no unassign command.

### 2.7 Precise error codes

New constants in `packages/contracts/src/idempotency.ts`:

```ts
export const ROOM_CODE_EXISTS = 'room_code_exists' as const;
export const ROOM_COUNT_EXCEEDED = 'room_count_exceeded' as const;
export const ROOM_UNITS_EXCEED_COUNT = 'room_units_exceed_count' as const;
export const ROOM_TYPE_MISMATCH = 'room_type_mismatch' as const;
export const ROOM_ALREADY_ASSIGNED = 'room_already_assigned' as const;
export const ROOM_NOT_ASSIGNABLE = 'room_not_assignable' as const; // reservation terminal / wrong status
```

HTTP mapping: all → `422`, except not-found → `404` via existing `NOT_FOUND`.

### 2.8 `housekeeping.assign` `businessDate` — deliberately unbounded

The client supplies `businessDate`. `assertProvisionalBusinessDateOpen(provisional)` guards the *replay envelope's* date, not this field — they are different values. Nothing today would stop an operator from writing assignments for arbitrary past or future dates.

**Resolution: allow any well-formed stay date deliberately.** Housekeeping is often scheduled a day or two ahead, so a hard equality check against the DO's open business date is wrong. Inventing `open ± N` without an ops-derived horizon is guesswork that would bounce legitimate schedule-ahead writes. The write path validates format only (same stay-date parse the rest of the DO uses); the read route requires `businessDate` as a query param, so rows for unqueried dates do not surface. Accumulation of far-future or far-past rows is an operator-discipline concern, not a DO invariant — a later prune/archive can land once there is a staff model and a reason to care. Document this in the catalog `notes` on `housekeeping.assign` so the silence is not re-litigated as a bug.

---

## 3. File Changes

### `packages/contracts/src/commands/catalog.ts` [MODIFY]

1. `reservations.assign_room` → `FAIL_CLOSED` + `entitlement: 'pms.core'` (§2.2).
2. `rooms.update_status` — drop `availability.changed` from `events` (§2.1).
3. Add `rooms.create` (§2.3) and `rooms.update` (§2.3a) — both with the `notes` lines that record why `prototypeAction` is null.
4. `housekeeping.assign` — add `notes` recording that client `businessDate` is unbounded relative to the open business date (§2.8).

### `packages/contracts/src/idempotency.ts` [MODIFY]

Six new wire codes (§2.7).

### `packages/contracts/src/index.ts` [MODIFY]

Re-export the new codes.

### `packages/do-runtime/src/property-migrations.ts` [MODIFY]

Append version **11**:

```ts
/** v11 — physical room units + reservation.room_id + housekeeping_assignment.
 *  ORDER: CREATE room BEFORE reservation rebuild — outbound FK room_id → room. */
export const ROOM_AND_HOUSEKEEPING_V11_STATEMENTS: string[] = [
  // 1. CREATE TABLE room ... (§2.5)  — must come first
  // 2. reservation rebuild with room_id FK
  // 3. CREATE TABLE housekeeping_assignment ...
];
```

Regenerate `migrations/do-property/0011_*.sql` via `pnpm generate:ddl`.

### `apps/pms-core/src/property-do.ts` [MODIFY]

1. **`tryCreateRoom(actor, input, idem)`** — `FAIL_CLOSED`, no `provisional` param.
   - `gateCoreEntitlement` + `gatePermission(actor, 'inventory:write')`
   - Fingerprint: `{ roomId, roomTypeId, code, floor? }`
   - Guards: room type active (else `NOT_FOUND`), code unique, count invariant (§2.5)
   - Insert `status = 'clean'`; emit `room.created`
2. **`tryUpdateRoom(actor, input, idem)`** — `FAIL_CLOSED`, no `provisional` param (§2.3a).
   - Same entitlement / permission gates as `tryCreateRoom`
   - Fingerprint: `{ roomId, code?, floor? }`
   - Never accepts `roomTypeId`; `ROOM_CODE_EXISTS` on conflict; emit `room.updated`
4. **`tryUpdateRoomStatus(actor, input, idem, provisional?)`** — `QUEUE_PROVISIONAL`.
   - `gatePermission(actor, 'housekeeping:write')` — **no** entitlement gate (same degraded-mode reasoning as `tryCheckIn`: §2.3a of reservations-vertical)
   - Fingerprint: `{ roomId, status }`
   - `assertProvisionalBusinessDateOpen(provisional)` first inside `execute()`
   - Update status; emit `room.status_changed` only (no ARI, no `availability.changed`)
5. **`tryBulkUpdateRoomStatus(actor, input, idem, provisional?)`** — catalog `lane: 'BULK'`, but `LaneGuard` today only exposes `touchInteractive` / `admitBackground` / `bulkDeadline` ([lane-guard.ts](../../../packages/do-runtime/src/lane-guard.ts)). Call `this.lanes.touchInteractive()` like every other mutation — do **not** invent `touchBulk`. Chunked bulk admission is a later LaneGuard concern; this command's body is a single small all-or-nothing transaction.
   - Same permission / provisional shape as (4)
   - Fingerprint: `{ updates: Array<{ roomId, status }> }` with `updates` sorted by `roomId` before fingerprinting (stable across client array order)
   - All-or-nothing inside one `execute()`; one `room.status_changed` event per updated room
6. **`tryAssignRoom(actor, input, idem)`** — `FAIL_CLOSED`, no `provisional`.
   - `gateCoreEntitlement` + `gatePermission(actor, 'reservations:write')`
   - Fingerprint: `{ reservationId, roomId }`
   - Double-assignment invariant (§2.6)
7. **`tryAssignHousekeeping(actor, input, idem, provisional?)`** — `QUEUE_PROVISIONAL`.
   - `gatePermission(actor, 'housekeeping:write')`, no entitlement
   - Fingerprint: `{ roomId, businessDate, assigneeRef }`
   - `businessDate` format-validated only — **not** compared to the DO open date (§2.8)
   - Upsert on `(room_id, business_date)`; emit `housekeeping.assigned`
8. **`tryUpdateRoomType`** — add the `ROOM_UNITS_EXCEED_COUNT` gate when lowering `roomCount` (§2.5, deploy-safety rationale there). No other inventory behaviour changes.
9. **`readReservation`** — include `roomId: string | null` in the returned reservation object.
10. **`listRooms(filters?)`** — new read RPC: optional `roomTypeId`, optional `status`; returns the room rows. Used by `GET .../rooms`.
11. **`readHousekeepingAssignments(businessDate)`** — new read RPC for `GET .../housekeeping/assignments?businessDate=`.

`tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn` — **not modified**.

### `packages/contracts/src/v1-http-routes.ts` [MODIFY]

Append after the folio routes (current array length 25 → new indices 25–32):

```ts
  { id: 'post_rooms', scope: 'property', permission: 'inventory:write', commandId: 'rooms.create' },
  { id: 'patch_room', scope: 'property', permission: 'inventory:write', commandId: 'rooms.update' },
  { id: 'get_rooms', scope: 'property', permission: 'housekeeping:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
  { id: 'post_room_status', scope: 'property', permission: 'housekeeping:write', commandId: 'rooms.update_status' },
  { id: 'post_rooms_bulk_status', scope: 'property', permission: 'housekeeping:write', commandId: 'rooms.bulk_update_status' },
  { id: 'post_reservation_assign_room', scope: 'property', permission: 'reservations:write', commandId: 'reservations.assign_room' },
  { id: 'post_housekeeping_assign', scope: 'property', permission: 'housekeeping:write', commandId: 'housekeeping.assign' },
  { id: 'get_housekeeping_assignments', scope: 'property', permission: 'housekeeping:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
```

`get_rooms` / `get_housekeeping_assignments` are `FAIL_CLOSED` for the same reason as `get_folio` / `get_reservation`: this slice builds no KV projection, so `READ_STALE` would describe a capability the route does not have. Reclassify when a room-status projection lands (ARCHITECTURE §4.6 lists "room status" under `READ_STALE` aspirationally).

### `apps/pms-core/src/v1-dispatch.ts` [MODIFY]

| Route | Pattern | Notes |
|---|---|---|
| `post_rooms` | `POST` `/^\/v1\/properties\/([^/]+)\/rooms$/` | Body: `{ roomId, roomTypeId, code, floor?, idempotencyKey }` — `FAIL_CLOSED` |
| `patch_room` | `PATCH` `/^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/` | Body: `{ code?, floor?, idempotencyKey }` — at least one of `code`/`floor`; `FAIL_CLOSED`; never accepts `roomTypeId` |
| `get_rooms` | `GET` `/^\/v1\/properties\/([^/]+)\/rooms$/` | Query: optional `roomTypeId`, `status` |
| `post_room_status` | `POST` `/^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/status$/` | Body: `{ status, idempotencyKey }` — `QUEUE_PROVISIONAL` via `invokePropertyDo` |
| `post_rooms_bulk_status` | `POST` `/^\/v1\/properties\/([^/]+)\/rooms\/bulk-status$/` | Body: `{ updates: Array<{ roomId, status }>, idempotencyKey }` — `QUEUE_PROVISIONAL` |
| `post_reservation_assign_room` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/assign-room$/` | Body: `{ roomId, idempotencyKey }` — `FAIL_CLOSED` |
| `post_housekeeping_assign` | `POST` `/^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/` | Body: `{ roomId, businessDate, assigneeRef, idempotencyKey }` — `QUEUE_PROVISIONAL`; `businessDate` not tied to open date (§2.8) |
| `get_housekeeping_assignments` | `GET` `/^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/` | Query: required `businessDate` |

Extend `mapReservationCommandErrorStatus` (or a sibling mapper) for the six new codes → `422`.

### `apps/pms-core/src/pending-commands-consumer.ts` [MODIFY]

Add to `REPLAY_DISPATCH` — only the commands that stay `QUEUE_PROVISIONAL`:

```ts
  'rooms.update_status': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryUpdateRoomStatus(REPLAY_ACTOR, payload as UpdateRoomStatusInput, idem, ctx),
  },
  'rooms.bulk_update_status': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryBulkUpdateRoomStatus(REPLAY_ACTOR, payload as BulkUpdateRoomStatusInput, idem, ctx),
  },
  'housekeeping.assign': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryAssignHousekeeping(REPLAY_ACTOR, payload as AssignHousekeepingInput, idem, ctx),
  },
```

No entry for `reservations.assign_room`, `rooms.create`, or `rooms.update` — all `FAIL_CLOSED`.

---

## 4. Test Matrix

New file `apps/pms-core/test/rooms-routes.spec.ts`:

| # | Test | Assertion |
|---|---|---|
| 1 | `POST /rooms` valid | `201`, `room.created` on outbox, row `status = 'clean'` |
| 2 | `POST /rooms` duplicate `code` | `422 room_code_exists` |
| 3 | `POST /rooms` when `COUNT(room) == room_count` already | `422 room_count_exceeded` |
| 4 | `POST /rooms` on archived room type | `404 not_found` — same privacy/absence shape as a missing type; do not leak archive state via a distinct code |
| 4a | `PATCH /rooms/:id` rename `code` `10I` → `101` | `200`, `room.updated`, unique index holds; slot count unchanged |
| 4b | `PATCH /rooms/:id` to a `code` already taken | `422 room_code_exists` |
| 4c | `PATCH /rooms/:id` with `roomTypeId` in body | **`422`** — reject; never silently apply; `room_type_id` is immutable |
| 5 | `GET /rooms` filters by `status` | Only matching rows |
| 6 | `POST .../rooms/:id/status` `clean → dirty` | `200`, `room.status_changed`, **no** `availability.changed`, ARI unchanged |
| 7 | `POST .../rooms/bulk-status` two rooms | Both updated, two events, all-or-nothing (one bad `roomId` → no writes) |
| 8 | `POST .../reservations/:rid/assign-room` happy path | `200`, `reservation.room_assigned`, `GET` reservation shows `roomId` |
| 9 | Assign room of wrong `room_type_id` | `422 room_type_mismatch` |
| 10 | Two overlapping reservations, same room | Second → `422 room_already_assigned` |
| 11 | Non-overlapping dates, same room | Both assign OK |
| 12 | Assign on `cancelled` reservation | `422 room_not_assignable` |
| 13 | `POST .../housekeeping/assignments` then re-assign same room/date with a **new** idempotency key | Upsert — one row, latest `assigneeRef`, **two** `housekeeping.assigned` events (re-assign is a new command, not an idempotent replay) |
| 13a | `POST .../housekeeping/assignments` with `businessDate` far from the DO open date (e.g. open+30) | `200` — unbounded by design (§2.8); row stored; `GET` with that date returns it |
| 14 | `GET .../housekeeping/assignments?businessDate=` | Lists that date's rows only |
| 15 | `staff` on `POST /rooms` / `PATCH /rooms/:id` | `403` (`inventory:write` not granted to staff) |
| 16 | `staff` on `POST .../status` | `200` (`housekeeping:write` granted) |
| 17 | Non-member on any rooms route | `404` (RBAC privacy) |
| 18 | Kill-switch on `post_rooms` / `patch_room` / `post_reservation_assign_room` | `503`, empty body |
| 19 | Unentitled org on `post_rooms` / `patch_room` / `assign-room` | `402 entitlement_required` |
| 20 | Lower `room_count` via `PATCH` room type below `COUNT(room)` | `422 room_units_exceed_count` |
| 21 | `check:entitlements` after catalog edit | `reservations.assign_room`, `rooms.create`, and `rooms.update` have entitlements |

Extend `apps/pms-core/test/degraded-mode.spec.ts`:

| # | Scenario | Assertion |
|---|---|---|
| 22 | `POST .../rooms/:id/status` while blocked, then unblock + replay | `202` on admission; status applied once; one `room.status_changed` |
| 23 | `POST .../housekeeping/assignments` while blocked, then replay | Same shape — upsert lands once |
| 24 | `POST .../assign-room` while blocked | Degraded `503`, **not** queued — proves `FAIL_CLOSED` reclassification |
| 25 | `POST /rooms` / `PATCH /rooms/:id` while blocked | Degraded `503`, not queued |
| 26 | Check-in while blocked (existing path) with **no** `room_id` on the reservation | Still `202` → replay succeeds — proves B did not regress the degraded check-in path |

Extend reservation DO tests lightly:

| # | Scenario | Assertion |
|---|---|---|
| 27 | `tryCheckIn` on confirmed with `room_id = NULL` | Still `{ ok: true }` — B locked |
| 28 | `readReservation` after assign | `roomId` present; before assign, `roomId: null` |
| 29 | Count invariant after create-up-to-`room_count` | `COUNT(room) == room_count` for that type |

---

## 5. Open Questions — Resolved

1. **Does `availability_day.physical` derive from `room` rows?** **No for Phase 1.** `room_count` stays authoritative; rooms are assignment/housekeeping; OOO→`blocked` waits on `rooms.set_ooo_range`. Catalog drops the premature `availability.changed` on `rooms.update_status` (§2.1).
2. **`reservations.assign_room` degraded class.** **`FAIL_CLOSED`** + `entitlement: 'pms.core'` — does not commute (§2.2).
3. **What creates rooms?** **`rooms.create`** — not derivation from `room_count` (§2.3). **`rooms.update`** covers code/floor typos so a mistype does not permanently consume a `room_count` slot (§2.3a).
4. **Does check-in require an assigned room?** **No (B).** A collides with `FAIL_CLOSED` assign under degraded replay; auto-assign deferred until rooms exist in the field (§2.4).
5. **`get_rooms` / `get_housekeeping_assignments` degraded read.** **`FAIL_CLOSED`** until a room-status KV projection exists — same honesty rule as `get_folio`.
6. **Checkout auto-dirty?** **No this slice** — zero blast radius on `tryCheckOut`; operators use `rooms.update_status`.
7. **`housekeeping.assign` `businessDate` vs open date.** **Deliberately unbounded** — format only; read route filters (§2.8).
8. **`tryUpdateRoomType` + `ROOM_UNITS_EXCEED_COUNT`.** **Keep** — restrictive edit, but deploy-safe because `COUNT(room) = 0` on every pre-slice property (§2.5).

---

## 6. Implementation Checklist

- [ ] Catalog: `reservations.assign_room` → `FAIL_CLOSED` + `entitlement: 'pms.core'`; drop `availability.changed` from `rooms.update_status`; add `rooms.create` + `rooms.update` with `notes` (§2.1–2.3a); `housekeeping.assign` `notes` for unbounded `businessDate` (§2.8) — single commit for the entitlement-paired edits.
- [ ] Six wire codes in `idempotency.ts` + re-exports (§2.7).
- [ ] Migration **v11** — `CREATE room` **before** reservation rebuild (outbound FK comment in array); `housekeeping_assignment`; regenerate DDL.
- [ ] `tryCreateRoom` / `tryUpdateRoom` / `tryUpdateRoomStatus` / `tryBulkUpdateRoomStatus` / `tryAssignRoom` / `tryAssignHousekeeping` (§3).
- [ ] `tryUpdateRoomType` gain `ROOM_UNITS_EXCEED_COUNT` when lowering count below `COUNT(room)` — deploy-safe (§2.5).
- [ ] `readReservation` gains `roomId`; `listRooms` + `readHousekeepingAssignments` read RPCs.
- [ ] **Do not modify** `tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn`.
- [ ] Eight route-audit rows (indices 25–32) + dispatcher handlers + error-status mapping.
- [ ] `REPLAY_DISPATCH` for `rooms.update_status`, `rooms.bulk_update_status`, `housekeeping.assign` only.
- [ ] `rooms-routes.spec.ts` (cases 1–21 incl. 4a–4c / 13a) + degraded-suite additions (5 cases) + reservation DO locks for B (3 cases).
- [ ] `pnpm build`, `check:ddl`, `check:degraded`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`.

---

## 7. Explicitly deferred (do not pull into implementation)

| Item | Why deferred |
|---|---|
| Require `room_id` on check-in (A) | Collides with `FAIL_CLOSED` assign under §4.6 replay |
| Auto-assign inside `tryCheckIn` | Deploy-day: zero `room` rows on existing properties; needs a designed no-rooms path |
| `rooms.set_ooo_range` / OOO → `blocked` | Already in `PLATFORM_GAPS`; ledger coupling is the risky part this slice exists to avoid |
| `rooms.delete` / archive lifecycle | `rooms.update` covers typo correction; freeing a `room_count` slot is a separate lifecycle question |
| Housekeeping staff CRUD | Staff/user model × OrgDO membership |
| Bound `housekeeping.assign` `businessDate` to open ± N | Deliberately unbounded in Phase 1 (§2.8); revisit with ops-derived horizon |
| Room-status / arrivals KV projection (`READ_STALE`) | No projection consumer yet |
| Checkout → auto-`dirty` | Keeps status-machine blast radius at zero |
| Unassign / clear `room_id` | No catalog command; YAGNI |
| Payments / cashier shifts | Separate vertical; better after staff model |
