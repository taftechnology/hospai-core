# Auth hold lapse — automatic void of aged card authorizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)

**Goal:** Automatically void aged CARD `authorized` holds via a PropertyDO `auth-hold-lapse` background alarm (reuse `simulateVoid` + `folio.void` audit with `afterJson.automated: true`), configurable TTL `pms.payments.auth_hold_hours` (default 72h), Settings SPA field — **no** new catalog command, HTTP route, or night-audit step.

**Architecture:** Extract `voidAuthorizedCardHoldSync` from `tryVoidPayment` so desk RPC (permission-gated) and alarm sweep (system actor `{ kind: 'system', reason: 'auth_hold_lapse' }`) share void semantics. Hourly `alarm_schedule` row `auth-hold-lapse` selects `status='authorized' AND tender_type='CARD' AND created_at <= cutoff`, voids each with fingerprint `auth_hold_lapse:${paymentId}`, reschedules +1h. Config read via `readConfigValueSync`; age clock is `payment.created_at` only.

**Tech Stack:** PropertyDO + sqlite alarms, `@hospai/contracts` DOMAIN register, vitest Worker specs (`provisionedPropertyStub`, `setAlarmScheduleForTest`, `triggerAlarmForTest`), web-pms RTL Settings.

**Spec:** `docs/superpowers/specs/2026-08-15-auth-hold-lapse-design.md` (Approved at `24d8a34` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes payments-ledger leftover **Auth expiry** (~362), folio-money leftover **8** (~801), and unknown-reconcile leftover **1** (~338). Bidirectional pointer sentences land in **Task 3 only**.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length stays **81** | New catalog id (e.g. `folio.lapse_hold`) |
| `AUDIT_WRITER_COMMAND_IDS.size` stays **56** | New audit writer (reuse `folio.void`) |
| HTTP `[133] post_folio_reconcile_payment` last; `[132]`/`[131]`/`[128]`/`[127]` unmoved | New V1 HTTP route |
| `PROPERTY_SCHEMA_HEAD` **29** unchanged | Schema migration / `authorized_at` column |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | `CLASS_DENYLIST` edit |
| Settings `pms.payments.auth_hold_hours` int field + exact hint | Folio “Hold aged out” UI |
| PropertyDO `auth-hold-lapse` alarm + cases **1–9** | Unknown reconcile (done); pending recovery |
| — | Ticking Tasks 1–2 living boxes; push |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **81** (last entry `folio.reconcile_payment` ~897–909). `AUDIT_WRITER_COMMAND_IDS.size` **56** (pins ~268 and ~677). HTTP `[133] post_folio_reconcile_payment` last; `[132] delete_room` / `[131] post_folio_routing_rule_archive` / `[128] post_folio_stay_discount` / `[127] post_demo_seed` **unmoved**. `PROPERTY_SCHEMA_HEAD` **29**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — Alarm; no catalog/HTTP (spec Lock 1)

**Locked:** Dedicated `alarm_schedule` name **`auth-hold-lapse`**. **`ensureAuthHoldLapseScheduleIfAbsent()`** at **three** call sites: `provision.ts` ~130–131, `fixtures.ts` `provisionedPropertyStub` ~69, **start of `alarm()`** before `scheduler.run`. Handler calls `runAuthHoldLapseSync()` then `upsertSchedule('auth-hold-lapse', Date.now() + AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS)`. Constant **`AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS = 3_600_000`** in `apps/pms-core` (or `@hospai/do-runtime` index export — **not** `outbox.ts`). **Forbidden:** 9th night-audit step; new catalog/HTTP; `consumers.reschedulesNightAudit` on config key.

### D3 — Void reuse; system actor (spec Lock 2)

**Locked:** Extract **`voidAuthorizedCardHoldSync`** from `tryVoidPayment` (~15434–15528). Desk RPC keeps `assertRpcAvailable`, `touchInteractive`, entitlement + **`gatePermission(actor, 'folio:post')`**, idempotency replay on `void_fingerprint`; delegates after gates. Alarm path **`runAuthHoldLapseSync`**: **no** `gatePermission`, **no** `touchInteractive`. Actor **`{ kind: 'system', reason: 'auth_hold_lapse' }`** — add `'auth_hold_lapse'` to `SystemActor.reason` in `permissions.ts` (~12–18). Per-payment fingerprint **`auth_hold_lapse:${paymentId}`**. Audit **`commandId: 'folio.void'`** with `afterJson.automated: true` on alarm; omitted/false on desk. Reuse outbox **`folio.payment_voided`** only. Per-payment adapter/txn failure → log/skip; do not abort sweep.

### D4 — TTL config (spec Lock 3)

**Locked:** DOMAIN **`pms.payments.auth_hold_hours`**: `z.number().int().min(1).max(720)`, default **72**, `consumersExempt: true`, prototype **`pms_payments_auth_hold_hours`**. Age via **`payment.created_at`**. Candidate query: `status = 'authorized' AND tender_type = 'CARD' AND created_at <= ?` where `? = Date.now() - hours * 3_600_000`. Excludes `unknown`, `pending`, `declined`, `captured`, `voided`, `refunded`, `CASH`. No “off” switch — **720** = effectively off.

### D5 — Capture/skip semantics (spec Lock 4)

**Locked:** Post-lapse capture → existing **`payment_not_capturable`** (~15239–15240). Void adapter **declined/timeout** → stay **`authorized`**; **does not** promote to `unknown`. Already voided + same `auth_hold_lapse:${paymentId}` fingerprint → idempotent no-op.

### D6 — SPA (spec Lock 5)

**Locked:** Settings only. **`DomainText`** `inputType="number"` `configKey="pms.payments.auth_hold_hours"`. Hint **exactly:** `Authorized card holds older than this many hours are voided automatically.` Place under Folio/Payments heading if present; **else** next to `pending_hold_hours` (~566–572) using same `DomainText` number pattern. **No** `FolioScreen` changes.

### D7 — Tests / CI discipline (spec Lock 6)

**Locked:** New `apps/pms-core/test/auth-hold-lapse.spec.ts` cases **1–9**. **`setPaymentCreatedAtForTest`** unsafe-local (mirror `stampFolioWindowClosedForTest` ~2175–2181). Alarm: `setAlarmScheduleForTest('auth-hold-lapse', Date.now() - 60_000)` + `triggerAlarmForTest()`. Fixture ids via **`crypto.randomUUID()`**. **Do not** `vi.spyOn` into DO isolate. Rebuild **`@hospai/contracts`** before pms-core tests (Task 1). Rebuild **`@hospai/client-core`** if needed before web-pms tests (Task 2). `EXPECTED_PROTOTYPE_KEYS` **96 → 97** + sorted `pms_payments_auth_hold_hours`. File-filter vitest; `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D8 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 3 only** at implementation time. Bidirectional pointers — **Task 3 only**. No push.

---

## Global Constraints

- **`NIGHT_AUDIT_STEPS` length stays 8** — `[3] === 'AUTO_TRANSFER'`; no hold-lapse step.
- **No schema migration** — `PROPERTY_SCHEMA_HEAD` stays **29**; use `payment.created_at` only.
- **No new catalog / HTTP / wire codes** — reuse existing `folio.void` audit writer (size **56**).
- **Alarm name exactly `auth-hold-lapse`** — registered in `alarm()` ~1988–2022 alongside `outbox` and `night-audit`.
- **Sweep interval `AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS = 3_600_000`** — not in `packages/do-runtime/src/outbox.ts`.
- **Void timeout/decline on lapse does not promote to `unknown`** — folio-money rule preserved.
- **Alarm path: no `folio:post` gate, no `touchInteractive`** — background sweep (mirror outbox alarm).
- **Settings hint exact string:** `Authorized card holds older than this many hours are voided automatically.`
- **Scope-out (forbidden all tasks):** unknown reconcile (done); pending seam recovery; real PSP webhooks; 9th night-audit step; new HTTP/catalog; city ledger; invoices; derived rates; promo; Folio “Hold aged out”; `CLASS_DENYLIST`; ticking Tasks 1–2 living boxes; push.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/permissions.ts` | `SystemActor.reason` += `'auth_hold_lapse'` | 1 |
| `packages/contracts/src/config/register.ts` | + `pms.payments.auth_hold_hours` | 1 |
| `packages/contracts/src/register.test.ts` | `EXPECTED_PROTOTYPE_KEYS` **97**; invariants | 1 |
| `apps/pms-core/src/property-do.ts` | `AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS`; `voidAuthorizedCardHoldSync`; `runAuthHoldLapseSync`; `ensureAuthHoldLapseScheduleIfAbsent`; `alarm()` ensure + handler; `setPaymentCreatedAtForTest`; refactor `tryVoidPayment` | 1 |
| `apps/pms-core/src/provision.ts` | call `ensureAuthHoldLapseScheduleIfAbsent` ~130–131 | 1 |
| `apps/pms-core/test/fixtures.ts` | `provisionedPropertyStub` ~69 — lapse ensure next to outbox | 1 |
| `apps/pms-core/test/auth-hold-lapse.spec.ts` | Lock 6 cases **1–9** | 1 |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | int field + exact hint | 2 |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | key + hint RTL | 2 |
| `docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md` | Close §5 Auth expiry ~362 | 3 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | Close §19 item **8** ~801 | 3 |
| `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` | Close §7 item **1** ~338 | 3 |
| `docs/superpowers/specs/2026-08-15-auth-hold-lapse-design.md` | Tick §6 checklist | 3 |
| `docs/superpowers/plans/2026-08-15-auth-hold-lapse.md` | Task 3 checkboxes (this file) | 3 |

**Not touched:** `COMMAND_CATALOG`, `audit-writers.ts`, `v1-http-routes.ts`, `property-migrations.ts`, `NIGHT_AUDIT_STEPS`, `v1-dispatch.ts`, `FolioScreen.tsx`, unknown-reconcile code paths.

---

## Spec §1.2 / §6 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) DOMAIN `pms.payments.auth_hold_hours` | 1 |
| §1.2 (2) extract `voidAuthorizedCardHoldSync` | 1 |
| §1.2 (3) alarm schedule + handler + three ensures | 1 |
| §1.2 (4) `SystemActor.reason` += `'auth_hold_lapse'` | 1 |
| §1.2 (5) Settings SPA | 2 |
| §1.2 (6) tests + register invariants | 1, 3 |
| Lock 6 cases **1–9** | 1 |
| Settings test | 2 |
| §6 checklist + pointers | 3 |
| §1.3 scope out | forbidden all |

---

### Task 1: Contracts + PropertyDO alarm + auth-hold-lapse.spec cases 1–9

**Spec:** §2 Locks 1–4, §4, Lock 6 cases **1–9** (except Settings SPA).

**Files:**
- Modify: `packages/contracts/src/permissions.ts` — ~12–18
- Modify: `packages/contracts/src/config/register.ts` — after `pms.reservations.pending_hold_hours` (~213–220)
- Modify: `packages/contracts/src/register.test.ts` — `EXPECTED_PROTOTYPE_KEYS` (~26–123); length **96 → 97** (~144–146)
- Modify: `apps/pms-core/src/property-do.ts` — const + helpers + `alarm()` ~1988–2022; `tryVoidPayment` ~15434–15528; test helper near ~2175
- Modify: `apps/pms-core/src/provision.ts` — ~130–131
- Modify: `apps/pms-core/test/fixtures.ts` — ~69
- Create: `apps/pms-core/test/auth-hold-lapse.spec.ts`

**Interfaces:**
- Produces: `SystemActor.reason` includes `'auth_hold_lapse'`
- Produces: config key `pms.payments.auth_hold_hours` (register default **72**)
- Produces: `async ensureAuthHoldLapseScheduleIfAbsent(): Promise<void>`
- Produces: `async setPaymentCreatedAtForTest(paymentId: string, createdAtMs: number): Promise<void>` (unsafe-local)
- Produces: `private async voidAuthorizedCardHoldSync(actor, { paymentId, voidFingerprint }, opts?: { automated?: boolean })` → `{ ok: true, paymentId, status: 'voided' } | { ok: false, error: … }`
- Produces: `private async runAuthHoldLapseSync(): Promise<void>` — no permission gate
- Produces: `tryVoidPayment` delegates to sync helper after desk gates (unchanged external signature)

**Forbidden this commit:** Settings SPA, spec pointers, ticking Task 3 checkboxes.

- [ ] **Step 1: Write failing register + DO tests (`auth-hold-lapse.spec.ts`)**

Create `apps/pms-core/test/auth-hold-lapse.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_VOIDABLE,
  fingerprintPayload,
} from '@hospai/contracts';
import { addCalendarDays } from './date-helpers.js';
import {
  idemFor,
  provisionedPropertyStub,
  propertyStub,
  TEST_OWNER_ACTOR,
} from './fixtures.js';
import type { PropertyDO } from '../src/property-do.js';
import { seedSubscription } from '../src/registry.js';

const HOUR_MS = 3_600_000;

async function seedReservation(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
) {
  const arrival = (await stub.readBusinessDate())!;
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, 1),
  });
  return arrival;
}

async function authorizeCard(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor = 5000,
) {
  const body = { paymentId, reservationId, amountMinor };
  return stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
    paymentId,
    reservationId,
    amountMinor,
    idempotencyKey: `idem-${paymentId}`,
    requestFingerprint: await fingerprintPayload(body),
  });
}

async function capture(
  stub: DurableObjectStub<PropertyDO>,
  paymentId: string,
  amountMinor: number,
) {
  return stub.tryCapturePayment(TEST_OWNER_ACTOR, {
    paymentId,
    amountMinor,
    idempotencyKey: `cap-${paymentId}`,
    captureFingerprint: await fingerprintPayload({ paymentId, amountMinor }),
  });
}

async function fireAuthHoldLapseAlarm(stub: DurableObjectStub<PropertyDO>) {
  await stub.setAlarmScheduleForTest('auth-hold-lapse', Date.now() - 60_000);
  await stub.triggerAlarmForTest();
}

/** Stub without auth-hold-lapse ensure — case 9 lazy ensure via alarm() entry. */
async function provisionWithoutLapseEnsure(name: string) {
  const orgId = `org_prop_${name}`;
  await seedSubscription(env, orgId, 'starter');
  const org = orgStub(orgId);
  await org.ensureMember('user_owner', 'owner');
  const stub = propertyStub(name, orgId) as DurableObjectStub<PropertyDO>;
  await stub.ensureMetaPropertyId(name);
  await stub.ensureMetaOrgId(orgId);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'UTC' });
  await stub.ensureTimeZoneIfAbsent('UTC', { key: `provision:timezone:${name}`, fingerprint });
  const currencyFp = await fingerprintPayload({ propertyId: name, currency: 'USD' });
  await stub.ensureCurrencyIfAbsent('USD', {
    key: `provision:currency:${name}`,
    fingerprint: currencyFp,
  });
  const instant = new Date();
  await stub.ensureBusinessDateIfAbsent('UTC', instant);
  await stub.ensureNightAuditSchedule('UTC', instant);
  await stub.ensureOutboxScheduleIfAbsent();
  // intentionally skip ensureAuthHoldLapseScheduleIfAbsent
  return { stub, orgId };
}

// fix import for provisionWithoutLapseEnsure — add at top:
import { env } from 'cloudflare:test';
import { orgStub } from './fixtures.js';

describe('auth hold lapse', () => {
  it('case 1: aged CARD authorized → voided; outbox; audit folio.void automated system:auth_hold_lapse', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({
      ok: true,
      status: 'authorized',
    });

    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('voided');
    expect(await stub.listOutboxEventTypes()).toContain('folio.payment_voided');

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    expect(audit.ok).toBe(true);
    const rows = (audit as { ok: true; rows: Array<{ actor: string; commandId: string; afterJson: unknown }> })
      .rows;
    const voidRow = rows.find((r) => r.commandId === 'folio.void' && r.afterJson && typeof r.afterJson === 'object');
    expect(voidRow?.actor).toBe('system:auth_hold_lapse');
    expect(voidRow?.afterJson).toMatchObject({ status: 'voided', automated: true });
  });

  it('case 2: after lapse, capture → payment_not_capturable', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId, 4000)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    expect(await capture(stub, paymentId, 4000)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
  });

  it('case 3: inside TTL (71h) → stays authorized', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 71 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
  });

  it('case 4: config 720h; warp 100h → stays authorized', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.payments.auth_hold_hours',
      720,
      { reason: 'test:long-ttl' },
      await idemFor('cfg-auth-hold-720', { key: 'pms.payments.auth_hold_hours', value: 720 }),
    );
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 100 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
  });

  it('case 5: CASH / unknown / pending aged past threshold → unchanged', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const agedAt = Date.now() - 100 * HOUR_MS;

    const cashId = `pay_cash_${crypto.randomUUID()}`;
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: cashId,
        reservationId,
        amountMinor: 2000,
        idempotencyKey: `cash-${cashId}`,
        requestFingerprint: await fingerprintPayload({
          paymentId: cashId,
          reservationId,
          amountMinor: 2000,
        }),
      }),
    ).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(cashId, agedAt);

    const unknownId = `pay_unk_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
    expect(await authorizeCard(stub, reservationId, unknownId, 3000)).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    await stub.setPaymentCreatedAtForTest(unknownId, agedAt);

    const pendingId = `pay_pend_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
    expect(await authorizeCard(stub, reservationId, pendingId, 2500)).toEqual({
      ok: false,
      error: 'psp_adapter_failed',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    await stub.setPaymentCreatedAtForTest(pendingId, agedAt);

    await fireAuthHoldLapseAlarm(stub);

    expect((await stub.readPayment(cashId)).ok && (await stub.readPayment(cashId)).ok).toBe(true);
    expect((await stub.readPayment(cashId)).ok && (await stub.readPayment(cashId)).payment!.status).toBe(
      'captured',
    );
    expect((await stub.readPayment(unknownId)).ok && (await stub.readPayment(unknownId)).payment!.status).toBe(
      'unknown',
    );
    expect((await stub.readPayment(pendingId)).ok && (await stub.readPayment(pendingId)).payment!.status).toBe(
      'pending',
    );
  });

  it('case 6: void declined on aged hold → stays authorized; schedule advanced', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-6-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await stub.setPspSimulateOutcomeForTest({ void: 'declined' });
    const before = Date.now();
    await fireAuthHoldLapseAlarm(stub);
    await stub.setPspSimulateOutcomeForTest(null);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(before);
  });

  it('case 7: desk tryVoidPayment on fresh hold — permission gate; no automated audit', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-7-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true, status: 'voided' });
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    const rows = (audit as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> }).rows;
    const voidRow = rows.find((r) => r.commandId === 'folio.void');
    expect(voidRow?.afterJson).toMatchObject({ status: 'voided' });
    expect(voidRow?.afterJson).not.toMatchObject({ automated: true });
  });

  it('case 8: provisioned stub → auth-hold-lapse schedule non-null', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-8-${crypto.randomUUID()}`, 'UTC', 'USD');
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('case 9: stub without lapse ensure; outbox alarm fire → lazy auth-hold-lapse row', async () => {
    const name = `ahl-9-${crypto.randomUUID()}`;
    const { stub } = await provisionWithoutLapseEnsure(name);
    expect(await stub.getAlarmSchedule('auth-hold-lapse')).toBeNull();
    await stub.setAlarmScheduleForTest('outbox', Date.now() - 60_000);
    await stub.triggerAlarmForTest();
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
  });
});
```

**Note for implementer:** consolidate imports at file top (`env`, `orgStub` from `./fixtures.js`); export `orgStub` from fixtures if not already exported, or inline `orgStub` import from existing fixtures export list.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/auth-hold-lapse.spec.ts
```

Expected: **FAIL** — `setPaymentCreatedAtForTest` / `ensureAuthHoldLapseScheduleIfAbsent` / config key missing; imports may fail until contracts rebuild.

- [ ] **Step 3: Add contracts — permissions + DOMAIN register + prototype key 97**

`packages/contracts/src/permissions.ts` — extend union ~12–18:

```typescript
export type SystemActor = {
  kind: 'system';
  reason:
    | 'night_audit'
    | 'night_audit.auto_transfer'
    | 'migration_sweep'
    | 'queue_replay'
    | 'provision'
    | 'purge'
    | 'auth_hold_lapse';
};
```

`packages/contracts/src/config/register.ts` — after `pms.reservations.pending_hold_hours` (~213–220):

```typescript
  entry({
    key: 'pms.payments.auth_hold_hours',
    prototypeKey: 'pms_payments_auth_hold_hours',
    class: 'DOMAIN',
    schema: z.number().int().min(1).max(720),
    default: 72,
    consumersExempt: true,
  }),
```

`packages/contracts/src/register.test.ts` — add `'pms_payments_auth_hold_hours'` to `EXPECTED_PROTOTYPE_KEYS` (sorted, after `'pms_optin_thankyou'`, before `'pms_property_market_segments'`):

```typescript
  'pms_payments_auth_hold_hours',
```

Update length assertion ~144–146:

```typescript
  it('classifies all 97 prototype config keys', () => {
    expect(EXPECTED_PROTOTYPE_KEYS).toHaveLength(97);
```

- [ ] **Step 4: Implement PropertyDO — const, ensure, sync void, lapse sweep, alarm, test helper; refactor desk void**

At module scope in `apps/pms-core/src/property-do.ts` (near other interval imports — **not** in `outbox.ts`):

```typescript
const AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS = 3_600_000;
```

Add ensure (mirror `ensureOutboxScheduleIfAbsent` ~1799–1806):

```typescript
  async ensureAuthHoldLapseScheduleIfAbsent(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM alarm_schedule WHERE name = 'auth-hold-lapse' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    if (rows.length > 0) return;
    this.scheduler.upsertSchedule('auth-hold-lapse', Date.now() + AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS);
    await this.scheduler.armFromTable();
  }
```

Add test helper near `stampFolioWindowClosedForTest` (~2175):

```typescript
  async setPaymentCreatedAtForTest(paymentId: string, createdAtMs: number): Promise<void> {
    this.assertUnsafeLocal('setPaymentCreatedAtForTest');
    this.ctx.storage.sql.exec(
      `UPDATE payment SET created_at = ? WHERE payment_id = ?`,
      createdAtMs,
      paymentId,
    );
  }
```

Extract sync void (insert before `tryVoidPayment` ~15434):

```typescript
  private async voidAuthorizedCardHoldSync(
    actor: ActorContext,
    input: { paymentId: string; voidFingerprint: string },
    opts?: { automated?: boolean },
  ): Promise<
    | { ok: true; paymentId: string; status: 'voided' }
    | { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_VOIDABLE | typeof PSP_UNAVAILABLE | string }
  > {
    if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };
    if (payment.status === 'voided' && payment.void_fingerprint === input.voidFingerprint) {
      return { ok: true, paymentId: payment.payment_id, status: 'voided' };
    }
    if (payment.tender_type === 'CASH' || payment.status !== 'authorized') {
      return { ok: false, error: PAYMENT_NOT_VOIDABLE };
    }

    const adapterResult = await simulateVoid(
      {
        paymentId: input.paymentId,
        gatewayReference: payment.gateway_reference ?? `sim_${input.paymentId}`,
      },
      this.pspSimulateOutcomeForTest,
    );
    if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
      return { ok: false, error: 'psp_adapter_failed' };
    }
    if (adapterResult.outcome !== 'approved') {
      return { ok: false, error: PAYMENT_NOT_VOIDABLE };
    }

    try {
      return this.ctx.storage.transactionSync(() => {
        const updated = this.ctx.storage.sql.exec(
          `UPDATE payment
           SET status = 'voided', void_fingerprint = ?, updated_at = ?
           WHERE payment_id = ? AND status = 'authorized'`,
          input.voidFingerprint,
          Date.now(),
          input.paymentId,
        );
        if (updated.rowsWritten === 0) {
          const current = this.readPaymentRowSync(input.paymentId);
          if (!current) return { ok: false as const, error: NOT_FOUND };
          if (current.status === 'voided' && current.void_fingerprint === input.voidFingerprint) {
            return { ok: true as const, paymentId: current.payment_id, status: 'voided' as const };
          }
          return { ok: false as const, error: PAYMENT_NOT_VOIDABLE };
        }
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'folio.payment_voided',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            gatewayReference: adapterResult.gatewayReference,
          },
        });
        this.appendAuditLogSync({
          actor: this.auditActorSync(actor),
          commandId: 'folio.void',
          entityType: 'payment',
          entityId: input.paymentId,
          beforeJson: { status: 'authorized' },
          afterJson: {
            status: 'voided',
            ...(opts?.automated ? { automated: true } : {}),
          },
          reservationId: payment.reservation_id,
        });
        return { ok: true as const, paymentId: input.paymentId, status: 'voided' as const };
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async runAuthHoldLapseSync(): Promise<void> {
    const hours = Number(this.readConfigValueSync('pms.payments.auth_hold_hours') ?? 72);
    const cutoff = Date.now() - hours * 3_600_000;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id FROM payment
         WHERE status = 'authorized' AND tender_type = 'CARD' AND created_at <= ?`,
        cutoff,
      )
      .toArray() as Array<{ payment_id: string }>;

    const actor: ActorContext = { kind: 'system', reason: 'auth_hold_lapse' };
    for (const row of rows) {
      const paymentId = row.payment_id;
      const voidFingerprint = `auth_hold_lapse:${paymentId}`;
      const result = await this.voidAuthorizedCardHoldSync(
        actor,
        { paymentId, voidFingerprint },
        { automated: true },
      );
      if (!result.ok) {
        console.warn('[auth-hold-lapse] skip', paymentId, result.error);
      }
    }
  }
```

Refactor `tryVoidPayment` body (~15456+) to delegate after desk gates + idempotency pre-checks:

```typescript
    // … existing gates through PAYMENT_NOT_VOIDABLE checks on CASH/non-authorized …
    const core = await this.voidAuthorizedCardHoldSync(
      actor,
      { paymentId: input.paymentId, voidFingerprint: idem.fingerprint },
    );
    if (!core.ok) {
      if (core.error === IDEM_KEY_REUSED) return { ok: false, error: IDEM_KEY_REUSED };
      return core as { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_VOIDABLE | typeof PSP_UNAVAILABLE | string };
    }
    return core;
```

Wire `alarm()` ~1988:

```typescript
  async alarm(): Promise<void> {
    await this.ensureAuthHoldLapseScheduleIfAbsent();
    await this.scheduler.run({
      outbox: async () => { /* unchanged */ },
      'night-audit': async () => { /* unchanged */ },
      'auth-hold-lapse': async () => {
        await this.runAuthHoldLapseSync();
        this.scheduler.upsertSchedule('auth-hold-lapse', Date.now() + AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS);
      },
    });
  }
```

`apps/pms-core/src/provision.ts` ~131 — after outbox ensure:

```typescript
  await prop.ensureAuthHoldLapseScheduleIfAbsent();
```

`apps/pms-core/test/fixtures.ts` ~69 — after outbox ensure:

```typescript
  await stub.ensureAuthHoldLapseScheduleIfAbsent();
```

- [ ] **Step 5: Rebuild contracts and run tests + register pins**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/auth-hold-lapse.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "26:|27:"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "classifies all 97|night-audit HTTP routes|passes invariants"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: cases **1–9** **PASS**; folio void cases **26–27** unchanged **PASS**; prototype keys **97**; catalog **81**; writers **56**; `[133]` last.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/permissions.ts \
  packages/contracts/src/config/register.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/provision.ts \
  apps/pms-core/test/fixtures.ts \
  apps/pms-core/test/auth-hold-lapse.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): auth-hold-lapse alarm voids aged card holds

EOF
)"
```

---

### Task 2: Settings SPA — auth hold hours field

**Spec:** §2 Lock 5, Lock 6 Settings test.

**Files:**
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` — after `pending_hold_hours` (~566–572)
- Modify: `apps/web-pms/src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 config key `pms.payments.auth_hold_hours` (DOMAIN, default 72)

**Forbidden this commit:** `FolioScreen.tsx`, DO/contracts changes, spec pointers.

- [ ] **Step 1: Write failing RTL test**

In `SettingsScreen.test.tsx` `beforeEach` domain list (~83–90), add:

```typescript
        domain('pms.payments.auth_hold_hours', 72),
        domain('pms.reservations.pending_hold_hours', 24),
```

Append test:

```typescript
  it('auth_hold_hours: domain list includes key and exact consumer hint', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auth hold hours')).toBeTruthy();
    expect(
      screen.getByText(
        'Authorized card holds older than this many hours are voided automatically.',
      ),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run RTL test to verify it fails**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auth_hold_hours"
```

Expected: **FAIL** — label/hint absent.

- [ ] **Step 3: Add Settings field next to pending_hold_hours**

In `SettingsScreen.tsx` Reservations section, immediately after `pending_hold_hours` block (~566–572):

```tsx
          <DomainText
            label="Auth hold hours"
            configKey="pms.payments.auth_hold_hours"
            initial={lookup(keys, 'pms.payments.auth_hold_hours')}
            inputType="number"
            hint="Authorized card holds older than this many hours are voided automatically."
            {...common}
          />
```

- [ ] **Step 4: Rebuild client-core if needed + run RTL + color check**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auth_hold_hours"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/SettingsScreen.tsx \
  apps/web-pms/src/screens/SettingsScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): settings field for auth hold hours TTL

EOF
)"
```

---

### Task 3: Leftover pointers + full CI

**Spec:** §6 checklist, §7 leftovers pointers, D7/D8.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md` — §5 row ~362
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — §19 item **8** ~801
- Modify: `docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md` — §7 item **1** ~338
- Modify: `docs/superpowers/specs/2026-08-15-auth-hold-lapse-design.md` — tick §6 checklist
- Modify: `docs/superpowers/plans/2026-08-15-auth-hold-lapse.md` — Task 3 checkboxes (this file)

**Pointer sentences (normative — one sentence each):**

Payments-ledger §5 (~362):

> ~~Auth expiry \| `authorized` never ages out; no hold-lapse process~~ **Closed** in [2026-08-15 auth hold lapse](./2026-08-15-auth-hold-lapse-design.md): PropertyDO `auth-hold-lapse` alarm voids aged CARD `authorized` holds via `folio.void` with `afterJson.automated: true`.

Folio-money §19 item **8** (~801):

> ~~**Authorization expiry** / hold-lapse (payments leftover).~~ **Closed** in [2026-08-15 auth hold lapse](./2026-08-15-auth-hold-lapse-design.md).

Unknown-reconcile §7 item **1** (~338):

> ~~**Authorization expiry / hold-lapse** \| Queue item 6 — `authorized` never ages out~~ **Closed** in [2026-08-15 auth hold lapse](./2026-08-15-auth-hold-lapse-design.md) (explicitly scoped out of unknown-reconcile).

- [x] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **81**; writers **56**; `[133]=post_folio_reconcile_payment`; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[128]=post_folio_stay_discount`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 29`; `ORG_SCHEMA_HEAD === 7`.

- [x] **Step 2: Targeted test superset (spec Lock 6)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/auth-hold-lapse.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payment-lifecycle.spec.ts -t "26:|27:|35:"
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx -t "auth_hold_hours"
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

- [x] **Step 4: Apply doc pointers + tick spec §6 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-auth-hold-lapse-design.md` §6.

- [x] **Step 5: Tick Task 3 checkboxes in this plan only**

Do **not** tick Tasks 1–2 checkboxes.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-payments-ledger-simulate-design.md \
  docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-15-unknown-payment-reconcile-design.md \
  docs/superpowers/specs/2026-08-15-auth-hold-lapse-design.md \
  docs/superpowers/plans/2026-08-15-auth-hold-lapse.md
git commit -m "$(cat <<'EOF'
docs: close auth hold lapse leftovers

EOF
)"
```

**Stop.** Pending recovery, real PSP expiry webhooks, Folio “Hold aged out” UI, and 9th night-audit step stay deferred per spec §1.3.

---

## Spec §6 reviewer checklist (Task 3 ticks these in the spec file when CI is green)

| §6 item | Satisfied by |
|---|---|
| `SystemActor.reason` includes `'auth_hold_lapse'` | Task 1 |
| Config register + SPA + invariants (**97** prototype keys) | Tasks 1–2 + 3 |
| Settings hint exact string | Task 2 |
| `voidAuthorizedCardHoldSync` extracted; desk delegates | Task 1 |
| `runAuthHoldLapseSync` + three ensures + alarm handler | Task 1 |
| `setPaymentCreatedAtForTest` | Task 1 |
| Tests Lock 6 (**1–9**); register pins **81** / **56** / `[133]` | Tasks 1 + 3 |
| Bidirectional pointers | Task 3 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–6) | 1–3 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–6 | 1–3 |
| §4 file map | 1–3 |
| §6 checklist + pointers | 3 |
| Heads table §1.1 | 1 + 3 verify |
| D-locks 1–8 | Open decisions |

**Gaps:** None — all Lock 6 numbered cases and §6 checklist items map to Tasks 1–3.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 3 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §7). Verified on `main` post unknown-reconcile: catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, schema **29**, `tryVoidPayment` + `simulateVoid` ~15434–15477, `alarm()` two-handler multiplex ~1988–2022 (third handler added here), `pending_hold_hours` Settings pattern ~566–572, no Folio/Payments heading in Settings (field goes next to `pending_hold_hours` per D6).

**Implementer notes (from spec §7, not lock violations):**

1. `voidAuthorizedCardHoldSync` is async (adapter outside txn) — alarm processes holds sequentially; volume is low for Phase 1.
2. `pspSimulateEnabled()` off → alarm skips with `PSP_UNAVAILABLE` per payment (same as desk case **36**).
3. Case **5** CASH via `tryRecordCashPayment` lands **`captured`**, not `authorized` — still must not be selected by lapse query (`tender_type = 'CARD' AND status = 'authorized'`).
4. Case **9** relies on `alarm()` entry ensure before `scheduler.run` — any due schedule (outbox) triggers lazy insert of `auth-hold-lapse`.
5. Desk `tryVoidPayment` idempotency pre-check on `voided` + fingerprint stays in RPC wrapper before delegate — do not require `folio:post` on alarm path.
