# Booking wizard remainder — design

**Roadmap:** R1.4 · **Status:** accepted 2026-10-28, shipped · **Date:** 2026-10-28

**Sources:** roadmap R1.4 lock ("do not rebuild the wizard"); [booking wizard](2026-08-11-booking-wizard-design.md); [booking plan picker](2026-08-15-booking-plan-picker-design.md); [products catalog](2026-10-28-products-catalog-design.md) (R1.5); [booking sources and segments](2026-10-28-property-lists-design.md) (R1.6); AGENTS.md (*Hold is `PENDING`*, *no Settings control pms-core does not read*).

## 1. What is already done

The R1.4 lock lists six items. Three are already live and are not rebuilt:

| Lock item | State |
|---|---|
| FAIL_CLOSED disables Hold / Quote / Confirm | **Done** — `bookFailClosed` gates all three with an Alert (test T20). |
| Occupancy exceeded on submit | **Done** — `occupancy_exceeded` copy (test 11). |
| Source / segment optional fields | **Done in R1.6** — Source and Market segment selects on Book. |

This slice covers the other three.

## 2. Decisions locked

### 2.1 Special requests → the existing front-office comment, set at create

- Book gets a **Special requests** textarea (optional, ≤ 2,000 characters — the existing front-office comment limit).
- `reservations.create` accepts an optional `frontOfficeComment` and writes the existing `reservation.front_office_comment` column in the same INSERT. No new column, no second request. It joins the command payload and the fingerprint.
- Over 2,000 characters is the existing `front_office_comment_too_long` error. Blank is treated as absent.
- The client-side booking idempotency id (`bookingReservationOpId`) gains a segment only when a comment is present, as R1.6 did for source and segment, so editing the text after a failed attempt gets a new key.

### 2.2 Booking add-ons → R1.5 products, posted through `folio.add_item` after the booking

- Book gets an **Add-ons** section listing the property's postable products by category (the R1.5 `usePostableProducts` hook). The clerk adds lines: product, quantity (integer 1–99) and unit price (prefilled from the product, editable, two decimals). It shows only when postable products exist.
- After `reservations.create` succeeds with status `pending` (Hold) or `confirmed` (Confirm), the SPA posts **one `folio.add_item` per line** — `chargeCode` from the product, `amountMinor = unitMinor × quantity` (integer multiplication, no rounding). Lines post in order, after the booking, never before it.
- **Not on an Inquiry.** An inquiry is not a booking and does not take `sold`; the Add-ons section is disabled while Inquiry is the chosen action.
- **Idempotent and retryable.** Each line's operation id is `book-addon:${reservationId}:${index}:${productId}:${quantity}:${unitMinor}`, so a retry after a network failure reuses the same key and never double-posts.
- **Partial failure does not undo the booking.** If any line fails, the booking stands: the screen stays on Book, shows an Alert naming the failed lines with the operator copy, offers **Retry add-ons** (same keys) and a link to the folio. When every line has posted, it continues to the usual success navigation. The reservation's own success is not hidden by an add-on failure.
- **One-time charges.** Add-ons post once, on the booking's business date — not per night (that is R3.2 recurring charges and R4.13 package posting rules). Tax is the charge code's, as for any posted line.

### 2.3 Booking settings stay hidden — not consumed in this slice

`pms.booking.same_day_bookings`, `pms.booking.same_day_cutoff`, `pms.booking.require_prepayment` and `pms.booking.booking_date_change` are DOMAIN keys that nothing in pms-core reads today; R0.11 hid them. They stay hidden, and the Settings **Policies** tab stays hidden with them:

- **Same-day bookings and cutoff** govern **online** booking. A front desk always takes a walk-in, so enforcing a cutoff on desk bookings would block the hotel's own staff. Their consumer is the booking engine quote and book path (**R4.2**).
- **Require prepayment** belongs to the guarantee and check-in authorization workflow (**R1.20**).
- **Booking date change** belongs to reservation modify rules; no slice consumes it yet.

R1.6's note that R1.4 "reveals the Policies tab" is withdrawn: the tab is revealed by whichever of R1.20 / R4.2 first wires a key in it.

## 3. Scope out

- New commands, routes or migrations — none.
- Rebuilding the wizard; re-testing adults, promo or guest search.
- Recurring or per-night add-ons (R3.2, R4.13).
- Voiding add-ons when a booking is later cancelled — cancellation leaves posted lines on the folio for the desk to void, as for any charge.

## 4. Feature checklist (AGENTS §6)

- [x] No new route, command, permission or pin; `reservations.create` keeps its lane and payload shape plus one optional field.
- [x] Idempotency: the comment is in the create fingerprint; each add-on has a stable operation id.
- [x] Money: integer minor units; `unitMinor × quantity` only; posting through the unchanged `folio.add_item`.
- [x] Inventory: unchanged — Hold stays `PENDING` (`sold++`), Inquiry takes no `sold`.
- [x] No Settings control pms-core does not read (§2.3).

## 5. Tests

- **pms-core:** create with `frontOfficeComment` → `get_reservation` returns it; over 2,000 → 422 `front_office_comment_too_long`; blank stored as no comment; fingerprint differs with and without the comment.
- **SPA:** Special requests sent on create; Add-ons section hidden without products and disabled for Inquiry; Confirm with two lines posts two `addFolioLine` calls with the right codes and `amountMinor`, after `createReservation`; one line failing shows the Alert, keeps the booking, and Retry reuses the same operation ids; quantity and price validation.
- **client-core:** opId gains a comment segment only when present.
