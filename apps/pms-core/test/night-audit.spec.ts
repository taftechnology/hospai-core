import { env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { enumerateFromDate, HORIZON_DAYS } from '@hospai/pms-inventory';
import { NIGHT_AUDIT_HALTED, NIGHT_AUDIT_STEPS } from '../src/property-do';
import type { PropertyDO } from '../src/property-do';
import { NightAuditWorkflow } from '../src/night-audit-workflow';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision';
import { ensurePlatformSchema } from '../src/registry';
import type { NightAuditWorkflowParams, PmsEnv } from '../src/env';
import { idemFor, provisionedPropertyStub, propertyStub, TEST_OWNER_ACTOR } from './fixtures';


/**
 * Synchronous stand-in for the Workflows engine: runs each `step.do` callback inline,
 * once, with no durable checkpointing or retries. Lets `NightAuditWorkflow.run()` be
 * executed for real against real bindings — vitest-pool-workers creates Workflow
 * instances but never drives their bodies to completion in-process.
 */
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

/**
 * Execute the real `NightAuditWorkflow.run()` body against real bindings.
 *
 * The class cannot be instantiated here: `WorkflowEntrypoint`'s native constructor
 * rejects vitest-pool-workers' mock `ExecutionContext`. `run()` only ever touches
 * `this.env`, so the genuine method is invoked with a minimal receiver carrying it.
 * Nothing about the workflow logic is re-implemented — registry resolution, the halt
 * check, the step loop and the terminal reschedule all run for real.
 */
function runNightAuditWorkflow(propertyId: string): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as NightAuditWorkflow;
  const event = {
    payload: { propertyId },
    timestamp: new Date(),
    instanceId: `test-${propertyId}`,
  } as WorkflowEvent<NightAuditWorkflowParams>;
  return NightAuditWorkflow.prototype.run.call(receiver, event, fakeWorkflowStep());
}

describe('PropertyDO night audit', () => {
  it('3. catch-up set-reconcile fills gaps with physical = room_count; idempotent re-run inserts nothing', async () => {
    const name = `na-catchup-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const businessDate = (await stub.readBusinessDate())!;
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-catchup', addInput));

    expect(added.ok).toBe(true);
    if (!added.ok) return;

    // Punch a single-day gap in the middle of the horizon.
    const gapDate = enumerateFromDate(businessDate, HORIZON_DAYS)[100]!;
    await stub.deleteAvailabilityDay('rt_king', gapDate);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(HORIZON_DAYS - 1);

    const first = await stub.reconcileHorizonForTest(businessDate);
    expect(first.insertedCount).toBe(1);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(HORIZON_DAYS);
    const filled = await stub.readAvailabilityDay('rt_king', gapDate);
    expect(filled?.physical).toBe(10);

    // Idempotent re-run: nothing left to insert.
    const second = await stub.reconcileHorizonForTest(businessDate);
    expect(second.insertedCount).toBe(0);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(HORIZON_DAYS);
  });

  it('4. N due rolls advance max stay_date by exactly N; end = business_date + (HORIZON_DAYS - 1)', async () => {
    const name = `na-rolls-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    // Backdate business_date N days behind "today" *before* seeding, so the room type's
    // initial horizon is [start, start + HORIZON_DAYS - 1] and rolling forward N times
    // must each append exactly one new day at the far end.
    const originalBusinessDate = (await stub.readBusinessDate())!;
    const N = 3;
    const startDate = subtractDays(originalBusinessDate, N);
    await stub.setBusinessDateForTest(startDate);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-rolls', addInput));

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(await stub.countAvailabilityDays('rt_king')).toBe(HORIZON_DAYS);

    for (let i = 0; i < N; i++) {
      const result = await stub.startNightAudit();
      expect(result.ok).toBe(true);
    }

    const finalBusinessDate = await stub.readBusinessDate();
    expect(finalBusinessDate).toBe(originalBusinessDate);

    // Exactly N new days appended.
    expect(await stub.countAvailabilityDays('rt_king')).toBe(HORIZON_DAYS + N);

    const rows = enumerateFromDate(finalBusinessDate!, HORIZON_DAYS);
    const expectedEnd = rows[rows.length - 1]!;
    const lastDay = await stub.readAvailabilityDay('rt_king', expectedEnd);
    expect(lastDay?.physical).toBe(10);
    const pastEnd = enumerateFromDate(expectedEnd, 2)[1]!;
    const beyond = await stub.readAvailabilityDay('rt_king', pastEnd);
    expect(beyond).toBeNull();
  });

  it('5. a further startNightAudit when already current does not advance business_date into the future', async () => {
    const name = `na-current-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-current', addInput));

    expect(added.ok).toBe(true);

    const businessDateBefore = await stub.readBusinessDate();
    // Already current (business_date === today) — running the full sequence must not advance.
    const result = await stub.startNightAudit();
    expect(result.ok).toBe(true);
    const businessDateAfter = await stub.readBusinessDate();
    expect(businessDateAfter).toBe(businessDateBefore);

    // Run it again for good measure — still no advance.
    const result2 = await stub.startNightAudit();
    expect(result2.ok).toBe(true);
    expect(await stub.readBusinessDate()).toBe(businessDateBefore);
  });

  it('6. archived room type never gains new rows from reconcile', async () => {
    const name = `na-archived-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const businessDate = (await stub.readBusinessDate())!;
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-archived', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const deleteInput = { roomTypeId: 'rt_king' };
    const archived = await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, deleteInput, await idemFor('archive-for-na', deleteInput));

    expect(archived.ok).toBe(true);
    expect(await stub.getRoomTypeStatus('rt_king')).toBe('archived');

    // Remove all future rows to simulate an expired horizon on the archived type.
    await stub.deleteAvailabilityDaysFrom('rt_king', businessDate);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(0);

    const result = await stub.reconcileHorizonForTest(businessDate);
    expect(result.insertedCount).toBe(0);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(0);
  });

  it('8. a FAILED step halts the property; startNightAudit refuses until cleared', async () => {
    const name = `na-halt-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await stub.ensureMetaPropertyId(name);
    // Deliberately unprovisioned (no timezone) — ROLL_BUSINESS_DATE fails closed.
    const result = await stub.runAuditStep('2026-01-01', 'ROLL_BUSINESS_DATE');
    expect(result.status).toBe('FAILED');

    expect(await stub.isNightAuditHalted()).toBe(true);

    const start = await stub.startNightAudit();
    expect(start).toEqual({ ok: false, error: NIGHT_AUDIT_HALTED });
  });

  it('11. PRE_CHECK stub completes; only ROLL mutates business_date/horizon; started+completed outbox events present', async () => {
    const name = `na-steps-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    // Backdate before seeding so ROLL is due and its reconcile has a new day to insert
    // (window shifts forward by exactly one day), giving a real `availability.changed`.
    const originalBusinessDate = (await stub.readBusinessDate())!;
    const startDate = subtractDays(originalBusinessDate, 1);
    await stub.setBusinessDateForTest(startDate);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-steps', addInput));

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    await stub.flushOutbox();

    const preCheck = await stub.runAuditStep(startDate, 'PRE_CHECK');
    expect(preCheck.status).toBe('COMPLETED');
    // PRE_CHECK alone must not touch business_date.
    expect(await stub.readBusinessDate()).toBe(startDate);

    for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
      const r = await stub.runAuditStep(startDate, step);
      expect(r.status).toBe('COMPLETED');
    }

    // Only ROLL_BUSINESS_DATE should have mutated business_date, and only to +1 day.
    expect(await stub.readBusinessDate()).toBe(originalBusinessDate);

    const events = await stub.listOutboxEventTypes();
    expect(events[0]).toBe('night_audit.started');
    expect(events[events.length - 1]).toBe('night_audit.completed');
    expect(events).toContain('availability.changed');

    // Every step for this business_date is COMPLETED.
    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(startDate, step)).toBe('COMPLETED');
    }

    // Re-running an already-COMPLETED step short-circuits without re-running side effects.
    const rerun = await stub.runAuditStep(startDate, 'PRE_CHECK');
    expect(rerun).toEqual({ status: 'COMPLETED' });
  });

  it('rescheduleNightAudit: business_date < today re-arms next_run_at to "now" (not the next audit_time)', async () => {
    const name = `na-resched-behind-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    const originalBusinessDate = (await stub.readBusinessDate())!;
    await stub.setBusinessDateForTest(subtractDays(originalBusinessDate, 1));

    const before = Date.now();
    await stub.rescheduleNightAudit();
    const after = Date.now();

    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule).not.toBeNull();
    // "Now", not tomorrow's 02:00 — the Workflow must re-fire immediately while behind.
    expect(schedule!.nextRunAt).toBeGreaterThanOrEqual(before);
    expect(schedule!.nextRunAt).toBeLessThanOrEqual(after + 5000);
  });

  it('rescheduleNightAudit: business_date current arms the next audit_time occurrence (future)', async () => {
    const name = `na-resched-current-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    await stub.rescheduleNightAudit();
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('10. matrix: changing pms.night_audit.audit_time reschedules alarm_schedule inside the config transaction', async () => {
    const name = `na-matrix-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    const before = await stub.getAlarmSchedule('night-audit');
    expect(before).not.toBeNull();

    const idem = await idemFor('audit-time-change', {
      key: 'pms.night_audit.audit_time',
      value: '05:30',
      reason: 'test:reschedule',
    });
    const result = await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.audit_time',
      '05:30',
      { reason: 'test:reschedule' },
      idem,
    );
    expect(result.ok).toBe(true);

    const after = await stub.getAlarmSchedule('night-audit');
    expect(after).not.toBeNull();
    // Recomputed against the *new* audit_time — value should have moved.
    expect(after!.nextRunAt).not.toBe(before!.nextRunAt);
  });

  it('config keys with reschedulesNightAudit=false do not touch alarm_schedule', async () => {
    const name = `na-nonmatrix-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    const before = await stub.getAlarmSchedule('night-audit');

    const idem = await idemFor('non-reschedule-write', {
      key: 'pms.availability.allow_overbooking',
      value: true,
      reason: 'test:non-reschedule',
    });
    const result = await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.availability.allow_overbooking',
      true,
      { reason: 'test:non-reschedule' },
      idem,
    );
    expect(result.ok).toBe(true);

    const after = await stub.getAlarmSchedule('night-audit');
    expect(after!.nextRunAt).toBe(before!.nextRunAt);
  });

  it('alarm() dispatches the night-audit handler without error (creates the Workflow instance only — does NOT execute its body)', async () => {
    const name = `na-alarm-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    // Property is behind — a real run would advance business_date on completion.
    const originalBusinessDate = (await stub.readBusinessDate())!;
    await stub.setBusinessDateForTest(subtractDays(originalBusinessDate, 1));
    await stub.rescheduleNightAudit();

    await stub.triggerAlarmForTest();

    // Scope note: this asserts only that the alarm handler dispatched cleanly and
    // re-armed. vitest-pool-workers does not run Workflow bodies, so the
    // registry → Workflow → runAuditStep handoff is proven by test 9 below instead.
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule).not.toBeNull();
    expect(schedule!.lastError).toBeNull();
  });

  it('9. NightAuditWorkflow.run() resolves through the D1 registry only and drives runAuditStep to completion', async () => {
    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_na_wf_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Workflow Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(provisioned.ok).toBe(true);

    // Resolve exactly the way the Workflow does — via the registry row provisionProperty wrote.
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-wf', addInput))).ok).toBe(true);


    // Put the property one day behind so ROLL_BUSINESS_DATE has real work to do.
    const originalBusinessDate = (await stub.readBusinessDate())!;
    const behindDate = subtractDays(originalBusinessDate, 1);
    await stub.setBusinessDateForTest(behindDate);

    await runNightAuditWorkflow(propertyId);

    // The Workflow body actually ran: every step COMPLETED and the roll advanced the date.
    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(behindDate, step)).toBe('COMPLETED');
    }
    expect(await stub.readBusinessDate()).toBe(originalBusinessDate);

    // Terminal `rescheduleNightAudit()` ran: now current, so armed at the next audit_time.
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('9b. NightAuditWorkflow.run() exits silently for a propertyId absent from the registry', async () => {
    await ensurePlatformSchema(env.PLATFORM_DB);
    await expect(
      runNightAuditWorkflow(`prop_missing_${crypto.randomUUID()}`),
    ).resolves.toBeUndefined();
  });

  it('a step body that throws mid-way rolls back its mutations; only the FAILED bookkeeping persists', async () => {
    const name = `na-rollback-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-rollback', addInput))).ok).toBe(true);


    const originalBusinessDate = (await stub.readBusinessDate())!;
    const behindDate = subtractDays(originalBusinessDate, 1);
    await stub.setBusinessDateForTest(behindDate);
    await stub.flushOutbox();

    const ariBefore = await stub.readAriVersion();
    const rowsBefore = await stub.countAvailabilityDays('rt_king');

    // Fail *after* the roll has written the advanced business_date.
    await stub.setRollFailureForTest('injected mid-roll failure');
    const result = await stub.runAuditStep(behindDate, 'ROLL_BUSINESS_DATE');
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('injected mid-roll failure');

    // Step body rolled back whole: no advanced date, no partial horizon, no ARI bump.
    expect(await stub.readBusinessDate()).toBe(behindDate);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(rowsBefore);
    expect(await stub.readAriVersion()).toBe(ariBefore);

    // Bookkeeping survived: FAILED row + halt + the started event from txn A.
    expect(await stub.getNightAuditStepStatus(behindDate, 'ROLL_BUSINESS_DATE')).toBe('FAILED');
    expect(await stub.isNightAuditHalted()).toBe(true);
    const events = await stub.listOutboxEventTypes();
    expect(events).toEqual(['night_audit.started']);

    // Disarming and retrying completes cleanly — nothing was left half-written.
    await stub.setRollFailureForTest(null);
    const retry = await stub.runAuditStep(behindDate, 'ROLL_BUSINESS_DATE');
    expect(retry.status).toBe('COMPLETED');
    expect(await stub.readBusinessDate()).toBe(originalBusinessDate);
  });

  it('alarm() always advances next_run_at into the future even when halted, preventing a re-fire storm', async () => {
    const name = `na-storm-${crypto.randomUUID()}`;
    const timeZone = 'Europe/Berlin';
    const stub = await provisionedPropertyStub(name, timeZone, 'EUR');

    // Force a halt (a FAILED step) so the handler exits early without ever running the
    // Workflow to completion — this is exactly the case that used to leave next_run_at
    // stuck in the past.
    await stub.forceNightAuditHaltForTest((await stub.readBusinessDate())!);
    expect(await stub.isNightAuditHalted()).toBe(true);

    // Put the schedule in the past, simulating a due alarm.
    await stub.setAlarmScheduleForTest('night-audit', Date.now() - 60_000);
    const before = await stub.getAlarmSchedule('night-audit');
    expect(before!.nextRunAt).toBeLessThanOrEqual(Date.now());

    const now = Date.now();
    await stub.triggerAlarmForTest();

    const after = await stub.getAlarmSchedule('night-audit');
    expect(after).not.toBeNull();
    // Bumped to the next audit_time occurrence, not "now" — must be strictly in the future.
    expect(after!.nextRunAt).toBeGreaterThan(now);

    // A second immediate alarm must not re-fire (schedule is no longer due) and must not
    // change next_run_at again.
    await stub.triggerAlarmForTest();
    const afterSecond = await stub.getAlarmSchedule('night-audit');
    expect(afterSecond!.nextRunAt).toBe(after!.nextRunAt);
  });
});

/** Subtract `n` calendar days from a YYYY-MM-DD string, purely via UTC arithmetic (no TZ). */
function subtractDays(dateStr: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d - n);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
