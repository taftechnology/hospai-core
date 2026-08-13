# Multi-currency folio + payments↔folio event contract

**Date:** 2026-08-13  
**Status:** Draft — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (payments `FAIL_CLOSED`; never print a folio in `DEGRADED`), §7.3 (three currencies; frozen FX; residual FX gain/loss; payments↔folio event contract; nightly settlement → exception queue never auto-correct), §8 (pinned 7-step night audit; do not grow `NIGHT_AUDIT_STEPS`), §10.1 (at-least-once; idempotent by `(event_id, gateway_reference)`), §13 (PCI-isolated payments Worker — does not exist yet), §14 Phase 1 (“Multi-currency folio + payments↔folio event contract”), §16.5 revision-note debt; [multi-currency money](./2026-07-28-multi-currency-money-design.md) (Phase 0 ledger *shape*; FX sourcing / residual / `payment.*` were out); [folio charges](./2026-08-05-folio-charges-vertical-design.md) (`CROSS_CURRENCY_UNSUPPORTED` identity-rate gate); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [folio money operations](./2026-08-12-folio-money-operations-design.md) (windows, transfer, split v2, void/refund, `capture_due`, leftover 4 chargebacks); [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) (style; schema head 23); command catalog; `property-migrations.ts`; `packages/money`; `PropertyDO` `resolveFolioLineMoney` / `insertFolioLineSync` / `tryAuthorizePayment` / `tryCapturePayment` / `tryCaptureDueHolds`

**Closes:** ARCHITECTURE.md §7.3 Multi-currency + Payments↔folio event contract as a Phase 1 *implementation* (the columns and `packages/money` conversion already exist). Folio-money-ops leftover **4** chargebacks (`payment.chargeback_received`) — partial refunds stay leftover. ARCHITECTURE “Still owed” FX rate sourcing (revision 2026-07-27c). The stale 2026-08-12 revision note that still lists closed §16.5 items as open.

**Amends:** [multi-currency money](./2026-07-28-multi-currency-money-design.md) (FX sourcing, residual FX line type, `payment.*` handlers were Phase 1); [folio charges](./2026-08-05-folio-charges-vertical-design.md) §2.3 identity-rate / `CROSS_CURRENCY_UNSUPPORTED` — lifted for the surfaces named here, not deleted as a constant (same-currency still requires rate `"1"`); [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover 4 (chargebacks land; partial refunds do not) and the scope-out line “Multi-currency conversion (already shipped; Phase 1 identity-rate rule unchanged)”. Bidirectional pointer: one sentence in those specs when this chunk lands.

---

## 1. Context & Motivation

The folio *schema* has been multi-currency since the freeze gate. `packages/money` already converts. Every writer still posts identity-rate (`fx_rate = "1"`, `txn_currency = ledger`). An international card cannot settle in a currency other than the property’s books, and there is no event-shaped seam for a future PCI payments Worker. Retrofitting either after more posting paths land is a fleet rewrite of every line, report, tax stamp, split, and refund.

This chunk turns the existing columns on, sources rates honestly (staff-entered, effective-dated, frozen at post), extends every money writer so reversals/splits/transfers/auto-capture stay consistent, and pins the six §7.3 payment events as versioned contracts. The in-DO simulate module is the current producer.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Three-currency *columns* on `folio_line` | Freeze-gate v1 (`property-migrations.ts` ~43–52): `amount_minor`, `txn_currency`, `ledger_amount_minor`, `fx_rate`, `fx_rate_at`. v14/v21 rebuilds **copied** them; they are not new in v24. |
| `packages/money` | `postToLedger`, `assertPostedMatches`, `validateFxRate`, `roundHalfAwayFromZero`, `allocate`, `PostedLineAmount`. Same-currency requires `fx_rate === "1"`. Cross-currency conversion already unit-tested (`packages/money/src/index.test.ts`). |
| Identity-rate gate | `resolveFolioLineMoney` (`property-do.ts` ~12643–12676): if `txnCurrency` is supplied and ≠ stored ledger → `CROSS_CURRENCY_UNSUPPORTED`. Default fills `txnCurrency = ledger`, `fxRate = "1"`, `ledgerAmountMinor = amountMinor`. Wire code lives in `packages/contracts/src/money.ts` (~6), **not** `idempotency.ts`. |
| Ledger currency | `readStoredLedgerCurrencySync` (~1223–1238) reads `property_config` key `pms.money.currency_code` only — **never** the register default `'USD'`. Missing row → `CURRENCY_UNSET`. First-write via `ensureCurrencyIfAbsent` at provision. |
| Hollow currencies list | `pms.money.currencies_list` is DOMAIN, default `[]`, `rematerializesRates: true` (`register.ts` ~174–179). **Zero readers** in PropertyDO / SPA. |
| Payments | In-DO simulate only: `tryAuthorizePayment` / `tryCapturePayment` / `tryVoidPayment` / `tryRefundPayment` / `tryRecordCashPayment` / `trySplitChargePayment` / `tryCaptureDueHolds`. No payments Worker. `payment.currency` is always the ledger code today (~11084, ~12004). Capture/refund/cash post identity `PostedLineAmount` (`fxRate: '1'`, ledger = txn). |
| Events actually emitted | `folio.payment_authorized`, `folio.payment_captured`, `folio.payment_voided`, `folio.payment_refunded`, `folio.balance_due`, `folio.line_posted`. **Not** `payment.*`. `event-consumer.ts` is a shape allowlist (~153–159); it does **not** call PropertyDO (folio-money-ops §6.4 lock still holds). |
| Windows / CLOSED gate | `insertFolioLineSync` (~9882) rejects `CLOSED`. Every writer flows through it. |
| Split / transfer / discount | `splitFolioLineSync` copies `fx_rate` / `fx_rate_at` but sets `ledgerAmountMinor: split.amountMinor` (~10067) — identity assumption. `tryPostDiscount` same (~10438). Transfer copies both legs and the frozen rate (~10635–10695). |
| Tax | `stampTaxForChargeSync` (~1350) `computeTax(parentAmountMinor, rate)` then posts tax with `ledgerAmountMinor = taxMinor` and the **parent’s** `txnCurrency` / `fxRate`. Fine under identity; wrong for a foreign parent (local tax is a ledger fact, §7.3). |
| `capture_due` | Remaining is `SUM(ledger_amount_minor)` (~11683). Hold take is `Math.min(hold.amount_minor, remaining)` (~11702) — compares txn units to ledger units. Breaks the moment a hold is foreign. |
| Night audit | `NIGHT_AUDIT_STEPS.length === 7`. `postRoomChargesSync` prices from `reservation_rate_night` then `rate_day`; posts ROOM in ledger identity (~10139–10145). `SNAPSHOT_REPORTS` revenue aggregates `ledger_amount_minor` only (~2764–2790); cashier snapshot is shift floats, not tender currencies. |
| Charge codes | `SYSTEM_CHARGE_CODES = ['ROOM','PAYMENT','CANCEL','NO_SHOW','DISCOUNT','DAMAGE']` (length 6). Seed pattern is `INSERT OR IGNORE INTO charge_code …`. |
| Catalog / routes / audit | `COMMAND_CATALOG` **70** entries. `V1_HTTP_ROUTE_AUDIT` **106** rows, indices **0–105**, last `[105] = get_reservation_search`. `AUDIT_WRITER_COMMAND_IDS.size === 45`. `PLATFORM_GAPS = []`. |
| Schema head | `PROPERTY_SCHEMA_HEAD === 23` (v21 `folio_money_ops`, v22 `room_ooo`, v23 `prototype_holes`). Next free **24**. |
| Migration test pattern | `folio-money-ops-migration.sqlite.test.ts`: real `node:sqlite` `DatabaseSync`, `PRAGMA foreign_keys = ON`, apply ≤N, insert data, apply the rest, assert CHECKs + FK orphans throw. v21 was rename-based because `PRAGMA foreign_keys` is unreliable in workerd. |
| `MemorySql` | `packages/do-runtime/src/migrate.test.ts` ~48–177. `CREATE TABLE` / `CREATE INDEX` are generic; every `INSERT INTO *_vN`, `DROP TABLE`, `ALTER … RENAME`, `ALTER TABLE … ADD`, `UPDATE`, `PRAGMA` prefix must be listed or migrate tests throw `Unhandled SQL`. |
| Purge | `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` (~903–963) must name every new table. `check:purge`. |
| `runIdempotent` | Sync-only. Authorize/capture/void/refund use the async-outside-txn adapter seam + domain-row / fingerprint replay (see `tryAuthorizePayment`). |
| SPA | `FolioScreen` formats `ledgerAmountMinor` only (~856). Authorize/cash inputs are amount-only (`client-core` `authorizePayment` / `recordCashPayment` have no `currency`). Rate screens do not post folio money. No settings screen for tax rules or FX. |
| Class denylist | New `export class` requires `CLASS_DENYLIST` + `check:class-denylist`. Prefer file-local errors (pattern: `WindowClosedError`, `OccupancyExceededError`). |

### 1.2 Scope in

1. Property-scoped, effective-dated `fx_rate` table; staff enter rates; posting freezes the rate onto the line (§4).
2. Lift the identity-rate gate for **payments** and **manual `folio.add_item`**. Room / night-audit / rate-plan money stays ledger (§5).
3. Residual FX gain/loss as its own charge codes + a manual adjustment command. Settlement-file ingest deferred (§6).
4. Versioned `payment.*` event contracts; in-DO simulate is the current producer/consumer through `applyPaymentEventSync` + outbox (§7).
5. Chargeback command + dispute row (folio-money-ops leftover 4, chargebacks only).
6. Extend **every** existing money writer so reversal / split / transfer / discount / tax / refund / auto-capture honour frozen rates and both legs (§8).
7. Reports stay ledger-only; cashier snapshot gains a per-txn-currency tender breakdown (§12).
8. Folio SPA: dual amounts when they differ; payment forms accept currency; FX rate editor for `settings:configure` (§13).
9. Migration v24: new tables + payment rebuild (CHECK + frozen-rate columns). `folio_line` is a **byte-identical copy rebuild** (no backfill) so the payment DROP is FK-safe in workerd.
10. ARCHITECTURE.md revision-note honesty (§20).

### 1.3 Scope out

- Reporting / consolidation currency in the PropertyDO (warehouse only — §7.3).
- Live FX feeds, ECB/provider refresh, hedging, daily revaluation, treasury.
- Settlement-file ingestion and an automated settlement exception queue (leftover 1). The *rule* (mismatch → exception, never auto-correct) is locked; the actuator is not.
- A PCI-isolated payments Worker, real PSP, PAN/token vault. Simulate adapter stays.
- Changing the property ledger currency after first write.
- Partial refunds (folio-money-ops leftover 4 remainder).
- Authorization expiry / hold-lapse; `unknown` reconciliation exit.
- City ledger / AR; night-audit auto-transfer; growing `NIGHT_AUDIT_STEPS`.
- Taxable FX adjustments; tax on FX_GAIN/FX_LOSS (exempt).
- Wiring `event-consumer.ts` to call PropertyDO (that is the Worker-era consumer). This chunk allowlists shapes only.
- Using `pms.money.currencies_list` as a second allowlist (leftover 2).
- Promo codes; recurring incidentals.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Three currencies, never collapsed.** Transaction on the line (`amount_minor` + `txn_currency`). Ledger on the line (`ledger_amount_minor`) and on every balance / night-audit / local-tax total. Reporting currency is **never** stored in the DO.
2. **Money is integers.** `packages/money` owns rounding and conversion. `fx_rate` is a decimal **string**, never a float. Helper is `roundHalfAwayFromZero` (not `round_half_up`).
3. **The rate is frozen at posting and is part of the record.** Never recompute `ledger_amount_minor` at read time. Reversals, splits, transfers, discounts, and refunds copy the **original** `fx_rate` / `fx_rate_at`; they do not look up a current rate.
4. **The folio is append-only.** FX gain/loss, chargeback reversal, and chargeback fee are new lines. Never `UPDATE folio_line.amount_minor` / `ledger_amount_minor` / `fx_rate`.
5. **Auth is not money.** `payment.authorized` writes no folio line. Void of `authorized` writes no folio line.
6. **Money moves on the gateway’s word.** The folio records what the adapter (today) or payments Worker (later) reports. It does not invent a capture from a locally-read balance. Payment commands stay `FAIL_CLOSED`.
7. **Idempotent apply by `(event_id, gateway_reference)`.** A redelivered `payment.captured` must not post a second `PAYMENT` line (`folio_line_payment_uidx` remains the structural backstop).
8. **Out-of-order capture-before-auth is legal.** Apply must not require an `authorized` row before accepting `payment.captured`.
9. **Residual FX is its own line type.** Never absorbed into the guest’s ROOM/PAYMENT/TAX charge.
10. **Local tax is a ledger fact.** `computeTax` runs on `ledger_amount_minor`. Tax lines post in **ledger** currency with `fx_rate = "1"`.
11. **Same-currency posting still requires `fx_rate === "1"`** (`postToLedger` already enforces this).
12. **`NIGHT_AUDIT_STEPS` stays seven.** No FX step, no settlement step.
13. **`runIdempotent` stays sync-only.** Async PSP outcomes keep the existing adapter-outside-txn + domain-row / recompute-on-replay patterns.
14. **Route audit append-only.** New routes start at index **106**. `[105] = get_reservation_search` does not move. `findRoute` is first-match — FX reads are **not** nested under `/folio/payments/:id` (that GET would shadow a `…/payments/fx-rates` path).
15. **New catalog commands** carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` when `FAIL_CLOSED` with events. New entitled writers go in `AUDIT_WRITER_COMMAND_IDS`.
16. **New tables** are named in `PROPERTY_PURGE_INVENTORY_TABLES` **and** `countPropertyInventoryRows`.
17. **No new `export class`** unless `CLASS_DENYLIST` is updated in the same change. Prefer file-local errors mapped to wire codes.
18. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.

---

## 3. Three currencies (normative)

| Currency | Meaning | Authoritative where | Stored in PropertyDO? |
|---|---|---|---|
| **Transaction** | What the line / tender was denominated in | `folio_line.amount_minor` + `txn_currency`; `payment.currency` | Yes |
| **Property (ledger)** | Books, folio balance, night audit, local tax | `folio_line.ledger_amount_minor`; `readFolio.balanceMinor = Σ ledger_amount_minor` | Yes — from the stored `pms.money.currency_code` row |
| **Reporting** | Chain consolidation | Warehouse / Iceberg | **Never** |

`payment.currency` **is** the transaction currency of that payment (today it happens to equal ledger). Do not add a second `txn_currency` column on `payment`.

Window and reservation balances stay `Σ ledger_amount_minor`. A EUR payment at a USD property reduces the USD balance by the frozen ledger equivalent, not by the EUR face.

---

## 4. FX rate source

### 4.1 Lock

**Property-scoped `fx_rate` table, staff-entered, effective-dated.** Posting looks up the rate effective at the posting instant and **freezes** `fx_rate` + `fx_rate_at` onto the line. No external feed. No seeded pair (a USD property with no EUR row cannot take EUR — that is honest). Identity pairs are never stored; same-currency is always `"1"`.

`pms.money.currencies_list` is **not** consulted. The open `fx_rate` rows whose `to_currency` equals the stored ledger code **are** the allowlist of transactable foreign currencies.

### 4.2 Table `fx_rate` (v24, new)

```sql
CREATE TABLE fx_rate (
  quote_id        TEXT PRIMARY KEY,
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  rate            TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT,
  CHECK (from_currency <> to_currency),
  CHECK (length(from_currency) = 3),
  CHECK (length(to_currency) = 3)
);
CREATE INDEX fx_rate_pair_eff
  ON fx_rate (from_currency, to_currency, effective_from);
```

- `rate` is a decimal string validated by `validateFxRate` (non-zero; same regex as `packages/money`).
- `to_currency` **must** equal the stored ledger currency at write time (`FX_RATE_NOT_LEDGER` otherwise). Phase 1 quotes only into ledger.
- `effective_from` / `effective_to` are epoch ms (`fx_rate_at` is already INTEGER). Tax rules use calendar dates because statutes change on dates; FX moves intra-day.
- Open row: `effective_to IS NULL`.
- Lookup at instant `at`: `from_currency = ? AND to_currency = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from DESC LIMIT 1`. Miss → `FX_RATE_MISSING`.
- No FK to `property_config` (the ledger code is not a row id).

### 4.3 Commands (mirror `tax_rule`)

| | `folio.create_fx_rate` | `folio.supersede_fx_rate` |
|---|---|---|
| Lane / degraded | `INTERACTIVE` / **FAIL_CLOSED** | same |
| Permission | `settings:configure` | same |
| Entitlement | `pms.core` | same |
| Events | `fx_rate.changed` | `fx_rate.changed` |
| Idempotent | true; fingerprint `{ quoteId, fromCurrency, toCurrency, rate, effectiveFrom }` | true; fingerprint `{ quoteId, supersedeQuoteId, rate, effectiveFrom }` |
| Audit | yes | yes |

**Create:** insert an open row. Reject if an open row already exists for the pair (`FX_RATE_OPEN_EXISTS` — supersede, don’t stack opens). Identity pair (`from_currency === to_currency`) → existing `MONEY_INVALID` (not a new export); `to_currency ≠ ledger` → `FX_RATE_NOT_LEDGER`.

**Supersede:** close the named open row (`effective_to = now` or the new `effectiveFrom`) and insert the replacement in one txn. Already-superseded + same fingerprint → idempotent success.

Rates already frozen on lines are untouched (invariants 3–4).

### 4.4 When a writer looks up a rate

| Writer | Lookup? |
|---|---|
| First post of a foreign **charge** (`folio.add_item`) | Yes — at apply time |
| First post of a foreign **payment** (capture / cash) | Yes — at the moment the folio line is written (capture/cash), **not** at authorize |
| Authorize | No. Stores `payment.currency` only. SPA may show an *indicative* ledger equivalent from the current open rate, labeled indicative |
| Reversal / split / transfer / discount / refund / chargeback reversal | **No.** Copy the source/capture line’s frozen rate |
| Night-audit ROOM / NO_SHOW / CANCEL | No. Ledger identity |
| Tax stamp | No. Ledger identity (`fx_rate = "1"`) |
| Manual FX adjustment | No. Operator supplies ledger amount; identity rate on the FX line |

---

## 5. What may be transacted in a non-ledger currency

### 5.1 Lock

**Charges default to ledger. The multi-currency surface is payments, plus optional manual charges.**

| Surface | Currency rule |
|---|---|
| Night-audit ROOM, NO_SHOW, CANCEL penalties | **Ledger only.** Snapshot / `rate_day` stay ledger (Phase 0 identity on `reservation_rate_night.currency`). |
| Tax | **Ledger only** (§2.10). |
| Damage, system ROOM posted at the desk | Ledger unless the operator explicitly passes `txnCurrency` on `folio.add_item`. |
| `folio.add_item` | May name a foreign `txnCurrency`. Requires a current `fx_rate` row. Lift `CROSS_CURRENCY_UNSUPPORTED` here. |
| `folio.authorize` / `folio.capture` / `folio.record_cash_payment` | Optional `currency` (ISO 4217). Default = stored ledger. Foreign requires a current rate **at capture/cash** (authorize stores the code only). |
| `folio.post_discount` | **Same txn currency and frozen rate as the source line.** Percent/fixed amounts are in the source’s txn units. Ledger discount via `postToLedger` at the source rate (not `ledger = txn`). |
| Transfer / split | Preserve source `txn_currency` + frozen rate. Split allocates **both** legs (§8.3). |
| FX_GAIN / FX_LOSS / CHARGEBACK_FEE | **Ledger only**, `fx_rate = "1"`. |
| Rate plans / `rate_day` / booking quote | **Ledger only.** No SPA currency picker on Rates. |

`CROSS_CURRENCY_UNSUPPORTED` remains a valid wire code for surfaces that stay ledger-only (night-audit internals, rate snapshot). It is no longer returned from `folio.add_item` / authorize / cash / capture when a rate exists.

Missing rate on a foreign payment or add_item → `FX_RATE_MISSING` (422), nothing written.

---

## 6. Residual FX gain/loss

### 6.1 At capture there is no residual

Capture (or cash) converts once at the frozen posting rate. The payment line’s `ledger_amount_minor` **is** the guest’s credit. The folio foots in ledger. Do **not** post an FX line at capture.

### 6.2 Residual is a settlement (or operator) fact

§7.3: settlement in a currency other than ledger produces a residual FX line of its own type, never absorbed into the guest charge.

Phase 1 has **no** settlement-file feed. Lock:

1. **Do not ingest settlement files this chunk** (leftover 1). The architecture rule is recorded: mismatches go to an exception queue, **never** auto-correct posted payment or charge lines.
2. **Do** ship a manual command `folio.post_fx_adjustment` so a manager can post the residual they observed on a paper/email settlement report.
3. Two system charge codes, tax-exempt (`tax_group` NULL):

```
INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('FX_GAIN', 'FX gain', 'active', 0, 0),
  ('FX_LOSS', 'FX loss', 'active', 0, 0),
  ('CHARGEBACK_FEE', 'Chargeback fee', 'active', 0, 0);
```

`SYSTEM_CHARGE_CODES` becomes

`['ROOM','PAYMENT','CANCEL','NO_SHOW','DISCOUNT','DAMAGE','FX_GAIN','FX_LOSS','CHARGEBACK_FEE']`

(length **9**). Protected from archive like the others.

### 6.3 `folio.post_fx_adjustment`

| | |
|---|---|
| Lane / degraded | `INTERACTIVE` / **FAIL_CLOSED** |
| Permission | `folio:adjust` |
| Entitlement | `pms.core` |
| Events | `folio.line_posted`, `folio.fx_adjusted` |
| Idempotent | true; fingerprint `{ reservationId, folioWindowId, kind, amountMinor, reason, sourcePaymentId? }` |
| Audit | `afterJson.reason` required |

Input: `{ reservationId, folioWindowId, kind: 'gain' | 'loss', amountMinor, reason, sourcePaymentId?, idempotencyKey }`.

- `amountMinor > 0` in **ledger** minor units. Gain posts `+amount` `FX_GAIN`; loss posts `+amount` `FX_LOSS` (both positive expense/income lines — loss increases what the property is short; gain is a credit, so **gain posts negative** `ledger_amount_minor` / `amount_minor` like a payment, loss posts positive like a charge). Lock the signs so `Σ ledger` moves the way the books need: **loss → guest/property short → positive line; gain → property long → negative line.**
- `reason` trimmed 1–500 → else `FX_REASON_REQUIRED`.
- Window `OPEN`, same reservation. Optional `sourcePaymentId` is the only linkage — event-payload-only (no `payment_id` on the line; that unique index is the capture line). Clients do **not** supply a `folioLineId`. The server allocates `folio_line_id` (UUID inside `runIdempotent`; the fingerprint is the idempotency backstop).
- Identity `PostedLineAmount` (ledger currency, `"1"`).
- Reject `kind` other than gain/loss.

This is not a silent reopen, not a mutation of the capture line, and not an auto-correction.

---

## 7. Payments ↔ folio event contract

### 7.1 Why the names diverge today

§7.3 names `payment.authorized` / `captured` / `refunded` / `failed` / `chargeback_received` and `folio.balance_due`. The tree emits `folio.payment_*` because the in-DO module *is* the folio. A future PCI Worker cannot write folio rows and the folio cannot call the gateway — the seam is the bus.

**Lock: both names exist, with different jobs.**

| Name | Role |
|---|---|
| `payment.*` (new) | Versioned **gateway-side** contract in `packages/contracts`. The payments Worker will emit these. Phase 1 in-DO simulate constructs and applies them. |
| `folio.payment_*` (existing) | Folio-side confirmation already in the catalog and SPA tests. Keep emitting. |
| `folio.balance_due` (existing) | Unchanged. Payments *may* auto-capture; actuator remains `folio.capture_due` (FAIL_CLOSED), awaited inline on live check-out. |

`event-consumer.ts` allowlists the new `payment.*` shapes and **does not** call PropertyDO. When the Worker exists, a later chunk adds the consumer→`applyPaymentEventSync` RPC. Applying in both the in-DO producer *and* the queue consumer would double-post; Phase 1 apply happens only inside PropertyDO.

### 7.2 Versioned contracts

New file `packages/contracts/src/events/payment.ts` (exported from the package barrel).

```ts
export const PAYMENT_EVENT_CONTRACT_VERSION = 1 as const;

export type PaymentEventV1 =
  | { version: 1; type: 'payment.authorized'; eventId: string; gatewayReference: string | null; payload: PaymentAuthorizedV1 }
  | { version: 1; type: 'payment.captured'; eventId: string; gatewayReference: string; payload: PaymentCapturedV1 }
  | { version: 1; type: 'payment.refunded'; eventId: string; gatewayReference: string | null; payload: PaymentRefundedV1 }
  | { version: 1; type: 'payment.failed'; eventId: string; gatewayReference: string | null; payload: PaymentFailedV1 }
  | { version: 1; type: 'payment.chargeback_received'; eventId: string; gatewayReference: string; payload: PaymentChargebackV1 };

export type PaymentAuthorizedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn
  currency: string;             // txn
  purpose: 'STAY' | 'DAMAGE';
};

export type PaymentCapturedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  capturedAmountMinor: number;  // txn
  currency: string;
  folioLineId: string;
};

export type PaymentRefundedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn, full refund
  currency: string;
  folioLineId: string;
};

export type PaymentFailedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  stage: 'authorize' | 'capture';
  reason: 'declined' | 'timeout' | 'unknown';
};

export type PaymentChargebackV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn reversed
  currency: string;
  feeLedgerMinor: number;       // ledger
  reason: string;
};
```

`folio.balance_due` payload stays `{ propertyId, reservationId, balanceMinor }` (already emitted).

Outbox `eventType` for the gateway-side message is the `type` string (`payment.captured`, …). Payload includes `version: 1` plus the V1 fields (and `eventId` / `gatewayReference` duplicated on the envelope as today: `DomainEventMessage.eventId`).

### 7.3 `applyPaymentEventSync` (the seam)

Private PropertyDO helper. Called from in-DO payment commands **after** the simulate adapter returns, inside the status txn (same as today’s capture line insert). Also the function a future consumer will RPC.

Idempotency table (v24):

```sql
CREATE TABLE payment_event (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  gateway_reference   TEXT,
  payment_id          TEXT,
  applied_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX payment_event_gateway_uidx
  ON payment_event (event_type, gateway_reference)
  WHERE gateway_reference IS NOT NULL;
```

Apply rules:

1. If `event_id` exists → return the prior result (no second line).
2. If `(event_type, gateway_reference)` exists with a **different** `event_id` → treat as already applied (redelivery with a new envelope id, same gateway id). Do not post twice.
3. Cash has `gateway_reference` NULL — idempotency is `event_id` plus the existing payment `idempotency_key` / fingerprint. Do not use the gateway unique index.
4. **`payment.authorized`:** upsert payment row `authorized` (or leave `captured` if capture already applied). **No folio line.** Clear `balance_at_risk` if it was set for an earlier failed auth of the same id.
5. **`payment.captured`:** require `capturedAmountMinor > 0`. If no payment row, **insert** `captured` (out-of-order). If row is `authorized` / `pending`, flip to `captured`. Post the negative `PAYMENT` line via `postToLedger` at the **current** rate for `currency` → ledger (freeze onto the line **and** onto `payment.fx_rate` / `payment.fx_rate_at`). If already `captured` with the same gateway reference → no-op. `folio_line_payment_uidx` is the backstop.
6. **`payment.refunded`:** require `captured`. Post a positive `PAYMENT_REFUND` line at the **capture line’s** frozen rate (read `${paymentId}:capture` or the unique `payment_id` line). `payment_id` NULL on the refund line. Status `refunded`. Full refund only.
7. **`payment.failed`:** if status is `authorized` and `stage = 'capture'` or a void-equivalent fail, leave the hold or set `voided` only when the adapter said the hold is released (`stage = 'authorize'` decline → `declined`; capture timeout → `unknown` as today). Set `balance_at_risk = 1`. **No folio line.**
8. **`payment.chargeback_received`:** see §7.5.

Money-moving apply (`captured` / `refunded` / `chargeback_received`) goes through `insertFolioLineSync` (CLOSED window → throw `WindowClosedError` → 422 / fail the apply). A chargeback against a CLOSED window requires `folio.reopen_window` first — never silent reopen.

### 7.4 In-DO producer mapping (Phase 1)

| In-DO path | Constructs / applies | Also emits (existing) |
|---|---|---|
| Authorize approved | `payment.authorized` | `folio.payment_authorized` |
| Authorize declined / timeout | `payment.failed` (`stage: 'authorize'`) | none new (status `declined` / `unknown` as today) |
| Capture approved | `payment.captured` | `folio.payment_captured`, `folio.line_posted` |
| Capture declined / timeout | `payment.failed` (`stage: 'capture'`) | none (status stays `authorized` or `unknown` as today) |
| Cash | `payment.captured` (no gateway ref) | `folio.payment_captured`, `folio.line_posted` |
| Void approved | no `payment.*` (operator release, not a gateway fail) | `folio.payment_voided` |
| Refund approved | `payment.refunded` | `folio.payment_refunded`, `folio.line_posted` |
| `folio.record_chargeback` | `payment.chargeback_received` | `folio.line_posted` |
| Check-out `balanceMinor > 0` | (unchanged) | `folio.balance_due` |

Catalog `events[]` for authorize/capture/cash/refund **gain** the `payment.*` type in addition to the existing `folio.payment_*` entries. `event-consumer.ts` allowlists both. The events-queue catalog allowlist test must see every catalog event.

### 7.5 Chargeback — ship the command (do not defer)

Folio-money-ops leftover 4 named chargebacks. §7.3 requires the event. There is no PSP chargeback feed. **Lock: `folio.record_chargeback` is the Phase 1 actuator** (same shape as `folio.capture_due` for `folio.balance_due`).

| | |
|---|---|
| Lane / degraded | `INTERACTIVE` / **FAIL_CLOSED** |
| Permission | `folio:adjust` |
| Entitlement | `pms.core` |
| Events | `payment.chargeback_received`, `folio.line_posted` |
| Idempotent | true; fingerprint `{ paymentId, feeLedgerMinor, reason }` |
| Audit | yes |

Input: `{ paymentId, feeLedgerMinor, reason, idempotencyKey }`.

- Payment must be `captured`. `refunded` / `voided` / `authorized` / `chargeback` → `PAYMENT_NOT_CHARGEBACKABLE`. Same fingerprint on `chargeback` → idempotent success.
- Window of the capture line must be `OPEN`.
- **Reversal:** positive line, `source = 'CHARGEBACK'`, `charge_code = 'PAYMENT'`, `split_of = captureLineId`, `payment_id` NULL, **same txn currency and frozen rate as the capture line** (negate both legs). Deterministic id `${paymentId}:chargeback`.
- **Fee:** `CHARGEBACK_FEE`, ledger identity, `amountMinor = feeLedgerMinor >= 0` (zero fee allowed — some schemes waive). Id `${paymentId}:chargeback-fee`.
- **Dispute:** insert `payment_dispute` `status = 'open'`.
- Payment status → `chargeback` (v24 CHECK).
- Simulate adapter is **not** called (no chargeback method this chunk).

```sql
CREATE TABLE payment_dispute (
  dispute_id              TEXT PRIMARY KEY,
  payment_id              TEXT NOT NULL,
  reversal_folio_line_id  TEXT NOT NULL,
  fee_folio_line_id       TEXT,
  reason                  TEXT NOT NULL,
  opened_at               INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  FOREIGN KEY (payment_id) REFERENCES payment(payment_id)
);
CREATE INDEX payment_dispute_payment_idx ON payment_dispute (payment_id);
```

No close-dispute command this chunk (leftover 3). `GET` payment / folio payments include `dispute: { disputeId, status, reason, openedAt } | null`.

### 7.6 `balance_at_risk`

v24 column `payment.balance_at_risk INTEGER NOT NULL DEFAULT 0 CHECK (balance_at_risk IN (0, 1))`.

Set on `payment.failed`. Cleared on a later successful capture/void of that payment. `readFolio` gains `balanceAtRisk: boolean` = any payment on the reservation has `balance_at_risk = 1` **and** reservation `balanceMinor > 0`. SPA chip; not a reservation column.

### 7.7 Nightly settlement reconciliation

**Spec’d, not built.** A later chunk compares a gateway settlement file to `folio_line` rows with `source = 'PAYMENT'`. Mismatches insert a dedicated exception (not `provisional_exception` — that table is queued-command replay). The folio **never** auto-posts a correcting PAYMENT line from a file. Operators use `folio.post_fx_adjustment` or a future resolve command. Leftover 1.

---

## 8. Existing writers — currency behaviour

Every path below must keep the CLOSED-window gate (`insertFolioLineSync`).

### 8.1 Authorize — `folio.authorize`

Optional `currency?: string` (default stored ledger). Fingerprint **includes** `currency`. `payment.currency` stores the txn code. Adapter `simulateAuthorize` already takes `currency` — pass the txn code, not the ledger. No folio line. No rate lookup. Indicative ledger equivalent is SPA-only.

Foreign currency with no open rate is **allowed at authorize** (the hold is not money). Capture will fail `FX_RATE_MISSING` if still missing — the desk must enter a rate before capture. Rationale: a guest’s card can be held before night audit publishes the day’s rate.

### 8.2 Capture — `folio.capture`

`amountMinor` is in **`payment.currency`** (txn), as today. After adapter approval:

```
posted = postToLedger(money(-capturedTxn, payment.currency), ledger, rate, now)
```

`rate` = `"1"` if same currency, else lookup(from=`payment.currency`, to=ledger, at=`now`). Persist `payment.fx_rate` / `payment.fx_rate_at` from that freeze. Line id remains `${paymentId}:capture`.

Partial capture (already legal) converts only the captured txn slice.

### 8.3 Cash — `folio.record_cash_payment`

Optional `currency` (default ledger). Fingerprint includes `currency`. Foreign cash is real (tourist tender). Rate lookup at insert. Same `postToLedger` as capture. Still no PSP. Shift attribution unchanged.

### 8.4 Void — `folio.void`

Unchanged money behaviour (no line). Currency-irrelevant. Does not emit `payment.failed`.

### 8.5 Refund — `folio.refund`

Full refund only. **Must reverse at the capture line’s frozen rate**, not `"1"` and not a current lookup.

Today (~11587–11593) posts identity — that is the bug this chunk fixes for foreign captures.

Read the capture line (`payment_id` unique or `${paymentId}:capture`):

```
amountMinor: +capture.amount_minor.abs   // capture is negative
ledgerAmountMinor: +capture.ledger_amount_minor.abs
fxRate / fxRateAt / txnCurrency: copied
source: 'PAYMENT_REFUND'
payment_id: NULL
split_of: captureLineId
```

Adapter `simulateRefund` already takes `currency` — pass `payment.currency`.

### 8.6 Split — `folio.split_charge` / `split_charge_payment` / `split_charge_v2`

Contracts unchanged (v1 stays same-window). Helper change is load-bearing:

Today `ledgerAmountMinor: split.amountMinor` (~10067) is identity.

**Lock:** `allocate` **both** legs independently with the same absolute weights and `policy: 'LAST'`, then copy `fx_rate` / `fx_rate_at` / `txn_currency`. Do **not** re-call `postToLedger` per child (`assertPostedMatches` would fail when allocated ledger ≠ converted slice). Both legs foot exactly; the frozen rate is historical.

Tax dependents: allocate `tax.amount_minor` and `tax.ledger_amount_minor` the same way (after §8.8 they are usually equal and ledger-denominated).

Reject / dest-window / `TRANSFER` child-source rules unchanged.

### 8.7 Transfer — `folio.transfer_charge`

Already copies both legs and the frozen rate. Keep that. Tax restamp on dest uses §8.8 (ledger base = dest parent’s `ledger_amount_minor`, which equals source). Do not restamp at a new FX rate.

### 8.8 Tax — `stampTaxForChargeSync`

Change the base from `parentAmountMinor` (txn) to `params.posted.ledgerAmountMinor`.

Tax `PostedLineAmount`:

```
amountMinor: taxMinor
txnCurrency: ledgerCurrency
ledgerAmountMinor: taxMinor
fxRate: '1'
fxRateAt: parent.fxRateAt   // stamp time is fine; rate is identity
```

Skip set unchanged (`PAYMENT`, `PAYMENT_REFUND`, `SPLIT_REVERSAL`, `TAX`). Also skip `CHARGEBACK`, `TRANSFER_REVERSAL`, and `charge_code IN ('FX_GAIN','FX_LOSS','CHARGEBACK_FEE')` (exempt / not a tax base).

Night-audit ROOM stays ledger, so existing tax tests keep passing.

### 8.9 Discount — `folio.post_discount`

Percent/fixed still in **source txn** units (existing math on `source.amount_minor`). Then:

```
posted = postToLedger(money(-discountTxn, source.txn_currency), ledger, source.fx_rate, source.fx_rate_at)
```

Reject set gains `CHARGEBACK` / `FX_GAIN` / `FX_LOSS` / `CHARGEBACK_FEE` as `LINE_NOT_DISCOUNTABLE`.

### 8.10 `folio.capture_due` + check-out auto-capture

Remaining is **ledger** (`SUM(ledger_amount_minor)`). A foreign hold’s `amount_minor` is txn — today’s `Math.min(hold.amount_minor, remaining)` is illegal.

For each FIFO STAY CARD hold:

1. `rate` = current lookup (or `"1"`).
2. `availableLedger = postToLedger(money(hold.amount_minor, hold.currency), ledger, rate, now).ledgerAmountMinor`.
3. `takeLedger = min(availableLedger, remaining)`.
4. `takeTxn` = `hold.amount_minor` if `takeLedger === availableLedger`; else `ledgerToTxn(takeLedger, hold.currency, ledger, rate)` (new `packages/money` helper — same BigInt / `roundHalfAwayFromZero` path as `postToLedger`, inverted). Pin a rounding test that `postToLedger(ledgerToTxn(x))` is within 1 minor of `x` (last-hold remainder may sit on the ledger side; do not loop).
5. Capture `takeTxn` via the existing capture seam (which freezes the rate).
6. `remaining -=` the **posted** `ledger_amount_minor` abs (not `takeLedger` guessed before post).

Damage holds still skipped. Live check-out still awaits the helper inline; `autoCapture` recompute-on-replay unchanged. Provisional replay still does not capture.

Cross-currency auto-capture is therefore legal. Capture failure still does not fail check-out.

### 8.11 Night audit

`POST_ROOM_CHARGES` / `PROCESS_NO_SHOWS` stay ledger identity. `no_post` skip unchanged. Closed GUEST cannot occur for `confirmed|checked_in` (existing close gates). Do not read `fx_rate` in these steps.

`SNAPSHOT_REPORTS` — §12.

### 8.12 `packages/money` addition

`ledgerToTxn(ledgerAmountMinor, txnCurrency, ledgerCurrency, fxRate): number` — inverse of `postToLedger` for the capture-due partial. Same-currency returns `ledgerAmountMinor` and requires rate `"1"`. Export from the package; no new `export class`.

---

## 9. Schema — v24 `multi_currency_folio` (FK-safe payment + byte-identical `folio_line` copy)

`packages/do-runtime/src/property-migrations.ts` version **24**, name `multi_currency_folio`. `pnpm generate:ddl` → `migrations/do-property/0024_multi_currency_folio.sql`. Pin `PROPERTY_SCHEMA_HEAD === 24`.

**`folio_line` is not backfilled and is not ALTERed in place.** The five money columns have existed since v1. Existing rows stay byte-identical (`txn_currency` / `fx_rate` / `ledger_amount_minor` unchanged). A backfill `UPDATE` would be theater and risks touching history. The lock was about avoiding that mutation — not about leaving the table name untouched.

The workerd lesson (v21): `PRAGMA foreign_keys` is not honored across DO `sql.exec` calls, and `migrateSql` runs each statement as a separate exec with no transaction, so `defer_foreign_keys` is not an option. Dropping `payment` while `folio_line.payment_id` still references it runs an implicit `DELETE FROM payment` under enforced FKs and bricks any store with a captured payment. v24 therefore rebuilds `folio_line` as a **byte-identical copy** in the payment rebuild chain (same columns, same values; child dropped first). `folio_window` stays.

### 9.1 Payment rebuild (CHECK must grow) + `folio_line` copy chain

SQLite cannot ALTER a CHECK. Status gains `chargeback`. New payment columns cannot be NOT NULL without a rebuild *or* a careful ALTER+backfill; do one rename rebuild following the v21 pattern (**no** `PRAGMA foreign_keys` wrapper).

`payment_v24` = every v21 column plus:

```
fx_rate            TEXT,
fx_rate_at         INTEGER,
balance_at_risk    INTEGER NOT NULL DEFAULT 0 CHECK (balance_at_risk IN (0, 1)),
last_payment_event_id TEXT,
status             TEXT NOT NULL
  CHECK (status IN (
    'pending','authorized','declined','captured','unknown','voided','refunded','chargeback'
  ))
```

FK-safe order (v21 minus `folio_window`):

1. `CREATE TABLE payment_v24` — FK to existing `folio_window`.
2. `CREATE TABLE folio_line_v24` — identical schema to current `folio_line`, but `FOREIGN KEY (payment_id) REFERENCES payment_v24(payment_id)` and `tax_of TEXT REFERENCES folio_line_v24(folio_line_id)`; `folio_window_id` still references `folio_window`.
3. Copy `payment` → `payment_v24` (`fx_rate` / `fx_rate_at` / `last_payment_event_id` NULL, `balance_at_risk = 0`, status unchanged). Copy `folio_line` → `folio_line_v24` byte-identically (no value changes).
4. `DROP TABLE folio_line` (child first — v21 proved self-referencing drop works in workerd), then `DROP TABLE payment` (now unreferenced).
5. `ALTER TABLE payment_v24 RENAME TO payment` (rewrites `folio_line_v24`'s payment FK), then `ALTER TABLE folio_line_v24 RENAME TO folio_line`.
6. Recreate `payment_idempotency_uidx`, `payment_reservation_idx`, and the v21 `folio_line` indexes (`folio_line_audit_uniq`, `folio_line_window_idx`, `folio_line_payment_uidx`, `folio_line_tax_uniq`, `folio_line_tax_of_idx`).

Real-SQLite test (FKs on): apply 1–23, insert window + payment + capture line + tax line, apply v24, assert counts, assert `folio_line` rows are byte-identical, assert orphan `payment_id` still throws, assert `status='chargeback'` succeeds and `'BOGUS'` fails.

`MemorySql` must accept `INSERT INTO payment_v24`, `INSERT INTO folio_line_v24`, `DROP TABLE folio_line`, `DROP TABLE payment`, `ALTER TABLE payment_v24 RENAME TO payment`, `ALTER TABLE folio_line_v24 RENAME TO folio_line`. `CREATE TABLE fx_rate` / `payment_event` / `payment_dispute` already match the generic `CREATE TABLE` prefix.

### 9.2 New tables

`fx_rate` (§4.2), `payment_event` (§7.3), `payment_dispute` (§7.5).

Register all three in `PROPERTY_PURGE_INVENTORY_TABLES` **and** add matching `(SELECT COUNT(*) FROM …)` terms in `countPropertyInventoryRows` (literal SQL — DO authorizer).

### 9.3 Charge-code seed

§6.2 `INSERT OR IGNORE` + `SYSTEM_CHARGE_CODES` length 9. `UPDATE` tax_group is **not** required (NULL = exempt).

### 9.4 Types

`PaymentStatus` union gains `'chargeback'`. `PaymentRow` gains `fx_rate`, `fx_rate_at`, `balance_at_risk`, `last_payment_event_id`.

---

## 10. Command catalog

### 10.1 New commands

| id | Lane | Degraded | Idempotent | Events | Entitlement | Permission |
|---|---|---|---|---|---|---|
| `folio.create_fx_rate` | INTERACTIVE | FAIL_CLOSED | true | `fx_rate.changed` | `pms.core` | `settings:configure` |
| `folio.supersede_fx_rate` | INTERACTIVE | FAIL_CLOSED | true | `fx_rate.changed` | `pms.core` | `settings:configure` |
| `folio.post_fx_adjustment` | INTERACTIVE | FAIL_CLOSED | true | `folio.line_posted`, `folio.fx_adjusted` | `pms.core` | `folio:adjust` |
| `folio.record_chargeback` | INTERACTIVE | FAIL_CLOSED | true | `payment.chargeback_received`, `folio.line_posted` | `pms.core` | `folio:adjust` |

All four enter `AUDIT_WRITER_COMMAND_IDS` → size **49**. None enter `ENTITLEMENT_FAIL_CLOSED_OPT_OUT`. Kill-switch on these HTTP routes is **503**.

`PLATFORM_GAPS` stays `[]`.

### 10.2 Existing commands — field / event changes

| id | Change |
|---|---|
| `folio.authorize` | Optional `currency`. Fingerprint +`currency`. Events gain `payment.authorized` (and `payment.failed` is emitted on decline/timeout — list it). |
| `folio.capture` | Implementation converts; events gain `payment.captured` / `payment.failed`. Contract input unchanged (`amountMinor` is txn). |
| `folio.record_cash_payment` | Optional `currency`. Fingerprint +`currency`. Events gain `payment.captured`. |
| `folio.refund` | Implementation copies frozen rate. Events gain `payment.refunded`. |
| `folio.void` | Unchanged contract. |
| `folio.add_item` | Lift `CROSS_CURRENCY_UNSUPPORTED` when a rate exists. Stays `QUEUE_PROVISIONAL`. Rate resolved at apply (live or replay) — a queued foreign charge uses the rate effective at replay, same class as tax restamp. Fingerprint already includes `txnCurrency` / `fxRate` / `ledgerAmountMinor` (~10199–10202); if the client omits them, the server fills after lookup **before** `runIdempotent` so a replay with a different resolved rate is `IDEM_KEY_REUSED` only when the client sent different money fields, not when the table moved. **Lock:** resolve rate **before** `runIdempotent`, put the frozen `fxRate` / `ledgerAmountMinor` into the fingerprint payload the first live/replay apply uses. First apply freezes; same key replay returns the cached line. |
| `folio.split_charge` / `split_charge_payment` / `split_charge_v2` | Contracts unchanged; helper allocates both legs. |
| `folio.transfer_charge` | Contracts unchanged; tax restamp uses ledger base. |
| `folio.post_discount` | Contracts unchanged; ledger via frozen `postToLedger`. |
| `folio.capture_due` | Contracts unchanged; remaining vs hold is ledger-aware (§8.10). |
| `reservations.check_out` | Unchanged wire (`autoCapture` already shipped). Helper path may capture foreign holds. |

`folio.add_item` stays `QUEUE_PROVISIONAL` (front-desk leftover 1). Promoting it would disable late charges during outage. Cross-currency add_item is still that command — degraded class is per id, not per payload.

### 10.3 Wire codes (`packages/contracts/src/money.ts` or `idempotency.ts`)

Money-validation outcomes stay in `money.ts` next to `CROSS_CURRENCY_UNSUPPORTED`:

```
FX_RATE_MISSING = 'fx_rate_missing'
FX_RATE_NOT_LEDGER = 'fx_rate_not_ledger'
FX_RATE_OPEN_EXISTS = 'fx_rate_open_exists'
```

Idempotency / domain outcomes in `idempotency.ts`:

```
FX_REASON_REQUIRED = 'fx_reason_required'
PAYMENT_NOT_CHARGEBACKABLE = 'payment_not_chargebackable'
```

HTTP: all of the above → **422**. Existing `PSP_UNAVAILABLE` → 501. Kill-switch → 503. `CROSS_CURRENCY_UNSUPPORTED` remains 422 for ledger-only surfaces that still reject a foreign code. Identity FX pair reuses existing `MONEY_INVALID` (also 422) — do not add a new code.

---

## 11. HTTP routes

Append at **106–110**. `check:permissions` requires matching `V1_ROUTES` order. `findRoute` is first-match.

| Index | id | Method / pattern | Permission | commandId | Entitlement |
|---|---|---|---|---|---|
| 106 | `post_fx_rates` | `POST` `/v1/properties/:pid/fx-rates` | `settings:configure` | `folio.create_fx_rate` | `pms.core` |
| 107 | `post_fx_rate_supersede` | `POST` `/v1/properties/:pid/fx-rates/:qid/supersede` | `settings:configure` | `folio.supersede_fx_rate` | `pms.core` |
| 108 | `get_fx_rates` | `GET` `/v1/properties/:pid/fx-rates` | `folio:read` | (read) | `pms.core` |
| 109 | `post_folio_chargeback` | `POST` `/v1/properties/:pid/folio/payments/:payId/chargeback` | `folio:adjust` | `folio.record_chargeback` | `pms.core` |
| 110 | `post_folio_fx_adjustment` | `POST` `/v1/properties/:pid/reservations/:rid/folio/fx-adjustment` | `folio:adjust` | `folio.post_fx_adjustment` | `pms.core` |

`get_fx_rates`: `degradedRead: 'FAIL_CLOSED'` (entitled read; no stale rates). Query `?pair=EURUSD` optional; default list open rows + current ledger code.

**Do not** put FX under `/folio/payments/fx-rates`. Existing `GET …/folio/payments/([^/]+)$` (`get_folio_payment`, earlier in the list) would capture the literal `fx-rates` as a payment id — same class as the `/reservations/search` vs `/reservations-search` lesson.

Chargeback is `…/payments/:payId/chargeback` (POST). Existing void/refund POSTs are more specific and already listed; appending chargeback does not shadow them (first-match, different suffixes). GET `…/payments/:id` is GET-only.

Mutations `FAIL_CLOSED` via `invokePropertyDo` (503, never 202). Bodies carry `idempotencyKey`.

### 11.1 Additive reads (not new routes)

**`GET …/folio` (existing `[22]`):**

- `lines[]` gain `fxRate`, `fxRateAt` (already have `amountMinor`, `ledgerAmountMinor`, `txnCurrency` — `readFolio` ~12337–12351).
- `ledgerCurrency: string` (stored code; 422/`CURRENCY_UNSET` is a write problem — if somehow unset, omit and let the client treat amounts as unlabeled).
- `balanceAtRisk: boolean` (§7.6).
- `txnBalances: Array<{ currency: string; amountMinor: number }>` — `Σ amount_minor` grouped by `txn_currency` (informational; **not** the balance gate).

**`GET …/folio/payments` and `GET …/folio/payments/:id`:** add `fxRate`, `fxRateAt`, `balanceAtRisk`, `dispute`. `currency` already present.

**Authorize / cash POST bodies:** optional `currency`.

---

## 12. Reports & night audit

| Snapshot | Rule |
|---|---|
| Occupancy | Unchanged (counts). |
| Revenue | Aggregate **`ledger_amount_minor` only**. Never sum `amount_minor` across mixed `txn_currency`. Existing `byChargeCodeAndSource[].ledgerAmountMinor` stays. FX_GAIN / FX_LOSS appear as their own charge codes in that breakdown (correct). `currency` field on the JSON remains the ledger code. |
| Cashier | Keep shift floats (already ledger). **Add** `tendersByCurrency: Array<{ currency: string; capturedMinor: number; refundedMinor: number }>` computed from `folio_line` on that `business_date` where `charge_code = 'PAYMENT'` (captured negative → `capturedMinor += abs(amount_minor)` grouped by `txn_currency`; `PAYMENT_REFUND` / `CHARGEBACK` positive → `refundedMinor`). Drawer count in EUR vs USD is why this exists. Do not convert those faces into ledger inside the cashier JSON — the revenue snapshot already has the ledger view. |

`NIGHT_AUDIT_STEPS` unchanged. No settlement step.

---

## 13. SPA

Existing `FolioScreen` (+ client-core). No new nav item. Rates UI unchanged (ledger-only).

| Control | Lock |
|---|---|
| Folio lines | When `txnCurrency !== ledgerCurrency` (or `fxRate !== '1'`), show `{txn} {amount} → {ledger} {ledgerAmount} @ {rate}`. Same-currency: today’s single amount. `data-testid="line-fx"` present only when they differ. |
| Balance | Still `balanceMinor` (ledger). Optional muted `txnBalances` line. |
| `balanceAtRisk` | Chip when true. |
| Authorize / cash | Currency `<select>`: ledger + open `fx_rate.from_currency` values from `GET …/fx-rates`. Default ledger. Indicative ledger preview on authorize (copy: “Indicative — captured at the rate in force at capture.”). |
| Capture | Amount in the hold’s `currency` (label the code). |
| Capture-due / check-out `autoCapture` | Unchanged controls; they may now settle a foreign hold. |
| Refund / void | Unchanged visibility rules (`folio:adjust` / `folio:post`). |
| Chargeback | Line/payment action, `folio:adjust`, reason + fee (ledger) required. Hidden for staff. |
| FX adjustment | `folio:adjust`; reason required; gain/loss; amount in ledger. |
| FX rates editor | Visible with `settings:configure`. List open quotes; create; supersede. Not a third nav — disclosure on FolioScreen (money context) and acceptable as the only Phase 1 editor (there is no Settings screen today; tax rules are API-only — FX needs an operator or the feature is dead). **Lock: ship the FolioScreen editor.** |
| Rates / booking | No currency picker. |

`packages/client-core`: `authorizePayment` / `recordCashPayment` gain optional `currency`; new methods for fx-rates, chargeback, fx-adjustment; widen folio / payment types. Keys via `stableKeyForOperation` (not `bookingReservationOpId` — that helper is the wizard create key).

Never print a folio in `DEGRADED` (existing). FX editor and payment currency controls disabled when folio/payments reads are not live.

---

## 14. Degraded-mode summary

| Command | Live outage | Replay |
|---|---|---|
| create/supersede fx rate, fx adjustment, chargeback, authorize, capture, cash, void, refund, capture-due, transfer, split, discount | 503 FAIL_CLOSED | n/a |
| `folio.add_item` (including foreign) | 202 queue | resolve rate (if needed) **before** `runIdempotent` on first apply; CLOSED → `provisional_exception`; `FX_RATE_MISSING` → `provisional_exception` |
| `reservations.check_out` | 202 queue | balance gate; **no** auto-capture; `autoCapture: 'skipped'` |
| `GET folio` / payments / fx-rates | 503 FAIL_CLOSED | n/a |

Rationale: rate writes and money-moving payment/FX/chargeback paths are not commutative with each other or with close. Queuing a capture would invent money on replay (§4.6 rule 5). `add_item` stays provisional so the lobby can still late-charge during outage; a foreign late charge without a rate becomes an exception, not a silent identity post.

---

## 15. Config

No new DOMAIN keys. `pms.folio.auto_capture_on_check_out` / `close_window_on_check_out` unchanged.

`pms.money.currencies_list` stays unread (leftover 2). Do not “fix” it by dual-writing the fx table.

`pms.money.currency_code` remains first-write. This chunk does not add a change-ledger-currency path.

---

## 16. Test matrix

Names are the acceptance list, not a file-split mandate. Fixture dates from property-local `business_date`.

**Migration**

1. `PROPERTY_SCHEMA_HEAD === 24`. `MemorySql` applies through 24 without `Unhandled SQL`.
2. Real-SQLite: apply 1–23 with FKs on; insert `folio_window`, `payment` (`captured`), `folio_line` ROOM + PAYMENT (`payment_id` set) + TAX; apply v24; counts preserved; `folio_line` rows byte-identical; `payment.balance_at_risk = 0`; `fx_rate` / `fx_rate_at` NULL; `status='chargeback'` insert succeeds; `'BOGUS'` CHECK fails; orphan `folio_line.payment_id` throws; `fx_rate` / `payment_event` / `payment_dispute` exist.
3. `SYSTEM_CHARGE_CODES` length 9 includes `FX_GAIN`, `FX_LOSS`, `CHARGEBACK_FEE`. `INSERT OR IGNORE` seed is idempotent on a second migrate.
4. `PROPERTY_PURGE_INVENTORY_TABLES` contains `fx_rate`, `payment_event`, `payment_dispute`; `countPropertyInventoryRows` SQL mentions all three.

**FX rates**

5. `create_fx_rate` EUR→USD (ledger USD) open row; `GET …/fx-rates` returns it. Identity EUR→EUR → 422. `to_currency` GBP when ledger is USD → `FX_RATE_NOT_LEDGER`.
6. Second open EUR→USD → `FX_RATE_OPEN_EXISTS`. Supersede closes the first (`effective_to` set) and opens the new rate. Same fingerprint → one pair of rows.
7. Staff without `settings:configure` → 403. Kill-switch `pms.core` → 503.
8. Lookup miss on add_item EUR → `FX_RATE_MISSING`, zero lines.

**Manual foreign charge + tax**

9. Ledger USD, rate EUR→USD `"1.10"`. `add_item` 10000 EUR → line `amount_minor=10000`, `txn_currency=EUR`, `ledger_amount_minor=11000`, `fx_rate="1.10"`, `fx_rate_at` set. Tax 10% of **11000** = 1100, tax line `txn_currency=USD`, `fx_rate="1"`, `ledger_amount_minor=1100`. `balanceMinor` += 12100.
10. Same-currency add_item still identity (`fx_rate="1"`); `CROSS_CURRENCY_UNSUPPORTED` is **not** returned. Regression: existing add_item tests stay green.
11. Queued `add_item` EUR (rate present) then drain → one line; rate frozen in the idempotency fingerprint; superseding the rate after success does not change the line on same-key replay.

**Payments**

12. Authorize `currency=EUR` → `payment.currency=EUR`, zero folio lines, outbox `payment.authorized` **and** `folio.payment_authorized`. Capture 10000 EUR at `"1.10"` → PAYMENT line −10000 EUR / −11000 USD, `payment.fx_rate="1.10"`. `balanceMinor` −11000.
13. Authorize EUR with **no** rate succeeds; capture without a rate → `FX_RATE_MISSING`, still `authorized`, zero lines.
14. Cash `currency=EUR` with rate → captured + PAYMENT line converted; simulate adapter not called.
15. Refund of test 12 → `refunded`, `PAYMENT_REFUND` +10000 EUR / +11000 USD, **same** `fx_rate` / `fx_rate_at` as the capture line, `payment_id` NULL. Capture line untouched. Current rate `"1.20"` is **not** used.
16. Void authorized EUR → `voided`, zero lines.
17. Capture-due: USD 5000 ROOM + EUR hold 10000 at 1.10 (11000 ledger) → captures a **partial** EUR txn via `ledgerToTxn` such that remaining ledger hits 0 (±1 minor documented); DAMAGE hold untouched.
18. Live check-out, `auto_capture_on_check_out=true`, foreign STAY hold covering the ledger balance → `autoCapture: 'captured'`, guest `checked_out`. Same-key live replay recomputes `'captured'` and does not re-await. Provisional replay → hold still `authorized`, `'skipped'`.
19. `payment.failed` on authorize decline → `declined`, `balance_at_risk=1`, `readFolio.balanceAtRisk` true when `balanceMinor>0`.
20. Out-of-order apply: `applyPaymentEventSync(payment.captured)` with no prior auth row creates `captured` + line; later `payment.authorized` does not post a second line and does not flip status back.
21. Redeliver `payment.captured` same `event_id` → one line. Same `gateway_reference` + different `event_id` → one line (`payment_event_gateway_uidx`).

**Chargeback + FX adjustment**

22. Chargeback of a captured USD payment, fee 250 → status `chargeback`, reversing PAYMENT at original rate, `CHARGEBACK_FEE` +250 ledger, `payment_dispute` open, events `payment.chargeback_received` + `folio.line_posted`. Staff 403.
23. Chargeback of `authorized` / already `chargeback` (different fingerprint) → `PAYMENT_NOT_CHARGEBACKABLE`. Same fingerprint → idempotent, one reversal.
24. Chargeback of a **foreign** capture reverses at the capture’s `fx_rate`, not `"1"`.
25. `post_fx_adjustment` loss 100 reason set → `FX_LOSS` +100 ledger, `folio.fx_adjusted`. Gain 100 → `FX_GAIN` −100 ledger. Missing reason → `FX_REASON_REQUIRED`. Does not mutate the capture line.

**Split / transfer / discount (identity regressions + FX)**

26. v1 split of a USD ROOM still foots `Σ amount` and `Σ ledger` (regression).
27. Split 60/40 of the EUR 10000 / 11000 line: reverse −10000 / −11000 at `"1.10"`; children allocate both legs with `allocate` LAST; `Σ` children txn = 10000, `Σ` children ledger = 11000; children `fx_rate="1.10"`.
28. Transfer of that EUR ROOM to COMPANY: reverse + dest copy both legs and rate; reservation `balanceMinor` unchanged; tax restamped in **USD** on dest.
29. Discount 10% of EUR 10000 / 11000 → DISCOUNT −1000 EUR / −1100 USD at `"1.10"`.
30. Split/transfer/discount of `FX_LOSS` / `CHARGEBACK` / tax → rejected with the existing not-transferable / not-discountable / not-splittable codes as applicable.

**Reports / night audit**

31. `POST_ROOM_CHARGES` still posts ROOM + tax in ledger identity; `NIGHT_AUDIT_STEPS.length === 7`.
32. Revenue snapshot `roomNet` / `taxTotal` / `byChargeCodeAndSource` use `ledger_amount_minor` only; a EUR payment on that date does **not** add 10000 into `roomNet`.
33. Cashier snapshot `tendersByCurrency` includes `{ currency: 'EUR', capturedMinor: 10000, … }` and a USD cash tender as its own row.

**Pins / gates**

34. `AUDIT_WRITER_COMMAND_IDS.size === 49`; `[105]` still `get_reservation_search`; `[106]=post_fx_rates`; `[107]=post_fx_rate_supersede`; `[110]=post_folio_fx_adjustment`.
35. `COMMAND_CATALOG` length **74**. `PLATFORM_GAPS` `[]`.
36. `event-consumer.ts` allowlists `payment.authorized`, `payment.captured`, `payment.refunded`, `payment.failed`, `payment.chargeback_received`, `fx_rate.changed`, `folio.fx_adjusted`.
37. `check:degraded` / `check:entitlements` / `check:permissions` / `check:ddl` / `check:purge` / `check:pms-core-test-dates` / `check:do-transport-guards` / `check:class-denylist` green.
38. `packages/money`: `ledgerToTxn` inverse pin; `postToLedger` EUR 10000 @ `1.10` → 11000 (existing style).
39. Kill-switch + create_fx_rate / chargeback / capture → 503.

**SPA (injected transport)**

40. Line with EUR ≠ USD shows `data-testid="line-fx"`; identity line does not.
41. Authorize currency select lists USD + EUR when an open EUR rate exists; submit sends `currency`.
42. Chargeback / FX adjustment hidden without `folio:adjust`. FX editor hidden without `settings:configure`.
43. `balanceAtRisk` chip when the read says true.

---

## 17. File map (implementation, not a plan)

| File | Role |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` + `0024_multi_currency_folio.sql` | v24 payment rebuild, three tables, charge-code seed |
| `packages/do-runtime/src/migrate.test.ts` | Head 24; MemorySql prefixes |
| `packages/do-runtime/src/folio-money-ops-migration.sqlite.test.ts` or sibling `multi-currency-folio-migration.sqlite.test.ts` | Real-SQLite FK-on + v23→v24 data upgrade |
| `packages/money/src/index.ts` | `ledgerToTxn` |
| `packages/contracts/src/events/payment.ts` | V1 payment contracts |
| `packages/contracts/src/commands/catalog.ts` | Four commands; event arrays |
| `packages/contracts/src/commands/audit-writers.ts` | +4; size 49 |
| `packages/contracts/src/money.ts` + `idempotency.ts` | Wire codes §10.3 |
| `packages/contracts/src/v1-http-routes.ts` | 106–110 |
| `apps/pms-core/src/property-do.ts` | Rate lookup; `applyPaymentEventSync`; lift identity gate; extend writers §8; purge lists |
| `apps/pms-core/src/v1-dispatch.ts` | Five handlers; widen GET folio / payments / authorize / cash |
| `apps/pms-core/src/event-consumer.ts` | Allowlist new types (no DO call) |
| `packages/client-core` + `apps/web-pms` `FolioScreen` | §13 |
| `ARCHITECTURE.md` | §20 |
| Prior specs | One-sentence amends in money / folio-charges / folio-money-ops |

---

## 18. Leftovers (named, not silent)

1. **Settlement-file ingest + settlement exception queue.** Rule locked (§7.7): never auto-correct. Not `provisional_exception`.
2. **`pms.money.currencies_list`.** Unread DOMAIN array. Do not dual-write. Retire or define later.
3. **Close / work a `payment_dispute`.** Open-only this chunk.
4. **Partial refunds** (folio-money-ops leftover 4 remainder) and authorization expiry / `unknown` exit.
5. **PCI payments Worker** consuming/producing `payment.*` via `event-consumer` → `applyPaymentEventSync`. Phase 1 apply is in-DO only.
6. **Inverse rounding policy** if `postToLedger(ledgerToTxn(x))` last-penny drift becomes a fiscal issue — pin it then, don’t invent `LARGEST_REMAINDER` now.
7. **Ledger-currency change** after first write (would invalidate open quotes and confuse frozen history).
8. **Reporting currency** in the warehouse.

---

## 19. Open questions — LOCKED

1. **FX rate source. Locked: property `fx_rate` table, staff-entered, effective-dated, freeze at post.** External feed is out. Seeded pairs are out (empty table = ledger-only, which is today’s behaviour). Rationale: simplest thing that is true; a fake feed would lie on invoices.
2. **What can be foreign. Locked: payments + optional `folio.add_item`; night-audit / rates / tax stay ledger.** International cards are the week-one case. Room revenue in a second currency is a different product (and would fight the quote snapshot).
3. **Residual FX. Locked: no line at capture; manual `folio.post_fx_adjustment`; settlement ingest deferred.** Phase 1 has no file. Auto-correcting a capture from a later rate is exactly the audit failure §7.3 forbids.
4. **Chargebacks. Locked: ship `folio.record_chargeback` this chunk.** Deferring the event contract’s only missing money-mover would leave the seam incomplete. Partial refunds stay deferred.
5. **`payment.*` vs `folio.payment_*`. Locked: both.** Architecture names the Worker seam `payment.*`; the catalog and tests already speak `folio.payment_*`. Renaming would break the catalog for no PCI gain. Dual-emit; apply once in the DO.
6. **event-consumer calls the DO. Locked: no, not this chunk.** Same as folio-money-ops §6.4. Double-apply risk.
7. **Rate at authorize vs capture. Locked: freeze at capture/cash (the post).** Auth is not money. Indicative SPA preview only.
8. **`folio.add_item` class. Locked: stay `QUEUE_PROVISIONAL`; resolve rate before `runIdempotent`.** Per-payload FAIL_CLOSED is not expressible. Promoting the command disables late charges in outage.
9. **Tax base. Locked: `ledger_amount_minor`, tax line in ledger identity.** §7.3: local tax is a ledger concern.
10. **Split ledger. Locked: allocate both legs; do not reconvert.** Reconvert breaks `assertPostedMatches` and can fail to foot.
11. **Cashier report. Locked: add `tendersByCurrency` (txn faces); revenue stays ledger-only.** The drawer is counted in the currencies in the till.
12. **`currencies_list`. Locked: ignore.** One allowlist (the fx table).
13. **`folio_line` rebuild. Locked: do not.** Columns exist since v1; identity rows are already well-formed. Rebuild risk is the v21 FK lesson with no schema gain.
14. **ARCHITECTURE revision note. Locked: this chunk updates it** (§20). Leaving closed DND / INQUIRY / PLATFORM_GAPS text as “still owed” is how the last honesty pass bit us.

None left open.

---

## 20. Drift notes (architecture vs tree vs this prompt)

Recorded so the implementer and the architecture edit do not “fix” the wrong thing.

| Claim | Reality (verified) | What this chunk does |
|---|---|---|
| Prompt: “`folio_line` gains `txn_currency` / `ledger_amount_minor` / `fx_rate` / `fx_rate_at`” | Those columns exist on the v1 freeze-gate table and survived v14/v21 rebuilds | Do **not** add or backfill them. v24 copies `folio_line` byte-identically as part of the FK-safe payment rebuild (pragma is not honored across `sql.exec`) |
| Prompt: “PropertyDO is single-currency today” | Schema is multi-column; **behaviour** is identity-rate via `CROSS_CURRENCY_UNSUPPORTED` | Lift the gate on the surfaces in §5 |
| ARCHITECTURE §7.3 events are `payment.*` | Tree emits `folio.payment_*` only | Dual-emit; versioned `payment.*` contracts |
| ARCHITECTURE “Still owed: FX rate sourcing” (lines 52–54) | Still true until this chunk ships | Close that sentence in the same PR as the code |
| Revision **2026-08-12** (lines 56–60) lists DND, additional guests, recurring, reg cards, HK tabs, global search, and INQUIRY/PENDING drift as remaining | Prototype-holes sweep **closed** the unnamed table; lifecycle restored INQUIRY/PENDING; §16.5 body already says the table is a decision record | Rewrite the 2026-08-12 blurb (or add **2026-08-13**) so it does not re-open closed items. Point remaining Phase 1 money work at this spec until shipped |
| §16.5 (~2182–2184) still calls `folio.transfer_charge` / `folio.split_charge_v2` / `rooms.set_ooo_range` “build debt” | `PLATFORM_GAPS = []`; all three shipped | Strike that paragraph; they are not debt |
| Folio-money-ops scope-out: “Multi-currency conversion (already shipped; Phase 1 identity-rate rule unchanged)” | Conversion helpers shipped; identity rule is what this chunk changes | Amend that spec with one sentence |
| Folio-money-ops leftover 4: “Partial refunds and chargebacks” | Chargebacks land here | Split the leftover: chargebacks closed; partial refunds remain |
| `splitFolioLineSync` / discount / refund / `capture_due` / `stampTaxForChargeSync` | Identity `ledger = txn` | §8 — these are the consistency bugs, not new features |
| `pms.money.currencies_list` | Exists, unread | Leftover 2; not a second rate source |
| `event-consumer` “consumes” payment events | Allowlist only | Stays allowlist |
| Prompt: routes at 106 | Audit length is **106** (indices 0–105). Next free **106** | Append 106–110 |
| Prompt: catalog 70, audit writers 45, schema 23 | All three match | 74 / 49 / 24 after this chunk |
| `round_half_up` vs `roundHalfAwayFromZero` | The function is `roundHalfAwayFromZero` | Use that name in code and tests |
| `stableKeyForOperation` vs `bookingReservationOpId` | Folio client keys are `stableKeyForOperation`; the latter is the wizard create fingerprint | Do not mix them |

**ARCHITECTURE.md edit (same PR as the implementation, not a silent skip):**

1. Add **Revision 2026-08-13** at the top: prototype-holes decisions closed; INQUIRY/PENDING drift closed; transfer/split/OOO shipped; this spec is the multi-currency + event-contract design; FX sourcing is no longer “still owed” once the chunk merges.
2. Rewrite the 2026-08-12 paragraph (lines 56–60) so it is a historical note, not an open punch list.
3. Drop or narrow “Still owed: FX rate sourcing…” (lines 52–54).
4. §16.5 “Catalogued implementation gaps… `folio.transfer_charge`…” — delete or mark shipped.

---

## 21. Acceptance (reviewer checklist)

- Three currencies are a rule, not a comment: reporting currency never enters the DO; balances and night-audit revenue sum `ledger_amount_minor` only.
- `folio_line` is a byte-identical copy rebuild (no data mutation, no backfill); v24 is payment CHECK + the FK-safe folio_line chain + new tables + seeds; real-SQLite upgrades a populated v23 store.
- Rates are staff-entered, effective-dated, frozen at post; no feed; no seeded pairs.
- Payments + optional add_item are the foreign surface; ROOM/tax/rates stay ledger.
- Residual FX is a separate line via a manual command; capture does not invent one; settlement ingest is a named leftover.
- `payment.*` v1 contracts exist; in-DO apply is the seam; event-consumer does not write the DO; dual-emit keeps `folio.payment_*`.
- Chargeback is a command (reversal at original rate + fee + dispute), not a deferred sentence.
- Reversal / split / transfer / discount / refund / tax / `capture_due` have explicit currency rules; identity `ledger = txn` is gone from those helpers.
- New commands are FAIL_CLOSED with rationale; `add_item` stays QUEUE_PROVISIONAL.
- Routes append at 106; no `/folio/payments/fx-rates` shadow.
- Audit writers 49; catalog 74; `SYSTEM_CHARGE_CODES` 9; purge lists include the three new tables.
- Open questions section has zero unresolved items.
- Out of scope includes reporting currency, live FX, settlement files, PCI Worker, partial refunds.
- ARCHITECTURE revision-note debt is a named deliverable, not a later cleanup.
