import {
  parseReportParams,
  type ReportColumn,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import { reservationStatusWord } from '@hospai/ui-kit';

/** Cache key for one report run: tenant, report and the exact parameters. */
export function reportQueryKey(
  propertyId: string,
  reportId: string,
  params: ReportParams,
): readonly ['report', string, string, ReportParams] {
  return ['report', propertyId, reportId, params] as const;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Form defaults from the definition: the business date, and the default span for a range. */
export function defaultReportParams(def: ReportDefinition, today: string): ReportParams {
  if (def.params.kind === 'date') return { date: today };
  const params: ReportParams = { from: today, to: addDaysIso(today, def.params.defaultSpan - 1) };
  for (const f of def.params.filters ?? []) (params as Record<string, string>)[f.name] = '';
  return params;
}

export type ReportParamsCheck =
  | { ok: true; params: ReportParams }
  | { ok: false; message: string };

/** Validates the form against the definition's limits, with words for each failure. */
export function checkReportParams(def: ReportDefinition, draft: ReportParams): ReportParamsCheck {
  const parsed = parseReportParams(def, (n) => (draft as Record<string, string | undefined>)[n]);
  if (parsed.ok) {
    if (def.params.kind === 'date' && parsed.params.date === undefined) {
      return { ok: false, message: 'Choose a date.' };
    }
    if (def.params.kind === 'range' && (parsed.params.from === undefined || parsed.params.to === undefined)) {
      return { ok: false, message: 'Choose both dates.' };
    }
    return { ok: true, params: parsed.params };
  }
  if (parsed.error === 'limit_exceeded') {
    const unit = def.params.kind === 'range' ? def.params.unit : 'days';
    return { ok: false, message: `This report covers at most ${parsed.max} ${unit}. Choose a shorter range.` };
  }
  switch (parsed.detail) {
    case 'invalid_date_range':
      return { ok: false, message: 'The end date must be on or after the start date.' };
    case 'range_incomplete':
      return { ok: false, message: 'Choose both dates.' };
    default:
      return { ok: false, message: 'Enter valid dates.' };
  }
}

export type CellFormat = {
  money: (minor: number, currency?: string) => string;
  date: (iso: string) => string;
  /** Resolved name, or a word for pending/erased/unavailable. */
  guest: (guestRef: string) => string;
};

/** The words shown on screen and in print for one cell. */
export function formatReportCell(
  column: ReportColumn,
  row: ReportRow,
  currency: string,
  f: CellFormat,
): string {
  const v = row[column.key];
  if (v === null || v === undefined || v === '') return '';
  switch (column.type) {
    case 'money':
      return f.money(Number(v), currency);
    case 'date':
      return f.date(String(v));
    case 'percent':
      return `${v}%`;
    case 'guest':
      return f.guest(String(v));
    case 'status':
      return reservationStatusWord(String(v));
    case 'integer':
    case 'text':
      return String(v);
  }
}

export const REPORT_TOTAL_LABEL = 'Total';

/** Currency minor-unit digits (2 for USD, 0 for JPY, 3 for KWD). */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Integer minor units to a plain decimal string in major units (no symbol, no grouping). */
export function minorToDecimal(minor: number, digits: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  if (digits === 0) return `${sign}${abs}`;
  const base = 10 ** digits;
  const whole = Math.floor(abs / base);
  const frac = String(abs % base).padStart(digits, '0');
  return `${sign}${whole}.${frac}`;
}

/** RFC 4180 field: quote when it holds a comma, quote, CR or LF, doubling inner quotes. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Text that a spreadsheet would run as a formula gets a leading apostrophe. */
function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * CSV from the rows on screen: resolved names, money as decimal major units with a trailing
 * currency code column, dates as ISO, CRLF line ends.
 */
export function buildReportCsv(input: {
  columns: ReadonlyArray<ReportColumn>;
  rows: ReadonlyArray<ReportRow>;
  totals: ReportRow | null;
  currency: string;
  guest: (guestRef: string) => string;
}): string {
  const { columns, rows, totals, currency, guest } = input;
  const hasMoney = columns.some((c) => c.type === 'money');
  const digits = currencyFractionDigits(currency);
  const line = (row: ReportRow, isTotals: boolean): string => {
    const cells = columns.map((c, i) => {
      const v = row[c.key];
      if (isTotals && i === 0 && (v === null || v === undefined)) return csvField(REPORT_TOTAL_LABEL);
      if (v === null || v === undefined) return '';
      switch (c.type) {
        case 'money':
          return minorToDecimal(Number(v), digits);
        case 'integer':
        case 'percent':
          return String(v);
        case 'date':
          return csvField(String(v));
        case 'guest':
          return csvField(guardFormula(guest(String(v))));
        case 'status':
          return csvField(reservationStatusWord(String(v)));
        case 'text':
          return csvField(guardFormula(String(v)));
      }
    });
    if (hasMoney) cells.push(csvField(currency));
    return cells.join(',');
  };
  const header = columns.map((c) => csvField(c.label));
  if (hasMoney) header.push('Currency');
  const lines = [header.join(','), ...rows.map((r) => line(r, false))];
  if (totals) lines.push(line(totals, true));
  return `${lines.join('\r\n')}\r\n`;
}

export function reportCsvFileName(def: ReportDefinition, params: ReportParams): string {
  const span = params.date ?? (params.from && params.to ? `${params.from}_${params.to}` : '');
  return `${def.id}${span ? `_${span}` : ''}.csv`;
}

/** The parameters in words, for the printed card. */
export function describeReportParams(
  def: ReportDefinition,
  params: ReportParams,
  formatDate: (iso: string) => string,
): string {
  const parts: string[] = [];
  if (params.date) parts.push(formatDate(params.date));
  if (params.from && params.to) {
    parts.push(params.from === params.to ? formatDate(params.from) : `${formatDate(params.from)} to ${formatDate(params.to)}`);
  }
  if (def.params.kind === 'range') {
    for (const f of def.params.filters ?? []) {
      const v = (params as Record<string, string | undefined>)[f.name];
      const label = f.options.find((o) => o.value === (v ?? ''))?.label;
      if (v && label) parts.push(`${f.label}: ${label}`);
    }
  }
  return parts.join(' · ');
}

/** Guest refs in a result, in first-seen order. */
export function guestRefsOf(result: ReportResponse | undefined): string[] {
  if (!result) return [];
  const keys = result.columns.filter((c) => c.type === 'guest').map((c) => c.key);
  const seen = new Set<string>();
  for (const row of result.rows) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'string' && v) seen.add(v);
    }
  }
  return [...seen];
}
