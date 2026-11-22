import type { AccountingJournalResponse } from '@hospai/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_CSV_HEADER,
  accountingJournalCsvFileName,
  accountingJournalKeyPrefix,
  accountingJournalQueryKey,
  accountingRangeProblem,
  buildAccountingJournalCsv,
  journalAccountKeys,
  missingDays,
  recordedDays,
  settingsAccountKeys,
  unbalancedDays,
} from './accounting-journal-model.js';

const line = (accountKey: string, debitMinor: number, creditMinor: number, ledgerName = '', ledgerGroup = '') => ({
  accountKey,
  ledgerName,
  ledgerGroup,
  debitMinor,
  creditMinor,
});

const result: AccountingJournalResponse = {
  ok: true,
  currency: 'INR',
  unmappedKeys: ['GUEST_LEDGER'],
  days: [
    {
      businessDate: '2026-11-19',
      status: 'ok',
      lines: [
        line('GUEST_LEDGER', 11800, 0),
        line('REVENUE:ROOM', 0, 10000, 'Room "Sales", net', 'Sales Accounts'),
        line('TAX:CGST', 0, 900, '=cmd|calc', '-group'),
        line('TAX:SGST', 0, 900, '@Output SGST'),
      ],
      debitTotalMinor: 11800,
      creditTotalMinor: 11800,
    },
    { businessDate: '2026-11-20', status: 'not_recorded', lines: [], debitTotalMinor: 0, creditTotalMinor: 0 },
    {
      businessDate: '2026-11-21',
      status: 'unbalanced',
      lines: [line('GUEST_LEDGER', 500, 0)],
      debitTotalMinor: 500,
      creditTotalMinor: 0,
    },
  ],
};

describe('accounting journal model (R4.12)', () => {
  it('keys the cache by tenant first, then the dates', () => {
    expect(accountingJournalQueryKey('p1', '2026-11-01', '2026-11-07')).toEqual([
      'accounting-journal',
      'p1',
      '2026-11-01',
      '2026-11-07',
    ]);
    const prefix = accountingJournalKeyPrefix('p1');
    expect(accountingJournalQueryKey('p1', 'a', 'b').slice(0, prefix.length)).toEqual([...prefix]);
    expect(accountingJournalQueryKey('p2', 'a', 'b').slice(0, prefix.length)).not.toEqual([...prefix]);
  });

  it('checks a range before it is asked for: both dates, in order, 31 days at most', () => {
    expect(accountingRangeProblem('2026-11-01', '2026-11-01')).toBeNull();
    expect(accountingRangeProblem('2026-11-01', '2026-12-01')).toBeNull();
    expect(accountingRangeProblem('2026-11-01', '2026-12-02')).toBe('Choose at most 31 days.');
    expect(accountingRangeProblem('2026-11-02', '2026-11-01')).toBe('The first date must not be after the last date.');
    expect(accountingRangeProblem('', '2026-11-01')).toBe('Choose both dates.');
  });

  it('builds the CSV: the six columns, recorded days only, two-decimal amounts, ISO dates, CRLF', () => {
    const csv = buildAccountingJournalCsv(result);
    const rows = csv.split('\r\n');
    expect(rows.pop()).toBe('');
    expect(rows[0]).toBe('Date,Account key,Ledger,Group,Debit,Credit');
    expect([...ACCOUNTING_CSV_HEADER]).toEqual(['Date', 'Account key', 'Ledger', 'Group', 'Debit', 'Credit']);
    expect(rows[1]).toBe('2026-11-19,GUEST_LEDGER,,,118.00,0.00');
    // RFC 4180: a field with a comma or quotes is quoted with its quotes doubled.
    expect(rows[2]).toBe('2026-11-19,REVENUE:ROOM,"Room ""Sales"", net",Sales Accounts,0.00,100.00');
    // Nothing is written for the date with no journal; the unbalanced date is still in the file.
    expect(csv).not.toContain('2026-11-20');
    expect(rows[rows.length - 1]).toBe('2026-11-21,GUEST_LEDGER,,,5.00,0.00');
    expect(rows).toHaveLength(6);
  });

  it('keeps a spreadsheet from running a typed ledger name as a formula', () => {
    const rows = buildAccountingJournalCsv(result).split('\r\n');
    expect(rows[3]).toBe("2026-11-19,TAX:CGST,'=cmd|calc,'-group,0.00,9.00");
    expect(rows[4]).toBe("2026-11-19,TAX:SGST,'@Output SGST,,0.00,9.00");
  });

  it('writes amounts with the currency digits (none for a whole-unit currency)', () => {
    const jpy: AccountingJournalResponse = {
      ...result,
      currency: 'JPY',
      days: [{ ...result.days[2]!, businessDate: '2026-11-21' }],
    };
    expect(buildAccountingJournalCsv(jpy).split('\r\n')[1]).toBe('2026-11-21,GUEST_LEDGER,,,500,0');
  });

  it('names the file for one day or a range', () => {
    expect(accountingJournalCsvFileName('2026-11-19', '2026-11-19')).toBe('accounting_journal_2026-11-19.csv');
    expect(accountingJournalCsvFileName('2026-11-01', '2026-11-07')).toBe('accounting_journal_2026-11-01_2026-11-07.csv');
  });

  it('sorts the days by what they hold', () => {
    expect(recordedDays(result).map((d) => d.businessDate)).toEqual(['2026-11-19', '2026-11-21']);
    expect(missingDays(result).map((d) => d.businessDate)).toEqual(['2026-11-20']);
    expect(unbalancedDays(result).map((d) => d.businessDate)).toEqual(['2026-11-21']);
    expect(journalAccountKeys(result).sort()).toEqual(['GUEST_LEDGER', 'REVENUE:ROOM', 'TAX:CGST', 'TAX:SGST']);
    expect(journalAccountKeys(undefined)).toEqual([]);
  });

  it('lists the fixed keys, then the keys seen, then any mapped key not seen, each once', () => {
    const keys = settingsAccountKeys(['TAX:SGST', 'REVENUE:ROOM', 'GUEST_LEDGER'], {
      ledgers: [{ accountKey: 'REVENUE:OLD', ledgerName: 'Old' }, { accountKey: 'REVENUE:ROOM', ledgerName: 'Room' }],
    });
    expect(keys.slice(0, 7)).toEqual([
      'TENDER:CASH',
      'TENDER:CARD',
      'TENDER:UPI',
      'GUEST_LEDGER',
      'ADVANCE_DEPOSITS',
      'CITY_LEDGER',
      'CITY_LEDGER_RECEIPTS',
    ]);
    expect(keys.slice(7)).toEqual(['REVENUE:ROOM', 'TAX:SGST', 'REVENUE:OLD']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
