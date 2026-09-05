import { enumerateStayDates } from '@hospai/pms-reservations';
import { describe, expect, it } from 'vitest';
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

  it('16: pending arriving D expires to cancelled; confirmed sibling no_show', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-16-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_pend',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() - 60_000,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    await stub.insertReservationForTest({
      reservationId: 'res_conf',
      roomTypeId: 'rt_a',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'confirmed',
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const pend = await stub.readReservation('res_pend');
    const conf = await stub.readReservation('res_conf');
    expect(pend.ok && pend.reservation.status).toBe('cancelled');
    expect(conf.ok && conf.reservation.status).toBe('no_show');
    expect((await stub.readAvailabilityDay('rt_a', d))?.sold).toBe(0);
    expect(await stub.countFolioLinesForReservation('res_pend')).toBe(0);
  });

  it('17: auto_no_show false keeps confirmed; due pending still expires', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-17-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-17', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_conf17',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_pend17',
      roomTypeId: 'rt_a',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() - 1,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const conf = await stub.readReservation('res_conf17');
    const pend = await stub.readReservation('res_pend17');
    expect(conf.ok && conf.reservation.status).toBe('confirmed');
    expect(pend.ok && pend.reservation.status).toBe('cancelled');
  });

  it('18: inquiry arriving D → cancelled, no ledger', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-18-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_inq',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'inquiry',
    });
    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const inq = await stub.readReservation('res_inq');
    expect(inq.ok && inq.reservation.status).toBe('cancelled');
    expect((await stub.readAvailabilityDay('rt_a', d))?.sold).toBe(0);
    expect(await stub.countFolioLinesForReservation('res_inq')).toBe(0);
  });

  it('20: policy none after POST → ROOM reversed, no NO_SHOW', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-20-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r20', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_20',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'confirmed',
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(d, 'PROCESS_NO_SHOWS')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_20');
    expect(lines.some((l) => l.source === 'SPLIT_REVERSAL' && l.chargeCode === 'ROOM')).toBe(true);
    expect(lines.some((l) => l.chargeCode === 'NO_SHOW')).toBe(false);
  });

  it('21: first_night + arrival D → P===R, ROOM remains, no NO_SHOW', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-21-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r21', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_21',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'confirmed',
      cancelPenaltyType: 'first_night',
      cancelGraceHours: 0,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(d, 'PROCESS_NO_SHOWS')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_21');
    expect(lines.filter((l) => l.chargeCode === 'ROOM' && l.source === 'NIGHT_AUDIT')).toHaveLength(1);
    expect(lines.some((l) => l.source === 'SPLIT_REVERSAL')).toBe(false);
    expect(lines.some((l) => l.chargeCode === 'NO_SHOW')).toBe(false);
  });

  it('22: full on 2-night stay reverses ROOM and posts NO_SHOW for P; retry is no-op', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-22-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    for (const stayDate of [d, addDays(d, 1)]) {
      const rate = {
        roomTypeId: 'rt_a',
        ratePlanId: 'BAR',
        stayDate,
        amountMinor: 10000,
        currency: 'USD',
      };
      expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor(`r22-${stayDate}`, rate))).toMatchObject(
        { ok: true },
      );
    }
    await stub.insertReservationForTest({
      reservationId: 'res_22',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
      cancelPenaltyType: 'full',
      cancelGraceHours: 0,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    await stub.bumpSoldForTest('rt_a', addDays(d, 1), 1);
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(d, 'PROCESS_NO_SHOWS')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_22');
    expect(lines.some((l) => l.source === 'SPLIT_REVERSAL' && l.chargeCode === 'ROOM')).toBe(true);
    const noshow = lines.find((l) => l.chargeCode === 'NO_SHOW' && l.source === 'NIGHT_AUDIT');
    expect(noshow).toMatchObject({
      folioLineId: `res_22:noshow:audit:${d}`,
      amountMinor: 20000,
    });
    await expect(
      stub.insertFolioLineRawForTest({
        folioLineId: `res_22:noshow:audit:${d}:dup`,
        folioWindowId: 'res_22:GUEST',
        reservationId: 'res_22',
        chargeCode: 'NO_SHOW',
        amountMinor: 20000,
        source: 'NIGHT_AUDIT',
        businessDate: d,
      }),
    ).rejects.toThrow(/UNIQUE constraint failed|folio_line_audit_uniq/i);
    const before = await stub.countFolioLinesForReservation('res_22');
    expect((await stub.runAuditStep(d, 'PROCESS_NO_SHOWS')).status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_22')).toBe(before);
  });

  it('22a: percent 50% 1-night P<R reverse-then-post-P, COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-ns-22a-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r22a', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_22a',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 1),
      status: 'confirmed',
      cancelPenaltyType: 'percent',
      cancelPenaltyBps: 5000,
      cancelGraceHours: 0,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_22a');
    expect(lines.some((l) => l.source === 'SPLIT_REVERSAL')).toBe(true);
    expect(lines.find((l) => l.chargeCode === 'NO_SHOW')).toMatchObject({ amountMinor: 5000 });
  });

  it('L7a: auto_no_show=false → confirmed-not-arrived gets zero ROOM lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-l7-conf-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-l7a', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r-l7a', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_l7_conf',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      status: 'confirmed',
    });

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_l7_conf')).toBe(0);
  });

  it('L7b: auto_no_show=false → checked_in still posts ROOM', async () => {
    const { stub } = await provisionedPropertyStub(`na-l7-ci-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.auto_no_show',
      false,
      { reason: 'test' },
      await idemFor('cfg-l7b', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
    );
    await seedRoomType(stub, 'rt_a', 'RTA');
    const rate = {
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r-l7b', rate))).toMatchObject({
      ok: true,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_l7_ci',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      status: 'checked_in',
    });

    const result = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_l7_ci')).toBe(1);
  });

  it('L8a: pending arrival=D with future confirmBy → not cancelled on PROCESS_NO_SHOWS', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-future-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_future',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() + 24 * 60 * 60 * 1000,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_future');
    expect(res.ok && res.reservation.status).toBe('pending');
  });

  it('L8b: pending past confirmBy → cancelled', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-past-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_past',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
      status: 'pending',
      confirmBy: Date.now() - 1,
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_past');
    expect(res.ok && res.reservation.status).toBe('cancelled');
  });

  it('L8c: pending null confirmBy, arrival=D → cancelled', async () => {
    const { stub } = await provisionedPropertyStub(`na-l8-null-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_l8_null',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
      status: 'pending',
    });
    await stub.bumpSoldForTest('rt_a', d, 1);

    const result = await stub.runAuditStep(d, 'PROCESS_NO_SHOWS');
    expect(result.status).toBe('COMPLETED');
    const res = await stub.readReservation('res_l8_null');
    expect(res.ok && res.reservation.status).toBe('cancelled');
  });
});

