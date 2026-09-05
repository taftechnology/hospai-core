# Night audit clock + room charges (R0.7)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 7](../../audit/2026-09-04-full-codebase-audit.md) (**N1**, **L5**, **L7**, **L8**, **G3**, **P6**); [Night audit E2E](./2026-08-12-night-audit-e2e-design.md) (8-step machine, `runAuditStep` Txn A/B/C, halt semantics — **amends** §3.2 auto-no-show / ROOM predicate); [Folio charges / `POST_ROOM_CHARGES`](./2026-08-05-folio-charges-vertical-design.md) (test 17 fail-whole-hotel — **superseded**); [Night audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md) (per-reservation skip pattern in `runAutoExtendSync`); [AGENTS.md §2 hotel-wide loops](../../../AGENTS.md) (catch per row; two-pass TZ); `apps/pms-core/src/property-do.ts` (`zonedMidnightMs` ~1051, `zonedWallTimeToEpochMs` ~1544, `nextAuditRunAtMs` ~1553, `postRoomChargesSync` ~14964, `expirePendingAndInquirySync` ~3323, `processNoShowsSync` ~3443); `apps/pms-core/test/night-audit-room-charges.spec.ts` (case 17 ~115–136); `packages/contracts/src/config/register.ts` (`pms.night_audit.audit_time` default `02:00`, `auto_no_show` default `true`).

**Closes:** Audit **N1** (DST one-pass wall clock fires audit early), **L5** (one missing rate fails whole hotel), **L7** (`auto_no_show=false` still posts ROOM for confirmed-not-arrived), **L8** (pending expires on arrival while `confirmBy` future), **G3** (case 17 locks fail-whole-hotel), **P6** (`POST_ROOM_CHARGES` O(in-house) one txn abort). **Roadmap:** **R0.7**. **Requires:** night-audit E2E, folio charges, auto-extend, auto-transfer shipped. **Does not** advance R0.8 (Q11 catalog lane), R1.10 operator wizard, Playwright, PropertyDO extraction, or new HTTP/commands.

---

## Executive summary

Night audit’s 2 a.m. alarm uses `zonedWallTimeToEpochMs` — a **one-pass** offset guess — while midnight elsewhere uses the **two-pass** fixed point in `zonedMidnightMs`. On DST boundaries (especially default `audit_time = 02:00`), the alarm can fire an hour early (**N1**). `postRoomChargesSync` loops in-house stays inside one `transactionSync` with **no per-row catch**: a single `RateMissingError` aborts the hotel, marks `POST_ROOM_CHARGES` **FAILED**, and rolls back every sibling’s ROOM line (**L5**, **P6**). Case 17 **encodes that bug as expected** (**G3**). When `auto_no_show === false`, `processNoShowsSync` skips the no-show loop but `postRoomChargesSync` still selects `confirmed` arrivals — ROOM posts for guests the property chose not to no-show (**L7**). `expirePendingAndInquirySync` expires pending when `arrival_date <= businessDate` **even if** `confirm_by` is still in the future (**L8**).

This spec locks **pms-core-only** fixes: unify wall-clock conversion on the two-pass helper (delete the one-pass helper); catch `RateMissingError` per reservation and record step exceptions in `audit_log` while the step **COMPLETED**; tighten `POST_ROOM_CHARGES` selection when `auto_no_show` is false; fix pending expiry to honour `confirm_by`. Characterization tests land **first** and must **fail on current `main`**. No schema migration, no catalog/route pin changes, no SPA unless already editing `NightAuditScreen.tsx` (U4 is Vertical 11).

---

## Locked product call

1. **N1 — one wall-clock helper, two-pass fixed point.** Replace `zonedWallTimeToEpochMs` with the same algorithm as `zonedMidnightMs` (generalized for arbitrary `HH:MM`). **Delete** `zonedWallTimeToEpochMs` and `timeZoneOffsetMs` (only consumer). Spring-forward **gap** at requested wall time → **next real instant**; fall-back **overlap** → **first** occurrence. Default audit time stays `02:00`.
2. **L5 / P6 — hotel-wide loop catches per reservation.** `postRoomChargesSync` catches `RateMissingError` **per row**; one missing rate must not abort sibling ROOM posts. Hoist `assertChargeCodeSync('ROOM', …)` **before** the loop. Non-`RateMissingError` throws still fail the step (Txn B rollback). Step returns **COMPLETED** when only row-level rate misses occur.
3. **Row failures → step exceptions (audit_log, not halt).** Each skipped reservation appends an `audit_log` row (`commandId: 'night_audit.run'`, `entityType: 'reservation'`, `afterJson.reason = rate_missing`). **Do not** insert `provisional_exception` — closing-date open exceptions block `PRE_CHECK`; rate misses must **not** halt the roll.
4. **G3 — rewrite case 17 in this vertical.** Mixed hotel: missing-rate stay skipped + sibling posted; step **COMPLETED**; `ROLL_BUSINESS_DATE` still **COMPLETED**. Tests red on `main` before production.
5. **L7 — `auto_no_show === false` → no ROOM for confirmed-not-arrived.** When config is false, `postRoomChargesSync` posts ROOM only for `checked_in` stays covering the night. `confirmed` with `arrival_date <= businessDate` (never checked in) is **excluded** even though `PROCESS_NO_SHOWS` also skips no-show. When config is **true** (default), predicate unchanged: `confirmed` + `checked_in`.
6. **L8 — pending expires on `confirm_by`, else null+arrival.** Pending expiry: `(confirm_by IS NOT NULL AND confirm_by <= nowMs) OR (confirm_by IS NULL AND arrival_date <= businessDate)`. Never expire solely because `arrival_date <= businessDate` while `confirm_by` is still future.
7. **Tests first (G3).** Rewrite case 17 + add DST table + L7/L8 cases; must fail on `main`, then production.
8. **Pins frozen.** No new commands, routes, or `PROPERTY_SCHEMA_HEAD` bump.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Wall-clock helper** | Single exported/private `zonedWallClockMs(dateStr, timeZone, hh, mm)` — two-pass core shared with midnight (`hh=0,mm=0`). Delete `zonedWallTimeToEpochMs` + `timeZoneOffsetMs`. |
| **DST gap** | Requested local `HH:MM` absent on `dateStr` (spring forward) → epoch of **next** local instant with that calendar date where local hour/minute equals requested (typically +1 h for US zones at 02:00). |
| **DST overlap** | Requested local `HH:MM` occurs twice (fall back) → **first** occurrence (earlier UTC instant). |
| **Alarm wiring** | `nextAuditRunAtMs`, `ensureNightAuditSchedule`, `rescheduleNightAuditAlarmSync` call `zonedWallClockMs` only. |
| **Per-row catch** | `RateMissingError` → log exception, `continue`. Any other throw → propagate (step **FAILED**). |
| **`assertChargeCodeSync`** | Once before loop; not per reservation. |
| **Step status on rate misses** | **COMPLETED** (not FAILED). `night_audit_run.error` **NULL** on success path. |
| **Exception record** | `appendAuditLogSync` per failed reservation; **no** `provisional_exception`. |
| **`auto_no_show` false ROOM** | SQL excludes `status = 'confirmed'` from `POST_ROOM_CHARGES`; `checked_in` unchanged. |
| **`auto_no_show` true ROOM** | Keep `status IN ('confirmed', 'checked_in')` + existing date/`no_post` predicates. |
| **Pending expiry SQL** | Remove bare `confirm_by <= now OR arrival <= businessDate` OR-branch; use confirm_by-first rule (§2.4). |
| **Case 17** | Rewrite in **this** PR; do not skip ahead of production. |
| **Case 19** | Unchanged — simulated non-domain throw after one post still **FAILED** + zero lines (whole-step abort). |
| **Q11 catalog lane** | **Out of scope** (R0.8). Mention only: `night_audit.run` BACKGROUND vs `touchInteractive()` unchanged this vertical. |
| **U4 NightAuditScreen** | **Out of scope** unless implementer already touches that file (Vertical 11). |

---

## 1. Problem / evidence

### 1.1 N1 — DST wall-clock one-pass (`zonedWallTimeToEpochMs`)

**Midnight uses two-pass fixed point:**

```1051:1071:apps/pms-core/src/property-do.ts
function zonedMidnightMs(ymd: string, timeZone: string): number {
  const [ys, ms, ds] = ymd.split('-');
  const utcGuess = Date.UTC(Number(ys), Number(ms) - 1, Number(ds), 0, 0, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const asUtcFromZoned = (instant: number): number => {
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };
  const guess = utcGuess - (asUtcFromZoned(utcGuess) - utcGuess);
  return utcGuess - (asUtcFromZoned(guess) - guess);
}
```

**Audit alarm uses one-pass offset at requested wall time:**

```1544:1559:apps/pms-core/src/property-do.ts
function zonedWallTimeToEpochMs(timeZone: string, dateStr: string, hh: number, mm: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const asUtcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0);
  const offset = timeZoneOffsetMs(timeZone, asUtcGuess);
  return asUtcGuess - offset;
}

function nextAuditRunAtMs(timeZone: string, auditTime: string, instant: Date): number {
  const [hh, mm] = auditTime.split(':').map(Number);
  const today = enumerateHorizonDates(timeZone, instant, 1)[0]!;
  const candidate = zonedWallTimeToEpochMs(timeZone, today, hh!, mm!);
  // ...
}
```

Default `pms.night_audit.audit_time` is **`02:00`** — the worst wall clock for US/EU DST transitions. Audit reproduced Pacific/Chatham firing at **01:00** local on 2026-09-27. **No DST characterization tests exist today.**

### 1.2 L5 / P6 / G3 — one missing rate fails the hotel

```14964:15028:apps/pms-core/src/property-do.ts
  private postRoomChargesSync(businessDate: string): void {
    // ...
    for (const reservation of reservations) {
      const amountMinor = this.rateNightAmountSync(
        reservation.reservation_id,
        reservation.room_type_id,
        reservation.rate_plan_id,
        businessDate,
      );
      // ...
      this.assertChargeCodeSync('ROOM', { requireActive: true });
      this.insertFolioLineSync({ /* ... */ });
      // ...
    }
  }
```

`rateNightAmountSync` → `rateDayAmountSync` throws `RateMissingError` with no catch. One throw aborts Txn B → step **FAILED**, **zero** lines persisted (whole-hotel rollback). Case 17 **expects** that behaviour:

```115:136:apps/pms-core/test/night-audit-room-charges.spec.ts
  it('17: missing BAR rate fails whole step with rate_missing and zero lines', async () => {
    // ...
    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('rate_missing');
    expect(await stub.countFolioLines()).toBe(0);

    const roll = await stub.runAuditStep(businessDate, 'ROLL_BUSINESS_DATE');
    expect(roll.status).toBe('COMPLETED');
```

**G3:** case 17 must be rewritten in this vertical — skip-and-continue policy fails CI until the test matches.

### 1.3 L7 — `auto_no_show=false` still posts ROOM

Step order: **`POST_ROOM_CHARGES` runs before `PROCESS_NO_SHOWS`.** When `auto_no_show === false`, `processNoShowsSync` returns after pending/inquiry expiry without marking confirmed arrivals no-show (~3447–3448), but `postRoomChargesSync` still selects:

```14972:14974:apps/pms-core/src/property-do.ts
         WHERE status IN ('confirmed', 'checked_in')
           AND COALESCE(no_post, 0) = 0
           AND arrival_date <= ? AND departure_date > ?`,
```

Confirmed-not-arrived on the closing date still receive ROOM — contradicts disabling auto no-show. Prior [night-audit E2E §3.2](./2026-08-12-night-audit-e2e-design.md) said that was intentional; **audit Vertical 7 supersedes** for `auto_no_show === false`.

### 1.4 L8 — pending expires on arrival vs `confirmBy`

```3327:3333:apps/pms-core/src/property-do.ts
    const pending = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date
         FROM reservation
         WHERE status = 'pending' AND (confirm_by <= ? OR arrival_date <= ?)`,
        nowMs,
        businessDate,
      )
```

A pending hold with `confirm_by` tomorrow but `arrival_date = businessDate` matches `arrival_date <= businessDate` and is cancelled tonight — wrong. Expire on **`confirm_by` when set**; use **`arrival_date <= businessDate` only when `confirm_by IS NULL`**.

Desk lazy-expire (`expireHoldIfDueSync` ~8062) already keys off `confirm_by <= nowMs` for pending — night audit should align.

---

## 2. Locked behaviour

### 2.1 `zonedWallClockMs` (N1)

**Rename/generalize** `zonedMidnightMs` implementation into `zonedWallClockMs(dateStr, timeZone, hh, mm)`:

1. Parse `dateStr` as `YYYY-MM-DD`; initial UTC guess `Date.UTC(y, mo-1, d, hh, mm, 0)`.
2. Apply the **same two-pass** offset correction as today’s `zonedMidnightMs` (shared inner `asUtcFromZoned` + fixed-point subtraction).
3. **Read back** local `(year, month, day, hour, minute)` via `Intl.DateTimeFormat` with `hourCycle: 'h23'`.
4. **Gap (spring forward):** if local `(hour, minute) !== (hh, mm)` on the requested calendar date and local time is **earlier** than requested (non-existent wall slot) → advance candidate by **1 minute** until local matches `(hh, mm)` on that date or the calendar date rolls (if date rolls, stop — caller passes explicit `dateStr`; gap policy resolves to next real instant **on that date**, e.g. 02:00 → 03:00).
5. **Overlap (fall back):** if two UTC instants could satisfy the wall time, the two-pass first guess is the **first** occurrence; **do not** add +1 h correction when local already equals requested.
6. **`zonedMidnightMs`** becomes thin wrapper: `zonedWallClockMs(ymd, timeZone, 0, 0)` (keep call sites on cancel-grace / arrival midnight).

**Delete:** `zonedWallTimeToEpochMs`, `timeZoneOffsetMs`.

**Call sites:** `nextAuditRunAtMs` only (plus any new tests). `penaltyMinor` / cancel grace continue using midnight wrapper.

### 2.2 `postRoomChargesSync` per-row catch (L5, P6)

**Before loop:**

```ts
this.assertChargeCodeSync('ROOM', { requireActive: true });
```

**Candidate query** — see §2.3 for `auto_no_show` predicate.

**Loop body:**

```ts
for (const reservation of reservations) {
  try {
    const amountMinor = this.rateNightAmountSync(/* ... */);
    this.ensureGuestFolioWindowSync(reservation.reservation_id);
    // insertFolioLineSync + stampTaxForChargeSync (unchanged)
    postedCount += 1;
    if (postRoomChargesFailureAfterCountForTest !== null && postedCount >= threshold) {
      throw new Error('simulated_post_room_charges_failure');
    }
  } catch (e) {
    if (e instanceof RateMissingError) {
      this.recordNightAuditRoomChargeExceptionSync(reservation.reservation_id, businessDate, e.date);
      failedCount += 1;
      continue;
    }
    throw e;
  }
}
```

**Return type (private):** `{ postedCount: number; failedCount: number }` — caller `runAuditStep` ignores counts today; counts are for tests / future operator UI (R1.10).

**`recordNightAuditRoomChargeExceptionSync`** (private, sync):

- `appendAuditLogSync({ actor: 'system:night_audit', commandId: 'night_audit.run', entityType: 'reservation', entityId, reservationId, afterJson: { step: 'POST_ROOM_CHARGES', reason: RATE_MISSING, businessDate, stayDate: e.date } })`.
- **Forbidden:** `provisional_exception` insert; mutating `night_audit_run.error` on COMPLETED.

**Step outcome:** any number of rate-miss rows → **COMPLETED**. Zero reservations or all skipped → **COMPLETED** (hotel had nothing postable — not a failure). Test hook `simulated_post_room_charges_failure` → **FAILED** (unchanged case 19).

### 2.3 `POST_ROOM_CHARGES` selection when `auto_no_show === false` (L7)

Read `pms.night_audit.auto_no_show` once per step (default **true** when unset).

| `auto_no_show` | Stays selected for ROOM on night `businessDate` |
|---|---|
| **true** (default) | `status IN ('confirmed', 'checked_in')`, `arrival_date <= D`, `departure_date > D`, `no_post = 0` — **unchanged** |
| **false** | **`checked_in` only** with same date/`no_post` predicates |

**Rationale:** property disabled automatic no-show; confirmed-not-arrived are **not** charged room rent until check-in or manual no-show/cancel. In-house `checked_in` guests always post. When `auto_no_show` is true, confirmed same-day arrivals still post before `PROCESS_NO_SHOWS` marks no-show — unchanged economics.

**Amends** [night-audit E2E §3.2](./2026-08-12-night-audit-e2e-design.md) sentence “Room charges for those confirmed stays still posted in the previous step — that is intentional.”

### 2.4 Pending expiry (L8)

Replace pending SELECT predicate in `expirePendingAndInquirySync`:

```sql
WHERE status = 'pending'
  AND (
    (confirm_by IS NOT NULL AND confirm_by <= ?)
    OR (confirm_by IS NULL AND arrival_date <= ?)
  )
```

Bind `nowMs` for `confirm_by` comparison; `businessDate` for null-confirm arrival fallback.

**Inquiry** path unchanged this slice (`expires_at` or `arrival_date` per existing query) unless a test proves the same bug — audit ids **L8** for pending only.

**Cases:**

| pending | `confirm_by` | `arrival_date` | Expire on audit of D? |
|---|---|---|---|
| hold | past (`<= now`) | any | **Yes** |
| hold | future | `= D` | **No** |
| hold | **NULL** | `<= D` | **Yes** |
| hold | **NULL** | `> D` | **No** |

---

## 3. N1 verify table (characterization)

Implement table-driven tests in `apps/pms-core/test/zoned-wall-clock.spec.ts` (new). Each row: call `zonedWallClockMs(date, zone, hh, mm)` (export for test via existing unsafe-local pattern **or** test through `nextAuditRunAtMs` / package-level pure module — **prefer extracting helper to `apps/pms-core/src/zoned-wall-clock.ts`** if PropertyDO file size is a concern; otherwise keep private and test via `nextAuditRunAtMs` with `instant` just before candidate).

| Zone | Date | Requested | Policy | Acceptance |
|---|---|---|---|---|
| `America/New_York` | 2026-11-01 | 02:00 | First occurrence (fall back) | Local format back-read = 02:00; instant is **earlier** of the two 02:00 occurrences |
| `America/New_York` | 2026-03-08 | 02:00 | Next real instant after gap | Local = 02:00 does not exist; result local = **03:00** same calendar date |
| `Europe/Berlin` | 2026-03-29 | 02:00 | Gap → forward | Same as NY spring |
| `Europe/Berlin` | 2026-10-25 | 02:00 | Overlap → first | Same as NY fall |
| `Pacific/Chatham` | 2026-09-27 | 02:00 | Gap → forward | Must **not** reproduce 01:00 local (audit repro) |
| `Australia/Lord_Howe` | 2026-10-04 | 02:00 | 30-min DST | Correct local 02:00 on first or shifted instant per zone rules |
| `America/New_York` | 2026-07-01 | 02:00 | Exact | Round-trip local hour/minute = 02:00 |

Additional sanity: `zonedWallClockMs(d, tz, 0, 0)` equals prior `zonedMidnightMs(d, tz)` for UTC and `America/New_York` on 2026-07-01.

Use `apps/pms-core/test/date-helpers.ts` / `addCalendarDays` for date arithmetic in other tests — **not** copy-paste `addDays` from specs.

---

## 4. Implementation steps

**Order: failing characterization tests on `main`, then production.**

### 4.1 Tests first (red on `main`)

**`apps/pms-core/test/zoned-wall-clock.spec.ts`** (new)

- Table **§3** rows (N1).
- Regression: `nextAuditRunAtMs('Pacific/Chatham', '02:00', instantBefore2026-09-27)` > instant and local hour ≠ 1 when fired.

**`apps/pms-core/test/night-audit-room-charges.spec.ts`**

- **Rewrite case 17:** two reservations — `res_no_rate` (no `rate_day`) + `res_ok` (seeded rate). Expect `POST_ROOM_CHARGES` → **COMPLETED**; `res_ok` has 1 ROOM line; `res_no_rate` has 0; audit_log contains `rate_missing` for `res_no_rate`; `ROLL_BUSINESS_DATE` → **COMPLETED** (business date may advance per existing roll rules).
- **Add case 17b:** all candidates missing rate → **COMPLETED**, zero folio lines, `failedCount` equivalent via audit_log count = in-house count.
- **Keep case 19** — simulated failure after first post still **FAILED**, zero lines.

**`apps/pms-core/test/night-audit-no-shows.spec.ts`**

- **Add L7:** `auto_no_show = false`, confirmed arrival `= D`, rate seeded → `POST_ROOM_CHARGES` **COMPLETED**, **zero** ROOM lines; same stay **checked_in** → ROOM posts.
- **Add L8:** pending, `arrival_date = D`, `confirmBy = now + 24h` → `PROCESS_NO_SHOWS` does **not** cancel; pending with `confirmBy = now - 1` → cancelled; pending `confirmBy` null, `arrival = D` → cancelled.

Optional helper on stub: `listAuditLogForReservationForTest(reservationId)` if not already available.

### 4.2 Production (`property-do.ts` + optional extract)

1. Implement `zonedWallClockMs` + gap/overlap policy (§2.1); wire `nextAuditRunAtMs`; delete one-pass helpers.
2. Refactor `postRoomChargesSync` (§2.2–2.3); add `recordNightAuditRoomChargeExceptionSync`.
3. Fix `expirePendingAndInquirySync` pending WHERE (§2.4).
4. Run `pnpm --filter @hospai/pms-core exec vitest run` on touched specs until green.

### 4.3 Pins / gates

- **No** `COMMAND_CATALOG`, `V1_HTTP_ROUTE_AUDIT`, `PROPERTY_SCHEMA_HEAD`, `ORG_SCHEMA_HEAD`, or `NIGHT_AUDIT_STEPS` changes.
- **No** new HTTP routes or catalog commands.
- Full gate after implementation: `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` (8 shards; never `--` before `--shard`).

---

## 5. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `zoned-wall-clock.spec.ts` | NY 2026-11-01 | `02:00` | First overlap occurrence |
| T2 | `zoned-wall-clock.spec.ts` | NY 2026-03-08 | `02:00` | 03:00 local (gap forward) |
| T3 | `zoned-wall-clock.spec.ts` | Berlin Mar/Oct 2026 | `02:00` | Gap / overlap policies |
| T4 | `zoned-wall-clock.spec.ts` | Chatham 2026-09-27 | `02:00` | Not 01:00 local |
| T5 | `zoned-wall-clock.spec.ts` | Lord Howe 2026-10-04 | `02:00` | 30-min DST correct |
| T6 | `zoned-wall-clock.spec.ts` | NY 2026-07-01 | `02:00` | Exact round-trip |
| T7 | `night-audit-room-charges.spec.ts` | Mixed rates (case 17) | `POST_ROOM_CHARGES` | **COMPLETED**; sibling posted; skip audit_log |
| T8 | `night-audit-room-charges.spec.ts` | case 17 roll | `ROLL_BUSINESS_DATE` | **COMPLETED** |
| T9 | `night-audit-room-charges.spec.ts` | All missing rate | `POST_ROOM_CHARGES` | **COMPLETED**; 0 lines |
| T10 | `night-audit-room-charges.spec.ts` | case 19 hook | retry | **FAILED** then retry **COMPLETED** (unchanged) |
| T11 | `night-audit-no-shows.spec.ts` | `auto_no_show=false`, confirmed | `POST_ROOM_CHARGES` | 0 ROOM lines |
| T12 | `night-audit-no-shows.spec.ts` | same, `checked_in` | `POST_ROOM_CHARGES` | ROOM posted |
| T13 | `night-audit-no-shows.spec.ts` | pending, future `confirmBy` | `PROCESS_NO_SHOWS` | still `pending` |
| T14 | `night-audit-no-shows.spec.ts` | pending, past `confirmBy` | `PROCESS_NO_SHOWS` | `cancelled` |
| T15 | `night-audit-no-shows.spec.ts` | pending, null `confirmBy`, arrival D | `PROCESS_NO_SHOWS` | `cancelled` |
| T16 | regression | cases 16, 18, 20, 22b, 37, 31 | — | Still green |

Tests **T1–T14** (and rewritten T7–T8) must **fail on current `main`**.

---

## 6. Verify commands

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/zoned-wall-clock.spec.ts \
  test/night-audit-room-charges.spec.ts \
  test/night-audit-no-shows.spec.ts
```

Full gate:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** never put `--` before `--shard`.

---

## 7. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/property-do.ts` | `zonedWallClockMs`; delete one-pass helpers; `postRoomChargesSync`; `expirePendingAndInquirySync`; exception audit helper |
| `apps/pms-core/src/zoned-wall-clock.ts` | **Optional** extract if reviewer prefers testability without DO import |
| `apps/pms-core/test/zoned-wall-clock.spec.ts` | **New** — N1 table |
| `apps/pms-core/test/night-audit-room-charges.spec.ts` | Rewrite case 17; add 17b |
| `apps/pms-core/test/night-audit-no-shows.spec.ts` | L7, L8 cases |

**Not in scope:** `apps/web-pms` (U4), `packages/contracts` pins, `night-audit-workflow.ts` logic beyond alarm schedule side effect, catalog lane (Q11), smoke script, Playwright.

---

## 8. Pin freeze

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No migration. No new dispatched command.

---

## 9. Out of scope

- **Q11 / R0.8:** `night_audit.run` catalog BACKGROUND vs runtime `touchInteractive()` — document as leftover; do not “fix” lane in this vertical.
- **U4 / R0.11:** `NightAuditScreen` Alerts, disabled Run copy — unless file already open for unrelated work.
- **R1.10:** Operator stepped wizard, exception badge UX for rate misses — audit_log is sufficient for R0.7.
- **L6:** Named early-departure / silent `sold` release on checkout.
- PropertyDO extraction, Playwright, new HTTP/commands, `NIGHT_AUDIT_STEPS` growth.
- Inquiry expiry rule changes beyond pending (**L8** scope).
- Rewriting [folio-charges spec](./2026-08-05-folio-charges-vertical-design.md) test 17 prose in repo — **implementation PR** adds bidirectional pointer only.

---

## 10. Success criteria

1. DST table (**§3**) green — Chatham no longer fires at 01:00 local for 02:00 request (**N1**).
2. One missing rate: siblings post; step **COMPLETED**; audit_log exception per skip (**L5**, **P6**).
3. Case 17 rewritten; red on old `main`, green after fix (**G3**).
4. `auto_no_show=false`: confirmed-not-arrived skip ROOM; checked_in still posts (**L7**).
5. Pending respects future `confirm_by` against arrival-only expiry (**L8**).
6. Case 19 and existing room-charge cases 16/18/20/22b/37/31 remain green.
7. Pins unchanged; `pnpm test:local` green.

---

## 11. Relationship to prior specs

[2026-08-05-folio-charges-vertical-design.md](./2026-08-05-folio-charges-vertical-design.md) test 17 locked fail-whole-hotel — **this spec supersedes** for per-row continue + COMPLETED step.

[2026-08-12-night-audit-e2e-design.md](./2026-08-12-night-audit-e2e-design.md) §3.2 **`auto_no_show=false` still posts ROOM** — **superseded for L7** when config is false.

[2026-08-15-night-audit-auto-extend-design.md](./2026-08-15-night-audit-auto-extend-design.md) per-reservation `RateMissingError` skip in `runAutoExtendSync` — **same hotel-wide loop pattern** as this slice; auto-extend unchanged.

[2026-09-05-city-ledger-ar-post-path-design.md](./2026-09-05-city-ledger-ar-post-path-design.md) explicitly deferred **L5** — closed here.

Bidirectional one-sentence pointers in amended specs are the **final implementation task**, not this spec writer’s job.
