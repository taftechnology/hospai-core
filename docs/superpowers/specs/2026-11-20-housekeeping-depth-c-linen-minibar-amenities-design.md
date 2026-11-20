# Housekeeping depth, Part C: linen, minibar, amenities (R4.11)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part C of three; completes R4.11)
**Roadmap:** R4.11 Housekeeping depth (Track P). Part A is `5a9f725` and Part B is `560299b`.
**BluePMS page groups:** Housekeeping → *Linen, minibar and folio* and *Amenities* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- **Linen:** an item master; movements for issue, return, laundry, discard and adjustment by date, item, room, attendant and notes.
- **Minibar:** setup with eligible products; pickup with room, guest, item, quantity, price, attendant and status; reconciliation of pickup, stock depletion and folio charge.
- **Amenities:** an amenity master with unit, standard quantity and linked stock item; rule templates; planned and confirmed dispatches, expected against actual with a required exception reason and optional supervisor confirmation; a dispatch ledger.

**Sources:**
- The roadmap R4.11 locks:
  - minibar is **posted straight to the folio through the folio contract**, never inserted directly and never through a POS bill;
  - minibar and amenity stock move against the R1.9 operational list (`housekeeping_inventory_item` / `_movement`); **no stores inventory**;
  - linen extends R1.9 receive, issue and count with a room and an attendant;
  - an amenity posts to the folio only if the client charges for it (Q22). It does not here.
- R4.23: a charge on a checked-out stay needs an active hold (`assertGuestChargeAllowedSync`).
- The products catalogue (`products_item`: charge code and default amount).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Stock model.** PropertyDO migration 55 rebuilds two tables:<br>• `housekeeping_inventory_item` gains the categories `minibar` and `amenities`;<br>• `housekeeping_inventory_movement` allows the kinds `receive \| issue \| count \| return \| laundry_out \| laundry_in \| discard \| adjust \| minibar \| amenity`, and gains `room_id` and `attendant_ref` (both nullable).<br>Rows are copied. On-hand never goes below zero; a movement that would → `422 insufficient_stock` (reuse the R1.9 code if one exists; otherwise this new code). |
| D2 | **Linen movements.** `housekeeping.record_linen_movement` takes:<br>• item (category `linens` or `towels`);<br>• kind (`issue \| return \| laundry_out \| laundry_in \| discard \| adjust`);<br>• quantity (positive integer; `adjust` takes a signed quantity and needs a reason);<br>• optional room and attendant (a roster member of the property);<br>• note (≤ 200; required for `discard` and `adjust`).<br>Effect on on-hand:<br>• **issue**, **laundry_out** and **discard** subtract;<br>• **return** and **laundry_in** add;<br>• **adjust** adds its signed quantity.<br>`get_linen_movements` filters by date range, item, room, attendant and kind. It returns per-item totals, including **in laundry** = Σ out − Σ in (never below 0). |
| D3 | **Minibar setup.** The DOMAIN key `pms.housekeeping.minibar` holds `{ enabled, items: [{ productId, inventoryItemId \| null }] }`, at most 50 items. Each product must be active in the products catalogue. The linked stock item must be in category `minibar`. pms-core reads the key inside the pickup transaction. |
| D4 | **Minibar pickup** (`housekeeping.record_minibar_pickup`), in **one transaction**:<br>• **Input:** room; the stay in that room (`checked_in`, or `checked_out` with an active R4.23 hold, which `assertGuestChargeAllowedSync` enforces); lines `[{ productId, quantity 1–20 }]` (at most 20 lines, capped at HTTP and RPC); attendant (optional); optional `complimentary` with a reason.<br>• **Steps:**<br>  1. the housekeeping module records the pickup and its lines, and writes a `minibar` stock movement for each linked stock item;<br>  2. unless complimentary, **core posts one folio charge per line through the existing taxable charge path that `folio.add_item` uses**. Amount = the product's `default_amount_minor` × quantity (integers; the price is snapshotted on the pickup line). The charge code comes from the product, source `MINIBAR`, on the stay's GUEST window, with tax as `folio.add_item` computes it;<br>  3. each pickup line stores its `folio_line_id`.<br>• **Refusals:** disabled or not configured, or a product not in the setup → `invalid_request`. A closed window → `window_closed`. A checked-out stay with no hold → `checked_out_requires_hold`. Stock short → `insufficient_stock`. Nothing is written on any refusal.<br>• **Status:** `posted` or `complimentary`. Corrections go through the existing folio discount, split and transfer paths; nothing edits a pickup. |
| D5 | **Minibar reconciliation** (`get_minibar_reconciliation`, date range). One row per pickup line: room, stay, product, quantity, price, attendant, status, the stock movement (present or not), and the folio state of its line:<br>• `posted`;<br>• `moved`: transferred, reversed or split away from its GUEST window, read from the line's reversal rows;<br>• `missing`: not complimentary and no line, which should never happen and is flagged.<br>Totals per product. No names; the guest name comes through the property-scoped batch from the stay's `guestRef`. |
| D6 | **Amenities.**<br>• **Master:** `housekeeping_amenity` (name ≤ 80, unit ≤ 20, standard quantity, optional linked stock item in category `amenities`, active), saved with `housekeeping.save_amenity` (`settings:configure`), at most 100.<br>• **Rules:** `housekeeping_amenity_rule` (name, optional room type, when: `arrival \| stayover \| departure`, lines `[{ amenityId, quantity }]` ≤ 30), saved with `housekeeping.save_amenity_rule` (`settings:configure`), at most 30.<br>• **Dispatches:** `housekeeping_amenity_dispatch`:<br>  – `housekeeping.plan_amenity_dispatches` creates **planned** dispatches for a date, a rule and selected rooms (≤ 200, capped at HTTP and RPC), with expected quantities from the rule;<br>  – `housekeeping.confirm_amenity_dispatch` records the actual quantity per line. **When any actual differs from expected, an exception reason is required.** An optional supervisor (a roster member) can be recorded. On confirm, an `amenity` stock movement is written for each line with a linked stock item (the actual quantity), and the dispatch records its stock-posting status (`posted`, or `not_linked` when no line has a stock item).<br>• **Ledger:** `get_amenity_dispatches` (date range, status, room) lists dispatches with expected, actual, exception and stock status.<br>• **Amenities never post to the folio** (Q22 open). |
| D7 | **SPA (Housekeeping):**<br>• **Linen** tab: items with on hand and in laundry; a *Record movement* `Dialog`; the movement list with filters.<br>• **Minibar** tab:<br>  – *Record pickup*: room → the in-house stay (guest name shown), product lines with quantity and line price preview, attendant, complimentary with a reason;<br>  – the pickup list;<br>  – a *Reconciliation* view with the D5 states in words and the totals.<br>• **Amenities** tab:<br>  – planned and confirmed dispatches;<br>  – *Plan from rule* (date, rule, rooms picked from the room list, with the day's arrivals or in-house rooms preselected by the rule's *when*);<br>  – *Confirm* (actual per line, exception reason when different, optional supervisor);<br>  – the ledger.<br>• **Settings → Housekeeping:** minibar setup (enable; pick products and the linked stock item), the amenity master, and amenity rules.<br>• Existing Inventory tab: the new categories show.<br>Words, never codes. Settled Alerts. Three states (error, empty, no match). Business-date defaults. Money is shown with the property's currency formatter. |

## 2. Commands, pins

| Command | Route | Permission |
|---|---|---|
| `housekeeping.record_linen_movement` | `post_linen_movement`: `POST …/housekeeping/linen-movements` | `housekeeping:write` |
| `housekeeping.record_minibar_pickup` | `post_minibar_pickup`: `POST …/housekeeping/minibar-pickups` | `housekeeping:write` |
| `housekeeping.save_amenity` | `post_amenity`: `POST …/housekeeping/amenities` | `settings:configure` |
| `housekeeping.save_amenity_rule` | `post_amenity_rule`: `POST …/housekeeping/amenity-rules` | `settings:configure` |
| `housekeeping.plan_amenity_dispatches` | `post_amenity_dispatch_plan`: `POST …/housekeeping/amenity-dispatches/plan` | `housekeeping:write` |
| `housekeeping.confirm_amenity_dispatch` | `post_amenity_dispatch_confirm`: `POST …/housekeeping/amenity-dispatches/:dispatchId/confirm` | `housekeeping:write` |
| (reads) | `get_linen_movements`, `get_minibar_reconciliation`, `get_amenities` (master and rules), `get_amenity_dispatches` | `housekeeping:read` |

- All six commands are INTERACTIVE, `pms.core`-entitled, idempotent (`x-idempotency-key`, `{ commandId, payload }` per user, sorted arrays hashed and sent) and audit writers.
- The minibar pickup audit row records the folio line ids.
- Pins:
  - `COMMAND_CATALOG` +6 → **147**;
  - `V1_HTTP_ROUTE_AUDIT` +10 → **244**, last id **`get_amenity_dispatches`**;
  - `AUDIT_WRITER_COMMAND_IDS` +6 → **113**;
  - `PROPERTY_SCHEMA_HEAD` **55**;
  - config +1 (`pms.housekeeping.minibar`).
- New tables are owned by `pms.housekeeping`, in the purge inventory and the DDL files. Update the AGENTS.md pins table.

## 3. Tests

pms-core (`apps/pms-core/test/housekeeping-depth-c.spec.ts`):
1. **Linen:** each kind moves on-hand as specified; in laundry = out − in; a discard without a note → `reason_required`; going below zero → `insufficient_stock` and nothing is written.
2. **Minibar pickup:**
   - two lines post two GUEST folio charges with tax, at product price × quantity, and two stock movements;
   - the folio balance rises by the charges plus tax;
   - replay → one pickup and one set of lines;
   - complimentary → no folio line, a stock movement, and a reason required;
   - a checked-out stay without a hold → `checked_out_requires_hold`, nothing written; with a hold it posts;
   - a product not in the setup → `invalid_request`;
   - stock short → nothing posted.
3. **Reconciliation:** a posted line reads `posted`; after `folio.transfer_charge` to a COMPANY window it reads `moved`.
4. **Amenities:**
   - the plan creates planned dispatches with expected quantities;
   - confirm with a difference and no reason → refused; with a reason → confirmed with an `amenity` movement for linked items;
   - unlinked → `not_linked`;
   - no folio line is ever written.
5. **Tenancy:** two properties in one org; hotel A's reads show no hotel B rows.

contracts: pins, the config schema.

do-runtime: migration 55 (copies rows, new kinds and categories).

web-pms and module:
- the linen dialog;
- the pickup dialog's price preview and stay requirement;
- the reconciliation words;
- the amenity plan and confirm, with the exception reason;
- the settings editors;
- cache keys asserted (the pickup also invalidates the folio keys of that stay).

## 4. Out of scope

- Stores, purchase and costing (§16.6 *Integrate/Avoid*).
- A POS outlet or bill for minibar.
- Charging amenities (Q22).
- Attendant mobile capture (R4.10).
- Reports (R4.14).
- Par-based auto-planning beyond the rule pick.
