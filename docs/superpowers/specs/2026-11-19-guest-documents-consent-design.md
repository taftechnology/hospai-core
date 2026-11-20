# Guest ID documents, preferences and consent (R4.15)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.15 (Track P). Pilot checklist: *Guest lookup (ID documents)*, *Guest documents* (the ID half; the printed set is R4.13 / R4.25), *Edit reservation and guest preferences*, *Guest 360 (identity, stays, preferences, consent)*.
**Sources:**
- [Guest CRM directory](./2026-08-13-guest-crm-directory-design.md): this slice undefers two of its leftovers, ID documents and `guests.update_consent`.
- [Guest CRM depth](./2026-10-29-guest-crm-depth-design.md): tags, VIP and notes inside the profile blob.
- [Settings → Guests](./2026-11-17-settings-guests-design.md): its hidden *Require ID at check-in* control is owned here.
- [Guests crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md), [PurgeWorkflow](./2026-08-12-purge-workflow-design.md), [Event log R2](./2026-08-12-event-log-r2-design.md) (its note that one `r2` certificate entry cannot say both "event log kept" and "documents deleted").
- [Night audit operator job](./2026-10-30-night-audit-operator-job-design.md): its *ID proof completeness* row.
- [Outbox consumers](./2026-11-19-outbox-consumers-design.md): the flag consumer in §7 is a registry entry.
- BluePMS Front Office inventory (research note): guest lookup shows photo and ID when choosing a match; ID proof is a pre-close night-audit check.

**Amends:**
- The guest CRM directory spec's leftover list (L79, L86, L188, L585, L594, L694): ID documents and consent are now built here.
- The Settings → Guests spec: *Require ID at check-in* is live.
- The night audit operator job spec's *ID proof completeness* row.

---

## 1. Why

`GuestProfile` holds a name, contact details, tags, VIP and notes. It has no identity documents, no structured preferences and no consent.

The pilot hotel needs all three:
- The desk records a passport or national ID at check-in.
- Indian law needs passport and visa data for foreign nationals (R6.2 Form C reads them).
- The desk wants to see a returning guest's preferences on the stay card.
- DPDP needs per-purpose consent before anyone markets to the guest.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Documents live in **OrgDO**, encrypted under the **guest's own data key**: the same `piiKeyId` and the same per-org HKDF wrap as the profile. Shredding the key on erasure makes them unreadable at once. Purge then deletes the rows and the objects. |
| D2 | A document is **scoped to the property that recorded it** (`property_id`). Hotel A never lists or reads a document hotel B recorded, even for a guest linked to both. Each hotel holds its own legal record. |
| D3 | **Aadhaar is stored as the last four digits only, with no scan.** UIDAI approved a rule (Dec 2025) to stop hotels photocopying or storing Aadhaar and to move them to QR / app verification. A 12-digit number or a scan upload on an `AADHAAR` document is refused. The advisor confirms at go-live. |
| D4 | Every decrypted read of a document or its scan writes one `guest_document_access` row **in the same OrgDO call** that decrypts. Lists never decrypt. |
| D5 | Scans are encrypted in OrgDO under the guest's data key, then written to a new R2 bucket, `GUEST_DOCS_R2`. They are read back only through OrgDO. Object keys carry no PII. |
| D6 | Preferences are **structured codes inside the profile blob**, edited through the existing `guests.update`. R1.8's free-text `notes` stay separate. |
| D7 | Consent is an **append-only history per purpose** in OrgDO. The current state is the latest row. The notice version is **stamped server-side** from Settings → Guests and never sent by the client. |
| D8 | *Require ID at check-in* is an org-wide guest setting read in `tryCheckIn` through an OrgDO gate before `transactionSync`, like `gateGuestRef` on create. Unreachable OrgDO **fails closed**. |
| D9 | PropertyDO keeps one non-PII bit per reservation, `id_document_on_file`, set at check-in and kept current by a queue consumer. The night audit counts it without seeing PII. |
| D10 | No new permission: reads are `guests:read`, writes are `guests:write`. Entitlement is `pms.core`. Kill-switch is **on** for every new write, the same as `guests.update`. |

## 3. Data model

### 3.1 OrgDO migration 12 (`ORG_SCHEMA_HEAD` 11 → 12)

```sql
CREATE TABLE guest_document (
  id TEXT PRIMARY KEY,                 -- client-chosen, validateTenantId rules
  guest_ref TEXT NOT NULL,
  property_id TEXT NOT NULL,           -- the recording property (D2)
  kind TEXT NOT NULL CHECK (kind IN ('PASSPORT','VISA','NATIONAL_ID','DRIVING_LICENCE','AADHAAR','OTHER')),
  doc_cipher BLOB NOT NULL,            -- AES-GCM under the guest data key; AAD = piiKeyId || ':' || id
  doc_iv BLOB NOT NULL,
  scan_object_key TEXT,                -- guest-docs/{orgId}/{documentId}; NULL until attached
  scan_content_type TEXT,              -- image/jpeg | image/png | application/pdf
  scan_bytes INTEGER,
  scan_iv BLOB,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  removed_at INTEGER,
  removed_by TEXT,
  removed_reason TEXT
);
CREATE INDEX guest_document_by_guest ON guest_document (guest_ref, property_id);

CREATE TABLE guest_document_access (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  guest_ref TEXT NOT NULL,
  property_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read','scan_read')),
  at INTEGER NOT NULL
);
CREATE INDEX guest_document_access_by_doc ON guest_document_access (document_id, at);

CREATE TABLE guest_consent (
  id TEXT PRIMARY KEY,
  guest_ref TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('MARKETING_EMAIL','MARKETING_SMS','MARKETING_WHATSAPP','PROFILE_RETENTION')),
  status TEXT NOT NULL CHECK (status IN ('GRANTED','WITHDRAWN')),
  notice_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('DESK','REGISTRATION_CARD','EMAIL','PHONE')),
  property_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  recorded_by TEXT NOT NULL
);
CREATE INDEX guest_consent_by_guest ON guest_consent (guest_ref, purpose, recorded_at);
```

- A removed document keeps its row as a tombstone. Its `doc_cipher` becomes `x''`, its scan object is deleted from R2 in the same request, and the scan columns are cleared.
- At most **20 live documents** per guest per property. Past that, `422 limit_exceeded`.
- The access log holds no PII: ids, actor and time only. It **survives erasure** as the record of who saw the data. The guest ref is pseudonymous once the key is shredded. The purge certificate says so (§8).

### 3.2 Encrypted document payload (`GuestDocumentFields`, in contracts)

| Field | Kinds | Rule |
|---|---|---|
| `number` | all but `AADHAAR` | 1–40 chars, trimmed, upper-cased, `[A-Z0-9 -]` |
| `numberLast4` | `AADHAAR` only, required | exactly 4 digits. A `number` on `AADHAAR` → `422 aadhaar_full_number_not_allowed` |
| `issuingCountry` | all but `AADHAAR` | ISO 3166-1 alpha-2, `^[A-Z]{2}$` |
| `nationality` | `PASSPORT`, `VISA`, `NATIONAL_ID` | alpha-2 |
| `dateOfBirth`, `issueDate`, `expiryDate` | optional | calendar date `YYYY-MM-DD` (the stay calendar type, not `Date`) |
| `placeOfIssue` | optional | ≤ 80 chars |
| `visaType` | `VISA` only | ≤ 40 chars |

These are the fields R6.2 reads from passport and visa. Unknown keys → 422. Over-long fields → 422.

### 3.3 Preferences on `GuestProfile` (`packages/crypto-shredding/src/types.ts`)

```ts
preferences?: {
  room?: RoomPreferenceCode[];          // HIGH_FLOOR, LOW_FLOOR, QUIET_ROOM, NEAR_ELEVATOR, AWAY_FROM_ELEVATOR, CONNECTING_ROOM
  bedding?: BeddingPreferenceCode[];    // KING, QUEEN, TWIN, EXTRA_BED, CRIB, FEATHER_FREE
  dietary?: DietaryPreferenceCode[];    // VEGETARIAN, VEGAN, JAIN, HALAL, KOSHER, GLUTEN_FREE, NUT_ALLERGY, LACTOSE_FREE
  accessibility?: AccessibilityCode[];  // WHEELCHAIR, ACCESSIBLE_BATHROOM, GROUND_FLOOR, HEARING_SUPPORT, VISUAL_SUPPORT
  other?: string;                       // ≤ 200 chars; not a second notes field
}
```

- The code lists and labels live in `packages/contracts/src/guest-preferences.ts`. Each array is unique and capped at its list length, at HTTP and in `tryUpdateGuest`. Over the cap → `422 limit_exceeded`.
- They go through the existing `PATCH` guest route and `guests.update`. **No new command.**
- `preferences: null` clears them. An omitted key leaves them unchanged, the same as `tags`.
- Never on the event bus. Preferences, dietary and accessibility codes included, ride only inside the encrypted blob.

### 3.4 Guest settings (`packages/contracts/src/guest-settings.ts`)

Two new keys join the strict schema:
- `requireIdAtCheckIn: boolean`, default `false`. Read by the check-in gate (§6).
- `consentNoticeVersion: string | null`, ≤ 40 chars, `^[A-Za-z0-9._-]+$`, default `null`. Read by `tryUpdateConsent`, which stamps it on the row. While it is `null`, consent cannot be recorded: `422 consent_notice_not_configured`. The hotel's notice text itself is outside HospAI. The advisor confirms it (go-live checklist).

Both are saved through the existing `put_org_guest_settings` and are read by pms-core, so no control persists without effect.

### 3.5 PropertyDO migration 45 (`PROPERTY_SCHEMA_HEAD` 44 → 45)

`ALTER TABLE reservation ADD COLUMN id_document_on_file INTEGER NOT NULL DEFAULT 0;` holds no PII. `scripts/property-ddl.mjs` and the generated SQL follow the existing pattern.

## 4. Commands

Four new commands are added to `COMMAND_CATALOG` (111 → 115). All four are INTERACTIVE, `pms.core`, kill-switch on, run on OrgDO and are audit writers (`AUDIT_WRITER_COMMAND_IDS` +4 if OrgDO commands are in that list. Mirror how `guests.update` is or is not listed; do not invent a new audit table).

| Command id | RPC | Does |
|---|---|---|
| `guests.add_document` | `tryAddGuestDocument` | validates §3.2, encrypts, inserts the row, emits `guest.document_recorded {orgId, guestRef, propertyId, documentId}` |
| `guests.attach_document_scan` | `tryAttachGuestDocumentScan` | checks bytes (§5.2), encrypts, puts to R2, sets the scan columns. It replaces an earlier scan and deletes the old object after the put |
| `guests.remove_document` | `tryRemoveGuestDocument` | requires a reason (1–200 chars), tombstones the row, deletes the R2 object, emits `guest.document_removed {orgId, guestRef, propertyId, documentId}` |
| `guests.update_consent` | `tryUpdateGuestConsent` | appends a consent row, `{purpose, status, source}`, with the notice version stamped from settings |

- Every command checks that the guest exists, is not erased and is linked to the URL property (`isGuestLinkedToPropertySync`). A miss → `404 not_found` with no foreign data.
- Document commands also check that `document.property_id === urlPropertyId`. A miss → `404 not_found`.
- `AADHAAR` + scan → `422 aadhaar_scan_not_allowed`.
- **The R2 put and delete happen outside `transactionSync`.** The order for attach is:
  1. Validate and read the row in a sync read.
  2. Encrypt.
  3. `await put`.
  4. Run a `transactionSync` that sets the columns, with an idempotency check on the key.
  5. Delete the previous object if there was one.

  If step 4 finds the row removed in the meantime, it deletes the new object and returns `not_found`. Remove tombstones in a transaction, then deletes the object. A failed delete is logged and retried by the purge plan's sweep (§8), never thrown to the clerk.
- Idempotency is `{commandId, payload}`, keyed per user, through the OrgDO's existing idempotency path for guest writes. For the scan, the payload hashed is `{documentId, contentType, sha256(bytes)}`.
- New event types are added to the event contract (`assertEventContract`, forbidden-PII keys unchanged). Payloads hold ids only.

## 5. HTTP routes

There are eight new routes, all on `/v1/properties/:propertyId/guests/:guestRef/…`. `V1_HTTP_ROUTE_AUDIT` goes from 179 to 187; the last id is `post_guest_consent`. Each route calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` and goes through `dispatchV1` only.

| Route id | Method + path | Permission | Notes |
|---|---|---|---|
| `get_guest_documents` | `GET …/documents` | `guests:read` | **No decrypt.** Live rows at this property: `{id, kind, hasScan, scanContentType, createdAt}`. Removed rows are omitted. |
| `get_guest_document` | `GET …/documents/:documentId` | `guests:read` | Decrypts, writes one `read` access row, returns `{id, kind, fields, hasScan, createdAt}` |
| `post_guest_documents` | `POST …/documents` | `guests:write` | JSON `{documentId, kind, fields, idempotencyKey}` |
| `put_guest_document_scan` | `PUT …/documents/:documentId/scan` | `guests:write` | Raw body, `Content-Type` header, header `x-idempotency-key` |
| `get_guest_document_scan` | `GET …/documents/:documentId/scan` | `guests:read` | Decrypts, writes one `scan_read` access row, streams the bytes |
| `post_guest_document_remove` | `POST …/documents/:documentId/remove` | `guests:write` | JSON `{reason, idempotencyKey}` |
| `get_guest_consent` | `GET …/consent` | `guests:read` | `{current: {purpose → {status, noticeVersion, source, recordedAt} or null}, history: last 50 rows}`. No decrypt needed. |
| `post_guest_consent` | `POST …/consent` | `guests:write` | JSON `{purpose, status, source, idempotencyKey}` |

### 5.1 JSON routes

- They use the shared parse helper.
- They follow the same JSON `idempotencyKey` convention as `post_guests`; check which one that route uses and match it.
- New domain errors go in the one `commandErrorHttpStatus` table, all 422:
  - `aadhaar_full_number_not_allowed`
  - `aadhaar_scan_not_allowed`
  - `consent_notice_not_configured`
  - `id_document_required`
  - `scan_type_not_allowed`
  - `limit_exceeded` exists already.

### 5.2 Scan upload

- **Cap 5 MiB.** Read `Content-Length` first, then count while reading the body. Over the cap → `422 limit_exceeded`, with no partial write.
- Allowed types are `image/jpeg`, `image/png` and `application/pdf`. **The magic bytes must match the declared type.** Otherwise → `422 scan_type_not_allowed`.
- The bytes are passed to OrgDO over RPC as an `ArrayBuffer`. The Worker never touches the key.

### 5.3 Scan download

- Goes through the single security-header helper.
- Sets `Content-Type` from the row, `Content-Disposition: attachment; filename="document-{documentId}.{ext}"` (no guest name), `Cache-Control: no-store` and `nosniff`.
- The SPA fetches it through client-core with Bearer and shows images from a `blob:` URL. **Add `img-src 'self' blob:` to the CSP** in `security-headers.ts`, and change nothing else in that policy. PDFs download; they are never framed.

## 6. Check-in gate (Require ID at check-in)

1. `tryCheckIn` reads `guest_ref` from the reservation with a plain sync read, before the transaction.
2. It awaits OrgDO `checkInIdentityGate({ guestRef, propertyId })`, using the same `gateOrgRef` transport pattern as `gateGuestRef`. The gate returns `{ required: boolean, hasDocument: boolean }`.
   - `required` is `requireIdAtCheckIn`.
   - `hasDocument` means at least one live document at that property for that guest.
3. If OrgDO is unreachable → `org_unreachable` (existing code and status). **It fails closed even when the setting is off.** The gate answer is also needed for D9, and a check-in must not silently skip a policy it could not read.
4. If `required && !hasDocument` → `id_document_required` (422), and nothing changes.
5. Inside `transactionSync`, the check-in sets `reservation.id_document_on_file = hasDocument ? 1 : 0`, along with the existing writes.

- Every path that checks a guest in goes through `tryCheckIn`, including queue replay and walk-in, if walk-in calls it. Find every caller and confirm none bypasses it.
- A reservation with no `guest_ref` (if that state exists) is treated as `hasDocument: false`.

## 7. Keeping `id_document_on_file` current (queue consumer)

A new core consumer, `pms.guest_document_flag`, is added to `CORE_CONSUMERS` and `CONSUMER_HANDLERS`:
- Entitlement `pms.core`, no gate exemption.
- It consumes `guest.document_recorded` and `guest.document_removed`.

The handler **reads current state**, not the event:
1. Call OrgDO `checkInIdentityGate` for `{guestRef, propertyId}`. Use only `hasDocument`.
2. Call PropertyDO `trySetIdDocumentFlag({ guestRef, hasDocument, consumerIdempotencyKey })`. It sets the bit on that guest's reservations in `pending`, `confirmed` and `checked_in`, through `runIdempotent` with `consumerIdempotencyKey(consumerId, eventId)`.

Replaying it is harmless. Order does not matter, because each run writes the state as it is now.

## 8. Night audit and purge

### 8.1 Night audit

- Add `id_proof_missing` to `NIGHT_AUDIT_CHECK_IDS`, the strict schema and `NIGHT_AUDIT_CHECKS_DEFAULT` (`'warn'`).
- `countNightAuditCheckSync` counts reservations `checked_in` at the property with `id_document_on_file = 0`.
- The preview label is "In-house guests with no ID document recorded".
- `NIGHT_AUDIT_STEPS` is unchanged. Settings → Night audit shows the new check row wherever the other five are listed.
- Country and state counts stay out (no PII in PropertyDO).

### 8.2 Purge

The guest plan in `purge-workflow.ts` gains one step, `org-do-guest-documents`, after `clear-guest-blobs`:
1. Delete every R2 object named in that guest's `guest_document` rows, live and removed, across all properties. Count them.
2. Delete the `guest_document` and `guest_consent` rows. **Keep `guest_document_access`.**

The certificate gains a store entry for the documents. Use the event-log R2 spec's suggestion and add a distinct store value `r2_guest_documents`, with `{status: 'reached', deleted: n}` or `skipped` when n = 0. The existing `r2` entry stays `retained` / `pii_by_reference_event_log`.

The `org_do` entry's note says the document access log was kept without PII. Update `purge-certificate-columns.ts`, the certificate store enum, `check:purge` and the purge specs to match.

A halt mid-step still writes a certificate (existing behaviour).

## 9. Operator SPA

All screens use the ui-kit only, with no raw controls and no inline styles. They use `classifiedUserMessage` and `Alert` for results.

### 9.1 Guest 360 (`GuestProfileScreen`)

It gains three panels:
- **Identity documents.**
  - A `DataTable` of kind, recorded date and scan yes/no, from the no-decrypt list.
  - **View** opens the audited read in a `Dialog`. It shows the fields, plus the scan image for an image scan or a Download button for a PDF.
  - **Add document** opens a `Dialog` with a kind select, the kind's fields from §3.2 and an optional scan file input. The file input comes from ui-kit if one exists; if not, add a kit `FileInput` wrapper in `packages/ui-kit`, not a raw `<input>` in web-pms.
  - For `AADHAAR`, the form shows only "Last 4 digits" and no file input, with a one-line note that Aadhaar is recorded masked.
  - **Remove** is `intent="destructive"` and asks for confirmation with a required reason.
- **Preferences.** Grouped checkboxes for the four code lists, plus *Other*. Save goes through the existing guest PATCH mutation.
- **Consent.**
  - One row per purpose shows its current status, notice version and date. Grant and Withdraw open a `Dialog` with a source select. Withdrawal takes the same number of clicks as granting.
  - While `consentNoticeVersion` is unset, the panel shows an `Alert` that links to Settings → Guests and disables the actions.
  - Below the rows, a history list.

### 9.2 Stay card (`ReservationStayScreen` / `StayCard`)

The stay card shows the guest's preferences as `Badge`s with labels and an "ID on file" / "No ID on file" `Badge`. Both come from the no-decrypt list; they do not decrypt the document.

### 9.3 Check-in (`CheckInScreen`)

- It shows the same preferences and the ID-on-file state, plus a **Record ID** button that opens the same add-document `Dialog`.
- When `requireIdAtCheckIn` is on and no document is on file, **Check in is disabled with the reason shown**, until one is recorded.
- A server `id_document_required` maps to the same message.

### 9.4 Book (`BookingScreen`, Find existing)

- After a match is **selected**, it fetches the documents list, then the audited read of the most recent live document and, if it has an image scan, the scan. It shows a compact identity summary: kind, masked number, expiry and photo.
- Search results themselves never decrypt documents. Equality blind-index search is unchanged.

### 9.5 Settings → Guests

Settings → Guests shows **Require ID at check-in** (switch) and **Consent notice version** (text field). R1.17's hidden-control note is removed.

### 9.6 Cache keys and data handling

- Query keys include the tenant and the params:
  - `['guest-documents', propertyId, guestRef]`
  - `['guest-document', propertyId, guestRef, documentId]` (`gcTime: 0`)
  - `['guest-document-scan', propertyId, guestRef, documentId]` (`gcTime: 0`; revoke the object URL on unmount)
  - `['guest-consent', propertyId, guestRef]`
- Mutations invalidate the exact keys their consumers use, including the stay card's and check-in's. Tests assert the keys.
- No `fetch` in components. API calls live in `client-core`.

## 10. Tests

### pms-core / OrgDO

1. **Two properties, same org** (AGENTS §5). The guest is linked to both. A document recorded at B:
   - is absent from A's list;
   - A's GET, scan GET and remove return 404 with no foreign data;
   - B's list has it.
2. A document read and a scan read each write exactly one access row with the actor. A list writes none.
3. Aadhaar:
   - a 12-digit `number` → `aadhaar_full_number_not_allowed`;
   - a scan → `aadhaar_scan_not_allowed`;
   - `numberLast4: "1234"` is accepted, and the decrypted read returns only the last 4.
4. Scan:
   - over 5 MiB → 422, with no R2 object and no column change;
   - PNG bytes declared as PDF → `scan_type_not_allowed`;
   - a replaced scan deletes the old object;
   - removing a document deletes its object.
5. Idempotency: the same key and payload on add returns the first result. The same key with another payload → the existing conflict code. The fingerprint includes the command id.
6. Consent:
   - with the notice version unset → `consent_notice_not_configured`;
   - grant, then withdraw → current is WITHDRAWN, history has both rows, and the notice version is stamped from settings even when the client sends one (it is ignored or rejected by the strict schema; choose reject);
   - the strict schema rejects unknown purposes.
7. Preferences: PATCH with codes round-trips. An unknown code → 422. Over the cap → `limit_exceeded`. `notes` is unchanged by a preferences PATCH. No preference value appears in any outbox event.
8. Check-in:
   - setting on and no document → `id_document_required`, with `sold`, status and folio unchanged;
   - setting on and a document at this property → checks in with `id_document_on_file = 1`;
   - a document only at another property → refused;
   - setting off → checks in with the flag 0;
   - OrgDO unreachable (stub the transport) → `org_unreachable` and nothing changes.
9. Consumer: adding a document to an in-house guest sets the flag via `pms.guest_document_flag`. Removing it clears the flag. A duplicate delivery writes once.
10. Night audit: `id_proof_missing` counts checked-in reservations with flag 0, and its severity is configurable like the other five.
11. Purge:
    - an erased guest with two documents with scans (one at each property) and consent rows → after the plan, the R2 objects are gone, the document and consent rows are gone and the access rows remain;
    - the certificate has `r2_guest_documents` reached, `deleted: 2`, and the `r2` event-log entry is still `retained`.
12. Event contract: the new event types pass `assertEventContract`, and a payload with a name key is rejected.

### web-pms

- Panels render the three states: empty, error and data.
- The Aadhaar form hides number and scan.
- Remove requires a reason.
- Check in is disabled with the reason when ID is required and missing.
- Cache keys are asserted for every mutation (AGENTS §5).
- Settings → Guests saves the two new keys.

### contracts / do-runtime

- Schemas cover the new fields.
- The pins are updated (§11).
- The migrate tests run at heads 12 (org) and 45 (property).

## 11. Pins and docs (same change-set)

- `COMMAND_CATALOG` **115**.
- `V1_HTTP_ROUTE_AUDIT` **187**, last id **`post_guest_consent`**.
- `PROPERTY_SCHEMA_HEAD` **45**.
- `ORG_SCHEMA_HEAD` **12**.
- `AUDIT_WRITER_COMMAND_IDS` as §4 decides.
- `NIGHT_AUDIT_CHECK_IDS` length 6.
- Update the AGENTS.md pins table, and `scripts/permissions-check.mjs` must still match.
- Wrangler: `GUEST_DOCS_R2` → bucket `hospai-guest-docs`, staging `hospai-guest-docs-staging`. **Ops creates both buckets** before the next deploy (`wrangler r2 bucket create … --env staging`). Locally, wrangler simulates R2.
- Amend the leftover lines of the guest CRM directory spec, the Settings → Guests spec and the night audit operator job spec (§ header).

## 12. Out of scope

- OCR, ID scan extraction, document verification services, Aadhaar offline verification (QR or app): a later slice if the client asks.
- `guests.merge`.
- Additional named guests on a stay (F4: only R6.2's Form C person record).
- Stay flags for early check-in, late checkout and airport transfer (client Q20, unanswered).
- A UI for the document access log (the rows exist; reporting is R4.14 or ops).
- Any sender reading consent (R5.2).
- Expiry warnings beyond showing the date.
