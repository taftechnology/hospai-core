# Unknown payment reconciliation — operator-asserted exit

**Tree verified 2026-08-15 (post `rooms.delete` `f17f9f6`):** `COMMAND_CATALOG` length **80** (`register.test.ts` ~671), `AUDIT_WRITER_COMMAND_IDS.size === 55` (`register.test.ts` ~268 and ~670), `V1_HTTP_ROUTE_AUDIT[132].id === 'delete_room'` (`register.test.ts` ~662–668; `v1-http-routes.ts` ~778–784), `[131] post_folio_routing_rule_archive` (`register.test.ts` ~655–661; `v1-http-routes.ts` ~772–777), `[128] post_folio_stay_discount` (`register.test.ts` ~633–638), `[127] post_demo_seed` (`register.test.ts` ~619–624), `PROPERTY_SCHEMA_HEAD === 29` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~626–627), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1064–1073), `PLATFORM_GAPS === []` (`register.test.ts` ~672), catalog last entry `rooms.delete` ~884–896, `payment.status` CHECK includes `unknown` (v21 rebuild ~842 in `property-migrations.ts`; tail v29 ~1170–1174), `tryAuthorizePayment` timeout/`unknown` ~14723–14979, `applyPaymentEventSync` `payment.failed` → `unknown` ~14249–14266, authorize decline emits `payment.failed` ~14917–14942 (timeout same event ~14943–14968), `PAYMENT_NOT_CAPTURABLE` (`idempotency.ts` ~81; `tryCapturePayment` ~15054–15055), `handlePostFolioVoid` sibling (~5141–5176; `post_folio_void` ~558–563 in `v1-http-routes.ts`), `FolioScreen` tender filter authorized/captured only ~787–789, `folio-payments.spec.ts` Test 5 ~330–354.

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §4.6 (payments FAIL_CLOSED; never queue authorize/capture during outage), §7.3 (authorize = no folio line; capture = negative PAYMENT line); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) (§2.5 double-authorize hazard; `unknown` semantics; timeout lever); [folio money operations](./2026-08-12-folio-money-operations-design.md) (payment state machine §6; `unknown` leftover); [cashiering](./2026-08-07-cashiering-design.md) (`folio:post` = bring money in); `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `apps/pms-core/src/v1-dispatch.ts`; `packages/client-core/src/api.ts`; `apps/web-pms/src/screens/FolioScreen.tsx`; `apps/pms-core/test/folio-payments.spec.ts`; `apps/web-pms/src/screens/FolioScreen.test.tsx`.

**Closes:** [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) leftover **`unknown` has no exit** (~137, §5 table ~363). [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **3** (~796). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

**Amends:** [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) §2.5 named leftover (~137) and §5 row (~363) (closed). [folio money operations](./2026-08-12-folio-money-operations-design.md) §6.6 / §19 leftover **3** (~796) (closed). Bidirectional pointer sentences in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Simulate authorize can leave a card payment in **`unknown`** when the adapter times out — ambiguous whether a PSP hold exists. Retrying authorize would double-authorize (payments spec §2.5). Today there is **no operator exit**: capture returns `payment_not_capturable`, void/refund also refuse, and the Folio SPA hides `unknown` rows from the tender list (~787–789).

This chunk adds **`folio.reconcile_payment`**: a desk operator, after checking the PSP, asserts the real-world outcome (`authorized` hold exists, or `declined` no hold). **No adapter call.** Capture remains a separate later `folio.capture`.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| `unknown` semantics | Adapter timeout → `payment.failed` event → `applyPaymentEventSync` sets `status='unknown'` when `stage='authorize'` and `reason≠'declined'` (~14249–14266) |
| Authorize approved path | `tryAuthorizePayment` txn2 ~14838–14916: `folio.payment_authorized` + `payment.authorized` outbox; **no** folio line; audit `folio.authorize` |
| Authorize decline path | ~14917–14942: `payment.failed` outbox only; **no** `folio.payment_authorized`; status `declined` via `applyPaymentEventSync` |
| Authorize timeout path | ~14943–14968: `payment.failed` with `reason:'timeout'`; status `unknown`; Test 5 ~330–354 |
| Capture guard | `tryCapturePayment` ~15054–15055: `status !== 'authorized'` → `PAYMENT_NOT_CAPTURABLE`; `unknown` blocked |
| Wire codes | `PAYMENT_NOT_CAPTURABLE` ~81; family `payment_not_voidable` ~72 — **no** `payment_not_reconcilable` yet |
| HTTP payment mutation pattern | `handlePostFolioVoid` ~5141–5176: `invokePropertyDo`, fingerprint, `mapPaymentCommandErrorStatus` |
| Catalog payments cluster | `folio.authorize` ~275–285 (`events` union includes `payment.failed`); `folio.capture` ~287–297 |
| Audit writers | `folio.authorize` ~15 in `audit-writers.ts`; size pin **55** |
| Folio SPA tenders | `tenderPayments` filter ~787–789; Capture gated `policy.canPay` ~866; Void gated `canPost` ~877 |
| Client void | `voidPayment` ~898–907 (`/folio/payments/:id/void`) |
| Catalog / HTTP heads | Last catalog `rooms.delete` ~884–896; last route `[132] delete_room` ~778–784; `V1_ROUTES` tail ~7503–7511 |
| Schema head | **29** (`migrate.test.ts` ~626; `PROPERTY_MIGRATIONS` tail ~1170–1174) — `unknown` already in CHECK |
| Night audit | **8** steps; `[3] === 'AUTO_TRANSFER'` ~1067 — **unchanged** |

**Heads (frozen — this chunk moves these):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **80** | **81** (+ `folio.reconcile_payment` **appended at end** after `rooms.delete`) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **55** | **56** (+ `folio.reconcile_payment`; update pins ~268 and ~670) |
| `V1_HTTP_ROUTE_AUDIT` | `[132] = delete_room` | **APPEND `[133] post_folio_reconcile_payment`** — `[132]` / `[131]` / `[128]` / `[127]` **unmoved** |
| `PROPERTY_SCHEMA_HEAD` | **29** | **29** — no migration |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — unchanged |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.2 Scope in

1. Wire code **`payment_not_reconcilable`** (`PAYMENT_NOT_RECONCILABLE` in `idempotency.ts`).
2. Catalog **`folio.reconcile_payment`**, audit writer, HTTP **`POST /v1/properties/:propertyId/payments/:paymentId/reconcile`**, dispatch handler, client `reconcilePayment`.
3. **`tryReconcilePayment`** RPC (catalog id `folio.reconcile_payment`).
4. Outcomes **`authorized`** | **`declined`** only; **`unknown`** input status only (Lock 2).
5. Folio SPA: surface `unknown` payments with **Mark authorized** / **Mark declined** buttons.
6. Tests §2 Lock 6; register pin updates.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Authorization expiry / hold-lapse (queue item 6)
- `pending` seam auto-recovery (payments test 20 path)
- Real PSP inquire / webhook reconciliation
- `unknown` → `captured` shortcut (must go `authorized` then `folio.capture`)
- PCI / tokenization Worker
- City ledger / AR / invoices
- Rooms leftovers; derived rates; promo codes
- Growing `NIGHT_AUDIT_STEPS`
- Moving `[132]` / `[131]` / `[128]` / `[127]`
- Schema migration (`PROPERTY_SCHEMA_HEAD` stays **29**)
- New `export class` / `CLASS_DENYLIST` edit
- Demo seed rewrite
- Bidirectional leftover pointer sentences (final implementation task)
- Collapse split commands; retire `reservations.update_extras`

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Operator-asserted exit only; never re-call authorize

`unknown` means authorize adapter **timeout** (ambiguous). **Must not** collapse to `declined` by retrying authorize (double-authorize hazard — payments spec §2.5). This chunk does **not** call the PSP/simulate adapter. Desk operator asserts the real-world outcome after checking the PSP.

Outcomes **only**:

- **`authorized`** — PSP hold exists. In one txn:

  ```sql
  UPDATE payment
  SET status = 'authorized',
      gateway_reference = COALESCE(?, gateway_reference),
      balance_at_risk = 0,
      updated_at = ?
  WHERE payment_id = ? AND status = 'unknown'
  ```

  (`gateway_reference` bind = `input.gatewayReference` when provided.) Then outbox **`folio.payment_authorized`** + **`payment.authorized`** with the same payload shapes as successful authorize (~14872–14898). **No folio line** (same as authorize). Capture remains a later `folio.capture`. Audit `commandId: 'folio.reconcile_payment'`.

- **`declined`** — no hold.

  ```sql
  UPDATE payment
  SET status = 'declined',
      balance_at_risk = 0,
      updated_at = ?
  WHERE payment_id = ? AND status = 'unknown'
  ```

  **No** `folio.payment_authorized`. Emit **`payment.failed`** outbox matching authorize-decline shape (~14931–14942: `stage:'authorize'`, `reason:'declined'`). Do **not** call `applyPaymentEventSync` for decline here (timeout already applied `payment.failed` while `pending`; reconcile runs from `unknown`).

**No** `pspSimulateEnabled()` gate on reconcile (operator-asserted local transition — parallel `tryRecordCashPayment` “must never consult PSP” rule ~16149).

### Lock 2 — `unknown` only (not `pending`)

Refuse if current status ≠ `unknown` (except idempotent replay of the same fingerprint after success — Lock 4). `pending` seam recovery (payments test 20) is **out**. `authorized` hold-lapse / auth expiry is **queue item 6 — out**. Do not void/refund/capture from `unknown`.

New wire code **`payment_not_reconcilable`** (`PAYMENT_NOT_RECONCILABLE` in `idempotency.ts`) — family of `payment_not_capturable` / `payment_not_voidable`. HTTP **409** (add to `mapPaymentCommandErrorStatus` ~5377 — today `PAYMENT_NOT_CAPTURABLE` maps **422** ~5382; reconcilable refusal is **409** by lock).

### Lock 3 — Command / HTTP

| Field | Value |
|---|---|
| Command id | **`folio.reconcile_payment`** |
| `prototypeAction` | **`null`** |
| Lane | `INTERACTIVE` |
| `degraded` | `FAIL_CLOSED` |
| `idempotent` | `true` |
| `entitlement` | `'pms.core'` |
| `permission` | `'folio:post'` (same cashiering as authorize ~284) |
| `events` | **`['folio.payment_authorized', 'payment.authorized', 'payment.failed']`** (union — authorized outcome uses first two; declined uses `payment.failed` only) |

Append catalog entry **at end** of `COMMAND_CATALOG` (after `rooms.delete` ~896). Add **`folio.reconcile_payment`** to `AUDIT_WRITER_COMMAND_IDS` → size **56**. **No new event types** — existing allowlist in `event-consumer.ts` (~158–168) already covers these.

**HTTP:** `POST /v1/properties/:propertyId/payments/:paymentId/reconcile`

Body: `{ outcome: 'authorized' | 'declined', gatewayReference?: string, idempotencyKey: string }`

| Field | Value |
|---|---|
| Route audit id | **`post_folio_reconcile_payment`** |
| Index | **`[133]`** appended at **end** of `V1_HTTP_ROUTE_AUDIT` (after `[132]` ~778–784) |
| `scope` | `property` |
| `permission` | `folio:post` |
| `commandId` | `folio.reconcile_payment` |
| `entitlement` | `pms.core` |

**Dispatch:** append at **end** of `V1_ROUTES` (after `handleDeleteRoom` entry ~7503–7511). Handler mirrors **`handlePostFolioVoid`** (~5141–5176):

- Missing `idempotencyKey` → **400** `invalid_body`
- Fingerprint `{ paymentId, outcome, gatewayReference? }` (omit `gatewayReference` key when absent — match `fingerprintPayload` conventions)
- `invokePropertyDo` → `tryReconcilePayment`
- Map `NOT_FOUND` → **404**; `PAYMENT_NOT_RECONCILABLE` → **409** `{ ok: false, error: 'payment_not_reconcilable' }`; `IDEM_KEY_REUSED` → **409**; `FORBIDDEN` → **403** `folio:post`
- Success → **200** `{ ok: true, paymentId, status, gatewayReference }` (status `'authorized' | 'declined'`)

**Client:** `packages/client-core/src/api.ts` — `reconcilePayment(propertyId, paymentId, input, opId)`:

```typescript
async reconcilePayment(
  propertyId: string,
  paymentId: string,
  input: { outcome: 'authorized' | 'declined'; gatewayReference?: string },
  opId: string,
) {
  const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
  return getJson(
    `/v1/properties/${enc(propertyId)}/payments/${enc(paymentId)}/reconcile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, idempotencyKey }),
    },
  );
}
```

(Path is **`/payments/`** not **`/folio/payments/`** — intentional; void/refund stay on folio prefix.)

### Lock 4 — Idempotency / state machine

Row-level like payments (not wrapping the PSP seam — there is no adapter call):

- Same key + same fingerprint after success → return current row (via `invokePropertyDo` cache **and** row re-read)
- Same key different fingerprint → `IDEM_KEY_REUSED`
- Conditional `UPDATE … WHERE payment_id=? AND status='unknown'`
- 0 rows: re-read; if status already equals requested outcome → idempotent ok; else `PAYMENT_NOT_RECONCILABLE`

**No new payment columns** (schema stays v29). Idempotency fingerprint is **not** stored on the payment row (unlike `void_fingerprint`).

Validate `outcome` enum in handler; invalid → **400**.

When `outcome === 'authorized'` and payment is `CARD` tender, `gatewayReference` may be supplied by operator (PSP ref discovered offline). When omitted, leave existing `gateway_reference` (typically `NULL` after timeout).

### Lock 5 — SPA

`apps/web-pms/src/screens/FolioScreen.tsx`:

- Include **`unknown`** payments in the tenders section (today `tenderPayments` ~787–789 excludes them).
- For `status === 'unknown'`: render two buttons with labels exactly **Mark authorized** and **Mark declined**.
- Gate with **`policy.canPay`** (same as Capture ~866), not only `canPost`.
- Wire `reconcilePayment` mutation; success invalidates folio + payments queries.
- Optional `gatewayReference` prompt is **out** this chunk (body field exists for API; SPA may omit).

RTL in `FolioScreen.test.tsx`. `pnpm check:web-pms-colors` if tokens touched.

### Lock 6 — Tests (normative cases)

Extend **`apps/pms-core/test/folio-payments.spec.ts`** (timeout lever already produces `unknown` — Test 5 ~330):

| # | Case | Assert |
|---|---|---|
| 1 | `unknown` → `authorized` | status `authorized`; **no** folio line; `folio.payment_authorized` + `payment.authorized` in outbox; `balance_at_risk === 0`; capture then succeeds |
| 2 | `unknown` → `declined` | status `declined`; capture still `payment_not_capturable`; **no** `folio.payment_authorized`; `payment.failed` outbox present; `balance_at_risk === 0` |
| 3 | Capture while still `unknown` | `payment_not_capturable` (Test 5 stays green) |
| 4 | Reconcile non-`unknown` (e.g. `authorized`) | `payment_not_reconcilable` |
| 5 | Idempotent replay same key + fingerprint | **200**; one payment row; no duplicate outbox events |
| 6 | HTTP | **200** happy; **409** `payment_not_reconcilable`; **404** unknown id; **400** missing `idempotencyKey` |
| 7 | SPA | `unknown` row visible; both buttons render (`FolioScreen.test.tsx`) |

Existing Test 5 (~330) and Test 10 unknown branch (~457–461) stay green.

**Register pins** in `'night-audit HTTP routes append at 86–91'` (~457): append after `[132]` (~662–671):

```typescript
expect(V1_HTTP_ROUTE_AUDIT[133]?.id).toBe('post_folio_reconcile_payment');
expect(V1_HTTP_ROUTE_AUDIT[133]).toMatchObject({
  scope: 'property',
  permission: 'folio:post',
  commandId: 'folio.reconcile_payment',
  entitlement: 'pms.core',
});
expect(COMMAND_CATALOG).toHaveLength(81);
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(56);
```

Also update ~268 pin in `'every entitled command has an audit writer…'`.

**CI gates:** `pnpm check:permissions`, `check:entitlements`, `check:degraded`, `check:class-denylist`. Rebuild `@hospai/contracts` before pms-core tests; `@hospai/client-core` before web-pms tests.

---

## 3. Schema

**No migration.** `PROPERTY_SCHEMA_HEAD` stays **29**. `ORG_SCHEMA_HEAD` stays **7**. `unknown` is already legal in `payment.status` CHECK (v21 rebuild ~842).

---

## 4. Commands / HTTP detail

### 4.1 Catalog entry (`folio.reconcile_payment`)

Append after `rooms.delete`:

```typescript
{
  id: 'folio.reconcile_payment',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['folio.payment_authorized', 'payment.authorized', 'payment.failed'],
  entitlement: 'pms.core',
  permission: 'folio:post',
  notes:
    'Operator-asserted exit from authorize-timeout unknown. Never calls PSP. ' +
    'authorized → hold exists; declined → no hold. unknown-only input.',
},
```

### 4.2 Route audit `[133]`

```typescript
{
  id: 'post_folio_reconcile_payment',
  scope: 'property',
  permission: 'folio:post',
  commandId: 'folio.reconcile_payment',
  entitlement: 'pms.core',
},
```

### 4.3 `tryReconcilePayment` sketch

```typescript
async tryReconcilePayment(
  actor: ActorContext,
  input: { paymentId: string; outcome: 'authorized' | 'declined'; gatewayReference?: string },
  idem: { key: string; fingerprint: string },
): Promise<
  | { ok: true; paymentId: string; status: 'authorized' | 'declined'; gatewayReference: string | null }
  | { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_RECONCILABLE | typeof IDEM_KEY_REUSED | ... }
>
```

Gates: `gateCoreEntitlement`, `gatePermission(actor, 'folio:post')`. **No** `pspSimulateEnabled()`.

Txn: read payment; if missing → `NOT_FOUND`. If status matches `input.outcome` and idem replay → success. If status not `unknown` → `PAYMENT_NOT_RECONCILABLE`. Conditional UPDATE (Lock 1); 0 rows → re-read idempotent path (Lock 4). Emit outbox + audit per outcome (Lock 1).

---

## 5. File-level impact

| Area | Touch |
|---|---|
| `packages/contracts/src/idempotency.ts` | + `PAYMENT_NOT_RECONCILABLE` / export |
| `packages/contracts/src/commands/catalog.ts` | append `folio.reconcile_payment` |
| `packages/contracts/src/commands/audit-writers.ts` | + `folio.reconcile_payment` |
| `packages/contracts/src/v1-http-routes.ts` | append `[133]` |
| `packages/contracts/src/register.test.ts` | catalog **81**, writers **56**, `[133]` |
| `apps/pms-core/src/property-do.ts` | `tryReconcilePayment` |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostFolioReconcilePayment`; `mapPaymentCommandErrorStatus` +409; `V1_ROUTES` append |
| `packages/client-core/src/api.ts` | `reconcilePayment` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | unknown tender row + buttons |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | RTL |
| `apps/pms-core/test/folio-payments.spec.ts` | DO + HTTP cases Lock 6 |

**Not touched:** `property-migrations.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, demo seed, `CLASS_DENYLIST`, `event-consumer.ts` (existing event types suffice).

**Optional:** one sentence in ARCHITECTURE.md payment state note. Do not rewrite ledger formula.

---

## 6. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Use patterns from `folio-payments.spec.ts` (`provisionHotel`, `authorizePayment`, `capturePayment`, `setPspSimulateOutcomeForTest({ authorize: 'timeout' })`). Date math: `addDays` / property today helpers as existing file. **Do not** `vi.spyOn` into the DO isolate.

Cases enumerated in Lock 6. Register pin verification: catalog **81**, writers **56**, `[133]` last, `[132]`/`[131]`/`[128]`/`[127]` unmoved, `PROPERTY_SCHEMA_HEAD === 29`, `NIGHT_AUDIT_STEPS.length === 8`, `PLATFORM_GAPS === []`.

---

## 7. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Authorization expiry / hold-lapse** | Queue item 6 — `authorized` never ages out |
| 2 | **`pending` seam auto-recovery** | Test 20 path — explicit scope-out |
| 3 | **Real PSP inquire / webhook reconcile** | Operator-asserted only this chunk |
| 4 | **SPA gatewayReference capture** | API field optional; no modal this chunk |
| 5 | **Unify payment HTTP paths** | Reconcile on `/payments/`; void/refund on `/folio/payments/` |

---

## 8. Implementation checklist

- [x] Wire `PAYMENT_NOT_RECONCILABLE` + HTTP 409 mapping
- [x] Catalog `folio.reconcile_payment` appended; audit writer; register pins **81** / **56** / `[133]`
- [x] HTTP `[133]` + dispatch handler + client `reconcilePayment`
- [x] `tryReconcilePayment` with conditional UPDATE, outbox, audit (Lock 1–4)
- [x] Folio SPA unknown row + **Mark authorized** / **Mark declined** + RTL
- [x] DO + HTTP tests (Lock 6); Test 5 / Test 10 unchanged
- [x] `pnpm check:permissions`, `check:entitlements`, `check:degraded`, `check:class-denylist`
- [x] Bidirectional pointers: payments-ledger §5 row + folio-money §19 item **3** (final implementation task)

---

## 9. Tree conflicts with reviewer locks

**None on heads.** Verified post-`f17f9f6`: catalog **80**, writers **55**, `[132] delete_room` last, `PROPERTY_SCHEMA_HEAD` **29**, `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'`, `PLATFORM_GAPS === []`, `unknown` in payment CHECK.

**Implementer notes (not lock violations):**

1. **Timeout already emitted `payment.failed`** (~14943–14968) before reconcile — declined reconcile adds a **second** decline-shaped outbox event; authorized reconcile adds `payment.authorized` after prior failure event. Event history is intentionally messy; do not re-call `applyPaymentEventSync` for decline from `unknown`.
2. **`mapPaymentCommandErrorStatus`** (~5377): add `PAYMENT_NOT_RECONCILABLE` → **409** alongside `IDEM_KEY_REUSED`; do not reuse the **422** bucket used by `PAYMENT_NOT_CAPTURABLE`.
3. **Register pin test** (~457) asserts through `[132]` (~662–671) — append `[133]` in the same test.
4. **Held balance display:** after reconcile → `authorized`, `computeHeldMinor` (~44–46) should include the hold; verify Folio balance chip if tests cover it.
5. **HTTP path** differs from void/refund folio prefix — follow Lock 3 exactly.
