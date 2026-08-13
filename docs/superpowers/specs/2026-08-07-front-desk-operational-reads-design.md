# Front-Desk Operational Reads

**Date:** 2026-08-07  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (degraded mode), §4.8 (crypto-shredding), §6.3–§6.4 (entitlement snapshot / kill-switch), §7.7 (operational read paths), §7.8 (OLTP vs warehouse), §9 (shell); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md); [guests + PII vertical](./2026-08-06-guests-pii-vertical-design.md); [guests crypto-shredding Phase 0](./2026-07-28-guests-crypto-shredding-design.md); [reservations vertical](./2026-08-04-reservations-vertical-design.md); [cashiering](./2026-08-07-cashiering-design.md); [ARI KV projection](./2026-07-29-ari-kv-projection-design.md) (per-entry `writtenAt` precedent); [folio charges](./2026-08-05-folio-charges-vertical-design.md) (`FAIL_CLOSED` honesty when no projection)

**Implementation order:** after audit log (migration head **v17**). This slice is **v18** (additive indexes only). Server slice first — the SPA vertical consumes these routes; it does not invent them.

---

## 1. Context & Motivation

The front desk cannot render without arrivals / in-house / departures. Today only `GET …/reservations/:id` exists, and it returns what PropertyDO holds — `guestRef` + `piiKeyId`, not names. `handleGetReservation` passes that through with no composition.

So even the single-reservation read gives the desk an opaque ref. For a list of thirty arrivals the client either fans out to `GET …/guests/:ref` (the N+1 §7.7 warns about — worse: each single guest read is `ensureMetaOrgId` **plus** `readGuest`, so 2N OrgDO RPCs) or the server composes. Composition has a hard constraint: **names live in OrgDO under crypto-shredding.** Any plaintext name copied into a PropertyDO table or KV projection survives erasure and breaks §4.8.

This slice ships the OLTP list reads, a bounded guest batch compose path, the org entitlement snapshot the shell needs for nav, and the "my open shift" singleton cashiering already implies. It deliberately does **not** build a reservation projection.

### Scope in

1. **Three reservation list reads** — arrivals, departures, in-house — under `/front-desk/*`, PropertyDO-only, refs not names, `FAIL_CLOSED`.
2. **Batch guest read** — `POST …/guests/batch` → OrgDO `readGuests`, per-ref outcomes, documented max (body, not query string — §2.7).
3. **Org entitlement snapshot** — `GET /v1/orgs/:orgId/entitlements`; kill-switch stays out.
4. **Current open shift** — `GET …/front-desk/shift` keyed to `actor.userId`; 200 with `shift: null` when none.
5. **Indexes** — `reservation_departure_idx`, partial `reservation_in_house_idx` (v18).
6. **Client contracts to document** — two calls per page; session queued-command log from 202s; entitlement refetch on 402; thin provisional check-in; `degraded-status` rename.

### Scope out

- SPA / `apps/web-pms` (consumes this slice; separate vertical).
- Hibernation WebSocket / `entitlement.changed` push (§7.7 / §9 — deferred; refetch-on-402 substitutes).
- Reservation KV projection of any kind (leftover — see §5; must not be a list-only half-measure).
- Date-range / tape / occupancy queries (§7.8 warehouse / reporting shape).
- Guest search / guest directory list.
- Supervisor visibility into another cashier's open shift.
- Expected cash / drawer total on the current-shift read (internal control — §2.5).
- Housekeeping board, rates, settings, reporting.

---

## 2. Design Decisions

### 2.1 Guest-name composition — batch, not join (Q1)

**Reject A (client fan-out):** each `handleGetGuest` costs `ensureMetaOrgId` + `readGuest`. Thirty arrivals → sixty OrgDO round trips, each an `await` that releases the DO input gate. §7.7 exists for exactly this.

**Reject B (server-side join in list handlers):** guest names come from OrgDO; reservations from PropertyDO. Joining them in the arrivals handler fuses two independent failure domains. If OrgDO is down, the desk sees nothing even though reservation data was fine — on the screen they stare at all day.

**Lock C:** lists stay PropertyDO-only (refs). Names compose via a separate batch guest read. If OrgDO is down, the desk still sees "arriving into 204"; names fill in when OrgDO recovers. Graceful degradation falls out of the shape.

**Owned cost (document once):** the SPA always makes **two calls per page** (list + batch). Do not later "optimise" into B and re-couple failure domains.

### 2.2 No reservation projection this slice (Q2)

A reservation KV projection **cannot contain guest names** (§4.8). A name-less list projection buys planning counts (how many arrivals, which room types) and **no transaction capability**: to act, the clerk needs a reservation id and then `GET …/reservations/:id`, which is also fail-closed on the same PropertyDO. Completing degraded check-in would require projecting **individual** reservations readable by id — a larger invalidation surface, still name-less. Building the list half now spends effort on the part that does not unblock the workflow.

**Lock:** list routes are `degradedRead: 'FAIL_CLOSED'`. No projection consumer.

**Consequence stated plainly:** §4.6 provisional check-in is **thin**. The desk can queue a check-in only if it already knows the reservation id, and it learns at replay whether that was valid. Exceptions accumulate in proportion to how blind the operator was. This is a genuine limitation of degraded mode as built — commands designed to survive an outage have no read path to support them. A client surfaces that; the earlier design did not invent a false read path.

**What the SPA gets for free (no server work):** keep a **session-scoped queued-command log** from 202 responses (`commandId`, `idempotencyKey`, `issuedAt`, `businessDate`) so the operator sees what they queued. Lost on reload — not a projection substitute. Pair with existing `provisional-exceptions` once PropertyDO recovers. Coherent product behavior for a minutes-long outage: *act on what you know, see what you queued, reconcile what failed.*

### 2.3 Query shapes and indexes (Q3)

Status domain: `inquiry | pending | confirmed | cancelled | checked_in | checked_out | no_show`. Arrivals and in-house filter status in SQL; departures return every row for the date (including `cancelled` / `no_show` if present) and the client groups the board columns — none of the three is an unfiltered "directory of reservations."

| List | Filter | Sort | Index |
|---|---|---|---|
| **Arrivals** | `arrival_date = ? AND status IN ('confirmed', 'pending')` | `reservation_id ASC` | existing `reservation_arrival_idx` |
| **Departures** | `departure_date = ?` (return `status`; client groups due-out `checked_in` vs departed `checked_out`) | `status ASC`, `reservation_id ASC` | **new** `reservation_departure_idx ON reservation (departure_date)` — unfiltered, symmetric with arrivals |
| **In-house** | `status = 'checked_in'` | `departure_date ASC`, `reservation_id ASC` (overstays first) | **new** partial `reservation_in_house_idx ON reservation (departure_date) WHERE status = 'checked_in'` |

**Why in-house is status, not date-range:**

| Situation | `status = 'checked_in'` | `arrival ≤ today < departure` |
|---|---|---|
| Checked out early, departure tomorrow | excluded — correct | included — wrong |
| Arriving today, not yet checked in | excluded — correct (they're an arrival) | included — wrong |
| **Overstay: departure yesterday, still here** | **included — correct** | **excluded — wrong** |

An in-house board that hides overstays is worse than no board. Date-range occupancy/tape is §7.8 reporting shape — leftover, not this slice.

**Partial index rationale:** a bare `status` index would hold every `cancelled` / `checked_out` forever. In-house is capped by room count; indexing `departure_date` inside that set satisfies the filter, gives the desk sort, and makes overstays a range scan (`departure_date < today`). Matches existing `reservation_room_idx … WHERE room_id IS NOT NULL`.

**Departures stay one endpoint:** one call; board renders both columns. Overstays surface on **in-house**, so departures stay "today's expected departures" with no trailing-window clause.

### 2.4 Entitlement snapshot — org-scoped (Q4)

`EntitlementSnapshot` is already `{ orgId, version, features, limits, computedAt }`. `loadSnapshot(env, orgId)` never touches PropertyDO.

`V1HttpRouteAudit` makes the case structurally: org-scoped routes are `{ scope: 'org'; permission; entitlement? }` — **no `degradedRead` field**. Only property routes carry it, because it describes PropertyDO unreachability. Forcing a property-scoped wrapper would invent a degraded-read class for a read with no PropertyDO dependency.

**Lock:**

| Item | Detail |
|---|---|
| Route | `GET /v1/orgs/:orgId/entitlements` |
| Permission | `org:read` (admin + staff) |
| Body | `EntitlementSnapshot` as returned by `loadSnapshot` (includes `version`) |
| Errors | resolution failure → **503** `entitlement_unavailable` (existing); unentitled feature checks stay on gated routes as **402** |
| Kill-switch | **Not in the response.** §6.4: separate key space, low TTL, edge-checked every request. **Nav must not gray out on kill-switch.** Snapshot shapes nav (what exists); request outcomes shape behaviour (what works right now). |
| Fetch cadence | Shell holds `{ version, features }` for the session. **Refetch on 402** (or reload). No polling. WebSocket later replaces the trigger, not the shape. |
| Owned cost | A plan upgrade does not light up the UI until the next 402 or reload. |

### 2.5 Current open shift — actor singleton (Q5)

`shift_open_per_cashier` makes open-per-cashier a structural singleton. Multi-workstation (§7.7) means the same cashier on a second terminal shares that shift — a filtered list invites "can a manager see another cashier?" (out of scope); keeping only the open-response `shiftId` in the client produces `shift_id NULL` cash on every reload / second workstation.

**Lock:**

| Item | Detail |
|---|---|
| Route | `GET /v1/properties/:propertyId/front-desk/shift` — non-colliding path; appends at end of audit array (no insert before `get_shift`) |
| Key | implicit `actor.userId` + `status = 'OPEN'` |
| Empty | **200 `{ ok: true, shift: null }`** — no open shift is normal (every morning). Not 404 (reserve 404 for missing property / not-member privacy). |
| Body when open | `shiftId`, `cashierUserId`, `openedAt`, `openingFloat`, `businessDate`, `status`, **`attributedCashCount`** (count of CASH payments with this `shift_id`). |
| **Not returned** | Expected cash / sum of cash / anything derived from `computeShiftExpectedCashSync`. Blind count is the control; revealing expected total lets the close screen be satisfied by typing it back. |

Permission / degraded: same as `get_shift` — `folio:read`, `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'`.

### 2.6 Watermark / `degraded-status`

Staleness in this system is **per-projection, carried in the payload** (ARI stamps `writtenAt` alongside `ariVersion`). There is no property-wide watermark to build. Each stale read tells the shell its own age.

`GET …/degraded-status` returns `{ propertyId, exceptionCount }` — an exception counter, not a degradation flag. **Rename this slice** (no SPA consumers yet) to an honest path: `GET …/provisional-exception-count`, audit id `get_provisional_exception_count`. Keep the response shape. Document: shell learns PropertyDO degradation **reactively** (503 / 202), not from this endpoint.

**Pin note:** this is an **in-place rename** of the existing `get_degraded_status` audit row (same index), not an append — `register.test.ts` pins that touch this id/path must update with the rename.

### 2.7 Non-colliding paths — append only (review fix)

Inserting collection routes before `get_reservation` (audit index 12) would shift every later pin in `register.test.ts` (`patch_property_details` at 43, `put_domain_config` at 44, charge/tax/shift/audit pins). "Append at end" and "register before `:reservationId`" are mutually exclusive.

**Lock: non-colliding `/front-desk/*` paths.** All new property routes **append** at the end of `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES`. No insert. Matching order between the two arrays still required (`check:permissions`); relative position vs existing parameterized routes does not matter because the URL spaces do not overlap.

| Rejected | Why |
|---|---|
| `…/reservations/arrivals` etc. | Collides with `…/reservations/:id`; forces insert + re-pin |
| `…/shifts/current` | Collides with `…/shifts/:id`; same category of ordering hazard |

### 2.8 Batch guest transport — POST body, not query string (review fix)

**Reject** `GET …/guests?refs=id1,…,id50`. Fifty stable person-identifiers in a URL land in access logs and observability. The single-guest path (`/guests/:gid`) is one ref per request; fifty on one line is a different exposure profile even though the ids are opaque.

**Lock:** `POST /v1/properties/:pid/guests/batch` with JSON body `{ refs: string[] }`.

`degradedRead` is a **route-audit capability class**, not a GET-only concept. The handler still returns fail-closed 503 when OrgDO is unreachable; it does not queue (no `commandId`). Using POST for a large read body is an intentional exception to "reads are GET," chosen to keep identifiers out of URLs — stated here so it is not "fixed" back to a query string later.

### 2.9 List item omits `piiKeyId` (review fix)

List items carry `guestRef` for the batch compose key. `piiKeyId` has no client consumer on the board path — sending it would be a key identifier on the wire with no reader. **Do not include `piiKeyId` on list items.** Single-reservation `GET …/reservations/:id` is unchanged (still returns what PropertyDO holds).

---

## 3. API surface

### 3.1 Route audit rows

**Append** the six new rows (plus in-place rename of `get_degraded_status`) to `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES` in **identical order**. Exact indices = end of array at implement time (after `get_audit_log`); do not insert before existing pins.

| Audit id | Method / path | Permission | Notes |
|---|---|---|---|
| `get_front_desk_arrivals` | `GET /v1/properties/:pid/front-desk/arrivals` | `reservations:read` | `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'`, no `commandId` |
| `get_front_desk_departures` | `GET /v1/properties/:pid/front-desk/departures` | `reservations:read` | same |
| `get_front_desk_in_house` | `GET /v1/properties/:pid/front-desk/in-house` | `reservations:read` | same |
| `post_guests_batch` | `POST /v1/properties/:pid/guests/batch` | `guests:read` | `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'` (OrgDO unreachable → 503; no queue) |
| `get_org_entitlements` | `GET /v1/orgs/:orgId/entitlements` | `org:read` | **org scope — no `degradedRead`** |
| `get_front_desk_shift` | `GET /v1/properties/:pid/front-desk/shift` | `folio:read` | `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'` |
| `get_provisional_exception_count` | rename of `get_degraded_status` → `GET …/provisional-exception-count` | `property:read` | **in-place** id + path change at existing index; body unchanged |

No dispatcher ordering constraints against parameterized routes — paths cannot collide.

### 3.2 Reservation lists

**Query**

| Route | Required query | Optional |
|---|---|---|
| arrivals | `date=YYYY-MM-DD` | `limit` (default 50, max 50), `cursor` |
| departures | `date=YYYY-MM-DD` | same |
| in-house | — (open set) | same |

**Page size hard max = 50.** SPA pages the board to ≤50 so the subsequent guest batch never exceeds the batch max by accident. `limit` above 50 is **clamped** to 50 (not 400 — contrast batch refs, which reject).

**Cursor = full sort tuple** (not `reservation_id` alone). A bare id cursor under a composite sort re-admits earlier rows whose secondary key sorts later — duplicates on page 2, especially on an overstay-heavy in-house board.

| List | Sort | Cursor payload | Resume predicate |
|---|---|---|---|
| Arrivals | `reservation_id ASC` | `{ reservationId }` | `(reservation_id > :id)` |
| Departures | `status ASC`, `reservation_id ASC` | `{ status, reservationId }` | `(status > :s) OR (status = :s AND reservation_id > :id)` |
| In-house | `departure_date ASC`, `reservation_id ASC` | `{ departureDate, reservationId }` | `(departure_date > :d) OR (departure_date = :d AND reservation_id > :id)` |

Wire `cursor` as a single opaque query param: URL-safe base64url of the JSON tuple (or equivalent). Invalid / undecodable cursor → **400** `{ error: 'invalid_cursor' }`. `nextCursor: null` when a page returns fewer than `limit` rows.

**Item shape (no names, no `piiKeyId`):**

```ts
{
  reservationId: string;
  roomTypeId: string;
  guestRef: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  roomId: string | null;
}
```

```ts
// 200
{ ok: true; items: ListItem[]; nextCursor: string | null }
```

PropertyDO methods: `listArrivals(date, { limit, cursor })`, `listDepartures(date, { limit, cursor })`, `listInHouse({ limit, cursor })` — SQL matches §2.3 + resume predicates above. No OrgDO calls.

### 3.3 Batch guest read

```
POST /v1/properties/:propertyId/guests/batch
Content-Type: application/json
{ "refs": ["id1", "id2", ...] }
```

| Rule | Detail |
|---|---|
| Max refs | **50** (after dedupe). Over → **400** `{ error: 'refs_limit_exceeded', max: 50 }` |
| Missing / empty `refs` | **400** `{ error: 'invalid_body', detail: 'refs_required' }` |
| Dedupe | Server dedupes for the OrgDO RPC; response is a map keyed by ref |
| OrgDO | One `ensureMetaOrgId`, one `readGuests(actor, propertyId, guestIds[])` — one gate acquisition |
| Permission | `guests:read` once for the batch (same as single read) |

**Per-ref outcomes — never wholesale failure:**

```ts
type GuestBatchEntry =
  | { ok: true; guestId: string; erased: false; profile: GuestProfile }
  | { ok: true; guestId: string; erased: true; profile: null }
  | { ok: false; guestId: string; error: 'guest_not_found' }
  | { ok: false; guestId: string; error: 'decrypt_unresolved' };

// 200
{ ok: true; guests: Record<string, GuestBatchEntry> }
```

- Erased → per-ref tombstone (`erased: true`), matching single `get_guest`. Does **not** fail the batch.
- Decrypt incident → log `guests.read.decrypt_incident` with `guestId`; mark that ref `decrypt_unresolved`; return the rest. **Never 500 the page** for one bad ref.
- OrgDO transport / resolution failure for the whole RPC → 503 fail-closed (same class as `get_guest` today).

**Test harness (named):** OrgDO grows test-only counters behind `assertUnsafeLocal`, same shape as `setTransportBlockedForTest`:

```ts
// OrgDO
private guestReadRpcCountForTest = 0;

// Increment at the top of readGuest AND readGuests (each RPC entry).
async resetGuestReadRpcCountForTest(): Promise<void>
async getGuestReadRpcCountForTest(): Promise<number>
```

Matrix test 9: `reset` → `POST …/guests/batch` with 30 live refs → `getGuestReadRpcCountForTest() === 1`. A fan-out implementation that called `readGuest` thirty times would report 30 and fail the assertion. Without this hook the test collapses to "names resolved," which passes under option A too.

### 3.4 Entitlement snapshot

```
GET /v1/orgs/:orgId/entitlements
→ 200 EntitlementSnapshot
→ 503 on EntitlementResolutionError (empty body or `{ error: 'entitlement_unavailable' }` — match existing edge mapping)
→ 404 not_member / wrong org (RBAC privacy)
```

Handler: `loadSnapshot(env, orgId)` from `@hospai/entitlement-client`. No kill-switch keys in the body. No PropertyDO.

### 3.5 Current shift

```
GET /v1/properties/:propertyId/front-desk/shift
→ 200 { ok: true; shift: null }
→ 200 {
      ok: true;
      shift: {
        shiftId: string;
        cashierUserId: string;
        businessDate: string;
        openedAt: number;
        openingFloat: number;
        status: 'OPEN';
        attributedCashCount: number;  // COUNT of captured CASH with this shift_id
      }
    }
```

PropertyDO: `readCurrentOpenShift(actor)` — `WHERE cashier_user_id = ? AND status = 'OPEN'`. Must **not** call `computeShiftExpectedCashSync` for the response body.

---

## 4. Schema (v18)

Additive indexes only — no table rebuild.

```sql
CREATE INDEX reservation_departure_idx ON reservation (departure_date);

CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in';
```

Canonical statements in `packages/do-runtime/src/property-migrations.ts`; regenerate `migrations/do-property/0018_*.sql`; sync test against file body (cashiering / audit-log precedent).

---

## 5. Leftovers

1. **Degraded reservation reads (real shape):** making provisional check-in operable requires projecting **individual reservations** (readable by id), not only lists. Any projection is name-less by the erasure constraint, so the desk sees room/date/ref and never who. Decide whether that is worth the invalidation surface before building either. **Do not** pick up a leftover titled only "add a reservation list projection."
2. **Date-range / tape / occupancy OLTP view** — reporting shape; §7.8 line.
3. **`entitlement.changed` WebSocket** — replaces refetch-on-402 trigger; same snapshot shape (§9).
4. **Supervisor shift visibility** — own permission decision; not a `cashierUserId` query param widened later.
5. **Hibernation WebSocket for front-desk deltas** (§7.7) — initial load stays these list reads; push is thereafter.

---

## 6. Test matrix

New / extended specs under `apps/pms-core/test/`:

| # | Scenario | Assertion |
|---|---|---|
| 1 | Arrivals for `date=D` | `confirmed | pending` with `arrival_date = D`; checked-in today **excluded** |
| 2 | Arrivals excludes `cancelled` / `no_show` | none present |
| 3 | Departures for `date=D` | all statuses with that departure date; includes both `checked_in` and `checked_out` |
| 4 | In-house includes overstay | `checked_in` with `departure_date < today` present; sorted by `departure_date ASC` |
| 5 | In-house excludes early checkout | `checked_out` with future departure **absent** |
| 6 | In-house excludes not-yet-arrived | `confirmed` arriving today **absent** |
| 7 | Composite cursor pagination | in-house page 2 has **no** reservationIds from page 1 (overstay-heavy fixture); departures same for `(status, id)` |
| 7a | `limit` > 50 | clamped to 50 |
| 8 | List while PropertyDO blocked | 503 `degraded: 'FAIL_CLOSED'` |
| 9 | Batch 30 refs → one OrgDO RPC | names resolved; **`getGuestReadRpcCountForTest() === 1`** after `reset` (§3.3 harness) |
| 10 | Batch with one erased ref | that entry `erased: true`; others live; HTTP 200 |
| 11 | Batch with one decrypt failure | that entry `decrypt_unresolved`; others ok; log incident; HTTP 200 |
| 12 | Batch >50 refs | 400 `refs_limit_exceeded` |
| 13 | Batch OrgDO down | 503; arrivals list still 200 if PropertyDO up (separate calls — decoupling) |
| 14 | `GET …/entitlements` | 200 body includes `orgId`, `version`, `features`; no kill fields |
| 15 | Kill-switch active | snapshot route still 200 if resolution works; a gated property write still 503 — nav must not encode kill |
| 16 | Unentitled gated route → 402 | documents refetch trigger for shell |
| 17 | `GET …/front-desk/shift` no open shift | 200 `{ shift: null }` |
| 18 | Open shift then front-desk shift | 200 with `shiftId` / float / **no** expected-cash field; body must not contain keys like `expectedCash` / `variance` |
| 19 | List item shape | no `piiKeyId` field on arrivals/departures/in-house items |
| 20 | Rename `degraded-status` → exception-count path | old path 404; new path returns `{ propertyId, exceptionCount }` |
| 21 | `check:permissions` / `check:degraded` | audit rows green; org entitlements row has no `degradedRead`; existing index pins (43/44/…) unchanged |

---

## 7. Open questions — resolved

1. **Guest-name composition.** **Batch OrgDO read (C).** Failure-domain decoupling; 2N cost of A; owned two-calls-per-page cost.
2. **Reservation projection.** **None this slice (A).** Thin provisional check-in stated; leftover is individual-by-id projection, not list-only.
3. **In-house filter.** **`status = 'checked_in'`** with partial `(departure_date) WHERE status = 'checked_in'`. Departures = `departure_date = ?` unfiltered index; arrivals filter **amended 2026-08-12** to `confirmed | pending` ([reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md)).
4. **Entitlement snapshot.** **Org-scoped**; no `degradedRead`; kill-switch out; refetch on 402; plan-upgrade lag accepted.
5. **Shift lookup.** **`GET …/front-desk/shift`**; 200 + `null`; no expected cash; non-colliding path.
6. **Route collision vs insert.** **Non-colliding `/front-desk/*` paths; append only** — do not shift `register.test.ts` pins.
7. **Cursor.** **Full sort tuple** with row-comparison resume; arrivals remains id-only.
8. **List `piiKeyId`.** **Omitted** — batch keys on `guestRef`.
9. **Batch transport.** **POST body** — identifiers stay out of URLs/access logs; `degradedRead` still applies.
10. **Test 9 harness.** **`getGuestReadRpcCountForTest` / `resetGuestReadRpcCountForTest`** on OrgDO.

---

## 8. Implementation checklist

- [ ] v18 indexes + migration file + sync test (§4).
- [ ] PropertyDO list methods + `/front-desk/{arrivals,departures,in-house}` handlers; tuple cursors (§3.1–3.2).
- [ ] OrgDO `readGuests` + RPC counter harness + `POST …/guests/batch` (§3.3).
- [ ] Org entitlements route via `loadSnapshot`; audit row `scope: 'org'` (§3.4).
- [ ] `readCurrentOpenShift` + `/front-desk/shift`; blind-count fields only (§3.5).
- [ ] Rename `degraded-status` → provisional-exception-count (in-place audit id); update pins/tests (§2.6).
- [ ] Test matrix §6 green; `check:permissions` / `check:degraded` green; index pins 43/44 unchanged.
- [ ] Spec leftovers §5 recorded for SPA vertical / future projection decision.

---

## 9. Client contracts (for the SPA vertical — not implemented here)

These are **owned costs**, not omissions. The SPA spec should quote them rather than rediscover them:

1. **Two calls per board page** — `GET …/front-desk/{arrivals|departures|in-house}` (PropertyDO) + `POST …/guests/batch` (OrgDO). Names may lag; list must still render.
2. **Session queued-command log** from 202 bodies — not durable; pair with `provisional-exceptions` on recovery.
3. **Entitlement snapshot** fetched once per org session; **refetch on 402**; kill-switch never pre-disables nav.
4. **Thin degraded check-in** — operable only with a known reservation id; no arrivals board during PropertyDO outage.
5. **Board page size ≤ 50** — matches server list + batch caps; opaque tuple cursors passed through as returned.
6. **Current shift** via `GET …/front-desk/shift` on load / workstation open — never invent `shift_id` client-side only.
7. **Close screen** must not be fed expected cash from the front-desk shift read (server will not send it).
