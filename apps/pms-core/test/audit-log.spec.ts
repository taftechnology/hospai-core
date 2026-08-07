import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Audit Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

async function postShift(
  propertyId: string,
  actor: string,
  body: { shiftId: string; openingFloat: number },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/shifts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: `idem-open-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postCash(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: { paymentId: string; amountMinor: number },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments/cash`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: `idem-cash-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function getAuditLog(
  propertyId: string,
  actor: string,
  query: Record<string, string | undefined> = {},
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, v);
  }
  const q = qs.toString();
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/audit-log${q ? `?${q}` : ''}`,
      { method: 'GET', headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_audit_${crypto.randomUUID()}`;
  const propertyId = `prop_audit_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Audit Org', owner)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, owner);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Guest', {
    kind: 'user',
    userId: owner,
  });
  return { orgId, propertyId, owner, guestRef: guest.guestRef, arrival, stub: resolved!.stub };
}

describe('audit-log matrix', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: cash payment leaves audit row with actor and command_id', async () => {
    const owner = 'user_audit_1';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_audit_1';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const paymentId = `pay_audit_1_${crypto.randomUUID()}`;
    expect((await postCash(propertyId, owner, reservationId, { paymentId, amountMinor: 1500 })).status).toBe(
      201,
    );

    const res = await getAuditLog(propertyId, owner, { reservationId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      rows: Array<{
        actor: string;
        commandId: string;
        entityType: string;
        entityId: string;
        afterJson: Record<string, unknown>;
      }>;
    };
    const row = body.rows.find((r) => r.entityId === paymentId);
    expect(row).toMatchObject({
      actor: owner,
      commandId: 'folio.record_cash_payment',
      entityType: 'payment',
    });
    expect(row!.afterJson.tenderType).toBe('CASH');
    expect(row!.afterJson).not.toHaveProperty('email');
    expect(row!.afterJson).not.toHaveProperty('name');
  });

  it('Test 2: same-txn canary — audit fault rolls back cash payment', async () => {
    // Moving appendAuditLogSync outside transactionSync makes this fail:
    // payment would survive while audit throws.
    const owner = 'user_audit_txn';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_audit_txn';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await stub.setAuditAppendFaultForTest(true);
    const paymentId = `pay_fault_${crypto.randomUUID()}`;
    const cashRes = await postCash(propertyId, owner, reservationId, {
      paymentId,
      amountMinor: 900,
    });
    expect(cashRes.status).toBeGreaterThanOrEqual(400);
    await stub.setAuditAppendFaultForTest(false);

    const payment = await stub.readPayment(paymentId);
    expect(payment.ok).toBe(false);

    const audit = await stub.listAuditLog({ kind: 'user', userId: owner }, { reservationId });
    expect(audit).toMatchObject({ ok: true });
    const rows = (audit as unknown as { ok: true; rows: Array<{ entityId: string }> }).rows;
    expect(rows.find((r) => r.entityId === paymentId)).toBeUndefined();
  });

  it('Test 3: per-cashier filter returns shift-attributed rows', async () => {
    const owner = 'user_audit_3';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_audit_3';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const shiftId = `shift_audit_3_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 1000 })).status).toBe(201);
    const paymentId = `pay_audit_3_${crypto.randomUUID()}`;
    expect((await postCash(propertyId, owner, reservationId, { paymentId, amountMinor: 500 })).status).toBe(
      201,
    );

    const byShift = await getAuditLog(propertyId, owner, { shiftId });
    expect(byShift.status).toBe(200);
    const shiftBody = (await byShift.json()) as { rows: Array<{ entityId: string }> };
    expect(shiftBody.rows.some((r) => r.entityId === paymentId)).toBe(true);

    const other = await getAuditLog(propertyId, owner, { actor: 'user_nobody' });
    expect(other.status).toBe(200);
    const otherBody = (await other.json()) as { rows: unknown[] };
    expect(otherBody.rows).toHaveLength(0);
  });

  it('Test 4: force-close writes system:night_audit row with FORCE_CLOSED', async () => {
    const owner = 'user_audit_4';
    const { propertyId, stub } = await provisionHotel(owner);
    const shiftId = `shift_audit_4_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 0 })).status).toBe(201);

    const businessDate = (await stub.readShift(shiftId)).ok
      ? ((await stub.readShift(shiftId)) as { ok: true; shift: { businessDate: string } }).shift
          .businessDate
      : '';
    expect(businessDate).toBeTruthy();
    await stub.runAuditStep(businessDate, 'CLOSE_CASHIER_SHIFTS');

    const res = await getAuditLog(propertyId, owner, { shiftId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ actor: string; commandId: string; afterJson: { status?: string } }>;
    };
    const force = body.rows.find((r) => r.commandId === 'night_audit.run');
    expect(force).toMatchObject({
      actor: 'system:night_audit',
      commandId: 'night_audit.run',
    });
    expect(force!.afterJson.status).toBe('FORCE_CLOSED');
  });

  it('Test 5: kill-switch 503 and unentitled 402 on GET audit-log', async () => {
    const killOwner = 'user_audit_5k';
    const { propertyId } = await provisionHotel(killOwner);
    await setKillSwitch(env, 'pms.core', true);
    expect((await getAuditLog(propertyId, killOwner)).status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    const unentOwner = 'user_audit_5u';
    const { orgId, propertyId: unentProp } = await provisionHotel(unentOwner);
    await cancelSubscription(env, orgId);
    expect((await getAuditLog(unentProp, unentOwner)).status).toBe(402);
  });
});
