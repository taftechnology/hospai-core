import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  FOLIO_BALANCE_DUE,
  fingerprintPayload,
  INVOICE_NUMBER_INVALID,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { insertProperty } from '../src/registry.js';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

async function configIdem(key: string, value: unknown, meta: { reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

async function putDomainConfig(
  stub: DurableObjectStub<PropertyDO>,
  key: string,
  value: unknown,
  reason = 'test',
) {
  const meta = { reason };
  return stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, value, meta, await configIdem(key, value, meta));
}

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{
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
  await stub.flushOutbox();
}

async function registerPropertyForHttp(propertyId: string, orgId: string): Promise<void> {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'Invoice Series Test Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

async function postCheckOut(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-out`,
      {
        method: 'POST',
        headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-co-${crypto.randomUUID()}` },
      },
    ),
    env,
  );
}

const HTTP_ACTOR = 'user_owner';

async function seedInvoiceFyStayRange(stub: DurableObjectStub<PropertyDO>, fromDate = '2026-03-01', nights = 35) {
  await seedBarRatesForHorizon(stub, 'rt_king', fromDate, nights);
  for (let i = 0; i < nights; i++) {
    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: addCalendarDays(fromDate, i),
      physical: 10,
    });
  }
}

describe('invoice series and config validation', () => {
  it('(a) tryPutDomainConfig prefix updates next continuous invoice number', async () => {
    const name = `inv-ser-a-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    expect(await putDomainConfig(stub, 'pms.invoice.prefix', 'AMR-', 'prefix for series a')).toMatchObject({
      ok: true,
    });
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_sera', 'rm_sera', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_sera';
    const guestWindowId = `${reservationId}:GUEST`;
    const gen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen-a', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(gen).toMatchObject({ ok: true, invoiceNumber: 'AMR-000001' });
  });

  it('(b) gst_financial_year counters per FY, invoiceDate from business date, R2 key encodes slash', async () => {
    const name = `inv-ser-b-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    expect(await putDomainConfig(stub, 'pms.invoice.series', 'gst_financial_year', 'gst series')).toMatchObject({
      ok: true,
    });
    expect(await putDomainConfig(stub, 'pms.invoice.date_rule', 'BUSINESS_DATE', 'business date rule')).toMatchObject({
      ok: true,
    });
    const added = await addRoomType(stub, 'rt_king', 8);
    await seedInvoiceFyStayRange(stub);

    await stub.setBusinessDateForTest('2026-03-31');
    await stayCheckedIn(stub, guestRef, 'res_serb1', 'rm_serb1', '2026-03-30', '2026-03-31');
    const win1 = 'res_serb1:GUEST';
    const gen1 = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_serb1', folioWindowId: win1 },
      await idemFor('gen-b1', { reservationId: 'res_serb1', folioWindowId: win1 }),
    );
    expect(gen1).toMatchObject({ ok: true });
    if (!gen1.ok) return;
    expect(gen1.invoiceNumber.endsWith('25-26/00001')).toBe(true);
    const obj1 = await env.EVENT_LOG_R2!.get(gen1.r2Key);
    const snap1 = JSON.parse(new TextDecoder().decode(await obj1!.arrayBuffer())) as { invoiceDate: string };
    expect(snap1.invoiceDate).toBe('2026-03-31');
    expect(gen1.r2Key).toContain('%2F');
    const r2NumberSegment = gen1.r2Key.slice(`invoices/${name}/`.length, -'.json'.length);
    expect(r2NumberSegment).not.toContain('/');
    expect(r2NumberSegment).toContain('%2F');

    await stub.setBusinessDateForTest('2026-04-01');
    await stayCheckedIn(stub, guestRef, 'res_serb2', 'rm_serb2', '2026-03-31', '2026-04-01');
    const win2 = 'res_serb2:GUEST';
    const gen2 = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_serb2', folioWindowId: win2 },
      await idemFor('gen-b2', { reservationId: 'res_serb2', folioWindowId: win2 }),
    );
    expect(gen2).toMatchObject({ ok: true });
    if (!gen2.ok) return;
    expect(gen2.invoiceNumber.endsWith('26-27/00001')).toBe(true);
    const obj2 = await env.EVENT_LOG_R2!.get(gen2.r2Key);
    const snap2 = JSON.parse(new TextDecoder().decode(await obj2!.arrayBuffer())) as { invoiceDate: string };
    expect(snap2.invoiceDate).toBe('2026-04-01');

    await stayCheckedIn(stub, guestRef, 'res_serb3', 'rm_serb3', '2026-04-01', '2026-04-02');
    const win3 = 'res_serb3:GUEST';
    const gen3 = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_serb3', folioWindowId: win3 },
      await idemFor('gen-b3', { reservationId: 'res_serb3', folioWindowId: win3 }),
    );
    expect(gen3).toMatchObject({ ok: true });
    if (!gen3.ok) return;
    expect(gen3.invoiceNumber.endsWith('26-27/00002')).toBe(true);
  });

  it('(c) gst starting_idx before first invoice; new FY resets counter to 1', async () => {
    const name = `inv-ser-c-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    expect(await putDomainConfig(stub, 'pms.invoice.series', 'gst_financial_year', 'gst')).toMatchObject({
      ok: true,
    });
    expect(await putDomainConfig(stub, 'pms.invoice.date_rule', 'BUSINESS_DATE', 'bd')).toMatchObject({
      ok: true,
    });
    expect(await putDomainConfig(stub, 'pms.invoice.starting_idx', 457, 'start')).toMatchObject({ ok: true });
    const added = await addRoomType(stub, 'rt_king', 8);
    await seedInvoiceFyStayRange(stub);

    await stub.setBusinessDateForTest('2026-03-15');
    await stayCheckedIn(stub, guestRef, 'res_serc1', 'rm_serc1', '2026-03-14', '2026-03-15');
    const win1 = 'res_serc1:GUEST';
    const gen1 = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_serc1', folioWindowId: win1 },
      await idemFor('gen-c1', { reservationId: 'res_serc1', folioWindowId: win1 }),
    );
    expect(gen1).toMatchObject({ ok: true });
    if (!gen1.ok) return;
    expect(gen1.invoiceNumber.endsWith('/00457')).toBe(true);

    await stub.setBusinessDateForTest('2026-04-01');
    await stayCheckedIn(stub, guestRef, 'res_serc2', 'rm_serc2', '2026-03-31', '2026-04-01');
    const win2 = 'res_serc2:GUEST';
    const gen2 = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_serc2', folioWindowId: win2 },
      await idemFor('gen-c2', { reservationId: 'res_serc2', folioWindowId: win2 }),
    );
    expect(gen2).toMatchObject({ ok: true });
    if (!gen2.ok) return;
    expect(gen2.invoiceNumber.endsWith('/00001')).toBe(true);
  });

  it('(d) gst prefix that exceeds 16 chars is refused; prior prefix unchanged', async () => {
    const name = `inv-ser-d-${crypto.randomUUID()}`;
    const { stub, propertyId, orgId } = await provisionedPropertyWithGuest(name);
    expect(await putDomainConfig(stub, 'pms.invoice.series', 'gst_financial_year', 'gst')).toMatchObject({
      ok: true,
    });
    expect(await stub.readConfig('pms.invoice.prefix')).toBe('INV-');

    const bad = await putDomainConfig(stub, 'pms.invoice.prefix', 'INV-XX', 'too long');
    expect(bad).toMatchObject({ ok: false, error: INVOICE_NUMBER_INVALID });
    expect(await stub.readConfig('pms.invoice.prefix')).toBe('INV-');

    await registerPropertyForHttp(propertyId, orgId);
    const httpPut = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/config/domain`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
        body: JSON.stringify({
          idempotencyKey: `idem-http-prefix-${crypto.randomUUID()}`,
          key: 'pms.invoice.prefix',
          value: 'INV-XX',
          reason: 'http too long',
        }),
      }),
      env,
    );
    expect(httpPut.status).toBe(422);
    expect(await httpPut.json()).toMatchObject({ ok: false, error: INVOICE_NUMBER_INVALID });
  });

  it('(f) Manually skips checkout invoice gate; allow_pending permits generate with balance', async () => {
    const manualProperty = `inv-ser-f-man-${crypto.randomUUID()}`;
    const { stub: manualStub, guestRef: manualGuest, propertyId: manualPid, orgId: manualOrg } =
      await provisionedPropertyWithGuest(manualProperty);
    await registerPropertyForHttp(manualPid, manualOrg);
    const addedManual = await addRoomType(manualStub, 'rt_king', 5);
    const resManual = `res_f_manual_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(
      manualStub,
      manualGuest,
      resManual,
      'rm_f_manual',
      addedManual.fromDate,
      addCalendarDays(addedManual.fromDate, 1),
    );
    expect(await putDomainConfig(manualStub, 'pms.invoice.gen_mode', 'Manually', 'manual mode')).toMatchObject({
      ok: true,
    });
    const co = await postCheckOut(manualPid, HTTP_ACTOR, resManual);
    expect(co.status).toBe(200);
    expect(await manualStub.getReservationStatus(resManual)).toBe('checked_out');
    const manualInvoices = await manualStub.readInvoicesForReservation(resManual);
    expect(manualInvoices.length).toBe(0);

    const pendingProperty = `inv-ser-f-pend-${crypto.randomUUID()}`;
    const { stub: pendStub, guestRef: pendGuest } = await provisionedPropertyWithGuest(pendingProperty);
    const addedPend = await addRoomType(pendStub, 'rt_king', 5);
    const resPend = 'res_f_pending';
    await stayCheckedIn(
      pendStub,
      pendGuest,
      resPend,
      'rm_f_pend',
      addedPend.fromDate,
      addCalendarDays(addedPend.fromDate, 1),
    );
    expect(await putDomainConfig(pendStub, 'pms.invoice.allow_pending', true, 'allow pending')).toMatchObject({
      ok: true,
    });
    const line = {
      folioLineId: 'fl_f_pending',
      reservationId: resPend,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await pendStub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl-f', line))).toMatchObject({
      ok: true,
    });
    const guestWindowId = `${resPend}:GUEST`;
    const gen = await pendStub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: resPend, folioWindowId: guestWindowId },
      await idemFor('gen-f-pend', { reservationId: resPend, folioWindowId: guestWindowId }),
    );
    expect(gen).not.toMatchObject({ ok: false, error: FOLIO_BALANCE_DUE });
    expect(gen).toMatchObject({ ok: true });
  });
});
