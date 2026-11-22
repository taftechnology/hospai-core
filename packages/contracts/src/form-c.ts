import { z } from 'zod';
import type { CommandError } from './command-error.js';
import { FORM_C_NOT_FOREIGN, VALIDATION_ERROR } from './idempotency.js';

/**
 * Form C tracker (R6.2). India only: a hotel reports each foreign national's arrival
 * to the Bureau of Immigration within 24 hours. HospAI tracks the duty and keeps the
 * person's details sealed in OrgDO; filing itself stays on the government portal.
 */

/** Country in `pms.tax.location.country` for which Form C applies. */
export const FORM_C_COUNTRY = 'IN' as const;

export const FORM_C_KINDS = ['BOOKED_GUEST', 'ADDITIONAL'] as const;
export type FormCKind = (typeof FORM_C_KINDS)[number];

export const FORM_C_KIND_LABELS: Record<FormCKind, string> = {
  BOOKED_GUEST: 'Booked guest',
  ADDITIONAL: 'Additional guest',
};

export const FORM_C_STATUSES = ['TO_FILE', 'FILED', 'REMOVED'] as const;
export type FormCStatus = (typeof FORM_C_STATUSES)[number];

export const FORM_C_STATUS_LABELS: Record<FormCStatus, string> = {
  TO_FILE: 'To file',
  FILED: 'Filed',
  REMOVED: 'Removed',
};

export const FORM_C_REGISTER_FILTERS = ['to_file', 'overdue', 'filed', 'all'] as const;
export type FormCRegisterFilter = (typeof FORM_C_REGISTER_FILTERS)[number];

export const FORM_C_REGISTER_FILTER_LABELS: Record<FormCRegisterFilter, string> = {
  to_file: 'To file',
  overdue: 'Overdue',
  filed: 'Filed',
  all: 'All',
};

/** Rows per reservation, counting every status but REMOVED. */
export const FORM_C_MAX_PER_RESERVATION = 8;
/** Register page cap. */
export const FORM_C_REGISTER_CAP = 200;
/** The legal clock: check-in instant + 24 hours. */
export const FORM_C_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const FORM_C_REMOVE_REASON_MAX = 200;
export const FORM_C_REFERENCE_MAX = 40;
export const FORM_C_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /-]*$/;

/** Deterministic id of the row check-in creates for the booked guest. */
export function formCBookedGuestRecordId(reservationId: string): string {
  return `fcb_${reservationId}`;
}

export function isFormCCountry(country: unknown): boolean {
  return typeof country === 'string' && country.toUpperCase() === FORM_C_COUNTRY;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALPHA2 = /^[A-Z]{2}$/;
const DOC_NUMBER = /^[A-Z0-9 -]{1,40}$/;

export function formCCalendarDateOk(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Key order of the canonical JSON, the portal's order. */
export const FORM_C_FIELD_KEYS = [
  'surname',
  'givenNames',
  'gender',
  'dateOfBirth',
  'nationality',
  'passportNumber',
  'passportPlaceOfIssue',
  'passportIssueDate',
  'passportExpiryDate',
  'visaNumber',
  'visaType',
  'visaPlaceOfIssue',
  'visaIssueDate',
  'visaExpiryDate',
  'arrivedInIndiaOn',
  'portOfArrival',
  'arrivedFrom',
  'arrivedFromCountry',
  'nextDestination',
  'nextDestinationCountry',
  'addressAbroad',
  'contactInIndia',
  'purposeOfVisit',
  'employedInIndia',
  'remarks',
] as const;
export type FormCFieldKey = (typeof FORM_C_FIELD_KEYS)[number];

export const FORM_C_GENDERS = ['F', 'M', 'X'] as const;
export type FormCGender = (typeof FORM_C_GENDERS)[number];

export type FormCPersonFields = {
  surname: string;
  givenNames?: string;
  gender: FormCGender;
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportPlaceOfIssue?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  visaNumber?: string;
  visaType?: string;
  visaPlaceOfIssue?: string;
  visaIssueDate?: string;
  visaExpiryDate?: string;
  arrivedInIndiaOn?: string;
  portOfArrival?: string;
  arrivedFrom?: string;
  arrivedFromCountry?: string;
  nextDestination?: string;
  nextDestinationCountry?: string;
  addressAbroad?: string;
  contactInIndia?: string;
  purposeOfVisit?: string;
  employedInIndia?: boolean;
  remarks?: string;
};

const trimmed = (max: number, min = 0) => z.string().transform((v) => v.trim()).pipe(z.string().min(min).max(max));
const optText = (max: number) => trimmed(max).optional();
const optDate = z.string().regex(CALENDAR_DATE).optional();
const optAlpha2 = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(ALPHA2))
  .optional();
const optDocNumber = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^$|^[A-Z0-9 -]{1,40}$/))
  .optional();

const PersonSchema = z
  .object({
    surname: trimmed(80, 1),
    givenNames: optText(80),
    gender: z.enum(FORM_C_GENDERS),
    dateOfBirth: z.string().regex(CALENDAR_DATE),
    nationality: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.string().regex(ALPHA2)),
    passportNumber: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.string().regex(DOC_NUMBER)),
    passportPlaceOfIssue: optText(80),
    passportIssueDate: optDate,
    passportExpiryDate: optDate,
    visaNumber: optDocNumber,
    visaType: optText(40),
    visaPlaceOfIssue: optText(80),
    visaIssueDate: optDate,
    visaExpiryDate: optDate,
    arrivedInIndiaOn: optDate,
    portOfArrival: optText(80),
    arrivedFrom: optText(80),
    arrivedFromCountry: optAlpha2,
    nextDestination: optText(80),
    nextDestinationCountry: optAlpha2,
    addressAbroad: optText(200),
    contactInIndia: trimmed(20).pipe(z.string().regex(/^[0-9 +()-]*$/)).optional(),
    purposeOfVisit: optText(80),
    employedInIndia: z.boolean().optional(),
    remarks: optText(200),
  })
  .strict();

const DATE_KEYS: readonly FormCFieldKey[] = [
  'dateOfBirth',
  'passportIssueDate',
  'passportExpiryDate',
  'visaIssueDate',
  'visaExpiryDate',
  'arrivedInIndiaOn',
];

function todayUtcPlusSlack(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Strict parse. Trims, upper-cases codes, drops blank optionals and returns the fields in the
 * portal's key order. An Indian nationality is `form_c_not_foreign`. Everything else that is
 * wrong, including an unknown key or an over-long value, is `validation_error`.
 */
export function parseFormCPersonFields(
  raw: unknown,
  now: Date = new Date(),
): { ok: true; fields: FormCPersonFields } | { ok: false; error: CommandError } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  const parsed = PersonSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: VALIDATION_ERROR };
  const data = parsed.data as Record<string, unknown>;
  for (const key of DATE_KEYS) {
    const value = data[key];
    if (value !== undefined && !formCCalendarDateOk(value as string)) {
      return { ok: false, error: VALIDATION_ERROR };
    }
  }
  if ((data.dateOfBirth as string) > todayUtcPlusSlack(now)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  if (data.nationality === 'IN') return { ok: false, error: FORM_C_NOT_FOREIGN };
  const out: Record<string, unknown> = {};
  for (const key of FORM_C_FIELD_KEYS) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value === '') continue;
    out[key] = value;
  }
  return { ok: true, fields: out as FormCPersonFields };
}

/** Stable JSON: fixed key order, blanks omitted. */
export function canonicalFormCJson(fields: FormCPersonFields): string {
  const out: Record<string, unknown> = {};
  for (const key of FORM_C_FIELD_KEYS) {
    const value = (fields as Record<string, unknown>)[key];
    if (value === undefined || value === '') continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

export async function formCFieldsSha256(fields: FormCPersonFields): Promise<string> {
  const data = new TextEncoder().encode(canonicalFormCJson(fields));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formCDisplayName(fields: Pick<FormCPersonFields, 'givenNames' | 'surname'>): string {
  return `${fields.givenNames ?? ''} ${fields.surname}`.trim();
}

/** What a list shows about a person: name and nationality, nothing else. */
export type FormCSummary = { displayName: string; nationality: string };

/** One tracker row on the wire. The name comes from OrgDO and is null when it cannot be read. */
export type FormCRegisterRow = {
  recordId: string;
  reservationId: string;
  kind: FormCKind;
  status: Exclude<FormCStatus, 'REMOVED'>;
  detailsSaved: boolean;
  deadlineAt: number;
  overdue: boolean;
  filedReference: string | null;
  filedAt: number | null;
  displayName: string | null;
  nationality: string | null;
};

export type FormCRegister = { ok: true; rows: FormCRegisterRow[] };

export type FormCReservationList = { ok: true; rows: FormCRegisterRow[] };

/** The audited full read. `fields` is null when details were never saved. */
export type FormCPersonRead = {
  ok: true;
  recordId: string;
  reservationId: string;
  kind: FormCKind;
  status: Exclude<FormCStatus, 'REMOVED'>;
  deadlineAt: number;
  checkedInAt: number | null;
  filedReference: string | null;
  filedAt: number | null;
  fields: FormCPersonFields | null;
};
