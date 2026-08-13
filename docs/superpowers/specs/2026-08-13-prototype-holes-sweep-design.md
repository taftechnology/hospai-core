# Prototype Holes Sweep

**Date:** 2026-08-13  
**Status:** Draft — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (degraded classes; guest lookup listed `READ_STALE`; never print a folio/invoice in `DEGRADED`), §4.7 (R2: invoices, exports, ID documents, property images), §5.1 (`breakfast_rule` DOMAIN), §7.1 (occupancy is room-type inventory; `max_occupancy` / `max_adults`), §7.9 (guest *registration reporting* is fiscal, not a front-desk card), §8 (pinned 7-step night audit; do not grow `NIGHT_AUDIT_STEPS`), §16.1 (HK core = roster, assignment, inventory, manager priorities), §16.5 still-unnamed table (~2192–2201); [folio money operations](./2026-08-12-folio-money-operations-design.md) (style template); [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) (DND leftover 1: not a room status; HK extras out); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (§7.1 party composition, §7.2–7.3 front-office + VIP, penalty snapshot); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (§8.1 recurring defer, §8.2 reg-card drop as document engine); [booking wizard](./2026-08-11-booking-wizard-design.md) (no guest substring search until a blind index); command catalog; `property-migrations.ts`; `v1-http-routes.ts`; `apps/web-pms/src/screens/`

**Closes:** ARCHITECTURE.md §16.5 table *Still unnamed — product must decide keep, defer, or drop* (nine rows). After this chunk ships, that table is a closed decision record, not an open punch list. Phase 1 coverage for unnamed prototype behaviour is ~100%.

**Amends:** [room operations](./2026-08-12-room-operations-hk-completion-design.md) leftover 1 (DND: this chunk **keeps a stay flag**, still **not** a `room.status`); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) §8.1 (ratify **defer** recurring incidentals) and §8.2 (reg card stays **not** an R2/night-audit document; this chunk **names** a front-desk printable *view*); [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) §7.1 (occupancy remainder: check-in + modify actually enforce; booking wizard collects party size); [booking wizard](./2026-08-11-booking-wizard-design.md) leftover “no search box” (top-bar reservation search is a shell surface, not a wizard guest-dedupe path). Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

§16.5 required a recorded keep / defer / drop on every unnamed prototype behaviour before Phase 1 is honest. Later verticals folded three rows as KEEP (party composition, front-office comments, cancel-policy snapshot) and parked the rest as leftovers. This chunk is the sweep: verify what actually shipped, close the rest with product decisions, and spec only the small remainders. It is not a new vertical.

### 1.1 Current state (verified)

| # | Prototype row | What exists today | Verdict of the audit |
|---|---|---|---|
| 1 | DND as a room status | `room.status` CHECK is `clean \| dirty \| inspected \| out_of_order` (`property-migrations.ts` ~289–294). Catalog `rooms.update_status` (~232–239) rejects `out_of_order` (`OOO_VIA_RANGE`). Room-ops spec leftover 1: DND is not a room status. No `dnd` string anywhere in commands, schema, or SPA. | Unnamed stay signal. Not in the status machine. |
| 2 | Adults / children | **KEEP (2026-08-12), mostly shipped.** `reservation.adults` / `children` v20 (`property-migrations.ts` ~597–598). `room_type.max_occupancy` / `max_adults` v2 (~125–126) with CHECK `max_adults <= max_occupancy`. `assertOccupancySync` (`property-do.ts` ~5285–5293): `adults > max_adults` OR `adults + children > max_occupancy` → `OccupancyExceededError` (local class ~493; `OCCUPANCY_EXCEEDED` in `idempotency.ts` ~44). Called from **create** (~5752), **confirm** (~5927), **hold** (~6053). **Not** called from `tryCheckIn` (~6626; SELECT at ~6664 omits adults/children) or `tryModifyReservation` (~6293; writes `COALESCE` adults/children at ~6489–6496 but never asserts; early-return at ~6377–6389 when dates+type unchanged **drops an adults-only modify**). HTTP create/patch forward `adults`/`children` (`v1-dispatch.ts` ~1526–1527, ~1672–1673). Test 45: create over occupancy (`reservations-lifecycle.spec.ts` ~695). Lists + `readReservation` return the fields (~7437–7438, ~7480–7483). **SPA:** `BookingScreen.tsx` create payload (~165–176) sends **no** adults/children (defaults 1/0). `CheckInScreen.tsx` does not display party size. No `adults`/`children` in `apps/web-pms/src/screens/` at all. | Domain fields + create/hold/confirm gate exist. Check-in does **not** enforce. Modify does **not** enforce and can no-op party-size-only edits. Wizard does not collect. |
| 3 | Fixed / recurring charges | No schedule table. `pms.folio.breakfast_rule` is DOMAIN string default `'EXCLUDED FROM ROOM/BED PRICE'` (`register.ts` ~182–187); nothing in `postRoomChargesSync` reads it. `POST_ROOM_CHARGES` (`property-do.ts` ~9966–10030) posts `ROOM` (+ tax) for `confirmed \| checked_in`, `no_post = 0`, covering the closing date. Unique index `folio_line_audit_uniq` (`property-migrations.ts` ~730–732) is `(reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` — a second code on the same night would be allowed. Night-audit spec §8.1 already **deferred**. Folio money-ops scope-out: “Recurring incidentals / breakfast_rule engine”. Desk can post a one-off via `folio.add_item`. | Distinct from breakfast_rule and from ROOM posting. Unbuilt. |
| 4 | Registration card print | No print route, no R2 object, no `window.print` in `apps/web-pms`. Night-audit §8.2 **dropped** a document-engine / night-audit deliverable. §4.6: never print a folio or invoice in `DEGRADED`. §7.9 guest registration *reporting* (SES / Alloggiati / SEF) is fiscal and out. `GET reservation` (~57–61 of `v1-http-routes.ts`) + `POST …/guests/batch` (~381–385) already return the fields a card would show. | No front-desk artifact. Data for a view exists. |
| 5 | HK budgeting / metrics / mobile attendant | `HousekeepingScreen.tsx` (~8–37) is the board (roster picker, OOO, filters, workload counts from room-ops). `pms_hk_inventory` / `pms_hk_manager_priorities` are `EXCLUDED_PROTOTYPE_KEYS` (`register.ts` ~60–61). No budgeting, dashboards, or second (mobile) client. Room-ops leftover 9 scoped them out. | Extra tabs. Core HK is covered. |
| 6 | Global reservation search | `AppShell.tsx` (~63–71) top-bar is brand + nav. No search input. `get_reservation` is exact id (`v1-http-routes.ts` ~57–61, `degradedRead: 'FAIL_CLOSED'`). Front-desk lists are date-scoped (`get_front_desk_arrivals` / `departures` / `in_house` ~360–378, also `FAIL_CLOSED` — §4.6 table says `READ_STALE`; shipped honesty is FAIL_CLOSED because entitlement + OrgDO name hydration sit on the path). `get_guest` ~232–237 `FAIL_CLOSED`. OrgDO `readGuests` (~2020) is **id-in, decrypt-out**; no name index. Guest `displayName` is ciphertext (`org-migrations.ts` ~55–64). Booking wizard: no substring guest search until a blind index. **No `confirmation_number` column.** `reservation_id` is the confirmation. | Shell hole. Exact-id GET exists. Name search has no index. |
| 7 | Front-office comments | **KEEP (2026-08-12), domain shipped.** v20 columns `front_office_comment`, `vip_flag` (`property-migrations.ts` ~599–600). Catalog `reservations.update_status` (~128–136): `QUEUE_PROVISIONAL`, `reservations:write`, ungated, events `['reservation.front_office_updated']`, notes *“Front-office comment + VIP flag. Not the status-machine column.”* RPC `tryUpdateFrontOffice` (~7259–7366): last-writer-wins, terminal → `NOT_MODIFIABLE`, outbox + `appendAuditLogSync` (not in `AUDIT_WRITER_COMMAND_IDS` — same ungated class as check-in). HTTP `post_reservation_front_office` (`v1-http-routes.ts` ~517–520) `POST …/reservations/:rid/front-office`. Replay `pending-commands-consumer.ts` ~57–65. Event consumer ~126. Routes tests 46/47 (`reservations-routes.spec.ts` ~726, ~838). Client `api.updateFrontOffice` (`api.ts` ~857) already accepts `{ frontOfficeComment?, vipFlag?, noPost? }`. **SPA:** `FolioScreen.tsx` ~586 calls `api.updateFrontOffice(..., { noPost: !noPost })` — the folio no-post toggle rides this RPC. Board (`BoardScreen.tsx` ~90–137) does not render comment/VIP. No comment / VIP / DND editor. | Domain + HTTP + replay + tests: done. SPA has a no-post-only caller. Remainder: comment / VIP / DND editor. |
| 8 | Room-type photos, door-lock, maxAdults vs maxOccupancy | **Occupancy split shipped** (v2 DDL ~125–126; `inventory.add_room_type` / `update_room_type` fingerprints include both, `property-do.ts` ~3709, ~3834; occupancy gate uses both). No `photo` / `r2` / `keyless` / `door_lock` column on `room_type`. §4.7 R2 is for property images / invoices / ID docs — no type-level media writer. | Split done. Media and keyless unnamed. |
| 9 | Rate-plan cancel policy + inclusions | **KEEP (2026-08-12), penalty snapshot shipped.** v20 ALTERs on `rate_plan`: `cancel_penalty_type` / `cancel_grace_hours` / `cancel_penalty_nights` / `cancel_penalty_bps` / `cancel_policy_text` (`property-migrations.ts` ~574–582). Same four numeric fields snapshotted onto `reservation` at inventory commit (`snapshotPenaltyFromPlanSync` ~5296–5322; INSERT ~5778–5794). `cancel_policy_text` is **plan-level copy only** — not copied onto the reservation (correct: math is frozen, prose is not a penalty input). `rates.create_plan` / `update_plan` persist `cancelPolicyText` (`property-do.ts` ~8078, ~8233; dispatch ~3293, ~3355). **No inclusions column, JSON, or posting.** | Penalty KEEP is done. Inclusions do not exist. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `PROPERTY_MIGRATIONS` | version **22** `room_ooo` (`property-migrations.ts` ~917) | next **23** |
| `V1_HTTP_ROUTE_AUDIT` | `[104] = post_room_ooo_range` (`v1-http-routes.ts` ~586; `register.test.ts` ~441) | next **105** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **45** (`register.test.ts` ~253, ~447) | unchanged (no new entitled writer) |
| `PLATFORM_GAPS` | `[]` (`catalog.ts` ~792) | stays empty |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | includes `room_ooo` (`property-do.ts` ~893–919) | unchanged (ALTER only; no new table) |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged unless an implementation accidentally exports one |

### 1.2 Decision table (normative)

| # | Row | Decision | Rationale |
|---|---|---|---|
| 1 | DND as a room status | **DROP as `room.status`. KEEP as stay flag `dnd_flag`.** | Room-ops locked one inventory-blocking state (OOO) and an orthogonal cleanliness machine. DND is a guest request on an occupied (or arriving) stay, not cleanliness and not inventory. A dedicated flag is the operational signal (board badge); stuffing “DND” into `front_office_comment` is not queryable. |
| 2 | Adults / children | **KEEP** (standing). Close the remainder in this chunk. | Do not re-litigate. Spec §4. |
| 3 | Fixed / recurring charges | **DEFER** (named leftover, not Phase 1). | A per-stay incidental schedule is a folio/night-audit aggregate: new table, posting inside `POST_ROOM_CHARGES` (cannot add an 8th step), snapshotted `amount_minor`, `no_post` / CLOSED-window / tax interaction. That balloons this sweep. Desk already posts one-off incidentals via `folio.add_item`. `breakfast_rule` stays unread DOMAIN copy. Sketch in leftover 1 so a later vertical does not re-derive. |
| 4 | Registration card print | **KEEP** as a front-desk printable *view*. | Name the artifact. Not fiscal registration reporting (§7.9). Not an R2 document, not a night-audit step, no new storage. Print from existing reservation + guest reads. Never in `DEGRADED`. |
| 5 | HK budgeting / metrics / mobile attendant | **DROP from Phase 1.** | §16.1 core HK is roster, assignment, inventory, manager priorities. Roster + assignment + board shipped. Inventory / manager-priorities keys are excluded. Budgeting, metrics dashboards, and a mobile attendant are extra prototype tabs and a second client. Revisit as a later-phase HK product, not Phase 1 debt. |
| 6 | Global reservation search | **KEEP** (shell). | Exact `reservation_id` is the confirmation. Name search is property-scoped over stays, via existing guest decrypt — not a stored blind index (leftover 2). |
| 7 | Front-office comments | **KEEP** (standing). Domain **done**. SPA remainder is the comment / VIP / DND editor (no-post toggle already exists). | Do not re-litigate. Evidence in §1.1. Spec §6. |
| 8 | Photos / keyless / occupancy split | **Occupancy split: done. Photos: DEFER. Keyless: DROP.** | Split is in DDL and the occupancy gate. Type-level photos have no Phase 1 consumer (booking engine is Phase 2; inventory SPA has no gallery). A `keyless` bit with no lock module is prototype theater (§16.2). |
| 9 | Cancel policy + inclusions | **Penalty snapshot: done. Inclusions: DEFER** (with row 3). | KEEP as specified is implemented. Plan `cancel_policy_text` is extra copy, not a gap. Inclusions without a posting engine are a JSON column nobody honours. |

### 1.3 Scope in

1. `dnd_flag` on `reservation`; write via existing `reservations.update_status`; board + check-in + folio chrome (§3).
2. Occupancy remainder: enforce on check-in and modify; wizard + check-in display party size (§4).
3. Registration-card printable view (§5).
4. Front-office comment / VIP / DND editor on the desk (§6).
5. Top-bar reservation search + `GET …/reservations-search` (§7).
6. Record defer/drop for recurring, HK extras, photos, keyless, inclusions so §16.5 is closed.

### 1.4 Scope out

- Adding `dnd` to `room.status` CHECK, or a second inventory status.
- Recurring / fixed incidental *engine* (leftover 1). Do not read `breakfast_rule` in `POST_ROOM_CHARGES`.
- Growing `NIGHT_AUDIT_STEPS`.
- Blind-index guest discovery (leftover 2). Wizard still has no search box.
- A second confirmation number.
- R2 document templates / invoice engine / fiscal guest-registration feeds (§7.9).
- HK budgeting, metrics dashboards, mobile attendant, manager-priorities tab, HK inventory.
- Room-type photos; door-lock / keyless integration.
- Rate-plan inclusions list.
- New catalog command ids (reads are not commands; DND rides `reservations.update_status`).
- Changing shipped list/GET `degradedRead` from `FAIL_CLOSED` to `READ_STALE` (architecture-vs-code drift; not this sweep).
- `CLASS_DENYLIST` / `PROPERTY_PURGE_INVENTORY_TABLES` growth (no new `export class`, no new table).

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **`room.status` does not gain `dnd`.** Cleanliness remains `clean | dirty | inspected`; inventory blocking remains OOO-via-range. DND is `reservation.dnd_flag`.
2. **Money is integers.** This chunk does not post money. Recurring charges are deferred; `folio.add_item` is unchanged.
3. **Domain code has zero platform imports.**
4. **Every mutation emits events + audit.** `reservations.update_status` already does both; `dndFlag` joins the existing `reservation.front_office_updated` payload and `audit_log` before/after JSON. Occupancy failures throw inside `runIdempotent` (retryable key) the same way create does.
5. **Degraded mode never creates obligations.** Search and registration-card reads fail closed (no queued search, no print). Front-office writes stay `QUEUE_PROVISIONAL` (notes). Check-in occupancy reject is a live/precondition failure, not a new obligation.
6. **`runIdempotent` is sync-only.** Search is a read RPC. Occupancy asserts are sync SQL.
7. **`check:ddl`:** v23 SQL is generated via `pnpm generate:ddl` from `property-migrations.ts`.
8. **No new purge table.** `ALTER TABLE reservation` does not change `PROPERTY_PURGE_INVENTORY_TABLES`.
9. **No new `export class`.** `OccupancyExceededError` stays file-local. Do not export it; do not add it to `CLASS_DENYLIST`.
10. **`NIGHT_AUDIT_STEPS` stays seven.** Recurring posting is not folded in this chunk.
11. **Route audit append-only.** New routes start at index **105**. `[104] = post_room_ooo_range` does not move.
12. **New catalog commands** (none expected) would carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. Search is a **read route**, not a command.
13. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
14. **Party size is occupancy, not a second guest profile.** `adults >= 1`, `children >= 0`. Check-in does not invent additional guest CRM rows.

---

## 3. DND — stay flag, not a room state

### 3.1 Schema — v23

Justify v23: a boolean the HK/front-desk board can render cannot live only in free-text `front_office_comment`. One column, default off, no rebuild.

```sql
ALTER TABLE reservation ADD COLUMN dnd_flag INTEGER NOT NULL DEFAULT 0
  CHECK (dnd_flag IN (0, 1));
```

Migration name `prototype_holes`. `pnpm generate:ddl` → `migrations/do-property/0023_prototype_holes.sql`. Pin `PROPERTY_SCHEMA_HEAD === 23`.

Existing rows → `dnd_flag = 0`.

### 3.2 Write path — extend `reservations.update_status`

No new command id. Catalog notes become: *“Front-office comment, VIP flag, DND flag. Not the status-machine column.”* Events stay `['reservation.front_office_updated']`. Lane / degraded / permission / entitlement / audit membership **unchanged** (`QUEUE_PROVISIONAL`, `reservations:write`, ungated, `appendAuditLogSync` but **not** `AUDIT_WRITER_COMMAND_IDS`).

Input adds optional `dndFlag?: boolean`. Fingerprint `{ reservationId, frontOfficeComment?, vipFlag?, dndFlag?, noPost? }`. This chunk does **not** expand `noPost`: the RPC already supports partial updates — a field left `undefined` is unchanged (`input.noPost !== undefined ? … : reservation.no_post`, same pattern for comment / VIP, and for `dndFlag` below). The new editor submits only the fields it owns (`frontOfficeComment`, `vipFlag`, `dndFlag`) and never sends `noPost`. The folio no-post control (`FolioScreen.tsx` ~586, `{ noPost: !noPost }` only) keeps working unchanged and cannot be clobbered by an editor submit.

`tryUpdateFrontOffice`:

- SELECT gains `dnd_flag`.
- `nextDnd = input.dndFlag !== undefined ? (input.dndFlag ? 1 : 0) : reservation.dnd_flag`.
- UPDATE sets `dnd_flag = ?`.
- Outbox payload + audit before/after include `dndFlag`.
- Terminal statuses still `NOT_MODIFIABLE`. In-house (`checked_in`) **may** toggle DND (that is the point).

HTTP: `POST /v1/properties/:pid/reservations/:rid/front-office` body may include `dndFlag`. Replay dispatch passes it through.

### 3.3 Reads

`readReservation`, arrivals / departures / in-house mappers (`mapFrontDeskRow` ~7472) add `dndFlag: row.dnd_flag === 1`. Client `ReservationRead` / `FrontDeskItem` gain the field.

### 3.4 SPA

- Board tables: VIP and DND badges on the guest cell when `vipFlag` / `dndFlag` are true (`data-testid="badge-vip"` / `badge-dnd"`).
- Check-in and folio reservation chrome: DND checkbox bound to `updateFrontOffice` (same editor as §6).
- **Housekeeping board: not this chunk.** `listRooms` has no stay join (`property-do.ts` ~5184). Do not smuggle DND onto room rows. Attendants see DND on the in-house board. Leftover 3.

### 3.5 Degraded

Toggle is `QUEUE_PROVISIONAL` like other front-office writes. A queued DND flip is a note, not an inventory or money obligation.

---

## 4. Adults / children — remainder (standing KEEP)

Do not change the v20 columns or `assertOccupancySync` rule.

### 4.1 Check-in enforces occupancy

`tryCheckIn` SELECT includes `adults, children`. After the reservation is confirmed and before status flips to `checked_in`, call `this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children)`.

Map `OccupancyExceededError` → `{ ok: false, error: OCCUPANCY_EXCEEDED }` via existing `mapReservationPreconditionError` (~737). Dispatcher already treats `OCCUPANCY_EXCEEDED` as 422 (~279).

Rationale: KEEP text is *“check-in enforces occupancy.”* Create-time checks do not cover a later `inventory.update_room_type` that lowers caps, or a modify hole. Check-in is the last gate before the stay is in-house. Not overridable (same class as `ROOM_OUT_OF_ORDER`, not cleanliness).

### 4.2 Modify enforces occupancy and accepts party-only edits

Two defects, one fix:

1. After resolving `nextAdults = input.adults ?? reservation.adults` and `nextChildren = input.children ?? reservation.children` (load `adults`/`children` on the SELECT at ~6354), call `assertOccupancySync(input.roomTypeId, nextAdults, nextChildren)` **before** ledger writes. Type change uses the **new** type’s caps.
2. The early-return at ~6377–6389 currently treats “same dates and type” as a no-op and **ignores** `input.adults` / `input.children`. Change the predicate: if dates, type, adults, and children are all unchanged, return the current no-op success. If only adults/children change, skip inventory release/acquire, still UPDATE the two columns, still emit `reservation.modified` (party size is a stay fact). `availability.changed` only when nights/type actually move (existing).

Fingerprint already includes adults/children on PATCH (`v1-dispatch.ts` ~1683–1689). Create fingerprint (~1546) does **not** include adults/children — add them so a replay with a different party is `IDEM_KEY_REUSED`, not a silent first-result. Same for `bookingReservationOpId` on the client once the wizard sends party size.

### 4.3 Booking wizard

`BookingScreen.tsx`: integer inputs Adults (min 1, default 1) and Children (min 0, default 0). Include in `createReservation` body and in `bookingReservationOpId`. On `occupancy_exceeded`, message *“Party exceeds this room type’s occupancy.”* Disable confirm when adults < 1.

Do not add a second guest-profile flow. Do not search additional guests.

### 4.4 Check-in / board display

Check-in header shows `Adults {n} · Children {m}` from `GET reservation`. Board guest cell may show the same compact pair (optional if space is tight; check-in is required).

### 4.5 Degraded / idempotency

Check-in stays `QUEUE_PROVISIONAL`. Occupancy failure on **live** apply is 422; on **replay** of a queued check-in it is `provisional_exception` with reason `occupancy_exceeded` (same exception path as other precondition throws inside `runIdempotent`). Modify stays `FAIL_CLOSED`; occupancy miss is 422, key remains retryable.

---

## 5. Registration card — printable view

**Name it:** a front-desk **registration card** is a printable HTML view of an existing stay. It is not a folio, not an invoice, not §7.9 fiscal guest-registration reporting, and not a stored document.

### 5.1 No new storage, no new command

No table, no R2 put, no catalog id. Data:

- `GET /v1/properties/:pid/reservations/:rid` (already `FAIL_CLOSED`, `reservations:read`, entitled).
- Guest displayName via existing `POST …/guests/batch` (`guests:read`, `FAIL_CLOSED`), same as the board.

Printable fields (and only these): property name (from `GET property` / shell), reservation id (the confirmation), guest displayName, arrival / departure, room type id (code if the client already has types; else id), room code if `roomId` assigned, adults / children, VIP, DND, front-office comment. No folio balances, no payment PANs, no ID-document images.

### 5.2 SPA

Route: `/check-in/:reservationId` gains a **Print registration card** control (`data-testid="print-reg-card"`). Folio header gets the same link. Clicking opens a print-only panel (or `/reservations/:id/registration-card` client route that renders the same panel) and calls `window.print()`. `@media print` hides shell nav / side panels.

Disabled when:

- reservation query is not success (including `fail_closed` / `read_stale` / pending),
- guest state is not `resolved` (erased / not_found / decrypt unresolved / name pending),
- shell is in degraded / queued-only presentation (any `ClassifiedError` on the reservation read).

Copy on disabled: *“Registration card is unavailable while the property is unreachable.”* Never generate a PDF. Never `R2.put`.

### 5.3 Degraded

§4.6 “never print a folio or invoice in `DEGRADED`” extends to this artifact: a printed card is something the property might file. No print button in degraded. No queued “print” command.

---

## 6. Front-office editor (row 7 remainder)

Domain is done (§1.1). Folio already toggles no-post through this RPC. The remainder is a comment / VIP / DND editor.

### 6.1 Placement

One editor, reused:

- Folio screen reservation chrome (always; operator is already on the stay).
- Check-in screen (arriving).

Not a third nav item. Board stays a list; badges (§3.4) are read-only there.

### 6.2 Fields

- Comment: textarea, trim, max **2000** characters, empty → stored `NULL`. Enforce the cap in `tryUpdateFrontOffice` (`FRONT_OFFICE_COMMENT_TOO_LONG` → 422) if not already capped.
- VIP: checkbox → `vipFlag`.
- DND: checkbox → `dndFlag` (§3).
- Submit → `api.updateFrontOffice` with `stableKeyForOperation`. Last-writer-wins.

Editor payloads omit `noPost`; last-writer-wins applies per-field via the existing undefined-means-unchanged semantics. Disable when reservation status is terminal (client mirrors `NOT_MODIFIABLE`). Queue-unavailable → existing classified message. Do not expose `noPost` here (folio money-ops owns that control; sending it from this editor would race the folio toggle).

---

## 7. Global reservation search

### 7.1 Confirmation identity

There is no `confirmation_number`. **`reservation_id` is the confirmation.** Do not add a second public id this chunk. The search box placeholder: *“Reservation id or guest name”*.

### 7.2 Route — `[105] get_reservation_search`

| | |
|---|---|
| id | `get_reservation_search` |
| HTTP | `GET /v1/properties/:propertyId/reservations-search?q=` |
| scope | property |
| permission | `reservations:read` |
| entitlement | `pms.core` |
| `degradedRead` | **FAIL_CLOSED** |
| commandId | omitted (read) |

`findRoute` is first-match. `GET …/reservations/([^/]+)$` (`get_reservation`) would capture the literal `search` if the path were nested. Route audit is append-only, so splicing the search route earlier is not an option. Hyphenated `reservations-search` at index **105** (end) avoids the shadow.

One degraded class per route. Name hydration uses OrgDO (`readGuests`), so this cannot be `READ_STALE` even though §4.6’s table lists “guest lookup” as `READ_STALE`. Follow **shipped** reservation/guest reads (`get_reservation`, `get_front_desk_*`, `get_guest`, `post_guests_batch` are all `FAIL_CLOSED`), not the stale table row. Do not “fix” arrivals in this chunk.

`q` required, trimmed, 1–128 chars; else 400 `invalid_query`. Kill-switch `pms.core` → 402/503 same as other entitled reads.

### 7.3 Query algorithm (dispatcher + PropertyDO)

PropertyDO RPC `searchReservations(q: string)` (sync SQL, no OrgDO inside the DO):

1. **Exact id.** `SELECT … FROM reservation WHERE reservation_id = ?` (any status, including terminal). If hit, return `[row]` mapped like `mapFrontDeskRow` plus `dndFlag`. Stop.
2. **Name candidates.** If no exact hit and `length(q) >= 2`: load reservations where `status IN ('inquiry','pending','confirmed','checked_in')` **or** (`status IN ('checked_out','cancelled','no_show')` AND `departure_date >= date(openDate, '-7 days')`), cap **200** rows, `ORDER BY arrival_date DESC, reservation_id`. Return those rows to the dispatcher. If `length(q) < 2` and no exact hit → empty list (do not 400; single-char name scans are useless).

Dispatcher (after PropertyDO):

- Exact-id path: optional guest hydrate via `readGuests` for that one `guestRef` (same 50-ref batch helper). Missing/erased guest still returns the stay (`displayName` null / erased tombstone). OrgDO blip → 503 FAIL_CLOSED (do not return the stay without classifying — one class).
- Name path: unique `guestRef`s from the candidate set (≤ 200). Batch `readGuests` in chunks of 50 (existing limit). Filter `profile.displayName` case-insensitive **substring** (`includes`, not regex) against `q`. Skip erased / not_found / decrypt_unresolved. Cap **20** hits. Stable sort: arrival_date DESC, reservation_id. Decrypt-unresolved guests log `guests.read.decrypt_incident` and drop from name hits (do not 500 the search).

This is **not** a stored plaintext index. It decrypts at most 200 in-memory profiles for guests who have stays at this property. Org-wide `SELECT * FROM guest` is forbidden. Leftover 2 replaces this scan with a blind index.

### 7.4 Response

```json
{ "ok": true, "items": [ /* FrontDeskItem + dndFlag + adults + children + vipFlag + frontOfficeComment */ ] }
```

Empty `items` is 200, not 404. Exact unknown id → `{ ok: true, items: [] }`.

### 7.5 SPA — top bar

`AppShell` header, after nav, a search field (`data-testid="reservation-search"`, `role="search"`). Visible when `reservations:read`. Debounce 300ms. `q` length 0 clears results. Results popover: guest label, reservation id, dates, status. Click → `/folio/:reservationId` (folio is the stay home; check-in is one click from arrivals). Enter on a single exact hit navigates immediately.

Hide the control when `me` is degraded / no_access. On search `fail_closed`: *“Search unavailable — property unreachable.”* Do not fall back to a client-side scan of the current board.

### 7.6 Degraded / idempotency

Read. No idempotency key. OrgDO or PropertyDO outage → 503 FAIL_CLOSED. Never queue a search. Never write.

---

## 8. Command catalog, routes, events, audit

### 8.1 Catalog

No new command ids. Edits:

| id | Change |
|---|---|
| `reservations.update_status` | Notes mention DND. Fingerprint conceptually includes `dndFlag`. Events unchanged. |

`PLATFORM_GAPS` stays `[]`.

### 8.2 HTTP

Append only:

```
[105] get_reservation_search
  GET /v1/properties/:propertyId/reservations-search
  reservations:read, pms.core, degradedRead FAIL_CLOSED
```

`post_reservation_front_office` body documents `dndFlag`. No new write route.

### 8.3 Events

Reuse `reservation.front_office_updated`. Payload gains `dndFlag`. Consumer already accepts the event (~126); add optional `dndFlag` assertion only if the consumer asserts a closed field set — do not invent a new event type.

`reservation.modified` already fires on modify; party-only modify must still fire it (§4.2).

### 8.4 Audit

`tryUpdateFrontOffice` already writes `audit_log`. Include `dndFlag` in before/after. Size of `AUDIT_WRITER_COMMAND_IDS` stays **45**. Occupancy rejects do not write audit (no mutation).

### 8.5 Permissions / entitlements

| Surface | Permission | Entitlement |
|---|---|---|
| DND / comment / VIP write | `reservations:write` (existing) | none (QUEUE_PROVISIONAL) |
| Occupancy on check-in / modify | existing commands | existing |
| Search GET | `reservations:read` | `pms.core` |
| Reg card view | existing GET reservation + guests batch | existing |
| Print button | client-only | n/a |

Staff already has `reservations:read` and `guests:read` (`permissions.ts` ~88–90, ~114–116).

---

## 9. Schema, purge, denylist, DDL

- v23: single `ALTER TABLE reservation ADD COLUMN dnd_flag …` (§3.1).
- `pnpm generate:ddl`; `migrate.test.ts` pin head **23**; keep the v22 pin as historical.
- Real-SQLite: INSERT `dnd_flag = 2` fails CHECK; omitted column defaults 0.
- Purge inventory: no new table name.
- `CLASS_DENYLIST`: no change.
- `OccupancyExceededError` remains unexported.

---

## 10. SPA summary

| Screen | Change |
|---|---|
| `AppShell.tsx` | Search field + popover (§7.5). |
| `BookingScreen.tsx` | Adults / children inputs; send on create; occupancy error copy (§4.3). |
| `CheckInScreen.tsx` | Party size; print control; front-office editor (§4.4, §5.2, §6). |
| `FolioScreen.tsx` | Front-office editor; print control. |
| `BoardScreen.tsx` | VIP / DND badges; optional party-size text. |
| `HousekeepingScreen.tsx` | **Unchanged.** |

Client: `api.searchReservations(propertyId, q)`; `ReservationRead` / `FrontDeskItem` + `dndFlag`; `updateFrontOffice` extra `dndFlag`; `bookingReservationOpId` includes adults/children.

---

## 11. Degraded-mode behaviour (summary)

| Situation | Behaviour |
|---|---|
| Front-office / DND write, PropertyDO up | 200, `QUEUE_PROVISIONAL` if classified that way |
| Front-office write, PropertyDO down | Queue; replay last-writer-wins |
| Search, PropertyDO or OrgDO down | 503 FAIL_CLOSED; no results, no queue |
| Print, any reservation/guest read not live | Button disabled; no `window.print` |
| Check-in occupancy fail, live | 422 `occupancy_exceeded`; not queued as success |
| Check-in occupancy fail, queued replay | `provisional_exception` `occupancy_exceeded` |
| Modify occupancy fail | 422 FAIL_CLOSED; idempotency key retryable |
| Recurring charges | N/A — not built |

---

## 12. Test plan

Names are the acceptance list, not a file-split mandate. Existing lifecycle / routes / front-office tests stay.

**DND**

1. v23: new reservation `dnd_flag = 0`; CHECK rejects `2`. `PROPERTY_SCHEMA_HEAD === 23`.
2. `POST …/front-office` `{ dndFlag: true }` on `checked_in` → GET reservation `dndFlag: true`; event payload `dndFlag: true`; `audit_log` afterJson has it.
3. Toggle off with `{ dndFlag: false }` → 0. Terminal `checked_out` → 422 `not_modifiable`.
4. In-house list item includes `dndFlag`. Board test: badge present when true, absent when false.
5. Second POST same fingerprint → idempotent; one update.

**Occupancy remainder**

6. Create adults=2, type `max_adults = 2`, `max_occupancy = 2` → ok (existing 45 stays).
7. `tryCheckIn` after `inventory.update_room_type` lowers `max_occupancy` below adults+children → `OCCUPANCY_EXCEEDED`; status stays `confirmed`.
8. Modify type to a smaller cap with existing party → `OCCUPANCY_EXCEEDED`; sold unchanged.
9. Modify **only** `adults` (same dates/type) → row updates; no `availability.changed`; `reservation.modified` emitted; over-cap → `OCCUPANCY_EXCEEDED`.
10. Create fingerprint with adults=1 then replay adults=2 same key → `IDEM_KEY_REUSED` (not a stored 1-adult stay returned as success for a 2-adult request).
11. BookingScreen test: adults/children fields exist; create called with them; occupancy_exceeded shows the copy.

**Registration card**

12. Check-in: print control enabled when reservation + resolved guest load; `data-testid="print-reg-card"`.
13. Guest `name_pending` / erased / reservation `fail_closed` → control disabled; `window.print` not called.
14. Printed panel contains reservation id, displayName, dates, adults/children; does not contain folio `balanceMinor`.

**Front-office SPA**

15. Folio editor sets comment + vip; GET reservation reflects; board VIP badge after invalidate.
16. Comment of 2001 chars → 422.

**Search**

17. `[105] = get_reservation_search`; `[104]` still `post_room_ooo_range`. Path is `GET …/reservations-search` (not `…/reservations/search`).
18. `q` = exact `reservation_id` (including `checked_out`) → one item.
19. Unknown id → `{ items: [] }` 200.
20. Guest displayName substring (case-insensitive) matches in-house stay; erased guest name does not.
21. `q` of 1 character and not an exact id → `{ items: [] }`.
22. OrgDO transport failure → 503 FAIL_CLOSED (name or exact path).
23. Missing `reservations:read` → 403; kill-switch → 402/503 entitled pair.
24. AppShell: search visible with `reservations:read`; click result navigates to folio; hidden without the grant.

**Pins**

25. `AUDIT_WRITER_COMMAND_IDS.size === 45`; `PLATFORM_GAPS` `[]`; `NIGHT_AUDIT_STEPS.length === 7`; `SYSTEM_CHARGE_CODES` unchanged; `PROPERTY_PURGE_INVENTORY_TABLES` length unchanged; `CLASS_DENYLIST` unchanged.
26. `postRoomChargesSync` still does not read `breakfast_rule` (guard: no new schedule table; ROOM-only posting test still passes).

---

## 13. Leftovers (named, not this chunk)

1. **Per-stay recurring incidental schedule** (row 3). Minimal later design, recorded so it is not re-derived: table `reservation_recurring_charge` `(schedule_id, reservation_id, charge_code, amount_minor, currency, frequency CHECK ('NIGHTLY'), start_date, end_date)` with amount snapshotted at schedule-create; post inside `POST_ROOM_CHARGES` after ROOM using a non-`ROOM` active charge code (unique index already allows a second `(reservation_id, business_date, charge_code)`); skip when `no_post = 1`; CLOSED GUEST window fails the step via `insertFolioLineSync` (do not special-case); do not grow `NIGHT_AUDIT_STEPS`; do not treat `breakfast_rule` as an engine; weekly/one-shot, inclusion-driven auto-schedules, and amount edits after a night has posted stay out of v1.
2. **Blind-index guest / name search.** Replace the decrypt-scan in §7.3. Booking-wizard leftover stays: wizard has no search box.
3. **DND on the housekeeping board.** Requires a stay join on `listRooms` or assignments. Front-desk in-house is the Phase 1 signal.
4. **`READ_STALE` vs shipped `FAIL_CLOSED` on front-desk and guest reads.** Architecture §4.6 table is stale relative to entitled/OrgDO reads. A later honesty pass, not this sweep.
5. **Type-level photos** once a booking engine or inventory gallery exists (R2 prefix, not a Phase 1 column).
6. **Rate-plan inclusions** if leftover 1 grows an engine that can honour them.

---

## 14. Open questions (locked)

1. **Name-search window.** **Locked: active stays + 7-day terminal tail**, as spec’d in §7.3. Active-only is cheaper and misses “the guest who left yesterday”; the tail is the product.
2. **Search result navigation.** **Locked: folio**, as spec’d in §7.5. Folio is the one screen that already exists for every status (check-in is one click from arrivals).
3. **Comment max length.** **Locked: 2000**, as spec’d in §6.2. A shift note, not a CRM essay.
4. **Create fingerprint adults/children.** **Locked: include them.** The silent party-size replay (same create key, different occupancy, first result returned) is a bug; §4.2 fingerprint expansion stands.
5. **Check-in occupancy not overridable.** **Locked.** Same class as `ROOM_OUT_OF_ORDER`, not cleanliness. If the desk must walk in a party over the type cap, that is a type change / override product, not a checkbox.

---

## 15. Implementation checklist (for the plan author; not a plan)

- [ ] v23 `dnd_flag`; `pnpm generate:ddl`; head pin 23.
- [ ] `tryUpdateFrontOffice` + HTTP + replay + lists + `ReservationRead` + event payload.
- [ ] `tryCheckIn` / `tryModifyReservation` occupancy; modify party-only path; create fingerprint.
- [ ] `[105] get_reservation_search` + PropertyDO exact/candidates + dispatcher hydrate/filter.
- [ ] SPA: search, wizard party size, front-office editor, badges, print view.
- [ ] Tests in §12. Pointer sentences in room-ops / night-audit / lifecycle / booking-wizard specs.
- [ ] ARCHITECTURE.md §16.5: mark the nine rows decided (keep/defer/drop as §1.2) when this chunk lands — documentation commit in the same PR, not a silent doc skip.
