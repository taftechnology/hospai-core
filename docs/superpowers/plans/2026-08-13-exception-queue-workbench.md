# Exception-Queue Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Turn the shell `ExceptionsPanel` badge into the entry point for a real `/exceptions` operator workbench — filters, retry, assign, notes, audit trail, batch, and affected-entity links — on the existing `provisional_exception` table.

**Architecture:** Three new FAIL_CLOSED writers (`provisional.retry_exception`, `provisional.assign_exception`, `provisional.add_exception_note`) plus one detail GET. List GET `[18]` is widened in place (no new list route). Retry is a live PropertyDO invoke through shared `REPLAY_DISPATCH` with `open_retry_key`; it never requeues and never reuses the original idempotency key. v25 ALTERs four columns on `provisional_exception`; notes and the action trail live in `audit_log`. SPA is core `nav.ts`. Resolve stays acknowledge-only.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/client-core`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` (Approved). Spec commit: `dc3d975370693ca114e24c7b50fb90efb60618eb`.

## Global Constraints

- Route audit **append-only**. `[119] = get_front_desk_stream` does not move. `[18] get_provisional_exceptions`, `[19] get_provisional_exception_count`, `[91] post_provisional_exception_resolve` stay those ids. New routes are **`[120] get_provisional_exception`**, **`[121] post_provisional_exception_retry`**, **`[122] post_provisional_exception_assign`**, **`[123] post_provisional_exception_note`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in **identical order**.
- Task 1 must **not** touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT` (`check:permissions` stays green). Task 2 is schema only. Task 3 appends **120–123** together so the zip stays aligned.
- `COMMAND_CATALOG.length` 74 → **77**. `AUDIT_WRITER_COMMAND_IDS.size` 49 → **52**. `PLATFORM_GAPS` stays `[]`.
- **Schema v25 only.** ALTER existing `provisional_exception` (four columns). No new table, no covering index. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged (already includes `provisional_exception`).
- No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- `runIdempotent` stays sync-only. Inner `tryCheckIn` / friends are async — retry uses persist-`open_retry_key` → await inner → stamp txn (spec §8.2).
- Resolve is **acknowledge-only**. Retry is the only apply path. Retry is **FAIL_CLOSED** (never `QUEUE_PROVISIONAL`, never `enqueueProvisionalCommand`).
- Retry never reuses the original `idempotency_key`. Inner key is `open_retry_key`. `issuedAt` / `businessDate` are the stored exception values.
- Failed retry updates the **same** row. Do not `recordProvisionalException` a second row.
- Guest names never appear on exception JSON. `affected.guestRef` only; SPA hydrates via existing `POST …/guests/batch`.
- PropertyDO does **not** call OrgDO to validate `assignedTo`. Opaque `userId`. Picker is existing `list_property_members`.
- New HTTP reads are **`FAIL_CLOSED`**. Do **not** reclass `[18]`/`[19]`/`get_front_desk_*` to `READ_STALE`. Do **not** backfill `entitlement` on `[18]`/`[19]`.
- Nav: Exceptions `/exceptions` order **65** `property:read`. Core `nav.ts`, not `module-ui-registry.ts`. Index `/` stays `/board`.
- Badge stays in `AppShell` side-panels. Click → `/exceptions`. No inline list/Resolve on the badge.
- Existing tokens / `exceptionBadgeSeverity` / `statusClass` / `check:web-pms-colors`. No Tailwind, no `ui-kit`, no new `--status-*` pairs.
- Fixture dates from property-local `business_date` when load-bearing. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- **Rebuild:** after any `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests. After client-core source change, `pnpm --filter @hospai/client-core build` before web-pms tests.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 8). Do not backfill historical plans.
- No either/or forks. Spec §18 locks stand.
- Scope-out (do not implement): tape/WS, property-setup rebuild, guest CRM, virtual types, derived/OrgDO plans, `rooms.delete`, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring, partial refunds, PCI, list-route `READ_STALE` reclass, `entitlement.changed` WS, `REPLAY_DISPATCH` + `reservations.update_extras`, `entityId` on `get_audit_log`, IndexedDB pending UX, batch HTTP command, new PropertyDO table, rewriting `businessDate` on retry, roster `assigneeRef` assign.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Three commands after `provisional.resolve_exception` (Task 1) |
| `packages/contracts/src/commands/audit-writers.ts` | Three ids; size **52** |
| `packages/contracts/src/idempotency.ts` | `ALREADY_RESOLVED`, `NOTE_TOO_LONG`, `NOTE_LIMIT` |
| `packages/contracts/src/provisional-command.ts` | Widen `ProvisionalExceptionRow` |
| `packages/contracts/src/v1-http-routes.ts` | Append `[120]`–`[123]` (Task 3) |
| `packages/contracts/src/register.test.ts` | Catalog 77 / writers 52 (Task 1); route pins (Task 3) |
| `apps/pms-core/src/event-consumer.ts` | Allowlist three event types (Task 1) |
| `packages/do-runtime/src/property-migrations.ts` | v25 statements (Task 2) |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql prefixes; head **25** |
| `packages/do-runtime/src/exception-queue-workbench-migration.sqlite.test.ts` | Real SQLite ALTER (Task 2) |
| `migrations/do-property/0025_exception_queue_workbench.sql` | `pnpm generate:ddl` |
| `apps/pms-core/src/replay-dispatch.ts` | Extract `REPLAY_DISPATCH` (Task 3) |
| `apps/pms-core/src/pending-commands-consumer.ts` | Re-export / import extracted table; drain unchanged |
| `apps/pms-core/src/property-do.ts` | Widen list; detail; retry / assign / note |
| `apps/pms-core/src/v1-dispatch.ts` | Widen `[18]` query; four handlers; append four `V1_ROUTES` |
| `apps/pms-core/test/exception-workbench.spec.ts` | New: spec §16.6–16.17 |
| `packages/client-core/src/api.ts` | Query + three writers + detail GET (Task 4) |
| `packages/client-core/test/api-exception-workbench.test.ts` | Client tests (Task 4) |
| `apps/web-pms/src/shell/nav.ts` | Exceptions order 65 |
| `apps/web-pms/src/App.tsx` | `/exceptions` |
| `apps/web-pms/src/screens/ExceptionsPanel.tsx` (+ test) | Badge-as-link |
| `apps/web-pms/src/screens/ExceptionsScreen.tsx` (+ test) | Workbench (Task 5) |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` (+ test) | Closing-date `Link` |
| `apps/web-pms/src/auth/me.test.ts` | Nav id `exceptions` |
| `apps/web-pms/src/shell/AppShell.boot.test.tsx` | Heading pin |
| Sibling specs + `ARCHITECTURE.md` | Pointers (Task 6) |

## Test file split (spec §16 → file)

| Spec # | File | Task |
|---|---|---|
| 1–5 route / catalog / schema pins | `register.test.ts` + `migrate.test.ts` | 1 (catalog), 2 (schema), 3 (routes) |
| 6–9 list / detail / 403 / 503 | `exception-workbench.spec.ts` | 3 |
| 10–17 retry / assign / note / resolve / folio | `exception-workbench.spec.ts` | 3 |
| client-core | `api-exception-workbench.test.ts` | 4 |
| 18 badge | `ExceptionsPanel.test.tsx` + `AppShell.boot.test.tsx` | 5 |
| 19 nav / URL | `me.test.ts` + `ExceptionsScreen.test.tsx` | 5 |
| 20–22 writers / links / night-audit | `ExceptionsScreen.test.tsx` + `NightAuditScreen.test.tsx` | 5 |
| 23 colors / motion | Task 7 `check:web-pms-colors` | 7 |
| Bidirectional pointers | sibling specs | 6 |

---

### Task 1: Catalog + audit writers + wire codes + event allowlist (own commit, no HTTP routes)

**Spec:** §4.2, §16.4 (catalog/writers only). Keep `check:permissions` green.

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts` — insert three entries **immediately after** `provisional.resolve_exception` (~566)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — append the three ids
- Modify: `packages/contracts/src/idempotency.ts` — three wire codes
- Modify: `packages/contracts/src/provisional-command.ts` — widen `ProvisionalExceptionRow`
- Modify: `packages/contracts/src/register.test.ts` — size pins 74→77, 49→52; command-shape pin
- Modify: `apps/pms-core/src/event-consumer.ts` — three `case` arms next to `provisional.exception_resolved`
- Test: `packages/contracts` vitest; `apps/pms-core/test/events-queue.spec.ts` (catalog allowlist)

**Interfaces:**
- Produces: catalog ids `provisional.retry_exception` / `provisional.assign_exception` / `provisional.add_exception_note`; events `provisional.exception_retried` / `provisional.exception_assigned` / `provisional.exception_noted`; wire codes below; `ProvisionalExceptionRow` extra fields optional
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any DO method body, any SPA, any migration, `CLASS_DENYLIST`, `enqueueProvisionalCommand` changes.

Wire codes (add next to `PROVISIONAL_EXCEPTIONS_OPEN` in `idempotency.ts`):

```ts
export const ALREADY_RESOLVED = 'already_resolved' as const;
export const NOTE_TOO_LONG = 'note_too_long' as const;
export const NOTE_LIMIT = 'note_limit' as const;
```

`ProvisionalExceptionRow` add (all optional so existing tests that omit them still typecheck):

```ts
  assignedTo?: string | null;
  assignedAt?: number | null;
  assignedBy?: string | null;
  openRetryKey?: string | null;
```

- [ ] **Step 1: Write the failing tests**

In `register.test.ts`, change the existing size pins:

```ts
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(52);
expect(COMMAND_CATALOG).toHaveLength(77);
```

There are **two** `AUDIT_WRITER_COMMAND_IDS.size` pins (~268 and ~547) and one `COMMAND_CATALOG).toHaveLength(74)` (~548). Change **all** of them this commit.

Next to the existing `night_audit operator commands` test (~271), add:

```ts
it('provisional workbench commands are entitled FAIL_CLOSED night_audit:run', () => {
  for (const id of [
    'provisional.retry_exception',
    'provisional.assign_exception',
    'provisional.add_exception_note',
  ] as const) {
    const c = COMMAND_CATALOG.find((x) => x.id === id);
    expect(c?.lane).toBe('INTERACTIVE');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('night_audit:run');
    expect(c?.idempotent).toBe(true);
    expect(c?.prototypeAction).toBeNull();
    expect(AUDIT_WRITER_COMMAND_IDS.has(id)).toBe(true);
  }
  expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.retry_exception')?.events).toEqual([
    'provisional.exception_retried',
    'provisional.exception_resolved',
  ]);
  expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.assign_exception')?.events).toEqual([
    'provisional.exception_assigned',
  ]);
  expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.add_exception_note')?.events).toEqual([
    'provisional.exception_noted',
  ]);
  const resolve = COMMAND_CATALOG.find((c) => c.id === 'provisional.resolve_exception');
  expect(resolve?.events).toEqual(['provisional.exception_resolved']);
  expect(resolve?.notes).toMatch(/Not a replay/i);
});
```

Do **not** add `[120]` assertions this commit (`[119]` stays `get_front_desk_stream`; `[120]` is undefined until Task 3).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

Expected: FAIL — length still 74 / size still 49 / new ids missing.

- [ ] **Step 3: Implement catalog + writers + codes + allowlist**

Catalog entries (copy this shape; insert after `provisional.resolve_exception`):

```ts
{
  id: 'provisional.retry_exception',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['provisional.exception_retried', 'provisional.exception_resolved'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes:
    'Live re-apply of a provisional_exception payload via REPLAY_DISPATCH. New open_retry_key. Not QUEUE_PROVISIONAL. Success stamps resolved_at.',
},
{
  id: 'provisional.assign_exception',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['provisional.exception_assigned'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes: 'Set or clear assigned_to on an open provisional_exception. Opaque userId; no OrgDO check.',
},
{
  id: 'provisional.add_exception_note',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['provisional.exception_noted'],
  entitlement: 'pms.core',
  permission: 'night_audit:run',
  notes: 'Append-only note in audit_log. Does not resolve. Allowed on open and resolved rows.',
},
```

`audit-writers.ts`: append the three ids after `'provisional.resolve_exception'`.

`event-consumer.ts`: add `case 'provisional.exception_retried':`, `case 'provisional.exception_assigned':`, `case 'provisional.exception_noted':` in the same `switch` as `provisional.exception_resolved` (fall through to `break`). Shape-only; do not call PropertyDO.

- [ ] **Step 4: Rebuild contracts, re-run tests**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:entitlements
pnpm check:degraded
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
```

Expected: all exit 0. `check:permissions` still reports current `V1_HTTP_ROUTE_AUDIT.length` (no new route). Catalog-events allowlist in `events-queue.spec.ts` accepts the three new types.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/provisional-command.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/event-consumer.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add exception-queue workbench commands

EOF
)"
```

---

### Task 2: PropertyDO v25 ALTER (own commit, no HTTP)

**Spec:** §5, §16.5.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Create: `packages/do-runtime/src/exception-queue-workbench-migration.sqlite.test.ts`
- Create (via generate): `migrations/do-property/0025_exception_queue_workbench.sql`
- Test: `packages/do-runtime` vitest

**Interfaces:**
- Produces: `EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS` / `_SQL`; `PROPERTY_SCHEMA_HEAD === 25`; columns `assigned_to`, `assigned_at`, `assigned_by`, `open_retry_key`
- Consumes: Task 1 types only
- **Forbidden this commit:** `V1_ROUTES`, PropertyDO method bodies, SPA, catalog edits.

- [ ] **Step 1: Write the failing head pins**

In `migrate.test.ts`:

1. `MemorySql.exec`: add four prefixes **next to** the existing `resolved_at` / `resolved_by` handlers (~141–145):

```ts
if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_to')) {
  return { toArray: () => [] };
}
if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_at')) {
  return { toArray: () => [] };
}
if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_by')) {
  return { toArray: () => [] };
}
if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN open_retry_key')) {
  return { toArray: () => [] };
}
```

2. `applies property migrations through version 24` → **25**. Change `toBe(24)` (both `v1` and `v2`) and the `schemaVersion` array to include `25` (length 25).
3. Global pin `expect(PROPERTY_SCHEMA_HEAD).toBe(24)` in `match current migration array tails` → **25**.
4. Keep `property schema head is 24 after multi_currency_folio` as **historical** (`filter version <= 24` / named v24 assertions). Do **not** change that test into a global head pin.
5. Add:

```ts
it('property schema head is 25 after exception_queue_workbench', () => {
  expect(PROPERTY_SCHEMA_HEAD).toBe(25);
  const v25 = PROPERTY_MIGRATIONS.find((m) => m.version === 25);
  expect(v25?.name).toBe('exception_queue_workbench');
  expect(v25?.statements).toEqual([
    'ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT',
    'ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER',
    'ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT',
    'ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT',
  ]);
});
```

Plus an on-disk SQL match test mirroring v23 (`0025_exception_queue_workbench.sql` vs `EXCEPTION_QUEUE_WORKBENCH_V25_SQL`) — it will fail until `generate:ddl`.

Create `exception-queue-workbench-migration.sqlite.test.ts` (pattern: `room-ooo-migration.sqlite.test.ts`):

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('exception_queue_workbench v25 real sqlite', () => {
  it('ALTERs assignee columns onto a populated v24 row', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 24)) {
      execAll(db, m.statements!);
    }
    db.exec(`INSERT INTO provisional_exception (
      exception_id, idempotency_key, command_type, payload,
      issued_at, business_date, reason, detail, created_at
    ) VALUES ('ex1', 'idem1', 'reservations.check_in', '{}',
      '2026-08-01T12:00:00.000Z', '2026-08-01', 'ROOM_ALREADY_ASSIGNED', NULL, 1)`);

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version === 25)) {
      execAll(db, m.statements!);
    }

    const row = db.prepare(
      `SELECT assigned_to, assigned_at, assigned_by, open_retry_key FROM provisional_exception WHERE exception_id = 'ex1'`,
    ).get() as {
      assigned_to: string | null;
      assigned_at: number | null;
      assigned_by: string | null;
      open_retry_key: string | null;
    };
    expect(row.assigned_to).toBeNull();
    expect(row.assigned_at).toBeNull();
    expect(row.assigned_by).toBeNull();
    expect(row.open_retry_key).toBeNull();

    db.exec(`UPDATE provisional_exception SET assigned_to = 'user_a', assigned_at = 2, assigned_by = 'user_b' WHERE exception_id = 'ex1'`);
    const after = db.prepare(`SELECT assigned_to FROM provisional_exception WHERE exception_id = 'ex1'`).get() as {
      assigned_to: string;
    };
    expect(after.assigned_to).toBe('user_a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

Expected: FAIL — head still 24 / Unhandled SQL if statements exist without MemorySql prefixes, or v25 missing.

- [ ] **Step 3: Implement migration + generate DDL**

In `property-migrations.ts`, next to v19 resolved_at statements style:

```ts
export const EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT`,
  `ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER`,
  `ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT`,
  `ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT`,
] as const;

export const EXCEPTION_QUEUE_WORKBENCH_V25_SQL =
  EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```ts
{
  version: 25,
  name: 'exception_queue_workbench',
  statements: EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS,
},
```

Export the new constants from `packages/do-runtime/src/index.ts` if other migrations are re-exported (match v24: only if currently re-exported — **do not** add a new public API unless `index.ts` already exports `MULTI_CURRENCY_FOLIO_V24_SQL`). Prefer importing from `property-migrations.js` in tests.

```bash
pnpm generate:ddl
```

Expected: creates `migrations/do-property/0025_exception_queue_workbench.sql`. `git diff` on v1–v24 SQL files must be empty.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/exception-queue-workbench-migration.sqlite.test.ts
pnpm check:ddl
pnpm check:purge
```

Expected: all exit 0. Purge list unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/exception-queue-workbench-migration.sqlite.test.ts \
  packages/do-runtime/src/index.ts \
  migrations/do-property/0025_exception_queue_workbench.sql
git commit -m "$(cat <<'EOF'
feat(schema): v25 exception-queue assignee and retry key

EOF
)"
```

Omit `index.ts` from `git add` if unchanged.

---

### Task 3: DO RPCs + HTTP 120–123 + extract `REPLAY_DISPATCH`

**Spec:** §3, §6–§11, §16.1–3, §16.6–17.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append four audit rows after `get_front_desk_stream`
- Modify: `packages/contracts/src/register.test.ts` — `[120]`–`[123]` pins
- Create: `apps/pms-core/src/replay-dispatch.ts` — move `REPLAY_DISPATCH` / `REPLAY_COMMAND_IDS` here
- Modify: `apps/pms-core/src/pending-commands-consumer.ts` — import from `replay-dispatch.ts`; drain behaviour **unchanged**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — widen `handleGetProvisionalExceptions`; four new handlers; append four `V1_ROUTES` at **END** (after `handleGetFrontOfficeStream`)
- Create: `apps/pms-core/test/exception-workbench.spec.ts`
- Existing must stay green: `degraded-mode.spec.ts`, `night-audit-precheck.spec.ts`, `front-desk-reads.spec.ts` exception-count tests

**Interfaces:**

```ts
export type AffectedRefs = {
  reservationId: string | null;
  roomId: string | null;
  guestRef: string | null;
  folioLineId: string | null;
};

export type ProvisionalExceptionListItem = ProvisionalExceptionRow & {
  assignedTo: string | null;
  assignedAt: number | null;
  assignedBy: string | null;
  openRetryKey: string | null;
  affected: AffectedRefs;
};

export type ProvisionalExceptionListFilters = {
  resolution?: 'open' | 'resolved' | 'all';
  commandType?: string;
  reason?: string;
  businessDateFrom?: string;
  businessDateTo?: string;
  assigned?: 'all' | 'unassigned' | 'assigned';
  assignedTo?: string;
  limit?: number;
  cursor?: { createdAt: number; exceptionId: string } | null;
};

async listProvisionalExceptions(
  filters?: ProvisionalExceptionListFilters,
): Promise<{ ok: true; exceptions: ProvisionalExceptionListItem[]; nextCursor: { createdAt: number; exceptionId: string } | null }>

async readProvisionalException(exceptionId: string): Promise<
  | {
      ok: true;
      exception: ProvisionalExceptionListItem;
      actions: Array<{
        at: number;
        actor: string;
        commandId: string;
        action: 'resolved' | 'retried' | 'retry_failed' | 'assigned' | 'noted';
        afterJson: unknown;
      }>;
      notes: Array<{ noteId: string; at: number; actor: string; text: string }>;
    }
  | { ok: false; error: typeof NOT_FOUND }
>

async tryRetryProvisionalException(
  actor: ActorContext,
  input: { exceptionId: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; retried: true }
  | { ok: false; error: typeof NOT_FOUND | typeof ALREADY_RESOLVED | 'unknown_command' | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string; retried?: false }
>

async tryAssignProvisionalException(
  actor: ActorContext,
  input: { exceptionId: string; assignedTo: string | null },
  idem: IdempotencyKey,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof NOT_FOUND | typeof ALREADY_RESOLVED | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
>

async tryAddExceptionNote(
  actor: ActorContext,
  input: { exceptionId: string; noteId: string; text: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof NOT_FOUND | typeof NOTE_TOO_LONG | typeof NOTE_LIMIT | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
>
```

`affectedFromPayload(commandType, payload)` — file-local function in `property-do.ts` (or next to replay-dispatch). Never throws.

`ReplayTarget` duck-type (do **not** import `PropertyDO` into `replay-dispatch.ts` — cycle). First argument of `invoke` is that duck-type so PropertyDO can pass `this` and the consumer can pass `resolved.stub`.

- Produces: HTTP 120–123; widened `[18]`
- Consumes: Task 1 catalog ids / wire codes; Task 2 columns; existing `tryResolveProvisionalException` (unchanged semantics)
- **Forbidden this commit:** SPA, client-core, `enqueueProvisionalCommand` from retry, new table, `CLASS_DENYLIST`, changing resolve into a replay, rewriting `businessDate`.

- [ ] **Step 1: Write the failing register pins + workbench HTTP tests**

In the existing route-audit `it` that pins `[119]`, append (keep `[119]` assertions):

```ts
expect(V1_HTTP_ROUTE_AUDIT[119]?.id).toBe('get_front_desk_stream');
expect(V1_HTTP_ROUTE_AUDIT[120]?.id).toBe('get_provisional_exception');
expect(V1_HTTP_ROUTE_AUDIT[120]).toMatchObject({
  scope: 'property',
  permission: 'property:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[120] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[121]?.id).toBe('post_provisional_exception_retry');
expect(V1_HTTP_ROUTE_AUDIT[121]).toMatchObject({
  scope: 'property',
  permission: 'night_audit:run',
  commandId: 'provisional.retry_exception',
  entitlement: 'pms.core',
});
expect(V1_HTTP_ROUTE_AUDIT[122]?.id).toBe('post_provisional_exception_assign');
expect(V1_HTTP_ROUTE_AUDIT[122]).toMatchObject({
  scope: 'property',
  permission: 'night_audit:run',
  commandId: 'provisional.assign_exception',
  entitlement: 'pms.core',
});
expect(V1_HTTP_ROUTE_AUDIT[123]?.id).toBe('post_provisional_exception_note');
expect(V1_HTTP_ROUTE_AUDIT[123]).toMatchObject({
  scope: 'property',
  permission: 'night_audit:run',
  commandId: 'provisional.add_exception_note',
  entitlement: 'pms.core',
});
```

Keep catalog length **77** / writers **52** from Task 1 in this same `it`.

Create `apps/pms-core/test/exception-workbench.spec.ts` using `provisionedPropertyWithGuest` / `TEST_OWNER_ACTOR` / `idemFor` / `worker.fetch` / `x-dev-actor` like `front-desk-reads.spec.ts` and `night-audit-precheck.spec.ts`. Seed exceptions via `stub.recordProvisionalException` **or** the existing enqueue+drain pattern in `degraded-mode.spec.ts` (prefer drain for retry tests so the original idempotency row exists).

Cover spec tests **6–17** as distinct `it` blocks with those numbers in the title (`6: no-query list still open-uncapped`, …). Minimum assertions:

- **6:** two open + one resolved; `GET /provisional-exceptions` (no query) length 2.
- **7:** `?resolution=all` → 3; `?resolution=resolved` → 1; `?commandType=reservations.check_in` filters; inclusive business-date; `?assigned=unassigned` hides assigned.
- **8:** `GET …/:id` 200 for resolved; 404 unknown; `actions` after resolve; `affected.reservationId` on check-in payload.
- **9:** staff without `night_audit:run` GET 200, POST retry 403; missing `property:read` GET 403; DO blocked → 503 `FAIL_CLOSED` on 120 and on `[18]`.
- **10:** `ROOM_ALREADY_ASSIGNED` retry while conflict remains → 422, same id, still open, no second row; after conflict cleared, new outer key → 200, `checked_in`, events `provisional.exception_retried` + `provisional.exception_resolved`.
- **11:** inner key is `open_retry_key` and ≠ original; second retry after inner already `{ ok: true }` in idempotency resolves once (no double check-in).
- **12:** `business_date_closed` retry while closed → 422, stays open; resolve then PRE_CHECK does not count it.
- **13:** `unknown_command` retry → 422 `unknown_command`; resolve 200.
- **14:** assign / unassign / list filters; assign on resolved → 422 `already_resolved`.
- **15:** notes on open + resolved; empty 400; 51st → 422 `note_limit`; detail `notes` length 2.
- **16:** resolve idempotent `alreadyResolved`; does not apply original command.
- **17:** `folio.add_item` retry success → one new `folio_line`; resolve-without-retry → zero new lines.

Invalid query: `resolution=bogus` → 400 `{ error: 'invalid_query' }`. Bad cursor → 400 `{ error: 'invalid_cursor' }`. `limit=0` or `201` → 400.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/exception-workbench.spec.ts
```

Expected: FAIL — `[120]` undefined / 404 on new paths.

- [ ] **Step 3: Implement**

**3a. Audit rows** — append to `V1_HTTP_ROUTE_AUDIT` exactly as spec §3 table (no `degradedRead` on 121–123).

**3b. Extract `replay-dispatch.ts`.** Cut `REPLAY_DISPATCH` + `REPLAY_COMMAND_IDS` + `ReplayDispatch` type from `pending-commands-consumer.ts`. Keep `REPLAY_ACTOR` in the consumer (retry uses the operator). Re-export `REPLAY_DISPATCH` / `REPLAY_COMMAND_IDS` from the consumer file if tests import them from there (`export { REPLAY_DISPATCH, REPLAY_COMMAND_IDS } from './replay-dispatch.js'`). Drain loop stays byte-equivalent except the import.

**3c. `affectedFromPayload` + guestRef hydrate.** Parse payload keys per spec §11. After listing rows, batch `SELECT reservation_id, guest_ref FROM reservation WHERE reservation_id IN (…)` for non-null reservation ids (sync SQL). Missing reservation → `guestRef: null`.

**3d. Widen `listProvisionalExceptions`.** Default `filters` undefined / empty → `resolution = 'open'`, no other WHERE, **no LIMIT** (today). `ORDER BY created_at DESC, exception_id DESC`. SELECT the four new columns (`COALESCE` not required — NULL is fine). Map `nextCursor` only when `limit` is set and `exceptions.length === limit` (cursor = last row `{ createdAt, exceptionId }`; next page `created_at < cursor.createdAt OR (created_at = cursor.createdAt AND exception_id < cursor.exceptionId)`).

SQL fragments:

- `resolution=open` → `resolved_at IS NULL` (default)
- `resolved` → `resolved_at IS NOT NULL`
- `all` → omit
- `commandType` → `command_type = ?`
- `reason` → `reason = ?`
- dates → `business_date >= ?` / `<= ?`
- `assigned=unassigned` → `assigned_to IS NULL`
- `assigned=assigned` → `assigned_to IS NOT NULL`
- `assignedTo` → `assigned_to = ?`

**3e. `readProvisionalException`.** Same row mapper including resolved. 404 if missing. `actions` from `audit_log WHERE entity_type = 'provisional_exception' AND entity_id = ? ORDER BY at ASC, seq ASC`. Map:

| `command_id` | `action` |
|---|---|
| `provisional.resolve_exception` | `resolved` |
| `provisional.retry_exception` and `afterJson.action === 'retried'` | `retried` |
| `provisional.retry_exception` and `afterJson.action === 'retry_failed'` | `retry_failed` |
| `provisional.assign_exception` | `assigned` |
| `provisional.add_exception_note` | `noted` |

`notes` = noted rows with `noteId`/`text` from `afterJson`.

**3f. Retry (normative crash protocol)**

Constants next to `PROVISIONAL_RESOLVE_EXCEPTION_COMMAND`:

```ts
export const PROVISIONAL_RETRY_EXCEPTION_COMMAND = 'provisional.retry_exception' as const;
export const PROVISIONAL_ASSIGN_EXCEPTION_COMMAND = 'provisional.assign_exception' as const;
export const PROVISIONAL_ADD_EXCEPTION_NOTE_COMMAND = 'provisional.add_exception_note' as const;
```

`tryRetryProvisionalException`:

1. `assertRpcAvailable`; `lanes.touchInteractive()`; `gatePermission(night_audit:run)`; `gateCoreEntitlement`.
2. Load row. Missing → `NOT_FOUND`. `resolved_at != null` → `ALREADY_RESOLVED` (422, not idempotent success).
3. If `!(command_type in REPLAY_DISPATCH)` → `unknown_command`.
4. If `open_retry_key` is NULL: `transactionSync` `UPDATE … SET open_retry_key = ?` where `?` is `provisional-retry:${exceptionId}:${crypto.randomUUID()}`. Re-read the key.
5. `fingerprint = await fingerprintPayload(REPLAY_DISPATCH[type].fingerprintInput(payload))`.
6. `inner = await REPLAY_DISPATCH[type].invoke(this, payload, { key: open_retry_key, fingerprint }, { issuedAt: row.issued_at, businessDate: row.business_date })` with **operator** actor (`{ kind: 'user', userId }`), not `REPLAY_ACTOR`. Do **not** add a skip-permission flag. Owner/admin with `night_audit:run` already have the inner writes.
7. If `inner.error === 'org_unreachable'` → return that (handler → 503). Leave `open_retry_key` set.
8. `transactionSync` + `runIdempotent(outer idem)`:
   - success (`inner.ok`): if already resolved, return `{ ok: true, retried: true }` without a second outbox pair. Else stamp `resolved_at`/`resolved_by`, `open_retry_key = NULL`, audit `{ action: 'retried', resolvedAt, resolvedBy }`, outbox `provisional.exception_retried` then `provisional.exception_resolved` with `{ propertyId, exceptionId, businessDate, action: 'retried' }`. Return `{ ok: true, retried: true }`.
   - failure: `UPDATE reason, detail` (detail = `JSON.stringify(inner)`), `open_retry_key = NULL`, audit `{ action: 'retry_failed', reason, detail }`. **No** `recordProvisionalException`. **No** `exception_resolved`. Return `{ ok: false, error: reason, retried: false }` where reason is `business_date_closed` if `inner.error === BUSINESS_DATE_CLOSED` else `inner.error`.

Do not `await` inside `runIdempotent`.

**3g. Assign / note**

Assign: open only; `assignedTo` string or `null`; stamp `assigned_at`/`assigned_by` even on unassign; audit + `provisional.exception_assigned`. Fingerprint `{ exceptionId, assignedTo }`.

Note: trim `text`; empty → treat as 400 at HTTP; `text.length > 2000` → `NOTE_TOO_LONG`; count existing `audit_log` rows for this entity + `provisional.add_exception_note` ≥ 50 → `NOTE_LIMIT`. Allowed on resolved. Audit `afterJson: { noteId, text }` + event. Do not UPDATE exception columns. Fingerprint `{ exceptionId, noteId }`.

**3h. Widen `[18]` handler** — parse query with `ISO_DATE_RE`. Invalid `resolution`/`assigned`/`limit` → 400 `{ error: 'invalid_query' }`. Date from > to or bad date → 400. Cursor via existing `decodeFrontDeskCursor<{ createdAt: number; exceptionId: string }>`. Pass filters into RPC. Encode `nextCursor` with `encodeFrontDeskCursor`. Additive `ok: true` on the JSON body. **No-query path** must still return all open rows (existing tests).

**3i. New handlers** — copy `handlePostProvisionalExceptionResolve` for the three POSTs (`fingerprintPayload` as spec: retry `{ exceptionId }`; assign `{ exceptionId, assignedTo }`; note `{ exceptionId, noteId }`). Map `ALREADY_RESOLVED` / `unknown_command` / `NOTE_*` → 422; `NOT_FOUND` → 404; `forbidden` → 403 `night_audit:run`; `org_unreachable` → existing fail-closed 503.

GET detail: `property:read` already enforced by the route. Handler: 404 on `NOT_FOUND`; transport → `degradedFailClosedReadResponse()`.

**3j. `V1_ROUTES` append** (after stream, identical order):

```ts
{
  scope: 'property',
  method: 'GET',
  pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)$/,
  permission: 'property:read',
  entitlement: 'pms.core',
  handler: handleGetProvisionalException,
},
{
  scope: 'property',
  method: 'POST',
  pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/retry$/,
  permission: 'night_audit:run',
  commandId: 'provisional.retry_exception',
  entitlement: 'pms.core',
  handler: handlePostProvisionalExceptionRetry,
},
{
  scope: 'property',
  method: 'POST',
  pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/assign$/,
  permission: 'night_audit:run',
  commandId: 'provisional.assign_exception',
  entitlement: 'pms.core',
  handler: handlePostProvisionalExceptionAssign,
},
{
  scope: 'property',
  method: 'POST',
  pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/notes$/,
  permission: 'night_audit:run',
  commandId: 'provisional.add_exception_note',
  entitlement: 'pms.core',
  handler: handlePostProvisionalExceptionNote,
},
```

List route stays `…/provisional-exceptions$`. Detail is one extra segment. Method-discriminated POSTs under `/:id/retry|assign|notes` do not collide with `/:id/resolve`.

- [ ] **Step 4: Rebuild, tests, permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/exception-workbench.spec.ts test/degraded-mode.spec.ts test/night-audit-precheck.spec.ts test/front-desk-reads.spec.ts test/events-queue.spec.ts
```

Expected: all exit 0. No-query list tests still see only open rows.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/replay-dispatch.ts apps/pms-core/src/pending-commands-consumer.ts \
  apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/exception-workbench.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): exception-queue workbench reads and writers

EOF
)"
```

---

### Task 4: client-core methods

**Spec:** §13 file map; SPA consumes these in Task 5.

**Files:**
- Modify: `packages/client-core/src/api.ts` — widen `getProvisionalExceptions`; add detail + three POSTs next to `resolveProvisionalException` (~1308)
- Create: `packages/client-core/test/api-exception-workbench.test.ts`
- Modify: `packages/client-core/test/api.test.ts` only if an existing snapshot lists method names

**Interfaces (exact method names):**

```ts
getProvisionalExceptions(propertyId: string, query?: {
  resolution?: 'open' | 'resolved' | 'all';
  commandType?: string;
  reason?: string;
  businessDateFrom?: string;
  businessDateTo?: string;
  assigned?: 'all' | 'unassigned' | 'assigned';
  assignedTo?: string;
  limit?: number;
  cursor?: string;
}): Promise<unknown>  // body; existing callers pass one arg

getProvisionalException(propertyId: string, exceptionId: string): Promise<unknown>

retryProvisionalException(propertyId: string, exceptionId: string, opId: string): Promise<unknown>

assignProvisionalException(
  propertyId: string,
  exceptionId: string,
  assignedTo: string | null,
  opId: string,
): Promise<unknown>

addProvisionalExceptionNote(
  propertyId: string,
  exceptionId: string,
  input: { noteId: string; text: string },
  opId: string,
): Promise<unknown>
```

POSTs mint `idempotencyKey` via existing `stableKeyForOperation(opId, opts.keyStore)` like `resolveProvisionalException`. Bodies: retry `{ idempotencyKey }`; assign `{ assignedTo, idempotencyKey }`; note `{ noteId, text, idempotencyKey }`.

`getProvisionalExceptions`: if `query` omitted, URL has **no** search string (preserves today’s no-query semantics). If present, `URLSearchParams` only for defined keys.

- [ ] **Step 1: Write failing client tests** — assert method, path, query string, JSON bodies (copy `api.test.ts` fetch-mock style).
- [ ] **Step 2: Run to fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-exception-workbench.test.ts
```

- [ ] **Step 3: Implement methods**
- [ ] **Step 4: Rebuild + tests**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core exec vitest run test/api-exception-workbench.test.ts test/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/test/api-exception-workbench.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): exception-queue workbench API methods

EOF
)"
```

---

### Task 5: SPA workbench + badge-as-link + night-audit deep link

**Spec:** §12, §16.18–23.

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/screens/ExceptionsPanel.tsx` + `ExceptionsPanel.test.tsx`
- Create: `apps/web-pms/src/screens/ExceptionsScreen.tsx` + `ExceptionsScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/NightAuditScreen.tsx` + `NightAuditScreen.test.tsx` if it pins the hash
- Modify: `apps/web-pms/src/auth/me.test.ts`
- Modify: `apps/web-pms/src/shell/AppShell.boot.test.tsx` — `/Replay exceptions/i` → `/Exceptions/i` (heading **Exceptions**; keep `data-testid="exceptions-panel"`)
- Modify: `apps/web-pms/src/shell/AppShell.me.test.tsx` / `AppShell.search.test.tsx` / `StaffScreen.test.tsx` mocks only if they break
- Optional CSS in `apps/web-pms/src/styles.css` — **no** `transition: all`; honor `prefers-reduced-motion` if you add motion

**Nav entry (exact):**

```ts
{ id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 65, permission: 'property:read' },
```

Insert between night-audit (60) and settings (70).

**Badge:** `<Link to="/exceptions">` wrapping the count `<span className={badge ${statusClass(badgeSev)}}>`. Remove `open` state, list query, Resolve. Keep count query + fail-closed `<p className="error">`. Heading text **Exceptions**. `id="replay-exceptions"` may remain on the section.

**Workbench:** `data-testid="exceptions-workbench"`. Filters sync to URL via `useSearchParams` (`replace`). Table + checkboxes + detail drawer. Writer buttons iff `night_audit:run`. Confirmation `<dialog>` (or existing modal pattern) before Resolve and before batch; never immediate. Batch cap 50; distinct `opId`s. Folio `<Link to={/folio/${id}}>`; check-in extra link only for `reservations.check_in`; room → `/housekeeping`; guestRef as `translate="no"` text (batch hydrate if refs present). Command type `<select>` includes `REPLAY_COMMAND_IDS` — hardcode the eight shipped ids in the SPA (do not import pms-core). Assign to Me = `me.userId`; member `<select>` only when `listPropertyMembers` succeeds (`staff:read`). Note textarea `autocomplete="off"`; warn on dirty navigate (`beforeunload` + `useBlocker` if the app already has `use-unsaved-changes.ts` from property-setup — reuse it).

Submit enabled until in-flight; labels “Retrying…” / “Resolving…” / “Saving…”. `aria-live="polite"` on outcome. `tabular-nums` on dates. Title Case headers.

**Night audit:**

```tsx
<Link
  to={`/exceptions?resolution=open&businessDateFrom=${encodeURIComponent(status.businessDate)}&businessDateTo=${encodeURIComponent(status.businessDate)}`}
>
  Open exceptions
</Link>
```

Replace `<a href="#replay-exceptions">`.

- [ ] **Step 1: Write failing SPA tests**

`me.test.ts`: live `property:read` includes `'exceptions'` in filtered ids; order 65 (exceptions after `night-audit`, before `settings`).

`ExceptionsPanel.test.tsx`: rewrite the Resolve test — staff/owner both see a **link** named `/exceptions/i` (or `href` ending `/exceptions`); **no** Resolve button; click does not call `resolveProvisionalException`. Wrap with `MemoryRouter`.

`ExceptionsScreen.test.tsx`: filters write `?resolution=`; Retry/Resolve/Assign/Note present for owner, absent for staff; confirmation before resolve; Folio link for a check-in row; no guest CRM href.

`NightAuditScreen.test.tsx`: link `href` includes `/exceptions?resolution=open`.

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/ExceptionsPanel.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/auth/me.test.ts \
  src/screens/NightAuditScreen.test.tsx \
  src/shell/AppShell.boot.test.tsx
```

- [ ] **Step 3: Implement screens / nav / App route**
- [ ] **Step 4: Re-run tests + colors**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/ExceptionsPanel.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/NightAuditScreen.test.tsx \
  src/auth/me.test.ts \
  src/shell/AppShell.boot.test.tsx \
  src/shell/AppShell.me.test.tsx \
  src/shell/AppShell.search.test.tsx
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/App.tsx \
  apps/web-pms/src/screens/ExceptionsPanel.tsx apps/web-pms/src/screens/ExceptionsPanel.test.tsx \
  apps/web-pms/src/screens/ExceptionsScreen.tsx apps/web-pms/src/screens/ExceptionsScreen.test.tsx \
  apps/web-pms/src/screens/NightAuditScreen.tsx apps/web-pms/src/screens/NightAuditScreen.test.tsx \
  apps/web-pms/src/auth/me.test.ts apps/web-pms/src/shell/AppShell.boot.test.tsx \
  apps/web-pms/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web-pms): exception-queue operator workbench

EOF
)"
```

Omit `styles.css` if unchanged. Add any other AppShell test files you actually edited.

---

### Task 6: Bidirectional leftover pointers (docs only)

**Spec:** Amends blurb; §13. **When this chunk lands** — this is that commit. Do not mix typecheck fixes.

**Files (one sentence each, do not rewrite):**
- `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` — leftovers **9** and **10** closed by exception-queue workbench spec
- `docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md` — leftover **10** closed
- `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — leftover **11** closed
- `ARCHITECTURE.md` — drop “the exception-queue operator UX” from the 2026-07-27c **Still owed** sentence (keep fiscalization). Optional one sentence in §16.3 that the exception screen now has a live SPA.

Pointer sentence example (adapt per file):

```markdown
**Closed 2026-08-13** by [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md).
```

- [ ] **Step 1: Edit pointers**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md \
  docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: point leftover specs at the exception-queue workbench

EOF
)"
```

---

### Task 7: CI / checks job

**Spec:** §2 invariants, §16.1–5, §16.23, §17.

- [ ] **Step 1: Hygiene pins**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations/do-property packages/do-runtime/src/property-migrations.ts
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
```

Expected: no-op after Task 2’s SQL is already committed. `PROPERTY_SCHEMA_HEAD === 25`. `NIGHT_AUDIT_STEPS.length === 7`. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `[119]=get_front_desk_stream`; `[120]`–`[123]` as spec. `CLASS_DENYLIST` untouched.

- [ ] **Step 2: `checks` job — copy `.github/workflows/ci.yml` in order**

```bash
pnpm install
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

- [ ] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 8: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–8 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [ ] **Step 1: Mark checkboxes**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-exception-queue-workbench.md
git commit -m "$(cat <<'EOF'
docs: tick exception-queue workbench plan checkboxes after merge

EOF
)"
```

---

## Spec §17 acceptance / reviewer checklist (copied; implementation must satisfy)

- [ ] Four routes appended at **120–123** only; `[119]` / `[18]` / `[19]` / `[91]` unmoved. List filters are query params on `[18]`, not a fifth audit row.
- [ ] Catalog **77**; three new FAIL_CLOSED INTERACTIVE commands with events; audit writers **52**; `PLATFORM_GAPS` [].
- [ ] v25 ALTER four columns on `provisional_exception`; **no new table**; purge list unchanged; `NIGHT_AUDIT_STEPS` 7; no new `export class`.
- [ ] Command decision §4: resolve reused; retry / assign / note new; batch is SPA-only; list/count reused.
- [ ] Retry uses `REPLAY_DISPATCH` + `open_retry_key`; never the original idempotency key; never QUEUE_PROVISIONAL; preserves `issuedAt` / `businessDate`; success resolves; failure updates the same row.
- [ ] Assign + notes + audit trail on the exception (audit_log compose). Notes append-only.
- [ ] Badge stays; click → `/exceptions`. Inline list/resolve removed from the panel.
- [ ] Filters: command type, business date, reason (status), resolution state. Batch resolve/retry with confirmation. One-click folio / check-in / housekeeping links. No guest CRM.
- [ ] Exception reads `FAIL_CLOSED`. No `READ_STALE` reclass. No WebSocket work. No ui-kit.
- [ ] Scope-out §1.3 / §15 named. Folded leftovers §14 and deferred §15 both present. Guidelines §12.5 applied.
- [ ] Tests §16 green.
- [ ] ARCHITECTURE “Still owed” exception-queue UX closed in the implementation PR; fiscalization remains.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Catalog 77, writers 52, three FAIL_CLOSED commands, event allowlist | 1 |
| Wire codes `already_resolved` / `note_too_long` / `note_limit` | 1 |
| v25 ALTER four columns, no new table, MemorySql, real SQLite | 2 |
| Routes 120–123; `[18]` query widen; `[19]`/`[91]` untouched | 3 |
| Shared `REPLAY_DISPATCH`; retry crash protocol; assign; notes via audit_log | 3 |
| `affectedFromPayload` + guestRef hydrate | 3 |
| client-core methods | 4 |
| Badge-as-link, `/exceptions`, filters, batch, links, night-audit Link | 5 |
| Leftover pointers + ARCHITECTURE still-owed trim | 6 |
| Full CI, schema 25, catalog 77, no new class/table | 7 |
| Plan checkboxes | 8 |
| No WS / ui-kit / new table / batch command / extras dispatch | all (forbidden) |
