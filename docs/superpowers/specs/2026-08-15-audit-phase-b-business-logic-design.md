# Audit Phase B — business-logic defects (money / guest impact)

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **89**, `AUDIT_WRITER_COMMAND_IDS.size === 63`, `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'`, `PROPERTY_SCHEMA_HEAD === 33`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Phase A (`test:local`, scoped console assertions) is landed — local suite is trustworthy.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [Full codebase audit — remediation plan](../../audit/2026-08-15-full-codebase-audit.md) Phase **B** items **B1**–**B4**; ground rules (audit §Ground rules); [Do not fix](../../audit/2026-08-15-full-codebase-audit.md#do-not-fix--deliberate-decisions); appendix verification block.

**Closes:** Audit **B1** (checkout balance ignores folio windows), **B2** (`ratePlanId` silently ignored on modify), **B3** (`noPost` dead on modify), **B4** (wrong error class for misconfigured cancel policy). **Requires:** Phase A green. **Does not** advance Phase C+ or **D1** closed error-union refactor (B4 is a single-code touch only).

---

## Executive summary

Phase B fixes four live or latent business-logic defects with money or guest impact. **B1** scopes checkout `balanceMinor` to the **GUEST folio window only** (locked option **a**), aligning the balance query with the auto-invoice gate ten lines below. **B2** honours `ratePlanId` on `tryModifyReservation`, including a **rate-plan-only** branch and explicit re-snapshot semantics when dates are unchanged. **B3** moves `applyNoPostIfPresentSync` above early-return branches and treats `noPost`-only changes as real mutations. **B4** throws `InvalidCancelPolicyError` (formalized wire code) instead of `RateMissingError` for invalid `nights` penalty config in `penaltyMinor`. No schema migration; catalog length **89** unchanged.

---

## 1. Context & motivation

### 1.1 Problem statement

| Item | Severity | Symptom | Root cause |
|---|---|---|---|
| **B1** | critical | Corporate / direct-bill checkout blocked; spurious `folio.balance_due`; guest window never auto-closes | `tryCheckOut` sums `folio_line.ledger_amount_minor` across **all** windows for `reservation_id`; COMPANY direct-bill charges count against the guest |
| **B2** | high · latent | `PATCH` with changed `ratePlanId` returns 200 with old plan | `tryModifyReservation` input type omits `ratePlanId`; re-snapshot uses stale `reservation.rate_plan_id`; no-op early return ignores plan changes |
| **B3** | medium · latent | `noPost`-only modify would no-op | `applyNoPostIfPresentSync` runs after full-no-op and party-size-only returns |
| **B4** | low | Misconfigured cancel policy surfaces as "rate missing" | `penaltyMinor` throws `RateMissingError` when `cancel_penalty_type === 'nights'` and `count < 1` |

### 1.2 B1 — why option (a) GUEST-window-only (locked)

Two money gates in `tryCheckOut` disagree today:

| Location | Scope |
|---|---|
| Balance query `property-do.ts:9338–9344` | **Global** — all `folio_line` rows for `reservation_id` |
| Auto-invoice gate `property-do.ts:9353–9357` | **GUEST window** — `guestFolioWindowId(reservationId)` |

`guestFolioWindowId` is deterministic: `` `${reservationId}:GUEST` `` (`property-do.ts:13978–13980`).

**Option (a) rationale (normative):**

- A **COMPANY** window transferred to city ledger inserts `city_ledger_entry` (`property-do.ts:19050`) but posts **no offsetting credit** to `folio_line`. Charge lines remain with positive `ledger_amount_minor` and the same `reservation_id`, so a global sum treats settled direct-bill amounts as guest debt.
- A **COMPANY** window that exists **without** transfer (direct bill in progress, positive company-window balance) must **not** block guest checkout — that is precisely why option **(b)** (exclude transferred company windows) is wrong and **(a)** (guest obligation only) is correct.
- Option **(a)** matches the invoice gate and is the smallest fix.

**Scope-out:** B1 option **(b)** machinery; **E4** client checkout override copy (server half only here).

### 1.3 B2 — modify is the sole commandPayload mismatch

Systematic sweep (audit): all 39 `commandPayload` → `try*` pairs were diffed; **`reservations.modify` / `tryModifyReservation` is the only mismatch**. HTTP already sends `ratePlanId` (`v1-dispatch.ts:1939`, `:1965`) and fingerprints it (`:1948–1956`).

### 1.4 Heads (frozen — this chunk moves nothing on catalog / routes / schema)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — no new commands; error codes live in `packages/contracts/src/idempotency.ts`, not the catalog |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** |

**B4 note:** may add `INVALID_CANCEL_POLICY = 'invalid_cancel_policy'` to `idempotency.ts`. That is a **wire error constant**, not a `COMMAND_CATALOG` row — catalog length **must not** move.

### 1.5 Scope in

1. **B1** — GUEST-window-scoped balance in `tryCheckOut` (Lock 1).
2. **B2** — honour `ratePlanId` on modify + re-snapshot semantics (Lock 2).
3. **B3** — fix `noPost` ordering and no-op detection (Lock 3).
4. **B4** — correct error class in `penaltyMinor` + wire registration (Lock 4).
5. **Tests** — one focused spec per item (§6).

### 1.6 Scope out (normative)

- **D1** closed error-union refactor — B4 adds at most one constant + mapper lines; no typed union sweep
- **E4** client-side checkout override copy
- B1 option **(b)** (exclude transferred COMPANY windows)
- Rate limiting, schema migrations, Phase **C** and later audit items
- HTTP / client wiring of `noPost` on modify (B3 fixes DO path only; route body already omits `noPost` today)
- Widening `overrideBalance` to paper over B1

---

## 2. Locked decisions (verbatim — do not deviate)

### Lock 1 — B1: GUEST-window-only checkout balance

Replace the global balance query in `tryCheckOut` with the existing per-window helper.

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

**Helper (already exists — do not duplicate SQL):** `windowBalanceMinorSync` at `property-do.ts:14035–14043`:

```ts
private windowBalanceMinorSync(folioWindowId: string): number {
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS balance FROM folio_line WHERE folio_window_id = ?`,
      folioWindowId,
    )
    .toArray() as Array<{ balance: number }>;
  return Number(rows[0]?.balance ?? 0);
}
```

Apply this **same** `balanceMinor` to all three consumers (do not fix only the throw):

| Consumer | Line | Behaviour |
|---|---|---|
| `BalanceDueError` throw | ~9349 | `requireZero && balanceMinor > 0 && !(override…)` |
| `folio.balance_due` outbox | ~9405–9417 | emit when `balanceMinor > 0` |
| Guest window auto-close | ~9434–9439 | `close_window_on_check_out === true && balanceMinor === 0` |

The auto-close block (~9435) already recomputes `guestWindowId` — **reuse** the variable from the balance computation (single `guestWindowId` binding at top of balance section) to avoid double lookup; behaviour unchanged.

**Do not** change `tryCloseFolioWindow` window balance logic, city-ledger posting, or override semantics.

### Lock 2 — B2: honour `ratePlanId` on modify

#### 2a — Input type and reservation read

Add to `tryModifyReservation` input (`property-do.ts:8586–8594`):

```ts
ratePlanId?: string;
```

Extend the reservation `SELECT` (~8645) with `no_post` (needed for B3) and keep `rate_plan_id` (already selected).

Early in the transaction, after loading `reservation`:

```ts
const nextRatePlanId = input.ratePlanId ?? reservation.rate_plan_id;
if (input.ratePlanId !== undefined) {
  this.assertActiveRatePlanSync(input.ratePlanId);
}
```

#### 2b — No-op detection must include rate plan and noPost

**Full no-op** guard (~8675–8689) — add conjuncts so rate-plan-only and noPost-only changes do not no-op:

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

Do **not** enter the sold-night release/acquire path for plan-only changes.

#### 2d — Full modify path

In the main `UPDATE reservation` blocks (~8872–8898):

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

When dates change **and** plan changes in the same request, the full path handles both; do not double-call re-snapshot.

#### 2e — Re-snapshot product decision (normative)

**Current behaviour** (`syncReservationRateNightsOnModifySync`, `property-do.ts:7570–7606`):

- Deletes `reservation_rate_night` rows only for nights **removed** from the stay (and not consumed by posted `ROOM` / `NO_SHOW` folio lines).
- Inserts snapshots only for nights **added** to the stay.
- When dates are **unchanged**, `added` is empty and existing snapshots are **untouched** — a plan-only change would leave stale amounts without additional logic.

**Locked product decision:** When the rate plan changes (with or without date changes), **re-snapshot unconsumed stay nights at the new plan's amounts**. A night is **consumed** when a `folio_line` exists for that `reservation_id` + `business_date` with `charge_code IN ('ROOM', 'NO_SHOW')` — same guard as the delete loop in `syncReservationRateNightsOnModifySync` (~7581–7590).

Implement **`resnapshotRateNightsForPlanChangeSync`** (private, same file):

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

Call from: (1) rate-plan-only branch; (2) full modify path when `nextRatePlanId !== reservation.rate_plan_id` after `syncReservationRateNightsOnModifySync` (covers date+plan combined — re-snapshot overlapping unconsumed nights at new plan).

**Consumed nights** keep their existing snapshot amounts (posted room revenue is immutable).

#### 2f — Idempotency fingerprint (no change to HTTP)

Keep `ratePlanId` in `fingerprintPayload` at `v1-dispatch.ts:1948–1956`. **Consequence once B2 lands:** two modify requests differing only in `ratePlanId` hash differently **and** produce different effects — correct. Document in commit message; no fingerprint change.

Update the stale JSDoc fingerprint comment on `tryModifyReservation` (~8582) to mention optional `ratePlanId`, `adults`, `children`, `noPost`.

### Lock 3 — B3: `noPost` on modify

#### 3a — Move `applyNoPostIfPresentSync` above early returns

**Remove** the call at `property-do.ts:8900` (after main UPDATE).

**Insert** immediately after `assertOccupancySync` (~8673), **before** the full-no-op guard:

```ts
this.applyNoPostIfPresentSync(input.reservationId, input.noPost);
```

`applyNoPostIfPresentSync` (`property-do.ts:7455–7462`) no-ops when `noPost === undefined`; safe to call once up front.

#### 3b — NoPost-only branch (mirror party-size-only)

When room type, dates, adults, children, **and rate plan** are unchanged **but** `input.noPost !== undefined` and `nextNoPost !== (reservation.no_post === 1)`:

1. `applyNoPostIfPresentSync` already ran — do not call again
2. Append `reservation.modified` outbox (`from` / `to` include `noPost`)
3. Append audit row
4. Return success without inventory / rate-night work

**Ordering relative to B2:** evaluate rate-plan-only branch **before** noPost-only branch (plan change is money-affecting; noPost-only is flags-only).

#### 3c — Party-size-only branch

Leave structure at ~8692–8746; `applyNoPostIfPresentSync` already applied up front when `input.noPost` present.

### Lock 4 — B4: misconfigured cancel policy error class

#### 4a — Throw site

In `penaltyMinor` (`property-do.ts:7549–7551`), replace:

```ts
if (count < 1) throw new RateMissingError(row.arrival_date);
```

with:

```ts
if (count < 1) throw new InvalidCancelPolicyError();
```

`InvalidCancelPolicyError` already exists (`property-do.ts:996–1000`); constructor message is `'invalid_cancel_policy'`.

#### 4b — Wire constant (formalize string literal)

Add to `packages/contracts/src/idempotency.ts` (near rate-plan codes ~97–102):

```ts
export const INVALID_CANCEL_POLICY = 'invalid_cancel_policy' as const;
```

Replace ad-hoc `'invalid_cancel_policy'` string returns in `tryCreateRatePlan` / `tryUpdateRatePlan` catch blocks (`property-do.ts:11835`, `:12030`) with `INVALID_CANCEL_POLICY` — optional hygiene in same task, not required for B4 proof.

#### 4c — `mapReservationPreconditionError`

Add before the final `return null` (~1183):

```ts
if (e instanceof InvalidCancelPolicyError) {
  return { ok: false, error: INVALID_CANCEL_POLICY };
}
```

Import `INVALID_CANCEL_POLICY` from `@hospai/contracts`. This covers `tryCancelReservation` (~8497) and `tryMarkNoShow` (~9655) paths that call `penaltyMinor` inside `mapReservationPreconditionError`-wrapped catches.

#### 4d — HTTP status mapper

Add `INVALID_CANCEL_POLICY` to the **422** branch of `mapReservationCommandErrorStatus` in `v1-dispatch.ts` (~355, alongside `RATE_MISSING`). **D1 interaction:** this is a single-code addition to the untyped string ladder — do **not** refactor the union in this phase.

**Do not** change `normalizeRatePlanPolicy` validation (~1059–1063) — plan-level validation remains; B4 fixes defensive runtime data on the reservation row.

---

## 3. Failure mechanisms (research → locked)

### 3.1 B1 — checkout balance vs windows

```
tryCheckOut
    │
    ├─► balanceMinor = SUM(folio_line) WHERE reservation_id     ← BUG (global)
    │
    ├─► BalanceDueError if balanceMinor > 0
    ├─► folio.balance_due if balanceMinor > 0
    └─► auto-close GUEST if balanceMinor === 0

    ├─► guestWindowId = guestFolioWindowId()                    ← correct scope
    └─► hasActiveInvoiceForWindowSync(guestWindowId)            ← correct scope
```

After fix, all four uses agree: **guest window obligation only**.

### 3.2 B2 — modify rate plan silent drop

```
PATCH body.ratePlanId
    → v1-dispatch commandPayload (includes ratePlanId)
    → tryModifyReservation input type (no ratePlanId)
    → early no-op if dates/rt/party unchanged
    → syncReservationRateNightsOnModifySync(..., reservation.rate_plan_id, ...)
```

### 3.3 B3 — noPost early return

```
tryModifyReservation
    ├─► full no-op return (~8676)     ← noPost not compared
    ├─► party-size-only return (~8692)
    ├─► … inventory path …
    └─► applyNoPostIfPresentSync (~8900)   ← unreachable for noPost-only
```

### 3.4 B4 — wrong error taxonomy

```
penaltyMinor: cancel_penalty_type === 'nights', count < 1
    → RateMissingError(date)        ← wrong operator message
normalizeRatePlanPolicy validates nights >= 1 at plan write
    → branch is defensive for corrupt reservation row
```

---

## 4. Test plan

| # | Item | File (new or extend) | Assertion |
|---|---|---|---|
| 1 | **B1** | Extend `apps/pms-core/test/reservations-check-out.spec.ts` or new `reservations-check-out-direct-bill.spec.ts` | Checked-in stay; GUEST window balance **0**; COMPANY window with positive receivable; `city_ledger_entry` posted for company window (use `setupCompanyWindowAtZeroBalance` + `tryCloseFolioWindow` from `city-ledger.spec.ts` pattern, or `seedCityLedgerEntryForTest` + `insertFolioLineRawForTest`); enable `pms.folio.close_window_on_check_out`; `tryCheckOut` **without** `overrideBalance` → `{ ok: true }`; outbox **excludes** `folio.balance_due`; GUEST window **CLOSED** |
| 2 | **B1 regression** | Same file | Pre-fix sanity: global reservation sum **>** 0 while GUEST window sum **===** 0 (proves test exercises the bug class) |
| 3 | **B2** | Extend `apps/pms-core/test/reservations-routes.spec.ts` or `reservations.spec.ts` | Create on plan `BAR` (or `rp_bar`); seed distinct `rate_day` amounts for `BAR` vs `CORP`; `PATCH` / `tryModifyReservation` with `ratePlanId: 'CORP'`, unchanged dates → `rate_plan_id === 'CORP'`; `reservation_rate_night` amounts match **CORP** `rate_day` rows |
| 4 | **B2 idempotency** | Same file | Two keys with same payload except `ratePlanId` are distinct fingerprints (existing HTTP path — smoke only) |
| 5 | **B3** | Extend `apps/pms-core/test/reservations.spec.ts` | Confirmed reservation; `tryModifyReservation` with only `{ noPost: true }` (other fields unchanged) → `no_post === 1`; audit row `commandId === 'reservations.modify'`; outbox contains `reservation.modified` |
| 6 | **B4** | New case in `apps/pms-core/test/reservations-lifecycle.spec.ts` or cancel spec | Insert reservation with `cancel_penalty_type: 'nights'`, `cancel_penalty_nights: 0` (bypass plan validation via test helper); `tryCancelReservation` → `{ ok: false, error: INVALID_CANCEL_POLICY }` — **not** `RATE_MISSING` |
| 7 | Suite | — | `pnpm test:local` green (twice if feasible) |
| 8 | Gates | — | All 14 `check:*` green |
| 9 | Build | — | `pnpm typecheck`, `pnpm build`, `pnpm lint` |

**TDD order:** B1 test (red) → B1 fix → B2 test → B2 fix → B3 test → B3 fix → B4 test → B4 fix → full suite.

### 4.1 B1 test setup notes (locked)

Reuse helpers from `apps/pms-core/test/city-ledger.spec.ts`:

- `setupCompanyWindowAtZeroBalance` — posts ROOM + PAYMENT netting to zero, then close posts city ledger
- `stayCheckedIn` from `folio-windows.spec.ts` / `reservations-check-out.spec.ts`

**Minimum repro for pre-fix failure:** GUEST window net **0**, COMPANY window net **> 0** (e.g. direct-billed ROOM on `:COMPANY:` window without guest-window offset). City ledger entry proves employer transfer path; closed COMPANY window is optional but documents production shape.

---

## 5. Rollback / migration notes

| Scenario | Action |
|---|---|
| B1 revert | Restore global `reservation_id` balance query — direct-bill checkout breaks again |
| B2 revert | Remove `ratePlanId` from DO input — HTTP silently ignores plan again |
| B3 revert | Move `applyNoPostIfPresentSync` back below early returns |
| B4 revert | Restore `RateMissingError` throw — misconfigured policy mislabeled |
| Schema | None — `PROPERTY_SCHEMA_HEAD` stays **33** |
| Catalog | None — length stays **89** |

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/src/property-do.ts` | B1 balance scope (~9338–9344, consumers ~9349, ~9405, ~9434); B2 input type (~8586), SELECT (~8645), no-op (~8675), rate-plan-only branch (new), UPDATE (~8872–8898), sync call (~8906), new `resnapshotRateNightsForPlanChangeSync`; B3 `applyNoPostIfPresentSync` move + noPost-only branch; B4 `penaltyMinor` (~7551), `mapReservationPreconditionError` (~1183) |
| `packages/contracts/src/idempotency.ts` | `INVALID_CANCEL_POLICY` export (B4) |
| `apps/pms-core/src/v1-dispatch.ts` | `mapReservationCommandErrorStatus` — add `INVALID_CANCEL_POLICY` → 422 |
| `apps/pms-core/test/*` | Four test cases per §4 |

**Not touched:** `COMMAND_CATALOG`, HTTP routes, schema migrations, `web-pms`, `client-core`, Phase C+ items.

---

## 7. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Checkout blocked by company direct-bill charges (B1) | GUEST-window `windowBalanceMinorSync` |
| 2 | Modify ignores `ratePlanId` (B2) | Input honour + re-snapshot |
| 3 | `noPost` dead on modify (B3) | Early apply + noPost-only branch |
| 4 | Wrong cancel-policy error (B4) | `InvalidCancelPolicyError` + wire code |

**Still open (explicit):**

| Item | Owner |
|---|---|
| D1 closed error union | Phase D |
| E4 checkout override client copy | Phase E |
| Wire `noPost` on PATCH body | Future client vertical |

---

## 8. Implementation checklist

- [ ] B1: scoped balance + three consumers aligned (Lock 1)
- [ ] B1: direct-bill checkout spec (§4 #1–2)
- [ ] B2: input type, no-op guards, rate-plan-only branch, UPDATE, re-snapshot helper (Lock 2)
- [ ] B2: rate plan modify spec (§4 #3–4)
- [ ] B3: `applyNoPostIfPresentSync` move + noPost-only branch (Lock 3)
- [ ] B3: noPost-only spec (§4 #5)
- [ ] B4: `penaltyMinor` + constant + mappers (Lock 4)
- [ ] B4: misconfigured policy spec (§4 #6)
- [ ] Verify §4 #7–9 green

---

## 9. Tree conflicts with reviewer locks

**None on heads.** Catalog **89**, writers **63**, route tail `[143]`, schema **33**, night-audit steps **8** unchanged. B4 adds one **error code constant** outside the catalog.

**Ambiguities resolved in this spec:**

| Question | Resolution |
|---|---|
| B1 (a) vs (b) | **(a) GUEST-window-only** — locked by reviewer; reasoning in §1.2 |
| B2 re-snapshot when dates unchanged | **Re-snapshot unconsumed nights at new plan amounts**; consumed nights frozen (Lock 2e) |
| B2 no-op when only rate plan changes | Include `nextRatePlanId` in no-op guard + dedicated rate-plan-only branch (Lock 2b–c) |
| B3 vs B2 ordering | Rate-plan-only before noPost-only; `applyNoPostIfPresentSync` once before no-op guard |
| B4 new code vs existing class | Use existing `InvalidCancelPolicyError`; formalize `INVALID_CANCEL_POLICY` in contracts (Lock 4) |
| Catalog length moves? | **No** — error codes are not catalog entries (§1.4) |
| D1 interaction | Single mapper line only; no union refactor (scope-out) |
| Audit verify ids `rp_bar` / `rp_corp` | Accept `BAR` / `CORP` if matching existing test fixtures — behaviour is plan-id agnostic |

---

## 10. Exact code changes summary (for reviewer return)

### B1 — `property-do.ts`

| Line(s) | Change |
|---|---|
| **9338–9344** | Replace global SQL with `guestWindowId` + `windowBalanceMinorSync(guestWindowId)` |
| **9349** | Uses scoped `balanceMinor` (no logic change) |
| **9405–9417** | Uses scoped `balanceMinor` (no logic change) |
| **9434–9439** | Uses scoped `balanceMinor`; reuse `guestWindowId` binding |

Helper: **`14035–14043`** `windowBalanceMinorSync`; **`13978–13980`** `guestFolioWindowId`.

### B2 — `property-do.ts` + HTTP unchanged

| Line(s) | Change |
|---|---|
| **8586–8594** | Add `ratePlanId?: string` to input type |
| **8645** | Add `no_post` to SELECT |
| **~8670** | Compute `nextRatePlanId`, conditional `assertActiveRatePlanSync` |
| **8675–8689** | Extend no-op guard with rate plan + noPost |
| **new ~8691** | Rate-plan-only branch |
| **8872–8898** | Write `rate_plan_id` when plan changes |
| **8906** | Pass `nextRatePlanId` to sync |
| **new method** | `resnapshotRateNightsForPlanChangeSync` |
| **8582** | JSDoc fingerprint comment |

**Re-snapshot product decision:** plan change → unconsumed nights re-snapshot at new plan amounts; consumed nights unchanged (Lock 2e).

**Idempotency:** `v1-dispatch.ts:1948–1956` — keep `ratePlanId` in fingerprint; now effectful.

### B3 — `property-do.ts`

| Line(s) | Change |
|---|---|
| **~8673** | Move `applyNoPostIfPresentSync` here (remove **8900**) |
| **8675–8689** | Include `noPost` in no-op guard |
| **new branch** | noPost-only path (audit + outbox + return) |

### B4 — `property-do.ts` + contracts + dispatch

| Line(s) | Change |
|---|---|
| **7551** | `throw new InvalidCancelPolicyError()` |
| **~1183** | `mapReservationPreconditionError` → `INVALID_CANCEL_POLICY` |
| **`idempotency.ts`** | `export const INVALID_CANCEL_POLICY = 'invalid_cancel_policy'` |
| **`v1-dispatch.ts:~355`** | Map `INVALID_CANCEL_POLICY` → 422 |
