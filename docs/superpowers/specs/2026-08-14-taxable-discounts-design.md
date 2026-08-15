# Taxable discounts (tax restamp on discount)

**Tree verified 2026-08-14:** `COMMAND_CATALOG` length **77** (`register.test.ts` ~627), `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (~619), `[101] post_folio_refund` / `[102] post_folio_discount` (`v1-http-routes.ts` ~565–577), `AUDIT_WRITER_COMMAND_IDS.size === 52` (~626), `PROPERTY_SCHEMA_HEAD === 27` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1055–1062), `PLATFORM_GAPS === []` (~628).

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** ARCHITECTURE.md §7.3 (append-only ledger; tax engine behind interface; city ledger is not a folio variant); [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.3 (manual discounts; leftover **5**); [tax posting](./2026-08-07-tax-posting-design.md) (§2.2 `folio_line_tax_uniq`, §2.4 `tax_group` NULL = exempt, §2.5 engine skips); [partial refunds](./2026-08-14-partial-refunds-design.md) (leftover 4 closed — do not reopen); `packages/contracts/src/commands/catalog.ts` (`folio.post_discount`); `packages/contracts/src/v1-http-routes.ts` (`post_folio_discount`); `packages/contracts/src/commands/audit-writers.ts`; `packages/do-runtime/src/idempotency.ts` (`runIdempotent` sync-only); `packages/do-runtime/src/property-migrations.ts` (`DISCOUNT` seed, `SYSTEM_CHARGE_CODES`); `packages/money/src/index.ts` (`computeTax`, `postToLedger`); `apps/pms-core/src/property-do.ts` (`tryPostDiscount`, `stampTaxForChargeSync`, `insertFolioLineSync`, transfer restamp); `apps/pms-core/src/v1-dispatch.ts` (`handlePostFolioDiscount`); `packages/client-core/src/api.ts` (`postDiscount`); `apps/web-pms/src/screens/FolioScreen.tsx` / `FolioScreen.test.tsx`; `apps/pms-core/test/folio-fx-split-transfer.spec.ts`; `apps/pms-core/test/tax-posting.spec.ts`; `apps/pms-core/test/folio-routes.spec.ts`; `apps/pms-core/test/folio-extras.spec.ts`

**Closes:** [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **5** — **taxable discounts** / tax restamp when discounting a taxed product line.

**Amends:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.3 (discount posts stamp tax on the discount parent; `DISCOUNT.tax_group` stays NULL) and §19 leftover **5** (closed). [tax posting](./2026-08-07-tax-posting-design.md) §2.5 skip list / stamp notes — discount restamp uses **`chargeCode` = source product code**, not `DISCOUNT`; `source = 'DESK'` discount parents are **not** skipped. Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Folio-money-ops §7.3 shipped line-level manual discounts: `folio.post_discount` inserts a negative `DISCOUNT` row linked via `split_of` to the source charge. The seed sets `DISCOUNT.tax_group` NULL (exempt as a standalone code). `tryPostDiscount` does **not** call `stampTaxForChargeSync`, so discounting a taxable `ROOM` leaves the original `TAX` line at the full pre-discount amount — net tax is wrong.

Transfer already solves the analogous problem on the **destination** parent: after inserting the transferred charge, `stampTaxForChargeSync` runs with `chargeCode: source.charge_code` and the dest line as parent (`property-do.ts` ~13079–13094). Discount must restamp tax **on the new DISCOUNT line** using the **source product’s** tax group, without mutating the source charge or its existing tax rows.

**Why not restamp on the source line?** `folio_line_tax_uniq` on `(tax_of, tax_rule_id) WHERE source = 'TAX'` already holds one tax row per rule on the original ROOM parent. A second stamp there would violate the index. Append-only correction is a **new** negative DISCOUNT parent plus negative tax children — same pattern as transfer’s new dest parent, except the discount line **is** the new parent.

This chunk extends the **existing** command and HTTP route. No new catalog id, no new audit row, no schema migration.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Discount DO path | `tryPostDiscount` — `property-do.ts` ~12695–12840: percent/fixed in source txn; `postToLedger` at source frozen FX; inserts `chargeCode: 'DISCOUNT'`, `source: 'DESK'`, `splitOf: source.folio_line_id`. Wrapped in `runIdempotent` inside `transactionSync`. **Does not call `stampTaxForChargeSync`.** Rejects `SPLIT_REVERSAL` / `TAX` / `PAYMENT` / `PAYMENT_REFUND` / `TRANSFER_REVERSAL` / `DISCOUNT` / `CHARGEBACK` / `FX_GAIN` / `FX_LOSS` / `CHARGEBACK_FEE`. |
| Tax stamp helper | `stampTaxForChargeSync` ~1688–1748: skips parent sources `PAYMENT`, `SPLIT_REVERSAL`, `TAX`, `PAYMENT_REFUND`, `CHARGEBACK`, `TRANSFER_REVERSAL`; skips codes `FX_GAIN` / `FX_LOSS` / `CHARGEBACK_FEE`; looks up `tax_group` from **`params.chargeCode`**; NULL → return; `computeTax(params.posted.ledgerAmountMinor, rule.rate)`; tax lines `source: 'TAX'`, `taxOf: parentLineId`, id `` `${parentLineId}:tax:${rule.tax_rule_id}` ``; tax money in ledger currency / `fxRate: '1'`. **Does not skip `source: 'DESK'`.** |
| Transfer restamp (reference) | ~13079–13094: after dest parent insert, `stampTaxForChargeSync` with `chargeCode: source.charge_code`, `postingDate: resolvePostingBusinessDateSync()`. Source TAX reversed separately as `TRANSFER_REVERSAL`; cannot restamp onto same source parent because `folio_line_tax_uniq` holds original TAX. |
| `DISCOUNT` seed | `SYSTEM_CHARGE_CODES` includes `'DISCOUNT'` (`property-migrations.ts` ~395–405). `INSERT OR IGNORE` `('DISCOUNT', 'Discount', …)` with **no** `tax_group` update (~754–755). NULL = exempt per [tax posting](./2026-08-07-tax-posting-design.md) §2.4. |
| `computeTax` | `packages/money/src/index.ts` ~164–174: BigInt × rate, `roundHalfAwayFromZero`. Negative `baseMinor` is valid (no non-negative guard). Unit tests today only cover positive bases (`index.test.ts` ~71–89). |
| Command | `folio.post_discount` — `catalog.ts` ~473–481: `INTERACTIVE`, `FAIL_CLOSED`, `idempotent: true`, `permission: 'folio:adjust'`, events `['folio.line_posted']`, `entitlement: 'pms.core'`. Already in `AUDIT_WRITER_COMMAND_IDS` (`audit-writers.ts` ~33). |
| HTTP | `[102] post_folio_discount` — `v1-http-routes.ts` ~572–577; `handlePostFolioDiscount` ~5045–5101. Body `{ kind, bps?, amountMinor?, reason, folioLineId, idempotencyKey }`. Fingerprint `{ sourceFolioLineId, kind, bps, amountMinor, reason }`. Response `{ ok: true, folioLineId }` (discount line only). **Do not move `[102]`.** |
| Client | `postDiscount` — `packages/client-core/src/api.ts` ~925–946. Unchanged contract. |
| SPA | `FolioScreen.tsx` discount UI (`folio:adjust`); `data-testid="post-discount"` (~1309). `FolioScreen.test.tsx` case **55** (~688–708) — reason gate only. GET folio already renders TAX children when present. **No new discount controls.** |
| Events | `insertFolioLineSync` ~12283+ emits `folio.line_posted` for every insert (discount + each tax line). |
| Closed window | `insertFolioLineSync` CLOSED-window gate unchanged. Payments `FAIL_CLOSED`. `runIdempotent` sync-only. |
| Tests (must update / add) | `folio-fx-split-transfer.spec.ts` case **29** (~184–218): EUR ROOM + 10% discount; **does not call `seedRoomTax` today** (case **30** does for rejects); asserts DISCOUNT FX only — **implementation adds `seedRoomTax` and discount-tax assertions.** `tax-posting.spec.ts`: **no** discount cases today. `folio-routes.spec.ts`: `provisionHotel` + `worker.fetch` + `x-dev-actor` pattern; **no** discount HTTP case. `folio-extras.spec.ts` cases **40–41**: MISC discount without tax-rule setup (MISC seed is `GOODS` — no stamp without rules). |
| Catalog / audit / gaps | `COMMAND_CATALOG` length **77** (`register.test.ts` ~627). `AUDIT_WRITER_COMMAND_IDS.size === 52` (~626). `PLATFORM_GAPS = []` (~628). `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (~619). |
| Schema heads | `PROPERTY_SCHEMA_HEAD === 27` (`migrate.test.ts` ~618). `ORG_SCHEMA_HEAD === 7` (~619). Tax columns (`tax_of`, `tax_rule_id`, uniq) already exist. **No v28.** |
| Night audit | `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1055–1062). Demo seed untouched. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** |
| `COMMAND_CATALOG` | length **77** | **77** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **27** | **27** (no migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |

### 1.2 Scope in

1. After inserting the DISCOUNT line inside the existing `tryPostDiscount` / `runIdempotent` txn, call **`stampTaxForChargeSync`** with the locked parameter shape (§2).
2. Original source charge + original TAX rows **untouched**; new negative TAX children on the discount line.
3. Exempt sources (`tax_group` NULL or no applicable rules) → DISCOUNT only, no tax (no new error).
4. Per-line rounding accepted; name true-up as leftover (§9).
5. Tests §7 (DO + HTTP + money unit).
6. **`computeTax` negative-base unit test** in `packages/money/src/index.test.ts`.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Stay-level discount (no source line) — folio-money leftover **6**
- Promo codes — folio-money leftover **7**
- Authorization expiry / `unknown` reconciliation
- City ledger / AR, invoices, night-audit auto-transfer (would grow `NIGHT_AUDIT_STEPS`)
- Recurring charges / `breakfast_rule`
- Chargeback of remainder after partial refund ([partial refunds](./2026-08-14-partial-refunds-design.md) leftover — do not reopen partial refunds)
- Real PSP / PCI
- Guest CRM depth, virtual-type leftovers, `rooms.delete`
- Dry run 2
- New catalog command / new HTTP audit row / schema v28
- Demo seed rewrite
- Setting `DISCOUNT.tax_group` globally
- Reverse original TAX + restamp on source (`folio_line_tax_uniq` forbids)
- True-up so net tax equals `computeTax(remaining)` exactly
- Reallocate discount/tax when later splitting the source ROOM
- Inclusive / non-`PERCENTAGE` tax (engine still skips non-`PERCENTAGE` rules)
- Changing transfer restamp behaviour
- New `export class`
- `CLASS_DENYLIST` / `PROPERTY_PURGE_INVENTORY_TABLES` unchanged
- `ui-kit` adoption beyond token compliance if a touched file fails `check:web-pms-colors`

---

## 2. Behaviour / stamp algorithm (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Same command / route

Extend **`folio.post_discount`** / **`[102] post_folio_discount`**. No new catalog id, no new HTTP audit row; last audit stays **`[127] = post_demo_seed`**. Do not move **`[102]`**. HTTP body, fingerprint, and **`{ ok: true, folioLineId }`** response **unchanged** (returns discount line id only). Tax lines appear on **GET folio** only.

### Lock 2 — Restamp shape

After inserting the DISCOUNT line (same txn, still inside `runIdempotent`), call existing **`stampTaxForChargeSync`** with:

| Param | Value |
|---|---|
| `parentLineId` | discount `folioLineId` (`input.folioLineId`) |
| `parentSource` | `'DESK'` (discount line’s source — **not** in today’s skip list) |
| `chargeCode` | **`source.charge_code`** (`ROOM` / `DAMAGE` / `MISC` / …) — tax_group lookup uses the **discounted product**, not `DISCOUNT` |
| `posted` | the discount `PostedLineAmount` (negative txn + negative ledger at source frozen FX from existing `postToLedger` call) |
| `postingDate` | `resolvePostingBusinessDateSync()` — **same as transfer restamp**, current business date, not the source line’s original posting date |
| `folioWindowId` / `reservationId` | source’s |
| `parentAmountMinor` | pass through for API symmetry (helper uses `posted.ledgerAmountMinor` for tax base) |

**Result:** original ROOM + original TAX **untouched**; new DISCOUNT (negative) + new TAX line(s) (negative, `tax_of` = discount line, existing output charge codes from rules). Net tax ≈ `tax(source) + tax(discount)` where `tax(discount)` is negative.

### Lock 3 — Do not reverse original tax

Do **not** insert `TRANSFER_REVERSAL` / reversal rows against the source’s existing TAX lines. Do **not** invent `DISCOUNT_TAX` / `DISCOUNT_TAX_REVERSAL` charge codes. Do **not** mutate parent line amounts. `folio_line_tax_uniq` on `(tax_of, tax_rule_id) WHERE source = 'TAX'` forbids a second tax row on the source parent.

### Lock 4 — Do not change `DISCOUNT.tax_group`

Seed stays NULL (exempt as a standalone code). Passing `chargeCode: 'DISCOUNT'` into stamp would no-op; that is why lock 2 passes **source** charge code.

### Lock 5 — Exempt source

If source `charge_code` has `tax_group` NULL or no applicable `PERCENTAGE` rules on `postingDate`, `stampTaxForChargeSync` no-ops (today’s behaviour for that code). **No extra error.**

### Lock 6 — Per-line rounding accepted

`tax(S) + tax(-D)` may differ from `tax(S - D)` by **1 minor** unit. Do **not** true-up. Name “discount tax true-up to remaining” as a leftover (§9). Do not reverse+restamp remaining onto the source.

### Additional invariants (from architecture)

7. **Folio append-only.** Never `UPDATE folio_line.amount_minor` / `ledger_amount_minor`. Discount correction is new lines only.
8. **`FAIL_CLOSED`.** Discount stays interactive / entitled; never queued on provisional replay.
9. **`runIdempotent` sync-only** inside `transactionSync`; idempotent replay returns cached `{ folioLineId }` without duplicate tax (`folio_line_tax_uniq` + idempotency table).
10. **CLOSED window** — tax inserts flow through `insertFolioLineSync`; same `WINDOW_CLOSED` reject as discount parent.
11. **Events** — no new wire codes; catalog events already `folio.line_posted`; each tax insert emits via `insertFolioLineSync`.
12. **FX on discount tax** — tax base is **`posted.ledgerAmountMinor`** (negative ledger amount at frozen source FX); tax lines use ledger currency and `fxRate: '1'` (mirror existing `stampTaxForChargeSync` ~1736–1741).
13. **Catalog / audit / schema / night audit / demo seed / gaps** — all heads unchanged (§1.1 table).

---

## 3. Commands / HTTP / fingerprint (unchanged)

| | |
|---|---|
| Command | `folio.post_discount` — `catalog.ts` ~473–481 |
| HTTP | `[102] post_folio_discount` — `POST /v1/properties/:pid/folio/lines/:lid/discount` |
| Permission | `folio:adjust` |
| Body | `{ kind: 'percent' \| 'fixed', bps?, amountMinor?, reason, folioLineId, idempotencyKey }` — source line id is path param `:lid` only (`handlePostFolioDiscount` ~5047 decodes to `sourceFolioLineId`; **not** a JSON body field) |
| Fingerprint | `{ sourceFolioLineId, kind, bps, amountMinor, reason }` — `sourceFolioLineId` from path `:lid` (~5070–5075) |
| Success | `{ ok: true, folioLineId }` — discount line id only |
| Client | `postDiscount` — `api.ts` ~925–946 — **no change** |

Discount amount rules remain folio-money §7.3 (percent bps 1–10000; fixed positive ≤ source; reason 1–500; source `amount_minor > 0`; blocked sources/codes → `LINE_NOT_DISCOUNTABLE`).

---

## 4. Schema

**None.** `PROPERTY_SCHEMA_HEAD` stays **27**. Tax columns and `folio_line_tax_uniq` already shipped in [tax posting](./2026-08-07-tax-posting-design.md). No migration, no `DISCOUNT` seed change.

---

## 5. SPA

**No product change preferred.**

- Existing discount controls in `FolioScreen.tsx` (`folio:adjust`, `data-testid="post-discount"`) unchanged.
- No simulate copy, no restamp UI, no new permissions.
- GET folio already lists lines; TAX children with `taxOf` pointing at the discount line render like any other tax row.
- RTL: touch `FolioScreen.test.tsx` **only** if a mock would break; case **55** (reason gate) should remain valid.
- If any SPA file is touched incidentally, keep `check:web-pms-colors` clean (tokens / ui-kit only).

---

## 6. Errors (existing only)

No new wire codes. Unchanged reject paths from `tryPostDiscount`:

| Code | When |
|---|---|
| `NOT_FOUND` | Source line missing |
| `DISCOUNT_REASON_REQUIRED` | Reason empty / whitespace / > 500 |
| `LINE_NOT_DISCOUNTABLE` | Blocked source/charge_code; non-positive source; fixed amount invalid |
| `WINDOW_CLOSED` | Source window closed |
| `MONEY_INVALID` | Invalid percent bps |
| `FORBIDDEN` / `not_member` | Missing `folio:adjust` |
| `ENTITLEMENT_REQUIRED` / `ENTITLEMENT_UNAVAILABLE` | Core entitlement |
| `IDEM_KEY_REUSED` | Idempotency fingerprint mismatch |
| `CHARGE_CODE_NOT_FOUND` | `DISCOUNT` code missing/inactive |

Exempt / no applicable rules → **success** with DISCOUNT only (not an error).

---

## 7. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Do **not** `vi.spyOn` into the DO isolate. Prefer `tax-posting.spec.ts` and/or `folio-fx-split-transfer.spec.ts` for DO cases; HTTP via `folio-routes.spec.ts` or `tax-posting.spec.ts` (`provisionHotel` + `worker.fetch` + `x-dev-actor` — **do not invent `provisionedPropertyWorker`**).

### DO (`property-do` stub)

| # | Case | Assert |
|---|---|---|
| 1 | Taxable `ROOM` + active `%` rule; **percent** discount | DISCOUNT negative + TAX negative with `taxOf` = discount line; **original TAX on ROOM unchanged**; `folio_line_tax_uniq` holds |
| 2 | Same setup; **fixed** discount | Same tax shape |
| 3 | Exempt source — **`MISC` is not NULL in seed** (v15 sets `tax_group = 'GOODS'`, `property-migrations.ts` ~485). Clear explicitly: HTTP `patchChargeCode(propertyId, owner, 'MISC', { taxGroup: null })` (`tax-posting.spec.ts` helper ~201, Test 2 ~365–366); DO stub: `tryUpdateChargeCode` with `{ taxGroup: null }` (`property-do.ts` ~10673). Post MISC (no GOODS rules active, or group null), then discount | DISCOUNT only; **no** tax on discount |
| 4 | Stacked two `%` rules on source group | **Two** negative tax lines on discount (distinct `tax_rule_id`; find via `taxOf` = discount line id) |
| 5 | **FX** — update `folio-fx-split-transfer.spec.ts` case **29**: **add** `seedRoomTax` (not present today) before EUR ROOM post; then discount | Existing DISCOUNT FX assertions (~213–218) unchanged. **`seedRoomTax` also stamps positive TAX on the ROOM parent** — do not assert discount tax via `chargeCode === 'TAX'` alone. Find discount tax via `taxOf === discountFolioLineId` and/or id `` `${discountFolioLineId}:tax:${ruleId}` ``; expect negative ledger amounts at `fxRate: '1'`. ROOM’s original TAX stays positive on the ROOM parent |
| 6 | Existing rejects still `LINE_NOT_DISCOUNTABLE` | `TAX`, `DISCOUNT`, `FX_LOSS`, … — reuse case **30** pattern or dedicated rows |
| 7 | Idempotent replay | Same key → cached `{ folioLineId }`; **no duplicate** discount or tax lines |

Reuse `seedRoomTax` helper pattern from `folio-fx-charges.spec.ts` ~22–40 where needed.

### HTTP

Copy `folio-routes.spec.ts` / `folio-payments.spec.ts` style: `provisionHotel` + `worker.fetch` + `x-dev-actor`. POST discount on taxed ROOM, then GET folio — response includes tax child with `taxOf` = returned `folioLineId`. Prefer adding to **`folio-routes.spec.ts`** or **`tax-posting.spec.ts`** (both already provision via HTTP).

### Money unit

`packages/money/src/index.test.ts`: `computeTax(-1000, '0.10') === -100` (negative base documents discount tax path).

### Existing tests to preserve

- `folio-extras.spec.ts` **40–41** — reason / permission gates; case 40 uses untaxed `MISC` — should remain green.
- `FolioScreen.test.tsx` **55** — reason required before submit.

Fixture discipline: `crypto.randomUUID()` keys; `check:pms-core-test-dates`.

---

## 8. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/src/property-do.ts` | `tryPostDiscount` — add `stampTaxForChargeSync` call after DISCOUNT insert (~12807–12815 region) |
| `apps/pms-core/test/tax-posting.spec.ts` | New discount + tax cases (1–4, 7); optional HTTP case |
| `apps/pms-core/test/folio-fx-split-transfer.spec.ts` | Update case **29** for discount tax + FX; keep case **30** rejects |
| `apps/pms-core/test/folio-routes.spec.ts` | Optional HTTP discount + GET folio tax child |
| `packages/money/src/index.test.ts` | Negative `computeTax` case |

**Not touched:** `COMMAND_CATALOG`, `v1-http-routes.ts` append order, `catalog.ts` events, `v1-dispatch.ts` contract (unless error mapping already shared), `packages/client-core/src/api.ts`, `FolioScreen.tsx` (preferred zero change), `property-migrations.ts`, `demo-seed`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `AUDIT_WRITER_COMMAND_IDS` membership, `CLASS_DENYLIST`, `PROPERTY_PURGE_INVENTORY_TABLES`, transfer restamp path.

---

## 9. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Discount tax true-up to remaining** | Per-line rounding may leave net tax off by 1 minor vs `computeTax(remaining)`; do not fix here |
| 2 | **Reallocate discount/tax when splitting the source ROOM** | Split already handles tax on children; discount `split_of` linkage unchanged this chunk |
| 3 | **Stay-level discount** (no source line) | Folio-money leftover **6** |
| 4 | **Promo codes** | Folio-money leftover **7** |
| 5 | **Inclusive / non-PERCENTAGE tax** | Engine skips non-`PERCENTAGE`; unchanged |
| 6 | **Reverse original TAX + restamp on source** | Forbidden by `folio_line_tax_uniq`; not revisited |

---

## 10. Implementation checklist

- [x] `tryPostDiscount`: after DISCOUNT insert, call `stampTaxForChargeSync` with lock-2 params (`chargeCode: source.charge_code`, `parentSource: 'DESK'`, `postingDate: resolvePostingBusinessDateSync()`, discount `posted`).
- [x] Original source + source TAX rows never mutated; no new charge codes.
- [x] Exempt source → DISCOUNT only; no new error code.
- [x] Idempotent replay returns same `folioLineId`; no duplicate tax (`runIdempotent` + `folio_line_tax_uniq`).
- [x] DO tests §7 (cases 1–7) green.
- [x] HTTP test: POST discount + GET folio shows tax child.
- [x] `computeTax` negative-base unit test.
- [x] Case **29** updated: **add** `seedRoomTax`; discount tax found by `taxOf === discountFolioLineId` (ROOM TAX positive, unchanged); DISCOUNT FX assertions preserved.
- [x] `[102]` / catalog **77** / writers **52** / route **[127]** / schema **27** / `NIGHT_AUDIT_STEPS` **7** / `PLATFORM_GAPS` `[]` unchanged.
- [x] Demo seed untouched; SPA zero product change preferred.
- [x] Bidirectional pointer sentences in folio-money-ops §7.3 + §19 and tax-posting §2.5 when landed (final implementation task).

---

## Tree conflicts with reviewer locks

**None.** Verified: `tryPostDiscount` lacks stamp today (~12807–12831); `stampTaxForChargeSync` does not skip `DESK` (~1698–1708); transfer restamp uses source charge code (~13079–13094); `DISCOUNT` seed has no `tax_group` (~754–755); `[101]` refund / `[102]` discount indices match folio-money route table; partial refunds leftover **4** is a separate closed chunk — do not reopen.
