# Promo codes (rate-graph snapshot modifier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Ship property-local promo codes as a rate-graph modifier on `reservation_rate_night.amount_minor` at snapshot — v31 `promo` table + `reservation.promo_id`, `@hospai/money` `applyPromoToAmountMinor`, promo CRUD (catalog **84**, writers **59**, HTTP **[134]–[137]**), create/hold/confirm/modify snapshot paths, Rates catalog SPA, Booking wizard promo field + quote gates — **no** folio `DISCOUNT`/`PROMO` charge code, **no** `GET /quote`, **no** modify apply/remove promo.

**Architecture:** Promo is resolved by normalized code at book time, stored as `reservation.promo_id`, and applied per stay night after `rateDayAmountSync` via `applyPromoToAmountMinor`. CRUD mirrors rate-plan archive pattern (`status = 'archived'`, partial unique `promo_code_active`). Inquiry stores `promo_id` without snapshot; hold/confirm re-validate stored promo before snapshot. Modify date-extend re-applies stored promo on added nights only. Night audit continues reading snapshotted `reservation_rate_night` unchanged.

**Tech Stack:** PropertyDO sqlite v31 (`@hospai/do-runtime`), `@hospai/money`, `@hospai/contracts` wire codes + catalog/routes, vitest Worker HTTP (`promo-codes.spec.ts`), web-pms RTL (`RatesScreen.test.tsx`, `BookingScreen.test.tsx`), `@hospai/client-core`.

**Spec:** `docs/superpowers/specs/2026-08-15-promo-codes-design.md` (Approved at `6ba7332` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes folio-money leftover **7** (§7.4), stay-level-discounts leftover **4**, booking-plan-picker leftover **7**. Bidirectional pointer sentences land in **Task 6 only**.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **81 → 84** | Moving `[133]`–`[127]` |
| `AUDIT_WRITER_COMMAND_IDS.size` **56 → 59** | Folio `PROMO` charge code seed |
| HTTP append `[134] get_rate_promos` … `[137] delete_rate_promo` | `GET /quote` |
| `PROPERTY_SCHEMA_HEAD` **30 → 31** | OrgDO promo registry |
| `ORG_SCHEMA_HEAD` **7** unchanged | Modify apply/remove/change promo |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | `REPLAY_DISPATCH` promo commands |
| `pms_promo_catalog` stays excluded | Stacking multiple promos |
| Tests Lock 13 | Ticking Tasks 1–5 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` **81 → 84** — append `rates.create_promo`, `rates.update_promo`, `rates.archive_promo` **after** `folio.reconcile_payment`. `AUDIT_WRITER_COMMAND_IDS.size` **56 → 59**. HTTP `[133] post_folio_reconcile_payment` last; `[132] delete_room` / `[131] post_folio_routing_rule_archive` / `[128] post_folio_stay_discount` / `[127] post_demo_seed` **unmoved**. Append `[134] get_rate_promos`, `[135] post_rate_promos`, `[136] patch_rate_promo`, `[137] delete_rate_promo`. `PROPERTY_SCHEMA_HEAD` **30 → 31**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — v31 DDL + normalization (spec Lock 2)

**Locked:** `PROMO_CODES_V31_STATEMENTS` / `_SQL` exactly as spec Lock 2 DDL. `normalizePromoCode(raw) = raw.trim().toUpperCase()`. Charset after normalize: `^[A-Z0-9][A-Z0-9_-]{0,31}$`. CRUD charset mismatch → HTTP **400** `{ error: 'invalid_body' }`. Book: empty after trim → omit; non-empty charset fail → **404** `promo_not_found`. **Code and kind immutable after create** (PATCH rejects `code` / `kind`).

### D3 — Apply math (spec Lock 4)

**Locked:** `applyPromoToAmountMinor` in `@hospai/money` exactly as spec. Tests: `10000@1500bps→8500`; `500−800→0`; `10000@10000bps→0`. Import `roundHalfAwayFromZero` from same package (~123).

### D4 — Wire codes + HTTP map (spec Lock 5)

**Locked:** `PROMO_NOT_FOUND`, `PROMO_NOT_APPLICABLE`, `PROMO_CODE_EXISTS` in `idempotency.ts`. `PROMO_NOT_APPLICABLE` → **422** list in `mapReservationCommandErrorStatus`; `PROMO_NOT_FOUND` → **404** list (with `RATE_PLAN_NOT_FOUND` ~353); `PROMO_CODE_EXISTS` → **409** branch alongside `IDEM_KEY_REUSED` (~280–282) — **not** with `RATE_PLAN_CODE_EXISTS` (422 ~322). Internal errors: `PromoNotFoundError`, `PromoNotApplicableError`, `PromoCodeExistsError` — non-export, mirror `RatePlanNotFoundError` (~465). Map in `mapReservationPreconditionError` (~848+) for create/hold/confirm/modify catch paths.

### D5 — Promo CRUD (spec Lock 6)

**Locked:** Three catalog commands after `folio.reconcile_payment`; four HTTP routes after `[133]`; DO RPCs `tryCreatePromo` / `tryUpdatePromo` / `tryArchivePromo` / `listRatePromos`; outbox `{ propertyId, promoId, op, at }`; event `rate_promo.changed` noop beside `rate_plan.changed` (~139). Archive reuse same code → **201**. `scripts/permissions-check.mjs` and `scripts/degraded-check.mjs`: `V1_ROUTES.length === V1_HTTP_ROUTE_AUDIT.length` — add four routes to **both** `v1-dispatch.ts` and `v1-http-routes.ts`. **Do not** add promo commands to `REPLAY_DISPATCH`.

### D6 — Book + snapshot (spec Locks 7–9)

**Locked:** Optional `promoCode` on `POST /reservations`; fingerprint omits key when blank; `bookingReservationOpId` appends `:${normalizedPromoCode}` only when present (after plan segment). One promo per stay via `reservation.promo_id`. Hold/confirm re-validate stored promo → **422** if archived/out of window. Modify: overlap nights keep rows; added nights re-apply stored promo or **422**.

### D7 — SPA (spec Locks 10–11)

**Locked:** Rates: `data-testid` prefix `promo-`. Booking: `data-testid="promo-code"`; copy **"Promo code not found."** / **"Promo does not apply to this stay."**; non-empty unmatched blocks all three book buttons. Add `@hospai/money` workspace dep to `apps/web-pms/package.json` in Task 5.

### D8 — Tests / CI discipline (spec Lock 13)

**Locked:** File-filter vitest; **no `vi.spyOn` into DO isolate.** Rebuild `@hospai/contracts` before pms-core tests (Task 2+). Rebuild `@hospai/client-core` before web-pms tests (Tasks 4–5). Rebuild `@hospai/money` before pms-core/web-pms when dispatch/SPA import it. `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D9 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 6 only** at implementation time. Bidirectional pointers — **Task 6 only**. Purge: `'promo'` in `PROPERTY_PURGE_INVENTORY_TABLES` **immediately before** `'rate_day'` (~1237); `(SELECT COUNT(*) FROM promo)` in `countPropertyInventoryRows` immediately before `rate_day` (~1274). No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` moves 30 → 31** — `promo` table + `reservation.promo_id` only.
- **Promo adjusts snapshot only** — not folio `DISCOUNT`/`PROMO`; do not seed `PROMO` charge code.
- **`pms_promo_catalog` stays in `EXCLUDED_PROTOTYPE_KEYS`** — real PropertyDO `promo` table.
- **Catalog 84 / writers 59 / routes [134]–[137]** — append after `[133]`/`folio.reconcile_payment`; do not move `[133]`–`[127]`.
- **`pnpm generate:ddl`** = `pnpm --filter @hospai/do-runtime build && node scripts/property-ddl.mjs --write`.
- **One promo per stay** — no stacking; `reservation.promo_id` nullable.
- **Plan scope exact id only** — BAR promo does not apply to derived child plan id.
- **Archive not DELETE** — partial unique `promo_code_active`.
- **No FK** to `rate_plan`.
- **Scope-out (forbidden all tasks):** LOS discounts; seasonal table; stacking policy resolution; one-use/redemption; OTA; OrgDO promos; folio DISCOUNT/PROMO seed; `GET /quote`; modify apply/remove promo; plan-scoped restrictions; invoices; city ledger; split collapse; `update_extras`; 9th night-audit step; `CLASS_DENYLIST`; `pms_promo_catalog` consumer; tax in wizard; demo seed required; `REPLAY_DISPATCH`; push; ticking Tasks 1–5 living boxes.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/money/src/index.ts` | `applyPromoToAmountMinor` + types | 1 |
| `packages/money/src/index.test.ts` | Lock 13 money cases | 1 |
| `packages/do-runtime/src/property-migrations.ts` | `PROMO_CODES_V31_*`; append v31 | 1 |
| `packages/do-runtime/src/index.ts` | export v31 SQL/constants | 1 |
| `migrations/do-property/0031_promo_codes.sql` | generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql + head **31** | 1 |
| `scripts/property-ddl.mjs` | target `0031_promo_codes.sql` | 1 |
| `apps/pms-core/src/property-do.ts` | purge list + count SQL; promo RPCs; snapshot/create/hold/confirm/modify | 1, 2, 3 |
| `packages/contracts/src/idempotency.ts` | `PROMO_*` wire codes | 2 |
| `packages/contracts/src/idempotency.test.ts` | wire assertions | 2 |
| `packages/contracts/src/commands/catalog.ts` | +3 commands after `folio.reconcile_payment` | 2 |
| `packages/contracts/src/commands/audit-writers.ts` | +3 writer ids | 2 |
| `packages/contracts/src/v1-http-routes.ts` | +4 routes after `[133]` | 2 |
| `packages/contracts/src/register.test.ts` | pins **84** / **59** / **[134]–[137]** | 2 |
| `apps/pms-core/src/v1-dispatch.ts` | four promo handlers + V1_ROUTES | 2, 3 |
| `apps/pms-core/src/event-consumer.ts` | `rate_promo.changed` noop | 2 |
| `apps/pms-core/test/promo-codes.spec.ts` | Lock 13 cases **1–9** + charset | 2, 3 |
| `packages/client-core/src/api.ts` | promo CRUD client | 4 |
| `packages/client-core/src/booking.ts` | opId promo segment | 5 |
| `packages/client-core/test/booking.test.ts` | opId promo cases | 5 |
| `packages/client-core/test/api.test.ts` | `createReservation` promoCode | 5 |
| `apps/web-pms/src/screens/RatesScreen.tsx` | promo catalog section | 4 |
| `apps/web-pms/src/screens/RatesScreen.test.tsx` | Lock 13 Rates cases | 4 |
| `apps/web-pms/package.json` | `@hospai/money` dep | 5 |
| `apps/web-pms/src/screens/BookingScreen.tsx` | promo field + quote + gates | 5 |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | Lock 13 Booking cases | 5 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | Close leftover **7** + §7.4 | 6 |
| `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md` | Close leftover **4** + scope-out ~64 | 6 |
| `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` | Close leftover **7** | 6 |
| `docs/superpowers/specs/2026-08-15-promo-codes-design.md` | Tick §6 checklist | 6 |
| `docs/superpowers/plans/2026-08-15-promo-codes.md` | Task 6 checkboxes (this file) | 6 |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `REPLAY_DISPATCH`, folio charge-code seed, `ARCHITECTURE.md`.

---

## Spec §1.2 / §6 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) v31 migration | 1 |
| §1.2 (2) `applyPromoToAmountMinor` | 1 |
| §1.2 (3) promo CRUD + catalog/routes | 2 |
| §1.2 (4) create / hold / confirm | 3 |
| §1.2 (5) modify added nights | 3 |
| §1.2 (6) client + SPA Rates | 4 |
| §1.2 (7) SPA Booking + client book | 5 |
| §1.2 (8) purge + DDL | 1 |
| Lock 13 money | 1 |
| Lock 13 DO/HTTP **1–3** + charset | 2 |
| Lock 13 DO/HTTP **4–9** | 3 |
| Lock 13 Rates RTL | 4 |
| Lock 13 Booking RTL | 5 |
| §6 checklist + pointers | 6 |
| §1.3 scope out | forbidden all |

---

### Task 1: money + v31 schema

**Spec:** §2 Lock 2 (DDL), Lock 4 (math only in money pkg), Lock 12 (purge list), §4 items 1–2 partial.

**Files:**
- Modify: `packages/money/src/index.ts` — after `roundHalfAwayFromZero` (~123–128)
- Modify: `packages/money/src/index.test.ts`
- Modify: `packages/do-runtime/src/property-migrations.ts` — after `DERIVED_RATE_PLANS_V30_*` (~1185–1189); append to `PROPERTY_MIGRATIONS`
- Modify: `packages/do-runtime/src/index.ts` — export v31 (~114–115)
- Modify: `packages/do-runtime/src/migrate.test.ts` — MemorySql (~189+); head **31** (~226–237, ~626–627, ~841+)
- Modify: `scripts/property-ddl.mjs` — after `0030_derived_rate_plans.sql` (~427–436)
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` (~1217–1248); `countPropertyInventoryRows` (~1251–1287)
- Create: `migrations/do-property/0031_promo_codes.sql` — via `pnpm generate:ddl`

**Interfaces:**
- Produces: `export type PromoKind = 'percent' | 'fixed_per_night'`
- Produces: `export type PromoApplyInput = { kind: 'percent'; bps: number } | { kind: 'fixed_per_night'; amountMinor: number }`
- Produces: `export function applyPromoToAmountMinor(amountMinor: number, promo: PromoApplyInput): number`
- Produces: `PROMO_CODES_V31_STATEMENTS`, `PROMO_CODES_V31_SQL`
- Produces: `PROPERTY_SCHEMA_HEAD === 31`

**Forbidden this commit:** DO promo RPCs, wire codes, catalog, HTTP, SPA, reservation snapshot, tests beyond money + migrate pins.

- [ ] **Step 1: Write failing money tests**

Append to `packages/money/src/index.test.ts`:

```typescript
import {
  applyPromoToAmountMinor,
  // ... existing imports
} from './index.js';

describe('applyPromoToAmountMinor', () => {
  it('1: percent 1500 bps off 10000 → 8500', () => {
    expect(applyPromoToAmountMinor(10_000, { kind: 'percent', bps: 1500 })).toBe(8500);
  });

  it('2: fixed_per_night floors at 0', () => {
    expect(applyPromoToAmountMinor(500, { kind: 'fixed_per_night', amountMinor: 800 })).toBe(0);
  });

  it('3: percent 10000 bps → 0', () => {
    expect(applyPromoToAmountMinor(10_000, { kind: 'percent', bps: 10_000 })).toBe(0);
  });

  it('rejects non-integer negative amountMinor', () => {
    expect(() => applyPromoToAmountMinor(-1, { kind: 'percent', bps: 100 })).toThrow(InvalidMoneyError);
  });
});
```

- [ ] **Step 2: Run money tests to verify they fail**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "applyPromoToAmountMinor"
```

Expected: **FAIL** — `applyPromoToAmountMinor` not exported.

- [ ] **Step 3: Implement `applyPromoToAmountMinor`**

In `packages/money/src/index.ts` after `roundHalfAwayFromZero`:

```typescript
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
    if (!Number.isSafeInteger(discounted)) {
      throw new InvalidMoneyError('promo amount overflow');
    }
    return Math.max(0, discounted);
  }
  if (!Number.isInteger(promo.amountMinor) || promo.amountMinor < 0) {
    throw new InvalidMoneyError('amountMinor must be a non-negative integer');
  }
  return Math.max(0, amountMinor - promo.amountMinor);
}
```

- [ ] **Step 4: Write failing migrate tests (schema head 31)**

In `packages/do-runtime/src/migrate.test.ts`:

1. Import `PROMO_CODES_V31_SQL` alongside `DERIVED_RATE_PLANS_V30_SQL` (~47).
2. In `MemorySql.exec` (~189), add:

```typescript
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN promo_id')) {
      return { toArray: () => [] };
    }
```

3. Update `applies property migrations through version 30` → **version 31** (~226–237): expect `v1`/`v2` === 31, `schemaVersion` length 31, version array ends with `31`.
4. Update `schema head constants` (~627): `expect(PROPERTY_SCHEMA_HEAD).toBe(31);`
5. Add after derived_rate_plans block (~841+):

```typescript
  it('property schema head is 31 after promo_codes', () => {
    const v31 = PROPERTY_MIGRATIONS.find((m) => m.version === 31);
    expect(v31?.name).toBe('promo_codes');
    expect(v31?.statements[0]).toContain('CREATE TABLE promo');
    expect(v31?.statements.some((s) => s.includes('promo_code_active'))).toBe(true);
    expect(v31?.statements.some((s) => s.includes('ADD COLUMN promo_id'))).toBe(true);
  });

  it('migrations/do-property/0031_promo_codes.sql matches PROMO_CODES_V31_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0031_promo_codes.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PROMO_CODES_V31_SQL.trim());
  });
```

- [ ] **Step 5: Run migrate tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|promo_codes|through version"
```

Expected: **FAIL** — head still **30**; v31 missing.

- [ ] **Step 6: Add v31 migration + purge list**

In `packages/do-runtime/src/property-migrations.ts` after `DERIVED_RATE_PLANS_V30_SQL`:

```typescript
export const PROMO_CODES_V31_STATEMENTS = [
  `CREATE TABLE promo (
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
)`,
  `CREATE UNIQUE INDEX promo_code_active ON promo(code) WHERE status = 'active'`,
  `ALTER TABLE reservation ADD COLUMN promo_id TEXT`,
] as const;

export const PROMO_CODES_V31_SQL = PROMO_CODES_V31_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 31,
    name: 'promo_codes',
    statements: PROMO_CODES_V31_STATEMENTS,
  },
```

Export from `packages/do-runtime/src/index.ts`:

```typescript
  PROMO_CODES_V31_SQL,
  PROMO_CODES_V31_STATEMENTS,
```

In `scripts/property-ddl.mjs` after `0030_derived_rate_plans.sql` target:

```javascript
  {
    path: join(root, 'migrations/do-property/0031_promo_codes.sql'),
    header: `-- PropertyDO promo codes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE promo → partial unique index → reservation.promo_id.

`,
    sql: PROMO_CODES_V31_SQL,
  },
```

Add import `PROMO_CODES_V31_SQL` at top of `property-ddl.mjs` with other migration SQL imports.

In `apps/pms-core/src/property-do.ts` — insert `'promo'` **immediately before** `'rate_day'` (~1237):

```typescript
  'promo',
  'rate_day',
```

In `countPropertyInventoryRows` — insert before `rate_day` (~1274):

```typescript
      (SELECT COUNT(*) FROM promo) +
      (SELECT COUNT(*) FROM rate_day) +
```

- [ ] **Step 7: Generate DDL + run tests**

```bash
pnpm generate:ddl
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "applyPromoToAmountMinor"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|promo_codes|through version"
pnpm check:ddl
pnpm check:purge
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 31`.

- [ ] **Step 8: Commit**

```bash
git add packages/money/src/index.ts \
  packages/money/src/index.test.ts \
  packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  scripts/property-ddl.mjs \
  apps/pms-core/src/property-do.ts \
  migrations/do-property/0031_promo_codes.sql
git commit -m "$(cat <<'EOF'
feat(money): applyPromoToAmountMinor and v31 promo schema

EOF
)"
```

---

### Task 2: catalog + promo CRUD

**Spec:** §2 Locks 5–6, Lock 13 cases **1–3** + charset **400**, §4 items 3–5 partial.

**Files:**
- Modify: `packages/contracts/src/idempotency.ts` — after `DERIVED_RATE_PLAN_WRITE_FORBIDDEN` (~102)
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts` — after `folio.reconcile_payment` (~897–909)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — after `rates.delete_plan` (~45)
- Modify: `packages/contracts/src/v1-http-routes.ts` — after `post_folio_reconcile_payment` (~785–791)
- Modify: `packages/contracts/src/register.test.ts` — pins (~670–680)
- Modify: `apps/pms-core/src/property-do.ts` — promo RPCs adjacent to `tryCreateRatePlan` (~10723+)
- Modify: `apps/pms-core/src/v1-dispatch.ts` — four handlers + `V1_ROUTES`; import wire codes
- Modify: `apps/pms-core/src/event-consumer.ts` — ~139
- Create: `apps/pms-core/test/promo-codes.spec.ts` — cases **1–3** + charset

**Interfaces:**
- Produces: `PROMO_NOT_FOUND`, `PROMO_NOT_APPLICABLE`, `PROMO_CODE_EXISTS`
- Produces: `const PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/`
- Produces: `function normalizePromoCode(raw: string): string` (dispatch + DO private mirror)
- Produces: `tryCreatePromo`, `tryUpdatePromo`, `tryArchivePromo`, `listRatePromos`
- Produces: `handleGetRatePromos`, `handlePostRatePromos`, `handlePatchRatePromo`, `handleDeleteRatePromo`
- Consumes: Task 1 v31 `promo` table

**Forbidden this commit:** snapshot/create reservation promo, SPA, spec pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing tests (`promo-codes.spec.ts` cases 1–3 + charset)**

Create `apps/pms-core/test/promo-codes.spec.ts`:

```typescript
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDEM_KEY_REUSED, PROMO_CODE_EXISTS } from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Promo Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_promo_${crypto.randomUUID()}`;
  const propertyId = `prop_promo_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Promo Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function postPromo(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-promo-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getPromos(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function deletePromo(propertyId: string, actor: string, promoId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos/${encodeURIComponent(promoId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-arch-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

describe('promo codes CRUD', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: create promo; list returns row', async () => {
    const actor = `user_promo_1_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const promoId = `promo_${crypto.randomUUID()}`;
    const create = await postPromo(propertyId, actor, {
      promoId,
      code: 'summer15',
      name: 'Summer 15% off',
      kind: 'percent',
      bps: 1500,
    });
    expect(create.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string; name: string; kind: string; bps: number }>;
    };
    expect(list.promos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promoId,
          code: 'SUMMER15',
          name: 'Summer 15% off',
          kind: 'percent',
          bps: 1500,
        }),
      ]),
    );
  });

  it('case 2: duplicate active code → 409 promo_code_exists', async () => {
    const actor = `user_promo_2_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_a_${crypto.randomUUID()}`,
        code: 'DUPE',
        name: 'First',
        kind: 'percent',
        bps: 1000,
      })).status,
    ).toBe(201);
    const dup = await postPromo(propertyId, actor, {
      promoId: `promo_b_${crypto.randomUUID()}`,
      code: 'DUPE',
      name: 'Second',
      kind: 'percent',
      bps: 2000,
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ ok: false, error: PROMO_CODE_EXISTS });
  });

  it('case 3: archive then reuse same code → 201', async () => {
    const actor = `user_promo_3_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const firstId = `promo_first_${crypto.randomUUID()}`;
    expect(
      (await postPromo(propertyId, actor, {
        promoId: firstId,
        code: 'REUSE',
        name: 'Old',
        kind: 'fixed_per_night',
        amountMinor: 500,
      })).status,
    ).toBe(201);
    expect((await deletePromo(propertyId, actor, firstId)).status).toBe(200);
    const secondId = `promo_second_${crypto.randomUUID()}`;
    const recreate = await postPromo(propertyId, actor, {
      promoId: secondId,
      code: 'REUSE',
      name: 'New',
      kind: 'percent',
      bps: 500,
    });
    expect(recreate.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string }>;
    };
    expect(list.promos.some((p) => p.promoId === secondId && p.code === 'REUSE')).toBe(true);
  });

  it('charset mismatch on create → 400 invalid_body', async () => {
    const actor = `user_promo_charset_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const res = await postPromo(propertyId, actor, {
      promoId: `promo_bad_${crypto.randomUUID()}`,
      code: ' bad code!',
      name: 'Bad',
      kind: 'percent',
      bps: 1000,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/promo-codes.spec.ts -t "promo codes CRUD"
```

Expected: **FAIL** — routes / DO missing (404 or import errors).

- [ ] **Step 3: Add wire codes + catalog + routes + audit writers**

`packages/contracts/src/idempotency.ts` after rate-plan codes (~102):

```typescript
export const PROMO_NOT_FOUND = 'promo_not_found' as const;
export const PROMO_NOT_APPLICABLE = 'promo_not_applicable' as const;
export const PROMO_CODE_EXISTS = 'promo_code_exists' as const;
```

`packages/contracts/src/idempotency.test.ts`:

```typescript
    expect(PROMO_NOT_FOUND).toBe('promo_not_found');
    expect(PROMO_NOT_APPLICABLE).toBe('promo_not_applicable');
    expect(PROMO_CODE_EXISTS).toBe('promo_code_exists');
```

`packages/contracts/src/commands/catalog.ts` append after `folio.reconcile_payment`:

```typescript
  {
    id: 'rates.create_promo',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_promo.changed'],
    entitlement: 'pms.core',
    permission: 'rates:write',
  },
  {
    id: 'rates.update_promo',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_promo.changed'],
    entitlement: 'pms.core',
    permission: 'rates:write',
  },
  {
    id: 'rates.archive_promo',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_promo.changed'],
    entitlement: 'pms.core',
    permission: 'rates:write',
  },
```

`packages/contracts/src/commands/audit-writers.ts` after `rates.delete_plan`:

```typescript
  'rates.create_promo',
  'rates.update_promo',
  'rates.archive_promo',
```

`packages/contracts/src/v1-http-routes.ts` append after `post_folio_reconcile_payment`:

```typescript
  {
    id: 'get_rate_promos',
    scope: 'property',
    permission: 'rates:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_rate_promos',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.create_promo',
    entitlement: 'pms.core',
  },
  {
    id: 'patch_rate_promo',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.update_promo',
    entitlement: 'pms.core',
  },
  {
    id: 'delete_rate_promo',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.archive_promo',
    entitlement: 'pms.core',
  },
```

Update `packages/contracts/src/register.test.ts` (~677–680):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[134]?.id).toBe('get_rate_promos');
    expect(V1_HTTP_ROUTE_AUDIT[134]).toMatchObject({
      scope: 'property',
      permission: 'rates:read',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[135]?.id).toBe('post_rate_promos');
    expect(V1_HTTP_ROUTE_AUDIT[135]).toMatchObject({
      scope: 'property',
      permission: 'rates:write',
      commandId: 'rates.create_promo',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[136]?.id).toBe('patch_rate_promo');
    expect(V1_HTTP_ROUTE_AUDIT[136]).toMatchObject({
      scope: 'property',
      permission: 'rates:write',
      commandId: 'rates.update_promo',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[137]?.id).toBe('delete_rate_promo');
    expect(V1_HTTP_ROUTE_AUDIT[137]).toMatchObject({
      scope: 'property',
      permission: 'rates:write',
      commandId: 'rates.archive_promo',
      entitlement: 'pms.core',
    });
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(59);
    expect(COMMAND_CATALOG).toHaveLength(84);
```

- [ ] **Step 4: Implement PropertyDO promo RPCs**

Add error classes near `RatePlanNotFoundError` (~465):

```typescript
class PromoNotFoundError extends Error {
  constructor() {
    super(PROMO_NOT_FOUND);
    this.name = 'PromoNotFoundError';
  }
}
class PromoNotApplicableError extends Error {
  constructor() {
    super(PROMO_NOT_APPLICABLE);
    this.name = 'PromoNotApplicableError';
  }
}
class PromoCodeExistsError extends Error {
  constructor() {
    super(PROMO_CODE_EXISTS);
    this.name = 'PromoCodeExistsError';
  }
}
```

Import `PROMO_NOT_FOUND`, `PROMO_NOT_APPLICABLE`, `PROMO_CODE_EXISTS` from `@hospai/contracts`.

Add helpers before `tryCreateRatePlan` (~10723):

```typescript
  private static readonly PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

  private normalizePromoCodeSync(raw: string): string {
    return raw.trim().toUpperCase();
  }

  private assertPromoCodeCharsetSync(code: string): void {
    if (!PropertyDO.PROMO_CODE_CHARSET.test(code)) {
      throw new Error('invalid_promo_code');
    }
  }

  private resolvePromoByCodeSync(code: string): {
    promo_id: string;
    code: string;
    name: string;
    status: string;
    kind: 'percent' | 'fixed_per_night';
    bps: number | null;
    amount_minor: number | null;
    valid_from: string | null;
    valid_to: string | null;
    rate_plan_id: string | null;
  } | null {
    const normalized = this.normalizePromoCodeSync(code);
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT promo_id, code, name, status, kind, bps, amount_minor, valid_from, valid_to, rate_plan_id
         FROM promo WHERE code = ? AND status = 'active'`,
        normalized,
      )
      .toArray();
    return (rows[0] as typeof rows[0] | undefined) ?? null;
  }

  private loadPromoByIdSync(promoId: string) {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT promo_id, code, name, status, kind, bps, amount_minor, valid_from, valid_to, rate_plan_id
         FROM promo WHERE promo_id = ?`,
        promoId,
      )
      .toArray();
    return (rows[0] as typeof rows[0] | undefined) ?? null;
  }
```

Add `tryCreatePromo` (mirror `tryCreateRatePlan` ~10726):

```typescript
  async tryCreatePromo(
    actor: ActorContext,
    input: {
      promoId: string;
      code: string;
      name: string;
      kind: 'percent' | 'fixed_per_night';
      bps?: number;
      amountMinor?: number;
      validFrom?: string | null;
      validTo?: string | null;
      ratePlanId?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; promoId: string }
    | { ok: false; error: typeof PROMO_CODE_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const code = this.normalizePromoCodeSync(input.code);
    try {
      this.assertPromoCodeCharsetSync(code);
    } catch {
      return { ok: false, error: 'invalid_promo_code' };
    }

    const validFrom = input.validFrom ?? null;
    const validTo = input.validTo ?? null;
    if ((validFrom == null) !== (validTo == null)) {
      return { ok: false, error: 'invalid_promo_window' };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingId = this.ctx.storage.sql
            .exec(`SELECT promo_id FROM promo WHERE promo_id = ?`, input.promoId)
            .toArray();
          if (existingId.length > 0) throw new Error('promo_id_exists');

          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT promo_id FROM promo WHERE code = ? AND status = 'active'`, code)
            .toArray();
          if (codeTaken.length > 0) throw new PromoCodeExistsError();

          const now = Date.now();
          const bps = input.kind === 'percent' ? input.bps ?? null : null;
          const amountMinor = input.kind === 'fixed_per_night' ? input.amountMinor ?? null : null;

          this.ctx.storage.sql.exec(
            `INSERT INTO promo (
               promo_id, code, name, status, kind, bps, amount_minor,
               valid_from, valid_to, rate_plan_id, created_at, updated_at
             ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.promoId,
            code,
            input.name,
            input.kind,
            bps,
            amountMinor,
            validFrom,
            validTo,
            input.ratePlanId ?? null,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_promo.changed',
            payload: { propertyId, promoId: input.promoId, op: 'create', at: now },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.create_promo',
            entityType: 'promo',
            entityId: input.promoId,
            beforeJson: null,
            afterJson: { promoId: input.promoId, code, name: input.name, kind: input.kind },
          });

          return { ok: true as const, promoId: input.promoId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof PromoCodeExistsError) return { ok: false, error: PROMO_CODE_EXISTS };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
```

Implement `tryUpdatePromo` (PATCH: name, window, plan scope, bps/amountMinor — **reject code/kind changes**), `tryArchivePromo` (`status = 'archived'`), `listRatePromos` (`status = 'active' ORDER BY code` → camelCase JSON).

- [ ] **Step 5: Add dispatch handlers + V1_ROUTES + event consumer**

In `apps/pms-core/src/v1-dispatch.ts`, add charset helper at module scope:

```typescript
const PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function promoCodeCharsetOk(code: string): boolean {
  return PROMO_CODE_CHARSET.test(code);
}
```

Add handlers mirroring `handlePostRatePlans` / `handleGetRatePlans` (~3635 / ~4503):

```typescript
async function handleGetRatePromos(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const promos = await resolvedCtx.resolved.stub.listRatePromos();
    return json({ ok: true, promos }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostRatePromos(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as {
    promoId: string;
    code: string;
    name: string;
    kind: 'percent' | 'fixed_per_night';
    bps?: number;
    amountMinor?: number;
    validFrom?: string | null;
    validTo?: string | null;
    ratePlanId?: string | null;
    idempotencyKey: string;
  };
  if (!body?.promoId || !body.code || !body.name || !body.kind || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const normalized = normalizePromoCode(body.code);
  if (!promoCodeCharsetOk(normalized)) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    promoId: body.promoId,
    code: body.code,
    name: body.name,
    kind: body.kind,
    ...(body.bps !== undefined ? { bps: body.bps } : {}),
    ...(body.amountMinor !== undefined ? { amountMinor: body.amountMinor } : {}),
    ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
    ...(body.validTo !== undefined ? { validTo: body.validTo } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreatePromo']>>>({
    env: ctx.env,
    commandId: 'rates.create_promo',
    routeId: 'post_rate_promos',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCreatePromo(actor, commandPayload, idem),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === PROMO_CODE_EXISTS) return json({ ok: false, error: err }, 409);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}
```

Implement `handlePatchRatePromo` and `handleDeleteRatePromo` similarly. Append four entries to `V1_ROUTES` after rate-plans block (~6808):

```typescript
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRatePromos,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos$/,
    permission: 'rates:write',
    commandId: 'rates.create_promo',
    handler: handlePostRatePromos,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.update_promo',
    handler: handlePatchRatePromo,
  },
  {
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.archive_promo',
    handler: handleDeleteRatePromo,
  },
```

In `mapReservationCommandErrorStatus` (~280–363):

```typescript
  if (error === IDEM_KEY_REUSED || error === ALREADY_CANCELLED || error === LEDGER_INCONSISTENT || error === PROMO_CODE_EXISTS) {
    return 409;
  }
```

Add `PROMO_NOT_APPLICABLE` to 422 list (~322 area). Add `PROMO_NOT_FOUND` to 404 list (~353 area).

In `apps/pms-core/src/event-consumer.ts` (~139):

```typescript
    case 'rate_plan.changed':
    case 'rate_promo.changed':
```

- [ ] **Step 6: Rebuild contracts + run tests + register pins**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/promo-codes.spec.ts -t "promo codes CRUD"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts -t "accepts every COMMAND_CATALOG"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: cases **1–3** + charset **PASS**; catalog **84**; writers **59**; `[133]` unchanged; `[134]–[137]` appended.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/test/promo-codes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): promo catalog CRUD and HTTP routes

EOF
)"
```

---

### Task 3: snapshot / create / hold / confirm / modify

**Spec:** §2 Locks 3–5, 7–9, Lock 13 cases **4–9**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `snapshotRateNightsSync` (~6963); `tryCreateReservation` (~7380–7523); `tryConfirm` (~7663); `tryHold` (~7798); `syncReservationRateNightsOnModifySync` (~7064); `mapReservationPreconditionError` (~848+)
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostReservations` (~1714–1771); `mapReservationCommandErrorStatus` (~280)
- Modify: `apps/pms-core/test/promo-codes.spec.ts` — append cases **4–9**

**Interfaces:**
- Consumes: Task 1 `applyPromoToAmountMinor`; Task 2 promo RPCs + wire codes
- Produces: `snapshotRateNightsSync(..., promoRow | null)` applies promo per night
- Produces: `tryCreateReservation` accepts `promoCode?: string`; sets `promo_id`; snapshots when pending/confirmed
- Produces: hold/confirm re-validate stored `promo_id`; modify re-applies on added nights

**Forbidden this commit:** SPA, leftover pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing tests (cases 4–9)**

Append to `apps/pms-core/test/promo-codes.spec.ts`. **Replace** Task 2 `provisionHotel` with the reservations-routes mirror (~76–103): capture `fromDate` from `postRoomType` JSON, `seedBarRatesForHorizon`, `createGuest` via `testOrgStub` / `guest-helpers.js`; return `{ orgId, propertyId, actor, stub, guestRef, arrival }` where `arrival = roomTypeData.fromDate`. Add imports: `DEFAULT_RATE_PLAN_ID`, `PROMO_NOT_APPLICABLE`, `PROMO_NOT_FOUND`, `IDEM_KEY_REUSED`, `addCalendarDays`, `PropertyDO`, `createGuest`, `orgStub as testOrgStub`, `seedBarRatesForHorizon`, `idemFor`, `provisionedPropertyStub`, `TEST_OWNER_ACTOR`.

```typescript
import {
  IDEM_KEY_REUSED,
  PROMO_CODE_EXISTS,
  PROMO_NOT_APPLICABLE,
  PROMO_NOT_FOUND,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do.js';
import { addCalendarDays } from './date-helpers.js';
import {
  createGuest,
  idemFor,
  orgStub as testOrgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers.js';

async function provisionHotel(actor: string, roomCount = 10) {
  const orgId = `org_promo_${crypto.randomUUID()}`;
  const propertyId = `prop_promo_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Promo Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return {
    orgId,
    propertyId,
    actor,
    stub: resolved!.stub,
    guestRef: guest.guestRef,
    arrival: roomTypeData.fromDate,
  };
}

async function putRateDay(
  propertyId: string,
  actor: string,
  stayDate: string,
  amountMinor = 10_000,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor,
        currency: 'USD',
        idempotencyKey: `idem-rate-${crypto.randomUUID()}`,
      }),
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

describe('promo codes on reservations', () => {
  // reuse beforeEach/afterEach from CRUD describe or hoist shared hooks

  it('case 4: create with promo → promo_id set; nights 8500; night audit uses snapshot', async () => {
    const actor = `user_promo_res_4_${crypto.randomUUID()}`;
    const { propertyId, stub, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const promoId = `promo_${crypto.randomUUID()}`;
    expect(
      (await postPromo(propertyId, actor, {
        promoId,
        code: 'SUMMER15',
        name: '15% off',
        kind: 'percent',
        bps: 1500,
      })).status,
    ).toBe(201);
    const reservationId = `res_${crypto.randomUUID()}`;
    const res = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'SUMMER15',
      idempotencyKey: `idem-res-4-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
    const read = await (stub as DurableObjectStub<PropertyDO>).readReservation(reservationId);
    expect(read.ok && read.reservation.promoId).toBe(promoId);
    const nights = await (stub as DurableObjectStub<PropertyDO>).listReservationRateNightsForTest(
      reservationId,
    );
    expect(nights).toEqual([
      { stayDate: arrival, amountMinor: 8500, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });

  it('case 5: omit vs blank promoCode → same idempotency acceptance', async () => {
    const actor = `user_promo_res_5_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const reservationId = `res_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-res-5-${crypto.randomUUID()}`;
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
      promoCode: '   ',
      idempotencyKey,
    });
    expect(replay.status).toBe(201);
  });

  it('case 6: same key different normalized code → idempotency_key_reused', async () => {
    const actor = `user_promo_res_6_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    for (const code of ['A', 'B']) {
      expect(
        (await postPromo(propertyId, actor, {
          promoId: `promo_${code}_${crypto.randomUUID()}`,
          code,
          name: code,
          kind: 'percent',
          bps: 1000,
        })).status,
      ).toBe(201);
    }
    const reservationId = `res_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-res-6-${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        promoCode: 'A',
        idempotencyKey,
      })).status,
    ).toBe(201);
    const clash = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'B',
      idempotencyKey,
    });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('case 7: inapplicable plan → 422 promo_not_applicable', async () => {
    const actor = `user_promo_res_7_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_corp_${crypto.randomUUID()}`,
        code: 'CORPONLY',
        name: 'Corp only',
        kind: 'percent',
        bps: 1000,
        ratePlanId: 'CORP',
      })).status,
    ).toBe(201);
    const res = await postReservation(propertyId, actor, {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      promoCode: 'CORPONLY',
      idempotencyKey: `idem-res-7-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: PROMO_NOT_APPLICABLE });
  });

  it('case 8: unknown promo → 404 promo_not_found', async () => {
    const actor = `user_promo_res_8_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const res = await postReservation(propertyId, actor, {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'NOPE',
      idempotencyKey: `idem-res-8-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: PROMO_NOT_FOUND });
  });

  it('case 9: inquiry stores promo_id without snapshot; confirm snapshots adjusted', async () => {
    const name = `promo-9-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = orgStub(orgId);
    const guest = await createGuest(org, name, `guest_${name}`, 'Guest');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('rt', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const night = added.fromDate;
    const barRate = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night,
      amountMinor: 10_000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, barRate, await idemFor('bar', barRate)),
    ).toMatchObject({ ok: true });
    const promoId = `promo_${crypto.randomUUID()}`;
    expect(
      await stub.tryCreatePromo(
        TEST_OWNER_ACTOR,
        {
          promoId,
          code: 'INQ15',
          name: 'Inquiry 15%',
          kind: 'percent',
          bps: 1500,
        },
        await idemFor('cp', { promoId }),
      ),
    ).toMatchObject({ ok: true });
    const reservationId = `res_${crypto.randomUUID()}`;
    const createRes = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      arrivalDate: night,
      departureDate: addCalendarDays(night, 1),
      status: 'inquiry' as const,
      promoCode: 'INQ15',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createRes, await idemFor('cr', createRes)),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([]);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.promoId).toBe(promoId);
    expect(
      await stub.tryConfirm(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('confirm', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night, amountMinor: 8500, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });
});
```

- [ ] **Step 2: Run reservation promo tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/promo-codes.spec.ts -t "promo codes on reservations"
```

Expected: **FAIL** — promo not applied / `promoCode` ignored.

- [ ] **Step 3: Extend PropertyDO snapshot + create + hold/confirm + modify**

Import `applyPromoToAmountMinor`, `PromoApplyInput` from `@hospai/money`.

Add helpers:

```typescript
  private promoApplyInputFromRowSync(row: {
    kind: 'percent' | 'fixed_per_night';
    bps: number | null;
    amount_minor: number | null;
  }): PromoApplyInput {
    if (row.kind === 'percent') {
      return { kind: 'percent', bps: row.bps! };
    }
    return { kind: 'fixed_per_night', amountMinor: row.amount_minor! };
  }

  private assertPromoApplicableSync(
    promo: NonNullable<ReturnType<PropertyDO['loadPromoByIdSync']>>,
    ratePlanId: string,
    nights: string[],
  ): void {
    if (promo.status !== 'active') throw new PromoNotApplicableError();
    if (promo.rate_plan_id != null && promo.rate_plan_id !== ratePlanId) {
      throw new PromoNotApplicableError();
    }
    if (promo.valid_from != null && promo.valid_to != null) {
      for (const night of nights) {
        if (night < promo.valid_from || night > promo.valid_to) throw new PromoNotApplicableError();
      }
    }
  }

  private resolvePromoForBookSync(
    promoCode: string | undefined,
    ratePlanId: string,
    nights: string[],
  ): { promoId: string | null; row: NonNullable<ReturnType<PropertyDO['loadPromoByIdSync']>> | null } {
    if (promoCode == null || promoCode.trim() === '') {
      return { promoId: null, row: null };
    }
    const normalized = this.normalizePromoCodeSync(promoCode);
    if (!PropertyDO.PROMO_CODE_CHARSET.test(normalized)) throw new PromoNotFoundError();
    const row = this.resolvePromoByCodeSync(normalized);
    if (!row) throw new PromoNotFoundError();
    this.assertPromoApplicableSync(row, ratePlanId, nights);
    return { promoId: row.promo_id, row };
  }
```

Replace `snapshotRateNightsSync` (~6963):

```typescript
  private snapshotRateNightsSync(
    reservationId: string,
    roomTypeId: string,
    ratePlanId: string,
    nights: string[],
    promo: { kind: 'percent' | 'fixed_per_night'; bps: number | null; amount_minor: number | null } | null = null,
  ): void {
    const currency = this.readStoredLedgerCurrencySync();
    if (!currency) throw new Error(CURRENCY_UNSET);
    const promoInput = promo ? this.promoApplyInputFromRowSync(promo) : null;
    for (const stayDate of nights) {
      let amount = this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate);
      if (promoInput) {
        amount = applyPromoToAmountMinor(amount, promoInput);
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO reservation_rate_night (reservation_id, stay_date, amount_minor, currency, rate_plan_id)
         VALUES (?, ?, ?, ?, ?)`,
        reservationId,
        stayDate,
        amount,
        currency,
        ratePlanId,
      );
    }
  }
```

In `tryCreateReservation`:
1. Add `promoCode?: string` to input type (~7391).
2. After `ratePlanId` resolved (~7452), call `resolvePromoForBookSync(input.promoCode, ratePlanId, nights)`.
3. Add `promo_id` to INSERT (~7494–7520):

```typescript
          const { promoId, row: promoRow } = this.resolvePromoForBookSync(
            input.promoCode,
            ratePlanId,
            nights,
          );
          // INSERT columns add promo_id before allocated_room_type_id
          this.ctx.storage.sql.exec(
            `INSERT INTO reservation (
               reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
               status, adults, children, rate_plan_id, promo_id, cancel_penalty_type, cancel_grace_hours,
               cancel_penalty_nights, cancel_penalty_bps, confirm_by, expires_at, no_post,
               allocated_room_type_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            // ... existing bindings with promoId at promo_id position
          );
          if (commitsInventory) {
            this.snapshotRateNightsSync(input.reservationId, input.roomTypeId, ratePlanId, nights, promoRow);
          }
```

In `tryConfirm` / `tryHold` snapshot paths (~7663, ~7798): read `promo_id` from reservation row; if non-null load promo, `assertPromoApplicableSync`, pass row to `snapshotRateNightsSync`.

In `syncReservationRateNightsOnModifySync` (~7091–7094): when adding nights, load `reservation.promo_id`; if set reload promo, assert applicable per added night, call `snapshotRateNightsSync(..., promoRow)` instead of bare snapshot.

In `mapReservationPreconditionError` (~901+):

```typescript
  if (e instanceof PromoNotFoundError) return { ok: false, error: PROMO_NOT_FOUND };
  if (e instanceof PromoNotApplicableError) return { ok: false, error: PROMO_NOT_APPLICABLE };
```

Catch these in `tryCreateReservation`, `tryConfirm`, `tryHold`, `tryModifyReservation` outer catch blocks (mirror `RatePlanNotFoundError` pattern).

In `readReservation` (~9299–9375): add `promo_id` to SELECT; add `promoId: string | null` to return type and map `promoId: row.promo_id ?? null` in the reservation object. Case 4 and case 9 assert `read.reservation.promoId`.

- [ ] **Step 4: Extend `handlePostReservations` fingerprint + payload**

Add to body type (~1729):

```typescript
    promoCode?: string;
```

Before fingerprint (~1747):

```typescript
  const normalizedPromoCode =
    body.promoCode != null && body.promoCode.trim() !== ''
      ? normalizePromoCode(body.promoCode)
      : null;
  if (normalizedPromoCode != null && !promoCodeCharsetOk(normalizedPromoCode)) {
    return json({ ok: false, error: PROMO_NOT_FOUND }, 404);
  }
```

**Charset path (spec Lock 2):** dispatch short-circuit after normalize — non-empty `normalizedPromoCode` failing `PROMO_CODE_CHARSET` → **404** `{ ok: false, error: promo_not_found }` (not `invalid_body`). Do **not** reach DO for charset-only failures. Fingerprint below still includes `promoCode: normalizedPromoCode` when non-empty so idempotent replay stays stable.

Update fingerprint:

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
    ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
  });
```

Update `commandPayload` (~1759):

```typescript
    ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
```

Add explicit branches in error handling (~1796+) for `PROMO_NOT_FOUND` → 404, `PROMO_NOT_APPLICABLE` → 422.

- [ ] **Step 5: Rebuild money + contracts + run tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/promo-codes.spec.ts
pnpm check:permissions
pnpm check:degraded
```

Expected: Lock 13 cases **1–9** **PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/promo-codes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): apply promo on reservation snapshot

EOF
)"
```

---

### Task 4: Rates SPA + client CRUD

**Spec:** §2 Lock 10, Lock 13 Rates RTL cases.

**Files:**
- Modify: `packages/client-core/src/api.ts` — after `archiveRatePlan` (~1677)
- Modify: `apps/web-pms/src/screens/RatesScreen.tsx` — plans tab (~309+)
- Modify: `apps/web-pms/src/screens/RatesScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 HTTP promo routes
- Produces: `listRatePromos`, `createRatePromo`, `updateRatePromo`, `archiveRatePromo`

**Forbidden this commit:** BookingScreen, booking.ts promo segment, spec pointers.

- [ ] **Step 1: Write failing client + RTL tests**

In `packages/client-core/src/api.ts` add (mirror rate-plan client ~1637–1686):

```typescript
    async listRatePromos(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/rate-promos`);
      return body as {
        ok: true;
        promos: Array<{
          promoId: string;
          code: string;
          name: string;
          kind: 'percent' | 'fixed_per_night';
          bps: number | null;
          amountMinor: number | null;
          validFrom: string | null;
          validTo: string | null;
          ratePlanId: string | null;
        }>;
      };
    },
    async createRatePromo(
      propertyId: string,
      input: {
        promoId: string;
        code: string;
        name: string;
        kind: 'percent' | 'fixed_per_night';
        bps?: number;
        amountMinor?: number;
        validFrom?: string | null;
        validTo?: string | null;
        ratePlanId?: string | null;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:create:${input.promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateRatePromo(propertyId: string, promoId: string, patch: Record<string, unknown>) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:update:${promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos/${enc(promoId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...patch, idempotencyKey }),
      });
    },
    async archiveRatePromo(propertyId: string, promoId: string) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:archive:${promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos/${enc(promoId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
```

In `RatesScreen.test.tsx`, mock `listRatePromos`, `createRatePromo`, `archiveRatePromo`. Add tests:

```typescript
  it('Lock 13 Rates 1: create promo via form', async () => {
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    renderRates('/rates/plans');
    fireEvent.change(await screen.findByTestId('promo-code-input'), {
      target: { value: 'SUMMER15' },
    });
    fireEvent.change(screen.getByTestId('promo-name-input'), {
      target: { value: 'Summer 15%' },
    });
    fireEvent.change(screen.getByTestId('promo-kind-select'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByTestId('promo-bps-input'), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('promo-create'));
    await waitFor(() => expect(createRatePromo).toHaveBeenCalled());
    expect(createRatePromo.mock.calls[0]?.[1]).toMatchObject({
      code: 'SUMMER15',
      name: 'Summer 15%',
      kind: 'percent',
      bps: 1500,
    });
  });

  it('Lock 13 Rates 2: archive promo', async () => {
    listRatePromos.mockResolvedValue({
      ok: true,
      promos: [
        {
          promoId: 'p1',
          code: 'SUMMER15',
          name: 'Summer 15%',
          kind: 'percent',
          bps: 1500,
          amountMinor: null,
          validFrom: null,
          validTo: null,
          ratePlanId: null,
        },
      ],
    });
    renderRates('/rates/plans');
    fireEvent.click(await screen.findByTestId('promo-archive-SUMMER15'));
    await waitFor(() => expect(archiveRatePromo).toHaveBeenCalledWith('prop_demo', 'p1'));
  });
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx -t "Lock 13 Rates"
```

Expected: **FAIL** — promo UI absent.

- [ ] **Step 3: Implement RatesScreen promo catalog section**

Below rate plans table / create form (~309+), add **Promo codes** section:

1. Query `api.listRatePromos(propertyId)` with key `['rate-promos', propertyId]`.
2. List active promos: `{code} — {name}` in `data-testid="promo-list"`.
3. Create form fields with `data-testid`:
   - `promo-code-input`, `promo-name-input`, `promo-kind-select` (`percent` | `fixed_per_night`)
   - `promo-bps-input` (when percent) or `promo-amount-input` (minor units when fixed)
   - optional `promo-valid-from`, `promo-valid-to`, plan `NativeSelect` (empty = all plans)
   - submit `promo-create`
4. Per-row archive button `data-testid={`promo-archive-${p.code}`}` → `archiveRatePromo`.
5. On create success invalidate `rate-promos` query.

- [ ] **Step 4: Rebuild client-core + run RTL + color check**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: **PASS** (including existing plan tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/RatesScreen.tsx \
  apps/web-pms/src/screens/RatesScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): rates promo catalog

EOF
)"
```

---

### Task 5: Booking SPA + client book path

**Spec:** §2 Lock 11, Lock 13 Booking RTL cases.

**Files:**
- Modify: `packages/client-core/src/booking.ts` — `bookingReservationOpId` (~25–40)
- Modify: `packages/client-core/src/api.ts` — `createReservation` (~1142–1175)
- Modify: `packages/client-core/test/booking.test.ts`
- Modify: `packages/client-core/test/api.test.ts`
- Modify: `apps/web-pms/package.json` — add `"@hospai/money": "workspace:*"`
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` — quote (~139–156), book section (~444+)
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 3 server promo book path; Task 4 `listRatePromos`
- Produces: opId `…:BAR:SUMMER15` when promo present; `createReservation` omits `promoCode` when empty

**Forbidden this commit:** spec pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing client + BookingScreen tests**

`packages/client-core/test/booking.test.ts`:

```typescript
  it('appends normalized promoCode after ratePlanId segment', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
      ratePlanId: 'BAR',
    };
    const withPromo = bookingReservationOpId({ ...base, promoCode: 'summer15' });
    expect(withPromo).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR:SUMMER15',
    );
    const omitted = bookingReservationOpId(base);
    expect(omitted.endsWith(':BAR')).toBe(true);
    expect(omitted.includes(':SUMMER15')).toBe(false);
  });
```

`packages/client-core/test/api.test.ts`:

```typescript
  it('createReservation JSON includes promoCode when provided', async () => {
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
      ratePlanId: 'BAR',
      promoCode: 'SUMMER15',
    };
    await client.createReservation('p', input, bookingReservationOpId(input));
    expect(bodies[0]?.promoCode).toBe('SUMMER15');
  });

  it('createReservation omits promoCode when absent', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({ /* same mock setup */ });
    await client.createReservation(
      'p',
      {
        reservationId: 'r1',
        roomTypeId: 'rt_a',
        guestRef: 'g1',
        arrivalDate: '2026-08-11',
        departureDate: '2026-08-12',
        quoteAriVersion: 3,
      },
      bookingReservationOpId({
        reservationId: 'r1',
        roomTypeId: 'rt_a',
        guestRef: 'g1',
        arrivalDate: '2026-08-11',
        departureDate: '2026-08-12',
      }),
    );
    expect(bodies[0]).not.toHaveProperty('promoCode');
  });
```

`BookingScreen.test.tsx` — mock `listRatePromos`; add tests:

```typescript
  it('Lock 13 Booking 1: SUMMER15 discounted stay-quote', async () => {
    listRatePromos.mockResolvedValue({
      ok: true,
      promos: [
        {
          promoId: 'p1',
          code: 'SUMMER15',
          name: '15% off',
          kind: 'percent',
          bps: 1500,
          amountMinor: null,
          validFrom: null,
          validTo: null,
          ratePlanId: null,
        },
      ],
    });
    renderBook();
    fireEvent.change(await screen.findByTestId('promo-code'), { target: { value: 'SUMMER15' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toContain('8500'));
  });

  it('Lock 13 Booking 2: empty promo omits promoCode on create', async () => {
    renderBook();
    // complete happy path ...
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createReservation.mock.calls[0]?.[1]).not.toHaveProperty('promoCode');
  });

  it('Lock 13 Booking 3: invalid promo disables all book buttons + copy', async () => {
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    renderBook();
    fireEvent.change(await screen.findByTestId('promo-code'), { target: { value: 'NOPE' } });
    await waitFor(() =>
      expect(screen.getByText('Promo code not found.')).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts test/api.test.ts -t "promo"
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx -t "Lock 13 Booking"
```

Expected: **FAIL**.

- [ ] **Step 3: Implement client-core + BookingScreen**

`packages/client-core/src/booking.ts`:

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
  promoCode?: string;
}): string {
  const status = input.status ?? 'confirmed';
  const adults = input.adults ?? 1;
  const children = input.children ?? 0;
  const ratePlanId = input.ratePlanId ?? 'BAR';
  const promoSegment =
    input.promoCode != null && input.promoCode.trim() !== ''
      ? `:${input.promoCode.trim().toUpperCase()}`
      : '';
  return `book:${input.reservationId}:${input.roomTypeId}:${input.arrivalDate}:${input.departureDate}:${input.guestRef}:${status}:${adults}:${children}:${ratePlanId}${promoSegment}`;
}
```

`packages/client-core/src/api.ts` — extend `createReservation` input + body:

```typescript
        promoCode?: string;
        ...(input.promoCode !== undefined ? { promoCode: input.promoCode } : {}),
```

`apps/web-pms/package.json` dependencies:

```json
    "@hospai/money": "workspace:*",
```

`BookingScreen.tsx`:

1. Import `applyPromoToAmountMinor` from `@hospai/money`.
2. Query `listRatePromos` on mount (alongside `plansQ` ~164).
3. State `promoCodeInput` — normalize trim+uppercase on change/blur.
4. Client-side match: find active promo by code; check plan + date window against stay nights.
5. Extend `stayQuoteMinor` (~139–156): when matched promo, sum `applyPromoToAmountMinor(amountMinor, promoInput)` per night.
6. Gate: non-empty input + no match → disable `confirm-book`, `hold-book`, `quote-book`; show **"Promo code not found."** or **"Promo does not apply to this stay."**
7. Field: `<Input data-testid="promo-code" … />`
8. Pass `promoCode: normalizedCode` on `createReservation` + `bookingReservationOpId` when matched; omit when empty.

- [ ] **Step 4: Rebuild money + client-core + run full BookingScreen suite**

```bash
pnpm build
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts test/api.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/booking.ts \
  packages/client-core/src/api.ts \
  packages/client-core/test/booking.test.ts \
  packages/client-core/test/api.test.ts \
  apps/web-pms/package.json \
  apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/BookingScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): booking wizard promo code

EOF
)"
```

---

### Task 6: leftover pointers + full CI

**Spec:** §6 checklist, §5 closes pointers, D8/D9.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — leftover **7** (~800) + §7.4 (~390)
- Modify: `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md` — leftover **4** (~352) + scope-out ~64
- Modify: `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` — leftover **7** (~270)
- Modify: `docs/superpowers/specs/2026-08-15-promo-codes-design.md` — tick §6 checklist
- Modify: `docs/superpowers/plans/2026-08-15-promo-codes.md` — Task 6 checkboxes only (this file)

**Pointer sentences (normative — one sentence each):**

Folio-money §19 leftover **7** (~800):

> ~~**7** \| **Promo codes** — §7.4.~~ **Closed** in [2026-08-15 promo codes](./2026-08-15-promo-codes-design.md): rate-graph snapshot modifier on `reservation_rate_night`, property-local `promo` registry, no folio `PROMO` charge code.

Folio-money §7.4 (~390):

> ~~### 7.4 Promo codes — **defer**~~ **Closed** in [2026-08-15 promo codes](./2026-08-15-promo-codes-design.md): promo adjusts snapshotted nightly amounts at book via `applyPromoToAmountMinor`; folio stay DISCOUNT remains separate.

Stay-level-discounts §9 leftover **4** (~352):

> ~~\| 4 \| **Promo codes** \| Folio-money leftover **7** \|~~ **Closed** in [2026-08-15 promo codes](./2026-08-15-promo-codes-design.md) (rate-graph layer, not folio DISCOUNT).

Stay-level-discounts §1.3 scope-out (~64):

> ~~- Promo codes — folio-money leftover **7**~~ **Closed** in [2026-08-15 promo codes](./2026-08-15-promo-codes-design.md).

Booking-plan-picker §5 leftover **7** (~270):

> ~~\| 7 \| **Promo codes** \| campaign scope-out \|~~ **Closed** in [2026-08-15 promo codes](./2026-08-15-promo-codes-design.md): Rates catalog + Booking wizard promo field with server re-validation.

- [x] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **84**; writers **59**; `[133]=post_folio_reconcile_payment`; `[134]=get_rate_promos` … `[137]=delete_rate_promo`; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 31`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 8`.

- [x] **Step 2: Targeted test superset (Lock 13 full slice)**

```bash
pnpm build
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "applyPromoToAmountMinor"
pnpm --filter @hospai/pms-core exec vitest run test/promo-codes.spec.ts
pnpm --filter @hospai/client-core exec vitest run test/booking.test.ts test/api.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx -t "Lock 13 Rates"
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx -t "Lock 13 Booking"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
pnpm check:purge
```

Expected: **PASS**.

- [x] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

- [x] **Step 4: Apply doc pointers + tick promo spec §6 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-promo-codes-design.md` §6.

- [x] **Step 5: Tick Task 6 checkboxes in this plan only**

Do **not** tick Tasks 1–5 checkboxes.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md \
  docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md \
  docs/superpowers/specs/2026-08-15-promo-codes-design.md \
  docs/superpowers/plans/2026-08-15-promo-codes.md
git commit -m "$(cat <<'EOF'
docs: close promo codes leftovers

EOF
)"
```

**Stop.** Modify apply/remove promo, stacking policy, one-use redemption, OrgDO promos, `GET /quote`, folio PROMO seed, and plan-scoped restrictions stay deferred per spec §1.3 / §5.

---

## Spec §6 reviewer checklist (Task 6 ticks these in the spec file when CI is green)

| §6 item | Satisfied by |
|---|---|
| v31 migration + head **31** + purge `promo` | Task 1 |
| `applyPromoToAmountMinor` + money tests | Task 1 |
| Wire codes + HTTP status map | Task 2, 3 |
| Catalog **84** + writers **59** + routes **[134]–[137]** | Task 2 |
| DO promo CRUD + event noop | Task 2 |
| Create / hold / confirm / modify snapshot | Task 3 |
| `POST /reservations` `promoCode` + fingerprint + opId | Task 3, 5 |
| SPA Rates + SPA Booking | Tasks 4, 5 |
| Tests Lock 13 | Tasks 1–5 + 6 |
| Register pins + CI discipline | Task 6 |
| Bidirectional pointer closes | Task 6 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–8) | 1–6 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–13 | 1–6 |
| §3 implementation pointers | 2, 3 |
| §4 file map | 1–6 |
| §6 checklist + pointers | 6 |
| Heads table §1.1 | 2 + 6 verify |
| D-locks 1–9 | Open decisions |

**Gaps:** None — every spec Lock maps to a task; Lock 13 cases **1–9** + charset + Rates/Booking RTL covered.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Type consistency:** `PromoApplyInput`, `normalizePromoCode`, `promo_id`/`promoId`, wire codes consistent Tasks 1–5.

**Final CI:** Task 6 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §7). Verified on `main`: catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, `PROPERTY_SCHEMA_HEAD` **30** (this plan → **31**), `snapshotRateNightsSync` ~6963 (no promo param yet), `handlePostReservations` fingerprint has `ratePlanId` but no `promoCode`, `web-pms` has no `@hospai/money` dep, purge list has no `'promo'` before `'rate_day'`.

**Implementer notes (from spec §7, not lock violations):**

1. **Percent bps direction** — promo bps are **off** (1500 → pay 85%); do not conflate with derived `derive_bps`.
2. **BAR promo on derived plan id** — exact `rate_plan_id` match only.
3. **Case 9 inquiry→confirm** — must re-check promo at commit; do not assume inquiry-time validity.
4. **`readReservation` JSON** — Task 3 Step 3 adds `promoId` to SELECT/return shape (~9299–9375); cases 4 and 9 assert `read.reservation.promoId`.
5. **Purge check** — omitting `'promo'` throws `unexpected_table:promo` at runtime verify (~2151).

