# Booking plan picker (priced wizard)

**Tree verified 2026-08-15 (post derived rate plans close `40793b5`):** `COMMAND_CATALOG` length **81** (`register.test.ts` ~679), `AUDIT_WRITER_COMMAND_IDS.size === 56` (`register.test.ts` ~269 and ~678), `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'` (`register.test.ts` ~670–675; `v1-http-routes.ts` ~786+), `[132] delete_room` (~663–668; `v1-http-routes.ts` ~778–783), `[131] post_folio_routing_rule_archive` (~656–661), `[128] post_folio_stay_discount` (~634–638), `[127] post_demo_seed` (~620–624), `PROPERTY_SCHEMA_HEAD === 30` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~627–628), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1083–1092), `PLATFORM_GAPS === []` (`register.test.ts` ~680), `reservation.rate_plan_id NOT NULL DEFAULT 'BAR'` (~604 in `property-migrations.ts`), `DEFAULT_RATE_PLAN_ID = 'BAR'` (~6), HTTP `post_reservations` accepts `ratePlanId?` (~1716–1727 in `v1-dispatch.ts`), `tryCreateReservation` stores `ratePlanId ?? DEFAULT_RATE_PLAN_ID` and snapshots nights for pending/confirmed only (~7452–7523 in `property-do.ts`), `listRatePlans` active-only `ORDER BY code` (~11149–11173), `GET /rate-plans` / `GET /rate-days` routes (~211–216, ~642–647 in `v1-http-routes.ts`), `BookingScreen` hardcodes `listRateDays(..., ratePlanId: 'BAR')` (~128–132) and omits `ratePlanId` on create (~255–278), `createReservation` client omits `ratePlanId` from JSON (~1142–1173 in `api.ts`), `bookingReservationOpId` omits plan (~25–38 in `booking.ts`), `handlePostReservations` fingerprint omits `ratePlanId` (~1745–1754), `RATE_PLAN_NOT_FOUND` → **404** (~350–356 in `v1-dispatch.ts`), `RATE_MISSING` mapped in DO via `mapReservationPreconditionError` (~902) but HTTP create falls through generic path (~1834), `stay-quote` UI (~451–452), confirm/hold gated on `quoteAriVersion` only (~221–227), quote not gated on complete quote (~227).

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §7.1 (sold + rate lookup); [derived rate plans](./2026-08-15-derived-rate-plans-design.md) (materialized `rate_day` for derived plans); [booking wizard](./2026-08-11-booking-wizard-design.md) (wizard shell, opId, ARI quote gate); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (`reservation.rate_plan_id`, snapshot semantics); [property setup SPA](./2026-08-13-property-setup-spa-design.md) (rates matrix, type labels); `apps/web-pms/src/screens/BookingScreen.tsx`; `packages/client-core/src/booking.ts`; `packages/client-core/src/api.ts`; `apps/pms-core/src/v1-dispatch.ts`; `apps/pms-core/src/property-do.ts`; `apps/pms-core/test/reservations-routes.spec.ts`; `apps/pms-core/test/derived-rate-plans.spec.ts`; `apps/pms-core/test/folio-quote-snapshot.spec.ts`.

**Closes:** [booking wizard](./2026-08-11-booking-wizard-design.md) leftover **1** (Rates in booking — schema landed; wizard still quantity-only / BAR-hardcoded ~287). [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) leftover **6** (Priced wizard / plan picker ~854). [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover **24** (plan picker in wizard ~561). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

**Amends:** [booking wizard](./2026-08-11-booking-wizard-design.md) §7 leftover **1** (~287) (closed). [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) §19 leftover **6** (~854) (closed). [property setup SPA](./2026-08-13-property-setup-spa-design.md) §19 leftover **24** (~561) (closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Derived rate plans and `reservation.rate_plan_id` shipped. PropertyDO `tryCreateReservation` already accepts optional `ratePlanId`, defaults to `BAR`, validates the plan is active, and snapshots `reservation_rate_night` from `rate_day` for pending/confirmed. HTTP `POST /reservations` already spreads `ratePlanId` into the command payload when present.

The desk still cannot sell a non-BAR plan: the booking wizard hardcodes BAR for quotes, never sends `ratePlanId` on create, and does not gate booking on a complete priced quote. Idempotency fingerprints omit the plan, so a later plan change would collide under first-write-wins.

This chunk closes the **priced booking wizard / plan picker**: reuse existing read routes and create body field; wire SPA + client + fingerprint honesty; make `RATE_MISSING` HTTP responses carry `date` like `UNBOOKABLE`.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Schema | `reservation.rate_plan_id NOT NULL DEFAULT 'BAR'` (~604); `reservation_rate_night.rate_plan_id` (~749–753) |
| Plan list | `listRatePlans` active-only `ORDER BY code` (~11149–11173); HTTP `GET /rate-plans` (~4496–4505) |
| Rate days | `listRateDays` / `GET /rate-days`; derived amounts materialized in `rate_day` |
| Rate lookup | `rateDayAmountSync` (~6940–6951); missing → `RateMissingError` → `RATE_MISSING` + `date` (~902) |
| Create path | `handlePostReservations` body + payload spread `ratePlanId?` (~1716–1767); DO default `BAR` (~7452) |
| Snapshot | `snapshotRateNightsSync` pending/confirmed only (~7522–7523); inquiry skips sold + snapshot |
| Night audit ROOM | Uses `reservation.rate_plan_id` + `rate_day` (unchanged) |
| Client reads | `api.listRatePlans` (~1635–1637); `api.listRateDays` with `ratePlanId?` (~1687+) |
| Wizard shell | Dates, availability, room-type radios, party, guest, three actions (~68–579 in `BookingScreen.tsx`) |
| Partial quote UI | `stay-quote` sums BAR `rate_day` only (~125–154, ~451–452); incomplete nights → omit element |
| Derived booking proof | DO-only `tryCreateReservation` + snapshot on derived plan (`derived-rate-plans.spec.ts` ~357–371) |

**Heads (frozen — this chunk moves none):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **81** | **81** — no new command |
| `AUDIT_WRITER_COMMAND_IDS.size` | **56** | **56** |
| `V1_HTTP_ROUTE_AUDIT` | `[133] = post_folio_reconcile_payment` | **unchanged** — `[132]`/`[131]`/`[128]`/`[127]` unmoved |
| `PROPERTY_SCHEMA_HEAD` | **30** | **30** — no migration |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — `[3] === 'AUTO_TRANSFER'` |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.2 Scope in

1. **SPA plan picker** on `BookingScreen` — fetch plans, select plan, quote from selected plan, gate buttons (Lock 2–4).
2. **`createReservation` client** — send `ratePlanId` on JSON body when wizard has a selection (Lock 5).
3. **`bookingReservationOpId`** — trailing `ratePlanId` segment; default `BAR` when omitted (Lock 6).
4. **`handlePostReservations` fingerprint** — always include `ratePlanId: body.ratePlanId ?? 'BAR'` (Lock 6).
5. **HTTP `RATE_MISSING` honesty** — explicit 422 branch with `date`; add to 422 list in `mapReservationCommandErrorStatus` (Lock 7).
6. **SPA error copy** for `rate_plan_not_found` / `rate_missing` (Lock 7).
7. Tests Lock 8; no register pin changes expected.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Promo codes (campaign item 9)
- Invoice engine; city ledger / AR
- Collapse split commands; retire `reservations.update_extras`
- Modify-reservation plan change / re-snapshot
- New `GET /quote` or exposing `quoteStay` over HTTP
- Plan-scoped restrictions (`restriction_day.rate_plan_id ≠ '*'`)
- OrgDO chain-wide plans
- Recurring / `breakfast_rule`
- Guest equality leftover; quotes inbox
- Growing `NIGHT_AUDIT_STEPS`
- Moving `[133]` / `[132]` / `[131]` / `[128]` / `[127]`
- Schema migration
- New catalog command / audit writer / `CLASS_DENYLIST` / new `export class`
- Bidirectional leftover pointer sentences (final implementation task)
- `rematerializesRates` consumer
- Tax in the quoted total (ROOM nightly sum in ledger currency only; tax posts at night audit)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Reuse existing routes; no server quote route

**No new catalog id, no new HTTP route, no schema migration, no OrgDO, no night-audit step.**

Reuse:

- `GET /rate-plans` → `listRatePlans` (active only, `ORDER BY code`)
- `GET /rate-days` → `listRateDays`
- `POST /reservations` with optional `ratePlanId`

**Quote = client-side sum** of `listRateDays` `amountMinor` for every stay night in half-open `[arrival, departure)`. Derived plans are already materialized into `rate_day`. **Do not** invent `GET /quote`. **Do not** call PropertyDO `quoteStay` over HTTP this chunk.

### Lock 2 — SPA plan picker (`BookingScreen`)

Add a **Rate plan** field before or alongside room type (placement: implementer’s choice within the existing wizard sections; must appear before the book buttons).

1. **Fetch:** `api.listRatePlans(propertyId)` on mount (same query-key pattern as `RatesScreen` ~193).
2. **Options:** every plan returned (server already filters `status = 'active'`). Include derived children — ordinary active plans.
3. **Label:** exactly `{name} ({code})` — same pattern as room-type radios on this screen (~438: `{t.name} ({code})`). *(Rates matrix plan `<select>` shows `{p.code}` only today ~502–504; booking wizard uses the locked `{name} ({code})` form.)*
4. **Default selection:** `'BAR'` if present in the list; else first plan in list order (`ORDER BY code`).
5. **Control:** native `<select>` inside `Field`, `data-testid="rate-plan"`.
6. **Empty list:** show copy exactly **"No active rate plans."** and disable all three book buttons (`confirm-book`, `hold-book`, `quote-book`).
7. **Date change:** existing behaviour clears room type (~383, ~397); **keep** selected plan.
8. **Plan change:** do **not** clear room type; refetch `listRateDays` with the new `ratePlanId` (include selected plan in `ratesQ` `queryKey`).

### Lock 3 — Quote display

Keep `data-testid="stay-quote"` using `formatMinor` (~16, ~452).

- Query `listRateDays` with the **selected** `ratePlanId`, not hardcoded `'BAR'`.
- Sum every night in `[arrival, departure)`; if any night lacks a row, `stayQuoteMinor === null` and **omit** `stay-quote` (existing behaviour).
- When room type + dates are selected but quote is incomplete, show muted copy exactly: **"No published rate for every night of this stay on this plan."**
- Quote is **ROOM nightly sum in ledger currency**, not tax-inclusive. Tax posts at night audit. Do not invent tax in the wizard.

### Lock 4 — Gate all three buttons on a complete quote

Define `quoteComplete = stayQuoteMinor != null`.

| Button | `data-testid` | Enabled when |
|---|---|---|
| Confirm | `confirm-book` | `quoteComplete` **and** existing confirm preconditions (`quoteAriVersion != null`, room type, guest, dates, party) |
| Hold | `hold-book` | same as Confirm |
| Quote (inquiry) | `quote-book` | `quoteComplete` **and** existing quote preconditions (room type, guest, dates, party — **no** ARI version required) |

Inquiry still does not write `sold` / snapshot nights on the server, but the desk must not book a plan it cannot price.

### Lock 5 — `createReservation` client body

`packages/client-core/src/api.ts` `createReservation`:

- Extend input type with optional `ratePlanId?: string`.
- When the wizard has a selected plan (always once picker exists), include `ratePlanId` on the JSON body (alongside existing fields ~1161–1171).
- Pass `ratePlanId` into `bookingReservationOpId` (Lock 6).

### Lock 6 — Idempotency (load-bearing)

**`bookingReservationOpId`** (`packages/client-core/src/booking.ts`):

- Add optional `ratePlanId?: string` to input.
- Append a new **trailing** segment after existing fields unchanged: `:${ratePlanId ?? 'BAR'}`.
- Example shape after land: `book:{reservationId}:{roomTypeId}:{arrival}:{departure}:{guestRef}:{status}:{adults}:{children}:{ratePlanId}`.

**`handlePostReservations` fingerprint** (~1745–1754):

```ts
ratePlanId: body.ratePlanId ?? 'BAR',
```

Always present in fingerprint. Omit vs explicit `'BAR'` on the wire are the **same** fingerprint.

**`commandPayload`:** unchanged spread — omit `ratePlanId` key when undefined so DO default `DEFAULT_RATE_PLAN_ID` applies identically (~1765).

Different plan + same idempotency key → `IDEM_KEY_REUSED` (409), not silent success.

### Lock 7 — HTTP create errors (honest wire + SPA copy)

**`RATE_PLAN_NOT_FOUND`:** already **404** via `mapReservationCommandErrorStatus` (~350–356). SPA on create failure with `error === 'rate_plan_not_found'`: **"Rate plan unavailable — pick another plan."** Do not auto-retry.

**`RATE_MISSING`:** today falls through generic `{ ok: false, error }` (~1834) and **drops `date`**. Lock:

- Add explicit branch in `handlePostReservations` like `UNBOOKABLE` (~1826–1828):

  ```ts
  if (err === RATE_MISSING) {
    const fail = result as { ok: false; error: typeof RATE_MISSING; date: string };
    return json({ ok: false, error: fail.error, date: fail.date }, 422);
  }
  ```

- Add `RATE_MISSING` to the **422 list** in `mapReservationCommandErrorStatus` (~284–347) so accidental fallthrough is not silent 422 without `date`.
- **Do not** change DO snapshot semantics; `mapReservationPreconditionError` already maps `RateMissingError` (~902).
- SPA copy: **"No rate on {date} for this plan — pick another plan or set rates."** (`{date}` from response body).

Import `RATE_MISSING` in `v1-dispatch.ts` if not already present.

### Lock 8 — Restrictions unchanged

Restrictions stay type-wide `'*'`. Plan picker does **not** add plan-scoped restrictions.

### Lock 9 — Tests (normative)

File-filter vitest. **No `vi.spyOn` into DO isolate.**

**`apps/web-pms/src/screens/BookingScreen.test.tsx`**

Mock `api.listRatePlans` alongside existing mocks (~7–34). Add cases:

1. Picker lists BAR + a derived/CORP plan with `{name} ({code})` labels.
2. Selecting CORP refetches `listRateDays` with that `ratePlanId`.
3. `createReservation` body includes `ratePlanId` matching selection.
4. Confirm disabled when quote incomplete (missing night on selected plan).
5. Empty plans list → **"No active rate plans."** and all three buttons disabled.
6. Create error `rate_missing` with `date` → locked copy.
7. Create error `rate_plan_not_found` → locked copy.

**`packages/client-core/test/booking.test.ts`**

1. `bookingReservationOpId` changes when `ratePlanId` changes.
2. Omit `ratePlanId` → trailing segment `:BAR`.

**`packages/client-core/test/api.test.ts`**

1. `createReservation` JSON includes `ratePlanId` when provided in input.

**`apps/pms-core/test/reservations-routes.spec.ts`** (owns `POST /reservations` HTTP — Test 1 ~135+)

Extend (do not add a new file unless necessary):

1. HTTP create with non-BAR `ratePlanId` persists on reservation row / snapshot nights.
2. Fingerprint: omit `ratePlanId` vs explicit `'BAR'` → same idempotency acceptance.
3. Same key, different `ratePlanId` → `idempotency_key_reused`.
4. HTTP create with valid plan but missing `rate_day` night → **422** `{ ok: false, error: 'rate_missing', date }` (mirror `folio-quote-snapshot.spec.ts` Test 44 pattern ~33–49 at HTTP layer).

Rebuild `@hospai/client-core` before web-pms tests; `@hospai/contracts` before pms-core if dispatch imports change.

**Register pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — this chunk should **not** need register changes.

---

## 3. Implementation pointers (non-normative)

Suggested `BookingScreen` state: `ratePlanId` string, initialized after plans load (`BAR` or first).

`ratesQ.queryKey` should include `ratePlanId`:

```ts
queryKey: ['rate-days', propertyId, arrivalDate, lastNight, roomTypeId, ratePlanId],
```

`bookMutation` passes `ratePlanId` into both `bookingReservationOpId` and `createReservation`.

Error handlers in `onError` (~286+): add branches before generic fallback for `rate_missing` and `rate_plan_not_found`.

Optional: update stale JSDoc on `tryCreateReservation` fingerprint (~7377) — not required for acceptance.

---

## 4. File-level impact

| Area | Touch |
|---|---|
| `apps/web-pms/src/screens/BookingScreen.tsx` | Plan picker, quote from selected plan, button gates, error copy |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | Lock 9 RTL cases |
| `packages/client-core/src/booking.ts` | `bookingReservationOpId` + `ratePlanId` segment |
| `packages/client-core/src/api.ts` | `createReservation` body + input type |
| `packages/client-core/test/booking.test.ts` | OpId cases |
| `packages/client-core/test/api.test.ts` | JSON body case |
| `apps/pms-core/src/v1-dispatch.ts` | Fingerprint + `RATE_MISSING` branch + map list |
| `apps/pms-core/test/reservations-routes.spec.ts` | HTTP create + fingerprint + `rate_missing` |

**Not touched:** `property-migrations.ts`, `catalog.ts`, `v1-http-routes.ts`, `property-do.ts` (behaviour already correct), `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, demo seed, ARCHITECTURE.md.

---

## 5. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Modify-reservation plan change / re-snapshot** | Create path only this chunk |
| 2 | **Guest equality lookup** | [booking wizard](./2026-08-11-booking-wizard-design.md) leftover **2** (~288) |
| 3 | **Fingerprint field-set export to contracts** | [booking wizard](./2026-08-11-booking-wizard-design.md) leftover **4** (~290) — opId still mirrors inline dispatch literal |
| 4 | **SPA date-helper gate counterpart** | [booking wizard](./2026-08-11-booking-wizard-design.md) leftover **5** (~291) |
| 5 | **`reservations.update_extras` retirement** | booking-wizard leftover **7** / lifecycle leftover **7** |
| 6 | **Quotes inbox** | lifecycle leftover **8** (~856) |
| 7 | **Promo codes** | campaign scope-out |
| 8 | **Tax in wizard total** | Explicitly out — night audit posts tax |
| 9 | **Plan-scoped restrictions** | Explicitly out |
| 10 | **New `GET /quote` / HTTP `quoteStay`** | Explicitly out |

---

## 6. Implementation checklist

- [ ] SPA: `listRatePlans` + `data-testid="rate-plan"` select; default BAR; empty-list copy; date/plan change rules (Lock 2)
- [ ] SPA: quote from selected plan; incomplete copy; `stay-quote` gate (Lock 3–4)
- [ ] SPA: create passes `ratePlanId`; error copy for `rate_plan_not_found` / `rate_missing` (Lock 5, Lock 7)
- [ ] Client: `createReservation` JSON + `bookingReservationOpId` segment (Lock 5–6)
- [ ] Dispatch: fingerprint `ratePlanId: body.ratePlanId ?? 'BAR'`; `RATE_MISSING` 422 + `date`; map list entry (Lock 6–7)
- [ ] Tests Lock 9 (web-pms, client-core, `reservations-routes.spec.ts`)
- [ ] CI: file-filter vitest; `--shard=N/8` with **no** `--` before `--shard`; Workerd 503 → retry that shard once; never `|| true`; never unsharded `pnpm --filter @hospai/pms-core test`
- [ ] Living plan checkboxes: tick `- [x]` on **last task only**
- [ ] Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — expect no changes
- [ ] Bidirectional closes pointers in booking-wizard + lifecycle + property-setup specs (final implementation task)

---

## 7. Tree conflicts with reviewer locks

**None on heads.** Verified post-`40793b5`: catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, `PROPERTY_SCHEMA_HEAD` **30**, `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1087), `PLATFORM_GAPS === []`, create path already stores `rate_plan_id` and snapshots for pending/confirmed.

**Notes for implementer (not lock violations):**

1. **`holdReservation` already accepts `ratePlanId` in `extra`** (~1190–1200) — out of scope; wizard uses create-only path for all three statuses.
2. **Derived plan DO proof exists** (`derived-rate-plans.spec.ts` ~357–371); HTTP + SPA wiring is this chunk’s gap.
3. **`RatesScreen` matrix selector** uses code-only labels (~502–504); booking picker uses locked `{name} ({code})` per product lock.
4. **`tryCreateReservation` JSDoc fingerprint** (~7377) is stale relative to HTTP fingerprint — optional doc fix only.
5. **`RATE_MISSING` at HTTP** must preserve `date` in JSON; SPA depends on it for copy.

**Concerns:**

| Concern | Mitigation locked |
|---|---|
| Desk books unpriced plan | All three buttons gated on `stayQuoteMinor != null` |
| Plan change idempotency collision | Fingerprint + opId always include normalized plan id |
| Missing rate returns opaque error | Explicit HTTP branch + SPA copy with `date` |
| Operator sees code-only plan names | `{name} ({code})` labels on picker |
