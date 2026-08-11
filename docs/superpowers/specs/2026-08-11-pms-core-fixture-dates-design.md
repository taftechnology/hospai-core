# pms-core fixture dates (property-local day 0)

**Date:** 2026-08-11  
**Status:** Accepted — plan next  
 
**Sources:** staff-management leftover #8; `dbca8f7` rooms fixture bump; `PropertyDO.tryAddRoomType` / `ensureBusinessDateIfAbsent`; `@hospai/pms-inventory` `businessDateForInstant` / `enumerateFromDate` / `enumerateHorizonDates`; `apps/pms-core/vitest.config.ts` (`singleWorker`, `isolatedStorage: false`, Workflows)

**Closes:** leftover #8 in [staff-management SPA](./2026-08-10-staff-management-spa-design.md) (notes rewritten — see §6).

---

## 1. Context & Motivation

Hardcoded `YYYY-MM-DD` stay/arrival literals in `apps/pms-core/test` look like a dated fuse. Investigation showed a different bug.

### What actually breaks

Test properties are provisioned with real IANA timezones (`UTC`, `Europe/Berlin`, `America/New_York`, …). Inventory seed starts at `__meta.business_date`, which is property-local **today** via the same derivation production uses:

- `ensureBusinessDateIfAbsent` → `enumerateHorizonDates(timeZone, instant, 1)[0]`
- `tryAddRoomType` → `enumerateFromDate(businessDate)` → `fromDate === businessDate`
- Edge path: `businessDateForInstant` in `invoke-property-do.ts`

Literals written as if “today” were the **machine’s** calendar disagree with that seed whenever machine-local date ≠ property-local date. On a PDT laptop after 17:00, UTC `business_date` is already the next calendar day; arrival `2026-08-10` (machine-local “today”) is **before** the seeded horizon → missing `availability_day` row → `unbookable` with that `date`.

CI runs `ubuntu-latest` with no `TZ` → **CI is UTC**. For the many UTC fixtures, machine-local *is* property-local on the runner, so the skew is invisible there. It surfaces on developer machines west of Greenwich, and would skew the **opposite** way for `Europe/Berlin` fixtures on a UTC runner if day 0 were ever derived from machine-local time.

### What `dbca8f7` did

Bumped rooms adversarial fixtures from `2026-08-10`… to `2026-08-20`…. That moved literals past the UTC/local boundary so evening PDT stopped failing. It did **not** fix derivation. Comments claiming “seed fromDate = property-local today+1” are **wrong**: the seed starts at `business_date` (= property-local today). Same-day booking on the business date works. The apparent “+1 clearance” was timezone skew misread as a product rule.

### Why not fake the clock (rejected)

**B — suite-wide `vi.setSystemTime`:** textbook for date-dependent suites, wrong substrate here. pms-core uses `@cloudflare/vitest-pool-workers` with `singleWorker: true`, `isolatedStorage: false`, and Workflows. Whether DO `Date.now()` inside workerd follows the test-context fake clock is not something to discover under deadline pressure. Shared D1/DO state across files means a jumping clock can corrupt `availability_day` horizons and alarm schedules into unrelated later failures. Clock infra is a separate slice, not this fuse/correctness fix.

Time faking in-repo today is only in plain-vitest suites (`entitlement-client`, `alarm-scheduler`).

### Why not change provision TZ (rejected)

**C —** force test properties onto machine-local TZ, or pin business date in fixture provision. Hides production TZ semantics; breaks intentional Berlin/NY coverage; still leaves hardcodes as fuses against real UTC days.

### Chosen approach

**A —** Derive load-bearing fixtures from property-local day 0. Prefer reading `business_date` / seed `fromDate` from a provisioned stub; otherwise a small test helper wrapping `businessDateForInstant`, parameterized by the fixture’s timezone. Selective edits from a backward-shift scan — not a blanket rewrite of all date occurrences.

---

## 2. Invariants

1. **Day 0 = property-local `business_date` = seed `fromDate`.** Not today+1. Not machine-local today.
2. **Timezone matters only for deriving day 0.** Once you hold a property-local calendar date as `YYYY-MM-DD`, stepping it is pure calendar arithmetic with no timezone involved. `Date.UTC(y, m-1, d±n)` on parsed parts (or `setUTCDate` on a `T00:00:00Z` held date) is safe; `new Date()` for “today” is not.
3. **Missing `availability_day` row → `unbookable`** (with offending `date`), not sold-out. Sold-out is a different code (`no_availability`).
4. **Arrival ≥ `business_date`** is the bookability clearance vs the seeded horizon (for nights that must have ledger rows). Shape-(2) module-level fixtures use offset ≥ +1 for a different reason (below).

---

## 3. Scan protocol

**Goal:** Enumerate fixtures whose relationship to property-local `business_date` is load-bearing, without faking the clock.

### Candidate set (expectation)

~80 is **occurrences**. There are **19 distinct** date literals in the suite; **8 are already behind** current `business_date` with the suite green — those cannot be fuses (a fuse fails as today advances past it). The real candidate set is the **~11 literals at or after `business_date`**. A classification table much larger than that means buckets are over-capturing.

### When to run

Prefer a window where **machine-local date ≠ UTC date** (evening PDT after 17:00). At midday PDT local and UTC agree and TZ-skew noise disappears. If that window is unavailable, the fixture-shift technique still finds horizon-relative fuses; a boundary-window run remains the best cross-check for machine-local vs property-TZ mistakes in the helper.

### Method (scratch only)

1. Clear `apps/pms-core/.wrangler` (persisted miniflare state; prior runs caused near-misdiagnoses).
2. Snapshot / worktree `apps/pms-core/test`. Do not commit the shifted tree.
3. Rewrite every `'YYYY-MM-DD'` / `"YYYY-MM-DD"` string literal **backward by N calendar days** using **UTC Y-M-D part arithmetic** (same discipline as `enumerateFromDate`), never local `Date`.
4. **N = 25** (furthest future literal observed ≈ `business_date + 22`; N=10 under-scopes September fixtures into a false “non-load-bearing” green).
5. Run the suite **sharded (4 shards)** — unsharded `pnpm --filter @hospai/pms-core test` segfaults workerd. Collect failures from **all four** shards; a dead shard must not be read as “those fixtures are fine.”
6. Clear `.wrangler` again after the scan.
7. Discard the scratch tree. Keep only the classification table.

Do **not** use `process.env` probes inside pool-workers tests for offsets — env does not reach the workerd isolate.

**Self-referential exclusion:** Skip files whose `YYYY-MM-DD` literals assert date arithmetic against pinned expectations (not stay fixtures). Shifting those moves expects while pinned instants (`'…T23:30:00.000Z'`) stay put → noise failures. Named exclusion set in the plan (`SHIFT_EXCLUDE`); start with `date-helpers.spec.ts`.

### Classification (by error, not pass/fail)

| Bucket | Signal | Action |
|---|---|---|
| **Horizon / seed** | `unbookable` with `date` before property `business_date` (or past horizon end) | **In scope** — derive that fixture |
| **Inventory pressure** | `no_availability` (sold out) | **Out of scope** |
| **Business-date gate** | `business_date_closed` / provisional closed | **Out of scope** unless the same site is also a stay/arrival for booking |
| **Assertion mismatch** | `expect(...)` pinned to a shifted literal that should track seed/today | **In scope** — rewrite expectation to derived value |
| **Unrelated** | Auth, schema, flaky DO state, etc. | Ignore for this fix |

Literals that stay green under −N are **non-load-bearing** and left alone.

### Scan output table

Header **must** record the **`business_date` the scan ran against** (reproducibility: 2pm vs 11pm PDT disagree by design).

Per in-scope row:

- file + site
- literal(s)
- bucket
- call shape: **(1)** preferred if stub exists, else **(2)**
- for shape **(2):** planned offset (**≥ 1**) and **the provisioning `timeZone` that call site must match** (review-checkable; grep cannot correlate stub args with helper calls)

That table is the edit list.

**An empty or tiny scan table is a valid outcome.** Rooms will almost certainly appear (at roughly `business_date + 9`, a −25 shift lands before the window). Whether any of the other ~10 future literals do is unknown. If rooms is the only horizon-bucket row, the slice reduces to helper + negative test + gate + that file — and that is **success**, not an under-powered scan. Do not widen buckets to justify the run; the scan exists to **bound** edits, not to produce them.

---

## 4. Helper API + call shapes

### Placement

`apps/pms-core/test/date-helpers.ts` — test-only. Depends on `@hospai/pms-inventory` (already a pms-core dependency). Shares production derivation: `businessDateForInstant` is what `invoke-property-do.ts` uses.

### API

```ts
import { businessDateForInstant, enumerateFromDate } from '@hospai/pms-inventory';

/** Property-local calendar date for `instant` — same derivation as PropertyDO business_date / seed fromDate. */
export function propertyToday(timeZone: string, instant: Date = new Date()): string {
  return businessDateForInstant(timeZone, instant);
}

/**
 * Calendar date `offsetDays` (>= 0) from property-local today.
 * Stepping uses enumerateFromDate (UTC Y-M-D), never local Date.
 *
 * For module-level fixtures (evaluated at import): use offsetDays >= 1.
 * That +1 is slack for a mid-run UTC rollover, not a property of the seed window —
 * the seed starts at business_date (offset 0).
 */
export function daysFromPropertyToday(
  offsetDays: number,
  timeZone: string,
  instant: Date = new Date(),
): string {
  if (!Number.isInteger(offsetDays) || offsetDays < 0) {
    throw new Error('daysFromPropertyToday: offsetDays must be a non-negative integer');
  }
  const today = propertyToday(timeZone, instant);
  if (offsetDays === 0) return today;
  return enumerateFromDate(today, offsetDays + 1)[offsetDays]!;
}

/** Step a held YYYY-MM-DD by `days` (may be negative). No timezone — input is already a calendar date. */
export function addCalendarDays(isoDate: string, days: number): string
```

`addCalendarDays` **mirrors `enumerateFromDate`'s parts arithmetic** (`Date.UTC(y, mo - 1, d + i)` on regex-parsed parts, then `getUTC*` formatting), negated when `days < 0` (single step at offset `days`). That function is already the reference implementation of invariant 2 and is unbounded (`days` is a plain count — no `HORIZON_DAYS` cap), so `daysFromPropertyToday` inherits no ceiling.

**No negative-offset on `daysFromPropertyToday`.** “Day before `business_date`” uses `addCalendarDays(day0, -1)` in the negative test. The throwaway scan rewriter is not this helper.

### Canonical calendar stepper

At least five test files already define local `addDays` via `setUTCDate` / `getUTCDate` + `toISOString().slice(0, 10)` on a held `YYYY-MM-DD`. Consolidating those copies is **out of scope**.

`date-helpers.ts` **does** export `addCalendarDays` (above) for **new** call sites and the negative test’s −1 step. Existing local `addDays` copies stay untouched. No third spelling in this slice — new code imports `addCalendarDays`; old copies remain file-private until a later cleanup.

### Call-shape rules

| Situation | Shape | Offset / TZ |
|---|---|---|
| Stub already provisioned / room type added | **(1)** `await stub.readBusinessDate()` or `added.fromDate`, then calendar step for departures | Offset 0 fine; **hard preference** — cannot disagree with the property |
| Module-level constants before any stub | **(2)** `daysFromPropertyToday(n, timeZone)` | `n >= 1`; `timeZone` **must** match that file’s provisioned property TZ (recorded in scan table) |

**Prefer shape (1) as a hard preference, not a tie-break.** Shape (2)’s `timeZone` argument is the only place a silent mismatch can exist (e.g. file provisions `Europe/Berlin` but constants call `daysFromPropertyToday(1, 'UTC')`). That passes grep, typecheck, and the Berlin negative test (different property) while still being wrong.

**Shape (2) slack wording** (must appear at the call site or on the helper — not only in this spec):

> `+1` is slack for a mid-run UTC rollover, not a property of the seed window — the seed starts at `business_date`.

Bare “keep arrivals after today+1 / seed fromDate” comments on touched lines are deleted or replaced.

Module-level constants are evaluated once at import; a suite that crosses UTC midnight can provision with `business_date` a day ahead of import-time day 0. Offset ≥ 1 absorbs that seconds-wide race. Shape (1) needs no slack — it reads after provision.

### Forbidden at day-0 derivation sites

Never derive “today” via `toLocaleDateString`, local `getDate` / `getMonth` / `getFullYear`, or `new Date().toISOString().slice(0, 10)` as a stand-in for property today. Always `businessDateForInstant` / `propertyToday` / stub reads.

---

## 5. Tests & gate

### 5.1 Before-window negative test (mandatory Berlin)

Cheapest DO book path (e.g. extend `reservations.spec.ts`):

1. Provision property with **`Europe/Berlin`** (mandatory — CI is UTC; a UTC-only version is green for both correct and machine-local helpers).
2. Add room type; `day0 = await stub.readBusinessDate()` (shape 1).
3. Book arrival = `addCalendarDays(day0, -1)` (not a negative API on `daysFromPropertyToday`).
4. Assert `ok === false`, `error === 'unbookable'` (or `UNBOOKABLE`), and `date ===` that pre-window day.

Optional second case `America/New_York` — nice, not required.

This guards the seed-boundary contract and TZ discipline. It does **not** assert shape-(2) +1 slack (import-time insurance, not a product rule).

### 5.2 Wrapper unit test (pms-core, not inventory package)

**Deliberate home:** `apps/pms-core/test/date-helpers.spec.ts` (dedicated file; `.spec.ts` to match the rest of `apps/pms-core/test/`). Adding a vitest file re-partitions `--shard` boundaries; with `isolatedStorage: false` that can surface latent order-dependence in **unrelated** specs. Prefer a clear home for the helper + the §8 re-partition note over burying tests inside an existing file to dodge the file-count change.

Import **`propertyToday` from `date-helpers.ts`**, not `businessDateForInstant` alone. Risk is replacing the wrapper body with `new Date().toISOString().slice(0, 10)`.

Pin one instant where UTC and Berlin disagree:

- Instant: `2026-08-10T23:30:00.000Z`
- `propertyToday('UTC', instant)` → `2026-08-10`
- `propertyToday('Europe/Berlin', instant)` → `2026-08-11`

Any machine-local implementation fails that assertion regardless of runner TZ.

Also cover `daysFromPropertyToday(0|1, 'UTC', fixedInstant)` against `enumerateFromDate` expectations; reject negative `offsetDays`; `addCalendarDays` ±1 against the same arithmetic.

### 5.3 Grep gate — `check:pms-core-test-dates`

**Include.** CI cannot see machine-local day-0 bugs on UTC fixtures; unit/negative tests cover the helper, not the next `getDate()` in a new file.

**Preventive only on today’s tree:** the three banned patterns have **zero hits** under `apps/pms-core/test/` (verified 2026-08-11). Adding the check needs no collateral edits; §8 “fix pre-existing hits” is a no-op unless someone lands a ban between now and implementation.

Scope: **`apps/pms-core/test/**` only.** Checked non-goal: web-pms tests contain zero clock-derived dates; `propertyLocalToday(timeZone, now = new Date())` already takes the zone explicitly — nothing to gate there. Documented so “why only pms-core?” is not an unexamined boundary.

**Forbidden patterns** (do not false-positive on held-date `addDays`):

| Ban | Notes |
|---|---|
| `toLocaleDateString` | machine-local calendar |
| `.getDate()` / `.getMonth()` / `.getFullYear()` | does **not** match `getUTCDate` / `getUTCMonth` / `getUTCFullYear` |
| `new Date().toISOString().slice(0, 10)` (flexible whitespace) | does **not** match `d.toISOString().slice(0, 10)` on a held variable |

**Ship only if the script stays tiny (~30 lines).** If pattern-crafting balloons, cut to review-enforced and say so in the plan — but the three patterns above should fit. Wire like existing root `check:*` scripts; allowlist by explicit exception list if a true false positive appears later.

**Residual risk the gate cannot see:** shape-(2) `timeZone` mismatch vs provision (see §4). Mitigations: hard prefer shape (1); scan table records required TZ per shape-(2) site.

---

## 6. Scope

### In scope

1. Scan (§3) → edit table.
2. `apps/pms-core/test/date-helpers.ts` + wrapper unit tests.
3. Selective fixture rewrites from the table only (prefer shape 1).
4. Comment / leftover #8 corrections on touched material.
5. Berlin before-window negative test.
6. `check:pms-core-test-dates` (+ CI wiring if other checks are wired the same way).
7. Update leftover #8 in `2026-08-10-staff-management-spa-design.md` to resolved with corrected notes (not “today+1 seed”).

### Out of scope / non-goals

- Suite-wide fake clock (**B**)
- Changing provision default TZ or pinning business date in production paths (**C**)
- Blanket rewrite of already-past literals or all ~80 occurrences
- Negative offsets on the helper
- Consolidating the ≥5 existing local `addDays` copies
- Gating web-pms (checked: no clock-derived fixture dates; SPA already zones `propertyLocalToday`)
- Fixing unrelated scan failures (bucket and ignore unless they block classification)

### Leftover #8 rewrite (staff-management spec)

Replace:

> Rooms fixture dates from inventory seed window — `dbca8f7` bumped literals to `2026-08-20` — dated fuse; derive from PropertyDO seed `fromDate` (today+1) instead

With resolution pointing at this design: derive from property-local `business_date` / seed `fromDate` via stub read or `businessDateForInstant`; `dbca8f7` was a TZ-skew workaround, not a seed off-by-one.

---

## 7. Acceptance

- Scan table (with `business_date` header) attached to plan appendix or PR; horizon/`unbookable` rows only; shape-(2) rows name required provision TZ. **Rooms-only (or empty beyond expected rooms) is success** — do not widen buckets.
- Scan-identified fixtures use shape (1) or (2); no bare “seed is today+1” comments on touched lines
- Berlin negative test: `unbookable` + `date`
- Wrapper unit test: UTC vs Berlin disagree on pinned instant
- `check:pms-core-test-dates` green (preventive; zero hits on current tree)
- Sharded pms-core suite green after `.wrangler` clear
- Full sweep green: typecheck, lint, and existing root `check:*` scripts including the new gate (new helper + new check script is exactly the shape that trips unrelated gates)
- Leftover #8 updated

---

## 8. Implementation order (for the plan)

1. Add `date-helpers.ts` + `date-helpers.spec.ts` (TDD the TZ-disagree case). **Shard re-partitioning:** adding a file moves vitest `--shard` boundaries; with `isolatedStorage: false`, an unrelated shard may go red from latent order-dependence. If a shard fails on a test this slice did not touch, suspect re-partitioning first — run that spec file alone before investigating the helper.
2. Add Berlin before-window negative test; prove it fails if day 0 is wrong, then passes.
3. Add `check:pms-core-test-dates` + CI wiring. Pre-existing hits are a verified no-op on today’s tree; only fix true day-0 ban hits if any appear.
4. Run scan (N=25, 4 shards, clear `.wrangler`); produce table. Tiny/rooms-only table is success.
5. Apply selective rewrites from table; fix comments; update leftover #8.
6. Full acceptance sweep.

No production DO/handler behavior changes are required for this slice — test correctness and guardrails only.
