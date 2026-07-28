import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload, GUEST_ALREADY_ERASED, GUEST_NOT_FOUND } from '@hospai/contracts';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/property-do';
import { createGuest, idemFor, provisionedOrg } from './guest-helpers';

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

async function provisionedProperty(name: string): Promise<DurableObjectStub<PropertyDO>> {
  const stub = propertyStub(name);
  await stub.ensureMetaPropertyId(name);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'UTC' });
  await stub.ensureTimeZoneIfAbsent('UTC', { key: `provision:timezone:${name}`, fingerprint });
  await stub.ensureBusinessDateIfAbsent('UTC', new Date());
  await stub.ensureNightAuditSchedule('UTC', new Date());
  await stub.flushOutbox();
  return stub;
}

describe('OrgDO guests + crypto-shredding', () => {
  it('1. create guest encrypts profile and emits guest.created without PII', async () => {
    const org = await provisionedOrg(`org-guest-${crypto.randomUUID()}`);
    const guestId = 'guest_ada';
    const displayName = 'Ada Lovelace';
    const refs = await createGuest(org, guestId, displayName);

    expect(await org.readGuestProfile(guestId)).toEqual({ displayName });
    expect(refs.piiKeyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const payloads = await org.listOutboxPayloads();
    expect(payloads.map((p) => p.eventType)).toEqual(['guest.created']);
    const body = payloads[0]!.payload;
    expect(body).toContain('"guestRef":"guest_ada"');
    expect(body).toContain('"piiKeyId"');
    expect(body).not.toContain(displayName);
    expect(body).not.toContain('Lovelace');
  });

  it('2. erase guest shreds key — profile undecodable, guest.erased emitted', async () => {
    const org = await provisionedOrg(`org-erase-${crypto.randomUUID()}`);
    const guestId = 'guest_erase_me';
    await createGuest(org, guestId, 'Erase Target');

    const eraseInput = { guestId };
    expect(await org.tryEraseGuest(eraseInput, await idemFor('erase-1', eraseInput))).toMatchObject({
      ok: true,
      guestId,
    });

    await expect(org.readGuestProfile(guestId)).rejects.toThrow(/PII key shredded/);
    expect(await org.listOutboxEventTypes()).toEqual(['guest.created', 'guest.erased']);
  });

  it('3. shredding a guest key does not affect staff-scoped keys', async () => {
    const org = await provisionedOrg(`org-scope-${crypto.randomUUID()}`);
    const guest = await createGuest(org, 'guest_scope', 'Guest One');
    const staff = await org.testProvisionStaffKey('staff_scope');
    expect(await org.testStaffRoundTrip(staff.piiKeyId, 'hourly rate 42')).toBe('hourly rate 42');

    expect(await org.testShredGuestKey(guest.piiKeyId)).toBe(true);
    await expect(org.readGuestProfile('guest_scope')).rejects.toThrow(/PII key shredded/);
    expect(await org.testStaffRoundTrip(staff.piiKeyId, 'hourly rate 42')).toBe('hourly rate 42');
  });

  it('4. update after erase returns guest_already_erased', async () => {
    const org = await provisionedOrg(`org-upd-erase-${crypto.randomUUID()}`);
    const guestId = 'guest_no_update';
    await createGuest(org, guestId, 'Before Erase');
    const eraseInput = { guestId };
    await org.tryEraseGuest(eraseInput, await idemFor('erase-upd', eraseInput));

    const updateInput = { guestId, profile: { displayName: 'After Erase' } };
    expect(await org.tryUpdateGuest(updateInput, await idemFor('update-after-erase', updateInput))).toEqual({
      ok: false,
      error: GUEST_ALREADY_ERASED,
    });
  });

  it('5. erase missing guest returns guest_not_found', async () => {
    const org = await provisionedOrg(`org-missing-${crypto.randomUUID()}`);
    const eraseInput = { guestId: 'ghost' };
    expect(await org.tryEraseGuest(eraseInput, await idemFor('erase-missing', eraseInput))).toEqual({
      ok: false,
      error: GUEST_NOT_FOUND,
    });
  });
});

describe('PropertyDO reservation.created PII contract', () => {
  it('reservation.created carries guest_ref + pii_key_id, never display name', async () => {
    const name = `res-pii-${crypto.randomUUID()}`;
    const org = await provisionedOrg(`org-${name}`);
    const stub = await provisionedProperty(name);
    const guestName = 'Secret Guest Name';
    const guest = await createGuest(org, 'guest_book', guestName);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 3,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor(`add-${name}`, addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_pii',
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-pii', bookInput))).toMatchObject({
      ok: true,
    });

    const payloads = await stub.listOutboxPayloads();
    const created = payloads.find((p) => p.eventType === 'reservation.created');
    expect(created).toBeDefined();
    expect(created!.payload).toContain('"guestRef":"guest_book"');
    expect(created!.payload).toContain('"piiKeyId"');
    expect(created!.payload).not.toContain(guestName);
  });
});
