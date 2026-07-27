import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/index';

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

describe('PropertyDO freeze gate', () => {
  it('migrates to schema version 1', async () => {
    const stub = propertyStub(`migrate-${crypto.randomUUID()}`);
    expect(await stub.getSchemaVersion()).toBe(1);
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
    const put = await stub.tryPutDomainConfig('pms.availability.allow_overbooking', true, {
      actor: 'tester',
      reason: 'verification',
    });
    expect(put.ok).toBe(true);
    if (put.ok) {
      expect(put.events).toContain('config.changed');
    }
    expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);

    const result = await stub.tryPutDomainConfig('pms.ui.date_format', 'ISO');
    expect(result.ok).toBe(false);
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
