# Housekeeping depth, Part A: guest requests, lost and found, missing and damage cases (R4.11)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part A of three)
**Roadmap:** R4.11 Housekeeping depth (Track P). Parts B (inspections, cleaning stages, guest-count audit) and C (linen, minibar, amenities) follow, each as its own spec and commit.
**BluePMS page group:** Housekeeping → *Guest service and exceptions* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- requests with room, guest, type, responsible department, note, ownership, status, search and resolution;
- a lost-and-found custody register through handover, claim and closure;
- missing and damaged cases with reporter, inspection detail, closure note and returned-item status.

**Sources:**
- The roadmap R4.11 entry: desktop capture first, never deleted, guest requests moved here from R5.2, which reuses this record. It is not a maintenance work order.
- The [R4.30 spec](./2026-11-20-housekeeping-tasks-status-history-design.md) for the module pattern (`moduleTxnCtx`, unprefixed `housekeeping_*` tables, staff refs).
- AGENTS §1 PII: no plaintext guest names outside the OrgDO vault.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Guest requests.** A table `housekeeping_request`, owned by `pms.housekeeping`. Fields:<br>• business date;<br>• `room_id` (required); `reservation_id` (optional, the stay in the room);<br>• `request_type` code;<br>• `department` (`housekeeping \| front_office \| maintenance \| food_beverage`);<br>• note (≤ 500);<br>• `assignee_ref` (`staff_…` or null);<br>• `status`: `open → in_progress → resolved`, or `cancelled` from open or in progress;<br>• resolution (≤ 500, required to resolve);<br>• timestamps and actors.<br>Request types come from the DOMAIN key `pms.housekeeping.request_types`: up to 30 `{ code, label, department }`, with defaults for extra towels, extra pillows, cot, toiletries, iron (housekeeping), wake-up call (front office) and repair (maintenance). The department defaults from the type and can be changed. A maintenance request is **not** a maintenance ticket; nothing is created in the maintenance module. Nothing is deleted. |
| D2 | **Lost and found custody.** A table `housekeeping_lost_item`, plus an append-only `housekeeping_lost_item_event`. Fields:<br>• item description (≤ 200);<br>• category (`electronics \| documents \| jewellery \| clothing \| money \| other`);<br>• where found (≤ 200);<br>• `room_id` and `reservation_id`, both optional;<br>• `found_by` (`staff_…`), found time;<br>• storage location (≤ 120);<br>• status `found → handed_over → claimed \| disposed`, then `closed`.<br>The custody steps:<br>• **Handover** records the staff ref it went to (for example security).<br>• **Claim** records the claimant as a **guest record** (`guestRef`): the stay's guest or a guest picked through the existing property-scoped guest search. A typed name is never stored (AGENTS §1). An optional free-text "proof checked" note (≤ 200) is allowed, but not ID numbers.<br>• **Dispose** needs a reason.<br>• **Close** ends custody.<br>Every step writes an event row, and nothing is deleted. |
| D3 | **Missing and damage cases.** A table `housekeeping_case`. Fields:<br>• `kind` (`missing \| damaged`);<br>• `room_id` (required) and `reservation_id` (optional);<br>• item (≤ 200);<br>• reporter (`staff_…`);<br>• inspection detail (≤ 1000);<br>• returned-item status (`not_returned \| returned \| partially_returned \| not_applicable`);<br>• status `open → closed` with a required closure note (≤ 500).<br>No folio posting: charging a guest for damage stays the existing money-ops DAMAGE path. A "Post damage charge" link on an open case goes to the stay's folio when there is a reservation. |
| D4 | **Commands** (INTERACTIVE, `pms.core`-entitled so the kill-switch applies, idempotent `{ commandId, payload }` per user with `x-idempotency-key`, audit writers, `housekeeping:write`):<br>• `housekeeping.create_request`, `housekeeping.update_request` (assign, start, resolve, cancel, edit note or department while open);<br>• `housekeeping.record_lost_item`, `housekeeping.update_lost_item` (hand over, claim, dispose, close, edit while found);<br>• `housekeeping.open_case`, `housekeeping.update_case` (edit while open, close).<br>Invalid moves → `422 invalid_task_transition` (reused from R4.30). A missing required reason or note → `reason_required`. The reservation id, when given, must belong to the same property and the same room for its stay dates; else `invalid_request`. |
| D5 | **Reads** (`housekeeping:read`, FAIL_CLOSED, property-scoped, capped at 500 rows):<br>• `get_housekeeping_requests`: filters for date range, status, department, room and search (note, type label);<br>• `get_lost_items`: filters for status, date range and search, with the event history per item in a detail read, `get_lost_item`;<br>• `get_housekeeping_cases`: filters for kind, status and date range.<br>Responses carry `guestRef` and `reservationId`, never names. |
| D6 | **Where they appear:**<br>• **Housekeeping**: three new tabs (*Requests*, *Lost & found*, *Cases*). Each has a list, filters, a create `Dialog`, row actions by state (destructive ones confirm), and counters (requests: open, in progress, resolved today; lost: in custody, claimed this month; cases: open). The Board shows an "open requests" count per room.<br>• **Desk**: the folio and stay card get a *Guest request* button that opens the create dialog prefilled with the room and reservation. Requests for any department are listed on the Housekeeping *Requests* tab, filterable by department.<br>• Guest names render through the property-scoped batch.<br>• Error, empty and "no match" are three states.<br>• Words, never codes.<br>• Settings → Housekeeping gains the request-type list editor, beside task types. |

## 2. Data

PropertyDO migration 53 adds `housekeeping_request`, `housekeeping_lost_item`, `housekeeping_lost_item_event` and `housekeeping_case`. All are owned by `pms.housekeeping` (manifest `schema.tables` and `writes`), in the purge inventory and the DDL files, and written only through module use cases.

## 3. Tests

pms-core (`apps/pms-core/test/housekeeping-depth-a.spec.ts`):
1. Request lifecycle; resolve needs a resolution; an invalid move is refused; replay → one row; an unknown type → `invalid_request`; the department defaults from the type.
2. A request with another room's reservation → `invalid_request`.
3. Lost item custody: found → handed over → claimed (with a `guestRef`) → closed writes 4 events; dispose without a reason → `reason_required`; no endpoint deletes.
4. A case closes only with a note; returned-item status is kept.
5. Two properties in one org: hotel A's lists show no hotel B rows.
6. No plaintext name column exists in the new tables (a schema assertion).

contracts: catalog, routes, audit writers, config key.

do-runtime: migration 53.

web-pms and module:
- the three tabs, their states and actions;
- the claim picks a guest, never free text;
- the desk *Guest request* button prefills;
- the settings editor;
- cache keys (`['housekeeping-requests', propertyId, …filters]`, `['lost-items', propertyId, …]`, `['housekeeping-cases', propertyId, …]`), with mutations invalidating them.

## 4. Pins

- `COMMAND_CATALOG` +6 → **136**.
- `V1_HTTP_ROUTE_AUDIT` +10 (6 commands, 4 reads) → **224**, last id **`get_housekeeping_cases`**.
- `AUDIT_WRITER_COMMAND_IDS` +6 → **102**.
- `PROPERTY_SCHEMA_HEAD` **53**.
- Config +1 (`pms.housekeeping.request_types`).
- Update the AGENTS.md pins table.

## 5. Out of scope (Parts B and C, or later)

- Inspections, cleaning stages and guest-count audit (Part B).
- Linen, minibar and amenities (Part C).
- Attendant mobile capture (R4.10).
- Concierge or Whistle messaging (R5.2 reuses the request record).
- Charging damage through a new path.
- Reports (R4.14).
