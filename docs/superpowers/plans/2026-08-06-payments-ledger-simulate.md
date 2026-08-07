# Payments Ledger Half (Simulate PSP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship authorize→capture payment ledger against an async simulate PSP, reverse+children folio splits so `balanceMinor` foots, and HTTP routes — without a real PSP.

**Architecture:** `payment` row owns lifecycle (`pending`→terminal); capture posts a negative `folio_line` with FK `payment_id`. Adapter is async and outside `runIdempotent`; row-level fingerprints + conditional `UPDATE` replace the universal idempotency helper across the seam. Simulate gated like jurisdiction (`HOSPAI_UNSAFE_LOCAL` + `HOSPAI_PSP_MODE=simulate`).

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, existing `gatePermission` / `insertFolioLineSync` / `V1_HTTP_ROUTE_AUDIT` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md`](../specs/2026-08-06-payments-ledger-simulate-design.md)

## Global Constraints

- **No `runIdempotent` on authorize/capture** — two-txn seam; `UNIQUE(idempotency_key)` + fingerprints; conditional `UPDATE … WHERE status=…`.
- **Adapter is `async`** even though simulate resolves immediately — unwritable inside `runIdempotent`'s `() => T`.
- **`PSP_UNAVAILABLE` → HTTP 501** (not 503). Kill-switch / transport stay 503.
- **Route indices:** mutate 45–47, reads 48–49 on **both** `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in the same order.
- **Capture amount:** reject request and response when `> payment.amount_minor` before writing a line.
- **Split reverse:** `source = 'SPLIT_REVERSAL'`; children inherit `source` except `NIGHT_AUDIT`→`NULL`; `payment_id` NULL on reverse/children.
- **No `REPLAY_DISPATCH`** for payment commands (all `FAIL_CLOSED`).
- **TDD:** tests that prove seam/`pending` (20), unique index (21), over-capture (22) written before or with the code they lock.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Adapter-first insert as `authorized` (skip `pending`) | Test 20 via `readPayment` |
| Drop `folio_line_payment_uidx` | Test 21 |
| Allow `capture(amount) > auth hold` | Test 22 |
| Keep-source split without reverse | Test 12 / folio-routes Test 6 (`balanceMinor`) |
| Inherit `NIGHT_AUDIT` on reverse | Test 13 |
| Emit `folio.payment_authorized` on decline | Test 4 |
| Map `PSP_UNAVAILABLE` to 503 | Test 6 vs 18 |
| Append audit without matching `V1_ROUTES` | `check:permissions` |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | `PSP_UNAVAILABLE`, `PAYMENT_NOT_CAPTURABLE`, `LINE_NOT_SPLITTABLE` |
| `packages/contracts/src/commands/catalog.ts` | Entitlements; `folio.capture` events; PLATFORM_GAPS reason |
| `packages/contracts/src/entitlements.ts` | Remove three payment opt-outs |
| `packages/contracts/src/v1-http-routes.ts` | Audit 45–49 |
| `packages/do-runtime/src/property-migrations.ts` | v13 payment + ALTER + indexes |
| `migrations/do-property/0013_*.sql` | Generated DDL |
| `apps/pms-core/src/env.ts` | `HOSPAI_PSP_MODE`, `isPspSimulate`, assert branch |
| `apps/pms-core/src/psp-simulate.ts` | Async adapter types + default approve |
| `apps/pms-core/src/property-do.ts` | Payment try*/read*, split rewrite, levers, seed helper |
| `apps/pms-core/src/v1-dispatch.ts` | Five handlers; 501 map |
| `apps/pms-core/vitest.config.ts` + `.dev.vars.example` | `HOSPAI_PSP_MODE=simulate` |
| `apps/pms-core/test/folio-payments.spec.ts` | Matrix 1–11, 14–22 |
| `apps/pms-core/test/folio-routes.spec.ts` | Test 6 rewrite + 12–13 if kept here |

---

### Task 1: Contracts — constants, catalog, entitlements, route audit

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts` (if present; else add expects in register test)
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/entitlements.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `PSP_UNAVAILABLE`, `PAYMENT_NOT_CAPTURABLE`, `LINE_NOT_SPLITTABLE`
- Produces: three payment commands with `entitlement: 'pms.core'`; opt-outs removed
- Produces: `folio.capture.events = ['folio.payment_captured', 'folio.line_posted']`
- Produces: audit rows 45–49

- [ ] **Step 1: Failing register tests (RED)**

```ts
expect(PSP_UNAVAILABLE).toBe('psp_unavailable');
expect(PAYMENT_NOT_CAPTURABLE).toBe('payment_not_capturable');
expect(LINE_NOT_SPLITTABLE).toBe('line_not_splittable');

for (const id of ['folio.authorize', 'folio.capture', 'folio.split_charge_payment'] as const) {
  expect(COMMAND_CATALOG.find((c) => c.id === id)?.entitlement).toBe('pms.core');
  expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === id)).toBeUndefined();
}
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.events).toEqual([
  'folio.payment_captured',
  'folio.line_posted',
]);
expect(V1_HTTP_ROUTE_AUDIT[45]?.id).toBe('post_folio_authorize');
expect(V1_HTTP_ROUTE_AUDIT[46]?.id).toBe('post_folio_capture');
expect(V1_HTTP_ROUTE_AUDIT[47]?.id).toBe('post_folio_split_payment');
expect(V1_HTTP_ROUTE_AUDIT[48]?.id).toBe('get_folio_payment');
expect(V1_HTTP_ROUTE_AUDIT[49]?.id).toBe('get_folio_payments');
expect(PLATFORM_GAPS.find((g) => g.id === 'folio.split_charge_v2')?.reason).toMatch(
  /window|transfer/i,
);
```

Run: `pnpm --filter @hospai/contracts test`  
Expected: FAIL — constants / entitlements / rows missing.

- [ ] **Step 2: Implement (GREEN)**

Add constants next to `SPLIT_AMOUNT_MISMATCH` in `idempotency.ts`.

Catalog: add `entitlement: 'pms.core'` to the three payment commands; set capture events; narrow PLATFORM_GAPS reason to e.g. `'Cross-window split + transfer / routing (reverse+posts landed in payments ledger slice)'`.

Remove the three entries from `ENTITLEMENT_FAIL_CLOSED_OPT_OUT`.

Append audit rows (after `put_domain_config`):

```ts
{ id: 'post_folio_authorize', scope: 'property', permission: 'folio:adjust', commandId: 'folio.authorize' },
{ id: 'post_folio_capture', scope: 'property', permission: 'folio:adjust', commandId: 'folio.capture' },
{ id: 'post_folio_split_payment', scope: 'property', permission: 'folio:adjust', commandId: 'folio.split_charge_payment' },
{
  id: 'get_folio_payment',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_folio_payments',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

Run: `pnpm --filter @hospai/contracts test && pnpm check:entitlements && pnpm check:degraded`  
Expected: PASS (`check:permissions` may fail until Task 6 adds `V1_ROUTES` — OK).

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/entitlements.ts packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts packages/contracts/src/idempotency.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): payment command entitlements, constants, route audit 45–49

EOF
)"
```

---

### Task 2: Migration v13 — `payment` + `folio_line.payment_id`

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Create: `migrations/do-property/0013_payment.sql` (via `pnpm generate:ddl`)

**Interfaces:**
- Produces: `PAYMENT_V13_STATEMENTS` / `PAYMENT_V13_SQL`; `PROPERTY_MIGRATIONS` version 13

- [ ] **Step 1: Add statements + migrate test (RED then GREEN)**

Mirror v12 style. Exact SQL from spec §3.1 including:

```sql
CHECK (amount_minor > 0)
CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0)
CHECK (status IN ('pending','authorized','declined','captured','unknown'))
```

Order: `CREATE TABLE payment` + indexes → `ALTER TABLE folio_line ADD COLUMN payment_id TEXT REFERENCES payment(payment_id)` → `folio_line_payment_uidx`.

Append `{ version: 13, name: 'payment', statements: PAYMENT_V13_STATEMENTS }` to `PROPERTY_MIGRATIONS`.

Add migrate.test.ts case matching on-disk file like `0012_rate_plan`.

Run: `pnpm generate:ddl` then `pnpm --filter @hospai/do-runtime test`  
Expected: PASS; `0013_payment.sql` exists.

- [ ] **Step 2: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/migrate.test.ts \
  migrations/do-property/0013_payment.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v13 payment table and folio_line.payment_id FK

EOF
)"
```

---

### Task 3: Env gate + async simulate adapter

**Files:**
- Modify: `apps/pms-core/src/env.ts`
- Create: `apps/pms-core/src/psp-simulate.ts`
- Modify: `apps/pms-core/vitest.config.ts`
- Modify: `apps/pms-core/.dev.vars.example`
- Modify: `apps/pms-core/test/env.d.ts` (if bindings typed there)

**Interfaces:**
- Produces: `isPspSimulate(env)`, assert branch for `HOSPAI_PSP_MODE=simulate`
- Produces: `authorize` / `capture` async functions returning `{ outcome, gatewayReference?, capturedAmountMinor?, reason? }`

- [ ] **Step 1: Implement env + adapter**

```ts
// env.ts
HOSPAI_PSP_MODE?: string;

export function isPspSimulate(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_PSP_MODE === 'simulate';
}

// assertEnvSafeForRequest — add branch mirroring jurisdiction:
// HOSPAI_PSP_MODE === 'simulate' && !unsafe → 500 misconfigured
```

```ts
// psp-simulate.ts
export type PspAuthorizeResult =
  | { outcome: 'approved'; gatewayReference: string }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'timeout' };

export type PspCaptureResult =
  | { outcome: 'approved'; gatewayReference: string; capturedAmountMinor: number }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'timeout' };

export type PspSimulateOutcome = {
  authorize?: 'approved' | 'declined' | 'timeout';
  capture?: 'approved' | 'declined' | 'timeout';
  captureAmountMinor?: number;
  failAfterAdapter?: boolean;
};

/** Async by design — must not be awaitable inside runIdempotent. */
export async function simulateAuthorize(
  input: { paymentId: string; amountMinor: number; currency: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspAuthorizeResult> {
  const mode = outcome?.authorize ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  return { outcome: 'approved', gatewayReference: `sim_${input.paymentId}` };
}

export async function simulateCapture(
  input: { paymentId: string; amountMinor: number; gatewayReference: string; currency: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspCaptureResult> {
  const mode = outcome?.capture ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  const capturedAmountMinor = outcome?.captureAmountMinor ?? input.amountMinor;
  return {
    outcome: 'approved',
    gatewayReference: input.gatewayReference,
    capturedAmountMinor,
  };
}
```

Vitest bindings + `.dev.vars.example`: `HOSPAI_PSP_MODE=simulate`.

- [ ] **Step 2: Unit-test assertEnvSafeForRequest simulate-without-unsafe (feeds matrix test 19)**

Run a small env unit test or defer assertion to Task 6 HTTP test 19.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/env.ts apps/pms-core/src/psp-simulate.ts \
  apps/pms-core/vitest.config.ts apps/pms-core/.dev.vars.example apps/pms-core/test/env.d.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): PSP simulate env gate and async adapter

EOF
)"
```

---

### Task 4: Split rewrite — reverse + children

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`trySplitFolioLine`, extract `splitFolioLineSync`)
- Modify: `apps/pms-core/test/folio-routes.spec.ts` (Test 6)

**Interfaces:**
- Produces: shared sync helper used later by `trySplitChargePayment`
- Consumes: `insertFolioLineSync` (extend with optional `paymentId` if not done in Task 2 wiring)

- [ ] **Step 1: Rewrite Test 6 (RED)**

```ts
it('Test 6: POST .../folio/split reverse+children keeps balance', async () => {
  // post 3000 MISC, split 1000+2000
  // expect lines length 4 (source + reverse + 2 children)
  // expect balanceMinor === 3000
  // expect one line with source === 'SPLIT_REVERSAL' and amountMinor === -3000
  // expect children splitOf === sourceId, source null (charge path)
});
```

Run: `pnpm --filter pms-core test -- folio-routes`  
Expected: FAIL — balance 6000 / length 3.

- [ ] **Step 2: Implement reverse+children in `trySplitFolioLine` (GREEN)**

Inside `runIdempotent` execute:

1. Load source; reject if missing, if `source === 'PAYMENT'`, if `source === 'SPLIT_REVERSAL'` (`LINE_NOT_SPLITTABLE`).
2. Foot check → `SPLIT_AMOUNT_MISMATCH`.
3. Insert reverse: `amountMinor = -source.amount_minor`, `chargeCode = source.charge_code`, `source: 'SPLIT_REVERSAL'`, `splitOf: sourceId`, `paymentId: null`.
4. Insert children: inherit money fields; `source: source.source === 'NIGHT_AUDIT' ? null : source.source` (for charge split today source is usually null); `paymentId: null`; `splitOf: sourceId`.
5. Do not mutate source row.

Also add night-audit split coverage (spec test 13) in this file or folio-payments.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-routes.spec.ts
git commit -m "$(cat <<'EOF'
fix(folio): reverse+children splits so balanceMinor foots

EOF
)"
```

---

### Task 5: PropertyDO payment methods + levers

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create: `apps/pms-core/test/folio-payments.spec.ts` (core DO-level cases first)

**Interfaces:**
- Produces: `tryAuthorizePayment`, `tryCapturePayment`, `readPayment`, `listPaymentsForReservation`, `trySplitChargePayment`, `setPspSimulateOutcomeForTest`, `insertFolioLineWithPaymentIdForTest` (constraint probe)
- Consumes: `simulateAuthorize` / `simulateCapture`, `isPspSimulate`, `insertFolioLineSync` with `paymentId`

- [ ] **Step 1: Write failing tests 1, 2, 4, 20, 22 (RED)**

Use DO stubs directly (faster feedback) before HTTP:

```ts
// Test 20 sketch
await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
const auth = await stub.tryAuthorizePayment(actor, { … });
expect(auth.ok).toBe(false); // or throws — pick one and stick to it in implementation
const read = await stub.readPayment(paymentId);
expect(read.ok && read.payment.status).toBe('pending');
expect(read.ok && read.payment.gatewayReference).toBeNull();

// Test 22
await stub.tryAuthorizePayment(… amountMinor: 10000 …);
const cap = await stub.tryCapturePayment(… amountMinor: 999999 …);
expect(cap).toEqual({ ok: false, error: PAYMENT_NOT_CAPTURABLE });
```

- [ ] **Step 2: Implement payment RPCs (GREEN)**

**`setPspSimulateOutcomeForTest`:** store on instance; `assertUnsafeLocal`; clear after read or sticky until cleared — match transport-blocked sticky pattern; document whether one-shot. Prefer **sticky until cleared** like `setTransportBlockedForTest`.

**`tryAuthorizePayment`:**

1. `assertRpcAvailable`; gates (`gateCoreEntitlement`, `gatePermission(actor,'folio:adjust')`); if `!isPspSimulate(this.env)` return `PSP_UNAVAILABLE`.
2. Txn 1: ensure window; `INSERT payment` pending. Catch unique → compare `request_fingerprint` → `IDEM_KEY_REUSED` or return current via `readPayment` shape.
3. `await simulateAuthorize(…)`. If `failAfterAdapter` → return error / throw **without** txn 2 (leave pending).
4. Txn 2: conditional update from `pending`; emit outbox only on `authorized` (`folio.payment_authorized`). Decline/timeout: update status, **no** authorized event.

**`tryCapturePayment`:**

1. Gates + simulate check.
2. Load payment; status edges; fingerprint idempotency for `captured`.
3. Request amount `> payment.amount_minor` → `PAYMENT_NOT_CAPTURABLE`.
4. `await simulateCapture`.
5. Response `capturedAmountMinor > payment.amount_minor` → `PAYMENT_NOT_CAPTURABLE`, status stays `authorized`.
6. Txn: conditional `authorized`→`captured`; `insertFolioLineSync` negative `PAYMENT` / `PAYMENT` / `paymentId`; outbox both events.

**`readPayment` / `listPaymentsForReservation`:** plain reads; `NOT_FOUND` when missing.

**`trySplitChargePayment`:** `runIdempotent`; reject unless `source === 'PAYMENT'`; reuse split helper; reject `SPLIT_REVERSAL`.

**`insertDuplicatePaymentLineForTest`:** bypass application mutex; insert second line with same `payment_id` for test 21.

Extend `readFolio` line mapping with `paymentId: row.payment_id`.

- [ ] **Step 3: Fill remaining DO matrix tests 3, 5, 7–11, 14–17, 21**

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(property-do): payment authorize/capture state machine and payment reads

EOF
)"
```

---

### Task 6: HTTP routes + error map

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/test/folio-payments.spec.ts` (HTTP cases 6, 18, 19 + route happy paths)

**Interfaces:**
- Produces: `V1_ROUTES` entries 45–49 matching audit order
- Produces: `PSP_UNAVAILABLE` → 501 in payment error mapper

- [ ] **Step 1: Add handlers + routes (same order as audit)**

```ts
// Patterns
POST /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments\/authorize$/
POST /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/capture$/
POST /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/split-payment$/
GET  /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)$/
GET  /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments$/
```

Handlers: fingerprint via `fingerprintPayload`; call DO; map errors:

```ts
function mapPaymentCommandErrorStatus(error: string): number {
  if (error === PSP_UNAVAILABLE) return 501;
  if (error === IDEM_KEY_REUSED) return 409;
  if (error === NOT_FOUND) return 404;
  if (
    error === PAYMENT_NOT_CAPTURABLE ||
    error === LINE_NOT_SPLITTABLE ||
    error === SPLIT_AMOUNT_MISMATCH ||
    error === MONEY_INVALID
  )
    return 422;
  // entitlement / forbidden / not_member — same as folio siblings
  return mapReservationCommandErrorStatus(error);
}
```

Use `invokePropertyDo` only if needed for `FAIL_CLOSED` transport mapping — payment commands must **not** queue. Follow `handlePostFolioSplit` (FAIL_CLOSED) not `handlePostFolioLines`.

- [ ] **Step 2: HTTP tests 6, 18, 19 + authorize/capture via HTTP**

- [ ] **Step 3: Run checks**

```bash
pnpm check:permissions && pnpm check:entitlements && pnpm check:degraded
pnpm --filter pms-core test -- folio-payments folio-routes
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): payment HTTP routes with 501 for psp_unavailable

EOF
)"
```

---

### Task 7: Spec acceptance sweep

- [ ] **Step 1: Confirm matrix 1–22 covered** (grep test titles in `folio-payments.spec.ts` / `folio-routes.spec.ts`).

- [ ] **Step 2: Confirm no `REPLAY_DISPATCH` payment entries; catalog events allowlist still green (consumer already lists both payment events).

- [ ] **Step 3: Final commit if any leftover fixes

```bash
git commit -m "$(cat <<'EOF'
test(pms-core): complete payments ledger matrix coverage

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Storage C + FK + partial unique | 2, 5 (test 21) |
| Checkout untouched | — (no task; don't touch `tryCheckOut`) |
| Window closure unused / wire lie | — (no status writes) |
| Async simulate + failAfterAdapter | 3, 5 (test 20) |
| Fingerprints / no runIdempotent on pay | 5 |
| Capture amount bounds | 5 (test 22) |
| Reverse+children + asymmetric source | 4, 5 (`trySplitChargePayment`) |
| readPayment / list + GET routes | 5, 6 |
| 501 vs 503 | 6 (tests 6, 18) |
| Entitlement pairing | 1 |
| CHECKs on amount | 2 |
| Decline no authorized event | 5 (test 4) |

No placeholders. Types in Task 5 match Task 3 adapter results. Route indices locked to 45–49.
