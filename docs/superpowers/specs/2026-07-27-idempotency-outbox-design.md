# Idempotency × Outbox Design (§10.1)

**Date:** 2026-07-27  
**Status:** Approved for Phase 0 foundation (post tenancy spine)  
**Sources:** ARCHITECTURE.md §4.1, §10.1, §14

## Purpose

Prove that the idempotency record, domain mutation, and outbox row are **one atomic write** inside PropertyDO. Retries must not double-mutate or double-emit. Add an in-DO outbox drain/ack path that rehearses the future Queue flush without binding Queues yet.

## Scope

**In**

- Wire types / codes in `@hospai/contracts`: `IdempotencyKey`, `fingerprintPayload` (edge-computed), `IDEM_KEY_REUSED` code
- Pure SQL helpers in `@hospai/do-runtime`: `appendOutbox`, `runIdempotent`, `drainOutbox` (UTF-8 byte cap), `ackOutboxThrough`
- Retrofit `PropertyDO.tryPutDomainConfig` to require an idempotency key and go through `runIdempotent`
- `PropertyDO.flushOutbox(deliver?)` — drain → optional deliver → prefix ack
- Tests proving §10.1 + mid-flight drain-without-ack

**Out**

- Cloudflare Queues / `EVENTS_QUEUE`
- `AlarmScheduler` / lane wiring
- 7-day idempotency retention sweep
- HTTP `Idempotency-Key` header (DO RPC + vitest only this slice)
- `pms.inventory`

## Invariants

1. **Atomic write.** On a cache miss, mutation + outbox append + idempotency insert must share one Durable Object I/O gate — **no `await` inside `runIdempotent` or its `execute` callback**.
2. **No hashing in the DO.** `fingerprintPayload` (SHA-256 via `crypto.subtle`) runs on the **edge** from the validated request body — never from a client-supplied fingerprint header, and never inside a PropertyDO command path. The DO stores and compares hex strings only.
3. **Replay is inert.** Same key + same fingerprint → return stored response; no mutation; no outbox append.
4. **Fingerprint conflict fails closed.** Same key + different fingerprint → error; no mutation.
5. **Outbox → consumers is at-least-once.** Drain and ack are separate I/O gates when `deliver` awaits. Consumers will dedupe on `event_id` (Queues slice). Prefix ack (`seq <= ?`) is exact because drain returns an ordered prefix.

## Components

### `@hospai/contracts`

```ts
export type IdempotencyKey = { key: string; fingerprint: string };

/** Wire / HTTP mapping code — not an Error class for stub catching. */
export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const;

/** Edge only. Sorted-key canonical JSON → SHA-256 hex. Never call from a DO command path. */
export function fingerprintPayload(input: unknown): Promise<string>;
```

The edge must `await fingerprintPayload(...)` from the **validated request body** before entering the DO method. Only the idempotency *key* may originate from the client.

### `@hospai/do-runtime`

```ts
export class IdempotencyKeyReused extends Error { /* name set */ }

export function appendOutbox(sql, { eventId, eventType, payload, source: EventSource }): void;

export function runIdempotent<T>(
  sql,
  idem: IdempotencyKey,
  execute: () => T, // sync only
): T;

export function drainOutbox(sql, opts: { maxMessages?: number; maxBytes?: number; source: EventSource }): DrainOutboxResult;
export function ackOutboxThrough(sql, seq: number): void;
```

- `drainOutbox` measures **Queue message** UTF-8 size via `queueMessageUtf8Bytes(row, source)` — full JSON envelope, not payload alone — matching Cloudflare limits: **256 KiB batch**, **128 KiB per message**, **100 messages** — not JS string `.length`.
- `appendOutbox` rejects rows that cannot fit a Queue message using `outboxAppendQueueBytes` with the same measured envelope (worst-case `seq` / `createdAt` at produce time). Requires `source: EventSource`.
- `orgId` / `propertyId` bounded at provision (`validateTenantId`: `[a-zA-Z0-9_-]+`, ≤64 UTF-8 bytes).
- `runIdempotent` validates **both** `key` and `fingerprint` are non-empty before SELECT.
- On hit + matching fingerprint: `JSON.parse(response)` and return (typed via caller).
- On hit + mismatch: throw `IdempotencyKeyReused` (caught **inside** the same isolate, e.g. by `tryPutDomainConfig`).
- On miss: `const result = execute();` then insert idempotency row with `JSON.stringify(result)`.

**Error placement.** The class lives next to `runIdempotent` — it is intra-isolate control flow. DO stubs flatten thrown types (`ARCHITECTURE` §4.1); HTTP must map **`{ ok: false, error: IDEM_KEY_REUSED }`**, never `instanceof` across a stub.

### `PropertyDO`

**`tryPutDomainConfig(key, value, meta, idem)`** — `idem` required.

Fingerprint allowlist (edge builds `fingerprintPayload` of exactly this shape):

```ts
{ key, value, actor: meta.actor, reason: meta.reason }
```

`effectiveFrom` is **excluded** from the fingerprint (optional / may be omitted on retry). Document this in the method JSDoc.

**Trust boundary.** The edge must compute `fingerprintPayload` server-side from the validated request body — only the idempotency *key* may originate from the client. A client-supplied fingerprint would allow replaying a stored response against a different body.

Inside `execute` (sync): config upsert + audit + `appendOutbox(config.changed)` + return `{ ok: true, key, version, events }`.

Catch `IdempotencyKeyReused` locally → `{ ok: false, error: IDEM_KEY_REUSED }`.

**Flush API**

```ts
async flushOutbox(
  deliver?: (batch: OutboxRow[]) => Promise<void>,
): Promise<{ flushed: number }>
```

1. `batch = drainOutbox(...)`
2. if empty, return `{ flushed: 0 }`
3. if `deliver`, `await deliver(batch)` — **new** I/O gate (at-least-once)
4. `ackOutboxThrough(batch.at(-1).seq)`
5. return `{ flushed: batch.length }`

Phase 0 callers omit `deliver` (explicit discard). Queues slice fills in `sendBatch`.

Also expose `drainOutbox` / `ackOutboxThrough` on the DO for the mid-flight test.

## Success tests

1. Same key + fingerprint twice → config version unchanged after first write; outbox unacked count = 1 before flush.
2. Same key, different fingerprint → `idempotency_key_reused`; config unchanged.
3. Drain without ack → rows stay unacked; then ack → 0 unacked.
4. `flushOutbox()` after write → unacked = 0.
5. DOMAIN vs PRESENTATION rejection still works (with a valid dummy idem key).
6. `runIdempotent` unit test (MemorySql): return type is synchronous `T` (not a Promise); miss path inserts idempotency + outbox in one call stack with no `await`. JSDoc on `runIdempotent` states the no-await invariant.

## Non-goals reminder

Retention purge, Queue binding, and HTTP headers are deliberately deferred so this slice freezes only the §10.1 atomicity contract.
