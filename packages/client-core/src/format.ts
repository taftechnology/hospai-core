/**
 * Property display formats. Intl only — no DOM.
 * Money is minor units ÷ 100, always two decimals, matching the wire and `parseMajorToMinor`.
 */

export type PropertyFormat = {
  locale: string;
  timeZone: string | null;
  currency: string | null;
};

const MINUS = '\u2212';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function propertyFormat(input: {
  timeZone: string | null;
  currency: string | null;
}): PropertyFormat {
  return {
    locale: input.currency === 'INR' ? 'en-IN' : 'en-GB',
    timeZone: input.timeZone,
    currency: input.currency,
  };
}

export const FALLBACK_FORMAT: PropertyFormat = {
  locale: 'en-GB',
  timeZone: null,
  currency: null,
};

function groupedDigits(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(major);
}

function withSign(negative: boolean, text: string): string {
  return negative ? `${MINUS}${text}` : text;
}

function normalizeSpaces(value: string): string {
  return value.replace(/[\u202F\u00A0]/g, ' ');
}

/** Lower-case am/pm and turn narrow or no-break spaces into plain spaces. */
function normalizeTime(value: string): string {
  return normalizeSpaces(value).replace(/\b(AM|PM|A\.M\.|P\.M\.)\b/g, (token) =>
    token.replace(/\./g, '').toLowerCase(),
  );
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

function utcCalendarDate(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  return new Date(`${iso}T00:00:00Z`);
}

export function formatMoney(minor: number, fmt: PropertyFormat, currency?: string): string {
  const negative = minor < 0;
  const major = Math.abs(minor) / 100;
  const resolved = currency !== undefined ? currency : fmt.currency;
  if (resolved == null || resolved === '') {
    return withSign(negative, groupedDigits(major, fmt.locale));
  }
  const sameLedger = resolved === fmt.currency;
  try {
    const formatted = new Intl.NumberFormat(fmt.locale, {
      style: 'currency',
      currency: resolved,
      currencyDisplay: sameLedger ? 'narrowSymbol' : 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
    return withSign(negative, normalizeSpaces(formatted));
  } catch (err) {
    if (err instanceof RangeError) {
      return withSign(negative, `${groupedDigits(major, fmt.locale)} ${resolved}`);
    }
    throw err;
  }
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`, from the string. Anything else passes through. */
export function formatDate(iso: string, _fmt: PropertyFormat): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateHeading(iso: string, fmt: PropertyFormat): string {
  const date = utcCalendarDate(iso);
  if (!date) return iso;
  const parts = new Intl.DateTimeFormat(fmt.locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  return `${part(parts, 'weekday')} ${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
}

export function formatTapeDay(iso: string, fmt: PropertyFormat, withMonth: boolean): string {
  const date = utcCalendarDate(iso);
  if (!date) return iso;
  const parts = new Intl.DateTimeFormat(fmt.locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    ...(withMonth ? { month: 'short' as const } : {}),
  }).formatToParts(date);
  const head = `${part(parts, 'weekday')} ${part(parts, 'day')}`;
  return withMonth ? `${head} ${part(parts, 'month')}` : head;
}

export function formatDateRange(from: string, to: string, fmt: PropertyFormat): string {
  return `${formatDate(from, fmt)} \u2013 ${formatDate(to, fmt)}`;
}

export function formatTime(ms: number, fmt: PropertyFormat): string {
  const formatted = new Intl.DateTimeFormat(fmt.locale, {
    timeZone: fmt.timeZone ?? undefined,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(ms);
  return normalizeTime(formatted);
}

export function formatInstantDate(ms: number, fmt: PropertyFormat): string {
  const parts = new Intl.DateTimeFormat(fmt.locale, {
    timeZone: fmt.timeZone ?? undefined,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(ms);
  return `${part(parts, 'day')}/${part(parts, 'month')}/${part(parts, 'year')}`;
}

export function formatDateTime(ms: number, fmt: PropertyFormat): string {
  return `${formatInstantDate(ms, fmt)}, ${formatTime(ms, fmt)}`;
}
