# Idempotency × Outbox (§10.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the idempotency record, domain mutation, and outbox row are one atomic write inside PropertyDO, and add drain/ack flush without Queues.

**Architecture:** Pure SQL helpers in `@hospai/do-runtime` (`runIdempotent`, `appendOutbox`, `drainOutbox`, `ackOutboxThrough`). Wire types and `fingerprintPayload` (client/edge only) in `@hospai/contracts`. Retrofit `PropertyDO.tryPutDomainConfig` to require an idempotency key. `flushOutbox(deliver?)` drains, optionally delivers, then prefix-acks.

**Tech Stack:** Cloudflare Durable Objects SQLite, TypeScript, vitest, `@cloudflare/vitest-pool-workers`, pnpm workspace, turbo.

## Global Constraints

- No `await` inside `runIdempotent` or its `execute` callback (ARCHITECTURE §10.1 / §4.1 I/O gate).
- No `crypto.subtle` inside any PropertyDO command path — hash only via `fingerprintPayload` before the DO call.
- `IdempotencyKeyReused` class lives in `do-runtime`; wire code `idempotency_key_reused` lives in `contracts`.
- Never map HTTP 409 via `instanceof` across a DO stub — use `{ ok: false, error: IDEM_KEY_REUSED }`.
- No Queues, alarms, retention sweep, or HTTP Idempotency-Key header in this slice.
- Commit to `main` after each task; run the task’s stated test command before committing.
- Spec: `docs/superpowers/specs/2026-07-27-idempotency-outbox-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | `IdempotencyKey`, `IDEM_KEY_REUSED`, `fingerprintPayload` |
| `packages/contracts/src/idempotency.test.ts` | Fingerprint stability tests |
| `packages/contracts/src/index.ts` | Re-export idempotency module |
| `packages/do-runtime/src/outbox.ts` | `OutboxRow`, `appendOutbox`, `drainOutbox`, `ackOutboxThrough` |
| `packages/do-runtime/src/idempotency.ts` | `IdempotencyKeyReused`, `runIdempotent` |
| `packages/do-runtime/src/outbox-idempotency.test.ts` | MemorySql unit tests for helpers |
| `packages/do-runtime/src/index.ts` | Export new symbols; add `@hospai/contracts` dependency |
| `apps/pms-core/src/property-do.ts` | Retrofit config put; flush/drain/ack methods |
| `apps/pms-core/test/property-do.spec.ts` | Update existing config test; add §10.1 cases |
| `README.md` | Note foundation progress |

---

### Task 1: Contracts — idempotency wire types + fingerprint

**Files:**
- Create: `packages/contracts/src/idempotency.ts`
- Create: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Web Crypto `crypto.subtle` (Node 22+ / Workers)
- Produces:
  - `export type IdempotencyKey = { key: string; fingerprint: string }`
  - `export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const`
  - `export type IdemKeyReusedCode = typeof IDEM_KEY_REUSED`
  - `export async function fingerprintPayload(input: unknown): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/idempotency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fingerprintPayload, IDEM_KEY_REUSED } from './idempotency.js';

describe('fingerprintPayload', () => {
  it('is stable under key reordering', async () => {
    const a = await fingerprintPayload({ b: 1, a: 2 });
    const b = await fingerprintPayload({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs when values differ', async () => {
    const a = await fingerprintPayload({ key: 'k', value: true });
    const b = await fingerprintPayload({ key: 'k', value: false });
    expect(a).not.toBe(b);
  });

  it('exports the wire error code', () => {
    expect(IDEM_KEY_REUSED).toBe('idempotency_key_reused');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/contracts test -- src/idempotency.test.ts`

Expected: FAIL (module not found / export missing)

- [ ] **Step 3: Implement**

Create `packages/contracts/src/idempotency.ts`:

```ts
export type IdempotencyKey = {
  key: string;
  fingerprint: string;
};

/** Wire / HTTP mapping code — not for `instanceof` across a DO stub. */
export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const;
export type IdemKeyReusedCode = typeof IDEM_KEY_REUSED;

/** Sorted-key canonical JSON. Client/edge only — never call from a DO command path. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function fingerprintPayload(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

Add to `packages/contracts/src/index.ts`:

```ts
export * from './idempotency.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hospai/contracts test -- src/idempotency.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
Add idempotency wire types and client-side fingerprintPayload.

EOF
)"
```

---

### Task 2: do-runtime — appendOutbox + drain/ack

**Files:**
- Create: `packages/do-runtime/src/outbox.ts`
- Create: `packages/do-runtime/src/outbox-idempotency.test.ts` (start here; Task 3 extends)
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/package.json` (add `@hospai/contracts` workspace dep — needed by Task 3; add now)

**Interfaces:**
- Consumes: `SqlStorageLike` from `index.ts` (or import type from a shared place — keep using the exported `SqlStorageLike`)
- Produces:
  - `export type OutboxRow = { seq: number; eventId: string; eventType: string; payload: string; createdAt: number }`
  - `export function appendOutbox(sql: SqlStorageLike, row: { eventId: string; eventType: string; payload: unknown }): void`
  - `export function drainOutbox(sql: SqlStorageLike, opts?: { maxMessages?: number; maxBytes?: number }): OutboxRow[]`
  - `export function ackOutboxThrough(sql: SqlStorageLike, seq: number): void`

- [ ] **Step 1: Write failing tests for outbox helpers**

In `packages/do-runtime/src/outbox-idempotency.test.ts`, implement a focused `OutboxMemorySql` that stores outbox rows in memory and handles:

- `INSERT INTO outbox (...)` — assign autoincrement `seq`, store row with `acked = 0`
- `SELECT seq, event_id, event_type, payload, created_at FROM outbox WHERE acked = 0 ORDER BY seq LIMIT ?`
- `UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0`

```ts
import { describe, expect, it } from 'vitest';
import { appendOutbox, drainOutbox, ackOutboxThrough } from './outbox.js';
import type { SqlStorageLike } from './index.js';

// OutboxMemorySql: minimal fake — implement in this file (see Step 3 for query shapes).

describe('outbox helpers', () => {
  it('append then drain returns unacked prefix; ack clears them', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 'config.changed', payload: { a: 1 } });
    appendOutbox(sql, { eventId: 'e2', eventType: 'config.changed', payload: { a: 2 } });
    const batch = drainOutbox(sql);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.eventId).toBe('e1');
    expect(drainOutbox(sql)).toHaveLength(2); // still unacked
    ackOutboxThrough(sql, batch[1]!.seq);
    expect(drainOutbox(sql)).toHaveLength(0);
  });

  it('drain respects maxMessages', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: {} });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: {} });
    expect(drainOutbox(sql, { maxMessages: 1 })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/do-runtime test -- src/outbox-idempotency.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement `outbox.ts`**

```ts
import type { SqlStorageLike } from './index.js';

export type OutboxRow = {
  seq: number;
  eventId: string;
  eventType: string;
  payload: string;
  createdAt: number;
};

export function appendOutbox(
  sql: SqlStorageLike,
  row: { eventId: string; eventType: string; payload: unknown },
): void {
  sql.exec(
    `INSERT INTO outbox (event_id, event_type, payload, acked, created_at) VALUES (?, ?, ?, 0, ?)`,
    row.eventId,
    row.eventType,
    typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
    Date.now(),
  );
}

export function drainOutbox(
  sql: SqlStorageLike,
  opts: { maxMessages?: number; maxBytes?: number } = {},
): OutboxRow[] {
  const maxMessages = opts.maxMessages ?? 100;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const candidates = sql
    .exec(
      `SELECT seq, event_id AS eventId, event_type AS eventType, payload, created_at AS createdAt
       FROM outbox WHERE acked = 0 ORDER BY seq LIMIT ?`,
      maxMessages,
    )
    .toArray() as Array<{
    seq: number;
    eventId: string;
    eventType: string;
    payload: string;
    createdAt: number;
  }>;

  const batch: OutboxRow[] = [];
  let bytes = 0;
  for (const row of candidates) {
    const size = row.payload.length;
    if (batch.length > 0 && bytes + size > maxBytes) break;
    batch.push({
      seq: Number(row.seq),
      eventId: String(row.eventId),
      eventType: String(row.eventType),
      payload: String(row.payload),
      createdAt: Number(row.createdAt),
    });
    bytes += size;
  }
  return batch;
}

export function ackOutboxThrough(sql: SqlStorageLike, seq: number): void {
  sql.exec(`UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0`, seq);
}
```

**Note on column aliases:** Durable Object `sql.exec` may not support `AS` the same way — if PropertyDO integration fails later, select raw `event_id` and map in JS. Prefer raw columns if the pool-workers SQL rejects aliases:

```ts
`SELECT seq, event_id, event_type, payload, created_at FROM outbox WHERE acked = 0 ORDER BY seq LIMIT ?`
```

Map `event_id` → `eventId` in JS. Use the raw-column form in the committed implementation to match existing `property-do.ts` style.

Export from `index.ts`:

```ts
export {
  appendOutbox,
  drainOutbox,
  ackOutboxThrough,
  type OutboxRow,
} from './outbox.js';
```

Add to `packages/do-runtime/package.json` dependencies:

```json
"dependencies": {
  "@hospai/contracts": "workspace:*"
}
```

Run `pnpm install` from repo root.

Implement `OutboxMemorySql` in the test file to match the exact SQL strings above (normalize whitespace when matching).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hospai/do-runtime test -- src/outbox-idempotency.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/outbox.ts packages/do-runtime/src/outbox-idempotency.test.ts packages/do-runtime/src/index.ts packages/do-runtime/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Add outbox append/drain/ack helpers in do-runtime.

EOF
)"
```

---

### Task 3: do-runtime — `runIdempotent`

**Files:**
- Create: `packages/do-runtime/src/idempotency.ts`
- Modify: `packages/do-runtime/src/outbox-idempotency.test.ts`
- Modify: `packages/do-runtime/src/index.ts`

**Interfaces:**
- Consumes: `IdempotencyKey` from `@hospai/contracts`; `SqlStorageLike`; `appendOutbox` (only inside test `execute`)
- Produces:
  - `export class IdempotencyKeyReused extends Error`
  - `export function runIdempotent<T>(sql: SqlStorageLike, idem: IdempotencyKey, execute: () => T): T`

- [ ] **Step 1: Write failing tests**

Extend `OutboxMemorySql` (or a sibling `IdemMemorySql`) to also handle:

- `SELECT request_fingerprint, response FROM idempotency WHERE key = ?`
- `INSERT INTO idempotency (key, request_fingerprint, response, created_at) VALUES (?, ?, ?, ?)`

Add tests:

```ts
import { IdempotencyKeyReused, runIdempotent } from './idempotency.js';
import { appendOutbox } from './outbox.js';

describe('runIdempotent', () => {
  it('returns sync result and does not re-execute on replay', () => {
    const sql = new OutboxMemorySql();
    let runs = 0;
    const idem = { key: 'k1', fingerprint: 'fp1' };
    const first = runIdempotent(sql, idem, () => {
      runs += 1;
      appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: { n: 1 } });
      return { ok: true as const, n: 1 };
    });
    expect(first).toEqual({ ok: true, n: 1 });
    expect(runs).toBe(1);
    expect(first).not.toBeInstanceOf(Promise);

    const second = runIdempotent(sql, idem, () => {
      runs += 1;
      throw new Error('must not run');
    });
    expect(second).toEqual({ ok: true, n: 1 });
    expect(runs).toBe(1);
    expect(drainOutbox(sql)).toHaveLength(1);
  });

  it('throws IdempotencyKeyReused on fingerprint mismatch', () => {
    const sql = new OutboxMemorySql();
    runIdempotent(sql, { key: 'k1', fingerprint: 'fp1' }, () => ({ ok: true }));
    expect(() =>
      runIdempotent(sql, { key: 'k1', fingerprint: 'fp2' }, () => ({ ok: true })),
    ).toThrow(IdempotencyKeyReused);
  });

  it('rejects empty key or fingerprint', () => {
    const sql = new OutboxMemorySql();
    expect(() => runIdempotent(sql, { key: '', fingerprint: 'fp' }, () => 1)).toThrow();
    expect(() => runIdempotent(sql, { key: 'k', fingerprint: '' }, () => 1)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/do-runtime test -- src/outbox-idempotency.test.ts`

Expected: FAIL on missing `runIdempotent`

- [ ] **Step 3: Implement**

```ts
import type { IdempotencyKey } from '@hospai/contracts';
import type { SqlStorageLike } from './index.js';

/**
 * Intra-isolate control flow only. DO stubs flatten Error types —
 * map to wire code `idempotency_key_reused` at the PropertyDO try* boundary.
 */
export class IdempotencyKeyReused extends Error {
  constructor(public readonly key: string) {
    super(`Idempotency key reused with a different request fingerprint: ${key}`);
    this.name = 'IdempotencyKeyReused';
  }
}

/**
 * Lookup → execute (sync) → insert idempotency row.
 * MUST NOT await. Mutation + outbox + idempotency insert share one DO I/O gate (§10.1).
 */
export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => T,
): T {
  if (!idem.key || !idem.fingerprint) {
    throw new Error('IdempotencyKey requires non-empty key and fingerprint');
  }

  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;

  if (prior.length > 0) {
    if (prior[0]!.request_fingerprint !== idem.fingerprint) {
      throw new IdempotencyKeyReused(idem.key);
    }
    return JSON.parse(prior[0]!.response) as T;
  }

  const result = execute();
  sql.exec(
    `INSERT INTO idempotency (key, request_fingerprint, response, created_at) VALUES (?, ?, ?, ?)`,
    idem.key,
    idem.fingerprint,
    JSON.stringify(result),
    Date.now(),
  );
  return result;
}
```

Export from `index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hospai/do-runtime test -- src/outbox-idempotency.test.ts`

Expected: PASS (outbox + idempotency cases)

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/idempotency.ts packages/do-runtime/src/outbox-idempotency.test.ts packages/do-runtime/src/index.ts
git commit -m "$(cat <<'EOF'
Add runIdempotent with sync execute and fingerprint conflict guard.

EOF
)"
```

---

### Task 4: PropertyDO — retrofit `tryPutDomainConfig` + flush

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/property-do.spec.ts`
- Modify: `README.md` (short Phase 0 status line)

**Interfaces:**
- Consumes: `IdempotencyKey`, `IDEM_KEY_REUSED`, `fingerprintPayload` from contracts; `appendOutbox`, `runIdempotent`, `IdempotencyKeyReused`, `drainOutbox`, `ackOutboxThrough`, `OutboxRow` from do-runtime
- Produces:
  - `tryPutDomainConfig(key, value, meta, idem: IdempotencyKey)` — idem required
  - `putDomainConfig(..., idem: IdempotencyKey)` — pass through
  - `drainOutboxBatch(opts?)` → `OutboxRow[]`
  - `ackOutboxThrough(seq: number): Promise<void>`
  - `flushOutbox(deliver?: (batch: OutboxRow[]) => Promise<void>): Promise<{ flushed: number }>`

- [ ] **Step 1: Update existing test + add §10.1 tests (failing)**

Replace the DOMAIN config test and add new cases in `apps/pms-core/test/property-do.spec.ts`:

```ts
import { fingerprintPayload, IDEM_KEY_REUSED } from '@hospai/contracts';

async function configIdem(key: string, value: unknown, meta: { actor: string; reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    actor: meta.actor,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

it('stores DOMAIN config with audit trail and config.changed outbox', async () => {
  const stub = propertyStub(`cfg-${crypto.randomUUID()}`);
  const meta = { actor: 'tester', reason: 'verification' };
  const idem = await configIdem('pms.availability.allow_overbooking', true, meta);
  const put = await stub.tryPutDomainConfig('pms.availability.allow_overbooking', true, meta, idem);
  expect(put.ok).toBe(true);
  if (put.ok) expect(put.events).toContain('config.changed');
  expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);
  expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);

  const rejected = await stub.tryPutDomainConfig(
    'pms.ui.date_format',
    'ISO',
    meta,
    await configIdem('pms.ui.date_format', 'ISO', meta),
  );
  expect(rejected.ok).toBe(false);
});

it('replay same idempotency key does not double-write or double-emit', async () => {
  const stub = propertyStub(`idem-${crypto.randomUUID()}`);
  const meta = { actor: 'tester', reason: 'replay' };
  const key = 'pms.availability.allow_overbooking';
  const idem = { key: 'fixed-key-1', fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }) };
  const first = await stub.tryPutDomainConfig(key, true, meta, idem);
  expect(first.ok).toBe(true);
  const version1 = first.ok ? first.version : -1;
  expect(await stub.outboxUnackedCount()).toBe(1);

  const second = await stub.tryPutDomainConfig(key, true, meta, idem);
  expect(second.ok).toBe(true);
  if (second.ok) expect(second.version).toBe(version1);
  expect(await stub.outboxUnackedCount()).toBe(1);
});

it('fingerprint conflict returns idempotency_key_reused', async () => {
  const stub = propertyStub(`idem-conflict-${crypto.randomUUID()}`);
  const meta = { actor: 'tester', reason: 'conflict' };
  const key = 'pms.availability.allow_overbooking';
  await stub.tryPutDomainConfig(key, true, meta, {
    key: 'fixed-key-2',
    fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }),
  });
  const conflict = await stub.tryPutDomainConfig(key, false, meta, {
    key: 'fixed-key-2',
    fingerprint: await fingerprintPayload({ key, value: false, actor: meta.actor, reason: meta.reason }),
  });
  expect(conflict).toEqual({ ok: false, error: IDEM_KEY_REUSED });
  expect(await stub.readConfig(key)).toBe(true);
});

it('drain without ack leaves rows; flush acks', async () => {
  const stub = propertyStub(`flush-${crypto.randomUUID()}`);
  const meta = { actor: 'tester', reason: 'flush' };
  const key = 'pms.availability.allow_overbooking';
  await stub.tryPutDomainConfig(key, true, meta, {
    key: 'fixed-key-3',
    fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }),
  });
  const drained = await stub.drainOutboxBatch();
  expect(drained.length).toBeGreaterThanOrEqual(1);
  expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);
  await stub.ackOutboxThrough(drained[drained.length - 1]!.seq);
  expect(await stub.outboxUnackedCount()).toBe(0);

  // second write + flushOutbox
  await stub.tryPutDomainConfig(key, false, meta, {
    key: 'fixed-key-4',
    fingerprint: await fingerprintPayload({ key, value: false, actor: meta.actor, reason: meta.reason }),
  });
  const flushed = await stub.flushOutbox();
  expect(flushed.flushed).toBeGreaterThanOrEqual(1);
  expect(await stub.outboxUnackedCount()).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/pms-core test -- test/property-do.spec.ts`

Expected: FAIL (arity / missing methods)

- [ ] **Step 3: Implement PropertyDO changes**

Imports:

```ts
import { domainConfigKeys, getConfigEntry, IDEM_KEY_REUSED, type IdempotencyKey } from '@hospai/contracts';
import {
  PROPERTY_MIGRATIONS,
  appendOutbox,
  ackOutboxThrough as ackOutboxThroughSql,
  drainOutbox,
  freeAvailability,
  migrateSql,
  runIdempotent,
  IdempotencyKeyReused,
  type OutboxRow,
} from '@hospai/do-runtime';
```

Update `putDomainConfig` / `tryPutDomainConfig` signatures to require `idem: IdempotencyKey`.

JSDoc on `tryPutDomainConfig`:

```ts
/**
 * DOMAIN config write. Caller must pass IdempotencyKey whose fingerprint is
 * fingerprintPayload({ key, value, actor: meta.actor, reason: meta.reason }).
 * `effectiveFrom` is excluded from the fingerprint.
 */
```

Body structure:

```ts
async tryPutDomainConfig(...): Promise<...> {
  const entry = getConfigEntry(key);
  if (!entry) return { ok: false, error: `undeclared:${key}` };
  if (entry.class !== 'DOMAIN') {
    return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
  }
  try {
    return runIdempotent(this.ctx.storage.sql, idem, () => {
      const parsed = validateConfigWrite(key, value);
      // ... existing upsert + audit ...
      appendOutbox(this.ctx.storage.sql, {
        eventId: crypto.randomUUID(),
        eventType: 'config.changed',
        payload: { key, version, consumers: entry.consumers, actor: meta.actor },
      });
      return { ok: true as const, key, version, events: ['config.changed'] };
    });
  } catch (e) {
    if (e instanceof IdempotencyKeyReused) {
      return { ok: false, error: IDEM_KEY_REUSED };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

Add methods:

```ts
async drainOutboxBatch(opts?: { maxMessages?: number; maxBytes?: number }): Promise<OutboxRow[]> {
  return drainOutbox(this.ctx.storage.sql, opts);
}

async ackOutboxThrough(seq: number): Promise<void> {
  ackOutboxThroughSql(this.ctx.storage.sql, seq);
}

async flushOutbox(
  deliver?: (batch: OutboxRow[]) => Promise<void>,
): Promise<{ flushed: number }> {
  const batch = drainOutbox(this.ctx.storage.sql);
  if (batch.length === 0) return { flushed: 0 };
  if (deliver) await deliver(batch);
  ackOutboxThroughSql(this.ctx.storage.sql, batch[batch.length - 1]!.seq);
  return { flushed: batch.length };
}
```

Keep `outboxUnackedCount()` as-is.

Update README Phase 0 blurb to mention idempotency × outbox in progress / done.

- [ ] **Step 4: Run full verification**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm check:ddl
```

Expected: all green

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/property-do.spec.ts README.md
git commit -m "$(cat <<'EOF'
Wire PropertyDO config puts through runIdempotent and outbox flush.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `IdempotencyKey`, `IDEM_KEY_REUSED`, `fingerprintPayload` in contracts | 1 |
| No hashing in DO | 4 (caller hashes; DO compares) |
| `appendOutbox`, `drainOutbox`, `ackOutboxThrough` | 2 |
| `runIdempotent` sync, empty key/fingerprint reject, `IdempotencyKeyReused` | 3 |
| Retrofit `tryPutDomainConfig` + fingerprint allowlist | 4 |
| `flushOutbox(deliver?)` | 4 |
| Tests 1–6 from spec | 3 (unit) + 4 (DO) |
| Out: Queues, alarms, retention, HTTP | none (intentional) |

## Self-review notes

- Column alias risk called out in Task 2 — use raw `event_id` mapping if needed.
- `putDomainConfig` callers: only tests today; update all call sites in the same Task 4 commit.
- `instanceof IdempotencyKeyReused` is correct **inside** PropertyDO (same isolate).
