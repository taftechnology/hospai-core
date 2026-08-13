# Property setup SPA (Chunk A)

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** ARCHITECTURE.md §5.1 (classified config; DOMAIN in PropertyDO; SECRET never in config), §7.1 (room-type inventory; virtual types named, not this chunk), §7.2 (rates vs restrictions; derivation graph / OrgDO plans deferred), §9 (shell composes module UI; interaction design from the prototype, not visual identity), §14 Phase 1 (“Rebuild the prototype's screens against live APIs”), §16.3 / §16.4 (preserve interaction; `ui-kit` is a later slice; ship against existing tokens), §16.5 (inventory / rates matrix / settings are Phase 1 core-PMS surfaces); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) (property-local plans; archive-not-delete; type-wide `'*'` restrictions); [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) (`rooms.create` / `rooms.update`; no `rooms.delete`); [rule 3 + config surface](./2026-08-06-rule3-config-surface-design.md) (`PUT …/config/domain`; DOMAIN class gate); [charge-code registry](./2026-08-07-charge-code-registry-design.md); [tax posting](./2026-08-07-tax-posting-design.md); [booking wizard](./2026-08-11-booking-wizard-design.md) leftovers **3** and **6**; [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) leftover `pms.night_audit.auto_extend`; [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) leftover `pms.ops.auto_assign_rooms`; [multi-currency folio](./2026-08-13-multi-currency-folio-design.md) (FX editor on FolioScreen; leftover 2 `currencies_list`); [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) (photos / inclusions still deferred); command catalog; `v1-http-routes.ts`; `packages/contracts/src/config/register.ts`; `apps/web-pms/src/screens/` / `shell/nav.ts` / `shell/module-ui-registry.ts`

**Closes:** ARCHITECTURE.md §14 Phase 1 / §16.3 item 3 for the inventory, rates-matrix, and settings screens — a hotelier can configure a property without curl. Booking-wizard leftovers **3** (`BoardScreen` UTC seed) and **6** (room-type labels). The unread-config display/edit remainder for `pms.night_audit.auto_extend` and `pms.ops.auto_assign_rooms` (no consumers invented).

**Amends:** [booking wizard](./2026-08-11-booking-wizard-design.md) leftovers 3 and 6 (this chunk **closes** them); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) leftover 4 (`auto_extend` becomes editable DOMAIN config; still unread by the night-audit machine); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) leftover 3 (`auto_assign_rooms` becomes editable; check-in stays explicit); [rule 3 + config surface](./2026-08-06-rule3-config-surface-design.md) (adds the missing GET so `PUT` can round-trip); [rate plans](./2026-08-05-rate-plans-vertical-design.md) (adds the missing GET for `rate_day`; plan-scoped restrictions stay out); [multi-currency folio](./2026-08-13-multi-currency-folio-design.md) leftover 2 (`currencies_list` may appear on Settings; it is still not the FX allowlist). Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

Every inventory, rate, restriction, charge-code, tax-rule, and DOMAIN-config writer that a hotelier needs is already HTTP-reachable. None of it has a SPA. Provisioning a property today is curl: create room types, create rooms, seed BAR cells, PUT restrictions, PUT config. The booking wizard still labels types as raw `roomTypeId`. The front-desk board still seeds its date from UTC. That is the same assignable-but-unreachable pattern Staff closed for membership.

This chunk rebuilds the prototype’s inventory / rates / settings interaction against the live catalog. It adds the four **read** routes the SPA cannot fake (list room types; list rate days; list restriction days; list DOMAIN config). It does not invent writers, schema, or consumers.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Room-type writers | `POST /v1/properties/:pid/room-types` (`post_room_types`, `inventory.add_room_type`); `PUT …/room-types/:id` (`put_room_type`, `inventory.update_room_type`); `DELETE …/room-types/:id` (`delete_room_type`, `inventory.delete_room_type` — **archives**, zeros future `physical` if `archiveBlocked` allows). Body: `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults, idempotencyKey }`. Occupancy CHECK `max_adults <= max_occupancy` (`property-migrations.ts` ~125–126). **No GET.** |
| Room writers + list | `POST /rooms` (`rooms.create`); `PATCH /rooms/:id` (`rooms.update` — **code/floor only**; `roomTypeId` in body → `422 room_type_id_immutable`). `GET /rooms` (`get_rooms`, `housekeeping:read`, `FAIL_CLOSED`) already returns `roomId, roomTypeId, code, status, floor, oooRanges`. **No `rooms.delete`.** |
| Rate plans | `POST /rate-plans`, `PATCH /rate-plans/:id`, `DELETE /rate-plans/:id` (archive; BAR protected `DEFAULT_RATE_PLAN_PROTECTED`), `GET /rate-plans` (`get_rate_plans`, `rates:read`, `FAIL_CLOSED`) — **active only**; RPC `listRatePlans` returns `{ ratePlanId, code, name, status }` and **omits** cancel-policy columns that create/update already persist (`cancelPenaltyType` / `cancelGraceHours` / `cancelPenaltyNights` / `cancelPenaltyBps` / `cancelPolicyText`). |
| Rate days | `PUT /rate-days` (`rates.upsert_day`); `PUT …/room-types/:id/rates` (`rates.update_room_type_rate` alias, same DO); `POST /rates/bulk` (`rates.bulk_update`, BULK lane). Cells are integer `amountMinor` + ISO `currency`. Plan must be active. **No GET.** |
| Restriction days | `PUT /restriction-days` (`restrictions.upsert_day`). Body: `{ roomTypeId, ratePlanId?, stayDate, minLos?, maxLos?, cta?, ctd?, stopSell?, idempotencyKey }`. Default `ratePlanId` is `TYPE_WIDE_RATE_PLAN` (`'*'`). Evaluation is type-wide ([rate plans](./2026-08-05-rate-plans-vertical-design.md) §2.3). **No GET.** |
| DOMAIN config | `PUT /v1/properties/:pid/config/domain` (`put_domain_config`, `config.put_domain`, `settings:configure`, `FAIL_CLOSED`). `tryPutDomainConfig` rejects `entry.class !== 'DOMAIN'`. Body `{ key, value, reason, effectiveFrom?, idempotencyKey }`. **No GET.** |
| Charge codes | `POST /charge-codes`, `PATCH /charge-codes/:code` (name / `taxGroup`), `PUT …/status` (archive/restore), `GET /charge-codes?status=active\|archived\|all` (`folio:read`, `FAIL_CLOSED`). System codes protected from archive. |
| Tax rules | `POST /tax-rules`, `PUT …/tax-rules/:ruleKey/supersede`, `GET /tax-rules` (`folio:read`, `FAIL_CLOSED`). `rate` is a decimal **string**. Supersede, never in-place edit of a live rule. |
| FX editor | FolioScreen `data-testid="fx-rates-editor"`; `GET/POST /fx-rates`, `POST …/fx-rates/:qid/supersede`; gated `settings:configure`. Multi-currency lock: **ship that editor; do not rebuild.** |
| Property name | `PATCH /v1/properties/:pid` (`property.update_details`, `config:write`) — **name only**. Timezone is DOMAIN `pms.time.time_zone`. |
| SPA today | Nav: Arrivals / In-house / Departures / Book / Staff / Roster / Night audit + housekeeping module (`order: 25`). **No Inventory, Rates, or Settings.** `App.tsx` has no matching routes. `packages/client-core` has `listRooms` / `listFxRates` and **zero** room-type / rate-plan / rate-day / restriction / config / charge-code / tax-rule methods. |
| Booking labels | `BookingScreen.tsx` ~329–343 renders `{id}` from availability. Leftover 6. |
| Board date seed | `BoardScreen.tsx` ~24–26, ~190: `useState(() => dateParam ?? todayUtc())` while overstay uses `propertyLocalToday`. Leftover 3. `usePropertyTimeZone()` can be `null` after the initializer. |
| Catalog / routes / audit | `COMMAND_CATALOG` **74**. `V1_HTTP_ROUTE_AUDIT` **111** rows, indices **0–110**, last `[110] = post_folio_fx_adjustment`. Next free **111**. `AUDIT_WRITER_COMMAND_IDS.size === 49`. `PLATFORM_GAPS = []`. |
| Schema head | `PROPERTY_SCHEMA_HEAD === 24`. This chunk **does not migrate**. |
| Unread keys | `pms.night_audit.auto_extend` is already DOMAIN (`register.ts` ~118–124, default `true`, `consumers: night`). `pms.ops.auto_assign_rooms` is **OPERATIONAL** (`register.ts` ~279, default `true`) — `tryPutDomainConfig` will refuse it until reclassified. Neither has a PropertyDO reader. |
| Class denylist / purge | No new `export class`. No new table → `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[110] = post_folio_fx_adjustment` | next **111**; four reads **111–114** |
| `COMMAND_CATALOG` | length **74** | **unchanged** (reads are not commands) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **49** | unchanged |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **24** | unchanged |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | includes `fx_rate` / `payment_event` / `payment_dispute` | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Room-types admin: list / create / update / archive against live APIs. Add `GET /v1/properties/:id/room-types` (§4).
2. Rooms admin: list / create / update (code, floor). Reuse `GET /rooms`. No delete (§5).
3. Rate plans admin + rates matrix + bulk fill. Widen `GET /rate-plans` shape. Add `GET /rate-days` (§6).
4. Restrictions calendar. Add `GET /restriction-days`. Type-wide `'*'` only (§7).
5. Settings for classified **DOMAIN** keys. Add `GET …/config/domain`. Reclassify `pms.ops.auto_assign_rooms` so it can round-trip. Display/edit `auto_extend` and `auto_assign_rooms` without inventing consumers (§8).
6. Charge-codes admin and tax-rules admin on Settings (§9).
7. Settings → existing Folio FX editor (link, not a rebuild) (§10).
8. Booking-wizard leftover 6: room-type `code` / `name` labels (§11).
9. Booking-wizard leftover 3: BoardScreen property-local today (§12).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **Virtual room types** (§7.1). No constituent graph, no `virtual` flag, no inherited-restriction UI.
- **Derived / OrgDO rate plans** (§7.2). Phase 1 plans stay property-local. No “BAR minus 10%”, no chain-wide definition projection.
- **`rooms.delete` / physical-unit archive.** Rooms-vertical leftover. `rooms.update` covers typos; a `room_count` slot is not freed this chunk.
- **Tape chart / hibernating WebSockets** (§7.7 / §16.4). Front-desk board stays the list it is.
- **`ui-kit` / visual identity** (§16.4). Screens ship against existing `apps/web-pms` tokens and `check:web-pms-colors`. No Tailwind adoption, no prototype palette copy, no `packages/ui-kit`.
- **City ledger / AR**, invoice generation, night-audit auto-transfer, recurring charges, partial refunds.
- **Full exception-queue workbench.** `ExceptionsPanel` / `provisional.resolve_exception` stay as they are. ARCHITECTURE “Still owed: the exception-queue operator UX” is not this chunk.
- **Any PCI / real PSP work.** Simulate adapter and Folio FX editor stay. SECRET config keys are not on this Settings screen.
- Plan-scoped restriction rows (`rate_plan_id ≠ '*'`).
- OPERATIONAL / PRESENTATION / SECRET register keys except the one reclassification in §8.1. No OrgDO config store.
- Honoring `consumers.rematerializesRates` (rule-3 leftover). Timezone PUT remains allowed; rates are not rematerialized.
- Using `pms.money.currencies_list` as the FX allowlist (multi-currency leftover 2).
- Wiring `pms.night_audit.auto_extend` into the 7-step machine, or `pms.ops.auto_assign_rooms` into check-in / assign.
- Room-type photos (prototype-holes leftover 5). Rate-plan inclusions (leftover 6).
- Changing shipped `GET /rooms` permission from `housekeeping:read`.
- Growing `NIGHT_AUDIT_STEPS`. Changing the ledger currency after first write (SPA treats it as read-only; this chunk does not add a DO lock).
- New catalog command ids.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers.** Rate-day `amount_minor` is an integer. SPA uses existing `formatMinor` / `parseMajorToMinor` for display/input only. Never a float on the wire. Currency on rate cells is the **stored ledger** code; no SPA currency picker on Rates ([multi-currency folio](./2026-08-13-multi-currency-folio-design.md) §5.1).
2. **The folio is append-only.** This chunk does not post, reverse, or `UPDATE` `folio_line` amounts.
3. **Domain code has zero platform imports.**
4. **Every mutation already emits events + audit.** This chunk does not add writers. New reads emit nothing.
5. **Degraded mode never creates an obligation.** All new reads are `FAIL_CLOSED`. All existing writers this SPA calls are already `FAIL_CLOSED`. No provisional queue for inventory / rates / config.
6. **`runIdempotent` stays sync-only.** Reads are not idempotent commands.
7. **Schema freeze.** No new PropertyDO table, ALTER, or `PROPERTY_SCHEMA_HEAD` bump. Implementation may run `pnpm generate:ddl` after a build only as a hygiene check; it must produce a no-op diff and change no migration files.
8. **No new purge table.** `PROPERTY_PURGE_INVENTORY_TABLES` unchanged.
9. **No new `export class`.** Prefer file-local errors if a read helper needs one; do not add to `CLASS_DENYLIST`.
10. **`NIGHT_AUDIT_STEPS` stays seven.** Editing `auto_extend` does not grow the machine and does not add a reader.
11. **Route audit append-only.** New routes start at index **111**. `[110] = post_folio_fx_adjustment` does not move. `findRoute` is method + first-match — GET and PUT may share a path; do **not** nest a GET under a parameterized sibling that would shadow it.
12. **New catalog commands** (none expected) would carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. Reads are **not** commands (`commandId` omitted, same as `get_rate_plans` / `get_fx_rates` / `get_reservation_search`).
13. **Rule 3 config.** Only DOMAIN keys are stored in PropertyDO. `tryPutDomainConfig` continues to reject other classes. SECRET keys are never listed or written. Per-key DO gate `requiredPermissionForKey` is unchanged (`inventory:configure` on the two availability keys; `settings:configure` on the rest).
14. **Restrictions are a separate ledger from prices.** The rates matrix does not write `restriction_day`. The restrictions calendar does not write `rate_day`.
15. **Room-type inventory, not room-level sell.** Creating a physical `room` does not change `availability_day.physical`; `room_count` stays authoritative. Archiving a type still zeros future `physical` via existing `inventory.delete_room_type`.
16. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
17. **Visual identity is not this chunk.** Existing tokens, status classes, and `check:web-pms-colors`. Interaction (field grouping, archive-not-delete, bulk-by-range) comes from the prototype; appearance does not.
18. **Unread keys stay unread.** Display/edit of `pms.night_audit.auto_extend` and `pms.ops.auto_assign_rooms` must not add PropertyDO readers, night-audit branches, or auto-assign at check-in.

---

## 3. HTTP routes to append (normative)

Append-only. Do not reorder 0–110.

| Index | `id` | Method / path | Permission | `commandId` | Entitlement | `degradedRead` |
|---|---|---|---|---|---|---|
| 111 | `get_room_types` | `GET` `/v1/properties/:pid/room-types` | `inventory:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 112 | `get_rate_days` | `GET` `/v1/properties/:pid/rate-days` | `rates:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 113 | `get_restriction_days` | `GET` `/v1/properties/:pid/restriction-days` | `rates:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 114 | `get_domain_config` | `GET` `/v1/properties/:pid/config/domain` | `settings:configure` | *(omit)* | `pms.core` | `FAIL_CLOSED` |

Dispatcher patterns (method-discriminated; same path as the existing PUT/POST siblings is legal):

```
GET  /^\/v1\/properties\/([^/]+)\/room-types$/
GET  /^\/v1\/properties\/([^/]+)\/rate-days$/
GET  /^\/v1\/properties\/([^/]+)\/restriction-days$/
GET  /^\/v1\/properties\/([^/]+)\/config\/domain$/
```

Do **not** add `GET …/room-types/:id` this chunk (list is sufficient). Do **not** put config GET at `/config` without `/domain` — the writer is already `/config/domain`. Do **not** nest rate-day GET under `/room-types/:id/rates` as a GET (that PUT alias stays write-only; a GET there would be a second read URL for the same cells).

**Catalog:** no new ids. `COMMAND_CATALOG.length` stays **74**.

Kill-switch: entitled reads follow the existing `entitlementForRoute` pair (402 / 503). Missing permission → 403 with the table’s permission. Transport failure → existing `degradedFailClosedReadResponse()`.

---

## 4. Room types admin

### 4.1 `GET /room-types`

Query: `status=active` (default) | `archived` | `all`. Invalid → `400`.

DO RPC `listRoomTypes(status)` — new read, `assertRpcAvailable`, no lane touch required beyond existing read pattern (`listRatePlans` / `listChargeCodes`).

Body:

```ts
{
  ok: true,
  roomTypes: Array<{
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
    status: 'active' | 'archived';
    createdAt: number;
    updatedAt: number;
  }>;
}
```

Order by `code`. Empty property → `{ ok: true, roomTypes: [] }` (not 404).

Staff holds `inventory:read` (booking leftover 6). Owner/admin hold `inventory:write` for mutations. Nav for the **admin screen** is `inventory:write` (§13). The GET itself stays `inventory:read` so the wizard can label types without write.

### 4.2 SPA — Inventory / Room types

Route `/inventory` (default tab room types) and `/inventory/rooms` (§5). Gate: `InventoryRoute` mirroring `StaffRoute` on `inventory:write`. Staff never mounts it.

Table of active types: code, name, `roomCount`, occupancy (`maxAdults` / `maxOccupancy`), count of physical rooms from `GET /rooms` grouped by type (informational — `COUNT(room)` may be `< roomCount`; that is allowed). Empty: “No room types yet — create one to start selling.”

Create / edit form fields (Title Case labels): Code, Name, Room Count, Max Occupancy, Max Adults. Client mints `roomTypeId` with `crypto.randomUUID()`. `autocomplete="off"`. `spellCheck={false}` on Code. Occupancy inputs `type="number"` `min={1}`. Submit stays enabled until the request starts; button shows “Saving…” during flight. Inline errors; focus first invalid field.

Wire errors (existing codes, do not invent): `ROOM_TYPE_CODE_EXISTS` / id collision → 422 copy “An active room type already uses this code.” `ROOM_UNITS_EXCEED_COUNT` on lowering `roomCount` below `COUNT(room)` → “Cannot lower room count below the number of rooms. Rename rooms or wait for a delete path.” `OCCUPANCY` CHECK / invalid numbers → 400/422 with the wire error. `ARCHIVE_BLOCKED` → “This type still has future sold or blocked inventory — it cannot be archived.”

Archive is `DELETE` (catalog name). Confirmation modal: “Archive {code}? It will stop being sellable. Existing rooms and history stay.” Never immediate. BAR-equivalent does not exist for types.

Do **not** offer photos, amenities, virtual constituents, or keyless.

### 4.3 Unsaved changes

Warn before navigation (`beforeunload` and in-app route guard) when the create/edit form is dirty.

---

## 5. Rooms admin

Reuse `GET /rooms` (`housekeeping:read` — owner/admin have it). Do not add a parallel inventory list route. Do not change that permission.

Create: `POST /rooms` `{ roomId, roomTypeId, code, floor?, idempotencyKey }`. Client mints `roomId`. Type picker from `GET /room-types?status=active`. Floor optional.

Update: `PATCH /rooms/:id` `{ code?, floor?, idempotencyKey }`. Never send `roomTypeId`.

UI: grouped by room type. Columns: code, floor, housekeeping status (read-only; cleanliness lives on Housekeeping), open OOO ranges (read-only from `oooRanges`; do not rebuild the OOO editor). Empty type: “No rooms in this type — create one. Sellable count is still {roomCount}.”

`ROOM_COUNT_EXCEEDED` → “This type’s room count is full. Raise the type’s room count first.” Duplicate `code` → existing unique-index error, copy “Room code already exists.”

No delete control. No status dropdown (that is `housekeeping:write` on a different screen). No assign-room from here.

Lists `> 50` rooms: virtualize or `content-visibility: auto` (web-interface guideline). `font-variant-numeric: tabular-nums` on codes if they are numeric-ish; still `translate="no"` on codes / ids.

---

## 6. Rates matrix + rate plans

### 6.1 Widen `GET /rate-plans` (existing index 36 — not a new route)

`listRatePlans` adds the cancel-policy columns already on `rate_plan` (v20). Additive JSON; existing clients ignore unknown fields.

```ts
{
  ratePlanId: string;
  code: string;
  name: string;
  status: 'active';
  cancelPenaltyType: 'none' | 'first_night' | 'nights' | 'percent' | 'full';
  cancelGraceHours: number;
  cancelPenaltyNights: number | null;
  cancelPenaltyBps: number | null;
  cancelPolicyText: string | null;
}
```

Still **active only**. Archived plans stay hidden; `rates.delete_plan` remains archive. BAR cannot be archived — hide Archive on `ratePlanId === 'BAR'` (`DEFAULT_RATE_PLAN_ID`).

### 6.2 `GET /rate-days` (index 112)

Query (required): `fromDate`, `toDate` (`YYYY-MM-DD`). Optional: `roomTypeId`, `ratePlanId` (default `DEFAULT_RATE_PLAN_ID` inside the DO, same as writes). Inclusive range. Same 90-night cap as availability: `toDate > fromDate + 89` → `400 { error: 'date_range_exceeds_max' }`. `fromDate > toDate` → 400.

Missing cells are **omitted** (do not invent `0`). `amountMinor` integer, `currency` the stored cell currency (today always ledger).

```ts
{
  ok: true,
  days: Array<{
    roomTypeId: string;
    ratePlanId: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
    version: number;
  }>;
}
```

DO RPC `listRateDays({ fromDate, toDate, roomTypeId?, ratePlanId? })`. Filter `room_type_id` / `rate_plan_id` in SQL. No join required.

### 6.3 SPA — Rates

Nav `/rates` gated `rates:write`. Nested: `/rates/plans`, `/rates/matrix` (default), `/rates/restrictions` (§7). URL holds tab + matrix `from` / `to` / `plan` query params (deep-link filters).

**Plans.** List active. Create/edit: Code, Name, cancel penalty type (select), grace hours, nights / bps when the type needs them, policy text (textarea, optional). Archive with confirmation except BAR. Inclusions are **not** a field (prototype-holes leftover 6).

**Matrix.** Rows = active room types (`GET /room-types`). Columns = dates in `[from, to]` (default: property-local today → +13 nights, 14-day window, overridable). Plan selector from `GET /rate-plans`. Cell = major-unit input parsed with `parseMajorToMinor`; empty = no `rate_day` row. Display `formatMinor` with `tabular-nums`. Ledger currency from `GET …/config/domain` `pms.money.currency_code` (read-only chrome, not a picker).

Single-cell blur/commit → `PUT /rate-days` (existing). Bulk fill: date range + day-of-week checkboxes + amount → `POST /rates/bulk` with the cartesian product of selected types × matching dates. Cap bulk payload to the same 90-night window. Submit “Fill Selected Days”; spinner “Saving…”.

Empty matrix (no types): “Create a room type first.” Empty plan list cannot happen (BAR is seeded); if GET fails closed, block the matrix (do not invent BAR client-side).

Yield / competitor / forecast tabs: **out** (§16.5 / Phase 3).

---

## 7. Restrictions calendar

### 7.1 `GET /restriction-days` (index 113)

Query: `fromDate`, `toDate` required; `roomTypeId` optional. Same date-cap as §6.2. **Do not accept** `ratePlanId` other than omitted or `'*'`. Any other value → `400 { error: 'invalid_query', detail: 'type_wide_only' }`. SQL filter `rate_plan_id = '*'`.

```ts
{
  ok: true,
  days: Array<{
    roomTypeId: string;
    stayDate: string;
    minLos: number | null;
    maxLos: number | null;
    cta: boolean;
    ctd: boolean;
    stopSell: boolean;
    version: number;
  }>;
}
```

Missing days omitted (defaults at evaluation time stay in the restrictions module — the SPA does not invent them).

### 7.2 SPA

Same date window chrome as the matrix. Per cell: Min LOS, Max LOS, CTA, CTD, Stop sell. Writes are existing per-day `PUT /restriction-days` with `ratePlanId` omitted (DO defaults `'*'`). No bulk restriction command this chunk — fill loops PUTs only if the operator confirms a range action; each PUT has its own idempotency key. Prefer cell-level edits in v1.

Copy: “Stop sell hides the type from sale without changing inventory. Closed to arrival / departure apply to the stay’s boundary nights.” Do not collapse restrictions into the rate matrix.

Plan-scoped restrictions: no control, no column.

---

## 8. Settings — DOMAIN config

### 8.1 Reclassify `pms.ops.auto_assign_rooms`

**Lock:** change `class: 'OPERATIONAL'` → `class: 'DOMAIN'` and set `consumersExempt: true` (same family as `pms.folio.close_window_on_check_out`). Default stays `true`. Permission stays `settings:configure`.

Rationale: the leftover is “unread; check-in stays explicit.” When a consumer is later wired it will be a PropertyDO assignment decision, which §5.1 requires live in the DO. Leaving it OPERATIONAL would make Settings PUT a trap (`Only DOMAIN config may be stored in PropertyDO`). This chunk does **not** add that consumer.

Sibling keys `pms.ops.auto_assign_rule` and `pms.ops.auto_assign_rooming` stay OPERATIONAL and **off this screen**.

`assertRegisterInvariants` / config-consumer CI: `consumersExempt` keeps the DOMAIN-must-have-consumers rule green.

`pms.night_audit.auto_extend` is already DOMAIN — no register change. Still no night-audit reader.

### 8.2 `GET /config/domain` (index 114)

Permission `settings:configure` (majority PUT permission). Staff cannot call it. Edge does not try to split `inventory:configure` keys on GET — owner/admin hold both today (same honesty as rule-3 PUT).

DO RPC `listDomainConfig()`: for every `CONFIG_REGISTER` entry with `class === 'DOMAIN'`, return stored `property_config` row if present, else the **register default**. Never fall back to the register default for `pms.money.currency_code` or `pms.time.time_zone` when describing “stored ledger/clock” — those two already have dedicated readers that refuse the default. For the GET body: if the row is missing, `source: 'default'` and `value` is the register default **except** currency/timezone, which use `source: 'unset'` and `value: null` (matches `CURRENCY_UNSET` / `TIMEZONE_UNSET` honesty). After provision both rows exist.

```ts
{
  ok: true,
  keys: Array<{
    key: string;
    value: unknown;
    source: 'stored' | 'default' | 'unset';
    version: number | null;
    permission: string;           // from the register
    consumersExempt: boolean;
  }>;
}
```

Do **not** send Zod objects. Do **not** include OPERATIONAL / PRESENTATION / SECRET keys. Order: register order.

### 8.3 SPA — Settings `/settings`

Gate `settings:configure`. Nested tabs in the URL: `property` (default), `charges`, `tax`.

**Property tab** groups DOMAIN keys (do not dump a raw 23-row table without headings):

| Group | Keys |
|---|---|
| Property | `PATCH` name via `property.update_details` (`config:write` — same holders). `pms.time.time_zone` (IANA select or text; `spellCheck={false}`). |
| Availability | `pms.availability.allow_overbooking`, `pms.availability.oversell_allowance` |
| Night audit | `pms.night_audit.audit_time`, `auto_no_show`, `auto_extend` |
| Booking | `same_day_bookings`, `same_day_cutoff`, `require_prepayment`, `booking_date_change` |
| Money | `pms.money.currency_code` **read-only** (provisioned ledger; copy: “Ledger currency is set at provision and cannot change here.”). `pms.money.payment_alloc`. `pms.money.currencies_list` as JSON textarea with copy: “Not the FX allowlist — foreign tenders use FX rates on the folio.” |
| Folio | `breakfast_rule` (copy: “Display only — night audit does not auto-post from this.”). `close_window_on_check_out`, `auto_capture_on_check_out`. `pms.folio.configs` JSON, optional/advanced, `autocomplete="off"`. |
| Reservations | `pending_hold_hours`, `inquiry_ttl_days`, `check_in_cleanliness` (`strict` \| `off`), `check_out_require_zero_balance` |
| Housekeeping | `pms.housekeeping.require_inspection` |
| Ops (unread) | `pms.ops.auto_assign_rooms` — checkbox. Copy: “Stored for later. Check-in still requires an explicit room.” |

Each PUT: existing `PUT …/config/domain` with operator `reason` (required text, placeholder “Why this change…”). Idempotency via `stableKeyForOperation`. Boolean = checkbox. Integer = `type="number"`. Enum = `<select>`. Time `audit_time` / `same_day_cutoff` = `type="time"` or `HH:mm` text. Submit “Save {label}”; “Saving…” in flight. `aria-live="polite"` on success “Saved.” Errors inline from wire (`undeclared:`, class gate, schema fail).

Unsaved-form guard on dirty fields. `autocomplete="off"` on non-auth fields.

Do **not** render SECRET keys (bank, PayPal, terminals, invoice logo). Do **not** render PRESENTATION keys (date format, language) — those are OrgDO/KV and have no PropertyDO GET.

Timezone change: allowed. Do not claim rates rematerialize (leftover). ARI invalidation + night-audit reschedule already happen inside `tryPutDomainConfig` for keys that declare those consumers.

---

## 9. Charge codes + tax rules

Both live under Settings (`/settings/charges`, `/settings/tax`). Same `settings:configure` gate. Reads already exist (`folio:read`); owner/admin have it.

**Charge codes.** `GET ?status=all`. Table: code (`translate="no"`), name, status, tax group. Create: Code + Name. Edit: name + tax group. Archive / restore via `PUT …/status` with confirmation. System codes (`SYSTEM_CHARGE_CODES`) — hide Archive; copy “System code — cannot archive.” Restore is in scope (charge-code spec). Empty: “No charge codes.” (should not happen; ROOM/MISC/PAYMENT/TAX are seeded).

**Tax rules.** `GET /tax-rules`. List: name, rule key, type, rate (string, `tabular-nums`), tax group, output code, valid from / to. Create: existing POST body; `rate` is a decimal string, never a float. Open rule: **supersede** (new rate / dates), not an in-place PATCH. Copy: “Superseding closes this rule and opens a new one. Posted tax lines stay.” `ruleType` select: `PERCENTAGE` | `PER_PERSON_PER_NIGHT` | `FLAT`. Occupancy / tourist leftovers stay out of this SPA (tax-posting spec).

Client-core methods for both; opIds via `stableKeyForOperation`.

---

## 10. FX — link, do not rebuild

Settings Property tab includes a panel **FX Rates** (not an editor):

> Foreign-currency quotes are property-scoped and edited on the folio. Open an in-house stay’s folio → FX rates.

CTA: `<Link to="/in-house">Open in-house board</Link>` (Cmd-click works). Do **not** mount a second create/supersede form. Do **not** add `/settings/fx`. Do **not** deep-link `/folio/:id` without a reservation id.

FolioScreen editor remains the only Phase 1 actuator (`settings:configure` disclosure). This chunk does not change it.

---

## 11. Booking leftover 6 — room-type labels

`BookingScreen` type step: after (or in parallel with) availability, `GET /room-types?status=active` (`inventory:read`). Label = `{name} ({code})`. Fallback if the GET fails or a selectable id is missing from the directory: keep showing `roomTypeId` (do **not** block Confirm — availability/`quoteAriVersion` remains the TOCTOU gate).

`translate="no"` on code. Archived types still disappear from availability via zero `physical` / `free` (unchanged).

Tests: fixture types with `code`/`name` distinct from id; radio label contains name; availability-only failure still lists ids.

---

## 12. Booking leftover 3 — BoardScreen date seed

Replace `todayUtc()` seed.

**Lock:**

1. `dateParam` (valid `YYYY-MM-DD`) wins.
2. Else `date: string | null` starts `null`. When `usePropertyTimeZone()` yields a zone, set date to `propertyLocalToday(tz)` **once** (effect; do not fight a later user edit).
3. Arrivals / departures queries `enabled` only when `date != null`. In-house unchanged (no date).
4. After seeding, write `?date=` into the URL (`replace`) so refresh and Book-success `?date=` stay consistent.
5. Delete `todayUtc`. Severity already uses `propertyLocalToday`.

Loading copy while `date == null` and timezone pending: “Loading…” (`…` not `...`). Do not fetch the board for “UTC today” in a US-Pacific evening.

Tests: mocked `usePropertyTimeZone: () => 'America/Los_Angeles'` with a fixed instant whose UTC date ≠ Pacific date → input/query use Pacific. `?date=2026-09-14` still wins. In-house does not wait on date.

---

## 13. Nav, shell, permissions

Add to `NAV_ENTRIES` (`apps/web-pms/src/shell/nav.ts`) — core SPA, **not** a new module in `module-ui-registry.ts` (inventory is `pms-core`, same as Staff/Book):

| id | label | path | order | permission |
|---|---|---|---|---|
| `inventory` | Inventory | `/inventory` | 42 | `inventory:write` |
| `rates` | Rates | `/rates` | 44 | `rates:write` |
| `settings` | Settings | `/settings` | 70 | `settings:configure` |

`filterNavEntries` already hides on missing permission. Staff (no write/configure) never sees the three. Admin/owner see all three.

Route gates: `InventoryRoute` / `RatesRoute` / `SettingsRoute` — copy `StaffRoute` (do not mount screens, hence do not fire list queries, without the grant). Deep-link without permission → `/arrivals`.

Housekeeping module nav stays `order: 25`. Do not move it.

`App.tsx`: nested routes under each path (tabs). Unknown tab → default.

---

## 14. client-core

Add methods (typed bodies, existing `getJson` / classified errors). No fingerprint helper on the client.

| Method | HTTP |
|---|---|
| `listRoomTypes(propertyId, { status? })` | GET `/room-types` |
| `createRoomType` / `updateRoomType` / `archiveRoomType` | POST / PUT / DELETE |
| `createRoom` / `updateRoom` | POST / PATCH (listRooms exists) |
| `listRatePlans` / `createRatePlan` / `updateRatePlan` / `archiveRatePlan` | existing rate-plan routes |
| `listRateDays` / `putRateDay` / `bulkUpdateRates` | GET / PUT / POST bulk |
| `listRestrictionDays` / `putRestrictionDay` | GET / PUT |
| `listDomainConfig` / `putDomainConfig` | GET / PUT `/config/domain` |
| `updatePropertyDetails` | PATCH property |
| `listChargeCodes` / `createChargeCode` / `updateChargeCode` / `setChargeCodeStatus` | existing |
| `listTaxRules` / `createTaxRule` / `supersedeTaxRule` | existing |

Keys via `stableKeyForOperation`, not `bookingReservationOpId`.

---

## 15. UI guidelines (normative for this SPA)

Apply Vercel web-interface guidelines to these screens (not a visual-identity pass):

- Every input has a visible `<label>` (or `aria-label` on icon-only). Labels clickable.
- Icon-only controls (`aria-label`). Decorative icons `aria-hidden`.
- Visible `:focus-visible` ring; never `outline-none` without replacement.
- Buttons for actions; `<Link>` for navigation (Cmd/Ctrl/middle-click).
- Submit enabled until the request starts; then disable + “Saving…” / “Archiving…”.
- Errors inline; `role="alert"`; focus first error. Success `aria-live="polite"`.
- `autocomplete="off"` on codes, ids, amounts. `spellCheck={false}` on codes.
- Placeholders end with `…`. Loading copy ends with `…`.
- Destructive archive: confirmation modal, never immediate.
- Unsaved-form `beforeunload` + router guard.
- Dates via `type="date"` + property-local helpers; display with `Intl.DateTimeFormat` where not a wire `YYYY-MM-DD`.
- Money columns `tabular-nums`. Headings `text-wrap: pretty` if the token system allows; do not add a new type scale.
- Empty states, not broken tables. Long codes `truncate` + `min-w-0` on flex children.
- `overscroll-behavior: contain` on modals. `touch-action: manipulation` already on the shell if present — do not regress.
- Honor `prefers-reduced-motion` if any expand/collapse is added; animate only `opacity`/`transform`; never `transition: all`.
- Title Case headings/buttons. Specific verbs: “Archive Room Type”, “Save Time Zone”, “Fill Selected Days”.
- Identifiers (`roomTypeId`, codes, BAR) `translate="no"`.

Do not disable zoom. Do not block paste.

---

## 16. Degraded mode

| Surface | Outage |
|---|---|
| All new GETs | 503 FAIL_CLOSED; screen-level “Property unreachable — cannot load {inventory \| rates \| settings}.” Not an empty list. |
| All writers this SPA calls | 503 FAIL_CLOSED; no queue. Keep the form; do not pretend success. |
| Booking labels GET | Failure → fall back to ids; Confirm still gated on `quoteAriVersion`. |
| Board date seed | Independent of these reads. |

402 → existing entitlement store. 403 → invalidate `me`. Never print / never invent inventory.

---

## 17. File map (acceptance list, not a split mandate)

| Area | Likely paths |
|---|---|
| Route audit | `packages/contracts/src/v1-http-routes.ts` (append 111–114); `register.test.ts` pins |
| Register | `packages/contracts/src/config/register.ts` (`auto_assign_rooms` → DOMAIN + `consumersExempt`) |
| Dispatcher + DO reads | `apps/pms-core/src/v1-dispatch.ts`; `property-do.ts` `listRoomTypes` / `listRateDays` / `listRestrictionDays` / `listDomainConfig`; widen `listRatePlans` |
| Route tests | `apps/pms-core/test/` new or existing `*-routes.spec.ts` (inventory / rates / config / charge-codes / tax) |
| client-core | `packages/client-core/src/api.ts` + tests |
| Nav / routes | `apps/web-pms/src/shell/nav.ts`; `App.tsx`; `*Route.tsx` gates |
| Screens | `apps/web-pms/src/screens/` Inventory (types + rooms), Rates (plans + matrix + restrictions), Settings (config + charges + tax + FX link) |
| Leftovers | `BookingScreen.tsx` labels; `BoardScreen.tsx` date seed + tests |
| Pointers | One-sentence amends in booking-wizard / night-audit / lifecycle / rule3 / rate-plans / multi-currency specs **when this chunk lands** (not this spec PR unless the reviewer asks) |

No `ARCHITECTURE.md` rewrite required beyond an optional Phase 1 note when the chunk ships. Do not silently skip leftover pointers.

---

## 18. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Room-type directory labels | Booking wizard leftover **6** |
| 2 | BoardScreen property-local today | Booking wizard leftover **3** |
| 3 | `GET` room-types | Implied by leftover 6 + inventory SPA |
| 4 | `GET` rate-days | Rate-plans vertical (PUT-only cells) |
| 5 | `GET` restriction-days | Same shape as rate-days |
| 6 | `GET` DOMAIN config | Rule-3 PUT-only surface |
| 7 | Widen `GET /rate-plans` cancel fields | Rate-plans SPA round-trip |
| 8 | Display/edit `pms.night_audit.auto_extend` | Night-audit leftover **4** — **no consumer** |
| 9 | Display/edit `pms.ops.auto_assign_rooms` | Lifecycle leftover **3** — **no consumer**; reclass DOMAIN |

---

## 19. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | Virtual room types | §7.1; no constituent UI |
| 2 | Derived / OrgDO rate plans | §7.2; property-local plans stay |
| 3 | `rooms.delete` / unit archive | Rooms-vertical leftover |
| 4 | Tape chart / hibernating WebSockets | Closed by [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md). |
| 5 | `ui-kit` / visual identity | §16.4 |
| 6 | City ledger / AR | §7.3 |
| 7 | Invoice generation | §16.1 / §4.7 R2 |
| 8 | Night-audit auto-transfer | Folio-money leftover; pinned 7 steps |
| 9 | Recurring charges / `breakfast_rule` engine | Prototype-holes leftover 1; Settings may **edit the string** |
| 10 | Partial refunds | Folio-money leftover 4 remainder |
| 11 | Full exception-queue workbench | ARCHITECTURE still owed |
| 12 | PCI / real PSP | Simulate + Folio FX stay |
| 13 | Plan-scoped restrictions | Rate-plans §2.3 |
| 14 | `rematerializesRates` consumer | Rule-3 leftover |
| 15 | `pms.money.currencies_list` as FX allowlist | Multi-currency leftover 2 |
| 16 | Auto-extend / auto-assign **consumers** | Display/edit only |
| 17 | Room-type photos | Prototype-holes leftover 5 |
| 18 | Rate-plan inclusions | Prototype-holes leftover 6 |
| 19 | OPERATIONAL/PRESENTATION OrgDO settings screen | No store |
| 20 | SECRET / payments admin | Never in config |
| 21 | Bulk restriction command | Cell PUTs only |
| 22 | DO lock forbidding ledger-currency change | SPA read-only; PUT path unchanged |
| 23 | Changing `GET /rooms` to `inventory:read` | Reuse HK permission |
| 24 | Booking leftover 1 (plan picker in wizard) | Quantity-only stays |
| 25 | Proactive entitlement chrome | `/me` leftover |

---

## 20. Tests (acceptance-shaped)

**Contracts / register**

1. `V1_HTTP_ROUTE_AUDIT[110].id === 'post_folio_fx_adjustment'`; `[111]='get_room_types'`; `[112]='get_rate_days'`; `[113]='get_restriction_days'`; `[114]='get_domain_config'`. Each: `scope:'property'`, no `commandId`, `entitlement:'pms.core'`, `degradedRead:'FAIL_CLOSED'`, permissions per §3.
2. `COMMAND_CATALOG` length **74**. `AUDIT_WRITER_COMMAND_IDS.size === 49`. `PLATFORM_GAPS` `[]`.
3. `getConfigEntry('pms.ops.auto_assign_rooms').class === 'DOMAIN'` and `consumersExempt === true`. `assertRegisterInvariants()` still passes. `pms.night_audit.auto_extend` unchanged DOMAIN.
4. `PROPERTY_SCHEMA_HEAD === 24`. Purge table list unchanged.

**pms-core**

5. `GET /room-types` as `user_staff` → 200 (has `inventory:read`); as no-inventory → 403. `status=all` includes archived after DELETE. Empty → `{ roomTypes: [] }`. DO down → 503.
6. Create / update / archive still work; SPA does not need new writer tests beyond smoke that GET sees the write.
7. `GET /rate-days` returns PUT cells; omitted `ratePlanId` defaults BAR; 91-night range → `date_range_exceeds_max`; missing cells omitted.
8. `GET /restriction-days` returns PUT type-wide rows; `ratePlanId=CORP` query → 400 `type_wide_only`; booleans round-trip.
9. `GET /config/domain` as staff → 403 `settings:configure`. Owner sees DOMAIN keys including `auto_extend` and `auto_assign_rooms`. PUT then GET round-trips value + `source:'stored'`. OPERATIONAL sibling `auto_assign_rule` **absent**. SECRET keys absent. Currency/timezone after provision: `source:'stored'`.
10. PUT `auto_assign_rooms` succeeds after reclass (was a class-gate failure). Value stored; **no** check-in/assign test changes.
11. `GET /rate-plans` includes cancel fields. BAR archive still 422.
12. Kill-switch on the four new GETs → entitled fail (402/503 pair).

**web-pms**

13. Nav: staff me hides Inventory / Rates / Settings; admin shows all three.
14. InventoryRoute without `inventory:write` redirects; with grant, create type then room; archive confirm; `room_type_id` not sent on room PATCH.
15. Rates matrix: fill one cell → `PUT /rate-days` with integer `amountMinor`; bulk → `POST /rates/bulk`; empty types empty-state.
16. Restrictions: toggle stop-sell → PUT without a foreign `ratePlanId`.
17. Settings: toggle `auto_extend` → PUT `{ key, value, reason }`; currency input absent or disabled; FX panel links to `/in-house`, no second FX form; charge-code archive hidden on `ROOM`.
18. BookingScreen: label contains type name; GET fail still shows id.
19. BoardScreen: timezone `America/Los_Angeles` vs UTC date mismatch → Pacific `YYYY-MM-DD`; `?date=` override; no `todayUtc` in source.

---

## 21. Acceptance / reviewer checklist

- [ ] Four routes appended at **111–114** only; `[110]` unmoved; no catalog ids added.
- [ ] `GET /room-types` + Inventory SPA (list/create/update/archive). Occupancy fields. No virtual types, no photos.
- [ ] Rooms admin on existing `GET /rooms` + `POST`/`PATCH`. No delete. `room_type_id` immutable.
- [ ] `GET /rate-days` + matrix + bulk. Integer minor. Ledger currency chrome only. `GET /rate-plans` cancel fields. BAR not archivable.
- [ ] `GET /restriction-days` type-wide only + calendar. Rates and restrictions stay separate ledgers.
- [ ] `GET …/config/domain` + Settings DOMAIN editor. `auto_assign_rooms` reclassified DOMAIN + `consumersExempt`. `auto_extend` editable. **Zero new consumers.** Currency read-only. SECRET/PRESENTATION off-screen.
- [ ] Charge codes + tax rules admin. Tax supersede, not in-place edit. System codes protected.
- [ ] Settings FX is a **link** to in-house/folio editor, not a rebuild.
- [ ] Booking leftover 6 closed (labels). Booking leftover 3 closed (board date seed).
- [ ] Nav gated `inventory:write` / `rates:write` / `settings:configure`. StaffRoute-shaped gates. Existing tokens only — no `ui-kit`.
- [ ] `COMMAND_CATALOG` 74; audit writers 49; schema head 24; `PLATFORM_GAPS` []; no new `export class`; no new purge table; `NIGHT_AUDIT_STEPS` 7.
- [ ] Scope-out list in §1.3 / §19 named: virtual types, derived/OrgDO plans, `rooms.delete`, tape chart, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring, partial refunds, exception workbench, PCI.
- [ ] Leftovers §18 (folded) and §19 (deferred) both present. Web-interface guidelines §15 applied to new forms.
- [ ] Tests §20 green in the later implementation plan — this spec does not implement them.

---

## 22. Open questions (locked)

1. **Nav permission for Inventory.** **Locked: `inventory:write`.** A read-only inventory for staff is unexercisable in a useful way (they cannot create types) and would duplicate Housekeeping’s room list. GET `/room-types` stays `inventory:read` for the wizard.
2. **`auto_assign_rooms` class.** **Locked: reclassify to DOMAIN + `consumersExempt`.** OPERATIONAL cannot round-trip on `config.put_domain`. Do not invent OrgDO config this chunk.
3. **FX on Settings.** **Locked: link only.** Multi-currency already shipped the Folio editor; a second form is a rebuild.
4. **Rate-day GET path.** **Locked: `GET /rate-days`**, sibling of PUT, not `GET /room-types/:id/rates`. One read URL.
5. **Restriction bulk command.** **Locked: not this chunk.** Cell PUTs.
6. **Ledger currency editor.** **Locked: read-only in SPA.** No new DO lock.
7. **Module UI registry.** **Locked: core `nav.ts`**, not a new `pms.inventory` UI package. Housekeeping remains the only module contribution.

---

## 23. Implementation checklist (for the plan author; not a plan)

This section is a spec completeness aid. **Do not treat it as the implementation plan.** The plan is a later turn after reviewer approval.

- [ ] Append routes 111–114; pin register.test; reclass `auto_assign_rooms`.
- [ ] DO list RPCs + widen `listRatePlans`; dispatcher GET handlers; FAIL_CLOSED mapping.
- [ ] client-core methods.
- [ ] Nav + route gates + screens (inventory, rates, settings).
- [ ] Booking labels + BoardScreen date seed.
- [ ] Tests §20.
- [ ] Stop. Do not implement leftover §19 items.
