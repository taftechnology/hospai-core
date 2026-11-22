import { z } from 'zod';

/**
 * Accounting export, Part A: the daily journal (R4.12). The journal is a closed-day snapshot the
 * SNAPSHOT_REPORTS step writes next to `night_audit_day_stats`; the export is a read of those rows.
 * This file holds the fixed account keys, the ledger-mapping config schema for
 * `accounting.ledger_map`, the query parser and the response shape shared by pms-core and the SPA.
 * Spec: docs/superpowers/specs/2026-11-22-accounting-export-a-journal-design.md
 */

export const ACCOUNTING_LEDGER_MAP_KEY = 'accounting.ledger_map' as const;

/** The longest date range one export call returns. */
export const ACCOUNTING_JOURNAL_MAX_DAYS = 31;
export const ACCOUNTING_LEDGER_MAP_MAX_ENTRIES = 300;
export const ACCOUNTING_LEDGER_NAME_MAX = 100;
export const ACCOUNT_KEY_MAX = 64;

/** `REVENUE:ROOM`, `TAX:CGST`, `GUEST_LEDGER`: upper-case words, one optional `:CODE` part. */
export const ACCOUNT_KEY_PATTERN = /^[A-Z_]+(:[A-Z0-9_]+)?$/;

export const ACCOUNT_GUEST_LEDGER = 'GUEST_LEDGER' as const;
export const ACCOUNT_ADVANCE_DEPOSITS = 'ADVANCE_DEPOSITS' as const;
export const ACCOUNT_CITY_LEDGER = 'CITY_LEDGER' as const;
export const ACCOUNT_CITY_LEDGER_RECEIPTS = 'CITY_LEDGER_RECEIPTS' as const;
export const ACCOUNT_REVENUE_PREFIX = 'REVENUE:' as const;
export const ACCOUNT_TAX_PREFIX = 'TAX:' as const;
export const ACCOUNT_TENDER_PREFIX = 'TENDER:' as const;

/** The keys every hotel maps, whether or not a day used them yet. Revenue and tax keys come from the folio. */
export const ACCOUNTING_FIXED_ACCOUNT_KEYS: readonly string[] = [
  'TENDER:CASH',
  'TENDER:CARD',
  'TENDER:UPI',
  ACCOUNT_GUEST_LEDGER,
  ACCOUNT_ADVANCE_DEPOSITS,
  ACCOUNT_CITY_LEDGER,
  ACCOUNT_CITY_LEDGER_RECEIPTS,
];

/** A charge code or tender value as the second half of an account key (`ROOM`, `CGST`, `UPI`). */
export function accountKeyPart(raw: string): string {
  const part = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return part === '' ? '_' : part;
}

const LedgerEntrySchema = z
  .object({
    accountKey: z.string().max(ACCOUNT_KEY_MAX).regex(ACCOUNT_KEY_PATTERN),
    ledgerName: z.string().trim().min(1).max(ACCOUNTING_LEDGER_NAME_MAX),
    ledgerGroup: z.string().trim().max(ACCOUNTING_LEDGER_NAME_MAX).optional(),
  })
  .strict();

export const AccountingLedgerMapSchema = z
  .object({
    ledgers: z
      .array(LedgerEntrySchema)
      .max(ACCOUNTING_LEDGER_MAP_MAX_ENTRIES)
      .refine((rows) => new Set(rows.map((r) => r.accountKey)).size === rows.length, {
        message: 'duplicate_account_key',
      }),
  })
  .strict();
export type AccountingLedgerMap = z.infer<typeof AccountingLedgerMapSchema>;

export const ACCOUNTING_LEDGER_MAP_DEFAULT: AccountingLedgerMap = { ledgers: [] };

/** A stored value read back through the schema; anything that does not parse reads as unmapped. */
export function readAccountingLedgerMap(stored: unknown): AccountingLedgerMap {
  const parsed = AccountingLedgerMapSchema.safeParse(stored);
  return parsed.success ? parsed.data : ACCOUNTING_LEDGER_MAP_DEFAULT;
}

export type AccountingDayStatus = 'ok' | 'unbalanced' | 'not_recorded';

export type AccountingJournalLine = {
  accountKey: string;
  /** The hotel's ledger name for the key; empty when the key is not mapped. */
  ledgerName: string;
  /** The hotel's ledger group for the key; empty when none. */
  ledgerGroup: string;
  debitMinor: number;
  creditMinor: number;
};

export type AccountingJournalDay = {
  businessDate: string;
  status: AccountingDayStatus;
  lines: AccountingJournalLine[];
  debitTotalMinor: number;
  creditTotalMinor: number;
};

export type AccountingJournalResponse = {
  ok: true;
  currency: string;
  days: AccountingJournalDay[];
  /** Account keys that appear in the returned days and have no ledger name, sorted. */
  unmappedKeys: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(raw: string): boolean {
  if (!ISO_DATE.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

/** Days from `from` to `to`, both included. */
export function accountingRangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export type AccountingJournalQuery =
  | { ok: true; from?: string; to?: string }
  | { ok: false; kind: 'invalid_query'; detail: 'invalid_date' | 'invalid_range' }
  | { ok: false; kind: 'limit_exceeded'; limit: 'days'; max: typeof ACCOUNTING_JOURNAL_MAX_DAYS };

/**
 * The one place the SPA and server agree on the query. One bound alone is a single day; neither is
 * the last closed date (the server fills it in). More than 31 days is `limit_exceeded`.
 */
export function parseAccountingJournalQuery(
  get: (name: string) => string | null | undefined,
): AccountingJournalQuery {
  const rawFrom = get('from') || undefined;
  const rawTo = get('to') || undefined;
  for (const raw of [rawFrom, rawTo]) {
    if (raw !== undefined && !validDate(raw)) return { ok: false, kind: 'invalid_query', detail: 'invalid_date' };
  }
  const from = rawFrom ?? rawTo;
  const to = rawTo ?? rawFrom;
  if (from === undefined || to === undefined) return { ok: true };
  if (from > to) return { ok: false, kind: 'invalid_query', detail: 'invalid_range' };
  if (accountingRangeDays(from, to) > ACCOUNTING_JOURNAL_MAX_DAYS) {
    return { ok: false, kind: 'limit_exceeded', limit: 'days', max: ACCOUNTING_JOURNAL_MAX_DAYS };
  }
  return { ok: true, from, to };
}
