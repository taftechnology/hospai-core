# Night Audit E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four night-audit stubs real, prove the storage-level double-post index, and put `/v1` + SPA in front of the BusinessDate machine.

**Architecture:** Caller-passes-census — PropertyDO never reads `PLATFORM_DB`. PRE_CHECK is sync inside Txn B. SNAPSHOT and ARCHIVE get an async window between Txn A and Txn B. HTTP POST run is Worker get-or-create of `NightAuditWorkflow` (`na-${propertyId}-${businessDate}`). Halt stays derived from any `FAILED` row. Resolve-exception is acknowledge, not replay.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), Platform D1, Workflows, R2 (`EVENT_LOG_R2`), `@hospai/contracts`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` (Approved).

## Global Constraints

- Only `ROLL_BUSINESS_DATE` mutates `__meta.business_date` / the horizon.
- Every step is idempotent per `(business_date, step)`. `COMPLETED` short-circuits before Txn A.
- Halt is derived from any `FAILED` row. Never skip a failed step. Never delete `night_audit_run` rows.
- Double-post of automated room charges is `folio_line_audit_uniq`, proven PK-independent. Tax stays `source = 'TAX'` via `stampTaxForChargeSync`.
- Reports snapshot before the roll; archival after. Sequence order does not change.
- PropertyDO never gains a `PLATFORM_DB` usage. PRE_CHECK without `census` throws `pending_census_required` (no default-to-0).
- `night_audit.run` keeps its permanent entitlement opt-out (alarm). Operator HTTP routes declare `entitlement: 'pms.core'` themselves.
- New commands: INTERACTIVE, FAIL_CLOSED, `pms.core`, `night_audit:run`. `runAuditStep` stays BACKGROUND (no `touchInteractive`).
- Operator `try*` methods `touchInteractive()`. Staff role does not gain `night_audit:run`.
- Fixture dates derive from property-local `business_date` (`check:pms-core-test-dates`). New tests key fixtures with `crypto.randomUUID()`.
- Six new HTTP routes + six `V1_HTTP_ROUTE_AUDIT` rows land in the **same commit**. Catalog is a **prior** commit with no routes (`check:permissions` stays green).
- Census D1 insert **before** queue send. Consumer deletes D1 on terminal (ack) paths only — keep the row on `msg.retry()`.
- Resolve is acknowledge, not retry. PRE_CHECK and badge count only `resolved_at IS NULL`. `closingExceptionCount` is for `businessDate` (date that will close next), never `timelineDate`.
- POST run when `business_date >= today` (property TZ) → 409 `night_audit_not_due`. Halted → 409 `night_audit_halted`.
- Workflow **returns** on FAILED (does not throw). No automatic audit retry. Drain window = consumer uptime + operator retry.
- Census read for the Workflow lives **inside** the PRE_CHECK `step.do` callback so a Workflow retry of that step re-reads D1. Do not checkpoint census as a sibling step (that would freeze the count).
- Living plan checkboxes: tick `- [x]` on the merged task in this file in the same PR. Do not backfill historical plans.
- No either/or forks. Do not reopen caller-passes-census, no-show penalty, POST_ROOM_CHARGES predicate, or ARCHIVE-does-not-DELETE.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Three new commands + events |
| `packages/contracts/src/idempotency.ts` | `PENDING_COMMANDS_UNDRAINED`, `PROVISIONAL_EXCEPTIONS_OPEN`, `PENDING_CENSUS_REQUIRED` |
| `packages/contracts/src/commands/audit-writers.ts` | Three new ids; size **33** |
| `packages/contracts/src/register.test.ts` | Size 33; route pins 86–91 (Task 7 only) |
| `apps/pms-core/src/event-consumer.ts` | Allowlist three new events (Task 1, no routes) |
| `packages/do-runtime/src/platform-migrations.ts` | `pending_command_open` in `PLATFORM_ALL_STATEMENTS` |
| `migrations/d1-platform/0005_pending_command_open.sql` | Generated DDL |
| `packages/do-runtime/src/property-migrations.ts` | v19 ALTERs + `night_audit_report` |
| `migrations/do-property/0019_night_audit_e2e.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | 0005 + 0019 targets |
| `apps/pms-core/src/night-audit-census.ts` | D1 insert / delete / count helpers |
| `apps/pms-core/src/provisional-queue.ts` | Insert-before-send |
| `apps/pms-core/src/pending-commands-consumer.ts` | Delete on terminal |
| `apps/pms-core/src/property-do.ts` | Four bodies; census arg; operator `try*`; status/report reads |
| `apps/pms-core/src/night-audit-workflow.ts` | Census inside PRE_CHECK `step.do` |
| `apps/pms-core/src/night-audit-http.ts` | Get-or-create + instance-status mapping |
| `apps/pms-core/src/v1-dispatch.ts` | Six handlers; GET merges D1 count |
| `packages/contracts/src/v1-http-routes.ts` | Six audit rows 86–91 (Task 7 only) |
| `apps/pms-core/src/event-log.ts` | `reportsPrefixForProperty` / `reportObjectKey` |
| `apps/pms-core/src/purge-workflow.ts` | Reports prefix + `pending_command_open` DELETE |
| `packages/client-core/src/api.ts` | Client methods |
| `apps/web-pms/src/shell/nav.ts` | `/night-audit` order 60 |
| `apps/web-pms/src/screens/NightAuditRoute.tsx` | Permission gate |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | Status / timeline / actions / reports |
| `apps/web-pms/src/screens/ExceptionsPanel.tsx` | Resolve control |
| Specs (event-log R2 + purge) | One-sentence bidirectional amends |

---

### Task 1: Contracts (own commit, no HTTP routes)

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/event-consumer.ts`
- Modify: `apps/pms-core/src/property-do.ts` (quoted command-id constants only — no HTTP, no step bodies)
- Test: `packages/contracts` vitest + `apps/pms-core/test/events-queue.spec.ts`

**Interfaces:**
- Produces: catalog ids `night_audit.retry_step`, `night_audit.resolve_halt`, `provisional.resolve_exception`; events `night_audit.step_retried`, `night_audit.halt_resolved`, `provisional.exception_resolved`; wire codes below; `AUDIT_WRITER_COMMAND_IDS.size === 33`; event-consumer allowlist
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any `/night-audit` or resolve-exception handler. `check:permissions` stays green because audit length still matches dispatcher.

- [x] **Step 1: Write the failing register + idempotency tests**

In `packages/contracts/src/idempotency.ts` the constants do not exist yet. Add to `packages/contracts/src/idempotency.test.ts`:

```ts
import {
  PENDING_CENSUS_REQUIRED,
  PENDING_COMMANDS_UNDRAINED,
  PROVISIONAL_EXCEPTIONS_OPEN,
} from './idempotency.js';

it('night-audit PRE_CHECK wire codes', () => {
  expect(PENDING_CENSUS_REQUIRED).toBe('pending_census_required');
  expect(PENDING_COMMANDS_UNDRAINED).toBe('pending_commands_undrained');
  expect(PROVISIONAL_EXCEPTIONS_OPEN).toBe('provisional_exceptions_open');
});
```

In `packages/contracts/src/register.test.ts`, change the size pin and add a family test:

```ts
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(33);

it('night_audit operator commands are entitled FAIL_CLOSED; run opt-out stays', () => {
  const retry = COMMAND_CATALOG.find((c) => c.id === 'night_audit.retry_step');
  const halt = COMMAND_CATALOG.find((c) => c.id === 'night_audit.resolve_halt');
  const resolve = COMMAND_CATALOG.find((c) => c.id === 'provisional.resolve_exception');
  const run = COMMAND_CATALOG.find((c) => c.id === 'night_audit.run');
  for (const c of [retry, halt, resolve]) {
    expect(c?.lane).toBe('INTERACTIVE');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('night_audit:run');
    expect(c?.idempotent).toBe(true);
  }
  expect(retry?.events).toEqual(['night_audit.step_retried']);
  expect(halt?.events).toEqual(['night_audit.halt_resolved']);
  expect(resolve?.events).toEqual(['provisional.exception_resolved']);
  expect(run?.events).toEqual(['night_audit.started', 'night_audit.completed']);
  expect(run).not.toHaveProperty('entitlement');
  expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === 'night_audit.run')?.reason).toMatch(
    /background alarm path/i,
  );
  expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.retry_step')).toBe(true);
  expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.resolve_halt')).toBe(true);
  expect(AUDIT_WRITER_COMMAND_IDS.has('provisional.resolve_exception')).toBe(true);
  expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.run')).toBe(false);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts`

Expected: FAIL — missing exports / size 30 / missing catalog ids.

- [x] **Step 3: Add wire codes, catalog rows, audit writers, event-consumer cases, PropertyDO id constants**

`packages/contracts/src/idempotency.ts` (with the other wire codes):

```ts
export const PENDING_COMMANDS_UNDRAINED = 'pending_commands_undrained' as const;
export const PROVISIONAL_EXCEPTIONS_OPEN = 'provisional_exceptions_open' as const;
export const PENDING_CENSUS_REQUIRED = 'pending_census_required' as const;
```

`packages/contracts/src/commands/catalog.ts` — insert immediately after the existing `night_audit.run` entry:

```ts
{
  id: 'night_audit.retry_step',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['night_audit.step_retried'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes:
    'Operator retry of a FAILED night-audit step. Does not walk later steps. Stale RUNNING 409s — resolve-halt is the recovery.',
},
{
  id: 'night_audit.resolve_halt',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['night_audit.halt_resolved'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes:
    'Retry FAILED then walk remaining non-COMPLETED steps including stale RUNNING. Never skips. Halt stays derived.',
},
{
  id: 'provisional.resolve_exception',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['provisional.exception_resolved'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes:
    'Acknowledge a provisional_exception (stamp resolved_at). Not a replay of the original command.',
},
```

`packages/contracts/src/commands/audit-writers.ts` — append the three ids to the Set.

In `apps/pms-core/src/property-do.ts`, near the night-audit constants, add quoted literals the wire test greps for (Task 4 uses these in `appendAuditLogSync`):

```ts
export const NIGHT_AUDIT_RETRY_STEP_COMMAND = 'night_audit.retry_step' as const;
export const NIGHT_AUDIT_RESOLVE_HALT_COMMAND = 'night_audit.resolve_halt' as const;
export const PROVISIONAL_RESOLVE_EXCEPTION_COMMAND = 'provisional.resolve_exception' as const;
```

In `apps/pms-core/src/event-consumer.ts`, add to the same fall-through group as `night_audit.completed`:

```ts
case 'night_audit.step_retried':
case 'night_audit.halt_resolved':
case 'provisional.exception_resolved':
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts src/idempotency.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
pnpm check:entitlements
pnpm check:permissions
```

Expected: PASS. `check:permissions` still matches 86 dispatcher routes to 86 audit rows.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts packages/contracts/src/commands/audit-writers.ts packages/contracts/src/register.test.ts apps/pms-core/src/event-consumer.ts apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(contracts): catalog night-audit operator commands

Add retry_step, resolve_halt, and resolve_exception (FAIL_CLOSED,
pms.core) plus PRE_CHECK wire codes. night_audit.run opt-out stays
for the alarm. No HTTP routes this commit.

EOF
)"
```

---

### Task 2: Platform D1 `pending_command_open` + enqueue/delete

**Files:**
- Modify: `packages/do-runtime/src/platform-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts` (re-export `PLATFORM_PENDING_COMMAND_OPEN_SQL`)
- Modify: `scripts/property-ddl.mjs` (0005 target)
- Create: `apps/pms-core/src/night-audit-census.ts`
- Modify: `apps/pms-core/src/provisional-queue.ts`
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Test: `apps/pms-core/test/degraded-mode.spec.ts` (extend) or `apps/pms-core/test/night-audit-census.spec.ts`

**Interfaces:**
- Consumes: Task 1 wire codes (not used here)
- Produces:
  ```ts
  insertPendingOpen(db, row: { propertyId, idempotencyKey, businessDate, commandId }): Promise<void>
  deletePendingOpen(db, propertyId, idempotencyKey): Promise<void>
  countPendingOpen(db, propertyId): Promise<number>
  ```
- `ensurePlatformSchema` applies the new table because it is in `PLATFORM_ALL_STATEMENTS`.

- [x] **Step 1: Write the failing census tests**

Create `apps/pms-core/test/night-audit-census.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { enqueueProvisionalCommand } from '../src/provisional-queue.js';
import { countPendingOpen } from '../src/night-audit-census.js';
import { handlePendingCommandsBatch } from '../src/pending-commands-consumer.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';
import type { PendingCommandMessage } from '@hospai/contracts';

describe('pending_command_open census', () => {
  it('4: enqueue writes D1 then queue; send failure deletes D1', async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_census_${crypto.randomUUID()}`;
    const cmd = {
      idempotencyKey: `idem_${crypto.randomUUID()}`,
      requestFingerprint: 'fp',
      propertyId,
      orgId: 'org_x',
      issuedAt: new Date().toISOString(),
      businessDate: '2026-03-01',
      actor: { userId: 'u1' },
      command: { type: 'folio.add_item', payload: {} },
      routeId: 'post_folio_add_item',
    };

    await enqueueProvisionalCommand(env, cmd);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);

    vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockRejectedValueOnce(new Error('queue down'));
    const cmd2 = { ...cmd, idempotencyKey: `idem_${crypto.randomUUID()}` };
    await expect(enqueueProvisionalCommand(env, cmd2)).rejects.toThrow('queue down');
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);
  });
});
```

If `vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send')` is not configurable on the workerd binding, wrap queue send behind a small injectable rather than fighting the binding. The `'2026-03-01'` literal is fine — `check:pms-core-test-dates` bans machine-local *derivation*, not string literals.

A second test in the same file (test 5) drives `handlePendingCommandsBatch` with a property_not_found message (acked, no DO) and asserts the D1 row is gone. Seed the row with `insertPendingOpen` first.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-census.spec.ts`

Expected: FAIL — `night-audit-census.ts` not found / table missing.

- [x] **Step 3: Schema + helpers + enqueue/delete**

`packages/do-runtime/src/platform-migrations.ts`:

```ts
export const PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS pending_command_open (
  property_id     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  command_id      TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  PRIMARY KEY (property_id, idempotency_key)
)`,
  `CREATE INDEX IF NOT EXISTS pending_command_open_property_idx ON pending_command_open (property_id)`,
];

export const PLATFORM_PENDING_COMMAND_OPEN_SQL =
  PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS.join(';\n\n') + ';\n';
```

Spread into `PLATFORM_ALL_STATEMENTS`:

```ts
export const PLATFORM_ALL_STATEMENTS: string[] = [
  ...PLATFORM_REGISTRY_STATEMENTS,
  ...PLATFORM_ENTITLEMENT_STATEMENTS_ALL,
  ...PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
  ...PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS,
];
```

Re-export `PLATFORM_PENDING_COMMAND_OPEN_SQL` from `packages/do-runtime/src/index.ts`.

`scripts/property-ddl.mjs`: destructure the new SQL constant; add target:

```js
{
  path: join(root, 'migrations/d1-platform/0005_pending_command_open.sql'),
  header: `-- Platform D1 pending-command census for night-audit PRE_CHECK — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Not admission dedupe. INSERT OR IGNORE on (property_id, idempotency_key).

`,
  sql: PLATFORM_PENDING_COMMAND_OPEN_SQL,
},
```

Run `pnpm --filter @hospai/do-runtime build && pnpm generate:ddl`.

`apps/pms-core/src/night-audit-census.ts`:

```ts
export async function insertPendingOpen(
  db: D1Database,
  row: {
    propertyId: string;
    idempotencyKey: string;
    businessDate: string;
    commandId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pending_command_open
         (property_id, idempotency_key, business_date, command_id, enqueued_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(row.propertyId, row.idempotencyKey, row.businessDate, row.commandId, new Date().toISOString())
    .run();
}

export async function deletePendingOpen(
  db: D1Database,
  propertyId: string,
  idempotencyKey: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM pending_command_open WHERE property_id = ? AND idempotency_key = ?`)
    .bind(propertyId, idempotencyKey)
    .run();
}

export async function countPendingOpen(db: D1Database, propertyId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM pending_command_open WHERE property_id = ?`)
    .bind(propertyId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
```

Replace `enqueueProvisionalCommand` body:

```ts
export async function enqueueProvisionalCommand(
  env: PmsEnv,
  cmd: ProvisionalCommand,
  observability?: ObservabilityContext,
): Promise<void> {
  const message: PendingCommandMessage = {
    v: 1,
    provisional: cmd,
    enqueuedAt: new Date().toISOString(),
  };
  await insertPendingOpen(env.PLATFORM_DB, {
    propertyId: cmd.propertyId,
    idempotencyKey: cmd.idempotencyKey,
    businessDate: cmd.businessDate,
    commandId: cmd.command.type,
  });
  try {
    await env.PENDING_COMMANDS_QUEUE.send(message);
  } catch (e) {
    await deletePendingOpen(env.PLATFORM_DB, cmd.propertyId, cmd.idempotencyKey);
    throw e;
  }
  // existing logInfo ...
}
```

In `handlePendingCommandsBatch`, after every `msg.ack()` (property_not_found, tenant_not_active, unknown_command, fingerprint mismatch, applied, already-applied, domain-exception), call `deletePendingOpen`. Do **not** delete on `msg.retry()` (`org_unreachable`, transport failure, replay_error).

- [x] **Step 4: Run tests + ddl check**

Run:

```
pnpm --filter @hospai/do-runtime build
pnpm check:ddl
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-census.spec.ts test/degraded-mode.spec.ts
```

Expected: PASS. Existing degraded-mode enqueue tests still pass (they now also write D1).

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/platform-migrations.ts packages/do-runtime/src/index.ts scripts/property-ddl.mjs migrations/d1-platform/0005_pending_command_open.sql apps/pms-core/src/night-audit-census.ts apps/pms-core/src/provisional-queue.ts apps/pms-core/src/pending-commands-consumer.ts apps/pms-core/test/night-audit-census.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): D1 pending-command census for PRE_CHECK

Insert the census row before queue send and delete it on terminal
consumer acks so night audit can halt on undrained writes.

EOF
)"
```

---

### Task 3: PropertyDO v19 (`resolved_*` + `night_audit_report`)

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `scripts/property-ddl.mjs`
- Test: `packages/do-runtime/src/migrate.test.ts` (schema head advances)

**Interfaces:**
- Produces: `PROPERTY_MIGRATIONS` version 19; `PROPERTY_SCHEMA_HEAD === 19`
- Consumes: nothing from Task 2

- [x] **Step 1: Write the failing schema-head assertion**

In `packages/do-runtime/src/migrate.test.ts` (or `schema-head` coverage already implied by `PROPERTY_SCHEMA_HEAD`), add:

```ts
it('property schema head is 19 after night-audit e2e', () => {
  expect(Math.max(...PROPERTY_MIGRATIONS.map((m) => m.version))).toBe(19);
  const v19 = PROPERTY_MIGRATIONS.find((m) => m.version === 19);
  expect(v19?.name).toBe('night_audit_e2e');
  expect(v19?.statements.some((s) => s.includes('resolved_at'))).toBe(true);
  expect(v19?.statements.some((s) => s.includes('night_audit_report'))).toBe(true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts`

Expected: FAIL — head is 18.

- [x] **Step 3: Add v19 statements + generate DDL**

```ts
export const NIGHT_AUDIT_E2E_V19_STATEMENTS: string[] = [
  `ALTER TABLE provisional_exception ADD COLUMN resolved_at INTEGER`,
  `ALTER TABLE provisional_exception ADD COLUMN resolved_by TEXT`,
  `CREATE TABLE night_audit_report (
  business_date TEXT NOT NULL,
  report_id     TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  generated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, report_id)
)`,
];

export const NIGHT_AUDIT_E2E_V19_SQL = NIGHT_AUDIT_E2E_V19_STATEMENTS.join(';\n\n') + ';\n';
```

Append `{ version: 19, name: 'night_audit_e2e', statements: NIGHT_AUDIT_E2E_V19_STATEMENTS }` to `PROPERTY_MIGRATIONS`.

SQLite `ALTER TABLE ADD COLUMN` is not idempotent. `migrateSql` records version 19 after apply, so a second migrate is a no-op. Do not wrap ALTERs in `IF NOT EXISTS`.

Export `NIGHT_AUDIT_E2E_V19_SQL` from `packages/do-runtime/src/index.ts`. Add `scripts/property-ddl.mjs` target `migrations/do-property/0019_night_audit_e2e.sql`.

Run `pnpm --filter @hospai/do-runtime build && pnpm generate:ddl`.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts && pnpm check:ddl`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/index.ts packages/do-runtime/src/migrate.test.ts scripts/property-ddl.mjs migrations/do-property/0019_night_audit_e2e.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v19 night-audit report index and exception resolve columns

EOF
)"
```

---

### Task 4: PRE_CHECK, census argument, exception resolve, Workflow census

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/night-audit-workflow.ts`
- Modify: `apps/pms-core/test/night-audit.spec.ts` (`startNightAudit` + PRE_CHECK callers)
- Test: `apps/pms-core/test/night-audit-precheck.spec.ts`

**Interfaces:**
- Consumes: `NightAuditCensus` callers; `countPendingOpen` from Task 2; v19 columns from Task 3; command-id constants from Task 1
- Produces:
  ```ts
  export type NightAuditCensus = { pendingOpenCount: number };

  runAuditStep(businessDate: string, step: NightAuditStep, census?: NightAuditCensus)
    : Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string }>

  startNightAudit(census: NightAuditCensus)
    : Promise<{ ok: true } | { ok: false; error: string }>

  tryResolveProvisionalException(actor, { exceptionId }, idem)
    : Promise<
        | { ok: true; alreadyResolved?: true }
        | { ok: false; error: typeof NOT_FOUND | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
      >

  tryRetryAuditStep(actor, { businessDate, step }, idem, census: NightAuditCensus)
  tryResolveHalt(actor, { businessDate }, idem, census: NightAuditCensus)
  ```
- `listProvisionalExceptions` / `countProvisionalExceptions` default to `resolved_at IS NULL`. Payload gains `resolvedAt` / `resolvedBy` (null on open rows).

- [x] **Step 1: Write the failing PRE_CHECK / resolve tests**

Create `apps/pms-core/test/night-audit-precheck.spec.ts`. Use `provisionedPropertyStub` + `crypto.randomUUID()`. `EMPTY_CENSUS = { pendingOpenCount: 0 }`.

```ts
it('1: empty pending + no open exceptions → COMPLETED; omitted census → FAILED pending_census_required', async () => {
  const { stub } = await provisionedPropertyStub(`na-pc-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  const ok = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 });
  expect(ok.status).toBe('COMPLETED');
  expect(await stub.readBusinessDate()).toBe(d);
  const missing = await stub.runAuditStep(d, 'POST_ROOM_CHARGES'); // census ignored
  // PRE_CHECK without census:
  const { stub: stub2 } = await provisionedPropertyStub(`na-pc2-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d2 = (await stub2.readBusinessDate())!;
  const fail = await stub2.runAuditStep(d2, 'PRE_CHECK');
  expect(fail.status).toBe('FAILED');
  expect(fail.error).toMatch(/pending_census_required/);
  expect(await stub2.isNightAuditHalted()).toBe(true);
});

it('2: pendingOpenCount 1 → FAILED pending_commands_undrained, halt, no roll', async () => {
  const { stub } = await provisionedPropertyStub(`na-pc-undrained-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  const fail = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 1 });
  expect(fail.status).toBe('FAILED');
  expect(fail.error).toMatch(/pending_commands_undrained/);
  expect(await stub.isNightAuditHalted()).toBe(true);
  expect(await stub.readBusinessDate()).toBe(d);
});

it('3: closing-date open exception → FAILED; other-date open → COMPLETED; resolved closing-date → COMPLETED', async () => {
  const { stub } = await provisionedPropertyStub(`na-pc-ex-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  const other = addDays(d, -1);
  await stub.recordProvisionalException(
    {
      idempotencyKey: `idem_${crypto.randomUUID()}`,
      requestFingerprint: 'fp',
      propertyId: 'p',
      orgId: 'o',
      issuedAt: new Date().toISOString(),
      businessDate: d,
      actor: { userId: 'u1' },
      command: { type: 'folio.add_item', payload: {} },
      routeId: 'post_folio_add_item',
    },
    'domain_error',
    null,
  );
  const fail = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 });
  expect(fail.status).toBe('FAILED');
  expect(fail.error).toMatch(/provisional_exceptions_open/);

  const { stub: stubOther } = await provisionedPropertyStub(`na-pc-ex-o-${crypto.randomUUID()}`, 'UTC', 'USD');
  const dOther = (await stubOther.readBusinessDate())!;
  await stubOther.recordProvisionalException(
    {
      idempotencyKey: `idem_${crypto.randomUUID()}`,
      requestFingerprint: 'fp',
      propertyId: 'p',
      orgId: 'o',
      issuedAt: new Date().toISOString(),
      businessDate: addDays(dOther, -1),
      actor: { userId: 'u1' },
      command: { type: 'folio.add_item', payload: {} },
      routeId: 'post_folio_add_item',
    },
    'domain_error',
    null,
  );
  const okOther = await stubOther.runAuditStep(dOther, 'PRE_CHECK', { pendingOpenCount: 0 });
  expect(okOther.status).toBe('COMPLETED');
});

it('6: missed PRE_CHECK — force roll then replay closed-date provisional → exception, zero folio mutation', async () => {
  // runAuditStep(d, 'ROLL_BUSINESS_DATE') with census omitted (ignored).
  // Then enqueue a folio.add_item provisional with businessDate = closed D.
  // Drive consumer. Assert provisional_exception reason business_date_closed and folio line count 0.
});
```

Also tests for `tryResolveProvisionalException`: success stamps columns + audit + outbox; second call `{ alreadyResolved: true }`; missing → `not_found`. `countProvisionalExceptions` drops to 0 after resolve.

Update existing `night-audit.spec.ts` callers now, in the same failing-test step, so they compile against the new `startNightAudit(census)` signature:

- `startNightAudit()` → `startNightAudit({ pendingOpenCount: 0 })`
- `runAuditStep(startDate, 'PRE_CHECK')` (the COMPLETED path in test 11) → pass `{ pendingOpenCount: 0 }`

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-precheck.spec.ts test/night-audit.spec.ts`

Expected: FAIL — PRE_CHECK still a stub / census ignored / `startNightAudit` arity.

- [x] **Step 3: Implement PRE_CHECK, resolve, retry, resolve-halt, Workflow census**

Error classes next to `RateMissingError`:

```ts
class PendingCensusRequiredError extends Error {
  constructor() {
    super(PENDING_CENSUS_REQUIRED);
    this.name = 'PendingCensusRequiredError';
  }
}
class PendingCommandsUndrainedError extends Error {
  constructor() {
    super(PENDING_COMMANDS_UNDRAINED);
    this.name = 'PendingCommandsUndrainedError';
  }
}
class ProvisionalExceptionsOpenError extends Error {
  constructor() {
    super(PROVISIONAL_EXCEPTIONS_OPEN);
    this.name = 'ProvisionalExceptionsOpenError';
  }
}
```

`runAuditStep` signature gains optional `census?: NightAuditCensus`. Inside Txn B, before the existing step switch:

```ts
if (step === 'PRE_CHECK') {
  this.runPreCheckSync(businessDate, census);
}
```

```ts
private runPreCheckSync(businessDate: string, census?: NightAuditCensus): void {
  if (census === undefined) throw new PendingCensusRequiredError();
  if (census.pendingOpenCount > 0) throw new PendingCommandsUndrainedError();
  const open = this.ctx.storage.sql
    .exec(
      `SELECT 1 AS one FROM provisional_exception
       WHERE business_date = ? AND resolved_at IS NULL LIMIT 1`,
      businessDate,
    )
    .toArray();
  if (open.length > 0) throw new ProvisionalExceptionsOpenError();
}
```

`startNightAudit(census: NightAuditCensus)`: pass `census` into `runAuditStep` when `step === 'PRE_CHECK'`, omit otherwise.

`listProvisionalExceptions` / `countProvisionalExceptions`: add `WHERE resolved_at IS NULL`. SELECT the new columns; map `resolvedAt` / `resolvedBy` (null on open rows).

`tryResolveProvisionalException`: `assertRpcAvailable`; `touchInteractive`; `gatePermission(actor, 'night_audit:run')`; `gateCoreEntitlement`; `runIdempotent` fingerprint `{ propertyId, exceptionId }`. Missing row → `{ ok: false, error: NOT_FOUND }`. If `resolved_at` already set → `{ ok: true, alreadyResolved: true }` (no second audit row). Else UPDATE `resolved_at = now`, `resolved_by = actor.userId`; `appendAuditLogSync` with `commandId: PROVISIONAL_RESOLVE_EXCEPTION_COMMAND`; outbox `provisional.exception_resolved` `{ propertyId, exceptionId, businessDate }`.

`tryRetryAuditStep`: interactive + permission + entitlement. Load the row. If missing or status !== `'FAILED'` → `{ ok: false, error: 'night_audit_step_not_failed' }`. Else `runAuditStep(businessDate, step, census)` (always pass census; ignored except PRE_CHECK). Outbox `night_audit.step_retried` `{ propertyId, businessDate, step, attempt }` (read `attempt` after the run). Audit with `NIGHT_AUDIT_RETRY_STEP_COMMAND`.

`tryResolveHalt`: interactive + permission + entitlement. If a FAILED row exists for that date, `runAuditStep` it first (pass census). If still FAILED → return `{ ok: true, status: 'FAILED', error, halted: true }` (no `night_audit.halt_resolved`). If no FAILED remains: walk `NIGHT_AUDIT_STEPS` in order, skip `COMPLETED`, call `runAuditStep` for each remaining (including `RUNNING`), passing census when the step is `PRE_CHECK`. After the walk, if `!isNightAuditHalted()` and no row for that date is `RUNNING`, emit `night_audit.halt_resolved` `{ propertyId, businessDate }` and audit with `NIGHT_AUDIT_RESOLVE_HALT_COMMAND`. Never delete rows.

Test helper (unsafe-local):

```ts
async seedNightAuditRunForTest(businessDate: string, step: NightAuditStep, status: 'RUNNING' | 'FAILED' | 'COMPLETED'): Promise<void>
```

`night-audit-workflow.ts` — inside the existing per-step `step.do(auditStep, ...)`, when `auditStep === 'PRE_CHECK'`, read D1 **in that callback**:

```ts
const { status } = await step.do(auditStep, async () => {
  const census =
    auditStep === 'PRE_CHECK'
      ? { pendingOpenCount: await countPendingOpen(this.env.PLATFORM_DB, propertyId) }
      : undefined;
  const result = await stub.runAuditStep(businessDate, auditStep, census);
  return { status: result.status };
});
```

Do not add a sibling `step.do('census')` — a Workflow retry of PRE_CHECK must re-read D1.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-precheck.spec.ts test/night-audit.spec.ts`

Expected: PASS. Existing full-pass tests still COMPLETE PRE_CHECK because they now pass census 0.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/night-audit-workflow.ts apps/pms-core/test/night-audit.spec.ts apps/pms-core/test/night-audit-precheck.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): real PRE_CHECK with caller-passes-census

Halt on undrained pending commands or open closing-date exceptions.
Resolve-exception is acknowledge-only. Workflow re-reads D1 on PRE_CHECK retry.

EOF
)"
```

---

### Task 5: `PROCESS_NO_SHOWS`

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Test: `apps/pms-core/test/night-audit-no-shows.spec.ts`

**Interfaces:**
- Consumes: `runAuditStep` from Task 4; `readConfigValueSync('pms.night_audit.auto_no_show')` (default `true` from the register)
- Produces: `processNoShowsSync(businessDate: string): void` — sync, inside Txn B. Does **not** call `tryNoShow`. Zero new `folio_line` rows. Actor `system:night_audit`, `command_id: 'night_audit.run'`.

- [x] **Step 1: Write the failing tests**

```ts
it('7: confirmed arrival_date = D → no_show, sold released, status_changed + availability.changed, no new folio_line', async () => {
  // seed room type + rate + insertReservationForTest confirmed covering D.
  // Manually bump availability_day.sold to 1 (insertReservationForTest bypasses accounting).
  await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
  const res = await stub.readReservation('res_ns');
  expect(res.ok && res.reservation.status).toBe('no_show');
  expect(await stub.countFolioLines()).toBe(0);
});

it('8: auto_no_show = false → still confirmed, COMPLETED', async () => {
  const { stub } = await provisionedPropertyStub(`na-ns-off-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  await stub.tryPutDomainConfig(
    TEST_OWNER_ACTOR,
    'pms.night_audit.auto_no_show',
    false,
    { reason: 'test' },
    await idemFor('cfg-ns-off', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
  );
  await seedRoomType(stub, 'rt_a', 'RTA');
  await stub.insertReservationForTest({
    reservationId: 'res_ns_off',
    roomTypeId: 'rt_a',
    guestRef: 'g1',
    piiKeyId: 'p1',
    arrivalDate: d,
    departureDate: addDays(d, 2),
    status: 'confirmed',
  });
  const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
  expect(result.status).toBe('COMPLETED');
  const res = await stub.readReservation('res_ns_off');
  expect(res.ok && res.reservation.status).toBe('confirmed');
});

it('9: already checked_in → untouched', async () => {
  const { stub } = await provisionedPropertyStub(`na-ns-ci-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  await seedRoomType(stub, 'rt_a', 'RTA');
  await stub.insertReservationForTest({
    reservationId: 'res_ci',
    roomTypeId: 'rt_a',
    guestRef: 'g1',
    piiKeyId: 'p1',
    arrivalDate: d,
    departureDate: addDays(d, 2),
    status: 'checked_in',
  });
  await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
  const res = await stub.readReservation('res_ci');
  expect(res.ok && res.reservation.status).toBe('checked_in');
});

it('10: leftover confirmed arrival_date < D → also no_show', async () => {
  const { stub } = await provisionedPropertyStub(`na-ns-left-${crypto.randomUUID()}`, 'UTC', 'USD');
  const d = (await stub.readBusinessDate())!;
  await seedRoomType(stub, 'rt_a', 'RTA');
  await stub.insertReservationForTest({
    reservationId: 'res_left',
    roomTypeId: 'rt_a',
    guestRef: 'g1',
    piiKeyId: 'p1',
    arrivalDate: addDays(d, -2),
    departureDate: addDays(d, 1),
    status: 'confirmed',
  });
  for (const stayDate of enumerateStayDates(addDays(d, -2), addDays(d, 1))) {
    await stub.bumpSoldForTest('rt_a', stayDate, 1);
  }
  await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
  const res = await stub.readReservation('res_left');
  expect(res.ok && res.reservation.status).toBe('no_show');
});
```

Dates: `arrivalDate` / `departureDate` derived from `readBusinessDate()`, never machine-local literals.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-no-shows.spec.ts`

Expected: FAIL — step still a stub, status stays `confirmed`.

- [x] **Step 3: Implement `processNoShowsSync`**

Call from Txn B: `else if (step === 'PROCESS_NO_SHOWS') this.processNoShowsSync(businessDate);`

```ts
private processNoShowsSync(businessDate: string): void {
  const auto = this.readConfigValueSync('pms.night_audit.auto_no_show');
  if (auto === false) return;

  const propertyId = this.getPropertyIdSync();
  if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

  const rows = this.ctx.storage.sql
    .exec(
      `SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date
       FROM reservation
       WHERE status = 'confirmed' AND arrival_date <= ?`,
      businessDate,
    )
    .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      pii_key_id: string;
      arrival_date: string;
      departure_date: string;
    }>;

  const now = Date.now();
  for (const reservation of rows) {
    const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
    for (const stayDate of nights) {
      const soldRows = this.ctx.storage.sql
        .exec(
          `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
          reservation.room_type_id,
          stayDate,
        )
        .toArray() as Array<{ sold: number }>;
      if (soldRows.length === 0 || soldRows[0]!.sold < 1) {
        throw new LedgerInconsistentError(stayDate);
      }
    }
    for (const stayDate of nights) {
      this.ctx.storage.sql.exec(
        `UPDATE availability_day SET sold = sold - 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
        reservation.room_type_id,
        stayDate,
      );
    }
    this.ctx.storage.sql.exec(
      `UPDATE reservation SET status = 'no_show', updated_at = ? WHERE reservation_id = ?`,
      now,
      reservation.reservation_id,
    );
    const ariVersion = this.bumpAriVersionSync();
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'reservation.status_changed',
      payload: {
        propertyId,
        reservationId: reservation.reservation_id,
        guestRef: reservation.guest_ref,
        piiKeyId: reservation.pii_key_id,
        fromStatus: 'confirmed',
        toStatus: 'no_show',
      },
    });
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'availability.changed',
      payload: {
        propertyId,
        roomTypeId: reservation.room_type_id,
        fromDate: nights[0]!,
        toDate: nights[nights.length - 1]!,
        version: ariVersion,
      },
    });
    this.appendAuditLogSync({
      actor: 'system:night_audit',
      commandId: 'night_audit.run',
      entityType: 'reservation',
      entityId: reservation.reservation_id,
      beforeJson: { status: 'confirmed', roomTypeId: reservation.room_type_id },
      afterJson: { status: 'no_show', roomTypeId: reservation.room_type_id },
      reservationId: reservation.reservation_id,
    });
  }
}
```

Copy inventory-release from `tryNoShow`. Do not post folio lines. Do not call `tryNoShow`.

Unsafe-local helper used by tests 7 and 10 (`insertReservationForTest` bypasses availability accounting). **Must be an upsert, not `UPDATE`:** a freshly provisioned property only has `availability_day` rows from D forward (`reconcileHorizon` is insert-only). Test 10’s leftover confirmed stay has `arrivalDate = D-2`; an `UPDATE` touches zero past-dated rows and the body’s missing-row `LedgerInconsistentError` then fails the test *because* the production guard is correct. Production would already have those rows from living through D-2/D-1. The helper creates them.

```ts
async bumpSoldForTest(roomTypeId: string, stayDate: string, delta: number): Promise<void> {
  this.assertUnsafeLocal('bumpSoldForTest');
  const rt = this.ctx.storage.sql
    .exec(`SELECT room_count FROM room_type WHERE room_type_id = ?`, roomTypeId)
    .toArray() as Array<{ room_count: number }>;
  const physical = rt[0]?.room_count ?? 0;
  const oversell = this.materializedOversellAllowanceSync();
  this.ctx.storage.sql.exec(
    `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
     VALUES (?, ?, ?, 0, 0, ?, ?, 1)
     ON CONFLICT(room_type_id, stay_date) DO UPDATE SET
       sold = availability_day.sold + excluded.sold,
       version = availability_day.version + 1`,
    roomTypeId,
    stayDate,
    physical,
    delta,
    oversell,
  );
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-no-shows.spec.ts test/night-audit-room-charges.spec.ts`

Expected: PASS. Room-charges tests still post ROOM for `confirmed` (predicate unchanged).

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/night-audit-no-shows.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): PROCESS_NO_SHOWS status and inventory, no penalty

EOF
)"
```

---

### Task 6: SNAPSHOT_REPORTS, ARCHIVE, async window, double-post proof

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/event-log.ts` (`reportObjectKey`, `reportsPrefixForProperty`)
- Test: `apps/pms-core/test/night-audit-reports.spec.ts`
- Test: `apps/pms-core/test/night-audit-double-post.spec.ts`

**Interfaces:**
- Consumes: `flushOutboxToQueue`; `EVENT_LOG_R2`; v19 `night_audit_report`
- Produces: async window in `runAuditStep` **only** for `SNAPSHOT_REPORTS` and `ARCHIVE`. Index rows written in Txn B. Unbound R2 → throw `reports_r2_unbound` (message contains that token).

```ts
export function reportsPrefixForProperty(propertyId: string): string {
  return `reports/property/${propertyId}/`;
}
export function reportObjectKey(propertyId: string, businessDate: string, reportId: string): string {
  return `reports/property/${propertyId}/${businessDate}/${reportId}.json`;
}
```

- [x] **Step 1: Write the failing tests**

`night-audit-reports.spec.ts`:

```ts
it('11: snapshot writes three R2 objects + index; occupancy counts as of snapshot time', async () => { /* POST_ROOM_CHARGES + PROCESS_NO_SHOWS + CLOSE then SNAPSHOT; get R2 JSON */ });

it('12: unbound EVENT_LOG_R2 → SNAPSHOT FAILED reports_r2_unbound', async () => {
  // setReportsR2UnboundForTest(true) then runAuditStep SNAPSHOT
});

it('13: ARCHIVE flushes outbox and writes manifest; night_audit.completed still on ARCHIVE COMPLETED', async () => { /* ... */ });

it('14: COMPLETED snapshot re-run performs no R2 write; index stays 1. Overwrite = retry after put-before-index failure', async () => {
  await stub.runAuditStep(d, 'SNAPSHOT_REPORTS');
  const putsBefore = await stub.countReportPutsForTest(); // or list R2 keys
  await stub.runAuditStep(d, 'SNAPSHOT_REPORTS');
  expect(await stub.getNightAuditStepStatus(d, 'SNAPSHOT_REPORTS')).toBe('COMPLETED');
  // index count 1 per reportId; put count unchanged (short-circuit)

  await stub.setSnapshotFailureAfterPutForTest('index_fault');
  // Need a different date or reset the COMPLETED row — use a fresh property.
  // First attempt: puts succeed, Txn B throws → FAILED, no index rows.
  // Disarm. Retry: overwrites same keys, index count 1.
});
```

`night-audit-double-post.spec.ts`:

```ts
it('15: second NIGHT_AUDIT/ROOM insert with different folio_line_id hits folio_line_audit_uniq', async () => {
  // seed reservation + folio window + first insertFolioLineRawForTest id 'a'
  // second insert id 'b' same (reservation, date, ROOM, NIGHT_AUDIT) → throws unique
});

it('16: night-audit ROOM + applicable tax rule → TAX line; COMPLETED retry does not duplicate tax', async () => {
  // seed tax rule PERCENTAGE on ROOM group; run POST_ROOM_CHARGES twice (second COMPLETED)
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-reports.spec.ts test/night-audit-double-post.spec.ts`

Expected: FAIL.

- [x] **Step 3: Async window + bodies + test helpers**

Reshape `runAuditStep` after Txn A:

```ts
try {
  if (step === 'SNAPSHOT_REPORTS') {
    await this.snapshotReportsAsync(businessDate);
  } else if (step === 'ARCHIVE') {
    await this.archiveAsync(businessDate);
  }

  return this.ctx.storage.transactionSync(() => {
    if (step === 'ROLL_BUSINESS_DATE') this.runRollStepSync(businessDate);
    else if (step === 'POST_ROOM_CHARGES') this.postRoomChargesSync(businessDate);
    else if (step === 'CLOSE_CASHIER_SHIFTS') this.forceCloseCashierShiftsSync(businessDate);
    else if (step === 'PRE_CHECK') this.runPreCheckSync(businessDate, census);
    else if (step === 'PROCESS_NO_SHOWS') this.processNoShowsSync(businessDate);
    else if (step === 'SNAPSHOT_REPORTS') this.indexReportPutsSync(businessDate);
    else if (step === 'ARCHIVE') this.indexManifestSync(businessDate);

    // existing COMPLETED update + night_audit.completed on ARCHIVE
  });
} catch (e) { /* existing Txn C FAILED */ }
```

Keep PRE_CHECK / money / no-shows / close / roll **inside** Txn B. Snapshot JSON generation + `R2.put` happen in `snapshotReportsAsync` (store pending puts on `this.pendingReportPuts` for the subsequent Txn B index write). Key that field by `businessDate` (or leave a comment stating the single-flight assumption): a Workflow retry and an operator retry of SNAPSHOT can interleave; the outcome is benign (deterministic keys + `INSERT OR REPLACE`). If `setSnapshotFailureAfterPutForTest` is set, throw after puts and before return so Txn B never runs.

`snapshotReportsAsync`:
1. If `this.reportsR2UnboundForTest` or `!this.env.EVENT_LOG_R2` → throw `new Error('reports_r2_unbound')`.
2. Build occupancy / revenue / cashier JSON in memory (no PII).
3. `put` three objects at `reportObjectKey(propertyId, businessDate, reportId)`.
4. Remember `{ reportId, r2Key, sha256, generatedAt }` on an instance field for Txn B.

Occupancy SQL (closing date `D`, after no-shows):

- `physical` / `sold` / `blocked` / `held`: `SELECT SUM(...) FROM availability_day WHERE stay_date = D` joined to active room types (same “active” predicate the inventory reads use).
- `inHouseCount`: `COUNT(*) FROM reservation WHERE status = 'checked_in'`.
- `confirmedCount`: `COUNT(*) FROM reservation WHERE status = 'confirmed' AND arrival_date <= D AND departure_date > D`.
- `noShowCount`: `COUNT(*) FROM reservation WHERE status = 'no_show' AND arrival_date <= D`.

Revenue: `SELECT charge_code, source, SUM(ledger_amount_minor) FROM folio_line WHERE business_date = D GROUP BY charge_code, source`. Include `roomNet` = ROOM / NIGHT_AUDIT sum; `taxTotal` = `source = 'TAX'`; `currency` from ledger.

Cashier: every `shift` with `business_date = D` (`shiftId`, `cashierUserId`, `status`, `openingFloat`, `closingCount`, `variance`). `unattributedCashCount` **once** at report level via the existing unattributed-cash helper, not per shift.

`archiveAsync`:
1. Same unbound-R2 fail.
2. `await this.flushOutboxToQueue()`.
3. Put `manifest.json`: `{ businessDate, rolledTo: readBusinessDateSync(), reportKeys: [...], outboxFlushedAt, archivedAt }`.
4. Remember pending manifest index row (`report_id = 'manifest'`).

`indexReportPutsSync` / `indexManifestSync`: `INSERT OR REPLACE INTO night_audit_report` (retry overwrite). Clear the pending field.

Helpers (unsafe-local): `setReportsR2UnboundForTest`, `setSnapshotFailureAfterPutForTest`, `insertFolioLineRawForTest` (custom `folio_line_id` + `source`).

SHA-256: `crypto.subtle.digest('SHA-256', encoded)` → hex.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-reports.spec.ts test/night-audit-double-post.spec.ts test/night-audit.spec.ts test/night-audit-room-charges.spec.ts test/tax-posting.spec.ts`

Expected: PASS. Test 14 proves short-circuit (no second put) and overwrite-on-retry-after-put.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/event-log.ts apps/pms-core/test/night-audit-reports.spec.ts apps/pms-core/test/night-audit-double-post.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): night-audit snapshot reports and archive manifest

OLTP close-out JSON on EVENT_LOG_R2 with a SQLite index. COMPLETED
short-circuit does not rewrite R2; retry after put-before-index does.

EOF
)"
```

---

### Task 7: HTTP routes 86–91 (same commit as audit rows)

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Create: `apps/pms-core/src/night-audit-http.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/src/property-do.ts` (`readNightAuditStatus`, `readNightAuditReportIndex`, `tryStartNightAudit`)
- Test: `apps/pms-core/test/night-audit-routes.spec.ts`

**Interfaces:**
- Consumes: Task 4 `try*` + census; Task 2 `countPendingOpen`; Task 6 report index + R2
- Produces: `V1_HTTP_ROUTE_AUDIT[86] = get_night_audit` … `[91] = post_provisional_exception_resolve`. `[85]` stays `post_roster_exit`. Append only.

- [x] **Step 1: Write the failing route-audit + HTTP tests**

`register.test.ts`:

```ts
it('night-audit HTTP routes append at 86–91', () => {
  expect(V1_HTTP_ROUTE_AUDIT[85]?.id).toBe('post_roster_exit');
  expect(V1_HTTP_ROUTE_AUDIT[86]?.id).toBe('get_night_audit');
  expect(V1_HTTP_ROUTE_AUDIT[87]?.id).toBe('get_night_audit_report');
  expect(V1_HTTP_ROUTE_AUDIT[88]?.id).toBe('post_night_audit_run');
  expect(V1_HTTP_ROUTE_AUDIT[89]?.id).toBe('post_night_audit_retry');
  expect(V1_HTTP_ROUTE_AUDIT[90]?.id).toBe('post_night_audit_resolve_halt');
  expect(V1_HTTP_ROUTE_AUDIT[91]?.id).toBe('post_provisional_exception_resolve');
  expect(V1_HTTP_ROUTE_AUDIT[86]).toMatchObject({
    scope: 'property',
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  });
  expect('commandId' in (V1_HTTP_ROUTE_AUDIT[86] ?? {})).toBe(false);
  expect(V1_HTTP_ROUTE_AUDIT[88]).toMatchObject({
    commandId: 'night_audit.run',
    entitlement: 'pms.core',
    permission: 'night_audit:run',
  });
  expect(V1_HTTP_ROUTE_AUDIT[91]).toMatchObject({
    commandId: 'provisional.resolve_exception',
    entitlement: 'pms.core',
  });
});
```

`night-audit-routes.spec.ts` (follow `roster-routes.spec.ts`: `ensurePlatformSchema`, provision property, owner vs staff actor, `setKillSwitch`):

- 17: GET status — `businessDate`, seven-step array, `halted: false`, `pendingOpenCount: 0`, `closingExceptionCount: 0` on a fresh property. `timelineDate === businessDate` (no rows → all PENDING for current date).
- 18: POST run → 202 `{ workflowId: 'na-${propertyId}-${businessDate}' }`. Second POST same date → 202 **same** `workflowId` (get-or-create). Complete instance → 200 `{ instanceStatus: 'complete' }` (drive via `mapNightAuditInstanceHttp` unit cases + a stubbed `get()`). `business_date >= today` → 409 `night_audit_not_due`.
- 19: `forceNightAuditHaltForTest` → GET `halted: true`; POST run → 409 `night_audit_halted`.
- 20: POST retry of COMPLETED or seeded RUNNING → 409 `night_audit_step_not_failed`. Resolve-halt on stale RUNNING PRE_CHECK with census 0 → COMPLETED and walk continues.
- 21: Seed D1 pending row → PRE_CHECK FAILED via retry/runAuditStep; POST run 409. Delete D1. POST retry PRE_CHECK with count 0 → COMPLETED. POST resolve-halt → ARCHIVE COMPLETED, `halted: false`, date advanced if due.
- 21b: Insert closing-date exception → PRE_CHECK FAILED. POST resolve-exception → `resolved_at` set, count 0. POST retry PRE_CHECK → COMPLETED. Second resolve → 200 `alreadyResolved`.
- 22: staff actor without `night_audit:run` → 403; kill-switch `pms.core` → 402 on operator POSTs (not on alarm; this is HTTP).
- 23: GET night-audit with transport failure → 503 `degradedFailClosedReadResponse` (`check:do-transport-guards` greps the handler).

Also unit-test `mapNightAuditInstanceHttp` in the same file (or `night-audit-http.test.ts`):

| instance status | HTTP |
|---|---|
| queued / running / waiting / paused | 202 `{ instanceStatus }` |
| complete | 200 `{ instanceStatus: 'complete' }` |
| errored / terminated | 409 `{ error: 'night_audit_workflow_exists', instanceStatus }` |

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts` and the routes spec.

Expected: FAIL — audit length 86, handlers missing.

- [x] **Step 3: Implement helpers, DO reads, handlers, both route tables**

`apps/pms-core/src/night-audit-http.ts`:

```ts
export function nightAuditWorkflowId(propertyId: string, businessDate: string): string {
  return `na-${propertyId}-${businessDate}`;
}

export type NightAuditInstanceStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete';

export function mapNightAuditInstanceHttp(
  workflowId: string,
  businessDate: string,
  instanceStatus: string,
): { status: number; body: Record<string, unknown> } {
  const live = new Set(['queued', 'running', 'waiting', 'paused']);
  if (live.has(instanceStatus)) {
    return { status: 202, body: { workflowId, businessDate, instanceStatus } };
  }
  if (instanceStatus === 'complete') {
    return { status: 200, body: { workflowId, businessDate, instanceStatus: 'complete' } };
  }
  return {
    status: 409,
    body: { error: 'night_audit_workflow_exists', instanceStatus },
  };
}

export async function getOrCreateNightAuditWorkflow(
  workflow: Workflow<{ propertyId: string }>,
  propertyId: string,
  businessDate: string,
): Promise<{ workflowId: string; instanceStatus: string; created: boolean }> {
  const id = nightAuditWorkflowId(propertyId, businessDate);
  try {
    const instance = await workflow.create({ id, params: { propertyId } });
    const st = await instance.status();
    return { workflowId: id, instanceStatus: st.status, created: true };
  } catch {
    const instance = await workflow.get(id);
    const st = await instance.status();
    return { workflowId: id, instanceStatus: st.status, created: false };
  }
}
```

`readNightAuditStatus` (plain read, no `touchInteractive`):

- `businessDate` = `__meta.business_date`.
- `timelineDate`: if any `night_audit_run` rows exist for `businessDate`, use it; else `max(business_date)` among rows; else `businessDate` (all seven PENDING).
- `halted` = `isNightAuditHalted()`.
- `closingExceptionCount` = `COUNT(*) FROM provisional_exception WHERE business_date = ? AND resolved_at IS NULL` bound to **`businessDate`**, never `timelineDate`.
- `steps`: for each `NIGHT_AUDIT_STEPS` on `timelineDate`, missing row → `{ status: 'PENDING', attempt: 0, startedAt: null, completedAt: null, error: null }`.
- `reports`: index rows `{ reportId, businessDate, generatedAt }`.

Do **not** return `pendingOpenCount` from the DO. Handler merges it.

`tryStartNightAudit`: interactive + `night_audit:run` + entitlement. If halted → `{ ok: false, error: NIGHT_AUDIT_HALTED }`. If `businessDate >= today` (property TZ, same `enumerateHorizonDates` as roll) → `{ ok: false, error: 'night_audit_not_due' }`. Else audit `night_audit.run` and return `{ ok: true, businessDate }`. Does **not** create the Workflow and does **not** call `runAuditStep`.

Handlers (append to `V1_ROUTES` in this exact order, matching audit ids):

1. `GET /v1/properties/:propertyId/night-audit` — `handleGetNightAudit`: `resolvePropertyContext`; `stub.readNightAuditStatus()` in try/catch `isPropertyDoTransportFailure` → `degradedFailClosedReadResponse()`; `countPendingOpen(ctx.env.PLATFORM_DB, propertyId)`; `json({ ...status, pendingOpenCount }, 200)`.
2. `GET .../night-audit/reports/:businessDate/:reportId` — DO index; 404 if missing; `EVENT_LOG_R2.get(r2Key)`; 404 if missing object; return JSON. Transport → 503.
3. `POST .../night-audit/run` — body `{ idempotencyKey }`. Fingerprint `{ propertyId, businessDate }` (read date first). `invokePropertyDo` around `tryStartNightAudit`. Map `night_audit_halted` / `night_audit_not_due` → 409. On ok: `getOrCreateNightAuditWorkflow`. If `created` → 202 queued. Else `mapNightAuditInstanceHttp`. If mapping is 409 `night_audit_workflow_exists` and halted, prefer 409 `night_audit_halted`.
4. `POST .../night-audit/retry` — body `{ idempotencyKey, businessDate, step }`. Fingerprint `{ propertyId, businessDate, step }`. Handler reads census, `invokePropertyDo` → `tryRetryAuditStep(..., census)`.
5. `POST .../night-audit/resolve-halt` — body `{ idempotencyKey, businessDate }`. Fingerprint `{ propertyId, businessDate }`. Pass census.
6. `POST .../provisional-exceptions/:exceptionId/resolve` — body `{ idempotencyKey }`. Fingerprint `{ propertyId, exceptionId }`. `alreadyResolved` → 200 `{ ok: true, alreadyResolved: true }`. Missing → 404.

`V1_HTTP_ROUTE_AUDIT` rows 86–91 as specified in the spec table. Mutations: `commandId` + `entitlement: 'pms.core'`. GETs: `degradedRead: 'FAIL_CLOSED'`, no `commandId`.

- [x] **Step 4: Run tests + permission/degraded/transport checks**

Run:

```
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm check:degraded
pnpm check:do-transport-guards
pnpm check:entitlements
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-routes.spec.ts
```

Expected: PASS. Route count 92 (indices 0–91).

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts apps/pms-core/src/night-audit-http.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/property-do.ts apps/pms-core/test/night-audit-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): night-audit /v1 status, run, retry, resolve-halt, resolve-exception

Operator routes declare pms.core so a kill-switch denies the click
without stranding the alarm. POST run is get-or-create, not a second create.

EOF
)"
```

---

### Task 8: Night-audit SPA + ExceptionsPanel Resolve

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/shell/module-ui-registry.test.ts`
- Create: `apps/web-pms/src/screens/NightAuditRoute.tsx`
- Create: `apps/web-pms/src/screens/NightAuditScreen.tsx`
- Create: `apps/web-pms/src/screens/NightAuditRoute.test.tsx`
- Create: `apps/web-pms/src/screens/NightAuditScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/ExceptionsPanel.tsx`
- Create: `apps/web-pms/src/screens/ExceptionsPanel.test.tsx` (or extend if one exists)
- Modify: `apps/web-pms/src/status/status-class.ts` consumers only — reuse existing `statusClass`. Add `apps/web-pms/src/status/night-audit-severity.ts` if the severity mapping needs a unit test.

**Interfaces:**
- Consumes: Task 7 HTTP shapes
- Produces: nav `{ id: 'night-audit', label: 'Night audit', path: '/night-audit', order: 60, permission: 'night_audit:run' }`

Client methods (`packages/client-core/src/api.ts`):

```ts
async getNightAudit(propertyId: string) { /* GET /v1/properties/:id/night-audit */ }
async getNightAuditReport(propertyId: string, businessDate: string, reportId: string) { /* GET reports */ }
async runNightAudit(propertyId: string, opId: string) {
  const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
  return getJson(`/v1/properties/${enc(propertyId)}/night-audit/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey }),
  });
}
async retryNightAuditStep(propertyId: string, input: { businessDate: string; step: string }, opId: string) { /* fingerprint in opId */ }
async resolveNightAuditHalt(propertyId: string, businessDate: string, opId: string) { /* ... */ }
async resolveProvisionalException(propertyId: string, exceptionId: string, opId: string) { /* ... */ }
```

`opId` values: `night-audit:run:${propertyId}:${businessDate}`, `night-audit:retry:${propertyId}:${businessDate}:${step}`, `night-audit:resolve-halt:${propertyId}:${businessDate}`, `provisional:resolve:${propertyId}:${exceptionId}`.

- [x] **Step 1: Write the failing SPA tests**

`NightAuditRoute.test.tsx` (copy `RosterRoute.test.tsx`): live `/me` without `night_audit:run` → redirect to `/arrivals`; screen never mounts.

`NightAuditScreen.test.tsx` (injected transport, like `ShiftScreen.test.tsx`):

- 24: nav hidden is covered by `filterNavEntries` / route gate; assert the screen is not the thing staff see.
- 25: halted payload → banner with `status-exception`; Run disabled; Retry enabled on the FAILED step; Resume enabled. Stale RUNNING → Resume enabled, Retry disabled, Run disabled.
- 26: Resume click calls `resolveNightAuditHalt` and `invalidateQueries` for `['night-audit', propertyId]`.
- Run while `businessDate >= propertyLocalToday` → Run disabled (no POST).
- Reports: list from status; click loads `getNightAuditReport` and renders a table. Money via `formatMinor` from `apps/web-pms/src/money.ts`.

`ExceptionsPanel.test.tsx`:

- 27: Resolve button **absent** without `night_audit:run` on `/me`. Present with the permission. Click → `resolveProvisionalException`; on success invalidate `['provisional-exception-count', propertyId]` and `['provisional-exceptions', propertyId]`.

`module-ui-registry.test.ts`: expected `ALL_NAV` ids gain `'night-audit'` after `'roster'`.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/web-pms exec vitest run src/screens/NightAuditRoute.test.tsx src/screens/NightAuditScreen.test.tsx src/shell/module-ui-registry.test.ts`

Expected: FAIL — files missing / nav order.

- [x] **Step 3: Implement client, nav, route, screen, panel**

`NightAuditRoute`: same gate as `RosterRoute` with `hasPropertyPermission(..., 'night_audit:run')`.

`NightAuditScreen`:
- Query `['night-audit', propertyId]` → `api.getNightAudit`.
- Halted banner: `statusClass('exception')`.
- Pending open > 0: `statusClass('attention')`.
- Idle current date: `statusClass('neutral')`.
- FAILED step: `statusClass('exception')`.
- Run disabled when `halted`, any step `RUNNING`, or `businessDate >= propertyLocalToday(timeZone)`.
- Retry: only the FAILED step (one button).
- Resume: `halted || any RUNNING`.
- Closing-date exception count links to the exceptions panel (hash or in-shell — the panel already lives in `AppShell`; a heading + count + “Open replay exceptions” is enough).
- Mutations: `useMutation` + `stableKeyForOperation` via the client methods; `onSettled` invalidate `['night-audit', propertyId]`.

`ExceptionsPanel`: `useQuery` `/me` (or accept permission from shell). If `night_audit:run`, each listed exception gets a Resolve button. Do not add filter/retry-original (leftovers 9/10).

Wire `<Route path="night-audit" element={<NightAuditRoute />} />` in `App.tsx`.

- [x] **Step 4: Run tests + me-gating / colors checks**

Run:

```
pnpm --filter @hospai/web-pms exec vitest run src/screens/NightAuditRoute.test.tsx src/screens/NightAuditScreen.test.tsx src/screens/ExceptionsPanel.test.tsx src/shell/module-ui-registry.test.ts
pnpm check:web-pms-me-gating
pnpm check:web-pms-colors
```

Expected: PASS. No ad-hoc hex colours.

- [x] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts apps/web-pms/src/shell/nav.ts apps/web-pms/src/App.tsx apps/web-pms/src/shell/module-ui-registry.test.ts apps/web-pms/src/screens/NightAuditRoute.tsx apps/web-pms/src/screens/NightAuditScreen.tsx apps/web-pms/src/screens/NightAuditRoute.test.tsx apps/web-pms/src/screens/NightAuditScreen.test.tsx apps/web-pms/src/screens/ExceptionsPanel.tsx apps/web-pms/src/screens/ExceptionsPanel.test.tsx apps/web-pms/src/status/night-audit-severity.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): night-audit screen and exception resolve control

Nav and actions gated on night_audit:run. Halted/FAILED use status-exception;
pending open uses status-attention.

EOF
)"
```

---

### Task 9: Org purge — reports prefix + census rows + spec amends

**Files:**
- Modify: `apps/pms-core/src/event-log.ts` (if `reportsPrefixForProperty` not already exported from Task 6)
- Modify: `apps/pms-core/src/purge-workflow.ts`
- Modify: `apps/pms-core/test/purge-workflow.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-12-event-log-r2-design.md`
- Modify: `docs/superpowers/specs/2026-08-12-purge-workflow-design.md`

**Interfaces:**
- Consumes: `reportsPrefixForProperty`; `snapshot.propertyIds`
- Produces: org `PURGE_R2` deletes `events/{do}/{id}/` **and** `reports/property/{propertyId}/`. Org D1 purge `DELETE FROM pending_command_open WHERE property_id IN (...)`.

- [x] **Step 1: Write the failing purge tests**

In `purge-workflow.spec.ts`:

```ts
it('org purge deletes reports/property/{propertyId}/ objects and pending_command_open rows', async () => {
  // put a dummy object at reports/property/${propertyId}/2026-03-01/occupancy.json
  // insertPendingOpen for that propertyId
  // run org purge plan (existing harness)
  // assert R2 prefix empty (reuse assertEventLogPrefixEmpty against the reports prefix)
  // assert countPendingOpen === 0
});
```

Extend the existing R2 verify loop expectation: leftover reports objects must `HaltError('verify_r2_residue')`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/purge-workflow.spec.ts`

Expected: FAIL — reports objects and census rows survive.

- [x] **Step 3: Implement purge deletes + spec sentences**

In `runOrgPlan` `purge-r2` step, after event-log prefixes:

```ts
for (const propertyId of snapshot.propertyIds) {
  deleted += await deleteEventLogPrefix(env.EVENT_LOG_R2, reportsPrefixForProperty(propertyId));
}
```

In verify, also `assertEventLogPrefixEmpty` for each reports prefix.

New step (or fold into close-traffic after `propertyIds` is known):

```ts
await step.do('purge-pending-command-open', async () => {
  if (snapshot.propertyIds.length === 0) return;
  const placeholders = snapshot.propertyIds.map(() => '?').join(',');
  await env.PLATFORM_DB.prepare(
    `DELETE FROM pending_command_open WHERE property_id IN (${placeholders})`,
  )
    .bind(...snapshot.propertyIds)
    .run();
});
```

Event-log R2 spec — add one sentence under the org-purge / prefix section: *Org `PURGE_R2` also deletes `reports/property/{propertyId}/` (night-audit close-out artifacts; see night-audit E2E spec §3.3).*

Purge-workflow spec — add one sentence: *Org D1 purge deletes `pending_command_open` rows for the org’s properties (night-audit PRE_CHECK census; see night-audit E2E spec leftover 11).*

- [x] **Step 4: Run tests + check:purge**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/purge-workflow.spec.ts && pnpm check:purge`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/event-log.ts apps/pms-core/src/purge-workflow.ts apps/pms-core/test/purge-workflow.spec.ts docs/superpowers/specs/2026-08-12-event-log-r2-design.md docs/superpowers/specs/2026-08-12-purge-workflow-design.md
git commit -m "$(cat <<'EOF'
fix(purge): delete night-audit reports prefix and pending-command census

Org purge must not leave R2 close-out JSON or D1 census rows orphaned
after registry rows are gone.

EOF
)"
```

---

### Task 10: Full CI (`ci.yml` order)

**Files:** none expected. Fix anything this sequence turns red.

- [x] **Step 1: Run the `checks` job locally, in this order**

```
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

Expected: all exit 0. `check:class-denylist` stays green because PropertyDO still has no `PLATFORM_DB`. `check:pms-core-test-dates` stays green because new tests derive dates from `readBusinessDate()`.

- [x] **Step 2: Run the pms-core shard matrix**

```
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Do not put `--` before `--shard`. Expected: all four exit 0.

- [x] **Step 3: Tick living checkboxes on this plan**

In this file, mark Tasks 1–10 `- [x]` on the task headings’ completed steps (or the task-level boxes you used). Same PR as the last implementation commit, or a docs commit in that PR. Do not backfill other plans.

- [x] **Step 4: Commit only if Step 3 left docs dirty**

```bash
git add docs/superpowers/plans/2026-08-12-night-audit-e2e.md
git commit -m "$(cat <<'EOF'
docs: tick night-audit e2e plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip the commit.

---

## Spec coverage (self-review)

| Spec §13 / requirement | Task |
|---|---|
| Four stub bodies; PRE_CHECK cannot list Queues or read D1 | 4, 5, 6 |
| Caller-passes-census; PropertyDO off `PLATFORM_DB` | 2, 4, 7, 10 (`check:class-denylist`) |
| Exception resolve lifecycle; `resolved_at IS NULL`; test 21b | 3, 4, 7 |
| POST run get-or-create; complete → 200; not-due → 409 | 7 |
| Stale RUNNING: retry 409s; resolve-halt walks it | 4, 7 |
| Reports before roll, archive after; R2 OLTP | 6 |
| Idempotency + derived halt; no skip | 4, 7 |
| Double-post unique index, PK-independent insert | 6 test 15 |
| Routes in audit with permission + entitlement; run opt-out stays | 1, 7 |
| Folded-in decisions (defer / drop / no penalty / tax / living checkboxes) | 5 (no penalty), 6 (tax), 10 (checkboxes). Recurring/reg-card: not implemented, as specified. |
| Recovery 21 / 21b | 7 |
| Out of scope named | leftovers stay in the spec; this plan does not implement them |
| Test 14 COMPLETED short-circuit vs overwrite-on-retry | 6 |
| `closingExceptionCount` pinned to `businessDate` | 7 `readNightAuditStatus` |
| Leftover 11 census purge + reports prefix | 9 |
| Drain window is not Workflow self-heal | 4 Workflow `return`s on FAILED (unchanged) |
| `AUDIT_WRITER_COMMAND_IDS.size === 33` | 1 |
| Route pins 85 / 86 / 91 | 7 |
| Enqueue-before-send; consumer delete | 2 |
| `startNightAudit` stays test helper; HTTP uses Workflow | 4, 7 |
