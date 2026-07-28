# Reservations cancel — release sold (Phase 1 entry)

**Date:** 2026-07-27  
**Status:** Approved for implementation (post reservations.create)  
**Sources:** ARCHITECTURE.md §7.1, §10.1; command catalog `reservations.cancel`

## Purpose

Mirror `reservations.create`: cancel a confirmed reservation and decrement `availability_day.sold` for every stay night in **one atomic write**, with idempotency and outbox events. Inventory-affecting — FAIL_CLOSED per catalog.

## Scope

**In**

- Migration **v5**: extend `reservation.status` CHECK to `('confirmed', 'cancelled')`
- Wire code: `already_cancelled`
- PropertyDO: `tryCancelReservation` via `runIdempotent` + `transactionSync`
- Reuse `enumerateStayDates` from `@hospai/pms-reservations`
- Events: `reservation.status_changed`, `availability.changed`
- Tests: create → cancel → sold back to 0; double-cancel; idempotency; sold underflow refused

**Out**

- no-show (separate catalog entry)
- modify / date change
- HTTP route
- Checked-in reservations (no check-in state yet — only `confirmed` exists)

## Invariants

1. **Same atomic write.** Status flip + `sold - 1` per night + outbox + idempotency in one txn.
2. **Ledger release only.** Nights derived from stored `arrival_date` / `departure_date`, not client re-supply (fingerprint `{ reservationId }` only).
3. **Confirmed only.** `status != 'confirmed'` → `already_cancelled` (includes re-cancel).
4. **No inventing stock.** If any night would have `sold < 0` after decrement → fail closed (`ledger_inconsistent` or generic error); txn rolls back.
5. **Missing ledger row on a stay night** → fail closed (should not happen for a reservation created through create path).
6. **Idempotency replay** does not double-decrement sold.
7. **ARI version** bumps once; stamped on `availability.changed`.

## Command: `tryCancelReservation`

**Input:** `IdempotencyKey`, `{ reservationId }`

**Steps (sync, cache miss):**

1. Load reservation by id → `not_found` if absent.
2. If `status != 'confirmed'` → `already_cancelled`.
3. `nights = enumerateStayDates(arrival, departure)`.
4. For each night: verify row exists and `sold >= 1`; else fail.
5. `UPDATE sold = sold - 1` per night.
6. `UPDATE reservation SET status = 'cancelled', updated_at = now`.
7. Bump ARI; outbox both events.

## Event payloads

```ts
// reservation.status_changed
{ propertyId, reservationId, fromStatus: 'confirmed', toStatus: 'cancelled' }

// availability.changed
{ propertyId, roomTypeId, fromDate, toDate, version }
```

## Success tests

1. Create then cancel → sold returns to 0 on all nights; both events.
2. Cancel again (new idem key) → `already_cancelled`; sold unchanged.
3. Idempotency replay → same response; sold unchanged.
4. Manually zero sold then cancel → fails without negative sold.
