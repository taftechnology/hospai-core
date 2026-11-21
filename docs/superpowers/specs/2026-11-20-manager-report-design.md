# Manager Report and MIS settings (R4.32)

**Date:** 2026-11-20
**Status:** Accepted for implementation
**Roadmap:** R4.32 (Track P). Client answer (2026-11-19): **a standard Manager Report**; it need not match the client's current one, so no sample is needed.
**BluePMS page group:** Front Office → *Manager reporting and MIS settings* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- a Manager Report with folio-backed totals and room statistics over a date range;
- section visibility;
- occupancy rules;
- source mapping;
- report rows with labels, decimals and order;
- a formula library with locked built-ins.

**Locks (roadmap):**
- **Data:** management totals come from **night-audit snapshots** (a closed-period OLTP report, §7.8). No live scan of folios or reservations, no fan-out across properties, and no new money calculation.
- **Output:** print and CSV as R4.14. Permission is that of the data underneath.
- **Settings:** each setting is a register key pms-core reads, or it is hidden.
- **Occupancy rules:** only for states HospAI has (no-show, out of order, checkout day).
- **Formula library:** a fixed registry the manager selects from, not an expression language.
- **Nationality:** open. It is not in this slice; it would need a non-PII stay code (see §4).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **A per-day statistics snapshot.** PropertyDO migration 56 adds `night_audit_day_stats`: one row per closed business date (PK `business_date`) with integer columns. The existing `SNAPSHOT_REPORTS` step writes it **in the same step** as the R2 objects, from the same figures plus the counts below. All of it is computed at close, which is when the audit already reads these tables.<br>• **Rooms:** physical, blocked (out of order), sold (room nights), no-show nights, complimentary 0 (HospAI has no comp state; the column is kept for the rule).<br>• **Movements:** arrivals (checked in that date), departures (checked out that date), no-shows, cancellations made that date.<br>• **Guests:** in-house adults and in-house children at close.<br>• **Revenue (ledger currency, net of reversals, from that date's folio lines):** room revenue, F&B, other charges, tax, and payments by tender (CARD, CASH, UPI) from the shift and folio ledger.<br>• **Mix:** room nights and room revenue **by source code** (R1.6), stored as a small JSON map `{ sourceCode: [nights, revenueMinor] }` with at most 50 codes.<br>The R2 snapshot objects are unchanged. Days closed before migration 56 have no row; the report counts and lists them as **not recorded**. The pilot has not started, so live days always have rows. |
| D2 | **MIS settings.** The DOMAIN key `pms.reports.manager_report` holds:<br>• `occupancy`: `{ excludeOutOfOrder: true, countNoShowAsSold: false }` (the only rules HospAI's states support; checkout day is never a night in HospAI and is listed as fixed);<br>• `rows`: an ordered list of `{ rowId, enabled, label ≤ 40, decimals 0–2 }` drawn from the built-in registry (D3), with all built-ins present;<br>• `sourceBuckets`: a map from R1.6 source code to a bucket label (≤ 12 buckets; unmapped codes fall into "Other");<br>• `fiscalYearStartMonth`: 1–12, default 4 (April, for India).<br>pms-core reads the key when it builds the report (no KV). Settings → Reports → **Manager Report** edits it with the reason-required pattern. Nothing is shown that pms-core does not read. |
| D3 | **Built-in row registry (the formula library),** in contracts, locked:<br>• rooms in hotel;<br>• out of order;<br>• rooms available (physical − blocked when `excludeOutOfOrder`, else physical);<br>• rooms sold (sold + no-show nights when `countNoShowAsSold`);<br>• occupancy % (sold / available);<br>• arrivals, departures, no-shows, cancellations;<br>• in-house adults and in-house children;<br>• room revenue;<br>• ADR (room revenue / sold);<br>• RevPAR (room revenue / available);<br>• F&B revenue, other revenue, total revenue (room + F&B + other), tax;<br>• payments by tender (one row each) and total payments;<br>• one row per source bucket (room nights and revenue).<br>Ratios use R4.14 C's shared `roundedRatio` (half up; zero denominator shows "—") and are **recomputed from summed components** for MTD and YTD, never averaged across days. The manager can enable or disable a row, relabel it, set its decimals (for ratios and percentages) and change its order, but cannot add a formula. |
| D4 | **The report:** `get_manager_report`, `GET /v1/properties/:propertyId/reports/manager?date=` (default the last closed business date). Permission `night_audit:run` (the snapshot data's permission), `pms.core`, FAIL_CLOSED, `resolvePropertyContext`.<br>Columns:<br>• **Day** (`date`);<br>• **Month to date** (the 1st of `date`'s month through `date`);<br>• **Year to date** (from the fiscal-year start through `date`).<br>Each column sums the `night_audit_day_stats` rows in range; one row per day maximum, so at most 366 rows are read from the DO table. The response lists the not-recorded dates in each range and returns rows in the configured order with labels. There is one DO read and no R2 reads. Hotel A cannot run hotel B. |
| D5 | **SPA:**<br>• **`/reports/manager`** in the R4.14 catalogue's Night audit group ("Manager Report"): a date parameter (closed-date default); a table of row label × Day / MTD / YTD with section headings (Rooms, Movements, Guests, Revenue, Payments, Source mix); a "Not recorded" note listing the missing dates; Print and CSV as R4.14.<br>• **Settings → Reports → Manager Report:** occupancy rules (two switches, checkout day shown as fixed text), row list (enable, label, decimals, move up and down), source buckets (each R1.6 source code mapped to a bucket label), and fiscal-year start month. |

## 2. Tests

pms-core (`apps/pms-core/test/manager-report.spec.ts`):
1. **Snapshot step:** after a night-audit run on a seeded day, the `night_audit_day_stats` row's room, revenue and tax figures equal the R2 `occupancy` and `revenue` snapshots for that date, and its payments equal the cashier snapshot.
2. **Day column** foots to that row; a two-day range sums both days (MTD over two closed days).
3. **Rules:** changing `countNoShowAsSold` changes rooms sold, occupancy % and ADR and nothing else; `excludeOutOfOrder` changes rooms available, occupancy % and RevPAR only.
4. **Rows:** disabling a row removes it; a relabel and reorder show up in the response; decimals apply to ratios.
5. **Source buckets** group codes, and unmapped codes go to "Other".
6. **Fiscal year:** YTD starts at the configured month.
7. A date with no row → listed as not recorded, with no error.
8. Two properties in one org: hotel A cannot run hotel B; a stranger gets 404. Without `night_audit:run` → 403.

contracts: the row registry (ids unique, every row has a section and a kind), the config schema, the pins.

do-runtime: migration 56.

web-pms:
- the report table and sections;
- the not-recorded note;
- print and CSV;
- the settings editor (rules, rows, buckets, FY month);
- the cache key `['manager-report', propertyId, date]`.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +1 → **250**, last id **`get_manager_report`**.
- `PROPERTY_SCHEMA_HEAD` **56**.
- Config +1 (`pms.reports.manager_report`).
- Catalog and audit writers unchanged; the snapshot write is inside the existing night-audit run.
- `NIGHT_AUDIT_STEPS` unchanged (the work stays in `SNAPSHOT_REPORTS`).
- Update the AGENTS.md pins table.

## 4. Out of scope

- **Nationality rows:** they would need a non-PII nationality code on the stay (as R1.6 does for source); never decrypt per row.
- Day-wise sale and expenditure (stores data).
- Trends and charts (warehouse).
- A report builder or expression language.
- Multi-property roll-up.
- Excel and PDF files.
- Backfilling days closed before migration 56.
