# In-house stay changes (R4.24)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.24 (Track P). Pilot checklist: *Edit reservation and guest preferences* (the in-house half).
**Depends:** R1.15 (stay card), R1.19 (room move), R4.20 (nightly amounts and `is_override`), R0.14 (early departure, shipped).
**Sources:**
- Roadmap R4.24 lock. It is a **named command**, not a wider `reservations.modify`, because posted nights must not re-price.
- `tryModifyReservation` (it rejects `checked_in` with `not_modifiable`), `commitSoldNightsSync`, `releaseSoldNightsSync`, `resolveInventoryCommitSync`, `firstUnavailableNight` / `freeAvailability`, `assertRoomAssignableSync`, `assertRoomVacantNowSync`, `assertOccupancySync`, `syncReservationRateNightsOnModifySync`, `resnapshotRateNightsForPlanChangeSync`, and the consumed-night test (a `ROOM` / `NO_SHOW` folio line for that business date).
- [Early depart](./2026-09-05-early-depart-cash-fx-hygiene-design.md): shortening stays there.
- `runAutoExtendSync`: it extends a stay whose `departure_date = businessDate + 1` by one night.
- [Day-wise rate override](./2026-11-19-day-wise-rate-override-design.md) D7: overridden nights keep their amount.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | There is one new command, **`reservations.change_in_house_stay`**, with its own permission **`reservations:change_in_house`**. It is granted to `admin` and `staff`; `owner` gets it through `GRANTABLE_PERMISSIONS`. Because the permission is separate, the hotel can take it away from a role. It is INTERACTIVE, `pms.core`, FAIL_CLOSED, kill-switch on, idempotent and an audit writer. |
| D2 | It acts only on `checked_in`. Anything else → `422 not_in_house`. The command covers **a later departure, room type, rate plan and party size**. A departure earlier than the current one → `422 use_early_depart`; the SPA links to the early-depart action. |
| D3 | **Effective night E** is the first stay date on or after the business date with no consumed line. Nights before E are posted and are never touched: no folio line changes, no `sold` change and no rate-night change. |
| D4 | **Later departure.** The new nights `[oldDeparture, newDeparture)` get `sold + 1` through `commitSoldNightsSync` on the allocated ledger type. A shortage on any of them → `no_availability` (with `date`), and nothing changes. Rate nights for the new nights are snapshotted from `rate_day`, plus the stored promo. The assigned room must be free for the new nights (`assertRoomAssignableSync` over `[oldDeparture, newDeparture)`). If it is taken → `room_already_assigned`, and the clerk moves first (R1.19). The total stay is capped at the 90-night limit already used for availability (`limit_exceeded`). |
| D5 | **Room type change.** It needs a `roomId` of the new type in the same command. The room stays part of the stay, so a type change is always a move.<br>• Inventory: release `[E, departure)` on the old allocated type (`releaseSoldNightsSync`), then commit `[E, departure')` on the new type through `resolveInventoryCommitSync` + `commitSoldNightsSync`. `departure'` is the new departure if the same call also extends.<br>• The move: the same checks as an in-house move in `tryAssignRoom`, which are `assertRoomAssignableSync` over `[max(arrival, businessDate), departure')`, `assertRoomVacantNowSync` and readiness. The old room is marked dirty. The command's reason is used as the move reason.<br>• `allocated_room_type_id` and `room_type_id` become the new type from E on. There is one row per stay, so the row holds the current type; the posted lines already carry their own charges.<br>• Unconsumed rate nights from E are re-snapshotted at the new type's `rate_day`, **except overridden nights** (`is_override = 1`), which keep their amount. |
| D6 | **Rate plan change.** Unconsumed rate nights and their inclusion nights are re-snapshotted to the new plan through `resnapshotRateNightsForPlanChangeSync`, which already skips consumed nights and, after R4.20, overridden nights. |
| D7 | **Party size.** `adults` / `children` are updated after `assertOccupancySync` for the (new) type. Inclusions follow at posting, because units are computed when posted, and posted lines do not move. No guest rows are added (F4). |
| D8 | **One transaction for everything.** All inventory, rate-night, room and status writes happen in one `transactionSync`, with `freeAvailability` imported, never inlined. A single `audit_log` row records before and after for every changed field plus the reason. The events are `reservation.modified` (ids only) and, when inventory moved, `availability.changed`. |
| D9 | **Auto-extend does not double count.** The command reads `departure_date` inside the transaction and commits only the nights beyond it. Auto-extend picks only stays with `departure_date = businessDate + 1`. So if either runs first, the other sees the moved departure. Test both orders. |
| D10 | At least one field must change. An empty change → `422 invalid_request`. A reason of 1–200 characters is required (`reason_required`). |

## 2. HTTP

There is one new route. `V1_HTTP_ROUTE_AUDIT` +1; the last id is `post_reservation_in_house_change`.

| Route id | Method + path | Permission | Body |
|---|---|---|---|
| `post_reservation_in_house_change` | `POST /v1/properties/:propertyId/reservations/:reservationId/in-house-change` | `reservations:change_in_house` | `{ departureDate?, roomTypeId?, roomId?, ratePlanId?, adults?, children?, reason }` plus the idempotency key in the same place `post_reservation_early_depart` uses (header `x-idempotency-key`, AGENTS §1). |

The fingerprint is `{commandId, payload}` over the exact object sent to the DO. New error codes go in the one `commandErrorHttpStatus` table:
- `not_in_house` (422)
- `use_early_depart` (422)
- `room_id_required` (422; type change without a room)

## 3. Operator SPA

- **Stay card (`ReservationStayScreen`):**
  - For `checked_in`, the disabled Modify (`IN_HOUSE_MODIFY_REASON`) is replaced with **Change stay**, shown when `me` has `reservations:change_in_house`.
  - It opens a `Dialog` with:
    - the departure date, minimum today's departure;
    - the room type;
    - when the type differs, a **Room** select listing free rooms of that type from `get_front_desk_available_rooms` for `[businessDate, departure')`;
    - the rate plan;
    - adults and children;
    - a required **Reason**.
  - A one-line preview states what changes: "Adds 2 nights (24–26 Nov)", "Moves to Suite 304 from tonight", "Rate plan applies from tonight".
  - An earlier departure shows "To shorten the stay use Early departure" with a link to the folio's early-depart action.
- **On success:** invalidate `stayMutationQueryKeys` (board, tape, summary, available, directory, availability, guest stays, reservation, folio) and `['reservation-rate-nights', propertyId, reservationId]`. Show a settled `Alert`. Map errors with `classifiedUserMessage`, giving `no_availability` its date and `room_already_assigned` the "move the guest first" copy.
- Tests assert the invalidation keys.

## 4. Tests (pms-core)

1. Extending into a sold-out night → `no_availability` with that date. `sold`, `departure_date`, the rate nights and the audit log are unchanged.
2. Extending by two nights → `sold + 1` on exactly those two nights, and rate nights exist for them. The same-key replay is a no-op.
3. A type change from E:
   - `sold` −1 on the old type and +1 on the new type for `[E, departure)` only;
   - the nights before E unchanged;
   - the posted ROOM / TAX folio lines byte-identical;
   - the old room dirty;
   - the new room assigned.
4. A type change without `roomId` → `room_id_required`. A `roomId` of another type → the existing type mismatch error. A room occupied tonight → the existing vacancy error.
5. A rate plan change keeps posted nights and overridden nights, and re-snapshots the others.
6. Auto-extend and clerk extension:
   - **Order A:** the clerk extends by one night, then night audit with auto-extend on does not extend again. `sold` on that night is +1 in total.
   - **Order B:** auto-extend runs, then the clerk extends a further night. Each night is counted once.
7. An earlier departure → `use_early_depart`. A stay that is not `checked_in` → `not_in_house`.
8. A clerk without `reservations:change_in_house` → 403. A queued replay re-checks the permission.
9. A party change above the type's occupancy → the existing occupancy error. A valid change updates the inclusion units at the next posting.

web-pms:
- The dialog is shown only with the permission.
- The preview text is correct.
- The room select appears on a type change.
- An earlier departure shows the early-depart link.
- The invalidation keys are asserted.

## 5. Pins

- `COMMAND_CATALOG` +1.
- `V1_HTTP_ROUTE_AUDIT` +1, last `post_reservation_in_house_change`.
- `AUDIT_WRITER_COMMAND_IDS` +1.
- The permission is added to `PROPERTY_SCOPED_PERMISSIONS`, with `ROLE_GRANTS.admin` / `staff` updated, and the `me.test.ts` staff mirror updated.
- No migration.
- Update the AGENTS.md pins table and the early-depart spec, with a pointer saying that lengthening lives here.

## 6. Out of scope (client Q16, Q20)

- BluePMS's early-departure penalty options and manager override.
- Correcting a posted night (a folio reversal).
- Extra named guests (F4).
- Changing the arrival date of an in-house stay.
