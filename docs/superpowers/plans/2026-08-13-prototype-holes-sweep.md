# Prototype Holes Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close ARCHITECTURE.md §16.5 unnamed rows: stay-level `dnd_flag`, occupancy remainder (check-in + modify + wizard), top-bar reservation search, printable registration-card view, and the comment/VIP/DND editor — without a recurring-charges engine or extra HK tabs.

**Architecture:** No new catalog command. DND and the front-office editor ride existing `reservations.update_status` (`QUEUE_PROVISIONAL`, undefined field = unchanged, so editor payloads omit `noPost`). Occupancy reuses `assertOccupancySync`. Search is a FAIL_CLOSED read: PropertyDO candidates + dispatcher OrgDO hydrate/filter. Registration card is SPA `window.print` over existing GET reservation + guests batch. v23 is one `ALTER TABLE reservation`.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO / OrgDO), `@hospai/contracts`, `@hospai/do-runtime` v23, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md` (Approved). Spec commit: `a8b5516`.

## Global Constraints

- `room.status` does **not** gain `dnd`. DND is `reservation.dnd_flag` only.
- `NIGHT_AUDIT_STEPS` stays **7**. Do not read `breakfast_rule` in `postRoomChargesSync`. No recurring-charge table.
- Route audit **append-only**. `[104] = post_room_ooo_range` does not move. New route is **`[105] get_reservation_search`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`. Do not splice.
- **Search path vs first-match:** `findRoute` returns the first `V1_ROUTES` hit. `GET …/reservations/([^/]+)$` (`get_reservation`, early index) would steal `…/reservations/search`. Nested spec path is therefore unreachable if `[105]` is appended. **Lock:** HTTP path is `GET /v1/properties/:propertyId/reservations-search?q=` (hyphen, not a `:rid` child). Audit id stays `get_reservation_search`. Do not change the `get_reservation` pattern.
- `AUDIT_WRITER_COMMAND_IDS.size` stays **45**. `PLATFORM_GAPS` stays `[]`.
- No new `export class`. `OccupancyExceededError` stays file-local. **`CLASS_DENYLIST` is not edited.** Task 8 verifies the file is unchanged.
- No new table. **`PROPERTY_PURGE_INVENTORY_TABLES` is not edited.** Task 8 verifies the list is unchanged (room-ops CI caught a missed `room_ooo` add; this chunk must not skip the check just because the delta is empty).
- `runIdempotent` stays sync-only. Search is a read RPC.
- Fixture dates from property-local `business_date`. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 8). Do not backfill historical plans.
- No either/or forks. Open questions in spec §14 are **locked**.
- **Rebuild:** after any `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests (they import dist). This chunk does not edit `modules/pms/housekeeping`, but pms-core tests import `@hospai/pms-housekeeping` — if that package’s source is dirty in the worktree, `pnpm --filter @hospai/pms-housekeeping build` before those tests (room-ops drift). Task 8 rebuilds both via `pnpm build`.
- Task 1 must **not** touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT` (`check:permissions` stays green).
- Editor never sends `noPost`. Dispatcher optional-spreads `noPost` when present so the existing FolioScreen toggle is not a no-op.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | `reservations.update_status` notes mention DND (Task 1) |
| `packages/contracts/src/idempotency.ts` | `FRONT_OFFICE_COMMENT_TOO_LONG` (Task 1) |
| `packages/contracts/src/register.test.ts` | Notes pin (Task 1); `[105]` pin (Task 5) |
| `packages/do-runtime/src/property-migrations.ts` | v23 `dnd_flag` |
| `migrations/do-property/0023_prototype_holes.sql` | Generated |
| `scripts/property-ddl.mjs` | 0023 target |
| `packages/do-runtime/src/migrate.test.ts` | Head 23; MemorySql `dnd_flag` ALTER |
| `packages/do-runtime/src/prototype-holes-migration.sqlite.test.ts` | Real-SQLite CHECK |
| `packages/do-runtime/src/index.ts` | Export v23 SQL |
| `apps/pms-core/src/property-do.ts` | `tryUpdateFrontOffice` DND; occupancy; `searchReservations`; reads; `insertReservationForTest` |
| `apps/pms-core/src/v1-dispatch.ts` | Front-office `dndFlag`/`noPost` spread (Task 3); create fingerprint (Task 4); `[105]` handler+route (Task 5) |
| `apps/pms-core/src/pending-commands-consumer.ts` | Replay payload includes `dndFlag`/`noPost` |
| `packages/contracts/src/v1-http-routes.ts` | `[105]` append (Task 5 only) |
| `packages/client-core/src/api.ts` | `searchReservations`; `dndFlag` on reads / `updateFrontOffice` |
| `packages/client-core/src/booking.ts` | `bookingReservationOpId` + adults/children |
| `apps/web-pms/src/shell/AppShell.tsx` | Search |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Party size |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Editor + print (keep no-post toggle) |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Party size, editor, print |
| `apps/web-pms/src/screens/BoardScreen.tsx` | VIP/DND badges |
| Sibling specs + `ARCHITECTURE.md` §16.5 | Bidirectional pointers (Task 7) |

## Test file split (spec §12 → file)

| Spec # | File | Task |
|---|---|---|
| Catalog notes / `FRONT_OFFICE_COMMENT_TOO_LONG` | `packages/contracts/src/register.test.ts`, `idempotency.test.ts` | 1 |
| 1 (v23 CHECK + head 23) | `packages/do-runtime` migrate + sqlite tests | 2 |
| 2–5, 16 | `apps/pms-core/test/reservations-lifecycle.spec.ts` + `reservations-routes.spec.ts` | 3 |
| 6–10 | `reservations-lifecycle.spec.ts` + `reservations-routes.spec.ts` | 4 |
| 10 client opId | `packages/client-core/test/booking.test.ts` | 4 |
| 17–23 | `apps/pms-core/test/reservations-search-routes.spec.ts` (new) + `register.test.ts` `[105]` | 5 |
| 11 | `apps/web-pms/src/screens/BookingScreen.test.tsx` | 6 |
| 12–14 | `CheckInScreen.test.tsx` / `FolioScreen.test.tsx` | 6 |
| 15 | `FolioScreen.test.tsx` + `BoardScreen.test.tsx` | 6 |
| 24 | `apps/web-pms/src/shell/AppShell.search.test.tsx` (new) | 6 |
| 25–26 pins, purge, denylist | Task 8 CI | 8 |
| Bidirectional pointers | sibling specs | 7 |

---

### Task 1: Catalog notes (own commit, no HTTP routes)

**Spec:** §3.2, §6.2, §8.1. Keep `check:permissions` green.

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Test: `packages/contracts` vitest

**Interfaces:**
- Produces: catalog notes string containing `DND`; `FRONT_OFFICE_COMMENT_TOO_LONG = 'front_office_comment_too_long'`
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any DO method body, any SPA, any migration, `AUDIT_WRITER_COMMAND_IDS` membership, new catalog ids.

- [x] **Step 1: Write the failing tests**

In `packages/contracts/src/idempotency.test.ts` add (next to `OCCUPANCY_EXCEEDED`):

```ts
it('front-office comment too long wire code', () => {
  expect(FRONT_OFFICE_COMMENT_TOO_LONG).toBe('front_office_comment_too_long');
});
```

Import `FRONT_OFFICE_COMMENT_TOO_LONG`.

In `packages/contracts/src/register.test.ts`, extend `reservations.update_status and check_out emit the lifecycle events`:

```ts
expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.update_status')?.notes).toMatch(/DND/i);
expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.update_status')?.events).toEqual([
  'reservation.front_office_updated',
]);
```

Do **not** add `[105]` assertions this commit (`[104]` stays `post_room_ooo_range`; `[105]` is undefined until Task 5). Size pin stays **45**.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
```

Expected: FAIL — missing export / notes still *“Front-office comment + VIP flag…”* without DND.

- [x] **Step 3: Implement contracts**

`packages/contracts/src/idempotency.ts` — after `OCCUPANCY_EXCEEDED`:

```ts
export const FRONT_OFFICE_COMMENT_TOO_LONG = 'front_office_comment_too_long' as const;
```

`packages/contracts/src/commands/catalog.ts` — `reservations.update_status` notes:

```ts
notes: 'Front-office comment, VIP flag, DND flag. Not the status-machine column.',
```

Lane / degraded / permission / events / entitlement **unchanged**.

- [x] **Step 4: Rebuild contracts, re-run tests, check:permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
pnpm check:permissions
```

Expected: all exit 0. `check:permissions` still reports the current `V1_HTTP_ROUTE_AUDIT.length` (no new route).

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): mention DND on reservations.update_status notes

EOF
)"
```

---

### Task 2: v23 `dnd_flag` migration

**Spec:** §3.1, §9, §12 tests 1, 25 (head pin).

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `packages/do-runtime/src/prototype-holes-migration.sqlite.test.ts`
- Create (generated): `migrations/do-property/0023_prototype_holes.sql`

**Interfaces:**
- Produces: `PROTOTYPE_HOLES_V23_STATEMENTS` / `_SQL`; `PROPERTY_SCHEMA_HEAD === 23`; column `reservation.dnd_flag` DEFAULT 0
- Consumes: Task 1 not required at runtime
- **Forbidden:** DO RPC bodies, HTTP routes, SPA.

- [x] **Step 1: Write the failing migrate + sqlite tests**

In `packages/do-runtime/src/migrate.test.ts`:

1. MemorySql — before the `throw new Error(\`Unhandled SQL…\`)`:

```ts
if (q.startsWith('ALTER TABLE reservation ADD COLUMN dnd_flag')) return { toArray: () => [] };
```

Keep the existing `ALTER TABLE reservation ADD COLUMN no_post` handler. Do **not** collapse them into a generic `ADD COLUMN` prefix.

2. `applies property migrations through version 22` → **23**; `expect(v1).toBe(23)`; `schemaVersion` length **23**; version array ends with `23`.

3. `match current migration array tails`: `PROPERTY_SCHEMA_HEAD` `toBe(23)`. Leave `property schema head is 22 after room_ooo` as historical (it may still `toBe(22)` **inside** a `filter version <= 22` assertion — if it currently asserts global `PROPERTY_SCHEMA_HEAD === 22`, change **only** the global pin test; keep the v22 name/statements assertions).

4. Add:

```ts
it('property schema head is 23 after prototype holes', () => {
  expect(PROPERTY_SCHEMA_HEAD).toBe(23);
  const v23 = PROPERTY_MIGRATIONS.find((m) => m.version === 23);
  expect(v23?.name).toBe('prototype_holes');
  expect(v23?.statements.some((s) => s.includes('dnd_flag'))).toBe(true);
});

it('migrations/do-property/0023_prototype_holes.sql matches PROTOTYPE_HOLES_V23_SQL', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '../../../migrations/do-property/0023_prototype_holes.sql');
  const onDisk = readFileSync(path, 'utf8');
  const body = onDisk
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n')
    .trim();
  expect(body).toBe(PROTOTYPE_HOLES_V23_SQL.trim());
});
```

Import `PROTOTYPE_HOLES_V23_SQL`.

Create `packages/do-runtime/src/prototype-holes-migration.sqlite.test.ts` (mirror `room-ooo-migration.sqlite.test.ts`):

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('prototype holes v23 real sqlite', () => {
  it('dnd_flag defaults 0; CHECK rejects 2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 2, 2, 'active', 0, 0)`);
    db.exec(`INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
             VALUES ('res_1', 'rt_1', 'g1', 'k1', '2026-08-13', '2026-08-14', 'confirmed', 0, 0)`);
    const row = db.prepare(`SELECT dnd_flag FROM reservation WHERE reservation_id = 'res_1'`).get() as {
      dnd_flag: number;
    };
    expect(row.dnd_flag).toBe(0);
    expect(() => db.exec(`UPDATE reservation SET dnd_flag = 2 WHERE reservation_id = 'res_1'`)).toThrow();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/prototype-holes-migration.sqlite.test.ts
```

Expected: FAIL — head still 22 / unhandled SQL / missing export.

- [x] **Step 3: Implement v23**

`packages/do-runtime/src/property-migrations.ts` — after `ROOM_OOO_V22_SQL`:

```ts
/** v23 — stay-level DND flag (not a room.status). */
export const PROTOTYPE_HOLES_V23_STATEMENTS: string[] = [
  `ALTER TABLE reservation ADD COLUMN dnd_flag INTEGER NOT NULL DEFAULT 0
  CHECK (dnd_flag IN (0, 1))`,
];

export const PROTOTYPE_HOLES_V23_SQL = PROTOTYPE_HOLES_V23_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```ts
{
  version: 23,
  name: 'prototype_holes',
  statements: PROTOTYPE_HOLES_V23_STATEMENTS,
},
```

Export `PROTOTYPE_HOLES_V23_SQL` / `_STATEMENTS` from `packages/do-runtime/src/index.ts` next to `ROOM_OOO_V22_SQL`.

`scripts/property-ddl.mjs`: destructure `PROTOTYPE_HOLES_V23_SQL` from the do-runtime import; append a `doPropertyTargets` entry:

```js
{
  path: join(root, 'migrations/do-property/0023_prototype_holes.sql'),
  header: `-- PropertyDO prototype holes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER reservation ADD dnd_flag.

`,
  sql: PROTOTYPE_HOLES_V23_SQL,
},
```

Then:

```bash
pnpm generate:ddl
```

(`generate:ddl` builds `@hospai/do-runtime` then `--write`.) Do not hand-edit the generated SQL.

- [x] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/prototype-holes-migration.sqlite.test.ts
pnpm check:ddl
```

Expected: all exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/index.ts packages/do-runtime/src/migrate.test.ts packages/do-runtime/src/prototype-holes-migration.sqlite.test.ts scripts/property-ddl.mjs migrations/do-property/0023_prototype_holes.sql
git commit -m "$(cat <<'EOF'
feat(schema): add reservation.dnd_flag (v23)

EOF
)"
```

---

### Task 3: `tryUpdateFrontOffice` DND + comment cap + HTTP spread

**Spec:** §3.2–3.5, §6.2, §8.3–8.4, §12 tests 2–5, 16.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handlePostReservationFrontOffice` only)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Modify: `packages/client-core/src/api.ts` (`ReservationRead` / `updateFrontOffice` extra already has `noPost`; add `dndFlag`)
- Test: `apps/pms-core/test/reservations-lifecycle.spec.ts`
- Test: `apps/pms-core/test/reservations-routes.spec.ts`

**Interfaces:**
- Consumes: v23 column; `FRONT_OFFICE_COMMENT_TOO_LONG`
- Produces: `tryUpdateFrontOffice` input `{ reservationId, frontOfficeComment?, vipFlag?, dndFlag?, noPost? }`; reads include `dndFlag: boolean`
- **Forbidden:** `V1_HTTP_ROUTE_AUDIT` / new `V1_ROUTES` entries; occupancy; search.

- [x] **Step 1: Write the failing tests (spec 2–5, 16)**

In `apps/pms-core/test/reservations-lifecycle.spec.ts` (use `crypto.randomUUID()` for ids; property-local dates):

- **2.** Check in a stay; `tryUpdateFrontOffice({ dndFlag: true })`; `readReservation` → `dndFlag: true`; outbox `reservation.front_office_updated` payload `dndFlag: true`; `audit_log` `afterJson` includes it. Command id `reservations.update_status`.
- **3.** Toggle `{ dndFlag: false }` → 0. On `checked_out` → `{ ok: false, error: NOT_MODIFIABLE }`.
- **4.** `listInHouse` (or arrivals) item includes `dndFlag`.
- **5.** Second call same fingerprint → idempotent; one `audit_log` row for that key.
- **16.** Comment of 2001 chars → `{ ok: false, error: FRONT_OFFICE_COMMENT_TOO_LONG }`.

HTTP in `reservations-routes.spec.ts`: `POST …/front-office` `{ dndFlag: true, idempotencyKey }` → GET reservation `dndFlag: true`. Also `{ noPost: true }` only (no comment) → folio/read `noPost: true` and **comment/VIP unchanged** (proves undefined-means-unchanged after the dispatcher spread).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations-routes.spec.ts
```

Expected: FAIL — `dndFlag` undefined / comment cap missing / `noPost` HTTP no-op.

- [x] **Step 3: Implement**

`tryUpdateFrontOffice` (`property-do.ts` ~7259):

- Input type already has `noPost?`; add `dndFlag?: boolean`.
- Fingerprint comment: `{ reservationId, frontOfficeComment?, vipFlag?, dndFlag?, noPost? }`.
- SELECT adds `dnd_flag`.
- After resolving `nextComment` / `nextVip` / `nextNoPost`:

```ts
const nextDnd = input.dndFlag !== undefined ? (input.dndFlag ? 1 : 0) : reservation.dnd_flag;
if (typeof nextComment === 'string' && nextComment.length > 2000) {
  throw new Error(FRONT_OFFICE_COMMENT_TOO_LONG); // or a local error mapped like OccupancyExceededError
}
```

Prefer a small local `FrontOfficeCommentTooLongError` **not exported** (do not add to `CLASS_DENYLIST`) mapped in `mapReservationPreconditionError` to `FRONT_OFFICE_COMMENT_TOO_LONG`. Import the const from `@hospai/contracts`.

- UPDATE sets `dnd_flag = ?`.
- Outbox + audit before/after include `dndFlag`.

`readReservation` / `mapFrontDeskRow` / arrivals / departures / in-house SELECTs add `dnd_flag` → `dndFlag: row.dnd_flag === 1`.

`insertReservationForTest`: optional `dndFlag?: boolean`; include in `hasOptional` and the wide INSERT (`dnd_flag` column, `input.dndFlag ? 1 : 0`). Short INSERT path still relies on DEFAULT 0.

`v1-dispatch.ts` `handlePostReservationFrontOffice` body + payload:

```ts
const body = (await ctx.request.json()) as {
  idempotencyKey: string;
  frontOfficeComment?: string;
  vipFlag?: boolean;
  dndFlag?: boolean;
  noPost?: boolean;
};
const commandPayload = {
  reservationId,
  ...(body.frontOfficeComment !== undefined ? { frontOfficeComment: body.frontOfficeComment } : {}),
  ...(body.vipFlag !== undefined ? { vipFlag: body.vipFlag } : {}),
  ...(body.dndFlag !== undefined ? { dndFlag: body.dndFlag } : {}),
  ...(body.noPost !== undefined ? { noPost: body.noPost } : {}),
};
```

`mapReservationCommandErrorStatus`: treat `FRONT_OFFICE_COMMENT_TOO_LONG` as 422.

`pending-commands-consumer.ts` replay type includes `dndFlag?: boolean; noPost?: boolean`.

`packages/client-core/src/api.ts`: `ReservationRead.dndFlag?: boolean`; `updateFrontOffice` extra `{ frontOfficeComment?: string; vipFlag?: boolean; noPost?: boolean; dndFlag?: boolean }` (spread `...extra` already sends whatever is passed — do not send `noPost` from the new editor in Task 6).

- [x] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations-routes.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/pending-commands-consumer.ts packages/client-core/src/api.ts apps/pms-core/test/reservations-lifecycle.spec.ts apps/pms-core/test/reservations-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): persist stay DND flag on front-office update

EOF
)"
```

---

### Task 4: Occupancy on check-in / modify + create fingerprint

**Spec:** §4, §12 tests 6–10. §14 Q4 locked: create fingerprint includes adults/children. §14 Q5 locked: check-in occupancy not overridable.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCheckIn`, `tryModifyReservation`)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handlePostReservations` fingerprint only)
- Modify: `packages/client-core/src/booking.ts`
- Test: `apps/pms-core/test/reservations-lifecycle.spec.ts`
- Test: `packages/client-core/test/booking.test.ts`

**Interfaces:**
- Consumes: existing `assertOccupancySync` / `OCCUPANCY_EXCEEDED`
- Produces: check-in and modify reject over-cap; party-only modify updates without ledger move; create fingerprint includes party size
- **Forbidden:** new routes; DND (already done); search; SPA.

- [x] **Step 1: Write the failing tests (spec 6–10)**

Keep existing test 45 (create over occupancy). Add:

- **6.** Create `adults: 2` on type `max_adults = 2`, `max_occupancy = 2` → ok (if not already covered).
- **7.** Create legal party; `inventory.update_room_type` lowers `max_occupancy` below adults+children; `tryCheckIn` → `OCCUPANCY_EXCEEDED`; status still `confirmed`.
- **8.** Modify to a smaller-cap type with existing party → `OCCUPANCY_EXCEEDED`; `sold` unchanged.
- **9.** Modify **only** `adults` (same dates/type) under the cap → row updates; **no** `availability.changed`; `reservation.modified` emitted. Same modify over cap → `OCCUPANCY_EXCEEDED`.
- **10.** `handlePostReservations` / `tryCreateReservation`: first create adults=1 succeeds; replay **same idempotency key** with adults=2 → `IDEM_KEY_REUSED` (not a stored 1-adult stay returned as success). Client: `bookingReservationOpId` differs when adults/children differ (`packages/client-core/test/booking.test.ts`).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations-routes.spec.ts
```

Expected: FAIL — check-in/modify skip occupancy; party-only modify no-ops; create fingerprint ignores adults; opId ignores party.

- [x] **Step 3: Implement**

`tryCheckIn`: SELECT adds `adults, children`. After confirmed + room resolved, **before** status flip:

```ts
this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children);
```

Not overridable.

`tryModifyReservation`:

- SELECT adds `adults, children`.
- `nextAdults = input.adults ?? reservation.adults`; `nextChildren = input.children ?? reservation.children`.
- `this.assertOccupancySync(input.roomTypeId, nextAdults, nextChildren)` before ledger writes.
- Replace the early-return (~6377) so “same dates **and** type **and** nextAdults/nextChildren” is the no-op. If only party size changes: skip release/acquire; UPDATE the two columns; emit `reservation.modified`; do **not** emit `availability.changed`.

`handlePostReservations` fingerprint (`v1-dispatch.ts` ~1546) add `adults: body.adults, children: body.children`.

`bookingReservationOpId`:

```ts
export function bookingReservationOpId(input: {
  reservationId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  guestRef: string;
  status?: 'inquiry' | 'pending' | 'confirmed';
  adults?: number;
  children?: number;
}): string {
  const status = input.status ?? 'confirmed';
  const adults = input.adults ?? 1;
  const children = input.children ?? 0;
  return `book:${input.reservationId}:${input.roomTypeId}:${input.arrivalDate}:${input.departureDate}:${input.guestRef}:${status}:${adults}:${children}`;
}
```

Update existing `booking.test.ts` expected strings to append `:1:0` (defaults).

- [x] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-lifecycle.spec.ts test/reservations-routes.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts packages/client-core/src/booking.ts packages/client-core/test/booking.test.ts apps/pms-core/test/reservations-lifecycle.spec.ts apps/pms-core/test/reservations-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): enforce occupancy on check-in and modify

EOF
)"
```

---

### Task 5: `searchReservations` + route `[105]` (append only)

**Spec:** §7, §8.2, §12 tests 17–23. §14 Q1–Q2 locked (7-day tail; navigate to folio is SPA Task 6).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`searchReservations`)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (handler + **append** `V1_ROUTES` entry)
- Modify: `packages/contracts/src/v1-http-routes.ts` (**append** `[105]`)
- Modify: `packages/contracts/src/register.test.ts` (`[105]` pin; `[104]` unchanged)
- Modify: `packages/client-core/src/api.ts` (`searchReservations`)
- Create: `apps/pms-core/test/reservations-search-routes.spec.ts`

**Interfaces:**
- Consumes: `dndFlag` on mapped rows (Task 3); `readGuests` / `post_guests_batch` chunk size 50
- Produces: `GET /v1/properties/:propertyId/reservations-search?q=`
- **Forbidden:** splicing `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT`; changing `get_reservation` pattern.

- [x] **Step 1: Write the failing tests (spec 17–23)**

`packages/contracts/src/register.test.ts` — in the route-pin test that already asserts `[104]`:

```ts
expect(V1_HTTP_ROUTE_AUDIT[104]?.id).toBe('post_room_ooo_range');
expect(V1_HTTP_ROUTE_AUDIT[105]?.id).toBe('get_reservation_search');
expect(V1_HTTP_ROUTE_AUDIT[105]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[105] ?? {})).toBe(false);
```

`apps/pms-core/test/reservations-search-routes.spec.ts` (HTTP, `crypto.randomUUID()` fixtures):

- **18.** `q` = exact `reservation_id` of a `checked_out` stay → 200 `{ ok: true, items: [one] }`.
- **19.** Unknown id → `{ ok: true, items: [] }` 200 (not 404).
- **20.** Guest `displayName` substring (case-insensitive) matches an in-house stay; erased guest does not appear in name hits.
- **21.** `q` of 1 character that is not an exact id → `{ items: [] }`.
- **22.** Force OrgDO transport failure on the name path → 503 FAIL_CLOSED (reuse existing `isOrgDoTransportFailure` test helpers if any; otherwise stub).
- **23.** Actor without `reservations:read` → 403; `pms.core` kill-switch → 402/503 entitled pair (same as other entitled reads).
- Empty/missing `q` → 400 `invalid_query`. `q` longer than 128 → 400.
- **Path:** request `GET /v1/properties/${pid}/reservations-search?q=…` — **not** `/reservations/search` (would hit `get_reservation` with id `search`).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-search-routes.spec.ts
```

Expected: FAIL — `[105]` undefined / 404 on the hyphen path.

- [x] **Step 3: Implement**

PropertyDO `searchReservations(q: string)` (sync SQL, **no OrgDO**):

1. Trim. Exact `WHERE reservation_id = ?` → 0–1 row, any status, mapped like `mapFrontDeskRow` + `dndFlag`. Return `{ ok: true, items, mode: 'exact' }`.
2. Else if `q.length < 2` → `{ ok: true, items: [], mode: 'name' }`.
3. Else name candidates: `status IN ('inquiry','pending','confirmed','checked_in')` OR (`status IN ('checked_out','cancelled','no_show')` AND `departure_date >= date(openDate, '-7 days')`) where `openDate = this.readBusinessDateSync()` (if null, active-only is acceptable only if tests always provision a date — prefer failing the RPC with a 500/unset only if other reads already do; otherwise use provisioned date). `ORDER BY arrival_date DESC, reservation_id` **LIMIT 200**. Return `{ ok: true, items, mode: 'name' }`.

Dispatcher `handleGetReservationSearch`:

- `q` from `url.searchParams`, trim, 1–128 chars else 400 `{ error: 'invalid_query' }`.
- `resolvePropertyContext` + entitlement `pms.core`.
- Call `searchReservations`.
- Exact mode: `readGuests` for that one `guestRef` (optional hydrate; still return the stay if guest missing). OrgDO blip → `degradedFailClosedReadResponse()` / 503 — **do not** return the stay unclassified.
- Name mode: unique `guestRef`s, `readGuests` in chunks of 50. Filter `profile.displayName` with case-insensitive `includes(q)`. Skip erased / not_found / decrypt_unresolved (log `guests.read.decrypt_incident` on decrypt_unresolved). Cap **20**. Sort arrival_date DESC, reservation_id.
- Response `{ ok: true, items }` 200. Items are stay rows (guest name hydration may add `displayName` if cheap; SPA already has `postGuestsBatch` — returning `guestRef` is enough; include `displayName` when resolved to spare a second round-trip).

**Append** to `V1_HTTP_ROUTE_AUDIT` (after `post_room_ooo_range`):

```ts
{
  id: 'get_reservation_search',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

**Append** to `V1_ROUTES` (after `handlePostRoomOooRange`):

```ts
{
  scope: 'property',
  method: 'GET',
  pattern: /^\/v1\/properties\/([^/]+)\/reservations-search$/,
  permission: 'reservations:read',
  entitlement: 'pms.core',
  handler: handleGetReservationSearch,
},
```

`packages/client-core/src/api.ts`:

```ts
async searchReservations(propertyId: string, q: string) {
  return getJson(
    `/v1/properties/${enc(propertyId)}/reservations-search?q=${encodeURIComponent(q)}`,
  );
}
```

- [x] **Step 4: Rebuild contracts, re-run tests, check:permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-search-routes.spec.ts
```

Expected: all exit 0. `check:permissions` length matches (audit and dispatch both +1 at the end; index 105 fields match).

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts packages/client-core/src/api.ts apps/pms-core/test/reservations-search-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add reservation search route [105]

EOF
)"
```

---

### Task 6: SPA — search, party size, editor, badges, print

**Spec:** §3.4, §4.3–4.4, §5, §6, §7.5, §10, §12 tests 11–15, 24. §14 Q2 locked: click → folio. Q3 locked: comment max 2000.

**Files:**
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Create: `apps/web-pms/src/shell/AppShell.search.test.tsx`
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx`
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx`
- Modify: `apps/web-pms/src/shell/AppShell.me.test.tsx` (mock `searchReservations` if the default api mock is exhaustive)
- **Do not** modify `HousekeepingScreen.tsx` / `modules/pms/housekeeping`.

**Interfaces:**
- Consumes: `api.searchReservations`, `dndFlag`, `updateFrontOffice({ frontOfficeComment, vipFlag, dndFlag })` **without** `noPost`, `bookingReservationOpId` with adults/children
- Produces: desk UX listed in spec §10
- **Forbidden:** sending `noPost` from the editor; `window.print` when reservation/guest read is not live.

- [x] **Step 1: Write the failing SPA tests**

- **11.** `BookingScreen.test.tsx`: adults/children inputs exist (`data-testid="adults"` / `"children"`); `createReservation` called with those values; `occupancy_exceeded` body shows *“Party exceeds this room type’s occupancy.”*
- **12–14.** `CheckInScreen.test.tsx` / `FolioScreen.test.tsx`: `data-testid="print-reg-card"` enabled when reservation + resolved guest; disabled when guest `name_pending` / erased / reservation `fail_closed`; mock `window.print` and assert **not** called when disabled. Printed region (`data-testid="reg-card"`) contains reservation id, displayName, dates, adults/children; does **not** contain folio `balanceMinor`.
- **15.** Folio editor: fill comment + check VIP + DND; submit calls `updateFrontOffice` with `{ frontOfficeComment, vipFlag, dndFlag }` and **no** `noPost` key. Existing `toggle-no-post` still calls `{ noPost: … }` only. Comment 2001 chars: client may slice or show error; server 422 is covered in Task 3 — SPA can disable submit when `comment.length > 2000`.
- **24.** `AppShell.search.test.tsx`: with `reservations:read` on live `me`, `data-testid="reservation-search"` present; typing + mocked `searchReservations` shows a hit; click navigates to `/folio/:id`. Without `reservations:read`, control absent. `fail_closed` on search shows *“Search unavailable — property unreachable.”*

Mock `api.searchReservations` / `updateFrontOffice` / `postGuestsBatch` in each file’s `vi.mock('../client.js')` (copy the existing mock shape; add missing fns).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx src/screens/CheckInScreen.test.tsx src/screens/FolioScreen.test.tsx src/screens/BoardScreen.test.tsx src/shell/AppShell.search.test.tsx
```

Expected: FAIL — missing testids / payloads.

- [x] **Step 3: Implement SPA**

`AppShell.tsx`: after nav, if `hasPropertyPermission(me, 'reservations:read')` (live authority only — hide on `unknown` / `no_access`), render `<div role="search">` with input `data-testid="reservation-search"`. Debounce 300ms. Call `api.searchReservations`. Popover: guest label (or id), reservation id, dates, status. Click / Enter-on-single-hit → `navigate(\`/folio/${encodeURIComponent(id)}\`)`. On classified `fail_closed`: the copy in spec §7.5.

`BookingScreen.tsx`: state `adults` default 1, `children` default 0. Number inputs min 1 / 0. Pass into `createReservation` and `bookingReservationOpId`. Handle `occupancy_exceeded`. Disable confirm when `adults < 1`.

Extract a small `FrontOfficeEditor` in `apps/web-pms/src/screens/front-office-editor.tsx` (same folder as screens, not a new package): comment textarea, VIP checkbox, DND checkbox, submit. Payload **only** `{ frontOfficeComment, vipFlag, dndFlag }`. Reuse on Folio + Check-in. Do not include the no-post button (Folio already has `toggle-no-post`).

`CheckInScreen.tsx`: show `Adults {n} · Children {m}` from GET reservation; mount editor; print control.

Print panel: hidden except `@media print` (and visible in a `data-testid="reg-card"` node for tests). Fields per spec §5.1. Disable print unless reservation query success **and** guest `kind === 'resolved'`. Copy when disabled: *“Registration card is unavailable while the property is unreachable.”* Call `window.print()` only when enabled.

`BoardScreen.tsx`: VIP / DND badges (`data-testid="badge-vip"` / `"badge-dnd"`) on the guest cell when flags are true.

`HousekeepingScreen.tsx`: unchanged.

- [x] **Step 4: Re-run SPA tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx src/screens/CheckInScreen.test.tsx src/screens/FolioScreen.test.tsx src/screens/BoardScreen.test.tsx src/shell/AppShell.search.test.tsx src/shell/AppShell.me.test.tsx
```

Expected: PASS (including existing me / folio tests).

- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/AppShell.tsx apps/web-pms/src/shell/AppShell.search.test.tsx apps/web-pms/src/shell/AppShell.me.test.tsx apps/web-pms/src/screens/BookingScreen.tsx apps/web-pms/src/screens/BookingScreen.test.tsx apps/web-pms/src/screens/CheckInScreen.tsx apps/web-pms/src/screens/CheckInScreen.test.tsx apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/FolioScreen.test.tsx apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/BoardScreen.test.tsx apps/web-pms/src/screens/front-office-editor.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): search, party size, front-office editor, and reg card print

EOF
)"
```

---

### Task 7: Sibling spec pointers + ARCHITECTURE §16.5

**Spec:** header Amends, §15 last bullet.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` (leftover 1: DND is stay flag, shipped this chunk)
- Modify: `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` (§8.1 defer ratified; §8.2 card is a printable view, not an R2 engine)
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` (§7.1 occupancy remainder closed)
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` (top-bar search is shell, not wizard guest-dedupe)
- Modify: `ARCHITECTURE.md` §16.5 still-unnamed table: record keep/defer/drop per spec §1.2 (one line per row, pointer to this spec). Do not rewrite the rest of §16.

One sentence each. No product changes.

- [x] **Step 1: Edit the five docs**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md docs/superpowers/specs/2026-08-11-booking-wizard-design.md ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: point sibling specs at prototype holes sweep

EOF
)"
```

---

### Task 8: Full CI locally

**Spec:** §12 tests 25–26, §9 purge/denylist, §15.

**Verification that must not be skipped (empty delta is still a check):**

```bash
git diff -- tooling/eslint-plugin-hospai/src/class-denylist.ts apps/pms-core/src/property-do.ts | rg -n 'CLASS_DENYLIST|PROPERTY_PURGE_INVENTORY_TABLES|countPropertyInventoryRows' || true
```

Expected: **no** hunks that add/remove denylist names or purge table names. Then `pnpm check:class-denylist` and `pnpm check:purge` in the sequence below must exit 0. If a new `export class` or table slipped in, stop and revert — this chunk forbids both.

- [x] **Step 1: Run the `checks` job commands in order**

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
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
```

Expected: all exit 0. `pnpm build` rebuilds `@hospai/contracts` and `@hospai/pms-housekeeping` dist (room-ops lesson) before later steps.

Pins: `AUDIT_WRITER_COMMAND_IDS.size === 45`; `PLATFORM_GAPS` `[]`; `NIGHT_AUDIT_STEPS.length === 7`; `SYSTEM_CHARGE_CODES` unchanged; `PROPERTY_SCHEMA_HEAD === 23`.

- [x] **Step 2: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

- [x] **Step 3: Tick living checkboxes on this plan**

Mark Tasks 1–8 steps `- [x]` in this file. Same PR as the last implementation commit, or a docs commit in that PR. **Not** before merge.

- [x] **Step 4: Commit only if Step 3 left docs dirty**

```bash
git add docs/superpowers/plans/2026-08-13-prototype-holes-sweep.md
git commit -m "$(cat <<'EOF'
docs: tick prototype holes sweep plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip the commit.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Catalog notes DND; no new command; `check:permissions` green without new routes | 1 |
| v23 `dnd_flag`; generate:ddl; head 23; MemorySql; real-sqlite CHECK | 2 |
| `tryUpdateFrontOffice` dndFlag; comment 2000; HTTP/replay; undefined-means-unchanged vs noPost | 3 |
| Check-in occupancy; modify occupancy + party-only; create fingerprint adults/children | 4 |
| `searchReservations` + `[105]` appended; hyphen path; FAIL_CLOSED; 7-day tail | 5 |
| AppShell search → folio; wizard party; editor omit noPost; badges; print never in degraded | 6 |
| Sibling pointers + §16.5 decisions | 7 |
| Full `ci.yml`; four shards; purge + CLASS_DENYLIST verified unchanged | 8 |
| Recurring / HK extras / photos / keyless / inclusions | out of scope (spec leftovers) |
