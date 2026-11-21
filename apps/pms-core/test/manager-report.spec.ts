import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MANAGER_REPORT_CONFIG_DEFAULT,
  MANAGER_REPORT_ROWS,
  ROLE_GRANTS,
  fingerprintPayload,
  fiscalYearStart,
  monthStart,
  roundedRatio,
  type ManagerReportConfig,
  type ManagerReportResponse,
  type ManagerReportRow,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { reportObjectKey } from '../src/event-log.js';
import { capSourceMix, moneyRatio, paymentsByTender } from '../src/manager-report.js';
import type { OrgDO } from '../src/org-do.js';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { ensurePlatformSchema, insertProperty, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, provisionedPropertyStub } from './guest-helpers.js';

/** R4.32: Manager Report and MIS settings (spec 2026-11-20-manager-report-design). */

const OWNER = { kind: 'user' as const, userId: 'user_owner' };
const KEY = 'pms.reports.manager_report';

async function call(path: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost${path}`, { method: 'GET', headers: { 'x-dev-actor': actor } }),
    env,
  );
}

type Stub = Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'];

async function runAudit(stub: Stub, d: string, beforeClose?: () => Promise<void>) {
  expect((await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
  for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
    if (step === 'CLOSE_CASHIER_SHIFTS') await beforeClose?.();
    const r = await stub.runAuditStep(d, step);
    expect(r, `${step}: ${JSON.stringify(r)}`).toMatchObject({ status: 'COMPLETED' });
  }
}

async function snapshot(propertyId: string, d: string, id: string) {
  const obj = await env.EVENT_LOG_R2!.get(reportObjectKey(propertyId, d, id));
  expect(obj, `${id} snapshot`).not.toBeNull();
  return JSON.parse(await obj!.text()) as Record<string, unknown>;
}

type StatsRow = Record<string, number | string>;
async function statsRows(stub: Stub): Promise<StatsRow[]> {
  return (await runInDurableObject(stub, (_i, state) =>
    state.storage.sql.exec(`SELECT * FROM night_audit_day_stats ORDER BY business_date`).toArray(),
  )) as StatsRow[];
}

type Hotel = {
  stub: Stub;
  orgId: string;
  propertyId: string;
  d: string;
  d2: string;
  actor: string;
};

/**
 * A seeded first day `d`: five rooms (one out of order), three checked-in stays from three
 * sources (adults 2+1+2, one child), a confirmed stay that is marked no-show, a stay that checked
 * out on `d`, one cancellation, an F&B line, an "other" line, and a cash and a UPI payment.
 */
async function closedDay(opts: { config?: Partial<ManagerReportConfig>; secondDay?: boolean } = {}): Promise<Hotel> {
  const propertyId = `mgr-${crypto.randomUUID()}`;
  const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
  await insertProperty(env, { propertyId, orgId: p.orgId, name: 'Manager Hotel', jurisdiction: null, timeZone: 'UTC' });
  const { stub } = p;
  const d = (await stub.readBusinessDate())!;
  const d2 = addCalendarDays(d, 1);
  const add = { roomTypeId: 'rt_a', code: 'RTA', name: 'RTA', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
  expect((await stub.tryAddRoomType(OWNER, add, await idemFor('add-rt-a', add))).ok).toBe(true);
  for (const day of [d, d2]) {
    const rate = { roomTypeId: 'rt_a', ratePlanId: DEFAULT_RATE_PLAN_ID, stayDate: day, amountMinor: 10000, currency: 'USD' };
    expect(await stub.tryUpsertRateDay(OWNER, rate, await idemFor(`rate-${day}`, rate))).toEqual({ ok: true });
  }
  const code = { code: 'RESTAURANT', name: 'Restaurant' };
  expect((await stub.tryCreateChargeCode(OWNER, code, await idemFor('cc-rest', code))).ok).toBe(true);
  await stub.writeConfigValueForTest(KEY, {
    ...MANAGER_REPORT_CONFIG_DEFAULT,
    fnbChargeCodes: ['RESTAURANT'],
    ...opts.config,
  });

  const stay = async (id: string, status: string, source: string, adults: number, children: number, arrival = d, dep = addCalendarDays(d, 2)) => {
    await stub.insertReservationForTest({
      reservationId: id,
      roomTypeId: 'rt_a',
      guestRef: `g_${id}`,
      piiKeyId: `p_${id}`,
      arrivalDate: arrival,
      departureDate: dep,
      status,
      adults,
      children,
    });
    await stub.execSqlForTest(`UPDATE reservation SET source_code = ? WHERE reservation_id = ?`, source, id);
  };
  await stay('res_ci1', 'checked_in', 'WALKIN', 2, 1);
  await stay('res_ci2', 'checked_in', 'OTA1', 1, 0);
  await stay('res_ci3', 'checked_in', 'ZZZ', 2, 0);
  await stay('res_ns', 'confirmed', 'OTA1', 2, 0);
  await stay('res_out', 'checked_out', 'WALKIN', 1, 0, addCalendarDays(d, -1), d);
  await stub.execSqlForTest(`UPDATE reservation SET checked_out_business_date = ? WHERE reservation_id = 'res_out'`, d);
  // Four nights held for the day (the no-show releases its own); one room out of order.
  await stub.bumpSoldForTest('rt_a', d, 4);
  await stub.bumpSoldForTest('rt_a', d2, 4);
  await stub.execSqlForTest(
    `UPDATE availability_day SET blocked = 1 WHERE room_type_id = 'rt_a' AND stay_date = ?`,
    d,
  );
  // One cancellation made on `d` (the property clock is UTC here).
  await stub.execSqlForTest(
    `INSERT INTO audit_log (at, actor, command_id, entity_type, entity_id, after_json, created_at)
     VALUES (?, 'user_owner', 'reservations.cancel', 'reservation', 'res_cx', '{"status":"cancelled"}', ?)`,
    Date.parse(`${d}T01:00:00Z`),
    Date.now(),
  );

  const shift = { shiftId: `sh_${crypto.randomUUID()}`, openingFloat: 1000 };
  await runAudit(stub, d, async () => {
    expect(await stub.tryOpenShift(OWNER, shift, await idemFor(`open-${shift.shiftId}`, shift))).toMatchObject({ ok: true });
    for (const [lineId, chargeCode, amount] of [
      ['fl_fnb', 'RESTAURANT', 4000],
      ['fl_misc', 'MISC', 1500],
    ] as const) {
      const line = { folioLineId: lineId, reservationId: 'res_ci1', chargeCode, amountMinor: amount, businessDate: d };
      expect(await stub.tryAddFolioLine(OWNER, line, await idemFor(lineId, line))).toMatchObject({ ok: true });
    }
    const cash = { paymentId: 'pay_cash', reservationId: 'res_ci1', amountMinor: 3000 };
    expect(
      await stub.tryRecordCashPayment(OWNER, {
        ...cash,
        idempotencyKey: 'cash-1',
        requestFingerprint: await fingerprintPayload(cash),
      }),
    ).toMatchObject({ ok: true });
    const upi = { paymentId: 'pay_upi', reservationId: 'res_ci2', amountMinor: 2000, reference: 'UTR000777' };
    expect(
      await stub.tryRecordUpiPayment(OWNER, {
        ...upi,
        idempotencyKey: 'upi-1',
        requestFingerprint: await fingerprintPayload(upi),
      }),
    ).toMatchObject({ ok: true });
  });
  if (opts.secondDay) await runAudit(stub, d2);
  return { stub, orgId: p.orgId, propertyId, d, d2, actor: 'user_owner' };
}

async function report(h: { propertyId: string; actor: string }, qs = ''): Promise<ManagerReportResponse> {
  const res = await call(`/v1/properties/${h.propertyId}/reports/manager${qs ? `?${qs}` : ''}`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ManagerReportResponse;
}

const rowOf = (r: ManagerReportResponse, id: string): ManagerReportRow => {
  const row = r.rows.find((x) => x.rowId === id);
  expect(row, id).toBeDefined();
  return row!;
};

describe('R4.32 Manager Report', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. the snapshot step writes a stats row equal to the R2 occupancy, revenue and cashier snapshots', async () => {
    const h = await closedDay();
    const [row] = await statsRows(h.stub);
    expect(row).toBeDefined();
    const occ = await snapshot(h.propertyId, h.d, 'occupancy');
    const rev = await snapshot(h.propertyId, h.d, 'revenue');
    const cashier = (await snapshot(h.propertyId, h.d, 'cashier')) as {
      tendersByCurrency: Array<{ currency: string; capturedMinor: number; refundedMinor: number }>;
    };
    expect(row!.business_date).toBe(h.d);
    expect(row).toMatchObject({
      physical: occ.physical,
      blocked: occ.blocked,
      sold: occ.sold,
      room_revenue_minor: rev.roomNet,
      tax_minor: rev.taxTotal,
      currency: 'USD',
    });
    // Seeded: 5 rooms, one out of order, three stays kept after the no-show released its night.
    expect(row).toMatchObject({ physical: 5, blocked: 1, sold: 3, room_revenue_minor: 30000, tax_minor: 0 });
    const usd = cashier.tendersByCurrency.find((t) => t.currency === 'USD')!;
    const paid = Number(row!.pay_card_minor) + Number(row!.pay_cash_minor) + Number(row!.pay_upi_minor) + Number(row!.pay_other_minor);
    expect(paid).toBe(usd.capturedMinor - usd.refundedMinor);
    expect(row).toMatchObject({ pay_cash_minor: 3000, pay_upi_minor: 2000, pay_card_minor: 0, pay_other_minor: 0 });
    // Revenue by category foots to the snapshot's lines: room + F&B + other = every non-payment, non-tax line.
    const lines = rev.byChargeCodeAndSource as Array<{ chargeCode: string; source: string | null; ledgerAmountMinor: number }>;
    const net = lines
      .filter((l) => l.chargeCode !== 'PAYMENT' && l.source !== 'TAX')
      .reduce((n, l) => n + l.ledgerAmountMinor, 0);
    expect(Number(row!.room_revenue_minor) + Number(row!.fnb_revenue_minor) + Number(row!.other_revenue_minor)).toBe(net);
    expect(row).toMatchObject({ fnb_revenue_minor: 4000, other_revenue_minor: 1500 });
    // Movements and guests.
    expect(row).toMatchObject({
      arrivals: 3,
      departures: 1,
      no_shows: 1,
      no_show_nights: 1,
      cancellations: 1,
      in_house_adults: 5,
      in_house_children: 1,
      comp_nights: 0,
    });
    const mix = JSON.parse(String(row!.source_mix_json)) as Record<string, [number, number]>;
    expect(mix).toEqual({ WALKIN: [1, 10000 + 0], OTA1: [1, 10000], ZZZ: [1, 10000] });
    expect(Object.keys(mix).length).toBeLessThanOrEqual(50);
  });

  it('2. the Day column foots to the row, and two closed days sum (ratios recomputed from sums)', async () => {
    const h = await closedDay({ secondDay: true });
    const rows = await statsRows(h.stub);
    expect(rows.map((r) => r.business_date)).toEqual([h.d, h.d2]);

    const day1 = await report(h, `date=${h.d}`);
    expect(day1.date).toBe(h.d);
    expect(rowOf(day1, 'rooms_in_hotel').values.day).toBe(5);
    expect(rowOf(day1, 'rooms_out_of_order').values.day).toBe(1);
    expect(rowOf(day1, 'rooms_available').values.day).toBe(4);
    expect(rowOf(day1, 'rooms_sold').values.day).toBe(3);
    expect(rowOf(day1, 'occupancy_pct').values.day).toBe(75);
    expect(rowOf(day1, 'room_revenue').values.day).toBe(30000);
    expect(rowOf(day1, 'adr').values.day).toBe(10000);
    expect(rowOf(day1, 'revpar').values.day).toBe(7500);
    expect(rowOf(day1, 'fnb_revenue').values.day).toBe(4000);
    expect(rowOf(day1, 'other_revenue').values.day).toBe(1500);
    expect(rowOf(day1, 'total_revenue').values.day).toBe(35500);
    expect(rowOf(day1, 'tax').values.day).toBe(0);
    expect(rowOf(day1, 'payments_cash').values.day).toBe(3000);
    expect(rowOf(day1, 'payments_upi').values.day).toBe(2000);
    expect(rowOf(day1, 'payments_card').values.day).toBe(0);
    expect(rowOf(day1, 'payments_total').values.day).toBe(5000);
    expect(rowOf(day1, 'arrivals').values.day).toBe(3);
    expect(rowOf(day1, 'departures').values.day).toBe(1);
    expect(rowOf(day1, 'no_shows').values.day).toBe(1);
    expect(rowOf(day1, 'cancellations').values.day).toBe(1);
    expect(rowOf(day1, 'in_house_adults').values.day).toBe(5);
    expect(rowOf(day1, 'in_house_children').values.day).toBe(1);
    // The Day column equals the stored row's components.
    for (const [rowId, col] of [
      ['rooms_in_hotel', 'physical'],
      ['rooms_sold', 'sold'],
      ['room_revenue', 'room_revenue_minor'],
      ['fnb_revenue', 'fnb_revenue_minor'],
      ['tax', 'tax_minor'],
    ] as const) {
      expect(rowOf(day1, rowId).values.day, rowId).toBe(Number(rows[0]![col]));
    }

    // Month and year columns sum the recorded days in their ranges.
    const day2 = await report(h, `date=${h.d2}`);
    const inRange = (from: string) => rows.filter((r) => String(r.business_date) >= from && String(r.business_date) <= h.d2);
    const sumOf = (list: StatsRow[], col: string) => list.reduce((n, r) => n + Number(r[col]), 0);
    const mtd = inRange(monthStart(h.d2));
    const ytd = inRange(fiscalYearStart(h.d2, 4));
    expect(rowOf(day2, 'room_revenue').values.mtd).toBe(sumOf(mtd, 'room_revenue_minor'));
    expect(rowOf(day2, 'room_revenue').values.ytd).toBe(sumOf(ytd, 'room_revenue_minor'));
    expect(rowOf(day2, 'rooms_sold').values.mtd).toBe(sumOf(mtd, 'sold'));
    expect(day2.columns.find((c) => c.id === 'mtd')).toMatchObject({ from: monthStart(h.d2), to: h.d2, recordedDays: mtd.length });
    expect(day2.columns.find((c) => c.id === 'ytd')).toMatchObject({ from: fiscalYearStart(h.d2, 4), recordedDays: ytd.length });
    // Ratios come from the summed components, not an average of days.
    const available = sumOf(mtd, 'physical') - sumOf(mtd, 'blocked');
    expect(rowOf(day2, 'occupancy_pct').values.mtd).toBe(roundedRatio(sumOf(mtd, 'sold') * 100, available));
    expect(rowOf(day2, 'adr').values.mtd).toBe(roundedRatio(sumOf(mtd, 'room_revenue_minor'), sumOf(mtd, 'sold')));
    expect(rowOf(day2, 'revpar').values.mtd).toBe(roundedRatio(sumOf(mtd, 'room_revenue_minor'), available));
    if (mtd.length === 2) {
      // 3 of 4 rooms the first day, 3 of 5 the second: 6 of 9 is 67%, where the average of 75 and 60 is 68.
      expect(rowOf(day2, 'occupancy_pct').values.mtd).toBe(67);
    }
  });

  it('3. an occupancy rule changes the rows that depend on it and no others', async () => {
    const h = await closedDay();
    const base = await report(h, `date=${h.d}`);

    await h.stub.writeConfigValueForTest(KEY, {
      ...MANAGER_REPORT_CONFIG_DEFAULT,
      fnbChargeCodes: ['RESTAURANT'],
      occupancy: { excludeOutOfOrder: true, countNoShowAsSold: true },
    });
    const noShow = await report(h, `date=${h.d}`);
    const changedA = base.rows.filter((r) => JSON.stringify(r.values) !== JSON.stringify(rowOf(noShow, r.rowId).values));
    expect(changedA.map((r) => r.rowId).sort()).toEqual(['adr', 'occupancy_pct', 'rooms_sold']);
    expect(rowOf(noShow, 'rooms_sold').values.day).toBe(4);
    expect(rowOf(noShow, 'occupancy_pct').values.day).toBe(100);
    expect(rowOf(noShow, 'adr').values.day).toBe(7500);

    await h.stub.writeConfigValueForTest(KEY, {
      ...MANAGER_REPORT_CONFIG_DEFAULT,
      fnbChargeCodes: ['RESTAURANT'],
      occupancy: { excludeOutOfOrder: false, countNoShowAsSold: false },
    });
    const withOoo = await report(h, `date=${h.d}`);
    const changedB = base.rows.filter((r) => JSON.stringify(r.values) !== JSON.stringify(rowOf(withOoo, r.rowId).values));
    expect(changedB.map((r) => r.rowId).sort()).toEqual(['occupancy_pct', 'revpar', 'rooms_available']);
    expect(rowOf(withOoo, 'rooms_available').values.day).toBe(5);
    expect(rowOf(withOoo, 'occupancy_pct').values.day).toBe(60);
    expect(rowOf(withOoo, 'revpar').values.day).toBe(6000);
  });

  it('4. disabling a row removes it; relabel, reorder and decimals show up', async () => {
    const h = await closedDay();
    const rows = MANAGER_REPORT_CONFIG_DEFAULT.rows.map((r) => ({ ...r }));
    const without = rows.filter((r) => r.rowId !== 'tax' && r.rowId !== 'adr');
    const arrivals = without.find((r) => r.rowId === 'arrivals')!;
    arrivals.label = 'Check-ins';
    const occ = without.find((r) => r.rowId === 'occupancy_pct')!;
    occ.decimals = 1;
    const revpar = without.find((r) => r.rowId === 'revpar')!;
    revpar.decimals = 0;
    // Move total revenue to the front; keep the two disabled rows in the list, switched off.
    const moved = without.splice(without.findIndex((r) => r.rowId === 'total_revenue'), 1)[0]!;
    const next = [
      moved,
      ...without,
      { ...rows.find((r) => r.rowId === 'tax')!, enabled: false },
      { ...rows.find((r) => r.rowId === 'adr')!, enabled: false },
    ];
    await h.stub.writeConfigValueForTest(KEY, { ...MANAGER_REPORT_CONFIG_DEFAULT, fnbChargeCodes: ['RESTAURANT'], rows: next });
    const r = await report(h, `date=${h.d}`);
    expect(r.rows.some((x) => x.rowId === 'tax')).toBe(false);
    expect(r.rows.some((x) => x.rowId === 'adr')).toBe(false);
    expect(r.rows[0]!.rowId).toBe('total_revenue');
    expect(rowOf(r, 'arrivals').label).toBe('Check-ins');
    // 3 of 4 rooms is 75.0%: one decimal is a value of 750 at scale 1.
    expect(rowOf(r, 'occupancy_pct')).toMatchObject({ scale: 1 });
    expect(rowOf(r, 'occupancy_pct').values.day).toBe(750);
    expect(rowOf(r, 'revpar').values.day).toBe(7500);
    expect(rowOf(r, 'rooms_sold').scale).toBe(0);
    // Decimals only apply to ratios, from the components in one rounding.
    expect(moneyRatio(10000, 3, 0, 2)).toBe(3300);
    expect(moneyRatio(10000, 3, 1, 2)).toBe(3330);
    expect(moneyRatio(10000, 3, 2, 2)).toBe(3333);
    expect(moneyRatio(10000, 0, 2, 2)).toBeNull();
  });

  it('5. source buckets group codes; unmapped codes go to Other', async () => {
    const h = await closedDay({
      config: { sourceBuckets: { WALKIN: 'Direct', OTA1: 'OTA', OTA2: 'OTA' } },
    });
    const r = await report(h, `date=${h.d}`);
    const nights = r.rows.filter((x) => x.rowId === 'source_nights');
    expect(nights.map((x) => [x.label, x.values.day])).toEqual([
      ['Direct: room nights', 1],
      ['OTA: room nights', 1],
      ['Other: room nights', 1],
    ]);
    const revenue = r.rows.filter((x) => x.rowId === 'source_revenue');
    expect(revenue.map((x) => [x.label, x.values.day])).toEqual([
      ['Direct: room revenue', 10000],
      ['OTA: room revenue', 10000],
      ['Other: room revenue', 10000],
    ]);
    // The room revenue by bucket foots to the day's room revenue.
    expect(revenue.reduce((n, x) => n + Number(x.values.day), 0)).toBe(rowOf(r, 'room_revenue').values.day);
  });

  it('6. the year starts in the configured fiscal month', async () => {
    const h = await closedDay();
    const month = Number(h.d.slice(5, 7));
    const prevMonth = month === 1 ? 12 : month - 1;
    // A statistics row from before this month: inside the year only when the year starts earlier.
    const early = addCalendarDays(monthStart(h.d), -1);
    await h.stub.execSqlForTest(
      `INSERT INTO night_audit_day_stats (business_date, currency, physical, blocked, sold, no_show_nights, arrivals, departures, no_shows, cancellations, in_house_adults, in_house_children, room_revenue_minor, fnb_revenue_minor, other_revenue_minor, tax_minor, pay_card_minor, pay_cash_minor, pay_upi_minor, pay_other_minor, recorded_at)
       VALUES (?, 'USD', 5, 0, 2, 0, 0, 0, 0, 0, 0, 0, 7000, 0, 0, 0, 0, 0, 0, 0, 1)`,
      early,
    );
    const sameMonth = await report(h, `date=${h.d}`);
    expect(sameMonth.fiscalYearStart).toBe(fiscalYearStart(h.d, 4));

    await h.stub.writeConfigValueForTest(KEY, { ...MANAGER_REPORT_CONFIG_DEFAULT, fiscalYearStartMonth: month });
    const startsThisMonth = await report(h, `date=${h.d}`);
    expect(startsThisMonth.fiscalYearStart).toBe(monthStart(h.d));
    expect(rowOf(startsThisMonth, 'room_revenue').values.ytd).toBe(30000);

    await h.stub.writeConfigValueForTest(KEY, { ...MANAGER_REPORT_CONFIG_DEFAULT, fiscalYearStartMonth: prevMonth });
    const startsLastMonth = await report(h, `date=${h.d}`);
    expect(startsLastMonth.fiscalYearStart).toBe(fiscalYearStart(h.d, prevMonth));
    expect(rowOf(startsLastMonth, 'room_revenue').values.ytd).toBe(30000 + 7000);
    expect(rowOf(startsLastMonth, 'room_revenue').values.mtd).toBe(30000);
  });

  it('7. a date with no row is listed as not recorded, with no error', async () => {
    const h = await closedDay({ secondDay: true });
    await h.stub.execSqlForTest(`DELETE FROM night_audit_day_stats WHERE business_date = ?`, h.d);
    const r = await report(h, `date=${h.d}`);
    const day = r.columns.find((c) => c.id === 'day')!;
    expect(day).toMatchObject({ recordedDays: 0, notRecorded: [h.d] });
    expect(rowOf(r, 'rooms_sold').values.day).toBeNull();
    expect(rowOf(r, 'occupancy_pct').values.day).toBeNull();
    expect(r.columns.find((c) => c.id === 'mtd')!.notRecorded.includes(h.d) || monthStart(h.d2) > h.d).toBe(true);
    // The other day is untouched.
    const other = await report(h, `date=${h.d2}`);
    expect(rowOf(other, 'room_revenue').values.day).not.toBeNull();
    expect(other.columns.find((c) => c.id === 'day')!.notRecorded).toEqual([]);
    // A malformed date is a 400; no date gives the last closed date.
    const bad = await call(`/v1/properties/${h.propertyId}/reports/manager?date=2026-02-30`, h.actor);
    expect(bad.status).toBe(400);
    expect((await report(h)).date).toBe(h.d2);
  });

  it('8. tenancy and permission: hotel A cannot run hotel B, a stranger gets 404, staff get 403', async () => {
    const a = await closedDay();
    const bId = `mgr-b-${crypto.randomUUID()}`;
    const b = await provisionedPropertyStub(bId, 'UTC', 'USD', a.orgId);
    await insertProperty(env, { propertyId: bId, orgId: a.orgId, name: 'Manager Hotel B', jurisdiction: null, timeZone: 'UTC' });
    const bReport = await report({ propertyId: bId, actor: 'user_owner' }, `date=${a.d}`);
    expect(bReport.columns.find((c) => c.id === 'day')).toMatchObject({ recordedDays: 0 });
    expect(rowOf(bReport, 'room_revenue').values.day).toBeNull();
    expect(JSON.stringify(bReport)).not.toContain('Manager Hotel');
    expect(await statsRows(b.stub)).toEqual([]);

    const stranger = await call(`/v1/properties/${a.propertyId}/reports/manager`, `user_stranger_${crypto.randomUUID()}`);
    expect(stranger.status).toBe(404);

    const grants = ROLE_GRANTS.staff as unknown as string[];
    expect(grants).not.toContain('night_audit:run');
    const staffId = `user_mgr_staff_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: a.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    const denied = await call(`/v1/properties/${a.propertyId}/reports/manager`, staffId);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'night_audit:run' });
  });
});

describe('R4.32 pure helpers', () => {
  it('caps the source mix at 50 codes, folding the rest', () => {
    const mix: Record<string, [number, number]> = {};
    for (let i = 0; i < 60; i++) mix[`S${String(i).padStart(2, '0')}`] = [i + 1, (i + 1) * 100];
    const capped = capSourceMix(mix);
    expect(Object.keys(capped)).toHaveLength(50);
    const total = (m: Record<string, [number, number]>) => Object.values(m).reduce((n, v) => n + v[0], 0);
    expect(total(capped)).toBe(total(mix));
    expect(capped['*']).toBeDefined();
    expect(capSourceMix({ A: [1, 2] })).toEqual({ A: [1, 2] });
  });

  it('nets refunds and chargebacks by tender with the cashier snapshot sign rule', () => {
    expect(
      paymentsByTender([
        { source: null, amountMinor: -5000, ledgerAmountMinor: -5000, tenderType: 'CARD' },
        { source: 'PAYMENT_REFUND', amountMinor: 1000, ledgerAmountMinor: 1000, tenderType: 'CARD' },
        { source: null, amountMinor: -2000, ledgerAmountMinor: -2000, tenderType: 'CASH' },
        { source: null, amountMinor: -700, ledgerAmountMinor: -700, tenderType: 'UPI' },
        { source: null, amountMinor: -50, ledgerAmountMinor: -50, tenderType: null },
      ]),
    ).toEqual({ card: 4000, cash: 2000, upi: 700, other: 50 });
  });

  it('keeps every built-in row in the default config', () => {
    expect(MANAGER_REPORT_CONFIG_DEFAULT.rows.map((r) => r.rowId)).toEqual(MANAGER_REPORT_ROWS.map((r) => r.rowId));
  });
});
