# Night-audit auto-extend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)

**Goal:** Wire the consumer for `pms.night_audit.auto_extend` inside the existing `POST_ROOM_CHARGES` Txn B body: before tonight’s ROOM posting, extend checked-in guests due out tomorrow by one night when inventory and room assignability allow; add Settings hint copy.

**Architecture:** No new catalog command, HTTP route, schema migration, or ninth night-audit step. Private `runAutoExtendSync(businessDate)` queries `checked_in` + `departure_date = D+1`, per-reservation extend-or-skip (same class as `runAutoTransferSync`), reusing `commitSoldNightsSync`, `assertRoomAssignableSync`, and `syncReservationRateNightsOnModifySync`. Audit via existing `reservations.modify` writer with `afterJson.automated: true` and system actor `{ kind: 'system', reason: 'night_audit' }`.

**Tech Stack:** PropertyDO + sqlite, `@hospai/contracts` (unchanged catalog/HTTP), vitest Worker specs (`provisionedPropertyStub`, helpers from `night-audit-room-charges.spec.ts`), web-pms RTL.

**Spec:** `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` (Approved).

---

## Sequencing gate (read before starting)

This slice closes **night-audit E2E leftover 4** (`auto_extend` unread), the **`auto_extend` half** of **property-setup leftover 16**, and **auto-assign leftover 5** (names only — unrelated consumer).

| After this plan | Do not start |
|---|---|
| Config-gated helper inside `POST_ROOM_CHARGES` only | `AUTO_EXTEND` as step 9 / growing `NIGHT_AUDIT_STEPS` |
| +1 night extend for `checked_in`, `departure = D+1` | Extending `confirmed` (no-show path owns those) |
| Per-reservation skip; step always `COMPLETED` on skip | Guest-facing RPC / `tryModifyReservation` wrapper |
| Settings hint on existing toggle | `listDomainConfig` elsewhere; `@hospai/client-core` changes |
| Reuse `reservations.modify` audit + modify outbox events | New catalog id / HTTP route / migration |
| — | Moving catalog **79** / HTTP `[131]` / schema **28** / org **7** |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **79**. `AUDIT_WRITER_COMMAND_IDS.size` **54**. Last HTTP `[131] post_folio_routing_rule_archive`. `[128] post_folio_stay_discount` and `[127] post_demo_seed` **unmoved**. `PROPERTY_SCHEMA_HEAD` **28**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`. **No** catalog command, HTTP route, or migration in this chunk.

### D2 — Consumer placement (spec Lock 1)

**Locked:** Wire in `runAuditStep` Txn B **`POST_ROOM_CHARGES` branch** (`property-do.ts` ~2637–2638):

```typescript
} else if (step === 'POST_ROOM_CHARGES') {
  if (this.readConfigValueSync('pms.night_audit.auto_extend') === true) {
    this.runAutoExtendSync(businessDate);
  }
  this.postRoomChargesSync(businessDate);
}
```

Config stored **`false`** → skip helper; POST unchanged. Unset key → register default **`true`** → helper runs. Uncaught throw in helper or `postRoomChargesSync` → Txn B rollback → step **`FAILED`**.

### D3 — Candidates + extend body (spec Locks 2–3)

**Locked:** Candidates: `status = 'checked_in'` AND `departure_date = D+1` only (`D+1 = enumerateFromDate(businessDate, 2)[1]!` in DO; tests use `addCalendarDays` / local `addDays`). **`no_post` does not skip extend.** Extend: `newDeparture = D+2`; ledger type `allocated_room_type_id || room_type_id`; acquire sold night **`D+1`** via **`commitSoldNightsSync(allocatedId, arrivalDate, newDeparture, [D+1])`** (verified signature: four args — do not invent a fifth); keep `room_id`; `syncReservationRateNightsOnModifySync` with `oldNights = enumerateStayDates(arrival, D+1)`, `newNights = enumerateStayDates(arrival, D+2)`; emit `reservation.modified` + `availability.changed`; audit `reservations.modify` with `automated: true`. **Do not** call `tryModifyReservation`. Assignability / no-avail / restriction → **skip** reservation; step still **`COMPLETED`**; `postRoomChargesSync(D)` always runs after loop.

### D4 — SPA copy (spec Lock 4)

**Locked:** Settings hint exactly: **“When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available.”**

### D5 — Test discipline

**Locked:** New `apps/pms-core/test/night-audit-auto-extend.spec.ts`. Harness from `night-audit-room-charges.spec.ts` (`provisionedPropertyStub`, `runAuditStep`, `seedRoomType`, `seedRate`, local `addDays`). Config-off via `tryPutDomainConfig` (`night-audit-no-shows.spec.ts` ~64–70). Sold asserts via `stub.readAvailabilityDay`. Fixture ids via `crypto.randomUUID()`. **Do not** `vi.spyOn` into the DO isolate. **Do not** invent `provisionedPropertyWorker`. File-filter vitest; `--shard=N/8` with **no `--` before `--shard`**. Workerd 503: retry that shard once. Do not `|| true`. Never unsharded pms-core test.

### D6 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts`** before pms-core tests only if contracts change (this chunk should **not**).
2. **Rebuild `@hospai/client-core`** before web-pms tests only if client changes (Task 2 should **not**).
3. **Register pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.
4. **`pnpm check:web-pms-colors`** when SPA files touched (Task 2).
5. **Bidirectional pointers** (night-audit E2E §12 leftover **4**; property-setup §8.1 + leftover **16**; auto-assign §8 leftover **5**) — **Task 3 only**, plus tick spec §9 and plan Task 3 checkboxes there.
6. Living plan checkboxes: tick `- [x]` on **Task 3 only** at implementation time.
7. Spec/plan writers do not commit; implementers commit per task.

---

## Global Constraints

- **`NIGHT_AUDIT_STEPS` length stays 8** — no `AUTO_EXTEND` token.
- **Same audit writer:** `reservations.modify` only; actor `{ kind: 'system', reason: 'night_audit' }` (already on `SystemActor` union).
- **Virtual types:** sold ledger on **`allocated_room_type_id || room_type_id`** (physical allocated type).
- **Idempotent:** after extend to `D+2`, candidate predicate (`departure = D+1`) excludes the row; re-run is no-op for extend.
- **Helper before POST:** extended guest still matches `departure_date > D` for tonight’s ROOM line.
- **`pnpm check:web-pms-colors`** if SPA files touched (Task 2).
- **Fixture discipline:** `crypto.randomUUID()` in shared-storage tests; `check:pms-core-test-dates` green after Task 1.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/src/property-do.ts` | `runAutoExtendSync`; Lock 1 branch in `runAuditStep` ~2637 | 1 |
| `apps/pms-core/test/night-audit-auto-extend.spec.ts` | DO cases §7 **1–7** (new) | 1 |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | Auto extend `hint` ~478–483 | 2 |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | Hint RTL case **8** | 2 |
| `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` | Close §12 leftover **4** | 3 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close §8.1 unread + leftover **16** (`auto_extend`) | 3 |
| `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` | Close §8 leftover **5** | 3 |
| `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` | Tick §9 checklist | 3 |
| `docs/superpowers/plans/2026-08-15-night-audit-auto-extend.md` | Task 3 checkboxes (this file) | 3 |

**Not touched:** `packages/contracts/src/commands/catalog.ts`, `v1-http-routes.ts`, `v1-dispatch.ts`, `packages/client-core`, `config/register.ts`, migrations, `NIGHT_AUDIT_STEPS` array contents/length, `permissions.ts` (unless typecheck forces — prefer not), demo seed, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`.

---

## Spec §1.2 / §9 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) `runAutoExtendSync` | 1 |
| §1.2 (2) `POST_ROOM_CHARGES` branch | 1 |
| §1.2 (3) Audit / outbox | 1 |
| §1.2 (4) SPA hint | 2 |
| §1.2 (5) Tests §7 | 1–3 |
| §7 DO **1–7** | 1 |
| §7 SPA **8** | 2 |
| §7 register pins | 3 |
| §9 checklist + bidirectional pointers | 3 |
| §1.3 scope out | forbidden all |

---

### Task 1: DO — `runAutoExtendSync` + `POST_ROOM_CHARGES` branch + tests

**Spec:** §2 Locks 1–3, §5 errors, §7 DO **1–7**.

**Files:**
- Create: `apps/pms-core/test/night-audit-auto-extend.spec.ts`
- Modify: `apps/pms-core/src/property-do.ts` — `runAutoExtendSync` (near `runAutoTransferSync` ~3067); `runAuditStep` `POST_ROOM_CHARGES` ~2637–2638

**Interfaces:**
- Produces: `private runAutoExtendSync(businessDate: string): { extendedCount: number; skippedCount: number }`
- Produces: `runAuditStep` calls helper when `readConfigValueSync('pms.night_audit.auto_extend') === true`, then `postRoomChargesSync(businessDate)` unchanged

**Forbidden this commit:** SPA, spec pointers, contracts/HTTP/catalog.

- [ ] **Step 1: Write failing DO tests (`night-audit-auto-extend.spec.ts`)**

```typescript
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedRoomType(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomTypeId: string,
  code: string,
  roomCount = 5,
) {
  const addInput = {
    roomTypeId,
    code,
    name: code,
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor(`add-${roomTypeId}`, addInput));
  expect(added.ok).toBe(true);
  return added;
}

async function seedRate(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomTypeId: string,
  stayDate: string,
  amountMinor: number,
) {
  const input = {
    roomTypeId,
    ratePlanId: DEFAULT_RATE_PLAN_ID,
    stayDate,
    amountMinor,
    currency: 'USD',
  };
  expect(
    await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, input, await idemFor(`rate-${roomTypeId}-${stayDate}`, input)),
  ).toEqual({ ok: true });
}

async function createRoom(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomId: string,
  code: string,
  roomTypeId = 'rt_a',
) {
  const room = { roomId, roomTypeId, code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

describe('night audit — auto-extend', () => {
  it('1: default config; checked_in due out D+1 → extends to D+2; posts ROOM for D', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);
    const extended = addDays(d, 2);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(extended);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore + 1);

    const roomLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
    );
    expect(roomLines).toHaveLength(1);

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    expect(audit.ok).toBe(true);
    const rows = (audit as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> }).rows;
    const mod = rows.find((r) => r.commandId === 'reservations.modify');
    expect(mod?.afterJson).toMatchObject({ automated: true, departureDate: extended });
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['reservation.modified', 'availability.changed']),
    );
  });

  it('2: config false → departure unchanged; no sold increment on D+1', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_extend',
      false,
      { reason: 'test:hold-extend' },
      await idemFor('cfg-ae-off', { key: 'pms.night_audit.auto_extend', value: false }),
    );

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
  });

  it('3: confirmed due out D+1 → not extended', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'confirmed',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
  });

  it('4: no availability on D+1 → skip extend; POST still posts ROOM for D', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA', 1);
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);

    const stopSell = {
      roomTypeId: 'rt_a',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: dueOut,
      minLos: null,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: true,
    };
    expect(
      await stub.tryUpsertRestrictionDay(TEST_OWNER_ACTOR, stopSell, await idemFor('stop-ae4', stopSell)),
    ).toMatchObject({ ok: true });

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter(
        (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
      ),
    ).toHaveLength(1);
  });

  it('5: assigned room OOO on D+1 → skip extend; COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await createRoom(stub, 'rm_ae5', '101', 'rt_a');

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
      roomId: 'rm_ae5',
    });

    expect(
      await stub.trySetOooRange(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_ae5', startDate: dueOut, endDate: addCalendarDays(dueOut, 1) },
        await idemFor('ooo-ae5', { roomId: 'rm_ae5', startDate: dueOut }),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect(read.ok && read.reservation.roomId).toBe('rm_ae5');
  });

  it('6: rerun POST_ROOM_CHARGES same D after extend → idempotent', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-6-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);
    const extended = addDays(d, 2);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const soldAfterFirst = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldAfterFirst);

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(extended);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter(
        (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
      ),
    ).toHaveLength(1);
  });

  it('7: NIGHT_AUDIT_STEPS pin — length 8; [3] AUTO_TRANSFER; no AUTO_EXTEND', async () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');
    expect(NIGHT_AUDIT_STEPS.includes('AUTO_EXTEND' as (typeof NIGHT_AUDIT_STEPS)[number])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-extend.spec.ts
```

Expected: **FAIL** — `runAutoExtendSync` / config branch missing (cases **1**, **4**, **5**, **6** fail; case **7** passes; cases **2**/**3** may pass incidentally until helper lands).

- [ ] **Step 3: Implement `runAutoExtendSync` + `POST_ROOM_CHARGES` branch**

Add helper before `runAutoTransferSync` (~3067). **Verify `commitSoldNightsSync` signature in-tree before writing** — today at ~6848:

```typescript
private commitSoldNightsSync(
  roomTypeId: string,
  arrivalDate: string,
  departureDate: string,
  nights: string[],
): void
```

Helper (mirror modify same-SKU extend outbox/audit; catch skip errors only):

```typescript
  private runAutoExtendSync(businessDate: string): { extendedCount: number; skippedCount: number } {
    const dueOutDate = enumerateFromDate(businessDate, 2)[1]!;
    const candidates = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, allocated_room_type_id, arrival_date, departure_date,
                rate_plan_id, guest_ref, pii_key_id, room_id
         FROM reservation
         WHERE status = 'checked_in' AND departure_date = ?
         ORDER BY reservation_id ASC`,
        dueOutDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
      arrival_date: string;
      departure_date: string;
      rate_plan_id: string;
      guest_ref: string;
      pii_key_id: string;
      room_id: string | null;
    }>;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    let extendedCount = 0;
    let skippedCount = 0;

    for (const reservation of candidates) {
      const newDeparture = enumerateFromDate(reservation.departure_date, 2)[1]!;
      const addedNight = dueOutDate;
      const allocatedId = reservation.allocated_room_type_id || reservation.room_type_id;
      const oldNights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
      const newNights = enumerateStayDates(reservation.arrival_date, newDeparture);

      if (reservation.room_id) {
        try {
          this.assertRoomAssignableSync(reservation.room_id, {
            reservationId: reservation.reservation_id,
            allocatedRoomTypeId: allocatedId,
            arrivalDate: reservation.arrival_date,
            departureDate: newDeparture,
          });
        } catch {
          skippedCount++;
          continue;
        }
      }

      try {
        this.commitSoldNightsSync(allocatedId, reservation.arrival_date, newDeparture, [addedNight]);
      } catch (e) {
        if (
          e instanceof NoAvailabilityError ||
          e instanceof UnbookableError ||
          e instanceof RestrictionViolatedError
        ) {
          skippedCount++;
          continue;
        }
        throw e;
      }

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET departure_date = ?, updated_at = ? WHERE reservation_id = ?`,
        newDeparture,
        now,
        reservation.reservation_id,
      );

      this.syncReservationRateNightsOnModifySync(
        reservation.reservation_id,
        reservation.room_type_id,
        reservation.rate_plan_id,
        oldNights,
        newNights,
      );

      const ariVersion = this.bumpAriVersionSync();
      const unionFrom = oldNights[0]! < newNights[0]! ? oldNights[0]! : newNights[0]!;
      const unionTo =
        oldNights[oldNights.length - 1]! > newNights[newNights.length - 1]!
          ? oldNights[oldNights.length - 1]!
          : newNights[newNights.length - 1]!;

      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'reservation.modified',
        payload: {
          propertyId,
          reservationId: reservation.reservation_id,
          guestRef: reservation.guest_ref,
          piiKeyId: reservation.pii_key_id,
          from: {
            roomTypeId: reservation.room_type_id,
            arrivalDate: reservation.arrival_date,
            departureDate: reservation.departure_date,
          },
          to: {
            roomTypeId: reservation.room_type_id,
            arrivalDate: reservation.arrival_date,
            departureDate: newDeparture,
          },
        },
      });

      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: {
          propertyId,
          roomTypeId: allocatedId,
          fromDate: unionFrom,
          toDate: unionTo,
          version: ariVersion,
        },
      });

      this.appendAuditLogSync({
        actor: this.auditActorSync({ kind: 'system', reason: 'night_audit' }),
        commandId: 'reservations.modify',
        entityType: 'reservation',
        entityId: reservation.reservation_id,
        beforeJson: {
          roomTypeId: reservation.room_type_id,
          arrivalDate: reservation.arrival_date,
          departureDate: reservation.departure_date,
        },
        afterJson: {
          roomTypeId: reservation.room_type_id,
          arrivalDate: reservation.arrival_date,
          departureDate: newDeparture,
          automated: true,
        },
        reservationId: reservation.reservation_id,
      });

      extendedCount++;
    }

    return { extendedCount, skippedCount };
  }
```

Replace `POST_ROOM_CHARGES` branch (~2637–2638):

```typescript
        } else if (step === 'POST_ROOM_CHARGES') {
          if (this.readConfigValueSync('pms.night_audit.auto_extend') === true) {
            this.runAutoExtendSync(businessDate);
          }
          this.postRoomChargesSync(businessDate);
```

- [ ] **Step 4: Run auto-extend + room-charges regression**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-extend.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "31:|37:"
```

Expected: **PASS** — case **31** step-count pin and case **37** `no_post` behaviour unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/night-audit-auto-extend.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): night-audit auto-extend inside POST_ROOM_CHARGES

EOF
)"
```

---

### Task 2: SPA — Settings auto-extend hint + RTL

**Spec:** §2 Lock 4, §7 SPA **8**.

**Files:**
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` (~478–483)
- Modify: `apps/web-pms/src/screens/SettingsScreen.test.tsx` (add case **8** after ~141)

**Interfaces:**
- Consumes: Task 1 server behaviour (no client-core changes).

**Forbidden this commit:** DO/HTTP/contracts, spec pointers, `@hospai/client-core` rebuild.

**`SettingsScreen.tsx` — add `hint` on existing Auto extend `DomainBool`:**

```tsx
          <DomainBool
            label="Auto extend"
            configKey="pms.night_audit.auto_extend"
            initial={lookup(keys, 'pms.night_audit.auto_extend')}
            hint="When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available."
            {...common}
          />
```

- [ ] **Step 1: Write failing RTL test**

Add after the existing `toggles auto_extend with reason` case (~128–141):

```typescript
  it('8: shows auto_extend consumer hint', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auto extend')).toBeTruthy();
    expect(
      screen.getByText(
        'When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available.',
      ),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run RTL test to verify it fails**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_extend consumer hint|toggles auto_extend"
```

Expected: **FAIL** — hint string not rendered.

- [ ] **Step 3: Implement Settings hint**

Apply normative `hint` prop above. Keep existing toggle test green.

- [ ] **Step 4: Re-run RTL + color check**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_extend"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/SettingsScreen.tsx \
  apps/web-pms/src/screens/SettingsScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): night-audit auto-extend settings hint

EOF
)"
```

---

### Task 3: Spec pointers, register pin, full CI (LAST)

**Spec:** §9 checklist, §8 leftovers pointers, D6 reviewer locks.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` — §12 item **4** ~564
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — §8.1 ~316 + §19 item **16** ~553
- Modify: `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` — §8 item **5** ~274
- Modify: `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` — tick §9
- Modify: `docs/superpowers/plans/2026-08-15-night-audit-auto-extend.md` — Task 3 checkboxes (this file)

**Pointer sentences (normative):**

Night-audit E2E §12 item **4** (~564):

> ~~**`pms.night_audit.auto_extend`** — Settings can display/edit … the 7-step machine still does not read it.~~ **Closed** in [2026-08-15 night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md): `POST_ROOM_CHARGES` reads `pms.night_audit.auto_extend` and runs `runAutoExtendSync` before `postRoomChargesSync`.

Property-setup §8.1 (~316):

> ~~Still no night-audit reader.~~ **`pms.night_audit.auto_extend`** consumer: [2026-08-15 night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md) (`runAutoExtendSync` inside `POST_ROOM_CHARGES`).

Property-setup §19 item **16** (~553):

> ~~`auto_extend` consumer remains deferred.~~ **Closed** for `auto_extend` in [2026-08-15 night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md). `auto_assign_rooms` closed separately in [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md).

Auto-assign §8 item **5** (~274):

> ~~**`auto_extend` consumer** — Night-audit leftover — unrelated~~ **Closed** in [2026-08-15 night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md).

- [x] **Step 1: Pin frozen heads (register + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-extend.spec.ts -t "7:"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "31:"
```

Expect: catalog **79**; writers **54**; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 8`; `[3] === 'AUTO_TRANSFER'`; no `AUTO_EXTEND`.

- [x] **Step 2: Targeted test superset (spec §7)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-extend.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "31:|37:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_extend"
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
```

Expected: **PASS**.

- [x] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

```bash
pnpm build
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
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures. Do **not** run unsharded `pnpm --filter @hospai/pms-core test`.

- [x] **Step 4: Apply doc pointers + tick spec §9 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` §9.

- [x] **Step 5: Tick Task 3 checkboxes in this plan**

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md \
  docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md \
  docs/superpowers/plans/2026-08-15-night-audit-auto-extend.md
git commit -m "$(cat <<'EOF'
docs: close night-audit auto_extend consumer leftovers

EOF
)"
```

**Stop.** Multi-night extend, desk/CRS extend, confirmed no-show extend, smarter heuristics, and recurring/breakfast in POST stay deferred per spec §1.3 / §8.

---

## Spec §9 reviewer checklist (Task 3 ticks these in the spec file when CI is green)

| §9 item | Satisfied by |
|---|---|
| `runAutoExtendSync` Lock 2–3 | Task 1 |
| `POST_ROOM_CHARGES` config gate Lock 1 | Task 1 |
| Reuse sold/assign/snapshot + outbox/audit | Task 1 |
| Settings hint + test case **8** | Task 2 |
| DO tests §7 **1–7**; register pins unchanged | Task 1 + 3 |
| `pnpm check:web-pms-colors` | Task 2 + 3 |
| Bidirectional pointers | Task 3 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–5) | 1–3 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–5 | 1–3 |
| §3 commands / HTTP unchanged | forbidden |
| §4 schema none | forbidden |
| §5 errors (existing only) | 1 |
| §6 file map | 1–3 |
| §7 tests DO **1–7**, SPA **8**, register pin | 1–3 |
| §8 leftovers named | Task 3 pointers; items 1–6 stay deferred |
| §9 checklist | 3 |
| Heads table §1.1 | 3 (unchanged) |
| D-locks 1–6 | Open decisions |

**Gaps:** None — all §7 numbered cases and §9 checklist items map to Tasks 1–3.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 3 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §10). Verified: `POST_ROOM_CHARGES` today calls only `postRoomChargesSync` (~2637–2638); `commitSoldNightsSync(roomTypeId, arrivalDate, departureDate, nights)` at ~6848; `pms.night_audit.auto_extend` already DOMAIN + default `true`; `reservations.modify` in audit writers; `[131]`/`[128]`/`[127]` pins match frozen heads; `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1067); `tryModifyReservation` rejects `checked_in` (~7733–7738) — helper must stay internal sync, not RPC.
