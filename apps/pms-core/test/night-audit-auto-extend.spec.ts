import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedRoomType(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomTypeId: string,
  code: string,
  roomCount = 5,
) {
  const addInput = {
    roomTypeId,
    code,
    name: code,
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor(`add-${roomTypeId}`, addInput));
  expect(added.ok).toBe(true);
  return added;
}

async function seedRate(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomTypeId: string,
  stayDate: string,
  amountMinor: number,
) {
  const input = {
    roomTypeId,
    ratePlanId: DEFAULT_RATE_PLAN_ID,
    stayDate,
    amountMinor,
    currency: 'USD',
  };
  expect(
    await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, input, await idemFor(`rate-${roomTypeId}-${stayDate}`, input)),
  ).toEqual({ ok: true });
}

async function createRoom(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  roomId: string,
  code: string,
  roomTypeId = 'rt_a',
) {
  const room = { roomId, roomTypeId, code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

describe('night audit — auto-extend', () => {
  it('1: default config; checked_in due out D+1 → extends to D+2; posts ROOM for D', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);
    const extended = addDays(d, 2);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(extended);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore + 1);

    const roomLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
    );
    expect(roomLines).toHaveLength(1);

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    expect(audit.ok).toBe(true);
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
      .rows;
    const mod = rows.find((r) => r.commandId === 'reservations.modify');
    expect(mod?.afterJson).toMatchObject({ automated: true, departureDate: extended });
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['reservation.modified', 'availability.changed']),
    );
  });

  it('2: config false → departure unchanged; no sold increment on D+1', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_extend',
      false,
      { reason: 'test:hold-extend' },
      await idemFor('cfg-ae-off', { key: 'pms.night_audit.auto_extend', value: false }),
    );

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
  });

  it('3: confirmed due out D+1 → not extended', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'confirmed',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
  });

  it('4: no availability on D+1 → skip extend; POST still posts ROOM for D', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA', 1);
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);

    const stopSell = {
      roomTypeId: 'rt_a',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: dueOut,
      minLos: null,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: true,
    };
    expect(
      await stub.tryUpsertRestrictionDay(TEST_OWNER_ACTOR, stopSell, await idemFor('stop-ae4', stopSell)),
    ).toMatchObject({ ok: true });

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    const soldBefore = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldBefore);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter(
        (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
      ),
    ).toHaveLength(1);
  });

  it('5: assigned room OOO on D+1 → skip extend; COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await createRoom(stub, 'rm_ae5', '101', 'rt_a');

    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
      roomId: 'rm_ae5',
    });

    expect(
      await stub.trySetOooRange(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_ae5', startDate: dueOut, endDate: addCalendarDays(dueOut, 1) },
        await idemFor('ooo-ae5', { roomId: 'rm_ae5', startDate: dueOut }),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(dueOut);
    expect(read.ok && read.reservation.roomId).toBe('rm_ae5');
  });

  it('6: rerun POST_ROOM_CHARGES same D after extend → idempotent', async () => {
    const { stub } = await provisionedPropertyStub(`na-ae-6-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const dueOut = addDays(d, 1);
    const extended = addDays(d, 2);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10_000);
    await seedRate(stub, 'rt_a', dueOut, 10_000);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: dueOut,
      status: 'checked_in',
    });

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const soldAfterFirst = (await stub.readAvailabilityDay('rt_a', dueOut))?.sold ?? 0;

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.readAvailabilityDay('rt_a', dueOut))?.sold).toBe(soldAfterFirst);

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(extended);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter(
        (l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT' && l.businessDate === d,
      ),
    ).toHaveLength(1);
  });

  it('7: NIGHT_AUDIT_STEPS pin — length 8; [3] AUTO_TRANSFER; no AUTO_EXTEND', async () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');
    expect(NIGHT_AUDIT_STEPS.includes('AUTO_EXTEND' as (typeof NIGHT_AUDIT_STEPS)[number])).toBe(false);
  });
});
