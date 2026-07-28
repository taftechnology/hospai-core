# Reservations create + availability.book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `reservations.create` + ledger `sold` increment in one atomic PropertyDO write — first end-to-end bookability proof.

**Architecture:** Pure domain in `modules/pms/reservations`. PropertyDO owns SQL + `runIdempotent` / `transactionSync` / outbox. Wire codes in `@hospai/contracts`. Migration v4 adds `reservation` table.

**Tech Stack:** Cloudflare Durable Objects SQLite, TypeScript, vitest, `@cloudflare/vitest-pool-workers`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-27-reservations-book-design.md`

## Global Constraints

- Never derive availability by scanning reservations — read `availability_day` only.
- Missing ledger row → `unbookable`; insufficient free → `no_availability`.
- Stay nights = `[arrival, departure)` exclusive end.
- `held` stays 0; no restriction evaluation this slice.
- Require stored timezone row (`timezone_unset`).
- Atomic: reservation + sold bumps + outbox + idempotency in one txn.
- Commit to `main` after each task; TDD where specified.

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | `NO_AVAILABILITY`, `UNBOOKABLE` |
| `packages/contracts/src/commands/catalog.ts` | Remove `availability.book` from `PLATFORM_GAPS` |
| `modules/pms/reservations/**` | `@hospai/pms-reservations` |
| `packages/do-runtime/src/property-migrations.ts` | v4 `reservation` statements |
| `migrations/do-property/0004_reservation.sql` | Generated |
| `apps/pms-core/src/property-do.ts` | `tryCreateReservation` |
| `apps/pms-core/test/reservations.spec.ts` | Success tests 1–6 |

---

### Task 1: Contracts + reservations module (pure domain)

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`, `idempotency.test.ts`
- Create: `modules/pms/reservations/**` (package.json, tsconfig, vitest, stay-dates, bookability, tests)
- Modify: `pnpm-workspace.yaml` if needed (already has `modules/pms/*`)

**Interfaces:**
- `enumerateStayDates(arrival, departure): string[]`
- `firstUnbookableNight(rows, nights): string | null`
- `firstUnavailableNight(rows, allowance): string | null` — uses `freeAvailability`

- [ ] **Step 1: Failing tests (RED)**
- [ ] **Step 2: Implement (GREEN)**
- [ ] **Step 3:** `pnpm --filter @hospai/pms-reservations test && pnpm --filter @hospai/contracts test`
- [ ] **Step 4: Commit**

---

### Task 2: DDL v4 `reservation` table

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `scripts/property-ddl.mjs` (fourth file)
- Generate: `migrations/do-property/0004_reservation.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts` (schema version → 4)

- [ ] **Step 1:** Add `RESERVATION_STATEMENTS`, migration version 4
- [ ] **Step 2:** `pnpm generate:ddl && pnpm check:ddl`
- [ ] **Step 3: Commit**

---

### Task 3: PropertyDO `tryCreateReservation`

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/package.json` (dep on `@hospai/pms-reservations`)

**Interfaces:**
- `tryCreateReservation(idem, body): Promise<Result>`

- [ ] **Step 1: Failing tests in `reservations.spec.ts` (cases 1–3)**
- [ ] **Step 2: Implement book path**
- [ ] **Step 3: Full cases 4–6 + idempotency**
- [ ] **Step 4:** `pnpm --filter @hospai/pms-core test`
- [ ] **Step 5: Commit**

---

### Task 4: Catalog gap + README

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts` — remove `availability.book` gap
- Modify: `README.md` — update Next section

- [ ] **Step 1:** Remove gap; update register test if needed
- [ ] **Step 2: Commit**

---

### Task 5: Full pipeline

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm check:ddl
```

- [ ] **Step 1: Green pipeline**
- [ ] **Step 2: Commit if fixes needed**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| enumerateStayDates | 1 |
| bookability pure checks | 1 |
| reservation DDL | 2 |
| tryCreateReservation + sold bump | 3 |
| Events + ARI version | 3 |
| Success tests 1–6 | 3 |
| PLATFORM_GAPS closed | 4 |
