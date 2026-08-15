# Unknown payment reconciliation — operator-asserted exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)

**Goal:** Give desk operators an operator-asserted exit from authorize-timeout `unknown` card payments via `folio.reconcile_payment` / `POST /payments/:id/reconcile` (`authorized` | `declined` only), with Folio SPA buttons and register pins at frozen heads — **no PSP call**, **no schema migration**.

**Architecture:** `tryReconcilePayment` runs a local conditional `UPDATE … WHERE status='unknown'` inside `runIdempotent`, emitting the same outbox shapes as successful authorize (authorized path) or authorize-decline (declined path). HTTP handler mirrors `handlePostFolioVoid`; `PAYMENT_NOT_RECONCILABLE` maps **409** (capturable stays **422**). Folio SPA surfaces `unknown` in tenders with **Mark authorized** / **Mark declined** gated by `policy.canPay`.

**Tech Stack:** PropertyDO + sqlite, `@hospai/contracts`, vitest Worker specs (`provisionHotel`, `authorizePayment`, `setPspSimulateOutcomeForTest`), web-pms RTL.

**Spec:** `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` (Approved — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes payments-ledger leftover **`unknown` has no exit** and folio-money leftover **3**. Bidirectional pointer sentences land in **Task 4 only**.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **81** (`folio.reconcile_payment` appended after `rooms.delete`) | Re-calling authorize/PSP on reconcile |
| `AUDIT_WRITER_COMMAND_IDS.size` **56** | `unknown` → `captured` shortcut |
| HTTP `[133] post_folio_reconcile_payment` after `[132]` | `pending` seam auto-recovery (Test 20 path) |
| `PROPERTY_SCHEMA_HEAD` **29** unchanged | Authorization expiry / hold-lapse |
| `NIGHT_AUDIT_STEPS` length **8** | Schema migration; 9th night-audit step |
| Folio SPA unknown tender row + reconcile buttons | Moving `[132]` / `[131]` / `[128]` / `[127]` |
| — | Ticking Tasks 1–3 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **81** (`folio.reconcile_payment` appended after `rooms.delete` ~896). `AUDIT_WRITER_COMMAND_IDS.size` **56** (pins ~268 and ~670). HTTP `[133] post_folio_reconcile_payment` appended after `[132] delete_room`; `[132]`/`[131]`/`[128]`/`[127]` **unmoved**. `PROPERTY_SCHEMA_HEAD` **29**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — Operator-asserted semantics (spec Lock 1–2)

**Locked:** Never call PSP / `pspSimulateEnabled()` on reconcile. Input status **`unknown` only** (except idempotent replay). Outcomes **`authorized`** | **`declined`** only. Authorized path: conditional UPDATE with `balance_at_risk = 0`, `folio.payment_authorized` + `payment.authorized` outbox, **no folio line**. Declined path: conditional UPDATE with `balance_at_risk = 0`, `payment.failed` outbox only (do **not** call `applyPaymentEventSync`). Wire code **`payment_not_reconcilable`** → HTTP **409**.

### D3 — Command / HTTP (spec Lock 3)

**Locked:** Catalog id `folio.reconcile_payment`; `prototypeAction: null`; `FAIL_CLOSED`; `permission: 'folio:post'`; events `['folio.payment_authorized', 'payment.authorized', 'payment.failed']`. HTTP `POST /v1/properties/:propertyId/payments/:paymentId/reconcile` ( **`/payments/`** prefix, not `/folio/payments/`). Body `{ outcome, gatewayReference?, idempotencyKey }`. Fingerprint `{ paymentId, outcome, gatewayReference? }` (omit `gatewayReference` key when absent). Handler after `handleDeleteRoom` in `V1_ROUTES` tail. Client `reconcilePayment(propertyId, paymentId, input, opId)`.

### D4 — Idempotency (spec Lock 4)

**Locked:** `runIdempotent` + conditional `UPDATE … WHERE status='unknown'`. 0 rows → re-read; if status equals requested outcome → ok; else `PAYMENT_NOT_RECONCILABLE`. Same key different fingerprint → `IDEM_KEY_REUSED`. No new payment columns.

### D5 — SPA (spec Lock 5)

**Locked:** Include `unknown` in tenders. Labels exactly **Mark authorized** and **Mark declined**. Gate with **`policy.canPay`** (not only `canPost`). Invalidate folio + folio-payments on success. No gatewayReference modal.

### D6 — Test / CI discipline

**Locked:** DO cases Lock 6 **1–5** in Task 1; HTTP case **6** in Task 2; SPA case **7** in Task 3. Fixture ids via `crypto.randomUUID()`. **Do not** `vi.spyOn` into the DO isolate. Rebuild `@hospai/contracts` before pms-core tests after Task 1. Rebuild `@hospai/client-core` before web-pms tests after Task 3. File-filter vitest; `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard once. Never `|| true`. Never unsharded pms-core test. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D7 — Reviewer workflow

Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. Bidirectional pointers — **Task 4 only**.

---

## Global Constraints

- **`NIGHT_AUDIT_STEPS` length stays 8** — no 9th step; `[3] === 'AUTO_TRANSFER'`.
- **No schema migration** — `PROPERTY_SCHEMA_HEAD` stays **29**.
- **No PSP / adapter call on reconcile** — skip `pspSimulateEnabled()` (parallel `tryRecordCashPayment` rule).
- **Never re-call authorize** — double-authorize hazard (payments spec §2.5).
- **`unknown` → `authorized` then separate `folio.capture`** — no `unknown` → `captured` shortcut.
- **Catalog append at end** after `rooms.delete` (~896) — not in payments cluster.
- **HTTP `[133]` append at end** of `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` — do not move `[132]`/`[131]`/`[128]`/`[127]`.
- **`PAYMENT_NOT_RECONCILABLE` → HTTP 409** — do not bucket with capturable **422**.
- **Scope-out (forbidden all tasks):** pending recovery; auth expiry; real PSP inquire; unknown→captured; schema migration; moving `[132]`; 9th night-audit step; ticking Tasks 1–3 living boxes; push; demo seed rewrite; `CLASS_DENYLIST`; `event-consumer.ts` edits.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/idempotency.ts` | + `PAYMENT_NOT_RECONCILABLE` | 1 |
| `packages/contracts/src/commands/catalog.ts` | Append `folio.reconcile_payment` | 1 |
| `packages/contracts/src/commands/audit-writers.ts` | + `folio.reconcile_payment` | 1 |
| `packages/contracts/src/register.test.ts` | Catalog **81**; writers **56**; `[133]` (Task 2) | 1, 2 |
| `apps/pms-core/src/property-do.ts` | `tryReconcilePayment` | 1 |
| `apps/pms-core/test/folio-payments.spec.ts` | DO cases **1–5**; HTTP case **6** (Task 2) | 1, 2 |
| `packages/contracts/src/v1-http-routes.ts` | Append `[133]` | 2 |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostFolioReconcilePayment`; `mapPaymentCommandErrorStatus`; `V1_ROUTES` | 2 |
| `packages/client-core/src/api.ts` | `reconcilePayment` | 2 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Unknown tender row + buttons | 3 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | RTL case **7** | 3 |
| `docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md` | Close §5 row | 4 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | Close §6.6 + §19 item **3** | 4 |
| `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` | Tick §8 checklist | 4 |
| `docs/superpowers/plans/2026-08-15-unknown-payment-reconcile.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `property-migrations.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `event-consumer.ts`, demo seed.

---

## Spec §1.2 / §8 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) wire `PAYMENT_NOT_RECONCILABLE` | 1 |
| §1.2 (2) catalog + audit writer | 1 |
| §1.2 (3) `tryReconcilePayment` | 1 |
| §1.2 (4) HTTP + dispatch + client | 2 |
| §1.2 (5) Folio SPA | 3 |
| §1.2 (6) tests + pins | 1–4 |
| Lock 6 DO **1–5** | 1 |
| Lock 6 HTTP **6** | 2 |
| Lock 6 SPA **7** | 3 |
| §8 checklist + pointers | 4 |
| §1.3 scope out | forbidden all |

---

### Task 1: Wire code + catalog + DO `tryReconcilePayment` + folio-payments.spec cases 1–5

**Spec:** §2 Locks 1–4, §4.1, §4.3, Lock 6 cases **1–5**.

**Files:**
- Modify: `packages/contracts/src/idempotency.ts` — after `PAYMENT_NOT_CAPTURABLE` (~81)
- Modify: `packages/contracts/src/commands/catalog.ts` — append after `rooms.delete` (~884–896)
- Modify: `packages/contracts/src/commands/audit-writers.ts` — after `'folio.authorize',` (~15)
- Modify: `packages/contracts/src/register.test.ts` — ~268 and ~670 pins (catalog **81**, writers **56**; **no `[133]` yet**)
- Modify: `apps/pms-core/src/property-do.ts` — import `PAYMENT_NOT_RECONCILABLE`; add `tryReconcilePayment` after `tryAuthorizePayment` block (~14979)
- Modify: `apps/pms-core/test/folio-payments.spec.ts` — helper + cases **1–5**

**Interfaces:**
- Produces: `PAYMENT_NOT_RECONCILABLE` exported from `@hospai/contracts`
- Produces: `async tryReconcilePayment(actor, { paymentId, outcome, gatewayReference? }, idem)` → `{ ok: true, paymentId, status: 'authorized' | 'declined', gatewayReference }` | `{ ok: false, error: NOT_FOUND | PAYMENT_NOT_RECONCILABLE | IDEM_KEY_REUSED | … }`
- Produces: catalog id `folio.reconcile_payment`; `AUDIT_WRITER_COMMAND_IDS` includes `folio.reconcile_payment`

**Forbidden this commit:** HTTP routes/dispatch, client `reconcilePayment`, SPA, `[133]` register pin, spec pointers.

- [ ] **Step 1: Write failing DO tests (`folio-payments.spec.ts`)**

Add imports:

```typescript
import {
  fingerprintPayload,
  IDEM_KEY_REUSED,
  LINE_NOT_SPLITTABLE,
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_RECONCILABLE,
  REFUND_EXCEEDS_REMAINING,
} from '@hospai/contracts';
```

Append helpers after `capturePayment`:

```typescript
async function unknownPaymentViaTimeout(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  amountMinor = 3000,
) {
  await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
  const paymentId = `pay_${crypto.randomUUID()}`;
  try {
    const auth = await authorizePayment(
      stub,
      actor,
      reservationId,
      paymentId,
      amountMinor,
      `idem-auth-timeout-${crypto.randomUUID()}`,
    );
    expect(auth).toMatchObject({ ok: true, status: 'unknown', gatewayReference: null });
    return { paymentId, amountMinor };
  } finally {
    await stub.setPspSimulateOutcomeForTest(null);
  }
}

async function reconcilePayment(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  paymentId: string,
  outcome: 'authorized' | 'declined',
  idempotencyKey: string,
  gatewayReference?: string,
) {
  const fingerprintInput =
    gatewayReference != null
      ? { paymentId, outcome, gatewayReference }
      : { paymentId, outcome };
  const fingerprint = await fingerprintPayload(fingerprintInput);
  return stub.tryReconcilePayment(
    { kind: 'user', userId: actor },
    {
      paymentId,
      outcome,
      ...(gatewayReference != null ? { gatewayReference } : {}),
    },
    { key: idempotencyKey, fingerprint },
  );
}
```

Append describe block (after existing tests, before HTTP section if grouped):

```typescript
describe('folio.reconcile_payment (unknown exit)', () => {
  it('case 1: unknown → authorized — no folio line; outbox events; balance_at_risk cleared; capture succeeds', async () => {
    const actor = 'user_recon_1';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    await addCharge(stub, actor, reservationId, 5000);
    const { paymentId, amountMinor } = await unknownPaymentViaTimeout(stub, actor, reservationId, 5000);

    const folioUnknown = await stub.readFolio(reservationId);
    expect(folioUnknown.ok && folioUnknown.balanceAtRisk).toBe(true);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);

    const recon = await reconcilePayment(stub, actor, paymentId, 'authorized', `idem-recon-1-${crypto.randomUUID()}`);
    expect(recon).toMatchObject({ ok: true, paymentId, status: 'authorized' });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('authorized');
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);

    const events = await stub.listOutboxEventTypes();
    expect(events).toContain('folio.payment_authorized');
    expect(events).toContain('payment.authorized');

    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceAtRisk).toBe(false);

    expect(await capturePayment(stub, actor, paymentId, amountMinor, `idem-cap-recon-1`)).toMatchObject({
      ok: true,
      status: 'captured',
    });
  });

  it('case 2: unknown → declined — no folio.payment_authorized; payment.failed; capture blocked; balance_at_risk cleared', async () => {
    const actor = 'user_recon_2';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_2';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    await addCharge(stub, actor, reservationId, 3000);
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 3000);

    const recon = await reconcilePayment(stub, actor, paymentId, 'declined', `idem-recon-2-${crypto.randomUUID()}`);
    expect(recon).toMatchObject({ ok: true, paymentId, status: 'declined' });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('declined');
    const events = await stub.listOutboxEventTypes();
    expect(events).not.toContain('folio.payment_authorized');
    expect(events).toContain('payment.failed');

    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceAtRisk).toBe(false);

    expect(await capturePayment(stub, actor, paymentId, 3000, `idem-cap-recon-2`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
  });

  it('case 3: capture while still unknown → payment_not_capturable (Test 5 invariant)', async () => {
    const actor = 'user_recon_3';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_3';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 3000);
    expect(await capturePayment(stub, actor, paymentId, 3000, `idem-cap-recon-3`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('unknown');
  });

  it('case 4: reconcile non-unknown authorized → payment_not_reconcilable', async () => {
    const actor = 'user_recon_4';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_4';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 4000, `idem-auth-recon-4`),
    ).toMatchObject({ ok: true, status: 'authorized' });

    expect(await reconcilePayment(stub, actor, paymentId, 'authorized', `idem-recon-4`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_RECONCILABLE,
    });
    expect(await reconcilePayment(stub, actor, paymentId, 'declined', `idem-recon-4b`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_RECONCILABLE,
    });
  });

  it('case 5: idempotent replay same key + fingerprint — one payment row; no duplicate outbox', async () => {
    const actor = 'user_recon_5';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_5';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 2500);
    const idemKey = `idem-recon-5-${crypto.randomUUID()}`;

    const first = await reconcilePayment(stub, actor, paymentId, 'authorized', idemKey);
    expect(first).toMatchObject({ ok: true, status: 'authorized' });
    const eventsAfterFirst = await stub.listOutboxEventTypes();

    const second = await reconcilePayment(stub, actor, paymentId, 'authorized', idemKey);
    expect(second).toMatchObject({ ok: true, status: 'authorized', paymentId });

    expect(await stub.listOutboxEventTypes()).toEqual(eventsAfterFirst);
    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok && listed.payments).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run DO tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "folio.reconcile_payment"
```

Expected: **FAIL** — `tryReconcilePayment` not defined; `PAYMENT_NOT_RECONCILABLE` import may fail.

- [ ] **Step 3: Add wire code + catalog + audit writer + register pins (no HTTP)**

`idempotency.ts` after `PAYMENT_NOT_CAPTURABLE`:

```typescript
export const PAYMENT_NOT_RECONCILABLE = 'payment_not_reconcilable' as const;
```

`catalog.ts` append after `rooms.delete`:

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

`audit-writers.ts` after `'folio.authorize',`:

```typescript
  'folio.reconcile_payment',
```

`register.test.ts` ~268:

```typescript
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(56);
```

`register.test.ts` ~670–671:

```typescript
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(56);
    expect(COMMAND_CATALOG).toHaveLength(81);
```

- [ ] **Step 4: Implement `tryReconcilePayment` in `property-do.ts`**

Add `PAYMENT_NOT_RECONCILABLE` to contracts import block (~top of file with other payment codes).

Insert after `tryAuthorizePayment` / before `tryCapturePayment` (~14979):

```typescript
  /**
   * Operator-asserted exit from authorize-timeout `unknown`. Implements catalog `folio.reconcile_payment`.
   * Fingerprint allowlist: `{ paymentId, outcome, gatewayReference? }`.
   * Never calls PSP — must not gate on pspSimulateEnabled().
   */
  async tryReconcilePayment(
    actor: ActorContext,
    input: { paymentId: string; outcome: 'authorized' | 'declined'; gatewayReference?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; paymentId: string; status: 'authorized' | 'declined'; gatewayReference: string | null }
    | { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_RECONCILABLE | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof PROPERTY_ID_UNSET | 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const payment = this.readPaymentRowSync(input.paymentId);
          if (!payment) throw new Error(NOT_FOUND);

          if (payment.status === input.outcome) {
            return {
              ok: true as const,
              paymentId: payment.payment_id,
              status: input.outcome,
              gatewayReference: payment.gateway_reference,
            };
          }
          if (payment.status !== 'unknown') {
            throw new Error(PAYMENT_NOT_RECONCILABLE);
          }

          const now = Date.now();

          if (input.outcome === 'authorized') {
            const gwBind = input.gatewayReference ?? null;
            const updated = this.ctx.storage.sql.exec(
              `UPDATE payment
               SET status = 'authorized',
                   gateway_reference = COALESCE(?, gateway_reference),
                   balance_at_risk = 0,
                   updated_at = ?
               WHERE payment_id = ? AND status = 'unknown'`,
              gwBind,
              now,
              input.paymentId,
            );
            if (updated.rowsWritten === 0) {
              const current = this.readPaymentRowSync(input.paymentId);
              if (!current) throw new Error(NOT_FOUND);
              if (current.status === 'authorized') {
                return {
                  ok: true as const,
                  paymentId: current.payment_id,
                  status: 'authorized' as const,
                  gatewayReference: current.gateway_reference,
                };
              }
              throw new Error(PAYMENT_NOT_RECONCILABLE);
            }

            const row = this.readPaymentRowSync(input.paymentId)!;
            const authEventId = crypto.randomUUID();
            this.appendPropertyOutbox({
              eventId: authEventId,
              eventType: 'folio.payment_authorized',
              payload: {
                propertyId,
                paymentId: input.paymentId,
                reservationId: row.reservation_id,
                amountMinor: row.amount_minor,
                currency: row.currency,
                gatewayReference: row.gateway_reference,
              },
            });
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'payment.authorized',
              payload: {
                version: 1,
                propertyId,
                paymentId: input.paymentId,
                reservationId: row.reservation_id,
                amountMinor: row.amount_minor,
                currency: row.currency,
                purpose: row.purpose ?? 'STAY',
                eventId: authEventId,
                gatewayReference: row.gateway_reference,
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'folio.reconcile_payment',
              entityType: 'payment',
              entityId: input.paymentId,
              beforeJson: { paymentId: input.paymentId, status: 'unknown' },
              afterJson: {
                paymentId: input.paymentId,
                status: 'authorized',
                gatewayReference: row.gateway_reference,
              },
              shiftId: row.shift_id,
              reservationId: row.reservation_id,
            });
            return {
              ok: true as const,
              paymentId: input.paymentId,
              status: 'authorized' as const,
              gatewayReference: row.gateway_reference,
            };
          }

          const declinedUpdated = this.ctx.storage.sql.exec(
            `UPDATE payment
             SET status = 'declined',
                 balance_at_risk = 0,
                 updated_at = ?
             WHERE payment_id = ? AND status = 'unknown'`,
            now,
            input.paymentId,
          );
          if (declinedUpdated.rowsWritten === 0) {
            const current = this.readPaymentRowSync(input.paymentId);
            if (!current) throw new Error(NOT_FOUND);
            if (current.status === 'declined') {
              return {
                ok: true as const,
                paymentId: current.payment_id,
                status: 'declined' as const,
                gatewayReference: current.gateway_reference,
              };
            }
            throw new Error(PAYMENT_NOT_RECONCILABLE);
          }

          const row = this.readPaymentRowSync(input.paymentId)!;
          const failEventId = crypto.randomUUID();
          this.appendPropertyOutbox({
            eventId: failEventId,
            eventType: 'payment.failed',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: row.reservation_id,
              stage: 'authorize',
              reason: 'declined',
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.reconcile_payment',
            entityType: 'payment',
            entityId: input.paymentId,
            beforeJson: { paymentId: input.paymentId, status: 'unknown' },
            afterJson: { paymentId: input.paymentId, status: 'declined' },
            shiftId: row.shift_id,
            reservationId: row.reservation_id,
          });
          return {
            ok: true as const,
            paymentId: input.paymentId,
            status: 'declined' as const,
            gatewayReference: row.gateway_reference,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof Error && e.message === NOT_FOUND) return { ok: false, error: NOT_FOUND };
      if (e instanceof Error && e.message === PAYMENT_NOT_RECONCILABLE) {
        return { ok: false, error: PAYMENT_NOT_RECONCILABLE };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
```

- [ ] **Step 5: Rebuild contracts and run tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "folio.reconcile_payment"
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 5:|Test 10:"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "audit writer|night-audit HTTP routes"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: reconcile cases **1–5** **PASS**; existing Test 5 / Test 10 **PASS**; register shows catalog **81**, writers **56**; `[132]` still last HTTP (no `[133]` yet).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/idempotency.ts \
  packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): reconcile unknown payments (operator-asserted)

EOF
)"
```

---

### Task 2: HTTP + client

**Spec:** §2 Lock 3, §4.2, Lock 6 case **6**.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append after `[132]` (~778–784)
- Modify: `apps/pms-core/src/v1-dispatch.ts` — import `PAYMENT_NOT_RECONCILABLE`; `handlePostFolioReconcilePayment`; `mapPaymentCommandErrorStatus`; `V1_ROUTES` append after `handleDeleteRoom` (~7503–7511)
- Modify: `packages/client-core/src/api.ts` — `reconcilePayment` after `voidPayment` (~908)
- Modify: `packages/contracts/src/register.test.ts` — append `[133]` in `'night-audit HTTP routes append at 86–91'` (~662–671)
- Modify: `apps/pms-core/test/folio-payments.spec.ts` — HTTP case **6**

**Interfaces:**
- Consumes: Task 1 `tryReconcilePayment`, catalog `folio.reconcile_payment`
- Produces: `POST /v1/properties/:propertyId/payments/:paymentId/reconcile`; client `reconcilePayment`; `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'`

**Forbidden this commit:** SPA, spec pointers.

- [ ] **Step 1: Write failing HTTP tests**

Append helper in `folio-payments.spec.ts`:

```typescript
async function postReconcilePayment(
  propertyId: string,
  actor: string,
  paymentId: string,
  body: { outcome: 'authorized' | 'declined'; gatewayReference?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/payments/${encodeURIComponent(paymentId)}/reconcile`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}
```

Append tests:

```typescript
describe('POST /payments/:id/reconcile (HTTP case 6)', () => {
  it('200 happy — unknown → authorized', async () => {
    const actor = 'user_recon_http_ok';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_http_ok';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 1500);

    const res = await postReconcilePayment(propertyId, actor, paymentId, {
      outcome: 'authorized',
      idempotencyKey: `idem-http-recon-ok-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, paymentId, status: 'authorized' });
  });

  it('409 payment_not_reconcilable on authorized payment', async () => {
    const actor = 'user_recon_http_409';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_http_409';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 2000, `idem-auth-http-409`),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const res = await postReconcilePayment(propertyId, actor, paymentId, {
      outcome: 'declined',
      idempotencyKey: `idem-http-recon-409-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'payment_not_reconcilable' });
  });

  it('404 unknown payment id', async () => {
    const actor = 'user_recon_http_404';
    const { propertyId } = await provisionHotel(actor);
    const res = await postReconcilePayment(propertyId, actor, 'pay_missing', {
      outcome: 'authorized',
      idempotencyKey: `idem-http-recon-404-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
  });

  it('400 missing idempotencyKey', async () => {
    const actor = 'user_recon_http_400';
    const { propertyId } = await provisionHotel(actor);
    const res = await postReconcilePayment(propertyId, actor, 'pay_any', {
      outcome: 'authorized',
    } as { outcome: 'authorized' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
});
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "POST /payments/:id/reconcile"
```

Expected: **FAIL** — 404 route not found.

- [ ] **Step 3: Append route audit + handler + dispatch + client**

`v1-http-routes.ts` append:

```typescript
  {
    id: 'post_folio_reconcile_payment',
    scope: 'property',
    permission: 'folio:post',
    commandId: 'folio.reconcile_payment',
    entitlement: 'pms.core',
  },
```

`v1-dispatch.ts` — add `PAYMENT_NOT_RECONCILABLE` to imports from `@hospai/contracts`.

`mapPaymentCommandErrorStatus` (~5377) — add **before** the 422 bucket:

```typescript
  if (error === PAYMENT_NOT_RECONCILABLE) return 409;
```

`handlePostFolioReconcilePayment` (after `handlePostFolioVoid` ~5176):

```typescript
async function handlePostFolioReconcilePayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    outcome?: string;
    gatewayReference?: string;
    idempotencyKey?: string;
  };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  if (body.outcome !== 'authorized' && body.outcome !== 'declined') {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprintInput =
    body.gatewayReference != null
      ? { paymentId, outcome: body.outcome, gatewayReference: body.gatewayReference }
      : { paymentId, outcome: body.outcome };
  const fingerprint = await fingerprintPayload(fingerprintInput);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId,
    outcome: body.outcome as 'authorized' | 'declined',
    ...(body.gatewayReference != null ? { gatewayReference: body.gatewayReference } : {}),
  };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryReconcilePayment']>>>({
    env: ctx.env,
    commandId: 'folio.reconcile_payment',
    routeId: 'post_folio_reconcile_payment',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryReconcilePayment(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    return json({ ok: false, error: err }, mapPaymentCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}
```

Append to `V1_ROUTES` after `handleDeleteRoom` entry:

```typescript
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/payments\/([^/]+)\/reconcile$/,
    permission: 'folio:post',
    commandId: 'folio.reconcile_payment',
    entitlement: 'pms.core',
    handler: handlePostFolioReconcilePayment,
  },
```

`api.ts` after `voidPayment`:

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
    },
```

`register.test.ts` append after `[132]` block (~662–668):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[133]?.id).toBe('post_folio_reconcile_payment');
    expect(V1_HTTP_ROUTE_AUDIT[133]).toMatchObject({
      scope: 'property',
      permission: 'folio:post',
      commandId: 'folio.reconcile_payment',
      entitlement: 'pms.core',
    });
```

- [ ] **Step 4: Rebuild client-core + run HTTP + register tests**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "folio.reconcile_payment|POST /payments/:id/reconcile"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
```

Expected: **PASS**; `[133]=post_folio_reconcile_payment`; `[132]`/`[131]`/`[128]`/`[127]` unmoved; catalog **81**; writers **56**.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/folio-payments.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): POST /payments/:id/reconcile

EOF
)"
```

---

### Task 3: SPA — Folio unknown tender reconcile

**Spec:** §2 Lock 5, Lock 6 case **7**.

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — `tenderPayments` filter; unknown row UI; `reconcilePay` mutation
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` — RTL case **7**

**Interfaces:**
- Consumes: Task 2 `api.reconcilePayment(propertyId, paymentId, { outcome }, opId)`

**Forbidden this commit:** DO/HTTP/contracts, spec pointers.

- [ ] **Step 1: Write failing RTL tests**

In test mock (~20–34), add:

```typescript
const reconcilePayment = vi.fn();
```

In `api` mock (~79):

```typescript
    reconcilePayment: (...args: unknown[]) => reconcilePayment(...args),
```

In `beforeEach`:

```typescript
    reconcilePayment.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
```

Append test:

```typescript
  it('case 7: unknown payment row visible with Mark authorized and Mark declined buttons', async () => {
    getMe.mockResolvedValue(staffMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      balanceAtRisk: true,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_unknown',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'unknown',
          purpose: 'STAY',
          tenderType: 'CARD',
          gatewayReference: null,
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    renderFolio();
    expect(await screen.findByText(/Card · \$50\.00/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark authorized' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark declined' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark authorized' }));
    await waitFor(() =>
      expect(reconcilePayment).toHaveBeenCalledWith(
        'prop_demo',
        'pay_unknown',
        { outcome: 'authorized' },
        expect.stringMatching(/^reconcile:pay_unknown:/),
      ),
    );
  });
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "case 7:"
```

Expected: **FAIL** — unknown row not in tenders; buttons absent.

- [ ] **Step 3: Implement FolioScreen changes**

Update `tenderPayments` filter (~787–789):

```typescript
  const tenderPayments = payments.filter(
    (p) => p.status === 'authorized' || p.status === 'captured' || p.status === 'unknown',
  );
```

Add mutation after `voidPay` (~642):

```typescript
  const reconcilePay = useFolioActionMutation({
    fallback: 'Reconcile failed',
    setMessage,
    mutationFn: (input: { paymentId: string; outcome: 'authorized' | 'declined' }) => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      return api.reconcilePayment(
        propertyId,
        input.paymentId,
        { outcome: input.outcome },
        `reconcile:${input.paymentId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: (_data, input) => {
      setMessage(input.outcome === 'authorized' ? 'Payment marked authorized.' : 'Payment marked declined.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });
```

In tenders map (~842), after `{tenderLabel(p)} · {formatMinor(p.amountMinor)}`, add unknown branch before authorized capture UI:

```tsx
                  {p.status === 'unknown' ? (
                    <>
                      <Button
                        type="button"
                        disabled={!policy.canPay || reconcilePay.isPending}
                        onClick={() =>
                          reconcilePay.mutate({ paymentId: p.paymentId, outcome: 'authorized' })
                        }
                      >
                        Mark authorized
                      </Button>
                      <Button
                        type="button"
                        disabled={!policy.canPay || reconcilePay.isPending}
                        onClick={() =>
                          reconcilePay.mutate({ paymentId: p.paymentId, outcome: 'declined' })
                        }
                      >
                        Mark declined
                      </Button>
                    </>
                  ) : null}
```

Keep existing `p.status === 'authorized'` capture/void block unchanged.

- [ ] **Step 4: Rebuild client-core + run RTL + color check**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "case 7:"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): reconcile unknown card payments on folio

EOF
)"
```

---

### Task 4: LAST pointers + full CI

**Spec:** §8 checklist, §7 leftovers pointers, D6/D7.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md` — §5 row ~363; §137 named leftover
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — §6.6 ~335; §19 item **3** ~796
- Modify: `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-unknown-payment-reconcile.md` — Task 4 checkboxes (this file)

**Pointer sentences (normative):**

Payments-ledger §137 (~137):

> ~~**Named leftover:** `unknown` has no exit this slice.~~ **Closed** in [2026-08-15 unknown payment reconcile](./2026-08-15-unknown-payment-reconcile-design.md): operator-asserted `folio.reconcile_payment` (`authorized` | `declined`); never re-calls authorize.

Payments-ledger §5 row (~363):

> ~~`unknown` has no exit \| Reachable via simulate timeout; no reconciliation transition this slice~~ **Closed** in [2026-08-15 unknown payment reconcile](./2026-08-15-unknown-payment-reconcile-design.md).

Folio-money §6.6 (~335–337):

> ~~Unchanged. No void/refund/capture from `unknown`.~~ **`unknown` exit:** operator-asserted reconcile — [2026-08-15 unknown payment reconcile](./2026-08-15-unknown-payment-reconcile-design.md). Still no void/refund/capture from `unknown` without reconcile.

Folio-money §19 item **3** (~796):

> ~~**`unknown` reconciliation exit** (payments leftover, unchanged).~~ **Closed** in [2026-08-15 unknown payment reconcile](./2026-08-15-unknown-payment-reconcile-design.md).

- [x] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **81**; writers **56**; `[133]=post_folio_reconcile_payment`; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 29`.

- [x] **Step 2: Targeted test superset (spec Lock 6)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "folio.reconcile_payment|POST /payments/:id/reconcile|Test 5:|Test 10:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "case 7:"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
```

Expected: **PASS**.

- [x] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

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

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures. Do **not** run unsharded `pnpm --filter @hospai/pms-core test`.

- [x] **Step 4: Apply doc pointers + tick spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` §8.

- [x] **Step 5: Tick Task 4 checkboxes in this plan only**

Do **not** tick Tasks 1–3 checkboxes.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md \
  docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md \
  docs/superpowers/plans/2026-08-15-unknown-payment-reconcile.md
git commit -m "$(cat <<'EOF'
docs: close unknown payment reconcile leftovers

EOF
)"
```

**Stop.** Auth expiry, pending recovery, real PSP inquire, gatewayReference SPA modal, and unified payment HTTP paths stay deferred per spec §7.

---

## Spec §8 reviewer checklist (Task 4 ticks these in the spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Wire `PAYMENT_NOT_RECONCILABLE` + HTTP 409 mapping | Tasks 1–2 |
| Catalog `folio.reconcile_payment`; audit writer; register pins **81** / **56** / `[133]` | Tasks 1–2 + 4 |
| HTTP `[133]` + dispatch handler + client `reconcilePayment` | Task 2 |
| `tryReconcilePayment` conditional UPDATE, outbox, audit (Lock 1–4) | Task 1 |
| Folio SPA unknown row + **Mark authorized** / **Mark declined** + RTL | Task 3 |
| DO + HTTP tests (Lock 6); Test 5 / Test 10 unchanged | Tasks 1–2 + 4 |
| `pnpm check:*` gates | Task 4 |
| Bidirectional pointers | Task 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–6) | 1–4 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–6 | 1–4 |
| §3 schema unchanged | all (no migration task) |
| §4 commands / HTTP | 1–2 |
| §5 file map | 1–4 |
| §6 tests | 1–4 |
| §8 checklist + pointers | 4 |
| Heads table §1.1 | 1–2 + 4 verify |
| D-locks 1–7 | Open decisions |

**Gaps:** None — all Lock 6 numbered cases and §8 checklist items map to Tasks 1–4.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 4 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §9). Verified post-`rooms.delete`: catalog tail `rooms.delete`; HTTP tail `[132]`; schema **29**; timeout → `unknown` with `balance_at_risk=1`; `handlePostFolioVoid` dispatch pattern; Folio `tenderPayments` excludes `unknown` today.

**Implementer notes (from spec §9, not lock violations):**

1. Timeout already emitted `payment.failed` before reconcile — declined reconcile adds a second decline-shaped outbox event; do not re-call `applyPaymentEventSync`.
2. `mapPaymentCommandErrorStatus`: `PAYMENT_NOT_RECONCILABLE` → **409**; keep `PAYMENT_NOT_CAPTURABLE` → **422**.
3. After reconcile → `authorized`, `readFolio().balanceAtRisk` should clear when charges exist (case 1 asserts this).
4. HTTP path `/payments/` differs from void/refund `/folio/payments/` — intentional (Lock 3).
