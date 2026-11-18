# Recurring charges on a stay — design

**Slice:** roadmap R3.2. **Date:** 2026-11-18. **Status:** accepted for build.

Closes named leftover 1 of the [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) and [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) §8.1: a per-stay schedule that posts a product to the guest folio every night of a date range, inside the existing `POST_ROOM_CHARGES` step. This is the engine **R4.13** builds package posting rules and add-on scheduling on (BluePMS "add-on scheduling" and "package posting rules", [module inventory](../../research/2026-09-12-bluepms-modules.md)).

## 1. Decisions (locked)

1. **One pattern now: every night of a range.** A schedule posts once per audited night `d` with `startDate ≤ d ≤ endDate` (or through the stay's last night when `endDate` is null). Arrival-only, departure-only, weekends, a set night and chosen dates are **R4.13**; they add values to a `pattern` column, not a second table. The column exists now with the single value `NIGHTLY`.

2. **A schedule is a product on a stay.** Create takes `productId`; the DO reads the product inside the transaction and **snapshots** its `chargeCode`, `name` and `amountMinor` (unit price) onto the schedule. Later product price or name edits do not change existing schedules. `quantity` 1–99; the nightly amount is `unitAmountMinor × quantity`, integer minor units. Only a **postable** product (active, active category, operator-postable charge code — R1.5) can be scheduled. Amounts are in the ledger currency (products have no other currency).

3. **Storage — PropertyDO migration 41.** Table `recurring_charge`:

   | Column | Notes |
   |---|---|
   | `recurring_charge_id` TEXT PK | client-chosen id (`validateTenantId` shape); first writer wins |
   | `reservation_id` TEXT NOT NULL | |
   | `pattern` TEXT NOT NULL | CHECK `IN ('NIGHTLY')` |
   | `product_id`, `charge_code`, `description` TEXT NOT NULL | snapshot |
   | `unit_amount_minor` INTEGER NOT NULL, `quantity` INTEGER NOT NULL | CHECK `> 0`, CHECK `BETWEEN 1 AND 99` |
   | `start_date` TEXT NOT NULL, `end_date` TEXT NULL | stay nights, inclusive; null = through departure − 1 |
   | `status` TEXT NOT NULL | `active` \| `cancelled` |
   | `created_at`, `created_by`, `cancelled_at`, `cancelled_by` | audit fields |

   Index on `(reservation_id)` and `(status, start_date)`. Purge: no PII (no guest names), so no purge change; the table is listed wherever the property schema inventory requires.

4. **Create rules.** Reservation status `confirmed` or `checked_in` (else `409 reservation_not_active`). `startDate ≥ max(arrivalDate, business date)`; `startDate ≤ departureDate − 1`; `endDate`, when given, `≥ startDate` and `≤ departureDate − 1` (else `422 recurring_charge_dates_invalid`). At most **20 active schedules** per reservation (`422 limit_exceeded`). Product missing → `404 product_not_found`; not postable → `422 product_not_postable`.

5. **Cancel.** Sets `status = 'cancelled'`; nights already posted stay posted (the clerk voids lines through the normal folio path). Cancelling a cancelled schedule returns the stored state (idempotent by state), not an error. No edit command: change = cancel + create.

6. **Posting — inside `POST_ROOM_CHARGES`, same transaction, no 9th step.** `NIGHT_AUDIT_STEPS` is unchanged (length 8). After the room-charge loop, for every `active` schedule whose reservation is in the **same population as room charges** (same status predicate incl. `auto_no_show`, `no_post = 0`, `arrival_date ≤ d < departure_date`) and whose range covers `d`:
   - folio line id `${reservationId}:recurring:${recurringChargeId}:${d}` (deterministic — a rerun of a failed step cannot double-post);
   - guest window, `source = 'RECURRING'`, `businessDate = d`, charge code and amount from the snapshot, tax via `stampTaxForChargeSync` at `d` — the same path as the room line. Not `NIGHT_AUDIT`: `folio_line_audit_uniq` allows one `NIGHT_AUDIT` line per stay, night and charge code (the room night), and two schedules may share a charge code (breakfast and dinner on one F&B code). The deterministic line id already posts each schedule once a night.
   - **`no_post` honoured** by the reservation predicate. A stay shortened below the range simply stops posting (the reservation predicate); an extended stay keeps posting only when `endDate` is null.
   - **Per-row catch:** a schedule whose charge code is now missing or inactive does not abort the property. It is recorded like a missing rate (audit log, `step: 'POST_ROOM_CHARGES'`, `reason: 'recurring_charge_code_inactive'`, `recurringChargeId`) and counted in the step's failed count; the loop continues.

7. **Commands and routes** (pins: catalog 105 → **107**, routes 170 → **173**, `PROPERTY_SCHEMA_HEAD` 40 → **41**):

   | Route id | Method + path | Permission | Command |
   |---|---|---|---|
   | `get_reservation_recurring_charges` | `GET /v1/properties/:pid/reservations/:rid/recurring-charges` | `folio:read` | — (`degradedRead: FAIL_CLOSED`, entitlement `pms.core`) |
   | `post_reservation_recurring_charges` | `POST …/recurring-charges` | `folio:post` | `folio.schedule_recurring_charge` (INTERACTIVE) |
   | `post_reservation_recurring_charge_cancel` | `POST …/recurring-charges/:id/cancel` | `folio:post` | `folio.cancel_recurring_charge` (INTERACTIVE) |

   Idempotency key in **JSON** `idempotencyKey`, same as `post_folio_lines`. Fingerprint `{ commandId, payload }` with the exact object sent to the DO; key per user. Entitlement `pms.core`, so the kill-switch applies. Degraded class FAIL_CLOSED for both writes. Body ids: only `recurringChargeId` and `productId` — no `propertyId`/`orgId` in the body. The HTTP handler calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` and parses JSON with the shared helper.

8. **SPA — Folio screen, "Recurring charges" card.** Table: Product, Per night (amount × quantity, with the unit), Nights (`from – to` or `from – departure`), Status (word, not colour). Add form: product `NativeSelect` (postable products only), quantity, from date (default `max(arrival, business date)`), "Until" date or "Until departure" (default). Cancel uses `intent=destructive` and confirms. Errors via `classifiedUserMessage`; success `Alert`. Mutations invalidate `['recurring-charges', propertyId, reservationId]` (the consumer key) and the folio key. Shown only with `folio:read`; Add/Cancel only with `folio:post`. Hidden on cancelled / checked-out / no-show stays except as a read-only list.

## 2. Out of scope

Other patterns (R4.13), packages and rate-plan inclusions (R3.3, R4.13), per-person pricing, posting to a non-guest window, foreign-currency products, editing a schedule in place, posting on the departure day.

## 3. Tests (acceptance)

- Create → GET lists it with the snapshot; a later product price edit leaves the schedule's amount unchanged.
- Night audit over three nights posts one line per night at `unit × quantity`, plus its tax line when the charge code has a tax group with a rule; rerunning a failed step posts nothing twice.
- `endDate` mid-stay stops posting after it; `endDate` null keeps posting through the last night after an extend; a shortened stay stops at its new departure.
- `no_post` stay: no recurring lines. Auto no-show off and stay still `confirmed`: no line (same as room).
- Charge code archived after scheduling: that schedule is an exception for the night, the room line and other schedules still post, the step completes.
- Cancel: no further lines; earlier lines stay.
- Validation: past start date, end before start, end on/after departure, 21st active schedule, archived product, cancelled reservation — each with its code; replay with the same key returns the stored result; same key + different body → `409 idempotency_key_reused`.
- Authz: `folio:read` without `folio:post` can GET but not POST (403); another property's reservation id in the URL → 404 with no foreign fields.
- SPA: card renders, add sends the exact body and invalidates the consumer key, cancel confirms first.
