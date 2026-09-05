# Kill-switch, replay permission, degraded transport, R2 terminal fail (R0.9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **S4**, **X2**, **N7**, **X3** — explicit kill-switch on org cancel/purge; dedupe-first replay permission on all eight `REPLAY_DISPATCH` `try*` methods; one shared DO transport classifier with extended Cloudflare substrings and unsafe-local test sentinel; terminal ack when `EVENT_LOG_R2` is unbound (no infinite retry).

**Architecture:** Characterization tests land **first** and must fail on current `main`. Task 2 adds lifecycle kill-switch in `dispatchV1` and `readIdempotentCacheSync` + `replayPrecheckSync` on replay-eligible PropertyDO methods. Task 3 consolidates transport allowlists into `do-transport-failure.ts` and fixes the events consumer missing-R2 path. Task 4 runs full CI and ticks **R0.9**. No schema migration, new catalog commands, HTTP routes, or SPA — pins frozen.

**Tech Stack:** Cloudflare Workers + PropertyDO / OrgDO (`apps/pms-core`), `@hospai/contracts`, `@hospai/do-runtime`, vitest + `cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-kill-switch-replay-degraded-r2-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged (dispatch logic only) |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. Kill-switch is `dispatchV1` logic only — no route audit length change.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **S4 cancel/purge kill-switch** | After actor resolution, before tenant resolution: `checkKillSwitch(env, 'pms.core')` when `route.id === 'post_org_cancel' \|\| route.id === 'post_org_purge'`. Active → **503** empty body. **Do not** add `entitlement: 'pms.core'` to those route defs. **Do not** fold into `entitlementForRoute`. Use simple `route.id === …` — **not** a typed `Set` generic. |
| **S4 membership stays up** | Org/property member routes remain without kill-switch (no `entitlement` today — unchanged). |
| **Kill-switch HTTP** | Match entitled routes: **503**, empty body. No fifth status mapper. |
| **X2 replay actor** | Consumer + exception workbench retry pass `{ kind: 'user', userId: provisional.actor.userId }` (already on `main`). |
| **X2 dedupe before permission** | When `provisional != null`: `readIdempotentCacheSync(sql, idem, actor)` **before** `await gatePermission`. Cache hit → return cached `{ ok, … }` immediately. |
| **X2 first replay after revoke** | `not_member` / `FORBIDDEN` → `provisional_exception`; reservation/folio/room state unchanged. |
| **X2 duplicate after apply + revoke** | Idempotency cache hit → success replay; **zero** new exception rows (degraded-mode **6b**). |
| **X2 system actor** | `gatePermission` keeps `if (actor.kind === 'system') return null` for night audit / true system jobs. |
| **N7 shared module** | One `do-transport-failure.ts`; Property + Org thin re-exports. Table-driven allowlist test per substring. |
| **N7 test sentinel** | Harness blocked messages **not** in production allowlist; merged only when `env.HOSPAI_UNSAFE_LOCAL === '1'` or `includeTestSentinel: true`. |
| **X3 missing R2** | `!hasEventLogR2(env) \|\| !env.EVENT_LOG_R2` → log `event_log.r2_unbound`, **`msg.ack()`** every survivor, **no** `retry()`. **N13 out.** |
| **TDD** | Task 1 tests must **fail on current `main`**. Do **not** invert tests to encode today's bugs. |
| **Verify** | `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. **Never put `--` before `--shard`**. Unsharded `pnpm test` on pms-core is unsafe. |

**Out of scope:** Playwright; PropertyDO extraction; N13 DLQ noise (R2 bound); Vertical 10 error-table sweep; schema bump; new catalog commands; push; `--no-verify`.

---

## Sequencing gate

```
Task 1 (red tests, tests-only commit)
→ Task 2 (S4 kill-switch + X2 dedupe-first permission)
→ Task 3 (N7 shared transport module + X3 missing-R2 ack)
→ Task 4 (full CI + tick R0.9 in docs/roadmap.md)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T3, T5, T7–T8, T11; **T6 / 6b** may already fail on `main` with user-actor replay + gate-first — must stay green after Task 2). Task 2 makes S4 + X2 tests green. Task 3 makes transport + R2 tests green and updates degraded-mode transport pin. Task 4 runs full CI + `pnpm test:local` and ticks roadmap **R0.9** only in Task 4.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Create: `apps/pms-core/test/kill-switch-lifecycle.spec.ts`
- Create: `apps/pms-core/test/do-transport-failure.spec.ts`
- Create: `apps/pms-core/test/events-queue-r2-unbound.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts`
- Modify: `packages/do-runtime/src/outbox-idempotency.test.ts`

**Interfaces:** none (tests only). `readIdempotentCacheSync` and `DO_TRANSPORT_ALLOWLIST` do not exist until Task 2/3 — Task 1 may fail compile until production lands; run focused vitest after Task 2 Step 0 / Task 3 Step 0 for those imports.

Use existing helpers: `provisionHotel`, `dispatchPendingBatch`, `idemForCommand`, `assignCleanRoom`, `postCheckIn`, `postFolioLine`, `setKillSwitch`, `getOrg`, `resolveOrgStub`, `createMessageBatch`, `worker.queue` from sibling specs.

### Step 1 — New file: `kill-switch-lifecycle.spec.ts` (T1–T4)

Create `apps/pms-core/test/kill-switch-lifecycle.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { ensurePlatformSchema, getOrg, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'Kill Switch Org' }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Kill Switch Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

describe('kill-switch lifecycle routes (R0.9 S4)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // T1 — cancel close blocked during kill-switch
  it('T1: kill-switch on → POST …/cancel close → 503 empty; org not closing', async () => {
    const actor = 'user_ks_cancel';
    const orgId = `org_ks_${crypto.randomUUID()}`;
    const propertyId = `prop_ks_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ action: 'close' }),
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
    expect((await getOrg(env, orgId))?.status).not.toBe('closing');
  });

  // T2 — purge blocked during kill-switch
  it('T2: kill-switch on → POST …/purge → 503 empty', async () => {
    const actor = 'user_ks_purge';
    const orgId = `org_ks_purge_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/purge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ orgId, confirm: true }),
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  // T3 — membership POST not kill-switched
  it('T3: kill-switch on → POST …/properties/…/members → not 503 from kill-switch', async () => {
    const actor = 'user_ks_member';
    const orgId = `org_ks_mem_${crypto.randomUUID()}`;
    const propertyId = `prop_ks_mem_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
      }),
      env,
    );
    expect(res.status).not.toBe(503);
  });

  // T4 — sanity: cancel succeeds when kill-switch off
  it('T4: kill-switch off → cancel close → 200 closing', async () => {
    const actor = 'user_ks_sanity';
    const orgId = `org_ks_ok_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ action: 'close' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'closing' });
  });
});
```

**Red on `main`:** T1–T2 return **200** / **202** today (kill-switch skipped). T3 should pass on `main` (regression guard). T4 already green.

### Step 2 — Extend `degraded-mode.spec.ts` (T5–T7)

Add imports at top if missing: `NOT_MEMBER` from contracts (optional — assert via exception reason string).

**T5 — X2a:** first replay after offboard (never applied) → exception, no mutation. Insert after existing test `11` block (~line 608):

```ts
  it('X2a: first replay after offboard before apply → not_member exception; not checked in', async () => {
    const actor = 'user_deg_x2a';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_x2a', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_x2a', 'rm_deg_x2a', '317');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_deg_x2a', 'idem-x2a')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();

    await dispatchPendingBatch(sent);
    expect(await stub.countProvisionalExceptions()).toBe(1);
    expect(await stub.getReservationStatus('res_deg_x2a')).toBe('confirmed');
    const reason = await stub.readProvisionalExceptionReasonForTest('idem-x2a');
    expect(reason).toBe('not_member');
  });
```

If `readProvisionalExceptionReasonForTest` does not exist, add a thin unsafe-local test helper on PropertyDO in Task 2 **or** assert via `listProvisionalExceptions()` row shape already used in test `failed replay persists actor_user_id`.

**T6 — 6b:** existing test at ~504 — **do not rewrite expectations**. On `main` with user-actor replay + gate-before-dedupe, second `dispatchPendingBatch` may create a false exception — test should **fail** until Task 2. Document in Step 4 run notes.

**T7 — X2b:** folio replay after offboard. Insert after test `13`:

```ts
  it('X2b: folio.add_item replay after offboard → exception; no folio line', async () => {
    const actor = 'user_deg_x2b';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_x2b';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const folioLineId = `${reservationId}:item:idem-x2b`;
    const payload = {
      reservationId,
      folioLineId,
      chargeCode: 'MISC',
      amountMinor: 1500,
    };
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-x2b',
        requestFingerprint: (await idemForCommand('folio.add_item', 'idem-x2b', payload)).fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload },
        routeId: 'post_folio_line',
      },
    };

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();

    await dispatchPendingBatch([msg]);
    expect(await stub.countProvisionalExceptions()).toBe(1);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });
```

**Update transport pin** (~line 240) for N7 post-fix behaviour (red on `main` today):

```ts
  it('transport allowlist: harness blocked message excluded in production mode (N7)', () => {
    expect(isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
    expect(
      isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE), env),
    ).toBe(true);
  });
```

Requires Task 3 to add optional `env` param to `isPropertyDoTransportFailure` — until then, compile fails or second assertion fails. **Do not** change production in Task 1.

### Step 3 — New file: `do-transport-failure.spec.ts` (T8–T10)

Create `apps/pms-core/test/do-transport-failure.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DO_TRANSPORT_ALLOWLIST,
  isDoTransportFailure,
  isOrgDoTransportFailure,
  isPropertyDoTransportFailure,
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
} from '../src/do-transport-failure.js';

describe('do-transport-failure (N7)', () => {
  it.each([...DO_TRANSPORT_ALLOWLIST])('T8: fragment %s matches synthetic Error', (fragment) => {
    expect(isDoTransportFailure(new Error(`prefix ${fragment} suffix`))).toBe(true);
  });

  it('T9: harness blocked message excluded in production mode', () => {
    expect(isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
    expect(isOrgDoTransportFailure(new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
  });

  it('T10: harness blocked message with includeTestSentinel → true', () => {
    expect(
      isDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE), {
        kind: 'property',
        includeTestSentinel: true,
      }),
    ).toBe(true);
    expect(
      isDoTransportFailure(new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE), {
        kind: 'org',
        includeTestSentinel: true,
      }),
    ).toBe(true);
  });

  it('negative control: simulated_internal_bug → false', () => {
    expect(isDoTransportFailure(new Error('simulated_internal_bug'))).toBe(false);
  });
});
```

**Red on `main`:** file imports missing module; T8 new N7 strings absent from current allowlists.

### Step 4 — New file: `events-queue-r2-unbound.spec.ts` (T11)

Create `apps/pms-core/test/events-queue-r2-unbound.spec.ts`:

```ts
import { env, createMessageBatch, createExecutionContext, getQueueResult } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { DomainEventMessage } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PmsEnv } from '../src/env.js';
import * as observability from '@hospai/observability';

describe('events queue missing R2 (R0.9 X3)', () => {
  it('T11: unbound EVENT_LOG_R2 → ack terminal; no retry; log event_log.r2_unbound', async () => {
    const eventId = crypto.randomUUID();
    const body: DomainEventMessage = {
      eventId,
      eventType: 'config.changed',
      payload: { key: 'k', version: 1, consumers: {}, actor: 'test' },
      seq: 1,
      source: { do: 'property', id: 'prop_r2_unbound' },
    };

    const ackSpy = vi.fn();
    const retrySpy = vi.fn();
    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-r2-unbound',
        timestamp: new Date(),
        attempts: 1,
        body,
        ack: ackSpy,
        retry: retrySpy,
      },
    ]);

    const queueEnv = new Proxy(env, {
      get(target, prop, receiver) {
        if (prop === 'EVENT_LOG_R2') return undefined;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PmsEnv;

    const logSpy = vi.spyOn(observability, 'logWarn');
    const ctx = createExecutionContext();
    await worker.queue(batch as MessageBatch<DomainEventMessage>, queueEnv);
    await getQueueResult(batch, ctx);

    expect(retrySpy).not.toHaveBeenCalled();
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.some(([, fields]) => (fields as { msg?: string }).msg === 'event_log.r2_unbound')).toBe(
      true,
    );
    logSpy.mockRestore();
  });
});
```

**Red on `main`:** consumer calls `retry()` today.

### Step 5 — `readIdempotentCacheSync` unit test in `outbox-idempotency.test.ts` (T12)

Add import and describe block:

```ts
import { IdempotencyKeyReused, readIdempotentCacheSync, runIdempotent, scopeIdempotencyKey } from './idempotency.js';

describe('readIdempotentCacheSync (X2)', () => {
  it('T12: returns cached response without executing', () => {
    const sql = new OutboxMemorySql();
    const idem = { key: 'K', fingerprint: 'fp1' };
    const actor = { kind: 'user' as const, userId: 'u1' };
    runIdempotent(sql, idem, () => ({ ok: true, n: 1 }), actor);
    expect(readIdempotentCacheSync<{ ok: boolean; n: number }>(sql, idem, actor)).toEqual({ ok: true, n: 1 });
  });

  it('T12b: fingerprint mismatch throws IdempotencyKeyReused', () => {
    const sql = new OutboxMemorySql();
    const actor = { kind: 'user' as const, userId: 'u1' };
    runIdempotent(sql, { key: 'K', fingerprint: 'fp1' }, () => ({ ok: true }), actor);
    expect(() =>
      readIdempotentCacheSync(sql, { key: 'K', fingerprint: 'fp2' }, actor),
    ).toThrow(IdempotencyKeyReused);
  });
});
```

**Red on `main`:** export missing.

### Step 6 — Run vitest; confirm red

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/outbox-idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run \
  test/kill-switch-lifecycle.spec.ts \
  test/degraded-mode.spec.ts \
  test/do-transport-failure.spec.ts \
  test/events-queue-r2-unbound.spec.ts
```

- [ ] T1–T2 fail on `main` (cancel/purge succeed)
- [ ] T5, T7 fail on `main` (or wrong exception count) until dedupe-first
- [ ] **6b** may fail on `main` — must pass after Task 2
- [ ] T8–T12 fail compile or fail until Task 2/3
- [ ] T3, T4, T9 (post-fix transport pin second line) — note compile deps
- [ ] Do **not** change production code in this task

### Step 7 — Commit (tests only)

```bash
git add \
  apps/pms-core/test/kill-switch-lifecycle.spec.ts \
  apps/pms-core/test/degraded-mode.spec.ts \
  apps/pms-core/test/do-transport-failure.spec.ts \
  apps/pms-core/test/events-queue-r2-unbound.spec.ts \
  packages/do-runtime/src/outbox-idempotency.test.ts
git commit -m "$(cat <<'EOF'
test: kill-switch, replay permission, transport, R2 characterization (red)

Add T1–T12 specs for R0.9 S4/X2/N7/X3. Fail on main where holes remain.
EOF
)"
```

---

## Task 2 — S4 lifecycle kill-switch + X2 dedupe-first replay permission

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `packages/do-runtime/src/idempotency.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `packages/contracts/src/provisional-command.ts`

**Interfaces:**

```ts
// packages/do-runtime/src/idempotency.ts
/** Sync probe — same key/fingerprint rules as runIdempotent, no mutation. */
export function readIdempotentCacheSync<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  actor: ActorContext,
): T | null;

// apps/pms-core/src/property-do.ts (private)
private replayPrecheckSync<T>(
  actor: ActorContext,
  idem: IdempotencyKey,
  provisional?: ProvisionalContext,
): T | null;
```

### Step 0 — `readIdempotentCacheSync` in do-runtime

Add to `packages/do-runtime/src/idempotency.ts` (mirror `runIdempotent` SELECT path, no INSERT):

```ts
export function readIdempotentCacheSync<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  actor: ActorContext,
): T | null {
  if (!idem.key || !idem.fingerprint) {
    throw new Error('IdempotencyKey requires non-empty key and fingerprint');
  }
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, storageKey)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;
  if (prior.length === 0) return null;
  if (prior[0]!.request_fingerprint !== idem.fingerprint) {
    throw new IdempotencyKeyReused(idem.key);
  }
  return JSON.parse(prior[0]!.response) as T;
}
```

Re-export from `packages/do-runtime/src/index.ts`:

```ts
export { IdempotencyKeyReused, readIdempotentCacheSync, runIdempotent, scopeIdempotencyKey } from './idempotency.js';
```

- [ ] T12 green in `outbox-idempotency.test.ts`

### Step 1 — S4 lifecycle kill-switch in `dispatchV1`

In `apps/pms-core/src/v1-dispatch.ts` (~9087–9108), **after** dev/bootstrap early returns, extend kill-switch gate. **Reviewer lock:** simple route id check — no typed `Set`:

```ts
  const lifecycleKillSwitch =
    (route.id === 'post_org_cancel' || route.id === 'post_org_purge') &&
    (await checkKillSwitch(env, 'pms.core'));

  if ((feature && (await killSwitchPromise)) || lifecycleKillSwitch) {
    return new Response(null, { status: 503 });
  }
```

- [ ] **`post_org_cancel` / `post_org_purge` route defs unchanged** — no `entitlement` field
- [ ] T1–T2 green
- [ ] T3 still not 503 from kill-switch
- [ ] Existing `entitlements.spec.ts` kill-switch test still green

### Step 2 — `replayPrecheckSync` + eight `try*` methods

Import `readIdempotentCacheSync` in `property-do.ts`.

Add private helper:

```ts
private replayPrecheckSync<T>(
  actor: ActorContext,
  idem: IdempotencyKey,
  provisional?: ProvisionalContext,
): T | null {
  if (!provisional) return null;
  return readIdempotentCacheSync<T>(this.ctx.storage.sql, idem, actor);
}
```

For **each** replay-eligible method below, insert **after** org/property preconditions / `touchInteractive`, **before** `await gatePermission`:

```ts
const cached = this.replayPrecheckSync<ReturnType<typeof this.tryCheckIn>>(actor, idem, provisional);
if (cached !== null) return cached;
```

| Method | ~line | Permission |
|---|---|---|
| `tryCheckIn` | 9455 | `reservations:write` |
| `tryCheckOut` | 9652 | `reservations:write` |
| `tryCancelCheckIn` | 9881 | `reservations:write` |
| `tryUpdateFrontOffice` | 10108 | `reservations:write` |
| `tryAddFolioLine` | 15124 | `folio:post` |
| `tryUpdateRoomStatus` | 7076 | `housekeeping:write` |
| `tryBulkUpdateRoomStatus` | 7151 | `housekeeping:write` |
| `tryAssignHousekeeping` | 7417 | `housekeeping:write` |

**Order per method:** preconditions → **`replayPrecheckSync`** → **`gatePermission`** → entitlement/guest gates → `transactionSync(() => runIdempotent(...))`.

- [ ] Live HTTP paths (`provisional` omitted) unchanged
- [ ] `gatePermission` system short-circuit untouched (~1777)
- [ ] T5, T7, **6b** green
- [ ] `pending-commands-consumer.ts` unchanged (already user actor ~103)

### Step 3 — Contract JSDoc cleanup

In `packages/contracts/src/provisional-command.ts`, replace stale comment (~35):

```ts
  /** Admission-time operator — audit rows via auditUserId; replay permission re-checks actor.userId. */
```

Also fix `ProvisionalCommand.actor` comment (~13) if it still says replay uses system actor.

- [ ] No `REPLAY_ACTOR` in production code paths (grep confirms comments only)

### Step 4 — Optional test helper

If T5/T7 use `readProvisionalExceptionReasonForTest`, add unsafe-local helper on PropertyDO that reads `reason` from `provisional_exception` by idempotency key — or assert via existing list/count APIs.

### Step 5 — Focused test run (Task 2 scope)

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/outbox-idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run \
  test/kill-switch-lifecycle.spec.ts \
  test/degraded-mode.spec.ts

pnpm --filter @hospai/pms-core exec vitest run test/entitlements.spec.ts
```

- [ ] T1–T7, T12 green
- [ ] T8–T11 still red (Task 3)
- [ ] Transport pin in degraded-mode may still fail until Task 3

```bash
pnpm typecheck
```

### Step 6 — Commit

```bash
git add \
  apps/pms-core/src/v1-dispatch.ts \
  packages/do-runtime/src/idempotency.ts \
  packages/do-runtime/src/index.ts \
  apps/pms-core/src/property-do.ts \
  packages/contracts/src/provisional-command.ts
git commit -m "$(cat <<'EOF'
fix: lifecycle kill-switch and dedupe-first replay permission (R0.9)

Block cancel/purge under kill:pms.core; probe idempotency cache before
gatePermission on all REPLAY_DISPATCH try* methods (S4/X2).
EOF
)"
```

---

## Task 3 — N7 shared transport module + X3 missing-R2 terminal ack

**Files:**
- Create: `apps/pms-core/src/do-transport-failure.ts`
- Modify: `apps/pms-core/src/property-do-transport.ts`
- Modify: `apps/pms-core/src/org-do-transport.ts`
- Modify: `apps/pms-core/src/invoke-property-do.ts`
- Modify: `apps/pms-core/src/index.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts` (transport pin — if not done in Task 1)

**Pre-flight:** Read `scripts/do-transport-guards-check.mjs` — gate matches `isPropertyDoTransportFailure|isOrgDoTransportFailure` in handler bodies. **Shims must preserve export names and paths** so `check:do-transport-guards` stays green without script edits.

**Interfaces:**

```ts
// apps/pms-core/src/do-transport-failure.ts
export const DO_TRANSPORT_ALLOWLIST: readonly string[];
export function isDoTransportFailure(error: unknown, opts?: { kind?: 'property' | 'org'; includeTestSentinel?: boolean }): boolean;
export function isPropertyDoTransportFailure(error: unknown, env?: { HOSPAI_UNSAFE_LOCAL?: string }): boolean;
export function isOrgDoTransportFailure(error: unknown, env?: { HOSPAI_UNSAFE_LOCAL?: string }): boolean;
```

### Step 0 — Create `do-transport-failure.ts`

Per spec §2.3 — shared allowlist **without** test sentinels in `DO_TRANSPORT_ALLOWLIST`; N7 extension substrings:

```ts
export const DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
  'overloaded',
  'Durable Object is overloaded',
  'evicted',
  'object evicted',
  'Durable Object storage operation failed',
  'internal error in Durable Object storage',
  'cannot resolve Durable Object',
  'Could not resolve Durable Object',
];

export const PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE =
  'PropertyDO transport blocked for test (degraded-mode fault injection)' as const;
export const ORG_DO_TRANSPORT_BLOCKED_MESSAGE =
  'OrgDO transport blocked for test (degraded-mode fault injection)' as const;

export function isDoTransportFailure(
  error: unknown,
  opts?: { kind?: 'property' | 'org'; includeTestSentinel?: boolean },
): boolean { /* per spec */ }

export function isPropertyDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'property',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}

export function isOrgDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'org',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}
```

### Step 1 — Thin re-export shims

Replace bodies of `property-do-transport.ts` and `org-do-transport.ts`:

```ts
export {
  DO_TRANSPORT_ALLOWLIST as PROPERTY_DO_TRANSPORT_ALLOWLIST,
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
  isPropertyDoTransportFailure,
} from './do-transport-failure.js';
```

(org twin exports `ORG_*` names)

- [ ] **`PROPERTY_DO_TRANSPORT_ALLOWLIST` export preserved** for any legacy imports
- [ ] `check:do-transport-guards` still finds `isPropertyDoTransportFailure` / `isOrgDoTransportFailure` strings in `v1-dispatch.ts`

### Step 2 — Pass `env` at production call sites

**`invoke-property-do.ts`:** pass `opts.env` into classifier:

```ts
if (!isPropertyDoTransportFailure(e, opts.env)) {
```

**`v1-dispatch.ts`:** OrgDO transport catches — pass `ctx.env` where `isOrgDoTransportFailure(e)` today (grep all sites).

**`pending-commands-consumer.ts`:** if transport classification exists in catch, pass `env`.

**`property-do.ts` / `org-do.ts`:** `setTransportBlockedForTest` thrown message unchanged — must match sentinel constants.

- [ ] Degraded-mode harness tests (`setTransportBlockedForTest`) still queue/replay under vitest (`HOSPAI_UNSAFE_LOCAL=1`)

### Step 3 — X3 events consumer terminal ack

In `apps/pms-core/src/index.ts` (~169–171), replace retry loop:

```ts
import { logWarn } from '@hospai/observability';

if (!hasEventLogR2(env) || !env.EVENT_LOG_R2) {
  logWarn({ moduleId: 'pms.events' }, {
    msg: 'event_log.r2_unbound',
    survivorCount: survivors.length,
  });
  for (const msg of survivors) {
    msg.ack();
  }
  return;
}
```

- [ ] Partial R2 put failure path unchanged (still per-group retry below)
- [ ] T11 green

### Step 4 — Focused test run (Task 3 scope)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/do-transport-failure.spec.ts \
  test/events-queue-r2-unbound.spec.ts \
  test/degraded-mode.spec.ts

node scripts/do-transport-guards-check.mjs
node scripts/do-transport-guards-check.mjs --self-test
```

- [ ] T8–T11 green
- [ ] Degraded-mode transport pin green (prod false, env true)
- [ ] Existing degraded-mode transport queue tests still green

```bash
pnpm typecheck
```

### Step 5 — Commit

```bash
git add \
  apps/pms-core/src/do-transport-failure.ts \
  apps/pms-core/src/property-do-transport.ts \
  apps/pms-core/src/org-do-transport.ts \
  apps/pms-core/src/invoke-property-do.ts \
  apps/pms-core/src/index.ts \
  apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
fix: shared DO transport classifier and R2-unbound terminal ack (R0.9)

Consolidate allowlists with N7 Cloudflare substrings; unsafe-local test
sentinel only; ack events when EVENT_LOG_R2 missing (N7/X3).
EOF
)"
```

(Add any other modified files from Step 2 grep sweep to `git add`.)

---

## Task 4 — Full CI + tick R0.9

**Files:** `docs/roadmap.md` (R0.9 checkbox only)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/outbox-idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run \
  test/kill-switch-lifecycle.spec.ts \
  test/degraded-mode.spec.ts \
  test/do-transport-failure.spec.ts \
  test/events-queue-r2-unbound.spec.ts \
  test/entitlements.spec.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
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
pnpm check:spa-page-chrome
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
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.9

In `docs/roadmap.md` line ~185, change:

```markdown
- [ ] **R0.9** Audit V9 — S4, X2, N7, X3. ...
```

to:

```markdown
- [x] **R0.9** Audit V9 — S4, X2, N7, X3. ...
```

**Do not tick R0.9 before this task.**

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.9 after kill-switch, replay, transport, R2 fixes

Full CI checks and pms-core shards green; audit S4/X2/N7/X3 closed.
EOF
)"
```

---

## Test matrix (spec §4 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `kill-switch-lifecycle.spec.ts` | 1–2 | Kill-switch on → cancel **503** empty; org not `closing` | Yes |
| T2 | same | 1–2 | Kill-switch on → purge **503** empty | Yes |
| T3 | same | 1–2 | Kill-switch on → property members POST **≠ 503** | No (guard) |
| T4 | same | 1–2 | Kill-switch off → cancel close **200** | No |
| T5 | `degraded-mode.spec.ts` | 1–2 | X2a offboard before first replay → exception; not checked in | Yes |
| T6 | same | 1–2 | **6b** duplicate after apply + offboard → **0** exceptions | Likely yes |
| T7 | same | 1–2 | X2b folio offboard → exception; no line | Yes |
| T8 | `do-transport-failure.spec.ts` | 1–3 | `it.each(DO_TRANSPORT_ALLOWLIST)` → true | Yes |
| T9 | same | 1–3 | Harness message prod mode → false | Yes (pin) |
| T10 | same | 1–3 | Harness + `includeTestSentinel` → true | Yes |
| T11 | `events-queue-r2-unbound.spec.ts` | 1–3 | Unbound R2 → ack; no retry; log `event_log.r2_unbound` | Yes |
| T12 | `outbox-idempotency.test.ts` | 1–2 | `readIdempotentCacheSync` returns cached body | Yes |
| T13 | `entitlements.spec.ts` | 2–4 | Entitled route kill-switch still **503** | No (regression) |

---

## Success criteria (spec §9)

1. `kill:pms.core` active → cancel and purge return **503** empty; membership POST does **not** (**S4**).
2. First replay after operator offboard → `provisional_exception`, no mutation (**X2**).
3. Duplicate replay after successful apply + offboard → idempotency cache hit, **no** false exception (**6b** / **X2**).
4. Night-audit / system callers still bypass `gatePermission` via `system` actor.
5. One shared transport module; table-driven tests per allowlist string; test sentinel unsafe-local only (**N7**).
6. Missing `EVENT_LOG_R2` → ack terminal, no infinite retry (**X3**).
7. Pins unchanged; `pnpm test:local` green.

---

## Plan vs codebase notes (reviewer)

| Item | Notes |
|---|---|
| `dispatchV1` kill-switch today (~9087–9107) | Only runs when `entitlementForRoute(route)` non-null; cancel/purge have no entitlement — T1–T2 red. |
| `tryCheckIn` gate-before-dedupe (~9455–9460) | Same ordering on all eight replay `try*`; fix is shared `replayPrecheckSync`. |
| Consumer user actor (~103) | R0.8 already landed; Task 2 is DO ordering only. |
| `provisional-command.ts:35` | Stale REPLAY_ACTOR JSDoc — Task 2 updates. |
| `property-do-transport.ts` test sentinel in prod list (~9–16) | Task 3 moves to unsafe-local; degraded-mode pin test updated Task 1. |
| `index.ts` events consumer (~169–171) | `retry()` loop today — T11 red until Task 3. |
| `readProvisionalExceptionReasonForTest` | May need small test helper — prefer existing list APIs if present. |
| `do-transport-guards-check.mjs` | Inspects `isPropertyDoTransportFailure\|isOrgDoTransportFailure` in handler bodies — shims must keep export paths. |
| **6b on `main`** | With user actor + gate-first, may already fail — confirms X2 hole; must pass after Task 2. |
| N13 | Explicitly out — do not add DLQ cleanup in this vertical. |
