# Room number at booking (R4.26)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.26 (Track P). Pilot checklist: *New reservation (… room number …)*.
**Depends:** R1.4 (Book and its add-on follow-up pattern), R1.15 (stay card).
**Sources:**
- Roadmap R4.26: an optional picker on Book; after Hold or Confirm it POSTs the existing `reservations.assign_room`; **no new command and no `roomId` on create**.
- `tryAssignRoom`:
  - It accepts `pending`, `confirmed` and `checked_in`.
  - It checks room type and overlap over the stay's window (`RoomAlreadyAssignedError` → `ROOM_ALREADY_ASSIGNED`).
  - It checks readiness only on a move of an in-house guest.
- `get_front_desk_available_rooms` (`fromDate`, `toDate`, `roomTypeId`).
- R1.3 tape empty-cell links: `bookHref({arrival, departure, roomTypeId})` in `apps/web-pms/src/status/book-href.ts`.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **SPA-only slice.** There is no new command, route, migration or pin. Inventory stays per room type (§7.1); `sold` moves once, on create, exactly as today. |
| D2 | Book gains an optional **Room** `NativeSelect` once a room type and dates are chosen. It lists the rooms that `get_front_desk_available_rooms` returns for `fromDate = arrival`, `toDate = departure` and `roomTypeId`. The first option is "Assign later" (the default). |
| D3 | After a successful **Hold** or **Confirm** with a room picked, Book POSTs `reservations.assign_room` for the new reservation id. It follows the R1.4 add-on follow-up: the booking stands whatever happens; on failure an `Alert` says "Booking saved; room {number} could not be assigned: {classifiedUserMessage}" with **Retry** (same body, same idempotency key) and a link to the stay card. `ROOM_ALREADY_ASSIGNED` reads "Room {number} was taken in the meantime. Pick another room on the stay card." **Quote** and **Inquiry** never assign: the picker is disabled for them, with the reason shown. |
| D4 | The tape's empty-cell link carries the room. `bookHref` gains an optional `roomId`, and the tape passes the clicked row's room. Book reads `?roomId=`, preselects it if it is in the available list, and otherwise shows a one-line note that it is no longer free. |
| D5 | Changing the room after booking stays on the stay card (existing assign / move). Nothing new there. |

## 2. Cache and keys

- Rooms query key: `['front-desk-available-rooms', propertyId, arrival, departure, roomTypeId]`. Reuse the existing key if one exists for this route; check it first.
- After a successful assignment, invalidate:
  - `['board']`
  - the tape key `['front-desk-tape', propertyId, …]` (prefix)
  - the arrivals and summary keys the board uses
  - the rooms query

  Tests assert them against the consumer keys (AGENTS §4, §5).

## 3. Tests

pms-core (characterization, through the existing routes):

- Create a confirmed booking, then `assign_room` → arrivals shows the room. `availability_day.sold` is +1 for each night, unchanged by the assignment.
- Two bookings race for one room: the second `assign_room` → `ROOM_ALREADY_ASSIGNED`, and the second reservation still exists, unassigned.
- If `tryAssignRoom` refuses a `pending` (Hold) reservation today, stop and report it rather than widening the command.

web-pms:

- The picker lists only the rooms the available-rooms response returns for the chosen type and dates.
- Confirm with a room posts create, then assign, with the new reservation id.
- An assign failure keeps the booking, shows the Alert with Retry, and Retry re-sends the same key.
- `ROOM_ALREADY_ASSIGNED` shows the taken-room copy.
- Quote and Inquiry disable the picker.
- `?roomId=` preselects it.
- `bookHref` with a `roomId` builds the query.
- The tape's empty cell passes its room.
- The invalidation keys are asserted.

## 4. Out of scope (client Q16)

- A waitlist status.
- Booker and guest-type fields.
- A room picker on modify.
- Any change to `reservations.create`.
