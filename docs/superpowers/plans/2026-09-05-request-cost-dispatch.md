# Request cost + dispatch prefetch (R0.12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **P1**, **N8**, **P3**, **P7**–**P13** — thread `ctx.tenantProperty` through every property handler, exact reservation-id search only, folio mount deferral + `ledgerRows` memo fix, lazy admin routes, conditional queue poll, self-hosted IBM Plex, optional tape UI 14-day clamp, and CI prefetch ratchet (**G8**) — **without** skipping `assertTenantActive`, copying arrivals triple-fetch to tape (**P8 keep**), parallel org decrypt (**P11 keep**), new routes/commands/migrations, or pin bumps.

**Architecture:** Characterization tests land **first** (Task 1) and must fail on current `main`: G8 static ratchet (`check-resolve-property-prefetch.mjs`), extended `dispatch-registry-dedup.spec.ts` mutating-route prepare counts, and `search-reservation-exact.spec.ts` (name query must not mass-decrypt). Task 2 threads prefetch on all property handlers + removes name-mode search (backend + desk SPA copy). Task 3 lands SPA perf: folio deferral, `React.lazy()` admin cluster, conditional queue poll, self-hosted fonts, tape 14-day clamp. Task 4 runs full CI, wires G8 into CI, bumps AGENTS `check:*` count, and ticks **R0.12** only. **P8** and **P11** are explicit keeps — zero production lines.

**Tech Stack:** Cloudflare Workers + PropertyDO / OrgDO (`apps/pms-core`), React 19 SPA (`apps/web-pms`), `@hospai/contracts`, vitest + `cloudflare:test`, static `check:*` scripts.

**Spec:** `docs/superpowers/specs/2026-09-05-request-cost-dispatch-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged (dispatch logic only) |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. Prefetch threading and search trim are dispatch/DO/SPA-only — no catalog, schema, or route audit length change.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **Prefetch third arg** | `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` on **every** property-scoped handler in `v1-dispatch.ts`. Pattern: `handleGetPropertyMe` (~2864). **Never** skip `assertTenantActive`. |
| **P3 search** | **Exact reservation id only.** Delete name-mode SQL (`LIMIT 200`) and dispatcher needle filter (~2207–2225). Name lookup stays on `/guests` via `guest_blind_index` — **do not** join blind index on reservation search. |
| **P7 folio mount** | Eager: folio, reservation, payments, me, guest batch-of-one, open-shift, property (subtitle/tz). Deferred: rooms, charge-codes, fx-rates, domain-config, city-ledger accounts — `enabled` gates tied to card/section open. |
| **P7 ledgerRows** | Derive `tenderPayments` / `chargeCodes` **inside** `useMemo`; deps `[fold, payments, chargeCodesQ.data, propertyTz]`. Leave `invoice` `gcTime: Infinity` unchanged. |
| **P8 KEEP** | `BoardScreen` arrivals mode continues fetching departures + in-house. **No** triple-fetch on `TapeChartScreen`. **Zero** line changes. |
| **P9 lazy set** | Lazy only: `SettingsScreen`, `RatesScreen`, `InventoryScreen`, `StaffScreen`, `RosterScreen`, `ExceptionsScreen`, `NightAuditScreen`. Desk routes stay **eager**. `PermissionRoute` wrappers unchanged. |
| **P10 poll** | `refetchInterval` **only while** queue non-empty. Keep `staleTime: 0`. |
| **P11 KEEP** | OrgDO page-scoped sequential decrypt — **no** `Promise.all` org-wide decrypt. **Zero** line changes. |
| **P12 fonts** | woff2 under `apps/web-pms/public/fonts/ibm-plex-sans/`; `@font-face` in `tokens.css` or `fonts.css`; remove Google Fonts from `index.html`; tokens stay `"IBM Plex Sans"`. |
| **P13 cap** | If tape picker handlers touched: clamp inclusive window to **14** days in client validation before `writeWindow`. HTTP tape max **90** unchanged. **No** virtualizer. |
| **G8 ratchet** | `scripts/check-resolve-property-prefetch.mjs` fails on two-arg handler calls. Extend `dispatch-registry-dedup.spec.ts` with one mutating property route prepare assert. |
| **TDD** | Task 1 tests/script must **fail on current `main`**. Do **not** invert tests to encode today's bugs. |
| **Verify** | `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. **Never put `--` before `--shard`**. |
| **Pins / roadmap** | No pin bump in Tasks 1–3. Tick **R0.12** only in Task 4. |

**Out of scope:** Redis/KV registry projection; PropertyDO extraction; Playwright; `guest_blind_index` on reservation search; tape virtualizer; 90-night HTTP cap raise; parallel org decrypt (S2); R0.13 eslint/coverage; push; `--no-verify`.

---

## Sequencing gate

```
Task 1 (red tests: prefetch missing third arg ratchet, P3 name search characterization)
→ Task 2 (P1/N8 third arg all property handlers + G8 script; P3 exact-only search)
→ Task 3 (P7 folio deferral, P9 lazy admin, P10 queue poll, P12 fonts, P13 tape cap-14 if picker exists)
→ Task 4 (full CI + tick R0.12; if new check:* add to CI and bump AGENTS check count)
```

**TDD:** Task 1 commits tests-only + G8 script (red on `main` — ~100 two-arg call sites today, 8 with third arg). Task 2 makes prefetch + P3 green and registers `check:resolve-property-prefetch`. Task 3 makes folio deferral, lazy admin, queue poll, fonts, and tape clamp green. Task 4 runs full CI + wires G8 into `.github/workflows/ci.yml` + ticks roadmap **R0.12** only.

---

## File map (spec §12 — implementers touch these)

| File | Task | Change |
|---|---|---|
| `scripts/check-resolve-property-prefetch.mjs` | 1+2 | **New** — G8 static ratchet |
| `package.json` (root) | 2+4 | `check:resolve-property-prefetch` script; CI step in Task 4 |
| `.github/workflows/ci.yml` | 4 | Add `pnpm check:resolve-property-prefetch` after `check:error-mapper-singleton` |
| `AGENTS.md` | 4 | Bump `check:*` count **16 → 17** |
| `apps/pms-core/src/v1-dispatch.ts` | 2 | P1 third arg all property handlers; P3 search handler trim |
| `apps/pms-core/src/property-do.ts` | 2 | P3 `searchReservations` exact-only |
| `apps/pms-core/test/dispatch-registry-dedup.spec.ts` | 1+2 | Mutating route prepare-count assert |
| `apps/pms-core/test/search-reservation-exact.spec.ts` | 1+2 | **New** — P3 characterization |
| `apps/pms-core/test/reservations-search-routes.spec.ts` | 2 | Replace/remove name-mode cases (20, 21) |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 3 | P7 defer + memo |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | 1+3 | T-P7a/b/c red → green |
| `apps/web-pms/src/App.tsx` | 3 | P9 lazy + Suspense |
| `apps/web-pms/src/shell/AppShell.tsx` | 2 | P3 placeholder |
| `apps/web-pms/src/shell/AppShell.search.test.tsx` | 1+2 | Reservation-id placeholder + name empty |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | 2 | P3 copy/behavior |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx` | 1+2 | Drop name-search expectations |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | 3 | P10 conditional poll |
| `apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx` | 1+3 | **New** — poll gate tests |
| `apps/web-pms/index.html` | 3 | P12 remove Google Fonts |
| `apps/web-pms/src/styles/tokens.css` (or `fonts.css`) | 3 | P12 `@font-face` |
| `apps/web-pms/public/fonts/ibm-plex-sans/**` | 3 | P12 woff2 + OFL license |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | 3 | P13 clamp in `writeWindow` |
| `docs/roadmap.md` | 4 | Tick **R0.12** only |

**Not in scope:** `packages/contracts` pins, `BoardScreen` triple fetch, OrgDO `listGuests`, Playwright, Redis, PropertyDO extract.

---

## Task 1 — Failing characterization tests + G8 ratchet (tests-only commit)

**Files:**
- Create: `scripts/check-resolve-property-prefetch.mjs`
- Create: `apps/pms-core/test/search-reservation-exact.spec.ts`
- Modify: `apps/pms-core/test/dispatch-registry-dedup.spec.ts`
- Modify: `apps/web-pms/src/shell/AppShell.search.test.tsx`
- Modify: `apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Create: `apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx`

**Interfaces:** none (tests + static script only). Do **not** register `check:resolve-property-prefetch` in `package.json` or CI until Task 2.

These tests and the G8 script **must fail on current `main`** before Task 2 lands.

### Step 1 — Create G8 static ratchet script

Create `scripts/check-resolve-property-prefetch.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TARGET = join(ROOT, 'apps/pms-core/src/v1-dispatch.ts');
const src = readFileSync(TARGET, 'utf8');
const lines = src.split('\n');
const violations = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Handler call sites: two args only — not the function definition (prefetched? param).
  if (
    line.includes('resolvePropertyContext(ctx, propertyId)') &&
    !line.includes('ctx.tenantProperty') &&
    !line.includes('prefetched?')
  ) {
    violations.push({ line: i + 1, text: line.trim() });
  }
}

if (violations.length > 0) {
  console.error(`check-resolve-property-prefetch: ${violations.length} two-arg handler call site(s):`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  v1-dispatch.ts:${v.line}: ${v.text}`);
  }
  if (violations.length > 20) {
    console.error(`  … and ${violations.length - 20} more`);
  }
  process.exit(1);
}
console.log('check-resolve-property-prefetch: ok');
```

Run:

```bash
node scripts/check-resolve-property-prefetch.mjs
```

Expected: **FAIL** — ~100 two-arg call sites on `main` (8 already pass third arg).

### Step 2 — Extend `dispatch-registry-dedup.spec.ts` with mutating route

Add helpers and a second `describe` block after the existing `/me` test. **Locked representative route:** seeded `GET /v1/properties/:propertyId/folio?reservationId=…` (lighter than check-in fixture).

At top of file, add after `fetchMe`:

```ts
async function fetchFolio(propertyId: string, reservationId: string, actor: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio?reservationId=${encodeURIComponent(reservationId)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}
```

Add seed helper imports from `./fixtures.js` / reservation insert patterns used in `reservations-search-routes.spec.ts` (`createGuest`, `insertReservationForTest`, room-type POST).

Add test:

```ts
describe('dispatch registry dedup — GET folio (mutating-family read)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('dedups registry property reads to one property + one org prepare', async () => {
    const owner = `user_dedup_folio_${crypto.randomUUID()}`;
    const { propertyId, arrival, stub } = await provisionHotelWithReservation(owner);
    const reservationId = `res_dedup_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest_dedup',
      piiKeyId: 'pii_dedup',
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'confirmed',
    });

    const prepareSpy = vi.spyOn(env.PLATFORM_DB, 'prepare');
    const res = await fetchFolio(propertyId, reservationId, owner);
    const totalPrepares = prepareSpy.mock.calls.length;
    const propertyPrepares = countPrepareCalls(prepareSpy, 'FROM property WHERE property_id');
    prepareSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(propertyPrepares).toBe(1);
    expect(totalPrepares).toBe(POST_F1_ME_PREPARE_TOTAL);
  });
});
```

Implement `provisionHotelWithReservation` locally (copy room-type seed from `reservations-search-routes.spec.ts` `provisionHotel`) or inline minimal seed in the test file.

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts
```

Expected: **FAIL** on mutating route — property prepares **> 1** until Task 2 threads prefetch on `handleGetFolio`.

### Step 3 — Create `search-reservation-exact.spec.ts`

Create `apps/pms-core/test/search-reservation-exact.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// … postOrg, postProperty, provisionHotel — copy from reservations-search-routes.spec.ts …

async function search(propertyId: string, actor: string, q: string) {
  const url = `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations-search?q=${encodeURIComponent(q)}`;
  return worker.fetch(new Request(url, { headers: { 'x-dev-actor': actor } }), env);
}

describe('reservation search exact-only (P3)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('T-P3a: exact reservation id returns one hydrated item', async () => {
    const actor = `user_p3_exact_${crypto.randomUUID()}`;
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Lovelace', {
      kind: 'user',
      userId: actor,
    });
    const reservationId = `res_abc_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'confirmed',
    });
    const res = await search(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; items: Array<{ reservationId: string; displayName?: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.reservationId).toBe(reservationId);
    expect(body.items[0]!.displayName).toMatch(/Ada/i);
  });

  it('T-P3b: name substring returns empty without mass decrypt', async () => {
    const actor = `user_p3_name_${crypto.randomUUID()}`;
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Lovelace', {
      kind: 'user',
      userId: actor,
    });
    await stub.insertReservationForTest({
      reservationId: `res_hidden_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });

    const orgStub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await orgStub.ensureMetaOrgId(orgId);
    const readGuestsSpy = vi.spyOn(orgStub, 'readGuests');

    const res = await search(propertyId, actor, 'Ada');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; items: unknown[] };
    expect(body.items).toEqual([]);

    if (readGuestsSpy.mock.calls.length > 0) {
      const totalRefs = readGuestsSpy.mock.calls.reduce(
        (sum, [, , refs]) => sum + (Array.isArray(refs) ? refs.length : 0),
        0,
      );
      expect(totalRefs).toBeLessThanOrEqual(1);
    }
    readGuestsSpy.mockRestore();
  });
});
```

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/search-reservation-exact.spec.ts
```

Expected: **T-P3b FAIL** on `main` — name query returns matches today; after Task 2 returns `items: []`.

### Step 4 — AppShell search: reservation-id placeholder (red)

In `apps/web-pms/src/shell/AppShell.search.test.tsx`, add:

```tsx
it('T-P3c: placeholder says reservation id not guest name', async () => {
  getMe.mockResolvedValue(liveMe);
  renderShell();
  await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
  expect((screen.getByTestId('reservation-search') as HTMLInputElement).placeholder).toMatch(
    /reservation id/i,
  );
  expect((screen.getByTestId('reservation-search') as HTMLInputElement).placeholder).not.toMatch(
    /guest name/i,
  );
});
```

Update existing test `'24: visible with reservations:read…'` — change placeholder assertion from `/guest name/i` to expect **reservation id** (will fail until Task 2).

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/AppShell.search.test.tsx -t "T-P3c:|24:"
```

Expected: **FAIL** — placeholder still `/guest name/i` today (`AppShell.tsx`).

### Step 5 — ReservationsDirectoryScreen: name search red

In `apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx`, add:

```tsx
it('T-P3d: directory search placeholder is reservation id only', async () => {
  renderDirectory();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Reservations' })).toBeTruthy());
  const input = screen.getByTestId('reservations-search') as HTMLInputElement;
  expect(input.placeholder).toMatch(/reservation id/i);
  expect(input.placeholder).not.toMatch(/guest name/i);
});
```

Adjust `data-testid` to match actual input in `ReservationsDirectoryScreen.tsx` if different.

Expected: **FAIL** until Task 2 copy change.

### Step 6 — FolioScreen deferral red tests (T-P7)

Add to `apps/web-pms/src/screens/FolioScreen.test.tsx` (ensure default mocks resolve for folio/reservation/payments/me/guest):

```tsx
it('T-P7a: mount does not fetch rooms, charge codes, fx, domain config, or city ledger', async () => {
  listRooms.mockClear();
  listChargeCodes.mockClear();
  listFxRates.mockClear();
  listDomainConfig.mockClear();
  fetchCityLedgerAccounts.mockClear();
  renderFolio();
  await waitFor(() => expect(getFolio).toHaveBeenCalled());
  expect(listRooms).not.toHaveBeenCalled();
  expect(listChargeCodes).not.toHaveBeenCalled();
  expect(listFxRates).not.toHaveBeenCalled();
  expect(listDomainConfig).not.toHaveBeenCalled();
  expect(fetchCityLedgerAccounts).not.toHaveBeenCalled();
});
```

Expected: **FAIL** — all five fire at mount today (`FolioScreen.tsx` ~300–375).

### Step 7 — QueuedCommandsPanel poll red test

Create `apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx`:

```tsx
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const entriesRef = { current: [] as Array<{ commandId: string; idempotencyKey: string; issuedAt: string }> };

vi.mock('../client.js', () => ({
  queuedCommands: { entries: () => entriesRef.current },
}));

import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetchIntervalSpy = vi.spyOn(client.getQueryCache().constructor.prototype as never, 'config');
  render(
    <QueryClientProvider client={client}>
      <QueuedCommandsPanel />
    </QueryClientProvider>,
  );
  return { client };
}

describe('QueuedCommandsPanel poll gate (P10)', () => {
  afterEach(() => {
    entriesRef.current = [];
    cleanup();
  });

  it('T-P10a: empty queue uses refetchInterval false', async () => {
    entriesRef.current = [];
    const { client } = renderPanel();
    await waitFor(() => {
      const obs = client.getQueryCache().find({ queryKey: ['queued-commands'] });
      expect(obs?.options.refetchInterval).toBeFalsy();
    });
  });
});
```

Alternative assertion: export a test hook or inspect `useQuery` options via `@tanstack/react-query` devtools pattern. Adjust if `refetchInterval: 1000` is hardcoded today — test **FAIL** until Task 3.

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/shell/QueuedCommandsPanel.test.tsx \
  src/screens/FolioScreen.test.tsx -t "T-P7a:|T-P10a:"
```

Expected: **FAIL**.

### Step 8 — Run Task 1 red suite

```bash
node scripts/check-resolve-property-prefetch.mjs
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts \
  apps/pms-core/test/search-reservation-exact.spec.ts
pnpm --filter @hospai/web-pms exec vitest run \
  src/shell/AppShell.search.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/QueuedCommandsPanel.test.tsx \
  -t "T-P3|T-P7a|T-P10a|24:"
```

Expected: G8 script **FAIL**; listed tests **FAIL**; existing unrelated tests in those files stay **green**.

### Step 9 — Commit (tests + G8 script only)

```bash
git add scripts/check-resolve-property-prefetch.mjs \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts \
  apps/pms-core/test/search-reservation-exact.spec.ts \
  apps/web-pms/src/shell/AppShell.search.test.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx
git commit -m "test: R0.12 red tests for prefetch ratchet, exact search, folio defer, queue poll"
```

---

## Task 2 — Prefetch threading + exact search (P1, N8, P3, G8)

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (all property handlers + `handleGetReservationSearch`)
- Modify: `apps/pms-core/src/property-do.ts` (`searchReservations`)
- Modify: `apps/pms-core/test/reservations-search-routes.spec.ts`
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Modify: `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx`
- Modify: `package.json` (root) — register `check:resolve-property-prefetch`

**Interfaces:**
- **Consumes:** G8 script from Task 1; red tests from Task 1.
- **Produces:** Every property handler calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. `searchReservations(q)` returns exact match or `{ items: [] }` — no `mode: 'name'`. `handleGetReservationSearch` hydrates at most one guest ref.

### Step 1 — Mechanical prefetch replace in `v1-dispatch.ts`

Replace **every** handler call site:

```ts
const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
```

with:

```ts
const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
```

**Do not** change the function **definition** at ~451. **Do not** skip `assertTenantActive` inside the helper. **Exclude** org-scoped handlers and bootstrap routes without `propertyId`.

Verify count:

```bash
rg 'resolvePropertyContext\(ctx, propertyId\)' apps/pms-core/src/v1-dispatch.ts
```

Expected: **zero** matches (definition line uses `prefetched?` param, not this pattern).

Run G8:

```bash
node scripts/check-resolve-property-prefetch.mjs
```

Expected: **PASS**.

### Step 2 — Register G8 in root `package.json`

Add to `"scripts"`:

```json
"check:resolve-property-prefetch": "node scripts/check-resolve-property-prefetch.mjs",
```

Run:

```bash
pnpm check:resolve-property-prefetch
```

Expected: **PASS**.

### Step 3 — P3 backend: `property-do.ts` exact-only

In `searchReservations`, keep exact `reservation_id = ?` branch. **Delete** name-mode SQL (`LIMIT 200`) and early `mode: 'name'` return for `trimmed.length < 2`. Return type simplifies — remove `mode: 'name'`:

```ts
async searchReservations(q: string): Promise<{
  ok: true;
  items: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
}> {
  this.assertRpcAvailable();
  const trimmed = q.trim();
  const frontDeskSelect = `reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                  adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id`;
  const exact = this.ctx.storage.sql
    .exec(`SELECT ${frontDeskSelect} FROM reservation WHERE reservation_id = ?`, trimmed)
    .toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
  if (exact[0]) {
    return { ok: true, items: exact.map((row) => this.mapFrontDeskListRow(row)) };
  }
  return { ok: true, items: [] };
}
```

### Step 4 — P3 backend: trim `handleGetReservationSearch`

In `handleGetReservationSearch` (~2160):

1. Pass third arg: `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.
2. After `searchReservations(q)`: if `items.length === 0` → `{ ok: true, items: [] }`.
3. Hydrate **one** `guestRef` from `items[0]` via existing `readGuests` chunk (batch of 1).
4. **Remove** `found.mode === 'name'` branch and needle filter loop (~2199–2225).

### Step 5 — Update `reservations-search-routes.spec.ts`

- Keep cases **18** (exact id) and **19** (unknown id → empty).
- **Replace** case **20** (`name substring matches`) with:

```ts
it('20. name substring → empty list (exact id only)', async () => {
  // … same seed as old test 20 …
  const res = await search(propertyId, actor, 'alice');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, items: [] });
});
```

- Case **21** (`single-char q`) should still expect empty (already aligned).

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/search-reservation-exact.spec.ts \
  apps/pms-core/test/reservations-search-routes.spec.ts \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts
```

Expected: **PASS**.

### Step 6 — P3 SPA copy

**`AppShell.tsx`** — reservation search input placeholder → `"Reservation id"` (or `"Search by reservation id"`). Remove guest-name implication.

**`ReservationsDirectoryScreen.tsx`** — align search placeholder and any helper copy; name browse remains via `/guests` link or list mode without name API search.

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/shell/AppShell.search.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  -t "T-P3|24:"
```

Expected: **PASS**.

### Step 7 — Commit

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/reservations-search-routes.spec.ts \
  apps/web-pms/src/shell/AppShell.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx \
  package.json
git commit -m "feat(pms-core): R0.12 prefetch third arg everywhere; exact reservation search only"
```

---

## Task 3 — SPA perf (P7, P9, P10, P12, P13)

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/shell/QueuedCommandsPanel.tsx`
- Modify: `apps/web-pms/index.html`
- Create: `apps/web-pms/public/fonts/ibm-plex-sans/*.woff2` + `LICENSE-OFL.txt`
- Modify: `apps/web-pms/src/styles/tokens.css` (or create `fonts.css` imported from `main.tsx`)
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` (P13 clamp)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx`

**Interfaces:**
- **Consumes:** Task 2 green prefetch/search.
- **Produces:** Deferred folio queries; lazy admin screens; conditional queue poll; local fonts; tape clamp helper.

### Step 1 — P7 folio query deferral

In `FolioScreen.tsx`, add boolean latches (`useState`) for defer triggers per spec §4.1:

| Query | `enabled` gate |
|---|---|
| `roomsQ` | `Boolean(reservationQ.isSuccess && reservationQ.data?.roomId)` — not on mount alone |
| `chargeCodesQ` | latch on first focus/open of Post charge region (`data-testid="add-charge"`) |
| `fxRatesQ` | `<details data-testid="fx-rates-editor">` open |
| `domainConfigQ` | invoice generate / Advanced invoice subsection open |
| `cityLedgerAccountsQ` | `<details data-testid="folio-advanced">` open or Open COMPANY dialog |

Deferred sections show `Skeleton` or muted “Open section to load…” — no silent failure.

### Step 2 — P7 `ledgerRows` memo fix

Move `chargeCodes` and `tenderPayments` derivation **inside** `ledgerRows` `useMemo`:

```ts
const ledgerRows = useMemo(() => {
  const chargeCodes = (chargeCodesQ.data?.codes ?? []) as Array<{ code: string; name: string }>;
  const tenderPayments = payments.filter(
    (p) => p.status === 'authorized' || p.status === 'captured' || p.status === 'unknown',
  );
  // … existing row build …
}, [fold, payments, chargeCodesQ.data, propertyTz]);
```

Remove outer consts used **only** by this memo.

### Step 3 — Folio tests T-P7b/c

Add to `FolioScreen.test.tsx`:

```tsx
it('T-P7b: opening Advanced triggers city ledger / fx subset', async () => {
  renderFolio();
  await waitFor(() => expect(getFolio).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('folio-advanced'));
  await waitFor(() => expect(fetchCityLedgerAccounts).toHaveBeenCalled());
});

it('T-P7c: ledgerRows stable when payment array identity changes but contents same', async () => {
  // render twice with same payment data; assert no duplicate heavy recompute via row count stable
  // or spy useMemo deps indirectly through render count on child table
});
```

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "T-P7"
```

Expected: **PASS**.

### Step 4 — P9 lazy admin routes

In `App.tsx`:

```tsx
import { lazy, Suspense } from 'react';
import { Skeleton } from '@hospai/ui-kit';

const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen.js').then((m) => ({ default: m.SettingsScreen })),
);
const RatesScreen = lazy(() =>
  import('./screens/RatesScreen.js').then((m) => ({ default: m.RatesScreen })),
);
const InventoryScreen = lazy(() =>
  import('./screens/InventoryScreen.js').then((m) => ({ default: m.InventoryScreen })),
);
const StaffScreen = lazy(() =>
  import('./screens/StaffScreen.js').then((m) => ({ default: m.StaffScreen })),
);
const RosterScreen = lazy(() =>
  import('./screens/RosterScreen.js').then((m) => ({ default: m.RosterScreen })),
);
const ExceptionsScreen = lazy(() =>
  import('./screens/ExceptionsScreen.js').then((m) => ({ default: m.ExceptionsScreen })),
);
const NightAuditScreen = lazy(() =>
  import('./screens/NightAuditScreen.js').then((m) => ({ default: m.NightAuditScreen })),
);
```

Remove static imports for those seven screens. Wrap each route element:

```tsx
<Suspense fallback={<Skeleton />}>
  <SettingsScreen tab="property" />
</Suspense>
```

**Keep eager:** `TapeChartScreen`, `BoardScreen`, `ReservationsDirectoryScreen`, `GuestsDirectoryScreen`, `GuestProfileScreen`, `CheckInScreen`, `FolioScreen`, `ShiftScreen`, `BookingScreen`, `CityLedgerScreen`, `HousekeepingScreen`, `SignInScreen`, shell.

### Step 5 — P10 conditional queue poll

In `QueuedCommandsPanel.tsx`:

```tsx
const q = useQuery({
  queryKey: ['queued-commands'],
  queryFn: async () => [...queuedCommands.entries()],
  staleTime: 0,
  refetchInterval: (query) =>
    (query.state.data?.length ?? 0) > 0 ? 1000 : false,
});
const entries = q.data ?? [];
```

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/QueuedCommandsPanel.test.tsx
```

Add T-P10b: after enqueue mock, interval becomes 1000.

Expected: **PASS**.

### Step 6 — P12 self-host IBM Plex

1. Download IBM Plex Sans woff2 (weights **400, 500, 600, 700**) into `apps/web-pms/public/fonts/ibm-plex-sans/`.
2. Add `LICENSE-OFL.txt` beside fonts.
3. Add `@font-face` rules in `tokens.css` (or `fonts.css`):

```css
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/ibm-plex-sans/IBMPlexSans-Regular.woff2") format("woff2");
}
/* … 500, 600, 700 … */
```

4. Remove Google Fonts `<link>` blocks from `index.html` (lines 7–12 today).
5. Keep `font-family: "IBM Plex Sans", "Segoe UI", sans-serif;` in tokens.

### Step 7 — P13 tape 14-day UI clamp

In `TapeChartScreen.tsx`, add near top:

```ts
const MAX_TAPE_UI_DAYS = 14;

function inclusiveDayCount(from: string, to: string): number {
  // use addCalendarDays from shared date helpers — not raw ms/86400000
}

function clampTapeWindow(from: string, to: string): { from: string; to: string } {
  if (inclusiveDayCount(from, to) <= MAX_TAPE_UI_DAYS) return { from, to };
  // shrink: end at `to`, start MAX_TAPE_UI_DAYS inclusive before `to`
}
```

Apply in `writeWindow` before `navigate`. Optional muted hint: “Room plan shows up to 14 days.”

Add test in `TapeChartScreen.test.tsx` if file exists; otherwise manual verify in Task 4.

### Step 8 — Task 3 focused regression

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/FolioScreen.test.tsx \
  src/shell/QueuedCommandsPanel.test.tsx \
  src/screens/TapeChartScreen.test.tsx
pnpm build
```

Expected: **PASS**.

### Step 9 — Commit

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/App.tsx \
  apps/web-pms/src/shell/QueuedCommandsPanel.tsx \
  apps/web-pms/index.html \
  apps/web-pms/src/styles/tokens.css \
  apps/web-pms/public/fonts \
  apps/web-pms/src/screens/TapeChartScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/shell/QueuedCommandsPanel.test.tsx
git commit -m "feat(web-pms): R0.12 folio deferral, lazy admin, queue poll, local fonts, tape clamp"
```

**PR note (P8 / P11 — no code):** Document that arrivals triple-fetch and OrgDO page decrypt are deliberate keeps per spec §5.

---

## Task 4 — Full CI + tick R0.12

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`
- Modify: `docs/roadmap.md` (tick **R0.12** only)

**Interfaces:** none (verification + docs tick)

### Step 1 — Focused vertical regression sweep

```bash
node scripts/check-resolve-property-prefetch.mjs
pnpm check:resolve-property-prefetch
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts \
  apps/pms-core/test/search-reservation-exact.spec.ts \
  apps/pms-core/test/reservations-search-routes.spec.ts
pnpm --filter @hospai/web-pms exec vitest run \
  src/shell/AppShell.search.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/shell/QueuedCommandsPanel.test.tsx \
  src/screens/TapeChartScreen.test.tsx
```

- [ ] All green

### Step 2 — Wire G8 into CI + bump AGENTS check count

In `.github/workflows/ci.yml` `checks` job, after `pnpm check:error-mapper-singleton`:

```yaml
      - run: pnpm check:resolve-property-prefetch
```

In `AGENTS.md` §Catalog and schema pins / merge-blocking gates, update:

```markdown
There are **17** `check:*` scripts in CI (not 16).
```

List `check:resolve-property-prefetch` alongside other `check:*` scripts.

### Step 3 — Full CI `checks` job sequence (copy in order from `.github/workflows/ci.yml`)

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
pnpm check:error-mapper-singleton
pnpm check:resolve-property-prefetch
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

### Step 4 — pms-core shards (full local suite)

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

- [ ] All shards green

### Step 5 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 6 — Tick roadmap R0.12 only

In `docs/roadmap.md` line ~188:

```markdown
- [x] **R0.12** Audit V12 — P1, N8, P3, P7–P13. …
```

**Do not** tick R0.13 or any other item.

### Step 7 — Commit

```bash
git add .github/workflows/ci.yml AGENTS.md docs/roadmap.md
git commit -m "docs: tick R0.12 request cost + dispatch; wire prefetch check in CI"
```

---

## Manual verify (spec §17)

1. Network tab → desk mutation (check-in, post charge) → single property registry read pattern.
2. Shell search: full reservation id → folio hit; guest first name → no results, no OrgDO batch.
3. Folio cold open → folio/reservation/payments/me/guest/shift only; Advanced → city-ledger/fx load.
4. `/arrivals` hard refresh → departures + in-house still present (**P8** unchanged).
5. Empty queue → no 1 Hz `queued-commands` polling.
6. Block `fonts.googleapis.com` → desk typography unchanged (**P12**).
7. Tape picker 30-day range → clamped to 14 with hint (**P13**).

---

## Success criteria (spec §15)

1. G8 green — zero two-arg handler call sites; CI enforced.
2. D1 dedup — `/me` and mutating-family read each assert **1** property + **2** total registry prepares.
3. P3 — `q=Ada` → empty; `q=<reservationId>` → one hit.
4. P7 — folio mount defers supporting GETs; `ledgerRows` memo fixed.
5. P9 — admin routes via `React.lazy`; desk routes in main chunk.
6. P10 — empty queue does not poll at 1 Hz.
7. P12 — no Google Fonts request.
8. P13 — tape UI refuses windows **> 14** days.
9. P8 / P11 — unchanged, documented in PR.
10. `pnpm test:local` green; pins unchanged.
