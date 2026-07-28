# Guests + crypto-shredding (Phase 0 — PII door)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §4.8, §10.1; command catalog `guests.create`, `guests.update`

## Purpose

Close the last retrofittable Phase 0 gap: guest identity linked to reservations with PII encrypted in OrgDO under per-guest keys, domain events carrying **references only** (`guest_ref`, `pii_key_id`), and erasure via crypto-shredding — before any raw name lands in the immutable outbox.

## Scope

**In**

- Package `@hospai/crypto-shredding`: envelope encryption (Web Crypto AES-GCM), `KeyScope: 'guest' | 'staff'`, shred = **destroy** wrapped data key (`wrapped_key = x''`; row kept as audit record)
- OrgDO migration **v2**: `data_key`, `guest`, `idempotency`, `outbox` (`wrapped_key BLOB` nullable)
- OrgDO commands: `tryCreateGuest`, `tryUpdateGuest`, `tryEraseGuest` (idempotent + outbox)
- PropertyDO migration **v7**: `reservation.guest_ref`, `reservation.pii_key_id` (NOT NULL; legacy rows → `'legacy'`)
- `tryCreateReservation` requires `guestRef` + `piiKeyId`; `reservation.created` payload includes both, **never** display names
- Wire codes: `guest_not_found`, `guest_already_erased`
- Catalog: `guests.erase` → `guest.erased`
- Tests: encrypt/decrypt round-trip; book → outbox grep-no-PII; erase → decrypt fails; staff scope survives guest shred; erase with guest FK row present
- Vitest binding `HOSPAI_ORG_MASTER_KEY` (32-byte hex, local only)

**Out**

- Staff records / housekeeping PII (key scope only)
- Purge Workflow steps 2–6 (R2/Iceberg)
- HTTP guest routes
- Cross-DO guest verification inside PropertyDO txn (client supplies refs from prior `guests.create`)

## Deployment assumption

Phase 0 OrgDOs are created from this codebase only — `318cf86` / pre-nullable `0002` was never deployed. Shred uses in-place `UPDATE` (`wrapped_key = x''`), not a table rebuild. **Never DROP/rebuild `data_key`** while `guest.pii_key_id` FK references it; DO storage enforces foreign keys and `defer_foreign_keys` does not help.

## Invariants

1. **Events carry no raw guest PII** — only `guestRef` + `piiKeyId` (§4.8).
2. **Guest PII lives in OrgDO** — encrypted profile blob + per-guest data key wrapped under org master key.
3. **Erasure = shred key first** — `guests.erase` sets `wrapped_key = x''` + `shredded_at`; material absence (not the flag alone) makes ciphertext undecodable even with a DB dump and master key.
4. **Separate key scopes** — shredding a `guest` key must not affect a `staff`-scoped key on another subject.
5. **Same atomic/idempotency patterns** as reservations — one `transactionSync` + `runIdempotent` per command.

## Operational caveat (PITR)

Durable Objects support point-in-time recovery. A restore to before the shred can bring `wrapped_key` back. ARCHITECTURE §4.8 “covers backups, PITR windows” is only defensible with a PITR retention window shorter than the erasure SLA, or out-of-band org master-key rotation after erasure — neither is implemented in Phase 0. Document in DPA until a retention/rotation policy exists.

## Event payloads

```ts
// guest.created / guest.updated
{ orgId, guestRef, piiKeyId }

// guest.erased
{ orgId, guestRef, piiKeyId }

// reservation.created (updated)
{ propertyId, reservationId, roomTypeId, arrivalDate, departureDate, status, guestRef, piiKeyId }
```

## Acceptance

1. Create guest → decrypt profile returns display name
2. Book with guest refs → outbox `reservation.created` JSON contains refs, not plaintext name
3. Erase guest → decrypt throws; `wrapped_key` empty blob; outbox `guest.erased` emitted; guest FK row unchanged
4. Shred guest key → staff-scoped test key still decrypts
