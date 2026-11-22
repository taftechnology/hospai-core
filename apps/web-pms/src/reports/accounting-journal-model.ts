import {
  ACCOUNTING_FIXED_ACCOUNT_KEYS,
  ACCOUNTING_JOURNAL_MAX_DAYS,
  accountingRangeDays,
  type AccountingJournalDay,
  type AccountingJournalResponse,
  type AccountingLedgerMap,
} from '@hospai/contracts';
import { csvField, currencyFractionDigits, guardFormula, minorToDecimal } from './report-model.js';

/** Cache key for one journal range: tenant, then the dates asked. */
export function accountingJournalQueryKey(
  propertyId: string,
  from: string,
  to: string,
): readonly ['accounting-journal', string, string, string] {
  return ['accounting-journal', propertyId, from, to] as const;
}

/** Prefix of every journal key of a property: a save in Settings invalidates all of them. */
export function accountingJournalKeyPrefix(propertyId: string): readonly ['accounting-journal', string] {
  return ['accounting-journal', propertyId] as const;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a range cannot be asked for, in words; null when it can. */
export function accountingRangeProblem(from: string, to: string): string | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return 'Choose both dates.';
  if (from > to) return 'The first date must not be after the last date.';
  if (accountingRangeDays(from, to) > ACCOUNTING_JOURNAL_MAX_DAYS) {
    return `Choose at most ${ACCOUNTING_JOURNAL_MAX_DAYS} days.`;
  }
  return null;
}

/** Days with a stored journal: the ones a file can carry. */
export function recordedDays(result: AccountingJournalResponse): AccountingJournalDay[] {
  return result.days.filter((d) => d.status !== 'not_recorded');
}

export function unbalancedDays(result: AccountingJournalResponse): AccountingJournalDay[] {
  return result.days.filter((d) => d.status === 'unbalanced');
}

export function missingDays(result: AccountingJournalResponse): AccountingJournalDay[] {
  return result.days.filter((d) => d.status === 'not_recorded');
}

export const ACCOUNTING_CSV_HEADER = ['Date', 'Account key', 'Ledger', 'Group', 'Debit', 'Credit'] as const;

/**
 * One CSV for the range, in the same terms as the screen: one row per account key per recorded day,
 * amounts in major units with the currency's decimals, dates as `YYYY-MM-DD`, RFC 4180 fields and
 * CRLF line ends. Names the hotel typed are guarded against spreadsheet formulas.
 */
export function buildAccountingJournalCsv(result: AccountingJournalResponse): string {
  const digits = currencyFractionDigits(result.currency);
  const lines = [ACCOUNTING_CSV_HEADER.map(csvField).join(',')];
  for (const day of recordedDays(result)) {
    for (const l of day.lines) {
      lines.push(
        [
          csvField(day.businessDate),
          csvField(guardFormula(l.accountKey)),
          csvField(guardFormula(l.ledgerName)),
          csvField(guardFormula(l.ledgerGroup)),
          minorToDecimal(l.debitMinor, digits),
          minorToDecimal(l.creditMinor, digits),
        ].join(','),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function accountingJournalCsvFileName(from: string, to: string): string {
  return from === to ? `accounting_journal_${from}.csv` : `accounting_journal_${from}_${to}.csv`;
}

/**
 * The keys Settings → Accounting lists: the fixed ones, every key seen in the recent journals, and
 * any key already mapped (so a mapping is never hidden), in that order, each once.
 */
export function settingsAccountKeys(
  seen: ReadonlyArray<string>,
  map: AccountingLedgerMap,
): string[] {
  const out: string[] = [];
  const add = (key: string) => {
    if (!out.includes(key)) out.push(key);
  };
  for (const key of ACCOUNTING_FIXED_ACCOUNT_KEYS) add(key);
  for (const key of [...seen].sort()) add(key);
  for (const e of map.ledgers) add(e.accountKey);
  return out;
}

/** Every distinct account key in a journal answer. */
export function journalAccountKeys(result: AccountingJournalResponse | undefined): string[] {
  if (!result) return [];
  const keys = new Set<string>();
  for (const day of result.days) for (const l of day.lines) keys.add(l.accountKey);
  return [...keys];
}
