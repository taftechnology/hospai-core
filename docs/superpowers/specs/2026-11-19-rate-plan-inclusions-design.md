# Rate-plan inclusions — design

**Slice:** roadmap R3.3. **Date:** 2026-11-19. **Status:** accepted for build.

A rate plan can include products such as breakfast or dinner (a meal plan: CP, MAP, AP). The inclusions follow the booking: they are copied onto each night of the stay, and night audit posts them inside the existing `POST_ROOM_CHARGES` step. This is the second engine **R4.13** builds packages on, after R3.2 recurring charges. It also closes the two tax options the [tax engine spec](./2026-11-18-configurable-tax-engine-design.md) §2.8 left to this slice.

The user's rule from R3.6 holds: **every option is the hotel's, set in Settings**. No country's meal-plan rule is written in code.

## 1. What the hotel sets on a plan

Settings → Rates → Plans, in the plan editor, under *What's included*:

| Option | Values | Meaning |
|---|---|---|
| Inclusion rows (up to **8**) | a product, an amount, a basis, a price mode | e.g. Breakfast · ₹350 · per adult · included in the rate |
| Basis (per row) | `PER_ROOM` \| `PER_ADULT` \| `PER_GUEST` | how many units post each night: 1, the stay's adults, or adults + children |
| Price mode (per row) | `INCLUDED` \| `ADDED` | **Included in the rate**: the night's rate already covers it, and the inclusion's value is split out of the room line. **Added on top**: the guest pays it in addition to the rate. |
| Tax on inclusions (per plan) | `SEPARATE` \| `ROOM` | **Each at its own tax**: every inclusion line is taxed by its own product group's rules (line by line). **At the room's tax**: the inclusions are taxed by the room group's rules, as one bundle with the room (composite supply). |
| Count toward the room's tax band (per plan) | yes \| no | When yes, the band on a slab rule is chosen on the room plus the inclusions for that night, not the room alone. Always yes, and not editable, when tax is `ROOM`. |

The product is picked from the products catalog (R1.5). When a row is saved, the DO **snapshots** the product's `chargeCode` and `name` onto it. The amount defaults to the product's price and the hotel can change it. Only a **postable** product can be chosen (active, in an active category, on an operator-postable charge code), the same test R3.2 uses. Amounts are integer minor units in the ledger currency, and must be `> 0`.

A derived plan (R1.x derived rate plans) has its **own** inclusions; it does not inherit its parent's. The parent's rate derivation is unchanged. An inclusion's amount is fixed and is not scaled by `derive_bps`.

## 2. Storage — PropertyDO migration 43

- `rate_plan` gains `inclusion_tax TEXT NOT NULL DEFAULT 'SEPARATE' CHECK (IN ('SEPARATE','ROOM'))` and `inclusion_band_join INTEGER NOT NULL DEFAULT 0 CHECK (IN (0,1))`.
- `rate_plan_inclusion`:
  - columns `(rate_plan_id, inclusion_no 1..8, product_id, charge_code, label, amount_minor > 0, basis, price_mode)`;
  - primary key `(rate_plan_id, inclusion_no)`;
  - written in full on plan create or update, replacing the plan's rows.
- `reservation_inclusion_night`:
  - columns `(reservation_id, stay_date, inclusion_no, product_id, charge_code, label, amount_minor, basis, price_mode, inclusion_tax, band_join)`;
  - primary key `(reservation_id, stay_date, inclusion_no)`;
  - it is the per-night snapshot.
- `folio_line` gains `tax_band_base_minor INTEGER NULL`. It records the band base that was used when it differed from the line's own net, so a later discount re-bands on the same base (§4).
- None of these hold PII, so purge does not change. Any property-schema inventory that lists tables lists them.

**The snapshot follows the rate snapshot.**
- Wherever `reservation_rate_night` is written for a night (`snapshotRateNightsSync`: create, modify, extend, plan change), the plan's inclusions for that night are written beside it.
- Wherever a `reservation_rate_night` row is deleted for a night, its inclusion rows are deleted too.
- A night whose room line has posted keeps its snapshot, the same rule the rate snapshot already follows.
- Later edits to the plan do not change booked nights.
- **Quantity is not snapshotted.** It is read at posting from the stay's `adults` / `children`, so a change in party size is honoured.

## 3. Posting — inside `POST_ROOM_CHARGES`, no 9th step

For each reservation in the room-charge population on night `d`, everything below runs in the same per-reservation `try`:

1. `rate = rateNightAmountSync(...)` (unchanged).
2. Read the night's inclusion rows. For each row, `units` is 1, `adults`, or `adults + children`, and `value = amount_minor × units`. When the units are zero (for example per adult with 0 adults), the row posts nothing.
3. Work out the room amount: `roomAmount = rate − Σ value(INCLUDED)`. If `roomAmount < 0`, the reservation is recorded as a night-audit exception with `reason: 'inclusion_exceeds_rate'`, counted as failed, and nothing posts for it that night. The rest of the property continues.
4. Choose the band base, only when `band_join` is set or `inclusion_tax = 'ROOM'`:
   - first resolve the room line and each inclusion line alone, without an override, and take each line's own net;
   - `bandBase` is the sum of those nets;
   - every line in the bundle then resolves with `bandBaseMinor = bandBase`.
   - The first pass is a pure `resolveTaxes` call and writes nothing.
5. Post the lines:
   - **The room line** keeps its existing id `${reservationId}:room:${d}`, posts `roomAmount`, and is taxed by the ROOM group's rules (with the band base when step 4 applies).
   - **Each inclusion line** posts with:
     - id `${reservationId}:inclusion:${inclusionNo}:${d}`;
     - its own charge code;
     - `source = 'INCLUSION'` (not `NIGHT_AUDIT`: `folio_line_audit_uniq` allows one NIGHT_AUDIT line per stay, night and code);
     - `businessDate = d`;
     - the guest window.
   - **An inclusion line's tax** depends on the plan:
     - `SEPARATE`: its own charge code's group rules;
     - `ROOM`: the room group's rules.
     - Either way the band base from step 4 applies when step 4 ran.
   - An inclusion line whose id already exists is skipped, so a rerun cannot double-post.
6. Inactive codes:
   - **An inclusion whose charge code is missing or inactive** is recorded as an exception with `reason: 'inclusion_charge_code_inactive'` and counted as failed. Nothing posts for that reservation that night, so the room is never posted short of an inclusion the rate included.
   - **The `ROOM` code being inactive** stays a whole-step precondition, as today.

**What does not change.** No-show, cancel and desk penalties still post the full nightly rate as `ROOM` / `NO_SHOW`, and post no inclusion lines. The quoted penalty is the rate, and the guest consumed nothing.

**Mixed tax modes.** The room's rules and an inclusion's rules can be in different modes: for example, the room's tax included in the price and the meal's tax added on top. Each line follows its own rules. This is the hotel's configuration, and the Settings hint says so.

## 4. Discounts

`discountTaxForSourceSync` already re-resolves on the source line's stamped rules. When the source line has `tax_band_base_minor`, the remaining band base is `stored − (prior discounts + this discount)`, and it is passed as `bandBaseMinor` to the re-resolve. `discountTaxLines` (tax-model) takes an optional `bandBaseMinor` for this.

A discount on one line of a bundle re-bands only that line. The other lines keep the tax they were posted with. This is the same rule as a discount on any line, and it is recorded here so nobody reads it as a bug.

## 5. Quote and booking

- `quoteStay` adds the **ADDED** inclusions for each night, at the request's adults and children, to `totalMinor`, and returns `inclusionsMinor` alongside. INCLUDED inclusions change nothing, because the rate already covers them. Tax is not part of the quote, as today.
- Book shows a one-line *Includes* text under the plan picker, for example "Includes: Breakfast (per adult, in the rate) · Dinner (per adult, ₹600 added)". The quote line shows the added amount when it is above zero. Both use the plans already loaded on `['rate-plans', propertyId]`.
- `listRatePlans` returns `inclusions`, `inclusionTax` and `inclusionBandJoin`.

## 6. Commands, routes, pins

- **No new command or route.** `rates.create_plan` and `rates.update_plan` widen their payloads with `inclusions` (array, cap **8** at HTTP and in the `try*`, over the cap → `422 limit_exceeded`), `inclusionTax` and `inclusionBandJoin`. The fingerprint is `{ commandId, payload }` and includes the new fields when they are sent.
- **Update without `inclusions`** leaves the rows as they are. `inclusions: []` clears them.
- **Validation codes:**
  - `product_not_found` (404) and `product_not_postable` (422), the same codes as R3.2;
  - `validation_error` (422) for a bad basis, mode, amount or duplicate number.
- **Pins:**
  - `PROPERTY_SCHEMA_HEAD` 42 → **43**;
  - catalog stays 109;
  - routes stay 176, last `put_tax_rule_end`;
  - `NIGHT_AUDIT_STEPS` stays 8.

## 7. Tests

- **Night audit, INCLUDED:** a ₹5,000 rate with breakfast ₹350 per adult and 2 adults posts a room line of ₹4,300 and an inclusion line of ₹700, each with its own tax; the parents sum to the rate.
- **Night audit, ADDED:** the room line posts the full rate plus the inclusion line.
- **Band join:**
  - with the band set at ₹7,500, a room at ₹7,400 plus a ₹350 breakfast joined is taxed at the upper band;
  - the same booking with join off stays in the lower band.
- **Tax at the room's rule:** the inclusion line carries the ROOM rules' components, not F&B's.
- **Exceptions:**
  - inclusions above the rate → `inclusion_exceeds_rate`, another stay still posts;
  - an inactive inclusion code → `inclusion_charge_code_inactive`, nothing posts for that stay.
- **Rerun:** a rerun of the step posts nothing twice.
- **Snapshot:**
  - a plan edit after booking does not change the booked nights;
  - a plan change on modify replaces the unposted nights' inclusions;
  - an extension snapshots the new nights;
  - a party-size change changes the units.
- **Quote:** ADDED adds to `totalMinor` and `inclusionsMinor`; INCLUDED does not.
- **Discount:** a discount on a joined room line re-bands using the stored band base.
- **HTTP and caps:**
  - 9 inclusions → 422;
  - a product that cannot be posted → 422;
  - update without `inclusions` keeps the rows.
- **SPA:**
  - the plan editor sends inclusions with the plan options;
  - the band-join control is locked on when tax is at the room's rule;
  - Book shows the *Includes* line and the added amount.

## 8. Out of scope

- Package templates (fixed price over N nights), posting on arrival or departure only, and add-on scheduling are **R4.13**.
- Per-child amounts that differ from adults are out; use `PER_ADULT` plus a separate `PER_ROOM` row, or wait for R4.13.
- Inclusions in channel (ARI) pushes are out (R4.3).
- Showing inclusions on the registration card or proforma is **R4.13**.
- A day-wise override of an inclusion is **R4.20**.
