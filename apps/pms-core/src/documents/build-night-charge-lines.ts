/**
 * Read-only night-charge line builder (R4.13 Part B / B1).
 *
 * Shared by night-audit posting and (later) proforma. Callers load SQL rows and
 * inject read-only `resolveTax` / `chargeCodeActive` callbacks — this module never
 * writes storage.
 */
import {
  inclusionUnits,
  recurringChargeDue,
  type RecurringChargePattern,
} from '@hospai/contracts';

export const NIGHT_AUDIT_LINE_SOURCE = 'NIGHT_AUDIT' as const;
export const INCLUSION_LINE_SOURCE = 'INCLUSION' as const;
export const RECURRING_LINE_SOURCE = 'RECURRING' as const;

export type NightChargeLineSource =
  | typeof NIGHT_AUDIT_LINE_SOURCE
  | typeof INCLUSION_LINE_SOURCE
  | typeof RECURRING_LINE_SOURCE;

export type NightChargeTaxLine = {
  taxRuleId: string;
  componentNo: number;
  outputChargeCode: string;
  amountMinor: number;
};

export type NightChargeLineDraft = {
  folioLineId: string;
  chargeCode: string;
  taxChargeCode: string;
  /** Gross draft amount (rate / inclusion / recurring before inclusive extract). */
  amountMinor: number;
  /**
   * Net after `resolveTax` (same as `postedAtNet` / folio parent). Equals `amountMinor`
   * for exclusive tax; lower for inclusive.
   */
  netLedgerMinor: number;
  bandJoin: boolean;
  source: NightChargeLineSource;
  taxLines: NightChargeTaxLine[];
  /** When set, insert path should pass bandBaseMinor / taxBandBaseMinor (joined slab). */
  bandBaseMinor?: number;
  recurringChargeId?: string;
};

export type NightChargeWarning =
  | 'inclusion_exceeds_rate'
  | 'inclusion_charge_code_inactive'
  | 'recurring_charge_code_inactive'
  | 'no_rate'
  | 'date_outside_stay';

export type NightChargeBuildResult =
  | {
      ok: true;
      roomAmountMinor: number;
      lines: NightChargeLineDraft[];
      warnings: NightChargeWarning[];
    }
  | { ok: false; warning: 'no_rate' | 'inclusion_exceeds_rate' | 'inclusion_charge_code_inactive' };

export type NightChargeInclusionInput = {
  inclusionNo: number;
  chargeCode: string;
  amountMinor: number;
  basis: string;
  priceMode: string;
  inclusionTax: string;
  bandJoin: boolean;
};

export type NightChargeRecurringInput = {
  recurringChargeId: string;
  chargeCode: string;
  unitAmountMinor: number;
  quantity: number;
  pattern: RecurringChargePattern;
  daysMask?: number | null;
  taxChargeCode?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dates?: ReadonlySet<string> | readonly string[] | null;
};

export type ResolveNightChargeTaxInput = {
  chargeCode: string;
  taxChargeCode: string;
  amountMinor: number;
  source: NightChargeLineSource;
  bandBaseMinor?: number;
};

export type ResolveNightChargeTaxResult = {
  netLedgerMinor: number;
  lines: NightChargeTaxLine[];
};

export type BuildNightChargeLinesInput = {
  reservationId: string;
  stayDate: string;
  /** `null` → `{ ok: false, warning: 'no_rate' }`. Ignored when `includeRoomLine` is false. */
  rateMinor: number | null;
  adults: number;
  children: number;
  stay: { arrivalDate: string; departureDate: string };
  inclusions: readonly NightChargeInclusionInput[];
  recurring: readonly NightChargeRecurringInput[];
  /** Read-only tax resolution (same net semantics as prepareChargeTaxSync; must not write). */
  resolveTax: (input: ResolveNightChargeTaxInput) => ResolveNightChargeTaxResult | null;
  chargeCodeActive: (chargeCode: string) => boolean;
  /**
   * When false, skip room + inclusion materialization (recurring-only pass).
   * Default true.
   */
  includeRoomLine?: boolean;
};

type DraftBase = {
  folioLineId: string;
  chargeCode: string;
  taxChargeCode: string;
  amountMinor: number;
  bandJoin: boolean;
  source: NightChargeLineSource;
  recurringChargeId?: string;
};

function resolveTaxLines(
  resolveTax: BuildNightChargeLinesInput['resolveTax'],
  line: DraftBase,
  /** First-pass storeBand decision: pass joined band base only when insert should store it. */
  storeBandBaseMinor?: number,
): { netLedgerMinor: number; taxLines: NightChargeTaxLine[]; bandBaseMinor?: number } {
  const prepared = resolveTax({
    chargeCode: line.chargeCode,
    taxChargeCode: line.taxChargeCode,
    amountMinor: line.amountMinor,
    source: line.source,
    ...(storeBandBaseMinor !== undefined ? { bandBaseMinor: storeBandBaseMinor } : {}),
  });
  return {
    netLedgerMinor: prepared ? prepared.netLedgerMinor : line.amountMinor,
    taxLines: prepared ? prepared.lines : [],
    ...(storeBandBaseMinor !== undefined ? { bandBaseMinor: storeBandBaseMinor } : {}),
  };
}

/**
 * Pure relative to storage: callers pass already-loaded rows + callbacks that MUST NOT write.
 */
export function buildNightChargeLines(input: BuildNightChargeLinesInput): NightChargeBuildResult {
  const includeRoomLine = input.includeRoomLine !== false;
  const warnings: NightChargeWarning[] = [];

  if (includeRoomLine && input.rateMinor === null) {
    return { ok: false, warning: 'no_rate' };
  }

  const roomInclusionDrafts: DraftBase[] = [];
  let roomAmountMinor = 0;

  if (includeRoomLine) {
    const rateMinor = input.rateMinor!;
    let includedMinor = 0;
    for (const row of input.inclusions) {
      const units = inclusionUnits(row.basis, input.adults, input.children);
      if (units <= 0) continue;
      const value = row.amountMinor * units;
      if (row.priceMode === 'INCLUDED') includedMinor += value;
      roomInclusionDrafts.push({
        folioLineId: `${input.reservationId}:inclusion:${row.inclusionNo}:${input.stayDate}`,
        chargeCode: row.chargeCode,
        taxChargeCode: row.inclusionTax === 'ROOM' ? 'ROOM' : row.chargeCode,
        amountMinor: value,
        bandJoin: row.bandJoin || row.inclusionTax === 'ROOM',
        source: INCLUSION_LINE_SOURCE,
      });
    }

    roomAmountMinor = rateMinor - includedMinor;
    if (roomAmountMinor < 0) {
      return { ok: false, warning: 'inclusion_exceeds_rate' };
    }

    for (const line of roomInclusionDrafts) {
      if (!input.chargeCodeActive(line.chargeCode)) {
        return { ok: false, warning: 'inclusion_charge_code_inactive' };
      }
      if (line.taxChargeCode !== line.chargeCode && !input.chargeCodeActive(line.taxChargeCode)) {
        return { ok: false, warning: 'inclusion_charge_code_inactive' };
      }
    }

    const roomLine: DraftBase = {
      folioLineId: `${input.reservationId}:room:${input.stayDate}`,
      chargeCode: 'ROOM',
      taxChargeCode: 'ROOM',
      amountMinor: roomAmountMinor,
      bandJoin: false,
      source: NIGHT_AUDIT_LINE_SOURCE,
    };
    roomInclusionDrafts.unshift(roomLine);

    const anyBand = roomInclusionDrafts.some((line) => line.bandJoin);
    const ownNets = new Map<string, number>();
    if (anyBand) {
      for (const line of roomInclusionDrafts) {
        const prepared = input.resolveTax({
          chargeCode: line.chargeCode,
          taxChargeCode: line.taxChargeCode,
          amountMinor: line.amountMinor,
          source: line.source,
        });
        ownNets.set(line.folioLineId, prepared ? prepared.netLedgerMinor : line.amountMinor);
      }
    }
    const bandBase = anyBand
      ? [...ownNets.values()].reduce((sum, net) => sum + net, 0)
      : undefined;

    const lines: NightChargeLineDraft[] = [];
    for (const line of roomInclusionDrafts) {
      const ownNet = ownNets.get(line.folioLineId);
      const storeBand = bandBase !== undefined && ownNet !== undefined && bandBase !== ownNet;
      const tax = resolveTaxLines(input.resolveTax, line, storeBand ? bandBase : undefined);
      lines.push({
        folioLineId: line.folioLineId,
        chargeCode: line.chargeCode,
        taxChargeCode: line.taxChargeCode,
        amountMinor: line.amountMinor,
        netLedgerMinor: tax.netLedgerMinor,
        bandJoin: line.bandJoin,
        source: line.source,
        taxLines: tax.taxLines,
        ...(storeBand ? { bandBaseMinor: bandBase } : {}),
      });
    }

    // Recurring drafts appended below.
    const recurringLines = materializeRecurring(input, warnings);
    return {
      ok: true,
      roomAmountMinor,
      lines: [...lines, ...recurringLines],
      warnings,
    };
  }

  const recurringLines = materializeRecurring(input, warnings);
  return {
    ok: true,
    roomAmountMinor: 0,
    lines: recurringLines,
    warnings,
  };
}

function materializeRecurring(
  input: BuildNightChargeLinesInput,
  warnings: NightChargeWarning[],
): NightChargeLineDraft[] {
  const lines: NightChargeLineDraft[] = [];
  for (const schedule of input.recurring) {
    const due = recurringChargeDue(
      schedule.pattern,
      {
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        daysMask: schedule.daysMask,
        dates: schedule.dates,
      },
      input.stayDate,
      input.stay,
    );
    if (!due) {
      if (
        schedule.pattern === 'DATES' &&
        (input.stayDate < input.stay.arrivalDate || input.stayDate >= input.stay.departureDate)
      ) {
        warnings.push('date_outside_stay');
      }
      continue;
    }

    const taxChargeCode = schedule.taxChargeCode ?? schedule.chargeCode;
    // Warn but still emit the draft so night-audit posting can record
    // `recurring_charge_code_inactive` against the schedule id (same as today).
    if (
      !input.chargeCodeActive(schedule.chargeCode) ||
      (taxChargeCode !== schedule.chargeCode && !input.chargeCodeActive(taxChargeCode))
    ) {
      warnings.push('recurring_charge_code_inactive');
    }

    const amountMinor = schedule.unitAmountMinor * schedule.quantity;
    const base: DraftBase = {
      folioLineId: `${input.reservationId}:recurring:${schedule.recurringChargeId}:${input.stayDate}`,
      chargeCode: schedule.chargeCode,
      taxChargeCode,
      amountMinor,
      bandJoin: false,
      source: RECURRING_LINE_SOURCE,
      recurringChargeId: schedule.recurringChargeId,
    };
    const tax = resolveTaxLines(input.resolveTax, base);
    lines.push({
      folioLineId: base.folioLineId,
      chargeCode: base.chargeCode,
      taxChargeCode: base.taxChargeCode,
      amountMinor: base.amountMinor,
      netLedgerMinor: tax.netLedgerMinor,
      bandJoin: false,
      source: RECURRING_LINE_SOURCE,
      taxLines: tax.taxLines,
      recurringChargeId: schedule.recurringChargeId,
    });
  }
  return lines;
}
