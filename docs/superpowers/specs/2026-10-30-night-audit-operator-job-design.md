# Night audit operator job (R1.10)

**Status:** Accepted · 2026-10-31
**Roadmap:** R1.10 Night audit operator job
**Builds on:** [night audit e2e](./2026-08-12-night-audit-e2e-design.md) (steps, PRE_CHECK, halt, reports), [clock and room charges](./2026-09-05-night-audit-clock-room-charges-design.md), [domain config register](./2026-07-27-domain-config-register-design.md), R0.11 (night audit screen).
**Prototype:** `hospai-pms-prototype/src/components/NightAudit.tsx` — stepped flow.
**Source for "customisable":** the *Custom Night Audit* section of [BluePMS Front Office](https://www.bluepms.com/modules/front-office/), read 2026-10-30. This is marketing material, not verified in a live system, and the demo video has no chapter showing the configuration screen.

---

## 1. What the client ticked

The client ticked *Night audit (customisable)*, and every tick is a must-have. On BluePMS that means a list of checks the hotel configures:

| BluePMS | This slice |
|---|---|
| A configuration page with each check on or off | Settings, Night audit card (§4) |
| Fail, Warn or Info handling per check | One severity select per check, with Off (§4) |
| A preview before the business date closes | Checks stage (§6) |
| Close only after blockers are cleared | Fail stops PRE_CHECK (§5.3) |
| A log of past closes and validation results | Close-out stage (§5.5, §6) |
| Pre-close, post-roll and mandatory check groups | Pre-close checks only. The rest is sorted in §3 |
| Open folio auto-open and auto-close | Not here: **R4.23** (§3) |
| Revenue report, daily statistics, end-of-day control report | **R4.14** (§3) |

## 2. Decisions (locked)

1. **The eight steps do not change.** Checks run inside PRE_CHECK. `NIGHT_AUDIT_STEPS` keeps its length and order.
2. **One DOMAIN key:** `pms.night_audit.checks`, a map of check id to severity. PropertyDO reads it inside the transaction.
3. **Four severities:** `off`, `fail`, `warn`, `info`. BluePMS separates an on/off switch from severity; one select does both.
4. **Every configurable check defaults to `warn`.** Nothing that runs today starts blocking on upgrade. The client's own values go in through Settings, with no code change.
5. **The two existing checks stay fixed at Fail.** Queued commands and open exceptions protect the ledger, so no one can switch them off.
6. **One evaluator.** The preview and PRE_CHECK call the same function, so the screen cannot disagree with the audit.
7. **Fail has no override.** Clear the cause, or change the severity in Settings, which is audited, then Retry.
8. **Counts only.** Check results hold a check id and a count: no guest names, no money. The only close-out money stays the existing SNAPSHOT_REPORTS numbers; no prototype tax split.
9. **Settle is folded into Checks.** The prototype's flow is checks → settle → execute. Settle would repeat the same rows without balances, so each check row carries its own link and the stages are Checks → Run → Close-out.
10. **No printing here,** so the `DEGRADED` print rule stays satisfied.

## 3. Checks

**Fixed at Fail (already enforced by PRE_CHECK):**

| Id | Label | Source |
|---|---|---|
| `queued_commands` | Queued commands | `pendingOpenCount` census |
| `open_exceptions` | Open exceptions | `provisional_exception` for the date, unresolved |

**Configurable, first build.** `D` is the closing business date:

| Id | Label | Counts | Link |
|---|---|---|---|
| `arrivals_not_checked_in` | Arrivals not checked in | `status IN ('confirmed','pending')` and `arrival_date <= D` | Arrivals |
| `departures_not_checked_out` | Departures not checked out | `status = 'checked_in'` and `departure_date <= D`, so overstays count too | Departures |
| `cashier_shift_open` | Cashier shifts still open | `shift` with `business_date = D` and `status = 'OPEN'`, the same rows the Close cashier shifts step closes | Shift |
| `dirty_room_assigned` | Arrivals assigned a dirty room | The arrivals above with `room_id` set and `room.status = 'dirty'` | Housekeeping |
| `departed_with_balance` | Departed with a balance | `status = 'checked_out'`, `checked_out_business_date = D`, guest window `SUM(ledger_amount_minor) > 0` | Departures |

`departed_with_balance` catches checkouts taken with the balance override. It reads the guest window only (AGENTS §2). It is **not** BluePMS's open folio. Checkout moves neither `departure_date` nor any other date, so overstays and plain early checkouts would slip past a `departure_date` filter; v40 adds `checked_out_business_date` for this (§5.4). Stays checked out before v40 have it null and are not counted.

**BluePMS checks not in this build:**

| BluePMS check | Why not now | Where it lands |
|---|---|---|
| Open folios and open folio holds, auto-open, auto-close | HospAI has no bill-on-hold yet | R4.23, which adds the check |
| Arrival deposits | No rule yet says a deposit is required, so a count would be noise | R4.25, reading the R1.20 rule |
| ID proof completeness | Built by R4.15 as `id_proof_missing` (warn). Counts in-house stays with `id_document_on_file = 0`. | R4.15 |
| Country/state | Guest details live in OrgDO; PropertyDO cannot count them, and events carry no PII | R4.15 or R6.2 |
| Pseudo rooms | HospAI has no such concept | Dropped unless the client needs it |
| Weather and notes setup | No data, and unclear value | Ask the client (§8) |
| Room and tax posting (post-roll) | No post-roll phase, and steps cannot grow. A missing rate already raises an exception per reservation | Existing behaviour |
| POS charges, pending KOTs (post-roll) | No POS yet | R4.21, which already routes these through PRE_CHECK |
| Rate mismatch, guest charges (post-roll) | No definition in BluePMS's text | Ask the client (§8) |
| Comp postings, income audit, settlement activity, statistics, profile updates (mandatory) | No definition in BluePMS's text | Ask the client (§8) |
| Final reports, close business date (mandatory) | Already the SNAPSHOT_REPORTS and ROLL_BUSINESS_DATE steps | Existing behaviour |
| Tax document readiness | GST invoicing is not built | R5.5 |
| Transport, spa, banquet, inventory, purchase | Modules the client left unticked | Dropped |
| Revenue report, daily statistics, end-of-day control report | Reports | R4.14 |

A later check is one new id, one label and one query in the evaluator. No later slice needs a new key.

## 4. Settings

`packages/contracts` exports `NIGHT_AUDIT_CHECK_IDS` and `NIGHT_AUDIT_CHECK_SEVERITIES`.

Register entry: key `pms.night_audit.checks`, `prototypeKey: null`, class `DOMAIN`, `consumers: night` as `auto_extend` has, audited, permission `settings:configure`. Schema: a strict object with each check id optional, so a wrong id or severity is rejected by the existing `validateConfigWrite`. Default: every id `warn`. On read, a missing id takes the default, so adding a check later needs no data change.

The Settings **Night audit** card gets a table below the three existing controls: check, what it counts, and a `NativeSelect` (Off, Fail, Warn, Info) with a `VisuallyHidden` `Field` label naming the check. One Save writes the whole map through the existing `putDomainConfig`. The two fixed checks are listed as read-only rows that say **Fail** and "Always on", so the page shows the full list.

Plain hints, because these combinations are easy to get wrong:

- Any Fail: "Fail also stops the automatic night run. The business date will not roll until someone clears it and retries."
- `arrivals_not_checked_in` at Fail with auto no-show on: "Auto no-show runs after this check, so these guests must be checked in or marked no-show by hand first."
- `departures_not_checked_out` at Fail with auto extend on: the same point for auto extend.

These warn; they do not block the save. The combinations are valid.

## 5. Server

### 5.1 Evaluator
`evaluateNightAuditChecksSync(businessDate)` returns one row per configurable check: `{ checkId, severity, count }`. `off` rows skip their query and have `count: null`. Each query is bounded by date or status.

### 5.2 Preview
`readNightAuditStatus` adds `checks` for the current `businessDate`, from the evaluator. `get_night_audit` already returns `pendingOpenCount` and `closingExceptionCount`, which the SPA shows as the two fixed rows. No new route, and the existing `night_audit:run` permission covers it.

### 5.3 PRE_CHECK
Order inside PRE_CHECK:
1. Evaluate, including the two fixed rows.
2. Write the results in their own transaction, with no `await` before the step transaction. A failed step rolls back its transaction, and the log must keep the results that made it fail.
3. In the step transaction, decide from those same results. Keep today's order and codes: `PENDING_COMMANDS_UNDRAINED`, then `PROVISIONAL_EXCEPTIONS_OPEN`, then a new `NIGHT_AUDIT_CHECKS_FAILED` when any `fail` row has a count above 0.

`warn` and `info` never fail the step. A Fail takes the existing path: the run row goes `FAILED`, the audit is halted, and Retry re-evaluates with the current config. The alarm path needs no change because it calls the same `runAuditStep`.

### 5.4 Results table
Property migration **v40**:

```sql
CREATE TABLE night_audit_check_result (
  business_date TEXT    NOT NULL,
  attempt       INTEGER NOT NULL,
  check_id      TEXT    NOT NULL,
  severity      TEXT    NOT NULL,
  count         INTEGER NOT NULL,
  evaluated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, attempt, check_id)
)
```

`attempt` is the PRE_CHECK `night_audit_run.attempt`, so a date that failed and then passed shows both. `off` rows are not stored. The severity stored is the one applied at that moment, so a later Settings change cannot rewrite history.

The same migration runs `ALTER TABLE reservation ADD COLUMN checked_out_business_date TEXT`. `tryCheckOut` sets it to the current business date in the statement that sets `checked_out`. No inventory change: this is a date stamp only (AGENTS §2).

### 5.5 Log read
New route `get_night_audit_check_log`: `GET /v1/properties/:id/night-audit/check-log`, permission `night_audit:run`, entitlement `pms.core`, `resolvePropertyContext(..., ctx.tenantProperty)`, fail-closed on transport failure. It returns the 30 most recent audited dates, newest first. It takes no input, so there is no body, array or idempotency work. Read-only, so the kill-switch does not apply.

## 6. Night audit screen

Three stages on `/night-audit`, in local state with the `ui-tabs` look and no new kit component. Moving between stages is free; nothing is locked. Opens on Checks. Opens on Run when a step is running or failed, or the audit is halted.

**Checks.** The closing date, then one table: the two fixed rows, then the configurable rows.
- Columns: check, count, outcome, action link.
- Outcome as a `Badge` with the word always shown: **Clear** at 0, otherwise **Fail**, **Warn** or **Info**. **Off** rows show no count.
- A Settings link for anyone with `settings:configure`.
- A Refresh button, plus `refetchOnMount: 'always'`, so a clerk returning from Arrivals does not see a count up to 60 seconds old.
- When the business date is current, say the day is still open and the counts will change.

**Run.** **Run night audit** (moved out of `PageHeader`), the step table, Retry and Resume.
- Run is disabled, with the reason shown, when any Fail row or fixed row is above 0, alongside today's reasons. This follows AGENTS §4 on impossible actions. The server still enforces the rule on its own.
- Warn rows above 0 show an attention `Alert` naming them. They do not block.
- Halt moves from a `Badge` to an `Alert`: review the failed step, then Retry or Resume.
- Run, Retry and Resume results use `Alert`, with the success intent on success.
- Known step error codes map to operator copy, including the new one: "Fail checks stopped the audit. See Checks." Other step errors keep today's text.
- While a step is running, refetch every 5 seconds. No polling when idle.
- When the run ends, an `Alert` gives the new business date, or the step it stopped at.

**Close-out.** The existing Reports card, newest date first, and the check log: date, attempt, then the rows that were not clear, or "All clear". Empty, loading and error are three distinct states.

## 7. Fixes in this slice

**Step labels.** `apps/web-pms/src/copy/night-audit-step-labels.ts` does not match `NIGHT_AUDIT_STEPS`. `PROCESS_NO_SHOWS`, `CLOSE_CASHIER_SHIFTS`, `SNAPSHOT_REPORTS` and `ARCHIVE` have no label, so operators see raw ids; `AUTO_NO_SHOW`, `CLOSE_FOLIOS`, `SHIFT_RECONCILE` and `GENERATE_REPORTS` label steps that do not exist. Replace with exactly the eight real ids: Pre-check, Post room charges, Process no-shows, Auto transfer, Close cashier shifts, Snapshot reports, Roll business date, Archive. The test lists all eight literally, because web-pms cannot import the pms-core constant.

**Success styling.** `<Alert data-testid="night-audit-message">` defaults to the failure intent even for success messages (§6).

**Query keys.**
- `['night-audit', propertyId]` as today; Run, Retry and Resume invalidate it.
- New `['night-audit-check-log', propertyId]`, invalidated with it.
- Saving the checks in Settings invalidates `['night-audit', propertyId]`.
- When a run ends the business date has moved: invalidate the prefixes holding date-scoped desk data, checking the real keys (board, summary, housekeeping date queries). The ShiftStrip must not go stale.

## 8. Questions for the client

None of these blocks the build; the answers set values or add later checks.

1. In BluePMS's Night Audit Check Configuration, which checks do you have on, and which are set to Fail, Warn or Info?
2. Do you rely on any listed check that this build leaves out, especially arrival deposits, rate mismatch or weather/notes? ID proof completeness is now the `id_proof_missing` check from R4.15.
3. Do you use open folio holds? This decides whether the open folio slice comes before cut-over.

## 9. Out

New or reordered steps; a post-roll check phase; a Fail override; bill on hold; deposit rules; a bespoke audit schedule; aggregate balances; money before SNAPSHOT_REPORTS; the BluePMS night audit reports (R4.14); printing; tax theatre; a new overlay; mobile widths (desktop only).

## 10. Tests

**pms-core**
1. Each of the five queries counts the right rows and ignores wrong dates and statuses, including an overstay and the guest-window-only rule for `departed_with_balance`. An overstay and an early checkout with a balance both count on the date they actually checked out, not on another date.
2. Defaults: all `warn`, and a clean upgrade with no stored key runs the audit to completion while warnings exist.
3. A `fail` check above 0 fails PRE_CHECK with `NIGHT_AUDIT_CHECKS_FAILED`, halts, and leaves the date unrolled, on both the manual and the alarm path.
4. Clear the cause, Retry: passes and the audit completes. Change the severity to `warn`, Retry: also passes.
5. `off` skips the check and stores no row. `warn` and `info` never fail.
6. The fixed checks cannot be configured: their ids are rejected in the key, and their existing codes and order are unchanged.
7. Results survive the failed step's rollback; a fail-then-pass date has both attempts; the stored severity does not change after a later Settings save.
8. Preview and PRE_CHECK agree for the same data.
9. Wrong id or severity on the key is rejected. A stored map missing an id takes the default.
10. `get_night_audit_check_log`: permission, 30-date cap, newest first, a second property sees none of the first property's rows.

**web-pms**
11. All eight step ids render their label; no raw id appears.
12. Opens on Checks when idle; on Run when running, failed or halted.
13. Checks shows server counts and the word for each outcome, with no currency amount and no guest name.
14. Run is disabled with a reason for a Fail row or fixed row above 0, not for a Warn; a Warn shows the `Alert`.
15. Halt shows an `Alert` with Retry and Resume; the new error code shows operator copy.
16. Success results use the success intent; failures use classified copy.
17. Polls while running and stops when idle; Refresh and returning to the screen re-read.
18. Run, Retry and Resume invalidate both night audit keys; the end of a run invalidates the consumer keys in §7, asserted against those consumers.
19. Close-out has separate loading, error and empty states, and shows attempts and "All clear".
20. Settings: changing a select and saving writes the whole map; the fixed rows have no control; each hint appears for its combination; a user without `settings:configure` cannot save.

## 11. Pins

| Pin | Change |
|---|---|
| `PROPERTY_SCHEMA_HEAD` | 39 → **40** |
| `V1_HTTP_ROUTE_AUDIT` | 166 → **167**, last id **`get_night_audit_check_log`** |
| `COMMAND_CATALOG` | unchanged, 104 |
| `NIGHT_AUDIT_STEPS` | unchanged, length 8 |

Update the AGENTS table in the same commit.

## 12. AGENTS §6 checklist

- [x] Tenant: the check log is property-scoped and takes no ids in a body.
- [x] Authz: `night_audit:run` on reads, `settings:configure` on the key; read route needs no kill-switch decision.
- [x] No new command. New route in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency: the key goes through the existing config write; the new route is a read.
- [x] Arrays: none accepted. The log response is capped at 30 dates.
- [x] Money and inventory: counts only; no ledger writes; the capacity ledger is untouched.
- [x] Config: the new DOMAIN key is registered and read by pms-core inside the transaction, never from KV.
- [x] Errors: `{ ok: false, error }` and the existing status table.
- [x] Existing night audit specs read; no second design for steps or halt.
- [ ] SPA: keys include tenant and params; local invalidate; `classifiedUserMessage`; ui-kit; live `property.name` where the page names the hotel.
- [ ] Tests above; no `it.only`.
- [ ] Pins updated in the same commit.

## 13. As built (2026-10-31)

Changes from the sections above, all found in review or in the browser:

- **Retry and Resume send a new idempotency key per click.** The server stores a FAILED retry, so a fixed key replayed that failure after the cause was cleared and the audit could never pass. Characterized in pms-core test 4b.
- **A part-way run is its own state.** After a Retry passes, nothing is failed or halted and the later steps are still pending. Resume is the way to finish it, so Resume is enabled, Run is disabled with that reason, and the screen opens on Run.
- **Retry and Resume read the result.** Both return 200 with `status: 'FAILED'` when the step fails again; the screen shows that as a failure, not as success.
- **The end of a run is detected by what changed, not by `RUNNING` disappearing.** The Workflow has gaps between steps. A rolled business date ends the run; a newly FAILED step stops it. A started run polls through those gaps, capped at 10 minutes.
- **Close-out shows one report date at a time, newest first, with a date picker.** The demo hotel had 304 reports, which pushed the check log thousands of pixels down.
- **The subtitle no longer says "roll to".** It named the previous run's date. The step table now says which date it shows.
- **`checked_out_business_date` is stamped without blocking.** A missing business date stores null; it cannot fail a guest's checkout.
- **The desk invalidation uses `['board']` and also covers `front-desk-tape` and `front-desk-available`.**
- **Not exercised live:** a Fail run in the browser, because the local business date was current and cannot be moved from the UI. That path is covered by the pms-core specs on the manual and alarm paths, and by the screen tests with mocked statuses. The real overnight audit did run on this code with every check at Warn.
