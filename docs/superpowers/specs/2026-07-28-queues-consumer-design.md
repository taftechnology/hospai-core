# Queues consumer (Phase 0 — event bus)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §4.2, §4.4, §10.1, §8 (events); freeze-gate `outbox`; idempotency-outbox spec

## Purpose

Close the last Phase 0 item with **schema exposure**: wire the transactional outbox to Cloudflare Queues and a proof consumer so every event type the codebase already produces is **exercised end-to-end**.

Phase 0 exit criterion (ARCHITECTURE Phase 0): *"Ship `pms.inventory` through the whole stack to prove the contract."* Producer-side contract work — `guestRef` not display names, `FolioLineAmount` not bare integers, `piiKeyId` not plaintext — is verified in tests today but **nothing has ever consumed an outbox row in production**. `flushOutbox` exists; tests call it without a `deliver` callback. There is no `EVENTS_QUEUE` binding in `wrangler.jsonc`.

This slice delivers: **produce → drain → queue → consume → dedupe**, without extending the freeze-gate `outbox` table.

## Why now

| Factor | State |
|---|---|
| `outbox` schema | Freeze-gate (`0001_freeze_gate.sql`) — `acked` boolean only |
| Producers | PropertyDO + OrgDO append on every idempotent command |
| Drain helpers | `drainOutbox`, `ackOutboxThrough`, `flushOutbox(deliver?)` in `@hospai/do-runtime` |
| PropertyDO alarm | `AlarmScheduler` + `night-audit` schedule only — **no `outbox` handler** |
| OrgDO alarm | **None** — no `alarm_schedule`, no `alarm()`, `guest.*` events orphaned |
| Queue binding | Absent |

If post-send failure handling or attempt counting must live in SQLite, that's a fleet migration. Pin the producer/consumer contract **before** properties exist in production.

LaneGuard, Clerk, migration Workflow, and observability are additive at existing seams and do not block this slice.

## Scope

**In**

- `EVENTS_QUEUE` producer binding on `pms-core` Worker
- Queue consumer handler (same Worker for Phase 0)
- Shared message envelope in `@hospai/contracts`
- **`appendOutbox` payload size guard** + **`drainOutbox` byte caps aligned to Cloudflare limits** (pre-requisite — see **Queue limits**)
- `flushOutbox` wired with real `sendBatch` via `deliver`
- PropertyDO: `'outbox'` schedule on `alarm_schedule`, `'outbox'` handler in `alarm()` with **backlog-aware reschedule**
- OrgDO: migration **v3** `alarm_schedule`, `AlarmScheduler`, `alarm()`, `'outbox'` schedule + handler (see **OrgDO** below)
- Consumer dedupe store (KV) keyed on `event_id` — **advisory only** (see §5)
- Proof consumer: idempotent handle, payload contract assertions per event family
- Vitest: produce → alarm flush → consumer receives; replay dedupes; send failure leaves rows unacked

**Out**

- Freeze-gate `outbox` schema change (`attempts`, `last_error`, `dlq_at`)
- R2 / Pipelines archival
- ARI KV projection consumer
- LaneGuard / `quietMs` admission (see **Drain timing**)
- `waitUntil(flushOutbox())` on interactive command paths
- HTTP webhook delivery
- Idempotency retention purge (not implemented today — document dependency only)

## Queue limits (normative)

Cloudflare Queues `sendBatch` limits:

| Limit | Value |
|---|---|
| Messages per batch | 100 |
| Per-message size | 128 KiB |
| Total batch size | 256 KiB |

Constants in `@hospai/do-runtime`: `QUEUE_MAX_MESSAGES`, `QUEUE_MAX_MESSAGE_BYTES`, `QUEUE_MAX_BATCH_BYTES`. Envelope types in `@hospai/contracts`: `EventSource`, `DomainEventMessage`.

**Measured envelope, not a reserve constant.** `domainEventMessageUtf8Bytes`, `queueMessageUtf8Bytes(row, source)`, and `outboxAppendQueueBytes({ …, source })` JSON-serialize the real Queue message body (`{ eventId, eventType, payload, seq, source, createdAt }`). Both produce-time and drain-time guards derive from the same functions — no fixed 512-byte fudge factor.

**Tenant id bounds (provision).** `orgId` and `propertyId` are validated at provision via `validateTenantId`: `[a-zA-Z0-9_-]+`, ≤64 UTF-8 bytes. They flow into DO names, KV keys, and `source.id` in the envelope; bounding them keeps envelope measurement honest and prevents unbounded tenant-supplied strings in key spaces.

**`appendOutbox`** requires `source: EventSource` and rejects rows whose measured UTF-8 size exceeds `QUEUE_MAX_MESSAGE_BYTES` (128 KiB). Append uses worst-case `seq` / `createdAt` so produce-time checks remain conservative. A command that cannot emit a deliverable event **must fail at produce time**, not poison the sweep.

**`drainOutbox`** requires `opts.source` and budgets batch bytes on **full message size** via `queueMessageUtf8Bytes`, defaulting to `QUEUE_MAX_BATCH_BYTES`. Legacy rows that exceed the per-message cap throw `OutboxPayloadTooLargeError` at drain (alarm backoff + `last_error`) — they cannot be acked or sent and require operator intervention.

The previous 1 MB default was harmless while nothing called `sendBatch`; wiring the queue converts it into a **permanent stall** (send rejects → no ack → alarm retries the same oversize prefix forever).

## Two guarantees — do not conflate

| Boundary | Guarantee | Mechanism |
|---|---|---|
| Client → platform (command replay) | **Effectively exactly-once** per idempotency key | `runIdempotent` short-circuit: replay returns stored response; **no mutation, no `appendOutbox`** |
| Outbox → Queues → consumers | **At-least-once delivery** | Prefix ack after successful send; Queue retries; consumer dedupes on `event_id` |

### `event_id UNIQUE` does not give exactly-once production

Every producer assigns `eventId: crypto.randomUUID()` on each append. The `UNIQUE` constraint therefore **never fires** in normal operation — it is not a dedupe mechanism.

**Do not** rely on `UNIQUE` to make a second `appendOutbox` safe. A retry outside `runIdempotent` (or after idempotency record expiry) produces a **new** row with a **new** `event_id`; the consumer cannot treat that as a duplicate of the first.

Exactly-once **production** is bounded by **`runIdempotent` + idempotency record lifetime**, not by `event_id UNIQUE` or Queue retry windows.

**Consumer dedupe TTL** must track **producer idempotency retention**, not an arbitrary constant. Today there is no idempotency purge (`DELETE FROM idempotency` does not exist), so records live for the life of the DO and the guarantee is total — but unbounded growth against the 10 GB cap. When a purge lands (natural housekeeping), a command replayed after expiry emits a new `event_id` for the same logical event; consumer dedupe keyed only on `event_id` will **not** catch it. Write the dependency now: **consumer seen-TTL ≥ idempotency retention policy**, updated together.

## §1 — Producer ack semantics (DO → Queue)

Producer ack and consumer ack are **different layers**. Do not map Cloudflare's per-message consumer ack onto `ackOutboxThrough`.

### Drain → send → prefix ack

```ts
async flushOutbox(
  deliver?: (batch: OutboxRow[]) => Promise<void>,
): Promise<{ flushed: number; backlog: boolean }> {
  const { rows: batch, backlog } = drainOutbox(sql);
  if (batch.length === 0) return { flushed: 0, backlog: false };
  if (deliver) await deliver(batch);
  ackOutboxThrough(sql, batch.at(-1)!.seq);
  return { flushed: batch.length, backlog };
}
```

**Why prefix ack is safe.** `await sendBatch` releases the DO input gate. New commands may append outbox rows with higher `seq` while send is in flight. Prefix ack:

```sql
UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0
```

…cannot touch rows appended after the drain.

**On send failure:** nothing is acked; alarm retries the same prefix on the next sweep. At-least-once by design.

**On send success + crash before ack:** next sweep re-sends the same events; consumer dedupes on `event_id`.

## §2 — Who drains

**DO alarm**, not a cron Worker polling properties.

- PropertyDO: multiplex `'outbox'` with `'night-audit'` on the single alarm slot via `AlarmScheduler` (§4.4).
- OrgDO: same pattern after v3 migration (below).

### Drain timing

ARCHITECTURE §4.2 describes outbox sweep in the **BACKGROUND** lane with a `quietMs` window before admitting bulk work. **LaneGuard does not exist yet.** `AlarmScheduler` has no quiet-window logic; alarms fire on schedule regardless of interactive traffic.

**Phase 0:** drain on the `'outbox'` alarm schedule **unconditionally**. Document that BACKGROUND admission lands with LaneGuard; do not claim a quiet window in this slice.

Input-gate exposure is small: `sendBatch` runs inside `alarm()`, outside `runIdempotent`, in a separate I/O gate from command mutations.

### Backlog-aware reschedule

Constants: `OUTBOX_SWEEP_INTERVAL_MS = 30_000` (idle cadence), `OUTBOX_BACKLOG_DELAY_MS = 1_000` (catch-up).

After a **successful** flush:

- `backlog === true` (`drainOutbox` returned fewer candidates than remain unacked) → `next_run_at = now + OUTBOX_BACKLOG_DELAY_MS`
- else → `next_run_at = now + OUTBOX_SWEEP_INTERVAL_MS`

A fixed +30 s bump after every flush caps throughput at ~3 events/s per DO regardless of backlog. Backlog-aware reschedule keeps idle cost at one sweep per 30 s while letting a burst drain at queue speed.

Handler must not leave `next_run_at` in the past (same never-spin rule as night-audit).

## §3 — Failure handling — no outbox schema change

Keep freeze-gate `outbox` as-is (`acked INTEGER NOT NULL DEFAULT 0`).

| Failure | Layer | Behaviour |
|---|---|---|
| Send throws / DO evicted before ack | Pre-send (DO) | Rows stay unacked; alarm retries |
| Consumer throws | Post-send (Queue) | Cloudflare Queue retries + DLQ |
| Payload over Queue message limit | Produce time | `appendOutbox` throws `OutboxPayloadTooLargeError`; command fails |
| Legacy oversize row at drain | Pre-send (DO) | `drainOutbox` throws; alarm backoff records `last_error` |

Do **not** add `attempts`, `last_error`, or `dlq_at` to `outbox` in Phase 0. Post-send poison is Queue's problem once `sendBatch` succeeds.

Observability (Phase 0 minimum): unacked count + oldest `created_at` per DO; Queue DLQ depth via wrangler/dashboard.

## §4 — Ordering and `seq`

### Per-DO stream

- `seq` is `AUTOINCREMENT` per DO SQLite. Rows are never deleted.
- Drain returns a **contiguous** prefix of unacked rows. **There are no gaps** in the producer stream.
- A consumer waiting for a "missing seq" to arrive will wait forever — the gap will never fill.

### What `seq` is for

**Staleness rejection only** — discard an event older than one already applied for the same `(sourceDo, sourceId, entityKey)` when the handler maintains a monotonic cursor. Last-write-wins against stale retries.

**Not for sequencing delivery.** Queue retries reorder freely. Handlers must be idempotent and must **not** assume FIFO delivery across the bus.

### Cross-DO

No ordering guarantee between PropertyDO and OrgDO, or between two properties. `guest.created` and `reservation.created` are independent streams.

## §5 — Consumer rules

1. **Handlers must be idempotent.** Phase 0 proof consumer uses KV `seen:${eventId}` as an **advisory** fast path — see below.
2. **Do not assume delivery order.** Retries are the duplicate source; serialization does not fix them.
3. **`max_concurrency: 1` is not a platform rule.** DOs serialize their own writes; concurrent consumers hitting *different* DOs never conflict; concurrent writes to the *same* DO are already serialized. Queue-wide `max_concurrency: 1` would serialize the entire fleet through one invocation — a hard ceiling at scale and not a substitute for idempotency. Use `max_concurrency` only as a **deliberate rate limit** against a downstream that needs one, with the reason recorded.
4. **`seq` in the envelope** is optional metadata for staleness rejection inside a handler — never required for dedupe (use `event_id`).

### KV dedupe is best-effort

`EVENT_DEDUPE_KV.get` is eventually consistent. Two concurrent deliveries of the same `event_id` — a Queue retry overlapping the original, or two consumer invocations — can both miss the `seen:` key and both handle. Harmless for the Phase 0 consumer (no DO writes). **Any consumer with side effects** must dedupe inside the same transaction as the effect — for this architecture, the receiving DO's idempotency table (§10.1 pattern), not KV alone.

**Cost note:** one KV write per event at dedupe TTL is a per-event cost multiplier; know it before volume matters.

## Message envelope

```ts
/** One Queue message — JSON body. */
export type DomainEventMessage = {
  eventId: string;
  eventType: string;
  payload: unknown;
  seq: number;
  source: { do: 'property' | 'org'; id: string };
  createdAt: number;
};
```

- `source.id` = `propertyId` or `orgId` from `__meta`.
- `payload` is the same JSON written to `outbox.payload`.
- Queue message ID may differ from `eventId`; dedupe on **`eventId`** only.

Mapping helper in `@hospai/do-runtime` or `@hospai/contracts`: `toQueueMessage(row: OutboxRow, source): DomainEventMessage`.

## PropertyDO wiring

1. **`ensureOutboxScheduleIfAbsent()`** at provision (mirror timezone/currency first-write): upsert `alarm_schedule` row `name = 'outbox'`, `next_run_at = now + OUTBOX_SWEEP_INTERVAL_MS`, arm alarm.
2. **`alarm()`** — add handler:

```ts
'outbox': async () => {
  const { flushed, backlog } = await this.flushOutbox((batch) =>
    this.env.EVENTS_QUEUE.sendBatch(batch.map((row) => toQueueBatchEntry(row, source))),
  );
  if (flushed === 0) return;
  const delay = backlog ? OUTBOX_BACKLOG_DELAY_MS : OUTBOX_SWEEP_INTERVAL_MS;
  this.scheduler.upsertSchedule('outbox', Date.now() + delay);
},
```

3. **`PmsEnv.EVENTS_QUEUE`** binding.

## OrgDO wiring (not a mirror — greenfield)

OrgDO today: outbox table exists (v2), guest commands append `guest.created` / `guest.updated` / `guest.erased`, **no drain path**.

Required (org migrations are **not** freeze-gate):

| Deliverable | Detail |
|---|---|
| Migration **v3** | `alarm_schedule` table — same DDL as PropertyDO `0003` |
| `migrations/do-org/0003_alarm_schedule.sql` | Generated; `check:ddl` entry |
| Constructor | `AlarmScheduler` instance |
| `ensureOutboxScheduleIfAbsent()` | First guest command or org bootstrap |
| `alarm()` | `'outbox'` handler only (no night-audit on OrgDO) |
| `flushOutbox` / drain / ack | Same helpers as PropertyDO |
| Test helpers | `triggerAlarmForTest`, schedule read — mirror PropertyDO unsafe-local pattern |

Until v3 lands, **`guest.*` events are orphaned** — called out explicitly; not covered by PropertyDO flush.

## Consumer (proof handler)

Phase 0 consumer lives on the same Worker:

```ts
export default {
  async queue(batch: MessageBatch<DomainEventMessage>, env: PmsEnv) {
    for (const msg of batch.messages) {
      const body = msg.body;
      if (await env.EVENT_DEDUPE_KV.get(`seen:${body.eventId}`)) {
        msg.ack();
        continue;
      }
      await handleDomainEvent(body); // contract assertions; no DO writes Phase 0
      await env.EVENT_DEDUPE_KV.put(`seen:${body.eventId}`, '1', { expirationTtl: DEDUPE_TTL_SEC });
      msg.ack();
    }
  },
};
```

`handleDomainEvent` (Phase 0): switch on `eventType`; assert payload shape — e.g. `reservation.created` contains `guestRef` and not `guestName`; `folio.line_posted` contains money columns; `guest.*` contains refs not plaintext. Log for test visibility.

Configure Queue DLQ in wrangler for poison messages.

**Dedupe TTL:** define `DEDUPE_TTL_SEC` as a named constant with comment: must remain ≥ idempotency retention when purge exists. Today: use a conservative large TTL (e.g. 30 days) with explicit TODO linked to retention policy.

## Wrangler bindings

```jsonc
"queues": {
  "producers": [{ "binding": "EVENTS_QUEUE", "queue": "hospai-events" }],
  "consumers": [{
    "queue": "hospai-events",
    "max_batch_size": 100,
    "max_batch_timeout": 5
    // no max_concurrency: 1 — see §5
  }]
},
"kv_namespaces": [
  { "binding": "EVENT_DEDUPE_KV", "id": "…" }
]
```

Vitest: miniflare queue + KV bindings in `vitest.config.ts`.

## Event types in scope for proof

Minimum set exercised by existing tests once wired:

| Source | Event types |
|---|---|
| PropertyDO | `config.changed`, `inventory.room_type_changed`, `availability.changed`, `reservation.created`, `reservation.status_changed`, `reservation.modified`, `restriction.changed`, `rate.changed`, `folio.line_posted`, `night_audit.started`, `night_audit.completed` |
| OrgDO | `guest.created`, `guest.updated`, `guest.erased` |

One integration test per family is enough for Phase 0; grep/assert payload contract, not full projection logic.

## Success tests

1. Config put → alarm outbox flush → consumer receives `config.changed` with expected payload keys.
2. Book reservation → `reservation.created` + `availability.changed` delivered; payload has `guestRef`, no plaintext name.
3. `addFolioLine` → `folio.line_posted` with money fields.
4. Org guest create → `guest.created` delivered (requires OrgDO alarm path).
5. Flush twice / alarm retry → consumer dedupes second delivery (`event_id` seen in KV).
6. Mock `sendBatch` throw → rows stay unacked; second flush succeeds and delivers once (consumer dedupe still safe if send succeeded but ack missed — test both paths separately).
7. `appendOutbox` rejects row over `QUEUE_MAX_MESSAGE_BYTES` (measured envelope via `outboxAppendQueueBytes`).
8. `drainOutbox` default batch budget ≤ 256 KiB on envelope-sized bytes.
9. `drainOutbox` mid-flight test (existing) unchanged — prefix ack does not ack rows appended after drain.
10. Backlog reschedule: after full batch flush with remaining unacked rows, next `'outbox'` run is within `OUTBOX_BACKLOG_DELAY_MS`, not 30 s.

## Non-goals reminder

Retention purge, R2 log, ARI projection, LaneGuard quiet window, interactive-path `waitUntil`, and outbox schema migration are deliberately deferred. This slice freezes the **producer send contract**, the **consumer idempotency contract**, and proves the **payload shapes** the last thirty rounds pinned.
