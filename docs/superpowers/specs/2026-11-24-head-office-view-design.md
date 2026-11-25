# R7.4 Head-office view — today across the hotels

**Date:** 2026-11-24
**Status:** Accepted 2026-11-24 (owner); built the same day
**Roadmap:** [R7.4](../../roadmap.md) (Track G, Part C). Locks are the roadmap's; this spec fills in the mechanism.
**Sources:** `ARCHITECTURE.md` §7.6, §7.8; [outbox consumers](./2026-11-19-outbox-consumers-design.md) (R4.5); [runtime tenant selection](./2026-11-23-runtime-tenant-selection-design.md) (R4.4); [alerts](./2026-11-22-alerts-paging-log-retention-design.md) (R7.2, `readOpsHealth`); Manager Report day stats (R4.32, `night_audit_day_stats`).
**G-Q3:** the client has not said what the owner wants each morning. v1 ships the rows the roadmap locks (§3). The answer may add or drop columns later; it does not change the mechanism.

## 1. What it is

One screen in the hotel app, **Hotels today**, for the owner of a group: one row per hotel with last night's close and today's expected movement, plus whether each hotel's night audit finished. It reads one org-level projection that each hotel feeds after its own night audit. It never reads across hotels on a request (§7.6), and it is not a trend report (§7.8).

## 2. Data flow

```
PropertyDO night audit ── night_audit.started / .completed / .halted / .halt_resolved ──▶ outbox
   queue consumer `pms.head_office_projection`
      1. PropertyDO.readHeadOfficeRow()        (one DO: the event's own hotel)
      2. OrgDO.tryUpsertHeadOfficeRow(row, consumerIdempotencyKey)
GET /v1/orgs/:orgId/head-office ──▶ OrgDO.readHeadOfficeRows(userId) ──▶ Hotels today
```

### 2.1 Trigger events

- Existing: `night_audit.started`, `night_audit.completed`, `night_audit.halt_resolved` (payload `{ propertyId, businessDate }`).
- **New: `night_audit.halted`** `{ propertyId, businessDate, step }`, appended to the outbox inside the same Txn C that writes `status = 'FAILED'` (`property-do.ts`, the step catch). A step that fails again on retry emits it again; the consumer reads state, so repeats are harmless. The event carries no error text (the error can name guests or amounts, R7.2 §5.1).
- Events are triggers, not state (outbox spec §4 rule 2). The consumer always reads the hotel's current state in step 1.

### 2.2 `PropertyDO.readHeadOfficeRow()` — read-only RPC

Returns, in one read with no writes:

| Field | Source |
|---|---|
| `propertyId`, `propertyName` | property registry / config |
| `businessDate` | the open business date |
| `audit.state` | `halted` if any `night_audit_run` row is FAILED for the open date (`isNightAuditHalted`), `running` if a run for it has started and not completed, else `idle` |
| `audit.failedStep` | the FAILED step or null |
| `audit.lastCompletedDate`, `audit.lastCompletedAt` | latest completed run |
| `closed` | the `night_audit_day_stats` row for the **last completed** business date: `businessDate`, `currency`, `roomRevenueMinor` (`room_revenue_minor`), `roomsSold` (`sold`), `roomsSellable` (the Manager Report's available-rooms base: `physical`, minus `blocked` when the hotel's occupancy setting excludes out-of-order rooms; `manager-report.ts` computes it, so extract and reuse that rather than restating it). Null if the hotel has never completed an audit or that day's stats row is missing (a stats write failure does not stop the audit) |
| `today` | `readFrontOfficeSummary(businessDate)`: `arrivals`, `departuresDue`, `inHouse` |
| `stateVersion` | a monotonic number for this hotel's state, read **before** the other fields: the outbox `AUTOINCREMENT` counter (`sqlite_sequence`), falling back to `MAX(seq)` |

Counts, dates, one money figure and a currency code. No guest names, ids, folio rows or error text.

### 2.3 Consumer `pms.head_office_projection`

- Declared in `CORE_CONSUMERS` (`apps/pms-core/src/event-consumers.ts`), handler in `CONSUMER_HANDLERS`. Events: the four above. Entitlement: **`pms.core`**, so every org keeps a current row and enabling `pms.multi_property` later needs no catch-up (skipped events are never replayed, outbox spec §5). Not `gateExempt`.
- Handler: resolve the PropertyDO from `ctx.propertyId`, call `readHeadOfficeRow()`, then `resolveOrgStub(env.ORG_DO, { orgId: ctx.orgId })` and `tryUpsertHeadOfficeRow({ row, consumerIdempotencyKey: ctx.idempotencyKey })`. Finishes well inside 15 s: two DO calls.
- An event for a property whose registry org differs from `ctx.orgId` never happens by construction (the router derives `orgId` from the registry); the OrgDO method still rejects a row whose `propertyId` is not in its `property_ref`.

### 2.4 OrgDO table `head_office_row` (ORG migration v15)

```
head_office_row (
  property_id          TEXT PRIMARY KEY,   -- must exist in property_ref
  property_name        TEXT NOT NULL,
  business_date        TEXT NOT NULL,
  audit_state          TEXT NOT NULL CHECK (audit_state IN ('idle','running','halted')),
  audit_failed_step    TEXT,
  last_completed_date  TEXT,
  last_completed_at    INTEGER,
  closed_date          TEXT,
  currency             TEXT,
  room_revenue_minor   INTEGER,
  rooms_sold           INTEGER,
  rooms_sellable       INTEGER,
  arrivals             INTEGER NOT NULL,
  departures_due       INTEGER NOT NULL,
  in_house             INTEGER NOT NULL,
  state_version        INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
)
```

- `tryUpsertHeadOfficeRow` runs `transactionSync(() => runIdempotent(...))` with the consumer key and a fingerprint of `{ propertyId }` only: the row is read live, so fingerprinting it would turn a redelivery after a later change into `IDEM_KEY_REUSED` and a dead letter (same reasoning as `trySetIdDocumentFlag`). Actor `{ kind: 'system', reason: 'event_consumer' }`.
- **Ordering:** it writes only when `stateVersion` is greater than the stored `state_version`. An older read that finishes late is a no-op, not an overwrite.
- **Purge:** the table joins the OrgDO purge inventory and its count query (`org-do.ts`), and `check:purge` must stay green. It holds no PII, but org purge wipes it like every other org table.
- SQL mirror in `migrations/do-org/0015_head_office_row.sql`; `ORG_SCHEMA_HEAD` 14 → **15**.

## 3. The view

### 3.1 Route

`get_org_head_office` — `GET /v1/orgs/:orgId/head-office`, scope `org`, permission **`org:manage`** (owner and admin; `org:read` also goes to staff, and this shows revenue), entitlement **`pms.multi_property`**. Read-only, so a suspended org keeps it (`readIntent` not needed for GET). Kill-switch: `kill:pms.multi_property` turns it off like any entitled route.

- Uses `resolveTenant` for the URL org; no body.
- **Property-scoped rows:** returns only hotels the caller can access (`listAccessiblePropertiesFor(userId)`, the same rule as R4.4's `get_me_tenants`). `org:manage` needs an org `member` row, and org members can open every active hotel, so today an owner or admin sees all of them; a user with hotel-only grants is refused at the gate (`not_member`). The filter is kept so a future org role scoped to some hotels cannot see the others. *(Corrected 2026-11-24 during the build.)*
- Response:

```ts
type HeadOfficeResponse = {
  orgId: string;
  rows: Array<{
    propertyId: string; propertyName: string; businessDate: string;
    audit: { state: 'idle' | 'running' | 'halted'; failedStep: string | null;
             lastCompletedDate: string | null; lastCompletedAt: number | null };
    closed: null | { businessDate: string; currency: string; roomRevenueMinor: number;
                     roomsSold: number; roomsSellable: number };
    today: { arrivals: number; departuresDue: number; inHouse: number };
    updatedAt: number;
  }>;
  missing: string[];   // accessible hotels with no row yet (never audited since this shipped)
  total: null | { currency: string; roomRevenueMinor: number; roomsSold: number; roomsSellable: number };
};
```

- `total` is present only when every row has a `closed` block in the **same currency** and the same `closed.businessDate`, and no accessible hotel is `missing`; otherwise null, so a partial sum never looks like the group total. Integer sums only.

### 3.2 Screen (web-pms)

- Route `/hotels-today`, nav entry **Hotels today**, shown when the org has `pms.multi_property` and the user has `org:manage`. `NavEntry` gains an `orgPermission` field checked with the existing `hasOrgPermission`.
- `PageHeader` title "Hotels today", subtitle the org's name. Single `<h1>`.
- `DataTable` columns: Hotel · Business date · Night audit · Last night occupancy (sold / sellable and %) · Last night room revenue · Arrivals · Departures · In house · Updated.
  - Night audit column: a `Badge` with the word always shown — "Completed <date>", "Running", "Halted at <step>" (exception rung), "Not run yet".
  - Money via the existing money formatter with the row's currency.
  - A total row when `total` is present.
  - `missing` hotels listed below the table: "No summary yet. It appears after this hotel's next night audit."
- Query key `['org-head-office', orgId]`; default `staleTime`. No mutation, so no invalidation. A note under the header: "Updated after each hotel's night audit. Today's counts are as of that time, not live."
- States: loading (`Skeleton`), error (`classifiedUserMessage` in an `Alert`), empty (no accessible hotels with rows and none missing: "No hotels yet").
- Desktop and phone widths: the table scrolls inside its container as other tables do.

## 4. Scope out

The rest of R5.7 (availability projection, central reservations, Stage B), trends (warehouse), central rates, shared staff (G-Q4), live intra-day refresh, a refresh button (it would fan out), drill-down beyond the existing property switcher, email or push of the morning summary.

## 5. Tests

- **pms-core (characterization first):**
  - After hotel A's night audit completes, A's row has the closed day's revenue, sold and sellable from `night_audit_day_stats` and today's arrivals/departures/in-house; B's row is unchanged.
  - A failed step emits `night_audit.halted` with no error text; the row shows `halted` and the step; `halt_resolved` then completion clears it.
  - Two properties in one org never mix rows; an event replayed with the same consumer key is a no-op; a read with a lower `stateVersion` does not overwrite a newer row.
  - Route: `org:manage` required (staff → 403/`forbidden` per the existing table); without `pms.multi_property` → 402 `entitlement_required`; another org's URL → no rows from this org; a user with hotel-only grants is refused at the route; the OrgDO filter, called directly for such a user, returns one row and no `missing` entry for the other hotel.
  - `total` is null with mixed currencies or mixed closed dates, and the integer sum otherwise.
  - `head_office_row` is in the purge inventory; org purge leaves it empty.
- **web-pms:** nav entry hidden without the entitlement or without `org:manage`; table renders the three audit states with words; total row only when present; query key includes `orgId`.

## 6. Pins and checks

- `V1_HTTP_ROUTE_AUDIT` 261 → **262**, last id **`get_org_head_office`**; `permissions-check` matches.
- `ORG_SCHEMA_HEAD` 14 → **15**.
- `COMMAND_CATALOG` unchanged (162); the night-audit command's published events gain `night_audit.halted`. `AUDIT_WRITER_COMMAND_IDS`, `PROPERTY_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS` unchanged.
- AGENTS.md pins table updated in the same commit.

## 7. AGENTS §6 checklist

- [x] Tenant: URL org only; rows filtered to the caller's accessible properties; OrgDO rejects a row for a property not in its `property_ref`.
- [x] Authz: `org:manage` + `pms.multi_property`; kill-switch = `kill:pms.multi_property`; read-only, so no lifecycle decision.
- [x] Catalog: no new command; route in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency: consumer key `consumer:pms.head_office_projection:<eventId>`; fingerprint is the row written.
- [x] Arrays: none in input.
- [x] `resolvePropertyContext`: not a property route; the consumer reaches the PropertyDO through the registry.
- [x] Money: integer minor units; totals only in one currency; no allocation needed.
- [x] Inventory: read only; counts come from `readFrontOfficeSummary` and day stats, never from counting reservations.
- [x] Errors: existing status table.
- [x] SPA: key includes `orgId`; `classifiedUserMessage`; ui-kit; live org name.
- [x] Tests: two-property isolation; replay; ordering.
- [x] Pins: §6.
- [x] No Settings control.
- [x] Existing specs searched: BoardSummary, day stats and the outbox registry are reused; no second projection design.
