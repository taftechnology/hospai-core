# pms.inventory Design (Phase 0)

**Date:** 2026-07-27  
**Status:** Approved for implementation (post §10.1)  
**Sources:** ARCHITECTURE.md §7.1, §5.1, §4.6, §14–15; command catalog `inventory.*`

## Purpose

Ship `@hospai/pms-inventory` through the module + PropertyDO stack: room-type CRUD, horizon seeding of `availability_day`, idempotent writes with outbox events. Prove the §15 module contract and the inventory → availability dependency without Queues consumers or virtual types.

## Scope

**In**

- Package `modules/pms/inventory` (`@hospai/pms-inventory`): pure domain helpers + types; public surface = `index.ts`
- Move `freeAvailability` into `@hospai/contracts` (shared by do-runtime, PropertyDO, inventory domain)
- PropertyDO migration v2: `room_type` table; multi-file DDL drift check
- Commands: `addRoomType`, `updateRoomType`, `deleteRoomType` (archive) via `runIdempotent` + `transactionSync`
- Provisioning writes `pms.time.time_zone` and `__meta.property_id` into PropertyDO **only if absent**
- Horizon seed on **add** only: 365 days from today in the property’s stored timezone; `physical = room_count`
- Events: `inventory.room_type_changed`, `availability.changed` (range payload) on add, update, **and archive**
- Update catalog: `inventory.delete_room_type` events include both event types
- Wire codes in `@hospai/contracts` for oversell / missing timezone / archive blocked

**Out**

- Virtual room types / constituent mapping
- Individual rooms, OOO, housekeeping
- Night-audit horizon extension (follow-on — see below)
- Queues consumers / ARI KV projection
- HTTP routes for inventory
- Changing timezone after first write (separate command later)
- `pms.availability.horizon_days` DOMAIN key (hardcoded 365)

## Invariants

1. **Timezone is an explicit DOMAIN row.** Inventory (and any command that decides ledger dates) must **not** use `readConfig`’s register default for `pms.time.time_zone`. If no row exists → reject with wire code `timezone_unset`. Same class of key as `currency_code`: default may be fine for display, never for ledger decisions.
2. **Vocabulary.** `room_count` = sellable rooms of this type (= `availability_day.physical`). `max_occupancy` / `max_adults` = guests per room. Never name sellable stock `capacity`.
3. **Oversell fail-closed (§4.6).** Lowering `room_count` that would make `free < 0` on any date from today forward (among **existing** ledger rows) → no write; return offending dates.
4. **Archive is ledger-first.** Guard: from **today forward**, any row with `sold > 0 OR held > 0 OR blocked > 0` → reject. On success: `status='archived'` and set `physical = 0` on all rows from today forward (past rows untouched). Readers of `availability_day` alone see unsellable stock without joining `room_type`.
5. **Missing `availability_day` row = unbookable**, not infinite free. Book paths must treat absence as no inventory.
6. **Updates never extend the horizon.** `updateRoomType` only `UPDATE`s existing `availability_day` rows from today forward. It must not `INSERT` new dates. Horizon extension belongs solely to night audit (follow-on).
7. **Atomic write.** Mutation + ledger updates + outbox + idempotency in one `transactionSync` / no-await `execute` (§10.1).
8. **Fingerprints are edge-computed** from the validated body; only the idempotency key may come from the client.
9. **`__meta.*` is a reserved prefix** for PropertyDO internal keys (jurisdiction, property_id, ari_version). Written via raw SQL — **never** `tryPutDomainConfig` (undeclared in the register). `readConfig` already rejects undeclared keys.

## Module layout

```
modules/pms/inventory/
  package.json          # @hospai/pms-inventory
  src/index.ts          # public exports only
  src/domain/           # no cloudflare / do-runtime / tenant-router imports
    types.ts
    horizon.ts          # enumerateHorizonDates(timeZone, days=365)
    guards.ts           # projected free < 0; archive eligibility helpers (pure)
```

Import `freeAvailability` from `@hospai/contracts` in domain guards and in PropertyDO / do-runtime (re-export from do-runtime for back-compat if needed).

PropertyDO depends on the package and owns SQL + §10.1 wiring. Domain never imports platform packages (lint: `no-platform-import-in-domain`).

## Data model

### `room_type` (PropertyDO migration v2)

```sql
CREATE TABLE room_type (
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
);

-- Codes may be reused after archive (hotels retire and recreate codes).
CREATE UNIQUE INDEX room_type_code_active ON room_type(code) WHERE status = 'active';
```

No FK from `availability_day` → `room_type` (v1 frozen; SQLite cannot add FK constraints). Soft-archive + zeroing `physical` is the enforcement.

### Property-level ARI version

Store a monotonic counter in `property_config` key `__meta.ari_version` (integer JSON) via **raw SQL** (see invariant 9). Every transaction that writes one or more `availability_day` rows increments it once and stamps that value on the emitted `availability.changed` event. Per-row `availability_day.version` continues to bump as today for row-level history; **event `version` means the property ARI counter**.

## Provisioning

After PropertyDO open + `setRecordedJurisdiction`:

1. Raw-SQL upsert `__meta.property_id` if absent.
2. If `property_config` has no `pms.time.time_zone` row, write it via the DOMAIN put path (idempotency key scoped to first-write, e.g. `provision:timezone:{propertyId}`).
3. If a timezone row already exists, **leave it** — re-provision with a different timezone does not overwrite. Changing timezone later is a dedicated command (out of scope) with §7.5 preconditions.

## Commands

All require `IdempotencyKey`. Fingerprint allowlists:

| Command | Fingerprint body |
|---------|------------------|
| add | `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }` |
| update | `{ roomTypeId, code?, name?, roomCount?, maxOccupancy?, maxAdults? }` (only provided fields) |
| delete/archive | `{ roomTypeId }` |

### `addRoomType`

1. Require stored timezone (else `timezone_unset`).
2. Insert `room_type` (`active`).
3. Enumerate horizon dates; **INSERT** `availability_day` with `physical = room_count` (other columns default 0).
4. Bump `__meta.ari_version` (raw SQL).
5. Outbox: `inventory.room_type_changed`, `availability.changed`.

### `updateRoomType`

1. Require stored timezone; load active room type.
2. If `roomCount` decreases: for each **existing** ledger row with `stay_date >= today`, compute projected free with new physical; collect dates where `free < 0`. If any → `{ ok: false, error: OVERSELL, dates }`.
3. Update columns; if `roomCount` changed, **`UPDATE` existing rows only** (`stay_date >= today`) — set `physical`, bump per-row version. **No INSERT.**
4. Bump ARI version; emit both events (range = min/max of updated dates, or no `availability.changed` if physical unchanged).

### `deleteRoomType` (archive)

1. Require stored timezone (“today”).
2. If any ledger row with `stay_date >= today` and `(sold > 0 OR held > 0 OR blocked > 0)` → `{ ok: false, error: ARCHIVE_BLOCKED }`.
3. Set `status='archived'`; set `physical = 0` for `stay_date >= today`; bump ARI version.
4. Outbox: **`inventory.room_type_changed` and `availability.changed`** (§7.1 — expiry is never the invalidation mechanism). Catalog entry updated to match.

## Catalog change

```ts
{ id: 'inventory.delete_room_type', ..., events: ['inventory.room_type_changed', 'availability.changed'] }
```

(Previously inventory-only; incorrect once archive zeroes physical.)

## Event payloads

```ts
// inventory.room_type_changed
{ propertyId, roomTypeId, op: 'add' | 'update' | 'archive', at: number }

// availability.changed
{ propertyId, roomTypeId, fromDate, toDate, version /* property ARI counter */ }
```

## Contracts

```ts
// packages/contracts — freeAvailability lives here (moved from do-runtime)
export function freeAvailability(row: {
  physical: number; blocked: number; held: number; sold: number; oversell: number;
}): number;

export const TIMEZONE_UNSET = 'timezone_unset' as const;
export const OVERSELL = 'oversell' as const;
export const ARCHIVE_BLOCKED = 'archive_blocked' as const;
```

Widen inventory `try*` results:

```ts
| { ok: true; ... }
| { ok: false; error: typeof OVERSELL; dates: string[] }
| { ok: false; error: string }
```

`do-runtime` may re-export `freeAvailability` from contracts for existing import paths.

## DDL drift

`PROPERTY_MIGRATIONS` gains version 2. `scripts/property-ddl.mjs` emits/checks **multiple** files per target (`0001_freeze_gate.sql`, `0002_room_type.sql`, …).

## Success tests

1. Provision → timezone row present; inventory add without timezone row → `timezone_unset`.
2. Add room type under **`Europe/Berlin`** → exactly 365 `availability_day` rows with `physical = room_count`; two outbox events; ARI version = 1. (DST-aware timezone — UTC would hide off-by-one bugs.)
3. Replay same idempotency key → no second seed / no second events.
4. Update lowering `room_count` below sold → `oversell` + dates; ledger unchanged.
5. Update ok → **existing** future rows’ physical updated; no new dates inserted; past dates unchanged.
6. Archive with future sold → `archive_blocked`.
7. Archive clean → status archived, future `physical = 0`, past untouched; **both** outbox events.
8. Archived code `KING` can be reused on a new active room type (partial unique index).
9. Domain package has no platform imports (lint / unit); imports `freeAvailability` from contracts.
10. `check:ddl` covers `0002_room_type.sql`.

## Follow-on (explicit triggers)

**Horizon extension** — See [2026-07-27-horizon-extension-followon.md](./2026-07-27-horizon-extension-followon.md) (boarded). Owner: night-audit business-date rollover (extend +1 day). Trigger: **before any booking path accepts stays ≥ ~300 days out**, or when the first group/corporate allotment product starts — whichever is sooner. Not “when the property turns one year old.”

**Timezone change command** — Separate INTERACTIVE / FAIL_CLOSED command with §7.5 preconditions; never via re-provision.

**Virtual types** — New migration when constituent mapping is designed.

## Non-goals reminder

Queues, HTTP, individual rooms, virtual types, and night-audit extension are deliberately deferred so this slice freezes room-type + horizon seeding + module boundary.
