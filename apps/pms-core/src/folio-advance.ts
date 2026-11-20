/**
 * Advance paid on a stay: the net money received on the GUEST window (payments minus refunds),
 * floored at 0. PAYMENT lines carry a negative ledger amount, so the net is their negated sum.
 * Tax children (`tax_of` set) never count. One rule, shared by the proforma, the tariff-check
 * read and the front-office reports.
 */
export function netAdvancePaidMinor(
  lines: ReadonlyArray<{ charge_code: string; tax_of: string | null; ledger_amount_minor: number }>,
): number {
  let advancePaidMinor = 0;
  for (const row of lines) {
    if (row.charge_code === 'PAYMENT' && row.tax_of == null) {
      advancePaidMinor += -row.ledger_amount_minor;
    }
  }
  return advancePaidMinor < 0 ? 0 : advancePaidMinor;
}
