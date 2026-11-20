# Housekeeping supervisor dashboard (R4.31)

**Date:** 2026-11-20
**Status:** Accepted for implementation
**Roadmap:** R4.31 (Track P). Pilot checklist: *Supervisor dashboard*; *Priority / floor-by-floor workbench*.
**BluePMS page group:** Housekeeping → *Command centre and readiness*, *Status and turnaround* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- readiness percentage;
- counts of dirty rooms, open and overdue tasks, active blocks, open requests, unclaimed items, damage cases and audit variance;
- pending arrivals and departures for prioritising;
- floor comparison;
- room search with current stay context;
- one attention queue across conflicts, overdue tasks, blocks, requests and damage.

**Sources:**
- The roadmap R4.31 locks: room-level reads only; no trend, no warehouse, no capacity from reservations.
- R4.27 (`get_room_board`, `roomBoardCondition`), R4.30 (tasks, overdue), and R4.11 Parts A and B (requests, lost items, cases, guest audit).
- `pms.housekeeping.require_inspection`.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **One composed read.** `get_housekeeping_dashboard`: `GET /v1/properties/:propertyId/housekeeping/dashboard`, `housekeeping:read`, `pms.core`, FAIL_CLOSED. One PropertyDO read for the business date, composed from the same queries and predicates the source reads use (shared helpers, not copies), so every count matches its source. It returns `guestRef`s only, never names. |
| D2 | **Readiness.** A room is **ready** when it is not under maintenance (the R4.27 condition) and its status is `inspected`, or `clean` when the property does not require inspection.<br>**Readiness %** = ready / rooms not under maintenance, as a whole percent rounded half up (0 rooms → 100). Returned for the hotel and **per floor** (rooms, ready, dirty, under maintenance, occupied, readiness %). |
| D3 | **Counts:**<br>• dirty rooms;<br>• open and overdue tasks (the R4.30 counters);<br>• active blocks (OOO covering the business date);<br>• open requests (open + in progress, all departments);<br>• unclaimed lost items (found or handed over);<br>• open damage and missing cases;<br>• **audit variance**: lines in today's guest-audit session whose counted value differs from front office, or null when there is no session today. |
| D4 | **Arrivals and departures by room:**<br>• today's arrivals (`pending` or `confirmed`, arriving on the business date) with room (or "unassigned"), the room's status and condition, and ready yes or no;<br>• today's departures (in house, departing on the business date) with room and status.<br>These are lists for prioritising, not capacity counts. |
| D5 | **Attention queue.** One list, newest first within each kind, capped at 100. Each row has a kind, a room, a short subject and a link target:<br>• `occupied_out_of_order`: an in-house stay in a room under a maintenance block;<br>• `occupied_counted_vacant`: today's guest audit counted 0 adults and 0 children where front office had guests (the room was "marked vacant" while occupied);<br>• `arrival_not_ready`: an arrival assigned today whose room is not ready (D2);<br>• `overdue_task`;<br>• `active_block`;<br>• `open_request`;<br>• `open_case`.<br>Link targets are the existing screens: the Tasks, Requests and Cases tabs, the Maintenance screen, the folio and Live rooms.<br>**No checkout-time alerts** (the stay holds no expected checkout time; Q22). |
| D6 | **Room search with stay context.** `get_housekeeping_dashboard?room=<code prefix>` adds up to 20 matching rooms, each with:<br>• status and condition;<br>• the in-house stay (`guestRef`, departure);<br>• the next arrival (`guestRef`, date);<br>• open tasks and requests.<br>The SPA debounces the search. |
| D7 | **SPA: Housekeeping → Overview tab, now the default tab.**<br>• count cards (each linking to its tab);<br>• the readiness % and a **floor table** (no chart);<br>• the attention queue (kind words, room, subject, a link);<br>• the arrivals and departures lists;<br>• the room search box with result cards.<br>Guest names come through the property-scoped batch. Words, never codes. Three states (error, empty, no match). Business-date default. The query key is `['housekeeping-dashboard', propertyId, businessDate, search]`, invalidated by the housekeeping, room-status and front-desk mutations (the R4.27 mutation-cache invalidation covers it if that pattern is used). |

## 2. Tests

pms-core (`apps/pms-core/test/housekeeping-dashboard.spec.ts`), on a seeded day:
1. Each count equals its source read:
   - dirty rooms against `get_rooms`;
   - tasks against `get_housekeeping_tasks` counters;
   - requests, lost items and cases against their lists;
   - active blocks against OOO ranges.
2. Readiness % and per-floor rows, with and without `require_inspection`.
3. Conflicts:
   - an in-house room put under OOO → `occupied_out_of_order`;
   - a guest-audit count of 0 against front office 2 → `occupied_counted_vacant`;
   - a dirty room with an assigned arrival → `arrival_not_ready`.
4. Room search returns stay context.
5. Two properties in one org: hotel A sees only hotel A.
6. No capacity figure is derived from reservations; the response has no occupancy percentage.

web-pms and module:
- the Overview renders counts, floors, the queue with links, the lists and the search;
- three states;
- the cache key.

## 3. Pins

- `V1_HTTP_ROUTE_AUDIT` +1 → **245**, last id **`get_housekeeping_dashboard`**.
- Catalog, audit writers and schema unchanged (147, 113, 55).
- Update the AGENTS.md pins table.

## 4. Out of scope

- Charts and trends (§7.8).
- Checkout-time alerts (Q22).
- Productivity.
- Reports (R4.14).
