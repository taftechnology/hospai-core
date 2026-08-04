# Reservations Vertical: HTTP Routes + Front-Desk Status Machine

**Date:** 2026-08-04
**Status:** Revised (v2 — `PATCH` added to the route method union; `reservations.no_show` gains `entitlement: 'pms.core'` and its opt-out entry is retired; `check_in`/`check_out`/`cancel_check_in`'s lack of entitlement re-justified on design grounds, not catalog silence; three open questions resolved; `ari.reject_on_commit` wired on `PATCH` as well as `POST`)
**Sources:** ARCHITECTURE.md §4.2 (lanes), §4.6 (degraded mode, command classes), §7.1 (ARI staleness / `ari.reject_on_commit`); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [reservations-book](./2026-07-27-reservations-book-design.md) / [-cancel](./2026-07-27-reservations-cancel-design.md) / [-modify](./2026-07-27-reservations-modify-design.md) design docs (DO-level, already shipped); [property RBAC dispatcher spec](./2026-07-28-property-rbac-dispatcher-design.md); [booking availability read route spec](./2026-07-29-booking-availability-read-route-design.md)

---

## 1. Context & Motivation

`PropertyDO` implements ten mutation commands. Three are reachable over HTTP (`tryAddRoomType`, `tryUpdateRoomType`, `tryDeleteRoomType`). This slice closes that gap for the reservations vertical:

1. Routes six already-built, already-tested DO methods (`tryCreateReservation`, `tryCancelReservation`, `tryModifyReservation`, `tryUpsertRateDay`, `tryUpsertRestrictionDay`) plus one trivial new read, through the existing RBAC dispatcher — no new gate logic.
2. Builds the front-desk **status machine** (`check_in`, `check_out`, `no_show`, `cancel_check_in`) that the command catalog declares but `PropertyDO` does not implement, including a `reservation_v8` schema migration.
3. Wires `ari.reject_on_commit` stale-vs-race classification (§7.1) onto the create path, which the availability-read spec deferred forward to exactly this endpoint.

**Explicitly out of scope**, and why:

- **`reservations.assign_room`.** The catalog entry implies a physical room unit (`reservation.room_assigned` event), but no `room` table exists — inventory today is tracked only at `room_type` granularity. `rooms.update_status` (housekeeping) has the same gap. Building `assign_room` here means inventing a physical-room schema in service of one command, decided in isolation from the housekeeping vertical that actually owns that entity. Deferred to its own slice.
- **`reservations.update_status`.** Catalog notes this is for non-inventory status notes (e.g. a VIP flag), explicitly *not* part of the `status` column state machine this spec builds. No target field exists for it yet; deferred.
- **Degraded-mode queueing/replay.** The catalog classifications below are honored (handlers are written so the classification is *true*, not aspirational), but no admission/queue/replay machinery exists anywhere in the codebase yet (§4.6). That is the next slice, sequenced after this one specifically so it has a real command surface to design against.
- **Audit log.** Per §15 rule 5, audit derives from the outbox stream already written by every mutation here; it is a consumer to build once, not a per-command obligation.

---

## 2. Design Decisions

### 2.1 Status machine — legal transitions

Current constraint (`reservation_v7`):
```sql
status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled'))
```

Proposed (`reservation_v8`):
```sql
status TEXT NOT NULL DEFAULT 'confirmed'
       CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show'))
```

Transition graph — everything not listed is illegal and returns `INVALID_STATUS_TRANSITION`:

```
confirmed   --check_in-->        checked_in
confirmed   --cancel-->          cancelled          (existing tryCancelReservation, unchanged)
confirmed   --no_show-->         no_show
checked_in  --check_out-->       checked_out
checked_in  --cancel_check_in--> confirmed          (reverses an accidental check-in)
```

`cancelled`, `checked_out`, `no_show` are terminal — no command transitions out of them. `cancel` stays gated to `status = 'confirmed'` exactly as `tryCancelReservation` already enforces (`ALREADY_CANCELLED` on anything else); this spec does not touch that method.

**Business-date guard on `no_show` only.** Marking a reservation `no_show` releases its inventory (below) — doing that before the reservation's arrival date has actually opened would release stock for a guest who hasn't failed to show yet. `tryNoShow` requires `businessDate >= arrivalDate`, reading business date the same way `tryCreateReservation` reads timezone (`BUSINESS_DATE_UNSET` if absent). Violating it returns a dedicated `NO_SHOW_BEFORE_ARRIVAL` — not `INVALID_STATUS_TRANSITION` — because `confirmed → no_show` *is* a legal transition; it just isn't available yet. Collapsing "not yet" into the same code as "never" would make the UI unable to tell an operator that trying again tomorrow would work. `check_in` and `check_out` carry **no** business-date gate — early/late arrivals and departures are an operational reality, not an invariant, and gating them would make the front desk fight the software during exactly the situations status commands exist to record.

### 2.2 Ledger effect per transition

| Command | Touches `availability_day`? | Reasoning |
|---|---|---|
| `check_in` | No | Nights were already committed (`sold`) at booking time. Check-in records occupancy, not inventory. |
| `check_out` | No | Same — nights stay consumed through the stay; departure doesn't return them to stock. |
| `cancel_check_in` | No | Pure reversal of `check_in`; inventory was never touched by `check_in` either. |
| `no_show` | **Yes** — releases `sold` on every night from `arrival_date` to `departure_date` (exclusive), same decrement loop as `tryCancelReservation` | A no-show is functionally a very-late cancellation: the room was never occupied, and it must go back into ledger for the same nights that `cancel` would release. |

### 2.3 Degraded-mode classification — verified, not assumed

The catalog already assigns:

| Command | `degraded` | Consistent with §4.6 admission test? |
|---|---|---|
| `check_in`, `check_out`, `cancel_check_in` | `QUEUE_PROVISIONAL` | Yes — each is a last-writer-wins update to one `status` column keyed by `reservation_id`. No read of shared, concurrently-mutated state; two queued check-ins for different reservations commute; a queued `check_out` after a queued `check_in` composes correctly regardless of replay order. |
| `no_show` | `FAIL_CLOSED` | Yes — it reads-then-decides on `availability_day`, which is exactly what §4.6 calls out as the line: "anything that reads-then-decides on shared state ... is `FAIL_CLOSED` by construction." |

This spec's handlers are built so that claim stays true once the queue exists — i.e. `tryCheckIn`/`tryCheckOut`/`tryCancelCheckIn` never read `availability_day`, so admitting them provisionally later is a routing change, not a rewrite. No enforcement exists yet (no queue), so today a `PropertyDO` outage simply fails every command including the `QUEUE_PROVISIONAL` ones — that gap is the next slice, and is unaffected by this one.

### 2.3a Entitlement gating — one command's silence expires, three don't

`check:entitlements` only examines `FAIL_CLOSED` commands with events; it never looks at `QUEUE_PROVISIONAL` ones, so a `QUEUE_PROVISIONAL` command lacking an `entitlement` produces no CI signal either way. That means the catalog's current shape — `check_in`/`check_out`/`cancel_check_in` ungated, `no_show` ungated-via-opt-out — is **not** four instances of the same fact, and this spec must not treat them as one:

- **`check_in` / `check_out` / `cancel_check_in` stay ungated, on a design justification, not a CI-silence one.** These are precisely the commands meant to keep working when the platform is degraded (§2.3). Gating them on a per-org entitlement lookup requires the entitlement plane (KV / `OrgEntitlementDO`) to be reachable — exactly the dependency §4.6 exists to route around for provisional commands. Gating them would defeat their own classification. **Stated consequence, not left implicit:** an org whose `pms.core` entitlement has lapsed can still check guests in and out, and check-in/out traffic cannot be shed by the kill-switch (§6.4). That is a defensible product call — degraded-mode commands are meant to survive exactly the outages a lapsed-entitlement org's read of the entitlement plane would itself be vulnerable to — but it is a decision this spec is making explicitly, not one that falls out of "the catalog already says so."
- **`no_show` gains `entitlement: 'pms.core'`, and its `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` entry is deleted in the same change.** Its current opt-out reason — `'Phase 1 — not yet gated at a DO boundary'` — is a parking spot, not a permanent decision (contrast `night_audit.run`'s reason, which is permanent: gating a background alarm path would strand business-date roll rather than deny a user action). `tryNoShow` + `POST .../no-show` *is* the DO boundary that reason was waiting for; this slice is what retires it. `check:entitlements` enforces the two moves as a pair — an opted-out entry with an `entitlement` set is itself a CI error, so the catalog edit and the opt-out-list deletion must land in the same commit.

### 2.4 `ari.reject_on_commit` on the create path

§7.1: a rejection is *stale projection* if the quote's `ariVersion` is behind the DO's current version at rejection, *genuine race* if it's current. Only the first is a defect.

**`tryCreateReservation` change.** On `NoAvailabilityError`, the mapped result must carry the DO's current `ariVersion` so the caller can classify:

```ts
if (e instanceof NoAvailabilityError) {
  return { ok: false, error: NO_AVAILABILITY, date: e.date, ariVersion: this.readAriVersionSync() };
}
```

(`readAriVersionSync` is a plain read, safe to call after the transaction rolled back — it's the same call `bumpAriVersionSync`'s siblings already use on the success path.)

**Dispatcher change.** `POST /v1/properties/:id/reservations` accepts an optional `quoteAriVersion: number` in the body — the `ariVersion` the client got from `GET .../availability`. On a `NO_AVAILABILITY` response, if `quoteAriVersion` was supplied:

```ts
if (result.error === NO_AVAILABILITY && body.quoteAriVersion !== undefined) {
  const classification = body.quoteAriVersion < result.ariVersion ? 'stale_projection' : 'genuine_race';
  logWarn(ctx.observability, {
    msg: 'ari.reject_on_commit',
    classification,
    quote_ari_version: body.quoteAriVersion,
    current_ari_version: result.ariVersion,
    room_type_id: body.roomTypeId,
    date: result.date,
  });
}
```

`quoteAriVersion` is optional — a client that never called the read endpoint (or a test) still gets a normal `409`, just unclassified.

**Also wired on `PATCH .../reservations/:rid` (modify).** `tryModifyReservation` throws the same `NoAvailabilityError` on its new-nights availability check, and a modify rejected for availability poses the identical stale-vs-race question a create does — there's no principled reason to instrument one commit path for a metric and not its sibling. Same `ariVersion`-on-rejection change to the mapped error, same optional `quoteAriVersion` body field, same `logWarn` call, in `handlePatchReservation`.

---

## 3. File Changes

### Element-wise index alignment

`check:permissions` requires `V1_ROUTES` (`v1-dispatch.ts`) and `V1_HTTP_ROUTE_AUDIT` (`v1-http-routes.ts`) to match by index. Current arrays end at index 9 (`get_property_availability`). This slice appends **ten** routes, indices 10–19, in the exact order below in both files.

### `apps/pms-core/src/v1-dispatch.ts` — route method union [MODIFY, blocking]

```diff
 type V1RouteBase = {
-  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
+  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
   pattern: RegExp;
   handler: (ctx: V1DispatchContext) => Promise<Response>;
 };
```
Without this, `patch_reservation`'s route entry doesn't typecheck — the same category of miss (a missing HTTP method in this union) already landed a CI-red commit once on the inventory slice. First item in the checklist, not an afterthought.

### `packages/contracts/src/idempotency.ts` [MODIFY]

Add the two new error codes this vertical introduces:
```ts
export const INVALID_STATUS_TRANSITION = 'invalid_status_transition' as const;
export const NO_SHOW_BEFORE_ARRIVAL = 'no_show_before_arrival' as const;
```

### `packages/contracts/src/entitlements.ts` [MODIFY, pairs with the catalog edit below]

Delete the `reservations.no_show` row from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` (§2.3a). `check:entitlements` fails the build if this and the catalog's `entitlement` field aren't both changed in the same commit — an opted-out entry with an `entitlement` set is itself an error.

### `packages/contracts/src/commands/catalog.ts` [MODIFY]

```diff
   {
     id: 'reservations.no_show',
     prototypeAction: null,
     lane: 'INTERACTIVE',
     degraded: 'FAIL_CLOSED',
     idempotent: true,
     events: ['reservation.status_changed', 'availability.changed'],
     notes: 'Inventory-affecting — must not invent stock during outage.',
+    entitlement: 'pms.core',
     permission: 'reservations:write',
   },
```
`check_in` / `check_out` / `cancel_check_in` entries are unchanged — no `entitlement` field, per §2.3a's design justification, not catalog silence.

### `packages/do-runtime/src/property-migrations.ts` [MODIFY]

Add `reservation_v8` following the exact v5/v7 rebuild pattern (copy all rows, drop, rename, recreate both indexes — `folio_line` has no FK on `reservation_id`, confirmed by grep, so this is a routine rebuild, not the `data_key` trap):

```ts
/** v8 — reservation.status admits the front-desk state machine (check-in/out, no-show). */
export const RESERVATION_V8_STATEMENTS: string[] = [
  `CREATE TABLE reservation_v8 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  guest_ref        TEXT NOT NULL,
  pii_key_id       TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)`,
  `INSERT INTO reservation_v8 (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v8 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
];
```
Append to `PROPERTY_MIGRATIONS` after the v7 entry. Regenerate `migrations/do-property/0008_reservation_status_machine.sql` via `pnpm generate:ddl` — do not hand-write it (see the file header on every existing migration).

### `apps/pms-core/src/property-do.ts` [MODIFY]

1. `NoAvailabilityError` branch in `mapReservationPreconditionError` gains `ariVersion` (§2.4) — return type widens accordingly on `tryCreateReservation`'s signature only (cancel/modify don't reject on `NO_AVAILABILITY` today in a way that needs this... `tryModifyReservation` does hit `NoAvailabilityError` too — same field, harmless there).
2. New `InvalidStatusTransitionError` class alongside the other precondition error classes (§163 area), carrying `{ from: string; to: string }`.
3. New `mapStatusTransitionError` helper mirroring `mapReservationPreconditionError`, mapping `InvalidStatusTransitionError` → `INVALID_STATUS_TRANSITION` and reusing `IdempotencyKeyReused` → `IDEM_KEY_REUSED`, not-found → `NOT_FOUND`.
4. Four new methods, inserted after `tryModifyReservation`, all following the existing shape (`gateCoreEntitlement`, `transactionSync` + `runIdempotent`, outbox append, `ariVersion` bump only where the ledger moves):

```ts
async tryCheckIn(input: { reservationId: string }, idem: IdempotencyKey):
  Promise<{ ok: true; reservationId: string } | { ok: false; error: typeof NOT_FOUND }
         | { ok: false; error: typeof INVALID_STATUS_TRANSITION } | { ok: false; error: string }>

async tryCheckOut(input: { reservationId: string }, idem: IdempotencyKey):
  /* same shape, requires status === 'checked_in' */

async tryCancelCheckIn(input: { reservationId: string }, idem: IdempotencyKey):
  /* same shape, requires status === 'checked_in', sets 'confirmed' */

async tryNoShow(input: { reservationId: string }, idem: IdempotencyKey):
  Promise<{ ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
         | { ok: false; error: typeof NOT_FOUND } | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
         | { ok: false; error: typeof NO_SHOW_BEFORE_ARRIVAL }
         | { ok: false; error: typeof BUSINESS_DATE_UNSET } | { ok: false; error: string }>
```

Each emits `reservation.status_changed` with `{ propertyId, reservationId, guestRef, piiKeyId, fromStatus, toStatus }` (matches the shape `tryCancelReservation` already emits). `tryNoShow` additionally emits `availability.changed` and bumps `ariVersion`, identical to the release loop in `tryCancelReservation` §2.2.

5. New read method:
```ts
async readReservation(reservationId: string):
  Promise<{ ok: true; reservation: {...} } | { ok: false; error: typeof NOT_FOUND }>
```
Plain `SELECT`, no transaction, no idempotency key — mirrors how `readAvailabilityRange` is a bare read RPC.

### `packages/contracts/src/v1-http-routes.ts` [MODIFY]

Append at indices 10–19:

```ts
  { id: 'post_reservations', scope: 'property', permission: 'reservations:write', commandId: 'reservations.create', entitlement: 'pms.core' },
  { id: 'get_reservation', scope: 'property', permission: 'reservations:read', entitlement: 'pms.core' },
  { id: 'patch_reservation', scope: 'property', permission: 'reservations:write', commandId: 'reservations.modify', entitlement: 'pms.core' },
  { id: 'post_reservation_cancel', scope: 'property', permission: 'reservations:write', commandId: 'reservations.cancel', entitlement: 'pms.core' },
  { id: 'post_reservation_check_in', scope: 'property', permission: 'reservations:write', commandId: 'reservations.check_in' },
  { id: 'post_reservation_check_out', scope: 'property', permission: 'reservations:write', commandId: 'reservations.check_out' },
  { id: 'post_reservation_no_show', scope: 'property', permission: 'reservations:write', commandId: 'reservations.no_show', entitlement: 'pms.core' },
  { id: 'post_reservation_cancel_check_in', scope: 'property', permission: 'reservations:write', commandId: 'reservations.cancel_check_in' },
  { id: 'put_rate_days', scope: 'property', permission: 'rates:write', commandId: 'rates.upsert_day', entitlement: 'pms.core' },
  { id: 'put_restriction_days', scope: 'property', permission: 'rates:write', commandId: 'restrictions.upsert_day', entitlement: 'pms.core' },
```

`check_in`/`check_out`/`cancel_check_in` carry no `entitlement`, per §2.3a's design justification (they must survive an unreachable entitlement plane). `no_show` **does** carry `entitlement: 'pms.core'`, matching the catalog edit above — it is the one FAIL_CLOSED status command, and its opt-out was always meant to expire once a DO boundary existed. `get_reservation` gets `entitlement: 'pms.core'` on the rule from open question 2 below: reservation data is product data (gate it), tenancy data like `get_property`/`get_org_properties` is not (an org that stopped paying still needs to see its own account).

### `apps/pms-core/src/v1-dispatch.ts` [MODIFY]

Ten handlers, ten route entries at matching indices 10–19. Route patterns:

| Route | Pattern |
|---|---|
| `post_reservations` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations$/` |
| `get_reservation` | `GET` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/` |
| `patch_reservation` | `PATCH` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/` |
| `post_reservation_cancel` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel$/` |
| `post_reservation_check_in` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-in$/` |
| `post_reservation_check_out` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-out$/` |
| `post_reservation_no_show` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/no-show$/` |
| `post_reservation_cancel_check_in` | `POST` `/^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel-check-in$/` |
| `put_rate_days` | `PUT` `/^\/v1\/properties\/([^/]+)\/rate-days$/` |
| `put_restriction_days` | `PUT` `/^\/v1\/properties\/([^/]+)\/restriction-days$/` |

Handlers follow the `handlePostRoomTypes`/`handlePutRoomType` shape exactly: decode `propertyId` (+ `reservationId` where present) from `ctx.match`, parse/validate body, `fingerprintPayload`, `resolvePropertyFromRegistry`, call the stub method with `{ kind: 'user', userId: ctx.actor.userId }`, map `result.error` to status via a new `mapReservationCommandErrorStatus` (extends `mapAddRoomTypeErrorStatus`'s pattern with `NO_AVAILABILITY`→409, `UNBOOKABLE`/`RESTRICTION_VIOLATED`/`NOT_MODIFIABLE`/`INVALID_STATUS_TRANSITION`/`NO_SHOW_BEFORE_ARRIVAL`→422, `ALREADY_CANCELLED`/`LEDGER_INCONSISTENT`→409, `BUSINESS_DATE_UNSET`→500). `post_reservations` and `patch_reservation` additionally do the `ari.reject_on_commit` logging from §2.4 before returning the 409.

**Idempotency-key transport is a rule, not a per-route choice:** *no request body → `x-idempotency-key` header; body present → `idempotencyKey` field in the body.* By that rule: `post_reservations`/`patch_reservation`/`post_reservation_cancel`/`put_rate_days`/`put_restriction_days` take it in the body (they already have one); the four status-machine POSTs (`check-in`/`check-out`/`no-show`/`cancel-check-in`) have nothing else to say, so they take it from `x-idempotency-key`, matching `handleDeleteRoomType`. **The header is required — missing it is `400 invalid_body`, exactly like `handleDeleteRoomType`'s existing check.** It is never fabricated server-side; the inventory slice's `DELETE` handler had a bug where a missing key was silently substituted with a generated one, which disables idempotency protection without the caller knowing. That must not repeat here.

`rate-days`/`restriction-days` bodies are single-row upserts (`{ roomTypeId, ratePlanId, stayDate, ...fields, idempotencyKey }`), matching `tryUpsertRateDay`/`tryUpsertRestrictionDay`'s existing single-row signature — no batch endpoint in this slice.

---

## 4. Test Matrix

New file `apps/pms-core/test/reservations-routes.spec.ts` (HTTP-level, mirrors `availability-read.spec.ts`'s harness):

| # | Test | Assertion |
|---|---|---|
| 1 | `POST /reservations` valid body | `201`, `ariVersion` bumped, `reservation.created` + `availability.changed` on outbox |
| 2 | `POST /reservations` no availability, `quoteAriVersion` behind current | `409`, `logWarn` emits `ari.reject_on_commit` with `classification: 'stale_projection'` |
| 3 | `POST /reservations` no availability, `quoteAriVersion` current | `409`, `classification: 'genuine_race'` |
| 4 | `POST /reservations` no availability, no `quoteAriVersion` | `409`, no log emitted |
| 4a | `PATCH /reservations/:rid` no availability on new dates, `quoteAriVersion` behind current | `409`, same `ari.reject_on_commit` classification as test 2, confirming §2.4's modify-path wiring |
| 5 | `GET /reservations/:rid` existing | `200` with reservation row |
| 6 | `GET /reservations/:rid` missing | `404` |
| 7 | `PATCH /reservations/:rid` valid new dates | `200`, old nights released / new nights sold |
| 8 | `POST /reservations/:rid/cancel` on `confirmed` | `200`, `status = 'cancelled'`, ledger released |
| 9 | `POST .../check-in` on `confirmed` | `200`, `status = 'checked_in'`, **no** `availability.changed` emitted |
| 10 | `POST .../check-in` on `checked_in` (already) | `422 invalid_status_transition` |
| 11 | `POST .../check-out` on `checked_in` | `200`, `status = 'checked_out'` |
| 12 | `POST .../check-out` on `confirmed` (never checked in) | `422 invalid_status_transition` |
| 13 | `POST .../cancel-check-in` on `checked_in` | `200`, `status` reverts to `confirmed` |
| 14 | `POST .../no-show` on `confirmed`, `businessDate >= arrivalDate` | `200`, `status = 'no_show'`, ledger released, `availability.changed` emitted |
| 15 | `POST .../no-show` with `businessDate < arrivalDate` | `422 no_show_before_arrival` — distinct code from test 16, confirming "not yet" vs. "never" are distinguishable at the wire |
| 16 | `POST .../no-show` on `checked_in` | `422 invalid_status_transition` (no-show only applies to `confirmed`) |
| 17 | `PUT /rate-days` valid single row | `200`, `rate.changed` on outbox |
| 18 | `PUT /restriction-days` valid single row | `200`, `restriction.changed` on outbox |
| 19 | Non-member user on any route | `404` (RBAC privacy protection, matching existing convention) |
| 20 | `staff` role on `check_in`/`check_out` | `200` (all three roles hold `reservations:write`) |
| 21 | Active kill-switch on `pms.core`, `POST .../no-show` | `503` — `no_show` is now entitlement-gated (§2.3a), so the kill-switch reaches it like any other `pms.core` route |
| 21a | Active kill-switch on `pms.core`, `POST .../check-in` / `.../check-out` / `.../cancel-check-in` | `200` — these declare no entitlement by design (§2.3a); the kill-switch cannot shed this traffic, and this test is what proves that's the actual behavior rather than an assumption |
| 22 | `reservation_v8` migration on a fixture DO with existing `confirmed`/`cancelled` rows | Migration succeeds, existing rows preserved, new `CHECK` accepts all five statuses |
| 23 | `check:entitlements` after the catalog edit | Passes: `reservations.no_show` has `entitlement` set and no opt-out entry; removing only one half of that pair (as a regression check) fails the script |

---

## 5. Open Questions — Resolved

1. **No-show before arrival — exact error. Resolved: dedicated code.** `INVALID_STATUS_TRANSITION` would be false — `confirmed → no_show` is legal, it's just not available yet, and the UI needs "not yet" to read differently from "never." Implemented as `NO_SHOW_BEFORE_ARRIVAL` (§2.1, §3, test 15).
2. **`readReservation` entitlement gate. Resolved: keep `pms.core`.** The line under the split precedent: `get_property_availability` gates because availability is product data; `get_property`/`get_org_properties` don't because they're tenancy data, and an org that stopped paying still needs to see its own account. A reservation is product data, so it gates. This rule — product data gates, tenancy data doesn't — is the one to apply to the next read route rather than re-litigating from scratch.
3. **Idempotency-key transport. Resolved: header, matching `handleDeleteRoomType`, with two riders applied throughout §3:** the header is *required* — a missing key is `400 invalid_body`, never silently substituted with a generated key (the exact bug that shipped on the inventory slice's `DELETE` handler, which disabled idempotency protection without the caller knowing). The convention is stated as a rule, not a per-route judgment call: no body → header; body present → in the body.

---

## 6. Implementation Checklist

- [ ] **Add `'PATCH'` to the `V1RouteBase.method` union in `v1-dispatch.ts` — first, before writing any route that needs it.** Blocking; the same category of miss (a missing HTTP method literal) landed a CI-red commit on the inventory slice.
- [ ] `INVALID_STATUS_TRANSITION` and `NO_SHOW_BEFORE_ARRIVAL` in `packages/contracts/src/idempotency.ts`.
- [ ] `entitlement: 'pms.core'` on `reservations.no_show` in `packages/contracts/src/commands/catalog.ts`, **and** delete its row from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` in `packages/contracts/src/entitlements.ts` — same commit; `check:entitlements` fails if only one half lands.
- [ ] `reservation_v8` in `packages/do-runtime/src/property-migrations.ts`; regenerate `migrations/do-property/0008_*.sql` via `pnpm generate:ddl`.
- [ ] `tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn` / `tryNoShow` / `readReservation` on `PropertyDO`; `ariVersion` added to `NoAvailabilityError` mapping (used by both `tryCreateReservation` and `tryModifyReservation`).
- [ ] Ten entries in `V1_HTTP_ROUTE_AUDIT` (indices 10–19, `post_reservation_no_show` carrying `entitlement: 'pms.core'`) and matching `V1_ROUTES` handlers/routes in `v1-dispatch.ts`.
- [ ] `ari.reject_on_commit` logging on both `handlePostReservations` and `handlePatchReservation`.
- [ ] Idempotency-key handling on the four no-body status routes: required `x-idempotency-key` header, `400 invalid_body` if absent, never server-generated.
- [ ] `apps/pms-core/test/reservations-routes.spec.ts` — all 24 cases (§4).
- [ ] `pnpm build`, `check:ddl`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`.
