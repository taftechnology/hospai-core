# Tax Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp exclusive (US-shaped) tax as separate folio lines at post, allocate stamped tax on split, and manage rules via `tax_rule` + `charge_code.tax_group` — without a `folio_line` rebuild.

**Architecture:** v15 additive migration adds `tax_rule`, `charge_code.tax_group`, `folio_line.tax_of` (self-FK) / `tax_rule_id`, and tax indexes. `packages/money` gains `computeTax` on the BigInt decimal-string path. PropertyDO selects rules by **posting business date** (provisional replay date, else current property business date), stamps `source = 'TAX'` lines, and on split reverses parent tax then **allocates** each tax line across children (no rule lookup). Retire `pms.money.tax_registry` and `affectsTaxMoney`. Land split changes in a **separate commit** from stamp-at-post so canaries stay single-mutation.

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest, `@hospai/money`, `@hospai/do-runtime`, `@cloudflare/vitest-pool-workers`.

**Spec:** [`docs/superpowers/specs/2026-08-07-tax-posting-design.md`](../specs/2026-08-07-tax-posting-design.md)

## Global Constraints

- **No `folio_line` rebuild** — v15 is additive `ALTER TABLE` / `CREATE TABLE` only.
- **Split × tax:** reverse parent tax → post children → allocate stamped tax per tax line; **never** recompute from `tax_rule` on split.
- **Tax lines:** `source = 'TAX'` only; both `tax_of` and `tax_rule_id` non-NULL (app invariant); `'TAX'` → `LINE_NOT_SPLITTABLE`.
- **Rule selection date:** `provisional.businessDate` on replay, else property current business date — **never wall-clock**.
- **Per-line rounding** via `computeTax`; allocated child tax may not equal `base × rate`.
- **`tax_group` not `taxable`**; NULL group = exempt; output codes must have `tax_group IS NULL`.
- **Immutable rules:** supersede = close + insert same `rule_key`; app rejects overlapping windows per key.
- **Delete** `pms.money.tax_registry` and `affectsTaxMoney` — no second home for rules.
- **Launch:** app rejects `rule_type <> 'PERCENTAGE'` → `TAX_RULE_TYPE_UNSUPPORTED`.
- **Routes 54–57** (approx) on **both** `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`, same order.
- **Touch `scripts/property-ddl.mjs`** — exports hardcoded by name.
- **TDD** where noted; **single-mutation canaries** documented below.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Recompute tax on split instead of allocate | Tests 4/5 |
| Rule lookup on split | Test 5 (rate changed, child tax unchanged) |
| Select rules by wall-clock on provisional replay | Test 16 |
| Omit `'TAX'` from split reject | Test 6 |
| Insert TAX with NULL `tax_rule_id` | Test 15 |
| Tax as `NIGHT_AUDIT` source | Test 7 / uniq |
| Keep `tax_registry` or `affectsTaxMoney` | Test 17 / register.test |
| Split + stamp in same commit | Bisectability — **forbidden** |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/money/src/index.ts` | `parseTaxRate`, `computeTax`; factor decimal parse |
| `packages/money/src/index.test.ts` | Rate TEXT, negative reject, rounding |
| `packages/contracts/src/idempotency.ts` | Tax wire constants |
| `packages/contracts/src/commands/catalog.ts` | tax_rule commands |
| `packages/contracts/src/v1-http-routes.ts` | Audit rows 54+ |
| `packages/contracts/src/config/register.ts` | Remove tax_registry + affectsTaxMoney |
| `packages/do-runtime/src/property-migrations.ts` | v15 statements + SQL export |
| `migrations/do-property/0015_tax_posting.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | `TAX_POSTING_V15_SQL` |
| `packages/do-runtime/src/migrate.test.ts` | v15 sync |
| `apps/pms-core/src/property-do.ts` | Engine, stamp, split allocate, CRUD |
| `apps/pms-core/src/v1-dispatch.ts` | Handlers + routes |
| `apps/pms-core/test/tax-posting.spec.ts` | Matrix (new) |
| `apps/pms-core/test/property-do.spec.ts` | Schema head → 15 |

---

### Task 1: `packages/money` — `computeTax`

**Files:**
- Modify: `packages/money/src/index.ts`
- Modify: `packages/money/src/index.test.ts`

**Interfaces:**
- Produces: `parseTaxRate(rate: string): { num: bigint; den: bigint }` (rejects negatives/empty)
- Produces: `computeTax(baseMinor: number, rate: string): number`

- [ ] **Step 1: Failing tests (RED)**

```ts
import { computeTax } from './index.js';

it('computeTax 8.25% on 10000', () => {
  expect(computeTax(10_000, '0.0825')).toBe(825);
});
it('rejects negative rate', () => {
  expect(() => computeTax(100, '-0.01')).toThrow();
});
```

Run: `pnpm --filter @hospai/money test`  
Expected: FAIL

- [ ] **Step 2: Implement** — factor shared `parseDecimalRate` from FX path; tax rejects negatives; `roundHalfAwayFromZero` + safe integer guard.

- [ ] **Step 3: GREEN** — all money tests pass.

- [ ] **Step 4: Commit** — `feat(money): add computeTax on BigInt decimal-string path`

---

### Task 2: Retire hollow tax config

**Files:**
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/register.test.ts`

- [ ] **Step 1: RED** — remove `'pms_tax_registry'` from expected keys; drop `affectsTaxMoney` from consumer assertions.

- [ ] **Step 2: Delete** `pms.money.tax_registry` entry and `affectsTaxMoney` from `ConfigConsumers` + all entries.

- [ ] **Step 3: GREEN** — `pnpm --filter @hospai/contracts test`

- [ ] **Step 4: Commit** — `refactor(contracts): remove tax_registry and affectsTaxMoney`

---

### Task 3: Contracts — constants, catalog, route audit

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`, `idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `TAX_RULE_TYPE_UNSUPPORTED`, `TAX_RULE_KEY_OVERLAP`, `TAX_OUTPUT_CODE_TAXABLE` (names per spec)
- Produces: `folio.create_tax_rule`, `folio.supersede_tax_rule`, `folio.list_tax_rules` (or equivalent)
- Produces: audit rows **54–57** (create, supersede, list, patch charge_code tax_group if separate)

- [ ] Steps: RED tests → add constants/catalog/routes → GREEN → commit `feat(contracts): tax_rule catalog and route audit`

---

### Task 4: Migration v15 + DDL sync

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Create: `migrations/do-property/0015_tax_posting.sql`
- Modify: `scripts/property-ddl.mjs`
- Modify: `packages/do-runtime/src/migrate.test.ts`, `index.ts` (`PROPERTY_SCHEMA_HEAD = 15`)

**v15 statements (order):**
1. `CREATE TABLE tax_rule (…)`
2. `ALTER TABLE charge_code ADD COLUMN tax_group TEXT`
3. Seed output code `TAX` (`tax_group NULL`) if not exists — via INSERT OR IGNORE on charge_code
4. Seed `ROOM`/`MISC` groups if product default (e.g. `ROOM` → `'ROOM'`, `MISC` → `'GOODS'`) — document in migration comment
5. `ALTER TABLE folio_line ADD COLUMN tax_of TEXT REFERENCES folio_line(folio_line_id)`
6. `ALTER TABLE folio_line ADD COLUMN tax_rule_id TEXT`
7. `CREATE UNIQUE INDEX folio_line_tax_uniq … WHERE source = 'TAX'`
8. `CREATE INDEX folio_line_tax_of_idx …`

- [ ] Steps: statements → generate SQL → migrate.test → `check:ddl` → commit `feat(do-runtime): tax_rule and folio_line tax columns (v15)`

---

### Task 5: Tax engine + stamp at post (no split yet)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/property-do.spec.ts` (schema 15)
- Create: partial tests in `tax-posting.spec.ts` or property-do tests

**Interfaces:**
- Produces: `resolvePostingBusinessDateSync(provisional?: ProvisionalContext): string`
- Produces: `listApplicableTaxRulesSync(taxGroup: string, postingDate: string): TaxRuleRow[]`
- Produces: `stampTaxForChargeSync(parentLineId, parentAmountMinor, chargeCode, reservationId, folioWindowId, postingDate, posted: PostedLineAmount)`
- Modifies: `insertFolioLineSync` — optional `taxOf`, `taxRuleId`, enforce TAX invariant

**Writers to hook:**
- `tryAddFolioLine` — after charge insert, call stamp (pass provisional for date)
- `postRoomChargesSync` — same txn, posting date = night business date

**Skip tax when:** PAYMENT / SPLIT_REVERSAL / TAX parent source; `tax_group IS NULL`; no rules.

- [ ] **Separate commit** from Task 7. Tests 1–3, 7–8, 15 (partial), 16.

- [ ] Commit: `feat(pms-core): stamp tax at post with posting business date`

---

### Task 6: Split allocate tax (isolated commit)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `splitFolioLineSync`, `trySplitFolioLine` reject `'TAX'`

**Order in txn:** reverse parent → reverse each `source='TAX'` where `tax_of = parent` → children → allocate each reversed tax total across child amounts (`allocate` from `@hospai/money`, policy `'LAST'`).

- [ ] Tests 4–6 before/after; canary: recompute mutation fails 4/5.

- [ ] Commit: `feat(pms-core): allocate stamped tax on folio split`

---

### Task 7: tax_rule CRUD + charge_code tax_group

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Extend: `tryUpdateChargeCode` or PATCH body for `taxGroup`

- [ ] Supersede overlap check on `rule_key`; output code `tax_group IS NULL` check; PERCENTAGE only.

- [ ] Commit: `feat(pms-core): tax_rule CRUD and charge_code tax_group`

---

### Task 8: HTTP matrix + acceptance checks

**Files:**
- Create: `apps/pms-core/test/tax-posting.spec.ts` — full matrix 1–17
- Modify: `apps/pms-core/test/night-audit-room-charges.spec.ts` if needed
- Modify: `apps/pms-core/test/charge-codes.spec.ts` only if tax_group PATCH touches shared helpers

- [ ] Run: `pnpm check:permissions`, `check:entitlements`, `check:degraded`, `check:ddl`
- [ ] Sharded pms-core + contracts + do-runtime + money
- [ ] Commit: `test(pms-core): tax posting matrix`

---

## Spec coverage self-review

| Spec § | Task |
|---|---|
| 2.1 allocate split | Task 6 |
| 2.2 TAX source + uniq + reject | Tasks 4–6 |
| 2.3 computeTax | Task 1 |
| 2.4 tax_group + rule_key | Tasks 4, 7 |
| 2.5 posting business date | Task 5 |
| 2.6 night audit | Task 5 |
| 2.8 retire config | Task 2 |
| Matrix 1–17 | Tasks 5–8 |

No placeholders. Split and stamp are **separate tasks/commits**.
