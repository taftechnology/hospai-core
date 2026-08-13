import { env } from 'cloudflare:test';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { describe, expect, it } from 'vitest';
import { reportObjectKey } from '../src/event-log.js';
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
  ).toEqual({ ok: true });
}

async function readReportJson(propertyId: string, businessDate: string, reportId: string) {
  const obj = await env.EVENT_LOG_R2!.get(reportObjectKey(propertyId, businessDate, reportId));
  expect(obj).not.toBeNull();
  return JSON.parse(await obj!.text()) as Record<string, unknown>;
}

describe('night audit SNAPSHOT_REPORTS / ARCHIVE', () => {
  it('11: snapshot writes three R2 objects + index; occupancy counts as of snapshot time', async () => {
    const propertyId = `na-snap-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await seedRoomType(stub, 'rt_a', 'RTA');
    await seedRate(stub, 'rt_a', d, 10000);
    await stub.insertReservationForTest({
      reservationId: 'res_ci',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_ns',
      roomTypeId: 'rt_a',
      guestRef: 'g2',
      piiKeyId: 'p2',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
    });
    await stub.bumpSoldForTest('rt_a', d, 1);
    await stub.bumpSoldForTest('rt_a', addDays(d, 1), 1);

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(d, 'PROCESS_NO_SHOWS')).status).toBe('COMPLETED');
    const shiftInput = { shiftId: `sh_${crypto.randomUUID()}`, openingFloat: 1000 };
    expect(
      (await stub.tryOpenShift(TEST_OWNER_ACTOR, shiftInput, await idemFor(`open-${shiftInput.shiftId}`, shiftInput)))
        .ok,
    ).toBe(true);
    expect((await stub.runAuditStep(d, 'CLOSE_CASHIER_SHIFTS')).status).toBe('COMPLETED');

    const snap = await stub.runAuditStep(d, 'SNAPSHOT_REPORTS');
    expect(snap.status).toBe('COMPLETED');
    const index = await stub.listNightAuditReportsForTest(d);
    expect(index.map((r) => r.reportId).sort()).toEqual(['cashier', 'occupancy', 'revenue']);

    const occupancy = await readReportJson(propertyId, d, 'occupancy');
    expect(occupancy).toMatchObject({
      businessDate: d,
      inHouseCount: 1,
      confirmedCount: 0,
      noShowCount: 1,
    });
    expect(occupancy.physical).toBe(5);

    const revenue = await readReportJson(propertyId, d, 'revenue');
    expect(revenue.currency).toBe('USD');
    expect(revenue.roomNet).toBe(20000);

    const cashier = await readReportJson(propertyId, d, 'cashier');
    expect(cashier.unattributedCashCount).toBe(0);
    expect(cashier.shifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shiftId: shiftInput.shiftId, status: 'FORCE_CLOSED' }),
      ]),
    );
  });

  it('12: unbound EVENT_LOG_R2 → SNAPSHOT FAILED reports_r2_unbound', async () => {
    const { stub } = await provisionedPropertyStub(`na-r2-unbound-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.setReportsR2UnboundForTest(true);
    const fail = await stub.runAuditStep(d, 'SNAPSHOT_REPORTS');
    expect(fail.status).toBe('FAILED');
    expect(fail.error).toMatch(/reports_r2_unbound/);
    expect(await stub.isNightAuditHalted()).toBe(true);
  });

  it('13: ARCHIVE flushes outbox and writes manifest; night_audit.completed still on ARCHIVE COMPLETED', async () => {
    const propertyId = `na-arch-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(d, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');
    const before = await stub.outboxUnackedCount();
    expect(before).toBeGreaterThan(0);

    const archived = await stub.runAuditStep(d, 'ARCHIVE');
    expect(archived.status).toBe('COMPLETED');
    const after = await stub.outboxUnackedCount();
    expect(after).toBeLessThanOrEqual(before);
    expect(await stub.listOutboxEventTypes()).toContain('night_audit.completed');

    const manifest = await readReportJson(propertyId, d, 'manifest');
    expect(manifest.businessDate).toBe(d);
    expect(manifest.rolledTo).toBe(d);
    expect(Array.isArray(manifest.reportKeys)).toBe(true);
    const index = await stub.listNightAuditReportsForTest(d);
    expect(index.some((r) => r.reportId === 'manifest')).toBe(true);
  });

  it('14: COMPLETED snapshot re-run performs no R2 write; overwrite = retry after put-before-index failure', async () => {
    const propertyId = `na-short-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(d, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');
    const putsBefore = await stub.countReportPutsForTest();
    expect((await stub.runAuditStep(d, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');
    expect(await stub.countReportPutsForTest()).toBe(putsBefore);
    expect((await stub.listNightAuditReportsForTest(d)).filter((r) => r.reportId === 'occupancy')).toHaveLength(1);

    const propertyId2 = `na-overwrite-${crypto.randomUUID()}`;
    const { stub: stub2 } = await provisionedPropertyStub(propertyId2, 'UTC', 'USD');
    const d2 = (await stub2.readBusinessDate())!;
    await stub2.setSnapshotFailureAfterPutForTest('index_fault');
    const failed = await stub2.runAuditStep(d2, 'SNAPSHOT_REPORTS');
    expect(failed.status).toBe('FAILED');
    expect(await stub2.listNightAuditReportsForTest(d2)).toHaveLength(0);
    const putsAfterFail = await stub2.countReportPutsForTest();
    expect(putsAfterFail).toBe(3);

    await stub2.setSnapshotFailureAfterPutForTest(null);
    const retry = await stub2.runAuditStep(d2, 'SNAPSHOT_REPORTS');
    expect(retry.status).toBe('COMPLETED');
    expect(await stub2.countReportPutsForTest()).toBe(6);
    expect((await stub2.listNightAuditReportsForTest(d2)).map((r) => r.reportId).sort()).toEqual([
      'cashier',
      'occupancy',
      'revenue',
    ]);
  });
});
