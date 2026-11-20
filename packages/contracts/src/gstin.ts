/**
 * GSTIN checks (R4.22 D1).
 * State codes 01–38 and 97 are the GSTN / CBIC list
 * (https://www.gst.gov.in — State Code under Search Taxpayer).
 * Check digit: GSTN mod-36 over the first 14 characters.
 * Alphabet `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ`, weights 1 then 2 from the left.
 * Each product folds as `floor(p / 36) + p % 36`.
 * Check digit is `(36 - sum % 36) % 36`.
 */

export const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Official GST state / UT codes, including legacy 25 and 28 and Other Territory 97. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normaliseGstin(s: string): string {
  return s.trim().toUpperCase();
}

/** Check character for the first 14 characters. Caller passes an already-normalised body. */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_ALPHABET.indexOf(first14[i] ?? '');
    const weight = i % 2 === 0 ? 1 : 2;
    const product = code * weight;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[check] ?? '0';
}

/** Append the mod-36 check character. `body14` is normalised by the caller. */
export function gstinWithCheckDigit(body14: string): string {
  return body14 + gstinCheckCharacter(body14);
}

export function gstinStateCode(gstin: string): string {
  return normaliseGstin(gstin).slice(0, 2);
}

export function gstinProblem(s: string): null | 'format' | 'state_code' | 'checksum' {
  const gstin = normaliseGstin(s);
  if (!GSTIN_FORMAT.test(gstin)) return 'format';
  const state = gstin.slice(0, 2);
  if (!(state in GST_STATE_CODES)) return 'state_code';
  const expected = gstinCheckCharacter(gstin.slice(0, 14));
  if (gstin[14] !== expected) return 'checksum';
  return null;
}
