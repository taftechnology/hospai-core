# Audit Phase B — business-logic defects (money / guest impact) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Fix four live or latent business-logic defects with money or guest impact — **B1** GUEST-window-only checkout balance, **B2** honour `ratePlanId` on modify with re-snapshot semantics, **B3** fix `noPost` ordering on modify, **B4** correct cancel-policy error class + wire registration. No schema migration; catalog length **89** unchanged.

**Architecture:** All four fixes land in `property-do.ts` (`tryCheckOut`, `tryModifyReservation`, `penaltyMinor`, `mapReservationPreconditionError`) plus minimal contracts/dispatch touch for B4 wire code. Test-first TDD order B1 → B2 → B3 → B4; one commit per item. Phase A `pnpm test:local` is the long-pole verifier.

**Tech Stack:** Cloudflare Workers Durable Object (`property-do.ts`), `@hospai/contracts` error constants, vitest + `vitest-pool-workers`, root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-b-business-logic-design.md` (Locks 1–4 normative).

---

## Frozen heads (do not move this chunk)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — no new commands |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |

Tree verified 2026-08-15. **B4 note:** adds `INVALID_CANCEL_POLICY = 'invalid_cancel_policy'` to `packages/contracts/src/idempotency.ts` — this is a **wire error constant**, **not** a `COMMAND_CATALOG` row; catalog length **must not** move.

---

## Sequencing gate (read before starting)

Phase **A** (`test:local`, scoped console assertions) **must** be landed — local verification is unreliable until A1/A2 complete.

| After this plan | Do not start |
|---|---|
| B1 GUEST-window checkout balance (Lock 1) | B1 option **(b)** machinery |
| B2 `ratePlanId` on modify + re-snapshot (Lock 2) | HTTP/client wiring of `noPost` on PATCH |
| B3 `noPost` ordering + noPost-only branch (Lock 3) | Widening `overrideBalance` to paper over B1 |
| B4 cancel-policy error class (Lock 4) | **D1** closed error-union refactor |
| All §Verification commands green | Phase **C+** audit items; schema migrations; rate limiting |

**TDD order:** Task 1 (B1 test red → Lock 1 green) → Task 2 (B2 test red → Lock 2 green) → Task 3 (B3 test red → Lock 3 green) → Task 4 (B4 test red → Lock 4 green → full verify).

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: B1 GUEST-window-only checkout balance (spec §2 Lock 1)

**Locked:** Replace global balance query in `tryCheckOut` with existing per-window helper. Apply **same** scoped `balanceMinor` to all three consumers. Reuse single `guestWindowId` binding (do not recompute at auto-close).

**Before** (`property-do.ts:9338–9344`):

```ts
const balanceRow = this.ctx.storage.sql
  .exec(
    `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS balance FROM folio_line WHERE reservation_id = ?`,
    input.reservationId,
  )
  .toArray() as Array<{ balance: number }>;
const balanceMinor = Number(balanceRow[0]?.balance ?? 0);
```

**After (locked shape):**

```ts
const guestWindowId = this.guestFolioWindowId(input.reservationId);
const balanceMinor = this.windowBalanceMinorSync(guestWindowId);
```

**Helper (already exists — do not duplicate SQL):** `windowBalanceMinorSync` at `property-do.ts:14035–14043`; `guestFolioWindowId` at `property-do.ts:13978–13980`.

| Consumer | Line | Behaviour |
|---|---|---|
| `BalanceDueError` throw | ~9349 | `requireZero && balanceMinor > 0 && !(override…)` |
| `folio.balance_due` outbox | ~9405–9417 | emit when `balanceMinor > 0` |
| Guest window auto-close | ~9434–9439 | `close_window_on_check_out === true && balanceMinor === 0`; **reuse** `guestWindowId` from balance section |

**Do not** change `tryCloseFolioWindow` window balance logic, city-ledger posting, or override semantics.

### D2 — Lock 2: B2 honour `ratePlanId` on modify (spec §2 Lock 2)

#### 2a — Input type and reservation read

Add to `tryModifyReservation` input (`property-do.ts:8586–8594`):

```ts
ratePlanId?: string;
```

Extend reservation `SELECT` (~8645) with `no_post` (needed for B3) and keep `rate_plan_id`:

```ts
`SELECT room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, room_id, adults, children, no_post FROM reservation WHERE reservation_id = ?`,
```

Add to `toArray()` row type: `no_post: number`.

Early in transaction, after loading `reservation`:

```ts
const nextRatePlanId = input.ratePlanId ?? reservation.rate_plan_id;
if (input.ratePlanId !== undefined) {
  this.assertActiveRatePlanSync(input.ratePlanId);
}
```

#### 2b — No-op detection must include rate plan and noPost

**Full no-op** guard (~8675–8689) — add conjuncts:

```ts
const nextNoPost =
  input.noPost !== undefined ? input.noPost : reservation.no_post === 1;

if (
  reservation.room_type_id === input.roomTypeId &&
  reservation.arrival_date === input.arrivalDate &&
  reservation.departure_date === input.departureDate &&
  nextAdults === reservation.adults &&
  nextChildren === reservation.children &&
  nextRatePlanId === reservation.rate_plan_id &&
  nextNoPost === (reservation.no_post === 1)
) {
  // existing early return unchanged
}
```

#### 2c — Rate-plan-only branch (mirror party-size-only ~8692–8746)

When room type, dates, adults, and children are unchanged **but** `nextRatePlanId !== reservation.rate_plan_id`:

1. `UPDATE reservation SET rate_plan_id = ?, updated_at = ? WHERE reservation_id = ?`
2. Call **`resnapshotRateNightsForPlanChangeSync`** (Lock 2e) with unchanged night list
3. Append `reservation.modified` outbox (include `ratePlanId` in `from` / `to` payloads)
4. Append audit row (`commandId: 'reservations.modify'`)
5. Return `{ ok: true, reservationId, ariVersion: readAriVersionSync(), fromDate, toDate }` — **no** inventory churn, **no** ARI bump

Do **not** enter sold-night release/acquire path for plan-only changes.

**Ordering:** evaluate rate-plan-only branch **before** party-size-only (~8692) and **before** noPost-only (B3).

#### 2d — Full modify path

In main `UPDATE reservation` blocks (~8872–8898):

- Include `rate_plan_id = ?` when `input.ratePlanId !== undefined` (both sold-SKU-changed and date-only branches).

At `syncReservationRateNightsOnModifySync` call (~8903–8909), pass **`nextRatePlanId`** instead of `reservation.rate_plan_id`:

```ts
this.syncReservationRateNightsOnModifySync(
  input.reservationId,
  input.roomTypeId,
  nextRatePlanId,
  oldNights,
  newNights,
);
```

After `syncReservationRateNightsOnModifySync`, when `nextRatePlanId !== reservation.rate_plan_id`:

```ts
this.resnapshotRateNightsForPlanChangeSync(
  input.reservationId,
  input.roomTypeId,
  nextRatePlanId,
  newNights,
);
```

When dates change **and** plan changes in same request, full path handles both; do not double-call re-snapshot from rate-plan-only branch.

#### 2e — Re-snapshot product decision (normative)

**Current behaviour** (`syncReservationRateNightsOnModifySync`, `property-do.ts:7570–7606`):

- Deletes `reservation_rate_night` rows only for nights **removed** from the stay (and not consumed by posted `ROOM` / `NO_SHOW` folio lines).
- Inserts snapshots only for nights **added** to the stay.
- When dates are **unchanged**, `added` is empty and existing snapshots are **untouched** — a plan-only change would leave stale amounts without additional logic.

**Locked product decision:** When the rate plan changes (with or without date changes), **re-snapshot unconsumed stay nights at the new plan's amounts**. A night is **consumed** when a `folio_line` exists for that `reservation_id` + `business_date` with `charge_code IN ('ROOM', 'NO_SHOW')` — same guard as the delete loop in `syncReservationRateNightsOnModifySync` (~7581–7590).

**Consumed nights** keep their existing snapshot amounts (posted room revenue is immutable).

Implement **`resnapshotRateNightsForPlanChangeSync`** (private, same file) — **verbatim from spec:**

```ts
private resnapshotRateNightsForPlanChangeSync(
  reservationId: string,
  roomTypeId: string,
  ratePlanId: string,
  nights: string[],
): void {
  const reservable: string[] = [];
  for (const stayDate of nights) {
    const consumed = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS hit FROM folio_line
         WHERE reservation_id = ? AND business_date = ? AND charge_code IN ('ROOM', 'NO_SHOW')
         LIMIT 1`,
        reservationId,
        stayDate,
      )
      .toArray() as Array<{ hit: number }>;
    if (!consumed[0]) reservable.push(stayDate);
  }
  for (const stayDate of reservable) {
    this.ctx.storage.sql.exec(
      `DELETE FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`,
      reservationId,
      stayDate,
    );
  }
  if (reservable.length === 0) return;
  const promoRows = this.ctx.storage.sql
    .exec(`SELECT promo_id FROM reservation WHERE reservation_id = ?`, reservationId)
    .toArray() as Array<{ promo_id: string | null }>;
  const promoId = promoRows[0]?.promo_id ?? null;
  const promoRow = this.resolveStoredPromoForSnapshotSync(promoId, ratePlanId, reservable);
  this.snapshotRateNightsSync(reservationId, roomTypeId, ratePlanId, reservable, promoRow);
}
```

Call from: (1) rate-plan-only branch; (2) full modify path when `nextRatePlanId !== reservation.rate_plan_id` after `syncReservationRateNightsOnModifySync`.

#### 2f — Idempotency fingerprint (no change to HTTP)

Keep `ratePlanId` in `fingerprintPayload` at `v1-dispatch.ts:1948–1956`. **Consequence once B2 lands:** two modify requests differing only in `ratePlanId` hash differently **and** produce different effects — correct. No fingerprint change.

Update stale JSDoc on `tryModifyReservation` (~8582):

```ts
 * `reservations.modify`. Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate, adults?, children?, ratePlanId?, noPost? }`.
```

### D3 — Lock 3: B3 `noPost` on modify (spec §2 Lock 3)

#### 3a — Move `applyNoPostIfPresentSync` above early returns

**Remove** call at `property-do.ts:8900` (after main UPDATE).

**Insert** immediately after `assertOccupancySync` (~8673), **before** full-no-op guard:

```ts
this.applyNoPostIfPresentSync(input.reservationId, input.noPost);
```

`applyNoPostIfPresentSync` (`property-do.ts:7455–7462`) no-ops when `noPost === undefined`; safe once up front.

#### 3b — NoPost-only branch (mirror party-size-only)

When room type, dates, adults, children, **and rate plan** are unchanged **but** `input.noPost !== undefined` and `nextNoPost !== (reservation.no_post === 1)`:

1. `applyNoPostIfPresentSync` already ran — do not call again
2. Append `reservation.modified` outbox (`from` / `to` include `noPost`)
3. Append audit row
4. Return success without inventory / rate-night work

**Ordering relative to B2:** evaluate rate-plan-only branch **before** noPost-only branch (plan change is money-affecting; noPost-only is flags-only).

#### 3c — Party-size-only branch

Leave structure at ~8692–8746; `applyNoPostIfPresentSync` already applied up front when `input.noPost` present.

### D4 — Lock 4: B4 misconfigured cancel policy error class (spec §2 Lock 4)

#### 4a — Throw site

In `penaltyMinor` (`property-do.ts:7549–7551`), replace:

```ts
if (count < 1) throw new RateMissingError(row.arrival_date);
```

with:

```ts
if (count < 1) throw new InvalidCancelPolicyError();
```

`InvalidCancelPolicyError` already exists (`property-do.ts:996–1000`).

#### 4b — Wire constant

Add to `packages/contracts/src/idempotency.ts` (near rate-plan codes ~97–102):

```ts
export const INVALID_CANCEL_POLICY = 'invalid_cancel_policy' as const;
```

Replace ad-hoc `'invalid_cancel_policy'` in `tryCreateRatePlan` / `tryUpdateRatePlan` catch blocks (`property-do.ts:11835`, `:12030`) with `INVALID_CANCEL_POLICY` — optional hygiene in Task 4, not required for B4 proof.

#### 4c — `mapReservationPreconditionError`

Add before final `return null` (~1183):

```ts
if (e instanceof InvalidCancelPolicyError) {
  return { ok: false, error: INVALID_CANCEL_POLICY };
}
```

Import `INVALID_CANCEL_POLICY` from `@hospai/contracts` in `property-do.ts`.

#### 4d — HTTP status mapper

Add `INVALID_CANCEL_POLICY` to **422** branch of `mapReservationCommandErrorStatus` in `v1-dispatch.ts` (~355, alongside `RATE_MISSING`). Import from `@hospai/contracts`.

**Do not** change `normalizeRatePlanPolicy` validation (~1059–1063).

### D5 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local` now that Phase A landed it. Per-file verification: `pnpm --filter @hospai/pms-core exec vitest run <file>`.

### D6 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. No push.

---

## Global constraints

- **Heads table above — no catalog/route/schema/night-audit movement** (B4 wire constant in `idempotency.ts` is explicitly **not** a catalog entry).
- **Four focused product fixes + tests** — no Phase C+ items, no migrations, no rate limiting.
- **Phase A green prerequisite** — use `pnpm test:local` for long-pole verification.
- **TDD per item** — failing test first, then lock, then green on that file before commit.

### Scope out (forbidden across all tasks)

- **D1** closed error-union refactor — B4 adds at most one constant + mapper lines; no typed union sweep
- **E4** client-side checkout override copy
- B1 option **(b)** (exclude transferred COMPANY windows)
- Rate limiting, schema migrations, Phase **C** and later audit items
- HTTP / client wiring of `noPost` on modify (B3 fixes DO path only; route body already omits `noPost` today)
- Widening `overrideBalance` to paper over B1

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/test/reservations-check-out-direct-bill.spec.ts` | **New** — B1 direct-bill checkout + regression sanity | 1 |
| `apps/pms-core/src/property-do.ts` | Lock 1: `tryCheckOut` balance scope (~9338–9439) | 1 |
| `apps/pms-core/test/reservations.spec.ts` | B2 DO-level rate-plan modify + snapshot amounts | 2 |
| `apps/pms-core/test/reservations-routes.spec.ts` | B2 modify idempotency smoke (same key, different `ratePlanId`) | 2 |
| `apps/pms-core/src/property-do.ts` | Lock 2: `tryModifyReservation` input, SELECT, no-op, rate-plan-only branch, UPDATE, sync, `resnapshotRateNightsForPlanChangeSync`, JSDoc | 2 |
| `apps/pms-core/test/reservations.spec.ts` | B3 noPost-only modify spec | 3 |
| `apps/pms-core/src/property-do.ts` | Lock 3: `applyNoPostIfPresentSync` move + noPost-only branch | 3 |
| `apps/pms-core/test/reservations-lifecycle.spec.ts` | B4 misconfigured cancel policy spec | 4 |
| `packages/contracts/src/idempotency.ts` | `INVALID_CANCEL_POLICY` export | 4 |
| `apps/pms-core/src/property-do.ts` | Lock 4: `penaltyMinor`, `mapReservationPreconditionError`; optional rate-plan catch hygiene | 4 |
| `apps/pms-core/src/v1-dispatch.ts` | Lock 4: `mapReservationCommandErrorStatus` → 422 | 4 |
| `docs/superpowers/specs/2026-08-15-audit-phase-b-business-logic-design.md` | Tick §8 checklist | 4 |
| `docs/superpowers/plans/2026-08-15-audit-phase-b-business-logic.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `COMMAND_CATALOG`, HTTP route table, schema migrations, `web-pms`, `client-core`, Phase C+ items, `v1-dispatch.ts` modify fingerprint (unchanged — now effectful).

---

## Spec §1.5 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 1 — B1 GUEST-window balance | 1 |
| §4 #1–2 — direct-bill checkout + regression | 1 |
| Lock 2 — B2 `ratePlanId` + re-snapshot | 2 |
| §4 #3–4 — rate plan modify + idempotency smoke | 2 |
| Lock 3 — B3 `noPost` ordering | 3 |
| §4 #5 — noPost-only spec | 3 |
| Lock 4 — B4 cancel-policy error | 4 |
| §4 #6 — misconfigured policy spec | 4 |
| §4 #7–9 — full suite + gates + build | 4 |
| §1.6 scope out | forbidden all |
| §8 checklist | 4 |

---

### Task 1: B1 — GUEST-window checkout balance (TDD)

**Spec:** Lock 1, §4 #1–2.

**Files:**
- Create: `apps/pms-core/test/reservations-check-out-direct-bill.spec.ts`
- Modify: `apps/pms-core/src/property-do.ts` (~9338–9439)

**Interfaces:**
- Produces: scoped `balanceMinor` via `guestFolioWindowId` + `windowBalanceMinorSync`; single `guestWindowId` binding reused at auto-close
- Frozen heads unchanged

**Forbidden this commit:** B2/B3/B4 product code; other test files.

- [ ] **Step 1: Create failing B1 spec (red)**

Create `apps/pms-core/test/reservations-check-out-direct-bill.spec.ts`. Reuse helpers from `reservations-check-out.spec.ts` (`provisionedPropertyWithGuest`, `addRoomType`, `stayCheckedIn`) and `city-ledger.spec.ts` patterns (`createCityLedgerAccount`, `insertFolioLineRawForTest`, `tryCloseFolioWindow`). Import `BALANCE_DUE`, `TEST_OWNER_ACTOR`, `idemFor`, `addCalendarDays`.

**Test 1 — direct-bill checkout succeeds (§4 #1):**

```typescript
describe('check-out with company direct-bill (B1)', () => {
  it('allows checkout when GUEST window is zero but company window has receivable + city ledger entry', async () => {
    const name = `co-db-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = 'res_db1';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_db1', arrival, departure);

    // Enable auto-close on zero guest balance
    await stub.writeConfigValueForTest('pms.folio.close_window_on_check_out', true);

    // Company window: direct-billed ROOM (no guest-window offset)
    const account = await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name: 'Employer Co', creditLimitMinor: 1_000_000 },
      await idemFor('cla-db1', { name: 'Employer Co' }),
    );
    expect(account).toMatchObject({ ok: true });
    const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: 'Employer Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-co-db1', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    const businessDate = (await stub.readBusinessDate())!;
    const receivableMinor = 12_000;
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: opened.folioWindowId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: receivableMinor,
      source: 'desk',
      businessDate,
    });

    // Close company window → city_ledger_entry (production transfer path)
    const closeFp = { folioWindowId: opened.folioWindowId };
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        closeFp,
        await idemFor('close-co-db1', closeFp),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readCityLedgerChargeForWindowForTest(opened.folioWindowId)).toBeTruthy();

    await stub.flushOutbox();

    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('co-db1', { reservationId }),
    );
    expect(result).toMatchObject({ ok: true });

    const eventTypes = await stub.listOutboxEventTypes();
    expect(eventTypes).not.toContain('folio.balance_due');

    const guestWin = await stub.readFolioWindowForTest(`${reservationId}:GUEST`);
    expect(guestWin?.status).toBe('CLOSED');
  });
```

**Test 2 — regression sanity (§4 #2):**

```typescript
  it('regression sanity: global reservation obligation > 0 while GUEST window obligation === 0', async () => {
    const name = `co-db-reg-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = 'res_db_reg';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_db_reg', arrival, departure);

    const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: 'Reg Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-co-reg', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    const receivableMinor = 8_500;
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: opened.folioWindowId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: receivableMinor,
      source: 'desk',
      businessDate: (await stub.readBusinessDate())!,
    });

    // Proves bug class: company charges count globally; guest window unsettled amount is zero
    expect(receivableMinor).toBeGreaterThan(0);
    // No folio lines on GUEST window in this setup → guest obligation zero
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);

    // Pre-fix: checkout fails with balance_due because global sum includes company window
    const preFix = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('co-reg-prefix', { reservationId }),
    );
    expect(preFix).toMatchObject({ ok: false, error: BALANCE_DUE });
  });
});
```

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out-direct-bill.spec.ts
```

Expected: **FAIL** — Test 1 fails (`ok: false` or `BALANCE_DUE`); Test 2 passes (documents bug class).

- [ ] **Step 2: Apply Lock 1 in `tryCheckOut`**

Replace `property-do.ts:9338–9344` with Lock 1 after shape. At auto-close block (~9434–9439), **remove** second `guestFolioWindowId` call; reuse `guestWindowId` from balance section:

```typescript
          const guestWindowId = this.guestFolioWindowId(input.reservationId);
          const balanceMinor = this.windowBalanceMinorSync(guestWindowId);
          const requireZero =
            this.readConfigValueSync('pms.reservations.check_out_require_zero_balance') !== false;
          // ... BalanceDueError, folio.balance_due unchanged logic ...

          if (this.readConfigValueSync('pms.folio.close_window_on_check_out') === true && balanceMinor === 0) {
            const guestWindow = this.readFolioWindowRowSync(guestWindowId);
            if (guestWindow?.status === 'OPEN') {
              this.closeFolioWindowSync(guestWindowId, now, propertyId, input.reservationId);
            }
          }
```

- [ ] **Step 3: Re-run spec — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out-direct-bill.spec.ts
```

Expected: **PASS** (both tests). Test 2's pre-fix assertion must be **removed or inverted** after fix — change to assert checkout `{ ok: true }` OR delete the `BALANCE_DUE` expect and keep only the sum-class sanity (`receivableMinor > 0`, guest window has no lines). **Do not** leave a test that expects failure post-fix.

**Post-fix Test 2 shape:**

```typescript
    expect(receivableMinor).toBeGreaterThan(0);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('co-reg-post', { reservationId }),
    );
    expect(result).toMatchObject({ ok: true });
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test/reservations-check-out-direct-bill.spec.ts \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): scope checkout balance to GUEST folio window

Direct-bill company charges no longer block guest checkout when the guest
window is settled. Aligns balance query with auto-invoice gate.
EOF
)"
```

---

### Task 2: B2 — honour `ratePlanId` on modify (TDD)

**Spec:** Lock 2, §4 #3–4.

**Files:**
- Modify: `apps/pms-core/test/reservations.spec.ts` (new describe block)
- Modify: `apps/pms-core/test/reservations-routes.spec.ts` (modify idempotency smoke)
- Modify: `apps/pms-core/src/property-do.ts` (Lock 2 all touch points)

**Interfaces:**
- Produces: `ratePlanId?: string` input; `no_post` in SELECT; extended no-op; rate-plan-only branch; UPDATE writes `rate_plan_id`; sync uses `nextRatePlanId`; `resnapshotRateNightsForPlanChangeSync` (verbatim Lock 2e); JSDoc update
- Re-snapshot product decision: plan change → unconsumed nights re-snapshot at new plan amounts; consumed nights frozen

**Forbidden this commit:** B3/B4 code; HTTP fingerprint changes.

- [ ] **Step 1: Write failing B2 specs (red)**

**DO test** — add to `apps/pms-core/test/reservations.spec.ts`:

```typescript
describe('modify rate plan (B2)', () => {
  it('rate-plan-only change updates reservation_rate_night amounts', async () => {
    const name = `mod-rp-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);

    expect(
      await stub.tryCreateRatePlan(
        TEST_OWNER_ACTOR,
        { ratePlanId: 'CORP', code: 'CORP', name: 'Corporate', cancelPenaltyType: 'none', cancelGraceHours: 0 },
        await idemFor('rp-corp', { ratePlanId: 'CORP' }),
      ),
    ).toMatchObject({ ok: true });

    for (const planId of ['BAR', 'CORP'] as const) {
      const amountMinor = planId === 'BAR' ? 10_000 : 7_500;
      expect(
        await stub.tryUpsertRateDay(
          TEST_OWNER_ACTOR,
          { roomTypeId: 'rt_king', ratePlanId: planId, stayDate: arrival, amountMinor, currency: 'USD' },
          await idemFor(`rd-${planId}`, { planId, arrival }),
        ),
      ).toMatchObject({ ok: true });
    }

    const reservationId = 'res_mod_rp';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'BAR',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-mod-rp', create)),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: arrival, amountMinor: 10_000, currency: 'USD', ratePlanId: 'BAR' },
    ]);

    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'CORP',
    };
    expect(
      await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m-mod-rp', modify)),
    ).toMatchObject({ ok: true });

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.ratePlanId).toBe('CORP');
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: arrival, amountMinor: 7_500, currency: 'USD', ratePlanId: 'CORP' },
    ]);
  });
});
```

**HTTP idempotency smoke** — add helper + test to `apps/pms-core/test/reservations-routes.spec.ts`:

```typescript
async function patchReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}
```

```typescript
  it('PATCH modify: same idempotency key, different ratePlanId → idempotency_key_reused', async () => {
    const actor = `user_mod_rp_idem_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 1);
    const reservationId = `res_mod_idem_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-mod-rp-${crypto.randomUUID()}`;

    expect(
      (await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `book-${idempotencyKey}`,
      })).status,
    ).toBe(201);

    const first = await patchReservation(propertyId, actor, reservationId, {
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'BAR',
      idempotencyKey,
    });
    expect(first.status).toBe(200);

    const replay = await patchReservation(propertyId, actor, reservationId, {
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'CORP',
      idempotencyKey,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });
```

Use `patchReservation` helper (add above test — mirrors `postReservation` against `PATCH /v1/properties/:id/reservations/:id`).

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t "modify rate plan"
pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "different ratePlanId"
```

Expected: **FAIL** — plan unchanged / snapshots stale / idempotency behaviour wrong pre-fix.

- [ ] **Step 2: Apply Lock 2 in `property-do.ts`**

Apply D2 sections 2a–2f in order:

1. Input type + SELECT + row type `no_post`
2. `nextRatePlanId` + conditional `assertActiveRatePlanSync` after reservation load
3. `nextNoPost` + extended full-no-op guard
4. **New rate-plan-only branch** (after no-op guard, before party-size-only) — skeleton:

```typescript
          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate &&
            nextAdults === reservation.adults &&
            nextChildren === reservation.children &&
            nextRatePlanId !== reservation.rate_plan_id
          ) {
            const nowPlan = Date.now();
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET rate_plan_id = ?, updated_at = ? WHERE reservation_id = ?`,
              nextRatePlanId,
              nowPlan,
              input.reservationId,
            );
            const nights = enumerateStayDates(input.arrivalDate, input.departureDate);
            this.resnapshotRateNightsForPlanChangeSync(
              input.reservationId,
              input.roomTypeId,
              nextRatePlanId,
              nights,
            );
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'reservation.modified',
              payload: {
                propertyId,
                reservationId: input.reservationId,
                guestRef: reservation.guest_ref,
                piiKeyId: reservation.pii_key_id,
                from: {
                  roomTypeId: reservation.room_type_id,
                  arrivalDate: reservation.arrival_date,
                  departureDate: reservation.departure_date,
                  adults: reservation.adults,
                  children: reservation.children,
                  ratePlanId: reservation.rate_plan_id,
                },
                to: {
                  roomTypeId: input.roomTypeId,
                  arrivalDate: input.arrivalDate,
                  departureDate: input.departureDate,
                  adults: nextAdults,
                  children: nextChildren,
                  ratePlanId: nextRatePlanId,
                },
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.modify',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { ratePlanId: reservation.rate_plan_id },
              afterJson: { ratePlanId: nextRatePlanId },
              reservationId: input.reservationId,
            });
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: this.readAriVersionSync(),
              fromDate: nights[0]!,
              toDate: nights[nights.length - 1]!,
            };
          }
```

5. Full modify UPDATE blocks — add `rate_plan_id = ?` when `input.ratePlanId !== undefined`:

Sold-SKU-changed branch (~8873):

```typescript
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET room_type_id = ?, allocated_room_type_id = ?, arrival_date = ?, departure_date = ?,
               adults = COALESCE(?, adults), children = COALESCE(?, children),
               rate_plan_id = COALESCE(?, rate_plan_id), updated_at = ?
               WHERE reservation_id = ?`,
              input.roomTypeId,
              nextAllocatedRoomTypeId,
              input.arrivalDate,
              input.departureDate,
              input.adults ?? null,
              input.children ?? null,
              input.ratePlanId ?? null,
              now,
              input.reservationId,
            );
```

Date-only branch (~8887) — same `rate_plan_id = COALESCE(?, rate_plan_id)` addition.

6. Pass `nextRatePlanId` to `syncReservationRateNightsOnModifySync` (~8906)
7. After sync, conditional `resnapshotRateNightsForPlanChangeSync` when plan changed
8. Add **`resnapshotRateNightsForPlanChangeSync`** method verbatim (Lock 2e) near `syncReservationRateNightsOnModifySync`
9. Update JSDoc (~8582)

**Do not** move `applyNoPostIfPresentSync` yet (Task 3).

- [ ] **Step 3: Re-run B2 specs — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t "modify rate plan"
pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "different ratePlanId"
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test/reservations.spec.ts \
  apps/pms-core/test/reservations-routes.spec.ts \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): honour ratePlanId on reservation modify

Rate-plan-only changes update reservation_rate_night snapshots at new plan
amounts for unconsumed nights. Modify idempotency fingerprints now match effects.
EOF
)"
```

---

### Task 3: B3 — `noPost` on modify (TDD)

**Spec:** Lock 3, §4 #5.

**Files:**
- Modify: `apps/pms-core/test/reservations.spec.ts` (new `it`)
- Modify: `apps/pms-core/src/property-do.ts` (Lock 3)

**Forbidden this commit:** B4 code; contracts/dispatch.

- [ ] **Step 1: Write failing B3 spec (red)**

Add to `apps/pms-core/test/reservations.spec.ts`:

```typescript
  it('noPost-only modify sets no_post and emits reservation.modified', async () => {
    const name = `mod-nopost-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);
    const reservationId = 'res_mod_np';

    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-mod-np', create)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryConfirmReservation(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('confirm-mod-np', { reservationId }),
      ),
    ).toMatchObject({ ok: true });

    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: departure,
      noPost: true,
    };
    expect(
      await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m-mod-np', modify)),
    ).toMatchObject({ ok: true });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.noPost).toBe(true);
    expect(await stub.listOutboxEventTypes()).toContain('reservation.modified');
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    expect(audit.ok && audit.rows.some((r) => r.commandId === 'reservations.modify')).toBe(true);
  });
```

Use `listAuditLog(TEST_OWNER_ACTOR, { reservationId })` — same pattern as `reservations-lifecycle.spec.ts`.

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t "noPost-only modify"
```

Expected: **FAIL** — early no-op or `no_post` unchanged.

- [ ] **Step 2: Apply Lock 3**

1. **Move** `applyNoPostIfPresentSync` call from ~8900 to immediately after `assertOccupancySync` (~8673), before no-op guard
2. **Add noPost-only branch** after rate-plan-only, before party-size-only:

```typescript
          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate &&
            nextAdults === reservation.adults &&
            nextChildren === reservation.children &&
            nextRatePlanId === reservation.rate_plan_id &&
            input.noPost !== undefined &&
            nextNoPost !== (reservation.no_post === 1)
          ) {
            const nights = enumerateStayDates(input.arrivalDate, input.departureDate);
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'reservation.modified',
              payload: {
                propertyId,
                reservationId: input.reservationId,
                guestRef: reservation.guest_ref,
                piiKeyId: reservation.pii_key_id,
                from: {
                  roomTypeId: reservation.room_type_id,
                  arrivalDate: reservation.arrival_date,
                  departureDate: reservation.departure_date,
                  adults: reservation.adults,
                  children: reservation.children,
                  noPost: reservation.no_post === 1,
                },
                to: {
                  roomTypeId: input.roomTypeId,
                  arrivalDate: input.arrivalDate,
                  departureDate: input.departureDate,
                  adults: nextAdults,
                  children: nextChildren,
                  noPost: nextNoPost,
                },
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.modify',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { noPost: reservation.no_post === 1 },
              afterJson: { noPost: nextNoPost },
              reservationId: input.reservationId,
            });
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: this.readAriVersionSync(),
              fromDate: nights[0]!,
              toDate: nights[nights.length - 1]!,
            };
          }
```

3. **Remove** duplicate `applyNoPostIfPresentSync` at ~8900

- [ ] **Step 3: Re-run spec — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t "noPost-only modify"
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test/reservations.spec.ts \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): honour noPost-only reservation modify

Apply noPost before no-op guards and treat flag-only changes as real mutations.
EOF
)"
```

---

### Task 4: B4 — cancel-policy error class + final verification

**Spec:** Lock 4, §4 #6–9, §8 checklist.

**Files:**
- Modify: `apps/pms-core/test/reservations-lifecycle.spec.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-b-business-logic-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-b-business-logic.md` — Task 4 checkboxes only

- [ ] **Step 1: Write failing B4 spec (red)**

Add to `apps/pms-core/test/reservations-lifecycle.spec.ts`:

```typescript
  it('misconfigured nights cancel policy returns INVALID_CANCEL_POLICY not RATE_MISSING', async () => {
    const name = `lc-inv-pol-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = addCalendarDays(added.fromDate, 2);
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;

    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: departure,
      status: 'confirmed',
      ratePlanId: 'BAR',
      cancelPenaltyType: 'nights',
      cancelGraceHours: 0,
      cancelPenaltyNights: 0,
    });
    await stub.bumpSoldForTest('rt_king', arrival, 1);

    const cancel = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('cancel-inv-pol', { reservationId }),
    );
    expect(cancel).toMatchObject({ ok: false, error: INVALID_CANCEL_POLICY });
    expect(cancel).not.toMatchObject({ error: RATE_MISSING });
  });
```

Import `INVALID_CANCEL_POLICY`, `RATE_MISSING` from `@hospai/contracts`.

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts -t "INVALID_CANCEL_POLICY"
```

Expected: **FAIL** — returns `RATE_MISSING` pre-fix.

- [ ] **Step 2: Apply Lock 4**

**`packages/contracts/src/idempotency.ts`** (~after `DERIVED_RATE_PLAN_WRITE_FORBIDDEN`):

```typescript
export const INVALID_CANCEL_POLICY = 'invalid_cancel_policy' as const;
```

**`property-do.ts`** — import `INVALID_CANCEL_POLICY`; replace throw in `penaltyMinor`; add mapper branch in `mapReservationPreconditionError` (~1183):

```typescript
  if (e instanceof InvalidCancelPolicyError) {
    return { ok: false, error: INVALID_CANCEL_POLICY };
  }
```

Optional hygiene — `tryCreateRatePlan` / `tryUpdateRatePlan` catch (~11835, ~12030):

```typescript
      if (e instanceof InvalidCancelPolicyError) return { ok: false, error: INVALID_CANCEL_POLICY };
```

**`v1-dispatch.ts`** — import `INVALID_CANCEL_POLICY`; add to 422 branch (~355):

```typescript
    error === INVALID_CANCEL_POLICY ||
```

- [ ] **Step 3: Re-run B4 spec — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts -t "INVALID_CANCEL_POLICY"
```

Expected: **PASS**.

- [ ] **Step 4: Re-run all Phase B test files**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/reservations-check-out-direct-bill.spec.ts \
  test/reservations.spec.ts \
  test/reservations-routes.spec.ts \
  test/reservations-lifecycle.spec.ts
```

Expected: **PASS**.

- [ ] **Step 5: Full local test loop — long pole (spec §4 #7)**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Run twice if feasible.

- [ ] **Step 6: All 14 `check:*` gates (spec §4 #8)**

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
```

Expected: all **PASS**.

- [ ] **Step 7: typecheck / build / lint (spec §4 #9)**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 8: Pin frozen heads (sanity — catalog must stay 89)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **89**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 33`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`.

- [ ] **Step 9: Tick spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-b-business-logic-design.md` §8.

- [ ] **Step 10: Tick Task 4 checkboxes in this plan only**

Do **not** tick Task 1–3 checkboxes retroactively unless already done during implementation.

- [ ] **Step 11: Commit**

```bash
git add apps/pms-core/test/reservations-lifecycle.spec.ts \
  packages/contracts/src/idempotency.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  docs/superpowers/specs/2026-08-15-audit-phase-b-business-logic-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-b-business-logic.md
git commit -m "$(cat <<'EOF'
fix(pms-core): map invalid cancel policy to INVALID_CANCEL_POLICY

Misconfigured nights penalty on reservation rows surfaces the correct wire
code instead of rate_missing. Register constant and 422 mapper branch.
EOF
)"
```

**Stop.** Phase **B** business-logic defects closed. Phase **C+** remains separate.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out-direct-bill.spec.ts` | Green — B1 | 1, 4 |
| 2 | `pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t "modify rate plan\|noPost-only"` | Green — B2/B3 | 2, 3, 4 |
| 3 | `pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "different ratePlanId"` | Green — B2 idempotency | 2, 4 |
| 4 | `pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts -t "INVALID_CANCEL_POLICY"` | Green — B4 | 4 |
| 5 | `pnpm test:local` | **Long pole** — 8 shards + non-pms-core green | 4 |
| 6 | All 14 `check:*` gates | Green | 4 |
| 7 | `pnpm typecheck` / `pnpm build` / `pnpm lint` | Green | 4 |
| 8 | Frozen heads pin commands | Catalog **89**, writers **63**, schema **33**, steps **8** | 4 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local` now that Phase A landed it. Per-file verification: `pnpm --filter @hospai/pms-core exec vitest run <file>`.

---

## Spec §8 reviewer checklist (Task 4 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| B1: scoped balance + three consumers | 1 |
| B1: direct-bill checkout spec | 1 |
| B2: input, no-op, rate-plan-only, UPDATE, re-snapshot | 2 |
| B2: rate plan modify spec | 2 |
| B3: applyNoPost move + noPost-only branch | 3 |
| B3: noPost-only spec | 3 |
| B4: penaltyMinor + constant + mappers | 4 |
| B4: misconfigured policy spec | 4 |
| Verify §4 #7–9 green | 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in (B1–B4 + tests) | 1–4 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–4 | 1–4 |
| §4 test plan | 1–4 |
| §6 file map | 1–4 |
| §8 checklist | 4 |
| Frozen heads §1.4 | unchanged all tasks |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §9). B4 adds one **error code constant** outside the catalog.

**Plan writer interpretations (flagged for reviewer):**

1. **B1 test file:** chose **new** `reservations-check-out-direct-bill.spec.ts` over extending `reservations-check-out.spec.ts` — spec allows either; isolates direct-bill scenario.
2. **B1 company setup:** locked **ROOM-only on COMPANY window + close → city ledger** (minimum repro §4.1) over `setupCompanyWindowAtZeroBalance` netting pattern — latter zeroes window before close and does not reproduce global-sum bug as cleanly.
3. **B2 tests split:** DO assertion in `reservations.spec.ts`; HTTP idempotency smoke in `reservations-routes.spec.ts` with new `patchReservation` helper — spec allows either file for §4 #3–4.
4. **Rate plan fixture IDs:** `BAR` / `CORP` per spec §9 ambiguity resolution (behaviour is plan-id agnostic).
5. **B3 audit assertion:** use `listAuditLog(TEST_OWNER_ACTOR, { reservationId })` per `reservations-lifecycle.spec.ts`.
6. **Task 1 Test 2:** red phase expects `BALANCE_DUE`; post-fix must invert to `{ ok: true }` — documented explicitly in Step 3.

**B2 re-snapshot product decision (restated):** When the rate plan changes (with or without date changes), **re-snapshot unconsumed stay nights at the new plan's amounts**. A night is **consumed** when a `folio_line` exists for that `reservation_id` + `business_date` with `charge_code IN ('ROOM', 'NO_SHOW')`. **Consumed nights** keep their existing snapshot amounts (posted room revenue is immutable).
