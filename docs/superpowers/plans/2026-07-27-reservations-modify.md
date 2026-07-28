# Reservations modify Implementation Plan

**Goal:** `tryModifyReservation` atomically moves sold between old and new stay nights.

**Spec:** `docs/superpowers/specs/2026-07-27-reservations-modify-design.md`

## Tasks

### Task 1: Wire code

- `NOT_MODIFIABLE` in `idempotency.ts` + test

### Task 2: `tryModifyReservation` + tests

- PropertyDO implementation (no DDL change)
- Extend `reservations.spec.ts` with modify cases 1–6
- Full pipeline green

### Task 3: README

- Note modify shipped; update Next list
