# Operational reports, Part B: cashier and financial (R4.14)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part B of three)
**Roadmap:** R4.14 (Track P). Part A (framework and front office) is `40b94d8`; read its spec first: [Part A](./2026-11-20-reports-a-framework-front-office-design.md). Part B plugs into that registry, runner, print and CSV.
**BluePMS names (inventory §11):** Cashier Summary and Cashier Audit, Corrections and Cancelled Payments, Deposit Activity and Deposit Ledger, Detailed Folio, Open Folio register, Tax Report, Trial Balance, Guest Trial Balance.

**Locks:**
- **Reads over the existing ledgers only:** `folio_line` (`ledger_amount_minor` in the ledger currency), `payment` / `payment_event`, `cashier_shift`, `invoice`, `folio_hold`, `city_ledger_entry`. **No new money calculation:** every figure is a sum of existing ledger amounts. Rounding never happens in a report.
- Permission is that of the data underneath. Print and CSV come from Part A.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Route `get_cashier_report`:** `GET /v1/properties/:propertyId/reports/cashier/:reportId`, permission `folio:read`, `pms.core`, FAIL_CLOSED, `resolvePropertyContext`. Reports that read cashier shifts **also** require the permission the shift screen's read uses (find it: the `get_shift…` route's permission). It is checked in the handler for those report ids, with 403 when missing. The catalogue shows a report only when the user holds all its permissions. |
| D2 | **Reports** (spans ≤ 31 days unless stated; row cap 2,000 from Part A):<br>1. **Cashier summary** (`from`/`to`): one row per shift opened in range: cashier (staff name from the member list as the shift screen shows it, else "Staff member"), opened and closed at, opening float, expected cash, counted cash, variance, and totals by tender (CARD, CASH, UPI). Use the existing shift-close figures (ledger currency, property business date, per AGENTS §2), not a recomputation.<br>2. **Cashier audit** (`from`/`to`, optional cashier and tender): every payment-side event in range in time order: capture, refund, void and authorize/void of card holds. Each row has time, business date, cashier, shift, tender, amount (ledger currency), reservation and guest, reference (UPI), and kind.<br>3. **Corrections and cancelled payments** (`from`/`to`): voided payments, refunds, `DISCOUNT` lines, invoice voids (with reason), and R4.29 undo-checkouts (from the audit log). Each row has kind, time, actor, reservation and guest, amount where money moved, and reason.<br>4. **Deposit activity** (`from`/`to`): advances received in range on stays that were `pending` or `confirmed` at the time of payment (pre-arrival), plus refunds of them. Rows have date, reservation, guest, arrival, tender and amount; there is a totals row.<br>5. **Deposit ledger** (`date`, default the business date): every `pending` or `confirmed` stay arriving **after** the date with a net advance > 0 (the Part A `netAdvancePaidMinor` rule). Rows have reservation, guest, arrival, departure and advance held. The total is the deposit liability.<br>6. **Detailed folio** (`reservationId`, picked through the existing reservation search): every line of every window of one stay. Rows have business date, window (in words), code label, description, charge, tax, payment and running balance per window, with window subtotals and the stay total. It matches the folio screen.<br>7. **Open-folio register** (`date`, default the business date): R4.23 holds active on that date. Rows have reservation, guest, room, departure, reason, follow-up, close-by, overdue flag and GUEST balance.<br>8. **Tax report** (`from`/`to`): per business date × tax code, net of reversals: taxable base (the parent lines' net amount) and tax amount, from the `tax_of` children. There is a totals row per tax code. The rows must sum to the tax lines on the folio for the same range.<br>9. **Trial balance** (`from`/`to`): one row per business date for the guest ledger (all GUEST and COMPANY windows): opening balance, charges, taxes, payments (net of refunds), discounts and adjustments, transfers to city ledger, and closing. **opening + movements = closing**, asserted on every row. A second section covers city-ledger AR (`city_ledger_entry`): opening, new receivables, settlements, closing.<br>10. **Guest trial balance** (`date`, default the business date): every window with a non-zero balance at the end of that date (in house, departed on an open folio, or with a balance left). Rows have reservation, guest, room, status (word), window and balance; the total equals the trial balance's closing for that date. |
| D3 | **Parameters:** Part A's registry gains a `reservation` parameter type (a reservation picker reusing the existing search) and optional `cashier` and `tender` filters with fixed option lists.<br>**SPA:** the catalogue's "Cashier and financial" group, the same runner, print and CSV. Detailed folio prints like a folio statement (property header, stay header). |

## 2. Tests

pms-core (`apps/pms-core/test/reports-cashier.spec.ts`), on a seeded property with:
- charges with tax;
- a cash, a UPI and a card payment;
- a refund and a void;
- a discount;
- a transfer to a COMPANY window and city-ledger AR;
- a pre-arrival advance;
- an open-folio hold;
- a voided invoice.

Tests:
1. Each report's rows and totals for that seed.
2. **Trial balance:** opening + movements = closing on every row, and the closing equals the sum of all window balances. Guest trial balance total = trial balance closing.
3. **Tax report:** the total equals the sum of tax lines on the folio for the range.
4. **Detailed folio:** the running balance and total equal the folio read's balance.
5. **Cashier summary** figures equal the shift-close read.
6. **Permissions:** without `folio:read` → 403. A shift report without the shift permission → 403. A report id from another group → 404.
7. **Tenancy:** two properties in one org; hotel A has no hotel B rows. No names in any response.

contracts: definitions are valid (spans, typed columns), and the route pin.

web-pms: the catalogue group gated by permission, the reservation picker parameter, the detailed folio print header, and CSV money formatting for negative amounts.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +1 → **247**, last id **`get_cashier_report`**.
- Catalog, audit writers and schema unchanged.
- Update the AGENTS.md pins table.

## 4. Out of scope

- A general ledger or accounting export (R4.12).
- POS and distribution reports.
- A GST return format (R5.5 and the advisor).
- Excel and PDF files.
