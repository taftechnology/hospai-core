# Night audit clock + room charges (R0.7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **N1**, **L5**, **L7**, **L8**, **G3**, **P6** — unify night-audit wall-clock on two-pass DST fixed point; catch `RateMissingError` per reservation in `POST_ROOM_CHARGES` (step **COMPLETED**, audit_log exceptions); tighten ROOM selection when `auto_no_show=false`; fix pending expiry to honour `confirm_by`.

**Architecture:** Characterization tests land **first** and must fail on current `main`. Extract `zonedWallClockMs` to a pure module (shared with midnight wrapper). Refactor `postRoomChargesSync` with per-row catch + hoisted `assertChargeCodeSync`. No schema migration, catalog command, HTTP route, or SPA — pins frozen.

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts`, vitest + `cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-night-audit-clock-room-charges-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. No catalog/route/schema pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **N1 wall-clock** | Single `zonedWallClockMs(dateStr, timeZone, hh, mm)` — two-pass core; `zonedMidnightMs` → thin wrapper `(ymd, tz, 0, 0)`. **Delete** `zonedWallTimeToEpochMs` + `timeZoneOffsetMs`. |
| **DST gap** | Requested local `HH:MM` absent (spring forward) → next real instant on that calendar date (typically 03:00 for 02:00 request). |
| **DST overlap** | Requested local `HH:MM` occurs twice (fall back) → **first** occurrence (earlier UTC instant). |
| **Alarm wiring** | `nextAuditRunAtMs`, `ensureNightAuditSchedule`, `rescheduleNightAuditAlarmSync` call `zonedWallClockMs` only. |
| **L5 / P6 per-row catch** | `RateMissingError` → log exception, `continue`. Any other throw → propagate (step **FAILED**). |
| **`assertChargeCodeSync`** | Once **before** loop; not per reservation. |
| **Step status on rate misses** | **COMPLETED** (not FAILED). `night_audit_run.error` **NULL** on success path. |
| **Exception record** | `appendAuditLogSync` per skipped reservation (`reason: rate_missing` in `afterJson`); **no** `provisional_exception`. |
| **L7 `auto_no_show` false** | `POST_ROOM_CHARGES` SQL: **`checked_in` only** (same date/`no_post` predicates). |
| **L7 `auto_no_show` true** | Keep `status IN ('confirmed', 'checked_in')` — unchanged. |
| **L8 pending expiry** | `(confirm_by IS NOT NULL AND confirm_by <= nowMs) OR (confirm_by IS NULL AND arrival_date <= businessDate)`. |
| **G3 case 17** | Rewrite in **Task 1** to new skip-and-continue policy; must **fail on `main`** until Task 2. |
| **Case 19** | Unchanged — simulated non-domain throw after one post still **FAILED** + zero lines. |

**Out of scope:** Q11 catalog lane (R0.8), U4 `NightAuditScreen`, R1.10 operator wizard, new HTTP/commands, PropertyDO extraction, Playwright, inquiry expiry rule changes.

---

## Sequencing gate

```
Task 1 (red tests) → Task 2 (production, green) → Task 3 (full CI + tick R0.7)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T14). Task 2 makes pms-core specs green. Task 3 runs full CI + `pnpm test:local` and ticks roadmap.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Create: `apps/pms-core/test/zoned-wall-clock.spec.ts`
- Modify: `apps/pms-core/test/night-audit-room-charges.spec.ts`
- Modify: `apps/pms-core/test/night-audit-no-shows.spec.ts`

**Interfaces:** none (tests only). Import `zonedWallClockMs` from `../src/zoned-wall-clock.js` after Task 2 creates the module — **Task 1 may import the path and accept compile failure until Task 2**, or inline expected values and switch import in Task 2. **Preferred:** create a minimal stub export in Task 2 Step 0 before running tests; for Task 1, write tests against the import path (implementer runs vitest after Task 2 module exists). Task 1 commit is tests-only; if CI typechecks tests, add a temporary re-export from `property-do.ts` in Task 2 Step 0 first — **reviewer lock: extract module in Task 2, tests written against `zoned-wall-clock.ts` import in Task 1**.

Use `addCalendarDays` from `apps/pms-core/test/date-helpers.ts` for date arithmetic in L7/L8 — **not** copy-paste `addDays` from specs.

### Step 1 — New file: `zoned-wall-clock.spec.ts` (N1 table §3)

Create `apps/pms-core/test/zoned-wall-clock.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { zonedWallClockMs } from '../src/zoned-wall-clock.js';

function localParts(instantMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
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
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function ymdFromParts(p: ReturnType<typeof localParts>): string {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

describe('zonedWallClockMs (N1)', () => {
  const cases = [
    {
      name: 'NY fall-back 2026-11-01 02:00 → first occurrence',
      zone: 'America/New_York',
      date: '2026-11-01',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-11-01');
        // First of two 02:00 occurrences is the earlier UTC instant
        const secondGuess = ms + 60 * 60 * 1000;
        const p2 = localParts(secondGuess, 'America/New_York');
        if (p2.hour === 2 && p2.minute === 0 && ymdFromParts(p2) === '2026-11-01') {
          expect(ms).toBeLessThan(secondGuess);
        }
      },
    },
    {
      name: 'NY spring-forward 2026-03-08 02:00 → 03:00 local (gap)',
      zone: 'America/New_York',
      date: '2026-03-08',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(ymdFromParts(p)).toBe('2026-03-08');
        expect(p.hour).toBe(3);
        expect(p.minute).toBe(0);
      },
    },
    {
      name: 'Berlin spring 2026-03-29 02:00 → gap forward',
      zone: 'Europe/Berlin',
      date: '2026-03-29',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Europe/Berlin');
        expect(ymdFromParts(p)).toBe('2026-03-29');
        expect(p.hour).toBeGreaterThanOrEqual(2);
        expect(p.hour * 60 + p.minute).toBeGreaterThanOrEqual(2 * 60);
      },
    },
    {
      name: 'Berlin fall 2026-10-25 02:00 → first overlap',
      zone: 'Europe/Berlin',
      date: '2026-10-25',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Europe/Berlin');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-10-25');
      },
    },
    {
      name: 'Pacific/Chatham 2026-09-27 02:00 → not 01:00 local (audit repro)',
      zone: 'Pacific/Chatham',
      date: '2026-09-27',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Pacific/Chatham');
        expect(p.hour).not.toBe(1);
        expect(ymdFromParts(p)).toBe('2026-09-27');
      },
    },
    {
      name: 'Lord Howe 30-min DST 2026-10-04 02:00',
      zone: 'Australia/Lord_Howe',
      date: '2026-10-04',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Australia/Lord_Howe');
        expect(ymdFromParts(p)).toBe('2026-10-04');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
      },
    },
    {
      name: 'NY summer exact 2026-07-01 02:00 round-trip',
      zone: 'America/New_York',
      date: '2026-07-01',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-07-01');
      },
    },
  ] as const;

  it.each(cases)('$name', ({ zone, date, hh, mm, assert }) => {
    const ms = zonedWallClockMs(date, zone, hh, mm);
    assert(ms);
  });

  it('midnight wrapper: zonedWallClockMs(d, tz, 0, 0) matches prior midnight semantics', () => {
    for (const [date, zone] of [
      ['2026-07-01', 'America/New_York'],
      ['2026-07-01', 'UTC'],
    ] as const) {
      const ms = zonedWallClockMs(date, zone, 0, 0);
      const p = localParts(ms, zone);
      expect(p.hour).toBe(0);
      expect(p.minute).toBe(0);
      expect(ymdFromParts(p)).toBe(date);
    }
  });
});
```

**Red on `main`:** module missing; one-pass `zonedWallTimeToEpochMs` would fail Chatham / gap rows.

### Step 2 — Rewrite case 17 + add 17b (`night-audit-room-charges.spec.ts`)

**Replace** existing test `17: missing BAR rate fails whole step…` entirely. Do **not** keep FAILED-whole-hotel expectations.

```ts
  it('17: missing BAR rate skips row; sibling posts; step COMPLETED (G3)', async () => {
    const { stub } = await provisionedPropertyStub(`na-mixed-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRoomType(stub, 'rt_b', 'RTB');
    await seedRate(stub, 'rt_b', businessDate, 15000);

    await stub.insertReservationForTest({
      reservationId: 'res_no_rate',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_ok',
      roomTypeId: 'rt_b',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'checked_in',
    });

    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(result.error).toBeUndefined();

    expect(await stub.countFolioLinesForReservation('res_no_rate')).toBe(0);
    expect(await stub.countFolioLinesForReservation('res_ok')).toBe(1);
    expect(
      (await stub.listFolioLinesForReservation('res_ok')).find(
        (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT',
      ),
    ).toMatchObject({ amountMinor: 15000, businessDate });

    const auditNoRate = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_no_rate' });
    expect(auditNoRate.some((e) => e.afterJson?.reason === 'rate_missing')).toBe(true);

    const roll = await stub.runAuditStep(businessDate, 'ROLL_BUSINESS_DATE');
    expect(roll.status).toBe('COMPLETED');
  });

  it('17b: all in-house missing rate → COMPLETED, zero lines, audit_log per skip', async () => {
    const { stub } = await provisionedPropertyStub(`na-all-miss-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRoomType(stub, 'rt_b', 'RTB');

    await stub.insertReservationForTest({
      reservationId: 'res_miss_a',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_miss_b',
      roomTypeId: 'rt_b',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'checked_in',
    });

    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLines()).toBe(0);

    for (const id of ['res_miss_a', 'res_miss_b'] as const) {
      const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: id });
      expect(audit.some((e) => e.afterJson?.reason === 'rate_missing')).toBe(true);
    }
  });
```

**Red on `main`:** case 17 expects `FAILED` today; mixed hotel aborts with zero sibling lines.

**Keep case 19 unchanged** — whole-step abort on simulated failure.

### Step 3 — L7 cases (`night-audit-no-shows.spec.ts`)

Add after test 8 (or in new `describe('POST_ROOM_CHARGES + auto_no_show (L7)')`):

```ts
  it('L7a: auto_no_show=false → confirmed-not-arrived gets zero ROOM lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-l7-conf-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-l7a', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r-l7a', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_l7_conf',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
    });

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_l7_conf')).toBe(0);
  });

  it('L7b: auto_no_show=false → checked_in still posts ROOM', async () => {
    const { stub } = await provisionedPropertyStub(`na-l7-ci-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-l7b', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r-l7b', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_l7_ci',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'checked_in',
    });

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_l7_ci')).toBe(1);
  });
```

**Red on `main`:** L7a gets 1 ROOM line (confirmed still selected).

### Step 4 — L8 cases (`night-audit-no-shows.spec.ts`)

Add after L7 block:

```ts
  it('L8a: pending arrival=D with future confirmBy → not cancelled on PROCESS_NO_SHOWS', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-future-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_future',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() + 24 * 60 * 60 * 1000,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_future');
    expect(res.ok && res.reservation.status).toBe('pending');
  });

  it('L8b: pending past confirmBy → cancelled', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-past-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_past',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() - 1,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_past');
    expect(res.ok && res.reservation.status).toBe('cancelled');
  });

  it('L8c: pending null confirmBy, arrival=D → cancelled', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-null-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_null',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'pending',
      confirmBy: null,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_null');
    expect(res.ok && res.reservation.status).toBe('cancelled');
  });
```

**Red on `main`:** L8a cancelled today (`arrival_date <= businessDate` OR-branch).

### Step 5 — Run vitest; confirm red

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/zoned-wall-clock.spec.ts \
  test/night-audit-room-charges.spec.ts \
  test/night-audit-no-shows.spec.ts
```

- [ ] T1–T7 (DST table) fail until `zoned-wall-clock.ts` exists and is correct
- [ ] T8–T9 (case 17, 17b) fail on `main` (step FAILED / zero sibling lines)
- [ ] T10–T11 (L7) fail on `main` (confirmed gets ROOM)
- [ ] T12–T14 (L8) fail on `main` (L8a cancelled)
- [ ] Regression: cases 16, 18, 19, 20, 22b, 37, 31 in room-charges; tests 7–22a in no-shows still pass
- [ ] Do **not** change production code in this task

### Step 6 — Commit (tests only)

```bash
git add \
  apps/pms-core/test/zoned-wall-clock.spec.ts \
  apps/pms-core/test/night-audit-room-charges.spec.ts \
  apps/pms-core/test/night-audit-no-shows.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): night-audit clock + room charges characterization (red)

Rewrite case 17 to skip-and-continue; add DST table, L7 auto_no_show ROOM,
and L8 pending confirm_by cases. Tests fail on main until production fix.
EOF
)"
```

---

## Task 2 — Production (`zoned-wall-clock.ts` + PropertyDO)

**Files:**
- Create: `apps/pms-core/src/zoned-wall-clock.ts`
- Modify: `apps/pms-core/src/property-do.ts` (~1051, ~1515–1560, ~3323, ~14964)

**Interfaces:**

```ts
// apps/pms-core/src/zoned-wall-clock.ts
/** UTC instant for local `HH:MM` on `dateStr` (YYYY-MM-DD) in `timeZone`. Two-pass fixed point + gap/overlap policy. */
export function zonedWallClockMs(dateStr: string, timeZone: string, hh: number, mm: number): number;

// property-do.ts — private
private recordNightAuditRoomChargeExceptionSync(
  reservationId: string,
  businessDate: string,
  stayDate: string,
): void;

private postRoomChargesSync(businessDate: string): { postedCount: number; failedCount: number };
```

### Step 0 — Create `zoned-wall-clock.ts`

Implement per spec §2.1:

```ts
export function zonedWallClockMs(dateStr: string, timeZone: string, hh: number, mm: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

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

  const twoPass = (utcGuess: number): number => {
    const guess = utcGuess - (asUtcFromZoned(utcGuess) - utcGuess);
    return utcGuess - (asUtcFromZoned(guess) - guess);
  };

  let candidate = twoPass(Date.UTC(y, mo, d, hh, mm, 0));

  const readLocal = (instant: number) => {
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    };
  };

  // Gap (spring forward): advance 1 minute until local matches requested on same calendar date
  for (let i = 0; i < 180; i++) {
    const local = readLocal(candidate);
    const sameDate =
      local.year === y && local.month === mo + 1 && local.day === d;
    if (sameDate && local.hour === hh && local.minute === mm) break;
    if (!sameDate) break;
    if (local.hour < hh || (local.hour === hh && local.minute < mm)) {
      candidate += 60_000;
      continue;
    }
    // Overlap: local already equals requested — first occurrence from twoPass; do not add +1h
    if (local.hour === hh && local.minute === mm) break;
    candidate += 60_000;
  }

  return candidate;
}
```

- [ ] Export is pure (no DO import)
- [ ] Gap policy: non-existent 02:00 → 03:00 same date for US zones
- [ ] Overlap: two-pass first guess is first occurrence — no +1h when local already matches

### Step 1 — Wire PropertyDO: midnight wrapper + delete one-pass helpers

In `property-do.ts`:

```ts
import { zonedWallClockMs } from './zoned-wall-clock.js';

function zonedMidnightMs(ymd: string, timeZone: string): number {
  return zonedWallClockMs(ymd, timeZone, 0, 0);
}
```

**Delete** `timeZoneOffsetMs`, `zonedWallTimeToEpochMs`, and the old inline `zonedMidnightMs` body.

Update `nextAuditRunAtMs`:

```ts
function nextAuditRunAtMs(timeZone: string, auditTime: string, instant: Date): number {
  const [hh, mm] = auditTime.split(':').map(Number);
  const today = enumerateHorizonDates(timeZone, instant, 1)[0]!;
  const candidate = zonedWallClockMs(today, timeZone, hh!, mm!);
  if (candidate > instant.getTime()) return candidate;
  const tomorrow = enumerateFromDate(today, 2)[1]!;
  return zonedWallClockMs(tomorrow, timeZone, hh!, mm!);
}
```

- [ ] `ensureNightAuditSchedule` / `rescheduleNightAuditAlarmSync` paths unchanged except helper swap
- [ ] Existing `night-audit.spec.ts` reschedule tests remain green

### Step 2 — `recordNightAuditRoomChargeExceptionSync`

Add private method near `postRoomChargesSync`:

```ts
private recordNightAuditRoomChargeExceptionSync(
  reservationId: string,
  businessDate: string,
  stayDate: string,
): void {
  this.appendAuditLogSync({
    actor: 'system:night_audit',
    commandId: 'night_audit.run',
    entityType: 'reservation',
    entityId: reservationId,
    reservationId,
    afterJson: {
      step: 'POST_ROOM_CHARGES',
      reason: RATE_MISSING,
      businessDate,
      stayDate,
    },
  });
}
```

Import `RATE_MISSING` from `@hospai/contracts` if not already in scope at module level.

- [ ] **Forbidden:** `provisional_exception` insert
- [ ] **Forbidden:** mutating `night_audit_run.error` when step completes

### Step 3 — Refactor `postRoomChargesSync` (L5, P6, L7)

Replace method body (~14964):

```ts
private postRoomChargesSync(businessDate: string): { postedCount: number; failedCount: number } {
  const ledgerCurrency = this.readStoredLedgerCurrencySync();
  if (!ledgerCurrency) throw new Error(CURRENCY_UNSET);

  const autoNoShow = this.readConfigValueSync('pms.night_audit.auto_no_show');
  const statusPredicate =
    autoNoShow === false
      ? `status = 'checked_in'`
      : `status IN ('confirmed', 'checked_in')`;

  const reservations = this.ctx.storage.sql
    .exec(
      `SELECT reservation_id, room_type_id, rate_plan_id
       FROM reservation
       WHERE ${statusPredicate}
         AND COALESCE(no_post, 0) = 0
         AND arrival_date <= ? AND departure_date > ?`,
      businessDate,
      businessDate,
    )
    .toArray() as Array<{ reservation_id: string; room_type_id: string; rate_plan_id: string }>;

  this.assertChargeCodeSync('ROOM', { requireActive: true });

  let postedCount = 0;
  let failedCount = 0;

  for (const reservation of reservations) {
    try {
      const amountMinor = this.rateNightAmountSync(
        reservation.reservation_id,
        reservation.room_type_id,
        reservation.rate_plan_id,
        businessDate,
      );

      this.ensureGuestFolioWindowSync(reservation.reservation_id);
      const folioWindowId = this.readGuestFolioWindowIdSync(reservation.reservation_id);
      const fxRateAt = Date.now();
      const posted: PostedLineAmount = {
        amountMinor,
        txnCurrency: ledgerCurrency,
        ledgerAmountMinor: amountMinor,
        fxRate: '1',
        fxRateAt,
      };

      this.insertFolioLineSync({
        folioLineId: `${reservation.reservation_id}:room:${businessDate}`,
        folioWindowId,
        reservationId: reservation.reservation_id,
        chargeCode: 'ROOM',
        posted,
        source: 'NIGHT_AUDIT',
        businessDate,
      });
      this.stampTaxForChargeSync({
        parentLineId: `${reservation.reservation_id}:room:${businessDate}`,
        parentAmountMinor: amountMinor,
        parentSource: 'NIGHT_AUDIT',
        chargeCode: 'ROOM',
        reservationId: reservation.reservation_id,
        folioWindowId,
        postingDate: businessDate,
        posted,
      });
      postedCount += 1;

      if (
        this.postRoomChargesFailureAfterCountForTest !== null &&
        postedCount >= this.postRoomChargesFailureAfterCountForTest
      ) {
        throw new Error('simulated_post_room_charges_failure');
      }
    } catch (e) {
      if (e instanceof RateMissingError) {
        this.recordNightAuditRoomChargeExceptionSync(
          reservation.reservation_id,
          businessDate,
          e.date,
        );
        failedCount += 1;
        continue;
      }
      throw e;
    }
  }

  return { postedCount, failedCount };
}
```

- [ ] `assertChargeCodeSync` hoisted before loop (not inside)
- [ ] `RateMissingError` only — other errors abort Txn B (case 19)
- [ ] Caller `runAuditStep` may ignore return counts (tests use audit_log / folio lines)
- [ ] **No `await` in `transactionSync`**

### Step 4 — Fix pending expiry SQL (L8)

In `expirePendingAndInquirySync` (~3327), replace pending SELECT:

```sql
WHERE status = 'pending'
  AND (
    (confirm_by IS NOT NULL AND confirm_by <= ?)
    OR (confirm_by IS NULL AND arrival_date <= ?)
  )
```

Bind `nowMs` for `confirm_by`; `businessDate` for null-confirm arrival fallback.

- [ ] Inquiry path **unchanged** this slice
- [ ] Aligns with desk `expireHoldIfDueSync` (`confirm_by <= nowMs`)

### Step 5 — Focused test run (must go green)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/zoned-wall-clock.spec.ts \
  test/night-audit-room-charges.spec.ts \
  test/night-audit-no-shows.spec.ts \
  test/night-audit.spec.ts
```

- [ ] T1–T14 green
- [ ] Case 19 still **FAILED** on simulated throw, retry **COMPLETED**
- [ ] Cases 16, 18, 20, 22b, 37, 31 green (regression)
- [ ] No-shows tests 7–22a green (regression)

```bash
pnpm typecheck
```

### Step 6 — Commit

```bash
git add \
  apps/pms-core/src/zoned-wall-clock.ts \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): night-audit DST wall clock and per-row ROOM charges

Extract zonedWallClockMs two-pass helper; catch RateMissingError per
reservation; tighten POST_ROOM_CHARGES when auto_no_show=false; fix
pending expiry to honour confirm_by (N1/L5/L7/L8/G3/P6).
EOF
)"
```

---

## Task 3 — Full CI + tick R0.7

**Files:** `docs/roadmap.md` (R0.7 checkbox only)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/zoned-wall-clock.spec.ts \
  test/night-audit-room-charges.spec.ts \
  test/night-audit-no-shows.spec.ts \
  test/night-audit.spec.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.7

In `docs/roadmap.md` line ~183, change:

```markdown
- [ ] **R0.7** Audit V7 — N1, L5, L7, L8, G3, P6. ...
```

to:

```markdown
- [x] **R0.7** Audit V7 — N1, L5, L7, L8, G3, P6. ...
```

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.7 after night-audit clock + room charges fix

Full CI checks and pms-core shards green; audit N1/L5/L7/L8/G3/P6 closed.
EOF
)"
```

---

## Test matrix (spec §5 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `zoned-wall-clock.spec.ts` | 1–2 | NY fall 2026-11-01 02:00 first overlap | Yes |
| T2 | `zoned-wall-clock.spec.ts` | 1–2 | NY spring 2026-03-08 → 03:00 local | Yes |
| T3 | `zoned-wall-clock.spec.ts` | 1–2 | Berlin Mar/Oct 2026 gap/overlap | Yes |
| T4 | `zoned-wall-clock.spec.ts` | 1–2 | Chatham 2026-09-27 not 01:00 local | Yes |
| T5 | `zoned-wall-clock.spec.ts` | 1–2 | Lord Howe 30-min DST | Yes |
| T6 | `zoned-wall-clock.spec.ts` | 1–2 | NY summer exact round-trip | Yes |
| T7 | `night-audit-room-charges.spec.ts` | 1–2 | Case 17 mixed → COMPLETED; sibling posted | Yes |
| T8 | `night-audit-room-charges.spec.ts` | 1–2 | Case 17 roll → COMPLETED | Yes |
| T9 | `night-audit-room-charges.spec.ts` | 1–2 | Case 17b all miss → COMPLETED; 0 lines | Yes |
| T10 | `night-audit-no-shows.spec.ts` | 1–2 | L7a confirmed → 0 ROOM | Yes |
| T11 | `night-audit-no-shows.spec.ts` | 1–2 | L7b checked_in → ROOM posted | No (regression) |
| T12 | `night-audit-no-shows.spec.ts` | 1–2 | L8a future confirmBy → pending | Yes |
| T13 | `night-audit-no-shows.spec.ts` | 1–2 | L8b past confirmBy → cancelled | No (regression) |
| T14 | `night-audit-no-shows.spec.ts` | 1–2 | L8c null confirmBy arrival D → cancelled | No (regression) |
| T15 | `night-audit-room-charges.spec.ts` | 2 | Case 19 simulated failure → FAILED | No (regression) |
| T16 | both spec files | 2 | Cases 16/18/20/22b/37/31; no-shows 7–22a | No (regression) |

---

## Success criteria (spec §10)

1. DST table green — Chatham no longer fires at 01:00 local for 02:00 request (**N1**).
2. One missing rate: siblings post; step **COMPLETED**; audit_log exception per skip (**L5**, **P6**).
3. Case 17 rewritten; red on old `main`, green after fix (**G3**).
4. `auto_no_show=false`: confirmed-not-arrived skip ROOM; checked_in still posts (**L7**).
5. Pending respects future `confirm_by` against arrival-only expiry (**L8**).
6. Case 19 and existing room-charge / no-show cases remain green.
7. Pins unchanged; `pnpm test:local` green.

---

## Plan vs codebase mismatches (reviewer)

| Item | Notes |
|---|---|
| `zonedWallClockMs` not on `main` | New module in Task 2; tests import it in Task 1 (typecheck may fail until Task 2 Step 0 — run Task 1 vitest only after stub module or accept import error in CI until Task 2). |
| Case 17 on `main` | Expects `FAILED` + zero lines — Task 1 **replaces** with COMPLETED + sibling posted. |
| `postRoomChargesSync` return type | Currently `void`; plan adds `{ postedCount, failedCount }` — caller ignores. |
| `assertChargeCodeSync` in loop today | Moved before loop per spec; missing ROOM charge code fails whole step (not per-row). |
| `auto_no_show` default | Unset config reads as **true** via `readConfigValueSync`; L7 SQL branch only when `=== false`. |
| Test 20/21 in no-shows | POST_ROOM_CHARGES with `confirmed` + default auto_no_show — **unchanged**; L7 only when config false. |
| Bidirectional spec pointers | Folio-charges test 17 prose superseded — optional one-line pointer in implementation PR; not required for R0.7 tick. |
