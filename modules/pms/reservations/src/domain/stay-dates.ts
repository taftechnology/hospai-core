const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatUtcParts(y: number, mo: number, d: number): string {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function addCalendarDay(iso: string): string {
  const m = DATE_RE.exec(iso);
  if (!m) throw new Error(`invalid date: ${iso}`);
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return formatUtcParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Calendar nights from `arrival` (inclusive) to `departure` (exclusive). */
export function enumerateStayDates(arrival: string, departure: string): string[] {
  if (arrival >= departure) throw new Error(`invalid stay range: ${arrival}..${departure}`);
  const nights: string[] = [];
  let cur = arrival;
  while (cur < departure) {
    nights.push(cur);
    cur = addCalendarDay(cur);
  }
  return nights;
}
