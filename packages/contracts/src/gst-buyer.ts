import { gstinProblem, gstinStateCode, GST_STATE_CODES, normaliseGstin } from './gstin.js';

/** 4, 6, or 8 digits. */
export const HSN_SAC_PATTERN = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;

/**
 * Charge-code `tax_group` keys: a letter or digit, then up to 31 of the same
 * plus space, dot, slash, underscore, and hyphen (ROOM, GOODS, FNB).
 */
export const TAX_GROUP_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,31}$/;

/**
 * Rule 46 of the CGST Rules asks for the recipient's name and address when the
 * invoice total is ₹50,000 or more. The SPA warns; it does not block.
 * The advisor confirms the threshold. Minor units of INR (paise).
 */
export const UNREGISTERED_BUYER_NAME_ADDRESS_THRESHOLD_MINOR = 5_000_000;

const FIELD_KEYS = [
  'gstin',
  'legalName',
  'tradeName',
  'address',
  'city',
  'state',
  'pin',
  'stateCode',
] as const;

export type GstBuyerFieldKey = (typeof FIELD_KEYS)[number];

export type GstBuyerFields = {
  gstin?: string;
  legalName?: string;
  tradeName?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  stateCode?: string;
};

export type InvoiceBuyerInput = {
  type: 'REGISTERED' | 'UNREGISTERED';
  fields: GstBuyerFields;
};

export type RegisteredBuyerWire = {
  type: 'REGISTERED';
  party: 'BUSINESS';
  fields: GstBuyerFields;
};

export type IndividualBuyerWire = {
  type: 'UNREGISTERED';
  party: 'INDIVIDUAL';
  buyerSnapshotId: string;
  fieldsSha256: string;
};

export type InvoiceBuyerWire = RegisteredBuyerWire | IndividualBuyerWire;

export type GstBuyerError =
  | 'invalid_gstin'
  | 'buyer_gstin_required'
  | 'buyer_state_code_mismatch'
  | 'invalid_hsn_sac'
  | 'validation_error';

const LIMITS: Record<Exclude<GstBuyerFieldKey, 'gstin' | 'pin' | 'stateCode'>, number> = {
  legalName: 100,
  tradeName: 100,
  address: 200,
  city: 60,
  state: 60,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKnownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Stable field object: trimmed, GSTIN uppercased, blanks omitted, fixed key order. */
export function canonicalGstBuyerFields(fields: GstBuyerFields): GstBuyerFields {
  const out: GstBuyerFields = {};
  for (const key of FIELD_KEYS) {
    const raw = fields[key];
    if (typeof raw !== 'string') continue;
    const trimmed = key === 'gstin' ? normaliseGstin(raw) : raw.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }
  return out;
}

export function canonicalGstBuyerJson(fields: GstBuyerFields): string {
  return JSON.stringify(canonicalGstBuyerFields(fields));
}

export async function gstBuyerFieldsSha256(fields: GstBuyerFields): Promise<string> {
  const data = new TextEncoder().encode(canonicalGstBuyerJson(fields));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Retry-stable id: sha256(userId + ':' + idempotencyKey). */
export async function invoiceBuyerSnapshotId(userId: string, idempotencyKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${idempotencyKey}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fieldLengthProblem(fields: GstBuyerFields): GstBuyerError | null {
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const value = fields[key];
    if (value !== undefined && value.length > LIMITS[key]) return 'validation_error';
  }
  if (fields.pin !== undefined && !/^[1-9][0-9]{5}$/.test(fields.pin)) return 'validation_error';
  if (fields.stateCode !== undefined && !(fields.stateCode in GST_STATE_CODES)) return 'validation_error';
  return null;
}

function readFields(raw: unknown): { ok: true; fields: GstBuyerFields } | { ok: false; error: GstBuyerError } {
  if (!isRecord(raw) || !onlyKnownKeys(raw, FIELD_KEYS)) {
    return { ok: false, error: 'validation_error' };
  }
  const draft: GstBuyerFields = {};
  for (const key of FIELD_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== 'string') return { ok: false, error: 'validation_error' };
    draft[key] = value;
  }
  const fields = canonicalGstBuyerFields(draft);
  const length = fieldLengthProblem(fields);
  if (length) return { ok: false, error: length };
  if (fields.gstin) {
    const problem = gstinProblem(fields.gstin);
    if (problem) return { ok: false, error: 'invalid_gstin' };
    if (fields.stateCode && fields.stateCode !== gstinStateCode(fields.gstin)) {
      return { ok: false, error: 'buyer_state_code_mismatch' };
    }
  }
  return { ok: true, fields };
}

/**
 * Invoice buyer. An UNREGISTERED buyer with every field empty is `buyer: null`
 * (same as omitting the buyer).
 */
export function parseInvoiceBuyer(
  input: unknown,
): { ok: true; buyer: InvoiceBuyerInput | null } | { ok: false; error: GstBuyerError } {
  if (!isRecord(input) || !onlyKnownKeys(input, ['type', 'fields'])) {
    return { ok: false, error: 'validation_error' };
  }
  if (input.type !== 'REGISTERED' && input.type !== 'UNREGISTERED') {
    return { ok: false, error: 'validation_error' };
  }
  const read = readFields(input.fields);
  if (!read.ok) return read;
  const fields = read.fields;
  if (input.type === 'UNREGISTERED') {
    if (fields.gstin) return { ok: false, error: 'validation_error' };
    if (Object.keys(fields).length === 0) return { ok: true, buyer: null };
    return { ok: true, buyer: { type: 'UNREGISTERED', fields } };
  }
  if (!fields.gstin) return { ok: false, error: 'buyer_gstin_required' };
  if (!fields.legalName) return { ok: false, error: 'validation_error' };
  if (fields.stateCode !== gstinStateCode(fields.gstin)) {
    return { ok: false, error: 'buyer_state_code_mismatch' };
  }
  return { ok: true, buyer: { type: 'REGISTERED', fields } };
}

/** Guest profile block: same field rules, without REGISTERED-only requirements. */
export function parseProfileGstBuyer(
  input: unknown,
): { ok: true; fields: GstBuyerFields } | { ok: false; error: GstBuyerError } {
  const read = readFields(input);
  if (!read.ok) return read;
  return { ok: true, fields: read.fields };
}

/**
 * City-ledger `gst`. REGISTERED rules apply when `gstin` is present.
 * A block with no remaining fields is stored as null.
 */
export function parseCompanyGst(
  input: unknown,
): { ok: true; gst: GstBuyerFields | null } | { ok: false; error: GstBuyerError } {
  if (input == null) return { ok: true, gst: null };
  const read = readFields(input);
  if (!read.ok) return read;
  const fields = read.fields;
  if (Object.keys(fields).length === 0) return { ok: true, gst: null };
  if (fields.gstin) {
    if (!fields.legalName) return { ok: false, error: 'validation_error' };
    if (fields.stateCode !== gstinStateCode(fields.gstin)) {
      return { ok: false, error: 'buyer_state_code_mismatch' };
    }
  }
  return { ok: true, gst: fields };
}

export function registeredBuyerWire(fields: GstBuyerFields): RegisteredBuyerWire {
  return { type: 'REGISTERED', party: 'BUSINESS', fields: canonicalGstBuyerFields(fields) };
}

export function snapshotBusinessBuyer(fields: GstBuyerFields): {
  type: 'REGISTERED';
  party: 'BUSINESS';
  gstin: string;
  legalName: string;
  tradeName?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  stateCode?: string;
} {
  const f = canonicalGstBuyerFields(fields);
  return {
    type: 'REGISTERED',
    party: 'BUSINESS',
    gstin: f.gstin ?? '',
    legalName: f.legalName ?? '',
    ...(f.tradeName ? { tradeName: f.tradeName } : {}),
    ...(f.address ? { address: f.address } : {}),
    ...(f.city ? { city: f.city } : {}),
    ...(f.state ? { state: f.state } : {}),
    ...(f.pin ? { pin: f.pin } : {}),
    ...(f.stateCode ? { stateCode: f.stateCode } : {}),
  };
}

export function sellerGstinFromRegistrations(value: unknown): { gstin: string | null; stateCode: string | null } {
  if (!Array.isArray(value)) return { gstin: null, stateCode: null };
  const matches = value.filter(
    (row) =>
      isRecord(row) &&
      typeof row.label === 'string' &&
      row.label.trim().toLowerCase() === 'gstin' &&
      typeof row.number === 'string',
  );
  if (matches.length !== 1) return { gstin: null, stateCode: null };
  const number = (matches[0] as { number: string }).number;
  if (gstinProblem(number)) return { gstin: null, stateCode: null };
  const gstin = normaliseGstin(number);
  return { gstin, stateCode: gstinStateCode(gstin) };
}

/** Write-time check for `pms.tax.registrations`. Non-arrays are left to the schema. */
export function sellerRegistrationsGstinError(value: unknown): 'invalid_gstin' | null {
  if (!Array.isArray(value)) return null;
  const matches = value.filter(
    (row) => isRecord(row) && typeof row.label === 'string' && row.label.trim().toLowerCase() === 'gstin',
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) return 'invalid_gstin';
  const number = (matches[0] as { number?: unknown }).number;
  if (typeof number !== 'string' || gstinProblem(number)) return 'invalid_gstin';
  return null;
}

export function parseTaxClassification(
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; error: GstBuyerError } {
  if (!isRecord(value)) return { ok: false, error: 'validation_error' };
  const keys = Object.keys(value);
  if (keys.length > 50) return { ok: false, error: 'validation_error' };
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!TAX_GROUP_KEY_PATTERN.test(key)) return { ok: false, error: 'validation_error' };
    const hsn = value[key];
    if (typeof hsn !== 'string' || !HSN_SAC_PATTERN.test(hsn)) {
      return { ok: false, error: 'invalid_hsn_sac' };
    }
    out[key] = hsn;
  }
  return { ok: true, value: out };
}
