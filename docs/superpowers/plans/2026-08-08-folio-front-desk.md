# Folio Front-Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the folio operator surface — folded lines with tax attachment, policy-C outage behaviour, classify extensions (403/501/409-idem), holds as capture rows, add charge / cash / card / splits / checkout — on `/folio/:reservationId`.

**Architecture:** Minimal server gap (`readFolio` + `taxOf`/`taxRuleId`). Pure derivation and policy in `@hospai/client-core` (`foldFolioLines`, `folioActionPolicy`, classify, queued-log context). Thin `FolioScreen` in `web-pms` over TanStack Query; mutations follow the invalidation matrix (authorize → payments only).

**Tech Stack:** TypeScript, vitest, React 19, TanStack Query 5, React Router 7, existing `@hospai/contracts` / PropertyDO HTTP routes.

**Spec:** [`docs/superpowers/specs/2026-08-08-folio-front-desk-design.md`](../specs/2026-08-08-folio-front-desk-design.md)

## Global Constraints

- **Verification:** plant-one-mutation → named canary fails (no silent mutation).
- **Fold:** live = not superseded AND `source !== 'SPLIT_REVERSAL'`; one-level tree; sum `ledgerAmountMinor`; preserve `created_at` ASC; `orphanTax` = defect indicator.
- **Policy C:** folio `fail_closed` → refuse charge/pay/split; allow checkout when status known/`checked_in`. Pure `folioActionPolicy` — screen must consult it (SPA: charge submit issues **no request**).
- **Classify:** `forbidden` (403), `not_configured` (501 + `psp_unavailable`), `idempotency_key_reused` (409 + body error). `shouldRetry` still **only** `read_stale`.
- **403 permission copy:** body.permission ?? `V1_HTTP_ROUTE_AUDIT` entry for the route just called.
- **Holds:** actionable rows with capture + `amountMinor` (partial allowed); authorize is a separate form.
- **Invalidation:** authorize → **payments only** (not folio). SPA wiring check required.
- **Balance chrome:** server `balanceMinor`, never `liveTotalMinor`.
- **Checkout:** provisional chrome ≠ checked-out; nonzero balance confirm; outage copy required when folio unread.
- **Queued log:** `recordFromProvisionalBody(body, { reservationId? })`; untagged → “other queued commands”.
- **Unattributed cash accepted** this slice (`shift_id` NULL).
- **TDD** for client-core canaries; commit after each task.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Omit `taxOf` from `readFolio` SELECT | Task 1 wire test |
| Live includes `SPLIT_REVERSAL` | Fold invariant (8-line → 0) |
| Re-add `children` / nest live under superseded | Split-of-child canary stays one-level |
| Flip policy to allow charge when folio fail_closed | `folioActionPolicy` + SPA no-request |
| 501 → `server_error` | Classify canary |
| 409 always → `idempotency_key_reused` | Other-409 canary |
| Authorize invalidates folio only | SPA authorize-invalidation check |
| Balance shows `liveTotalMinor` | SPA balance-source check |
| Provisional checkout shows “Checked out” | SPA provisional chrome |
| `shouldRetry` true for new classes | Classify shouldRetry canary |

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/pms-core/src/property-do.ts` | `readFolio` SELECT + map `taxOf`/`taxRuleId` |
| `apps/pms-core/test/tax-posting.spec.ts` (or folio-routes) | Wire assertion taxed line includes fields |
| `packages/client-core/src/classify.ts` | New result classes |
| `packages/client-core/test/classify.test.ts` | Classify canaries |
| `packages/client-core/src/permission-copy.ts` | `permissionForForbidden(body, routeId)` |
| `packages/client-core/test/permission-copy.test.ts` | Body + audit fallback |
| `packages/client-core/src/queued-commands.ts` | Optional `reservationId` context |
| `packages/client-core/src/folio-fold.ts` | `foldFolioLines` |
| `packages/client-core/test/folio-fold.test.ts` | Fold canaries |
| `packages/client-core/src/folio-action-policy.ts` | `folioActionPolicy` |
| `packages/client-core/test/folio-action-policy.test.ts` | Policy C canaries |
| `packages/client-core/src/api.ts` | Folio/reservation/payments/checkout methods; provisional context |
| `packages/client-core/src/index.ts` | Re-exports |
| `packages/client-core/test/api-folio.test.ts` | API + queued context + authorize path smoke |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Screen |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | SPA wiring canaries |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Folio links ×3 modes |
| `apps/web-pms/src/App.tsx` | Route |

---

### Task 1: Server — `readFolio` exposes `taxOf` / `taxRuleId`

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`readFolio` ~7638–7713)
- Modify: `apps/pms-core/test/tax-posting.spec.ts` (add assertion after an existing taxed post) **or** new focused it in `folio-routes.spec.ts`

**Interfaces:**
- Produces: each `readFolio` line includes `taxOf: string | null`, `taxRuleId: string | null`

- [ ] **Step 1: Failing test (RED)**

In `tax-posting.spec.ts`, after a path that posts a charge + TAX line, call `stub.readFolio(reservationId)` and assert:

```ts
const folio = await stub.readFolio(reservationId);
expect(folio.ok).toBe(true);
if (!folio.ok) return;
const tax = folio.lines.find((l) => l.source === 'TAX');
expect(tax).toBeTruthy();
expect(tax!.taxOf).toBeTruthy();
expect(tax!.taxRuleId).toBeTruthy();
```

- [ ] **Step 2: Run test — expect fail** (fields undefined / type error)

Run: `cd apps/pms-core && npx vitest run test/tax-posting.spec.ts -t 'readFolio'`  
(or the new test name)

- [ ] **Step 3: Implement**

Extend `readFolio` SELECT:

```sql
SELECT folio_line_id, charge_code, amount_minor, ledger_amount_minor, txn_currency,
       source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id
FROM folio_line WHERE reservation_id = ?
ORDER BY created_at ASC
```

Map `taxOf: row.tax_of`, `taxRuleId: row.tax_rule_id` on the return type and mapped objects.

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/tax-posting.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): expose taxOf and taxRuleId on readFolio

EOF
)"
```

---

### Task 2: Classify — `forbidden`, `not_configured`, `idempotency_key_reused`

**Files:**
- Modify: `packages/client-core/src/classify.ts`
- Modify: `packages/client-core/test/classify.test.ts`

**Interfaces:**
- Extends `ClientResultClass` with `'forbidden' | 'not_configured' | 'idempotency_key_reused'`
- `shouldRetry` remains true only for `read_stale`

- [ ] **Step 1: Failing tests (RED)**

```ts
it('403 is forbidden never retry', () => {
  const c = classifyResponse({
    status: 403,
    headers: hdr(),
    body: { error: 'forbidden', permission: 'folio:adjust' },
  });
  expect(c.class).toBe('forbidden');
  expect(shouldRetry(c)).toBe(false);
});

it('501 psp_unavailable is not_configured never retry', () => {
  const c = classifyResponse({
    status: 501,
    headers: hdr(),
    body: { ok: false, error: 'psp_unavailable' },
  });
  expect(c.class).toBe('not_configured');
  expect(shouldRetry(c)).toBe(false);
});

it('501 without psp_unavailable stays server_error', () => {
  const c = classifyResponse({
    status: 501,
    headers: hdr(),
    body: { error: 'not_implemented' },
  });
  expect(c.class).toBe('server_error');
});

it('409 idempotency_key_reused is dedicated class; other 409 is client_error', () => {
  const a = classifyResponse({
    status: 409,
    headers: hdr(),
    body: { error: 'idempotency_key_reused' },
  });
  const b = classifyResponse({
    status: 409,
    headers: hdr(),
    body: { error: 'guest_exists' },
  });
  expect(a.class).toBe('idempotency_key_reused');
  expect(shouldRetry(a)).toBe(false);
  expect(b.class).toBe('client_error');
});
```

- [ ] **Step 2: Run — RED**

Run: `cd packages/client-core && npm test -- test/classify.test.ts`

- [ ] **Step 3: Implement**

In `classifyResponse`, before generic 4xx/5xx buckets:

```ts
if (status === 403) {
  return { class: 'forbidden', status, body, retryAfterMs: null };
}
if (status === 409 && record?.error === 'idempotency_key_reused') {
  return { class: 'idempotency_key_reused', status, body, retryAfterMs: null };
}
// ... existing 4xx ...
if (status === 501 && record?.error === 'psp_unavailable') {
  return { class: 'not_configured', status, body, retryAfterMs: null };
}
if (status >= 500) {
  return { class: 'server_error', status, body, retryAfterMs: null };
}
```

Order: handle 501 `psp_unavailable` **before** the generic `status >= 500` branch.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/classify.ts packages/client-core/test/classify.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): classify forbidden, not_configured, idempotency reuse

EOF
)"
```

---

### Task 3: Permission copy — body then route audit

**Files:**
- Create: `packages/client-core/src/permission-copy.ts`
- Create: `packages/client-core/test/permission-copy.test.ts`
- Modify: `packages/client-core/src/index.ts`

**Interfaces:**
- Produces: `permissionForForbidden(body: unknown, routeId: string): string | null`

- [ ] **Step 1: Failing tests (RED)**

```ts
import { describe, expect, it } from 'vitest';
import { permissionForForbidden } from '../src/permission-copy.js';

describe('permissionForForbidden', () => {
  it('prefers body.permission', () => {
    expect(
      permissionForForbidden({ error: 'forbidden', permission: 'folio:adjust' }, 'post_folio_split'),
    ).toBe('folio:adjust');
  });

  it('falls back to V1_HTTP_ROUTE_AUDIT when body omits permission', () => {
    expect(permissionForForbidden({ error: 'forbidden' }, 'post_folio_split')).toBe('folio:adjust');
  });

  it('returns null when neither body nor audit has permission', () => {
    expect(permissionForForbidden({ error: 'forbidden' }, 'post_orgs')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement**

```ts
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts/v1-http-routes';

export function permissionForForbidden(body: unknown, routeId: string): string | null {
  if (body !== null && typeof body === 'object') {
    const p = (body as Record<string, unknown>).permission;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  const row = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === routeId);
  if (row && 'permission' in row && typeof row.permission === 'string') {
    return row.permission;
  }
  return null;
}
```

Confirm `@hospai/contracts/v1-http-routes` is already a browser-safe subpath (shell slice). Export from `index.ts`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/permission-copy.ts packages/client-core/test/permission-copy.test.ts packages/client-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(client-core): resolve forbidden permission from body or route audit

EOF
)"
```

---

### Task 4: Queued-command log — caller context

**Files:**
- Modify: `packages/client-core/src/queued-commands.ts`
- Modify: `packages/client-core/test/queued-commands.test.ts`

**Interfaces:**
- `QueuedCommandEntry.reservationId?: string`
- `recordFromProvisionalBody(body, context?: { reservationId?: string })`
- Optional helper: `partitionQueuedByReservation(entries, reservationId) → { forReservation, other }`

- [ ] **Step 1: Failing tests (RED)**

```ts
it('records optional reservationId from caller context', () => {
  const log = createQueuedCommandLog();
  log.recordFromProvisionalBody(
    {
      provisional: true,
      commandId: 'folio.add_item',
      idempotencyKey: 'k1',
      issuedAt: '2026-08-08T00:00:00.000Z',
    },
    { reservationId: 'res_1' },
  );
  expect(log.entries()[0]?.reservationId).toBe('res_1');
});

it('partition puts untagged in other', () => {
  // after implementing partitionQueuedByReservation
});
```

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement** context merge + partition helper

```ts
export function partitionQueuedByReservation(
  entries: readonly QueuedCommandEntry[],
  reservationId: string,
): { forReservation: QueuedCommandEntry[]; other: QueuedCommandEntry[] } {
  const forReservation: QueuedCommandEntry[] = [];
  const other: QueuedCommandEntry[] = [];
  for (const e of entries) {
    if (e.reservationId === reservationId) forReservation.push(e);
    else other.push(e);
  }
  return { forReservation, other };
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/queued-commands.ts packages/client-core/test/queued-commands.test.ts packages/client-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(client-core): tag queued commands with caller reservationId

EOF
)"
```

---

### Task 5: `foldFolioLines`

**Files:**
- Create: `packages/client-core/src/folio-fold.ts`
- Create: `packages/client-core/test/folio-fold.test.ts`
- Modify: `packages/client-core/src/index.ts`

**Interfaces:**

```ts
export type FolioLine = {
  folioLineId: string;
  chargeCode: string;
  amountMinor: number;
  ledgerAmountMinor: number;
  txnCurrency: string;
  source: string | null;
  businessDate: string | null;
  splitOf: string | null;
  createdAt: number;
  paymentId: string | null;
  taxOf: string | null;
  taxRuleId: string | null;
};

export type FolioDisplayNode = {
  line: FolioLine;
  taxes: FolioDisplayNode[];
  orphanTax?: boolean;
};

export type FolioFoldResult = {
  roots: FolioDisplayNode[];
  liveTotalMinor: number;
};

export function foldFolioLines(lines: readonly FolioLine[]): FolioFoldResult;
```

- [ ] **Step 1: Failing tests (RED)** — include at minimum:

1. Charge + tax: `liveTotalMinor === balance`, tax nested.
2. **8-line taxed split** (amounts as in spec): liveTotal 110; one-level; no reversals in roots.
3. **Split-of-child:** after second split, still one-level; liveTotal matches.
4. **Order:** roots follow `createdAt` ASC of live non-tax / orphan roots.
5. **Orphan tax** hand fixture: `orphanTax: true`, still in liveTotal.
6. Payment line (negative) included in liveTotal.

Use explicit fixtures; assert `fold.liveTotalMinor === expectedBalance` without re-deriving the sum in a second ad-hoc reduce over a different predicate.

- [ ] **Step 2: Run — RED**

Run: `cd packages/client-core && npm test -- test/folio-fold.test.ts`

- [ ] **Step 3: Implement**

Algorithm sketch:

1. Index by id; build set of ids that appear as any `splitOf`.
2. `isLive(line)` = `!superseded.has(id) && line.source !== 'SPLIT_REVERSAL'`.
3. `liveTotalMinor` = sum `ledgerAmountMinor` where `isLive`.
4. Walk lines in array order (wire order); for each live non-TAX line, emit root with `taxes` = live TAX lines where `taxOf === id` (stable relative order).
5. Live TAX whose `taxOf` missing or not a live charge → root with `orphanTax: true`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/folio-fold.ts packages/client-core/test/folio-fold.test.ts packages/client-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(client-core): fold folio lines into one-level live display tree

EOF
)"
```

---

### Task 6: `folioActionPolicy`

**Files:**
- Create: `packages/client-core/src/folio-action-policy.ts`
- Create: `packages/client-core/test/folio-action-policy.test.ts`
- Modify: `packages/client-core/src/index.ts`

**Interfaces:**

```ts
export type FolioActionPolicyInput = {
  folioReadClass: ClientResultClass | 'pending' | 'live';
  reservationReadClass: ClientResultClass | 'pending' | 'live';
  reservationStatus: string | null;
};

export type FolioActionPolicy = {
  canPostCharge: boolean;
  canPay: boolean;
  canSplit: boolean;
  canCheckout: boolean;
  reasons: {
    charge?: string;
    pay?: string;
    split?: string;
    checkout?: string;
  };
};

export function folioActionPolicy(input: FolioActionPolicyInput): FolioActionPolicy;
```

Use `'live'` for successful reads (or pass `null` class meaning ok — pick one and stick to it in screen). Recommended: screen passes `fail_closed` | `live` | `pending` | other error classes.

**Rules:**

- If `folioReadClass === 'fail_closed'`: `canPostCharge/canPay/canSplit = false` with reason about unread folio; `canCheckout` still evaluated from reservation.
- If `reservationReadClass === 'fail_closed'` OR status null/unknown when not live: `canCheckout = false` (precondition unknown).
- If reservation live and `status === 'checked_in'`: `canCheckout = true` (even when folio fail_closed).
- If folio live (or pending→treat as not fail_closed for money? **Lock:** only `fail_closed` blocks money; other folio errors also block money writes): block charge/pay/split unless folio class is `live`.
- Pending: disable all actions (no false enables).

- [ ] **Step 1: Failing tests (RED)** covering policy C, reservation-unknown hides checkout, happy path, pending disables.

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/folio-action-policy.ts packages/client-core/test/folio-action-policy.test.ts packages/client-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(client-core): folioActionPolicy for outage policy C

EOF
)"
```

---

### Task 7: API methods + provisional context plumbing

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Create: `packages/client-core/test/api-folio.test.ts` (transport stub pattern from `api.test.ts`)

**Interfaces:** extend `createClient` return with:

```ts
getFolio(propertyId, reservationId): Promise<FolioRead> // throws ClassifiedError
getReservation(propertyId, reservationId): Promise<ReservationRead>
getFolioPayments(propertyId, reservationId): Promise<{ payments: PaymentRow[] }>
addFolioLine(propertyId, reservationId, { chargeCode, amountMinor }, opId)
recordCashPayment(propertyId, reservationId, { paymentId, amountMinor }, opId)
authorizePayment(propertyId, reservationId, { paymentId, amountMinor }, opId)
capturePayment(propertyId, paymentId, { amountMinor }, opId)
splitFolioLine(propertyId, sourceFolioLineId, { splits }, opId)
splitFolioPayment(propertyId, sourceFolioLineId, { splits }, opId)
checkOut(propertyId, reservationId, opId)
```

Paths (from `V1_ROUTES`):

| Method | Path |
|---|---|
| getFolio | `GET /v1/properties/:pid/reservations/:rid/folio` |
| getReservation | `GET /v1/properties/:pid/reservations/:rid` |
| getFolioPayments | `GET /v1/properties/:pid/reservations/:rid/folio/payments` |
| addFolioLine | `POST .../folio/lines` body `{ chargeCode, amountMinor, idempotencyKey }` |
| cash | `POST .../folio/payments/cash` |
| authorize | `POST .../folio/payments/authorize` |
| capture | `POST /v1/properties/:pid/folio/payments/:paymentId/capture` |
| split | `POST /v1/properties/:pid/folio/lines/:lineId/split` |
| split payment | `POST .../folio/lines/:lineId/split-payment` |
| checkOut | `POST .../reservations/:rid/check-out` |

- [ ] **Step 1: Failing tests (RED)**

- `addFolioLine` / `checkOut` provisional 202 → queued entry has `reservationId`.
- `authorizePayment` 501 `psp_unavailable` → throws `ClassifiedError` with `not_configured`.
- `splitFolioLine` 403 bare body → throw `forbidden` (copy resolved at screen via `permissionForForbidden(..., 'post_folio_split')`).

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement**

Change internal `getJson` to accept optional `queueContext?: { reservationId?: string }` and pass to `recordFromProvisionalBody`. Every folio mutation that can 202 passes `{ reservationId }`.

Generate client `paymentId` for authorize/cash with a stable op-scoped id (e.g. `pay:${opId}` or `crypto.randomUUID()` stored via keyStore companion — match server expectation: body must include `paymentId`). Prefer `paymentId` derived from opId for idempotent retries: `` `pay_${idempotencyKey}` `` or pass through from form state created once per form mount.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/test/api-folio.test.ts packages/client-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(client-core): folio, payments, and checkout API methods

EOF
)"
```

---

### Task 8: Route + board links + FolioScreen reads/fold/policy chrome

**Files:**
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx`
- Create: `apps/web-pms/src/screens/FolioScreen.tsx`
- Create: `apps/web-pms/src/screens/FolioScreen.test.tsx` (start with mount + policy no-request + balance source; expand in Task 9–10)

**Interfaces:**
- Route: `folio/:reservationId`
- Board: Folio link on arrivals, departures, in-house rows

- [ ] **Step 1: Wire route + board links**

```tsx
<Route path="folio/:reservationId" element={<FolioScreen />} />
```

In `BoardTable` actions column, always include:

```tsx
<Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>Folio</Link>
```

(alongside Check in on arrivals).

- [ ] **Step 2: FolioScreen skeleton**

Parallel queries:

- `['folio', propertyId, reservationId]` → `api.getFolio`
- `['reservation', propertyId, reservationId]` → `api.getReservation`
- `['folio-payments', propertyId, reservationId]` → `api.getFolioPayments`
- guest batch via `api.postGuestsBatch(propertyId, [guestRef])` when reservation has `guestRef`

Map query errors through `asClassified` → `folioActionPolicy`.

Render: header, `balanceMinor` from folio data, holds list (rows; capture UI stub ok until Task 9), folded roots, queued partition, action buttons **disabled** per policy (do not call API when `!canPostCharge`).

- [ ] **Step 3: SPA tests (RED then GREEN)**

```tsx
it('policy C: charge submit does not issue a request when folio fail_closed', async () => {
  // mock transport/fetch: folio GET → 503 FAIL_CLOSED; reservation GET → 200 checked_in
  // render FolioScreen; click Add charge / submit form
  // expect no POST .../folio/lines
});

it('balance chrome uses server balanceMinor not liveTotalMinor', async () => {
  // folio returns balanceMinor: 110 with lines that fold to 110
  // assert document shows 110 from server field — spy or distinct fixture if needed
});
```

For balance: easiest assert is text content matching formatted `balanceMinor` from mock body; fold is not consulted for that node.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/App.tsx apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): folio route, board links, and policy-gated screen shell

EOF
)"
```

---

### Task 9: Mutations — charge, cash, authorize, capture, split, checkout

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Invalidation (must match):**

| Action | `queryClient.invalidateQueries` |
|---|---|
| add charge | `['folio', …]` |
| cash | `['folio', …]` + `['folio-payments', …]` |
| authorize | **`['folio-payments', …]` only** |
| capture | folio + payments |
| split / split payment | folio |
| checkout | `['reservation', …]` |

- [ ] **Step 1: Forms**

- Add charge: `chargeCode`, `amountMinor`; opId per form instance; on `idempotency_key_reused` show refresh copy.
- Cash: `paymentId` (generate once per submit attempt via stable opId), `amountMinor`.
- Authorize: same shape; on `not_configured` show card-not-configured copy.
- **Holds rows:** for `status === 'authorized'`, show capture amount input (default `amountMinor - (capturedAmountMinor ?? 0)` or full `amountMinor` when captured null) + Capture button → `api.capturePayment`.
- Split: select live charge line + two child amounts; call `splitFolioLine`; on `forbidden` use `permissionForForbidden(body, 'post_folio_split')`.
- Checkout: confirm if `balanceMinor !== 0`; on success live → “Checked out”; on provisional → “Checkout queued — applies when the connection restores”; on folio fail_closed show required outage copy on the control.

- [ ] **Step 2: Authorize invalidation test (RED → GREEN)**

```tsx
it('authorize invalidates payments query and not folio', async () => {
  // track fetch URLs
  // successful authorize
  // expect GET payments refetch; expect no GET folio refetch triggered by that mutation
});
```

- [ ] **Step 3: Provisional checkout chrome test**

```tsx
it('provisional checkout does not claim checked out', async () => {
  // checkout returns 202 provisional; reservation status still checked_in
  // assert queued messaging visible; assert not “Checked out” as status
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): folio mutations with holds capture and checkout chrome

EOF
)"
```

---

### Task 10: Acceptance sweep

**Files:** none new unless gaps found

- [ ] **Step 1: Run packages**

```bash
cd packages/client-core && npm test
cd apps/web-pms && npm test
cd apps/pms-core && npx vitest run test/tax-posting.spec.ts test/folio-routes.spec.ts
```

- [ ] **Step 2: Checklist vs spec §7**

Walk every checkbox in the design doc acceptance section; fix any miss (especially: all three board modes link; “other queued commands”; guest batch-of-one on direct entry).

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "$(cat <<'EOF'
test(web-pms): close folio front-desk acceptance gaps

EOF
)"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| `taxOf`/`taxRuleId` on readFolio | 1 |
| Fold + invariant + recursion + order + orphan | 5 |
| Policy C pure function | 6 |
| SPA charge no-request | 8 |
| Classify 403/501/409-idem; shouldRetry | 2 |
| Permission audit fallback | 3 |
| Queued context + other group | 4, 8–9 |
| Holds actionable + capture amount | 9 |
| Authorize → payments only invalidation | 9 |
| get_reservation `reservations:read` | 7 (path/permission via existing route) |
| Checkout provisional vs done; outage copy | 9 |
| Board links ×3 | 8 |
| Balance = server `balanceMinor` | 8 |
| Leftovers recorded / auth-holds UI retired | already in committed specs |

## Placeholder scan

No TBD steps; paths and class names pinned; invalidation matrix explicit in Task 9.
