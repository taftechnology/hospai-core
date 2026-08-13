# Room Operations & Housekeeping Completion

**Date:** 2026-08-12  
**Status:** Draft — implementation-ready  
**Sources:** ARCHITECTURE.md §4.2 (lanes), §4.6 (degraded classes; inventory mutations FAIL_CLOSED; room-status / HK `QUEUE_PROVISIONAL`), §7.1 (availability ledger: `free = physical - blocked - held - sold + oversell`; OOO per-room range → type-level `blocked` delta in the same atomic write as the status change; fail-closed if assigned; work-order event), §7.7 (operational reads — WS tape chart not this chunk), §8 (pinned 7-step machine; do not grow `NIGHT_AUDIT_STEPS`; `ROLL_BUSINESS_DATE` is the only step that mutates `__meta.business_date` / the horizon), §16.1 / §16.5 (OOO with date ranges is specified, not redesignable; DND unnamed; HK core = roster, assignment, inventory, manager priorities); [folio money operations](./2026-08-12-folio-money-operations-design.md) (style template); [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) (`out_of_order` is a HK label, ledger-inert, bounded by `PLATFORM_GAPS`); [housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md) (assign UI deferred pending roster; `assignee_ref` pin); [staff roster](./2026-08-12-staff-roster-design.md) (identity source; picker landed); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (check-in OOO + cleanliness gates; check-out dirty; modify); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (occupancy snapshot already has `blocked`); command catalog `rooms.*` / `housekeeping.*`; `PropertyDO` `tryUpdateRoomStatus` / `tryAssignRoom` / `tryCheckIn` / `tryCheckOut` / `tryModifyReservation` / `reconcileHorizon` / `commitSoldNightsSync` / `runRollStepSync` / `snapshotReportsAsync`

**Closes:** the last `PLATFORM_GAPS` entry `rooms.set_ooo_range` (`catalog.ts` ~777: *"Explicit OOO delta on blocked"*); rooms-vertical leftover “OOO → `blocked`”; housekeeping-module leftover §4.2 assign affordance **completion** (picker already exists from roster; this chunk finishes board UX); §16.5 DND row (decision: defer, not a room status).

**Amends:** [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) §2.1 (status `out_of_order` is no longer a housekeeping label — it is written only by `rooms.set_ooo_range` and roll sync); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) §4.2 (OOO gate becomes **range overlap** with the stay, not only `room.status === 'out_of_order'`; cleanliness table gains optional `require_inspection`); lifecycle **modify contract** (`tryModifyReservation` ~5709 — date changes with `room_id` set re-run assignability; the pre-existing missing physical-overlap check on modify is closed by the same rule); `tryCheckOut` dirty flip must not clobber OOO. Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

The desk can create rooms, flip cleanliness, assign a housekeeper from the roster, and refuse check-in to a unit whose `room.status` is `out_of_order`. It cannot take a room out of **inventory**. `availability_day.blocked` is in the freeze-gate DDL and in `freeAvailability`, and the occupancy snapshot already sums it — but nothing ever increments it. Marking `out_of_order` via `rooms.update_status` is the Phase 1 honesty the rooms vertical recorded: a housekeeping label, inert to ARI, bounded by the last `PLATFORM_GAPS` row.

That hole is now the product. A room “OOO” still sells. Check-in fails, booking does not. §7.1 calls that the same class of defect as an oversell.

The roster chunk unblocked the assign picker. The board still treats `out_of_order` as a cleanliness dropdown value, fails the whole board when roster GET errors, and has no filters / workload. Those are the cheap completions this chunk folds in.

### 1.1 What already exists (do not re-spec)

| Piece | Where (verified) |
|---|---|
| Ledger formula | `freeAvailability` (`packages/contracts/src/availability.ts` ~1–8): `physical - blocked - held - sold + oversell`. `commitSoldNightsSync` (`property-do.ts` ~4940) refuses when `firstUnavailableNight` finds `free < 1`. `held` is always 0 (§7.1 / §7.6). |
| `availability_day` | Freeze-gate DDL (`property-migrations.ts` ~9–18). `blocked INTEGER NOT NULL DEFAULT 0`. `reconcileHorizon` (~748) **INSERT**s missing days at `blocked = 0` and never overwrites an existing row’s `blocked`. |
| `room` | v11 (`property-migrations.ts` ~289–294). `status CHECK (clean \| dirty \| inspected \| out_of_order)`. Default `'clean'`. No OOO dates. |
| Status mutations | `rooms.update_status` / `bulk_update_status`: `QUEUE_PROVISIONAL`, `housekeeping:write`, no entitlement, events `room.status_changed` only (rooms vertical dropped the premature `availability.changed`). Extracted to `modules/pms/housekeeping` (`updateRoomStatus` ~4–32). Unrestricted among the four CHECK values. Last-writer-wins. **No `appendAuditLogSync`.** |
| Assign room | `reservations.assign_room` `FAIL_CLOSED`. `assertRoomAssignableSync` (~4408): `room.status === 'out_of_order'` → `RoomOutOfOrderError` (~4422). Overlap is half-open `[arrival, departure)` against `pending \| confirmed \| checked_in`. |
| Check-in | `tryCheckIn` (~6121): `out_of_order` → `ROOM_OUT_OF_ORDER` (no override). `dirty` + `pms.reservations.check_in_cleanliness === 'strict'` (default) + no `overrideCleanliness` → `ROOM_NOT_READY`. `clean` and `inspected` both allow. Stays `QUEUE_PROVISIONAL`. |
| Check-out dirty | `tryCheckOut` (~6260): if `reservation.room_id` set, **unconditionally** `UPDATE room SET status = 'dirty'` and emits `room.status_changed`. Would clobber OOO. |
| HK assign | `housekeeping.assign` `QUEUE_PROVISIONAL`, `housekeeping:write`, unbounded `businessDate`, upsert `(room_id, business_date)`, `gateStaffRef`. SPA picker already in `HousekeepingApp.tsx` (~212–235); `canAssign` = `housekeeping:write` (`HousekeepingScreen.tsx` ~23). Staff role has `housekeeping:write` **and** `roster:read` (`permissions.ts` ~121–123). |
| Occupancy snapshot | `snapshotReportsAsync` (~2617): `SUM(physical/sold/blocked/held)` for active types on the closing `stay_date`, plus `inHouseCount` / `confirmedCount` / `noShowCount` / `pendingCount`. `blocked` is in the JSON today; it is always 0. |
| Night audit | `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~724). `ROLL_BUSINESS_DATE` (~2890) advances `__meta.business_date`, calls `reconcileHorizon`, emits `availability.changed` only if rows were inserted. |
| Route head | `V1_HTTP_ROUTE_AUDIT[103] = post_folio_capture_due`. Next free **104**. |
| Migration head | `PROPERTY_MIGRATIONS` version **21** (`folio_money_ops`). Next free **22**. |
| Audit writers | `AUDIT_WRITER_COMMAND_IDS.size === 44`. `rooms.create` / `rooms.update` are in; status / assign / HK assign are not (ungated). |
| `PLATFORM_GAPS` | Only `rooms.set_ooo_range`. |
| Permissions | `inventory:write` = owner+admin (not staff). `housekeeping:write` = owner+admin+staff. `roster:read` = owner+admin+staff. No `housekeeping:inspect`. |

### 1.2 Scope in

1. `rooms.set_ooo_range` — per-room date range, explicit `blocked` delta, create / extend / early-release (§3).
2. Close the HK-label lie: `rooms.update_status` / bulk cannot write `out_of_order`; OOO rooms reject cleanliness writes until released (§3.6, §4).
3. Amend assign / check-in OOO gates to **stay ∩ range**, not only current status (§4). Flag vs lifecycle §4.2, not silent.
4. Amend `tryModifyReservation`: date (or type) change with `room_id` set re-runs assignability — physical overlap + OOO range. Closes a pre-existing double-book hole and the new OOO strand hole (§4.6).
5. Check-out dirty skip when the unit is OOO (§4.4).
6. HK board completion: drop OOO from the cleanliness dropdown; roster-error isolation; client-side filters; workload counts (§5). Picker itself already shipped.
7. Cleanliness depth: keep dirty → clean → inspected unrestricted among those three; optional `require_inspection` config default **false** (§6).
8. Room-status audit rows on HK status writes (non-entitled, same class as check-in) plus entitled audit on OOO (§7).

### 1.3 Scope out

- Maintenance work-order tickets (`pms_maintenance_tickets` is in `EXCLUDED_PROTOTYPE_KEYS`; `pms.maintenance` does not exist). Emit `room.ooo_changed`; do not open a ticket (§3.9).
- A second status **OOS** (out of service). One inventory-blocking status: OOO (§3.1).
- DND as a room status (§16.5 unnamed). Stay flag / comment; leftover 1.
- `rooms.delete` / archive of a physical unit (rooms-vertical leftover).
- Unassign (`room_id → NULL`). Room move = `reservations.assign_room` to a different unit, then OOO.
- Atomic move+OOO. Operator sequences them.
- Hibernating WebSocket tape chart (§7.7). Board stays React Query.
- HK budgeting, metrics dashboards, mobile attendant, manager-priorities tab, HK inventory (`pms_hk_manager_priorities` / `pms_hk_inventory` excluded). Workload is a count, not that tab.
- Shifts / capacity (roster leftover 7).
- Growing `NIGHT_AUDIT_STEPS`. Status sync folds into `ROLL_BUSINESS_DATE`; blocked on new horizon days folds into `reconcileHorizon`.
- Virtual room types, `held` behaviour, stop-sell-as-OOO.
- New permission `housekeeping:inspect` (leftover 2).

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **`blocked` is the OOO ledger, `physical` is not.** OOO increments `availability_day.blocked` for the room’s type across `[startDate, endDate)` (half-open, same as stays). It never decrements `physical`. A room marked OOO that still sells is a defect.
2. **Delta, not recompute.** Extending by two nights increments two rows. Early-release decrements the dropped nights. Never `UPDATE blocked = (SELECT COUNT(*))` as the write path. Recompute is allowed only as a test assertion and as the **INSERT** value for a brand-new horizon day (`reconcileHorizon`).
3. **Same atomic write.** Range row, `blocked` delta, `room.status` sync (when the open business date is in/out of the range), `availability.changed`, `room.ooo_changed`, and audit are one `transactionSync`. `{ ok: false }` leaves no partial ledger state. Ledger-state preconditions (`OOO_ROOM_ASSIGNED`; missing **in-horizon** `availability_day` row → `LedgerInconsistentError`) throw inside `runIdempotent` so the key stays retryable (§7.1 validate-then-mutate). Past-horizon nights are not a precondition failure (§3.4 step 7).
4. **OOO on an assigned room fails closed.** If any reservation in `pending | confirmed | checked_in` holds this `room_id` with stay overlap against the **new** nights being blocked, reject `OOO_ROOM_ASSIGNED`. Never silently strand a guest. Room move is `reservations.assign_room` first. Existing nights already in the range are not re-checked on a no-op / shrink.
5. **Housekeeping status writes do not touch inventory.** `rooms.update_status` / bulk accept only `clean | dirty | inspected`. `out_of_order` on those commands is `OOO_VIA_RANGE`. A room whose open-date range is active rejects cleanliness writes with `ROOM_OUT_OF_ORDER`.
6. **Assign, check-in, and date-changing modify consult ranges.** `assertRoomAssignableSync` / `tryCheckIn` / `tryModifyReservation` (when `room_id` is set and dates or type change) reject when any `room_ooo` overlaps the stay `[arrival, departure)`, not only when `room.status === 'out_of_order'`. Status remains defense-in-depth. `out_of_order` is still **not** overridable. Unchanged dates skip the re-check.
7. **`NIGHT_AUDIT_STEPS` stays seven.** Horizon INSERT of OOO-covered days is `reconcileHorizon`. Open-date status sync is `runRollStepSync` after the date advances. No eighth step. Occupancy snapshot shape is unchanged; `blocked` becomes non-zero.
8. **Inventory mutations are `FAIL_CLOSED`.** `rooms.set_ooo_range` matches `INVENTORY_FAIL_CLOSED_NOTES`. Cleanliness and HK assign stay `QUEUE_PROVISIONAL`.
9. **Staff cannot take a room out of inventory.** `rooms.set_ooo_range` is `inventory:write` (owner/admin). This is a behaviour change from the HK-label era, where staff could set `out_of_order` via `housekeeping:write`.
10. **New catalog commands** carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. New events appear in `event-consumer.ts`. New entitled writers go in `AUDIT_WRITER_COMMAND_IDS`.
11. **Route audit append-only.** New routes start at index **104**. Do not insert before `[103] = post_folio_capture_due`.
12. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
13. **`PLATFORM_GAPS` is empty after this chunk.** `register.test.ts` currently asserts the OOO row; flip it to `toEqual([])`.

---

## 3. `rooms.set_ooo_range`

§7.1: OOO is recorded per **room** with a date range; the ledger is per **room type**. Editing adjusts on the delta. Assigned in-house or arriving fails closed. An event is emitted so maintenance can later open a work order — this chunk emits the event; it does not invent the ticket (§3.9).

### 3.1 OOO vs OOS vs DND — one inventory status

Hotel vocabulary splits OOO (not sellable) from OOS (short HK hold, sometimes still in inventory) and DND (guest request). The schema has one extra status: `out_of_order`. Architecture uses “out of service” colloquially in the work-order sentence, not as a second discriminator.

**Lock: one inventory-blocking state, OOO.** OOS is not a second CHECK value and not a second command. Short “cannot sell, AC is dead” is OOO with a short range. DND is not a room status (leftover 1). Cleanliness (`dirty` / `clean` / `inspected`) stays orthogonal: a unit is OOO *or* in the cleanliness machine, never both.

### 3.2 Command

| | |
|---|---|
| id | `rooms.set_ooo_range` (promote off `PLATFORM_GAPS`) |
| `prototypeAction` | `null` — `PROTOTYPE_ACTIONS` has no `SET_OOO_RANGE` (prototype folded OOO into room-status / inventory screens). Notes record that null is “no prototype action to cite”, same family as `rooms.create`. |
| Lane | `INTERACTIVE` |
| Degraded | **FAIL_CLOSED** — reads assignment + horizon ledger then decides; not commutative with book / assign / another OOO. `notes: INVENTORY_FAIL_CLOSED_NOTES` |
| Idempotent | true; fingerprint `{ roomId, startDate, endDate, oooId? }` |
| Events | `room.ooo_changed`, `availability.changed`, `room.status_changed` (status event **only** when `room.status` actually flips) |
| Entitlement | `pms.core` |
| Permission | `inventory:write` |
| Audit | `AUDIT_WRITER_COMMAND_IDS` (size **45**) |

Input: `{ roomId, startDate, endDate, oooId?, reason?, idempotencyKey }`.

- `startDate` / `endDate` are StayDates (`STAY_DATE_RE`). Half-open `[startDate, endDate)` — `endDate` is the return date. `startDate < endDate` else `OOO_INVALID_RANGE`.
- **`startDate < openDate` (property `__meta.business_date`) → `OOO_INVALID_RANGE`** — cannot take a room OOO yesterday. On **create** this is the payload `startDate`. On **edit**, it applies to **newly added** nights only: a live range whose stored `startDate` is already in the past (created when that date was open, then rolled) may keep that `startDate` and extend/shrink `endDate`; pushing `startDate` earlier or adding any night `< openDate` is `OOO_INVALID_RANGE`.
- `endDate` may extend **past the current horizon end**. Those nights are stored on `room_ooo` and are not a book-style `UNBOOKABLE`; `reconcileHorizon` born-blocked (§3.5) applies them when the horizon rolls.
- `oooId` omitted → **create** (server mints `ooo_${uuid}`).
- `oooId` present → **edit** that row (extend, shrink, or shift). Missing row → `NOT_FOUND`.
- `reason` optional, trimmed, max 256 chars, plaintext. Empty / omitted → stored `NULL`. Not a work-order FK.

HTTP: `POST /v1/properties/:propertyId/rooms/:roomId/ooo`. `roomId` from the path; body must not send a conflicting `roomId`.

### 3.3 Schema — v22 `room_ooo`

Justify v22: `room.status` cannot encode a date range; `availability_day.blocked` is type-level, so the **source of the delta** must be per-room or extend/release recomputes (forbidden). `status_before` is required to restore cleanliness on release / roll. No freeze-gate rebuild — `availability_day.blocked` already exists.

```sql
CREATE TABLE room_ooo (
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
);
CREATE INDEX room_ooo_room_dates ON room_ooo (room_id, start_date, end_date);
```

**Multiple disjoint ranges per room are allowed.** Overlap (including identical) on the same room → `OOO_RANGE_OVERLAP`. Adjacent half-open ranges (`[D1, D2)` and `[D2, D3)`) are **not** overlap and are **not** auto-merged this chunk (leftover 3). Edit is per `oooId`, not a merge.

**`status_before` — one rule.** It is (re)captured from the **live** `room.status` at the moment a range first covers the open business date (create-covering-today, or roll-into-range), overwriting the create-time placeholder. It is never updated while any range covers the open date. The NOT NULL column still needs a value at INSERT: store the then-current cleanliness as a placeholder (so a future-start create of a `dirty` room has *something*). If HK flips cleanliness during the wait, first-cover overwrites the placeholder with whatever is live then — that is the restore target. Full release (edit that would make `startDate >= endDate`, or explicit end equal to start) **deletes** the row. Audit_log is the history. No historical archive table.

### 3.4 Delta algorithm (validate-then-mutate)

Inside `runIdempotent`, after permission / entitlement / format:

1. Load room. Missing → `NOT_FOUND`. Room type must be `active` else `NOT_FOUND` (same as create-room).
2. Resolve old range: none on create; the `oooId` row on edit (`room_id` must match path).
3. New range = `[startDate, endDate)`.
4. Overlap against **other** `room_ooo` rows for this room → `OOO_RANGE_OVERLAP`.
5. `nightsToAdd = new \ old`, `nightsToRemove = old \ new` (StayDate sets, half-open).
6. **Assignment conflict** on `nightsToAdd` only:

```sql
SELECT reservation_id FROM reservation
 WHERE room_id = ?
   AND status IN ('pending', 'confirmed', 'checked_in')
   AND arrival_date < ?   -- newEnd (or max of added nights’ exclusive end)
   AND departure_date > ? -- newStart (or min of added nights)
 LIMIT 1
```

   Tighten to the added span, not the whole new range: a shrink never fails this gate; an extend fails only if the **new** nights overlap an assigned stay. Hit → `OOO_ROOM_ASSIGNED` (payload may include `reservationId` in the RPC error string; HTTP body `{ error, reservationId? }`).
7. **`blocked` delta on `nightsToAdd`, split by the open horizon.** Let `horizonEnd` be the last `stay_date` `reconcileHorizon` guarantees for this type (`businessDate + (HORIZON_DAYS - 1)`). For each date in `nightsToAdd`:
   - `< openDate` → already rejected at §3.2 (`OOO_INVALID_RANGE`).
   - in `[openDate, horizonEnd]` → `availability_day` row **must** exist (`reconcileHorizon` inserts these). Missing → throw `LedgerInconsistentError` (corruption; inside `runIdempotent`; **not** cached; HTTP **409** as today’s mapper). Then `UPDATE … SET blocked = blocked + 1, version = version + 1`.
   - `> horizonEnd` → **skip**. No row exists to increment. The `room_ooo` row still stores the full `[startDate, endDate)`. `reconcileHorizon` born-blocked (§3.5) is load-bearing: those nights pick up `blocked` when the horizon rolls onto them. **Not** `UNBOOKABLE` — that code is “stay past horizon” on book/modify, not OOO.
8. For each date in `nightsToRemove`: same split. Past-horizon nights were never incremented → skip. In-horizon: row exists and `blocked >= 1` else throw `LedgerInconsistentError` (rolls back, not cached). Then `blocked = blocked - 1, version = version + 1`.
9. Upsert / delete `room_ooo`.
10. `syncOooStatusForRoomSync(roomId)` (§3.7).
11. If any **in-horizon** night was incremented or decremented: `bumpAriVersionSync` once; emit **one** `availability.changed` with `fromDate`/`toDate` = min/max of those in-horizon nights (not the skipped past-horizon tail), `roomTypeId` set. A create whose `nightsToAdd` are entirely past `horizonEnd` emits `room.ooo_changed` but **no** `availability.changed` this txn.
12. Emit `room.ooo_changed` `{ propertyId, roomId, roomTypeId, oooId, startDate, endDate, action: 'created' | 'updated' | 'released', reason }`. `released` when the row is deleted.
13. `appendAuditLogSync` `{ commandId: 'rooms.set_ooo_range', entityType: 'room', entityId: roomId, beforeJson: old range or null, afterJson: new range or null }`.

**Empty delta** (same range, same key): idempotent success, no second event, no second audit, `{ alreadyApplied: true }`.

**Free may go to zero or negative.** OOO of a vacant room while the type is fully `sold` (unassigned leftover demand) is allowed. New books fail via existing `free < 1`. Walking an unassigned guest is the operator’s oversell problem, not a new gate. Do not invent `OOO_WOULD_OVERSELL` this chunk (leftover 4 if product wants it).

`held` is unused (always 0). Stop-sell is `restriction_day`, not `blocked`. No interaction beyond the formula.

### 3.5 Horizon INSERT must be born blocked

`reconcileHorizon` (`property-do.ts` ~776) today inserts `blocked = 0`. After v22, the INSERT value for `blocked` is:

```sql
SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
 WHERE r.room_type_id = ?
   AND ooo.start_date <= ?   -- stayDate
   AND ooo.end_date > ?
```

Existing rows are still never overwritten (delta path owns them). Only **new** days pick up ranges that extend past the previous horizon end. This INSERT is the **only** writer for those past-horizon nights — the delta loop skipped them (§3.4 step 7). `runRollStepSync` already emits `availability.changed` when `insertedCount > 0`; that event now carries the correct `blocked`. If `insertedCount = 0` but status sync flipped rooms, do **not** bump ARI (status is not ARI).

`tryAddRoomType` horizon seed stays `blocked = 0` (no rooms yet).

Archiving a room type: `archiveBlocked` (`modules/pms/inventory/src/domain/guards.ts` ~15, called from `property-do.ts` ~4027) already treats `blocked > 0` as blocking. An OOO type cannot archive until ranges are released. No new code beyond tests.

### 3.6 `rooms.update_status` / bulk — cleanliness only

`ROOM_STATUSES` in `modules/pms/housekeeping/src/domain/room-status.ts` (~1) today includes `out_of_order`. Split:

```ts
export const CLEANLINESS_STATUSES = new Set(['clean', 'dirty', 'inspected']);
export const ROOM_STATUSES = new Set([...CLEANLINESS_STATUSES, 'out_of_order']); // SQL CHECK / reads
export function isCleanlinessStatus(value: string): boolean {
  return CLEANLINESS_STATUSES.has(value);
}
```

`tryUpdateRoomStatus` / bulk: `isCleanlinessStatus` else `OOO_VIA_RANGE` (not `'invalid_status'` — that stays for garbage strings). Inside the use case, if current `room.status === 'out_of_order'` → throw `RoomOutOfOrderError` (mapped `ROOM_OUT_OF_ORDER`). Do not UPDATE. Replay of a queued `out_of_order` write → `provisional_exception` `OOO_VIA_RANGE`.

SPA `STATUSES` dropdown drops `out_of_order` (`HousekeepingApp.tsx` ~3). OOO is a separate control gated on `inventory:write` (§5.3).

### 3.7 Status sync (open business date)

`room.status === 'out_of_order'` means: a `room_ooo` row covers the **open** `__meta.business_date`.

```
desiredOoo = EXISTS room_ooo WHERE room_id = ? AND start_date <= openDate AND end_date > openDate
```

| Current | Desired | Write |
|---|---|---|
| cleanliness | OOO | (re)capture `status_before` from live `room.status` (§3.3 one rule); `UPDATE room SET status = 'out_of_order'` |
| OOO | cleanliness | `UPDATE room SET status = status_before` of the covering-or-just-ended row |
| already matches | — | no `room.status_changed` |

Call sites:

1. End of `trySetOooRange` for that room (create with `startDate <= openDate`, or release that uncovers today).
2. `runRollStepSync` **after** `__meta.business_date` advances and `reconcileHorizon` returns — `syncOooStatusAllRoomsSync()` for rooms whose desired state changed. Idempotent with the step: a COMPLETED roll does not re-enter; a retried in-flight roll is the same txn outcome. Roll-into-range is the other first-cover moment: overwrite `status_before` from live cleanliness before flipping to `out_of_order`.

This is **not** a new night-audit step. It is occupancy-adjacent housekeeping of a derived flag. `SNAPSHOT_REPORTS` runs **before** roll and reads `availability_day.blocked`, not `room.status`, so close-out occupancy is unaffected by the flip.

Future-start ranges leave cleanliness intact until roll (or until a same-day create). Check-in / assign still refuse a stay that overlaps the future range (§4.1) even while status is `clean`.

### 3.8 Idempotency, events, degraded

Fingerprint `{ roomId, startDate, endDate, oooId? }`. Create without `oooId`: a second live call with a new key and the same dates hits `OOO_RANGE_OVERLAP` (not idempotent across keys — same as two creates of the same room code). Same key replays the cached success (including minted `oooId`).

Live PropertyDO outage → **503** `FAIL_CLOSED`, not queued. No `REPLAY_DISPATCH` entry.

### 3.9 Maintenance work order — event only

§7.1 rule 3: *“OOO emits an event that opens a `maintenance` work order.”* `pms.maintenance` is a §11 / §16.1 module that does not exist. Emitting `maintenance.work_order_opened` would be a catalog lie.

**Lock:** emit `room.ooo_changed` (reason in payload). The future maintenance module subscribes. Do not create a ticket table. Recorded divergence from a literal reading of §7.1, same class as §16.3 rule 4. Named leftover 5.

### 3.10 v22 backfill of HK-label OOO

Rows with `room.status = 'out_of_order'` and no `room_ooo` are the Phase 1 label. No production fleet; two tests currently **write** that label (`reservations-check-in.spec.ts` ~190, `reservations-lifecycle.spec.ts` ~723) and will switch to `trySetOooRange`.

Migration statements, after CREATE:

1. Insert one range per such room: `start_date = json_extract(property_config.value_json) of '__meta.business_date'` (unquoted StayDate), `end_date = start + HORIZON_DAYS` via a bounded date walk in the migration **or** (simpler, lock this) `end_date = date(start, '+365 days')` matching `HORIZON_DAYS = 365`.
2. `status_before = 'clean'` (unknown; the label era did not store it).
3. `UPDATE availability_day SET blocked = blocked + 1, version = version + 1` for each night in that range that exists. Do **not** fail the migration on assignment overlap — the label era allowed assigned+OOO. Operators fix with a room move + edit after deploy.

If `__meta.business_date` is unset (unprovisioned DO), skip backfill (no rooms in practice).

---

## 4. Assign, check-in, check-out, modify — flagged amendments

Lifecycle §4.2 locked: OOO is `room.status === 'out_of_order'`, no override; `clean`/`inspected` allow. That was correct when OOO was a label. It is **insufficient** once ranges exist: a `clean` room with OOO starting tomorrow night would check in a 3-night stay onto nights 2–3 that are blocked in ARI but not in the assign gate.

**Do not design around this silently.** The gates change as follows. Check-in stays `QUEUE_PROVISIONAL`.

### 4.1 `assertRoomAssignableSync` (assign + inline check-in assign)

After the existing type / current-status / overlap checks, add:

```sql
SELECT ooo_id FROM room_ooo
 WHERE room_id = ?
   AND start_date < ?   -- reservation.departureDate
   AND end_date > ?     -- reservation.arrivalDate
 LIMIT 1
```

Hit → `RoomOutOfOrderError` / `ROOM_OUT_OF_ORDER`. Keep the `room.status === 'out_of_order'` check as defense-in-depth (covers a lagging status before roll). Dirty pre-assign remains legal (lifecycle). `tryModifyReservation` reuses this helper when `room_id` is set and dates or type change (§4.6).

### 4.2 Check-in cleanliness table (amended)

| Room state | `check_in_cleanliness = 'strict'` (default) | `= 'off'` |
|---|---|---|
| `clean` | allow, unless `require_inspection` (§6) | allow, unless `require_inspection` |
| `inspected` | allow | allow |
| `dirty` | `ROOM_NOT_READY` unless override + config | allow |
| `out_of_order` **or** stay ∩ `room_ooo` | `ROOM_OUT_OF_ORDER` — **no override** | same — **no override** |

The status-only row in lifecycle §4.2 remains true for “currently OOO today”. The **or stay ∩ range** clause is the amendment.

### 4.3 Occupied (checked_in) and arriving

Covered by invariant 4: `OOO_ROOM_ASSIGNED`. No auto room-move. No OOO-with-force. `checked_out` / `cancelled` / `no_show` / `inquiry` do not hold the room (inquiry has no `room_id` in practice; if it did, it is not in the overlap status set).

### 4.4 Check-out dirty vs OOO

`tryCheckOut` (~6265) today always writes `dirty`. After this chunk: if `fromStatus === 'out_of_order'`, **skip** the UPDATE and skip `room.status_changed`. (Should be unreachable if invariant 4 held for the whole stay; defense in depth for the label-era hole and for a same-day OOO after cancel-check-in that kept `room_id`.) If cleanliness, keep dirty + event.

`cancel_check_in` already does not touch `room.status` (lifecycle §4.5). Unchanged.

### 4.5 Check-in replay

Widen nothing on the payload. Replay of check-in onto a room whose OOO range was created during the outage → `provisional_exception` `ROOM_OUT_OF_ORDER` (existing lifecycle table, now range-backed). Same for assign: assign is `FAIL_CLOSED`, so the desk cannot assign during outage; check-in with a remembered `roomId` is the remaining path.

### 4.6 Modify with an assigned room — close the hole

`tryModifyReservation` (`property-do.ts` ~5709) changes dates and/or type and adjusts `sold`. It does **not** `SELECT room_id`, does not call `assertRoomAssignableSync`, and does not check stay overlap against other reservations on that physical room. Today that can double-book a unit by extending dates. After this chunk it would also strand a stay inside an OOO range.

**Lock:** when the reservation has `room_id` set **and** (`arrivalDate` / `departureDate` changed **or** `roomTypeId` changed), re-run `assertRoomAssignableSync` against the **new** stay (and new type) **before** any `sold` write — same overlap SQL as assign (`pending | confirmed | checked_in` on that room, excluding self) plus stay ∩ `room_ooo`.

| Failure | Code |
|---|---|
| Another stay on that room overlaps the new dates | `ROOM_ALREADY_ASSIGNED` (existing assign code, now also a modify reject) |
| New stay ∩ `room_ooo`, or `room.status === 'out_of_order'` | `ROOM_OUT_OF_ORDER` |
| Assigned room’s type ≠ new `roomTypeId` | `ROOM_TYPE_MISMATCH` |

Widen the RPC/HTTP error union; map all three → **422** (already in `mapReservationCommandErrorStatus`). Throw inside `runIdempotent` so a later room-move / OOO-release leaves the key retryable.

**Unchanged dates and type** → existing cheap short-circuit (`property-do.ts` ~5789) returns before this check. Idempotent modify stays cheap.

Inquiry has no inventory commit and typically no `room_id`; if `room_id` is somehow set, the same assignability check still runs on a date/type change (inquiry is assignable only after confirm in today’s assign gate — `assertRoomAssignableSync` is status-agnostic on the *other* reservations; the modifying row is excluded by `reservation_id != ?`). Pending/confirmed are the real desk cases.

This is an **amend of the lifecycle spec’s modify contract**, not a silent extra. The missing physical-overlap check is a pre-existing defect this chunk closes with the same helper the OOO gate needs. Bidirectional one-liner in the lifecycle spec when this lands.

Modify stays `FAIL_CLOSED` (already). No `REPLAY_DISPATCH` change.

---

## 5. HK assign UX completion

Roster already minted `staff_…`, `gateStaffRef`, and the picker (`HousekeepingApp.tsx` ~212, tests 20 / 31 / 28). This chunk does **not** re-spec assign. It finishes the board.

### 5.1 Permission story

| Action | Permission | Staff role |
|---|---|---|
| See the board | `housekeeping:read` | yes |
| Flip cleanliness | `housekeeping:write` | yes |
| Assign a room | `housekeeping:write` (command) **and** `roster:read` (picker list) | both yes |
| Take / release OOO | `inventory:write` | **no** |

`canAssign` stays `housekeeping:write`. Add `canReadRoster = roster:read`. Picker renders only when `canAssign && canReadRoster`. Fabricated `me` with write and without read: no picker, no free-text (roster leftover already forbids text input). Do not grant `roster:read` a second meaning.

Assign command itself does not gain a `roster:read` check — `gateStaffRef` already hits OrgDO. A client that bypasses the picker with a known `staff_…` and `housekeeping:write` still works (staff role has both anyway).

### 5.2 Roster GET failure must not blank the board

Today `listRoster` throw paints `Unable to load housekeeping board` (`HousekeepingApp.tsx` ~160) even when rooms + assignments succeeded. **Lock:** rooms/assignments errors remain a board alert; roster error shows a picker-specific alert (*Unable to load housekeepers*) and hides the picker. Status dropdowns still work.

### 5.3 OOO control on the board (inventory:write)

No rooms inventory screen exists. The board is the room list. When `canSetOoo` (`inventory:write`):

- Read-only range text from `listRooms` additive field `oooRanges` (§8).
- Create: start / return date + optional reason → `POST …/ooo`.
- Early-release: confirm → POST with `oooId` and `endDate = openBusinessDate` (or tomorrow if still covering today — operator picks the return date; default the open date if `openDate > startDate`, else `startDate+1`).
- Staff / no inventory:write: see status `out_of_order` as text, not a dropdown option; no OOO form.

### 5.4 Filters (client-side)

`GET /rooms` already supports `roomTypeId` and `status` (`v1-dispatch.ts` ~2961, `listRooms` ~4626). The SPA does not pass them. **Lock client-side filters** on the already-fetched list (properties are tens of rooms, not thousands): status (incl. OOO), floor, assigned / unassigned for the selected business date. No new query params required. Optional: pass `status` through to GET when a single status is selected — not mandatory.

§7.7 WS deltas are out.

### 5.5 Workload (cheap)

No new route. From `assignments` for the selected date, `GROUP BY assigneeRef` in memory. Render a compact list: displayName (from roster map) or `staff_…`, count. Unassigned room count = `rooms.length - assignedRooms`. This is **not** the prototype manager-priorities tab (`pms_hk_manager_priorities` excluded).

---

## 6. Cleanliness flow depth

Today: unrestricted among four CHECK values; check-in treats `clean` and `inspected` as ready; anyone with `housekeeping:write` can set `inspected`; there is no inspect permission.

**Lock:**

```
dirty ⇄ clean ⇄ inspected     (housekeeping:write, QUEUE_PROVISIONAL, last-writer-wins)
any cleanliness → OOO         (inventory:write, set_ooo_range only)
OOO → status_before           (release / roll)
check-out: cleanliness → dirty (skip if OOO)
```

No required inspect-after-clean path unless config is on.

| Key | Class | Schema | Default | Consumers |
|---|---|---|---|---|
| `pms.housekeeping.require_inspection` | DOMAIN | `z.boolean()` | `false` | `consumersExempt: true` (does not invalidate ARI) |

When `true` **and** `check_in_cleanliness === 'strict'`: `clean` behaves like `dirty` (`ROOM_NOT_READY` unless `overrideCleanliness` + `allow_dirty_check_in_override`). `inspected` still allows. `off` still allows `clean`. Default `false` preserves lifecycle §4.2 exactly for cleanliness.

Who may inspect: **`housekeeping:write`**, status quo. Supervisor-only inspect is leftover 2 (would need a new permission and a ROLE_GRANTS edit; staff today can mark inspected on the board).

---

## 7. Room-status audit depth

Entitled writers must be in `AUDIT_WRITER_COMMAND_IDS`. Status / bulk / HK assign are ungated `QUEUE_PROVISIONAL`, so they stay **off** that set (same as `reservations.check_in` after lifecycle added `appendAuditLogSync` without joining the set).

**Lock:** `updateRoomStatus` / `bulkUpdateRoomStatus` call `appendAuditLogSync` from the **DO binder** (module must not import audit). One row per room: `commandId: 'rooms.update_status'` (bulk uses `'rooms.bulk_update_status'`), `entityType: 'room'`, `entityId: roomId`, `beforeJson: { status }`, `afterJson: { status }`. Actor from the DO preamble. Provisional extras already ride outbox, not audit.

`housekeeping.assign` already has an event; add the same audit shape `{ roomId, businessDate, assigneeRef }` — names never on PropertyDO (roster invariant). Folded in because the board is otherwise an unaudited write surface.

OOO is entitled → set membership, size 45.

---

## 8. Reads — additive `listRooms`

`GET /rooms` remains `housekeeping:read`, `FAIL_CLOSED`, entitlement `pms.core`. Additive fields on each room:

```ts
oooRanges: Array<{
  oooId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}>
```

All current ranges for that room (few). No new GET. Tape-chart consumers later can ignore the field. `status` filter `out_of_order` still means current `room.status`, not “has a future range”.

---

## 9. State machines

### 9.1 Room status × OOO range

```
create room                    → clean, no range
HK: dirty / clean / inspected  → cleanliness only
set_ooo covering open date     → out_of_order, blocked += in-horizon nights, status_before (re)captured
set_ooo future-only            → cleanliness unchanged, blocked += in-horizon nights; past-horizon stored
ROLL into range                → out_of_order; status_before overwritten from live cleanliness
ROLL / release out of range    → status_before, blocked -= dropped nights
check-out                      → dirty (if not OOO)
```

### 9.2 Inventory vs stay

```
book type                      → sold += 1 (blocked unchanged)
OOO vacant room                → blocked += 1; sold unchanged
OOO assigned room              → OOO_ROOM_ASSIGNED
assign onto OOO-overlapping stay → ROOM_OUT_OF_ORDER
check-in onto OOO              → ROOM_OUT_OF_ORDER
modify dates into OOO / other stay on same room → ROOM_OUT_OF_ORDER / ROOM_ALREADY_ASSIGNED
```

---

## 10. Wire codes

New constants in `packages/contracts/src/idempotency.ts`:

| Constant | Value | HTTP |
|---|---|---|
| `OOO_VIA_RANGE` | `ooo_via_range` | 422 |
| `OOO_ROOM_ASSIGNED` | `ooo_room_assigned` | 422 |
| `OOO_RANGE_OVERLAP` | `ooo_range_overlap` | 422 |
| `OOO_INVALID_RANGE` | `ooo_invalid_range` | 422 |

Reuse: `NOT_FOUND` → 404; `ROOM_OUT_OF_ORDER` / `ROOM_ALREADY_ASSIGNED` / `ROOM_TYPE_MISMATCH` → 422; `LEDGER_INCONSISTENT` → **409** (existing mapper, `v1-dispatch.ts` ~242; not cached); `IDEM_KEY_REUSED` unchanged; `FORBIDDEN` → 403 (`inventory:write` / staff); kill-switch / entitlement → 503.

`UNBOOKABLE` is **not** an OOO wire code. Book/modify past the horizon still use it; OOO past the horizon is skip + born-blocked (§3.4 step 7).

Map the four new codes in `mapReservationCommandErrorStatus` (or the rooms sibling — today rooms already share that mapper, `v1-dispatch.ts` ~241).

---

## 11. Command catalog

| id | Lane | Degraded | Idempotent | Events | Entitlement | Permission |
|---|---|---|---|---|---|---|
| `rooms.set_ooo_range` | INTERACTIVE | FAIL_CLOSED | true | `room.ooo_changed`, `availability.changed`, `room.status_changed` | `pms.core` | `inventory:write` |
| `rooms.update_status` | INTERACTIVE | QUEUE_PROVISIONAL | true | `room.status_changed` | — | `housekeeping:write` |
| `rooms.bulk_update_status` | BULK | QUEUE_PROVISIONAL | true | `room.status_changed` | — | `housekeeping:write` |
| `housekeeping.assign` | INTERACTIVE | QUEUE_PROVISIONAL | true | `housekeeping.assigned` | — | `housekeeping:write` |

`rooms.update_status` / bulk / assign: **no catalog class change**. Notes on `rooms.set_ooo_range`: `INVENTORY_FAIL_CLOSED_NOTES` plus the `prototypeAction: null` sentence. Notes on `rooms.update_status`: one line that `out_of_order` is not a legal payload (`OOO_VIA_RANGE`).

Drop `{ id: 'rooms.set_ooo_range', reason: 'Explicit OOO delta on blocked' }` from `PLATFORM_GAPS`.

---

## 12. Route table (append-only from 104)

| Index | id | Method / pattern | Permission | Command |
|---|---|---|---|---|
| 104 | `post_room_ooo_range` | `POST /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/ooo$/` | `inventory:write` | `rooms.set_ooo_range` |
| 103 | `post_folio_capture_due` | unchanged pin | | |

No new GET. `get_rooms` body grows `oooRanges` (additive, not a new audit row).

`[103]` must remain `post_folio_capture_due`. `register.test.ts` pin: `[104] = post_room_ooo_range`; `AUDIT_WRITER_COMMAND_IDS.size === 45`; `PROPERTY_SCHEMA_HEAD === 22`; `PLATFORM_GAPS` empty; `NIGHT_AUDIT_STEPS.length === 7`.

---

## 13. Config

| Key | Class | Schema | Default | Notes |
|---|---|---|---|---|
| `pms.housekeeping.require_inspection` | DOMAIN | `z.boolean()` | `false` | `consumersExempt: true`. Prototype has no 1:1 key; `prototypeKey: null`. |

Existing `pms.reservations.check_in_cleanliness` / `allow_dirty_check_in_override` unchanged.

---

## 14. Occupancy snapshot / night audit

Snapshot JSON is **not** extended. `blocked` already exists (`night-audit-e2e-design.md` §3.3; `property-do.ts` ~2673). After this chunk a property with one OOO room covering D shows `blocked === 1` (per type-night; two OOO rooms of the same type covering D → `blocked === 2`). OOO rooms are **not** in `inHouseCount` (cannot be checked in) and are not subtracted from `physical`.

Do not add `oooCount`. Do not change STR-style occupancy math in OLTP; warehouse trends stay warehouse (§7.8).

`NIGHT_AUDIT_STEPS` still:

```
PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → CLOSE_CASHIER_SHIFTS
  → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE
```

`POST_ROOM_CHARGES` is unchanged (prices stays, not rooms). An OOO vacant room posts nothing.

---

## 15. Degraded-mode summary

| Command | Live outage | Replay |
|---|---|---|
| `rooms.set_ooo_range` | 503 FAIL_CLOSED | n/a |
| `rooms.update_status` / bulk | 202 queue | cleanliness-only; `OOO_VIA_RANGE` / `ROOM_OUT_OF_ORDER` → `provisional_exception` |
| `housekeeping.assign` | 202 queue (PropertyDO); OrgDO down → 503 `org_unreachable` (roster, unchanged) | unchanged |
| `reservations.check_in` | 202 queue | range OOO → exception `ROOM_OUT_OF_ORDER` |
| `reservations.assign_room` | 503 FAIL_CLOSED | n/a |
| `reservations.modify` (date/type change, `room_id` set) | 503 FAIL_CLOSED (unchanged class); new rejects `ROOM_OUT_OF_ORDER` / `ROOM_ALREADY_ASSIGNED` / `ROOM_TYPE_MISMATCH` | n/a |
| `GET /rooms` / HK assignments | 503 FAIL_CLOSED | n/a |

Never invent stock during outage (invariant 8). Never queue OOO.

---

## 16. Open questions — resolved

1. **OOO vs OOS. Resolved: one status, OOO.** OOS is not a CHECK value. Short vs long is the range.
2. **Occupied / assigned. Resolved: reject `OOO_ROOM_ASSIGNED`.** Room move first. No force flag. No atomic move+OOO.
3. **Future-dated OOO. Resolved: allowed.** `blocked` applies immediately on existing horizon nights; `room.status` flips when the open date is covered (command or roll).
4. **`rooms.update_status` to OOO. Resolved: forbidden (`OOO_VIA_RANGE`).** Closes the HK-label lie. Staff lose the dropdown; owners/admins use `inventory:write`.
5. **Check-in / assign gate. Resolved: stay ∩ range, plus status defense-in-depth.** Explicit amendment of lifecycle §4.2, not a silent extra.
6. **Check-out dirty vs OOO. Resolved: skip.** Defense in depth.
7. **Free negative. Resolved: allow.** Oversell class; no `OOO_WOULD_OVERSELL`.
8. **Multiple ranges. Resolved: disjoint allowed; overlap rejected; no auto-merge.**
9. **Work order. Resolved: `room.ooo_changed` only.** Maintenance module leftover.
10. **Inspect required. Resolved: config default `false`.** Who inspects = `housekeeping:write`.
11. **DND. Resolved: not a room status.** Leftover 1; §16.5 decision recorded here.
12. **Picker. Resolved: already shipped; this chunk is filters + workload + roster-error isolation + OOO control + drop OOO from cleanliness.**
13. **Audit. Resolved: entitled OOO in the set (size 45); HK status/assign `appendAuditLogSync` without joining the set.**
14. **v22 backfill. Resolved: label-era `out_of_order` → range `[open, open+365)` + blocked increment; `status_before = 'clean'`; do not fail on assignment.**
15. **Roll sync. Resolved: fold into `runRollStepSync`, not a new step.**
16. **SPA home for OOO. Resolved: housekeeping board, gated on `inventory:write`.** No new nav entry.
17. **Horizon vs delta. Resolved: `startDate < openDate` → `OOO_INVALID_RANGE`; in-horizon missing row → `LedgerInconsistentError`; past-horizon nights skipped and born-blocked on roll. Not `UNBOOKABLE`.** Edit of a live range may keep a now-past `startDate`; newly added nights before open are still invalid.
18. **Modify assigned room. Resolved: date or type change with `room_id` set re-runs `assertRoomAssignableSync`.** Unchanged dates+type stay on the cheap short-circuit. Closes the pre-existing physical double-book hole and the OOO strand hole. Amend of the lifecycle modify contract.

None left open.

---

## 17. Test matrix

Names are the acceptance list, not a file-split mandate. Fixture dates from property-local `business_date`. Shared-storage tests use `crypto.randomUUID()`.

**OOO create / ledger**

1. Vacant room, range `[open, open+3)` → `blocked += 1` on those three nights only; `physical` unchanged; `sold` unchanged; `room.status = 'out_of_order'`; `availability.changed` once; `room.ooo_changed` `action: 'created'`; ARI `free` down by 1; `PLATFORM_GAPS` empty.
2. Same idempotency key replay → `{ alreadyApplied: true }` (or equivalent success); no second outbox; no second audit; `blocked` still +1.
3. Book the type for a blocked night → `NO_AVAILABILITY`; book a night after `endDate` → succeeds.
4. Future-only range (`startDate = open+5`, `endDate = open+8`) → `room.status` stays `clean`; those three nights `blocked += 1`; assign a stay overlapping that span → `ROOM_OUT_OF_ORDER`; assign a stay that ends on `startDate` (half-open adjacent) → succeeds.
5. Two disjoint ranges on one room → both apply; overlapping second create → `OOO_RANGE_OVERLAP`; `blocked` unchanged on overlap failure.
6. `startDate >= endDate` → `OOO_INVALID_RANGE`.
7. **Past-start create** (`startDate < openDate`, `endDate > startDate`) → `OOO_INVALID_RANGE`; no `room_ooo` row; `blocked` unchanged.
8. Unknown `roomId` / archived type → `NOT_FOUND`.
9. Staff actor → 403 `inventory:write`.
10. PropertyDO transport blocked → 503 FAIL_CLOSED, not 202; no `room_ooo` row.
11. Kill-switch `pms.core` → 503.

**Extend / early-release**

12. Extend `endDate` by two nights → those two `blocked += 1`; earlier nights unchanged; `action: 'updated'`.
13. Early-release (shrink `endDate`) → dropped nights `blocked -= 1`; if open date no longer covered, `room.status` restores `status_before`.
14. Full release (delete row) → all nights decremented; `action: 'released'`; status restored; second release of missing `oooId` → `NOT_FOUND`.
15. Extend onto a night with an assigned `confirmed` reservation on that room → `OOO_ROOM_ASSIGNED`; no ledger change. Move via `assign_room`, then extend succeeds.
16. `checked_in` on the room, OOO covering today → `OOO_ROOM_ASSIGNED`. `cancel_check_in` (keeps `room_id`) then OOO still `OOO_ROOM_ASSIGNED` until `assign_room` moves it.
17. `pending` assigned overlap → `OOO_ROOM_ASSIGNED`. `cancelled` leftover `room_id` does **not** block (status not in the set).

**Horizon / roll / snapshot**

18. **Past-horizon create + roll (create half + test-17 roll half).** Range `[open, horizonEnd+3)` succeeds (not `UNBOOKABLE`). Every in-horizon night `blocked += 1`. Nights `> horizonEnd` have **no** `availability_day` row yet (`SELECT COUNT` = 0). After `ROLL_BUSINESS_DATE` inserts the new last day, that day is born with `blocked = 1` (not 0). `NIGHT_AUDIT_STEPS.length === 7`.
19. Future-start range; roll until `openDate === startDate` → `room.status` becomes `out_of_order` without a second OOO command; `status_before` overwritten from live cleanliness at first cover.
20. `SNAPSHOT_REPORTS` with one OOO covering D → occupancy JSON `blocked === 1`, `physical` unchanged, `inHouseCount` unchanged vs control without OOO. Shape keys unchanged.
21. `reconcileHorizon` re-run inserts nothing and does not rewrite `blocked` on existing days (delta path still owns them).

**HK status / cleanliness / check-in**

22. `POST …/status` `{ status: 'out_of_order' }` → 422 `OOO_VIA_RANGE`; `blocked` unchanged; status unchanged.
23. Bulk including one `out_of_order` → all-or-nothing fail; no row changed.
24. OOO room, `POST …/status` `{ status: 'clean' }` → `ROOM_OUT_OF_ORDER`.
25. Lifecycle regression: dirty + strict + no override → `ROOM_NOT_READY`; dirty + override → checked_in; OOO range + `overrideCleanliness` → `ROOM_OUT_OF_ORDER` (rewrite tests 28 / assign-OOO off `tryUpdateRoomStatus`).
26. Stay overlaps a **future** range, current status `clean` → check-in `ROOM_OUT_OF_ORDER`; assign `ROOM_OUT_OF_ORDER`.
27. `require_inspection = true`, strict, status `clean` → `ROOM_NOT_READY`; `inspected` → allow. Default config: `clean` still allows (lifecycle preserved).
28. Check-out of a cleanliness room → `dirty` + `room.status_changed`. Check-out skip when status is OOO (fixture: label-era inconsistency **or** a test-only raw status if invariant 4 makes this unreachable — if unreachable, assert via a documented test hook, not a product path).
29. Queued `update_status` to `out_of_order` then drain → `provisional_exception` `OOO_VIA_RANGE`.
30. Status flip dirty→clean writes `audit_log` with from/to; not in `AUDIT_WRITER_COMMAND_IDS`.

**Modify (assigned room)**

31. Assigned stay `[open+1, open+3)`; future OOO on that room `[open+4, open+6)`; modify extends departure to `open+5` → `ROOM_OUT_OF_ORDER`; `sold` unchanged; dates unchanged.
32. Same fixtures; modify with **unchanged** dates (and type) → success (cheap short-circuit); no assignability read required.
33. Two confirmed stays on different dates, same room (adjacent half-open); modify extends the earlier stay into the later stay’s range → `ROOM_ALREADY_ASSIGNED`; `sold` unchanged. (Pre-existing physical double-book hole, closed by §4.6.)

**Assign UX / board**

34. Staff: cleanliness dropdown has no `out_of_order`; no OOO form; picker visible (write + roster:read).
35. Owner: OOO form present; create range from the board; board shows range text.
36. Roster GET failure: rooms table still renders; picker hidden; alert is housekeeper-specific, not “Unable to load housekeeping board”.
37. Client filter status=`dirty` hides clean rows; assigned/unassigned filter uses the selected business date.
38. Workload: two rooms assigned to Ada, one unassigned → Ada count 2, unassigned 1. No new HTTP route.
39. Picker regressions (roster tests 20 / 31 / 28) stay green; no text input.

**Pins / gates**

40. `AUDIT_WRITER_COMMAND_IDS.size === 45`; `[103]` unchanged; `[104] = post_room_ooo_range`.
41. `PROPERTY_SCHEMA_HEAD === 22`; real-SQLite: overlapping insert of two `room_ooo` on one room allowed by SQL (application rejects); `CHECK (start_date < end_date)` rejects equal dates; FK to `room` holds.
42. `check:degraded` / `check:entitlements` / `check:permissions` / `check:ddl` / `check:pms-core-test-dates` / `check:do-transport-guards` green.
43. `event-consumer.ts` allowlists `room.ooo_changed`.
44. v22 backfill: a pre-v22 fixture with `status = 'out_of_order'` and `blocked = 0` migrates to a range and `blocked >= 1` on open-horizon nights.

---

## 18. File map (implementation, not a plan)

| File | Role |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` + `0022_room_ooo.sql` | v22 `room_ooo` + backfill |
| `packages/do-runtime/src/migrate.test.ts` | Head 22; statement presence |
| real-SQLite test (new, folio pattern) | CHECK / FK |
| `packages/contracts/src/commands/catalog.ts` | Promote command; drop last PLATFORM_GAPS; status notes |
| `packages/contracts/src/commands/audit-writers.ts` | +1; size 45 |
| `packages/contracts/src/idempotency.ts` | Four wire codes |
| `packages/contracts/src/config/register.ts` | `require_inspection` |
| `packages/contracts/src/v1-http-routes.ts` | `[104] = post_room_ooo_range` |
| `packages/contracts/src/register.test.ts` | Pins; `PLATFORM_GAPS` empty |
| `modules/pms/housekeeping/src/domain/room-status.ts` | `CLEANLINESS_STATUSES`; `isCleanlinessStatus` |
| `modules/pms/housekeeping/src/application/update-room-status.ts` (+ bulk) | Reject OOO current status; cleanliness-only payload |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | Dropdown; filters; workload; roster-error isolation; OOO form |
| `apps/pms-core/src/property-do.ts` | `trySetOooRange`; delta helper; `reconcileHorizon` INSERT blocked; `syncOooStatus*` in roll; `assertRoomAssignableSync` range; check-in range; check-out skip; **`tryModifyReservation` assignability when `room_id` set and dates/type change**; listRooms `oooRanges`; audit binder for status/assign |
| `apps/pms-core/src/v1-dispatch.ts` | POST ooo; error map; GET rooms passthrough |
| `apps/pms-core/src/event-consumer.ts` | `room.ooo_changed` |
| `apps/pms-core/src/pending-commands-consumer.ts` | No new dispatch id |
| `apps/web-pms/src/screens/HousekeepingScreen.tsx` | `canReadRoster` / `canSetOoo` |
| Specs | One-sentence amends in rooms-vertical, lifecycle, folio (PLATFORM_GAPS line), housekeeping-module §4.2 |

OOO does **not** move into the housekeeping module (`availability_day` is not in its write-set; inventory:write ≠ HK ownership). Optional later extract into `modules/pms/inventory` — not this chunk.

---

## 19. Leftovers (named, not silent)

1. **DND** — §16.5 unnamed. Not a `room.status`. Stay flag / front-office comment if product wants it. This chunk records **defer**. [Prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) **keeps** `reservation.dnd_flag` as that stay flag and still does not add `dnd` to `room.status`.
2. **Supervisor-only inspect** — would need `housekeeping:inspect` (or roster kind) and a ROLE_GRANTS change. Staff can mark `inspected` today; kept.
3. **Auto-merge adjacent OOO ranges** — application overlap is the only constraint; two adjacent rows stand.
4. **`OOO_WOULD_OVERSELL` gate** — taking the last vacant room OOO while `sold` fills the type. Allowed this chunk (oversell class).
5. **Maintenance work orders** — consume `room.ooo_changed`; freeze-gate / module when `pms.maintenance` exists. Architecture §7.1 rule 3 is event-shaped until then.
6. **`rooms.delete` / physical-unit archive** — rooms-vertical leftover; count invariant still has no delete path.
7. **Unassign / atomic move+OOO.**
8. **Hibernating WebSocket operational reads** (§7.7) — closed by [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md).
9. **HK manager priorities / budgeting / mobile attendant / HK inventory** — extra tabs; `pms_hk_*` excluded keys. Workload counts are not that surface.
10. **Shifts / capacity** — roster leftover 7.
11. **`pms.ops.auto_assign_rooms`** — lifecycle leftover 3; unread.
12. **Virtual room types** — §7.1; OOO is physical-type `blocked` only.

---

## 20. Implementation checklist

- [ ] v22 `room_ooo` + backfill; `pnpm generate:ddl`; `PROPERTY_SCHEMA_HEAD === 22`; real-SQLite CHECK/FK.
- [ ] `trySetOooRange` validate-then-mutate delta; `startDate < openDate` → `OOO_INVALID_RANGE`; in-horizon missing → `LedgerInconsistentError`; past-horizon skip; events; audit; `INVENTORY_FAIL_CLOSED_NOTES`.
- [ ] `reconcileHorizon` INSERT `blocked` from `room_ooo` count (load-bearing for past-horizon tails); roll status sync + `status_before` recapture; no eighth night-audit step.
- [ ] `assertRoomAssignableSync` + `tryCheckIn` stay ∩ range; `tryModifyReservation` re-check when `room_id` set and dates/type change; `tryCheckOut` skip dirty on OOO.
- [ ] HK module cleanliness-only status; DO binder audit on status/assign.
- [ ] Catalog promote; `PLATFORM_GAPS` empty; audit-writers 45; routes `[104]`; `room.ooo_changed` allowlist; `require_inspection`.
- [ ] `listRooms` `oooRanges`; SPA: dropdown, filters, workload, roster-error isolation, OOO form gated on `inventory:write`.
- [ ] Rewrite check-in test 28 and lifecycle assign-OOO off `tryUpdateRoomStatus`.
- [ ] Bidirectional one-liners in rooms-vertical / lifecycle / folio / housekeeping-module specs.
- [ ] Test matrix §17; `pnpm build`, `check:ddl`, `check:entitlements`, `check:permissions`, `check:degraded`, `check:pms-core-test-dates`, `check:do-transport-guards`, `check:class-denylist`, `typecheck`, package tests, `pnpm lint`.

---

## 21. Acceptance (reviewer checklist)

- [ ] Last `PLATFORM_GAPS` row is gone. OOO increments `blocked`, never `physical`. Delta, not recompute. Horizon INSERT is born blocked. Past-horizon create is not `UNBOOKABLE`; past-start is `OOO_INVALID_RANGE`.
- [ ] Assigned `pending | confirmed | checked_in` overlap rejects `OOO_ROOM_ASSIGNED`. No silent strand. No auto move.
- [ ] `rooms.update_status` cannot write `out_of_order`. Staff cannot OOO (`inventory:write`).
- [ ] Check-in / assign / date-changing modify consult stay ∩ range; OOO still has no override. Unchanged-date modify stays cheap. Lifecycle cleanliness default preserved (`require_inspection` default false).
- [ ] Check-out does not clobber OOO. Check-in stays `QUEUE_PROVISIONAL`. OOO is `FAIL_CLOSED`.
- [ ] `NIGHT_AUDIT_STEPS` still 7. Occupancy snapshot shape unchanged; `blocked` non-zero under OOO. Status sync lives in `ROLL_BUSINESS_DATE`. `status_before` recaptured at first cover, never while covering.
- [ ] `room.ooo_changed` is the maintenance seam; no ticket table.
- [ ] Picker still roster-sourced; board survives roster GET failure; workload is a count; OOO UI on the board for admin/owner.
- [ ] Audit: entitled OOO in the set (45); HK status/assign audited without joining the set.
- [ ] Routes append at 104; schema 22; fixture-date discipline; open questions section has zero unresolved items.
- [ ] Out of scope includes OOS-as-second-status, DND-as-status, WS tape chart, `rooms.delete`, work-order module, eighth night-audit step.
