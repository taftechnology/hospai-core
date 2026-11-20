# Advance collection (R4.25, advance half)

**Date:** 2026-11-20
**Status:** Accepted for implementation (advance flow only)
**Roadmap:** R4.25 (Track P). Pilot checklist *Advance / deposit payments in the booking*, part of *Guest documents*.
**BluePMS page group:** Front Office → *Advances, receipts and deposits* ([inventory](../../research/2026-09-12-bluepms-modules.md)).
- Take an advance when creating a reservation, later against it, or during a stay.
- Several payment rows per capture, each with amount, method, reference and notes.
- A panel shows estimated bill, total advance and pending amount.
- A numbered receipt.
- Group deposits.
- A night-audit arrival-deposit check.

**Sources:**
- [UPI tender](./2026-11-19-upi-tender-design.md): the tender list `CARD | CASH | UPI` and `folio.record_upi_payment`.
- [Cashiering](./2026-08-07-cashiering-design.md): the cash path and shifts.
- R1.20: the `pms.booking.require_prepayment` gate and `hasStayGuaranteeSync`.
- [Night audit operator job](./2026-10-30-night-audit-operator-job-design.md) §checks: the row "Arrival deposits … R4.25, reading the R1.20 rule".
- [Packages, proforma and documents](./2026-11-19-packages-proforma-documents-design.md) §B1: the proforma totals.
- R1.4: the add-on post-after-confirm pattern with Retry.

## Not in this half

**The numbered receipt waits on the tax advisor.** Must an advance on a future stay carry GST and a statutory receipt voucher? The receipt series (R1.12) and any tax lines follow that answer (roadmap fork, Track P rule 3). This half adds:
- no receipt route;
- no receipt series;
- no *Receipt* button in the stay card's Documents group.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **An advance is a payment on the GUEST window through the existing commands:**<br>• `folio.record_cash_payment` (`post_cash_payment`)<br>• `folio.record_upi_payment` (`post_upi_payment`)<br>• the existing card path<br>There is no new command, route, money model or deposit table, and no write to `availability_day`. |
| D2 | **Where:**<br>• on Book, after Hold or Confirm succeeds<br>• on the stay card (`/reservations/:id`)<br>• at check-in<br>• on the folio<br>All four use one SPA component, `AdvancePayments`. It is extracted from the folio's *Take a payment* cash/UPI form, so the folio uses it too. The folio keeps its card and damage-deposit section as it is.<br>Offered only for `pending`, `confirmed` and `checked_in` stays. |
| D3 | **Several rows per capture.** Each row has:<br>• method: Cash, UPI or Card. Card opens the existing card flow for that row's amount.<br>• amount (integer minor units, parsed with the existing money input)<br>• the UPI reference (required for UPI, validated as in the UPI spec D4)<br>No notes field: the payment commands have none, and adding one is out of scope.<br>At most **8 rows** (a UI cap). Every row is a separate command call with **its own operation id**, `advance:{reservationId}:{rowKey}:{uuid}`.<br>Rows post one after another. A failed row keeps its key and shows its `classifiedUserMessage`; **Retry re-posts only the failed rows with the same keys**. A row that succeeded never posts again, and its id rotates after success. The booking always stands whatever happens to the rows (as R1.4 add-ons). |
| D4 | **Advance panel.** It shows estimated bill, total advance and pending amount. There is no second money calculation:<br>• **After the reservation exists:** the three numbers come from `get_reservation_proforma` totals (`estimatedTotalMinor`, `advancePaidMinor`, `balanceMinor`).<br>• **On Book before Hold/Confirm:** only the quote total shows.<br>The panel follows the proforma's FAIL_CLOSED rule: on error or degraded, it shows an Alert and no numbers. |
| D5 | **Pre-arrival payments must be proven, not assumed.** The roadmap says "read, not run". Characterize these first in pms-core:<br>• cash and UPI on a `pending` (Hold) and on a `confirmed` stay reach the GUEST window;<br>• they survive check-in on the same window;<br>• checkout nets them in the balance;<br>• with `require_prepayment` on, an advance satisfies `hasStayGuaranteeSync` and check-in passes.<br>If any of these fails today, fix it in the existing command. Do not add a new one. |
| D6 | **Night-audit check `arrival_deposit_missing`** (new id in `NIGHT_AUDIT_CHECK_IDS`, default `warn`). It counts reservations that meet all of these:<br>• status `confirmed` or `pending`<br>• `arrival_date <= businessDate`<br>• no stay guarantee (the same predicate as `hasStayGuaranteeSync`)<br>It counts **only when `pms.booking.require_prepayment` is true** and is 0 otherwise, so the R1.20 rule is the only switch. Settings → Night audit lists it with the others. |
| D7 | **Refunds and cancellations** use the existing `folio.refund` and cancellation-penalty paths. No change. |
| D8 | **Shifts:** cash advances follow the cash rules (the open shift is stamped if there is one). No change to the expected-cash formula. |

## 2. SPA

- `AdvancePayments` (new, in `apps/web-pms/src/screens/`):
  - props: `propertyId`, `reservationId`, and a context (`book` / `stay` / `check-in` / `folio`);
  - built only from the kit (`Field`, `Input`, `NativeSelect`, `Button`, `Alert`, `DataTable` or a row list);
  - success is a settled Alert ("Advance of ₹X recorded.", summed over the rows that posted);
  - errors use `classifiedUserMessage`.
- Book: after Hold or Confirm, rows entered before submission post as in D3. The confirmation view shows each row's outcome with Retry.
- Stay card: an *Advance* card with the panel and the rows.
- Check-in: the panel and rows sit where the prepayment block reason shows today. A successful advance clears the block without a reload.
- **Cache keys:** after each successful row, invalidate the folio, payments and proforma keys the screens use (full keys with `propertyId` and `reservationId`) and the shift strip key. Assert them in tests.

## 3. Tests

pms-core (a characterization file `advance-collection.spec.ts`):
1. Cash advance on `pending`, then on `confirmed` → a GUEST window PAYMENT line. Check-in leaves it on that window. Checkout balance = charges − advance.
2. UPI advance on a confirmed stay; same-key replay posts once; a second row with a different key posts separately.
3. `require_prepayment` on: check-in refused before the advance, passes after.
4. `arrival_deposit_missing`:
   - with the rule on → counts an unpaid arrival, not a paid one, not a `checked_in` stay;
   - with the rule off → 0.
5. Proforma totals after two advances: `advancePaidMinor` = the sum, and the balance nets it.

contracts: `NIGHT_AUDIT_CHECK_IDS` length 7 and its default map.

web-pms:
- rows add and remove up to 8;
- UPI requires a reference;
- two rows post with distinct op ids;
- a failed row retries with the same key while the succeeded row is not re-posted;
- the panel renders proforma totals and an Alert on error;
- Book posts rows after Confirm and the booking stands on failure;
- check-in clears the block after a successful advance;
- cache keys are asserted.

## 4. Pins

- `NIGHT_AUDIT_CHECK_IDS`: length **7**, includes `arrival_deposit_missing`.
- Catalog, routes and schema: unchanged.

## 5. Out of scope

- The numbered receipt and its series (the advisor fork).
- Group deposit allocation (R4.1).
- Gateway capture (R4.7).
- A standalone advance page (client Q21).
- Notes on a payment.
- Bank transfer.
