# HospAI — Platform Architecture

**Scope:** A multi-tenant SaaS platform in the Cloudbeds class. PMS is the core product.
Capabilities inside the PMS switch on/off per customer package, and add-ons plug into the
PMS through the same event bus and entitlement plane.

**Platform:** Cloudflare (Workers, Durable Objects, D1, KV, R2, Queues, Workflows, Pipelines).
TypeScript end-to-end.

**Core stance:** Modules are the unit of packaging, gating, and deployment. Service Bindings
enforce boundaries at the platform level — microservice isolation at monolith speed.
Distribution is structural from day one on Cloudflare, but keep the Worker count small
(start with 4–5, grow to 10–14 only when load or team isolation demands it).

> **Revision 2026-07-27.** Platform limits (§3) and the jurisdiction/`locationHint` semantics
> (§4.5) verified against Cloudflare docs on this date.
>
> Changed since the first revision: per-organization storage moved from D1 to **OrgDO**
> (§4.3 — D1 bindings cannot be selected at runtime); PropertyDO transaction handling
> corrected (§4.1); kill-switch split out of the entitlement snapshot (§6.4); entitlement
> checks moved from `domain/` to `application/` (§5); Rule 9 split by transport (§15).
>
> Added: priority lanes (§4.2), jurisdiction vs. residency vs. request-path residency (§4.5),
> the degraded-mode protocol (§4.6), PII erasure and the cross-store purge Workflow (§4.8),
> time-boxed support elevation with dual control on writes (§4.9), ARI staleness SLA (§7.1),
> multi-currency and the payments↔folio contract (§7.3), multi-property projections (§7.6),
> regulatory scope (§7.7), the night-audit `BusinessDate` state machine (§8), and
> idempotency × outbox (§10.1).
>
> **Still owed:** FX rate sourcing and its refresh policy; the exception-queue operator UX;
> per-country fiscalization design for the launch market.

---

## 1. The three planes

The single most important structural decision. Most teams conflate these and end up with an
unmaintainable `if (customer.plan === 'pro')` mess scattered through the domain.

| Plane | Question it answers | Owner | Changes | Storage |
|---|---|---|---|---|
| **Entitlements** | *Has this tenant bought it?* | Billing / Revenue | On contract change | Platform D1, audited, billing-linked |
| **Permissions (RBAC/ABAC)** | *May this user do it?* | Security | On role change | OrgDO, per user+property |
| **Feature flags** | *Is this code path live?* | Engineering | Continuously, per deploy | KV, ephemeral |

A gated feature must pass **all three** independently:

```
tenant is entitled  AND  user is permitted  AND  release flag is on
```

Never let a release flag substitute for an entitlement, and never let an entitlement grant
permission. Three systems, three lifecycles, three audiences.

**Fourth signal, deliberately separate: the operational kill-switch.** It is not an
entitlement, it has a different latency requirement, and it must never be cached behind a
version key. See §6.4.

---

## 2. Tenancy model

```
Organization (billing entity, the customer)
 └── Property (hotel / hostel / vacation-rental group)   ← operational data lives here
      └── Unit / Room
Users ─ belong to Organization, hold roles scoped to (org | property | property-group)
```

**Isolation strategy — structural, not row-level:**

| Layer | Storage | Isolation |
|---|---|---|
| Property operational data | PropertyDO (SQLite, 1 per property) | Physically separate object — no cross-property query possible |
| Organization data | OrgDO (SQLite, 1 per org) | Physically separate object — no cross-org query possible |
| Platform control plane | Platform D1 (single, global) | Shared, small, read-heavy |

Both tenant-scoped tiers use the *same* addressing mechanism — `getByName(id)` on a Durable
Object namespace. One routing model, one migration model, one backup model. Tier is a
provisioning concern (jurisdiction, location hint), resolved by the **tenant-router** package.

**The inverted failure mode:** With RLS, a routing bug leaks a row. Here, a routing bug hands
over an entire tenant's database. The tenant→resource resolver must be **small, audited,
exhaustively tested, and changed rarely.** Treat it as the most security-critical code in the
system.

---

## 3. Compute topology

```
                    ┌─────────────────────────────────────────────┐
   Internet ───────▶│  edge Worker  (routes, authn, tenant         │
                    │  resolution, entitlement gate, kill-switch,  │
                    │  rate limit, idempotency)                    │
                    └────────────────┬────────────────────────────┘
                                     │ Service Bindings (RPC, same-machine)
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
         pms-core              payments              booking-engine
         (Worker)              (Worker)               (Worker)
              │
              │ DO stubs / D1 / KV / R2 / Queues / Workflows
              ▼
   ┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐ ┌──────────────┐
   │ PropertyDO       │ │ OrgDO         │ │ OrgEntitlementDO │ │ Platform D1  │
   │ (SQLite, 1/hotel)│ │ (SQLite,1/org)│ │ (1 per org)      │ │ (control)    │
   │ ARI, reservations│ │ users, roles, │ │ ★ authoritative  │ │ plans,       │
   │ folios, outbox   │ │ guest profiles│ │ hard-limit       │ │ features,    │
   │ business date    │ │ rate defs     │ │ counters; never  │ │ subscriptions│
   │                  │ │ audit log     │ │ served stale     │ │ routing map  │
   └──────────────────┘ └───────────────┘ └──────────────────┘ └──────────────┘
```

**OrgEntitlementDO is a distinct object from OrgDO on purpose.** It resolves entitlement
snapshots (§6.3) and owns `hard` meter counters (§6.6). Those counters are the one place in
the entitlement plane where a stale read is a commercial incident — selling a 6th OTA
connection on a 5-connection plan — so they are read through the DO, never through KV. Keeping
it separate from OrgDO also keeps a hot billing-write path off the object that serves every
permission check.

### Phased Worker deployment

| Phase | Workers | Why |
|---|---|---|
| MVP | `edge`, `pms-core`, `payments`, `booking-engine` | Minimum viable: PCI isolation, public traffic separation |
| Growth | + `channel-manager`, `workflows` | Channel sync has bursty load + slow third parties |
| Scale | + `revenue-management`, `guest-engagement` | Team/load isolation justifies the split |

**Constraint:** 500 Workers per account. Group small modules inside `pms-core` and keep the
in-process port pattern for them. Extract only when a named force demands it.

### Modules as WorkerEntrypoint RPC

```ts
// modules/pms/availability — public surface
import { WorkerEntrypoint } from 'cloudflare:workers';

export class AvailabilityService extends WorkerEntrypoint<Env> {
  async getARI(propertyId: string, range: DateRange): Promise<AvailabilitySnapshot> {
    const stub = this.env.PROPERTY_DO.getByName(propertyId);
    return stub.readARI(range);
  }
}
```

```ts
// modules/addons/channel-manager — consumes it as a typed binding
const ari = await this.env.AVAILABILITY.getARI(propertyId, range);
```

Service bindings enforce boundaries at the platform level — a Worker physically cannot reach
into another Worker's internals. Same-machine RPC means no network latency penalty.

### Extraction is only free if the contracts are RPC-shaped from day one

"In-process today, service-binding RPC when extracted, consumer code unchanged" is true
**only** if the in-process contract already obeys RPC serialization rules. Once a call crosses
a service binding:

- class instances lose their prototypes (unless they extend `RpcTarget`)
- shared mutable state disappears — the callee gets a copy
- thrown error types flatten; `instanceof` checks on the caller side stop working
- anything non-structured-cloneable fails at runtime, not compile time

Since the whole phased-Worker strategy in this section depends on extraction being cheap,
this is a **CI-enforced rule, not a convention**: every type crossing a module boundary must
be plain serializable data, declared in `packages/contracts`. Otherwise "extract when a named
force demands it" turns into "extract during an incident, discover it is a two-week refactor."

### Compute limits that bind

*Verified against Cloudflare docs 2026-07-26. Re-verify before relying on any of these.*

| Limit | Value (Paid) | Architectural consequence |
|---|---|---|
| Worker size | 10 MB gzipped | Forcing function for splitting fat Workers |
| Memory | 128 MB | No in-memory report building; stream or offload |
| CPU time | 5 min max (30 s default) | Fine for OLTP; PDFs/exports go to Containers or Workers AI |
| Subrequests | 10,000/request (up to 10M) | Generous; channel fan-out is fine |
| Simultaneous outgoing connections | 6 waiting for headers | Batch channel-manager fan-out through Queues |
| DO alarm wall time | 15 minutes | Night audit alarm starts a Workflow, never runs inline |
| Workflow step wall time | Unlimited (CPU-limited) | Correct home for night audit, reconciliation, dunning |
| Cron triggers | 250/account | Not enough for per-property scheduling — use DO alarms |
| D1 databases | 50,000/account | Platform D1 only — see §4.3 for why tenants are not D1 |
| D1 storage | 10 GB/db, 1 TB/account | The account cap binds long before the database count does |
| DO SQLite storage | 10 GB/object, unlimited objects | The reason tenant storage lives in DOs |

---

## 4. Storage topology

### 4.1 PropertyDO — SQLite, one per property — *the transactional system of record*

Durable Objects dissolve the hardest PMS problem — **availability concurrency** — structurally:

- **Globally unique + single-threaded.** One DO per property serializes all mutations. No races.
- **Input gates** block new events while storage operations execute — no interleaving.
- **Output gates** hold the response until writes are durable — clients never see phantom confirmations.
- **10GB SQLite per object** with point-in-time recovery.

Holds everything that must be consistent **within a property:**

- `availability_day` ledger (physical / blocked / sold / oversell allowance)
- restrictions ledger (MinLOS, MaxLOS, CTA, CTD, stop-sell)
- reservations and their state machine
- folios (append-only ledger) — **live stay folios only**
- room status / housekeeping state
- current business date + night-audit state
- transactional outbox

```ts
export class PropertyDO extends DurableObject<Env> {
  sql: SqlStorage;
  private scheduler: AlarmScheduler;   // packages/do-runtime — see §4.4

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.scheduler = new AlarmScheduler(ctx);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async book(cmd: BookCommand): Promise<Reservation> {
    const nights = enumerateNights(cmd.arrival, cmd.departure);

    // One query, not N. Returns the first night that cannot absorb the request.
    const shortfall = this.sql.exec(
      `SELECT stay_date FROM availability_day
         WHERE room_type_id = ?
           AND stay_date IN (${ph(nights)})
           AND physical - blocked - sold + oversell < ?
         LIMIT 1`,
      cmd.roomTypeId, ...nights, cmd.units,
    ).toArray();
    if (shortfall.length > 0) throw new NoAvailability(shortfall[0].stay_date);

    // NO `await` between the read above and the writes below. The runtime submits
    // this whole sequence atomically — reads followed by writes with no intervening
    // I/O behave transactionally. Explicit BEGIN/COMMIT is NOT permitted:
    // sql.exec() rejects transaction-control statements. Use ctx.storage
    // .transactionSync() only when you need an explicit rollback boundary, and
    // never blockConcurrencyWhile() on a request path (~200 req/s ceiling).
    this.sql.exec(
      `UPDATE availability_day SET sold = sold + ?
       WHERE room_type_id=? AND stay_date IN (${ph(nights)})`,
      cmd.units, cmd.roomTypeId, ...nights,
    );
    const res = this.insertReservation(cmd);
    this.appendOutbox(ReservationCreated.from(res));

    this.ctx.waitUntil(this.flushOutbox());
    return res;   // output gate holds this until the writes are durable
  }

  private async flushOutbox(): Promise<void> {
    // Queues caps a batch at 100 messages AND 1 MB total. Reservation payloads
    // make the byte ceiling bind first — bound by bytes, not row count.
    const candidates = this.sql.exec(
      `SELECT seq, payload FROM outbox WHERE acked = 0 ORDER BY seq LIMIT 100`,
    ).toArray();
    const batch = takeWhileUnderLimit(candidates, { maxMessages: 100, maxBytes: 1_000_000 });
    if (batch.length === 0) return;

    await this.env.EVENTS_QUEUE.sendBatch(batch.map(toMessage));

    // This ack lands in a NEW I/O gate. If the object is evicted between the send
    // and the ack, the next sweep re-delivers. Delivery is at-least-once by design;
    // consumers dedupe on event_id. `batch` is an ordered prefix of `candidates`,
    // so a range ack is exact.
    this.sql.exec(`UPDATE outbox SET acked = 1 WHERE seq <= ?`, batch.at(-1)!.seq);
  }

  async alarm() {
    await this.scheduler.run({
      'outbox':      () => this.flushOutbox(),
      'night-audit': () => this.env.NIGHT_AUDIT_WORKFLOW.create({ params: { propertyId: this.id } }),
    });
  }
}
```

**Sizing:** A 200-room property generating ~30k reservations/year with folio detail sits in
the low hundreds of MB/year. The 10GB ceiling is years away.

**Archival rule:** After a fiscal year closes and night-audit confirms, project closed folios
and checked-out reservations to R2/Iceberg. The PropertyDO holds only the current year + open
stays. This keeps the DO fast and the warehouse queryable.

### 4.2 Priority lanes — *the cost of single-threading*

Single-threading is what makes availability correct. It is also what makes a rate push able to
stall a check-in. A property under channel load takes ARI pulls, rate materialization, and OTA
bulk writes into the *same* object that the front desk is using. Without admission control the
front desk loses, and the front desk is the thing with a queue of humans in front of it.

**Durable Objects have no preemption.** Once a method starts executing it runs to its next
`await`. Lanes are therefore **cooperative and enforced at admission**, not by a scheduler.

| Lane | Contains | Admission rule |
|---|---|---|
| `INTERACTIVE` | book, check-in, check-out, folio post, room status, ARI read | Never deferred, never chunked, never rate-limited. Target < 50 ms of DO time. |
| `BACKGROUND` | outbox sweep, projection refresh, housekeeping recompute | Runs when no interactive command has arrived in `quietMs` (default 250 ms). Yields every chunk. |
| `BULK` | rate materialization, OTA bulk ARI, imports, archival | Continuation-token chunks, hard-capped at `maxChunkMs` (default 50 ms) of DO time per entry. Re-armed via `AlarmScheduler`, never looped. |

```ts
// packages/do-runtime — lane is declared on the method, not decided by the caller.
class PropertyDO extends DurableObject<Env> {
  @lane('INTERACTIVE')
  async book(cmd: BookCommand) { /* ... */ }

  @lane('BULK')
  async materializeRates(cursor: Cursor): Promise<Cursor | null> {
    const deadline = Date.now() + this.lanes.maxChunkMs;
    while (cursor && Date.now() < deadline) cursor = this.materializeOneDay(cursor);
    return cursor;   // non-null → LaneGuard re-arms via alarm, yielding the object
  }
}
```

`LaneGuard` tracks `lastInteractiveAt` in memory and refuses to admit a `BULK` entry inside
the quiet window, returning the unconsumed continuation token. Three rules make this hold:

1. **The lane is a property of the method, not the caller.** A channel manager cannot promote
   its bulk push by calling a different entrypoint.
2. **`BULK` methods must be resumable.** They take a cursor and return one. A `BULK` method
   that cannot yield is a bug, and CI rejects one whose signature has no cursor.
3. **Queue consumers writing to a property set `max_concurrency: 1`.** Lanes govern work
   *inside* the object; concurrency caps stop the stampede from forming outside it.

**Starvation is the accepted failure mode.** Under sustained interactive load, `BULK` work
falls further behind and that is correct — a rate push arriving late is a commercial
annoyance, a check-in arriving late is a queue in the lobby. `BULK` lag is an alerting signal
(§13), never a reason to preempt `INTERACTIVE`.

### 4.3 OrgDO — SQLite, one per organization

Holds: users, role assignments, guest profiles, rate plan *definitions*, property registry,
org settings, audit log. Read constantly, written rarely.

Addressed exactly like PropertyDO: `env.ORG_DO.getByName(orgId)`.

**Why not one D1 per organization.** This was the previous design and it does not work:

- **D1 bindings are static.** They are declared in `wrangler.jsonc` as
  `{binding, database_name, database_id}` and resolved at deploy time. There is no runtime API
  to obtain a D1 handle by name — no equivalent of `getByName`. A Worker therefore cannot
  reach "the D1 for org X" at all.
- The workaround is the **D1 REST API with an account-scoped token**, which puts a credential
  with access to *every* tenant database on the hot request path. That directly contradicts
  the threat model in §2, and it forfeits the Sessions API and bookmarks.
- **Account caps bind early.** 50,000 databases/account, but only **1 TB of D1 storage per
  account**. At ~200 MB/org that is ~5,000 organizations for the entire platform.

DO SQLite has none of these problems: dynamic addressing by name, 10 GB per object, no
documented cap on object count, and PITR per object.

**What is given up, and the mitigation.** D1 offers read replication via the Sessions API;
a DO is one instance in one place. Org data is read-heavy, so:

- hot, cacheable reads (permissions, property registry, org settings) are projected to KV,
  version-keyed exactly like entitlement snapshots (§6.3)
- OrgDO keeps an in-memory read cache, valid for the lifetime of the instance
- anything needing a genuine cross-org scan goes to the Iceberg warehouse, never to OrgDO

**Platform D1 (single, global) stays on D1** — it is one small shared database, read-heavy,
with no per-tenant addressing problem: organizations, plans, features, add-ons, subscriptions,
entitlement overrides, tenant→resource routing map.

### 4.4 The single alarm slot

A Durable Object has **exactly one alarm**. PropertyDO needs at least two schedules on it —
a ~30 s outbox sweep and a nightly business-date rollover — and add-ons will want more.

Multiplexing these with ad-hoc arithmetic in each DO is a reliable source of bugs (a busy
outbox silently starving the night audit, a failed handler retrying the whole alarm and
re-firing unrelated work). `packages/do-runtime` provides an **`AlarmScheduler`**: named
schedules, persisted next-run times, per-schedule failure isolation, and one computed
`setAlarm()`. No DO calls `ctx.storage.setAlarm()` directly.

### 4.5 Placement, jurisdiction, and residency — *three different things*

These get conflated, and an EU enterprise deal is exactly where that becomes expensive.
Cloudflare exposes them as **two unrelated mechanisms with opposite guarantees**:

| Concern | Mechanism | Guarantee | Set at |
|---|---|---|---|
| **Latency** — put the object near the hotel | `get(id, { locationHint: 'oc' })` | **Best-effort. No guarantee.** Docs are explicit: the object is placed to minimize latency *from* the hint, not necessarily *at* it. Honoured only on the first `get()`. | First instantiation |
| **Residency** — data must not leave a region | `env.PROPERTY_DO.jurisdiction('eu')` | **Hard constraint.** Compute and storage stay in-region. `eu`, `us`, `fedramp`. | Namespace, before ID derivation |

**Never answer a residency question with a location hint.** A `locationHint` in a DPA is a
misrepresentation — it is advisory and Cloudflare documents it as such.

**The correctness trap.** A jurisdiction is part of the *identity*, not a routing option:

```ts
env.PROPERTY_DO.idFromName('prop_123')                      // ID  A
env.PROPERTY_DO.jurisdiction('eu').idFromName('prop_123')   // ID  B  — different object!
```

Same name, different object, and the non-jurisdictional one is **empty**. A property
provisioned under `eu` that is later resolved without the subnamespace does not error — it
silently opens a blank PropertyDO with no reservations and no folios. That is the §2
routing-bug failure mode with a friendlier disguise.

**Rules for `tenant-router`:**

1. Jurisdiction is stored on the tenant registry row at provisioning and is **immutable**.
   Changing it is a full object migration, priced and scheduled as one.
2. Every resolution derives the ID through the recorded jurisdiction — including alarms,
   Queue consumers, Workflows, migration sweepers, and the CS read path. There is exactly one
   function that does this and nothing else may call `idFromName`, enforced by lint.
3. `locationHint` is derived independently, from the property's own timezone, and only ever
   affects latency.
4. **Self-check:** each DO asserts `ctx.id.jurisdiction` matches the jurisdiction recorded for
   its tenant on every cold start, and refuses to serve on mismatch. Failing closed on a
   blank object is vastly better than serving it.

**A jurisdictioned DO does not give you a jurisdictioned request path.** The docs are explicit:
Workers may access a jurisdiction-restricted Durable Object *from anywhere in the world*, and
the constraint governs only where the object runs and persists data. So:

| What the contract constrains | What actually delivers it |
|---|---|
| Where data is **stored** | `jurisdiction('eu')` on the DO namespace |
| Where the **Worker executes** | Smart Placement / edge placement controls — the edge Worker still runs at the nearest PoP by default |
| Which regions **terminate TLS and respond** | [Regional Services](https://developers.cloudflare.com/data-localization/regional-services/) |
| Where **logs and traces** land | Observability pipeline configuration — and note that a `DurableObjectId` is logged outside the jurisdiction for billing and debugging |

An EU data-residency commitment that only sets the DO jurisdiction is **incomplete**. Treat the
four rows above as a checklist per regulated deal, and price Regional Services into the
Enterprise tier rather than discovering it during a DPA review.

### 4.6 Degraded mode — the protocol

A PropertyDO outage is a **total front-desk outage**: no check-in, no check-out, no folio
posting for that hotel. Hotels treat the PMS as life-support software and enterprise contracts
carry SLA language about it. The booking engine survives on the ARI projection, so revenue is
protected; the operator SPA needs the following.

**The rule that decides every case:** *degraded mode may never create an obligation the
property cannot honour.*

#### Command classes

Every command in every module declares exactly one class in its manifest. Unclassified
commands fail closed — an omission cannot silently become a queued write.

| Class | Meaning | Commands |
|---|---|---|
| `READ_STALE` | Serve last projection, watermark the age | Arrivals/departures, in-house list, room status, rate display, guest lookup |
| `QUEUE_PROVISIONAL` | Accept, durably queue, apply on recovery | Check-in, check-out, room-status change, housekeeping updates, non-payment folio postings, notes |
| `FAIL_CLOSED` | Refuse with an explicit reason | New bookings, date/room-type changes, cancellations with penalty, **any payment authorization or capture**, night audit, rate/restriction edits |

**The `QUEUE_PROVISIONAL` admission test is not "is it important" — it is
"is it commutative or idempotent with respect to every other queued command?"** Check-ins for
different reservations commute. Folio postings are append-only and sum-commutative. Room status
is last-writer-wins on a single key. Anything that reads-then-decides on shared state — which
is every inventory-consuming command — is `FAIL_CLOSED` by construction.

This is what lets the protocol ignore ordering, which matters because **Queues do not
guarantee it.** Correctness must not depend on replay order, and it does not.

#### Where the queue lives

Two tiers, in order of preference:

1. **Edge-side (primary).** The PropertyDO is unreachable but the edge Worker is fine — the
   common case. The edge writes the command to a per-property pending-commands Queue.
   Durable, survives the browser closing, survives the operator going home.
2. **Client-side (fallback).** The client cannot reach the edge at all. Buffer in IndexedDB,
   flush on reconnect. Explicitly weaker: a closed laptop loses the buffer, and the SPA must
   say so rather than implying durability it does not have.

A client-side buffered command is replayed *through* tier 1, so both paths converge on one
replay implementation.

#### Command envelope

```ts
type ProvisionalCommand = {
  idempotencyKey: string;      // client-generated, stable across retries
  propertyId: string;
  issuedAt: string;            // ISO instant — the ONLY authority for business-date attribution
  businessDate: StayDate;      // the business date the operator believed was open
  actor: { userId: string; roleAt: string };
  command: { type: string; payload: Json };
};
```

`issuedAt` is captured when the operator acted, never when the command replayed. A check-in
performed at 23:58 that replays at 00:04 belongs to the **previous** business date. Using
replay time here silently corrupts occupancy statistics and room-revenue postings.

#### Replay rules

On recovery, a Queue consumer (`max_concurrency: 1` per property, per §4.2) drains the pending
queue **in the `BACKGROUND` lane** — replay must not itself starve the front desk that just
came back online.

1. **Dedupe first.** `idempotencyKey` hits the same store as live idempotency (§10.1). An
   already-applied command is acknowledged, not re-applied.
2. **Business-date guard.** If `cmd.businessDate` is already closed by night audit, the command
   does **not** apply. It goes to the **exception queue** for a human. Silently posting into a
   closed fiscal period is worse than the outage was.
3. **Re-validate invariants.** Provisional acceptance was never a promise of success. A
   check-in whose room was reassigned during the outage fails validation and lands in the
   exception queue.
4. **Emit real domain events**, stamped with `issuedAt` and `replayed_at`, so downstream
   consumers and the audit log show both when it happened and when it landed.
5. **Nothing auto-resolves into money.** Any replay failure touching a folio is an exception,
   never a best-effort guess.

The exception queue is a **first-class operator screen**, not a dead-letter table someone finds
later. Its depth is a paged alert.

#### SPA watermarks

The shell (§9) owns three states, and the operator must never have to guess which one they are
in:

| State | Presentation | Interaction |
|---|---|---|
| `LIVE` | Normal | Everything enabled |
| `DEGRADED` | Persistent banner: *"Offline — showing data from HH:MM. Changes will be applied when the connection returns."* Every stale figure carries an inline age chip. | `FAIL_CLOSED` commands visibly disabled with the reason. `QUEUE_PROVISIONAL` actions marked *Pending* with a count. |
| `RECOVERING` | *"Reconnected — applying N pending changes."* | Read-only until the queue drains, then diff-highlight anything the replay changed |

Two hard UI rules:

- **Never show a provisional write as confirmed.** A queued check-in is *Pending*, in a
  visually distinct state, until its domain event returns.
- **Never print a folio or issue an invoice in `DEGRADED`.** It is a document the property
  cannot honour, which is the top-level rule restated.

**Degraded mode is tested, not hoped for.** CI runs a fault-injection suite that blackholes the
PropertyDO mid-session and asserts: no oversell, no double-posted folio line, no command lost,
every unresolvable command in the exception queue.

### 4.7 KV, R2, and the analytics tier

| Store | Use | Why |
|---|---|---|
| **KV** | Entitlement snapshots (version-keyed), org read projections, JWKS, ARI cache, static config | Read-optimized, globally distributed |
| **R2** | Invoices, exports, ID documents, property images, **durable event log** | Zero egress; replay source |
| **Pipelines → R2 Data Catalog (Iceberg)** | Warehouse — every domain event, queryable by R2 SQL / DuckDB | Replaces Debezium→BigQuery |
| **Analytics Engine** | Soft meters, per-tenant usage telemetry | Write-heavy, tenant-tagged time series |
| **Hyperdrive → external Postgres** | **Escape hatch only** — enterprise contracts demanding own DB | Never load-bearing for core PMS |

### 4.8 PII, the immutable log, and right-to-erasure

"Every mutation is an event," events are retained durably in R2/Iceberg for replay, and the
folio is an append-only ledger. Guests have an unconditional right to erasure. These collide,
and the collision is **not retrofittable** — rewriting history in an immutable log after the
fact is the single most expensive mistake available here.

**Rule: domain events carry no raw guest PII.** They carry a `guest_ref` plus a
`pii_key_id`. Guest PII lives in OrgDO, encrypted under a per-guest data key.

**Erasure = crypto-shredding.** Destroy the per-guest key. Every event, export, warehouse row,
and archived folio referencing it becomes permanently undecodable, with no rewrite of any
immutable store.

**What survives erasure, deliberately:** financial records required by tax and fiscalization
law (§7.7), retained as pseudonymized ledger entries with the legal basis recorded. Erasure
policy is a `packages/contracts` concern and a Phase 0 decision, not a Phase 3 compliance task.

#### Purge is a Workflow, because the data is in five places

Both triggers — a module's `onPurge` after its retention window (§5) and a guest erasure
request — must reach **PropertyDO, OrgDO, R2, the Iceberg warehouse, and the key store**.
Four of those five cannot participate in a shared transaction, and R2/Iceberg deletion is
slow and partial-failure-prone. A single RPC cannot do this correctly; it is a durable
Workflow with per-store steps.

**Key destruction goes first.** This inverts the intuitive ordering and it is the whole point:

```
1. SHRED_KEYS        destroy per-guest / per-module data keys      ← erasure is effective HERE
2. PURGE_PROPERTY_DO delete rows, per property, BULK lane, chunked
3. PURGE_ORG_DO      delete rows in the owning OrgDO
4. PURGE_R2          delete objects by prefix (documents, exports, event-log segments)
5. PURGE_ICEBERG     row-level delete / partition rewrite in the catalog
6. VERIFY            re-scan every store; any residue → HALTED, never silent success
7. CERTIFY           append a purge certificate (subject, scope, timestamps, operator)
```

After step 1 the data is **already unrecoverable everywhere**, including in stores the Workflow
has not reached yet and in backups, PITR windows, and R2 lifecycle-pending objects that a
delete-first design could never catch. Steps 2–5 reclaim space and satisfy "the row is gone"
audits; they are housekeeping, not the guarantee.

**Properties this design has to have:**

- **Every step is idempotent and resumable.** Deleting an already-deleted object is success.
- **`VERIFY` is mandatory and can fail the run.** A purge that reports success without
  re-scanning is the compliance equivalent of an untested backup.
- **The certificate is the deliverable.** Regulators and enterprise DPAs ask for evidence, not
  assurances. It is append-only and itself never purged.
- **Retention windows are enforced by the Workflow, not the caller.** `onPurge` cannot run
  early even if a module requests it; the window is checked in step 0 against Platform D1.
- **Financial-record exemptions are applied per record class** (§7.7), not per subject. A purge
  that erases a fiscally-required invoice is as much a violation as one that misses a guest
  profile.

### 4.9 Admin & support access

Cross-tenant queries are impossible against DOs directly. Two paths:

1. **Iceberg warehouse** — for fleet analytics, cohort reports, ops dashboards (seconds-old).
   No tenant PII, no elevation required.
2. **Privileged direct DO path** — for CS resolving a specific tenant's issue in real time.

The second path is a standing cross-tenant capability held by employees. It is the most likely
source of an insider incident and the first thing an enterprise security review asks about, so
it gets specified rather than left as "audited and behind Access."

**Nobody holds tenant access at rest.** Support staff have *the ability to request* access, not
access. Every session is an explicit, expiring grant.

```ts
type ElevationGrant = {
  grantId: string;
  subject: { orgId: string; propertyId?: string };   // narrowest scope that resolves the case
  mode: 'READ' | 'WRITE';
  reason: string;              // free text, required
  ticketRef: string;           // required, validated against the helpdesk system
  requestedBy: string;
  approvedBy?: string;         // REQUIRED for WRITE — never equal to requestedBy
  expiresAt: string;           // READ ≤ 60 min, WRITE ≤ 15 min. No renewal — re-request.
};
```

| Control | `READ` | `WRITE` |
|---|---|---|
| Approval | Self-service with reason + ticket | **Dual control** — a second authorized human approves, and the approver may not be the requester |
| Max duration | 60 minutes | 15 minutes |
| Scope | One org, narrowed to one property where possible | One property, one named operation |
| Mechanism | Read-only RPC surface; no raw SQL | **The same domain commands a customer would use** — never raw SQL, never direct row edits |
| Expiry | Hard. No renewal — request again, with a fresh reason. | Hard |

**Rules that make this hold:**

1. **Writes go through the domain.** A support write emits the same events, writes the same
   audit records, and respects the same invariants as a customer action. Raw SQL against a
   tenant DO has exactly one legitimate use — recovering a corrupted object — and it is a
   separate break-glass credential that **automatically opens an incident record**.
2. **The tenant sees it.** Support access appears in the customer's own audit log with the
   actor, timestamp, scope, and ticket reference. This is a trust feature, not a liability;
   enterprise buyers increasingly require it, and the alternative is a support team the
   customer cannot audit.
3. **Elevation is not an entitlement.** It is internal RBAC, stored in Platform D1, on its own
   lifecycle. It is never resolved from the tenant's entitlement snapshot.
4. **Global revocation exists.** The kill-switch (§6.4) can void every outstanding grant
   platform-wide in one write, for the incident where credentials are suspected compromised.
5. **Elevations are a reviewed metric.** Grant volume per operator, `WRITE` grants without a
   linked ticket resolution, and repeat elevations against the same tenant go to a weekly
   review. An access-control system nobody reads is theatre.
6. **The admin console is a separate Worker** behind Cloudflare Access with hardware-key
   enforcement, bound to nothing a customer-facing Worker can reach.

---

## 5. Module anatomy

Every module — core, PMS, or add-on — has the identical shape:

```
modules/pms/reservations/
├── module.manifest.ts        # declarative contract
├── src/
│   ├── domain/               # entities, value objects, invariants. Zero I/O, zero platform imports.
│   ├── application/          # use cases (commands/queries), ports, ENTITLEMENT CHECKS
│   ├── infrastructure/       # repositories, adapters implementing ports (DO/D1/KV calls here)
│   ├── api/                  # RPC entrypoints, DTOs
│   ├── events/               # published/ + subscribed/
│   ├── jobs/                 # Queue consumers, Workflow steps
│   ├── ui/                   # frontend surfaces this module contributes
│   └── index.ts              # ← THE ONLY EXPORT SURFACE
├── migrations/               # namespaced (e.g. res_reservation, res_assignment)
└── tests/
```

**Terminology, because this bites.** "Domain" in this document means the `domain/` folder:
pure business rules, no I/O, no platform imports, no commercial concepts. When §6 talks about
enforcing entitlements "deep in the stack," that means **`application/`** — the use-case layer
— and code running inside a DO, alarm, Queue consumer, or Workflow. It never means `domain/`.
An aggregate invariant and a billing gate are different things and do not share a layer.

### The module manifest

```ts
export default defineModule({
  id: 'addons.channel-manager',
  version: '3.2.0',

  entitlement: 'channel_manager.enabled',

  requires: ['pms.availability', 'pms.rates', 'pms.reservations'],

  schema: { prefix: 'cm_', migrations: './migrations' },

  publishes: ['channel.mapping.created', 'channel.rate.pushed', 'channel.sync.failed'],
  subscribes: [
    { event: 'availability.changed', handler: 'PushAvailabilityHandler' },
    { event: 'reservation.created',  handler: 'NotifyChannelHandler' },
  ],

  permissions: ['channel:read', 'channel:configure', 'channel:sync'],

  meters: ['channel.connections.active', 'channel.messages.monthly'],

  ui: {
    nav: [{ id: 'channels', label: 'Channel Manager', icon: 'share', order: 40 }],
    routes: [{ path: '/channels/*', component: () => import('./ui/ChannelsApp') }],
    settingsPanels: ['channel-defaults', 'channel-mappings'],
    dashboardWidgets: ['sync-health'],
  },

  lifecycle: {
    onActivate:   ActivateChannelManager,
    onDeactivate: DeactivateChannelManager,   // RETAIN all data
    onPurge:      PurgeChannelData,           // only after retention window
  },
});
```

**`onDeactivate` must be lossless.** A tenant who downgrades and re-upgrades gets their data
back. Deletion happens only via `onPurge`, driven by retention policy.

### How modules talk

**Synchronous — port/adapter against the public interface.** In-process today, service-binding
RPC when extracted — subject to the serializable-contract rule in §3.

**Asynchronous — domain events via transactional outbox.** Every mutation writes to the outbox
in the same atomic write as the domain mutation. The DO alarm sweeper delivers to Queues.
Consumers are idempotent by `event_id`.

Event payloads are **versioned contracts in `packages/contracts`**. Adding a field is safe;
removing or retyping requires a new version in parallel until consumers migrate. Payloads
carry references to PII, never PII itself (§4.8).

---

## 6. The entitlement plane

### 6.1 Data model (Platform D1)

```
feature            (key, name, type: BOOLEAN|LIMIT|CONFIG, module_id)
plan               (code, name, tier, base_price, billing_interval)
plan_feature       (plan_id, feature_key, value)
addon              (code, name, price, billing_model)
addon_feature      (addon_id, feature_key, value)
subscription       (org_id, plan_code, status, trial_ends_at, current_period_end)
subscription_addon (subscription_id, addon_code, quantity, status)
entitlement_override (org_id, feature_key, value, reason, granted_by, expires_at)
usage_counter      (org_id, meter_key, period, value)
```

Features are **keys, not columns.** Adding a gated capability is a data change + a module,
never a schema migration.

### 6.2 Resolution

```
1. Plan features                  (base grant)
2. + Add-on features              (union; for LIMIT type take MAX)
3. + Trial grants                 (time-boxed, auto-expire)
4. + Tenant overrides             (sales concessions — always audited)
5. − Delinquency policy           (past-due → read-only, not blackout)
```

```ts
type EntitlementSnapshot = {
  orgId: string;
  version: number;
  features: Record<FeatureKey, boolean | number | Json>;
  limits: Record<MeterKey, { limit: number; used: number; behavior: 'soft'|'hard'|'grace' }>;
  computedAt: string;
};
```

### 6.3 Distribution — version-keyed KV

```ts
const key = `ent:${orgId}:v${version}`;          // version from the signed session token
let snap = await env.KV.get<EntitlementSnapshot>(key, 'json');
if (!snap) {
  snap = await env.ORG_ENTITLEMENT_DO.getByName(orgId).resolveEntitlements();
  await env.KV.put(key, JSON.stringify(snap), { expirationTtl: 3600 });
}
```

Version in the key eliminates KV's eventual consistency hazard. A plan upgrade bumps the
version → new key → cache miss → instant resolution from the authoritative DO.

**Know the revocation latency this buys.** The version comes from the signed session token, so
a *reduction* in entitlement does not take effect until the token is re-minted. Upgrades land
immediately (§9 pushes `entitlement.changed` over WebSocket and the client refreshes).
Downgrades and delinquency transitions are stale for up to the token TTL — acceptable, because
they are commercial states, not safety states. Keep the token TTL short enough that the
finance team accepts the window, and enforce `hard` limits at the OrgEntitlementDO counter,
which is never stale.

### 6.4 The kill-switch is not an entitlement

An operational kill-switch that takes a token refresh to land is not a kill-switch. It is
therefore **not** part of the resolution chain above and **not** in the versioned snapshot.

```ts
// edge Worker, before entitlement resolution
const killed = await env.KV.get(`kill:${featureKey}`, { cacheTtl: 10 });
if (killed) return new Response(null, { status: 503 });
```

Separate key space, low TTL, no version, checked at the edge on every request. Different
lifecycle, different audience, different latency requirement — same argument as §1.

### 6.5 Enforcement — four layers

```ts
// 1. Edge Worker — route table carries required entitlement; 402 before any module runs.

// 2. Module RPC — every entrypoint method re-checks.
class ChannelService extends WorkerEntrypoint<Env> {
  async createMapping(ctx: Ctx, cmd: CreateMapping) {
    ctx.entitlements.require('channel_manager.enabled');
    // ...
  }
}

// 3. Application layer — inside DOs, alarms, Queue consumers, Workflows.
//    NOT domain/ — see the terminology note in §5.

// 4. UI — UX only. Entitled-but-unbought → disabled with upgrade CTA. Irrelevant → hidden.
```

### 6.6 Limits and metering

| Behavior | Use case | Enforcement |
|---|---|---|
| `hard` | OTA connections, users | OrgEntitlementDO counter — reject at limit |
| `soft` | Emails, API calls | Analytics Engine → billing rollup |
| `grace` | Unit count after expansion | Allow overage + notify; never block a booking |

### 6.7 Package composition example

| Feature key | Starter | Growth | Enterprise | Add-on |
|---|---|---|---|---|
| `pms.core` | ✅ | ✅ | ✅ | — |
| `pms.units.limit` | 20 | 100 | ∞ | — |
| `pms.housekeeping` | — | ✅ | ✅ | ✅ |
| `pms.multi_property` | — | — | ✅ | — |
| `channel_manager.enabled` | — | ✅ | ✅ | ✅ |
| `channel_manager.connections.limit` | — | 5 | ∞ | +1 each |
| `revenue_mgmt.enabled` | — | — | ✅ | ✅ |
| `booking_engine.enabled` | ✅ | ✅ | ✅ | — |
| `booking_engine.custom_domain` | — | ✅ | ✅ | ✅ |
| `pos.enabled` | — | — | — | ✅ |
| `api.public_access` | — | ✅ | ✅ | — |
| `sso.saml` | — | — | ✅ | ✅ |
| `compliance.fiscalization` | — | — | ✅ | ✅ |

---

## 7. PMS domain — the parts that are genuinely hard

### 7.1 Availability (ARI) and oversell control

The highest-contention resource. PropertyDO serialization eliminates races structurally.

Rules:
- Availability decrements in the **same atomic write** as the reservation.
- **Room-type level, not room level.** Assignment happens at check-in.
- A separate denormalized **ARI projection** (KV) serves the booking engine and channel pushes.
  Stale reads there are fine; the DO is the arbiter.

**ARI staleness is a contract, not a hope.** "Stale reads are fine" is only true with a stated
bound, an invalidation path, and a defined behaviour when the projection and the DO disagree.

| Property | Value | Consequence of breach |
|---|---|---|
| Projection lag (p99) | ≤ 5 s from `availability.changed` | Page ops; oversell risk rises with lag |
| Hard TTL on a projection entry | 60 s | Past this the entry is *unusable*, not merely stale |
| Booking-engine quote | Refuses to quote on an entry past hard TTL | Falls back to a live DO read; slower, still correct |
| OTA push freshness | ≤ 2 min | OTA contracts specify this; breach is a partner-facing SLA event |

**Invalidation is push, not expiry.** Every availability mutation emits `availability.changed`
carrying `(property, room_type, dates, version)`. The projection writer applies it and stamps
the entry with the DO's version. Expiry is the backstop for a missed event, never the
mechanism.

**Reject-on-commit.** The projection is advisory. Every booking commits against the PropertyDO,
which re-checks and may reject with `NoAvailability` even though the projection showed
inventory. This is a **normal, expected outcome**, not an error path:

- the booking engine handles it as a first-class UX state ("just sold out — here are
  alternatives"), never a 500
- the channel manager translates it to the OTA's own rejection semantics
- a rejection increments `ari.reject_on_commit`, tagged by property. A rising rate means the
  projection is lagging, and it is the earliest available signal of that

**Versioned entries make disagreement detectable.** Because each projection entry carries the
DO version it was derived from, a rejection can be classified as *stale projection* (version
behind) versus *genuine race* (version current, inventory sold in the interim). Only the first
is a defect.

### 7.2 Rates

Rate plans compose: `base rate → derived (−15% of BAR) → seasonal override → LOS discount → promo`.
Model the **derivation graph**, not the materialized matrix.

Restrictions (MinLOS, MaxLOS, CTA, CTD, stop-sell) are a **separate ledger** from prices.

Rate plan *definitions* live in OrgDO (cross-property, rarely written). Materialized daily
rates live in PropertyDO (per-property, frequently read). The projection from definition →
materialized rates is triggered by `rate_plan.changed` events and runs as a Workflow step —
**chunked and yielding**, per the BULK lane rule in §4.2. A chain-wide rate change must never
be able to stall check-ins.

### 7.3 Money, folio, and the night audit

- **Never floats.** Integer minor units + explicit currency. `packages/money` owns rounding.
- The folio is an **append-only ledger.** Corrections are reversing entries, not updates.
- **Multi-currency is Phase 1, not later.** Any property taking an international card hits it
  in week one, and retrofitting a currency onto a single-amount ledger touches every posting,
  report, and tax calculation ever written. See below.
- **Night audit** is a per-property Workflow (DO alarm triggers it). Idempotent, resumable.
- **Tax engine** is its own concern behind an interface. Rules are political and change without notice.
- **Folio archival:** live stay + current fiscal year in PropertyDO. Closed years projected to
  R2/Iceberg for reporting and long-term retrieval.
- **Cashiering:** shift open/close, drawer counts, per-cashier audit. Required before any
  property takes cash — which is Phase 1, not later.
- **City ledger / AR:** direct-bill corporate accounts, aging, statements, commission tracking.
  Structurally distinct from guest folios; do not model it as a folio variant.

#### Multi-currency

Three currencies coexist and must never be collapsed into one column:

| Currency | Meaning | Where it is authoritative |
|---|---|---|
| **Transaction** | What the line was actually denominated in | The folio line |
| **Property (ledger)** | What the property's books are kept in | The folio balance, night audit, local tax |
| **Reporting** | What the chain consolidates in | Warehouse only — never stored in the DO |

```sql
CREATE TABLE folio_line (
  -- ...
  amount_minor            INTEGER NOT NULL,   -- in txn_currency
  txn_currency            TEXT    NOT NULL,
  ledger_amount_minor     INTEGER NOT NULL,   -- in property currency
  fx_rate                 TEXT    NOT NULL,   -- decimal string, never a float
  fx_rate_at              INTEGER NOT NULL    -- frozen at posting; NEVER recomputed
);
```

**The rate is frozen at posting time and is part of the record.** Re-deriving a historical rate
at read time makes yesterday's invoice change value overnight — which fails audit, fails
fiscalization, and generates guest disputes that cannot be resolved from the data.

Settlement in a currency other than the ledger currency produces a **residual FX gain/loss
line** of its own type. It is never absorbed into the guest's charge, because then the folio
would not foot.

#### Payments ↔ folio is an event contract, not a shared write

The `payments` Worker is PCI-isolated (§13), which means it **cannot** write folio rows and the
folio **cannot** call the gateway. The seam between them is the event bus, and it needs
specifying in Phase 1 because everything about check-out depends on it.

| Event | Emitted by | Folio effect |
|---|---|---|
| `payment.authorized` | payments | Record hold. **No ledger entry** — an auth is not money. |
| `payment.captured` | payments | Post payment line, ledger + txn currency |
| `payment.refunded` | payments | Post reversing line, never mutate the original |
| `payment.failed` | payments | Release hold, flag balance at risk |
| `payment.chargeback_received` | payments | Post reversal + fee line, open a dispute record |
| `folio.balance_due` | folio | Payments may auto-capture at check-out |

Three rules that fall out of at-least-once delivery (§10.1):

1. **Idempotent by `(event_id, gateway_reference)`.** A redelivered capture must not post twice.
2. **Tolerate out-of-order arrival.** A capture can land before its authorization. The folio
   reconstructs from whichever arrives first and back-fills; it must never require an auth row
   to exist before accepting a capture.
3. **Money moves on the gateway's word, not the folio's.** The folio records what the gateway
   reports. It never authorizes a capture from a balance it read locally, because that read may
   be stale — and in degraded mode (§4.6) payment commands are `FAIL_CLOSED` for this reason.

**Nightly settlement reconciliation** compares the gateway settlement file against folio payment
lines. Mismatches go to the exception queue, never to an auto-correction.

### 7.4 Reservation lifecycle

```
INQUIRY → PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT
                 ↘ CANCELLED   ↘ NO_SHOW
```

Every transition emits a domain event and writes an audit record. Reservations are long-lived,
high-value, and constantly disputed.

**Group blocks and allotments** are a separate aggregate, not a reservation with a flag: block
inventory, rooming lists, cutoff dates, wash, and pickup tracking. Bolting this onto individual
reservations later is a rewrite — model it as its own thing from the start even if it ships in
Phase 2.

### 7.5 Time

Hospitality time ≠ wall-clock time. First-class types in `packages/temporal-utils`:
- `StayDate` — calendar date in property timezone, not an instant
- `BusinessDate` — what the night audit rolls
- `Nights` — half-open date range

A `Date` object crossing a module boundary is a bug waiting for a DST transition.

### 7.6 Multi-property — *the thing we charge most for is what the model most resists*

`pms.multi_property` is an Enterprise feature, and §2 states plainly that cross-property
queries are impossible by construction. That tension is real and needs an explicit design
rather than discovery during an Enterprise deal.

| Need | Mechanism |
|---|---|
| Group availability search ("any room in the group") | **GroupAvailabilityDO** — a projection fed by `availability.changed`, per property-group. Advisory only; the PropertyDO still arbitrates the booking. |
| Central reservations (book into any property) | Two-phase: read the projection, then commit against the owning PropertyDO. Handle rejection — the projection is stale by design. |
| Chain-level reporting | Iceberg warehouse. Never fan-out reads across PropertyDOs. |
| Shared guest profile across properties | Already correct — profiles live in OrgDO. |
| Cross-property rate/restriction push | Chunked Workflow fan-out in the `BULK` lane (§4.2). |

Fan-out reads across N PropertyDOs are acceptable only for small N and only behind a Workflow.
They are never on an interactive request path.

### 7.7 Regulatory — the hidden second product

None of this changes the architecture — each is an add-on module gated on
`compliance.*` entitlements, exactly as designed. It does change the roadmap, and it is
absent from most PMS build plans until a deal depends on it.

| Obligation | Where | Note |
|---|---|---|
| **Fiscalization / e-invoicing** | IT, PT, ES (TicketBAI/Verifactu), GR (myDATA), PL, DE (KassenSichV) | Certified, audited, per-country. Effectively a second product. |
| **Guest registration reporting** | ES (SES Hospedajes), IT (Alloggiati), PT (SEF) | Legally mandatory, per-country, per-property credentials. |
| **Tourist/city tax** | Most EU municipalities | Rules vary *below* national level. Belongs to the tax engine interface (§7.3). |

Sequencing consequence: **EU market entry requires at least one fiscalization implementation.**
Pick the launch country before Phase 1 ends, because it constrains the folio and tax model.

---

## 8. Events, scheduling, and workflows

### Night audit: DO alarm → Workflow

Each PropertyDO registers a `night-audit` schedule with its `AlarmScheduler` (§4.4) for its
next business-date rollover. The handler starts a Workflow and returns immediately — the
15-minute alarm wall time is never the constraint.

The Workflow does the real work — post room charges, no-show processing, roll business date,
close-out reports — with durable execution and resumability.

### The BusinessDate state machine

Night audit is the one process that both **mutates money** and **is guaranteed to be retried**
(Workflow steps retry on any transient failure). Resumability without a state machine means
double-posted room charges, which is a refund, an apology, and in a fiscalized market a
correction filing.

```
IDLE ──▶ PRE_CHECK ──▶ POST_ROOM_CHARGES ──▶ PROCESS_NO_SHOWS ──▶ CLOSE_CASHIER_SHIFTS
                                                                        │
       ┌────────────────────────────────────────────────────────────────┘
       ▼
  SNAPSHOT_REPORTS ──▶ ROLL_BUSINESS_DATE ──▶ ARCHIVE ──▶ IDLE
       │
       └─▶ HALTED  (any step fails after its retry budget — operator intervention)
```

State lives in the PropertyDO, not the Workflow:

```sql
CREATE TABLE night_audit_run (
  business_date TEXT NOT NULL,
  step          TEXT NOT NULL,
  status        TEXT NOT NULL,      -- PENDING | RUNNING | COMPLETED | FAILED
  attempt       INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER, completed_at INTEGER, error TEXT,
  PRIMARY KEY (business_date, step)
);
```

Each Workflow step calls `propertyDO.runAuditStep(businessDate, step)`, which **returns
immediately if that row is already `COMPLETED`**. Workflow retries are therefore free: the
Workflow provides durability and backoff, the DO provides the idempotence.

**Double-posting is prevented at the storage layer, not in logic.** Step-level guards are
necessary but not sufficient — a partial commit inside a step could still re-post. The actual
guarantee:

```sql
CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT';
```

A second room charge for the same reservation on the same business date **cannot be inserted**,
whatever the control flow does. Every automated posting carries the business date in its
uniqueness key. This is the invariant to defend; the state machine is an optimization over it.

**Rules:**

1. **`ROLL_BUSINESS_DATE` is last but one**, and advances the date exactly once, guarded by its
   own `COMPLETED` row. Reports snapshot *before* the roll, archival happens *after*.
2. **The business date never moves backward.** No operational path exists to un-roll it;
   corrections are reversing entries in the new date (§7.3).
3. **`HALTED` is a real state with a real screen.** The property stays on the old business date,
   the front desk keeps working, and an operator sees exactly which step failed and why. Never
   auto-skip a failed step — a skipped `POST_ROOM_CHARGES` is unbilled revenue that nobody
   notices until checkout.
4. **One run per property per business date.** Enforced by the primary key plus DO
   single-threading. A second Workflow instance for the same date finds every step `COMPLETED`
   and exits clean.
5. **Steps run in the `BACKGROUND` lane** (§4.2). A night audit must not block a 2 a.m. walk-in.
6. **Provisional commands gate the run.** If the pending-command queue (§4.6) is non-empty for
   this property, `PRE_CHECK` drains it first, and halts rather than auditing over an outage's
   unapplied writes.

### Events: outbox → Queues → consumers, with R2 as the log

- **Outbox** lives in PropertyDO SQLite. Written in the same atomic write as domain mutations.
- **DO alarm sweeper** flushes unacked outbox rows to Queues (at-least-once, byte-bounded).
- **Queues** delivers to consumers with batching, retries, and DLQ.
- **Pipelines → R2/Iceberg** stores every event durably for replay and analytics.
- Consumers are **idempotent by `event_id`**. Set `max_concurrency` on consumers writing back
  to DOs to prevent stampeding a single property.
- Events carry PII by reference only (§4.8).

---

## 9. Frontend architecture

```
apps/web-pms/
├── shell/          # auth, tenant context, entitlement snapshot, layout, nav registry
└── (modules contribute surfaces via manifest `ui` section)
```

**Runtime composition, build-time bundling.** Every module's UI ships in the same build,
lazy-loaded per route. The shell builds nav from the registry filtered by `entitled && permitted`.

```tsx
const nav = useNavRegistry();

<Gate feature="revenue_mgmt.enabled" fallback={<UpgradePrompt feature="revenue_mgmt" />}>
  <RevenueDashboard />
</Gate>
```

Entitlement snapshot arrives with the session and refreshes on `entitlement.changed` via
WebSocket — a plan upgrade lights up the UI without a reload.

The shell also owns **degraded mode** (§4.6): a stale-data watermark, a queued-mutation
indicator, and hard refusal of inventory-consuming actions when the PropertyDO is unreachable.

---

## 10. Public API and marketplace

- **REST + OpenAPI 3.1**, generated from `packages/contracts`.
- **Date-based versioning** (`2026-07-26`) pinned per API key.
- **Webhooks:** signed (HMAC + timestamp), retried, replayable from a dead-letter UI.
- **Idempotency keys** required on every mutating endpoint. See §10.1 — the interaction with
  the outbox is subtle and getting it wrong double-books.
- **Rate limits** are an entitlement (`api.rate_limit_rpm`), enforced at the edge.
- **OAuth2 apps** with granular scopes, installed per property, revocable.

### 10.1 Idempotency × the outbox

These two mechanisms are usually specified separately and then quietly contradict each other.
A retried `POST /reservations` must not create a second reservation **and must not emit a
second `reservation.created`** — a duplicated event double-pushes to every OTA, double-fires
the confirmation email, and double-counts revenue in the warehouse. Deduping the write while
re-emitting the event is the failure mode to design against, and it is the default outcome if
the idempotency check sits at the edge.

**The rule: the idempotency record, the domain mutation, and the outbox row are one atomic
write, inside the owning DO.**

```ts
@lane('INTERACTIVE')
async book(cmd: BookCommand, idem: IdempotencyKey): Promise<Reservation> {
  const prior = this.sql.exec(
    `SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key,
  ).toArray();

  if (prior.length > 0) {
    // Same key, different body → the client has a bug. Never silently serve the old result.
    if (prior[0].request_fingerprint !== idem.fingerprint) throw new IdempotencyKeyReused();
    return JSON.parse(prior[0].response);   // NO mutation, NO outbox append, NO event.
  }

  const res = this.applyBooking(cmd);          // availability + reservation
  this.appendOutbox(ReservationCreated.from(res));
  this.sql.exec(
    `INSERT INTO idempotency (key, request_fingerprint, response, created_at) VALUES (?,?,?,?)`,
    idem.key, idem.fingerprint, JSON.stringify(res), Date.now(),
  );
  // No await anywhere above → all four effects commit together or none do.
  return res;
}
```

**Why this must live in the DO and not at the edge.** An edge-side cache can dedupe the
*response* but cannot participate in the transaction that appends the outbox row. Any edge
implementation has a window where the mutation committed and the idempotency record did not,
or vice versa. Inside the DO that window does not exist.

**Concurrent retries are free.** Two simultaneous requests with the same key serialize in the
DO by construction. The second observes the first's committed record. No lock, no in-flight
state, no leased-key protocol — this is one of the concrete payoffs of §4.1.

**Two different guarantees, and they must not be confused:**

| Boundary | Guarantee | Mechanism |
|---|---|---|
| Client → platform | **Effectively exactly-once.** One reservation, one event, per key. | Idempotency key in the DO transaction |
| Outbox → Queues → consumers | **At-least-once.** The same event may arrive twice. | Consumers dedupe on `event_id` |

The idempotency key does not make delivery exactly-once and is not a substitute for consumer
dedupe. It guarantees the event is *produced* once; the bus may still *deliver* it twice.

**Scope and retention.** Keys are scoped `(property_id, key)`. Retention is 7 days — long
enough to cover OTA connectors that retry for days, and swept in the `BULK` lane (§4.2).
Provisional commands replayed out of degraded mode (§4.6) use this same store, which is what
makes replay and live retry converge on one dedupe path rather than two.

**Third-party code execution (Phase 3+):** partners deploy sandboxed code that runs inside the
platform. Evaluate **Workers for Platforms** (dispatch namespaces, outbound controls, per-app
bindings) against the newer **dynamic Worker loader** (`WorkerLoader`), which supports
per-tenant bindings computed at load time and may be a lighter path to the same capability.
Either way: ship OAuth + public API first. This is the moat, not the MVP.

---

## 11. Repository layout

```
hospai-pms/
├── apps/
│   ├── edge/                        wrangler.jsonc — routes, authn, tenant resolution, kill-switch
│   ├── pms-core/                    PropertyDO + OrgDO + OrgEntitlementDO + core PMS modules
│   ├── payments/                    isolated bindings → PCI scope containment
│   ├── booking-engine/              Workers + Static Assets, SSR
│   ├── workflows/                   night audit, activation, reconciliation, dunning,
│   │                                cross-store purge, settlement reconciliation
│   ├── web-pms/                     operator SPA (React + Vite)
│   └── web-admin/                   internal console (behind Cloudflare Access)
│
├── modules/
│   ├── core/{tenancy, identity, entitlements, notifications, audit}
│   ├── pms/{inventory, availability, rates, reservations, folio, cashiering, guests,
│   │        frontdesk, housekeeping, nightaudit, groups, city-ledger}
│   └── addons/{channel-manager, booking-engine, revenue-management, pos, guest-engagement,
│               compliance-fiscalization, compliance-guest-registration, ...}
│
├── packages/
│   ├── kernel/                      module contract, registry, RPC entrypoint base
│   ├── contracts/                   versioned event + API schemas (zod → OpenAPI)
│   ├── do-runtime/                  DO base class, migrations, outbox, AlarmScheduler,
│   │                                LaneGuard, idempotency store
│   ├── d1-runtime/                  Platform D1 only — Sessions API, migration runner
│   ├── tenant-router/               ★ tenant → DO id / jurisdiction / locationHint
│   │                                the ONLY caller of idFromName — lint-enforced
│   ├── degraded-client/             command classification, pending queue, replay, watermarks
│   ├── entitlement-client/          version-keyed KV snapshot, guards, meters, kill-switch
│   ├── crypto-shredding/            per-guest data keys, envelope encryption, erasure
│   ├── money/                       currency, rounding, allocation, tax primitives
│   ├── temporal-utils/              StayDate, BusinessDate, Nights, timezone math
│   ├── observability/               tracing, structured logs, tenant-tagged metrics
│   ├── ui-kit/                      design system
│   ├── ui-shell/                    nav registry, slot system, entitlement-aware routing
│   └── sdk/                         generated public API client (TypeScript)
│
├── migrations/{do-property, do-org, d1-platform}/
├── tools/
│   ├── migrate-orchestrator/        ★ fan-out migration runner — build this early
│   └── module-scaffolder/           codegen for new module skeleton
└── tooling/                         ESLint boundaries, CI, codegen
```

**Boundary rules (enforced in CI):**
- A module's public surface is its `index.ts`. Importing internals is a lint error.
- `modules/pms/*` may not import `modules/addons/*` — core never depends on add-ons.
- `modules/addons/*` may import `modules/pms/*` public API only.
- `domain/` imports nothing but `packages/money`, `packages/temporal-utils`, and stdlib.
  No platform imports (Cloudflare APIs) and no entitlement client in domain code.
- Every type crossing a module boundary must be structured-cloneable and declared in
  `packages/contracts` (§3).

**Local dev:** `wrangler dev` with `remote: true` bindings. `@cloudflare/vitest-pool-workers`
for tests with isolated DO storage per test and `runDurableObjectAlarm()`.

**Test obligations that are not optional:**
- property-based tests on the availability ledger (the money is here)
- a replay test: rebuild every projection from the R2 event log and assert equivalence
- contract tests on every module boundary, asserting structured-cloneability
- fault injection: blackhole a PropertyDO mid-session, assert the §4.6 guarantees hold
- night-audit resumability: kill the Workflow at every step boundary, assert no double posting
- idempotency: replay every mutating endpoint, assert one mutation **and one event** (§10.1)
- jurisdiction: assert a tenant is unreachable through the non-jurisdictional namespace

---

## 12. Where Cloudflare fights you

| Challenge | Mitigation |
|---|---|
| **Migration fan-out** — thousands of DOs, each with own schema | Lazy migration in DO constructor + Workflow sweeper. Expand/contract mandatory. Budget this as real work. |
| **DOs cannot be enumerated** | There is no API to list instances in a namespace. The property/org registry in Platform D1 *is* the fan-out source of truth. If it drifts, a tenant becomes invisible and un-migratable. Registry writes are part of provisioning, never best-effort. |
| **D1 bindings are static** | Tenant storage is DO-based (§4.3). D1 is reserved for the single Platform database. |
| **Cross-tenant queries impossible** | Iceberg warehouse for fleet ops + privileged direct read path for CS |
| **DO placement is permanent** | `locationHint` at creation, derived from the property's **timezone** — a latency concern only, and best-effort (§4.5). Changing = full object migration. |
| **Jurisdiction is part of the object's identity** | `jurisdiction('eu')` yields a *different ID for the same name*. Recorded immutably on the tenant registry; every resolution path derives the ID through it, or it silently opens a blank object (§4.5). |
| **DO residency ≠ request-path residency** | A jurisdictioned DO is still reachable from any Cloudflare location, and the Worker in front of it may execute anywhere. Add Regional Services / edge placement controls for contracts that constrain *processing* location, not just storage (§4.5). |
| **A DO outage is a full property outage** | Degraded mode (§4.6). Reads from KV projection, writes queue or fail closed. |
| **Routing bug = full tenant exposure** | Tenant-router is small, audited, exhaustively tested, rarely changed |
| **Per-tenant backup/restore** | DO has PITR — but product-level restore tooling is yours to build |
| **128 MB memory** | PDFs, large exports, ML → Containers or Workers AI |
| **SDK compatibility** | Verify payment gateways + legacy hospitality connectors per-integration before committing |
| **Static egress IP** | Some OTAs need IP allowlisting — Cloudflare Tunnel'd proxy on static IP for those partners |
| **Vendor lock-in** | Domain code is pure TS. CF-specific code in `infrastructure/` + `do-runtime/`. Exit = rewrite adapters, not business logic. |

---

## 13. Cross-cutting concerns

**Identity & access.** Clerk or custom auth with organizations. RBAC with property-scoped
role assignments. Permissions contributed by module manifests. SAML/SCIM as an enterprise
entitlement.

**PCI DSS.** Card data never touches `pms-core`: hosted fields from the gateway, tokens only.
`payments` Worker is separately deployed, minimal surface.

**Data protection.** PII encrypted per-guest, events carry references only, erasure by
crypto-shredding (§4.8). Retention policy per data class, expressed as an entitlement.

**Audit log.** Append-only, tenant-partitioned, retention as an entitlement. Written from the
application layer via events.

**Observability.** Every span, log, and metric tagged with `org_id`, `property_id`, `module_id`.
OpenTelemetry → Baselime/Axiom.

**The signals that actually predict incidents.** Generic infrastructure metrics will not catch
the failure modes this architecture has. These are per-property and paged:

| Signal | Why it matters | Threshold |
|---|---|---|
| `ari.projection_lag` p99 | Leading indicator of oversell | > 5 s (§7.1) |
| `ari.reject_on_commit` rate | Projection drifting from the DO | Rising trend, not absolute |
| `do.interactive_latency` p99 | Front desk is slow → lobby queue | > 250 ms |
| `do.bulk_lag` | `BULK` starvation is expected; unbounded starvation is not | Backlog age > 1 h |
| `degraded.pending_commands` | Operators are working blind right now | > 0 warns, age > 15 min pages |
| `degraded.exception_queue_depth` | Writes that need a human | > 0 pages |
| `night_audit.state` = `HALTED` | Unbilled revenue accruing silently | Any occurrence |
| `outbox.unacked_age` | Events not reaching consumers or OTAs | > 60 s |
| `purge.verify_failed` | Compliance exposure with a paper trail | Any occurrence |

**Per-property, not per-fleet.** A fleet-level average hides the single hotel whose DO is
wedged — and that hotel is the one on the phone. Every threshold above alerts on the worst
property, never the mean.

---

## 14. Build order

> **Scope reality.** These phases are not comparable in size. Phase 0 is months; **Phase 1 is
> a complete PMS and is the multi-year item**; Phases 2–3 add four further products (channel
> manager, booking engine, revenue management, marketplace) plus fiscalization, which is a
> product in its own right. Read this as a dependency order, never as four equal quarters.

### Phase 0 — Foundation (the parts you cannot retrofit)

- Monorepo + CI + boundary linting + serializable-contract enforcement
- `kernel` module contract + manifest schema
- Auth with organizations (Clerk or custom)
- Platform D1 schema: orgs, plans, features, subscriptions, **tenant registry with jurisdiction**
- Tenant-router: jurisdiction-aware resolution + `locationHint` policy (§4.5) — *the single
  most security-critical component; build it first and freeze it*
- PropertyDO skeleton + OrgDO skeleton + OrgEntitlementDO
- `AlarmScheduler` and `LaneGuard` in `do-runtime` (§4.2, §4.4)
- Idempotency store inside the DO, with the outbox interaction (§10.1) proven by test
- Entitlement plane end-to-end (even with two hardcoded plans) + separate kill-switch
- **PII/erasure model decided and encoded in `packages/contracts`**
- **Multi-currency in `packages/money`** — the ledger shape, not the FX sourcing
- Outbox + Queues event bus
- Migration orchestrator (Workflow)
- Observability (tenant-tagged from day one)

Ship `pms.inventory` through the whole stack to prove the contract.

### Phase 1 — Core PMS (sellable)

Inventory → availability → rates → reservations → folio → cashiering → front desk →
housekeeping → night audit. Each depends on the previous.

- Property-scoped RBAC
- Audit log on money/inventory mutations
- Migrate prototype screens onto live APIs
- ARI projection to KV, with the staleness SLA and reject-on-commit path (§7.1)
- **Degraded mode end-to-end** (§4.6) — command classes, pending queue, replay, exception
  screen, SPA watermarks, fault-injection suite
- **Night-audit `BusinessDate` state machine** (§8) with the storage-level double-post guard
- **Multi-currency folio + payments↔folio event contract** (§7.3) — both land early in real
  deployments, and neither retrofits cleanly
- Launch-country tax model decided (constrains folio — see §7.7)
- Cross-store purge Workflow (§4.8) — needed as soon as the first tenant churns

### Phase 2 — First add-on (mechanism proof)

Build the channel manager as a strictly gated module with zero special cases. If it needs a
hack, fix the mechanism, not the module.

- Outbox consumers + Queue workers
- OTA integration (start with 2–3 channels)
- Booking engine with direct booking
- Group blocks and allotments

### Phase 3 — Commercial scale

- Self-serve plan changes + Stripe billing
- Usage billing for metered add-ons
- Marketplace OAuth + webhooks + public API
- Multi-property projections (§7.6)
- Fiscalization for the launch market
- Revenue management
- Guest engagement / messaging
- Partner sandbox (Workers for Platforms or dynamic Worker loader)

---

## 15. The rules that keep it enterprise-grade

1. **A module's public surface is its `index.ts`.** Enforced by lint, in CI, blocking merge.
2. **Core never imports add-ons.** One-directional dependency, always.
3. **Entitlement checks live in the application layer.** Not `domain/` — an aggregate invariant
   and a billing gate are different things. The edge is an optimization, never the only check.
4. **Deactivation never destroys data.** Only retention-driven purge does.
5. **Every mutation is an event.** Audit, integrations, and reporting derive from that stream.
6. **Money is integers; time is typed.** No floats, no naked `Date` across boundaries.
7. **Inventory is transactional.** PropertyDO serialization guarantees this structurally.
8. **Tenant-tag every telemetry signal.** Per-customer health, or you are debugging blind.
9. **No private backdoors — but "the public API" means two different things.**
    First-party modules call other modules over **service-binding RPC against the module's
    published interface** (`index.ts` + `packages/contracts`). Third parties call the
    **public HTTP API**. Both are gated, versioned, and entitlement-checked; neither may
    touch another module's internals. Forcing first-party code through HTTP would buy no
    isolation the binding does not already give and would cost a network hop on every
    front-desk action. The invariant is *no privileged access*, not *one transport*.
10. **Adding a new gated feature = a module + a data row.** If it needs a schema migration to sell, the gating plane is wrong.
11. **Domain code has zero platform imports.** Cloudflare-specific code lives in `infrastructure/` only.
12. **The tenant-router is the most security-critical code.** Treat it accordingly.
13. **Events carry PII by reference, never by value.** Erasure is key destruction, not history rewriting.
14. **Degraded mode never creates an obligation the property cannot honour.** Reads degrade, writes queue, inventory fails closed.
15. **Never `BEGIN`/`COMMIT` in `sql.exec()`, never `blockConcurrencyWhile()` on a request path.** Atomicity comes from not awaiting mid-sequence.
