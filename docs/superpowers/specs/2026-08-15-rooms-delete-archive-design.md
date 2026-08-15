# Rooms delete — physical-unit archive

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **79** (`register.test.ts` ~664), `AUDIT_WRITER_COMMAND_IDS.size === 54` (`register.test.ts` ~268 and ~663), `V1_HTTP_ROUTE_AUDIT[131].id === 'post_folio_routing_rule_archive'` (`register.test.ts` ~655–661; `v1-http-routes.ts` ~772–777), `[128] post_folio_stay_discount` (`register.test.ts` ~633–638; `v1-http-routes.ts` ~751–756), `[127] post_demo_seed` (`register.test.ts` ~619–624; `v1-http-routes.ts` ~747–749), `PROPERTY_SCHEMA_HEAD === 28` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1063–1072), `PLATFORM_GAPS === []` (`register.test.ts` ~665), `room` DDL ~289–300 (`property-migrations.ts`), `PROPERTY_MIGRATIONS` tail v28 ~1157–1160, catalog last entry `reservations.update_extras` ~876–883, `rooms.create` / `rooms.update` ~190–215, `handleDeleteRoomType` ~973–1025, `handlePostRooms` / `handlePatchRoom` ~3139–3191 / ~3193+, `V1_ROUTES` tail ~7440–7448, `archiveRoomType` ~1579–1588, `tryCreateRoom` ~5548–5658, `tryUpdateRoomType` live-count gate ~5226–5236, `tryCreateRoom` count gate ~5599–5608, `tryDeleteRoomType` ~5395+, `listRooms` ~6577+, `assertRoomAssignableSync` ~6331+, `pickAutoAssignRoomSync` ~8252+, `InventoryScreen` rooms tab Save ~518–539, room-type archive modal ~606–621, `ARCHIVE_BLOCKED` wire code (`idempotency.ts` ~15).

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §7.1 (physical units are assignment layer; `room_count` caps units; OOO → `blocked`; do not rewrite ledger formula); [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) (§2.3a typo story; §2.5 `ROOM_COUNT_EXCEEDED`; scope-out `rooms.delete`); [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) (assign overlap sets; OOO guards; leftover **6**); [property setup SPA](./2026-08-13-property-setup-spa-design.md) (inventory rooms tab; leftover **3**); [night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md) (leftover **6** names this chunk); `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `apps/pms-core/src/v1-dispatch.ts`; `packages/client-core/src/api.ts`; `apps/web-pms/src/screens/InventoryScreen.tsx`; `apps/pms-core/test/rooms.spec.ts`; `apps/pms-core/test/rooms-routes.spec.ts`.

**Closes:** [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) scope-out + §7 `rooms.delete` / archive lifecycle (typo `10I` → `101` story). [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) leftover **6**. [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover **3**. [night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md) leftover **6** (named only — no night-audit code in this chunk).

**Amends:** [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) §1 scope-out + §7 table row (closed). [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) §19 leftover **6** (closed). [property setup SPA](./2026-08-13-property-setup-spa-design.md) §1.3 / §19 leftover **3** (closed). [night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md) §8 leftover **6** (closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Physical room units (`room` rows) are created under an active physical `room_type` with a `room_count` cap. `rooms.create` and `rooms.update` shipped; **`rooms.delete` did not**. A mistyped unit permanently consumes a slot: operator creates `10I` instead of `101` at `room_count = 20` → cannot free the slot → cannot create `101` without raising `room_count`.

Room-type archive (`inventory.delete_room_type`) already exists (`tryDeleteRoomType` ~5395+). This chunk adds the **parallel for physical units**: archive (soft lifecycle), free a live-unit slot under unchanged `room_count`, **without** touching `availability_day.physical` / ARI (same assignment-layer rule as `rooms.create`).

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Room DDL (v11) | `property-migrations.ts` ~289–300: `room_id`, `room_type_id`, `code`, `status` CHECK (`clean\|dirty\|inspected\|out_of_order`), `floor`, timestamps; **`room_code_uidx` global unique on `code`** |
| Create unit | `tryCreateRoom` ~5548–5658: gates on `COUNT(*) FROM room WHERE room_type_id = ?` vs `room_type.room_count`; code uniqueness `SELECT … FROM room WHERE code = ?`; outbox `room.created`; **no** `availability.changed` |
| Update unit | `tryUpdateRoom` ~5665–5752: code/floor only; code clash check ~5708–5711 |
| Lower room_count gate | `tryUpdateRoomType` ~5226–5236: `COUNT(*) FROM room WHERE room_type_id = ?` vs proposed count → `RoomUnitsExceedCountError` / `ROOM_UNITS_EXCEED_COUNT` |
| Archive room type | `tryDeleteRoomType` ~5395+: live reservation set `inquiry\|pending\|confirmed\|checked_in`; `enumerateHorizonDates` for `today` ~5431; `ArchiveBlockedError` → `ARCHIVE_BLOCKED`; zeros ARI on archive |
| List units | `listRooms` ~6577–6640: no `archived_at` filter today |
| Assignability | `assertRoomAssignableSync` ~6331–6377: `RoomNotFoundError` if missing; overlap on `pending\|confirmed\|checked_in` |
| Auto-assign pick | `pickAutoAssignRoomSync` ~8252–8283: all rooms for type, no archive filter |
| Catalog | `rooms.create` / `rooms.update` ~190–215; last catalog id `reservations.update_extras` ~876–883 |
| HTTP (rooms) | `post_rooms` / `patch_room` / `get_rooms` ~143–160; no delete route |
| HTTP (room type delete) | `delete_room_type` ~38–42; handler ~973–1025 maps `ARCHIVE_BLOCKED` → **409** |
| Client | `archiveRoomType` ~1579–1588; `createRoom` / `updateRoom` ~1589–1611 |
| SPA | Room-type archive modal ~606–621; rooms tab has Save only ~518–539 |
| Audit writers | `rooms.create`, `rooms.update` in set ~10–11; size pin **54** ~268, ~663 |
| Schema head | **28** (`migrate.test.ts` ~618; tail v28 ~1157–1160) |
| HTTP head | `[131] post_folio_routing_rule_archive` ~655–661 / ~772–777 |
| Night audit | **8** steps; `[3] === 'AUTO_TRANSFER'` ~1067 — **unchanged** |

**Heads (frozen — this chunk moves these):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **79** | **80** (+ `rooms.delete` **appended at end** after `reservations.update_extras`; do **not** insert in the `rooms.*` cluster) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **54** | **55** (+ `rooms.delete`; update pins ~268 and ~663) |
| `V1_HTTP_ROUTE_AUDIT` | `[131] = post_folio_routing_rule_archive` | **APPEND `[132] delete_room`** — `[131]` / `[128]` / `[127]` **unmoved** |
| `PROPERTY_SCHEMA_HEAD` | **28** | **29** (`room.archived_at` + partial unique index) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — no 9th step |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.2 Scope in

1. **v29** migration: `archived_at` + partial unique index on live codes.
2. Catalog **`rooms.delete`**, audit writer, HTTP **`DELETE /v1/properties/:propertyId/rooms/:roomId`**, dispatch handler, client `archiveRoom`.
3. **`tryDeleteRoom`** RPC (catalog id `rooms.delete`).
4. Live-count gates in `tryCreateRoom`, `tryUpdateRoomType`; live-only code checks in create/update.
5. Reader/writer archive blindness: `listRooms`, front-office tape / vacancy / sellable counts (direct SQL — not only `listRooms`), assignability, auto-assign, OOO/status/update paths.
6. SPA archive control on rooms tab + confirm modal.
7. Tests §7; register + migrate pin updates; `pnpm generate:ddl`.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Un-archive / restore
- Hard `DELETE FROM room`
- Changing `room.status` CHECK to include `archived`
- Auto-decrement `room_type.room_count` or `availability_day.physical`
- `includeArchived` on `GET /rooms` or `archivedAt` on list DTO
- OOO→blocked coupling changes; auto-ending OOO on archive
- `rooms.set_ooo_range` product leftover beyond archived→`NOT_FOUND`
- Virtual types, derived rates, promo, invoices, city ledger, unknown payments, auth expiry, split-command collapse, `reservations.update_extras`
- Recurring / `breakfast_rule`
- Growing `NIGHT_AUDIT_STEPS`
- Moving `[131]` / `[128]` / `[127]`
- New `export class` / `CLASS_DENYLIST` edit (reuse `ArchiveBlockedError` / `RoomNotFoundError`)
- Demo seed rewrite
- Bidirectional leftover pointer sentences (final implementation task)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Archive, never SQL DELETE

Physical units are **archived**, not deleted. **No** `DELETE FROM room`. Reservations, HK assignments, and `room_ooo` keep `room_id` FKs.

Do **not** overload housekeeping `room.status` (`clean|dirty|inspected|out_of_order`). Add nullable **`archived_at INTEGER`** (`NULL` = live).

**v29** — append to `PROPERTY_MIGRATIONS`; do **not** rewrite v11 `CREATE TABLE`:

```sql
ALTER TABLE room ADD COLUMN archived_at INTEGER;
DROP INDEX room_code_uidx;
CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL;
```

Export `ROOM_ARCHIVE_V29_STATEMENTS` / `ROOM_ARCHIVE_V29_SQL` in `property-migrations.ts` (mirror `FOLIO_ROUTING_RULE_V28_*` ~1004–1018). `pnpm generate:ddl` → `migrations/do-property/0029_room_archive.sql`. `migrate.test.ts`: head **29**; `migrateSql` applies through **29**; on-disk SQL match test; v29 statement assertions (same family as v28 ~802–808).

Existing rows: `archived_at` defaults `NULL` (live).

### Lock 2 — Free a `room_count` slot; do not change sellable `physical`

**Live unit count** for a type:

```sql
SELECT COUNT(*) FROM room WHERE room_type_id = ? AND archived_at IS NULL
```

**Must** replace raw `COUNT(*)` (all rows) in:

| Gate | Where (verified) |
|---|---|
| Create cap | `tryCreateRoom` ~5599–5608 |
| Lower `room_count` | `tryUpdateRoomType` ~5226–5236 |

**Do not** auto-decrement `room_type.room_count`. **Do not** touch `availability_day.physical` / ARI / emit `availability.changed` (rooms remain assignment layer — same as `rooms.create` ~5546).

After archive, operator may `rooms.create` a replacement under the existing `room_count` (typo `10I` → archive → create `101`). **Archived codes may be reused** (partial unique index allows duplicate code on archived rows).

**Code uniqueness (create/update):** `tryCreateRoom` ~5594–5597 and `tryUpdateRoom` ~5708–5711 today select `WHERE code = ?` without archive filter — **change to live-only**:

```sql
SELECT room_id FROM room WHERE code = ? AND archived_at IS NULL
```

(update path: `AND room_id != ?` as today).

### Lock 3 — Command / HTTP / catalog

| Field | Value |
|---|---|
| Command id | **`rooms.delete`** (leftover name; family `rooms.*`, **not** `inventory.delete_room`) |
| `prototypeAction` | **`null`** (net-new like `rooms.create`; prototype has `DELETE_ROOM_TYPE` only) |
| Lane | `INTERACTIVE` |
| `degraded` | `FAIL_CLOSED` |
| `idempotent` | `true` |
| `entitlement` | `'pms.core'` |
| `permission` | `'inventory:write'` |
| `events` | **`['room.archived']` only** — **not** `availability.changed` |

Append catalog entry **at end** of `COMMAND_CATALOG` array (after `reservations.update_extras` ~883). Add **`rooms.delete`** to `AUDIT_WRITER_COMMAND_IDS` → size **55**.

Allowlist **`room.archived`** in `apps/pms-core/src/event-consumer.ts` (mirror `room.created` / `room.updated` ~144–145).

**HTTP:** `DELETE /v1/properties/:propertyId/rooms/:roomId`

| Field | Value |
|---|---|
| Route audit id | **`delete_room`** |
| Index | **`[132]`** appended at **end** of `V1_HTTP_ROUTE_AUDIT` in `v1-http-routes.ts` (after `[131]` ~772–777) |
| `scope` | `property` |
| `permission` | `inventory:write` |
| `commandId` | `rooms.delete` |
| `entitlement` | `pms.core` |

**Dispatch:** append at **end** of `V1_ROUTES` in `v1-dispatch.ts` (after `handlePostFolioRoutingRuleArchive` entry ~7440–7448):

```typescript
{
  scope: 'property',
  method: 'DELETE',
  pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/,
  permission: 'inventory:write',
  commandId: 'rooms.delete',
  entitlement: 'pms.core',
  handler: handleDeleteRoom,
}
```

**Handler** — mirror `handleDeleteRoomType` (~973–1025):

- Idempotency from `x-idempotency-key` header (or `idempotencyKey` query); missing → **400** `invalid_body`
- Fingerprint `{ roomId }`
- `invokePropertyDo` → `tryDeleteRoom`
- Map `NOT_FOUND` → **404**; `ARCHIVE_BLOCKED` → **409** `{ ok: false, error: 'archive_blocked' }` (match `handleDeleteRoomType` ~1019–1020; reuse `ARCHIVE_BLOCKED` from `@hospai/contracts` / `idempotency.ts` — **no new wire code**)
- Success → **200** `{ ok: true, roomId }`
- FAIL_CLOSED transport: match `handlePostRooms` degraded pattern (~3132–3135) if DO unreachable

**Client:** `packages/client-core/src/api.ts` — `archiveRoom(propertyId, roomId)` parallel to `archiveRoomType` (~1579–1588):

```typescript
async archiveRoom(propertyId: string, roomId: string) {
  const idempotencyKey = stableKeyForOperation(`room:archive:${roomId}`, opts.keyStore);
  return getJson(`/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}`, {
    method: 'DELETE',
    headers: { 'x-idempotency-key': idempotencyKey },
  });
}
```

### Lock 4 — `tryDeleteRoom` behaviour

Private/public RPC name: **`tryDeleteRoom`** (parallel `tryDeleteRoomType`). Catalog id remains **`rooms.delete`**.

Fingerprint allowlist: **`{ roomId }`**.

**Idempotency:** Already archived or missing → throw `RoomNotFoundError` / return `NOT_FOUND` (same as inactive room type ~5425–5427). Idempotent replay of the **same** key returns cached success.

**Refuse (`ARCHIVE_BLOCKED`, step not applied)** when **either**:

1. Any reservation with this `room_id` and `status IN ('inquiry','pending','confirmed','checked_in')` (union of assign overlap + virtual-type archive live set — same statuses as `tryDeleteRoomType` virtual branch ~5442–5448)
2. Any `room_ooo` overlapping open-forward: `end_date > today` where `today = enumerateHorizonDates(timeZone, new Date(), 1)[0]` (same as `tryDeleteRoomType` ~5431)

Do **not** auto-end OOO (would mutate `blocked` / ARI). Operator ends OOO first.

**Do not** block on `checked_out` / `cancelled` / `no_show` history with `room_id` set.

**In the same txn on success:**

1. `UPDATE room SET archived_at = ?, updated_at = ? WHERE room_id = ?`
2. `DELETE FROM housekeeping_assignment WHERE room_id = ? AND business_date >= ?` (`today` from step 2 above). Past HK rows stay (FK + history).
3. Outbox **`room.archived`** `{ propertyId, roomId, roomTypeId, code }`
4. Audit `commandId: 'rooms.delete'`, `entityType: 'room'`, `beforeJson` live fields including `archivedAt: null`, `afterJson` includes `archivedAt` (epoch ms)

Catch mapping (mirror delete room type ~5536–5539): `ArchiveBlockedError` → `{ ok: false, error: ARCHIVE_BLOCKED }`; `RoomNotFoundError` → `NOT_FOUND`.

### Lock 5 — Readers and other writers ignore archived

| Surface | Change |
|---|---|
| `listRooms` ~6596–6604 | Add `AND archived_at IS NULL`. **No** `includeArchived` query param. Response shape unchanged — **do not** add `archivedAt` to DTO |
| `readFrontOfficeTape` ~9562–9567 | Front-desk / tape room list: `FROM room WHERE (? IS NULL OR room_type_id = ?)` → add `AND archived_at IS NULL` |
| `listAvailableRooms` ~9713–9729 | Vacant-room query: `FROM room WHERE … AND status != 'out_of_order'` → add `AND archived_at IS NULL` |
| `readFrontOfficeSummary` sellable count ~9803–9807 | `SELECT COUNT(*) AS n FROM room WHERE room_id NOT IN (ooo…)` → count **live** rooms only (`AND archived_at IS NULL`) |
| `assertRoomAssignableSync` ~6340–6344 | Select `archived_at`; if non-null → `RoomNotFoundError` |
| `pickAutoAssignRoomSync` ~8263–8267 | `WHERE room_type_id = ? AND archived_at IS NULL` |
| `tryUpdateRoom` ~5698–5702 | Missing or archived → `RoomNotFoundError` |
| `tryUpdateRoomStatus` / `tryBulkUpdateRoomStatus` | Archived room → `NOT_FOUND` (via room lookup) |
| `trySetOooRange` ~5977+ (and end-OOO paths) | Archived room → `NOT_FOUND` |
| Un-archive | **None** |

**Id lookup by `room_id` (may return archived):** `selectFrontOfficeRoomSync` ~9990–9992, historical stay display paths that join reservation → room, and `syncOooStatusForRoomSync` ~5836 — **do not** filter `archived_at` so checked-out history still shows the code. Do **not** 404 those reads.

**Writers** that mutate a unit (update code/status/OOO/assign/auto-assign) still treat archived as `NOT_FOUND` (rows above).

**Catch-all:** Every **list / vacancy / sellable** `FROM room` query that presents a live unit to operators must include `archived_at IS NULL`. Audit all direct SQL in `property-do.ts`; tape / FO / vacancy do **not** consume `listRooms`.

**Purge / empty census:** `(SELECT COUNT(*) FROM room)` ~1259 stays **unfiltered** — archived rows are still data for FK integrity.

### Lock 6 — SPA

`apps/web-pms/src/screens/InventoryScreen.tsx` rooms tab (~518–539): add **Archive {code}** destructive button + confirm modal parallel to room-type archive (~606–621). Use separate state (e.g. `roomArchiveTarget: { roomId, code } | null`) so type and unit modals do not collide.

Confirm copy **exactly**:

> Archive {code}? It will free a unit slot. History stays.

Wire `archiveRoom` mutation; success invalidates `['rooms', propertyId]`.

**Error copy** — extend `inventoryErrorCopy` (~53–61):

- **`room_units_exceed_count`** (~56–58): replace stale “Rename rooms or wait for a delete path.” with e.g. “Cannot lower room count below the number of live rooms. Archive extra units first.” (This chunk **is** that path.)
- **`archive_blocked`:** room archive and room-type archive share wire code `archive_blocked`. SPA must branch on **which mutation failed** (room vs type), not the code alone — e.g. pass mutation context into error copy or use separate mutation error handlers. Room archive copy: “This room has a live reservation or a future out-of-order period — it cannot be archived.” Room-type message stays for type archive.

RTL in `InventoryScreen.test.tsx`. `pnpm check:web-pms-colors` if tokens touched (prefer existing `Button intent="destructive"`).

### Lock 7 — Tests (normative cases)

**DO** — extend `apps/pms-core/test/rooms.spec.ts` (keep existing create/count tests green — they must still pass once count is live-only):

| # | Case | Assert |
|---|---|---|
| 1 | Archive live room | Omitted from `listRooms`; outbox `room.archived`; **no** `availability.changed`; ARI/`physical` unchanged; audit `rooms.delete` |
| 2 | After archive with `room_count` unchanged | `rooms.create` replacement succeeds, **including reusing archived code** |
| 3 | Archive when `COUNT(live)==room_count`, then create | Leftover typo story — create succeeds without raising `room_count` |
| 4 | Live reservation (`checked_in` or `confirmed` assigned) | `archive_blocked`; room still in `listRooms` |
| 5 | Future-overlapping `room_ooo` (`end_date > today`) | `archive_blocked` |
| 6 | Already archived / unknown id | `not_found` |
| 7 | Lower `room_count` below live count | Still `room_units_exceed_count`; after archive, lowering to live count succeeds |
| 8 | Auto-assign / assignability | Archived room not picked (`reservations-auto-assign.spec.ts` or rooms spec) |

**HTTP** — `apps/pms-core/test/rooms-routes.spec.ts`: DELETE **200**, **404**, **409** `archive_blocked`, missing idempotency key **400**. FAIL_CLOSED transport if rooms.create has degraded pattern — match it.

**SPA:** archive control + confirm + success invalidates rooms query.

**Register + migrate pins** as heads table.

**CI gates:** `pnpm check:ddl`, `check:permissions`, `check:entitlements`, `check:degraded` (`FAIL_CLOSED`, no `REPLAY_DISPATCH`), `check:class-denylist` (no new `export class`).

---

## 3. Schema (v29)

`PROPERTY_SCHEMA_HEAD` **28 → 29**. `ORG_SCHEMA_HEAD` stays **7**.

Migration name: **`room_archive`**.

Statements (Lock 1). After `pnpm generate:ddl`, `git diff --exit-code -- migrations packages/do-runtime` must match committed SQL.

**No** changes to `room_type`, `availability_day`, `reservation`, or `room_ooo` tables.

**migrate.test.ts** updates:

- `schema head constants` ~618: `PROPERTY_SCHEMA_HEAD` **29**
- `migrateSql` ~217–227: applies through **29**; version list includes **29**
- New `property schema head is 29 after room_archive` case
- New `migrations/do-property/0029_room_archive.sql matches ROOM_ARCHIVE_V29_SQL` (mirror ~790–799)

---

## 4. Commands / HTTP detail

### 4.1 Catalog entry (`rooms.delete`)

Append after `reservations.update_extras`:

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

### 4.2 Route audit `[132]`

```typescript
{
  id: 'delete_room',
  scope: 'property',
  permission: 'inventory:write',
  commandId: 'rooms.delete',
  entitlement: 'pms.core',
},
```

### 4.3 Register pins

In `'night-audit HTTP routes append at 86–91'` test (~457–669), **append** after `[131]` assertions (~655–661):

```typescript
expect(V1_HTTP_ROUTE_AUDIT[132]?.id).toBe('delete_room');
expect(V1_HTTP_ROUTE_AUDIT[132]).toMatchObject({
  scope: 'property',
  permission: 'inventory:write',
  commandId: 'rooms.delete',
  entitlement: 'pms.core',
});
expect(COMMAND_CATALOG).toHaveLength(80);
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(55);
```

Also update ~268 pin in `'every entitled command has an audit writer…'`.

**Do not** move `[131]`, `[128]`, `[127]`.

---

## 5. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v29 statements + tail entry |
| `migrations/do-property/0029_room_archive.sql` | generated |
| `packages/do-runtime/src/migrate.test.ts` | head 29, migrateSql, on-disk match |
| `packages/contracts/src/commands/catalog.ts` | append `rooms.delete` |
| `packages/contracts/src/commands/audit-writers.ts` | + `rooms.delete` |
| `packages/contracts/src/v1-http-routes.ts` | append `[132]` |
| `packages/contracts/src/register.test.ts` | catalog **80**, writers **55**, `[132]` |
| `apps/pms-core/src/property-do.ts` | `tryDeleteRoom`; live counts; reader/writer filters incl. FO tape / vacancy / sellable SQL |
| `apps/pms-core/src/v1-dispatch.ts` | `handleDeleteRoom`; `V1_ROUTES` append |
| `apps/pms-core/src/event-consumer.ts` | allowlist `room.archived` |
| `packages/client-core/src/api.ts` | `archiveRoom` |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | archive button + modal + error copy |
| `apps/web-pms/src/screens/InventoryScreen.test.tsx` | RTL |
| `apps/pms-core/test/rooms.spec.ts` | DO cases §2 Lock 7 |
| `apps/pms-core/test/rooms-routes.spec.ts` | HTTP cases |

**Optional:** one sentence in ARCHITECTURE.md §7.1 noting physical-unit archive frees assignment slots without changing sellable `physical`. Do **not** rewrite ledger formula.

**Not touched:** `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, demo seed, `CLASS_DENYLIST`.

---

## 6. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Use patterns from `rooms.spec.ts` (`provisionedPropertyStub`, `createRoom`, `idemFor`). Date math: `daysFromPropertyToday` / `addCalendarDays` from `date-helpers.ts`. **Do not** `vi.spyOn` into the DO isolate.

**CI (encode for implementer):**

- Rebuild `@hospai/contracts` before pms-core tests.
- Rebuild `@hospai/client-core` before web-pms tests.
- File-filter vitest; sharded `pnpm --filter @hospai/pms-core test` with `--shard=N/8`.
- `pnpm check:web-pms-colors` if SPA files touched.
- Living plan checkboxes only on the last plan task (for the later plan writer).

Cases enumerated in Lock 7. Register pin verification: catalog **80**, writers **55**, `[132]` last, `[131]`/`[128]`/`[127]` unmoved, `PROPERTY_SCHEMA_HEAD === 29`, `NIGHT_AUDIT_STEPS.length === 8`, `PLATFORM_GAPS === []`.

---

## 7. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Un-archive / restore** | Explicit scope-out |
| 2 | **`includeArchived` admin view** | History via audit / FK rows only |
| 3 | **Purge semantics for archived units** | Rows remain for FK integrity |

---

## 8. Implementation checklist

- [x] v29 migration + `pnpm generate:ddl` + migrate tests
- [x] Catalog `rooms.delete` appended; audit writer; event allowlist
- [x] HTTP `[132]` + dispatch handler + client `archiveRoom`
- [x] `tryDeleteRoom` with guards, HK future delete, outbox, audit
- [x] Live-count gates + live-only code checks in create/update/type-lower
- [x] Reader/writer archive filters (Lock 5)
- [x] SPA archive UX + RTL + `room_units_exceed_count` + room-specific `archive_blocked` copy (mutation-context branch)
- [x] DO + HTTP + register/migrate pins (Lock 7)
- [x] `pnpm check:ddl`, `check:permissions`, `check:entitlements`, `check:degraded`, `check:class-denylist`
- [x] Bidirectional pointers: rooms-vertical §7; room-operations leftover **6**; property-setup leftover **3**; auto-extend leftover **6** (final implementation task)

---

## 9. Tree conflicts with reviewer locks

**None on heads.** Verified: catalog **79**, writers **54**, `[131]` last, `PROPERTY_SCHEMA_HEAD` **28**, `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'`, `PLATFORM_GAPS === []`.

**Implementer notes (not lock violations):**

1. **`tryCreateRoom` / `tryUpdateRoom` code queries** must become live-only (Lock 2) — tree today would block code reuse even with partial index.
2. **`handleDeleteRoomType`** maps `ARCHIVE_BLOCKED` → **409** (~1019–1020); **`handleDeleteRoom`** must match → **409** `{ ok: false, error: 'archive_blocked' }` per Lock 3 (both archives use 409).
3. **Register pin test** is named `'night-audit HTTP routes append at 86–91'` (~457) but now asserts through `[131]` (~655–661) — append `[132]` in the same test.
4. **v28** has schema-head + `migrateSql` tests but **no** on-disk `0028_*.sql` match test yet — v29 should add on-disk match following v27 pattern (~790–799).
