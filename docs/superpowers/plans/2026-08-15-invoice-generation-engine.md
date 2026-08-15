# Invoice generation engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Ship property-local invoice generation — v32 `invoice` table + R2 JSON snapshots on `EVENT_LOG_R2`, monotonic numbering from `pms.invoice.*`, `invoice.generate` / `invoice.void` (catalog **86**, writers **61**, HTTP **[138]–[140]**), checkout precondition gate when `gen_mode === 'Automatically'`, Folio SPA generate/view/void — **no** PDF worker, **no** credit notes, **no** `invoice.regenerate`, **no** PATCH.

**Architecture:** At generate, PropertyDO copies folio lines + tax rollups + presentation config into immutable JSON (`schemaVersion: 1`), puts to `invoices/{propertyId}/{invoiceNumber}.json`, indexes in SQLite. Counter lives in `__meta.invoice_counter` (never recycled). Void is terminal (index only; R2 unchanged). Auto mode requires an active GUEST-window invoice **before** checkout txn starts; `tryCheckOut` verifies `hasActiveInvoiceForWindowSync` and throws `InvoiceRequiredError` if missing. R2 `await` stays **outside** `transactionSync`; counter bump + index insert happen in one sync txn **after** successful put.

**Tech Stack:** PropertyDO sqlite v32 (`@hospai/do-runtime`), `@hospai/contracts` wire codes + catalog/routes, vitest Worker HTTP (`invoice-generation.spec.ts`), web-pms RTL (`FolioScreen.test.tsx`), `@hospai/client-core`, `EVENT_LOG_R2`.

**Spec:** `docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md` (Approved at `8d767c4` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes Phase 1 leftover **10** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~40).

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **84 → 86** | Moving `[137]`–`[127]` |
| `AUDIT_WRITER_COMMAND_IDS.size` **59 → 61** | Credit notes / post-checkout invoice edits |
| HTTP append `[138] post_invoices` … `[140] post_invoice_void` | PDF generation worker |
| `PROPERTY_SCHEMA_HEAD` **31 → 32** | `invoice.regenerate` command |
| `ORG_SCHEMA_HEAD` **7** unchanged | PATCH on invoice HTTP |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | City ledger / AR |
| Event consumer auto-generate | MVP — stretch note in Task 4 only |
| Tests Lock 12 | Ticking Tasks 1–5 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.2)

**Locked:** `COMMAND_CATALOG` **84 → 86** — append `invoice.generate`, `invoice.void` **after** `rates.archive_promo`. `AUDIT_WRITER_COMMAND_IDS.size` **59 → 61**. HTTP `[137] delete_rate_promo` last; `[133]`–`[127]` **unmoved**. Append `[138] post_invoices`, `[139] get_invoice`, `[140] post_invoice_void`. `PROPERTY_SCHEMA_HEAD` **31 → 32**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — v32 DDL (spec Lock 4)

**Locked:** `INVOICE_GENERATION_V32_STATEMENTS` / `_SQL` exactly as spec Lock 4 DDL (`invoice` table + `invoice_active_window` partial unique + `invoice_reservation_idx`). No FK to `reservation` / `folio_window`. No `cancelled` column — void is terminal.

### D3 — Wire codes + HTTP map (spec Lock 7)

**Locked:** `INVOICE_ALREADY_EXISTS`, `INVOICE_NOT_FOUND`, `INVOICE_VOIDED`, `INVOICE_R2_UNBOUND`, `INVOICE_REQUIRED`, `FOLIO_BALANCE_DUE` in `idempotency.ts`. Map: `INVOICE_ALREADY_EXISTS` / `INVOICE_VOIDED` → **409**; `INVOICE_NOT_FOUND` → **404**; `INVOICE_REQUIRED` / `FOLIO_BALANCE_DUE` → **422** (alongside `BALANCE_DUE`); `INVOICE_R2_UNBOUND` → **503**. Internal errors: `InvoiceAlreadyExistsError`, `InvoiceR2UnboundError`, `FolioBalanceDueError`, `InvoiceRequiredError`, `InvoiceNotFoundError`, `InvoiceVoidedError` — non-export, mirror `BalanceDueError` (~758).

### D4 — Numbering + R2 (spec Locks 2–3)

**Locked:** Counter in `property_config` key `__meta.invoice_counter` (raw SQL, never via `tryPutDomainConfig`). Format: `prefix + padStart(6) + suffix` from `pms.invoice.prefix` / `suffix`. R2 key: `invoices/{propertyId}/{invoiceNumber}.json` on `EVENT_LOG_R2`. Snapshot `schemaVersion: 1` fields per spec Lock 3 table. One active invoice per `(reservation_id, folio_window_id)` via partial unique index. Void does **not** recycle numbers.

### D5 — Commands + HTTP (spec Locks 5–7)

**Locked:** `invoice.generate` — INTERACTIVE, FAIL_CLOSED, idempotent, `folio:post`, events `['invoice.generated']`. `invoice.void` — INTERACTIVE, FAIL_CLOSED, idempotent, `folio:adjust`, events `['invoice.voided']`. Three HTTP routes after `[137]`; `get_invoice` has `degradedRead: 'FAIL_CLOSED'`, no `commandId`. `scripts/permissions-check.mjs` and `scripts/degraded-check.mjs`: `V1_ROUTES.length === V1_HTTP_ROUTE_AUDIT.length` — add three routes to **both** `v1-dispatch.ts` and `v1-http-routes.ts`. **Do not** add invoice commands to `REPLAY_DISPATCH`.

### D6 — Checkout gate (spec Lock 8)

**Locked:** **No** inline R2 put inside `tryCheckOut` txn. When `pms.invoice.gen_mode === 'Automatically'`, after balance gate (~8891) and before status flip (~8900), throw `InvoiceRequiredError` if no active invoice for GUEST window. SPA/API must call `POST …/invoices` **before** `POST …/check-out`. Default `gen_mode` is `'Automatically'` — Folio checkout flow must generate first or checkout returns **422** `invoice_required`. When `generatedBy === 'checkout'`, persist `generated_by = 'system:checkout'` and `"autoGenerated": true` in snapshot.

### D7 — SPA (spec Lock 10)

**Locked:** Folio `data-testid="invoice-generate"`, `invoice-view`, `invoice-void`. Client renders snapshot JSON (no `window.print` in degraded). Use `readInvoicesForReservation` DO RPC for button state. Auto checkout: `generateInvoice` then `checkOut` when `gen_mode === 'Automatically'`.

### D8 — Tests / CI discipline (spec Lock 12)

**Locked:** File-filter vitest; **no `vi.spyOn` into DO isolate.** Rebuild `@hospai/contracts` before pms-core tests (Task 2+). Rebuild `@hospai/client-core` before web-pms tests (Task 5). `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D9 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 6 only** at implementation time. Bidirectional pointers — **Task 6 only**. No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` moves 31 → 32** — `invoice` table only.
- **Invoice is a snapshot** — no live folio JOIN on GET; no R2 UPDATE after put.
- **Catalog 86 / writers 61 / routes [138]–[140]** — append after `[137]`/`rates.archive_promo`; do not move `[137]`–`[127]`.
- **`pnpm generate:ddl`** = `pnpm --filter @hospai/do-runtime build && node scripts/property-ddl.mjs --write`.
- **R2 put outside `transactionSync`** — bump counter + INSERT index in sync txn after successful put; failed put must not advance counter.
- **Scope-out (forbidden all tasks):** credit notes; PDF worker; city ledger; logo R2 upload; `invoice.regenerate`; PATCH; COMPANY/MASTER window invoices; event consumer (MVP — stretch sub-step skipped); invoice list HTTP route; post-checkout auto_capture on snapshot; growing `NIGHT_AUDIT_STEPS`; `CLASS_DENYLIST`; `ARCHITECTURE.md`; push; ticking Tasks 1–5 living boxes.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `INVOICE_GENERATION_V32_*`; append v32 | 1 |
| `packages/do-runtime/src/index.ts` | export v32 SQL/constants | 1 |
| `migrations/do-property/0032_invoice_generation.sql` | generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql + head **32** | 1 |
| `scripts/property-ddl.mjs` | target `0032_invoice_generation.sql` | 1 |
| `apps/pms-core/src/property-do.ts` | purge list; counter; snapshot; generate/void; checkout gate; list RPC | 1, 2, 4 |
| `packages/contracts/src/idempotency.ts` | `INVOICE_*`, `FOLIO_BALANCE_DUE` | 1 |
| `packages/contracts/src/idempotency.test.ts` | wire assertions | 1 |
| `packages/contracts/src/commands/catalog.ts` | +2 commands after `rates.archive_promo` | 1 |
| `packages/contracts/src/commands/audit-writers.ts` | +2 writer ids | 1 |
| `packages/contracts/src/v1-http-routes.ts` | +3 route audit entries after `[137]` | 1 |
| `packages/contracts/src/register.test.ts` | pins **86** / **61** / **[138]–[140]** | 1 |
| `apps/pms-core/src/event-log.ts` | `invoiceObjectKey`, `invoicesPrefixForProperty` | 2 |
| `apps/pms-core/src/event-consumer.ts` | allowlist `invoice.generated` / `invoice.voided` noop | 2 |
| `apps/pms-core/test/invoice-generation.spec.ts` | Lock 12 cases **1–11** | 2, 3, 4 |
| `apps/pms-core/src/v1-dispatch.ts` | three handlers + `V1_ROUTES` + error map | 3 |
| `packages/client-core/src/api.ts` | `generateInvoice`, `getInvoice`, `voidInvoice` | 3 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | generate + view + void + auto checkout sequence | 5 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Lock 12 SPA cases | 5 |
| `apps/pms-core/src/purge-workflow.ts` | invoice R2 prefix delete | 6 |
| `apps/pms-core/test/purge-workflow.spec.ts` | invoice prefix purge assertion | 6 |
| `.superpowers/sdd/progress-phase1-leftovers.md` | Close leftover **10** | 6 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close leftover **7** | 6 |
| `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` | Close leftover **8** | 6 |
| `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` | Close leftover **9** | 6 |
| `docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md` | Close leftover **6** | 6 |
| `docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md` | Tick §7 checklist | 6 |
| `docs/superpowers/plans/2026-08-15-invoice-generation-engine.md` | Task 6 checkboxes (this file) | 6 |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `ARCHITECTURE.md`, `pms.invoice.logo` upload.

---

## Spec §1.3 / §7 → task map

| Spec item | Task |
|---|---|
| §1.3 (1) v32 migration | 1 |
| §1.3 (5–6) wire + catalog + routes audit | 1 |
| §1.3 (2–4) counter + snapshot + R2 + RPCs | 2 |
| §1.3 (6) HTTP handlers | 3 |
| §1.3 (7) checkout inline auto gate | 4 |
| §1.3 (8) SPA | 5 |
| §1.3 (9) purge + DDL finalize | 6 |
| Lock 12 DO/HTTP **1–11** | 2, 3, 4 |
| Lock 12 SPA | 5 |
| §7 checklist + pointers | 6 |
| Lock 9 event consumer stretch | skip MVP (Task 4 note) |
| §1.4 scope out | forbidden all |

---

### Task 1: Schema v32 + wire codes + catalog pins

**Spec:** §2 Locks 4, 7 (wire only), Lock 11 (purge table list partial), §4 items 1–2 partial.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` — after `PROMO_CODES_V31_*` (~1224–1228); append to `PROPERTY_MIGRATIONS`
- Modify: `packages/do-runtime/src/index.ts` — export v32 (~114–115)
- Modify: `packages/do-runtime/src/migrate.test.ts` — head **32** (~631, ~868+)
- Modify: `scripts/property-ddl.mjs` — after `0031_promo_codes.sql` (~439–448)
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` (~1262–1294); `countPropertyInventoryRows` (~1297+)
- Modify: `packages/contracts/src/idempotency.ts` — after `PROMO_CODE_EXISTS` (~106)
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts` — after `rates.archive_promo` (~930–939)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — after `rates.archive_promo` (~48)
- Modify: `packages/contracts/src/v1-http-routes.ts` — after `delete_rate_promo` (~813–819)
- Modify: `packages/contracts/src/register.test.ts` — pins (~697–707)
- Create: `migrations/do-property/0032_invoice_generation.sql` — via `pnpm generate:ddl`

**Interfaces:**
- Produces: `INVOICE_GENERATION_V32_STATEMENTS`, `INVOICE_GENERATION_V32_SQL`
- Produces: six wire constants + `FOLIO_BALANCE_DUE`
- Produces: catalog entries `invoice.generate`, `invoice.void`
- Produces: `PROPERTY_SCHEMA_HEAD === 32`

**Forbidden this commit:** DO invoice RPCs, HTTP handlers, SPA, spec pointers, invoice R2 prefix purge.

- [ ] **Step 1: Write failing migrate tests (schema head 32)**

In `packages/do-runtime/src/migrate.test.ts`:

1. Import `INVOICE_GENERATION_V32_SQL` alongside `PROMO_CODES_V31_SQL` (~47).
2. Update `expect(PROPERTY_SCHEMA_HEAD).toBe(32)` (~631).
3. Add after promo_codes block (~868+):

```typescript
  it('property schema head is 32 after invoice_generation', () => {
    const v32 = PROPERTY_MIGRATIONS.find((m) => m.version === 32);
    expect(v32?.name).toBe('invoice_generation');
    expect(v32?.statements[0]).toContain('CREATE TABLE invoice');
    expect(v32?.statements.some((s) => s.includes('invoice_active_window'))).toBe(true);
  });

  it('migrations/do-property/0032_invoice_generation.sql matches INVOICE_GENERATION_V32_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0032_invoice_generation.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(INVOICE_GENERATION_V32_SQL.trim());
  });
```

4. Update `applies property migrations through version 31` → **version 32** if present (~226–237): expect tail version **32**.

- [ ] **Step 2: Run migrate tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|invoice_generation|through version"
```

Expected: **FAIL** — head still **31**; v32 missing.

- [ ] **Step 3: Add v32 migration + purge list**

In `packages/do-runtime/src/property-migrations.ts` after `PROMO_CODES_V31_SQL`:

```typescript
export const INVOICE_GENERATION_V32_STATEMENTS = [
  `CREATE TABLE invoice (
  invoice_id        TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL,
  reservation_id    TEXT NOT NULL,
  folio_window_id   TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  generated_by      TEXT NOT NULL,
  voided_at         INTEGER,
  voided_by         TEXT,
  UNIQUE (invoice_number),
  CHECK (voided_at IS NULL OR (voided_by IS NOT NULL AND length(voided_by) > 0))
)`,
  `CREATE UNIQUE INDEX invoice_active_window
  ON invoice (reservation_id, folio_window_id)
  WHERE voided_at IS NULL`,
  `CREATE INDEX invoice_reservation_idx ON invoice (reservation_id)`,
] as const;

export const INVOICE_GENERATION_V32_SQL =
  INVOICE_GENERATION_V32_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 32,
    name: 'invoice_generation',
    statements: INVOICE_GENERATION_V32_STATEMENTS,
  },
```

Export from `packages/do-runtime/src/index.ts`:

```typescript
  INVOICE_GENERATION_V32_SQL,
  INVOICE_GENERATION_V32_STATEMENTS,
```

In `scripts/property-ddl.mjs` after `0031_promo_codes.sql`:

```javascript
  {
    path: join(root, 'migrations/do-property/0032_invoice_generation.sql'),
    header: `-- PropertyDO invoice generation — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE invoice → partial unique active window → reservation index.

`,
    sql: INVOICE_GENERATION_V32_SQL,
  },
```

In `apps/pms-core/src/property-do.ts` — insert `'invoice'` **immediately after** `'idempotency'` (~1272):

```typescript
  'idempotency',
  'invoice',
  'night_audit_report',
```

In `countPropertyInventoryRows` — insert after `idempotency` count (~1308 area):

```typescript
      (SELECT COUNT(*) FROM invoice) +
      (SELECT COUNT(*) FROM night_audit_report) +
```

(Replace bare `night_audit_report` line if duplicate — ensure exactly one `invoice` term.)

- [ ] **Step 4: Add wire codes + catalog + routes audit + register pins**

`packages/contracts/src/idempotency.ts` after promo codes (~106):

```typescript
export const INVOICE_ALREADY_EXISTS = 'invoice_already_exists' as const;
export const INVOICE_NOT_FOUND = 'invoice_not_found' as const;
export const INVOICE_VOIDED = 'invoice_voided' as const;
export const INVOICE_R2_UNBOUND = 'invoice_r2_unbound' as const;
export const INVOICE_REQUIRED = 'invoice_required' as const;
export const FOLIO_BALANCE_DUE = 'folio_balance_due' as const;
```

`packages/contracts/src/idempotency.test.ts`:

```typescript
    expect(INVOICE_ALREADY_EXISTS).toBe('invoice_already_exists');
    expect(INVOICE_NOT_FOUND).toBe('invoice_not_found');
    expect(INVOICE_VOIDED).toBe('invoice_voided');
    expect(INVOICE_R2_UNBOUND).toBe('invoice_r2_unbound');
    expect(INVOICE_REQUIRED).toBe('invoice_required');
    expect(FOLIO_BALANCE_DUE).toBe('folio_balance_due');
```

`packages/contracts/src/commands/catalog.ts` append after `rates.archive_promo`:

```typescript
  {
    id: 'invoice.generate',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['invoice.generated'],
    entitlement: 'pms.core',
    permission: 'folio:post',
  },
  {
    id: 'invoice.void',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['invoice.voided'],
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
```

`packages/contracts/src/commands/audit-writers.ts` after `rates.archive_promo`:

```typescript
  'invoice.generate',
  'invoice.void',
```

`packages/contracts/src/v1-http-routes.ts` append after `delete_rate_promo`:

```typescript
  {
    id: 'post_invoices',
    scope: 'property',
    permission: 'folio:post',
    commandId: 'invoice.generate',
    entitlement: 'pms.core',
  },
  {
    id: 'get_invoice',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_invoice_void',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'invoice.void',
    entitlement: 'pms.core',
  },
```

Update `packages/contracts/src/register.test.ts` (~697–707):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[137]?.id).toBe('delete_rate_promo');
    expect(V1_HTTP_ROUTE_AUDIT[138]?.id).toBe('post_invoices');
    expect(V1_HTTP_ROUTE_AUDIT[138]).toMatchObject({
      scope: 'property',
      permission: 'folio:post',
      commandId: 'invoice.generate',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[139]?.id).toBe('get_invoice');
    expect(V1_HTTP_ROUTE_AUDIT[139]).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[140]?.id).toBe('post_invoice_void');
    expect(V1_HTTP_ROUTE_AUDIT[140]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'invoice.void',
      entitlement: 'pms.core',
    });
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(61);
    expect(COMMAND_CATALOG).toHaveLength(86);
```

- [ ] **Step 5: Generate DDL + run tests**

```bash
pnpm generate:ddl
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|invoice_generation|through version"
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:ddl
pnpm check:purge
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 32`; catalog **86**; writers **61**; `[137]` unchanged.

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
  migrations/do-property/0032_invoice_generation.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v32 invoice schema and invoice wire codes

EOF
)"
```

---

### Task 2: DO invoice engine

**Spec:** §2 Locks 2–3, 5–6, Lock 12 cases **1–6**, **8**, **11** (stub-level; HTTP in Task 3).

**Files:**
- Modify: `apps/pms-core/src/event-log.ts` — `invoiceObjectKey`, `invoicesPrefixForProperty`
- Modify: `apps/pms-core/src/property-do.ts` — counter, snapshot builder, R2 put, RPCs (~3419+ adjacent to report helpers; new section before/after folio reads ~17676+)
- Modify: `apps/pms-core/src/event-consumer.ts` — allowlist ~139
- Create: `apps/pms-core/test/invoice-generation.spec.ts` — cases **1–6**, **8**, **11** via stub (+ env R2)

**Interfaces:**
- Produces: `readInvoiceCounterSync`, `bumpInvoiceCounterSync`, `formatInvoiceNumberSync`
- Produces: `buildInvoiceSnapshotSync`, `putInvoiceObject`, `tryGenerateInvoice`, `tryVoidInvoice`
- Produces: `hasActiveInvoiceForWindowSync`, `readInvoicesForReservation`
- Consumes: Task 1 v32 `invoice` table + wire codes

**Forbidden this commit:** HTTP handlers, SPA, checkout gate (Task 4), spec pointers.

- [ ] **Step 1: Write failing stub tests (`invoice-generation.spec.ts` cases 1–6, 8, 11)**

Create `apps/pms-core/test/invoice-generation.spec.ts` mirroring `reservations-check-out.spec.ts` helpers (`provisionedPropertyStub`, `createGuest`, `stayCheckedIn`, `idemFor`, `TEST_OWNER_ACTOR`). Add HTTP helper stubs for Task 3 later in same file.

**Case 1** — `manual generate creates index row + R2 object; sha256 matches`:

```typescript
it('case 1: manual generate — index row + R2 object; sha256 matches body', async () => {
  const name = `inv-1-${crypto.randomUUID()}`;
  const { stub, guestRef } = await provisionedPropertyWithGuest(name);
  // ... addRoomType, stayCheckedIn, zero balance or allow_pending ...
  const reservationId = 'res_inv1';
  const guestWindowId = `${reservationId}:GUEST`;
  const gen = await stub.tryGenerateInvoice(
    TEST_OWNER_ACTOR,
    { reservationId, folioWindowId: guestWindowId, generatedBy: 'desk' },
    await idemFor('gen1', { reservationId, folioWindowId: guestWindowId }),
  );
  expect(gen).toMatchObject({ ok: true });
  if (!gen.ok) return;
  const obj = await env.EVENT_LOG_R2!.get(gen.r2Key);
  expect(obj).toBeTruthy();
  const body = new Uint8Array(await obj!.arrayBuffer());
  const digest = /* sha256 hex same as property-do helper */;
  expect(gen.sha256).toBe(digest);
  const rows = await stub.readInvoicesForReservation(reservationId);
  expect(rows.some((r) => r.invoiceId === gen.invoiceId && r.voidedAt == null)).toBe(true);
});
```

**Case 2** — duplicate active window → `{ ok: false, error: INVOICE_ALREADY_EXISTS }`.

**Case 3** — idempotent replay same key → same `invoiceId`; counter not bumped twice (assert `invoice_number` sequence).

**Case 4** — balance due + `allow_pending false` → `FOLIO_BALANCE_DUE`.

**Case 5** — void sets `voided_at`; second void → `INVOICE_VOIDED`.

**Case 6** — after void, new generate → new `invoice_number` (monotonic; old not reused).

**Case 8** — `await stub.setReportsR2UnboundForTest(true)` → `INVOICE_R2_UNBOUND`.

**Case 11** — first invoice honours `starting_idx` (set `pms.invoice.starting_idx` to `42` before first generate → `INV-000042`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts -t "case [1-68]|case 11"
```

Expected: **FAIL** — `tryGenerateInvoice` missing.

- [ ] **Step 3: Add event-log key helpers**

In `apps/pms-core/src/event-log.ts`:

```typescript
export function invoiceObjectKey(propertyId: string, invoiceNumber: string): string {
  return `invoices/${propertyId}/${invoiceNumber}.json`;
}

export function invoicesPrefixForProperty(propertyId: string): string {
  return `invoices/${propertyId}/`;
}
```

- [ ] **Step 4: Implement PropertyDO invoice engine**

Add error classes near `BalanceDueError` (~758):

```typescript
class InvoiceAlreadyExistsError extends Error {
  constructor() {
    super(INVOICE_ALREADY_EXISTS);
    this.name = 'InvoiceAlreadyExistsError';
  }
}
class InvoiceR2UnboundError extends Error {
  constructor() {
    super(INVOICE_R2_UNBOUND);
    this.name = 'InvoiceR2UnboundError';
  }
}
class FolioBalanceDueError extends Error {
  constructor(public balanceMinor: number) {
    super(FOLIO_BALANCE_DUE);
    this.name = 'FolioBalanceDueError';
  }
}
class InvoiceNotFoundError extends Error {
  constructor() {
    super(INVOICE_NOT_FOUND);
    this.name = 'InvoiceNotFoundError';
  }
}
class InvoiceVoidedError extends Error {
  constructor() {
    super(INVOICE_VOIDED);
    this.name = 'InvoiceVoidedError';
  }
}
```

Import wire codes from `@hospai/contracts`. Extend `mapReservationPreconditionError` (~958):

```typescript
  if (e instanceof FolioBalanceDueError) return { ok: false, error: FOLIO_BALANCE_DUE };
  if (e instanceof InvoiceAlreadyExistsError) return { ok: false, error: INVOICE_ALREADY_EXISTS };
  if (e instanceof InvoiceR2UnboundError) return { ok: false, error: INVOICE_R2_UNBOUND };
  if (e instanceof InvoiceNotFoundError) return { ok: false, error: INVOICE_NOT_FOUND };
  if (e instanceof InvoiceVoidedError) return { ok: false, error: INVOICE_VOIDED };
```

Counter helpers (spec Lock 2 — inside class):

```typescript
  private readInvoiceCounterSync(): number {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.invoice_counter')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) {
      const start = Number(this.readConfigValueSync('pms.invoice.starting_idx') ?? 1);
      return start - 1;
    }
    return JSON.parse(rows[0].value_json) as number;
  }

  private bumpInvoiceCounterSync(expectedNext: number): void {
    const current = this.readInvoiceCounterSync();
    if (current + 1 !== expectedNext) throw new Error('invoice_counter_race');
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.invoice_counter', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(expectedNext),
      Date.now(),
    );
  }

  private formatInvoiceNumberSync(counter: number): string {
    const prefix = String(this.readConfigValueSync('pms.invoice.prefix') ?? 'INV-');
    const suffix = String(this.readConfigValueSync('pms.invoice.suffix') ?? '');
    return `${prefix}${String(counter).padStart(6, '0')}${suffix}`;
  }
```

**Async generate flow** (R2 outside txn):

```typescript
  private async putInvoiceObject(
    propertyId: string,
    invoiceNumber: string,
    body: unknown,
  ): Promise<{ r2Key: string; sha256: string }> {
    const bucket = this.assertReportsR2Bound(); // throws InvoiceR2UnboundError wrapper
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const sha256 = await this.sha256Hex(encoded);
    const r2Key = invoiceObjectKey(propertyId, invoiceNumber);
    await bucket.put(r2Key, encoded);
    return { r2Key, sha256 };
  }

  async tryGenerateInvoice(actor, input: {
    reservationId: string;
    folioWindowId?: string;
    generatedBy?: 'checkout' | 'desk';
  }, idem: IdempotencyKey) {
    // gatePermission folio:post, gateCoreEntitlement, degraded FAIL_CLOSED
    const resolvedWindow = input.folioWindowId ?? this.guestFolioWindowId(input.reservationId);
    const fingerprint = { reservationId: input.reservationId, folioWindowId: resolvedWindow };

    // Idempotency replay in transactionSync — return cached payload if hit

    // Preconditions in transactionSync (reservation status, window exists, active invoice, balance)
    // Build snapshot object in sync (readFolio lines for window, taxSummary, totals, presentation)
    const nextCounter = this.readInvoiceCounterSync() + 1;
    const invoiceNumber = this.formatInvoiceNumberSync(nextCounter);
    const invoiceId = crypto.randomUUID();
    const snapshot = this.buildInvoiceSnapshotSync({ ... , invoiceNumber, autoGenerated: input.generatedBy === 'checkout' });

    let put: { r2Key: string; sha256: string };
    try {
      put = await this.putInvoiceObject(propertyId, invoiceNumber, snapshot);
    } catch (e) {
      if (e instanceof Error && e.message === 'reports_r2_unbound') throw new InvoiceR2UnboundError();
      throw e;
    }

    return this.ctx.storage.transactionSync(() =>
      runIdempotent(this.ctx.storage.sql, idem, () => {
        this.bumpInvoiceCounterSync(nextCounter);
        this.ctx.storage.sql.exec(
          `INSERT INTO invoice (invoice_id, invoice_number, reservation_id, folio_window_id, r2_key, sha256, generated_at, generated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          invoiceId,
          invoiceNumber,
          input.reservationId,
          resolvedWindow,
          put.r2Key,
          put.sha256,
          Date.now(),
          input.generatedBy === 'checkout' ? 'system:checkout' : this.auditActorSync(actor),
        );
        this.appendPropertyOutbox({ eventType: 'invoice.generated', ... });
        this.appendAuditLogSync({ commandId: 'invoice.generate', ... });
        return { ok: true as const, invoiceId, invoiceNumber, r2Key: put.r2Key, sha256: put.sha256, ... };
      }),
    );
  }
```

`buildInvoiceSnapshotSync` — copy folio lines for window ordered `created_at ASC`; resolve charge names from `charge_code`; roll up `taxSummary`; compute `totals` in ledger minor; set `invoiceDate` from `pms.invoice.date_rule` (`CHECKOUT` → `departure_date`, else `__meta.business_date`); include `presentation` PRESENTATION keys only (not `logo`).

`hasActiveInvoiceForWindowSync`:

```typescript
  private hasActiveInvoiceForWindowSync(reservationId: string, folioWindowId: string): boolean {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT 1 FROM invoice WHERE reservation_id = ? AND folio_window_id = ? AND voided_at IS NULL LIMIT 1`,
        reservationId,
        folioWindowId,
      )
      .toArray();
    return rows.length > 0;
  }
```

`readInvoicesForReservation(reservationId)` — return `{ invoiceId, invoiceNumber, folioWindowId, generatedAt, voidedAt }[]`.

`tryVoidInvoice` — fingerprint `{ invoiceId }`; UPDATE void columns; outbox `invoice.voided`; audit `invoice.void`.

Map `assertReportsR2Bound` throw to `InvoiceR2UnboundError` in generate path (reuse existing binding check ~3419).

In `apps/pms-core/src/event-consumer.ts`:

```typescript
    case 'rate_promo.changed':
    case 'invoice.generated':
    case 'invoice.voided':
```

- [ ] **Step 5: Rebuild contracts + run stub tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts -t "case [1-68]|case 11"
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts -t "accepts every COMMAND_CATALOG"
```

Expected: cases **1–6**, **8**, **11** **PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/event-log.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/event-consumer.ts \
  apps/pms-core/test/invoice-generation.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): invoice generation DO engine

EOF
)"
```

---

### Task 3: HTTP dispatch + client API

**Spec:** §2 Lock 7, Lock 12 case **7** (GET snapshot).

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — three handlers + `V1_ROUTES`; import wire codes; extend `mapReservationCommandErrorStatus` (~283)
- Modify: `packages/client-core/src/api.ts` — after promo/rate helpers (~1677+)
- Modify: `apps/pms-core/test/invoice-generation.spec.ts` — add HTTP cases **7** + wire-level generate/void/GET

**Interfaces:**
- Produces: `handlePostInvoices`, `handleGetInvoice`, `handlePostInvoiceVoid`
- Produces: `generateInvoice`, `getInvoice`, `voidInvoice` client methods
- Consumes: Task 2 DO RPCs

**Forbidden this commit:** checkout gate, SPA, spec pointers.

- [ ] **Step 1: Write failing HTTP tests (case 7 + HTTP wrappers for generate/void)**

Append to `invoice-generation.spec.ts`:

```typescript
async function postInvoice(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-inv-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getInvoiceHttp(propertyId: string, actor: string, invoiceId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(invoiceId)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

it('case 7: GET returns snapshot from R2; unknown id → 404', async () => {
  // provision + POST generate → GET 200 with snapshot.lines + totals
  // GET random uuid → 404 { error: 'not_found' }
});
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts -t "case 7"
```

Expected: **FAIL** — 404 route missing.

- [ ] **Step 3: Implement dispatch handlers + error map**

In `mapReservationCommandErrorStatus` (~283):

```typescript
  if (error === INVOICE_ALREADY_EXISTS || error === INVOICE_VOIDED) return 409;
```

Add to 422 list (~317): `INVOICE_REQUIRED`, `FOLIO_BALANCE_DUE`.

Add to 404 list (~353): `INVOICE_NOT_FOUND`.

Add 503 branch: `INVOICE_R2_UNBOUND`.

`handlePostInvoices` — body `{ idempotencyKey, reservationId, folioWindowId? }`; fingerprint `{ reservationId, folioWindowId: resolved }`; invoke `tryGenerateInvoice`; **201** on success.

`handleGetInvoice` — load index via new stub `readInvoiceIndex(invoiceId)` or inline SQL RPC; `EVENT_LOG_R2.get(r2Key)`; return `{ invoiceId, ..., snapshot }`; index/R2 miss → **404** `{ error: 'not_found' }`; transport → `degradedFailClosedReadResponse()`.

`handlePostInvoiceVoid` — body `{ idempotencyKey, reason? }`; invoke `tryVoidInvoice`; **200**.

Append to `V1_ROUTES` after rate-promos block (~6808):

```typescript
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices$/,
    permission: 'folio:post',
    commandId: 'invoice.generate',
    handler: handlePostInvoices,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices\/([^/]+)$/,
    permission: 'folio:read',
    handler: handleGetInvoice,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices\/([^/]+)\/void$/,
    permission: 'folio:adjust',
    commandId: 'invoice.void',
    handler: handlePostInvoiceVoid,
  },
```

Add `readInvoiceIndex(invoiceId)` DO method returning index row or null.

- [ ] **Step 4: Add client API**

In `packages/client-core/src/api.ts`:

```typescript
    async generateInvoice(
      propertyId: string,
      input: { reservationId: string; folioWindowId?: string; idempotencyKey?: string },
    ) {
      const idempotencyKey =
        input.idempotencyKey ??
        stableKeyForOperation(`invoice:generate:${input.reservationId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reservationId: input.reservationId,
          ...(input.folioWindowId ? { folioWindowId: input.folioWindowId } : {}),
          idempotencyKey,
        }),
      });
    },
    async getInvoice(propertyId: string, invoiceId: string) {
      return getJson(`/v1/properties/${enc(propertyId)}/invoices/${enc(invoiceId)}`);
    },
    async voidInvoice(
      propertyId: string,
      invoiceId: string,
      input?: { reason?: string; idempotencyKey?: string },
    ) {
      const idempotencyKey =
        input?.idempotencyKey ??
        stableKeyForOperation(`invoice:void:${invoiceId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/invoices/${enc(invoiceId)}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey, ...(input?.reason ? { reason: input.reason } : {}) }),
      });
    },
```

- [ ] **Step 5: Rebuild + run tests + guard scripts**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: cases **1–8**, **11** **PASS** via HTTP/stub mix; `[138]–[140]` pinned.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/invoice-generation.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): invoice HTTP routes and client API

EOF
)"
```

---

### Task 4: Checkout precondition gate

**Spec:** §2 Lock 8, Lock 12 cases **9–10**. Lock 9 event consumer — **stretch, skip for MVP**.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryCheckOut` (~8891–8900); `InvoiceRequiredError`; return type union
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `mapReservationCommandErrorStatus` already has `INVOICE_REQUIRED` from Task 3
- Modify: `apps/pms-core/test/invoice-generation.spec.ts` — cases **9–10**

**Interfaces:**
- Produces: checkout **422** `invoice_required` when auto mode + no active invoice
- Consumes: Task 2 `hasActiveInvoiceForWindowSync`, Task 3 HTTP generate

**Forbidden this commit:** SPA auto-sequence (Task 5), event consumer (stretch), spec pointers.

- [ ] **Step 1: Write failing checkout gate tests (cases 9–10)**

```typescript
describe('invoice checkout gate', () => {
  it('case 9: gen_mode Automatically + no active invoice → checkout 422 invoice_required, stays checked_in', async () => {
    // checked_in, zero balance, gen_mode default Automatically (or explicit)
    const co = await postCheckOut(propertyId, actor, reservationId);
    expect(co.status).toBe(422);
    expect(await co.json()).toMatchObject({ ok: false, error: INVOICE_REQUIRED });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_in');
  });

  it('case 10: gen_mode Automatically + active invoice → checkout 200 checked_out', async () => {
    expect((await postInvoice(propertyId, actor, { reservationId })).status).toBe(201);
    const co = await postCheckOut(propertyId, actor, reservationId);
    expect(co.status).toBe(200);
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
  });
});
```

Add control test: `gen_mode !== 'Automatically'` (e.g. `'Manually'`) allows checkout without invoice.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts -t "checkout gate"
```

Expected: **FAIL** — case 9 checkout succeeds without invoice.

- [ ] **Step 3: Add `InvoiceRequiredError` + checkout gate**

Near `BalanceDueError` (~758):

```typescript
class InvoiceRequiredError extends Error {
  constructor() {
    super(INVOICE_REQUIRED);
    this.name = 'InvoiceRequiredError';
  }
}
```

In `mapReservationPreconditionError` (~958):

```typescript
  if (e instanceof InvoiceRequiredError) return { ok: false, error: INVOICE_REQUIRED };
```

In `tryCheckOut` after balance gate (~8897), before status UPDATE (~8900):

```typescript
          if (this.readConfigValueSync('pms.invoice.gen_mode') === 'Automatically') {
            const guestWindowId = this.guestFolioWindowId(input.reservationId);
            if (!this.hasActiveInvoiceForWindowSync(input.reservationId, guestWindowId)) {
              throw new InvoiceRequiredError();
            }
          }
```

Extend `tryCheckOut` catch to map `InvoiceRequiredError` via `mapReservationPreconditionError`.

- [ ] **Step 4: Run checkout gate tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts -t "checkout gate|case 9|case 10"
```

Expected: **PASS**.

- [ ] **Step 5 (stretch — skip MVP): Event consumer auto-generate**

Per spec Lock 9: extend `handleDomainEvent` for `reservation.status_changed → checked_out` when `gen_mode === 'Automatically'`. **Do not implement in MVP** — belt-and-braces for non-SPA checkout paths; document as follow-on.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/invoice-generation.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): checkout invoice precondition gate

EOF
)"
```

---

### Task 5: SPA — Folio generate, view, void

**Spec:** §2 Lock 10, Lock 12 SPA cases.

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — generate button, invoice panel, void control, auto checkout sequence (~509+)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` — extend mocks + three RTL cases

**Interfaces:**
- Consumes: Task 3 client API; 409 body enrichment for active invoice discovery
- Produces: desk UX for manual generate + void; auto checkout calls `generateInvoice` before `checkOut`

**Forbidden this commit:** spec pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing FolioScreen tests**

Extend `FolioScreen.test.tsx` mocks:

```typescript
const generateInvoice = vi.fn();
const getInvoice = vi.fn();
const voidInvoice = vi.fn();
// add to api mock in vi.mock('../client.js', ...)
```

**Lock 12 SPA 1** — generate button visible on checked-out folio:

```typescript
it('Lock 12 SPA 1: generate button visible on checked-out folio', async () => {
  getReservation.mockResolvedValue({ reservation: { status: 'checked_out', ... } });
  renderFolio();
  expect(await screen.findByTestId('invoice-generate')).toBeTruthy();
});
```

**Lock 12 SPA 2** — click generate → invoice view shows line totals from mocked snapshot:

```typescript
it('Lock 12 SPA 2: click generate opens invoice view with snapshot totals', async () => {
  generateInvoice.mockResolvedValue({
    body: { ok: true, invoiceId: 'inv_1' },
    classified: { class: 'live' },
  });
  getInvoice.mockResolvedValue({
    body: {
      invoiceId: 'inv_1',
      snapshot: {
        totals: { chargesMinor: 10000, balanceMinor: 0 },
        lines: [{ chargeName: 'Room', amountMinor: 10000 }],
      },
      presentation: { showTaxfee: true },
    },
    classified: { class: 'live' },
  });
  renderFolio();
  fireEvent.click(await screen.findByTestId('invoice-generate'));
  await waitFor(() => expect(screen.getByTestId('invoice-view').textContent).toContain('10000'));
});
```

**Lock 12 SPA 3** — active invoice hides generate button:

```typescript
it('Lock 12 SPA 3: active invoice hides generate button', async () => {
  generateInvoice.mockResolvedValue({
    body: { ok: false, error: 'invoice_already_exists', invoiceId: 'inv_1' },
    classified: { class: 'live', status: 409 },
  });
  getInvoice.mockResolvedValue({
    body: { invoiceId: 'inv_1', snapshot: { totals: { balanceMinor: 0 }, lines: [] } },
    classified: { class: 'live' },
  });
  renderFolio();
  fireEvent.click(await screen.findByTestId('invoice-generate'));
  await waitFor(() => expect(screen.queryByTestId('invoice-generate')).toBeNull());
});
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "Lock 12 SPA"
```

Expected: **FAIL** — UI absent.

- [ ] **Step 3: Implement FolioScreen invoice UX**

**MVP list-state lock (spec Lock 10):** no list HTTP route (spec §6 item 5 scope-out). Task 2 adds `readInvoicesForReservation` on PropertyDO for tests/checkout; Folio uses React Query cache key `['invoice-active', propertyId, reservationId]` plus **409 body enrichment**:

In Task 3/5, extend HTTP **409** `invoice_already_exists` to `{ ok: false, error, invoiceId, invoiceNumber }` from the active row so SPA can open existing invoice without a list route.

In `FolioScreen.tsx`:

1. Read `pms.invoice.gen_mode` from existing property config on screen.
2. Track `activeInvoiceId` in React Query cache; invalidate on generate/void success.
3. **Generate button** `data-testid="invoice-generate"` when status is `checked_in` or `checked_out`, balance zero or `allow_pending`, and no cached `activeInvoiceId`. Hide when cache populated.
4. On generate click → `api.generateInvoice`; **201** sets cache + opens view; **409** reads `invoiceId` from body, sets cache, opens view.
5. **Invoice view** panel `data-testid="invoice-view"` — `getInvoice` → render `snapshot.lines`, `taxSummary`, `totals`; honour `presentation.show*` flags. No `window.print` in degraded.
6. **Void** `data-testid="invoice-void"` for `folio:adjust` holders — confirm → `voidInvoice` → clear cache.
7. **Auto checkout** (~520): when `gen_mode === 'Automatically'`, before `api.checkOut`:

```typescript
      if (invoiceGenMode === 'Automatically') {
        await api.generateInvoice(propertyId, {
          reservationId,
          idempotencyKey: `invoice:checkout:${reservationId}`,
        });
      }
      return api.checkOut(propertyId, reservationId, `checkout:${reservationId}`, ...);
```

Dispatch maps checkout-flow generate to DO `generatedBy: 'checkout'` (accept optional body flag or infer from idempotency key prefix `invoice:checkout:`).

- [ ] **Step 4: Rebuild client-core + run RTL**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "Lock 12 SPA"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  packages/client-core/src/api.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): folio invoice generate view and void

EOF
)"
```

---

### Task 6: Purge + leftover pointers + final register pins

**Spec:** §2 Lock 11, §7 checklist, D8/D9.

**Files:**
- Modify: `apps/pms-core/src/purge-workflow.ts` — `invoicesPrefixForProperty` delete (~171–184, ~266)
- Modify: `apps/pms-core/test/purge-workflow.spec.ts` — assert invoice prefix emptied
- Modify: `.superpowers/sdd/progress-phase1-leftovers.md` — item **10** DONE
- Modify: leftover pointer specs (one sentence each)
- Modify: `docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md` — tick §7
- Modify: `docs/superpowers/plans/2026-08-15-invoice-generation-engine.md` — Task 6 checkboxes only

**Pointer sentences (normative — one sentence each):**

`.superpowers/sdd/progress-phase1-leftovers.md` item **10**:

> **10. Invoice generation engine** — DONE `…` (spec `8d767c4`, plan `…`; v32 `invoice` table, R2 snapshots, Folio generate/view).

`property-setup-spa-design.md` leftover **7** (~544):

> ~~| 7 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md): immutable folio snapshots in R2, monotonic numbering from `pms.invoice.*`, Folio desk surface.

`guest-crm-directory-design.md` leftover **8**:

> ~~| 8 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md).

`exception-queue-workbench-design.md` leftover **9**:

> ~~| 9 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md).

`tape-chart-live-board-design.md` leftover **6**:

> ~~| 6 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md).

- [x] **Step 1: Add invoice R2 prefix to purge workflow**

In `apps/pms-core/src/purge-workflow.ts` import `invoicesPrefixForProperty` from `event-log.js`. In `purge-r2` step (~177–182):

```typescript
    for (const propertyId of snapshot.propertyIds) {
      deleted += await deleteEventLogPrefix(env.EVENT_LOG_R2, reportsPrefixForProperty(propertyId));
      deleted += await deleteEventLogPrefix(env.EVENT_LOG_R2, invoicesPrefixForProperty(propertyId));
    }
```

Mirror in verify/residue check path (~266) if reports prefix is checked there.

Add purge test: seed invoice R2 key → purge → prefix empty.

- [x] **Step 2: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **86**; writers **61**; `[137]=delete_rate_promo`; `[138]=post_invoices` … `[140]=post_invoice_void`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 32`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 8`.

- [x] **Step 3: Targeted test superset (Lock 12 full slice)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "Lock 12 SPA"
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

- [x] **Step 4: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

- [x] **Step 5: Apply doc pointers + tick invoice spec §7 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md` §7.

- [x] **Step 6: Tick Task 6 checkboxes in this plan only**

Do **not** tick Tasks 1–5 checkboxes.

- [x] **Step 7: Commit**

```bash
git add apps/pms-core/src/purge-workflow.ts \
  apps/pms-core/test/purge-workflow.spec.ts \
  .superpowers/sdd/progress-phase1-leftovers.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md \
  docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md \
  docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md \
  docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md \
  docs/superpowers/plans/2026-08-15-invoice-generation-engine.md
git commit -m "$(cat <<'EOF'
docs: close invoice generation leftovers

EOF
)"
```

**Stop.** Credit notes, PDF worker, city ledger, event consumer auto-generate, and invoice list HTTP route stay deferred per spec §1.4 / §6.

---

## Spec §7 reviewer checklist (Task 6 ticks these in the spec file when CI is green)

| §7 item | Satisfied by |
|---|---|
| v32 migration + head **32** + purge `invoice` table + R2 prefix | 1, 6 |
| Wire codes + HTTP status map | 1, 3 |
| Catalog **86** + writers **61** + routes **[138]–[140]** | 1, 3 |
| DO counter + snapshot + R2 put + generate/void RPCs | 2 |
| Checkout precondition gate | 4 |
| HTTP handlers + client API | 3 |
| SPA Folio generate + view + void | 5 |
| Tests Lock 12 | 2–5 + 6 |
| Register pins + CI discipline | 6 |
| Bidirectional pointer closes | 6 |
| Task 4 stretch: event consumer | deferred |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.3 scope in (1–10) | 1–6 |
| §1.4 scope out | forbidden all |
| §2 Locks 1–12 | 1–6 |
| §5 file map | 1–6 |
| §7 checklist + pointers | 6 |
| Heads table §1.2 | 1 + 6 verify |
| D-locks 1–9 | Open decisions |

**Gaps:** Event consumer (Lock 9) explicitly deferred MVP. Invoice list HTTP (spec §6 item 5) deferred — Folio uses generate 409 / local state.

**Placeholder scan:** No TBD-only references.

**Tree conflicts:** None (spec §8). Verified on `main`: catalog **84**, writers **59**, `[137] delete_rate_promo` last, `PROPERTY_SCHEMA_HEAD` **31** (this plan → **32**), `pms.invoice.*` registered (~332–350), `putReportObject` ~3431, `tryCheckOut` ~8830, no existing invoice code.

**Implementer notes (from spec §8, not lock violations):**

1. **Precondition ordering** — auto mode: `POST …/invoices` before `POST …/check-out`; checkout only verifies active invoice exists.
2. **Default `gen_mode` is `Automatically`** — Folio must generate before checkout or get **422** `invoice_required`.
3. **`FOLIO_BALANCE_DUE` vs `BALANCE_DUE`** — separate wire codes; do not conflate at checkout.
4. **Degraded** — never issue invoices in degraded (`invoice.generate` FAIL_CLOSED).
5. **Guest PII** — snapshot carries refs only; SPA resolves name via existing guest batch read.
6. **Purge check** — omitting `'invoice'` in inventory tables throws at `check:purge`.
