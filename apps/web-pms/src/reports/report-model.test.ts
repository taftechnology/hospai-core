import { describe, expect, it } from 'vitest';
import { reportDefinition, type ReportColumn } from '@hospai/contracts';
import {
  buildReportCsv,
  checkReportParams,
  csvField,
  defaultReportParams,
  describeReportParams,
  guestRefsOf,
  minorToDecimal,
  reportCsvFileName,
  reportQueryKey,
} from './report-model.js';

const arrivals = reportDefinition('front_office_arrivals')!;
const forecast = reportDefinition('front_office_forecast')!;
const inHouse = reportDefinition('front_office_in_house')!;

describe('report query key', () => {
  it('carries the tenant, the report and the exact params', () => {
    expect(reportQueryKey('p1', 'front_office_arrivals', { from: '2026-11-20', to: '2026-11-21' })).toEqual([
      'report',
      'p1',
      'front_office_arrivals',
      { from: '2026-11-20', to: '2026-11-21' },
    ]);
  });
});

describe('form defaults and limits', () => {
  it('defaults to the business date, with the definition’s span', () => {
    expect(defaultReportParams(inHouse, '2026-11-20')).toEqual({ date: '2026-11-20' });
    expect(defaultReportParams(arrivals, '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-20', status: '' });
    expect(defaultReportParams(forecast, '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-12-03' });
  });

  it('says in words when the range is too long, reversed or incomplete', () => {
    expect(checkReportParams(arrivals, { from: '2026-11-01', to: '2026-12-02' })).toEqual({
      ok: false,
      message: 'This report covers at most 31 days. Choose a shorter range.',
    });
    expect(checkReportParams(forecast, { from: '2026-11-01', to: '2027-02-01' })).toEqual({
      ok: false,
      message: 'This report covers at most 90 nights. Choose a shorter range.',
    });
    expect(checkReportParams(arrivals, { from: '2026-11-05', to: '2026-11-01' })).toMatchObject({
      message: 'The end date must be on or after the start date.',
    });
    expect(checkReportParams(arrivals, { from: '2026-11-05', to: '' })).toMatchObject({ message: 'Choose both dates.' });
    expect(checkReportParams(inHouse, {})).toEqual({ ok: false, message: 'Choose a date.' });
    expect(checkReportParams(arrivals, { from: '2026-11-01', to: '2026-12-01', status: 'confirmed' })).toEqual({
      ok: true,
      params: { from: '2026-11-01', to: '2026-12-01', status: 'confirmed' },
    });
  });
});

describe('CSV', () => {
  const columns: ReportColumn[] = [
    { key: 'guest', label: 'Guest', type: 'guest' },
    { key: 'note', label: 'Note', type: 'text' },
    { key: 'arrival', label: 'Arrival', type: 'date' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'balance', label: 'Guest balance', type: 'money' },
    { key: 'occupancy', label: 'Occupancy %', type: 'percent' },
  ];
  const rows = [
    { guest: 'g1', note: 'He said "hi", twice', arrival: '2026-11-20', status: 'checked_in', balance: 123456, occupancy: 67 },
    { guest: 'g2', note: '=SUM(A1)', arrival: '2026-11-21', status: 'confirmed', balance: -5, occupancy: null },
    { guest: 'g3', note: 'line\nbreak', arrival: '2026-11-22', status: 'pending', balance: 0, occupancy: 0 },
  ];

  it('quotes per RFC 4180, writes money as decimals with a currency column, and totals last', () => {
    const csv = buildReportCsv({
      columns,
      rows,
      totals: { balance: 123451 },
      currency: 'USD',
      guest: (ref) => ({ g1: 'Asha, Rao', g2: 'Ravi Kumar', g3: 'Meera' })[ref] ?? ref,
    });
    expect(csv.split('\r\n')).toEqual([
      'Guest,Note,Arrival,Status,Guest balance,Occupancy %,Currency',
      '"Asha, Rao","He said ""hi"", twice",2026-11-20,In house,1234.56,67,USD',
      "Ravi Kumar,'=SUM(A1),2026-11-21,Confirmed,-0.05,,USD",
      'Meera,"line\nbreak",2026-11-22,Pending,0.00,0,USD',
      'Total,,,,1234.51,,USD',
      '',
    ]);
  });

  it('omits the currency column when no column is money, and honours zero-decimal currencies', () => {
    const csv = buildReportCsv({
      columns: columns.filter((c) => c.type !== 'money'),
      rows: [rows[0]!],
      totals: null,
      currency: 'JPY',
      guest: () => 'A',
    });
    expect(csv).toBe('Guest,Note,Arrival,Status,Occupancy %\r\nA,"He said ""hi"", twice",2026-11-20,In house,67\r\n');
    expect(minorToDecimal(1500, 0)).toBe('1500');
    expect(minorToDecimal(-1500, 3)).toBe('-1.500');
    expect(csvField('plain')).toBe('plain');
  });
});

describe('helpers', () => {
  it('lists guest refs once, in order, and names the file and parameters', () => {
    const refs = guestRefsOf({
      ok: true,
      reportId: 'x',
      generatedAt: '',
      businessDate: '',
      currency: 'USD',
      params: {},
      columns: [{ key: 'guest', label: 'Guest', type: 'guest' }],
      rows: [{ guest: 'b' }, { guest: 'a' }, { guest: 'b' }, { guest: null }],
      totals: null,
    });
    expect(refs).toEqual(['b', 'a']);
    expect(reportCsvFileName(arrivals, { from: '2026-11-20', to: '2026-11-22' })).toBe(
      'front_office_arrivals_2026-11-20_2026-11-22.csv',
    );
    expect(describeReportParams(arrivals, { from: '2026-11-20', to: '2026-11-22', status: 'confirmed' }, (d) => d)).toBe(
      '2026-11-20 to 2026-11-22 · Status: Confirmed',
    );
  });
});
