import { describe, expect, it } from 'vitest';
import { foldFolioLines, type FolioLine } from '../src/folio-fold.js';

function line(
  partial: Partial<FolioLine> & Pick<FolioLine, 'folioLineId' | 'ledgerAmountMinor' | 'createdAt'>,
): FolioLine {
  return {
    chargeCode: 'MISC',
    amountMinor: partial.ledgerAmountMinor,
    txnCurrency: 'USD',
    source: null,
    businessDate: null,
    splitOf: null,
    paymentId: null,
    taxOf: null,
    taxRuleId: null,
    ...partial,
  };
}

describe('foldFolioLines', () => {
  it('nests tax under charge and matches balance', () => {
    const lines = [
      line({ folioLineId: 'c1', ledgerAmountMinor: 10000, createdAt: 1 }),
      line({
        folioLineId: 't1',
        ledgerAmountMinor: 990,
        createdAt: 2,
        source: 'TAX',
        chargeCode: 'TAX',
        taxOf: 'c1',
        taxRuleId: 'tr1',
      }),
    ];
    const fold = foldFolioLines(lines);
    expect(fold.liveTotalMinor).toBe(10990);
    expect(fold.roots).toHaveLength(1);
    expect(fold.roots[0]!.line.folioLineId).toBe('c1');
    expect(fold.roots[0]!.taxes.map((t) => t.line.folioLineId)).toEqual(['t1']);
  });

  it('8-line taxed split: liveTotal 11000, one-level, no reversals', () => {
    const lines = [
      line({ folioLineId: '1', ledgerAmountMinor: 10000, createdAt: 1 }),
      line({
        folioLineId: '2',
        ledgerAmountMinor: -10000,
        createdAt: 2,
        source: 'SPLIT_REVERSAL',
        splitOf: '1',
      }),
      line({ folioLineId: '3', ledgerAmountMinor: 6000, createdAt: 3, splitOf: '1' }),
      line({ folioLineId: '4', ledgerAmountMinor: 4000, createdAt: 4, splitOf: '1' }),
      line({
        folioLineId: '5',
        ledgerAmountMinor: 1000,
        createdAt: 5,
        source: 'TAX',
        taxOf: '1',
        taxRuleId: 'tr',
      }),
      line({
        folioLineId: '6',
        ledgerAmountMinor: -1000,
        createdAt: 6,
        source: 'SPLIT_REVERSAL',
        splitOf: '5',
      }),
      line({
        folioLineId: '7',
        ledgerAmountMinor: 600,
        createdAt: 7,
        source: 'TAX',
        taxOf: '3',
        taxRuleId: 'tr',
      }),
      line({
        folioLineId: '8',
        ledgerAmountMinor: 400,
        createdAt: 8,
        source: 'TAX',
        taxOf: '4',
        taxRuleId: 'tr',
      }),
    ];
    const balanceMinor = 11000;
    const fold = foldFolioLines(lines);
    expect(fold.liveTotalMinor).toBe(balanceMinor);
    expect(fold.roots.map((r) => r.line.folioLineId)).toEqual(['3', '4']);
    expect(fold.roots[0]!.taxes.map((t) => t.line.folioLineId)).toEqual(['7']);
    expect(fold.roots[1]!.taxes.map((t) => t.line.folioLineId)).toEqual(['8']);
    expect(fold.roots.every((r) => r.line.source !== 'SPLIT_REVERSAL')).toBe(true);
  });

  it('split-of-child stays one-level and preserves liveTotal', () => {
    // After first split: live 40+4 + 60+6 = 110; then split child 3 (60) into 30+30
    const lines = [
      line({ folioLineId: '1', ledgerAmountMinor: 10000, createdAt: 1 }),
      line({
        folioLineId: '2',
        ledgerAmountMinor: -10000,
        createdAt: 2,
        source: 'SPLIT_REVERSAL',
        splitOf: '1',
      }),
      line({ folioLineId: '3', ledgerAmountMinor: 6000, createdAt: 3, splitOf: '1' }),
      line({ folioLineId: '4', ledgerAmountMinor: 4000, createdAt: 4, splitOf: '1' }),
      line({
        folioLineId: '5',
        ledgerAmountMinor: 1000,
        createdAt: 5,
        source: 'TAX',
        taxOf: '1',
        taxRuleId: 'tr',
      }),
      line({
        folioLineId: '6',
        ledgerAmountMinor: -1000,
        createdAt: 6,
        source: 'SPLIT_REVERSAL',
        splitOf: '5',
      }),
      line({
        folioLineId: '7',
        ledgerAmountMinor: 600,
        createdAt: 7,
        source: 'TAX',
        taxOf: '3',
        taxRuleId: 'tr',
      }),
      line({
        folioLineId: '8',
        ledgerAmountMinor: 400,
        createdAt: 8,
        source: 'TAX',
        taxOf: '4',
        taxRuleId: 'tr',
      }),
      // second split of child 3
      line({
        folioLineId: '9',
        ledgerAmountMinor: -6000,
        createdAt: 9,
        source: 'SPLIT_REVERSAL',
        splitOf: '3',
      }),
      line({ folioLineId: '10', ledgerAmountMinor: 3000, createdAt: 10, splitOf: '3' }),
      line({ folioLineId: '11', ledgerAmountMinor: 3000, createdAt: 11, splitOf: '3' }),
      line({
        folioLineId: '12',
        ledgerAmountMinor: -600,
        createdAt: 12,
        source: 'SPLIT_REVERSAL',
        splitOf: '7',
      }),
      line({
        folioLineId: '13',
        ledgerAmountMinor: 300,
        createdAt: 13,
        source: 'TAX',
        taxOf: '10',
        taxRuleId: 'tr',
      }),
      line({
        folioLineId: '14',
        ledgerAmountMinor: 300,
        createdAt: 14,
        source: 'TAX',
        taxOf: '11',
        taxRuleId: 'tr',
      }),
    ];
    const fold = foldFolioLines(lines);
    expect(fold.liveTotalMinor).toBe(11000);
    expect(fold.roots.map((r) => r.line.folioLineId)).toEqual(['4', '10', '11']);
    expect(fold.roots.every((r) => r.taxes.every((t) => t.taxes.length === 0))).toBe(true);
  });

  it('preserves wire order (created_at ASC) among roots', () => {
    const ordered = [
      line({ folioLineId: 'earlier', ledgerAmountMinor: 200, createdAt: 10 }),
      line({ folioLineId: 'later', ledgerAmountMinor: 100, createdAt: 20 }),
    ];
    expect(foldFolioLines(ordered).roots.map((r) => r.line.folioLineId)).toEqual([
      'earlier',
      'later',
    ]);
  });


  it('orphan tax is a defect root and stays in liveTotal', () => {
    const lines = [
      line({
        folioLineId: 'orphan',
        ledgerAmountMinor: 50,
        createdAt: 1,
        source: 'TAX',
        taxOf: 'missing',
        taxRuleId: 'tr',
      }),
    ];
    const fold = foldFolioLines(lines);
    expect(fold.liveTotalMinor).toBe(50);
    expect(fold.roots).toHaveLength(1);
    expect(fold.roots[0]!.orphanTax).toBe(true);
  });

  it('includes live payment lines in liveTotal', () => {
    const lines = [
      line({ folioLineId: 'c', ledgerAmountMinor: 1000, createdAt: 1 }),
      line({
        folioLineId: 'p',
        ledgerAmountMinor: -400,
        createdAt: 2,
        source: 'PAYMENT',
        chargeCode: 'PAYMENT',
        paymentId: 'pay1',
      }),
    ];
    const fold = foldFolioLines(lines);
    expect(fold.liveTotalMinor).toBe(600);
    expect(fold.roots.map((r) => r.line.folioLineId)).toEqual(['c', 'p']);
  });
});
