# Operational reports, Part A: framework and front-office reports (R4.14)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part A of three)
**Roadmap:** R4.14 Operational report set (Track P). Client Q10, answered 2026-11-19: **all the standard reports plus what BluePMS has.** POS and distribution reports land with R4.21 and R4.3, which are deferred. The catalogue builder stays out.
**The closed list (F3's one rewrite), from the [inventory comparison](../../research/2026-10-31-bluepms-inventory-vs-slices.md) §11 and the housekeeping row:**
- **Part A, front office:** arrivals, departures, in-house, forecast, availability detailed, availability month-wise.
- **Part B, cashier and financial:** cashier (shift close), cashier audit, corrections and cancelled payments, deposit activity and deposit ledger, detailed folio, open-folio register, tax report, trial balance, guest trial balance.
- **Part C, night audit and housekeeping:**
  - night audit: the night-audit report (snapshots), night-audit revenue, daily statistics, end-of-day control;
  - housekeeping: room status, status-change history, blocks, attendant workload, inspection scores, guest audit, requests, lost and found register, damage cases, linen log, minibar, amenities.
- Nothing outside this list without a new slice (§16.6 *Reports are not a backlog*).

**Locks:**
- Each report is a read over an existing ledger, a table or a night-audit snapshot. **There is no new money calculation.**
- Permission is the permission of the data underneath.
- Output is print (card-isolated print CSS) and CSV. Excel and PDF are not asked for.
- `/reports` stops redirecting to the Dashboard (R1.14).
- Forecast reads `availability_day` within the 90-night cap and never scans reservations for capacity.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **A report registry in contracts:** `REPORT_DEFINITIONS`. Each entry has:<br>• `id` (snake_case);<br>• group (`front_office \| cashier_financial \| night_audit \| housekeeping`);<br>• title and description;<br>• its **route group** (D2);<br>• a parameter schema (`date`, or `from` and `to` with a maximum span, plus optional named filters);<br>• typed columns (`text \| date \| integer \| money \| percent \| guest`, where `guest` carries a `guestRef` for the SPA to resolve).<br>Row cap **2,000** per run; over the cap → `422 limit_exceeded` with the cap in copy. The same definition drives the server parameter validation, the SPA form, the table, print and CSV. |
| D2 | **One report route per data group, each with that data's own permission:**<br>• `get_front_office_report`: `GET /v1/properties/:propertyId/reports/front-office/:reportId`, `reservations:read`;<br>• `get_cashier_report`: `…/reports/cashier/:reportId`, the permission the cashier and folio reads use (`folio:read`) — Part B;<br>• `get_housekeeping_report`: `…/reports/housekeeping/:reportId`, `housekeeping:read` — Part C;<br>• the night-audit reports use the existing `night_audit:run` read — Part C.<br>An id that does not belong to the route's group → 404. All are `pms.core`, FAIL_CLOSED, property-scoped through `resolvePropertyContext`. Part A adds **only** `get_front_office_report`. |
| D3 | **Response:** `{ reportId, generatedAt, businessDate, params, columns, rows, totals? }`.<br>• Money is integer minor units with the ledger currency.<br>• Dates are calendar strings.<br>• Guest cells carry `guestRef`, never names (AGENTS §1); the SPA resolves names through the property-scoped batch (chunked to 50) before display, print or CSV.<br>• Totals are summed on the server from the same rows. |
| D4 | **Part A reports (`front_office`):**<br>• **Arrivals** (`from`/`to` ≤ 31 days; optional status): confirmation, guest, arrival, departure, nights, adults/children, room type, room, rate plan, source, status, advance paid (net GUEST payments, the proforma rule).<br>• **Departures** (`from`/`to` ≤ 31 days): confirmation, guest, room, arrival, departure, status, GUEST balance (`windowBalanceMinorSync`), open-folio hold yes/no.<br>• **In-house** (`date`, default the business date): guest, room, room type, arrival, departure, adults/children, GUEST balance, company window yes/no.<br>• **Forecast** (`from`/`to` ≤ 90 nights): per date, summed over room types from `availability_day`: physical, blocked, sellable (physical − blocked), sold, free (`freeAvailability`), occupancy % (sold / sellable, whole percent half up), plus arrivals and departures **counts** for that date (list counts, not capacity). Totals row.<br>• **Availability detailed** (`from`/`to` ≤ 31 nights): per date × room type: physical, blocked, sold, free.<br>• **Availability month-wise** (`from`/`to` ≤ 90 nights): per calendar month × room type: room-nights physical, blocked, sold, free, occupancy %. |
| D5 | **SPA:**<br>• **`/reports`:** the catalogue, grouped (Front office, Cashier and financial, Night audit, Housekeeping), showing only the reports whose group permission the user has. Part A shows its six; the others appear as their parts land.<br>• **`/reports/:reportId`:** a parameter form built from the definition (business-date defaults, span limits shown), *Run*, then a `DataTable` with totals.<br>• *Print* prints only the report card (the `.report-card` print isolation, the same approach as `.reg-card`, with the property name, title, parameters and generation time).<br>• *Download CSV* is built in the browser from the shown rows with resolved names: RFC 4180 quoting; money as decimal major units with the currency code column; dates ISO.<br>• **Nav:** "Reports" in the sidebar, gated by having any report group permission.<br>• Error, empty and over-cap are distinct states.<br>• Query key `['report', propertyId, reportId, params]`, with `staleTime` 60 s and no polling. |

## 2. Tests

pms-core (`apps/pms-core/test/reports-front-office.spec.ts`):
1. Each of the six reports on a seeded property returns the expected rows and totals.
2. Forecast and availability rows equal `availability_day` and `freeAvailability` for the same dates; forecast occupancy rounds half up.
3. Departures balance equals the folio's GUEST balance; arrivals advance equals the proforma's `advancePaidMinor`.
4. Span over the limit → 422; an unknown report id or one from another group → 404; over the row cap → `limit_exceeded`.
5. Two properties in one org: hotel A's report has no hotel B rows. No row contains a name.
6. The route needs `reservations:read`.

contracts: registry shape (ids unique, every column typed, spans set), route pin.

web-pms:
- the catalogue is filtered by permission;
- the form defaults and limits;
- the table and totals;
- names resolved;
- CSV content (quoting, money format) built from rows;
- print isolates the card;
- three states;
- the cache key;
- `/reports` no longer redirects.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +1 → **246**, last id **`get_front_office_report`**.
- Catalog, audit writers and schema unchanged (147, 113, 55).
- Update the AGENTS.md pins table.

## 4. Out of scope

- Parts B and C reports.
- POS and distribution reports (R4.21, R4.3).
- A report builder or catalogue browser beyond the list.
- Excel and PDF files.
- Scheduled or emailed reports.
- Trends and warehouse (§7.8).
- The Manager Report (R4.32).
