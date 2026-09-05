# Desk freshness + tape cache (R0.6)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 6](../../audit/2026-09-04-full-codebase-audit.md) (**U1**, **U2**, **U3**, **Q5**, **G6**, **P2**, **P4**, **G9**); [Tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) (WS + `BoardSummary` — **do not rebuild** occupancy or ARI); [AGENTS.md §4 SPA invalidate rules](../../../AGENTS.md) (full query key, local invalidate on mutation); `apps/web-pms/src/screens/CheckInScreen.tsx` (~127–161, ~164–226); `apps/web-pms/src/screens/BoardScreen.tsx` (~121–131, ~407–464); `apps/web-pms/src/screens/FolioScreen.tsx` (~712–775); `apps/web-pms/src/shell/FrontOfficeLive.tsx` (~34–40, ~84–145); `apps/web-pms/src/screens/TapeChartScreen.tsx` (~249–287); `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` (~228–232); `apps/pms-core/src/v1-dispatch.ts` (~3512 `refs.length > 50` → 400).

**Closes:** Audit **U1** (check-in does not invalidate board), **U2** (checkout does not invalidate board), **U3** (check-in enabled for terminal / in-house stays), **Q5** (confirm-pending invalidates dead `['arrivals']` key), **P2** (WS `setQueryData` wrong tape key + over-invalidation), **P4** (tape guest batch unchunked → cap 400 → “Name pending”), **G6** / **G9** (SPA tests would not catch U1/P2/P4). **Roadmap:** **R0.6**. **Requires:** tape chart vertical shipped ([2026-08-13 spec](./2026-08-13-tape-chart-live-board-design.md)). **Does not** advance R0.7+, R1.1 Hub, Playwright, PropertyDO extraction, or new HTTP/commands.

---

## Executive summary

After check-in, checkout, confirm-pending, or assign-room, the clerk’s **own** screen must refresh from **local** `invalidateQueries` — not from waiting on WebSocket. Today: `CheckInScreen` and `FolioScreen` checkout never invalidate `['board']`; `ConfirmPendingButton` invalidates `['arrivals']`, which **no query uses** (board keys are `['board', mode, …]` — **Q5** = **U1** confirm path). `FrontOfficeLive` writes tape cache to `['front-desk-tape']` while `TapeChartScreen` reads `['front-desk-tape', propertyId, from, to]` — snapshot seed is a **silent no-op** (**P2**). Every WS message also invalidates five front-office prefixes including full tape refetch (**P2** perf). Tape/Board/Reservations directory call `postGuestsBatch` with unbounded `refs`; HTTP 400s at 51 → batch query fails → `guestLabel` returns “Name pending” for **every** row (**P4**). Check-in primary button disables only on `isPending`; terminal and already in-house stays stay clickable (**U3**).

This spec locks **SPA-only** cache contracts: four desk mutations invalidate `['board']` on success; check-in button disabled with reason copy; WS snapshot/delta use the **same** tape query key as `TapeChartScreen`; live handler invalidates **`['board']` only** and merges deltas into tape cache without tape invalidation; guest batch fetch chunks at **50** in Tape, Board, and Reservations directory. Characterization SPA tests land **first** and must **fail on current `main`**. No backend changes.

---

## Locked product call

1. **Local freshness on mutations the clerk just performed:** check-in, checkout, confirm-pending, assign-room → `void queryClient.invalidateQueries({ queryKey: ['board'] })` in mutation `onSuccess` (after provisional early-return where applicable). **Do not** rely on WebSocket for the screen that initiated the mutation. WS remains for other tabs/users.
2. **Confirm-pending:** **Stop** invalidating `['arrivals']`. Prefix `['board']` only.
3. **Check-in primary button:** disable when reservation is in `TERMINAL_STATUSES` (`cancelled`, `checked_out`, `no_show`) **or** `status === 'checked_in'` (already in-house). Surface **why** via existing Alert / muted copy pattern (same screen already disables `FrontOfficeEditor` for terminal — extend to primary action).
4. **`FrontOfficeLive` tape cache:** `setQueryData` / delta merge at **`['front-desk-tape', propertyId, fromDate, toDate]`** — identical to `TapeChartScreen`. **Do not** invalidate `['front-desk-tape']` (or sibling tape prefixes) on WS messages; invalidate **`['board']` only** from live (**P2**).
5. **Guest batch chunking:** chunk `postGuestsBatch` at **50** refs in Tape, Board, and Reservations directory clients. HTTP already returns **400** `refs_limit_exceeded` at 51 (`v1-dispatch.ts` ~3512). Unchunked tape with 51+ blocks → entire batch fails → all names “Name pending”.
6. **Tests first (G6/G9):** SPA vitest spies on `invalidateQueries` / `setQueryData` / `postGuestsBatch` call counts; mock `../client.js`. **No Playwright.**
7. **Occupancy / summary:** stays `get_front_desk_summary` via `BoardSummary` — **do not** scan reservations or rebuild ARI/BoardSummary. Hold = `PENDING`. No new routes/commands.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Mutation invalidate prefix** | `['board']` only for check-in, checkout, confirm-pending, assign-room `onSuccess`. |
| **Dead key** | Remove `['arrivals']` invalidation from `ConfirmPendingButton`. Never add parallel aliases. |
| **Check-in disable** | `TERMINAL_STATUSES` ∪ `{ checked_in }`; explain in UI (Alert or `title` + visible muted line). |
| **Tape query key** | `['front-desk-tape', propertyId, from, to]` everywhere — HTTP query, WS `setQueryData`, delta merge, tests. |
| **WS invalidation (P2)** | `FrontOfficeLive` on snapshot **and** delta: `invalidateQueries({ queryKey: ['board'] })` **only**. Remove `INVALIDATE_KEYS` broad list for message handler. |
| **WS snapshot** | `setQueryData(tapeKey, { ok: true, fromDate, toDate, asOf, rooms, blocks, ooo })` using `msg.fromDate` / `msg.toDate` from snapshot payload. |
| **WS delta** | Merge into cache at matching tape key(s) for subscribed window (upsert blocks/rooms/ooo, remove by id lists) — **no** tape invalidation. If no cache entry, skip merge; board invalidation still runs. |
| **Guest batch cap** | **50** refs per HTTP call; shared chunk helper; merge `states` maps. Scope: `TapeChartScreen`, `BoardScreen`, `ReservationsDirectoryScreen` only. |
| **G6/G9** | Failing tests on `main` before production edits. Mock `../client.js`. |
| **BoardSummary** | Unchanged — `['front-desk-summary', propertyId, date]`. Not invalidated from WS this slice (summary refreshes on navigation / staleTime). |

---

## 1. Problem / evidence

### 1.1 U1 — Check-in does not invalidate board

```155:161:apps/web-pms/src/screens/CheckInScreen.tsx
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Request queued — will apply when the property is reachable.');
        return;
      }
      setMessage('Checked in');
    },
```

No `invalidateQueries`. Clerk returns to Arrivals; list still shows guest as expected until WS or manual refresh.

**Assign-room** on the same screen (~113–125) also omits board invalidation — same contract.

### 1.2 U2 — Checkout does not invalidate board

```747:775:apps/web-pms/src/screens/FolioScreen.tsx
    onSuccess: (result) => {
      // … provisional / autoCapture branches …
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
```

Invalidates reservation (and folio on capture path) but **not** `['board']`. In-house / departures lists stay stale after checkout.

### 1.3 Q5 — Confirm-pending uses dead query key

```121:132:apps/web-pms/src/screens/BoardScreen.tsx
function ConfirmPendingButton({ reservationId }: { reservationId: string }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    // …
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['arrivals'] });
    },
  });
```

Board queries use **`['board', mode, tenant.propertyId, date, cursor]`** (~407–431). No consumer registers `['arrivals']` — invalidation is a **no-op** (**Q5** = confirm path of **U1**).

### 1.4 U3 — Check-in enabled for terminal / in-house

```164:173:apps/web-pms/src/screens/CheckInScreen.tsx
  const canCheckIn = !checkIn.isPending;
  // …
  const editorDisabled = Boolean(
    reservationQ.data && TERMINAL_STATUSES.has(reservationQ.data.status),
  );
```

Primary button: `disabled={!canCheckIn}` (~225) — only pending state. `FrontOfficeEditor` respects terminal (~298) but **Check in** stays enabled for `checked_in`, `cancelled`, `checked_out`, `no_show`.

### 1.5 P2 — WS tape key mismatch + over-invalidation

**Wrong `setQueryData` key:**

```134:145:apps/web-pms/src/shell/FrontOfficeLive.tsx
        if (msg.type === 'snapshot') {
          queryClient.setQueryData(['front-desk-tape'], {
            ok: true,
            fromDate: msg.fromDate,
            // …
          });
        }
        invalidateFrontOffice(queryClient);
```

**Tape consumer key:**

```249:251:apps/web-pms/src/screens/TapeChartScreen.tsx
  const tapeQ = useQuery({
    queryKey: ['front-desk-tape', tenant.propertyId, from, to],
    queryFn: () => api.getFrontOfficeTape(tenant.propertyId, { fromDate: from!, toDate: to! }),
```

Snapshot seeds cache under a key **TapeChart never reads** — WS “keep tape cache” test passes on the wrong key (`FrontOfficeLive.test.tsx` ~130).

**Over-invalidation:**

```34:40:apps/web-pms/src/shell/FrontOfficeLive.tsx
const INVALIDATE_KEYS = [
  ['board'],
  ['front-desk-summary'],
  ['front-desk-directory'],
  ['front-desk-available'],
  ['front-desk-tape'],
] as const;
```

Every snapshot **and** delta triggers five prefix invalidations including full tape HTTP refetch — expensive on busy properties (**P2** perf).

### 1.6 P4 — Guest batch unchunked → “Name pending”

Tape collects all block `guestRef`s (~278–285) and posts in one call:

```283:287:apps/web-pms/src/screens/TapeChartScreen.tsx
  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => api.postGuestsBatch(tenant.propertyId, refs),
```

Same pattern in `BoardScreen` (~458–460) and `ReservationsDirectoryScreen` (~228–230). HTTP cap:

```3512:3512:apps/pms-core/src/v1-dispatch.ts
  if (refs.length > 50) return json({ error: 'refs_limit_exceeded', max: 50 }, 400);
```

51+ refs → batch query **error** → `states = {}` → `guestLabel` → **“Name pending”** for every row (`guest-row.tsx` ~4–5).

### 1.7 G6 / G9 — Tests encode the gap

Audit matrix: board invalidate / tape key / chunking **not** asserted in SPA tests. `FrontOfficeLive.test.tsx` ~170–193 **expects** broad invalidation including `['front-desk-tape']` — test locks the bug. `CheckInScreen.test.tsx` has no `invalidateQueries` spy. `BoardScreen.test.tsx` does not assert confirm invalidates `['board']`.

---

## 2. Locked behaviour

### 2.1 Board query key contract (reference)

Implementers must invalidate the **prefix** the consumers actually use:

| Screen | Query keys (prefix `['board']` matches all) |
|---|---|
| Arrivals list | `['board', 'arrivals', propertyId, date, cursor]` |
| Departures list | `['board', 'departures', propertyId, date, cursor]` |
| In-house list | `['board', 'in-house', propertyId, null, cursor]` |
| Arrivals page extras | `['board', 'departures', …]`, `['board', 'in-house', …]` |

`invalidateQueries({ queryKey: ['board'] })` refetches **all** of the above — correct for desk mutations.

**Forbidden:** `['arrivals']`, `['departures']`, `['in-house']` as invalidate targets.

### 2.2 Mutation → invalidate map

| Mutation | File | `onSuccess` invalidation | Notes |
|---|---|---|---|
| Check-in | `CheckInScreen.tsx` `checkIn` | `['board']` | After non-provisional success; provisional early-return unchanged |
| Assign room | `CheckInScreen.tsx` `assign` | `['board']` | Room assignment affects arrivals board |
| Confirm pending | `BoardScreen.tsx` `ConfirmPendingButton` | `['board']` | Replace `['arrivals']` |
| Checkout | `FolioScreen.tsx` `checkOut` | `['board']` **and** existing `['reservation', …]` | Add board; keep folio/reservation invalidations |

**Not in this slice:** folio line mutations, front-office editor save, booking wizard (separate invalidate rules), night audit.

**WebSocket:** unchanged role — other tabs/users. Mutator’s tab must not **depend** on WS.

### 2.3 Check-in primary button (U3)

Extend disable logic:

```ts
const status = reservationQ.data?.status;
const terminalOrInHouse =
  status != null &&
  (TERMINAL_STATUSES.has(status) || status === 'checked_in');
const canCheckIn = !checkIn.isPending && !terminalOrInHouse;
```

**Copy (locked — pick one pattern, both acceptable):**

| Condition | User-visible reason |
|---|---|
| `cancelled` / `no_show` / `checked_out` | Alert: “This reservation is {status label} — check-in is not available.” (reuse `reservationStatusLabel`) |
| `checked_in` | Alert: “Guest is already in house.” |
| `checkIn.isPending` | Button disabled, no extra copy |

Use existing `Alert` + `reservationStatusLabel` / `Badge` rung — no raw status strings in UI. Optional `title` on disabled button for accessibility.

**Forbidden:** enabling check-in for terminal or in-house statuses.

### 2.4 FrontOfficeLive tape cache (P2)

#### 2.4.1 Tape query key helper

Shared helper (implementer choice: `FrontOfficeLive.tsx` local or `apps/web-pms/src/front-office-query-keys.ts`):

```ts
function frontDeskTapeKey(
  propertyId: string,
  fromDate: string,
  toDate: string,
): readonly [string, string, string, string] {
  return ['front-desk-tape', propertyId, fromDate, toDate] as const;
}
```

Must match `TapeChartScreen` exactly.

#### 2.4.2 Snapshot handler

On `msg.type === 'snapshot'`:

1. `const key = frontDeskTapeKey(tenant.propertyId, msg.fromDate, msg.toDate)`.
2. `queryClient.setQueryData(key, { ok: true, fromDate: msg.fromDate, toDate: msg.toDate, asOf: msg.asOf, rooms: msg.rooms, blocks: msg.blocks, ooo: msg.ooo })`.
3. `void queryClient.invalidateQueries({ queryKey: ['board'] })`.

**Remove** call to `invalidateFrontOffice` / multi-key loop for message handler.

#### 2.4.3 Delta handler

On `msg.type === 'delta'`:

1. Resolve subscribed window from `windowRef.current` (`fromDate`, `toDate`) — same as `subscribeWindow`.
2. `const key = frontDeskTapeKey(tenant.propertyId, fromDate, toDate)`.
3. If `queryClient.getQueryData(key)` exists, merge:
   - Remove blocks where `reservationId` (or block id field used in tape rows) ∈ `msg.removedBlockIds`.
   - Remove ooo where `oooId` ∈ `msg.removedOooIds`.
   - Upsert `msg.blocks` / `msg.rooms` / `msg.ooo` by id (replace or append).
   - Set `asOf: msg.asOf` on cached object.
4. `void queryClient.invalidateQueries({ queryKey: ['board'] })` only.

**Forbidden:** `invalidateQueries({ queryKey: ['front-desk-tape'] })` on WS messages.

#### 2.4.4 Stale watermark

Unchanged — `setStale` / `StaleWatermark` on close/error; reconnect + snapshot clears stale.

### 2.5 Guest batch chunking (P4)

#### 2.5.1 Shared helper

Add `apps/web-pms/src/guest-batch-chunked.ts` (or `packages/client-core` if reused later — **prefer web-pms** this slice):

```ts
export const GUEST_BATCH_MAX = 50 as const;

export function chunkGuestRefs(refs: string[]): string[][] {
  // dedupe preserving order, then slice into chunks of GUEST_BATCH_MAX
}

export async function fetchGuestStatesChunked(
  postGuestsBatch: (propertyId: string, refs: string[]) => Promise<{ states: Record<string, GuestRowState> }>,
  propertyId: string,
  refs: string[],
): Promise<Record<string, GuestRowState>> {
  // parallel or sequential chunk calls; merge states; empty refs → {}
}
```

#### 2.5.2 Consumer wiring

Replace bare `api.postGuestsBatch(tenant.propertyId, refs)` in:

| File | Query key unchanged |
|---|---|
| `TapeChartScreen.tsx` | `['guests-batch', propertyId, refs.join('\|')]` |
| `BoardScreen.tsx` | same |
| `ReservationsDirectoryScreen.tsx` | same |

`queryFn` becomes `() => fetchGuestStatesChunked(api.postGuestsBatch, propertyId, refs)` returning `{ states }` shape batch query expects.

**Out of scope for chunking:** `CheckInScreen` (single ref), `FolioScreen` (single ref), `BookingScreen`, `ExceptionsScreen` — always ≤1 ref.

#### 2.5.3 Failure behaviour

If any chunk returns error, batch query fails (existing error UI). Partial chunk success without merge is **forbidden**.

### 2.6 Optional same-file fix (I5)

If implementer touches `BoardScreen.tsx` for Q5, **may** fix **I5** in the same commit: `PageHeader` title must match route mode (`Arrivals` / `Departures` / `In house`) — not all “Front Desk”. **Not required** if titles already correct; do not expand scope into Vertical 11.

---

## 3. Error + HTTP contract

**No HTTP or command changes.** Existing `refs_limit_exceeded` at 51 remains server-side guard; client chunking prevents hitting it from Tape/Board/Directory.

---

## 4. Implementation steps

**Order: failing SPA characterization tests on `main`, then production.**

### 4.1 Tests first (red on `main`)

**`apps/web-pms/src/screens/CheckInScreen.test.tsx`**

- Spy `queryClient.invalidateQueries` (via `../client.js` mock pattern used elsewhere).
- After successful check-in mutation, expect a call with `{ queryKey: ['board'] }`.
- **Add:** terminal / `checked_in` reservation → `[data-testid="check-in"]` disabled; reason visible.
- **Add:** assign-room success → invalidates `['board']`.

**`apps/web-pms/src/screens/BoardScreen.test.tsx`**

- Render row with pending + Confirm; click Confirm; spy `invalidateQueries`.
- Expect `['board']` prefix; expect **no** call with `{ queryKey: ['arrivals'] }`.

**`apps/web-pms/src/screens/FolioScreen.test.tsx`**

- Extend checkout success test (~508+): spy `invalidateQueries`; expect `['board']` in addition to `['reservation', …]`.

**`apps/web-pms/src/shell/FrontOfficeLive.test.tsx`**

- **Replace** test ~170–193 “delta and snapshot invalidate front-office query keys”:
  - Snapshot: `setQueryData` called with `['front-desk-tape', 'prop_demo', fromDate, toDate]` matching snapshot payload dates.
  - Snapshot + delta: `invalidateQueries` called with `['board']` only — **not** `['front-desk-tape']`, `['front-desk-summary']`, etc.
- Update test ~121–133 “keeps tape cache” to assert full tape key, not `['front-desk-tape']` alone.
- **Add:** delta with `removedBlockIds` merges into cache at full key without tape invalidation.

**`apps/web-pms/src/screens/TapeChartScreen.test.tsx`**

- Seed tape with 51 distinct `guestRef`s on blocks.
- Assert `postGuestsBatch` called **twice** (50 + 1) or call count ≥ 2 with max 50 refs per call.
- Assert rendered names resolve (not all “Name pending”).

**`apps/web-pms/src/guest-batch-chunked.test.ts`** (new unit)

- `chunkGuestRefs` length 51 → 2 chunks [50, 1].
- Dedupe preserves order.

All SPA tests: `vi.mock('../client.js', …)` — **no** real HTTP.

### 4.2 Production — mutations

1. `CheckInScreen.tsx`: board invalidate on check-in + assign success; U3 disable + copy.
2. `BoardScreen.tsx`: `ConfirmPendingButton` → `['board']`.
3. `FolioScreen.tsx`: checkout `onSuccess` → add `['board']`.

### 4.3 Production — FrontOfficeLive

1. Remove `INVALIDATE_KEYS` / `invalidateFrontOffice` from message path (or reduce to board-only inline call).
2. Snapshot `setQueryData` at `frontDeskTapeKey(tenant.propertyId, msg.fromDate, msg.toDate)`.
3. Delta merge helper; board invalidate only.

### 4.4 Production — guest batch

1. Add `guest-batch-chunked.ts` + unit test.
2. Wire `TapeChartScreen`, `BoardScreen`, `ReservationsDirectoryScreen` batch queries.

---

## 5. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `CheckInScreen.test.tsx` | Live reservation | Check-in success | `invalidateQueries` with `['board']` |
| T2 | `CheckInScreen.test.tsx` | `checked_in` / terminal | Render | Check-in disabled + reason |
| T3 | `CheckInScreen.test.tsx` | Room selected | Assign success | `invalidateQueries` with `['board']` |
| T4 | `BoardScreen.test.tsx` | Pending row | Confirm | `['board']` yes; `['arrivals']` no |
| T5 | `FolioScreen.test.tsx` | In-house folio | Checkout success | `['board']` + `['reservation', …]` |
| T6 | `FrontOfficeLive.test.tsx` | WS snapshot | Message | `setQueryData` key = tape screen key |
| T7 | `FrontOfficeLive.test.tsx` | WS delta | Message | `invalidateQueries` `['board']` only |
| T8 | `FrontOfficeLive.test.tsx` | Cached tape + delta | removedBlockIds | Cache updated; no tape invalidation |
| T9 | `TapeChartScreen.test.tsx` | 51 guest refs | Load tape | ≥2 batch calls, ≤50 refs each |
| T10 | `guest-batch-chunked.test.ts` | 51 refs | chunk | [50, 1] |
| T11 | regression | Board list tests | — | Still green |

Tests **T1–T10** must **fail on current `main`**.

---

## 6. Verify commands

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/CheckInScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/FrontOfficeLive.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/guest-batch-chunked.test.ts
```

Full gate after implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** unchanged — this slice is SPA-only. Never put `--` before `--shard`.

---

## 7. Files in scope

| File | Change |
|---|---|
| `apps/web-pms/src/screens/CheckInScreen.tsx` | U1 assign + check-in invalidate; U3 disable + copy |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Q5 confirm → `['board']`; optional I5 titles |
| `apps/web-pms/src/screens/FolioScreen.tsx` | U2 checkout → `['board']` |
| `apps/web-pms/src/shell/FrontOfficeLive.tsx` | P2 tape key, board-only invalidate, delta merge |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | P4 chunked batch |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | P4 chunked batch |
| `apps/web-pms/src/guest-batch-chunked.ts` | New shared chunk helper |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | G6 U1/U3 tests |
| `apps/web-pms/src/screens/BoardScreen.test.tsx` | G6 Q5 test |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | G6 U2 test |
| `apps/web-pms/src/shell/FrontOfficeLive.test.tsx` | G6/G9 P2 tests (rewrite invalidate test) |
| `apps/web-pms/src/screens/TapeChartScreen.test.tsx` | G9 P4 chunk test |
| `apps/web-pms/src/guest-batch-chunked.test.ts` | Chunk unit tests |

**Not in scope:** `apps/pms-core`, `packages/contracts`, `packages/client-core` (unless type export for `GuestRowState` import), `COMMAND_CATALOG`, route audit, schema heads, Playwright, PropertyDO, BoardSummary logic, ARI_KV, new routes/commands.

---

## 8. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new dispatched command. No HTTP route additions.

---

## 9. Out of scope

- Rebuilding tape chart HTTP/WS server ([2026-08-13 spec](./2026-08-13-tape-chart-live-board-design.md) — shipped)
- Dashboard Hub / R1.1 occupancy trend (warehouse §7.8)
- Vertical 11 desk pixels (U4–U17, I1–I15) except optional I5 in `BoardScreen.tsx`
- Playwright / Cypress e2e
- PropertyDO extraction
- Raising guest batch HTTP cap above 50
- Invalidating `['front-desk-summary']` from WS (perf trade-off locked in P2)
- Booking wizard / folio mutation invalidate keys (unchanged)
- `GuestsDirectoryScreen` — uses `listGuests` / `searchGuests`, not batch

---

## 10. Success criteria

1. Check-in, assign-room, confirm-pending, checkout: clerk sees updated board **without** waiting for WS (**U1**, **U2**, **Q5**).
2. Check-in disabled for terminal and in-house with clear copy (**U3**).
3. WS snapshot seeds `['front-desk-tape', propertyId, from, to]`; deltas merge; WS does **not** invalidate tape (**P2**).
4. Tape/Board/Reservations directory with 51+ guests resolve names (chunked batch) (**P4**).
5. SPA tests T1–T10 fail on `main`, pass after fix (**G6**, **G9**).
6. `BoardSummary` / `get_front_desk_summary` unchanged; Hold = `PENDING`.
7. Catalog/route/schema pins unchanged.
8. `pnpm test:local` green.

---

## 11. Relationship to prior specs

[2026-08-13-tape-chart-live-board-design.md](./2026-08-13-tape-chart-live-board-design.md) §8 specified WS invalidation of five query prefixes including `['front-desk-tape']`. **This spec supersedes that invalidation list for P2:** live handler invalidates **`['board']` only**; tape freshness on WS is via **correct `setQueryData` key + delta merge**, not tape invalidation. Occupancy widgets, `BoardSummary`, and `get_front_desk_summary` remain as shipped — **do not rebuild**.

[AGENTS.md](../../../AGENTS.md) §4 SPA rules require mutator-local invalidate of the **full** consumer key prefix — this slice names that prefix **`['board']`** for desk lifecycle mutations and **`['front-desk-tape', propertyId, from, to]`** for WS tape cache.

---

## 12. Manual verify (staging / local)

1. Check in a guest from `/check-in/:id` → navigate to `/arrivals` — guest appears in-house / removed from arrivals **immediately** (no WS wait).
2. Confirm a pending hold on arrivals board — row updates to confirmed without refresh.
3. Check out from folio → `/in-house` no longer lists guest.
4. Open `/board` tape with 50+ occupied cells — guest names render (not all “Name pending”).
5. Open tape in tab A; check in from tab B — tab A board lists update via WS; tape updates via delta merge or navigation (no full tape flash/refetch loop on every delta).
