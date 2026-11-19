/**
 * Owner-facing tax amounts. Rates and band limits stay decimal strings
 * until the last step so a typed "2.5" or "7500" never passes through a float.
 */

/** Percent the owner typed ("2.5") → rate fraction the API stores ("0.025"). */
export function percentToFraction(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const scale = frac.length + 2;
  const digits = `${whole}${frac}`.padStart(scale + 1, '0');
  const wholeOut = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
  const fracOut = digits.slice(digits.length - scale).replace(/0+$/, '');
  return fracOut.length > 0 ? `${wholeOut}.${fracOut}` : wholeOut;
}

/** Stored rate fraction ("0.025") → percent for the field ("2.5"). */
export function fractionToPercent(raw: string): string {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length <= 2) {
    const combined = `${whole}${frac}${'0'.repeat(2 - frac.length)}`.replace(/^0+(?=\d)/, '');
    return combined || '0';
  }
  const digits = `${whole}${frac}`;
  const point = digits.length - (frac.length - 2);
  const wholeOut = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  const fracOut = digits.slice(point).replace(/0+$/, '');
  return fracOut.length > 0 ? `${wholeOut}.${fracOut}` : wholeOut;
}

/**
 * Major-unit amount ("7500" or "7500.50") → integer minor units.
 * `exponent` is the currency's minor-unit count (INR 2, JPY 0, BHD 3).
 */
export function majorToMinor(raw: string, exponent: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) return null;
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > exponent) return null;
  const digits = `${whole}${frac.padEnd(exponent, '0')}`.replace(/^0+(?=\d)/, '');
  if (digits.length > 15) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/** Minor units → the major-unit string the owner edits. */
export function minorToMajor(minor: number, exponent: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  if (exponent <= 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, -exponent);
  const frac = digits.slice(-exponent).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/** ISO 4217 minor-unit exponent from Intl. Unknown or missing codes use USD's exponent. */
export function currencyMinorExponent(currency: string | null | undefined): number {
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD';
  const digits = readExponent(code) ?? readExponent('USD');
  return digits ?? 0;
}

function readExponent(currency: string): number | null {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    if (typeof digits === 'number' && digits >= 0 && digits <= 6) return digits;
  } catch {
    return null;
  }
  return null;
}

/** Hidden rule key: slug of the name, plus a short random suffix. `[a-z0-9_]`, at most 40. */
export function ruleKeyFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length] ?? 'a';
  const head = (slug || 'tax').slice(0, 35).replace(/_+$/g, '') || 'tax';
  return `${head}_${suffix}`;
}
