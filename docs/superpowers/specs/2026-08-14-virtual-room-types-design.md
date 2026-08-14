# Virtual room types (run-of-house OR)

**Date:** 2026-08-14  
**Status:** Draft (reviewer)  
**Sources:** ARCHITECTURE.md §7.1 (physical vs virtual; ledger never reservation-scan; virtual has no independent `physical`; restrictions/oversell on physical; virtual inherits tightest; validate-then-mutate; reject-on-commit), §7.2 (restrictions ledger separate from prices; tightest wins), §14 Phase 1 (inventory-before-folio), §16.1 (virtual types named), §16.3 / §16.4 (preserve interaction; existing tokens); [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) (`room_count` authoritative for `physical`; rooms are assignment layer); [property setup SPA](./2026-08-13-property-setup-spa-design.md) (virtual types **scoped out** §1.3); [booking wizard](./2026-08-11-booking-wizard-design.md) (availability quote + `selectableRoomTypeIds`); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) (type-wide `'*'` restrictions); command catalog (`inventory.add_room_type` / `update_room_type` / `delete_room_type`; `reservations.create` / `modify` / `cancel` / `no_show` / `check_in`; `reservations.assign_room`); `packages/do-runtime/src/property-migrations.ts`; `apps/pms-core/src/property-do.ts`; `apps/pms-core/src/v1-dispatch.ts` (`handleGetAvailability`); `packages/client-core/src/booking.ts`; `apps/web-pms/src/screens/InventoryScreen.tsx` / `BookingScreen.tsx` / `CheckInScreen.tsx`

**Closes:** ARCHITECTURE.md §7.1 **physical/virtual room types** for **v1 run-of-house (OR) only** — a hotelier can define a virtual sales SKU over ≥2 physical constituents, quote/book it on `/book`, allocate a physical type at commit, and check in to a room of that allocated type. [Property setup SPA](./2026-08-13-property-setup-spa-design.md) §1.3 virtual-types scope-out. Prototype-holes / guest-CRM / tape-chart leftover rows that say “virtual room types §7.1” as deferred (**this chunk closes the PropertyDO + SPA path**, not demo seed).

**Amends:** [property setup SPA](./2026-08-13-property-setup-spa-design.md) §1.3 and §21 (virtual types **closed** here — Inventory gains virtual-type create/edit; restrictions calendar note for additive virtual rows only). Bidirectional pointer: one sentence in that spec when this chunk lands. Does **not** amend booking-wizard rate/availability client helpers beyond consuming widened GET shapes.

---

## 1. Context & Motivation

Every physical room type today is a sellable SKU with its own `availability_day` ledger rows and its own `rate_day` cells. `reservation.room_type_id` is both “what we sold” and “what we decremented” because the two are identical for physical types. ARCHITECTURE §7.1 already chose the opposite model for **virtual** types: the ledger tracks **physical** inventory only; a virtual sale resolves to one physical constituent and decrements **that** row in the same atomic write.

The tree has **no** `kind`, **no** constituent graph, and **no** `allocated_room_type_id`. Booking, modify, cancel, check-in, and assign-room all key off `reservation.room_type_id` alone (`property-do.ts` ~5693–5708 assign mismatch; ~6276–6316 commit/release sold; ~6974 release on cancel uses `room_type_id`). Availability GET returns only rows that exist in `availability_day` (`readAvailabilityRange` ~4414–4453; dispatcher ~7390–7401). Property setup explicitly deferred virtual types ([property setup SPA](./2026-08-13-property-setup-spa-design.md) §1.3 line 68).

This chunk implements **OR run-of-house only**: one virtual booking consumes **one** physical unit from **one** constituent for the whole stay; allocation happens at **book** (create/confirm that commits inventory), not at check-in; constituents are **physical only**, **one level**, minimum **two**.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| `room_type` table | `property-migrations.ts` ~119–131: `room_type_id`, `code`, `name`, `room_count`, `max_occupancy`, `max_adults`, `status IN ('active','archived')`. **No `kind`.** |
| `availability_day` | ~9–18: PK `(room_type_id, stay_date)`; `physical`, `blocked`, `held`, `sold`, `oversell`, `version`. `free = physical - blocked - held - sold + oversell` (`packages/contracts/src/availability.ts`). |
| `restriction_day` | ~21–31: PK `(room_type_id, rate_plan_id, stay_date)` — **any** `room_type_id` string; no FK to physical-only. Type-wide uses `rate_plan_id = '*'` (`TYPE_WIDE_RATE_PLAN`). |
| `reservation` | Latest shape in lifecycle rebuilds (~590–631, v20+): `room_type_id NOT NULL`, **no** `allocated_room_type_id`. `readReservation` ~8206–8238 returns `roomTypeId` only. |
| `room` | ~291–301: `room_type_id NOT NULL` FK → `room_type`. Assignment layer; does not drive `physical` ([rooms vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) §2.1). |
| Add physical type | `tryAddRoomType` ~4463–4580: inserts `room_type` + horizon `availability_day` at `physical = roomCount`. Fingerprint `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }`. |
| Update / archive type | `tryUpdateRoomType` ~4588–4780; `tryDeleteRoomType` ~4788–4903: archive zeros future `physical`; `archiveBlocked` on sold/blocked future demand. |
| Create room | `tryCreateRoom` ~4911–4970: rejects when `COUNT(room) >= room_type.room_count`. **No virtual guard.** |
| Book / sold | `tryCreateReservation` ~6423–6607: `commitSoldNightsSync(input.roomTypeId, …)` ~6509; inserts `room_type_id = input.roomTypeId`. Restriction check via `restrictionFailureSync(roomTypeId, …)` ~6309. |
| Modify | `tryModifyReservation` ~7045+: release/acquire on `room_type_id` / `input.roomTypeId`; date-only path does not exist separately from type change. |
| Cancel / release | `tryCancelReservation` ~6974: `releaseSoldNightsSync(reservation.room_type_id, nights)`. |
| Assign / check-in | `assertRoomAssignableSync` ~5693–5708: `room.room_type_id !== reservation.roomTypeId` → `ROOM_TYPE_MISMATCH`. `tryCheckIn` ~7505–7510 passes `reservation.room_type_id`. |
| Horizon reconcile | `reconcileHorizon` ~1063–1119: for every **active** `room_type`, INSERT missing `availability_day` at `physical = room_count`. |
| Availability read | `readAvailabilityRange` ~4414–4453: SQL over `availability_day` only. `GET …/availability` (`get_property_availability`, `READ_STALE`) Branch 2 maps rows + inline `free` (~7390–7401). Branch 1 KV keyed `ari:{pid}:{roomTypeId}:{date}` (~7306–7330). |
| Restriction eval | `loadRestrictionRowsSync` ~1842–1868 loads `restriction_day` for one `roomTypeId`. `restrictionFailureSync` ~1874–1889 → `firstRestrictionViolation` (`@hospai/pms-restrictions`). |
| Rate quote | `snapshotRateNightsSync` on create uses **sold SKU** `roomTypeId` (~6554). Booking SPA sums `GET /rate-days` for selected `roomTypeId` (`BookingScreen.tsx` ~126–154). |
| Room-type HTTP | `[26] post_room_types` / `[27] put_room_type` / `[28] delete_room_type`; `[111] get_room_types` (`v1-http-routes.ts` ~26–42, ~635–639). Body today: `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults, idempotencyKey }`. |
| Inventory SPA | `InventoryScreen.tsx` ~67–120: create physical type with `roomCount`; rooms tab creates units against a type. **No kind / constituents UI.** |
| Booking SPA | `BookingScreen.tsx` ~109–178: `GET /availability` without `roomTypeId`; `selectableRoomTypeIds` requires `free ≥ 1` every night (`client-core/booking.ts` ~84–105). Labels from `GET /room-types`. |
| Check-in SPA | `CheckInScreen.tsx` ~131–133: room picker filters `rooms.filter(r => r.roomTypeId === reservation.roomTypeId)` — **sold SKU**, not allocated physical. |
| Catalog / routes / audit | `COMMAND_CATALOG` length **77** (`register.test.ts` ~627). `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (~619). Next free **128**. `AUDIT_WRITER_COMMAND_IDS.size === 52` (~268, ~626). `PLATFORM_GAPS = []` (~628). |
| Schema heads | `PROPERTY_SCHEMA_HEAD === 26` (`property-migrations.ts` ~1112–1116 `card_display_token`; `migrate.test.ts` ~608). `ORG_SCHEMA_HEAD === 7`. Next property free **27**. |
| Night audit | `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1039–1047). |
| Purge census | `PROPERTY_PURGE_INVENTORY_TABLES` ~1172–1200 lists `room_type`, `availability_day`, `reservation`, … **No constituent table yet.** |
| Demo seed | Unchanged this chunk (reviewer lock **11**). The Meridian Seattle stays physical-only. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** (no new row — widen existing GETs + availability handler) |
| `COMMAND_CATALOG` | length **77** | **77** (extend existing `inventory.*` payloads; no new id) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **26** | **27** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | see ~1172–1200 | add `room_type_constituent` + `countPropertyInventoryRows` term |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. PropertyDO v27: `room_type.kind`, `room_type_constituent` mapping table, `reservation.allocated_room_type_id` with backfill (`§3`).
2. Extend **`inventory.add_room_type`** / **`inventory.update_room_type`** / **`inventory.delete_room_type`** for virtual types and constituent maintenance — **no new catalog command id** (`§4`).
3. Virtual availability **quote** = sum of constituent `free` per night; commit allocates one constituent and decrements **only** its `sold` (`§5`, `§6`, `§9`).
4. Virtual restrictions = **per-constituent eligibility** for allocation (OR); optional virtual-SKU `restriction_day` rows apply to the whole product (`§7`).
5. Virtual rates stay on the **virtual SKU** `rate_day` rows — no inheritance/summing (`§8`).
6. Reservation writers: create / modify (date-only) / cancel / no-show / pending expiry use `allocated_room_type_id` for ledger mutations; assign / check-in match **allocated physical** (`§9`–`§11`).
7. Widen **`GET /room-types`**, **`GET /reservations/:id`**, and **`GET /availability`** JSON (no new route index) (`§5`).
8. Inventory SPA: create/edit virtual type + constituent picker. Booking + check-in consume widened reads (`§12`).
9. DO + HTTP tests in `§13`.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **Combined-unit / connecting-room (AND)** — decrement several physical types at once for one booking. Named leftover.
- **Reallocate on modify** when the allocated physical type lacks availability for new dates — fail `NO_AVAILABILITY`; do **not** silently pick another constituent (reviewer lock **7**).
- **Allocate at check-in** — allocation stays at inventory-committing create/confirm.
- **Nested virtual** — constituents must be `kind = 'physical'`; a virtual type cannot be a constituent.
- **Demo seed ROH SKU** for The Meridian — physical-only seed unchanged (lock **11**).
- **Derived / OrgDO rate plans** (§7.2). **City ledger / AR**, invoices, night-audit auto-transfer, recurring charges, partial refunds.
- **`rooms.delete` / unit archive.** **`held` behaviour**, booking-engine holds, OTA/channel pushes, KV projection writer changes beyond “virtual types never KV-backed”.
- **Plan-scoped restriction rows** (`rate_plan_id ≠ '*'`). **Restrictions calendar** redesign — optional additive rows on virtual types only; no “inherited restriction editor” as source of truth.
- **Growing `NIGHT_AUDIT_STEPS`.** **New catalog command ids.** **New HTTP audit rows** unless reviewer reopens (default: none).
- **`ui-kit` adoption / Tailwind / new hex** — existing `apps/web-pms` tokens + `@hospai/ui-kit` components already in use; `check:web-pms-colors` stays merge-blocking.
- **Photos, inclusions, keyless, auto-assign rooms**, exception-queue workbench, tape chart changes.
- **Resurrecting `PLATFORM_GAPS` ids.**

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Availability is a ledger.** Never derive sellability by scanning reservations. Property-based tests assert `sold` on **physical** types equals covering reservations’ **`allocated_room_type_id`**, not sold SKU.
2. **Virtual types have no independent physical count.** `room_count = 0`. No `availability_day` rows for virtual `room_type_id`. No `room` rows with `room_type_id` = virtual. `reconcileHorizon` skips `kind = 'virtual'`.
3. **One decrement per committing book.** Virtual create/confirm picks **one** constituent; increments `sold` on **that** physical type only. Never write `sold` on a virtual `room_type_id`.
4. **Persist both SKU and allocation.** `reservation.room_type_id` = sold SKU (physical or virtual). `reservation.allocated_room_type_id` = physical type whose ledger was mutated. For physical bookings both columns are equal.
5. **Allocate at commit.** Allocation runs inside the same `transactionSync` as `commitSoldNightsSync`, after all precondition checks, before any `sold` write (validate-then-mutate, §7.1).
6. **OR only.** Constituents are an **OR** pool; one unit from one member per stay. No AND / multi-type decrement.
7. **Constituent eligibility.** Active physical types only; ≥2 distinct constituents; no duplicates; virtual cannot appear in the set.
8. **Quote availability for virtual** = **sum** of constituent `free` per `(virtual_id, stay_date)` after each physical row’s oversell/blocked/held/sold. **Quote rate** = virtual type’s own `rate_day` cells only.
9. **Restrictions on virtual (OR).** Each constituent is evaluated with `restrictionFailureSync` on **that physical type** — King stop-sell does **not** block Queen allocation. Allocation (`§6`) considers only constituents that are free every night **and** restriction-clean. Optional `restriction_day` rows on the **virtual SKU** (type-wide `'*'`) apply to the whole product (additive product-level gate). Do **not** merge constituent restrictions into one map that kills the whole ROH when one member is stop-sold.
10. **Check-in / assign** fail closed unless `room.room_type_id === reservation.allocated_room_type_id` (not sold virtual SKU).
11. **Modify dates only** (same sold `room_type_id`): keep `allocated_room_type_id`; validate/release/acquire on that physical type only; no reallocation.
12. **Cancel / no-show / pending expiry** release `sold` on **`allocated_room_type_id`** only.
13. **Archive guards.**
    - **Physical** type: existing `archiveBlocked` on future `availability_day` rows (`sold | held | blocked > 0`) unchanged. Additionally, cannot archive if the type is a **constituent** of an **active** virtual type → `422 constituent_in_use`.
    - **Virtual** type: `tryDeleteRoomType` today would pass `archiveBlocked` vacuously (no `availability_day` rows). Instead, reject `422 archive_blocked` if **any** reservation has `room_type_id = that virtual id` and `status IN ('inquiry', 'pending', 'confirmed', 'checked_in')`. Virtual archive emits `inventory.room_type_changed` only — **no** `availability.changed`.
    - Cannot reduce virtual constituents below two on update.
14. **Virtual occupancy cap.** Virtual `maxOccupancy` / `maxAdults` must be **≤ the minimum** of the same field across all constituents (create and update) → `422 virtual_occupancy_exceeds_constituents`. `assertOccupancySync` at book uses the **sold SKU**; the cap guarantees any allocated physical type can hold the sold party.
15. **`rooms.create` against virtual** → `422 virtual_type_no_rooms`.
16. **`allocated_room_type_id` empty only pre-commit.** Column stays `NOT NULL DEFAULT ''`. Backfill sets `= room_type_id` for existing rows. `''` is legal **only** when that reservation has **not** committed inventory (`inquiry`, or `pending` before sold is written). On any write that commits `sold`, always set a real physical id.
17. **Money is integers.** Folio append-only. Domain modules zero platform imports.
18. **Degraded mode.** Existing writers stay `FAIL_CLOSED`. Widen reads stay `FAIL_CLOSED` where already so (`get_room_types`, `get_reservation`). `get_property_availability` stays `READ_STALE`; virtual synthetic rows computed on DO fallback path only.
19. **`runIdempotent` sync-only.** Ledger-state preconditions (`no_availability`, `restriction_violated`, …) throw inside `runIdempotent`, not cached.
20. **`NIGHT_AUDIT_STEPS` stays seven.** No seed rewrite.
21. **No new catalog command.** Fingerprints on `inventory.add_room_type` / `inventory.update_room_type`:
    - Omitted `kind` canonicalizes to `'physical'`.
    - **Physical create** with omitted `kind` / `constituentRoomTypeIds` **must fingerprint identically** to today’s `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }` — do not break existing idempotency keys.
    - **Virtual** fingerprints include `kind: 'virtual'` and `constituentRoomTypeIds` sorted lexicographically.
22. **Virtual type metadata writes emit no ARI.** Creating or updating a virtual type (metadata + constituents only) does **not** emit `availability.changed`. Physical create/update/archive that touch `availability_day` unchanged.
23. **Route audit** `[127] = post_demo_seed` unmoved. Next free remains **128** for a future distinct resource.
24. **`PLATFORM_GAPS` stays `[]`.**
25. **Visual identity.** Existing tokens; no new hex; `check:web-pms-colors` clean.

---

## 3. Schema (PropertyDO v27 — normative)

Bump `PROPERTY_SCHEMA_HEAD` **26 → 27**. `pnpm generate:ddl` produces `migrations/do-property/0027_virtual_room_types.sql`.

### 3.1 `room_type.kind`

```sql
ALTER TABLE room_type ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical'
  CHECK (kind IN ('physical', 'virtual'));
```

Backfill: all existing rows `kind = 'physical'`.

**Rules:**

| `kind` | `room_count` | `availability_day` | `room` rows | Constituents |
|---|---|---|---|---|
| `physical` | ≥ 0 (existing rules) | yes | yes | n/a |
| `virtual` | **must be 0** | **no** | **no** | ≥ 2 active physical ids |

### 3.2 `room_type_constituent`

```sql
CREATE TABLE room_type_constituent (
  virtual_room_type_id   TEXT NOT NULL,
  physical_room_type_id  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (virtual_room_type_id, physical_room_type_id),
  FOREIGN KEY (virtual_room_type_id) REFERENCES room_type(room_type_id),
  FOREIGN KEY (physical_room_type_id) REFERENCES room_type(room_type_id)
);
CREATE INDEX room_type_constituent_physical_idx
  ON room_type_constituent (physical_room_type_id);
```

- Rows exist **only** for `kind = 'virtual'`.
- Replacing the set on update is **delete all for virtual + insert** inside the same command transaction.

Register in `PROPERTY_PURGE_INVENTORY_TABLES` and `countPropertyInventoryRows`.

### 3.3 `reservation.allocated_room_type_id`

```sql
ALTER TABLE reservation ADD COLUMN allocated_room_type_id TEXT NOT NULL DEFAULT '';
```

Backfill in migration:

```sql
UPDATE reservation SET allocated_room_type_id = room_type_id WHERE allocated_room_type_id = '';
```

Then enforce in DO: on insert, set explicitly (never rely on default for new rows).

**Semantics:** ledger mutations always use `allocated_room_type_id`. Display/API expose both `roomTypeId` (SKU) and `allocatedRoomTypeId` (physical). Value `''` means inventory not yet committed; once `sold` is written, a non-empty physical id is mandatory.

---

## 4. Commands (extend existing catalog entries — normative)

**No new `COMMAND_CATALOG` row.** Justify: virtual type + constituent graph is the same inventory entity as room type; idempotency fingerprints already gate `inventory.add_room_type` / `inventory.update_room_type`; a separate command would duplicate archive semantics and split audit entity type.

### 4.1 `inventory.add_room_type`

**Request body (HTTP unchanged paths; widened JSON):**

```typescript
{
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';          // default 'physical'
  roomCount?: number;                     // required physical; forbidden >0 virtual
  maxOccupancy: number;
  maxAdults: number;
  constituentRoomTypeIds?: string[];      // required when kind='virtual'
  idempotencyKey: string;
}
```

**Virtual create validation (fail before `runIdempotent` or throw inside without cache — match existing precondition pattern):**

| Check | Wire error |
|---|---|
| `kind='virtual'` and missing / empty constituents | `virtual_constituents_required` |
| `< 2 distinct ids` | `virtual_constituents_min_two` |
| duplicate ids | `virtual_constituents_duplicate` |
| any id not found or not `kind='physical'` active | `virtual_constituent_not_physical` |
| `roomCount > 0` on virtual | `virtual_room_count_must_be_zero` |
| nested virtual in set | `virtual_nested_forbidden` |
| `maxOccupancy` or `maxAdults` exceeds **min** of same field across constituents | `virtual_occupancy_exceeds_constituents` |

**Write path:** insert `room_type` with `kind`, `room_count = 0` for virtual; insert constituent rows; **do not** insert `availability_day`; emit `inventory.room_type_changed` only — **no** `availability.changed`, **no** ARI bump.

**Physical path:** unchanged (horizon seed at `roomCount`; `availability.changed` as today).

**Fingerprint allowlist (extend):**

- Omitted `kind` → treat as `'physical'`.
- **Physical** (default): fingerprint payload is **byte-identical** to today — `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }`. Do **not** include `kind` or `constituentRoomTypeIds` when omitted.
- **Virtual:** `{ roomTypeId, code, name, kind: 'virtual', roomCount: 0, maxOccupancy, maxAdults, constituentRoomTypeIds }` with `constituentRoomTypeIds` **sorted lexicographically**.

### 4.2 `inventory.update_room_type`

**Optional fields:** existing + `constituentRoomTypeIds?: string[]` (virtual only; replaces full set).

| Check | Wire error |
|---|---|
| Change `kind` after create | `room_type_kind_immutable` |
| Virtual with `roomCount !== 0` | `virtual_room_count_must_be_zero` |
| Constituent validation same as add | (same codes) |
| Physical type: `constituentRoomTypeIds` present | `virtual_constituents_on_physical` |
| Virtual occupancy exceeds constituent minimum | `virtual_occupancy_exceeds_constituents` |

**Virtual metadata update:** same event rule as add — `inventory.room_type_changed` only; **no** `availability.changed`.

**Archive guards (`inventory.delete_room_type`):**

| Target | Guard | Wire error |
|---|---|---|
| **Physical** P | Existing `archiveBlocked` on future `availability_day` for P | `archive_blocked` |
| **Physical** P | P is constituent of an **active** virtual: `EXISTS (SELECT 1 FROM room_type_constituent c JOIN room_type v ON v.room_type_id = c.virtual_room_type_id WHERE c.physical_room_type_id = ? AND v.status = 'active')` | `constituent_in_use` |
| **Virtual** V | Any live reservation on sold SKU: `EXISTS (SELECT 1 FROM reservation WHERE room_type_id = ? AND status IN ('inquiry','pending','confirmed','checked_in'))` | `archive_blocked` |

Physical archive that zeros future `physical` still emits `availability.changed` as today. Virtual archive: `inventory.room_type_changed` only — **no** `availability.changed`.

### 4.3 `rooms.create`

Reject when target type `kind = 'virtual'` → **`422 virtual_type_no_rooms`**.

---

## 5. HTTP reads (widen existing — normative)

**No new `V1_HTTP_ROUTE_AUDIT` index.** Append nothing; `[127] = post_demo_seed` stays last.

### 5.1 `GET /v1/properties/:pid/room-types` (`get_room_types`)

Add to each item:

```typescript
kind: 'physical' | 'virtual';
constituentRoomTypeIds: string[];  // empty array for physical
```

Order constituents lexicographically by id in the response.

### 5.2 `GET /v1/properties/:pid/reservations/:id` (`get_reservation`)

Add:

```typescript
allocatedRoomTypeId: string;
```

Tape / board / folio list endpoints that embed `roomTypeId` keep showing the **sold SKU**; only detail reads need allocation for check-in unless a list endpoint is already consumed by CheckIn (today CheckIn uses `getReservation` only).

### 5.3 `GET /v1/properties/:pid/availability` (`get_property_availability`)

**Virtual synthetic items** (DO paths only):

1. After loading physical rows from `readAvailabilityRange`, load active virtual types + constituent map.
2. For each virtual type V and each `stay_date` in range, compute  
   `free_V = Σ free(physical P, stay_date)`  
   using the same `freeAvailability` formula per constituent row (missing row → 0 free contribution).
3. Append items `{ roomTypeId: V, stayDate, physical: 0, blocked: 0, held: 0, sold: 0, oversell: 0, free: free_V }`.

**KV Branch 1** (`roomTypeId` query set): if requested id is `kind = 'virtual'`, **skip KV** and use PropertyDO computation (virtual types are never written to `ARI_KV`).

**Booking wizard path** (no `roomTypeId` query): Branch 2 must include synthetic virtual rows so `selectableRoomTypeIds` works unchanged.

**Filter:** when `roomTypeId` names a virtual type, return only that type’s synthetic series (not all physical rows unless also requested — match existing filter semantics).

---

## 6. Allocation algorithm (normative)

Pure function in domain code (e.g. `@hospai/pms-inventory` or `@hospai/pms-reservations` — zero platform imports):

**Input:** ordered stay nights `N[]`, constituent physical ids `C[]`, map of `AvailabilitySnapshot` per `(physical_id, night)`, and a predicate `restrictionClean(c)` per constituent (§7 — `restrictionFailureSync` on that physical id only).

**Eligibility:** constituent `c` is eligible iff:

1. for **every** night `n ∈ N`, `freeAvailability(row(c,n)) ≥ 1`; **and**
2. `restrictionClean(c)` — the stay passes `restrictionFailureSync(c, …)` with no violation on that physical type.

**Score:** among eligible constituents, compute `minFree(c) = min_n freeAvailability(row(c,n))`. Pick `c` with **maximum** `minFree`. Tie-break: **lexicographic** `room_type_id` ascending.

**Failure when none eligible:**

| Situation | Error |
|---|---|
| No constituent has `free ≥ 1` on every night | `no_availability` |
| At least one constituent is free every night, but **every** such free constituent fails restrictions | `restriction_violated` (surface first constituent violation) |
| Mix of no-free and free-but-restricted with no eligible intersection | `no_availability` when no free **and** restriction-clean constituent exists |

**Output:** chosen `allocated_room_type_id`, or throw per table above.

**Property tests:** King=1 + Queen=1, ROH `{King, Queen}`: two ROH books allocate K then Q; third → `no_availability`. King stop-sold, Queen open → ROH allocates **Queen** (not `restriction_violated`).

---

## 7. Restrictions (normative)

**Physical types:** unchanged — `restrictionFailureSync(physicalRoomTypeId, …)` on the sold type.

**Virtual sold SKU at commit — OR model (reviewer lock):**

1. **Product-level gate (optional):** run `restrictionFailureSync(virtualSkuId, …)` on the **virtual SKU** itself. If the virtual type has `restriction_day` rows (type-wide `'*'`), they apply to the whole product — e.g. virtual SKU stop-sell fails the book even if every constituent is open. This runs **before** allocation.
2. **Per-constituent eligibility:** for each constituent physical id `c`, run `restrictionFailureSync(c, …)` independently. A constituent that fails is **ineligible for allocation** only — it does **not** fail the whole ROH. Do **not** merge King and Queen into one restriction map.
3. **Allocation (`§6`):** score only constituents that pass both free-every-night and step 2. Pick per §6 tie-break.
4. **Error preference:** if step 3 finds no eligible constituent, use the §6 failure table (`no_availability` vs `restriction_violated`).

**Quote / availability display:** synthetic virtual `free` remains the sum of constituent free (§5). Restriction gating at quote time is best-effort on the DO read path; commit re-checks per constituent + virtual SKU.

**SPA / restrictions calendar:** operators may PUT type-wide rows on a virtual id; copy in UI: “Applies to this run-of-house product; constituent rules still apply per physical type at booking.” Do **not** build a merged “tightest of constituents” editor as source of truth.

**Rates matrix:** unchanged — virtual types may have their own `rate_day` cells; restrictions calendar does not write rates.

---

## 8. Rates (normative)

- **Sell price** for a virtual SKU comes **only** from `rate_day` where `room_type_id = virtual_id`.
- **Do not** sum, average, or inherit constituent physical rates at quote or commit.
- `snapshotRateNightsSync` continues to key off **sold** `room_type_id` (the virtual SKU) — folio room charges reflect what was sold.
- Booking SPA already loads rate days for selected `roomTypeId`; no change to client algorithm beyond virtual ids appearing in the picker.

---

## 9. Reservation create (normative)

When **`commitsInventory`** (`status` is `pending` or `confirmed` per existing rules):

1. Resolve type row; if `kind = 'physical'`: `allocated = input.roomTypeId`; run existing `commitSoldNightsSync(allocated, …)` + `restrictionFailureSync(allocated, …)` (unchanged).
2. If `kind = 'virtual'`:
   - Load constituent ids.
   - Run virtual-SKU product-level `restrictionFailureSync(virtualSkuId, …)` (`§7` step 1).
   - Build availability snapshots for all `(constituent, night)`.
   - Run allocation (`§6`) with per-constituent `restrictionClean` (`§7` step 2) → `allocated`.
   - `commitSoldNightsSync(allocated, …)` — **not** on virtual id.
   - Insert reservation with `room_type_id = virtual`, `allocated_room_type_id = allocated`.
3. `availability.changed` outbox: emit for **`allocated`** physical type (the ledger that changed), same as today’s physical book.
4. Audit / event payloads include both ids when they differ.

When inventory **does not** commit (`inquiry`, or any path that skips `commitSoldNightsSync`): insert with `allocated_room_type_id = ''`. On a later transition that commits sold (e.g. inquiry→confirmed, pending with commit), run allocation + set `allocated_room_type_id` in the **same** transaction as the first `sold` write.

---

## 10. Check-in & assign room (normative)

- Change `assertRoomAssignableSync` call sites to pass **`allocatedRoomTypeId`** (load from reservation row).
- `ROOM_TYPE_MISMATCH` when `room.room_type_id !== allocated`.
- **`tryAssignRoom`**, **`tryCheckIn`**, modify-with-preassigned-room: same rule.
- **`listAvailableRooms`**: when called with `roomTypeId`, behaviour unchanged (physical filter). Callers for virtual reservations must pass **`allocatedRoomTypeId`** — CheckIn SPA fix (`§12`).

**Occupancy:** `assertOccupancySync` at book/check-in continues to use **sold SKU** `room_type_id`. Virtual SKUs are capped at create/update to ≤ min(constituent occupancy) (`§2.14`), so any allocated physical type can satisfy the party without a separate check against the allocated row.

---

## 11. Modify / cancel / no-show (normative)

### 11.1 Modify stay dates (same sold `roomTypeId`)

When only dates change (or date change is part of modify but **`input.roomTypeId === reservation.room_type_id`**):

- Keep **`allocated_room_type_id`** from reservation (no reallocation).
- Release/acquire `sold` on **allocated** physical type only.
- If new nights not available on allocated type → `NO_AVAILABILITY` (do not pick another constituent).

When **`input.roomTypeId` changes**:

- Treat as changing sold SKU. Release old **allocated** physical sold; for new SKU run full allocate + commit logic (new virtual → new allocation; new physical → allocated = new id).

### 11.2 Cancel / no-show / pending expiry

Replace `releaseSoldNightsSync(reservation.room_type_id, …)` with **`releaseSoldNightsSync(reservation.allocated_room_type_id, …)`** wherever inventory commits were released.

---

## 12. SPA (normative)

Use existing `@hospai/ui-kit` primitives (`InventoryScreen` / `BookingScreen` / `CheckInScreen` patterns). No Tailwind. No new hex.

### 12.1 Inventory — room types tab

- Add **Kind** control: Physical (default) | Virtual (run-of-house).
- **Physical:** existing form (`roomCount`, etc.).
- **Virtual:**
  - Hide / disable `roomCount` (send `0`).
  - **Constituents:** multi-select of active **physical** types, minimum 2, distinct. Show code + name. `data-testid="virtual-constituents"`.
  - Table column badge **Virtual** vs **Physical**; virtual rows show constituent codes (read-only list from GET).
  - Archive virtual type: same confirm dialog; surface `archive_blocked` when live reservations reference the SKU; surface `constituent_in_use` when trying to archive a physical type still referenced.
- **Rooms tab:** disable create when selected type is virtual; copy: “Virtual types do not have room units.”

### 12.2 Booking (`/book`)

- No layout redesign. Virtual types appear when synthetic availability passes `selectableRoomTypeIds`.
- Label: existing name/code; optional muted “Run of house” hint via `kind === 'virtual'` from types GET.
- Rate quote unchanged (virtual `rate_day`).

### 12.3 Check-in

- Room picker filters **`allocatedRoomTypeId`** from `getReservation`, falling back to `roomTypeId` only when equal (physical).
- Registration card: show sold SKU name; optional subtitle “Allocated: {physical type name}” when ids differ.

---

## 13. Tests (acceptance-shaped)

**Schema / register**

1. `PROPERTY_SCHEMA_HEAD === 27`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` matches `0027_virtual_room_types.sql`.
2. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. `PLATFORM_GAPS` `[]`. `NIGHT_AUDIT_STEPS.length === 7`.
3. `room_type_constituent` in purge list + count SQL.

**Virtual create validation (DO / HTTP)**

4. `POST /room-types` virtual with 1 constituent → `422 virtual_constituents_min_two`.
5. Virtual with nested virtual constituent → `422 virtual_nested_forbidden`.
6. `POST /rooms` against virtual type → `422 virtual_type_no_rooms`.
7. Archive physical type that is constituent of active virtual → `422 constituent_in_use`.
8. Virtual `maxOccupancy: 4` over King `maxOccupancy: 2` → `422 virtual_occupancy_exceeds_constituents`.
9. Archive virtual type with `inquiry` / `pending` / `confirmed` / `checked_in` reservation on that SKU → `422 archive_blocked` (no `availability_day` rows required).

**Book / ledger**

10. Book virtual ROH over King+Queen: `sold` increments on **allocated** physical row only; **no** `availability_day` row for virtual id.
11. ROH quote: `GET /availability` synthetic `free` = sum of constituent free for that night.
12. **Oversell shared pool:** King `physical=1`, Queen `physical=1`, ROH `{King, Queen}`; book ROH + ROH + King (or two ROH + one King) → third commit `422 no_availability`; ledger `sold` King=1, Queen=1 (property-based, not reservation scan).
13. Restrictions (OR): constituent King stop-sell on arrival, Queen open → ROH book **succeeds**, allocates **Queen** (not `restriction_violated`).
14. Virtual SKU stop-sell on ROH while King and Queen both open → `restriction_violated` on the product gate even though constituents are open.

**Check-in**

15. Reservation sold ROH allocated King; assign/check-in Queen room → `422 room_type_mismatch`.
16. Assign King room → success.

**Modify / cancel**

17. Modify dates only on virtual reservation: keeps allocation; fails `no_availability` if allocated type full on new nights; does **not** move allocation to Queen.
18. Cancel virtual reservation: releases `sold` on allocated physical only.

**Reads**

19. `GET /room-types` returns `kind` + `constituentRoomTypeIds`.
20. `GET /reservations/:id` returns `allocatedRoomTypeId`.

**SPA (light)**

21. InventoryScreen test: create virtual with two constituents; appears in list with badge.
22. CheckInScreen test: room options filtered by `allocatedRoomTypeId`.

Fixture-date discipline: `crypto.randomUUID()` keys; `check:pms-core-test-dates`.

---

## 14. Leftovers deferred (explicitly out)

| # | Item | Notes |
|---|---|---|
| 1 | Combined-unit **AND** virtual | Decrement multiple physical types per book |
| 2 | Reallocate constituent on date modify | Fail closed this chunk |
| 3 | Allocate at check-in | Book-time allocation only |
| 4 | Demo seed ROH SKU | Meridian stays physical-only |
| 5 | Nested virtual / multi-level graphs | One level only |
| 6 | KV / ARI projection materialization for virtual | DO fallback quote path suffices Phase 1 |
| 7 | Inherited restriction UI as source of truth | Evaluate at commit from constituents |
| 8 | Derived / OrgDO rate plans | §7.2 |
| 9 | `rooms.delete`, holds/`held`, OTAs, channel push | §1.3 |
| 10 | Plan-scoped restrictions | Type-wide `'*'` only |

---

## 15. Acceptance / reviewer checklist

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
- [ ] Tests §13 green in the later implementation plan — this spec does not implement them.
- [ ] Pointer sentence added to [property setup SPA](./2026-08-13-property-setup-spa-design.md) when landed.

---

## 16. Open questions (locked by reviewer)

1. **New command vs extend inventory.*** **Locked: extend** `add` / `update` with `kind` + `constituentRoomTypeIds`; fingerprints cover mapping updates.
2. **New HTTP route for constituents.** **Locked: no** — widen `GET /room-types`.
3. **Column name `allocated_room_type_id`.** **Locked** — matches “allocated physical type” semantics.
4. **Virtual restriction rows.** **Locked: product-level gate** on the virtual SKU; constituent restrictions are per-member eligibility, not merged tightest-of.
5. **Demo seed.** **Locked: no change** this chunk.

---

## 17. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v27 statements; head **27** |
| `migrations/do-property/0027_virtual_room_types.sql` | `pnpm generate:ddl` |
| `packages/do-runtime/src/migrate.test.ts` | pin **27** |
| `apps/pms-core/src/property-do.ts` | kind/constituents CRUD; allocate; commit/release/check-in/modify; `listRoomTypes`; `readAvailabilityRange` or helper; purge list |
| `apps/pms-core/src/v1-dispatch.ts` | widen GET handlers; virtual availability synthesis in `handleGetAvailability` |
| `modules/pms/inventory` or `modules/pms/reservations` | `allocateVirtualConstituent`, virtual free sum, per-constituent restriction eligibility + tests |
| `packages/client-core/src/api.ts` | types for widened GET bodies; optional create/update room type fields |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | virtual type UI |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | allocated filter + label |
| `apps/web-pms/src/screens/BookingScreen.tsx` | optional ROH hint from `kind` |
| `apps/pms-core/test/` | §13 DO/HTTP specs |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | one-sentence bidirectional pointer |

**Not touched:** `demo-seed`, `NIGHT_AUDIT_STEPS`, `COMMAND_CATALOG` length, `v1-http-routes.ts` append (unless widening types in place without new index), `ORG_SCHEMA_HEAD`, new `PLATFORM_GAPS`.

---

## 18. Tree conflicts with reviewer locks

**None.** Verified heads match parent brief: catalog **77**, route **[127] = post_demo_seed**, next **128**, `PROPERTY_SCHEMA_HEAD` **26**, `ORG_SCHEMA_HEAD` **7**, audit writers **52**, `NIGHT_AUDIT_STEPS` **7**, `PLATFORM_GAPS` `[]`. This chunk bumps property schema to **27** only. ARCHITECTURE §7.1 virtual model matches locked OR / no-independent-physical; **this chunk narrows** ARCHITECTURE’s “inherits tightest” wording to **per-constituent eligibility + optional SKU-level rows** (reviewer lock), not a merged tightest map.

**Check-in SPA vs lock 6:** today’s tree compares against sold SKU (`CheckInScreen.tsx` ~131–133); the lock requires allocated physical — spec treats current behaviour as a **defect to fix**, not a conflict.
