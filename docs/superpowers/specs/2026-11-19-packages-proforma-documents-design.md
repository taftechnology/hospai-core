# Packages, add-on schedules, proforma and document templates (R4.13)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.13 (Track P). §16.6 *Core*. Pilot checklist: front office packages; the printed half of *Guest documents* (client Q11), together with R4.25's receipt.
**Depends:** R3.2 (recurring charges), R3.3 (rate-plan inclusions), R1.5 (products), R4.20 (`is_override` nightly amounts).
**Sources:**
- Roadmap R4.13 locks:
  - schedules run inside `POST_ROOM_CHARGES`, and `NIGHT_AUDIT_STEPS` does not grow;
  - a package splits into posting lines, each carrying its own tax (§7.9), never one bundled line;
  - printable documents never render in `DEGRADED` (§4.6);
  - the advisor checks composite supply. R3.3 made the answer configurable, and packages reuse that switch.
- [Recurring charges](./2026-11-18-recurring-charges-design.md). The `pattern` column was always meant to gain values; there is no second table.
- [Rate-plan inclusions](./2026-11-19-rate-plan-inclusions-design.md): `inclusion_tax` SEPARATE | ROOM, band join, and its "inclusions on reg card and proforma is R4.13".
- [Day-wise rate override](./2026-11-19-day-wise-rate-override-design.md): `is_override`.
- `registration-card.tsx` and the `.reg-card` print CSS. AGENTS §4: isolate the card when printing, and never print a room UUID.
- BluePMS Front Office inventory: *Reservations, rates and packages* and *Proformas and guest documents*.

---

## Part A — schedules and packages

### A1. Add-on schedules (extends R3.2)

`recurring_charge.pattern` grows from `NIGHTLY` to five values. The night `d` is a stay night `[arrival, departure)`, audited on that business date.

| Pattern | Posts on |
|---|---|
| `NIGHTLY` | every night from `start_date` to `end_date` (unchanged) |
| `ARRIVAL` | the arrival night only |
| `LAST_NIGHT` | `departure − 1` only. This is BluePMS's "departure day", and it follows the stay if the departure moves. |
| `DAYS_OF_WEEK` | nights whose weekday is set in `days_mask` (bit 0 = Monday … bit 6 = Sunday; 1–127) |
| `DATES` | the listed dates. There are 1–31 of them, each inside the stay when created. A date the stay later loses simply never posts. A "single day" is one date. |

- **Migration:** SQLite cannot change a CHECK, so the migration rebuilds `recurring_charge` with the wider CHECK, copying the rows. It also adds `days_mask INTEGER` and `package_id TEXT`, and creates `recurring_charge_date (recurring_charge_id, stay_date, PRIMARY KEY (recurring_charge_id, stay_date))`.
- **Command and route:** `folio.schedule_recurring_charge` and its route take `pattern`, `daysMask` and `dates`. The DATES array is capped at 31 at HTTP and RPC. Validation:
  - a mask on any other pattern → 422;
  - an empty mask → 422;
  - a date outside the stay → `422 date_outside_stay`.
- **Posting:** the `postRoomChargesSync` schedule loop decides "due tonight" with one pure helper, `recurringChargeDue(pattern, row, night, stay)`, in contracts, unit-tested per pattern. Line ids, `source = 'RECURRING'`, tax and the inactive-code exception are unchanged.
- **Book (R1.4 add-ons):** each add-on row gains a **When** select:
  - *Now* (today's behaviour: one line on the booking date);
  - *Every night*;
  - *Arrival night*;
  - *Last night*;
  - *Weekends* (Fri and Sat nights, mask 0b0110000);
  - *Chosen days of week*;
  - *Chosen dates*.

  Any choice other than *Now* POSTs `post_reservation_recurring_charges` after Hold or Confirm, through the same follow-up and Retry path as add-ons, instead of an immediate folio line. **The stay card's `RecurringChargesCard` gains the same pattern choices.**

### A2. Package templates

Migration (next head), PropertyDO:

```sql
CREATE TABLE package (
  package_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,            -- ^[A-Z0-9_]{1,20}$
  name TEXT NOT NULL,                   -- 1–80
  room_type_id TEXT NOT NULL,
  rate_plan_id TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights BETWEEN 1 AND 30),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),   -- fixed total for the stay
  currency TEXT NOT NULL,
  component_tax TEXT NOT NULL CHECK (component_tax IN ('SEPARATE','ROOM')) DEFAULT 'SEPARATE',
  status TEXT NOT NULL CHECK (status IN ('active','archived')) DEFAULT 'active',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE package_component (
  package_id TEXT NOT NULL,
  component_no INTEGER NOT NULL,        -- 1..8
  product_id TEXT NOT NULL,             -- postable product; charge code snapshotted at apply
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),   -- per posting
  schedule TEXT NOT NULL CHECK (schedule IN ('EVERY_NIGHT','ARRIVAL','SET_NIGHT','LAST_NIGHT')),
  set_night INTEGER,                    -- 1..nights, SET_NIGHT only
  PRIMARY KEY (package_id, component_no)
);
ALTER TABLE reservation ADD COLUMN package_id TEXT;
```

**Rules:**
- There are at most 8 components (`limit_exceeded`) and at most 100 packages per property.
- The room portion of the stay is `price_minor − Σ (component.amount_minor × occurrences)`, where occurrences are the nights in the schedule (EVERY_NIGHT = `nights`, every other schedule = 1). A negative room portion → `422 package_price_below_components`.
- A package whose rate plan has an **ADDED** inclusion is refused at create and update (`422 package_plan_has_added_inclusions`), because ADDED would charge on top of a fixed price. INCLUDED inclusions come out of the room nights as they do today.
- `component_tax` mirrors R3.3's `inclusion_tax`:
  - `SEPARATE` taxes each component at its own charge code's tax group;
  - `ROOM` taxes it at the room group, using the existing `taxChargeCode` path.

  Which one is right is the advisor's composite-supply call. It is configured, not coded.
- **Commands:**
  - `rates.create_package`, `rates.update_package` and `rates.set_package_status` (permission `rates:write`, INTERACTIVE, `pms.core`, audit writers);
  - routes `get_packages` (`rates:read`), `post_packages`, `patch_package` and `post_package_status`.
  - An update never changes stays that already have the package applied; they hold snapshots.

### A3. Applying a package — `reservations.apply_package`

**Catalog entry:** INTERACTIVE, `pms.core`, `reservations:write`, kill-switch on, audit writer. The route is `post_reservation_apply_package`, with body `{ packageId }` and the idempotency key in the same place `post_reservation_recurring_charges` uses.

**Preconditions.** Each failure → 422 with a named code, and nothing changes:
- the stay is `pending`, `confirmed` or `checked_in`;
- the stay has no package yet (`package_already_applied`);
- the package is active;
- the stay's room type, rate plan and night count equal the package's (`package_mismatch`; the SPA sets them first);
- **no night of the stay is posted yet** (`package_nights_posted`). Applying at check-in works before the first night audit.

**Inside one `transactionSync`:**
1. Split the room portion over the nights with `allocate` (last-unit remainder). Never use a `Math.round` ratio. Write each night's `reservation_rate_night.amount_minor` with `is_override = 1`, so modify and plan changes keep them (R4.20 D7).
2. For each component, insert a `recurring_charge` row with `package_id` set:
   - the product, charge code and description are snapshotted, and the unit amount is `amount_minor`, quantity 1;
   - the schedule maps EVERY_NIGHT → `NIGHTLY`, ARRIVAL → `ARRIVAL`, LAST_NIGHT → `LAST_NIGHT`, SET_NIGHT n → `DATES [arrival + n − 1]`;
   - a component under `component_tax = ROOM` carries the room group for tax, the same way an inclusion with `inclusion_tax = ROOM` does. Add a nullable `tax_charge_code` column on `recurring_charge` if the existing path needs it, and say which you chose.
3. Set `reservation.package_id`.
4. Write one `audit_log` row with the package, the allocated room nights and the component rows.

**Rules:**
- **Each component posts its own line with its own tax at night audit. There is never one bundled line.** No `availability_day` change.
- **Idempotency:** `{commandId, payload: {reservationId, packageId}}` over the object sent.
- Removing a package is out of scope. The clerk cancels the component schedules and overrides the nights.

**SPA:**
- **Book** gets a **Package** select. Choosing one sets the room type, the rate plan and departure = arrival + nights, and shows the package price as the quote. After Hold or Confirm it POSTs `apply_package` (follow-up with Retry, like R4.26).
- **Check-in** shows an **Apply package** select for a stay without one when no night is posted.
- **Settings → Packages** (new tab, `rates:write`) has a `DataTable`, plus create and edit in a `Dialog`: code, name, room type, plan, nights, price, component tax, and up to 8 components (product, amount, schedule, set night). A live line shows "Room portion ₹X over N nights", and an Alert shows when it is negative. Archive is a status change.

## Part B — documents

### B1. Proforma — `get_reservation_proforma`

**Route:** `GET /v1/properties/:propertyId/reservations/:reservationId/proforma`, permission `folio:read`, `pms.core`, **`degradedRead: 'FAIL_CLOSED'`**. It works for `pending`, `confirmed` and `checked_in`.

The DO builds it read-only and writes nothing:
- **Posted part (checked-in):** the existing folio lines on the GUEST window, grouped by business date.
- **Estimated part, for every unposted night:**
  - the room amount (`rateNightAmountSync` semantics without the lazy insert: the snapshot, or else `rate_day`);
  - the INCLUDED / ADDED inclusion lines;
  - every recurring charge due that night (including package components) via `recurringChargeDue`;
  - the tax per line from the pure `resolveTaxes` with the rules in force on that date, including the band-join two-pass.

  It mirrors `postRoomChargesSync` as a pure function. Extract the shared night-building into one helper that both call, so the proforma cannot drift from what night audit posts.
- **Totals:** base, tax, estimated total, advance paid (payments on the GUEST window), balance.
- **Tax summary:** by tax line.
- **Warnings:** a night with no rate, an inclusion exceeding the rate, an inactive charge code, a DATES schedule outside the stay.
- **Presentation:** `pms.documents.proforma`, read in the DO (§B3).

The response is the data. The SPA renders it.

### B2. Registration card data — `get_reservation_registration_card`

**Route:** `GET …/reservations/:reservationId/registration-card`, permission `reservations:read`, `pms.core`, `degradedRead: 'FAIL_CLOSED'`.

It returns the stay facts the card prints:
- dates, nights, party, room type name;
- the room **code** (never the id);
- the rate plan name, the package name, the inclusion labels;
- special requests, VIP;
- `pms.documents.registration_card` presentation, read in the DO.

The guest name and the ID summary still come from OrgDO through the existing guest read and R4.15's document list. The R4.15 identity read shows only the masked number.

### B3. Templates and print settings (PRESENTATION keys)

| Key | Shape | Default |
|---|---|---|
| `pms.documents.registration_card` | `{ template: 'STANDARD' \| 'COMPACT', headerText ≤200, footerText ≤500, show: { ratePlan, inclusions, specialRequests, idDocument, signature } }` | STANDARD, all `show` true, empty texts |
| `pms.documents.proforma` | `{ template: 'STANDARD' \| 'DETAILED', headerText ≤200, footerText ≤500, show: { perNight, taxSummary, advances, warnings } }` | STANDARD, all true |

- Both are registered in `config/register.ts` as PRESENTATION and read by pms-core into the two responses, so no setting persists without effect.
- **Settings → Documents** (new tab, `settings:configure`) edits both, with the existing reason-required config pattern.
- At print time a **Template** switcher on the document overrides the default for that print only, as local state.
- There is no template designer and no logo upload.

### B4. Printing and DEGRADED

- One print component per document: `RegistrationCardDocument` (refactor `RegistrationCard`) and `ProformaDocument`.
- Each renders **only from a successful response of its route**, fetched with `staleTime: 0`. **Print** is disabled while the query is pending or in error, or while the app's connection state is degraded, with the reason shown. A failed FAIL_CLOSED route is the degraded signal; do not print cached data.
- Print CSS:
  - extend the `.reg-card` isolation to a shared `.print-doc` class (`.reg-card` keeps working);
  - black on white via tokens;
  - no room UUID or reservation UUID on paper (the confirmation is the short code, as today);
  - add `check:spa-class-denylist` coverage if a new class needs it.
- **Document actions together:**
  - The stay card gets a **Documents** action group: *Proforma* and *Registration card*. R4.25 will add *Receipt*.
  - Each opens a print view at `/reservations/:id/proforma` or `/reservations/:id/registration-card`. The view has the template switcher and Print.
- **Reprint from in-house:** the in-house list (`/in-house`, BoardScreen) gets a *Registration card* row action linking to that view.
- **Check-in:** its existing card uses the new data route.

## Tests

### pms-core

- **Schedules:**
  - `recurringChargeDue` per pattern (unit, contracts);
  - a stay with ARRIVAL, LAST_NIGHT, weekends and DATES rows posts on exactly the expected nights across a full night-audit run;
  - after a departure change, LAST_NIGHT moves;
  - a DATES date outside the stay is refused at create.
- **Package create:**
  - a negative room portion → `package_price_below_components`;
  - a plan with an ADDED inclusion → refused;
  - a 9th component → `limit_exceeded`.
- **Package apply:**
  - ₹10,000 over 3 nights with a ₹500 every-night breakfast and a ₹1,000 set-night-2 dinner gives a room portion of 10,000 − 1,500 − 1,000 = 7,500, allocated 2,500 × 3, with `is_override` 1;
  - night audit then posts room, breakfast and dinner lines on the right nights, each with its own tax line;
  - `component_tax = ROOM` taxes the components at the room group;
  - the folio total for the stay equals ₹10,000 plus tax;
  - a remainder case (₹10,000 over 3 room nights with no components) allocates 3,333 / 3,333 / 3,334, and the sum is exact.
- **Apply guards:**
  - `package_mismatch`;
  - `package_already_applied`;
  - `package_nights_posted` after the first audit;
  - idempotent replay.
- **Modify keeps package nights:** a plan change does not re-price `is_override` nights (R4.20 D7).
- **Proforma:**
  - for a confirmed stay, the estimate equals what a subsequent night audit posts (amount and tax per line, for every night). This is the drift guard.
  - for a checked-in stay with one posted night, the posted lines and estimates combine, and advance paid and balance are right;
  - warnings appear for a missing rate.
- **Two-property:** hotel A cannot read hotel B's proforma or card (route scope). FAIL_CLOSED in degraded mode returns the degraded response.
- **Config:** both presentation keys round-trip and appear in the responses. An unknown template → 422.

### web-pms

- the Book When select creates a recurring schedule after confirm;
- the Book package select fills type, plan and dates, then applies after confirm, with Retry on failure;
- the check-in Apply package select;
- the Settings → Packages room-portion line and its negative Alert;
- Settings → Documents saves;
- the print views render from the route, Print is disabled on error or pending, and the template switcher changes the layout;
- the in-house row action links to the card;
- no UUID in the printed DOM;
- cache keys are asserted for every mutation.

## Pins

| Pin | Change |
|---|---|
| `COMMAND_CATALOG` | +4 (`rates.create_package`, `rates.update_package`, `rates.set_package_status`, `reservations.apply_package`) |
| `V1_HTTP_ROUTE_AUDIT` | +7 (`get_packages`, `post_packages`, `patch_package`, `post_package_status`, `post_reservation_apply_package`, `get_reservation_proforma`, `get_reservation_registration_card`), with the last id `get_reservation_registration_card` |
| `PROPERTY_SCHEMA_HEAD` | +1 |
| `AUDIT_WRITER_COMMAND_IDS` | +4 |
| config register | +2 PRESENTATION keys |

Update the AGENTS.md pins table, the recurring charges spec (patterns) and the inclusions spec (the R4.13 pointer).

## Out of scope

- A template designer or uploads.
- Logos.
- Emailing a proforma (R5.2 if ever asked).
- E-invoicing (R5.5).
- Removing an applied package.
- Packages on a group block.
- A tape or availability view of packages.
- Per-occupancy package pricing.
