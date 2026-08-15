# Virtual room types (run-of-house OR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Approved (reviewer, 2026-08-14). Implement task-by-task. Do not skip D6.

**Goal:** Close ARCHITECTURE.md §7.1 physical/virtual room types for v1 run-of-house (OR): define a virtual sales SKU over ≥2 physical constituents, quote/book on `/book`, allocate one physical type at inventory commit, and check in against the allocated type — without new catalog commands or HTTP audit rows.

**Architecture:** Property schema **v27** adds `room_type.kind`, `room_type_constituent`, and `reservation.allocated_room_type_id`. Pure allocation + virtual free-sum live in `@hospai/pms-inventory` (zero platform imports; restriction eligibility passed as a predicate). PropertyDO extends existing `inventory.*` / reservation writers; `GET /availability` Branch 1 stays **pure KV** for physical filtered reads — virtual ids never hit ARI_KV, so KV miss falls through to Branch 2 where PropertyDO synthesizes rows with precomputed `free`. SPA: Inventory kind + constituents; Booking lists virtual types; Check-in filters by `allocatedRoomTypeId`.

**Tech Stack:** PropertyDO + sqlite migrations (`packages/do-runtime`, `apps/pms-core`), `@hospai/pms-inventory`, `@hospai/contracts` (`freeAvailability`, wire codes), `@hospai/client-core`, React SPA (`InventoryScreen`, `BookingScreen`, `CheckInScreen`), vitest (Worker specs + RTL).

**Spec:** `docs/superpowers/specs/2026-08-14-virtual-room-types-design.md`. Spec commit: `870434a`.

---

## Sequencing gate (read before starting)

This slice closes **ARCHITECTURE.md §7.1 virtual room types (OR only)**. Property setup SPA §1.3 virtual-types scope-out closes here.

| After this plan | Do not start |
|---|---|
| Virtual ROH book + allocate + check-in | Combined-unit AND virtual |
| Inventory SPA virtual create/edit | Reallocate constituent on date modify |
| Synthetic virtual availability GET | Allocate at check-in |
| | Demo seed ROH SKU rewrite |
| | Nested virtual / KV materialization for virtual |
| | New `COMMAND_CATALOG` rows or `v1-http-routes` append |
| | `NIGHT_AUDIT_STEPS` growth, `PLATFORM_GAPS` resurrection |

---

## Open decisions (locked here; spec §16 — do not re-litigate)

### D1 — Extend inventory commands

**Locked:** `inventory.add_room_type` / `update_room_type` / `delete_room_type` only. No new catalog id. Physical create fingerprint **byte-identical** when `kind` omitted.

### D2 — Allocate at book

**Locked:** First `sold` write (create `pending|confirmed`, inquiry→confirm) runs allocation; `allocated_room_type_id = ''` only for pre-commit inquiry/pending without sold.

### D3 — Restrictions OR model

**Locked:** Optional virtual-SKU product gate + per-constituent eligibility; King stop-sell does **not** block Queen allocation.

### D4 — Modify dates

**Locked:** Same sold SKU → keep allocation; fail `no_availability` on allocated type; no silent reallocate.

### D5 — HTTP reads only

**Locked:** Widen `GET /room-types`, `GET /reservations/:id`, `GET /availability`. `[127] = post_demo_seed` unmoved.

### D6 — Reviewer locks at plan approval (do not re-litigate)

1. **`generate:ddl` is not automatic.** Task 1 **must** export `VIRTUAL_ROOM_TYPES_V27_SQL` / `VIRTUAL_ROOM_TYPES_V27_STATEMENTS` from `packages/do-runtime/src/index.ts` and add a `doPropertyTargets` entry in `scripts/property-ddl.mjs` (mirror v26 `CARD_DISPLAY_TOKEN_V26_SQL` at `0026_card_display_token.sql`). Without that, `pnpm generate:ddl` will not write `0027_virtual_room_types.sql`. Do not hand-edit the generated SQL. Do not `|| true` the DDL diff.
2. **SQLite migration test is house style.** Follow `packages/do-runtime/src/card-display-token-migration.sqlite.test.ts` — add `virtual-room-types-migration.sqlite.test.ts`. Apply migrations ≤26, insert a real `room_type` + `reservation` row, apply v27, assert `kind='physical'`, `allocated_room_type_id` backfill equals `room_type_id`, and `room_type_constituent` table exists.
3. **Contracts head pin:** do **not** use `-t "COMMAND_CATALOG|post_demo_seed"`. Use `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` plus `migrate.test.ts` schema-head pin **27**.
4. **Unsharded `pnpm --filter @hospai/pms-core test` may segfault** — use `vitest run <file>` or `--shard=N/8` with **no** `--` before `--shard`. CI shards are **8**.
5. **Rebuild client-core** after `packages/client-core/src/api.ts` change: `pnpm --filter @hospai/client-core build` before `@hospai/web-pms` tests.
6. **Fixture dates:** `crypto.randomUUID()` keys; `check:pms-core-test-dates`.
7. **No new `export class`** (`check:class-denylist`).
8. **Register `room_type_constituent`** in `PROPERTY_PURGE_INVENTORY_TABLES` and `countPropertyInventoryRows`.
9. **Domain allocation** lives in `@hospai/pms-inventory`. Use `freeAvailability` from `@hospai/contracts`. Restriction eligibility is a **predicate argument** — inventory does not import `@hospai/pms-restrictions`.
10. **Living plan checkboxes:** tick `- [x]` on the final CI task only.
11. **Pointer sentence** in `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` §1.3 when this chunk lands (one sentence, bidirectional).
12. **Do not touch** demo-seed, `v1-http-routes.ts` append, `NIGHT_AUDIT_STEPS`.
13. **Physical ARI KV path unchanged.** Branch 1 `handleGetAvailability` stays pure KV when `roomTypeId` is supplied — **no** PropertyDO kind lookup or stub resolve before the KV loop. Virtual ids are never written to `ARI_KV`; a full KV miss already falls through to Branch 2 (`readAvailabilityRange`). Do **not** add `readRoomTypeKind` or any new PropertyDO RPC for kind.
14. **Synthetic virtual `free` precomputed on DO rows.** Widen `readAvailabilityRange` row type with optional `free?: number`. Physical rows omit `free` (dispatch keeps today’s bucket formula). Virtual synthetic rows: buckets all 0, `free: sumConstituentFree(...)`. Branch 2 mapping: `free: row.free ?? (row.physical - row.blocked - row.held - row.sold + row.oversell)`. Do **not** call `freeAvailability` on virtual zero-bucket rows.
15. **Nested virtual wire code.** In `validateVirtualConstituentsSync`: if id exists and `kind === 'virtual'` → `VIRTUAL_NESTED_FORBIDDEN`. If missing, archived, or not `kind === 'physical'` → `VIRTUAL_CONSTITUENT_NOT_PHYSICAL`.
16. **Fingerprint variable naming.** Use `fpInput` (or similar) for the payload object; `const fingerprint = await fingerprintPayload(fpInput)`. Never name the object `fingerprintPayload` and shadow the import.
17. **POST `/room-types` virtual body.** When `body.kind === 'virtual'`, `roomCount` is optional (default 0); require `constituentRoomTypeIds`. Pass `kind` + `constituentRoomTypeIds` through `commandPayload` into `tryAddRoomType`. Physical path unchanged (`roomCount` still required; fingerprint still omits `kind`).
18. **`no_availability` HTTP 409.** Do **not** change `mapReservationCommandErrorStatus` (existing map returns **409** for `NO_AVAILABILITY`). Stub/HTTP tests for Tasks 6/8 assert the error **string** `no_availability` / `NO_AVAILABILITY`. Spec §13 “422 no_availability” on reservation commits is a slip vs the tree — inventory virtual validation stays **422**.
19. **Task 1 sqlite INSERT.** Use the house-style minimal column list from `prototype-holes-migration.sqlite.test.ts` — not a speculative full reservation column list.
20. **`restriction_violated` payload (Task 6).** When `allocateVirtualConstituent` returns `restriction_violated`, do **not** invent `new RestrictionViolatedError('stop_sell', arrival)`. Re-run `restrictionFailureSync` on the first free-every-night constituent that failed `restrictionClean` and rethrow that `RestrictionViolatedError`. Product-level virtual-SKU gate already throws the real error before allocation.
21. **Task 4 vs Task 6 reservation read sequencing.** Task 4 GET reservation tests assert the response **includes** `allocatedRoomTypeId` as a string (may be `''` for reservations created before Task 6 — v27 default). Equality `allocatedRoomTypeId === roomTypeId` for physical inventory-committing books is a **Task 6** acceptance assertion, not Task 4.

---

## Global Constraints

- **Heads frozen except property schema:** `COMMAND_CATALOG.length === 77`; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS = []`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 7`.
- **Property schema only:** `PROPERTY_SCHEMA_HEAD` **26 → 27**. Regenerate DDL: `pnpm generate:ddl` → `migrations/do-property/0027_virtual_room_types.sql`.
- **Virtual invariants:** `room_count = 0`; no `availability_day` / `room` rows for virtual ids; `reconcileHorizon` skips `kind = 'virtual'`; virtual metadata writes emit `inventory.room_type_changed` only — **no** `availability.changed`.
- **Ledger:** decrement `sold` on **allocated** physical type only; never on virtual id. Property tests assert `sold` on physical types matches reservations’ **`allocated_room_type_id`**.
- **No new catalog commands or HTTP audit rows.** Widen existing GETs + inventory payloads in place.
- **Integer money / append-only folio** unchanged. Domain modules zero platform imports.
- **Visual identity:** existing `@hospai/ui-kit` + tokens; no Tailwind; no new hex; `check:web-pms-colors` clean.
- **Rebuild client-core** after `api.ts` widen: `pnpm --filter @hospai/client-core build` before web-pms tests.
- **Vitest sharding:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (no `--` before `--shard`).
- **Reservation `no_availability` HTTP status:** **409** via existing `mapReservationCommandErrorStatus` — do not change the map (D6.18).

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `VIRTUAL_ROOM_TYPES_V27_*` + `PROPERTY_MIGRATIONS` v27 | 1 |
| `packages/do-runtime/src/index.ts` | Re-export v27 SQL constants | 1 |
| `scripts/property-ddl.mjs` | Write `0027_virtual_room_types.sql` | 1 |
| `migrations/do-property/0027_virtual_room_types.sql` | Generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | Pin head **27** | 1 |
| `packages/do-runtime/src/virtual-room-types-migration.sqlite.test.ts` | **New.** Real sqlite v27 on populated v26 | 1 |
| `apps/pms-core/src/property-do.ts` | Purge list; kind/constituents CRUD; allocate; writers; reads | 1, 3–8 |
| `modules/pms/inventory/src/domain/virtual-allocation.ts` | **New.** `allocateVirtualConstituent` | 2 |
| `modules/pms/inventory/src/domain/virtual-free.ts` | **New.** `sumConstituentFree` | 2 |
| `modules/pms/inventory/src/domain/virtual-allocation.test.ts` | **New.** King/Queen ROH unit tests | 2 |
| `modules/pms/inventory/src/index.ts` | Re-export domain fns | 2 |
| `packages/contracts/src/idempotency.ts` | Virtual wire error constants | 3 |
| `packages/contracts/src/idempotency.test.ts` | Pin new wire codes | 3 |
| `apps/pms-core/src/v1-dispatch.ts` | Widen POST/PUT room-types body + fingerprint; Branch 2 availability `free` mapping | 3, 5 |
| `apps/pms-core/test/virtual-room-types.spec.ts` | **New.** §13 tests 4–9 | 3 |
| `apps/pms-core/test/virtual-reads.spec.ts` | **New.** §13 tests 19–20 | 4 |
| `apps/pms-core/test/virtual-availability.spec.ts` | **New.** §13 test 11 | 5 |
| `apps/pms-core/test/virtual-reservations.spec.ts` | **New.** §13 tests 10, 12–14, 17–18 | 6, 8 |
| `apps/pms-core/test/virtual-check-in.spec.ts` | **New.** §13 tests 15–16 | 7 |
| `packages/client-core/src/api.ts` | Widened room-type + reservation types | 4, 9 |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | Virtual kind UI | 9 |
| `apps/web-pms/src/screens/InventoryScreen.test.tsx` | §13 test 21 | 9 |
| `apps/web-pms/src/screens/BookingScreen.tsx` | ROH hint | 10 |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Allocated filter + label | 10 |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | §13 test 22 | 10 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | One-sentence pointer (D6.11) | 11 |
| this plan file | Tick checkboxes | 11 |

**Not touched:** `scripts/demo-seed.mjs`, `packages/contracts/**` catalog length, `v1-http-routes.ts` append, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`.

---

## Spec §13 → implementation map

| # | Acceptance test | Task |
|---|---|---|
| 1 | Schema head 27 + DDL match | 1, 11 |
| 2 | Catalog/route/audit heads unchanged | 11 |
| 3 | Purge list includes constituent table | 1 |
| 4 | Virtual min two constituents | 3 |
| 5 | Nested virtual forbidden | 3 |
| 6 | `rooms.create` on virtual → 422 | 3 |
| 7 | Archive physical constituent → `constituent_in_use` | 3 |
| 8 | Virtual occupancy exceeds constituents | 3 |
| 9 | Archive virtual with live reservation | 3 |
| 10 | Book ROH → sold on allocated only | 6 |
| 11 | Synthetic virtual `free` = sum | 5 |
| 12 | Shared pool oversell / third book fails | 6 |
| 13 | King stop-sell → allocates Queen | 6 |
| 14 | Virtual SKU stop-sell → `restriction_violated` | 6 |
| 15 | Check-in Queen room on King allocation → mismatch | 7 |
| 16 | Assign King room → success | 7 |
| 17 | Modify dates keeps allocation | 8 |
| 18 | Cancel releases allocated physical sold | 8 |
| 19 | GET room-types `kind` + constituents | 4 |
| 20 | GET reservation `allocatedRoomTypeId` | 4 |
| 21 | InventoryScreen virtual create | 9 |
| 22 | CheckInScreen allocated filter | 10 |

---

### Task 1: Property schema v27 + DDL + sqlite migration test + purge list

**Spec:** §3, §13 #1–3, D6.1–2, D6.8.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `scripts/property-ddl.mjs`
- Create (generated): `migrations/do-property/0027_virtual_room_types.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Create: `packages/do-runtime/src/virtual-room-types-migration.sqlite.test.ts`
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` only

**Forbidden this commit:** inventory command logic, SPA, reservation writers.

**Migration shape (normative — mirror v26 pattern):**

```ts
export const VIRTUAL_ROOM_TYPES_V27_STATEMENTS = [
  `ALTER TABLE room_type ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical', 'virtual'))`,
  `CREATE TABLE room_type_constituent (
  virtual_room_type_id   TEXT NOT NULL,
  physical_room_type_id  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (virtual_room_type_id, physical_room_type_id),
  FOREIGN KEY (virtual_room_type_id) REFERENCES room_type(room_type_id),
  FOREIGN KEY (physical_room_type_id) REFERENCES room_type(room_type_id)
)`,
  `CREATE INDEX room_type_constituent_physical_idx ON room_type_constituent (physical_room_type_id)`,
  `ALTER TABLE reservation ADD COLUMN allocated_room_type_id TEXT NOT NULL DEFAULT ''`,
  `UPDATE reservation SET allocated_room_type_id = room_type_id WHERE allocated_room_type_id = ''`,
] as const;

export const VIRTUAL_ROOM_TYPES_V27_SQL =
  VIRTUAL_ROOM_TYPES_V27_STATEMENTS.join(';\n\n') + ';\n';

// PROPERTY_MIGRATIONS tail:
{ version: 27, name: 'virtual_room_types', statements: VIRTUAL_ROOM_TYPES_V27_STATEMENTS },
```

**Purge list patch (`property-do.ts` ~1172–1234):**

```ts
const PROPERTY_PURGE_INVENTORY_TABLES = [
  // ...existing tables in same order...
  'room_type_constituent',
  'room_type',
  // ...
] as const;

// countPropertyInventoryRows SELECT — add before room_type term:
(SELECT COUNT(*) FROM room_type_constituent) +
```

- [ ] **Step 1: Add v27 statements + PROPERTY_MIGRATIONS entry + purge list**

Follow `CARD_DISPLAY_TOKEN_V26_STATEMENTS` at ~978–1116 in `property-migrations.ts`. Insert `'room_type_constituent'` in `PROPERTY_PURGE_INVENTORY_TABLES` immediately before `'room_type'` (FK order). Add matching `+ (SELECT COUNT(*) FROM room_type_constituent)` term in `countPropertyInventoryRows`.

- [ ] **Step 2: Write failing migrate.test.ts assertions**

Update both `expect(PROPERTY_SCHEMA_HEAD).toBe(26)` sites (~608, ~745) to **27**. Add:
- `property schema head is 27 after virtual_room_types`
- `migrations/do-property/0027_virtual_room_types.sql matches VIRTUAL_ROOM_TYPES_V27_SQL` (same strip-comments pattern as v26 ~754–763).

- [ ] **Step 3: Write failing sqlite migration test**

`virtual-room-types-migration.sqlite.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('virtual_room_types v27 real sqlite', () => {
  it('ADDs kind, constituent table, allocated_room_type_id with backfill', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 26)) {
      execAll(db, m.statements!);
    }

    db.exec(
      `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
       VALUES ('rt_king', 'KNG', 'King', 1, 2, 2, 'active', 0, 0)`,
    );
    db.exec(
      `INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
       VALUES ('res1', 'rt_king', 'guest1', 'pii1', '2026-08-15', '2026-08-16', 'confirmed', 0, 0)`,
    );

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version === 27)) {
      execAll(db, m.statements!);
    }

    const rt = db
      .prepare(`SELECT kind FROM room_type WHERE room_type_id = 'rt_king'`)
      .get() as { kind: string };
    expect(rt.kind).toBe('physical');

    const res = db
      .prepare(`SELECT allocated_room_type_id FROM reservation WHERE reservation_id = 'res1'`)
      .get() as { allocated_room_type_id: string };
    expect(res.allocated_room_type_id).toBe('rt_king');

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_type_constituent'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Wire DDL generator, regenerate, run tests**

Export `VIRTUAL_ROOM_TYPES_V27_SQL` / `VIRTUAL_ROOM_TYPES_V27_STATEMENTS` from `packages/do-runtime/src/index.ts`. Add `scripts/property-ddl.mjs` import + `doPropertyTargets` entry:

```js
{
  path: join(root, 'migrations/do-property/0027_virtual_room_types.sql'),
  header: `-- PropertyDO virtual room types — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: room_type.kind, room_type_constituent, reservation.allocated_room_type_id backfill.

`,
  sql: VIRTUAL_ROOM_TYPES_V27_SQL,
},
```

Then:

```bash
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run \
  src/migrate.test.ts \
  src/virtual-room-types-migration.sqlite.test.ts
```

Expect generated `migrations/do-property/0027_virtual_room_types.sql` in this commit.

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/virtual-room-types-migration.sqlite.test.ts \
  scripts/property-ddl.mjs \
  migrations/do-property/0027_virtual_room_types.sql \
  apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(do-runtime): add v27 virtual room types schema

Add room_type.kind, room_type_constituent, and reservation
allocated_room_type_id with backfill; register constituent table in purge census.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Domain `allocateVirtualConstituent` + `sumConstituentFree` + unit tests

**Spec:** §6, §7 step 2–3, D6.9.

**Files:**
- Create: `modules/pms/inventory/src/domain/virtual-allocation.ts`
- Create: `modules/pms/inventory/src/domain/virtual-free.ts`
- Create: `modules/pms/inventory/src/domain/virtual-allocation.test.ts`
- Modify: `modules/pms/inventory/src/index.ts`

**Forbidden this commit:** `property-do.ts`, SPA, HTTP.

**Types (normative):**

```ts
// virtual-allocation.ts
import { freeAvailability } from '@hospai/contracts';

export type ConstituentAvailabilityRow = {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
};

export type AllocateVirtualInput = {
  nights: readonly string[];
  constituentIds: readonly string[];
  /** constituentId → stayDate → row (missing night → 0 free) */
  availabilityByConstituent: ReadonlyMap<string, ReadonlyMap<string, ConstituentAvailabilityRow>>;
  restrictionClean: (constituentId: string) => boolean;
};

export type AllocateVirtualResult =
  | { ok: true; allocatedRoomTypeId: string }
  | { ok: false; error: 'no_availability' }
  | { ok: false; error: 'restriction_violated' };

export function allocateVirtualConstituent(input: AllocateVirtualInput): AllocateVirtualResult {
  const eligible: Array<{ id: string; minFree: number }> = [];
  let sawFreeEveryNight = false;
  let sawFreeButRestricted = false;

  for (const id of input.constituentIds) {
    let minFree = Number.POSITIVE_INFINITY;
    let freeEveryNight = true;
    for (const night of input.nights) {
      const row = input.availabilityByConstituent.get(id)?.get(night);
      const free = row ? freeAvailability(row) : 0;
      if (free < 1) {
        freeEveryNight = false;
        break;
      }
      minFree = Math.min(minFree, free);
    }
    if (!freeEveryNight) continue;
    sawFreeEveryNight = true;
    if (!input.restrictionClean(id)) {
      sawFreeButRestricted = true;
      continue;
    }
    eligible.push({ id, minFree: Number.isFinite(minFree) ? minFree : 0 });
  }

  if (eligible.length === 0) {
    if (sawFreeEveryNight && sawFreeButRestricted) {
      return { ok: false, error: 'restriction_violated' };
    }
    return { ok: false, error: 'no_availability' };
  }

  eligible.sort((a, b) => {
    if (b.minFree !== a.minFree) return b.minFree - a.minFree;
    return a.id.localeCompare(b.id);
  });
  return { ok: true, allocatedRoomTypeId: eligible[0]!.id };
}
```

```ts
// virtual-free.ts
import { freeAvailability } from '@hospai/contracts';
import type { ConstituentAvailabilityRow } from './virtual-allocation.js';

export function sumConstituentFree(
  constituentIds: readonly string[],
  stayDate: string,
  availabilityByConstituent: ReadonlyMap<string, ReadonlyMap<string, ConstituentAvailabilityRow>>,
): number {
  let sum = 0;
  for (const id of constituentIds) {
    const row = availabilityByConstituent.get(id)?.get(stayDate);
    sum += row ? freeAvailability(row) : 0;
  }
  return sum;
}
```

```ts
// index.ts additions
export {
  allocateVirtualConstituent,
  type AllocateVirtualInput,
  type AllocateVirtualResult,
  type ConstituentAvailabilityRow,
} from './domain/virtual-allocation.js';
export { sumConstituentFree } from './domain/virtual-free.js';
```

- [ ] **Step 1: Write failing unit tests**

`virtual-allocation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allocateVirtualConstituent, type ConstituentAvailabilityRow } from './virtual-allocation.js';

function row(free: number): ConstituentAvailabilityRow {
  return { physical: free, blocked: 0, held: 0, sold: 0, oversell: 0 };
}

function mapOf(
  entries: Record<string, Record<string, ConstituentAvailabilityRow>>,
): Map<string, Map<string, ConstituentAvailabilityRow>> {
  const outer = new Map<string, Map<string, ConstituentAvailabilityRow>>();
  for (const [id, nights] of Object.entries(entries)) {
    outer.set(id, new Map(Object.entries(nights)));
  }
  return outer;
}

describe('allocateVirtualConstituent', () => {
  const nights = ['2026-08-15'];

  it('King then Queen on two ROH books; third fails no_availability', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
      rt_queen: { '2026-08-15': row(1) },
    });
    const clean = () => true;

    const first = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(first).toEqual({ ok: true, allocatedRoomTypeId: 'rt_king' });

    availability.get('rt_king')!.set('2026-08-15', row(0));
    const second = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(second).toEqual({ ok: true, allocatedRoomTypeId: 'rt_queen' });

    availability.get('rt_queen')!.set('2026-08-15', row(0));
    const third = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(third).toEqual({ ok: false, error: 'no_availability' });
  });

  it('King stop-sold restriction → allocates Queen (OR model)', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
      rt_queen: { '2026-08-15': row(1) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: (id) => id !== 'rt_king',
    });
    expect(result).toEqual({ ok: true, allocatedRoomTypeId: 'rt_queen' });
  });

  it('tie-break lexicographic room_type_id when minFree equal', () => {
    const availability = mapOf({
      rt_z: { '2026-08-15': row(2) },
      rt_a: { '2026-08-15': row(2) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_z', 'rt_a'],
      availabilityByConstituent: availability,
      restrictionClean: () => true,
    });
    expect(result).toEqual({ ok: true, allocatedRoomTypeId: 'rt_a' });
  });

  it('every free constituent restricted → restriction_violated', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king'],
      availabilityByConstituent: availability,
      restrictionClean: () => false,
    });
    expect(result).toEqual({ ok: false, error: 'restriction_violated' });
  });
});
```

Add `sumConstituentFree` test: King free=1 + Queen free=2 on same night → sum 3.

- [ ] **Step 2: Implement domain files + export**

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-inventory exec vitest run src/domain/virtual-allocation.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add modules/pms/inventory/src/domain/virtual-allocation.ts \
  modules/pms/inventory/src/domain/virtual-free.ts \
  modules/pms/inventory/src/domain/virtual-allocation.test.ts \
  modules/pms/inventory/src/index.ts
git commit -m "$(cat <<'EOF'
feat(pms-inventory): add virtual ROH allocation and free-sum helpers

Pure allocateVirtualConstituent scores max minFree with lexicographic
tie-break; sumConstituentFree sums constituent free for synthetic quotes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extend inventory commands + `rooms.create` virtual guards + wire errors

**Spec:** §4, §13 #4–9, D1, D6.7, D6.15–17.

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `apps/pms-core/src/property-do.ts` — `tryAddRoomType`, `tryUpdateRoomType`, `tryDeleteRoomType`, `tryCreateRoom`, `reconcileHorizon`; new private validators + error throws
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostRoomTypes`, `handlePutRoomType` body/fingerprint
- Create: `apps/pms-core/test/virtual-room-types.spec.ts`

**Wire constants (`idempotency.ts` after inventory block):**

```ts
export const VIRTUAL_CONSTITUENTS_REQUIRED = 'virtual_constituents_required' as const;
export const VIRTUAL_CONSTITUENTS_MIN_TWO = 'virtual_constituents_min_two' as const;
export const VIRTUAL_CONSTITUENTS_DUPLICATE = 'virtual_constituents_duplicate' as const;
export const VIRTUAL_CONSTITUENT_NOT_PHYSICAL = 'virtual_constituent_not_physical' as const;
export const VIRTUAL_ROOM_COUNT_MUST_BE_ZERO = 'virtual_room_count_must_be_zero' as const;
export const VIRTUAL_NESTED_FORBIDDEN = 'virtual_nested_forbidden' as const;
export const VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS = 'virtual_occupancy_exceeds_constituents' as const;
export const ROOM_TYPE_KIND_IMMUTABLE = 'room_type_kind_immutable' as const;
export const VIRTUAL_CONSTITUENTS_ON_PHYSICAL = 'virtual_constituents_on_physical' as const;
export const CONSTITUENT_IN_USE = 'constituent_in_use' as const;
export const VIRTUAL_TYPE_NO_ROOMS = 'virtual_type_no_rooms' as const;
```

Pin string values in `idempotency.test.ts` (mirror existing `ARCHIVE_BLOCKED` test).

**`tryAddRoomType` input widen:**

```ts
input: {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount?: number;
  maxOccupancy: number;
  maxAdults: number;
  constituentRoomTypeIds?: string[];
};
```

**Virtual create path (inside transaction, after preconditions):**

```ts
const kind = input.kind ?? 'physical';
if (kind === 'virtual') {
  const constituents = this.validateVirtualConstituentsSync(input.constituentRoomTypeIds);
  this.assertVirtualOccupancyWithinConstituentsSync(
    input.maxOccupancy,
    input.maxAdults,
    constituents,
  );
  const now = Date.now();
  this.ctx.storage.sql.exec(
    `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, kind, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, 'active', 'virtual', ?, ?)`,
    input.roomTypeId,
    input.code,
    input.name,
    input.maxOccupancy,
    input.maxAdults,
    now,
    now,
  );
  for (const physicalId of constituents) {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_type_constituent (virtual_room_type_id, physical_room_type_id, created_at)
       VALUES (?, ?, ?)`,
      input.roomTypeId,
      physicalId,
      now,
    );
  }
  this.appendPropertyOutbox({ eventType: 'inventory.room_type_changed', /* op: add */ });
  // NO availability.changed, NO availability_day inserts
  return { ok: true, roomTypeId: input.roomTypeId, ariVersion: this.readAriVersionSync(), fromDate: '', toDate: '' };
}
// physical path unchanged (INSERT without kind column default 'physical' — omit kind in INSERT to use DEFAULT)
```

**`validateVirtualConstituentsSync` (private, throws Error with wire code string):**

```ts
private validateVirtualConstituentsSync(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) throw new Error(VIRTUAL_CONSTITUENTS_REQUIRED);
  const sorted = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  if (sorted.length !== ids.length) throw new Error(VIRTUAL_CONSTITUENTS_DUPLICATE);
  if (sorted.length < 2) throw new Error(VIRTUAL_CONSTITUENTS_MIN_TWO);
  for (const id of sorted) {
    const rows = this.ctx.storage.sql
      .exec(`SELECT kind, status FROM room_type WHERE room_type_id = ?`, id)
      .toArray() as Array<{ kind: string; status: string }>;
    const row = rows[0];
    if (row?.kind === 'virtual') throw new Error(VIRTUAL_NESTED_FORBIDDEN);
    if (!row || row.status !== 'active' || row.kind !== 'physical') {
      throw new Error(VIRTUAL_CONSTITUENT_NOT_PHYSICAL);
    }
  }
  return sorted;
}
```

**`reconcileHorizon` patch (~1072):**

```ts
.exec(`SELECT room_type_id, room_count FROM room_type WHERE status = 'active' AND kind = 'physical'`)
```

**`tryDeleteRoomType` guards after loading type:**

```ts
const kindRows = this.ctx.storage.sql
  .exec(`SELECT kind FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
  .toArray() as Array<{ kind: string }>;
const kind = kindRows[0]?.kind ?? 'physical';

if (kind === 'virtual') {
  const live = this.ctx.storage.sql
    .exec(
      `SELECT 1 FROM reservation WHERE room_type_id = ? AND status IN ('inquiry','pending','confirmed','checked_in') LIMIT 1`,
      input.roomTypeId,
    )
    .toArray();
  if (live.length > 0) throw new ArchiveBlockedError();
  // archive virtual: inventory.room_type_changed only; skip availability.changed / zero physical
} else {
  // existing archiveBlocked on availability_day
  const constituent = this.ctx.storage.sql
    .exec(
      `SELECT 1 FROM room_type_constituent c
         JOIN room_type v ON v.room_type_id = c.virtual_room_type_id
        WHERE c.physical_room_type_id = ? AND v.status = 'active' LIMIT 1`,
      input.roomTypeId,
    )
    .toArray();
  if (constituent.length > 0) throw new Error(CONSTITUENT_IN_USE);
}
```

**`tryCreateRoom` after loading type (~4945):**

```ts
const kindRow = this.ctx.storage.sql
  .exec(`SELECT kind FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
  .toArray() as Array<{ kind: string }>;
if (kindRow[0]?.kind === 'virtual') throw new Error(VIRTUAL_TYPE_NO_ROOMS);
```

**`handlePostRoomTypes` body validation + fingerprint (normative):**

```ts
const body = (await ctx.request.json()) as {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount?: number;
  maxOccupancy: number;
  maxAdults: number;
  constituentRoomTypeIds?: string[];
  idempotencyKey: string;
};
const kind = body.kind ?? 'physical';

if (kind === 'virtual') {
  if (
    !body.roomTypeId ||
    !body.code ||
    !body.name ||
    typeof body.maxOccupancy !== 'number' ||
    typeof body.maxAdults !== 'number' ||
    !body.idempotencyKey ||
    !body.constituentRoomTypeIds ||
    body.constituentRoomTypeIds.length === 0
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
} else if (
  !body.roomTypeId ||
  !body.code ||
  !body.name ||
  typeof body.roomCount !== 'number' ||
  typeof body.maxOccupancy !== 'number' ||
  typeof body.maxAdults !== 'number' ||
  !body.idempotencyKey
) {
  return json({ error: 'invalid_body' }, 400);
}

const fpInput =
  kind === 'virtual'
    ? {
        roomTypeId: body.roomTypeId,
        code: body.code,
        name: body.name,
        kind: 'virtual' as const,
        roomCount: 0,
        maxOccupancy: body.maxOccupancy,
        maxAdults: body.maxAdults,
        constituentRoomTypeIds: [...body.constituentRoomTypeIds!].sort((a, b) => a.localeCompare(b)),
      }
    : {
        roomTypeId: body.roomTypeId,
        code: body.code,
        name: body.name,
        roomCount: body.roomCount!,
        maxOccupancy: body.maxOccupancy,
        maxAdults: body.maxAdults,
      };
const fingerprint = await fingerprintPayload(fpInput);

const commandPayload =
  kind === 'virtual'
    ? {
        roomTypeId: body.roomTypeId,
        code: body.code,
        name: body.name,
        kind: 'virtual' as const,
        roomCount: 0,
        maxOccupancy: body.maxOccupancy,
        maxAdults: body.maxAdults,
        constituentRoomTypeIds: body.constituentRoomTypeIds,
      }
    : {
        roomTypeId: body.roomTypeId,
        code: body.code,
        name: body.name,
        roomCount: body.roomCount!,
        maxOccupancy: body.maxOccupancy,
        maxAdults: body.maxAdults,
      };
```

Constituent count/min-two/duplicate/nested validation stays in DO (`422` wire codes). HTTP 400 only when required virtual fields are absent.

- [ ] **Step 1: Write failing Worker tests**

`virtual-room-types.spec.ts` — use `provisionedPropertyStub`, `idemFor`, `TEST_OWNER_ACTOR`, `worker.fetch` for HTTP where convenient:

1. POST virtual with one constituent → 422 `virtual_constituents_min_two`
2. POST virtual with nested virtual constituent → 422 `virtual_nested_forbidden`
3. POST `/rooms` against virtual type → 422 `virtual_type_no_rooms`
4. Archive physical that is active virtual constituent → 422 `constituent_in_use`
5. Virtual `maxOccupancy: 4` over King `maxOccupancy: 2` → 422 `virtual_occupancy_exceeds_constituents`
6. Archive virtual with confirmed reservation on SKU → 422 `archive_blocked`
7. Physical add with omitted `kind` → fingerprint replay still works (idempotency byte-identical — replay same key after first success returns same result, 365 availability rows)

Helper to seed King + Queen physical types + optional ROH virtual in tests.

- [ ] **Step 2: Implement DO + dispatch + wire constants**

Map new errors in catch blocks to `{ ok: false, error: WIRE_CODE }`. `mapAddRoomTypeErrorStatus` returns 422 for virtual validation codes.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/virtual-room-types.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/virtual-room-types.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): virtual room type inventory commands and guards

Extend add/update/archive room types for virtual SKUs and constituents;
reject rooms.create on virtual types; skip reconcileHorizon for virtual.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Widen GET room-types + GET reservation

**Spec:** §5.1–5.2, §13 #19–20.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `listRoomTypes`, `readReservation`
- Modify: `packages/client-core/src/api.ts` — types only (no behavior)
- Create: `apps/pms-core/test/virtual-reads.spec.ts`

**`listRoomTypes` return shape:**

```ts
Array<{
  roomTypeId: string;
  code: string;
  name: string;
  kind: 'physical' | 'virtual';
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
  status: 'active' | 'archived';
  constituentRoomTypeIds: string[];
  createdAt: number;
  updatedAt: number;
}>
```

SQL: join constituent ids per virtual type; sort constituent ids lexicographically in JS before return. Physical → `constituentRoomTypeIds: []`.

**`readReservation` reservation object add:**

```ts
allocatedRoomTypeId: string;
```

SELECT adds `allocated_room_type_id`; map to camelCase.

**`api.ts` types:**

```ts
export type RoomTypeRead = {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
  status: 'active' | 'archived';
  constituentRoomTypeIds?: string[];
  createdAt?: number;
  updatedAt?: number;
};

// ReservationRead (~70):
allocatedRoomTypeId?: string;
```

- [ ] **Step 1: Write failing read tests**

`virtual-reads.spec.ts`:
- Seed King + Queen + ROH virtual `{King, Queen}` via stub
- `listRoomTypes('active')` → ROH has `kind: 'virtual'`, sorted `constituentRoomTypeIds`
- HTTP `GET /v1/properties/:pid/room-types` same shape
- `readReservation` / HTTP GET reservation response **includes** `allocatedRoomTypeId` as a string (may be `''` before Task 6 writes the column on insert — do not assert equality with `roomTypeId` here; that is Task 6)

- [ ] **Step 2: Implement list + read widen**

- [ ] **Step 3: Widen client types + build**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/pms-core exec vitest run test/virtual-reads.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/virtual-reads.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): widen room-type and reservation reads for virtual SKUs

Expose kind, constituentRoomTypeIds, and allocatedRoomTypeId on existing GETs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: GET availability synthetic virtual rows

**Spec:** §5.3, §13 #11, D5, D6.13–14.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — extend `readAvailabilityRange` row type + virtual synthesis helpers
- Modify: `apps/pms-core/src/v1-dispatch.ts` — Branch 2 `free` mapping only (**Branch 1 unchanged**)
- Create: `apps/pms-core/test/virtual-availability.spec.ts`

**Forbidden this commit:** `readRoomTypeKind`, any PropertyDO RPC/stub resolve before Branch 1 KV loop, any Branch 1 kind gate.

**Row type widen (`readAvailabilityRange` return):**

```ts
rows: Array<{
  roomTypeId: string;
  stayDate: string;
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
  free?: number; // present only on virtual synthetic rows
}>;
```

**PropertyDO virtual synthesis (private helpers + `readAvailabilityRange` integration):**

```ts
private readVirtualTypesWithConstituentsSync(): Array<{
  virtualId: string;
  constituentIds: string[];
}> {
  const virtuals = this.ctx.storage.sql
    .exec(`SELECT room_type_id FROM room_type WHERE status = 'active' AND kind = 'virtual'`)
    .toArray() as Array<{ room_type_id: string }>;
  return virtuals.map((v) => {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT physical_room_type_id FROM room_type_constituent
         WHERE virtual_room_type_id = ? ORDER BY physical_room_type_id`,
        v.room_type_id,
      )
      .toArray() as Array<{ physical_room_type_id: string }>;
    return { virtualId: v.room_type_id, constituentIds: rows.map((r) => r.physical_room_type_id) };
  });
}

private buildPhysicalAvailabilityMap(
  physicalRows: Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
  }>,
): Map<string, Map<string, ConstituentAvailabilityRow>> {
  const map = new Map<string, Map<string, ConstituentAvailabilityRow>>();
  for (const row of physicalRows) {
    let byDate = map.get(row.roomTypeId);
    if (!byDate) {
      byDate = new Map();
      map.set(row.roomTypeId, byDate);
    }
    byDate.set(row.stayDate, {
      physical: row.physical,
      blocked: row.blocked,
      held: row.held,
      sold: row.sold,
      oversell: row.oversell,
    });
  }
  return map;
}

private syntheticVirtualRowsForRange(
  fromDate: string,
  toDate: string,
  virtualId: string,
  constituentIds: string[],
  physicalByTypeDate: Map<string, Map<string, ConstituentAvailabilityRow>>,
): Array<{
  roomTypeId: string;
  stayDate: string;
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
  free: number;
}> {
  const out: Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    free: number;
  }> = [];
  let stayDate = fromDate;
  while (stayDate <= toDate) {
    out.push({
      roomTypeId: virtualId,
      stayDate,
      physical: 0,
      blocked: 0,
      held: 0,
      sold: 0,
      oversell: 0,
      free: sumConstituentFree(constituentIds, stayDate, physicalByTypeDate),
    });
    stayDate = addCalendarDays(stayDate, 1); // or existing enumerate helper
  }
  return out;
}
```

**`readAvailabilityRange` behavior:**

1. Load physical rows from `availability_day` SQL (unchanged filter semantics).
2. Build `physicalByTypeDate` map from those rows.
3. If `roomTypeId` supplied:
   - Lookup `room_type.kind` **inside this DO call** (already on Branch 2 — no extra HTTP-roundtrip RPC).
   - `kind === 'virtual'`: return **only** synthetic series for that virtual id (physical SQL returns nothing for virtual ids).
   - `kind === 'physical'` or missing row: return physical rows only (unchanged).
4. If `roomTypeId` omitted: return physical rows **plus** synthetic rows for every active virtual type (append after physical load).

Physical rows: **omit** `free` on the returned object.

Virtual synthetic rows: buckets all **0**, **`free: sumConstituentFree(...)`** precomputed.

**Branch 1 (`handleGetAvailability` ~7306): UNCHANGED.**

Pure KV when `roomTypeId` is supplied. Virtual ids are never written to `ARI_KV`, so a full KV miss/expiry naturally falls through to Branch 2 — that is how virtual synthesis is reached. **Do not** add stub resolve, kind lookup, or any PropertyDO call before the KV loop.

**Dispatch Branch 2 free mapping (~7392) — replace formula-only mapping:**

```ts
const items = rows.map((row) => ({
  roomTypeId: row.roomTypeId,
  stayDate: row.stayDate,
  physical: row.physical,
  blocked: row.blocked,
  held: row.held,
  sold: row.sold,
  oversell: row.oversell,
  free:
    row.free ??
    row.physical - row.blocked - row.held - row.sold + row.oversell,
}));
```

Do **not** call `freeAvailability()` on virtual zero-bucket rows. If `row.free` is omitted on a virtual synthetic row, `/book` `selectableRoomTypeIds` will see `free === 0` — the Task 5 test below is the acceptance gate.

- [ ] **Step 1: Write failing availability test**

King `physical=2`, Queen `physical=1`, ROH `{King, Queen}`:
- `GET /availability?fromDate&toDate` includes ROH rows with **`free === 3`** on a night where King sold=0 and Queen sold=0
- Filter `roomTypeId=ROH` returns only ROH synthetic series (KV miss on virtual id → Branch 2 DO synthesis)
- No `availability_day` row for ROH id (`countAvailabilityDays(rohId) === 0`)
- Physical filtered GET with `roomTypeId=rt_king` still hits KV when keys exist (Branch 1 unchanged — no DO pre-call)

- [ ] **Step 2: Implement synthesis + Branch 2 free mapping**

Branch 1: leave untouched.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/virtual-availability.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/virtual-availability.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): synthesize virtual availability on DO fallback path

Append ROH rows with precomputed free sum; preserve pure-KV Branch 1 for physical types.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Book/confirm — allocate at first sold write

**Spec:** §6, §7, §9, §13 #10, #12–14, D2–D3, D6.18, D6.20.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryCreateReservation`, `tryConfirm`, `commitSoldNightsSync` callers, `countSoldHoldingReservationsCovering`
- Create: `apps/pms-core/test/virtual-reservations.spec.ts` (book + restriction cases)

**HTTP status note:** Stub tests assert `{ error: NO_AVAILABILITY }` / `'no_availability'`. HTTP route tests expect status **409** (existing `mapReservationCommandErrorStatus` — do **not** change the map).

**Private resolver (normative):**

```ts
private resolveInventoryCommitSync(input: {
  soldRoomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  nights: string[];
}): { allocatedRoomTypeId: string; ledgerRoomTypeId: string } {
  const kindRows = this.ctx.storage.sql
    .exec(`SELECT kind FROM room_type WHERE room_type_id = ?`, input.soldRoomTypeId)
    .toArray() as Array<{ kind: string }>;
  const kind = kindRows[0]?.kind ?? 'physical';
  if (kind === 'physical') {
    return { allocatedRoomTypeId: input.soldRoomTypeId, ledgerRoomTypeId: input.soldRoomTypeId };
  }

  this.restrictionFailureSync(input.soldRoomTypeId, input.arrivalDate, input.departureDate, input.nights);

  const constituents = this.loadConstituentIdsSync(input.soldRoomTypeId);
  const availabilityByConstituent = this.loadConstituentAvailabilityMapsSync(constituents, input.nights);
  const result = allocateVirtualConstituent({
    nights: input.nights,
    constituentIds: constituents,
    availabilityByConstituent,
    restrictionClean: (constituentId) => {
      try {
        this.restrictionFailureSync(constituentId, input.arrivalDate, input.departureDate, input.nights);
        return true;
      } catch (e) {
        if (e instanceof RestrictionViolatedError) return false;
        throw e;
      }
    },
  });
  if (!result.ok) {
    if (result.error === 'restriction_violated') {
      // Re-throw the real restriction payload from the first free-every-night
      // constituent that failed restrictionClean — do not invent stop_sell.
      for (const constituentId of constituents) {
        const freeEveryNight = input.nights.every((night) => {
          const row = availabilityByConstituent.get(constituentId)?.get(night);
          return row ? freeAvailability(row) >= 1 : false;
        });
        if (!freeEveryNight) continue;
        try {
          this.restrictionFailureSync(
            constituentId,
            input.arrivalDate,
            input.departureDate,
            input.nights,
          );
        } catch (e) {
          if (e instanceof RestrictionViolatedError) throw e;
          throw e;
        }
      }
    }
    throw new NoAvailabilityError(input.nights[0]!);
  }
  return { allocatedRoomTypeId: result.allocatedRoomTypeId, ledgerRoomTypeId: result.allocatedRoomTypeId };
}
```

Product-level virtual-SKU gate (`this.restrictionFailureSync(soldRoomTypeId, ...)`) runs **before** `allocateVirtualConstituent` and throws the real `RestrictionViolatedError` for spec test #14 — keep that path unchanged.

**`tryCreateReservation` patch (~6507):**

```ts
const commitsInventory = status === 'pending' || status === 'confirmed';
let allocatedRoomTypeId = '';
let ledgerRoomTypeId = input.roomTypeId;
if (commitsInventory) {
  const commit = this.resolveInventoryCommitSync({
    soldRoomTypeId: input.roomTypeId,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    nights,
  });
  allocatedRoomTypeId = commit.allocatedRoomTypeId;
  ledgerRoomTypeId = commit.ledgerRoomTypeId;
  this.commitSoldNightsSync(ledgerRoomTypeId, input.arrivalDate, input.departureDate, nights);
}

// INSERT reservation — add allocated_room_type_id column:
// inquiry / non-commit → allocated_room_type_id = ''

// availability.changed outbox:
if (commitsInventory) {
  this.appendPropertyOutbox({
    eventType: 'availability.changed',
    payload: { propertyId, roomTypeId: ledgerRoomTypeId, fromDate, toDate, version: ariVersion },
  });
}
```

Remove direct `restrictionFailureSync(input.roomTypeId, ...)` from inside `commitSoldNightsSync` path for virtual — `resolveInventoryCommitSync` handles product + constituent gates. For physical, keep existing `commitSoldNightsSync` restriction check on sold type.

**`tryConfirm` inquiry branch (~6678):** replace `commitSoldNightsSync(reservation.room_type_id, ...)` with same resolver; UPDATE sets `allocated_room_type_id`; availability.changed uses **allocated** id.

**`countSoldHoldingReservationsCovering` (~11326):**

```sql
WHERE allocated_room_type_id = ? AND status IN (...)
  AND allocated_room_type_id != ''
```

- [ ] **Step 1: Write failing reservation tests**

`virtual-reservations.spec.ts`:
- King=1, Queen=1, ROH book → sold King=1; reservation has `roomTypeId=ROH`, `allocatedRoomTypeId=King`; no availability_day for ROH
- Two ROH + one King direct → third ROH → stub `{ ok: false, error: NO_AVAILABILITY }` (HTTP **409** if asserted via `worker.fetch`)
- King stop-sell on arrival → ROH book succeeds, allocates Queen
- Virtual SKU stop-sell → ROH book `restriction_violated` while constituents open (real rule/date from seeded restriction row)
- Property assertion: `countSoldHoldingReservationsCovering('rt_king', night)` matches ledger sold

- [ ] **Step 2: Implement resolver + create/confirm + census helper**

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/virtual-reservations.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/virtual-reservations.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): allocate virtual ROH at inventory commit

Persist allocated_room_type_id; decrement sold on allocated physical only;
run product and per-constituent restriction gates at book and inquiry confirm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Check-in / assign use `allocatedRoomTypeId`

**Spec:** §10, §13 #15–16.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `assertRoomAssignableSync`, `tryAssignRoom`, `tryCheckIn`, modify preassigned-room path (~7215)
- Create: `apps/pms-core/test/virtual-check-in.spec.ts`

**`assertRoomAssignableSync` signature change:**

```ts
private assertRoomAssignableSync(
  roomId: string,
  reservation: {
    reservationId: string;
    allocatedRoomTypeId: string;
    arrivalDate: string;
    departureDate: string;
  },
): { room_type_id: string; status: string } {
  // ...
  if (room.room_type_id !== reservation.allocatedRoomTypeId) throw new RoomTypeMismatchError();
}
```

**Call sites load `allocated_room_type_id` from reservation row; for pre-v27 empty string fallback:**

```ts
const allocated = reservation.allocated_room_type_id || reservation.room_type_id;
```

Apply in `tryAssignRoom`, `tryCheckIn`, `tryModifyReservation` preassigned check.

- [ ] **Step 1: Write failing check-in tests**

Setup: King room unit `rm_king`, Queen unit `rm_queen`, ROH booked allocating King.
- Assign/check-in Queen room → `room_type_mismatch`
- Assign/check-in King room → success

- [ ] **Step 2: Implement allocated comparisons**

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/virtual-check-in.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/virtual-check-in.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): check-in and assign against allocated room type

Match room.room_type_id to reservation allocated_room_type_id for virtual ROH.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Modify dates keep allocation; cancel/no-show/expiry release allocated

**Spec:** §11, §13 #17–18, D4, D6.18.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryModifyReservation`, `tryCancelReservation`, `tryNoShow`, `expireIfDueSync`, any other `releaseSoldNightsSync(reservation.room_type_id)` call sites
- Modify: `apps/pms-core/test/virtual-reservations.spec.ts` — add modify + cancel cases

**HTTP status note:** Date-only modify when allocated type full → stub `{ error: NO_AVAILABILITY }`; HTTP **409** if tested via routes. Do not change `mapReservationCommandErrorStatus`.

**Modify date-only (same sold SKU) patch (~7224–7300):**

```ts
const allocatedId =
  reservation.allocated_room_type_id || reservation.room_type_id;
const soldSkuChanged = reservation.room_type_id !== input.roomTypeId;

if (commitsInventory) {
  if (!soldSkuChanged && reservation.room_type_id === input.roomTypeId) {
    // date change only — keep allocatedId; release/acquire on allocatedId only
    // validate new nights on allocatedId (no reallocate)
  } else {
    // sold SKU changed — release old allocated sold; full resolveInventoryCommitSync for new SKU
  }
}

// UPDATE reservation SET ... allocated_room_type_id = ? when sold SKU changes or first commit
```

**Cancel / no-show / pending expiry:**

```ts
const ledgerId = reservation.allocated_room_type_id || reservation.room_type_id;
if (ledgerId) this.releaseSoldNightsSync(ledgerId, nights);
```

- [ ] **Step 1: Write failing modify/cancel tests**

- ROH allocated King; modify dates only when Queen still free but King full on new night → stub `{ error: NO_AVAILABILITY }`; allocation stays King (no reallocate to Queen)
- Cancel virtual reservation → King sold decrements; ROH sold SKU unchanged on reservation row until cancel clears status

- [ ] **Step 2: Implement modify/cancel/expiry ledger paths**

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/virtual-reservations.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/virtual-reservations.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): virtual modify and cancel use allocated ledger

Keep allocation on date-only modify; release sold on allocated_room_type_id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Inventory SPA virtual create/edit/archive + rooms-tab disable

**Spec:** §12.1, §13 #21.

**Files:**
- Modify: `packages/client-core/src/api.ts` — `createRoomType` / `updateRoomType` input widen
- Modify: `apps/web-pms/src/screens/InventoryScreen.tsx`
- Modify: `apps/web-pms/src/screens/InventoryScreen.test.tsx`

**`createRoomType` input:**

```ts
input: {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount?: number;
  maxOccupancy: number;
  maxAdults: number;
  constituentRoomTypeIds?: string[];
};
```

**InventoryScreen state:**

```ts
const [kind, setKind] = useState<'physical' | 'virtual'>('physical');
const [constituentIds, setConstituentIds] = useState<string[]>([]);
```

- Kind `NativeSelect`: Physical | Virtual (run-of-house)
- Virtual: hide room count field; multi-select active physical types with `data-testid="virtual-constituents"`
- Table: badge **Virtual** / **Physical**; virtual rows list constituent codes from GET
- Archive error copy for `constituent_in_use`, `virtual_*` codes in `inventoryErrorCopy`
- Rooms tab: when selected type `kind === 'virtual'`, disable create + copy “Virtual types do not have room units.”

- [ ] **Step 1: Rebuild client-core**

```bash
pnpm --filter @hospai/client-core build
```

- [ ] **Step 2: Write failing RTL test**

Mock `listRoomTypes` with King + Queen; fire virtual create with two constituents; expect `createRoomType` called with `{ kind: 'virtual', roomCount: 0, constituentRoomTypeIds: [...] }`; list shows **Virtual** badge.

- [ ] **Step 3: Implement InventoryScreen UI**

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx
pnpm check:web-pms-colors
```

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/InventoryScreen.tsx \
  apps/web-pms/src/screens/InventoryScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): inventory virtual room type create and edit

Add kind selector, constituent picker, badges, and disable room units for virtual types.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Booking ROH hint + CheckIn allocated filter/label

**Spec:** §12.2–12.3, §13 #22.

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`

**BookingScreen type picker (~typeDir):**

```tsx
const label = type.kind === 'virtual'
  ? `${type.name} (${type.code}) · Run of house`
  : `${type.name} (${type.code})`;
```

**CheckInScreen room filter (~131):**

```tsx
const assignTypeId =
  reservationQ.data?.allocatedRoomTypeId &&
  reservationQ.data.allocatedRoomTypeId !== reservationQ.data.roomTypeId
    ? reservationQ.data.allocatedRoomTypeId
    : reservationQ.data?.roomTypeId;
const typedRooms = assignTypeId
  ? rooms.filter((r) => r.roomTypeId === assignTypeId)
  : rooms;
```

**Allocated subtitle when ids differ:**

```tsx
const allocatedEntry = allocatedRoomTypeId ? typeDir.get(allocatedRoomTypeId) : undefined;
{allocatedEntry && allocatedRoomTypeId !== roomTypeId ? (
  <p className="muted">Allocated: {allocatedEntry.name || allocatedEntry.code}</p>
) : null}
```

- [ ] **Step 1: Write failing CheckInScreen test**

Mock reservation `{ roomTypeId: 'roh', allocatedRoomTypeId: 'rt_king' }`; rooms King + Queen; room select options contain King code only.

- [ ] **Step 2: Implement Booking + CheckIn UI**

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/CheckInScreen.test.tsx
pnpm check:web-pms-colors
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/screens/CheckInScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): ROH booking hint and check-in allocated room filter

Filter assignable rooms by allocatedRoomTypeId; show allocated physical label.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Property-setup spec pointer + full CI

**Spec:** §15 checklist, §13 #1–2, D6.10–11, plan housekeeping.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — one sentence in §1.3 scope-out
- Modify: `docs/superpowers/plans/2026-08-14-virtual-room-types.md` — checkboxes only

**Pointer sentence (§1.3 virtual types bullet):**

> Virtual room types (run-of-house OR) landed in [2026-08-14 virtual room types](./2026-08-14-virtual-room-types-design.md); Inventory SPA create/edit and booking/check-in consume widened GETs — constituent graphs and allocation remain PropertyDO-owned.

Add reciprocal sentence to virtual spec §1 if not already bidirectional.

- [ ] **Step 1: Pin frozen heads**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "NIGHT_AUDIT_STEPS"
```

Expect: catalog **77**; route **[127] = post_demo_seed**; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 7` (existing pin in `night-audit-room-charges.spec.ts` / `rooms-ooo.spec.ts` — run one `-t` filter above or add `expect(NIGHT_AUDIT_STEPS).toHaveLength(7)` in `virtual-room-types.spec.ts`).

- [ ] **Step 2: Run targeted virtual test superset**

```bash
pnpm --filter @hospai/do-runtime exec vitest run \
  src/migrate.test.ts src/virtual-room-types-migration.sqlite.test.ts
pnpm --filter @hospai/pms-inventory exec vitest run src/domain/virtual-allocation.test.ts
pnpm --filter @hospai/pms-core exec vitest run \
  test/virtual-room-types.spec.ts \
  test/virtual-reads.spec.ts \
  test/virtual-availability.spec.ts \
  test/virtual-reservations.spec.ts \
  test/virtual-check-in.spec.ts
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/InventoryScreen.test.tsx \
  src/screens/CheckInScreen.test.tsx
```

- [ ] **Step 3: Full CI sequence (copy `.github/workflows/ci.yml` `checks` job + pms-core matrix)**

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

- [ ] **Step 4: Tick every `- [ ]` on Tasks 1–11 in this file**

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/plans/2026-08-14-virtual-room-types.md
git commit -m "$(cat <<'EOF'
docs: add property-setup pointer and tick virtual room types plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Demo seed, nested virtual, KV materialization, and reallocate-on-modify stay deferred per spec §1.3.

---

## Spec §15 reviewer checklist (copied; implementation must satisfy)

- [ ] v27 migration: `kind`, `room_type_constituent`, `allocated_room_type_id` + backfill; head **27**.
- [ ] Extended `inventory.add_room_type` / `update` / `delete` — **no** new catalog id; physical fingerprints unchanged when `kind` omitted; virtual fingerprints include `kind` + sorted constituents.
- [ ] Virtual: no `availability_day`, no rooms, `room_count=0`; `reconcileHorizon` skips virtual; virtual create/update/archive **no** `availability.changed`.
- [ ] Virtual archive → `archive_blocked` when live reservations on SKU; physical constituent archive → `constituent_in_use`.
- [ ] Virtual occupancy ≤ min(constituents); `virtual_occupancy_exceeds_constituents` on create/update.
- [ ] `allocated_room_type_id = ''` only pre-commit; set on first sold write.
- [ ] Book allocates one constituent; decrements one physical `sold`; persists both ids.
- [ ] Quote `free` = sum constituent free; rates on virtual SKU only.
- [ ] Restrictions OR model: per-constituent eligibility + virtual-SKU product gate; King stop-sell does not block Queen allocation.
- [ ] Check-in / assign use `allocatedRoomTypeId`.
- [ ] Modify dates keeps allocation; cancel releases allocated physical.
- [ ] Widened GET room-types / reservation / availability — **no** new route audit index.
- [ ] Inventory + Book + CheckIn SPA paths per §12; tokens only; `check:web-pms-colors` clean.
- [ ] Demo seed untouched. `NIGHT_AUDIT_STEPS` **7**. `PLATFORM_GAPS` `[]`.
- [ ] Tests §13 green — mapped to Tasks 1–11.
- [ ] Pointer sentence added to property setup SPA spec when landed.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §3 schema v27 | 1 |
| §4 inventory commands | 3 |
| §5 HTTP reads | 4, 5 |
| §6 allocation algorithm | 2, 6 |
| §7 restrictions OR | 2, 6 |
| §8 rates on virtual SKU | unchanged (6 uses sold SKU for snapshot) |
| §9 reservation create | 6 |
| §10 check-in / assign | 7 |
| §11 modify / cancel | 8 |
| §12 SPA | 9, 10 |
| §13 tests 1–22 | 1–11 |
| §16 locked OQs | Open decisions D1–D6 |
| Invariant ledger never reservation-scan | 6 (`countSoldHoldingReservationsCovering`) |
| Invariant no new catalog/route | all |
| Purge census | 1 |
| Demo seed unchanged | forbidden |
| `NIGHT_AUDIT_STEPS` unchanged | forbidden |

**Gaps:** None — all §13 numbered acceptance tests map to Tasks 1–11. Booking SPA has no dedicated RTL test (spec §13 #21–22 cover Inventory + CheckIn only; Booking virtual listing is exercised via widened GET + existing `selectableRoomTypeIds` — add optional BookingScreen test only if CI reveals a regression).
