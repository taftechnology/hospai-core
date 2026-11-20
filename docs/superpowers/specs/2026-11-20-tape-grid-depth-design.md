# Room operations grid depth (R4.28)

**Date:** 2026-11-20
**Status:** Accepted for implementation (the range stays at 14 days under fork F2 until client Q18)
**Roadmap:** R4.28 (Track P). Pilot checklist: *Room operations grid / tape*.
**BluePMS page group:** Front Office → *Room operations and availability*, the grid of availability, occupancy, reservations and room actions, with an occupancy row and colours for available, reserved, occupied, dirty, maintenance, billed and unavailable ([inventory](../../research/2026-09-12-bluepms-modules.md)).
**Sources:**
- The roadmap R4.28 locks and fork F2.
- AGENTS §2: availability is a ledger, and `freeAvailability` is imported.
- AGENTS §4:
  - the tape key is `['front-desk-tape', propertyId, from, to]`;
  - the 14-day UI cap;
  - no virtualizer on 7 days.
- R4.27: `roomBoardCondition` in contracts, and the condition tokens.
- `/board` (`TapeChartScreen`, `TapeGrid`, `StayBar`, `TapeFreeRow` reading `get_property_availability` under `['front-desk-free', propertyId, from, to]`), and `get_front_desk_tape`.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Widen `/board`; no second grid.** The same screen, grid math (`--tape-*`) and range cap (`MAX_TAPE_UI_DAYS = 14`, F2). No drag-to-move, no new assign POST, no virtualizer. |
| D2 | **Occupancy row** under the free row, one cell per date, from the same `get_property_availability` items the free row already loads (same query and key, no new request). For each date, over the room types on the tape:<br>• sellable = Σ (`physical` − `blocked`);<br>• occupied = Σ `sold`;<br>• the cell shows "occupied / sellable" and a whole-number percent (rounded for display only).<br>`held` stays 0 (Phase 3). Nothing counts reservations. The row is shown under the free row's `inventory:read` gate and has the same pending and error states. |
| D3 | **Per-date room states on the grid:**<br>• **reserved / occupied:** the existing stay bars keep their `StatusBadge` word (pending or confirmed → its word; `checked_in` → "In house");<br>• **billed:** an in-house stay whose GUEST window has an active invoice shows a "Billed" word on its bar. `get_front_desk_tape` stay rows gain `invoiced: boolean`, the same predicate as R4.27; it is an additive field on an existing read, not a new route;<br>• **maintenance:** the existing OOO range blocks, labelled "Maintenance" with the R4.27 maintenance token;<br>• **dirty today:** the business-date cell of a room whose housekeeping status is `dirty` and that has no in-house stay shows "Dirty" with the R4.27 dirty token. Housekeeping status is current only, so only today's column shows it.<br>The word is always shown, and colour never stands alone. |
| D4 | **Filters** (client-side, over the loaded tape data):<br>• room type;<br>• today's status, through the shared `roomBoardCondition` from contracts, fed from the tape's room, OOO, in-house and arrival data for the business date.<br>Filtering never changes the query key, so tape invalidation (`['front-desk-tape', propertyId, from, to]` and the `['board']` prefix) keeps working. The filters live in the URL query string (`?type=…&status=…`) so a refresh keeps them. "No rooms match" is its own state, apart from empty and error. |

## 2. Tests

pms-core: `get_front_desk_tape` returns `invoiced: true` for an in-house stay with an active GUEST invoice, and `false` after the invoice is voided.

web-pms:
1. The occupancy row equals Σ sold / Σ (physical − blocked) from mocked availability items per date, for the room types on the tape.
2. The occupancy row is hidden without `inventory:read`.
3. Billed, Maintenance and Dirty-today words render.
4. The room-type and status filters narrow the rows; "No rooms match" shows.
5. With a filter set, a check-in mutation still invalidates `['front-desk-tape', propertyId, from, to]`. The query key carries `propertyId` and the range.
6. The 14-day cap is unchanged.

## 3. Pins

No new route, command or migration. All pins unchanged: 127 / 208 / 93 / 51.

## 4. Out of scope

- Calendar colour settings.
- A virtualizer.
- Ranges beyond 14 days (F2, Q18).
- Drag-to-move and new assign actions.
- An "unavailable" state.
