# Reservation Lifecycle Completion

**Date:** 2026-08-12  
**Status:** Draft v2 — review-round edits (P/R never halts audit; POST_ROOM_CHARGES prices from `reservation.rate_plan_id`; lazy-expiry wire codes unified)  

**Sources:** ARCHITECTURE.md §4.2 (lanes), §4.4 (single alarm slot), §4.6 (degraded classes + replay), §5.1 (DOMAIN config), §7.1 (room-type inventory; `held` reserved; assign-at-check-in; sold invariant), §7.3 (`folio.balance_due`), §7.4 (lifecycle machine), §16.5 (drift + still-unnamed rows); [reservations vertical](./2026-08-04-reservations-vertical-design.md); [booking wizard](./2026-08-11-booking-wizard-design.md); [night audit E2E](./2026-08-12-night-audit-e2e-design.md); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md); [rate plans](./2026-08-05-rate-plans-vertical-design.md); [rooms/housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md); [folio front desk](./2026-08-08-folio-front-desk-design.md); command catalog `reservations.*`; `PropertyDO` `tryCreateReservation` / `tryCancelReservation` / `tryModifyReservation` / `tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn` / `tryAssignRoom` / `tryNoShow` / `processNoShowsSync` / `postRoomChargesSync` / `readFolio` / `listArrivals`

**Closes follow-ons in:** ARCHITECTURE §16.5 (restore `INQUIRY`/`PENDING` or record deferral — this chunk restores); §16.5 still-unnamed rows for party composition, front-office comments, rate-plan cancellation policy; reservations-vertical deferred `reservations.update_status`; night-audit leftover 2 (no-show/cancel penalty once policy exists) and §8.3 “when a policy field exists”; booking-wizard leftover 1 (`rate_plan_id` on the reservation) and leftover 7 (`update_status` target).

**Amends:** ARCHITECTURE.md §7.1 sold invariant and assign-at-check-in clarification; §7.4 (machine now matches code); §16.5 drift paragraph (no longer a disagreement); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) §3.2 / §8.3 (PROCESS_NO_SHOWS gains pending-expiry + policy-aware penalty; `SYSTEM_CHARGE_CODES` grows) **and** `POST_ROOM_CHARGES` rate lookup (`DEFAULT_RATE_PLAN_ID` → `reservation.rate_plan_id`; predicate unchanged); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md) §2.3 (arrivals filter widens to `confirmed | pending`); [booking wizard](./2026-08-11-booking-wizard-design.md) leftover 1 and 7; [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md) `RESERVATION_STATUSES` / `boardRowSeverity` exhaustiveness. Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

The front-desk status machine shipped. The architecture’s reservation lifecycle did not. §16.5 forbids leaving that silent: *restore `INQUIRY` and `PENDING`, or record here that they are deferred.* This chunk restores them, and finishes the three transitions the desk actually runs every day — check-in (assignment + cleanliness), check-out (balance + HK dirty), cancel (penalty).

### 1.1 What already exists (do not re-spec)

| Piece | Where (verified) |
|---|---|
| Status CHECK | `reservation` rebuild in `0011_room_and_housekeeping.sql`: `confirmed \| cancelled \| checked_in \| checked_out \| no_show`. Contracts set `RESERVATION_STATUSES` in `packages/contracts/src/reservation-status.ts` (5 values). Sync test pins v8 SQL to that set (`packages/do-runtime/src/reservation-status-sync.test.ts`). |
| Create | `tryCreateReservation` (~4071): always `INSERT … status = 'confirmed'`, increments `sold`, emits `reservation.created` + `availability.changed`. No `rate_plan_id`, no party fields. |
| Cancel | `tryCancelReservation` (~4269): `status === 'confirmed'` only; else `ALREADY_CANCELLED`. Releases `sold`. No folio post. |
| Modify | `tryModifyReservation` (~4401): `status === 'confirmed'` only; else `NOT_MODIFIABLE`. |
| Check-in | `tryCheckIn` (~4690): `confirmed → checked_in`. Selects `guest_ref, pii_key_id, status` only — **ignores `room_id`**. No cleanliness. `QUEUE_PROVISIONAL`. No `appendAuditLogSync`. |
| Check-out | `tryCheckOut` (~4766): `checked_in → checked_out`. Bare status flip. FolioScreen already `window.confirm`s an open balance and then checks out anyway (`FolioScreen.tsx` ~314–323: *“Checkout does not require settlement.”*). |
| Cancel check-in | `tryCancelCheckIn` (~4842): `checked_in → confirmed`. Leaves `room_id` untouched (it never reads it). |
| Assign room | `tryAssignRoom` (~3793): allowed on `confirmed \| checked_in`; type match; overlap conflict → `ROOM_ALREADY_ASSIGNED`; does **not** read `room.status`. `FAIL_CLOSED`. |
| No-show | `tryNoShow` (~4918) + `processNoShowsSync` (~1898): `confirmed` only; `arrival_date <= businessDate`; releases `sold`; **no folio line** (night-audit §8.3). |
| Night audit | `NIGHT_AUDIT_STEPS` (`property-do.ts` ~504): `PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → …`. `postRoomChargesSync` (~7190): `status IN ('confirmed', 'checked_in') AND arrival_date <= D AND departure_date > D`; **prices `ROOM` from `rate_day` with hardcoded `DEFAULT_RATE_PLAN_ID`** (~7212) — correct today only because reservations carry no plan; this chunk changes the lookup (§13). `processNoShowsSync`: `status = 'confirmed' AND arrival_date <= D`. |
| Folio balance | `readFolio` (~8666): `balanceMinor = sum(ledger_amount_minor)` across all `folio_line` for the reservation. |
| Room HK | `room.status` CHECK `clean \| dirty \| inspected \| out_of_order` (`0011`). `rooms.update_status` is `QUEUE_PROVISIONAL`, last-writer-wins. |
| Rate plan | `rate_plan` (`0012`): `rate_plan_id, code, name, status`. No policy columns. Seed `BAR`. `SYSTEM_CHARGE_CODES = ['ROOM', 'PAYMENT']` (`property-migrations.ts` ~395). |
| Front-desk lists | Routes already exist: `V1_HTTP_ROUTE_AUDIT[62..64]` = `get_front_desk_arrivals` / `departures` / `in_house`. `listArrivals` filters `status = 'confirmed'` only. Payloads: id, type, guestRef, dates, status, `roomId`. |
| Booking wizard | Creates `confirmed` directly. Quantity-only; no plan; no Hold/Quote. |
| `held` | Ledger column exists, always 0. §7.1: unused until central reservations / group holds (Phase 3). |
| Degraded replay | `REPLAY_DISPATCH` in `pending-commands-consumer.ts` already lists `check_in` / `check_out` / `cancel_check_in` with payload `{ reservationId }`. |
| Route head | Last used index **91** (`post_provisional_exception_resolve`). Next free **92**. |
| Migration head | `PROPERTY_MIGRATIONS` version **19** (`night_audit_e2e`). Next free **20**. |
| Audit writers | `AUDIT_WRITER_COMMAND_IDS.size === 33`. Entitled FAIL_CLOSED reservation commands already in the set: create, cancel, no_show, assign_room, modify. Check-in/out/cancel_check_in are **not** in the set (ungated QUEUE_PROVISIONAL). |
| `update_status` | Catalog id exists (`catalog.ts` ~128): `QUEUE_PROVISIONAL`, events `reservation.status_changed`, notes *“Non-inventory status notes only (e.g. VIP flag).”* No DO method, no route. |
| `update_extras` | Catalog id exists (~654). Out of this chunk (booking-wizard leftover 7 named the pair; this chunk retargets `update_status` only). |

### 1.2 Scope in

1. Restore `inquiry` and `pending` on the reservation machine (§3). Inventory, expiry, night-audit interaction, and entry points are locked — not left to the implementer.
2. Check-in ↔ assignment ↔ cleanliness interlocks, including the provisional replay path (§4).
3. Check-out balance gate + `folio.balance_due` + HK dirty handoff (§5).
4. Rate-plan cancellation policy + penalty computation + folio post on cancel and no-show, desk and night audit (§6).
5. Fold-ins: party composition, front-office comment + VIP flag, retarget `reservations.update_status`, enrich existing arrivals/departures/in-house reads (§7).
6. `rate_plan_id` on the reservation (required to know which policy applies; also closes booking-wizard leftover 1 as schema, not as a priced wizard).
7. `POST_ROOM_CHARGES` prices ROOM from `reservation.rate_plan_id` (predicate unchanged). Without this, §6.5’s `P === R` no-op is false for every non-BAR stay.

### 1.3 Scope out

- Group blocks / allotments (§7.4 separate aggregate, Phase 2).
- Deposits / payment capture at confirmation (folio money-ops). `folio.balance_due` is the event seam only.
- Tape chart SPA.
- Using `availability_day.held` (CRS / group holds, Phase 3 — §7.1).
- Auto-assign (`pms.ops.auto_assign_rooms` exists, unread; leftover).
- Closing the folio window on check-out (window stays `OPEN`; late charges remain the existing exception path).
- Implicit confirm-on-check-in from `pending` (two commands).
- Priced booking wizard / plan picker (schema lands; wizard stays quantity-only except Hold/Quote status).
- `reservations.update_extras` retirement.
- DND as a room status, recurring incidentals, registration-card print, global reservation search, room-type photos — other §16.5 rows, other verticals.
- New night-audit step (expiry folds into `PROCESS_NO_SHOWS`; the 7-step sequence does not grow).

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Availability is a ledger.** Inquiry never writes `sold` or `held`. Pending and confirmed (and the in-house / checked-out continuation of those nights) do write `sold`. Nothing in this chunk writes `held`.
2. **Validate-then-mutate** (§7.1). Every inventory-affecting command finishes precondition checks before any ledger write. `{ ok: false }` leaves no partial `sold`.
3. **`availability.changed` ⇒ `FAIL_CLOSED`** (`check:degraded`, no opt-out). New inventory commands inherit `INVENTORY_FAIL_CLOSED_NOTES`.
4. **`held` stays 0.** Pending is not a CRS hold. Activating `held` is a Phase 3 decision with TTL + ARI-unavailable + abandoned-hold monitoring (§7.1). This chunk must not be the place that decision silently happens.
5. **Assignment is required at check-in, not forbidden before it.** Pre-assign via `reservations.assign_room` on `pending | confirmed` remains legal. Check-in without a room (pre-assigned or in-payload) is rejected. No `waitingForRoom` flag (§16.5 already rejected that product).
6. **OOO never houses a guest.** Cleanliness is config-driven; `out_of_order` is not.
7. **Check-in / check-out / cancel_check_in stay `QUEUE_PROVISIONAL` and stay entitlement-ungated** (reservations-vertical §2.3a). New interlocks re-validate on replay; failure → `provisional_exception`, never a guessed apply. They do not start reading `availability_day`.
8. **Cancellations that can post a penalty stay `FAIL_CLOSED`.** §4.6 already classified them that way. This chunk is what makes the classification true rather than aspirational.
9. **Night-audit `PROCESS_NO_SHOWS` predicate for no-show stays `status = 'confirmed' AND arrival_date <= D`.** Pending that crosses arrival is **expired to `cancelled`**, not no-showed. `POST_ROOM_CHARGES` predicate stays `confirmed | checked_in` (night-audit §3.2 lock). The **rate lookup** switches from hardcoded `DEFAULT_RATE_PLAN_ID` to `reservation.rate_plan_id` (§13). A `P !== R` no-show reconciliation **must not** fail the audit step.
10. **Single alarm slot is not a hold timer** (§4.4). Pending expiry is lazy-on-touch + the existing `PROCESS_NO_SHOWS` body. No per-reservation alarm.
11. **Policy is snapshotted onto the reservation** at the moment inventory is first committed (`pending` or `confirmed` create, or inquiry→pending/confirmed). Later `rates.update_plan` does not rewrite existing stays.
12. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
13. **New catalog commands** carry lane + degraded + idempotent + events + permission, and entitlement when `FAIL_CLOSED` with events. New events appear in `event-consumer.ts` (catalog allowlist test).
14. **Route audit append-only.** New routes start at index 92. Do not insert before existing pins (`register.test.ts` pins `[91] = post_provisional_exception_resolve`).
15. **Sold invariant (amended §7.1):** for each `(room_type_id, stay_date)`, `sold` equals the count of reservations in `pending | confirmed | checked_in | checked_out` whose stay covers that night. `inquiry`, `cancelled`, and `no_show` do not count. `countConfirmedReservationsCovering` is renamed and widened; the property test (`reservations-ledger.property.spec.ts`) must include pending + check-in/out sequences.

---

## 3. INQUIRY / PENDING — the ledger decision

§16.5: *Do not silently drop `INQUIRY` / `PENDING`.* This chunk implements them. §7.4’s graph becomes the shipped machine.

### 3.1 Why `sold` and not `held`

| Option | Reject / lock | Why |
|---|---|---|
| PENDING increments `held` | **Reject** | §7.1 reserved `held` for central reservations / group blocks. Activating it requires hold-expiry on `AlarmScheduler`, ARI treating held as unavailable, and abandoned-hold monitoring — a Phase 3 behaviour this chunk is forbidden to invent as a side effect. |
| PENDING holds nothing | **Reject** | Then PENDING is INQUIRY with a different name. A confirmation deadline that does not reserve the room is not a hold. |
| PENDING increments `sold` | **Lock** | An individual option *is* a committed room-type sale awaiting guest confirmation. Release-on-cancel already exists (`tryCancelReservation`). ARI already treats `sold` as unavailable. No new ledger column. |

INQUIRY is a quote. It does not read or write `availability_day`. It does not evaluate restrictions. Converting it to pending or confirmed is the first inventory transaction.

### 3.2 Status machine (replaces reservations-vertical §2.1)

`RESERVATION_STATUSES` becomes:

```
inquiry | pending | confirmed | cancelled | checked_in | checked_out | no_show
```

Transition graph — everything not listed is `INVALID_STATUS_TRANSITION`:

```
(create inquiry)                  → inquiry
(create pending)                  → pending          [sold +1]
(create confirmed)                → confirmed        [sold +1]   (today’s path; wizard default)

inquiry   --hold-->               pending            [sold +1]
inquiry   --confirm-->            confirmed          [sold +1]
inquiry   --cancel-->             cancelled          [no ledger]
inquiry   --expire-->             cancelled          [no ledger]

pending   --confirm-->            confirmed          [no ledger — already sold]
pending   --cancel-->             cancelled          [sold −1, penalty maybe]
pending   --expire-->             cancelled          [sold −1, no penalty]
pending   --modify-->             pending            [sold release/acquire]

confirmed --check_in-->           checked_in         [no ledger]
confirmed --cancel-->             cancelled          [sold −1, penalty maybe]
confirmed --no_show-->            no_show            [sold −1, penalty maybe]
confirmed --modify-->             confirmed          [sold release/acquire]

checked_in --check_out-->         checked_out        [no ledger]
checked_in --cancel_check_in-->   confirmed          [no ledger]

cancelled, checked_out, no_show   terminal
```

`pending --check_in-->` is **illegal**. Confirm first. The SPA may offer “Confirm & check in” as two commands; the DO does not collapse them.

`assign_room` allowed statuses widen from `confirmed | checked_in` to `pending | confirmed | checked_in`. Inquiry is not assignable (`ROOM_NOT_ASSIGNABLE`).

### 3.3 Inventory effect per state

| Status | `sold` | `held` | Restrictions at entry | `availability.changed` on enter / leave |
|---|---|---|---|---|
| `inquiry` | no | no | no | no / no |
| `pending` | **yes** (every stay night) | no | yes (same as create) | yes / yes (cancel or expire) |
| `confirmed` | yes | no | yes | yes / yes (cancel or no-show) |
| `checked_in` / `checked_out` | still yes (nights stay consumed) | no | n/a | no |
| `cancelled` / `no_show` | released | no | n/a | yes (the release) |

Create with `status: 'inquiry'` skips the availability loop and the `sold + 1` loop. Create with `pending` or omitted/`confirmed` keeps today’s loop.

`check:degraded` still sees `availability.changed` on `reservations.create` → create stays `FAIL_CLOSED` even for inquiry. One command, one class. An inquiry during a PropertyDO outage is 503, not a queued quote.

### 3.4 Expiry

**Fields**

| Field | On | Meaning |
|---|---|---|
| `confirm_by` | `pending` NOT NULL | Unix ms. After this instant the hold is dead. |
| `expires_at` | `inquiry` nullable | Unix ms. Hygiene; no inventory. |

**Defaults (DOMAIN config, §8)**

| Key | Default | Use |
|---|---|---|
| `pms.reservations.pending_hold_hours` | `24` (int 1–168) | `confirm_by = now + hours` when the client omits it |
| `pms.reservations.inquiry_ttl_days` | `7` (int 1–90) | `expires_at = now + days` when the client omits it |

Per-reservation override is allowed on create / hold (`confirmBy` / `expiresAt` as ISO instants). The DO stores ms.

**Do not clamp `confirm_by` to arrival 00:00.** A same-day hold created at 10:00 for tonight would be born expired. A hold *may* outlive midnight; what it may not do is survive the night audit of its arrival date (below).

**Sweep owner: lazy-on-touch + `PROCESS_NO_SHOWS`. No alarm.**

Lazy-on-touch runs at the start of `tryConfirm`, `tryHold`, `tryModifyReservation`, `tryCancelReservation`, `tryAssignRoom`, `tryCheckIn`, `tryNoShow` (and any other reservation mutation that loads the row). Implementation: private `expireIfDueSync(reservationId)` inside the same `transactionSync`, **before** the command’s own status checks. Returns whether it fired.

| Due condition | Action |
|---|---|
| `pending` and `confirm_by <= now` | status `cancelled`, `sold − 1`, `reservation.status_changed` `{ fromStatus: 'pending', toStatus: 'cancelled', reason: 'expired' }`, `availability.changed`, audit actor `system:expiry` (or `system:night_audit` on the audit sweep). **No penalty.** |
| `inquiry` and `expires_at IS NOT NULL AND expires_at <= now` | status `cancelled`, no ledger. **No penalty.** |

**Wire after `expireIfDueSync` fired — one rule:**

| Caller | Result |
|---|---|
| `tryCancelReservation` | **`ok`** — the expiry already released inventory and flipped status. Cancel of an expired hold succeeding is the least surprising desk behaviour. Naturally idempotent: one release, no penalty, no second `availability.changed`. A **later** cancel of the now-`cancelled` row (new command / new key) is `ALREADY_CANCELLED`. |
| Every other caller (`tryConfirm`, `tryHold`, `tryModifyReservation`, `tryAssignRoom`, `tryCheckIn`, `tryNoShow`, …) | **`HOLD_EXPIRED`** (was pending) or **`INQUIRY_EXPIRED`** (was inquiry). That is why the codes exist — “no longer”, distinct from “never” (`INVALID_STATUS_TRANSITION`). Do **not** fall through to `INVALID_STATUS_TRANSITION` after a same-txn expiry. |

`HOLD_EXPIRED` / `INQUIRY_EXPIRED` are 422. They are not cached idempotent failures (ledger-state preconditions — same class as `NO_AVAILABILITY`): the key remains retryable only in the sense that a *new* command on a still-live row would work; this row is now `cancelled`.

**Night audit (`PROCESS_NO_SHOWS` body, same Txn B, still not calling async `tryNoShow`):**

After the existing confirmed-no-show loop (or before — order locked below):

1. **Expire pending that missed the stay or the deadline.**  
   `status = 'pending' AND (confirm_by <= <audit_now_ms> OR arrival_date <= D)`  
   → `cancelled`, release `sold`, events as above, actor `system:night_audit`, `command_id: 'night_audit.run'`.  
   **No penalty** on expiry (the guest never confirmed; there is no contract to breach).
2. **Expire inquiry past TTL.**  
   `status = 'inquiry' AND expires_at IS NOT NULL AND expires_at <= <audit_now_ms>`  
   → `cancelled`, no ledger. Also expire inquiry with `arrival_date <= D` (a quote for a day that has closed is dead) even if `expires_at` is null or future.
3. **Then** the existing confirmed no-show loop.

`audit_now_ms` is `Date.now()` during the step (same clock `confirm_by` used). Arrival-date comparison uses the closing `business_date` `D`, not wall-clock.

**A PENDING that crosses its arrival date** becomes `cancelled` (expired), inventory released, **not** `no_show`. No-show is a confirmed guest who did not arrive. Night audit’s no-show predicate is unchanged. `POST_ROOM_CHARGES` never posted ROOM for that pending row (predicate excludes `pending`), so expiry does not reverse a room charge.

**Same-day pending, guest confirms at 17:00, never checks in:** they are `confirmed` at audit; `PROCESS_NO_SHOWS` no-shows them; ROOM may already exist from `POST_ROOM_CHARGES`. That is the confirmed path, not the pending path.

### 3.5 Entry points

| Path | Status | Wizard |
|---|---|---|
| Today’s `POST /reservations` (body `status` omitted) | `confirmed` | Unchanged Confirm |
| `POST /reservations` `{ status: 'pending' }` | `pending` | **Hold** secondary button |
| `POST /reservations` `{ status: 'inquiry' }` | `inquiry` | **Quote** secondary button |
| `POST …/hold` | `inquiry → pending` | Reservation/quote row action |
| `POST …/confirm` | `inquiry \| pending → confirmed` | Arrivals row action for pending |

Wizard Confirm stays the default and stays direct-confirm. Hold/Quote reuse the same dates / type / guest / `quoteAriVersion` / session ids. OpId composition (§2.3 of the wizard spec) gains `:${status}` so Hold vs Confirm remint the idempotency key.

Inquiry create does not send a meaningful `quoteAriVersion` classification on `NO_AVAILABILITY` (it cannot hit that error). Pending/confirmed create keep today’s `ari.reject_on_commit` behaviour.

### 3.6 Amend `tryCancel` / `tryModify` gates

| Command | Today | This chunk |
|---|---|---|
| `tryCancelReservation` | `confirmed` only; else `ALREADY_CANCELLED` | `inquiry \| pending \| confirmed`. Inquiry: status only. Live pending/confirmed: release `sold` + penalty (§6). **Due** pending/inquiry: `expireIfDueSync` fires, then **ok** (§3.4) — no penalty. Other statuses (including a previously expired row on a new key): `ALREADY_CANCELLED`. |
| `tryModifyReservation` | `confirmed` only | `inquiry \| pending \| confirmed`. Inquiry: dates/type/party only, no ledger. Pending/confirmed: today’s release/acquire. Due hold/quote: `HOLD_EXPIRED` / `INQUIRY_EXPIRED`, not `NOT_MODIFIABLE`. |
| `tryNoShow` | `confirmed` + `businessDate >= arrivalDate` | Unchanged set. Pending is not a no-show. Due pending: `HOLD_EXPIRED` (not `INVALID_STATUS_TRANSITION`). |

---

## 4. Assign-at-check-in / cleanliness triangle

Three machines meet on `confirmed → checked_in`: reservation status, physical `room_id` occupancy, `room.status`.

### 4.1 Check-in requires a room (gate, not flag)

§7.1: *assignment happens at check-in.* §16.5: `waitingForRoom` is a different product and is not an unnamed gap.

**Lock: `ROOM_REQUIRED` unless a room is resolved.** Resolution order inside the transaction:

1. `input.roomId` if present.
2. Else `reservation.room_id` (pre-assign).
3. Else reject `ROOM_REQUIRED`.

If both are present and differ, the payload wins: run the assign-room conflict checks (type, overlap, not OOO) against `input.roomId` and write `reservation.room_id` in the **same** transaction as the status flip. That is “assignment happens at check-in” as one desk action.

`pms.ops.auto_assign_rooms` is **not** consulted (leftover).

### 4.2 Cleanliness

| Room status | Default (`pms.reservations.check_in_cleanliness = 'strict'`) | `= 'off'` |
|---|---|---|
| `clean` / `inspected` | allow | allow |
| `dirty` | reject `ROOM_NOT_READY` unless `overrideCleanliness: true` **and** `pms.reservations.allow_dirty_check_in_override` is true | allow |
| `out_of_order` | reject `ROOM_OUT_OF_ORDER` — **no override** | reject — **no override** |

`assign_room` (the standalone command) additionally rejects `out_of_order` from this chunk (today it does not read `room.status`). Dirty pre-assign remains legal — HK may still be finishing.

Override is an explicit payload flag, same `reservations:write` permission, written to `audit_log` (`afterJson.overrideCleanliness: true`). Not a new permission.

### 4.3 Why check-in stays `QUEUE_PROVISIONAL`

Adding a room read means two queued check-ins for the **same** room do not commute. §4.6’s original justification (“check-ins for different reservations commute”) was written when `tryCheckIn` did not touch rooms. The architecture already carved the resolution: *“A check-in whose room was reassigned during the outage fails validation and lands in the exception queue.”*

**Lock:** keep `QUEUE_PROVISIONAL` + entitlement-ungated. Contention or a failed cleanliness/OOO/missing-room check on replay is an exception, not a silent apply, not a promotion to `FAIL_CLOSED`. Promoting would disable the one command the lobby still has during a PropertyDO outage.

They still must not read `availability_day`. Room occupancy is last-writer-wins on a single `reservation.room_id` plus a conflict SELECT; the loser exceptions. That is the existing assign-room invariant, evaluated at apply time.

### 4.4 Replay path (`REPLAY_DISPATCH['reservations.check_in']`)

Widen payload to `{ reservationId, roomId?: string, overrideCleanliness?: boolean }`. Same `tryCheckIn` body as live — there is no second implementation. `assertProvisionalBusinessDateOpen` stays first.

| Replay condition | Result |
|---|---|
| Already `checked_in` (idempotent hit) | ack, no re-apply |
| Status not `confirmed` | domain failure → `provisional_exception` (`HOLD_EXPIRED` / `INQUIRY_EXPIRED` if `expireIfDueSync` fired this txn; otherwise `INVALID_STATUS_TRANSITION`) |
| No resolved room | `provisional_exception` `ROOM_REQUIRED` |
| Room type mismatch / overlap / OOO | `provisional_exception` (existing assign codes) |
| Dirty and no override / override disabled | `provisional_exception` `ROOM_NOT_READY` |
| Business date closed | existing `BUSINESS_DATE_CLOSED` exception |

`issuedAt` / `businessDate` attribution unchanged (§4.6 envelope).

During an outage the desk **cannot** `assign_room` (`FAIL_CLOSED`). They can queue check-in only if they already know a `roomId` (typed, or remembered from before the outage) or the reservation was pre-assigned. CheckInScreen copy today (*“Room assignment is optional. During an outage, assignment refuses and check-in can still queue.”*) is **wrong after this chunk** and must change (§11).

### 4.5 `cancel_check_in` and the room

| Effect | Lock |
|---|---|
| Status | `checked_in → confirmed` (unchanged) |
| `reservation.room_id` | **kept** — assignment was a desk decision, not a consequence of being in-house. Re-check-in reuses it unless `assign_room` moves it. |
| `room.status` | **unchanged** — they did not stay; do not dirty. |
| Inventory | untouched (unchanged) |

Replay: same as today plus the keep-assignment rule (already true because the method never touched `room_id`).

### 4.6 Check-in events and audit

Catalog `reservations.check_in` events become `['reservation.status_changed', 'reservation.room_assigned']`. The room-assigned event fires only when this command wrote `room_id` (payload assign or first assign). Pre-assigned no-op does not emit a second `reservation.room_assigned`.

`appendAuditLogSync` is added on check-in / check-out / cancel_check_in because overrides are now load-bearing. They stay **off** `AUDIT_WRITER_COMMAND_IDS` (that set is entitled commands; these stay ungated). Actor is the operator; provisional extras already flow through `statusChangeOutboxExtras`.

---

## 5. Check-out depth

Today `tryCheckOut` is a status flip. Two additions; both re-validate on replay.

### 5.1 Balance-due gate

Use the existing `readFolio` reduction: `balanceMinor = Σ folio_line.ledger_amount_minor` for the reservation (all windows). No new calculator.

| Config | Default | Effect |
|---|---|---|
| `pms.reservations.check_out_require_zero_balance` | `true` (DOMAIN) | `balanceMinor > 0` → `BALANCE_DUE` unless overridden |
| `pms.reservations.allow_balance_override` | `true` (OPERATIONAL) | permits `overrideBalance: true` |

When `require_zero_balance` is false, open balance is allowed without a flag (still emit the event).

**`folio.balance_due`** (§7.3) is emitted when `balanceMinor > 0` at the successful transition, including overrides. Payload: `{ propertyId, reservationId, balanceMinor, currency, overridden: boolean }`. Not emitted when the balance is 0. Payments may auto-capture later; this chunk does not capture.

FolioScreen’s `window.confirm` becomes the override UX: Confirm → `overrideBalance: true`. Cancel → do not call. The server is the authority; the dialog is not a substitute. Copy today (*“Checkout does not require settlement.”*) is deleted.

**Degraded / replay.** Check-out stays `QUEUE_PROVISIONAL`. Payments are `FAIL_CLOSED`, so during an outage the balance cannot go *down*. Non-payment `folio.add_item` is `QUEUE_PROVISIONAL` and does not commute with a balance gate:

- Check-out replays first, charges later: guest is `checked_out` with a subsequent late charge. Folio window stays `OPEN` (this chunk does not close it). Late charge is the existing “checked-out still open window” situation, not a new invention.
- Charges replay first, check-out second without override: `BALANCE_DUE` → `provisional_exception`. Correct.
- Operator overrode on a stale zero: override is in the payload; replay applies. Audit shows the override.

Nothing auto-resolves into money (§4.6 rule 5). The gate reads; it does not post.

### 5.2 HK handoff

On successful check-out, if `reservation.room_id` is set:

1. `UPDATE room SET status = 'dirty', updated_at = ?` (even if already dirty — idempotent).
2. Emit `room.status_changed` `{ propertyId, roomId, fromStatus, toStatus: 'dirty' }` (same shape `rooms.update_status` already emits).

If `room_id` is NULL (legacy in-house rows from before this gate): skip HK; still flip status and apply the balance gate. Do not fail departure for a missing room.

`room_id` is **kept** after check-out (which room they occupied).

**Replay vs HK last-writer-wins.** A queued check-out dirty and a queued `rooms.update_status` clean on the same room: last replay wins. That is the existing room-status protocol. Prefer dirty-on-departure even if it overwrites a premature clean — HK re-cleans. Do not exception on this collision.

### 5.3 Catalog events

`reservations.check_out` events become `['reservation.status_changed', 'room.status_changed', 'folio.balance_due']`. `room.status_changed` is already in `event-consumer.ts`. `folio.balance_due` is new — add a `case` (presence + `propertyId` / `reservationId` / numeric `balanceMinor`).

`availability.changed` is **not** added (would force `FAIL_CLOSED` via `check:degraded`).

---

## 6. Cancel with penalty / no-show penalty

Night-audit §8.3 deferred posting until a policy field exists. This is that field. Penalty posting lands on **both** `tryCancelReservation` / `tryNoShow` and `PROCESS_NO_SHOWS`.

### 6.1 Rate-plan policy columns

`ALTER` on `rate_plan` (v20, additive — no rebuild):

```sql
ALTER TABLE rate_plan ADD COLUMN cancel_penalty_type TEXT NOT NULL DEFAULT 'none'
  CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full'));
ALTER TABLE rate_plan ADD COLUMN cancel_grace_hours INTEGER NOT NULL DEFAULT 0
  CHECK (cancel_grace_hours >= 0 AND cancel_grace_hours <= 8760);
ALTER TABLE rate_plan ADD COLUMN cancel_penalty_nights INTEGER
  CHECK (cancel_penalty_nights IS NULL OR (cancel_penalty_nights >= 1 AND cancel_penalty_nights <= 30));
ALTER TABLE rate_plan ADD COLUMN cancel_penalty_bps INTEGER
  CHECK (cancel_penalty_bps IS NULL OR (cancel_penalty_bps >= 0 AND cancel_penalty_bps <= 10000));
ALTER TABLE rate_plan ADD COLUMN cancel_policy_text TEXT;
```

Seeded `BAR` gets `none` / `0` — **existing properties do not suddenly charge.** Operators set policy via `rates.update_plan` (extend input + fingerprint `{ ratePlanId, code?, name?, cancelPenaltyType?, cancelGraceHours?, cancelPenaltyNights?, cancelPenaltyBps?, cancelPolicyText? }`).

Validation: `nights` requires `cancel_penalty_nights`; `percent` requires `cancel_penalty_bps`; other types ignore those columns (store NULL).

### 6.2 Snapshot on the reservation

When inventory is first committed (create pending/confirmed, or inquiry hold/confirm), copy:

```
rate_plan_id              TEXT NOT NULL DEFAULT 'BAR'
cancel_penalty_type       TEXT NOT NULL DEFAULT 'none'
cancel_grace_hours        INTEGER NOT NULL DEFAULT 0
cancel_penalty_nights     INTEGER
cancel_penalty_bps        INTEGER
```

Create/hold/confirm accept optional `ratePlanId` (default `DEFAULT_RATE_PLAN_ID`, `ensureDefaultRatePlanSync`, active-plan check → `RATE_PLAN_NOT_FOUND`). Inquiry stores `rate_plan_id` as the intended plan (for later hold/confirm) but does **not** snapshot penalty fields until the hold/confirm.

Modify does **not** re-snapshot. Grace is evaluated against the reservation’s **current** `arrival_date`.

### 6.3 Computation

`penaltyMinor(reservation, nowMs, timeZone) → number` (ledger minor units).

1. Inquiry, or expiry (not operator cancel): **0**.
2. Snapshotted `cancel_penalty_type === 'none'`: **0**.
3. Let `arrivalStart` = property-TZ midnight of `arrival_date` as ms. If `nowMs < arrivalStart - cancel_grace_hours * 3600_000`: **0**.
4. Else price from `rate_day` at **cancel time** for `reservation.rate_plan_id` (current published rate, not an original quote — the wizard still does not store a quote; named leftover: quote snapshot).

| Type | Amount |
|---|---|
| `first_night` | `rate_day.amount_minor` on `arrival_date` |
| `nights` | sum of `rate_day` on the first `cancel_penalty_nights` stay nights (clamp to LOS) |
| `percent` | `Number(roundHalfAwayFromZero(BigInt(stay_total) * BigInt(cancel_penalty_bps), 10000n))` — the real export in `packages/money` (`roundHalfAwayFromZero(numerator, denominator)`). Penalty amounts are non-negative; half-away-from-zero is the intended rounding. |
| `full` | stay total (sum of `rate_day` over all stay nights) |

Missing `rate_day` when the computed type needs it → `RATE_MISSING` (fail closed; do not cancel/no-show without being able to price). Type `none` or in-grace does not look up rates.

No-show uses the **same** snapshot. After arrival, grace is always elapsed, so the penalty type applies in full.

### 6.4 Folio posting — desk

Charge codes (v20 seed, add to `SYSTEM_CHARGE_CODES`):

```
('CANCEL', 'Cancellation fee', tax_group = 'ROOM')
('NO_SHOW', 'No-show fee', tax_group = 'ROOM')
```

Protected like `ROOM` / `PAYMENT`.

On operator cancel of `pending | confirmed`, if `penaltyMinor > 0`: `insertFolioLineSync` + `stampTaxForChargeSync` in the **same** transaction as the status/ledger write. `charge_code = 'CANCEL'`, `source = 'DESK'`, `business_date = open business date`. Deterministic id `${reservationId}:cancel:${businessDate}`. Emit `folio.line_posted` in addition to today’s cancel events.

On desk `tryNoShow`, same with `charge_code = 'NO_SHOW'`, id `${reservationId}:noshow:${businessDate}`. Desk no-show is usually *before* that night’s audit, so no ROOM line exists yet (`POST_ROOM_CHARGES` will skip them — they are no longer `confirmed | checked_in`).

Inquiry cancel: no line.

Catalog: add `folio.line_posted` to `reservations.cancel` and `reservations.no_show` events (already allowlisted).

### 6.5 Folio posting — `PROCESS_NO_SHOWS`

`POST_ROOM_CHARGES` still runs first and still posts `ROOM` / `NIGHT_AUDIT` for remaining `confirmed` arrivals (predicate unchanged). It now prices that ROOM from `reservation.rate_plan_id` (§13), not `DEFAULT_RATE_PLAN_ID`. Then this step no-shows them.

Let `R` = `ledger_amount_minor` of the `ROOM` / `NIGHT_AUDIT` line for `(reservation, D)` (0 if none).  
Let `P` = `penaltyMinor` from the snapshot.

**`P < R` is a legitimate operator configuration** (e.g. `percent` 50% on a 1-night stay; `nights = 1` when night D’s rate is below the arrival night). It must **not** fail the audit step. No `ledger_inconsistent` branch. Evaluate in this order:

| Relation | Action |
|---|---|
| `P === 0` | Reverse the `ROOM` / `NIGHT_AUDIT` line (and its `TAX` dependents) with `source = 'SPLIT_REVERSAL'` (existing reversal source — **not** a second `NIGHT_AUDIT` `ROOM`, which `folio_line_audit_uniq` would reject). Net: free no-show, no leftover first-night charge. If `R === 0`, no-op. |
| `P === R` | **No-op.** The ROOM line *is* the penalty. This equality is true for `first_night` when `arrival_date = D` **because** `POST_ROOM_CHARGES` and `penaltyMinor` now read the same `rate_day` row: `(room_type_id, reservation.rate_plan_id, stay_date = D = arrival_date)`. Without the §13 lookup change the no-op would silently break on a non-BAR plan. |
| `P !== R` (both `P > R` and `P < R`) | Reverse ROOM (+ TAX dependents) fully via `SPLIT_REVERSAL`, then post **`NO_SHOW` / `source = 'NIGHT_AUDIT'` / `business_date = D` for `P`** (the full penalty, not a residual delta). Tax via `stampTaxForChargeSync`. Uniform rule: no partial-reversal machinery; the folio reads as “room charge reversed + explicit fee.” |

**Deterministic audit `NO_SHOW` line id:** `${reservationId}:noshow:audit:${D}`.  
Must not collide with the desk id `${reservationId}:noshow:${businessDate}` (§6.4). Desk and audit never both post for the same reservation on D (desk no-show leaves `confirmed`, so `POST_ROOM_CHARGES` / this loop skip it) — the distinct suffix is still required so a retry or a confused writer cannot `INSERT` the desk shape under `NIGHT_AUDIT`.

**Retry COMPLETED does not double-post.** `folio_line_audit_uniq` on `(reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` makes a second `NO_SHOW` / `NIGHT_AUDIT` / D insert fail at SQL. The step COMPLETED short-circuit must run before any insert (existing `runAuditStep` rule). Test 22 pins both: unique-index reject of a raw second insert **and** a COMPLETED re-run that performs zero new `folio_line` rows.

`SPLIT_REVERSAL` lines are not `NIGHT_AUDIT` and are not covered by that unique index; they use new ids (`${reservationId}:noshow:audit:${D}:room-rev` and matching tax-rev ids) so a retry that somehow re-entered the body would be a second reverse — the COMPLETED short-circuit is what makes that impossible. Do not invent a second unique index this chunk.

Desk `tryNoShow` and audit stay consistent: a desk no-show already posted `NO_SHOW` / `DESK` and is not in the confirmed set, so this step does not touch it.

Expiry of pending (same step, earlier loop) posts **no** folio line.

### 6.6 `tryCancel` / `tryNoShow` stay `FAIL_CLOSED`

Unchanged classification; now honest. Penalty reads `rate_day` (shared) and writes folio — exactly the read-then-decide §4.6 forbids queueing.

---

## 7. Fold-ins

### 7.1 Party composition — **keep** (§16.5)

Reservation columns: `adults INTEGER NOT NULL DEFAULT 1`, `children INTEGER NOT NULL DEFAULT 0`, CHECKs `adults >= 1`, `children >= 0`.

Create / modify / hold / confirm accept `adults?` / `children?`. Validate `adults <= room_type.max_adults` and `adults + children <= room_type.max_occupancy` → `OCCUPANCY_EXCEEDED` (new). Inquiry uses the same check against the intended type (a quote for a party that cannot fit is rejected).

Not a second guest profile. Not a CRM note.

### 7.2 Front-office comments + VIP — **keep** (§16.5)

Columns: `front_office_comment TEXT` (nullable), `vip_flag INTEGER NOT NULL DEFAULT 0` (0/1).

Per-stay shift handoff. Distinct from OrgDO guest CRM notes. Current value only; history is `audit_log`.

### 7.3 `reservations.update_status` — **retarget, do not strike**

Striking loses `UPDATE_RESERVATION_STATUS` prototype coverage and forces a new id for a command the catalog already reserved for “non-inventory status notes.”

**Target fields:** `frontOfficeComment` and/or `vipFlag`. Not the status-machine column. Illegal to pass a machine status here.

| | |
|---|---|
| Lane | `INTERACTIVE` |
| Degraded | `QUEUE_PROVISIONAL` (notes — §4.6) |
| Idempotent | true; fingerprint `{ reservationId, frontOfficeComment?, vipFlag? }` |
| Events | **`reservation.front_office_updated`** (replace `reservation.status_changed` — that name is a lie for this command) |
| Permission | `reservations:write` |
| Entitlement | none (same ungated justification as other QUEUE_PROVISIONAL desk notes; entitlement plane must not be required to write a shift comment) |
| Audit | `appendAuditLogSync`; **not** in `AUDIT_WRITER_COMMAND_IDS` |

Any non-terminal reservation may be updated (`inquiry` through `checked_in`). Terminal rows → `NOT_MODIFIABLE`.

Last-writer-wins on replay. Add `REPLAY_DISPATCH['reservations.update_status']`.

### 7.4 Arrivals / departures / in-house — **enrich, do not add routes**

The brief asked for these endpoints. They already exist (`[62] get_front_desk_arrivals`, `[63] departures`, `[64] in_house`). This chunk does not append twins.

**Arrivals filter amendment** (front-desk-reads §2.3):  
`arrival_date = ? AND status IN ('confirmed', 'pending')`. Inquiry does not appear (quotes are not arrivals). Pending sorts with confirmed (`reservation_id ASC`); the client distinguishes via `status`.

Departures and in-house filters unchanged. `boardRowSeverity` gains `pending` (arrivals: `attention`; departures default branch: `informational`) and `inquiry` (should not appear on these boards; exhaustive switch uses `informational` so a leaked row does not crash).

List + `readReservation` payloads gain: `adults`, `children`, `frontOfficeComment`, `vipFlag`, `confirmBy` (null unless pending), `ratePlanId`, `roomId` (already present). Still no `piiKeyId` on list items (front-desk-reads §2.9).

---

## 8. Schema — v20 `reservation_lifecycle`

`packages/do-runtime/src/property-migrations.ts` version **20**, name `reservation_lifecycle`. Regenerate `migrations/do-property/0020_reservation_lifecycle.sql` via `pnpm generate:ddl`. Do not hand-write.

**A. `rate_plan` ALTERs** — §6.1 (additive).

**B. `charge_code` seed**

```sql
INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('CANCEL', 'Cancellation fee', 'active', 0, 0),
  ('NO_SHOW', 'No-show fee', 'active', 0, 0);
UPDATE charge_code SET tax_group = 'ROOM' WHERE code IN ('CANCEL', 'NO_SHOW');
```

`SYSTEM_CHARGE_CODES` becomes `['ROOM', 'PAYMENT', 'CANCEL', 'NO_SHOW']`.

**C. `reservation` rebuild** (CHECK change + columns; same v8/v11 pattern). Recreate **all** indexes that drop with the table:

```sql
CREATE TABLE reservation_v20 (
  reservation_id          TEXT PRIMARY KEY,
  room_type_id            TEXT NOT NULL,
  guest_ref               TEXT NOT NULL,
  pii_key_id              TEXT NOT NULL,
  arrival_date            TEXT NOT NULL,
  departure_date          TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('inquiry', 'pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  room_id                 TEXT,
  adults                  INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children                INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  front_office_comment    TEXT,
  vip_flag                INTEGER NOT NULL DEFAULT 0 CHECK (vip_flag IN (0, 1)),
  rate_plan_id            TEXT NOT NULL DEFAULT 'BAR',
  cancel_penalty_type     TEXT NOT NULL DEFAULT 'none'
    CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full')),
  cancel_grace_hours      INTEGER NOT NULL DEFAULT 0,
  cancel_penalty_nights   INTEGER,
  cancel_penalty_bps      INTEGER,
  confirm_by              INTEGER,
  expires_at              INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);
-- backfill: existing rows → adults=1, children=0, vip_flag=0, rate_plan_id='BAR',
-- cancel_penalty_type='none', confirm_by/expires_at NULL, comment NULL
```

Indexes after rename (must all return):

- `reservation_room_type_idx`, `reservation_arrival_idx`, `reservation_guest_ref_idx`
- `reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL` (v11)
- `reservation_departure_idx ON reservation (departure_date)` (v18)
- `reservation_in_house_idx ON reservation (departure_date) WHERE status = 'checked_in'` (v18)
- **new** `reservation_pending_expiry_idx ON reservation (confirm_by) WHERE status = 'pending'`
- **new** `reservation_inquiry_expiry_idx ON reservation (expires_at) WHERE status = 'inquiry'`

No FK from `rate_plan_id` → `rate_plan` (same deploy-safety reason as `rate_day`, rate-plans §2.1).

**D. Status sync test** — point `reservation-status-sync.test.ts` at `RESERVATION_V20_SQL`, not v8. `RESERVATION_STATUSES` gains `inquiry`, `pending`.

**E. Config register** (`packages/contracts/src/config/register.ts`)

| Key | Class | Schema | Default | Consumers |
|---|---|---|---|---|
| `pms.reservations.pending_hold_hours` | DOMAIN | int 1–168 | 24 | `consumersExempt: true` (no ARI/audit/rate fan-out) |
| `pms.reservations.inquiry_ttl_days` | DOMAIN | int 1–90 | 7 | exempt |
| `pms.reservations.check_in_cleanliness` | DOMAIN | `z.enum(['strict', 'off'])` | `'strict'` | exempt |
| `pms.reservations.check_out_require_zero_balance` | DOMAIN | bool | true | exempt |
| `pms.reservations.allow_dirty_check_in_override` | OPERATIONAL | bool | true | — |
| `pms.reservations.allow_balance_override` | OPERATIONAL | bool | true | — |

Prototype keys: `pms_res_pending_hold_hours`, `pms_res_inquiry_ttl_days`, `pms_res_check_in_cleanliness`, `pms_res_checkout_zero_bal`, `pms_res_allow_dirty_override`, `pms_res_allow_balance_override`.

---

## 9. Command catalog

### 9.1 New commands

| id | Lane | Degraded | Idempotent | Events | Entitlement | Permission | Notes |
|---|---|---|---|---|---|---|---|
| `reservations.confirm` | INTERACTIVE | **FAIL_CLOSED** | true | `reservation.status_changed`, `availability.changed` (inquiry→confirmed only) | `pms.core` | `reservations:write` | `INVENTORY_FAIL_CLOSED_NOTES`. Inquiry commits `sold`; pending is a status flip. |
| `reservations.hold` | INTERACTIVE | **FAIL_CLOSED** | true | `reservation.status_changed`, `availability.changed` | `pms.core` | `reservations:write` | `INVENTORY_FAIL_CLOSED_NOTES`. Inquiry→pending only. |

`register.test.ts` inventory-notes list gains `confirm` and `hold`.

`AUDIT_WRITER_COMMAND_IDS` gains both → size **35**.

### 9.2 Existing commands — field / event / gate changes

| id | Change |
|---|---|
| `reservations.create` | Optional `status: 'inquiry' \| 'pending' \| 'confirmed'` (default confirmed). Optional `adults`, `children`, `ratePlanId`, `confirmBy`, `expiresAt`. Inquiry omits ledger writes; events still declared (create may emit `availability.changed`). |
| `reservations.cancel` | Also `inquiry` / `pending`. Events add `folio.line_posted`. |
| `reservations.no_show` | Events add `folio.line_posted`. Predicate unchanged. |
| `reservations.modify` | Also `inquiry` / `pending`. Party fields. |
| `reservations.check_in` | Events add `reservation.room_assigned`. Payload `roomId?`, `overrideCleanliness?`. Still QUEUE_PROVISIONAL, no entitlement. |
| `reservations.check_out` | Events add `room.status_changed`, `folio.balance_due`. Payload `overrideBalance?`. Still QUEUE_PROVISIONAL, no entitlement. |
| `reservations.cancel_check_in` | Document keep-`room_id`. Unchanged events. |
| `reservations.assign_room` | Allowed statuses + `pending`; reject OOO. |
| `reservations.update_status` | Retarget §7.3. Event `reservation.front_office_updated`. |
| `rates.update_plan` | Policy fields. Existing FAIL_CLOSED / entitlement. |

Fingerprint allowlists must include every new field that changes semantics (status, roomId, overrides, party, plan, policy).

### 9.3 New wire codes (`packages/contracts/src/idempotency.ts`)

```
HOLD_EXPIRED = 'hold_expired'
INQUIRY_EXPIRED = 'inquiry_expired'
ROOM_REQUIRED = 'room_required'
ROOM_NOT_READY = 'room_not_ready'
ROOM_OUT_OF_ORDER = 'room_out_of_order'
BALANCE_DUE = 'balance_due'
OCCUPANCY_EXCEEDED = 'occupancy_exceeded'
```

HTTP map: `HOLD_EXPIRED` / `INQUIRY_EXPIRED` / `ROOM_NOT_READY` / `ROOM_OUT_OF_ORDER` / `OCCUPANCY_EXCEEDED` / `BALANCE_DUE` → **422**; `ROOM_REQUIRED` → **422**; existing codes unchanged. `RATE_MISSING` on cancel/no-show → 422 (already).

---

## 10. HTTP routes

Append at indices **92–94**. `check:permissions` requires matching `V1_ROUTES` order.

| Index | id | Method / pattern | Permission | commandId | Entitlement |
|---|---|---|---|---|---|
| 92 | `post_reservation_confirm` | `POST` `/v1/properties/:pid/reservations/:rid/confirm` | `reservations:write` | `reservations.confirm` | `pms.core` |
| 93 | `post_reservation_hold` | `POST` `/v1/properties/:pid/reservations/:rid/hold` | `reservations:write` | `reservations.hold` | `pms.core` |
| 94 | `post_reservation_front_office` | `POST` `/v1/properties/:pid/reservations/:rid/front-office` | `reservations:write` | `reservations.update_status` | — (QUEUE_PROVISIONAL, ungated) |

Bodies: confirm/hold `{ idempotencyKey, ratePlanId? }` (hold also `confirmBy?`). Front-office `{ idempotencyKey, frontOfficeComment?, vipFlag? }` — key in body (body present).

**Convention note (not a CI exception):** check-in / check-out / cancel-check-in keep **header** `x-idempotency-key` (already shipped). Additional JSON fields (`roomId`, `overrideCleanliness`, `overrideBalance`) live in the body; the header remains required. This is the reservations-vertical “no body → header” rule, kept after those POSTs grew optional bodies. `check:forbidden-bodies` only asserts 403 bodies name the route’s permission — it has no opinion on key placement. No other `scripts/` check enforces key-in-body (verified); no allowlist amendment is required. New routes (confirm / hold / front-office) put the key in the body because they ship with a body.

Existing `POST /reservations` and `PATCH /reservations/:rid` accept the new optional fields. `GET /reservations/:rid` and the three front-desk lists return them.

Kill-switch: confirm/hold 402; front-office and check-in/out still 200 (ungated). Test that pair.

---

## 11. SPA surface

Not a tape chart. Existing screens only.

| Screen | Change |
|---|---|
| `BookingScreen` | Secondary **Hold** and **Quote** next to Confirm. Same session ids / `quoteAriVersion`. OpId includes `status`. Quote skips availability failure as a blocker (inquiry cannot 409 `no_availability`); Hold/Confirm keep today’s matrix. |
| `CheckInScreen` | Assignment **required** (pre-assigned shown, or room id + assign-at-check-in). Cleanliness errors surfaced. Override checkbox when `ROOM_NOT_READY` and config allows. Copy about optional assign / queue-without-room is removed. `api.checkIn` gains optional body fields; opId includes `roomId` + override. |
| `FolioScreen` | Server `BALANCE_DUE` is the gate. Confirm-dialog → `overrideBalance: true`. Delete “does not require settlement.” Show `folio.balance_due` only via the resulting folio refresh. |
| `BoardScreen` arrivals | Renders `pending` (attention). Confirm action on pending rows. Party size + VIP chip + FO comment preview from enriched list payload. |
| Rate-plan edit (existing rates UI if present; otherwise API-only this chunk) | Policy fields on `rates.update_plan`. If no rates SPA exists, **API + tests only** — do not invent a rates screen. |
| `boardRowSeverity` / `RESERVATION_STATUSES` | Exhaustiveness for `inquiry` / `pending`. |

`packages/client-core`: `createReservation` optional `status` / party / plan; `confirmReservation` / `holdReservation` / `updateFrontOffice`; `checkIn` / `checkOut` optional flags; list/read types widened.

---

## 12. Degraded-mode summary

| Command | Live outage | Replay |
|---|---|---|
| create / modify / cancel / no_show / confirm / hold / assign_room | 503 FAIL_CLOSED | n/a |
| check_in | 202 queue | re-validate room + cleanliness + status; exception on fail |
| check_out | 202 queue | re-validate balance + dirty room; `BALANCE_DUE` without override → exception |
| cancel_check_in | 202 queue | status only; keep `room_id` |
| update_status (FO comment) | 202 queue | LWW comment/vip |
| Front-desk list reads | 503 FAIL_CLOSED (unchanged) | n/a |

Provisional check-in **does** assign if `roomId` is in the payload — same body as live. Two queued check-ins for one room: first apply wins, second exceptions. That is the designed non-commutativity.

---

## 13. Night-audit interplay (normative pointer)

| Step | Change |
|---|---|
| `POST_ROOM_CHARGES` | **Predicate unchanged** (`confirmed \| checked_in`; pending does not get ROOM). **Rate lookup changes:** `postRoomChargesSync` (~7212) today binds `DEFAULT_RATE_PLAN_ID`. After this chunk it reads `reservation.rate_plan_id` (column `NOT NULL DEFAULT 'BAR'` — existing BAR stays identical). `SELECT` must include `rate_plan_id`. A NONREF stay with a different `rate_day` amount posts ROOM at NONREF, not BAR. That is what makes §6.5’s `P === R` no-op true for `first_night` when `arrival_date = D`. |
| `PROCESS_NO_SHOWS` | (1) expire due pending → `cancelled` + release, no penalty; (2) expire due/past-arrival inquiry → `cancelled`; (3) existing confirmed no-show + §6.5 penalty vs ROOM. `auto_no_show = false` still skips **(3) only** — expiry of dead holds still runs (otherwise `sold` leaks). Document that split in the step. |
| Occupancy snapshot | `confirmedCount` unchanged. Add `pendingCount` (`status = 'pending'` covering D) so a leftover hold is visible on the close-out. Optional but locked: include it. |
| Step list | Still seven. No new step. |

---

## 14. Open questions — resolved

1. **Implement INQUIRY/PENDING vs amend §7.4 to defer. Resolved: implement.** This is the lifecycle-completion chunk; §16.5 forbids silence; the booking engine (Phase 2) should inherit a machine, not a drift note. `held` is not used (§3.1).
2. **PENDING inventory. Resolved: `sold`, not `held`, not nothing.** Individual option = committed type-level sale. CRS `held` stays Phase 3.
3. **Expiry owner. Resolved: lazy-on-touch + fold into `PROCESS_NO_SHOWS`.** Single alarm slot is night audit’s. A new audit step would reshuffle a pinned 7-step machine for a loop that belongs with “reservations that did not become stays.”
4. **PENDING past arrival. Resolved: `cancelled` (expired), not `no_show`.** No-show predicate unchanged. No ROOM to reverse.
5. **Wizard. Resolved: Confirm stays default; Hold + Quote are secondary buttons.** Not a wizard redesign; not deferred entirely (otherwise PENDING has no product entry except raw API).
6. **Check-in without a room. Resolved: gate `ROOM_REQUIRED`.** No `waitingForRoom`.
7. **Cleanliness. Resolved: config `strict` (default) vs `off`; OOO never overridable; dirty override is an explicit flag.**
8. **Check-in degraded class. Resolved: stay `QUEUE_PROVISIONAL`.** Room contention → exception. Do not FAIL_CLOSED the lobby.
9. **`cancel_check_in` assignment. Resolved: keep `room_id`; do not dirty.**
10. **Check-out open balance. Resolved: server gate, config default block, explicit override, `folio.balance_due` when > 0.** FolioScreen dialog is the override UX, not the control.
11. **HK on check-out. Resolved: set assigned room `dirty`; LWW vs HK updates; keep `room_id`.**
12. **Penalty price source. Resolved: current `rate_day` at cancel time on the snapshotted plan.** Original-quote snapshot is a leftover (wizard is still quantity-only).
13. **Audit no-show vs ROOM. Resolved (v2):** `P === 0` reverse ROOM; `P === R` no-op (same plan, same night, same `rate_day` — requires §13 lookup change); `P !== R` reverse ROOM then post `NO_SHOW` / `NIGHT_AUDIT` for **P**. Never `ledger_inconsistent`. Never halt the audit on a legal policy.
14. **`update_status`. Resolved: retarget to FO comment + VIP; new event name; do not strike.**
15. **Arrivals endpoints. Resolved: already exist; widen arrivals to include `pending`; enrich payload.**
16. **`auto_no_show = false` vs pending expiry. Resolved: expiry still runs; confirmed no-show does not.**
17. **Lazy-expiry wire after `expireIfDueSync`. Resolved (v2):** uniform `HOLD_EXPIRED` / `INQUIRY_EXPIRED` for every caller except `tryCancelReservation`, which returns ok (expiry already released; no penalty; no second events).
18. **`POST_ROOM_CHARGES` plan. Resolved (v2):** predicate unchanged; price from `reservation.rate_plan_id`.

None left open.

---

## 15. Test matrix

Names are the acceptance list, not a file-split mandate. Fixture dates from property-local `business_date`.

**Machine + inventory**

1. Create default (no `status`) → `confirmed`, `sold + 1`, both events. Wizard-compat.
2. Create `inquiry` → no `sold` change, no `availability.changed`, status `inquiry`.
3. Create `pending` → `sold + 1`, `confirm_by` default now+24h, policy snapshot from BAR (`none`).
4. Create pending with `confirmBy` override stored.
5. Hold inquiry → pending, `sold + 1`, `availability.changed`.
6. Confirm pending → confirmed, **no** further `sold` change, no second `availability.changed`.
7. Confirm inquiry → confirmed, `sold + 1`.
8. Confirm inquiry with no availability → `NO_AVAILABILITY`, no row, `sold` unchanged (validate-then-mutate).
9. Check-in from pending → `INVALID_STATUS_TRANSITION`.
10. Cancel inquiry → cancelled, no ledger, no folio line.
11. Cancel pending in grace / type `none` → cancelled, `sold − 1`, no folio line.
12. Expire pending via lazy-on-touch (`confirm_by` in the past) then confirm → `HOLD_EXPIRED`, `sold` released once.
12a. Expire-then-no-show (due pending) → `HOLD_EXPIRED`, single release, no `NO_SHOW` line, not `INVALID_STATUS_TRANSITION`.
12b. Expire-then-cancel (due pending) → **ok**, single `sold` release, no penalty, one `reservation.status_changed` + one `availability.changed` (the expiry’s). A second cancel (new key) → `ALREADY_CANCELLED`.
13. Modify pending dates → release/acquire like confirmed.
14. Modify inquiry dates → no ledger.
15. `countSoldHoldingReservationsCovering` (renamed helper) = `sold` after a sequence that includes pending + check-in + check-out + cancel + no-show. Property test seeds include at least one pending create and one check-in.

**Night audit**

16. Pending with `arrival_date = D` still pending at PROCESS_NO_SHOWS → `cancelled`, `sold` released, **no** ROOM (never posted), **no** CANCEL/NO_SHOW line. Confirmed sibling with same arrival → `no_show` as today.
17. `auto_no_show = false` → confirmed stays confirmed; due pending still expires.
18. Inquiry with `arrival_date = D` → cancelled, no ledger.
19. PROCESS_NO_SHOWS no-show predicate ignores pending (test 16’s pending is cancelled-by-expiry, not `no_show`).
20. Policy `none` + confirmed no-show after POST_ROOM_CHARGES → ROOM reversed (`SPLIT_REVERSAL`), no `NO_SHOW` line. Step COMPLETED; audit not halted.
21. Policy `first_night` + `arrival_date = D` + ROOM priced from `reservation.rate_plan_id` → `P === R`, ROOM remains, no `NO_SHOW` line.
22. Policy `full` on a 2-night stay (`P !== R`) → ROOM (+ TAX) reversed via `SPLIT_REVERSAL`, then `NO_SHOW` / `NIGHT_AUDIT` / D for **P** (id `${reservationId}:noshow:audit:${D}`). Raw second insert of that charge_code/source/date → unique-constraint error. Second `runAuditStep` of COMPLETED → zero new `folio_line` rows.
22a. Policy `percent` 50% on a 1-night stay (`P < R`, legitimate) → same reverse-then-post-P shape as 22; step COMPLETED; **must not** throw `ledger_inconsistent` or halt.
22b. Confirmed stay on a non-BAR plan whose `rate_day` for D differs from BAR → `POST_ROOM_CHARGES` ROOM `ledger_amount_minor` equals the reservation plan’s amount, not BAR’s.

**Check-in triangle**

23. Check-in confirmed, no `room_id`, no payload `roomId` → `ROOM_REQUIRED`, still `confirmed`.
24. Pre-assigned clean room, no payload → `checked_in`, no second `reservation.room_assigned`.
25. Payload `roomId` on unassigned confirmed → assign + check-in one txn; `reservation.room_assigned` + `reservation.status_changed`.
26. Dirty + `strict` + no override → `ROOM_NOT_READY`.
27. Dirty + `overrideCleanliness` + allow config → `checked_in`, audit flag.
28. OOO + override → `ROOM_OUT_OF_ORDER`.
29. Two overlapping assigns of the same room → second `ROOM_ALREADY_ASSIGNED` (standalone and via check-in).
30. `cancel_check_in` → `confirmed`, `room_id` kept, room status unchanged (still clean).
31. **Replay canary:** enqueue check-in with `roomId` A; before drain, live-assign A to another confirmed stay; drain → `provisional_exception`, first reservation still `confirmed`.
32. **Replay canary:** enqueue check-in without room and without pre-assign → exception `ROOM_REQUIRED`.
33. Kill-switch `pms.core` + check-in → 200 (still ungated). Confirm → 402.

**Check-out**

34. `balanceMinor === 0` → `checked_out`, assigned room `dirty`, `room.status_changed`, no `folio.balance_due`.
35. `balanceMinor > 0`, require-zero, no override → `BALANCE_DUE`, still `checked_in`, room not dirtied.
36. Same + `overrideBalance` → `checked_out`, dirty, `folio.balance_due` `{ overridden: true, balanceMinor }`.
37. Require-zero false + open balance, no flag → `checked_out` + `folio.balance_due` `{ overridden: false }`.
38. Legacy `checked_in` with NULL `room_id` → status flip + balance gate, no room update.
39. **Replay canary:** queued check-out, then queued `folio.add_item` that makes balance > 0, check-out has no override → exception `BALANCE_DUE` if charge applies first; if check-out applies first, late charge posts on open window (assert both orderings; neither posts into a closed date).

**Penalty desk**

40. Plan `first_night`, grace 24h, cancel 48h before arrival → 0, no line.
41. Same plan, cancel after grace → `CANCEL` line = first-night `rate_day`, tax stamped, `sold` released, `folio.line_posted`.
42. Cancel with missing `rate_day` after grace → `RATE_MISSING`, still `confirmed`, `sold` unchanged.
43. Desk no-show after arrival, `first_night` → `NO_SHOW` / `DESK`; subsequent audit does not add ROOM (status no longer confirmed).
44. `rates.update_plan` after a snapshot → existing reservation still uses old type; new create uses new type.

**Fold-ins**

45. Create `adults + children > max_occupancy` → `OCCUPANCY_EXCEEDED`.
46. `POST …/front-office` sets comment + vip; GET reservation + arrivals list return them; event `reservation.front_office_updated` (not `status_changed`).
47. Front-office on `checked_out` → `NOT_MODIFIABLE`.
48. Arrivals on D includes pending arriving D and confirmed arriving D; excludes inquiry arriving D.
49. `RESERVATION_STATUSES` ↔ v20 CHECK exact (updated sync test).
50. `AUDIT_WRITER_COMMAND_IDS.size === 35`; route pins `[91]` unchanged, `[92]=post_reservation_confirm`, `[93]=post_reservation_hold`, `[94]=post_reservation_front_office`.
51. `check:degraded` / `check:entitlements` / `check:permissions` / `check:ddl` green. Confirm/hold have `INVENTORY_FAIL_CLOSED_NOTES`.

**SPA (injected transport)**

52. Booking Hold vs Confirm remint opId (`status` in composition).
53. CheckInScreen cannot submit without a room; `ROOM_NOT_READY` shows override when allowed.
54. FolioScreen confirm-dialog sends `overrideBalance: true`; dismiss does not call the API.
55. Arrivals pending row severity `attention`; Confirm control present.

---

## 16. File map (implementation, not a plan)

| File | Role |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` + `0020_reservation_lifecycle.sql` | v20 rebuild + rate_plan ALTERs + charge seeds |
| `packages/do-runtime/src/reservation-status-sync.test.ts` | Point at v20 CHECK |
| `packages/contracts/src/reservation-status.ts` | Two new statuses |
| `packages/contracts/src/commands/catalog.ts` | New commands + event/notes edits |
| `packages/contracts/src/commands/audit-writers.ts` | +confirm, +hold; size 35 |
| `packages/contracts/src/idempotency.ts` | New wire codes |
| `packages/contracts/src/config/register.ts` | Six keys |
| `packages/contracts/src/v1-http-routes.ts` | Indices 92–94 |
| `packages/contracts/src/register.test.ts` | Pins, notes list, size |
| `apps/pms-core/src/property-do.ts` | Create/cancel/modify/check-in/out/cancel-check-in/assign/no-show; `tryConfirm` / `tryHold` / `tryUpdateFrontOffice`; `expireIfDueSync`; `penaltyMinor`; `processNoShowsSync` expiry + §6.5 P/R; `postRoomChargesSync` lookup `reservation.rate_plan_id`; `countSoldHoldingReservationsCovering`; list/read payload |
| `apps/pms-core/src/v1-dispatch.ts` | Three handlers; widen create/patch/check-in/out bodies; list/read JSON |
| `apps/pms-core/src/pending-commands-consumer.ts` | Widen check-in/out payloads; add `update_status` |
| `apps/pms-core/src/event-consumer.ts` | `folio.balance_due`, `reservation.front_office_updated` |
| `apps/pms-core/test/reservations-ledger.property.spec.ts` | Widened helper + pending/check-in in sequences |
| `packages/client-core` + `apps/web-pms` | §11 |
| `ARCHITECTURE.md` | §7.1 sold sentence; §7.1 assign-at-check-in one-liner (pre-assign allowed, check-in requires a room); §7.4 unchanged graph (now true); §16.5 drift paragraph retired; still-unnamed rows marked keep |

---

## 17. Leftovers (named, not silent)

1. **`availability_day.held` behaviour** — CRS / group holds, Phase 3 (§7.1).
2. **Quote snapshot** (nightly rates frozen on the reservation at create) — wizard is still quantity-only; penalty uses current `rate_day`.
3. **`pms.ops.auto_assign_rooms`** — unread; check-in stays explicit.
4. **Folio window close on check-out** — money-ops; window stays `OPEN`.
5. **Deposits / capture on `folio.balance_due`** — payments worker.
6. **Priced wizard / plan picker** — schema is ready; UI is not this chunk’s job beyond Hold/Quote.
7. **`reservations.update_extras`** — still a retirement candidate (booking-wizard leftover 7).
8. **Quotes inbox** — inquiry is not on arrivals; a dedicated list is unbuilt.
9. **Implicit confirm-and-check-in** — deliberately two commands.
10. **Re-apply a failed provisional check-in** after the operator assigns a different room — resolve remains acknowledge-only (night-audit leftover 9).
11. **DND / recurring charges / reg card / global search / type photos** — other §16.5 rows, other verticals.

---

## 18. Implementation checklist

- [ ] v20 migration: reservation rebuild with **all** v11+v18 indexes recreated; rate_plan ALTERs; CANCEL/NO_SHOW seed; `SYSTEM_CHARGE_CODES` length 4; `pnpm generate:ddl`.
- [ ] `RESERVATION_STATUSES` + sync test retargeted to v20.
- [ ] `tryCreateReservation` branches on `status`; inquiry skips ledger; pending/confirmed snapshot policy; party + `ratePlanId`.
- [ ] `tryConfirm` / `tryHold` / `expireIfDueSync` (cancel → ok; every other caller → `HOLD_EXPIRED` / `INQUIRY_EXPIRED`) / `penaltyMinor` via `roundHalfAwayFromZero`.
- [ ] Cancel/modify/no-show/assign gates widened; cancel/no-show post folio when `P > 0`.
- [ ] `tryCheckIn` room resolution + cleanliness + OOO; `tryCheckOut` balance + dirty + `folio.balance_due`; `tryCancelCheckIn` keeps `room_id`.
- [ ] `processNoShowsSync`: expiry loops first; `auto_no_show` gates only the confirmed no-show loop; §6.5 money (`P !== R` reverse-then-post-P; never halt).
- [ ] `postRoomChargesSync`: `SELECT` includes `rate_plan_id`; `rate_day` lookup uses it (not `DEFAULT_RATE_PLAN_ID`).
- [ ] Catalog + audit-writers 35 + events allowlist + six config keys.
- [ ] Routes 92–94; create/patch/list/read/check-in/out bodies; header idempotency kept on the three old status POSTs (convention only — no CI allowlist).
- [ ] `REPLAY_DISPATCH` widened; replay canaries 31, 32, 39.
- [ ] SPA: wizard Hold/Quote; CheckInScreen gate; FolioScreen override; board pending; severity exhaustiveness.
- [ ] ARCHITECTURE.md + bidirectional one-liners in night-audit / front-desk-reads / booking-wizard specs.
- [ ] Test matrix §15; `pnpm build`, `check:ddl`, `check:entitlements`, `check:permissions`, `check:degraded`, `check:pms-core-test-dates`, `check:class-denylist`, `typecheck`, package tests, `pnpm lint`.

---

## 19. Acceptance (reviewer checklist)

- [ ] §16.5 drift is resolved by **implementation**, not a deferral footnote — and `held` is explicitly not the mechanism.
- [ ] PENDING expiry cannot leak `sold` (lazy + audit); crossing arrival is `cancelled`, not `no_show`; no-show SQL predicate unchanged.
- [ ] Check-in / assignment / cleanliness / OOO each have a live reject **and** a replay exception; check-in is still QUEUE_PROVISIONAL.
- [ ] Check-out balance is a server gate; `folio.balance_due` only when `> 0`; HK dirty is specified against LWW.
- [ ] Penalty snapshot + desk post + audit `P`/`R` reconciliation that **never halts** the step; `P !== R` is reverse-ROOM-then-post-P; BAR default `none`; `SYSTEM_CHARGE_CODES` growth named.
- [ ] `POST_ROOM_CHARGES` prices from `reservation.rate_plan_id`; test 22b proves a non-BAR stay is not charged BAR.
- [ ] `update_status` has a real target (or the reviewer rejects the retarget); arrivals routes are enriched, not duplicated.
- [ ] Every new command has lane/degraded/events/permission/(entitlement); route indices append at 92; migration is 20.
- [ ] Open questions section has zero unresolved items.
- [ ] Out of scope includes group blocks, deposits, tape chart, `held`, auto-assign, folio close.
