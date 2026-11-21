import { describe, expect, it } from 'vitest';
import type { ManagerReportResponse, ManagerReportRow } from '@hospai/contracts';
import {
  buildManagerReportCsv,
  formatManagerValue,
  managerReportCsvFileName,
  managerReportQueryKey,
  managerSections,
  notRecordedNotes,
  nothingRecorded,
} from './manager-report-model.js';

const f = {
  money: (m: number) => `$${(m / 100).toFixed(2)}`,
  ratioMoney: (m: number, d: number) => `$${(m / 100).toFixed(d)}`,
};

const row = (patch: Partial<ManagerReportRow> & { rowId: string }): ManagerReportRow => ({
  label: patch.rowId,
  section: 'rooms',
  kind: 'count',
  scale: 0,
  decimals: null,
  values: { day: 1, mtd: 2, ytd: 3 },
  ...patch,
});

const result = (rows: ManagerReportRow[]): ManagerReportResponse => ({
  ok: true,
  generatedAt: '2026-11-20T09:00:00.000Z',
  businessDate: '2026-11-20',
  currency: 'USD',
  date: '2026-11-19',
  fiscalYearStart: '2026-04-01',
  columns: [
    { id: 'day', from: '2026-11-19', to: '2026-11-19', recordedDays: 1, notRecorded: [] },
    { id: 'mtd', from: '2026-11-01', to: '2026-11-19', recordedDays: 1, notRecorded: ['2026-11-18'] },
    { id: 'ytd', from: '2026-04-01', to: '2026-11-19', recordedDays: 1, notRecorded: ['2026-11-18', '2026-11-17'] },
  ],
  rows,
});

describe('manager report model', () => {
  it('keys the cache by tenant and date', () => {
    expect(managerReportQueryKey('prop_1', '2026-11-19')).toEqual(['manager-report', 'prop_1', '2026-11-19']);
  });

  it('formats counts, percentages by scale, money and ratio money, with a dash for nothing', () => {
    expect(formatManagerValue(row({ rowId: 'a' }), 7, f)).toBe('7');
    expect(formatManagerValue(row({ rowId: 'a' }), null, f)).toBe('—');
    expect(formatManagerValue(row({ rowId: 'o', kind: 'percent', scale: 1 }), 750, f)).toBe('75.0%');
    expect(formatManagerValue(row({ rowId: 'o', kind: 'percent', scale: 0 }), 67, f)).toBe('67%');
    expect(formatManagerValue(row({ rowId: 'm', kind: 'money' }), 12345, f)).toBe('$123.45');
    expect(formatManagerValue(row({ rowId: 'adr', kind: 'money', decimals: 0 }), 3300, f)).toBe('$33');
  });

  it('groups rows by section in report order and drops empty sections', () => {
    const sections = managerSections([
      row({ rowId: 'x', section: 'revenue', kind: 'money' }),
      row({ rowId: 'y', section: 'rooms' }),
      row({ rowId: 'z', section: 'revenue', kind: 'money' }),
    ]);
    expect(sections.map((s) => [s.title, s.rows.map((r) => r.rowId)])).toEqual([
      ['Rooms', ['y']],
      ['Revenue', ['x', 'z']],
    ]);
  });

  it('lists not-recorded dates per column, and knows when nothing is recorded', () => {
    const r = result([]);
    expect(notRecordedNotes(r)).toEqual([
      { id: 'mtd', dates: ['2026-11-18'] },
      { id: 'ytd', dates: ['2026-11-18', '2026-11-17'] },
    ]);
    expect(nothingRecorded(r)).toBe(false);
    expect(nothingRecorded({ ...r, columns: r.columns.map((c) => ({ ...c, recordedDays: 0 })) })).toBe(true);
  });

  it('builds a CSV with decimals applied, a currency on money rows only and a guarded label', () => {
    const csv = buildManagerReportCsv(
      result([
        row({ rowId: 'sold', label: 'Rooms sold', values: { day: 3, mtd: 6, ytd: 9 } }),
        row({ rowId: 'occ', label: 'Occupancy %', kind: 'percent', scale: 1, values: { day: 750, mtd: 667, ytd: null } }),
        row({ rowId: 'adr', label: 'ADR', section: 'revenue', kind: 'money', decimals: 0, values: { day: 3300, mtd: 3400, ytd: null } }),
        row({ rowId: 'rev', label: '=SUM(A1)', section: 'revenue', kind: 'money', values: { day: 30000, mtd: 1, ytd: -5 } }),
      ]),
    );
    expect(csv.split('\r\n')).toEqual([
      'Section,Row,Day (2026-11-19),Month to date (2026-11-01 to 2026-11-19),Year to date (2026-04-01 to 2026-11-19),Currency',
      'Rooms,Rooms sold,3,6,9,',
      'Rooms,Occupancy %,75.0,66.7,,',
      'Revenue,ADR,33,34,,USD',
      "Revenue,'=SUM(A1),300.00,0.01,-0.05,USD",
      '',
    ]);
    expect(managerReportCsvFileName('2026-11-19')).toBe('manager_report_2026-11-19.csv');
  });
});
