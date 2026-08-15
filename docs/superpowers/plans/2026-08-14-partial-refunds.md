# Partial refunds (folio money ops leftover 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-14)

**Goal:** Extend existing `folio.refund` / `post_folio_refund` so desk can post multiple partial refunds against one captured payment until remainder hits zero — writing `refunded_amount_minor`, append-only `:refund:n` lines, hybrid idempotency, and SPA amount field defaulting to remaining — with no new catalog row, route index, or schema migration.

**Architecture:** Required `amountMinor` on HTTP + RPC; fingerprint `{ paymentId, amountMinor }`. Status stays `captured` until cumulative refund equals capture base, then `refunded`. `applyPaymentEventSync` `payment.refunded` honours partial amount, accumulates `refunded_amount_minor`, mints deterministic line ids. `tryRefundPayment` peeks `lookupIdempotentResponse` when `captured`, calls PSP outside txn, then `transactionSync` + `runIdempotent` for ledger write. GET payment JSON widens with `refundedAmountMinor`; SPA mirrors capture amount UX.

**Tech Stack:** PropertyDO + sqlite (existing `refunded_amount_minor` column v21/v27), `@hospai/contracts` wire codes + `PaymentRefundedV1`, `@hospai/client-core`, React SPA (`FolioScreen.tsx`), vitest Worker specs + RTL.

**Spec:** `docs/superpowers/specs/2026-08-14-partial-refunds-design.md` (Approved). Spec commit: `47a7c7d`.

---

## Sequencing gate (read before starting)

This slice closes **folio money ops leftover 4 remainder — partial refunds**. Multi-currency chargebacks already shipped; chargeback-of-remainder stays scope-out.

| After this plan | Do not start |
|---|---|
| Partial + full refund via same command | New `folio.partial_refund` catalog id |
| `refundedAmountMinor` on GET payments | Schema v28 / migration |
| `:refund:n` line ids (not legacy `:refund`) | `partially_refunded` status value |
| Chargeback blocked when any refund posted | Chargeback sized to remaining capture |
| — | Demo seed rewrite |
| — | Real PSP / PCI Worker |
| — | Multi-shot partial captures |

---

## Open decisions (locked — do not re-litigate)

### D1 — Same command / route

**Locked:** `folio.refund` / `[101] post_folio_refund` unchanged. Do not move `[101]`. Last route `[127] = post_demo_seed`. Catalog **77**. Writers **52**. `PLATFORM_GAPS` `[]`. Schema **27** (no migration). Org **7**. `NIGHT_AUDIT_STEPS` **7**.

### D2 — Required `amountMinor`

**Locked:** HTTP 400 `{ error: 'invalid_body' }` when missing/invalid. RPC `MONEY_INVALID` when missing, non-integer, or `<= 0`. Fingerprint `{ paymentId, amountMinor }`. Full refund = client sends **remaining**.

### D3 — Status + remaining

**Locked:** No `partially_refunded`. Write `refunded_amount_minor`. Status `captured` until remaining `=== 0`, then `refunded`.  
`remainingMinor = (captured_amount_minor ?? amount_minor) - COALESCE(refunded_amount_minor, 0)`.

### D4 — Line ids

**Locked:** `` `${paymentId}:refund:${n}` `` where `n` = 1-based count of existing `PAYMENT_REFUND` lines with `split_of` = capture line id + 1. First partial is `:refund:1` (not `:refund`). Capture line never mutated. Refund lines keep `payment_id = NULL`.

### D5 — Event apply + hybrid idempotency

**Locked:** `applyPaymentEventSync` `payment.refunded` uses `payload.amountMinor`, accumulates `refunded_amount_minor`, copies capture frozen FX. `tryRefundPayment`: if `status === 'refunded'` + matching `refund_fingerprint` → ok; mismatch → `IDEM_KEY_REUSED` **no PSP**. Peek `lookupIdempotentResponse` only when `captured`. Then PSP (card) then `transactionSync` + `runIdempotent`. Do not pre-UPDATE status before event apply. No `payment_refund` table.

### D6 — Wire code + chargeback

**Locked:** `REFUND_EXCEEDS_REMAINING = 'refund_exceeds_remaining'` in `packages/contracts/src/idempotency.ts`; map **422** in `mapPaymentCommandErrorStatus`. If `COALESCE(refunded_amount_minor, 0) > 0` → `PAYMENT_NOT_CHARGEBACKABLE`. Remainder chargeback not implemented.

### D7 — SPA + contracts comment

**Locked:** Amount field default remaining (mirror capture). Keep `data-testid={`refund-payment-${id}`}`. `refundPayment(..., amountMinor, opId)`. Advanced stays collapsed. No simulate copy. `PaymentRefundedV1.amountMinor` comment = this refund's txn amount; version stays **1**. Demo seed untouched. No new `export class`.

### D8 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts` / `@hospai/client-core`** before consumers after those packages change.
2. **Contracts pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **not** `-t "COMMAND_CATALOG|post_demo_seed"`.
3. **Night-audit pin:** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"`.
4. **`pnpm generate:ddl` then `git diff --exit-code -- migrations packages/do-runtime`** must be a **true no-op** (no new SQL).
5. **Fixture dates:** `crypto.randomUUID()`; `check:pms-core-test-dates`.
6. **Unsharded** `pnpm --filter @hospai/pms-core test` may segfault — use `vitest run <file>` or `--shard=N/8` (no `--` before `--shard`).
7. **Do not `|| true` CI failures.** If a shard flakes workerd 503, retry that shard once.
8. **Bidirectional one-sentence pointers** in folio-money-ops + multi-currency specs — **Task 7 only**, plus tick plan checkboxes there.

---

## Global Constraints

- **Heads frozen:** `COMMAND_CATALOG.length === 77`; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `V1_HTTP_ROUTE_AUDIT[101].id === 'post_folio_refund'`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS = []`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 7`.
- **No schema migration.** Column `refunded_amount_minor` already exists; only start writing it.
- **Append-only folio.** Never mutate capture line amounts. Each refund = new `PAYMENT_REFUND` line.
- **Simulate gateway stays.** `simulateRefund` async outside txn; CASH skips PSP.
- **Integer money.** Positive integer txn minor units only.
- **FX on refund lines** copies capture line `fx_rate` / `fx_rate_at` — do not re-quote at refund time.
- **`data-testid`s preserved:** `refund-payment-*`, `folio-advanced`, capture/void testids unchanged.
- **Rebuild client-core** after `packages/client-core/src/api.ts` change: `pnpm --filter @hospai/client-core build` before `@hospai/web-pms` tests.
- Living plan checkboxes: tick `- [x]` on **Task 7 only**.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/idempotency.ts` | `REFUND_EXCEEDS_REMAINING` | 1 |
| `packages/contracts/src/idempotency.test.ts` | Pin new wire code | 1 |
| `packages/contracts/src/events/payment.ts` | `PaymentRefundedV1` comment | 1 |
| `apps/pms-core/src/v1-dispatch.ts` | `mapPaymentCommandErrorStatus` 422 map | 1 |
| `apps/pms-core/src/property-do.ts` | `PaymentRow`; SELECTs; `mapPaymentRow`; `listPaymentsForReservation`; `applyPaymentEventSync`; `tryRefundPayment`; `tryRecordChargeback` guard | 2–5 |
| `apps/pms-core/test/folio-payment-lifecycle.spec.ts` | Cases 28–31 update + partial/idempotency/chargeback tests | 3, 5 |
| `apps/pms-core/test/folio-fx-payments.spec.ts` | Case 15 partial FX | 3 |
| `apps/pms-core/test/folio-payments.spec.ts` | HTTP 400 missing `amountMinor`; 422 over-refund | 4 |
| `packages/client-core/src/api.ts` | `refundPayment`, `FolioPaymentRow.refundedAmountMinor` | 6 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Refund amount UI | 6 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Refund default remaining + staff gate | 6 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | One-sentence pointer §6.3 | 7 |
| `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md` | One-sentence pointer scope-out | 7 |
| this plan file | Tick checkboxes | 7 |

**Not touched:** `COMMAND_CATALOG`, `v1-http-routes.ts` append, migrations, `scripts/demo-seed.mjs`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `AUDIT_WRITER_COMMAND_IDS` membership.

---

## Spec §11 → task map

| # | Acceptance test | Task |
|---|---|---|
| 1 | Schema head 27; `generate:ddl` no-op | 7 |
| 2 | Catalog/route/audit heads unchanged | 7 |
| 3 | Partial then remaining; `:refund:1`/`:refund:2`; status progression | 3 |
| 4 | Over-refund → `refund_exceeds_remaining` (422 HTTP) | 1, 3, 4 |
| 5 | Missing `amountMinor` HTTP → 400 `invalid_body` | 4 |
| 6 | Same idempotency key replay; PSP not called | 3 |
| 7 | Different idempotency key, same amount → second line | 3 |
| 8 | Cash partial skips PSP | 3 |
| 9 | Card partial: `simulateRefund` receives this amount | 3 |
| 10 | FX partial copies frozen rate; line id `:refund:1` | 3 |
| 11 | Partial refund then chargeback → `PAYMENT_NOT_CHARGEBACKABLE` | 5 |
| 12 | Cases 28–31 pass with `amountMinor = remaining`; single full → `:refund:1` | 3 |
| 13 | SPA refund amount defaults to remaining; testid preserved | 6 |
| 14 | Staff without `folio:adjust` — no refund control | 6 |
| 15 | `queryByText(/simulate/i)` null on happy path | 6 |

---

### Task 1: Contracts wire code + `PaymentRefundedV1` comment + dispatch 422 map

**Spec:** §7, §8.1, §11 #4 (wire half), D6, D8.1.

**Files:**
- Modify: `packages/contracts/src/idempotency.ts` (~73–80, after `PAYMENT_NOT_CHARGEBACKABLE`)
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/events/payment.ts` (~30–37)
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `mapPaymentCommandErrorStatus` (~5133–5151)

**Interfaces:**
- Produces: `REFUND_EXCEEDS_REMAINING` export; `PaymentRefundedV1.amountMinor` comment updated; `mapPaymentCommandErrorStatus('refund_exceeds_remaining') === 422`.

**Forbidden this commit:** `property-do.ts`, SPA, HTTP body widen (Task 4).

**Wire constant (normative):**

```ts
export const REFUND_EXCEEDS_REMAINING = 'refund_exceeds_remaining' as const;
```

**`PaymentRefundedV1` comment change:**

```ts
amountMinor: number;          // txn — this refund's amount (partial or final slice)
```

**Dispatch map addition** (inside the existing 422 block ~5137–5150):

```ts
error === REFUND_EXCEEDS_REMAINING ||
```

Import `REFUND_EXCEEDS_REMAINING` from `@hospai/contracts` at top of `v1-dispatch.ts`.

- [ ] **Step 1: Write failing idempotency.test.ts pin**

Add import + assertion in the payment wire codes block (~207):

```ts
import { REFUND_EXCEEDS_REMAINING, /* ... */ } from './idempotency.js';

it('exports payment refund wire codes', () => {
  expect(REFUND_EXCEEDS_REMAINING).toBe('refund_exceeds_remaining');
  expect(PAYMENT_NOT_CHARGEBACKABLE).toBe('payment_not_chargebackable');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts -t "payment refund wire"
```

Expected: FAIL — `REFUND_EXCEEDS_REMAINING` not exported.

- [ ] **Step 3: Implement contracts + comment + dispatch map**

Add constant to `idempotency.ts`. Update `payment.ts` comment. Add `REFUND_EXCEEDS_REMAINING` to 422 list in `mapPaymentCommandErrorStatus`.

- [ ] **Step 4: Rebuild contracts and run tests**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts -t "payment refund wire"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/events/payment.ts \
  apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add refund_exceeds_remaining wire code

Pin REFUND_EXCEEDS_REMAINING, clarify PaymentRefundedV1 amountMinor
semantics, and map over-refund to HTTP 422.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: PaymentRow + SELECT + GET `refundedAmountMinor` (reads only)

**Spec:** §3.3, §6.4, §11 #2 (read half), D3.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `PaymentRow` (~287); `readPaymentRowSync` (~13214); `readPaymentByIdempotencyKeySync` (~13256); `mapPaymentRow` (~13654); `listPaymentsForReservation` (~15399)

**Interfaces:**
- Consumes: none (column already in sqlite from v21).
- Produces: `PaymentRow.refunded_amount_minor: number | null`; API field `refundedAmountMinor: number` (COALESCE 0) on `readPayment`, `mapPaymentRow`, `listPaymentsForReservation`.

**Forbidden this commit:** `tryRefundPayment` write path; `applyPaymentEventSync` changes; SPA.

**Type + SELECT patch (normative):**

```ts
type PaymentRow = {
  // ...existing fields...
  refunded_amount_minor: number | null;
  // ...
};
```

Append `refunded_amount_minor` to both SELECT lists in `readPaymentRowSync` and `readPaymentByIdempotencyKeySync` (after `purpose` or alongside other payment columns — match sqlite column order in `.toArray() as PaymentRow[]` cast).

**`mapPaymentRow`:**

```ts
refundedAmountMinor: row.refunded_amount_minor ?? 0,
```

**`listPaymentsForReservation`:**
- SELECT adds `refunded_amount_minor`.
- Inline row type adds `refunded_amount_minor: number | null`.
- Return map adds `refundedAmountMinor: row.refunded_amount_minor ?? 0`.

- [ ] **Step 1: Write failing read test**

Append to `apps/pms-core/test/folio-payment-lifecycle.spec.ts` (after helpers, before case 28):

```ts
it('reads refundedAmountMinor as 0 before any refund posted', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
  const listed = await stub.listPaymentsForReservation(reservationId);
  expect(listed.ok).toBe(true);
  if (!listed.ok) throw new Error('list');
  expect(listed.payments.find((p) => p.paymentId === paymentId)).toMatchObject({
    status: 'captured',
    refundedAmountMinor: 0,
  });
  const single = await stub.readPayment(paymentId);
  expect(single.ok && single.payment.refundedAmountMinor).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "refundedAmountMinor as 0"
```

Expected: FAIL — property missing or undefined.

- [ ] **Step 3: Implement read widen only**

Do not change refund write logic yet.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "refundedAmountMinor as 0"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-payment-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): expose refundedAmountMinor on payment reads

Select refunded_amount_minor and return COALESCE 0 on list and read
payment JSON without changing refund write behaviour yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `applyPaymentEventSync` + `tryRefundPayment` partial domain

**Spec:** §3–§5, §8.2, §11 #3–4, #6–10, #12, D2–D5, D8.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `applyPaymentEventSync` `payment.refunded` (~13475–13523); `tryRefundPayment` (~14431–14566)
- Modify: `apps/pms-core/test/folio-payment-lifecycle.spec.ts` — update cases 28–31; add partial/idempotency/PSP tests
- Modify: `apps/pms-core/test/folio-fx-payments.spec.ts` — update case 15

**Interfaces:**
- Consumes: `REFUND_EXCEEDS_REMAINING`, `MONEY_INVALID`, `IDEM_KEY_REUSED`, `PAYMENT_NOT_REFUNDABLE` from `@hospai/contracts`; `runIdempotent` from `@hospai/do-runtime`; `lookupIdempotentResponse` (~4045); `simulateRefund`.
- Produces:
  - `tryRefundPayment(actor, { paymentId, amountMinor }, idem)` → `{ ok: true; paymentId; status: 'captured' | 'refunded'; refundedAmountMinor: number }`
  - `applyPaymentEventSync` posts `payload.amountMinor`, line id `` `:refund:${n}` ``, cumulative `refunded_amount_minor`.

**Forbidden this commit:** HTTP handler body (Task 4); chargeback guard (Task 5); SPA.

**`applyPaymentEventSync` `payment.refunded` (replace ~13475–13523):**

```ts
if (event.type === 'payment.refunded') {
  const payment = this.readPaymentRowSync(event.payload.paymentId);
  if (!payment || (payment.status !== 'captured' && payment.status !== 'refunded')) {
    throw new Error(PAYMENT_NOT_REFUNDABLE);
  }
  const captureLineId = `${event.payload.paymentId}:capture`;
  const captureRows = this.ctx.storage.sql
    .exec(
      `SELECT folio_line_id, amount_minor, ledger_amount_minor, txn_currency, fx_rate, fx_rate_at
       FROM folio_line WHERE folio_line_id = ? OR payment_id = ? LIMIT 1`,
      captureLineId,
      event.payload.paymentId,
    )
    .toArray() as Array<{
    folio_line_id: string;
    amount_minor: number;
    ledger_amount_minor: number;
    txn_currency: string;
    fx_rate: string;
    fx_rate_at: number;
  }>;
  const capture = captureRows[0];
  if (!capture) throw new Error(NOT_FOUND);

  const refundTxn = event.payload.amountMinor;
  if (!Number.isInteger(refundTxn) || refundTxn <= 0) throw new Error(MONEY_INVALID);
  const capturedBase = payment.captured_amount_minor ?? payment.amount_minor;
  const refundedBase = payment.refunded_amount_minor ?? 0;
  const remaining = capturedBase - refundedBase;
  if (refundTxn > remaining) throw new Error(REFUND_EXCEEDS_REMAINING);

  let refundLineId = event.payload.folioLineId;
  if (!refundLineId) {
    const countRows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS c FROM folio_line
         WHERE source = 'PAYMENT_REFUND' AND split_of = ?`,
        capture.folio_line_id,
      )
      .toArray() as Array<{ c: number }>;
    const n = Number(countRows[0]?.c ?? 0) + 1;
    refundLineId = `${event.payload.paymentId}:refund:${n}`;
  }

  const ledgerRatio =
    Math.abs(capture.amount_minor) > 0
      ? Math.abs(capture.ledger_amount_minor) / Math.abs(capture.amount_minor)
      : 1;
  const ledgerRefundMinor = Math.round(refundTxn * ledgerRatio);

  this.assertChargeCodeSync('PAYMENT', { requireActive: true });
  this.insertFolioLineSync({
    folioLineId: refundLineId,
    folioWindowId: payment.folio_window_id,
    reservationId: payment.reservation_id,
    chargeCode: 'PAYMENT',
    posted: {
      amountMinor: refundTxn,
      txnCurrency: currencyCode(capture.txn_currency),
      ledgerAmountMinor: ledgerRefundMinor,
      fxRate: capture.fx_rate,
      fxRateAt: capture.fx_rate_at,
    },
    source: 'PAYMENT_REFUND',
    splitOf: capture.folio_line_id,
    paymentId: null,
    businessDate: this.resolvePostingBusinessDateSync(),
  });

  const newRefunded = refundedBase + refundTxn;
  const terminal = newRefunded >= capturedBase;
  this.ctx.storage.sql.exec(
    `UPDATE payment
     SET refunded_amount_minor = ?,
         status = ?,
         last_payment_event_id = ?,
         updated_at = ?
     WHERE payment_id = ?`,
    newRefunded,
    terminal ? 'refunded' : 'captured',
    event.eventId,
    now,
    event.payload.paymentId,
  );
  return { applied: true, folioLineId: refundLineId };
}
```

**`tryRefundPayment` flow (normative outline):**

1. Gate entitlement / `folio:adjust` (unchanged).
2. Validate `amountMinor`: missing/non-integer/`<= 0` → `MONEY_INVALID`.
3. Load payment; `NOT_FOUND` if missing.
4. Compute `remainingMinor`.
5. If `amountMinor > remainingMinor` → `REFUND_EXCEEDS_REMAINING`.
6. If `status === 'refunded'`: matching `refund_fingerprint` → return idempotent `{ ok: true, status: 'refunded', refundedAmountMinor: capturedBase }`; else `IDEM_KEY_REUSED`.
7. If `status !== 'captured'` → `PAYMENT_NOT_REFUNDABLE`.
8. If `status === 'captured'`: `prior = lookupIdempotentResponse(idem)` — `'fingerprint_mismatch'` → `IDEM_KEY_REUSED`; cached → return parsed; `null` → continue.
9. CARD: `await simulateRefund({ paymentId, amountMinor: input.amountMinor, ... })`; declined → `PAYMENT_NOT_REFUNDABLE`.
10. `transactionSync(() => runIdempotent(sql, idem, () => { ... }))`:
    - Re-read payment; re-check remaining/status.
    - **Do not** pre-UPDATE status.
    - `applyPaymentEventSync({ type: 'payment.refunded', payload: { amountMinor: input.amountMinor, folioLineId: computed } })`.
    - `UPDATE payment SET refund_fingerprint = ?` (after apply, or include in apply path — fingerprint on row for fully-refunded idempotent shortcut).
    - Outbox + audit with **this** `amountMinor`, cumulative `refundedAmountMinor`, terminal `status`.
    - Return `{ ok: true, paymentId, status, refundedAmountMinor }`.

Mirror `tryCaptureDueHolds` peek (~14806) + `runIdempotent` (~14818) pattern. Remove the old pre-UPDATE `status = 'refunded'` block (~14491–14497).

**Update cases 28–31** — all `tryRefundPayment` calls must pass `{ paymentId, amountMinor }` and fingerprint `{ paymentId, amountMinor }`:

```ts
// Case 28 — full refund = remaining 8000
const remaining = 8000;
expect(
  await stub.tryRefundPayment(
    TEST_OWNER_ACTOR,
    { paymentId, amountMinor: remaining },
    await idemFor(`refund-${paymentId}`, { paymentId, amountMinor: remaining }),
  ),
).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: remaining });
// Expect line id :refund:1 not :refund
expect(refundLine?.folioLineId ?? folio.lines.find(...)?.folioLineId).toBe(`${paymentId}:refund:1`);
```

Apply same pattern to cases 29 (still `{ paymentId, amountMinor: 3000 }` — fails before amount matters), 30 (cash `amountMinor: 2500`), 31 (full 6000 + idempotent replay).

- [ ] **Step 1: Write failing partial-refund test (spec §11 #3)**

Add to `folio-payment-lifecycle.spec.ts`:

```ts
it('33: partial then remaining refund — :refund:1 then :refund:2, captured then refunded', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 10_000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 10_000)).toMatchObject({ ok: true });
  const before = await stub.readFolio(reservationId);
  const balanceBefore = before.ok ? before.balanceMinor : 0;

  expect(
    await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 4000 },
      await idemFor(`refund-a-${paymentId}`, { paymentId, amountMinor: 4000 }),
    ),
  ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 4000 });

  expect(
    await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 6000 },
      await idemFor(`refund-b-${paymentId}`, { paymentId, amountMinor: 6000 }),
    ),
  ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: 10_000 });

  const pay = await stub.readPayment(paymentId);
  expect(pay.ok && pay.payment.status).toBe('refunded');
  expect(pay.ok && pay.payment.refundedAmountMinor).toBe(10_000);

  const lines = await stub.listFolioLinesForReservation(reservationId);
  const refunds = lines.filter((l) => l.source === 'PAYMENT_REFUND');
  expect(refunds.map((l) => l.folioLineId).sort()).toEqual(
    [`${paymentId}:refund:1`, `${paymentId}:refund:2`].sort(),
  );
  expect(lines.find((l) => l.folioLineId === `${paymentId}:refund:1`)).toMatchObject({
    amountMinor: 4000,
    paymentId: null,
  });
  expect(lines.find((l) => l.folioLineId === `${paymentId}:refund:2`)).toMatchObject({
    amountMinor: 6000,
    paymentId: null,
  });

  const captureLine = lines.find((l) => l.folioLineId === `${paymentId}:capture`);
  expect(captureLine).toMatchObject({ amountMinor: -10_000, source: 'PAYMENT' });

  const after = await stub.readFolio(reservationId);
  expect(after.ok && after.balanceMinor).toBe(balanceBefore + 10_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "33: partial then remaining"
```

Expected: FAIL — still full-refund-only behaviour.

- [ ] **Step 3: Implement `applyPaymentEventSync` + `tryRefundPayment`**

Per normative blocks above. Import `REFUND_EXCEEDS_REMAINING`, `MONEY_INVALID` as needed. Widen return type union for `status: 'captured' | 'refunded'`.

- [ ] **Step 4: Add remaining domain tests + update 28–31 + FX case 15**

**Over-refund (spec #4):**

```ts
it('34: over-refund → refund_exceeds_remaining', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
  expect(
    await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 5001 },
      await idemFor(`ref-over-${paymentId}`, { paymentId, amountMinor: 5001 }),
    ),
  ).toMatchObject({ ok: false, error: REFUND_EXCEEDS_REMAINING });
});
```

Add `REFUND_EXCEEDS_REMAINING` to lifecycle spec imports from `@hospai/contracts`.

**Idempotency PSP skip (spec #6)** — follow case 30 pattern (no `vi.spyOn`; declined lever set **after** first successful refund):

```ts
it('35: idempotent replay skips PSP (declined lever would fail)', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 7000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 7000)).toMatchObject({ ok: true });
  const idem = await idemFor(`ref-idem-${paymentId}`, { paymentId, amountMinor: 7000 });
  expect(
    await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 7000 }, idem),
  ).toMatchObject({ ok: true });
  await stub.setPspSimulateOutcomeForTest({ refund: 'declined' });
  expect(
    await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 7000 }, idem),
  ).toMatchObject({ ok: true });
  await stub.setPspSimulateOutcomeForTest(null);
});
```

**Different keys same amount (spec #7):** two refunds 3000 + 3000 on 10000 capture when remaining allows; expect `:refund:1` and `:refund:2`, status stays `captured` after first.

**Card partial amount (spec #9)** — no spy; assert `PAYMENT_REFUND` line amount (proves apply used this amount, not full capture):

```ts
it('37: card partial refund posts PAYMENT_REFUND line for requested amount', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
  expect(
    await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 2500 },
      await idemFor(`ref-partial-${paymentId}`, { paymentId, amountMinor: 2500 }),
    ),
  ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 2500 });
  const lines = await stub.listFolioLinesForReservation(reservationId);
  expect(lines.find((l) => l.folioLineId === `${paymentId}:refund:1`)).toMatchObject({
    amountMinor: 2500,
    source: 'PAYMENT_REFUND',
    paymentId: null,
  });
});
```

**Update case 30:** pass `{ paymentId: cashId, amountMinor: 2500 }` and fingerprint with `amountMinor`.

**Update `folio-fx-payments.spec.ts` case 15:**

```ts
const partial = 5000;
const remaining = 10000;
expect(
  await stub.tryRefundPayment(
    TEST_OWNER_ACTOR,
    { paymentId, amountMinor: partial },
    await idemFor(`ref-${paymentId}`, { paymentId, amountMinor: partial }),
  ),
).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: partial });
const refund = folio.lines.find((l) => l.folioLineId === `${paymentId}:refund:1`);
expect(refund).toMatchObject({
  amountMinor: partial,
  ledgerAmountMinor: 5500,
  fxRate: '1.10',
  paymentId: null,
});
```

- [ ] **Step 5: Run targeted tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts -t "15: refund copies"
```

Expected: PASS (cases 28–31 included).

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-payment-lifecycle.spec.ts \
  apps/pms-core/test/folio-fx-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): partial refunds on folio.refund command

Honour amountMinor in applyPaymentEventSync and tryRefundPayment with
hybrid idempotency, :refund:n line ids, and cumulative refunded_amount_minor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: HTTP `handlePostFolioRefund` body/fingerprint + HTTP 400/422 tests

**Spec:** §4.2, §6, §11 #4–5, D2.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostFolioRefund` (~5000–5035)
- Modify: `apps/pms-core/test/folio-payments.spec.ts` — append HTTP 400/422 refund tests (same `provisionHotel` / `worker.fetch` + `x-dev-actor` pattern as Test 6 ~840–873)

**Interfaces:**
- Consumes: Task 3 `tryRefundPayment` with `{ paymentId, amountMinor }`.
- Produces: HTTP POST body `{ amountMinor, idempotencyKey }`; fingerprint `{ paymentId, amountMinor }`.

**Forbidden this commit:** chargeback guard; SPA.

**Handler patch (normative):**

```ts
async function handlePostFolioRefund(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { amountMinor?: number; idempotencyKey?: string };
  if (
    !body?.idempotencyKey ||
    typeof body.amountMinor !== 'number' ||
    !Number.isInteger(body.amountMinor) ||
    body.amountMinor <= 0
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { paymentId, amountMinor: body.amountMinor };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  // invoke unchanged except commandPayload now includes amountMinor
}
```

- [ ] **Step 1: Write failing HTTP tests**

Append to `apps/pms-core/test/folio-payments.spec.ts`. Add `REFUND_EXCEEDS_REMAINING` to the `@hospai/contracts` import at top of file.

```ts
it('Test 23: POST refund missing amountMinor → 400 invalid_body', async () => {
  const actor = 'user_pay_owner23';
  const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
  const departure = addDays(arrival, 2);
  const reservationId = 'res_pay_refund_http_400';
  expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
    201,
  );

  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(
    await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-refund-400'),
  ).toMatchObject({ ok: true, status: 'authorized' });
  expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-refund-400')).toMatchObject({
    ok: true,
  });

  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `ref-${paymentId}` }),
      },
    ),
    env,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid_body' });
});

it('Test 24: POST refund over remaining → 422 refund_exceeds_remaining', async () => {
  const actor = 'user_pay_owner24';
  const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
  const departure = addDays(arrival, 2);
  const reservationId = 'res_pay_refund_http_422';
  expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
    201,
  );

  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(
    await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-refund-422'),
  ).toMatchObject({ ok: true, status: 'authorized' });
  expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-refund-422')).toMatchObject({
    ok: true,
  });

  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ amountMinor: 5001, idempotencyKey: `ref-over-${paymentId}` }),
      },
    ),
    env,
  );
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ ok: false, error: REFUND_EXCEEDS_REMAINING });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 23|Test 24"
```

Expected: FAIL — missing body validation or wrong status.

- [ ] **Step 3: Implement handler widen**

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 23|Test 24"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): require amountMinor on folio refund HTTP route

Widen post_folio_refund body and fingerprint; return 400 invalid_body
when amountMinor is missing or invalid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Chargeback guard after partial refund

**Spec:** §9, §11 #11, D6.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryRecordChargeback` (~14598–14601)
- Modify: `apps/pms-core/test/folio-payment-lifecycle.spec.ts`

**Interfaces:**
- Consumes: Task 3 partial refund path writing `refunded_amount_minor > 0`.
- Produces: early guard before status check:

```ts
if ((payment.refunded_amount_minor ?? 0) > 0) {
  return { ok: false, error: PAYMENT_NOT_CHARGEBACKABLE };
}
```

- [ ] **Step 1: Write failing test**

```ts
it('36: chargeback after partial refund → PAYMENT_NOT_CHARGEBACKABLE', async () => {
  const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
  const reservationId = `res_${crypto.randomUUID()}`;
  await seedReservation(stub, reservationId);
  const paymentId = `pay_${crypto.randomUUID()}`;
  expect(await authorize(stub, reservationId, paymentId, 8000)).toMatchObject({ ok: true });
  expect(await capture(stub, paymentId, 8000)).toMatchObject({ ok: true });
  expect(
    await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 2000 },
      await idemFor(`ref-partial-${paymentId}`, { paymentId, amountMinor: 2000 }),
    ),
  ).toMatchObject({ ok: true, status: 'captured' });
  expect(
    await stub.tryRecordChargeback(
      TEST_OWNER_ACTOR,
      { paymentId, feeLedgerMinor: 0, reason: 'test' },
      await idemFor(`cb-${paymentId}`, { paymentId, feeLedgerMinor: 0, reason: 'test' }),
    ),
  ).toMatchObject({ ok: false, error: PAYMENT_NOT_CHARGEBACKABLE });
});
```

Add `PAYMENT_NOT_CHARGEBACKABLE` import if not present.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "36: chargeback after partial"
```

Expected: FAIL — chargeback succeeds or wrong error.

- [ ] **Step 3: Add guard in `tryRecordChargeback`**

Insert guard immediately after payment load (~14598), **before** existing status check.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "36: chargeback after partial"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-payment-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): block chargeback when partial refund posted

Reject folio.record_chargeback with PAYMENT_NOT_CHARGEBACKABLE when
refunded_amount_minor is greater than zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: client-core + FolioScreen SPA + RTL

**Spec:** §10, §11 #13–15, D7, D8.1.

**Files:**
- Modify: `packages/client-core/src/api.ts` (~105–128, ~908–917)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~111, ~660–677, ~826–877)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Interfaces:**
- Consumes: GET `refundedAmountMinor` from Task 2.
- Produces: `refundPayment(propertyId, paymentId, amountMinor, opId)` body `{ amountMinor, idempotencyKey }`; UI default remaining.

**Forbidden this commit:** demo-seed; spec pointers (Task 7); ticking this plan.

**`FolioPaymentRow`:**

```ts
refundedAmountMinor?: number;
```

**`refundPayment`:**

```ts
async refundPayment(propertyId: string, paymentId: string, amountMinor: number, opId: string) {
  const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
  return getJson(
    `/v1/properties/${enc(propertyId)}/folio/payments/${enc(paymentId)}/refund`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountMinor, idempotencyKey }),
    },
  );
},
```

**`FolioScreen.tsx` state + UI:**

```ts
const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
```

Inside tender map for `p.status === 'captured' && canAdjust`:

```tsx
const capturedBase = p.capturedAmountMinor ?? p.amountMinor;
const refundedBase = p.refundedAmountMinor ?? 0;
const remainingMinor = capturedBase - refundedBase;
const defaultRefund = formatMinor(remainingMinor);
const refundValue = refundAmounts[p.paymentId] ?? defaultRefund;
// Input aria-label={`refund-amount-${p.paymentId}`}
// Button keeps data-testid={`refund-payment-${p.paymentId}`}
// onClick: refundPay.mutate({ paymentId: p.paymentId, amountMinor: Math.round(Number(refundValue) * 100) })
```

Update `refundPay.mutationFn`:

```ts
mutationFn: ({ paymentId, amountMinor }: { paymentId: string; amountMinor: number }) => {
  if (!canAdjust) throw new Error('policy_blocked_adjust');
  return api.refundPayment(
    propertyId,
    paymentId,
    amountMinor,
    `refund:${paymentId}:${crypto.randomUUID()}`,
  );
},
```

- [ ] **Step 1: Widen client type + rebuild**

```bash
pnpm --filter @hospai/client-core build
```

- [ ] **Step 2: Write failing FolioScreen tests**

Add to `FolioScreen.test.tsx`:

```ts
it('refund amount input defaults to remaining on captured payment', async () => {
  getMe.mockResolvedValue(ownerMe);
  getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
  getReservation.mockResolvedValue(liveReservation);
  getFolioPayments.mockResolvedValue({
    ok: true,
    payments: [
      {
        paymentId: 'pay_cap',
        reservationId: 'res_1',
        amountMinor: 10_000,
        currency: 'USD',
        status: 'captured',
        capturedAmountMinor: 10_000,
        refundedAmountMinor: 4000,
        gatewayReference: 'gw',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  renderFolio();
  await waitFor(() => expect(screen.getByLabelText('refund-amount-pay_cap')).toBeTruthy());
  expect((screen.getByLabelText('refund-amount-pay_cap') as HTMLInputElement).value).toBe('60.00');
  expect(screen.getByTestId('refund-payment-pay_cap')).toBeTruthy();
});
```

Existing test **54** already asserts staff refund hidden — no change required beyond ensuring it still passes (spec #14). Existing **happy path copy has no simulate** (~1299) must still pass (spec #15).

- [ ] **Step 3: Implement FolioScreen refund amount UI**

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: PASS; no simulate copy in refund path.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): partial refund amount field on folio tenders

Default refund input to remaining capture balance and POST amountMinor
via widened client-core refundPayment API.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Spec pointers + tick checkboxes + full CI

**Spec:** §13 checklist, §11 #1–2, §12, D8.8.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — one sentence §6.3
- Modify: `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md` — one sentence §1.3 scope-out
- Modify: `docs/superpowers/plans/2026-08-14-partial-refunds.md` — checkboxes only

**Pointer sentences (normative):**

Folio-money-ops §6.3 (replace "Full refund only. Partial refund is leftover 4." lead or add after):

> Partial refunds (multiple slices until remainder zero) landed in [2026-08-14 partial refunds](./2026-08-14-partial-refunds-design.md); `folio.refund` now requires `amountMinor` and writes `refunded_amount_minor`.

Multi-currency §1.3 scope-out partial refunds bullet (~65):

> Partial refunds (folio-money-ops leftover 4 remainder) closed in [2026-08-14 partial refunds](./2026-08-14-partial-refunds-design.md); chargeback-of-remainder remains deferred.

- [ ] **Step 1: Pin frozen heads (no schema bump)**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"
```

Expect: catalog **77**; route **[127] = post_demo_seed**; `[101] = post_folio_refund`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 7`.

- [ ] **Step 2: Run targeted partial-refund test superset**

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
pnpm --filter @hospai/pms-core exec vitest run \
  test/folio-payment-lifecycle.spec.ts \
  test/folio-fx-payments.spec.ts \
  test/folio-payments.spec.ts -t "Test 23|Test 24"
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
pnpm check:pms-core-test-dates
```

- [ ] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

```bash
pnpm build
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures.

- [ ] **Step 4: Add spec pointers**

- [ ] **Step 5: Tick every `- [ ]` on Tasks 1–7 in this file**

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md \
  docs/superpowers/plans/2026-08-14-partial-refunds.md
git commit -m "$(cat <<'EOF'
docs: add partial refunds spec pointers and tick plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Chargeback-of-remainder, demo seed, real PSP, and `partially_refunded` status stay deferred per spec §12.

---

## Spec §13 reviewer checklist (copied; implementation must satisfy)

- [ ] `amountMinor` required on HTTP + RPC; fingerprint `{ paymentId, amountMinor }`.
- [ ] `refunded_amount_minor` written; remaining formula §3.1; no schema migration; head **27**.
- [ ] Status `captured` until remainder 0, then `refunded`; no `partially_refunded`.
- [ ] Each refund: one `PAYMENT_REFUND` line; capture untouched; ids `` `:refund:n` ``.
- [ ] `applyPaymentEventSync` honours partial amount + cumulative refund + conditional status.
- [ ] Hybrid idempotency: `refunded` + mismatch → `IDEM_KEY_REUSED` (no peek/PSP); peek via `lookupIdempotentResponse` before PSP for `captured` replays; `runIdempotent` in txn; no `payment_refund` table.
- [ ] `refund_exceeds_remaining` → 422; `MONEY_INVALID` for bad amounts.
- [ ] FX refund uses capture frozen rate (not live quote).
- [ ] `PaymentRefundedV1` comment updated; contract version **1**.
- [ ] GET payments expose `refundedAmountMinor`.
- [ ] SPA amount field + remaining default; testid preserved; staff gate unchanged.
- [ ] Chargeback blocked when `refunded_amount_minor > 0`.
- [ ] `[101]` / catalog **77** / writers **52** / route **[127]** unchanged.
- [ ] Tests §11 green — mapped to Tasks 1–7.
- [ ] Bidirectional pointer sentences in folio-money-ops + multi-currency specs when landed.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–9) | 1–6 |
| §1.3 scope out | forbidden all |
| §2 invariants 1–12 | 2–6 |
| §3 remaining + status | 2–3 |
| §4 command extend | 3–4 |
| §5 applyPaymentEventSync | 3 |
| §6 HTTP widen | 4 |
| §7 wire codes | 1, 3, 4 |
| §8 events/contracts | 1, 3 |
| §9 chargeback guard | 5 |
| §10 SPA | 6 |
| §11 tests 1–15 | 1–7 |
| §12 leftovers deferred | forbidden |
| §13 checklist | 7 |
| §15 file map | 1–7 |
| Heads table §1.1 | 7 |
| D-locks 1–18 | Open decisions |

**Gaps:** None — all §11 numbered acceptance tests map to Tasks 1–7.
