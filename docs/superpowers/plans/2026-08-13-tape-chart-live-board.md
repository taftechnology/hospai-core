# Tape Chart + Live Front-Office Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Give the front desk a live rooms × dates tape chart, a reservations directory, an available-rooms view, and arrivals/occupancy widgets — plus hibernating WebSocket deltas and a stale watermark — without new tables, commands, or writers.

**Architecture:** Five FAIL_CLOSED reads append at the end of `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES` (115–119). PropertyDO grows four list RPCs plus a hibernating `fetch` / `webSocketMessage` path. SPA is core `nav.ts` (not a module). Guest names stay on the OrgDO batch compose. HTTP GETs are `FAIL_CLOSED`; the operator `READ_STALE` surface is the SPA watermark over the last in-memory snapshot when the socket is stale. Schema stays at head 24. Reconnect is a full window snapshot, not a CDC log.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO Hibernation WebSocket API), `@hospai/contracts`, `@hospai/client-core`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md` (Approved). Spec commit: `1d76e6802fc117b5333e10387177a5df6876afa5`.

## Global Constraints

- Route audit **append-only**. `[114] = get_domain_config` does not move. New routes are **`[115] get_front_desk_tape`**, **`[116] get_front_desk_directory`**, **`[117] get_front_desk_available_rooms`**, **`[118] get_front_desk_summary`**, **`[119] get_front_desk_stream`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in **identical order**. Do not splice under `/reservations/:id` or `/rooms/:id`.
- Task 1 adds **115–118** only (`check:permissions` zips audit ↔ `V1_ROUTES`). Task 2 appends **119**. Never insert before 114.
- `COMMAND_CATALOG.length` stays **74**. Reads omit `commandId`. `AUDIT_WRITER_COMMAND_IDS.size` stays **49**. `PLATFORM_GAPS` stays `[]`.
- **Schema freeze.** No new table, ALTER, index, or `PROPERTY_SCHEMA_HEAD` bump (stays **24**). `pnpm generate:ddl` may run as hygiene only; it **must produce a no-op diff and change no migration files**.
- `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- `runIdempotent` stays sync-only. New RPCs are reads (`assertRpcAvailable`). `broadcastFrontOffice` is sync (`ws.send`); do not `await` OrgDO / KV / `fetch` inside it.
- Occupying predicate is `status IN ('pending','confirmed','checked_in')` and half-open `[arrival, departure)` — same as `assertRoomAssignableSync`. Inquiry without a room is directory-only. `cancelled` / `no_show` / `checked_out` do not occupy.
- Guest names never appear on tape / directory / socket JSON. SPA composes via existing `POST …/guests/batch`.
- Hibernating WS: `ctx.acceptWebSocket(server, ['front-office'])` — **never** `server.accept()`. No `setInterval`. No outbound WS. No polling as the live path. Constructor stays the existing cheap `migrateSql`.
- New HTTP reads and the WS handshake are **`FAIL_CLOSED`**. Do **not** reclass `get_front_desk_*` / `get_guest` / `get_reservation_search`. Do **not** label tape GET `READ_STALE`.
- `GET /rooms` permission stays `housekeeping:read`. Tape/available/summary read `room` / `room_ooo` inside PropertyDO under `reservations:read`.
- 90 inclusive-night cap: reuse `inclusiveDateRangeError` (`toDate > fromDate + 89` → `400 { error: 'date_range_exceeds_max' }`).
- Nav: Board `/board` order **8** `reservations:read`; Reservations `/reservations` order **35** `reservations:read`. Index `/` → `/board`. Keep Arrivals / In-house / Departures. No `/dashboard`. Core `nav.ts`, not `module-ui-registry.ts`.
- Existing tokens / `statusClass` / `check:web-pms-colors`. No Tailwind, no `ui-kit`, no new `--status-*` pairs unless the colors check is updated in the same commit (prefer reuse).
- Fixture dates from property-local `business_date` when load-bearing. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- **Rebuild:** after any `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests. After client-core source change, `pnpm --filter @hospai/client-core build` before web-pms tests.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 9). Do not backfill historical plans.
- No either/or forks. Spec §16 locks stand.
- Scope-out (do not implement): virtual types, derived/OrgDO plans, `rooms.delete`, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring charges, partial refunds, exception workbench, PCI, `entitlement.changed` WS, list-route `READ_STALE` reclass, HK DND join, blind-index search, tape materialization, drag-assign, `roomId` on create.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/v1-http-routes.ts` | Append `[115]`–`[118]` (Task 1); `[119]` (Task 2) |
| `packages/contracts/src/register.test.ts` | Route pins |
| `apps/pms-core/src/property-do.ts` | Four read RPCs (Task 1); `fetch` / WS handlers / `broadcastFrontOffice` (Task 2) |
| `apps/pms-core/src/v1-dispatch.ts` | JSON GET handlers + `V1_ROUTES`; stream 101 (Task 2) |
| `apps/pms-core/src/auth.ts` | Dev-actor `Sec-WebSocket-Protocol` (Task 2) |
| `apps/pms-core/test/front-desk-tape-routes.spec.ts` | New: GET 115–118 (Task 1) |
| `apps/pms-core/test/front-desk-stream.spec.ts` | New: WS 119 (Task 2) |
| `packages/client-core/src/api.ts` | Tape / directory / available / summary methods (Task 3) |
| `packages/client-core/src/front-office-stream.ts` | Protocol types + parsers; **no** `WebSocket` (Task 3) |
| `packages/client-core/src/index.ts` | Re-export |
| `packages/client-core/test/api-front-office-board.test.ts` | Client GET tests (Task 3) |
| `packages/client-core/test/front-office-stream.test.ts` | Protocol parser (Task 3) |
| `apps/web-pms/src/shell/nav.ts` | Board + Reservations entries (Task 4) |
| `apps/web-pms/src/App.tsx` | `/board`, `/reservations`, index → `/board` (Task 4) |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` (+ test) | Grid + available view (Tasks 4–5) |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` (+ test) | Directory (Task 5) |
| `apps/web-pms/src/screens/board-summary.tsx` (+ test) | Widgets reused by tape + `BoardScreen` (Task 5) |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Mount widgets; keep list modes (Task 5) |
| `apps/web-pms/src/shell/FrontOfficeLive.tsx` (+ test) | One WS per tab; invalidate queries (Task 6) |
| `apps/web-pms/src/shell/StaleWatermark.tsx` (+ test) | Operator `READ_STALE` chrome (Task 6) |
| `apps/web-pms/src/shell/AppShell.tsx` | Mount live + watermark (Task 6) |
| `apps/web-pms/src/auth/me.test.ts` | Nav ids include `board` / `reservations` (Task 4) |
| Sibling specs | One-sentence pointers (Task 7) |

## Test file split (spec §14 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 route pins, catalog 74 | `packages/contracts/src/register.test.ts` | 1 (115–118), 2 (119) |
| 3 schema / purge / steps | Task 8 CI | 8 |
| 4–10 tape / directory / available / summary / names / 403 / 503 | `front-desk-tape-routes.spec.ts` | 1 |
| 11–16 WebSocket | `front-desk-stream.spec.ts` | 2 |
| client GETs | `api-front-office-board.test.ts` | 3 |
| protocol parser | `front-office-stream.test.ts` | 3 |
| 17 nav | `me.test.ts` + TapeChart tests | 4 |
| 18 tape SPA | `TapeChartScreen.test.tsx` | 4 |
| 19 directory SPA | `ReservationsDirectoryScreen.test.tsx` | 5 |
| 20 available view | `TapeChartScreen.test.tsx` | 5 |
| 21 summary widgets | `board-summary.test.tsx` + `BoardScreen.test.tsx` | 5 |
| 22–23 watermark + list invalidation | `FrontOfficeLive.test.tsx` / `StaleWatermark.test.tsx` / `BoardScreen.test.tsx` | 6 |
| 24 colors / motion | Task 8 `check:web-pms-colors` | 8 |
| Bidirectional pointers | sibling specs | 7 |

---

### Task 1: JSON reads 115–118 (own commit, no WebSocket)

**Spec:** §3 (115–118), §4.1–4.2, §5.1, §6.1, §7.1, §14 tests **1–2** (through 118), **4–10**. Keep stream out so `[119]` does not exist yet.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append four audit rows after `get_domain_config`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/property-do.ts` — four read RPCs
- Modify: `apps/pms-core/src/v1-dispatch.ts` — four GET handlers; append four `V1_ROUTES` at **END** (after `handleGetDomainConfig`)
- Create: `apps/pms-core/test/front-desk-tape-routes.spec.ts`

**Interfaces:**

```ts
async readFrontOfficeTape(
  fromDate: string,
  toDate: string,
  roomTypeId?: string,
): Promise<{
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: Array<{
    roomId: string; roomTypeId: string; code: string; status: string; floor: string | null;
  }>;
  blocks: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
  ooo: Array<{ oooId: string; roomId: string; startDate: string; endDate: string; reason: string | null }>;
}>

async listFrontOfficeDirectory(q: {
  window: 'today' | 'tomorrow' | 'week' | 'all';
  date?: string;
  statuses?: string[];
  limit?: number;
  cursor?: { arrivalDate: string; reservationId: string } | null;
}): Promise<{
  ok: true;
  items: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
  nextCursor: { arrivalDate: string; reservationId: string } | null;
}>

async listAvailableRooms(q: {
  fromDate: string; toDate: string; roomTypeId?: string;
}): Promise<{
  ok: true; fromDate: string; toDate: string; asOf: number;
  rooms: Array<{
    roomId: string; roomTypeId: string; code: string; status: string; floor: string | null;
  }>;
}>

async readFrontOfficeSummary(date: string): Promise<{
  ok: true;
  date: string;
  asOf: number;
  arrivals: number;
  departuresDue: number;
  departed: number;
  inHouse: number;
  overstay: number;
  occupancy: { occupiedRooms: number; sellableRooms: number };
}>
```

- Produces: HTTP 115–118; DO RPCs above
- Consumes: existing `mapFrontDeskListRow`, `listRooms` SQL shape, `assertRoomAssignableSync` overlap, `encodeFrontDeskCursor` / `decodeFrontDeskCursor`, `inclusiveDateRangeError`
- **Forbidden this commit:** `PropertyDO.fetch`, `webSocketMessage`, `acceptWebSocket`, `broadcastFrontOffice`, `V1_HTTP_ROUTE_AUDIT[119]`, SPA, client-core, catalog ids, migrations, `CLASS_DENYLIST`.

- [x] **Step 1: Write the failing register pins**

In the existing route-audit `it` that already pins `[114]`, append:

```ts
expect(V1_HTTP_ROUTE_AUDIT[114]?.id).toBe('get_domain_config');
expect(V1_HTTP_ROUTE_AUDIT[115]?.id).toBe('get_front_desk_tape');
expect(V1_HTTP_ROUTE_AUDIT[115]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[115] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[116]?.id).toBe('get_front_desk_directory');
expect(V1_HTTP_ROUTE_AUDIT[116]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[116] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[117]?.id).toBe('get_front_desk_available_rooms');
expect(V1_HTTP_ROUTE_AUDIT[117]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[117] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[118]?.id).toBe('get_front_desk_summary');
expect(V1_HTTP_ROUTE_AUDIT[118]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[118] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[119]).toBeUndefined();
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(49);
expect(COMMAND_CATALOG).toHaveLength(74);
expect(PLATFORM_GAPS).toEqual([]);
```

Do **not** pin `[119]` this commit.

- [x] **Step 2: Write failing HTTP tests** (`apps/pms-core/test/front-desk-tape-routes.spec.ts`)

Copy provision helpers from `front-desk-reads.spec.ts` / `rooms-ooo-routes.spec.ts` / `reservations-search-routes.spec.ts` (`postOrg`, `postProperty`, `crypto.randomUUID()` ids, `ensurePlatformSchema` / `setKillSwitch` in `beforeEach`/`afterEach`, `org.ensureMember(staff, 'staff')`, `insertReservationForTest`, `seedBarRatesForHorizon` if create-via-HTTP needs rates).

Create two physical rooms (`101`, `102`) plus a third idle room (`103`). Stay dates from the property’s open `business_date` (call it `A`). Occupying stay on 101: `confirmed`, assigned, `[A, A+2)`. OOO on 102 covering `A`. Unassigned `pending` overlapping the window. One `inquiry` arriving `A` (no room). One `checked_out` on 101 in the past (must not occupy). One `checked_in` overstay (`departure_date < A`). Dirty idle 103.

Required cases (spec §14.4–14.10):

1. `GET /front-desk/tape?fromDate=A&toDate=A+1` → 200. Block on 101 with `arrivalDate=A`, `departureDate=A+2`. OOO row for 102. 101 `status` present. Unassigned pending in `blocks` with `roomId: null`. No `displayName` on any item. Empty property (no rooms, no stays) → `{ rooms: [], blocks: [], ooo: [] }` not 404.
2. `checked_out` / `cancelled` / unassigned `inquiry` **absent** from tape `blocks`. Inquiry **present** on `GET /front-desk/directory?window=today&date=A`.
3. `GET /front-desk/available-rooms?fromDate=A&toDate=A+2` omits 101 and 102; includes 103 even if `status=dirty`.
4. `GET /front-desk/summary?date=A`: seed **51** confirmed arrivals on `A` (loop `insertReservationForTest` with unique ids). `arrivals === 51`. `overstay >= 1`. `occupiedRooms` counts assigned occupying rooms only (unassigned pending does not increment). `sellableRooms` = total rooms minus OOO covering `A`.
5. Directory `window=week&date=A` includes arrival `A+6`, excludes `A+7`. `window=all` paginates: `limit` omitted defaults 50; page 2 `cursor` has no overlapping `reservationId` with page 1. `status=checked_in` returns only that status. Missing `window` → 400 `{ error: 'invalid_window' }`. `window=today` without `date` → 400. Invalid cursor → 400 `{ error: 'invalid_cursor' }`.
6. `fromDate=A&toDate=` 91 nights (`toDate = A+90`) on tape **and** available-rooms → 400 `{ error: 'date_range_exceeds_max' }`. `fromDate > toDate` → 400.
7. Staff member GET tape → **200**. Actor without `reservations:read` (fabricate a member that lacks it if the role always has it — otherwise a stranger → existing 404/403 privacy mapping; add an OrgDO role fixture only if a current test already does). Kill-switch `pms.core` → 503 on each of the four paths (copy `folio-fx-routes.spec.ts` / `property-setup-reads.spec.ts`). `setTransportBlockedForTest` → 503 `FAIL_CLOSED` (copy front-desk-reads).

- [x] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-tape-routes.spec.ts
```

Expected: FAIL — missing audit rows / handlers / RPCs.

- [x] **Step 4: Implement DO RPCs**

All four: `this.assertRpcAvailable()`, sync SQL, no OrgDO.

`readFrontOfficeTape`:

- Rooms: same SELECT as `listRooms` (no OOO nested in the room row — OOO is the sibling array), optional `roomTypeId`, `ORDER BY code`.
- Blocks: `status IN ('pending','confirmed','checked_in') AND arrival_date <= ? AND departure_date > ?` with (`toDate`, `fromDate`). Map `mapFrontDeskListRow`. Include `room_id IS NULL`.
- OOO: `start_date < toExclusive AND end_date > fromDate` where `toExclusive` is the calendar day after `toDate` (reuse existing `enumerateFromDate` / `addDays` helper already in the DO).
- `asOf: Date.now()`.

`listFrontOfficeDirectory`:

- Validate `window`. For `today` / `tomorrow` / `week`, require `date` (`YYYY-MM-DD`) or return `{ ok: false, error: 'invalid_date' }` — dispatcher turns that into 400, **or** dispatcher validates first (prefer dispatcher, matching arrivals).
- SQL arrival predicates per spec §5.1. Optional `status IN (...)`.
- `ORDER BY arrival_date DESC, reservation_id DESC`. Clamp limit 50 via existing `clampFrontDeskLimit`.
- Cursor resume: `(arrival_date < :d) OR (arrival_date = :d AND reservation_id < :id)`.
- `nextCursor` null when page length `< limit`.

`listAvailableRooms`:

- Half-open occupancy vs `[fromDate, toDate)`: busy if occupying stay `arrival_date < toDate AND departure_date > fromDate` **or** OOO `start_date < toDate AND end_date > fromDate` **or** `room.status = 'out_of_order'`.
- Return remaining rooms `ORDER BY code`. Dirty is allowed.

`readFrontOfficeSummary`:

- Counts as spec §7.1. Occupying night: `arrival_date <= date AND departure_date > date`. `occupiedRooms` = `COUNT(DISTINCT room_id)` where `room_id IS NOT NULL`. `sellableRooms` = `COUNT(room)` minus rooms with OOO covering `date` (`start_date <= date AND end_date > date`).

Do **not** add a table or index. Do **not** call `listRooms` from HTTP (permission mismatch).

- [x] **Step 5: Implement HTTP handlers + audit + `V1_ROUTES`**

Audit rows (no `commandId`):

```ts
{
  id: 'get_front_desk_tape',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

Same shape for directory / available-rooms / summary.

Handlers: copy `handleGetFrontDeskArrivals` / `handleGetRateDays` transport `catch` → `degradedFailClosedReadResponse()`. Reuse `inclusiveDateRangeError` for tape + available. Directory: `window` required; `date` required unless `window=all`; `status` split on comma, each token in `RESERVATION_STATUSES` else 400; reuse `decodeFrontDeskCursor` / `encodeFrontDeskCursor` / `parseOptionalFrontDeskLimit`.

Append four `V1_ROUTES` at the **END**:

```
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/tape$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/directory$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/available-rooms$/
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/summary$/
```

- [x] **Step 6: Rebuild contracts, re-run tests, check:permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
pnpm check:degraded
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-tape-routes.spec.ts
```

Expected: all exit 0.

- [x] **Step 7: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/front-desk-tape-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add front-office tape, directory, and summary reads [115-118]

EOF
)"
```

---

### Task 2: Hibernating WebSocket `[119]` + broadcast

**Spec:** §3 (119), §8, §14 tests **11–16**.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append `[119]`
- Modify: `packages/contracts/src/register.test.ts` — `[119]` pin; drop `toBeUndefined()`
- Modify: `apps/pms-core/src/auth.ts` — `Sec-WebSocket-Protocol` `hospai.dev-actor.<userId>` when `isDevActorAllowed`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handleGetFrontOfficeStream`; append `V1_ROUTES`
- Modify: `apps/pms-core/src/property-do.ts` — `fetch`, `webSocketMessage`, `webSocketClose`, `webSocketError`, `broadcastFrontOffice`; hook `appendPropertyOutbox`
- Create: `apps/pms-core/test/front-desk-stream.spec.ts`

**Interfaces:**

```ts
// PropertyDO
async fetch(request: Request): Promise<Response>
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>
async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void>
async webSocketError(ws: WebSocket, error: unknown): Promise<void>
private broadcastFrontOffice(delta: FrontOfficeDelta): void
```

Attachment JSON: `{ propertyId: string; userId: string; fromDate: string | null; toDate: string | null }`.

- Produces: 101 upgrade; snapshot/delta/error frames; ping/pong
- Consumes: Task 1 `readFrontOfficeTape`
- **Forbidden this commit:** SPA, client-core `WebSocket`, catalog ids, migrations, `setInterval`, `server.accept()`, actor query param, `entitlement.changed`, constructor work beyond existing migrate, broadcasting `folio.*` / `payment.*` / `rate.*` / `config.changed` / `shift.changed`.

- [x] **Step 1: Write failing register pin + stream tests**

Replace `expect(V1_HTTP_ROUTE_AUDIT[119]).toBeUndefined()` with:

```ts
expect(V1_HTTP_ROUTE_AUDIT[119]?.id).toBe('get_front_desk_stream');
expect(V1_HTTP_ROUTE_AUDIT[119]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[119] ?? {})).toBe(false);
```

`front-desk-stream.spec.ts` (same provision as Task 1; reuse occupying 101 stay):

1. `GET /front-desk/stream` **without** `Upgrade: websocket` → 400 `{ error: 'expected_websocket' }`.
2. With `Upgrade: websocket` + owner `x-dev-actor` → **101**, `response.webSocket` defined. Client `accept()`, send `{ type: 'subscribe', fromDate: A, toDate: A+1 }`, receive `{ type: 'snapshot' }` whose `blocks` match the tape GET for that window (compare `reservationId`s). No `displayName`.
3. Missing `reservations:read` / stranger → 403 or 404 **before** 101 (no socket).
4. Second `subscribe` to a non-overlapping future window: a new occupying stay in the **old** window must **not** arrive on that socket; a stay in the **new** window must.
5. After subscribe, `POST /reservations` (or `insertReservationForTest` + a real HTTP create that emits `reservation.created`) occupying the window → client gets `{ type: 'delta' }` with the new block **without** another GET. `POST …/folio/lines` (`folio.add_item`) does **not** send a front-office frame (wait ~50ms / one extra message timeout).
6. Dev-actor via `Sec-WebSocket-Protocol: hospai.dev-actor.user_<id>` (and `HOSPAI_UNSAFE_LOCAL` / `HOSPAI_ALLOW_DEV_ACTOR` as the suite already sets) → 101. When flags are off, that protocol does **not** authenticate (401). **No** `?actor=` query — add a negative test that `?actor=user_owner` without header/protocol is 401.
7. `webSocketClose`: after client close, no throw. (Implementation must call `ws.close(code, reason)` because `compatibility_date` is `2025-07-01`.)
8. Hibernation: after 101 + subscribe, evict the DO with `{ webSockets: 'hibernate' }` (search `@cloudflare/vitest-pool-workers` / `cloudflare:test` for this option — names include `runInDurableObject` eviction helpers). Post-eviction, send `subscribe` again → snapshot, constructor must not throw. If the installed pool only supports `{ webSockets: 'close' }` vs `'hibernate'`, use `'hibernate'` and skip-fail (do not silently drop the test).

Kill-switch on the stream GET (no upgrade needed) → 503, no 101.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts
```

Expected: FAIL — `[119]` missing / no 101.

- [x] **Step 3: Auth + dispatcher handshake**

`resolveActor`: after the existing `x-dev-actor` header branch, if `isDevActorAllowed(env)`:

```ts
const protocol = request.headers.get('Sec-WebSocket-Protocol');
if (protocol) {
  const token = protocol.split(',')[0]?.trim() ?? '';
  if (token.startsWith('hospai.dev-actor.') && token.slice('hospai.dev-actor.'.length).startsWith('user_')) {
    return { userId: token.slice('hospai.dev-actor.'.length), source: 'dev' };
  }
}
```

Do **not** read `?actor=`. Strip any incoming `x-hospai-ws-actor` before the Worker sets it.

`handleGetFrontOfficeStream`:

1. If `Upgrade` header (case-insensitive) !== `websocket` → 400 `{ error: 'expected_websocket' }`.
2. `resolvePropertyContext` (already behind permission / entitlement / kill-switch in `dispatchV1`).
3. Clone/forward the request to `resolved.stub.fetch(forward)` with headers: original `Upgrade` / `Connection` / `Sec-WebSocket-*` / `Cookie`, plus `x-hospai-ws-actor: actor.userId`. If the client sent `Sec-WebSocket-Protocol`, the **101 must echo it** (browser requirement) — either the DO or the Worker sets `Sec-WebSocket-Protocol` on the response.
4. Return the DO response as-is (101). Do not `json()` wrap.
5. Transport failure → `degradedFailClosedReadResponse()` (503), no accept.

Append `V1_ROUTES` at END:

```
GET  /^\/v1\/properties\/([^/]+)\/front-desk\/stream$/
```

`degradedRead: 'FAIL_CLOSED'` on the audit row.

- [x] **Step 4: PropertyDO hibernation handlers + broadcast**

`fetch`:

- Non-websocket → 400 `expected_websocket` (belt). Non-stream path → **404**. Do **not** build a general HTTP router.
- `const [client, server] = Object.values(new WebSocketPair())`.
- `this.ctx.acceptWebSocket(server, ['front-office'])` — **never** `server.accept()`.
- `serializeAttachment({ propertyId, userId, fromDate, toDate })` from query if both dates pass `inclusiveDateRangeError` logic (duplicate the ISO + 90-night check in the DO or share a tiny helper). If dates missing/invalid, attach `fromDate: null, toDate: null` and **do not** auto-snapshot.
- `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))` once (safe to call per accept).
- If dates valid, `server.send(JSON.stringify({ type: 'snapshot', ...tape }))` using `readFrontOfficeTape`.
- Return `new Response(null, { status: 101, webSocket: client, headers: protocolEcho })`.

`webSocketMessage`: parse JSON. Unknown / invalid → ignore. `{ type: 'subscribe', fromDate, toDate }` → validate range; on fail send `{ type: 'error', error: 'date_range_exceeds_max' }` (keep open); on ok update attachment + send snapshot. `{ type: 'ping' }` → `{ type: 'pong', asOf: Date.now() }` (auto-response also covers the literal `ping` text).

`webSocketClose`: `ws.close(code, reason)`.

`broadcastFrontOffice(delta)`: sync. `for (const ws of this.ctx.getWebSockets('front-office'))` deserialize attachment; skip if window null; skip if payload does not overlap (`stay/OOO dates intersect`, **or** `rooms` is present — HK status applies to every window); `ws.send(JSON.stringify({ type: 'delta', asOf: Date.now(), ...delta }))`. Empty socket list → no-op.

Hook **`appendPropertyOutbox`** (the existing private wrapper at ~14163): after `appendOutbox(...)`, if `eventType` is one of:

`reservation.created`, `reservation.modified`, `reservation.status_changed`, `reservation.room_assigned`, `reservation.front_office_updated`, `room.created`, `room.updated`, `room.status_changed`, `room.ooo_changed`

then build a partial delta from the payload + a small SELECT (`mapFrontDeskListRow` / room row / ooo row). Cancel / check-out / unassign that no longer occupies → `removedBlockIds: [reservationId]`. OOO release → `removedOooIds`. Do **not** broadcast other event types (folio/payment/rate/config/shift).

Constructor: **unchanged**. No `getWebSockets` scan, no snapshot assemble.

- [x] **Step 5: Rebuild, re-run, check:permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
pnpm check:degraded
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-tape-routes.spec.ts test/front-desk-stream.spec.ts
```

Expected: all exit 0. `[114]` still `get_domain_config`. Catalog length 74.

- [x] **Step 6: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/auth.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/property-do.ts \
  apps/pms-core/test/front-desk-stream.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add hibernating front-office WebSocket stream [119]

EOF
)"
```

---

### Task 3: client-core methods + protocol types (no DOM WebSocket)

**Spec:** §8.7, §11. `client-core` stays React/DOM-free.

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Create: `packages/client-core/src/front-office-stream.ts`
- Modify: `packages/client-core/src/index.ts`
- Create: `packages/client-core/test/api-front-office-board.test.ts`
- Create: `packages/client-core/test/front-office-stream.test.ts`

**Forbidden this commit:** `new WebSocket`, React, `document`, SPA screens, pms-core.

- [x] **Step 1: Write failing tests**

`api-front-office-board.test.ts` (copy `api-property-setup.test.ts` transport mock):

- `getFrontOfficeTape(pid, { fromDate, toDate, roomTypeId? })` → `GET /v1/properties/:pid/front-desk/tape?fromDate=&toDate=`
- `getFrontOfficeDirectory(pid, { window, date?, status?, cursor? })` → directory query
- `getAvailableRooms(pid, { fromDate, toDate, roomTypeId? })`
- `getFrontOfficeSummary(pid, date)` → `?date=`
- Fail-closed 503 classifies as today (`ClassifiedError`)

`front-office-stream.test.ts`:

```ts
parseFrontOfficeStreamMessage(raw: string): FrontOfficeStreamMessage | null
serializeSubscribe(fromDate: string, toDate: string): string  // '{"type":"subscribe",...}'
frontOfficeStreamUrl(propertyId, fromDate?, toDate?): string
  // '/v1/properties/:pid/front-desk/stream' (+ query if dates)
```

Unknown JSON → `null`. Snapshot without `displayName`. `isFrontOfficeDelta` type guard.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-front-office-board.test.ts test/front-office-stream.test.ts
```

Expected: FAIL — methods missing.

- [x] **Step 3: Implement**

Add the four `getJson` methods next to `getArrivals`. Export types matching the HTTP bodies (`asOf`, `blocks`, `ooo`, summary occupancy).

`front-office-stream.ts` is pure functions + types (`FrontOfficeStreamMessage` union: snapshot | delta | pong | error). **No** `WebSocket`.

- [x] **Step 4: Rebuild and re-run**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core exec vitest run test/api-front-office-board.test.ts test/front-office-stream.test.ts
```

- [x] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/src/front-office-stream.ts \
  packages/client-core/src/index.ts packages/client-core/test/api-front-office-board.test.ts \
  packages/client-core/test/front-office-stream.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): add front-office tape, directory, and stream types

EOF
)"
```

---

### Task 4: Nav + `/board` tape chart (tape view only)

**Spec:** §4.3, §10, §14 tests **17–18**. Available view and widgets are Task 5.

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts`
- Create: `apps/web-pms/src/screens/TapeChartScreen.tsx`
- Create: `apps/web-pms/src/screens/TapeChartScreen.test.tsx`

**Forbidden this commit:** WebSocket provider, watermark, directory screen, summary GET (may omit widgets or show a placeholder — **prefer omit**; Task 5 adds them). No Tailwind. No drag. No POST.

- [x] **Step 1: Write failing tests**

`me.test.ts`: in the `reservations:read` filter test, also:

```ts
const ids = filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id);
expect(ids).toContain('board');
expect(ids).toContain('reservations'); // nav entry lands in Task 5 — **wait**
```

**Lock this task:** add **only** `{ id: 'board', label: 'Board', path: '/board', order: 8, permission: 'reservations:read' }`. Reservations nav is Task 5. Do **not** assert `reservations` yet.

`TapeChartScreen.test.tsx` (copy `BoardScreen.test.tsx` QueryClient + MemoryRouter + `usePropertyTimeZone` mock):

1. Timezone `America/Los_Angeles` vs UTC date mismatch → Pacific `YYYY-MM-DD` as `from`; `to` is from+6. `getFrontOfficeTape` called with that pair. `?from=&to=` override.
2. Occupying block is a `<Link to="/folio/:id">`. Guest batch compose like BoardScreen. VIP/DND badges when flags true (`badge-vip` / `badge-dnd`).
3. Unassigned pending → `data-testid="tape-unassigned"`.
4. Empty `rooms: []` → “No rooms yet — create rooms in Inventory.” Fail-closed → *“Property unreachable — board cannot load. This is not an empty day.”* `role="alert"` — **not** the empty copy.
5. Loading copy is `Loading…`.
6. Index: render `App` at `/` → navigate to `/board` (or assert `App.tsx` `<Navigate to="/board" />`).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/TapeChartScreen.test.tsx src/auth/me.test.ts
```

- [x] **Step 3: Implement**

`nav.ts`: insert Board at order 8 (array order need not match `order`; `ALL_NAV` sorts).

`App.tsx`: `<Route index element={<Navigate to="/board" replace />} />` (change from `/arrivals`). `<Route path="board" element={<TapeChartScreen />} />`.

`TapeChartScreen`:

- `useSearchParams` for `from` / `to`. Seed like BoardScreen leftover-3 (`propertyLocalToday`, `navigate replace`).
- `useQuery` `['front-desk-tape', propertyId, from, to]` → `api.getFrontOfficeTape`. Retry via existing `shouldRetry` / `read_stale` only (this GET is FAIL_CLOSED so retry false in practice).
- Guest refs → `postGuestsBatch` (same as BoardScreen).
- Room types labels via existing `api.listRoomTypes` if present; else show `roomTypeId`.
- CSS grid: rows grouped by type; columns = inclusive dates; `tabular-nums` on headers (`Intl.DateTimeFormat` + property TZ). Stay block spans `[arrival, departure)`. OOO `status-attention`. HK chip on row header. `content-visibility: auto` on rows. `min-w-0` + `truncate`. `touch-action: manipulation` on the scroller.
- `prefers-reduced-motion`: no transform animation; never `transition: all`.
- Links not `div` onClick. Date inputs `type="date"` + `<label>` + `autocomplete="off"`.
- `aria-live="polite"` visually-hidden “Board updated” region (Task 6 will fire it; can exist empty now).

Existing tokens only.

- [x] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/TapeChartScreen.test.tsx src/auth/me.test.ts src/shell/module-ui-registry.test.ts
```

- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/App.tsx apps/web-pms/src/auth/me.test.ts \
  apps/web-pms/src/screens/TapeChartScreen.tsx apps/web-pms/src/screens/TapeChartScreen.test.tsx \
  apps/web-pms/src/styles  # only if a new class landed
git commit -m "$(cat <<'EOF'
feat(web-pms): add tape chart board screen

EOF
)"
```

Do not `git add` unrelated CSS. If no style file changed, omit it.

---

### Task 5: Directory + available view + summary widgets

**Spec:** §5.2, §6.2, §7.2, §9, §14 tests **19–21**.

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts` — Reservations order 35
- Modify: `apps/web-pms/src/App.tsx` — `/reservations`
- Modify: `apps/web-pms/src/auth/me.test.ts` — `toContain('reservations')`
- Create: `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` (+ test)
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` — `?view=tape|available`
- Create: `apps/web-pms/src/screens/board-summary.tsx` (+ test)
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` (+ test) — mount widgets

**Forbidden this commit:** WebSocket, watermark, new writes, `/dashboard` route, `roomId` on create.

- [x] **Step 1: Write failing tests**

Directory:

1. Tabs write `?window=today|tomorrow|week|all` (and `date=` except `all`). `getFrontOfficeDirectory` called with that window.
2. Status filter `active` → `status=inquiry,pending,confirmed,checked_in`. Row is a link/button to `/folio/:id`. Empty → “No reservations in this window.” Fail-closed → board unreachable copy.
3. Local search field (`autocomplete="off"`, placeholder ends with `…`) calls existing `searchReservations` when `q` length > 0 (reuse AppShell debounce 300ms or the top-bar only — if using top-bar only, still have a directory-local field as spec §5.2). Do **not** hit directory GET with `q`.

Available:

4. `/board?view=available&from=&to=` lists the free room from the available GET; empty → “No rooms free for these dates.” “Book” is `<Link to="/book">`.

Summary:

5. `BoardSummary` with `{ arrivals: 51, overstay: 2, occupancy: { occupiedRooms: 1, sellableRooms: 3 } }` shows 51 and an overstay chip (`status-exception`) and `1 / 3`. Overstay hidden when 0. Widget Arrivals is a `<Link to="/arrivals?date=">`.
6. `BoardScreen` header contains `data-testid="board-summary"` (mock `getFrontOfficeSummary`). Tape header too.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/board-summary.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/auth/me.test.ts
```

- [x] **Step 3: Implement**

Directory table: reservation id `translate="no"`, `guestLabel`, status, dates `tabular-nums`, room code from optional `listRooms` if `housekeeping:read` else truncated `roomId`. Do not fail the page on rooms 403.

Title Case: Today, Tomorrow, This Week, All.

Shared `BoardSummary` query key `['front-desk-summary', propertyId, date]`.

- [x] **Step 4: Re-run tests**

Same command as Step 2. Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/App.tsx apps/web-pms/src/auth/me.test.ts \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx apps/web-pms/src/screens/TapeChartScreen.test.tsx \
  apps/web-pms/src/screens/board-summary.tsx apps/web-pms/src/screens/board-summary.test.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/BoardScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): add reservations directory, available rooms, and summary widgets

EOF
)"
```

---

### Task 6: FrontOfficeLive + stale watermark + list invalidation

**Spec:** §8.5–8.7, §9, §10, §14 tests **22–23**.

**Files:**
- Create: `apps/web-pms/src/shell/FrontOfficeLive.tsx` (+ test)
- Create: `apps/web-pms/src/shell/StaleWatermark.tsx` (+ test)
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx` — invalidation
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` — apply snapshot/delta into query cache **or** rely on invalidation (invalidation is enough per spec §8.5)

Inject `createSocket` for tests (do not call `new WebSocket` at module scope). Production:

```ts
new WebSocket(url, import.meta.env.VITE_USE_DEV_ACTOR === '1'
  ? [`hospai.dev-actor.${import.meta.env.VITE_DEV_ACTOR || 'user_owner'}`]
  : undefined)
```

Same-origin URL from `frontOfficeStreamUrl`. Clerk: cookies on upgrade; no protocol.

**Forbidden this commit:** polling `setInterval` as the live path; entitlement WS; `ui-kit`; connecting from each screen (one shell connection).

- [x] **Step 1: Write failing tests**

`StaleWatermark.test.tsx`:

- `asOf` + `stale=true` → `data-testid="stale-watermark"`, `role="status"`, `aria-live="polite"`, copy `Live updates paused — showing data from {time}` via `Intl.DateTimeFormat`. `stale=false` → nothing.

`FrontOfficeLive.test.tsx` (fake socket with `readyState`, `send`, `close`, `onmessage`):

1. After a snapshot message, `stale` is false. Then fake `close` → watermark shown; last snapshot remains in query cache (`['front-desk-tape']` data still present).
2. Fake snapshot after close/reconnect → watermark gone.
3. Fake socket stays OPEN with **no messages** for > 30s (fake timers) → watermark **absent** (hibernated-open is live).
4. On `delta` / `snapshot`, `queryClient.invalidateQueries` for `['board']`, `['front-desk-summary']`, `['front-desk-directory']`, `['front-desk-available']`, `['front-desk-tape']`.
5. Mounts only when `authority.kind === 'live'` and `reservations:read`. Hidden on `no_access`.

`BoardScreen.test.tsx`: with a mocked live bus that emits `delta`, `getArrivals` is called again (invalidation). Keep existing date-seed tests green.

Reconnect backoff: unit-test a tiny `nextReconnectMs(attempt)` cap 10_000. Do not flakily wait 10s in jsdom.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run \
  src/shell/FrontOfficeLive.test.tsx \
  src/shell/StaleWatermark.test.tsx \
  src/screens/BoardScreen.test.tsx
```

- [x] **Step 3: Implement**

`AppShell`: wrap main with `FrontOfficeLive` when live + `reservations:read`. Render `StaleWatermark` under `ShiftStrip`.

Subscribe window: union of tape `from`/`to` (if on `/board`), list `date` (arrivals/departures), and property-local today → today+6. Send `subscribe` when the union changes (`useLocation`).

On open: `subscribe`. On close/error: mark stale if a snapshot was seen; reconnect with backoff. Production liveness = `readyState`; do **not** watermark on quiet.

Dev actor: protocol subprotocol only when `VITE_USE_DEV_ACTOR === '1'`. Never put actor in the URL.

- [x] **Step 4: Re-run tests**

Same as Step 2 plus `TapeChartScreen.test.tsx` / `AppShell.search.test.tsx` / `AppShell.me.test.tsx` / `AppShell.boot.test.tsx`.

- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/FrontOfficeLive.tsx apps/web-pms/src/shell/FrontOfficeLive.test.tsx \
  apps/web-pms/src/shell/StaleWatermark.tsx apps/web-pms/src/shell/StaleWatermark.test.tsx \
  apps/web-pms/src/shell/AppShell.tsx apps/web-pms/src/screens/BoardScreen.test.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): live front-office socket and stale watermark

EOF
)"
```

---

### Task 7: Bidirectional leftover pointers (docs only)

**Spec:** Amends blurb; §11. **When this chunk lands** — this is that commit. Do not mix typecheck fixes.

**Files (one sentence each, do not rewrite):**
- `docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md` — WS leftover closed by tape-chart spec
- `docs/superpowers/specs/2026-08-07-front-desk-spa-shell-design.md` — watermark + front-office WS closed; entitlement push still deferred
- `docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md` — leftover 8 closed
- `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — leftover 4 closed
- `docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md` — leftover 4 watermark UI only; list routes stay FAIL_CLOSED
- Optional one sentence in `ARCHITECTURE.md` §16.3 item 3 that the tape chart now has a live SPA (same PR as implementation, not a drive-by). If you touch ARCHITECTURE, keep it to that sentence.

- [x] **Step 1: Edit pointers**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md \
  docs/superpowers/specs/2026-08-07-front-desk-spa-shell-design.md \
  docs/superpowers/specs/2026-08-12-room-operations-hk-completion-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md \
  ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: point leftover specs at the tape chart live board

EOF
)"
```

Omit `ARCHITECTURE.md` from `git add` if you did not edit it.

---

### Task 8: CI / checks job

**Spec:** §2 invariants, §14.3, §14.24, §15.

- [x] **Step 1: Hygiene pins**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations/do-property packages/do-runtime/src/property-migrations.ts
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
```

`PROPERTY_SCHEMA_HEAD` stays 24. `NIGHT_AUDIT_STEPS.length === 7`. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `COMMAND_CATALOG.length === 74`. `AUDIT_WRITER_COMMAND_IDS.size === 49`. `[114]=get_domain_config`; `[115]`–`[119]` as spec.

- [x] **Step 2: `checks` job — copy `.github/workflows/ci.yml` in order**

```bash
pnpm install
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

Expected: all exit 0.

- [x] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 9: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–9 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [x] **Step 1: Mark checkboxes**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-tape-chart-live-board.md
git commit -m "$(cat <<'EOF'
docs: tick tape chart live board plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip — but the intent is this commit is last.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Routes 115–118 FAIL_CLOSED reads | 1 |
| Occupying overlap / OOO / unassigned / directory windows / available / summary 51 | 1 |
| Route 119 hibernating WS, broadcast, hibernate eviction, dev protocol | 2 |
| client-core GETs + protocol (no DOM WS) | 3 |
| `/board` tape grid, nav order 8, index redirect | 4 |
| Directory / available view / widgets on list boards | 5 |
| One shell socket, watermark, list invalidation | 6 |
| Leftover pointers | 7 |
| CI, schema 24, catalog 74, no new class/table | 8 |
| Plan checkboxes | 9 |
| No new commands / writers / KV tape / list-route reclass | all (forbidden) |
