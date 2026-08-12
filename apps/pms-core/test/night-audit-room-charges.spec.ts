import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
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
    await stub.tryUpsertRateDay(
      TEST_OWNER_ACTOR,
      input,
      await idemFor(`rate-${roomTypeId}-${stayDate}`, input),
    ),
  ).toEqual({
    ok: true,
  });
}

describe('night audit POST_ROOM_CHARGES', () => {
  it('16: posts single-night rate_day amount per in-house reservation', async () => {
    const { stub } = await provisionedPropertyStub(`na-room-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const departure = addDays(businessDate, 3);

    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRoomType(stub, 'rt_b', 'RTB');
    for (let n = 0; n < 3; n++) {
      const stayDate = addDays(businessDate, n);
      await seedRate(stub, 'rt_a', stayDate, 10000);
      await seedRate(stub, 'rt_b', stayDate, 15000);
    }

    await stub.insertReservationForTest({
      reservationId: 'res_confirmed',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: departure,
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_checked_in',
      roomTypeId: 'rt_b',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: businessDate,
      departureDate: departure,
      status: 'checked_in',
    });

    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.countFolioLines()).toBe(2);

    const lines = [
      ...(await stub.listFolioLinesForReservation('res_confirmed')),
      ...(await stub.listFolioLinesForReservation('res_checked_in')),
    ];
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chargeCode: 'ROOM',
          source: 'NIGHT_AUDIT',
          businessDate,
          amountMinor: 10000,
        }),
        expect.objectContaining({
          chargeCode: 'ROOM',
          source: 'NIGHT_AUDIT',
          businessDate,
          amountMinor: 15000,
        }),
      ]),
    );
    expect(lines.map((l) => l.amountMinor).sort()).toEqual([10000, 15000]);
  });

  it('17: missing BAR rate fails whole step with rate_missing and zero lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-missing-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await stub.insertReservationForTest({
      reservationId: 'res_no_rate',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });

    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('rate_missing');
    expect(await stub.countFolioLines()).toBe(0);

    const roll = await stub.runAuditStep(businessDate, 'ROLL_BUSINESS_DATE');
    expect(roll.status).toBe('COMPLETED');
    expect(await stub.readBusinessDate()).toBe(businessDate);
  });

  it('18: re-run COMPLETED POST_ROOM_CHARGES short-circuits without duplicate lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-rerun-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', businessDate, 10000);
    await stub.insertReservationForTest({
      reservationId: 'res_rerun',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });

    const first = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(first.status).toBe('COMPLETED');
    expect(await stub.countFolioLines()).toBe(1);

    const second = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(second.status).toBe('COMPLETED');
    expect(await stub.countFolioLines()).toBe(1);
  });

  it('19: retry after FAILED does not duplicate night-audit room lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-retry-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRoomType(stub, 'rt_b', 'RTB');
    await seedRate(stub, 'rt_a', businessDate, 10000);
    await seedRate(stub, 'rt_b', businessDate, 15000);
    await stub.insertReservationForTest({
      reservationId: 'res_retry_a',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_retry_b',
      roomTypeId: 'rt_b',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });

    await stub.setPostRoomChargesFailureAfterCountForTest(1);
    const failed = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(failed.status).toBe('FAILED');
    expect(await stub.countFolioLines()).toBe(0);
    await stub.setPostRoomChargesFailureAfterCountForTest(null);

    const retry = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(retry.status).toBe('COMPLETED');
    expect(await stub.countFolioLinesForReservation('res_retry_a')).toBe(1);
    expect(await stub.countFolioLinesForReservation('res_retry_b')).toBe(1);
    expect(await stub.countFolioLines()).toBe(2);
  });

  it('20: pre-slice reservation without folio_window gets window and room charge on audit', async () => {
    const { stub } = await provisionedPropertyStub(`na-preslice-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', businessDate, 10000);
    await stub.insertReservationForTest({
      reservationId: 'res_preslice',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });
    expect(await stub.readGuestFolioWindowForTest('res_preslice')).toBeNull();

    const result = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(result.status).toBe('COMPLETED');
    expect(await stub.readGuestFolioWindowForTest('res_preslice')).toEqual({
      folioWindowId: 'res_preslice:GUEST',
      kind: 'GUEST',
      status: 'OPEN',
    });
    expect(await stub.countFolioLinesForReservation('res_preslice')).toBe(1);
  });
});
