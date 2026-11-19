import {
  LIMIT_EXCEEDED,
  TAX_INCLUSIVE_COMPOUND_UNSUPPORTED,
  TAX_RULE_TYPE_UNSUPPORTED,
  VALIDATION_ERROR,
} from '@hospai/contracts';
import { allocate, computeTax, resolveTaxes, validateTaxRate, type TaxRuleSpec } from '@hospai/money';

export const TAX_BAND_CAP = 10;
export const TAX_COMPONENT_CAP = 4;
export const TAX_LIVE_RULE_CAP = 20;
export const TAX_DECLARATION_KEY_CAP = 20;

export type TaxBandWrite = {
  upToMinor: number | null;
  components: Array<{ outputChargeCode: string; rate: string }>;
};

export type TaxRuleWrite = {
  priceMode: 'EXCLUSIVE' | 'INCLUSIVE';
  sequence: number;
  base: 'NET' | 'NET_PLUS_PRIOR';
  conditionKey: string | null;
  conditionValue: string | null;
  rebandsOnDiscount: boolean;
  bands: TaxBandWrite[];
  rate: string;
  outputChargeCode: string;
};

export type TaxRuleWriteError =
  | typeof LIMIT_EXCEEDED
  | typeof VALIDATION_ERROR
  | typeof TAX_INCLUSIVE_COMPOUND_UNSUPPORTED
  | typeof TAX_RULE_TYPE_UNSUPPORTED;

export type LoadedTaxComponent = {
  componentNo: number;
  outputChargeCode: string;
  rate: string;
};

export type LoadedTaxRule = {
  taxRuleId: string;
  ruleKey: string;
  priceMode: 'EXCLUSIVE' | 'INCLUSIVE';
  sequence: number;
  base: 'NET' | 'NET_PLUS_PRIOR';
  rebandsOnDiscount: boolean;
  bands: Array<{ upToMinor: number | null; components: LoadedTaxComponent[] }>;
};

export type DiscountTaxLine = {
  taxRuleId: string;
  componentNo: number;
  outputChargeCode: string;
  amountMinor: number;
};

type RawTaxInput = {
  ruleType: string;
  rate?: string;
  outputChargeCode?: string;
  priceMode?: string;
  sequence?: number;
  base?: string;
  conditionKey?: string | null;
  conditionValue?: string | null;
  rebandsOnDiscount?: boolean;
  bands?: Array<{
    upToMinor?: number | null;
    components?: Array<{ outputChargeCode?: string; rate?: string }>;
  }>;
};

function formatRateSum(rates: string[]): string {
  if (rates.length === 1) return rates[0]!;
  const scale = rates.reduce((max, rate) => {
    const frac = rate.split('.')[1] ?? '';
    return Math.max(max, frac.length);
  }, 0);
  const den = 10n ** BigInt(scale);
  let sum = 0n;
  for (const rate of rates) {
    const [whole, frac = ''] = rate.split('.');
    sum += BigInt(whole + frac.padEnd(scale, '0'));
  }
  const negative = sum < 0n;
  const abs = negative ? -sum : sum;
  const whole = abs / den;
  const frac = (abs % den).toString().padStart(scale, '0').replace(/0+$/, '');
  const body = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function normalizeTaxRuleWrite(input: RawTaxInput): { ok: true; write: TaxRuleWrite } | { ok: false; error: TaxRuleWriteError } {
  if (input.ruleType !== 'PERCENTAGE') {
    return { ok: false, error: TAX_RULE_TYPE_UNSUPPORTED };
  }
  const bandsIn = input.bands;
  let bands: TaxBandWrite[];
  if (bandsIn == null) {
    if (!input.rate || !input.outputChargeCode) return { ok: false, error: VALIDATION_ERROR };
    bands = [{ upToMinor: null, components: [{ outputChargeCode: input.outputChargeCode, rate: input.rate }] }];
  } else {
    if (!Array.isArray(bandsIn)) return { ok: false, error: VALIDATION_ERROR };
    if (bandsIn.length > TAX_BAND_CAP) return { ok: false, error: LIMIT_EXCEEDED };
    if (bandsIn.length < 1) return { ok: false, error: VALIDATION_ERROR };
    bands = [];
    for (const band of bandsIn) {
      if (band == null || typeof band !== 'object') return { ok: false, error: VALIDATION_ERROR };
      const componentsIn = band.components ?? [];
      if (!Array.isArray(componentsIn)) return { ok: false, error: VALIDATION_ERROR };
      if (componentsIn.length > TAX_COMPONENT_CAP) return { ok: false, error: LIMIT_EXCEEDED };
      if (componentsIn.length < 1) return { ok: false, error: VALIDATION_ERROR };
      const components = [];
      for (const component of componentsIn) {
        if (component == null || typeof component.outputChargeCode !== 'string' || typeof component.rate !== 'string') {
          return { ok: false, error: VALIDATION_ERROR };
        }
        if (!component.outputChargeCode || !component.rate) return { ok: false, error: VALIDATION_ERROR };
        if (component.outputChargeCode.length > 32) return { ok: false, error: VALIDATION_ERROR };
        try {
          validateTaxRate(component.rate);
        } catch {
          return { ok: false, error: VALIDATION_ERROR };
        }
        components.push({ outputChargeCode: component.outputChargeCode, rate: component.rate });
      }
      const upTo = band.upToMinor ?? null;
      if (upTo != null && (!Number.isInteger(upTo) || upTo <= 0)) return { ok: false, error: VALIDATION_ERROR };
      bands.push({ upToMinor: upTo, components });
    }
  }

  for (let i = 0; i < bands.length; i++) {
    const upTo = bands[i]!.upToMinor;
    const last = i === bands.length - 1;
    if (last) {
      if (upTo != null) return { ok: false, error: VALIDATION_ERROR };
    } else if (upTo == null) {
      return { ok: false, error: VALIDATION_ERROR };
    } else if (i > 0 && upTo <= bands[i - 1]!.upToMinor!) {
      return { ok: false, error: VALIDATION_ERROR };
    }
  }

  const priceMode = input.priceMode ?? 'EXCLUSIVE';
  if (priceMode !== 'EXCLUSIVE' && priceMode !== 'INCLUSIVE') return { ok: false, error: VALIDATION_ERROR };
  const base = input.base ?? 'NET';
  if (base !== 'NET' && base !== 'NET_PLUS_PRIOR') return { ok: false, error: VALIDATION_ERROR };
  if (priceMode === 'INCLUSIVE' && base === 'NET_PLUS_PRIOR') {
    return { ok: false, error: TAX_INCLUSIVE_COMPOUND_UNSUPPORTED };
  }
  const sequence = input.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) return { ok: false, error: VALIDATION_ERROR };
  const conditionKey = input.conditionKey ?? null;
  const conditionValue = input.conditionValue ?? null;
  if ((conditionKey == null) !== (conditionValue == null)) return { ok: false, error: VALIDATION_ERROR };
  if (conditionKey != null && (conditionKey.length < 1 || conditionKey.length > 64)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  if (conditionValue != null && (conditionValue.length < 1 || conditionValue.length > 64)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  const rebandsOnDiscount = input.rebandsOnDiscount ?? true;
  if (typeof rebandsOnDiscount !== 'boolean') return { ok: false, error: VALIDATION_ERROR };

  const first = bands[0]!;
  return {
    ok: true,
    write: {
      priceMode,
      sequence,
      base,
      conditionKey,
      conditionValue,
      rebandsOnDiscount,
      bands,
      rate: bands.length === 1 && first.components.length === 1 ? first.components[0]!.rate : formatRateSum(first.components.map((c) => c.rate)),
      outputChargeCode: first.components[0]!.outputChargeCode,
    },
  };
}

export function taxFolioLineId(parentId: string, taxRuleId: string, component: string): string {
  if (component === '') return `${parentId}:tax:${taxRuleId}`;
  return `${parentId}:tax:${taxRuleId}:${component}`;
}

function toSpec(rule: LoadedTaxRule, band = rule.bands): TaxRuleSpec {
  return {
    taxRuleId: rule.taxRuleId,
    ruleKey: rule.ruleKey,
    priceMode: rule.priceMode,
    sequence: rule.sequence,
    base: rule.base,
    bands: band.map((row) => ({
      upToMinor: row.upToMinor,
      components: row.components.map((component) => ({
        componentNo: component.componentNo,
        rate: component.rate,
      })),
    })),
  };
}

function outputFor(rule: LoadedTaxRule, componentNo: number, bandIndex = 0): string {
  const band = rule.bands[bandIndex] ?? rule.bands[0];
  return band?.components.find((component) => component.componentNo === componentNo)?.outputChargeCode ?? 'TAX';
}

function bandIndexForNet(rule: LoadedTaxRule, net: number): number {
  for (let i = 0; i < rule.bands.length; i++) {
    const prev = i === 0 ? null : rule.bands[i - 1]!.upToMinor;
    const upper = rule.bands[i]!.upToMinor;
    if (prev != null && net <= prev) continue;
    if (upper != null && net > upper) continue;
    return i;
  }
  return rule.bands.length - 1;
}

function scaledComponent(sourceTax: number, discountLedger: number, sourceLedger: number): number {
  if (sourceTax === 0 || discountLedger === 0 || sourceLedger === 0) return 0;
  const sourceAbs = Math.abs(sourceLedger);
  const discountAbs = Math.abs(discountLedger);
  const taxAbs = Math.abs(sourceTax);
  const taxSign = sourceTax < 0 ? -1 : 1;
  const discountSign = discountLedger < 0 ? -1 : 1;
  if (discountAbs >= sourceAbs) return discountSign * taxSign * taxAbs;
  const portion = allocate(taxAbs, [discountAbs, sourceAbs - discountAbs])[0]!;
  return discountSign * taxSign * portion;
}

/**
 * Tax lines for a discount. One-band exclusive rules use `resolveTaxes` on the
 * discount amount, which is `computeTax` per component — the same amounts as the
 * flat stamp. Slab rules re-resolve the remaining net, or scale the stamped tax
 * when the rule says not to re-band.
 */
export function discountTaxLines(input: {
  sourceLedgerMinor: number;
  discountLedgerMinor: number;
  priorDiscountLedgerMinor: number;
  rules: LoadedTaxRule[];
  sourceTax: Array<{ taxRuleId: string; componentNo: number; ledgerMinor: number }>;
  priorDiscountTax: Array<{ taxRuleId: string; componentNo: number; ledgerMinor: number }>;
  /** Remaining joined band base. Selects the slab; the line is still taxed on its own remaining net. */
  bandBaseMinor?: number;
}): DiscountTaxLine[] {
  if (input.rules.length === 0) return [];
  const bandBase =
    input.bandBaseMinor !== undefined ? { bandBaseMinor: input.bandBaseMinor } : {};
  const flatExclusive = input.rules.every(
    (rule) => rule.priceMode === 'EXCLUSIVE' && rule.bands.length === 1,
  );
  if (flatExclusive) {
    const resolved = resolveTaxes({
      grossLedgerMinor: input.discountLedgerMinor,
      grossTxnMinor: input.discountLedgerMinor,
      rules: input.rules.map((rule) => toSpec(rule)),
      ...bandBase,
    });
    return resolved.lines.map((line) => {
      const rule = input.rules.find((candidate) => candidate.taxRuleId === line.taxRuleId)!;
      return {
        taxRuleId: line.taxRuleId,
        componentNo: line.componentNo,
        outputChargeCode: outputFor(rule, line.componentNo),
        amountMinor: line.amountMinor,
      };
    });
  }

  const lines: DiscountTaxLine[] = [];
  const reband = input.rules.filter((rule) => rule.rebandsOnDiscount);
  const fixed = input.rules.filter((rule) => !rule.rebandsOnDiscount);
  const remaining = input.sourceLedgerMinor + input.priorDiscountLedgerMinor + input.discountLedgerMinor;

  if (reband.length > 0) {
    const desired = new Map<string, DiscountTaxLine>();
    const exclusive = reband.filter((rule) => rule.priceMode === 'EXCLUSIVE');
    if (exclusive.length > 0) {
      const resolved = resolveTaxes({
        grossLedgerMinor: remaining,
        grossTxnMinor: remaining,
        rules: exclusive.map((rule) => toSpec(rule)),
        ...bandBase,
      });
      for (const line of resolved.lines) {
        const rule = exclusive.find((candidate) => candidate.taxRuleId === line.taxRuleId)!;
        desired.set(`${line.taxRuleId}:${line.componentNo}`, {
          taxRuleId: line.taxRuleId,
          componentNo: line.componentNo,
          outputChargeCode: outputFor(rule, line.componentNo, bandIndexForNet(rule, remaining)),
          amountMinor: line.amountMinor,
        });
      }
    }
    for (const rule of reband.filter((candidate) => candidate.priceMode === 'INCLUSIVE')) {
      const index = bandIndexForNet(rule, input.bandBaseMinor ?? remaining);
      const band = rule.bands[index]!;
      for (const component of band.components) {
        const amount = computeTax(remaining, component.rate);
        if (amount === 0) continue;
        desired.set(`${rule.taxRuleId}:${component.componentNo}`, {
          taxRuleId: rule.taxRuleId,
          componentNo: component.componentNo,
          outputChargeCode: component.outputChargeCode,
          amountMinor: amount,
        });
      }
    }
    const already = new Map<string, number>();
    for (const row of [...input.sourceTax, ...input.priorDiscountTax]) {
      if (!reband.some((rule) => rule.taxRuleId === row.taxRuleId)) continue;
      const key = `${row.taxRuleId}:${row.componentNo}`;
      already.set(key, (already.get(key) ?? 0) + row.ledgerMinor);
    }
    const keys = new Set([...desired.keys(), ...already.keys()]);
    for (const key of keys) {
      const want = desired.get(key);
      const delta = (want?.amountMinor ?? 0) - (already.get(key) ?? 0);
      if (delta === 0) continue;
      const cut = key.lastIndexOf(':');
      const taxRuleId = key.slice(0, cut);
      const componentNo = Number(key.slice(cut + 1));
      const rule = reband.find((candidate) => candidate.taxRuleId === taxRuleId)!;
      lines.push({
        taxRuleId,
        componentNo,
        outputChargeCode: want?.outputChargeCode ?? outputFor(rule, componentNo),
        amountMinor: delta,
      });
    }
  }

  for (const rule of fixed) {
    for (const row of input.sourceTax) {
      if (row.taxRuleId !== rule.taxRuleId) continue;
      const amount = scaledComponent(row.ledgerMinor, input.discountLedgerMinor, input.sourceLedgerMinor);
      if (amount === 0) continue;
      lines.push({
        taxRuleId: rule.taxRuleId,
        componentNo: row.componentNo,
        outputChargeCode: outputFor(rule, row.componentNo),
        amountMinor: amount,
      });
    }
  }
  return lines;
}
