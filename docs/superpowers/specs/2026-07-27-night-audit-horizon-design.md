# Night audit spine + horizon extension (Phase 0)

**Date:** 2026-07-27  
**Status:** Approved for implementation planning  
**Sources:** ARCHITECTURE.md §4.4, §5.1, §7.1, §8; [horizon follow-on](./2026-07-27-horizon-extension-followon.md); [pms.inventory](./2026-07-27-pms-inventory-design.md); command catalog `night_audit.run`

## Purpose

Prove the §8 alarm → Workflow → `runAuditStep` handoff and keep the availability ledger bookable: on each business-date roll, **set-reconcile** the horizon to `[business_date, business_date + (HORIZON_DAYS - 1)]` for every active room type. Multiplex DO alarms via `AlarmScheduler` (§4.4).

## Scope

**In**

- `@hospai/do-runtime` `AlarmScheduler` (named schedules, failure isolation, always re-`setAlarm`)
- PropertyDO: `__meta.business_date`; `runAuditStep`; `startNightAudit`; `rescheduleNightAudit`; `isNightAuditHalted`
- Cloudflare Workflow `NightAuditWorkflow` driving the §8 step sequence
- Real `ROLL_BUSINESS_DATE`: refuse unless `business_date < today` (property TZ); advance + horizon set-reconciliation
- Stub steps: `PRE_CHECK` (always pass — cites §4.6), money/ops stubs, `ARCHIVE` stub
- Horizon helpers: `enumerateFromDate(startDate, days)` (timezone-free); `enumerateHorizonDates` delegates
- Provisioning: same clock instant for timezone + property_id + **business_date** + **register `night-audit` schedule and initial `setAlarm`**
- Inventory `addRoomType`: seed horizon from **`business_date`**; require business date set (`business_date_unset` if missing)
- Catch-up inserts use each active type’s **current `room_count`** as `physical`
- `tryPutDomainConfig`: if `consumers.reschedulesNightAudit`, write `alarm_schedule.next_run_at` **inside** the mutation transaction; `setAlarm` after commit
- Events: `night_audit.started`, `night_audit.completed` (catalog); `availability.changed` when horizon inserts occur
- Tests including `enumerateFromDate` under `TZ=UTC` and `TZ=Pacific/Auckland` (identical output)

**Out**

- Real `POST_ROOM_CHARGES` / no-shows / cashier / reports / archival content
- Provisional-command queue drain (PRE_CHECK stays stub)
- Clear-halt operator command / UI (derive HALTED now; clear is follow-on)
- LaneGuard, Queues outbox flush, HTTP night-audit UI (no route without unsafe-local gating)
- DOMAIN `pms.availability.horizon_days` (keep `HORIZON_DAYS = 365`)

## Invariants

1. **Horizon end = `business_date + (HORIZON_DAYS - 1)`.** Never a bare `363`. Set-reconcile the required date set — do not tail-append an increment.
2. **Horizon is always anchored to `__meta.business_date`**, not wall clock. `addRoomType` and catch-up both use that date.
3. **`enumerateFromDate` has no timezone parameter.** Once you have `YYYY-MM-DD`, stepping is pure calendar arithmetic. Instant → local date happens only at the boundary (`enumerateHorizonDates` / provision).
4. **Timezone explicit for ledger; `audit_time` may use register default `02:00`.** Interpreted in the property timezone. Missing timezone → fail closed for roll/horizon.
5. **`ROLL_BUSINESS_DATE` refuses unless `business_date < today`** in the property timezone. Prevents `startNightAudit` / a second Workflow from running the calendar into the future. Same comparison `rescheduleNightAudit` uses for “behind,” applied at the mutation point.
6. **AlarmScheduler never goes dark.** Per-schedule try/catch; record failure; always compute and `setAlarm` the next earliest due schedule.
7. **One business date advanced per successful run.** If still behind after roll, Workflow calls `rescheduleNightAudit()` so the DO re-arms **immediately** (not next calendar `audit_time`).
8. **`HALTED` is derived**, not a separate flag: any `night_audit_run` row with `status = 'FAILED'` for any `business_date` ⇒ halted. Workflow must not start a new date’s run while halted. Clear-halt is a follow-on (delete/repair FAILED rows).
9. **Workflow resolves PropertyDO only via Platform D1 + `resolvePropertyFromRegistry`.** Never `idFromName` / jurisdiction args (§4.5).
10. **Active room types only** for horizon inserts. Archived types stay at `physical = 0` and must not regain stock.
11. **INSERT missing only** with `physical = room_type.room_count` (current). Never overwrite existing `sold` / `held` / `blocked` / `oversell` / `physical` on existing dates. Do not copy previous day’s physical; do not insert `0`.
12. **`PRE_CHECK` is a stub**, not finished design — §8 rule 6 / §4.6 provisional queue drain+halt remains future work.
13. **Provisioning arms the first alarm.** Register `night-audit` schedule and `setAlarm` in the same provision path that sets `business_date` — otherwise the spine is inert until a manual kick.

## Horizon API (`@hospai/pms-inventory`)

```ts
/** Pure calendar step from a YYYY-MM-DD. No timezone. */
export function enumerateFromDate(startDate: string, days?: number): string[];

/** Derive local start date from instant + timeZone, then enumerateFromDate. */
export function enumerateHorizonDates(
  timeZone: string,
  fromInstant?: Date,
  days?: number,
): string[];
```

Required window:

```ts
required = enumerateFromDate(businessDate, HORIZON_DAYS)
// for each active room_type:
//   for each date in required with no availability_day row:
//     INSERT physical = room_type.room_count, other columns default 0
```

After N successful rolls from seed, `max(stay_date)` advances by exactly N.

Parse date strings in tests with explicit UTC forms (`YYYY-MM-DD` date-only or `…Z`) — never `new Date('YYYY-MM-DDTHH:mm:ss')` without Z (host-local parse).

## Business date + provision

At provision (same instant as timezone / property_id):

1. Derive local calendar date from that instant in the property timezone.
2. Raw-SQL set `__meta.business_date` if absent (first-write wins).
3. Register `night-audit` on `AlarmScheduler` and compute initial `next_run_at` (next `audit_time` in property TZ, default `02:00`); call `setAlarm`.
4. Inventory seeding and all catch-up use `__meta.business_date`.

`addRoomType` requires stored business date (wire code `business_date_unset`) and seeds `enumerateFromDate(businessDate, HORIZON_DAYS)`.

## Night audit steps

Order (§8):

```
PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → CLOSE_CASHIER_SHIFTS
  → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE → (idle)
```

| Step | This slice |
|------|------------|
| `PRE_CHECK` | Always COMPLETED (stub; §4.6 cite in code) |
| `POST_ROOM_CHARGES` … `SNAPSHOT_REPORTS` | No-op COMPLETED stubs |
| `ROLL_BUSINESS_DATE` | If `business_date >= today` (property TZ) → no-op success / refuse advance (still COMPLETED or return “not due” without advancing — prefer COMPLETED no-op so Workflow exits clean). If due: advance +1 day; set-reconcile horizon; bump ARI if inserts; emit `availability.changed` if inserts; emit `night_audit.completed` as appropriate |
| `ARCHIVE` | No-op COMPLETED stub |

Emit `night_audit.started` when a run begins (first step enters RUNNING for that `business_date`) and `night_audit.completed` when `ARCHIVE` (or final step) reaches COMPLETED — matching catalog `night_audit.run` events: `['night_audit.started', 'night_audit.completed']`.

`runAuditStep(businessDate, step)`: if row already `COMPLETED`, return immediately. Else RUNNING → work → COMPLETED / FAILED. FAILED rows make `isNightAuditHalted() === true`.

Double-post unique index on `folio_line` already exists (freeze gate) — leave for when stubs become real.

## AlarmScheduler (`@hospai/do-runtime`)

- Table `alarm_schedule(name PK, next_run_at, last_error, …)`
- PropertyDO `alarm()` → `scheduler.run({ 'night-audit': () => create Workflow, … })`
- No direct `ctx.storage.setAlarm()` outside the scheduler
- After each alarm invocation: always set next alarm even if a handler threw

**`night-audit` schedule:** next `audit_time` in property TZ (default `02:00`).  
**`rescheduleNightAudit()`:**  
- Sync SQL: update `alarm_schedule.next_run_at` — if `business_date < today` (property TZ), use `now`; else next `audit_time`.  
- Then async `setAlarm` from the table.  
Invoked by Workflow after successful roll, by provision (initial arm), and by DOMAIN config when `consumers.reschedulesNightAudit` (matrix-driven).

## Config consumer hook

On `tryPutDomainConfig` success, if `consumers.reschedulesNightAudit`:

1. Inside the **same** `transactionSync` as the config write (or a nested sync schedule write before commit): update `alarm_schedule.next_run_at`.
2. After the transaction commits: `await` / fire `setAlarm` from the scheduler.

If the process dies between (1) and (2), the table is correct and the next `alarm()` / cold start reconciles `setAlarm` from `alarm_schedule`.

## Workflow

`NightAuditWorkflow` (pms-core):

1. Resolve property via registry (`propertyId` param only).
2. If `isNightAuditHalted()` → exit without starting a new date’s run (log / alert stub).
3. Target `businessDate` = current `__meta.business_date` (the date being closed).
4. For each step in order: `await stub.runAuditStep(businessDate, step)`; on FAILED leave halted and exit.
5. After successful full run (including roll): `await stub.rescheduleNightAudit()`.

`PropertyDO.startNightAudit()` for tests / manual kick — safe because roll refuses when not behind. No public HTTP without unsafe-local gating.

## Success tests

1. Provision sets business_date + timezone from one instant, arms night-audit schedule; add room type seeds from business_date.
2. `enumerateFromDate` under `TZ=UTC` and `TZ=Pacific/Auckland` produces **identical** output for the same `startDate` / `days`.
3. Catch-up set-reconcile fills gaps with `physical = room_count`; idempotent re-run inserts nothing.
4. N due rolls → max stay_date advances by exactly N; end = `business_date + (HORIZON_DAYS - 1)`.
5. Third `startNightAudit` when already current does **not** advance business_date into the future.
6. Archived type never gains new rows.
7. AlarmScheduler: throwing schedule handler still leaves a future `setAlarm`.
8. A FAILED step ⇒ `isNightAuditHalted`; Workflow / start refuse a new date until cleared (clear is follow-on — test halt detection only).
9. Workflow uses registry resolution only.
10. Changing `pms.night_audit.audit_time` updates `alarm_schedule` in the config transaction and reschedules.
11. Stub PRE_CHECK completes; ROLL is the only step that mutates business_date / horizon; started/completed outbox events present.

## Follow-ons

- Real PRE_CHECK + provisional queue (§4.6)
- Real money/no-show/cashier/report/archive steps
- Clear-halt command + operator UI
- LaneGuard BACKGROUND lane annotation

## Non-goals reminder

This slice freezes the scheduling spine and horizon bookability, not a sellable night audit product.
