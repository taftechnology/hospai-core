# Partial refunds (folio money ops leftover 4)

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** ARCHITECTURE.md §4.6 (payments `FAIL_CLOSED`), §7.3 (append-only ledger; `payment.refunded` = reversing line, never mutate capture; payments↔folio events carry no PAN), §8 (`NIGHT_AUDIT_STEPS` pin); [folio money operations](./2026-08-12-folio-money-operations-design.md) §6.3 (full refund baseline; leftover 4); [multi-currency folio](./2026-08-13-multi-currency-folio-design.md) (chargebacks closed; partial refunds were scope-out); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) (`folio_line_payment_uidx`, simulate adapter); `packages/contracts/src/commands/catalog.ts` (`folio.refund`); `packages/contracts/src/v1-http-routes.ts` (`post_folio_refund`); `packages/contracts/src/events/payment.ts` (`PaymentRefundedV1`); `packages/contracts/src/idempotency.ts` / `packages/contracts/src/money.ts` (wire codes); `packages/do-runtime/src/idempotency.ts` (`runIdempotent`); `apps/pms-core/src/property-do.ts` (`tryRefundPayment`, `applyPaymentEventSync`, `listPaymentsForReservation`, `tryRecordChargeback`); `apps/pms-core/src/v1-dispatch.ts` (`handlePostFolioRefund`); `apps/pms-core/src/psp-simulate.ts` (`simulateRefund`); `packages/client-core/src/api.ts` (`refundPayment`, `FolioPaymentRow`); `apps/web-pms/src/screens/FolioScreen.tsx`; `migrations/do-property/0021_folio_money_ops.sql` / `0024_multi_currency_folio.sql` (`refunded_amount_minor`); `apps/pms-core/test/folio-payment-lifecycle.spec.ts`; `apps/pms-core/test/folio-fx-payments.spec.ts`

**Closes:** [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **4 remainder** — **partial refunds** on captured card/cash payments. Chargebacks already shipped in [multi-currency folio](./2026-08-13-multi-currency-folio-design.md). Dry run 2 is skipped. DEMO-READY P2 still lists virtual types (stale) — **out of this chunk**; do not edit DEMO-READY here.

**Amends:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §6.3 (full-refund-only → partial + remaining semantics; fingerprint widened). [multi-currency folio](./2026-08-13-multi-currency-folio-design.md) scope-out “partial refunds remain” — **closed here**. Bidirectional one-sentence pointers in those specs are **Task of the final implementation**, not this spec writer’s job.

---

## 1. Context & Motivation

Desk can authorize, capture (including partial capture amount), void, refund (**full only today**), chargeback, and split payment lines. Folio-money-ops §6.3 shipped `folio.refund` as a one-shot full reversal: `tryRefundPayment` derives `refundAmount = captured_amount_minor ?? amount_minor`, always flips `status = 'refunded'`, and `applyPaymentEventSync` posts `Math.abs(capture.amount_minor)` — the **entire** capture — onto one line id `` `${paymentId}:refund` ``. The column `refunded_amount_minor` exists from v21 (copied through v24/v27) but is **never written**. Operators need multiple partial refunds against one capture until remainder hits zero.

This chunk extends the **existing** command and route — no new catalog id, no new HTTP audit row, no schema migration. Breaking change: HTTP/RPC **require** `amountMinor` (positive integer). Full refund = client sends **remaining**.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Command | `folio.refund` — `catalog.ts` ~463–471: `INTERACTIVE`, `FAIL_CLOSED`, `idempotent: true`, `permission: 'folio:adjust'`, events `['folio.payment_refunded', 'folio.line_posted', 'payment.refunded']`. Already in `AUDIT_WRITER_COMMAND_IDS` (`audit-writers.ts` ~32). |
| HTTP route | `[101] post_folio_refund` — `v1-http-routes.ts` ~565–570; handler `handlePostFolioRefund` ~5000–5035. Body today: `{ idempotencyKey }` only; fingerprint `{ paymentId }` only (~5008–5009). **Do not move audit index `[101]`.** |
| Route head | `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (`register.test.ts` ~619). Length **128**; next free **128**. |
| Refund DO path | `tryRefundPayment` ~14431–14566: gates `folio:adjust`; if `status === 'refunded'` + matching `refund_fingerprint` → idempotent; else `captured` only; full amount; CARD calls `simulateRefund` **outside** `transactionSync`; txn sets `status = 'refunded'` + `refund_fingerprint` then `applyPaymentEventSync` `payment.refunded`. **Does not use `runIdempotent` or peek `idempotency` table.** |
| Event apply (buggy for partials) | `applyPaymentEventSync` `payment.refunded` ~13475–13523: posts `Math.abs(capture.amount_minor)` (full capture); `UPDATE status = 'refunded'` always; default line id `` `${paymentId}:refund` `` (~13498). |
| `refunded_amount_minor` column | `0021_folio_money_ops.sql` ~42–43; copied `0024_multi_currency_folio.sql` ~31–32; `property-migrations.ts` ~679–680, ~857–858. **Unused** — not in `PaymentRow` (~287–312) or `readPaymentRowSync` SELECT (~13217–13221). |
| Remaining (today implicit) | Full refund only: `refundAmount = payment.captured_amount_minor ?? payment.amount_minor` (~14468). |
| PSP simulate | `simulateRefund` ~82–95: accepts `{ paymentId, amountMinor, gatewayReference, currency }`; returns `capturedAmountMinor: input.amountMinor`. |
| Capture line | One negative `PAYMENT` line per payment via `folio_line_payment_uidx` (`0013_payment.sql` / v21 rebuild). Refund lines: `source = 'PAYMENT_REFUND'`, `payment_id = NULL`, `split_of` = capture line. |
| Payment status CHECK | v21: `pending \| authorized \| declined \| captured \| unknown \| voided \| refunded` (`0021_folio_money_ops.sql` ~28). **No `partially_refunded`.** Do not rebuild CHECK. |
| Chargeback | `tryRecordChargeback` ~14568–14668: `captured` only (plus idempotent `chargeback` replay). No partial-refund guard today. |
| GET payments | `listPaymentsForReservation` ~15366–15439; `readPayment` / `mapPaymentRow` ~13654–13683 — no `refundedAmountMinor`. |
| Client | `refundPayment` ~908–917: body `{ idempotencyKey }` only. `FolioPaymentRow` ~105–128: no `refundedAmountMinor`. |
| SPA | Refund one-click full when `p.status === 'captured' && canAdjust` (~868–877). Idempotency op `refund:${paymentId}:${uuid}` (~668). Capture already has amount field defaulting to remaining (~827–855). `data-testid={`refund-payment-${p.paymentId}`}` preserved. Staff without `folio:adjust`: refund hidden (`FolioScreen.test.tsx` ~616–658). |
| Tests (must update) | `folio-payment-lifecycle.spec.ts` cases **28–31** (~118–212): call `tryRefundPayment` with `{ paymentId }` only; expect full refund / `:refund` line id. `folio-fx-payments.spec.ts` case **15** (~152–194): full refund, line id `` `${paymentId}:refund` ``. |
| Catalog / audit / gaps | `COMMAND_CATALOG` length **77** (`register.test.ts` ~627). `AUDIT_WRITER_COMMAND_IDS.size === 52` (~626, ~268). `PLATFORM_GAPS = []` (~628, `catalog.ts` ~866). |
| Schema heads | `PROPERTY_SCHEMA_HEAD === 27` (`migrate.test.ts` ~618; latest migration `property-migrations.ts` ~1136 `virtual_room_types`). `ORG_SCHEMA_HEAD === 7` (~619). **No v28.** |
| Night audit | `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1053–1061). |
| Idempotency helper | `runIdempotent` — peek `SELECT request_fingerprint, response FROM idempotency WHERE key = ?` (`idempotency.ts` ~29–48). Hybrid peek pattern exists on `tryCaptureDueHolds` ~14806–14819. `lookupIdempotentResponse` ~4045–4054. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** (widen refund POST body + GET payment JSON only) |
| `COMMAND_CATALOG` | length **77** | **77** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **27** | **27** (no migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |

### 1.2 Scope in

1. **`amountMinor` required** on `POST …/folio/payments/:payId/refund` and `tryRefundPayment` RPC input — positive integer txn minor units. Full refund = client sends **remaining**.
2. Fingerprint **`{ paymentId, amountMinor }`** (HTTP + RPC idempotency).
3. **Remaining** stored on payment: write `refunded_amount_minor`; status stays **`captured`** until remaining `=== 0`, then **`refunded`**. No new status value.
4. Each successful refund: one append-only **`PAYMENT_REFUND`** line for **this** amount; capture line **never mutated**.
5. Fix **`applyPaymentEventSync` `payment.refunded`** to honour `payload.amountMinor`, accumulate `refunded_amount_minor`, deterministic line ids `` `${paymentId}:refund:${n}` ``, set `refunded` only when remainder hits 0.
6. **Hybrid idempotency:** peek `idempotency` before PSP; `runIdempotent` inside txn for ledger write (mirror authorize/capture-due pattern).
7. Wire code **`refund_exceeds_remaining`** for over-refund; chargeback guard when `refunded_amount_minor > 0`.
8. Widened GET payment shapes + SPA amount field (default remaining).
9. Tests §8.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- City ledger / AR, invoices, night-audit auto-transfer, growing `NIGHT_AUDIT_STEPS`
- Recurring charges / `breakfast_rule` engine
- Real PSP / PCI Worker; simulate adapter stays
- Authorization expiry / `unknown` reconciliation exit
- **Chargeback of remainder after partial refund** (named leftover — reject with `PAYMENT_NOT_CHARGEBACKABLE` when any refund posted, but do not implement remainder chargeback amount)
- Taxable discounts, stay-level discount, promo codes
- New catalog command / new HTTP audit row / schema v28
- Guest CRM depth, virtual-type leftovers, `rooms.delete`
- Demo seed rewrite; dry run 2
- Changing capture to multi-shot partial captures (capture stays one-shot per payment)
- New `export class`; `CLASS_DENYLIST` untouched
- `PROPERTY_PURGE_INVENTORY_TABLES` unchanged (no new table)
- `ui-kit` adoption / Tailwind / new hex — existing tokens; `check:web-pms-colors` clean
- Resurrecting `PLATFORM_GAPS` ids

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Folio append-only.** Never `UPDATE folio_line.amount_minor` / `ledger_amount_minor`. Capture line is immutable; each refund is a new positive reversing line.
2. **Payments `FAIL_CLOSED`.** Refund never queued on provisional replay. Lane / degraded unchanged on `folio.refund`.
3. **Money integers.** `amountMinor` must be a positive integer (`Number.isInteger` && `> 0`); else `MONEY_INVALID` (`packages/contracts/src/money.ts` ~2). `runIdempotent` is **sync-only** inside `transactionSync`; PSP adapter (`simulateRefund`) runs **async outside** the txn.
4. **Events carry no PAN.** Last-4 / brand already on payment row from prior flows; event payloads unchanged in that regard.
5. **Remaining uses stored `refunded_amount_minor`.**  
   `remainingMinor = (captured_amount_minor ?? amount_minor) - COALESCE(refunded_amount_minor, 0)`.  
   Do **not** derive remaining by scanning reservation folio lines (ledger scan for **line id suffix** when minting `:refund:n` is allowed — count existing `PAYMENT_REFUND` lines linked via `split_of` to the capture line).
6. **`folio_line_payment_uidx` unchanged.** Exactly one capture line with non-null `payment_id` per payment; refund lines keep `payment_id = NULL`.
7. **No `partially_refunded` status.** Partial progress is visible via `status === 'captured'` + `refundedAmountMinor > 0` on reads.
8. **FX on refund lines uses capture’s frozen rate.** Copy `fx_rate` / `fx_rate_at` from the capture line (same pattern as chargeback copy ~13554–13566); do not re-quote FX at refund time.
9. **`payment.refunded` v1 contract version stays 1.** `PaymentRefundedV1.amountMinor` = **this refund’s** txn amount (update comment only in `payment.ts` ~34). Do **not** bump `PAYMENT_EVENT_CONTRACT_VERSION`.
10. **Route audit `[101] = post_folio_refund` unmoved.** Last row stays `[127] = post_demo_seed`.
11. **`NIGHT_AUDIT_STEPS` stays seven.** Demo seed unchanged.
12. **`PLATFORM_GAPS` stays `[]`.** No new catalog id.

---

## 3. Remaining & payment row (normative)

### 3.1 Definitions

| Field | Meaning |
|---|---|
| `captured_amount_minor ?? amount_minor` | Total captured txn amount (partial capture already supported at capture time) |
| `refunded_amount_minor` | Cumulative txn amount refunded so far; `NULL` treated as `0` on reads |
| `remainingMinor` | `capturedBase - refundedBase` as above |

### 3.2 Status rules

| Before | Refund `amountMinor` | After (if success) |
|---|---|---|
| `captured` | `amountMinor < remainingMinor` | `captured`; `refunded_amount_minor += amountMinor` |
| `captured` | `amountMinor === remainingMinor` | `refunded`; `refunded_amount_minor = capturedBase` |
| `refunded` | same fingerprint as prior full refund | idempotent success (existing `refund_fingerprint` path ~14459–14463) |
| `refunded` | different fingerprint | `IDEM_KEY_REUSED` |
| not `captured` / not idempotent `refunded` | any | `PAYMENT_NOT_REFUNDABLE` |

**Do not** add `partially_refunded` to CHECK or TypeScript unions.

### 3.3 `PaymentRow` / reads

Add `refunded_amount_minor: number | null` to `PaymentRow` (~287) and all payment SELECT helpers (`readPaymentRowSync` ~13217, `readPaymentByIdempotencyKeySync` ~13259, `listPaymentsForReservation` ~15401).

Expose on API:

```typescript
refundedAmountMinor: number; // COALESCE(column, 0)
```

On `listPaymentsForReservation`, `readPayment`, `mapPaymentRow`, and HTTP JSON for reservation payments list.

---

## 4. Command — extend `folio.refund` (normative)

**No new `COMMAND_CATALOG` row.**

### 4.1 RPC — `tryRefundPayment`

**Input (widened):**

```typescript
{ paymentId: string; amountMinor: number }
```

**Validation (before PSP / before txn — fail fast):**

| Check | Wire |
|---|---|
| `amountMinor` missing, non-integer, `<= 0` | `MONEY_INVALID` |
| Payment not found | `NOT_FOUND` |
| `amountMinor > remainingMinor` | **`refund_exceeds_remaining`** (new — §7) |
| Status not refundable (§3.2) | `PAYMENT_NOT_REFUNDABLE` |
| Window closed on insert | `WINDOW_CLOSED` (unchanged via `insertFolioLineSync`) |

**Return success shape (widened):**

```typescript
{ ok: true; paymentId: string; status: 'captured' | 'refunded'; refundedAmountMinor: number }
```

`status` reflects post-refund payment row. Partial → `'captured'`; final slice → `'refunded'`.

### 4.2 Fingerprint

```typescript
{ paymentId: string; amountMinor: number }
```

HTTP `handlePostFolioRefund` (~5008–5009) and RPC idempotency must match. Two equal-amount partials on one payment are **distinct operations** because the SPA mints a fresh idempotency key per click (`refund:${paymentId}:${uuid}` ~668).

### 4.3 Hybrid idempotency flow

Order (mirror capture-due ~14806–14819 + authorize two-phase; peek via `lookupIdempotentResponse` ~4045–4054 — same behavior as `tryCaptureDueHolds` ~14806):

1. Validate `amountMinor`, load payment, compute `remainingMinor`, entitlement/permission gates (unchanged).
2. **Fully refunded row (before peek or PSP):** if `status === 'refunded'`:
   - `refund_fingerprint === idem.fingerprint` → return idempotent success (keep existing shortcut ~14459–14461).
   - else → **`IDEM_KEY_REUSED`**; **do not peek, do not call PSP** (keep existing else branch ~14463). A new idempotency key against an already-fully-refunded payment must not reach step 4.
3. **Peek via `lookupIdempotentResponse(idem)`** — only when `status === 'captured'` (including partial-progress replays of the **same** idempotency key):
   - `'fingerprint_mismatch'` → `IDEM_KEY_REUSED`.
   - cached response → return parsed result; **skip PSP**.
   - `null` (miss) → continue.
4. **Miss:** if CARD → `await simulateRefund({ …, amountMinor: input.amountMinor })` (~82–95); CASH → skip PSP (~14470 guard pattern from case 30).
5. **`transactionSync` + `runIdempotent`** for ledger + outbox + audit:
   - Re-read payment; re-check remaining / status inside execute (race-safe).
   - Do **not** pre-UPDATE `status = 'refunded'` outside event apply (remove ~14491–14497 pattern).
   - Call `applyPaymentEventSync` `payment.refunded` with `payload.amountMinor = input.amountMinor` and computed `folioLineId`.
   - Set `refund_fingerprint = idem.fingerprint` on success (last successful refund fingerprint — full-refund replay when already `refunded` still works).
   - Append outbox / audit as today (~14524–14558) with **this** `amountMinor` and correct terminal `status`.

**Do not** add a `payment_refund` table.

### 4.4 Card / cash

| Tender | PSP |
|---|---|
| `CARD` | `simulateRefund` with **this** refund’s `amountMinor` |
| `CASH` | Skip PSP (existing case 30) |

---

## 5. `applyPaymentEventSync` — `payment.refunded` (normative)

Replace ~13475–13523 behaviour.

**Preconditions:** payment row exists; `status IN ('captured', 'refunded')` for apply path (refunded only when replaying event — normal writes start from `captured`).

**Steps:**

1. Load capture line (same query ~13481–13495).
2. Validate `event.payload.amountMinor` — positive integer; `<= remainingMinor` at apply time (else throw — txn should have gated).
3. **Refund line id:** if `event.payload.folioLineId` provided, use it; else  
   `n = COUNT(*)` of existing `folio_line` rows where `source = 'PAYMENT_REFUND'` AND `split_of = capture.folio_line_id` + 1 → `` `${paymentId}:refund:${n}` ``.  
   First partial is **`:refund:1`** (not `:refund`).
4. **Ledger amounts:** txn = `payload.amountMinor` (positive). Ledger = derive via `postToLedger` using **capture line’s** `fx_rate` / `fx_rate_at` (not `resolveCapturePostedSync` at `Date.now()`). Identity currency: rate `"1"`.
5. `insertFolioLineSync`: `source = 'PAYMENT_REFUND'`, `charge_code = 'PAYMENT'`, `split_of = capture.folio_line_id`, `payment_id = NULL`.
6. **Update payment row:**
   - `refunded_amount_minor = COALESCE(refunded_amount_minor, 0) + payload.amountMinor`
   - `status = 'refunded'` **iff** new refunded total `>= (captured_amount_minor ?? amount_minor)`; else leave **`captured`**
   - `last_payment_event_id`, `updated_at`
7. Return `{ applied: true, folioLineId }`.

**Never** post `Math.abs(capture.amount_minor)` unless this refund’s amount equals full capture.

---

## 6. HTTP — widen `post_folio_refund` (normative)

**Index `[101]` unchanged.**

### 6.1 Request body

```typescript
{
  amountMinor: number;      // required, positive integer
  idempotencyKey: string;   // required
}
```

Missing / invalid `amountMinor` or missing `idempotencyKey` → **400** `{ error: 'invalid_body' }` (~5005 pattern).

### 6.2 Fingerprint payload

```typescript
{ paymentId, amountMinor }
```

Pass `amountMinor` through to `tryRefundPayment(actor, { paymentId, amountMinor }, idem)`.

### 6.3 Response

Success **200** — widened DO result (`status`, `refundedAmountMinor`). Errors via existing `mapPaymentCommandErrorStatus` (~5133) plus new code (§7).

### 6.4 GET payments (no new route)

Widen existing reservation payments list / `readPayment` JSON only. No new `V1_HTTP_ROUTE_AUDIT` index.

---

## 7. Wire codes (normative)

Add to `packages/contracts/src/idempotency.ts` alongside payment sibling codes (~73–80):

```typescript
export const REFUND_EXCEEDS_REMAINING = 'refund_exceeds_remaining' as const;
```

Map in `mapPaymentCommandErrorStatus` (~5133–5151) → **422**. Add to `idempotency.test.ts` export pin.

**Do not** overload `PAYMENT_NOT_REFUNDABLE` for over-refund.

Existing codes unchanged:

| Code | File | When |
|---|---|---|
| `MONEY_INVALID` | `money.ts` ~2 | zero/negative/non-integer `amountMinor` |
| `PAYMENT_NOT_REFUNDABLE` | `idempotency.ts` ~73 | wrong status / not refundable |
| `PAYMENT_NOT_CHARGEBACKABLE` | ~76 | chargeback when partial refund already posted (§9) |
| `IDEM_KEY_REUSED` | idempotency | fingerprint mismatch |
| `WINDOW_CLOSED` | existing | closed folio window |

---

## 8. Events & contracts (normative)

### 8.1 `PaymentRefundedV1` (`payment.ts` ~30–37)

Update comment on `amountMinor` from “full refund” to **“this refund’s txn amount (partial or final slice)”**. Field semantics change; **version stays 1**.

### 8.2 Outbox payloads

`folio.payment_refunded` and `payment.refunded` outbox (~14524–14549) carry **this** refund’s `amountMinor` and the deterministic `folioLineId` (`` `:refund:n` ``).

Audit `afterJson` (~14557): include `refundedAmountMinor` cumulative and terminal `status`.

---

## 9. Chargeback interaction (normative)

In `tryRecordChargeback` (~14598–14601), before status check:

If `COALESCE(payment.refunded_amount_minor, 0) > 0` → **`PAYMENT_NOT_CHARGEBACKABLE`**.

Rationale: chargeback-of-remainder after partial refund is **scope-out**; block rather than silently full-chargeback a depleted capture.

Existing `captured`-only apply path (~13527–13529) unchanged for unrefunded payments.

---

## 10. SPA — `FolioScreen.tsx` (normative)

Use existing `@hospai/ui-kit` primitives. No simulate copy in UI (`FolioScreen.test.tsx` ~1299–1311: `queryByText(/simulate/i)` stays null).

### 10.1 Refund control

For `p.status === 'captured' && canAdjust` (~868–877):

- Add **`refundAmounts`** state mirroring `captureAmounts` (~111, ~827–855).
- Default display amount = **remaining**:  
  `(p.capturedAmountMinor ?? p.amountMinor) - (p.refundedAmountMinor ?? 0)` formatted like capture.
- `Input` + `Refund` button; on submit pass parsed integer minor units + new op id.
- Keep `data-testid={`refund-payment-${p.paymentId}`}` on the button.
- After partial refund, payment stays `captured` → **button remains** until fully refunded.
- Hide when `status === 'refunded'`.
- Permission: still `folio:adjust` only (`canAdjust` ~193).

### 10.2 Client API

Widen `refundPayment(propertyId, paymentId, amountMinor, opId)` — body `{ amountMinor, idempotencyKey }`.

Widen `FolioPaymentRow` with `refundedAmountMinor?: number` (default `0` when absent in UI math).

Advanced `<details>` stays collapsed (no layout change).

---

## 11. Tests (acceptance-shaped — map to later plan tasks)

**Register / schema**

1. `PROPERTY_SCHEMA_HEAD === 27`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` no-op (no new migration file).
2. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. `V1_HTTP_ROUTE_AUDIT[101].id === 'post_folio_refund'`. `PLATFORM_GAPS` `[]`. `NIGHT_AUDIT_STEPS.length === 7`.

**Partial refund ledger**

3. Partial then remaining on one capture: two `PAYMENT_REFUND` lines with ids `` `:refund:1` ``, `` `:refund:2` ``; status `captured` then `refunded`; `refunded_amount_minor` accumulates; `balanceMinor` increases by each refund amount; capture line amount unchanged.
4. Over-refund (`amountMinor > remaining`) → **`refund_exceeds_remaining`** (422 HTTP).
5. Missing `amountMinor` on HTTP refund POST → **400** `invalid_body`.

**Idempotency / PSP**

6. Same idempotency key + fingerprint replay → cached result; **PSP not called** (spy / `setPspSimulateOutcomeForTest({ refund: 'declined' })` would fail if invoked).
7. Different idempotency key, same `amountMinor`, remaining allows → second refund line (two operations).

**Tender / FX**

8. Cash partial refund skips PSP (extend case 30 pattern with partial `amountMinor`).
9. Card partial: `simulateRefund` receives **this** refund amount (mock/spy).
10. FX: foreign capture — partial refund line copies capture **frozen** `fx_rate` / ledger amount at that rate (extend `folio-fx-payments.spec.ts` case 15 — partial amount, line id `` `:refund:1` ``).

**Chargeback guard**

11. After partial refund, `folio.record_chargeback` → `PAYMENT_NOT_CHARGEBACKABLE`.

**Regression — full refund**

12. Cases **28–31** in `folio-payment-lifecycle.spec.ts` still pass when `amountMinor = remaining` (full); case 31 idempotent; line id for single full refund is `` `:refund:1` `` (not legacy `` `:refund` ``).

**SPA**

13. Refund amount field defaults to remaining; `data-testid={`refund-payment-${id}`}` preserved.
14. Staff without `folio:adjust` — no refund control (case 54 pattern).
15. `queryByText(/simulate/i)` null on happy path (existing test ~1299).

Fixture discipline: `crypto.randomUUID()` keys; `check:pms-core-test-dates`.

---

## 12. Leftovers deferred (explicitly out)

| # | Item | Notes |
|---|---|---|
| 1 | Chargeback of **remainder** after partial refund | Reject today; future chunk may size chargeback to remaining |
| 2 | `unknown` reconciliation | Unchanged |
| 3 | Authorization expiry | Unchanged |
| 4 | Multi-shot partial **captures** | Capture stays one-shot |
| 5 | Demo seed / dry run 2 | Unchanged |
| 6 | Virtual types / guest CRM / `rooms.delete` | Other verticals |

---

## 13. Acceptance / reviewer checklist

- [ ] `amountMinor` required on HTTP + RPC; fingerprint `{ paymentId, amountMinor }`.
- [ ] `refunded_amount_minor` written; remaining formula §3.1; no schema migration; head **27**.
- [ ] Status `captured` until remainder 0, then `refunded`; no `partially_refunded`.
- [ ] Each refund: one `PAYMENT_REFUND` line; capture untouched; ids `` `:refund:n` ``.
- [ ] `applyPaymentEventSync` honours partial amount + cumulative refund + conditional status.
- [ ] Hybrid idempotency: `refunded` + mismatch → `IDEM_KEY_REUSED` (no peek/PSP); peek via `lookupIdempotentResponse` before PSP for `captured` replays; `runIdempotent` in txn; no `payment_refund` table.
- [ ] `refund_exceeds_remaining` → 422; `MONEY_INVALID` for bad amounts.
- [ ] FX refund uses capture frozen rate (not live quote).
- [ ] `PaymentRefundedV1` comment updated; contract version **1**.
- [ ] GET payments expose `refundedAmountMinor`.
- [ ] SPA amount field + remaining default; testid preserved; staff gate unchanged.
- [ ] Chargeback blocked when `refunded_amount_minor > 0`.
- [ ] `[101]` / catalog **77** / writers **52** / route **[127]** unchanged.
- [ ] Tests §11 green in later plan — this spec does not implement them.
- [ ] Bidirectional pointer sentences in folio-money-ops + multi-currency specs when landed.

---

## 14. Open questions (locked by reviewer)

**None — reviewer locked.** All product forks resolved in parent brief (same command/route, required `amountMinor`, no new status, no migration, chargeback remainder deferred).

---

## 15. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `packages/contracts/src/idempotency.ts` | `REFUND_EXCEEDS_REMAINING`; test pin |
| `packages/contracts/src/events/payment.ts` | `PaymentRefundedV1` comment |
| `packages/contracts/src/idempotency.test.ts` | new code export |
| `apps/pms-core/src/property-do.ts` | `PaymentRow`; `readPayment*`; `tryRefundPayment`; `applyPaymentEventSync` refunded branch; `listPaymentsForReservation`; `mapPaymentRow`; `tryRecordChargeback` guard |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostFolioRefund` body/fingerprint; `mapPaymentCommandErrorStatus` |
| `packages/client-core/src/api.ts` | `refundPayment`, `FolioPaymentRow` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | refund amount UI |
| `apps/pms-core/test/folio-payment-lifecycle.spec.ts` | cases 28–31 + new partial cases |
| `apps/pms-core/test/folio-fx-payments.spec.ts` | FX partial refund |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | refund amount default (if covered) |

**Not touched:** `COMMAND_CATALOG` length, `v1-http-routes.ts` append, `PROPERTY_SCHEMA_HEAD`, `demo-seed`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, migrations, `AUDIT_WRITER_COMMAND_IDS` membership (already includes `folio.refund`).

---

## 16. Tree conflicts with reviewer locks

**None.** Verified: `[101] = post_folio_refund`, `[127] = post_demo_seed`, catalog **77**, writers **52**, `PROPERTY_SCHEMA_HEAD` **27**, `ORG_SCHEMA_HEAD` **7**, `NIGHT_AUDIT_STEPS` **7**, `PLATFORM_GAPS` `[]`, `refunded_amount_minor` column present but unused, `applyPaymentEventSync` full-capture bug at ~13506–13518 matches parent brief. Implementation treats current full-refund-only behaviour and `` `:refund` `` line id as **defects to fix**, not conflicts.
