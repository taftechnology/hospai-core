/** Integer minor-unit money helpers (no floats). */

declare const CurrencyCodeBrand: unique symbol;

/** ISO 4217 code — branded at construction; erases to string at runtime (RPC-safe). */
export type CurrencyCode = string & { readonly [CurrencyCodeBrand]: typeof CurrencyCodeBrand };

export type Money<C extends CurrencyCode = CurrencyCode> = {
  amountMinor: number;
  currency: C;
};

/** Validated decimal string — never a float. */
export type FxRate = string;

/** Maps 1:1 to folio_line money columns. */
export type PostedLineAmount = {
  amountMinor: number;
  txnCurrency: CurrencyCode;
  ledgerAmountMinor: number;
  fxRate: FxRate;
  fxRateAt: number;
};

export type FolioLineAmount = PostedLineAmount;

export type RemainderPolicy = 'LAST' | 'FIRST';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class LedgerAmountMismatchError extends InvalidMoneyError {
  constructor() {
    super('ledger amount does not match fx conversion');
    this.name = 'LedgerAmountMismatchError';
  }
}

export class InvalidFxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFxRateError';
  }
}

export class InvalidTaxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaxRateError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

const ISO4217 = /^[A-Z]{3}$/;

/** Preserves string literal so `currencyCode('EUR')` and `currencyCode('USD')` are distinct types. */
export function currencyCode<C extends string>(raw: C): CurrencyCode & Uppercase<C> {
  const code = raw.toUpperCase() as Uppercase<C>;
  if (!ISO4217.test(code)) {
    throw new InvalidMoneyError('currency must be ISO 4217 (3 uppercase letters)');
  }
  return code as CurrencyCode & Uppercase<C>;
}

export function money<C extends CurrencyCode>(amountMinor: number, currency: C): Money<C> {
  if (!Number.isInteger(amountMinor)) {
    throw new InvalidMoneyError('amountMinor must be an integer');
  }
  return { amountMinor, currency };
}

export function zero<C extends CurrencyCode>(currency: C): Money<C> {
  return money(0, currency);
}

export function add<C extends CurrencyCode>(a: Money<C>, b: Money<C>): Money<C> {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract<C extends CurrencyCode>(a: Money<C>, b: Money<C>): Money<C> {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate<C extends CurrencyCode>(m: Money<C>): Money<C> {
  return money(-m.amountMinor, m.currency);
}

export function isZero(m: Money<CurrencyCode>): boolean {
  return m.amountMinor === 0;
}

export function compare(a: Money<CurrencyCode>, b: Money<CurrencyCode>): number {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
  return a.amountMinor - b.amountMinor;
}

export function validateFxRate(rate: string): FxRate {
  if (typeof rate !== 'string' || rate.length === 0 || !/^-?\d+(\.\d+)?$/.test(rate)) {
    throw new InvalidFxRateError('fx rate must be a non-empty decimal string');
  }
  return rate;
}

/** Half away from zero — reversals foot exactly (+2.5→+3, −2.5→−3). */
export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new InvalidFxRateError('fx rate denominator must be non-zero');
  if (numerator >= 0n) {
    return (numerator + denominator / 2n) / denominator;
  }
  return (numerator - denominator / 2n) / denominator;
}

function parseDecimalRate(
  rate: string,
  opts: { allowNegative: boolean },
): { num: bigint; den: bigint } {
  const pattern = opts.allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (typeof rate !== 'string' || rate.length === 0 || !pattern.test(rate)) {
    throw new InvalidTaxRateError('tax rate must be a non-empty non-negative decimal string');
  }
  const negative = rate.startsWith('-');
  const body = negative ? rate.slice(1) : rate;
  const [whole, frac = ''] = body.split('.');
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  return { num: negative ? -num : num, den };
}

function parseFxRate(rate: FxRate): { num: bigint; den: bigint } {
  const validated = validateFxRate(rate);
  return parseDecimalRate(validated, { allowNegative: true });
}

/** Validated non-negative decimal string for tax rates. */
export function validateTaxRate(rate: string): string {
  parseDecimalRate(rate, { allowNegative: false });
  return rate;
}

export function parseTaxRate(rate: string): { num: bigint; den: bigint } {
  validateTaxRate(rate);
  return parseDecimalRate(rate, { allowNegative: false });
}

/** Percentage tax on a minor-unit base — BigInt path, half away from zero. */
export function computeTax(baseMinor: number, rate: string): number {
  if (!Number.isInteger(baseMinor)) {
    throw new InvalidMoneyError('baseMinor must be an integer');
  }
  const { num, den } = parseTaxRate(rate);
  const taxMinor = Number(roundHalfAwayFromZero(BigInt(baseMinor) * num, den));
  if (!Number.isSafeInteger(taxMinor)) {
    throw new InvalidMoneyError('tax amount overflow');
  }
  return taxMinor;
}

export function postToLedger(
  txn: Money<CurrencyCode>,
  ledgerCurrency: CurrencyCode,
  fxRate: string,
  fxRateAt: number,
): PostedLineAmount {
  if (!Number.isFinite(fxRateAt)) {
    throw new InvalidMoneyError('fxRateAt must be a finite number');
  }

  if (txn.currency === ledgerCurrency) {
    const rate = validateFxRate(fxRate);
    if (rate !== '1') {
      throw new InvalidFxRateError('same-currency posting requires fx rate "1"');
    }
    return {
      amountMinor: txn.amountMinor,
      txnCurrency: txn.currency,
      ledgerAmountMinor: txn.amountMinor,
      fxRate: '1',
      fxRateAt,
    };
  }

  const { num, den } = parseFxRate(fxRate);
  if (num === 0n) {
    throw new InvalidFxRateError('fx rate must be non-zero for cross-currency posting');
  }
  const ledgerAmountMinor = Number(
    roundHalfAwayFromZero(BigInt(txn.amountMinor) * num, den),
  );
  if (!Number.isSafeInteger(ledgerAmountMinor)) {
    throw new InvalidMoneyError('ledger amount overflow');
  }

  return {
    amountMinor: txn.amountMinor,
    txnCurrency: txn.currency,
    ledgerAmountMinor,
    fxRate: validateFxRate(fxRate),
    fxRateAt,
  };
}

/** Inverse of `postToLedger` for capture-due partials. Same-currency requires rate `"1"`. */
export function ledgerToTxn(
  ledgerAmountMinor: number,
  txnCurrency: CurrencyCode,
  ledgerCurrency: CurrencyCode,
  fxRate: string,
): number {
  if (!Number.isInteger(ledgerAmountMinor)) {
    throw new InvalidMoneyError('ledgerAmountMinor must be an integer');
  }

  if (txnCurrency === ledgerCurrency) {
    const rate = validateFxRate(fxRate);
    if (rate !== '1') {
      throw new InvalidFxRateError('same-currency posting requires fx rate "1"');
    }
    return ledgerAmountMinor;
  }

  const { num, den } = parseFxRate(fxRate);
  if (num === 0n) {
    throw new InvalidFxRateError('fx rate must be non-zero for cross-currency posting');
  }
  const txnAmountMinor = Number(roundHalfAwayFromZero(BigInt(ledgerAmountMinor) * den, num));
  if (!Number.isSafeInteger(txnAmountMinor)) {
    throw new InvalidMoneyError('txn amount overflow');
  }
  return txnAmountMinor;
}

export function assertPostedMatches(
  input: {
    amountMinor: number;
    txnCurrency: string;
    ledgerAmountMinor: number;
    fxRate: string;
    fxRateAt: number;
  },
  ledgerCurrency: CurrencyCode,
): PostedLineAmount {
  const txn = money(input.amountMinor, currencyCode(input.txnCurrency));
  const posted = postToLedger(txn, ledgerCurrency, input.fxRate, input.fxRateAt);
  if (posted.ledgerAmountMinor !== input.ledgerAmountMinor) {
    throw new LedgerAmountMismatchError();
  }
  return posted;
}

/** Allocate total across weights; remainder per policy. Weights must be positive. */
export function allocate(
  totalMinor: number,
  weights: number[],
  opts?: { policy?: RemainderPolicy },
): number[] {
  if (!Number.isInteger(totalMinor)) throw new InvalidMoneyError('total must be integer');
  if (weights.length === 0) throw new InvalidMoneyError('weights must not be empty');
  for (const w of weights) {
    if (!(w > 0)) throw new InvalidMoneyError('weights must be positive');
  }
  const sum = weights.reduce((a, b) => a + b, 0);

  const parts = weights.map((w) => Math.floor((totalMinor * w) / sum));
  const allocated = parts.reduce((a, b) => a + b, 0);
  const remainder = totalMinor - allocated;
  const policy = opts?.policy ?? 'LAST';
  if (remainder !== 0) {
    const idx = policy === 'FIRST' ? 0 : parts.length - 1;
    parts[idx] = parts[idx]! + remainder;
  }
  return parts;
}

