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

export type PromoKind = 'percent' | 'fixed_per_night';

export type PromoApplyInput =
  | { kind: 'percent'; bps: number }
  | { kind: 'fixed_per_night'; amountMinor: number };

export function applyPromoToAmountMinor(
  amountMinor: number,
  promo: PromoApplyInput,
): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new InvalidMoneyError('amountMinor must be a non-negative integer');
  }
  if (promo.kind === 'percent') {
    const discounted = Number(
      roundHalfAwayFromZero(
        BigInt(amountMinor) * BigInt(10_000 - promo.bps),
        10_000n,
      ),
    );
    if (!Number.isSafeInteger(discounted)) {
      throw new InvalidMoneyError('promo amount overflow');
    }
    return Math.max(0, discounted);
  }
  if (!Number.isInteger(promo.amountMinor) || promo.amountMinor < 0) {
    throw new InvalidMoneyError('amountMinor must be a non-negative integer');
  }
  return Math.max(0, amountMinor - promo.amountMinor);
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

export type TaxPriceMode = 'EXCLUSIVE' | 'INCLUSIVE';
export type TaxBase = 'NET' | 'NET_PLUS_PRIOR';

export type TaxComponentSpec = {
  componentNo: number;
  rate: string;
};

export type TaxBandSpec = {
  /** Inclusive upper bound in ledger minor units. Null means no limit. */
  upToMinor: number | null;
  components: TaxComponentSpec[];
};

export type TaxRuleSpec = {
  taxRuleId: string;
  ruleKey: string;
  priceMode: TaxPriceMode;
  sequence: number;
  base: TaxBase;
  bands: TaxBandSpec[];
};

export type ResolvedTaxLine = {
  taxRuleId: string;
  componentNo: number;
  rate: string;
  amountMinor: number;
};

export type ResolveTaxesInput = {
  /** Charge amount in ledger minor units, before inclusive back-out. */
  grossLedgerMinor: number;
  /** Charge amount in transaction currency. Same as ledger when there is no FX. */
  grossTxnMinor: number;
  rules: TaxRuleSpec[];
  /**
   * When set, band choice uses this amount (R3.3 meal-plan join).
   * Tax is still computed on the charge net. Omitted: band choice uses the net.
   */
  bandBaseMinor?: number;
};

export type ResolveTaxesResult = {
  netLedgerMinor: number;
  netTxnMinor: number;
  lines: ResolvedTaxLine[];
};

type RateParts = { num: bigint; den: bigint };

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x === 0n ? 1n : x;
}

function addRate(a: RateParts, b: RateParts): RateParts {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

function sumRates(rates: string[]): RateParts {
  let acc: RateParts = { num: 0n, den: 1n };
  for (const rate of rates) acc = addRate(acc, parseTaxRate(rate));
  return acc;
}

function backOutNet(grossMinor: number, rate: RateParts): number {
  if (rate.num === 0n) return grossMinor;
  const net = Number(roundHalfAwayFromZero(BigInt(grossMinor) * rate.den, rate.den + rate.num));
  if (!Number.isSafeInteger(net)) throw new InvalidMoneyError('tax amount overflow');
  return net;
}

function bandContains(amount: number, index: number, bands: TaxBandSpec[]): boolean {
  const prev = index === 0 ? null : bands[index - 1]!.upToMinor;
  const upper = bands[index]!.upToMinor;
  if (prev != null && amount <= prev) return false;
  if (upper != null && amount > upper) return false;
  return true;
}

function chooseBand(bands: TaxBandSpec[], amount: number): TaxBandSpec {
  for (let i = 0; i < bands.length; i++) {
    if (bandContains(amount, i, bands)) return bands[i]!;
  }
  return bands[bands.length - 1]!;
}

function rateWeights(rates: string[]): number[] {
  const parsed = rates.map((rate) => parseTaxRate(rate));
  let den = 1n;
  for (const part of parsed) {
    const g = gcdBig(den, part.den);
    den = (den / g) * part.den;
  }
  return parsed.map((part) => {
    const weight = part.num * (den / part.den);
    const asNumber = Number(weight);
    if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
      throw new InvalidMoneyError('tax amount overflow');
    }
    return asNumber;
  });
}

function splitByRate(totalMinor: number, rates: string[]): number[] {
  if (totalMinor === 0) return rates.map(() => 0);
  const weights = rateWeights(rates);
  const sign = totalMinor < 0 ? -1 : 1;
  const parts = allocate(Math.abs(totalMinor), weights);
  return parts.map((part) => sign * part);
}

function netTxnShare(grossTxnMinor: number, netLedgerMinor: number, taxLedgerMinor: number): number {
  if (taxLedgerMinor === 0) return grossTxnMinor;
  if (netLedgerMinor === 0) return 0;
  if (grossTxnMinor === 0) return 0;
  const sign = grossTxnMinor < 0 ? -1 : 1;
  const parts = allocate(Math.abs(grossTxnMinor), [Math.abs(netLedgerMinor), Math.abs(taxLedgerMinor)]);
  const net = sign * parts[0]!;
  if (!Number.isSafeInteger(net)) throw new InvalidMoneyError('tax amount overflow');
  return net;
}

function sortRules(rules: TaxRuleSpec[]): TaxRuleSpec[] {
  return [...rules].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    if (a.ruleKey < b.ruleKey) return -1;
    if (a.ruleKey > b.ruleKey) return 1;
    return 0;
  });
}

/**
 * Pure tax resolution. Exclusive flat one-component rules match `computeTax` on the
 * gross amount and leave that amount as the net. Inclusive rules back out so
 * net + tax = gross exactly, then split the tax with `allocate`.
 */
export function resolveTaxes(input: ResolveTaxesInput): ResolveTaxesResult {
  if (!Number.isInteger(input.grossLedgerMinor) || !Number.isInteger(input.grossTxnMinor)) {
    throw new InvalidMoneyError('baseMinor must be an integer');
  }
  const rules = sortRules(input.rules);
  const inclusive = rules.filter((rule) => rule.priceMode === 'INCLUSIVE');
  const exclusive = rules.filter((rule) => rule.priceMode === 'EXCLUSIVE');
  const slabCount = inclusive.filter((rule) => rule.bands.length > 1).length;
  if (slabCount > 1) throw new InvalidMoneyError('tax_inclusive_slab_conflict');

  const bandOverride = input.bandBaseMinor;
  if (bandOverride !== undefined && !Number.isInteger(bandOverride)) {
    throw new InvalidMoneyError('baseMinor must be an integer');
  }

  let netLedger = input.grossLedgerMinor;
  const lines: ResolvedTaxLine[] = [];

  if (inclusive.length > 0) {
    const fixed = inclusive.filter((rule) => rule.bands.length === 1);
    const slab = inclusive.find((rule) => rule.bands.length > 1) ?? null;
    const fixedRate = sumRates(
      fixed.flatMap((rule) => rule.bands[0]!.components.map((component) => component.rate)),
    );
    let chosenSlab = slab?.bands[0] ?? null;
    if (slab) {
      if (bandOverride !== undefined) {
        chosenSlab = chooseBand(slab.bands, bandOverride);
      } else {
        let picked: TaxBandSpec | null = null;
        for (let i = 0; i < slab.bands.length; i++) {
          const band = slab.bands[i]!;
          const total = addRate(fixedRate, sumRates(band.components.map((component) => component.rate)));
          const net = backOutNet(input.grossLedgerMinor, total);
          if (bandContains(net, i, slab.bands)) {
            picked = band;
            break;
          }
        }
        if (!picked) {
          const highest = slab.bands[slab.bands.length - 1]!;
          const high = addRate(fixedRate, sumRates(highest.components.map((component) => component.rate)));
          const netHigh = backOutNet(input.grossLedgerMinor, high);
          picked =
            slab.bands.find((band) => band.upToMinor == null || band.upToMinor >= netHigh) ?? highest;
        }
        chosenSlab = picked;
      }
    }

    const chosen: Array<{ taxRuleId: string; componentNo: number; rate: string }> = [];
    for (const rule of inclusive) {
      const band = rule.bands.length > 1 ? chosenSlab! : rule.bands[0]!;
      for (const component of [...band.components].sort((a, b) => a.componentNo - b.componentNo)) {
        chosen.push({
          taxRuleId: rule.taxRuleId,
          componentNo: component.componentNo,
          rate: component.rate,
        });
      }
    }
    const totalRate = sumRates(chosen.map((component) => component.rate));
    netLedger = backOutNet(input.grossLedgerMinor, totalRate);
    const taxTotal = input.grossLedgerMinor - netLedger;
    const positive = chosen.filter((component) => parseTaxRate(component.rate).num > 0n);
    const shares =
      positive.length === 0 || taxTotal === 0
        ? []
        : splitByRate(
            taxTotal,
            positive.map((component) => component.rate),
          );
    positive.forEach((component, index) => {
      const amount = shares[index] ?? 0;
      if (amount === 0) return;
      lines.push({
        taxRuleId: component.taxRuleId,
        componentNo: component.componentNo,
        rate: component.rate,
        amountMinor: amount,
      });
    });
  }

  // NET_PLUS_PRIOR adds only exclusive tax from rules with a LOWER sequence (spec §2.1).
  const exclusiveBySequence: Array<{ sequence: number; amountMinor: number }> = [];
  for (const rule of exclusive) {
    const bandAmount = bandOverride !== undefined ? bandOverride : netLedger;
    const band = chooseBand(rule.bands, bandAmount);
    const prior = exclusiveBySequence
      .filter((entry) => entry.sequence < rule.sequence)
      .reduce((sum, entry) => sum + entry.amountMinor, 0);
    const base = rule.base === 'NET_PLUS_PRIOR' ? netLedger + prior : netLedger;
    for (const component of [...band.components].sort((a, b) => a.componentNo - b.componentNo)) {
      const amount = computeTax(base, component.rate);
      exclusiveBySequence.push({ sequence: rule.sequence, amountMinor: amount });
      if (amount === 0) continue;
      lines.push({
        taxRuleId: rule.taxRuleId,
        componentNo: component.componentNo,
        rate: component.rate,
        amountMinor: amount,
      });
    }
  }

  const inclusiveTax = input.grossLedgerMinor - netLedger;
  return {
    netLedgerMinor: netLedger,
    netTxnMinor: netTxnShare(input.grossTxnMinor, netLedger, inclusiveTax),
    lines,
  };
}

