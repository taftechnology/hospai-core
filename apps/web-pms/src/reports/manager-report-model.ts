import {
  MANAGER_REPORT_SECTIONS,
  MANAGER_REPORT_SECTION_LABELS,
  type ManagerReportColumn,
  type ManagerReportColumnId,
  type ManagerReportResponse,
  type ManagerReportRow,
  type ManagerReportSection,
} from '@hospai/contracts';
import { csvField, currencyFractionDigits, minorToDecimal } from './report-model.js';

/** Cache key for one Manager Report run: tenant and the date asked. */
export function managerReportQueryKey(
  propertyId: string,
  date: string,
): readonly ['manager-report', string, string] {
  return ['manager-report', propertyId, date] as const;
}

export const MANAGER_COLUMN_IDS: readonly ManagerReportColumnId[] = ['day', 'mtd', 'ytd'];

/** What an undefined statistic or a column with nothing recorded shows. */
export const MANAGER_EMPTY = '—';

export const MANAGER_COLUMN_WORDS: Record<ManagerReportColumnId, string> = {
  day: 'Day',
  mtd: 'Month to date',
  ytd: 'Year to date',
};

export type ManagerCellFormat = {
  /** Whole money in minor units, with the currency symbol (2 digits). */
  money: (minor: number) => string;
  /** Ratio money with its configured decimals (ADR, RevPAR). */
  ratioMoney: (minor: number, decimals: number) => string;
};

/** One value in the words shown on screen and in print. */
export function formatManagerValue(row: ManagerReportRow, value: number | null, f: ManagerCellFormat): string {
  if (value === null) return MANAGER_EMPTY;
  if (row.kind === 'percent') return `${minorToDecimal(value, row.scale)}%`;
  if (row.kind === 'money') return row.decimals === null ? f.money(value) : f.ratioMoney(value, row.decimals);
  return String(value);
}

/** Rows grouped by section in the report's own order; a section with no enabled row is left out. */
export function managerSections(
  rows: ReadonlyArray<ManagerReportRow>,
): Array<{ section: ManagerReportSection; title: string; rows: ManagerReportRow[] }> {
  return MANAGER_REPORT_SECTIONS.map((section) => ({
    section,
    title: MANAGER_REPORT_SECTION_LABELS[section],
    rows: rows.filter((r) => r.section === section),
  })).filter((s) => s.rows.length > 0);
}

export function managerColumn(result: ManagerReportResponse, id: ManagerReportColumnId): ManagerReportColumn {
  return result.columns.find((c) => c.id === id)!;
}

/** True when none of the three columns has a recorded day. */
export function nothingRecorded(result: ManagerReportResponse): boolean {
  return result.columns.every((c) => c.recordedDays === 0);
}

/** Dates listed as not recorded, per column, only where there are any. */
export function notRecordedNotes(result: ManagerReportResponse): Array<{ id: ManagerReportColumnId; dates: string[] }> {
  return result.columns
    .filter((c) => c.notRecorded.length > 0)
    .map((c) => ({ id: c.id, dates: c.notRecorded }));
}

function csvValue(row: ManagerReportRow, value: number | null, digits: number): string {
  if (value === null) return '';
  if (row.kind === 'percent') return minorToDecimal(value, row.scale);
  if (row.kind === 'money') {
    const full = minorToDecimal(value, digits);
    if (row.decimals === null || row.decimals >= digits) return full;
    // A ratio is a multiple of its step, so the dropped digits are zeros.
    const drop = digits - row.decimals;
    return row.decimals === 0 ? full.slice(0, full.length - drop - 1) : full.slice(0, full.length - drop);
  }
  return String(value);
}

/** CSV of the report as shown: section, row, then one column per Day / MTD / YTD, CRLF line ends. */
export function buildManagerReportCsv(result: ManagerReportResponse): string {
  const digits = currencyFractionDigits(result.currency);
  const header = [
    'Section',
    'Row',
    ...MANAGER_COLUMN_IDS.map((id) => {
      const c = managerColumn(result, id);
      return `${MANAGER_COLUMN_WORDS[id]} (${c.from === c.to ? c.to : `${c.from} to ${c.to}`})`;
    }),
    'Currency',
  ];
  const lines = [header.map(csvField).join(',')];
  for (const s of managerSections(result.rows)) {
    for (const row of s.rows) {
      lines.push(
        [
          csvField(s.title),
          csvField(/^[=+\-@\t\r]/.test(row.label) ? `'${row.label}` : row.label),
          ...MANAGER_COLUMN_IDS.map((id) => csvValue(row, row.values[id], digits)),
          row.kind === 'money' ? csvField(result.currency) : '',
        ].join(','),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function managerReportCsvFileName(date: string): string {
  return `manager_report_${date}.csv`;
}
