import { env, runInDurableObject } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVALID_AUDIT_TIME, NIGHT_AUDIT_NOT_DUE } from '@hospai/contracts';
import { parseLogLine } from '@hospai/observability';
import { enumerateHorizonDates } from '@hospai/pms-inventory';
import { NIGHT_AUDIT_STEPS, nextAuditRunAtMs } from '../src/property-do';
import { NightAuditWorkflow } from '../src/night-audit-workflow';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision';
import { ensurePlatformSchema } from '../src/registry';
import type { NightAuditWorkflowParams, PmsEnv } from '../src/env';
import { addCalendarDays } from './date-helpers';
import { idemFor, propertyStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

/**
 * 2026-11-23 staging incident: a hotel provisioned at 00:33 was scheduled for 02:00 the
 * SAME day, the audit ran steps for a live business date, the roll refused (day not over)
 * but was recorded COMPLETED, and from the next day every run short-circuited while the
 * schedule said "behind, fire now" -> a new Workflow every ~2 s. Plus: a dropped storage
 * alarm was never re-armed, and any audit_time (e.g. 23:00) was accepted.
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

function runNightAuditWorkflow(propertyId: string): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as NightAuditWorkflow;
  const event = {
    payload: { propertyId },
    timestamp: new Date(),
    instanceId: `test-${propertyId}`,
  } as WorkflowEvent<NightAuditWorkflowParams>;
  return NightAuditWorkflow.prototype.run.call(receiver, event, fakeWorkflowStep());
}

async function provisionViaRegistry(timeZone = 'UTC') {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const propertyId = `prop_na_due_${crypto.randomUUID()}`;
  const orgId = `org_${crypto.randomUUID()}`;
  const provisioned = await provisionProperty(env, {
    orgId,
    propertyId,
    name: 'Not Due Hotel',
    jurisdiction: 'eu',
    timeZone,
    currency: 'USD',
    actorUserId: 'user_owner',
  });
  expect(provisioned.ok).toBe(true);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { propertyId, stub: resolved!.stub };
}

function todayIn(timeZone: string): string {
  return enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('night audit schedule never targets the business day it closes (C)', () => {
  it('provisioned at 00:33 local with audit_time 02:00: next run is 02:00 the NEXT local day', () => {
    const provisionedAt = new Date('2026-11-22T00:33:00.000Z');
    // Old behaviour (no business date): the same day's 02:00 - the incident.
    expect(new Date(nextAuditRunAtMs('UTC', '02:00', provisionedAt)).toISOString()).toBe(
      '2026-11-22T02:00:00.000Z',
    );
    // With the business date (2026-11-22): the first occurrence on a later calendar day.
    expect(
      new Date(nextAuditRunAtMs('UTC', '02:00', provisionedAt, '2026-11-22')).toISOString(),
    ).toBe('2026-11-23T02:00:00.000Z');
  });

  it('DO provisioning at 00:33 stores the next-day occurrence in alarm_schedule', async () => {
    const name = `na-sched-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await stub.ensureMetaPropertyId(name);
    await stub.ensureMetaOrgId('org_test');
    const instant = new Date('2026-11-22T00:33:00.000Z');
    await stub.ensureTimeZoneIfAbsent('UTC', {
      key: `tz:${name}`,
      fingerprint: (await idemFor('tz', { name })).fingerprint,
    });
    await stub.ensureBusinessDateIfAbsent('UTC', instant);
    expect(await stub.readBusinessDate()).toBe('2026-11-22');
    await stub.ensureNightAuditSchedule('UTC', instant);
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(new Date(schedule!.nextRunAt).toISOString()).toBe('2026-11-23T02:00:00.000Z');
  });

  it('catching up (business date behind today) still targets today or later, never the past', () => {
    const instant = new Date('2026-11-22T10:00:00.000Z');
    // bd 2026-11-19 is 3 days behind: first occurrence after now is tomorrow 02:00.
    expect(new Date(nextAuditRunAtMs('UTC', '02:00', instant, '2026-11-19')).toISOString()).toBe(
      '2026-11-23T02:00:00.000Z',
    );
    // Before today's audit time and behind: today's 02:00 is the next valid run.
    expect(
      new Date(nextAuditRunAtMs('UTC', '02:00', new Date('2026-11-22T00:33:00.000Z'), '2026-11-21')).toISOString(),
    ).toBe('2026-11-22T02:00:00.000Z');
  });

  it('DST: spring-forward gap resolves to the next real instant, on a day after the business date', () => {
    // America/New_York 2026-03-08: 02:00 does not exist (clocks jump to 03:00 EDT = 07:00Z).
    const instant = new Date('2026-03-08T04:30:00.000Z'); // 23:30 EST on 2026-03-07
    expect(
      new Date(nextAuditRunAtMs('America/New_York', '02:00', instant, '2026-03-07')).toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
  });

  it('DST: fall-back overlap resolves to the first occurrence', () => {
    // America/New_York 2026-11-01: 01:30 happens twice; first is EDT = 05:30Z.
    const instant = new Date('2026-10-31T12:00:00.000Z');
    expect(
      new Date(nextAuditRunAtMs('America/New_York', '01:30', instant, '2026-10-31')).toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('not-due gate (A)', () => {
  it('startNightAudit on the current business date runs no step and changes nothing', async () => {
    const { stub } = await provisionedPropertyStub(`na-notdue-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    expect(await stub.isNightAuditDue(businessDate)).toBe(false);

    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toEqual({
      ok: false,
      error: NIGHT_AUDIT_NOT_DUE,
    });
    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(businessDate, step)).toBeNull();
    }
    expect(await stub.readBusinessDate()).toBe(businessDate);
  });

  it('isNightAuditDue is true once the day has ended', async () => {
    const { stub } = await provisionedPropertyStub(`na-due-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    expect(await stub.isNightAuditDue(addCalendarDays(today, -1))).toBe(true);
    expect(await stub.isNightAuditDue(today)).toBe(false);
    expect(await stub.isNightAuditDue(addCalendarDays(today, 1))).toBe(false);
  });

  it('NightAuditWorkflow.run() for a business date that has not ended writes no night_audit_run rows and arms the next valid run', async () => {
    const { propertyId, stub } = await provisionViaRegistry('UTC');
    const businessDate = (await stub.readBusinessDate())!;
    expect(businessDate).toBe(todayIn('UTC'));

    await runNightAuditWorkflow(propertyId);

    for (const step of NIGHT_AUDIT_STEPS) {
      expect(await stub.getNightAuditStepStatus(businessDate, step)).toBeNull();
    }
    expect(await stub.readBusinessDate()).toBe(businessDate);
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());
    // The occurrence is on a calendar day after the business date.
    expect(todayIn('UTC') <= businessDate).toBe(true);
    expect(new Date(schedule!.nextRunAt).toISOString().slice(0, 10) > businessDate).toBe(true);
  });

  it('retry / resolve-halt for a date that has not ended are refused with night_audit_not_due', async () => {
    const { stub } = await provisionedPropertyStub(`na-retry-nd-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    await stub.forceNightAuditHaltForTest(today);

    const retry = await stub.tryRetryAuditStep(
      TEST_OWNER_ACTOR,
      { businessDate: today, step: 'PRE_CHECK' },
      await idemFor('retry-nd', { today }),
      { pendingOpenCount: 0 },
    );
    expect(retry).toMatchObject({ ok: false, error: NIGHT_AUDIT_NOT_DUE });

    const resolve = await stub.tryResolveHalt(
      TEST_OWNER_ACTOR,
      { businessDate: today },
      await idemFor('resolve-nd', { today }),
      { pendingOpenCount: 0 },
    );
    expect(resolve).toMatchObject({ ok: false, error: NIGHT_AUDIT_NOT_DUE });
  });
});

describe('a COMPLETED roll counts only if the date moved (B)', () => {
  it('stuck state: all 8 steps COMPLETED for D, business date still D, today D+1 -> next run advances to D+1', async () => {
    const { stub } = await provisionedPropertyStub(`na-stuck-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const d = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(d);
    await runInDurableObject(stub, (_instance, state) => {
      for (const step of NIGHT_AUDIT_STEPS) {
        state.storage.sql.exec(
          `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
           VALUES (?, ?, 'COMPLETED', 1, 1, 1, NULL)`,
          d,
          step,
        );
      }
    });
    expect(await stub.readBusinessDate()).toBe(d);
    expect(await stub.getNightAuditStepStatus(d, 'ROLL_BUSINESS_DATE')).toBe('COMPLETED');

    const result = await stub.startNightAudit({ pendingOpenCount: 0 });
    expect(result).toEqual({ ok: true });
    expect(await stub.readBusinessDate()).toBe(today);
    expect(await stub.getNightAuditStepStatus(d, 'ROLL_BUSINESS_DATE')).toBe('COMPLETED');
  });

  it('a COMPLETED roll whose date already moved is left alone (idempotent)', async () => {
    const { stub } = await provisionedPropertyStub(`na-roll-idem-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const d = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(d);
    for (const step of NIGHT_AUDIT_STEPS) {
      expect((await stub.runAuditStep(d, step, { pendingOpenCount: 0 })).status).toBe('COMPLETED');
    }
    expect(await stub.readBusinessDate()).toBe(today);
    // Re-running the roll for d must not advance again.
    expect(await stub.runAuditStep(d, 'ROLL_BUSINESS_DATE')).toEqual({ status: 'COMPLETED' });
    expect(await stub.readBusinessDate()).toBe(today);
  });
});

describe('no-progress spin guard (D)', () => {
  it('a run that leaves the business date unchanged does not schedule "now"', async () => {
    const { stub } = await provisionedPropertyStub(`na-spin-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const d = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(d);

    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg !== 'string') continue;
        try {
          lines.push(parseLogLine(arg));
        } catch {
          /* not a JSON log line */
        }
      }
    });

    await stub.rescheduleNightAudit(d); // the run "closed" d, yet bd is still d
    const schedule = await stub.getAlarmSchedule('night-audit');
    const expected = nextAuditRunAtMs('UTC', '02:00', new Date(), d);
    expect(schedule!.nextRunAt).toBe(expected);
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());

    const warn = lines.find((l) => l.msg === 'night_audit.no_progress');
    expect(warn).toMatchObject({ level: 'warn', business_date: d });
    expect(JSON.stringify(warn)).not.toContain('error');
  });

  it('legit catch-up: each run advances one day and reschedules "now" while still behind', async () => {
    const { stub } = await provisionedPropertyStub(`na-catchup-${crypto.randomUUID()}`, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    let bd = addCalendarDays(today, -3);
    await stub.setBusinessDateForTest(bd);

    for (let i = 0; i < 3; i++) {
      const closed = bd;
      for (const step of NIGHT_AUDIT_STEPS) {
        expect((await stub.runAuditStep(closed, step, { pendingOpenCount: 0 })).status).toBe('COMPLETED');
      }
      bd = (await stub.readBusinessDate())!;
      expect(bd).toBe(addCalendarDays(closed, 1));

      const before = Date.now();
      await stub.rescheduleNightAudit(closed);
      const schedule = await stub.getAlarmSchedule('night-audit');
      if (bd < today) {
        expect(schedule!.nextRunAt).toBeGreaterThanOrEqual(before);
        expect(schedule!.nextRunAt).toBeLessThanOrEqual(Date.now() + 5000);
      } else {
        expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());
      }
    }
    expect(await stub.readBusinessDate()).toBe(today);
  });

  it('NightAuditWorkflow.run() on the stuck state repairs it and does not leave the schedule at "now"', async () => {
    const { propertyId, stub } = await provisionViaRegistry('UTC');
    const today = (await stub.readBusinessDate())!;
    const d = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(d);
    await runInDurableObject(stub, (_instance, state) => {
      for (const step of NIGHT_AUDIT_STEPS) {
        state.storage.sql.exec(
          `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
           VALUES (?, ?, 'COMPLETED', 1, 1, 1, NULL)`,
          d,
          step,
        );
      }
    });

    await runNightAuditWorkflow(propertyId);

    expect(await stub.readBusinessDate()).toBe(today);
    const schedule = await stub.getAlarmSchedule('night-audit');
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());
  });
});

describe('never-dark re-arm (E)', () => {
  it('a DO with alarm_schedule rows but no storage alarm is re-armed when it wakes', async () => {
    const name = `na-dark-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    expect(await stub.getAlarmSchedule('night-audit')).not.toBeNull();

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });

    // Wake: evict the instance so the constructor runs again.
    const cf = (await import('cloudflare:test')) as typeof import('cloudflare:test') & {
      evictDurableObject?: (s: DurableObjectStub) => Promise<void>;
    };
    if (typeof cf.evictDurableObject === 'function') {
      await cf.evictDurableObject(stub);
    } else {
      try {
        await runInDurableObject(stub, (_instance, state) => {
          state.abort('wake');
        });
      } catch {
        /* abort tears the instance down */
      }
    }
    // Calls right after an abort can surface the abort itself ("wake"); a retry reaches a
    // fresh instance (constructor -> blockConcurrencyWhile -> ensureArmed).
    let armed: number | null | undefined;
    for (let attempt = 0; attempt < 5 && armed === undefined; attempt++) {
      try {
        const fresh = propertyStub(name, orgId);
        await fresh.readBusinessDate();
        armed = await runInDurableObject(fresh, (_instance, state) => state.storage.getAlarm());
      } catch {
        /* broken output gate from the abort */
      }
    }
    expect(armed).toBeTypeOf('number');
  });
});

describe('audit_time must be a morning HH:MM (F)', () => {
  async function put(stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'], value: unknown, n: string) {
    return stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.night_audit.audit_time',
      value,
      { reason: 'test:audit-time' },
      await idemFor(`audit-time-${n}`, {
        key: 'pms.night_audit.audit_time',
        value,
        reason: 'test:audit-time',
      }),
    );
  }

  it.each(['02:00', '00:00', '11:59'])('accepts %s', async (value) => {
    const { stub } = await provisionedPropertyStub(`na-at-ok-${crypto.randomUUID()}`, 'UTC', 'USD');
    expect(await put(stub, value, value)).toMatchObject({ ok: true });
  });

  it.each(['12:00', '23:00', '2:00', '25:00', '02:60', '02:00:00', 'abc', '', 200])(
    'rejects %s with invalid_audit_time',
    async (value) => {
      const { stub } = await provisionedPropertyStub(`na-at-bad-${crypto.randomUUID()}`, 'UTC', 'USD');
      expect(await put(stub, value, String(value))).toEqual({ ok: false, error: INVALID_AUDIT_TIME });
    },
  );
});
