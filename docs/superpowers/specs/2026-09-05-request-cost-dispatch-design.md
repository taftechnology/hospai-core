# Request cost + dispatch prefetch (R0.12)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 12](../../audit/2026-09-04-full-codebase-audit.md) (**P1**, **N8**, **P3**, **P7**–**P13**, **G8**); [AGENTS.md §3 HTTP / DO](../../../AGENTS.md) (`resolvePropertyContext`, bounded input); [AGENTS.md §4 SPA perf](../../../AGENTS.md) (`lazy()` admin, queue poll, tape UI cap); [Audit Phase F — performance](./2026-08-15-audit-phase-f-performance-design.md) (F1 partial — `/me` only); [Guest CRM directory](./2026-08-13-guest-crm-directory-design.md) (`guest_blind_index` — **do not** duplicate for desk search); [Folio first paint](./2026-08-13-folio-first-paint-design.md) (folio query fan-out); [Tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) (default 7-day window, no virtualizer); `apps/pms-core/src/v1-dispatch.ts` (`resolvePropertyContext` ~451, `dispatchV1` `tenantProperty` ~8412, `handleGetPropertyMe` ~2864, `handleGetReservationSearch` ~2160); `apps/pms-core/src/property-do.ts` (`searchReservations` ~10604); `apps/web-pms/src/screens/FolioScreen.tsx` (~259–375, ~1115–1176); `apps/web-pms/src/screens/BoardScreen.tsx` (~426–440); `apps/web-pms/src/shell/AppShell.tsx` (~109–125); `apps/web-pms/src/shell/QueuedCommandsPanel.tsx`; `apps/web-pms/src/App.tsx`; `apps/web-pms/index.html`; `apps/pms-core/test/dispatch-registry-dedup.spec.ts`.

**Closes:** Audit **P1** / **N8** (prefetch third arg on every property handler), **P3** (reservation search must not load 200 then decrypt), **P7** (folio mount deferral + `ledgerRows` memo), **P9** (lazy admin routes), **P10** (queue poll only while non-empty), **P12** (self-host IBM Plex), **P13** (tape UI cap 14 if picker touched). **P8** and **P11** are **keep** — no production change. **G8** (prefetch ratchet) lands here, not Vertical 13. **Roadmap:** **R0.12**. **Requires:** R0.6 desk freshness (tape/board keys stable); R0.10 error contracts (handler epilogues unchanged). **Does not** advance R0.13 CI lint, R0.14 early-departure, Playwright, Redis, PropertyDO extraction, KV registry projection, tape virtualizer, or 90-night HTTP availability cap raise.

---

## Executive summary

Property-scoped HTTP still re-reads D1 `property` up to **four times** per request because only **8 / ~92** handler call sites pass `ctx.tenantProperty` into `resolvePropertyContext` — `/me` is correct; the rest discard the row `dispatchV1` already fetched (**P1**, **N8**). Desk reservation search loads **200** open stays then decrypts up to **200** guests in 50-ref chunks to substring-match a name (**P3**). Folio mount fires **rooms**, **charge-codes**, **fx-rates**, **domain-config**, and **city-ledger** before the clerk opens the matching card; `ledgerRows` `useMemo` depends on `tenderPayments` / `chargeCodes` arrays recreated every render (**P7**). Admin screens are eagerly imported in `App.tsx` (**P9**). `QueuedCommandsPanel` polls every **1s** even when the queue is empty (**P10**). IBM Plex loads from Google Fonts on every cold start (**P12**). Tape range picker has no UI cap (**P13** — fix only if touched).

This spec locks mechanical prefetch threading on **every** property handler, **exact reservation-id-only** desk search (name search stays on Guest directory via existing `guest_blind_index`), folio query deferral + memo fix, `React.lazy()` for the admin cluster, conditional queue polling, self-hosted woff2, optional 14-day tape clamp, and CI ratchets (**G8** + extended `dispatch-registry-dedup.spec.ts`). **P8** (arrivals page also fetches departures + in-house) and **P11** (OrgDO page-scoped sequential decrypt) remain deliberate — do not “fix.”

---

## Locked product call

1. **P1 / N8:** Every property-scoped handler calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. Inside the helper, reuse the prefetched row for `assertTenantActive` / `resolvePropertyFromRegistry`. **Do not skip `assertTenantActive`.** Do not add Redis or KV registry projection (Phase F follow-up only).
2. **P3:** **Exact reservation-id search only** on `get_reservation_search`. Remove name-mode (no 200-row scan + mass decrypt). Guest **name** lookup stays on `/guests` via existing `searchGuests` / `guest_blind_index` — **do not** add a second CRM search path on the desk shell.
3. **P7:** Folio mount keeps **folio**, **reservation**, **payments**, **me**, **guest batch-of-one**, **open-shift** (cash path). Defer **rooms**, **charge-codes**, **fx-rates**, **domain-config**, **city-ledger accounts** until the matching UI card opens. Move `tenderPayments` / `chargeCodes` derivation **inside** `ledgerRows` `useMemo`. Leave `invoice` `gcTime: Infinity` sentinel unchanged.
4. **P8 KEEP:** `BoardScreen` `mode === 'arrivals'` continues to fetch departures + in-house alongside arrivals. **Do not** copy that trio onto Tape.
5. **P9:** `React.lazy()` **admin cluster only:** Settings, Rates, Inventory, Staff, Roster, Exceptions, Night audit. Desk routes (board, arrivals, departures, in-house, reservations, guests, check-in, folio, shift, book, city-ledger, housekeeping host) stay **eager**.
6. **P10:** `QueuedCommandsPanel` `refetchInterval: 1000` **only while** `entries.length > 0` (or equivalent subscription — no 1 Hz poll on empty queue).
7. **P11 KEEP:** `OrgDO.listGuests` sequential decrypt of the **page** with LIMIT — no parallel org-wide decrypt (that is **S2**). Profiler-only if OrgDO decrypt is touched for unrelated reasons.
8. **P12:** Self-host IBM Plex Sans woff2 under `apps/web-pms/public/fonts/`. Remove Google Fonts `<link>` from `index.html`. Tokens stay `"IBM Plex Sans"` in `tokens.css`.
9. **P13:** If tape range picker code is touched, **cap UI window at 14 inclusive days** in client validation. **Do not** raise the 90-night HTTP availability cap. **Do not** add a virtualizer for the default 7-day tape.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Prefetch third arg** | `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` on **every** property handler in `v1-dispatch.ts`. Pattern copied from `handleGetPropertyMe` (~2864). `dispatchV1` already sets `tenantProperty: tenant.property` (~8412) — handlers must consume it. |
| **assertTenantActive** | **Never** skip. Purging / offboarded tenants still 404 `{ error: 'not_found' }` via existing gate. Prefetch does not bypass lifecycle checks. |
| **P3 search mode** | **Exact reservation id only.** Drop name-mode from `PropertyDO.searchReservations` + `handleGetReservationSearch` hydration loop. No `guest_blind_index` join on this route in R0.12. |
| **Name search home** | `/guests` directory (`searchGuests` + blind index) — unchanged. Desk shell placeholder/copy reflects reservation id only. |
| **P7 mount set** | Eager: `folioQ`, `reservationQ`, `paymentsQ`, `meQ`, `guestsQ` (batch-of-one), `openShiftQ`, `propertyQ` (subtitle / tz — already shared cache). Deferred: `roomsQ`, `chargeCodesQ`, `fxRatesQ`, `domainConfigQ`, `cityLedgerAccountsQ`. |
| **P7 defer triggers** | See §3.2 table — boolean `enabled` gates tied to card/section open or first focus, not route mount. |
| **ledgerRows memo** | Derive `tenderPayments` and `chargeCodes` **inside** the `useMemo` callback; deps: `[fold, payments, chargeCodesQ.data, propertyTz]`. |
| **P8** | No code change. Document in §4. |
| **P9 lazy set** | `SettingsScreen`, `RatesScreen`, `InventoryScreen`, `StaffScreen`, `RosterScreen`, `ExceptionsScreen`, `NightAuditScreen` — lazy import + `Suspense` fallback (`Skeleton` or existing page skeleton pattern). `PermissionRoute` wrappers unchanged. |
| **P10 poll** | `refetchInterval: entries.length > 0 ? 1000 : false` (or `useSyncExternalStore` on `queuedCommands` — either acceptable; prefer conditional `refetchInterval`). Keep `staleTime: 0`. |
| **P11** | No OrgDO decrypt parallelism. No change unless profiler proves unrelated regression. |
| **P12 fonts** | woff2 files committed under `public/fonts/`. `@font-face` in `tokens.css` or dedicated `fonts.css` imported once. Weights **400, 500, 600, 700** to match current Google CSS. |
| **P13 cap** | Only when editing tape date pickers: clamp `(to - from + 1) <= 14` before `writeWindow` / navigate. Default seeded **7-day** window unchanged. HTTP `get_front_office_tape` max stays **90**. |
| **G8 ratchet** | `scripts/check-resolve-property-prefetch.mjs` fails CI if any handler calls `resolvePropertyContext(ctx, propertyId)` without third arg. Extend `dispatch-registry-dedup.spec.ts` with one **mutating** property route prepare-count assert. |
| **Pins** | Catalog **89**, routes **144**, `PROPERTY_SCHEMA_HEAD` **34**, `ORG_SCHEMA_HEAD` **9**, `NIGHT_AUDIT_STEPS` **8** — unchanged. No new routes/commands/migrations. |

---

## 1. Problem / evidence

### 1.1 P1 / N8 — Prefetch discarded (high)

`dispatchV1` resolves tenant once and passes `tenantProperty` on the handler context:

```8412:8412:apps/pms-core/src/v1-dispatch.ts
    ...(tenant.propertyId ? { tenantProperty: tenant.property } : {}),
```

Only **8** handlers pass it through; **~84** still call two-arg `resolvePropertyContext(ctx, propertyId)`, re-triggering identical D1 reads inside `getProperty`, `assertTenantActive`, and `resolvePropertyFromRegistry` (Phase F §1.2 — **5 prepares → 2** when threaded).

Reference implementation:

```2864:2864:apps/pms-core/src/v1-dispatch.ts
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
```

Helper already supports prefetch and forwards to registry gate:

```451:479:apps/pms-core/src/v1-dispatch.ts
async function resolvePropertyContext(
  ctx: V1DispatchContext,
  propertyId: string,
  prefetched?: PropertyRecord,
): Promise<...> {
  const validatedPrefetch =
    prefetched?.propertyId === propertyId ? prefetched : undefined;
  const property = validatedPrefetch ?? (await getProperty(ctx.env, propertyId));
  // … assertTenantActive with prefetchedProperty …
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId, validatedPrefetch);
```

**Symptom:** every property-scoped desk action pays ~3 extra identical `SELECT * FROM property WHERE property_id = ?` round trips before PropertyDO/OrgDO work begins.

### 1.2 P3 — Name search decrypts up to 200 guests (high)

PropertyDO name-mode loads 200 reservations:

```10622:10640:apps/pms-core/src/property-do.ts
    const rows = (
      openDate
        ? this.ctx.storage.sql.exec(
            `SELECT ${frontDeskSelect} FROM reservation
             WHERE status IN ('inquiry','pending','confirmed','checked_in')
                OR (status IN ('checked_out','cancelled','no_show') AND departure_date >= date(?, '-7 days'))
             ORDER BY arrival_date DESC, reservation_id
             LIMIT 200`,
            openDate,
          )
        : /* … LIMIT 200 … */
    ).toArray();
    return { ok: true, items: rows.map(...), mode: 'name' };
```

Dispatcher then decrypts **every distinct `guestRef`** in 50-ref chunks and filters client-side by substring (~2182–2225). Debounce (300ms) is not a cap — a clerk typing three letters can still trigger full hydration.

**Locked fix:** remove name-mode entirely; exact `reservation_id = ?` match only. Shell copy: reservation id, not guest name.

### 1.3 P7 — Folio mount fan-out (medium)

On mount, `FolioScreen` enables six property-wide queries unrelated to first-paint bill:

```300:375:apps/web-pms/src/screens/FolioScreen.tsx
  const roomsQ = useQuery({ … enabled: Boolean(propertyId) });
  const chargeCodesQ = useQuery({ … enabled: Boolean(propertyId) });
  const domainConfigQ = useQuery({ … enabled: Boolean(propertyId) });
  const fxRatesQ = useQuery({ … enabled: Boolean(propertyId) });
  // …
  const cityLedgerAccountsQ = useQuery({
    … enabled: Boolean(propertyId) && canAdjust,
  });
```

`ledgerRows` memo invalidates every render because dependencies are recreated outside the memo:

```1115:1176:apps/web-pms/src/screens/FolioScreen.tsx
  const chargeCodes = (chargeCodesQ.data?.codes ?? []) as Array<...>;
  const tenderPayments = payments.filter(/* … */);
  const ledgerRows = useMemo(() => {
    // uses tenderPayments, chargeCodes
  }, [fold, tenderPayments, chargeCodes, propertyTz]);
```

`invoice` query `gcTime: Infinity` (~327) is intentional sentinel — **leave it**.

### 1.4 P8 — Combined Front Desk fetch (keep — no defect)

Arrivals mode intentionally loads three lists for the combined Front Desk page:

```426:440:apps/web-pms/src/screens/BoardScreen.tsx
  const departuresQ = useQuery({
    queryKey: ['board', 'departures', tenant.propertyId, date, depCursor],
    enabled: mode === 'arrivals' && date != null,
  });
  const inHouseQ = useQuery({
    queryKey: ['board', 'in-house', tenant.propertyId, null, inHouseCursor],
    enabled: mode === 'arrivals',
  });
```

**Do not** replicate on `TapeChartScreen` (tape uses `get_front_office_tape` + optional available-rooms view only).

### 1.5 P9 — Eager admin imports (medium)

`App.tsx` statically imports Settings, Rates, Inventory, Staff, Roster, Night audit, Exceptions (~12–22). No `React.lazy()` in web-pms today. Desk path pays parse cost for admin bundles clerks may never open on a shift.

### 1.6 P10 — Empty queue polls 1 Hz (medium)

```6:11:apps/web-pms/src/shell/QueuedCommandsPanel.tsx
  const q = useQuery({
    queryKey: ['queued-commands'],
    queryFn: async () => [...queuedCommands.entries()],
    staleTime: 0,
    refetchInterval: 1000,
  });
```

Panel is collapsed when empty (`open={entries.length > 0}`) but the query still refetches every second.

### 1.7 P11 — Page-scoped sequential decrypt (keep)

`OrgDO.listGuests` decrypts one page at a time with LIMIT — expected cost for property-scoped CRM. Parallelizing across the org is **S2** (wrong fix). No change in R0.12.

### 1.8 P12 — External font dependency (medium)

```7:12:apps/web-pms/index.html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
```

Desk SPA should not block first paint on Google CDN. Self-host woff2; CSP already `default-src 'self'`.

### 1.9 P13 — Tape range uncapped in UI (low — only if touched)

Default window seeds **7 days** (`TapeChartScreen` + `FrontOfficeLive`). Date pickers (`tape-from`, `tape-to`) accept arbitrary ranges; DOM cost is **rooms × days**. `content-visibility: auto` already on rows. HTTP tape max **90** nights is API contract — unchanged.

---

## 2. P1 / N8 — Thread prefetch on every property handler

### 2.1 Mechanical change

In `apps/pms-core/src/v1-dispatch.ts`, replace **every** handler-local:

```ts
const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
```

with:

```ts
const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
```

**Scope:** all `handle*` functions for `route.scope === 'property'` that call `resolvePropertyContext`. Includes reads and mutating routes. **Excludes:** org-scoped handlers, `handlePostOrgs` bootstrap, admin routes without property id.

**Do not:**

- Skip `assertTenantActive` when prefetch is present (helper already passes `prefetchedProperty`).
- Re-fetch property inside handler after successful `resolvePropertyContext`.
- Add Redis, in-memory cache, or KV registry projection (explicit out of scope).

### 2.2 Acceptance metric

Per [Phase F spec](./2026-08-15-audit-phase-f-performance-design.md) §1c — on `GET /v1/properties/:propertyId/me`:

| Metric | Before (main today for handlers without prefetch) | After (every handler threaded) |
|---|---|---|
| `prepare` containing `FROM property WHERE property_id` | **4** (dispatch path) | **1** |
| Total registry `prepare` on route | **5** | **2** (property + org) |

Existing `dispatch-registry-dedup.spec.ts` already asserts **2** for `/me`. After P1 land, **any** representative property-scoped route should hit the same counts.

### 2.3 Extended dedup spec — one mutating route

Add second test case to `apps/pms-core/test/dispatch-registry-dedup.spec.ts`:

**Representative mutating route (locked):** `POST /v1/properties/:propertyId/reservations/:reservationId/check-in` with valid idempotency header + seeded reservation — or, if fixture weight is too high, `GET /v1/properties/:propertyId/folio?reservationId=…` read with seeded stay.

**Assert:** same prepare counts as `/me` test (`propertyPrepares === 1`, `totalPrepares === 2`) for the registry path portion of the request.

---

## 3. P3 — Exact reservation-id search only

### 3.1 Backend

**File:** `apps/pms-core/src/property-do.ts` — `searchReservations`

- Keep exact branch: `SELECT … FROM reservation WHERE reservation_id = ?`.
- **Delete** name-mode SQL (`LIMIT 200` scan) and `mode: 'name'` return path.
- Return type simplifies to `{ ok: true; items: [...] }` (always exact or empty). Optional: retain `mode: 'exact' | 'empty'` for tests — not required on wire.

**File:** `apps/pms-core/src/v1-dispatch.ts` — `handleGetReservationSearch`

- After `searchReservations(q)`: if zero rows → `{ ok: true, items: [] }`.
- If one row → hydrate **one** `guestRef` via existing `readGuests` chunk (batch of 1).
- **Remove** needle filter loop over 200 decrypted names (~2207–2225).
- Pass third arg: `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.

**Route / catalog:** unchanged (`get_reservation_search` stays index `[103]`). No audit length bump.

### 3.2 SPA

| Surface | Change |
|---|---|
| `AppShell.tsx` `ReservationSearch` | Placeholder **"Reservation id"** (or "Search by reservation id"). Remove guest-name implication. |
| `ReservationsDirectoryScreen.tsx` | Same search API — local filter mode becomes id-only; placeholder/copy aligned. Name browse → link to `/guests` or list mode without search. |
| `AppShell.search.test.tsx` | Update tests: non-id query returns empty without mass API side effects; id query resolves. |
| `ReservationsDirectoryScreen.test.tsx` | Drop name-search expectations; assert exact-id path. |

**Do not** wire `guest_blind_index` into reservation search in this vertical. **Do not** add org-wide CRM search on property URL.

### 3.3 Characterization test (pms-core)

New or extended spec: `search-reservation-exact.spec.ts`

- Seed reservation `res_abc` + guest with display name "Ada Lovelace".
- `GET …/reservations/search?q=res_abc` → 200, one item, displayName hydrated.
- `GET …/reservations/search?q=Ada` → 200, **`items: []`**, OrgDO `readGuests` called **at most once** with **0–1** refs (not 50+ batch loop). Spy/mock OrgDO readGuests call count.

---

## 4. P7 — Folio deferral + ledgerRows memo

### 4.1 Deferred query enable gates

| Query | Enable when |
|---|---|
| `roomsQ` | `reservationQ.isSuccess && reservationQ.data.roomId != null` **and** (`printRegCardOpen` **or** stay summary card expanded **or** `FrontOfficeEditor` visible) — minimum bar: **`Boolean(reservationQ.data?.roomId)`** after reservation loads (room code for header); do **not** enable on propertyId alone at mount. |
| `chargeCodesQ` | User focuses/opens **Post charge** section (`data-testid="add-charge"` region) — use `useState` latch set on first focus/open. |
| `fxRatesQ` | `<details data-testid="fx-rates-editor">` **open** event. |
| `domainConfigQ` | Invoice generate UI opened or **Advanced** invoice subsection opened. |
| `cityLedgerAccountsQ` | **Advanced** `<details data-testid="folio-advanced">` open **or** Open COMPANY dialog open. |

First-paint bill (guest, balance, lines, post charge, take payment) must render with **folio + reservation + payments + me + guest batch** only. Deferred cards show skeleton / muted “Open section to load…” until enabled — no silent failure.

### 4.2 ledgerRows memo fix

Move filtering/mapping **inside** `useMemo`:

```ts
const ledgerRows = useMemo(() => {
  const chargeCodes = (chargeCodesQ.data?.codes ?? []) as Array<{ code: string; name: string }>;
  const tenderPayments = payments.filter(
    (p) => p.status === 'authorized' || p.status === 'captured' || p.status === 'unknown',
  );
  // … existing row build …
}, [fold, payments, chargeCodesQ.data, propertyTz]);
```

Remove outer `chargeCodes` / `tenderPayments` consts used only by this memo (retain separate usages elsewhere if any).

### 4.3 Tests (web-pms)

`FolioScreen.test.tsx`:

- **T-P7a:** On initial render mock, `listRooms` / `listChargeCodes` / `listFxRates` / `listDomainConfig` / city-ledger list **not** called.
- **T-P7b:** Opening Advanced (or post-charge focus) triggers expected subset.
- **T-P7c:** `ledgerRows` stable across rerender when inputs unchanged (optional `renderHook` count or memo spy).

---

## 5. P8 / P11 — Explicit keep (no implementation)

| ID | Keep rationale | Forbidden “fixes” |
|---|---|---|
| **P8** | Arrivals page is a combined Front Desk surface — KPIs + cross-mode guest batch need departures + in-house on the same date. | Adding departures/in-house queries to `TapeChartScreen`; removing arrivals-side fetches. |
| **P11** | CRM list decrypt is **O(page)** by design; blind index pre-filters search/list, not sequential decrypt of 200. | `Promise.all` org-wide guest decrypt; raising list LIMIT to “speed up” search. |

Document in PR notes; **zero** line changes unless a future spec explicitly revisits.

---

## 6. P9 — Lazy admin routes

### 6.1 Lazy imports

In `apps/web-pms/src/App.tsx`:

```ts
import { lazy, Suspense } from 'react';
import { Skeleton } from '@hospai/ui-kit';

const SettingsScreen = lazy(() => import('./screens/SettingsScreen.js').then(m => ({ default: m.SettingsScreen })));
// … RatesScreen, InventoryScreen, StaffScreen, RosterScreen, ExceptionsScreen, NightAuditScreen
```

Wrap each lazy route element:

```tsx
<Suspense fallback={<Skeleton />}>
  <SettingsScreen tab="property" />
</Suspense>
```

**Eager (unchanged):** `TapeChartScreen`, `BoardScreen`, `ReservationsDirectoryScreen`, `GuestsDirectoryScreen`, `GuestProfileScreen`, `CheckInScreen`, `FolioScreen`, `ShiftScreen`, `BookingScreen`, `CityLedgerScreen`, `HousekeepingScreen`, `SignInScreen`, shell components.

### 6.2 Tests

- Optional smoke: navigating to `/settings/property` eventually renders heading — no requirement for bundle-size CI gate in R0.12.
- Do not lazy-load `PermissionRoute` — only screen components.

---

## 7. P10 — Conditional queue poll

```ts
const entries = q.data ?? [];
const q = useQuery({
  queryKey: ['queued-commands'],
  queryFn: async () => [...queuedCommands.entries()],
  staleTime: 0,
  refetchInterval: (query) =>
    (query.state.data?.length ?? 0) > 0 ? 1000 : false,
});
```

When last entry drains, interval stops on next tick. Alternative: subscribe to `queuedCommands` mutation bus — acceptable if simpler.

**Test:** `QueuedCommandsPanel.test.tsx` — mock empty queue → `refetchInterval` false; after enqueue → 1000.

---

## 8. P12 — Self-host IBM Plex

1. Download **IBM Plex Sans** woff2 files (weights 400, 500, 600, 700) into `apps/web-pms/public/fonts/ibm-plex-sans/`.
2. Add `@font-face` rules pointing at `/fonts/ibm-plex-sans/…woff2` (`font-display: swap`).
3. Remove Google Fonts links from `index.html`.
4. Keep `tokens.css` `font-family: "IBM Plex Sans", "Segoe UI", sans-serif;`.
5. Verify CSP `font-src 'self'` (or inherited `default-src 'self'`) — no external font hosts.

**License:** IBM Plex is OFL — include `LICENSE-OFL.txt` beside fonts if not already in repo.

---

## 9. P13 — Tape UI 14-day cap (conditional)

**Trigger:** any edit to `TapeChartScreen.tsx` date picker handlers (`tape-from`, `tape-to`, `writeWindow`).

**Rule:**

```ts
const MAX_TAPE_UI_DAYS = 14;

function inclusiveDayCount(from: string, to: string): number {
  // use existing calendar helpers / addCalendarDays — not raw ms/86400000
}

function clampTapeWindow(from: string, to: string): { from: string; to: string } {
  if (inclusiveDayCount(from, to) <= MAX_TAPE_UI_DAYS) return { from, to };
  // shrink to ending at `to`, starting MAX_TAPE_UI_DAYS inclusive before to
}
```

- Apply clamp in `writeWindow` before `navigate`.
- Optional muted hint when clamp fires: “Room plan shows up to 14 days.”
- **Do not** change HTTP handler max (90).
- **Do not** add `@tanstack/react-virtual` or row virtualizer.

If tape picker is **not** touched in implementation PR, P13 is **N/A** — skip test.

---

## 10. G8 — Prefetch ratchet (CI)

### 10.1 Static gate

**New file:** `scripts/check-resolve-property-prefetch.mjs`

- Parse `apps/pms-core/src/v1-dispatch.ts`.
- Fail if any line matches `resolvePropertyContext(ctx, propertyId)` **without** `ctx.tenantProperty` as third argument.
- Allowlist: the function **definition** of `resolvePropertyContext` only.
- Wire into root `package.json` `"check:resolve-property-prefetch"` and CI aggregate (same pattern as `check-error-mapper-singleton.mjs`).

### 10.2 Runtime gate

Extend `dispatch-registry-dedup.spec.ts` per §2.3.

### 10.3 Tests land first

- G8 script should **fail on main** (84+ two-arg call sites).
- P1 implementation makes it green.

---

## 11. Verification

```bash
# G8 — must fail before P1, pass after
node scripts/check-resolve-property-prefetch.mjs

# Registry dedup
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts

# P3 search
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/search-reservation-exact.spec.ts

# SPA
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/FolioScreen.test.tsx \
  src/shell/AppShell.search.test.tsx \
  src/shell/QueuedCommandsPanel.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx

# Full gate
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** 8 shards, no `--` before `--shard`. This vertical touches pms-core + web-pms only.

---

## 12. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/v1-dispatch.ts` | P1 third arg all handlers; P3 search handler trim |
| `apps/pms-core/src/property-do.ts` | P3 `searchReservations` exact-only |
| `apps/pms-core/test/dispatch-registry-dedup.spec.ts` | §2.3 mutating route |
| `apps/pms-core/test/search-reservation-exact.spec.ts` | **New** — P3 characterization |
| `scripts/check-resolve-property-prefetch.mjs` | **New** — G8 |
| `package.json` (root) | register `check:resolve-property-prefetch` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | P7 defer + memo |
| `apps/web-pms/src/App.tsx` | P9 lazy + Suspense |
| `apps/web-pms/src/shell/AppShell.tsx` | P3 placeholder |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | P3 copy/behavior |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | P10 conditional poll |
| `apps/web-pms/index.html` | P12 remove Google Fonts |
| `apps/web-pms/src/styles/tokens.css` (or `fonts.css`) | P12 `@font-face` |
| `apps/web-pms/public/fonts/**` | P12 woff2 assets |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | P13 clamp **if touched** |
| `apps/web-pms/src/**/*.test.tsx` | Updated expectations |

**Not in scope:** `packages/contracts` pins, new HTTP routes, OrgDO `listGuests` / `searchGuests`, `BoardScreen` triple fetch, Playwright, Redis, PropertyDO extract, tape virtualizer, 90-night cap raise.

---

## 13. Pin freeze

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last id `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No migration. No new dispatched command. No route audit length change.

---

## 14. Out of scope (normative)

- **Redis** / KV registry projection for property row (Phase F §1.8 / ARCHITECTURE §4.3).
- **PropertyDO extraction** or new modules.
- **Playwright** / Cypress e2e.
- **guest_blind_index join** on reservation search (name search stays on Guest directory only).
- **Second CRM search** on desk shell or property URL org-wide reads.
- **Tape virtualizer** and **90-night HTTP cap** raise.
- **Parallel org-wide decrypt** (S2).
- **Copying arrivals triple-fetch to Tape** (P8).
- **F2 kill-switch ∥ permission** parallelization (Phase F — separate if not landed).
- **R0.13** eslint recommended / coverage — Vertical 13.

---

## 15. Success criteria

1. **G8 green:** zero two-arg `resolvePropertyContext` handler call sites; CI script enforced.
2. **D1 dedup:** `/me` and one mutating property route each assert **1** property + **2** total registry prepares.
3. **P3:** `q=Ada` returns empty items without mass decrypt; `q=<reservationId>` returns one hit.
4. **P7:** Folio mount does not fetch rooms/charge-codes/fx/domain-config/city-ledger until defer trigger; `ledgerRows` memo no longer depends on per-render array identities.
5. **P9:** Admin routes load via `React.lazy`; desk routes remain in main chunk.
6. **P10:** Empty queue does not poll at 1 Hz.
7. **P12:** No Google Fonts request; Plex renders from `/fonts/…`.
8. **P13:** If tape picker edited, UI refuses windows **> 14** days.
9. **P8 / P11:** Unchanged behavior, documented.
10. `pnpm test:local` green; pins unchanged.

---

## 16. Relationship to prior specs

[2026-08-15-audit-phase-f-performance-design.md](./2026-08-15-audit-phase-f-performance-design.md) **F1** landed `/me` + infrastructure (`tenantProperty`, helper prefetch param, `dispatch-registry-dedup.spec.ts`) but explicitly left other handlers out of scope. **This spec completes F1's handler threading** (reviewer lock overrides Phase F §Lock 1b "out of F1 scope" for all property handlers).

[2026-08-13-guest-crm-directory-design.md](./2026-08-13-guest-crm-directory-design.md) owns **name** search via `guest_blind_index` on `/guests`. R0.12 **does not** merge blind index into reservation search — it **removes** the decrypt-200 workaround.

[2026-08-13-folio-first-paint-design.md](./2026-08-13-folio-first-paint-design.md) defines bill IA. P7 **defers** supporting GETs without reversing first-paint content — cards may show skeleton until opened.

[2026-08-13-tape-chart-live-board-design.md](./2026-08-13-tape-chart-live-board-design.md) default **7-day** window and WS contract unchanged. P13 only adds client clamp when picker is edited.

[2026-09-05-property-scoped-guest-roster-lists-design.md](./2026-09-05-property-scoped-guest-roster-lists-design.md) threaded prefetch on guest/roster reads only — R0.12 finishes the remaining handlers.

---

## 17. Manual verify (local / staging)

1. Open Network tab → any desk mutation (check-in, post charge) → confirm single property registry read pattern (latency drop vs main if measurable).
2. Shell search: paste full reservation id → folio hit; type guest first name → no results, no long OrgDO batch in Network.
3. Open folio cold → only folio/reservation/payments/me/guest/shift requests; open Advanced → city-ledger/fx load.
4. Hard refresh on `/arrivals` → still see departures/in-house sections (**P8**).
5. Empty degraded queue → no 1 Hz `queued-commands` polling in Network.
6. Offline Google Fonts → desk typography unchanged (**P12**).
7. Optional: tape picker 30-day range → clamped to 14 with hint (**P13**).

---

## 18. Roadmap tick

When success criteria pass, mark **`R0.12`** in [docs/roadmap.md](../../roadmap.md). **Do not** tick R0.13 items (G8 moves here intentionally).
