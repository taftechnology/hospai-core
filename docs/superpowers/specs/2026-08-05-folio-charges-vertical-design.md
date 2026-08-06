# Folio Vertical — Charges (Not Payments)

**Date:** 2026-08-05
**Status:** Revised (v3 — `readFolio` is read-only: balance keyed on `folio_line.reservation_id`, `window` optional/`null`; `ensureGuestFolioWindowSync` stays at three write call sites; `gateCoreEntitlement` explicit in `tryAddFolioLine` restructure; test 3/11a/17 construction fixes; §2.4 step 5 blocker corrected to async/`gatePermission` inside sync `execute()`)
**Sources:** ARCHITECTURE.md §4.6 (degraded mode), §7.3 (multi-currency / folio contract), §8 (night-audit step sequence), §14 (Phase 1 sequencing — folio depends on degraded mode); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [degraded-mode server slice](./2026-08-04-degraded-mode-server-design.md) (§7.1 actor/`gatePermission` signature pattern this spec extends to folio; §7.4 replay dispatch registry); [reservations vertical](./2026-08-04-reservations-vertical-design.md) (status-machine `try*` shape this mirrors)

---

## 1. Context & Motivation

Folio is the most-built, least-reachable part of the system. `folio_window` and `folio_line` are fully migrated in Phase 0's freeze-gate DDL — multi-currency columns (`txn_currency`, `ledger_amount_minor`, `fx_rate`, `fx_rate_at`), `split_of` for charge splitting, and a partial unique index on `(reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` that makes night-audit posting idempotent by construction without an application-level dedupe check. `tryAddFolioLine` exists and emits `folio.line_posted`.

None of it is reachable: 22 HTTP routes, zero touch folio. Five catalog commands, zero routes. `folio:read` is granted to all three roles and used by nothing.

**The larger problem it's masking:** `POST_ROOM_CHARGES` — the night-audit step that should post nightly room revenue for every in-house reservation — is a no-op stub (`property-do.ts` `runAuditStep`, the `else` branch: *"PRE_CHECK / money / ops stubs ... always `COMPLETED` here"*). Night audit marks the step `COMPLETED` and rolls the business date without posting a single dollar of room revenue. That gap widens by one property-night every time night audit runs, silently, with a `COMPLETED` status that gives no indication anything is missing.

This slice closes both: it makes the schema reachable over HTTP, and it makes `POST_ROOM_CHARGES` real.

**Scope in:**
1. `tryAddFolioLine` signature pass — `(actor, input, idem, provisional?)`, `gatePermission(actor, 'folio:post')`, guard as the first statement inside `execute()`. Identical shape to `tryCheckIn`/`tryCheckOut`/`tryCancelCheckIn` (§7.3 of the degraded-mode spec), and it is what makes degraded-suite test 8 (`folio.add_item` + block + replay → no double-posted line) implementable — the one hole the degraded-mode spec's own matrix left open pending this slice.
2. Four HTTP routes: `POST …/reservations/:rid/folio/lines` (`folio.add_item`), `GET …/reservations/:rid/folio` (`folio:read`, windows + lines + balance — first real consumer of `degradedRead`), `POST …/folio/lines/:lineId/split` (`folio.split_charge`), plus their route-audit rows.
3. `POST_ROOM_CHARGES`, implemented for real: one room-revenue line per in-house reservation for the closing date, `source = 'NIGHT_AUDIT'`, rate from `rate_day`. The existing partial unique index gives exactly-once for free, which is why this can run safely inside `runAuditStep`'s Txn B without a separate dedupe check.
4. The Phase 1 money rule: `ledger_amount_minor` / `fx_rate` / `fx_rate_at` are schema-ready with nothing meaningfully populating them yet. Settle it once, in one place.

**Scope out — payments.** `folio.authorize` / `folio.capture` / `folio.split_charge_payment` need a new table, a PSP boundary, an authorize/capture state machine, and settlement reconciliation. All three are `FAIL_CLOSED`, carry no entitlement, and already sit in `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` with `'Phase 1 — not yet gated at a DO boundary'`. That opt-out reason stays valid after this slice — unlike `reservations.no_show`'s in the prior slice, payments genuinely have no DO boundary yet, because there is no payments vertical yet. Next slice, and the one where getting the external-service boundary wrong is expensive.

---

## 2. Design Decisions

### 2.1 `folio.split_charge` — the commutativity question, settled before code

`folio.split_charge` is catalogued `QUEUE_PROVISIONAL`. Its payload references a `folioLineId` — the line being split. Queue delivery order is best-effort (§4.6: *"Queues do not guarantee it"*), so a split can replay **before** the check-in-shaped, last-writer-wins commands this pattern was proven on. Concretely: operator posts a charge while degraded (queues as `folio.add_item`), then immediately splits it (queues as `folio.split_charge`) — replay order is not guaranteed to preserve that sequence, and a split arriving first references a `folioLineId` that does not exist yet in the DO.

§4.6's actual admission test is commutativity, and the reservation-vertical slice verified it three times over (check-in/check-out/cancel-check-in all touch one row, keyed by `reservation_id`, last-writer-wins). `folio.split_charge` is the first command in the system where that test **genuinely fails**: splitting a not-yet-applied line is not "apply in either order and get the same result," it's "apply in the wrong order and get an error, or worse, silently no-op."

**Resolution: `folio.split_charge` becomes `FAIL_CLOSED` for Phase 1.**

```diff
   {
     id: 'folio.split_charge',
     prototypeAction: 'SPLIT_FOLIO_CHARGE',
     lane: 'INTERACTIVE',
-    degraded: 'QUEUE_PROVISIONAL',
+    degraded: 'FAIL_CLOSED',
     idempotent: true,
     events: ['folio.line_posted'],
     notes: 'Non-payment splits. Payment-bearing splits use folio.split_charge_payment.',
+    entitlement: 'pms.core',
     permission: 'folio:adjust',
   },
```

`entitlement: 'pms.core'` is added in the same edit — a newly-`FAIL_CLOSED` command with a non-empty `events` array needs either an entitlement or an opt-out row (`check:entitlements`), and there's no "not yet gated" story here: this slice **is** implementing the DO boundary, so the honest answer is to gate it, matching its sibling `folio.add_item`.

**This also means `handlePostFolioSplit` never goes through `invokePropertyDo`'s `QUEUE_PROVISIONAL` branch** — a transport failure on split returns the standard degraded `503` with `Retry-After`, same as create/modify/cancel reservation. No replay-dispatch registry entry for `folio.split_charge`.

### 2.2 Folio window — lazy and idempotent, not create-once

`POST .../folio/lines` and `postRoomChargesSync` need a `folio_window` row to attach lines to, and **nothing today creates one on the live path.** `GET .../folio` does not — `folio_line` carries `reservation_id` ([property-migrations.ts:43](../../../packages/do-runtime/src/property-migrations.ts:43)), so a read can select lines and sum `balanceMinor` keyed on `reservation_id` alone, never touching `folio_window`. `createFolioWindow` exists on `PropertyDO` but is called only from `property-do.spec.ts` fixtures — `tryCreateReservation` never calls it. The catalog has no "open window" command either; folio's five commands assume a window already exists.

**Rejected first pass: create-once in `tryCreateReservation`.** Opening the `GUEST` window only at booking time is correct going forward but wrong for every reservation that already exists — and a PropertyDO does not get to choose which reservations predate a deploy. Making a missing window a hard failure (as §2.4 originally did) means the **first night audit after this ships** hits an in-house reservation with no window on any property with existing bookings, throws, and halts the step — `ROLL_BUSINESS_DATE` never runs, and the property is frozen at a stale business date until someone manually backfills. That is not a data problem surfacing correctly (the right outcome for a missing rate, §2.4); it is a self-inflicted outage on the one path that must never stop, triggered by deploying this slice rather than by any bad input.

**Resolution: window creation is lazy and idempotent — `ensureGuestFolioWindowSync(reservationId)`**, a private synchronous helper:

```sql
INSERT OR IGNORE INTO folio_window (folio_window_id, reservation_id, kind, status)
VALUES (?, ?, 'GUEST', 'OPEN')   -- folio_window_id = `${reservationId}:GUEST`
```

The deterministic id (`` `${reservationId}:GUEST` ``) is what makes `INSERT OR IGNORE` exactly correct — a second call for the same reservation is a no-op, so there's no read-then-branch needed and no race between concurrent callers. Called from **three** places, each of which needs a window to exist right now and none of which should care whether it already does:

1. `tryCreateReservation` — new bookings get their window immediately, no lazy gap for the common case.
2. `tryAddFolioLine` (via the HTTP route) — covers every reservation that predates this slice, on first use, with zero backfill migration required.
3. `postRoomChargesSync` — covers a reservation that somehow reaches night audit without ever having posted a manual charge.

No new client input, no new required field on `POST /reservations` — its request contract is unchanged. This removes the entire "pre-slice data" failure class this spec originally introduced: **there is no longer a `FOLIO_WINDOW_NOT_FOUND` case to handle**, because nothing that resolves to a real reservation can fail to have a window by the time any folio operation runs.

`POST .../folio/lines` takes **`reservationId`**, never a client-supplied `folioWindowId` — the route resolves the reservation's `GUEST` window internally after `ensureGuestFolioWindowSync` guarantees it exists on write. `GET .../folio` also takes `reservationId` only; it returns the `GUEST` window as optional metadata (`window: null` when none exists yet — honest, costs nothing) and never calls `ensureGuestFolioWindowSync`. Multi-window folios (`COMPANY`/`MASTER`, split billing) stay out of scope — `createFolioWindow` already supports the `kind`; the HTTP surface for anything beyond one `GUEST` window per stay is a later slice.

### 2.3 The Phase 1 money rule — settled in exactly one place

The schema supports real multi-currency (§7.3): a charge posted in one currency, converted to the property's ledger currency at a recorded rate and instant. Real FX rate sourcing is explicitly **"still owed"** per ARCHITECTURE.md's revision notes — there is no rate feed yet.

**Resolution: Phase 1 posts only in the property's ledger currency, identity rate.** Enforced in exactly one place — inside `tryAddFolioLine` itself, which already reads `ledgerCurrency` synchronously and already owns `validateFolioLineMoney`:

- `input.txnCurrency`, `input.fxRate`, `input.fxRateAt`, `input.ledgerAmountMinor` all become **optional**.
- When `txnCurrency` is omitted, the method fills in `txnCurrency = ledgerCurrency`, `fxRate = '1'`, `fxRateAt = Date.now()`, `ledgerAmountMinor = input.amountMinor` before calling `assertPostedMatches` — which then simply confirms the identity, rather than performing a real conversion.
- When `txnCurrency` **is** supplied and differs from `ledgerCurrency`, the method rejects with a new `CROSS_CURRENCY_UNSUPPORTED` — Phase 1 honesty rather than accepting an input it cannot correctly convert. This constant belongs in `packages/contracts/src/money.ts`, alongside `MONEY_INVALID`/`FX_RATE_INVALID`/`LEDGER_AMOUNT_MISMATCH`/`CURRENCY_UNSET` — it's a money-validation outcome, not an idempotency one, and `money.ts` is where its siblings already live.

Both callers that matter for reachability — the `POST .../folio/lines` HTTP handler and the new `POST_ROOM_CHARGES` step — omit the money fields entirely and let `tryAddFolioLine` settle them. One rule, one place, both callers automatically compliant; neither has to know the Phase 1 policy exists.

`assertPostedMatches`'s general-currency path is untouched — the schema and the money package stay ready for real FX sourcing later; this slice only decides what the two Phase 1 callers *send*.

### 2.4 `POST_ROOM_CHARGES` — implementation

Replaces the `else` no-op branch in `runAuditStep`'s Txn B, for `step === 'POST_ROOM_CHARGES'` specifically (the other stub steps — `PRE_CHECK`, `PROCESS_NO_SHOWS`, `CLOSE_CASHIER_SHIFTS`, `SNAPSHOT_REPORTS` — are unchanged and out of scope):

```ts
} else if (step === 'POST_ROOM_CHARGES') {
  this.postRoomChargesSync(businessDate);
} else {
  // PRE_CHECK / PROCESS_NO_SHOWS / CLOSE_CASHIER_SHIFTS / SNAPSHOT_REPORTS — still stubs.
}
```

`postRoomChargesSync(businessDate)`, fully synchronous (§2.6 below), for each row from:

```sql
SELECT reservation_id, room_type_id, guest_ref, pii_key_id
FROM reservation
WHERE status IN ('confirmed', 'checked_in')
  AND arrival_date <= ? AND departure_date > ?   -- businessDate
```

(the same in-house predicate `countConfirmedReservationsCovering` already uses, widened to include `checked_in` — a checked-in guest is exactly as in-house as a confirmed one for room-revenue purposes, and excluding them would under-post revenue for every property that actually uses the status machine this slice's predecessor built):

1. Look up `rate_day` for exactly `(room_type_id, 'BAR', businessDate)` — **one row, one night**, same `'BAR'` default the existing `quoteStay` RPC uses for consistency, but **not a call to `quoteStay` itself**: `quoteStay` enumerates and sums every night from `arrivalDate` to `departureDate` for a *stay quote*, and calling it here would post the full remaining-stay total on every single night of that stay — a three-night, $100/night stay would post $300 on night one, $300 again on night two, $300 again on night three. `postRoomChargesSync` reads `rate_day` directly for the single closing `businessDate` and posts exactly that row's `amount_minor`. No range enumeration, no `quoteStay` import in this path.
2. **Missing rate → throw a new `RateMissingError` class.** The constant `RATE_MISSING` already exists and is what `quoteStay`'s RPC *returns* on a miss (`{ ok: false, error: RATE_MISSING, date }`) — but nothing in the codebase throws it, and `postRoomChargesSync` needs a throw here (not a return), matching `RoomTypeNotFoundError`'s convention, because it must unwind the whole step, not just skip one reservation. New class: `class RateMissingError extends Error { constructor(public readonly date: string) { super(\`...${RATE_MISSING}...\`) } }`. **On the night-audit path, `mapReservationPreconditionError` is never consulted** — `postRoomChargesSync` throws inside `runAuditStep`'s Txn B, and the existing `catch` stores `e.message` verbatim in `night_audit_run.error`. Test 17's assertion therefore depends on the constructor's `super(...)` string containing `rate_missing`, and that is the requirement to write down. An optional `mapReservationPreconditionError` entry (alongside `RoomTypeNotFoundError → NOT_FOUND`) is harmless but buys nothing today — no `try*` method surfaces this throw. This is a `reads-then-decides` failure inside the same transaction as every other reservation's posting for this step — the throw propagates out of `postRoomChargesSync`, out of Txn B, which rolls back **every** room charge posted so far in this step, and `runAuditStep`'s existing `catch` marks the step `FAILED`. Night audit halts (`night-audit-workflow.ts` already exits without advancing on any `FAILED` row). This is correct, not a regression: a property missing a BAR rate for tonight has a data problem that must surface as a halted audit, not eleven correctly-priced rooms and one silently unbilled one.
3. `ensureGuestFolioWindowSync(reservationId)` (§2.2) — guarantees a window exists; never fails, never throws, so this step is no longer a place a missing window can halt the audit.
4. `folioLineId = ${reservationId}:room:${businessDate}` (deterministic — makes the line idempotent by id as well as by the partial unique index, belt-and-braces).
5. Call the same `tryAddFolioLine`-shaped insert logic directly (not the public `try*` method — it is `async`, and `gatePermission` awaits an OrgDO RPC, which cannot run inside `runIdempotent`'s synchronous `execute()` closure; §2.6.2). Extract the insert body of `tryAddFolioLine` into a private synchronous helper, `insertFolioLineSync`, called by both `tryAddFolioLine`'s `execute()` and `postRoomChargesSync` — this is the second call site for the Phase 1 money rule, and it's why §2.3 put that rule inside a helper rather than the RPC boundary.
6. `chargeCode = 'ROOM'`, `amountMinor = <the single `rate_day` row's `amount_minor` from step 1>`, `source = 'NIGHT_AUDIT'`, `businessDate` — exactly the fields the partial unique index (`(reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'`) keys on, which is what makes step re-runs (a retried `RUNNING` attempt, per `runAuditStep`'s existing `ON CONFLICT ... attempt = attempt + 1` retry path) exactly-once without `postRoomChargesSync` needing its own dedupe check.
7. Emit `folio.line_posted` per line, same payload shape `tryAddFolioLine` already emits.

No `ariVersion` bump, no `availability.changed` — room charges don't move inventory.

### 2.5 Precise error types on `tryAddFolioLine` — closing the wide-`string` gap

Today: `Promise<{ ok: true } | { ok: false; error: string }>`. The status-machine commands got precise discriminated unions specifically so the HTTP mapper could switch on `result.error` without string comparison against magic values. Folio didn't get that treatment, and the four money-validation branches (`FX_RATE_INVALID`, `LEDGER_AMOUNT_MISMATCH`, `MONEY_INVALID`, `CURRENCY_UNSET`) already exist as named constants but aren't reflected in the return type. Widen it:

```ts
Promise<
  | { ok: true; folioLineId: string; ledgerAmountMinor: number }
  | { ok: false; error: typeof CURRENCY_UNSET }
  | { ok: false; error: typeof FX_RATE_INVALID }
  | { ok: false; error: typeof LEDGER_AMOUNT_MISMATCH }
  | { ok: false; error: typeof MONEY_INVALID }
  | { ok: false; error: typeof CROSS_CURRENCY_UNSUPPORTED }
  | { ok: false; error: typeof NOT_FOUND }               // reservation not found — window is guaranteed by ensureGuestFolioWindowSync (§2.2), so this is unambiguous
  | { ok: false; error: typeof FORBIDDEN | 'not_member' }
  | { ok: false; error: typeof BUSINESS_DATE_CLOSED }     // provisional replay only
  | { ok: false; error: string }                          // narrow escape hatch, not the contract
>
```

### 2.6 Three traps, named so they don't get rediscovered mid-implementation

1. **§4.6 rule 5 — folio failures are always exceptions, never best-effort.** The three status commands never exercised this because none of them can fail partway through a multi-row operation. `folio.add_item`'s replay path must not, on domain rejection (e.g. `CROSS_CURRENCY_UNSUPPORTED` somehow reaching replay, or a future validation), silently drop the command — it goes to `provisional_exception` like every other replay domain failure, via the existing consumer flow (§7.4 of the degraded-mode spec: `{ ok: false, error }` → insert exception, ack). This slice doesn't have to build new machinery for this — it has to **not bypass** the machinery the degraded-mode slice already built, which is the actual risk (easy to special-case "well it's just a folio line" and hand-roll a shortcut).
2. **`POST_ROOM_CHARGES` runs inside `transactionSync` — it must be fully synchronous, no `await`.** `rate_day` and `folio_window` are both local SQLite reads, so `postRoomChargesSync` is a pure `this.ctx.storage.sql.exec(...)` sequence — no network, no `assertEntitled` round trip (this step is system-initiated, not user-actor-gated, matching `night_audit.run`'s own `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` reasoning). This rules out calling the public `tryAddFolioLine` from inside the sync closure — it is `async` and its pre-transaction gates (`gateCoreEntitlement`, `gatePermission`) await OrgDO RPCs. The extracted `insertFolioLineSync` helper (§2.4 step 5) has no `await` in its signature, by construction.
3. **The status commands never posted money, so nothing before this slice exercised `runIdempotent`'s no-await constraint against a *multi-row* operation.** `postRoomChargesSync` iterates every in-house reservation for the property inside one `execute()` closure — still zero `await`s, but worth stating because "loop over N reservations" is a more inviting place to accidentally reach for an async helper than the single-row `try*` methods this pattern was proven on.

---

## 3. File Changes

### `packages/contracts/src/commands/catalog.ts` [MODIFY]

`folio.split_charge` → `FAIL_CLOSED` + `entitlement: 'pms.core'` (§2.1 diff above).

### `packages/contracts/src/money.ts` [MODIFY]

```ts
export const CROSS_CURRENCY_UNSUPPORTED = 'cross_currency_unsupported' as const;
```
Alongside the existing `MONEY_INVALID` / `FX_RATE_INVALID` / `LEDGER_AMOUNT_MISMATCH` / `CURRENCY_UNSET` — same file, same category of error. (No `FOLIO_WINDOW_NOT_FOUND` — §2.2's lazy-creation fix removes the case it would have represented.)

### `packages/contracts/src/idempotency.ts` [MODIFY]

```ts
export const SPLIT_AMOUNT_MISMATCH = 'split_amount_mismatch' as const;
```
(§5.2 — resolved: dedicated code, same reasoning `LEDGER_AMOUNT_MISMATCH` already gets for the analogous folio-money-doesn't-add-up case one method over.)

### `packages/do-runtime/src/property-migrations.ts` [MODIFY]

Purely additive index — no table rebuild, no FK concerns. **Version 10, not 9** — `0009_provisional_exception.sql` already shipped in `7402d66`, and `PROPERTY_MIGRATIONS` is already at `version: 9`:

```ts
/** v10-additive — index for per-reservation folio window lookup (POST .../folio/lines, GET .../folio). */
export const FOLIO_WINDOW_RESERVATION_INDEX_STATEMENTS: string[] = [
  `CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id)`,
];
```
Append to `PROPERTY_MIGRATIONS`. Regenerate `migrations/do-property/0010_folio_window_reservation_idx.sql` via `pnpm generate:ddl` — let the generator assign the number; don't hand-pick it a second time.

### `apps/pms-core/src/property-do.ts` [MODIFY]

1. **`ensureGuestFolioWindowSync(reservationId)`** (§2.2) — new private synchronous helper, `INSERT OR IGNORE INTO folio_window (folio_window_id, reservation_id, kind, status) VALUES (`${reservationId}:GUEST`, ?, 'GUEST', 'OPEN')`. No outbox event — window creation isn't a catalog command and nothing downstream needs to know about an empty window; the first `folio.line_posted` is the observable signal that folio activity started.
2. **`tryCreateReservation`** — after the existing `INSERT INTO reservation`, call `ensureGuestFolioWindowSync(input.reservationId)` in the same transaction.
3. **`insertFolioLineSync`** — new private synchronous helper extracted from `tryAddFolioLine`'s current insert body (the `INSERT INTO folio_line` + `appendPropertyOutbox` block), taking the already-validated `PostedLineAmount` plus `folioLineId`/`folioWindowId`/`reservationId`/`chargeCode`/`source`/`businessDate`. No `await` anywhere in its body (§2.6.2).
4. **`tryAddFolioLine`** signature becomes `(actor, input, idem, provisional?)`:
   - `this.lanes.touchInteractive()`, `orgId`/`propertyId` preconditions (unchanged, return-style, before `runIdempotent`)
   - `gateCoreEntitlement(orgId)` — **must remain.** The method already calls this today; `folio.add_item` carries `entitlement: 'pms.core'`. Status commands deliberately omit it (they are `QUEUE_PROVISIONAL` with `entitlement: undefined`); copying their shape verbatim during this restructure would silently delete a gate that must stay.
   - `gatePermission(actor, 'folio:post')` — skipped for `actor.kind === 'system'` (replay), matching §7.3 of the degraded-mode spec
   - `input.txnCurrency` etc. become optional; Phase 1 defaulting + `CROSS_CURRENCY_UNSUPPORTED` check (§2.3) happens before `validateFolioLineMoney`
   - Inside `execute()`: `assertProvisionalBusinessDateOpen(provisional)` first (same helper the status commands use — `folio.add_item` is `QUEUE_PROVISIONAL`, so this is load-bearing, not decorative), then `ensureGuestFolioWindowSync(input.reservationId)` — never fails, so this is no longer a branch that can return an error — then look up the (now guaranteed) `folio_window_id` for the reservation, then `insertFolioLineSync`. `postRoomChargesSync` calls `ensureGuestFolioWindowSync` + `insertFolioLineSync` directly rather than the public `try*` (§2.6.2 — async gates cannot run inside the sync closure).
   - `catch`: `mapReservationPreconditionError` unchanged for this method — there is no new throw-class here; `NOT_FOUND` still covers "no such reservation," which is the only not-found case left once the window is guaranteed.
5. **`tryAddFolioLine` also gains `folio.split_charge`'s implementation — `trySplitFolioLine`** (new method, `FAIL_CLOSED` per §2.1, so **no** `provisional` parameter — nothing calls this from the replay consumer):
   ```ts
   async trySplitFolioLine(
     actor: ActorContext,
     input: { sourceFolioLineId: string; splits: Array<{ folioLineId: string; amountMinor: number }> },
     idem: IdempotencyKey,
   ): Promise<{ ok: true; folioLineIds: string[] } | { ok: false; error: typeof NOT_FOUND }
              | { ok: false; error: typeof SPLIT_AMOUNT_MISMATCH }
              | { ok: false; error: typeof FORBIDDEN | 'not_member' } | { ok: false; error: string }>
   ```
   Reads the source line, verifies `sum(splits.amountMinor) === source.amount_minor` — mismatch returns `SPLIT_AMOUNT_MISMATCH` (§5.2, resolved: dedicated code, not a generic `422`, for the same reason `LEDGER_AMOUNT_MISMATCH` gets precision on the analogous folio-money-doesn't-add-up case one method over) — inserts N new lines each with `split_of = sourceFolioLineId` and the source's `txn_currency`/`fx_rate`/`fx_rate_at` carried forward unchanged (a split doesn't re-price), and does **not** delete or zero the source line — `split_of` makes the relationship queryable; reversing the source line, if desired, is a separate operation. **Correction to a misattributed citation in an earlier draft:** the "reverse + two posts" reasoning for a future `folio.split_charge_v2` lives in `PLATFORM_GAPS` in [catalog.ts:466](../../../packages/contracts/src/commands/catalog.ts:466), not in `entitlements.ts` (`PLATFORM_GAPS` and `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` are different lists with different semantics — one records unimplemented prototype actions, the other records entitlement-check exemptions). The argument stands; the earlier pointer to it didn't. This spec's split is additive-only, matching what the schema's `split_of` column supports today without inventing the reversal semantics that gap entry is reserving.
6. **New read RPC** `readFolio(reservationId: string)` — **read-only, no writes:**
   ```ts
   async readFolio(reservationId: string): Promise<
     | { ok: true; window: { folioWindowId: string; kind: string; status: string } | null;
         lines: Array<{ folioLineId: string; chargeCode: string; amountMinor: number; ledgerAmountMinor: number;
                         txnCurrency: string; source: string | null; businessDate: string | null; splitOf: string | null;
                         createdAt: number }>;
         balanceMinor: number }
     | { ok: false; error: typeof NOT_FOUND }
   >
   ```
   Verify the reservation exists first (`NOT_FOUND` if not). Select lines with `WHERE reservation_id = ?` — `folio_line.reservation_id` is the balance key; do not call `ensureGuestFolioWindowSync`. Optionally `SELECT` the `GUEST` window row for metadata; `window` is `null` when none exists yet (reservation exists, no window, no lines — a valid pre-first-charge state). `balanceMinor = sum(ledger_amount_minor)` across all lines for the reservation.

### `packages/contracts/src/v1-http-routes.ts` [MODIFY]

Append at indices 22–24 (current array ends at `put_restriction_days`, index 21):

```ts
  { id: 'post_folio_lines', scope: 'property', permission: 'folio:post', commandId: 'folio.add_item' },
  { id: 'get_folio', scope: 'property', permission: 'folio:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
  { id: 'post_folio_split', scope: 'property', permission: 'folio:adjust', commandId: 'folio.split_charge' },
```

(`get_folio` carries `entitlement: 'pms.core'` explicitly — no `commandId` to derive it from, same pattern as `get_reservation`; folio balance is product data under the rule the reservations-vertical spec established.)

**`get_folio` is `FAIL_CLOSED`, resolving open question 1 (§5.1) against the earlier draft's `READ_STALE` lean.** The checkout argument for `READ_STALE` was real — a stale-but-present balance is more useful mid-outage than a refusal — but it's an argument for **building a folio projection**, not for the label. This slice builds no such projection: on DO transport failure there is nothing behind `get_folio` to serve, so a route audited `READ_STALE` would return the identical `503`-with-no-data a `FAIL_CLOSED` route returns today. `get_reservation` already established the principle for exactly this situation — *"honest refusal, not fake stale data"* (degraded-mode spec §3.3) — and a route audit field that claims a capability the route doesn't have makes `READ_STALE` mean two different things depending on which route you're looking at, which `check:degraded` cannot distinguish (it checks the field is set, not that a projection backs it). `get_folio` reclassifies to `READ_STALE` in a follow-on slice, when a folio KV projection actually exists to serve from — not before.

### `apps/pms-core/src/v1-dispatch.ts` [MODIFY]

Three new handlers, following the `handlePostReservationStatusAction`/`handlePatchReservation` shapes exactly:

| Route | Pattern | Notes |
|---|---|---|
| `post_folio_lines` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/lines$/` | Body: `{ chargeCode: string; amountMinor: number; idempotencyKey: string }` — no `txnCurrency`/`fxRate`/`ledgerAmountMinor` accepted from the wire at all (§2.3); goes through `invokePropertyDo` with `commandId: 'folio.add_item'` so a transport failure queues (`QUEUE_PROVISIONAL`) exactly like check-in |
| `get_folio` | `GET` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio$/` | No body; on DO transport failure, degraded `503` with `degraded: 'FAIL_CLOSED'` (§3) — no `invokePropertyDo` queueing path (it's a read) |
| `post_folio_split` | `POST` `/^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/split$/` | Body: `{ splits: Array<{ folioLineId: string; amountMinor: number }>; idempotencyKey: string }`; `commandId: 'folio.split_charge'`, now `FAIL_CLOSED` (§2.1) — transport failure returns degraded `503`, never queues |

`mapReservationCommandErrorStatus` extends: `CURRENCY_UNSET`/`FX_RATE_INVALID`/`LEDGER_AMOUNT_MISMATCH`/`MONEY_INVALID`/`CROSS_CURRENCY_UNSUPPORTED` → `422`; `SPLIT_AMOUNT_MISMATCH` → `422`.

### `apps/pms-core/src/pending-commands-consumer.ts` [MODIFY]

Add to `REPLAY_DISPATCH` — the one entry the degraded-mode spec's §7.4 table already reserved a row for:

```ts
  'folio.add_item': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryAddFolioLine(REPLAY_ACTOR, payload as AddFolioLineInput, idem, ctx),
  },
```

No entry for `folio.split_charge` — it's `FAIL_CLOSED` now (§2.1), never queued, never replayed.

---

## 4. Test Matrix

New file `apps/pms-core/test/folio-routes.spec.ts`:

| # | Test | Assertion |
|---|---|---|
| 1 | `POST /reservations` (existing route) creates a reservation | `folio_window` row exists with `kind = 'GUEST'`, `status = 'OPEN'`, deterministic id |
| 2 | `POST .../folio/lines` valid charge | `201`, `folio.line_posted` on outbox, line has `txnCurrency = ledgerCurrency`, `fxRate = '1'` |
| 3 | Reservation inserted via SQL (no `folio_window` row — simulating pre-slice data); `POST .../folio/lines` | `201`, `folio_window` row created lazily by `ensureGuestFolioWindowSync`, line posted. **Cannot** delete an existing window after a line is posted — `folio_line.folio_window_id` FKs to `folio_window` with `PRAGMA foreign_keys = ON` in the PropertyDO constructor ([property-do.ts:353](../../../apps/pms-core/src/property-do.ts:353)), so "post, delete window, post again" is an invalid setup, not a test. Lazy window creation on the night-audit write path is test 20. |
| 4 | `GET .../folio` after two posted lines | `200`, `balanceMinor` = sum, both lines present |
| 5 | `GET .../folio` on a reservation with no lines and no `folio_window` row yet | `200`, `lines: []`, `balanceMinor: 0`, `window: null` — read path creates nothing |
| 6 | `POST .../folio/split` splitting a line into two whose amounts sum to the source | `200`, two new lines with `split_of = sourceId`, source line unchanged and still present |
| 7 | `POST .../folio/split` with splits not summing to the source amount | `422 split_amount_mismatch` |
| 8 | Non-member user on any folio route | `404` (RBAC privacy, matching convention) |
| 9 | `staff` role on `POST .../folio/lines` | `200` (`folio:post` granted to staff) |
| 10 | `staff` role on `POST .../folio/split` | `403 forbidden` (`folio:adjust` **not** granted to staff — owner/admin only) |
| 11 | Active kill-switch (KV `kill:pms.core` set) on all three folio routes | `503`, empty body, no `Retry-After` — the kill-switch gate runs before tenant/permission resolution and is unrelated to any specific route's entitlement |
| 11a | Org with no `pms.core` subscription calling `POST .../folio/lines` via HTTP | `402`, body `{ error: 'entitlement_required', feature: 'pms.core' }` — refused at the dispatcher's `gateEntitlement` edge gate ([v1-dispatch.ts:1388](../../../apps/pms-core/src/v1-dispatch.ts:1388)) before the DO is invoked; distinct from test 11's kill-switch `503` |
| 11b | Same unentitled org, `stub.tryAddFolioLine(...)` called directly on the PropertyDO | `{ ok: false, error: ENTITLEMENT_REQUIRED }` from the DO's own `gateCoreEntitlement` — the path HTTP never reaches because the edge gate runs first |
| 12 | `check:entitlements` after the catalog edit | `folio.split_charge` has `entitlement` set; regression check confirms removing it fails the script |

Extend `apps/pms-core/test/degraded-mode.spec.ts` (§10 of the degraded-mode spec explicitly listed folio as test 8, pending this slice):

| # | Scenario | Assertion |
|---|---|---|
| 13 (= degraded-suite 8) | `POST .../folio/lines` while blocked, then unblock + replay | `202` on admission, one `folio_line` row after replay, one `folio.line_posted` event — no double post |
| 14 | `POST .../folio/split` while blocked | Degraded `503`, **not** queued — proves the `FAIL_CLOSED` reclassification actually took effect at the dispatcher, not just in the catalog |
| 15 | Duplicate `folio.add_item` replay (same idempotency key twice) | One mutation, one event — DO dedupe, same as reservation status commands |

Extend `apps/pms-core/test/night-audit*.spec.ts` (or new `night-audit-room-charges.spec.ts`):

| # | Scenario | Assertion |
|---|---|---|
| 16 | Two in-house reservations (one `confirmed`, one `checked_in`), room type A priced $100/night, room type B priced $150/night, both covering a 3-night stay through the closing business date | `POST_ROOM_CHARGES` → `COMPLETED`, two `folio_line` rows, `charge_code = 'ROOM'`, `source = 'NIGHT_AUDIT'`, correct `business_date`, **`amount_minor` equals exactly that night's `rate_day` row — 10000 and 15000 respectively, not the 3-night stay total (30000 / 45000)**. This is the assertion the original draft omitted; it's the one that would have caught blocking 1. |
| 17 | One in-house reservation, room type has **no** `BAR` rate for the closing date | Step → `FAILED`, `night_audit_run.error` mentions `rate_missing` (verbatim from `RateMissingError`'s constructor message — `runAuditStep`'s catch, not `mapReservationPreconditionError`), **zero** `folio_line` rows inserted (whole-step rollback, not partial), night audit halts (no `ROLL_BUSINESS_DATE` attempted) |
| 18 | Re-run `POST_ROOM_CHARGES` for a date already `COMPLETED` | Short-circuits at the top of `runAuditStep` (existing behavior) — no duplicate lines |
| 19 | Retry an attempt that partially ran before a transient `FAILED` (simulate via existing `setRollFailureForTest`-style hook, or a new `postRoomChargesFailureForTest`) | Partial unique index prevents duplicate `(reservation_id, business_date, 'ROOM')` rows even without `postRoomChargesSync`'s own dedupe check |
| 20 | In-house reservation created **before** this slice (fixture inserts directly via SQL, bypassing `tryCreateReservation`, so it has no `folio_window` row) reaches night audit | Step → `COMPLETED` — `ensureGuestFolioWindowSync` creates the missing window inline, one `folio_line` row posted normally. This replaces the earlier draft's test 20, which asserted a halt here; §2.2's fix makes that halt impossible by construction, and this test exists specifically to prove it. |

---

## 5. Open Questions — Resolved

1. **`get_folio`'s `degradedRead` classification. Resolved: `FAIL_CLOSED`.** The checkout argument for `READ_STALE` is real but is an argument for building a projection, not for the label — this slice ships no projection, so `READ_STALE` would describe a capability the route doesn't have. Reclassify when a real folio KV projection lands (§3, `get_folio` entry).
2. **`trySplitFolioLine`'s non-conserving-split error. Resolved: dedicated `SPLIT_AMOUNT_MISMATCH`**, matching the precision `LEDGER_AMOUNT_MISMATCH` already gets for the analogous case one method over (§3, `property-do.ts` item 5).
3. **`postRoomChargesSync`'s in-house predicate. Resolved: include `checked_in`.** The predicate `status IN ('confirmed', 'checked_in')` correctly excludes `checked_out`/`no_show`/`cancelled`, which is the part that matters; excluding `checked_in` would under-post revenue for every property using the status machine with no offsetting benefit.

---

## 6. Implementation Checklist

- [ ] `folio.split_charge` → `FAIL_CLOSED` + `entitlement: 'pms.core'` in `catalog.ts` (§2.1) — single commit, both fields.
- [ ] `CROSS_CURRENCY_UNSUPPORTED` in `packages/contracts/src/money.ts` (not `idempotency.ts`); `SPLIT_AMOUNT_MISMATCH` in `idempotency.ts`.
- [ ] `folio_window_reservation_idx` migration — **version 10**; regenerate `migrations/do-property/0010_*.sql` and let the generator assign the number.
- [ ] `ensureGuestFolioWindowSync` — `INSERT OR IGNORE`, called from **`tryCreateReservation`, `tryAddFolioLine`, and `postRoomChargesSync` only** (§2.2 — three write call sites; `readFolio` does not call it). No `FOLIO_WINDOW_NOT_FOUND` case exists anywhere in this slice.
- [ ] `insertFolioLineSync` extracted; `tryAddFolioLine` signature pass (`actor`, `provisional?`, **`gateCoreEntitlement`**, `gatePermission`, precise error union, Phase 1 money defaulting — §2.3, §2.5).
- [ ] `RateMissingError` — new throwable class; constructor `super(...)` message must contain `rate_missing` (test 17 reads `night_audit_run.error` verbatim). Optional `mapReservationPreconditionError` entry — no `try*` path surfaces this throw today.
- [ ] `trySplitFolioLine` — conservation check → `SPLIT_AMOUNT_MISMATCH`, `split_of` on new lines, source line untouched.
- [ ] `readFolio` RPC — read-only; balance keyed on `folio_line.reservation_id`; `window` optional (`null` when no `folio_window` row yet).
- [ ] `POST_ROOM_CHARGES` real implementation in `runAuditStep` (§2.4) — **posts the single night's `rate_day.amount_minor`, never `quoteStay`'s stay total; do not import `quoteStay` into this path.** Verify zero `await` anywhere in `postRoomChargesSync` (§2.6.2/3).
- [ ] Three route-audit rows (indices 22–24, `get_folio` → `degradedRead: 'FAIL_CLOSED'`) + three dispatcher handlers + `mapReservationCommandErrorStatus` extension (`SPLIT_AMOUNT_MISMATCH` → 422, no `FOLIO_WINDOW_NOT_FOUND` mapping needed).
- [ ] `REPLAY_DISPATCH['folio.add_item']` in `pending-commands-consumer.ts`.
- [ ] `apps/pms-core/test/folio-routes.spec.ts` (14 cases incl. 11a/11b), degraded-suite additions (3 cases, closing degraded-mode spec's own test 8), night-audit room-charges cases (5 cases) — **test 16 must assert the per-night `amount_minor`, not just row count/charge_code/source.**
- [ ] `pnpm build`, `check:ddl`, `check:degraded`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`.
