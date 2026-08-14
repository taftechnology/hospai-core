# Card last-4 / brand on tenders (P1)

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P1 row *Card last-4 / brand on tenders* (239–240); [folio first-paint (P0-2)](./2026-08-13-folio-first-paint-design.md) §4 (method-only deferral), §12 leftover #8, invariant schema freeze; [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [8-minute script](../../demo/8-minute-script.md) folio beat (4:30); `apps/web-pms/src/screens/FolioScreen.tsx`; `packages/client-core/src/api.ts` (`FolioPaymentRow`); `apps/pms-core/src/property-do.ts` (`listPaymentsForReservation`, authorize path); `apps/pms-core/src/psp-simulate.ts` (`simulateAuthorize`); `migrations/do-property/0016_cashiering.sql` (`tender_type`); census 2026-08-14.

**Closes:** DEMO-READY P1 row *Card last-4 / brand on tenders* — keep the simulate gateway; the UI must not say simulate. Pairs with P0-2 tender IA (amount + method → amount + recognizable card token when stored).

**Amends:** [folio first-paint (P0-2)](./2026-08-13-folio-first-paint-design.md) — **lifts** the P0-2 schema freeze and last-4 deferral **for this slice only**. P0-2 method-only fallback remains the honest path for legacy rows without stored tokens.

**Does not close:** Guest CRM depth, one hotel voice, P0-5 script/dry runs, `/dev/ui` gallery, real PSP/PCI vault, seed rewrite (unless reviewer overrides OQ §9).

---

## 1. Context & Motivation

P0-2 made folio first paint a bill: guest, dates, room code, balance, lines, post charge, take payment, tenders as **Card/Cash · amount**. That was enough to ship the folio beat without operator dumps. It **explicitly deferred** last-4/brand, **forbade fabricating `•••• 4242`**, **forbade a last-4 column**, and froze `PROPERTY_SCHEMA_HEAD === 25`. The freeze was scoped to P0-2; this P1 slice may bump schema **when** the spec locks an honest persist path.

A GM recognizes a bill by **how** money was taken — not only that it was “Card.” The 8-minute script posts minibar then **takes a card** at 4:30; the **post-card** tender row must read like a hotel folio (e.g. **Visa •••• 4242 · $50.00**), never `simulate`, `sim_`, or a raw `paymentId`. Simulate stays server-side; the SPA stays silent about the adapter.

### 1.1 Verified census (2026-08-14 — re-verified file:line)

| Area | File:line | Today | Gap |
|---|---|---|---|
| **SPA tender paint** | `FolioScreen.tsx:60–66` | `tenderMethod()` → `'Card' \| 'Cash'` from `tenderType` + heuristics | No last-4 / brand |
| **SPA tender row** | `FolioScreen.tsx:810` | `{tenderMethod(p)} · {formatMinor(p.amountMinor)}` | Method only |
| **SPA happy path** | `FolioScreen.test.tsx:1228–1240` | `queryByText(/simulate/i)` null | Must stay null after change |
| **SPA card button** | `FolioScreen.tsx:946–950` | `data-testid="authorize-card"`; label **Charge card** | Must not say simulate |
| **SPA Advanced** | `FolioScreen.tsx:977` | `<details data-testid="folio-advanced">` collapsed by default | Unchanged |
| **Client type** | `api.ts:90–101` | `FolioPaymentRow`: `tenderType?`, `gatewayReference` — **no** `cardLast4` / `cardBrand` | Widen type |
| **List GET** | `property-do.ts:14811–14848` | `listPaymentsForReservation` SELECT includes `tender_type`; JSON maps `tenderType` | Omits last-4 / brand |
| **Single payment map** | `property-do.ts:13093–13105` | `mapPaymentRow` → `tenderType` only | Same gap |
| **PaymentRow type** | `property-do.ts:273–296` | `tender_type`, `gateway_reference`, … — **no** last-4 / brand fields | Extend on v26 |
| **Authorize persist** | `property-do.ts:13329–13351` | `simulateAuthorize` → UPDATE `gateway_reference = sim_${paymentId}` only | No display token stored |
| **Simulate adapter** | `psp-simulate.ts:25–35` | Returns `{ outcome: 'approved', gatewayReference: \`sim_${paymentId}\` }` only | No brand / last4 |
| **Storage** | `0016_cashiering.sql:24–25`, `0024_multi_currency_folio.sql:26–27` | `payment.tender_type CHECK IN ('CARD','CASH')` | **No** last-4 / brand column |
| **Last-4 anywhere** | repo grep `last4\|last_4\|card_brand\|cardBrand\|pan_last` | **Zero hits** | Confirmed absent — no skip-migration path |
| **Heads** | `catalog.ts`, `register.test.ts:619`, `migrate.test.ts:600`, `property-migrations.ts:1100` | `COMMAND_CATALOG` **77**; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `PROPERTY_SCHEMA_HEAD` **25**; `ORG_SCHEMA_HEAD` **7** | v26 if persist locked |
| **Demo beat** | `8-minute-script.md:122` | 4:30 folio: post charge + card; Advanced collapsed | Post-card row is acceptance target |
| **Seed first paint** | P0-1 demo seed | In-house folio may have **no** card tender until live authorize | OK — legacy fallback until 4:30 |

**Heads (current → this chunk if schema locked):**

| | Current | This chunk (default) |
|---|---|---|
| `COMMAND_CATALOG` | length **77** | **77** |
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** (no new row) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **25** | **26** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |

### 1.2 Design tension (resolved with default; OQ §8)

| Option | Verdict | Why |
|---|---|---|
| **1 — SPA-only canned `Visa •••• 4242`** | **Reject** | P0-2 called this demo theater; no stored field exists to anchor honesty |
| **2 — Persist last-4 + brand from simulate adapter** | **Default lock** | PCI-ok display token (last-4 + brand, never PAN); sandbox convention; honest GET compose |
| **3 — Parse `sim_` from `gatewayReference`** | **Reject** | Lab copy; leaks adapter shape; forbidden on happy path |

### 1.3 What already exists (do not re-spec)

| Piece | Where (verified) |
|---|---|
| Tender IA (one list, no Holds/Captured headings) | P0-2 §4; `FolioScreen.tsx:796–810` |
| `tenderType` on list GET | P0-2 §4.2; `property-do.ts:14846` |
| Method fallback heuristics | `FolioScreen.tsx:60–66` |
| Simulate gateway + env gate | `psp-simulate.ts`; payments-ledger simulate spec |
| No simulate / sim_ / paymentId in tender **text** | P0-2 §6; `FolioScreen.test.tsx:1213–1214,1240` |
| Advanced collapsed | `folio-advanced`; P0-2 §5 |
| Charge card label | `FolioScreen.tsx:950` — not “Simulate card” |

---

## 2. Invariants (normative)

1. **Simulate gateway stays.** No real PSP, no PCI vault, no PAN collection in the SPA. Authorize still calls `simulateAuthorize` outside the idempotent txn.
2. **Happy-path copy never contains** `simulate`, `Simulation`, `sim_`, or raw `paymentId` as visible tender text. Never paint `gatewayReference`.
3. **Integer money, append-only folio.** This chunk does not change posting, capture, or balance math.
4. **No new catalog commands.** `COMMAND_CATALOG` length stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
5. **No new HTTP routes.** `V1_HTTP_ROUTE_AUDIT[127] = post_demo_seed` does not move. Widen **existing** `GET …/folio/payments` (and single-payment read if returned to SPA) JSON only — same pattern as P0-2 `tenderType`.
6. **`data-testid`s on existing folio controls stay** (`authorize-card`, `void-payment-*`, `refund-payment-*`, `folio-advanced`, etc.). Tests may add copy assertions; they must not rename control testids.
7. **Advanced stays collapsed by default.** This chunk does not move tender rows behind Advanced.
8. **`NIGHT_AUDIT_STEPS` stays seven.** No seed rewrite unless OQ §9 unlocks a card tender on first paint.
9. **Cash tenders stay `Cash · amount`.** No last-4 on cash. `tender_type = 'CASH'` ⇒ omit card display fields on wire and UI.
10. **Legacy card rows without stored last-4 fall back to P0-2:** **`Card · amount`**. Do not backfill fake digits. Do not parse `sim_`.
11. **Display tokens are write-once at authorize.** Capture / void / refund do not re-fetch PAN; they read stored columns. Cash path never sets them.
12. **Org schema unchanged.** `ORG_SCHEMA_HEAD === 7`.
13. **No `/dev/ui`.** No guest CRM. No “simulate” on Charge card.

---

## 3. Scope in

1. **Property migration v26** — nullable `payment.card_last4`, `payment.card_brand` (§4.1).
2. **Simulate adapter** — approved authorize returns sandbox display token `{ brand, last4 }` alongside `gatewayReference` (§4.2).
3. **Authorize txn** — persist `card_last4` + `card_brand` when adapter approves (§4.3).
4. **Widen payment reads** — `listPaymentsForReservation`, `mapPaymentRow`, `readPaymentRowSync` SELECT, client `FolioPaymentRow` (§4.4).
5. **SPA tender label** — card rows with stored token paint **`{Brand} •••• {last4} · {amount}`**; cash and legacy card use §4.5 fallbacks (§4.6).
6. **Tests** — acceptance §7; `migrate.test` pins **26** if schema locked.
7. **DEMO-READY tick** — P1 card row in the **implementation** PR.

### 3.1 Scope out (normative)

- Real PSP integration, tokenization vault, EMV, keyed card entry in the SPA.
- New catalog commands, new HTTP audit rows, new DO tables beyond two nullable columns on `payment`.
- SPA-only canned last-4 without storage (option 1).
- Parsing `gatewayReference` for display (option 3).
- Backfilling historical `sim_*` rows with synthetic last-4.
- Guest CRM, one hotel voice, P0-5 dry runs, `/dev/ui`.
- Folio Advanced IA, P0-3 chrome, shift-strip changes.
- Changing authorize/capture command fingerprints or `FAIL_CLOSED` policy.

---

## 4. Decisions (normative)

### 4.1 Schema v26 — persist display token (default lock)

**Locked (pending reviewer on OQ §8 #1):** bump `PROPERTY_SCHEMA_HEAD` to **26**.

| Column | Type | Rule |
|---|---|---|
| `card_last4` | `TEXT` nullable | Exactly four digits when set; set only for `tender_type = 'CARD'` at authorize |
| `card_brand` | `TEXT` nullable | Lowercase wire enum from adapter (e.g. `visa`, `mastercard`, `amex`, `discover`); nullable allowed |

Migration pattern (generated, not hand-edited):

- Source: `packages/do-runtime/src/property-migrations.ts` — new `CARD_DISPLAY_TOKEN_V26_STATEMENTS`
- Artifact: `migrations/do-property/0026_card_display_token.sql`
- Regenerate: `pnpm generate:ddl`
- Statements (illustrative): `ALTER TABLE payment ADD COLUMN card_last4 TEXT`; `ALTER TABLE payment ADD COLUMN card_brand TEXT`

No `CHECK` on brand enum in v26 — adapter + SPA normalize; avoid SQLite rebuild.

**Rejected:** separate `payment_method_display` table; JSON blob on `gateway_reference`; storing full masked PAN.

### 4.2 Simulate adapter — return display token (default lock)

Extend `PspAuthorizeResult` approved branch:

```ts
{ outcome: 'approved'; gatewayReference: string; cardBrand: string; cardLast4: string }
```

**Default sandbox convention** (no guest PAN — test-card token only):

| Field | Default when approve |
|---|---|
| `gatewayReference` | `sim_${paymentId}` (unchanged wire; never painted) |
| `cardBrand` | `'visa'` |
| `cardLast4` | `'4242'` |

Declined / timeout branches unchanged (no last-4). Capture / void / refund adapters **do not** need new fields — display token already on the row.

Future: adapter may accept optional test PAN input from command body; **out of this slice** — defaults suffice for demo.

### 4.3 Authorize persist (default lock)

In `property-do.ts` authorize txn 2, when `adapterResult.outcome === 'approved'`:

```sql
UPDATE payment
SET status = 'authorized',
    gateway_reference = ?,
    card_last4 = ?,
    card_brand = ?,
    updated_at = ?
WHERE payment_id = ? AND status = 'pending'
```

Cash insert path (`record_cash_payment`) leaves both columns `NULL`.

### 4.4 Widen existing GET JSON (default lock)

Same route `get_folio_payments` — **no new audit row**.

| Wire field | Source | When omitted |
|---|---|---|
| `cardLast4` | `payment.card_last4` | `null` / omit for cash and legacy rows |
| `cardBrand` | `payment.card_brand` | `null` / omit when absent |

Also widen `mapPaymentRow` / `readPaymentRowSync` / client `FolioPaymentRow` so list and single-payment reads stay consistent.

**Rejected:** new `payments.get_tender_display` command or route.

### 4.5 Tender label fallbacks (default lock)

Replace visible `{tenderMethod(p)} · amount` with `{tenderLabel(p)} · amount` (name illustrative):

| Condition | Visible label (before ` · amount`) |
|---|---|
| `tenderType === 'CASH'` (or cash heuristic) | **Cash** |
| `tenderType === 'CARD'` and `cardLast4` present | **`{brandLabel} •••• {cardLast4}`** — see OQ §8 #2–3 for brand/mask defaults |
| `tenderType === 'CARD'` and no `cardLast4` | **Card** (P0-2 method fallback) |
| Authorized hold with token | Same as captured card row + existing Hold / capture UI |

**Never** use `gatewayReference`, `sim_`, or `paymentId` in the label.

### 4.6 SPA-only and parse-path (rejected — normative)

| Approach | Status |
|---|---|
| Hard-code `Visa •••• 4242` in `FolioScreen.tsx` when `tenderType === 'CARD'` | **Forbidden** |
| Derive last-4 from `gatewayReference.replace('sim_', …)` | **Forbidden** |
| Show `4242` only when `cardLast4` on the GET row | **Required** |

### 4.7 Demo / seed behavior (default lock)

- **Do not** rewrite demo seed solely to pre-populate a card tender with last-4. The 8-minute script already authorizes card live at 4:30.
- First paint of a seeded in-house folio may show **Cash-only** or **Card · amount** (legacy) until the live authorize — **acceptable**.
- **Post-card** tender on the demo folio must show last-4/brand per §4.5.

---

## 5. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v26 statements + `PROPERTY_MIGRATIONS` entry |
| `migrations/do-property/0026_card_display_token.sql` | generated artifact |
| `packages/do-runtime/src/migrate.test.ts` | `PROPERTY_SCHEMA_HEAD` **26** |
| `apps/pms-core/src/psp-simulate.ts` | approve branch returns `cardBrand` / `cardLast4` |
| `apps/pms-core/src/psp-simulate.test.ts` | approve shape (optional small unit) |
| `apps/pms-core/src/property-do.ts` | `PaymentRow`; authorize UPDATE; `readPaymentRowSync` SELECT; `mapPaymentRow`; `listPaymentsForReservation` |
| `apps/pms-core/test/folio-payments.spec.ts` | list GET includes `cardLast4` / `cardBrand` after authorize |
| `packages/client-core/src/api.ts` | `FolioPaymentRow.cardLast4?`, `cardBrand?` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | `tenderLabel()` (or extend `tenderMethod`); row paint ~810 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | last-4 visible; simulate/sim_/id null; cash unchanged |
| `DEMO-READY.md` | tick P1 card row in **implementation** PR |
| Pointer | one sentence in [folio first-paint (P0-2)](./2026-08-13-folio-first-paint-design.md) when this chunk lands |

**Not touched:** `v1-http-routes.ts` append, `COMMAND_CATALOG`, `demo-seed`, `/dev/ui`, real PSP modules.

---

## 6. Leftovers

### 6.1 Folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Card last-4 + brand on card tenders when stored | DEMO-READY P1 |
| 2 | Honest persist from simulate adapter (not SPA theater) | P0-2 leftover §12 #8 |
| 3 | Widen existing payments GET (no new route) | P0-2 §4.2 pattern |
| 4 | Keep simulate gateway; UI silent | DEMO-READY P1 + P0-2 §6 |
| 5 | Cash + legacy card fallbacks | P0-2 method path |
| 6 | Tick DEMO-READY P1 card checkbox | This spec |

### 6.2 Deferred (explicitly out)

| # | Item | Notes |
|---|---|---|
| 1 | Guest CRM depth | P1 separate row |
| 2 | One hotel voice | P1 separate row |
| 3 | P0-5 dry runs / script edits | Documentation |
| 4 | Real PSP / PCI vault | Phase 2+ |
| 5 | Keyed card entry / guest chooses test PAN in UI | Future adapter input |
| 6 | Backfill legacy `sim_*` rows | OQ §8 #4 default: no |
| 7 | `/dev/ui` | Not demo path |
| 8 | Hide-lab-copy chunk | Separate spec — must stay compatible (no simulate in tenders) |

---

## 7. Tests (acceptance-shaped)

**Heads**

1. `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. No new audit row.
2. If schema locked: `PROPERTY_SCHEMA_HEAD === 26`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` no-op after migration landed. `NIGHT_AUDIT_STEPS.length === 7`.

**Worker — authorize + list GET**

3. After `folio.authorize` (simulate approve): payment row has `card_last4 = '4242'`, `card_brand = 'visa'`, `gateway_reference = sim_${paymentId}`.
4. `GET …/folio/payments` includes `cardLast4`, `cardBrand` for that row; cash capture omits or nulls both.
5. Legacy card row (pre-migration fixture or NULL columns): JSON omits or nulls `cardLast4`; no server-side synthesis.

**web-pms — FolioScreen**

6. Card tender with `{ tenderType: 'CARD', cardBrand: 'visa', cardLast4: '4242' }`: visible text matches **`Visa`** (or locked brand copy) and **`4242`**; matches **`••••`** if mask locked; includes formatted amount.
7. `queryByText(/simulate/i)` null; `queryByText(/sim_/i)` null; tender row does not contain `pay_auth` / `{paymentId}` text (extend `FolioScreen.test.tsx:1154–1214`).
8. Cash tender: visible **`Cash · {amount}`** only — no `4242`, no `••••`.
9. Card tender **without** `cardLast4`: visible **`Card · {amount}`** (legacy fallback).
10. `data-testid="folio-advanced"` exists; `<details>` **not** open on first paint (P0-2 regression).

**Grep-shaped (non-test source — spot check)**

11. `rg '•••• 4242' apps/web-pms/src --glob '!**/*.{test,spec}.*'` — **no** unconditional literal unless tied to stored field compose (expected: zero hard-coded demo theater).
12. `rg 'sim_' apps/web-pms/src/screens/FolioScreen.tsx` — **no** display use of gateway reference.

**Manual (optional — 8-minute script)**

13. After live authorize at 4:30, tender row readable as Visa (or Card) + last-4; Advanced stays collapsed.

---

## 8. Open questions (locked at review)

1. **Schema 26 persist vs canned SPA digits?** **Locked: persist (option 2).** Reject SPA-only `4242`.
2. **Brand copy?** **Locked: title-case wire** (`visa` → `Visa`, `mastercard` → `Mastercard`, `amex` → `Amex`); if `cardLast4` set but `cardBrand` null → **`Card •••• {last4}`**.
3. **Mask format?** **Locked: `{Brand} •••• {last4} · {amount}`** (bullet mask; middle-dot before amount).
4. **Historical payments without columns?** **Locked: method-only fallback (`Card · amount`)** — no backfill, no parse `sim_`, no UPDATE of existing rows.
5. **Single-payment GET?** **Locked: widen `mapPaymentRow` + `readPaymentRowSync` SELECT + list GET.** SPA uses `getFolioPayments` only — do **not** add a new client-core single-payment method. HTTP `get_folio_payment` inherits if it already maps through `mapPaymentRow`.
6. **Authorized vs captured row copy?** **Locked: yes** — same token on holds + captured; capture controls stay.
7. **`PspSimulateOutcome` overrides?** **Locked: yes** — optional `cardBrand` / `cardLast4` for tests; happy-path defaults `visa` / `4242`.
8. **Seed pre-authorized card?** **Locked: no** — 4:30 live authorize is the acceptance beat.

---

## 9. Implementation checklist (for the plan author; not a plan)

- [ ] Land v26 migration + `PROPERTY_SCHEMA_HEAD` **26**.
- [ ] Adapter approve returns + DO authorize persists `cardBrand` / `cardLast4`.
- [ ] Widen payments GET + client type; no new route/catalog row.
- [ ] SPA `tenderLabel` with §4.5 fallbacks; no simulate / sim_ / paymentId text.
- [ ] Tests §7; Advanced collapsed regression.
- [ ] Tick DEMO-READY P1 card row; pointer in P0-2 spec.
- [ ] Stop. No plan in spec turn. No code in spec turn. No commit in spec turn.

---

## 10. Reviewer checklist

- [ ] Census §1.1 re-verified — file:line rows match tree (`FolioScreen` method-only ~810; no last4 in repo; list GET has `tenderType` only; simulate returns `sim_${paymentId}` only).
- [ ] P0-2 amend explicit — schema freeze lifted **for this slice**; method fallback for legacy rows retained.
- [ ] Design tension §1.2 — option 2 default; options 1 and 3 rejected with rationale.
- [ ] Invariants: simulate stays; no new route/command; testids stable; cash unchanged; no fake backfill.
- [ ] Schema **26** named with migration file pattern `0026_card_display_token.sql` + `generate:ddl` flow.
- [ ] Heads table: catalog **77**, route **[127]**, property **26** (if locked), org **7**.
- [ ] Scope-out names real PSP, SPA theater, parse `sim_`, guest CRM, dry runs, `/dev/ui`.
- [ ] Acceptance tests §7 cover post-card row, cash, legacy fallback, grep anti-patterns.
- [ ] Open questions §8 present (≥4); defaults documented.
- [x] Status **Approved** after reviewer lock of §8.
