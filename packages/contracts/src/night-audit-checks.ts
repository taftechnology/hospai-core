import { z } from 'zod';

/** Configurable night-audit checks. Fixed checks are not in this list. */
export const NIGHT_AUDIT_CHECK_IDS = [
  'arrivals_not_checked_in',
  'departures_not_checked_out',
  'cashier_shift_open',
  'dirty_room_assigned',
  'departed_with_balance',
] as const;
export type NightAuditCheckId = (typeof NIGHT_AUDIT_CHECK_IDS)[number];

/** Always Fail. Rejected by the checks config schema. */
export const NIGHT_AUDIT_FIXED_CHECK_IDS = ['queued_commands', 'open_exceptions'] as const;
export type NightAuditFixedCheckId = (typeof NIGHT_AUDIT_FIXED_CHECK_IDS)[number];

export const NIGHT_AUDIT_CHECK_SEVERITIES = ['off', 'fail', 'warn', 'info'] as const;
export type NightAuditCheckSeverity = (typeof NIGHT_AUDIT_CHECK_SEVERITIES)[number];

const nightAuditCheckSeveritySchema = z.enum(NIGHT_AUDIT_CHECK_SEVERITIES);

/** Strict map: unknown ids (including the two fixed ids) and unknown severities fail. */
export const NightAuditChecksSchema = z
  .object({
    arrivals_not_checked_in: nightAuditCheckSeveritySchema.optional(),
    departures_not_checked_out: nightAuditCheckSeveritySchema.optional(),
    cashier_shift_open: nightAuditCheckSeveritySchema.optional(),
    dirty_room_assigned: nightAuditCheckSeveritySchema.optional(),
    departed_with_balance: nightAuditCheckSeveritySchema.optional(),
  })
  .strict();
export type NightAuditChecks = z.infer<typeof NightAuditChecksSchema>;

export const NIGHT_AUDIT_CHECKS_DEFAULT: { [K in NightAuditCheckId]: 'warn' } = {
  arrivals_not_checked_in: 'warn',
  departures_not_checked_out: 'warn',
  cashier_shift_open: 'warn',
  dirty_room_assigned: 'warn',
  departed_with_balance: 'warn',
};

/** Preview row from `evaluateNightAuditChecksSync` / `readNightAuditStatus`. */
export type NightAuditCheckPreviewRow = {
  checkId: NightAuditCheckId;
  severity: NightAuditCheckSeverity;
  count: number | null;
};

export type NightAuditCheckLogCheck = {
  checkId: NightAuditCheckId | NightAuditFixedCheckId;
  severity: NightAuditCheckSeverity;
  count: number;
};

export type NightAuditCheckLogAttempt = {
  attempt: number;
  checks: NightAuditCheckLogCheck[];
};

export type NightAuditCheckLogDate = {
  businessDate: string;
  attempts: NightAuditCheckLogAttempt[];
};

/** 30 most recent audited business dates, newest first, every attempt for those dates. */
export type NightAuditCheckLog = {
  dates: NightAuditCheckLogDate[];
};
