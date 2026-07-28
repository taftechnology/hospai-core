# Night audit spine + horizon extension (Phase 0)

**Date:** 2026-07-27  
**Status:** Approved for implementation planning  
**Sources:** ARCHITECTURE.md §4.4, §5.1, §7.1, §8; [horizon follow-on](./2026-07-27-horizon-extension-followon.md); [pms.inventory](./2026-07-27-pms-inventory-design.md)

## Purpose

Prove the §8 alarm → Workflow → `runAuditStep` handoff and keep the availability ledger bookable: on each business-date roll, **set-reconcile** the horizon to `[business_date, business_date + (HORIZON_DAYS - 1)]` for every active room type. Multiplex DO alarms via `AlarmScheduler` (§4.4).

## Scope

**In**

- `@hospai/do-runtime` `AlarmScheduler` (named schedules, failure isolation, always re-`setAlarm`)
- PropertyDO: `__meta.business_date`; `runAuditStep`; `startNightAudit`; `rescheduleNightAudit`
- Cloudflare Workflow `NightAuditWorkflow` driving the §8 step sequence
- Real `ROLL_BUSINESS_DATE`: advance business date + horizon set-reconciliation
- Stub steps: `PRE_CHECK` (always pass — cites §4.6), money/ops stubs, `ARCHIVE` stub
- Horizon helpers: `enumerateFromDate(startDate, days)` (timezone-free); `enumerateHorizonDates` delegates
- Provisioning: set `__meta.business_date` in the **same transaction / same clock instant** as timezone + property_id
- Inventory `addRoomType`: seed horizon anchored to **`business_date`**, not `new Date()`
- `tryPutDomainConfig`: if `entry.consumers.reschedulesNightAudit`, call `rescheduleNightAudit`
- Tests: N rolls → max stay_date advances by N; HALTED blocks new run; AlarmScheduler always re-arms after throw; Berlin + Auckland

**Out**

- Real `POST_ROOM_CHARGES` / no-shows / cashier / reports / archival content
- Provisional-command queue drain (PRE_CHECK stays stub)
- LaneGuard, Queues outbox flush, HTTP night-audit UI (no route without unsafe-local gating)
- DOMAIN `pms.availability.horizon_days` (keep `HORIZON_DAYS = 365`)

## Invariants

1. **Horizon end = `business_date + (HORIZON_DAYS - 1)`.** Never a bare `363`. Prefer set-reconciliation over tail-append so off-by-one increments cannot silently shrink the bookable window.
2. **Horizon is always anchored to `__meta.business_date`**, not wall clock. `addRoomType` and catch-up both use that date.
3. **`enumerateFromDate` has no timezone parameter.** Once you have `YYYY-MM-DD`, stepping is pure calendar arithmetic. Instant → local date happens only at the boundary (`enumerateHorizonDates` / provision).
4. **Timezone explicit for ledger; `audit_time` may use register default `02:00`.** `audit_time` is interpreted in the property timezone. Missing timezone → fail closed for roll/horizon.
5. **AlarmScheduler never goes dark.** Per-schedule try/catch; record failure; always compute and `setAlarm` the next earliest due schedule.
6. **One business date advanced per successful run.** If still behind after roll, Workflow calls `rescheduleNightAudit()` so the DO re-arms **immediately** (not next calendar `audit_time`).
7. **`HALTED` blocks a new Workflow** for a later date until an operator clears the halt. Do not pile daily Workflows onto a stuck audit.
8. **Workflow resolves PropertyDO only via Platform D1 + `resolvePropertyFromRegistry`.** Never `idFromName` / jurisdiction args (§4.5).
9. **Active room types only** for horizon inserts. Archived types stay at `physical = 0` and must not regain stock.
10. **INSERT missing only** — never overwrite existing `sold` / `held` / `blocked` / `oversell` / `physical` on existing dates.
11. **`PRE_CHECK` is a stub**, not finished design — §8 rule 6 / §4.6 provisional queue drain+halt remains future work.

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

Required window for a property:

```ts
required = enumerateFromDate(businessDate, HORIZON_DAYS)
// insert any date in required missing from availability_day (per active room_type)
```

After N successful rolls from seed, `max(stay_date)` advances by exactly N.

## Business date + provision

At provision (same instant as timezone / property_id):

1. Derive local calendar date from that instant in the property timezone.
2. Raw-SQL set `__meta.business_date` if absent (first-write wins, like timezone).
3. Inventory seeding and all catch-up use this value.

`addRoomType` requires stored business date (else a wire code e.g. `business_date_unset`) and seeds `enumerateFromDate(businessDate, HORIZON_DAYS)`.

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
| `ROLL_BUSINESS_DATE` | Advance `__meta.business_date` by +1 calendar day; set-reconcile horizon; bump ARI if inserts; emit `availability.changed` if needed; emit night-audit event(s) as appropriate |
| `ARCHIVE` | No-op COMPLETED stub |

`runAuditStep(businessDate, step)`: if `night_audit_run` row already `COMPLETED`, return immediately. Else RUNNING → work → COMPLETED / FAILED. On FAILED after budget → property `HALTED` for that run.

Double-post unique index on `folio_line` already exists (freeze gate) — leave for when stubs become real.

## AlarmScheduler (`@hospai/do-runtime`)

- Table `alarm_schedule(name PK, next_run_at, last_error, …)`
- PropertyDO `alarm()` → `scheduler.run({ 'outbox'?: …, 'night-audit': () => start Workflow })`
- No direct `ctx.storage.setAlarm()` outside the scheduler
- After each alarm invocation: always set next alarm even if a handler threw

**`night-audit` schedule:** next `audit_time` in property TZ (default `02:00` if config unset).  
**`rescheduleNightAudit()`:** recompute next run — if `business_date` local calendar is behind “today” in property TZ, set `next_run_at = now`; else next `audit_time`. Invoked by Workflow after successful `ROLL_BUSINESS_DATE`, and by DOMAIN config puts when `consumers.reschedulesNightAudit` is true (matrix-driven — covers `audit_time` and `time_zone`).

## Workflow

`NightAuditWorkflow` (pms-core):

1. Resolve property via registry (`propertyId` param only).
2. If DO reports `HALTED` for an incomplete prior date → exit without starting a new date’s run (alert stub / log).
3. Determine target `businessDate` (current open date being audited).
4. For each step in order: `await stub.runAuditStep(businessDate, step)`; halt Workflow on FAILED.
5. After successful `ROLL_BUSINESS_DATE`: `await stub.rescheduleNightAudit()`.

Also: `PropertyDO.startNightAudit()` for tests / manual kick (no public HTTP without unsafe-local gating).

## Config consumer hook

In `tryPutDomainConfig` success path: if `getConfigEntry(key)?.consumers.reschedulesNightAudit`, call `rescheduleNightAudit()` (outside the mutation transaction is OK — new I/O gate; schedule write is not the ledger).

## Success tests

1. Provision sets business_date + timezone from one instant; add room type seeds from business_date (not wall clock).
2. `enumerateFromDate` / Auckland: date-string stepping never applies TZ conversion.
3. Catch-up set-reconcile fills gaps; idempotent re-run inserts nothing.
4. N rolls → max stay_date advances by exactly N; end = `business_date + (HORIZON_DAYS - 1)`.
5. Archived type never gains new rows / physical stays 0 on existing future dates.
6. AlarmScheduler: throwing schedule handler still leaves a future `setAlarm`.
7. HALTED prevents a second Workflow from advancing a new business date.
8. Workflow uses registry resolution only (lint / integration).
9. Changing `pms.night_audit.audit_time` via DOMAIN put triggers reschedule (matrix flag).
10. Stub PRE_CHECK completes; ROLL is the only step that mutates business_date / horizon.

## Follow-ons

- Real PRE_CHECK + provisional queue (§4.6)
- Real money/no-show/cashier/report/archive steps
- LaneGuard BACKGROUND lane annotation
- Operator HALTED UI / clear-halt command

## Non-goals reminder

This slice freezes the scheduling spine and horizon bookability, not a sellable night audit product.
