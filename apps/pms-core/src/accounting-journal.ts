import type { SqlStorageLike } from '@hospai/do-runtime';
import {
  ACCOUNT_ADVANCE_DEPOSITS,
  ACCOUNT_CITY_LEDGER,
  ACCOUNT_CITY_LEDGER_RECEIPTS,
  ACCOUNT_GUEST_LEDGER,
  ACCOUNT_REVENUE_PREFIX,
  ACCOUNT_TAX_PREFIX,
  ACCOUNT_TENDER_PREFIX,
  accountKeyPart,
  type AccountingDayStatus,
  type AccountingJournalDay,
  type AccountingJournalLine,
  type AccountingJournalResponse,
  type AccountingLedgerMap,
} from '@hospai/contracts';
import { loadLedger, loadPayments, movementColumn, tenderOfLine, type Ledger, type Line } from './cashier-report.js';

/**
 * Accounting journal, Part A (R4.12). One snapshot per closed business date, built at night-audit
 * close from the same folio ledger the cashier reports read (`loadLedger`, `movementColumn`), and
 * stored next to `night_audit_day_stats`. An export reads the stored rows only.
 * Spec: docs/superpowers/specs/2026-11-22-accounting-export-a-journal-design.md
 */

type Row = Record<string, unknown>;

const n = (v: unknown): number => Number(v ?? 0);

export type JournalRow = { accountKey: string; debitMinor: number; creditMinor: number };

/** The snapshot of one closed day, ready to store. */
export type JournalSnapshot = {
  businessDate: string;
  currency: string;
  /** Credit balance held as advances at close (positive). */
  advanceClosingMinor: number;
  balanced: boolean;
  lines: JournalRow[];
};

export type JournalInput = {
  sql: SqlStorageLike;
  businessDate: string;
  currency: string;
  dateOfInstant(ms: number): string;
  /** The sum of credit balances on GUEST windows of stays that are pending or confirmed at close. */
  advanceClosingMinor: number;
  /** The previous stored day's closing advances (0 when there is none). */
  previousAdvanceClosingMinor: number;
  /** Lets a caller that already loaded the ledger share it. */
  ledger?: Ledger;
};

/** City-ledger entries dated `date`: receivables (charge and adjustment) and settlements (payment). */
export function readCityLedgerDay(sql: SqlStorageLike, date: string): { receivables: number; settlements: number } {
  const rows = sql
    .exec(`SELECT kind, amount_minor FROM city_ledger_entry WHERE business_date = ?`, date)
    .toArray() as Row[];
  let receivables = 0;
  let settlements = 0;
  for (const r of rows) {
    if (r.kind === 'payment') settlements += n(r.amount_minor);
    else receivables += n(r.amount_minor);
  }
  return { receivables, settlements };
}

/**
 * The day's journal, net per HospAI account key. Signs below are "debit positive":
 *   revenue and tax lines credit their account; a payment line debits its tender; every folio line's
 *   counter-entry is the guest ledger, less the advance reclass and the receivables that left the
 *   folio for the city ledger. Transfer lines belong to no account (they net to zero); a day where
 *   they do not is stored `balanced = 0`.
 */
export function buildJournalSnapshot(input: JournalInput): JournalSnapshot {
  const ledger = input.ledger ?? loadLedger({ sql: input.sql, dateOfInstant: input.dateOfInstant });
  const payments = loadPayments({ sql: input.sql });
  const signed = new Map<string, number>();
  const add = (key: string, amount: number) => signed.set(key, (signed.get(key) ?? 0) + amount);

  const tenderOf = (line: Line): string => tenderOfLine(line, ledger.byId, payments) ?? 'OTHER';

  let guestLedger = 0;
  for (const l of ledger.lines) {
    if (l.date !== input.businessDate) continue;
    guestLedger += l.ledger;
    const column = movementColumn(l);
    if (column === 'charges' || column === 'adjustments') {
      add(`${ACCOUNT_REVENUE_PREFIX}${accountKeyPart(l.code)}`, -l.ledger);
    } else if (column === 'taxes') {
      add(`${ACCOUNT_TAX_PREFIX}${accountKeyPart(l.code)}`, -l.ledger);
    } else if (column === 'payments') {
      add(`${ACCOUNT_TENDER_PREFIX}${accountKeyPart(tenderOf(l))}`, -l.ledger);
    }
  }

  const advanceChange = input.advanceClosingMinor - input.previousAdvanceClosingMinor;
  add(ACCOUNT_ADVANCE_DEPOSITS, -advanceChange);
  guestLedger += advanceChange;

  const city = readCityLedgerDay(input.sql, input.businessDate);
  add(ACCOUNT_CITY_LEDGER, city.receivables - city.settlements);
  add(ACCOUNT_CITY_LEDGER_RECEIPTS, city.settlements);
  guestLedger -= city.receivables;
  add(ACCOUNT_GUEST_LEDGER, guestLedger);

  let total = 0;
  const lines: JournalRow[] = [];
  for (const [accountKey, amount] of [...signed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    total += amount;
    if (amount === 0) continue;
    lines.push(
      amount > 0
        ? { accountKey, debitMinor: amount, creditMinor: 0 }
        : { accountKey, debitMinor: 0, creditMinor: -amount },
    );
  }
  return {
    businessDate: input.businessDate,
    currency: input.currency,
    advanceClosingMinor: input.advanceClosingMinor,
    balanced: total === 0,
    lines,
  };
}

/** Stores one day. The day row goes last, so a failure part-way leaves the date "not recorded". */
export function insertJournalSnapshot(sql: SqlStorageLike, s: JournalSnapshot, recordedAt: number): void {
  sql.exec(`DELETE FROM night_audit_journal_line WHERE business_date = ?`, s.businessDate);
  for (const l of s.lines) {
    sql.exec(
      `INSERT INTO night_audit_journal_line (business_date, account_key, debit_minor, credit_minor)
       VALUES (?, ?, ?, ?)`,
      s.businessDate,
      l.accountKey,
      l.debitMinor,
      l.creditMinor,
    );
  }
  sql.exec(
    `INSERT OR REPLACE INTO night_audit_journal_day
       (business_date, currency, advance_closing_minor, balanced, recorded_at)
     VALUES (?, ?, ?, ?, ?)`,
    s.businessDate,
    s.currency,
    s.advanceClosingMinor,
    s.balanced ? 1 : 0,
    recordedAt,
  );
}

/** Closing advances of the latest stored day before `date`, 0 when there is none. */
export function previousAdvanceClosingMinor(sql: SqlStorageLike, date: string): number {
  const rows = sql
    .exec(
      `SELECT advance_closing_minor FROM night_audit_journal_day
        WHERE business_date < ? ORDER BY business_date DESC LIMIT 1`,
      date,
    )
    .toArray() as Row[];
  return n(rows[0]?.advance_closing_minor);
}

/** GUEST windows of stays that are pending or confirmed: the ones that can hold an advance. */
export function advanceWindowIds(sql: SqlStorageLike): string[] {
  const rows = sql
    .exec(
      `SELECT fw.folio_window_id AS id
         FROM folio_window fw JOIN reservation r ON r.reservation_id = fw.reservation_id
        WHERE fw.kind = 'GUEST' AND r.status IN ('pending', 'confirmed')`,
    )
    .toArray() as Row[];
  return rows.map((r) => String(r.id));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The stored journal for `from`..`to`, one entry per calendar date. A date with no stored day row is
 * `not_recorded` (closed before this shipped, or its builder failed), never an empty balanced day.
 */
export function readAccountingJournal(input: {
  sql: SqlStorageLike;
  currency: string;
  from: string;
  to: string;
  map: AccountingLedgerMap;
}): AccountingJournalResponse {
  const { sql } = input;
  const dayRows = sql
    .exec(
      `SELECT business_date, balanced FROM night_audit_journal_day
        WHERE business_date >= ? AND business_date <= ? ORDER BY business_date LIMIT 400`,
      input.from,
      input.to,
    )
    .toArray() as Row[];
  const status = new Map<string, AccountingDayStatus>(
    dayRows.map((r) => [String(r.business_date), n(r.balanced) === 1 ? 'ok' : 'unbalanced']),
  );
  const lineRows = sql
    .exec(
      `SELECT business_date, account_key, debit_minor, credit_minor FROM night_audit_journal_line
        WHERE business_date >= ? AND business_date <= ? ORDER BY business_date, account_key LIMIT 20000`,
      input.from,
      input.to,
    )
    .toArray() as Row[];
  const names = new Map(input.map.ledgers.map((e) => [e.accountKey, e]));
  const byDate = new Map<string, AccountingJournalLine[]>();
  const unmapped = new Set<string>();
  for (const r of lineRows) {
    const date = String(r.business_date);
    if (!status.has(date)) continue;
    const accountKey = String(r.account_key);
    const mapped = names.get(accountKey);
    if (!mapped) unmapped.add(accountKey);
    const list = byDate.get(date) ?? [];
    list.push({
      accountKey,
      ledgerName: mapped?.ledgerName ?? '',
      ledgerGroup: mapped?.ledgerGroup ?? '',
      debitMinor: n(r.debit_minor),
      creditMinor: n(r.credit_minor),
    });
    byDate.set(date, list);
  }
  const days: AccountingJournalDay[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    const lines = byDate.get(d) ?? [];
    days.push({
      businessDate: d,
      status: status.get(d) ?? 'not_recorded',
      lines,
      debitTotalMinor: lines.reduce((sum, l) => sum + l.debitMinor, 0),
      creditTotalMinor: lines.reduce((sum, l) => sum + l.creditMinor, 0),
    });
  }
  return { ok: true, currency: input.currency, days, unmappedKeys: [...unmapped].sort() };
}
