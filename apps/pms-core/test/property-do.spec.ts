import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CURRENCY_UNSET,
  fingerprintPayload,
  FX_RATE_INVALID,
  IDEM_KEY_REUSED,
  LEDGER_AMOUNT_MISMATCH,
  MONEY_INVALID,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { ensureEntitledMeta, idemFor, propertyStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';

async function configIdem(key: string, value: unknown, meta: { reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

describe('PropertyDO freeze gate', () => {
  it('migrates to schema version 16', async () => {
    const stub = propertyStub(`migrate-${crypto.randomUUID()}`);
    expect(await stub.getSchemaVersion()).toBe(16);
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
    const name = `cfg-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await ensureEntitledMeta(stub, name);
    const meta = { reason: 'verification' };
    const idem = await configIdem('pms.availability.allow_overbooking', true, meta);
    const put = await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, 'pms.availability.allow_overbooking', true, meta, idem);
    expect(put.ok).toBe(true);
    if (put.ok) expect(put.events).toContain('config.changed');
    expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);

    const rejected = await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.ui.date_format',
      'ISO',
      meta,
      await configIdem('pms.ui.date_format', 'ISO', meta),
    );
    expect(rejected.ok).toBe(false);
  });

  it('replay same idempotency key does not double-write or double-emit', async () => {
    const name = `idem-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await ensureEntitledMeta(stub, name);
    const meta = { reason: 'replay' };
    const key = 'pms.availability.allow_overbooking';
    const idem = {
      key: 'fixed-key-1',
      fingerprint: await fingerprintPayload({ key, value: true, reason: meta.reason }),
    };
    const first = await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, idem);
    expect(first.ok).toBe(true);
    const version1 = first.ok ? first.version : -1;
    expect(await stub.outboxUnackedCount()).toBe(1);

    const second = await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, idem);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.version).toBe(version1);
    expect(await stub.outboxUnackedCount()).toBe(1);
  });

  it('fingerprint conflict returns idempotency_key_reused', async () => {
    const name = `idem-conflict-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await ensureEntitledMeta(stub, name);
    const meta = { reason: 'conflict' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, {
      key: 'fixed-key-2',
      fingerprint: await fingerprintPayload({ key, value: true, reason: meta.reason }),
    });
    const conflict = await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, false, meta, {
      key: 'fixed-key-2',
      fingerprint: await fingerprintPayload({ key, value: false, reason: meta.reason }),
    });
    expect(conflict).toEqual({ ok: false, error: IDEM_KEY_REUSED });
    expect(await stub.readConfig(key)).toBe(true);
  });

  it('drain without ack leaves rows; flush acks', async () => {
    const name = `flush-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await ensureEntitledMeta(stub, name);
    const meta = { reason: 'flush' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, {
      key: 'fixed-key-3',
      fingerprint: await fingerprintPayload({ key, value: true, reason: meta.reason }),
    });
    const drained = await stub.drainOutboxBatch();
    expect(drained.length).toBeGreaterThanOrEqual(1);
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(1);
    await stub.ackOutboxThrough(drained[drained.length - 1]!.seq);
    expect(await stub.outboxUnackedCount()).toBe(0);

    // second write + flushOutbox
    await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, false, meta, {
      key: 'fixed-key-4',
      fingerprint: await fingerprintPayload({ key, value: false, reason: meta.reason }),
    });
    const flushed = await stub.flushOutbox();
    expect(flushed.flushed).toBeGreaterThanOrEqual(1);
    expect(await stub.outboxUnackedCount()).toBe(0);
  });

  it('rejects duplicate type-wide restriction_day rows (rate_plan_id DEFAULT *)', async () => {
    const stub = propertyStub(`rest-${crypto.randomUUID()}`);
    await stub.ensureMetaPropertyId('rest-test');
    await ensureEntitledMeta(stub);
    const restrictionBody = {
      roomTypeId: 'rt_king',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: '2026-08-01',
      minLos: 2,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: false,
    };
    await stub.tryUpsertRestrictionDay(
      TEST_OWNER_ACTOR,
      restrictionBody,
      await idemFor('rest-1', restrictionBody),
    );
    await stub.tryUpsertRestrictionDay(
      TEST_OWNER_ACTOR,
      { ...restrictionBody, minLos: 5 },
      await idemFor('rest-2', { ...restrictionBody, minLos: 5 }),
    );
    await stub.tryUpsertRestrictionDay(
      TEST_OWNER_ACTOR,
      { ...restrictionBody, minLos: 9 },
      await idemFor('rest-3', { ...restrictionBody, minLos: 9 }),
    );
    expect(await stub.countRestrictionDays('rt_king', '2026-08-01')).toBe(1);
  });

  it('returns NOT_FOUND when reservation is missing', async () => {
    const name = `folio-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'America/New_York', 'USD');
    const missingReservation = {
      folioLineId: 'fl_2',
      reservationId: 'res_missing',
      chargeCode: 'ROOM',
      amountMinor: 100,
    };
    const result = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      missingReservation,
      await idemFor('folio-missing-res', missingReservation),
    );
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('night-audit lines require business_date (CHECK) and unique index', async () => {
    const name = `audit-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'America/New_York', 'USD');
    await stub.insertReservationForTest({
      reservationId: 'RES1',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-05',
    });

    const missingDateInput = {
      folioLineId: 'fl_na_1',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      source: 'NIGHT_AUDIT',
    };
    const missingDate = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      missingDateInput,
      await idemFor('folio-na-missing-date', missingDateInput),
    );
    expect(missingDate.ok).toBe(false);

    const firstInput = {
      folioLineId: 'fl_na_2',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      source: 'NIGHT_AUDIT',
      businessDate: '2026-08-01',
    };
    const first = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      firstInput,
      await idemFor('folio-na-first', firstInput),
    );
    expect(first.ok).toBe(true);

    const dupInput = {
      folioLineId: 'fl_na_3',
      reservationId: 'RES1',
      chargeCode: 'ROOM',
      amountMinor: 20000,
      source: 'NIGHT_AUDIT',
      businessDate: '2026-08-01',
    };
    const dup = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      dupInput,
      await idemFor('folio-na-dup', dupInput),
    );
    expect(dup.ok).toBe(false);
  });

  it('folio line money validation returns wire codes before storage', async () => {
    const name = `money-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'America/New_York', 'USD');
    await stub.insertReservationForTest({
      reservationId: 'res_m',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-02',
    });

    const unsetName = `unset-${crypto.randomUUID()}`;
    const unsetStub = propertyStub(unsetName);
    await ensureEntitledMeta(unsetStub);
    await unsetStub.ensureMetaPropertyId(unsetName);
    const unsetInput = {
      folioLineId: 'fl_unset',
      reservationId: 'res_any',
      chargeCode: 'ROOM',
      amountMinor: 100,
      txnCurrency: 'USD',
      ledgerAmountMinor: 100,
      fxRate: '1',
    };
    expect(
      await unsetStub.tryAddFolioLine(TEST_OWNER_ACTOR, unsetInput, await idemFor('folio-unset', unsetInput)),
    ).toEqual({
      ok: false,
      error: CURRENCY_UNSET,
    });

    const badFxInput = {
      folioLineId: 'fl_bad_fx',
      reservationId: 'res_m',
      chargeCode: 'ROOM',
      amountMinor: 100,
      txnCurrency: 'USD',
      ledgerAmountMinor: 100,
      fxRate: 'not-a-rate',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, badFxInput, await idemFor('folio-bad-fx', badFxInput))).toEqual({
      ok: false,
      error: FX_RATE_INVALID,
    });

    const mismatchInput = {
      folioLineId: 'fl_mismatch',
      reservationId: 'res_m',
      chargeCode: 'ROOM',
      amountMinor: 100,
      txnCurrency: 'USD',
      ledgerAmountMinor: 999,
      fxRate: '1',
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, mismatchInput, await idemFor('folio-mismatch', mismatchInput)),
    ).toEqual({
      ok: false,
      error: LEDGER_AMOUNT_MISMATCH,
    });

    const invalidInput = {
      folioLineId: 'fl_invalid',
      reservationId: 'res_m',
      chargeCode: 'ROOM',
      amountMinor: 1.5,
      txnCurrency: 'USD',
      ledgerAmountMinor: 2,
      fxRate: '1',
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, invalidInput, await idemFor('folio-invalid', invalidInput)),
    ).toEqual({
      ok: false,
      error: MONEY_INVALID,
    });
  });

  it('folio line post is idempotent and emits folio.line_posted', async () => {
    const name = `folio-idem-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'America/New_York', 'USD');
    await stub.insertReservationForTest({
      reservationId: 'res_i',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-02',
    });

    const input = {
      folioLineId: 'fl_idem',
      reservationId: 'res_i',
      chargeCode: 'ROOM',
      amountMinor: 5000,
    };
    const idem = await idemFor('folio-idem-post', input);
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, input, idem)).toMatchObject({ ok: true });
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, input, idem)).toMatchObject({ ok: true });

    const replayWrong = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, input, {
      key: idem.key,
      fingerprint: 'different-fingerprint',
    });
    expect(replayWrong).toEqual({ ok: false, error: IDEM_KEY_REUSED });

    expect(await stub.listOutboxEventTypes()).toContain('folio.line_posted');
    await stub.flushOutbox();
  });
});
