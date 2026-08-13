# Multi-currency folio + payments↔folio event contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn on the existing `folio_line` money columns: staff-entered effective-dated FX rates, foreign payments + optional `folio.add_item`, residual FX as its own line, versioned `payment.*` event seam (`applyPaymentEventSync`), chargebacks, and consistent reversal/split/transfer/tax/`capture_due` currency behaviour.

**Architecture:** Three currencies never collapse. Rate frozen at post (`roundHalfAwayFromZero`, never float). Auth is not money. Apply is idempotent by `(event_id, gateway_reference)`. `event-consumer` allowlists only — does not call PropertyDO. `folio_line` is **not** rebuilt (columns exist since v1). Payments stay `FAIL_CLOSED`. `NIGHT_AUDIT_STEPS` stays 7.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/do-runtime` v24, `@hospai/money` `postToLedger` / `allocate` / new `ledgerToTxn`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md` (Approved). Spec commit: `1ee26697e3fd6dc04a403db42e62095989f79f4c`.

## Global Constraints

- Do **not** rebuild or backfill `folio_line`. Identity rows are already well-formed.
- Do **not** nest FX HTTP under `/folio/payments/` — `GET …/folio/payments/([^/]+)$` (`v1-dispatch.ts` ~5512) would steal `fx-rates`.
- Route audit **append-only**. `[105] = get_reservation_search` does not move. New rows **106–110** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in **identical order**. Task 1 must **not** touch either list (`check:permissions` stays green).
- Route id for 107 is **`post_fx_rate_supersede`** (POST method). Never `put_fx_rate_supersede`.
- `AUDIT_WRITER_COMMAND_IDS.size` goes 45 → **49** in Task 1. `COMMAND_CATALOG` length 70 → **74**. `PLATFORM_GAPS` stays `[]`.
- `folio.post_fx_adjustment` input has **no** `folioLineId`. Fingerprint `{ reservationId, folioWindowId, kind, amountMinor, reason, sourcePaymentId? }`. Server allocates line id (UUID inside `runIdempotent`).
- No new `export class` unless `CLASS_DENYLIST` is updated in the same change. Prefer file-local errors.
- `runIdempotent` stays sync-only. Async PSP keeps the existing adapter-outside-txn seam.
- Fixture dates from property-local `business_date`. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- Helper name is `roundHalfAwayFromZero` (not `round_half_up`). Folio client keys use `stableKeyForOperation` (not `bookingReservationOpId`).
- Living plan checkboxes: tick `- [x]` on merge only (Task 16). Do not backfill historical plans.
- **Typecheck fixes go in their own commit**, never mixed into docs commits (Tasks 13, 14, 16).
- After any `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests (they import dist).
- pms-core shards: `pnpm --filter @hospai/pms-core exec vitest run --shard=N/4` — **no** `--` before `--shard`.
- `MemorySql` needs an explicit prefix stub for every new non-generic statement (`INSERT INTO payment_v24`, `DROP TABLE payment`, `ALTER TABLE payment_v24 RENAME`, charge-code `UPDATE` if any). `CREATE TABLE` / `CREATE INDEX` are already generic.
- No either/or forks. Spec §19 locks stand.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/events/payment.ts` | V1 `payment.*` contracts (Task 1) |
| `packages/contracts/src/index.ts` | Re-export payment events (Task 1) |
| `packages/contracts/src/commands/catalog.ts` | Four commands; existing event arrays (Task 1) |
| `packages/contracts/src/commands/audit-writers.ts` | +4; size 49 (Task 1) |
| `packages/contracts/src/money.ts` | `FX_RATE_MISSING` / `FX_RATE_NOT_LEDGER` / `FX_RATE_OPEN_EXISTS` (Task 1) |
| `packages/contracts/src/idempotency.ts` | `FX_REASON_REQUIRED` / `PAYMENT_NOT_CHARGEBACKABLE` (Task 1) |
| `packages/contracts/src/register.test.ts` | Size 49 + catalog 74 (Task 1); route pins 106–110 (Task 11) |
| `apps/pms-core/src/event-consumer.ts` | Allowlist only (Task 1) |
| `packages/money/src/index.ts` | `ledgerToTxn` (Task 2) |
| `packages/do-runtime/src/property-migrations.ts` | v24 (Task 3) |
| `migrations/do-property/0024_multi_currency_folio.sql` | Generated (Task 3) |
| `scripts/property-ddl.mjs` | 0024 target (Task 3) |
| `packages/do-runtime/src/migrate.test.ts` | Head 24; MemorySql prefixes (Task 3) |
| `packages/do-runtime/src/multi-currency-folio-migration.sqlite.test.ts` | Real-SQLite v23→v24 (Task 3) |
| `apps/pms-core/src/property-do.ts` | Purge lists (Task 3); lookup + apply + §8 writers (Tasks 4–10) |
| `packages/contracts/src/v1-http-routes.ts` | 106–110 (Task 11 only) |
| `apps/pms-core/src/v1-dispatch.ts` | Five handlers; widen GET folio / payments / authorize / cash (Task 11) |
| `packages/client-core/src/api.ts` | Currency + fx/chargeback/adjust methods (Task 12) |
| `apps/web-pms/src/screens/FolioScreen.tsx` | §13 (Task 12) |
| Sibling specs | One-sentence amends (Task 13) |
| `ARCHITECTURE.md` | Spec §20 four edits (Task 14) |

## Test file split (spec §16 → file)

| Spec # | File | Task |
|---|---|---|
| 35, 36 | `packages/contracts/src/register.test.ts`; `apps/pms-core/test/events-queue.spec.ts` | 1 |
| 38 | `packages/money/src/index.test.ts` | 2 |
| 1–3 | `packages/do-runtime` migrate + `multi-currency-folio-migration.sqlite.test.ts` | 3 |
| 4 | `apps/pms-core/test/purge-workflow.spec.ts` or a focused purge pin in Task 3 DO test + `check:purge` | 3 |
| 5–6 | `apps/pms-core/test/folio-fx-rates.spec.ts` (new; DO RPC) | 4 |
| 8–11 | `apps/pms-core/test/folio-fx-charges.spec.ts` (new) | 5 |
| 12–16, 19–21 | `apps/pms-core/test/folio-fx-payments.spec.ts` (new) | 6 |
| 17 | `folio-fx-payments.spec.ts` | 7 |
| 18 | `apps/pms-core/test/reservations-check-out.spec.ts` (extend) | 7 |
| 22–25 | `apps/pms-core/test/folio-fx-chargeback.spec.ts` (new) | 8 |
| 26–30 | `apps/pms-core/test/folio-fx-split-transfer.spec.ts` (new) + existing split regression | 9 |
| 31–33 | `apps/pms-core/test/night-audit-room-charges.spec.ts` / night-audit report tests | 10 |
| 5 (HTTP GET), 7, 34, 39 | `apps/pms-core/test/folio-fx-routes.spec.ts` (new) + `register.test.ts` | 11 |
| 22 staff 403 (HTTP) | `folio-fx-routes.spec.ts` | 11 |
| 37 | Task 15 CI | 15 |
| 40–43 | `apps/web-pms/src/screens/FolioScreen.test.tsx` | 12 |

---

### Task 1: Contracts (own commit, no HTTP routes)

**Spec:** §7.2, §10.1–10.3, §16 tests **35**, **36**. Keep `check:permissions` green.

**Files:**
- Create: `packages/contracts/src/events/payment.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/money.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts` (or money test sibling)
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/event-consumer.ts`

**Interfaces:**
- Produces: four catalog ids; `PAYMENT_EVENT_CONTRACT_VERSION = 1`; wire codes below; `AUDIT_WRITER_COMMAND_IDS.size === 49`; `COMMAND_CATALOG.length === 74`; event-consumer cases
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any `/fx-rates` handler, any DO method body, `PROPERTY_PURGE_INVENTORY_TABLES`.

- [x] **Step 1: Write the failing register + wire-code tests**

In `register.test.ts` change size **45 → 49** (both existing pins). Add:

```ts
expect(COMMAND_CATALOG).toHaveLength(74);
it('multi-currency folio commands are entitled FAIL_CLOSED INTERACTIVE', () => {
  const rows = [
    { id: 'folio.create_fx_rate', permission: 'settings:configure', events: ['fx_rate.changed'] },
    { id: 'folio.supersede_fx_rate', permission: 'settings:configure', events: ['fx_rate.changed'] },
    { id: 'folio.post_fx_adjustment', permission: 'folio:adjust', events: ['folio.line_posted', 'folio.fx_adjusted'] },
    { id: 'folio.record_chargeback', permission: 'folio:adjust', events: ['payment.chargeback_received', 'folio.line_posted'] },
  ] as const;
  // lane INTERACTIVE, degraded FAIL_CLOSED, idempotent true, entitlement pms.core, in AUDIT_WRITER, not OPT_OUT
});
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.authorize')?.events).toEqual(
  expect.arrayContaining(['folio.payment_authorized', 'payment.authorized', 'payment.failed']),
);
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.events).toEqual(
  expect.arrayContaining(['folio.payment_captured', 'folio.line_posted', 'payment.captured', 'payment.failed']),
);
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.record_cash_payment')?.events).toEqual(
  expect.arrayContaining(['folio.payment_captured', 'folio.line_posted', 'payment.captured']),
);
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.refund')?.events).toEqual(
  expect.arrayContaining(['folio.payment_refunded', 'folio.line_posted', 'payment.refunded']),
);
```

Do **not** add `[106]` assertions this commit (`[105]` stays last).

Wire-code tests: `FX_RATE_MISSING === 'fx_rate_missing'`, `FX_RATE_NOT_LEDGER`, `FX_RATE_OPEN_EXISTS`, `FX_REASON_REQUIRED`, `PAYMENT_NOT_CHARGEBACKABLE`.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
```

Expected: FAIL — size 45 / length 70 / missing exports.

- [x] **Step 3: Implement contracts + event-consumer allowlist**

`events/payment.ts` — copy spec §7.2 types exactly. `index.ts`: `export * from './events/payment.js';`

`money.ts` — three FX_* codes next to `CROSS_CURRENCY_UNSUPPORTED`.

`idempotency.ts` — `FX_REASON_REQUIRED`, `PAYMENT_NOT_CHARGEBACKABLE`.

`catalog.ts` — insert the four commands after `folio.capture_due`. Widen authorize/capture/cash/refund `events[]` per spec §10.2. `PLATFORM_GAPS` stays `[]`.

`audit-writers.ts` — append the four ids.

`event-consumer.ts` — add cases (presence is enough except `folio.line_posted` already asserts money fields):

```ts
case 'payment.authorized':
case 'payment.captured':
case 'payment.refunded':
case 'payment.failed':
case 'payment.chargeback_received':
case 'fx_rate.changed':
case 'folio.fx_adjusted':
```

Do **not** call PropertyDO.

- [x] **Step 4: Rebuild, re-run, gates**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
```

Expected: all exit 0. `check:permissions` still reports current audit length (106). Events-queue allowlist includes the new catalog events.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/events/payment.ts packages/contracts/src/index.ts \
  packages/contracts/src/commands/catalog.ts packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/money.ts packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/event-consumer.ts
git commit -m "$(cat <<'EOF'
feat(contracts): catalog multi-currency folio commands and payment event v1

EOF
)"
```

---

### Task 2: `packages/money` `ledgerToTxn`

**Spec:** §8.12, §16 test **38**.

**Files:**
- Modify: `packages/money/src/index.ts`
- Modify: `packages/money/src/index.test.ts`

**Interfaces:**
- Produces: `ledgerToTxn(ledgerAmountMinor, txnCurrency, ledgerCurrency, fxRate): number`
- Consumes: existing `postToLedger` / `roundHalfAwayFromZero`
- **Forbidden:** PropertyDO, HTTP, schema.

- [x] **Step 1: Write the failing tests**

Same-currency + rate `"1"` returns the ledger amount. Cross-currency: `postToLedger(money(10000, EUR), USD, '1.10')` → 11000 (existing). Inverse: `ledgerToTxn(11000, EUR, USD, '1.10')` then `postToLedger` of that txn is within **1** minor of 11000. Same-currency with rate `!== "1"` throws `InvalidFxRateError`. Zero rate throws.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts
```

- [x] **Step 3: Implement `ledgerToTxn`**

Invert `postToLedger`’s BigInt path (`roundHalfAwayFromZero`). Same-currency requires `"1"`. No new `export class`.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts
pnpm --filter @hospai/money build
pnpm typecheck
```

- [x] **Step 5: Commit**

```bash
git add packages/money/src/index.ts packages/money/src/index.test.ts
git commit -m "$(cat <<'EOF'
feat(money): add ledgerToTxn inverse conversion

EOF
)"
```

---

### Task 3: v24 schema + purge lists

**Spec:** §9, §16 tests **1–4**.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `packages/do-runtime/src/multi-currency-folio-migration.sqlite.test.ts`
- Create (generated): `migrations/do-property/0024_multi_currency_folio.sql`
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` **only** (add `fx_rate`, `payment_event`, `payment_dispute`). No RPC bodies.

**Interfaces:**
- Produces: `MULTI_CURRENCY_FOLIO_V24_STATEMENTS` / `_SQL`; `PROPERTY_SCHEMA_HEAD === 24`; `SYSTEM_CHARGE_CODES` length **9**; purge lists include the three tables
- **Forbidden:** DO command methods, HTTP routes. **Do not rebuild `folio_line`.**

- [x] **Step 1: Write the failing migrate + sqlite tests**

`migrate.test.ts`:

1. MemorySql — before the unhandled throw, add prefixes (do **not** collapse into a generic `RENAME`):

```ts
if (q.startsWith('INSERT INTO payment_v24')) return { toArray: () => [] };
if (q.startsWith('DROP TABLE payment')) return { toArray: () => [] };
if (q.startsWith('ALTER TABLE payment_v24 RENAME TO payment')) return { toArray: () => [] };
```

`CREATE TABLE fx_rate` / `payment_event` / `payment_dispute` / indexes already match `CREATE TABLE` / `CREATE INDEX`. `INSERT OR IGNORE INTO charge_code` already stubbed. Keep existing `DROP TABLE payment` if v21 already added it — v24 reuses the same prefix (one stub covers both).

2. “applies property migrations through version 23” → **24**; `schemaVersion` length **24**.
3. Global `PROPERTY_SCHEMA_HEAD` pin **24**. Keep historical “head is 23 after prototype holes” as a `filter version <= 23` assertion if present; change **only** the global pin.
4. New: `property schema head is 24 after multi_currency_folio`; name `multi_currency_folio`; statements include `payment_v24`, `fx_rate`, `payment_event`, `payment_dispute`, `FX_GAIN`; first/last wrap `PRAGMA foreign_keys = OFF` / `ON`; **no** `folio_line_v24`.

`multi-currency-folio-migration.sqlite.test.ts` — follow `folio-money-ops-migration.sqlite.test.ts`:

- Apply 1–23 with `PRAGMA foreign_keys = ON`.
- Insert `folio_window`, `payment` (`captured`, v23 columns including `purpose`), `folio_line` ROOM + PAYMENT (`payment_id` set) + TAX.
- Apply v24 (and only v24, or `version > 23`).
- Assert counts 1/1/3; `payment.balance_at_risk = 0`; `fx_rate` / `fx_rate_at` NULL; `status='chargeback'` insert ok; `'BOGUS'` throws; orphan `payment_id` throws; three new tables exist.
- `SYSTEM_CHARGE_CODES` length 9 equals `['ROOM','PAYMENT','CANCEL','NO_SHOW','DISCOUNT','DAMAGE','FX_GAIN','FX_LOSS','CHARGEBACK_FEE']`.
- Re-run seed statements — `INSERT OR IGNORE` does not duplicate.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/multi-currency-folio-migration.sqlite.test.ts
```

Expected: FAIL — head 23 / missing file.

- [x] **Step 3: Land v24 statements**

Wrap: first `PRAGMA foreign_keys = OFF`, last `ON`.

`payment_v24` = every v21 column plus `fx_rate`, `fx_rate_at`, `balance_at_risk` DEFAULT 0, `last_payment_event_id`, status CHECK adds `chargeback`. Copy; backfill zeros/nulls. Drop `payment`; rename; recreate `payment_idempotency_uidx`, `payment_reservation_idx`.

Then `CREATE TABLE fx_rate` (spec §4.2), `payment_event` (§7.3), `payment_dispute` (§7.5) + indexes.

```sql
INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('FX_GAIN', 'FX gain', 'active', 0, 0),
  ('FX_LOSS', 'FX loss', 'active', 0, 0),
  ('CHARGEBACK_FEE', 'Chargeback fee', 'active', 0, 0);
```

Grow `SYSTEM_CHARGE_CODES` to the nine codes.

Export `MULTI_CURRENCY_FOLIO_V24_SQL` from `property-migrations.ts` and `index.ts`.

`scripts/property-ddl.mjs`: destructure the new SQL; append `doPropertyTargets` for `0024_multi_currency_folio.sql` (ORDER: PRAGMA OFF → payment rebuild → new tables → seeds → PRAGMA ON). Header must say **folio_line is not rebuilt**.

`property-do.ts` purge list + `countPropertyInventoryRows`: add the three tables in the same relative order as other inventory tables. Literal SQL only.

- [x] **Step 4: generate DDL and gates**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/multi-currency-folio-migration.sqlite.test.ts
pnpm check:ddl
pnpm check:purge
```

Expected: PASS. On-disk `0024_*.sql` matches. `check:purge` sees the new names.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/multi-currency-folio-migration.sqlite.test.ts \
  migrations/do-property/0024_multi_currency_folio.sql \
  scripts/property-ddl.mjs apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(schema): PropertyDO v24 multi-currency folio tables

EOF
)"
```

---

### Task 4: FX rate lookup + create/supersede RPCs

**Spec:** §4, §16 tests **5–6** (DO). HTTP GET/403 is Task 11.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/folio-fx-rates.spec.ts`

**Interfaces:**
- Produces: `lookupFxRateSync(from, to, at)`, `tryCreateFxRate`, `trySupersedeFxRate`, `listFxRates`
- Consumes: Task 3 tables; Task 1 wire codes
- **Forbidden:** HTTP routes, lifting `CROSS_CURRENCY_UNSUPPORTED` on add_item (Task 5).

- [x] **Step 1: Write failing DO tests (5–6)**

Provision USD ledger. `tryCreateFxRate` EUR→USD `"1.10"` → open row; `listFxRates` returns it. Identity pair → existing `MONEY_INVALID`; `to ≠ ledger` → `FX_RATE_NOT_LEDGER`. `MONEY_INVALID` already exists in `packages/contracts/src/money.ts` — reuse, do not add. Second open EUR→USD → `FX_RATE_OPEN_EXISTS`. Supersede closes first (`effective_to` set) and inserts replacement. Same fingerprint → one pair.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-rates.spec.ts
```

- [x] **Step 3: Implement**

Lookup SQL per spec §4.2. Create/supersede: `settings:configure`, `FAIL_CLOSED`, `runIdempotent`, outbox `fx_rate.changed`, `appendAuditLogSync`. Fingerprints per spec §4.3. File-local errors mapped to wire codes.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-rates.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:class-denylist
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-rates.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): staff-entered effective-dated FX rate table

EOF
)"
```

---

### Task 5: Lift identity gate on `folio.add_item` + ledger tax

**Spec:** §5, §8.8, §10.2 add_item lock, §16 tests **8–11**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `resolveFolioLineMoney`, `tryAddFolioLine`, `stampTaxForChargeSync`
- Create: `apps/pms-core/test/folio-fx-charges.spec.ts`

**Interfaces:**
- Produces: foreign add_item posts via `postToLedger`; tax on `ledger_amount_minor` in ledger identity
- Consumes: Task 4 lookup
- **Forbidden:** HTTP new routes; payment capture changes (Task 6).

- [x] **Step 1: Write failing tests 8–11**

8: add_item EUR, no rate → `FX_RATE_MISSING`, zero lines.  
9: rate `1.10`, add_item 10000 EUR + 10% tax → ROOM 10000/11000 @ `1.10`; TAX 1100 USD @ `"1"`; `balanceMinor === 12100`.  
10: same-currency add_item still identity; `CROSS_CURRENCY_UNSUPPORTED` not returned. Existing add_item tests must stay green.  
11: queue add_item EUR (rate present), drain → one line; supersede rate; same-key replay unchanged.

Resolve rate **before** `runIdempotent`; put frozen `fxRate` / `ledgerAmountMinor` into the fingerprint (spec §10.2).

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-charges.spec.ts test/folio-routes.spec.ts
```

- [x] **Step 3: Implement**

`resolveFolioLineMoney`: if `txnCurrency !== ledger`, lookup rate (or use client-supplied `fxRate` if present and `assertPostedMatches`); do **not** return `CROSS_CURRENCY_UNSUPPORTED` when a rate exists. Same-currency still requires `"1"`.

`stampTaxForChargeSync`: `computeTax(posted.ledgerAmountMinor, …)`; tax `PostedLineAmount` is ledger + `"1"`. Skip also `CHARGEBACK`, `TRANSFER_REVERSAL`, `FX_GAIN`/`FX_LOSS`/`CHARGEBACK_FEE`.

Night-audit ROOM stays ledger — existing tax tests must pass.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-charges.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-charges.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): post foreign folio.add_item and stamp tax on ledger

EOF
)"
```

---

### Task 6: `applyPaymentEventSync` + authorize/capture/cash/void/refund

**Spec:** §7.3–7.6, §8.1–8.5, §16 tests **12–16**, **19–21**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/folio-fx-payments.spec.ts`

**Interfaces:**
- Produces: `applyPaymentEventSync`; payment writers convert/freeze; dual-emit `payment.*` + `folio.payment_*`; `readFolio.balanceAtRisk` / `ledgerCurrency` / `fxRate` / `fxRateAt` / `txnBalances`
- Consumes: Tasks 2–5
- **Forbidden:** HTTP new routes; `capture_due` ledger-aware change (Task 7).

- [x] **Step 1: Write failing tests 12–16, 19–21**

12: authorize EUR → `payment.currency=EUR`, zero lines, outbox both event names; capture 10000 @ 1.10 → −10000 EUR / −11000 USD; `payment.fx_rate="1.10"`; `balanceMinor === -11000` (plus any room).  
13: authorize EUR, no rate, ok; capture → `FX_RATE_MISSING`, still `authorized`.  
14: cash EUR + rate → converted line; simulate not called.  
15: refund of 12 → +10000 / +11000 at **capture** rate; current 1.20 unused; `payment_id` NULL.  
16: void authorized EUR → `voided`, zero lines.  
19: authorize decline → `declined`, `balance_at_risk=1`, `readFolio.balanceAtRisk` true when balance > 0.  
20: `applyPaymentEventSync(captured)` with no auth row creates captured + line; later authorized does not add a line or flip back.  
21: redeliver same `event_id` → one line; same `gateway_reference` + different `event_id` → one line.

Expose `applyPaymentEventSync` via an `assertUnsafeLocal` test RPC **or** drive 20–21 through capture/authorize only if you can inject event ids — prefer a `applyPaymentEventForTest` gated like other test hooks.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts
```

- [x] **Step 3: Implement**

`applyPaymentEventSync` per spec §7.3 (payment_event PK + gateway unique index). In-DO commands construct V1 events after the adapter and apply inside the status txn, then emit both names.

Authorize: optional `currency`, fingerprint includes it, no rate lookup.  
Capture/cash: `postToLedger` at lookup-or-`"1"`, persist `payment.fx_rate` / `fx_rate_at`.  
Refund: copy capture line’s frozen both legs (fix today’s identity post).  
Void: unchanged money; do not emit `payment.failed`.  
Failed auth/capture: `payment.failed` + `balance_at_risk`.  
`readFolio` additive fields (spec §11.1) — existing GET folio will surface them once Task 11 forwards JSON; RPC can widen now.

`PaymentStatus` += `'chargeback'` (unused until Task 8). `PaymentRow` new columns.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts test/folio-payment-lifecycle.spec.ts test/folio-payments.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
pnpm check:class-denylist
```

Existing payment lifecycle tests must stay green (USD identity).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): apply payment events and convert foreign capture/refund

EOF
)"
```

---

### Task 7: `capture_due` + check-out auto-capture (ledger-aware)

**Spec:** §8.10, §16 tests **17–18**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `captureDueHoldsInner`
- Modify: `apps/pms-core/test/folio-fx-payments.spec.ts` (test 17)
- Modify: `apps/pms-core/test/reservations-check-out.spec.ts` (test 18)

**Forbidden:** HTTP new routes.

- [x] **Step 1: Write failing tests 17–18**

17: ROOM 5000 USD + EUR hold 10000 @ 1.10; `capture_due` takes a partial EUR via `ledgerToTxn`; remaining ledger 0 (±1); DAMAGE hold untouched.  
18: `auto_capture_on_check_out=true`, foreign STAY hold covers balance → `autoCapture: 'captured'`; same-key live replay recomputes `'captured'` and does not re-await; provisional replay → still `authorized`, `'skipped'`.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts test/reservations-check-out.spec.ts
```

- [x] **Step 3: Implement §8.10**

Remaining is ledger. Per hold: convert available txn → ledger; `takeLedger = min(available, remaining)`; `takeTxn` via `ledgerToTxn` when partial; capture through existing seam; subtract **posted** ledger abs. Damage skipped. Check-out await/recompute unchanged.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts test/reservations-check-out.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-payments.spec.ts \
  apps/pms-core/test/reservations-check-out.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): capture-due compares remaining ledger to foreign holds

EOF
)"
```

---

### Task 8: Chargeback + FX adjustment

**Spec:** §6.3, §7.5, §16 tests **22–25** (DO). Staff 403 HTTP is Task 11.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/folio-fx-chargeback.spec.ts`

- [x] **Step 1: Write failing tests 22–25**

22: chargeback captured USD, fee 250 → `chargeback`, reverse PAYMENT at original rate, `CHARGEBACK_FEE` +250, dispute `open`, events `payment.chargeback_received` + `folio.line_posted`.  
23: authorized / already chargeback (different fingerprint) → `PAYMENT_NOT_CHARGEBACKABLE`; same fingerprint → one reversal.  
24: foreign capture chargeback reverses at capture `fx_rate`, not `"1"`.  
25: fx adjustment loss 100 + reason → `FX_LOSS` +100; gain → `FX_GAIN` −100; no reason → `FX_REASON_REQUIRED`; capture line untouched. **No `folioLineId` in input.**

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-chargeback.spec.ts
```

- [x] **Step 3: Implement**

`tryRecordChargeback` / `tryPostFxAdjustment` per spec. Adjustment: UUID line id inside `runIdempotent`; fingerprint omits line id; `sourcePaymentId?` event-payload-only. Chargeback deterministic ids `${paymentId}:chargeback` / `${paymentId}:chargeback-fee`. No simulate chargeback method. CLOSED window → `WINDOW_CLOSED`.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-chargeback.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
pnpm check:class-denylist
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-chargeback.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): record chargeback and post residual FX adjustment

EOF
)"
```

---

### Task 9: Split / transfer / discount both-leg allocate

**Spec:** §8.6–8.9, §16 tests **26–30**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `splitFolioLineSync`, `tryPostDiscount` (transfer already copies both legs; restamp uses Task 5 tax)
- Create: `apps/pms-core/test/folio-fx-split-transfer.spec.ts`

- [x] **Step 1: Write failing tests 26–30**

26: v1 USD ROOM split still foots Σ amount and Σ ledger (regression).  
27: 60/40 of EUR 10000/11000: reverse −10000/−11000 @ 1.10; children `allocate` both legs LAST; Σ txn 10000, Σ ledger 11000; children rate `1.10`.  
28: transfer that ROOM to COMPANY: both legs + rate copied; reservation `balanceMinor` unchanged; dest tax in USD.  
29: 10% discount → −1000 EUR / −1100 USD @ 1.10.  
30: split/transfer/discount of `FX_LOSS` / `CHARGEBACK` / TAX → existing not-* codes.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts test/folio-payments.spec.ts
```

- [x] **Step 3: Implement**

`splitFolioLineSync`: `allocate` txn and ledger independently (same abs weights, `LAST`); copy `fx_rate` / `fx_rate_at` / `txn_currency`. **Do not** `postToLedger` per child. Same for tax dependents.

`tryPostDiscount`: percent/fixed in source txn units; `postToLedger` at source frozen rate. Reject `CHARGEBACK` / `FX_GAIN` / `FX_LOSS` / `CHARGEBACK_FEE`.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-fx-split-transfer.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms): allocate both money legs on split and discount at frozen rate

EOF
)"
```

---

### Task 10: Night-audit reports — ledger revenue + cashier tenders

**Spec:** §12, §16 tests **31–33**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `snapshotReportsAsync` cashier JSON only
- Modify: existing night-audit report / room-charges specs

- [x] **Step 1: Write failing tests 31–33**

31: `POST_ROOM_CHARGES` still ROOM + tax ledger identity; `NIGHT_AUDIT_STEPS.length === 7`.  
32: revenue `roomNet` / `taxTotal` / `byChargeCodeAndSource` use `ledger_amount_minor`; a EUR payment that night does **not** add 10000 into `roomNet`.  
33: cashier `tendersByCurrency` has `{ currency: 'EUR', capturedMinor: 10000, … }` and a USD cash row.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts
```

(Use the actual night-audit report spec filename in-tree if different.)

- [x] **Step 3: Implement**

Revenue query unchanged (already `SUM(ledger_amount_minor)`). Add `tendersByCurrency` per spec §12. Do not grow `NIGHT_AUDIT_STEPS`. Do not read `fx_rate` in `POST_ROOM_CHARGES`.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test
git commit -m "$(cat <<'EOF'
feat(pms): cashier snapshot breaks tenders out by txn currency

EOF
)"
```

---

### Task 11: HTTP routes 106–110 + widened GETs

**Spec:** §11, §16 tests **5** (HTTP GET), **7**, **34**, **39**, plus chargeback 403.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append 106–110 **only at end**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — matching `V1_ROUTES` order; 422 map; handlers; GET folio/payments/authorize/cash bodies
- Modify: `packages/contracts/src/register.test.ts` — route pins
- Create: `apps/pms-core/test/folio-fx-routes.spec.ts`

**Forbidden:** SPA. Do not splice before `[105]`.

- [x] **Step 1: Write failing route pins + HTTP tests**

`register.test.ts`:

```ts
expect(V1_HTTP_ROUTE_AUDIT[105]?.id).toBe('get_reservation_search');
expect(V1_HTTP_ROUTE_AUDIT[106]?.id).toBe('post_fx_rates');
expect(V1_HTTP_ROUTE_AUDIT[107]?.id).toBe('post_fx_rate_supersede');
expect(V1_HTTP_ROUTE_AUDIT[108]?.id).toBe('get_fx_rates');
expect(V1_HTTP_ROUTE_AUDIT[109]?.id).toBe('post_folio_chargeback');
expect(V1_HTTP_ROUTE_AUDIT[110]?.id).toBe('post_folio_fx_adjustment');
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(49);
```

`folio-fx-routes.spec.ts`: GET `/fx-rates` returns the open EUR row (test 5 HTTP). Staff without `settings:configure` → 403 on POST create (test 7). Kill-switch `pms.core` → 503 on create / chargeback / capture (tests 7, 39). Chargeback as staff (`folio:post` only) → 403. GET `/folio` includes `fxRate`, `fxRateAt`, `ledgerCurrency`, `balanceAtRisk`, `txnBalances`. Authorize/cash body accepts `currency`. Path `/folio/payments/fx-rates` is **not** the FX list (either 404 or a payment-id miss — do not add that path).

Map new wire codes → 422 in `mapReservationCommandErrorStatus` (or the folio error mapper next to `CROSS_CURRENCY_UNSUPPORTED`).

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
```

Expected: FAIL — audit/dispatcher length mismatch or missing pins.

- [x] **Step 3: Append routes in lockstep**

`V1_HTTP_ROUTE_AUDIT` then `V1_ROUTES` in this order:

1. `post_fx_rates` — `POST /v1/properties/:pid/fx-rates`
2. `post_fx_rate_supersede` — `POST /v1/properties/:pid/fx-rates/:qid/supersede`
3. `get_fx_rates` — `GET /v1/properties/:pid/fx-rates` (`degradedRead: FAIL_CLOSED`, no `commandId`)
4. `post_folio_chargeback` — `POST /v1/properties/:pid/folio/payments/:payId/chargeback`
5. `post_folio_fx_adjustment` — `POST /v1/properties/:pid/reservations/:rid/folio/fx-adjustment`

`invokePropertyDo` for mutations (503, never 202). Widen existing GET folio / payments handlers. Optional `currency` on authorize/cash dispatch + fingerprint.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-routes.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
pnpm check:pms-core-test-dates
```

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/folio-fx-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add FX rate, chargeback, and FX-adjustment routes [106-110]

EOF
)"
```

---

### Task 12: client-core + FolioScreen SPA

**Spec:** §13, §16 tests **40–43**.

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `packages/client-core/test/api-folio.test.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Keys:** `stableKeyForOperation` only.

- [x] **Step 1: Write failing tests 40–43**

40: line with `txnCurrency !== ledgerCurrency` shows `data-testid="line-fx"`; identity line does not.  
41: authorize `<select>` lists USD + EUR when `GET fx-rates` has an open EUR quote; submit sends `currency`.  
42: chargeback / FX adjustment hidden without `folio:adjust`; FX editor hidden without `settings:configure`.  
43: `balanceAtRisk` chip when the folio read says true.

Client tests: `authorizePayment` / `recordCashPayment` optional `currency`; new `listFxRates` / `createFxRate` / `supersedeFxRate` / `recordChargeback` / `postFxAdjustment`.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

- [x] **Step 3: Implement**

FolioScreen: dual amounts; currency selects; indicative authorize preview copy; FX rates disclosure (`settings:configure`); chargeback + adjustment (`folio:adjust`); `balanceAtRisk` chip. Disable FX/payment currency controls when folio/payments reads are not live. Rates screens unchanged.

- [x] **Step 4: Gates**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
pnpm check:web-pms-me-gating
pnpm check:web-pms-colors
pnpm typecheck
```

- [x] **Step 5: Commit**

```bash
git add packages/client-core apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): folio dual amounts, payment currency, and FX editor

EOF
)"
```

---

### Task 13: Sibling spec one-sentence amends

**Spec:** header **Amends**. Docs only. **No typecheck fixes in this commit.**

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-multi-currency-money-design.md` — FX sourcing / residual / `payment.*` now specified in this chunk
- Modify: `docs/superpowers/specs/2026-08-05-folio-charges-vertical-design.md` — identity-rate / `CROSS_CURRENCY_UNSUPPORTED` lifted for payments + add_item
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — leftover 4 split (chargebacks shipped; partial refunds remain); strike “identity-rate rule unchanged”

One sentence each. Do not rewrite those specs.

- [x] **Step 1: Edit the three specs**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-multi-currency-money-design.md \
  docs/superpowers/specs/2026-08-05-folio-charges-vertical-design.md \
  docs/superpowers/specs/2026-08-12-folio-money-operations-design.md
git commit -m "$(cat <<'EOF'
docs: point money, folio-charges, and money-ops specs at multi-currency folio

EOF
)"
```

---

### Task 14: ARCHITECTURE.md revision-note edit (spec §20)

**Spec:** §20 four numbered edits. Docs only. **No typecheck fixes in this commit.**

**Files:**
- Modify: `ARCHITECTURE.md` only

- [x] **Step 1: Apply all four edits**

1. Add **Revision 2026-08-13** at the top of the revision block: prototype-holes decisions closed; INQUIRY/PENDING drift closed; transfer/split/OOO shipped; multi-currency + payments↔folio event contract designed in `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md`; FX sourcing is no longer “still owed” once this chunk merges.
2. Rewrite the **2026-08-12** paragraph (lines 56–60) so it is a **historical** note, not an open punch list (DND / unnamed rows / INQUIRY-PENDING are closed).
3. Drop or narrow **“Still owed: FX rate sourcing and its refresh policy”** (lines 52–54). Keep exception-queue UX and fiscalization if still owed; do not leave FX sourcing as open.
4. §16.5 “Catalogued implementation gaps… `rooms.set_ooo_range`, `folio.transfer_charge` and `folio.split_charge_v2`” (~2182–2184) — **delete or mark shipped**. `PLATFORM_GAPS` is `[]`.

Do not rewrite the rest of §16.5’s decision table (already closed by prototype holes).

- [x] **Step 2: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: close stale ARCHITECTURE revision notes after multi-currency folio

EOF
)"
```

---

### Task 15: Full CI locally

**Spec:** §16 test **37**, §21.

If `pnpm typecheck` fails, **stop** and land a **separate** `fix(test): …` / `fix(types): …` commit. Do **not** fold typecheck fixes into Task 13/14/16.

- [x] **Step 1: Run the `checks` job commands in order**

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

Pins: `AUDIT_WRITER_COMMAND_IDS.size === 49`; `COMMAND_CATALOG.length === 74`; `PLATFORM_GAPS` `[]`; `NIGHT_AUDIT_STEPS.length === 7`; `SYSTEM_CHARGE_CODES` length 9; `PROPERTY_SCHEMA_HEAD === 24`; `[105]=get_reservation_search`; `[106]=post_fx_rates`; `[107]=post_fx_rate_supersede`; `[110]=post_folio_fx_adjustment`.

- [x] **Step 2: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

---

### Task 16: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–16 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [x] **Step 1: Mark checkboxes**

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-multi-currency-folio.md
git commit -m "$(cat <<'EOF'
docs: tick multi-currency folio plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip — but the intent is this commit is last.

---

## Spec coverage (self-review)

| Spec §16 / requirement | Task |
|---|---|
| Catalog 74, events v1, audit 49, event-consumer allowlist (35, 36) | 1 |
| `ledgerToTxn` (38) | 2 |
| v24 + MemorySql + v23→v24 sqlite + SYSTEM_CHARGE_CODES 9 + purge (1–4) | 3 |
| FX rate CRUD DO (5–6) | 4 |
| add_item foreign + tax on ledger (8–11) | 5 |
| applyPaymentEventSync + authorize/capture/cash/void/refund/failed (12–16, 19–21) | 6 |
| capture_due + check-out autoCapture FX (17–18) | 7 |
| chargeback + fx adjustment (22–25) | 8 |
| split/transfer/discount both legs (26–30) | 9 |
| night-audit revenue ledger + cashier tenders (31–33) | 10 |
| Routes 106–110, GET widen, 403/503 (5 HTTP, 7, 34, 39) | 11 |
| SPA 40–43 | 12 |
| Sibling spec pointers | 13 |
| ARCHITECTURE.md §20 edits 1–4 | 14 |
| Full CI (37) | 15 |
| Plan checkbox tick | 16 |
| Settlement ingest / PCI Worker / partial refund / `currencies_list` | not implemented (leftovers) |
