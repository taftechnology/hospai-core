import { describe, expect, it } from 'vitest';
import { V1_HTTP_ROUTE_AUDIT } from './v1-http-routes.js';
import { averageDailyRateMinor, revParMinor, roundedRatio, wholePercent } from './report-stats.js';
import {
  REPORT_DEFINITIONS,
  REPORT_GROUPS,
  REPORT_GROUP_PERMISSION,
  REPORT_ROUTE_SEGMENT,
  parseReportParams,
  reportDefinition,
  reportGroupsWithReports,
  reportPath,
  reportPermissions,
  reportCodeWord,
  reportRangeSpan,
} from './reports.js';

const COLUMN_TYPES = ['text', 'date', 'datetime', 'integer', 'money', 'percent', 'guest', 'staff', 'status'];

describe('report registry', () => {
  it('ids are unique snake_case; every column is typed and keyed once; spans are set', () => {
    const ids = REPORT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of REPORT_DEFINITIONS) {
      expect(d.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(REPORT_GROUPS).toContain(d.group);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      const keys = d.columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const c of d.columns) {
        expect(COLUMN_TYPES).toContain(c.type);
        expect(c.label.length).toBeGreaterThan(0);
      }
      if (d.params.kind === 'range') {
        expect(d.params.maxSpan).toBeGreaterThan(0);
        expect(d.params.maxSpan).toBeLessThanOrEqual(90);
        expect(d.params.defaultSpan).toBeGreaterThan(0);
        expect(d.params.defaultSpan).toBeLessThanOrEqual(d.params.maxSpan);
      }
    }
  });

  it('Part A registers the six front-office reports first', () => {
    expect(REPORT_DEFINITIONS.slice(0, 6).map((d) => d.id)).toEqual([
      'front_office_arrivals',
      'front_office_departures',
      'front_office_in_house',
      'front_office_forecast',
      'front_office_availability_detailed',
      'front_office_availability_monthly',
    ]);
    expect(reportGroupsWithReports()).toEqual(['front_office', 'cashier_financial', 'night_audit', 'housekeeping']);
    expect(reportDefinition('front_office_forecast')?.params).toMatchObject({ maxSpan: 90 });
  });

  it('each definition names a route whose audit permission is its group permission', () => {
    for (const d of REPORT_DEFINITIONS) {
      const route = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === d.routeId);
      expect(route, d.routeId).toBeDefined();
      expect(route).toMatchObject({ permission: REPORT_GROUP_PERMISSION[d.group] });
    }
    const manager = V1_HTTP_ROUTE_AUDIT.findIndex((r) => r.id === 'get_manager_report');
    expect(V1_HTTP_ROUTE_AUDIT[manager]?.id).toBe('get_manager_report');
    expect(V1_HTTP_ROUTE_AUDIT[manager - 1]?.id).toBe('get_housekeeping_report');
    expect(V1_HTTP_ROUTE_AUDIT[manager - 2]?.id).toBe('get_audit_report');
    expect(V1_HTTP_ROUTE_AUDIT[manager - 3]?.id).toBe('get_cashier_report');
    expect(V1_HTTP_ROUTE_AUDIT[manager - 4]?.id).toBe('get_front_office_report');
    expect(reportPath('p 1', reportDefinition('front_office_in_house')!)).toBe(
      `/v1/properties/p%201/reports/${REPORT_ROUTE_SEGMENT.get_front_office_report}/front_office_in_house`,
    );
  });
});

describe('Part B cashier and financial registry', () => {
  const cashier = REPORT_DEFINITIONS.filter((d) => d.group === 'cashier_financial');

  it('registers the ten reports on the cashier route with the folio permission', () => {
    expect(cashier.map((d) => d.id)).toEqual([
      'cashier_summary',
      'cashier_audit',
      'cashier_corrections',
      'cashier_deposit_activity',
      'cashier_deposit_ledger',
      'cashier_detailed_folio',
      'cashier_open_folio_register',
      'cashier_tax_report',
      'cashier_trial_balance',
      'cashier_guest_trial_balance',
    ]);
    for (const d of cashier) {
      expect(d.routeId).toBe('get_cashier_report');
      expect(reportPermissions(d)[0]).toBe('folio:read');
      expect(d.columns.every((c) => c.label.length > 0)).toBe(true);
    }
    expect(REPORT_ROUTE_SEGMENT.get_cashier_report).toBe('cashier');
    expect(reportPath('p', reportDefinition('cashier_tax_report')!)).toBe(
      '/v1/properties/p/reports/cashier/cashier_tax_report',
    );
  });

  it('the shift-reading reports also name the shift read permission', () => {
    const shiftRoute = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_shift');
    for (const id of ['cashier_summary', 'cashier_audit']) {
      expect(reportPermissions(reportDefinition(id)!)).toContain((shiftRoute as { permission: string }).permission);
      expect(reportDefinition(id)!.extraPermissions).toBeDefined();
    }
    expect(reportDefinition('cashier_tax_report')!.extraPermissions).toBeUndefined();
  });

  it('typed columns: money amounts, staff and datetime where the figures need them', () => {
    const type = (id: string, key: string) =>
      reportDefinition(id)!.columns.find((c) => c.key === key)?.type;
    expect(type('cashier_summary', 'cashier')).toBe('staff');
    expect(type('cashier_summary', 'openedAt')).toBe('datetime');
    expect(type('cashier_summary', 'variance')).toBe('money');
    expect(type('cashier_guest_trial_balance', 'status')).toBe('status');
    expect(type('cashier_audit', 'guest')).toBe('guest');
  });

  it('parameters: reservation is required and bounded; cashier and tender filters validate', () => {
    const folio = reportDefinition('cashier_detailed_folio')!;
    const audit = reportDefinition('cashier_audit')!;
    const q = (o: Record<string, string>) => (n: string) => o[n] ?? null;
    expect(parseReportParams(folio, q({}))).toMatchObject({ ok: false, detail: 'reservation_required' });
    expect(parseReportParams(folio, q({ reservationId: 'a b' }))).toMatchObject({ detail: 'invalid_reservation' });
    expect(parseReportParams(folio, q({ reservationId: 'x'.repeat(129) }))).toMatchObject({
      detail: 'invalid_reservation',
    });
    expect(parseReportParams(folio, q({ reservationId: 'res_1' }))).toEqual({
      ok: true,
      params: { reservationId: 'res_1' },
    });
    const range = { from: '2026-01-01', to: '2026-01-02' };
    expect(parseReportParams(audit, q({ ...range, tender: 'CASH', cashier: 'user_abc' }))).toEqual({
      ok: true,
      params: { ...range, tender: 'CASH', cashier: 'user_abc' },
    });
    expect(parseReportParams(audit, q({ ...range, tender: 'CHEQUE' }))).toMatchObject({ detail: 'invalid_tender' });
    expect(parseReportParams(audit, q({ ...range, cashier: "x'; DROP" }))).toMatchObject({
      detail: 'invalid_cashier',
    });
    // The tax report has no cashier filter: it is ignored, not stored.
    const tax = reportDefinition('cashier_tax_report')!;
    expect(parseReportParams(tax, q({ ...range, cashier: 'user_abc' }))).toEqual({ ok: true, params: range });
  });
});

describe('parseReportParams', () => {
  const forecast = reportDefinition('front_office_forecast')!;
  const arrivals = reportDefinition('front_office_arrivals')!;
  const inHouse = reportDefinition('front_office_in_house')!;
  const q = (o: Record<string, string>) => (n: string) => o[n] ?? null;

  it('counts the span inclusively and rejects over the maximum', () => {
    expect(reportRangeSpan('2026-01-01', '2026-01-01')).toBe(1);
    expect(parseReportParams(forecast, q({ from: '2026-01-01', to: '2026-03-31' }))).toMatchObject({ ok: true });
    expect(parseReportParams(forecast, q({ from: '2026-01-01', to: '2026-04-01' }))).toEqual({
      ok: false,
      error: 'limit_exceeded',
      limit: 'span',
      max: 90,
    });
    expect(parseReportParams(arrivals, q({ from: '2026-01-01', to: '2026-02-01' }))).toMatchObject({
      error: 'limit_exceeded',
      max: 31,
    });
  });

  it('rejects bad dates, half ranges, reversed ranges and unknown filter values', () => {
    expect(parseReportParams(inHouse, q({ date: '2026-02-30' }))).toMatchObject({ error: 'invalid_query' });
    expect(parseReportParams(arrivals, q({ from: '2026-01-01' }))).toMatchObject({ detail: 'range_incomplete' });
    expect(parseReportParams(arrivals, q({ from: '2026-01-02', to: '2026-01-01' }))).toMatchObject({
      detail: 'invalid_date_range',
    });
    expect(parseReportParams(arrivals, q({ from: '2026-01-01', to: '2026-01-01', status: 'bogus' }))).toMatchObject({
      detail: 'invalid_status',
    });
  });

  it('accepts nothing (business-date defaults) and a status filter', () => {
    expect(parseReportParams(forecast, q({}))).toEqual({ ok: true, params: {} });
    expect(parseReportParams(inHouse, q({}))).toEqual({ ok: true, params: {} });
    expect(parseReportParams(arrivals, q({ from: '2026-01-01', to: '2026-01-03', status: 'confirmed' }))).toEqual({
      ok: true,
      params: { from: '2026-01-01', to: '2026-01-03', status: 'confirmed' },
    });
  });
});

describe('Part C night-audit and housekeeping registry', () => {
  const audit = REPORT_DEFINITIONS.filter((d) => d.group === 'night_audit');
  const hk = REPORT_DEFINITIONS.filter((d) => d.group === 'housekeeping');
  const q = (o: Record<string, string>) => (n: string) => o[n] ?? null;

  it('registers four night-audit reports on the audit route and twelve housekeeping reports', () => {
    expect(audit.map((d) => d.id)).toEqual([
      'night_audit_report',
      'night_audit_revenue',
      'night_audit_daily_statistics',
      'night_audit_end_of_day',
    ]);
    expect(hk.map((d) => d.id)).toEqual([
      'housekeeping_room_status',
      'housekeeping_status_history',
      'housekeeping_blocks',
      'housekeeping_attendant_workload',
      'housekeeping_inspection_scores',
      'housekeeping_guest_audit',
      'housekeeping_requests',
      'housekeeping_lost_found',
      'housekeeping_cases',
      'housekeeping_linen',
      'housekeeping_minibar',
      'housekeeping_amenities',
    ]);
    for (const d of audit) {
      expect(d.routeId).toBe('get_audit_report');
      expect(d.params.kind).toBe('closed_date');
      expect(reportPermissions(d)).toEqual(['night_audit:run']);
    }
    for (const d of hk) {
      expect(d.routeId).toBe('get_housekeeping_report');
      expect(reportPermissions(d)).toEqual(['housekeeping:read']);
      if (d.params.kind === 'range') expect(d.params.maxSpan).toBe(31);
    }
    expect(REPORT_ROUTE_SEGMENT.get_audit_report).toBe('night-audit');
    expect(reportPath('p', reportDefinition('night_audit_end_of_day')!)).toBe(
      '/v1/properties/p/reports/night-audit/night_audit_end_of_day',
    );
    expect(reportPath('p', reportDefinition('housekeeping_minibar')!)).toBe(
      '/v1/properties/p/reports/housekeeping/housekeeping_minibar',
    );
  });

  it('statistics columns show a dash when undefined', () => {
    const stats = reportDefinition('night_audit_daily_statistics')!;
    expect(stats.columns.filter((c) => c.emptyAsDash).map((c) => c.key)).toEqual(['occupancy', 'adr', 'revpar']);
  });

  it('the closed-date and no-parameter kinds parse; the room status report takes nothing', () => {
    const revenue = reportDefinition('night_audit_revenue')!;
    expect(parseReportParams(revenue, q({}))).toEqual({ ok: true, params: {} });
    expect(parseReportParams(revenue, q({ date: '2026-02-30' }))).toMatchObject({ error: 'invalid_query' });
    expect(parseReportParams(revenue, q({ date: '2026-02-01' }))).toEqual({
      ok: true,
      params: { date: '2026-02-01' },
    });
    const rooms = reportDefinition('housekeeping_room_status')!;
    expect(parseReportParams(rooms, q({ date: '2026-02-01' }))).toEqual({ ok: true, params: {} });
  });

  it('housekeeping filters validate: fixed lists, ids and the inspector', () => {
    const range = { from: '2026-01-01', to: '2026-01-02' };
    const requests = reportDefinition('housekeeping_requests')!;
    expect(parseReportParams(requests, q({ ...range, department: 'front_office', status: 'open' }))).toEqual({
      ok: true,
      params: { ...range, department: 'front_office', status: 'open' },
    });
    expect(parseReportParams(requests, q({ ...range, department: 'kitchen' }))).toMatchObject({
      detail: 'invalid_department',
    });
    const history = reportDefinition('housekeeping_status_history')!;
    expect(parseReportParams(history, q({ ...range, room: 'rm_101' }))).toEqual({
      ok: true,
      params: { ...range, room: 'rm_101' },
    });
    expect(parseReportParams(history, q({ ...range, room: "x'; --" }))).toMatchObject({ detail: 'invalid_room' });
    const scores = reportDefinition('housekeeping_inspection_scores')!;
    expect(parseReportParams(scores, q({ ...range, inspector: 'user_1', room: 'rm_1' }))).toEqual({
      ok: true,
      params: { ...range, inspector: 'user_1', room: 'rm_1' },
    });
    expect(parseReportParams(scores, q({ ...range, inspector: 'a b' }))).toMatchObject({
      detail: 'invalid_inspector',
    });
    const linen = reportDefinition('housekeeping_linen')!;
    expect(parseReportParams(linen, q({ ...range, kind: 'laundry_out', item: 'item_1' }))).toEqual({
      ok: true,
      params: { ...range, kind: 'laundry_out', item: 'item_1' },
    });
    expect(parseReportParams(linen, q({ ...range, kind: 'sold' }))).toMatchObject({ detail: 'invalid_kind' });
    expect(
      parseReportParams(reportDefinition('housekeeping_blocks')!, q({ from: '2026-01-01', to: '2026-03-01' })),
    ).toMatchObject({ error: 'limit_exceeded', max: 31 });
  });

  it('codes become words', () => {
    expect(reportCodeWord('in_progress')).toBe('In progress');
    expect(reportCodeWord('food_beverage')).toBe('Food and beverage');
    expect(reportCodeWord(null)).toBe('');
  });
});

describe('roundedRatio (the one rounding rule for report statistics)', () => {
  it('rounds half up and returns null for a zero or negative denominator', () => {
    expect(roundedRatio(1, 2)).toBe(1);
    expect(roundedRatio(1, 3)).toBe(0);
    expect(roundedRatio(2, 3)).toBe(1);
    expect(roundedRatio(5, 2)).toBe(3);
    expect(roundedRatio(0, 5)).toBe(0);
    expect(roundedRatio(5, 0)).toBeNull();
    expect(roundedRatio(5, -1)).toBeNull();
  });

  it('rounds a negative numerator half away from zero', () => {
    expect(roundedRatio(-5, 2)).toBe(-3);
    expect(roundedRatio(-1, 3)).toBe(0);
  });

  it('occupancy, ADR and RevPAR use it', () => {
    expect(wholePercent(1, 8)).toBe(13); // 12.5 rounds up
    expect(wholePercent(0, 0)).toBeNull();
    expect(averageDailyRateMinor(10001, 2)).toBe(5001); // 5000.5 rounds up
    expect(averageDailyRateMinor(10000, 0)).toBeNull();
    expect(revParMinor(10000, 3)).toBe(3333);
    expect(revParMinor(10000, 0)).toBeNull();
  });
});
