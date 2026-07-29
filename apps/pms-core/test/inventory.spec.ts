import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
  BUSINESS_DATE_UNSET,
  fingerprintPayload,
  NOT_FOUND,
  OVERSELL,
  PROPERTY_ID_UNSET,
  TIMEZONE_UNSET,
} from '@hospai/contracts';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/property-do';
import { idemFor, provisionedPropertyStub, propertyStub, ensureEntitledMeta, TEST_OWNER_ACTOR } from './fixtures';


describe('PropertyDO inventory commands', () => {
  it('1. add room type without a stored timezone rejects with timezone_unset', async () => {
    const stub = propertyStub(`inv-no-tz-${crypto.randomUUID()}`);
    await ensureEntitledMeta(stub);
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-no-tz', input));
    expect(result).toEqual({ ok: false, error: TIMEZONE_UNSET });
  });

  it('1b. timezone_unset / business_date_unset are never cached: replaying the same idempotency key after provisioning succeeds', async () => {
    const name = `inv-no-tz-replay-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await stub.ensureMetaPropertyId(name);
    await ensureEntitledMeta(stub);
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const idem = await idemFor('add-no-tz-replay-fixed', input);

    const first = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);
    expect(first).toEqual({ ok: false, error: TIMEZONE_UNSET });

    // Provision the timezone only, then replay the *same* idempotency key.
    const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'Europe/Berlin' });
    await stub.ensureTimeZoneIfAbsent('Europe/Berlin', { key: `provision:timezone:${name}`, fingerprint });

    const second = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);
    expect(second).toEqual({ ok: false, error: BUSINESS_DATE_UNSET });

    // Provision the business_date, then replay the same idempotency key again.
    await stub.ensureBusinessDateIfAbsent('Europe/Berlin', new Date());

    const third = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);
    expect(third.ok).toBe(true);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(365);
  });

  it('1c. add room type without a stored property_id rejects with property_id_unset, uncached', async () => {
    const name = `inv-no-pid-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await ensureEntitledMeta(stub, name);
    const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'Europe/Berlin' });
    await stub.ensureTimeZoneIfAbsent('Europe/Berlin', { key: `provision:timezone:${name}`, fingerprint });
    await stub.clearMetaPropertyIdForTest();
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-no-pid', input));
    expect(result).toEqual({ ok: false, error: PROPERTY_ID_UNSET });
  });

  it('2. add room type under Europe/Berlin seeds exactly 365 rows from business_date, two events, ARI version 1', async () => {
    const name = `inv-berlin-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const businessDate = await stub.readBusinessDate();
    expect(businessDate).not.toBeNull();
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-berlin', input));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ariVersion).toBe(1);
    // Horizon is anchored to __meta.business_date, never wall clock.
    expect(result.fromDate).toBe(businessDate);

    expect(await stub.countAvailabilityDays('rt_king')).toBe(365);
    expect(await stub.readAriVersion()).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual([
      'inventory.room_type_changed',
      'availability.changed',
    ]);

    const first = await stub.readAvailabilityDay('rt_king', result.fromDate);
    expect(first?.physical).toBe(10);
    expect(first?.free).toBe(10);
  });

  it('2b. add room type without a stored business_date rejects with business_date_unset', async () => {
    const name = `inv-no-bd-${crypto.randomUUID()}`;
    const stub = propertyStub(name);
    await stub.ensureMetaPropertyId(name);
    await ensureEntitledMeta(stub);
    const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'Europe/Berlin' });
    await stub.ensureTimeZoneIfAbsent('Europe/Berlin', {
      key: `provision:timezone:${name}`,
      fingerprint,
    });
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-no-bd', input));
    expect(result).toEqual({ ok: false, error: BUSINESS_DATE_UNSET });
    expect(await stub.countAvailabilityDays('rt_king')).toBe(0);
  });

  it('3. replay of the same idempotency key does not double-seed or double-emit', async () => {
    const name = `inv-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const idem = await idemFor('add-replay-fixed', input);

    const first = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);
    expect(first.ok).toBe(true);
    const second = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);

    expect(second).toEqual(first);

    expect(await stub.countAvailabilityDays('rt_king')).toBe(365);
    expect(await stub.listOutboxEventTypes()).toEqual([
      'inventory.room_type_changed',
      'availability.changed',
    ]);
  });

  it('4. update lowering room_count below sold returns oversell with offending dates', async () => {
    const name = `inv-oversell-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-oversell', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    // Manually push demand on the first horizon date so lowering room_count oversells it.
    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: added.fromDate,
      physical: 10,
      sold: 9,
    });

    const updateInput = { roomTypeId: 'rt_king', roomCount: 5 };
    const updated = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, await idemFor('update-oversell', updateInput));
    expect(updated).toEqual({ ok: false, error: OVERSELL, dates: [added.fromDate] });

    // Ledger row must be unchanged (still physical = 10).
    const row = await stub.readAvailabilityDay('rt_king', added.fromDate);
    expect(row?.physical).toBe(10);
  });

  it('5. update ok changes existing future rows only; never inserts dates; past rows untouched', async () => {
    const name = `inv-update-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-update-ok', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    // Seed a past date row manually — updateRoomType must never touch it.
    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: '2000-01-01',
      physical: 10,
    });

    const beforeCount = await stub.countAvailabilityDays('rt_king');

    const updateInput = { roomTypeId: 'rt_king', roomCount: 7 };
    const updated = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, await idemFor('update-ok', updateInput));
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.fromDate).toBe(added.fromDate);
    expect(updated.toDate).toBe(added.toDate);

    // No new dates inserted.
    expect(await stub.countAvailabilityDays('rt_king')).toBe(beforeCount);

    const futureRow = await stub.readAvailabilityDay('rt_king', added.fromDate);
    expect(futureRow?.physical).toBe(7);

    const pastRow = await stub.readAvailabilityDay('rt_king', '2000-01-01');
    expect(pastRow?.physical).toBe(10);

    expect(await stub.listOutboxEventTypes()).toEqual([
      'inventory.room_type_changed',
      'availability.changed',
      'inventory.room_type_changed',
      'availability.changed',
    ]);
  });

  it('6. archive with future committed demand returns archive_blocked', async () => {
    const name = `inv-archive-blocked-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-archive-blocked', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: added.fromDate,
      physical: 10,
      sold: 1,
    });

    const deleteInput = { roomTypeId: 'rt_king' };
    const result = await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, deleteInput, await idemFor('archive-blocked', deleteInput));
    expect(result).toEqual({ ok: false, error: ARCHIVE_BLOCKED });
    expect(await stub.getRoomTypeStatus('rt_king')).toBe('active');
  });

  it('7. archive clean sets status archived, zeroes future physical, leaves past untouched, both events', async () => {
    const name = `inv-archive-clean-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-archive-clean', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: '2000-01-01',
      physical: 10,
    });

    const deleteInput = { roomTypeId: 'rt_king' };
    const result = await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, deleteInput, await idemFor('archive-clean', deleteInput));
    expect(result.ok).toBe(true);

    expect(await stub.getRoomTypeStatus('rt_king')).toBe('archived');

    const futureRow = await stub.readAvailabilityDay('rt_king', added.fromDate);
    expect(futureRow?.physical).toBe(0);

    const pastRow = await stub.readAvailabilityDay('rt_king', '2000-01-01');
    expect(pastRow?.physical).toBe(10);

    expect(await stub.listOutboxEventTypes()).toEqual([
      'inventory.room_type_changed',
      'availability.changed',
      'inventory.room_type_changed',
      'availability.changed',
    ]);
  });

  it('7b. archive with zero future ledger rows still emits room_type_changed but skips availability.changed and the ARI bump', async () => {
    const name = `inv-archive-empty-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-archive-empty', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const ariBefore = await stub.readAriVersion();
    // Drain the add's events so the assertion below only sees the archive's outbox writes.
    await stub.flushOutbox();
    // Simulate a room type with no future ledger rows left (e.g. fully expired horizon).
    await stub.deleteAvailabilityDaysFrom('rt_king', added.fromDate);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(0);

    const deleteInput = { roomTypeId: 'rt_king' };
    const result = await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, deleteInput, await idemFor('archive-empty', deleteInput));
    expect(result).toEqual({ ok: true, roomTypeId: 'rt_king', ariVersion: ariBefore });

    expect(await stub.getRoomTypeStatus('rt_king')).toBe('archived');
    expect(await stub.readAriVersion()).toBe(ariBefore);
    expect(await stub.listOutboxEventTypes()).toEqual(['inventory.room_type_changed']);
  });

  it('not_found is never cached: update on a missing room type, then retry the same idempotency key once it exists', async () => {
    const name = `inv-not-found-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const updateInput = { roomTypeId: 'rt_ghost', roomCount: 5 };
    const idem = await idemFor('update-not-found-fixed', updateInput);

    const first = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, idem);
    expect(first).toEqual({ ok: false, error: NOT_FOUND });

    const addInput = {
      roomTypeId: 'rt_ghost',
      code: 'GHOST',
      name: 'Ghost Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-ghost', addInput));
    expect(added.ok).toBe(true);

    const second = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, idem);
    expect(second.ok).toBe(true);
  });

  it('oversell is never cached: after clearing the offending demand, retrying the same idempotency key succeeds', async () => {
    const name = `inv-oversell-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-oversell-replay', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: added.fromDate,
      physical: 10,
      sold: 9,
    });

    const updateInput = { roomTypeId: 'rt_king', roomCount: 5 };
    const idem = await idemFor('update-oversell-replay-fixed', updateInput);
    const first = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, idem);
    expect(first).toEqual({ ok: false, error: OVERSELL, dates: [added.fromDate] });

    // Clear the demand that caused the oversell, then replay the same idempotency key.
    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: added.fromDate,
      physical: 10,
      sold: 0,
    });
    const second = await stub.tryUpdateRoomType(TEST_OWNER_ACTOR, updateInput, idem);
    expect(second.ok).toBe(true);
  });

  it('8. archived code can be reused on a new active room type (partial unique index)', async () => {
    const name = `inv-code-reuse-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const addInput = {
      roomTypeId: 'rt_king_1',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-reuse-1', addInput));
    expect(added.ok).toBe(true);

    const deleteInput = { roomTypeId: 'rt_king_1' };
    const archived = await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, deleteInput, await idemFor('archive-reuse', deleteInput));
    expect(archived.ok).toBe(true);

    const secondInput = {
      roomTypeId: 'rt_king_2',
      code: 'KING',
      name: 'King Deluxe',
      roomCount: 6,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const second = await stub.tryAddRoomType(TEST_OWNER_ACTOR, secondInput, await idemFor('add-reuse-2', secondInput));
    expect(second.ok).toBe(true);
    expect(await stub.getRoomTypeStatus('rt_king_2')).toBe('active');
  });
});

