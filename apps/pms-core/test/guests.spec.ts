import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload, GUEST_ALREADY_ERASED, GUEST_EXISTS, GUEST_NOT_FOUND } from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { createGuest, idemFor, provisionedOrg, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './guest-helpers';


async function provisionedProperty(name: string, orgId: string): Promise<DurableObjectStub<PropertyDO>> {
  const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
  return stub;
}

describe('OrgDO guests + crypto-shredding', () => {
  it('1. create guest encrypts profile and emits guest.created without PII', async () => {
    const org = await provisionedOrg(`org-guest-${crypto.randomUUID()}`);
    const propertyId = 'prop_guest_test';
    const guestId = 'guest_ada';
    const displayName = 'Ada Lovelace';
    const refs = await createGuest(org, propertyId, guestId, displayName);

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
    const propertyId = 'prop_guest_test';
    const guestId = 'guest_erase_me';
    const refs = await createGuest(org, propertyId, guestId, 'Erase Target');

    const eraseInput = { guestId };
    expect(
      await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, eraseInput, await idemFor('erase-1', eraseInput)),
    ).toMatchObject({
      ok: true,
      guestId,
    });

    expect(await org.testDataKeyHasMaterial(refs.piiKeyId)).toBe(false);
    await expect(org.readGuestProfile(guestId)).rejects.toThrow(/PII key shredded/);
    expect(await org.listOutboxEventTypes()).toEqual(['guest.created', 'guest.erased']);
  });

  it('3. shredding a guest key does not affect staff-scoped keys', async () => {
    const org = await provisionedOrg(`org-scope-${crypto.randomUUID()}`);
    const propertyId = 'prop_guest_test';
    const guest = await createGuest(org, propertyId, 'guest_scope', 'Guest One');
    const staff = await org.testProvisionStaffKey('staff_scope');
    expect(await org.testStaffRoundTrip(staff.piiKeyId, 'hourly rate 42')).toBe('hourly rate 42');

    expect(await org.testShredGuestKey(guest.piiKeyId)).toBe(true);
    expect(await org.testDataKeyHasMaterial(guest.piiKeyId)).toBe(false);
    await expect(org.readGuestProfile('guest_scope')).rejects.toThrow(/PII key shredded/);
    expect(await org.testStaffRoundTrip(staff.piiKeyId, 'hourly rate 42')).toBe('hourly rate 42');
  });

  it('4. update after erase returns guest_already_erased', async () => {
    const org = await provisionedOrg(`org-upd-erase-${crypto.randomUUID()}`);
    const propertyId = 'prop_guest_test';
    const guestId = 'guest_no_update';
    await createGuest(org, propertyId, guestId, 'Before Erase');
    const eraseInput = { guestId };
    await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, eraseInput, await idemFor('erase-upd', eraseInput));

    const updateInput = { guestId, profile: { displayName: 'After Erase' } };
    expect(
      await org.tryUpdateGuest(
        TEST_OWNER_ACTOR,
        propertyId,
        updateInput,
        await idemFor('update-after-erase', updateInput),
      ),
    ).toEqual({
      ok: false,
      error: GUEST_ALREADY_ERASED,
    });
  });

  it('5. erase missing guest returns guest_not_found', async () => {
    const org = await provisionedOrg(`org-missing-${crypto.randomUUID()}`);
    const propertyId = 'prop_guest_test';
    const eraseInput = { guestId: 'ghost' };
    expect(
      await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, eraseInput, await idemFor('erase-missing', eraseInput)),
    ).toEqual({
      ok: false,
      error: GUEST_NOT_FOUND,
    });
  });

  it('6. erase shreds data_key in place while guest FK row remains', async () => {
    const org = await provisionedOrg(`org-fk-shred-${crypto.randomUUID()}`);
    const propertyId = 'prop_guest_test';
    const guestId = 'guest_fk_parent';
    const refs = await createGuest(org, propertyId, guestId, 'FK Parent');

    const before = await org.testGetDataKeyRecord(refs.piiKeyId);
    expect(before).toMatchObject({ wrappedKeyIsUint8Array: true, shredded: false });
    expect(before!.wrappedKeyByteLength).toBeGreaterThan(0);
    expect(await org.testDataKeyHasMaterial(refs.piiKeyId)).toBe(true);

    const eraseInput = { guestId };
    expect(
      await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, eraseInput, await idemFor('erase-fk', eraseInput)),
    ).toMatchObject({
      ok: true,
      guestId,
      piiKeyId: refs.piiKeyId,
    });

    expect(await org.getGuestPiiKeyId(guestId)).toBe(refs.piiKeyId);
    const after = await org.testGetDataKeyRecord(refs.piiKeyId);
    expect(after).toMatchObject({ wrappedKeyIsUint8Array: true, shredded: true, wrappedKeyByteLength: 0 });
    expect(await org.testDataKeyHasMaterial(refs.piiKeyId)).toBe(false);
    await expect(org.readGuestProfile(guestId)).rejects.toThrow(/PII key shredded/);
  });

  it('create after erase returns guest_exists (never un-erase)', async () => {
    const org = await provisionedOrg(`org-recreate-${crypto.randomUUID()}`);
    const propertyId = 'prop_recreate';
    const guestId = 'guest_recreate';
    await createGuest(org, propertyId, guestId, 'Once');
    await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, { guestId }, await idemFor('e', { guestId }));
    const again = await org.tryCreateGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      { guestId, profile: { displayName: 'Twice' } },
      await idemFor('c2', { guestId, profile: { displayName: 'Twice' } }),
    );
    expect(again).toEqual({ ok: false, error: GUEST_EXISTS });
  });

  it('M3: idempotent replay of create returns identical response and leaves key material intact', async () => {
    // Note: this does NOT verify that a replay avoids minting a second `data_key` — the
    // `INSERT INTO data_key` runs inside `runIdempotent`'s in-transaction execute, so
    // `runIdempotent` alone already guarantees a single row regardless of the pre-probe
    // (see `readIdempotentReplay` doc comment in org-do.ts). What this asserts is the
    // observable idempotency contract: replaying the same key+fingerprint returns the exact
    // same response and the guest's key material still round-trips afterward.
    const org = await provisionedOrg(`org-m3-${crypto.randomUUID()}`);
    const propertyId = 'prop_m3';
    const guestId = 'guest_m3';
    const input = { guestId, profile: { displayName: 'Ada' } };
    const idem = await idemFor('m3-create', input);
    const first = await org.tryCreateGuest(TEST_OWNER_ACTOR, propertyId, input, idem);
    expect(first.ok).toBe(true);
    const second = await org.tryCreateGuest(TEST_OWNER_ACTOR, propertyId, input, idem);
    expect(second).toEqual(first);
    expect(await org.testDataKeyHasMaterial((first as { piiKeyId: string }).piiKeyId)).toBe(true);
  });

  it('readGuest returns tombstone when erased_at set', async () => {
    const org = await provisionedOrg(`org-tombstone-${crypto.randomUUID()}`);
    const propertyId = 'prop_tombstone';
    const guestId = 'guest_tombstone';
    await createGuest(org, propertyId, guestId, 'Tombstone Target');
    await org.tryEraseGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      { guestId },
      await idemFor('tombstone-erase', { guestId }),
    );

    expect(await org.readGuest(TEST_OWNER_ACTOR, propertyId, guestId)).toEqual({
      ok: true,
      guestId,
      erased: true,
      profile: null,
    });
  });

  it('listGuests backfills missing blind-index rows then search hits', async () => {
    const org = await provisionedOrg(`org-backfill-${crypto.randomUUID()}`);
    const propertyId = 'prop_backfill';
    const guestId = 'guest_backfill';
    await createGuest(org, propertyId, guestId, 'Ada Lovelace');
    await org.execSqlForTest(`DELETE FROM guest_blind_index WHERE guest_id = ?`, guestId);
    expect(await org.countGuestBlindIndexForTest(guestId)).toBe(0);

    const listed = await org.listGuests(TEST_OWNER_ACTOR, propertyId, { limit: 25 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.some((g) => g.guestId === guestId)).toBe(true);
    expect(await org.countGuestBlindIndexForTest(guestId)).toBeGreaterThan(0);

    const found = await org.searchGuests(TEST_OWNER_ACTOR, propertyId, { q: 'Ada', limit: 25 });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.items.map((g) => g.guestId)).toContain(guestId);
  });

  it('listGuests omits decrypt_unresolved guests instead of 500', async () => {
    const org = await provisionedOrg(`org-unresolved-${crypto.randomUUID()}`);
    const propertyId = 'prop_unresolved';
    const refs = await createGuest(org, propertyId, 'guest_unresolved', 'Live');
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const listed = await org.listGuests(TEST_OWNER_ACTOR, propertyId, { limit: 25 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.find((g) => g.guestId === 'guest_unresolved')).toBeUndefined();
  });

  it('M4 DO: shredded key without erased_at is an incident, not a tombstone', async () => {
    const org = await provisionedOrg(`org-m4-${crypto.randomUUID()}`);
    const propertyId = 'prop_m4';
    const refs = await createGuest(org, propertyId, 'guest_m4', 'Live');
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);
    expect(await org.readGuest(TEST_OWNER_ACTOR, propertyId, 'guest_m4')).toEqual({
      ok: false,
      guestId: 'guest_m4',
      error: 'decrypt_unresolved',
    });
  });
});

describe('PropertyDO reservation.created PII contract', () => {
  it('reservation.created carries guest_ref + pii_key_id, never display name', async () => {
    const name = `res-pii-${crypto.randomUUID()}`;
    const orgId = `org-${name}`;
    const org = await provisionedOrg(orgId);
    const stub = await provisionedProperty(name, orgId);
    const guestName = 'Secret Guest Name';
    const guest = await createGuest(org, 'prop_guest_test', 'guest_book', guestName);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 3,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor(`add-${name}`, addInput));

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);

    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_pii',
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      arrivalDate: arrival,
      departureDate,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, bookInput, await idemFor('book-pii', bookInput)),
    ).toMatchObject({
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
