# Availability horizon extension (follow-on)

**Date:** 2026-07-27  
**Status:** Boarded — blocks bookable product; implement with night-audit (or earlier if bookings land first)  
**Depends on:** `pms.inventory` horizon seed (done); night-audit `BusinessDate` rollover (§8)  
**Sources:** [pms.inventory design](./2026-07-27-pms-inventory-design.md) Follow-on; ARCHITECTURE.md §7.1, §8

## Why this is on the board now

`addRoomType` seeds **365 days** from creation. Updates never extend the ledger (inventory invariant 6). Missing `availability_day` row = **unbookable**.

That means bookability silently ends at the seed edge. The trigger is **not** “when the property turns one year old.” It is:

> **Before any booking path accepts stays ≥ ~300 days out**, or when the first group/corporate allotment product starts — whichever is sooner.

Group and corporate bookings hit that window much earlier than a year of calendar time. Put this work ahead of (or in lockstep with) the first reservation/book command that can sell far-out dates.

## Owner

**Night-audit business-date rollover** — on each successful day advance, for every **active** `room_type`, `INSERT` (or ignore-if-exists) `availability_day` for `business_date + (HORIZON_DAYS - 1)` with `physical = room_count`, other columns default 0; bump `__meta.ari_version` once per property if any row was written; emit one `availability.changed` range covering the new date(s).

Do **not** re-seed the full 365 on every audit. Extend by **+1 day** per rollover (steady state).

## Invariants to preserve

1. Same explicit timezone row as inventory (`timezone_unset` if absent — never register default).
2. Only **active** room types get extension; archived types stay at `physical = 0` and must not regain stock.
3. Never overwrite existing future rows’ `sold` / `held` / `blocked` / `oversell`.
4. Updates still must not INSERT dates — only this path (and initial add) may INSERT.
5. §10.1 if exposed as a command; if inline in night-audit DO work, same atomic gate as other ledger writes.

## Open decisions (resolve in implementation plan)

| Decision | Options | Lean |
|----------|---------|------|
| Catch-up after missed audits | Extend to `today + 364` in one BULK pass vs +1 per missed day | BULK catch-up once, then +1 steady |
| Horizon length | Keep constant 365 vs DOMAIN `pms.availability.horizon_days` | Constant until ops need it; promote with backfill plan |
| Who runs it if night audit is late | AlarmScheduler BULK sweep as backstop | Yes — belt for missed rollover |

## Success tests (sketch)

1. After N night-audit rollovers, max `stay_date` for an active type is `seed_end + N`.
2. Archived type: no new rows; future `physical` stays 0.
3. Existing row for the target date is left unchanged (idempotent extend).
4. Missing timezone → fail closed (no silent NY default).
5. Berlin (DST) and Auckland (+13) calendar correctness for the inserted date.

## Non-goals

- Virtual types, OOO, HTTP, Queues consumers (unless night audit already emits and a consumer exists).
- Changing timezone mid-horizon (separate command).

## Placement in Phase 0 / 1

| Before | After |
|--------|--------|
| Inventory room types + seed (done) | Horizon extension (this) |
| | First book / reservation path that sells ≥ ~300 days out |
| | Group / allotment products |

If reservations are scheduled before night audit, **pull this forward** as a standalone BULK command rather than waiting for §8.
