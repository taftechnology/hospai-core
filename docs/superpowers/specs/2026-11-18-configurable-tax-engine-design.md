# Configurable tax engine — design

**Slice:** roadmap R3.6. **Date:** 2026-11-18. **Status:** accepted for build (the user, 2026-11-18).
**Builds on:** [tax posting](2026-08-07-tax-posting-design.md) (`tax_rule`, `charge_code.tax_group`, `source = 'TAX'`, split allocates stamped tax) and [taxable discounts](2026-08-14-taxable-discounts-design.md). Implements [`ARCHITECTURE.md` §7.9](../../../ARCHITECTURE.md#79-regulatory--the-hidden-second-product) requirements 1–6 and 8; requirement 7 (fiscal hook) is R5.5 and requirement 9 is R4.22.

## 0. The user's decision (2026-11-18)

Every rate, slab, component, ordering choice, and whether a tax is **included in the price or added on top**, is set by the hotel in **Settings → Tax**. No country's rules are written into code. Rules differ by country and, inside one country, by hotel, so the engine gives the hotel each option and the hotel sets it.

This replaces two earlier locks:
- §7.9 requirement 6 said inclusive vs exclusive is "a jurisdiction property, not a display preference". It is now **a property of each tax rule, set by the hotel**. A country preset may suggest it; the hotel decides.
- The go-live checklist said the Indian tax advisor signs off on the model "before it is built". The advisor now confirms the **values the hotel enters** and real invoices, **before the first rupee posts**. Nothing about a rate or a slab is code.

## 1. What exists today

`tax_rule` (PropertyDO): one flat `PERCENTAGE` rate per `tax_group`, effective-dated, versioned by `rule_key` (create / supersede), one output charge code. `stampTaxForChargeSync` posts one `TAX` line per applicable rule after the parent charge is inserted, on the parent's ledger amount, from six call sites (no-show, add item, night-audit room and recurring, transfer, discount and others). Split allocates the parent's stamped tax; transfer copies it. Settings → Tax creates and supersedes flat rules. The India demo fakes GST as two unrelated 2.5% rules.

## 2. Decisions

### 2.1 A rule version carries everything (one row family, versioned together)

A `tax_rule` version gains:

| Field | Values | Meaning |
|---|---|---|
| `price_mode` | `EXCLUSIVE` \| `INCLUSIVE` | Added on top of the price, or already inside it. **Hotel's choice per rule.** |
| `sequence` | integer ≥ 0 | Order the rule applies in, within one tax group. |
| `base` | `NET` \| `NET_PLUS_PRIOR` | Tax on the net amount, or on net plus the exclusive taxes with a lower `sequence` (Ontario MAT inside HST). |
| `condition_key`, `condition_value` | nullable | Applies only when the property's declaration `condition_key` has this value on the posting date (§2.5). |
| `rebands_on_discount` | boolean, default true | Whether a later discount on a slab-taxed line re-chooses the band (§2.6). |
| bands | 1–10 rows | `up_to_minor` (inclusive, ledger currency, ascending; the last is `NULL` = no limit). One band = a flat rate. |
| components | 1–4 rows per band | `output_charge_code` + `rate` (decimal string). GST 12% = CGST 6% + SGST 6%. The band's rate is the sum. |

New child tables `tax_rule_band (tax_rule_id, band_no, up_to_minor)` and `tax_rule_component (tax_rule_id, band_no, component_no, output_charge_code, rate)`, written in the same transaction as the version row. A supersede writes a whole new version with its own bands and components; old versions are never edited (§5.1 rule 5). Existing rules migrate to one band, one component (their `rate` and `output_charge_code`), `EXCLUSIVE`, `sequence 0`, `NET`, no condition. `rule_type` stays (`PERCENTAGE` only is posted; the others stay rejected).

Caps (HTTP **and** RPC, `422 limit_exceeded`): 10 bands, 4 components per band, 20 live rules per tax group. Band limits strictly ascending, positive integers. Component output codes must be active and non-taxable (existing `TaxOutputCodeTaxableError`).

### 2.2 One resolver, called before the parent posts

`resolveTaxSync({ taxGroup, postingDate, amountMinor, posted })` replaces the stamp's lookup and returns `{ netLedgerMinor, netTxnMinor, lines[] }`. It runs inside the caller's `transactionSync` (§7.9 requirement 3) and **before** the parent is inserted, because an inclusive rule changes the parent's amount. All six call sites switch to: resolve → insert parent at `net` → insert the returned tax lines. `packages/money` gets the pure math (`resolveTaxes`) with unit tests; the DO only loads rule versions and declarations.

Order of work for one charge:
1. Load the applicable versions for the group and date (date range + condition), sorted by `sequence`, then `rule_key`.
2. **Back out inclusive rules.** Gross = the charge amount. `net = round(gross / (1 + Σ inclusive rates))`, inclusive tax total = `gross − net` (so price = net + tax exactly), split across the inclusive components with `allocate` by rate. Inclusive rules must use `base = NET`; `NET_PLUS_PRIOR` on an inclusive rule is rejected at save (`tax_inclusive_compound_unsupported`). At most one inclusive rule per group may have more than one band (`tax_inclusive_slab_conflict` at save). Its band: try bands in ascending order and take the first whose limit contains the `net` computed with that band's rate; if none does (the gap at a boundary), take the lowest band whose limit is ≥ the `net` computed at the highest band's rate.
3. **Add exclusive rules** in `sequence` order. Band chosen on the net amount. Base is net, or net plus the exclusive tax lines already computed for lower sequences. Each component is `computeTax(base, componentRate)`, rounded on its own (CGST and SGST each round, as on a real invoice).
4. Zero-amount components post no line (as today).

Foreign-currency charges: tax is computed in ledger currency (as today). For an inclusive rule the parent's transaction-currency net is `allocate(txnAmount, [netLedger, taxLedger])[0]`, so both currencies foot.

### 2.3 Line identity with components

`folio_line` gains `tax_component TEXT NOT NULL DEFAULT ''`. Tax line id `${parent}:tax:${tax_rule_id}:${component_no}`; existing lines keep their ids and `''`. `folio_line_tax_uniq` is rebuilt on `(tax_of, tax_rule_id, tax_component) WHERE source = 'TAX'`. Split and transfer, which today build child tax ids from `tax_rule_id` alone, include the component (otherwise two components on one rule collide). Every TAX writer still sets `tax_of` and `tax_rule_id` non-NULL.

### 2.4 Tax location and registration — DOMAIN config, read on invoice issue

Registered config keys, saved through the existing Settings path, read in the DO when an invoice is issued and copied into its snapshot (so they are read, not decoration):
- `pms.tax.location` — `{ country: ISO 3166-1 alpha-2, region: string | null, locality: string | null }`. §7.9 requirement 1: per property, not per org.
- `pms.tax.registrations` — up to 4 `{ label, number }` (e.g. `GSTIN`, `GST/HST No.`). Printed on the invoice. Validation is length and charset only; the format check per country is a later preset concern.

### 2.5 Property declarations — dated, read inside the transaction

`tax_declaration (declaration_key, value, valid_from, valid_to)` in PropertyDO, versioned like rules. The hotel names a declaration and its value from a date (India: `specified_premises = yes` for the financial year from 1 April). A rule with a condition applies only when the declaration has that value on the posting date. Read inside the posting `transactionSync`, never from KV. Commands `folio.set_tax_declaration` (create a version, closing the open one) with `GET`/`POST` routes; cap 20 declaration keys.

### 2.6 Discounts re-band (or not, per rule)

Today a discount restamps tax on its own negative amount at the current rate. With slabs that is wrong: a small discount would pick the lowest band. New rule, using the **source line's stamped rule versions** (never today's):
- `rebands_on_discount = true`: re-resolve the source line's net after all its discounts, and post the difference from the tax already on it (source plus earlier discounts), per component. A discount can move a night to a lower band, and the tax lines show it.
- `false`: the discount's tax is the source's stamped tax scaled by the discount (`allocate`), with no band change.

For a one-band rule both give the same result as today.

### 2.7 Settings → Tax

Three cards, all `ui-kit`:
1. **Tax location and registration**: country, state or region, city, registration numbers.
2. **Declarations**: list, add a value from a date.
3. **Tax rules**: list grouped by product group, showing the version in force today, with a form for name, product group, *Included in price / Added on top*, order, base, condition, the band table (limit + components), and the start date. Editing an existing rule supersedes it from a date. Copy states that posted charges keep their tax.

**Presets** fill the form; they never save on their own and never carry rates. *India — GST* sets up the rule structure: room slab bands with CGST and SGST components, F&B with a specified-premises condition, all exclusive. The hotel enters every rate and limit. *Custom* starts blank. Canada presets are R4.19.

Booking and the folio show whether each tax on a stay is included or added, from the room group's rules (one line of text).

### 2.8 What stays out

- **IGST / place of supply other than the hotel's state.** It needs the buyer's state (R4.22). Storing an inter-state component set now would be a setting nothing reads. R4.22 adds it as a second component set on the band.
- **Meal plan in the slab base, and composite supply.** Inclusions do not exist until R3.3. R3.3 adds both as hotel options on the plan: whether an inclusion's value joins the room night for band choice, and whether the bundle is taxed at the room's rule or line by line. The resolver takes an optional `bandBaseMinor` so R3.3 can pass the joined value without changing this engine.
- Per-person and flat-amount levies (`PER_PERSON_PER_NIGHT`, `FLAT`): still rejected; a city tax per person needs them (R4.19 if Canada needs it, otherwise later).
- Invoice-total rounding, e-invoicing (R5.5), buyer snapshot and HSN/SAC (R4.22).

## 3. Pins and catalogue

New commands `folio.set_tax_declaration` and `folio.end_tax_rule`; `folio.create_tax_rule` / `folio.supersede_tax_rule` payloads widen (fingerprints include the new fields). Routes `get_tax_declarations` (`folio:read`), `post_tax_declarations` and `put_tax_rule_end` (`settings:configure`, as the tax-rule writes). PropertyDO migration 42 (version columns, band and component tables, `tax_component`, index rebuild, `tax_declaration`). Config keys `pms.tax.location`, `pms.tax.registrations`. Pins after this slice: `COMMAND_CATALOG` 109, `V1_HTTP_ROUTE_AUDIT` 176 (last `put_tax_rule_end`), `AUDIT_WRITER_COMMAND_IDS` 79, `PROPERTY_SCHEMA_HEAD` 42.

**Added in build (2026-11-18): stopping a tax.** The browser check showed an owner replacing two old rules with one could not end the old one, so it kept posting beside the new one. `folio.end_tax_rule` (`PUT …/tax-rules/:ruleKey/end`, body `{ validTo, idempotencyKey }`) sets `valid_to` on the open version; `validTo` must be after its `valid_from`; posted lines are untouched. Settings → Tax shows *Stop from a date* with a confirm dialog. The folio shows each tax line's own code (CGST, SGST), and the included/added note reads the rules in force on the property's date.

## 4. Tests (acceptance)

- `packages/money` `resolveTaxes`: flat exclusive matches today; slab picks the band on the net per night; components round independently; inclusive backs out so net + tax = price for awkward prices (999, 1, 7,501 at a boundary); the boundary-gap rule; compound `NET_PLUS_PRIOR` (an Ontario-shaped fixture); mixed inclusive + exclusive on one charge; a tax-inclusive fixture (§7.9 requirement 6).
- PropertyDO: night audit posts a night under and over a band limit at different rates; an inclusive room rate posts net + components equal to the rate; a declaration flips the F&B rule on its start date and not before; superseding a rule leaves posted lines unchanged; discount re-bands across a limit (and does not when the rule says no); split and transfer of a two-component tax keep both lines and foot; existing single-rule specs still green with migrated rules; FX inclusive charge foots in both currencies; caps → 422.
- SPA: Settings → Tax saves bands, components and mode; preset fills without saving; invoice snapshot carries location and registrations; booking shows included/added copy.
