# pms.inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@hospai/pms-inventory` through PropertyDO: room-type CRUD, 365-day availability horizon seeding, idempotent outbox events, proving the §15 module contract.

**Architecture:** Pure domain in `modules/pms/inventory` (platform-free). PropertyDO owns SQL + `runIdempotent` / `transactionSync` / outbox. `freeAvailability` and wire codes live in `@hospai/contracts`. Migration v2 adds `room_type`; multi-file DDL drift check.

**Tech Stack:** Cloudflare Durable Objects SQLite, TypeScript, vitest, `@cloudflare/vitest-pool-workers`, pnpm workspaces, turbo.

## Global Constraints

- Never name sellable stock `capacity` — use `room_count` → `availability_day.physical`.
- Inventory must not use `readConfig` default for `pms.time.time_zone`; absent row → `timezone_unset`.
- `__meta.*` keys via raw SQL only — never `tryPutDomainConfig`.
- `updateRoomType` only `UPDATE`s existing ledger rows from today forward — never `INSERT` new dates.
- Archive zeros future `physical` and emits **both** `inventory.room_type_changed` and `availability.changed`.
- Domain under `modules/pms/inventory/src/domain/` must not import `@hospai/do-runtime`, `@hospai/tenant-router`, or `cloudflare:*`.
- Horizon length constant `365`; test add under `Europe/Berlin`.
- Commit to `main` after each task; TDD where the task specifies RED→GREEN.
- Spec: `docs/superpowers/specs/2026-07-27-pms-inventory-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/availability.ts` | `freeAvailability` (moved from do-runtime) |
| `packages/contracts/src/idempotency.ts` | Add `TIMEZONE_UNSET`, `OVERSELL`, `ARCHIVE_BLOCKED` |
| `packages/contracts/src/commands/catalog.ts` | `delete_room_type` events both |
| `packages/do-runtime/src/index.ts` | Re-export `freeAvailability` from contracts |
| `packages/do-runtime/src/property-migrations.ts` | `ROOM_TYPE_STATEMENTS` + migration v2 |
| `scripts/property-ddl.mjs` | Multi-file emit/check per PropertyDO migration |
| `modules/pms/inventory/**` | `@hospai/pms-inventory` package |
| `apps/pms-core/src/property-do.ts` | Inventory commands + meta helpers |
| `apps/pms-core/src/provision.ts` | First-write timezone + `__meta.property_id` |
| `apps/pms-core/test/inventory.spec.ts` | Spec success tests |
| `pnpm-workspace.yaml` | Include `modules/pms/*` |

---

### Task 1: Contracts — freeAvailability, wire codes, catalog

**Files:**
- Create: `packages/contracts/src/availability.ts`
- Create: `packages/contracts/src/availability.test.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/do-runtime/src/index.ts` (re-export)
- Modify: `packages/do-runtime/src/migrate.test.ts` (import path if needed)
- Modify: `packages/do-runtime/package.json` (already has contracts dep)

**Interfaces:**
- Produces:
  - `freeAvailability(row): number`
  - `TIMEZONE_UNSET = 'timezone_unset'`
  - `OVERSELL = 'oversell'`
  - `ARCHIVE_BLOCKED = 'archive_blocked'`
  - catalog `inventory.delete_room_type.events` includes both event names

- [ ] **Step 1: Write failing tests**

`packages/contracts/src/availability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { freeAvailability } from './availability.js';

describe('freeAvailability', () => {
  it('computes physical - blocked - held - sold + oversell', () => {
    expect(freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 })).toBe(7);
  });
});
```

Extend `idempotency.test.ts`:

```ts
import { ARCHIVE_BLOCKED, OVERSELL, TIMEZONE_UNSET } from './idempotency.js';

it('exports inventory wire codes', () => {
  expect(TIMEZONE_UNSET).toBe('timezone_unset');
  expect(OVERSELL).toBe('oversell');
  expect(ARCHIVE_BLOCKED).toBe('archive_blocked');
});
```

Add/adjust catalog test if one asserts delete events — or add:

```ts
it('inventory.delete_room_type emits availability.changed', () => {
  const c = COMMAND_CATALOG.find((x) => x.id === 'inventory.delete_room_type');
  expect(c?.events).toEqual(['inventory.room_type_changed', 'availability.changed']);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

`pnpm --filter @hospai/contracts test`

- [ ] **Step 3: Implement**

`availability.ts`:

```ts
export function freeAvailability(row: {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
}): number {
  return row.physical - row.blocked - row.held - row.sold + row.oversell;
}
```

Add constants to `idempotency.ts` (or new `errors.ts` — prefer keep with other wire codes in `idempotency.ts` or create `packages/contracts/src/errors.ts` if file gets crowded; either is fine).

Update catalog delete entry events array.

Export from `index.ts`.

In `do-runtime/src/index.ts`: remove local `freeAvailability` body; add:

```ts
export { freeAvailability } from '@hospai/contracts';
```

Update `apps/pms-core` import optionally later (can keep importing from do-runtime via re-export).

Move the freeAvailability test out of `migrate.test.ts` or leave a thin re-export smoke test.

- [ ] **Step 4: GREEN**

`pnpm --filter @hospai/contracts test && pnpm --filter @hospai/do-runtime test`

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
Move freeAvailability to contracts; add inventory wire codes and catalog events.

EOF
)"
```

---

### Task 2: PropertyDO migration v2 + multi-file DDL drift

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `scripts/property-ddl.mjs`
- Create (via generate): `migrations/do-property/0002_room_type.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts`

**Interfaces:**
- Produces: `ROOM_TYPE_STATEMENTS`, `ROOM_TYPE_SQL`, `PROPERTY_MIGRATIONS` with `{ version: 2, name: 'room_type', statements: ROOM_TYPE_STATEMENTS }`
- DDL script checks every `000N_*.sql` for do-property

- [ ] **Step 1: Failing check**

Add migration statements to TS; before regenerating, `pnpm check:ddl` should fail once script knows about v2 — implement script + statements together.

- [ ] **Step 2: Implement statements**

```ts
export const ROOM_TYPE_STATEMENTS: string[] = [
  `CREATE TABLE room_type (
  room_type_id   TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  room_count     INTEGER NOT NULL CHECK (room_count >= 0),
  max_occupancy  INTEGER NOT NULL CHECK (max_occupancy >= 1),
  max_adults     INTEGER NOT NULL CHECK (max_adults >= 1 AND max_adults <= max_occupancy),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX room_type_code_active ON room_type(code) WHERE status = 'active'`,
];

export const ROOM_TYPE_SQL = ROOM_TYPE_STATEMENTS.join(';\n\n') + ';';

export const PROPERTY_MIGRATIONS = [
  { version: 1, name: 'freeze_gate', statements: FREEZE_GATE_STATEMENTS },
  { version: 2, name: 'room_type', statements: ROOM_TYPE_STATEMENTS },
] as const;
```

Rewrite `scripts/property-ddl.mjs` do-property targets as an array of `{ file, sql }` from exported `FREEZE_GATE_SQL` and `ROOM_TYPE_SQL` (export both). Org/platform stay single-file.

Extend MemorySql in migrate tests to accept `CREATE UNIQUE INDEX` (already does) and assert migrate applies to version 2.

- [ ] **Step 3: Generate + check**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
pnpm check:ddl
pnpm --filter @hospai/do-runtime test
```

Expected: schema version 2; `0002_room_type.sql` OK.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add PropertyDO room_type migration v2 with multi-file DDL drift check.

EOF
)"
```

---

### Task 3: Scaffold `@hospai/pms-inventory` domain package

**Files:**
- Modify: `pnpm-workspace.yaml` — add `"modules/pms/*"`
- Create: `modules/pms/inventory/package.json`, `tsconfig.json`, `src/index.ts`, `src/domain/{types,horizon,guards}.ts`, `src/domain/*.test.ts`

**Interfaces:**
- Produces:
  - `HORIZON_DAYS = 365`
  - `enumerateHorizonDates(timeZone: string, fromInstant?: Date, days?: number): string[]` — `YYYY-MM-DD` in that TZ
  - `oversellDates(rows, newPhysical): string[]` using `freeAvailability` from contracts
  - `archiveBlocked(rows): boolean` — any with sold|held|blocked > 0

- [ ] **Step 1: Failing horizon test**

```ts
import { describe, expect, it } from 'vitest';
import { enumerateHorizonDates, HORIZON_DAYS } from './horizon.js';

describe('enumerateHorizonDates', () => {
  it('returns 365 dates for Europe/Berlin', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    expect(dates).toHaveLength(HORIZON_DAYS);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dates[0]).toBe('2026-07-27'); // noon UTC → still 27th in Berlin summer
    // last date is start + 364 days in that TZ
    expect(dates[dates.length - 1]).toBe('2027-07-26');
  });
});
```

(Adjust expected last date if implementation uses inclusive 365 starting today — verify arithmetic carefully; test must pin Berlin.)

Guards test:

```ts
import { freeAvailability } from '@hospai/contracts';
import { datesWithOversell } from './guards.js';

it('flags dates where projected free < 0', () => {
  const rows = [{ stayDate: '2026-08-01', physical: 10, blocked: 0, held: 0, sold: 7, oversell: 0 }];
  expect(datesWithOversell(rows, 3)).toEqual(['2026-08-01']);
  expect(freeAvailability({ ...rows[0]!, physical: 3 })).toBeLessThan(0);
});
```

- [ ] **Step 2: Implement package**

`package.json` name `@hospai/pms-inventory`, workspace dep on `@hospai/contracts`, scripts mirror `packages/money`.

Horizon implementation: use `Intl.DateTimeFormat` with `timeZone` to get calendar Y-M-D, then advance one calendar day at a time for `days` iterations (do **not** use UTC midnight arithmetic alone).

Export from `index.ts` only public symbols.

- [ ] **Step 3: Wire workspace**

```bash
pnpm install
pnpm --filter @hospai/pms-inventory test
pnpm --filter @hospai/pms-inventory build
```

Add dependency in `apps/pms-core/package.json`: `"@hospai/pms-inventory": "workspace:*"`.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add @hospai/pms-inventory domain package with horizon and oversell guards.

EOF
)"
```

---

### Task 4: Provisioning — `__meta.property_id` + first-write timezone

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — helpers `ensurePropertyId`, `ensureTimeZoneIfAbsent`, `readStoredTimeZone`, `bumpAriVersion`, `readAriVersion`
- Modify: `apps/pms-core/src/provision.ts` — call ensure helpers after jurisdiction
- Modify: `apps/pms-core/test/tenancy.spec.ts` or new assertions

**Interfaces:**
- Produces:
  - `ensureMetaPropertyId(propertyId: string): void` — raw SQL insert if absent
  - `ensureTimeZoneIfAbsent(timeZone: string, idem: IdempotencyKey): Promise<…>` — DOMAIN put only if no row
  - `readStoredTimeZone(): string | null` — null if no row (ignore register default)
  - `getPropertyId(): string | null`

- [ ] **Step 1: Test**

```ts
it('provision writes timezone into PropertyDO; missing timezone blocks inventory', async () => {
  // provision property with Europe/Berlin
  // stub.readStoredTimeZone() === 'Europe/Berlin'
  // OR open fresh DO without provision path → tryAddRoomType → timezone_unset
});
```

Implement a PropertyDO method usable from tests for the unset case: create stub without calling ensure timezone.

- [ ] **Step 2: Implement helpers**

`readStoredTimeZone`:

```ts
const rows = this.ctx.storage.sql
  .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.time.time_zone')
  .toArray();
if (!rows[0]) return null;
return JSON.parse(rows[0].value_json) as string;
```

`ensureTimeZoneIfAbsent`: if `readStoredTimeZone() !== null` return; else `tryPutDomainConfig('pms.time.time_zone', timeZone, meta, idem)`.

`ensureMetaPropertyId`: raw INSERT OR IGNORE / SELECT then INSERT for `__meta.property_id`.

Provision `syncOrgAndPropertyDo`: after `setRecordedJurisdiction`, call `ensureMetaPropertyId` and `ensureTimeZoneIfAbsent` with fingerprint of `{ propertyId, timeZone }` and key `provision:timezone:${propertyId}`.

- [ ] **Step 3: GREEN tenancy + commit**

```bash
pnpm --filter @hospai/pms-core test
git commit -m "$(cat <<'EOF'
Provision PropertyDO timezone and property_id meta on first write only.

EOF
)"
```

---

### Task 5: PropertyDO inventory commands + integration tests

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryAddRoomType`, `tryUpdateRoomType`, `tryDeleteRoomType` (archive)
- Create: `apps/pms-core/test/inventory.spec.ts`
- Modify: `README.md` Phase 0 blurb

**Interfaces:**
- Consumes: domain horizon/guards, contracts codes, do-runtime outbox/idempotency
- Produces try* result unions per spec

- [ ] **Step 1: Write inventory.spec.ts (all cases failing)**

Cover spec tests 1–8 (timezone_unset, Berlin 365 rows, replay, oversell, update no insert, archive_blocked, archive both events, code reuse). Helper to provision + get stub; use `fingerprintPayload` before calls.

- [ ] **Step 2: Implement commands**

Pattern for each:

```ts
async tryAddRoomType(input, meta, idem): Promise<...> {
  try {
    return this.ctx.storage.transactionSync(() =>
      runIdempotent(this.ctx.storage.sql, idem, () => {
        const tz = this.readStoredTimeZoneSync(); // sync read inside txn
        if (!tz) return { ok: false as const, error: TIMEZONE_UNSET };
        // insert room_type, seed dates, bump ari, appendOutbox x2
        return { ok: true as const, roomTypeId, ariVersion, fromDate, toDate };
      }),
    );
  } catch (e) {
    if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
    ...
  }
}
```

**Note:** `readStoredTimeZone` / bump ARI must be sync SQL inside `execute`. Event payloads include `propertyId` from `__meta.property_id`.

Update: load future rows; `datesWithOversell`; UPDATE physical only; no INSERT.

Archive: guard query; UPDATE status; UPDATE physical=0 where stay_date >= today; both events.

Expose test helpers: `countAvailabilityDays(roomTypeId)`, `readAriVersion()`, `listOutboxEventTypes()`.

- [ ] **Step 3: Full pipeline**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm check:ddl
```

Expected: all green; inventory tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Wire PropertyDO inventory commands through runIdempotent and horizon seeding.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `freeAvailability` in contracts | 1 |
| Wire codes + catalog delete events | 1 |
| Migration v2 + multi-file DDL | 2 |
| `@hospai/pms-inventory` domain | 3 |
| Provision timezone / property_id | 4 |
| add/update/archive + tests 1–8 | 5 |
| Updates never INSERT dates | 5 |
| Archive emits both events | 5 |
| Partial unique code index | 2 + 5 test 8 |
| Berlin 365-day test | 5 |
| `__meta` raw SQL | 4–5 |

## Self-review notes

- `transactionSync` + `runIdempotent` must both stay sync — no `await` inside.
- Horizon date math is the highest-risk domain bug — pin Berlin expectations in Task 3 before DO wiring.
- Workspace must include `modules/pms/*` or turbo will not build the package.
