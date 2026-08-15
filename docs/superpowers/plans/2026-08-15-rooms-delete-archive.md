# Rooms delete — physical-unit archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15).

**Goal:** Soft-archive physical room units via `rooms.delete` / `DELETE /rooms/:id`: set `archived_at`, free a live `room_count` slot without touching sellable `physical`, with catalog/HTTP/SPA/tests and register pins at frozen heads.

**Architecture:** v29 adds `room.archived_at` + partial unique index on live codes. `tryDeleteRoom` mirrors `tryDeleteRoomType` guards (live reservations + future OOO) but skips ARI/`availability.changed`. Live-count gates and operator-facing reads filter `archived_at IS NULL`; id lookups by `room_id` for history stay unfiltered. Catalog `rooms.delete` appends after `reservations.update_extras`; HTTP `[132] delete_room` appends after `[131]`.

**Tech Stack:** PropertyDO + sqlite (`packages/do-runtime`), `@hospai/contracts`, vitest Worker specs (`provisionedPropertyStub`, `idemFor`, `daysFromPropertyToday`), web-pms RTL.

**Spec:** `docs/superpowers/specs/2026-08-15-rooms-delete-archive-design.md` (Approved).

---

## Sequencing gate (read before starting)

This slice closes rooms-vertical scope-out `rooms.delete`, room-operations leftover **6**, property-setup leftover **3**, and names night-audit auto-extend leftover **6** (no night-audit code).

| After this plan | Do not start |
|---|---|
| `PROPERTY_SCHEMA_HEAD` **29** (`room.archived_at`) | SQL `DELETE FROM room`; `room.status = archived` |
| `COMMAND_CATALOG` length **80** (`rooms.delete` at end) | Inserting `rooms.delete` in `rooms.*` cluster |
| `AUDIT_WRITER_COMMAND_IDS.size` **55** | New `export class` / `CLASS_DENYLIST` edit |
| HTTP `[132] delete_room` after `[131]` | Moving `[131]` / `[128]` / `[127]` |
| Live-count + reader filters (Lock 5) | `includeArchived` on GET; un-archive |
| SPA archive on inventory rooms tab | Auto-decrement `room_count` / `physical` |
| — | 9th night-audit step; `availability.changed` on archive |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **80** (`rooms.delete` appended after `reservations.update_extras`). `AUDIT_WRITER_COMMAND_IDS.size` **55** (pins ~268 and ~663). HTTP `[132] delete_room` appended after `[131] post_folio_routing_rule_archive`; `[131]`/`[128]`/`[127]` **unmoved**. `PROPERTY_SCHEMA_HEAD` **29**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — Archive semantics (spec Locks 1–2)

**Locked:** `archived_at INTEGER NULL`; partial unique `room_code_live_uidx`. Live count: `COUNT(*) … AND archived_at IS NULL` in create cap and lower-`room_count` gate. Code uniqueness: live-only `SELECT … WHERE code = ? AND archived_at IS NULL`. No `availability.changed`; no `physical` change. Archived codes reusable.

### D3 — Command / HTTP (spec Lock 3)

**Locked:** Catalog id `rooms.delete`; `prototypeAction: null`; `FAIL_CLOSED`; events `['room.archived']` only. HTTP `DELETE /v1/properties/:propertyId/rooms/:roomId`; route id `delete_room`; handler mirrors `handleDeleteRoomType` (~973–1025): header idempotency; fingerprint `{ roomId }`; `NOT_FOUND`→404; `ARCHIVE_BLOCKED`→**409** `{ ok: false, error: 'archive_blocked' }`; missing key 400; success 200 `{ ok: true, roomId }`. Client `archiveRoom` parallel to `archiveRoomType` (~1579–1588).

### D4 — `tryDeleteRoom` (spec Lock 4)

**Locked:** Block on live reservation `status IN ('inquiry','pending','confirmed','checked_in')` OR `room_ooo` with `end_date > today`. Success txn: `UPDATE room SET archived_at`; `DELETE FROM housekeeping_assignment WHERE room_id = ? AND business_date >= ?`; outbox `room.archived`; audit `rooms.delete`. Reuse private `ArchiveBlockedError` / `RoomNotFoundError` — **no new export class**.

### D5 — Reader/writer filters (spec Lock 5)

**Locked:** Filter `archived_at IS NULL` in `listRooms`, `readFrontOfficeTape` (~9562), `listAvailableRooms` (~9713), `readFrontOfficeSummary` sellable (~9803), `assertRoomAssignableSync`, `pickAutoAssignRoomSync`, `tryUpdateRoom`, status/OOO writers. **Do not** filter `selectFrontOfficeRoomSync` (~9990) or `syncOooStatusForRoomSync` (~5836). Purge census `(SELECT COUNT(*) FROM room)` ~1259 stays unfiltered.

### D6 — SPA copy (spec Lock 6)

**Locked:** Confirm exactly: `Archive {code}? It will free a unit slot. History stays.` Separate `roomArchiveTarget` state from type archive. `room_units_exceed_count`: `Cannot lower room count below the number of live rooms. Archive extra units first.` `archive_blocked` branches on mutation context (room vs type).

### D7 — Test / CI discipline

**Locked:** DO cases 1–8 in `rooms.spec.ts`; HTTP DELETE matrix in `rooms-routes.spec.ts`. Fixture ids via `crypto.randomUUID()`. **Do not** `vi.spyOn` into the DO isolate. Rebuild `@hospai/contracts` before pms-core tests after Task 2. Rebuild `@hospai/client-core` before web-pms tests after Task 3/4. File-filter vitest; `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard once. Never `|| true`. Never unsharded pms-core test. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D8 — Reviewer workflow

Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 5 only** at implementation time. Bidirectional pointers — **Task 5 only**.

---

## Global Constraints

- **`NIGHT_AUDIT_STEPS` length stays 8** — no 9th step; `[3] === 'AUTO_TRANSFER'`.
- **No SQL `DELETE FROM room`** — archive via `archived_at` only.
- **No `availability.changed` on room archive** — assignment layer unchanged (same as `rooms.create`).
- **No auto-decrement** of `room_type.room_count` or `availability_day.physical`.
- **No un-archive**, **no `includeArchived`**, **no `archivedAt` on list DTO**.
- **No new wire error code** — reuse `ARCHIVE_BLOCKED` / `archive_blocked`.
- **No new `export class`** — reuse private `ArchiveBlockedError` / `RoomNotFoundError` in `property-do.ts`.
- **Catalog append at end** after `reservations.update_extras` (~883) — not in `rooms.*` cluster.
- **HTTP `[132]` append at end** of `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` — do not move `[131]`/`[128]`/`[127]`.
- **Scope-out (forbidden all tasks):** un-archive, hard delete, derived rates, promo, invoices, city ledger, unknown payments, auth expiry, split collapse, `reservations.update_extras`, recurring/breakfast_rule, demo seed rewrite, growing night-audit steps.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `ROOM_ARCHIVE_V29_*`; tail v29 `room_archive` | 1 |
| `packages/do-runtime/src/index.ts` | Export `ROOM_ARCHIVE_V29_SQL` / `STATEMENTS` | 1 |
| `migrations/do-property/0029_room_archive.sql` | Generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | Head 29; migrateSql; on-disk match | 1 |
| `packages/contracts/src/commands/catalog.ts` | Append `rooms.delete` | 2 |
| `packages/contracts/src/commands/audit-writers.ts` | + `rooms.delete` | 2 |
| `packages/contracts/src/register.test.ts` | Catalog **80**; writers **55**; `[132]` (Task 3) | 2, 3 |
| `apps/pms-core/src/property-do.ts` | `tryDeleteRoom`; live counts; Lock 5 filters | 2 |
| `apps/pms-core/src/event-consumer.ts` | Allowlist `room.archived` | 2 |
| `apps/pms-core/test/rooms.spec.ts` | DO cases §7 **1–8** | 2 |
| `packages/contracts/src/v1-http-routes.ts` | Append `[132] delete_room` | 3 |
| `apps/pms-core/src/v1-dispatch.ts` | `handleDeleteRoom`; `V1_ROUTES` append | 3 |
| `packages/client-core/src/api.ts` | `archiveRoom` | 3 |
| `apps/pms-core/test/rooms-routes.spec.ts` | DELETE matrix | 3 |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | Archive button + modal + error copy | 4 |
| `apps/web-pms/src/screens/InventoryScreen.test.tsx` | RTL | 4 |
| `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md` | Close §7 row | 5 |
| `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` | Close §19 leftover **6** | 5 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close §19 leftover **3** | 5 |
| `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` | Close §8 leftover **6** | 5 |
| `docs/superpowers/specs/2026-08-15-rooms-delete-archive-design.md` | Tick §8 checklist | 5 |
| `docs/superpowers/plans/2026-08-15-rooms-delete-archive.md` | Task 5 checkboxes (this file) | 5 |

**Not touched:** `NIGHT_AUDIT_STEPS` array, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, demo seed.

---

## Spec §1.2 / §8 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) v29 migration | 1 |
| §1.2 (2) catalog + audit + HTTP + client | 2–3 |
| §1.2 (3) `tryDeleteRoom` | 2 |
| §1.2 (4) live-count + code checks | 2 |
| §1.2 (5) reader/writer filters | 2 |
| §1.2 (6) SPA | 4 |
| §1.2 (7) tests + pins | 2–5 |
| §7 Lock 7 DO **1–8** | 2 |
| §7 HTTP DELETE matrix | 3 |
| §7 SPA RTL | 4 |
| §8 checklist + pointers | 5 |
| §1.3 scope out | forbidden all |

---

### Task 1: v29 schema — `room.archived_at` + live code unique index

**Spec:** §2 Lock 1, §3.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` — after `FOLIO_ROUTING_RULE_V28_SQL` (~1017)
- Modify: `packages/do-runtime/src/property-migrations.ts` — append tail entry after v28 (~1156–1160)
- Modify: `packages/do-runtime/src/index.ts` — export block (~108–111)
- Create: `migrations/do-property/0029_room_archive.sql` (via `pnpm generate:ddl`)
- Modify: `packages/do-runtime/src/migrate.test.ts` — `migrateSql` (~217–227); `schema head constants` (~618); new cases after v28 (~802–808)

**Interfaces:**
- Produces: `ROOM_ARCHIVE_V29_STATEMENTS`, `ROOM_ARCHIVE_V29_SQL`, `PROPERTY_MIGRATIONS` version **29** name `room_archive`
- Produces: `PROPERTY_SCHEMA_HEAD === 29` (via `schema-head.ts` auto-max)

**Forbidden this commit:** DO logic, catalog, HTTP, SPA, register catalog/HTTP pins.

- [ ] **Step 1: Write failing migrate tests**

Add import in `migrate.test.ts`:

```typescript
import {
  // ...existing imports...
  ROOM_ARCHIVE_V29_SQL,
} from './property-migrations.js';
```

Update `migrateSql` test (~217):

```typescript
  it('applies property migrations through version 29', () => {
    const sql = new MemorySql();
    const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v1).toBe(29);
    const v2 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v2).toBe(29);
    expect(sql.schemaVersion).toHaveLength(29);
    expect(sql.schemaVersion.map((r) => r.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29,
    ]);
    expect(sql.tables.size).toBeGreaterThanOrEqual(14);
  });
```

Update schema head pin (~618):

```typescript
    expect(PROPERTY_SCHEMA_HEAD).toBe(29);
```

Append after v28 block (~802–808):

```typescript
  it('property schema head is 29 after room_archive', () => {
    const v29 = PROPERTY_MIGRATIONS.find((m) => m.version === 29);
    expect(v29?.name).toBe('room_archive');
    expect(v29?.statements).toEqual([
      'ALTER TABLE room ADD COLUMN archived_at INTEGER',
      'DROP INDEX room_code_uidx',
      'CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL',
    ]);
  });

  it('migrations/do-property/0029_room_archive.sql matches ROOM_ARCHIVE_V29_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0029_room_archive.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ROOM_ARCHIVE_V29_SQL.trim());
  });
```

- [ ] **Step 2: Run migrate tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "version 29|room_archive|schema head constants"
```

Expected: **FAIL** — head still **28**; v29 migration missing; on-disk file absent.

- [ ] **Step 3: Add v29 statements + migration tail**

In `property-migrations.ts` after `FOLIO_ROUTING_RULE_V28_SQL`:

```typescript
export const ROOM_ARCHIVE_V29_STATEMENTS = [
  `ALTER TABLE room ADD COLUMN archived_at INTEGER`,
  `DROP INDEX room_code_uidx`,
  `CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL`,
] as const;

export const ROOM_ARCHIVE_V29_SQL =
  ROOM_ARCHIVE_V29_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS` after v28:

```typescript
  {
    version: 29,
    name: 'room_archive',
    statements: ROOM_ARCHIVE_V29_STATEMENTS,
  },
```

Export from `index.ts`:

```typescript
  ROOM_ARCHIVE_V29_SQL,
  ROOM_ARCHIVE_V29_STATEMENTS,
```

- [ ] **Step 4: Generate on-disk SQL**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations/do-property/0029_room_archive.sql packages/do-runtime
```

Expected: new `migrations/do-property/0029_room_archive.sql` matches `ROOM_ARCHIVE_V29_SQL`.

- [ ] **Step 5: Run migrate tests to verify they pass**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
pnpm check:ddl
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 29`.

- [ ] **Step 6: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  migrations/do-property/0029_room_archive.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v29 room.archived_at + live code unique index

EOF
)"
```

---

### Task 2: DO + catalog (no HTTP yet)

**Spec:** §2 Locks 2–5, §4.1, §7 DO **1–8**.

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts` — append after `reservations.update_extras` (~875–883)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — after `'rooms.set_ooo_range',` (~12)
- Modify: `packages/contracts/src/register.test.ts` — ~268 and ~663 pins (catalog **80**, writers **55**; **no `[132]` yet**)
- Modify: `apps/pms-core/src/event-consumer.ts` — after `'room.updated',` (~145)
- Modify: `apps/pms-core/src/property-do.ts` — `tryDeleteRoom` (after `tryDeleteRoomType` ~5541); live counts; Lock 5 SQL filters
- Modify: `apps/pms-core/test/rooms.spec.ts` — append describe block for archive cases **1–8**

**Interfaces:**
- Consumes: Task 1 v29 schema (`archived_at` column exists after provision/migrate)
- Produces: `async tryDeleteRoom(actor, { roomId }, idem)` returning `{ ok: true, roomId }` | `{ ok: false, error: ARCHIVE_BLOCKED }` | `{ ok: false, error: NOT_FOUND | … }`
- Produces: catalog id `rooms.delete`; `AUDIT_WRITER_COMMAND_IDS` includes `rooms.delete`

**Forbidden this commit:** HTTP routes/dispatch, client `archiveRoom`, SPA, `[132]` register pin, spec pointers.

- [ ] **Step 1: Write failing DO tests (`rooms.spec.ts`)**

Append imports at top:

```typescript
import { ARCHIVE_BLOCKED } from '@hospai/contracts';
```

Append helper after existing `createRoom`:

```typescript
async function deleteRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
) {
  const input = { roomId };
  return stub.tryDeleteRoom(TEST_OWNER_ACTOR, input, await idemFor(`del-${roomId}`, input));
}
```

Append new describe block:

```typescript
describe('PropertyDO rooms.delete (archive unit)', () => {
  it('1: archive live room — omitted from listRooms; room.archived; no availability.changed; audit rooms.delete', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_typo', 'rt_king', '10I')).toMatchObject({ ok: true });
    const ariBefore = await stub.readAriVersion();
    const physBefore = (await stub.readAvailabilityDay('rt_king', (await stub.readBusinessDate())!))?.physical;

    expect(await deleteRoom(stub, 'room_typo')).toEqual({ ok: true, roomId: 'room_typo' });
    expect((await stub.listRooms()).rooms).toHaveLength(0);
    expect(await stub.listOutboxEventTypes()).toContain('room.archived');
    expect(await stub.listOutboxEventTypes()).not.toContain('availability.changed');
    expect(await stub.readAriVersion()).toBe(ariBefore);
    expect((await stub.readAvailabilityDay('rt_king', (await stub.readBusinessDate())!))?.physical).toBe(
      physBefore,
    );

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { limit: 50 });
    expect(audit.ok).toBe(true);
    const row = (audit as { ok: true; rows: Array<{ commandId: string; entityType: string }> }).rows.find(
      (r) => r.commandId === 'rooms.delete',
    );
    expect(row?.entityType).toBe('room');
  });

  it('2: after archive, rooms.create replacement succeeds including reusing archived code', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 2);
    expect(await createRoom(stub, 'room_typo', 'rt_king', '10I')).toMatchObject({ ok: true });
    expect(await deleteRoom(stub, 'room_typo')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_101', 'rt_king', '10I')).toMatchObject({ ok: true, roomId: 'room_101' });
    const listed = await stub.listRooms();
    expect(listed.rooms).toHaveLength(1);
    expect(listed.rooms[0]?.code).toBe('10I');
  });

  it('3: typo story — full type then archive frees slot without raising room_count', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 1);
    expect(await createRoom(stub, 'room_typo', 'rt_king', '10I')).toMatchObject({ ok: true });
    expect(await deleteRoom(stub, 'room_typo')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true, roomId: 'room_101' });
  });

  it('4: live checked_in reservation → archive_blocked; room still listed', async () => {
    const { stub, orgId } = await provisionedPropertyWithGuest(`rm-arch-4-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    const arrival = daysFromPropertyToday(0, FIXTURE_TZ);
    const departure = addCalendarDays(arrival, 2);
    await stub.insertReservationForTest({
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: departure,
      status: 'checked_in',
      roomId: 'room_101',
    });
    expect(await deleteRoom(stub, 'room_101')).toEqual({ ok: false, error: ARCHIVE_BLOCKED });
    expect((await stub.listRooms()).rooms.some((r) => r.roomId === 'room_101')).toBe(true);
    void orgId;
  });

  it('5: future-overlapping room_ooo → archive_blocked', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    const today = (await stub.readBusinessDate())!;
    const end = addCalendarDays(today, 5);
    expect(
      await stub.trySetOooRange(
        TEST_OWNER_ACTOR,
        { roomId: 'room_101', startDate: today, endDate: end },
        await idemFor('ooo-arch5', { roomId: 'room_101', startDate: today }),
      ),
    ).toMatchObject({ ok: true });
    expect(await deleteRoom(stub, 'room_101')).toEqual({ ok: false, error: ARCHIVE_BLOCKED });
  });

  it('6: already archived or unknown id → not_found', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-6-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await deleteRoom(stub, 'room_101')).toMatchObject({ ok: true });
    expect(await deleteRoom(stub, 'room_101')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await deleteRoom(stub, 'missing')).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('7: lower room_count below live count → room_units_exceed_count; after archive succeeds', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-7-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 2);
    expect(await createRoom(stub, 'room_a', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_b', 'rt_king', '102')).toMatchObject({ ok: true });
    const lower = { roomTypeId: 'rt_king', roomCount: 1 };
    expect(await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, lower, await idemFor('lower-7', lower))).toEqual({
      ok: false,
      error: ROOM_UNITS_EXCEED_COUNT,
    });
    expect(await deleteRoom(stub, 'room_b')).toMatchObject({ ok: true });
    expect(await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, lower, await idemFor('lower-7b', lower))).toMatchObject({
      ok: true,
    });
  });

  it('8: archived room not picked by auto-assign at check-in', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-arch-8-${crypto.randomUUID()}`);
    const added = await addRoomType(stub, 'rt_king', 5);
    await createRoom(stub, 'room_low', 'rt_king', '101');
    await createRoom(stub, 'room_high', 'rt_king', '201');
    expect(await deleteRoom(stub, 'room_low')).toMatchObject({ ok: true });
    const arrival = added.fromDate ?? daysFromPropertyToday(1, FIXTURE_TZ);
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.tryCreateReservation(
      TEST_OWNER_ACTOR,
      { reservationId, roomTypeId: 'rt_king', guestRef, arrivalDate: arrival, departureDate: departure },
      await idemFor(`c-${reservationId}`, { reservationId }),
    );
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('ci-arch8', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.roomId).toBe('room_high');
  });
});
```

Add import for `provisionedPropertyWithGuest` from `./guest-helpers.js` if not already present.

- [ ] **Step 2: Run DO tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/rooms.spec.ts -t "rooms.delete"
```

Expected: **FAIL** — `tryDeleteRoom` not defined; existing count tests may fail once live-only COUNT lands (fix in Step 3).

- [ ] **Step 3: Append catalog + audit writer + register pins (no HTTP)**

`catalog.ts` append after `reservations.update_extras`:

```typescript
  {
    id: 'rooms.delete',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['room.archived'],
    entitlement: 'pms.core',
    permission: 'inventory:write',
    notes:
      'prototypeAction null: net-new surface (no prototype DELETE_ROOM). ' +
      'Soft archive via archived_at — frees room_count slot without ARI change.',
  },
```

`audit-writers.ts` after `'rooms.set_ooo_range',`:

```typescript
  'rooms.delete',
```

`register.test.ts` ~268:

```typescript
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(55);
```

`register.test.ts` ~663–664:

```typescript
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(55);
    expect(COMMAND_CATALOG).toHaveLength(80);
```

`event-consumer.ts` after `'room.updated',`:

```typescript
    case 'room.archived':
```

- [ ] **Step 4: Implement `tryDeleteRoom` + live counts + Lock 5 filters**

Add `tryDeleteRoom` after `tryDeleteRoomType` (~5541):

```typescript
  /**
   * Archive a physical room unit. Implements catalog `rooms.delete`.
   * Fingerprint allowlist: `{ roomId }`.
   * Never touches availability_day / ARI.
   */
  async tryDeleteRoom(
    actor: ActorContext,
    input: { roomId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomId: string }
    | { ok: false; error: typeof ARCHIVE_BLOCKED }
    | { ok: false; error: string }
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT room_id, room_type_id, code, status, floor, archived_at
               FROM room WHERE room_id = ?`,
              input.roomId,
            )
            .toArray() as Array<{
            room_id: string;
            room_type_id: string;
            code: string;
            status: string;
            floor: string | null;
            archived_at: number | null;
          }>;
          const existing = rows[0];
          if (!existing || existing.archived_at != null) {
            throw new RoomNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;

          const liveRes = this.ctx.storage.sql
            .exec(
              `SELECT 1 FROM reservation
               WHERE room_id = ? AND status IN ('inquiry','pending','confirmed','checked_in')
               LIMIT 1`,
              input.roomId,
            )
            .toArray();
          if (liveRes.length > 0) throw new ArchiveBlockedError();

          const futureOoo = this.ctx.storage.sql
            .exec(
              `SELECT 1 FROM room_ooo WHERE room_id = ? AND end_date > ? LIMIT 1`,
              input.roomId,
              today,
            )
            .toArray();
          if (futureOoo.length > 0) throw new ArchiveBlockedError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room SET archived_at = ?, updated_at = ? WHERE room_id = ?`,
            now,
            now,
            input.roomId,
          );

          this.ctx.storage.sql.exec(
            `DELETE FROM housekeeping_assignment WHERE room_id = ? AND business_date >= ?`,
            input.roomId,
            today,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'room.archived',
            payload: {
              propertyId,
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rooms.delete',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: {
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
              floor: existing.floor,
              status: existing.status,
              archivedAt: null,
            },
            afterJson: {
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
              floor: existing.floor,
              status: existing.status,
              archivedAt: now,
            },
          });

          return { ok: true as const, roomId: input.roomId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ArchiveBlockedError) return { ok: false, error: ARCHIVE_BLOCKED };
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
```

**Live-count gates (Lock 2)** — in `tryCreateRoom` (~5594–5608):

```typescript
          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT room_id FROM room WHERE code = ? AND archived_at IS NULL`, input.code)
            .toArray();

          const unitCount = Number(
            (
              this.ctx.storage.sql
                .exec(
                  `SELECT COUNT(*) AS c FROM room WHERE room_type_id = ? AND archived_at IS NULL`,
                  input.roomTypeId,
                )
                .toArray() as Array<{ c: number }>
            )[0]?.c ?? 0,
          );
```

In `tryUpdateRoomType` (~5227–5232):

```typescript
            const unitCount = Number(
              (
                this.ctx.storage.sql
                  .exec(
                    `SELECT COUNT(*) AS c FROM room WHERE room_type_id = ? AND archived_at IS NULL`,
                    input.roomTypeId,
                  )
                  .toArray() as Array<{ c: number }>
              )[0]?.c ?? 0,
            );
```

In `tryUpdateRoom` (~5698–5711):

```typescript
          const rows = this.ctx.storage.sql
            .exec(`SELECT code, floor, archived_at FROM room WHERE room_id = ?`, input.roomId)
            .toArray() as Array<{ code: string; floor: string | null; archived_at: number | null }>;
          const existing = rows[0];
          if (!existing || existing.archived_at != null) throw new RoomNotFoundError();
          // ...
            const codeTaken = this.ctx.storage.sql
              .exec(
                `SELECT room_id FROM room WHERE code = ? AND archived_at IS NULL AND room_id != ?`,
                input.code,
                input.roomId,
              )
              .toArray();
```

**Lock 5 filters:**

`listRooms` (~6598–6602) — add `AND archived_at IS NULL` before `ORDER BY`.

`readFrontOfficeTape` (~9564–9567):

```sql
         FROM room
         WHERE (? IS NULL OR room_type_id = ?)
           AND archived_at IS NULL
         ORDER BY code
```

`listAvailableRooms` (~9715–9718) — after `FROM room` WHERE clause add `AND archived_at IS NULL`.

`readFrontOfficeSummary` sellable (~9804–9807):

```sql
      `SELECT COUNT(*) AS n FROM room
       WHERE archived_at IS NULL
         AND room_id NOT IN (
         SELECT room_id FROM room_ooo WHERE start_date <= ? AND end_date > ?
       )`,
```

`assertRoomAssignableSync` (~6340–6344):

```typescript
    const roomRows = this.ctx.storage.sql
      .exec(`SELECT room_type_id, status, archived_at FROM room WHERE room_id = ?`, roomId)
      .toArray() as Array<{ room_type_id: string; status: string; archived_at: number | null }>;
    const room = roomRows[0];
    if (!room || room.archived_at != null) throw new RoomNotFoundError();
```

`pickAutoAssignRoomSync` (~8263–8267):

```sql
        `SELECT room_id, status FROM room WHERE room_type_id = ? AND archived_at IS NULL ORDER BY code ASC`,
```

Status/OOO writers already throw `RoomNotFoundError` via room lookup paths — ensure those lookups treat `archived_at != null` as missing where they SELECT for mutation (mirror `tryUpdateRoom` pattern in `trySetOooRange` room join if needed: archived room → `RoomNotFoundError`).

**Do not** filter purge census ~1259 `(SELECT COUNT(*) FROM room)`.

- [ ] **Step 5: Rebuild contracts and run tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/rooms.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "audit writer|night-audit HTTP routes"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: archive cases **1–8** **PASS**; existing create/count tests **PASS** (live-only COUNT); register shows catalog **80**, writers **55**; `[131]` still last HTTP (no `[132]` yet).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/rooms.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): archive physical rooms (rooms.delete)

EOF
)"
```

---

### Task 3: HTTP + client

**Spec:** §2 Lock 3, §4.2–4.3, §7 HTTP matrix.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append after `[131]` (~771–777)
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handleDeleteRoom` (after `handleDeleteRoomType` ~1025); `V1_ROUTES` append (~7440–7448)
- Modify: `packages/client-core/src/api.ts` — `archiveRoom` after `archiveRoomType` (~1588)
- Modify: `packages/contracts/src/register.test.ts` — append `[132]` in `'night-audit HTTP routes append at 86–91'` (~655–661)
- Modify: `apps/pms-core/test/rooms-routes.spec.ts` — DELETE matrix

**Interfaces:**
- Consumes: Task 2 `tryDeleteRoom`, catalog `rooms.delete`
- Produces: `DELETE /v1/properties/:propertyId/rooms/:roomId`; client `archiveRoom(propertyId, roomId)`; `V1_HTTP_ROUTE_AUDIT[132].id === 'delete_room'`

**Forbidden this commit:** SPA, spec pointers.

- [ ] **Step 1: Write failing HTTP tests**

Add helper in `rooms-routes.spec.ts`:

```typescript
async function deleteRoom(
  propertyId: string,
  actor: string,
  roomId: string,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'x-dev-actor': actor };
  if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}`,
      { method: 'DELETE', headers },
    ),
    env,
  );
}
```

Append tests:

```typescript
  it('DELETE /rooms/:id — 200 archives unit', async () => {
    const actor = 'user_rm_del_ok';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_101',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-del-ok',
        })
      ).status,
    ).toBe(201);
    const res = await deleteRoom(propertyId, actor, 'room_101', `idem-archive-${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, roomId: 'room_101' });
    expect((await stub.listRooms()).rooms).toHaveLength(0);
  });

  it('DELETE /rooms/:id — 404 unknown or already archived', async () => {
    const actor = 'user_rm_del_404';
    const { propertyId } = await provisionHotel(actor);
    expect((await deleteRoom(propertyId, actor, 'missing', 'idem-404')).status).toBe(404);
  });

  it('DELETE /rooms/:id — 409 archive_blocked with live reservation', async () => {
    const actor = 'user_rm_del_409';
    const { propertyId, stub, guestRef } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_101',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-del-block',
        })
      ).status,
    ).toBe(201);
    const arrival = daysFromPropertyToday(0, FIXTURE_TZ);
    const departure = addCalendarDays(arrival, 2);
    await stub.insertReservationForTest({
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: departure,
      status: 'checked_in',
      roomId: 'room_101',
    });
    const res = await deleteRoom(propertyId, actor, 'room_101', `idem-block-${crypto.randomUUID()}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'archive_blocked' });
  });

  it('DELETE /rooms/:id — 400 missing idempotency key', async () => {
    const actor = 'user_rm_del_400';
    const { propertyId } = await provisionHotel(actor);
    const res = await deleteRoom(propertyId, actor, 'room_x');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/rooms-routes.spec.ts -t "DELETE /rooms"
```

Expected: **FAIL** — 404 route not found.

- [ ] **Step 3: Append route audit + handler + dispatch + client**

`v1-http-routes.ts` append:

```typescript
  {
    id: 'delete_room',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'rooms.delete',
    entitlement: 'pms.core',
  },
```

`v1-dispatch.ts` after `handleDeleteRoomType`:

```typescript
async function handleDeleteRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey =
    ctx.request.headers.get('x-idempotency-key') ?? ctx.url.searchParams.get('idempotencyKey');
  if (!idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ roomId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { roomId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRoom']>>>({
    env: ctx.env,
    commandId: 'rooms.delete',
    routeId: 'delete_room',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryDeleteRoom(actor, commandPayload, {
        key: idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) {
      return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    if (result.error === ARCHIVE_BLOCKED) {
      return json({ ok: false, error: result.error }, 409);
    }
    return json({ ok: false, error: result.error }, 422);
  }
  return json(result, 200);
}
```

Append to `V1_ROUTES` after routing-rule archive entry:

```typescript
  {
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'rooms.delete',
    entitlement: 'pms.core',
    handler: handleDeleteRoom,
  },
```

`api.ts` after `archiveRoomType`:

```typescript
    async archiveRoom(propertyId: string, roomId: string) {
      const idempotencyKey = stableKeyForOperation(`room:archive:${roomId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
```

`register.test.ts` append after `[131]` block (~655–661):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[132]?.id).toBe('delete_room');
    expect(V1_HTTP_ROUTE_AUDIT[132]).toMatchObject({
      scope: 'property',
      permission: 'inventory:write',
      commandId: 'rooms.delete',
      entitlement: 'pms.core',
    });
```

- [ ] **Step 4: Rebuild client-core + run HTTP + register tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/rooms-routes.spec.ts -t "DELETE /rooms"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
```

Expected: **PASS**; `[132]=delete_room`; `[131]`/`[128]`/`[127]` unmoved; catalog **80**; writers **55**.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/rooms-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): DELETE /rooms/:id archive unit

EOF
)"
```

---

### Task 4: SPA — inventory rooms tab archive

**Spec:** §2 Lock 6, §7 SPA.

**Files:**
- Modify: `apps/web-pms/src/screens/InventoryScreen.tsx` — state, mutation, button, modal, `inventoryErrorCopy`
- Modify: `apps/web-pms/src/screens/InventoryScreen.test.tsx` — RTL + updated error copy test

**Interfaces:**
- Consumes: Task 3 `api.archiveRoom(propertyId, roomId)`

**Forbidden this commit:** DO/HTTP/contracts, spec pointers.

- [ ] **Step 1: Write failing RTL tests**

In test mock (~11–24), add:

```typescript
const archiveRoom = vi.fn();
// in api mock:
    archiveRoom: (...a: unknown[]) => archiveRoom(...a),
```

In `beforeEach`:

```typescript
    archiveRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
```

Append tests:

```typescript
  it('rooms tab: archive unit confirm copy and success invalidates rooms query', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '10I',
          status: 'clean',
          floor: null,
          oooRanges: [],
        },
      ],
    });
    renderInventory('rooms');
    expect(await screen.findByDisplayValue('10I')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive 10I' }));
    expect(
      screen.getByText('Archive 10I? It will free a unit slot. History stays.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archiveRoom).toHaveBeenCalledWith('prop_demo', 'rm_1'));
  });

  it('room archive archive_blocked uses room-specific copy', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          status: 'clean',
          floor: null,
          oooRanges: [],
        },
      ],
    });
    archiveRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 409,
        body: { ok: false, error: 'archive_blocked' },
        retryAfterMs: null,
      }),
    );
    renderInventory('rooms');
    fireEvent.click(await screen.findByRole('button', { name: 'Archive 101' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(
      await screen.findByText(
        'This room has a live reservation or a future out-of-order period — it cannot be archived.',
      ),
    ).toBeTruthy();
  });
```

Update existing `room_units_exceed_count` expectation (~338–341) to:

```typescript
        'Cannot lower room count below the number of live rooms. Archive extra units first.',
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx -t "archive unit|archive_blocked|room_units_exceed"
```

Expected: **FAIL** — no Archive button; stale copy.

- [ ] **Step 3: Implement InventoryScreen changes**

State (~110):

```typescript
  const [roomArchiveTarget, setRoomArchiveTarget] = useState<{ roomId: string; code: string } | null>(
    null,
  );
```

Update `inventoryErrorCopy` signature and branches (~53–61):

```typescript
function inventoryErrorCopy(err: unknown, context?: 'room' | 'type'): string {
  const code = wireCode(err);
  // ...
  if (code === 'room_units_exceed_count') {
    return 'Cannot lower room count below the number of live rooms. Archive extra units first.';
  }
  if (code === 'archive_blocked') {
    if (context === 'room') {
      return 'This room has a live reservation or a future out-of-order period — it cannot be archived.';
    }
    return 'This type still has future sold or blocked inventory — it cannot be archived.';
  }
```

Mutation after `archiveType`:

```typescript
  const archiveRoomUnit = useMutation({
    mutationFn: ({ roomId }: { roomId: string }) => api.archiveRoom(propertyId, roomId),
    onSuccess: async () => {
      setRoomArchiveTarget(null);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
    },
  });
```

Alert (~248): branch context from which mutation errored:

```typescript
      {createType.isError ||
      archiveType.isError ||
      archiveRoomUnit.isError ||
      addRoom.isError ||
      saveType.isError ? (
        <Alert>
          {inventoryErrorCopy(
            createType.error ??
              archiveRoomUnit.error ??
              archiveType.error ??
              addRoom.error ??
              saveType.error,
            archiveRoomUnit.isError ? 'room' : archiveType.isError ? 'type' : undefined,
          )}
        </Alert>
      ) : null}
```

Rooms tab action cell (~518–539) — add Archive button beside Save:

```tsx
                              <Button
                                type="button"
                                intent="destructive"
                                onClick={() =>
                                  setRoomArchiveTarget({ roomId: room.roomId, code: room.code })
                                }
                              >
                                Archive {room.code}
                              </Button>
```

Separate modal after type archive modal (~606–621):

```tsx
      {roomArchiveTarget ? (
        <div role="dialog" aria-modal="true" className="panel overscroll-contain">
          <p>
            Archive {roomArchiveTarget.code}? It will free a unit slot. History stays.
          </p>
          <Button type="button" onClick={() => setRoomArchiveTarget(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="destructive"
            onClick={() => archiveRoomUnit.mutate({ roomId: roomArchiveTarget.roomId })}
            disabled={archiveRoomUnit.isPending}
          >
            {archiveRoomUnit.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      ) : null}
```

- [ ] **Step 4: Run RTL + color check**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/InventoryScreen.tsx \
  apps/web-pms/src/screens/InventoryScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): archive room unit on inventory rooms tab

EOF
)"
```

---

### Task 5: Pointers + full CI (LAST)

**Spec:** §8 checklist, §7 leftovers pointers, D7/D8.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md` — §7 table row ~486
- Modify: `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` — §19 item **6** ~682
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — §19 item **3** ~540
- Modify: `docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md` — §8 item **6** ~262
- Modify: `docs/superpowers/specs/2026-08-15-rooms-delete-archive-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-rooms-delete-archive.md` — Task 5 checkboxes (this file)

**Pointer sentences (normative):**

Rooms-housekeeping §7 (~486):

> ~~`rooms.delete` / archive lifecycle \| `rooms.update` covers typo correction; freeing a `room_count` slot is a separate lifecycle question~~ **Closed** in [2026-08-15 rooms delete — physical-unit archive](./2026-08-15-rooms-delete-archive-design.md): `rooms.delete` soft-archives via `archived_at`, frees live `room_count` slots without changing sellable `physical`.

Room-operations §19 item **6** (~682):

> ~~**`rooms.delete` / physical-unit archive** — rooms-vertical leftover; count invariant still has no delete path.~~ **Closed** in [2026-08-15 rooms delete — physical-unit archive](./2026-08-15-rooms-delete-archive-design.md).

Property-setup §19 item **3** (~540):

> ~~**`rooms.delete` / unit archive** \| Rooms-vertical leftover~~ **Closed** in [2026-08-15 rooms delete — physical-unit archive](./2026-08-15-rooms-delete-archive-design.md).

Night-audit auto-extend §8 item **6** (~262):

> ~~**`rooms.delete`** \| Phase 1 queue item **4**~~ **Closed** in [2026-08-15 rooms delete — physical-unit archive](./2026-08-15-rooms-delete-archive-design.md).

- [x] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **80**; writers **55**; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 29`; `NIGHT_AUDIT_STEPS.length === 8` (pin in rooms.spec or night-audit spec if needed).

- [x] **Step 2: Targeted test superset (spec §7)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/rooms.spec.ts -t "rooms.delete"
pnpm --filter @hospai/pms-core exec vitest run test/rooms-routes.spec.ts -t "DELETE /rooms"
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx -t "archive"
pnpm check:ddl
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
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

- [x] **Step 4: Apply doc pointers + tick spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-rooms-delete-archive-design.md` §8.

- [x] **Step 5: Tick Task 5 checkboxes in this plan only**

Do **not** tick Tasks 1–4 checkboxes.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-rooms-housekeeping-vertical-design.md \
  docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-15-night-audit-auto-extend-design.md \
  docs/superpowers/specs/2026-08-15-rooms-delete-archive-design.md \
  docs/superpowers/plans/2026-08-15-rooms-delete-archive.md
git commit -m "$(cat <<'EOF'
docs: close rooms.delete unit-archive leftovers

EOF
)"
```

**Stop.** Un-archive, hard delete, `includeArchived` admin view, and purge semantics for archived units stay deferred per spec §7 / §1.3.

---

## Spec §8 reviewer checklist (Task 5 ticks these in the spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| v29 migration + generate:ddl + migrate tests | Task 1 |
| Catalog `rooms.delete`; audit writer; event allowlist | Task 2 |
| HTTP `[132]` + dispatch + client | Task 3 |
| `tryDeleteRoom` guards, HK delete, outbox, audit | Task 2 |
| Live-count gates + live-only code checks | Task 2 |
| Reader/writer archive filters (Lock 5) | Task 2 |
| SPA archive UX + RTL + error copy | Task 4 |
| DO + HTTP + register/migrate pins | Tasks 1–3 + 5 |
| `pnpm check:*` gates | Task 5 |
| Bidirectional pointers | Task 5 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–7) | 1–5 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–7 | 1–5 |
| §3 schema v29 | 1 |
| §4 commands / HTTP | 2–3 |
| §6 file map | 1–5 |
| §7 tests | 2–5 |
| §8 checklist + pointers | 5 |
| Heads table §1.1 | 1–3 + 5 verify |
| D-locks 1–8 | Open decisions |

**Gaps:** None — all §7 numbered cases and §8 checklist items map to Tasks 1–5.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 5 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §9). Verified: catalog tail `reservations.update_extras`; HTTP tail `[131]`; schema **28→29**; `tryCreateRoom`/`tryUpdateRoomType` raw COUNT today; `handleDeleteRoomType` maps `ARCHIVE_BLOCKED`→409.
