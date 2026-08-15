# Invoice generation engine

**Tree verified 2026-08-15 (post promo codes close `92bf6ba`):** `COMMAND_CATALOG` length **84** (`register.test.ts` ~706), `AUDIT_WRITER_COMMAND_IDS.size === 59` (`register.test.ts` ~269 and ~705), `V1_HTTP_ROUTE_AUDIT[137].id === 'delete_rate_promo'` (`register.test.ts` ~697–703; `v1-http-routes.ts` ~814–819), `[133] post_folio_reconcile_payment` (~670–676), `[132] delete_room` (~663–668), `PROPERTY_SCHEMA_HEAD === 31` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~631–632), `PROPERTY_MIGRATIONS` tail v31 `promo_codes` ~1224–1228 (`property-migrations.ts`), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1128–1137), `PLATFORM_GAPS === []` (`register.test.ts` ~707), catalog last entry `rates.archive_promo` ~930–939 (`catalog.ts`), `pms.invoice.*` config keys ~332–350 (`register.ts`), `tryCheckOut` ~8830–8998 (`property-do.ts`), `readFolio` ~17676+ (`property-do.ts`), `night_audit_report` + `putReportObject` R2 pattern ~3431–3445 / v19 DDL ~563–570 (`property-migrations.ts`), `EVENT_LOG_R2` binding (`wrangler.jsonc`), `guestFolioWindowId` ~13517 (`property-do.ts`), ARCHITECTURE §4.6 degraded invoice ban ~585, §4.7 R2 invoices ~597, §16.1 invoice numbering ~2160.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** ARCHITECTURE.md §4.6 (~585), §4.7 (~597), §16.1 (~2160); [folio money operations](./2026-08-12-folio-money-operations-design.md); [domain config register](./2026-07-27-domain-config-register-design.md) (`pms.invoice.*`); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (R2 snapshot index pattern); [event log R2](./2026-08-12-event-log-r2-design.md); [promo codes](./2026-08-15-promo-codes-design.md) (spec template); `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `packages/contracts/src/config/register.ts`; `apps/web-pms/src/screens/FolioScreen.tsx`.

**Closes:** Phase 1 leftover **10** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~40): invoice generation engine (R2 + existing numbering config). ARCHITECTURE §16.1: “Invoice numbering and templates” config exists; “the generation engine is still owed.”

**Amends:** None. Bidirectional one-sentence pointers in folio-money / property-setup specs are the **final implementation task**, not this spec writer’s job.

---

## Executive summary

Ship a property-local **invoice generation engine** that freezes folio lines, tax, and totals into an immutable JSON snapshot stored in **R2** (`EVENT_LOG_R2`), indexed in a new **`invoice`** SQLite table (schema **v32**), with monotonic per-property numbering from existing `pms.invoice.*` config. Two new commands — `invoice.generate` (idempotent, `FAIL_CLOSED`) and `invoice.void` (audited) — and three HTTP routes expose manual desk generation and read-back. **MVP** is manual via a Folio screen button; **auto-generate on checkout** is wired inline inside `tryCheckOut` when `pms.invoice.gen_mode === 'Automatically'` (checkout halts on failure). An event consumer on `reservation.status_changed → checked_out` is **Task 4 stretch** only. No PDF worker; client renders HTML from JSON. Credit notes, city ledger, and logo upload remain out.

---

## 1. Context & motivation

### 1.1 Problem statement

Hotels need a **fiscal document** at checkout: line items, tax breakdown, and totals that **do not change** when folio lines are adjusted later. Today:

| Piece | Where (verified) |
|---|---|
| Invoice numbering / presentation config | `pms.invoice.prefix`, `starting_idx`, `suffix`, `title`, show flags, `gen_mode`, `allow_pending`, etc. (`register.ts` ~332–350) |
| Folio OLTP + tax lines | `folio_line`, `readFolio` (~17676+), TAX via `tax_of` |
| R2 binding for immutable bodies | `EVENT_LOG_R2` (night-audit reports, event log) |
| Checkout | `tryCheckOut` (~8830) — balance gate, status → `checked_out`, optional window close |
| Registration card (not invoice) | [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) §5 |

**Missing:** no `invoice` table, no R2 writer, no `invoice.generate` command, no desk surface, no checkout coupling. Post-checkout folio edits would otherwise rewrite “the invoice” at read time — violating audit (ARCHITECTURE ~1338).

### 1.2 What already exists (verified — do not re-spec)

| Piece | Where |
|---|---|
| Folio read model (lines, windows, balances) | `readFolio` ~17676 |
| GUEST window id | `guestFolioWindowId` → `` `${reservationId}:GUEST` `` ~13517 |
| Night-audit R2 put + sha256 + SQLite index | `putReportObject` ~3431; `night_audit_report` v19 ~563 |
| Config-driven numbering fields | `pms.invoice.prefix` (default `INV-`), `starting_idx` (default `1`), `suffix` |
| Degraded ban on issuing invoices | ARCHITECTURE §4.6 ~585 |
| Promo-priced snapshots in folio ROOM lines | [promo codes](./2026-08-15-promo-codes-design.md) — invoice copies posted folio lines as-is |

**Heads (frozen — this chunk moves catalog, writers, routes, property schema):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **84** | **86** — append `invoice.generate`, `invoice.void` **after** `rates.archive_promo` |
| `AUDIT_WRITER_COMMAND_IDS.size` | **59** | **61** (+ both invoice commands) |
| `V1_HTTP_ROUTE_AUDIT` | `[137] = delete_rate_promo` | **APPEND** `[138] post_invoices`, `[139] get_invoice`, `[140] post_invoice_void` — **`[137]`–`[127]` unmoved** |
| `PROPERTY_SCHEMA_HEAD` | **31** | **32** — `invoice` table |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — `[3] === 'AUTO_TRANSFER'` |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.3 Scope in

1. **v32 migration** — `invoice` table (Lock 4).
2. **DO counter** — `__meta.invoice_counter` monotonic; never recycled (Lock 2).
3. **Snapshot builder** — copy folio lines + tax rollups + totals + presentation config into JSON (Lock 3).
4. **R2 put** — `invoices/{propertyId}/{invoiceNumber}.json` on `EVENT_LOG_R2`; sha256 in index (Lock 3).
5. **`invoice.generate` / `invoice.void`** — catalog, audit writers, wire codes (Lock 5–6).
6. **Three HTTP routes** — generate, read, void (Lock 6).
7. **Checkout inline auto** — when `gen_mode === 'Automatically'`, `tryCheckOut` calls generate inside txn; failure aborts checkout (Lock 8).
8. **SPA** — Folio “Generate invoice” + client-side read/render view (Lock 10).
9. **Purge inventory** + `pnpm generate:ddl` (Lock 11).
10. Tests Lock 12; register + migrate pin updates.

### 1.4 Scope out (normative — name them so a later pass does not “fix” them here)

- Credit notes / post-checkout invoice adjustments (void + new number instead)
- PDF generation worker (structured JSON only; client renders)
- City ledger / AR (next vertical)
- `pms.invoice.logo` R2 upload (`SECRET` config exists; logo rendering is client-side concern)
- `invoice.regenerate` command (forbidden — void + generate)
- PATCH on invoice HTTP (forbidden)
- COMPANY / MASTER window invoices (`auto_trigger` semantics — named leftover)
- Growing `NIGHT_AUDIT_STEPS`; moving `[137]`–`[127]`
- `CLASS_DENYLIST` edit; new `export class` except internal error classes matching existing patterns
- Bidirectional leftover pointer sentences (final implementation task)
- Post-checkout `auto_capture_on_check_out` lines on the invoice snapshot (named leftover — capture runs after checkout txn today ~8985+)

---

## 2. Locked decisions (verbatim — do not deviate)

1. **Invoice is a snapshot, not a view.** Immutable folio lines, tax, and totals frozen at generation. Post-checkout adjustments do not mutate the invoice; they create credit notes (scope-out for now).
2. **Numbering is monotonic per property.** `prefix + zero-padded counter + suffix`. Counter stored in DO state; never recycled. Prefix/suffix from existing `pms.invoice.*` config.
3. **R2 storage.** Key: `invoices/{propertyId}/{invoiceNumber}.json`. Binding: reuse `EVENT_LOG_R2` (existing bucket). Content is structured JSON with sha256 recorded in DO index. HTML/PDF rendering is client-side; no PDF generation worker in this slice.
4. **Schema v32.** New `invoice` table: `invoice_id`, `invoice_number` (unique), `reservation_id`, `folio_window_id`, `r2_key`, `sha256`, `generated_at`, `generated_by`, `voided_at` (nullable), `voided_by`. No `cancelled` — void is the terminal state.
5. **Commands.** `invoice.generate` (idempotent, INTERACTIVE, FAIL_CLOSED) and `invoice.void` (audited). No `invoice.regenerate`; void + generate new number instead.
6. **HTTP.** `POST /v1/properties/:id/invoices` (generate) and `GET /v1/properties/:id/invoices/:invoiceId` (read). No PATCH; void via `POST /v1/properties/:id/invoices/:invoiceId/void`.
7. **Auto vs manual.** `pms.invoice.gen_mode = 'Automatically'` triggers on `reservation.status_changed` to `checked_out` (consumer). Manual via desk button. Manual is the MVP; auto consumer is Task 4 stretch.
8. **Checkout blocking.** If `gen_mode = 'Automatically'` and invoice generation fails, checkout halts (does not silently skip). This preserves audit trail.

---

## 3. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Snapshot, not view

At `invoice.generate`, the DO **copies** folio state into R2 JSON. Subsequent folio mutations (`folio.add_item`, transfers, refunds, etc.) **do not** alter stored JSON or index totals. Operators who need a corrected document **void** the invoice and **generate** a new monotonic number.

**Forbidden this chunk:**

- Live folio JOIN on GET invoice
- UPDATE of R2 object after put
- SQL triggers that sync `invoice` rows from `folio_line`

### Lock 2 — Monotonic numbering (`__meta.invoice_counter`)

Counter lives in `property_config` as **`__meta.invoice_counter`** (raw SQL, same class as `__meta.ari_version` ~2621 — never routed through `tryPutDomainConfig`).

| Config key | Role |
|---|---|
| `pms.invoice.prefix` | Prepended string (default `INV-`) |
| `pms.invoice.suffix` | Appended string (default `''`) |
| `pms.invoice.starting_idx` | First issued counter value (default `1`) |

**Algorithm** (inside `transactionSync` before R2 put):

```ts
private readInvoiceCounterSync(): number {
  const rows = this.ctx.storage.sql
    .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.invoice_counter')
    .toArray() as Array<{ value_json: string }>;
  if (!rows[0]) {
    const start = Number(this.readConfigValueSync('pms.invoice.starting_idx') ?? 1);
    return start - 1; // first bump yields `starting_idx`
  }
  return JSON.parse(rows[0].value_json) as number;
}

private bumpInvoiceCounterSync(): number {
  const next = this.readInvoiceCounterSync() + 1;
  this.ctx.storage.sql.exec(
    `INSERT INTO property_config (key, value_json, version, updated_at)
     VALUES ('__meta.invoice_counter', ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    JSON.stringify(next),
    Date.now(),
  );
  return next;
}

private formatInvoiceNumberSync(counter: number): string {
  const prefix = String(this.readConfigValueSync('pms.invoice.prefix') ?? 'INV-');
  const suffix = String(this.readConfigValueSync('pms.invoice.suffix') ?? '');
  const pad = String(counter).padStart(6, '0');
  return `${prefix}${pad}${suffix}`;
}
```

**Rules:**

- Counter **never decrements**; voided invoices **do not** recycle their number.
- `invoice_number` is **globally unique per property** (UNIQUE constraint).
- Changing `starting_idx` after first issue does **not** rewind the counter (config change affects future properties only if counter absent).

### Lock 3 — R2 object + snapshot JSON

**Key:** `invoices/{propertyId}/{invoiceNumber}.json` (literal `invoiceNumber` string, including prefix/suffix — URL-safe as stored).

**Binding:** `this.env.EVENT_LOG_R2` via existing `assertReportsR2Bound()` pattern (~3419) — reuse helper or rename to shared `assertEventLogR2Bound()`; unbound → `invoice_r2_unbound` wire code.

**Put flow** (mirror `putReportObject` ~3431):

1. Build snapshot object (see §3.1).
2. `JSON.stringify` → `Uint8Array` → `sha256Hex`.
3. `await bucket.put(r2Key, encoded)`.
4. `INSERT` index row in same command txn (after await, before idempotency commit — if put fails, txn rolls back and counter bump rolls back).

**Snapshot schema** (`schemaVersion: 1`):

| Field | Source |
|---|---|
| `invoiceId`, `invoiceNumber` | Generated |
| `propertyId`, `reservationId`, `folioWindowId` | Input / resolved GUEST window |
| `generatedAt` | epoch ms |
| `invoiceDate` | `YYYY-MM-DD` from `pms.invoice.date_rule`: **`CHECKOUT`** → reservation `departure_date`; else `__meta.business_date` at generation |
| `guestRef`, `piiKeyId` | reservation row (refs only — no plaintext name) |
| `reservation` | `{ arrivalDate, departureDate, roomId, ratePlanId, status, promoId? }` at generation |
| `presentation` | PRESENTATION `pms.invoice.*` keys read at generation (`title`, `footer`, `showCompany`, `showRoom`, `showTaxfee`, `showDuedate`, `showPackage`, `compact`, `language`, `guestLang`, `titleLang`) — **not** `logo` |
| `ledgerCurrency` | stored ledger currency |
| `lines[]` | Frozen copy of folio lines **for `folioWindowId` only**, ordered `created_at ASC`: `{ folioLineId, chargeCode, chargeName, amountMinor, ledgerAmountMinor, txnCurrency, fxRate, businessDate, source, taxOf, taxRuleId, paymentId }` |
| `taxSummary[]` | Roll up TAX lines (`tax_of IS NOT NULL` or `charge_code` tax group): `{ taxRuleId, label, amountMinor }` |
| `totals` | `{ chargesMinor, taxMinor, paymentsMinor, balanceMinor }` — sums from frozen lines in **ledger** minor units |

Charge names resolved from `charge_code.name` at generation time (denormalized into JSON).

**Window scope (MVP):** default `folioWindowId = guestFolioWindowId(reservationId)`. Optional HTTP body override must match an existing window on the reservation; **one active invoice per `(reservation_id, folio_window_id)`** (partial unique index).

### Lock 4 — Schema v32 (`invoice` table)

Append to `PROPERTY_MIGRATIONS`; regenerate `migrations/do-property/0032_invoice_generation.sql`:

```sql
CREATE TABLE invoice (
  invoice_id        TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL,
  reservation_id    TEXT NOT NULL,
  folio_window_id   TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  generated_by      TEXT NOT NULL,
  voided_at         INTEGER,
  voided_by         TEXT,
  UNIQUE (invoice_number),
  CHECK (voided_at IS NULL OR (voided_by IS NOT NULL AND length(voided_by) > 0))
);

CREATE UNIQUE INDEX invoice_active_window
  ON invoice (reservation_id, folio_window_id)
  WHERE voided_at IS NULL;

CREATE INDEX invoice_reservation_idx ON invoice (reservation_id);
```

**Semantics:**

| Column | Meaning |
|---|---|
| `invoice_id` | UUID primary key |
| `invoice_number` | Formatted number from Lock 2; UNIQUE |
| `reservation_id` | Stay reference |
| `folio_window_id` | Snapshotted window (MVP: GUEST) |
| `r2_key` | Full R2 key string |
| `sha256` | Hex digest of JSON body at put time |
| `generated_at` | Epoch ms |
| `generated_by` | Audit actor ref (`user:{id}` or `system:checkout`) |
| `voided_at` / `voided_by` | Set by `invoice.void`; terminal |

No FK to `reservation` / `folio_window` (deploy-safety, same class as `reservation_rate_night`).

### Lock 5 — `invoice.generate`

**Catalog entry** (append after `rates.archive_promo`):

| Field | Value |
|---|---|
| `id` | `invoice.generate` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:post` |
| `events` | `['invoice.generated']` |

**DO RPC:** `tryGenerateInvoice(actor, input, idem)`

**Input:**

```ts
{
  reservationId: string;
  folioWindowId?: string; // default GUEST
  generatedBy?: 'checkout' | 'desk'; // internal; checkout path sets 'checkout'
}
```

**Fingerprint:**

```ts
{ reservationId, folioWindowId: resolvedWindowId }
```

**Preconditions (else mapped wire code):**

| Check | Wire code | HTTP |
|---|---|---|
| Reservation missing | `not_found` | **404** |
| Status not `checked_in` / `checked_out` when `generatedBy !== 'checkout'` | `invalid_status_transition` | **422** |
| Checkout path (`generatedBy === 'checkout'`) | status must be `checked_in` (pre-flip) | |
| Active invoice exists for window | `invoice_already_exists` | **409** |
| `balanceMinor > 0` and `pms.invoice.allow_pending !== true` | `folio_balance_due` | **422** |
| Folio window missing | `not_found` | **404** |
| R2 unbound | `invoice_r2_unbound` | **503** |
| Degraded class would block | existing degraded gate | **503** |

**Checkout gate (Lock 8 — enforced by `tryCheckOut`, not by `invoice.generate`):**

| Check | Wire code | HTTP |
|---|---|---|
| `gen_mode === 'Automatically'` and no active invoice for resolved GUEST window | `invoice_required` | **422** |

When `generatedBy === 'checkout'`, persist audit markers: `generated_by = 'system:checkout'` on the index row and `"autoGenerated": true` in the R2 snapshot JSON.

**Idempotency:** same key + fingerprint → return existing `{ invoiceId, invoiceNumber, r2Key, sha256 }` without new counter bump or R2 put.

**Success:** emit `invoice.generated` outbox; `appendAuditLogSync` with `commandId: 'invoice.generate'`.

**Internal error classes:** `InvoiceAlreadyExistsError`, `InvoiceR2UnboundError`, `FolioBalanceDueError` — non-export pattern like `BalanceDueError`.

### Lock 6 — `invoice.void`

**Catalog entry:**

| Field | Value |
|---|---|
| `id` | `invoice.void` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `events` | `['invoice.voided']` |

**DO RPC:** `tryVoidInvoice(actor, input, idem)`

**Input:** `{ invoiceId: string; reason?: string }` — `reason` trimmed 1–500 when present.

**Fingerprint:** `{ invoiceId }`

**Preconditions:**

| Check | Wire code | HTTP |
|---|---|---|
| Row missing | `invoice_not_found` | **404** |
| Already voided | `invoice_voided` | **409** |

**Mutation:** `UPDATE invoice SET voided_at = ?, voided_by = ? WHERE invoice_id = ? AND voided_at IS NULL`. R2 object **unchanged**. Emit `invoice.voided`; audit row.

Both invoice commands → `AUDIT_WRITER_COMMAND_IDS` → size **61**.

### Lock 7 — HTTP routes

Append after `[137]` in `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`:

| Audit id | Method | Path | Permission | commandId |
|---|---|---|---|---|
| `post_invoices` | POST | `/v1/properties/:propertyId/invoices` | `folio:post` | `invoice.generate` |
| `get_invoice` | GET | `/v1/properties/:propertyId/invoices/:invoiceId` | `folio:read` | — (`degradedRead: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`) |
| `post_invoice_void` | POST | `/v1/properties/:propertyId/invoices/:invoiceId/void` | `folio:adjust` | `invoice.void` |

**POST generate — request body:**

```json
{
  "idempotencyKey": "uuid",
  "reservationId": "string",
  "folioWindowId": "optional string"
}
```

**POST generate — response 201:**

```json
{
  "ok": true,
  "invoiceId": "uuid",
  "invoiceNumber": "INV-000042",
  "reservationId": "string",
  "folioWindowId": "string",
  "r2Key": "invoices/{propertyId}/INV-000042.json",
  "sha256": "hex",
  "generatedAt": 1234567890
}
```

**GET read — response 200:**

```json
{
  "invoiceId": "uuid",
  "invoiceNumber": "INV-000042",
  "reservationId": "string",
  "folioWindowId": "string",
  "r2Key": "string",
  "sha256": "hex",
  "generatedAt": 1234567890,
  "generatedBy": "user:…",
  "voidedAt": null,
  "voidedBy": null,
  "snapshot": { }
}
```

Handler loads index from DO; `EVENT_LOG_R2.get(r2Key)`; parse JSON into `snapshot`. Index 404 or missing R2 object → **404** `{ error: 'not_found' }`. Transport → **503** degraded read.

**POST void — request body:**

```json
{
  "idempotencyKey": "uuid",
  "reason": "optional string"
}
```

**POST void — response 200:**

```json
{
  "ok": true,
  "invoiceId": "uuid",
  "voidedAt": 1234567890
}
```

Add wire constants to `packages/contracts/src/idempotency.ts`:

```ts
export const INVOICE_ALREADY_EXISTS = 'invoice_already_exists' as const;
export const INVOICE_NOT_FOUND = 'invoice_not_found' as const;
export const INVOICE_VOIDED = 'invoice_voided' as const;
export const INVOICE_R2_UNBOUND = 'invoice_r2_unbound' as const;
export const INVOICE_REQUIRED = 'invoice_required' as const;
export const FOLIO_BALANCE_DUE = 'folio_balance_due' as const;
```

Map in dispatch error helpers: `INVOICE_ALREADY_EXISTS` / `INVOICE_VOIDED` → **409**; `INVOICE_NOT_FOUND` → **404**; `INVOICE_REQUIRED` / `FOLIO_BALANCE_DUE` → **422** (alongside `BALANCE_DUE`); `INVOICE_R2_UNBOUND` → **503**.

### Lock 8 — Checkout invoice precondition gate (MVP — satisfies locked decision 8)

Invoice generation **must not** run inside `tryCheckOut`'s `transactionSync` callback — DO SQLite transactions are synchronous; `await bucket.put()` cannot run inside `transactionSync`.

**Pattern:** precondition gate **before** checkout txn.

1. When `pms.invoice.gen_mode === 'Automatically'`, the caller (checkout HTTP handler or SPA) **must** call `invoice.generate` (`POST /v1/properties/:id/invoices`) **before** `reservations.check_out` begins its transaction.
2. If generate returns **201**, checkout proceeds.
3. If checkout then fails, the invoice already exists but the reservation remains `checked_in` — desk may retry checkout (idempotent) or void the invoice.
4. When the SPA skips generate before checkout in auto mode, checkout fails with `invoice_required`.

Inside `tryCheckOut` `runIdempotent` callback (~8861), **after** balance gate (~8891) and **before** `UPDATE reservation SET status = 'checked_out'` (~8900):

```ts
if (this.readConfigValueSync('pms.invoice.gen_mode') === 'Automatically') {
  const guestWindowId = this.guestFolioWindowId(input.reservationId);
  if (!this.hasActiveInvoiceForWindowSync(input.reservationId, guestWindowId)) {
    throw new InvoiceRequiredError();
  }
}
```

- Wire code: `invoice_required` → HTTP **422**
- Internal class: `InvoiceRequiredError` (non-export pattern like `BalanceDueError`)

**SPA obligation:** when `gen_mode === 'Automatically'`, Folio checkout flow calls `generateInvoice` then `checkOut` in sequence. Manual desk checkout via API must follow the same ordering.

**Audit flag:** when `invoice.generate` is invoked with `generatedBy: 'checkout'`, persist `generated_by = 'system:checkout'` on the index row and `"autoGenerated": true` in the R2 snapshot JSON (Lock 5).

**Named interaction:** `resolveCheckOutAutoCapture` runs **after** checkout txn (~8985) — invoice snapshot may omit post-checkout captures (leftover §5 item **1**).


### Lock 9 — Event consumer (Task 4 stretch — locked decision 7)

**Not MVP.** Checkout no longer generates invoices inline (Lock 8 precondition gate). When shipped, extend `handleDomainEvent` (`event-consumer.ts`):

```ts
case 'reservation.status_changed': {
  const toStatus = payload.toStatus;
  if (toStatus === 'checked_out' && gen_mode === 'Automatically') {
    // invoke PropertyDO invoice.generate with system actor + dedupe key from eventId
  }
  break;
}
```

Consumer is belt-and-braces for **non-SPA checkout paths** that bypass the precondition gate (e.g. provisional replay, future API integrations). Dedupe on `eventId`. Failures → DLQ / provisional — **do not** silently skip when auto mode (log + alert).

Add `invoice.generated`, `invoice.voided` to consumer allowlist switch (alongside `rate_promo.changed` ~140).

### Lock 10 — SPA (`FolioScreen`)

On `apps/web-pms/src/screens/FolioScreen.tsx`:

1. When reservation status is `checked_out` (or `checked_in` with zero balance / `allow_pending` — match server), show **Generate invoice** button (`data-testid="invoice-generate"`).
2. Hide/disable when active invoice exists for GUEST window (fetch `GET` list optional — MVP: POST and handle **409** `invoice_already_exists`, or add `listInvoicesForReservation` read in DO — **prefer** lightweight `readInvoicesForReservation(reservationId)` DO RPC returning active + voided ids for button state).
3. On success → navigate or open panel **Invoice** view (`data-testid="invoice-view"`) rendering snapshot JSON client-side (table of lines, tax summary, totals). Apply `presentation` flags for column visibility. **No** `window.print` in degraded (ARCHITECTURE §4.6).
4. Void: separate control for `folio:adjust` holders (`data-testid="invoice-void"`) — confirm dialog.

**Client (`packages/client-core/src/api.ts`):**

- `generateInvoice(propertyId, body)`
- `getInvoice(propertyId, invoiceId)`
- `voidInvoice(propertyId, invoiceId, body)`
- Optional: `listInvoices(propertyId, reservationId)` if DO list RPC added

### Lock 11 — Purge + DDL

Add `'invoice'` to `PROPERTY_PURGE_INVENTORY_TABLES` (~1262) **alphabetically** after `'idempotency'`.

Run `pnpm generate:ddl` → `0032_invoice_generation.sql`; migrate test pin `PROPERTY_SCHEMA_HEAD === 32`.

Purge workflow: add `invoices/{propertyId}/` prefix delete alongside existing event-log / reports prefixes (follow night-audit reports purge pattern in `purge-workflow.ts`).

### Lock 12 — Tests (normative — TDD: failing tests first)

File-filter vitest. **No `vi.spyOn` into DO isolate.**

**`apps/pms-core/test/invoice-generation.spec.ts`** (new):

1. Manual generate — creates index row + R2 object; `sha256` matches body
2. Duplicate active window → **409** `invoice_already_exists`
3. Idempotent replay — same key returns same `invoiceId`; counter not bumped twice
4. Balance due + `allow_pending false` → **422** `folio_balance_due`
5. Void → sets `voided_at`; second void → **409** `invoice_voided`
6. After void, new generate → **new** `invoice_number` (counter monotonic; old number not reused)
7. GET — returns `snapshot` from R2; unknown id → **404**
8. Unbound R2 → **503** `invoice_r2_unbound`
9. Checkout + `gen_mode Automatically` + no active invoice → checkout **422** `invoice_required`, status stays `checked_in`
10. Checkout + `gen_mode Automatically` + active invoice exists → checkout **200** `checked_out`
11. Counter honours `starting_idx` on first invoice

**`apps/web-pms/src/screens/FolioScreen.test.tsx`** (extend):

1. Generate button visible on checked-out folio
2. Click generate → invoice view shows line totals from mocked snapshot
3. Active invoice hides generate button

Rebuild `@hospai/contracts` before pms-core if dispatch imports change.

**Register pins after land:**

- `COMMAND_CATALOG.length === 86`
- `AUDIT_WRITER_COMMAND_IDS.size === 61`
- `V1_HTTP_ROUTE_AUDIT[137].id === 'delete_rate_promo'` (unchanged)
- `V1_HTTP_ROUTE_AUDIT[138].id === 'post_invoices'` … `[140].id === 'post_invoice_void'`
- `PROPERTY_SCHEMA_HEAD === 32`
- `ORG_SCHEMA_HEAD === 7`
- `NIGHT_AUDIT_STEPS.length === 8`

**Register pin command (plan):** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **will need pin updates** for catalog **86**, writers **61**, routes **[138]–[140]**.

**CI notes (plan only):** file-filter vitest; `--shard=N/8` with **no** `--` before `--shard`; Workerd 503 → retry that shard once; never `|| true`; living plan checkboxes tick `- [x]` on **last task only**.

---

## 4. Rollback / migration notes

| Scenario | Action |
|---|---|
| Deploy v32 forward | Online migration adds `invoice` table only — no table rebuilds; safe on populated stores |
| Roll back code before v32 | Old code ignores `invoice` table (harmless extra table) |
| Roll back code after v32 | Same — extra table inert |
| Counter / R2 | **Irreversible** — never decrement `__meta.invoice_counter` or delete R2 objects on rollback |
| Voided invoice | Terminal; no un-void |
| Purge property | Delete `invoices/{propertyId}/` R2 prefix + `invoice` SQL rows in purge workflow |

---

## 5. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v32 statements + `PROPERTY_MIGRATIONS` tail |
| `migrations/do-property/0032_invoice_generation.sql` | generated |
| `packages/contracts/src/idempotency.ts` | five wire codes |
| `packages/contracts/src/commands/catalog.ts` | +2 commands after `rates.archive_promo` |
| `packages/contracts/src/commands/audit-writers.ts` | +2 writer ids |
| `packages/contracts/src/v1-http-routes.ts` | +3 routes after `[137]` |
| `packages/contracts/src/register.test.ts` | pin updates |
| `packages/do-runtime/src/migrate.test.ts` | schema head **32** |
| `apps/pms-core/src/property-do.ts` | counter, snapshot, generate/void RPCs, checkout hook, optional list RPC |
| `apps/pms-core/src/v1-dispatch.ts` | three handlers + error map |
| `apps/pms-core/src/event-consumer.ts` | allowlist + Task 4 consumer |
| `apps/pms-core/src/purge-workflow.ts` | invoice R2 prefix |
| `packages/client-core/src/api.ts` | invoice client methods |
| `apps/web-pms/src/screens/FolioScreen.tsx` | generate + view + void |
| `apps/pms-core/test/invoice-generation.spec.ts` | Lock 12 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Lock 12 SPA |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `ARCHITECTURE.md`, `pms.invoice.logo` upload.

---

## 6. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Post-checkout auto_capture on invoice** | Capture runs after checkout txn today (~8985) |
| 2 | **COMPANY / MASTER window invoices** | `pms.invoice.auto_trigger` not interpreted MVP |
| 3 | **Credit notes** | Locked scope-out |
| 4 | **Event consumer auto-generate** | Task 4 stretch (Lock 9) |
| 5 | **Invoice list HTTP route** | Optional `GET …/reservations/:rid/invoices` |
| 6 | **PDF export** | Client print only |
| 7 | **City ledger / AR** | Next vertical |

---

## 7. Implementation checklist

- [x] v32 migration + `PROPERTY_SCHEMA_HEAD` **32** + purge `invoice` table + R2 prefix
- [x] Wire codes + HTTP status map (`INVOICE_*`, `FOLIO_BALANCE_DUE`)
- [x] Catalog **86** + audit writers **61** + three HTTP routes **[138]–[140]**
- [x] DO counter + snapshot builder + R2 put + generate/void RPCs
- [x] Checkout invoice precondition gate when `gen_mode === 'Automatically'`
- [x] HTTP handlers + client API
- [x] SPA Folio generate + view (+ void for adjust holders)
- [x] Tests Lock 12 (TDD order); `pnpm generate:ddl`
- [x] Register pins: catalog **86**, writers **61**, `[137]` unchanged, `[138]–[140]`, schema **32**, steps **8**
- [ ] Task 4 stretch: event consumer on `checked_out`
- [x] CI: file-filter vitest; shard syntax; Workerd retry; last-task checkbox only

---

## 8. Tree conflicts with reviewer locks

**None on heads.** Verified post-`92bf6ba`: catalog **84**, writers **59**, `[137] delete_rate_promo` last, `PROPERTY_SCHEMA_HEAD` **31** (this chunk → **32**), `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1132), `PLATFORM_GAPS === []`, folio + R2 patterns ready, `pms.invoice.*` config registered, no existing invoice code.

**Notes for implementer (not lock violations):**

1. **Precondition ordering** — when `gen_mode === 'Automatically'`, `invoice.generate` must complete (201) before `reservations.check_out` starts; SPA and API callers must enforce this sequence. Checkout only verifies an active invoice exists (Lock 8).
2. **Default `gen_mode` is `Automatically`** — SPA checkout flow must call `generateInvoice` before `checkOut` or checkout returns **422** `invoice_required`.
3. **`FOLIO_BALANCE_DUE` vs `BALANCE_DUE`** — separate wire code for invoice gate; checkout balance gate keeps `balance_due`.
4. **Degraded** — `invoice.generate` is `FAIL_CLOSED`; never issue in degraded (ARCHITECTURE §4.6).
5. **Guest PII** — snapshot carries `guestRef` / `piiKeyId` only; SPA resolves name via existing guest batch read.

**Concerns:**

| Concern | Mitigation locked |
|---|---|
| Invoice drift after folio edit | Snapshot immutability; void + re-issue |
| Number gap after failed put | Txn rolls back counter bump |
| Double invoice on retry | Partial unique index + idempotency |
| Auto mode silent skip | Checkout abort + consumer stretch without skip |
