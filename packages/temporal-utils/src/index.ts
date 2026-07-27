/** Hospitality date types — opaque branded strings, not JS Date across boundaries. */

export type StayDate = string & { readonly __brand: 'StayDate' };
export type BusinessDate = string & { readonly __brand: 'BusinessDate' };

export type Nights = {
  arrival: StayDate;
  departure: StayDate;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function stayDate(value: string): StayDate {
  if (!DATE_RE.test(value)) throw new Error(`Invalid StayDate: ${value}`);
  return value as StayDate;
}

export function businessDate(value: string): BusinessDate {
  if (!DATE_RE.test(value)) throw new Error(`Invalid BusinessDate: ${value}`);
  return value as BusinessDate;
}

export function nights(arrival: StayDate, departure: StayDate): Nights {
  if (departure <= arrival) throw new Error('departure must be after arrival');
  return { arrival, departure };
}

/** Half-open [arrival, departure) night count. */
export function nightCount(range: Nights): number {
  const a = Date.parse(`${range.arrival}T00:00:00Z`);
  const d = Date.parse(`${range.departure}T00:00:00Z`);
  return Math.round((d - a) / 86_400_000);
}
