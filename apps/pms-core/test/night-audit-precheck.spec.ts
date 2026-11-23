import { env, createMessageBatch } from 'cloudflare:test';
import { fingerprintPayload, commandFingerprint, type PendingCommandMessage, type ProvisionalExceptionRow } from '@hospai/contracts';
import { describe, expect, it } from 'vitest';
import { handlePendingCommandsBatch } from '../src/pending-commands-consumer.js';
import { enqueueProvisionalCommand } from '../src/provisional-queue.js';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, seedSubscription } from '../src/registry.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';
import { addCalendarDays } from './date-helpers';

const EMPTY_CENSUS = { pendingOpenCount: 0 };

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sampleExceptionCmd(businessDate: string) {
  return {
    idempotencyKey: `idem_${crypto.randomUUID()}`,
    requestFingerprint: 'fp',
    propertyId: 'p',
    orgId: 'o',
    issuedAt: new Date().toISOString(),
    businessDate,
    actor: { userId: 'u1' },
    command: { type: 'folio.add_item' as const, payload: {} },
    routeId: 'post_folio_add_item',
  };
}

describe('night-audit PRE_CHECK + exception resolve', () => {
  it('1: empty pending + no open exceptions → COMPLETED; omitted census → FAILED pending_census_required', async () => {
    const { stub } = await provisionedPropertyStub(`na-pc-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const ok = await stub.runAuditStep(d, 'PRE_CHECK', EMPTY_CENSUS);
    expect(ok.status).toBe('COMPLETED');
    expect(await stub.readBusinessDate()).toBe(d);

    const missing = await stub.runAuditStep(d, 'POST_ROOM_CHARGES');
    expect(missing.status).toBe('COMPLETED');

    const { stub: stub2 } = await provisionedPropertyStub(`na-pc2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d2 = (await stub2.readBusinessDate())!;
    const fail = await stub2.runAuditStep(d2, 'PRE_CHECK');
    expect(fail.status).toBe('FAILED');
    expect(fail.error).toMatch(/pending_census_required/);
    expect(await stub2.isNightAuditHalted()).toBe(true);
  });

  it('2: pendingOpenCount 1 → FAILED pending_commands_undrained, halt, no roll', async () => {
    const { stub } = await provisionedPropertyStub(`na-pc-undrained-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const fail = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 1 });
    expect(fail.status).toBe('FAILED');
    expect(fail.error).toMatch(/pending_commands_undrained/);
    expect(await stub.isNightAuditHalted()).toBe(true);
    expect(await stub.readBusinessDate()).toBe(d);
  });

  it('3: closing-date open exception → FAILED; other-date open → COMPLETED; resolved closing-date → COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-pc-ex-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.recordProvisionalException(sampleExceptionCmd(d), 'domain_error', null);
    const fail = await stub.runAuditStep(d, 'PRE_CHECK', EMPTY_CENSUS);
    expect(fail.status).toBe('FAILED');
    expect(fail.error).toMatch(/provisional_exceptions_open/);

    const { stub: stubOther } = await provisionedPropertyStub(`na-pc-ex-o-${crypto.randomUUID()}`, 'UTC', 'USD');
    const dOther = (await stubOther.readBusinessDate())!;
    await stubOther.recordProvisionalException(sampleExceptionCmd(addDays(dOther, -1)), 'domain_error', null);
    const okOther = await stubOther.runAuditStep(dOther, 'PRE_CHECK', EMPTY_CENSUS);
    expect(okOther.status).toBe('COMPLETED');

    const { stub: stubResolved } = await provisionedPropertyStub(`na-pc-ex-r-${crypto.randomUUID()}`, 'UTC', 'USD');
    const dResolved = (await stubResolved.readBusinessDate())!;
    await stubResolved.recordProvisionalException(sampleExceptionCmd(dResolved), 'domain_error', null);
    const listed = await stubResolved.listProvisionalExceptions() as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(listed.exceptions).toHaveLength(1);
    const resolved = await stubResolved.tryResolveProvisionalException(
      TEST_OWNER_ACTOR,
      { exceptionId: listed.exceptions[0]!.exceptionId },
      await idemFor(`resolve-${listed.exceptions[0]!.exceptionId}`, {
        propertyId: `na-pc-ex-r`,
        exceptionId: listed.exceptions[0]!.exceptionId,
      }),
    );
    expect(resolved).toMatchObject({ ok: true });
    const okResolved = await stubResolved.runAuditStep(dResolved, 'PRE_CHECK', EMPTY_CENSUS);
    expect(okResolved.status).toBe('COMPLETED');
  });

  it('6: missed PRE_CHECK — force roll then replay closed-date provisional → exception, zero folio mutation', async () => {
    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_na_miss_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'starter');
    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Missed Precheck Hotel',
      jurisdiction: 'eu',
      timeZone: 'UTC',
      currency: 'USD',
      actorUserId: 'user_owner',
    });
    expect(provisioned.ok).toBe(true);
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    const original = (await stub.readBusinessDate())!;
    const closedD = addDays(original, -1);
    await stub.setBusinessDateForTest(closedD);
    const roll = await stub.runAuditStep(closedD, 'ROLL_BUSINESS_DATE');
    expect(roll.status).toBe('COMPLETED');
    expect(await stub.readBusinessDate()).toBe(original);

    const payload = {
      reservationId: 'res_missed',
      folioLineId: `res_missed:item:${crypto.randomUUID()}`,
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    const idempotencyKey = `idem_${crypto.randomUUID()}`;
    await enqueueProvisionalCommand(env, {
      idempotencyKey,
      requestFingerprint: await commandFingerprint('folio.add_item', payload),
      propertyId,
      orgId,
      issuedAt: new Date().toISOString(),
      businessDate: closedD,
      actor: { userId: 'user_owner' },
      command: { type: 'folio.add_item', payload },
      routeId: 'post_folio_add_item',
    });

    const body: PendingCommandMessage = {
      v: 1,
      provisional: {
        idempotencyKey,
        requestFingerprint: await commandFingerprint('folio.add_item', payload),
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: closedD,
        actor: { userId: 'user_owner' },
        command: { type: 'folio.add_item', payload },
        routeId: 'post_folio_add_item',
      },
      enqueuedAt: new Date().toISOString(),
    };
    const batch = createMessageBatch('hospai-pending-commands', [
      {
        id: `pending-${idempotencyKey}`,
        timestamp: new Date(),
        attempts: 1,
        body,
      },
    ]);
    await handlePendingCommandsBatch(batch as MessageBatch<PendingCommandMessage>, env);

    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe('business_date_closed');
    expect(await stub.countFolioLines()).toBe(0);
  });

  it('tryResolveProvisionalException stamps columns, is acknowledge-only, and drops the badge', async () => {
    const name = `na-pc-resolve-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await stub.recordProvisionalException(sampleExceptionCmd((await stub.readBusinessDate())!), 'domain_error', null);
    expect(await stub.countProvisionalExceptions()).toBe(1);
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    const exceptionId = exceptions[0]!.exceptionId;
    expect(exceptions[0]!.resolvedAt).toBeNull();

    const first = await stub.tryResolveProvisionalException(
      TEST_OWNER_ACTOR,
      { exceptionId },
      await idemFor(`resolve-${exceptionId}`, { propertyId: name, exceptionId }),
    );
    expect(first).toEqual({ ok: true });
    expect(await stub.countProvisionalExceptions()).toBe(0);
    expect((await stub.listProvisionalExceptions() as { exceptions: unknown[] }).exceptions).toHaveLength(0);
    expect(await stub.listOutboxEventTypes()).toContain('provisional.exception_resolved');
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, {});
    expect(audit).toMatchObject({ ok: true });
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string }> }).rows;
    expect(rows.some((r) => r.commandId === 'provisional.resolve_exception')).toBe(true);

    const second = await stub.tryResolveProvisionalException(
      TEST_OWNER_ACTOR,
      { exceptionId },
      await idemFor(`resolve-again-${exceptionId}`, { propertyId: name, exceptionId }),
    );
    expect(second).toEqual({ ok: true, alreadyResolved: true });
    const audit2 = await stub.listAuditLog(TEST_OWNER_ACTOR, {});
    expect(audit2).toMatchObject({ ok: true });
    const rows2 = (audit2 as unknown as { ok: true; rows: Array<{ commandId: string }> }).rows;
    expect(rows2.filter((r) => r.commandId === 'provisional.resolve_exception')).toHaveLength(1);

    const missing = await stub.tryResolveProvisionalException(
      TEST_OWNER_ACTOR,
      { exceptionId: crypto.randomUUID() },
      await idemFor(`resolve-missing-${crypto.randomUUID()}`, { propertyId: name, exceptionId: 'missing' }),
    );
    expect(missing).toEqual({ ok: false, error: 'not_found' });
  });

  it('tryRetryAuditStep re-runs FAILED PRE_CHECK with a fresh census', async () => {
    const name = `na-pc-retry-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    // Retry is only allowed for a business date that has ended.
    const d = addCalendarDays((await stub.readBusinessDate())!, -1);
    await stub.setBusinessDateForTest(d);
    const fail = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 1 });
    expect(fail.status).toBe('FAILED');

    const retried = await stub.tryRetryAuditStep(
      TEST_OWNER_ACTOR,
      { businessDate: d, step: 'PRE_CHECK' },
      await idemFor(`retry-${name}`, { propertyId: name, businessDate: d, step: 'PRE_CHECK' }),
      EMPTY_CENSUS,
    );
    expect(retried).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(await stub.isNightAuditHalted()).toBe(false);
    expect(await stub.listOutboxEventTypes()).toContain('night_audit.step_retried');

    const notFailed = await stub.tryRetryAuditStep(
      TEST_OWNER_ACTOR,
      { businessDate: d, step: 'PRE_CHECK' },
      await idemFor(`retry-again-${name}`, { propertyId: name, businessDate: d, step: 'PRE_CHECK' }),
      EMPTY_CENSUS,
    );
    expect(notFailed).toEqual({ ok: false, error: 'night_audit_step_not_failed' });
  });
});
