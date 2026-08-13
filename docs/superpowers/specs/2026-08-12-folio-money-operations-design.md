# Folio Money Operations

**Date:** 2026-08-12  
**Status:** Draft v2 — implementation-ready (reviewer locks: inline auto-capture await + `autoCapture` outcome; consumed-snapshot retention on modify)  
**Sources:** ARCHITECTURE.md §4.2 (lanes), §4.6 (degraded classes; payments FAIL_CLOSED), §7.3 (append-only ledger, windows, transfer-as-postings, split = reversal + N, closed window rejects, auto-transfer constraint, payments↔folio events, auto-capture at check-out), §8 (pinned 7-step machine; do not grow `NIGHT_AUDIT_STEPS`), §16.1 / §16.5 (folio extras named, undesigned; `folio.transfer_charge` / `folio.split_charge_v2` are build debt); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (style template; 7-step pin); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (balance gate, `folio.balance_due`, leftovers 2 / 4 / 5); [folio charges](./2026-08-05-folio-charges-vertical-design.md); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [cashiering](./2026-08-07-cashiering-design.md) (`folio:post` = bring money in, `folio:adjust` = modify posted); [folio front-desk](./2026-08-08-folio-front-desk-design.md); [charge-code registry](./2026-08-07-charge-code-registry-design.md) (routing-rules leftover); command catalog `folio.*`; `PropertyDO` `tryAuthorizePayment` / `tryCapturePayment` / `tryRecordCashPayment` / `trySplitChargePayment` / `splitFolioLineSync` / `insertFolioLineSync` / `tryCheckOut` / `postRoomChargesSync` / `penaltyMinor`

**Closes follow-ons in:** lifecycle leftovers **4** (folio window close on check-out) and **5** (deposits / capture on `folio.balance_due`); lifecycle leftover **2** (quote snapshot — folded in); payments leftovers (window `closed_at` inert, closed-window reject, voids/refunds); `PLATFORM_GAPS` `folio.transfer_charge` and `folio.split_charge_v2`; §16.1 folio extras (no-post, damage deposits, manual discounts — promo deferred with reasons).

**Amends:** [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) leftover 4 (window-stays-OPEN is now the **default**, overridable by config — not silently reversed); leftover 2 (penalty / ROOM price source becomes the snapshot); leftover 5 (capture seam specified here); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) §2.3 wire-lie (`window.status` becomes a real discriminator) and leftovers voids/refunds / closed-window reject; [charge-code registry](./2026-08-07-charge-code-registry-design.md) leftover “window routing rules table” (still not this body — auto-transfer deferred, §13). Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

The desk can post, authorize, capture, cash, split same-window, and check out behind a balance gate. It cannot close a folio window, move a charge to a company window, split across windows, void a hold, refund a capture, freeze the quoted rate, or honour §16.1’s no-post / damage-deposit / discount rules. Two catalog ids have sat in `PLATFORM_GAPS` since the freeze (`folio.transfer_charge` ~688, `folio.split_charge_v2` ~690). Lifecycle leftover 4 left the window `OPEN` on purpose so this chunk could design close against the new balance gate rather than inventing it twice.

### 1.1 What already exists (do not re-spec)

| Piece | Where (verified) |
|---|---|
| Append-only ledger | `insertFolioLineSync` (`property-do.ts` ~8475). No `UPDATE` of amounts. `readFolio` `balanceMinor` = `Σ ledger_amount_minor` across all lines for the reservation (~10184). |
| Windows | `folio_window` freeze-gate DDL: `kind`, `billed_party`, `status`, `closed_at`. **No CHECK on `status`.** `ensureGuestFolioWindowSync` `INSERT OR IGNORE` `${reservationId}:GUEST` as `'OPEN'`. `createFolioWindow` (`property-do.ts` ~8438) is an unguarded DO RPC — not HTTP-exposed, so fixture-only at the API boundary; once `folio.open_window` is the real path, the plan may add `assertUnsafeLocal` gating. `closed_at` has **zero writers**. `insertFolioLineSync` does **not** read window status. |
| Split (same window) | `splitFolioLineSync` (~8542): reverse + N children, `source = 'SPLIT_REVERSAL'`, `split_of` = original, tax dependents reversed then `allocate(..., { policy: 'LAST' })` onto children. `folio.split_charge` rejects `PAYMENT` / `SPLIT_REVERSAL` / `TAX`. `folio.split_charge_payment` requires `source = 'PAYMENT'`. Both `FAIL_CLOSED`, `folio:adjust`, entitled. Reverse ids use `crypto.randomUUID()` (idempotency is `runIdempotent`, not deterministic ids). |
| Payments | `payment.status` CHECK `pending \| authorized \| declined \| captured \| unknown` (v13). `PaymentStatus` union matches (~165). Authorize: no folio line. Capture: negative `PAYMENT` line, `folio_line_payment_uidx` one line per `payment_id`. Cash: insert `captured` + line, no PSP. Simulate adapter: `simulateAuthorize` / `simulateCapture` only (`psp-simulate.ts`). |
| Check-out | `tryCheckOut` (~5893): `BALANCE_DUE` gate, `overrideBalance`, HK dirty, `folio.balance_due` when `balanceMinor > 0`. **Does not touch `folio_window`.** Window stays `OPEN` (lifecycle leftover 4). |
| `cancel_check_in` | `checked_in → confirmed`; keeps `room_id`; no folio mutation (~6040). |
| Night audit | `NIGHT_AUDIT_STEPS` length **7**, pinned. `postRoomChargesSync` prices `ROOM` from `rate_day` via `reservation.rate_plan_id` (~8685). `penaltyMinor` (~4601) prices from current `rate_day` (lifecycle leftover 2). |
| Charge codes | `SYSTEM_CHARGE_CODES = ['ROOM', 'PAYMENT', 'CANCEL', 'NO_SHOW']`. Protected from archive. |
| Permissions | `folio:post` = bring money in (staff+admin+owner). `folio:adjust` = modify posted (**admin+owner only** — staff does not have it, `permissions.ts` ~110–124). |
| Route head | `V1_HTTP_ROUTE_AUDIT[94] = post_reservation_front_office`. Next free **95**. |
| Migration head | `PROPERTY_MIGRATIONS` version **20**. Next free **21**. Real-SQLite tests run `PRAGMA foreign_keys = ON` (`charge-code-migration.sqlite.test.ts`). |
| Audit writers | `AUDIT_WRITER_COMMAND_IDS.size === 35`. |
| `PLATFORM_GAPS` | `folio.transfer_charge`, `folio.split_charge_v2` (cross-window remainder), `rooms.set_ooo_range`. |

`PLATFORM_GAPS` no longer lists `rooms.set_ooo_range` (closed by [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md)).
| `allocate` | `packages/money`: weights must be **positive**; remainder policy `LAST` (default) or `FIRST`. |

### 1.2 Scope in

1. Folio window close / reopen and the check-out interaction (§3).
2. `folio.transfer_charge` — reverse in source + post in dest, append-only (§4).
3. `folio.split_charge_v2` — same-window keep; cross-window = split + transfer (§5).
4. Payment void + refund; auto-capture seam on `folio.balance_due` (§6).
5. §16.1 extras: no-post, damage deposits (hold), manual discounts. Promo deferred (§7).
6. Quote snapshot: freeze `rate_day` onto the reservation at inventory commit (§8).
7. `insertFolioLineSync` closed-window reject — the §7.3 rule the FK does not enforce.

### 1.3 Scope out

- City ledger / AR (§7.3: structurally distinct). `billed_party` is a label, not an AR account.
- Real PSP / PCI Worker. Simulate adapter stays; gains void + refund methods.
- Multi-currency conversion (already shipped; Phase 1 identity-rate rule unchanged).
- Promo codes (§7.4 — deferred with reasons).
- Group/master **billing engine** (cutoff, wash, pickup). `MASTER` windows may exist as transfer targets; no group aggregate.
- Night-audit **auto-transfer** (§13 — deferred; do not grow `NIGHT_AUDIT_STEPS`).
- Routing-rules table (charge-code leftover; auto-transfer’s input).
- Partial refunds, chargebacks, authorization expiry, `unknown` reconciliation exit.
- Recurring incidentals / breakfast_rule engine (night-audit leftover).

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **The folio is append-only.** Corrections, transfers, splits, voids-of-money, and refunds are reversing entries plus new postings. Never `UPDATE` `folio_line.amount_minor` / `ledger_amount_minor`.
2. **A CLOSED window rejects every insert** into that window, including tax stamps, reversals, night-audit, and transfers. Never silently reopen (`INSERT OR IGNORE` on a CLOSED GUEST window must not flip status). The exception path is `WINDOW_CLOSED` (live 422) or `provisional_exception` (queued `folio.add_item` replay) plus **explicit** `folio.reopen_window`.
3. **Transfers are postings.** Source line untouched. Reverse in source + new line in dest. `split_of` links both to the original.
4. **Splits foot exactly.** `sum(splits.amountMinor) === source.amount_minor`. Remainder pennies via `allocate` (`packages/money`), never ad-hoc rounding. Cross-window split is subject to **both** split and transfer rules.
5. **Payments stay `FAIL_CLOSED`.** Void, refund, capture-due, authorize, capture, cash — never queued. Nothing auto-resolves into money on provisional replay (§4.6 rule 5).
6. **Auth is not money.** Void of `authorized` writes no folio line. Refund of `captured` posts a reversing line and does not mutate the capture line. Refund line **must not** set `payment_id` (`folio_line_payment_uidx` allows one non-null `payment_id`).
7. **Check-out stays `QUEUE_PROVISIONAL` and entitlement-ungated.** Auto-capture is a **separate** `FAIL_CLOSED` command. Live check-out **awaits** it inline after the status txn commits (no fire-and-forget); a same-key live replay **must not re-await** the helper (it recomputes `autoCapture` from payment/config state). Capture failure does not fail check-out. The RPC/HTTP success body always carries `autoCapture`.
8. **`NIGHT_AUDIT_STEPS` stays seven.** Auto-transfer does not fold into an existing step this chunk (§13).
9. **Quote snapshot is the price source** for `penaltyMinor` and `postRoomChargesSync` when a night row exists. Missing snapshot on a pre-v21 row falls back to `rate_day` and lazily backfills. Missing `rate_day` with no snapshot → `RATE_MISSING` (unchanged fail-closed). Modify must **not** delete a snapshot night that already has a ROOM or NO_SHOW posting (consumed nights stay frozen).
10. **New catalog commands** carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. New events appear in `event-consumer.ts`. New entitled writers go in `AUDIT_WRITER_COMMAND_IDS`.
11. **Route audit append-only.** New routes start at index **95**. Do not insert before `[94] = post_reservation_front_office`.
12. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
13. **Staff cannot adjust posted money.** Transfer, split v2, discount, refund, open/close/reopen window use `folio:adjust`. Void and capture-due use `folio:post` (hold release / bring money in).

---

## 3. Folio window close

### 3.1 Who closes

Two writers, one helper `closeFolioWindowSync(windowId, actor, now)`.

| Writer | When |
|---|---|
| `folio.close_window` | Explicit. Always available (gates below). |
| `tryCheckOut` (live or replay) | **Only if** `pms.folio.close_window_on_check_out === true` **and** reservation-level `balanceMinor === 0` **and** the GUEST window is `OPEN`. Same txn as the status flip. |

**Default of that config is `false`.** Lifecycle leftover 4 is preserved as the default: check-out does not close the window, late charges keep the existing open-window path. Properties that want “departed = closed” turn the flag on. The flag does **not** close when the guest leaves with an open balance (override or `require_zero_balance = false`) — a closed window with a live balance is city-ledger territory, which is out of scope.

There is **no** `overrideClose` / close-with-balance path this chunk.

### 3.2 Close gates

| Window kind | Reservation status | Window balance (`Σ` lines on **that** window) | Result |
|---|---|---|---|
| `GUEST` | `checked_out` \| `cancelled` \| `no_show` | `=== 0` | close |
| `GUEST` | `inquiry` \| `pending` \| `confirmed` \| `checked_in` | any | `WINDOW_NOT_CLOSABLE` |
| `GUEST` / `COMPANY` / `MASTER` | any allowed | `> 0` or `< 0` | `WINDOW_BALANCE_DUE` (must net to zero — a credit balance is also unclosed) |
| `COMPANY` / `MASTER` | any (including in-house) | `=== 0` | close — the guest can still be in-house on the GUEST window |

Already `CLOSED` → idempotent success `{ alreadyClosed: true }` (no second event, no second audit row). Missing window → `NOT_FOUND`.

`closed_at = now`, `status = 'CLOSED'`. No `closed_by` column (actor is on `audit_log`).

### 3.3 State machine (window status × stay)

```
create / hold / confirm     → ensureGuestFolioWindowSync → GUEST OPEN
check-in                    → GUEST remains OPEN (required: GUEST cannot close in-house)
in-house postings           → OPEN only
check-out, config false     → reservation checked_out, GUEST OPEN          [default]
check-out, config true, bal=0 → reservation checked_out, GUEST CLOSED
check-out, bal>0 (override) → reservation checked_out, GUEST OPEN          [never auto-close]
late charge, OPEN           → insertFolioLineSync succeeds (existing)
late charge, CLOSED         → WINDOW_CLOSED (never reopen)
explicit close, gates ok    → CLOSED
explicit reopen             → OPEN, closed_at NULL
```

**Late charge against CLOSED:** `insertFolioLineSync` throws `WindowClosedError` (`WINDOW_CLOSED` in `message`). `tryAddFolioLine` maps it to `{ ok: false, error: WINDOW_CLOSED }` → HTTP **422**. Queued `folio.add_item` (still `QUEUE_PROVISIONAL` — front-desk leftover 1 stays; commutativity with close is resolved by re-validation on replay, same class as check-in vs room) → `provisional_exception`. That is the §7.3 exception path. The insert path does **not** `UPDATE folio_window SET status='OPEN'`.

### 3.4 Reopen — explicit exception path, not silent

Architecture forbids **silent** reopen. Closing too early (minibar after a zero-balance auto-close) is a real desk mistake. **`folio.reopen_window`** is the human exception path:

- Window must be `CLOSED` → else `WINDOW_NOT_REOPENABLE`.
- Sets `status = 'OPEN'`, `closed_at = NULL`.
- `folio:adjust`, `FAIL_CLOSED`, audited, event `folio.window_reopened`.
- Idempotent: already OPEN → `{ alreadyOpen: true }`.

No automatic reopen on check-in, cancel, or `ensureGuestFolioWindowSync`.

### 3.5 `cancel_check_in` after a window close

**Impossible for the GUEST window by construction.** GUEST close requires a terminal reservation status. `cancel_check_in` requires `checked_in`. Folio state is therefore unchanged (GUEST still `OPEN`) and this command stays ledger-free.

COMPANY/MASTER may be CLOSED while the guest is in-house; `cancel_check_in` does not touch them.

### 3.6 Open a non-guest window

`folio.open_window` creates `COMPANY` or `MASTER` only. GUEST is still lazy via `ensureGuestFolioWindowSync` → `GUEST_WINDOW_NOT_OPENABLE` if the client asks.

Deterministic id:

- COMPANY: `${reservationId}:COMPANY:${billedPartySlug}` — `billedParty` required (non-empty, trimmed, max 128). Slug = lowercase `[a-z0-9]+` with other chars → `_`, collapse. Collision = idempotent success (same billed party).
- MASTER: `${reservationId}:MASTER` (one master window per reservation this chunk). Second open → idempotent success.

`billed_party` is stored as the operator-supplied string. It is **not** a city-ledger FK.

Reservation must exist. Status any non-inquiry (inquiry has no bill to split) → else `WINDOW_NOT_OPENABLE`.

---

## 4. `folio.transfer_charge`

§7.3 rule 2: reversing line in source + new posting in dest; original never re-pointed.

### 4.1 Command

| | |
|---|---|
| id | `folio.transfer_charge` (promote off `PLATFORM_GAPS`) |
| Lane | `INTERACTIVE` |
| Degraded | **FAIL_CLOSED** — reads source line + two window statuses then decides; not commutative with close/split |
| Idempotent | true; fingerprint `{ sourceFolioLineId, destinationFolioWindowId }` |
| Events | `folio.line_posted` (reverse + dest + tax), `folio.charge_transferred` |
| Entitlement | `pms.core` |
| Permission | `folio:adjust` |
| Audit | `AUDIT_WRITER_COMMAND_IDS` |

Input: `{ sourceFolioLineId, destinationFolioWindowId, idempotencyKey }`. Destination must already exist (open it first). No implicit window create.

### 4.2 Rules

1. Source line exists; dest window exists; both windows `OPEN` → else `NOT_FOUND` / `WINDOW_CLOSED`.
2. `source.reservation_id === dest.reservation_id` → else `TRANSFER_CROSS_RESERVATION`. Cross-reservation is city ledger / AR.
3. Source and dest windows differ → else `TRANSFER_SAME_WINDOW`.
4. Reject `source ∈ { SPLIT_REVERSAL, TAX, TRANSFER_REVERSAL }` → `LINE_NOT_TRANSFERABLE`. Transfer the parent; tax follows. Do not transfer a reverse.
5. PAYMENT lines **may** transfer (move a credit to the company window). The capture `payment_id` stays on the **original** capture line; dest and reverse have `payment_id NULL` (unique index).
6. **Reverse** in source window: `amount = -source`, same `charge_code`, `source = 'TRANSFER_REVERSAL'` (not `SPLIT_REVERSAL` — night-audit no-show reverse and splits stay distinguishable), `split_of = source.folio_line_id`. Deterministic id `${sourceFolioLineId}:xfer-rev:${destWindowId}`.
7. **Dest** in dest window: `amount = source`, same money fields / `charge_code`, `source = 'TRANSFER'`, `split_of = source.folio_line_id`. Id `${sourceFolioLineId}:xfer:${destWindowId}`. Inherit night-audit exception: if original `source = 'NIGHT_AUDIT'`, dest `source = 'TRANSFER'` (never `NIGHT_AUDIT` — `folio_line_audit_uniq`).
8. Tax dependents of the source: reverse each in source (`TRANSFER_REVERSAL`, `split_of = tax line`), restamp in dest via `stampTaxForChargeSync` on the dest parent (new TAX lines, `tax_of = dest line`). Do not copy tax amounts blindly if rules changed — restamp at transfer time with the dest parent’s amount (equals source, so amounts match).
9. Source row untouched.
10. Already transferred (dest id exists) → idempotent success, return existing ids (PK / deterministic id is the backstop; `runIdempotent` is the command backstop).

`folio.charge_transferred` payload: `{ propertyId, reservationId, sourceFolioLineId, sourceWindowId, destWindowId, destFolioLineId, amountMinor }`.

### 4.3 Night-audit auto-transfer — **defer**

§7.3 constraint 1: auto-transfer is a night-audit step, idempotent, keyed by `(reservation_id, business_date, rule_id)`. The 7-step machine is pinned. Folding into `POST_ROOM_CHARGES` would post then immediately reverse+repost under the double-post index. Folding into `ARCHIVE` is after the roll. A new step is forbidden this week.

**Defer** until a routing-rules table exists (charge-code leftover) **and** a later chunk is allowed to extend `NIGHT_AUDIT_STEPS` (or the architecture is amended to name which existing step owns it). This chunk ships the **primitive** the step will call. Named leftover 1.

---

## 5. `folio.split_charge_v2`

Payments already landed reverse+N for same-window. `PLATFORM_GAPS` reason is the remainder: cross-window split + transfer.

### 5.1 Keep the existing commands

| Command | Fate |
|---|---|
| `folio.split_charge` | **Keep.** Same-window, non-payment. HTTP `post_folio_split` unchanged. Internally calls the extended helper with dest = source window. |
| `folio.split_charge_payment` | **Keep.** Same-window, payment. Same helper. |
| `folio.split_charge_v2` | **New.** Each split slice may name a `folioWindowId` (omit = source window). Cross-window slices run transfer rules (§4.2) on that child. |

Do **not** retire or HTTP-deprecate v1 this chunk. FolioScreen already splits same-window. Collapse to one command is leftover 2.

### 5.2 v2 command

| | |
|---|---|
| Lane | `INTERACTIVE` |
| Degraded | **FAIL_CLOSED** (same commutativity reason as v1 — payload names a line that may not exist yet under queue reorder) |
| Idempotent | true; fingerprint `{ sourceFolioLineId, splits: [{ folioLineId, amountMinor, folioWindowId? }] }` |
| Events | `folio.line_posted` |
| Entitlement | `pms.core` |
| Permission | `folio:adjust` |
| Audit | yes |

Foot: `sum(splits.amountMinor) === source.amount_minor` (signed — payment lines are negative) → else `SPLIT_AMOUNT_MISMATCH`.

Helper extension of `splitFolioLineSync`:

1. Reverse always in the **source** window (`SPLIT_REVERSAL`, existing source string — v1 tests stay valid).
2. Each child inserts into `split.folioWindowId ?? source.folio_window_id`.
3. If dest ≠ source: dest window must be `OPEN`, same reservation; child `source` field = `'TRANSFER'` when dest differs (linkage still `split_of` = original). Same-window children keep today’s inherit rule (`NIGHT_AUDIT` → `NULL`; `PAYMENT` stays `PAYMENT`).
4. Tax: reverse in source (existing); allocate portions with `allocate(tax.amount_minor, childAmounts.map(abs), { policy: 'LAST' })`. **Absolute weights** because `allocate` requires positive weights; apply the original tax sign to each portion. Child tax lines live on the child’s window with `tax_of = child`.
5. Reject `SPLIT_REVERSAL` / `TAX` as source (existing). v2 of a PAYMENT line is allowed (replaces the need to call `split_charge_payment` for cross-window credits). v1 payment command stays for same-window.
6. All dest windows and the source window `OPEN`. Any CLOSED → `WINDOW_CLOSED`, nothing written (one txn).

Deterministic reverse id for v2: `${sourceFolioLineId}:v2-rev` (v1 keeps UUID reverse ids inside `runIdempotent` — do not change v1 ids; that would break replay of cached responses only, but tests seed UUIDs). v2 children use client-supplied `folioLineId` as today.

Remove `folio.split_charge_v2` and `folio.transfer_charge` from `PLATFORM_GAPS`.

---

## 6. Payment lifecycle depth

### 6.1 Status machine

Today (v13 CHECK, verified): `pending → authorized | declined | unknown`; `authorized → captured`.

This chunk adds **`voided`** and **`refunded`**:

```
pending ──▶ authorized ──▶ captured ──▶ refunded
   │              │
   ├─▶ declined   └─▶ voided
   └─▶ unknown          (no exit this chunk — leftover 3, unchanged)
```

Cash inserts directly as `captured` (existing). Cash **void** is illegal (`PAYMENT_NOT_VOIDABLE` — there was no hold). Cash **refund** is allowed (desk reversing entry, no PSP).

`unknown` still cannot be captured, voided, or refunded (`PAYMENT_NOT_VOIDABLE` / `PAYMENT_NOT_CAPTURABLE` / `PAYMENT_NOT_REFUNDABLE`). Reconciliation remains leftover.

### 6.2 Void — `folio.void`

Authorized hold → `voided`. **No folio line** (auth is not money). Simulate `simulateVoid` (same async-outside-txn seam as authorize: txn1 assert `authorized` + fingerprint, await adapter, txn2 `UPDATE … WHERE status='authorized'`).

| Current | Void |
|---|---|
| `authorized` | allowed |
| `pending` / `declined` / `unknown` / `captured` / `voided` / `refunded` | `PAYMENT_NOT_VOIDABLE` (`voided` + same fingerprint → idempotent ok) |
| `tender_type = 'CASH'` | `PAYMENT_NOT_VOIDABLE` |

Adapter timeout → leave `authorized` (do not invent `unknown` on void — that state means “did we authorize?”). Decline → `PAYMENT_NOT_VOIDABLE`, stay `authorized`.

Event: `folio.payment_voided` `{ propertyId, paymentId, reservationId, gatewayReference }`.

| | |
|---|---|
| Lane / degraded / entitlement | `INTERACTIVE` / `FAIL_CLOSED` / `pms.core` |
| Permission | `folio:post` (release a hold — staff may void a damage deposit at departure) |
| Idempotent | true; fingerprint `{ paymentId }` |
| Audit | yes |

### 6.3 Refund — `folio.refund`

**Full refund only.** Partial refund is leftover 4.

Captured → `refunded`. Post a **positive** reversing `PAYMENT` line (undoes the negative capture). Original capture line untouched. Refund line: `source = 'PAYMENT_REFUND'`, `charge_code = 'PAYMENT'`, `split_of = captureLineId`, **`payment_id = NULL`** (must not violate `folio_line_payment_uidx`). Amount = `captured_amount_minor` (not `payment.amount_minor` — partial capture already exists).

Cash: skip PSP; same ledger shape; `simulateRefund` not called.

Card: `simulateRefund` async seam; `refund_fingerprint` on the payment row (new column). Replay same fingerprint → idempotent; different → `IDEM_KEY_REUSED`.

| Current | Refund |
|---|---|
| `captured` | allowed (full) |
| `refunded` + same fingerprint | idempotent ok |
| anything else | `PAYMENT_NOT_REFUNDABLE` |

Event: `folio.payment_refunded` + `folio.line_posted`.

Permission: **`folio:adjust`** (money-out against a posted capture — manager). Staff cannot refund.

### 6.4 Auto-capture seam on `folio.balance_due`

§7.3: *Payments may auto-capture at check-out.* Lifecycle already emits `folio.balance_due` when `balanceMinor > 0` at the successful transition (including overrides). Check-out is `QUEUE_PROVISIONAL`; capture is `FAIL_CLOSED`. They cannot be one command.

**Lock:**

1. Config `pms.folio.auto_capture_on_check_out` (DOMAIN, bool, **default `false`**). Off → today’s SPA capture UI is the only path.
2. Command `folio.capture_due` — `FAIL_CLOSED`, `folio:post`, `pms.core`, fingerprint `{ reservationId }`, events `folio.payment_captured` / `folio.line_posted` (existing).
3. Body: load authorized payments for the reservation with `purpose = 'STAY'` (not `DAMAGE`, §7.2), FIFO `created_at ASC`. Remaining = current `balanceMinor`. For each hold, capture `min(payment.amount_minor, remaining)` via the **existing** capture seam (`simulateCapture`, amount bounds, negative line). Stop at remaining 0 or holds exhausted. Already-captured payments skipped. Idempotent: a second `capture_due` with nothing left is `{ captured: [] }`.
4. **Live `tryCheckOut` awaits the capture-due helper inline in the RPC** after the checkout txn **commits**. No fire-and-forget, no `ctx.waitUntil` — workerd may cancel async adapter I/O after the response returns. The simulate adapter is local, so inline await is cheap; a real PSP would revisit. Runs only when `provisional` is absent and config is true. Capture failure **must not** fail check-out (status txn already committed) — `catch` the helper, leave the guest `checked_out`, leave holds as they are, and report the outcome on the response. `folio.balance_due` already fired; desk retries `POST …/capture-due`.
5. **Provisional replay of check-out does not capture** (§4.6 rule 5) and does not await the helper. The emitted `folio.balance_due` is the contract for a future payments Worker; `event-consumer.ts` stays a shape allowlist and does **not** call PropertyDO (that would be a new consumer→DO money writer). Phase 1 actuator is (4) + the HTTP command.
6. Damage-purpose holds are never auto-captured.
7. **Check-out success body always includes `autoCapture`** (RPC and HTTP JSON):

| Value | When |
|---|---|
| `'disabled'` | Config off (live or replay). Helper not called. |
| `'skipped'` | Config on, helper not attempted: no eligible STAY holds, remaining `balanceMinor === 0`, **or** this call is a provisional replay. Live cache-hit with neither a captured STAY payment nor a remaining authorized STAY hold. |
| `'captured'` | Config on, live first call, helper captured ≥1 hold; **or** live cache-hit recompute finds ≥1 captured STAY payment for the reservation. |
| `'failed'` | Config on, live first call, helper threw / adapter failed after commit. Guest is still `checked_out`. Live cache-hit recompute: ≥1 authorized STAY hold remains. |

SPA reads this field. Do not infer capture success from a payments refetch.

The `{ ok: true }` shape becomes `{ ok: true; reservationId: string; autoCapture: 'captured' \| 'failed' \| 'skipped' \| 'disabled' }`. `runIdempotent` caches only the status-txn base `{ ok, reservationId }`. Idempotent replay of an already-checked-out **live** command does **not** re-await the helper; it **recomputes** `autoCapture` from current payment/config state: config off → `'disabled'`; ≥1 captured STAY payment → `'captured'`; ≥1 authorized STAY hold remains → `'failed'`; else `'skipped'`. First live call reports the actual helper outcome. A **new** provisional replay is a different key and returns `'skipped'` (config on) or `'disabled'` (config off).

**Benign divergence:** a hold that was already captured (e.g. desk captured manually) before check-out yields first-call `'skipped'` (helper had nothing to capture) but same-key live replay `'captured'` (recompute sees the captured STAY payment). Both are non-error; the SPA reacts the same (refresh folio / payments).

### 6.5 Simulate adapter

`psp-simulate.ts` gains `simulateVoid` / `simulateRefund` with the same outcome lever shape (`approved` / `declined` / `timeout`) plus `failAfterAdapter`. Default approve. `setPspSimulateOutcomeForTest` extends; `assertUnsafeLocal` unchanged. Real PSP still out.

### 6.6 `unknown` leftover

Unchanged. No void/refund/capture from `unknown`. Do not collapse timeout into `declined`.

---

## 7. §16.1 folio extras

### 7.1 No-post — per reservation

Column `reservation.no_post INTEGER NOT NULL DEFAULT 0 CHECK (no_post IN (0, 1))` (v21 `ALTER`, no rebuild).

**Enforcement:** `postRoomChargesSync` skips `no_post = 1` (no ROOM, no tax). Desk `folio.add_item`, cancel/no-show penalties, payments, transfers — **not** blocked. A no-post stay is “do not auto-post room revenue,” not “freeze the ledger.”

Set on `reservations.create` / `reservations.modify` / `reservations.hold` / `reservations.confirm` (optional bool). Fingerprints include `noPost`.

**Lock: `reservations.update_status` also accepts optional `noPost`.** Allowed statuses remain `inquiry` through `checked_in`. Terminal rows (`cancelled` / `checked_out` / `no_show`) stay `NOT_MODIFIABLE`. Event stays `reservation.front_office_updated` with `noPost` in the payload. Not a new command.

Night-audit occupancy snapshot: no change (counts stay). Revenue snapshot naturally omits skipped ROOM.

### 7.2 Damage deposits — hold, not charge

`payment.purpose TEXT NOT NULL DEFAULT 'STAY' CHECK (purpose IN ('STAY', 'DAMAGE'))` on the v21 payment rebuild.

`folio.authorize` optional `purpose` (default `'STAY'`). Fingerprint includes `purpose`. Capture of a DAMAGE hold is operator-initiated (`folio.capture`) only — **excluded from `capture_due`**. On clean departure the desk **voids** the hold. If there is damage: post `DAMAGE` charge (`folio.add_item`, new system code) then capture the hold (or capture first; order is desk procedure, both legal).

No automatic convert-hold-to-charge. No folio line at authorize (existing rule).

Seed `('DAMAGE', 'Damage', tax_group = 'GOODS')` into `charge_code`. Add `'DAMAGE'` to `SYSTEM_CHARGE_CODES` (protected).

### 7.3 Manual discounts

Command `folio.post_discount`:

| | |
|---|---|
| Lane / degraded | `INTERACTIVE` / `FAIL_CLOSED` (references a line; same split commutativity) |
| Permission | `folio:adjust` (staff cannot discount — that **is** the approval gate; no second permission) |
| Entitlement | `pms.core` |
| Events | `folio.line_posted` |
| Idempotent | true; fingerprint `{ sourceFolioLineId, kind, bps?, amountMinor, reason }` |
| Audit | `afterJson.reason` required |

Input: `{ sourceFolioLineId, kind: 'percent' | 'fixed', bps?, amountMinor?, reason, folioLineId, idempotencyKey }`.

- `reason` trimmed length 1–500 → else `DISCOUNT_REASON_REQUIRED`.
- `percent`: `bps` 1–10000; amount = `Number(roundHalfAwayFromZero(BigInt(source.amount_minor) * BigInt(bps), 10000n))` then **negated** if source is positive. Source must be `amount_minor > 0` → else `LINE_NOT_DISCOUNTABLE`.
- `fixed`: `amountMinor > 0` and `amountMinor <= source.amount_minor` → post `-amountMinor`.
- Reject source `SPLIT_REVERSAL` / `TAX` / `PAYMENT` / `PAYMENT_REFUND` / `TRANSFER_REVERSAL` / `DISCOUNT`.
- Source window `OPEN`.
- Charge code `DISCOUNT`, `tax_group` NULL (exempt this chunk — leftover 5, taxable discounts). `source = 'DESK'`, `split_of = sourceFolioLineId`.
- Seed `('DISCOUNT', 'Discount')`. Add to `SYSTEM_CHARGE_CODES`.

Stay-level (no source line) is leftover 6. Line-level is auditable and foots.

### 7.4 Promo codes — **defer**

Reasons (not silence):

1. §7.2 puts promo on the **rate derivation graph** (plan modifiers, date, occupancy) — a posting-time discount is the wrong layer.
2. Needs a code registry (validity, stacking, channel, one-use), which this chunk does not have.
3. Quote snapshot (§8) is the related price freeze; promo would rewrite the snapshot.
4. Scope already includes close, transfer, split v2, void/refund, capture seam, extras, snapshot.

Named leftover 7. Do not seed a `PROMO` charge code that nothing honours.

---

## 8. Quote snapshot (lifecycle leftover 2)

### 8.1 Table `reservation_rate_night` (v21, new)

```sql
CREATE TABLE reservation_rate_night (
  reservation_id TEXT NOT NULL,
  stay_date      TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  rate_plan_id   TEXT NOT NULL,
  PRIMARY KEY (reservation_id, stay_date)
);
CREATE INDEX reservation_rate_night_plan_idx
  ON reservation_rate_night (rate_plan_id, stay_date);
```

No FK to `reservation` / `rate_plan` (same deploy-safety as `rate_day`).

### 8.2 When it is written

Same moment lifecycle snapshots penalty fields: inventory first committed (`pending`/`confirmed` create, inquiry `hold`/`confirm`). For each night in `enumerateStayDates`, copy `rate_day.amount_minor` / currency / `rate_plan_id`. Missing `rate_day` → `RATE_MISSING`, no reservation row (validate-then-mutate; snapshot inserts are in the same txn as `sold + 1`).

Inquiry create: **no** night rows (no inventory). Hold/confirm then snapshots.

**Modify dates:** new nights are inserted from **current** `rate_day`; overlapping nights **keep** the original snapshot (do not silently reprice a quoted night). Nights that leave the stay are `DELETE`d **only if unconsumed**. A night is **consumed** when a `folio_line` exists for that `(reservation_id, stay_date)` with `charge_code IN ('ROOM', 'NO_SHOW')` (`business_date = stay_date`). Consumed snapshot rows are **retained** — deleting them would let a later penalty or repost fall back to mutable `rate_day` and reprice history. Append-only means a reversed ROOM line still counts as consumed (the original row remains). Plan change on modify is not in today’s modify contract — if `ratePlanId` is passed later, leftover; this chunk’s modify does not re-snapshot plan (lifecycle: modify does not re-snapshot penalty either).

### 8.3 Readers

`penaltyMinor` and `postRoomChargesSync` (and desk cancel/no-show which call `penaltyMinor`):

1. `SELECT amount_minor FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`.
2. Hit → use it. Do not consult `rate_day`.
3. Miss (pre-v21 row, or a night added before this code): `rate_day` as today; if found, **lazy `INSERT OR IGNORE`** the snapshot so a later rate edit cannot change this stay; if `rate_day` missing → `RATE_MISSING`.

`P === R` no-op in `PROCESS_NO_SHOWS` remains true: both ROOM and penalty read the snapshot (or both fall back to the same `rate_day` on old rows).

No backfill migration of all reservations (rates may have changed since create; rewriting history is worse than lazy fallback).

### 8.4 Currency

Phase 1 identity: snapshot `currency` = ledger currency from `rate_day.currency`.

---

## 9. Schema — v21 `folio_money_ops`

`packages/do-runtime/src/property-migrations.ts` version **21**, name `folio_money_ops`. `pnpm generate:ddl`. `migrate.test.ts` pin `PROPERTY_SCHEMA_HEAD === 21`.

Incoming FKs: `folio_line.folio_window_id` → `folio_window`, `folio_line.payment_id` → `payment`, `payment.folio_window_id` → `folio_window`. Real-SQLite tests use `PRAGMA foreign_keys = ON`. Parent rebuilds **must** wrap with `PRAGMA foreign_keys = OFF` … `ON` (first/last statements of v21). `migrateSql` (`packages/do-runtime/src/index.ts` ~20) executes statements sequentially with **no** transaction wrapping, so `PRAGMA foreign_keys = OFF` takes effect. In the DO, migrations run at `property-do.ts` ~877 **before** `PRAGMA foreign_keys = ON` at ~878, so FKs are already off during migration; the wrap is belt-and-braces there and load-bearing for the FK-on real-SQLite test. Keep the wrap exactly as written. Include a real-SQLite test that runs all 21 migrations with FKs on after apply and inserts `voided` / `CLOSED`.

**A. `folio_window` rebuild** (discharge payments leftover “migration that first writes a second status must carry CHECK”):

```sql
PRAGMA foreign_keys = OFF;
CREATE TABLE folio_window_v21 (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('GUEST', 'COMPANY', 'MASTER')),
  billed_party    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at       INTEGER
);
-- copy; existing rows are OPEN / closed_at NULL
DROP TABLE folio_window;
ALTER TABLE folio_window_v21 RENAME TO folio_window;
CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id);
```

**B. `payment` rebuild** (status CHECK must grow; SQLite cannot ALTER a CHECK):

Copy every v13+v16 column (`tender_type`, `shift_id`) plus:

```
purpose                 TEXT NOT NULL DEFAULT 'STAY'
  CHECK (purpose IN ('STAY', 'DAMAGE')),
refunded_amount_minor   INTEGER
  CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0),
void_fingerprint        TEXT,
refund_fingerprint      TEXT,
status                  TEXT NOT NULL
  CHECK (status IN ('pending','authorized','declined','captured','unknown','voided','refunded'))
```

Recreate `payment_idempotency_uidx`, `payment_reservation_idx`. Backfill `purpose = 'STAY'`. Then `PRAGMA foreign_keys = ON`.

**C. Additive on `reservation`**

```sql
ALTER TABLE reservation ADD COLUMN no_post INTEGER NOT NULL DEFAULT 0
  CHECK (no_post IN (0, 1));
```

**D. `reservation_rate_night`** — §8.1.

**E. Charge-code seed**

```sql
INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('DISCOUNT', 'Discount', 'active', 0, 0),
  ('DAMAGE', 'Damage', 'active', 0, 0);
UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'DAMAGE';
-- DISCOUNT tax_group stays NULL (exempt)
```

`SYSTEM_CHARGE_CODES` becomes `['ROOM', 'PAYMENT', 'CANCEL', 'NO_SHOW', 'DISCOUNT', 'DAMAGE']`.

**F. `insertFolioLineSync`** — first statements after property-id: `SELECT status FROM folio_window WHERE folio_window_id = ?`; missing → throw; `CLOSED` → `WindowClosedError`. Every writer (desk, tax stamp, split reverse, transfer, night audit, capture, cash, discount, refund) flows through this. That is the closed-window guarantee.

---

## 10. Command catalog

### 10.1 New commands

| id | Lane | Degraded | Idempotent | Events | Entitlement | Permission |
|---|---|---|---|---|---|---|
| `folio.open_window` | INTERACTIVE | FAIL_CLOSED | true | `folio.window_opened` | `pms.core` | `folio:adjust` |
| `folio.close_window` | INTERACTIVE | FAIL_CLOSED | true | `folio.window_closed` | `pms.core` | `folio:adjust` |
| `folio.reopen_window` | INTERACTIVE | FAIL_CLOSED | true | `folio.window_reopened` | `pms.core` | `folio:adjust` |
| `folio.transfer_charge` | INTERACTIVE | FAIL_CLOSED | true | `folio.line_posted`, `folio.charge_transferred` | `pms.core` | `folio:adjust` |
| `folio.split_charge_v2` | INTERACTIVE | FAIL_CLOSED | true | `folio.line_posted` | `pms.core` | `folio:adjust` |
| `folio.void` | INTERACTIVE | FAIL_CLOSED | true | `folio.payment_voided` | `pms.core` | `folio:post` |
| `folio.refund` | INTERACTIVE | FAIL_CLOSED | true | `folio.payment_refunded`, `folio.line_posted` | `pms.core` | `folio:adjust` |
| `folio.post_discount` | INTERACTIVE | FAIL_CLOSED | true | `folio.line_posted` | `pms.core` | `folio:adjust` |
| `folio.capture_due` | INTERACTIVE | FAIL_CLOSED | true | `folio.payment_captured`, `folio.line_posted` | `pms.core` | `folio:post` |

All nine enter `AUDIT_WRITER_COMMAND_IDS` → size **44**. None enter `ENTITLEMENT_FAIL_CLOSED_OPT_OUT`. Kill-switch on these HTTP routes is **503** (dispatcher evaluates kill-switch before entitlement; lifecycle v3).

`folio.add_item` stays `QUEUE_PROVISIONAL` (replay re-validates window status). Do not promote it this chunk (front-desk leftover 1 remains a catalog-review item; close makes the exception path real rather than forcing FAIL_CLOSED on the lobby’s late-charge command).

### 10.2 Existing commands — field changes

| id | Change |
|---|---|
| `folio.authorize` | Optional `purpose: 'STAY' \| 'DAMAGE'`. Fingerprint +`purpose`. |
| `reservations.create` / `modify` / `hold` / `confirm` | Optional `noPost`. Create/hold/confirm also write `reservation_rate_night`. |
| `reservations.update_status` | Optional `noPost`. |
| `reservations.check_out` | After commit, live **first** call **awaits** capture-due inline (config); never `waitUntil`. Success body gains `autoCapture: 'captured' \| 'failed' \| 'skipped' \| 'disabled'`. Capture failure does not fail check-out. Same-key live replay skips the helper and **recomputes** `autoCapture` from payment/config state. Optional GUEST auto-close (config, zero balance) stays in the status txn. Events unchanged. Replay payload unchanged. |
| `folio.split_charge` / `split_charge_payment` | Implementation shares extended helper; contracts unchanged. |

### 10.3 Wire codes (`packages/contracts/src/idempotency.ts`)

```
WINDOW_CLOSED = 'window_closed'
WINDOW_NOT_CLOSABLE = 'window_not_closable'
WINDOW_BALANCE_DUE = 'window_balance_due'
WINDOW_NOT_REOPENABLE = 'window_not_reopenable'
WINDOW_NOT_OPENABLE = 'window_not_openable'
GUEST_WINDOW_NOT_OPENABLE = 'guest_window_not_openable'
TRANSFER_CROSS_RESERVATION = 'transfer_cross_reservation'
TRANSFER_SAME_WINDOW = 'transfer_same_window'
LINE_NOT_TRANSFERABLE = 'line_not_transferable'
LINE_NOT_DISCOUNTABLE = 'line_not_discountable'
PAYMENT_NOT_VOIDABLE = 'payment_not_voidable'
PAYMENT_NOT_REFUNDABLE = 'payment_not_refundable'
DISCOUNT_REASON_REQUIRED = 'discount_reason_required'
```

HTTP: all of the above → **422**. Existing `PSP_UNAVAILABLE` → 501. Kill-switch → 503.

---

## 11. HTTP routes

Append at **95–103**. `check:permissions` requires matching `V1_ROUTES` order.

| Index | id | Method / pattern | Permission | commandId | Entitlement |
|---|---|---|---|---|---|
| 95 | `post_folio_window` | `POST` `/v1/properties/:pid/reservations/:rid/folio/windows` | `folio:adjust` | `folio.open_window` | `pms.core` |
| 96 | `post_folio_window_close` | `POST` `/v1/properties/:pid/folio/windows/:wid/close` | `folio:adjust` | `folio.close_window` | `pms.core` |
| 97 | `post_folio_window_reopen` | `POST` `/v1/properties/:pid/folio/windows/:wid/reopen` | `folio:adjust` | `folio.reopen_window` | `pms.core` |
| 98 | `post_folio_transfer` | `POST` `/v1/properties/:pid/folio/lines/:lid/transfer` | `folio:adjust` | `folio.transfer_charge` | `pms.core` |
| 99 | `post_folio_split_v2` | `POST` `/v1/properties/:pid/folio/lines/:lid/split-v2` | `folio:adjust` | `folio.split_charge_v2` | `pms.core` |
| 100 | `post_folio_void` | `POST` `/v1/properties/:pid/folio/payments/:payId/void` | `folio:post` | `folio.void` | `pms.core` |
| 101 | `post_folio_refund` | `POST` `/v1/properties/:pid/folio/payments/:payId/refund` | `folio:adjust` | `folio.refund` | `pms.core` |
| 102 | `post_folio_discount` | `POST` `/v1/properties/:pid/folio/lines/:lid/discount` | `folio:adjust` | `folio.post_discount` | `pms.core` |
| 103 | `post_folio_capture_due` | `POST` `/v1/properties/:pid/reservations/:rid/folio/capture-due` | `folio:post` | `folio.capture_due` | `pms.core` |

Bodies carry `idempotencyKey`. Mutations `FAIL_CLOSED` via `invokePropertyDo` (503, never 202).

**`GET …/folio` (existing `[22]`):** additive, not a new route.

```ts
{
  window: { folioWindowId, kind, status, closedAt: number | null } | null; // GUEST, still
  windows: Array<{
    folioWindowId: string;
    kind: string;
    status: string;
    billedParty: string | null;
    closedAt: number | null;
    balanceMinor: number;
  }>;
  lines: Array<… & { folioWindowId: string }>;
  balanceMinor: number; // reservation-wide, unchanged
  noPost: boolean;
}
```

`window.status` is now a real discriminator (payments §2.3 wire-lie **ends**). Clients that treated `OPEN` as tautology keep working until they close one.

`GET …/folio/payments` (existing): add `purpose`, `status` includes `voided`/`refunded`.

---

## 12. Config

| Key | Class | Schema | Default | Consumers |
|---|---|---|---|---|
| `pms.folio.close_window_on_check_out` | DOMAIN | bool | `false` | `consumersExempt: true` |
| `pms.folio.auto_capture_on_check_out` | DOMAIN | bool | `false` | exempt |

Prototype keys: `pms_folio_close_on_checkout`, `pms_folio_auto_capture_checkout`.

---

## 13. Night-audit interplay (normative pointer)

| Step | Change |
|---|---|
| `POST_ROOM_CHARGES` | Skip `no_post = 1`. Price from `reservation_rate_night` then fallback §8.3. Predicate unchanged (`confirmed \| checked_in`). Closed GUEST cannot occur for those statuses (§3.2) — if it did, `insertFolioLineSync` would FAIL the step (correct; do not special-case). |
| `PROCESS_NO_SHOWS` | `penaltyMinor` reads snapshot. No new step. |
| Other five | Untouched. |
| Auto-transfer | **Not this chunk.** Do not append to `NIGHT_AUDIT_STEPS`. Do not fold into `POST_ROOM_CHARGES` / `ARCHIVE`. |

---

## 14. SPA surface

Existing `FolioScreen` only. No new nav.

| Control | Lock |
|---|---|
| Window tabs / list | Render `windows[]`; per-window balance; `CLOSED` chip via `status-class.ts` (`neutral` open, `informational` closed). |
| Close / Reopen | Visible with `folio:adjust`. Close disabled when window balance ≠ 0 or (GUEST and not terminal). Confirm dialog on close. |
| Open COMPANY | `folio:adjust`; billed-party field. |
| Transfer | Line action → dest window picker (other OPEN windows of this reservation). |
| Split v2 | Existing split UI stays on v1 route. Optional dest per slice is a **follow-on** if the current split modal cannot take a window without a redesign — **API this chunk; SPA dest picker leftover 8** if time-boxed. Prefer shipping dest picker if the modal is a simple list. **Lock: ship dest picker** — otherwise v2 has no operator. |
| Discount | Line action, `folio:adjust`; reason required; percent/fixed. |
| Void | On `authorized` rows; `folio:post`. |
| Refund | On `captured` rows; `folio:adjust`. |
| Capture-due | Button when `authorized` STAY holds exist and `balanceMinor > 0`; `folio:post`. Also the retry when check-out returned `autoCapture: 'failed'`. |
| No-post | Chip + toggle via front-office (`update_status`). Toggle uses `reservations:write` (staff has it). Staff may mark no-post. |
| Check-out | Unchanged override dialog. Read `autoCapture` from the check-out response — do not guess from a payments refetch. `'failed'` → show capture-due retry. `'captured'` → refresh folio/payments. If auto-close config, copy: window will close when balance is zero. Do not client-close; server is authority. |
| Quote nights | Not a FolioScreen widget this chunk (API + tests). |

`packages/client-core`: methods for the nine POSTs; widen folio read / payment types; `stableKeyForOperation`.

---

## 15. Degraded-mode summary

| Command | Live outage | Replay |
|---|---|---|
| open/close/reopen/transfer/split v2/void/refund/discount/capture-due / authorize/capture/cash | 503 FAIL_CLOSED | n/a |
| `folio.add_item` | 202 queue | re-validate window OPEN; `WINDOW_CLOSED` → `provisional_exception` |
| `reservations.check_out` | 202 queue | balance gate + optional auto-close if bal=0 and config; **no** auto-capture |
| Front-desk folio GET | 503 FAIL_CLOSED (unchanged) | n/a |

Never print a folio in `DEGRADED` (existing §4.6 UI rule).

---

## 16. Open questions — resolved

1. **Auto-close on check-out vs explicit. Resolved: explicit always; auto-close config default `false`.** Reversing lifecycle leftover 4 as the default would make late charges the exception path on day one. Properties that want departed=closed opt in. Auto-close never fires with a non-zero balance.
2. **Close with open balance / override. Resolved: reject `WINDOW_BALANCE_DUE`.** A closed window that still owes is city ledger. No `overrideClose`.
3. **Reopen. Resolved: explicit `folio.reopen_window`.** Silent reopen is forbidden; the exception path is a human command plus `provisional_exception` on queued posts, not a missing button.
4. **`cancel_check_in` vs close. Resolved: GUEST cannot close while `checked_in`, so the collision does not exist.**
5. **Night-audit auto-transfer. Resolved: defer.** Primitive ships; step does not. Do not grow `NIGHT_AUDIT_STEPS`. Do not fold into POST/ARCHIVE.
6. **Existing split commands. Resolved: keep as same-window shims; v2 is cross-window capable.** Not deprecated this chunk.
7. **Void/refund money. Resolved: void = status only; refund = reversing `PAYMENT_REFUND` line, `payment_id` NULL, original capture untouched.** Full refund only.
8. **Auto-capture topology. Resolved: `folio.capture_due` FAIL_CLOSED; live check-out awaits the helper inline after commit (no `waitUntil`); capture failure does not fail check-out; success body carries `autoCapture`; same-key live replay does not re-await — it recomputes `autoCapture` from payment/config state (see §6.4); event-consumer does not call the DO.** Config default false. First call reports the actual helper outcome; replay recomputes. One benign divergence: a hold already captured before check-out is first-call `'skipped'` and replay `'captured'` — both non-error, same SPA reaction.
9. **Damage deposit. Resolved: authorize `purpose=DAMAGE` hold; not auto-captured; desk voids or captures + posts `DAMAGE`.**
10. **No-post grain. Resolved: per reservation, skips night-audit ROOM only.**
11. **Discount approval. Resolved: `folio:adjust` is the gate** (staff lack it). Reason required. Line-level. Tax-exempt this chunk.
12. **Promo. Resolved: defer** with reasons in §7.4.
13. **Quote snapshot fallback. Resolved: lazy backfill from `rate_day`; no mass rewrite of existing stays. Modify retains snapshot nights consumed by a ROOM or NO_SHOW posting; deletes only unconsumed rows.**
14. **`folio.add_item` class. Resolved: stay `QUEUE_PROVISIONAL`;** close is enforced on replay. Promoting would disable late charges during outage.
15. **MASTER windows. Resolved: one per reservation as a transfer target; no group engine.**
16. **Payment CHECK rebuild. Resolved: v21 rebuilds `payment` and `folio_window` under `PRAGMA foreign_keys=OFF`** so the CHECK can grow / appear; real-SQLite proof required.

None left open.

---

## 17. Test matrix

Names are the acceptance list, not a file-split mandate. Fixture dates from property-local `business_date`.

**Window close / reopen**

1. Check-out default config, `balanceMinor === 0` → `checked_out`, GUEST still `OPEN`, `closed_at` NULL.
2. Config `close_window_on_check_out = true`, zero balance → GUEST `CLOSED`, `closed_at` set, `folio.window_closed`.
3. Config true, `overrideBalance` with `balanceMinor > 0` → `checked_out`, GUEST **OPEN** (no auto-close).
4. `POST …/close` on in-house GUEST → `WINDOW_NOT_CLOSABLE`.
5. Close GUEST on `checked_out` with window balance 0 → `CLOSED`.
6. Close with window balance ≠ 0 → `WINDOW_BALANCE_DUE`, still `OPEN`.
7. `add_item` on CLOSED → `WINDOW_CLOSED`; `ensureGuestFolioWindowSync` does not reopen (status stays CLOSED).
8. Queued `folio.add_item` then live close then drain → `provisional_exception` `WINDOW_CLOSED`; no line.
9. Reopen → `OPEN`, `closed_at` NULL, `folio.window_reopened`; subsequent `add_item` succeeds.
10. Reopen of OPEN → `{ alreadyOpen: true }`, no second audit.
11. Close COMPANY while guest `checked_in` and company window balance 0 → allowed; GUEST still OPEN.
12. `cancel_check_in` after check-in (GUEST OPEN) → `confirmed`, window OPEN. (No closed-GUEST fixture possible.)
13. Second close of CLOSED → `{ alreadyClosed: true }`.
14. Staff `folio:post` without `folio:adjust` → close 403.

**Transfer / split v2**

15. Transfer ROOM from GUEST to COMPANY: source kept, reverse `TRANSFER_REVERSAL` in GUEST, dest `TRANSFER` in COMPANY, `split_of` both, reservation `balanceMinor` unchanged, per-window balances move, tax restamped on dest.
16. Transfer into CLOSED dest → `WINDOW_CLOSED`, zero new lines.
17. Transfer to another reservation’s window → `TRANSFER_CROSS_RESERVATION`.
18. Transfer TAX line → `LINE_NOT_TRANSFERABLE`.
19. Idempotent transfer (same key / dest id exists) → one reverse + one dest.
20. `split_charge` (v1) still same-window reverse+children; `balanceMinor` unchanged (regression).
21. `split_charge_v2` 60/40 same window ≡ v1 shape (`SPLIT_REVERSAL` + children).
22. `split_charge_v2` 60 GUEST / 40 COMPANY: reverse in GUEST, children on each window, tax allocated with `allocate` LAST, both windows OPEN required.
23. v2 with one CLOSED dest → `WINDOW_CLOSED`, no reverse.
24. Foot mismatch → `SPLIT_AMOUNT_MISMATCH`.
25. `PLATFORM_GAPS` no longer contains `folio.transfer_charge` or `folio.split_charge_v2`.

**Payments**

26. Void `authorized` → `voided`, zero folio lines, `folio.payment_voided`.
27. Void `captured` / cash → `PAYMENT_NOT_VOIDABLE`.
28. Refund full capture → `refunded`, positive `PAYMENT_REFUND` line, `payment_id` NULL, `split_of` = capture line, `balanceMinor` up by captured amount, capture line untouched.
29. Refund `authorized` → `PAYMENT_NOT_REFUNDABLE`.
30. Cash refund (no PSP) → same ledger shape; simulate not called (spy / unbound adapter).
31. Second refund same fingerprint → idempotent; one refund line (`folio_line_payment_uidx` still one capture line).
32. Capture-due with two STAY holds covering the balance → captures FIFO until 0; DAMAGE hold untouched.
33. `auto_capture_on_check_out = true`, live check-out with an authorized STAY hold and `require_zero` false → guest `checked_out`, hold `captured`, response **`autoCapture: 'captured'`**. (Not a capture-due HTTP retry — the RPC awaited the helper.) Same-key live replay recomputes `'captured'` and does not re-await the helper.
34. Provisional replay of check-out with config true and an eligible STAY hold → payment still `authorized`, response **`autoCapture: 'skipped'`**.
35. `unknown` void/refund/capture → not_voidable / not_refundable / not_capturable.
36. Simulate-off void → `PSP_UNAVAILABLE` 501.

**Extras + snapshot**

37. `no_post = 1` confirmed covering D → `POST_ROOM_CHARGES` COMPLETED, **zero** ROOM lines for that reservation; sibling with `no_post = 0` still posted.
38. `no_post` does not block `add_item`.
39. Authorize `purpose=DAMAGE`; capture-due skips it; void succeeds.
40. Discount 10% (`bps=1000`) of a 10000 line → `-1000` `DISCOUNT`, `split_of` set, reason on audit; staff 403.
41. Discount without reason → `DISCOUNT_REASON_REQUIRED`.
42. Create confirmed 2-night stay → two `reservation_rate_night` rows equal to then-current `rate_day`. Update `rate_day` for night 1 → `penaltyMinor` / `POST_ROOM_CHARGES` still use snapshot.
43. Pre-v21 reservation (no night rows) + live `rate_day` → ROOM posts at `rate_day`, snapshot row lazily inserted; subsequent `rate_day` edit does not change a second post (retry COMPLETED) nor penalty.
44. Create pending, missing `rate_day` → `RATE_MISSING`, no reservation, no snapshot rows, `sold` unchanged.
45. Modify stay: add a night → new snapshot from current `rate_day`; overlapping nights unchanged.
46. Modify **shortens** a 2-night stay after night 1 was night-audited (`ROOM` / `NIGHT_AUDIT` for D): night-1 `reservation_rate_night` **retained**; night-2 row **deleted**. Subsequent `rate_day` edit on night 1 does not change `penaltyMinor` / a later reader of that snapshot.

**Pins / gates**

47. `AUDIT_WRITER_COMMAND_IDS.size === 44`; `[94]` unchanged; `[95]=post_folio_window`; `[103]=post_folio_capture_due`.
48. `PROPERTY_SCHEMA_HEAD === 21`; real-SQLite: insert `status='voided'` and `status='CLOSED'` succeeds; `'BOGUS'` fails CHECK.
49. `check:degraded` / `check:entitlements` / `check:permissions` / `check:ddl` / `check:pms-core-test-dates` / `check:do-transport-guards` green.
50. `event-consumer.ts` allowlists `folio.window_opened`, `folio.window_closed`, `folio.window_reopened`, `folio.charge_transferred`, `folio.payment_voided`, `folio.payment_refunded`.
51. Kill-switch `pms.core` + close/transfer/void → 503.

**SPA (injected transport)**

52. Closed chip; close disabled on non-zero window balance.
53. Transfer picker lists other OPEN windows only.
54. Void visible on authorized; refund hidden for staff (no `folio:adjust`).
55. Discount requires reason before submit.

---

## 18. File map (implementation, not a plan)

| File | Role |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` + `0021_folio_money_ops.sql` | v21 rebuilds + snapshot table + no_post + seeds |
| `packages/do-runtime/src/migrate.test.ts` | Head 21; v21 statement presence |
| `packages/do-runtime/src/folio-money-ops-migration.sqlite.test.ts` | Real-SQLite FK-on + CHECK voided/CLOSED |
| `packages/contracts/src/commands/catalog.ts` | Nine commands; authorize `purpose`; drop two PLATFORM_GAPS |
| `packages/contracts/src/commands/audit-writers.ts` | +9; size 44 |
| `packages/contracts/src/idempotency.ts` | Wire codes §10.3 |
| `packages/contracts/src/config/register.ts` | Two keys |
| `packages/contracts/src/v1-http-routes.ts` | 95–103 |
| `packages/contracts/src/register.test.ts` | Pins |
| `apps/pms-core/src/psp-simulate.ts` | void + refund |
| `apps/pms-core/src/property-do.ts` | Window helpers; `insertFolioLineSync` CLOSED gate; transfer; split helper dest; void/refund/capture-due; discount; snapshot write/read + consumed-night retain on modify; no_post skip in `postRoomChargesSync`; live check-out **awaits** capture-due, returns `autoCapture` |
| `apps/pms-core/src/v1-dispatch.ts` | Nine handlers; widen GET folio / payments / create-modify; check-out JSON includes `autoCapture` |
| `apps/pms-core/src/event-consumer.ts` | Six new event types |
| `apps/pms-core/src/pending-commands-consumer.ts` | No new dispatch ids (all FAIL_CLOSED). `add_item` already replays through `tryAddFolioLine` (picks up CLOSED). |
| `packages/client-core` + `apps/web-pms` | §14 |
| Specs | One-sentence amends in lifecycle / payments / charge-code |

---

## 19. Leftovers (named, not silent)

1. **Night-audit auto-transfer** — needs routing-rules table + an allowed change to `NIGHT_AUDIT_STEPS` (or an architecture amendment naming the owning step). Key remains `(reservation_id, business_date, rule_id)`.
2. **Collapse `split_charge` / `split_charge_payment` / `split_charge_v2`** into one command once SPA speaks v2 only.
3. **`unknown` reconciliation exit** (payments leftover, unchanged).
4. **Partial refunds** and **chargebacks** (`payment.chargeback_received`).
5. **Taxable discounts** / tax restamp on discount.
6. **Stay-level discount** (no source line).
7. **Promo codes** — §7.4.
8. **Authorization expiry** / hold-lapse (payments leftover).
9. **City ledger / AR** and MASTER group billing engine.
10. **`folio.add_item` catalog class review** (front-desk leftover 1) — still QUEUE_PROVISIONAL; close makes replay honest.
11. **SQL CHECK on `folio_window.status`** — **closed this chunk** by the v21 rebuild (payments leftover discharged).
12. **Re-apply a failed provisional late charge after reopen** — resolve remains acknowledge-only (night-audit leftover 9).

---

## 20. Implementation checklist

- [x] v21: folio_window rebuild + CHECK; payment rebuild + voided/refunded/purpose; `no_post`; `reservation_rate_night`; DISCOUNT/DAMAGE seed; `SYSTEM_CHARGE_CODES` length 6; `PRAGMA foreign_keys` wrap; `pnpm generate:ddl`; real-SQLite test.
- [x] `insertFolioLineSync` CLOSED gate; all writers flow through it.
- [x] `tryOpenFolioWindow` / `tryCloseFolioWindow` / `tryReopenFolioWindow`; check-out auto-close config path.
- [x] `tryTransferCharge`; tax restamp; deterministic ids.
- [x] Extend `splitFolioLineSync` dest window; `trySplitChargeV2`; v1 unchanged contracts.
- [x] `tryVoidPayment` / `tryRefundPayment` / `tryCaptureDueHolds`; simulate void/refund; live `tryCheckOut` **awaits** helper inline (no `waitUntil`); `autoCapture` on success body; same-key live replay recomputes `autoCapture` from state (does not re-await).
- [x] `tryPostDiscount`; `no_post` skip in `postRoomChargesSync`; authorize `purpose`.
- [x] `snapshotRateNightsSync` on inventory commit + modify; **retain consumed** (ROOM/NO_SHOW) nights on shorten; `penaltyMinor` / `postRoomChargesSync` read snapshot with lazy fallback.
- [x] Catalog + audit-writers 44 + events allowlist + two config keys + drop two PLATFORM_GAPS.
- [x] Routes 95–103; GET folio additive `windows` / `folioWindowId` / `noPost`; existing check-out JSON includes `autoCapture`.
- [x] SPA §14.
- [x] Bidirectional one-liners in lifecycle / payments / charge-code specs.
- [x] Test matrix §17; `pnpm build`, `check:ddl`, `check:entitlements`, `check:permissions`, `check:degraded`, `check:pms-core-test-dates`, `check:do-transport-guards`, `check:class-denylist`, `typecheck`, package tests, `pnpm lint`.

---

## 21. Acceptance (reviewer checklist)

- [x] Window close vs lifecycle balance gate is a state machine, not a slogan: default stays OPEN; config auto-close only at zero; late charge on CLOSED is `WINDOW_CLOSED` / exception, never silent reopen; explicit reopen exists.
- [x] `cancel_check_in` cannot observe a closed GUEST window.
- [x] Transfer is reverse + dest posting, `split_of`, same-reservation, CLOSED reject; auto-transfer deferred with reasons; `NIGHT_AUDIT_STEPS` still 7.
- [x] Split v2 feet exactly via `allocate`; cross-window subject to transfer rules; v1 kept.
- [x] Void is not money; refund is a reversing line; capture line never updated; `payment_id` unique index preserved.
- [x] Auto-capture is FAIL_CLOSED, config-gated, **awaited inline** on live check-out (no `waitUntil`); capture failure does not fail check-out; success body carries `autoCapture`; test 33 asserts `'captured'`; same-key live replay recomputes from state; skipped on provisional replay; `folio.balance_due` remains the event seam.
- [x] Payments stay FAIL_CLOSED; new entitled commands have events + audit writers; size 44; routes append at 95.
- [x] Quote snapshot is the price source with lazy fallback for existing rows; `P === R` still holds; **modify retains consumed snapshot nights** (test 46).
- [x] Promo deferred with reasons; city ledger out; no new night-audit step.
- [x] Open questions section has zero unresolved items.
- [x] Out of scope includes city ledger, real PSP, partial refund, routing-rules table.
