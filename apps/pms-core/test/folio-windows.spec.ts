import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN,
  WINDOW_BALANCE_DUE,
  WINDOW_CLOSED,
  WINDOW_NOT_CLOSABLE,
  type ProvisionalCommand,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import {
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './fixtures';
import { provisionedPropertyWithGuest } from './guest-helpers';

async function seedCityLedgerAccount(
  stub: DurableObjectStub<PropertyDO>,
  name: string,
  idemSuffix: string,
) {
  expect(
    await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name },
      await idemFor(`cla-${idemSuffix}`, { name }),
    ),
  ).toMatchObject({ ok: true });
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function stayCheckedIn(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  await stub.flushOutbox();
}

describe('folio windows — CLOSED insert gate', () => {
  it('7: add_item on CLOSED window returns WINDOW_CLOSED and does not reopen', async () => {
    const propertyId = crypto.randomUUID();
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const openLine = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 50,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, openLine, await idemFor('open', openLine))).toMatchObject({
      ok: true,
    });

    await stub.stampFolioWindowClosedForTest(`${reservationId}:GUEST`);
    const late = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    const result = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, late, await idemFor('late', late));
    expect(result).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.window?.status).toBe('CLOSED');
  });
});

describe('folio windows — open, close, reopen, check-out auto-close', () => {
  it('1: check-out default config, zero balance → GUEST still OPEN, closed_at NULL', async () => {
    const name = `fw-1-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw1', 'rm_fw1', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw1' },
        await idemFor('co-fw1', { reservationId: 'res_fw1' }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_fw1')).toBe('checked_out');
    const win = await stub.readFolioWindowForTest('res_fw1:GUEST');
    expect(win).toMatchObject({ status: 'OPEN', closedAt: null });
  });

  it('2: config close_window_on_check_out true, zero balance → GUEST CLOSED + folio.window_closed', async () => {
    const name = `fw-2-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.folio.close_window_on_check_out',
        true,
        { reason: 'test' },
        await idemFor('cfg-fw2', {
          key: 'pms.folio.close_window_on_check_out',
          value: true,
          reason: 'test',
        }),
      ),
    ).toMatchObject({ ok: true });
    await stayCheckedIn(stub, guestRef, 'res_fw2', 'rm_fw2', arrival, addCalendarDays(arrival, 1));
    await stub.flushOutbox();
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw2' },
        await idemFor('co-fw2', { reservationId: 'res_fw2' }),
      ),
    ).toMatchObject({ ok: true });
    const win = await stub.readFolioWindowForTest('res_fw2:GUEST');
    expect(win?.status).toBe('CLOSED');
    expect(win?.closedAt).toEqual(expect.any(Number));
    expect(await stub.listOutboxEventTypes()).toContain('folio.window_closed');
  });

  it('3: config true, overrideBalance with open balance → checked_out, GUEST OPEN', async () => {
    const name = `fw-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.folio.close_window_on_check_out',
        true,
        { reason: 'test' },
        await idemFor('cfg-fw3', {
          key: 'pms.folio.close_window_on_check_out',
          value: true,
          reason: 'test',
        }),
      ),
    ).toMatchObject({ ok: true });
    await stayCheckedIn(stub, guestRef, 'res_fw3', 'rm_fw3', arrival, addCalendarDays(arrival, 1));
    const line = {
      folioLineId: 'fl_fw3',
      reservationId: 'res_fw3',
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl-fw3', line))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw3', overrideBalance: true },
        await idemFor('co-fw3', { reservationId: 'res_fw3', overrideBalance: true }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_fw3')).toBe('checked_out');
    const win = await stub.readFolioWindowForTest('res_fw3:GUEST');
    expect(win).toMatchObject({ status: 'OPEN', closedAt: null });
  });

  it('4: close in-house GUEST → WINDOW_NOT_CLOSABLE', async () => {
    const name = `fw-4-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw4', 'rm_fw4', arrival, addCalendarDays(arrival, 1));
    const result = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: 'res_fw4:GUEST' },
      await idemFor('close-fw4', { folioWindowId: 'res_fw4:GUEST' }),
    );
    expect(result).toMatchObject({ ok: false, error: WINDOW_NOT_CLOSABLE });
    expect((await stub.readFolioWindowForTest('res_fw4:GUEST'))?.status).toBe('OPEN');
  });

  it('5: close GUEST on checked_out with window balance 0 → CLOSED', async () => {
    const name = `fw-5-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw5', 'rm_fw5', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw5' },
        await idemFor('co-fw5', { reservationId: 'res_fw5' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: 'res_fw5:GUEST' },
        await idemFor('close-fw5', { folioWindowId: 'res_fw5:GUEST' }),
      ),
    ).toMatchObject({ ok: true });
    const win = await stub.readFolioWindowForTest('res_fw5:GUEST');
    expect(win?.status).toBe('CLOSED');
    expect(win?.closedAt).toEqual(expect.any(Number));
  });

  it('6: close with window balance ≠ 0 → WINDOW_BALANCE_DUE, still OPEN', async () => {
    const name = `fw-6-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw6', 'rm_fw6', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw6' },
        await idemFor('co-fw6', { reservationId: 'res_fw6' }),
      ),
    ).toMatchObject({ ok: true });
    // Seed balance without desk charge path — checked_out without hold is refused (R4.23 D4).
    await stub.insertFolioLineRawForTest({
      folioLineId: 'fl_fw6',
      folioWindowId: 'res_fw6:GUEST',
      reservationId: 'res_fw6',
      chargeCode: 'MISC',
      amountMinor: 800,
      source: 'desk',
      businessDate: arrival,
    });
    const result = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: 'res_fw6:GUEST' },
      await idemFor('close-fw6', { folioWindowId: 'res_fw6:GUEST' }),
    );
    expect(result).toMatchObject({ ok: false, error: WINDOW_BALANCE_DUE });
    expect((await stub.readFolioWindowForTest('res_fw6:GUEST'))?.status).toBe('OPEN');
  });

  it('8: queued add_item then live close then drain → provisional_exception WINDOW_CLOSED; no line', async () => {
    const name = `fw-8-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw8', 'rm_fw8', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw8' },
        await idemFor('co-fw8', { reservationId: 'res_fw8' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: 'res_fw8:GUEST' },
        await idemFor('close-fw8', { folioWindowId: 'res_fw8:GUEST' }),
      ),
    ).toMatchObject({ ok: true });

    const payload = {
      folioLineId: 'res_fw8:item:queued',
      reservationId: 'res_fw8',
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    const idem = await idemFor('queued-fw8', payload);
    const result = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, payload, idem, {
      issuedAt: new Date().toISOString(),
      businessDate: arrival,
    });
    expect(result).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    const cmd: ProvisionalCommand = {
      idempotencyKey: idem.key,
      requestFingerprint: idem.fingerprint,
      propertyId: name,
      orgId,
      issuedAt: new Date().toISOString(),
      businessDate: arrival,
      actor: { userId: 'user_owner' },
      command: { type: 'folio.add_item', payload },
      routeId: 'post_folio_lines',
    };
    await stub.recordProvisionalException(cmd, WINDOW_CLOSED, result);
    const listed = await stub.listProvisionalExceptions();
    const exceptions = (listed as unknown as { exceptions: Array<{ reason: string }> }).exceptions;
    expect(exceptions.some((e) => e.reason === WINDOW_CLOSED)).toBe(true);
    const folio = await stub.readFolio('res_fw8');
    expect(folio.ok && folio.lines.every((l) => l.folioLineId !== payload.folioLineId)).toBe(true);
  });

  it('9: reopen → OPEN, closed_at NULL, folio.window_reopened; subsequent add_item succeeds', async () => {
    const name = `fw-9-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw9', 'rm_fw9', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw9' },
        await idemFor('co-fw9', { reservationId: 'res_fw9' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: 'res_fw9:GUEST' },
        await idemFor('close-fw9', { folioWindowId: 'res_fw9:GUEST' }),
      ),
    ).toMatchObject({ ok: true });
    await stub.flushOutbox();
    expect(
      await stub.tryReopenFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: 'res_fw9:GUEST' },
        await idemFor('reopen-fw9', { folioWindowId: 'res_fw9:GUEST' }),
      ),
    ).toMatchObject({ ok: true });
    const win = await stub.readFolioWindowForTest('res_fw9:GUEST');
    expect(win).toMatchObject({ status: 'OPEN', closedAt: null });
    expect(await stub.listOutboxEventTypes()).toContain('folio.window_reopened');
    await stub.writeConfigValueForTest('pms.folio.open_folio', {
      enabled: true,
      followUpDays: 3,
      closeByDays: 14,
      autoOpenOnDepartWithBalance: false,
      autoCloseAtZeroAfterDays: null,
    });
    const place = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_fw9', reason: 'reopen late charge' },
      await idemFor('hold-fw9', { reservationId: 'res_fw9', reason: 'reopen late charge' }),
    );
    expect(place).toMatchObject({ ok: true });
    const late = {
      folioLineId: 'fl_fw9_late',
      reservationId: 'res_fw9',
      chargeCode: 'MISC',
      amountMinor: 50,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, late, await idemFor('late-fw9', late))).toMatchObject({
      ok: true,
    });
  });

  it('10: reopen of OPEN → { alreadyOpen: true }, no second audit', async () => {
    const name = `fw-10-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw10', 'rm_fw10', arrival, addCalendarDays(arrival, 1));
    const first = await stub.tryReopenFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: 'res_fw10:GUEST' },
      await idemFor('reopen-fw10a', { folioWindowId: 'res_fw10:GUEST' }),
    );
    expect(first).toMatchObject({ ok: true, alreadyOpen: true });
    const auditBefore = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_fw10' });
    expect(auditBefore.ok).toBe(true);
    const reopenCountBefore = (
      auditBefore as unknown as { ok: true; rows: Array<{ commandId: string }> }
    ).rows.filter((r) => r.commandId === 'folio.reopen_window').length;
    const second = await stub.tryReopenFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: 'res_fw10:GUEST' },
      await idemFor('reopen-fw10b', { folioWindowId: 'res_fw10:GUEST' }),
    );
    expect(second).toMatchObject({ ok: true, alreadyOpen: true });
    const auditAfter = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_fw10' });
    const reopenCountAfter = (
      auditAfter as unknown as { ok: true; rows: Array<{ commandId: string }> }
    ).rows.filter((r) => r.commandId === 'folio.reopen_window').length;
    expect(reopenCountAfter).toBe(reopenCountBefore);
  });

  it('11: close COMPANY while guest checked_in and company window balance 0 → allowed; GUEST still OPEN', async () => {
    const name = `fw-11-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw11', 'rm_fw11', arrival, addCalendarDays(arrival, 1));
    await seedCityLedgerAccount(stub, 'Acme Corp', 'fw11');
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_fw11', kind: 'COMPANY', billedParty: 'Acme Corp' },
      await idemFor('open-fw11', { reservationId: 'res_fw11', kind: 'COMPANY', billedParty: 'Acme Corp' }),
    );
    expect(open).toMatchObject({ ok: true });
    const companyId = open.ok ? open.folioWindowId : '';
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: companyId },
        await idemFor('close-fw11', { folioWindowId: companyId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.readFolioWindowForTest(companyId))?.status).toBe('CLOSED');
    expect((await stub.readFolioWindowForTest('res_fw11:GUEST'))?.status).toBe('OPEN');
    expect(await stub.getReservationStatus('res_fw11')).toBe('checked_in');
  });

  it('15: close COMPANY with non-zero receivable succeeds when city ledger account exists', async () => {
    const name = `fw-15-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw15', 'rm_fw15', arrival, addCalendarDays(arrival, 1));
    await seedCityLedgerAccount(stub, 'Direct Bill Co', 'fw15');

    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_fw15', kind: 'COMPANY', billedParty: 'Direct Bill Co' },
      await idemFor('open-fw15', { reservationId: 'res_fw15', kind: 'COMPANY', billedParty: 'Direct Bill Co' }),
    );
    expect(open).toMatchObject({ ok: true });
    if (!open.ok) return;
    const companyId = open.folioWindowId;

    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: companyId,
      reservationId: 'res_fw15',
      chargeCode: 'ROOM',
      amountMinor: 7_500,
      source: 'desk',
      businessDate: (await stub.readBusinessDate())!,
    });

    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: companyId },
        await idemFor('close-fw15', { folioWindowId: companyId }),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.readFolioWindowForTest(companyId))?.status).toBe('CLOSED');
  });

  it('12: cancel_check_in after check-in (GUEST OPEN) → confirmed, window OPEN', async () => {
    const name = `fw-12-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw12', 'rm_fw12', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCancelCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw12' },
        await idemFor('cci-fw12', { reservationId: 'res_fw12' }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_fw12')).toBe('confirmed');
    expect((await stub.readFolioWindowForTest('res_fw12:GUEST'))?.status).toBe('OPEN');
  });

  it('13: second close of CLOSED → { alreadyClosed: true }', async () => {
    const name = `fw-13-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw13', 'rm_fw13', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw13' },
        await idemFor('co-fw13', { reservationId: 'res_fw13' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: 'res_fw13:GUEST' },
        await idemFor('close-fw13a', { folioWindowId: 'res_fw13:GUEST' }),
      ),
    ).toMatchObject({ ok: true });
    const second = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: 'res_fw13:GUEST' },
      await idemFor('close-fw13b', { folioWindowId: 'res_fw13:GUEST' }),
    );
    expect(second).toMatchObject({ ok: true, alreadyClosed: true });
  });

  it('14: staff folio:post without folio:adjust → close 403', async () => {
    const name = `fw-14-${crypto.randomUUID()}`;
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(name);
    await orgStub(orgId).ensureMember('user_staff_fw14', 'staff');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw14', 'rm_fw14', arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_fw14' },
        await idemFor('co-fw14', { reservationId: 'res_fw14' }),
      ),
    ).toMatchObject({ ok: true });
    const staff = { kind: 'user' as const, userId: 'user_staff_fw14' };
    const result = await stub.tryCloseFolioWindow(
      staff,
      { folioWindowId: 'res_fw14:GUEST' },
      await idemFor('close-fw14', { folioWindowId: 'res_fw14:GUEST' }),
    );
    expect(result).toMatchObject({ ok: false, error: FORBIDDEN });
  });

  it('guest purge nulls billed_party on COMPANY windows for that guest', async () => {
    const name = `fw-purge-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw_purge', 'rm_fw_purge', arrival, addCalendarDays(arrival, 1));
    await seedCityLedgerAccount(stub, 'Acme Corp', 'fw-purge');
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_fw_purge', kind: 'COMPANY', billedParty: 'Acme Corp' },
      await idemFor('open-fw-purge', { reservationId: 'res_fw_purge', kind: 'COMPANY', billedParty: 'Acme Corp' }),
    );
    expect(open).toMatchObject({ ok: true });
    const companyId = open.ok ? open.folioWindowId : '';
    expect((await stub.readFolioWindowForTest(companyId))?.billedParty).toBe('Acme Corp');
    await stub.resetLaneGuardForTest();
    expect(await stub.purgeGuestPiiColumns(guestRef)).toEqual({ ok: true, deleted: 1 });
    expect((await stub.readFolioWindowForTest(companyId))?.billedParty).toBeNull();
  });
});
