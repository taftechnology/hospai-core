# pms-core Fixture Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop pms-core stay/arrival fixtures from depending on machine-local calendar dates by deriving load-bearing dates from property-local `business_date` (same path as PropertyDO seed `fromDate`), plus a Berlin negative test and a preventive grep gate.

**Architecture:** Test-only `date-helpers.ts` wraps `businessDateForInstant` / `enumerateFromDate` from `@hospai/pms-inventory`. Prefer shape (1) stub reads after provision; shape (2) module-level helpers use offset ≥ 1 (UTC-rollover slack, not a seed rule). A −25 calendar-day fixture-shift scan (4 shards) bounds which literals to rewrite — a rooms-only table is success.

**Tech Stack:** TypeScript, Vitest / `@cloudflare/vitest-pool-workers`, `@hospai/pms-inventory`, Node check script wired like existing `check:*` gates.

**Spec:** [`docs/superpowers/specs/2026-08-11-pms-core-fixture-dates-design.md`](../specs/2026-08-11-pms-core-fixture-dates-design.md)

## Global Constraints

- **Day 0 = property-local `business_date` = seed `fromDate`** — not today+1, not machine-local today.
- **Timezone matters only for deriving day 0**; stepping a held `YYYY-MM-DD` is pure calendar arithmetic (`enumerateFromDate` / `addCalendarDays`).
- **No suite-wide `vi.setSystemTime`** (pool-workers + `isolatedStorage: false`).
- **Prefer shape (1)** `readBusinessDate` / `added.fromDate` whenever a stub exists; shape (2) only for module-level constants, with `timeZone` matching that file’s provision TZ.
- **Shape (2) offset ≥ 1** — slack for mid-run UTC rollover; wording must say so (not “seed is today+1”).
- **Negative test on `Europe/Berlin`** — assert `unbookable` + offending `date`.
- **Gate is preventive** — three bans have zero hits on today’s tree; no collateral required to land green.
- **Unsharded pms-core test segfaults** — always shard `1/4`–`4/4`; clear `apps/pms-core/.wrangler` around full-suite / scan runs.
- **Tiny/rooms-only scan table = success** — do not widen error buckets to manufacture edits.
- **Scan `SHIFT_EXCLUDE`** — skip self-referential arithmetic-assert files (at least `date-helpers.spec.ts`); extend the named set when adding more.
- **No production DO/handler changes** this slice.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Wrapper body → `new Date().toISOString().slice(0,10)` | `date-helpers.spec.ts` UTC vs Berlin pinned instant |
| Negative test on UTC property only | Spec / review — CI hides the bug; plan requires Berlin |
| Shape (2) `daysFromPropertyToday(1, 'UTC')` in a Berlin file | Scan table TZ column + review |
| Comment “seed is today+1” regenerated | Spec wording + rooms rewrite steps |
| Ban `.getUTCDate` as if it were `.getDate` | Gate must use `\.getDate\(\)` not UTC variants |
| Widen scan buckets when table is tiny | Spec §3 — rooms-only is success |
| Targeted verify filtered to zero tests (`-t` on wrong files) | Task 5 Step 5 — assert non-zero tests in each command’s output |

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/pms-core/test/date-helpers.ts` | `propertyToday`, `daysFromPropertyToday`, `addCalendarDays` |
| `apps/pms-core/test/date-helpers.spec.ts` | Wrapper unit tests (dedicated file — re-partitions shards; see Task 1 note) |
| `apps/pms-core/test/reservations.spec.ts` | Berlin before-window negative test |
| `scripts/pms-core-test-dates-check.mjs` | Grep gate |
| `package.json` | `check:pms-core-test-dates` script |
| `.github/workflows/ci.yml` | Run the new check in `checks` job |
| `apps/pms-core/test/rooms.spec.ts` | Expected shape-(2) rewrite (confirm via scan) |
| `apps/pms-core/test/rooms-routes.spec.ts` | Expected shape-(2) rewrite (confirm via scan) |
| `docs/superpowers/specs/2026-08-10-staff-management-spa-design.md` | Leftover #8 → resolved |
| Plan appendix | Scan table with `business_date` header |

---

### Task 1: `date-helpers` + wrapper unit tests

**Files:**
- Create: `apps/pms-core/test/date-helpers.ts`
- Create: `apps/pms-core/test/date-helpers.spec.ts`

**Interfaces:**
- Produces: `propertyToday(timeZone, instant?)`, `daysFromPropertyToday(offsetDays, timeZone, instant?)`, `addCalendarDays(isoDate, days)`
- Consumes: `businessDateForInstant`, `enumerateFromDate` from `@hospai/pms-inventory`

**Shard note:** Adding `date-helpers.spec.ts` re-partitions vitest `--shard` file boundaries. With `isolatedStorage: false`, an unrelated shard may later go red from latent order-dependence. If that happens, run the failing spec **alone** before investigating this helper.

- [ ] **Step 1: Write the failing wrapper tests**

```ts
// apps/pms-core/test/date-helpers.spec.ts
import { describe, expect, it } from 'vitest';
import { enumerateFromDate } from '@hospai/pms-inventory';
import { addCalendarDays, daysFromPropertyToday, propertyToday } from './date-helpers';

describe('date-helpers (property-local day 0)', () => {
  const instant = new Date('2026-08-10T23:30:00.000Z');

  it('propertyToday disagrees across UTC vs Europe/Berlin on a pinned instant', () => {
    expect(propertyToday('UTC', instant)).toBe('2026-08-10');
    expect(propertyToday('Europe/Berlin', instant)).toBe('2026-08-11');
  });

  it('daysFromPropertyToday(0|1) matches enumerateFromDate from propertyToday', () => {
    const today = propertyToday('UTC', instant);
    expect(daysFromPropertyToday(0, 'UTC', instant)).toBe(today);
    expect(daysFromPropertyToday(1, 'UTC', instant)).toBe(enumerateFromDate(today, 2)[1]);
  });

  it('daysFromPropertyToday rejects negative offsets', () => {
    expect(() => daysFromPropertyToday(-1, 'UTC', instant)).toThrow(/non-negative/);
  });

  it('addCalendarDays steps held YYYY-MM-DD without timezone', () => {
    expect(addCalendarDays('2026-08-11', -1)).toBe('2026-08-10');
    expect(addCalendarDays('2026-08-11', 1)).toBe('2026-08-12');
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/date-helpers.spec.ts
```

Expected: FAIL — cannot resolve `./date-helpers` or exports missing.

- [ ] **Step 3: Implement `date-helpers.ts`**

```ts
// apps/pms-core/test/date-helpers.ts
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

/**
 * Step a held YYYY-MM-DD by `days` (may be negative).
 * Mirrors enumerateFromDate parts arithmetic — no timezone; input is already a calendar date.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`invalid date: ${isoDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/date-helpers.spec.ts
```

Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/test/date-helpers.ts apps/pms-core/test/date-helpers.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): add property-local date helpers

EOF
)"
```

---

### Task 2: Berlin before-window negative test

**Files:**
- Modify: `apps/pms-core/test/reservations.spec.ts`

**Interfaces:**
- Consumes: `addCalendarDays` from `./date-helpers`
- Consumes: existing `provisionedPropertyWithGuest`, `addRoomType`, `tryCreateReservation`, `UNBOOKABLE`

- [ ] **Step 1: Add the failing-oriented test (assert exact unbookable shape)**

Insert near the existing unbookable gap test (`3. rejects unbookable gap in horizon`):

```ts
import { addCalendarDays } from './date-helpers';

it('rejects arrival before business_date as unbookable (Europe/Berlin)', async () => {
  const name = `res-before-window-${crypto.randomUUID()}`;
  const { stub, guestRef } = await provisionedPropertyWithGuest(name, 'Europe/Berlin', 'EUR');
  const added = await addRoomType(stub, 'rt_king', 5);
  const day0 = (await stub.readBusinessDate())!;
  expect(day0).toBe(added.fromDate);

  const before = addCalendarDays(day0, -1);
  const departure = addCalendarDays(before, 2);
  const input = {
    reservationId: 'res_before',
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: before,
    departureDate: departure,
  };
  const result = await stub.tryCreateReservation(
    TEST_OWNER_ACTOR,
    input,
    await idemFor('book-before', input),
  );
  expect(result).toEqual({ ok: false, error: UNBOOKABLE, date: before });
});
```

- [ ] **Step 2: Run the single test — expect PASS with correct helper/DO**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t 'before business_date'
```

Expected: PASS. (If RED with wrong `error`/`date`, stop and diagnose — do not weaken to `ok: false` only.)

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/test/reservations.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): assert unbookable for arrival before business_date

EOF
)"
```

---

### Task 3: Preventive grep gate

**Files:**
- Create: `scripts/pms-core-test-dates-check.mjs`
- Modify: `package.json` (add `check:pms-core-test-dates`)
- Modify: `.github/workflows/ci.yml` (run after other checks, before typecheck)

**Interfaces:**
- Produces: exit 0 when no banned day-0 patterns under `apps/pms-core/test/`
- Must **not** match `getUTCDate` / `d.toISOString().slice(0, 10)` on held dates

- [ ] **Step 1: Add the check script**

```js
#!/usr/bin/env node
/**
 * Ban machine-local / wall-clock day-0 derivation in pms-core tests.
 * Calendar stepping of a held YYYY-MM-DD (getUTCDate, d.toISOString().slice) is allowed.
 *
 *   node scripts/pms-core-test-dates-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(root, 'apps/pms-core/test');

/** @type {{ name: string, re: RegExp }[]} */
const BANS = [
  { name: 'toLocaleDateString', re: /toLocaleDateString\s*\(/ },
  { name: 'local getDate/getMonth/getFullYear', re: /\.get(?:Date|Month|FullYear)\s*\(/ },
  { name: 'new Date().toISOString().slice(0, 10)', re: /new\s+Date\s*\(\s*\)\s*\.toISOString\s*\(\s*\)\s*\.slice\s*\(\s*0\s*,\s*10\s*\)/ },
];

function walk(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(ent)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(testRoot)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ban of BANS) {
      if (ban.re.test(lines[i])) {
        hits.push(`${relative(root, file)}:${i + 1}: ${ban.name}`);
      }
    }
  }
}

if (hits.length) {
  console.error('pms-core test date gate failed:\n' + hits.map((h) => `  ${h}`).join('\n'));
  process.exit(1);
}
console.log('pms-core test date gate: ok');
```

- [ ] **Step 2: Wire package.json + CI**

In root `package.json` scripts, add:

```json
"check:pms-core-test-dates": "node scripts/pms-core-test-dates-check.mjs"
```

In `.github/workflows/ci.yml` `checks` job, after `check:web-pms-me-gating`:

```yaml
- run: pnpm check:pms-core-test-dates
```

- [ ] **Step 3: Run gate — expect PASS with zero hits**

```bash
pnpm check:pms-core-test-dates
```

Expected: `pms-core test date gate: ok` (verified no-op on 2026-08-11 tree; still required as preventive CI).

- [ ] **Step 4: Commit**

```bash
git add scripts/pms-core-test-dates-check.mjs package.json .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: gate machine-local day-0 derivation in pms-core tests

EOF
)"
```

---

### Task 4: Backward-shift scan (N=25)

**Files:**
- Scratch only (do not commit shifted tree)
- Update: this plan’s **Appendix A** with the classification table

**Interfaces:**
- Produces: appendix table header + rows (may be rooms-only)

- [ ] **Step 1: Record anchor + clear state**

```bash
# Record property-local UTC business_date (CI-equivalent anchor for UTC fixtures)
node -e "const {businessDateForInstant}=require('./modules/pms/inventory/dist/domain/horizon.js'); console.log('scan business_date UTC', businessDateForInstant('UTC', new Date())); console.log('scan business_date Berlin', businessDateForInstant('Europe/Berlin', new Date())); console.log('machine', new Date().toString());"
rm -rf apps/pms-core/.wrangler
```

If `dist` is missing, `pnpm --filter @hospai/pms-inventory build` first. Paste both dates into Appendix A header.

Prefer running when machine-local date ≠ UTC date; otherwise the −25 shift still finds horizon fuses.

- [ ] **Step 2: Scratch-shift literals by 25 days**

```bash
# Example: copy tests to /tmp, rewrite Y-M-D literals backward 25 days (UTC parts only),
# run suite against that copy OR temporarily patch apps/pms-core/test then revert.
# Do NOT commit. Do NOT use process.env probes inside workers tests.
```

**Self-referential exclusion list:** The shift regex matches bare quoted `YYYY-MM-DD` literals. That corrupts tests whose literals are **self-referential** — they assert date arithmetic against pinned expectations rather than using dates as stay/arrival fixtures. The pinned *instant* (`'2026-08-10T23:30:00.000Z'`) is not matched (quote not adjacent to the day), so expectations move and computed values do not → guaranteed noise failures.

Named exclusion set for this plan (extend when adding more arithmetic-assertion files):

```js
const SHIFT_EXCLUDE = new Set([
  'date-helpers.spec.ts', // self-referential: pinned Y-M-D expectations vs propertyToday / addCalendarDays
]);
```

Concrete approach (temporary in-tree, then `git checkout -- apps/pms-core/test`):

```bash
node <<'NODE'
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
const root = 'apps/pms-core/test';
const N = 25;
/** Tests with self-referential Y-M-D literals (arithmetic asserts), not stay fixtures. */
const SHIFT_EXCLUDE = new Set([
  'date-helpers.spec.ts',
]);
function walk(d, out=[]) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e) && !SHIFT_EXCLUDE.has(e) && !SHIFT_EXCLUDE.has(basename(p))) out.push(p);
  }
  return out;
}
function shift(iso) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d - N));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}
for (const f of walk(root)) {
  const src = readFileSync(f, 'utf8');
  const next = src.replace(/['"](\d{4}-\d{2}-\d{2})['"]/g, (all, iso) => all[0] + shift(iso) + all[0]);
  if (next !== src) writeFileSync(f, next);
}
console.log('shifted by', N, 'excluded', [...SHIFT_EXCLUDE].join(', '));
NODE
```

- [ ] **Step 3: Run all four shards; collect failures**

```bash
for s in 1 2 3 4; do
  pnpm --filter @hospai/pms-core exec vitest run --shard=$s/4 2>&1 | tee /tmp/pms-scan-shard-$s.log
done
```

Gather failures from **every** shard log. A dead shard ≠ “those fixtures are fine.”

Classify each failure by **error code** (`unbookable` / `no_availability` / `business_date_closed` / assertion mismatch / unrelated).

- [ ] **Step 4: Restore tree + clear wrangler**

```bash
git checkout -- apps/pms-core/test
rm -rf apps/pms-core/.wrangler
```

- [ ] **Step 5: Fill Appendix A**

Expected: **rooms** (and maybe rooms-routes) in horizon/`unbookable` bucket; other future literals may be absent. **Rooms-only is success.** Do not widen buckets.

For each in-scope row record shape (1) vs (2); for (2) record required provision `timeZone`.

- [ ] **Step 6: Commit appendix update only**

```bash
git add docs/superpowers/plans/2026-08-11-pms-core-fixture-dates.md
git commit -m "$(cat <<'EOF'
docs: record pms-core fixture-date scan table

EOF
)"
```

---

### Task 5: Apply scan rewrites + leftover #8

**Files:**
- Modify: sites from Appendix A (almost certainly `rooms.spec.ts` + `rooms-routes.spec.ts`)
- Modify: `docs/superpowers/specs/2026-08-10-staff-management-spa-design.md` leftover #8

**Interfaces:**
- Consumes: `daysFromPropertyToday`, `addCalendarDays`
- Shape (2) for rooms module-level `A` / `B_*` — both files provision **`UTC`**

- [ ] **Step 1: Rewrite rooms DO fixtures (if in appendix — expected)**

In `apps/pms-core/test/rooms.spec.ts`, replace the hardcoded block and wrong comment:

```ts
import { addCalendarDays, daysFromPropertyToday } from './date-helpers';

/** Half-open [arrival, departure) adversarial fixtures from the plan. */
// Module-level: +1 is slack for a mid-run UTC rollover, not a property of the seed window —
// the seed starts at business_date. FIXTURE_TZ must match provision TZ in this file (default UTC).
const FIXTURE_TZ = 'UTC';
const aArrival = daysFromPropertyToday(1, FIXTURE_TZ);
const A = { arrival: aArrival, departure: addCalendarDays(aArrival, 2) };
const B_overlap = { arrival: addCalendarDays(aArrival, 1), departure: addCalendarDays(aArrival, 3) };
const B_adjacent = { arrival: addCalendarDays(aArrival, 2), departure: addCalendarDays(aArrival, 4) };
```

`rooms.spec.ts` uses `provisionedPropertyStub(..., 'UTC', ...)` and `provisionedPropertyWithGuest(name)` (default `timeZone = 'UTC'`). `rooms-routes.spec.ts` posts `timeZone: 'UTC'`. If the scan appendix ever lists a different file, its provision TZ column wins.

- [ ] **Step 2: Rewrite rooms-routes the same way**

`rooms-routes.spec.ts` provisions `timeZone: 'UTC'` — use `'UTC'` for shape (2). Same `A` / `B_*` relative structure and slack comment. Remove the “today+1” seed comment.

- [ ] **Step 3: Apply any other appendix rows**

Prefer shape (1). For shape (2), copy TZ from appendix. Leave already-past literals alone.

- [ ] **Step 4: Update leftover #8**

In `docs/superpowers/specs/2026-08-10-staff-management-spa-design.md` leftovers table, replace item 8 notes with resolved text pointing at `2026-08-11-pms-core-fixture-dates-design.md`: derive from property-local `business_date` / seed `fromDate`; `dbca8f7` was a TZ-skew workaround, not a seed off-by-one.

- [ ] **Step 5: Targeted verify (two commands — do not combine with `-t`)**

`-t` filters across **all** listed files. The Berlin negative test lives only in `reservations.spec.ts`; combining it with rooms/helpers via one `-t` matches **zero** tests and reports success. Run separately and confirm each reports a **non-zero** test count:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/rooms.spec.ts test/rooms-routes.spec.ts test/date-helpers.spec.ts
# Expect: Tests  N passed (N > 0) — rooms + helpers actually ran

pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts -t 'before business_date'
# Expect: Tests  1 passed (or N > 0 matching the filter) — not "0 tests"
```

(Adjust the first file list if appendix added more rewrite targets.)

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/test/rooms.spec.ts apps/pms-core/test/rooms-routes.spec.ts docs/superpowers/specs/2026-08-10-staff-management-spa-design.md
# plus any other appendix files
git commit -m "$(cat <<'EOF'
fix(pms-core): derive load-bearing fixture dates from property-local day 0

EOF
)"
```

---

### Task 6: Full acceptance sweep

**Files:** none expected (verification only)

- [ ] **Step 1: Clear wrangler + sharded suite**

```bash
rm -rf apps/pms-core/.wrangler
for s in 1 2 3 4; do pnpm --filter @hospai/pms-core exec vitest run --shard=$s/4; done
```

Expected: all shards PASS. If an **untouched** file fails, suspect Task 1 shard re-partitioning — run that file alone before blaming the helper.

- [ ] **Step 2: Full check / type / lint sweep**

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 3: Final commit only if sweep forced fixes**

Otherwise done — no empty commit.

---

## Appendix A — Scan classification table

**Scan `business_date` (UTC):** `2026-08-11`  
**Scan `business_date` (Europe/Berlin):** `2026-08-11`  
**Machine local at scan:** `Tue Aug 11 2026 00:40:06 GMT-0700 (Pacific Daylight Time)`  
**N:** 25  
**SHIFT_EXCLUDE:** `date-helpers.spec.ts`  
**Shards:** 1–4 collected (shard 3 green)

| File | Site / literals | Bucket | Shape | Offset | Provision TZ (shape 2) |
|------|-----------------|--------|-------|--------|-------------------------|
| `rooms.spec.ts` | `A` / `B_overlap` / `B_adjacent` (`2026-08-20`…`2026-08-24`) — 6 booking tests → `ok: false` after −25 | Horizon / seed (`unbookable` via missing ledger) | 2 | ≥ 1 | `UTC` |
| `rooms-routes.spec.ts` | same `A` / `B_*` — postReservation → 422 not 201 | Horizon / seed | 2 | ≥ 1 | `UTC` |

**Ignored (not edit targets):**

| File | Why |
|------|-----|
| `availability-read.spec.ts` Test 4 | Scan artifact: URL dates live inside a template string (not matched by quoted-literal regex); expects shifted → Expected `2026-07-07` Received `2026-08-01`. Original literals are already-past query bounds, not fuses. |

_Rooms-only table is success — do not widen buckets._
