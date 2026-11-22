import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNTING_JOURNAL_MAX_DAYS,
  ACCOUNTING_LEDGER_MAP_KEY,
  ROLE_GRANTS,
  fingerprintPayload,
  type AccountingJournalDay,
  type AccountingJournalResponse,
  type ReportResponse,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { buildJournalSnapshot, insertJournalSnapshot } from '../src/accounting-journal.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { ensurePlatformSchema, insertProperty, resetPlatformSchemaGate } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';

/** R4.12 Part A: the accounting journal (spec 2026-11-22-accounting-export-a-journal-design). */

const OWNER = { kind: 'user' as const, userId: 'user_owner' };
type Stub = DurableObjectStub<PropertyDO>;

async function get(path: string, actor = 'user_owner') {
  return worker.fetch(
    new Request(`http://localhost${path}`, { method: 'GET', headers: { 'x-dev-actor': actor } }),
    env,
  );
}

async function put(path: string, actor: string, body: unknown) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function runAudit(stub: Stub, d: string, beforeClose?: () => Promise<void>) {
  expect((await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
  for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
    if (step === 'CLOSE_CASHIER_SHIFTS') await beforeClose?.();
    const r = await stub.runAuditStep(d, step);
    expect(r, `${step}: ${JSON.stringify(r)}`).toMatchObject({ status: 'COMPLETED' });
  }
}

type Hotel = {
  stub: Stub;
  orgId: string;
  propertyId: string;
  d: string;
  guestRef: string;
};

async function hotel(label: string, opts: { orgId?: string; tax?: boolean } = {}): Promise<Hotel> {
  const propertyId = `acc-${label}-${crypto.randomUUID()}`;
  const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD', opts.orgId);
  await insertProperty(env, { propertyId, orgId: p.orgId, name: `Acc ${label}`, jurisdiction: null, timeZone: 'UTC' });
  const { stub } = p;
  const d = (await stub.readBusinessDate())!;
  const rt = { roomTypeId: 'rt_a', code: 'RTA', name: 'RTA', roomCount: 6, maxOccupancy: 2, maxAdults: 2 };
  expect((await stub.tryAddRoomType(OWNER, rt, await idemFor('rt', rt))).ok).toBe(true);
  for (let i = 0; i < 6; i++) {
    const day = addCalendarDays(d, i);
    const rate = { roomTypeId: 'rt_a', ratePlanId: 'BAR', stayDate: day, amountMinor: 10000, currency: 'USD' };
    await stub.seedOrphanRateDayForTest(rate);
  }
  const org = testOrgStub(p.orgId);
  await org.ensureMetaOrgId(p.orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Journal Guest', OWNER);
  if (opts.tax) {
    for (const code of ['CGST', 'SGST']) {
      const cc = { code, name: code };
      expect((await stub.tryCreateChargeCode(OWNER, cc, await idemFor(`cc-${code}`, cc))).ok).toBe(true);
    }
    for (const [i, code] of ['CGST', 'SGST'].entries()) {
      const rule = {
        taxRuleId: `tr_${code}`,
        ruleKey: `room_${code}`,
        name: `Room ${code}`,
        ruleType: 'PERCENTAGE' as const,
        rate: '0.06',
        taxGroup: 'ROOM',
        outputChargeCode: code,
        sequence: i + 1,
        validFrom: addCalendarDays(d, -30),
      };
      expect(await stub.tryCreateTaxRule(OWNER, rule, await idemFor(`tax-${code}`, rule))).toMatchObject({ ok: true });
    }
  }
  return { stub, orgId: p.orgId, propertyId, d, guestRef: guest.guestRef };
}

async function book(h: Hotel, id: string, arrival: string, departure: string) {
  const create = {
    reservationId: id,
    roomTypeId: 'rt_a',
    guestRef: h.guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    adults: 2,
    children: 0,
    status: 'confirmed' as const,
  };
  expect(await h.stub.tryCreateReservation(OWNER, create, await idemFor(`c-${id}`, create))).toMatchObject({ ok: true });
}

async function checkIn(h: Hotel, id: string, code: string) {
  const room = { roomId: `rm_${code}_${h.propertyId.slice(-6)}`, roomTypeId: 'rt_a', code };
  expect(await h.stub.tryCreateRoom(OWNER, room, await idemFor(`rm-${room.roomId}`, room))).toMatchObject({ ok: true });
  const ci = { reservationId: id, roomId: room.roomId };
  expect(await h.stub.tryCheckIn(OWNER, ci, await idemFor(`ci-${id}`, ci))).toMatchObject({ ok: true });
}

async function addLine(
  h: Hotel,
  id: string,
  lineId: string,
  chargeCode: string,
  amountMinor: number,
  businessDate: string = h.d,
) {
  const line = { folioLineId: lineId, reservationId: id, chargeCode, amountMinor, businessDate };
  expect(await h.stub.tryAddFolioLine(OWNER, line, await idemFor(lineId, line))).toMatchObject({ ok: true });
}

async function cash(h: Hotel, id: string, paymentId: string, amountMinor: number) {
  const body = { paymentId, reservationId: id, amountMinor };
  expect(
    await h.stub.tryRecordCashPayment(OWNER, {
      ...body,
      idempotencyKey: `cash-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
}

async function upi(h: Hotel, id: string, paymentId: string, amountMinor: number, reference: string) {
  const body = { paymentId, reservationId: id, amountMinor, reference };
  expect(
    await h.stub.tryRecordUpiPayment(OWNER, {
      ...body,
      idempotencyKey: `upi-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
}

async function cardCaptured(h: Hotel, id: string, paymentId: string, amountMinor: number) {
  const body = { paymentId, reservationId: id, amountMinor };
  expect(
    await h.stub.tryAuthorizePayment(OWNER, {
      paymentId,
      reservationId: id,
      amountMinor,
      idempotencyKey: `auth-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
  expect(
    await h.stub.tryCapturePayment(OWNER, {
      paymentId,
      amountMinor,
      idempotencyKey: `cap-${paymentId}`,
      captureFingerprint: await fingerprintPayload({ paymentId, amountMinor }),
    }),
  ).toMatchObject({ ok: true });
}

async function openShift(h: Hotel) {
  const shift = { shiftId: `sh_${crypto.randomUUID()}`, openingFloat: 1000 };
  expect(await h.stub.tryOpenShift(OWNER, shift, await idemFor(`open-${shift.shiftId}`, shift))).toMatchObject({ ok: true });
}

async function journal(h: { propertyId: string }, from: string, to = from, actor = 'user_owner'): Promise<AccountingJournalResponse> {
  const res = await get(`/v1/properties/${h.propertyId}/accounting/journal?from=${from}&to=${to}`, actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AccountingJournalResponse;
}

/** The day without the hotel's ledger names, which a later test may add. */
const bare = (day: AccountingJournalDay): AccountingJournalDay => ({
  ...day,
  lines: day.lines.map((l) => ({ ...l, ledgerName: '', ledgerGroup: '' })),
});
const line = (day: AccountingJournalDay, key: string) => day.lines.find((l) => l.accountKey === key);
/** Debit minus credit of an account on a day (0 when it has no row). */
const net = (day: AccountingJournalDay, key: string) => (line(day, key)?.debitMinor ?? 0) - (line(day, key)?.creditMinor ?? 0);
const sumNet = (day: AccountingJournalDay, prefix: string) =>
  day.lines.filter((l) => l.accountKey.startsWith(prefix)).reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);

async function report(h: { propertyId: string }, id: string, qs: string): Promise<ReportResponse> {
  const res = await get(`/v1/properties/${h.propertyId}/reports/cashier/${id}?${qs}`);
  expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as ReportResponse;
}

type Main = Hotel & {
  d2: string;
  A: string;
  B: string;
  accountId: string;
  companyWindowId: string;
  /** What the day-1 export looked like right after the day-1 close. */
  day1AtClose: AccountingJournalDay;
  /** §3.4: the company window's folio balance and the folio line count either side of the window close. */
  companyBalanceAfterClose: number;
  linesBeforeClose: number;
  linesAfterClose: number;
};

async function folioLineCount(stub: Stub): Promise<number> {
  return runInDurableObject(stub, (_i, state) =>
    Number((state.storage.sql.exec(`SELECT COUNT(*) AS n FROM folio_line`).toArray()[0] as { n: number }).n),
  );
}

async function windowBalance(stub: Stub, windowId: string): Promise<number> {
  return runInDurableObject(stub, (_i, state) =>
    Number(
      (
        state.storage.sql
          .exec(`SELECT COALESCE(SUM(ledger_amount_minor), 0) AS n FROM folio_line WHERE folio_window_id = ?`, windowId)
          .toArray()[0] as { n: number }
      ).n,
    ),
  );
}

/**
 * Two closed days on one hotel, with CGST + SGST on room charges.
 * Day 1 (d): A checks in (room night, MISC moved to a COMPANY window that is then closed with a
 * non-zero receivable), cash, UPI and card payments, and a UPI advance on B (arrives d+1).
 * Day 2 (d+1): B checks in, a late charge, a card refund, and a settlement from the company.
 */
let mainPromise: Promise<Main> | null = null;
function main(): Promise<Main> {
  mainPromise ??= buildMain();
  return mainPromise;
}

async function buildMain(): Promise<Main> {
  const h = await hotel('main', { tax: true });
  const d2 = addCalendarDays(h.d, 1);
  const A = `res_a_${crypto.randomUUID().slice(0, 8)}`;
  const B = `res_b_${crypto.randomUUID().slice(0, 8)}`;
  await openShift(h);
  await book(h, B, d2, addCalendarDays(h.d, 3));
  await upi(h, B, 'pay_b_adv', 5000, 'UTR000001');
  await book(h, A, h.d, addCalendarDays(h.d, 2));
  await checkIn(h, A, '101');
  await addLine(h, A, `${A}:misc`, 'MISC', 2000);
  const acct = { name: 'Acme Corp' };
  const created = await h.stub.tryCreateCityLedgerAccount(OWNER, acct, await idemFor('cla', acct));
  expect(created).toMatchObject({ ok: true });
  const accountId = (created as { accountId: string }).accountId;
  const co = { reservationId: A, kind: 'COMPANY' as const, billedParty: 'Acme Corp' };
  const opened = await h.stub.tryOpenFolioWindow(OWNER, co, await idemFor('co', co));
  expect(opened).toMatchObject({ ok: true });
  const companyWindowId = (opened as { folioWindowId: string }).folioWindowId;
  const xfer = { sourceFolioLineId: `${A}:misc`, destinationFolioWindowId: companyWindowId };
  expect(await h.stub.tryTransferCharge(OWNER, xfer, await idemFor('xfer', xfer))).toMatchObject({ ok: true });
  await cash(h, A, 'pay_a_cash', 3000);
  await upi(h, A, 'pay_a_upi', 2000, 'UTR000002');
  await cardCaptured(h, A, 'pay_a_card', 4000);
  const linesBeforeClose = await folioLineCount(h.stub);
  const close = { folioWindowId: companyWindowId };
  expect(await h.stub.tryCloseFolioWindow(OWNER, close, await idemFor('close-co', close))).toMatchObject({ ok: true });
  const linesAfterClose = await folioLineCount(h.stub);
  const companyBalanceAfterClose = await windowBalance(h.stub, companyWindowId);
  await runAudit(h.stub, h.d);
  const day1AtClose = (await journal(h, h.d)).days[0]!;

  // Day 2 (the business date is now d+1). The test clock never reaches the next calendar day, so
  // the audit's roll is a no-op: move the date here.
  await h.stub.setBusinessDateForTest(d2);
  await checkIn(h, B, '102');
  await addLine(h, A, `${A}:late`, 'MISC', 700, d2);
  const refund = { paymentId: 'pay_a_card', amountMinor: 1000 };
  expect(await h.stub.tryRefundPayment(OWNER, refund, await idemFor('refund', refund))).toMatchObject({ ok: true });
  const settle = { accountId, amountMinor: 1000, businessDate: d2, reference: 'NEFT-9' };
  expect(await h.stub.tryReceiveCityLedgerPayment(OWNER, settle, await idemFor('settle', settle))).toMatchObject({ ok: true });
  await runAudit(h.stub, d2);
  return {
    ...h,
    d2,
    A,
    B,
    accountId,
    companyWindowId,
    day1AtClose,
    companyBalanceAfterClose,
    linesBeforeClose,
    linesAfterClose,
  };
}

type StatsRow = Record<string, number | string>;
async function statsRow(stub: Stub, date: string): Promise<StatsRow | undefined> {
  const rows = (await runInDurableObject(stub, (_i, state) =>
    state.storage.sql.exec(`SELECT * FROM night_audit_day_stats WHERE business_date = ?`, date).toArray(),
  )) as StatsRow[];
  return rows[0];
}

async function journalDayRow(stub: Stub, date: string): Promise<StatsRow | undefined> {
  const rows = (await runInDurableObject(stub, (_i, state) =>
    state.storage.sql.exec(`SELECT * FROM night_audit_journal_day WHERE business_date = ?`, date).toArray(),
  )) as StatsRow[];
  return rows[0];
}

describe('R4.12 accounting journal, Part A', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('1. each stored day balances, and the day row says so', async () => {
    const m = await main();
    const r = await journal(m, m.d, m.d2);
    expect(r.currency).toBe('USD');
    expect(r.days.map((x) => [x.businessDate, x.status])).toEqual([
      [m.d, 'ok'],
      [m.d2, 'ok'],
    ]);
    for (const day of r.days) {
      expect(day.debitTotalMinor).toBeGreaterThan(0);
      expect(day.debitTotalMinor).toBe(day.creditTotalMinor);
      for (const l of day.lines) {
        expect(l.debitMinor === 0 || l.creditMinor === 0, `${l.accountKey} has both sides`).toBe(true);
        expect(/^[A-Z_]+(:[A-Z0-9_]+)?$/.test(l.accountKey)).toBe(true);
      }
      expect(day.lines.map((l) => l.accountKey)).toEqual([...day.lines.map((l) => l.accountKey)].sort());
      expect(await journalDayRow(m.stub, day.businessDate)).toMatchObject({ balanced: 1, currency: 'USD' });
    }
  });

  it('2. ties to the tax report, the cashier summary, the day statistics and the trial balance', async () => {
    const m = await main();
    const r = await journal(m, m.d, m.d2);
    const tb = await report(m, 'cashier_trial_balance', `from=${m.d}&to=${m.d2}`);
    const num = (v: unknown) => Number(v ?? 0);
    for (const day of r.days) {
      const date = day.businessDate;
      // Tax: credits to TAX:* equal the tax report's total for the date.
      const tax = await report(m, 'cashier_tax_report', `from=${date}&to=${date}`);
      expect(-sumNet(day, 'TAX:')).toBe(num(tax.totals?.tax));
      expect(-sumNet(day, 'TAX:')).toBeGreaterThan(0);

      // Day statistics: payments by tender (a refund is "other" there, CARD here).
      const stats = (await statsRow(m.stub, date))!;
      expect(sumNet(day, 'TENDER:')).toBe(
        num(stats.pay_card_minor) + num(stats.pay_cash_minor) + num(stats.pay_upi_minor) + num(stats.pay_other_minor),
      );

      // Trial balance, guest ledger: every line of the day. The journal's guest ledger is that movement
      // less the advance reclass and plus the receivables that moved on to the city ledger (§3.4).
      const guestRow = tb.rows.find((x) => x.section === 'Guest ledger' && x.date === date)!;
      const guestMovement =
        num(guestRow.charges) + num(guestRow.taxes) + num(guestRow.payments) + num(guestRow.adjustments) + num(guestRow.transfers);
      const cityRow = tb.rows.find((x) => x.section === 'City ledger' && x.date === date)!;
      const receivables = num(cityRow.charges);
      const settlements = Math.abs(num(cityRow.payments));
      const advanceCredit = -net(day, 'ADVANCE_DEPOSITS');
      expect(guestMovement).toBe(net(day, 'GUEST_LEDGER') - advanceCredit + receivables);
      // City ledger: receivables less settlements; settlements also debit the receipts account.
      expect(net(day, 'CITY_LEDGER')).toBe(receivables - settlements);
      expect(net(day, 'CITY_LEDGER_RECEIPTS')).toBe(settlements);
      // Charges, taxes and payments columns each equal their accounts.
      expect(num(guestRow.taxes)).toBe(-sumNet(day, 'TAX:'));
      expect(num(guestRow.payments)).toBe(-sumNet(day, 'TENDER:'));
      expect(num(guestRow.charges) + num(guestRow.adjustments)).toBe(-sumNet(day, 'REVENUE:'));
    }

    // Day 1 has no refund: tenders equal the cashier summary's per-shift payments exactly, and the
    // day statistics split the same way.
    const summary = await report(m, 'cashier_summary', `from=${m.d}&to=${m.d}`);
    const shiftTotal = summary.rows.reduce((n, x) => n + num(x.cash) + num(x.card) + num(x.upi), 0);
    const day1 = r.days[0]!;
    expect(sumNet(day1, 'TENDER:')).toBe(shiftTotal);
    expect(net(day1, 'TENDER:CASH')).toBe(num(summary.totals?.cash));
    expect(net(day1, 'TENDER:CARD')).toBe(num(summary.totals?.card));
    expect(net(day1, 'TENDER:UPI')).toBe(num(summary.totals?.upi));
    const stats1 = (await statsRow(m.stub, m.d))!;
    expect([net(day1, 'TENDER:CARD'), net(day1, 'TENDER:CASH'), net(day1, 'TENDER:UPI')]).toEqual([
      num(stats1.pay_card_minor),
      num(stats1.pay_cash_minor),
      num(stats1.pay_upi_minor),
    ]);
  });

  it('3. GST posts by component: CGST and SGST are two TAX rows', async () => {
    const m = await main();
    const [day1, day2] = (await journal(m, m.d, m.d2)).days;
    for (const day of [day1!, day2!]) {
      expect(day.lines.filter((l) => l.accountKey.startsWith('TAX:')).map((l) => l.accountKey)).toEqual([
        'TAX:CGST',
        'TAX:SGST',
      ]);
    }
    expect(line(day1!, 'TAX:CGST')).toMatchObject({ debitMinor: 0, creditMinor: 600 });
    expect(line(day1!, 'TAX:SGST')).toMatchObject({ debitMinor: 0, creditMinor: 600 });
    // Day 2: A's second night and B's first night.
    expect(line(day2!, 'TAX:CGST')).toMatchObject({ creditMinor: 1200 });
    expect(line(day2!, 'TAX:SGST')).toMatchObject({ creditMinor: 1200 });
    expect(line(day1!, 'REVENUE:ROOM')).toMatchObject({ creditMinor: 10000 });
    expect(line(day1!, 'REVENUE:MISC')).toMatchObject({ creditMinor: 2000 });
    expect(line(day2!, 'REVENUE:MISC')).toMatchObject({ creditMinor: 700 });
  });

  it('4. a refund debits no tender: it credits the tender of the payment it returns', async () => {
    const m = await main();
    const [day1, day2] = (await journal(m, m.d, m.d2)).days;
    expect(line(day1!, 'TENDER:CARD')).toMatchObject({ debitMinor: 4000, creditMinor: 0 });
    expect(line(day1!, 'TENDER:UPI')).toMatchObject({ debitMinor: 7000, creditMinor: 0 });
    expect(line(day1!, 'TENDER:CASH')).toMatchObject({ debitMinor: 3000, creditMinor: 0 });
    expect(line(day2!, 'TENDER:CARD')).toMatchObject({ debitMinor: 0, creditMinor: 1000 });
    expect(line(day2!, 'TENDER:OTHER')).toBeUndefined();
  });

  it('5. advances: a pre-arrival UPI payment credits ADVANCE_DEPOSITS; check-in moves it to GUEST_LEDGER', async () => {
    const m = await main();
    const [day1, day2] = (await journal(m, m.d, m.d2)).days;
    expect(line(day1!, 'ADVANCE_DEPOSITS')).toEqual({
      accountKey: 'ADVANCE_DEPOSITS',
      ledgerName: '',
      ledgerGroup: '',
      debitMinor: 0,
      creditMinor: 5000,
    });
    expect(await journalDayRow(m.stub, m.d)).toMatchObject({ advance_closing_minor: 5000 });
    // B checked in on day 2: nothing is held any more, so the whole 5000 comes back.
    expect(line(day2!, 'ADVANCE_DEPOSITS')).toMatchObject({ debitMinor: 5000, creditMinor: 0 });
    expect(await journalDayRow(m.stub, m.d2)).toMatchObject({ advance_closing_minor: 0 });
    // Day 1 guest ledger: charges 13200 (room, MISC, taxes) less payments 14000 (the 5000 advance
    // included), plus the 5000 reclassed to advances, less the 2000 receivable moved to the city ledger.
    expect(net(day1!, 'GUEST_LEDGER')).toBe(13200 - 14000 + 5000 - 2000);
  });

  it('6. a COMPANY receivable with a non-zero balance posts CITY_LEDGER, and its settlement posts the receipts account', async () => {
    const m = await main();
    // §3.4: closing a COMPANY window posts a city-ledger entry and no folio line, so the receivable
    // stays on the folio and the journal moves it: Dr CITY_LEDGER / Cr GUEST_LEDGER.
    expect(m.linesAfterClose).toBe(m.linesBeforeClose);
    expect(m.companyBalanceAfterClose).toBe(2000);
    const [day1, day2] = (await journal(m, m.d, m.d2)).days;
    expect(line(day1!, 'CITY_LEDGER')).toMatchObject({ debitMinor: 2000, creditMinor: 0 });
    expect(line(day1!, 'CITY_LEDGER_RECEIPTS')).toBeUndefined();
    expect(line(day2!, 'CITY_LEDGER_RECEIPTS')).toMatchObject({ debitMinor: 1000, creditMinor: 0 });
    expect(line(day2!, 'CITY_LEDGER')).toMatchObject({ debitMinor: 0, creditMinor: 1000 });
    // The folio window still shows 2000 while the city ledger shows the open receivable of 1000.
    const detail = await m.stub.readCityLedgerAccount(m.accountId);
    expect(detail).toMatchObject({ ok: true, openBalanceMinor: 1000 });
  });

  it('7. a re-export is the same journal, and a late charge lands on the next business date', async () => {
    const m = await main();
    const first = await journal(m, m.d, m.d2);
    const second = await journal(m, m.d, m.d2);
    expect(second).toEqual(first);
    expect(bare(first.days[0]!)).toEqual(m.day1AtClose);

    // A charge posted for the date that closed is on the folio, but the stored journal does not move.
    await addLine(m, m.A, `${m.A}:very_late`, 'MISC', 333, m.d2);
    const d3 = addCalendarDays(m.d2, 1);
    await addLine(m, m.A, `${m.A}:next`, 'MISC', 444, d3);
    const third = await journal(m, m.d, d3);
    expect(third.days.slice(0, 2)).toEqual(first.days);
    expect(bare(third.days[0]!)).toEqual(m.day1AtClose);
    expect(third.days[2]).toEqual({
      businessDate: d3,
      status: 'not_recorded',
      lines: [],
      debitTotalMinor: 0,
      creditTotalMinor: 0,
    });
  });

  it('8. dates with no stored journal say so; with no dates the answer is the last closed date', async () => {
    const m = await main();
    const before = await journal(m, addCalendarDays(m.d, -2), addCalendarDays(m.d, -1));
    expect(before.days.map((x) => x.status)).toEqual(['not_recorded', 'not_recorded']);
    expect(before.days.every((x) => x.lines.length === 0)).toBe(true);
    expect(before.unmappedKeys).toEqual([]);
    const res = await get(`/v1/properties/${m.propertyId}/accounting/journal`);
    const body = (await res.json()) as AccountingJournalResponse;
    // The business date is m.d2 (the test moved it by hand), so the last closed date is m.d.
    expect(body.days.map((x) => [x.businessDate, x.status])).toEqual([[m.d, 'ok']]);
  });

  it('9. a ledger map names the keys; unmapped keys are listed', async () => {
    const m = await main();
    const unmappedBefore = (await journal(m, m.d)).unmappedKeys;
    expect(unmappedBefore).toContain('GUEST_LEDGER');
    const value = {
      ledgers: [
        { accountKey: 'REVENUE:ROOM', ledgerName: 'Room Sales', ledgerGroup: 'Sales Accounts' },
        { accountKey: 'TAX:CGST', ledgerName: 'Output CGST' },
        { accountKey: 'TENDER:UPI', ledgerName: 'UPI Collections', ledgerGroup: 'Bank Accounts' },
      ],
    };
    const saved = await put(`/v1/properties/${m.propertyId}/config/domain`, 'user_owner', {
      key: ACCOUNTING_LEDGER_MAP_KEY,
      value,
      reason: 'initial mapping',
      idempotencyKey: `map-${crypto.randomUUID()}`,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const r = await journal(m, m.d);
    const day = r.days[0]!;
    expect(line(day, 'REVENUE:ROOM')).toMatchObject({ ledgerName: 'Room Sales', ledgerGroup: 'Sales Accounts' });
    expect(line(day, 'TAX:CGST')).toMatchObject({ ledgerName: 'Output CGST', ledgerGroup: '' });
    expect(line(day, 'TAX:SGST')).toMatchObject({ ledgerName: '' });
    expect(r.unmappedKeys).not.toContain('REVENUE:ROOM');
    expect(r.unmappedKeys).toContain('TAX:SGST');
    expect(r.unmappedKeys).toEqual([...r.unmappedKeys].sort());
    // The numbers do not depend on the mapping.
    expect(bare(day)).toEqual(m.day1AtClose);

    // Two rows for one key are refused, and the stored map stays.
    const dup = await put(`/v1/properties/${m.propertyId}/config/domain`, 'user_owner', {
      key: ACCOUNTING_LEDGER_MAP_KEY,
      value: { ledgers: [value.ledgers[0], value.ledgers[0]] },
      reason: 'duplicate',
      idempotencyKey: `map-${crypto.randomUUID()}`,
    });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.status).toBeLessThan(500);
    expect(line((await journal(m, m.d)).days[0]!, 'REVENUE:ROOM')).toMatchObject({ ledgerName: 'Room Sales' });
  });

  it('10. a cancelled stay with a retained penalty clears its advance', async () => {
    const h = await hotel('cancel');
    const d2 = addCalendarDays(h.d, 1);
    const C = `res_c_${crypto.randomUUID().slice(0, 8)}`;
    await openShift(h);
    await book(h, C, addCalendarDays(h.d, 2), addCalendarDays(h.d, 3));
    await upi(h, C, 'pay_c_adv', 3000, 'UTR000003');
    await runAudit(h.stub, h.d);
    const day1 = (await journal(h, h.d)).days[0]!;
    expect(line(day1, 'ADVANCE_DEPOSITS')).toMatchObject({ creditMinor: 3000 });
    expect(net(day1, 'GUEST_LEDGER')).toBe(-3000 + 3000);

    await h.stub.setBusinessDateForTest(d2);
    await h.stub.execSqlForTest(
      `UPDATE reservation SET cancel_penalty_type = 'first_night', cancel_grace_hours = 9999 WHERE reservation_id = ?`,
      C,
    );
    const cancel = { reservationId: C };
    const cancelled = await h.stub.tryCancelReservation(OWNER, cancel, await idemFor('cancel-c', cancel));
    expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ ok: true });
    await runAudit(h.stub, d2);
    const day2 = (await journal(h, d2)).days[0]!;
    expect(day2.status).toBe('ok');
    expect(line(day2, 'REVENUE:CANCEL')).toMatchObject({ creditMinor: 10000 });
    expect(line(day2, 'ADVANCE_DEPOSITS')).toMatchObject({ debitMinor: 3000, creditMinor: 0 });
    // The guest still owes the penalty less the 3000 held.
    expect(net(day2, 'GUEST_LEDGER')).toBe(10000 - 3000);
    expect(await journalDayRow(h.stub, d2)).toMatchObject({ advance_closing_minor: 0 });
  });

  it('11. a builder that throws leaves the audit, the day statistics and the reports intact', async () => {
    const h = await hotel('boom');
    const A = `res_x_${crypto.randomUUID().slice(0, 8)}`;
    await openShift(h);
    await book(h, A, h.d, addCalendarDays(h.d, 1));
    await checkIn(h, A, '101');
    await cash(h, A, 'pay_x_cash', 1500);
    await h.stub.setJournalFailureForTest('journal builder exploded');
    try {
      await runAudit(h.stub, h.d);
    } finally {
      await h.stub.setJournalFailureForTest(null);
    }
    expect(await statsRow(h.stub, h.d)).toMatchObject({ business_date: h.d, pay_cash_minor: 1500 });
    expect(await journalDayRow(h.stub, h.d)).toBeUndefined();
    const day = (await journal(h, h.d)).days[0]!;
    expect(day).toEqual({ businessDate: h.d, status: 'not_recorded', lines: [], debitTotalMinor: 0, creditTotalMinor: 0 });
    // The steps that follow the snapshot completed.
    const runs = (await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(`SELECT step, status FROM night_audit_run WHERE business_date = ?`, h.d)
        .toArray(),
    )) as Array<{ step: string; status: string }>;
    expect(runs.every((r) => r.status === 'COMPLETED')).toBe(true);
    expect(runs.map((r) => r.step)).toContain('ARCHIVE');
  });

  it('12. a day that does not balance is stored and flagged, and the audit goes on', async () => {
    const h = await hotel('unbalanced');
    const A = `res_u_${crypto.randomUUID().slice(0, 8)}`;
    await book(h, A, h.d, addCalendarDays(h.d, 1));
    await checkIn(h, A, '101');
    // A transfer leg with no counter-leg: the kind of ledger damage the flag exists to show.
    await h.stub.insertFolioLineRawForTest({
      folioLineId: `${A}:orphan_leg`,
      folioWindowId: `${A}:GUEST`,
      reservationId: A,
      chargeCode: 'MISC',
      amountMinor: 500,
      source: 'TRANSFER',
      businessDate: h.d,
    });
    await runAudit(h.stub, h.d);
    const day = (await journal(h, h.d)).days[0]!;
    expect(day.status).toBe('unbalanced');
    expect(day.debitTotalMinor).not.toBe(day.creditTotalMinor);
    expect(await journalDayRow(h.stub, h.d)).toMatchObject({ balanced: 0 });
    expect(await statsRow(h.stub, h.d)).toBeDefined();
  });

  it('13. permission, entitlement and range: staff 403, no entitlement 402, over 31 days 422', async () => {
    const m = await main();
    const base = `/v1/properties/${m.propertyId}/accounting/journal`;
    const staffId = `user_acc_staff_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: m.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    expect((ROLE_GRANTS.staff as readonly string[]).includes('accounting:export')).toBe(false);
    expect((ROLE_GRANTS.admin as readonly string[]).includes('accounting:export')).toBe(true);
    expect((ROLE_GRANTS.owner as readonly string[]).includes('accounting:export')).toBe(true);
    const denied = await get(`${base}?from=${m.d}&to=${m.d}`, staffId);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden', permission: 'accounting:export' });
    const stranger = await get(`${base}?from=${m.d}`, `user_stranger_${crypto.randomUUID()}`);
    expect(stranger.status).toBe(404);

    // 31 days is the limit.
    const ok = await get(`${base}?from=${m.d}&to=${addCalendarDays(m.d, ACCOUNTING_JOURNAL_MAX_DAYS - 1)}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AccountingJournalResponse).days).toHaveLength(ACCOUNTING_JOURNAL_MAX_DAYS);
    const over = await get(`${base}?from=${m.d}&to=${addCalendarDays(m.d, ACCOUNTING_JOURNAL_MAX_DAYS)}`);
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ ok: false, error: 'limit_exceeded', limit: 'days', max: 31 });
    expect((await get(`${base}?from=${m.d2}&to=${m.d}`)).status).toBe(400);
    expect((await get(`${base}?from=2026-02-30`)).status).toBe(400);

    // An org without the entitlement is refused before anything is read.
    await env.PLATFORM_DB.prepare(
      `DELETE FROM plan_feature WHERE plan_code = 'starter' AND feature_key = 'accounting_export.enabled'`,
    ).run();
    try {
      const unentitled = await hotel('unentitled');
      const res = await get(`/v1/properties/${unentitled.propertyId}/accounting/journal?from=${unentitled.d}`);
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: 'entitlement_required', feature: 'accounting_export.enabled' });
    } finally {
      await env.PLATFORM_DB.prepare(
        `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'accounting_export.enabled', 'true')`,
      ).run();
    }
  });

  it('14. two properties in one org: A never sees B, and B never sees A', async () => {
    const a = await main();
    const b = await hotel('other', { orgId: a.orgId });
    await openShift(b);
    const R = `res_o_${crypto.randomUUID().slice(0, 8)}`;
    await book(b, R, b.d, addCalendarDays(b.d, 1));
    await checkIn(b, R, '101');
    await cash(b, R, 'pay_o_cash', 7777);
    await runAudit(b.stub, b.d);

    const forB = (await journal(b, b.d)).days[0]!;
    expect(line(forB, 'TENDER:CASH')).toMatchObject({ debitMinor: 7777 });
    expect(line(forB, 'CITY_LEDGER')).toBeUndefined();
    expect(line(forB, 'TAX:CGST')).toBeUndefined();
    expect(line(forB, 'ADVANCE_DEPOSITS')).toBeUndefined();

    const forA = await journal(a, a.d, a.d2);
    expect(JSON.stringify(forA)).not.toContain('7777');
    expect(bare(forA.days[0]!)).toEqual(a.day1AtClose);
    // The same date on each side holds only its own rows.
    expect(forA.days[0]!.lines.find((l) => l.accountKey === 'TENDER:CASH')).toMatchObject({ debitMinor: 3000 });
  });

  it('15. storing a date again replaces its rows and keeps one day row', async () => {
    const h = await hotel('replace');
    const snapshot = (lines: Array<{ accountKey: string; debitMinor: number; creditMinor: number }>) => ({
      businessDate: h.d,
      currency: 'USD',
      advanceClosingMinor: 0,
      balanced: true,
      lines,
    });
    await runInDurableObject(h.stub, (_i, state) => {
      insertJournalSnapshot(
        state.storage.sql,
        snapshot([
          { accountKey: 'GUEST_LEDGER', debitMinor: 100, creditMinor: 0 },
          { accountKey: 'REVENUE:ROOM', debitMinor: 0, creditMinor: 100 },
        ]),
        1,
      );
      insertJournalSnapshot(
        state.storage.sql,
        snapshot([
          { accountKey: 'GUEST_LEDGER', debitMinor: 250, creditMinor: 0 },
          { accountKey: 'TENDER:CASH', debitMinor: 0, creditMinor: 250 },
        ]),
        2,
      );
    });
    const day = (await journal(h, h.d)).days[0]!;
    expect(day.lines.map((l) => [l.accountKey, l.debitMinor, l.creditMinor])).toEqual([
      ['GUEST_LEDGER', 250, 0],
      ['TENDER:CASH', 0, 250],
    ]);
    expect(await journalDayRow(h.stub, h.d)).toMatchObject({ recorded_at: 2 });
    // Both sides on one row, or a negative amount, never reach the table.
    await expect(
      runInDurableObject(h.stub, (_i, state) => {
        state.storage.sql.exec(
          `INSERT INTO night_audit_journal_line (business_date, account_key, debit_minor, credit_minor) VALUES (?, 'X', 1, 1)`,
          h.d,
        );
      }),
    ).rejects.toThrow();
  });
});

describe('R4.12 journal builder', () => {
  it('writes a net row per account and never both sides', () => {
    const sql = {
      exec: (q: string) => {
        if (q.includes('FROM city_ledger_entry')) {
          return { toArray: () => [{ kind: 'charge', amount_minor: 300 }, { kind: 'adjustment', amount_minor: -100 }, { kind: 'payment', amount_minor: 50 }] };
        }
        return { toArray: () => [] };
      },
    };
    const lines = buildJournalSnapshot({
      sql: sql as never,
      businessDate: '2026-11-22',
      currency: 'USD',
      dateOfInstant: () => '2026-11-22',
      advanceClosingMinor: 0,
      previousAdvanceClosingMinor: 400,
      ledger: { lines: [], byId: new Map() },
    });
    expect(lines.balanced).toBe(true);
    expect(lines.lines).toEqual([
      { accountKey: 'ADVANCE_DEPOSITS', debitMinor: 400, creditMinor: 0 },
      { accountKey: 'CITY_LEDGER', debitMinor: 150, creditMinor: 0 },
      { accountKey: 'CITY_LEDGER_RECEIPTS', debitMinor: 50, creditMinor: 0 },
      { accountKey: 'GUEST_LEDGER', debitMinor: 0, creditMinor: 600 },
    ]);
  });
});
