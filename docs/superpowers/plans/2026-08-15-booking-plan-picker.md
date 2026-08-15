# Booking plan picker (priced wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`.

**Goal:** Wire the booking wizard to sell non-BAR rate plans — SPA plan picker + client-side quote from selected plan, honest `ratePlanId` on create + idempotency fingerprints, HTTP `RATE_MISSING` with `date` — **no** schema migration, catalog command, or new HTTP route.

**Architecture:** Reuse `GET /rate-plans`, `GET /rate-days`, and existing `POST /reservations` `ratePlanId?`. Client sums `listRateDays` for every stay night; all three book buttons gate on `stayQuoteMinor != null`. `bookingReservationOpId` and `handlePostReservations` fingerprint always normalize plan to `ratePlanId ?? 'BAR'`. PropertyDO create/snapshot behaviour is already correct — this chunk is SPA + client + dispatch honesty only.

**Tech Stack:** `@hospai/client-core` (`booking.ts`, `api.ts`), `apps/pms-core` `v1-dispatch.ts`, web-pms RTL (`BookingScreen.tsx`), vitest Worker HTTP (`reservations-routes.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` (Approved at `093f042` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes booking-wizard leftover **1**, reservation-lifecycle leftover **6**, property-setup leftover **24**. Bidirectional pointer sentences land in **Task 4 only**.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length stays **81** | New catalog id / audit writer |
| `AUDIT_WRITER_COMMAND_IDS.size` stays **56** | Schema migration (`PROPERTY_SCHEMA_HEAD` stays **30**) |
| HTTP `[133] post_folio_reconcile_payment` last; `[132]`/`[131]`/`[128]`/`[127]` unmoved | New V1 HTTP route; `GET /quote` |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | OrgDO plans; plan-scoped restrictions |
| Priced wizard + plan picker on `/book` | Modify-reservation plan change; promo; tax in quote |
| — | Ticking Tasks 1–3 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **81**. `AUDIT_WRITER_COMMAND_IDS.size` **56**. HTTP `[133] post_folio_reconcile_payment` last; `[132] delete_room` / `[131] post_folio_routing_rule_archive` / `[128] post_folio_stay_discount` / `[127] post_demo_seed` **unmoved**. `PROPERTY_SCHEMA_HEAD` **30**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — Reuse existing routes (spec Lock 1)

**Locked:** No new catalog id, HTTP route, schema migration, OrgDO, or night-audit step. Quote = client-side sum of `listRateDays` `amountMinor` for half-open `[arrival, departure)`. Do **not** call PropertyDO `quoteStay` over HTTP.

### D3 — SPA plan picker + quote gates (spec Locks 2–4)

**Locked:** `api.listRatePlans(propertyId)` on mount (`RatesScreen` query-key pattern ~192–195). Native `<select>` in `Field`, `data-testid="rate-plan"`. Label exactly `{name} ({code})`. Default `'BAR'` if in list; else first plan (`ORDER BY code`). Empty list → copy **"No active rate plans."** and disable `confirm-book`, `hold-book`, `quote-book`. Date change clears room type (~381–397); plan change does **not**. `ratesQ.queryKey` includes selected `ratePlanId`; `ratesQ.enabled` requires non-empty selected `ratePlanId`. Incomplete quote copy: **"No published rate for every night of this stay on this plan."** `quoteComplete = stayQuoteMinor != null` gates all three buttons (Confirm/Hold also need existing ARI/guest/party preconditions).

### D4 — Client + idempotency (spec Locks 5–6)

**Locked:** `createReservation` input + JSON `ratePlanId` when wizard has selection. `bookingReservationOpId` trailing segment `:${ratePlanId ?? 'BAR'}`. `handlePostReservations` fingerprint always `ratePlanId: body.ratePlanId ?? 'BAR'`. `commandPayload` spread unchanged — omit key when undefined so DO default `BAR` applies.

### D5 — HTTP errors + SPA copy (spec Lock 7)

**Locked:** Explicit `RATE_MISSING` branch in `handlePostReservations` → **422** `{ ok: false, error, date }` (mirror `UNBOOKABLE` ~1826–1828). Add `RATE_MISSING` to **422 list** in `mapReservationCommandErrorStatus` (~284–347). Import `RATE_MISSING` in `v1-dispatch.ts` (not imported today ~1–80). SPA copy: `rate_plan_not_found` → **"Rate plan unavailable — pick another plan."**; `rate_missing` → **"No rate on {date} for this plan — pick another plan or set rates."**

### D6 — Test / CI discipline (spec Lock 9)

**Locked:** File-filter vitest. **No `vi.spyOn` into DO isolate.** Rebuild `@hospai/client-core` before web-pms tests (Task 3). Rebuild `@hospai/contracts` before pms-core tests if dispatch imports change (Task 2). `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D7 — Reviewer workflow + test fixture (Important)

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. Bidirectional pointers — **Task 4 only**. **BookingScreen.test.tsx `beforeEach`:** after Lock 4, default `listRateDays` mock must return a complete night row for the seeded 1-night stay (arrival `2026-08-11`, departure `2026-08-12` unless test overrides). Keep/add dedicated incomplete-nights case (Lock 9 item 4). Mock `api.listRatePlans` in the mock module (~7–34).

---

## Global Constraints

- **`COMMAND_CATALOG` length stays 81** — extend client/dispatch only; no new command.
- **`PROPERTY_SCHEMA_HEAD` stays 30** — no migration.
- **HTTP route list unchanged** — last `[133] post_folio_reconcile_payment`.
- **Quote = client-side ROOM nightly sum** — not tax-inclusive; no `GET /quote`.
- **Fingerprint always includes normalized plan** — `body.ratePlanId ?? 'BAR'` on wire and opId.
- **All three book buttons gated on complete quote** — `stayQuoteMinor != null`.
- **Exact copy strings:** empty plans **"No active rate plans."**; incomplete quote **"No published rate for every night of this stay on this plan."**; `rate_plan_not_found` **"Rate plan unavailable — pick another plan."**; `rate_missing` **"No rate on {date} for this plan — pick another plan or set rates."**; picker labels `{name} ({code})`; `data-testid="rate-plan"`.
- **Scope-out (forbidden all tasks):** promo; invoices; city ledger; split collapse; `update_extras`; modify plan change; `GET /quote`; plan-scoped restrictions; OrgDO plans; night-audit growth; moving `[133]`/`[132]`/`[131]`/`[128]`/`[127]`; schema migration; new catalog command; `CLASS_DENYLIST`; push; tax in quote; ticking Tasks 1–3 living boxes.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/client-core/src/booking.ts` | `bookingReservationOpId` + trailing plan segment | 1 |
| `packages/client-core/src/api.ts` | `createReservation` input + JSON `ratePlanId` | 1 |
| `packages/client-core/test/booking.test.ts` | OpId cases Lock 9 | 1 |
| `packages/client-core/test/api.test.ts` | JSON body case Lock 9 | 1 |
| `apps/pms-core/src/v1-dispatch.ts` | Fingerprint + `RATE_MISSING` branch + 422 map | 2 |
| `apps/pms-core/test/reservations-routes.spec.ts` | HTTP create + fingerprint + `rate_missing` Lock 9 | 2 |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Plan picker, quote, gates, error copy Locks 2–5, 7 | 3 |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | RTL Lock 9 (+ reviewer fixture fix) | 3 |
| `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` | Close §7 leftover **1** ~287 | 4 |
| `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` | Close §19 leftover **6** ~854 | 4 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close §19 leftover **24** ~561 | 4 |
| `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` | Tick §6 checklist | 4 |
| `docs/superpowers/plans/2026-08-15-booking-plan-picker.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `property-migrations.ts`, `catalog.ts`, `v1-http-routes.ts`, `property-do.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, demo seed.

---

## Spec §1.2 / §6 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) SPA plan picker | 3 |
| §1.2 (2) quote from selected plan + button gates | 3 |
| §1.2 (3) `createReservation` client | 1 |
| §1.2 (4) `bookingReservationOpId` segment | 1 |
| §1.2 (5) dispatch fingerprint | 2 |
| §1.2 (6) HTTP `RATE_MISSING` + SPA error copy | 2, 3 |
| §1.2 (7) tests Lock 9 | 1–4 |
| Lock 9 client-core | 1 |
| Lock 9 `reservations-routes.spec.ts` | 2 |
| Lock 9 `BookingScreen.test.tsx` | 3 |
| §6 checklist + pointers | 4 |
| §1.3 scope out | forbidden all |

---

### Task 1: client-core — `bookingReservationOpId` + `createReservation`

**Spec:** §2 Locks 5–6 (client half), Lock 9 client-core cases.

**Files:**
- Modify: `packages/client-core/src/booking.ts` — `bookingReservationOpId` (~25–38)
- Modify: `packages/client-core/src/api.ts` — `createReservation` (~1142–1173)
- Modify: `packages/client-core/test/booking.test.ts`
- Modify: `packages/client-core/test/api.test.ts`

**Interfaces:**
- Produces: `bookingReservationOpId(input & { ratePlanId?: string })` → `book:…:confirmed:1:0:BAR` (omit plan → trailing `:BAR`)
- Produces: `createReservation(…, input & { ratePlanId?: string }, opId)` JSON includes `ratePlanId` when provided in input

**Forbidden this commit:** dispatch, SPA, spec pointers.

- [ ] **Step 1: Write failing tests (`booking.test.ts`)**

Append to `describe('bookingReservationOpId')`:

```typescript
  it('appends ratePlanId segment; omit defaults to BAR', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const omitted = bookingReservationOpId(base);
    expect(omitted).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR');
    const explicitBar = bookingReservationOpId({ ...base, ratePlanId: 'BAR' });
    expect(explicitBar).toBe(omitted);
  });

  it('changes when ratePlanId changes', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const bar = bookingReservationOpId({ ...base, ratePlanId: 'BAR' });
    const corp = bookingReservationOpId({ ...base, ratePlanId: 'CORP' });
    expect(bar).not.toBe(corp);
    expect(corp.endsWith(':CORP')).toBe(true);
  });
```

- [ ] **Step 2: Write failing test (`api.test.ts`)**

Append before closing `});` of the describe block containing `createReservation`:

```typescript
  it('createReservation JSON includes ratePlanId when provided', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((_p, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, reservationId: 'r1', ariVersion: 1 }), {
          status: 201,
        });
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    const input = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      quoteAriVersion: 3,
      ratePlanId: 'CORP',
    };
    const opId = bookingReservationOpId(input);
    await client.createReservation('p', input, opId);
    expect(bodies[0]?.ratePlanId).toBe('CORP');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts -t "ratePlanId"
pnpm --filter @hospai/client-core exec vitest run test/api.test.ts -t "ratePlanId"
```

Expected: **FAIL** — opId missing trailing segment; JSON body missing `ratePlanId`.

- [ ] **Step 4: Implement `booking.ts`**

```typescript
export function bookingReservationOpId(input: {
  reservationId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  guestRef: string;
  status?: 'inquiry' | 'pending' | 'confirmed';
  adults?: number;
  children?: number;
  ratePlanId?: string;
}): string {
  const status = input.status ?? 'confirmed';
  const adults = input.adults ?? 1;
  const children = input.children ?? 0;
  const ratePlanId = input.ratePlanId ?? 'BAR';
  return `book:${input.reservationId}:${input.roomTypeId}:${input.arrivalDate}:${input.departureDate}:${input.guestRef}:${status}:${adults}:${children}:${ratePlanId}`;
}
```

- [ ] **Step 5: Implement `api.ts` `createReservation`**

Extend input type (~1144–1154):

```typescript
        ratePlanId?: string;
```

Add to JSON body (~1161–1171):

```typescript
          ...(input.ratePlanId !== undefined ? { ratePlanId: input.ratePlanId } : {}),
```

- [ ] **Step 6: Update existing exact-string assertion (`booking.test.ts` ~25)**

The pre-existing test at line 25 asserts the opId without the trailing plan segment. After Step 4, update it to expect the normalized `:BAR` suffix:

```typescript
expect(a).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR');
```

- [ ] **Step 7: Run client-core tests**

```bash
pnpm build
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts test/api.test.ts
```

Expected: **PASS**.

- [ ] **Step 8: Commit**

```bash
git add packages/client-core/src/booking.ts \
  packages/client-core/src/api.ts \
  packages/client-core/test/booking.test.ts \
  packages/client-core/test/api.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): booking opId and create body include ratePlanId

EOF
)"
```

---

### Task 2: HTTP dispatch — fingerprint + `RATE_MISSING`

**Spec:** §2 Locks 6–7 (dispatch half), Lock 9 `reservations-routes.spec.ts` cases.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — imports (~1–80); `mapReservationCommandErrorStatus` (~279–347); `handlePostReservations` fingerprint (~1745–1754) + error branch (~1826–1834)
- Modify: `apps/pms-core/test/reservations-routes.spec.ts` — append plan-picker describe + helpers

**Interfaces:**
- Consumes: Task 1 client types (no compile dependency — dispatch-only)
- Produces: fingerprint `{ …, ratePlanId: body.ratePlanId ?? 'BAR' }` always
- Produces: HTTP **422** `{ ok: false, error: 'rate_missing', date }` on create when DO returns `RATE_MISSING`

**Forbidden this commit:** SPA, spec pointers.

- [ ] **Step 1: Write failing HTTP tests**

Extend existing imports in `reservations-routes.spec.ts`:

```typescript
// @hospai/contracts block (~3–8): add RATE_MISSING
  RATE_MISSING,

// @hospai/do-runtime block (~9): add DEFAULT_RATE_PLAN_ID alongside TYPE_WIDE_RATE_PLAN
import { DEFAULT_RATE_PLAN_ID, TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
```

Add helper after `provisionHotel`:

```typescript
async function postRatePlan(
  propertyId: string,
  actor: string,
  body: {
    ratePlanId: string;
    code: string;
    name: string;
    parentRatePlanId?: string;
    deriveBps?: number;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-plan-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}
```

Append before closing `});` of the outer describe:

```typescript
  describe('booking plan picker (HTTP Lock 9)', () => {
    it('1: non-BAR ratePlanId persists on reservation and snapshots derived nights', async () => {
      const actor = `user_plan_http_1_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const childId = `plan_${crypto.randomUUID()}`;
      expect(
        (await postRatePlan(propertyId, actor, {
          ratePlanId: childId,
          code: 'BAR15',
          name: 'BAR −15%',
          parentRatePlanId: DEFAULT_RATE_PLAN_ID,
          deriveBps: -1500,
        })).status,
      ).toBe(201);

      const res = await postReservation(propertyId, actor, {
        reservationId: `res_plan_1_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: childId,
        idempotencyKey: `idem-plan-1-${crypto.randomUUID()}`,
      });
      expect(res.status).toBe(201);

      const resolved = await resolvePropertyFromRegistry(env, propertyId);
      const stub = resolved!.stub as DurableObjectStub<PropertyDO>;
      const reservationId = ((await res.json()) as { reservationId: string }).reservationId;
      const read = await stub.readReservation(reservationId);
      expect(read.ok && read.reservation.ratePlanId).toBe(childId);
      expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
        { stayDate: arrival, amountMinor: 8500, currency: 'USD', ratePlanId: childId },
      ]);
    });

    it('2: omit ratePlanId vs explicit BAR — same idempotency acceptance', async () => {
      const actor = `user_plan_http_2_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const reservationId = `res_plan_2_${crypto.randomUUID()}`;
      const idempotencyKey = `idem-plan-2-${crypto.randomUUID()}`;

      const first = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey,
      });
      expect(first.status).toBe(201);

      const replay = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: 'BAR',
        idempotencyKey,
      });
      expect(replay.status).toBe(201);
      expect(await replay.json()).toMatchObject({ ok: true, reservationId });
    });

    it('3: same key different ratePlanId → idempotency_key_reused', async () => {
      const actor = `user_plan_http_3_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const childId = `plan_${crypto.randomUUID()}`;
      expect(
        (await postRatePlan(propertyId, actor, {
          ratePlanId: childId,
          code: 'CORP',
          name: 'Corporate',
        })).status,
      ).toBe(201);

      const reservationId = `res_plan_3_${crypto.randomUUID()}`;
      const idempotencyKey = `idem-plan-3-${crypto.randomUUID()}`;
      const first = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        idempotencyKey,
      });
      expect(first.status).toBe(201);

      const clash = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: childId,
        idempotencyKey,
      });
      expect(clash.status).toBe(409);
      expect(await clash.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    });

    it('4: valid plan missing rate_day night → 422 rate_missing with date', async () => {
      const actor = `user_plan_http_4_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const orphanId = `plan_${crypto.randomUUID()}`;
      expect(
        (await postRatePlan(propertyId, actor, {
          ratePlanId: orphanId,
          code: 'ORPH',
          name: 'Orphan',
        })).status,
      ).toBe(201);

      const res = await postReservation(propertyId, actor, {
        reservationId: `res_plan_4_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: orphanId,
        status: 'pending',
        idempotencyKey: `idem-plan-4-${crypto.randomUUID()}`,
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        ok: false,
        error: RATE_MISSING,
        date: arrival,
      });
    });
  });
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "booking plan picker"
```

Expected: **FAIL** — HTTP case 2 (omit vs BAR) is a **pin** that is already green today (fingerprint currently omits plan entirely); cases 3 and 4 are the fail-first cases (case 3 → `IDEM_KEY_REUSED`; case 4 returns `{ ok: false, error }` without `date`).

- [ ] **Step 3: Implement dispatch changes**

Add `RATE_MISSING` to contracts import block (~29 area, near `RATE_PLAN_NOT_FOUND`):

```typescript
  RATE_MISSING,
```

Update fingerprint (~1745–1754):

```typescript
  const fingerprint = await fingerprintPayload({
    reservationId: body.reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    guestRef: body.guestRef,
    status: body.status,
    adults: body.adults,
    children: body.children,
    ratePlanId: body.ratePlanId ?? 'BAR',
  });
```

Add to **422 list** in `mapReservationCommandErrorStatus` (~323, after `DEFAULT_RATE_PLAN_PROTECTED`):

```typescript
    error === RATE_MISSING ||
```

Add explicit branch in `handlePostReservations` before generic fallthrough (~1829):

```typescript
    if (err === RATE_MISSING) {
      const fail = result as { ok: false; error: typeof RATE_MISSING; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 422);
    }
```

- [ ] **Step 4: Rebuild contracts + run tests + register pin**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "booking plan picker"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: Lock 9 HTTP cases **PASS**; catalog **81**; writers **56**; `[133]=post_folio_reconcile_payment`; no register changes.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/reservations-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): reservation create fingerprint includes ratePlanId

EOF
)"
```

---

### Task 3: SPA — `BookingScreen` plan picker + quote gates

**Spec:** §2 Locks 2–5, 7, 9 SPA cases; D7 reviewer fixture fix.

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` — ~68–579
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx` — mocks ~7–34, `beforeEach` ~158, new Lock 9 cases

**Interfaces:**
- Consumes: Task 1 `bookingReservationOpId({ …, ratePlanId })`, `createReservation({ …, ratePlanId })`
- Produces: `data-testid="rate-plan"` select; gated book buttons; error copy for `rate_plan_not_found` / `rate_missing`

**Forbidden this commit:** DO/contracts/dispatch (already Task 2), spec pointers.

- [ ] **Step 1: Write failing RTL tests + fix default fixture**

In `BookingScreen.test.tsx`, add mock:

```typescript
const listRatePlans = vi.fn();
```

Extend `vi.mock('../client.js')` api object (~26–34):

```typescript
    listRatePlans: (...a: unknown[]) => listRatePlans(...a),
```

Add helpers after `availOk`:

```typescript
const barPlan = {
  ratePlanId: 'BAR',
  code: 'BAR',
  name: 'Best Available',
  status: 'active',
  cancelPenaltyType: 'none',
  cancelGraceHours: 0,
  cancelPenaltyNights: null,
  cancelPenaltyBps: null,
  cancelPolicyText: null,
  parentRatePlanId: null,
  deriveBps: null,
};

const corpPlan = {
  ratePlanId: 'CORP',
  code: 'CORP',
  name: 'Corporate',
  status: 'active',
  cancelPenaltyType: 'none',
  cancelGraceHours: 0,
  cancelPenaltyNights: null,
  cancelPenaltyBps: null,
  cancelPolicyText: null,
  parentRatePlanId: 'BAR',
  deriveBps: -1500,
};

function rateDaysOk(arrival: string, departure: string, amountMinor = 15000) {
  const days: Array<{ stayDate: string; amountMinor: number }> = [];
  const end = new Date(`${departure}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const lastNight = end.toISOString().slice(0, 10);
  let cur = arrival;
  while (cur <= lastNight) {
    days.push({ stayDate: cur, amountMinor });
    const d = new Date(`${cur}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return { ok: true, days };
}
```

Update `beforeEach` (~130–158):

```typescript
    listRatePlans.mockResolvedValue({ ok: true, plans: [barPlan, corpPlan] });
    listRateDays.mockResolvedValue(rateDaysOk('2026-08-11', '2026-08-12'));
```

Append Lock 9 tests:

```typescript
  it('Lock 9.1: picker lists BAR + CORP with name (code) labels', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Best Available (BAR)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Corporate (CORP)' })).toBeTruthy();
  });

  it('Lock 9.2: selecting CORP refetches listRateDays with ratePlanId CORP', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rate-plan'), { target: { value: 'CORP' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() =>
      expect(listRateDays).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({ ratePlanId: 'CORP' }),
      ),
    );
  });

  it('Lock 9.3: createReservation body includes selected ratePlanId', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rate-plan'), { target: { value: 'CORP' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const body = createReservation.mock.calls[0]![1] as { ratePlanId: string };
    expect(body.ratePlanId).toBe('CORP');
  });

  it('Lock 9.4: Confirm disabled when quote incomplete on selected plan', async () => {
    listRateDays.mockResolvedValue({ ok: true, days: [] });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() =>
      expect(
        screen.getByText('No published rate for every night of this stay on this plan.'),
      ).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lock 9.5: empty plans list disables all three buttons', async () => {
    listRatePlans.mockResolvedValue({ ok: true, plans: [] });
    renderBook();
    await waitFor(() => expect(screen.getByText('No active rate plans.')).toBeTruthy());
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lock 9.6: rate_missing with date shows locked copy', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'rate_missing', date: '2026-08-11' },
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toBe(
        'No rate on 2026-08-11 for this plan — pick another plan or set rates.',
      ),
    );
  });

  it('Lock 9.7: rate_plan_not_found shows locked copy', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { ok: false, error: 'rate_plan_not_found' },
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toBe(
        'Rate plan unavailable — pick another plan.',
      ),
    );
  });
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx -t "Lock 9"
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx -t "happy path"
```

Expected: Lock 9 **FAIL** (picker absent); some existing happy-path tests may **FAIL** until Step 3 lands (quote gate + fixture).

- [ ] **Step 3: Implement `BookingScreen.tsx`**

Add `NativeSelect` to ui-kit import (~13):

```typescript
import { Alert, Button, Field, Input, NativeSelect } from '@hospai/ui-kit';
```

Add state after party state (~74–75):

```typescript
  const [ratePlanId, setRatePlanId] = useState('');
```

Add plans query after `typesQ` (~156–160):

```typescript
  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    retry: false,
  });

  type PlanRow = { ratePlanId: string; code: string; name: string };
  const plans = (plansQ.data?.plans ?? []) as PlanRow[];
  const plansEmpty = plansQ.isSuccess && plans.length === 0;

  useEffect(() => {
    if (!plansQ.isSuccess || ratePlanId) return;
    const bar = plans.find((p) => p.ratePlanId === 'BAR');
    setRatePlanId(bar?.ratePlanId ?? plans[0]?.ratePlanId ?? '');
  }, [plansQ.isSuccess, plansQ.data, ratePlanId, plans]);
```

Replace `ratesQ` (~125–136):

```typescript
  const ratesQ = useQuery({
    queryKey: ['rate-days', propertyId, arrivalDate, lastNight, roomTypeId, ratePlanId],
    queryFn: () =>
      api.listRateDays(propertyId, {
        fromDate: arrivalDate,
        toDate: lastNight!,
        roomTypeId: roomTypeId!,
        ratePlanId,
      }),
    enabled:
      Boolean(roomTypeId && arrivalDate && lastNight && lastNight >= arrivalDate && ratePlanId),
    retry: false,
  });
```

Add quote gate (~220–227):

```typescript
  const quoteComplete = stayQuoteMinor != null;
  const confirmEnabled =
    !plansEmpty &&
    quoteComplete &&
    quoteAriVersion != null &&
    roomTypeId != null &&
    guestResolved &&
    !dateCapBlocked &&
    partyOk;
  const quoteEnabled =
    !plansEmpty && quoteComplete && roomTypeId != null && guestResolved && !dateCapBlocked && partyOk;
```

Update `bookMutation` opId + create body (~255–278):

```typescript
      const opId = bookingReservationOpId({
        reservationId,
        roomTypeId,
        arrivalDate,
        departureDate,
        guestRef,
        status,
        adults,
        children,
        ratePlanId,
      });
      return api.createReservation(
        propertyId,
        {
          reservationId,
          roomTypeId,
          guestRef,
          arrivalDate,
          departureDate,
          quoteAriVersion: quoteAriVersion ?? 0,
          adults,
          children,
          ratePlanId,
          ...(status === 'confirmed' ? {} : { status }),
        },
        opId,
      );
```

Add error branches in `onError` before generic fallback (~331):

```typescript
      if (code === 'rate_plan_not_found') {
        setMessage('Rate plan unavailable — pick another plan.');
        return;
      }
      if (code === 'rate_missing') {
        const date = bodyField(body, 'date');
        setMessage(
          date
            ? `No rate on ${date} for this plan — pick another plan or set rates.`
            : 'No rate on this stay for this plan — pick another plan or set rates.',
        );
        return;
      }
```

Add Rate plan section before Room type section (~407):

```tsx
      <section className="stack">
        <h2>Rate plan</h2>
        {plansQ.isLoading ? <p className="muted">Loading rate plans…</p> : null}
        {plansEmpty ? (
          <p className="muted" role="status">
            No active rate plans.
          </p>
        ) : null}
        {plansQ.isSuccess && plans.length > 0 ? (
          <Field
            label="Rate plan"
            control={
              <NativeSelect
                data-testid="rate-plan"
                value={ratePlanId}
                onChange={(e) => setRatePlanId(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.ratePlanId} value={p.ratePlanId}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </NativeSelect>
            }
          />
        ) : null}
      </section>
```

After room-type list / before `stay-quote` (~451), add incomplete copy:

```tsx
        {roomTypeId != null &&
        ratePlanId &&
        !ratesQ.isLoading &&
        stayQuoteMinor == null &&
        arrivalDate &&
        lastNight &&
        lastNight >= arrivalDate ? (
          <p className="muted" role="status">
            No published rate for every night of this stay on this plan.
          </p>
        ) : null}
```

- [ ] **Step 4: Rebuild client-core + run full BookingScreen suite**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: **PASS** (including existing tests with default complete-night fixture).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/BookingScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): booking wizard rate plan picker and quote gate

EOF
)"
```

---

### Task 4: LAST — leftover pointers + full CI

**Spec:** §6 checklist, §5 closes pointers, D6/D7.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` — §7 leftover **1** ~287
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` — §19 leftover **6** ~854
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — §19 leftover **24** ~561
- Modify: `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` — tick §6 checklist
- Modify: `docs/superpowers/plans/2026-08-15-booking-plan-picker.md` — Task 4 checkboxes (this file)
- Optional: `apps/pms-core/src/property-do.ts` — stale JSDoc on `tryCreateReservation` fingerprint (~7377)

**Pointer sentences (normative — one sentence each):**

Booking-wizard §7 leftover **1** (~287):

> ~~**Rates in booking** \| … The wizard remains quantity-only (no plan picker / total).~~ **Closed** in [2026-08-15 booking plan picker](./2026-08-15-booking-plan-picker-design.md): `/book` plan picker, client-side quote from selected plan, and `ratePlanId` on create.

Reservation-lifecycle §19 leftover **6** (~854):

> ~~**Priced wizard / plan picker** — schema is ready; UI is not this chunk's job beyond Hold/Quote.~~ **Closed** in [2026-08-15 booking plan picker](./2026-08-15-booking-plan-picker-design.md).

Property-setup §19 leftover **24** (~561):

> ~~**24** \| Booking leftover 1 (plan picker in wizard) \| Quantity-only stays~~ **Closed** in [2026-08-15 booking plan picker](./2026-08-15-booking-plan-picker-design.md).

Optional JSDoc (~7377):

```typescript
   * Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate, guestRef, status?, adults?, children?, ratePlanId? }` (HTTP normalizes omitted plan to `BAR`).
```

- [ ] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **81**; writers **56**; `[133]=post_folio_reconcile_payment`; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 30`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 8`.

- [ ] **Step 2: Targeted test superset (spec Lock 9)**

```bash
pnpm build
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts test/api.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-routes.spec.ts -t "booking plan picker|Test 1:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
```

Expected: **PASS**.

- [ ] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures. Do **not** run unsharded `pnpm --filter @hospai/pms-core test`.

- [ ] **Step 4: Apply doc pointers + tick spec §6 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` §6.

- [ ] **Step 5: Tick Task 4 checkboxes in this plan only**

Do **not** tick Tasks 1–3 checkboxes.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-booking-wizard-design.md \
  docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md \
  docs/superpowers/plans/2026-08-15-booking-plan-picker.md
git commit -m "$(cat <<'EOF'
docs: close booking plan picker leftovers

EOF
)"
```

**Stop.** Modify-reservation plan change, guest equality, fingerprint export to contracts, promo, tax in wizard, and plan-scoped restrictions stay deferred per spec §1.3 / §5.

---

## Spec §6 reviewer checklist (Task 4 ticks these in the spec file when CI is green)

| §6 item | Satisfied by |
|---|---|
| SPA plan picker Lock 2 | Task 3 |
| Quote + button gates Locks 3–4 | Task 3 |
| Create + error copy Locks 5, 7 | Tasks 1, 3 |
| Client opId Lock 6 | Task 1 |
| Dispatch fingerprint + `RATE_MISSING` Lock 6–7 | Task 2 |
| Tests Lock 9 | Tasks 1–3 + 4 |
| Register pin unchanged | Task 4 |
| Bidirectional pointers | Task 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–7) | 1–4 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–9 | 1–4 |
| §3 implementation pointers | 3 |
| §4 file map | 1–4 |
| §6 checklist + pointers | 4 |
| Heads table §1.1 | 4 verify |
| D-locks 1–7 | Open decisions |

**Gaps:** None — all Lock 9 cases and §6 checklist items map to Tasks 1–4.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 4 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §7). Verified on `main` post derived-rate-plans: `bookingReservationOpId` ~25–38 (no plan segment); `createReservation` ~1142–1173 (no `ratePlanId`); `handlePostReservations` fingerprint ~1745–1754 (omits plan); `RATE_MISSING` not in `v1-dispatch.ts` imports; `BookingScreen` hardcodes `'BAR'` ~132; button gates ~221–227 (`quoteAriVersion` only); `BookingScreen.test.tsx` `listRateDays` default `{ days: [] }` ~158; catalog **81**; writers **56**; `[133] post_folio_reconcile_payment` last; `PROPERTY_SCHEMA_HEAD` **30**; `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1087).

**Implementer notes (from spec §7, not lock violations):**

1. **`holdReservation` already accepts `ratePlanId` in `extra`** (~1190+) — out of scope; wizard uses create-only path.
2. **Derived plan DO proof exists** (`derived-rate-plans.spec.ts` ~357–371); HTTP + SPA wiring is this chunk.
3. **`RatesScreen` matrix selector** uses code-only labels (~502–504); booking picker uses locked `{name} ({code})`.
4. **Multi-night tests** that change `departure-date` must override `listRateDays.mockResolvedValue` with `rateDaysOk(arrival, departure)` for that stay.
5. **Test 2 HTTP idempotency** relies on Task 2 fingerprint — without it, explicit `BAR` replay returns `IDEM_KEY_REUSED`.
