# Cashiering Implementation Plan

> **For agentic workers:** Implement task-by-task. Spec: [`docs/superpowers/specs/2026-08-07-cashiering-design.md`](../specs/2026-08-07-cashiering-design.md)

**Goal:** Cash tender (`folio.record_cash_payment`), shift open/close with variance, night-audit force-close, overlay attribution, widen authorize/capture to `folio:post`.

**Migration:** v16 additive — `shift` table, `payment.tender_type NOT NULL DEFAULT 'CARD' CHECK`, `payment.shift_id` FK.

## Tasks

1. Contracts — widen authorize/capture permission; add open_shift / close_shift / record_cash_payment; routes 57–60; wire codes as needed; consumer `shift.changed` if emitted
2. do-runtime v16 + DDL + migrate.test + real-SQLite CHECK for tender_type
3. PropertyDO — shift CRUD, cash post (no PSP), variance, stamp shift_id, capture reject CASH, CLOSE_CASHIER_SHIFTS body
4. HTTP + V1_ROUTES + handler FORBIDDEN strings
5. `cashiering.spec.ts` matrix 1–16 + 12a; schema head 16

## Canaries

| Mutation | Caught by |
|---|---|
| Cash still gates on PSP | Test 2 |
| Variance wrong formula | Tests 13/14 |
| Cash/shift on folio:adjust | Test 12 |
| Widen all to folio:post | Test 12a |
| Force-close invents 0 count | Test 8 |
