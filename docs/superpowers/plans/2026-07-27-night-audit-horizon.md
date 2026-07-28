# Night Audit Spine + Horizon Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship AlarmScheduler → NightAuditWorkflow → idempotent `runAuditStep`, with `ROLL_BUSINESS_DATE` set-reconciling the availability horizon so bookability does not shrink.

**Architecture:** Named alarm schedules in DO SQL multiplex one `setAlarm`. Workflow resolves PropertyDO via registry only. Horizon uses timezone-free `enumerateFromDate`; roll refuses unless `business_date < today`; catch-up inserts missing dates with `physical = room_count`.

**Tech Stack:** Cloudflare Durable Objects, Workflows, D1, TypeScript, vitest / vitest-pool-workers, pnpm, turbo.

## Global Constraints

- `enumerateFromDate(startDate, days)` has **no** `timeZone` parameter — calendar step only.
- Horizon always anchored to `__meta.business_date`, never wall clock in `addRoomType`.
- Catch-up = set-reconcile `enumerateFromDate(businessDate, HORIZON_DAYS)`; inserts use current `room_count`; never overwrite existing ledger cells.
- `ROLL_BUSINESS_DATE` refuses advance unless `business_date < today` (property TZ).
- AlarmScheduler: per-schedule catch; **always** `setAlarm` after run; no direct `setAlarm` outside scheduler.
- `HALTED` = any `night_audit_run.status = 'FAILED'`; block new runs while halted.
- Workflow: `resolvePropertyFromRegistry` only — never `idFromName`.
- Schedule `next_run_at` written in same txn as config when `consumers.reschedulesNightAudit`; `setAlarm` after commit.
- Provision arms `night-audit` schedule + initial `setAlarm`.
- Events: `night_audit.started`, `night_audit.completed` (catalog); `availability.changed` on horizon inserts.
- Commit to `main` per task; TDD where specified.
- Spec: `docs/superpowers/specs/2026-07-27-night-audit-horizon-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `modules/pms/inventory/src/domain/horizon.ts` | `enumerateFromDate` + refactor `enumerateHorizonDates` |
| `packages/do-runtime/src/alarm-scheduler.ts` | AlarmScheduler |
| `packages/do-runtime/src/property-migrations.ts` | v3 `alarm_schedule` DDL |
| `apps/pms-core/src/property-do.ts` | business_date, audit steps, roll, reschedule, config hook |
| `apps/pms-core/src/night-audit-workflow.ts` | Workflow class |
| `apps/pms-core/src/provision.ts` | business_date + arm schedule |
| `apps/pms-core/wrangler.jsonc` | `NIGHT_AUDIT_WORKFLOW` binding |
| `apps/pms-core/src/env.ts` | Workflow binding type |
| `apps/pms-core/test/night-audit.spec.ts` | Integration tests |
| `packages/contracts` | `BUSINESS_DATE_UNSET` wire code |

---

### Task 1: `enumerateFromDate` + dual-TZ tests

**Files:**
- Modify: `modules/pms/inventory/src/domain/horizon.ts`
- Modify: `modules/pms/inventory/src/domain/horizon.test.ts`
- Modify: `modules/pms/inventory/src/index.ts`

**Interfaces:**
- Produces: `enumerateFromDate(startDate: string, days?: number): string[]`
- `enumerateHorizonDates` derives local Y-M-D then calls `enumerateFromDate`

- [ ] **Step 1: Failing tests**

```ts
it('enumerateFromDate is pure calendar (no TZ)', () => {
  expect(enumerateFromDate('2026-07-27', 3)).toEqual([
    '2026-07-27', '2026-07-28', '2026-07-29',
  ]);
});

it('enumerateFromDate identical under TZ=UTC and TZ=Pacific/Auckland', () => {
  // Run via vitest with process.env.TZ set in two describe blocks, or spawn:
  // assert same array for enumerateFromDate('2026-01-16', 5)
});
```

For dual-TZ: either two `describe` files run with `TZ=… vitest`, or one test that only calls `enumerateFromDate` (structurally TZ-free) plus a subprocess:

```ts
import { spawnSync } from 'node:child_process';
function runUnder(tz: string) {
  return spawnSync('node', ['-e', `
    import { enumerateFromDate } from './dist/…';
    console.log(JSON.stringify(enumerateFromDate('2026-01-16', 5)));
  `], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
}
```

Prefer simpler approach: unit-test `enumerateFromDate` only (no Date parsing); keep `enumerateHorizonDates` tests with `…Z` instants. Add explicit comment that `enumerateFromDate` must never call `Date` with local parse. Dual-TZ subprocess optional if timeboxed — **minimum:** document + test that `enumerateFromDate` uses only string/UTC-noon stepping from parsed `YYYY-MM-DD` parts via `Date.UTC`.

Implementation of `enumerateFromDate`:

```ts
export function enumerateFromDate(startDate: string, days: number = HORIZON_DAYS): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) throw new Error(`invalid date: ${startDate}`);
  let y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const t = Date.UTC(y, mo - 1, d + i); // day arithmetic in UTC calendar
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return out;
}
```

Refactor `enumerateHorizonDates` to format local date then `return enumerateFromDate(local, days)`.

- [ ] **Step 2: GREEN + export + commit**

```bash
pnpm --filter @hospai/pms-inventory test
git commit -m "$(cat <<'EOF'
Add timezone-free enumerateFromDate for horizon set-reconcile.

EOF
)"
```

---

### Task 2: AlarmScheduler + DDL v3

**Files:**
- Create: `packages/do-runtime/src/alarm-scheduler.ts`
- Create: `packages/do-runtime/src/alarm-scheduler.test.ts`
- Modify: `packages/do-runtime/src/property-migrations.ts` (v3 statements)
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `scripts/property-ddl.mjs` (third do-property file)
- Generate: `migrations/do-property/0003_alarm_schedule.sql`

**Interfaces:**
- Produces:

```ts
export type AlarmHandler = () => void | Promise<void>;
export class AlarmScheduler {
  constructor(private sql: SqlStorageLike, private storage: { setAlarm(t: number): Promise<void>; getAlarm(): Promise<number | null> });
  upsertSchedule(name: string, nextRunAt: number): void; // sync SQL
  run(handlers: Record<string, AlarmHandler>): Promise<void>; // catch each; always setAlarm
  armFromTable(): Promise<void>; // setAlarm(min next_run_at)
}
```

DDL:

```sql
CREATE TABLE alarm_schedule (
  name TEXT PRIMARY KEY,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 1: Test — throwing handler still arms**

Memory fake for storage + sql; register two schedules; one handler throws; assert `setAlarm` called with a future time.

- [ ] **Step 2: Implement + migrate v3 + generate:ddl + commit**

```bash
pnpm generate:ddl && pnpm check:ddl && pnpm --filter @hospai/do-runtime test
git commit -m "$(cat <<'EOF'
Add AlarmScheduler with failure isolation and alarm_schedule DDL.

EOF
)"
```

---

### Task 3: business_date at provision + inventory seed fix

**Files:**
- Modify: `packages/contracts/src/idempotency.ts` — `BUSINESS_DATE_UNSET`
- Modify: `apps/pms-core/src/property-do.ts` — `ensureBusinessDateIfAbsent`, `readBusinessDateSync`, `ensureNightAuditSchedule`, wire AlarmScheduler
- Modify: `apps/pms-core/src/provision.ts` — call ensure business_date + arm schedule after timezone
- Modify: `apps/pms-core/src/property-do.ts` `tryAddRoomType` — require business_date; seed via `enumerateFromDate(businessDate)`
- Modify: tests (`inventory.spec.ts`, `tenancy.spec.ts`) — schema version → 3; seed assertions

**Interfaces:**
- `ensureBusinessDateIfAbsent(timeZone, instant)` — raw SQL first-write
- `readBusinessDateSync(): string | null`
- After meta writes: `scheduler.upsertSchedule('night-audit', nextAuditAt); await scheduler.armFromTable()`

- [ ] **Step 1: Tests**

Provision → `readBusinessDate()` set; schedule row present.  
`tryAddRoomType` without business_date → `business_date_unset`.  
Add with business_date → first stay_date equals business_date.

- [ ] **Step 2: Implement + fix schema version asserts to 3 + commit**

```bash
pnpm --filter @hospai/pms-core test
git commit -m "$(cat <<'EOF'
Provision business_date and arm night-audit schedule; seed from business_date.

EOF
)"
```

---

### Task 4: `runAuditStep` + ROLL + horizon reconcile

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create helpers in inventory or property-do: `reconcileHorizon(sql, businessDate)` 

**Step constants:**

```ts
export const NIGHT_AUDIT_STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;
```

**`runAuditStep(businessDate, step)`:**
- If COMPLETED → return `{ status: 'COMPLETED' }`
- Emit `night_audit.started` once per businessDate (when first step transitions to RUNNING)
- PRE_CHECK / stubs → COMPLETED immediately (§4.6 comment on PRE_CHECK)
- ROLL: if `business_date >= today` → COMPLETED no-op (no advance). Else advance +1 via `enumerateFromDate(bd, 2)[1]`; reconcile horizon; ARI bump if inserts; `availability.changed`; mark COMPLETED
- ARCHIVE → COMPLETED; emit `night_audit.completed`
- On throw → FAILED row

**`isNightAuditHalted()`:** `SELECT 1 FROM night_audit_run WHERE status = 'FAILED' LIMIT 1`

**`startNightAudit()`:** if halted return error; else run all steps inline for tests OR create Workflow (Task 5). For Task 4, inline loop of `runAuditStep` is OK so DO tests work without Workflow; Task 5 switches alarm path to Workflow and keeps inline for unit tests.

- [ ] **Step 1: night-audit.spec.ts cases 3–6, 8, 11 (DO-level)**

- [ ] **Step 2: Implement + GREEN + commit**

```bash
git commit -m "$(cat <<'EOF'
Implement runAuditStep with ROLL_BUSINESS_DATE horizon set-reconcile.

EOF
)"
```

---

### Task 5: Workflow + wrangler + reschedule hooks

**Files:**
- Create: `apps/pms-core/src/night-audit-workflow.ts`
- Modify: `apps/pms-core/src/index.ts` — export Workflow
- Modify: `apps/pms-core/wrangler.jsonc` — workflows binding
- Modify: `apps/pms-core/src/env.ts` — `NIGHT_AUDIT_WORKFLOW`
- Modify: PropertyDO `alarm()` + `rescheduleNightAudit` + config consumer hook
- Modify: vitest.config if needed for workflow

**Workflow sketch:**

```ts
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

export class NightAuditWorkflow extends WorkflowEntrypoint<PmsEnv, { propertyId: string }> {
  async run(event: WorkflowEvent<{ propertyId: string }>, step: WorkflowStep) {
    const resolved = await step.do('resolve', async () => {
      return resolvePropertyFromRegistry(this.env, event.payload.propertyId);
    });
    if (!resolved) return;
    const stub = resolved.stub;
    if (await stub.isNightAuditHalted()) return;
    const businessDate = await stub.readBusinessDate();
    for (const s of NIGHT_AUDIT_STEPS) {
      await step.do(s, async () => stub.runAuditStep(businessDate!, s));
    }
    await step.do('reschedule', async () => stub.rescheduleNightAudit());
  }
}
```

**wrangler.jsonc:**

```jsonc
"workflows": [
  {
    "binding": "NIGHT_AUDIT_WORKFLOW",
    "name": "hospai-night-audit",
    "class_name": "NightAuditWorkflow"
  }
]
```

**`rescheduleNightAudit`:** sync upsert `next_run_at`; then `armFromTable()`.

**Config hook:** inside `transactionSync` after config write, if `reschedulesNightAudit`, `upsertSchedule`; after txn, `armFromTable()`.

**Alarm handler:** `env.NIGHT_AUDIT_WORKFLOW.create({ id: `na-${propertyId}-${Date.now()}`, params: { propertyId } })` — propertyId from `__meta.property_id`.

- [ ] **Step 1: Tests for halt, not-ahead, schedule arm, matrix reschedule**

- [ ] **Step 2: Full pipeline**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm check:ddl
```

- [ ] **Step 3: README + commit**

```bash
git commit -m "$(cat <<'EOF'
Wire NightAuditWorkflow, AlarmScheduler alarm path, and reschedule hooks.

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `enumerateFromDate` | 1 |
| AlarmScheduler never-dark | 2 |
| business_date + arm on provision | 3 |
| addRoomType from business_date | 3 |
| ROLL + set-reconcile + room_count physical | 4 |
| roll not ahead / HALTED derived | 4–5 |
| Workflow registry + reschedule callback | 5 |
| Matrix reschedule in txn | 5 |
| Catalog night_audit events | 4 |
| Dual-TZ / pure date tests | 1 |

## Self-review notes

- Vitest-pool-workers Workflow support may be limited — prefer DO-inline `startNightAudit` for most tests; one dry-run Workflow create if pool supports it.
- Update `getSchemaVersion` expectations to **3** wherever they still say 2.
- Do not expose HTTP for night audit in this slice.
