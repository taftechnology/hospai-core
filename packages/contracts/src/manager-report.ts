import { z } from 'zod';

/**
 * Manager Report and MIS settings (R4.32). The report is a closed-period read over the
 * `night_audit_day_stats` rows the SNAPSHOT_REPORTS step writes; nothing here is a new money
 * calculation. This file holds the locked row registry (the "formula library"), the config schema
 * for `pms.reports.manager_report`, and the response shape shared by pms-core and the SPA.
 * Spec: docs/superpowers/specs/2026-11-20-manager-report-design.md
 */

export const MANAGER_REPORT_KEY = 'pms.reports.manager_report' as const;

export const MANAGER_REPORT_SECTIONS = [
  'rooms',
  'movements',
  'guests',
  'revenue',
  'payments',
  'source_mix',
] as const;
export type ManagerReportSection = (typeof MANAGER_REPORT_SECTIONS)[number];

export const MANAGER_REPORT_SECTION_LABELS: Record<ManagerReportSection, string> = {
  rooms: 'Rooms',
  movements: 'Movements',
  guests: 'Guests',
  revenue: 'Revenue',
  payments: 'Payments',
  source_mix: 'Source mix',
};

/** `count` is an integer, `money` integer minor units in ledger currency, `percent` a scaled percentage. */
export type ManagerRowKind = 'count' | 'money' | 'percent';

export type ManagerRowDef = {
  rowId: string;
  section: ManagerReportSection;
  kind: ManagerRowKind;
  label: string;
  /** A ratio (occupancy %, ADR, RevPAR): the manager sets its decimals. Other rows ignore decimals. */
  ratio: boolean;
  defaultDecimals: 0 | 1 | 2;
  /** Source-mix rows repeat once per source bucket. */
  perBucket?: 'nights' | 'revenue';
};

/** The locked built-in rows, in default order. A manager selects, relabels and reorders; nothing is added. */
export const MANAGER_REPORT_ROWS: ReadonlyArray<ManagerRowDef> = [
  { rowId: 'rooms_in_hotel', section: 'rooms', kind: 'count', label: 'Rooms in hotel', ratio: false, defaultDecimals: 0 },
  { rowId: 'rooms_out_of_order', section: 'rooms', kind: 'count', label: 'Out of order', ratio: false, defaultDecimals: 0 },
  { rowId: 'rooms_available', section: 'rooms', kind: 'count', label: 'Rooms available', ratio: false, defaultDecimals: 0 },
  { rowId: 'rooms_sold', section: 'rooms', kind: 'count', label: 'Rooms sold', ratio: false, defaultDecimals: 0 },
  { rowId: 'occupancy_pct', section: 'rooms', kind: 'percent', label: 'Occupancy %', ratio: true, defaultDecimals: 0 },
  { rowId: 'arrivals', section: 'movements', kind: 'count', label: 'Arrivals', ratio: false, defaultDecimals: 0 },
  { rowId: 'departures', section: 'movements', kind: 'count', label: 'Departures', ratio: false, defaultDecimals: 0 },
  { rowId: 'no_shows', section: 'movements', kind: 'count', label: 'No-shows', ratio: false, defaultDecimals: 0 },
  { rowId: 'cancellations', section: 'movements', kind: 'count', label: 'Cancellations', ratio: false, defaultDecimals: 0 },
  { rowId: 'in_house_adults', section: 'guests', kind: 'count', label: 'In-house adults', ratio: false, defaultDecimals: 0 },
  { rowId: 'in_house_children', section: 'guests', kind: 'count', label: 'In-house children', ratio: false, defaultDecimals: 0 },
  { rowId: 'room_revenue', section: 'revenue', kind: 'money', label: 'Room revenue', ratio: false, defaultDecimals: 0 },
  { rowId: 'adr', section: 'revenue', kind: 'money', label: 'ADR', ratio: true, defaultDecimals: 2 },
  { rowId: 'revpar', section: 'revenue', kind: 'money', label: 'RevPAR', ratio: true, defaultDecimals: 2 },
  { rowId: 'fnb_revenue', section: 'revenue', kind: 'money', label: 'F&B revenue', ratio: false, defaultDecimals: 0 },
  { rowId: 'other_revenue', section: 'revenue', kind: 'money', label: 'Other revenue', ratio: false, defaultDecimals: 0 },
  { rowId: 'total_revenue', section: 'revenue', kind: 'money', label: 'Total revenue', ratio: false, defaultDecimals: 0 },
  { rowId: 'tax', section: 'revenue', kind: 'money', label: 'Tax', ratio: false, defaultDecimals: 0 },
  { rowId: 'payments_card', section: 'payments', kind: 'money', label: 'Card', ratio: false, defaultDecimals: 0 },
  { rowId: 'payments_cash', section: 'payments', kind: 'money', label: 'Cash', ratio: false, defaultDecimals: 0 },
  { rowId: 'payments_upi', section: 'payments', kind: 'money', label: 'UPI', ratio: false, defaultDecimals: 0 },
  { rowId: 'payments_total', section: 'payments', kind: 'money', label: 'Total payments', ratio: false, defaultDecimals: 0 },
  { rowId: 'source_nights', section: 'source_mix', kind: 'count', label: 'room nights', ratio: false, defaultDecimals: 0, perBucket: 'nights' },
  { rowId: 'source_revenue', section: 'source_mix', kind: 'money', label: 'room revenue', ratio: false, defaultDecimals: 0, perBucket: 'revenue' },
];

export const MANAGER_REPORT_ROW_IDS: readonly string[] = MANAGER_REPORT_ROWS.map((r) => r.rowId);

export function managerRowDef(rowId: string): ManagerRowDef | undefined {
  return MANAGER_REPORT_ROWS.find((r) => r.rowId === rowId);
}

export const MANAGER_REPORT_LABEL_MAX = 40;
export const MANAGER_REPORT_MAX_BUCKETS = 12;
export const MANAGER_REPORT_MAX_SOURCE_CODES = 50;
export const MANAGER_REPORT_MAX_FNB_CODES = 20;
/** The bucket every unmapped source code falls into. */
export const MANAGER_REPORT_OTHER_BUCKET = 'Other';

const SOURCE_CODE = /^[A-Z0-9_]{1,32}$/;
const CHARGE_CODE = /^[A-Z0-9_]{1,32}$/;

const ManagerReportRowSchema = z
  .object({
    rowId: z.enum(MANAGER_REPORT_ROWS.map((r) => r.rowId) as [string, ...string[]]),
    enabled: z.boolean(),
    label: z.string().trim().min(1).max(MANAGER_REPORT_LABEL_MAX),
    decimals: z.number().int().min(0).max(2),
  })
  .strict();
export type ManagerReportRowConfig = z.infer<typeof ManagerReportRowSchema>;

export const ManagerReportConfigSchema = z
  .object({
    occupancy: z
      .object({
        excludeOutOfOrder: z.boolean(),
        countNoShowAsSold: z.boolean(),
      })
      .strict(),
    rows: z
      .array(ManagerReportRowSchema)
      .length(MANAGER_REPORT_ROWS.length)
      .refine((rows) => new Set(rows.map((r) => r.rowId)).size === rows.length, {
        message: 'duplicate_row',
      }),
    sourceBuckets: z
      .record(z.string().regex(SOURCE_CODE), z.string().trim().min(1).max(MANAGER_REPORT_LABEL_MAX))
      .refine((m) => new Set(Object.values(m)).size <= MANAGER_REPORT_MAX_BUCKETS, {
        message: 'too_many_buckets',
      })
      .refine((m) => Object.keys(m).length <= MANAGER_REPORT_MAX_SOURCE_CODES, {
        message: 'too_many_source_codes',
      }),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    /**
     * Charge codes whose posted charges count as F&B revenue. HospAI has no F&B classification of
     * its own until the POS connector (R4.21); the manager names the codes here. Read when the day
     * closes, so a change applies from the next closed day.
     */
    fnbChargeCodes: z
      .array(z.string().regex(CHARGE_CODE))
      .max(MANAGER_REPORT_MAX_FNB_CODES)
      .refine((c) => new Set(c).size === c.length, { message: 'duplicate_code' })
      .refine((c) => !c.includes('ROOM') && !c.includes('PAYMENT'), { message: 'reserved_code' }),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const have = new Set(cfg.rows.map((r) => r.rowId));
    for (const def of MANAGER_REPORT_ROWS) {
      if (!have.has(def.rowId)) ctx.addIssue({ code: 'custom', message: `missing_row:${def.rowId}` });
    }
  });
export type ManagerReportConfig = z.infer<typeof ManagerReportConfigSchema>;

export const MANAGER_REPORT_DEFAULT_FISCAL_START_MONTH = 4;

export const MANAGER_REPORT_CONFIG_DEFAULT: ManagerReportConfig = {
  occupancy: { excludeOutOfOrder: true, countNoShowAsSold: false },
  rows: MANAGER_REPORT_ROWS.map((r) => ({
    rowId: r.rowId,
    enabled: true,
    label: r.label,
    decimals: r.defaultDecimals,
  })),
  sourceBuckets: {},
  fiscalYearStartMonth: MANAGER_REPORT_DEFAULT_FISCAL_START_MONTH,
  fnbChargeCodes: [],
};

/** A stored value read back through the schema; anything that does not parse reads as the default. */
export function readManagerReportConfig(stored: unknown): ManagerReportConfig {
  const parsed = ManagerReportConfigSchema.safeParse(stored);
  return parsed.success ? parsed.data : MANAGER_REPORT_CONFIG_DEFAULT;
}

/** First day of the fiscal year that contains `date`. */
export function fiscalYearStart(date: string, startMonth: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${String(startYear).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`;
}

/** First day of the month that contains `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Source-mix map as stored per closed day: `{ sourceCode: [roomNights, roomRevenueMinor] }`. */
export type SourceMix = Record<string, [number, number]>;
/** A stay with no booking source. */
export const SOURCE_MIX_NONE = '-';
/** Source codes beyond the cap, folded together. */
export const SOURCE_MIX_REST = '*';

export const MANAGER_REPORT_COLUMN_IDS = ['day', 'mtd', 'ytd'] as const;
export type ManagerReportColumnId = (typeof MANAGER_REPORT_COLUMN_IDS)[number];

export type ManagerReportColumn = {
  id: ManagerReportColumnId;
  from: string;
  to: string;
  /** Days in range with a recorded statistics row. */
  recordedDays: number;
  /** Closed-audit dates in range that have no statistics row (closed before the rows existed, or failed). */
  notRecorded: string[];
};

export type ManagerReportValues = Record<ManagerReportColumnId, number | null>;

export type ManagerReportRow = {
  rowId: string;
  label: string;
  section: ManagerReportSection;
  kind: ManagerRowKind;
  /** Percent rows: the value is the percentage times 10^scale. Otherwise 0. */
  scale: number;
  /** The configured decimals of a ratio row (occupancy %, ADR, RevPAR); null for every other row. */
  decimals: number | null;
  values: ManagerReportValues;
};

export type ManagerReportResponse = {
  ok: true;
  generatedAt: string;
  businessDate: string;
  currency: string;
  date: string;
  fiscalYearStart: string;
  columns: ManagerReportColumn[];
  rows: ManagerReportRow[];
};

export type ManagerReportParams = { date?: string };

/** The one place the SPA and server agree on the query. */
export function parseManagerReportDate(
  get: (name: string) => string | null | undefined,
): { ok: true; date?: string } | { ok: false; detail: 'invalid_date' } {
  const raw = get('date');
  if (raw == null || raw === '') return { ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, detail: 'invalid_date' };
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    return { ok: false, detail: 'invalid_date' };
  }
  return { ok: true, date: raw };
}

/** The catalogue entry (Night audit group) for the report, which runs on its own screen. */
export const MANAGER_REPORT_CATALOG_ENTRY = {
  id: 'manager_report',
  title: 'Manager Report',
  description:
    'One closed day with month to date and fiscal year to date: rooms, occupancy, movements, revenue, payments and source mix.',
  path: '/reports/manager',
} as const;
