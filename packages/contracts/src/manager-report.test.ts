import { describe, expect, it } from 'vitest';
import {
  MANAGER_REPORT_CONFIG_DEFAULT,
  MANAGER_REPORT_KEY,
  MANAGER_REPORT_ROWS,
  MANAGER_REPORT_SECTIONS,
  ManagerReportConfigSchema,
  fiscalYearStart,
  monthStart,
  parseManagerReportDate,
  readManagerReportConfig,
} from './manager-report.js';
import { V1_HTTP_ROUTE_AUDIT } from './v1-http-routes.js';
import { getConfigEntry } from './config/register.js';

describe('Manager Report row registry (R4.32)', () => {
  it('row ids are unique and every row has a section, a kind and a label', () => {
    const ids = MANAGER_REPORT_ROWS.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of MANAGER_REPORT_ROWS) {
      expect(MANAGER_REPORT_SECTIONS).toContain(row.section);
      expect(['count', 'money', 'percent']).toContain(row.kind);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.label.length).toBeLessThanOrEqual(40);
    }
  });

  it('lists the spec rows: rooms, movements, guests, revenue, tenders and source mix', () => {
    expect(MANAGER_REPORT_ROWS.map((r) => r.rowId)).toEqual([
      'rooms_in_hotel', 'rooms_out_of_order', 'rooms_available', 'rooms_sold', 'occupancy_pct',
      'arrivals', 'departures', 'no_shows', 'cancellations',
      'in_house_adults', 'in_house_children',
      'room_revenue', 'adr', 'revpar', 'fnb_revenue', 'other_revenue', 'total_revenue', 'tax',
      'payments_card', 'payments_cash', 'payments_upi', 'payments_total',
      'source_nights', 'source_revenue',
    ]);
    const ratios = MANAGER_REPORT_ROWS.filter((r) => r.ratio).map((r) => r.rowId);
    expect(ratios).toEqual(['occupancy_pct', 'adr', 'revpar']);
  });
});

describe('pms.reports.manager_report config', () => {
  it('is a DOMAIN key whose default parses, with April as the fiscal year start', () => {
    const entry = getConfigEntry(MANAGER_REPORT_KEY);
    expect(entry?.class).toBe('DOMAIN');
    expect(entry?.permission).toBe('settings:configure');
    expect(ManagerReportConfigSchema.safeParse(MANAGER_REPORT_CONFIG_DEFAULT).success).toBe(true);
    expect(MANAGER_REPORT_CONFIG_DEFAULT.fiscalYearStartMonth).toBe(4);
    expect(MANAGER_REPORT_CONFIG_DEFAULT.occupancy).toEqual({ excludeOutOfOrder: true, countNoShowAsSold: false });
  });

  it('rejects unknown rows, missing rows, long labels, bad decimals and months, and too many buckets', () => {
    const base = structuredClone(MANAGER_REPORT_CONFIG_DEFAULT);
    const bad = (mutate: (c: typeof base) => void) => {
      const c = structuredClone(base);
      mutate(c);
      return ManagerReportConfigSchema.safeParse(c).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((c) => c.rows.pop())).toBe(false);
    expect(bad((c) => { c.rows[0]!.rowId = 'made_up'; })).toBe(false);
    expect(bad((c) => { c.rows[1]!.rowId = c.rows[0]!.rowId; })).toBe(false);
    expect(bad((c) => { c.rows[0]!.label = 'x'.repeat(41); })).toBe(false);
    expect(bad((c) => { c.rows[0]!.label = '  '; })).toBe(false);
    expect(bad((c) => { c.rows[0]!.decimals = 3; })).toBe(false);
    expect(bad((c) => { c.fiscalYearStartMonth = 13; })).toBe(false);
    expect(bad((c) => { c.fiscalYearStartMonth = 0; })).toBe(false);
    expect(bad((c) => { c.sourceBuckets = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`S${i}`, `B${i}`])); })).toBe(false);
    expect(bad((c) => { c.sourceBuckets = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`S${i}`, `B${i}`])); })).toBe(true);
    expect(bad((c) => { c.sourceBuckets = { 'bad code': 'x' }; })).toBe(false);
    expect(bad((c) => { c.fnbChargeCodes = ['ROOM']; })).toBe(false);
    expect(bad((c) => { (c as Record<string, unknown>).formula = '1+1'; })).toBe(false);
  });

  it('a stored value that does not parse reads as the default', () => {
    expect(readManagerReportConfig({ nonsense: true })).toEqual(MANAGER_REPORT_CONFIG_DEFAULT);
    expect(readManagerReportConfig(undefined)).toEqual(MANAGER_REPORT_CONFIG_DEFAULT);
  });
});

describe('fiscal year and month starts', () => {
  it('starts the fiscal year in the configured month', () => {
    expect(fiscalYearStart('2026-11-20', 4)).toBe('2026-04-01');
    expect(fiscalYearStart('2026-03-31', 4)).toBe('2025-04-01');
    expect(fiscalYearStart('2026-04-01', 4)).toBe('2026-04-01');
    expect(fiscalYearStart('2026-11-20', 1)).toBe('2026-01-01');
    expect(fiscalYearStart('2026-01-15', 12)).toBe('2025-12-01');
    expect(monthStart('2026-11-20')).toBe('2026-11-01');
  });
});

describe('manager report route and query', () => {
  it('is the last audited route, with the night-audit permission', () => {
    const last = V1_HTTP_ROUTE_AUDIT.at(-1);
    expect(last).toMatchObject({ id: 'get_manager_report', permission: 'night_audit:run', degradedRead: 'FAIL_CLOSED' });
  });

  it('accepts a real ISO date or none, nothing else', () => {
    expect(parseManagerReportDate(() => undefined)).toEqual({ ok: true });
    expect(parseManagerReportDate(() => '2026-11-20')).toEqual({ ok: true, date: '2026-11-20' });
    expect(parseManagerReportDate(() => '2026-02-30')).toEqual({ ok: false, detail: 'invalid_date' });
    expect(parseManagerReportDate(() => 'yesterday')).toEqual({ ok: false, detail: 'invalid_date' });
  });
});
