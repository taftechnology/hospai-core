# Cross-Store Purge Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the §4.8 `PurgeWorkflow` spine — Platform D1 lifecycle + certificates, status-gated traffic, guest housekeeping after shred, and owner-driven org churn — with honest certificate scope (skipped ≠ purged).

**Architecture:** One `PurgeWorkflow` (`kind: 'guest' | 'org'`) with per-kind step plans and a try/catch wrapper that appends a certificate on every terminal exit. Guest runs from `guest.erased` outbox; org runs from admin HTTP that only creates the Workflow. Registry status gates all write paths via `assertTenantActive`.

**Tech Stack:** Cloudflare Workflows + D1 + Durable Objects (vitest-pool-workers), `@hospai/do-runtime` platform migrations, contracts permissions, module-manifests check script

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-purge-workflow-design.md` (normative)
- Certificate: no PII; five §4.8 stores always listed; skipped stores carry `reason`; `reached` + `deleted: 0` ≠ skipped
- Every terminal state leaves a certificate (`run()` wrapper — not optional)
- Org attempt id: `purge-org-${orgId}-${attempt}` where `attempt = 1 + COUNT(*) WHERE org_id = ? AND kind = 'org'`
- Guest Workflow id: `purge-guest-${guestRef}` (no attempt suffix)
- `guests.erase` stays **200**; org purge returns **202**; never start guest Workflow from HTTP handler
- Admin purge route writes **no** D1 status — Workflow owns `'purging'`
- Org graph ≠ property graph (`property` has no `closing`)
- Purge DO RPCs: BULK admit, **no** `touchInteractive()`
- Tenant wipe: atomic `deleteAll()` (not chunked); guest OrgDO: `profile_* = x''` (not NULL)
- `ORG_PURGE_RETENTION_MS` is a platform constant; tests inject `now`, do not shrink production constant
- R2/Iceberg: declare skip steps only — no bodies
- No module `onPurge` trigger; entitlement check + `--self-test` only

## File map

| File | Role |
|---|---|
| `packages/do-runtime/src/platform-migrations.ts` | `PLATFORM_PURGE_STATEMENTS` — ALTER org, purge_certificate, triggers |
| `migrations/d1-platform/0004_purge.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | Emit 0004 target |
| `apps/pms-core/src/registry.ts` | Lifecycle helpers, certificates, `assertTenantActive`, try* |
| `packages/contracts/src/permissions.ts` | `org:cancel`, `org:purge`, `SystemActor` `'purge'` |
| `packages/contracts/src/v1-http-routes.ts` | Route audit rows |
| `apps/pms-core/src/purge-certificate.ts` | Types, PITR limitation, column allowlist export |
| `apps/pms-core/src/purge-workflow.ts` | WorkflowEntrypoint + step plans + HALT wrapper |
| `apps/pms-core/src/env.ts` + `wrangler.jsonc` + `index.ts` | `PURGE_WORKFLOW` binding |
| `apps/pms-core/src/org-do.ts` / `property-do.ts` | Purge RPCs |
| `apps/pms-core/src/event-consumer.ts` | Start guest Workflow on `guest.erased` |
| `apps/pms-core/src/v1-dispatch.ts` | Cancel/purge routes; erase body; status gate |
| `apps/pms-core/src/pending-commands-consumer.ts` | Status gate before replay |
| `scripts/module-manifests-check.mjs` (or new `scripts/purge-check.mjs`) | `onPurge` entitlement rule + certificate column check |
| `apps/pms-core/test/purge-workflow.spec.ts` | Load-bearing tests (`isolatedStorage: false`) |

---

### Task 1: Platform D1 purge schema + lifecycle triggers

**Files:**
- Modify: `packages/do-runtime/src/platform-migrations.ts`
- Modify: `scripts/property-ddl.mjs` (add 0004 target)
- Modify: `packages/do-runtime/src/index.ts` (re-export)
- Create (via generate): `migrations/d1-platform/0004_purge.sql`
- Test: `apps/pms-core/test/purge-registry.spec.ts`

**Interfaces:**
- Produces: `PLATFORM_PURGE_STATEMENTS`, `PLATFORM_PURGE_SQL`; included in `PLATFORM_ALL_STATEMENTS`
- Consumes: existing `ensurePlatformSchema` path

- [ ] **Step 1: Write failing registry tests**

```ts
// apps/pms-core/test/purge-registry.spec.ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ensurePlatformSchema,
  insertOrg,
  insertProperty,
  resetPlatformSchemaGate,
  tryDeleteOrg,
  tryDeleteProperty,
  tryDeletePurgeCertificate,
  trySetOrgStatus,
  trySetPropertyStatus,
  tryUpdatePurgeCertificate,
} from '../src/registry.js';

describe('purge registry invariants', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('org: purged → active aborts', async () => {
    await insertOrg(env, { orgId: 'org_term', name: 'T' });
    // drive to purged via raw allowed steps in helper or sequential trySet*
    expect((await trySetOrgStatus(env, 'org_term', 'closing')).ok).toBe(true);
    expect((await trySetOrgStatus(env, 'org_term', 'purging')).ok).toBe(true);
    expect((await trySetOrgStatus(env, 'org_term', 'purged')).ok).toBe(true);
    const r = await trySetOrgStatus(env, 'org_term', 'active');
    expect(r.ok).toBe(false);
  });

  it('property: active → closing aborts; active → purging ok', async () => {
    await insertOrg(env, { orgId: 'org_p', name: 'P' });
    await insertProperty(env, {
      propertyId: 'prop_p',
      orgId: 'org_p',
      name: 'P',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await trySetPropertyStatus(env, 'prop_p', 'closing')).ok).toBe(false);
    expect((await trySetPropertyStatus(env, 'prop_p', 'purging')).ok).toBe(true);
  });

  it('org/property DELETE abort; purge_certificate UPDATE/DELETE abort', async () => {
    expect((await tryDeleteOrg(env, 'org_term')).ok).toBe(false);
    // insert certificate row then:
    expect((await tryUpdatePurgeCertificate(env, 'cert_1')).ok).toBe(false);
    expect((await tryDeletePurgeCertificate(env, 'cert_1')).ok).toBe(false);
  });
});
```

Adjust helpers to match existing `insertOrg` signatures in `registry.ts`.

- [ ] **Step 2: Run test — expect FAIL** (helpers/triggers missing)

```bash
pnpm --filter @hospai/pms-core test -- test/purge-registry.spec.ts
```

- [ ] **Step 3: Add `PLATFORM_PURGE_STATEMENTS`**

In `platform-migrations.ts` (do **not** rewrite applied `0001` CREATE TABLE — ALTER only):

```ts
export const ORG_PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30d — document in DPA

export const PLATFORM_PURGE_STATEMENTS: string[] = [
  `ALTER TABLE org ADD COLUMN closing_at INTEGER`,
  `ALTER TABLE org ADD COLUMN purge_not_before INTEGER`,

  `CREATE TABLE IF NOT EXISTS purge_certificate (
  certificate_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'org')),
  org_id TEXT,
  subject_json TEXT NOT NULL,
  stores_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  operator_user_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('certified', 'halted')),
  halt_reason TEXT,
  started INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  certified INTEGER
)`,

  `CREATE INDEX IF NOT EXISTS purge_certificate_org_kind_recorded_idx
   ON purge_certificate (org_id, kind, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS purge_certificate_workflow_idx
   ON purge_certificate (workflow_id)`,

  // org_no_delete, property_no_delete
  // org_status insert/update transition triggers (active↔closing, closing→purging, purging→purged, purged→ABORT)
  // property_status triggers (active→purging, purging→purged, purged→ABORT; reject closing)
  // purge_certificate_no_update, purge_certificate_no_delete
];
```

Wire into `PLATFORM_ALL_STATEMENTS`. Add `PLATFORM_PURGE_SQL` export.

Note: SQLite `ALTER TABLE ADD COLUMN` fails if re-run. `ensurePlatformSchema` today loops all statements — either catch “duplicate column” as success in apply, or gate purge ALTERs behind a `schema_meta` flag. Prefer: apply purge statements with try/catch ignoring duplicate-column errors (document in registry apply helper), same as idempotent IF NOT EXISTS for the rest.

- [ ] **Step 4: Wire `property-ddl.mjs` 0004 target + generate**

```js
{
  path: join(root, 'migrations/d1-platform/0004_purge.sql'),
  header: `-- Platform D1 purge / tenant lifecycle (§4.8) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
  sql: PLATFORM_PURGE_SQL,
},
```

```bash
pnpm generate:ddl
pnpm check:ddl
```

- [ ] **Step 5: Implement try* helpers in `registry.ts`**

```ts
export async function trySetOrgStatus(env: PmsEnv, orgId: string, status: string): Promise<{ ok: true } | { ok: false; error: string }>
export async function trySetPropertyStatus(env: PmsEnv, propertyId: string, status: string): Promise<{ ok: true } | { ok: false; error: string }>
export async function tryDeleteOrg(...)
export async function tryDeleteProperty(...)
export async function tryUpdatePurgeCertificate(env, certificateId): Promise<...>
export async function tryDeletePurgeCertificate(env, certificateId): Promise<...>
```

Copy catch pattern from `tryDeleteSubscription`.

- [ ] **Step 6: Run tests — expect PASS; commit**

```bash
pnpm --filter @hospai/pms-core test -- test/purge-registry.spec.ts
git add packages/do-runtime scripts/property-ddl.mjs migrations/d1-platform/0004_purge.sql apps/pms-core/src/registry.ts apps/pms-core/test/purge-registry.spec.ts
git commit -m "feat(d1): purge certificate table and tenant lifecycle triggers"
```

---

### Task 2: Retention helpers, certificates, attempt counter

**Files:**
- Create: `apps/pms-core/src/purge-certificate.ts`
- Modify: `apps/pms-core/src/registry.ts`
- Modify: `apps/pms-core/test/purge-registry.spec.ts`

**Interfaces:**
- Produces:
  - `ORG_PURGE_RETENTION_MS` re-export / import from do-runtime
  - `PITR_LIMITATION = 'do_pitr_not_covered_phase0'`
  - `PURGE_CERTIFICATE_COLUMNS` allowlist (frozen string array)
  - `appendPurgeCertificate(env, row): Promise<void>`
  - `countOrgPurgeCertificates(env, orgId): Promise<number>` — **`kind = 'org'` only**
  - `nextOrgPurgeWorkflowId(env, orgId): Promise<string>` → `purge-org-${orgId}-${1+count}`
  - `guestPurgeWorkflowId(guestRef): string` → `purge-guest-${guestRef}`
  - `evaluateOrgRetention(row, now: number): { ok: true } | { ok: false; reason: 'not_closing' | 'purge_not_before_null' | 'retention_not_elapsed' }`
  - `closeOrgForPurge(env, orgId, opts?: { now?: () => number; retentionMs?: number })` — sets `closing` + stamps
  - `reopenOrg(env, orgId)` — `closing → active`, clears stamps

- [ ] **Step 1: Failing tests for retention + attempt isolation**

```ts
it('evaluateOrgRetention rejects null purge_not_before and active status', () => {
  expect(evaluateOrgRetention({ status: 'active', purge_not_before: null }, Date.now()).ok).toBe(false);
  expect(evaluateOrgRetention({ status: 'closing', purge_not_before: null }, Date.now()).reason)
    .toBe('purge_not_before_null');
});

it('org attempt count ignores guest certificates', async () => {
  await insertOrg(env, { orgId: 'org_a', name: 'A' });
  await appendPurgeCertificate(env, { /* kind: 'guest', org_id: 'org_a', ... */ });
  expect(await countOrgPurgeCertificates(env, 'org_a')).toBe(0);
  expect(await nextOrgPurgeWorkflowId(env, 'org_a')).toBe('purge-org-org_a-1');
  await appendPurgeCertificate(env, { /* kind: 'org', org_id: 'org_a', outcome: 'halted', ... */ });
  expect(await nextOrgPurgeWorkflowId(env, 'org_a')).toBe('purge-org-org_a-2');
});
```

- [ ] **Step 2: Run — FAIL; implement; PASS; commit**

```bash
git commit -m "feat(registry): purge certificate append and org retention helpers"
```

`evaluateOrgRetention` must use three explicit checks in JS (never bare `now >= purge_not_before` alone).

---

### Task 3: Permissions + SystemActor + route audit stubs

**Files:**
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts` (if permission closed-set tests need updates)
- Verify: `pnpm check:permissions`

**Interfaces:**
- Produces: `'org:cancel' | 'org:purge'` in `ORG_SCOPED_PERMISSIONS`; **not** on `admin` ROLE_GRANTS list; owner gets via `GRANTABLE_PERMISSIONS`
- Produces: `SystemActor.reason` includes `'purge'`
- Produces: audit rows (append at end; keep index sync with `V1_ROUTES`):
  - `post_org_cancel` — scope `org`, permission `org:cancel`
  - `post_org_purge` — scope `org`, permission `org:purge`

- [ ] **Step 1: Add permissions + SystemActor reason**

```ts
// ORG_SCOPED_PERMISSIONS — add:
'org:cancel',
'org:purge',

// SystemActor
reason: 'night_audit' | 'migration_sweep' | 'queue_replay' | 'provision' | 'purge';
```

Do **not** add to `admin` array.

- [ ] **Step 2: Append route audit entries** (exact next free indices — read current `V1_HTTP_ROUTE_AUDIT.length` first)

```ts
{ id: 'post_org_cancel', scope: 'org', permission: 'org:cancel' },
{ id: 'post_org_purge', scope: 'org', permission: 'org:purge' },
```

- [ ] **Step 3: `pnpm check:permissions` — will FAIL until Task 7 wires matching `V1_ROUTES` handlers.**  
  **Commit contracts-only with a note, OR defer route audit rows to Task 7 in the same commit as handlers.** Prefer **defer audit rows to Task 7** so `check:permissions` stays green after this task.

- [ ] **Step 4: Commit permissions + SystemActor only**

```bash
git commit -m "feat(contracts): org:cancel/org:purge and SystemActor purge reason"
```

---

### Task 4: `assertTenantActive` + wire dispatch / replay / provision

**Files:**
- Modify: `apps/pms-core/src/registry.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`resolvePropertyContext`, provision/org property POST)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Test: `apps/pms-core/test/purge-tenant-active.spec.ts`

**Interfaces:**
- Produces:
```ts
export type TenantActiveDenial = 'not_found' | 'tenant_not_active';
export async function assertTenantActive(
  env: PmsEnv,
  opts: { orgId?: string; propertyId?: string },
): Promise<{ ok: true } | { ok: false; error: TenantActiveDenial; status?: string }>
```
- Only `status === 'active'` passes. Missing row → `not_found`.

- [ ] **Step 1: Failing tests**

```ts
it('resolvePropertyContext returns 404 tenant_not_active when property status is purging', async () => {
  // provision property, trySetPropertyStatus → purging, GET /v1/properties/:id/rooms → 404 { error: 'tenant_not_active' }
});

it('pending replay acks without invoking when property not active', async () => {
  // set property purging; dispatch pending batch; stub must not be called (spy or side-effect flag)
});

it('provisionProperty refused when org is closing', async () => {
  // closeOrgForPurge; POST org properties → 409/404 tenant_not_active
});
```

- [ ] **Step 2: Implement helper; wire:**

```ts
// resolvePropertyContext — after getProperty:
const gate = await assertTenantActive(ctx.env, { propertyId, orgId: property.orgId });
if (!gate.ok) {
  return json({ error: gate.error }, gate.error === 'not_found' ? 404 : 404);
}
```

Use **404** with `tenant_not_active` (not 403) so existence of purged tenants isn’t confirmed to unauthorized callers beyond not_found class — match existing not_found style unless a prior route uses 409 for lifecycle; stay consistent with `not_found` mapping used for membership.

```ts
// pending-commands-consumer — after resolvePropertyFromRegistry:
const gate = await assertTenantActive(env, { propertyId: provisional.propertyId });
if (!gate.ok) {
  logWarn(ctx, { msg: 'degraded.exception', reason: 'tenant_not_active', ... });
  msg.ack();
  continue;
}
```

Wire provision path similarly before `insertProperty`.

- [ ] **Step 3: PASS; commit**

```bash
git commit -m "feat(registry): assertTenantActive gates dispatch, replay, and provision"
```

---

### Task 5: DO purge RPCs + `deleteAll` smoke

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `apps/pms-core/src/org-entitlement-do.ts` (wipe entry or shared)
- Test: `apps/pms-core/test/purge-do-smoke.spec.ts`

**Interfaces:**
- Produces:
```ts
// PropertyDO
async purgeStorageForTenant(): Promise<{ ok: true; deletedApprox: number } | { ok: false; error: string }>
async getLaneGuardLastInteractiveAtForTest(): Promise<number> // unsafe-local only

// OrgDO
async verifyGuestKeyShredded(guestId: string): Promise<{ ok: true; shredded: boolean } | { ok: false; error: string }>
async clearGuestProfileBlobs(guestId: string): Promise<{ ok: true } | { ok: false; error: string }>
async purgeStorageForTenant(): Promise<{ ok: true; deletedApprox: number } | { ok: false; error: string }>
async countNonBookkeepingRows(): Promise<number> // VERIFY helper — sqlite_master inventory

// OrgEntitlementDO
async purgeStorageForTenant(): Promise<{ ok: true; deletedApprox: number } | { ok: false; error: string }>
```

**Normative RPC body (PropertyDO):**

```ts
async purgeStorageForTenant() {
  this.assertRpcAvailable();
  // NO touchInteractive()
  if (!this.lanes.admitBackground()) {
    return { ok: false as const, error: 'bulk_not_admitted' };
  }
  // optional: count rows before for deletedApprox
  await this.ctx.storage.deleteAll();
  // compat: if alarms survive deleteAll on this compat date, deleteAlarm()
  return { ok: true as const, deletedApprox };
}
```

Guest clear:

```sql
UPDATE guest SET profile_cipher = x'', profile_iv = x'', updated_at = ? WHERE guest_id = ?
```

- [ ] **Step 1: Smoke test (spec §5.1)**

```ts
it('deleteAll remigrates empty; purge does not touchInteractive', async () => {
  const stub = await provisionedPropertyStub('purge_smoke', 'UTC', 'USD');
  await stub.resetLaneGuardForTest({ quietMs: 60_000 });
  // seed a room/reservation via existing helpers so tables have rows
  const before = await stub.getLaneGuardLastInteractiveAtForTest();
  await stub.touchInteractiveForTest?.() // or call any interactive command
  const touched = await stub.getLaneGuardLastInteractiveAtForTest();
  expect(touched).toBeGreaterThan(before);
  const r = await stub.purgeStorageForTenant();
  expect(r.ok).toBe(true);
  expect(await stub.getLaneGuardLastInteractiveAtForTest()).toBe(touched); // unchanged
  expect(await stub.countNonBookkeepingRows()).toBe(0);
  expect(await stub.getSchemaVersion()).toBe(PROPERTY_SCHEMA_HEAD);
});
```

Expose `touchInteractive` via existing interactive command if no test helper — then assert lastInteractiveAt unchanged by purge.

- [ ] **Step 2: Implement RPCs; PASS; commit**

```bash
git commit -m "feat(do): tenant purgeStorage and guest profile blob clear RPCs"
```

---

### Task 6: `PurgeWorkflow` spine + binding + HALT wrapper

**Files:**
- Create: `apps/pms-core/src/purge-workflow.ts`
- Modify: `apps/pms-core/src/env.ts`, `wrangler.jsonc`, `index.ts`
- Modify: `apps/pms-core/vitest.config.ts` comment if it lists Workflow class names
- Test: `apps/pms-core/test/purge-workflow.spec.ts` (start with wrapper + guest skips)

**Interfaces:**
```ts
export type PurgeWorkflowParams =
  | {
      kind: 'guest';
      orgId: string;
      guestRef: string;
      piiKeyId: string;
      operatorUserId: string | null;
      started: number;
    }
  | {
      kind: 'org';
      orgId: string;
      operatorUserId: string;
      started: number;
      /** injectable clocks — production omits */
      nowMs?: number;
      retentionMs?: number;
    };

export class PurgeWorkflow extends WorkflowEntrypoint<PmsEnv, PurgeWorkflowParams> {
  async run(event: WorkflowEvent<PurgeWorkflowParams>, step: WorkflowStep): Promise<void>
}
```

Shared:

```ts
class HaltError extends Error {
  constructor(public reason: string) { super(reason); }
}

async function appendTerminalCertificate(env, params, partial): Promise<void>
// always sets recorded_at; certified only if outcome==='certified'
```

`run()` structure:

```ts
async run(event, step) {
  const params = event.payload;
  const workflowId = params.kind === 'guest'
    ? guestPurgeWorkflowId(params.guestRef)
    : /* from event.id or reconstruct */;
  let stores = initialStoresSkippedR2Iceberg(); // five names; r2/iceberg skipped
  try {
    if (params.kind === 'guest') await this.runGuestPlan(params, step, stores);
    else await this.runOrgPlan(params, step, stores);
  } catch (e) {
    const reason = e instanceof HaltError ? e.reason : (e instanceof Error ? e.message : String(e));
    await appendPurgeCertificate(this.env, {
      outcome: 'halted',
      halt_reason: reason,
      stores_json: JSON.stringify(stores),
      // ...
    });
    return; // do not rethrow after certifying — or rethrow after append if platform requires; prefer append then return so attempt bumps
  }
}
```

Guest plan (minimal first): verify shred → property reached deleted:0 → clear blobs → skip steps → key-state VERIFY → CERTIFY.

Org plan can be stubbed to HALT at retention until Task 8 — but wrapper test needs a throw path.

- [ ] **Step 1: Binding**

```jsonc
{
  "binding": "PURGE_WORKFLOW",
  "name": "hospai-purge",
  "class_name": "PurgeWorkflow"
}
```

```ts
PURGE_WORKFLOW: Workflow<PurgeWorkflowParams>;
```

Export class from `index.ts`.

- [ ] **Step 2: Test wrapper — forced throw leaves halted certificate**

```ts
function fakeWorkflowStep(): WorkflowStep { /* same as migration-sweep */ }

it('terminal wrapper writes halted certificate on throw', async () => {
  // params kind org with status active → step 0 HaltError OR inject throw
  await runPurgeWorkflow(params);
  const row = await env.PLATFORM_DB.prepare(
    `SELECT outcome, halt_reason FROM purge_certificate WHERE org_id = ? AND kind = 'org' ORDER BY recorded_at DESC LIMIT 1`,
  ).bind(params.orgId).first();
  expect(row?.outcome).toBe('halted');
});
```

- [ ] **Step 3: Implement spine + guest plan enough for wrapper + skip recording; PASS; commit**

```bash
git commit -m "feat(workflow): PurgeWorkflow binding with HALT-always-certifies wrapper"
```

---

### Task 7: Guest erase HTTP + event consumer enqueue

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handlePostGuestErase`)
- Modify: `apps/pms-core/src/event-consumer.ts` (and queue consumer entry that calls it — make async if needed)
- Modify: `apps/pms-core/test/guests-routes.spec.ts` / `purge-workflow.spec.ts`

**Interfaces:**
- Erase 200 body: `{ ok: true, guestId, piiKeyId, erased: true, purgeWorkflowId: guestPurgeWorkflowId(guestId) }`
- Consumer on `guest.erased`:
```ts
await env.PURGE_WORKFLOW.create({
  id: guestPurgeWorkflowId(guestRef),
  params: { kind: 'guest', orgId, guestRef, piiKeyId, operatorUserId: null, started: Date.now() },
});
```
Idempotent if instance exists (catch and ignore / treat as success).

Note: today’s `handleDomainEvent` is sync void. Either:
- extend to `handleDomainEvent(message, env): Promise<void>`, or
- handle `guest.erased` in the queue consumer wrapper after `handleDomainEvent` assertions.

Prefer async consumer path that already has `env`.

- [ ] **Step 1: Update erase response expectations in guests-routes tests (still 200)**

- [ ] **Step 2: Integration — erase → run workflow body via `PurgeWorkflow.prototype.run` → assert blobs `x''`, certificate stores**

```ts
expect(stores.find(s => s.store === 'property_do')).toMatchObject({ status: 'reached', deleted: 0 });
expect(stores.find(s => s.store === 'r2')).toMatchObject({ status: 'skipped', reason: 'no_r2_binding' });
expect(limitations).toContain(PITR_LIMITATION);
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(guests): enqueue PurgeWorkflow from guest.erased; return purgeWorkflowId"
```

---

### Task 8: Org cancel + purge HTTP + full org step plan

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` + `V1_ROUTES`
- Modify: `packages/contracts/src/v1-http-routes.ts` (audit rows — same commit)
- Modify: `apps/pms-core/src/purge-workflow.ts` (`runOrgPlan`)
- Test: `purge-workflow.spec.ts`

**Routes:**
- `POST /v1/orgs/:orgId/cancel` — body `{ action: 'close' | 'reopen' }` — `org:cancel`
- `POST /v1/orgs/:orgId/purge` — body `{ orgId, confirm: true }` must echo path orgId — `org:purge` → create Workflow only → **202** `{ workflowId }`

```ts
const workflowId = await nextOrgPurgeWorkflowId(ctx.env, orgId);
try {
  await ctx.env.PURGE_WORKFLOW.create({ id: workflowId, params: { kind: 'org', orgId, operatorUserId: ctx.actor.userId, started: Date.now() } });
} catch (e) {
  // instance exists → still 202 with workflowId
}
return json({ workflowId }, 202);
```

**Org plan steps** (named `step.do`):
0. retention via `evaluateOrgRetention` (inject `params.nowMs ?? Date.now()`)
1. close traffic: org `closing→purging`; list properties; each `active→purging`
2. shred keys (OrgDO helper — shred all non-shredded guest keys or noop if empty)
3. page properties → `purgeStorageForTenant` (sum `deleted`)
4. OrgDO + OrgEntitlementDO `purgeStorageForTenant` (fold into `org_do` store entry)
5–6. skip r2/iceberg steps
7. VERIFY: re-query properties for org; unexpected subject → HaltError; zero-row inventory on each DO
8. CERTIFY + status → purged (org + properties)

- [ ] **Step 1: Happy path test with injectable now**

```ts
await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1000 });
await runPurgeWorkflow({ kind: 'org', orgId, operatorUserId: 'user_owner', started: 0, nowMs: 2000, retentionMs: 1000 });
// assert status purged, certificate certified, attempt bump on prior halt
```

- [ ] **Step 2: Step-0 HALT when active; residue HALT; cascade provision refused**

- [ ] **Step 3: Double POST while “in flight”** — simulate by creating workflow id without completing; second POST returns same id 202

- [ ] **Step 4: `pnpm check:permissions`; PASS tests; commit**

```bash
git commit -m "feat(org): cancel/purge routes and org PurgeWorkflow step plan"
```

---

### Task 9: Module `onPurge` check + certificate column check

**Files:**
- Modify: `scripts/module-manifests-check.mjs` **or** create `scripts/purge-check.mjs`
- Modify: `package.json` (`check:purge` or fold into module-manifests)
- Modify: `.github/workflows/ci.yml`
- Source of allowlist: import or duplicate `PURGE_CERTIFICATE_COLUMNS` from a small JSON/TS exported string list in `packages/contracts` or read from `purge-certificate.ts` via regex (prefer contracts constant to avoid Worker import in Node)

**Interfaces:**
```js
function assertOnPurgeRequirement(manifest) {
  // entitlement === 'pms.core' → lifecycle.onPurge optional
  // else → must have lifecycle.onPurge string
}

function assertCertificateColumns(declaredColumns) {
  // fail if any column matches /name|email|phone|passport|cipher/i etc.
  // fail if declared set !== allowlist from contracts
}
```

- [ ] **Step 1: `--self-test`**
  - `pms.core` without onPurge → OK
  - synthetic `{ entitlement: 'pms.addon.x' }` without onPurge → FAIL
  - column `guest_name` → FAIL

- [ ] **Step 2: Wire CI; commit**

```bash
git commit -m "test(checks): onPurge entitlement gate and purge certificate column allowlist"
```

---

### Task 10: Declared PropertyDO guest-PII column set gate

**Files:**
- Create: `packages/contracts/src/guest-pii-property-columns.ts` (empty allowlist + reasons)
- Modify: purge guest plan / check script to assert declaration

```ts
/** PropertyDO columns that may hold guest PII. Empty in Phase 0 — audit-writers boundary. */
export const PROPERTY_GUEST_PII_COLUMNS: readonly { column: string; reason: string }[] = [
  // reserved examples not enabled:
  // { column: 'billed_party', reason: 'folio billed party — enable when written' },
];
```

Guest `PURGE_PROPERTY_DO` step: if allowlist empty → `deleted: 0` reached. Check script: fail if SQL under `apps/pms-core` writes a column named in a denylist (`billed_party`) unless listed in allowlist — keep YAGNI: **assert allowlist empty and `billed_party` unset in property DDL freeze** via existing freeze gate note, or a tiny self-test that `PROPERTY_GUEST_PII_COLUMNS.length === 0`.

- [ ] **Step 1: Self-test + commit**

```bash
git commit -m "feat(contracts): declare empty PropertyDO guest-PII column set for purge"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Certificate scope / five stores / skipped≠purged | 2, 6, 7, 8 |
| Every terminal state leaves certificate | 6 |
| Platform D1 lifecycle + distinct org/property graphs | 1 |
| Attempt count `kind='org'` only | 2, 8 |
| `assertTenantActive` ×4 sites | 4 |
| Guest 200 + outbox trigger + `x''` | 5, 7 |
| Org cancel/purge, Workflow owns purging | 8 |
| LaneGuard no touchInteractive + deleteAll | 5 |
| Retention JS three-condition gate | 2, 8 |
| R2/Iceberg skip steps | 6, 8 |
| Module onPurge check | 9 |
| Certificate column check / no PII | 2, 9 |
| Append-only + terminal guards tests | 1 |
| Property guest-PII declaration | 10 |
| SystemActor `'purge'` | 3, 6–8 |

## Self-review notes

- No TBD forks: 202 on concurrent create; HALT appends cert; property graph separate.
- Types: `PurgeWorkflowParams`, `appendPurgeCertificate`, `assertTenantActive`, `nextOrgPurgeWorkflowId` named consistently across tasks.
- Task 3 defers route-audit rows to Task 7/8 so permissions CI stays green.
