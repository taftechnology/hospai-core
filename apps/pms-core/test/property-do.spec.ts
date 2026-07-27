import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload, IDEM_KEY_REUSED } from '@hospai/contracts';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/property-do';

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

async function configIdem(key: string, value: unknown, meta: { actor: string; reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    actor: meta.actor,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

describe('PropertyDO freeze gate', () => {
  it('migrates to schema version 2', async () => {
    const stub = propertyStub(`migrate-${crypto.randomUUID()}`);
    expect(await stub.getSchemaVersion()).toBe(2);
  });

  it('defaults held to 0 and computes free', async () => {
    const stub = propertyStub(`ari-${crypto.randomUUID()}`);
    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      physical: 10,
      blocked: 1,
      sold: 2,
      oversell: 1,
    });
    const row = await stub.readAvailabilityDay('rt_king', '2026-08-01');
    expect(row?.held).toBe(0);
    expect(row?.free).toBe(8);
  });

  it('bumps availability version monotonically on re-seed', async () => {
    const stub = propertyStub(`ver-${crypto.randomUUID()}`);
    const v1 = await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      physical: 10,
    });
    const v2 = await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      physical: 9,
    });
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect((await stub.readAvailabilityDay('rt_king', '2026-08-01'))?.version).toBe(2);
  });

  it('stores DOMAIN config with audit trail and config.changed outbox', async () => {
    const stub = propertyStub(`cfg-${crypto.randomUUID()}`);
    const meta = { actor: 'tester', reason: 'verification' };
    const idem = await configIdem('pms.availability.allow_overbooking', true, meta);
    const put = await stub.tryPutDomainConfig('pms.availability.allow_overbooking', true, meta, idem);
    expect(put.ok).toBe(true);
    if (put.ok) expect(put.events).toContain('config.changed');
    expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);

    const rejected = await stub.tryPutDomainConfig(
      'pms.ui.date_format',
      'ISO',
      meta,
      await configIdem('pms.ui.date_format', 'ISO', meta),
    );
    expect(rejected.ok).toBe(false);
  });

  it('replay same idempotency key does not double-write or double-emit', async () => {
    const stub = propertyStub(`idem-${crypto.randomUUID()}`);
    const meta = { actor: 'tester', reason: 'replay' };
    const key = 'pms.availability.allow_overbooking';
    const idem = {
      key: 'fixed-key-1',
      fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }),
    };
    const first = await stub.tryPutDomainConfig(key, true, meta, idem);
    expect(first.ok).toBe(true);
    const version1 = first.ok ? first.version : -1;
    expect(await stub.outboxUnackedCount()).toBe(1);

    const second = await stub.tryPutDomainConfig(key, true, meta, idem);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.version).toBe(version1);
    expect(await stub.outboxUnackedCount()).toBe(1);
  });

  it('fingerprint conflict returns idempotency_key_reused', async () => {
    const stub = propertyStub(`idem-conflict-${crypto.randomUUID()}`);
    const meta = { actor: 'tester', reason: 'conflict' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(key, true, meta, {
      key: 'fixed-key-2',
      fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }),
    });
    const conflict = await stub.tryPutDomainConfig(key, false, meta, {
      key: 'fixed-key-2',
      fingerprint: await fingerprintPayload({ key, value: false, actor: meta.actor, reason: meta.reason }),
    });
    expect(conflict).toEqual({ ok: false, error: IDEM_KEY_REUSED });
    expect(await stub.readConfig(key)).toBe(true);
  });

  it('drain without ack leaves rows; flush acks', async () => {
    const stub = propertyStub(`flush-${crypto.randomUUID()}`);
    const meta = { actor: 'tester', reason: 'flush' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(key, true, meta, {
      key: 'fixed-key-3',
      fingerprint: await fingerprintPayload({ key, value: true, actor: meta.actor, reason: meta.reason }),
    });
    const drained = await stub.drainOutboxBatch();
    expect(drained.length).toBeGreaterThanOrEqual(1);
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);
    await stub.ackOutboxThrough(drained[drained.length - 1]!.seq);
    expect(await stub.outboxUnackedCount()).toBe(0);

    // second write + flushOutbox
    await stub.tryPutDomainConfig(key, false, meta, {
      key: 'fixed-key-4',
      fingerprint: await fingerprintPayload({ key, value: false, actor: meta.actor, reason: meta.reason }),
    });
    const flushed = await stub.flushOutbox();
    expect(flushed.flushed).toBeGreaterThanOrEqual(1);
    expect(await stub.outboxUnackedCount()).toBe(0);
  });

  it('rejects duplicate type-wide restriction_day rows (rate_plan_id DEFAULT *)', async () => {
    const stub = propertyStub(`rest-${crypto.randomUUID()}`);
    await stub.upsertRestrictionDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      minLos: 2,
    });
    await stub.upsertRestrictionDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      minLos: 5,
    });
    await stub.upsertRestrictionDay({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-01',
      minLos: 9,
    });
    expect(await stub.countRestrictionDays('rt_king', '2026-08-01')).toBe(1);
  });

  it('requires folio_window for folio_line FK', async () => {
    const stub = propertyStub(`folio-${crypto.randomUUID()}`);
    await stub.createFolioWindow({
      folioWindowId: 'fw_1',
      reservationId: 'res_1',
      kind: 'GUEST',
    });
    await stub.addFolioLine({
      folioLineId: 'fl_1',
      folioWindowId: 'fw_1',
      reservationId: 'res_1',
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'USD',
      ledgerAmountMinor: 10000,
      fxRate: '1',
      fxRateAt: 1_700_000_000_000,
    });

    const result = await stub.tryAddFolioLine({
      folioLineId: 'fl_2',
      folioWindowId: 'fw_missing',
      reservationId: 'res_1',
      chargeCode: 'ROOM',
      amountMinor: 100,
      txnCurrency: 'USD',
      ledgerAmountMinor: 100,
      fxRate: '1',
    });
    expect(result.ok).toBe(false);
  });

  it('night-audit lines require business_date (CHECK) and unique index', async () => {
    const stub = propertyStub(`audit-${crypto.randomUUID()}`);
    await stub.createFolioWindow({
      folioWindowId: 'fw_a',
      reservationId: 'RES1',
      kind: 'GUEST',
    });

    const missingDate = await stub.tryAddFolioLine({
      folioLineId: 'fl_na_1',
      folioWindowId: 'fw_a',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      txnCurrency: 'USD',
      ledgerAmountMinor: 20000,
      fxRate: '1',
      source: 'NIGHT_AUDIT',
    });
    expect(missingDate.ok).toBe(false);

    const first = await stub.tryAddFolioLine({
      folioLineId: 'fl_na_2',
      folioWindowId: 'fw_a',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      txnCurrency: 'USD',
      ledgerAmountMinor: 20000,
      fxRate: '1',
      source: 'NIGHT_AUDIT',
      businessDate: '2026-08-01',
    });
    expect(first.ok).toBe(true);

    const dup = await stub.tryAddFolioLine({
      folioLineId: 'fl_na_3',
      folioWindowId: 'fw_a',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      txnCurrency: 'USD',
      ledgerAmountMinor: 20000,
      fxRate: '1',
      source: 'NIGHT_AUDIT',
      businessDate: '2026-08-01',
    });
    expect(dup.ok).toBe(false);
  });
});
