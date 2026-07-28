# Reservations create + availability.book (Phase 0 → Phase 1 entry)

**Date:** 2026-07-27  
**Status:** Approved for implementation (post night-audit horizon)  
**Sources:** ARCHITECTURE.md §7.1, §10.1; command catalog `reservations.create`; platform gap `availability.book`

## Purpose

Prove the first **sell** through the frozen ledger: `reservations.create` inserts a reservation and increments `availability_day.sold` for every stay night in **one atomic PropertyDO write**, with idempotency and outbox events. This closes “inventory → availability is bookable in code,” not just in theory.

## Scope

**In**

- Package `modules/pms/reservations` (`@hospai/pms-reservations`): pure stay-date helpers + bookability checks; public surface = `index.ts`
- PropertyDO migration **v4**: `reservation` table (minimal confirmed stays)
- Wire codes in `@hospai/contracts`: `no_availability`, `unbookable` (missing ledger row), reuse `timezone_unset`, `not_found`
- PropertyDO command: `tryCreateReservation` via `runIdempotent` + `transactionSync`
- **`availability.book` semantics inside the same txn** — not a separate public RPC; catalog gap closed by implementation
- Read `pms.availability.allow_overbooking` + `pms.availability.oversell_allowance` **inside the txn** (stored rows only — no register default for timezone)
- Events: `reservation.created`, `availability.changed` (range = stay nights)
- Tests: provision → add room type → book → sold increments; oversell refused; missing row refused; idempotency replay; archived type refused
- Remove `availability.book` from `PLATFORM_GAPS` when shipped

**Out**

- Holds (`held` column stays 0 — §7.6 behaviour deferred)
- `restriction_day` evaluation (CTA/MinLOS/stop-sell) — follow-on before channel/OTA
- Rates / folio / guest PII / room assignment
- HTTP route (DO RPC + vitest only, same as inventory)
- Queues `EVENTS_QUEUE` binding (follow-on immediately after; in-DO `flushOutbox` remains valid)
- `reservations.cancel` / modify (separate slices)

## Invariants

1. **Ledger is source of truth.** Never derive availability by scanning reservations. Book path reads `availability_day` only.
2. **Same atomic write.** Reservation row + `sold` increments + outbox + idempotency in one `transactionSync`; no `await` inside `runIdempotent`.
3. **Stay dates are StayDate strings (`YYYY-MM-DD`).** Nights = `[arrival, departure)` — departure is check-out morning (exclusive). One room, `units = 1` this slice.
4. **Missing `availability_day` row = unbookable** (`unbookable`), not infinite free (inventory invariant 5).
5. **Free check uses `freeAvailability` + config allowance:**
   - `free = physical - blocked - held - sold + row.oversell`
   - If `allow_overbooking` (stored DOMAIN row): add `oversell_allowance` from stored config to the effective ceiling for the check only (do not persist on the row in this slice).
   - If `free < 1` for any night → `no_availability` with first offending date.
6. **Timezone:** require stored `pms.time.time_zone` row for any command that validates “today” boundaries later; for create, stay dates are client-supplied StayDates — still require timezone row present (consistent with inventory fail-closed).
7. **Active room type only.** `room_type.status = 'archived'` → `not_found` / reject.
8. **Fingerprints edge-computed** from `{ reservationId, roomTypeId, arrivalDate, departureDate }`.
9. **Idempotency replay** returns stored response; no double increment of `sold`.
10. **Property ARI version** bumps once per successful book; stamped on `availability.changed`.

## Module layout

```
modules/pms/reservations/
  package.json
  src/index.ts
  src/domain/
    stay-dates.ts       # enumerateStayDates(arrival, departure): string[]
    bookability.ts      # assertBookable(rows, allowance): first short date | null
```

Domain imports `@hospai/contracts` (`freeAvailability`) only — no platform packages.

## Data model

### `reservation` (migration v4)

```sql
CREATE TABLE reservation (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,   -- first stay night (inclusive)
  departure_date   TEXT NOT NULL,   -- check-out date (exclusive)
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX reservation_room_type_idx ON reservation (room_type_id);
CREATE INDEX reservation_arrival_idx ON reservation (arrival_date);
```

No FK to `room_type` (consistent with v2 inventory — soft enforcement in command).

## Command: `tryCreateReservation`

**Input:** `IdempotencyKey`, `{ reservationId, roomTypeId, arrivalDate, departureDate }`

**Steps (sync, one txn on cache miss):**

1. Validate dates: `arrivalDate < departureDate`; both match `YYYY-MM-DD`.
2. Require stored timezone (`timezone_unset` if absent).
3. Load active `room_type`; else `not_found`.
4. `nights = enumerateStayDates(arrival, departure)`.
5. For each night, load `availability_day` row. Missing row → `unbookable` (first date).
6. Read stored `allow_overbooking` + `oversell_allowance` (boolean + int; no register default substitution for timezone-class keys — use stored row or register default for these two is OK per config read path in PropertyDO `readConfig`).
7. If any night fails bookability → `{ ok: false, error: 'no_availability', date }`.
8. `UPDATE availability_day SET sold = sold + 1, version = version + 1` for each night.
9. `INSERT reservation (...)`.
10. Bump `__meta.ari_version`.
11. Outbox: `reservation.created`, `availability.changed`.

**Fingerprint body:** `{ reservationId, roomTypeId, arrivalDate, departureDate }`

## Event payloads

```ts
// reservation.created
{ propertyId, reservationId, roomTypeId, arrivalDate, departureDate, status: 'confirmed' }

// availability.changed
{ propertyId, roomTypeId, fromDate: arrivalDate, toDate: lastNight, version /* ARI counter */ }
```

## Catalog / gaps

- `reservations.create` already in catalog with events `reservation.created`, `availability.changed`.
- Remove `{ id: 'availability.book', ... }` from `PLATFORM_GAPS` when this ships.

## Wire codes

```ts
export const NO_AVAILABILITY = 'no_availability' as const;
export const UNBOOKABLE = 'unbookable' as const;
// reuse TIMEZONE_UNSET, NOT_FOUND
```

## Success tests

1. Provision → add room type → create 2-night stay → `sold = 1` on each night; both outbox events; ARI version bumped.
2. Book when `sold` already at physical → `no_availability`.
3. Punch hole (delete one `availability_day` row) → book spanning it → `unbookable`.
4. Same idempotency key replay → same response, `sold` unchanged.
5. Archived room type → reject.
6. `allow_overbooking=true`, `oversell_allowance=1`, full house → book succeeds (one unit over physical).

## Follow-ons

- Queues `EVENTS_QUEUE` + worker ack path
- `reservations.cancel` (sold decrement)
- `restriction_day` in same txn as book
- Holds (`held`), modify, assign room
- HTTP POST `/v1/.../reservations`

## Non-goals

This slice proves **one room, confirmed, room-type-level** booking against the ledger — not a sellable PMS product.
