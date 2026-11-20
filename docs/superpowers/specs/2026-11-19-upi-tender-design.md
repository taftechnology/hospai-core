# UPI tender at the desk (R4.18)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.18 (Track P). Pilot checklist Q4, answered by the client on 2026-11-19: the desk takes **UPI**; there is **no bank transfer**.
**Amends:**
- [Cashiering](./2026-08-07-cashiering-design.md) §2.1: the tender list becomes `CARD | CASH | UPI`.
- AGENTS.md §2 *Tenders*: that line becomes `CARD | CASH | UPI`.

The roadmap lock requires the cashiering spec to be amended first. This spec is that amendment, together with its implementation.
**Sources:**
- Cashiering §2.1 (the cash tender's honest path), §2.2 (shifts) and the expected-cash formula.
- `folio.record_cash_payment` / `post_cash_payment`.
- `computeShiftExpectedCashSync` and `countUnattributedCashForBusinessDateSync`.
- The refund path (CARD goes to the PSP; everything else is local).
- The capture and void guards that reject `CASH`.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | UPI is a **tender, not a gateway**. The guest pays on their own UPI app to the hotel's VPA or QR, and the clerk records the payment with the reference the app shows. There is no UPI collect, no PSP and no gateway call (R4.7 / R5.4 own any integration). |
| D2 | **`payment.tender_type`** becomes `CARD \| CASH \| UPI`. SQLite cannot widen a CHECK, so the migration rebuilds `payment` with the same columns, the same indexes and the same foreign keys. It copies every row, and adds `external_reference TEXT`. A test on the real-SQLite harness proves that every existing row and index survives. |
| D3 | **New command `folio.record_upi_payment`**, with its own catalog entry. It mirrors `folio.record_cash_payment` exactly:<br>• permission `folio:post`, entitlement `pms.core`, lane INTERACTIVE<br>• degraded FAIL_CLOSED (the same shift-attribution reason)<br>• events `folio.payment_captured` and `folio.line_posted`<br>• one `transactionSync` that inserts `payment` at `captured` with `tender_type = 'UPI'` and the open shift's `shift_id` (if any), plus the negative `PAYMENT` folio line<br>• `gateway_reference` NULL<br>Route `post_upi_payment`, the same shape as `post_cash_payment` plus `reference`. |
| D4 | **The UPI reference is required**: trimmed, `^[A-Za-z0-9]{6,35}$` (12-digit UTR/RRN, or an app transaction id). It is unique per property among captured UPI payments, so recording one twice → `422 duplicate_upi_reference`. This stops the same transfer being booked twice. It is stored in `external_reference` and shown on the payment and folio views. It is not PII. Never put it in a URL. |
| D5 | **Not capturable or voidable as an authorization.** Every guard that rejects `CASH` because it is "not a PSP tender" (capture, void-authorization, auth expiry, auto-capture-at-checkout candidates) must reject `UPI` too. Make the predicate one helper, `isPspTender(t) = t === 'CARD'`, and use it everywhere a guard means "not a PSP tender". Leave CASH-only logic, such as the cash drawer, as it is. |
| D6 | **Refunds** go through the existing `folio.refund`. UPI follows the non-CARD branch: a local refund line, no PSP. The clerk returns the money on their own UPI app. The refund takes an optional `reference` for that return transfer, under the same pattern, stored on the refund row if a column exists; otherwise add `external_reference` there too. |
| D7 | **Shifts: UPI is not cash in the drawer.** Expected cash stays `opening_float + Σ captured CASH`, unchanged. The shift reads add **per-tender totals** for the shift, as information. **The count stays blind** ([front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md) §3.5: no sum of cash on an open shift). So while a shift is OPEN, every read and screen (shift strip, close screen, `readCurrentOpenShift`, `readShift` on an open shift) carries **Card and UPI only**. The Cash total appears only once the shift is closed. The unattributed-cash night-audit check stays CASH-only. *(Amended 2026-11-20 after browser review: the first build showed the Cash total on the open-shift close screen.)* |
| D8 | The accounting export mapping (R4.12) is not built yet. Note there that UPI needs its own ledger mapping. No bank transfer, cheque, voucher or gift tender. |

## 2. SPA

- **Folio:** the **Record payment** action gains a tender choice, **Cash** or **UPI**.
  - UPI shows a required **UPI reference** field (validated as in D4) and the amount.
  - Errors use `classifiedUserMessage`. `duplicate_upi_reference` reads: "This UPI reference is already recorded on another payment."
  - The payments list shows the tender and, for UPI, the reference.
- **Refund dialog:** shows an optional reference when the payment being refunded is UPI.
- **Shift card / shift close:** per-tender totals.
- **Cache keys:** the existing folio and payments keys. Tests assert the invalidations.

## 3. Tests

pms-core:
1. Migration: the payment rebuild keeps every row (CARD, CASH, refunded, authorized), every index and every foreign key. A `UPI` insert passes the new CHECK; an unknown tender fails it.
2. Record UPI:
   - a captured payment plus a negative PAYMENT line;
   - the balance drops;
   - the open shift is stamped;
   - a same-key replay posts once;
   - a different key with the same reference → `duplicate_upi_reference`;
   - a bad reference format → 422;
   - a user without `folio:post` → 403.
3. Capture, void-authorization and auto-capture refuse a UPI payment (`PAYMENT_NOT_CAPTURABLE` or the existing code), and the auth-expiry sweep ignores it.
4. A refund of a UPI payment posts locally with no PSP call (assert the simulate adapter is not invoked), and a partial refund leaves the correct remaining amount.
5. Shift expected cash ignores UPI. The shift summary shows the UPI total. Checkout with the balance paid by UPI passes.

web-pms:
- the tender select;
- the UPI reference is required and validated;
- the duplicate message;
- the payments list shows the tender;
- the shift totals;
- the cache keys.

## 4. Pins

- `COMMAND_CATALOG` +1.
- `V1_HTTP_ROUTE_AUDIT` +1, last id `post_upi_payment`.
- `PROPERTY_SCHEMA_HEAD` +1.
- Audit writers: follow `folio.record_cash_payment`'s membership.
- Update the AGENTS.md pins and §2 *Tenders*, and amend the cashiering spec §2.1 and its locks table.

## 5. Out of scope

- UPI collect requests, QR generation and payment-status polling (gateway work, R4.7 / R5.4).
- Bank transfer (the client does not use it).
- Splitting one advance across tenders. That is R4.25's several payment rows, which reuse this command.
