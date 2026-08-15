# City ledger / AR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Ship property-local city ledger / accounts-receivable — v33 `city_ledger_account` + `city_ledger_entry`, `billed_party` soft FK on COMPANY windows, append-only AR with charge posting on window close + night-audit catch-up, derived aging, R2 JSON statements on `EVENT_LOG_R2`, six catalog commands (catalog **92**, writers **65**, HTTP **[141]–[145]**), City Ledger SPA + Folio account picker — **no** PDF worker, **no** PATCH on entries, **no** event consumer (MVP), **no** MASTER group billing.

**Architecture:** City ledger is a **separate aggregate** (not a folio variant). COMPANY folio windows reference active accounts via canonical `billed_party` name. On COMPANY window close (balance zero), `postCityLedgerChargeSync` posts one `charge` entry (sum of non-PAYMENT `ledger_amount_minor` lines) inside the parent `folio.close_window` txn; night-audit `SNAPSHOT_REPORTS` Txn B catches up missed charges. Aging buckets are computed at read time from `business_date + terms_days`. Statements mirror invoice R2 pattern: snapshot built in txn, `await bucket.put` outside txn, idempotency cache for `(accountId, asOfDate)` replays — no SQLite statement table.

**Tech Stack:** PropertyDO sqlite v33 (`@hospai/do-runtime`), `@hospai/contracts` wire codes + catalog/routes, vitest Worker HTTP (`city-ledger-ar.spec.ts`), web-pms RTL (`CityLedgerScreen.test.tsx`, `FolioScreen.test.tsx`), `@hospai/client-core`, `EVENT_LOG_R2`.

**Spec:** `docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md` (Approved at `5a86dc8` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes Phase 1 leftover **11** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~40–50).

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **86 → 92** | Moving `[140]`–`[127]` |
| `AUDIT_WRITER_COMMAND_IDS.size` **61 → 65** | MASTER group billing / allotments |
| HTTP append `[141] post_city_ledger_accounts` … `[145] get_city_ledger_statement` | PDF statement worker |
| `PROPERTY_SCHEMA_HEAD` **32 → 33** | PATCH / DELETE on `city_ledger_entry` |
| `ORG_SCHEMA_HEAD` **7** unchanged | OrgDO-hosted chain-wide city ledger |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | Event consumer on `folio.window_closed` (stretch Lock 14) |
| `billed_party` retroactive FK migration | Grandfathered free-text stays |
| Tests Lock 13 | Ticking Tasks 1–5 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.2)

**Locked:** `COMMAND_CATALOG` **86 → 92** — append six `city_ledger.*` after `invoice.void`. `AUDIT_WRITER_COMMAND_IDS.size` **61 → 65** (+4 writers: `create_account`, `update_account`, `receive_payment`, `generate_statement`; `post_charge` and `archive_account` exempt). HTTP `[140] post_invoice_void` last; `[127]`–`[140]` **unmoved**. Append `[141]`–`[145]`. `PROPERTY_SCHEMA_HEAD` **32 → 33**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — v33 DDL + triggers (spec Lock 4)

**Locked:** `CITY_LEDGER_AR_V33_STATEMENTS` / `_SQL` exactly as spec Lock 4 DDL (`city_ledger_account`, `city_ledger_entry`, partial unique charge index, `folio_window_billed_party_city_ledger_insert` + `_update` triggers). No FK from entries to `reservation` / `folio_window`. No third SQLite table for statements.

### D3 — Wire codes + HTTP map (spec Lock 10)

**Locked:** Nine `CITY_LEDGER_*` constants in `idempotency.ts`. Map: `*_NOT_FOUND` / `city_ledger_statement_not_found` → **404**; `*_EXISTS` / `*_ARCHIVED` / `city_ledger_charge_already_posted` → **409**; `*_EXCEEDED` / `*_EXCEEDS_BALANCE` / `city_ledger_billed_party_invalid` → **422**; `city_ledger_r2_unbound` → **503**. Internal classes: `CityLedgerError`, `CityLedgerCreditLimitExceededError`, `CityLedgerBilledPartyInvalidError` — non-export, map in `mapReservationPreconditionError` / dispatch.

### D4 — Commands (spec Lock 5)

**Locked:** Six catalog entries after `invoice.void`. `city_ledger.post_charge` — catalog/audit/entitlement only; **not dispatched** via `runIdempotent`; implementation is private `postCityLedgerChargeSync`. `city_ledger.archive_account` + `city_ledger.post_charge` → `AUDIT_WRITER_EXEMPTIONS` (audit row still required in txn). `city_ledger.charge_posted` emitted by parent `folio.close_window` / `night_audit.run`, not `post_charge`. **Do not** add city ledger commands to `REPLAY_DISPATCH`.

### D5 — `billed_party` soft FK (spec Lock 6)

**Locked:** New COMPANY opens resolve `billedParty` as `account_id` OR `name` against active account; persist canonical `account.name`. Grandfather: prior COMPANY row with same `billed_party` text allows INSERT without account (trigger + DO agree). Close/post requires resolvable **active** account.

### D6 — Charge posting + catch-up (spec Locks 3, 7, 8)

**Locked:** `postedReceivableMinor` = sum `ledger_amount_minor` where `charge_code != 'PAYMENT'`. Credit limit check before close completes. Hook in `tryCloseFolioWindow` **after** balance gate, **before** `closeFolioWindowSync`. Night-audit catch-up in `SNAPSHOT_REPORTS` Txn B alongside `indexReportPutsSync` — **not** async pre-phase.

### D7 — Derived aging (spec Lock 2)

**Locked:** `dueDate = business_date + terms_days` (calendar days); `daysOverdue = max(0, asOfDate - dueDate)` default `__meta.business_date`. Payments stored positive, subtract in balance. Bucket assignment oldest-first for summary totals. **Never** persist aging columns.

### D8 — HTTP + RPC (spec Lock 10)

**Locked:** Five HTTP routes after `[140]`. Single GET `[142]` list vs detail via `?accountId=`. Statement **generate** via DO RPC `tryGenerateCityLedgerStatement` only (no HTTP audit row). PATCH `[143]` dispatches `archive_account` when `body.status === 'archived'`. `scripts/permissions-check.mjs` and `scripts/degraded-check.mjs`: add five routes to **both** `v1-dispatch.ts` and `v1-http-routes.ts`.

### D9 — SPA (spec Lock 11)

**Locked:** `CityLedgerScreen` with `data-testid` prefix `city-ledger-*`. Nav entry **City ledger** (front-desk class, `folio:read`). Folio COMPANY input becomes account autocomplete from active accounts; free-text disabled for new windows.

### D10 — Tests / CI discipline (spec Lock 13)

**Locked:** File-filter vitest; **no `vi.spyOn` into DO isolate.** Rebuild `@hospai/contracts` before pms-core tests (Task 2+). Rebuild `@hospai/client-core` before web-pms tests (Task 5). `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D11 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 6 only** at implementation time. Bidirectional pointers — **Task 6 only**. No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` moves 32 → 33** — `city_ledger_account` + `city_ledger_entry` + triggers only.
- **AR is append-only** — no UPDATE/DELETE on entries; corrections via new `adjustment` entries (desk UI deferred).
- **Catalog 92 / writers 65 / routes [141]–[145]** — append after `[140]`/`invoice.void`; do not move `[140]`–`[127]`.
- **`pnpm generate:ddl`** = `pnpm --filter @hospai/do-runtime build && node scripts/property-ddl.mjs --write`.
- **R2 put outside `transactionSync`** for statements — idempotency response cached after successful put.
- **Charge posting inherits parent idempotency** — partial unique index on `folio_window_id` for charges.
- **Scope-out (forbidden all tasks):** MASTER group billing; commission tracking; credit notes; recurring engine; OrgDO city ledger; PDF worker; PATCH on entries; event consumer (MVP); HTTP POST generate statement; adjustment desk UI; COMPANY window invoices; growing `NIGHT_AUDIT_STEPS`; `CLASS_DENYLIST`; `ARCHITECTURE.md`; push; ticking Tasks 1–5 living boxes.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `CITY_LEDGER_AR_V33_*`; append v33 | 1 |
| `packages/do-runtime/src/index.ts` | export v33 SQL/constants | 1 |
| `migrations/do-property/0033_city_ledger_ar.sql` | generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql + head **33** | 1 |
| `scripts/property-ddl.mjs` | target `0033_city_ledger_ar.sql` | 1 |
| `apps/pms-core/src/property-do.ts` | purge list; account CRUD; aging; entries; close hook; catch-up; statement R2; `billed_party` validation | 1, 2, 3 |
| `packages/contracts/src/idempotency.ts` | nine `CITY_LEDGER_*` wire codes | 1 |
| `packages/contracts/src/idempotency.test.ts` | wire assertions | 1 |
| `packages/contracts/src/commands/catalog.ts` | +6 commands after `invoice.void` | 1 |
| `packages/contracts/src/commands/audit-writers.ts` | +4 writers; +2 exemptions | 1 |
| `packages/contracts/src/v1-http-routes.ts` | +5 route audit entries after `[140]` | 1 |
| `packages/contracts/src/register.test.ts` | pins **92** / **65** / **[141]–[145]** | 1, 6 |
| `apps/pms-core/src/event-log.ts` | `cityLedgerStatementObjectKey`, `cityLedgerStatementsPrefixForProperty` | 2 |
| `apps/pms-core/src/event-consumer.ts` | allowlist `city_ledger.*` events noop | 2 |
| `apps/pms-core/test/city-ledger-ar.spec.ts` | Lock 13 cases **1–15** | 2, 3, 4 |
| `apps/pms-core/src/v1-dispatch.ts` | five handlers + `V1_ROUTES` + error map | 4 |
| `packages/client-core/src/api.ts` | city ledger client methods | 4 |
| `apps/web-pms/src/screens/CityLedgerScreen.tsx` | list, detail, create, payment, statement | 5 |
| `apps/web-pms/src/screens/CityLedgerScreen.test.tsx` | Lock 13 SPA cases | 5 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | COMPANY account picker | 5 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | COMPANY picker case | 5 |
| `apps/web-pms/src/shell/nav.ts` | City ledger nav entry | 5 |
| `apps/web-pms/src/App.tsx` | `/city-ledger` routes | 5 |
| `apps/pms-core/src/purge-workflow.ts` | city-ledger R2 prefix delete | 6 |
| `apps/pms-core/test/purge-workflow.spec.ts` | statement prefix purge assertion | 6 |
| `.superpowers/sdd/progress-phase1-leftovers.md` | Close leftover **11** | 6 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close leftover **6** | 6 |
| `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` | Close leftover **7** | 6 |
| `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` | Close leftover **8** | 6 |
| `docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md` | Close leftover **5** | 6 |
| `docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md` | Tick §8 checklist | 6 |
| `docs/superpowers/plans/2026-08-15-city-ledger-ar.md` | Task 6 checkboxes (this file) | 6 |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS` array, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `ARCHITECTURE.md`.

---

## Spec §1.3 / §8 → task map

| Spec item | Task |
|---|---|
| §1.3 (1) v33 migration + triggers | 1 |
| §1.3 (5–6) wire + catalog + routes audit | 1 |
| §1.3 (3–4) account CRUD + AR entries + aging | 2 |
| §1.3 (2) `billed_party` soft FK | 2 |
| §1.3 (5–6) charge posting + close hook + catch-up | 3 |
| §1.3 (8) `generate_statement` R2 | 2 |
| §1.3 (9) five HTTP routes | 4 |
| §1.3 (10) SPA + Folio picker | 5 |
| §1.3 (11) purge + DDL finalize | 6 |
| Lock 13 DO **1–15** | 2, 3, 4 |
| Lock 13 SPA | 5 |
| §8 checklist + pointers | 6 |
| Lock 14 event consumer stretch | skip MVP |
| §1.4 scope out | forbidden all |

---

### Task 1: Schema v33 + wire codes + catalog pins

**Spec:** §2 Locks 4, 5 (catalog/audit only), Lock 10 (wire only), Lock 12 (purge table list partial), §4 error taxonomy partial.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` — after `INVOICE_GENERATION_V32_*` (~1253–1257); append to `PROPERTY_MIGRATIONS`
- Modify: `packages/do-runtime/src/index.ts` — export v33 (~118–119)
- Modify: `packages/do-runtime/src/migrate.test.ts` — head **33** (~632, ~889+)
- Modify: `scripts/property-ddl.mjs` — after `0032_invoice_generation.sql` (~451–460)
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` (~1318–1351); `countPropertyInventoryRows` (~1357–1389)
- Modify: `packages/contracts/src/idempotency.ts` — after `FOLIO_BALANCE_DUE` (~113)
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts` — after `invoice.void` (~950–959)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — after `invoice.void` (~50); add exemptions (~67+)
- Modify: `packages/contracts/src/v1-http-routes.ts` — after `post_invoice_void` (~834–840)
- Modify: `packages/contracts/src/register.test.ts` — pins (~717–726)
- Create: `migrations/do-property/0033_city_ledger_ar.sql` — via `pnpm generate:ddl`

**Interfaces:**
- Produces: `CITY_LEDGER_AR_V33_STATEMENTS`, `CITY_LEDGER_AR_V33_SQL`
- Produces: nine wire constants
- Produces: six catalog entries; writers **65**; exemptions for `post_charge`, `archive_account`
- Produces: `PROPERTY_SCHEMA_HEAD === 33`

**Forbidden this commit:** DO city ledger RPCs, HTTP handlers, SPA, spec pointers, R2 prefix purge, `billed_party` DO validation.

- [ ] **Step 1: Write failing migrate tests (schema head 33)**

In `packages/do-runtime/src/migrate.test.ts`:

1. Import `CITY_LEDGER_AR_V33_SQL` alongside `INVOICE_GENERATION_V32_SQL` (~47).
2. Update `expect(PROPERTY_SCHEMA_HEAD).toBe(33)` (~632).
3. Add after invoice_generation block (~889+):

```typescript
  it('property schema head is 33 after city_ledger_ar', () => {
    const v33 = PROPERTY_MIGRATIONS.find((m) => m.version === 33);
    expect(v33?.name).toBe('city_ledger_ar');
    expect(v33?.statements[0]).toContain('CREATE TABLE city_ledger_account');
    expect(v33?.statements.some((s) => s.includes('city_ledger_charge_window'))).toBe(true);
    expect(v33?.statements.some((s) => s.includes('folio_window_billed_party_city_ledger_insert'))).toBe(true);
  });

  it('migrations/do-property/0033_city_ledger_ar.sql matches CITY_LEDGER_AR_V33_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0033_city_ledger_ar.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(CITY_LEDGER_AR_V33_SQL.trim());
  });
```

4. Update `applies property migrations through version 32` → **version 33** if present (~226–237): expect tail version **33**.

- [ ] **Step 2: Run migrate tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|city_ledger|through version"
```

Expected: **FAIL** — head still **32**; v33 missing.

- [ ] **Step 3: Add v33 migration + purge list**

In `packages/do-runtime/src/property-migrations.ts` after `INVOICE_GENERATION_V32_SQL` — paste **exactly** spec Lock 4 DDL as `CITY_LEDGER_AR_V33_STATEMENTS` (two tables, three indexes, two triggers). Join with `;\n\n` + trailing `;\n` → `CITY_LEDGER_AR_V33_SQL`.

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 33,
    name: 'city_ledger_ar',
    statements: CITY_LEDGER_AR_V33_STATEMENTS,
  },
```

Export from `packages/do-runtime/src/index.ts`:

```typescript
  CITY_LEDGER_AR_V33_SQL,
  CITY_LEDGER_AR_V33_STATEMENTS,
```

In `scripts/property-ddl.mjs` after `0032_invoice_generation.sql`:

```javascript
  {
    path: join(root, 'migrations/do-property/0033_city_ledger_ar.sql'),
    header: `-- PropertyDO city ledger / AR — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE city_ledger_account → city_ledger_entry → indexes → billed_party triggers.

`,
    sql: CITY_LEDGER_AR_V33_SQL,
  },
```

In `apps/pms-core/src/property-do.ts` — insert alphabetically in `PROPERTY_PURGE_INVENTORY_TABLES` (~1318):

```typescript
  'charge_code',
  'city_ledger_account',
  'city_ledger_entry',
  'folio_routing_rule',
```

In `countPropertyInventoryRows` — insert after `charge_code` count (~1361):

```typescript
      (SELECT COUNT(*) FROM city_ledger_account) +
      (SELECT COUNT(*) FROM city_ledger_entry) +
      (SELECT COUNT(*) FROM folio_routing_rule) +
```

(Replace bare `folio_routing_rule` line if duplicate — ensure exactly one term per table.)

- [ ] **Step 4: Add wire codes + catalog + routes audit + register pins**

`packages/contracts/src/idempotency.ts` after `FOLIO_BALANCE_DUE` (~113):

```typescript
export const CITY_LEDGER_ACCOUNT_NOT_FOUND = 'city_ledger_account_not_found' as const;
export const CITY_LEDGER_ACCOUNT_EXISTS = 'city_ledger_account_exists' as const;
export const CITY_LEDGER_ACCOUNT_ARCHIVED = 'city_ledger_account_archived' as const;
export const CITY_LEDGER_CREDIT_LIMIT_EXCEEDED = 'city_ledger_credit_limit_exceeded' as const;
export const CITY_LEDGER_BILLED_PARTY_INVALID = 'city_ledger_billed_party_invalid' as const;
export const CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE = 'city_ledger_payment_exceeds_balance' as const;
export const CITY_LEDGER_STATEMENT_NOT_FOUND = 'city_ledger_statement_not_found' as const;
export const CITY_LEDGER_R2_UNBOUND = 'city_ledger_r2_unbound' as const;
export const CITY_LEDGER_CHARGE_ALREADY_POSTED = 'city_ledger_charge_already_posted' as const;
```

`packages/contracts/src/idempotency.test.ts` — assert all nine string values.

`packages/contracts/src/commands/catalog.ts` append after `invoice.void`:

```typescript
  {
    id: 'city_ledger.create_account',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['city_ledger.account_created'],
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
  {
    id: 'city_ledger.update_account',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['city_ledger.account_updated'],
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
  {
    id: 'city_ledger.archive_account',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['city_ledger.account_archived'],
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
  {
    id: 'city_ledger.post_charge',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    entitlement: 'pms.core',
    permission: 'folio:post',
  },
  {
    id: 'city_ledger.receive_payment',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['city_ledger.payment_received'],
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
  {
    id: 'city_ledger.generate_statement',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['city_ledger.statement_generated'],
    entitlement: 'pms.core',
    permission: 'folio:read',
  },
```

`packages/contracts/src/commands/audit-writers.ts` after `invoice.void`:

```typescript
  'city_ledger.create_account',
  'city_ledger.update_account',
  'city_ledger.receive_payment',
  'city_ledger.generate_statement',
```

Append to `AUDIT_WRITER_EXEMPTIONS`:

```typescript
  {
    id: 'city_ledger.archive_account',
    reason: 'Terminal status flip; appendAuditLogSync in txn (same pattern as config.put_domain exemption class)',
  },
  {
    id: 'city_ledger.post_charge',
    reason: 'Internal-only; invoked from folio.close_window / night audit; audit correlation via parent command audit row + entry source',
  },
```

`packages/contracts/src/v1-http-routes.ts` append after `post_invoice_void`:

```typescript
  {
    id: 'post_city_ledger_accounts',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'city_ledger.create_account',
    entitlement: 'pms.core',
  },
  {
    id: 'get_city_ledger_accounts',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'patch_city_ledger_account',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'city_ledger.update_account',
    entitlement: 'pms.core',
  },
  {
    id: 'post_city_ledger_account_payment',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'city_ledger.receive_payment',
    entitlement: 'pms.core',
  },
  {
    id: 'get_city_ledger_statement',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
```

Update `packages/contracts/src/register.test.ts` (~717–726):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[140]?.id).toBe('post_invoice_void');
    expect(V1_HTTP_ROUTE_AUDIT[141]?.id).toBe('post_city_ledger_accounts');
    expect(V1_HTTP_ROUTE_AUDIT[141]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'city_ledger.create_account',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[142]?.id).toBe('get_city_ledger_accounts');
    expect(V1_HTTP_ROUTE_AUDIT[142]).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[143]?.id).toBe('patch_city_ledger_account');
    expect(V1_HTTP_ROUTE_AUDIT[144]?.id).toBe('post_city_ledger_account_payment');
    expect(V1_HTTP_ROUTE_AUDIT[145]?.id).toBe('get_city_ledger_statement');
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(65);
    expect(COMMAND_CATALOG).toHaveLength(92);
```

- [ ] **Step 5: Generate DDL + run tests**

```bash
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|city_ledger|through version"
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:ddl
pnpm check:purge
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 33`; catalog **92**; writers **65**; `[140]` unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  scripts/property-ddl.mjs \
  apps/pms-core/src/property-do.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  migrations/do-property/0033_city_ledger_ar.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v33 city ledger schema and wire codes

EOF
)"
```

---

### Task 2: DO account CRUD + aging reads + payment + statement + billed_party validation

**Spec:** §2 Locks 2, 5 (create/update/receive/generate), Lock 6, Lock 9, Lock 12 cases **1–6**, **10–12**, **15** (stub-level; HTTP in Task 4).

**Files:**
- Modify: `apps/pms-core/src/event-log.ts` — `cityLedgerStatementObjectKey`, `cityLedgerStatementsPrefixForProperty`
- Modify: `apps/pms-core/src/property-do.ts` — account CRUD RPCs; aging helpers; `tryReceiveCityLedgerPayment`; `tryGenerateCityLedgerStatement`; `listCityLedgerAccounts` / `readCityLedgerAccountDetail`; `resolveCityLedgerAccountSync`; `tryOpenFolioWindow` COMPANY validation (~13929–13949)
- Modify: `apps/pms-core/src/event-consumer.ts` — allowlist city ledger events (~139+)
- Create: `apps/pms-core/test/city-ledger-ar.spec.ts` — cases **1–6**, **10–12**, **15**

**Interfaces:**
- Produces: `tryCreateCityLedgerAccount`, `tryUpdateCityLedgerAccount`, `tryArchiveCityLedgerAccount`
- Produces: `listCityLedgerAccounts`, `readCityLedgerAccountDetail` (entries + aging + recent statements from idempotency)
- Produces: `computeAgingBucketsSync`, `openBalanceMinorSync`
- Produces: `tryReceiveCityLedgerPayment`, `tryGenerateCityLedgerStatement`
- Produces: `resolveCityLedgerAccountSync` — match by `account_id` or `name`, active only
- Consumes: Task 1 v33 tables + wire codes

**Forbidden this commit:** HTTP handlers, SPA, close hook (Task 3), spec pointers.

- [ ] **Step 1: Write failing stub tests (`city-ledger-ar.spec.ts` cases 1–6, 10–12, 15)**

Create `apps/pms-core/test/city-ledger-ar.spec.ts` mirroring `invoice-generation.spec.ts` helpers (`provisionedPropertyStub`, `createGuest`, `stayCheckedIn`, `idemFor`, `TEST_OWNER_ACTOR`). Add shared helpers:

```typescript
async function createCityLedgerAccount(
  stub: DurableObjectStub<PropertyDO>,
  input: { name: string; creditLimitMinor?: number; termsDays?: number },
) {
  return stub.tryCreateCityLedgerAccount(
    TEST_OWNER_ACTOR,
    input,
    await idemFor(`cla-create-${input.name}`, { name: input.name.trim() }),
  );
}
```

**Case 1** — `create account — happy path; duplicate name → 409 city_ledger_account_exists`:

```typescript
it('case 1: create account — happy path; duplicate name → city_ledger_account_exists', async () => {
  const { stub } = await provisionedPropertyStub(`cl-1-${crypto.randomUUID()}`, 'UTC', 'USD');
  const first = await createCityLedgerAccount(stub, { name: 'Acme Corp', creditLimitMinor: 500000, termsDays: 30 });
  expect(first).toMatchObject({ ok: true, name: 'Acme Corp', status: 'active' });
  const dup = await createCityLedgerAccount(stub, { name: 'Acme Corp' });
  expect(dup).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_EXISTS });
});
```

**Case 2** — update patch; archived account → **409** `city_ledger_account_archived`.

**Case 3** — archive idempotent; verify `status = 'archived'` on replay.

**Case 4** — open COMPANY with active account name — succeeds; `billed_party` canonicalized (stub `tryOpenFolioWindow` + read window row).

**Case 5** — unknown label → **422** `city_ledger_billed_party_invalid` (extend `tryOpenFolioWindow` return union + map in catch).

**Case 6** — grandfather: use test helper `seedLegacyCompanyWindowSync(reservationId, 'Legacy Co')` (raw SQL INSERT on `folio_window` bypassing trigger path for legacy row); new open with same text without account → **422**; reading legacy row still OK.

**Case 10** — receive payment reduces open balance; overpayment → **422** `city_ledger_payment_exceeds_balance`.

**Case 11** — seed charge/payment entries across dates via stub helpers; assert derived aging on `readCityLedgerAccountDetail`.

**Case 12** — generate statement: R2 object exists; idempotent replay same `{ statementId, r2Key, sha256 }`.

**Case 15** — `setReportsR2UnboundForTest(true)` → **503** `city_ledger_r2_unbound`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts -t "case [1-6]|case 1[0-5]"
```

Expected: **FAIL** — RPCs missing.

- [ ] **Step 3: Add event-log key helpers**

In `apps/pms-core/src/event-log.ts`:

```typescript
export function cityLedgerStatementObjectKey(
  propertyId: string,
  accountId: string,
  statementId: string,
): string {
  return `city-ledger-statements/${propertyId}/${accountId}/${statementId}.json`;
}

export function cityLedgerStatementsPrefixForProperty(propertyId: string): string {
  return `city-ledger-statements/${propertyId}/`;
}
```

- [ ] **Step 4: Implement PropertyDO account layer + aging + statement**

Add error classes near invoice errors (~758+):

```typescript
class CityLedgerError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'CityLedgerError';
  }
}
class CityLedgerCreditLimitExceededError extends Error {
  constructor() {
    super(CITY_LEDGER_CREDIT_LIMIT_EXCEEDED);
    this.name = 'CityLedgerCreditLimitExceededError';
  }
}
class CityLedgerBilledPartyInvalidError extends Error {
  constructor() {
    super(CITY_LEDGER_BILLED_PARTY_INVALID);
    this.name = 'CityLedgerBilledPartyInvalidError';
  }
}
```

Extend `mapReservationPreconditionError` for city ledger wire codes.

**Account resolution:**

```typescript
  private resolveCityLedgerAccountSync(raw: string): { accountId: string; name: string } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT account_id, name FROM city_ledger_account
         WHERE status = 'active' AND (account_id = ? OR name = ?)
         LIMIT 1`,
        trimmed,
        trimmed,
      )
      .toArray() as Array<{ account_id: string; name: string }>;
    const row = rows[0];
    return row ? { accountId: row.account_id, name: row.name } : null;
  }
```

**Aging (Lock 2)** — private helpers:

```typescript
  private readBusinessDateSync(): string {
    const meta = this.readConfigValueSync('__meta.business_date');
    if (typeof meta === 'string' && meta.length === 10) return meta;
    return new Date().toISOString().slice(0, 10);
  }

  private computeAgingBucketsSync(
    accountId: string,
    termsDays: number,
    asOfDate: string,
  ): AgingBuckets {
    // Load entries; compute per-entry open amount (oldest-first allocation for payments)
    // dueDate = business_date + termsDays calendar days
    // daysOverdue → bucket: current (0), 30 (1-30), 60 (31-60), 90+ (≥61)
  }

  private openBalanceMinorSync(accountId: string): number {
    // SUM charges + signed adjustments − payments (payments stored positive)
  }
```

**`tryCreateCityLedgerAccount`** — fingerprint `{ name: normalizedName }`; trim name 1–128; defaults `creditLimitMinor = 0`, `termsDays = 30`; duplicate → `CityLedgerError(CITY_LEDGER_ACCOUNT_EXISTS)`; audit + outbox `city_ledger.account_created`.

**`tryUpdateCityLedgerAccount`** — patch sorted stable fingerprint; archived → **409**; name collision → **409**.

**`tryArchiveCityLedgerAccount`** — idempotent if already archived; audit in txn (exempt from writer set but row required).

**`tryReceiveCityLedgerPayment`** — positive `amountMinor`; fingerprint `{ accountId, amountMinor, businessDate, reference: ref ?? null }`; overpayment → **422**.

**Statement flow** (mirror `tryGenerateInvoice` ~18116):

```typescript
  async tryGenerateCityLedgerStatement(actor, input: { accountId: string; asOfDate?: string }, idem) {
    const asOfDate = input.asOfDate ?? this.readBusinessDateSync();
    const fingerprint = { accountId: input.accountId, asOfDate };
    // Idempotency replay returns cached { statementId, r2Key, sha256, snapshot }
    const statementId = crypto.randomUUID();
    const snapshot = this.buildCityLedgerStatementSnapshotSync({ accountId, asOfDate, statementId });
    const put = await this.putCityLedgerStatementObject(propertyId, input.accountId, statementId, snapshot);
    return this.ctx.storage.transactionSync(() =>
      runIdempotent(this.ctx.storage.sql, idem, () => {
        this.appendPropertyOutbox({ eventType: 'city_ledger.statement_generated', ... });
        this.appendAuditLogSync({ commandId: 'city_ledger.generate_statement', ... });
        return { ok: true, statementId, r2Key: put.r2Key, sha256: put.sha256, snapshot };
      }),
    );
  }
```

`buildCityLedgerStatementSnapshotSync` — `schemaVersion: 1`; account snapshot; `aging`; open `entries[]` with `dueDate`, `daysOverdue`; `totals`.

**`tryOpenFolioWindow` COMPANY branch** (~13929):

```typescript
          if (input.kind === 'COMPANY') {
            const raw = input.billedParty?.trim() ?? '';
            if (!raw || raw.length > 128) throw new FolioWindowError(WINDOW_NOT_OPENABLE);
            const account = this.resolveCityLedgerAccountSync(raw);
            if (!account) {
              // grandfather: allow if prior COMPANY row exists with same billed_party
              const legacy = this.ctx.storage.sql
                .exec(
                  `SELECT 1 FROM folio_window WHERE kind = 'COMPANY' AND billed_party = ? LIMIT 1`,
                  raw,
                )
                .toArray();
              if (legacy.length === 0) throw new CityLedgerBilledPartyInvalidError();
              billedParty = raw;
            } else {
              billedParty = account.name;
            }
            const slug = billedPartySlug(billedParty);
            folioWindowId = `${input.reservationId}:COMPANY:${slug}`;
          }
```

Map `CityLedgerBilledPartyInvalidError` in catch → `{ ok: false, error: CITY_LEDGER_BILLED_PARTY_INVALID }`.

In `apps/pms-core/src/event-consumer.ts`:

```typescript
    case 'city_ledger.account_created':
    case 'city_ledger.account_updated':
    case 'city_ledger.account_archived':
    case 'city_ledger.payment_received':
    case 'city_ledger.statement_generated':
```

- [ ] **Step 5: Rebuild contracts + run stub tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts -t "case [1-6]|case 1[0-5]"
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts -t "accepts every COMMAND_CATALOG"
```

Expected: cases **1–6**, **10–12**, **15** **PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/event-log.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/test/city-ledger-ar.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): city ledger account CRUD aging and statements

EOF
)"
```

---

### Task 3: DO entry posting + close hook + night-audit catch-up

**Spec:** §2 Locks 3, 7, 8, Lock 12 cases **7–9**, **14**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `postCityLedgerChargeSync`; `postPendingCityLedgerChargesForBusinessDateSync`; hook in `tryCloseFolioWindow` (~14017–14020); emit `city_ledger.charge_posted` from parent commands
- Modify: `apps/pms-core/test/city-ledger-ar.spec.ts` — cases **7–9**, **14**

**Interfaces:**
- Produces: `postCityLedgerChargeSync({ folioWindowId, source, actor })` — private; returns `{ ok: true, entryId }` or error
- Produces: `postPendingCityLedgerChargesForBusinessDateSync(businessDate)` — called from `SNAPSHOT_REPORTS` Txn B (~2829–2830)
- Produces: `postedReceivableMinorSync(folioWindowId)` — sum non-PAYMENT lines
- Consumes: Task 2 account resolution + open balance helpers

**Forbidden this commit:** HTTP handlers, SPA, spec pointers.

- [ ] **Step 1: Write failing charge posting tests (cases 7–9, 14)**

Append helpers to `city-ledger-ar.spec.ts`:

```typescript
async function companyWindowWithCharges(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  accountName: string,
) {
  await createCityLedgerAccount(stub, { name: accountName, creditLimitMinor: 1_000_000 });
  await stub.tryOpenFolioWindow(
    TEST_OWNER_ACTOR,
    { reservationId, kind: 'COMPANY', billedParty: accountName },
    await idemFor('open-co', { reservationId, kind: 'COMPANY', billedParty: accountName }),
  );
  // post ROOM charge + PAYMENT netting to zero on COMPANY window
}
```

**Case 7** — close COMPANY window → `charge` entry + window CLOSED.

**Case 8** — duplicate close/post → single charge row (idempotent).

**Case 9** — `creditLimitMinor` below receivable → close **422** `city_ledger_credit_limit_exceeded`; window stays OPEN.

**Case 14** — close window without going through close hook (simulate: manually `closeFolioWindowSync` via test helper OR close before Task 3 hook landed — use raw SQL to set CLOSED without charge); run night audit `SNAPSHOT_REPORTS` → charge with `source = 'night_audit'`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts -t "case [789]|case 14"
```

Expected: **FAIL** — no charge row on close.

- [ ] **Step 3: Implement charge posting + hooks**

```typescript
  private postedReceivableMinorSync(folioWindowId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS total
         FROM folio_line
         WHERE folio_window_id = ? AND charge_code != 'PAYMENT'`,
        folioWindowId,
      )
      .toArray() as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  private postCityLedgerChargeSync(input: {
    folioWindowId: string;
    source: 'window_close' | 'night_audit';
    actor: ActorContext;
  }):
    | { ok: true; entryId: string; alreadyPosted?: true }
    | { ok: false; error: string } {
    const window = this.readFolioWindowRowSync(input.folioWindowId);
    if (!window || window.kind !== 'COMPANY') return { ok: false, error: NOT_FOUND };
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT entry_id FROM city_ledger_entry WHERE folio_window_id = ? AND kind = 'charge' LIMIT 1`,
        input.folioWindowId,
      )
      .toArray() as Array<{ entry_id: string }>;
    if (existing[0]) return { ok: true, entryId: existing[0].entry_id, alreadyPosted: true };

    const account = this.resolveCityLedgerAccountSync(window.billedParty ?? '');
    if (!account) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };

    const amount = this.postedReceivableMinorSync(input.folioWindowId);
    if (amount <= 0) return { ok: true, entryId: '' }; // no-op zero receivable

    const accountRow = /* read credit_limit_minor, status */;
    if (accountRow.status === 'archived') return { ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED };
    const open = this.openBalanceMinorSync(account.accountId);
    if (open + amount > accountRow.credit_limit_minor) {
      throw new CityLedgerCreditLimitExceededError();
    }

    const entryId = crypto.randomUUID();
    const businessDate = this.readBusinessDateSync();
    const currency = this.readStoredLedgerCurrencySync() ?? 'USD';
    this.ctx.storage.sql.exec(
      `INSERT INTO city_ledger_entry (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency, business_date, source, reference, created_at)
       VALUES (?, ?, ?, ?, 'charge', ?, ?, ?, ?, NULL, ?)`,
      entryId,
      account.accountId,
      window.reservationId,
      input.folioWindowId,
      amount,
      currency,
      businessDate,
      input.source,
      Date.now(),
    );
    this.appendPropertyOutbox({
      eventType: 'city_ledger.charge_posted',
      payload: { entryId, folioWindowId: input.folioWindowId, accountId: account.accountId, amountMinor: amount },
    });
    return { ok: true, entryId };
  }
```

**Close hook** in `tryCloseFolioWindow` (~14017), before `closeFolioWindowSync`:

```typescript
          if (window.kind === 'COMPANY') {
            const postResult = this.postCityLedgerChargeSync({
              folioWindowId: input.folioWindowId,
              source: 'window_close',
              actor,
            });
            if (!postResult.ok) throw new CityLedgerError(postResult.error);
          }
          const now = Date.now();
          this.closeFolioWindowSync(input.folioWindowId, now, propertyId, window.reservationId);
```

Extend catch for `CityLedgerCreditLimitExceededError` → `{ ok: false, error: CITY_LEDGER_CREDIT_LIMIT_EXCEEDED }`.

**Night-audit catch-up** — add branch in Txn B (~2829):

```typescript
        } else if (step === 'SNAPSHOT_REPORTS') {
          this.indexReportPutsSync(businessDate);
          this.postPendingCityLedgerChargesForBusinessDateSync(businessDate);
        }
```

```typescript
  private postPendingCityLedgerChargesForBusinessDateSync(businessDate: string): void {
    const windows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id FROM folio_window fw
         WHERE fw.kind = 'COMPANY' AND fw.status = 'CLOSED'
           AND date(fw.closed_at / 1000, 'unixepoch') = ?
           AND NOT EXISTS (
             SELECT 1 FROM city_ledger_entry e
             WHERE e.folio_window_id = fw.folio_window_id AND e.kind = 'charge'
           )`,
        businessDate,
      )
      .toArray() as Array<{ folio_window_id: string }>;
    for (const w of windows) {
      this.postCityLedgerChargeSync({
        folioWindowId: w.folio_window_id,
        source: 'night_audit',
        actor: { kind: 'system', id: 'night_audit' },
      });
    }
  }
```

Use property-local date conversion consistent with existing night-audit date helpers (match `indexReportPutsSync` timezone handling).

Add `city_ledger.charge_posted` to event-consumer allowlist.

- [ ] **Step 4: Run charge + catch-up tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts -t "case [789]|case 14"
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/test/city-ledger-ar.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): city ledger charge posting on window close

EOF
)"
```

---

### Task 4: HTTP dispatch + client API

**Spec:** §2 Lock 10, Lock 12 case **13** + HTTP wrappers for accounts/payment.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — five handlers + `V1_ROUTES`; import wire codes; extend `mapReservationCommandErrorStatus` (~289+)
- Modify: `packages/client-core/src/api.ts` — city ledger methods (~after invoice helpers)
- Modify: `apps/pms-core/test/city-ledger-ar.spec.ts` — case **13** + HTTP helpers for CRUD/payment/list

**Interfaces:**
- Produces: `handlePostCityLedgerAccounts`, `handleGetCityLedgerAccounts`, `handlePatchCityLedgerAccount`, `handlePostCityLedgerAccountPayment`, `handleGetCityLedgerStatement`
- Produces: client methods per spec Lock 11 list
- Consumes: Task 2–3 DO RPCs

**Forbidden this commit:** SPA, spec pointers.

- [ ] **Step 1: Write failing HTTP tests (case 13 + HTTP CRUD)**

Append to `city-ledger-ar.spec.ts`:

```typescript
async function postCityLedgerAccount(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), ...body }),
    }),
    env,
  );
}

async function getCityLedgerAccounts(propertyId: string, actor: string, query = '') {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts${query}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

it('case 13: GET statement returns snapshot from R2; unknown → 404', async () => {
  // create account + generate via stub → GET [145] 200 with snapshot
  // GET random statementId → 404 city_ledger_statement_not_found
});
```

Add HTTP tests for POST create **201**, GET list aging shape, PATCH archive, POST payment **201** `{ openBalanceMinor }`.

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts -t "case 13|HTTP"
```

Expected: **FAIL** — 404 route missing.

- [ ] **Step 3: Implement dispatch handlers + error map**

In `mapReservationCommandErrorStatus` (~289):

```typescript
  if (
    error === CITY_LEDGER_ACCOUNT_EXISTS ||
    error === CITY_LEDGER_ACCOUNT_ARCHIVED ||
    error === CITY_LEDGER_CHARGE_ALREADY_POSTED
  ) {
    return 409;
  }
```

Add to **404** list: `CITY_LEDGER_ACCOUNT_NOT_FOUND`, `CITY_LEDGER_STATEMENT_NOT_FOUND`.

Add to **422** list: `CITY_LEDGER_CREDIT_LIMIT_EXCEEDED`, `CITY_LEDGER_BILLED_PARTY_INVALID`, `CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE`.

Add **503** branch: `CITY_LEDGER_R2_UNBOUND`.

**Handlers:**

- `handlePostCityLedgerAccounts` — body `{ idempotencyKey, name, creditLimitMinor?, termsDays? }` → `tryCreateCityLedgerAccount`; **201**.
- `handleGetCityLedgerAccounts` — query `status=active|all` (default `active`); if `accountId` query present → detail shape (entries, aging, statements); else list summaries + aging via stub RPC.
- `handlePatchCityLedgerAccount` — if `body.status === 'archived'` → `tryArchiveCityLedgerAccount`; else `tryUpdateCityLedgerAccount` with `{ accountId: params.accountId, ...patch }`.
- `handlePostCityLedgerAccountPayment` — `{ idempotencyKey, amountMinor, businessDate?, reference? }` → **201** `{ ok: true, entryId, openBalanceMinor }`.
- `handleGetCityLedgerStatement` — load R2 by key from idempotency cache or reconstruct key `city-ledger-statements/{propertyId}/{accountId}/{statementId}.json`; return `{ statementId, accountId, asOfDate, r2Key, sha256, generatedAt, snapshot }`; miss → **404**.

Append to `V1_ROUTES` after invoice block (~8008+):

```typescript
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts$/,
    permission: 'folio:adjust',
    commandId: 'city_ledger.create_account',
    handler: handlePostCityLedgerAccounts,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts$/,
    permission: 'folio:read',
    handler: handleGetCityLedgerAccounts,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)$/,
    permission: 'folio:adjust',
    handler: handlePatchCityLedgerAccount,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)\/payments$/,
    permission: 'folio:adjust',
    commandId: 'city_ledger.receive_payment',
    handler: handlePostCityLedgerAccountPayment,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)\/statements\/([^/]+)$/,
    permission: 'folio:read',
    handler: handleGetCityLedgerStatement,
  },
```

- [ ] **Step 4: Add client API**

In `packages/client-core/src/api.ts`:

```typescript
    async listCityLedgerAccounts(propertyId: string, opts?: { status?: 'active' | 'all' }) {
      const q = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
      return getJson(`/v1/properties/${enc(propertyId)}/city-ledger/accounts${q}`);
    },
    async getCityLedgerAccount(propertyId: string, accountId: string) {
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts?accountId=${encodeURIComponent(accountId)}`,
      );
    },
    async createCityLedgerAccount(
      propertyId: string,
      body: { name: string; creditLimitMinor?: number; termsDays?: number; idempotencyKey?: string },
    ) { /* POST [141] */ },
    async updateCityLedgerAccount(propertyId: string, accountId: string, body: Record<string, unknown>) { /* PATCH [143] */ },
    async receiveCityLedgerPayment(propertyId: string, accountId: string, body: Record<string, unknown>) { /* POST [144] */ },
    async generateCityLedgerStatement(propertyId: string, accountId: string, body?: { asOfDate?: string; idempotencyKey?: string }) {
      // PropertyDO RPC via existing stub transport — not HTTP
      return opts.stubTransport.generateCityLedgerStatement(propertyId, accountId, body);
    },
    async getCityLedgerStatement(propertyId: string, accountId: string, statementId: string) {
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts/${enc(accountId)}/statements/${enc(statementId)}`,
      );
    },
```

Wire `generateCityLedgerStatement` through the same RPC channel used by `generateInvoice` if one exists; otherwise extend client stub bridge consistent with invoice RPC pattern in `api.ts`.

- [ ] **Step 5: Rebuild + run tests + guard scripts**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: cases **1–15** **PASS** via HTTP/stub mix; `[141]–[145]` pinned.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/city-ledger-ar.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): city ledger HTTP routes and client API

EOF
)"
```

---

### Task 5: SPA — CityLedgerScreen + Folio COMPANY account picker

**Spec:** §2 Lock 11, Lock 13 SPA cases.

**Files:**
- Create: `apps/web-pms/src/screens/CityLedgerScreen.tsx`
- Create: `apps/web-pms/src/screens/CityLedgerScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — account autocomplete (~1386–1421)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` — COMPANY picker case
- Modify: `apps/web-pms/src/shell/nav.ts` — nav entry
- Modify: `apps/web-pms/src/App.tsx` — routes

**Interfaces:**
- Consumes: Task 4 client API
- Produces: desk UX for account list/detail/create/payment/statement/archive; Folio COMPANY picker

**Forbidden this commit:** spec pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing SPA tests**

`CityLedgerScreen.test.tsx`:

```typescript
const listCityLedgerAccounts = vi.fn();
const createCityLedgerAccount = vi.fn();
const receiveCityLedgerPayment = vi.fn();
// vi.mock client

it('Lock 13 SPA 1: list renders aging totals from mock API', async () => {
  listCityLedgerAccounts.mockResolvedValue({
    body: {
      accounts: [{
        accountId: 'a1',
        name: 'Acme Corp',
        aging: { totalOpenMinor: 15000, days30Minor: 15000, currentMinor: 0, days60Minor: 0, days90PlusMinor: 0 },
      }],
    },
    classified: { class: 'live' },
  });
  render(<CityLedgerScreen />);
  expect(await screen.findByTestId('city-ledger-list')).toBeTruthy();
  expect(screen.getByText('15000')).toBeTruthy();
});

it('Lock 13 SPA 2: create account flow', async () => { /* modal city-ledger-create */ });
it('Lock 13 SPA 3: payment modal posts and refreshes open balance', async () => { /* city-ledger-payment */ });
```

`FolioScreen.test.tsx` — add:

```typescript
it('city ledger picker: company window uses account autocomplete', async () => {
  listCityLedgerAccounts.mockResolvedValue({
    body: { accounts: [{ accountId: 'a1', name: 'Acme Corp' }] },
    classified: { class: 'live' },
  });
  // render folio; assert datalist/select options; no free-text-only path for new windows
});
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/CityLedgerScreen.test.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "city ledger picker"
```

Expected: **FAIL** — screen absent.

- [ ] **Step 3: Implement CityLedgerScreen + nav + routes**

`apps/web-pms/src/shell/nav.ts` — add after `night-audit`:

```typescript
  { id: 'city-ledger', label: 'City ledger', path: '/city-ledger', order: 75, permission: 'folio:read' },
```

`apps/web-pms/src/App.tsx`:

```typescript
import { CityLedgerScreen } from './screens/CityLedgerScreen.js';
// ...
            <Route path="city-ledger" element={<CityLedgerScreen />} />
            <Route path="city-ledger/:accountId" element={<CityLedgerScreen />} />
```

`CityLedgerScreen.tsx`:

1. **List** (`data-testid="city-ledger-list"`) — `listCityLedgerAccounts`; table with aging columns.
2. **Create** modal (`data-testid="city-ledger-create"`) → POST create.
3. **Detail** route `/city-ledger/:accountId` (`data-testid="city-ledger-detail"`) — entries + aging.
4. **Payment** modal (`data-testid="city-ledger-payment"`) → POST payment; refresh detail.
5. **Statement** (`data-testid="city-ledger-statement"`) — button calls `generateCityLedgerStatement` RPC; render inline snapshot JSON; optional GET by `statementId`.
6. **Archive** — PATCH `status: 'archived'` with confirm.

**FolioScreen.tsx** (~1386):

- Replace free-text `Input` with `<select>` or combobox populated from `listCityLedgerAccounts({ status: 'active' })`.
- `companyBilledParty` stores selected account **name** (canonical).
- Disable manual free-text for new windows (`readOnly` or remove text input).
- `data-testid="company-account-picker"`.

- [ ] **Step 4: Rebuild client-core + run RTL**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/CityLedgerScreen.test.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "city ledger picker|Lock 13 SPA"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/CityLedgerScreen.tsx \
  apps/web-pms/src/screens/CityLedgerScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/shell/nav.ts \
  apps/web-pms/src/App.tsx \
  packages/client-core/src/api.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): city ledger screen and folio account picker

EOF
)"
```

---

### Task 6: Purge + leftover pointers + final register pins

**Spec:** §2 Lock 12, §8 checklist, D10/D11.

**Files:**
- Modify: `apps/pms-core/src/purge-workflow.ts` — `cityLedgerStatementsPrefixForProperty` delete (~178–186, verify path ~266)
- Modify: `apps/pms-core/test/purge-workflow.spec.ts` — assert statement prefix emptied
- Modify: `.superpowers/sdd/progress-phase1-leftovers.md` — item **11** DONE
- Modify: leftover pointer specs (one sentence each)
- Modify: `docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-city-ledger-ar.md` — Task 6 checkboxes only

**Pointer sentences (normative — one sentence each):**

`.superpowers/sdd/progress-phase1-leftovers.md` item **11**:

> **11. City ledger / AR** — DONE `…` (spec `5a86dc8`, plan `…`; v33 `city_ledger_*` tables, R2 statements, City Ledger SPA).

`property-setup-spa-design.md` leftover **6** (~543):

> ~~| 6 | City ledger / AR | §7.3 |~~ **Closed** in [2026-08-15 city ledger / AR](./2026-08-15-city-ledger-ar-design.md): property-local corporate accounts, append-only AR, derived aging, R2 statements, Folio COMPANY picker.

`guest-crm-directory-design.md` leftover **7** (~575):

> ~~| 7 | City ledger / AR | §7.3 |~~ **Closed** in [2026-08-15 city ledger / AR](./2026-08-15-city-ledger-ar-design.md).

`exception-queue-workbench-design.md` leftover **8** (~507):

> ~~| 8 | City ledger / AR | §7.3 |~~ **Closed** in [2026-08-15 city ledger / AR](./2026-08-15-city-ledger-ar-design.md).

`tape-chart-live-board-design.md` leftover **5** (~533):

> ~~| 5 | City ledger / AR | §7.3 |~~ **Closed** in [2026-08-15 city ledger / AR](./2026-08-15-city-ledger-ar-design.md).

- [ ] **Step 1: Add city-ledger R2 prefix to purge workflow**

In `apps/pms-core/src/purge-workflow.ts` import `cityLedgerStatementsPrefixForProperty` from `event-log.js`. In `purge-r2` step (~178–186):

```typescript
      deleted += await deleteEventLogPrefix(
        env.EVENT_LOG_R2,
        cityLedgerStatementsPrefixForProperty(propertyId),
      );
```

Mirror in verify/residue check path if reports/invoices prefixes are checked there (~266).

Add purge test: seed statement R2 key → purge → prefix empty.

- [ ] **Step 2: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **92**; writers **65**; `[140]=post_invoice_void` unchanged; `[141]=post_city_ledger_accounts` … `[145]=get_city_ledger_statement`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 33`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 8`.

- [ ] **Step 3: Targeted test superset (Lock 13 full slice)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger-ar.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/CityLedgerScreen.test.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "city ledger"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
pnpm check:purge
pnpm check:ddl
```

Expected: **PASS**.

- [ ] **Step 4: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

If any shard fails with workerd 503, retry that shard once. Do not `|| true`.

- [ ] **Step 5: Apply doc pointers + tick city ledger spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md` §8.

- [ ] **Step 6: Tick Task 6 checkboxes in this plan only**

Do **not** tick Tasks 1–5 checkboxes.

- [ ] **Step 7: Commit**

```bash
git add apps/pms-core/src/purge-workflow.ts \
  apps/pms-core/test/purge-workflow.spec.ts \
  .superpowers/sdd/progress-phase1-leftovers.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md \
  docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md \
  docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md \
  docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md \
  docs/superpowers/plans/2026-08-15-city-ledger-ar.md
git commit -m "$(cat <<'EOF'
docs: close city ledger AR leftovers

EOF
)"
```

**Stop.** MASTER group billing, commission tracking, PDF worker, adjustment desk UI, HTTP POST generate statement, event consumer (Lock 14), and COMPANY window invoices stay deferred per spec §1.4 / §7.

---

## Spec §8 reviewer checklist (Task 6 ticks these in the spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| v33 migration + head **33** + purge tables + R2 prefix + triggers | 1, 6 |
| Wire codes + HTTP status map | 1, 4 |
| Catalog **92** + writers **65** + exemptions + routes **[141]–[145]** | 1, 4 |
| DO account CRUD + entry posting + aging + statement R2 | 2, 3 |
| COMPANY close hook + night-audit catch-up in `SNAPSHOT_REPORTS` | 3 |
| `billed_party` validation in `tryOpenFolioWindow` + triggers | 1, 2 |
| HTTP handlers + client API + City Ledger SPA + Folio picker | 4, 5 |
| Tests Lock 13 | 2–5 + 6 |
| Register pins + CI discipline | 6 |
| Bidirectional pointer closes | 6 |
| Lock 14 event consumer | deferred |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.3 scope in (1–12) | 1–6 |
| §1.4 scope out | forbidden all |
| §2 Locks 1–14 | 1–6 (Lock 14 deferred) |
| §6 file map | 1–6 |
| §8 checklist + pointers | 6 |
| Heads table §1.2 | 1 + 6 verify |
| D-locks 1–11 | Open decisions |

**Gaps:** Event consumer (Lock 14) explicitly deferred MVP. HTTP POST generate statement deferred — MVP uses DO RPC. Adjustment desk UI deferred.

**Placeholder scan:** No TBD-only references.

**Tree conflicts:** None (spec §9). Verified on `main`: catalog **86**, writers **61**, `[140] post_invoice_void` last, `PROPERTY_SCHEMA_HEAD` **32** (this plan → **33**), `tryCloseFolioWindow` ~13975, `SNAPSHOT_REPORTS` Txn B ~2829, invoice R2 pattern ready, `folio_window.billed_party` TEXT with no FK.

**Implementer notes (from spec §9, not lock violations):**

1. **Five HTTP routes** — generate statement via DO RPC only; GET `[145]` re-fetch.
2. **Grandfathered labels** — trigger + DO must agree; test case 6 covers both paths.
3. **Charge amount semantics** — non-PAYMENT line sum; document in parent audit `afterJson`.
4. **Credit limit `0`** — still enforce; UI may default high limit for “unlimited”.
5. **Degraded** — all `city_ledger.*` commands `FAIL_CLOSED`.
6. **Existing auto-transfer tests** using free-text `'Acme'` — after Task 2, seed matching `city_ledger_account` in those tests or they will **422** on open.
