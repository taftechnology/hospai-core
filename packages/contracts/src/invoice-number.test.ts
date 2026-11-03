import { describe, expect, it } from 'vitest';
import {
  financialYearLabel,
  formatInvoiceNumber,
  invoiceNumberProblem,
} from './invoice-number.js';

describe('financialYearLabel', () => {
  it('uses prior year pair before 1 April', () => {
    expect(financialYearLabel('2026-03-31')).toBe('25-26');
  });

  it('uses current year pair from 1 April', () => {
    expect(financialYearLabel('2026-04-01')).toBe('26-27');
  });

  it('handles leap-year February', () => {
    expect(financialYearLabel('2024-02-29')).toBe('23-24');
  });

  it('handles non-leap February', () => {
    expect(financialYearLabel('2023-02-28')).toBe('22-23');
  });
});

describe('formatInvoiceNumber', () => {
  it('formats continuous with six-digit counter and ignores date', () => {
    expect(
      formatInvoiceNumber({
        series: 'continuous',
        prefix: 'INV-',
        suffix: '',
        counter: 1,
        invoiceDate: '2026-04-01',
      }),
    ).toBe('INV-000001');
    expect(
      formatInvoiceNumber({
        series: 'continuous',
        prefix: 'INV-',
        suffix: '',
        counter: 1,
        invoiceDate: '1999-01-01',
      }),
    ).toBe('INV-000001');
  });

  it('formats continuous with suffix', () => {
    expect(
      formatInvoiceNumber({
        series: 'continuous',
        prefix: 'INV-',
        suffix: 'X',
        counter: 42,
        invoiceDate: '2026-03-31',
      }),
    ).toBe('INV-000042X');
  });

  it('formats gst financial year series', () => {
    expect(
      formatInvoiceNumber({
        series: 'gst_financial_year',
        prefix: 'INV-',
        suffix: '',
        counter: 1,
        invoiceDate: '2026-04-01',
      }),
    ).toBe('INV-26-27/00001');
  });
});

describe('invoiceNumberProblem', () => {
  const gstBase = {
    series: 'gst_financial_year' as const,
    suffix: '',
    counter: 1,
    invoiceDate: '2026-04-01',
  };

  it('returns null for continuous regardless of length or charset', () => {
    expect(
      invoiceNumberProblem({
        series: 'continuous',
        prefix: 'A'.repeat(100),
        suffix: '_!@#',
        counter: 1,
        invoiceDate: '2026-04-01',
      }),
    ).toBeNull();
  });

  it('returns null for gst at 15 characters', () => {
    expect(invoiceNumberProblem({ ...gstBase, prefix: 'INV-' })).toBeNull();
  });

  it('returns null for gst at exactly 16 characters', () => {
    expect(invoiceNumberProblem({ ...gstBase, prefix: 'INV-X' })).toBeNull();
  });

  it('returns length reason at 17 characters', () => {
    expect(invoiceNumberProblem({ ...gstBase, prefix: 'INV-XX' })).toBe(
      'Invoice numbers in a financial-year series must be at most 16 characters.',
    );
  });

  it('returns charset reason for illegal characters', () => {
    expect(invoiceNumberProblem({ ...gstBase, prefix: 'INV_' })).toBe(
      'Invoice numbers in a financial-year series may use only letters, digits, hyphens, and slashes.',
    );
  });

  it('prefers length reason when both length and charset fail', () => {
    expect(
      invoiceNumberProblem({
        ...gstBase,
        prefix: 'INV_' + 'X'.repeat(20),
      }),
    ).toBe('Invoice numbers in a financial-year series must be at most 16 characters.');
  });
});
