# Tape chart + live front-office board

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** ARCHITECTURE.md §4.6 (`READ_STALE` = serve last projection and watermark the age; arrivals / in-house / room status listed there), §7.1 (room-type inventory; OOO range → `blocked`; assign overlap is half-open `[arrival, departure)`), §7.7 (hibernating WebSockets, not a short-TTL projection; bounded window; `serializeAttachment`; constructor must stay a cheap migrate), §7.8 (arrivals, departures, in-house, room status, today’s occupancy are OLTP), §9 (shell stale-data watermark; `entitlement.changed` over WebSocket is a *different* channel), §14 Phase 1 (rebuild prototype screens against live APIs), §16.1 (dashboard, reservations directory, front-desk board, tape chart, available-rooms), §16.3 / §16.4 (preserve interaction; `ui-kit` is a later slice), §16.5 (tape chart / front-desk board already specified as §7.7); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md) (list + batch compose; WS leftover); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) (watermark leftover; WS leftover); [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) (`GET /rooms`, `FAIL_CLOSED` honesty); [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) (OOO ranges; WS leftover); [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) (`get_reservation_search`; DND stay flag; leftover 4 honesty pass); [property setup SPA](./2026-08-13-property-setup-spa-design.md) (tape leftover 4; next free route **115**); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md) (`READ_STALE` is a route-audit capability that requires a projection); command catalog; `v1-http-routes.ts`; `apps/web-pms/src/screens/` / `shell/nav.ts` / `shell/module-ui-registry.ts`; Cloudflare Hibernation WebSocket API (`ctx.acceptWebSocket`, `serializeAttachment`, `webSocketMessage` / `webSocketClose`)

**Closes:** ARCHITECTURE.md §7.7 operational read path and §16.1 / §16.3 item 3 for the tape chart, reservations directory, available-rooms, and dashboard summary widgets. Front-desk SPA-shell leftovers **stale-data watermark** and **hibernation WebSocket (front-office deltas)**. Operational-reads leftover **hibernation WebSocket for front-desk deltas**. Room-ops leftover **hibernating WebSocket tape chart**. Property-setup leftover **4** (tape chart / hibernating WebSockets). The first operator-visible `READ_STALE` watermark (§9).

**Amends:** [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md) leftover “Hibernation WebSocket for front-desk deltas” (this chunk **closes** it; initial load stays the HTTP snapshot / existing lists; push is thereafter); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) leftovers watermark + WS (watermark **closes**; entitlement push stays deferred); [room operations](./2026-08-12-room-operations-hk-completion-design.md) leftover 8 (board is no longer HTTP-only); [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover 4; [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) leftover 4 **only** as the watermark UI — existing `get_front_desk_*` / `get_guest` / `get_reservation_search` stay `FAIL_CLOSED` (no KV projection; names still OrgDO). Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

Property setup now has a live SPA. The desk still works from three paginated lists (`BoardScreen` modes arrivals / in-house / departures). There is no rooms × dates grid, no reservations directory, no available-rooms list, no occupancy widgets, and no live push. Operators refresh. Architecture §7.7 forbids polling a single-threaded PropertyDO for this surface and forbids a short-TTL KV projection: the desk needs data fresh to the second, and a TTL short enough to be safe is nearly useless.

This chunk rebuilds the prototype’s tape chart, reservations directory, available-rooms, and dashboard-summary interaction against the live catalog. It adds the **read** routes the SPA cannot fake from the existing 50-row list pages. It adds the hibernating WebSocket §7.7 specified. It does not invent writers, folio behaviour, or a new PropertyDO table.

There are no `ArrivalsScreen.tsx` / `InHouseScreen.tsx` / `DeparturesScreen.tsx` files. Those URLs already mount `BoardScreen` with `mode`. This chunk **keeps** those list routes (check-in / due-out / overstay workflows live there) and **adds** the visual board they never were.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Arrivals / departures / in-house lists | `GET /v1/properties/:pid/front-desk/arrivals\|departures\|in-house` (`get_front_desk_*`, `reservations:read`, `pms.core`, `degradedRead: 'FAIL_CLOSED'`). Page size hard max **50**. Item shape is `mapFrontDeskListRow`: `reservationId, roomTypeId, guestRef, arrivalDate, departureDate, status, roomId, adults, children, frontOfficeComment, vipFlag, dndFlag, confirmBy, ratePlanId`. **No names, no `piiKeyId`.** |
| Guest compose | `POST …/guests/batch` (`post_guests_batch`, `guests:read`, `FAIL_CLOSED`). Max 50 refs. SPA always makes **two calls** per list page. Do not join names in PropertyDO. |
| Exact-id + name search | `GET …/reservations-search?q=` (`get_reservation_search` **[105]**, `FAIL_CLOSED`). Exact `reservation_id` (any status) or decrypt-scan of ≤200 stay guests, cap 20 name hits. AppShell top-bar already mounts this (`data-testid="reservation-search"`). **No date-window / status directory.** |
| Rooms + OOO + HK status | `GET /rooms` (`get_rooms`, **`housekeeping:read`**, `FAIL_CLOSED`) → `roomId, roomTypeId, code, status, floor, oooRanges[]`. `room.status` CHECK `clean \| dirty \| inspected \| out_of_order`. OOO is `room_ooo` ranges, not a second cleanliness value. |
| Occupying-room overlap | `assertRoomAssignableSync` (`property-do.ts` ~5035): `status IN ('pending','confirmed','checked_in')` AND `arrival_date < other.departure` AND `departure_date > other.arrival` (half-open). OOO vs assigned uses the same predicate (`~4769`). |
| Type-level availability | `GET …/availability` (`get_property_availability`, `inventory:read`, **`READ_STALE`**, KV-first). Type `free`, not which physical room. 90 inclusive nights. This is **not** the tape. |
| Booking wizard | `/book` already quotes type availability and creates stays. Not rebuilt. |
| Board SPA | `BoardScreen.tsx` + `App.tsx` `/arrivals` `/in-house` `/departures`. Property-local today seed (setup leftover 3 **closed**). VIP/DND badges. No counts, no grid, no WS. Date in `?date=` for arrivals/departures. |
| Nav | `nav.ts`: Arrivals 10, In-house 20, Departures 30, Book 40, Inventory 42, Rates 44, Staff 50, Roster 55, Night audit 60, Settings 70. Housekeeping module `order: 25`. **No Board / Chart / Reservations / Dashboard.** Index redirects to `/arrivals`. |
| WebSockets | **None.** `apps/pms-core` has zero `acceptWebSocket` / `webSocketMessage` / `serializeAttachment`. `PropertyDO` has **no `fetch()`**. Worker `index.ts` sends `/v1/*` to `handleV1` → JSON dispatcher. Browser `WebSocket` cannot set `x-dev-actor`. |
| `READ_STALE` today | Only `get_property_availability` is audited `READ_STALE` and actually serves KV. Front-desk lists are `FAIL_CLOSED` because there is no reservation projection and names live in OrgDO. SPA has **no watermark chrome**. `classify.ts` already understands `degraded: 'READ_STALE'`. |
| Constructor / migrate | `PropertyDO` constructor `blockConcurrencyWhile` → `migrateSql` + FK pragma + jurisdiction assert. `migrateSql` is documented as a cheap version check (`CREATE TABLE IF NOT EXISTS schema_version` + `MAX(version)`). Pending migrations only when behind. |
| Catalog / routes / audit | `COMMAND_CATALOG` **74**. `V1_HTTP_ROUTE_AUDIT` **115** rows, indices **0–114**, last `[114] = get_domain_config`. Next free **115**. `AUDIT_WRITER_COMMAND_IDS.size === 49`. `PLATFORM_GAPS = []`. |
| Schema head | `PROPERTY_SCHEMA_HEAD === 24`. This chunk **does not migrate**. |
| Indexes already present | `reservation_arrival_idx`, `reservation_departure_idx`, partial `reservation_in_house_idx`, partial `reservation_room_idx` (`room_id IS NOT NULL`). Reuse. |
| Class denylist / purge | No new `export class`. No new table → `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `NIGHT_AUDIT_STEPS` length **7**. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[114] = get_domain_config` | next **115**; five reads **115–119** |
| `COMMAND_CATALOG` | length **74** | **unchanged** (reads are not commands) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **49** | unchanged |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **24** | unchanged |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | includes `fx_rate` / `payment_event` / `payment_dispute` / `room_ooo` | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Tape chart screen: rooms × dates grid of occupying reservation blocks, OOO ranges, and housekeeping status. HTTP snapshot + hibernating WS deltas (§4, §8, §9).
2. Reservations directory: searchable / filterable list (today, tomorrow, this week, all). Reuse `get_reservation_search` for `q`; add a windowed list GET for the filters that search does not have (§5).
3. Live updates: one property-scoped hibernating WebSocket for front-office data. Boards, tape, directory, available-rooms, and summary widgets update without manual refresh (§8).
4. Stale watermark: first operator-visible `READ_STALE` surface when the socket is stale, rendering the last good snapshot with age (§8.6, §10).
5. Available-rooms view: which physical rooms are free for a date range, respecting OOO and occupying stays (§6).
6. Dashboard / arrivals-departures summary widgets on the tape header and on the existing list boards (§7).
7. Keep existing Arrivals / In-house / Departures list screens; they become live via the same socket (invalidate React Query) rather than a rewrite.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **Virtual room types** (§7.1). No constituent graph, no inherited-restriction UI.
- **Derived / OrgDO rate plans** (§7.2).
- **`rooms.delete` / physical-unit archive.** Rooms-vertical leftover.
- **Property setup / rates / settings SPA.** Already shipped. Do not rebuild Inventory / Rates / Settings.
- **`ui-kit` / visual identity** (§16.4). Existing `apps/web-pms` tokens and `check:web-pms-colors`. No Tailwind, no prototype palette, no `packages/ui-kit`.
- **City ledger / invoices / auto-transfer / recurring charges / partial refunds.**
- **Full exception-queue workbench.** `ExceptionsPanel` stays.
- **Guest CRM directory** beyond `guestRef` + batch hydrate already used by boards. No blind-index name search (prototype-holes leftover 2). No org-wide guest list.
- **Any PCI / real PSP work.**
- **New PropertyDO tables.** Assemble the tape from `room`, `room_ooo`, `reservation`. Architecture’s “consider a materialized view” is **rejected** this chunk.
- **New catalog commands.** Reads only. Tape is not a writer. Click-through uses existing Book / Folio / Check-in / Assign routes.
- **`entitlement.changed` WebSocket** (§9 / §6.3). Org-scoped; does not belong on PropertyDO. Refetch-on-402 stays.
- **Reclassifying shipped list/GET routes** from `FAIL_CLOSED` to `READ_STALE` (prototype-holes leftover 4 remainder). No reservation KV projection.
- **DND on the housekeeping board** (prototype-holes leftover 3). Tape shows `dndFlag` on stay blocks; `listRooms` is not joined.
- **Assign-from-empty-cell / drag-to-assign / drag-to-move.** Read-heavy. Navigation to `/book` or `/check-in/:id` is allowed; no new assign UX that posts.
- **Polling as the live path.** Retry of `READ_STALE` HTTP (availability) is unrelated and unchanged.
- **Type-level `GET /availability` as the tape.** Different grain.
- **Group blocks / allotments / `held` behaviour** (Phase 2 / 3).
- **Staff room blocks as zero-rate reservations.**

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers.** This chunk does not post, reverse, or display folio balances on the tape. No float on the wire.
2. **The folio is append-only.** This chunk does not touch `folio_line`.
3. **Domain code has zero platform imports.**
4. **Every mutation already emits events + audit.** This chunk does not add writers. New reads emit nothing. WS deltas are **not** domain events; they are a fan-out of state the mutation already committed.
5. **Degraded mode never creates an obligation.** All new HTTP reads and the WS handshake are `FAIL_CLOSED`. A stale socket never queues a reservation, assign, or status change. The watermark is display-only.
6. **`runIdempotent` stays sync-only.** Snapshot SQL and `ws.send` are sync. Do not `await` OrgDO, KV, or `fetch` inside a tape RPC or inside `broadcastFrontOffice`.
7. **Schema freeze.** No new PropertyDO table, ALTER, or `PROPERTY_SCHEMA_HEAD` bump. `pnpm generate:ddl` must be a no-op diff. Do not add a covering index “just in case”; existing arrival / room indexes serve the bounded window.
8. **No new purge table.** `PROPERTY_PURGE_INVENTORY_TABLES` unchanged.
9. **No new `export class`.** `PropertyDO` already exists (adding `fetch` / handlers is not a new class). File-local errors only. Do not add to `CLASS_DENYLIST`.
10. **`NIGHT_AUDIT_STEPS` stays seven.**
11. **Route audit append-only.** New routes start at index **115**. `[114] = get_domain_config` does not move. `findRoute` is method + first-match — do **not** nest new GETs under `/reservations/:id` or `/rooms/:id`.
12. **New catalog commands** (none expected) would carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. Reads omit `commandId`.
13. **Guest names never live in PropertyDO or on the socket.** Snapshot / delta / directory items carry `guestRef`. SPA composes via `POST …/guests/batch`. Same two-call rule as the lists. Erasure remains crypto-shredding in OrgDO.
14. **Occupying a physical room is the assign overlap predicate.** Tape blocks and available-rooms use `status IN ('pending','confirmed','checked_in')` and half-open `[arrival, departure)`. Inquiry without a room is directory-only. `cancelled` / `no_show` / `checked_out` do not occupy.
15. **OOO is a range, not a cleanliness value.** Tape draws `room_ooo` spans. `room.status` is the row’s HK chip (`clean` / `dirty` / `inspected` / `out_of_order`). DND is `reservation.dnd_flag`, never `room.status`.
16. **Hibernating WebSockets, not polling, not short-TTL KV.** Idle sockets must not keep the isolate awake (`setInterval` / outbound WS are forbidden on this path). `ctx.acceptWebSocket` — never `ws.accept()`.
17. **Constructor stays a cheap migrate.** Do not scan sockets, assemble a tape, or touch OrgDO in the constructor. `migrateSql` is the version check §7.7 requires.
18. **`READ_STALE` on the audit row requires a projection.** New HTTP routes are `FAIL_CLOSED` (no KV tape). The **operator** `READ_STALE` surface is the SPA watermark over the last in-memory snapshot when the socket is stale. Do not label the snapshot GET `READ_STALE` — that would claim a capability the route does not have (same honesty as `get_folio` / `get_rooms`).
19. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
20. **Visual identity is not this chunk.** Existing tokens, `statusClass`, `check:web-pms-colors`. Interaction (grid of rooms × dates, directory windows, available list, live without refresh) comes from the prototype; appearance does not.
21. **Bounded window.** Tape / available-rooms / WS subscribe use the same 90 inclusive-night cap as availability (`toDate > fromDate + 89` → `400 { error: 'date_range_exceeds_max' }`).

---

## 3. HTTP routes to append (normative)

Append-only. Do not reorder 0–114.

| Index | `id` | Method / path | Permission | `commandId` | Entitlement | `degradedRead` |
|---|---|---|---|---|---|---|
| 115 | `get_front_desk_tape` | `GET` `/v1/properties/:pid/front-desk/tape` | `reservations:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 116 | `get_front_desk_directory` | `GET` `/v1/properties/:pid/front-desk/directory` | `reservations:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 117 | `get_front_desk_available_rooms` | `GET` `/v1/properties/:pid/front-desk/available-rooms` | `reservations:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 118 | `get_front_desk_summary` | `GET` `/v1/properties/:pid/front-desk/summary` | `reservations:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 119 | `get_front_desk_stream` | `GET` `/v1/properties/:pid/front-desk/stream` | `reservations:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |

Dispatcher patterns (append at **end** of `V1_ROUTES` in **identical order**; method-discriminated):

```
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/tape$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/directory$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/available-rooms$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/summary$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/stream$/
```

Non-colliding `/front-desk/*` space — same lock as the operational-reads spec. Do **not** use `/reservations/tape` or `/reservations/search` (would collide with `get_reservation` first-match). Do **not** change `GET /rooms` permission; the tape RPC reads `room` / `room_ooo` internally so staff with `reservations:read` (who already have `housekeeping:read`, but the route must not require it) can load the chart in one call.

`get_front_desk_stream` is a WebSocket upgrade. Missing `Upgrade: websocket` → **400** `{ error: 'expected_websocket' }`. Successful handshake → **101** with the `webSocket` pair; **not** JSON. Kill-switch / missing permission / DO transport failure happen **before** `acceptWebSocket` (402 / 403 / 503 `FAIL_CLOSED`). Do not accept a socket and then fail closed.

**Catalog:** no new ids. `COMMAND_CATALOG.length` stays **74**.

Kill-switch: entitled reads follow the existing `entitlementForRoute` pair (402 / 503). Missing permission → 403 with `reservations:read`. Transport failure on JSON GETs → existing `degradedFailClosedReadResponse()`. Transport failure on the upgrade → same 503 body, no 101.

---

## 4. Tape chart snapshot — `[115] get_front_desk_tape`

### 4.1 Query

Required: `fromDate`, `toDate` (`YYYY-MM-DD`). Inclusive stay-date window. Same 90-night cap as availability: `toDate > fromDate + 89` → `400 { error: 'date_range_exceeds_max' }`. `fromDate > toDate` or invalid → **400**. Optional: `roomTypeId` (restrict rows).

Empty property (zero rooms) → **200** with empty `rooms` / `blocks` / `ooo` (not 404).

### 4.2 PropertyDO RPC `readFrontOfficeTape(fromDate, toDate, roomTypeId?)`

`assertRpcAvailable`. Sync SQL. No OrgDO. No lane beyond the existing read pattern (`listArrivals` / `listRooms`).

1. **Rooms** — same columns as `listRooms`, filtered by optional type, `ORDER BY code`. Include `status` (HK). Do not omit OOO rooms; they are rows with OOO overlays.
2. **Blocks** — reservations with `status IN ('pending','confirmed','checked_in')` overlapping the inclusive date window: `arrival_date <= toDate AND departure_date > fromDate` (a stay occupies nights `[arrival, departure)`). Include `roomId` null (unassigned lane). Map via `mapFrontDeskListRow`.
3. **OOO** — `room_ooo` rows overlapping the window (`start_date < toExclusive AND end_date > fromDate`), where `toExclusive` is the calendar day after `toDate`.
4. **`asOf`** — unix ms of the read clock. This is the watermark timestamp, not a CDC cursor.

Wire:

```ts
{
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: Array<{
    roomId: string;
    roomTypeId: string;
    code: string;
    status: string;
    floor: string | null;
  }>;
  blocks: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
  ooo: Array<{ oooId: string; roomId: string; startDate: string; endDate: string; reason: string | null }>;
}
```

**Lock (normative):** reconnect / resubscribe sends a **full window snapshot**, not a versioned delta log. No `tapeVersion` counter, no `property_config` bump on mutation, no ALTER for `reservation.updated_at`. `asOf` is diagnostic + watermark age only. A client that missed a delta recovers by snapshot, never by replaying a log this chunk does not store.

### 4.3 SPA — `/board`

Nav entry `{ id: 'board', label: 'Board', path: '/board', order: 8, permission: 'reservations:read' }`. Index `/` redirects to `/board` (not `/arrivals`).

URL: `/board?from=&to=` (deep-link the window; default property-local today through today+6, seven inclusive nights). Changing the date inputs writes the query string (`replace`). `usePropertyTimeZone` seed matches BoardScreen leftover-3 behaviour; `?from=` / `?to=` override.

Grid:

- Rows: rooms grouped by room type (`GET /room-types` for labels — already shipped `[111]`). Unassigned occupying stays render in a leading **Unassigned** row (`data-testid="tape-unassigned"`). Empty type with no rooms: skip (sellable count is inventory, not this grid).
- Columns: each stay-date in `[fromDate, toDate]`. Header uses `Intl.DateTimeFormat` with the property time zone, `font-variant-numeric: tabular-nums`.
- Stay blocks: horizontal span `arrivalDate` → `departureDate` (exclusive end). Label: guest compose (batch) or `guestRef` while pending; VIP / DND badges reuse `data-testid="badge-vip"` / `badge-dnd"`. Status colour via existing `statusClass` / `boardRowSeverity` tokens — **do not** invent new `--status-*` pairs without `check:web-pms-colors`.
- OOO spans: `status-attention`, `aria-label` including reason or “Out of order”.
- HK chip on the row header from `rooms[].status`.
- Click a stay block → `<Link to={/folio/:id}>` (stay home). Click does not POST.
- Empty cell: not a write target. No drag.

Virtualize room rows when `rooms.length > 50` (`content-visibility: auto` or equivalent). `min-w-0` + truncate long guest names. Honor `prefers-reduced-motion` (no transform slide of blocks). Animate only `opacity` if at all; never `transition: all`.

Empty: “No rooms yet — create rooms in Inventory.” (Inventory link only if `inventory:write`.) Fail-closed: same copy pattern as BoardScreen — *“Property unreachable — board cannot load. This is not an empty day.”* `role="alert"`.

`aria-live="polite"` on a visually-hidden region that announces “Board updated” when a delta lands (not on every cell).

Loading copy ends with an ellipsis: “Loading…”.

### 4.4 Writes

None. Check-in / assign / OOO / HK stay on existing screens. Tape may **link** to `/check-in/:id` for `confirmed` arrivals in the visible window (optional chrome, same as the arrivals table). Do not embed those forms.

---

## 5. Reservations directory — `[116] get_front_desk_directory`

Searchable / filterable list. The top-bar search is already exact-id + name. The missing piece is a **windowed directory** of stays (today / tomorrow / this week / all), which arrivals/departures/in-house are not: those are operational boards with status predicates, not a directory.

### 5.1 Query

| Param | Rule |
|---|---|
| `window` | required: `today` \| `tomorrow` \| `week` \| `all`. Else **400** `{ error: 'invalid_window' }`. |
| `date` | `YYYY-MM-DD`. **Required** when `window` ≠ `all` (SPA sends property-local today, same as BoardScreen). Ignored when `window=all`. Missing/invalid when required → **400**. |
| `status` | optional. Comma-separated `ReservationStatus` values. Invalid token → **400**. Omit = all statuses. |
| `limit` / `cursor` | same as front-desk lists: default 50, **clamp** to 50, cursor opaque base64url of the sort tuple. Invalid cursor → **400** `{ error: 'invalid_cursor' }`. |

**Window semantics (arrival-date, not occupancy overlap — occupancy is the tape):**

| `window` | Filter |
|---|---|
| `today` | `arrival_date = :date` |
| `tomorrow` | `arrival_date = date(:date, '+1 day')` |
| `week` | `arrival_date >= :date AND arrival_date <= date(:date, '+6 days')` |
| `all` | no arrival predicate |

Sort: `arrival_date DESC`, `reservation_id DESC` (newest arrivals first; `all` is a history). Cursor resume: `(arrival_date < :d) OR (arrival_date = :d AND reservation_id < :id)`.

Item shape = `mapFrontDeskListRow` (reuse). Empty page `{ ok: true, items: [], nextCursor: null }` — **200**, not 404.

No `q` on this route. Directory search box calls existing `searchReservations` (AppShell control may be reused, or a local field with `autocomplete="off"` that navigates / replaces the table with search hits). Do not invent a second name-scan.

### 5.2 SPA — `/reservations`

Nav `{ id: 'reservations', label: 'Reservations', path: '/reservations', order: 35, permission: 'reservations:read' }`.

URL: `/reservations?window=today&date=&status=` (deep-link). Tabs/segmented control: Today, Tomorrow, This Week, All. Status filter: all / active (`inquiry,pending,confirmed,checked_in`) / terminal (`checked_out,cancelled,no_show`). Title Case labels. `tabular-nums` on dates.

Table columns: reservation id (`translate="no"`), guest (batch compose, same `guestLabel`), status, arrival → departure, room code if `roomId` (join from tape rooms cache or a `listRooms` call **only if** `housekeeping:read`; otherwise show `roomId` truncated). Staff have `housekeeping:read`; still do not fail the directory if that GET 403s — show the stay without a code.

Row click / Enter → `/folio/:id`. Empty: “No reservations in this window.” Fail-closed: same unreachable copy as the board.

Do not fan out `GET /reservations/:id` per row.

---

## 6. Available rooms — `[117] get_front_desk_available_rooms`

Which **physical** rooms are free for a stay range. Type-level `GET /availability` is the wrong grain (§7.1 / booking wizard).

### 6.1 Query

Required: `fromDate`, `toDate` (arrival / departure, half-open occupancy: room is busy if an occupying stay has `arrival_date < toDate AND departure_date > fromDate`). Same 90-night cap and date validation as tape. Optional: `roomTypeId`.

A room is **free** iff:

1. No occupying reservation (`pending|confirmed|checked_in`) overlapping that half-open range (same SQL as `assertRoomAssignableSync`, excluding nothing — there is no “self” reservation on this read).
2. No `room_ooo` overlapping (`start_date < toDate AND end_date > fromDate`).

Cleanliness does **not** occupy. `dirty` rooms are still listed (assign already allows dirty; check-in has its own gates). `room.status === 'out_of_order'` without a covering range is still excluded if that status is present — belt and braces with (2).

Body:

```ts
{
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: Array<{
    roomId: string;
    roomTypeId: string;
    code: string;
    status: string;      // HK, informational
    floor: string | null;
  }>;
}
```

Order by `code`. Empty → `{ rooms: [] }` 200.

### 6.2 SPA

On `/board`, a view toggle `?view=tape|available` (default `tape`). Available view: the same date window, list of free rooms grouped by type. Empty: “No rooms free for these dates.” CTA “Book” is a `<Link to={/book}>` — wizard still picks type-level availability; do **not** add `roomId` to create this chunk (assign remains the existing post-create path).

A standalone `/available` nav item is **not** required. Deep-link `/board?view=available&from=&to=` is enough.

---

## 7. Summary widgets — `[118] get_front_desk_summary`

Existing list pages cannot widget-ize: they are capped at 50 rows and arrivals ≠ “how many arrivals today”. §7.8 says today’s occupancy is OLTP. `GET /availability` is type-level and `READ_STALE`; the desk widget must match the tape’s physical-room grain and fail closed with PropertyDO.

### 7.1 Query

Required: `date=YYYY-MM-DD` (property-local calendar day the SPA already knows). Invalid → **400**.

Body (all integers, `tabular-nums`):

```ts
{
  ok: true;
  date: string;
  asOf: number;
  arrivals: number;         // arrival_date = date AND status IN ('confirmed','pending') — same predicate as the arrivals board
  departuresDue: number;    // departure_date = date AND status = 'checked_in'
  departed: number;         // departure_date = date AND status = 'checked_out'
  inHouse: number;          // status = 'checked_in'
  overstay: number;         // status = 'checked_in' AND departure_date < date
  occupancy: {
    occupiedRooms: number;  // COUNT DISTINCT room_id of occupying stays overlapping date (room_id NOT NULL)
    sellableRooms: number;  // COUNT(room) minus rooms with an OOO range covering date
  };
}
```

`occupancy` uses the tape’s occupying predicate for that single night (`arrival_date <= date AND departure_date > date`). Unassigned occupying stays do **not** increment `occupiedRooms` (no physical room). They still increment `arrivals` / `inHouse` as applicable.

Do **not** use `availability_day.sold / physical` here (type ledger ≠ assigned rooms; oversell would lie to the desk).

### 7.2 SPA

Tape header (`data-testid="board-summary"`): Arrivals, Due out, In-house, Overstay (only if > 0, `status-exception`), Occupancy `{occupiedRooms} / {sellableRooms}`. Same widgets on Arrivals / In-house / Departures headers so those screens are not list-only. Click a widget → `<Link>` to the matching list with `?date=`.

No separate `/dashboard` nav item. `/board` **is** the dashboard + tape. §16.1 “dashboard” is this header, not a warehouse trend page.

---

## 8. Hibernating WebSocket — `[119] get_front_desk_stream`

### 8.1 Why this, not KV, not poll

§7.7: the tape is the highest-frequency front-desk read; polling fights `INTERACTIVE` check-ins; a short-TTL projection is the wrong instrument. Hibernation keeps workstation connections while the object sleeps; overnight idle costs nothing.

Cloudflare rules this chunk must follow:

- `this.ctx.acceptWebSocket(server)` — **never** `server.accept()`.
- Handlers `webSocketMessage` / `webSocketClose` / `webSocketError` on `PropertyDO`. **No** `addEventListener` on the socket.
- `ws.serializeAttachment` / `deserializeAttachment` for per-connection state (in-memory is lost on hibernation).
- Tags: `this.ctx.acceptWebSocket(server, ['front-office'])`.
- `compatibility_date` is `2025-07-01` (`wrangler.jsonc`) — **before** `web_socket_auto_reply_to_close` (2026-04-07). `webSocketClose` **must** call `ws.close(code, reason)` to avoid 1006.
- `setWebSocketAutoResponse` ping/pong so liveness does not wake the isolate. **No** `setInterval` heartbeat in the DO (that prevents hibernation and bills duration).

### 8.2 Handshake (Worker then DO)

Browser `WebSocket` cannot set `x-dev-actor`. Auth:

| Environment | How |
|---|---|
| Clerk (prod / same-origin SPA) | Session cookie on the upgrade request. Existing `authenticateRequest`. |
| Dev actor (tests + `HOSPAI_UNSAFE_LOCAL`) | Header `x-dev-actor` (Worker `fetch` / tests) **or** `Sec-WebSocket-Protocol` value `hospai.dev-actor.<userId>` when `isDevActorAllowed`. Protocol is the only browser-settable channel. **Never** a `?actor=` query (logs). Strip any client-supplied `x-hospai-ws-actor`. |
| After auth | Worker sets internal `x-hospai-ws-actor` (userId) on the **forwarded** request only, then `resolved.stub.fetch(request)`. |

Dispatcher: `get_front_desk_stream` handler runs `resolveActor` → permission `reservations:read` → entitlement / kill-switch → `resolvePropertyFromRegistry` → `stub.fetch(upgradeRequest)`. Do not JSON-wrap the 101.

`PropertyDO.fetch`:

- If `Upgrade !== websocket` → 400 `expected_websocket` (the Worker should have filtered this; belt and braces).
- `new WebSocketPair()`, `acceptWebSocket(server, ['front-office'])`.
- `serializeAttachment({ propertyId, userId, fromDate, toDate })` from query (same date validation as tape; missing dates default to **not** sending a snapshot until the client `subscribe`s).
- Return 101 with the client socket.

Do **not** implement a general HTTP router on `PropertyDO.fetch`. Anything other than this upgrade is **404**. Existing RPC methods stay the API for JSON routes.

### 8.3 Protocol (JSON text frames)

Client → server:

```ts
{ type: 'subscribe'; fromDate: string; toDate: string }
{ type: 'ping' }           // optional; auto-response also covers liveness
```

Invalid JSON / unknown `type` → ignore (do not close). `subscribe` with a bad range → `{ type: 'error', error: 'date_range_exceeds_max' }` and keep the socket open.

Server → client:

```ts
{ type: 'snapshot'; asOf: number; fromDate: string; toDate: string; rooms: ...; blocks: ...; ooo: ... }
{ type: 'delta'; asOf: number; rooms?: ...; blocks?: ...; ooo?: ...; removedBlockIds?: string[]; removedOooIds?: string[] }
{ type: 'pong'; asOf: number }
{ type: 'error'; error: string }
```

No guest names on any frame. No folio. No entitlements.

On `subscribe` and on accept-if-query-dates-present: send a **snapshot** of that window (same RPC body as `readFrontOfficeTape`). Update `serializeAttachment` with the new window.

`ping` → `pong`. Prefer `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))` so hibernated objects answer without waking. If auto-response is used, client `ping` text must match exactly `ping`.

### 8.4 Broadcast after existing mutations

Add `broadcastFrontOffice(delta)` on `PropertyDO`, **sync**, no `await`. Iterates `this.ctx.getWebSockets('front-office')`, `deserializeAttachment()`, sends `delta` only if the payload overlaps the attached window (stay/OOO dates intersect, or a room-status change — those apply to every window).

Hook **after** the existing successful SQLite write + outbox insert, before the RPC returns, for event types:

- `reservation.created` / `reservation.modified` / `reservation.status_changed` / `reservation.room_assigned` / `reservation.front_office_updated`
- `room.created` / `room.updated` / `room.status_changed` / `room.ooo_changed`

Do not broadcast `folio.*`, `payment.*`, `rate.*`, `config.changed`, `shift.changed`. Night-audit no-show / check-out already emit `reservation.status_changed` — covered.

A single helper called from the existing outbox-append path filtered by those types is preferred to N call sites. If the outbox helper is the only seam, **filter there**; do not wake sockets for every folio line.

Delta payload is a partial tape: the changed room row, the changed block (`mapFrontDeskListRow`), or the changed OOO row. Cancel / check-out / unassign → `removedBlockIds: [reservationId]` when the stay no longer occupies. OOO release → `removedOooIds`.

If `getWebSockets('front-office')` is empty, the helper is a no-op (hibernating with zero connections, or never subscribed).

### 8.5 Reconnect

Client: on `close` / `error`, reconnect with exponential backoff (cap ~10s), same subscribe window. On open, send `subscribe` → server snapshot (full window, not CDC). SPA replaces local tape state. Lists: `queryClient.invalidateQueries` for `['board']`, `['front-desk-summary']`, `['front-desk-directory']`, `['front-desk-available']`, `['front-desk-tape']`.

Do not full-reload the SPA.

### 8.6 Stale watermark (normative operator `READ_STALE`)

Hibernated-but-connected is **live**, not stale. Overnight idle must **not** show a watermark — that is the point of §7.7.

The socket is **stale** when any of:

1. `readyState !== OPEN` (connecting after first successful snapshot counts as stale until the next snapshot).
2. Upgrade / subscribe failed (`FAIL_CLOSED` 503, 402, 403, 401) after a snapshot was already shown.
3. Auto-pong / ping fails (browser `error`, or no pong within 30s **only when the client is sending ping because auto-response is unavailable in a test double**). Production relies on `readyState` + reconnect, not a “quiet board” timer.

When stale: keep rendering the last snapshot. Shell watermark (`data-testid="stale-watermark"`, `role="status"`, `aria-live="polite"`):

> Live updates paused — showing data from {time}.

`{time}` via `Intl.DateTimeFormat` (property TZ) from `asOf`. Contrast uses existing tokens (`status-attention`). Do not invent a new status pair without the colors check.

When the next snapshot/delta arrives: hide the watermark.

Initial load with no snapshot and handshake/GET `FAIL_CLOSED`: **do not** show an empty tape; show the unreachable alert (same as BoardScreen). Watermark requires a last-good snapshot.

This is the SPA-shell leftover “Stale-data watermark” and the first **real** operator `READ_STALE` surface. It is **not** a KV projection and **not** a reclass of `get_front_desk_arrivals`.

### 8.7 Client ownership

`packages/client-core` grows a **DOM-free** helper for URL + protocol types (`FrontOfficeStreamMessage`, subscribe serializer). The actual `WebSocket` lives in `apps/web-pms` (`shell/FrontOfficeLive.tsx` or similar) because `client-core` forbids React/DOM. Tests: protocol parser in client-core; reconnect/watermark in web-pms; handshake + broadcast in pms-core.

One connection per browser tab, owned by `AppShell` when `reservations:read` and `authority.kind === 'live'`. Screens do not each open a socket.

Subscribe window: union of the tape URL window (if on `/board`) and the list `date` (if on arrivals/departures) and today (summary). Minimum: property-local today through today+6. Send `subscribe` when that union changes.

### 8.8 Constructor constraint (pin)

On hibernation wake, constructor re-runs `migrateSql`. That stays the cheap version check. **Forbidden in constructor:** `getWebSockets` scans that assemble snapshots, OrgDO, KV, `fetch`, extra `SELECT` beyond migrate + existing jurisdiction read. Broadcast happens from mutation RPCs and from `webSocketMessage` (`subscribe` → snapshot).

---

## 9. Existing list boards (live, not rewritten)

`/arrivals`, `/in-house`, `/departures` stay `BoardScreen`. On front-office `delta` / `snapshot`, invalidate their React Query keys. Confirm / check-in / folio links unchanged.

Summary widgets (§7.2) mount in `BoardScreen` header.

Do not change list `degradedRead`. Do not raise the 50-row page size.

---

## 10. SPA watermark + web-interface guidelines (new chrome)

Apply to new screens and the watermark:

- Icon-only controls (`aria-label`); decorative icons `aria-hidden`.
- Date inputs: `type="date"`, associated `<label>`, `autocomplete="off"`.
- Directory search: `role="search"`, placeholder ends with `…` (“Reservation id or guest name…”).
- Focus-visible rings; no `outline-none` without replacement.
- `tabular-nums` on counts, dates, occupancy.
- Headings `text-wrap: balance` / hierarchy: Board `h1`, groups `h2`.
- Skip-link not required beyond existing shell.
- Empty states; long names `truncate` + `min-w-0`.
- `touch-action: manipulation` on the grid scroller.
- No `user-scalable=no`.
- Links are `<Link>` / `<a>`, not `div` onClick.
- Loading strings end with `…`.
- Curly apostrophes in copy (“don’t”, “can’t”) matching AppShell.

---

## 11. File map (acceptance list, not a split mandate)

| Area | Likely paths |
|---|---|
| Route audit | `packages/contracts/src/v1-http-routes.ts` (append 115–119); `register.test.ts` pins |
| Dispatcher | `apps/pms-core/src/v1-dispatch.ts` — five handlers; stream returns 101 |
| PropertyDO | `property-do.ts` — `readFrontOfficeTape`, `listFrontOfficeDirectory`, `listAvailableRooms`, `readFrontOfficeSummary`, `fetch` + `webSocketMessage` / `webSocketClose` / `webSocketError`, `broadcastFrontOffice` |
| Tests | `apps/pms-core/test/front-desk-tape-routes.spec.ts` (new); WS handshake + overlap broadcast; existing list tests stay green |
| client-core | `api.ts` methods; protocol types; **no** `WebSocket` |
| Shell | `nav.ts`; `App.tsx` (`/board`, `/reservations`, index → `/board`); `FrontOfficeLive` + watermark |
| Screens | `TapeChartScreen.tsx` (or `BoardChartScreen.tsx`); directory screen; widgets used by `BoardScreen` |
| Pointers | One-sentence amends in operational-reads / SPA-shell / room-ops / property-setup / prototype-holes specs **when this chunk lands** |

No `ARCHITECTURE.md` rewrite required beyond an optional §16.3 note when the chunk ships. Do not silently skip leftover pointers.

---

## 12. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Hibernating WebSocket front-office deltas | Operational-reads leftover; room-ops leftover 8; property-setup leftover 4; SPA-shell WS leftover (**front-office only**) |
| 2 | Stale-data watermark | SPA-shell leftover; §9 shell; first operator `READ_STALE` surface |
| 3 | Tape chart grid | §7.7 / §16.1 / §16.5; property-setup leftover 4 |
| 4 | Reservations directory windows | §16.1; operational-reads explicitly deferred “date-range / tape / occupancy” |
| 5 | Available-rooms physical list | §16.1 |
| 6 | Dashboard / arrivals-departures count widgets | §16.1 dashboard; current `BoardScreen` has none |
| 7 | Live refresh of existing list boards | User requirement; invalidate on WS, not a rewrite |
| 8 | DND / VIP on tape blocks | Reuse stay flags already on `mapFrontDeskListRow` (not HK leftover 3) |

---

## 13. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | Virtual room types | §7.1 |
| 2 | Derived / OrgDO rate plans | §7.2 |
| 3 | `rooms.delete` / unit archive | Rooms-vertical leftover |
| 4 | `ui-kit` / visual identity | §16.4 |
| 5 | City ledger / AR | §7.3 |
| 6 | Invoice generation | §16.1 / §4.7 R2 |
| 7 | Night-audit auto-transfer | Pinned 7 steps |
| 8 | Recurring charges / `breakfast_rule` engine | Prototype-holes leftover 1 |
| 9 | Partial refunds | Folio-money leftover |
| 10 | Full exception-queue workbench | **Closed 2026-08-13** by [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md). |
| 11 | PCI / real PSP | Simulate stays |
| 12 | `entitlement.changed` WebSocket | Org-scoped; refetch-on-402 stays |
| 13 | Reclass `get_front_desk_*` / `get_guest` / search to `READ_STALE` | Prototype-holes leftover 4 remainder — still no projection / names are OrgDO |
| 14 | DND on housekeeping board | Prototype-holes leftover 3 |
| 15 | Blind-index guest search | Prototype-holes leftover 2 |
| 16 | Reservation KV projection | Operational-reads Q2 still stands |
| 17 | Materialized tape table | Rejected; assemble per bounded read |
| 18 | Drag-assign / empty-cell book POST | Read-heavy; links only |
| 19 | `roomId` on `reservations.create` | Assign stays the existing command |
| 20 | Property setup / rates / settings rebuild | Shipped |
| 21 | Guest CRM directory | Beyond batch hydrate |
| 22 | Group blocks / `held` | Phase 2 / 3 |
| 23 | Changing `GET /rooms` permission | Tape does not use that route |
| 24 | Constructor rewrite of `migrateSql` | Already cheap; do not “optimize” |

---

## 14. Tests (acceptance-shaped)

**Contracts / register**

1. `V1_HTTP_ROUTE_AUDIT[114].id === 'get_domain_config'`; `[115]='get_front_desk_tape'`; `[116]='get_front_desk_directory'`; `[117]='get_front_desk_available_rooms'`; `[118]='get_front_desk_summary'`; `[119]='get_front_desk_stream'`. Each: `scope:'property'`, no `commandId`, `entitlement:'pms.core'`, `degradedRead:'FAIL_CLOSED'`, `permission:'reservations:read'`.
2. `COMMAND_CATALOG` length **74**. `AUDIT_WRITER_COMMAND_IDS.size === 49`. `PLATFORM_GAPS` `[]`.
3. `PROPERTY_SCHEMA_HEAD === 24`. Purge table list unchanged. `NIGHT_AUDIT_STEPS.length === 7`.

**pms-core — tape / available / summary / directory**

4. Occupying stay assigned to room 101, dates `[A, A+2)`, OOO on 102 covering A: `GET /tape?fromDate=A&toDate=A+1` returns block on 101 spanning A..A+1 (exclusive end visible as one or two cells), OOO on 102, 101 HK status present. Unassigned pending stay appears in `blocks` with `roomId: null`.
5. `checked_out` / `cancelled` / `inquiry` (no room) do **not** occupy. Inquiry appears in directory `window=today` if `arrival_date = date`.
6. Available-rooms for `[A, A+2)` omits 101 and OOO 102; includes a third idle room. Dirty idle room is included.
7. Summary on date A: `arrivals` matches arrivals-board predicate count (not capped at 50 — seed 51 arrivals, widget is 51, list still pages). `overstay` counts checked_in with `departure_date < A`. `occupiedRooms` ignores unassigned.
8. Directory `window=week` includes arrival in `[date, date+6]`, excludes date+7. `window=all` paginates; cursor page 2 has no overlap with page 1. `status=checked_in` filters.
9. 91-night tape / available range → `400 date_range_exceeds_max`. Staff actor 200; actor without `reservations:read` 403. DO down → 503 `FAIL_CLOSED`. Kill-switch entitled pair.
10. Names absent on tape/directory JSON (`displayName` not in items).

**pms-core — WebSocket**

11. `GET /stream` without Upgrade → 400 `expected_websocket`. With Upgrade + `reservations:read` → 101. Without permission → 403, no accept.
12. After accept, client `subscribe` → `snapshot` matching tape GET for that window. Second subscribe narrows attachment (old window no longer receives non-overlapping deltas).
13. Create reservation occupying the window → connected client receives `delta` with the new block **without** a client GET. Folio `add_item` does **not** emit a front-office delta.
14. Hibernation constructor: a test that evicts with `{ webSockets: 'hibernate' }` (Cloudflare vitest option) still delivers a post-eviction `subscribe` snapshot. Constructor must not throw.
15. `webSocketClose` calls `ws.close` (compat date 2025-07-01).
16. Dev-actor via `Sec-WebSocket-Protocol` `hospai.dev-actor.user_*` when unsafe local is on; protocol rejected when flags off.

**web-pms**

17. Nav: Board order 8, Reservations 35; index lands on `/board`; staff with `reservations:read` sees both; `ui-kit` / Tailwind not introduced.
18. Tape: timezone seed; `?from=&to=` override; block click navigates to folio; empty rooms empty-state; fail-closed ≠ empty grid.
19. Directory tabs write `?window=`; search field still hits `searchReservations`.
20. Available view lists the free room from test 6.
21. Summary widgets show 51 arrivals from test 7; overstay chip when count > 0.
22. Watermark: after a snapshot, mock socket `close` → `data-testid="stale-watermark"` visible with formatted `asOf`; on mock snapshot, watermark gone. Hibernated-but-open socket (no messages) does **not** show watermark.
23. Arrivals `BoardScreen` refetches after a mocked delta (query invalidation).
24. `prefers-reduced-motion` / no `transition: all` in new CSS. `check:web-pms-colors` green.

---

## 15. Acceptance / reviewer checklist

- [ ] Five routes appended at **115–119** only; `[114]` unmoved; no catalog ids added; no schema bump; no new table; no new `export class`.
- [ ] Tape snapshot GET + `/board` grid: occupying blocks, OOO, HK status, unassigned lane. Read-only. 90-night cap.
- [ ] Directory GET + `/reservations` with today / tomorrow / week / all. Reuses `mapFrontDeskListRow` and `searchReservations` for `q`. Does not overload arrivals.
- [ ] Available-rooms GET + `/board?view=available`. Same overlap predicate as `assertRoomAssignableSync`. Dirty ≠ occupied.
- [ ] Summary GET + widgets on tape and list boards. Counts not capped at 50. Occupancy is physical rooms, not `availability_day`.
- [ ] Hibernating WS: `acceptWebSocket`, attachment window, snapshot then deltas, broadcast from reservation/room/OOO events only, no polling, no `setInterval`, constructor stays cheap migrate.
- [ ] Auth: Clerk cookie; dev actor header **or** `Sec-WebSocket-Protocol`; no actor query param.
- [ ] Stale watermark when socket is stale; hibernated-open is live; initial FAIL_CLOSED is unreachable, not an empty chart. Existing list routes remain `FAIL_CLOSED` on the audit table.
- [ ] Guest names only via batch compose. No names on the socket. No PII in attachments.
- [ ] Existing Arrivals / In-house / Departures kept and live via invalidation. Index → `/board`.
- [ ] `COMMAND_CATALOG` 74; audit writers 49; schema head 24; `PLATFORM_GAPS` []; `NIGHT_AUDIT_STEPS` 7.
- [ ] Scope-out §1.3 / §13 named: virtual types, derived/OrgDO plans, `rooms.delete`, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring, partial refunds, exception workbench, PCI, entitlement WS, list-route reclass, HK DND, blind index, tape materialization, drag-assign.
- [ ] Leftovers §12 (folded) and §13 (deferred) both present. Web-interface guidelines §10 applied.
- [ ] Tests §14 green in the later implementation plan — this spec does not implement them.

---

## 16. Open questions (locked)

1. **HTTP `degradedRead` for tape vs watermark.** **Locked: JSON GETs and the WS handshake are `FAIL_CLOSED`.** The operator watermark is the `READ_STALE` surface. Labeling the GET `READ_STALE` without a KV projection repeats the `get_folio` honesty bug.
2. **Reconnect CDC vs snapshot.** **Locked: resubscribe sends a full window snapshot.** No versioned delta log, no new table.
3. **Directory grain.** **Locked: filter by `arrival_date` window, not occupancy overlap.** Occupancy is the tape. Mixing them makes “today” mean three different boards.
4. **Available-rooms vs tape-only client filter.** **Locked: dedicated GET.** Assign-adjacent reads must not require the full chart; the SQL already exists in `assertRoomAssignableSync`.
5. **Dashboard as its own route.** **Locked: no `/dashboard`.** `/board` header widgets are the §16.1 dashboard.
6. **Dev-actor on WebSocket.** **Locked: `Sec-WebSocket-Protocol` `hospai.dev-actor.<userId>` plus existing header for tests.** No query-string actor.
7. **List boards.** **Locked: keep `BoardScreen` routes; live via WS invalidation.** Replacing them with the tape would drop the check-in / due-out / overstay workflows.
8. **`GET /rooms` permission.** **Locked: unchanged `housekeeping:read`.** Tape/available/summary read rooms inside PropertyDO under `reservations:read`.
9. **Materialized tape view.** **Locked: do not add a table this chunk.** Bounded assemble-per-read. Revisit only if a measured range scan fails a fixture with realistic room counts — that would be a later spec, not a silent ALTER.

---

## 17. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Append audit + `V1_ROUTES` **115–119** in identical order.
- [ ] PropertyDO read RPCs + `fetch`/hibernation handlers + `broadcastFrontOffice`.
- [ ] Dispatcher JSON GETs + 101 stream path; auth protocol for WS.
- [ ] client-core API methods + message types.
- [ ] SPA: nav, `/board`, `/reservations`, widgets, `FrontOfficeLive`, watermark.
- [ ] Tests in §14. Pointer sentences in the amended specs when the chunk lands.
- [ ] No `ARCHITECTURE.md` drive-by except an optional §16.3 sentence in the same PR as the implementation.
