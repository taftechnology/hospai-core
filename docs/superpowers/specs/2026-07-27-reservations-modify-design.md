# Reservations modify — sold delta (Phase 1 entry)

**Date:** 2026-07-27  
**Status:** Approved for implementation (post reservations.cancel)  
**Sources:** ARCHITECTURE.md §7.1, §10.1; command catalog `reservations.modify`

## Purpose

Change a confirmed reservation's room type and/or stay dates by releasing `sold` on the old nights and acquiring on the new nights in **one atomic write**, with idempotency and outbox events. Inventory-affecting — FAIL_CLOSED per catalog.

## Scope

**In**

- Wire code: `not_modifiable` (non-`confirmed` status)
- PropertyDO: `tryModifyReservation` via `runIdempotent` + `transactionSync`
- Reuse `enumerateStayDates`, `firstUnavailableNight` from `@hospai/pms-reservations`
- Events: `reservation.modified`, `availability.changed` (one per affected room type)
- Tests: extend stay; shorten stay; room-type change; no availability refused; idempotency; cancelled refused

**Out**

- Partial field updates (all of roomTypeId + arrival + departure required)
- Rate / restriction re-evaluation
- HTTP route
- Checked-in reservations (only `confirmed` exists today)

## Invariants

1. **Same atomic write.** Release old sold + book new sold + reservation update + outbox + idempotency in one txn.
2. **Release-then-acquire order.** Decrement every old stay night (after `sold >= 1` check), then book-check new nights, then increment new nights — overlapping nights on the same room type work without special casing.
3. **Confirmed only.** `status != 'confirmed'` → `not_modifiable`.
4. **Active target room type.** New `room_type.status = 'active'` or `not_found`.
5. **Ledger book path.** New nights use `firstUnavailableNight` on post-release snapshots (ledger oversell authoritative).
6. **No-op.** Stored fields already match input → success without ledger/outbox writes.
7. **Idempotency replay** does not double-touch sold.
8. **ARI version** bumps once when any ledger row changes; same version stamped on all `availability.changed` events in the txn.

## Command: `tryModifyReservation`

**Input:** `IdempotencyKey`, `{ reservationId, roomTypeId, arrivalDate, departureDate }`

**Steps (sync, cache miss):**

1. Load reservation → `not_found` if absent.
2. If `status != 'confirmed'` → `not_modifiable`.
3. If stored fields match input → no-op success.
4. Validate new active `room_type`.
5. `oldNights = enumerateStayDates(stored arrival, departure)`.
6. `newNights = enumerateStayDates(input arrival, departure)`.
7. For each old night: verify row exists and `sold >= 1`; else `ledger_inconsistent`.
8. Decrement `sold` on every old night (old room type).
9. Book-check every new night on new room type → `unbookable` / `no_availability`.
10. Increment `sold` on every new night.
11. `UPDATE reservation` with new fields + `updated_at`.
12. Bump ARI once; outbox `reservation.modified` + `availability.changed` per affected room type.

**Fingerprint:** `{ reservationId, roomTypeId, arrivalDate, departureDate }`

## Event payloads

```ts
// reservation.modified
{
  propertyId,
  reservationId,
  from: { roomTypeId, arrivalDate, departureDate },
  to: { roomTypeId, arrivalDate, departureDate },
}

// availability.changed — one event per room type touched; range = min/max of that type's affected nights
{ propertyId, roomTypeId, fromDate, toDate, version }
```

## Success tests

1. Extend stay by one night → sold +1 on new night only; both events.
2. Shorten stay → sold -1 on dropped night; ledger unchanged on kept nights.
3. Change room type → old type decremented, new type incremented.
4. Modify into full house → `no_availability`; sold unchanged (txn rollback).
5. Idempotency replay → same response; sold unchanged.
6. Cancelled reservation → `not_modifiable`.
