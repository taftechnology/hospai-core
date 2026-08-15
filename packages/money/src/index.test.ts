import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  applyPromoToAmountMinor,
  assertPostedMatches,
  computeTax,
  currencyCode,
  CurrencyMismatchError,
  InvalidFxRateError,
  InvalidTaxRateError,
  LedgerAmountMismatchError,
  InvalidMoneyError,
  money,
  negate,
  ledgerToTxn,
  postToLedger,
  roundHalfAwayFromZero,
  type PostedLineAmount,
} from './index.js';

describe('currencyCode', () => {
  it('accepts valid ISO codes', () => {
    expect(currencyCode('usd')).toBe('USD');
  });

  it('rejects nonsense', () => {
    expect(() => currencyCode('nonsense')).toThrow(InvalidMoneyError);
  });
});

describe('money', () => {
  it('rejects floats', () => {
    expect(() => money(1.5, currencyCode('USD'))).toThrow(InvalidMoneyError);
  });

  it('add rejects cross-currency at runtime', () => {
    const eurCode: string = 'EUR';
    const usdCode: string = 'USD';
    expect(() => add(money(100, currencyCode(eurCode)), money(50, currencyCode(usdCode)))).toThrow(
      CurrencyMismatchError,
    );
  });
});

describe('allocate', () => {
  it('allocates with exact foot', () => {
    expect(allocate(100, [60, 40])).toEqual([60, 40]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('rejects non-positive weights', () => {
    expect(() => allocate(100, [-1, 2])).toThrow(InvalidMoneyError);
    expect(() => allocate(100, [0, 1])).toThrow(InvalidMoneyError);
  });

  it('supports FIRST remainder policy', () => {
    expect(allocate(100, [1, 1, 1], { policy: 'FIRST' })).toEqual([34, 33, 33]);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('makes reversals foot exactly', () => {
    const pos = roundHalfAwayFromZero(25n, 10n);
    const neg = roundHalfAwayFromZero(-25n, 10n);
    expect(pos).toBe(3n);
    expect(neg).toBe(-3n);
    expect(pos + neg).toBe(0n);
  });
});

describe('computeTax', () => {
  it('computes 8.25% on 10000 minor', () => {
    expect(computeTax(10_000, '0.0825')).toBe(825);
  });

  it('rounds half away from zero', () => {
    expect(computeTax(1000, '0.0825')).toBe(83);
  });

  it('rejects negative rate', () => {
    expect(() => computeTax(100, '-0.01')).toThrow(InvalidTaxRateError);
  });

  it('rejects non-decimal rate', () => {
    expect(() => computeTax(100, '1.2.3')).toThrow(InvalidTaxRateError);
  });

  it('rejects non-integer base', () => {
    expect(() => computeTax(1.5, '0.1')).toThrow(InvalidMoneyError);
  });

  it('computes tax on negative base (discount path)', () => {
    expect(computeTax(-1000, '0.10')).toBe(-100);
  });
});

describe('postToLedger', () => {
  it('uses identity rate for same currency', () => {
    const posted = postToLedger(money(1000, currencyCode('EUR')), currencyCode('EUR'), '1', 1);
    expect(posted).toEqual({
      amountMinor: 1000,
      txnCurrency: 'EUR',
      ledgerAmountMinor: 1000,
      fxRate: '1',
      fxRateAt: 1,
    });
  });

  it('rejects non-identity rate for same currency', () => {
    expect(() =>
      postToLedger(money(100, currencyCode('EUR')), currencyCode('EUR'), '1.1', 1),
    ).toThrow(InvalidFxRateError);
  });

  it('converts cross-currency deterministically', () => {
    const posted = postToLedger(money(10000, currencyCode('EUR')), currencyCode('USD'), '1.0842', 1);
    expect(posted.ledgerAmountMinor).toBe(10842);
    expect(posted.fxRate).toBe('1.0842');
  });

  it('rejects invalid fx strings', () => {
    expect(() =>
      postToLedger(money(100, currencyCode('EUR')), currencyCode('USD'), '1.2.3', 1),
    ).toThrow(InvalidFxRateError);
  });

  it('converts EUR 10000 at 1.10 to 11000 ledger', () => {
    const posted = postToLedger(money(10000, currencyCode('EUR')), currencyCode('USD'), '1.10', 1);
    expect(posted.ledgerAmountMinor).toBe(11000);
  });
});

describe('ledgerToTxn', () => {
  it('returns the ledger amount for same-currency rate 1', () => {
    expect(ledgerToTxn(5000, currencyCode('USD'), currencyCode('USD'), '1')).toBe(5000);
  });

  it('rejects non-identity rate for same currency', () => {
    expect(() => ledgerToTxn(5000, currencyCode('USD'), currencyCode('USD'), '1.10')).toThrow(
      InvalidFxRateError,
    );
  });

  it('rejects a zero rate', () => {
    expect(() => ledgerToTxn(11000, currencyCode('EUR'), currencyCode('USD'), '0')).toThrow(
      InvalidFxRateError,
    );
  });

  it('inverts postToLedger within 1 minor', () => {
    const eur = currencyCode('EUR');
    const usd = currencyCode('USD');
    const txn = ledgerToTxn(11000, eur, usd, '1.10');
    const posted = postToLedger(money(txn, eur), usd, '1.10', 1);
    expect(Math.abs(posted.ledgerAmountMinor - 11000)).toBeLessThanOrEqual(1);
  });
});

describe('assertPostedMatches', () => {
  it('passes when ledger column matches conversion', () => {
    expect(
      assertPostedMatches(
        {
          amountMinor: 1000,
          txnCurrency: 'EUR',
          ledgerAmountMinor: 1000,
          fxRate: '1',
          fxRateAt: 1,
        },
        currencyCode('EUR'),
      ).ledgerAmountMinor,
    ).toBe(1000);
  });

  it('throws on ledger drift', () => {
    expect(() =>
      assertPostedMatches(
        {
          amountMinor: 1000,
          txnCurrency: 'EUR',
          ledgerAmountMinor: 999,
          fxRate: '1',
          fxRateAt: 1,
        },
        currencyCode('EUR'),
      ),
    ).toThrow(LedgerAmountMismatchError);
  });
});

describe('structuredClone', () => {
  it('round-trips PostedLineAmount', () => {
    const posted: PostedLineAmount = {
      amountMinor: 100,
      txnCurrency: currencyCode('USD'),
      ledgerAmountMinor: 100,
      fxRate: '1',
      fxRateAt: 1,
    };
    expect(structuredClone(posted)).toEqual(posted);
  });

  it('round-trips negated money', () => {
    const m = negate(money(50, currencyCode('USD')));
    expect(structuredClone(m)).toEqual(m);
  });
});

describe('applyPromoToAmountMinor', () => {
  it('1: percent 1500 bps off 10000 → 8500', () => {
    expect(applyPromoToAmountMinor(10_000, { kind: 'percent', bps: 1500 })).toBe(8500);
  });

  it('2: fixed_per_night floors at 0', () => {
    expect(applyPromoToAmountMinor(500, { kind: 'fixed_per_night', amountMinor: 800 })).toBe(0);
  });

  it('3: percent 10000 bps → 0', () => {
    expect(applyPromoToAmountMinor(10_000, { kind: 'percent', bps: 10_000 })).toBe(0);
  });

  it('rejects non-integer negative amountMinor', () => {
    expect(() => applyPromoToAmountMinor(-1, { kind: 'percent', bps: 100 })).toThrow(InvalidMoneyError);
  });
});
