# Day-wise rate override on a reservation (R4.20)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.20 (Track P). Pilot checklist: *Day-wise rate overrides* in *New reservation*.
**Depends:** R1.4 (Book), R1.15 (stay card), R3.6 (tax per night).
**Sources:**
- [Folio money operations](./2026-08-12-folio-money-operations-design.md) §8.1–8.3: `reservation_rate_night` is **the** nightly snapshot, and night audit posts it ("Hit → use it. Do not consult `rate_day`").
- [Configurable tax engine](./2026-11-18-configurable-tax-engine-design.md) §2: slabs by amount, resolved per line per night.
- [Rate-plan inclusions](./2026-11-19-rate-plan-inclusions-design.md): `reservation_inclusion_night`; INCLUDED values come out of the room night.
- [Promo codes](./2026-08-15-promo-codes-design.md): the promo adjusts the amount at snapshot time.
- The BluePMS Front Office inventory: editable day-by-day room price; show or hide the rate detail while booking.

**Amends:** folio money ops §8.2. A plan-only modify re-snapshots unconsumed nights **except overridden ones** (§4).

---

## 1. Why

The rates matrix sets a plan's price per day for everyone. The desk also needs to change **one booking's** price for chosen nights: a negotiated rate, a goodwill night, a walk-in deal. Today no command or screen can do that, and nothing in the SPA reads `reservation_rate_night`.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | The override **replaces `reservation_rate_night.amount_minor`** for the chosen nights. There is no second price column. One flag column, `is_override`, records that the row was set by hand. The before and after amounts go to `audit_log`. |
| D2 | There is one new command, `reservations.override_night_rate`, with its own permission **`rates:override`**. It is granted to `admin`; `owner` gets it through `GRANTABLE_PERMISSIONS`; `staff` does not have it. A queued or replayed command re-checks it (AGENTS §1). |
| D3 | It is allowed on `pending`, `confirmed` and `checked_in`, and only on **unposted** nights inside the stay. An unposted night is one with no `ROOM` / `NO_SHOW` folio line for that business date, by the same test as `resnapshotRateNightsForPlanChangeSync`. A posted night is corrected through the folio, not here. |
| D4 | Tax needs no new code. `POST_ROOM_CHARGES` already reads `rateNightAmountSync`, so the tax band resolves on the overridden value. In India that can move a night across a GST slab. |
| D5 | The amount is the **final nightly amount**. A promo is not applied on top. The currency is the stay's snapshot currency and cannot be changed. |
| D6 | The amount may not go below that night's INCLUDED inclusion value (`422 override_below_inclusions`). This catches at the desk what night audit would otherwise raise as `inclusion_exceeds_rate`. |
| D7 | **Modify keeps overrides on nights that remain.** A date change already leaves kept nights untouched. A plan-only or plan-plus-date change re-snapshots unconsumed nights, but **skips rows with `is_override = 1`**. Those rows keep their amount, take the new `rate_plan_id`, and have their inclusion nights re-snapshotted for the new plan. |
| D8 | On Book, the override is a **follow-up POST** after Hold or Confirm, like R1.4's add-ons. The booking stands if it fails, and Retry re-sends it. No amounts are added to `reservations.create`. |

## 3. Data model

PropertyDO migration, next head (one after R4.22's):

```sql
ALTER TABLE reservation_rate_night ADD COLUMN is_override INTEGER NOT NULL DEFAULT 0;
```

- A night with no snapshot row yet (the lazy fallback in `rateNightAmountSync`) is inserted by the override.
- The currency of that row is taken from the stay's other snapshot rows. If the stay has none, it is the property's ledger currency.

## 4. Command `reservations.override_night_rate`

- **Catalog entry:** INTERACTIVE, `pms.core`, permission `rates:override`, kill-switch on, idempotent, audit writer (`AUDIT_WRITER_COMMAND_IDS` +1).
- **RPC:** `tryOverrideNightRates(actor, { reservationId, nights: [{ stayDate, amountMinor }], reason }, idem)`.

**Validation.** Each failure leaves nothing changed. Error codes go in the one `commandErrorHttpStatus` table:

| Input | Error |
|---|---|
| more than 90 nights (HTTP and RPC) | `422 limit_exceeded` |
| an empty list | `422 invalid_request` (existing code) |
| a duplicate `stayDate` | `422 invalid_request` |
| `amountMinor` not an integer, or outside 0 … 100_000_000_00 | `422 invalid_amount` |
| reason empty or longer than 200 characters | `422 reason_required` |
| reservation missing | existing `reservation_not_found` |
| status not `pending`, `confirmed` or `checked_in` | `422 rate_override_not_allowed` |
| a night outside `[arrival, departure)` | `422 night_outside_stay` |
| a night already posted (D3) | `422 night_already_posted` |
| D6 | `422 override_below_inclusions` |

**Write.** Inside one `transactionSync`:
1. For each night, upsert the row with `amount_minor = amountMinor`, `is_override = 1`, the current `rate_plan_id` and the currency from §3.
2. Append one `audit_log` row: `entityType: 'reservation'`, before and after as `[{stayDate, amountMinor}]` sorted by date, and the reason in `afterJson`.

**Rules:**
- The command touches nothing on `availability_day` and emits no event: the price is not ARI.
- **Idempotency:** the handler sorts `nights` by `stayDate`. The fingerprint is `{commandId, payload: {reservationId, nights, reason}}` over that sorted object, **and that same sorted object is sent to the DO**. The key is per user.
- **Clearing an override:** submitting the plan's current `rate_day` amount sets the amount but keeps `is_override = 1`. A "reset to plan rate" is out of scope; the clerk enters the amount they want.

## 5. HTTP

There are two new routes. `V1_HTTP_ROUTE_AUDIT` +2; the last id is `post_reservation_rate_override`. Both routes call `resolvePropertyContext` and go through `dispatchV1`.

| Route id | Method + path | Permission | Body / response |
|---|---|---|---|
| `get_reservation_rate_nights` | `GET /v1/properties/:propertyId/reservations/:reservationId/rate-nights` | `reservations:read` | `{ currency, nights: [{ stayDate, amountMinor, ratePlanId, isOverride, posted }] }` for every night of the stay. A night with no row shows the `rate_day` amount, or `null` when there is none. The route is read-only: **it does not lazily insert.** |
| `post_reservation_rate_override` | `POST …/reservations/:reservationId/rate-override` | `rates:override` | JSON `{ nights, reason }`, with the idempotency key in the same place `post_reservation_modify` uses (check it and match it). It returns the same shape as the GET. |

## 6. Operator SPA

These parts use the ui-kit only, `classifiedUserMessage`, and `Alert` for results.

- **A shared component, `NightlyRatesEditor`:**
  - A `DataTable` of date, amount, plan and status (`Posted` badge / `Overridden` badge).
  - Unposted rows have an amount `Input`, in major units converted to integer minor units through the existing money helpers. Never use float arithmetic on money.
  - One **Reason** field, and **Save**.
  - The editing controls show only when `me` has `rates:override`. Without it the table is read-only.
- **Book:**
  - The quote area gets a **Show nightly rates** toggle (the BluePMS show/hide). It is local UI state, collapsed by default.
  - Expanded, it lists each night with the client-side quote amount already computed. An editable amount appears only with `rates:override`, and a reason is required once any amount differs.
  - The quote total reflects the edits.
  - After a successful Hold or Confirm, if any night was edited, it POSTs `rate-override`.
  - On failure it shows an `Alert` ("Booking saved; the nightly rates were not applied") with **Retry**. Retry re-sends the same body and the same idempotency key.
- **Stay card** (`ReservationStayScreen`): a **Nightly rates** section uses `NightlyRatesEditor` over `get_reservation_rate_nights`.
- **Check-in** (`CheckInScreen`): the same section, collapsed. The override can be made at check-in while the night is unposted.
- **Cache key:** `['reservation-rate-nights', propertyId, reservationId]`.
  - An override invalidates that key and the stay's reservation query.
  - A modify on the stay card also invalidates it.
  - Tests assert the consumer keys.

## 7. Tests (pms-core)

1. **An override across a slab boundary:**
   - a tax rule set with a slab at ₹7,500 (inclusive bound per R3.6);
   - the stay's nights are at ₹7,000, and one night is overridden to ₹8,000;
   - after `POST_ROOM_CHARGES` that night's tax line uses the higher slab's rate, and the other nights' lines do not change.
2. **Permission:** a `staff` user → 403 (`rates:override`). An `admin` user is accepted. A replayed queued command from a user who lost the permission is refused.
3. **Posted and outside nights:** overriding an already-posted night → `night_already_posted`, and nothing changes. A date outside the stay → `night_outside_stay`.
4. **Modify keeps overrides:**
   - **dates extended:** the overridden night keeps its amount, and a new night takes `rate_day`;
   - **plan-only change:** the overridden night keeps its amount with the new `rate_plan_id`, a non-overridden unposted night re-prices, and a posted night does not change;
   - **date shrink** that removes the overridden night: its row is deleted (it is unconsumed).
5. **Inclusions:** a night with an INCLUDED breakfast worth ₹500, overridden to ₹400 → `override_below_inclusions`.
6. **Idempotency:**
   - the same key with nights in a different order → a replay (sorted equal);
   - the same key with a different amount → a conflict;
   - the object hashed equals the object the DO received.
7. **Audit:** one `audit_log` row with before, after and the reason.
8. **Caps:** 91 nights → `limit_exceeded` at HTTP and at the RPC.
9. **Promo:** a stay booked with a promo, then overridden → the night posts exactly the override.

web-pms:
- the editor is hidden without the permission;
- Book posts the override after confirm, and Retry is shown on failure;
- money is converted as integer minor units;
- the cache keys are asserted.

## 8. Pins and docs

- `COMMAND_CATALOG` +1.
- `V1_HTTP_ROUTE_AUDIT` +2, last id `post_reservation_rate_override`.
- `PROPERTY_SCHEMA_HEAD` +1.
- `AUDIT_WRITER_COMMAND_IDS` +1.
- `PROPERTY_SCOPED_PERMISSIONS` +1 (`rates:override`), with `ROLE_GRANTS.admin` updated.
- Update the AGENTS.md pins table and the folio money ops spec §8.2 (D7).

## 9. Out of scope

- Plan and package day rows (they join with R4.13).
- Correcting a posted night (folio reversal).
- Overriding inclusion amounts.
- A rate-override approval workflow or threshold.
- A "reset to plan rate" action.
- Overrides on inquiries (no snapshot).
