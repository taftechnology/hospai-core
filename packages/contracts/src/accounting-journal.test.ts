import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_FIXED_ACCOUNT_KEYS,
  ACCOUNTING_JOURNAL_MAX_DAYS,
  ACCOUNTING_LEDGER_MAP_DEFAULT,
  ACCOUNTING_LEDGER_MAP_KEY,
  ACCOUNT_KEY_PATTERN,
  AccountingLedgerMapSchema,
  accountKeyPart,
  accountingRangeDays,
  parseAccountingJournalQuery,
  readAccountingLedgerMap,
} from './accounting-journal.js';
import { getConfigEntry, domainConfigKeys } from './config/register.js';
import { GRANTABLE_PERMISSIONS, ROLE_GRANTS } from './permissions.js';
import { V1_HTTP_ROUTE_AUDIT } from './v1-http-routes.js';

const q = (params: Record<string, string>) => parseAccountingJournalQuery((n) => params[n]);

describe('accounting journal contracts (R4.12 Part A)', () => {
  it('registers accounting.ledger_map as a DOMAIN key saved by settings:configure', () => {
    const entry = getConfigEntry(ACCOUNTING_LEDGER_MAP_KEY)!;
    expect(entry).toMatchObject({ class: 'DOMAIN', permission: 'settings:configure', scope: 'property', consumersExempt: true });
    expect(entry.default).toEqual(ACCOUNTING_LEDGER_MAP_DEFAULT);
    expect(domainConfigKeys().map((e) => e.key)).toContain(ACCOUNTING_LEDGER_MAP_KEY);
  });

  it('accepts a map of up to 300 unique keys with names of 1 to 100 characters', () => {
    const ok = {
      ledgers: [
        { accountKey: 'REVENUE:ROOM', ledgerName: 'Room Sales', ledgerGroup: 'Sales' },
        { accountKey: 'GUEST_LEDGER', ledgerName: 'Guest Debtors' },
      ],
    };
    expect(AccountingLedgerMapSchema.safeParse(ok).success).toBe(true);
    const many = Array.from({ length: 301 }, (_, i) => ({ accountKey: `REVENUE:C${i}`, ledgerName: 'x' }));
    expect(AccountingLedgerMapSchema.safeParse({ ledgers: many }).success).toBe(false);
    expect(AccountingLedgerMapSchema.safeParse({ ledgers: many.slice(0, 300) }).success).toBe(true);
    const bad: unknown[] = [
      { ledgers: [ok.ledgers[0], ok.ledgers[0]] },
      { ledgers: [{ accountKey: 'REVENUE:ROOM', ledgerName: '' }] },
      { ledgers: [{ accountKey: 'REVENUE:ROOM', ledgerName: 'x'.repeat(101) }] },
      { ledgers: [{ accountKey: 'REVENUE:ROOM', ledgerName: 'x', ledgerGroup: 'g'.repeat(101) }] },
      { ledgers: [{ accountKey: 'revenue:room', ledgerName: 'x' }] },
      { ledgers: [{ accountKey: 'REVENUE:ROOM:EXTRA', ledgerName: 'x' }] },
      { ledgers: [{ accountKey: 'REVENUE:ROOM', ledgerName: 'x', note: 'extra' }] },
      { ledgers: [], extra: 1 },
    ];
    for (const value of bad) expect(AccountingLedgerMapSchema.safeParse(value).success).toBe(false);
  });

  it('reads anything that does not parse as an empty map', () => {
    expect(readAccountingLedgerMap(undefined)).toEqual({ ledgers: [] });
    expect(readAccountingLedgerMap({ ledgers: 'no' })).toEqual({ ledgers: [] });
  });

  it('keeps every fixed key and every built key inside the account key pattern', () => {
    for (const key of ACCOUNTING_FIXED_ACCOUNT_KEYS) expect(ACCOUNT_KEY_PATTERN.test(key), key).toBe(true);
    expect(accountKeyPart('room')).toBe('ROOM');
    expect(accountKeyPart('late-fee')).toBe('LATE_FEE');
    expect(accountKeyPart('')).toBe('_');
    expect(ACCOUNT_KEY_PATTERN.test(`REVENUE:${accountKeyPart('a b/c')}`)).toBe(true);
  });

  it('parses the query: one bound is one day, no bound is left to the server, 31 days at most', () => {
    expect(q({})).toEqual({ ok: true });
    expect(q({ from: '2026-11-01' })).toEqual({ ok: true, from: '2026-11-01', to: '2026-11-01' });
    expect(q({ to: '2026-11-05' })).toEqual({ ok: true, from: '2026-11-05', to: '2026-11-05' });
    expect(q({ from: '2026-11-01', to: '2026-12-01' })).toEqual({ ok: true, from: '2026-11-01', to: '2026-12-01' });
    expect(accountingRangeDays('2026-11-01', '2026-12-01')).toBe(ACCOUNTING_JOURNAL_MAX_DAYS);
    expect(q({ from: '2026-11-01', to: '2026-12-02' })).toEqual({
      ok: false,
      kind: 'limit_exceeded',
      limit: 'days',
      max: 31,
    });
    expect(q({ from: '2026-11-02', to: '2026-11-01' })).toEqual({ ok: false, kind: 'invalid_query', detail: 'invalid_range' });
    for (const from of ['2026-02-30', '20261101', 'x', '2026-13-01']) {
      expect(q({ from })).toEqual({ ok: false, kind: 'invalid_query', detail: 'invalid_date' });
    }
  });

  it('grants accounting:export to owner and admin, not staff, and audits the route with its entitlement', () => {
    expect(GRANTABLE_PERMISSIONS).toContain('accounting:export');
    expect(ROLE_GRANTS.owner).toContain('accounting:export');
    expect(ROLE_GRANTS.admin).toContain('accounting:export');
    expect(ROLE_GRANTS.staff).not.toContain('accounting:export');
    const route = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_accounting_journal');
    expect(route).toEqual({
      id: 'get_accounting_journal',
      scope: 'property',
      permission: 'accounting:export',
      entitlement: 'accounting_export.enabled',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (route ?? {})).toBe(false);
  });
});
