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
  resolveTaxes,
  roundHalfAwayFromZero,
  type PostedLineAmount,
  type TaxRuleSpec,
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

function flatExclusive(taxRuleId: string, ruleKey: string, rate: string): TaxRuleSpec {
  return {
    taxRuleId,
    ruleKey,
    priceMode: 'EXCLUSIVE',
    sequence: 0,
    base: 'NET',
    bands: [{ upToMinor: null, components: [{ componentNo: 1, rate }] }],
  };
}

describe('resolveTaxes', () => {
  it('flat exclusive one component matches computeTax and keeps the gross as net', () => {
    const gross = 10_000;
    const resolved = resolveTaxes({
      grossLedgerMinor: gross,
      grossTxnMinor: gross,
      rules: [flatExclusive('tr', 'sales', '0.0825')],
    });
    expect(resolved.netLedgerMinor).toBe(gross);
    expect(resolved.netTxnMinor).toBe(gross);
    expect(resolved.lines).toEqual([
      { taxRuleId: 'tr', componentNo: 1, rate: '0.0825', amountMinor: computeTax(gross, '0.0825') },
    ]);
  });

  it('slab picks the band on the net per night', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'gst',
      ruleKey: 'room_gst',
      priceMode: 'EXCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        { upToMinor: 750_000, components: [{ componentNo: 1, rate: '0.05' }] },
        { upToMinor: null, components: [{ componentNo: 1, rate: '0.18' }] },
      ],
    };
    const under = resolveTaxes({ grossLedgerMinor: 700_000, grossTxnMinor: 700_000, rules: [rule] });
    const over = resolveTaxes({ grossLedgerMinor: 800_000, grossTxnMinor: 800_000, rules: [rule] });
    expect(under.lines[0]?.amountMinor).toBe(computeTax(700_000, '0.05'));
    expect(over.lines[0]?.amountMinor).toBe(computeTax(800_000, '0.18'));
  });

  it('components round independently', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'gst',
      ruleKey: 'gst',
      priceMode: 'EXCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        {
          upToMinor: null,
          components: [
            { componentNo: 1, rate: '0.5' },
            { componentNo: 2, rate: '0.5' },
          ],
        },
      ],
    };
    const resolved = resolveTaxes({ grossLedgerMinor: 1, grossTxnMinor: 1, rules: [rule] });
    expect(resolved.lines.map((line) => line.amountMinor)).toEqual([
      computeTax(1, '0.5'),
      computeTax(1, '0.5'),
    ]);
    expect(resolved.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(2);
    expect(computeTax(1, '1')).toBe(1);
  });

  it('inclusive backs out so net + tax equals the price', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'vat',
      ruleKey: 'vat',
      priceMode: 'INCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        {
          upToMinor: null,
          components: [
            { componentNo: 1, rate: '0.025' },
            { componentNo: 2, rate: '0.025' },
          ],
        },
      ],
    };
    for (const gross of [999, 1, 7]) {
      const resolved = resolveTaxes({ grossLedgerMinor: gross, grossTxnMinor: gross, rules: [rule] });
      const tax = resolved.lines.reduce((sum, line) => sum + line.amountMinor, 0);
      expect(resolved.netLedgerMinor + tax).toBe(gross);
    }
  });

  it('inclusive boundary 7501 stays on the lower band when that net still fits', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'gst',
      ruleKey: 'gst',
      priceMode: 'INCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        {
          upToMinor: 7_500,
          components: [
            { componentNo: 1, rate: '0.025' },
            { componentNo: 2, rate: '0.025' },
          ],
        },
        {
          upToMinor: null,
          components: [
            { componentNo: 1, rate: '0.09' },
            { componentNo: 2, rate: '0.09' },
          ],
        },
      ],
    };
    const resolved = resolveTaxes({ grossLedgerMinor: 7_501, grossTxnMinor: 7_501, rules: [rule] });
    const tax = resolved.lines.reduce((sum, line) => sum + line.amountMinor, 0);
    expect(resolved.netLedgerMinor + tax).toBe(7_501);
    expect(resolved.netLedgerMinor).toBeLessThanOrEqual(7_500);
    expect(resolved.lines.every((line) => line.rate === '0.025')).toBe(true);
  });

  it('uses the boundary-gap rule when neither band contains its own net', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'slab',
      ruleKey: 'slab',
      priceMode: 'INCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        { upToMinor: 1_000, components: [{ componentNo: 1, rate: '0.05' }] },
        { upToMinor: null, components: [{ componentNo: 1, rate: '0.50' }] },
      ],
    };
    const gross = 1_100;
    const resolved = resolveTaxes({ grossLedgerMinor: gross, grossTxnMinor: gross, rules: [rule] });
    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0]?.rate).toBe('0.05');
    expect(resolved.netLedgerMinor + resolved.lines[0]!.amountMinor).toBe(gross);
  });

  it('compounds NET_PLUS_PRIOR like Ontario MAT inside HST', () => {
    const mat: TaxRuleSpec = {
      taxRuleId: 'mat',
      ruleKey: 'mat',
      priceMode: 'EXCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.04' }] }],
    };
    const hst: TaxRuleSpec = {
      taxRuleId: 'hst',
      ruleKey: 'hst',
      priceMode: 'EXCLUSIVE',
      sequence: 1,
      base: 'NET_PLUS_PRIOR',
      bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.13' }] }],
    };
    const net = 10_000;
    const resolved = resolveTaxes({ grossLedgerMinor: net, grossTxnMinor: net, rules: [hst, mat] });
    const matTax = computeTax(net, '0.04');
    expect(resolved.netLedgerMinor).toBe(net);
    expect(resolved.lines).toEqual([
      { taxRuleId: 'mat', componentNo: 1, rate: '0.04', amountMinor: matTax },
      { taxRuleId: 'hst', componentNo: 1, rate: '0.13', amountMinor: computeTax(net + matTax, '0.13') },
    ]);
  });

  it('NET_PLUS_PRIOR does not compound on a rule with the same sequence', () => {
    const first: TaxRuleSpec = {
      taxRuleId: 'a',
      ruleKey: 'a',
      priceMode: 'EXCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.04' }] }],
    };
    const second: TaxRuleSpec = { ...first, taxRuleId: 'b', ruleKey: 'b', base: 'NET_PLUS_PRIOR' };
    const net = 10_000;
    const resolved = resolveTaxes({ grossLedgerMinor: net, grossTxnMinor: net, rules: [first, second] });
    expect(resolved.lines.map((line) => line.amountMinor)).toEqual([400, 400]);
  });

  it('mixes inclusive back-out with an exclusive add-on', () => {
    const vat: TaxRuleSpec = {
      taxRuleId: 'vat',
      ruleKey: 'vat',
      priceMode: 'INCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.20' }] }],
    };
    const city: TaxRuleSpec = {
      taxRuleId: 'city',
      ruleKey: 'city',
      priceMode: 'EXCLUSIVE',
      sequence: 1,
      base: 'NET',
      bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.05' }] }],
    };
    const gross = 12_000;
    const resolved = resolveTaxes({ grossLedgerMinor: gross, grossTxnMinor: gross, rules: [city, vat] });
    expect(resolved.netLedgerMinor + (resolved.lines.find((line) => line.taxRuleId === 'vat')?.amountMinor ?? 0)).toBe(
      gross,
    );
    expect(resolved.lines.find((line) => line.taxRuleId === 'city')?.amountMinor).toBe(
      computeTax(resolved.netLedgerMinor, '0.05'),
    );
  });

  it('splits an inclusive price across components so they sum to the backed-out tax', () => {
    const rule: TaxRuleSpec = {
      taxRuleId: 'gst',
      ruleKey: 'gst',
      priceMode: 'INCLUSIVE',
      sequence: 0,
      base: 'NET',
      bands: [
        {
          upToMinor: null,
          components: [
            { componentNo: 1, rate: '0.06' },
            { componentNo: 2, rate: '0.06' },
          ],
        },
      ],
    };
    const gross = 999;
    const resolved = resolveTaxes({ grossLedgerMinor: gross, grossTxnMinor: gross, rules: [rule] });
    const tax = resolved.lines.reduce((sum, line) => sum + line.amountMinor, 0);
    expect(resolved.netLedgerMinor + tax).toBe(gross);
    expect(resolved.lines).toHaveLength(2);
  });
});
