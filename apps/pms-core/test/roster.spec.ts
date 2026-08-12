import { describe, expect, it } from 'vitest';
import {
  EMPTY_KINDS,
  INVALID_KINDS,
  STAFF_EXITED,
  STAFF_NOT_ASSIGNABLE,
  STAFF_REF_RE,
} from '@hospai/contracts';
import { createGuest } from './guest-helpers.js';
import { createHousekeeper, idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './roster-helpers.js';

describe('OrgDO roster RPCs', () => {
  it('1: add mints staff_…, outbox roster.created has refs not displayName', async () => {
    const org = await provisionedOrg(`org-roster-1-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const displayName = 'Ada Lovelace';
    const refs = await createHousekeeper(org, propertyId, displayName);

    expect(refs.staffId).toMatch(STAFF_REF_RE);
    expect(refs.staffId.startsWith('staff_')).toBe(true);
    expect(refs.piiKeyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(await org.readRosterProfile(refs.staffId)).toEqual({ displayName });

    const payloads = await org.listOutboxPayloads();
    expect(payloads.map((p) => p.eventType)).toEqual(['roster.created']);
    const body = payloads[0]!.payload;
    expect(body).toContain(`"staffRef":"${refs.staffId}"`);
    expect(body).toContain('"piiKeyId"');
    expect(body).not.toContain(displayName);
    expect(body).not.toContain('Lovelace');
  });

  it('2: duplicate idempotency key replays same pair; one data_key row', async () => {
    const org = await provisionedOrg(`org-roster-2-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const input = { profile: { displayName: 'Ada' }, kinds: ['housekeeper'] };
    const idem = await idemFor('roster-dup', input);

    const first = await org.tryCreateRoster(TEST_OWNER_ACTOR, propertyId, input, idem);
    expect(first.ok).toBe(true);
    const second = await org.tryCreateRoster(TEST_OWNER_ACTOR, propertyId, input, idem);
    expect(second).toEqual(first);
    if (!first.ok) return;
    expect(await org.countDataKeysForSubject('staff', first.staffId)).toBe(1);
  });

  it('3: empty kinds → empty_kinds', async () => {
    const org = await provisionedOrg(`org-roster-3-${crypto.randomUUID()}`);
    const input = { profile: { displayName: 'Ada' }, kinds: [] as string[] };
    expect(
      await org.tryCreateRoster(
        TEST_OWNER_ACTOR,
        'prop_roster',
        input,
        await idemFor('roster-empty-kinds', input),
      ),
    ).toEqual({ ok: false, error: EMPTY_KINDS });
  });

  it('4: kinds including maintenance → invalid_kinds', async () => {
    const org = await provisionedOrg(`org-roster-4-${crypto.randomUUID()}`);
    const input = { profile: { displayName: 'Ada' }, kinds: ['housekeeper', 'maintenance'] };
    expect(
      await org.tryCreateRoster(
        TEST_OWNER_ACTOR,
        'prop_roster',
        input,
        await idemFor('roster-invalid-kinds', input),
      ),
    ).toEqual({ ok: false, error: INVALID_KINDS });
  });

  it('5: update kinds full replace; omit kinds leaves rows', async () => {
    const org = await provisionedOrg(`org-roster-5-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');

    const replaceInput = { staffId: refs.staffId, kinds: ['housekeeper'] };
    expect(
      await org.tryUpdateRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        replaceInput,
        await idemFor('roster-kinds-replace', replaceInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });

    const afterReplace = await org.readRoster(TEST_OWNER_ACTOR, propertyId, refs.staffId);
    expect(afterReplace).toMatchObject({ ok: true, staffId: refs.staffId, kinds: ['housekeeper'] });

    const omitInput = { staffId: refs.staffId, profile: { displayName: 'Ada' } };
    expect(
      await org.tryUpdateRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        omitInput,
        await idemFor('roster-kinds-omit', omitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });

    const afterOmit = await org.readRoster(TEST_OWNER_ACTOR, propertyId, refs.staffId);
    expect(afterOmit).toMatchObject({ ok: true, kinds: ['housekeeper'] });
  });

  it('5a: update displayName succeeds while employed', async () => {
    const org = await provisionedOrg(`org-roster-5a-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada Lovelace');
    const updateInput = { staffId: refs.staffId, profile: { displayName: 'Ada King' } };
    expect(
      await org.tryUpdateRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        updateInput,
        await idemFor('roster-rename', updateInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });

    expect(await org.readRosterProfile(refs.staffId)).toEqual({ displayName: 'Ada King' });
    const listed = await org.listRoster(TEST_OWNER_ACTOR, propertyId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.staff.find((s) => s.staffId === refs.staffId)?.profile.displayName).toBe('Ada King');
  });

  it('6: status inactive is not assignable; active housekeeper is', async () => {
    const org = await provisionedOrg(`org-roster-6-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');

    expect(await org.assertStaffAssignable(refs.staffId)).toEqual({ ok: true, staffId: refs.staffId });

    const inactiveInput = { staffId: refs.staffId, status: 'inactive' as const };
    expect(
      await org.trySetRosterStatus(
        TEST_OWNER_ACTOR,
        propertyId,
        inactiveInput,
        await idemFor('roster-inactive', inactiveInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });
    expect(await org.assertStaffAssignable(refs.staffId)).toEqual({
      ok: false,
      error: STAFF_NOT_ASSIGNABLE,
    });

    const activeInput = { staffId: refs.staffId, status: 'active' as const };
    expect(
      await org.trySetRosterStatus(
        TEST_OWNER_ACTOR,
        propertyId,
        activeInput,
        await idemFor('roster-active', activeInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });
    expect(await org.assertStaffAssignable(refs.staffId)).toEqual({ ok: true, staffId: refs.staffId });
  });

  it('7: exit drops identity keys, keeps employment, emits roster.exited refs only', async () => {
    const org = await provisionedOrg(`org-roster-7-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const displayName = 'Ada Lovelace';
    const refs = await createHousekeeper(org, propertyId, displayName, {
      email: 'ada@example.com',
      phone: '+1555',
      hourlyRateMinor: 2500,
      hourlyRateCurrency: 'USD',
      rating: 4,
      skills: ['linen'],
    });

    const exitInput = { staffId: refs.staffId };
    expect(
      await org.tryExitRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        exitInput,
        await idemFor('roster-exit', exitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId, piiKeyId: refs.piiKeyId });

    const profile = await org.readRosterProfile(refs.staffId);
    expect(profile).toEqual({
      hourlyRateMinor: 2500,
      hourlyRateCurrency: 'USD',
      rating: 4,
      skills: ['linen'],
    });
    expect(profile).not.toHaveProperty('displayName');
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('phone');

    const row = await org.readRoster(TEST_OWNER_ACTOR, propertyId, refs.staffId);
    expect(row).toMatchObject({ ok: true, status: 'inactive' });
    if (!row.ok) return;
    expect(row.exitedAt).toEqual(expect.any(Number));

    const payloads = await org.listOutboxPayloads();
    expect(payloads.map((p) => p.eventType)).toEqual(['roster.created', 'roster.exited']);
    const body = payloads[1]!.payload;
    expect(body).toContain(`"staffRef":"${refs.staffId}"`);
    expect(body).toContain('"piiKeyId"');
    expect(body).not.toContain(displayName);
    expect(body).not.toContain('ada@example.com');
    expect(body).not.toContain('+1555');
  });

  it('8: exit thin profile re-seals to {}', async () => {
    const org = await provisionedOrg(`org-roster-8-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Thin');
    const exitInput = { staffId: refs.staffId };
    expect(
      await org.tryExitRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        exitInput,
        await idemFor('roster-exit-thin', exitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });
    expect(await org.readRosterProfile(refs.staffId)).toEqual({});
  });

  it('9: second exit is ok without a second outbox row', async () => {
    const org = await provisionedOrg(`org-roster-9-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');
    const exitInput = { staffId: refs.staffId };
    expect(
      await org.tryExitRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        exitInput,
        await idemFor('roster-exit-1', exitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });

    const typesAfterFirst = await org.listOutboxEventTypes();
    expect(typesAfterFirst).toEqual(['roster.created', 'roster.exited']);

    expect(
      await org.tryExitRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        exitInput,
        await idemFor('roster-exit-2', exitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId, piiKeyId: refs.piiKeyId });
    expect(await org.listOutboxEventTypes()).toEqual(typesAfterFirst);
  });

  it('10: update and status after exit → staff_exited', async () => {
    const org = await provisionedOrg(`org-roster-10-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');
    const exitInput = { staffId: refs.staffId };
    await org.tryExitRoster(
      TEST_OWNER_ACTOR,
      propertyId,
      exitInput,
      await idemFor('roster-exit-then-write', exitInput),
    );

    const updateInput = { staffId: refs.staffId, profile: { displayName: 'Nope' } };
    expect(
      await org.tryUpdateRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        updateInput,
        await idemFor('roster-update-exited', updateInput),
      ),
    ).toEqual({ ok: false, error: STAFF_EXITED });

    const statusInput = { staffId: refs.staffId, status: 'active' as const };
    expect(
      await org.trySetRosterStatus(
        TEST_OWNER_ACTOR,
        propertyId,
        statusInput,
        await idemFor('roster-status-exited', statusInput),
      ),
    ).toEqual({ ok: false, error: STAFF_EXITED });
  });

  it('11: trigger aborts active + exited_at via execSqlForTest', async () => {
    const org = await provisionedOrg(`org-roster-11-${crypto.randomUUID()}`);
    const refs = await createHousekeeper(org, 'prop_roster', 'Ada');
    await expect(
      org.execSqlForTest(`UPDATE roster SET status = 'active', exited_at = 1 WHERE staff_id = ?`, refs.staffId),
    ).rejects.toThrow(/roster cannot be active and exited/);
  });

  it('12: trigger aborts cipher rewrite when OLD.exited_at set; exit itself succeeds', async () => {
    const org = await provisionedOrg(`org-roster-12-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');
    const exitInput = { staffId: refs.staffId };
    expect(
      await org.tryExitRoster(
        TEST_OWNER_ACTOR,
        propertyId,
        exitInput,
        await idemFor('roster-exit-then-cipher', exitInput),
      ),
    ).toMatchObject({ ok: true, staffId: refs.staffId });

    await expect(
      org.execSqlForTest(
        `UPDATE roster SET profile_cipher = ?, profile_iv = ? WHERE staff_id = ?`,
        new Uint8Array([0]),
        new Uint8Array([0]),
        refs.staffId,
      ),
    ).rejects.toThrow(/roster cipher frozen after exit/);
  });

  it('13: tryEraseGuest with live roster row leaves staff key round-trippable', async () => {
    const org = await provisionedOrg(`org-roster-13-${crypto.randomUUID()}`);
    const propertyId = 'prop_roster';
    const refs = await createHousekeeper(org, propertyId, 'Ada');
    const guest = await createGuest(org, propertyId, 'guest_scope', 'Guest One');

    expect(
      await org.tryEraseGuest(
        TEST_OWNER_ACTOR,
        propertyId,
        { guestId: guest.guestRef },
        await idemFor('erase-with-roster', { guestId: guest.guestRef }),
      ),
    ).toMatchObject({ ok: true, guestId: guest.guestRef });

    expect(await org.testStaffRoundTrip(refs.piiKeyId, 'hourly rate 42')).toBe('hourly rate 42');
    expect(await org.readRosterProfile(refs.staffId)).toEqual({ displayName: 'Ada' });
    const row = await org.readRoster(TEST_OWNER_ACTOR, propertyId, refs.staffId);
    expect(row).toMatchObject({ ok: true, staffId: refs.staffId });
    await expect(org.readGuestProfile(guest.guestRef)).rejects.toThrow(/PII key shredded/);
  });
});
