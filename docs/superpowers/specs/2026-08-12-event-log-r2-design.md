# Durable Event Log (R2) + `PURGE_R2` (§8 / §4.8 / §11)

**Date:** 2026-08-12  
**Status:** Accepted — implementation-ready  
**Sources:** ARCHITECTURE.md §4.7–§4.8 (R2 durable event log; purge step 4 “event-log segments” by prefix; step 5 Iceberg), §8 (events / “Pipelines → R2/Iceberg”), §11 (replay test), Rule 13 (PII by reference); [purge workflow](./2026-08-12-purge-workflow-design.md) (**amends §1.1** certificate statuses); [queues consumer](./2026-07-28-queues-consumer-design.md); [ARI KV projection](./2026-07-29-ari-kv-projection-design.md); [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)

**Amends:** [purge-workflow-design](./2026-08-12-purge-workflow-design.md) §1.1 (and linked step plans / VERIFY / tests / acceptance) — certificate statuses `pending` + `retained`; derived R2 skip; org `PURGE_R2` body; guest R2 retained; halted certificates must not claim `reached` for unattempted stores. Discoverable from either end.

---

## 1. Context & Motivation

§8 gives one line — *“Pipelines → R2/Iceberg stores every event durably for replay and analytics”* — while §11’s non-optional tests include rebuilding every projection from the R2 event log. Today there is an event envelope, outbox → `hospai-events` (batch 100, DLQ), and **exactly one** projection (ARI in `ARI_KV`). There is **no** R2 binding; purge certificates record `r2: skipped, reason: no_r2_binding`.

The moment a binding exists without `PURGE_R2`, that skip reason becomes false and the first tenant purge after this chunk would leave events in R2 while claiming the store was out of scope — the certificate-overstates-coverage failure the purge design existed to prevent. So this chunk ships the log **and** purge coverage together.

§11’s replay obligation is cheapest while there is one projection; every future projection inherits the harness.

### 1.1 Scope in

1. R2 bucket + `EVENT_LOG_R2` binding; Worker-side archival of every queue-delivered event.
2. Key layout: tenant-prefixed event-log segments; replay reader.
3. Log-fidelity tests + ARI SoR-convergence test; recorded §11 divergence for ARI.
4. Org `PURGE_R2` (prefix delete); guest R2 `retained`; VERIFY scans R2 only when `reached`.
5. Certificate status union widened to `pending | reached | skipped | retained`; R2 skip **derived** from binding presence; in-scope stores start `pending` (fixes shipped HALT certificates that claimed `reached, deleted: 0` before any step).
6. Amend purge design §1.1 (bidirectional pointers).

### 1.2 Scope out

- Iceberg / Cloudflare Pipelines / §4.9 fleet analytics (row-level delete stays step 5).
- New projections; DLQ replay tooling; time-based TTL / date-bucketed keys.
- Guest-scoped document/export R2 prefixes (no layout yet).
- Event-sourcing ARI or widening `availability.changed` payloads.

---

## 2. Write path (§1)

### 2.1 Mechanism — Worker writer, not Pipelines

**Lock: Worker-side `R2.put` under keys we own.**

§4.7 already lists them as **two rows**, not one store:

| Store | Use | Why |
|---|---|---|
| **R2** | Invoices, exports, ID documents, property images, **durable event log** | Zero egress; **replay source** |
| **Pipelines → R2 Data Catalog (Iceberg)** | Warehouse — every domain event, queryable by R2 SQL / DuckDB | Replaces Debezium→BigQuery |

§8’s one sentence collapses those two rows. This chunk implements the R2 row (replay source). Pipelines → Iceberg remains the §4.9 analytics path.

§4.8 step 4 is the matching purge treatment:

```
4. PURGE_R2          delete objects by prefix (documents, exports, event-log segments)
5. PURGE_ICEBERG     row-level delete / partition rewrite in the catalog
```

R2 holds tenant-prefixed **event-log segments** deleted by prefix. Iceberg gets row/partition deletes. Pipelines batches across tenants into shared files, which would force R2 purge into step 5’s work against a store both §4.7 and §4.8 assign to a different row.

Dual-write (Worker log + Pipelines now) is rejected: Iceberg is out of scope, and a second failure domain undercuts “the log is durable.”

### 2.2 Emitters

`{do}` in keys and `EventSource` is exactly `'property' | 'org'`. Only `PropertyDO` and `OrgDO` flush to `EVENTS_QUEUE`. `OrgEntitlementDO` has no outbox.

### 2.3 Consumer ordering (batch-aware)

Queues allows one consumer per queue. Archival and projection share the handler. Dedupe is **two** steps today (CHECK first, MARK last). Normative order:

```
1. CHECK all messages in the batch → ack+drop already-seen
2. Group SURVIVORS by source, sort each group by seq
3. Archive: one R2 object per source-group
4. Per surviving message: project (ARI today) → handleDomainEvent → MARK → ack
```

**Archive after CHECK, before project.** Duplicates in the log arise only from retry-after-failure (replay dedupes). Archiving before CHECK would re-archive every post-success redelivery — the case this ordering exists to avoid.

**Archive-first vs project** also means unknown event types (`handleDomainEvent` throws) are written to R2, then fail → retry → DLQ. The log records what was **emitted**, not what the consumer **understood** — desirable so a later handler can replay. Do not move archival after validation “to avoid logging garbage.”

**R2 put failure:** same idiom as today — retry the affected messages (see §2.5); eventually DLQ. Do **not** swallow the error and continue projecting (healthy projection, silent missing log).

### 2.4 Write unit — per-source-group segment

A queue batch of ≤100 mixes sources. One object per batch cannot be tenant-prefixed. One object per event is unnecessary put cost.

**Pattern:** group survivors by `source` → sort by `seq` → **one object per source-group**. Worst case 100 puts; typically fewer. Preserves per-source `seq` order inside each segment (`seq` is per-DO, not global).

### 2.5 Retry scope — failing group only

If group A’s put succeeds and group B’s fails, retry **only** messages in B. Retrying the whole batch re-archives A on every unrelated failure. Queues supports per-message `retry()`; use it. Duplicate churn stays proportional to the actual failure.

### 2.6 PII permanence

The log turns every event from transient queue payload into a durable object. It inherits Rule 13 (PII by reference only). No new certificate-style allowlist gate — existing producer/consumer tests remain the gate (e.g. `guest.created without PII` in the queue spec; `assertNoPlaintextGuestName` in the consumer). A future event type that adds a plaintext PII field must fail those tests before it can sit in R2.

---

## 3. Key layout (§2)

### 3.1 Object key

```
events/{do}/{id}/{seqStart:020}-{seqEnd:020}-{writeNonce}.ndjson
```

| Part | Role |
|---|---|
| `events/{do}/{id}/` | Purge / list prefix (`property` \| `org` + source id) |
| `{seqStart:020}-{seqEnd:020}` | Seq range; 20-digit zero-pad covers SQLite `INTEGER` max (19 digits) and uint64 |
| `{writeNonce}` | Per-put id (e.g. first `eventId` in the group or `crypto.randomUUID()`). Retries append; no silent overwrite |

**Body:** NDJSON; lines are full `DomainEventMessage` values, sorted by `seq`.

### 3.2 Lex order ≡ seq order (load-bearing)

Queue batches can arrive out of order, so a segment for seq 50–100 can be written before 1–49:

```
write order :  50-100    1-49    10-20     (out-of-order batches + overlapping retry)
lex order   :  1-49      10-20   50-100
```

Lex sorting object keys recovers seq order regardless of write order; overlapping retries slot in for replay to dedupe by `eventId`. This is the property deterministic replay depends on.

### 3.3 No date bucketing (accepted cost)

Omit date from the key. Reasons: no purge benefit (prefix is already `{do}/{id}`); ambiguous clock (`createdAt` vs write time); can disorder list relative to seq.

**Key layout is a one-way door.** Objects already written do not move. Introducing a date level later means replay and `PURGE_R2` must handle **both** layouts permanently — a fork, not a migration. This chunk **accepts unbounded prefix growth** and paginated list/delete (R2: 1000 list / 1000 delete per call) inside Workflow steps. That is fine — Workflows and purge chunking anticipate it — but it is not “we can add dates later cheaply.”

### 3.4 Deterministic keys rejected

Partial batch retry writes a **different** seq range, so “deterministic overwrite = idempotent” does not hold for the failure modes we have. Nonce keeps the log append-only and honest about delivery; replay dedupes.

---

## 4. Replay & §11 (§3)

### 4.1 Replay reader

```
listPrefix(events/{do}/{id}/)   // paginated
  → sort by object key (lex ≡ seq)
  → stream NDJSON
  → dedupe by eventId (last-write-wins)
  → yield DomainEventMessage in seq order
```

Event-type agnostic; callers filter (e.g. `availability.changed` for ARI).

### 4.2 ARI is SoR-refresh, not a fold

`handleAvailabilityChanged` reads range fields from the payload, then `PropertyDO.readAvailabilityRange` for **current** DO rows (ARI spec §2.3). Payloads do not carry ledger rows. Pure in-memory rebuild from the log alone is impossible without redesigning ARI — rejected for this chunk.

### 4.3 Two tests (both required)

**Log fidelity** (projection-independent — exercises this chunk):

1. **Completeness** — replayed `eventId` set equals the emitted set (ground truth from outbox / `mockQueueSendCapture` / `listOutboxPayloads()`).
2. **Dedupe** — after dedupe each `eventId` appears once.
3. **Ordering** — `seq` non-decreasing across the replayed stream (fails if padding or lex≡seq breaks).
4. **Fidelity** — full `DomainEventMessage` round-trips (payload survives NDJSON).

**Projection rebuild (B)** — list → dedupe → order → apply existing projector into scratch KV (or in-memory map with the same key/value shape) → diff vs live `ARI_KV` (ignore `writtenAt`). Honest SoR-convergence check; harness is what future event-sourced projections inherit (they simply won’t call the DO).

B alone would pass against a badly broken log (projector ignores `seq`/`eventId` and re-reads DO). Fidelity is what makes §2 enforceable.

### 4.4 §11 divergence (recorded)

§11: *“a replay test: rebuild every projection from the R2 event log and assert equivalence.”*

For ARI that is not achievable **by design** (SoR-refresh), not by omission. Same discipline as other recorded divergences (§16.3 rule 4).

**This chunk meets §11 by (a) log-fidelity tests for the log itself and (b) SoR-convergence for ARI.** A true log-only rebuild requires event-sourced projections; the first one that ships gets the stronger bar.

Non-claim: ARI is not recoverable from the log alone after PropertyDO purge; after tenant purge both DO and R2 prefixes are gone.

---

## 5. `PURGE_R2`, VERIFY, retention (§4)

### 5.1 Certificate statuses (amends purge §1.1)

```ts
status: 'pending' | 'reached' | 'skipped' | 'retained'
```

| Status | Meaning | VERIFY scans? | `deleted` |
|---|---|---|---|
| `pending` | In scope; **not yet attempted** (run halted before this step) | No | **Must be absent** |
| `reached` | Visited; applicable deletes done | Yes | Present when counting deletes; `deleted: 0` = nothing applicable |
| `skipped` | Out of scope for this deployment/run | No | Absent; `reason` required |
| `retained` | Visited; data **kept on purpose** | No | **Must be absent**; `reason` required |

`pending ≠ reached ≠ skipped ≠ retained`.

**Shipped bug this status fixes:** `initialStoresSkippedR2Iceberg()` seeded `key_store` / `property_do` / `org_do` as `reached, deleted: 0` *before any work*. A step-0 HALT therefore certified that those DOs were visited and empty while they still held the tenant’s live data — and implied a VERIFY scan that never ran. `pending` is the honest initial state for every in-scope store. Each step **replaces** (does not merge) its store on success. Iceberg (and R2 when unbound) start `skipped` because they are out of scope, not unattempted.

**`deleted: 0` is not one claim across stores:**

- Guest `property_do`: visited, declared guest-PII columns empty → nothing to delete; VERIFY still scans.
- `key_store` with `note: colocated_in_org_do`: visited and shredded in place; `deleted: 0` because rows aren’t removed; VERIFY still scans.
- `retained`: data kept; **no** `deleted` field — do not write `deleted: 0` on retained (reintroduces the ambiguity the status removes).
- `pending`: not visited; **no** `deleted` field.

### 5.2 Org path

Replace `skip-r2` with `purge-r2` when the binding is present:

1. Subjects already snapshotted: `orgId` + `propertyIds[]`.
2. List+delete (pages of 1000) under:
   - `events/org/{orgId}/`
   - `events/property/{propertyId}/` for each property
3. Certificate: `r2: { status: 'reached', deleted: <object count> }`.
4. Iceberg remains `skipped: no_iceberg_binding`.

### 5.3 Guest path

Do **not** delete event-log segments. Events carry `guestRef` / `piiKeyId`, never values; retaining them matches §4.8 (“what survives erasure, deliberately”). There is no guest-scoped event-log prefix; deleting a property prefix would wipe unrelated history.

The guest R2 **step** replaces `pending` with:

```ts
r2: { status: 'retained', reason: 'pii_by_reference_event_log' }
// no deleted field
```

Do not pre-mark `retained` at init — a HALT before the R2 step must still show `pending`.

`retained` reflects **current** R2 contents — the event log is the only guest-touching R2 object this chunk creates. §4.7 also lists R2 as holding **ID documents** (guest PII by value). Those prefixes are out of scope (no layout yet). When they ship, guest erasure must **delete** document objects while **retaining** event-log segments; a single `r2` certificate entry cannot express both. Do not cement “guest R2 = retained” as a rule. Guest-scoped document prefixes will need sub-entries per R2 purpose or a mixed status.

### 5.4 Derived skip

If `EVENT_LOG_R2` is absent at runtime → `skipped: no_r2_binding` **from init** (honest for partial/local deploys). If present → start `pending`; org R2 step replaces with `reached` + `deleted`; guest R2 step replaces with `retained`. Do not hardcode the skip off in source. Do not pre-mark `retained` or `reached` before the step runs — a HALT before that step must still show `pending`.

### 5.5 VERIFY (R2)

| Path | R2 residue = HALT |
|---|---|
| Org (`reached`) | Any object still listed under subject prefixes |
| Guest (`retained`) | Not scanned |
| Either (`skipped` or `pending`) | Not scanned |

**LIST consistency:** R2 documents **strong** consistency for deletion and object listing ([consistency model](https://developers.cloudflare.com/r2/reference/consistency/)). Worker bindings are not subject to the custom-domain cache caveat. After prefix delete, one authoritative empty list per subject prefix is enough — no lag-mitigation retry loop, no HEAD sampling. Any listed key → HALT `verify_r2_residue`. Prefer false HALT over false certify; do **not** add a preemptive limitation for list lag we have not demonstrated.

**Smoke test:** write many objects under a prefix, `delete(keys[])` in chunks of ≤1000, list, assert empty. Covers bulk delete (partial failure hiding behind success), not a single put→delete→list.

### 5.6 Retention

- No time-based TTL (follows §3.3 unbounded prefix).
- Log lives until org/tenant purge removes prefixes.
- Guest erase does not shorten retention.
- “Immutable” = append-only for a live tenant; purge ends retention for churn, not rewrite-in-place.
- **Archive-before-project ⇒ events that exhaust retries and land in the DLQ are still in the log.** Completeness holds for events the consumer never successfully processed.

---

## 6. Binding & types (§5)

| | |
|---|---|
| Bucket | `hospai-event-log` (env-specific naming OK in wrangler) |
| Binding | `EVENT_LOG_R2` |
| Helper | `hasEventLogR2(env)` (or equivalent) drives skip vs reach/retain |

Widen `PurgeStoreRecord` in `apps/pms-core/src/purge-certificate.ts` (and any contracts mirror). Initial store helper: in-scope stores `pending`; R2 skip derived from binding; Iceberg pre-skipped. Certified certificates contain no `pending`.

R2 binding is configured in `wrangler.jsonc` (simulated locally). No `.dev.vars` entry required for the bucket itself.

---

## 7. Acceptance (falsifiable)

1. **Archive-first path** — CHECK survivors → archive source-groups → project → MARK; put failure retries **failed group only**; unknown type archived then DLQs with object present.
2. **Log fidelity** — completeness, dedupe, non-decreasing `seq`, full envelope round-trip.
3. **Lex ≡ seq** — out-of-order / overlapping segments still yield non-decreasing `seq` after key sort.
4. **ARI convergence (B)** — scratch vs live (ignore `writtenAt`); §11 divergence recorded in this spec.
5. **Org `PURGE_R2`** — prefixes empty; certificate `r2: reached` + `deleted` count; VERIFY empty or HALT.
6. **Guest R2** — `retained` + `pii_by_reference_event_log`, no `deleted`; VERIFY does not scan R2; objects remain.
7. **No binding** — `skipped: no_r2_binding` when binding absent.
8. **PII** — Rule 13 inherited; existing queue/guest tests remain the gate.
9. **Purge spec + types** amended; four statuses mutually discoverable from both specs. Halted `stores_json` has in-scope stores `pending` (not `reached`); certified `stores_json` has no `pending`.

---

## 8. Error handling (summary)

| Failure | Behavior |
|---|---|
| R2 put fails for a source-group | `retry()` only that group’s messages; no project/MARK for them |
| Projection / `handleDomainEvent` fails after successful archive | `retry()` that message; re-archive may append another segment (nonce); replay dedupes |
| Org VERIFY lists residue under event-log prefix | HALT `verify_r2_residue`; halted certificate |
| Binding missing | Skip R2 with `no_r2_binding`; Iceberg still skipped |

---

## 9. Implementation sketch (non-normative)

| Area | Likely touch |
|---|---|
| Archive + reader | `apps/pms-core/src/event-log.ts` (keys, put, list/replay) |
| Consumer | `apps/pms-core/src/index.ts` — batch CHECK → group → archive → per-msg project/MARK |
| Env / wrangler | `env.ts`, `wrangler.jsonc` (`r2_buckets`) |
| Purge | `purge-workflow.ts`, `purge-certificate.ts`, purge tests |
| Specs | this file; amend [purge-workflow-design](./2026-08-12-purge-workflow-design.md) |
| Tests | log fidelity, lex≡seq, ARI convergence, R2 bulk delete smoke, org/guest certificate shapes |

---

## 10. Decisions locked (index)

| # | Decision |
|---|---|
| 1 | Worker writer; Pipelines deferred to §4.9; cite §4.7 two-row table + §4.8 step 4 |
| 2 | CHECK survivors → archive per source-group → project → MARK; retry failed group only |
| 3 | Key: `events/{do}/{id}/{seqStart:020}-{seqEnd:020}-{nonce}.ndjson`; no date; no deterministic overwrite |
| 4 | Accept unbounded prefix growth + paginated purge |
| 5 | Dedupe at replay (last-write-wins); log append-only |
| 6 | Log fidelity + ARI SoR-convergence; §11 divergence recorded |
| 7 | In-scope stores start `pending`; org R2 step → `reached` + delete; guest R2 step → `retained` (no `deleted`); unbound R2 → `skipped` from init |
| 8 | VERIFY: strong LIST; bulk-delete smoke; no preemptive lag limitation |
| 9 | No TTL; DLQ’d events still in log |
