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

  it('stores DOMAIN config and rejects non-DOMAIN', async () => {
    const stub = propertyStub(`cfg-${crypto.randomUUID()}`);
    await stub.putDomainConfig('pms.availability.allow_overbooking', true);
    expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);

    const result = await stub.tryPutDomainConfig('pms.ui.date_format', 'ISO');
    expect(result.ok).toBe(false);
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
});
