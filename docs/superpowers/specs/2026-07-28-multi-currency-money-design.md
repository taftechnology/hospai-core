# Multi-currency money (Phase 0 — ledger shape)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §7.3, §14; freeze-gate `folio_line`; config `pms.money.currency_code`

## Purpose

Pin the **ledger shape** for money before folio and cashiering commands land in Phase 1. The PropertyDO schema already stores transaction + ledger amounts and a frozen FX rate per line (freeze gate §14); `packages/money` is still a 27-line single-currency helper with no cross-currency guard, no FX validation, and no structured-clone contract.

Phase 0 delivers the **types and pure functions** that every folio posting, split, and event payload will use. It does **not** deliver FX sourcing, payment gateway integration, or settlement reconciliation.

## Why now

| Factor | State |
|---|---|
| `folio_line` schema | Already multi-column — freeze gate done; generator and on-disk `0001` agree |
| `tryAddFolioLine` | Writes all five money columns; validates none |
| Folio command surface | Otherwise unbuilt — almost nothing to migrate |
| Phase 1 dependency | Inventory → … → **folio** → cashiering; money blocks event payloads and DO guards |

Everything else on the Phase 0 tail (Queues, LaneGuard, Clerk, observability) is additive at an existing seam. Money is a **shape** decision: once folio commands post against an untyped single-currency `Money`, changing it is a fleet migration plus event-contract rewrite.

## Scope

**In**

- Expand `@hospai/money` with typed, structured-clone-safe primitives (see **Types**)
- Cross-currency **addition rejected at runtime** (`CurrencyMismatchError`); **compile-time** guard when both operands use literal codes via `currencyCode('EUR')` → `Money<'EUR'>` (generic erases at RPC — no runtime cost)
- FX rate as **decimal string** (never float); frozen-at-post semantics validated at the package boundary
- `allocate(total, weights, opts?)` with explicit **remainder policy**; **positive weights enforced**
- `postToLedger(txn, ledgerCurrency, fxRate, fxRateAt)` — pure conversion producing `PostedLineAmount`
- **`roundHalfAwayFromZero`** for FX conversion — reversals foot exactly (+2.5→+3, −2.5→−3, sum zero)
- Wire codes in `@hospai/contracts`: `MONEY_INVALID`, `FX_RATE_INVALID`, `LEDGER_AMOUNT_MISMATCH`, `CURRENCY_UNSET`
- `tryAddFolioLine`: validate **before** `try/catch`; wrap in `runIdempotent` + `transactionSync`; emit `folio.line_posted`
- `ensureCurrencyIfAbsent` at provision (mirror `ensureTimeZoneIfAbsent` — no silent USD default for ledger reads)
- Vitest: cross-currency add; FX validation; allocate foots + rejects negative weights; structured-clone; reversal rounding

**Out**

- FX rate providers, hedging, daily revaluation, treasury
- Payment gateway Worker, `payment.*` event handlers, settlement file reconciliation
- Reporting / consolidation currency (warehouse only — never PropertyDO per §7.3)
- Residual FX gain/loss line type and posting command (Phase 1 folio)
- Tax-line remainder regulation (Phase 3 fiscalization — policy hook only)
- Cashiering, shift/drawer, city ledger

## Currency roles (normative)

| Role | Meaning | Stored in PropertyDO? | Balances in |
|---|---|---|---|
| **Transaction (`txn`)** | What the line was denominated in | Yes — `folio_line.amount_minor` + `txn_currency` | Window subtotals by txn currency |
| **Property / ledger** | Property books, night audit, local tax | Yes — `folio_line.ledger_amount_minor`; from stored `pms.money.currency_code` row | Folio balance, audit totals |
| **Settlement** | What the acquirer settled in | No — payments Worker + warehouse | Reconciliation only |
| **Reporting / consolidation** | Chain rollup currency | No — warehouse only | Never DO |

**Ledger is authoritative for "does this folio foot?"** Window balance queries sum `ledger_amount_minor` in property currency.

**Same-currency posting:** when `txn_currency === ledger_currency`, `fx_rate` must be exactly `"1"` and `ledger_amount_minor === amount_minor`.

## Types

All types are **plain objects** (no classes) — structured-clone and DO-RPC safe. Branding is compile-time only and erases at runtime like any TS type.

```ts
declare const CurrencyCodeBrand: unique symbol;
export type CurrencyCode = string & { readonly [CurrencyCodeBrand]: typeof CurrencyCodeBrand };

/** Generic parameter enables compile-time same-currency add; erases at runtime. */
export type Money<C extends CurrencyCode = CurrencyCode> = {
  amountMinor: number;
  currency: C;
};

export type FxRate = string; // validated decimal string, never float

export type PostedLineAmount = {
  amountMinor: number;
  txnCurrency: CurrencyCode;
  ledgerAmountMinor: number;
  fxRate: FxRate;
  fxRateAt: number;
};

export type RemainderPolicy = 'LAST' | 'FIRST';
```

**Construction:** `currencyCode<C extends string>(raw: C): CurrencyCode & Uppercase<C>` validates ISO 4217 shape and **preserves the literal** so `currencyCode('EUR')` and `currencyCode('USD')` are distinct types. Dynamic strings widen to `CurrencyCode`. `money(amountMinor, currency)` validates integer minor units.

**Cross-currency arithmetic:** `add(a, b)` / `subtract(a, b)` require matching `currency` at runtime; with `Money<'EUR'>` and `Money<'USD'>` the call is a compile-time error. No `addMixed` escape hatch.

## FX rate rules

1. **Format:** non-empty decimal string; regex `^-?\d+(\.\d+)?$`.
2. **Frozen at post:** `fx_rate` + `fx_rate_at` supplied by caller; package does not fetch rates.
3. **Conversion:** integer/rational math only; `roundHalfAwayFromZero` on the product. **Why half-away-from-zero:** reversals foot exactly — `post(+2.5)→+3` and `post(−2.5)→−3` sum to zero; half-up leaves a one-minor residue on every credit.
4. **Identity:** rate `"1"` when currencies match → equal ledger and txn amounts.
5. **No recomputation** of historical ledger columns.

## Allocation / rounding

- Weights must be **strictly positive** (`> 0` each; sum `> 0`).
- Output parts sum exactly to `totalMinor`.
- Default policy `LAST`; opt-in `FIRST`.
- Phase 3 may add `LARGEST_REMAINDER` for tax.

## Property currency (ledger)

**Register default `USD` is for display fallback only.** Ledger decisions use `readStoredLedgerCurrencySync()` — reads `property_config` row for `pms.money.currency_code`, returns `null` if absent (same pattern as timezone).

**Provision:** `ProvisionPropertyInput.currency` is **required** (same as `timeZone` — never derived from timezone). `ensureCurrencyIfAbsent(code, idem)` writes the first DOMAIN row at provision; no row → `CURRENCY_UNSET` on folio post.

## PropertyDO — `tryAddFolioLine`

No schema migration. Phase 0 makes the command match catalog `folio.add_item`:

| Catalog claim | Phase 0 implementation |
|---|---|
| `idempotent: true` | `runIdempotent` + fingerprint allowlist |
| `events: ['folio.line_posted']` | `appendOutbox` in same txn |

**Validation order (before `try/catch`):**

1. Entitlement gate (existing)
2. `readStoredLedgerCurrencySync()` → `CURRENCY_UNSET` if null
3. `@hospai/money` validate txn, FX, ledger match → wire codes on failure
4. `transactionSync` → `runIdempotent` → INSERT + outbox

The `try/catch` block retains meaning: **unexpected storage failure only** (not validation).

## Wire codes (`@hospai/contracts`)

```ts
export const MONEY_INVALID = 'money_invalid' as const;
export const FX_RATE_INVALID = 'fx_rate_invalid' as const;
export const LEDGER_AMOUNT_MISMATCH = 'ledger_amount_mismatch' as const;
export const CURRENCY_UNSET = 'currency_unset' as const;
```

Package throws typed errors; PropertyDO maps to wire codes. Never return `e.message` for validation failures.

## Contracts / events

Re-export `PostedLineAmount` as `FolioLineAmount` from `@hospai/contracts`. `folio.line_posted` payload carries the money columns.

## Test contract

1. Cross-currency `add` throws at runtime; `Money<'EUR'>` + `Money<'USD'>` fails typecheck.
2. `currencyCode('nonsense')` throws.
3. Same-currency post → rate `"1"`, equal amounts.
4. Cross-currency fixture → deterministic ledger minors.
5. Invalid FX strings → `FX_RATE_INVALID`.
6. Ledger column drift → `LEDGER_AMOUNT_MISMATCH`.
7. `allocate(100, [-1, 2])` throws; `allocate(100, [1,1,1])` sums to 100.
8. Reversal rounding: + and − half-unit conversions sum to zero.
9. Idempotent replay of same folio line key does not double-post.
10. structuredClone round-trip on exported types.

## Invariants

1. **No floats** in money paths.
2. **Ledger balance** sums `ledger_amount_minor` in property currency only.
3. **Rate frozen at post.**
4. **Structured-cloneable** plain objects.
5. **`@hospai/money`** has no Cloudflare / D1 / DO imports.

## Acceptance

1. `@hospai/money` exports typed API; tests green
2. `tryAddFolioLine` idempotent + emits `folio.line_posted` + wire-code validation
3. Provision writes `pms.money.currency_code` via `ensureCurrencyIfAbsent`
4. No new PropertyDO migration
5. Full pipeline green
