# Accounting export, Part A — the daily journal (R4.12)

**Date:** 2026-11-22
**Status:** Accepted for implementation (Part A only; see §9)
**Roadmap:** R4.12 (Track P). Pilot checklist: *Tally / Zoho export*.
**Sources:**
- Roadmap R4.12 locks: journal-ready summaries per business date and property, mapped to a tenant chart of accounts, **built from night-audit snapshots, never a live read across PropertyDOs** (§7.6), idempotent per business date, GST by component to configured ledgers, key `accounting_export.enabled`.
- [Manager Report](./2026-11-20-manager-report-design.md): `night_audit_day_stats`, written at night-audit close by `prepareDayStats` / `indexDayStatsSync`. This slice snapshots the journal at the same point.
- [Reports Part B](./2026-11-20-reports-b-cashier-financial-design.md): `loadLedger`, `movementColumn`, the trial balance, tax report and cashier summary. The journal must tie to them (§6).
- [Configurable tax engine](./2026-11-18-configurable-tax-engine-design.md): each tax rule posts its own output charge code, so CGST, SGST and IGST arrive as separate tax lines.

**Waits on client Q13** (how the hotel gets figures into Tally or Zoho today): the Tally voucher file and the Zoho Books import layout, Part B. Part A ships the journal, the ledger mapping and a plain CSV, which is useful by itself and is what Part B formats.

---

## 1. Why

The hotel's accounts team keys each day's revenue, GST and collections into Tally or Zoho by hand from reports. Nothing in HospAI produces a balanced day journal.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **One snapshot per business date, written at night-audit close** in the same transaction that writes `night_audit_day_stats`, from the same ledger. A re-export reads the stored rows, so it is the same journal every time. Late charges post to a later business date and never change a closed day. |
| D2 | **Net per account per day.** Each row is one HospAI account key with either a debit or a credit, never both. Integer minor units in the ledger currency. |
| D3 | **The day must balance.** Σ debits = Σ credits. A day that would not balance is still stored, flagged `balanced = 0`, and the export shows it with an `Alert`. Night audit is never blocked by the journal (AGENTS §2: per-row failure, the step continues). A thrown error in the journal builder is caught and logged; day stats and the audit go on. |
| D4 | **HospAI account keys, hotel ledger names.** The journal uses fixed keys (§3.2). The hotel maps each key to its own ledger name in Settings → Accounting. An unmapped key exports with an empty ledger name and is listed as unmapped. |
| D5 | **Core, gated at the route.** The snapshot is core night-audit data like day stats. The export route requires entitlement `accounting_export.enabled` (granted on every tier today). Kill-switch: the route is a read; the mapping save follows its existing config path. |
| D6 | **New permission `accounting:export`** (owner, admin; grantable). The journal is the hotel's books, not a desk report. Saving the mapping stays `settings:configure`. |
| D7 | **No backfill.** Dates closed before this ships have no journal; the export says so for each such date. |

## 3. Data model and accounts

### 3.1 PropertyDO migration (next head after R6.2; expected 58)

```sql
CREATE TABLE night_audit_journal_line (
  business_date TEXT NOT NULL,
  account_key   TEXT NOT NULL,
  debit_minor   INTEGER NOT NULL CHECK (debit_minor >= 0),
  credit_minor  INTEGER NOT NULL CHECK (credit_minor >= 0),
  CHECK (debit_minor = 0 OR credit_minor = 0),
  PRIMARY KEY (business_date, account_key)
);
CREATE TABLE night_audit_journal_day (
  business_date         TEXT PRIMARY KEY,
  currency              TEXT NOT NULL,
  advance_closing_minor INTEGER NOT NULL,   -- credit balance held as advances at close (§3.3), as a positive number
  balanced              INTEGER NOT NULL CHECK (balanced IN (0, 1)),
  recorded_at           INTEGER NOT NULL
);
```

No PII. A zero-net account writes no row. `check:ddl`, `scripts/property-ddl.mjs` and the purge inventory follow the existing pattern (these tables go with the property, like `night_audit_day_stats`).

### 3.2 Account keys

| Key | Side | From |
|---|---|---|
| `REVENUE:{chargeCode}` | credit (debit if net negative) | folio lines dated D in `movementColumn` *charges* or *adjustments*, net per charge code |
| `TAX:{chargeCode}` | credit | tax lines dated D, net per the tax line's charge code (one per GST component) |
| `TENDER:{CASH\|CARD\|UPI}` | debit (credit for net refunds) | payment lines dated D, by the payment's tender |
| `GUEST_LEDGER` | balancing | the guest-side counter-entry of every line above, less the advance reclass |
| `ADVANCE_DEPOSITS` | credit when advances grow, debit when they shrink | §3.3 |
| `CITY_LEDGER` | debit for receivables, credit for settlements | `city_ledger_entry` rows dated D |
| `CITY_LEDGER_RECEIPTS` | debit | `city_ledger_entry` payments dated D (the company's payment; the hotel maps it to its bank) |

Charge codes and tender values are module constants or come from stored rows; account keys match `^[A-Z_]+(:[A-Z0-9_]+)?$`.

### 3.3 Advances

The night audit for D runs at the end of D, so a reservation's status at that moment is its end-of-day status.
- `advance_closing(D)` = the sum of credit balances on GUEST windows of reservations that are `pending` or `confirmed` at close (use `windowBalanceMinorSync`; a debit balance counts 0).
- The day's reclass is `advance_closing(D) − advance_closing(previous stored day)`. A positive change credits `ADVANCE_DEPOSITS` and debits `GUEST_LEDGER`; a negative change does the reverse. With no previous stored day, the previous value is 0 (the accountant enters opening balances once).
- So a pre-arrival cash payment reads Dr `TENDER:CASH` / Cr `ADVANCE_DEPOSITS`, and on the check-in date the balance moves back into `GUEST_LEDGER`.

### 3.4 Company windows and the city ledger

**Find out, then encode, how a COMPANY window's balance leaves the folio when its receivable posts** (`city_ledger_entry` kind `charge`). Write a characterization test first.
- If a folio line closes the COMPANY window when the receivable posts, the journal needs no extra entry: the receivable is Dr `CITY_LEDGER` / Cr `GUEST_LEDGER` through that line.
- If no folio line does, the journal posts Dr `CITY_LEDGER` / Cr `GUEST_LEDGER` for each receivable dated D, and **the trial balance report double counts that amount**. Record that as a defect in the R4.12 roadmap entry and the audit doc; do not change the trial balance in this slice.
- State which case holds in an *Implementation notes* section of this spec.

## 4. Routes

| Route id | Method + path | Permission | Entitlement | Notes |
|---|---|---|---|---|
| `get_accounting_journal` | `GET /v1/properties/:pid/accounting/journal?from&to` | `accounting:export` | `accounting_export.enabled` | Range ≤ 31 days, else `422 limit_exceeded`. `{currency, days: [{businessDate, status: 'ok'\|'unbalanced'\|'not_recorded', lines: [{accountKey, ledgerName, debitMinor, creditMinor}], debitTotalMinor, creditTotalMinor}], unmappedKeys}`. Lines sorted by account key. Reads stored rows only. |

`V1_HTTP_ROUTE_AUDIT` +1; last id becomes `get_accounting_journal` unless another route sorts after it in the audit list (follow how the list is ordered). `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`, `dispatchV1` only.

**Mapping:** a new config key `accounting.ledger_map`, class `OPERATIONAL`, schema `{ ledgers: Array<{ accountKey, ledgerName: 1–100 chars, ledgerGroup?: ≤ 100 chars }> }`, at most 300 entries, unique `accountKey`. Saved through the same path that saves `pms.reports.manager_report`, read by pms-core in the export handler from PropertyDO config (never KV). No new command unless that path needs one.

## 5. Operator SPA

- **Accounting** page at `/accounting`, nav under Reports, gated on `accounting:export` and the entitlement, lazy-loaded. `PageHeader` "Accounting", subtitle the live `property.name`.
  - Date range (default the last closed business date), a `DataTable` per day: account key, ledger name, debit, credit, totals row. An `Alert` for an unbalanced day, a muted line for a day with no journal, and a warning listing unmapped keys with a link to Settings → Accounting.
  - **Download CSV**: one file for the range, built in the browser like the report CSVs (RFC 4180, formula-injection guard). Columns: `Date, Account key, Ledger, Group, Debit, Credit`, amounts in major units with two decimals. Dates in `YYYY-MM-DD` (a file for accounting software, not a screen).
- **Settings → Accounting**: one row per account key seen in the last 31 days' journals plus the fixed keys, with a ledger name and group field each. Save goes through the existing config mutation.
- Query keys `['accounting-journal', propertyId, from, to]` and the config key the settings screen already uses; the save invalidates both. Tests assert them.

## 6. Tests

pms-core, with real folio activity over two business dates and night audit run for each:
1. **Each day balances.**
2. **Ties to the reports:** Σ `TAX:*` credits = the tax report total for D; Σ `TENDER:*` = the cashier summary's payments for D; `GUEST_LEDGER` + `ADVANCE_DEPOSITS` movement = the trial balance guest-ledger movement for D (adjusted per §3.4 if the receivable case needs it, with that adjustment asserted explicitly); `CITY_LEDGER` movement = the trial balance city-ledger movement.
3. GST by component: a room night with CGST and SGST rules gives two `TAX:` rows.
4. Advances: a pre-arrival UPI payment on day 1 credits `ADVANCE_DEPOSITS`; check-in on day 2 moves it to `GUEST_LEDGER`; a cancelled stay with a retained penalty clears it.
5. A COMPANY receivable with a **non-zero** balance posts `CITY_LEDGER` (AGENTS §5), and its settlement posts `CITY_LEDGER_RECEIPTS` / `CITY_LEDGER`.
6. Idempotent: two exports of the same range are deep-equal; a charge posted after close lands on the next business date and leaves the closed day unchanged.
7. A journal builder that throws leaves the night audit and day stats intact.
8. Permission: a staff user without `accounting:export` gets 403; an org without the entitlement gets 402. Range over 31 days → 422.
9. Two properties in one org: A's export never includes B's lines.

web-pms: three states (data, no journal, error); unbalanced `Alert`; unmapped warning; CSV columns and the formula guard; cache keys.

## 7. Pins and docs

- Routes +1 (`V1_HTTP_ROUTE_AUDIT`), `PROPERTY_SCHEMA_HEAD` +1, permissions list +1 (`scripts/permissions-check.mjs` matches), CONFIG register +1 key. Commands unchanged unless §4 needs one.
- AGENTS.md pins table; roadmap R4.12 entry: "Part A done", Part B waits on Q13, Part C is payroll inputs.

## 8. Out of scope here

- **Part B (waits on Q13):** Tally voucher XML and the Zoho Books journal import layout, their ledger-name rules, and any per-voucher narration.
- **Part C:** payroll inputs (hours from roster and shift, tips, service charge, commissions) as a file. Not blocked; next after Part A.
- Outlet revenue from POS day-close (R4.21, deferred).
- Backfill of dates closed before this ships; a general ledger inside HospAI; QuickBooks / Xero (R4.19).

---

## 9. Implementation notes (2026-11-22)

What the code forced, and the calls made. D1 to D7 stand.

1. **§3.4: the second case holds.** `tryCloseFolioWindow`, check-out and the night-audit sweep post a `city_ledger_entry` (`charge`, later `adjustment` deltas) and **no folio line**. After the close, the COMPANY window keeps its folio balance (the spec test asserts the line count is unchanged and the window still holds 2000). The journal therefore posts Dr `CITY_LEDGER` / Cr `GUEST_LEDGER` for every receivable (`charge` and `adjustment`) dated D, and Dr `CITY_LEDGER_RECEIPTS` / Cr `CITY_LEDGER` for every `payment` dated D. The trial balance report counts that balance in both its Guest ledger and City ledger sections; this is recorded as an open defect in the R4.12 roadmap entry and the audit brief, and the report is unchanged. The tie test asserts the adjustment explicitly: trial balance guest movement = journal `GUEST_LEDGER` (debit less credit) minus `ADVANCE_DEPOSITS` (credit less debit) plus the day's receivables.
2. **The ledger-map key is DOMAIN, not OPERATIONAL (§4).** OPERATIONAL keys live in OrgDO and `config.put_operational` accepts named lists only, so they cannot be read from the PropertyDO or saved "the same way as `pms.reports.manager_report`". `accounting.ledger_map` is a DOMAIN key (`consumersExempt`, permission `settings:configure`, audited, reason required) saved by the existing `config.put_domain` command and read from `property_config` in the export handler. It joins the eslint DOMAIN key prefixes. **No new command**; `COMMAND_CATALOG` stays 151. The schema is as specified plus nothing else (`ledgerGroup` optional, at most 300 unique keys).
3. **Route list ordering.** `V1_HTTP_ROUTE_AUDIT` is append-ordered, not sorted, so `get_accounting_journal` is last (route 258). A degraded read is `FAIL_CLOSED`. The route declares the entitlement `accounting_export.enabled` and not `pms.core`, like `post_copilot_message`; the feature kill-switch for that entitlement returns 503 on the read.
4. **The guest ledger is computed from the folio, not as a plug.** `GUEST_LEDGER` is the sum of every folio line of the day (transfer legs included) plus the advance reclass minus the receivables moved to the city ledger. A day where transfer legs do not net to zero, or any other line has no account, is therefore stored with `balanced = 0` and shown with an `Alert`. If the guest ledger were the balancing figure, `balanced` could never be 0.
5. **Tender.** A payment line's tender is its payment's `tender_type`; a refund or chargeback line has no `payment_id`, so its tender is the one of the capture line it returns (`split_of`). Anything else is `TENDER:OTHER`. Amounts are the ledger sign, so a net refund day shows the tender as a credit. This differs from the day statistics, which put refunds under "other" (logged with the findings in the audit brief). Σ `TENDER:*` ties to the cashier summary on a day with no refund; with a refund it ties to the day statistics' payments in total.
6. **Dates.** A journal line has the same date the tax report and trial balance give it: `business_date`, else the property-local date of `created_at`, and a tax child sits on its parent's date (`loadLedger`, now exported from `cashier-report.ts` with `loadPayments`). Two consequences: a charge or payment posted for an earlier date after that date closed is on the folio and in the reports but **not** in the closed journal; and a city-ledger payment with an explicit past `businessDate` is likewise not in a closed day. This is D1 (a closed day never changes).
7. **Where it runs.** `prepareJournal` runs at the end of `snapshotReportsAsync`, right after `prepareDayStats`, and `indexJournalSync` writes inside the `SNAPSHOT_REPORTS` transaction right after `indexDayStatsSync`. Both catch and log, so a throw leaves the audit and the day statistics intact (`setJournalFailureForTest` for the test). The day row is written last, so a partial write reads as "not recorded". Rows are keyed by date; storing a date again replaces its lines. Advances are summed with `windowBalanceMinorSync` over the GUEST windows of `pending` and `confirmed` stays.
8. **Account key parts.** A charge code or tender becomes the second part of a key upper-cased with any character outside `A-Z0-9_` replaced by `_`, so every key matches `^[A-Z_]+(:[A-Z0-9_]+)?$`. Two codes that collapse to one key add into one row.
9. **Export response.** Beyond the spec's shape each line carries `ledgerGroup` (empty when none) for the CSV's Group column, and the body has `ok: true`. A bad date is `400 invalid_query`; `from` after `to` is `400 invalid_query` (`invalid_range`); more than 31 days is `422 {ok:false, error:'limit_exceeded', limit:'days', max:31}`. One bound alone is a single day; neither is the last closed date (the day before the open business date). A date with no stored day row is `not_recorded`.
10. **SPA.** The CSV includes unbalanced days (the screen warns about them) and leaves out dates with no journal. Settings → Accounting lists the fixed keys, the keys of the last 31 days (read with the accounting permission; without it only the fixed keys are listed, with a note) and any key already mapped. Saving invalidates `['domain-config', propertyId]` and the `['accounting-journal', propertyId]` prefix.
11. **Found on the way, not fixed here** (audit brief, "Open findings after the brief"): the trial balance double count above; `night_audit_day_stats.tax_minor` and the Manager Report tax row read 0 when tax child lines have no `business_date`; refunds fall in "other" in the day statistics.
