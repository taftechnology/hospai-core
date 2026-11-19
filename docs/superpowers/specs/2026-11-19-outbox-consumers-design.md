# Outbox consumers and Queue workers (R4.5)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.5. This is the Phase 2 mechanism, needed before or with **R4.3**.
**Sources:**
- ARCHITECTURE.md §5 (the module manifest; how modules talk), §8 (events), §10.1 (idempotency and the outbox), §14 Phase 2.
- [Queues consumer](./2026-07-28-queues-consumer-design.md): the producer contract, the envelope and the proof consumer.
- [Event log R2](./2026-08-12-event-log-r2-design.md).
- [ARI KV projection](./2026-07-29-ari-kv-projection-design.md).
- [Exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md).
- [Housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md), for in-transaction `subscribes`.

**Amends:** the queues consumer spec §5 and its *Consumer (proof handler)* section. One hard-coded proof consumer becomes a registry of named consumers. Add a pointer sentence there.

---

## 1. Why

The producer side is finished:
- the outbox is written in the same transaction as the mutation;
- the alarm sweep is byte-bounded and backlog-aware, behind the BACKGROUND lane;
- every delivered event is archived to R2.

The consumer side is still the Phase 0 proof. `index.ts` `queue()` runs, for every message:
1. one contract-assertion switch (`handleDomainEvent`);
2. one hard-coded `if (eventType === 'availability.changed')` for the ARI projection;
3. a `guest.erased` branch inside the switch that starts `PurgeWorkflow`.

The next three pilot slices need consumers with side effects outside HospAI:
- **R4.3** pushes ARI to a channel manager;
- **R5.5** calls the e-invoice portal;
- **R4.21** sends stay events to the POS.

On today's shape, each would add one more `if` to `index.ts`. That is the special case §14 Phase 2 forbids. It also has three real defects:

| Defect | Effect |
|---|---|
| One failure retries the whole message | A failing channel push re-runs the ARI projection and the purge start. Three failures send the event to the DLQ, which also takes the event away from the consumers that worked. |
| No entitlement gate | Every consumer runs for every tenant. An add-on consumer would run for hotels that never bought it. |
| The DLQ has no reader | After `max_retries` an event disappears without anyone noticing. Nobody at the hotel can see it or retry it. |

This slice makes consumers a declared, gated and isolated mechanism, and moves the two real consumers onto it. **The first add-on (R4.3) then adds a manifest entry and a handler, and nothing else.**

## 2. Scope

**In**
1. A consumer declaration: `consumes` on the module manifest, plus a core list in pms-core for consumers that are not modules.
2. One consumer registry in pms-core: the core list plus `MODULE_REGISTRY` manifests, each mapped to a static handler.
3. A fan-out router on `hospai-events`. Per message it:
   - checks the envelope contract;
   - archives to R2;
   - then runs each subscribed consumer separately, each with its own dedupe, gate and failure path.
4. A per-consumer retry queue `hospai-event-retries`, with a DLQ `hospai-event-retries-dlq` that has its own consumer.
5. Durable failure rows on the property (`event_consumer_exception`). Operators **Retry** or **Dismiss** them from the existing exceptions workbench.
6. Move the ARI projection and the guest purge start onto the registry. Behaviour does not change.
7. Extend `check:module-manifests` to validate `consumes`.

**Out (named leftovers)**
- Rate limits and per-property FIFO for one consumer. That belongs to R4.3's connector, in its own DO. See §4 rule 2.
- An org-level workbench for consumers of org-sourced events. Their dead letters are logged (§7).
- A night-audit check id for open consumer exceptions. The shared evaluator gains it when a consumer that the night audit cares about ships (R4.21, R5.5).
- A per-consumer "last success" or status read. That is R4.3's *connector status*.
- Outbox retention and idempotency purge. These are unchanged (queues spec).
- HTTP webhooks to third parties (marketplace, Phase 3).
- `subscribes` (the in-transaction module handlers, for example maintenance on `room.ooo_changed`) is untouched.

## 3. The declaration

### 3.1 Two kinds of subscription — do not merge them

| Field | Runs | Can do | Example |
|---|---|---|---|
| `subscribes` (exists) | **Inside the producing DO's `transactionSync`**, through `moduleTxnCtx` | Write the module's own tables in the same atomic write. No I/O. | maintenance opens a ticket on `room.ooo_changed` |
| `consumes` (new) | **In the Worker, from the queue**, after the commit | Async I/O: KV, R2, a Workflow, a DO RPC, an external API | ARI projection, channel push, portal call |

### 3.2 Shape (`@hospai/contracts` `module-manifest.ts`)

```ts
export type ModuleConsumerDecl = {
  /** `${moduleId}.${name}`, snake_case after the dot. Unique across the registry. */
  consumer: string;
  /** Operator-facing name shown on the workbench. */
  label: string;
  /** Event types. Each must be published by a module or listed in COMMAND_CATALOG events[]. */
  events: string[];
  /** Export name in the module's src/index.ts. */
  handler: string;
  /** Defaults to the manifest's `entitlement`. Must be a FEATURE_KEYS key, or null with gateExempt. */
  entitlement?: FeatureKey | null;
  /** Required when entitlement is null. The only reason allowed today. */
  gateExempt?: 'legal_duty';
};

// ModuleManifest gains:
consumes?: ModuleConsumerDecl[];
```

`apps/pms-core/src/event-consumers.ts` holds `CORE_CONSUMERS: ModuleConsumerDecl[]`, the same shape with the `pms.` prefix, for consumers that live in pms-core. It also holds the static map `CONSUMER_HANDLERS: Record<consumerId, ConsumerHandler>`.

pms-core is the composition root. It may import a module's or an add-on's exported handler. `modules/pms/*` still never imports `modules/addons/*`.

`consumerRegistry()` returns the core list plus every manifest's `consumes`, resolved:
- the default entitlement is filled in;
- a duplicate id or a missing handler throws at module load. A test pins that throw.

### 3.3 The two consumers moved in this slice

| Consumer | Label | Events | Entitlement | Handler |
|---|---|---|---|---|
| `pms.ari_projection` | ARI projection | `availability.changed` | `pms.core` | existing `handleAvailabilityChanged` |
| `pms.guest_purge` | Guest erasure | `guest.erased` | none (see below) | the `enqueueGuestPurge` body, moved out of the contract switch |

**Guest erasure is never gated.** Erasure is a legal duty, and the kill-switch and entitlements must not stop it (AGENTS §1 *Kill-switch*). `entitlement: null` is allowed **only** with a `gateExempt: 'legal_duty'` reason field. The manifest check refuses `null` without the reason.

## 4. Handler contract

```ts
export type ConsumerCtx = {
  env: PmsEnv;
  consumerId: string;
  source: EventSource;          // envelope source
  orgId: string;                // resolved (property → registry)
  propertyId: string | null;    // null for org-sourced events
  /** Dedupe key for any DO write: `consumer:${consumerId}:${eventId}`. */
  idempotencyKey: string;
  observability: ObservabilityContext;
};
export type ConsumerHandler = (ctx: ConsumerCtx, event: DomainEventMessage) => Promise<void>;

/** Throw for a failure that a retry cannot fix. It goes straight to the exception row. */
export class ConsumerPermanentError extends Error { code: string }
```

Rules. The spec's tests pin rules 1, 3 and 5.

1. **Idempotent by event.** Delivery is at-least-once, and the KV dedupe in §5 is advisory. A handler that writes to a DO passes `ctx.idempotencyKey` to an RPC that runs `runIdempotent`, with fingerprint `{ commandId: consumerId, payload: { eventId } }` and a `system` actor. The key is the system actor's own: it never borrows a user's key space. This is the rule the queues spec §5 already states. It now has a helper: `consumerIdempotencyKey(consumerId, eventId)` in `@hospai/do-runtime`.
2. **Events are triggers, not state.** Queue retries reorder freely. A handler reads current state from the source of record, as the ARI projection does with `readAvailabilityRange`, or it rejects a stale event by `seq` against its own cursor. A consumer that needs FIFO or a rate limit, such as the R4.3 channel push, forwards to its own per-property DO, which orders and paces. The queue handler stays short.
3. **Bounded.** A handler finishes within `CONSUMER_HANDLER_TIMEOUT_MS = 15_000`. The router enforces it with a race, and a timeout is a retryable failure. Long work goes to the module's DO, alarm or Workflow.
4. **No PII in errors.** The error message is stored on the property and shown to staff. Handlers throw codes and ids, never names. The router truncates `detail` to 500 characters.
5. **Unknown is not ignored.** An event type a consumer declared but cannot handle is a bug: it throws and is retried. Unknown **event types** still throw in the contract step before fan-out. The queues spec's *consumer change first, producer second* deployment rule is unchanged.

## 5. The router (`hospai-events`)

For each message in the batch:

1. **Contract.** `assertEventContract(body)` is the existing switch from `handleDomainEvent`, renamed. It only asserts the payload and never has side effects (the purge start moves to `pms.guest_purge`). A failure is retried, then sent to the DLQ, as today.
2. **Envelope fast path.** If KV `seen:${eventId}` is set, ack. This is unchanged and set only after the whole fan-out is done.
3. **Archive** to R2 through `archiveBySource`, as today. An event that fails to archive retries the whole message, and no consumer runs. The log comes first.
4. **Fan out.** For each registry consumer whose `events` include `eventType`:
   1. KV `seen:${consumerId}:${eventId}` is set → skip.
   2. **Gate**, cached per batch:
      - resolve `orgId`: a property source goes through the registry (`resolvePropertyFromRegistry`); an org source is the org itself;
      - check `assertTenantActive`;
      - check the consumer's entitlement through `loadSnapshot` + `require`;
      - check the operational kill-switch for that feature key (`checkKillSwitch` from `@hospai/entitlement-client`).
      - **Not entitled, killed, or tenant inactive** → skip. Log `consumer.skipped` with the reason and set the per-consumer seen key, so a retry does not ask again. Re-enabling never replays skipped events: a consumer that needs a catch-up does a full sync on enable. R4.3 already requires one.
      - **The gate cannot be resolved** (registry miss, entitlement read throws) → this is a **retryable failure**. Never skip on doubt.
   3. Run the handler with the timeout. Success → set `seen:${consumerId}:${eventId}` (TTL `DEDUPE_TTL_SEC`) and log `consumer.ok`.
   4. Retryable failure → send `{ consumerId, event, attempt: 1, firstFailedAt }` to `EVENT_RETRY_QUEUE` with `delaySeconds = retryDelaySeconds(1)`, and log `consumer.failed`.
   5. `ConsumerPermanentError` → record the exception directly (§7) and log `consumer.dead_letter`.
5. **Ack** once every consumer has succeeded, been skipped, been handed to the retry queue or been recorded. Set `seen:${eventId}`. If a hand-off itself fails (the retry queue send or the exception RPC throws), `msg.retry()` the whole message. The per-consumer seen keys make the re-run skip the consumers that are already done.

`retryDelaySeconds(attempt) = min(30 * 2^(attempt-1), 900)` gives 30 s, 60 s, 120 s, 240 s, 480 s, then 900 s. It is a pure function with a test.

An event with no consumer is archived and acked, which is the common case.

## 6. The retry queue (`hospai-event-retries`)

Each message is one `(consumer, event)`, so one consumer's retries never touch another's.

1. Unknown `consumerId` (a consumer removed in a deploy) → ack, and log `consumer.retired`.
2. `seen:${consumerId}:${eventId}` is set → ack.
3. Gate, as in §5 step 4.2: skip → set seen and ack.
4. Run with the timeout:
   - success → set seen and ack;
   - retryable failure, below `MAX_CONSUMER_ATTEMPTS = 6` (the first try plus five retries) → **send a new message** `{ consumerId, event, attempt: attempt + 1, firstFailedAt, lastErrorCode, lastErrorDetail }` with `delaySeconds = retryDelaySeconds(attempt + 1)`, then ack this one. The message carries the latest error, so the exception row shows the real cause;
   - retryable failure at `MAX_CONSUMER_ATTEMPTS` → record the exception with the last error and the true attempt count, then ack;
   - permanent failure → record the exception and ack.
   - Only a failed hand-off (the send or the record throws) uses `msg.retry()`. So the Cloudflare DLQ (§7) is the floor for hand-off failures, not the normal end of a failing consumer.

Wrangler: `max_batch_size: 10`, `max_retries: 5`, `dead_letter_queue: hospai-event-retries-dlq`, and **no** `max_concurrency` (queues spec §5 rule 3).

## 7. Dead letters and the exception row

`hospai-event-retries-dlq` has a consumer, so a dead letter is never silent:
- **Property-sourced** → `PropertyDO.recordConsumerException(...)`, then ack.
- **Org-sourced** → `logError` `consumer.dead_letter` with org id, consumer and event id, then ack. There is no org workbench, which is a named leftover. Today the only org consumer is `pms.guest_purge`, and `PurgeWorkflow` has its own certificate and operator path.
- If the record RPC throws, `msg.retry()`. The DLQ consumer gets `max_retries: 10` and no further DLQ, because the error log is the floor.

### 7.1 Table: PropertyDO migration **44**, `event_consumer_exception`

| Column | Notes |
|---|---|
| `exception_id` TEXT PK | |
| `consumer_id` TEXT NOT NULL | |
| `event_id` TEXT NOT NULL | UNIQUE with `consumer_id` |
| `event_type` TEXT NOT NULL | |
| `event_body` TEXT NOT NULL | the whole envelope JSON (≤ 128 KiB by the producer guard; events carry no PII) |
| `error_code` TEXT NOT NULL | `timeout`, `handler_error` or the permanent error's code |
| `error_detail` TEXT | ≤ 500 chars |
| `attempts` INTEGER NOT NULL | |
| `first_failed_at`, `last_failed_at` INTEGER NOT NULL | |
| `resolved_at` INTEGER, `resolved_by` TEXT, `resolution` TEXT | `resolution` CHECK IN (`retried`, `dismissed`) |
| `dismiss_reason` TEXT | required when dismissed |

- **Record is an upsert** on `(consumer_id, event_id)`. A repeat failure after a Retry **reopens** the row: it clears `resolved_*`, adds to `attempts` and updates `last_failed_at` and the error. It does not insert a second row.
- Index `(resolved_at, last_failed_at)`.
- Add the table to `PROPERTY_PURGE_INVENTORY_TABLES` and the purge row count.
- The night audit does not read it (§2 Out).

### 7.2 Commands

| Command | Lane | Class | Permission | Entitlement | Event |
|---|---|---|---|---|---|
| `events.retry_consumer_exception` | INTERACTIVE | FAIL_CLOSED | `night_audit:run` (same as the provisional workbench) | `pms.core` | `event_consumer.retry_requested` |
| `events.dismiss_consumer_exception` | INTERACTIVE | FAIL_CLOSED | `night_audit:run` | `pms.core` | `event_consumer.exception_dismissed` |

Both are idempotent with fingerprint `{ commandId, payload }`, keys per user, write the audit log (`entityType: 'event_consumer_exception'`) and refuse an already-resolved row unless the fingerprint matches. Dismiss requires `reason` (1–500 chars, 422 otherwise).

**Retry goes through the outbox, not a direct queue send.** The command stamps `resolution = 'retried'` and appends `event_consumer.retry_requested` with payload `{ propertyId, exceptionId, consumerId, event }` in the same `transactionSync`. The router treats this one event type as a system event. After the contract check and archive, it runs **only** the named consumer on the inner `event`, ignoring that consumer's seen key, with the normal gate, timeout and failure path. If that run fails with a retryable error, it is handed to the retry queue (§6) **without** touching the row; the row reopens through the upsert only when that consumer finally dead-letters or fails permanently. A later automatic success therefore leaves the row resolved. This keeps the retry transactional and at-least-once, with no new send path.

Kill-switch: these are operator recovery actions on the core plan, not lifecycle. The kill-switch does not apply to them, beyond what `pms.core` routes already do.

### 7.3 HTTP routes (append to `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`)

| Route id | Method and path | Permission | Notes |
|---|---|---|---|
| `get_event_consumer_exceptions` | GET `/v1/properties/:propertyId/event-consumer-exceptions?status=open\|all&limit=` | `property:read` | `limit` ≤ 100 (422 `limit_exceeded`); newest `last_failed_at` first; each row has `consumerLabel` from the registry |
| `post_event_consumer_exception_retry` | POST `…/event-consumer-exceptions/:exceptionId/retry` | `night_audit:run` | idempotency key in the JSON `idempotencyKey`, the same as `post_provisional_exception_resolve` |
| `post_event_consumer_exception_dismiss` | POST `…/event-consumer-exceptions/:exceptionId/dismiss` | `night_audit:run` | JSON `idempotencyKey` + `reason` |

`resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` is called on all three. The JSON is parsed once with the shared helper. Errors use the one `commandErrorHttpStatus` table, with no route-local override: unknown id → 404 `not_found`; resolved row → `already_resolved` at the table's status (422, as on the provisional workbench), without the row.

## 8. Operator screen

The existing exceptions workbench gains an **Event delivery** section under the replay exceptions. It is not a new route or overlay.

- **Table** (`DataTable`): consumer label, event type, attempts, first failed, last failed, error code with detail.
- **Retry**: a `Button`. Success → an `Alert` saying the event was re-sent.
- **Dismiss**: `intent=destructive`, confirms in the existing `Dialog` with a required reason.
- The three states are distinct:
  - empty: "No event delivery failures.";
  - load error: through `classifiedUserMessage`;
  - filter with no matches.
- **Cache:** query key `['event-consumer-exceptions', propertyId, status]`. Retry and Dismiss invalidate that exact prefix, plus the shell badge's key.
- The shell exceptions badge counts **both** sources, through two existing-style count reads. The open list request with `limit=1` is not a count, so add `count: number` to the list response.
- Gating: the section needs `property:read`; Retry and Dismiss need `night_audit:run`, or they are disabled with the reason shown.
- Copy and controls come from ui-kit only. No inline styles, and nothing new in `styles.css` beyond kit classes.

## 9. Manifest check (`check:module-manifests`)

For every `consumes` entry, and for `CORE_CONSUMERS` (exported for the script):
- the id is prefixed by its module id (`pms.` for core);
- the id is unique across the registry;
- every event is published by some module or appears in `COMMAND_CATALOG` `events[]`;
- the handler is exported from the module's `src/index.ts` (core: present in `CONSUMER_HANDLERS`);
- `entitlement` is a `FEATURE_KEYS` key, or `null` with `gateExempt`.

Self-tests cover each failure, mirroring the existing `subscribes` self-tests.

## 10. Wrangler and ops

`apps/pms-core/wrangler.jsonc` needs these at top level **and** in `env.staging`, which uses `-staging` suffixed names as the existing queues do:
- producer `EVENT_RETRY_QUEUE` → `hospai-event-retries`;
- consumers `hospai-event-retries` (§6) and `hospai-event-retries-dlq` (§7).

The `queue()` entry switches on `batch.queue`, as it does today for pending commands. It strips the `-staging` suffix with a single helper, and that helper is tested. Add the vitest miniflare bindings as well.

**Ops before the next staging deploy** (staging deploy is manual): create the two queues with `wrangler queues create` (staging names). The roadmap Done note says so. `wrangler deploy --dry-run` in CI does not need them.

## 11. Tests

pms-core: new `test/event-consumers.spec.ts`. Existing `events-queue`, `ari-projection`, `event-log-replay` and purge specs keep passing unchanged, apart from the moved purge branch.

1. **Isolation.** Two fixture consumers on one event, one throws:
   - the good one runs once;
   - the failing one is sent to the retry queue with attempt 1 and delay 30;
   - the message is acked;
   - re-delivering the same message runs neither again.
2. **Gate.** A consumer entitled to a feature the org lacks is skipped and logged, and its seen key is set. With the kill-switch on, it is skipped. If the entitlement read throws, it is a retry, not a skip.
3. **Guest purge is never gated.** `guest.erased` starts `PurgeWorkflow` with the org's entitlements stripped and the kill-switch on.
4. **Retry queue.**
   - Success acks.
   - Failure → `retry` with `retryDelaySeconds(attempts+1)`.
   - An unknown consumer id is acked and logged.
   - `ConsumerPermanentError` records the exception without retrying.
5. **DLQ.** A property-sourced dead letter writes one `event_consumer_exception` row. A second dead letter for the same pair updates `attempts`, not rows. An org-sourced one logs only.
6. **Retry command.**
   - It writes `event_consumer.retry_requested` in the same transaction as the stamp.
   - The router runs only that consumer, even though its seen key is unset or stale.
   - A failure reopens the row.
   - A replay of the same idempotency key posts once.
   - A clerk without `night_audit:run` gets 403.
7. **Dismiss.** It needs a reason (422 without one). Dismissing a resolved row → 422 `already_resolved` with no row body. The audit log entry is written.
8. **Isolation between hotels.** Hotel A's list never shows hotel B's rows (two properties, one org).
9. **Timeout.** A handler that never resolves is a retryable failure after `CONSUMER_HANDLER_TIMEOUT_MS`. Use fake timers.
10. **Registry.** A duplicate id throws at load, and so does a missing handler. `consumerRegistry()` contains both moved consumers.
11. **Durable dedupe helper.** A fixture consumer that writes to PropertyDO through `consumerIdempotencyKey` writes once when the same event is delivered twice with KV seen cleared. This proves rule 1 against the real `runIdempotent`.

contracts: manifest type tests; catalog and route pins.
web-pms: the Event delivery section's three states; Retry and Dismiss send the right ids and invalidate the consumer key; Dismiss requires a reason; gating disables the buttons.
`check:module-manifests` self-tests.

## 12. Pins (same commit)

| Pin | Before | After |
|---|---|---|
| `COMMAND_CATALOG` length | 109 | **111** |
| `V1_HTTP_ROUTE_AUDIT` | 176, last `put_tax_rule_end` | **179**, last `post_event_consumer_exception_dismiss` |
| `PROPERTY_SCHEMA_HEAD` | 43 | **44** |
| `AUDIT_WRITER_COMMAND_IDS` | 79 | **81** |
| `NIGHT_AUDIT_STEPS` | 8 | 8 (unchanged) |

New event types `event_consumer.retry_requested` and `event_consumer.exception_dismissed` go into the router's contract switch in the same change (consumer first).

## 13. Feature checklist (AGENTS §6)

- [x] **Tenant:** the URL property only. Exception ids are looked up inside that property's DO.
- [x] **Authz:** `property:read` to read, `night_audit:run` to act. The kill-switch does not apply (§7.2).
- [x] **Catalog:** two commands, both INTERACTIVE, which is a true lane. Three routes, in both `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] **Idempotency:** `{ commandId, payload }`, keys per user. Consumer DO writes use a system-actor key (§4 rule 1).
- [x] **Bounded input:** `limit` ≤ 100, `reason` ≤ 500. JSON parsed through the helper.
- [x] **Property context:** `resolvePropertyContext` on every route.
- [x] **Money and inventory:** none touched.
- [x] **Errors:** the existing table, with no route-local override; no row in a refusal.
- [x] **SPA:** the key carries the property and status; local invalidation; `classifiedUserMessage`; ui-kit only.
- [x] **Tests:** two-property isolation; no `it.only`.
- [x] **Pins:** §12.
- [x] **Settings:** no new control.
- [x] **Specs:** queues consumer, event log and workbench searched and amended, not duplicated.
