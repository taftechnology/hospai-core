# Operational reports, Part C: night audit and housekeeping (R4.14)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part C of three; completes R4.14 apart from POS and distribution, which come with R4.21 and R4.3)
**Roadmap:** R4.14 (Track P). Parts A (`40b94d8`) and B (`37119c5`) built the registry, runner, print and CSV: [Part A spec](./2026-11-20-reports-a-framework-front-office-design.md), [Part B spec](./2026-11-20-reports-b-cashier-financial-design.md).

**Sources:**
- The R1.10 [night audit operator job spec](./2026-10-30-night-audit-operator-job-design.md), which routes the revenue report, daily statistics and end-of-day control here. Their layouts were to come from the client's samples (Q8); none have arrived, so this part uses a standard layout. A layout from Q8 is a later edit to the definitions, not a new slice.
- The `SNAPSHOT_REPORTS` step writes `occupancy`, `revenue`, `cashier` and `manifest` objects to R2 per closed business date. The existing `get_night_audit_report` lists them.
- The housekeeping reads from R4.30, R4.11 A, B and C, and R4.31.

**Locks (from Part A):**
- Reads only; no new money calculation.
- Permission is that of the data underneath.
- Print and CSV.
- No trends or charts (§7.8).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Two routes** in the Part A pattern, appended in this order:<br>• `get_audit_report`: `GET …/reports/night-audit/:reportId`, permission `night_audit:run` (the permission of the existing night-audit report read);<br>• `get_housekeeping_report`: `GET …/reports/housekeeping/:reportId`, `housekeeping:read`.<br>Both are `pms.core`, FAIL_CLOSED and `resolvePropertyContext`. |
| D2 | **Night audit** (parameter: one closed business date, default the last closed date; a date with no completed audit → an empty state that says so):<br>1. **Night audit report:** the run for that date. Rows: steps with status, start and end times, and attempts; then the check outcomes from the R1.10 check log (check, outcome word, count); then the snapshots written, with their generation time and sha256.<br>2. **Night-audit revenue:** the `revenue` snapshot as stored, by charge category, with tax shown separately and totals. Figures are copied, not recomputed.<br>3. **Daily statistics:** from the `occupancy` and `revenue` snapshots:<br>  – rooms available (physical − blocked), rooms sold, complimentary and house use if the snapshot carries them, occupancy %;<br>  – room revenue, **ADR** (room revenue / rooms sold) and **RevPAR** (room revenue / rooms available);<br>  – arrivals, departures and in-house persons.<br>  ADR, RevPAR and occupancy are statistics derived from snapshot figures with one shared contracts helper (integer division, rounded half up to the minor unit or a whole percent). They are displayed, never posted. A division by zero shows "—".<br>4. **End-of-day control:** the date's control sheet:<br>  – business date closed and by whom, with the time;<br>  – checks that blocked or warned;<br>  – exceptions raised that night (by kind, count, open or resolved);<br>  – room charges posted (count and total from the night's `NIGHT_AUDIT` lines);<br>  – shifts force-closed;<br>  – no-shows processed;<br>  – the snapshot hashes.<br>  Everything is read from existing run, check, exception, folio and shift tables. |
| D3 | **Housekeeping** (spans ≤ 31 days):<br>1. **Room status:** now (no parameters): room, floor, type, housekeeping status, condition (the R4.27 rule), current block, in-house guest.<br>2. **Status-change history** (`from`/`to`, room optional): `room_status_history` rows.<br>3. **Blocks** (`from`/`to`): `room_ooo_event` rows (created, changed, released) with type, dates, times, reason and who.<br>4. **Attendant workload** (`from`/`to`): per attendant and date: tasks assigned, completed, reviewed, open, overdue, and rooms assigned (`housekeeping_assignment`).<br>5. **Inspection scores** (`from`/`to`, room, inspector): inspections with score and result, and an average score per inspector. The average is a display statistic with the shared helper.<br>6. **Guest audit** (`from`/`to`): sessions and their variance lines with reasons.<br>7. **Requests** (`from`/`to`, department, status).<br>8. **Lost and found register** (`from`/`to`, status): items with custody steps.<br>9. **Damage and missing cases** (`from`/`to`, status).<br>10. **Linen log** (`from`/`to`, item, kind).<br>11. **Minibar** (`from`/`to`): the R4.11 C reconciliation rows with totals.<br>12. **Amenity dispatches** (`from`/`to`, status): the dispatch ledger.<br>Each reuses the existing module read (`read-tasks`, `read-requests`, `read-lost-items`, `read-cases`, `guest-audit`, linen, minibar and amenities reads, `room_status_history` and `room_ooo_event` reads), through shared helpers and not copies. The same filters give the same rows as the tab lists. |
| D4 | **SPA:** the catalogue gains the "Night audit" group (gated by `night_audit:run`) and the "Housekeeping" group (gated by `housekeeping:read`). There is a closed-date parameter type, defaulting to the last closed business date. Guest and staff names follow Parts A and B. No other runner change. |

## 2. Tests

pms-core (`apps/pms-core/test/reports-night-audit-housekeeping.spec.ts`):
1. After a night-audit run on a seeded day, the four night-audit reports match the stored snapshots and run rows. Revenue totals equal the `revenue` snapshot. ADR and RevPAR use the shared helper (rounding half up; division by zero gives null). End-of-day room-charge totals equal the night's `NIGHT_AUDIT` folio lines.
2. A date with no completed audit → the empty state with no error.
3. Each housekeeping report equals its tab read for the same filters (one assertion per report).
4. Permissions: the night-audit route without `night_audit:run` → 403; the housekeeping route without `housekeeping:read` → 403; an id from another group → 404.
5. Tenancy: two properties in one org; hotel A has no hotel B rows. No names in any response.

contracts: definitions are valid, and the route pins.

web-pms: the two catalogue groups are gated, the closed-date parameter defaults, and "—" renders for undefined ratios.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +2 → **249**, last id **`get_housekeeping_report`**.
- Catalog, audit writers and schema unchanged.
- Update the AGENTS.md pins table.

## 4. Out of scope

- POS reports (R4.21) and distribution reports (R4.3).
- The Manager Report (R4.32).
- Report layouts from client samples (Q8; a later definition edit).
- Trends and charts.
- Excel and PDF files.
