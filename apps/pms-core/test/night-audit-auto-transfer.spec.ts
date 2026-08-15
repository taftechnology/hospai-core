import { describe, expect, it } from 'vitest';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

async function seedRoomTax(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  validFrom: string,
) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `room_sales_${crypto.randomUUID()}`,
    name: 'Room tax',
    ruleType: 'PERCENTAGE',
    rate: '0.10',
    taxGroup: 'ROOM',
    outputChargeCode: 'TAX',
    validFrom,
  };
  expect(
    (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(`tax-${taxInput.taxRuleId}`, taxInput))).ok,
  ).toBe(true);
}

describe('night audit — auto-transfer', () => {
  it('1: empty routing rules → AUTO_TRANSFER COMPLETED; zero TRANSFER lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('any');
    expect(lines.filter((l) => l.source === 'TRANSFER')).toHaveLength(0);
  });

  it('2: ROOM→COMPANY rule transfers to slugged COMPANY window with tax restamp', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomTax(stub, businessDate);
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    const room = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 10_000, businessDate };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room-at2', room))).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at2', { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' }),
      ),
    ).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-co-at2', { reservationId, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const dest = folio.lines.find((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM');
    expect(dest?.folioWindowId).toBe(open.ok ? open.folioWindowId : '');
    expect(dest?.folioWindowId).toContain(':COMPANY:');
    expect(folio.lines.some((l) => l.source === 'TRANSFER_REVERSAL')).toBe(true);
    expect(folio.lines.some((l) => l.source === 'TAX' && l.taxOf === dest?.folioLineId)).toBe(true);
  });

  it('3: ROOM→COMPANY rule; no OPEN COMPANY window → lines stay on GUEST; COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000, businessDate },
        await idemFor('room-at3', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at3', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.filter((l) => l.chargeCode === 'ROOM' && l.source !== 'TRANSFER_REVERSAL')).toHaveLength(1);
    expect(folio.lines.some((l) => l.source === 'TRANSFER')).toBe(false);
  });

  it('4: two OPEN COMPANY windows → skip; lines stay on GUEST', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000, businessDate },
        await idemFor('room-at4', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at4', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    for (const party of ['Acme', 'Beta']) {
      expect(
        await stub.tryOpenFolioWindow(
          TEST_OWNER_ACTOR,
          { reservationId, kind: 'COMPANY', billedParty: party },
          await idemFor(`open-${party}-at4`, { reservationId, kind: 'COMPANY', billedParty: party }),
        ),
      ).toMatchObject({ ok: true });
    }
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.some((l) => l.source === 'TRANSFER')).toBe(false);
  });

  it('5: rerun AUTO_TRANSFER same date → no duplicate dest lines', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
    });
    const roomLineId = `fl_${crypto.randomUUID()}`;
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 8000, businessDate },
        await idemFor('room-at5', { folioLineId: roomLineId }),
      ),
    ).toMatchObject({ ok: true });
    const ruleId = `rr_${crypto.randomUUID()}`;
    expect(
      await stub.tryUpsertRoutingRule(
        TEST_OWNER_ACTOR,
        { ruleId, chargeCode: 'ROOM', destWindowKind: 'COMPANY' },
        await idemFor('rule-at5', { ruleId }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryOpenFolioWindow(
        TEST_OWNER_ACTOR,
        { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
        await idemFor('open-at5', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(businessDate, 'AUTO_TRANSFER')).status).toBe('COMPLETED');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.filter((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM')).toHaveLength(1);
  });

  it('6: NIGHT_AUDIT_STEPS length 8; index 3 is AUTO_TRANSFER', () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');
  });

  it('7: full walk includes AUTO_TRANSFER COMPLETED', async () => {
    const { stub } = await provisionedPropertyStub(`na-at-7-${crypto.randomUUID()}`, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(businessDate, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
    for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
      expect((await stub.runAuditStep(businessDate, step)).status).toBe('COMPLETED');
    }
    expect(await stub.getNightAuditStepStatus(businessDate, 'AUTO_TRANSFER')).toBe('COMPLETED');
  });
});
