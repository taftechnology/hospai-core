import { env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import {
  NIGHT_AUDIT_CHECKS_FAILED,
  PENDING_CENSUS_REQUIRED,
  PENDING_COMMANDS_UNDRAINED,
  PROVISIONAL_EXCEPTIONS_OPEN,
} from '@hospai/contracts';
import worker from '../src/index.js';
import type { NightAuditWorkflowParams, PmsEnv } from '../src/env';
import { NightAuditWorkflow } from '../src/night-audit-workflow';
import type { OrgDO } from '../src/org-do';
import { NIGHT_AUDIT_STEPS, type PropertyDO } from '../src/property-do';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision';
import { ensurePlatformSchema } from '../src/registry';
import { addCalendarDays } from './date-helpers';
import {
  idemFor,
  provisionedPropertyStub,
  provisionedPropertyWithGuest,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

function fakeWorkflowStep(): WorkflowStep {
  return {
    do: async (_name: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as () => Promise<unknown>;
      return callback();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
    waitForEvent: async () => {
      throw new Error('waitForEvent is not supported by fakeWorkflowStep');
    },
  } as unknown as WorkflowStep;
}

function runNightAuditWorkflow(propertyId: string): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as NightAuditWorkflow;
  const event = {
    payload: { propertyId },
    timestamp: new Date(),
    instanceId: `test-${propertyId}`,
  } as WorkflowEvent<NightAuditWorkflowParams>;
  return NightAuditWorkflow.prototype.run.call(receiver, event, fakeWorkflowStep());
}

type Stub = DurableObjectStub<PropertyDO>;

async function businessDateOf(stub: Stub): Promise<string> {
  const businessDate = await stub.readBusinessDate();
  if (!businessDate) throw new Error('business date unset');
  return businessDate;
}

async function checksOn(stub: Stub, businessDate?: string) {
  if (businessDate) await stub.setBusinessDateForTest(businessDate);
  const status = await stub.readNightAuditStatus();
  expect(status.ok).toBe(true);
  if (!status.ok) throw new Error('night audit status unavailable');
  return status.checks;
}

function checkCount(
  checks: Awaited<ReturnType<typeof checksOn>>,
  checkId: string,
): { severity: string; count: number | null } {
  const row = checks.find((check) => check.checkId === checkId);
  if (!row) throw new Error(`missing check ${checkId}`);
  return row;
}

async function putChecks(stub: Stub, value: Record<string, string>, key: string) {
  const reason = 'test';
  return stub.tryPutDomainConfig(
    TEST_OWNER_ACTOR,
    'pms.night_audit.checks',
    value,
    { reason },
    await idemFor(key, { key: 'pms.night_audit.checks', value, reason }),
  );
}

async function insertStay(
  stub: Stub,
  input: {
    reservationId: string;
    arrivalDate: string;
    departureDate: string;
    status?: string;
    roomId?: string;
  },
) {
  await stub.insertReservationForTest({
    reservationId: input.reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest_ref',
    piiKeyId: 'pii_key',
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    status: input.status,
    roomId: input.roomId,
  });
}

async function addKing(stub: Stub): Promise<string> {
  const input = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-king', input));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error('add room type failed');
  await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
  return added.fromDate;
}

async function createRoom(stub: Stub, roomId: string) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

async function bookCheckedIn(
  stub: Stub,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  await createRoom(stub, roomId);
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
}

async function postMisc(stub: Stub, reservationId: string, folioLineId: string, amountMinor: number) {
  const line = { folioLineId, reservationId, chargeCode: 'MISC', amountMinor };
  expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(folioLineId, line))).toMatchObject({
    ok: true,
  });
}

describe('night audit checks', () => {
  it('1. each check counts the matching rows and ignores the wrong date or status', async () => {
    const name = `na-checks-q-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const fromDate = await addKing(stub);
    const d = fromDate;
    await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');

    await createRoom(stub, 'rm_dirty');
    await createRoom(stub, 'rm_clean');
    await createRoom(stub, 'rm_inhouse_dirty');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' },
        await idemFor('dirty-rm', { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_inhouse_dirty', status: 'dirty', reason: 'Test' },
        await idemFor('dirty-ih', { roomId: 'rm_inhouse_dirty', status: 'dirty', reason: 'Test' }),
      ),
    ).toMatchObject({ ok: true });

    await insertStay(stub, { reservationId: 'arr_today', arrivalDate: d, departureDate: addCalendarDays(d, 2) });
    await insertStay(stub, {
      reservationId: 'arr_pending',
      arrivalDate: addCalendarDays(d, -1),
      departureDate: addCalendarDays(d, 1),
      status: 'pending',
    });
    await insertStay(stub, {
      reservationId: 'arr_future',
      arrivalDate: addCalendarDays(d, 1),
      departureDate: addCalendarDays(d, 3),
    });
    await insertStay(stub, {
      reservationId: 'arr_cancelled',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      status: 'cancelled',
    });
    await insertStay(stub, {
      reservationId: 'arr_inquiry',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      status: 'inquiry',
    });
    await insertStay(stub, {
      reservationId: 'arr_dirty',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      roomId: 'rm_dirty',
    });
    await insertStay(stub, {
      reservationId: 'arr_clean',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      roomId: 'rm_clean',
    });
    await insertStay(stub, {
      reservationId: 'dep_today',
      arrivalDate: addCalendarDays(d, -1),
      departureDate: d,
      status: 'checked_in',
    });
    await insertStay(stub, {
      reservationId: 'dep_overstay',
      arrivalDate: addCalendarDays(d, -3),
      departureDate: addCalendarDays(d, -1),
      status: 'checked_in',
    });
    await insertStay(stub, {
      reservationId: 'dep_future',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
      status: 'checked_in',
      roomId: 'rm_inhouse_dirty',
    });
    await insertStay(stub, {
      reservationId: 'dep_already_out',
      arrivalDate: addCalendarDays(d, -2),
      departureDate: d,
      status: 'checked_out',
    });

    const checks = await checksOn(stub);
    expect(checks.map((row) => row.checkId)).toEqual([
      'arrivals_not_checked_in',
      'departures_not_checked_out',
      'cashier_shift_open',
      'dirty_room_assigned',
      'departed_with_balance',
      'id_proof_missing',
      'arrival_deposit_missing',
      'open_folio_unsettled',
      'open_folio_past_close_by',
      'open_folio_zero_balance',
      'form_c_overdue',
    ]);
    expect(checks).toHaveLength(11);
    expect(checkCount(checks, 'arrivals_not_checked_in')).toMatchObject({ severity: 'warn', count: 4 });
    expect(checkCount(checks, 'departures_not_checked_out')).toMatchObject({ severity: 'warn', count: 2 });
    expect(checkCount(checks, 'dirty_room_assigned')).toMatchObject({ severity: 'warn', count: 1 });
    expect(checkCount(checks, 'cashier_shift_open')).toMatchObject({ severity: 'warn', count: 0 });
    expect(checkCount(checks, 'departed_with_balance')).toMatchObject({ severity: 'warn', count: 0 });

    const open = { shiftId: 'sh_open', openingFloat: 0 };
    expect(
      await stub.tryOpenShift(TEST_OWNER_ACTOR, open, await idemFor('open-d', open)),
    ).toMatchObject({ ok: true });
    expect(checkCount(await checksOn(stub), 'cashier_shift_open').count).toBe(1);
    const close = { shiftId: 'sh_open', closingCount: 0 };
    expect(
      await stub.tryCloseShift(TEST_OWNER_ACTOR, close, await idemFor('close-d', close)),
    ).toMatchObject({ ok: true });
    expect(checkCount(await checksOn(stub), 'cashier_shift_open').count).toBe(0);

    await stub.setBusinessDateForTest(addCalendarDays(d, 1));
    const openNext = { shiftId: 'sh_next', openingFloat: 0 };
    expect(
      await stub.tryOpenShift(TEST_OWNER_ACTOR, openNext, await idemFor('open-next', openNext)),
    ).toMatchObject({ ok: true });
    expect(checkCount(await checksOn(stub, d), 'cashier_shift_open').count).toBe(0);
    expect(checkCount(await checksOn(stub, addCalendarDays(d, 1)), 'cashier_shift_open').count).toBe(1);
    await stub.setBusinessDateForTest(d);

    await insertStay(stub, {
      reservationId: 'out_null_date',
      arrivalDate: addCalendarDays(d, -4),
      departureDate: addCalendarDays(d, -2),
      status: 'checked_out',
    });
    // Seed balance without desk charge path — checked_out without hold is refused (R4.23 D4).
    await stub.execSqlForTest(
      `INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
       VALUES (?, ?, 'GUEST', 'OPEN')`,
      'out_null_date:GUEST',
      'out_null_date',
    );
    await stub.insertFolioLineRawForTest({
      folioLineId: 'fl_null',
      folioWindowId: 'out_null_date:GUEST',
      reservationId: 'out_null_date',
      chargeCode: 'MISC',
      amountMinor: 4000,
      source: 'ADJUSTMENT',
      businessDate: d,
    });
    expect(checkCount(await checksOn(stub), 'departed_with_balance').count).toBe(0);

    await bookCheckedIn(stub, guestRef, 'res_company', 'rm_co', d, addCalendarDays(d, 2));
    await postMisc(stub, 'res_company', 'fl_co', 5000);
    expect(
      await stub.tryCreateCityLedgerAccount(
        TEST_OWNER_ACTOR,
        { name: 'Acme' },
        await idemFor('cla-acme', { name: 'Acme' }),
      ),
    ).toMatchObject({ ok: true });
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_company', kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-co', { reservationId: 'res_company', kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const xfer = { sourceFolioLineId: 'fl_co', destinationFolioWindowId: opened.folioWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-co', xfer)),
    ).toMatchObject({ ok: true });
    const soldBeforeCompany = (await stub.readAvailabilityDay('rt_king', d))!.sold;
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_company' },
        await idemFor('co-company', { reservationId: 'res_company' }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', d))!.sold).toBe(soldBeforeCompany);
    expect(await stub.readCheckedOutBusinessDateForTest('res_company')).toBe(d);
    expect(checkCount(await checksOn(stub), 'departed_with_balance').count).toBe(0);

    await bookCheckedIn(stub, guestRef, 'res_early', 'rm_early', d, addCalendarDays(d, 3));
    await postMisc(stub, 'res_early', 'fl_early', 2500);
    const soldBeforeEarly = (await stub.readAvailabilityDay('rt_king', d))!.sold;
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_early', overrideBalance: true },
        await idemFor('co-early', { reservationId: 'res_early', overrideBalance: true }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readCheckedOutBusinessDateForTest('res_early')).toBe(d);
    expect((await stub.readAvailabilityDay('rt_king', d))!.sold).toBe(soldBeforeEarly);
    expect(checkCount(await checksOn(stub), 'departed_with_balance').count).toBe(1);
    expect(checkCount(await checksOn(stub, addCalendarDays(d, 3)), 'departed_with_balance').count).toBe(0);

    await stub.setBusinessDateForTest(d);
    await bookCheckedIn(stub, guestRef, 'res_over', 'rm_over', d, addCalendarDays(d, 1));
    const overDate = addCalendarDays(d, 2);
    await stub.setBusinessDateForTest(overDate);
    await postMisc(stub, 'res_over', 'fl_over', 1800);
    const soldBeforeOver = (await stub.readAvailabilityDay('rt_king', d))!.sold;
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_over', overrideBalance: true },
        await idemFor('co-over', { reservationId: 'res_over', overrideBalance: true }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readCheckedOutBusinessDateForTest('res_over')).toBe(overDate);
    expect((await stub.readAvailabilityDay('rt_king', d))!.sold).toBe(soldBeforeOver);
    expect(checkCount(await checksOn(stub), 'departed_with_balance').count).toBe(1);
    expect(checkCount(await checksOn(stub, d), 'departed_with_balance').count).toBe(1);
    expect(checkCount(await checksOn(stub, addCalendarDays(d, 1)), 'departed_with_balance').count).toBe(0);
  });

  it('2. defaults are warn and a clean upgrade completes the audit while a warning exists', async () => {
    const name = `na-checks-default-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const today = await businessDateOf(stub);
    const behind = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(behind);
    const open = { shiftId: 'sh_warn', openingFloat: 0 };
    expect(await stub.tryOpenShift(TEST_OWNER_ACTOR, open, await idemFor('open-warn', open))).toMatchObject({
      ok: true,
    });
    const checks = await checksOn(stub);
    expect(checks.every((row) => row.severity === 'warn')).toBe(true);
    expect(checkCount(checks, 'cashier_shift_open').count).toBe(1);

    const result = await stub.startNightAudit({ pendingOpenCount: 0 });
    expect(result).toMatchObject({ ok: true });
    expect(await stub.readBusinessDate()).toBe(today);
    expect(await stub.isNightAuditHalted()).toBe(false);
    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(behind, step)).toBe('COMPLETED');
    }
  });

  it('3. a fail check above 0 fails PRE_CHECK, halts, and leaves the date unrolled on the manual and alarm paths', async () => {
    const manualName = `na-checks-fail-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(manualName, 'UTC', 'USD');
    const today = await businessDateOf(stub);
    const behind = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(behind);
    expect(await putChecks(stub, { arrivals_not_checked_in: 'fail' }, 'fail-arrivals')).toMatchObject({
      ok: true,
    });
    await insertStay(stub, {
      reservationId: 'arr_block',
      arrivalDate: behind,
      departureDate: today,
    });
    const manual = await stub.startNightAudit({ pendingOpenCount: 0 });
    expect(manual).toMatchObject({ ok: false, error: NIGHT_AUDIT_CHECKS_FAILED });
    expect(await stub.readBusinessDate()).toBe(behind);
    expect(await stub.isNightAuditHalted()).toBe(true);
    const manualStatus = await stub.readNightAuditStatus();
    expect(manualStatus.ok).toBe(true);
    if (manualStatus.ok) {
      expect(manualStatus.steps.find((step) => step.step === 'PRE_CHECK')).toMatchObject({
        status: 'FAILED',
        error: NIGHT_AUDIT_CHECKS_FAILED,
      });
    }

    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_na_chk_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const orgId = `org_na_chk_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    expect(
      (
        await provisionProperty(env, {
          orgId,
          propertyId,
          name: 'Alarm Checks Hotel',
          jurisdiction: 'eu',
          timeZone: 'UTC',
          currency: 'USD',
          actorUserId: 'user_owner',
        })
      ).ok,
    ).toBe(true);
    const alarmStub = (await resolvePropertyFromRegistry(env, propertyId))!.stub;
    const alarmToday = await businessDateOf(alarmStub);
    const alarmBehind = addCalendarDays(alarmToday, -1);
    await alarmStub.setBusinessDateForTest(alarmBehind);
    expect(await putChecks(alarmStub, { arrivals_not_checked_in: 'fail' }, 'fail-alarm')).toMatchObject({
      ok: true,
    });
    await insertStay(alarmStub, {
      reservationId: 'arr_alarm',
      arrivalDate: alarmBehind,
      departureDate: alarmToday,
    });
    await runNightAuditWorkflow(propertyId);
    expect(await alarmStub.readBusinessDate()).toBe(alarmBehind);
    expect(await alarmStub.isNightAuditHalted()).toBe(true);
    expect(await alarmStub.getNightAuditStepStatus(alarmBehind, 'PRE_CHECK')).toBe('FAILED');
    const alarmStatus = await alarmStub.readNightAuditStatus();
    expect(alarmStatus.ok).toBe(true);
    if (alarmStatus.ok) {
      expect(alarmStatus.steps.find((step) => step.step === 'PRE_CHECK')?.error).toBe(
        NIGHT_AUDIT_CHECKS_FAILED,
      );
    }
  });

  it('4. clearing the cause or changing the severity to warn lets Retry finish the audit', async () => {
    const clearedName = `na-checks-clear-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(clearedName, 'UTC', 'USD');
    const today = await businessDateOf(stub);
    const behind = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(behind);
    expect(await putChecks(stub, { cashier_shift_open: 'fail' }, 'fail-shift')).toMatchObject({ ok: true });
    const open = { shiftId: 'sh_clear', openingFloat: 0 };
    expect(await stub.tryOpenShift(TEST_OWNER_ACTOR, open, await idemFor('open-clear', open))).toMatchObject({
      ok: true,
    });
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({
      ok: false,
      error: NIGHT_AUDIT_CHECKS_FAILED,
    });
    const close = { shiftId: 'sh_clear', closingCount: 0 };
    expect(await stub.tryCloseShift(TEST_OWNER_ACTOR, close, await idemFor('close-clear', close))).toMatchObject({
      ok: true,
    });
    const retry = await stub.tryRetryAuditStep(
      TEST_OWNER_ACTOR,
      { businessDate: behind, step: 'PRE_CHECK' },
      await idemFor('retry-clear', { businessDate: behind, step: 'PRE_CHECK' }),
      { pendingOpenCount: 0 },
    );
    expect(retry).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await stub.readBusinessDate()).toBe(today);
    expect(await stub.isNightAuditHalted()).toBe(false);

    const warnName = `na-checks-warn-retry-${crypto.randomUUID()}`;
    const warnProp = await provisionedPropertyStub(warnName, 'UTC', 'USD');
    const warnToday = await businessDateOf(warnProp.stub);
    const warnBehind = addCalendarDays(warnToday, -1);
    await warnProp.stub.setBusinessDateForTest(warnBehind);
    expect(await putChecks(warnProp.stub, { cashier_shift_open: 'fail' }, 'fail-shift-2')).toMatchObject({
      ok: true,
    });
    const open2 = { shiftId: 'sh_warn2', openingFloat: 0 };
    expect(
      await warnProp.stub.tryOpenShift(TEST_OWNER_ACTOR, open2, await idemFor('open-warn2', open2)),
    ).toMatchObject({ ok: true });
    expect(await warnProp.stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({
      ok: false,
      error: NIGHT_AUDIT_CHECKS_FAILED,
    });
    expect(await putChecks(warnProp.stub, { cashier_shift_open: 'warn' }, 'warn-shift-2')).toMatchObject({
      ok: true,
    });
    const retryWarn = await warnProp.stub.tryRetryAuditStep(
      TEST_OWNER_ACTOR,
      { businessDate: warnBehind, step: 'PRE_CHECK' },
      await idemFor('retry-warn', { businessDate: warnBehind, step: 'PRE_CHECK' }),
      { pendingOpenCount: 0 },
    );
    expect(retryWarn).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(await warnProp.stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await warnProp.stub.readBusinessDate()).toBe(warnToday);
  });

  it('4b. a failed Retry re-runs on a new key, a reused key replays, and Resume finishes a part-way run', async () => {
    const name = `na-checks-retry-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const today = await businessDateOf(stub);
    const behind = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(behind);
    expect(await putChecks(stub, { cashier_shift_open: 'fail' }, 'retry-fail')).toMatchObject({ ok: true });
    const open = { shiftId: 'sh_retry', openingFloat: 0 };
    expect(await stub.tryOpenShift(TEST_OWNER_ACTOR, open, await idemFor('open-retry', open))).toMatchObject({
      ok: true,
    });
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({
      ok: false,
      error: NIGHT_AUDIT_CHECKS_FAILED,
    });

    const input = { businessDate: behind, step: 'PRE_CHECK' as const };
    const census = { pendingOpenCount: 0 };
    const firstKey = await idemFor('retry-one', input);
    expect(await stub.tryRetryAuditStep(TEST_OWNER_ACTOR, input, firstKey, census)).toMatchObject({
      ok: true,
      status: 'FAILED',
      error: NIGHT_AUDIT_CHECKS_FAILED,
    });

    const close = { shiftId: 'sh_retry', closingCount: 0 };
    expect(await stub.tryCloseShift(TEST_OWNER_ACTOR, close, await idemFor('close-retry', close))).toMatchObject({
      ok: true,
    });

    // The same key replays the stored failure even though the cause is gone, which is why the SPA sends a new one.
    expect(await stub.tryRetryAuditStep(TEST_OWNER_ACTOR, input, firstKey, census)).toMatchObject({
      ok: true,
      status: 'FAILED',
    });
    expect(
      await stub.tryRetryAuditStep(TEST_OWNER_ACTOR, input, await idemFor('retry-two', input), census),
    ).toMatchObject({ ok: true, status: 'COMPLETED' });

    expect(await stub.isNightAuditHalted()).toBe(false);
    expect(await stub.readBusinessDate()).toBe(behind);

    const resume = { businessDate: behind };
    expect(
      await stub.tryResolveHalt(TEST_OWNER_ACTOR, resume, await idemFor('resume-partway', resume), census),
    ).toMatchObject({ ok: true, status: 'COMPLETED', halted: false });
    expect(await stub.readBusinessDate()).toBe(today);
    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(behind, step)).toBe('COMPLETED');
    }
  });

  it('5. off stores no row and warn and info never fail', async () => {
    const name = `na-checks-sev-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const d = await businessDateOf(stub);
    await insertStay(stub, {
      reservationId: 'arr_sev',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
    });

    expect(await putChecks(stub, { arrivals_not_checked_in: 'off' }, 'sev-off')).toMatchObject({ ok: true });
    expect(checkCount(await checksOn(stub), 'arrivals_not_checked_in')).toMatchObject({
      severity: 'off',
      count: null,
    });
    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const offLog = await stub.readNightAuditCheckLog();
    const offChecks = offLog.dates.find((date) => date.businessDate === d)?.attempts[0]?.checks ?? [];
    expect(offChecks.some((row) => row.checkId === 'arrivals_not_checked_in')).toBe(false);

    expect(await putChecks(stub, { arrivals_not_checked_in: 'warn' }, 'sev-warn')).toMatchObject({ ok: true });
    const warnDate = addCalendarDays(d, 1);
    expect(await stub.runAuditStep(warnDate, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const warnLog = await stub.readNightAuditCheckLog();
    expect(
      warnLog.dates
        .find((date) => date.businessDate === warnDate)
        ?.attempts[0]?.checks.find((row) => row.checkId === 'arrivals_not_checked_in'),
    ).toMatchObject({ severity: 'warn', count: 1 });

    expect(await putChecks(stub, { arrivals_not_checked_in: 'info' }, 'sev-info')).toMatchObject({ ok: true });
    const infoDate = addCalendarDays(d, 2);
    expect(await stub.runAuditStep(infoDate, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const infoLog = await stub.readNightAuditCheckLog();
    expect(
      infoLog.dates
        .find((date) => date.businessDate === infoDate)
        ?.attempts[0]?.checks.find((row) => row.checkId === 'arrivals_not_checked_in'),
    ).toMatchObject({ severity: 'info', count: 1 });
  });

  it('6. fixed check ids are rejected and the existing codes stay in order', async () => {
    const name = `na-checks-fixed-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const d = await businessDateOf(stub);
    expect((await putChecks(stub, { queued_commands: 'off' }, 'fixed-queued')).ok).toBe(false);
    expect((await putChecks(stub, { open_exceptions: 'warn' }, 'fixed-open')).ok).toBe(false);

    expect(await putChecks(stub, { arrivals_not_checked_in: 'fail' }, 'fixed-arr')).toMatchObject({
      ok: true,
    });
    await insertStay(stub, {
      reservationId: 'arr_fixed',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
    });

    const undrained = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 2 });
    expect(undrained).toMatchObject({ status: 'FAILED', error: PENDING_COMMANDS_UNDRAINED });

    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem_${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId: name,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: d,
        actor: { userId: 'user_owner' },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const exceptions = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 });
    expect(exceptions).toMatchObject({ status: 'FAILED', error: PROVISIONAL_EXCEPTIONS_OPEN });

    const listed = (await stub.listProvisionalExceptions()) as {
      exceptions: Array<{ exceptionId: string }>;
    };
    const exceptionId = listed.exceptions[0]?.exceptionId;
    expect(exceptionId).toBeTruthy();
    expect(
      await stub.tryResolveProvisionalException(
        TEST_OWNER_ACTOR,
        { exceptionId: exceptionId! },
        await idemFor('resolve-fixed', { exceptionId }),
      ),
    ).toMatchObject({ ok: true });
    const failedChecks = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 });
    expect(failedChecks).toMatchObject({ status: 'FAILED', error: NIGHT_AUDIT_CHECKS_FAILED });
  });

  it('7. results survive the failed step and a later settings save does not rewrite them', async () => {
    const name = `na-checks-log-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const d = await businessDateOf(stub);
    expect(await putChecks(stub, { arrivals_not_checked_in: 'fail' }, 'log-fail')).toMatchObject({
      ok: true,
    });
    await insertStay(stub, {
      reservationId: 'arr_log',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 1),
    });
    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'FAILED',
      error: NIGHT_AUDIT_CHECKS_FAILED,
    });
    const failed = await stub.readNightAuditCheckLog();
    const attempt1 = failed.dates.find((date) => date.businessDate === d)?.attempts ?? [];
    expect(attempt1).toHaveLength(1);
    expect(attempt1[0]?.attempt).toBe(1);
    expect(attempt1[0]?.checks.find((row) => row.checkId === 'arrivals_not_checked_in')).toMatchObject({
      severity: 'fail',
      count: 1,
    });
    expect(await stub.getNightAuditStepStatus(d, 'PRE_CHECK')).toBe('FAILED');

    expect(await putChecks(stub, { arrivals_not_checked_in: 'warn' }, 'log-warn')).toMatchObject({
      ok: true,
    });
    const afterSave = await stub.readNightAuditCheckLog();
    expect(
      afterSave.dates
        .find((date) => date.businessDate === d)
        ?.attempts.find((attempt) => attempt.attempt === 1)
        ?.checks.find((row) => row.checkId === 'arrivals_not_checked_in')?.severity,
    ).toBe('fail');
  });

  it('7b. a fail then a pass keeps both attempts', async () => {
    const name = `na-checks-both-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    // Retry is only allowed for a business date that has ended.
    const d = addCalendarDays(await businessDateOf(stub), -1);
    await stub.setBusinessDateForTest(d);
    expect(await putChecks(stub, { cashier_shift_open: 'fail' }, 'both-fail')).toMatchObject({ ok: true });
    const open = { shiftId: 'sh_both', openingFloat: 0 };
    expect(await stub.tryOpenShift(TEST_OWNER_ACTOR, open, await idemFor('open-both', open))).toMatchObject({
      ok: true,
    });
    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'FAILED',
    });
    const close = { shiftId: 'sh_both', closingCount: 0 };
    expect(await stub.tryCloseShift(TEST_OWNER_ACTOR, close, await idemFor('close-both', close))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryRetryAuditStep(
        TEST_OWNER_ACTOR,
        { businessDate: d, step: 'PRE_CHECK' },
        await idemFor('retry-both', { businessDate: d, step: 'PRE_CHECK' }),
        { pendingOpenCount: 0 },
      ),
    ).toMatchObject({ ok: true, status: 'COMPLETED' });
    const log = await stub.readNightAuditCheckLog();
    const attempts = log.dates.find((date) => date.businessDate === d)?.attempts ?? [];
    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(attempts[0]?.checks.find((row) => row.checkId === 'cashier_shift_open')).toMatchObject({
      severity: 'fail',
      count: 1,
    });
    expect(attempts[1]?.checks.find((row) => row.checkId === 'cashier_shift_open')).toMatchObject({
      severity: 'fail',
      count: 0,
    });
  });

  it('8. preview and PRE_CHECK agree, and a completed step does not write another attempt', async () => {
    const name = `na-checks-preview-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const d = await businessDateOf(stub);
    await insertStay(stub, {
      reservationId: 'arr_preview',
      arrivalDate: d,
      departureDate: addCalendarDays(d, 2),
    });
    expect(await putChecks(stub, { cashier_shift_open: 'off' }, 'preview-off')).toMatchObject({ ok: true });
    const preview = await checksOn(stub);
    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const stored =
      (await stub.readNightAuditCheckLog()).dates.find((date) => date.businessDate === d)?.attempts[0]?.checks ??
      [];
    for (const row of preview) {
      const logged = stored.find((check) => check.checkId === row.checkId);
      if (row.severity === 'off') {
        expect(logged).toBeUndefined();
        expect(row.count).toBeNull();
      } else {
        expect(logged).toMatchObject({ severity: row.severity, count: row.count });
      }
    }
    expect(stored.find((row) => row.checkId === 'queued_commands')).toMatchObject({ severity: 'fail', count: 0 });
    expect(stored.find((row) => row.checkId === 'open_exceptions')).toMatchObject({ severity: 'fail', count: 0 });

    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const again = await stub.readNightAuditCheckLog();
    expect(again.dates.find((date) => date.businessDate === d)?.attempts).toHaveLength(1);

    const emptyDate = addCalendarDays(d, 9);
    expect(await stub.runAuditStep(emptyDate, 'PRE_CHECK')).toMatchObject({
      status: 'FAILED',
      error: PENDING_CENSUS_REQUIRED,
    });
    expect((await stub.readNightAuditCheckLog()).dates.some((date) => date.businessDate === emptyDate)).toBe(
      false,
    );
  });

  it('9. a bad id or severity is rejected and a stored map missing an id uses warn', async () => {
    const name = `na-checks-map-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const d = await businessDateOf(stub);
    expect((await putChecks(stub, { not_a_check: 'warn' }, 'bad-id')).ok).toBe(false);
    expect((await putChecks(stub, { arrivals_not_checked_in: 'block' }, 'bad-sev')).ok).toBe(false);

    await stub.writeConfigValueForTest('pms.night_audit.checks', {
      arrivals_not_checked_in: 'fail',
      weather: 'fail',
    });
    await insertStay(stub, {
      reservationId: 'dep_missing',
      arrivalDate: addCalendarDays(d, -1),
      departureDate: d,
      status: 'checked_in',
    });
    const checks = await checksOn(stub);
    expect(checkCount(checks, 'arrivals_not_checked_in')).toMatchObject({ severity: 'fail', count: 0 });
    expect(checkCount(checks, 'departures_not_checked_out')).toMatchObject({ severity: 'warn', count: 1 });
    expect(checks.some((row) => (row.checkId as string) === 'weather')).toBe(false);
    expect(await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });

    await stub.writeConfigValueForTest('pms.night_audit.checks', { queued_commands: 'off' });
    const fixedDate = addCalendarDays(d, 3);
    expect(await stub.runAuditStep(fixedDate, 'PRE_CHECK', { pendingOpenCount: 4 })).toMatchObject({
      status: 'FAILED',
      error: PENDING_COMMANDS_UNDRAINED,
    });
  });

  it('10. check log is permissioned, capped at 30 dates newest first, and property scoped', async () => {
    await ensurePlatformSchema(env.PLATFORM_DB);
    const owner = 'user_na_log_owner';
    const staff = 'user_na_log_staff';
    const orgA = `org_log_a_${crypto.randomUUID()}`;
    const propertyA = `prop_log_a_${crypto.randomUUID()}`;
    const orgB = `org_log_b_${crypto.randomUUID()}`;
    const propertyB = `prop_log_b_${crypto.randomUUID()}`;

    async function provision(orgId: string, propertyId: string) {
      expect(
        (
          await worker.fetch(
            new Request('http://localhost/v1/orgs', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({ orgId, name: orgId }),
            }),
            env,
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await worker.fetch(
            new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({
                propertyId,
                name: propertyId,
                timeZone: 'UTC',
                currency: 'USD',
              }),
            }),
            env,
          )
        ).status,
      ).toBe(201);
      return (await resolvePropertyFromRegistry(env, propertyId))!.stub;
    }

    const stubA = await provision(orgA, propertyA);
    const stubB = await provision(orgB, propertyB);
    const oldest = '2020-01-01';
    for (let i = 0; i < 31; i++) {
      const date = addCalendarDays(oldest, i);
      expect(await stubA.runAuditStep(date, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
        status: 'COMPLETED',
      });
    }
    const foreign = '2031-06-15';
    expect(await stubB.runAuditStep(foreign, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });

    const logA = await stubA.readNightAuditCheckLog();
    expect(logA.dates).toHaveLength(30);
    expect(logA.dates[0]?.businessDate).toBe(addCalendarDays(oldest, 30));
    expect(logA.dates[29]?.businessDate).toBe(addCalendarDays(oldest, 1));
    expect(logA.dates.some((date) => date.businessDate === oldest)).toBe(false);
    expect(logA.dates.some((date) => date.businessDate === foreign)).toBe(false);
    const logB = await stubB.readNightAuditCheckLog();
    expect(logB.dates.map((date) => date.businessDate)).toEqual([foreign]);

    const org = resolveOrgStub(env.ORG_DO, { orgId: orgA }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    async function getLog(propertyId: string, actor: string) {
      return worker.fetch(
        new Request(
          `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/night-audit/check-log`,
          { method: 'GET', headers: { 'x-dev-actor': actor } },
        ),
        env,
      );
    }

    const staffRes = await getLog(propertyA, staff);
    expect(staffRes.status).toBe(403);
    expect(await staffRes.json()).toMatchObject({ error: 'forbidden', permission: 'night_audit:run' });

    const ownerA = await getLog(propertyA, owner);
    expect(ownerA.status).toBe(200);
    const bodyA = (await ownerA.json()) as { dates: Array<{ businessDate: string }> };
    expect(bodyA.dates).toHaveLength(30);
    expect(bodyA.dates[0]?.businessDate).toBe(addCalendarDays(oldest, 30));
    expect(bodyA.dates.some((date) => date.businessDate === foreign)).toBe(false);

    const ownerB = await getLog(propertyB, owner);
    expect(ownerB.status).toBe(200);
    expect(await ownerB.json()).toMatchObject({ dates: [{ businessDate: foreign }] });

    await stubA.setTransportBlockedForTest(true);
    const blocked = await getLog(propertyA, owner);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: 'property_unreachable', degraded: 'FAIL_CLOSED' });
  });
});
