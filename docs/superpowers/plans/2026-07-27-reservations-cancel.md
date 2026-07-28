# Reservations cancel Implementation Plan

**Goal:** `tryCancelReservation` decrements `sold` and marks reservation cancelled atomically.

**Spec:** `docs/superpowers/specs/2026-07-27-reservations-cancel-design.md`

## Tasks

### Task 1: DDL v5 + wire code

- `ALREADY_CANCELLED`, `LEDGER_INCONSISTENT` in idempotency.ts
- Migration v5: recreate `reservation` with cancelled status + indexes
- `generate:ddl` + tests schema version → 5

### Task 2: `tryCancelReservation` + tests

- PropertyDO implementation
- `reservations-cancel.spec.ts` or extend `reservations.spec.ts` with cancel cases 1–4
- Full pipeline green

### Task 3: README

- Note cancel shipped in Phase 0 blurb / Next list
