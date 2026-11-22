# Form C tracker — foreign-national arrival records (R6.2)

**Date:** 2026-11-22
**Status:** Accepted for implementation (tracker only; see §12)
**Roadmap:** R6.2 (Track P). Not ticked by the pilot, but a legal duty in India: a hotel reports each foreign national's arrival to the Bureau of Immigration within 24 hours.
**Sources:**
- [Guest ID documents and consent (R4.15)](./2026-11-19-guest-documents-consent-design.md): passport and visa fields, the check-in identity gate, the audited-read pattern.
- [Buyer GST classification (R4.22)](./2026-11-19-buyer-gst-classification-design.md): `invoice_buyer_snapshot`, encrypted under the org's legal-retention key, deleted on org purge and **retained** on guest erasure.
- [PurgeWorkflow](./2026-08-12-purge-workflow-design.md), [Night audit operator job](./2026-10-30-night-audit-operator-job-design.md).
- Roadmap fork **F4**: one person record per foreign national on the stay, encrypted in OrgDO, covered by purge, not a guest profile, no `guest_ref` on the stay, no CRM row, no event PII.

**Waits on (not built here):** client **Q5** (how they file today) and **Q19** (do they record every foreign national in a room). The advisor confirms the duty per person and the retention period at go-live. Submission stays manual on the government portal: HospAI produces the data and tracks the filed reference. It does not scrape or auto-submit a portal.

---

## 1. Why

When a foreign national checks in, nothing in HospAI says a Form C is owed, by when, or whether it was filed. A second foreign national in the same room has no record at all, because party size is `adults` / `children` only.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Two halves.** PropertyDO holds a non-PII tracker row per person: reservation, kind, status, deadline, filed reference. OrgDO holds that person's details, encrypted. PropertyDO never sees a name or a passport number. |
| D2 | **India only.** Form C applies when the property's `pms.tax.location.country` is `IN`. Elsewhere, every Form C command returns `422 form_c_not_applicable`, and the SPA hides every Form C surface. |
| D3 | **The booked guest's row is created by check-in.** The R4.15 check-in gate also reports whether the booked guest has a live `PASSPORT` document at this property with `nationality` other than `IN`. If so, at an India property, the check-in transaction inserts a `BOOKED_GUEST` tracker row with status `TO_FILE`. Its details are empty until the clerk saves them (prefilled from the documents, §9). |
| D4 | **Any other foreign national is added by the clerk** on a `checked_in` stay as an `ADDITIONAL` row. The clerk can also add a `BOOKED_GUEST` row by hand when check-in did not create one (no passport recorded yet). At most one `BOOKED_GUEST` row per reservation and **8 rows** per reservation in all. |
| D5 | **The deadline is the stay's check-in instant + 24 hours**, for every row on that stay, however late the row was added. The legal clock runs from arrival, not from data entry. |
| D6 | **Encryption follows the tax-invoice buyer snapshot:** AES-GCM under the org's **legal-retention key** (`legalRetentionKey()`), AAD `orgId:recordId`. Org purge deletes the rows. **Guest erasure retains them** as a legal record, and the certificate says so (`retained`, reason `immigration_record_retention`). The advisor confirms the retention period; until then nothing expires on its own. |
| D7 | **Reads are audited like documents.** Lists return the name and nationality only, with no access row. The full record is one audited decrypt that writes one `form_c_access` row in the same OrgDO call. |
| D8 | No new permission: reads are `guests:read`, writes are `guests:write`. Entitlement `pms.core`. Kill-switch **on** for every write, as for `guests.update`. |
| D9 | **The workbench item is the night audit check plus the register.** An unfiled row past its deadline is counted by a new `form_c_overdue` check and listed under the register's *Overdue* filter. The Exceptions screen shows an `Alert` with the count and a link to that filter. It does **not** write a `provisional_exception` row: that table is the failed-command replay queue, and a Form C is not a command. |
| D10 | **No events.** The audit log records each write. Nothing about Form C goes on the event bus. |

## 3. Data model

### 3.1 PropertyDO migration 57 (`PROPERTY_SCHEMA_HEAD` 56 → 57)

```sql
CREATE TABLE form_c_record (
  id TEXT PRIMARY KEY,                -- client-chosen (validateTenantId rules); check-in uses a deterministic id, §5
  reservation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BOOKED_GUEST','ADDITIONAL')),
  status TEXT NOT NULL CHECK (status IN ('TO_FILE','FILED','REMOVED')),
  details_saved INTEGER NOT NULL DEFAULT 0,
  deadline_at INTEGER NOT NULL,       -- epoch ms: the stay's check-in instant + 24h
  filed_reference TEXT,
  filed_at INTEGER,
  filed_by TEXT,
  removed_reason TEXT,
  removed_at INTEGER,
  removed_by TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX form_c_record_by_reservation ON form_c_record (reservation_id);
CREATE INDEX form_c_record_by_status ON form_c_record (status, deadline_at);
CREATE UNIQUE INDEX form_c_one_booked_guest ON form_c_record (reservation_id) WHERE kind = 'BOOKED_GUEST' AND status <> 'REMOVED';
```

- No PII column. `scripts/property-ddl.mjs`, the generated SQL and `check:ddl` follow the existing pattern.
- The check-in instant: use whatever already records when the stay was checked in (a column, or the status history). If none exists, add `checked_in_at` in the same migration and set it in `tryCheckIn`. Do not derive it from the business date.

### 3.2 OrgDO migration 14 (`ORG_SCHEMA_HEAD` 13 → 14)

```sql
CREATE TABLE form_c_person (
  id TEXT PRIMARY KEY,                -- = form_c_record.id
  property_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  guest_ref TEXT,                     -- the booked guest's ref on a BOOKED_GUEST row only; NULL on ADDITIONAL
  cipher BLOB NOT NULL,
  iv BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  fields_sha256 TEXT NOT NULL,
  summary_cipher BLOB NOT NULL,       -- {displayName, nationality} only, same key, AAD orgId:id:summary
  summary_iv BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  removed_at INTEGER
);
CREATE INDEX form_c_person_by_property ON form_c_person (property_id, reservation_id);
CREATE INDEX form_c_person_by_guest ON form_c_person (guest_ref);

CREATE TABLE form_c_access (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX form_c_access_by_record ON form_c_access (record_id, at);
```

- `guest_ref` on `form_c_person` exists only so the purge can count a guest's retained records. It is **not** a guest ref on the stay, and an `ADDITIONAL` row never has one (F4).
- A removed row keeps its id with `cipher`, `summary_cipher` set to `x''` and `removed_at` set.
- `form_c_access` holds no PII and survives guest erasure, like `guest_document_access`.

### 3.3 Encrypted payload (`FormCPersonFields`, `packages/contracts/src/form-c.ts`)

Strict schema; unknown keys → 422; over-long → 422. Dates are calendar `YYYY-MM-DD` strings, never `Date`.

| Field | Required | Rule |
|---|---|---|
| `surname` | yes | 1–80 chars, trimmed |
| `givenNames` | no | ≤ 80 chars (some passports carry one name) |
| `gender` | yes | `F` \| `M` \| `X` |
| `dateOfBirth` | yes | calendar date, not in the future |
| `nationality` | yes | alpha-2 `^[A-Z]{2}$`; `IN` → `422 form_c_not_foreign` |
| `passportNumber` | yes | 1–40, upper-cased, `[A-Z0-9 -]` (same rule as R4.15 `number`) |
| `passportPlaceOfIssue` | no | ≤ 80 |
| `passportIssueDate`, `passportExpiryDate` | no | calendar date |
| `visaNumber` | no | 1–40, `[A-Z0-9 -]` |
| `visaType` | no | ≤ 40 |
| `visaPlaceOfIssue` | no | ≤ 80 |
| `visaIssueDate`, `visaExpiryDate` | no | calendar date |
| `arrivedInIndiaOn` | no | calendar date |
| `portOfArrival` | no | ≤ 80 |
| `arrivedFrom` | no | ≤ 80 (city or place) |
| `arrivedFromCountry` | no | alpha-2 |
| `nextDestination` | no | ≤ 80 |
| `nextDestinationCountry` | no | alpha-2 |
| `addressAbroad` | no | ≤ 200 |
| `contactInIndia` | no | ≤ 20, `[0-9 +()-]` |
| `purposeOfVisit` | no | ≤ 80 |
| `employedInIndia` | no | boolean |
| `remarks` | no | ≤ 200 |

The arrival at the hotel is the stay's check-in instant (PropertyDO), not a stored field. The optional set is a best reading of the portal form, which varies by state. **The client's own portal screen (Q5, walkthrough) confirms the list before go-live**; a field added then is optional by default, so nothing already saved breaks. Photos are out of scope: the portal takes the photo at filing.

`displayName` for lists is `givenNames + ' ' + surname`, trimmed.

## 4. Commands

Three new commands in `COMMAND_CATALOG` (148 → **151**). All are `INTERACTIVE`, `pms.core`, kill-switch on, run on PropertyDO and are audit writers (`AUDIT_WRITER_COMMAND_IDS` 114 → **117**).

| Command id | RPC | Does |
|---|---|---|
| `form_c.save_person` | `trySaveFormCPerson` | Creates a row (new id) or replaces the details of a `TO_FILE` row. Awaits OrgDO `putFormCPerson` **before** `transactionSync` (the `gateOrgRef` transport pattern), then in one transaction inserts the tracker row or sets `details_saved = 1`. |
| `form_c.mark_filed` | `tryMarkFormCFiled` | `{recordId, reference}`; reference 1–40 chars `^[A-Za-z0-9][A-Za-z0-9 /-]*$`. Requires `details_saved = 1` (else `422 form_c_details_missing`) and status `TO_FILE` (`FILED` → `422 form_c_already_filed`, `REMOVED` → `404 not_found`). Sets status, `filed_reference`, `filed_at`, `filed_by`. |
| `form_c.remove_person` | `tryRemoveFormCPerson` | `{recordId, reason}`; reason 1–200. `TO_FILE` only (`FILED` → `form_c_already_filed`). Sets `REMOVED` in a transaction, **then** awaits OrgDO `clearFormCPerson`. A failed clear is logged and swept by the org purge, never shown to the clerk as a failure. |

`trySaveFormCPerson` input: `{recordId, reservationId, kind, fields}`.
- Property country must be `IN` (read inside the transaction from config, DOMAIN class) → else `form_c_not_applicable`.
- Reservation at this property, status `checked_in` → else `404 not_found` / `422 form_c_not_in_house`. An existing `TO_FILE` row may still be edited after checkout (late filing); a new row may not.
- New `BOOKED_GUEST` while a live one exists → `422 form_c_booked_guest_exists`. Row 9 → `422 limit_exceeded`.
- An existing row must belong to the same reservation and kind → else `404 not_found`.
- `BOOKED_GUEST` passes the reservation's `guest_ref` to OrgDO; `ADDITIONAL` passes none.
- OrgDO `putFormCPerson` checks `property_id` on an existing row (`404` on mismatch), encrypts the fields and the summary, and is idempotent on `(id, fields_sha256)` like the buyer snapshot.

Idempotency: `{commandId, payload}` fingerprint, keyed per user, through the existing `runIdempotent`. For `save_person` the payload hashed is `{recordId, reservationId, kind, fieldsSha256}` — the same canonical fields object that OrgDO encrypts.

New domain errors go in the one `commandErrorHttpStatus` table, all 422: `form_c_not_applicable`, `form_c_not_foreign`, `form_c_not_in_house`, `form_c_booked_guest_exists`, `form_c_details_missing`, `form_c_already_filed`. `limit_exceeded` and `not_found` exist.

## 5. Check-in

- Extend OrgDO `checkInIdentityGate` to also return `foreignPassport: boolean`: a live `PASSPORT` document **at this property** for the guest whose decrypted `nationality` is not `IN`. It already runs before the transaction and already fails closed. This adds one decrypt per check-in for guests with a passport; no access row, because nothing leaves OrgDO except the boolean.
- Inside the existing check-in `transactionSync`: if the property country is `IN` and `foreignPassport`, insert the `BOOKED_GUEST` row with id `fcb_{reservationId}` (deterministic, so a replay inserts nothing), `TO_FILE`, `details_saved = 0`, deadline check-in + 24h, `created_by` the actor. Skip if a live `BOOKED_GUEST` row already exists.
- Find every path that checks a guest in and confirm it goes through `tryCheckIn`.

## 6. HTTP routes

Six new routes. `V1_HTTP_ROUTE_AUDIT` 251 → **257**, last id **`post_form_c_remove`**. Each calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` and goes through `dispatchV1` only. JSON bodies use the shared parse helper and the JSON `idempotencyKey` convention of `post_guest_documents`.

| Route id | Method + path | Permission | Notes |
|---|---|---|---|
| `get_form_c_register` | `GET /v1/properties/:pid/form-c?filter=to_file\|overdue\|filed\|all` | `guests:read` | Default `to_file`. Newest deadline first, cap 200. Rows: `{recordId, reservationId, kind, status, detailsSaved, deadlineAt, overdue, filedReference, filedAt, displayName, nationality}`. Name and nationality come from one OrgDO summary batch filtered to this property; no access row. A summary that fails to decrypt gives `displayName: null` for that row, not a 500. |
| `get_reservation_form_c` | `GET …/reservations/:rid/form-c` | `guests:read` | Same row shape for one stay, all statuses but `REMOVED`. |
| `get_form_c_person` | `GET …/form-c/:recordId` | `guests:read` | Audited decrypt (D7): `{recordId, reservationId, kind, status, deadlineAt, checkedInAt, filedReference, filedAt, fields}`. `fields` is `null` when details were never saved. |
| `post_form_c_person` | `POST …/reservations/:rid/form-c` | `guests:write` | `{recordId, kind, fields, idempotencyKey}` |
| `post_form_c_filed` | `POST …/form-c/:recordId/filed` | `guests:write` | `{reference, idempotencyKey}` |
| `post_form_c_remove` | `POST …/form-c/:recordId/remove` | `guests:write` | `{reason, idempotencyKey}` |

A record at another property, in the same org or not, is `404 not_found` with no foreign data, from both halves.

## 7. Night audit and purge

### 7.1 Night audit

- Add `form_c_overdue` to `NIGHT_AUDIT_CHECK_IDS` (10 → **11**), the strict schema and `NIGHT_AUDIT_CHECKS_DEFAULT` (`'warn'`).
- `countNightAuditCheckSync` counts `form_c_record` rows with status `TO_FILE` and `deadline_at` before the audit's instant.
- Preview label: "Form C records past their 24-hour deadline". `NIGHT_AUDIT_STEPS` is unchanged. Settings → Night audit lists the row with the others.

### 7.2 Purge

- **Org plan:** a step `count-form-c-persons` (like `count-invoice-buyer-snapshots`) and a certificate store `org_do_form_c`, `reached` with `deleted: n`, or `skipped` when n = 0. PropertyDO tracker rows go with the property's existing deletion.
- **Guest plan:** a step `retain-form-c` after `retain-invoice-buyer`: `org_do_form_c`, `retained`, reason `immigration_record_retention`, `count` = that guest's `BOOKED_GUEST` rows. `ADDITIONAL` rows are not the erased guest's and are not counted.
- Update `purge-stores.ts`, `purge-certificate-columns.ts`, `check:purge` and the purge spec to match.

## 8. Copilot

The copilot reads no Form C data. Its tool list is unchanged.

## 9. Operator SPA

ui-kit only, no raw controls, no inline styles, `classifiedUserMessage` and `Alert` for results. Every Form C surface renders only when the property's tax location country is `IN`.

### 9.1 Stay card — *Form C* panel

- A `DataTable` of the stay's rows: name (or "Details needed"), nationality, kind ("Booked guest" / "Additional guest"), deadline (the app's date and time format, with "Overdue" as a `Badge` when past and unfiled), status `Badge` with its word.
- **Add foreign national** (checked-in stays only) opens the details `Dialog` for an `ADDITIONAL` row with a new id. It also offers "Booked guest" when the stay has no live `BOOKED_GUEST` row.
- **Enter details** / **Edit** on a `TO_FILE` row opens the same dialog. For a `BOOKED_GUEST` row with no saved details, the dialog is **prefilled** from the guest's most recent live `PASSPORT` and `VISA` documents through the existing audited document reads. Only the fields above are mapped; the clerk reviews and saves.
- **View for filing** opens the audited read in a `Dialog`, laid out in the portal's order, with a **Print** button. Print CSS isolates `.form-c-card`; no UUID or record id is printed.
- **Mark filed** asks for the portal reference. **Remove** is `intent="destructive"`, confirms and requires a reason.

### 9.2 Check-in

When the booked guest's passport shows a foreign nationality and the property is in India, the check-in screen shows one line: "A Form C is due within 24 hours of check-in. It will appear on the stay card." No new control.

### 9.3 Register — `/form-c`

- Under Front office in the nav, gated on `guests:read`, lazy-loaded. `PageHeader` title "Form C", subtitle with the live `property.name`.
- Filter (`NativeSelect`): To file (default), Overdue, Filed, All. Columns as the stay card plus a link to the stay. Empty, error and "no rows match this filter" are three different states.

### 9.4 Exceptions

The Exceptions screen reads the register with `filter=overdue` and, when the count is above zero, shows an `Alert` ("{n} Form C records are past their 24-hour deadline") with a link to `/form-c?filter=overdue`. Nothing when zero or outside India.

### 9.5 Cache keys

- `['form-c-register', propertyId, filter]`, `['reservation-form-c', propertyId, reservationId]`, `['form-c-person', propertyId, recordId]` (`gcTime: 0`).
- Every mutation invalidates the stay's key and the `['form-c-register', propertyId]` prefix. Check-in also invalidates the stay's Form C key. Tests assert the keys.
- API calls live in `client-core`.

## 10. Tests

### pms-core

1. Check-in at an India property with a foreign passport on file creates one `BOOKED_GUEST` row, `TO_FILE`, deadline = check-in + 24h. With an Indian passport, no row. At a non-India property, no row. A replayed check-in creates no second row.
2. **Two foreign nationals on one stay give two records with separate rows and the same deadline** (the stay's check-in + 24h); a third added a day later still carries that deadline.
3. **Hotel A cannot read hotel B's records** (two properties, same org, AGENTS §5): B's record is absent from A's register and stay read; A's person GET, filed and remove return 404 with no foreign data.
4. Save: `nationality: 'IN'` → `form_c_not_foreign`; unknown key → 422; a second live `BOOKED_GUEST` → `form_c_booked_guest_exists`; a 9th row → `limit_exceeded`; a stay not checked in → `form_c_not_in_house`; edit after checkout of an existing `TO_FILE` row works.
5. Filed: without details → `form_c_details_missing`; with details → `FILED` with the reference; a second mark → `form_c_already_filed`; remove of a filed row → `form_c_already_filed`.
6. A person read writes exactly one `form_c_access` row with the actor; the register and stay lists write none.
7. **A person record adds no row to the guest directory** and no guest search hit; no outbox event carries any Form C field; `ADDITIONAL` rows have `guest_ref` NULL.
8. Idempotency: same key and payload returns the first result; same key with other fields → the existing conflict code; the fingerprint includes the command id.
9. Night audit: `form_c_overdue` counts only `TO_FILE` rows past deadline; severity is configurable like the others.
10. **Purge:** org purge deletes `form_c_person` rows and the certificate shows `org_do_form_c` reached with the count. Guest erasure keeps the guest's `BOOKED_GUEST` record and shows `retained`, `immigration_record_retention`, count 1, while an `ADDITIONAL` row on the same stay is not counted.
11. Not India: every write → `form_c_not_applicable`.

### web-pms

- The panel, the register and the Exceptions alert render only for an India property.
- Prefill maps passport and visa document fields into the dialog.
- Remove requires a reason; Mark filed requires a reference.
- Three list states on the register.
- Cache keys asserted for every mutation and for check-in.

### contracts / do-runtime

- `FormCPersonFields` schema cases; pins updated (§11); migrate tests at heads 57 (property) and 14 (org).

## 11. Pins and docs (same change-set)

- `COMMAND_CATALOG` **151**; `AUDIT_WRITER_COMMAND_IDS` **117**.
- `V1_HTTP_ROUTE_AUDIT` **257**, last id **`post_form_c_remove`**; `scripts/permissions-check.mjs` still matches.
- `PROPERTY_SCHEMA_HEAD` **57**; `ORG_SCHEMA_HEAD` **14**.
- `NIGHT_AUDIT_CHECK_IDS` length **11**, includes `form_c_overdue`.
- AGENTS.md pins table, the roadmap R6.2 entry (tracker done, Q5/Q19 and advisor still open), and the purge spec.

## 12. Out of scope

- Submitting to the portal, scraping it, or any API call to it.
- Departure updates beyond what the portal requires; other countries' guest registration.
- Photo capture for the form.
- A UI for the `form_c_access` log.
- Wider additional-guest capture (waits on Q19).
- Automatic expiry of retained records (waits on the advisor's retention period).

---

## 13. Implementation notes (2026-11-22)

Every decision D1 to D10 holds. Where the code forced a choice, this is what was built.

- **Check-in instant (§3.1).** Nothing recorded it, so migration 57 adds `reservation.checked_in_at` (nullable), set by `tryCheckIn` and cleared by `tryCancelCheckIn`. A stay checked in before the migration has no value: the deadline falls back to the `reservations.check_in` audit row, then to the moment the row is added.
- **The India flag on the wire.** `get_domain_config` needs `settings:configure`, which a desk clerk does not hold, so the SPA could not read `pms.tax.location`. `get_property` (`property:read`) now returns `formCApplicable: boolean`, read from that key inside PropertyDO. The nav entry, the stay card panel, the register, the check-in line and the Exceptions alert all hang off it. Reads still return whatever rows exist outside India (there are none unless the country changed); only writes refuse with `form_c_not_applicable`.
- **Cancel check-in (§5, "every path that checks a guest in").** `tryCheckOut`, `tryUndoCheckOut` and the board all go through the existing commands; only `tryCheckIn` moves a stay to `checked_in` from `confirmed`. `reservations.cancel_check_in` would have left a spurious overdue row, so it now deletes the stay's `TO_FILE` rows (filed rows stay) and clears their OrgDO details afterwards, best effort. OrgDO `putFormCPerson` reuses a cleared row of the same stay, so the deterministic `fcb_{reservationId}` id works again on re-check-in.
- **Identity gate.** `checkInIdentityGate` returns `foreignPassport` by decrypting the guest's live passports at this property: any whose nationality is not `IN` counts. An unreadable passport does not block check-in.
- **Reads live on PropertyDO.** `readFormCRegister`, `readReservationFormC` and `readFormCPerson` run on PropertyDO and call OrgDO (`readFormCSummaries`, `readFormCPerson`) through `gateOrgRef`, so the HTTP handlers stay thin and every OrgDO read is filtered by `property_id`. `readFormCSummaries` is capped at 200 ids. An unreachable OrgDO is `503 org_unreachable` (fail closed), never a partial list.
- **Idempotency.** `post_form_c_person` fingerprints `{ recordId, reservationId, kind, fieldsSha256 }`, where the hash is the canonical fields object that is sent to the DO and sealed. `mark_filed` hashes `{ recordId, reference }` and `remove_person` `{ recordId, reason }`, all under the command id and the user. A save that races a refusal can leave a sealed OrgDO row with no tracker row (the OrgDO write precedes the transaction); it is unreachable by any id the tracker knows and the org purge deletes it.
- **Date of birth** may be up to one day ahead of UTC today, so a property east of UTC does not reject a guest born today.
- **Retained count.** The guest purge counts live (not removed) `BOOKED_GUEST` rows; the org purge counts every row including cleared shells.
- **No new Settings control.** The `form_c_overdue` severity row is the existing night audit checks map.
- **Not verified.** Print isolation was written to the same pattern as the registration card (`.form-c-card print-doc`) and checked in jsdom only; nobody has printed it from a browser. The portal field list is a best reading, as §3.3 says.

