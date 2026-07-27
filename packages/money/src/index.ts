/** Integer minor-unit money helpers (no floats). */

export type Money = {
  amountMinor: number;
  currency: string;
};

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error('amountMinor must be an integer');
  }
  if (currency.length !== 3) {
    throw new Error('currency must be ISO 4217');
  }
  return { amountMinor, currency };
}

/** Allocate total across weights; remainder pennies go to the last bucket. */
export function allocate(totalMinor: number, weights: number[]): number[] {
  if (!Number.isInteger(totalMinor)) throw new Error('total must be integer');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('weights must sum > 0');
  const parts = weights.map((w) => Math.floor((totalMinor * w) / sum));
  const allocated = parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1]! += totalMinor - allocated;
  return parts;
}
