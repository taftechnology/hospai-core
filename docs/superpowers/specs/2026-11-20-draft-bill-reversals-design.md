# Draft bill, splits and reversals (R4.29)

**Date:** 2026-11-20
**Status:** Accepted for implementation (everything except line transfer to another room, which stays under fork F1)
**Roadmap:** R4.29 (Track P). Pilot checklist: *Front-office billing and open folio*.
**BluePMS page groups:** Front Office → *Billing and cashiering* and *Reversals and audit controls* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- a draft bill from the checked-in folio, charge review, and a tariff check across posted, unposted and future nights;
- equal, source-based and custom splits;
- high-privilege cancellation of a bill and of a settlement, each with a required reason;
- cancelling a settlement returns the bill to pending or open folio, reopens the stay when there is no room conflict, and reactivates a settled hold.

**Sources:**
- The roadmap R4.29 locks and fork F1.
- R4.13 proforma: `readReservationProformaSync` and `buildNightChargeLines`.
- R4.23 open folio: `folio_hold` and `folio_hold_event`.
- Existing commands:
  - `folio.split_charge`: absolute amounts, at most 20 parts (`FOLIO_SPLIT_MAX`), parts must foot exactly, tax re-split with `allocate`;
  - `folio.transfer_charge`: one line per call, same stay, tax copied whole, a line moves once;
  - `invoice.generate` / `invoice.void`: void sets `voided_at`, and regenerating takes a new number;
  - `folio.refund`: cash and UPI are recorded locally, card goes through the PSP;
  - `folio.void`: authorized card holds only;
  - `folio.reopen_window`.
- `tryCheckOut`: keeps `room_id`, marks the room dirty, and writes no `availability_day`.
- `assertRoomAssignableSync` and `assertRoomVacantNowSync`.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Draft bill is a read.** A new route, `get_reservation_draft_bill`, works for `checked_in` and `checked_out` stays. It changes nothing, takes no invoice number and writes no audit row. The existing `invoice.generate` makes the bill final. Corrections go through the existing posting, discount, split, transfer and reversal paths; nothing edits a line (append-only). |
| D2 | **What the draft shows:**<br>• **Charge review:** every non-payment parent line on the stay's windows, grouped by window and then by charge code. Each group has its display label, line count, base, tax and total.<br>• **Tariff check:** one row per stay night with its state:<br>  – `posted`: `nightConsumedSync` is true;<br>  – `unposted`: the night is before the business date and not consumed;<br>  – `future`: on or after the business date and not consumed.<br>  Each row has the expected room amount (`rateNightAmountSync(…, { persist: false })`), the posted net ROOM amount for that business date across all of the stay's windows (tax excluded, transfers net out), and `mismatch: true` when posted ≠ expected on a posted night.<br>• **Totals:** posted charges, the estimate for future nights (the R4.13 builder, same skip rule for existing line ids), advance paid (the net payment ledger on the GUEST window, as the proforma computes it), the balance now, and the projected balance.<br>• **Invoice state:** the active invoice's number and date, or null.<br>• **Header:** the guest header the proforma uses.<br>There is no second money calculation: it reuses the proforma's helpers. |
| D3 | **Splits build on the existing contracts.**<br>• **Custom:** the existing two-part split dialog grows to N parts (2–20, the existing cap), each with an amount and a target window.<br>• **Equal:** the clerk picks N (2–20) and a target window per part. The SPA computes the parts with `allocate` from `@hospai/money` (last-unit remainder) and sends them through `folio.split_charge`. The server's existing footing check is the guard.<br>• **Source-based:** a new command `folio.transfer_charges` moves a selected set of lines (chosen by charge code or by source group: room nights, inclusions, scheduled add-ons, manual charges) from one window to another window of the same stay, **all or nothing** in one transaction. It reuses `transferFolioLineSync` for each line, so tax copies and the move-once rule hold. The cap is **50** lines (`FOLIO_TRANSFER_BULK_MAX`), enforced at HTTP and RPC (`limit_exceeded`). The handler sorts the line ids, and the sorted array is what it fingerprints and sends. A cross-reservation destination still returns `transfer_cross_reservation` (F1). |
| D4 | **New permission `folio:reverse`.** It is high-privilege: granted to `admin`, and `owner` gets it through `GRANTABLE_PERMISSIONS`; `staff` does not have it. It guards:<br>• `invoice.void`, which moves from `folio:adjust` to `folio:reverse`. Its reason becomes **required** (1–500). The SPA's void control asks for it and refuses to send without it.<br>• the new `reservations.undo_check_out` (D6).<br>`folio.refund` and `folio.void` keep their existing permissions and contracts. |
| D5 | **Void a pending bill, then regenerate.** This is the existing `invoice.void` (D4 rules) followed by the existing `invoice.generate`, which takes a new number; the voided number is never reused. Voiding penalty rows is out (§5): there is no void command for a penalty line, and the desk offsets one with `folio.post_discount`. **IRN guard:** when R5.5 adds the acknowledged-IRN state, `invoice.void` refuses a bill with an acknowledged IRN. Until then there is no IRN state, and nothing is added for it here. |
| D6 | **Undo checkout** (`reservations.undo_check_out`, route `post_reservation_undo_check_out`: `POST /v1/properties/:propertyId/reservations/:reservationId/undo-check-out`, body `{ reason }`, header `x-idempotency-key` as for check-out). In one `transactionSync`, all of these must hold:<br>• the stay is `checked_out` and `checked_out_business_date` = the current business date. Otherwise → `422 check_out_not_today`, a new code: a stay that left on an earlier date is not reopened.<br>• no active invoice on its GUEST window. Otherwise → `invoice_already_exists`: void the bill first (D5).<br>• the room is still free: `assertRoomVacantNowSync` and `assertRoomAssignableSync` over [business date, departure date), with their existing error codes. Otherwise nothing changes.<br>Then:<br>• status → `checked_in`, and `checked_out_business_date` is cleared;<br>• a CLOSED GUEST window reopens through the `folio.reopen_window` writer;<br>• D7 applies to the hold;<br>• audit row with the reason;<br>• `reservation.status_changed` is emitted.<br>No `availability_day` write: checkout did not release sold nights, and nights an early departure released stay released. The room's housekeeping status is left as it is. |
| D7 | **A settled hold returns to active.** When a GUEST window reopens (through `folio.reopen_window` or D6), and the latest hold on that window is `CLOSED` with `ended_reason = 'window_closed'`, the hold becomes `ACTIVE` again with a `reactivated` hold event. Its dates, reason and approver are unchanged. A `RELEASED` hold is never reactivated. PropertyDO migration 51 rebuilds `folio_hold_event` so its kind check allows `reactivated`, copying rows. |
| D8 | **Cancel settlement** is an SPA flow on a folio, shown to users with `folio:reverse`. It is not one server command, because card refunds go through the PSP and cannot sit inside one transaction. The flow:<br>1. A required reason.<br>2. Void the active invoice, if any (D5).<br>3. Refund the selected captured payments through the existing `folio.refund`. All captured cash and UPI payments are preselected, each for its remaining amount; card payments are selectable.<br>4. Optionally undo the checkout (D6), offered only when the stay checked out today.<br>Each step is a separate call with its own operation id (`settlement-cancel:{reservationId}:{step}:{uuid}`), posted in order. A failed step shows its `classifiedUserMessage` and stops the flow. **Retry** resumes from the failed step with the same keys, and steps that succeeded never post again (the R1.4 / R4.25 pattern). The reason is sent with the invoice void and the undo checkout. Refunds keep their existing contract. |

## 2. Commands, routes, errors

| Command | Route | Permission | Lane |
|---|---|---|---|
| `folio.transfer_charges` | `post_folio_transfer_bulk`: `POST /v1/properties/:propertyId/folio/transfer` with body `{ folioLineIds[], destinationFolioWindowId }` | `folio:adjust` | INTERACTIVE |
| `reservations.undo_check_out` | `post_reservation_undo_check_out` (D6) | `folio:reverse` | INTERACTIVE |
| (read) | `get_reservation_draft_bill`: `GET /v1/properties/:propertyId/reservations/:reservationId/draft-bill` | `folio:read` | — |

- Both commands are `pms.core`, kill-switch on, idempotent (`{ commandId, payload }`, per user) and audit writers.
- `folio.transfer_charges` takes its key the way `post_folio_transfer` does.
- New error `check_out_not_today` → 422 in the one status table.
- `invoice.void` now returns `forbidden` to a user without `folio:reverse`.

## 3. SPA

- **Folio → Draft bill:** a *Draft bill* button opens a read-only view: charge review, tariff check (posted / unposted / future with a mismatch Badge; words shown, never raw state codes), totals and invoice state. Print uses the R4.13 document print view, headed "Draft — not a tax invoice". FAIL_CLOSED → Alert, no numbers.
- **Split dialog:** *Custom* (N rows of amount + window) and *Equal* (N and per-part window; the parts preview before posting).
- **Move charges:** select lines by charge code or source group, see the total, pick the destination window, post through `folio.transfer_charges`.
- **Void bill:** the reason is required; the control is shown only with `folio:reverse`.
- **Cancel settlement:** the D8 flow, with `intent=destructive` and a confirm. A stay that checked out today offers *Also reopen the stay*. Success copy: "Settlement cancelled." plus "Stay reopened." when D6 ran.
- **Cache:**
  - the draft key is `['draft-bill', propertyId, reservationId]`;
  - each mutation invalidates the folio, payments, proforma, draft, folio-hold, open-folios and reservation keys, and `['board']` and the tape key after an undo checkout.
  - Tests assert the keys.

## 4. Tests

pms-core (`apps/pms-core/test/draft-bill-reversals.spec.ts`):
1. **Draft changes nothing:** the folio, invoice counter and audit log are byte-equal before and after. Tariff rows show posted, unposted and future states; a posted night with a changed rate shows `mismatch`.
2. **Bulk transfer:**
   - moves N lines and their tax all or nothing; one non-transferable line fails the whole call with nothing written;
   - over 50 → 422 `limit_exceeded` at HTTP and at RPC;
   - a cross-reservation destination → `transfer_cross_reservation`;
   - replay → one move.
3. **Equal split footing:** a line of 1000 split 3 ways through `folio.split_charge` with `allocate` parts foots to the minor unit, and its tax re-splits.
4. **Invoice void:**
   - without `folio:reverse` → 403;
   - without a reason → 400/422 as today's validation does;
   - with both → void, and regenerate takes a new number.
5. **Undo checkout:**
   - same-day checkout reopens to `checked_in` and reopens a closed window;
   - an active invoice → `invoice_already_exists`;
   - an earlier-day checkout → `check_out_not_today`;
   - the room checked in to another stay → the existing room error, nothing changes;
   - replay → one transition;
   - without `folio:reverse` → 403;
   - `availability_day` unchanged.
6. **Settlement cancel (D8 sequence through HTTP):** a cash refund posts once on replay with the same key, and the balance returns.
7. **Hold reactivation:** a hold closed at zero → refund → window reopen → the hold is ACTIVE with a `reactivated` event; a RELEASED hold stays released.
8. **F1:** `folio.transfer_charge` and `folio.transfer_charges` to another reservation → `transfer_cross_reservation`.

contracts: catalog, routes, audit writers, permission grants (`me.test.ts` mirror), and the new limit.

do-runtime: migration 51 keeps `folio_hold_event` rows and accepts `reactivated`.

web-pms:
- the draft view renders words, not codes;
- equal split posts `allocate` parts;
- bulk move;
- void needs a reason and is hidden without `folio:reverse`;
- the settlement-cancel flow retries only failed steps;
- undo checkout is offered only on the checkout day;
- the cache keys.

## 5. Pins

- `COMMAND_CATALOG` +2 → **127**.
- `V1_HTTP_ROUTE_AUDIT` +3 → **207**, last id **`get_reservation_draft_bill`**.
- `AUDIT_WRITER_COMMAND_IDS` +2 → **93**.
- `PROPERTY_SCHEMA_HEAD` **51**.
- Permission `folio:reverse` added; `invoice.void` moves to it.
- Update the AGENTS.md pins table in the same commit.

## 6. Out of scope

- **Line transfer to another room:** fork F1, client Q17.
- **Voiding penalty rows:** no penalty void command exists; the desk uses a discount.
- **Group master bill:** R4.1.
- **Controlled negative adjustments with an approval threshold, and facility charge bills:** client Q16.
- **Email and PDF files:** printing is browser print.
- **Credit notes:** a GST credit note waits on the tax advisor and R5.5.
- **Undoing a checkout from an earlier business date.**
