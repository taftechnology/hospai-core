# Payments Vertical — Ledger Half (Simulate PSP)

**Date:** 2026-08-06  
**Status:** Approved  
**Sources:** ARCHITECTURE.md §4.6 (degraded mode), §7.3 (payments↔folio event contract; auth is not money), §13 (PCI isolation deferred); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [folio charges vertical](./2026-08-05-folio-charges-vertical-design.md); [rooms housekeeping §2.4 option B](./2026-08-05-rooms-housekeeping-vertical-design.md); [multi-currency money](./2026-07-28-multi-currency-money-design.md); `isJurisdictionSimulate` / `assertEnvSafeForRequest` in [env.ts](../../../apps/pms-core/src/env.ts); `runIdempotent` MUST NOT await in [idempotency.ts](../../../packages/do-runtime/src/idempotency.ts)

---

## 1. Context & Motivation

The core operating loop can book a guest, house them, assign a room, post charges, split them, and roll the business date. It cannot take a payment, so it cannot complete a stay with a settled ledger. Everything else outstanding is adjacent; this blocks lifecycle completion.

**Split the work.** Build the payment ledger and authorize→capture state machine against a simulated PSP, verifiable with the mutate-and-run loop. Real PSP / PCI Worker integration is a later slice: its interesting failures sit at a boundary this loop cannot probe. Precedent is already in tree — `isJurisdictionSimulate` requires `HOSPAI_UNSAFE_LOCAL === '1'` plus a mode flag, and `assertEnvSafeForRequest` hard-refuses simulate outside unsafe-local.

### Scope in

1. `payment` table and authorize→capture state machine (`pending` → terminal / ambiguous).
2. Negative `folio_line` on capture (`source = 'PAYMENT'`, `charge_code = 'PAYMENT'`, FK `payment_id`); `readFolio.balanceMinor` remains plain `SUM(ledger_amount_minor)` — made true by construction via reverse+children splits (§2.6).
3. Async simulate PSP adapter, env gate, `setPspSimulateOutcomeForTest` (including mid-seam `failAfterAdapter`).
4. Three HTTP routes + catalog entitlement pairing; `folio.split_charge_payment`; rewrite of `trySplitFolioLine` to reverse+children.
5. `readPayment(paymentId)` production read RPC (holds / statuses observable; required by tests 5/7/11/20).
6. Contracts constants: `PSP_UNAVAILABLE`, `PAYMENT_NOT_CAPTURABLE`, `LINE_NOT_SPLITTABLE`.

### Scope out

Real PSP, tokenization / PCI Worker, settlement reconciliation, refunds / voids, cashier shifts, folio window close, authorization expiry, SPA balance-due / hold visibility, reconciliation exit from `unknown`.

---

## 2. Design Decisions

### 2.1 Storage: both — `payment` owns lifecycle; `folio_line` on capture only

An authorization is not a ledger entry (§7.3). A payment record with status exists regardless. Captured money is a negative folio line so balance stays a pure ledger sum.

**Resolution: both.**

- `payment` owns the lifecycle and gateway reference.
- Authorize writes/updates the payment row only — **no** folio line.
- Capture writes a negative `folio_line` (`source = 'PAYMENT'`, `charge_code = 'PAYMENT'`, `payment_id` set) in the same DO transaction as the status flip to `captured`.
- `readFolio.balanceMinor` stays `SUM(ledger_amount_minor)` over all lines — **true only after** the split rewrite in §2.6 (today's keep-source+children path double-counts; proven).

The money package needs no positivity guard: `postToLedger`'s same-currency branch passes `amountMinor` through; the cross-currency branch uses signed-correct `roundHalfAwayFromZero`. Negative capture lines flow through `assertPostedMatches` and the Phase 1 money rule with zero special-casing.

**Take the FK.** v13 adds nullable `folio_line.payment_id` with `FOREIGN KEY (payment_id) REFERENCES payment(payment_id)`. Existing rows get `NULL`; SQLite permits NULL under an FK. Unlike `rate_day.rate_plan_id`, no orphan field data exists — declining the constraint by habit would add a fifth unenforced reference.

**Partial unique index** `folio_line_payment_uidx ON folio_line(payment_id) WHERE payment_id IS NOT NULL` — only the capture line carries `payment_id`; reverse/split children leave it `NULL` (§2.6). Structural backstop against a second capture line.

### 2.2 Checkout does not require a settled balance

Same collision class as rooms §2.4.

**Premises:**

1. `tryCheckOut` is a pure status flip — zero folio references ([property-do.ts](../../../apps/pms-core/src/property-do.ts)).
2. `reservations.check_out` is `QUEUE_PROVISIONAL` and registered in `REPLAY_DISPATCH`.
3. All three payment commands are `FAIL_CLOSED`.
4. `folio.add_item` is also `QUEUE_PROVISIONAL` and in `REPLAY_DISPATCH` — under degrade, charges queue while payments do not, with no ordering vs checkout. A zero-balance gate can pass on an incomplete folio.
5. `tryAddFolioLine` gates reservation existence, not status — charges may post after `checked_out`.

**Rejected: require zero balance on `tryCheckOut` (option A).** Not merely expensive: incoherent without freezing the folio at checkout, which breaks late charges / direct bill / night-audit residuals. Departure with a live balance is routine hotel practice (city ledger, group masters, late charges), not an exceptional path — zero-at-checkout is a front-desk procedure, not a DO invariant. Recording A as "correct but deferred" would invite a later hard gate that breaks direct bill. Later tightening is a **SPA warning + permission-gated override**, not a hard DO gate.

**Resolution: option B.** `tryCheckOut` is untouched. Payments and checkout compose independently.

### 2.3 Folio window closure — leave unused; say the wire lie

`closed_at` and `status` are not in the same state:

- `closed_at INTEGER` — **zero references** outside DDL. Genuinely inert.
- `status` — **emitted** on every `readFolio` as `window.status`, permanently `'OPEN'`. Not unused; constantly observed as a constant.

**Resolution:** this slice does not populate `closed_at`, does not transition `status` off `OPEN`, and does not gate postings/payments on window status. `ensureGuestFolioWindowSync` keeps writing `'OPEN'`.

**Wire rule:** `readFolio.window.status` is on the wire and is invariably `OPEN` this slice; clients must not treat it as a meaningful discriminator yet. A `status === 'OPEN'` guard in the SPA is permanently-true dead code that silently becomes live the day `folio.close` lands — worse than a missing field.

`folio_window.status` has no `CHECK` (unlike `room.status`). **Do not add it now** (SQLite needs a rebuild for `ADD CONSTRAINT`). **Named leftover condition:** the migration that first writes `closed_at` / a second status value must also carry `CHECK (status IN ('OPEN','CLOSED'))`.

The existing `FOREIGN KEY (folio_window_id)` enforces window *existence* only — ARCHITECTURE's "closed window rejects postings" is application logic in `insertFolioLineSync` later, not a constraint. The FK's presence must not be mistaken for that rule.

### 2.4 Simulate adapter — async, gated, fault-injectable

```ts
isPspSimulate(env) =
  env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_PSP_MODE === 'simulate'
```

Mirror `isJurisdictionSimulate`. `assertEnvSafeForRequest` hard-refuses `HOSPAI_PSP_MODE=simulate` without the local marker (same 500 shape). Without simulate mode, payment commands return `PSP_UNAVAILABLE`.

**Gate completeness note:** `assertEnvSafeForRequest` runs only at Worker fetch ([index.ts](../../../apps/pms-core/src/index.ts)). Queue consumers invoke DO stubs directly. That is fine *here* only because all three payment commands are `FAIL_CLOSED` and never queued. Flipping any to `QUEUE_PROVISIONAL` would silently route around the gate.

**Adapter is `async` even though simulate resolves immediately.** `runIdempotent` is `<T>(sql, idem, execute: () => T): T` — MUST NOT await. Every mutating command today is `transactionSync(() => runIdempotent(...))`. Payments are the first command whose decision comes from outside the DO; the adapter call cannot sit inside that transaction. Making the adapter `async` makes the wrong shape unwritable in TypeScript. Claim: structural guarantee only — a microtask is not an I/O gate release, so this does not exercise concurrent interleaving.

Default simulate behavior: always `approved`; `gatewayReference = sim_${paymentId}`; capture returns `capturedAmountMinor` (may be less than requested — the DO writes the response amount onto the negative line, never assumes equality with the request). A real PSP can capture less than requested; that is why the line amount comes from the adapter response. **Corollary:** because simulate always approves, the DO is the only over-capture guard — validate request and response amounts against `payment.amount_minor` (§2.5).

```ts
setPspSimulateOutcomeForTest({
  authorize?: 'approved' | 'declined' | 'timeout',
  capture?: 'approved' | 'declined' | 'timeout',
  captureAmountMinor?: number,  // when set, approved capture returns this (partial)
  failAfterAdapter?: boolean,   // after adapter returns, before txn 2 — leaves pending (§6 test 20)
})
```

`assertUnsafeLocal` on the helper, same class as `setTransportBlockedForTest`. Mid-method failure injection precedent: `postRoomChargesFailureAfterCountForTest` ([property-do.ts](../../../apps/pms-core/src/property-do.ts)) — `failAfterAdapter` fits that pattern rather than inventing a new one.

### 2.5 State machine — seam forces `pending`; not `runIdempotent`

Payments cannot use the universal `runIdempotent` primitive across the seam. Wrapping txn 1 caches a `pending` response and strands retries; wrapping only txn 2 leaves txn 1 unprotected and double-authorizes at the PSP. **Row-level state-machine idempotency** instead.

| State | Meaning |
|---|---|
| `pending` | Row inserted **before** the adapter call; crash in the seam leaves a reconcilable row |
| `authorized` | Hold recorded; no folio line |
| `declined` | Terminal decline |
| `captured` | Negative folio line written; `payment_id` FK set |
| `unknown` | Adapter `timeout` — ambiguous; **must not** collapse into `declined` (retry would double-authorize) |

**Authorize fingerprint:** `request_fingerprint TEXT NOT NULL` on `payment`. On `UNIQUE(idempotency_key)` violation → compare fingerprint → mismatch returns `IDEM_KEY_REUSED`; match returns current row state (no adapter recall).

**Capture fingerprint:** `capture_fingerprint TEXT` set when status flips to `captured`. Replay with a different amount after success → `IDEM_KEY_REUSED` (partial-capture feature must not collide with "already captured → return ok"). No separate `capture_idempotency_key` UNIQUE column — one capture per payment this slice; `payment_id` scopes it. Races: conditional `UPDATE … WHERE status = 'authorized'` is the mutex.

**Capture reject edges (before adapter):**

| Current status | Capture |
|---|---|
| `authorized` | allowed (then amount checks below) |
| `pending` | `PAYMENT_NOT_CAPTURABLE` |
| `declined` | `PAYMENT_NOT_CAPTURABLE` |
| `unknown` | `PAYMENT_NOT_CAPTURABLE` |
| `captured` | same fingerprint → idempotent success; different fingerprint → `IDEM_KEY_REUSED` |

**Capture amount bounds** (simulate always approves — DO is the only guard):

1. **Request:** if `input.amountMinor > payment.amount_minor` → `PAYMENT_NOT_CAPTURABLE`, before the adapter.
2. **Response:** if adapter returns `capturedAmountMinor > payment.amount_minor` → do not write the line; leave status `authorized` and return `PAYMENT_NOT_CAPTURABLE` (the `captureAmountMinor` lever can produce exactly this).

**Named leftover:** `unknown` has no exit this slice. Reconciliation is scope-out; the lever makes the state reachable in tests.

### 2.6 Split rewrite — reverse + children (lands `split_charge_v2` write shape)

Today `trySplitFolioLine` inserts children, keeps the source, and never reverses. `readFolio` sums every line → balance double-counts (proven: 3000 → 6000 after a 1000+2000 split). Test 6 asserts row count, never `balanceMinor`. Shipping payment splits on the same mechanics would double-credit money-out.

**Resolution: reverse + N children** for both `trySplitFolioLine` and `trySplitChargePayment` (shared sync helper). Plain `SUM(ledger_amount_minor)` is then correct by construction — no tribal read filter.

Rules:

1. Foot check: `sum(splits.amountMinor) === source.amount_minor` (signed — payment lines are negative).
2. **Reversing line:** `amount = -source.amount_minor`, `charge_code = source.charge_code` (not a generic `'REVERSAL'` — per-code sums must foot the same way the total does), `source = 'SPLIT_REVERSAL'` (**never** inherit the source row's `source` — inheriting `'NIGHT_AUDIT'` collides with `folio_line_audit_uniq`), `split_of = source.folio_line_id`, `payment_id = NULL`.
3. **Children:** amounts from request; same `charge_code` / money fields as source; `split_of = source.folio_line_id`; **inherit `source`, except `'NIGHT_AUDIT'` → `NULL`** (asymmetric rule — payment children keep `source = 'PAYMENT'` so they remain on the payment-split path); `payment_id = NULL` always.
4. Source row untouched.

**Rejects (both directions + reversal):**

- `trySplitFolioLine`: reject if `source = 'PAYMENT'`.
- `trySplitChargePayment`: reject if `source ≠ 'PAYMENT'`.
- Either: reject if `source = 'SPLIT_REVERSAL'` → `LINE_NOT_SPLITTABLE`. Splitting a child is allowed; splitting a reversal is not.

Narrow `PLATFORM_GAPS` entry `folio.split_charge_v2` reason to whatever remains (cross-window split+transfer / routing) — reverse+posts land in this slice. Rewrite Test 6: source kept, reverse + children present, `balanceMinor` unchanged.

---

## 3. Schema & RPC shapes

### 3.1 Migration v13

Order: create `payment` first, then `ALTER` folio_line (nullable FK column — no rebuild; rebuilds in this file were for constraint changes).

```sql
CREATE TABLE payment (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),              -- positive request magnitude; free on fresh table
  currency               TEXT NOT NULL,      -- Phase 1: ledger currency
  status                 TEXT NOT NULL
    CHECK (status IN ('pending','authorized','declined','captured','unknown')),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key);
CREATE INDEX payment_reservation_idx ON payment(reservation_id);

ALTER TABLE folio_line ADD COLUMN payment_id TEXT REFERENCES payment(payment_id);

CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL;
```

`insertFolioLineSync` gains optional `paymentId?: string` (default null). Only the capture line passes it.

### 3.2 Authorize / capture RPCs

```ts
async tryAuthorizePayment(
  actor: ActorContext,
  input: {
    paymentId: string;
    reservationId: string;
    amountMinor: number;        // > 0
    idempotencyKey: string;
    requestFingerprint: string; // fingerprintPayload({ paymentId, reservationId, amountMinor })
  },
): Promise<
  | { ok: true; paymentId: string; status: PaymentStatus; gatewayReference: string | null }
  | { ok: false; error: typeof NOT_FOUND | typeof PSP_UNAVAILABLE | typeof IDEM_KEY_REUSED | typeof MONEY_INVALID | … }
>

async tryCapturePayment(
  actor: ActorContext,
  input: {
    paymentId: string;
    amountMinor: number;         // > 0 requested
    idempotencyKey: string;      // wire key; fingerprint compared via capture_fingerprint
    captureFingerprint: string;  // fingerprintPayload({ paymentId, amountMinor })
  },
): Promise<…>
```

**Authorize flow:**

1. Gate permission / entitlement / `isPspSimulate` (else `PSP_UNAVAILABLE`).
2. **Txn 1:** `ensureGuestFolioWindowSync`; `INSERT payment (…, status='pending', request_fingerprint, idempotency_key)`. On UNIQUE violation → compare `request_fingerprint` → mismatch `IDEM_KEY_REUSED`; match → return current state (no adapter).
3. **Adapter (async):** `await psp.authorize(…)`. If `failAfterAdapter` → throw / return error **without** txn 2 (test 20).
4. **Txn 2:** `UPDATE payment SET status=?, gateway_reference=?, updated_at=? WHERE payment_id=? AND status='pending'`. 0 rows → re-read and return. Outcomes: `approved`→`authorized` + `folio.payment_authorized`; `declined`→`declined`; `timeout`→`unknown`.

**Capture flow:**

1. Gates as above; load payment; apply status reject edges (§2.5).
2. If already `captured` with matching `capture_fingerprint` → idempotent success; mismatch → `IDEM_KEY_REUSED`.
3. If `input.amountMinor > payment.amount_minor` → `PAYMENT_NOT_CAPTURABLE` (before adapter).
4. **Adapter (async)** outside any transaction.
5. If `capturedAmountMinor > payment.amount_minor` → do not write; leave `authorized`; return `PAYMENT_NOT_CAPTURABLE`.
6. **Txn:** conditional `UPDATE … WHERE status='authorized'` set `captured`, `captured_amount_minor`, `capture_fingerprint`, `gateway_reference` as needed; insert negative folio line (`charge_code='PAYMENT'`, `source='PAYMENT'`, `payment_id=paymentId`, `amountMinor = -capturedAmountMinor` from adapter response); outbox `folio.payment_captured` **and** `folio.line_posted`.

Neither method uses `runIdempotent`.

```ts
async readPayment(paymentId: string): Promise<
  | {
      ok: true;
      payment: {
        paymentId: string;
        reservationId: string;
        amountMinor: number;
        currency: string;
        status: PaymentStatus;
        gatewayReference: string | null;
        capturedAmountMinor: number | null;
        createdAt: number;
        updatedAt: number;
      };
    }
  | { ok: false; error: typeof NOT_FOUND }
>

async listPaymentsForReservation(reservationId: string): Promise<
  | { ok: true; payments: Array<…> }  // same payment shape as readPayment
  | { ok: false; error: typeof NOT_FOUND }  // reservation missing
>
```

Production read RPCs — not `ForTest` helpers. Test 20 observes `pending` via `readPayment` after authorize fails post-adapter; tests 5/7/11 assert persisted status and row counts via these reads. SPA needs the same surface to show holds the folio balance ignores (§5).

### 3.3 Split RPCs

`trySplitFolioLine` rewritten per §2.6 (still `runIdempotent` — fully sync, no adapter).

```ts
async trySplitChargePayment(
  actor: ActorContext,
  input: {
    sourceFolioLineId: string;
    splits: Array<{ folioLineId: string; amountMinor: number }>;
  },
  idem: IdempotencyKey,
): Promise<…>
```

Same foot/allocate + reverse+children helper; source-kind rejects as §2.6.

### 3.4 Contracts / catalog

```ts
PSP_UNAVAILABLE = 'psp_unavailable'
PAYMENT_NOT_CAPTURABLE = 'payment_not_capturable'
LINE_NOT_SPLITTABLE = 'line_not_splittable'
```

Already-captured replay: matching `capture_fingerprint` → idempotent success; mismatch → `IDEM_KEY_REUSED`. No separate `payment_already_captured` constant.

Catalog edits:

- `folio.authorize` / `folio.capture` / `folio.split_charge_payment`: add `entitlement: 'pms.core'`; remove matching `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` rows.
- `folio.capture` `events`: `['folio.payment_captured', 'folio.line_posted']` (both already handled in [event-consumer.ts](../../../apps/pms-core/src/event-consumer.ts); declare both so the catalog is truthful).

`PLATFORM_GAPS.folio.split_charge_v2` reason narrowed to cross-window / transfer remainder.

### 3.5 `readFolio` line shape

Add `paymentId: string | null` on each returned line (column already on the row after v13). Holds remain invisible — only captured payment linkage is observable over HTTP this slice.

---

## 4. Routes & HTTP

Append to **both** `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` starting at index **45** in the same order (`check:permissions` compares element-wise by index; `register.test.ts` pins `[43]=patch_property_details`, `[44]=put_domain_config`).

```ts
{ id: 'post_folio_authorize', scope: 'property', permission: 'folio:adjust', commandId: 'folio.authorize' },
{ id: 'post_folio_capture', scope: 'property', permission: 'folio:adjust', commandId: 'folio.capture' },
{ id: 'post_folio_split_payment', scope: 'property', permission: 'folio:adjust', commandId: 'folio.split_charge_payment' },
{ id: 'get_folio_payment', scope: 'property', permission: 'folio:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
{ id: 'get_folio_payments', scope: 'property', permission: 'folio:read', entitlement: 'pms.core', degradedRead: 'FAIL_CLOSED' },
```

Mutating routes stay at indices **45–47**; read routes append at **48–49** (`get_folio_payment`, `get_folio_payments`). Same dual-list rule — `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT` in lockstep.

| Route | Pattern | Body |
|---|---|---|
| `post_folio_authorize` | `POST /v1/properties/:pid/reservations/:rid/folio/payments/authorize` | `{ paymentId, amountMinor, idempotencyKey }` |
| `post_folio_capture` | `POST /v1/properties/:pid/folio/payments/:paymentId/capture` | `{ amountMinor, idempotencyKey }` |
| `post_folio_split_payment` | `POST /v1/properties/:pid/folio/lines/:lineId/split-payment` | `{ splits: [{ folioLineId, amountMinor }], idempotencyKey }` |
| `get_folio_payment` | `GET /v1/properties/:pid/folio/payments/:paymentId` | — → `readPayment` |
| `get_folio_payments` | `GET /v1/properties/:pid/reservations/:rid/folio/payments` | — → `listPaymentsForReservation` |

All `FAIL_CLOSED` via `commandId` — transport failure → degraded `503`, never queue. No `REPLAY_DISPATCH` entries.

Fingerprints via existing `fingerprintPayload`:

- Authorize: `{ paymentId, reservationId, amountMinor }`
- Capture: `{ paymentId, amountMinor }`
- Split-payment: `{ sourceFolioLineId, splits }` (same shape as charge split)

**Error map:**

| Code | HTTP |
|---|---|
| `PSP_UNAVAILABLE` | **501** Not Implemented (not 503 — simulate-off is permanent until the PCI slice; 503 is already transport/`FAIL_CLOSED` degrade and would make clients retry forever) |
| `PAYMENT_NOT_CAPTURABLE` / `LINE_NOT_SPLITTABLE` / `SPLIT_AMOUNT_MISMATCH` | 422 |
| `IDEM_KEY_REUSED` | existing mapping |
| Kill-switch / entitlement | 503 / 402 (unchanged) |

Env: `HOSPAI_PSP_MODE` on `PmsEnv`; `isPspSimulate`; `assertEnvSafeForRequest` branch; vitest bindings + `.dev.vars.example` set `simulate`.

---

## 5. Leftovers (named)

| Item | Note |
|---|---|
| Auth holds invisible on `readFolio` | Balance ignores `authorized`; SPA must not assume folio read is the whole money story |
| Departed-with-balance | Checkout ≠ settled; no operator view surfaces open balances after `checked_out` |
| Auth expiry | `authorized` never ages out; no hold-lapse process |
| `unknown` has no exit | Reachable via simulate timeout; no reconciliation transition this slice |
| `folio_window.closed_at` inert; `status` wire-constant `OPEN` | Clients must not branch on it; migration that first writes a second status **must** add the CHECK |
| Closed-window rejects postings | App logic in `insertFolioLineSync` later — existence FK does not enforce open/closed |
| Real PSP / PCI Worker / settlement / refunds / voids / cashier | Deferred |
| `PLATFORM_GAPS.folio.split_charge_v2` | Narrowed to cross-window split+transfer remainder |

---

## 6. Test matrix

`apps/pms-core/test/folio-payments.spec.ts`, plus Test 6 rewrite in `folio-routes.spec.ts`, plus a constraint probe helper analogous to `seedOrphanRateDayForTest`.

| # | Case | Expect |
|---|---|---|
| 1 | Authorize happy (simulate on) | `authorized`, no folio line, balance unchanged, `folio.payment_authorized` |
| 2 | Capture full | `captured`, one negative `PAYMENT` line with `payment_id`, balance nets, both events |
| 3 | Capture partial via `captureAmountMinor` lever | Line amount = adapter response, not request |
| 4 | Decline via lever | `declined`, no line, **no** `folio.payment_authorized` outbox event |
| 5 | Timeout via lever | `readPayment` → `unknown`, no line; subsequent capture → `payment_not_capturable` |
| 6 | Simulate off / no `HOSPAI_PSP_MODE` | `psp_unavailable` → **501** |
| 7 | Authorize idempotent replay (same fingerprint) | Same payment state; `listPaymentsForReservation` length 1 |
| 8 | Authorize key reuse, different amount/reservation | `idempotency_key_reused` |
| 9 | Capture replay different amount after success | `idempotency_key_reused` |
| 10 | Capture on `pending` / `declined` / `unknown` | `payment_not_capturable` |
| 11 | Second capture after success (same fingerprint) | Idempotent ok; one folio line (`readFolio`); still one payment row |
| 12 | Charge split reverse+children (Test 6 rewrite) | balance unchanged; reverse `SPLIT_REVERSAL`; source kept |
| 13 | Split night-audit room line | reverse `source = 'SPLIT_REVERSAL'` (not `NIGHT_AUDIT`); no unique violation |
| 14 | Split payment line via charge-split route | reject |
| 15 | Split charge via payment-split route | reject |
| 16 | Split a `SPLIT_REVERSAL` line | `line_not_splittable` |
| 17 | Payment-split children keep `source='PAYMENT'` | further payment-split allowed; charge-split still rejects |
| 18 | Kill-switch / unentitled on the three mutate routes | `503` / `402` (distinct from test 6's 501) |
| 19 | `assertEnvSafeForRequest` simulate without unsafe-local | `500` misconfigured |
| 20 | `failAfterAdapter: true` after approve | Authorize call errors; `readPayment` → `pending`, `gatewayReference === null`; no folio line — **proves the two-transaction seam** |
| 21 | Insert two folio lines with the same `payment_id` via test helper | `folio_line_payment_uidx` violation (structural backstop; bypasses application mutex) |
| 22 | `authorize(10000)` then `capture(999999)` | `payment_not_capturable` before adapter; payment stays `authorized`; no line |

---

## 7. Implementation sketch

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` + generated `0013_*.sql` | v13 payment + ALTER folio_line + indexes |
| `packages/contracts/src/idempotency.ts` | New error constants |
| `packages/contracts/src/commands/catalog.ts` | Entitlements; `folio.capture` events; PLATFORM_GAPS reason |
| `packages/contracts/src/entitlements.ts` | Remove three opt-out rows |
| `packages/contracts/src/v1-http-routes.ts` | Audit rows 45–49 |
| `packages/contracts/src/register.test.ts` | Pins / entitlement / events assertions as needed |
| `apps/pms-core/src/env.ts` | `HOSPAI_PSP_MODE`, `isPspSimulate`, assert branch |
| `apps/pms-core/src/psp-simulate.ts` (new) | Async adapter + outcome types |
| `apps/pms-core/src/property-do.ts` | `tryAuthorizePayment` / `tryCapturePayment` / `readPayment` / `listPaymentsForReservation` / split rewrite / `trySplitChargePayment` / `setPspSimulateOutcomeForTest` / constraint-seed helper / `readFolio` `paymentId` |
| `apps/pms-core/src/v1-dispatch.ts` | Five handlers at `V1_ROUTES` 45–49; error map 501 |
| `apps/pms-core/vitest.config.ts` + `.dev.vars.example` | `HOSPAI_PSP_MODE=simulate` |
| Tests | `folio-payments.spec.ts`; folio-routes Test 6; checks green |

No `pending-commands-consumer` / `REPLAY_DISPATCH` changes.

### Acceptance

1. Authorize → capture zeros (or reduces) folio balance via a negative `PAYMENT` line; auth alone does not.
2. Simulate-off → 501; kill-switch → 503; distinguishable.
3. Test 20 fails if authorize is implemented as adapter-first single insert to `authorized` (assert via `readPayment`).
4. Test 21 fails if the partial unique index is missing.
5. Test 22 fails if over-capture request is not rejected before the adapter.
6. Split of a charge leaves `balanceMinor` unchanged; night-audit room charges remain splittable.
7. `check:entitlements` / `check:permissions` / `check:degraded` green; catalog events match emissions.

### Open questions

None. Settled in design: storage C; checkout B; window closure C with wire-lie; simulate B + async seam; reverse+children splits; fingerprints not a second capture key; 501 for `PSP_UNAVAILABLE`; test 20 for `pending` via `readPayment`; capture amount bounds; free CHECKs on fresh `payment` table.
