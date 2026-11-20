# Live room view (R4.27)

**Date:** 2026-11-20
**Status:** Accepted for implementation
**Roadmap:** R4.27 (Track P). Pilot checklist: *Live room view by status*.
**BluePMS page group:** Front Office → *Room operations and availability*, the live view grouped by room type and condition ([inventory](../../research/2026-09-12-bluepms-modules.md)). Its colour vocabulary is available, reserved, occupied, dirty, maintenance, billed and unavailable.
**Sources:**
- The roadmap R4.27 locks.
- AGENTS §2: availability is a ledger; never count reservations for capacity.
- AGENTS §4:
  - the Dashboard reads `get_front_desk_summary`;
  - the word is always shown (`RoomStatus`, `StatusBadge`);
  - nav gating matches the route permission.
- R4.29: an active invoice on the GUEST window.
- `room.status` (`clean | dirty | inspected | out_of_order`), the `room_ooo` ranges, and `get_front_desk_summary`.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **One read, rooms for today.** A new route, `get_room_board` (`GET /v1/properties/:propertyId/room-board`), has permission `reservations:read`, entitlement `pms.core` and degraded mode `FAIL_CLOSED`. It returns the property's business date and every non-archived room with:<br>• code, floor, room type id and name;<br>• housekeeping status;<br>• today's OOO range, if any (reason and end date);<br>• its **in-house stay**, if any: reservation id, `guestRef`, departure date, VIP, due-out-today flag, and whether the GUEST window has an active invoice;<br>• its **arrival today**, if any: reservation id, `guestRef`, status, unassigned or assigned;<br>• its **condition** (D2).<br>It is a pure read over `room`, `room_ooo`, `reservation` and `invoice`. It answers "which stay is in this room", never capacity. No plaintext names. |
| D2 | **One condition per room**, decided on the server in this order:<br>1. `maintenance`: an OOO range covers the business date, or `room.status = 'out_of_order'`;<br>2. `billed`: an in-house stay whose GUEST window has an active invoice, meaning the bill was generated and the guest has not departed;<br>3. `occupied`: an in-house stay (`checked_in`), including due-outs;<br>4. `reserved`: no in-house stay and an arrival assigned to this room for today (`pending` or `confirmed`);<br>5. `dirty`: none of the above and `room.status = 'dirty'`;<br>6. `available`: `clean` or `inspected` with none of the above.<br>`unavailable` stays in the vocabulary but is never assigned: HospAI has no out-of-service or management-block state yet. Empty groups are not shown, so a "0 unavailable" is never invented. The housekeeping word (`RoomStatus`) is shown beside the condition, so a reserved room that is still dirty reads "Reserved · Dirty". |
| D3 | **Summary cards** come from the existing `get_front_desk_summary` (`BoardSummary`): arrivals, in-house, departures and occupancy, with capacity from `availability_day`. Per-condition counts are the number of **rooms** in each group in the D1 list. Nothing counts reservations for capacity. |
| D4 | **Screen: `/rooms/live`, titled "Live rooms".** Its nav item sits under Front Desk, gated by `reservations:read`. `PageHeader` is the single `<h1>`, and the subtitle uses the live `property.name`.<br>Layout:<br>• the summary cards;<br>• filters: room type, condition, and grouping by condition or by room type;<br>• rooms as compact tiles: room code, condition word plus colour, housekeeping word, the guest name (or arrival name) through the existing property-scoped guest batch (chunked to 50; FORBIDDEN or unresolved follows the existing pattern), and departure or arrival date.<br>**Not a second grid:** there are no date columns. Words are always shown, and colour never stands alone (condition colours are `--color-*` tokens with light and dark values, checked by `check:web-pms-colors`). |
| D5 | **Actions are links to what already exists**, shown per condition:<br>• *Book* on an available room: Book prefilled with the room if Book supports it (R4.26), else plain Book;<br>• *Check in* on a reserved room;<br>• *Assign* on an arrival with no room, through the existing assignment flow;<br>• *Folio* on an occupied or billed room;<br>• *Release* on a maintenance room, to the existing OOO release.<br>No new command. A link whose target does not exist yet is left out. |
| D6 | **Freshness:**<br>• the query key is `['room-board', propertyId]`, with `staleTime` 60 s and no 1 s polling;<br>• `FrontOfficeLive` events invalidate it for other tabs;<br>• local mutations invalidate it on success: check-in, check-out, undo checkout, assign room, room status, bulk status, OOO set or release, invoice generate or void, early depart.<br>Tests assert the key. |
| D7 | **Tenancy:** the route uses `resolvePropertyContext(…, ctx.tenantProperty)` and reads one PropertyDO. Guest names come from the property-scoped batch, so hotel A never sees hotel B's rooms or guests. |

## 2. Tests

pms-core (`apps/pms-core/test/room-board.spec.ts`):
1. A checked-in stay → `occupied` with its `guestRef`; due out today → still `occupied`, with the due-out flag.
2. After checkout → the room shows `dirty`, with no in-house stay.
3. An OOO range covering today → `maintenance`, whatever the other states; `out_of_order` status → `maintenance`.
4. An in-house stay with an active GUEST invoice → `billed`; after the invoice is voided → `occupied`.
5. An assigned arrival today → `reserved`; with the room dirty, the condition stays `reserved` and the housekeeping status is `dirty`.
6. A clean room with nothing → `available`; archived rooms are absent.
7. Two properties in one org: hotel A's read returns only A's rooms.
8. Room counts per condition add up to the number of rooms. The summary card numbers equal `get_front_desk_summary` for the same date.
9. Degraded → `FAIL_CLOSED`; without `reservations:read` → 403.

contracts: the route pin.

web-pms:
- condition and housekeeping words render, never raw codes or UUIDs;
- filters and grouping work;
- empty groups are hidden;
- actions per condition;
- the guest batch is chunked;
- error, empty and "no rooms match" are three different states;
- the nav is gated;
- the cache key and the invalidations from check-in, check-out and room status are asserted.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +1 → **208**, last id **`get_room_board`**.
- Catalog, audit writers and schema are unchanged (127, 93, 51).
- Update the AGENTS.md pins table.

## 4. Out of scope

- Calendar settings.
- Door lock and Wi-Fi actions.
- A date-range grid (that is the tape, R4.28).
- An out-of-service or management-block state.
- Room actions that do not exist yet.
