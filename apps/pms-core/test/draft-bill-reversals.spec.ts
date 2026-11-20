import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CHECK_OUT_NOT_TODAY,
  FOLIO_TRANSFER_BULK_MAX,
  FORBIDDEN,
  INVOICE_ALREADY_EXISTS,
  INVALID_VOID_REASON,
  LIMIT_EXCEEDED,
  ROOM_ALREADY_ASSIGNED,
  TRANSFER_CROSS_RESERVATION,
  fingerprintPayload,
} from '@hospai/contracts';
import { allocate } from '@hospai/money';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do.js';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

async function provisionedPropertyWithGuest(name: string): Promise<{
  stub: DurableObjectStub<PropertyDO>;
  guestRef: string;
  propertyId: string;
  orgId: string;
}> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef, propertyId: name, orgId };
}

async function registerPropertyForHttp(propertyId: string, orgId: string): Promise<void> {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'Draft Bill Reversals Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function stayCheckedIn(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  await stub.flushOutbox();
}

async function generateInvoice(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const guestWindowId = `${reservationId}:GUEST`;
  const gen = await stub.tryGenerateInvoice(
    TEST_OWNER_ACTOR,
    { reservationId, folioWindowId: guestWindowId },
    await idemFor(`gen-${reservationId}`, { reservationId, folioWindowId: guestWindowId }),
  );
  expect(gen).toMatchObject({ ok: true });
  if (!gen.ok) throw new Error('generate invoice failed');
  return { invoiceId: gen.invoiceId, invoiceNumber: gen.invoiceNumber };
}

async function postInvoiceVoid(
  propertyId: string,
  actor: string,
  invoiceId: string,
  body?: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-void-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

async function postFolioRefund(
  propertyId: string,
  actor: string,
  paymentId: string,
  body: { amountMinor: number; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

type AuditRowShape = { commandId: string };
function auditRows(a: unknown): AuditRowShape[] {
  return (a as { ok: true; rows: AuditRowShape[] }).rows;
}

describe('invoice.void (R4.29 D4/D5)', () => {
  it('without folio:reverse → forbidden (403 path)', async () => {
    const propertyId = `dbr-void-forbid-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId);
    await registerPropertyForHttp(propertyId, orgId);
    await orgStub(orgId).ensureMember('user_staff_void', 'staff');
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_forbid';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_forbid',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    const { invoiceId } = await generateInvoice(stub, reservationId);

    const staff = { kind: 'user' as const, userId: 'user_staff_void' };
    const deniedDo = await stub.tryVoidInvoice(
      staff,
      { invoiceId, reason: 'staff-void-attempt' },
      await idemFor('void-staff-do', { invoiceId, reason: 'staff-void-attempt' }),
    );
    expect(deniedDo).toMatchObject({ ok: false, error: FORBIDDEN });

    const deniedHttp = await postInvoiceVoid(propertyId, 'user_staff_void', invoiceId, {
      reason: 'staff-void-attempt',
    });
    expect(deniedHttp.status).toBe(403);
    expect(await deniedHttp.json()).toMatchObject({
      error: 'forbidden',
      permission: 'folio:reverse',
    });

    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.find((r) => r.invoiceId === invoiceId)?.voidedAt).toBeNull();
  });

  it('without reason → INVALID_VOID_REASON', async () => {
    const propertyId = `dbr-void-noreason-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_noreason';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_noreason',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    const { invoiceId } = await generateInvoice(stub, reservationId);

    const omitted = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId } as { invoiceId: string; reason: string },
      await idemFor('void-omit', { invoiceId }),
    );
    expect(omitted).toMatchObject({ ok: false, error: INVALID_VOID_REASON });

    const blank = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId, reason: '   ' },
      await idemFor('void-blank', { invoiceId, reason: '   ' }),
    );
    expect(blank).toMatchObject({ ok: false, error: INVALID_VOID_REASON });

    const httpOmit = await postInvoiceVoid(propertyId, 'user_owner', invoiceId);
    expect(httpOmit.status).toBe(422);
    expect(await httpOmit.json()).toMatchObject({ ok: false, error: INVALID_VOID_REASON });

    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.find((r) => r.invoiceId === invoiceId)?.voidedAt).toBeNull();
  });

  it('with folio:reverse + reason → void; regenerate takes new number', async () => {
    const propertyId = `dbr-void-ok-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_ok';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_ok',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    const first = await generateInvoice(stub, reservationId);
    expect(first.invoiceNumber).toBe('INV-000001');

    const voided = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: first.invoiceId, reason: 'test-void' },
      await idemFor('void-ok', { invoiceId: first.invoiceId, reason: 'test-void' }),
    );
    expect(voided).toMatchObject({ ok: true, invoiceId: first.invoiceId });

    const guestWindowId = `${reservationId}:GUEST`;
    const second = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen-ok-2', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(second).toMatchObject({ ok: true, invoiceNumber: 'INV-000002' });
    if (!second.ok) return;
    expect(second.invoiceId).not.toBe(first.invoiceId);
  });
});

describe('draft bill read (R4.29 D1/D2 §4.1)', () => {
  it('draft changes nothing: folio/invoice counter/audit byte-equal; tariff states + mismatch', async () => {
    const propertyId = `dbr-draft-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const d0 = arrival;
    const d1 = addCalendarDays(arrival, 1);
    const d2 = addCalendarDays(arrival, 2);
    const departure = addCalendarDays(arrival, 3);
    const reservationId = 'res_dbr_draft';

    await stayCheckedIn(stub, guestRef, reservationId, 'rm_dbr_draft', arrival, departure);

    expect((await stub.runAuditStep(d0, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    await stub.setBusinessDateForTest(d2);

    // Alter snapshotted rate for the posted night so expected ≠ posted ROOM.
    await stub.execSqlForTest(
      `UPDATE reservation_rate_night SET amount_minor = 15000 WHERE reservation_id = ? AND stay_date = ?`,
      reservationId,
      d0,
    );

    // Settle posted ROOM so invoice.generate is allowed (balance gate).
    const payBody = { paymentId: `pay_${reservationId}`, reservationId, amountMinor: 10_000 };
    const pay = await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
      ...payBody,
      idempotencyKey: `pay-${reservationId}`,
      requestFingerprint: await fingerprintPayload(payBody),
    });
    expect(pay).toMatchObject({ ok: true });

    const { invoiceId, invoiceNumber } = await generateInvoice(stub, reservationId);
    expect(invoiceNumber).toBe('INV-000001');

    const folioBefore = JSON.stringify(await stub.listFolioLinesForReservation(reservationId));
    const ratesBefore = JSON.stringify(await stub.listReservationRateNightsForTest(reservationId));
    const invoicesBefore = JSON.stringify(await stub.readInvoicesForReservation(reservationId));
    const auditBefore = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 500 });
    expect(auditBefore.ok).toBe(true);
    if (!auditBefore.ok) throw new Error('audit before');
    const auditBeforeJson = JSON.stringify(auditRows(auditBefore));

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/draft-bill`,
        { method: 'GET', headers: { 'x-dev-actor': 'user_owner' } },
      ),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      reservationId: string;
      status: string;
      guestDisplayName: string | null;
      chargeReview: Array<{ chargeCode: string; baseMinor: number }>;
      tariffCheck: Array<{
        stayDate: string;
        state: string;
        expectedRoomMinor: number;
        postedRoomNetMinor: number;
        mismatch: boolean;
      }>;
      totals: {
        postedChargesMinor: number;
        futureEstimateMinor: number;
        advancePaidMinor: number;
        balanceNowMinor: number;
        projectedBalanceMinor: number;
      };
      invoice: { invoiceNumber: string; generatedAt: number } | null;
    };
    expect(body).toMatchObject({
      ok: true,
      reservationId,
      status: 'checked_in',
      guestDisplayName: 'Test Guest',
      invoice: { invoiceNumber },
    });
    expect(body.invoice?.generatedAt).toEqual(expect.any(Number));

    expect(JSON.stringify(await stub.listFolioLinesForReservation(reservationId))).toBe(folioBefore);
    expect(JSON.stringify(await stub.listReservationRateNightsForTest(reservationId))).toBe(ratesBefore);
    expect(JSON.stringify(await stub.readInvoicesForReservation(reservationId))).toBe(invoicesBefore);
    const auditAfter = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 500 });
    expect(auditAfter.ok).toBe(true);
    if (!auditAfter.ok) throw new Error('audit after');
    expect(JSON.stringify(auditRows(auditAfter))).toBe(auditBeforeJson);

    // Invoice counter unchanged: void + regenerate still takes INV-000002 (not skipped).
    const voided = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId, reason: 'counter-probe' },
      await idemFor('void-draft-probe', { invoiceId, reason: 'counter-probe' }),
    );
    expect(voided).toMatchObject({ ok: true });
    const guestWindowId = `${reservationId}:GUEST`;
    const regen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen-draft-probe', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(regen).toMatchObject({ ok: true, invoiceNumber: 'INV-000002' });

    const byDate = Object.fromEntries(body.tariffCheck.map((row) => [row.stayDate, row]));
    expect(byDate[d0]).toMatchObject({
      state: 'posted',
      expectedRoomMinor: 15_000,
      postedRoomNetMinor: 10_000,
      mismatch: true,
    });
    expect(byDate[d1]).toMatchObject({
      state: 'unposted',
      postedRoomNetMinor: 0,
      mismatch: false,
    });
    expect(byDate[d2]).toMatchObject({
      state: 'future',
      postedRoomNetMinor: 0,
      mismatch: false,
    });
    expect(body.tariffCheck).toHaveLength(3);

    expect(body.chargeReview.some((g) => g.chargeCode === 'ROOM' && g.baseMinor === 10_000)).toBe(true);
    expect(body.totals.projectedBalanceMinor).toBe(
      body.totals.balanceNowMinor + body.totals.futureEstimateMinor,
    );
  });
});

async function seedStayReservation(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
): Promise<string> {
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

async function seedCityLedger(
  stub: DurableObjectStub<PropertyDO>,
  name: string,
  idemSuffix: string,
) {
  expect(
    await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name },
      await idemFor(`cla-${idemSuffix}`, { name }),
    ),
  ).toMatchObject({ ok: true });
}

async function seedRoomTaxRule(stub: DurableObjectStub<PropertyDO>, validFrom: string) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `room_sales_${crypto.randomUUID()}`,
    name: 'Room tax',
    ruleType: 'PERCENTAGE' as const,
    rate: '0.10',
    taxGroup: 'ROOM',
    outputChargeCode: 'TAX',
    validFrom,
  };
  expect(
    (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(`tax-${taxInput.taxRuleId}`, taxInput)))
      .ok,
  ).toBe(true);
}

async function openCompanyWindow(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  billedParty: string,
  idemSuffix: string,
): Promise<string> {
  await seedCityLedger(stub, billedParty, idemSuffix);
  const open = await stub.tryOpenFolioWindow(
    TEST_OWNER_ACTOR,
    { reservationId, kind: 'COMPANY', billedParty },
    await idemFor(`open-${idemSuffix}`, { reservationId, kind: 'COMPANY', billedParty }),
  );
  expect(open).toMatchObject({ ok: true });
  if (!open.ok) throw new Error('open company window failed');
  return open.folioWindowId;
}

async function postFolioTransferBulk(
  propertyId: string,
  body: { folioLineIds: string[]; destinationFolioWindowId: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_owner' },
      body: JSON.stringify({
        folioLineIds: body.folioLineIds,
        destinationFolioWindowId: body.destinationFolioWindowId,
        idempotencyKey: body.idempotencyKey ?? `idem-bulk-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

describe('folio.transfer_charges (D3)', () => {
  it('moves N lines + tax all-or-nothing; one bad line rolls back all', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_bulk_${crypto.randomUUID()}`;
    const arrival = await seedStayReservation(stub, reservationId);
    await seedRoomTaxRule(stub, arrival);

    const lineA = `${reservationId}:a_misc`;
    const lineB = `${reservationId}:b_misc`;
    const roomId = `${reservationId}:c_room`;
    for (const [folioLineId, chargeCode, amountMinor] of [
      [lineA, 'MISC', 1000],
      [lineB, 'MISC', 2000],
      [roomId, 'ROOM', 5000],
    ] as const) {
      const line = { folioLineId, reservationId, chargeCode, amountMinor };
      expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(`add-${folioLineId}`, line))).toMatchObject(
        { ok: true },
      );
    }
    const taxLine = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX' && l.taxOf === roomId,
    );
    expect(taxLine).toBeTruthy();

    const destWindowId = await openCompanyWindow(stub, reservationId, 'BulkCo', 'bulk-ok');
    const countBefore = (await stub.listFolioLinesForReservation(reservationId)).length;

    const badIds = [lineA, lineB, taxLine!.folioLineId].sort();
    const bad = await stub.tryTransferCharges(
      TEST_OWNER_ACTOR,
      { folioLineIds: badIds, destinationFolioWindowId: destWindowId },
      await idemFor('bulk-bad', { folioLineIds: badIds, destinationFolioWindowId: destWindowId }),
    );
    expect(bad).toMatchObject({ ok: false, error: 'line_not_transferable' });
    expect((await stub.listFolioLinesForReservation(reservationId)).length).toBe(countBefore);
    expect((await stub.listFolioLinesForReservation(reservationId)).filter((l) => l.source === 'TRANSFER')).toHaveLength(
      0,
    );

    const goodIds = [lineA, lineB].sort();
    const ok = await stub.tryTransferCharges(
      TEST_OWNER_ACTOR,
      { folioLineIds: goodIds, destinationFolioWindowId: destWindowId },
      await idemFor('bulk-ok', { folioLineIds: goodIds, destinationFolioWindowId: destWindowId }),
    );
    expect(ok).toMatchObject({ ok: true });
    if (!ok.ok) throw new Error('bulk transfer failed');
    expect(ok.results).toHaveLength(2);

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.source === 'TRANSFER' && l.chargeCode === 'MISC')).toHaveLength(2);
    expect(lines.filter((l) => l.source === 'TRANSFER_REVERSAL' && l.chargeCode === 'MISC')).toHaveLength(2);
  });

  it('over 50 → 422 limit_exceeded at HTTP and RPC', async () => {
    const propertyId = `dbr-bulk-cap-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    await registerPropertyForHttp(propertyId, orgId);
    const reservationId = `res_cap_${crypto.randomUUID()}`;
    await seedStayReservation(stub, reservationId);
    const destWindowId = await openCompanyWindow(stub, reservationId, 'CapCo', 'cap');

    const overIds = Array.from({ length: FOLIO_TRANSFER_BULK_MAX + 1 }, (_, i) => `line_${String(i).padStart(3, '0')}`);
    const rpc = await stub.tryTransferCharges(
      TEST_OWNER_ACTOR,
      { folioLineIds: overIds, destinationFolioWindowId: destWindowId },
      await idemFor('bulk-cap-rpc', { folioLineIds: overIds, destinationFolioWindowId: destWindowId }),
    );
    expect(rpc).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    const http = await postFolioTransferBulk(propertyId, {
      folioLineIds: overIds,
      destinationFolioWindowId: destWindowId,
    });
    expect(http.status).toBe(422);
    expect(await http.json()).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });
  });

  it('cross-reservation destination → transfer_cross_reservation', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const resA = `res_a_${crypto.randomUUID()}`;
    const resB = `res_b_${crypto.randomUUID()}`;
    await seedStayReservation(stub, resA);
    await seedStayReservation(stub, resB);
    const sourceId = `${resA}:misc`;
    const line = { folioLineId: sourceId, reservationId: resA, chargeCode: 'MISC', amountMinor: 400 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('bulk-xa', line))).toMatchObject({
      ok: true,
    });
    const destB = await openCompanyWindow(stub, resB, 'OtherStay', 'bulk-x');
    const folioLineIds = [sourceId];
    expect(
      await stub.tryTransferCharges(
        TEST_OWNER_ACTOR,
        { folioLineIds, destinationFolioWindowId: destB },
        await idemFor('bulk-x', { folioLineIds, destinationFolioWindowId: destB }),
      ),
    ).toMatchObject({ ok: false, error: TRANSFER_CROSS_RESERVATION });
  });

  it('replay → one move', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_replay_${crypto.randomUUID()}`;
    await seedStayReservation(stub, reservationId);
    const sourceId = `${reservationId}:misc`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 700 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('bulk-rep-line', line))).toMatchObject({
      ok: true,
    });
    const destWindowId = await openCompanyWindow(stub, reservationId, 'ReplayCo', 'bulk-rep');
    const folioLineIds = [sourceId];
    const payload = { folioLineIds, destinationFolioWindowId: destWindowId };
    const idem = await idemFor('bulk-rep', payload);
    expect(await stub.tryTransferCharges(TEST_OWNER_ACTOR, payload, idem)).toMatchObject({ ok: true });
    expect(await stub.tryTransferCharges(TEST_OWNER_ACTOR, payload, idem)).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.source === 'TRANSFER')).toHaveLength(1);
    expect(lines.filter((l) => l.source === 'TRANSFER_REVERSAL')).toHaveLength(1);
  });
});

describe('equal split footing (D3)', () => {
  it('1000 split 3 ways via allocate foots; tax re-splits', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_eq_${crypto.randomUUID()}`;
    const arrival = await seedStayReservation(stub, reservationId);
    await seedRoomTaxRule(stub, arrival);

    const sourceId = `${reservationId}:room`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 1000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('eq-room', room))).toMatchObject({
      ok: true,
    });
    const before = await stub.readFolio(reservationId);
    expect(before.ok).toBe(true);

    const parts = allocate(1000, [1, 1, 1], { policy: 'LAST' });
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);

    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'eq_a', amountMinor: parts[0]! },
        { folioLineId: 'eq_b', amountMinor: parts[1]! },
        { folioLineId: 'eq_c', amountMinor: parts[2]! },
      ],
    };
    expect(
      await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('eq-split', split)),
    ).toMatchObject({ ok: true });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === `${sourceId}:split-rev`)?.amountMinor).toBe(-1000);
    expect(lines.find((l) => l.folioLineId === 'eq_a')?.amountMinor).toBe(333);
    expect(lines.find((l) => l.folioLineId === 'eq_b')?.amountMinor).toBe(333);
    expect(lines.find((l) => l.folioLineId === 'eq_c')?.amountMinor).toBe(334);

    const childTax = lines.filter(
      (l) => l.source === 'TAX' && (l.taxOf === 'eq_a' || l.taxOf === 'eq_b' || l.taxOf === 'eq_c'),
    );
    expect(childTax).toHaveLength(3);
    expect(childTax.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(100);

    const after = await stub.readFolio(reservationId);
    expect(after.ok && after.balanceMinor).toBe(before.ok ? before.balanceMinor : 0);
  });
});

describe('F1', () => {
  it('transfer_charge and transfer_charges to another reservation → transfer_cross_reservation', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const resA = `res_f1a_${crypto.randomUUID()}`;
    const resB = `res_f1b_${crypto.randomUUID()}`;
    await seedStayReservation(stub, resA);
    await seedStayReservation(stub, resB);

    const singleId = `${resA}:single`;
    const bulkId = `${resA}:bulk`;
    for (const folioLineId of [singleId, bulkId]) {
      const line = { folioLineId, reservationId: resA, chargeCode: 'MISC', amountMinor: 500 };
      expect(
        await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(`f1-${folioLineId}`, line)),
      ).toMatchObject({ ok: true });
    }
    const destB = await openCompanyWindow(stub, resB, 'F1Co', 'f1');

    expect(
      await stub.tryTransferCharge(
        TEST_OWNER_ACTOR,
        { sourceFolioLineId: singleId, destinationFolioWindowId: destB },
        await idemFor('f1-single', { sourceFolioLineId: singleId, destinationFolioWindowId: destB }),
      ),
    ).toMatchObject({ ok: false, error: TRANSFER_CROSS_RESERVATION });

    const folioLineIds = [bulkId];
    expect(
      await stub.tryTransferCharges(
        TEST_OWNER_ACTOR,
        { folioLineIds, destinationFolioWindowId: destB },
        await idemFor('f1-bulk', { folioLineIds, destinationFolioWindowId: destB }),
      ),
    ).toMatchObject({ ok: false, error: TRANSFER_CROSS_RESERVATION });
  });
});

const OPEN_FOLIO_ENABLED = {
  enabled: true,
  followUpDays: 3,
  closeByDays: 14,
  autoOpenOnDepartWithBalance: false,
  autoCloseAtZeroAfterDays: null,
} as const;

async function postUndoCheckOut(
  propertyId: string,
  reservationId: string,
  actor: string,
  body: { reason: string },
  idempotencyKey?: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/undo-check-out`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': actor,
          'x-idempotency-key': idempotencyKey ?? `idem-undo-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function checkoutStay(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  suffix: string,
) {
  expect(
    await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor(`co-${suffix}`, { reservationId }),
    ),
  ).toMatchObject({ ok: true });
}

describe('undo check-out (D6)', () => {
  it('same-day → checked_in; CLOSED GUEST reopens', async () => {
    const propertyId = `dbr-undo-same-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_undo_same';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_undo_same',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);
    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'open through depart' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'open through depart' }),
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('place hold failed');

    await checkoutStay(stub, reservationId, reservationId);
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${reservationId}:GUEST` },
        await idemFor(`close-${reservationId}`, { folioWindowId: `${reservationId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readFolioWindowForTest(`${reservationId}:GUEST`)).toMatchObject({
      status: 'CLOSED',
    });
    expect(await stub.readFolioHoldByIdForTest(placed.holdId)).toMatchObject({
      status: 'CLOSED',
      endedReason: 'window_closed',
    });

    const reason = 'guest returned for late charge';
    const undo = await stub.tryUndoCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId, reason },
      await idemFor(`undo-${reservationId}`, { reservationId, reason }),
    );
    expect(undo).toMatchObject({ ok: true });

    expect(await stub.getReservationStatus(reservationId)).toBe('checked_in');
    const res = await stub.readReservation(reservationId);
    expect(res).toMatchObject({ ok: true, reservation: { roomId: 'rm_dbr_undo_same', status: 'checked_in' } });
    expect(await stub.readFolioWindowForTest(`${reservationId}:GUEST`)).toMatchObject({
      status: 'OPEN',
      closedAt: null,
    });
    expect(await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`)).toMatchObject({
      holdId: placed.holdId,
      status: 'ACTIVE',
    });
    const events = await stub.listFolioHoldEventsForTest(placed.holdId);
    expect(events.map((e) => e.kind)).toEqual(['placed', 'closed', 'reactivated']);

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 100 });
    expect(audit.ok).toBe(true);
    if (!audit.ok) throw new Error('audit');
    expect(auditRows(audit).some((r) => r.commandId === 'reservations.undo_check_out')).toBe(true);
  });

  it('active invoice → invoice_already_exists', async () => {
    const propertyId = `dbr-undo-inv-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_undo_inv';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_undo_inv',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    await generateInvoice(stub, reservationId);
    await checkoutStay(stub, reservationId, reservationId);

    const reason = 'reopen with bill';
    expect(
      await stub.tryUndoCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, reason },
        await idemFor(`undo-inv-${reservationId}`, { reservationId, reason }),
      ),
    ).toMatchObject({ ok: false, error: INVOICE_ALREADY_EXISTS });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
  });

  it('earlier-day checkout → check_out_not_today', async () => {
    const propertyId = `dbr-undo-old-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_undo_old';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_undo_old',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    await checkoutStay(stub, reservationId, reservationId);
    await stub.setBusinessDateForTest(addCalendarDays(added.fromDate, 1));

    const reason = 'too late';
    expect(
      await stub.tryUndoCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, reason },
        await idemFor(`undo-old-${reservationId}`, { reservationId, reason }),
      ),
    ).toMatchObject({ ok: false, error: CHECK_OUT_NOT_TODAY });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
  });

  it('room occupied by another stay → existing room error; nothing changes', async () => {
    const propertyId = `dbr-undo-room-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 2);
    const reservationId = 'res_dbr_undo_room_a';
    const otherId = 'res_dbr_undo_room_b';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_dbr_shared', arrival, departure);
    await checkoutStay(stub, reservationId, reservationId);

    const create = {
      reservationId: otherId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${otherId}`, create)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: otherId, roomId: 'rm_dbr_shared', overrideCleanliness: true },
        await idemFor(`ci-${otherId}`, {
          reservationId: otherId,
          roomId: 'rm_dbr_shared',
          overrideCleanliness: true,
        }),
      ),
    ).toMatchObject({ ok: true });

    const reason = 'room taken';
    expect(
      await stub.tryUndoCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, reason },
        await idemFor(`undo-room-${reservationId}`, { reservationId, reason }),
      ),
    ).toMatchObject({ ok: false, error: ROOM_ALREADY_ASSIGNED });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
    expect(await stub.getReservationStatus(otherId)).toBe('checked_in');
  });

  it('replay → one transition', async () => {
    const propertyId = `dbr-undo-rep-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_undo_rep';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_undo_rep',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    await checkoutStay(stub, reservationId, reservationId);

    const reason = 'replay undo';
    const payload = { reservationId, reason };
    const idem = await idemFor(`undo-rep-${reservationId}`, payload);
    expect(await stub.tryUndoCheckOut(TEST_OWNER_ACTOR, payload, idem)).toMatchObject({ ok: true });
    expect(await stub.tryUndoCheckOut(TEST_OWNER_ACTOR, payload, idem)).toMatchObject({ ok: true });

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 100 });
    expect(audit.ok).toBe(true);
    if (!audit.ok) throw new Error('audit');
    expect(auditRows(audit).filter((r) => r.commandId === 'reservations.undo_check_out')).toHaveLength(1);
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_in');
  });

  it('without folio:reverse → forbidden', async () => {
    const propertyId = `dbr-undo-forbid-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId);
    await registerPropertyForHttp(propertyId, orgId);
    await orgStub(orgId).ensureMember('user_staff_undo', 'staff');
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_undo_forbid';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_undo_forbid',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );
    await checkoutStay(stub, reservationId, reservationId);

    const reason = 'staff attempt';
    const staff = { kind: 'user' as const, userId: 'user_staff_undo' };
    expect(
      await stub.tryUndoCheckOut(
        staff,
        { reservationId, reason },
        await idemFor(`undo-staff-${reservationId}`, { reservationId, reason }),
      ),
    ).toMatchObject({ ok: false, error: FORBIDDEN });

    const deniedHttp = await postUndoCheckOut(propertyId, reservationId, 'user_staff_undo', { reason });
    expect(deniedHttp.status).toBe(403);
    expect(await deniedHttp.json()).toMatchObject({
      error: 'forbidden',
      permission: 'folio:reverse',
    });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
  });

  it('availability_day unchanged', async () => {
    const propertyId = `dbr-undo-avail-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = 'res_dbr_undo_avail';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_dbr_undo_avail', arrival, addCalendarDays(arrival, 1));
    await checkoutStay(stub, reservationId, reservationId);

    const before = await stub.readAvailabilityDay('rt_king', arrival);
    expect(before).toBeTruthy();
    const reason = 'avail probe';
    expect(
      await stub.tryUndoCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, reason },
        await idemFor(`undo-avail-${reservationId}`, { reservationId, reason }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readAvailabilityDay('rt_king', arrival)).toEqual(before);
  });
});

describe('settlement cancel sequence (D8 via HTTP)', () => {
  it('cash refund posts once on replay with same key; balance returns', async () => {
    const propertyId = `dbr-settle-cancel-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_dbr_settle';
    await stayCheckedIn(
      stub,
      guestRef,
      reservationId,
      'rm_dbr_settle',
      added.fromDate,
      addCalendarDays(added.fromDate, 1),
    );

    const amountMinor = 5_000;
    const charge = {
      folioLineId: `${reservationId}:misc`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor(`ch-${reservationId}`, charge)),
    ).toMatchObject({ ok: true });

    const paymentId = `pay_${reservationId}`;
    const payBody = { paymentId, reservationId, amountMinor };
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        ...payBody,
        idempotencyKey: `cash-${reservationId}`,
        requestFingerprint: await fingerprintPayload(payBody),
      }),
    ).toMatchObject({ ok: true });

    const { invoiceId } = await generateInvoice(stub, reservationId);
    await checkoutStay(stub, reservationId, reservationId);
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');

    const folioBeforeRefund = await stub.readFolio(reservationId);
    expect(folioBeforeRefund.ok && folioBeforeRefund.balanceMinor).toBe(0);

    const voidOpId = `settlement-cancel:${reservationId}:void:${crypto.randomUUID()}`;
    const voided = await postInvoiceVoid(propertyId, 'user_owner', invoiceId, {
      reason: 'cancel settlement',
      idempotencyKey: voidOpId,
    });
    expect(voided.status, await voided.clone().text()).toBe(200);
    expect(await voided.json()).toMatchObject({ ok: true, invoiceId });
    expect(
      (await stub.readInvoicesForReservation(reservationId)).find((r) => r.invoiceId === invoiceId)?.voidedAt,
    ).toEqual(expect.any(Number));

    const refundOpId = `settlement-cancel:${reservationId}:refund:${paymentId}:${crypto.randomUUID()}`;
    const refundBody = { amountMinor, idempotencyKey: refundOpId };
    const refunded = await postFolioRefund(propertyId, 'user_owner', paymentId, refundBody);
    expect(refunded.status, await refunded.clone().text()).toBe(200);
    expect(await refunded.json()).toMatchObject({
      ok: true,
      paymentId,
      status: 'refunded',
      refundedAmountMinor: amountMinor,
    });

    const replay = await postFolioRefund(propertyId, 'user_owner', paymentId, refundBody);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toMatchObject({
      ok: true,
      paymentId,
      status: 'refunded',
      refundedAmountMinor: amountMinor,
    });

    const refundLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'PAYMENT_REFUND',
    );
    expect(refundLines).toHaveLength(1);
    expect(refundLines[0]?.folioLineId).toBe(`${paymentId}:refund:1`);

    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceMinor).toBe(amountMinor);
  });
});

describe('hold reactivation (D7)', () => {
  it('CLOSED window_closed → reopen → ACTIVE + reactivated event; RELEASED stays released', async () => {
    const propertyId = `dbr-hold-re-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;

    const closedId = 'res_dbr_hold_closed';
    await stayCheckedIn(stub, guestRef, closedId, 'rm_dbr_hold_c', arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);
    const closedHold = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId: closedId, reason: 'settle later' },
      await idemFor(`place-c-${closedId}`, { reservationId: closedId, reason: 'settle later' }),
    );
    expect(closedHold).toMatchObject({ ok: true });
    if (!closedHold.ok) throw new Error('place closed hold failed');
    await checkoutStay(stub, closedId, closedId);
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${closedId}:GUEST` },
        await idemFor(`close-c-${closedId}`, { folioWindowId: `${closedId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      await stub.tryReopenFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${closedId}:GUEST` },
        await idemFor(`reopen-c-${closedId}`, { folioWindowId: `${closedId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readActiveFolioHoldForTest(`${closedId}:GUEST`)).toMatchObject({
      holdId: closedHold.holdId,
      status: 'ACTIVE',
    });
    expect((await stub.listFolioHoldEventsForTest(closedHold.holdId)).map((e) => e.kind)).toEqual([
      'placed',
      'closed',
      'reactivated',
    ]);

    const releasedId = 'res_dbr_hold_rel';
    await stayCheckedIn(
      stub,
      guestRef,
      releasedId,
      'rm_dbr_hold_r',
      arrival,
      addCalendarDays(arrival, 1),
    );
    const releasedHold = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId: releasedId, reason: 'will release' },
      await idemFor(`place-r-${releasedId}`, { reservationId: releasedId, reason: 'will release' }),
    );
    expect(releasedHold).toMatchObject({ ok: true });
    if (!releasedHold.ok) throw new Error('place released hold failed');
    expect(
      await stub.tryReleaseFolioHold(
        TEST_OWNER_ACTOR,
        { reservationId: releasedId, reason: 'settled at desk' },
        await idemFor(`rel-${releasedId}`, { reservationId: releasedId, reason: 'settled at desk' }),
      ),
    ).toMatchObject({ ok: true });
    await checkoutStay(stub, releasedId, releasedId);
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${releasedId}:GUEST` },
        await idemFor(`close-r-${releasedId}`, { folioWindowId: `${releasedId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryReopenFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${releasedId}:GUEST` },
        await idemFor(`reopen-r-${releasedId}`, { folioWindowId: `${releasedId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readActiveFolioHoldForTest(`${releasedId}:GUEST`)).toBeNull();
    expect(await stub.readFolioHoldByIdForTest(releasedHold.holdId)).toMatchObject({
      status: 'RELEASED',
      endedReason: 'settled at desk',
    });
    const releasedEvents = await stub.listFolioHoldEventsForTest(releasedHold.holdId);
    expect(releasedEvents).toHaveLength(2);
    expect(new Set(releasedEvents.map((e) => e.kind))).toEqual(new Set(['placed', 'released']));
  });
});

describe('draft bill nets reversal lines (R4.29 review)', () => {
  it('transfer + odd split across two windows: groups, posted charges and balance equal the ledger', async () => {
    const propertyId = `dbr-net-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = 'res_dbr_net';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_dbr_net', arrival, addCalendarDays(arrival, 2));
    await seedRoomTaxRule(stub, arrival);

    const misc = { folioLineId: `${reservationId}:xmisc`, reservationId, chargeCode: 'MISC', amountMinor: 3500 };
    const room = { folioLineId: `${reservationId}:xroom`, reservationId, chargeCode: 'ROOM', amountMinor: 1001 };
    for (const line of [misc, room]) {
      expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(`add-${line.folioLineId}`, line))).toMatchObject({
        ok: true,
      });
    }
    const companyId = await openCompanyWindow(stub, reservationId, 'NetCo', 'net');
    const ids = [misc.folioLineId];
    expect(
      await stub.tryTransferCharges(
        TEST_OWNER_ACTOR,
        { folioLineIds: ids, destinationFolioWindowId: companyId },
        await idemFor('net-xfer', { folioLineIds: ids, destinationFolioWindowId: companyId }),
      ),
    ).toMatchObject({ ok: true });

    const parts = allocate(1001, [1, 1, 1], { policy: 'LAST' });
    const guestWindowId = `${reservationId}:GUEST`;
    const split = {
      sourceFolioLineId: room.folioLineId,
      splits: [
        { folioLineId: 'net_a', amountMinor: parts[0]!, folioWindowId: guestWindowId },
        { folioLineId: 'net_b', amountMinor: parts[1]!, folioWindowId: guestWindowId },
        { folioLineId: 'net_c', amountMinor: parts[2]!, folioWindowId: companyId },
      ],
    };
    expect(await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('net-split', split))).toMatchObject({
      ok: true,
    });

    const folioBefore = JSON.stringify(await stub.listFolioLinesForReservation(reservationId));
    const draft = await stub.readReservationDraftBill(reservationId);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error('draft');
    expect(JSON.stringify(await stub.listFolioLinesForReservation(reservationId))).toBe(folioBefore);

    const all = await stub.listFolioLinesForReservation(reservationId);
    const nonPayment = all
      .filter((l) => l.chargeCode !== 'PAYMENT')
      .reduce((sum, l) => sum + l.ledgerAmountMinor, 0);
    const folio = await stub.readFolio(reservationId);
    if (!folio.ok) throw new Error('folio');
    const guestLedger = folio.windows.find((w) => w.folioWindowId === guestWindowId)!.balanceMinor;

    expect(draft.totals.postedChargesMinor).toBe(nonPayment);
    expect(draft.totals.balanceNowMinor).toBe(guestLedger);
    expect(draft.totals.projectedBalanceMinor).toBe(guestLedger + draft.totals.futureEstimateMinor);
    expect(draft.chargeReview.reduce((s, g) => s + g.totalMinor, 0)).toBe(nonPayment);
    // The moved MISC line nets to zero on GUEST and is hidden there.
    expect(draft.chargeReview.find((g) => g.folioWindowId === guestWindowId && g.chargeCode === 'MISC')).toBeUndefined();
    const companyMisc = draft.chargeReview.find((g) => g.folioWindowId === companyId && g.chargeCode === 'MISC');
    expect(companyMisc).toMatchObject({ lineCount: 1, baseMinor: 3500, windowKind: 'COMPANY', billedParty: 'NetCo' });
    // Split source is fully reversed: 2 children on GUEST, 1 on COMPANY.
    expect(draft.chargeReview.find((g) => g.folioWindowId === guestWindowId && g.chargeCode === 'ROOM')).toMatchObject({
      lineCount: 2,
      baseMinor: parts[0]! + parts[1]!,
    });
    expect(draft.chargeReview.find((g) => g.folioWindowId === companyId && g.chargeCode === 'ROOM')).toMatchObject({
      lineCount: 1,
      baseMinor: parts[2]!,
    });
  });

  it('inclusion plan: a posted night matches the room amount net of the included meal', async () => {
    const propertyId = `dbr-incl-${crypto.randomUUID()}`;
    const { stub, guestRef, propertyId: pid } = await provisionedPropertyWithGuest(propertyId);
    void pid;
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const fnb = { code: 'FNB', name: 'Restaurant' };
    expect(await stub.tryCreateChargeCode(TEST_OWNER_ACTOR, fnb, await idemFor('fnb-incl', fnb))).toMatchObject({
      ok: true,
    });
    const category = { categoryId: 'cat_fnb', name: 'Food', sortOrder: 1 };
    expect(await stub.tryCreateProductCategory(TEST_OWNER_ACTOR, category, await idemFor('cat-incl', category))).toMatchObject({
      ok: true,
    });
    const product = {
      productId: 'prod_bf',
      categoryId: 'cat_fnb',
      name: 'Breakfast',
      chargeCode: 'FNB',
      defaultAmountMinor: 3000,
    };
    expect(await stub.tryCreateProduct(TEST_OWNER_ACTOR, product, await idemFor('prod-incl', product))).toMatchObject({
      ok: true,
    });
    for (let i = 0; i < 4; i++) {
      await stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: 'CP',
        stayDate: addCalendarDays(arrival, i),
        amountMinor: 10_000,
        currency: 'USD',
      });
    }
    const plan = {
      ratePlanId: 'CP',
      code: 'CP',
      name: 'CP',
      inclusions: [
        { inclusionNo: 1, productId: 'prod_bf', amountMinor: 3000, basis: 'PER_ADULT' as const, priceMode: 'INCLUDED' as const },
      ],
    };
    const made = await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('plan-cp', plan));
    expect(made.ok, JSON.stringify(made)).toBe(true);

    const room = { roomId: 'rm_dbr_incl', roomTypeId: 'rt_king', code: 'dbr_incl' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('rm-incl', room))).toMatchObject({ ok: true });
    const reservationId = 'res_dbr_incl';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 3),
      adults: 1,
      children: 0,
      ratePlanId: 'CP',
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-incl', create))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId, roomId: room.roomId },
        await idemFor('ci-incl', { reservationId, roomId: room.roomId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    await stub.setBusinessDateForTest(addCalendarDays(arrival, 1));

    const draft = await stub.readReservationDraftBill(reservationId);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error('draft');
    const row = draft.tariffCheck.find((r) => r.stayDate === arrival)!;
    expect(row).toMatchObject({ state: 'posted', expectedRoomMinor: 7000, postedRoomNetMinor: 7000, mismatch: false });
  });
});
