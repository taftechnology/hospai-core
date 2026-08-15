# Auto-assign rooms at check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-14)

**Goal:** Wire the only consumer for `pms.ops.auto_assign_rooms`: when config is on and check-in has no explicit or pre-assigned room, `tryCheckIn` deterministically picks the lowest `room.code` of the booked physical type that passes the same assignability/cleanliness gates as explicit check-in; SPA makes room optional and updates Settings copy.

**Architecture:** No new catalog command, HTTP route, or migration. Resolution order inside `tryCheckIn` becomes `input.roomId` → `reservation.room_id` → config-gated `pickAutoAssignRoomSync` → `ROOM_REQUIRED`. Pick reuses `assertRoomAssignableSync` (skip on throw) plus the cleanliness/inspection predicates already in `tryCheckIn`. Auto-pick runs the existing assign-at-check-in block and sets `afterJson.autoAssigned: true` on the check-in audit row.

**Tech Stack:** PropertyDO + sqlite, `@hospai/contracts` (unchanged catalog/HTTP), vitest Worker specs (`provisionedPropertyStub`, local helpers from `reservations-check-in.spec.ts`), web-pms RTL.

**Spec:** `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` (Approved). Spec commit: `90f4896`.

---

## Sequencing gate (read before starting)

This slice closes **reservation lifecycle leftover 3** (`pms.ops.auto_assign_rooms` consumer), **property-setup leftover 16** (auto-assign consumer), **rooms-housekeeping §2.4** deferred auto-assign, and **room-ops leftover 11**.

| After this plan | Do not start |
|---|---|
| Config-gated pick inside `tryCheckIn` only | Auto-assign at booking / confirm / modify / night audit / `assign_room` |
| Lowest `code` deterministic pick | Smarter heuristics (floor, VIP, adjoining) |
| Optional room on `CheckInScreen` | `listDomainConfig` reads on check-in screen |
| Settings hint reflects live consumer | Consuming `auto_assign_rule` / `auto_assign_rooming` |
| `afterJson.autoAssigned: true` on pick | New wire codes or catalog ids |
| — | New HTTP routes / schema migration |
| — | Promoting check-in to `FAIL_CLOSED` |
| — | Moving catalog **79** / HTTP `[131]` / `NIGHT_AUDIT_STEPS` **8** |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **79**. `AUDIT_WRITER_COMMAND_IDS.size` **54**. Last HTTP `[131] post_folio_routing_rule_archive`. `[128] post_folio_stay_discount` and `[127] post_demo_seed` **unmoved**. `PROPERTY_SCHEMA_HEAD` **28**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`. **No** catalog command, HTTP route, or migration in this chunk.

### D2 — Resolution order (spec Lock 1)

**Locked:** Consumer **only** in `tryCheckIn` (~8158). Order: `input.roomId` → `reservation.room_id` → if `readConfigValueSync('pms.ops.auto_assign_rooms') === true` run pick → else `ROOM_REQUIRED`. Same command `reservations.check_in`. Fingerprint unchanged `{ reservationId, roomId?, overrideCleanliness? }`. Keep `QUEUE_PROVISIONAL`. Do **not** auto-assign outside check-in.

### D3 — Pick algorithm (spec Lock 2)

**Locked:** Private `pickAutoAssignRoomSync(reservation, input)`. Query `room` where `room_type_id = (allocated_room_type_id || room_type_id)`, `ORDER BY code ASC`. Skip candidates failing the same gates as explicit check-in (`assertRoomAssignableSync`; dirty+strict without override; `require_inspection`+strict+clean without override). First win; none → `null` → step 4 `ROOM_REQUIRED`. No new wire code. When pick assigns, reuse assign-at-check-in block (~8161–8188); emit `reservation.room_assigned`; audit `afterJson.autoAssigned: true`.

### D4 — Config register (spec Lock 3)

**Locked:** Keep `pms.ops.auto_assign_rooms` as **DOMAIN + `consumersExempt: true`**. Default **`true`**. Config **`false`** via `tryPutDomainConfig` → pick skipped → `ROOM_REQUIRED` when no explicit/pre-assigned room. Do **not** consume sibling `auto_assign_rule` / `auto_assign_rooming`.

### D5 — SPA (spec Lock 4)

**Locked:** `CheckInScreen`: room optional; `canCheckIn = !checkIn.isPending` only; omit `roomId` from `api.checkIn` when blank; copy **“Leave blank to auto-assign a vacant room of the booked type.”** Settings hint **“When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready.”** Do **not** rebuild `@hospai/client-core` (already omits undefined `roomId`).

### D6 — Case 23 split (spec §7 / reviewer)

**Locked:** `reservations-check-in.spec.ts` case **23**: default config **true**, **zero** `room` rows → still `ROOM_REQUIRED` (zero candidates). One-line comment only in that file if needed. Config **`false`** case lives in **`reservations-auto-assign.spec.ts`** case **4**, not case 23.

### D7 — Test discipline

**Locked:** Fixture ids via `crypto.randomUUID()`. Copy local helpers from `reservations-check-in.spec.ts` into new `reservations-auto-assign.spec.ts`. **Do not** `vi.spyOn` into the DO isolate. **Do not** invent `provisionedPropertyWorker`. File-filter vitest; `--shard=N/8` with **no `--` before `--shard`**. Workerd 503: retry that shard once. Do not `|| true`. Never unsharded pms-core test.

### D8 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts`** before pms-core tests only if contracts change (this chunk should **not** touch contracts).
2. **Rebuild `@hospai/client-core`** before web-pms tests only if client changes (Task 2 should **not**).
3. **Register pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — asserts catalog **79**, writers **54**, `[131]` last, `[128]`/`[127]` unmoved; `NIGHT_AUDIT_STEPS.length === 8`.
4. **`pnpm check:web-pms-colors`** when SPA files touched (Task 2).
5. **Do not `|| true` CI failures.** Workerd 503 on a shard: retry that shard once.
6. **Bidirectional pointers** (lifecycle §4.1 + leftover **3**; property-setup §8 + leftover **16**; rooms-housekeeping §2.4; room-ops leftover **11**) — **Task 3 only**, plus tick spec §9 and plan Task 3 checkboxes there.
7. Living plan checkboxes: tick `- [x]` on **Task 3 only** at implementation time.
8. **Spec/plan writers do not commit; implementers commit per task.**
9. **`V1_ROUTES` / catalog / schema untouched.**

---

## Global Constraints

- **Same command:** `reservations.check_in` stays `QUEUE_PROVISIONAL`, entitlement-ungated; fingerprint excludes picked id.
- **No new wire codes.** Zero eligible candidates → existing `ROOM_REQUIRED`.
- **Virtual types:** pick matches **`allocated_room_type_id`** (physical), not sold virtual SKU.
- **Replay:** same `tryCheckIn` body; config at replay time governs pick.
- **`pnpm check:web-pms-colors`** if SPA files touched (Task 2).
- **Fixture discipline:** `crypto.randomUUID()` in shared-storage tests; `check:pms-core-test-dates` green after Task 1.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/src/property-do.ts` | `pickAutoAssignRoomSync`; Lock 1 resolution in `tryCheckIn`; audit `autoAssigned` | 1 |
| `apps/pms-core/test/reservations-auto-assign.spec.ts` | DO cases §7 **1–8** (new) | 1 |
| `apps/pms-core/test/reservations-check-in.spec.ts` | Case **23** one-line comment only (if needed); cases **24–30** regression | 1 |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Optional room, copy, `canCheckIn`, omit `roomId` | 2 |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | Update case **53** explicit path; add blank-room case **9** | 2 |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | `auto_assign_rooms` hint copy | 2 |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | Assert new hint (case **10**) | 2 |
| `ARCHITECTURE.md` | §7.1 one-liner (auto-pick when config on) | 3 |
| `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` | Close leftover **3**; amend §4.1 | 3 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close §8 unread + leftover **16** | 3 |
| `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md` | Close §2.4 deferred sentence | 3 |
| `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` | Close leftover **11** | 3 |
| `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` | Tick §9 checklist | 3 |
| `docs/superpowers/plans/2026-08-14-auto-assign-rooms.md` | Task 3 checkboxes (this file) | 3 |

**Not touched:** `packages/contracts/src/commands/catalog.ts`, `v1-http-routes.ts`, `v1-dispatch.ts`, `packages/client-core/src/api.ts`, `config/register.ts`, migrations, `NIGHT_AUDIT_STEPS`, demo seed, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`.

---

## Spec §1.2 / §9 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) `tryCheckIn` resolution order | 1 |
| §1.2 (2) `pickAutoAssignRoomSync` | 1 |
| §1.2 (3) Audit / outbox on pick | 1 |
| §1.2 (4) `CheckInScreen` optional room | 2 |
| §1.2 (5) Settings hint | 2 |
| §7 DO **1–8** | 1 |
| §7 SPA **9–10** | 2 |
| §7 register pins | 3 |
| §9 checklist + bidirectional pointers | 3 |
| §1.3 scope out | forbidden all |

---

### Task 1: DO — `pickAutoAssignRoomSync` + `tryCheckIn` resolution + tests

**Spec:** §2 Locks 1–2, §5 errors, §7 DO **1–8**; D6 case 23 split.

**Files:**
- Create: `apps/pms-core/test/reservations-auto-assign.spec.ts`
- Modify: `apps/pms-core/src/property-do.ts` — `pickAutoAssignRoomSync` + `tryCheckIn` ~8158–8265
- Modify (comment only): `apps/pms-core/test/reservations-check-in.spec.ts` — case **23** comment if needed

**Interfaces:**
- Produces: `private pickAutoAssignRoomSync(reservation, input): string | null` — returns first eligible `room_id` or `null`.
- Produces: `tryCheckIn` resolution steps 1–4; `afterJson.autoAssigned: true` when pick wrote `room_id` this txn.

**Forbidden this commit:** SPA, spec pointers, contracts/HTTP/catalog, `ARCHITECTURE.md`.

- [ ] **Step 1: Write failing DO tests (`reservations-auto-assign.spec.ts`)**

Copy helpers from `reservations-check-in.spec.ts` (`provisionedPropertyWithGuest`, `addRoomType`, `createRoom`, `bookConfirmed`; import `idemFor` from `./guest-helpers`). For case **7**, also copy/adapt virtual seed helpers from `virtual-check-in.spec.ts` (`seedKingQueenRoh`, `createPhysicalRoom`, `addDays`).

```typescript
import { describe, expect, it } from 'vitest';
import {
  ROOM_ALREADY_ASSIGNED,
  ROOM_REQUIRED,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{ stub: DurableObjectStub<PropertyDO>; guestRef: string }> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef };
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function createRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
  code: string,
  roomTypeId = 'rt_king',
) {
  const room = { roomId, roomTypeId, code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

async function bookConfirmed(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  arrival: string,
  departure: string,
  roomTypeId = 'rt_king',
) {
  const create = {
    reservationId,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
}

describe('reservation check-in auto-assign', () => {
  it('1: default config; two clean vacant rooms → picks lowest code', async () => {
    const name = `aa-1-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_201', '201');
    await createRoom(stub, 'rm_101', '101');
    await bookConfirmed(stub, guestRef, 'res_aa1', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa1' },
      await idemFor('aa1', { reservationId: 'res_aa1' }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_aa1')).toBe('checked_in');
    const read = await stub.readReservation('res_aa1');
    expect(read.ok && read.reservation.roomId).toBe('rm_101');
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_aa1' });
    expect(audit.ok).toBe(true);
    const rows = (audit as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> }).rows;
    const ci = rows.find((r) => r.commandId === 'reservations.check_in');
    expect(ci?.afterJson).toMatchObject({ autoAssigned: true, roomId: 'rm_101' });
    expect(await stub.listOutboxEventTypes()).toContain('reservation.room_assigned');
  });

  it('2: explicit roomId wins over lower-code vacant room', async () => {
    const name = `aa-2-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await createRoom(stub, 'rm_201', '201');
    await bookConfirmed(stub, guestRef, 'res_aa2', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa2', roomId: 'rm_201' },
      await idemFor('aa2', { reservationId: 'res_aa2', roomId: 'rm_201' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa2');
    expect(read.ok && read.reservation.roomId).toBe('rm_201');
  });

  it('3: pre-assigned room wins; no second room_assigned on check-in', async () => {
    const name = `aa-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await createRoom(stub, 'rm_201', '201');
    await bookConfirmed(stub, guestRef, 'res_aa3', arrival, departure);
    const assign = { reservationId: 'res_aa3', roomId: 'rm_201' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('as-aa3', assign)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa3' },
      await idemFor('aa3', { reservationId: 'res_aa3' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa3');
    expect(read.ok && read.reservation.roomId).toBe('rm_201');
    expect((await stub.listOutboxEventTypes()).filter((t) => t === 'reservation.room_assigned')).toHaveLength(1);
  });

  it('4: config false → ROOM_REQUIRED; stays confirmed', async () => {
    const name = `aa-4-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.ops.auto_assign_rooms',
      false,
      { reason: 'test:explicit-only' },
      await idemFor('cfg-aa4', { key: 'pms.ops.auto_assign_rooms', value: false }),
    );
    await bookConfirmed(stub, guestRef, 'res_aa4', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa4' },
      await idemFor('aa4', { reservationId: 'res_aa4' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_REQUIRED });
    expect(await stub.getReservationStatus('res_aa4')).toBe('confirmed');
  });

  it('5: only dirty rooms + strict cleanliness → ROOM_REQUIRED', async () => {
    const name = `aa-5-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_dirty', '101');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_dirty', status: 'dirty' },
        await idemFor('dirty-aa5', { roomId: 'rm_dirty', status: 'dirty' }),
      ),
    ).toMatchObject({ ok: true });
    await bookConfirmed(stub, guestRef, 'res_aa5', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa5' },
      await idemFor('aa5', { reservationId: 'res_aa5' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_REQUIRED });
  });

  it('6: occupied room skipped; next eligible picked', async () => {
    const name = `aa-6-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_occ', '101');
    await createRoom(stub, 'rm_free', '201');
    await bookConfirmed(stub, guestRef, 'res_aa6a', arrival, departure);
    await bookConfirmed(stub, guestRef, 'res_aa6b', arrival, departure);
    const assignOcc = { reservationId: 'res_aa6a', roomId: 'rm_occ' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignOcc, await idemFor('as-aa6a', assignOcc)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa6b' },
      await idemFor('aa6b', { reservationId: 'res_aa6b' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa6b');
    expect(read.ok && read.reservation.roomId).toBe('rm_free');
  });

  it('7: virtual ROH reservation picks allocated physical type only', async () => {
    const name = `aa-7-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const kingInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 1,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const king = await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king-aa7', kingInput));
    expect(king).toMatchObject({ ok: true });
    if (!king.ok) throw new Error('add king failed');
    const arrival = king.fromDate;
    const queenInput = {
      roomTypeId: 'rt_queen',
      code: 'QUEEN',
      name: 'Queen Room',
      roomCount: 1,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect(
      await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen-aa7', queenInput)),
    ).toMatchObject({ ok: true });
    const rohInput = {
      roomTypeId: 'rt_roh',
      code: 'ROH',
      name: 'Run of House',
      kind: 'virtual' as const,
      maxOccupancy: 2,
      maxAdults: 2,
      constituentRoomTypeIds: ['rt_king', 'rt_queen'],
    };
    expect(
      await stub.tryAddRoomType(TEST_OWNER_ACTOR, rohInput, await idemFor('add-roh-aa7', rohInput)),
    ).toMatchObject({ ok: true });
    await seedBarRatesForHorizon(stub, 'rt_roh', arrival);
    await seedBarRatesForHorizon(stub, 'rt_king', arrival);
    await seedBarRatesForHorizon(stub, 'rt_queen', arrival);
    await createRoom(stub, 'rm_king', '101', 'rt_king');
    await createRoom(stub, 'rm_queen', '102', 'rt_queen');
    const book = {
      reservationId: 'res_aa7',
      roomTypeId: 'rt_roh',
      guestRef,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-aa7', book)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa7' },
      await idemFor('aa7', { reservationId: 'res_aa7' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa7');
    expect(read.ok && read.reservation.allocatedRoomTypeId).toBe('rt_king');
    expect(read.ok && read.reservation.roomId).toBe('rm_king');
    expect(read.ok && read.reservation.roomId).not.toBe('rm_queen');
  });

  it('8: explicit wrong-type check-in still ROOM_ALREADY_ASSIGNED / overlap paths unchanged', async () => {
    const name = `aa-8-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_29', '106');
    await bookConfirmed(stub, guestRef, 'res_aa8a', arrival, departure);
    await bookConfirmed(stub, guestRef, 'res_aa8b', arrival, departure);
    const assignA = { reservationId: 'res_aa8a', roomId: 'rm_29' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignA, await idemFor('as-aa8a', assignA)),
    ).toMatchObject({ ok: true });
    const overlap = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa8b', roomId: 'rm_29' },
      await idemFor('aa8-overlap', { reservationId: 'res_aa8b', roomId: 'rm_29' }),
    );
    expect(overlap).toMatchObject({ ok: false, error: ROOM_ALREADY_ASSIGNED });
  });
});
```

Optional one-line comment on case **23** in `reservations-check-in.spec.ts`:

```typescript
  // Default auto_assign_rooms=true but zero room rows → zero pick candidates → ROOM_REQUIRED.
  it('23. check-in confirmed, no room_id, no payload → ROOM_REQUIRED', async () => {
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-auto-assign.spec.ts
```

Expected: **FAIL** — pick helper / resolution branch missing (cases **1**, **4**, **5**, **6**, **7** fail; **2**/**3** may pass incidentally until resolution changes).

- [ ] **Step 3: Implement `pickAutoAssignRoomSync` + `tryCheckIn` resolution**

Add private helper before `tryCheckIn` (~8094):

```typescript
  private pickAutoAssignRoomSync(
    reservation: {
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
      arrival_date: string;
      departure_date: string;
    },
    input: { overrideCleanliness?: boolean },
  ): string | null {
    const allocatedRoomTypeId = reservation.allocated_room_type_id || reservation.room_type_id;
    const candidates = this.ctx.storage.sql
      .exec(
        `SELECT room_id, status FROM room WHERE room_type_id = ? ORDER BY code ASC`,
        allocatedRoomTypeId,
      )
      .toArray() as Array<{ room_id: string; status: string }>;

    const cleanliness = this.readConfigValueSync('pms.reservations.check_in_cleanliness') ?? 'strict';
    const allowDirtyOverride =
      this.readConfigValueSync('pms.reservations.allow_dirty_check_in_override') !== false;
    const requireInspection =
      this.readConfigValueSync('pms.housekeeping.require_inspection') === true;

    for (const candidate of candidates) {
      try {
        this.assertRoomAssignableSync(candidate.room_id, {
          reservationId: reservation.reservation_id,
          allocatedRoomTypeId,
          arrivalDate: reservation.arrival_date,
          departureDate: reservation.departure_date,
        });
      } catch {
        continue;
      }
      if (
        candidate.status === 'dirty' &&
        cleanliness === 'strict' &&
        !(input.overrideCleanliness === true && allowDirtyOverride)
      ) {
        continue;
      }
      if (
        requireInspection &&
        cleanliness === 'strict' &&
        candidate.status === 'clean' &&
        !(input.overrideCleanliness === true && allowDirtyOverride)
      ) {
        continue;
      }
      return candidate.room_id;
    }
    return null;
  }
```

Replace ~8158–8159 in `tryCheckIn`:

```typescript
          let resolvedRoomId = input.roomId ?? reservation.room_id ?? null;
          let autoAssigned = false;

          if (!resolvedRoomId) {
            if (this.readConfigValueSync('pms.ops.auto_assign_rooms') === true) {
              const picked = this.pickAutoAssignRoomSync(reservation, input);
              if (picked) {
                resolvedRoomId = picked;
                autoAssigned = true;
              }
            }
          }

          if (!resolvedRoomId) throw new RoomRequiredError();
```

Extend check-in audit `afterJson` (~8259):

```typescript
            afterJson: {
              status: 'checked_in',
              roomId: resolvedRoomId,
              ...(input.overrideCleanliness ? { overrideCleanliness: true } : {}),
              ...(autoAssigned ? { autoAssigned: true } : {}),
            },
```

Leave assign-at-check-in block (~8161–8188) and downstream cleanliness gate unchanged — pick skips ineligible rooms; final gate still runs on `resolvedRoomId`.

- [ ] **Step 4: Run auto-assign + check-in regression**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-auto-assign.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-in.spec.ts -t "23\\.|24\\.|25\\.|26\\.|27\\.|28\\.|29\\.|30\\."
```

Expected: **PASS** — case **23** still `ROOM_REQUIRED` with zero rooms; **24–30** green.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/reservations-auto-assign.spec.ts \
  apps/pms-core/test/reservations-check-in.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): auto-assign lowest room code at check-in

EOF
)"
```

---

### Task 2: SPA — optional room on CheckIn + Settings hint

**Spec:** §2 Lock 4, §7 SPA **9–10**.

**Files:**
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` (~86–93, ~120, ~151)
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx` — update case **53**; add case **9**
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` (~604–606)
- Modify: `apps/web-pms/src/screens/SettingsScreen.test.tsx` (~143–148)

**Interfaces:**
- Consumes: Task 1 server behaviour (no client-core changes).

**Forbidden this commit:** DO/HTTP/contracts, spec pointers, `@hospai/client-core` rebuild.

**`CheckInScreen.tsx` changes:**

```typescript
  const checkIn = useMutation({
    mutationFn: () =>
      api.checkIn(
        tenant.propertyId,
        reservationId,
        `checkin:${reservationId}:${roomId || 'auto'}:${overrideCleanliness ? '1' : '0'}`,
        {
          ...(roomId.trim() ? { roomId: roomId.trim() } : {}),
          ...(overrideCleanliness ? { overrideCleanliness: true } : {}),
        },
      ),
```

```typescript
  const canCheckIn = !checkIn.isPending;
```

Replace muted copy (~151):

```tsx
      <p className="muted">Leave blank to auto-assign a vacant room of the booked type.</p>
```

**`SettingsScreen.tsx` hint (~606):**

```tsx
            hint="When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready."
```

- [ ] **Step 1: Write failing RTL tests**

Update case **53** — remove “disabled without room”; keep explicit-path + `ROOM_NOT_READY` override:

```typescript
  it('53: explicit roomId sent on check-in; ROOM_NOT_READY shows override', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    checkIn.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_not_ready' },
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(screen.getByTestId('override-cleanliness')).toBeTruthy());
    expect(checkIn.mock.calls[0]?.[3]).toMatchObject({ roomId: 'rm_1' });
  });

  it('9: blank room → check-in enabled; checkIn omits roomId', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    const extra = checkIn.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(extra).toBeDefined();
    expect(extra).not.toHaveProperty('roomId');
  });
```

Update `SettingsScreen.test.tsx`:

```typescript
  it('shows auto_assign_rooms consumer copy', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auto assign rooms')).toBeTruthy();
    expect(
      screen.getByText(
        'When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready.',
      ),
    ).toBeTruthy();
  });
```

(Rename test title from `shows auto_assign_rooms unread copy` → `shows auto_assign_rooms consumer copy`.)

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx -t "53:|9:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_assign_rooms"
```

Expected: **FAIL** — old copy / disabled button / missing omit behaviour.

- [ ] **Step 3: Implement CheckIn + Settings UI**

Apply normative blocks above. Assign-room button stays `disabled={!roomId || assign.isPending}`.

- [ ] **Step 4: Re-run RTL + color check**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx -t "53:|9:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_assign_rooms"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/screens/CheckInScreen.test.tsx \
  apps/web-pms/src/screens/SettingsScreen.tsx \
  apps/web-pms/src/screens/SettingsScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): optional room on check-in; auto-assign settings hint

EOF
)"
```

---

### Task 3: Docs, spec ticks, register pin, full CI (LAST)

**Spec:** §9 checklist, §8 leftovers pointers, ARCHITECTURE §7.1 one-liner, D8 reviewer locks.

**Files:**
- Modify: `ARCHITECTURE.md` — §7.1 ~1138 (one sentence)
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` — §4.1 ~258 + §17 item **3** ~851
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — §8 Ops copy ~356 + §19 item **16** ~553
- Modify: `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md` — §2.4 ~145
- Modify: `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` — §19 item **11** ~687
- Modify: `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` — tick §9
- Modify: `docs/superpowers/plans/2026-08-14-auto-assign-rooms.md` — Task 3 checkboxes (this file)

**Pointer sentences (normative):**

Lifecycle §17 item **3** (~851):

> ~~**`pms.ops.auto_assign_rooms`** — reclassified DOMAIN + `consumersExempt`… check-in stays explicit — no consumer.~~ **Closed** in [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md): `tryCheckIn` consults `pms.ops.auto_assign_rooms` and picks lowest eligible `room.code`.

Lifecycle §4.1 (~258):

> ~~`pms.ops.auto_assign_rooms` is **not** consulted (leftover).~~ **`pms.ops.auto_assign_rooms`** is consulted as resolution step **3** when true (see [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md)).

Property-setup §8 Ops (~356):

> `pms.ops.auto_assign_rooms` — checkbox. Copy: ~~“Stored for later. Check-in still requires an explicit room.”~~ **“When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready.”** Consumer: [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md).

Property-setup §19 item **16** (~553):

> ~~Auto-extend / auto-assign **consumers** — Display/edit only~~ **Closed** for `auto_assign_rooms` in [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md). `auto_extend` consumer remains deferred.

Rooms-housekeeping §2.4 (~145):

> ~~**Rejected for this slice: auto-assignment inside `tryCheckIn`.** … treat it as its own decision once rooms exist in the field.~~ **Closed** in [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md): config-gated lowest-code pick at check-in.

Room-ops §19 item **11** (~687):

> ~~**`pms.ops.auto_assign_rooms`** — lifecycle leftover 3; unread.~~ **Closed** in [2026-08-14 auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md).

ARCHITECTURE §7.1 (~1138) — replace:

> Pre-assign is allowed; check-in without a resolved room is rejected.

with:

> Pre-assign is allowed; check-in without a resolved room is rejected unless `pms.ops.auto_assign_rooms` is on, in which case `tryCheckIn` may auto-pick the lowest eligible physical room of the booked type.

- [ ] **Step 1: Pin frozen heads (register + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 8"
```

Expect: catalog **79**; writers **54**; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 8`; `[3] === 'AUTO_TRANSFER'`.

- [ ] **Step 2: Targeted test superset (spec §7)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-auto-assign.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-in.spec.ts -t "23\\.|24\\.|25\\.|26\\.|27\\.|28\\.|29\\.|30\\."
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx -t "53:|9:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auto_assign_rooms"
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
```

Expected: **PASS**.

- [ ] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

- [ ] **Step 4: Apply doc pointers + tick spec §9 checklist**

Tick every item in `docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md` §9.

- [ ] **Step 5: Tick Task 3 checkboxes in this plan**

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md \
  docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md \
  docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md \
  docs/superpowers/specs/2026-08-14-auto-assign-rooms-design.md \
  docs/superpowers/plans/2026-08-14-auto-assign-rooms.md
git commit -m "$(cat <<'EOF'
docs: close lifecycle leftover 3 auto-assign rooms

EOF
)"
```

**Stop.** Smarter pick heuristics, auto-assign outside check-in, `auto_assign_rule` / `auto_assign_rooming` consumers, and waiting-for-room product stay deferred per spec §1.3 / §8.

---

## Spec §9 reviewer checklist (Task 3 ticks these in the spec file when CI is green)

| §9 item | Satisfied by |
|---|---|
| `tryCheckIn` resolution order Lock 1 | Task 1 |
| `pickAutoAssignRoomSync` | Task 1 |
| Reuse assign-at-check-in + `room_assigned` | Task 1 |
| Audit `autoAssigned: true` | Task 1 |
| `CheckInScreen` optional room + RTL case **9** | Task 2 |
| Settings hint + test case **10** | Task 2 |
| DO tests §7 **1–8**; case **23** zero-room regression | Task 1 |
| Register pins unchanged | Task 3 |
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
| §7 tests DO **1–8**, SPA **9–10**, register pin | 1–3 |
| §8 leftovers named | Task 3 pointers; items 1–5 stay deferred |
| §9 checklist | 3 |
| Heads table §1.1 | 3 (unchanged) |
| D-locks 1–8 | Open decisions |

**Gaps:** None — all §7 numbered cases and §9 checklist items map to Tasks 1–3.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 3 Step 3 pastes full `checks` job + 8 shards.

**Tree conflicts:** None (spec §10). Verified: `tryCheckIn` throws at ~8158–8159 today; `pms.ops.auto_assign_rooms` already DOMAIN + default `true`; catalog **79** / `[131]` / `NIGHT_AUDIT_STEPS` **8** match frozen heads.
