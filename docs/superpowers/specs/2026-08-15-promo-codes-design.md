# Promo codes (rate derivation graph)

**Tree verified 2026-08-15 (post booking plan picker close `2a25ebd`):** `COMMAND_CATALOG` length **81** (`register.test.ts` ~679), `AUDIT_WRITER_COMMAND_IDS.size === 56` (`register.test.ts` ~269 and ~678), `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'` (`register.test.ts` ~670–675; `v1-http-routes.ts` ~786–791), `[132] delete_room` (~663–668; `v1-http-routes.ts` ~779–784), `[131] post_folio_routing_rule_archive` (~656–661), `[128] post_folio_stay_discount` (~634–638), `[127] post_demo_seed` (~620–624), `PROPERTY_SCHEMA_HEAD === 30` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~627–628), `PROPERTY_MIGRATIONS` tail v30 `derived_rate_plans` ~1186–1188 (`property-migrations.ts`), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1083–1092), `PLATFORM_GAPS === []` (`register.test.ts` ~680), catalog last entry `folio.reconcile_payment` ~897–909 (`catalog.ts`), `rates.create_plan` / `update_plan` / `delete_plan` ~683–711, HTTP `post_rate_plans` / `patch_rate_plan` / `delete_rate_plan` / `get_rate_plans` ~193–216 (`v1-http-routes.ts`), `rate_plan_code_active` ~355 (`property-migrations.ts`), `reservation.rate_plan_id NOT NULL DEFAULT 'BAR'` ~604, `DEFAULT_RATE_PLAN_ID = 'BAR'` ~6, `rateDayAmountSync` ~6940–6951 / `snapshotRateNightsSync` ~6963–6982 / `syncReservationRateNightsOnModifySync` ~7064–7094 / `tryCreateReservation` ~7380–7523 / `tryConfirm` snapshot ~7663–7668 / `tryHold` snapshot ~7798–7803 / `postRoomChargesSync` → `rateNightAmountSync` ~13532–13555 (`property-do.ts`), `roundHalfAwayFromZero` ~123–128 (`packages/money/src/index.ts`), `handlePostReservations` body + fingerprint ~1714–1771 (`v1-dispatch.ts`), `mapReservationCommandErrorStatus` ~280–363, `RATE_PLAN_NOT_FOUND` / `RATE_PLAN_CODE_EXISTS` ~97–98 (`idempotency.ts`), `RatePlanNotFoundError` ~465–469 (`property-do.ts`), `event-consumer.ts` `rate_plan.changed` noop ~139, `EXCLUDED_PROTOTYPE_KEYS` includes `pms_promo_catalog` ~63 (`register.ts`), `PROPERTY_PURGE_INVENTORY_TABLES` ~1217–1248 (`property-do.ts`), `RatesScreen` plans tab ~309+ (`apps/web-pms/src/screens/RatesScreen.tsx`), `BookingScreen` plan picker + quote ~126–156 / ~444–468 (`apps/web-pms/src/screens/BookingScreen.tsx`), `bookingReservationOpId` ~25–40 / `createReservation` ~1142–1175 (`packages/client-core`), ARCHITECTURE §7.2 derivation chain ~1209, folio-money §7.4 promo defer ~390–399, stay-level-discounts §9 item **4** ~352.

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §7.2 (`base rate → derived → seasonal override → LOS discount → promo` ~1209); [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.4 promo defer (~390–399); [stay-level discounts](./2026-08-14-stay-level-discounts-design.md) (folio `DISCOUNT` lines shipped — **not this chunk**); [derived rate plans](./2026-08-15-derived-rate-plans-design.md) (materialized `rate_day`); [booking plan picker](./2026-08-15-booking-plan-picker-design.md) (priced wizard + `ratePlanId` on create); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (`reservation_rate_night` snapshot); `packages/money`; `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `apps/pms-core/src/v1-dispatch.ts`; `packages/client-core/src/api.ts`; `apps/web-pms/src/screens/RatesScreen.tsx`; `apps/web-pms/src/screens/BookingScreen.tsx`.

**Closes:** [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **7** (§7.4 promo defer ~390–399). [stay-level discounts](./2026-08-14-stay-level-discounts-design.md) leftover **4** (§9 item **4** ~352). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

**Amends:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.4 (~390–399) (closed). [stay-level discounts](./2026-08-14-stay-level-discounts-design.md) §9 item **4** (~352) (closed). [booking plan picker](./2026-08-15-booking-plan-picker-design.md) §5 leftover **7** (promo codes — closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

ARCHITECTURE §7.2 places **promo** on the rate **derivation graph**, after derived plans and before folio posting. Folio-money §7.4 deferred promo because it belongs at snapshot time, needs a code registry, and must not invent a `PROMO` charge code that nothing honours.

Derived rate plans (`40793b5`) materialize percent-of-parent into `rate_day`. The booking plan picker (`2a25ebd`) sells those plans from the desk. **Promo is the next graph node:** a property-local **code** that adjusts the **snapshotted nightly amount** at book — not a folio `DISCOUNT` line.

Stay-level folio discounts (`c0dace7`) post lump `DISCOUNT` lines on the GUEST window. **This chunk is orthogonal:** night-audit `POST_ROOM_CHARGES` already reads `reservation_rate_night` via `rateNightAmountSync` (~6985–7011, ~13550–13555). Promo-priced snapshots flow through unchanged; no new charge code, no folio posting.

`pms_promo_catalog` stays in `EXCLUDED_PROTOTYPE_KEYS` (~63) — promo is a real PropertyDO `promo` table, not a config bag.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Materialized `rate_day` + derived plans | [derived rate plans](./2026-08-15-derived-rate-plans-design.md); `rateDayAmountSync` ~6940 |
| Plan picker + client quote | [booking plan picker](./2026-08-15-booking-plan-picker-design.md); `BookingScreen` ~126–156 |
| Create accepts `ratePlanId?` | `handlePostReservations` ~1718–1770; `tryCreateReservation` ~7391, ~7452 |
| Snapshot on pending/confirmed create | `snapshotRateNightsSync` ~7522–7523 |
| Inquiry / hold / confirm snapshot on commit | `tryConfirm` ~7663–7668; `tryHold` ~7798–7803; inquiry create skips snapshot |
| Modify adds nights via snapshot helper | `syncReservationRateNightsOnModifySync` ~7064–7094 |
| Night audit ROOM from snapshot | `postRoomChargesSync` → `rateNightAmountSync` ~13550–13555 |
| Stay-level folio DISCOUNT | `folio.post_discount` / `tryPostDiscount` — separate layer |
| Rate plan CRUD + archive pattern | `tryCreateRatePlan` ~10723+; `tryDeleteRatePlan` archive; `rate_plan_code_active` ~355 |
| Plan HTTP + permissions | `rates:read` / `rates:write`; `get_rate_plans` degradedRead ~211–216 |
| Money rounding | `roundHalfAwayFromZero` ~123 (`packages/money`) |
| Catalog / route heads | Last catalog `folio.reconcile_payment` ~897–909; last route `[133]` |

**Heads (frozen — this chunk moves catalog, writers, routes, property schema):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **81** | **84** — append `rates.create_promo`, `rates.update_promo`, `rates.archive_promo` **after** `folio.reconcile_payment` |
| `AUDIT_WRITER_COMMAND_IDS.size` | **56** | **59** (+ those three) |
| `V1_HTTP_ROUTE_AUDIT` | `[133] = post_folio_reconcile_payment` | **APPEND** `[134] get_rate_promos`, `[135] post_rate_promos`, `[136] patch_rate_promo`, `[137] delete_rate_promo` — **`[133]`/`[132]`/`[131]`/`[128]`/`[127]` unmoved** |
| `PROPERTY_SCHEMA_HEAD` | **30** | **31** — `promo` table + `reservation.promo_id` |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — `[3] === 'AUTO_TRANSFER'` |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

**Not a new command:** `reservations.create` stays the catalog id — optional `promoCode` on the existing HTTP body / DO input only.

### 1.2 Scope in

1. **v31 migration** — `promo` table + `reservation.promo_id` (Lock 2–3).
2. **`applyPromoToAmountMinor`** in `@hospai/money` (Lock 4).
3. **Promo CRUD** — DO RPCs, three catalog commands, four HTTP routes, audit writers, wire codes (Lock 5–6).
4. **Create / hold / confirm** — resolve promo, snapshot adjusted nights, store `promo_id` (Lock 7–8).
5. **Modify dates** — new nights re-apply stored promo (Lock 9).
6. **Client + SPA** — Rates catalog UI, Booking promo field + quote (Lock 10–11).
7. **Purge inventory** + `pnpm generate:ddl` (Lock 12).
8. Tests Lock 13; register + migrate pin updates.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- LOS discounts; seasonal override as a first-class table (operator `rate_day` edits remain the seasonal path)
- Stacking multiple promos; stacking **policy** vs stay-level folio `DISCOUNT` (both allowed this chunk; named leftover)
- One-use / redemption inventory / guest-unique promos
- Channel / OTA / booking-engine promo ingestion
- OrgDO / chain-wide promo registry
- Folio `DISCOUNT` / `PROMO` charge code seeding or posting
- `GET /quote` HTTP route
- Modify-reservation apply / remove / change promo after create
- Plan-scoped **restrictions** (`restriction_day.rate_plan_id ≠ '*'`)
- Invoices; city ledger / AR; split-command collapse; `reservations.update_extras`
- Growing `NIGHT_AUDIT_STEPS`; moving `[133]`–`[127]`
- `CLASS_DENYLIST` edit; new `export class` except internal error classes matching `RatePlanNotFoundError` (~465) pattern
- `pms_promo_catalog` config key consumer
- Bidirectional leftover pointer sentences (final implementation task)
- Recurring / `breakfast_rule`; tax in wizard total
- Demo seed promo (optional; not required for acceptance)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Rate-graph layer; not folio money

Promo adjusts **`reservation_rate_night.amount_minor` at snapshot time** (create pending/confirmed; inquiry stores `promo_id` only; hold/confirm snapshot with promo applied).

**Forbidden this chunk:**

- Folio `DISCOUNT` or `PROMO` charge-code lines for promo
- Night-audit step changes
- Re-pricing posted ROOM lines when a promo is applied retroactively

Night audit `POST_ROOM_CHARGES` continues to use `rateNightAmountSync` (~13550), which prefers the snapshotted row (~6991–6998). Promo is frozen in the snapshot; audit posts that amount.

Stay-level folio discounts (`folio.post_discount`) remain valid on the same stay — stacking **policy** (folio discount vs graph promo) is a named leftover, not resolved here.

### Lock 2 — Property-local `promo` table (v31)

Append to `PROPERTY_MIGRATIONS`; regenerate `migrations/do-property/0031_promo_codes.sql`:

```sql
CREATE TABLE promo (
  promo_id       TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  kind           TEXT NOT NULL
                 CHECK (kind IN ('percent', 'fixed_per_night')),
  bps            INTEGER,
  amount_minor   INTEGER,
  valid_from     TEXT,
  valid_to       TEXT,
  rate_plan_id   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (
    (kind = 'percent' AND bps IS NOT NULL AND bps >= 1 AND bps <= 10000
     AND amount_minor IS NULL)
    OR
    (kind = 'fixed_per_night' AND amount_minor IS NOT NULL AND amount_minor > 0
     AND bps IS NULL)
  ),
  CHECK (
    (valid_from IS NULL AND valid_to IS NULL)
    OR (valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_from <= valid_to)
  )
);

CREATE UNIQUE INDEX promo_code_active ON promo(code) WHERE status = 'active';

ALTER TABLE reservation ADD COLUMN promo_id TEXT;
```

**Semantics:**

| Column | Meaning |
|---|---|
| `code` | Stored **trimmed uppercase ASCII** at write time; after normalize must match `^[A-Z0-9][A-Z0-9_-]{0,31}$` |
| `status` | `active` \| `archived` — archive, never SQL `DELETE` |
| `kind` | `percent` (basis points off nightly) or `fixed_per_night` (minor units subtracted per night) |
| `bps` | Required iff `percent`; 1–10000 (1500 = 15% off) |
| `amount_minor` | Required iff `fixed_per_night`; > 0 |
| `valid_from` / `valid_to` | `YYYY-MM-DD`; both null = always valid; if either set, both required |
| `rate_plan_id` | `NULL` = all active plans; else **exact** plan id match only (derived children **not** auto-included) |

**No FK** to `rate_plan` (deploy-safety like `rate_day` → `rate_plan`).

**Normalization helper** (DO + dispatch + SPA):

```ts
function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}
```

Empty after trim ⇒ no promo (same as omit).

**Code charset (after normalize):**

- Stored and looked-up codes must match `^[A-Z0-9][A-Z0-9_-]{0,31}$`.
- **CRUD create/update:** charset mismatch → HTTP **400** `{ error: 'invalid_body' }`.
- **Book:** empty after normalize ⇒ omit (no promo); non-empty value failing charset ⇒ **`promo_not_found`** **404** (not `invalid_body`).

### Lock 3 — `reservation.promo_id`; one promo per stay

v31 adds nullable `reservation.promo_id TEXT`. At most one promo per reservation. **No stacking** multiple codes.

When create resolves a promo, persist `promo_id` on the reservation row for **all** statuses (including `inquiry`). When absent/blank `promoCode`, `promo_id` stays `NULL`.

### Lock 4 — Apply math (`@hospai/money`)

Shared **pure** export used by PropertyDO and `apps/web-pms` (add workspace `@hospai/money` dependency to `web-pms` if missing — **do not** add money to `client-core` unless unavoidable):

```ts
export type PromoKind = 'percent' | 'fixed_per_night';

export type PromoApplyInput =
  | { kind: 'percent'; bps: number }
  | { kind: 'fixed_per_night'; amountMinor: number };

export function applyPromoToAmountMinor(
  amountMinor: number,
  promo: PromoApplyInput,
): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new InvalidMoneyError('amountMinor must be a non-negative integer');
  }
  if (promo.kind === 'percent') {
    const discounted = Number(
      roundHalfAwayFromZero(
        BigInt(amountMinor) * BigInt(10_000 - promo.bps),
        10_000n,
      ),
    );
    return Math.max(0, discounted);
  }
  return Math.max(0, amountMinor - promo.amountMinor);
}
```

Import `roundHalfAwayFromZero` from the same package (~123). Reject non-safe-integer results (`InvalidMoneyError`). **Currency unchanged.** Apply **per stay night** after reading `rate_day` (derived plans already materialized).

**Examples (tests must assert):**

| Input | Promo | Output |
|---|---|---|
| `10000` | percent `1500` bps | `8500` |
| `500` | fixed_per_night `800` | `0` (floor) |
| `10000` | percent `10000` bps | `0` |

### Lock 5 — Applicability at book (DO)

Resolve promo by normalized code among **`status = 'active'`** rows.

| Condition | Wire code | HTTP |
|---|---|---|
| Unknown code or `status = 'archived'` | `promo_not_found` (`PROMO_NOT_FOUND`) | **404** |
| Known active but plan mismatch | `promo_not_applicable` (`PROMO_NOT_APPLICABLE`) | **422** |
| Known active but any stay night outside `[valid_from, valid_to]` when window set | `promo_not_applicable` | **422** |
| Duplicate active `code` on create | `promo_code_exists` (`PROMO_CODE_EXISTS`) | **409** |

**Plan rule:** when `promo.rate_plan_id` is non-null, it must **equal** the reservation’s `rate_plan_id` (after default `BAR`).

**Date rule:** for half-open stay `[arrival, departure)`, **every** night must satisfy `valid_from <= night <= valid_to` when the window columns are set.

Add constants to `packages/contracts/src/idempotency.ts` adjacent to rate-plan codes (~97–102):

```ts
export const PROMO_NOT_FOUND = 'promo_not_found' as const;
export const PROMO_NOT_APPLICABLE = 'promo_not_applicable' as const;
export const PROMO_CODE_EXISTS = 'promo_code_exists' as const;
```

Map in `mapReservationCommandErrorStatus` (~280–363): `PROMO_NOT_APPLICABLE` → **422** list; `PROMO_NOT_FOUND` → **404** list (with `RATE_PLAN_NOT_FOUND` ~353); `PROMO_CODE_EXISTS` → **409** branch (alongside `IDEM_KEY_REUSED` ~280–282). Do **not** bucket `PROMO_CODE_EXISTS` with `RATE_PLAN_CODE_EXISTS` in the **422** list (~322). Promo CRUD HTTP handlers map duplicate active code to **409** directly.

Internal DO errors: `PromoNotFoundError`, `PromoNotApplicableError`, `PromoCodeExistsError` — same non-export pattern as `RatePlanNotFoundError` (~465).

### Lock 6 — Promo catalog CRUD

**Three catalog commands** appended **after** `folio.reconcile_payment` (~897–909):

| Command id | Lane | Degraded | Permission | Events |
|---|---|---|---|---|
| `rates.create_promo` | INTERACTIVE | FAIL_CLOSED | `rates:write` | `['rate_promo.changed']` |
| `rates.update_promo` | INTERACTIVE | FAIL_CLOSED | `rates:write` | `['rate_promo.changed']` |
| `rates.archive_promo` | INTERACTIVE | FAIL_CLOSED | `rates:write` | `['rate_promo.changed']` |

All **`entitlement: 'pms.core'`**, **`idempotent: true`**. Add all three to `AUDIT_WRITER_COMMAND_IDS` → size **59**.

**Four HTTP routes** appended after `[133]`:

| Audit id | Method | Path | Permission | commandId |
|---|---|---|---|---|
| `get_rate_promos` | GET | `/v1/properties/:propertyId/rate-promos` | `rates:read` | — (`degradedRead: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`) |
| `post_rate_promos` | POST | `/v1/properties/:propertyId/rate-promos` | `rates:write` | `rates.create_promo` |
| `patch_rate_promo` | PATCH | `/v1/properties/:propertyId/rate-promos/:promoId` | `rates:write` | `rates.update_promo` |
| `delete_rate_promo` | DELETE | `/v1/properties/:propertyId/rate-promos/:promoId` | `rates:write` | `rates.archive_promo` |

**DO RPCs:**

- `tryCreatePromo` — normalize code; reject duplicate active code → `PROMO_CODE_EXISTS`
- `tryUpdatePromo` — name, date window, plan scope, bps/amount (kind immutable after create); re-validate pairing
- `tryArchivePromo` — `status = 'archived'`; **never SQL DELETE** (mirror `tryDeleteRatePlan` archive)
- `listRatePromos` — active promos only, `ORDER BY code`; JSON fields: `promoId`, `code`, `name`, `kind`, `bps`, `amountMinor`, `validFrom`, `validTo`, `ratePlanId`

**Archive reuse:** after archive, the same normalized code may be created again on a new row → **201** (partial unique index allows).

**Event consumer:** add `rate_promo.changed` noop case beside `rate_plan.changed` (~139).

**No system promo to protect** (contrast BAR on rate plans).

### Lock 7 — Create path (`reservations.create`)

**HTTP** `POST /reservations` — optional body field `promoCode?: string` (~1718+).

1. If omitted, empty, or whitespace-only after trim → **no promo**; omit `promoCode` from fingerprint and command payload.
2. Else normalize with `normalizePromoCode`; resolve active promo; run Lock 5 applicability against `{ ratePlanId, arrivalDate, departureDate, nights }`.
3. On success set `reservation.promo_id`; on failure return mapped wire code.

**Fingerprint** (~1747–1757) — add when normalized code non-empty:

```ts
...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
```

Omit vs blank → **same** fingerprint. Different normalized code under same idempotency key → `IDEM_KEY_REUSED` (**409**).

**Command payload:** spread `promoCode: normalizedPromoCode` only when present (DO resolves to `promo_id`).

**`bookingReservationOpId`** — when normalized promo present, append trailing `:${normalizedPromoCode}` after existing segments (~25–40); omit segment when no promo (do **not** send a sentinel).

**Snapshot:** extend `snapshotRateNightsSync` (or wrapper) to accept resolved promo (or apply after each `rateDayAmountSync`):

```ts
const base = this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate);
const amount = promo ? applyPromoToAmountMinor(base, promoApplyInput) : base;
```

Call for `pending` / `confirmed` create (~7522–7523). **Inquiry** stores `promo_id` but **does not** snapshot nights (existing inquiry rule).

### Lock 8 — Hold / confirm from inquiry

When `tryHold` / `tryConfirm` first commits inventory and calls `snapshotRateNightsSync` (~7798–7803, ~7663–7668):

- Read `reservation.promo_id` from the row (set at inquiry/create).
- If non-null, load promo; re-validate Lock 5 applicability to stay nights and current `rate_plan_id`.
- Snapshot with promo applied per Lock 4.
- If promo archived or night outside window at commit time → **`promo_not_applicable` 422** (do not silently drop).

Wizard **hold** / **confirm** paths that go through `POST /reservations` with `status: 'pending'|'confirmed'` apply promo at create time (Lock 7). Separate `POST .../hold` / `.../confirm` on an inquiry must honour stored `promo_id`.

### Lock 9 — Modify dates (`reservations.modify`)

In `syncReservationRateNightsOnModifySync` (~7064–7094):

- **Overlapping** nights: **keep** existing `reservation_rate_night` rows (already promo-priced).
- **Added** nights: read current `rate_day` via `rateDayAmountSync`, then apply **stored** `reservation.promo_id` if non-null (reload promo row; Lock 5 per added night).
- If stored promo is archived or added night fails date/plan rules → **`promo_not_applicable` 422** — do not silently book unrated promo nights.

**Out:** removing, changing, or adding a promo on modify — named leftover.

### Lock 10 — SPA Rates (`RatesScreen`)

Extend **`RatesScreen`** plans area (~309+) — new **Promo codes** catalog section (same screen, below or beside plan table; implementer chooses layout within existing plans tab).

**List:** active promos as `{code} — {name}` (e.g. `SUMMER15 — Summer 15% off`).

**Create form fields:** code, name, kind (`percent` \| `fixed_per_night`), bps or amount (minor units for fixed), optional `validFrom` / `validTo`, optional plan select (empty = all plans).

**Archive:** per-row archive action → `DELETE` HTTP (archive command). Copy kept short.

**`data-testid` prefix:** `promo-` (e.g. `promo-code-input`, `promo-create`, `promo-list`, `promo-archive-{code}`).

**Client:** `listRatePromos`, `createRatePromo`, `updateRatePromo`, `archiveRatePromo` in `client-core` `api.ts` (mirror rate-plan client shape).

### Lock 11 — SPA Booking (`BookingScreen`)

Optional field `data-testid="promo-code"` (text input) in the booking wizard (~444+ section area).

1. Fetch `listRatePromos` on mount (alongside `listRatePlans` ~164–168).
2. Maintain normalized promo string state (trim+uppercase on change/blur).
3. **Quote:** when field non-empty after normalize, resolve against fetched promos + Lock 5 rules client-side (plan + dates). When matched, `stayQuoteMinor` (~139–156) sums `applyPromoToAmountMinor(amountMinor, promo)` per night — import from `@hospai/money`. **Complete quote still required** (all nights have `rate_day`).
4. **Gate buttons:** if field non-empty and no applicable active promo → disable **`confirm-book`**, **`hold-book`**, **`quote-book`** and show exactly one of:
   - **"Promo code not found."** — no active row matches normalized code, or non-empty normalized value fails charset `^[A-Z0-9][A-Z0-9_-]{0,31}$`
   - **"Promo does not apply to this stay."** — code exists but plan or date window fails
5. When matched, pass `promoCode: normalizedCode` on `createReservation` (~1142+). Empty field → **omit** `promoCode` key (no promo).

Do **not** block booking when field is empty.

### Lock 12 — Purge + DDL

Add `'promo'` to `PROPERTY_PURGE_INVENTORY_TABLES` (~1217) **immediately before** `'rate_day'` (alphabetical among rate tables).

Run `pnpm generate:ddl` → `0031_promo_codes.sql`; migrate test pin `PROPERTY_SCHEMA_HEAD === 31`.

### Lock 13 — Tests (normative)

File-filter vitest. **No `vi.spyOn` into DO isolate.**

**`packages/money/src/index.test.ts`** (extend):

1. Percent: `10000` at `1500` bps → `8500`
2. Fixed: floors at `0`
3. Percent: `10000` bps → `0`

**`apps/pms-core/test/promo-codes.spec.ts`** (new) or extend **`reservations-routes.spec.ts`**:

1. Create promo; list returns row
2. Duplicate active code → **409** `promo_code_exists`
3. Archive then reuse same code → **201**
4. Create reservation with promo → `promo_id` set; `reservation_rate_night` amounts adjusted; night audit ROOM uses snapshot
5. Fingerprint: omit vs blank `promoCode` → same acceptance
6. Same key, different normalized code → `idempotency_key_reused`
7. Inapplicable plan / dates → **422** `promo_not_applicable`
8. Unknown / archived code → **404** `promo_not_found`
9. Inquiry with promo → `promo_id` set, **no** snapshot rows; confirm → adjusted snapshot

**`apps/web-pms/src/screens/RatesScreen.test.tsx`:**

1. Create promo via form
2. Archive promo

**`apps/web-pms/src/screens/BookingScreen.test.tsx`:**

1. Apply `SUMMER15` to BAR quote — `stay-quote` reflects discounted sum
2. Empty promo field — `createReservation` body omits `promoCode`
3. Invalid promo — all three book buttons disabled + locked copy

Rebuild `@hospai/money` before pms-core / web-pms; `@hospai/contracts` before pms-core if dispatch imports change.

**Register pins after land:**

- `COMMAND_CATALOG.length === 84`
- `AUDIT_WRITER_COMMAND_IDS.size === 59`
- `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'` (unchanged)
- `V1_HTTP_ROUTE_AUDIT[134].id === 'get_rate_promos'` … `[137].id === 'delete_rate_promo'`
- `PROPERTY_SCHEMA_HEAD === 31`
- `ORG_SCHEMA_HEAD === 7`
- `NIGHT_AUDIT_STEPS.length === 8`

**Register pin command (plan):** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **will need pin updates** for catalog **84**, writers **59**, routes **[134]–[137]**.

**CI notes (plan only — do not run in spec land):** file-filter vitest; `--shard=N/8` with **no** `--` before `--shard`; Workerd 503 → retry that shard once; never `|| true`; never unsharded `pnpm --filter @hospai/pms-core test`; living plan checkboxes tick `- [x]` on **last task only**.

---

## 3. Implementation pointers (non-normative)

Suggested PropertyDO helpers adjacent to rate plan RPCs (~10723+):

```ts
private normalizePromoCodeSync(raw: string): string { /* Lock 2 */ }
private resolvePromoByCodeSync(code: string): PromoRow | null
private assertPromoApplicableSync(promo: PromoRow, ratePlanId: string, nights: string[]): void
private promoApplyInputFromRowSync(row: PromoRow): PromoApplyInput
private snapshotRateNightsWithPromoSync(
  reservationId: string,
  roomTypeId: string,
  ratePlanId: string,
  nights: string[],
  promo: PromoRow | null,
): void
```

Hook create (~7522), hold/confirm snapshot paths (~7663, ~7798), and modify added nights (~7093).

**Index:** `promo_code_active` partial unique (Lock 2 DDL).

**Optional demo seed:** active `SUMMER15` percent promo on BAR — helpful for manual QA; not acceptance-critical if tests cover behaviour.

---

## 4. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v31 statements + `PROPERTY_MIGRATIONS` tail |
| `migrations/do-property/0031_promo_codes.sql` | generated |
| `packages/money/src/index.ts` | `applyPromoToAmountMinor` + tests |
| `packages/contracts/src/idempotency.ts` | three wire codes |
| `packages/contracts/src/commands/catalog.ts` | +3 commands after `folio.reconcile_payment` |
| `packages/contracts/src/commands/audit-writers.ts` | +3 writer ids |
| `packages/contracts/src/v1-http-routes.ts` | +4 routes after `[133]` |
| `packages/contracts/src/register.test.ts` | pin updates |
| `packages/do-runtime/src/migrate.test.ts` | schema head **31** |
| `apps/pms-core/src/property-do.ts` | promo RPCs, snapshot/modify/create, purge list |
| `apps/pms-core/src/v1-dispatch.ts` | four handlers + create `promoCode` + error map |
| `apps/pms-core/src/event-consumer.ts` | `rate_promo.changed` noop |
| `packages/client-core/src/api.ts` | promo CRUD + `createReservation` `promoCode?` |
| `packages/client-core/src/booking.ts` | optional opId promo segment |
| `apps/web-pms/package.json` | `@hospai/money` dependency if missing |
| `apps/web-pms/src/screens/RatesScreen.tsx` | promo catalog section |
| `apps/web-pms/src/screens/BookingScreen.tsx` | promo field + quote gate |
| `apps/pms-core/test/promo-codes.spec.ts` | Lock 13 DO/HTTP |
| `apps/web-pms/src/screens/RatesScreen.test.tsx` | Lock 13 SPA rates |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | Lock 13 SPA booking |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `ARCHITECTURE.md`, folio charge-code seed, `pms_promo_catalog` config register.

---

## 5. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Modify-reservation promo apply / remove / change** | Create + date-extend re-apply only (Lock 9) |
| 2 | **Stacking policy: graph promo + folio stay DISCOUNT** | Both layers allowed; interaction unnamed |
| 3 | **Multiple promo codes per stay** | Explicitly out |
| 4 | **One-use / redemption limits / guest-unique** | Registry extension |
| 5 | **OrgDO / chain-wide promo** | Property-local only this chunk |
| 6 | **LOS discount graph node** | ARCHITECTURE §7.2 — not this chunk |
| 7 | **Seasonal override as first-class table** | `rate_day` edits remain |
| 8 | **Channel / OTA promo ingestion** | Out |
| 9 | **Tax in wizard total** | ROOM sum only; tax at night audit |
| 10 | **`GET /quote` HTTP** | Client sum remains |

---

## 6. Implementation checklist

- [ ] v31 migration + `PROPERTY_SCHEMA_HEAD` **31** + purge `promo` table
- [ ] `@hospai/money` `applyPromoToAmountMinor` + unit tests
- [ ] Wire codes + HTTP status map (`PROMO_*`)
- [ ] Catalog **84** + audit writers **59** + four HTTP routes **[134]–[137]**
- [ ] DO promo CRUD + `listRatePromos`; event allowlist + consumer noop
- [ ] Create / hold / confirm / modify snapshot paths with promo
- [ ] `POST /reservations` `promoCode` + fingerprint + client opId segment
- [ ] SPA Rates promo catalog + SPA Booking promo field / quote / gates
- [ ] Tests Lock 13; `pnpm generate:ddl`
- [ ] Register pins: catalog **84**, writers **59**, `[133]` unchanged, `[134]–[137]`, schema **31**, steps **8**
- [ ] CI: file-filter vitest; shard syntax; Workerd retry; last-task checkbox only
- [ ] Bidirectional closes pointers in folio-money-ops + stay-level-discounts + booking-plan-picker specs (final implementation task)

---

## 7. Tree conflicts with reviewer locks

**None on heads.** Verified post-`2a25ebd`: catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, `PROPERTY_SCHEMA_HEAD` **30** (this chunk → **31**), `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1087), `PLATFORM_GAPS === []`, derived + plan picker shipped, snapshot + night-audit path ready, folio stay DISCOUNT separate, `pms_promo_catalog` still excluded (~63).

**Notes for implementer (not lock violations):**

1. **Percent bps direction** — promo bps are **off** (1500 → pay 85%), unlike derived plan `derive_bps` which can be negative; UI labels must not conflate.
2. **Plan-scoped promo on derived plan id** — exact match only; promo on `BAR` does not auto-apply to `BAR-15` child plan id.
3. **`web-pms` has no `@hospai/money` today** — add workspace dep for quote preview (Lock 11).
4. **Inquiry → confirm** must re-check promo applicability; do not assume inquiry-time validity at commit.
5. **Modify shrink** — removed nights still follow existing delete rules in `syncReservationRateNightsOnModifySync` (~7073–7089); promo_id unchanged on reservation row.

**Concerns:**

| Concern | Mitigation locked |
|---|---|
| Desk books wrong price vs promo | SPA gates all three buttons; server re-validates on create |
| Silent promo drop on extend | Lock 9 → **422** if stored promo no longer applies |
| Folio double-discount confusion | Graph promo in snapshot only; folio DISCOUNT stays separate (leftover **2**) |
| Stale archived code in booking field | SPA copy **"Promo code not found."** blocks book |
