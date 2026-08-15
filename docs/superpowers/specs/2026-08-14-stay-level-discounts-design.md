# Stay-level discounts (no source line)

**Tree verified 2026-08-14:** `COMMAND_CATALOG` length **77** (`register.test.ts` ~627), `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (`register.test.ts` ~619; `v1-http-routes.ts` ~747–749), `[101] post_folio_refund` / `[102] post_folio_discount` (`v1-http-routes.ts` ~565–577), `AUDIT_WRITER_COMMAND_IDS.size === 52` (`register.test.ts` ~626), `PROPERTY_SCHEMA_HEAD === 27` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1055–1063), `PLATFORM_GAPS === []` (`register.test.ts` ~628).

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** ARCHITECTURE.md §7.3 (append-only ledger; never floats; city ledger is not a folio variant); [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.3 (manual discounts; leftover **6**); [taxable discounts](./2026-08-14-taxable-discounts-design.md) (line-level tax restamp shipped — stay-level has no restamp); [tax posting](./2026-08-07-tax-posting-design.md) (§2.4 `DISCOUNT.tax_group` NULL = exempt); `packages/contracts/src/commands/catalog.ts` (`folio.post_discount` ~473–481); `packages/contracts/src/v1-http-routes.ts`; `packages/contracts/src/commands/audit-writers.ts` (~33); `packages/do-runtime/src/idempotency.ts` (`runIdempotent` sync-only); `packages/money/src/index.ts` (`postToLedger`, `roundHalfAwayFromZero`); `apps/pms-core/src/property-do.ts` (`tryPostDiscount` ~12695+, `guestFolioWindowId` ~11937–11958, `insertFolioLineSync` ~12277, `assertFolioWindowOpenSync` ~12305–12314); `apps/pms-core/src/v1-dispatch.ts` (`handlePostFolioDiscount` ~5045–5101; route ~7017–7023); `packages/client-core/src/api.ts` (`postDiscount` ~925–946); `apps/web-pms/src/screens/FolioScreen.tsx` (~682–710, ~91); `apps/web-pms/src/screens/FolioScreen.test.tsx` (case **55** ~688–708); `apps/pms-core/test/folio-extras.spec.ts` (cases **40–41**); `apps/pms-core/test/tax-posting.spec.ts` (Tests **18–23**); `apps/pms-core/test/folio-fx-split-transfer.spec.ts` (cases **29–30**); `apps/pms-core/test/folio-routes.spec.ts` (`provisionHotel` pattern)

**Closes:** [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **6** — **stay-level discount** (no source folio line).

**Amends:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §7.3 (stay-level lump DISCOUNT on GUEST window; `split_of` NULL) and §19 leftover **6** (closed). [taxable discounts](./2026-08-14-taxable-discounts-design.md) §9 item **3** (stay-level discount — closed here; stay-level tax allocation remains named). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Folio-money-ops §7.3 shipped **line-level** manual discounts: `folio.post_discount` / `[102] post_folio_discount` requires a source folio line (`POST …/folio/lines/:lid/discount`). Desk cannot post a stay/folio-level DISCOUNT when no charge line is selected. Taxable-discounts closed line-level tax restamp (`stampTaxForChargeSync` with `chargeCode: source.charge_code`); stay-level has **no source product** and must not restamp.

This chunk extends the **existing** command `folio.post_discount` with a **second HTTP route** for reservation-scoped stay discounts. Line-level behaviour stays **bit-identical** when `sourceFolioLineId` is present. One lump negative `DISCOUNT` row on the GUEST window — no fan-out across ROOM lines, no COMPANY/MASTER posting.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Line-level DO path | `tryPostDiscount` — `property-do.ts` ~12695–12849: **requires** `sourceFolioLineId`; loads source line; blocked sources/codes; percent/fixed on **source `amount_minor`**; `postToLedger` at source frozen FX; inserts `chargeCode: 'DISCOUNT'`, `source: 'DESK'`, `splitOf: source.folio_line_id`; then `stampTaxForChargeSync` with `chargeCode: source.charge_code` (taxable-discounts). Wrapped in `runIdempotent` inside `transactionSync`. |
| HTTP line route | `[102] post_folio_discount` — `v1-http-routes.ts` ~572–577; `handlePostFolioDiscount` ~5045–5101; dispatch route ~7017–7023 `POST /v1/properties/:pid/folio/lines/:lid/discount`. Body `{ kind, bps?, amountMinor?, reason, folioLineId, idempotencyKey }`. Fingerprint `{ sourceFolioLineId, kind, bps, amountMinor, reason }`. Response `{ ok: true, folioLineId }`. **Do not move `[102]`.** |
| Command | `folio.post_discount` — `catalog.ts` ~473–481: `INTERACTIVE`, `FAIL_CLOSED`, `idempotent: true`, `permission: 'folio:adjust'`, events `['folio.line_posted']`, `entitlement: 'pms.core'`. In `AUDIT_WRITER_COMMAND_IDS` (`audit-writers.ts` ~33). |
| Client line API | `postDiscount` — `api.ts` ~925–946. Line-scoped URL. |
| SPA | `FolioScreen.tsx` ~682–710: `sourceId = discountLineId \|\| splitLineId`; reason required; `data-testid="post-discount"`. `reservationId` from `useParams` (~91). Case **55** reason gate in `FolioScreen.test.tsx` ~688–708. |
| GUEST window | `guestFolioWindowId` = `` `${reservationId}:GUEST` `` ~11937–11939; `ensureGuestFolioWindowSync` / `readGuestFolioWindowIdSync` ~11941–11958. CLOSED gate via `assertFolioWindowOpenSync` ~12305–12314 / `insertFolioLineSync`. |
| `split_of` | `insertFolioLineSync` — `splitOf: input.splitOf ?? null` ~12277. Column nullable in migrations. |
| `DISCOUNT` seed | `tax_group` NULL (exempt standalone). Stay-level stamp with `chargeCode: 'DISCOUNT'` would no-op — do not call stamp. |
| Blocked line-level sources/codes | `SPLIT_REVERSAL`, `TAX`, `PAYMENT`, `PAYMENT_REFUND`, `TRANSFER_REVERSAL`, `DISCOUNT` (as **source line**), `CHARGEBACK`, `FX_GAIN`, `FX_LOSS`, `CHARGEBACK_FEE`. |
| Tests to preserve | `folio-extras.spec.ts` **40–41**; `tax-posting.spec.ts` Tests **18–23**; `folio-fx-split-transfer.spec.ts` **29–30**. |
| Folio-money §7.3 note | “Stay-level (no source line) is leftover 6. Line-level is auditable and foots.” |
| Catalog / audit / gaps | `COMMAND_CATALOG` length **77** (`register.test.ts` ~627). `AUDIT_WRITER_COMMAND_IDS.size === 52` (~626). `PLATFORM_GAPS = []` (~628). |
| Schema heads | `PROPERTY_SCHEMA_HEAD === 27` (`migrate.test.ts` ~618). `ORG_SCHEMA_HEAD === 7` (~619). **No v28.** |
| Night audit | `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1055–1063). Demo seed untouched. |

**Heads (do not insert before existing rows):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **APPEND `[128] post_folio_stay_discount`** — `[127]` unmoved |
| `COMMAND_CATALOG` | length **77** | **77** (same command) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** (do not add second id) |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **27** | **27** (no migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |

### 1.2 Scope in

1. Extend `tryPostDiscount` RPC input: **`sourceFolioLineId` present → existing line-level path** (including tax restamp); **`reservationId` present (no source) → stay-level path**.
2. **APPEND** HTTP audit **`[128] post_folio_stay_discount`**: `POST /v1/properties/:pid/reservations/:rid/folio/discount` → same `folio.post_discount` command.
3. Stay-level: one lump `DISCOUNT` on GUEST window, `splitOf` NULL, identity ledger FX, **no** `stampTaxForChargeSync`.
4. Base = GUEST-window ledger net of prior discounts, excluding tax/payments (§2 Lock 6).
5. SPA: empty discount line id + reason → `postStayDiscount`; non-empty → existing `postDiscount`.
6. Tests §7 (DO + HTTP + SPA RTL).
7. `register.test.ts`: assert `[128]` appended; `[127]` still `post_demo_seed`; `[102]` unmoved.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Promo codes — folio-money leftover **7**
- Fan-out stay discount into per-line DISCOUNT + tax restamp
- Stay-level tax allocation / true-up
- Discount tax true-up to remaining (taxable-discounts leftover)
- Reallocate discount/tax when splitting a ROOM
- City ledger / AR, invoices, night-audit auto-transfer (`NIGHT_AUDIT_STEPS` growth)
- Recurring charges / `breakfast_rule`
- Chargeback of remainder after partial refund
- Real PSP / PCI
- Guest CRM depth, virtual-type leftovers, `rooms.delete`
- Dry run 2
- New catalog command id
- Schema v28 / demo seed rewrite
- COMPANY/MASTER stay discount
- New `export class`
- `CLASS_DENYLIST` / `PROPERTY_PURGE_INVENTORY_TABLES` unchanged
- Changing line-level HTTP `[102]` body/fingerprint/response
- `ui-kit` adoption beyond token compliance if a touched file fails `check:web-pms-colors`

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Same command

Extend **`folio.post_discount`**. **No new catalog id.** `AUDIT_WRITER_COMMAND_IDS.size` stays **52** — command already listed; do not add a second id. Line-level behaviour **bit-identical** when `sourceFolioLineId` is present (including tax restamp from taxable-discounts).

### Lock 2 — New HTTP route required

Line path cannot express “no line”. **APPEND** audit row **`[128] post_folio_stay_discount`** after `[127] post_demo_seed`:

| Field | Value |
|---|---|
| `id` | `post_folio_stay_discount` |
| `scope` | `property` |
| `permission` | `folio:adjust` |
| `commandId` | `folio.post_discount` |
| `entitlement` | `pms.core` |
| Method / path | `POST /v1/properties/:pid/reservations/:rid/folio/discount` |

Do **not** move `[102] post_folio_discount` or `[127] post_demo_seed`.

### Lock 3 — RPC union (one function, two branches)

`tryPostDiscount` input widens to:

```typescript
{
  sourceFolioLineId?: string;
  reservationId?: string;
  kind: 'percent' | 'fixed';
  bps?: number;
  amountMinor?: number;
  reason: string;
  folioLineId: string;
}
```

| Branch | Condition | Behaviour |
|---|---|---|
| Line-level | `sourceFolioLineId` present | Existing path unchanged (~12695–12849 region) |
| Stay-level | `sourceFolioLineId` absent; `reservationId` present | New branch (§2 Locks 4–8) |
| Invalid | Both absent | HTTP **400** `{ error: 'invalid_body' }`; RPC tests always pass one |

Do **not** add a second DO method unless the file forces it — prefer one `tryPostDiscount` with two branches inside the same `runIdempotent` txn pattern.

### Lock 4 — Lump DISCOUNT, not fan-out

Stay-level posts **one** new line:

| Field | Value |
|---|---|
| `chargeCode` | `'DISCOUNT'` |
| `source` | `'DESK'` |
| `splitOf` | **`NULL`** |
| `folioWindowId` | GUEST window only |
| `reservationId` | path / input `reservationId` |

Do **not** allocate across ROOM lines (that would be batch line-level, not leftover 6). Do **not** post to COMPANY/MASTER windows.

### Lock 5 — GUEST window

Resolve GUEST window via `` `${reservationId}:GUEST` `` (`guestFolioWindowId`). **Do not** call `ensureGuestFolioWindowSync` on the stay path — window must already exist (same as line-level expecting an existing source window).

| Condition | Error |
|---|---|
| Reservation missing | `NOT_FOUND` |
| GUEST window missing | `NOT_FOUND` |
| GUEST window `CLOSED` | `WINDOW_CLOSED` |

Use existing `assertFolioWindowOpenSync` before insert; `insertFolioLineSync` CLOSED gate unchanged.

### Lock 6 — Base ledger (percent and fixed)

On the **GUEST window only**, compute:

```
baseLedger = SUM(ledger_amount_minor)
```

over folio lines where **neither** `source` **nor** `charge_code` is in:

`{ TAX, PAYMENT, PAYMENT_REFUND, SPLIT_REVERSAL, TRANSFER_REVERSAL, CHARGEBACK, FX_GAIN, FX_LOSS, CHARGEBACK_FEE }`

**Include** `DISCOUNT` rows (negative — reduce base) and product charges (`ROOM`, `MISC`, `DAMAGE`, `CANCEL`, `NO_SHOW`, …).

SQL predicate: **exclude** a row when `source IN (…)` **OR** `charge_code IN (…)` (De Morgan of the “neither … nor …” rule above).

| Kind | Rule |
|---|---|
| `percent` | `bps` integer **1–10000**; `discountLedger = Number(roundHalfAwayFromZero(BigInt(baseLedger) * BigInt(bps), 10000n))`; post **`-discountLedger`** |
| `fixed` | `amountMinor` is **ledger** minor units; integer **`> 0`** and **`<= baseLedger`**; post **`-amountMinor`** |

If `baseLedger <= 0` or computed discount `<= 0` → **`LINE_NOT_DISCOUNTABLE`** (reuse; no new wire code).

Reason: trimmed length **1–500** → else **`DISCOUNT_REASON_REQUIRED`** (both branches).

### Lock 7 — Identity ledger FX

Stay-level has no source frozen FX. Post in **ledger currency** at **`fxRate: '1'`** (identity). Use existing `postToLedger` / identity path (mirror night-audit ROOM stamp ~12503–12508: txn currency = ledger currency, `ledgerAmountMinor` equals txn amount). `fxRateAt` = stamp time (finite `Date.now()` or equivalent used elsewhere on identity posts).

Fixed `amountMinor` and percent result are **ledger** minor units.

### Lock 8 — No tax restamp on stay-level

Do **not** call `stampTaxForChargeSync` on the lump DISCOUNT. No source product; `DISCOUNT.tax_group` stays NULL. Name **stay-level tax allocation / true-up** as leftover (§9). Line-level restamp **unchanged**.

### Additional invariants

9. **Folio append-only.** Never `UPDATE folio_line.amount_minor` / `ledger_amount_minor`.
10. **`FAIL_CLOSED`.** Discount stays interactive / entitled; never queued on provisional replay.
11. **`runIdempotent` sync-only** inside `transactionSync`; idempotent replay returns cached `{ folioLineId }` without duplicate DISCOUNT.
12. **Events** — no new wire codes; catalog events already `folio.line_posted`.
13. **Audit** — `afterJson.reason` required; stay-level `afterJson` includes `reservationId` and `amountMinor` (negative discount amount); omit `sourceFolioLineId`.
14. **Heads (§1.1 table)** — **append** `V1_HTTP_ROUTE_AUDIT[128] post_folio_stay_discount`; last audit index becomes **128**; `[127] post_demo_seed` unmoved. **Frozen:** `COMMAND_CATALOG` length **77**, `AUDIT_WRITER_COMMAND_IDS.size` **52**, `PROPERTY_SCHEMA_HEAD` **27**, `ORG_SCHEMA_HEAD` **7**, `NIGHT_AUDIT_STEPS` length **7**, `PLATFORM_GAPS` `[]`, demo seed untouched.

---

## 3. Commands / HTTP / fingerprint (line vs stay)

### 3.1 Command (unchanged)

| | |
|---|---|
| Command | `folio.post_discount` — `catalog.ts` ~473–481 |
| Permission | `folio:adjust` |
| Entitlement | `pms.core` |
| Events | `['folio.line_posted']` |

### 3.2 Line-level HTTP (unchanged)

| | |
|---|---|
| Audit index | **`[102] post_folio_discount`** — unmoved |
| Path | `POST /v1/properties/:pid/folio/lines/:lid/discount` |
| Handler | `handlePostFolioDiscount` ~5045–5101 |
| Body | `{ kind, bps?, amountMinor?, reason, folioLineId, idempotencyKey }` — **no** `sourceFolioLineId` in JSON |
| Fingerprint | `{ sourceFolioLineId, kind, bps, amountMinor, reason }` — `sourceFolioLineId` from path `:lid` |
| Success | `{ ok: true, folioLineId }` |
| Client | `postDiscount` — `api.ts` ~925–946 — **unchanged** |

### 3.3 Stay-level HTTP (new)

| | |
|---|---|
| Audit index | **`[128] post_folio_stay_discount`** — **append only** |
| Path | `POST /v1/properties/:pid/reservations/:rid/folio/discount` |
| Handler | **New** `handlePostFolioStayDiscount` (mirror capture-due reservation path pattern ~5104+) |
| Body | `{ kind, bps?, amountMinor?, reason, folioLineId, idempotencyKey }` — **no** `sourceFolioLineId`; reservation id is path `:rid` |
| Fingerprint | `{ reservationId, kind, bps, amountMinor, reason }` — `reservationId` from path `:rid` |
| Success | `{ ok: true, folioLineId }` — the one lump DISCOUNT id |
| Client | **New** `postStayDiscount(propertyId, reservationId, input, opId)` — same input shape minus line id; URL reservation-scoped |

Missing / invalid body fields → **400** `{ error: 'invalid_body' }` (same gate pattern as line handler ~5057–5058).

Dispatch: append route entry after existing folio routes (~7024 region); wire `routeId: 'post_folio_stay_discount'`.

---

## 4. Schema

**None.** `PROPERTY_SCHEMA_HEAD` stays **27**. `split_of` already nullable (`insertFolioLineSync` ~12277). No migration, no demo seed rewrite, no `DISCOUNT` seed change.

---

## 5. SPA

`FolioScreen.tsx` discount mutation (~682–710):

| UI state | API call |
|---|---|
| `discountLineId` empty **and** no `splitLineId` fallback **and** reason non-empty | **`postStayDiscount(propertyId, reservationId, …)`** |
| Non-empty line id (`discountLineId \|\| splitLineId`) | Existing **`postDiscount`** |

- Keep `data-testid="post-discount"` and reason gate (case **55** — button disabled / no API call when reason empty).
- Mint `folioLineId` for stay path e.g. `` `${reservationId}:stay-disc:${crypto.randomUUID()}` ``; idempotency op id distinct from line path.
- No simulate copy. Tokens / ui-kit only if touched (`check:web-pms-colors`).
- Rebuild `@hospai/client-core` after `api.ts` change.

**RTL (`FolioScreen.test.tsx`):**

- Empty line id + filled reason → `postStayDiscount` called (mock); `postDiscount` not called.
- Case **55** still blocks empty reason (no API call).
- Filled line id → still calls `postDiscount`.

---

## 6. Errors (existing only)

No new wire codes.

### Stay-level-specific mapping (reuse existing codes)

| Code | When |
|---|---|
| `NOT_FOUND` | Reservation missing; GUEST window missing |
| `WINDOW_CLOSED` | GUEST window `CLOSED` |
| `LINE_NOT_DISCOUNTABLE` | `baseLedger <= 0`; computed discount `<= 0`; fixed `amountMinor` invalid vs base |
| `DISCOUNT_REASON_REQUIRED` | Reason empty / whitespace / > 500 |
| `MONEY_INVALID` | Invalid percent `bps` (not integer 1–10000) |
| `FORBIDDEN` / `not_member` | Missing `folio:adjust` |
| `ENTITLEMENT_REQUIRED` / `ENTITLEMENT_UNAVAILABLE` | Core entitlement |
| `IDEM_KEY_REUSED` | Idempotency fingerprint mismatch |
| `CHARGE_CODE_NOT_FOUND` | `DISCOUNT` code missing/inactive |

HTTP stay handler: missing both path reservation and required body → **400** `invalid_body` before DO invoke.

Line-level error table from taxable-discounts §6 **unchanged** (source line missing → `NOT_FOUND`, blocked source → `LINE_NOT_DISCOUNTABLE`, etc.).

---

## 7. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Do **not** `vi.spyOn` into the DO isolate. Prefer `folio-extras.spec.ts` and/or `tax-posting.spec.ts` for DO cases. HTTP via `folio-routes.spec.ts` or `folio-payments.spec.ts`: **`provisionHotel` + `worker.fetch` + `x-dev-actor`** — **do not invent `provisionedPropertyWorker`**.

### DO (`property-do` stub)

| # | Case | Assert |
|---|---|---|
| 1 | Stay **percent** on GUEST: ROOM ledger **10000**; 10% stay discount | One DISCOUNT **−1000**; `splitOf` **null**; GUEST window; **no** TAX child with `taxOf` = discount line |
| 2 | Stay **fixed** amount (e.g. 2500 on base 10000) | DISCOUNT **−2500**; `splitOf` null; no tax on discount |
| 3 | Prior **line-level** DISCOUNT reduces percent base: ROOM 10000 + line disc −1000 → 10% stay | Stay DISCOUNT **−900** (base 9000) |
| 4 | TAX and PAYMENT lines on GUEST **excluded** from base | e.g. ROOM 10000 + TAX 1000 + PAYMENT −5000 → base 10000 not 15000/5000 |
| 5 | `baseLedger <= 0` (charges fully discounted or net zero) | `LINE_NOT_DISCOUNTABLE` |
| 6 | GUEST window **CLOSED** | `WINDOW_CLOSED` |
| 7 | Idempotent replay | Same key → cached `{ folioLineId }`; no duplicate DISCOUNT |
| 8 | Line-level path **unchanged** | Reuse / keep green: `folio-extras.spec.ts` **40–41**; `tax-posting.spec.ts` Tests **18–23**; `folio-fx-split-transfer.spec.ts` **29–30** |

### HTTP

Copy `folio-routes.spec.ts` style: `provisionHotel` + `worker.fetch` + `x-dev-actor`.

- POST stay route `…/reservations/:rid/folio/discount` → **200** `{ ok: true, folioLineId }`; GET folio shows lump DISCOUNT, `splitOf` null, no tax child on discount.
- POST **`[102]`** line route still works on a charge line (regression smoke).

### SPA RTL

- Empty line id + reason → `postStayDiscount`; case **55** blocks empty reason; filled line id → `postDiscount`.

---

## 8. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/src/property-do.ts` | Widen `tryPostDiscount` input; add stay-level branch (base query, identity post, no stamp); line branch untouched |
| `packages/contracts/src/v1-http-routes.ts` | **Append** `[128] post_folio_stay_discount` after `post_demo_seed` |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostFolioStayDiscount`; dispatch route registration |
| `packages/client-core/src/api.ts` | **Add** `postStayDiscount` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Branch empty line id → stay API |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Stay-discount RTL case(s) |
| `apps/pms-core/test/folio-extras.spec.ts` and/or `tax-posting.spec.ts` | Stay DO cases 1–7 |
| `apps/pms-core/test/folio-routes.spec.ts` (or sibling) | HTTP stay + line regression |
| `packages/contracts/src/register.test.ts` | Assert `[128]` id; `[127]` / `[102]` pins |

**Not touched:** `COMMAND_CATALOG` length, `catalog.ts` command entry, `AUDIT_WRITER_COMMAND_IDS` membership, `property-migrations.ts`, demo seed, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `PROPERTY_PURGE_INVENTORY_TABLES`, line-level HTTP contract, `DISCOUNT.tax_group` seed.

---

## 9. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Stay-level tax allocation / true-up** | Lump DISCOUNT has no restamp; net tax may not reflect stay discount — do not fix here |
| 2 | **Fan-out stay discount to per-line DISCOUNT + restamp** | Explicitly out of scope (§1.3) |
| 3 | **Discount tax true-up to remaining** | Taxable-discounts leftover — line-level rounding only |
| 4 | **Promo codes** | Folio-money leftover **7** |
| 5 | **Reallocate discount/tax when splitting ROOM** | Unchanged |

---

## 10. Implementation checklist

- [ ] `tryPostDiscount`: RPC union — `sourceFolioLineId` → existing line path (bit-identical + stamp); `reservationId` → stay path; both absent → invalid.
- [ ] Stay path: GUEST window resolve without auto-create; `baseLedger` sum with exclusions (§2 Lock 6); percent/fixed rules; identity `postToLedger`; one DISCOUNT insert with `splitOf: null`; **no** `stampTaxForChargeSync`.
- [ ] Audit `afterJson`: stay-level includes `reservationId`, `amountMinor`, `reason`.
- [ ] **Append** `V1_HTTP_ROUTE_AUDIT[128] post_folio_stay_discount`; dispatch route + `handlePostFolioStayDiscount`; fingerprint `{ reservationId, kind, bps, amountMinor, reason }`.
- [ ] `[102]` / `[127]` unmoved; catalog **77**; writers **52**; schema **27**; `NIGHT_AUDIT_STEPS` **7**; `PLATFORM_GAPS` `[]`.
- [ ] `postStayDiscount` in `client-core`; rebuild package; SPA branch + RTL.
- [ ] DO tests §7 cases 1–7; HTTP stay + line regression; preserved tests 40–41 / 18–23 / 29–30 green.
- [ ] `register.test.ts` pins `[128]`; demo seed untouched.
- [ ] Bidirectional pointer sentences in folio-money-ops §7.3 + §19 and taxable-discounts §9 when landed (final implementation task).

---

## Tree conflicts with reviewer locks

**None.** Verified: `tryPostDiscount` requires `sourceFolioLineId` today (~12698); line path includes `stampTaxForChargeSync` (~12817–12826); `[102]` at ~572–577; `[127] post_demo_seed` at ~747–749; `split_of` nullable ~12277; GUEST window helpers ~11937–11958; taxable-discounts closed line restamp — stay path correctly omits stamp; no second catalog command needed.
