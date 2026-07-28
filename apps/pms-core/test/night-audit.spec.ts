import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload } from '@hospai/contracts';
import { enumerateFromDate, HORIZON_DAYS } from '@hospai/pms-inventory';
import { resolvePropertyStub } from '@hospai/tenant-router';
import { NIGHT_AUDIT_HALTED, NIGHT_AUDIT_STEPS } from '../src/property-do';
import type { PropertyDO } from '../src/property-do';

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

/** Provision a fresh PropertyDO stub with `__meta.property_id` + stored timezone + business_date. */
async function provisionedStub(name: string, timeZone: string): Promise<DurableObjectStub<PropertyDO>> {
  const stub = propertyStub(name);
  await stub.ensureMetaPropertyId(name);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone });
  await stub.ensureTimeZoneIfAbsent(timeZone, { key: `provision:timezone:${name}`, fingerprint });
  const instant = new Date();
  await stub.ensureBusinessDateIfAbsent(timeZone, instant);
  await stub.ensureNightAuditSchedule(timeZone, instant);
  // Drain the provisioning `config.changed` event so outbox assertions below start clean.
  await stub.flushOutbox();
  return stub;
}

async function idemFor(key: string, payload: unknown) {
  return { key, fingerprint: await fingerprintPayload(payload) };
}

describe('PropertyDO night audit', () => {
  it('3. catch-up set-reconcile fills gaps with physical = room_count; idempotent re-run inserts nothing', async () => {
    const name = `na-catchup-${crypto.randomUUID()}`;
    const stub = await provisionedStub(name, 'Europe/Berlin');
    const businessDate = (await stub.readBusinessDate())!;
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-catchup', addInput));
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
    const stub = await provisionedStub(name, timeZone);

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
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-rolls', addInput));
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
    const stub = await provisionedStub(name, timeZone);
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-current', addInput));
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
    const stub = await provisionedStub(name, 'Europe/Berlin');
    const businessDate = (await stub.readBusinessDate())!;
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-archived', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const deleteInput = { roomTypeId: 'rt_king' };
    const archived = await stub.tryDeleteRoomType(deleteInput, await idemFor('archive-for-na', deleteInput));
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
    const stub = await provisionedStub(name, timeZone);

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
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-steps', addInput));
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
