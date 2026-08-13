import { enumerateStayDates } from '@hospai/pms-reservations';
import { describe, expect, it } from 'vitest';
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
}

describe('night audit PROCESS_NO_SHOWS', () => {
  it('7: confirmed arrival_date = D → no_show, sold released, status_changed + availability.changed, no new folio_line', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_ns',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
    });
    for (const stayDate of enumerateStayDates(d, addDays(d, 2))) {
      await stub.bumpSoldForTest('rt_a', stayDate, 1);
    }
    await stub.flushOutbox();

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_ns');
    expect(res.ok && res.reservation.status).toBe('no_show');
    expect(await stub.countFolioLines()).toBe(0);
    for (const stayDate of enumerateStayDates(d, addDays(d, 2))) {
      expect((await stub.readAvailabilityDay('rt_a', stayDate))?.sold).toBe(0);
    }
    const events = await stub.listOutboxEventTypes();
    expect(events).toContain('reservation.status_changed');
    expect(events).toContain('availability.changed');
  });

  it('8: auto_no_show = false → still confirmed, COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-off-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-ns-off', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_ns_off',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
    });
    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_ns_off');
    expect(res.ok && res.reservation.status).toBe('confirmed');
  });

  it('9: already checked_in → untouched', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-ci-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_ci',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'checked_in',
    });
    await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    const res = await stub.readReservation('res_ci');
    expect(res.ok && res.reservation.status).toBe('checked_in');
  });

  it('10: leftover confirmed arrival_date < D → also no_show', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-left-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_left',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: addDays(d, -2),
      departureDate: addDays(d, 1),
      status: 'confirmed',
    });
    for (const stayDate of enumerateStayDates(addDays(d, -2), addDays(d, 1))) {
      await stub.bumpSoldForTest('rt_a', stayDate, 1);
    }
    await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    const res = await stub.readReservation('res_left');
    expect(res.ok && res.reservation.status).toBe('no_show');
  });
});
