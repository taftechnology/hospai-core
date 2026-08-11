# Booking Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Front-desk booking wizard (`/book`) that creates guests + reservations against existing HTTP, with Task 0 catalog/`check:degraded` rails and client-core availability/create methods.

**Architecture:** Task 0 makes `availability.changed ⇒ FAIL_CLOSED` mechanical and shares inventory notes. client-core adds Branch-2-only `getAvailability`, `createGuest`, `createReservation` (always `quoteAriVersion`; booking opId via `stableKeyForOperation`). web-pms ships Nav Book → wizard (type-only, quantity-only, create-default guest + context `?guestRef=`) → arrivals dated board + banner. No server route changes.

**Tech Stack:** `@hospai/contracts` catalog; `scripts/degraded-check.mjs`; `@hospai/client-core`; web-pms React Query + Authority / StaffRoute pattern; Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` (locks Approach 2)
- **No client fingerprint helper** — opId composition only: `book:${reservationId}:${roomTypeId}:${arrivalDate}:${departureDate}:${guestRef}`
- **`quoteAriVersion` always sent** on create (omit → silent metric zero)
- **`getAvailability` has no `roomTypeId` param** (Branch 2 only — deliberate)
- Branch on **`body.error`**, never HTTP status alone (`no_availability` and `idempotency_key_reused` are both 409)
- Session: mint `reservationId` (+ create-path `guestId`) **once on wizard mount**; reuse across retries
- Confirm enabled iff `quoteAriVersion != null && roomTypeId != null && guestResolved`
- Quantity-only — no prices / quoteStay / rate plan
- Type-only — no `assign_room` in wizard
- Stay → availability: `fromDate = arrival`, `toDate = departure − 1` (calendar-part arithmetic)
- Rebuild `@hospai/contracts` before `check:degraded`; rebuild `@hospai/client-core` before web-pms tests (`dist` resolution)
- Do **not** touch `pms-core-test-dates-check.mjs` (leftover #9 explicitly out)
- Do **not** “fix” `BoardScreen` `todayUtc()` seed (leftover #3)

### Mutation canaries (plan expects tests to kill)

| Mutation | Expected kill |
|---|---|
| Drop `quoteAriVersion` from create body | client-core body assert |
| Add `roomTypeId` query to `getAvailability` | client-core query assert |
| Drop `roomTypeId` from booking opId | same-type 409 key-reuse / opId tests |
| Re-mint `reservationId` on retry | session-id screen test |
| Treat all 409 as `no_availability` | `idempotency_key_reused` must not re-read |
| Confirm enabled on quote alone | conjunction test |
| Flip create → `QUEUE_PROVISIONAL` | `check:degraded` exit 1 |

---

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | `INVENTORY_FAIL_CLOSED_NOTES`; create/modify/cancel/no_show |
| `scripts/degraded-check.mjs` | `availability.changed ⇒ FAIL_CLOSED` |
| `packages/client-core/src/booking.ts` | `bookingReservationOpId`, stay→availability range, selectable types, night-count cap |
| `packages/client-core/src/api.ts` | `getAvailability`, `createGuest`, `createReservation` |
| `packages/client-core/src/index.ts` | Re-exports |
| `packages/client-core/test/booking.test.ts` | Pure booking helpers |
| `packages/client-core/test/api.test.ts` | Wire asserts for new methods |
| `apps/web-pms/src/shell/nav.ts` | Book nav entry |
| `apps/web-pms/src/screens/BookRoute.tsx` | `reservations:write` gate |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Wizard |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | Wizard behaviours |
| `apps/web-pms/src/screens/BoardScreen.tsx` | `?date=` seed + created banner; Book-for-guest link |
| `apps/web-pms/src/App.tsx` | `/book` route |
| `apps/web-pms/src/screens/FolioScreen.tsx` / `CheckInScreen.tsx` | Optional Book-for-guest link |

---

### Task 1: Catalog — `INVENTORY_FAIL_CLOSED_NOTES`

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/register.test.ts` (constant-identity assert only — mirror guests notes pattern)

**Interfaces:**
- Produces: `export const INVENTORY_FAIL_CLOSED_NOTES = 'Inventory-affecting — must not invent stock during outage.'`
- Consumes: none

- [ ] **Step 1: Failing test** — in `register.test.ts` (near guests notes equality):

```ts
import { COMMAND_CATALOG, INVENTORY_FAIL_CLOSED_NOTES } from './commands/catalog.js';

it('inventory-affecting reservation commands share INVENTORY_FAIL_CLOSED_NOTES', () => {
  for (const id of [
    'reservations.create',
    'reservations.modify',
    'reservations.cancel',
    'reservations.no_show',
  ] as const) {
    expect(COMMAND_CATALOG.find((c) => c.id === id)?.notes).toBe(INVENTORY_FAIL_CLOSED_NOTES);
  }
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @hospai/contracts test -- register.test.ts
```

Expected: FAIL (constant missing / notes still inline literals not `===` constant).

- [ ] **Step 3: Implement** — after `PROPERTY_UPDATE_DETAILS_FAIL_CLOSED_NOTES`:

```ts
export const INVENTORY_FAIL_CLOSED_NOTES =
  'Inventory-affecting — must not invent stock during outage.';
```

Set `notes: INVENTORY_FAIL_CLOSED_NOTES` on `reservations.create`, `reservations.modify`, `reservations.cancel`, `reservations.no_show` (replace inline strings on cancel/no_show; add field on create/modify).

- [ ] **Step 4: Run** — green.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/register.test.ts
git commit -m "feat(contracts): share INVENTORY_FAIL_CLOSED_NOTES on create/modify/cancel/no_show"
```

---

### Task 2: `check:degraded` — `availability.changed ⇒ FAIL_CLOSED`

**Files:**
- Modify: `scripts/degraded-check.mjs`

**Interfaces:**
- Consumes: `COMMAND_CATALOG` from built contracts
- Produces: check fails if any `availability.changed` emitter is not `FAIL_CLOSED` (no opt-out list)

- [ ] **Step 1: Add rule** before the final `if (failed)` block in `degraded-check.mjs`:

```js
for (const entry of COMMAND_CATALOG) {
  if (!entry.events?.includes('availability.changed')) continue;
  if (entry.degraded !== 'FAIL_CLOSED') {
    console.error(
      `Command ${entry.id} emits availability.changed but degraded=${entry.degraded} (must be FAIL_CLOSED)`,
    );
    failed = true;
  }
}
```

- [ ] **Step 2: Run green baseline**

```bash
pnpm check:degraded
```

Expected: `check:degraded OK`

- [ ] **Step 3: Mutation proof** — temporarily set `reservations.create` `degraded: 'QUEUE_PROVISIONAL'`, rebuild contracts, run `pnpm check:degraded` → exit 1 with the new message. **Restore** create to `FAIL_CLOSED`. Re-run → OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/degraded-check.mjs
git commit -m "ci: require FAIL_CLOSED for availability.changed catalog emitters"
```

---

### Task 3: client-core booking helpers

**Files:**
- Create: `packages/client-core/src/booking.ts`
- Create: `packages/client-core/test/booking.test.ts`
- Modify: `packages/client-core/src/index.ts` — export helpers

**Interfaces:**

```ts
export const MAX_AVAILABILITY_INCLUSIVE_NIGHTS = 90; // wire: toDate <= fromDate + 89

export function bookingReservationOpId(input: {
  reservationId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  guestRef: string;
}): string;
// → `book:${reservationId}:${roomTypeId}:${arrivalDate}:${departureDate}:${guestRef}`

export function availabilityRangeForStay(
  arrivalDate: string,
  departureDate: string,
): { fromDate: string; toDate: string };
// fromDate = arrival; toDate = departure − 1 (UTC Y-M-D part arithmetic)

export function stayNightsExceedAvailabilityCap(
  arrivalDate: string,
  departureDate: string,
): boolean;
// true when inclusive night count > 90 (or invalid range)

export type AvailabilityItem = {
  roomTypeId: string;
  stayDate: string;
  free: number;
};

export function selectableRoomTypeIds(
  items: AvailabilityItem[],
  fromDate: string,
  toDate: string,
): string[];
// types where every stayDate in [fromDate, toDate] inclusive has free >= 1
```

- [ ] **Step 1: Failing tests** in `booking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  availabilityRangeForStay,
  bookingReservationOpId,
  selectableRoomTypeIds,
  stayNightsExceedAvailabilityCap,
} from '../src/booking.js';

describe('bookingReservationOpId', () => {
  it('includes roomTypeId so type change remints', () => {
    const a = bookingReservationOpId({
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    });
    const b = bookingReservationOpId({
      reservationId: 'r1',
      roomTypeId: 'rt_b',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    });
    expect(a).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1');
    expect(a).not.toBe(b);
  });
});

describe('availabilityRangeForStay', () => {
  it('maps half-open stay to inclusive availability', () => {
    expect(availabilityRangeForStay('2026-08-11', '2026-08-14')).toEqual({
      fromDate: '2026-08-11',
      toDate: '2026-08-13',
    });
  });
  it('one-night stay is a single inclusive day', () => {
    expect(availabilityRangeForStay('2026-08-11', '2026-08-12')).toEqual({
      fromDate: '2026-08-11',
      toDate: '2026-08-11',
    });
  });
});

describe('stayNightsExceedAvailabilityCap', () => {
  it('91 inclusive nights exceeds', () => {
    // arrival + 91 days departure → 91 nights
    expect(stayNightsExceedAvailabilityCap('2026-01-01', '2026-04-02')).toBe(true);
  });
  it('90 inclusive nights ok', () => {
    expect(stayNightsExceedAvailabilityCap('2026-01-01', '2026-04-01')).toBe(false);
  });
});

describe('selectableRoomTypeIds', () => {
  it('requires free>=1 every night', () => {
    const items = [
      { roomTypeId: 'rt_ok', stayDate: '2026-08-11', free: 1 },
      { roomTypeId: 'rt_ok', stayDate: '2026-08-12', free: 1 },
      { roomTypeId: 'rt_bad', stayDate: '2026-08-11', free: 1 },
      { roomTypeId: 'rt_bad', stayDate: '2026-08-12', free: 0 },
    ];
    expect(selectableRoomTypeIds(items, '2026-08-11', '2026-08-12')).toEqual(['rt_ok']);
  });
});
```

Verify the 90/91 fixtures against `availabilityRangeForStay` + inclusive count before locking dates (adjust if off-by-one). Cap rule: inclusive nights in `[fromDate, toDate]` must be ≤ 90 (`toDate <= fromDate + 89`).

- [ ] **Step 2: Run** — red.

```bash
pnpm --filter @hospai/client-core test -- booking.test.ts
```

- [ ] **Step 3: Implement** `booking.ts` using `Date.UTC` / `setUTCDate` only (same discipline as `enumerateStayDates` / `previousIsoDate`). Export from `index.ts`.

- [ ] **Step 4: Run** — green.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/booking.ts packages/client-core/test/booking.test.ts packages/client-core/src/index.ts
git commit -m "feat(client-core): booking stay range, opId, and selectable types"
```

---

### Task 4: client-core API — availability / guest / reservation

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `packages/client-core/test/api.test.ts`
- Modify: `packages/client-core/src/index.ts` — export any new types

**Interfaces:**

```ts
export type AvailabilityRead = {
  propertyId: string;
  fromDate: string;
  toDate: string;
  ariVersion: number;
  source: 'kv' | 'do';
  cache: 'hit' | 'miss';
  items: Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    free: number;
  }>;
};

// createClient methods:
getAvailability(propertyId: string, range: { fromDate: string; toDate: string }): Promise<AvailabilityRead>
// GET /v1/properties/:id/availability?fromDate&toDate — NEVER append roomTypeId

createGuest(
  propertyId: string,
  input: { guestId: string; displayName: string; email?: string; phone?: string },
  opId: string,
): Promise<unknown>
// POST body: { ...input, idempotencyKey: stableKeyForOperation(opId, keyStore) }

createReservation(
  propertyId: string,
  input: {
    reservationId: string;
    roomTypeId: string;
    guestRef: string;
    arrivalDate: string;
    departureDate: string;
    quoteAriVersion: number; // required in type — not optional
  },
  opId: string,
): Promise<unknown>
// POST body always includes quoteAriVersion + idempotencyKey from stableKeyForOperation(opId, keyStore)
// Caller should pass opId = bookingReservationOpId({...input fields})
```

Failures throw `ClassifiedError` with `classified.body` carrying wire fields (`error`, `date`, `ariVersion`, `rule`, `required`, …).

- [ ] **Step 1: Failing tests** in `api.test.ts`:

```ts
it('getAvailability omits roomTypeId from query', async () => {
  let path = '';
  const client = createClient({
    transport: mockTransport((p) => {
      path = p;
      return new Response(
        JSON.stringify({
          propertyId: 'p',
          fromDate: '2026-08-11',
          toDate: '2026-08-11',
          ariVersion: 3,
          source: 'do',
          cache: 'miss',
          items: [],
        }),
        { status: 200 },
      );
    }),
    queued: createQueuedCommandLog(),
    entitlements: /* same stub as other tests */,
    keyStore: new Map(),
  });
  await client.getAvailability('p', { fromDate: '2026-08-11', toDate: '2026-08-11' });
  expect(path).toContain('fromDate=2026-08-11');
  expect(path).not.toMatch(/roomTypeId/);
});

it('createReservation always sends quoteAriVersion and reuses key for same opId', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = createClient({
    transport: mockTransport((_p, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: false, error: 'no_availability', date: '2026-08-11', ariVersion: 9 }), {
        status: 409,
      });
    }),
    queued: createQueuedCommandLog(),
    entitlements: /* stub */,
    keyStore: new Map(),
  });
  const input = {
    reservationId: 'r1',
    roomTypeId: 'rt_a',
    guestRef: 'g1',
    arrivalDate: '2026-08-11',
    departureDate: '2026-08-12',
    quoteAriVersion: 7,
  };
  const opId = bookingReservationOpId(input);
  await expect(client.createReservation('p', input, opId)).rejects.toBeInstanceOf(ClassifiedError);
  await expect(client.createReservation('p', input, opId)).rejects.toBeInstanceOf(ClassifiedError);
  expect(bodies[0]?.quoteAriVersion).toBe(7);
  expect(bodies[1]?.quoteAriVersion).toBe(7);
  expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);

  const opIdB = bookingReservationOpId({ ...input, roomTypeId: 'rt_b' });
  await expect(
    client.createReservation('p', { ...input, roomTypeId: 'rt_b' }, opIdB),
  ).rejects.toBeInstanceOf(ClassifiedError);
  expect(bodies[2]?.idempotencyKey).not.toBe(bodies[0]?.idempotencyKey);
});
```

- [ ] **Step 2: Run** — red.

```bash
pnpm --filter @hospai/client-core test -- api.test.ts
```

- [ ] **Step 3: Implement** methods on `createClient` return object. Comment above `getAvailability`:

```ts
// Deliberately no roomTypeId — booking quotes must use DO ariVersion (Branch 2), not KV min.
```

`createGuest` / `createReservation` put `idempotencyKey` in JSON body (match `handlePostGuests` / `handlePostReservations`).

- [ ] **Step 4: Run** — green. Build package:

```bash
pnpm --filter @hospai/client-core build
```

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/test/api.test.ts packages/client-core/src/index.ts
git commit -m "feat(client-core): getAvailability, createGuest, createReservation"
```

---

### Task 5: Nav + BookRoute + App route

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Create: `apps/web-pms/src/screens/BookRoute.tsx`
- Create: `apps/web-pms/src/screens/BookRoute.test.tsx`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts` — include Book in filterNavEntries cases if needed

**Interfaces:**
- Consumes: `hasPropertyPermission`, `meShellStateFromQuery` (StaffRoute shape)
- Produces: nav entry `{ id: 'book', label: 'Book', path: '/book', permission: 'reservations:write' }`; `/book` mounts `BookRoute` → placeholder or `BookingScreen` (wire empty screen OK until Task 6)

- [ ] **Step 1: Failing tests**

`BookRoute.test.tsx` — mirror `StaffRoute.test.tsx`: live me without `reservations:write` → Navigate to `/arrivals`; with write → renders outlet/child; unknown authority → fail-open render.

`me.test.ts` — `filterNavEntries` with live staff (has `reservations:write`) includes Book; fabricated me lacking write excludes it.

- [ ] **Step 2: Run**

```bash
pnpm --filter @hospai/web-pms test -- BookRoute.test.ts me.test.ts
```

Expected: red.

- [ ] **Step 3: Implement** nav entry, `BookRoute` (copy StaffRoute; permission `reservations:write`; child `BookingScreen` stub that returns `<p>Book</p>` if screen not ready), App route `path="book" element={<BookRoute />}`.

- [ ] **Step 4: Run** — green.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/screens/BookRoute.tsx apps/web-pms/src/screens/BookRoute.test.tsx apps/web-pms/src/App.tsx apps/web-pms/src/auth/me.test.ts
git commit -m "feat(web-pms): Book nav gated on reservations:write"
```

---

### Task 6: BookingScreen — happy path (dates → types → guest → confirm)

**Files:**
- Create: `apps/web-pms/src/screens/BookingScreen.tsx`
- Create: `apps/web-pms/src/screens/BookingScreen.test.tsx`
- Modify: `BookRoute.tsx` — render `BookingScreen`

**Interfaces:**
- Consumes: `api.getAvailability`, `api.createGuest`, `api.createReservation`, `api.postGuestsBatch`, `bookingReservationOpId`, `availabilityRangeForStay`, `selectableRoomTypeIds`, `stayNightsExceedAvailabilityCap`, `propertyLocalToday`, `usePropertyTimeZone`
- Produces: wizard UI; on success `navigate(\`/arrivals?date=${arrivalDate}\`, { state: { createdReservationId } })`

**State (mint once):**

```ts
const [reservationId] = useState(() => crypto.randomUUID());
const [guestId] = useState(() => crypto.randomUUID()); // unused when contextGuestRef set
const contextGuestRef = useSearchParams()[0].get('guestRef');
```

Defaults when `timeZone` known: `arrival = propertyLocalToday(timeZone)`, `departure = add one calendar day` (reuse helper from client-core or local `addCalendarDays` with UTC parts — **not** `todayUtc` / local `new Date(y,m,d)`).

**Availability query:**

```ts
const range = availabilityRangeForStay(arrival, departure);
const availQ = useQuery({
  queryKey: ['availability', propertyId, range.fromDate, range.toDate],
  queryFn: () => api.getAvailability(propertyId, range),
  enabled: !!timeZone && !stayNightsExceedAvailabilityCap(arrival, departure),
  retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
  retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
});
const quoteAriVersion = availQ.isSuccess ? availQ.data.ariVersion : null;
const selectable = availQ.isSuccess
  ? selectableRoomTypeIds(availQ.data.items, range.fromDate, range.toDate)
  : [];
```

**Confirm enabled:** `quoteAriVersion != null && roomTypeId != null && guestResolved`.

**Commit:**

```ts
const guestRef = contextMode ? contextGuestRef! : guestId;
if (!contextMode && !guestCreated) {
  await api.createGuest(propertyId, { guestId, displayName, email?, phone? }, `guest:${guestId}`);
  setGuestCreated(true);
}
const opId = bookingReservationOpId({ reservationId, roomTypeId, arrivalDate, departureDate, guestRef });
await api.createReservation(propertyId, { reservationId, roomTypeId, guestRef, arrivalDate, departureDate, quoteAriVersion }, opId);
```

- [ ] **Step 1: Failing tests** (core set):

1. Defaults use property-local today / +1 under mocked `usePropertyTimeZone: () => 'UTC'` with fixed `Date` if needed — assert arrival input value.
2. 91-night stay: assert `getAvailability` **not** called; local error shown.
3. Confirm disabled when quote null (avail error after retries) / when no type selected / when displayName empty on create path.
4. Successful read with zero selectable: copy matching “No room types available for these dates”; Confirm disabled.
5. Happy path: mock avail with one type free → select → fill guest → confirm → `createGuest` then `createReservation` with `quoteAriVersion`; navigate to `/arrivals?date=...` with state.
6. Context `?guestRef=g1`: batch hydrate; **no** `createGuest`; createReservation `guestRef=g1`.

- [ ] **Step 2: Run** — red.

```bash
pnpm --filter @hospai/web-pms test -- BookingScreen.test.tsx
```

- [ ] **Step 3: Implement** `BookingScreen` (dates step, type list labeled with `roomTypeId`, guest form / context banner, Confirm). Wire `BookRoute` → `BookingScreen`.

- [ ] **Step 4: Run** — green.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx apps/web-pms/src/screens/BookingScreen.test.tsx apps/web-pms/src/screens/BookRoute.tsx
git commit -m "feat(web-pms): booking wizard happy path"
```

---

### Task 7: Commit rejection matrix + 409 key reuse

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx`
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx`

**Interfaces:**
- Consumes: `ClassifiedError.classified.body` — **always** read `body.error` (never status alone)
- Produces: recovery behaviours per spec §2.4

Helper (keep in screen file or tiny `booking-commit.ts`):

```ts
function reservationCommitError(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return null;
}
```

| `body.error` | Behaviour |
|---|---|
| `no_availability` | Show `date`; clear `roomTypeId`; invalidate/refetch availability; keep dates/guest/ids |
| `idempotency_key_reused` | Generic failure; **do not** refetch avail; **do not** clear selection |
| `restriction_violated` | Show rule/date/required; do not clear type as sold-out |
| `unbookable` | Show date; point at dates |
| `not_found` | Clear selection; refetch types; no auto-retry same type |
| guest errors on context hydrate | Clear `guestRef` mode → create form |

- [ ] **Step 1: Failing tests**

1. **Same-type 409 key reuse (load-bearing):** mock first `createReservation` → 409 `no_availability` with `date` + `ariVersion`; after UI clears type and re-read returns new `ariVersion`, re-select **same** `roomTypeId`, confirm again → assert **identical** `idempotencyKey` on both POST bodies; assert second body `quoteAriVersion` is the **new** read’s version.
2. Different-type after 409 → different `idempotencyKey`.
3. Session ids: after guest create success + reservation 409, retry does not call `createGuest` again with a new id (same `guestId` in body).
4. `idempotency_key_reused` 409 → `getAvailability` call count does not increase; selection uncleared; generic error shown.
5. Context hydrate `guest_already_erased` / missing guest → falls back to create form.

- [ ] **Step 2: Run** — red.

- [ ] **Step 3: Implement** mutation `onError` branching on `reservationCommitError(classified.body)`.

- [ ] **Step 4: Run** — green.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx apps/web-pms/src/screens/BookingScreen.test.tsx
git commit -m "feat(web-pms): booking commit rejection matrix and 409 key reuse"
```

---

### Task 8: Arrivals `?date=` + banner + Book-for-guest links

**Files:**
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (+ test if present)
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` (optional same link)

**Interfaces:**
- Consumes: `useSearchParams`, `useLocation` 
- Produces: arrivals date from `?date=` when valid `YYYY-MM-DD`; one-shot banner from `location.state.createdReservationId`; link `Book for guest` → `/book?guestRef=`

- [ ] **Step 1: Failing tests**

1. Render `BoardScreen` mode arrivals with `MemoryRouter` initial `'/arrivals?date=2026-09-14'` + state `{ createdReservationId: 'res_x' }` → date input/query uses `2026-09-14`; banner shows `res_x`.
2. Banner clears after show (second render / navigate without state → no banner) — e.g. `replace` state clear in `useEffect`.
3. Row with `guestRef` shows link to `/book?guestRef=g1`.

- [ ] **Step 2: Run** — red.

- [ ] **Step 3: Implement**

```ts
const [params] = useSearchParams();
const location = useLocation();
const dateParam = params.get('date');
const [date, setDate] = useState(() =>
  dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayUtc(),
);
// Banner:
const createdId = (location.state as { createdReservationId?: string } | null)?.createdReservationId;
useEffect(() => {
  if (!createdId) return;
  // show banner; then navigate('.', { replace: true, state: {} }) to clear
}, [createdId]);
```

Do **not** change the `todayUtc()` fallback to `propertyLocalToday` (leftover #3).

Add Book-for-guest link next to Folio/Check-in where `guestRef` is on the row.

- [ ] **Step 4: Run** — green.

```bash
pnpm --filter @hospai/web-pms test -- BoardScreen.test.tsx BookingScreen.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/BoardScreen.test.tsx apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/CheckInScreen.tsx
git commit -m "feat(web-pms): arrivals date query, created banner, book-for-guest"
```

---

### Task 9: Spec status + acceptance sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` — Status → Accepted — implemented (or “plan at …” while landing; flip to implemented when Tasks 1–8 merged)

- [ ] **Step 1: Run full relevant checks**

```bash
pnpm --filter @hospai/contracts test
pnpm check:degraded
pnpm --filter @hospai/client-core test
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms test
```

- [ ] **Step 2: Tick acceptance** in spec §6 mentally against canaries; leave leftovers §7 untouched as open.

- [ ] **Step 3: Commit** docs status if changed.

```bash
git add docs/superpowers/specs/2026-08-11-booking-wizard-design.md
git commit -m "docs: mark booking wizard design implemented"
```

(Only after Tasks 1–8 are on the branch.)

---

## Self-review (author)

**Spec coverage:** Task 0 → T1–T2; client methods → T3–T4; wizard → T5–T7; arrivals/context → T8; leftovers explicitly not tasked. Confirm conjunction, `idempotency_key_reused`, zero-selectable, 90-night, context guest error, session ids, Branch-2 quote — covered in T6–T7.

**Placeholders:** none intentional.

**Type consistency:** `bookingReservationOpId` / `AvailabilityRead` / `quoteAriVersion: number` required on create input — same names across T3–T7.
