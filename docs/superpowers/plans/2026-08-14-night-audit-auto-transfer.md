# Night-audit auto-transfer + folio routing rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-14)

**Goal:** Add property-scoped `folio_routing_rule` (v28), routing-rule CRUD, an 8-step night-audit machine with `AUTO_TRANSFER` after `PROCESS_NO_SHOWS`, and Settings UI — reusing the desk transfer primitive via an internal sync helper (no `folio:adjust` on the audit path).

**Architecture:** v28 table stores exact `charge_code → dest_window_kind` (`COMPANY` | `MASTER`). Catalog commands `folio.upsert_routing_rule` / `folio.archive_routing_rule` + HTTP `[129]–[131]` (append after `[128]`). Extract `transferFolioLineSync` from `tryTransferCharge`; `runAutoTransferSync` queries GUEST lines for the audited `businessDate`, resolves dest windows (COMPANY: 0 or 2+ OPEN → skip; exactly 1 slugged window → transfer; MASTER: `` `${reservationId}:MASTER` ``), calls the sync helper with `{ automated: true, ruleId, businessDate }` on per-line `folio.transfer_charge` audit rows. Step always `COMPLETED` when the body finishes; no `night_audit.auto_transfer` catalog command.

**Tech Stack:** PropertyDO + sqlite, `@hospai/contracts` (catalog + HTTP audit + `ROUTING_RULE_CONFLICT`), `@hospai/do-runtime` (v28 migration), vitest Worker specs (`provisionedPropertyStub`, `provisionHotel`, `worker.fetch`, `x-dev-actor`), web-pms RTL.

**Spec:** `docs/superpowers/specs/2026-08-14-night-audit-auto-transfer-design.md` (Approved). Spec commit: `bd3da70`.

---

## Sequencing gate (read before starting)

This slice closes **folio money ops leftover 1 — night-audit auto-transfer** and **charge-code registry leftover “Window routing rules table”.**

| After this plan | Do not start |
|---|---|
| v28 `folio_routing_rule`; exact-code rules only | Charge-code **ranges** / pattern syntax |
| `AUTO_TRANSFER` at index 3; 8-step machine | Folding auto-transfer into `POST_ROOM_CHARGES` / `ARCHIVE` |
| `[129]–[131]` HTTP (append after `[128]`) | Moving `[128]` / `[127]` / `[102]` |
| Desk `tryTransferCharge` unchanged (case **28** green) | New `night_audit.auto_transfer` catalog id |
| Settings routing-rules UI | Auto-create COMPANY/MASTER windows on dest |
| Per-line `folio.transfer_charge` + `automated: true` | City ledger / AR / invoices |
| — | `default_window_kind` on `charge_code` |
| — | Demo seed routing rules |
| — | New `export class` / `CLASS_DENYLIST` edit |

---

## Open decisions (locked — do not re-litigate)

### D1 — Heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` **77 → 79** (+2 routing-rule commands). **Append** `V1_HTTP_ROUTE_AUDIT[129] get_folio_routing_rules`, `[130] put_folio_routing_rule`, `[131] post_folio_routing_rule_archive` after `[128] post_folio_stay_discount`. Do **not** move `[128]` / `[127]` / `[102]`. `AUDIT_WRITER_COMMAND_IDS.size` **52 → 54**. `PLATFORM_GAPS` stays `[]`. `PROPERTY_SCHEMA_HEAD` **27 → 28**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` **7 → 8** (`AUTO_TRANSFER` at index **3**, after `PROCESS_NO_SHOWS`). Demo seed: no routing rules.

### D2 — Step placement (spec Lock 1)

**Locked:** `PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → AUTO_TRANSFER → CLOSE_CASHIER_SHIFTS → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE`. Amend ARCHITECTURE.md §8 diagram + any “pinned 7-step” prose in **Task 5 only**.

### D3 — Transfer primitive (spec Lock 3)

**Locked:** Extract `transferFolioLineSync`; `tryTransferCharge` becomes gates + `runIdempotent` + helper. Night-audit calls helper directly — **no** `folio:adjust`, **no** `touchInteractive()`, **no** `runIdempotent` per line. Deterministic ids `` `:xfer-rev:` `` / `` `:xfer:` ``; tax restamp on dest; idempotent dest row skip.

### D4 — Dest window resolution (spec Lock 4)

**Locked:** **Do not** call `tryOpenFolioWindow` from the audit step. **COMPANY:** query `folio_window` where `reservation_id = ? AND kind = 'COMPANY' AND status = 'OPEN'` — **0** or **2+** → skip (`skippedCount++`); **exactly 1** → transfer to that slugged `folio_window_id` (desk id `` `${reservationId}:COMPANY:${slug}` ``). **MASTER:** lookup `` `${reservationId}:MASTER` ``; missing or `CLOSED` → skip. Per-stay skip is **not** step failure. Tests open COMPANY via `tryOpenFolioWindow` + `billedParty` (mirror `folio-fx-split-transfer.spec.ts` case **28**).

### D5 — HTTP GET (spec Lock 6)

**Locked:** `[129] get_folio_routing_rules` uses **`folio:read`** + **`degradedRead: 'FAIL_CLOSED'`** (same as `[53] get_charge_codes`). Writers remain **`settings:configure`**.

### D6 — Wire code

**Locked:** New `ROUTING_RULE_CONFLICT` in `packages/contracts/src/idempotency.ts` + `idempotency.test.ts` (mirror `CHARGE_CODE_EXISTS` / `CHARGE_CODE_NOT_FOUND` pattern). Upsert second active rule for same `chargeCode` on different `ruleId` → `ROUTING_RULE_CONFLICT`.

### D7 — Test discipline

**Locked:** Fixture ids / dates via `crypto.randomUUID()`. HTTP via `provisionHotel` + `worker.fetch` + `x-dev-actor` — **do not invent `provisionedPropertyWorker`**. Do not `vi.spyOn` into the DO isolate. File-filter vitest only; unsharded `pnpm --filter @hospai/pms-core test` may segfault — use `vitest run <file> -t "..."` or `--shard=N/8` (**no `--` before `--shard`**).

### D8 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts`** before pms-core tests when contracts change (Tasks 2–3).
2. **Rebuild `@hospai/client-core`** before web-pms tests (Task 4): `pnpm --filter @hospai/client-core build`.
3. **Register pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **not** `-t "COMMAND_CATALOG|post_demo_seed"`.
4. **Night-audit step pin:** rename/update `night-audit-room-charges.spec.ts` `-t "night-audit step count is 7"` → **`-t "night-audit step count is 8"`**; also fix `rooms-ooo.spec.ts` `toHaveLength(7)` → **8**.
5. **`pnpm generate:ddl` then `git diff --exit-code -- migrations packages/do-runtime`** must match committed SQL after Task 1 (and no-op drift check in Task 5).
6. **Dispatch routes appended at end of `V1_ROUTES`** (after `post_folio_stay_discount` ~7298) so index matches `V1_HTTP_ROUTE_AUDIT` — `check:permissions` diffs by index.
7. **Do not `|| true` CI failures.** Workerd 503 on a shard: retry that shard once. Never unsharded pms-core test.
8. **Bidirectional pointers** (folio-money §4.3 + §19 item **1**; charge-code §6 routing row; night-audit-e2e “Seven steps” → eight) — **Task 5 only**, plus tick spec §11 and plan Task 5 checkboxes there.
9. Living plan checkboxes: tick `- [x]` on **Task 5 only**.
10. **Spec/plan writers do not commit; implementers commit per task.**

---

## Global Constraints

- **Append-only folio.** Never mutate existing line amounts.
- **Empty routing table** → `AUTO_TRANSFER` no-op; step row still **`COMPLETED`**.
- **No `night_audit.auto_transfer`** in catalog, audit writers, or summary audit rows.
- **`pnpm generate:ddl`** required for v28; committed SQL must match generator output.
- **`check:web-pms-colors`** if SPA files touched (Task 4).

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v28 `folio_routing_rule` | 1 |
| `migrations/do-property/0028_folio_routing_rule.sql` | Generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | Pin `PROPERTY_SCHEMA_HEAD === 28`; v28 assertions | 1 |
| `apps/pms-core/src/property-do.ts` | Purge list + `countPropertyInventoryRows`; (Task 2) routing CRUD, `transferFolioLineSync`, `runAutoTransferSync`, `NIGHT_AUDIT_STEPS`, `runAuditStep` | 1–2 |
| `packages/contracts/src/commands/catalog.ts` | +2 commands | 2 |
| `packages/contracts/src/commands/audit-writers.ts` | +2 ids → size **54** | 2 |
| `packages/contracts/src/idempotency.ts` | `ROUTING_RULE_CONFLICT` | 2 |
| `packages/contracts/src/idempotency.test.ts` | Wire code assertion | 2 |
| `apps/pms-core/src/event-consumer.ts` | Allowlist `folio.routing_rule_changed` | 2 |
| `apps/pms-core/test/night-audit-auto-transfer.spec.ts` | DO cases §9 **1–7** | 2 |
| `apps/pms-core/test/night-audit-room-charges.spec.ts` | Step count pin **8** | 2 |
| `apps/pms-core/test/rooms-ooo.spec.ts` | `NIGHT_AUDIT_STEPS.length` **8** | 2 |
| `packages/contracts/src/v1-http-routes.ts` | Append `[129]–[131]` after `[128]` | 3 |
| `packages/contracts/src/register.test.ts` | Pins catalog **79**, writers **54**, `[129]–[131]`; `[128]` unmoved | 3 |
| `apps/pms-core/src/v1-dispatch.ts` | 3 handlers; **append** routes end of `V1_ROUTES` | 3 |
| `apps/pms-core/test/folio-routes.spec.ts` | HTTP cases §9 **9–12** | 3 |
| `packages/client-core/src/api.ts` | 3 routing-rule methods | 4 |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | Routing rules section | 4 |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | RTL case §9 **13** | 4 |
| `ARCHITECTURE.md` | §8 diagram + 8-step prose | 5 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | Close leftover **1** | 5 |
| `docs/superpowers/specs/2026-08-07-charge-code-registry-design.md` | Close routing row | 5 |
| `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` | “Seven steps” → eight | 5 |
| `docs/superpowers/specs/2026-08-14-night-audit-auto-transfer-design.md` | Tick §11 | 5 |
| `docs/superpowers/plans/2026-08-14-night-audit-auto-transfer.md` | Task 5 checkboxes | 5 |

**Not touched:** `tryTransferCharge` HTTP contract; `ORG_SCHEMA_HEAD`; demo seed rules; `CLASS_DENYLIST`; `default_window_kind` on `charge_code`; charge-code ranges.

---

## Spec §1.2 / §9 / §11 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) v28 `folio_routing_rule` | 1 |
| §1.2 (2) Catalog + HTTP `[129]–[131]` | 2–3 |
| §1.2 (3) `AUTO_TRANSFER` in `NIGHT_AUDIT_STEPS` | 2 |
| §1.2 (4) Extract sync transfer helper | 2 |
| §1.2 (5) `runAutoTransferSync` | 2 |
| §1.2 (6) Settings SPA | 4 |
| §1.2 (7) Tests §9 | 2–4 |
| §1.2 (8) ARCHITECTURE §8 | 5 |
| §9 DO **1–8** | 2 |
| §9 HTTP **9–12** | 3 |
| §9 SPA **13** | 4 |
| §11 checklist + pointers | 5 |
| §1.3 scope out | forbidden all |

---

### Task 1: Schema v28 — `folio_routing_rule` + purge inventory

**Spec:** §4, Lock 2, §8 migrate.test.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` — add `FOLIO_ROUTING_RULE_V28_*`; append migration version **28**
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` only
- Modify: `packages/do-runtime/src/migrate.test.ts` — pin **28**; v28 name/statements test
- Create (via generator): `migrations/do-property/0028_folio_routing_rule.sql`

**Interfaces:**
- Produces: v28 table + partial unique index `folio_routing_rule_active_code_uniq`; `PROPERTY_SCHEMA_HEAD === 28`; purge deletes `folio_routing_rule` rows.

**Forbidden this commit:** catalog, audit writers, event allowlist, DO routing CRUD, night-audit step, HTTP, client/SPA, register pins, `ROUTING_RULE_CONFLICT`, ARCHITECTURE amend.

- [ ] **Step 1: Write failing schema tests**

In `migrate.test.ts`, update global pin:

```typescript
expect(PROPERTY_SCHEMA_HEAD).toBe(28);
```

Append (after v27 block):

```typescript
  it('property schema head is 28 after folio_routing_rule', () => {
    const v28 = PROPERTY_MIGRATIONS.find((m) => m.version === 28);
    expect(v28?.name).toBe('folio_routing_rule');
    expect(v28?.statements.some((s) => s.includes('CREATE TABLE folio_routing_rule'))).toBe(true);
    expect(v28?.statements.some((s) => s.includes('folio_routing_rule_active_code_uniq'))).toBe(true);
    expect(v28?.statements.some((s) => s.includes("dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER'))"))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|folio_routing_rule"
```

Expected: **FAIL** — `PROPERTY_SCHEMA_HEAD` still **27** / v28 missing.

- [ ] **Step 3: Add v28 migration + purge registration**

In `property-migrations.ts` (after `VIRTUAL_ROOM_TYPES_V27_*`):

```typescript
export const FOLIO_ROUTING_RULE_V28_STATEMENTS = [
  `CREATE TABLE folio_routing_rule (
  rule_id           TEXT PRIMARY KEY,
  charge_code       TEXT NOT NULL REFERENCES charge_code(code),
  dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at        INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX folio_routing_rule_active_code_uniq
  ON folio_routing_rule (charge_code)
  WHERE status = 'active'`,
] as const;

export const FOLIO_ROUTING_RULE_V28_SQL =
  FOLIO_ROUTING_RULE_V28_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 28,
    name: 'folio_routing_rule',
    statements: FOLIO_ROUTING_RULE_V28_STATEMENTS,
  },
```

In `property-do.ts`, insert `'folio_routing_rule'` in `PROPERTY_PURGE_INVENTORY_TABLES` **before** `'folio_line'` (FK: rules reference `charge_code`, not folio lines). Add matching `+ (SELECT COUNT(*) FROM folio_routing_rule)` in `countPropertyInventoryRows`.

- [ ] **Step 4: Generate and commit DDL**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|folio_routing_rule"
pnpm check:purge
```

Expected: `0028_folio_routing_rule.sql` present; diff clean; tests **PASS**; purge self-test green.

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/migrate.test.ts \
  migrations/do-property/0028_folio_routing_rule.sql apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(do-runtime): add v28 folio_routing_rule schema

EOF
)"
```

---

### Task 2: DO — sync transfer extract, routing-rule RPCs, `AUTO_TRANSFER` step

**Spec:** §2 Locks 1–5, 9; §5 commands; §9 DO **1–8**; §8 property-do / contracts / event-consumer.

**Files:**
- Create: `apps/pms-core/test/night-audit-auto-transfer.spec.ts`
- Modify: `apps/pms-core/src/property-do.ts` — `transferFolioLineSync`, `tryUpsertRoutingRule`, `tryArchiveRoutingRule`, `listFolioRoutingRules`, `runAutoTransferSync`, `NIGHT_AUDIT_STEPS`, `runAuditStep`
- Modify: `packages/contracts/src/commands/catalog.ts` — append 2 entries after `folio.set_charge_code_status`
- Modify: `packages/contracts/src/commands/audit-writers.ts` — add `'folio.upsert_routing_rule'`, `'folio.archive_routing_rule'`
- Modify: `packages/contracts/src/idempotency.ts` — `ROUTING_RULE_CONFLICT`
- Modify: `packages/contracts/src/idempotency.test.ts` — export assertion
- Modify: `apps/pms-core/src/event-consumer.ts` — allowlist `folio.routing_rule_changed`
- Modify: `apps/pms-core/test/night-audit-room-charges.spec.ts` — step count **8**
- Modify: `apps/pms-core/test/rooms-ooo.spec.ts` — `toHaveLength(8)`

**Interfaces:**
- Consumes: Task 1 v28 table; existing `tryTransferCharge` body (~13099–13218); `tryOpenFolioWindow`, `guestFolioWindowId`, `stampTaxForChargeSync`, `insertFolioLineSync`.
- Produces:
  - `transferFolioLineSync({ sourceFolioLineId, destinationFolioWindowId, auditContext? })` → `{ reverseFolioLineId, destFolioLineId }`
  - `tryUpsertRoutingRule(actor, { ruleId, chargeCode, destWindowKind }, idem)` → `{ ok: true, ruleId }` | `{ ok: false, error: CHARGE_CODE_NOT_FOUND | ROUTING_RULE_CONFLICT | … }`
  - `tryArchiveRoutingRule(actor, { ruleId }, idem)` → `{ ok: true, ruleId }` | `{ ok: false, error: NOT_FOUND | … }`
  - `listFolioRoutingRules(status?)` → `Array<{ ruleId, chargeCode, destWindowKind, status, createdAt }>`
  - `runAutoTransferSync(businessDate)` → `{ transferredCount, skippedCount }`
  - `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'`

**Forbidden this commit:** HTTP routes/handlers, `v1-http-routes.ts`, `register.test.ts` pins, client/SPA, ARCHITECTURE / spec pointers.

**Catalog entries** (append after `folio.set_charge_code_status`):

```typescript
  {
    id: 'folio.upsert_routing_rule',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.routing_rule_changed'],
    entitlement: 'pms.core',
    permission: 'settings:configure',
  },
  {
    id: 'folio.archive_routing_rule',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.routing_rule_changed'],
    entitlement: 'pms.core',
    permission: 'settings:configure',
  },
```

**`idempotency.ts`:**

```typescript
export const ROUTING_RULE_CONFLICT = 'routing_rule_conflict' as const;
```

**`idempotency.test.ts`** (in charge-code wire codes block or new `it`):

```typescript
expect(ROUTING_RULE_CONFLICT).toBe('routing_rule_conflict');
```

**`event-consumer.ts`** — add case:

```typescript
    case 'folio.routing_rule_changed':
```

**`NIGHT_AUDIT_STEPS`** (~1055):

```typescript
export const NIGHT_AUDIT_STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'AUTO_TRANSFER',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;
```

**`runAuditStep` Txn B** — insert after `PROCESS_NO_SHOWS`, before `CLOSE_CASHIER_SHIFTS`:

```typescript
        } else if (step === 'AUTO_TRANSFER') {
          this.runAutoTransferSync(businessDate);
```

**`transferFolioLineSync` sketch** — move ~13099–13217 into private method; accept optional audit overlay:

```typescript
private transferFolioLineSync(input: {
  sourceFolioLineId: string;
  destinationFolioWindowId: string;
  auditContext?: { automated: true; ruleId: string; businessDate: string };
}): { reverseFolioLineId: string; destFolioLineId: string }
```

When `auditContext` set, `appendAuditLogSync` uses `commandId: 'folio.transfer_charge'` and `afterJson: { …desk fields, automated: true, ruleId, businessDate }` with actor `{ kind: 'system', reason: 'night_audit.auto_transfer' }`. **Do not** add `night_audit.auto_transfer` to catalog.

**`runAutoTransferSync` sketch:**

1. Load active rules; if none → return zeros.
2. Query candidate `folio_line` rows (Lock 5): `business_date = businessDate`, parent GUEST window OPEN, matching active rule, reject set same as desk (~13078–13087).
3. Per line: resolve dest (Lock 4 COMPANY query / MASTER id lookup); skip → `skippedCount++`; else `transferFolioLineSync` → `transferredCount++`.
4. No step-level audit command id.

- [ ] **Step 1: Write failing DO tests (`night-audit-auto-transfer.spec.ts`)**

```typescript
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { addCalendarDays, idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

describe('night audit — auto-transfer', () => {
  it('1: empty routing rules → AUTO_TRANSFER COMPLETED; zero TRANSFER lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('any');
    expect(lines.filter((l) => l.source === 'TRANSFER')).toHaveLength(0);
  });

  it('2: ROOM→COMPANY rule transfers to slugged COMPANY window with tax restamp', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    const room = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 10_000, businessDate };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room-at2', room))).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at2', { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' }),
      ),
    ).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-co-at2', { reservationId, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const dest = folio.lines.find((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM');
    expect(dest?.folioWindowId).toBe(open.ok ? open.folioWindowId : '');
    expect(dest?.folioWindowId).toContain(':COMPANY:');
    expect(folio.lines.some((l) => l.source === 'TRANSFER_REVERSAL')).toBe(true);
    expect(folio.lines.some((l) => l.source === 'TAX' && l.taxOf === dest?.folioLineId)).toBe(true);
  });

  it('3: ROOM→COMPANY rule; no OPEN COMPANY window → lines stay on GUEST; COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000, businessDate },
        await idemFor('room-at3', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at3', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.filter((l) => l.chargeCode === 'ROOM' && l.source !== 'TRANSFER_REVERSAL')).toHaveLength(1);
    expect(folio.lines.some((l) => l.source === 'TRANSFER')).toBe(false);
  });

  it('4: two OPEN COMPANY windows → skip; lines stay on GUEST', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000, businessDate },
        await idemFor('room-at4', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at4', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    for (const party of ['Acme', 'Beta']) {
      expect(
        await stub.tryOpenFolioWindow(
          TEST_OWNER_ACTOR,
          { reservationId, kind: 'COMPANY', billedParty: party },
          await idemFor(`open-${party}-at4`, { reservationId, kind: 'COMPANY', billedParty: party }),
        ),
      ).toMatchObject({ ok: true });
    }
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.some((l) => l.source === 'TRANSFER')).toBe(false);
  });

  it('5: rerun AUTO_TRANSFER same date → no duplicate dest lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 8000, businessDate },
        await idemFor('room-at5', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at5', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryOpenFolioWindow(
        TEST_OWNER_ACTOR,
        { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
        await idemFor('open-at5', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.filter((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM')).toHaveLength(1);
  });

  it('6: NIGHT_AUDIT_STEPS length 8; index 3 is AUTO_TRANSFER', () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');
  });

  it('7: full walk includes AUTO_TRANSFER COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-7-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(businessDate, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
    for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
      expect((await stub.runAuditStep(businessDate, step)).status).toBe('COMPLETED');
    }
    expect(await stub.getNightAuditStepStatus(businessDate, 'AUTO_TRANSFER')).toBe('COMPLETED');
  });
});
```

Update `night-audit-room-charges.spec.ts` test title and assertion:

```typescript
  it('31: POST_ROOM_CHARGES stays ledger identity; night-audit step count is 8', async () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');
```

Update `rooms-ooo.spec.ts`:

```typescript
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-transfer.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 8"
```

Expected: **FAIL** — stub methods / step missing.

- [ ] **Step 3: Implement contracts, event allowlist, property-do (extract + CRUD + step)**

Apply normative blocks above. Refactor `tryTransferCharge` to call `transferFolioLineSync` without changing desk gates. Implement `tryUpsertRoutingRule` / `tryArchiveRoutingRule` / `listFolioRoutingRules` mirroring charge-code CRUD patterns (~10593+): validate active `charge_code`; enforce partial unique index → `ROUTING_RULE_CONFLICT`; outbox `folio.routing_rule_changed` `{ propertyId, ruleId, chargeCode, destWindowKind, op, at }`.

Wire `tryAddFolioLine` / test helper to accept optional `businessDate` on folio lines if not already supported (night-audit candidates filter by `business_date`).

- [ ] **Step 4: Run DO tests + desk regression case 28**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts -t "ROUTING_RULE|routing_rule"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-transfer.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 8"
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "28:"
```

Expected: **PASS** (spec §9 case **8**).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts \
  apps/pms-core/src/event-consumer.ts apps/pms-core/src/property-do.ts \
  apps/pms-core/test/night-audit-auto-transfer.spec.ts \
  apps/pms-core/test/night-audit-room-charges.spec.ts apps/pms-core/test/rooms-ooo.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): auto-transfer matching folio lines at night audit

EOF
)"
```

---

### Task 3: HTTP `[129]–[131]` + register pins + HTTP tests

**Spec:** §5 HTTP, §9 HTTP **9–12**; Lock 6.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — **append** after `post_folio_stay_discount` (~750–756)
- Modify: `packages/contracts/src/register.test.ts` — inside `"night-audit HTTP routes"` test
- Modify: `apps/pms-core/src/v1-dispatch.ts` — handlers + **append** to end of `V1_ROUTES` (~7298, before `];`)
- Modify: `apps/pms-core/test/folio-routes.spec.ts` — HTTP CRUD + 403 cases

**Interfaces:**
- Consumes: Task 2 DO RPCs.
- Produces: GET list; PUT upsert `{ chargeCode, destWindowKind, idempotencyKey }`; POST archive `{ idempotencyKey }`; audit indices `[129]–[131]`.

**Forbidden this commit:** client/SPA, ARCHITECTURE / spec pointers, night-audit behaviour changes.

**Append to `v1-http-routes.ts`:**

```typescript
  {
    id: 'get_folio_routing_rules',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'put_folio_routing_rule',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'folio.upsert_routing_rule',
    entitlement: 'pms.core',
  },
  {
    id: 'post_folio_routing_rule_archive',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'folio.archive_routing_rule',
    entitlement: 'pms.core',
  },
```

**`register.test.ts`** — inside `"night-audit HTTP routes"`, after `[128]` block (~633–638):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[129]?.id).toBe('get_folio_routing_rules');
    expect(V1_HTTP_ROUTE_AUDIT[129]).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[129] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[130]?.id).toBe('put_folio_routing_rule');
    expect(V1_HTTP_ROUTE_AUDIT[130]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      commandId: 'folio.upsert_routing_rule',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[131]?.id).toBe('post_folio_routing_rule_archive');
    expect(V1_HTTP_ROUTE_AUDIT[131]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      commandId: 'folio.archive_routing_rule',
      entitlement: 'pms.core',
    });
    expect(COMMAND_CATALOG).toHaveLength(79);
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(54);
```

Keep `[127] post_demo_seed`, `[102] post_folio_discount`, `[128] post_folio_stay_discount` assertions unchanged.

**Handlers** — mirror `handleGetChargeCodes` / `handlePostChargeCodes` (~3893+ / ~3747+):

- `handleGetFolioRoutingRules` — `?status=active|archived|all` (default `active`); `folio:read`; degraded read FAIL_CLOSED via route metadata.
- `handlePutFolioRoutingRule` — path `:ruleId`; body `{ chargeCode, destWindowKind, idempotencyKey }`; fingerprint `{ ruleId, chargeCode, destWindowKind }`.
- `handlePostFolioRoutingRuleArchive` — path `:ruleId`; body `{ idempotencyKey }`; fingerprint `{ ruleId }`.

**Append `V1_ROUTES`** (after stay-discount route ~7298):

```typescript
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
    handler: handleGetFolioRoutingRules,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'folio.upsert_routing_rule',
    entitlement: 'pms.core',
    handler: handlePutFolioRoutingRule,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules\/([^/]+)\/archive$/,
    permission: 'settings:configure',
    commandId: 'folio.archive_routing_rule',
    entitlement: 'pms.core',
    handler: handlePostFolioRoutingRuleArchive,
  },
```

- [ ] **Step 1: Write failing HTTP tests**

Append to `describe('folio vertical HTTP routes')` in `folio-routes.spec.ts`:

```typescript
  it('routing PUT upsert → GET list shows rule', async () => {
    const owner = `user_rr_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(owner);
    const ruleId = `rr_${crypto.randomUUID()}`;
    const putRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules/${encodeURIComponent(ruleId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            chargeCode: 'ROOM',
            destWindowKind: 'COMPANY',
            idempotencyKey: `idem-rr-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(putRes.status).toBe(200);
    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules`,
        { headers: { 'x-dev-actor': owner } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { ok: true; rules: Array<{ ruleId: string; chargeCode: string }> };
    expect(body.rules.some((r) => r.ruleId === ruleId && r.chargeCode === 'ROOM')).toBe(true);
  });

  it('routing POST archive removes rule from active GET', async () => {
    const owner = `user_rr_arch_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(owner);
    const ruleId = `rr_${crypto.randomUUID()}`;
    const idem = `idem-rr-arch-${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules/${encodeURIComponent(ruleId)}`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({
                chargeCode: 'MISC',
                destWindowKind: 'MASTER',
                idempotencyKey: idem,
              }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules/${encodeURIComponent(ruleId)}/archive`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({ idempotencyKey: `idem-arch-${crypto.randomUUID()}` }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);
    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules?status=active`,
        { headers: { 'x-dev-actor': owner } },
      ),
      env,
    );
    const body = (await getRes.json()) as { ok: true; rules: Array<{ ruleId: string }> };
    expect(body.rules.some((r) => r.ruleId === ruleId)).toBe(false);
  });

  it('routing PUT/POST archive without settings:configure → 403', async () => {
    const owner = `user_rr_forbid_${crypto.randomUUID()}`;
    const { propertyId, guestRef } = await provisionHotel(owner);
    const readOnly = guestRef; // actor without settings:configure — use a limited dev actor pattern from existing folio-routes forbidden tests
    const ruleId = `rr_${crypto.randomUUID()}`;
    const putRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules/${encodeURIComponent(ruleId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-dev-actor': readOnly },
          body: JSON.stringify({
            chargeCode: 'ROOM',
            destWindowKind: 'COMPANY',
            idempotencyKey: `idem-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(putRes.status).toBe(403);
  });

  it('routing GET without folio:read → 403', async () => {
    const owner = `user_rr_get_forbid_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(owner);
    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/routing-rules`,
        { headers: { 'x-dev-actor': 'user_without_folio_read' } },
      ),
      env,
    );
    expect(getRes.status).toBe(403);
  });
```

Adapt forbidden-actor setup to match an existing `folio-routes.spec.ts` 403 pattern (same helper as charge-code or folio read denial tests).

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "routing "
```

Expected: **FAIL** — 404 route not found.

- [ ] **Step 3: Implement contracts append, handlers, dispatch routes, register pins**

Apply normative blocks. Rebuild contracts.

- [ ] **Step 4: Run HTTP tests + register pin + permissions check**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm check:permissions
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "routing "
```

Expected: **PASS** — `[128]` unmoved; catalog **79**; writers **54**; `[129]–[131]` indices match `V1_ROUTES` tail.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/folio-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): add folio routing-rule HTTP routes

EOF
)"
```

---

### Task 4: Client + Settings SPA RTL

**Spec:** §7 client, Lock 7 SPA, §9 SPA **13**.

**Files:**
- Modify: `packages/client-core/src/api.ts` — after charge-code methods (~1820)
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` — Routing rules section below charge codes (~622+)
- Modify: `apps/web-pms/src/screens/SettingsScreen.test.tsx` — RTL case **13**

**Interfaces:**
- Produces: `listFolioRoutingRules`, `putFolioRoutingRule`, `archiveFolioRoutingRule`; Settings list / add / archive UI.

**Forbidden this commit:** DO/HTTP changes, spec pointers.

**`api.ts`:**

```typescript
    async listFolioRoutingRules(propertyId: string, query?: { status?: 'active' | 'archived' | 'all' }) {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/folio/routing-rules${q ? `?${q}` : ''}`,
      );
      return body as {
        ok: true;
        rules: Array<{ ruleId: string; chargeCode: string; destWindowKind: string; status: string }>;
      };
    },
    async putFolioRoutingRule(
      propertyId: string,
      ruleId: string,
      input: { chargeCode: string; destWindowKind: 'COMPANY' | 'MASTER' },
    ) {
      const idempotencyKey = stableKeyForOperation(`routing-rule:upsert:${ruleId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/folio/routing-rules/${enc(ruleId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async archiveFolioRoutingRule(propertyId: string, ruleId: string) {
      const idempotencyKey = stableKeyForOperation(`routing-rule:archive:${ruleId}`, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/routing-rules/${enc(ruleId)}/archive`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
```

**SettingsScreen.tsx** — under charges tab, after charge-code table:

- Section heading **Routing rules**
- Copy: “Auto-transfer runs at night audit. Destination window must already be open on the stay.”
- List active rules (charge code + dest kind)
- Add form: select charge code from active `listChargeCodes`; dest `COMPANY` | `MASTER`; submit `putFolioRoutingRule` with `ruleId: \`rr_${crypto.randomUUID()}\``
- Per-row Archive → `archiveFolioRoutingRule`

- [ ] **Step 1: Write failing RTL test**

In `SettingsScreen.test.tsx`, add mocks:

```typescript
const listFolioRoutingRules = vi.fn();
const putFolioRoutingRule = vi.fn();
const archiveFolioRoutingRule = vi.fn();
```

Wire in `vi.mock('../client.js')`. Append:

```typescript
  it('13: routing rules add and archive mutate list', async () => {
    listFolioRoutingRules.mockResolvedValue({
      ok: true,
      rules: [{ ruleId: 'rr_1', chargeCode: 'ROOM', destWindowKind: 'COMPANY', status: 'active' }],
    });
    putFolioRoutingRule.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true, ruleId: 'rr_2' } });
    archiveFolioRoutingRule.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true, ruleId: 'rr_1' } });
    renderSettings('/settings/charges');
    expect(await screen.findByText('Routing rules')).toBeTruthy();
    expect(screen.getByText('ROOM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add routing rule/i }));
    await waitFor(() => expect(putFolioRoutingRule).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /archive rr_1/i }));
    await waitFor(() => expect(archiveFolioRoutingRule).toHaveBeenCalledWith('prop_demo', 'rr_1'));
  });
```

Adjust button labels to match implementation `aria-label` / visible text.

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "13:"
```

Expected: **FAIL** — section / mocks missing.

- [ ] **Step 3: Implement client methods + Settings UI + mocks**

Apply normative blocks.

- [ ] **Step 4: Re-run RTL + color check**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "13:"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/SettingsScreen.tsx apps/web-pms/src/screens/SettingsScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): settings UI for folio routing rules

EOF
)"
```

---

### Task 5: Docs, spec ticks, full CI (LAST)

**Spec:** §11 checklist, §10 leftovers pointers, Lock 1 ARCHITECTURE amend, D8 reviewer locks.

**Files:**
- Modify: `ARCHITECTURE.md` — §8 diagram insert `AUTO_TRANSFER`; replace “7-step” / “do not grow `NIGHT_AUDIT_STEPS`” where present in §8 vicinity
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — §4.3 + §19 item **1**
- Modify: `docs/superpowers/specs/2026-08-07-charge-code-registry-design.md` — §6 routing row (~251)
- Modify: `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` — ~430 “Seven steps” → eight
- Modify: `docs/superpowers/specs/2026-08-14-night-audit-auto-transfer-design.md` — tick §11
- Modify: `docs/superpowers/plans/2026-08-14-night-audit-auto-transfer.md` — Task 5 checkboxes (this file)

**Pointer sentences (normative):**

Folio-money §4.3 (~195–199) — replace defer paragraph with:

> **Closed** in [2026-08-14 night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md): `AUTO_TRANSFER` step after `PROCESS_NO_SHOWS`; exact-code `folio_routing_rule` table; reuses `transferFolioLineSync`.

Folio-money §19 item **1** (~796):

> ~~**Night-audit auto-transfer** — needs routing-rules table…~~ **Closed** in [2026-08-14 night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md).

Charge-code §6 routing row (~251):

> ~~Window routing rules table… Auto-transfer still deferred…~~ **Closed** (exact-code rules + night-audit step) in [2026-08-14 night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md). Charge-code **ranges** remain a leftover.

Night-audit-e2e ~430:

> | Timeline | **Eight** steps in `NIGHT_AUDIT_STEPS` order … |

ARCHITECTURE §8 diagram (~1553):

```
IDLE ──▶ PRE_CHECK ──▶ POST_ROOM_CHARGES ──▶ PROCESS_NO_SHOWS ──▶ AUTO_TRANSFER ──▶ CLOSE_CASHIER_SHIFTS
```

- [x] **Step 1: Pin frozen heads + DDL no drift**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|folio_routing_rule"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 8"
```

Expect: catalog **79**; writers **54**; `[127]=post_demo_seed`; `[102]=post_folio_discount`; `[128]=post_folio_stay_discount`; `[129]–[131]` routing rules; `PROPERTY_SCHEMA_HEAD === 28`; `ORG_SCHEMA_HEAD === 7`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 8`.

- [x] **Step 2: Targeted test superset (spec §9)**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts -t "routing_rule"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-auto-transfer.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "28:"
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "routing "
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "13:"
pnpm check:pms-core-test-dates
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

- [x] **Step 4: Apply doc pointers + tick spec §11 checklist**

Tick every item in `docs/superpowers/specs/2026-08-14-night-audit-auto-transfer-design.md` §11.

- [x] **Step 5: Tick Task 5 checkboxes in this plan**

- [x] **Step 6: Commit**

```bash
git add ARCHITECTURE.md \
  docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-07-charge-code-registry-design.md \
  docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md \
  docs/superpowers/specs/2026-08-14-night-audit-auto-transfer-design.md \
  docs/superpowers/plans/2026-08-14-night-audit-auto-transfer.md
git commit -m "$(cat <<'EOF'
docs: close folio-money leftover 1 night-audit auto-transfer

EOF
)"
```

**Stop.** Charge-code ranges, route-to-specific-slug, city ledger / AR, and `night_audit.auto_transfer` catalog command stay deferred per spec §1.3 / §10.

---

## Spec §11 reviewer checklist (Task 5 ticks these in the spec file when CI is green)

| §11 item | Satisfied by |
|---|---|
| v28 + generate:ddl + migrate pin 28; purge | Task 1 |
| Catalog +2; writers 54; event allowlist | Task 2 |
| Append `[129]–[131]`; `[128]`/`[127]`/`[102]` unmoved | Task 3 |
| DO routing CRUD | Task 2 |
| Extract `transferFolioLineSync`; desk wrapper | Task 2 |
| Lock 4 COMPANY query; MASTER `:MASTER` | Task 2 |
| `NIGHT_AUDIT_STEPS` 8; `runAutoTransferSync`; no `night_audit.auto_transfer` | Task 2 |
| ARCHITECTURE §8 | Task 5 |
| client-core + Settings + RTL | Task 4 |
| Tests §9 incl. slugged COMPANY, 0/2 COMPANY skip, step 8 | Tasks 2–5 |
| `register.test.ts` pins | Task 3 + 5 |
| Bidirectional pointers | Task 5 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–8) | 1–5 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–9 | 1–5 |
| §3 night-audit integration | 2 |
| §4 schema v28 | 1 |
| §5 commands / HTTP | 2–3 |
| §6 errors incl. `ROUTING_RULE_CONFLICT` | 2–3 |
| §7 client / SPA | 4 |
| §8 file map | 1–4 |
| §9 tests | 2–5 |
| §10 leftovers named (ranges, slug, AR, no catalog step) | forbidden / Task 5 pointers |
| §11 checklist | 5 |
| Heads table §1.1 | 5 |
| D-locks 1–8 | Open decisions |

**Gaps:** None — all §9 numbered cases and §11 checklist items map to Tasks 1–5.

**Contradictions with spec:** None. Tree verified: catalog **77**, `[128] post_folio_stay_discount` last HTTP audit row, writers **52**, schema **27**, `NIGHT_AUDIT_STEPS` **7**, `tryTransferCharge` reject set ~13078–13087, `tryOpenFolioWindow` slugged COMPANY id ~12061–12066.
