import { z } from 'zod';
import type { CommandError } from './command-error.js';
import { AADHAAR_FULL_NUMBER_NOT_ALLOWED, VALIDATION_ERROR } from './idempotency.js';

export const GUEST_DOCUMENT_KINDS = [
  'PASSPORT',
  'VISA',
  'NATIONAL_ID',
  'DRIVING_LICENCE',
  'AADHAAR',
  'OTHER',
] as const;
export type GuestDocumentKind = (typeof GUEST_DOCUMENT_KINDS)[number];

export const GUEST_DOCUMENT_KIND_LABELS: Record<GuestDocumentKind, string> = {
  PASSPORT: 'Passport',
  VISA: 'Visa',
  NATIONAL_ID: 'National ID',
  DRIVING_LICENCE: 'Driving licence',
  AADHAAR: 'Aadhaar',
  OTHER: 'Other',
};

export const CONSENT_PURPOSES = [
  'MARKETING_EMAIL',
  'MARKETING_SMS',
  'MARKETING_WHATSAPP',
  'PROFILE_RETENTION',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  MARKETING_EMAIL: 'Marketing email',
  MARKETING_SMS: 'Marketing SMS',
  MARKETING_WHATSAPP: 'Marketing WhatsApp',
  PROFILE_RETENTION: 'Profile retention',
};

export const CONSENT_STATUSES = ['GRANTED', 'WITHDRAWN'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCES = ['DESK', 'REGISTRATION_CARD', 'EMAIL', 'PHONE'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  DESK: 'Desk',
  REGISTRATION_CARD: 'Registration card',
  EMAIL: 'Email',
  PHONE: 'Phone',
};

export const GUEST_DOCUMENTS_MAX = 20;
export const CONSENT_HISTORY_LIMIT = 50;
export const SCAN_MAX_BYTES = 5 * 1024 * 1024;
export const SCAN_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type ScanContentType = (typeof SCAN_CONTENT_TYPES)[number];

export const DOCUMENT_REMOVE_REASON_MAX = 200;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALPHA2 = /^[A-Z]{2}$/;
const DOC_NUMBER = /^[A-Z0-9 -]{1,40}$/;

const optionalDate = z.string().regex(CALENDAR_DATE).optional();
const optionalPlace = z.string().max(80).optional();

const sharedOptional = {
  dateOfBirth: optionalDate,
  issueDate: optionalDate,
  expiryDate: optionalDate,
  placeOfIssue: optionalPlace,
};

const standardFields = z
  .object({
    number: z.string(),
    issuingCountry: z.string(),
    nationality: z.string().optional(),
    visaType: z.string().max(40).optional(),
    ...sharedOptional,
  })
  .strict();

const aadhaarFields = z
  .object({
    numberLast4: z.string().regex(/^\d{4}$/),
    ...sharedOptional,
  })
  .strict();

export type GuestDocumentFields = {
  number?: string;
  numberLast4?: string;
  issuingCountry?: string;
  nationality?: string;
  dateOfBirth?: string;
  issueDate?: string;
  expiryDate?: string;
  placeOfIssue?: string;
  visaType?: string;
};

const NATIONALITY_KINDS = new Set<GuestDocumentKind>(['PASSPORT', 'VISA', 'NATIONAL_ID']);

function calendarDateOk(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseGuestDocumentFields(
  kind: GuestDocumentKind,
  raw: unknown,
): { ok: true; fields: GuestDocumentFields } | { ok: false; error: CommandError } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  const record = raw as Record<string, unknown>;
  if (kind === 'AADHAAR' && 'number' in record && record.number != null && record.number !== '') {
    return { ok: false, error: AADHAAR_FULL_NUMBER_NOT_ALLOWED };
  }

  if (kind === 'AADHAAR') {
    const parsed = aadhaarFields.safeParse(raw);
    if (!parsed.success) return { ok: false, error: VALIDATION_ERROR };
    if (!datesOk(parsed.data)) return { ok: false, error: VALIDATION_ERROR };
    return { ok: true, fields: trimOptional(parsed.data) };
  }

  const parsed = standardFields.safeParse(raw);
  if (!parsed.success) return { ok: false, error: VALIDATION_ERROR };
  const number = parsed.data.number.trim().toUpperCase();
  if (!DOC_NUMBER.test(number)) return { ok: false, error: VALIDATION_ERROR };
  const issuingCountry = parsed.data.issuingCountry.trim().toUpperCase();
  if (!ALPHA2.test(issuingCountry)) return { ok: false, error: VALIDATION_ERROR };
  if (!datesOk(parsed.data)) return { ok: false, error: VALIDATION_ERROR };

  const fields: GuestDocumentFields = { number, issuingCountry };
  if (parsed.data.nationality !== undefined) {
    if (!NATIONALITY_KINDS.has(kind)) return { ok: false, error: VALIDATION_ERROR };
    const nationality = parsed.data.nationality.trim().toUpperCase();
    if (!ALPHA2.test(nationality)) return { ok: false, error: VALIDATION_ERROR };
    fields.nationality = nationality;
  } else if (NATIONALITY_KINDS.has(kind)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  if (parsed.data.visaType !== undefined) {
    if (kind !== 'VISA') return { ok: false, error: VALIDATION_ERROR };
    const visaType = parsed.data.visaType.trim();
    if (visaType.length === 0 || visaType.length > 40) return { ok: false, error: VALIDATION_ERROR };
    fields.visaType = visaType;
  }
  copyDates(parsed.data, fields);
  return { ok: true, fields };
}

function datesOk(data: {
  dateOfBirth?: string;
  issueDate?: string;
  expiryDate?: string;
  placeOfIssue?: string;
}): boolean {
  if (data.dateOfBirth !== undefined && !calendarDateOk(data.dateOfBirth)) return false;
  if (data.issueDate !== undefined && !calendarDateOk(data.issueDate)) return false;
  if (data.expiryDate !== undefined && !calendarDateOk(data.expiryDate)) return false;
  if (data.placeOfIssue !== undefined && data.placeOfIssue.trim().length > 80) return false;
  return true;
}

function copyDates(
  data: { dateOfBirth?: string; issueDate?: string; expiryDate?: string; placeOfIssue?: string },
  fields: GuestDocumentFields,
): void {
  if (data.dateOfBirth) fields.dateOfBirth = data.dateOfBirth;
  if (data.issueDate) fields.issueDate = data.issueDate;
  if (data.expiryDate) fields.expiryDate = data.expiryDate;
  const place = data.placeOfIssue?.trim();
  if (place) fields.placeOfIssue = place;
}

function trimOptional(data: z.infer<typeof aadhaarFields>): GuestDocumentFields {
  const fields: GuestDocumentFields = { numberLast4: data.numberLast4 };
  copyDates(data, fields);
  return fields;
}

export const ConsentWriteSchema = z
  .object({
    purpose: z.enum(CONSENT_PURPOSES),
    status: z.enum(CONSENT_STATUSES),
    source: z.enum(CONSENT_SOURCES),
    idempotencyKey: z.string().min(1),
  })
  .strict();

/** No-decrypt list row from `get_guest_documents`. */
export type GuestDocumentSummary = {
  id: string;
  kind: GuestDocumentKind;
  hasScan: boolean;
  scanContentType: string | null;
  createdAt: number;
};

/** `get_guest_documents` body. `requireIdAtCheckIn` is the org guest setting, read in the same call. */
export type GuestDocumentList = {
  documents: GuestDocumentSummary[];
  requireIdAtCheckIn: boolean;
};

export function maskedDocumentNumber(fields: GuestDocumentFields): string {
  if (fields.numberLast4) return `•••• ${fields.numberLast4}`;
  const number = fields.number ?? '';
  const tail = number.replace(/[^A-Z0-9]/g, '').slice(-4);
  return tail ? `•••• ${tail}` : '••••';
}

export function scanExtension(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'application/pdf') return 'pdf';
  return 'bin';
}
