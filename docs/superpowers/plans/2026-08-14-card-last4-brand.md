# Card last-4 / brand on tenders (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Approved (reviewer, 2026-08-14). Implement task-by-task. Do not skip D7.

**Goal:** After a simulate card authorize, folio tender rows read like a hotel bill — e.g. **Visa •••• 4242 · $50.00** — using honest persisted display tokens, while cash and legacy card rows keep P0-2 method-only copy (**Cash · amount**, **Card · amount**). The simulate gateway stays server-side; the SPA never paints `simulate`, `sim_`, `gatewayReference`, or raw `paymentId`.

**Architecture:** Property schema **v26** adds nullable `payment.card_last4` / `payment.card_brand`. `simulateAuthorize` returns sandbox `{ cardBrand, cardLast4 }` on approve (defaults `visa` / `4242`; overridable via `PspSimulateOutcome`). Authorize txn 2 persists both columns. Existing `GET …/folio/payments` JSON widens with `cardLast4?` / `cardBrand?` — no new route or catalog row. SPA composes `tenderLabel()` from stored fields only.

**Tech Stack:** PropertyDO + sqlite migrations (`packages/do-runtime`, `apps/pms-core`), simulate adapter (`psp-simulate.ts`), `@hospai/client-core` types, React SPA (`FolioScreen.tsx`), vitest (Worker specs + RTL).

**Spec:** `docs/superpowers/specs/2026-08-14-card-last4-brand-design.md` (Approved). Spec commit: `4fe34d4`.

---

## Sequencing gate (read before starting)

This is **P1 card last-4 / brand on tenders**. P0-2 folio first paint must already ship method-only tenders. This slice **lifts the P0-2 schema freeze for property head only** — bumps `PROPERTY_SCHEMA_HEAD` **25 → 26**.

| After this plan | Do not start |
|---|---|
| Tick DEMO-READY P1 card row (Task 4) | Real PSP / PCI vault |
| P0-2 leftover §12 #8 closed | SPA-only canned `Visa •••• 4242` |
| Hide-lab-copy slice stays compatible | Parsing `sim_` from `gatewayReference` |
| — | `demo-seed.mjs` rewrite |
| — | Guest CRM depth, one hotel voice, `/dev/ui` |
| — | New `COMMAND_CATALOG` rows or `v1-http-routes` append |

---

## Open decisions (locked here; spec §8 — do not re-litigate)

### D1 — Schema 26 persist

**Locked:** Nullable `payment.card_last4` + `payment.card_brand` via migration `0026_card_display_token.sql`. Reject SPA-only digits without storage.

### D2 — Brand copy

**Locked:** Title-case wire enum in the SPA: `visa` → **Visa**, `mastercard` → **Mastercard**, `amex` → **Amex**, `discover` → **Discover** (pass-through title-case for unknown wire values is acceptable). When `cardLast4` is set but `cardBrand` is null/omitted → label prefix **`Card •••• {last4}`** (not a bare **Card**).

### D3 — Mask format

**Locked:** Visible tender text is **`{tenderLabel} · {formatMinor(amountMinor)}`** where card-with-token label is **`{Brand} •••• {last4}`** (bullet mask `••••`; middle dot `·` before amount). Example: **`Visa •••• 4242 · $50.00`**.

### D4 — Legacy rows

**Locked:** Card rows without stored `cardLast4` → **`Card · amount`**. No backfill of historical payments. No `UPDATE` to synthesize digits. No parse of `sim_` or `gatewayReference`.

### D5 — Read surface

**Locked:** Widen `mapPaymentRow`, `readPaymentRowSync` SELECT, and `listPaymentsForReservation` SELECT + JSON. SPA uses `getFolioPayments` only — **do not** add a new client-core single-payment fetch method. HTTP `get_folio_payment` inherits via `mapPaymentRow` if it already routes there.

### D6 — Hold vs captured copy

**Locked:** Authorized holds and captured card rows paint the **same** display token when columns are set. Existing void/capture controls unchanged.

### D7 — Reviewer locks at plan approval (do not re-litigate)

1. **`PspSimulateOutcome` overrides.** Optional `cardBrand?: string` and `cardLast4?: string` on the outcome object; `simulateAuthorize` uses them when approve, else defaults **`visa`** / **`4242`**. Declined/timeout branches return no card fields.
2. **No demo-seed rewrite.** The 8-minute script live authorize at 4:30 is the acceptance beat; first paint may stay Cash-only or legacy **Card · amount** until then.
3. **No hard-coded demo theater in SPA source.** `rg '•••• 4242' apps/web-pms/src --glob '!**/*.{test,spec}.*'` must stay **zero** — compose only from GET fields.
4. **Never paint `gatewayReference`.** `FolioScreen.tsx` must not reference `p.gatewayReference` for tender label text (heuristic in `tenderMethod` for cash detection may remain for legacy rows missing `tenderType`).
5. **Cash path.** `record_cash_payment` / cash capture leaves `card_last4` and `card_brand` NULL; list GET omits or nulls both; UI stays **Cash · amount**.
6. **Heads frozen except property schema.** `COMMAND_CATALOG` length **77**; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `AUDIT_WRITER_COMMAND_IDS.size` **52**; `PLATFORM_GAPS` **`[]`**; `ORG_SCHEMA_HEAD` **7**; `NIGHT_AUDIT_STEPS.length` **7**.
7. **P0-2 pointer.** One sentence in `docs/superpowers/specs/2026-08-13-folio-first-paint-design.md` noting P1 card display tokens landed (Task 4) — amend §12 #8 / schema-freeze note only; do not rewrite the P0-2 spec body.
8. **SQLite migration test is house style.** Follow `exception-queue-workbench-migration.sqlite.test.ts` — add `card-display-token-migration.sqlite.test.ts` in Task 1. Copy a **payment INSERT** from `multi-currency-folio-migration.sqlite.test.ts` (not the exception table).
9. **`generate:ddl` is not automatic.** Task 1 **must** export `CARD_DISPLAY_TOKEN_V26_SQL` from `packages/do-runtime/src/index.ts` and add a `doPropertyTargets` entry in `scripts/property-ddl.mjs` (mirror v25 `EXCEPTION_QUEUE_WORKBENCH_V25_SQL`). Without that, `pnpm generate:ddl` will not write `0026_*.sql`.
10. **Do not `|| true` the DDL diff.** After `pnpm generate:ddl`, the generated file must exist and be committed. Task 5 `git diff --exit-code -- migrations packages/do-runtime` must be a true no-op.
11. **Task 5 contracts `-t` filter.** `-t "COMMAND_CATALOG|post_demo_seed"` matches **no test names**. Use `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` (asserts catalog 77 + route [127]) plus `migrate.test.ts` schema-head pin **26**.

---

## Global Constraints

- **Simulate gateway stays.** Authorize still calls `simulateAuthorize` outside the idempotent txn. No real PSP, no PAN in the SPA.
- **No new catalog commands or HTTP audit rows.** Do not edit `COMMAND_CATALOG`, `v1-http-routes.ts`, or `V1_HTTP_ROUTE_AUDIT`.
- **Property schema only.** `PROPERTY_SCHEMA_HEAD` moves **25 → 26**. `ORG_SCHEMA_HEAD` stays **7**. Regenerate DDL: `pnpm generate:ddl` must produce `migrations/do-property/0026_card_display_token.sql` with no hand-editing of the artifact.
- **Integer money unchanged.** Append-only folio; capture/void/refund writers untouched except authorize UPDATE gaining two columns.
- **`data-testid`s on folio payment controls stay** (`authorize-card`, `void-payment-*`, `refund-payment-*`, `folio-advanced`, etc.). Tests may add copy assertions; do not rename control testids.
- **Advanced stays collapsed by default.** Tender rows remain on first paint, not behind Advanced.
- **No `/dev/ui`.** No guest CRM. Charge card label stays **Charge card** — not “Simulate card”.
- **Rebuild client-core** after `packages/client-core/src/api.ts` change: `pnpm --filter @hospai/client-core build` before `@hospai/web-pms` tests.
- Unsharded `pnpm --filter @hospai/pms-core test` may segfault — use `vitest run <file>` or `--shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 5). Do not backfill historical plans.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `CARD_DISPLAY_TOKEN_V26_STATEMENTS` + `PROPERTY_MIGRATIONS` v26 entry | 1 |
| `packages/do-runtime/src/index.ts` | Re-export v26 SQL constants | 1 |
| `scripts/property-ddl.mjs` | Write `0026_card_display_token.sql` | 1 |
| `migrations/do-property/0026_card_display_token.sql` | Generated DDL artifact | 1 |
| `packages/do-runtime/src/migrate.test.ts` | Pin `PROPERTY_SCHEMA_HEAD` **26**; v26 + DDL match tests | 1 |
| `packages/do-runtime/src/card-display-token-migration.sqlite.test.ts` | **New.** Real sqlite ALTER on populated v25 payment row | 1 |
| `apps/pms-core/src/psp-simulate.ts` | Approve branch + `PspSimulateOutcome` overrides | 2 |
| `apps/pms-core/src/psp-simulate.test.ts` | Unit tests for authorize shape + overrides | 2 |
| `apps/pms-core/src/property-do.ts` | `PaymentRow`; authorize UPDATE; `readPaymentRowSync`; `mapPaymentRow`; `listPaymentsForReservation` | 3 |
| `apps/pms-core/test/folio-payments.spec.ts` | Persist + list GET + legacy NULL + override lever | 3 |
| `packages/client-core/src/api.ts` | `FolioPaymentRow.cardLast4?`, `cardBrand?` | 4 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | `tenderLabel()` + row paint ~810 | 4 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Token visible; simulate/sim_/id null; cash + legacy | 4 |
| `DEMO-READY.md` | Tick P1 card row (239–240) | 4 |
| `docs/superpowers/specs/2026-08-13-folio-first-paint-design.md` | One-sentence P1 landed pointer (D7.7) | 4 |
| this plan file | Tick checkboxes | 5 |

**Not touched:** `scripts/demo-seed.mjs`, `packages/contracts/**` catalog/register (heads unchanged), `apps/web-pms/src/dev/**`, real PSP modules.

---

## Spec §4 → implementation map

| Spec § | Decision | Task |
|---|---|---|
| §4.1 Schema v26 | `card_last4`, `card_brand` nullable TEXT on `payment` | 1 |
| §4.2 Adapter | Approve returns `cardBrand` / `cardLast4`; defaults `visa` / `4242` | 2 |
| §4.3 Authorize persist | UPDATE sets columns on approve | 3 |
| §4.4 Widen GET | List + `mapPaymentRow` + `readPaymentRowSync` | 3, 4 |
| §4.5 Tender fallbacks | Cash / card+token / legacy card | 4 |
| §4.6 Forbidden | No SPA theater; no `sim_` parse | 4 |
| §4.7 Demo/seed | No seed rewrite | forbidden |
| §7 acceptance | Worker + RTL + grep | 3, 4 |
| §8 OQ locks | D1–D7 above | all |

---

### Task 1: Property migration v26 + migrate.test pin + generate:ddl

**Spec:** §4.1, §7 heads #2, invariant 12, D1, D7.8.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts` — re-export `CARD_DISPLAY_TOKEN_V26_SQL` / `CARD_DISPLAY_TOKEN_V26_STATEMENTS` next to the v25 exports
- Modify: `scripts/property-ddl.mjs` — import + `doPropertyTargets` entry for `0026_card_display_token.sql` (D7.9)
- Create (generated): `migrations/do-property/0026_card_display_token.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Create: `packages/do-runtime/src/card-display-token-migration.sqlite.test.ts`

**Forbidden this commit:** `property-do.ts`, SPA, adapter, demo-seed.

**Migration shape (normative — mirror v25 `EXCEPTION_QUEUE_WORKBENCH_V25_*` pattern):**

```ts
export const CARD_DISPLAY_TOKEN_V26_STATEMENTS = [
  `ALTER TABLE payment ADD COLUMN card_last4 TEXT`,
  `ALTER TABLE payment ADD COLUMN card_brand TEXT`,
] as const;

export const CARD_DISPLAY_TOKEN_V26_SQL =
  CARD_DISPLAY_TOKEN_V26_STATEMENTS.join(';\n\n') + ';\n';

// PROPERTY_MIGRATIONS tail entry:
{ version: 26, name: 'card_display_token', statements: CARD_DISPLAY_TOKEN_V26_STATEMENTS },
```

No `CHECK` on brand enum in v26.

- [x] **Step 1: Add v26 statements + `PROPERTY_MIGRATIONS` entry**

Follow `EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS` / v25 entry at ~968–1103 in `property-migrations.ts`.

- [x] **Step 2: Write failing migrate.test.ts assertions**

Update both `expect(PROPERTY_SCHEMA_HEAD).toBe(25)` sites (lines ~600, ~714) to **26**. Add:
- `property schema head is 26 after card_display_token` — v26 name + statements equality.
- `migrations/do-property/0026_card_display_token.sql matches CARD_DISPLAY_TOKEN_V26_SQL` — same strip-comments pattern as v25 DDL test (~725–734).

- [x] **Step 3: Write failing sqlite test**

`card-display-token-migration.sqlite.test.ts`:
- Apply migrations `version <= 25`.
- Insert a minimal `payment` row using the column list from `multi-currency-folio-migration.sqlite.test.ts` (includes v16+ `tender_type` / `shift_id` as required).
- Apply v26 statements.
- Assert `card_last4` / `card_brand` are NULL on existing row; UPDATE with `'4242'` / `'visa'` succeeds.

- [x] **Step 4: Wire DDL generator, regenerate, run tests**

Export `CARD_DISPLAY_TOKEN_V26_SQL` from `packages/do-runtime/src/index.ts`. Add `scripts/property-ddl.mjs` target (header: ALTER payment ADD card_last4, card_brand). Then:

```bash
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run \
  src/migrate.test.ts \
  src/card-display-token-migration.sqlite.test.ts
```

Expect generated `migrations/do-property/0026_card_display_token.sql` in this commit. Do not `|| true` a missing file.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/card-display-token-migration.sqlite.test.ts \
  scripts/property-ddl.mjs \
  migrations/do-property/0026_card_display_token.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): add v26 payment card display token columns

Add nullable card_last4 and card_brand on payment for honest folio
tender labels; pin PROPERTY_SCHEMA_HEAD at 26.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: psp-simulate approve shape + PspSimulateOutcome overrides

**Spec:** §4.2, §8 #7, D7.1.

**Files:**
- Modify: `apps/pms-core/src/psp-simulate.ts`
- Modify: `apps/pms-core/src/psp-simulate.test.ts`

**Forbidden this commit:** `property-do.ts` persist (Task 3); SPA.

**Type changes (normative):**

```ts
export type PspAuthorizeResult =
  | { outcome: 'approved'; gatewayReference: string; cardBrand: string; cardLast4: string }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'timeout' };

export type PspSimulateOutcome = {
  // ...existing fields...
  cardBrand?: string;
  cardLast4?: string;
};
```

**`simulateAuthorize` approve path:**
- `gatewayReference`: `sim_${input.paymentId}` (unchanged).
- `cardBrand`: `outcome?.cardBrand ?? 'visa'`.
- `cardLast4`: `outcome?.cardLast4 ?? '4242'`.
- Declined / timeout: unchanged (no card fields).

- [x] **Step 1: Write failing unit tests**

Add to `psp-simulate.test.ts` (import `simulateAuthorize`):
- Default approve → `{ outcome: 'approved', gatewayReference: 'sim_pay_x', cardBrand: 'visa', cardLast4: '4242' }`.
- Override `{ cardBrand: 'amex', cardLast4: '0005' }` on outcome → matching fields.
- Declined / timeout → no `cardBrand` / `cardLast4` keys (shape unchanged from today).

- [x] **Step 2: Implement adapter changes**

- [x] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run src/psp-simulate.test.ts
```

- [x] **Step 4: Commit**

```bash
git add apps/pms-core/src/psp-simulate.ts apps/pms-core/src/psp-simulate.test.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): return card brand and last4 from simulate authorize

Extend approved authorize results with sandbox display tokens and
optional PspSimulateOutcome overrides for tests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: property-do persist on authorize + widen reads + folio-payments.spec.ts

**Spec:** §4.3, §4.4, §4.5 (server side), §7 #3–5, D4–D6.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/folio-payments.spec.ts`

**Forbidden this commit:** SPA; demo-seed; catalog/routes.

**`PaymentRow` type (~273):** add `card_last4: string | null; card_brand: string | null`.

**`readPaymentRowSync` SELECT (~12643):** append `card_last4, card_brand` to SELECT list and ensure column order matches `PaymentRow`.

**Authorize txn 2 UPDATE (~13347):** when `adapterResult.outcome === 'approved'`:

```sql
UPDATE payment
SET status = 'authorized',
    gateway_reference = ?,
    card_last4 = ?,
    card_brand = ?,
    updated_at = ?
WHERE payment_id = ? AND status = 'pending'
```

Bind `adapterResult.cardLast4`, `adapterResult.cardBrand`. Declined/timeout UPDATE paths must **not** set card columns.

**`mapPaymentRow` (~13080):** add optional wire fields:

```ts
cardLast4: row.card_last4,
cardBrand: row.card_brand,
```

(Omit from return object when null is fine if callers treat undefined/null equivalently — prefer explicit `| null` matching other nullable fields.)

**`listPaymentsForReservation` (~14811):**
- SELECT adds `card_last4, card_brand`.
- Inline return type adds `cardLast4?: string | null; cardBrand?: string | null`.
- Map from row; cash rows naturally null.

- [x] **Step 1: Write failing Worker tests**

Add to `folio-payments.spec.ts` (new `it` blocks or extend Test 7 / HTTP list test ~980):

1. **After authorize approve:** `readPayment(paymentId)` or stub SQL read shows `card_last4 = '4242'`, `card_brand = 'visa'`, `gateway_reference = sim_${paymentId}`.
2. **`listPaymentsForReservation`:** matching payment includes `{ tenderType: 'CARD', cardLast4: '4242', cardBrand: 'visa' }`.
3. **Cash payment:** list entry has `tenderType: 'CASH'` and `cardLast4` / `cardBrand` null or absent.
4. **Override lever:** `setPspSimulateOutcomeForTest({ cardBrand: 'amex', cardLast4: '0005' })` → persisted and listed values match.
5. **Legacy NULL:** card payment row with NULL columns (pre-authorize fixture or direct insert if test helper exists) → list JSON does not synthesize last4.

Prefer HTTP `GET …/folio/payments` assertion where the file already uses `worker.fetch` (~980–990).

- [x] **Step 2: Implement DO changes**

Tasks above. Do not add client-core methods. Capture/void/refund paths must not overwrite `card_last4` / `card_brand`.

- [x] **Step 3: Run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts
```

- [x] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): persist and expose card display tokens on payments

Store card_last4 and card_brand at authorize and return them on folio
payment list and mapPaymentRow reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: client-core type, FolioScreen tenderLabel, tests, DEMO-READY + P0-2 pointer

**Spec:** §4.4–§4.6, §7 #6–12, D2–D3, D7.3–D7.7.

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `DEMO-READY.md`
- Modify: `docs/superpowers/specs/2026-08-13-folio-first-paint-design.md` (one sentence only)

**Forbidden this commit:** new client-core payment GET helper; hard-coded `Visa •••• 4242`; painting `gatewayReference`; demo-seed; ticking this plan (Task 5).

**`FolioPaymentRow` (~90):**

```ts
cardLast4?: string | null;
cardBrand?: string | null;
```

**`tenderLabel(p)` (new or replace visible use of `tenderMethod` at ~810):**

| Condition | Label (before ` · amount`) |
|---|---|
| Cash (`tenderType === 'CASH'` or cash heuristic) | **Cash** |
| Card + `cardLast4` + mappable `cardBrand` | **`{Brand} •••• {cardLast4}`** |
| Card + `cardLast4`, no brand | **`Card •••• {cardLast4}`** |
| Card, no `cardLast4` | **Card** (keep `tenderMethod` heuristics for Card vs Cash detection) |

**Brand map (normative minimum):**

```ts
const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
};
// fallback: title-case first letter of wire or 'Card' path above
```

Row paint stays: `{tenderLabel(p)} · {formatMinor(p.amountMinor)}`.

Hold (`status === 'authorized'`) and captured card rows with token use the same label (D6).

- [x] **Step 1: Widen client type + rebuild**

```bash
pnpm --filter @hospai/client-core build
```

- [x] **Step 2: Write failing FolioScreen tests**

Update / extend `FolioScreen.test.tsx`:
- **Token row:** mock payment `{ tenderType: 'CARD', cardBrand: 'visa', cardLast4: '4242', amountMinor: 5000, ... }` → visible **Visa**, **4242**, **••••**, **50.00**; `not.toMatch(/simulate/i)`; `not.toMatch(/sim_/i)`; no `pay_*` id text in `<li>`.
- **Legacy card** (existing ~1167–1214 fixture without `cardLast4`): still **Card** + amount; no **4242**.
- **Cash** (~1192): **Cash · 15.00**; no **4242** / **••••**.
- **Brand missing:** `{ cardLast4: '9999', cardBrand: null }` → **Card •••• 9999**.
- **Advanced collapsed regression:** `folio-advanced` `<details>` not open; no Holds/Captured headings (existing ~1220–1225).

- [x] **Step 3: Implement `tenderLabel` + row paint**

Replace `{tenderMethod(p)} · …` at ~810. Do not use `p.gatewayReference` in label text.

- [x] **Step 4: Run grep + tests**

```bash
rg '•••• 4242' apps/web-pms/src --glob '!**/*.{test,spec}.*'
rg 'sim_' apps/web-pms/src/screens/FolioScreen.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

Expect first grep: **no matches**. Second: **no display use** (gatewayReference may remain in `tenderMethod` heuristic — acceptable for legacy cash detection only).

- [x] **Step 5: Tick DEMO-READY + P0-2 pointer**

`DEMO-READY.md` line 239: `- [ ] **Card last-4 / brand on tenders**` → `- [x]`.

P0-2 spec: add one sentence under §12 #8 or schema-freeze note, e.g. *“P1 card last-4 / brand (2026-08-14) lifts the schema freeze; method-only fallback remains for legacy rows.”*

- [x] **Step 6: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  DEMO-READY.md \
  docs/superpowers/specs/2026-08-13-folio-first-paint-design.md
git commit -m "$(cat <<'EOF'
feat(web-pms): show card brand and last4 on folio tenders

Compose tender labels from stored cardBrand and cardLast4 with P0-2
fallbacks for cash and legacy card rows; tick DEMO-READY P1 card row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Heads verification, vitest sweep, tick this plan

**Spec:** §7 heads, §9 checklist, plan housekeeping.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-card-last4-brand.md` (checkboxes only)

**Forbidden this commit:** product code.

- [x] **Step 1: Pin frozen heads (except property 26)**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
```

Expect: catalog **77**; route **[127] = post_demo_seed**; `PROPERTY_SCHEMA_HEAD === 26`; `ORG_SCHEMA_HEAD === 7`. (D7.11 — do not use `-t "COMMAND_CATALOG|post_demo_seed"`.)

- [x] **Step 2: Run targeted test superset**

```bash
pnpm --filter @hospai/do-runtime exec vitest run \
  src/migrate.test.ts src/card-display-token-migration.sqlite.test.ts
pnpm --filter @hospai/pms-core exec vitest run \
  src/psp-simulate.test.ts test/folio-payments.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

- [x] **Step 3: Grep acceptance (spec §7.11–12)**

```bash
rg '•••• 4242' apps/web-pms/src --glob '!**/*.{test,spec}.*'
rg 'sim_' apps/web-pms/src/screens/FolioScreen.tsx
```

- [x] **Step 4: Tick every `- [ ]` on Tasks 1–5 in this file**

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-14-card-last4-brand.md
git commit -m "$(cat <<'EOF'
docs: tick P1 card last-4 brand plan checkboxes after merge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Do not open guest CRM, one hotel voice, or real PSP without a new slice.

---

## Spec §10 reviewer checklist (copied; implementation must satisfy)

- [ ] Census §1.1 re-verified — file:line rows match tree.
- [ ] P0-2 amend explicit — schema freeze lifted **for this slice**; method fallback for legacy rows retained.
- [ ] Design tension §1.2 — option 2 persist; options 1 and 3 rejected.
- [ ] Invariants: simulate stays; no new route/command; testids stable; cash unchanged; no fake backfill.
- [ ] Schema **26** named with `0026_card_display_token.sql` + `generate:ddl` flow.
- [ ] Heads table: catalog **77**, route **[127]**, property **26**, org **7**.
- [ ] Scope-out names real PSP, SPA theater, parse `sim_`, guest CRM, dry runs, `/dev/ui`, demo-seed rewrite.
- [ ] Acceptance tests §7 cover post-card row, cash, legacy fallback, grep anti-patterns.
- [ ] Open questions §8 locked in plan D1–D7.
- [ ] Hide-lab-copy compatibility — no simulate in tender text.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §3.1 v26 migration | 1 |
| §3.2 adapter display token | 2 |
| §3.3 authorize persist | 3 |
| §3.4 widen payment reads | 3, 4 |
| §3.5 SPA tender label | 4 |
| §3.6 tests | 1–5 |
| §3.7 DEMO-READY tick | 4 |
| §4.1 schema columns | 1 |
| §4.2 adapter approve shape | 2 |
| §4.3 authorize UPDATE | 3 |
| §4.4 widen GET JSON | 3, 4 |
| §4.5 tender fallbacks | 4 |
| §4.6 forbidden SPA/parse | 4 |
| §4.7 no seed rewrite | forbidden |
| §5 file map | 1–5 |
| §6.1 folded items | all |
| §6.2 deferred (CRM, voice, PSP, backfill, `/dev/ui`) | forbidden |
| §7.1–2 heads | 1, 5 |
| §7.3–5 Worker authorize + list | 3 |
| §7.6–10 web-pms RTL | 4 |
| §7.11–12 grep anti-patterns | 4, 5 |
| §8 OQ #1 schema persist | 1 (D1) |
| §8 OQ #2 brand copy | 4 (D2) |
| §8 OQ #3 mask format | 4 (D3) |
| §8 OQ #4 legacy fallback | 3, 4 (D4) |
| §8 OQ #5 read surface | 3, 4 (D5) |
| §8 OQ #6 hold = captured token | 4 (D6) |
| §8 OQ #7 outcome overrides | 2 (D7.1) |
| §8 OQ #8 no seed | forbidden (D7.2) |
| §9 implementation checklist | 1–5 |
| Invariant 1 simulate gateway | 2, 3 |
| Invariant 2 no simulate in UI | 4 |
| Invariant 4 no new catalog | all |
| Invariant 5 no new routes | all |
| Invariant 6 testids stable | 4 |
| Invariant 7 Advanced collapsed | 4 |
| Invariant 8 night audit steps | all |
| Invariant 9 cash unchanged | 3, 4 |
| Invariant 10 legacy Card fallback | 4 |
| Invariant 11 write-once at authorize | 3 |
| Invariant 12 org schema 7 | all |
| P0-2 pointer | 4 |
| DEMO-READY P1 card tick | 4 |
