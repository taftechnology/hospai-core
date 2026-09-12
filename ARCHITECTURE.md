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

> **Revision 2026-08-13.** Prototype-holes decisions closed; INQUIRY/PENDING drift closed;
> `rooms.set_ooo_range`, `folio.transfer_charge`, and `folio.split_charge_v2` shipped.
> Multi-currency folio + payments↔folio event contract designed in
> `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md`. FX sourcing is
> staff-entered effective-dated rates (no live feed); it is no longer “still owed.”
>
> **Revision 2026-07-27d.** Phase 0 verification follow-ups: tenant-router fails closed on
> missing jurisdiction; freeze DDL uniqueness/CHECK fixes; command catalog splits payment and
> inventory paths; check-in/check-out remain `QUEUE_PROVISIONAL` per §4.6 (cancel/no-show are
> `FAIL_CLOSED`). §7.1 availability enforcement documented as a **module boundary + ledger
> property tests**, not an AST scan lint. CI runs `typecheck` and a DDL drift check.

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
> regulatory scope (§7.9), the night-audit `BusinessDate` state machine (§8), and
> idempotency × outbox (§10.1).
>
> **Revision 2026-07-27b.** Reconciled against the `hospai-pms-prototype` reference SPA, which
> is hereby the functional specification for the PMS (§16). Added in consequence: the
> configuration plane (§1, §5.1), staff data as a distinct PII class (§4.8), the
> availability-is-a-ledger rule and virtual room types (§7.1), `products` / `maintenance` /
> `restrictions` / `reporting` modules and guest engagement as a module group (§11).
>
> **Revision 2026-07-27c.** Adds the Phase 0 **schema-freeze gate** (§14) — the four PropertyDO
> tables that cannot change cheaply later. New: the `restriction_day` ledger (§7.2), folio
> windows with routing and splitting (§7.3), OOO mapped into the availability ledger and the
> `held` column reserved for future holds (§7.1), timezone effective-dating (§7.5), operational
> read paths over hibernating WebSockets (§7.7), the OLTP/warehouse reporting split (§7.8), the
> `config.changed` consumer matrix (§5.1), and merge-blocking lint rules (§11).
>
> **Decided:** `held` is reserved in schema now, hold *behaviour* deferred to Phase 3 (§7.6).
> **Clerk is narrow** — authentication only; all authorization in OrgDO (§13).
>
> **Still owed:** per-country fiscalization design for
> the launch market. The config register and command catalog are now Phase 0 work items
> rather than open questions (§14).
>
> **Revision 2026-08-12.** Prototype coverage audit (§16.5). Historical: that pass listed
> unnamed operational fields (DND, additional guests, recurring charges, registration
> cards, extra HK tabs, global search) and INQUIRY/PENDING drift as remaining; the
> 2026-08-13 prototype-holes sweep and reservation-lifecycle restore closed those items.
> This paragraph is a dated record, not an open punch list.

---

## 1. The planes

The single most important structural decision. Most teams conflate these and end up with an
unmaintainable `if (customer.plan === 'pro')` mess scattered through the domain.

Three planes gate whether a capability runs at all. A fourth — configuration — decides how it
behaves once it does.

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

**And a fourth *plane*, orthogonal to all of the above: configuration.** Once a tenant is
entitled, a user permitted, and the flag on, there is still the question *how does this hotel
want it to work?* Configuration answers that, it is owned by the tenant rather than by us, and
a meaningful share of it changes domain math rather than presentation. It has its own storage
rules — some settings must be read inside the PropertyDO transaction or they reintroduce the
races this architecture exists to prevent. See §5.1.

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

- `availability_day` ledger (physical / blocked / **held** / sold / oversell allowance)
- restrictions ledger (MinLOS, MaxLOS, CTA, CTD, stop-sell) — §7.2
- `DOMAIN`-class configuration for this property (§5.1)
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
    // Queues caps a batch at 100 messages, 128 KiB per message, 256 KiB total.
    const candidates = this.sql.exec(
      `SELECT seq, payload FROM outbox WHERE acked = 0 ORDER BY seq LIMIT 100`,
    ).toArray();
    const batch = takeWhileUnderLimit(candidates, {
      maxMessages: 100,
      maxBytes: 256 * 1024,
      // Measured JSON envelope — same as queueMessageUtf8Bytes(row, { do: 'property', id })
      messageBytes: (row) => domainEventMessageUtf8Bytes(toDomainEvent(row, this.id)),
    });
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
the low hundreds of MB/year. The 10GB ceiling is years away. The 10 GB cap sizing assumes
the folio/reservation working set; **idempotency**, **outbox**, and **audit_log** grow until
retention (§10.1) and archival land.

**Archival rule (planned, not implemented in Phase 1):** After a fiscal year closes and
night-audit confirms, closed folios and checked-out reservations are intended to project to
R2/Iceberg; the PropertyDO would hold only the current year + open stays. Shares the deferred
purge track with idempotency/outbox retention (§10.1). This keeps the DO fast and the warehouse
queryable once implemented.

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
   affects latency. **A later timezone change never migrates the object** — see §7.5. Hints are
   best-effort anyway, and a property in a suboptimal colo costs tens of milliseconds, which
   never justifies migrating live inventory. Validate the timezone *at provisioning* instead;
   the realistic trigger for a change is an onboarding typo, not a relocation.
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

**There is more than one class of personal data, and they have different rules.** Treating
"PII" as one bucket produces a system that erases a guest correctly and leaks a housekeeper's
pay rate, or that deletes employment records a labour authority requires be kept:

| Class | Examples | Legal basis | Erasure |
|---|---|---|---|
| **Guest** | Name, contact, passport/ID, stay history, message content | Consent / contract | Right to erasure → crypto-shred on request |
| **Staff** | Name, contact, **hourly rate, performance rating, skills, shift history** | Employment contract | **Not guest-erasure.** Statutory employment retention, often years, jurisdiction-specific |
| **Financial** | Folio lines, invoices, settlement | Legal obligation | Survives erasure, pseudonymized (§7.9) |
| **Operational** | Room status, task assignment, audit actor refs | Legitimate interest | Retained per policy; actor refs pseudonymized on staff exit |

Staff data is the class most often missed, and the prototype makes the exposure concrete —
`hourlyRate`, `rating`, and `skills` sit on the housekeeper record next to their name. That is
compensation and performance data, and it is visible to anyone who can open the housekeeping
roster.

Three rules follow:

- **Separate key scopes.** Staff records encrypt under a per-staff key, not the tenant's guest
  key. Shredding a guest must not touch staff data and vice versa.
- **Compensation and performance fields are permission-gated separately** from the roster
  itself. Assigning a room to a housekeeper does not require seeing their pay rate.
- **Staff exit is not staff deletion.** Audit records must keep an actor reference for their
  full retention period. On exit, the identity is pseudonymized and the employment record
  follows statutory retention — never the guest-erasure path.

**Erasure = crypto-shredding.** Destroy the per-guest key. Every event, export, warehouse row,
and archived folio referencing it becomes permanently undecodable, with no rewrite of any
immutable store.

**What survives erasure, deliberately:** financial records required by tax and fiscalization
law (§7.9), retained as pseudonymized ledger entries with the legal basis recorded. Erasure
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

After step 1 the data is **already unrecoverable in every store the Workflow reaches** and in
R2 lifecycle-pending objects that a delete-first design could never catch. **Backups and DO
PITR windows are not covered in Phase 0** — a restore to before the shred can recover key
material unless PITR retention is shorter than the erasure SLA or the org master key is rotated
out-of-band after erasure (see §4.8 operational caveat). Steps 2–5 reclaim space and satisfy
"the row is gone" audits; they are housekeeping, not the cryptographic guarantee.

**Properties this design has to have:**

- **Every step is idempotent and resumable.** Deleting an already-deleted object is success.
- **`VERIFY` is mandatory and can fail the run.** A purge that reports success without
  re-scanning is the compliance equivalent of an untested backup.
- **The certificate is the deliverable.** Regulators and enterprise DPAs ask for evidence, not
  assurances. It is append-only and itself never purged.
- **Retention windows are enforced by the Workflow, not the caller.** `onPurge` cannot run
  early even if a module requests it; the window is checked in step 0 against Platform D1.
- **Financial-record exemptions are applied per record class** (§7.9), not per subject. A purge
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

### 5.1 The configuration plane

§1 defines three planes — entitlements, permissions, flags. There is a fourth axis they do not
cover: **tenant-chosen behaviour**. *We sold it, you may use it, the code is live — now, how
does this hotel want it to work?*

This is not a minor surface. The reference prototype (§16) carries **89 distinct settings**,
and a large fraction of them change domain math rather than presentation:

| Setting | What it actually controls |
|---|---|
| `allow_overbooking` | The oversell allowance in the `availability_day` ledger |
| `auto_no_show`, `audit_time` | Night-audit behaviour and its schedule → `AlarmScheduler` (§4.4) |
| `time_zone` | `StayDate` resolution, business-date rollover, **and `locationHint` at provisioning** (§4.5) |
| `payment_alloc`, `tax_registry` | How money is allocated across folio lines and how it is taxed |
| `currency_code` | The property's ledger currency (§7.3) |
| `same_day_cutoff`, `breakfast_rule` | Bookability and automatic posting rules |

Config was the largest under-modelled subsystem in the first revision of this document, where it
appeared only as `settingsPanels: string[]` in the manifest.

#### Declaration

Config is declared by the module that consumes it, with a schema, a scope, and a class. An
undeclared setting cannot be written — this is what stops the 89-key `localStorage` bag from
reappearing as an 89-column table nobody can reason about.

```ts
defineConfig({
  key: 'pms.availability.allow_overbooking',
  scope: 'property',
  class: 'DOMAIN',                       // ← see the table below
  schema: z.boolean(),
  default: false,
  permission: 'inventory:configure',     // who may change it
  audited: true,
  entitlement: 'pms.oversell',           // optional: gate the setting itself
});
```

#### Classes, and where each lives

**The class determines the storage, and the storage is not a preference — it is a correctness
requirement.**

| Class | Meaning | Lives in | Read path |
|---|---|---|---|
| `DOMAIN` | Participates in a domain decision | **PropertyDO**, beside the data it governs | Read **inside the DO, in the same atomic write** as the decision |
| `OPERATIONAL` | Changes behaviour but not an invariant (nav defaults, list columns, ETA display) | OrgDO | KV projection, version-keyed |
| `PRESENTATION` | Pure UI (date format, week start, compact mode) | OrgDO or user-scoped | KV projection; stale is harmless |
| `SECRET` | Gateway credentials, API tokens, terminal keys | **Never in config** — see below | Not readable by `pms-core` at all |

**The `DOMAIN` rule is the one that matters.** `allow_overbooking` cannot be read from KV while
the availability decision happens inside the PropertyDO. A stale or racing read of an oversell
allowance reintroduces exactly the race the entire storage design exists to eliminate. Any
setting that an invariant depends on lives in the PropertyDO and is read in the same
transaction — no exceptions, and CI checks the class of every setting read from domain code.

#### Secrets are not settings

The prototype keeps gateway credentials alongside display preferences — PayPal client IDs,
bank routing and SWIFT numbers, terminal registrations. That grouping is natural in a demo and
unacceptable here: it would place payment credentials inside OrgDO, readable by every module
that can read org config, which drags `pms-core` into PCI scope and defeats §13.

- Credentials live in the **`payments` Worker's secret store**, never in OrgDO or KV.
- `pms-core` may read a **non-secret reference** (`gateway: 'stripe'`, `terminal_id`), never a
  credential.
- The config API **rejects a `SECRET`-classed write** and returns a pointer to the payments
  admin flow. There is no "just this once" path.
- Rotation is a `payments` concern with its own audit trail.

#### Change management

Config edits are how a well-meaning operator breaks a property at 2 a.m., so they are treated
as mutations, not preferences:

1. **Versioned and audited.** Every write records actor, before, after, and reason. Config is
   in the audit log (§13) with the same weight as a money mutation.
2. **Validated against the declared schema** at the boundary, then re-validated in the DO.
3. **Permission-gated per setting**, not per settings *screen*. "Can open Settings" is not a
   permission.
4. **`DOMAIN` changes emit `config.changed`**, so projections, the ARI cache, and the channel
   manager can react. A change to `allow_overbooking` that does not invalidate the ARI
   projection is a silent oversell. Which consumers a key wakes is declared, not inferred:

   | Key | Invalidates ARI | Reschedules night audit | Affects tax/money | Rematerializes rates |
   |---|---|---|---|---|
   | `allow_overbooking` | ✅ | — | — | — |
   | `oversell_allowance` | ✅ | — | — | — |
   | `time_zone` | ✅ | ✅ | — | ✅ |
   | `audit_time` | — | ✅ | — | — |
   | `auto_no_show` | ✅ | ✅ | — | — |
   | `same_day_cutoff` | ✅ | — | — | — |
   | `currency_code` | — | — | ✅ | ✅ |
   | `tax_registry` | — | — | ✅ | — |
   | `payment_alloc` | — | — | ✅ | — |
   | `breakfast_rule` | — | ✅ | ✅ | ✅ |

   A `DOMAIN` key with no declared consumers is suspect — it probably belongs in `OPERATIONAL`.
5. **Effective-dated where the domain requires it.** Changing a tax rule must not retroactively
   alter closed folio lines (§7.3). Tax, currency, and rate-affecting config carry a validity
   window rather than overwriting.
6. **Defaults live in code, not in the tenant row.** A tenant row stores only overrides, so
   changing a platform default does not require touching every property.

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

### 6.7 Package composition

Three tiers, named for the three segments the product sells to: single independents, single
full-service properties, and groups of three to ten. **There is deliberately no Enterprise
tier.** Estates above ten properties are out of scope — the ceiling is enforced by
`pms.properties.limit` below rather than left to memory. If that ceiling ever moves it becomes
a fourth tier with its own compliance surface, never a stretched Group.

| Feature key | Starter | Growth | Group | Add-on |
|---|---|---|---|---|
| `pms.core` | ✅ | ✅ | ✅ | — |
| `pms.properties.limit` | 1 | 1 | 10 | +1 each |
| `pms.units.limit` | 40 | 400 | ∞ | — |
| `pms.multi_property` | — | — | ✅ | — |
| `pms.housekeeping` | ✅ | ✅ | ✅ | — |
| `payments.enabled` | **required** | ✅ | ✅ | — |
| `booking_engine.enabled` | ✅ | ✅ | ✅ | — |
| `booking_engine.custom_domain` | — | ✅ | ✅ | ✅ |
| `channel_manager.enabled` | ✅ | ✅ | ✅ | — |
| `channel_manager.connections.limit` | 3 | 15 | ∞ | +1 each |
| `agentic_distribution.enabled` | ✅ | ✅ | ✅ | — |
| `revenue_mgmt.enabled` | — | — | — | ✅ |
| `ai_ops.enabled` | — | — | — | ✅ |
| `ai_ops.messages.limit` | — | — | — | metered (`soft`) |
| `mcp.enabled` | ✅ | ✅ | ✅ | — |
| `mcp.clients.limit` | 1 | 5 | ∞ | +1 each |
| `pos.enabled` | — | — | — | ✅ |
| `api.public_access` | — | ✅ | ✅ | — |
| `sso.saml` | — | — | ✅ | ✅ |
| `compliance.fiscalization` | ✅ | ✅ | ✅ | — |

Eight of these rows are load-bearing commercial decisions rather than defaults, and each one
was wrong in the previous draft of this table in a way that priced the target customer out of
the product they were being sold.

- **`pms.properties.limit` turns the ceiling into a product boundary.** `1 / 1 / 10`, with a
  `+1 each` add-on. A group that grows to twelve gets a path that does not require a tier we
  have decided not to build, and the entitlement plane — not a salesperson — decides when a
  tenant has left the segment.
- **`pms.multi_property` belongs to Group.** It is the defining capability of the segment that
  carries the largest share of the book. Gating it above that segment prices the core customer
  out of the core feature.
- **`pms.units.limit` must clear a full-service property.** Growth at 400 rooms. The previous
  cap of 100 ran through the middle of the single-property upscale segment and forced a
  150-room hotel into a tier meant for estates.
- **`channel_manager.enabled` starts at Starter.** An independent that cannot reach an OTA has
  no product. Tier on `connections.limit` (`3 / 15 / ∞`), never by switching distribution off.
- **`payments.enabled` is required on Starter, not optional.** Starter is priced near zero on
  the assumption that the rails earn. A Starter tenant not enrolled in payments is a tenant we
  pay to host, so enrolment is a condition of the tier and enforced as one.
- **`revenue_mgmt.enabled` is an add-on on every tier.** It is the only module whose outcome
  the operator can verify without us, which makes it the natural upgrade at every size — and a
  poor reason to buy a tier they otherwise do not need.
- **`agentic_distribution.enabled` ships on every tier and is never sold separately.** Its
  value is coverage: an AI intermediary integrates with a platform whose entire inventory is
  addressable, not with a paywalled subset. Charging for it optimises a small line and
  forfeits the channel.
- **`ai_ops.*` is the *in-product* agent; `mcp.*` is the external one.** Two different trust
  boundaries with two different keys (§10.2). `ai_ops` is metered because we pay for the
  inference; `mcp` is capped because each connected client is a standing capability against
  tenant data.
- **`mcp.*` ships on every tier under a `hard` connection cap.** Same coverage logic as agentic
  distribution: an operator whose own assistant is wired into the PMS does not go shopping for
  another PMS. Whether those agents may *write* is configuration, not entitlement, and defaults
  closed (§10.2).
- **`compliance.fiscalization` is not premium.** In a fiscal launch market (§7.9) an
  independent cannot legally operate without it. Gating it at the top excludes the launch
  segment from the launch country.

**Relationship to the closed union.** `@hospai/contracts` currently exports a two-key
`FEATURE_KEYS` union (`pms.core`, `pms.units.limit`) and `check:entitlements` holds the D1 seed
to it. This table is the **authorised target**, not the shipped catalog: each key above may
join the union as its module lands, and doing so is a catalog change plus a module, never a
schema migration (§6.1). A key that is *not* in this table remains subject to the escalation
rule in `docs/roadmap.md` — stop and ask. Landing the rows above is roadmap slice **R3.10**.
---

## 7. PMS domain — the parts that are genuinely hard

### 7.1 Availability (ARI) and oversell control

The highest-contention resource. PropertyDO serialization eliminates races structurally.

Rules:
- Availability decrements in the **same atomic write** as the reservation.
- **Room-type level, not room level.** Assignment happens at check-in.
- A separate denormalized **ARI projection** (KV) serves the booking engine and channel pushes.
  Stale reads there are fine; the DO is the arbiter.
- **The oversell allowance is `DOMAIN`-class config** (§5.1), read inside the DO transaction.

> **Availability is a ledger. It is never derived by scanning reservations.**
>
> The reference prototype (§16) computes availability by filtering the reservation list for
> date overlaps and comparing the count to the room total. That is correct for an in-memory
> demo and unusable here: it is a read-then-decide across an unbounded set, it degrades as the
> property accumulates history, and it reintroduces precisely the race the PropertyDO exists to
> eliminate. The `availability_day` ledger is the system of record; reservations are a
> consequence of it, never the source for it.
>
> This is the single most important thing not to carry across, and it is **invisible in the
> UI** — the screens look identical either way. Treat any code path that counts reservations to
> answer "is there room" as a defect.
>
> **Enforcement is structural, not a syntactic lint.** Reservation-scan shapes (temp variables,
> loops, renamed helpers) cannot be matched reliably by AST rules — and Phase 1 will port
> prototype code that uses exactly those shapes. What CI enforces:
>
> 1. **Boundary rule** — bookability / ARI / channel paths may not import reservation
>    list/query modules; capacity is read only from the availability module (§11).
> 2. **Property-based tests** on the `availability_day` ledger (§11 test obligations) — these
>    catch the *behaviour* regardless of how a mistaken scan would be written.

#### The ledger shape

```sql
CREATE TABLE availability_day (
  room_type_id  TEXT NOT NULL,
  stay_date     TEXT NOT NULL,          -- StayDate, property timezone (§7.5)
  physical      INTEGER NOT NULL,       -- sellable rooms of this type
  blocked       INTEGER NOT NULL DEFAULT 0,   -- OOO / maintenance — see below
  held          INTEGER NOT NULL DEFAULT 0,   -- reserved capacity, not yet sold
  sold          INTEGER NOT NULL DEFAULT 0,
  oversell      INTEGER NOT NULL DEFAULT 0,   -- DOMAIN config (§5.1)
  version       INTEGER NOT NULL,             -- stamped onto the ARI projection (§7.1)
  PRIMARY KEY (room_type_id, stay_date)
);
-- free = physical - blocked - held - sold + oversell
```

**`held` is reserved in the schema now and unused until central reservations ships (§7.6).**
This is deliberate. The column is PropertyDO schema, so adding it later is a migration across
every property in the fleet (§12); adding it now, always zero, costs nothing. The *behaviour* —
TTL length, abandonment policy, whether the booking wizard also holds — is a Phase 3 decision.
Until then `held` is always 0 and `free` is unaffected.

#### Validate-then-mutate (inventory commands)

Every inventory-affecting PropertyDO command (`reservations.create`, `reservations.cancel`,
`reservations.modify`, and any future book path) **finishes all precondition checks before any
ledger write**. Availability, restriction, and release checks run against the current ledger
(with virtual release simulated for modify overlaps on same-room nights); only after every
night passes does the command increment or decrement `sold`, flip reservation state, or
append outbox rows.

Consequences:

1. **`{ ok: false }` never leaves partial ledger state** — a failed book, cancel, or modify
   does not mutate `sold`. Precondition failures that depend on *current* ledger or
   restriction state (`no_availability`, `unbookable`, `restriction_violated`,
   `ledger_inconsistent`, and the inventory analogues) are **thrown inside**
   `runIdempotent` so the transaction rolls back and the failure is **not** cached — the
   same idempotency key remains retryable once demand or rules change (§7.5 inventory
   oversell pattern).
2. **Idempotency replay is safe** — successful outcomes and stable semantic failures (e.g.
   `already_cancelled`, `not_modifiable`) may be cached; ledger-state preconditions are not.
3. **New commands must follow the same shape** — interleaving checks with writes is a defect.

Property-based tests (§11) assert the ledger invariant: for each `(room_type_id, stay_date)`,
`sold` equals the count of reservations in `pending | confirmed | checked_in | checked_out`
covering that night.

Pre-assign is allowed; check-in without a resolved room is rejected unless `pms.ops.auto_assign_rooms` is on, in which case `tryCheckIn` may auto-pick the lowest eligible physical room of the booked type.

When holds do land, three things become mandatory at the same time: a `hold-expiry` schedule on
the `AlarmScheduler` (§4.4), held inventory reading as **unavailable** in the ARI projection
(or the booking engine sells rooms an agent is holding), and monitoring for abandoned holds —
a stuck hold is silently unsellable inventory.

#### Out-of-order rooms decrement the ledger

OOO is recorded per **room** with a date range; the ledger is per **room type**. Placing a room
out of order therefore increments `blocked` for its room type across `[oooStartDate,
returnDate)`, **in the same atomic write as the room status change**. A room marked OOO that
still sells is the same class of defect as an oversell.

Three rules that are easy to miss:

1. **Editing an OOO range adjusts on the delta**, not by recompute — extending by two nights
   increments two rows, it does not rewrite the range.
2. **OOO on a room assigned to an in-house or arriving reservation fails closed.** Either the
   reservation is reassigned first, or the command is rejected with the conflict. Never
   silently strand a guest.
3. **OOO emits an event that opens a `maintenance` work order** (§11), so the reason a room is
   out of service is tracked rather than living in a free-text field.

Stop-sell (§7.2) travels the same path and is applied in the same transaction.

**Physical and virtual room types.** Inventory distinguishes room types that map to real rooms
from *virtual* types — packages, combined units, and sales constructs that draw on the same
physical rooms. The ledger tracks **physical** inventory; virtual types resolve to one or more
physical types through a declared mapping, and a virtual sale decrements the underlying
physical rows in the same atomic write.

Two consequences that are easy to miss:

- **A virtual type has no independent `physical` count.** Modelling it as its own row is how
  properties oversell — two types selling the same bed, each believing it has stock.
- **Restrictions and oversell allowances attach to the physical type**, and a virtual type
  inherits the tightest constraint among its constituents.

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

#### Restrictions are a separate ledger from prices

Restrictions and prices change on different schedules, are edited by different people, and
answer different questions — *may this stay be sold?* versus *what does it cost?* Collapsing
them into one table means a revenue manager adjusting a rate silently clears a stop-sell.

Like `availability_day`, this is **PropertyDO schema and therefore in the Phase 0 freeze
window** (§14).

```sql
CREATE TABLE restriction_day (
  room_type_id  TEXT NOT NULL,
  rate_plan_id  TEXT,                   -- NULL = applies to every rate plan on this type
  stay_date     TEXT NOT NULL,
  min_los       INTEGER,                -- minimum length of stay
  max_los       INTEGER,
  cta           INTEGER NOT NULL DEFAULT 0,   -- closed to arrival
  ctd           INTEGER NOT NULL DEFAULT 0,   -- closed to departure
  stop_sell     INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL,
  PRIMARY KEY (room_type_id, rate_plan_id, stay_date)
);
```

**Evaluation rules:**

1. **Restrictions are evaluated in the same transaction as availability**, inside the DO. A
   booking that passes availability but violates MinLOS must fail before anything is written.
2. **The tightest constraint wins.** A rate-plan-specific row and a type-wide row both apply;
   take the stricter. A virtual room type inherits the tightest constraint among its
   constituent physical types (§7.1).
3. **CTA/CTD are evaluated against the boundary nights only** — CTA against the arrival date,
   CTD against the departure date — while MinLOS/MaxLOS are evaluated across the whole stay.
   Getting this wrong is the most common restriction bug in the industry.
4. **Stop-sell is not zero availability.** It suppresses sale while leaving inventory intact, so
   lifting it restores the original position. Never implement stop-sell by zeroing `physical`.
5. **Restrictions push to channels** alongside ARI. An OTA holding a stale MinLOS will keep
   selling stays the property refuses, and those arrive as bookings you must honour or cancel.

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

#### Folios have windows, and charges move between them

A reservation does not have *a* folio. It has **windows** — typically a guest window, one or
more company/third-party windows, and a master window for group masters. This is not an
advanced feature; splitting a bill between guest and employer is a daily front-desk action, and
the reference prototype already specifies routing rules and charge splitting (§16.1).

Modelling one ledger per reservation and adding windows later means re-keying every folio line
and every report that reads them.

```sql
CREATE TABLE folio_window (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL,   -- GUEST | COMPANY | MASTER
  billed_party    TEXT,            -- city-ledger account for COMPANY (§7.3)
  status          TEXT NOT NULL,   -- OPEN | CLOSED
  closed_at       INTEGER
);
-- folio_line.folio_window_id, not folio_line.reservation_id
```

**Routing rules** map charge-code ranges to a destination window (`transactionRange →
destination`), and may transfer automatically at night audit. Three constraints:

1. **Auto-transfer is a night-audit step and obeys §8.** It is idempotent against re-runs, keyed
   by `(reservation_id, business_date, rule_id)`. A Workflow retry that moves charges twice is
   a double-bill on a corporate account, which surfaces weeks later in a disputed invoice.
2. **Transfers are postings, not updates.** Moving a charge writes a reversing line in the
   source window and a new line in the destination. The original line is never re-pointed —
   the folio stays append-only (Rule 5) and the transfer stays auditable.
3. **A closed window rejects postings.** Late charges against a checked-out, closed window go to
   the exception path, never silently reopen it.

**Splitting a charge** follows the same rule and this is where the prototype diverges most
sharply: its `splitFolioCharge(id, itemId, newAmount)` mutates the line in place. Here, a
$100 charge split 60/40 is **one reversal plus two new postings**, all in one atomic write,
all carrying a `split_of` reference to the original.

- Splits must foot exactly. `packages/money` owns the allocation so remainder pennies land
  deterministically rather than by rounding drift.
- A split across windows is a split *and* a transfer, and is subject to both rule sets above.

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

#### Changing a property's timezone

`time_zone` is `DOMAIN` config (§5.1) and it controls far more than placement: what a
`StayDate` means as an instant, when the business date rolls, and when the night-audit alarm
fires. So the question *"can a property change its timezone?"* is really a question about
historical data, and it is answered by splitting the concept in two:

| | Mutable? | Rule |
|---|---|---|
| The timezone used for **future** business-date math | **Yes** — effective-dated | Carries a validity window, exactly like tax rules (§5.1 rule 5) |
| The timezone historical records were **written in** | **No** | Already stamped on each record; past `StayDate`s and `BusinessDate`s never shift |

A stay date recorded under the old timezone keeps its meaning forever. Changing the setting
changes what *tomorrow* means, never what last August meant. Any implementation that
re-derives historical instants from the current timezone setting is wrong, and the failure is
invisible until a year-end report disagrees with the filed night-audit packets.

**Preconditions for a change:** no night audit in flight, business date not mid-rollover, the
`night-audit` alarm recomputed on commit, and an audit record with the effective date. The
PropertyDO is **not** migrated — see §4.5.

The realistic trigger is an onboarding typo, not a relocation, so validate the timezone at
provisioning and treat the change path as a rare correction rather than a routine setting.

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

#### Central reservations: optimistic commit now, holds when it ships

The commit-side reject in §7.1 is correct for the **booking engine** — a guest sees "just sold
out," picks another option, self-serves. It is a poor fit for a **phone agent** who has spent
four minutes collecting a card and preferences and must now apologize, and it degrades badly
for multi-room and travel-agent bookings where partial failure is the norm.

The eventual answer is **TTL holds**: reserve inventory at the owning PropertyDO when the agent
selects a property, complete the booking against guaranteed stock, release on abandonment. The
`held` column exists in the ledger for exactly this (§7.1) and is unused until then.

**Until holds ship, the reject path needs an operator UX that is more than an error:**

- Re-query the group projection immediately and offer the next-best property in the group.
- **Preserve the booking context** — guest details, dates, preferences survive the rejection.
  Re-keying a four-minute call is the actual cost of a reject, not the rejection itself.
- Distinguish *stale projection* from *genuine race* using the version stamp (§7.1), and
  surface only the second as "just sold"; the first is our defect and should be logged as one.
- Never present a group search result as confirmed availability. The projection is advisory and
  the UI must say so, or agents will promise rooms the platform has not reserved.

### 7.7 Operational read paths — the front desk is chattier than the booking engine

The tape chart and front-desk board are the highest-frequency reads in the product: a grid of
rooms × dates, open on several workstations, refreshed constantly through a shift. Naïve
polling turns every workstation into sustained load on a single-threaded object, competing with
the check-ins in the `INTERACTIVE` lane (§4.2).

**A short-TTL projection is the wrong instrument here.** Unlike the booking engine, the front
desk needs data fresh to the second — an agent checking a guest in cannot act on a 30-second-old
room status. A TTL short enough to be safe is short enough to be nearly useless.

**Use the Hibernation WebSocket API instead.** The PropertyDO holds connections from the
property's workstations and pushes deltas on change. Clients stay connected while the object
hibernates, and billable duration does not accrue while it sleeps — so idle overnight
workstations cost nothing. It is the same channel §9 already uses for `entitlement.changed`.

```
initial load  →  projection read (one query, bounded window)
thereafter    →  deltas pushed over the socket on every domain event
reconnect     →  resync from version, not a full reload
```

Three implementation constraints:

1. **The constructor re-runs on every hibernation wake.** PropertyDO's constructor calls
   `blockConcurrencyWhile(() => this.migrate())` (§4.1). That must be a cheap version check, not
   a schema scan, or every wake pays migration cost on the critical path.
2. **Per-connection state uses `serializeAttachment()`**, since in-memory state is lost on
   hibernation. Store the subscribed date window and the user's property scope there.
3. **The tape chart needs a bounded query regardless of transport.** It is a range scan over
   rooms × dates; serve only the visible window, and consider a materialized view in the DO
   rather than assembling it per request.

### 7.8 Reporting: what is OLTP and what is warehouse

`reporting` (§11) is a module, but most reports are not its data. The dividing rule:

> **If a report must tie out to *right now* or to a closed financial period, it is OLTP. If it
> is a trend, it is warehouse.**

| PropertyDO (OLTP) | Iceberg warehouse |
|---|---|
| Arrivals, departures, in-house list | ADR / RevPAR / occupancy trends |
| Room status and housekeeping board | Pace and booking-window analysis |
| Today's occupancy and forecast for the open date | Channel and source mix over time |
| Cashier shift close | Guest cohort and lifetime-value analysis |
| **Night-audit close-out reports** | Multi-property and chain rollups |
| Folio and balance for an open stay | Year-over-year anything |

**Night-audit close-out reports are snapshotted to R2 at generation.** Hoteliers print and file
them, and in fiscalized markets they are submitted. A report re-derived later from a warehouse
that has since been compacted, corrected, or partially purged will not match the filed copy.
Generate once, store immutably, serve the stored artifact forever.

Two consequences worth stating: no OLTP report may fan out across properties (§7.6), and no
warehouse query may be on the path of an operator action — seconds-old data is fine for a
dashboard and unacceptable for a check-in decision.

### 7.9 Regulatory — the hidden second product

None of this changes the architecture — each is an add-on module gated on `compliance.*`
entitlements, exactly as designed. It does change the roadmap, and it is absent from most PMS
build plans until a deal depends on it.

**Launch markets: Canada, India, Australia.** They span the whole difficulty range, and more
usefully they exercise three *different* structural features of a tax engine. Building for the
union of the three is only slightly more work than building for Canada alone, and far less work
than retrofitting India afterwards.

| Obligation | Canada | Australia | India |
|---|---|---|---|
| **Rate structure** | Federal GST/HST **+** provincial (PST / QST, and HST-harmonised provinces differ in kind) **+** municipal accommodation tax | Single federal GST, one rate | GST **slab keyed to the nightly tariff**; splits `CGST` + `SGST` intra-state, `IGST` inter-state |
| **Display** | Tax-exclusive | **Tax-inclusive is mandatory** in displayed prices | Components itemised on the invoice |
| **Fiscalization** | None | None (Peppol e-invoicing is voluntary) | **e-invoicing: IRN + QR from the government portal above the turnover threshold** |
| **Guest registration** | None | None | **Form C** for foreign nationals |
| **Guest tax id on invoice** | — | ABN for B2B | **GSTIN** — required for the guest's input credit |

> Rates, slab boundaries and turnover thresholds move. Verify current values with a local
> advisor before implementing; the table records *shape*, which is what constrains the model.

**What the tax model must carry from Phase 1**, whichever country ships first:

1. **A jurisdiction stack per property** — country → state/province → municipality — not a
   country enum. Canadian accommodation taxes are set below the province.
2. **Rate resolution is a function**, `f(jurisdiction, date, taxable base, product class)`, not
   a stored percentage. India's slab makes the rate depend on the amount being taxed.
3. **Computed inside the PropertyDO transaction that sets the rate** (§5.1). A slab rate read
   from config outside that transaction reintroduces exactly the race this architecture exists
   to prevent — and a discount or an upgrade can move a stay across a slab boundary.
4. **Per night, at posting.** Room-charge tax is computed for each night at that night's rate,
   never once for the stay.
5. **One levy may split into components.** `CGST` + `SGST` is a single taxable event reported as
   two lines, not two taxes; the folio must foot either way.
6. **Inclusive versus exclusive is a jurisdiction property, not a display preference.** Australia
   requires inclusive pricing in the booking engine *and* on the folio.
7. **A fiscal-document hook on the invoice engine** — null for Canada and Australia, carrying
   IRN and QR for India. Adding it later means reissuing invoices.

**Recommended answer to R3.6: name Australia**, and design the engine to the India shape.
Australia is the only one of the three that is legally shippable on a single flat rate, it
forces the inclusive-pricing axis early (painful to retrofit into the booking engine and the
folio), and it unblocks the Phase 1 folio constraint now. Canada then arrives as jurisdiction
*configuration* on requirement 1, and India as a `compliance.*` module on requirement 7.

Note that **R3.6 is an architecture decision — which tax shape constrains the folio — and it
does not have to match the commercial launch order.** Naming Australia here does not commit
sales to Australia first.
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
IDLE ──▶ PRE_CHECK ──▶ POST_ROOM_CHARGES ──▶ PROCESS_NO_SHOWS ──▶ AUTO_TRANSFER ──▶ CLOSE_CASHIER_SHIFTS
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


### 9.1 The second client — housekeeping and communication

`web-pms` is not the only client. **Housekeeping and communication ship as a separate mobile
app**; the operator SPA stays desktop-only and the viewport lock in §13 is permanent rather than
deferred. The split is right — a tape chart and a folio are dense grid surfaces, and a corridor
is not where anyone posts a charge — but a second client changes four things a single
first-party SPA let us ignore.

**1. The client and the Worker stop deploying together.** This is the one that costs most if
missed. `web-pms` ships with `pms-core`; an installed mobile client runs whatever version its
user last accepted, for months. So either the internal `/v1` surface takes on the
backwards-compatibility discipline §10 reserves for the *public* API — additive change only, no
field repurposed, no route retired without a deprecation window — **or** the app carries a
minimum-supported-version handshake and refuses to run below it. Pick one before the first
release; retrofitting either onto a shipped app costs a release cycle nobody can be forced to
take. (A PWA sidesteps this entirely by updating with the Worker.)

**2. Offline becomes a client concern, not only a server one.** Degraded mode (§4.6) covers
PropertyDO unreachability. A housekeeper in a basement is a different failure: the network is
gone at the device. Status changes queue locally and replay on reconnect, and they must reuse
**the existing command idempotency keys** rather than inventing a second replay path. Two
attendants marking the same room is routine, not hypothetical — last-write-wins is acceptable on
a room status and unacceptable on anything touching money, which is one more reason money stays
off this client.

**3. Push is the first outbound channel to a person.** Device tokens are per-user records that
purge with the user (§4.8) and revoke with the device. **Push payloads must not carry guest
PII** — a lock screen is a public surface, and *"Message from A. Okafor in 214"* leaks a name and
a room number to anyone glancing at a pooled handset. Send an identifier; let the app fetch the
content behind auth.

**4. A lost device is a standing credential.** Housekeeping hardware is shared, pooled and
mislaid far more often than a front-desk terminal. Sessions on this client are short,
device-bound and independently revocable. Note the interaction with §6.3: the entitlement
version rides the session token, so a long-lived mobile token widens the revocation window the
entitlement design works to keep narrow. Do not extend token TTL to save a login prompt.

Whether this client reaches *guest* conversations or only staff ones decides whether guest PII is
cached on a pooled device at all — scoped in roadmap **R4.10**.

**Shared contract, separate build.** The mobile client consumes `@hospai/contracts` and
`@hospai/client-core` like any other caller, so route and payload types cannot drift. It does not
import from `web-pms`, and `web-pms` does not import from it.
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

**Scope and retention.** Keys are scoped `(property_id, key)`. The **target** retention
policy is 7 days — long enough to cover OTA connectors that retry for days. The sweep is
**not yet implemented** ([queues consumer design](docs/superpowers/specs/2026-07-28-queues-consumer-design.md));
records currently persist for the life of the DO. Consumer dedupe already honours
`DEDUPE_TTL_SEC ≥ retention`. Provisional commands replayed out of degraded mode (§4.6) use
this same store, which is what makes replay and live retry converge on one dedupe path rather
than two.

**Third-party code execution (Phase 3+):** partners deploy sandboxed code that runs inside the
platform. Evaluate **Workers for Platforms** (dispatch namespaces, outbound controls, per-app
bindings) against the newer **dynamic Worker loader** (`WorkerLoader`), which supports
per-tenant bindings computed at load time and may be a lighter path to the same capability.
Either way: ship OAuth + public API first. This is the moat, not the MVP.

---

### 10.2 Agent surfaces — two trust boundaries, never one

Three different callers want to drive this platform with a model, and they do not share an
authorisation story. Collapsing them onto one surface is the mistake to avoid.

| Surface | Principal | Trust | Reach |
|---|---|---|---|
| **In-product agent** (`ai_ops.*`) | The tenant's operator; we run the model | Full — our code, our prompts | Whatever the acting role may do |
| **MCP server** (`mcp.*`) | A third-party AI client the operator authorised — their assistant, a partner's | Delegated, scoped **narrower** than the user | Consented scopes only |
| **Public distribution** (`agentic_distribution.*`) | A traveller's assistant. A stranger. | None | Public ARI + create-booking-with-payment |

Both *agent* surfaces call `COMMAND_CATALOG`. Neither reaches a Durable Object directly.

1. **Tools are catalog entries, not endpoints.** An MCP tool maps 1:1 to a command that already
   exists. That is what makes the three gates of §1 apply without a second implementation —
   entitlement, permission and release flag are checked on the command path, and the audit
   write on money/inventory mutations already happens. A tool that needs a new capability
   needs a new *command* first.
2. **The grant is narrower than the user.** §10 already installs OAuth2 apps per property with
   granular scopes. An MCP session resolves to `(org, property, principal, granted scopes)` and
   the effective permission is the **intersection** of the user's role and the grant. A general
   manager connecting an assistant must not thereby hand it everything a general manager can do.
3. **External writes default closed, and are configuration rather than entitlement.** Whether
   outside agents may mutate is *how this hotel wants it to work* — the fourth plane in §1. It
   lives in the config register, per scope, closed until opened. `mcp.enabled` says the tenant
   bought the surface; the register says what it may touch.
4. **Attribution is per client.** The `agent` actor kind is not sufficient here: the audit row
   must carry the **OAuth client id** alongside the delegating user, or *who cancelled this
   reservation* has no answer once three assistants are connected.
5. **Revocation is a safety state, not a commercial one.** §6.4 already establishes that
   anything requiring a token refresh to land is not a kill-switch. Cutting off a misbehaving
   agent is exactly that case: it must **not** ride the version-keyed entitlement snapshot and
   must not wait out the session token TTL. Revoke at the grant and at the kill-switch, both
   effective immediately.
6. **Guest-supplied text is data, never instruction.** An agent reading the guest inbox is
   reading text written by strangers, while holding the operator's authority. No command may be
   derived from guest-supplied content without an explicit human confirmation step — otherwise a
   sentence in a booking note becomes a way to drive the hotel's own assistant against the
   hotel. Put the confirmation requirement on the **command**, not in the prompt.
7. **Connections are a `hard` limit.** `mcp.clients.limit` at the OrgEntitlementDO counter,
   exactly like OTA connections (§6.6). Never a soft meter — each connected client is a
   standing capability against tenant data.
8. **PII scopes separately.** Guest-profile reads are their own scope, audited per read and
   excluded from any default grant. Right-to-erasure (§4.8) cannot recall what an agent has
   already retrieved, so the consent screen and the DPA have to say so.

## 11. Repository layout

```
hospai-pms/
├── apps/
│   ├── pms-core/                    PropertyDO + OrgDO + OrgEntitlementDO + HTTP routing (no separate edge app)
│   ├── payments/                    isolated bindings → PCI scope containment
│   ├── booking-engine/              Workers + Static Assets, SSR
│   ├── workflows/                   night audit, activation, reconciliation, dunning,
│   │                                cross-store purge, settlement reconciliation
│   ├── web-pms/                     operator SPA (React + Vite)
│   └── web-admin/                   internal console (behind Cloudflare Access)
│
├── modules/
│   ├── core/{tenancy, identity, entitlements, configuration, notifications, audit}
│   ├── pms/{inventory, availability, rates, restrictions, reservations, folio, cashiering,
│   │        products, guests, frontdesk, housekeeping, maintenance, nightaudit,
│   │        groups, city-ledger, reporting}
│   └── addons/{channel-manager, booking-engine, revenue-management, pos,
│               guest-engagement/{inbox, automations, campaigns, tasks, upsell},
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
│   ├── temporal-utils/              StayDate, BusinessDate, Nights, timezone math (unused — next date slice imports or deletes)
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
- `domain/` imports nothing but `packages/money`, `packages/temporal-utils`, `@hospai/contracts`, and stdlib.
  No platform imports (Cloudflare APIs) and no entitlement client in domain code.
- **PropertyDO extraction** stays in `apps/pms-core` until a named trigger lands in this document — do not split folio/payments/reservations for speed alone.
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

**Lint rules that block merge:**
- Bookability / ARI / channel code may not import reservation list/query modules (§7.1).
  Capacity comes from the availability module only. (Do not rely on an AST pattern match for
  reservation scans — those shapes are not reliably lintable; the ledger property tests are
  the behavioural backstop.)
- `idFromName` / `getByName` are callable only from `tenant-router` (§4.5).
- No `DOMAIN`-class config read from KV or a projection (§5.1).
- No entitlement client import inside `domain/` (§5, Rule 3).
- No platform imports (`cloudflare:*`, DO runtime) inside `domain/` (Rule 11).
- `modules/pms/*` may not import `modules/addons/*`.
- No module-boundary type that is not structured-cloneable (§3).

**Supply chain (deferred):** As of 2026-09-05, `pnpm audit --audit-level high` reports **9 high** on this tree (e.g. transitive `nanoid`, `js-yaml`). A blocking CI gate is **deferred** until the audit is clean — track as follow-up; do not ship a red gate in R0.14.

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

**Identity & access — Clerk is narrow, and this is a decided question.**

Clerk answers exactly one question: *is this really who they claim to be, and did they prove
it?* Authentication, credentials, MFA, session issuance, and the OIDC/SAML handshake. Nothing
else.

**All authorization lives in OrgDO.** Organization membership, property-scoped and
property-group-scoped role assignments, and permissions contributed by module manifests. None
of it is in Clerk, and none of it is in the token.

```
session token claims:  user_id, org_id, entitlement_version, session_id
                       ...and nothing about what the user may do
```

**Why not use Clerk's Organizations feature.** It would make Clerk the source of truth for
membership while property roles stayed here — two partially-authoritative systems with no
single answer to "what can this person do?" The concrete failure: a terminated employee's
Clerk membership is revoked, but their property roles persist in OrgDO until a webhook
arrives. Webhooks are delayed, retried, and occasionally dropped. In hospitality that window
matters more than in most industries — high staff turnover, shared front-desk workstations, and
the access in question covers guest PII, payment functions, and room keys.

It also keeps §2's claim honest: the tenant→resource resolver is the most security-critical
code in the system, and it must not depend on a third party's webhook freshness.

**Consequences accepted:**

- We build invitations, member management, organization switching, and the SCIM receiver.
  This is real Phase 0 work and we own its security.
- SCIM provisioning writes to **OrgDO**, not Clerk. Enterprise provisioning does not require
  Clerk's org feature.
- `sso.saml` remains an Enterprise entitlement (§6.7); Clerk performs the SAML handshake and
  hands back an identity, and we map it to an OrgDO membership.

**Consequences gained:**

- Revoking access is **one write to OrgDO**, effective immediately. No sync, no drift, no race.
- The role model is exactly what hotels need rather than a mapping onto someone else's
  abstraction.
- Clerk stays swappable. It is an OIDC provider; replacing it touches the login flow, not
  tenancy.
- Latency is already solved: §4.3 projects permissions to version-keyed KV alongside the
  property registry and org settings.

**Standing rule: property roles never live in Clerk.** Not as metadata, not as a convenience,
not temporarily. This is the constraint that keeps authorization in one place, and it is the
one most likely to erode under delivery pressure.

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

> **The schema-freeze gate.** Four items below change PropertyDO schema, and changing them
> later is a migration across every property in the fleet (§12). They block Phase 1, and
> nothing that writes to a PropertyDO should start before they are settled:
>
> 1. **The `DOMAIN` config register** — the classified set of keys is *part of* the PropertyDO
>    schema (§5.1). Note the gate is "every key classified, `DOMAIN` complete" — not "all 89
>    settled." `OPERATIONAL` and `PRESENTATION` keys live in OrgDO/KV and can be added forever.
> 2. **The `availability_day` ledger**, including `held` reserved for future holds (§7.1).
> 3. **The `restriction_day` ledger** (§7.2).
> 4. **Folio windows** — `folio_line` keys to a window, not a reservation (§7.3).
>
> The **command catalog** is a Phase 0 item too, but for a different reason: it is a *contract*
> prerequisite, not a schema one. It determines the event surface in `packages/contracts` and
> the lane/degraded-class/idempotency annotations, and it does not block schema work.

- Monorepo + CI + boundary linting + serializable-contract enforcement + the §11 lint rules
- `kernel` module contract + manifest schema
- **Config register** derived from the prototype's 89 settings (§16.3) — classified per §5.1,
  with the `config.changed` consumer matrix. Precedes any settings screen.
- **Command catalog** derived from the prototype's ~50 `PMSContext` actions — each with a lane
  (§4.2), degraded class (§4.6), idempotency contract (§10.1), and emitted events
- Auth: Clerk for authentication only; membership, roles and permissions in OrgDO (§13)
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
- **Rebuild the prototype's screens against live APIs** (§16). The prototype is the functional
  specification; none of its implementation carries over. Rebuild screens against the Phase 0
  command catalog and classified config register (schema-freeze gate) — do not re-derive them.
- ARI projection to KV, with the staleness SLA and reject-on-commit path (§7.1)
- **Degraded mode end-to-end** (§4.6) — command classes, pending queue, replay, exception
  screen, SPA watermarks, fault-injection suite
- **Night-audit `BusinessDate` state machine** (§8) with the storage-level double-post guard
- **Multi-currency folio + payments↔folio event contract** (§7.3) — both land early in real
  deployments, and neither retrofits cleanly
- Launch-country tax model decided (constrains folio — see §7.9)
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
16. **The prototype is a specification, not a starting point.** Copy what it *does*. Copy
    nothing of how it does it. See §16.

---

## 16. The reference prototype

`hospai-pms-prototype` — a Vite/React SPA of roughly 33,500 lines over a single in-memory
reducer, built from a stakeholder meeting transcript.

**Its status: the functional specification for the PMS.** It is not a codebase to extend, and
no part of its implementation carries into the platform. Its own design specs state the
boundary plainly — *no database, no real payments, no OTA APIs, no SMS*, with backend, auth,
and Cloudflare explicitly out of scope. The design, the code structure, and the data model are
all being replaced.

That does not diminish it. A validated, clicked-through model of how hoteliers expect this
product to behave is expensive to acquire and easy to underestimate — it encodes domain
vocabulary and workflow detail that would otherwise take months of discovery. **Treat it as
the requirements artifact of record**, and treat disagreement between it and a written spec as
a question for the product owner rather than a defect in either.

### 16.1 What it establishes

| Area | Surfaces the prototype specifies |
|---|---|
| Front office | Dashboard, reservations directory, booking wizard, front-desk board, tape chart, available-rooms search |
| Inventory | Room types incl. **virtual** types, rooms, floors, OOO with date ranges, amenities |
| Rates | Rate plans with modifiers, bulk rate updates by date range and day-of-week |
| Folio | Ledger and settlement, **transaction-range routing with auto-transfer at night audit**, charge splitting, damage deposits, promo codes, manual discounts with reason, no-post flag |
| Housekeeping | Housekeeper roster with shifts/skills/capacity, task assignment, inventory, manager priorities |
| Maintenance | Work-order tickets, task types, checklists |
| Products | Sellable item catalog — categories, items, add-ons (the charge catalog folio postings reference) |
| Guests | CRM, tags, VIP, stay history, lifetime value |
| Distribution | Channel manager with sync logs, booking engine + live preview, distribution settings |
| Finance config | Gateways, terminals, AVS rules, card-brand matrix, channel routings, invoice numbering and templates |
| Guest engagement | Whistle — inbox, automations, contacts, tasks, upsell, analytics, profile (a module *group*, not a single add-on) |
| Night audit | Business-date rollover, room-charge posting, no-show processing |
| Cross-cutting | Multi-property switcher, role-based nav, audit log, 89 configuration settings |

Several of these were absent from earlier revisions of this document and were added because
the prototype surfaced them: the configuration plane (§5.1), `products` and `maintenance` as
modules (§11), virtual room types (§7.1), staff data as a distinct PII class (§4.8), and guest
engagement as a module group rather than a one-line add-on.

### 16.2 What does not carry over

Every row below is a deliberate difference, not a gap to be fixed in the prototype. Each maps
to a rule already stated in this document.

| Prototype | Platform | Rule |
|---|---|---|
| `amount: number` (float), no currency | Integer minor units + explicit currency, FX frozen at posting | §7.3, Rule 6 |
| `Reservation.guest: Guest` embedded | `guest_ref` + `pii_key_id`; profiles in OrgDO | §4.8 |
| Availability derived by scanning reservations | `availability_day` ledger, decremented in the booking transaction | §7.1 |
| `RoomType.baseRate` single value; bulk update collapses the date range | Rate derivation graph + materialized daily rates | §7.2 |
| `balanceDue` stored; `splitFolioCharge` mutates in place | Append-only folio; balance derived; corrections are reversing entries | §7.3 |
| `FolioItem.amount` negative means payment | Separate `payment.*` events from the PCI-isolated `payments` Worker | §7.3, §13 |
| No restrictions | Restrictions ledger, separate from prices | §7.2 |
| Flat 4-value `UserRole`, no property scoping | Property-scoped RBAC + entitlements + flags, independently evaluated | §1, §6 |
| No `orgId` anywhere | Tenancy threaded through every command; jurisdiction-aware routing | §2, §4.5 |
| 89 `localStorage` keys, credentials among them | Classified config plane; secrets in the payments store only | §5.1 |
| In-memory reducer, synchronous dispatch | RPC commands with idempotency keys, in DO transactions | §10.1 |
| No events | Transactional outbox → Queues → consumers | §8 |
| Single monolithic SPA (`Settings.tsx` alone is ~5,000 lines) | Modules contribute UI through the manifest; shell composes by entitlement | §9 |

### 16.3 How it is consumed

1. **Extract the config inventory first.** The 89 settings become a classified register
   (§5.1) — key, scope, class, schema, default, permission. Do this before building any
   settings screen; the classification determines storage, and storage determines correctness.
2. **Derive the command catalog.** The ~50 `PMSContext` actions are the draft list of platform
   commands. Each needs a lane (§4.2), a degraded-mode class (§4.6), an idempotency contract
   (§10.1), and its emitted events (§8).
3. **Rebuild screens against live APIs**, module by module, following Phase 1 order (§14).
   Preserve the interaction design; discard the state layer entirely. *Interaction* design —
   not visual identity, which §16.4 governs separately. Inventory, rates, and settings now
   have a live SPA against those APIs
   ([property setup SPA](docs/superpowers/specs/2026-08-13-property-setup-spa-design.md)).
   The tape chart, reservations directory, available-rooms view, and live front-office board
   now have a live SPA
   ([tape chart + live board](docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md)).
   The exception-queue operator screen now has a live SPA
   ([exception-queue workbench](docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md)).
   The guests CRM directory now has a live SPA
   ([guest CRM directory](docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md)).
4. **Keep the prototype runnable** as the behavioural reference for as long as Phase 1 lasts.
   When platform behaviour and prototype behaviour diverge, that is a product decision to
   record — in this document or the module's spec — not a bug to be silently resolved.

### 16.4 Visual identity

**Decided (2026-08-14, UI system convergence).** Three §16.4 questions are closed:

| Decision | Answer |
|---|---|
| Palette | **Keep P0-3.** Sage `#4A5D4E`, tan `#C18C5D`, cream `#F1EFE9`, `--bg #F9F8F4`, `--ink #2D2926`. No new hex. `check:web-pms-colors` remains merge-blocking. |
| Tailwind | **No, permanently.** Colour stays in `.css` so the gate keeps working; `modules/*` has no bundler for `@source` scanning. |
| `ui-kit` | **Yes — `packages/ui-kit`.** Hand-authored Tier A components (`Button`, `Field`, `Input`, `NativeSelect`, `DataTable`, …), one global `ui-kit.css`, closed API (no `className` / `style` / blanket `...rest`). Consumed by `apps/web-pms` and `modules/pms/housekeeping`. |

Visual divergence from the prototype is no longer expected: controls, tables, and panels share one system. Interaction design remains specification (§16.3); appearance is now platform-owned via tokens + ui-kit, not per-screen CSS.

**Viewport (2026-08-16, Audit Phase H).** Operator SPA targets **desktop terminals** (≥1280px effective width): fixed 16rem sidebar, no collapse, no width breakpoints. **Tablet and phone support is permanently out of scope for this SPA** (decided 2026-09-12) — housekeeping and communication ship as a **separate mobile client** (§9.1), which is where the corridor surfaces live. Do not add width breakpoints to `web-pms` to serve them.

Enforcement: `hospai/no-raw-controls-in-web-pms` (error), `check:ui-kit-adoption` ratchet (floor 0), dev-only `/dev/ui` gallery outside `AppShell`. Storybook deferred.

> **Page shell (2026-08-16).** Every operational SPA screen renders `PageHeader` (page `<h1>`) and at least one `Card` from `@hospai/ui-kit`; section titles use `CardTitle` (`<h2>`). Merge-blocking gate: `pnpm check:spa-page-chrome`. Does not reopen palette, Tailwind, or ui-kit package decisions.

Spec: `docs/superpowers/specs/2026-08-13-ui-system-convergence-design.md`.

### 16.5 Prototype coverage audit (2026-08-12)

A full pass of `hospai-pms-prototype` against this document, the command catalog, and the
classified config register. **Verdict:** nothing at module level is missing. §16.1 names every
prototype product area. Phase 1 rebuilds the core PMS screens; channel manager, booking engine,
and group blocks are Phase 2; yield, Whistle, marketplace, and POS are Phase 3. That is
sequencing, not a miss.

Disagreement between the prototype and this document is a product decision to record here
(§16.3 rule 4). The tables below are that record.

#### Already specified — do not re-derive

These were easy to treat as gaps because they are not yet shipped. They are in this document
and must not be redesigned from the prototype.

| Surface | Where | Note |
|---|---|---|
| Inquiry / pending / confirmed lifecycle | §7.4 | Architecture is *stricter* than the prototype (adds `PENDING`). |
| Damage deposits, promo codes, manual discounts with reason, no-post | §16.1 folio | Promo also sits on the §7.2 derivation graph. **Shipped:** money-ops extras in [folio money operations](docs/superpowers/specs/2026-08-12-folio-money-operations-design.md); promo codes 2026-08-15 ([promo codes](docs/superpowers/specs/2026-08-15-promo-codes-design.md)). |
| OOO with date ranges | §7.1 | Per-room range → `blocked` ledger delta; fail-closed if assigned; opens a `maintenance` work order. |
| Virtual room types | §7.1 | No independent `physical` count; sale decrements constituents. |
| Folio windows, routing, split, night-audit auto-transfer | §7.3 | Prototype mutates in place; platform is reverse + two postings. |
| Group blocks and allotments | §7.4, Phase 2 | Own aggregate, not a reservation flag. |
| City ledger / direct bill | §7.3 | Distinct from guest folios. **Shipped 2026-08-15** ([city ledger / AR](docs/superpowers/specs/2026-08-15-city-ledger-ar-design.md)): own aggregate, append-only entry ledger, derived aging, R2 statements. |
| Products, maintenance, reporting, guests CRM (tags, VIP, LTV) | §11, §16.1 | LTV trends are warehouse (§7.8). |
| Invoice numbering and templates | §16.1 finance | Invoices live in R2 (§4.7). **Generation engine shipped 2026-08-15** ([invoice generation](docs/superpowers/specs/2026-08-15-invoice-generation-engine-design.md)), with the checkout precondition gate. |
| Tape chart / front-desk board | §7.7 | Operational reads over hibernating WebSockets, not a short-TTL projection. |
| 89 configuration settings | §5.1 | Classified register; secrets never in config. |
| Whistle (inbox, automations, contacts, tasks, upsell, analytics) | §11 guest-engagement, Phase 3 | A module *group*, not a single add-on. |
| Channel manager, booking engine + live preview | §14 Phase 2, entitlements in §6 | Gated add-ons. |
| Yield / competitor / forecast tabs on Rates | §7.8 / §14 Phase 3 | Today's occupancy forecast is OLTP; the yield engine is revenue-management. |

**Architecture-vs-code drift — restored 2026-08-12.** §7.4 specifies

```
INQUIRY → PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT
                 ↘ CANCELLED   ↘ NO_SHOW
```

The shipped reservation status machine matches that diagram (`inquiry | pending | confirmed |
cancelled | checked_in | checked_out | no_show`). The 2026-08-12 reservation-lifecycle chunk
restored `INQUIRY` and `PENDING`; this paragraph is no longer a disagreement.

`rooms.set_ooo_range` (§7.1), `folio.transfer_charge` and `folio.split_charge` (§7.3)
shipped; `PLATFORM_GAPS` is empty. They are not build debt. (The split commands were collapsed
to a single `folio.split_charge` on 2026-08-15 — `split_charge_v2` and `split_charge_payment`
are retired; see [split command collapse](docs/superpowers/specs/2026-08-15-split-command-collapse-design.md).)

#### Still unnamed — product must decide keep, defer, or drop

Prototype behaviour with **no section, table row, or rule** in this document. Closest related
text is listed so these are not over-counted. Decisions below are closed by
[prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md)
(2026-08-13); this table is a decision record, not an open punch list.

| Prototype behaviour | Closest text | Decision owed |
|---|---|---|
| **DND** as a room status | Room status / housekeeping board (§4.6, §7.7, §16.1). Status *values* are never listed. | **DROP as `room.status`. KEEP as stay flag `dnd_flag`.** Recorded in [prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §1.2 / §3. |
| **Additional guests / adults / children** on a stay | Guest profiles in OrgDO (§4.8). Occupancy is room-type inventory (§7.1). | **KEEP** (2026-08-12). Remainder (check-in / modify enforce; wizard collects) closed in [prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §4. |
| **Fixed / recurring charges** (nightly parking, breakfast, spa) | `breakfast_rule` as DOMAIN auto-posting (§5.1). Night audit `POST_ROOM_CHARGES` (§8). | **DEFER.** Named leftover 1 in [prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md); not Phase 1. |
| **Registration card print** | Never print a folio or invoice in `DEGRADED` (§4.6). Guest *registration reporting* is fiscal (§7.9). | **KEEP** as a front-desk printable *view* ([prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §5). Not R2, not a night-audit step. |
| **HK budgeting, metrics dashboards, mobile attendant** | §16.1 HK: roster, assignment, inventory, manager priorities. | **DROP from Phase 1.** [Prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §1.2. |
| **Global reservation search** (name, res id, confirmation) | Available-rooms search (§16.1). Guest lookup is `READ_STALE` (§4.6). | **KEEP** (shell). [Prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §7. `reservation_id` is the confirmation. |
| **Front-office comments** as a per-stay field, distinct from guest notes | `notes` are `QUEUE_PROVISIONAL` (§4.6). | **KEEP** (2026-08-12). SPA editor remainder closed in [prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §6. |
| **Room-type photos, door-lock flag, maxAdults vs maxOccupancy** | Amenities and floors (§16.1). Property images on R2 (§4.7). | **Occupancy split: done. Photos: DEFER. Keyless: DROP.** [Prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §1.2. |
| **Rate-plan cancellation policy text and inclusions** | Cancellations with penalty are `FAIL_CLOSED` (§4.6). Rate plans have modifiers (§16.1). | **Penalty snapshot: done. Inclusions: DEFER.** [Prototype holes sweep](docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md) §1.2. |
| **Plan-scoped restrictions** (min/max stay, CTA/CTD per rate plan) | §7.2 allows plan-specific rows ("the tightest constraint wins"); Phase 1 writes omit `ratePlanId` (type-wide `'*'`). | **Type-wide stays — not Phase 1** (2026-08-15). Scoped out of the rate-plans, property-setup SPA, derived-plans, booking plan-picker, and promo specs; revisit with the channel-manager phase. |

#### Deliberate differences (not gaps)

Already implied by earlier sections; recorded here so a later pass does not "fix" them.

| Prototype | This document | Section |
|---|---|---|
| Assign room before check-in; `waitingForRoom` flag | Room-type inventory; pre-assign allowed, **check-in requires a resolved room** | §7.1 |
| `inquiry` → `confirmed` (no pending) | `INQUIRY` → `PENDING` → `CONFIRMED` | §7.4 |
| Staff room blocks as zero-rate reservations | `held` column reserved; hold *behaviour* is Phase 3 | §7.1, §7.6 |
| Yield / competitor scraper / forecast-and-overbook on the Rates screen | Today's occupancy forecast is OLTP; revenue-management is Phase 3 | §7.8, §14 |
| Opera "Sync Query", role impersonation, hardcoded Spaces cards, competitor-refresh timeouts | Demo theater. Copy the workflow, not the fake connectors. | §16.2 spirit |
| Guest substring search in the booking wizard | No discovery path until a blind index exists; create-default + `guestRef` context | recorded in the booking-wizard spec, not this file |

`waitingForRoom` is the one that looks like an unnamed gap and is not. §7.1 already chose
type-level inventory with optional pre-assign. Pre-assign is allowed; check-in without a
resolved room is rejected unless `pms.ops.auto_assign_rooms` is on, in which case `tryCheckIn` may auto-pick the lowest eligible physical room of the booked type. Parking arrivals as "waiting" without a room is a different product.

#### What "rebuild the prototype's screens" still means

§14 Phase 1 says rebuild the prototype screens against live APIs. Combined with this audit:

- **Phase 1** must include every §16.1 core-PMS surface (dashboard, reservations, booking
  wizard, front-desk board, tape chart, available-rooms, inventory, rates matrix, folio,
  housekeeping core, guests, night audit, settings) **plus** a recorded decision on every row
  in "Still unnamed" above — keep, defer, or drop — before that vertical ships.
- **§16.1 folio extras** (no-post, damage deposits, promo, manual discounts) were designed in
  [folio money operations](docs/superpowers/specs/2026-08-12-folio-money-operations-design.md)
  and shipped, promo codes last on 2026-08-15. This bullet is closed.
- **`INQUIRY` / `PENDING` restored 2026-08-12.** The shipped machine matches §7.4.
