# Booking Wizard (reservation creation SPA)

**Date:** 2026-08-11  
**Status:** Accepted — implemented on `feat/booking-wizard`. Plan: `docs/superpowers/plans/2026-08-11-booking-wizard.md`.  
**Sources:** ARCHITECTURE.md §4.6 / §7.1; command catalog `reservations.create` / `guests.create`; [availability read route](./2026-07-29-booking-availability-read-route-design.md); [guests PII vertical](./2026-08-06-guests-pii-vertical-design.md); [reservations vertical](./2026-08-04-reservations-vertical-design.md); [property `/me`](./2026-08-09-property-me-permissions-design.md); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md); [folio front desk](./2026-08-08-folio-front-desk-design.md); [pms-core fixture dates](./2026-08-11-pms-core-fixture-dates-design.md); `packages/client-core` (`stableKeyForOperation`, `postGuestsBatch`); `apps/pms-core` `handlePostReservations` / `handleGetAvailability` / `logAriRejectOnCommit`

**Implementation order:** Task 0 (catalog notes + `check:degraded` rule) → client-core methods → web-pms wizard. Task 0 is cherry-pickable without SPA work.

**Locks:** Approach 2; guest = create-default + context `guestRef`; TOCTOU = auto re-read + required `quoteAriVersion` + opId composition; create stays `FAIL_CLOSED`; type-only / quantity-only; nav Book → success arrivals `?date=`; property-local defaults + banner.

---

## 1. Context & Motivation

`packages/client-core/src/api.ts` has **zero** create-reservation methods and no availability read. Meanwhile `reservations.create` is routed (`post_reservations`) and `FAIL_CLOSED`, alongside `modify`, `cancel`, `assign_room`, and both check-in paths. The server can run the whole reservation lifecycle; the product cannot start one.

Every shipped front-desk screen — arrivals, departures, in-house, check-in, folio, cashiering, staff — operates on reservations that only fixtures and curl can produce. Same latent-value pattern as membership-before-staff-UI and `/me`-before-roles, except this one sits under the entire front desk.

Both server routes exist (`post_reservations`, `get_property_availability`). Guests are createable over HTTP. The SPA already has `/me` gating, Authority helpers, status tokens, money helpers, degraded classification, `403 → invalidate me`, and property-local date helpers — which a booking wizard needs immediately.

### Scope in

1. **Task 0:** `INVENTORY_FAIL_CLOSED_NOTES` shared by create / modify / cancel / no_show; rule in `degraded-check.mjs`: `availability.changed` ∈ events ⇒ `FAIL_CLOSED` (no opt-out).
2. **client-core:** `getAvailability` (no `roomTypeId` param), `createGuest`, `createReservation` (always send `quoteAriVersion`); booking opId composition via existing `stableKeyForOperation` — **no client fingerprint helper**.
3. **web-pms:** Nav `Book` (`reservations:write`) → `/book`; wizard (dates → room-type picker → guest create or context guest); `?guestRef=` entry; success → `/arrivals?date=<arrivalDate>` + one-shot banner with `reservationId`.
4. Commit / guest rejection UX per §2.4 (branch on `body.error`; auto-re-read only for `no_availability`, never for `idempotency_key_reused`).
5. Leftovers written (§7).

### Scope out

- Guest search / substring lookup; equality blind index  
- Rates, quote HTTP, plan picker, money in the wizard  
- Physical `assign_room` inside the book flow  
- Flipping create to `QUEUE_PROVISIONAL` / client-only walk-in notes  
- Retiring catalog rows / inventing `PROTOTYPE_ACTIONS` “not carried forward”  
- Fixing `BoardScreen` date seed  
- Prototype name `AvailableRoomsModal` (use type-picker naming)  
- Multi-line residual in `pms-core-test-dates-check.mjs` (explicitly out — Task 0 touches `degraded-check.mjs` only)

---

## 2. Design Decisions

### 2.1 Degraded class — keep `FAIL_CLOSED` (restated)

`reservations.create` stays `FAIL_CLOSED`. Check-in/out remain `QUEUE_PROVISIONAL` because they emit only `reservation.status_changed`, never `availability.changed`. Walk-in during PropertyDO outage → `503`; no provisional reservation, no invented `sold`.

Of the four inventory-affecting reservation commands, only cancel/no_show carried notes. Create and modify were silent inheritance. Same shape as the `staff.*` reconciliation.

**Mechanical invariant:** every catalog command that emits `availability.changed` is `FAIL_CLOSED` (7 commands today, zero exceptions). That is a `check:degraded` rule, not a comment. No opt-out list — inventing stock during an outage must not have a pre-carved escape hatch; a real exception later adds the list deliberately with a reason.

**Guest pairing:** `guests.create` is also `FAIL_CLOSED` + `pms.core`. The wizard's two writes fail together at the same gate — no outage window where a guest is created and the reservation is not (orphan-record problem the pairing avoids).

Reject: provisional create (B) — replay story touches every screen; two provisional creates against one last room do not commute. Reject: client-only walk-in notepad (C) — manufactures belief ≠ product truth without a replay path.

### 2.2 Guest identity — create-default + context lookup

There is no guest search. Reads are `get_guest` by id and `post_guests_batch` by refs. Name/email/phone live only inside `profile_cipher`. Lookup-first has no backing capability; a paste-`guestRef` default is worse than create-default.

`postGuestsBatch` is a **hydration** path (folio/board already hold refs), not a **discovery** path. Booking starts empty.

**Lock:**

- **Default:** inline `guests.create` then `reservations.create`.
- **Context:** `/book?guestRef=` from board/folio/reservation; batch prefills display name; skip create step.
- **No search box.** Duplicate guests accepted debt (idempotency is key-replay, not content dedupe). Destination later: C-with-equality-lookup via blind index — not prototype substring search. Deliberate divergence from prototype `useExistingGuest = true`.

### 2.3 Availability → commit (TOCTOU) + session ids

Wizard quotes via `GET …/availability`, commits with `quoteAriVersion`. Race → `409 { error: 'no_availability', date, ariVersion }`. Server logs `stale_projection` vs `genuine_race` only when the field is present:

```
if (quoteAriVersion === undefined) return;
```

Omit the field → metric silence, not an unclassified race. **Client obligation:** always send `quoteAriVersion` from the last successful availability read.

**On 409:** surface wire `date` (the sold-out night); auto re-read; clear selected type; keep guest + dates; thread **new** `ariVersion` into the next quote (so a second 409 classifies against the fresh quote).

**Idempotency — opId composition, not a client fingerprint.** The client never fingerprints; the server derives fingerprint from the body. The remint rule (*re-mint iff any fingerprint field changed*) is expressed by composing the booking opId from those fields:

```
book:${reservationId}:${roomTypeId}:${arrivalDate}:${departureDate}:${guestRef}
```

via existing `stableKeyForOperation`. Same type re-pick → same key (DO never caches `no_availability` against the key). Different type → fresh key (avoids `idempotency_key_reused`).

**Session ids (load-bearing precondition):** `guestId` and `reservationId` are **client-minted** and fingerprinted server-side. Both are minted **once when the wizard opens** and held in wizard state. Every retry — after `no_availability`, `restriction_violated`, 503, or other — reuses both. Only a fresh wizard session mints new ids. A guest created in a prior attempt is reused via its held `guestRef`, never re-created. Otherwise every retry becomes a distinct booking and every failed book after a successful guest create orphans a new guest.

**Quote read shape:** `handleGetAvailability` Branch 1 (`roomTypeId` supplied) returns `Math.min` of KV per-night versions; Branch 2 (omit / miss) returns DO `ariVersion`. Different scales — mixing them corrupts `stale_projection` vs `genuine_race`. The type picker omits `roomTypeId` (needs all types) → always Branch 2. **The quote comes from that type-picker read and is not refreshed via a per-type Branch 1 call before commit.** `getAvailability` in client-core omits the `roomTypeId` parameter deliberately so the HTTP capability cannot be used without changing the signature. All-types reads never use KV → most likely to go `READ_STALE` → §2.6 is load-bearing.

### 2.4 Commit / guest rejection matrix

**Branch on `body.error`, never on HTTP status alone.** `no_availability` and `idempotency_key_reused` are both 409 (`mapReservationCommandErrorStatus` / create handler). A status-only handler would treat key-reuse — a client bug or opId/fingerprint mismatch — as sold-out and silently re-read + clear selection, hiding the defect the opId design exists to prevent.

| error | status | Recovery |
|---|---|---|
| `no_availability` | 409 | Surface `date`; auto re-read; clear type; keep guest/dates |
| `idempotency_key_reused` | 409 | Client-side defect (opId/fingerprint drift). Surface a generic failure; **no** auto-retry, **no** re-read, **no** clearing selection |
| `restriction_violated` | 422 | Surface `rule` / `date` / `required?`; point at **dates**; do not clear type as if sold out |
| `unbookable` | 422 | Surface `date` (missing `availability_day` / horizon); operator adjusts dates |
| `not_found` | 404 | Type archived since quote; re-read types; clear selection; no auto-retry of same type |
| `guest_not_found` / `guest_already_erased` | mapped | Context path: clear invalid ref, fall back to create; create path: surface create failure |
| `fail_closed` / 503 | — | Block commit; no client-side walk-in notepad |
| `entitlement_required` (402) | — | Inherit 402-reactive store; no new proactive entitlement chrome |

**Date-step (read-side, not commit):** availability rejects `toDate > fromDate + 89` with `date_range_exceeds_max` (400). Date step validates the 90-night cap locally before calling; still handle the wire error if it lands.

**Type step — zero selectable:** a successful all-types read can return `ariVersion` with no type meeting `free >= 1` (empty property, or sold out across the stay). Distinct from §2.6 read failure: copy points at **dates** (“No room types available for these dates — adjust dates”), not retry. Confirm stays disabled (no `roomTypeId`).

### 2.5 Type-only, quantity-only

`POST /reservations` accepts `{ reservationId, roomTypeId, guestRef, arrivalDate, departureDate, idempotencyKey, quoteAriVersion? }` — no `ratePlanId`, no `roomId`. Sell room type only.

- Type picker over availability (`free >= 1` on every stay night). Name: room-**type** step / `AvailableRoomTypesModal` — not `AvailableRoomsModal`.
- No price. `reservation` has no `rate_plan_id`; `quoteStay` defaults to BAR and is DO-only. A total without a plan picker is a quote the product does not hold as true. Leftover §7.1 names the schema gap.
- No `assign_room` in the happy path (independent `FAIL_CLOSED`; outage would leave “booked but unassigned” inside an atomic-feeling flow).

Labels = `roomTypeId`. No GET `/room-types`. Archived types zero `physical` forward → fail `free >= 1` and never appear selectable. Cosmetic leftover for `code`/`name`.

### 2.6 Availability `READ_STALE` — reuse board retry; block after exhaust

Not new to the SPA. Same query retry as Board/ShiftStrip (`read_stale` ×2, `retryAfterMs`).

**After retries exhausted:** **block the type step / Confirm** — do not commit on a failed quote. Clear / leave `quoteAriVersion` null. Distinct from board (rendering slightly old rows is OK). Full Confirm enablement is the §3.5 conjunction (quote alone is necessary, not sufficient).

### 2.7 Entry, defaults, success

- Nav: `{ id: 'book', label: 'Book', path: '/book', permission: 'reservations:write' }` via `filterNavEntries`.
- Route gate: `BookRoute` — StaffRoute pattern for `reservations:write`.
- Context: `?guestRef=` (opaque id; PII not in URL).
- Defaults: arrival = `propertyLocalToday(tz)`, departure = that date +1 via **calendar-part arithmetic** (not browser-local `Date` math).
- Success: `/arrivals?date=<arrivalDate>` with location state `{ createdReservationId }`; one-shot banner showing that id. Walk-in next action is check-in from the board; future booking confirmation is the dated list.
- Entitlements: all flow surfaces carry `pms.core`; inherit 402-reactive store (`/me` leftover — no proactive chrome).

### 2.8 Unrouted catalog rows

Defer both; name the asymmetry:

- `reservations.update_status` — **retargeted 2026-08-12** ([reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md)): stay front-office comment + VIP flag (`reservation.front_office_updated`), not the status machine.
- `reservations.update_extras` — sole carrier of `UPDATE_RESERVATION_EXTRAS` in `PROTOTYPE_ACTIONS` coverage. Retirement needs a third category (“not carried forward”), not a two-line delete. Flagged as retirement candidate for a VIP/extras vertical.

No SPA affordance for either.

### 2.9 Packaging

Approach 2: Task 0 → client-core → wizard. Approach 1 rejected (UI-only forgets `quoteAriVersion` → silent metric zero). Approach 3's hedge already covered by cherry-pickable Task 0.

---

## 3. Surfaces

### 3.1 Task 0 — contracts / check

Define `INVENTORY_FAIL_CLOSED_NOTES` (same wording cancel/no_show use today) and point **create, modify, cancel, no_show** at it — including refactoring the two that currently inline the literal. Precedent: `GUESTS_FAIL_CLOSED_NOTES`.

In `scripts/degraded-check.mjs`:

```js
for (const entry of COMMAND_CATALOG) {
  if (!entry.events?.includes('availability.changed')) continue;
  if (entry.degraded !== 'FAIL_CLOSED') { /* fail */ }
}
```

No opt-out list. Mutation proof: flip `reservations.create` → `QUEUE_PROVISIONAL` → check exits 1; restore. No duplicate contracts unit test restating the rule — the gate is the gate.

### 3.2 client-core

| Method | HTTP | Notes |
|---|---|---|
| `getAvailability(propertyId, { fromDate, toDate })` | `GET …/availability` | **No `roomTypeId` parameter** (enforces Branch 2). Comment that omission is deliberate — HTTP accepts it. |
| `createGuest(propertyId, { guestId, displayName, email?, phone? }, opId)` | `POST …/guests` | `stableKeyForOperation` |
| `createReservation(propertyId, input, opId)` | `POST …/reservations` | Body **always** includes `quoteAriVersion`. opId = `book:${reservationId}:${roomTypeId}:${arrivalDate}:${departureDate}:${guestRef}`. |

Typed commit / create failures via existing `ClassifiedError` + body fields (`date`, `rule`, `required`, `ariVersion`). No client fingerprint helper. No per-type availability refresh before commit.

### 3.3 Date ↔ availability range

Stay nights: `enumerateStayDates` half-open `[arrival, departure)`. Availability: `enumerateDaysInclusive` inclusive `[fromDate, toDate]`.

- Query: `fromDate = arrival`, `toDate = lastNight = departure − 1` (calendar-part arithmetic).
- Type selectable iff every night in that range has an item with `free >= 1` for that `roomTypeId`.
- Date step: local reject if range would exceed 90 nights; still handle wire `date_range_exceeds_max`.

### 3.4 web-pms files

| Piece | Path / shape |
|---|---|
| Nav | `nav.ts` — Book / `/book` / `reservations:write` |
| Route gate | `BookRoute.tsx` — StaffRoute pattern |
| Screen | `BookingScreen.tsx` / wizard composition |
| Type step | Inline or `AvailableRoomTypesModal` |
| App route | `App.tsx` — `path="book"` |
| Arrivals banner | `BoardScreen` (arrivals) — one-shot `location.state.createdReservationId` |
| Context links | Board / Folio — “Book for guest” → `/book?guestRef=` (Check-in deferred — leftover §7.10; screen has no reservation/`guestRef` read today) |

### 3.5 Wizard state (session)

Mint once on mount and hold: `reservationId`; `guestId` (create-default path only — **unused in context mode**, where `guestRef` comes from the URL and `createGuest` must not fire); `quoteAriVersion` (from last successful all-types read; cleared on read failure); dates; selected `roomTypeId`; guest profile / context mode.

**Steps:** (1) Dates → (2) Room type (read_stale retry; exhaust blocks Confirm; zero-selectable copy per §2.4) → (3) Guest create or context hydrate → (4) Confirm (`createGuest` only on create-default path when guest not yet created this session, then `createReservation`).

Success → `navigate(/arrivals?date=${arrivalDate}, { state: { createdReservationId } })`.

**Invariant (conjunction):** Confirm enabled iff `quoteAriVersion != null && roomTypeId != null && guestResolved`. `guestResolved` means context hydrate succeeded **or** create-default profile fields are valid (and after first successful `createGuest` in-session, the held `guestRef` stands). The `quoteAriVersion` clause remains the interesting TOCTOU gate and keeps its own necessary-direction test; do not treat quote-alone as sufficient.

### 3.6 Permissions at call sites

| Call | Permission |
|---|---|
| Availability | `inventory:read` |
| Guest create | `guests:write` |
| Reservation create | `reservations:write` |
| Context batch | `guests:read` |

Nav/route gate only `reservations:write`. Missing inventory/guests write → classified 403 + invalidate `me`. All four carry `pms.core` entitlement.

---

## 4. Error handling & degraded mode

- Create / guest create: `FAIL_CLOSED` → 503; block; no provisional book / notepad.
- Availability: `READ_STALE` → board-shaped retry; exhaust → block Confirm (`quoteAriVersion` null).
- 402 → existing entitlement store refresh.
- 403 → invalidate `me` (existing precedent).

---

## 5. Tests

### Task 0

- Four inventory commands reference `INVENTORY_FAIL_CLOSED_NOTES` (constant identity — no string-equality test between literals).
- Mutation: flip `reservations.create` → `QUEUE_PROVISIONAL` → `check:degraded` exits 1; restore.
- Skip a contracts unit test that restates the gate rule.

### client-core

- `createReservation` always includes `quoteAriVersion` in the body (captured fetch).
- `getAvailability` never appends `roomTypeId`.
- **opId composition:** same fingerprint fields → same key across two calls; changed `roomTypeId` → different key.

### web-pms

- Nav Book gated on `reservations:write`; BookRoute redirects without write.
- Defaults use `propertyLocalToday` (+1 calendar arithmetic) — not `todayUtc` / local multi-arg `Date`.
- Confirm disabled when `quoteAriVersion == null` (necessary). Confirm disabled when quote present but no `roomTypeId` or guest unresolved (conjunction).
- Zero selectable types after successful read: dates-adjustment copy; Confirm disabled.
- Context `?guestRef=`: batch hydrate; skip create; held `reservationId` reused; minted `guestId` unused.
- Session ids: guest create then failed book → retry does not mint a second `guestId` / `reservationId`.
- **409 same-type retry:** after `no_availability`, re-picking the same type sends an **identical** `idempotencyKey` to the first attempt; different-type retry sends a different one (captured fetch across two calls in one screen test).
- `no_availability` path: surfaces `date`; clears type; keeps dates/guest; re-read updates quote version.
- **`idempotency_key_reused` 409:** must **not** trigger re-read / clear-selection path; surfaces generic failure.
- `restriction_violated` / `unbookable` / `not_found` (404): distinct recovery copy/state.
- **90-night cap:** 91-night stay blocks without issuing availability request; wire `date_range_exceeds_max` still handled.
- **Context-path guest error:** `guest_not_found` / `guest_already_erased` → clear invalid ref, fall back to create form.
- Success navigate to `/arrivals?date=<arrival>` with banner state carrying `reservationId`.
- Availability `read_stale` retry shape matches board; exhaust → Confirm stays blocked.

### Explicit non-goals for tests

- Full E2E DO round-trips for every rejection code at the SPA layer. Server wire shape for stale-quote → `quoteAriVersion` is already pinned in `apps/pms-core/test/reservations-routes.spec.ts` (reads `{ error, ariVersion }` off rejection and feeds it back).
- BoardScreen date-seed fix.
- Quote/money assertions.
- Duplicating the `availability.changed ⇒ FAIL_CLOSED` gate as a contracts unit test.

---

## 6. Acceptance

- [ ] `INVENTORY_FAIL_CLOSED_NOTES` on create / modify / cancel / no_show
- [ ] `check:degraded` enforces `availability.changed ⇒ FAIL_CLOSED` (no opt-out); mutation proof green
- [ ] client-core: `getAvailability` / `createGuest` / `createReservation` with required `quoteAriVersion` and booking opId
- [ ] Nav Book + `/book` wizard (type-only, quantity-only, create-default guest + context path)
- [ ] Session ids minted once; Confirm gated on `quoteAriVersion`
- [ ] Commit recoveries per §2.4 including `idempotency_key_reused` (no re-read) and zero-selectable copy
- [ ] Success → arrivals dated board + banner with `reservationId`
- [ ] Leftovers §7 recorded; multi-line gate residual explicitly out

---

## 7. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | **Rates in booking** | **Schema landed 2026-08-12** ([reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md)): `reservation.rate_plan_id` is `NOT NULL DEFAULT 'BAR'`. The wizard remains quantity-only (no plan picker / total). `quoteStay` still defaults to BAR. |
| 2 | **Guest equality lookup** | Blind HMAC over normalized email/phone; key survives PII shred. Equality only — not prototype substring search. Abandoned wizard after step-3 `guests.create` leaves a guest with no reservation — legitimate standalone create, but without search that orphan is unreachable and will be re-created next visit, compounding this debt. [Prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) top-bar reservation search is an AppShell surface (stay id / guest name over stays), not a wizard guest-dedupe path. |
| 3 | **`BoardScreen` UTC seed** | **Closed 2026-08-13** by [property setup SPA](./2026-08-13-property-setup-spa-design.md) (`BoardScreen` seeds `propertyLocalToday`; `todayUtc` removed). |
| 4 | **Fingerprint field-set coupling** | Booking opId mirrors server fingerprint fields that exist only as an inline literal in `handlePostReservations`. Shared contracts export would want applying across ~10 fingerprinted routes — not this slice. |
| 5 | **SPA date-helper gate counterpart** | Booking is a second site of property-local calendar arithmetic under `apps/web-pms`. `check:pms-core-test-dates` covers pms-core tests only. Future SPA gate possible; out of this slice. |
| 6 | **Room-type directory (cosmetic)** | **Closed 2026-08-13** by [property setup SPA](./2026-08-13-property-setup-spa-design.md) (`GET /room-types` labels `{name} ({code)}`; FAIL_CLOSED falls back to id). |
| 7 | **`update_status` / `update_extras`** | **`update_status` retargeted 2026-08-12** to front-office comment + VIP ([reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md)). `update_extras` still deferred (§2.8). |
| 8 | **Proactive entitlement chrome** | Unchanged `/me` leftover; wizard inherits 402-reactive store only. |
| 9 | **Multi-line gate residual** | In `pms-core-test-dates-check.mjs`. Task 0 touches `degraded-check.mjs` only → **explicitly out**; leave until that script is next touched. |
| 10 | **Check-in “Book for guest”** | Spec once listed Check-in beside Board/Folio; plan scoped the link to rows that already expose `guestRef`. `CheckInScreen` only reads `reservationId` from the URL and never loads the reservation, so adding the link means adding a read. Deferred — optional when that screen grows a reservation fetch. |

---

## 8. Open questions

None. Product and packaging locks are above; implementer follows §2–§5. Leftovers are explicitly out.
