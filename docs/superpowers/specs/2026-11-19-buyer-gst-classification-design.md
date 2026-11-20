# Buyer GST details and tax classification (R4.22)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.22 (Track P). Pilot checklist: *GST / e-invoice QR on invoices* (the buyer and classification half; IRN and QR are R5.5).
**Depends:** R3.6 (configurable tax engine), R4.15 (encrypted guest fields on OrgDO), R1.12 (financial-year series). City ledger ships.
**Sources:**
- ARCHITECTURE.md §4.8 (financial records survive erasure, pseudonymized) and §7.9 requirement 9 (buyer snapshot and line classification).
- [Invoice generation engine](./2026-08-15-invoice-generation-engine-design.md): Lock 3 (the snapshot keeps refs only, no plaintext name) and the FY series.
- [Configurable tax engine](./2026-11-18-configurable-tax-engine-design.md) §2.4 (registrations: length and charset only), which defers place of supply and HSN/SAC to here.
- [Guest documents and consent](./2026-11-19-guest-documents-consent-design.md): the encryption and property-scoping patterns.
- [Products catalog](./2026-10-28-products-catalog-design.md): a product's tax group **is** its charge code's `tax_group` (the single carrier).
- The BluePMS Tax & Compliance inventory: Buyer Tax Identity And Source Documents, Tax Master And Classification, Statutory Document Output.

**Amends:**
- The invoice engine spec: Lock 3 gains snapshot `schemaVersion: 2`, and the FY-series note "no GSTIN column in Phase 1" is replaced by §3.1.
- The tax engine spec §2.4: a registration labelled `GSTIN` is now format- and checksum-checked.

---

## 1. Why

An Indian tax invoice to a registered business must show the buyer's GSTIN, name and address. Every line must show its HSN/SAC. R5.5 cannot request an IRN without them.

None of these exist today:
- The invoice holds `guestRef` / `piiKeyId` and nothing about the buyer.
- `city_ledger_account` has only a name, credit limit and terms.
- HSN/SAC appears nowhere in code.
- No GSTIN is ever validated.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **One GSTIN validator** in contracts. It checks format, the state-code prefix (the official list) and the mod-36 check digit. Every GSTIN input uses it: seller, company, guest and invoice. |
| D2 | **Seller GSTIN** is the R3.6 registration whose label is `GSTIN` (case-insensitive). There can be at most one, and it must pass D1 at config write (`422 invalid_gstin`). The seller's state code is its first two digits. No new config key. |
| D3 | **Company buyer details** are plaintext columns on `city_ledger_account`. They are business data, edited through the existing create and update commands. |
| D4 | **Individual guest buyer details** are a `gstBuyer` block inside the encrypted OrgDO profile blob, edited through the existing `guests.update`. Property-scoped reads apply unchanged. |
| D5 | `invoice.generate` takes an optional `buyer`. The SPA prefills it from the company account or the guest profile, and the clerk can edit it. The server validates it. **No buyer** keeps today's behaviour: an unregistered buyer with no details. |
| D6 | **Where the snapshot lives depends on the buyer type.** A **REGISTERED** buyer (has a GSTIN) is business identity. It goes in plaintext in the R2 invoice snapshot and on `invoice_generation`. A GSTIN and its legal name are on the public GST register. An **UNREGISTERED individual** with any details is encrypted in OrgDO, keyed by a snapshot id the invoice references. The R2 snapshot then holds only `{party: 'INDIVIDUAL', buyerSnapshotId}`. The advisor confirms the line (go-live checklist). |
| D7 | **An individual's snapshot is kept on guest erasure.** It is encrypted under a new **org legal-retention key**, HKDF info `hospai/v1/org-legal/${orgId}`, key version 1. GST law requires invoices to be kept, and DPDP allows retention a law requires. The purge certificate records it as `retained` with reason `tax_invoice_retention` and a count. An org purge deletes it. The advisor confirms (the roadmap names this question). |
| D8 | **Place of supply** for accommodation is the property's location. It is stamped from the seller's state code and **is not editable** in this slice, because changing it would mean IGST in place of CGST + SGST on lines already posted. A different place of supply waits on the advisor's answer. |
| D9 | **HSN/SAC is an attribute of the product class (`tax_group`).** The new DOMAIN key `pms.tax.classification` maps `{[taxGroup]: hsnSac}`. It is read inside the generate transaction and frozen onto each snapshot line. Products and charge codes carry no copy. |
| D10 | Issued invoices **never change**. Later edits to the account, profile or classification affect only new invoices. Correcting a buyer means void and regenerate (existing commands; the voided number is not reused). |

## 3. Data model

### 3.1 Contracts

**`packages/contracts/src/gstin.ts`:**
- `GST_STATE_CODES`: the code → name list (01–38 and 97) with a source comment.
- `gstinProblem(s): null | 'format' | 'state_code' | 'checksum'`:
  - Normalise to uppercase and trim first.
  - Format: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`.
  - Checksum: GSTN mod-36 over the first 14 characters, with alphabet `0-9A-Z` and alternating weights 1 and 2. The product is folded as `floor(p/36) + p%36`. The check digit is `(36 - sum % 36) % 36`.
  - Test fixtures are generated by the algorithm, plus one known-bad check digit.
- `gstinStateCode(gstin)`.

**`GstBuyerFields`:**

| Field | Rule |
|---|---|
| `gstin` | required for REGISTERED, forbidden for UNREGISTERED; D1 |
| `legalName` | required for REGISTERED; 1–100 characters |
| `tradeName` | optional; ≤ 100 |
| `address` | ≤ 200 |
| `city` | ≤ 60 |
| `state` | ≤ 60 |
| `pin` | `^[1-9][0-9]{5}$` |
| `stateCode` | a key of `GST_STATE_CODES`; for REGISTERED it must equal `gstinStateCode(gstin)` (`422 buyer_state_code_mismatch`) |

- The schema is strict: unknown keys give 422 and over-long fields give 422.
- `InvoiceBuyerInput = { type: 'REGISTERED' | 'UNREGISTERED', fields: GstBuyerFields }`. An UNREGISTERED buyer with every field empty is the same as no buyer.
- `HSN_SAC_PATTERN = ^[0-9]{4}([0-9]{2}([0-9]{2})?)?$`, for 4, 6 or 8 digits.

### 3.2 PropertyDO migration (next head after R4.15; expected 46)

```sql
ALTER TABLE city_ledger_account ADD COLUMN gstin TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_legal_name TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_trade_name TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_address TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_city TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_state TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_pin TEXT;
ALTER TABLE city_ledger_account ADD COLUMN gst_state_code TEXT;

ALTER TABLE invoice_generation ADD COLUMN buyer_type TEXT;            -- NULL (none) | REGISTERED | UNREGISTERED
ALTER TABLE invoice_generation ADD COLUMN buyer_gstin TEXT;           -- REGISTERED only
ALTER TABLE invoice_generation ADD COLUMN buyer_snapshot_id TEXT;     -- UNREGISTERED with details only
ALTER TABLE invoice_generation ADD COLUMN place_of_supply_state_code TEXT;
```

`buyer_gstin` is what R5.5's queue selects on. A REGISTERED row with a NULL `buyer_gstin` cannot be written: a CHECK, or a guard in the insert path if SQLite `ALTER` cannot add the CHECK. Test it either way.

### 3.3 OrgDO migration (next head after R4.15; expected 13)

```sql
CREATE TABLE invoice_buyer_snapshot (
  id TEXT PRIMARY KEY,                -- buyerSnapshotId
  property_id TEXT NOT NULL,
  guest_ref TEXT,                     -- when prefilled from a profile; for the certificate count
  cipher BLOB NOT NULL,               -- AES-GCM under the org legal-retention key; AAD = orgId || ':' || id
  iv BLOB NOT NULL,
  key_version INTEGER NOT NULL,       -- 1
  fields_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
```

The org legal-retention key is derived in `packages/crypto-shredding/src/org-derive.ts` next to the wrap and blind keys. It uses the same master secret, the same zero salt and the info string from D7, and it is versioned.

### 3.4 Guest profile

`GuestProfile.gstBuyer?: GstBuyerFields & { gstin?: string }` sits in the encrypted blob:
- `null` clears it, and an omitted key leaves it unchanged.
- It is validated with the same schema, minus the REGISTERED-only requirements.
- It never goes on the bus.

### 3.5 Classification config

`pms.tax.classification` is a DOMAIN key:
- Its value is a strict record `{ [taxGroup: string]: hsnSac }`, at most 50 entries.
- Keys follow the `tax_group` charset, and values follow `HSN_SAC_PATTERN`.
- The default is `{}`.
- It is read inside `tryGenerateInvoice`'s transaction (ARCHITECTURE §5.1). It is never read from KV.

## 4. Invoice generation

`post_invoices` body gains an optional `buyer: InvoiceBuyerInput`. The handler follows these steps:

1. **Parse once and validate** with the strict schema. A REGISTERED buyer without a valid GSTIN → `422 buyer_gstin_required` or `invalid_gstin`.
2. **UNREGISTERED with details:**
   - The handler sets `buyerSnapshotId = uuidv5-or-sha256(userId + ':' + idempotencyKey)`, so a retry reuses it.
   - It calls OrgDO `sealInvoiceBuyerSnapshot({ id, propertyId, guestRef?, fields })`. The call is idempotent: the same id with the same `fields_sha256` returns ok, and the same id with a different hash returns the existing conflict code.
   - `resolvePropertyContext` and the org match have already run. OrgDO unreachable → `org_unreachable`, and no invoice is generated.
3. **Build the object sent to the DO:**
   - REGISTERED: `{ type, party: 'BUSINESS', fields }` (plaintext).
   - UNREGISTERED with details: `{ type, party: 'INDIVIDUAL', buyerSnapshotId, fieldsSha256 }`.
   - Otherwise it is omitted.

   **The fingerprint is `{commandId: 'invoice.generate', payload: {reservationId, folioWindowId, buyer}}` over that same object.**
4. `tryGenerateInvoice` reads the following inside the transaction:
   - the seller GSTIN from the registrations (D2), which may be absent; an absent GSTIN with a REGISTERED buyer is still allowed, but the SPA warns;
   - `pms.tax.classification`.

   It writes the new `invoice_generation` columns and snapshot v2 (§4.1).
5. An orphan OrgDO snapshot (step 2 succeeded, step 4 failed) is harmless. It is encrypted, keyed by a retry-stable id and deleted at org purge. No sweeper in this slice.

**Auto-generation at checkout** (`generatedBy: 'checkout'`):
- A COMPANY window whose `billed_party` resolves to a city-ledger account with a valid `gstin` gets that account's details as a REGISTERED buyer automatically. It is plaintext, already in PropertyDO.
- A GUEST window gets no buyer. If the guest's profile has a GSTIN, the desk voids and regenerates with the buyer. The SPA's checkout summary says so when the profile has `gstBuyer`.

### 4.1 Snapshot `schemaVersion: 2`

These fields are added to v1:

| Field | Value |
|---|---|
| `seller` | `{ gstin: string \| null, stateCode: string \| null }` |
| `placeOfSupplyStateCode` | the seller's state code, or null (D8) |
| `buyer` | `null` \| `{ type: 'REGISTERED', party: 'BUSINESS', gstin, legalName, tradeName?, address?, city?, state?, pin?, stateCode }` \| `{ type: 'UNREGISTERED', party: 'INDIVIDUAL', buyerSnapshotId }` |
| `lines[].hsnSac` | `classification[chargeCode.tax_group] ?? null`; tax lines take their parent's |

- `guestRef` and `piiKeyId` stay as they are.
- **No individual's plaintext ever enters the R2 snapshot.**
- Readers accept v1 and v2.

### 4.2 Reading an individual's snapshot

A new route, `get_invoice_buyer`:
- `GET /v1/properties/:propertyId/invoices/:invoiceId/buyer`, permission `folio:read`, entitlement `pms.core`.
- It resolves the invoice in PropertyDO. A miss → 404.
- REGISTERED: it returns the business block from the snapshot. UNREGISTERED with a snapshot id: it calls OrgDO `readInvoiceBuyerSnapshot({id, propertyId})`. A `property_id` mismatch → 404 with no foreign data. It returns the fields.
- `V1_HTTP_ROUTE_AUDIT` +1. It is the **last id**.

## 5. City ledger and guest edits

- **City ledger:**
  - `city_ledger.create_account` and `update_account` take optional `gst: GstBuyerFields`, with the REGISTERED rules when `gstin` is present. `gst: null` on update clears them.
  - **The fingerprints of both routes are widened** from the trimmed name to `{commandId, payload}` over the exact object sent (AGENTS §1). An existing test that pins the old fingerprint changes; say which.
  - `get_city_ledger_accounts` returns the `gst` block.
- **Guests:** the PATCH guest route and `guests.update` accept `gstBuyer`. Reads return it through the existing property-scoped `get_guest`.
- **Settings → Tax** (`pms.tax.registrations` write):
  - A row labelled `GSTIN` must pass D1, and there can be at most one; otherwise → `422 invalid_gstin`.
  - Other labels keep the R3.6 charset rule.

Error codes, all 422, go in the one `commandErrorHttpStatus` table:
- `invalid_gstin`
- `buyer_gstin_required`
- `buyer_state_code_mismatch`
- `invalid_hsn_sac`

## 6. Purge

- **Guest plan:** the `org_do` store entry gains a note. Count the `invoice_buyer_snapshot` rows whose `guest_ref` is the subject, and record `retained`, `reason: 'tax_invoice_retention'` and `count`, in the same style as the other stores' entries.
  - If the certificate shape allows only one status per store, add a distinct store value `org_do_tax_invoice_buyer`, the same way R4.15 added `r2_guest_documents`.
  - Erasure does not delete these rows.
- **Org purge:** delete every `invoice_buyer_snapshot` row. The org DO's purge inventory lists the table.
- Update `purge-certificate-columns.ts`, `check:purge` and the purge spec to match.

## 7. Operator SPA

All screens use the ui-kit only and `classifiedUserMessage`. Mutation results use `Alert`.

### 7.1 Folio

The **Generate invoice** action opens a `Dialog`:
- A **Buyer** type select: *Unregistered* (default) or *Registered business*.
- Fields per §3.1, prefilled from the COMPANY window's account, or else from the guest's `gstBuyer`. The source is shown as a one-line note, and every field is editable.
- GSTIN is validated as the clerk types, with the same validator. The state code is derived from the GSTIN and is read-only for REGISTERED.
- A warning `Alert` shows when a REGISTERED buyer is picked and the hotel has no seller GSTIN, linking to Settings → Tax.
- A warning `Alert` shows for an UNREGISTERED buyer with no name and address when the invoice total in INR is ₹50,000 or more. Rule 46 requires them; this is a warning, and the advisor confirms the threshold. The threshold constant lives in contracts with that comment.

**Invoice view:**
- The seller GSTIN and place of supply.
- The buyer block. For an INDIVIDUAL, it is fetched through `get_invoice_buyer`.
- HSN/SAC per line.
- A v1 invoice shows "No buyer details (issued before buyer capture)".

### 7.2 City ledger account

The account screen gets a **GST details** card, with an edit `Dialog` on the same fields.

### 7.3 Guest 360

The guest profile gets a **GST details** panel, edited through the existing PATCH.

### 7.4 Settings → Tax

- An **HSN/SAC** column per product group (`tax_group`) used by charge codes. It saves `pms.tax.classification`.
- An inline error when a `GSTIN` registration is invalid.

### 7.5 Cache keys and data fetching

- Query keys include the tenant and the params. Mutations invalidate the consumer keys exactly:
  - account list and detail;
  - guest;
  - folio and invoice;
  - `['invoice-buyer', propertyId, invoiceId]`.
- Tests assert them.
- There is no `fetch` in components.

## 8. Tests

- **contracts:**
  - GSTIN valid, bad format, bad state code and bad checksum;
  - state code derivation;
  - HSN/SAC pattern;
  - the strict buyer schema with REGISTERED and UNREGISTERED rules.
- **Editing after issue:** issue an invoice to a company, then edit the account's GST name. The issued invoice's snapshot, columns and `get_invoice_buyer` are unchanged.
- **Same for an individual:** edit `gstBuyer` after issue. The OrgDO snapshot is unchanged.
- **Two properties, same org** (AGENTS §5):
  - hotel A cannot read hotel B's guest `gstBuyer` (the existing scope);
  - hotel A's `get_invoice_buyer` on hotel B's invoice id gives 404;
  - an OrgDO snapshot with B's `property_id` read with A's id gives 404.
- **Validation:**
  - an invalid GSTIN is refused on account create, guest PATCH, invoice buyer and seller registration;
  - a REGISTERED buyer with no GSTIN gives `buyer_gstin_required`, and no row exists with `buyer_type = 'REGISTERED' AND buyer_gstin IS NULL` (that is R5.5's guard).
- **Fingerprint:**
  - the same key with a different buyer gives the idempotency conflict;
  - the same key with the same buyer replays;
  - the hashed object equals the object the DO received (spy on the stub);
  - the city-ledger create fingerprint now includes the payload.
- **Checkout auto-invoice:** a COMPANY window with a GSTIN on the account gets a REGISTERED buyer, and a GUEST window gets none.
- **Classification:**
  - a ROOM line prints `classification.ROOM`, and its tax lines take it too;
  - a group without a mapping gives `null`;
  - changing the map after issue does not change the issued invoice.
- **Purge:**
  - guest erasure keeps the individual's buyer snapshot, and the certificate records `retained` / `tax_invoice_retention` / count 1;
  - an org purge deletes it.
- **No PII on the bus:** the `invoice.generated` payload has no buyer fields.
- **web-pms:**
  - the dialog prefills from the account and the profile;
  - the Registered option requires a GSTIN;
  - both warnings show;
  - v1 and v2 invoice views render;
  - cache keys are asserted.

## 9. Pins and docs (same change-set)

- `COMMAND_CATALOG`: no new command; the count is unchanged from R4.15.
- `V1_HTTP_ROUTE_AUDIT`: +1, last id **`get_invoice_buyer`**.
- `PROPERTY_SCHEMA_HEAD` +1 and `ORG_SCHEMA_HEAD` +1 from R4.15's values.
- Config register: `pms.tax.classification` (DOMAIN).
- Update the AGENTS.md pins table.
- Amend the invoice engine spec (Lock 3 v2; the FY note) and the tax engine spec §2.4.
- Update ARCHITECTURE.md §7.9 requirement 9 with one sentence pointing here.

## 10. Out of scope

- IRN and QR, and the e-invoice queue (R5.5).
- Provider GSTIN lookup (client Q14).
- GST returns and registers.
- Buyer details on a POS bill (R4.21).
- A place of supply other than the property's state (D8, pending the advisor).
- A proforma (R4.13 will read the same classification and buyer).
- A per-GSTIN invoice series: two properties sharing a GSTIN still use different prefixes; R1.12's note stays.
