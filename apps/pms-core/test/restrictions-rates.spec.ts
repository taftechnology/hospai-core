import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload, RESTRICTION_VIOLATED, RATE_MISSING } from '@hospai/contracts';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/property-do';

const LEGACY_GUEST = { guestRef: 'legacy', piiKeyId: 'legacy' } as const;

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

async function provisionedStub(name: string): Promise<DurableObjectStub<PropertyDO>> {
  const stub = propertyStub(name);
  await stub.ensureMetaPropertyId(name);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'UTC' });
  await stub.ensureTimeZoneIfAbsent('UTC', { key: `provision:timezone:${name}`, fingerprint });
  await stub.ensureBusinessDateIfAbsent('UTC', new Date());
  await stub.ensureNightAuditSchedule('UTC', new Date());
  await stub.flushOutbox();
  return stub;
}

async function idemFor(key: string, payload: unknown) {
  return { key, fingerprint: await fingerprintPayload(payload) };
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

describe('PropertyDO restrictions + rates', () => {
  it('1. min_los on arrival blocks create in the book txn', async () => {
    const name = `restrict-${crypto.randomUUID()}`;
    const stub = await provisionedStub(name);
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-r', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const arrival = added.fromDate;
    const restriction = {
      roomTypeId: 'rt_king',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: arrival,
      minLos: 3,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: false,
    };
    expect(await stub.tryUpsertRestrictionDay(restriction, await idemFor('ups-r', restriction))).toMatchObject({
      ok: true,
    });

    const book = {
      reservationId: 'res_min',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 2),
    };
    expect(await stub.tryCreateReservation(book, await idemFor('book-min', book))).toEqual({
      ok: false,
      error: RESTRICTION_VIOLATED,
      rule: 'min_los',
      date: arrival,
      required: 3,
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('2. materialized rate_day enables quote across a stay', async () => {
    const name = `rates-${crypto.randomUUID()}`;
    const stub = await provisionedStub(name);
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-rate', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const arrival = added.fromDate;
    const second = addDays(arrival, 1);
    for (const [stayDate, amountMinor] of [
      [arrival, 10000],
      [second, 12000],
    ] as const) {
      const rate = {
        roomTypeId: 'rt_king',
        ratePlanId: 'BAR',
        stayDate,
        amountMinor,
        currency: 'EUR',
      };
      expect(await stub.tryUpsertRateDay(rate, await idemFor(`rate-${stayDate}`, rate))).toMatchObject({
        ok: true,
      });
    }

    expect(
      await stub.quoteStay({
        roomTypeId: 'rt_king',
        arrivalDate: arrival,
        departureDate: addDays(arrival, 2),
      }),
    ).toEqual({ ok: true, totalMinor: 22000, currency: 'EUR' });

    expect(
      await stub.quoteStay({
        roomTypeId: 'rt_king',
        arrivalDate: arrival,
        departureDate: addDays(arrival, 3),
      }),
    ).toEqual({ ok: false, error: RATE_MISSING, date: addDays(arrival, 2) });
  });
});
