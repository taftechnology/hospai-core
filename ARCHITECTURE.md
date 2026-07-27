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

---

## 1. The three planes

The single most important structural decision. Most teams conflate these and end up with an
unmaintainable `if (customer.plan === 'pro')` mess scattered through the domain.

| Plane | Question it answers | Owner | Changes | Storage |
|---|---|---|---|---|
| **Entitlements** | *Has this tenant bought it?* | Billing / Revenue | On contract change | Platform D1, audited, billing-linked |
| **Permissions (RBAC/ABAC)** | *May this user do it?* | Security | On role change | Org D1, per user+property |
| **Feature flags** | *Is this code path live?* | Engineering | Continuously, per deploy | KV, ephemeral |

A gated feature must pass **all three** independently:

```
tenant is entitled  AND  user is permitted  AND  release flag is on
```

Never let a release flag substitute for an entitlement, and never let an entitlement grant
permission. Three systems, three lifecycles, three audiences.

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
| Property operational data | PropertyDO (SQLite, 1 per property) | Physically separate — no cross-property query possible |
| Organization data | Org D1 (1 per org) | Separate database per customer |
| Platform control plane | Platform D1 (single, global) | Shared, small, read-heavy |

Same codebase for all tiers. Tier is a provisioning concern (jurisdiction, location hint),
resolved by the **tenant-router** package.

**The inverted failure mode:** With RLS, a routing bug leaks a row. Here, a routing bug hands
over an entire tenant's database. The tenant→resource resolver must be **small, audited,
exhaustively tested, and changed rarely.** Treat it as the most security-critical code in the
system.

---

## 3. Compute topology

```
                    ┌─────────────────────────────────────────────┐
   Internet ───────▶│  edge Worker  (routes, authn, tenant         │
                    │  resolution, entitlement gate, rate limit,   │
                    │  idempotency)                                │
                    └────────────────┬────────────────────────────┘
                                     │ Service Bindings (RPC, same-machine)
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
         pms-core              payments              booking-engine
         (Worker)              (Worker)               (Worker)
              │
              │ DO stubs / D1 / KV / R2 / Queues / Workflows
              ▼
   ┌──────────────────┐  ┌───────────────┐  ┌──────────────┐
   │ PropertyDO       │  │ Org D1        │  │ Platform D1  │
   │ (SQLite, 1/hotel)│  │ (1/org)       │  │ (control)    │
   └──────────────────┘  └───────────────┘  └──────────────┘
```

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

### Compute limits that bind

| Limit | Value (Paid) | Architectural consequence |
|---|---|---|
| Worker size | 10 MB gzipped | Forcing function for splitting fat Workers |
| Memory | 128 MB | No in-memory report building; stream or offload |
| CPU time | 5 min max | Fine for OLTP; PDFs/exports go to Containers or Workers AI |
| Subrequests | 10,000/request (up to 10M) | Generous; channel fan-out is fine |
| Simultaneous outgoing connections | 6 waiting for headers | Batch channel-manager fan-out through Queues |
| DO alarm wall time | 15 minutes | Night audit alarm starts a Workflow, never runs inline |
| Workflow step wall time | Unlimited (CPU-limited) | Correct home for night audit, reconciliation, dunning |
| Cron triggers | 250/account | Not enough for per-property scheduling — use DO alarms |

---

## 4. Storage topology

### PropertyDO — SQLite, one per property — *the transactional system of record*

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async book(cmd: BookCommand): Promise<Reservation> {
    const nights = enumerateNights(cmd.arrival, cmd.departure);

    // All reads + writes are synchronous within the DO — no race possible.
    for (const night of nights) {
      const row = this.sql.exec(
        `SELECT physical - blocked - sold + oversell AS free
           FROM availability_day WHERE room_type_id=? AND stay_date=?`,
        cmd.roomTypeId, night,
      ).one();
      if (row.free < cmd.units) throw new NoAvailability(night);
    }

    // Availability, reservation, folio seed, and outbox — one atomic write.
    this.sql.exec('BEGIN');
    this.sql.exec(
      `UPDATE availability_day SET sold = sold + ?
       WHERE room_type_id=? AND stay_date IN (${ph(nights)})`,
      cmd.units, cmd.roomTypeId, ...nights,
    );
    const res = this.insertReservation(cmd);
    this.appendOutbox(ReservationCreated.from(res));
    this.sql.exec('COMMIT');

    this.ctx.waitUntil(this.flushOutbox());
    return res;
  }

  // Durable outbox sweeper — alarm-driven, runs every 30s if rows remain unacked.
  async alarm() {
    const pending = this.sql.exec(
      `SELECT * FROM outbox WHERE acked = 0 ORDER BY seq LIMIT 100`
    ).toArray();
    if (pending.length > 0) {
      await this.env.EVENTS_QUEUE.sendBatch(pending.map(toMessage));
      this.sql.exec(
        `UPDATE outbox SET acked = 1 WHERE seq IN (${pending.map(r => r.seq).join(',')})`,
      );
    }
    // Re-arm if more pending, or if night-audit is due.
    const nextAlarm = this.computeNextAlarm();
    if (nextAlarm) await this.ctx.storage.setAlarm(nextAlarm);
  }
}
```

**Sizing:** A 200-room property generating ~30k reservations/year with folio detail sits in
the low hundreds of MB/year. The 10GB ceiling is years away.

**Archival rule:** After a fiscal year closes and night-audit confirms, project closed folios
and checked-out reservations to R2/Iceberg. The PropertyDO holds only the current year + open
stays. This keeps the DO fast and the warehouse queryable.

### D1 — relational, read-heavy, cross-property

**Org D1 (one per organization):** users, role assignments, guest profiles, rate plan
*definitions*, property registry, org settings, audit log. Read constantly, written rarely.
Use **Sessions API** with bookmarks for sequential consistency.

**Platform D1 (single, global):** organizations, plans, features, add-ons, subscriptions,
entitlement overrides, tenant→resource routing map.

### KV, R2, and the analytics tier

| Store | Use | Why |
|---|---|---|
| **KV** | Entitlement snapshots (version-keyed), JWKS, ARI cache, static config | Read-optimized, globally distributed |
| **R2** | Invoices, exports, ID documents, property images, **durable event log** | Zero egress; replay source |
| **Pipelines → R2 Data Catalog (Iceberg)** | Warehouse — every domain event, queryable by R2 SQL / DuckDB | Replaces Debezium→BigQuery |
| **Analytics Engine** | Soft meters, per-tenant usage telemetry | Write-heavy, tenant-tagged time series |
| **Hyperdrive → external Postgres** | **Escape hatch only** — enterprise contracts demanding own DB | Never load-bearing for core PMS |

### Admin & support read access

Cross-tenant queries are impossible against DOs/D1s directly. Two paths:

1. **Iceberg warehouse** — for fleet analytics, cohort reports, ops dashboards (seconds-old).
2. **Privileged direct DO/D1 read path** — for CS resolving a specific tenant's issue in real
   time. Audited, rate-limited, accessible only via internal admin console behind Cloudflare
   Access. Never exposed to customer-facing APIs.

---

## 5. Module anatomy

Every module — core, PMS, or add-on — has the identical shape:

```
modules/pms/reservations/
├── module.manifest.ts        # declarative contract
├── src/
│   ├── domain/               # entities, value objects, invariants. Zero I/O, zero platform imports.
│   ├── application/          # use cases (commands/queries), ports (interfaces it needs)
│   ├── infrastructure/       # repositories, adapters implementing ports (DO/D1/KV calls here)
│   ├── api/                  # RPC entrypoints, DTOs
│   ├── events/               # published/ + subscribed/
│   ├── jobs/                 # Queue consumers, Workflow steps
│   ├── ui/                   # frontend surfaces this module contributes
│   └── index.ts              # ← THE ONLY EXPORT SURFACE
├── migrations/               # namespaced (e.g. res_reservation, res_assignment)
└── tests/
```

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
RPC when extracted. The consumer's code does not change.

**Asynchronous — domain events via transactional outbox.** Every mutation writes to the outbox
in the same SQLite transaction. The DO alarm sweeper delivers to Queues. Consumers are
idempotent by `event_id`.

Event payloads are **versioned contracts in `packages/contracts`**. Adding a field is safe;
removing or retyping requires a new version in parallel until consumers migrate.

---

## 6. The entitlement plane

### Data model (Platform D1)

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

### Resolution

```
1. Plan features                  (base grant)
2. + Add-on features              (union; for LIMIT type take MAX)
3. + Trial grants                 (time-boxed, auto-expire)
4. + Tenant overrides             (sales concessions — always audited)
5. − Global kill-switch           (ops override for incidents)
6. − Delinquency policy           (past-due → read-only, not blackout)
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

### Distribution — version-keyed KV

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

### Enforcement — four layers

```ts
// 1. Edge Worker — route table carries required entitlement; 402 before any module runs.

// 2. Module RPC — every entrypoint method re-checks.
class ChannelService extends WorkerEntrypoint<Env> {
  async createMapping(ctx: Ctx, cmd: CreateMapping) {
    ctx.entitlements.require('channel_manager.enabled');
    // ...
  }
}

// 3. Domain — inside the DO, for alarms, Queue consumers, Workflows.

// 4. UI — UX only. Entitled-but-unbought → disabled with upgrade CTA. Irrelevant → hidden.
```

### Limits and metering

| Behavior | Use case | Enforcement |
|---|---|---|
| `hard` | OTA connections, users | OrgEntitlementDO counter — reject at limit |
| `soft` | Emails, API calls | Analytics Engine → billing rollup |
| `grace` | Unit count after expansion | Allow overage + notify; never block a booking |

### Package composition example

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

---

## 7. PMS domain — the parts that are genuinely hard

### 7.1 Availability (ARI) and oversell control

The highest-contention resource. PropertyDO serialization eliminates races structurally.

Rules:
- Availability decrements in the **same transaction** as the reservation write.
- **Room-type level, not room level.** Assignment happens at check-in.
- A separate denormalized **ARI projection** (KV) serves the booking engine and channel pushes.
  Stale reads there are fine; the DO is the arbiter.

### 7.2 Rates

Rate plans compose: `base rate → derived (−15% of BAR) → seasonal override → LOS discount → promo`.
Model the **derivation graph**, not the materialized matrix.

Restrictions (MinLOS, MaxLOS, CTA, CTD, stop-sell) are a **separate ledger** from prices.

Rate plan *definitions* live in Org D1 (cross-property, rarely written). Materialized daily
rates live in PropertyDO (per-property, frequently read). The projection from definition →
materialized rates is triggered by `rate_plan.changed` events and runs as a Workflow step.

### 7.3 Money, folio, and the night audit

- **Never floats.** Integer minor units + explicit currency. `packages/money` owns rounding.
- The folio is an **append-only ledger.** Corrections are reversing entries, not updates.
- **Night audit** is a per-property Workflow (DO alarm triggers it). Idempotent, resumable.
- **Tax engine** is its own concern behind an interface. Rules are political and change without notice.
- **Folio archival:** live stay + current fiscal year in PropertyDO. Closed years projected to
  R2/Iceberg for reporting and long-term retrieval.

### 7.4 Reservation lifecycle

```
INQUIRY → PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT
                 ↘ CANCELLED   ↘ NO_SHOW
```

Every transition emits a domain event and writes an audit record. Reservations are long-lived,
high-value, and constantly disputed.

### 7.5 Time

Hospitality time ≠ wall-clock time. First-class types in `packages/temporal-utils`:
- `StayDate` — calendar date in property timezone, not an instant
- `BusinessDate` — what the night audit rolls
- `Nights` — half-open date range

A `Date` object crossing a module boundary is a bug waiting for a DST transition.

---

## 8. Events, scheduling, and workflows

### Night audit: DO alarm → Workflow

Each PropertyDO schedules its own alarm for its next business-date rollover:

```ts
// Inside PropertyDO alarm handler
async alarm() {
  await this.flushOutbox();  // always attempt outbox drain first
  if (this.isNightAuditDue()) {
    await this.env.NIGHT_AUDIT_WORKFLOW.create({ params: { propertyId: this.id } });
  }
  await this.ctx.storage.setAlarm(this.nextAlarmAt());
}
```

The Workflow does the real work — post room charges, no-show processing, roll business date,
close-out reports — with durable execution and resumability.

### Events: outbox → Queues → consumers, with R2 as the log

- **Outbox** lives in PropertyDO SQLite. Written atomically with domain mutations.
- **DO alarm sweeper** flushes unacked outbox rows to Queues (at-least-once).
- **Queues** delivers to consumers with batching, retries, and DLQ.
- **Pipelines → R2/Iceberg** stores every event durably for replay and analytics.
- Consumers are **idempotent by `event_id`**. Set `max_concurrency` on consumers writing back
  to DOs to prevent stampeding a single property.

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

---

## 10. Public API and marketplace

- **REST + OpenAPI 3.1**, generated from `packages/contracts`.
- **Date-based versioning** (`2026-07-26`) pinned per API key.
- **Webhooks:** signed (HMAC + timestamp), retried, replayable from a dead-letter UI.
- **Idempotency keys** required on every mutating endpoint.
- **Rate limits** are an entitlement (`api.rate_limit_rpm`), enforced at the edge.
- **OAuth2 apps** with granular scopes, installed per property, revocable.

**Workers for Platforms (Phase 3+):** third-party developers deploy sandboxed code that runs
inside the platform. Dispatch namespace, outbound controls, per-app bindings. This is a
category-defining feature — but ship OAuth + public API first. WfP is the moat, not the MVP.

---

## 11. Repository layout

```
hospai-pms/
├── apps/
│   ├── edge/                        wrangler.jsonc — routes, authn, tenant resolution
│   ├── pms-core/                    PropertyDO + OrgEntitlementDO + core PMS modules
│   ├── payments/                    isolated bindings → PCI scope containment
│   ├── booking-engine/              Workers + Static Assets, SSR
│   ├── workflows/                   night audit, activation, reconciliation, dunning
│   ├── web-pms/                     operator SPA (React + Vite)
│   └── web-admin/                   internal console (behind Cloudflare Access)
│
├── modules/
│   ├── core/{tenancy, identity, entitlements, notifications, audit}
│   ├── pms/{inventory, availability, rates, reservations, folio, guests, frontdesk, housekeeping, nightaudit}
│   └── addons/{channel-manager, booking-engine, revenue-management, pos, guest-engagement, ...}
│
├── packages/
│   ├── kernel/                      module contract, registry, RPC entrypoint base
│   ├── contracts/                   versioned event + API schemas (zod → OpenAPI)
│   ├── do-runtime/                  DO base class, SQLite migration runner, outbox
│   ├── d1-runtime/                  Sessions API + bookmarks, migration runner
│   ├── tenant-router/               ★ tenant → DO id / D1 binding / jurisdiction
│   ├── entitlement-client/          version-keyed KV snapshot, guards, meters
│   ├── money/                       currency, rounding, allocation, tax primitives
│   ├── temporal-utils/              StayDate, BusinessDate, Nights, timezone math
│   ├── observability/               tracing, structured logs, tenant-tagged metrics
│   ├── ui-kit/                      design system
│   ├── ui-shell/                    nav registry, slot system, entitlement-aware routing
│   └── sdk/                         generated public API client (TypeScript)
│
├── migrations/{do, d1-org, d1-platform}/
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
  No platform imports (Cloudflare APIs) in domain code.

**Local dev:** `wrangler dev` with `remote: true` bindings. `@cloudflare/vitest-pool-workers`
for tests with isolated DO storage per test and `runDurableObjectAlarm()`.

---

## 12. Where Cloudflare fights you

| Challenge | Mitigation |
|---|---|
| **Migration fan-out** — thousands of DOs, hundreds of D1s, each with own schema | Lazy migration in DO constructor + Workflow sweeper. Expand/contract mandatory. Budget this as real work. |
| **Cross-tenant queries impossible** | Iceberg warehouse for fleet ops + privileged direct read path for CS |
| **D1 jurisdiction immutable** | Decide at provisioning time. Default conservatively. Changing = full tenant migration. |
| **Routing bug = full tenant exposure** | Tenant-router is small, audited, exhaustively tested, rarely changed |
| **Per-tenant backup/restore** | DO has PITR, D1 has Time Travel — but product-level restore tooling is yours to build |
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

**Audit log.** Append-only, tenant-partitioned, retention as an entitlement. Written from the
domain layer via events.

**Observability.** Every span, log, and metric tagged with `org_id`, `property_id`, `module_id`.
OpenTelemetry → Baselime/Axiom.

---

## 14. Build order

### Phase 0 — Foundation (the parts you cannot retrofit)

- Monorepo + CI + boundary linting
- `kernel` module contract + manifest schema
- Auth with organizations (Clerk or custom)
- Platform D1 schema: orgs, plans, features, subscriptions
- Tenant-router + PropertyDO skeleton + Org D1 skeleton
- Entitlement plane end-to-end (even with two hardcoded plans)
- Outbox + Queues event bus
- Migration orchestrator (Workflow)
- Observability (tenant-tagged from day one)

Ship `pms.inventory` through the whole stack to prove the contract.

### Phase 1 — Core PMS (sellable)

Inventory → availability → rates → reservations → folio → front desk → housekeeping → night audit.
Each depends on the previous.

- Property-scoped RBAC
- Audit log on money/inventory mutations
- Migrate prototype screens onto live APIs
- ARI projection to KV for the booking engine

### Phase 2 — First add-on (mechanism proof)

Build the channel manager as a strictly gated module with zero special cases. If it needs a
hack, fix the mechanism, not the module.

- Outbox consumers + Queue workers
- OTA integration (start with 2–3 channels)
- Booking engine with direct booking

### Phase 3 — Commercial scale

- Self-serve plan changes + Stripe billing
- Usage billing for metered add-ons
- Marketplace OAuth + webhooks + public API
- Revenue management
- Guest engagement / messaging
- Workers for Platforms (partner sandbox)

---

## 15. The rules that keep it enterprise-grade

1. **A module's public surface is its `index.ts`.** Enforced by lint, in CI, blocking merge.
2. **Core never imports add-ons.** One-directional dependency, always.
3. **Entitlement checks live in the domain layer.** The edge is an optimization.
4. **Deactivation never destroys data.** Only retention-driven purge does.
5. **Every mutation is an event.** Audit, integrations, and reporting derive from that stream.
6. **Money is integers; time is typed.** No floats, no naked `Date` across boundaries.
7. **Inventory is transactional.** PropertyDO serialization guarantees this structurally.
8. **Tenant-tag every telemetry signal.** Per-customer health, or you are debugging blind.
9. **Your add-ons use the public API.** No private backdoors for first-party code.
10. **Adding a new gated feature = a module + a data row.** If it needs a schema migration to sell, the gating plane is wrong.
11. **Domain code has zero platform imports.** Cloudflare-specific code lives in `infrastructure/` only.
12. **The tenant-router is the most security-critical code.** Treat it accordingly.
