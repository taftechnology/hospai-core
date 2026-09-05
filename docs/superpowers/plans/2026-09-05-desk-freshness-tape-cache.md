# Desk freshness + tape cache (R0.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **U1**, **U2**, **U3**, **Q5**, **G6**, **P2**, **P4**, **G9** — desk mutations invalidate `['board']` locally; check-in disabled for terminal/in-house stays; WS tape cache uses the same query key as `TapeChartScreen`; guest batch chunked at 50 in Tape/Board/Directory.

**Architecture:** Characterization **SPA vitest** tests land **first** and must fail on current `main`. Production edits are **SPA-only** — no pms-core, contracts catalog, routes, or schema changes. Mutator `onSuccess` calls `invalidateQueries({ queryKey: ['board'] })`; `FrontOfficeLive` seeds/merges tape at `['front-desk-tape', propertyId, from, to]` and invalidates **`['board']` only** on WS messages; shared `fetchGuestStatesChunked` splits `postGuestsBatch` at 50 refs.

**Tech Stack:** React SPA (`apps/web-pms`), `@tanstack/react-query`, vitest + `@testing-library/react`, `@hospai/client-core` types (`GuestRowState`, `FrontOfficeDelta`). **No Playwright. No backend.**

**Spec:** `docs/superpowers/specs/2026-09-05-desk-freshness-tape-cache-design.md` (Status: Approved — normative).

---

## Global Constraints

| Constraint | Value / rule |
|---|---|
| `COMMAND_CATALOG` length | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** — unchanged |
| `ORG_SCHEMA_HEAD` | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` — unchanged |
| pms-core shards | Never put `--` before `--shard` |
| SPA tests | `vi.mock('../client.js', …)` — no real HTTP |
| Invalidate prefix (desk mutations) | `['board']` only — **never** `['arrivals']` |
| Tape query key | `['front-desk-tape', propertyId, fromDate, toDate]` everywhere |
| WS invalidation (P2) | `['board']` only — **no** tape/summary/directory/available invalidation |
| Guest batch cap | **50** refs per HTTP call; dedupe preserving order |
| BoardSummary | Unchanged — `['front-desk-summary', propertyId, date]` |
| Occupancy | `get_front_desk_summary` only — do not scan reservations |

Tree verified 2026-09-05 per spec. No catalog/route/schema pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| U1 / Q5 | Check-in, assign-room, confirm-pending → `invalidateQueries({ queryKey: ['board'] })` on non-provisional success |
| U2 | Checkout → add `['board']`; keep existing `['reservation', …]` / folio invalidations |
| U3 | Disable check-in for `TERMINAL_STATUSES` ∪ `{ checked_in }`; show Alert reason copy |
| Dead key | Remove `['arrivals']` from `ConfirmPendingButton` — never add parallel aliases |
| P2 snapshot | `setQueryData(frontDeskTapeKey(propertyId, msg.fromDate, msg.toDate), …)` |
| P2 delta | Merge into cache at subscribed window key; board invalidate only; skip merge if no cache entry |
| P2 forbidden | `invalidateQueries({ queryKey: ['front-desk-tape'] })` on WS messages |
| P4 scope | Chunk in `TapeChartScreen`, `BoardScreen`, `ReservationsDirectoryScreen` only |
| G6/G9 | Tests T1–T10 fail on `main` before production edits |
| Optional I5 | Fix `BoardScreen` `PageHeader` title per mode **only if** touching that file — not required |

**Out of scope:** pms-core, new HTTP/commands, Playwright, PropertyDO, BoardSummary rebuild, ARI_KV, raising batch cap above 50, booking wizard / folio mutation keys.

---

## Sequencing gate

```
Task 1 (red SPA tests) → Task 2 (production SPA, green) → Task 3 (full CI + R0.6 tick)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T10). Task 2 makes all slice tests green. Task 3 runs full CI `checks` job + `pnpm test:local` and ticks roadmap.

---

## Task 1 — Failing SPA characterization tests (tests-only commit)

**Files:**
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/web-pms/src/shell/FrontOfficeLive.test.tsx`
- Modify: `apps/web-pms/src/screens/TapeChartScreen.test.tsx`
- Create: `apps/web-pms/src/guest-batch-chunked.test.ts`

**Interfaces:** none (tests only). Tests spy `queryClient.invalidateQueries`, `setQueryData`, and `postGuestsBatch` via `../client.js` mocks.

### Step 1 — T1/T2/T3: `CheckInScreen.test.tsx`

Extend `renderCheckIn` to return `{ client, invalidateSpy }` (pattern from `FolioScreen.test.tsx` ~110–124):

```tsx
function renderCheckIn() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/check-in/res_1']}>
        <Routes>
          <Route path="/check-in/:reservationId" element={<CheckInScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}
```

Add tests after existing cases:

```tsx
  it('57: check-in success invalidates board prefix', async () => {
    const { invalidateSpy } = renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    screen.getByTestId('check-in').click();
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
    });
  });

  it('58: assign-room success invalidates board prefix', async () => {
    assignRoom.mockResolvedValue({ ok: true });
    const { invalidateSpy } = renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /assign room/i })).toBeTruthy());
    screen.getByRole('button', { name: /assign room/i }).click();
    await waitFor(() => expect(assignRoom).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
    });
  });

  it('59: checked_in reservation disables check-in with reason', async () => {
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'checked_in',
      roomId: 'rm_1',
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/already in house/i)).toBeTruthy();
  });

  it('60: terminal reservation disables check-in with status label', async () => {
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'cancelled',
      roomId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cancelled/i)).toBeTruthy();
    expect(screen.getByText(/check-in is not available/i)).toBeTruthy();
  });
```

**Red on `main`:** T1 no board invalidate; T2 assign no invalidate; T3/T4 button enabled for `checked_in` / terminal.

### Step 2 — T4: `BoardScreen.test.tsx`

Add `assignRoom` is **not** needed. Extend `renderBoard` to optionally return `{ client, invalidateSpy }`, or wrap confirm test with a dedicated client:

```tsx
  it('61: confirm pending invalidates board not arrivals', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, reservationId: 'res_pend', status: 'pending' as const }],
      nextCursor: null,
    });
    getDepartures.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    getInHouse.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    postGuestsBatch.mockResolvedValue({ states: {} });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    confirmReservation.mockResolvedValue({ reservationId: 'res_pend', status: 'confirmed' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals?date=2026-08-13']}>
          <BoardScreen mode="arrivals" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/i })).toBeTruthy());
    screen.getByRole('button', { name: /^Confirm$/i }).click();
    await waitFor(() => expect(confirmReservation).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
      expect(keys).toContainEqual(['board']);
      expect(keys).not.toContainEqual(['arrivals']);
    });
  });
```

**Red on `main`:** invalidates `['arrivals']` only (~131 `BoardScreen.tsx`).

### Step 3 — T5: `FolioScreen.test.tsx`

Add after test 54 (~534–559):

```tsx
  it('62: checkout success invalidates board and reservation', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    const { invalidateSpy } = renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
      expect(keys.some((k) => k.includes('"reservation"'))).toBe(true);
    });
  });
```

**Red on `main`:** checkout invalidates `['reservation', …]` only (~772–774 `FolioScreen.tsx`).

### Step 4 — T6/T7/T8: rewrite `FrontOfficeLive.test.tsx`

**Replace** test ~121–133 “keeps tape cache” assertions:

```tsx
  it('snapshot then close shows watermark and keeps tape cache', async () => {
    const socket = createFakeSocket();
    const { client } = renderLive({ createSocket: () => socket });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
    const tapeKey = ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate] as const;
    expect(client.getQueryData(tapeKey)).toMatchObject({ rooms: snapshot.rooms });
    socket.close();
    await waitFor(() => expect(screen.getByTestId('stale-watermark')).toBeTruthy());
    expect(client.getQueryData(tapeKey)).toMatchObject({ rooms: snapshot.rooms });
  });
```

**Replace** test ~170–193 “delta and snapshot invalidate front-office query keys”:

```tsx
  it('snapshot and delta invalidate board only; snapshot uses full tape key', async () => {
    const socket = createFakeSocket();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setDataSpy = vi.spyOn(client, 'setQueryData');
    renderLive({ createSocket: () => socket, client });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(setDataSpy).toHaveBeenCalledWith(
      ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate],
      expect.objectContaining({ ok: true, rooms: snapshot.rooms }),
    );
    const snapKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(snapKeys).toContainEqual(['board']);
    expect(snapKeys).not.toContainEqual(['front-desk-tape']);
    expect(snapKeys).not.toContainEqual(['front-desk-summary']);
    expect(snapKeys).not.toContainEqual(['front-desk-directory']);
    expect(snapKeys).not.toContainEqual(['front-desk-available']);
    invalidateSpy.mockClear();

    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 2, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const deltaKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(deltaKeys).toEqual([['board']]);
  });

  it('delta merges removedBlockIds into cached tape without tape invalidation', async () => {
    const socket = createFakeSocket();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tapeKey = ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate] as const;
    client.setQueryData(tapeKey, {
      ok: true,
      fromDate: snapshot.fromDate,
      toDate: snapshot.toDate,
      asOf: 1,
      rooms: snapshot.rooms,
      blocks: [
        { reservationId: 'res_x', guestRef: 'g_x', status: 'checked_in', roomId: 'rm_101' },
        { reservationId: 'res_y', guestRef: 'g_y', status: 'confirmed', roomId: 'rm_101' },
      ],
      ooo: [],
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderLive({ createSocket: () => socket, client });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    invalidateSpy.mockClear();
    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 3, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => {
      const cached = client.getQueryData(tapeKey) as { blocks: Array<{ reservationId: string }> };
      expect(cached.blocks.map((b) => b.reservationId)).toEqual(['res_y']);
    });
    const deltaKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(deltaKeys).toEqual([['board']]);
    expect(deltaKeys).not.toContainEqual(['front-desk-tape']);
  });
```

**Red on `main`:** wrong key `['front-desk-tape']` (~135); broad `INVALIDATE_KEYS` (~34–40, ~145); no delta merge.

**Note:** `BoardScreen.test.tsx` ~350–393 “delta refetches arrivals” test expects WS-driven board refetch — that remains valid after P2 (board still invalidates). Do not delete; it is T11 regression.

### Step 5 — T9: `TapeChartScreen.test.tsx`

Add helper to build 51 blocks:

```tsx
function blocksWithGuestRefs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    reservationId: `res_${i}`,
    guestRef: `g_${i}`,
    status: 'checked_in' as const,
    roomId: 'rm_101',
    arrivalDate: '2026-08-13',
    departureDate: '2026-08-15',
  }));
}
```

Add test:

```tsx
  it('63: 51 guest refs chunk postGuestsBatch at 50', async () => {
    const blocks = blocksWithGuestRefs(51);
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-13', '2026-08-19'),
      rooms: [room],
      blocks,
    });
    postGuestsBatch.mockImplementation((_pid: string, refs: string[]) =>
      Promise.resolve({
        ok: true,
        guests: {},
        states: Object.fromEntries(
          refs.map((ref) => [ref, { kind: 'resolved' as const, displayName: `Guest ${ref}` }]),
        ),
      }),
    );
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => expect(postGuestsBatch.mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const call of postGuestsBatch.mock.calls) {
      expect((call[1] as string[]).length).toBeLessThanOrEqual(50);
    }
    await waitFor(() => {
      expect(screen.queryAllByText('Name pending').length).toBe(0);
    });
  });
```

**Red on `main`:** single call with 51 refs → HTTP would 400 → all “Name pending”.

### Step 6 — T10: `guest-batch-chunked.test.ts` (new unit)

Create file (implementation in Task 2; test imports the module — vitest will fail until Task 2 adds the module):

```ts
import { describe, expect, it (vi) } from 'vitest';
import { chunkGuestRefs, GUEST_BATCH_MAX } from './guest-batch-chunked.js';

describe('guest-batch-chunked', () => {
  it('GUEST_BATCH_MAX is 50', () => {
    expect(GUEST_BATCH_MAX).toBe(50);
  });

  it('chunkGuestRefs splits 51 into [50, 1]', () => {
    const refs = Array.from({ length: 51 }, (_, i) => `g_${i}`);
    expect(chunkGuestRefs(refs)).toEqual([refs.slice(0, 50), refs.slice(50, 51)]);
  });

  it('chunkGuestRefs dedupes preserving first occurrence order', () => {
    expect(chunkGuestRefs(['a', 'b', 'a', 'c'])).toEqual([['a', 'b', 'c']]);
  });

  it('chunkGuestRefs empty → []', () => {
    expect(chunkGuestRefs([])).toEqual([]);
  });
});
```

Fix import typo in implementer copy: `import { describe, expect, it } from 'vitest';`

### Step 7 — Run vitest; confirm red

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/CheckInScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/FrontOfficeLive.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/guest-batch-chunked.test.ts
```

- [ ] T1–T10 fail on current `main` for the asserted behaviour
- [ ] T10 may fail with “module not found” until Task 2 — acceptable in Task 1 if file exists with failing import
- [ ] Existing BoardScreen / TapeChart / CheckIn regression tests still pass (except tests rewritten in Step 4)
- [ ] Do **not** change production code in this task

### Step 8 — Commit (tests only)

```bash
git add \
  apps/web-pms/src/screens/CheckInScreen.test.tsx \
  apps/web-pms/src/screens/BoardScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/shell/FrontOfficeLive.test.tsx \
  apps/web-pms/src/screens/TapeChartScreen.test.tsx \
  apps/web-pms/src/guest-batch-chunked.test.ts
git commit -m "$(cat <<'EOF'
test(web-pms): desk freshness + tape cache characterization (red)

Add U1/U2/U3/Q5/P2/P4 SPA tests for board invalidate, check-in disable,
FrontOfficeLive tape key, and guest batch chunking. Fail on main.
EOF
)"
```

---

## Task 2 — Production SPA (mutations, FrontOfficeLive, chunk helper)

**Files:**
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` (~113–125, ~155–161, ~164–173, ~220–229)
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` (~121–132, ~458–460)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~747–775)
- Modify: `apps/web-pms/src/shell/FrontOfficeLive.tsx` (~34–40, ~84–88, ~126–145)
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` (~283–287)
- Modify: `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` (~228–232)
- Create: `apps/web-pms/src/guest-batch-chunked.ts`
- Create (optional): `apps/web-pms/src/front-office-query-keys.ts`

**Interfaces:**

```ts
// apps/web-pms/src/front-office-query-keys.ts (or local in FrontOfficeLive.tsx)
export function frontDeskTapeKey(
  propertyId: string,
  fromDate: string,
  toDate: string,
): readonly ['front-desk-tape', string, string, string];

// apps/web-pms/src/guest-batch-chunked.ts
export const GUEST_BATCH_MAX = 50 as const;

export function chunkGuestRefs(refs: string[]): string[][];

export async function fetchGuestStatesChunked(
  postGuestsBatch: (
    propertyId: string,
    refs: string[],
  ) => Promise<{ ok: true; states: Record<string, import('@hospai/client-core').GuestRowState> } | { ok: false; wholesaleFailure: true; states: Record<string, import('@hospai/client-core').GuestRowState> }>,
  propertyId: string,
  refs: string[],
): Promise<{ states: Record<string, import('@hospai/client-core').GuestRowState> }>;
```

### Step 1 — `guest-batch-chunked.ts`

```ts
import type { GuestRowState } from '@hospai/client-core';

export const GUEST_BATCH_MAX = 50 as const;

type BatchResult =
  | { ok: true; states: Record<string, GuestRowState> }
  | { ok: false; wholesaleFailure: true; states: Record<string, GuestRowState> };

export function chunkGuestRefs(refs: string[]): string[][] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    deduped.push(ref);
  }
  if (deduped.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < deduped.length; i += GUEST_BATCH_MAX) {
    chunks.push(deduped.slice(i, i + GUEST_BATCH_MAX));
  }
  return chunks;
}

export async function fetchGuestStatesChunked(
  postGuestsBatch: (propertyId: string, refs: string[]) => Promise<BatchResult>,
  propertyId: string,
  refs: string[],
): Promise<{ states: Record<string, GuestRowState> }> {
  const chunks = chunkGuestRefs(refs);
  if (chunks.length === 0) return { states: {} };
  const merged: Record<string, GuestRowState> = {};
  for (const chunk of chunks) {
    const result = await postGuestsBatch(propertyId, chunk);
    if (!result.ok) throw new Error('guest_batch_failed');
    Object.assign(merged, result.states);
  }
  return { states: merged };
}
```

- [ ] Sequential chunk calls (spec allows parallel or sequential; sequential is simpler and deterministic in tests)
- [ ] Any chunk failure throws — no partial merge

### Step 2 — Wire batch consumers

**TapeChartScreen.tsx** (~283–287):

```tsx
  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, tenant.propertyId, refs),
    enabled: refs.length > 0 && tapeQ.isSuccess,
    retry: false,
  });
```

**BoardScreen.tsx** (~458–460): same `queryFn` pattern.

**ReservationsDirectoryScreen.tsx** (~228–232): same `queryFn` pattern.

Import from `'../guest-batch-chunked.js'`.

### Step 3 — `CheckInScreen.tsx` U1 + U3

Add `useQueryClient` import and hook at top of component.

**Assign mutation** (~124):

```tsx
    onSuccess: () => {
      setMessage('Room assigned');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
```

**Check-in mutation** (~155–161):

```tsx
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Request queued — will apply when the property is reachable.');
        return;
      }
      setMessage('Checked in');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
```

**Disable logic** (~164–173, ~220–229):

```tsx
  const status = reservationQ.data?.status;
  const terminalOrInHouse =
    status != null &&
    (TERMINAL_STATUSES.has(status) || status === 'checked_in');
  const canCheckIn = !checkIn.isPending && !terminalOrInHouse;
```

Add Alert before `PageHeader` or inside card (match existing Alert usage on screen):

```tsx
      {status === 'checked_in' ? (
        <Alert>Guest is already in house.</Alert>
      ) : status != null && TERMINAL_STATUSES.has(status) ? (
        <Alert>
          This reservation is {reservationStatusLabel(status)} — check-in is not available.
        </Alert>
      ) : null}
```

Import `reservationStatusLabel` if not already in scope (used in badge ~203).

Optional: `title={!canCheckIn ? '…' : undefined}` on check-in button for a11y.

### Step 4 — `BoardScreen.tsx` Q5

Replace `ConfirmPendingButton` `onSuccess` (~130–132):

```tsx
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
```

Also wire `BoardScreen` batch query to `fetchGuestStatesChunked` (Step 2).

### Step 5 — `FolioScreen.tsx` U2

Inside checkout `onSuccess`, after existing reservation invalidation (~772–774), add board invalidate for **live** success path:

```tsx
      if (result.classified.class !== 'provisional') {
        void queryClient.invalidateQueries({ queryKey: ['board'] });
      }
```

Place alongside existing `['reservation', propertyId, reservationId]` call — do not remove folio/reservation invalidations on capture path.

### Step 6 — `FrontOfficeLive.tsx` P2

Add `frontDeskTapeKey` (prefer shared file `front-office-query-keys.ts`):

```ts
export function frontDeskTapeKey(
  propertyId: string,
  fromDate: string,
  toDate: string,
): readonly ['front-desk-tape', string, string, string] {
  return ['front-desk-tape', propertyId, fromDate, toDate] as const;
}
```

Add delta merge helper in same file:

```ts
import type { FrontOfficeDelta } from '@hospai/client-core';

type TapeCache = {
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: FrontOfficeSnapshot['rooms'];
  blocks: Array<Record<string, unknown>>;
  ooo: FrontOfficeSnapshot['ooo'];
};

function mergeTapeDelta(existing: TapeCache, msg: FrontOfficeDelta): TapeCache {
  const removedBlocks = new Set(msg.removedBlockIds ?? []);
  const removedOoo = new Set(msg.removedOooIds ?? []);
  let blocks = existing.blocks.filter(
    (b) => !removedBlocks.has(String((b as { reservationId?: string }).reservationId ?? '')),
  );
  let rooms = existing.rooms.filter((r) => true);
  let ooo = existing.ooo.filter((o) => !removedOoo.has(o.oooId));

  const upsertById = <T extends { roomId?: string; oooId?: string; reservationId?: string }>(
    list: T[],
    incoming: T[],
    idKey: keyof T,
  ) => {
    const map = new Map(list.map((row) => [String(row[idKey]), row]));
    for (const row of incoming) map.set(String(row[idKey]), row);
    return [...map.values()];
  };

  if (msg.rooms?.length) rooms = upsertById(rooms, msg.rooms, 'roomId');
  if (msg.blocks?.length) {
    blocks = upsertById(
      blocks as Array<{ reservationId: string } & Record<string, unknown>>,
      msg.blocks as Array<{ reservationId: string } & Record<string, unknown>>,
      'reservationId',
    );
  }
  if (msg.ooo?.length) ooo = upsertById(ooo, msg.ooo, 'oooId');

  return { ...existing, asOf: msg.asOf, rooms, blocks, ooo };
}
```

**Remove** `INVALIDATE_KEYS` and `invalidateFrontOffice` (~34–40, ~84–88).

Replace `onmessage` body (~126–145):

```tsx
      socket.onmessage = (ev) => {
        if (cancelled) return;
        const data = typeof ev.data === 'string' ? ev.data : '';
        const msg = parseFrontOfficeStreamMessage(data);
        if (!msg || (msg.type !== 'snapshot' && msg.type !== 'delta')) return;
        seenSnapshot.current = true;
        setAsOf(msg.asOf);
        setStale(false);

        if (msg.type === 'snapshot') {
          const key = frontDeskTapeKey(tenant.propertyId, msg.fromDate, msg.toDate);
          queryClient.setQueryData(key, {
            ok: true,
            fromDate: msg.fromDate,
            toDate: msg.toDate,
            asOf: msg.asOf,
            rooms: msg.rooms,
            blocks: msg.blocks,
            ooo: msg.ooo,
          });
        } else {
          const { fromDate, toDate } = windowRef.current;
          const key = frontDeskTapeKey(tenant.propertyId, fromDate, toDate);
          const cached = queryClient.getQueryData<TapeCache>(key);
          if (cached) {
            queryClient.setQueryData(key, mergeTapeDelta(cached, msg));
          }
        }

        void queryClient.invalidateQueries({ queryKey: ['board'] });
      };
```

- [ ] Import `tenant` already present (~11)
- [ ] Delta with no cache entry: skip merge; board invalidation still runs
- [ ] Do **not** invalidate `['front-desk-tape']`, summary, directory, or available

### Step 7 — Focused test run (must go green)

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/CheckInScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/FrontOfficeLive.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/guest-batch-chunked.test.ts
```

- [ ] T1–T10 green
- [ ] T11 BoardScreen WS delta refetch test (~350–393) still green

```bash
pnpm typecheck
pnpm lint
```

### Step 8 — Commit

```bash
git add \
  apps/web-pms/src/guest-batch-chunked.ts \
  apps/web-pms/src/front-office-query-keys.ts \
  apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/shell/FrontOfficeLive.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): desk freshness, tape cache key, guest batch chunking

Invalidate board on check-in, assign, confirm, checkout; disable check-in
for terminal/in-house; FrontOfficeLive tape key + delta merge; chunk batch 50.
EOF
)"
```

**Note:** Omit `front-office-query-keys.ts` from `git add` if helper is kept local in `FrontOfficeLive.tsx`.

---

## Task 3 — Full CI + tick R0.6

**Files:** `docs/roadmap.md` (R0.6 checkbox only)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/CheckInScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/FrontOfficeLive.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/guest-batch-chunked.test.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
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
pnpm check:spa-page-chrome
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
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green (unchanged — SPA-only slice)

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.6

In `docs/roadmap.md` line ~182, change:

```markdown
- [ ] **R0.6** Audit V6 — U1, U2, U3, Q5, G6, P2, P4, G9. ...
```

to:

```markdown
- [x] **R0.6** Audit V6 — U1, U2, U3, Q5, G6, P2, P4, G9. ...
```

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.6 after desk freshness + tape cache vertical

Full CI checks and pms-core shards green; audit U1/U2/U3/Q5/P2/P4/G6/G9 closed.
EOF
)"
```

---

## Test matrix (spec §5 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `CheckInScreen.test.tsx` | 1–2 | Check-in success → `['board']` | Yes |
| T2 | `CheckInScreen.test.tsx` | 1–2 | Terminal / `checked_in` disabled + reason | Yes |
| T3 | `CheckInScreen.test.tsx` | 1–2 | Assign success → `['board']` | Yes |
| T4 | `BoardScreen.test.tsx` | 1–2 | Confirm → `['board']`; not `['arrivals']` | Yes |
| T5 | `FolioScreen.test.tsx` | 1–2 | Checkout → `['board']` + `['reservation', …]` | Yes |
| T6 | `FrontOfficeLive.test.tsx` | 1–2 | Snapshot `setQueryData` full tape key | Yes |
| T7 | `FrontOfficeLive.test.tsx` | 1–2 | WS invalidate `['board']` only | Yes |
| T8 | `FrontOfficeLive.test.tsx` | 1–2 | Delta merge; no tape invalidation | Yes |
| T9 | `TapeChartScreen.test.tsx` | 1–2 | 51 refs → ≥2 batch calls, ≤50 each | Yes |
| T10 | `guest-batch-chunked.test.ts` | 1–2 | Chunk [50, 1]; dedupe | Yes |
| T11 | `BoardScreen.test.tsx` | 2 | WS delta still refetches board via invalidate | No (regression) |

---

## Success criteria (spec §10)

1. Check-in, assign-room, confirm-pending, checkout: clerk sees updated board **without** waiting for WS (**U1**, **U2**, **Q5**).
2. Check-in disabled for terminal and in-house with clear copy (**U3**).
3. WS snapshot seeds `['front-desk-tape', propertyId, from, to]`; deltas merge; WS does **not** invalidate tape (**P2**).
4. Tape/Board/Reservations directory with 51+ guests resolve names (chunked batch) (**P4**).
5. SPA tests T1–T10 fail on `main`, pass after fix (**G6**, **G9**).
6. `BoardSummary` / `get_front_desk_summary` unchanged; Hold = `PENDING`.
7. Catalog/route/schema pins unchanged.
8. `pnpm test:local` green.

---

## Manual verify (spec §12)

1. Check in from `/check-in/:id` → `/arrivals` updates immediately (no WS wait).
2. Confirm pending hold on arrivals board — row updates without refresh.
3. Check out from folio → `/in-house` no longer lists guest.
4. Open `/board` tape with 50+ occupied cells — guest names render (not all “Name pending”).
5. Tape tab A + check-in tab B — board lists update via WS; tape updates via delta merge (no full tape refetch loop).

---

## Plan vs codebase mismatches (reviewer)

| Item | Notes |
|---|---|
| `FrontOfficeLive` delta handling | **Not implemented on `main`** — only snapshot `setQueryData`; plan adds merge in Task 2 Step 6. |
| `FrontOfficeLive.test.tsx` ~170–193 | Test **locks the bug** (expects tape invalidation) — rewrite in Task 1 Step 4. |
| `guest-batch-chunked.ts` | **Does not exist** — create in Task 2; Task 1 test file may fail module resolution until then. |
| `fetchGuestStatesChunked` return shape | Batch queries expect `{ states }` — helper returns `{ states }` even though `postGuestsBatch` returns `{ ok, guests, states }`. |
| Check-in Alert copy | Spec allows Alert or muted line — plan uses Alert to match existing screen patterns. |
| I5 BoardScreen title | Optional; `BoardScreen.test.tsx` ~243–261 expects “Front Desk” h1 — do **not** change title in this slice unless explicitly doing I5 (would break test). |
| 2026-08-13 tape spec §8 | **Superseded** for WS invalidation list — this plan invalidates `['board']` only per approved R0.6 spec. |
