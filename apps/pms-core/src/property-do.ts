import { DurableObject } from 'cloudflare:workers';
import {
  ARCHIVE_BLOCKED,
  BUSINESS_DATE_CLOSED,
  BUSINESS_DATE_UNSET,
  PENDING_CENSUS_REQUIRED,
  PENDING_COMMANDS_UNDRAINED,
  PROVISIONAL_EXCEPTIONS_OPEN,
  domainConfigKeys,
  getConfigEntry,
  requiredPermissionForKey,
  IDEM_KEY_REUSED,
  HOLD_EXPIRED,
  INQUIRY_EXPIRED,
  OCCUPANCY_EXCEEDED,
  NOT_FOUND,
  NO_AVAILABILITY,
  OVERSELL,
  PROPERTY_ID_UNSET,
  ROOM_TYPE_EXISTS,
  ROOM_TYPE_CODE_EXISTS,
  TIMEZONE_UNSET,
  UNBOOKABLE,
  ALREADY_CANCELLED,
  LEDGER_INCONSISTENT,
  NOT_MODIFIABLE,
  INVALID_STATUS_TRANSITION,
  NO_SHOW_BEFORE_ARRIVAL,
  RESTRICTION_VIOLATED,
  RATE_MISSING,
  ROOM_OUT_OF_ORDER,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_UNITS_EXCEED_COUNT,
  ROOM_TYPE_MISMATCH,
  ROOM_ALREADY_ASSIGNED,
  ROOM_NOT_ASSIGNABLE,
  RATE_PLAN_NOT_FOUND,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  DEFAULT_RATE_PLAN_PROTECTED,
  CHARGE_CODE_NOT_FOUND,
  CHARGE_CODE_EXISTS,
  SYSTEM_CHARGE_CODE_PROTECTED,
  TAX_RULE_NOT_FOUND,
  TAX_RULE_KEY_EXISTS,
  TAX_RULE_KEY_OVERLAP,
  TAX_RULE_TYPE_UNSUPPORTED,
  TAX_OUTPUT_CODE_TAXABLE,
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  FX_RATE_INVALID,
  LEDGER_AMOUNT_MISMATCH,
  MONEY_INVALID,
  CURRENCY_UNSET,
  CROSS_CURRENCY_UNSUPPORTED,
  SPLIT_AMOUNT_MISMATCH,
  LINE_NOT_SPLITTABLE,
  PSP_UNAVAILABLE,
  PAYMENT_NOT_CAPTURABLE,
  SHIFT_NOT_FOUND,
  SHIFT_ALREADY_OPEN,
  SHIFT_NOT_OPEN,
  FORBIDDEN,
  GUEST_NOT_FOUND,
  GUEST_ALREADY_ERASED,
  STAFF_EXITED,
  STAFF_NOT_ASSIGNABLE,
  STAFF_NOT_FOUND,
  ROLE_GRANTS,
  fingerprintPayload,
  isStaffRef,
  type ActorContext,
  type EventSource,
  type IdempotencyKey,
  type ModuleTxnCtx,
  type Permission,
  type ProvisionalCommand,
  type ProvisionalContext,
  type ProvisionalExceptionRow,
} from '@hospai/contracts';
import {
  assignHousekeeping,
  bulkUpdateRoomStatus,
  HousekeepingRoomNotFoundError,
  InvalidAssigneeRefError,
  isRoomStatus,
  readAssignments,
  updateRoomStatus,
} from '@hospai/pms-housekeeping';
import { assertEntitled, EntitlementDoCache, PermissionDoCache } from '@hospai/entitlement-client';
import {

  PROPERTY_MIGRATIONS,
  appendOutbox,
  ackOutboxThrough as ackOutboxThroughSql,
  AlarmScheduler,
  drainOutbox,
  freeAvailability,
  LaneGuard,
  type LaneGuardOptions,
  migrateSql,
  outboxBacklogSnapshot,
  runIdempotent,
  IdempotencyKeyReused,
  TYPE_WIDE_RATE_PLAN,
  DEFAULT_RATE_PLAN_ID,
  SYSTEM_CHARGE_CODES,
  toQueueBatchEntry,
  OUTBOX_BACKLOG_DELAY_MS,
  OUTBOX_SWEEP_INTERVAL_MS,
  type OutboxRow,
  type SqlStorageLike,
} from '@hospai/do-runtime';
import {
  archiveBlocked,
  enumerateFromDate,
  enumerateHorizonDates,
  HORIZON_DAYS,
  oversellDates,
  type InventoryRow,
} from '@hospai/pms-inventory';
import {
  enumerateStayDates,
  firstUnavailableNight,
  type AvailabilitySnapshot,
} from '@hospai/pms-reservations';
import {
  firstRestrictionViolation,
  type RestrictionRow,
} from '@hospai/pms-restrictions';
import { quoteStay } from '@hospai/pms-rates';
import { UndeclaredConfigError, validateConfigWrite } from '@hospai/kernel';
import { assertJurisdictionMatch, resolveOrgStub, type Jurisdiction } from '@hospai/tenant-router';
import {
  allocate,
  assertPostedMatches,
  computeTax,
  currencyCode,
  InvalidFxRateError,
  InvalidMoneyError,
  LedgerAmountMismatchError,
  roundHalfAwayFromZero,
  type CurrencyCode,
  type PostedLineAmount,
} from '@hospai/money';
import { isJurisdictionSimulate, isPspSimulate, type PmsEnv } from './env.js';
import {
  simulateAuthorize,
  simulateCapture,
  type PspSimulateOutcome,
} from './psp-simulate.js';
import type { OrgDO } from './org-do.js';
import {
  isOrgDoTransportFailure,
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
} from './org-do-transport.js';
import { PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE } from './property-do-transport.js';
import { runOutboxAlarmStep, type OutboxAlarmContext, type OutboxFlushResult } from './outbox-observability.js';
import { hasEventLogR2, reportObjectKey } from './event-log.js';

type PaymentStatus = 'pending' | 'authorized' | 'declined' | 'captured' | 'unknown';

type PaymentRow = {
  payment_id: string;
  reservation_id: string;
  folio_window_id: string;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  gateway_reference: string | null;
  captured_amount_minor: number | null;
  idempotency_key: string;
  request_fingerprint: string;
  capture_fingerprint: string | null;
  tender_type: 'CARD' | 'CASH';
  shift_id: string | null;
  created_at: number;
  updated_at: number;
};

type ShiftStatus = 'OPEN' | 'CLOSED' | 'FORCE_CLOSED';

type ShiftRow = {
  shift_id: string;
  cashier_user_id: string;
  business_date: string;
  opened_at: number;
  closed_at: number | null;
  opening_float: number;
  closing_count: number | null;
  variance: number | null;
  status: ShiftStatus;
  created_at: number;
  updated_at: number;
};

/**
 * Intra-isolate control flow only, same pattern as `IdempotencyKeyReused`:
 * thrown *inside* a `runIdempotent` execute callback so the precondition
 * failure rolls back the transaction instead of being cached under the
 * idempotency key. Caught at the PropertyDO try* boundary and mapped to a
 * wire code — never `instanceof`-checked across a DO stub.
 */
class RoomTypeNotFoundError extends Error {
  constructor() {
    super('Room type not found or not active');
    this.name = 'RoomTypeNotFoundError';
  }
}

class RoomTypeExistsError extends Error {
  constructor() {
    super('Room type already exists');
    this.name = 'RoomTypeExistsError';
  }
}

class RoomTypeCodeExistsError extends Error {
  constructor() {
    super('Active room type code already exists');
    this.name = 'RoomTypeCodeExistsError';
  }
}

class OversellError extends Error {
  constructor(public readonly dates: string[]) {
    super('Lowering room_count would oversell committed demand');
    this.name = 'OversellError';
  }
}

class ArchiveBlockedError extends Error {
  constructor() {
    super('Room type has committed future demand and cannot be archived');
    this.name = 'ArchiveBlockedError';
  }
}

class NoAvailabilityError extends Error {
  constructor(public readonly date: string) {
    super(`No availability on ${date}`);
    this.name = 'NoAvailabilityError';
  }
}

class UnbookableError extends Error {
  constructor(public readonly date: string) {
    super(`Unbookable night ${date}`);
    this.name = 'UnbookableError';
  }
}

class RestrictionViolatedError extends Error {
  constructor(
    public readonly rule: string,
    public readonly date: string,
    public readonly required?: number,
  ) {
    super(`Restriction violated: ${rule}`);
    this.name = 'RestrictionViolatedError';
  }
}

class LedgerInconsistentError extends Error {
  constructor(public readonly date: string) {
    super(`Ledger inconsistent on ${date}`);
    this.name = 'LedgerInconsistentError';
  }
}

class ProvisionalBusinessDateClosedError extends Error {
  constructor(
    public readonly businessDate: string,
    public readonly openDate: string,
  ) {
    super(`Business date ${businessDate} closed; open date is ${openDate}`);
    this.name = 'ProvisionalBusinessDateClosedError';
  }
}

class RateMissingError extends Error {
  constructor(public readonly date: string) {
    super(`${RATE_MISSING} for ${date}`);
    this.name = 'RateMissingError';
  }
}

class PendingCensusRequiredError extends Error {
  constructor() {
    super(PENDING_CENSUS_REQUIRED);
    this.name = 'PendingCensusRequiredError';
  }
}

class PendingCommandsUndrainedError extends Error {
  constructor() {
    super(PENDING_COMMANDS_UNDRAINED);
    this.name = 'PendingCommandsUndrainedError';
  }
}

class ProvisionalExceptionsOpenError extends Error {
  constructor() {
    super(PROVISIONAL_EXCEPTIONS_OPEN);
    this.name = 'ProvisionalExceptionsOpenError';
  }
}

class RatePlanNotFoundError extends Error {
  constructor() {
    super('Rate plan not found');
    this.name = 'RatePlanNotFoundError';
  }
}

class RatePlanCodeExistsError extends Error {
  constructor() {
    super('Rate plan code already exists');
    this.name = 'RatePlanCodeExistsError';
  }
}

class RatePlanIdExistsError extends Error {
  constructor() {
    super('Rate plan id already exists');
    this.name = 'RatePlanIdExistsError';
  }
}

class DefaultRatePlanProtectedError extends Error {
  constructor() {
    super('Default rate plan is protected');
    this.name = 'DefaultRatePlanProtectedError';
  }
}

class ChargeCodeNotFoundError extends Error {
  constructor() {
    super(CHARGE_CODE_NOT_FOUND);
    this.name = 'ChargeCodeNotFoundError';
  }
}

class ChargeCodeExistsError extends Error {
  constructor() {
    super(CHARGE_CODE_EXISTS);
    this.name = 'ChargeCodeExistsError';
  }
}

class SystemChargeCodeProtectedError extends Error {
  constructor() {
    super(SYSTEM_CHARGE_CODE_PROTECTED);
    this.name = 'SystemChargeCodeProtectedError';
  }
}

class TaxRuleNotFoundError extends Error {
  constructor() {
    super(TAX_RULE_NOT_FOUND);
    this.name = 'TaxRuleNotFoundError';
  }
}

class TaxRuleKeyExistsError extends Error {
  constructor() {
    super(TAX_RULE_KEY_EXISTS);
    this.name = 'TaxRuleKeyExistsError';
  }
}

class TaxRuleKeyOverlapError extends Error {
  constructor() {
    super(TAX_RULE_KEY_OVERLAP);
    this.name = 'TaxRuleKeyOverlapError';
  }
}

class TaxRuleTypeUnsupportedError extends Error {
  constructor() {
    super(TAX_RULE_TYPE_UNSUPPORTED);
    this.name = 'TaxRuleTypeUnsupportedError';
  }
}

class TaxOutputCodeTaxableError extends Error {
  constructor() {
    super(TAX_OUTPUT_CODE_TAXABLE);
    this.name = 'TaxOutputCodeTaxableError';
  }
}

class ShiftNotFoundError extends Error {
  constructor() {
    super(SHIFT_NOT_FOUND);
    this.name = 'ShiftNotFoundError';
  }
}

class ShiftAlreadyOpenError extends Error {
  constructor() {
    super(SHIFT_ALREADY_OPEN);
    this.name = 'ShiftAlreadyOpenError';
  }
}

class ShiftNotOpenError extends Error {
  constructor() {
    super(SHIFT_NOT_OPEN);
    this.name = 'ShiftNotOpenError';
  }
}

class RoomCodeExistsError extends Error {
  constructor() {
    super('Room code already exists');
    this.name = 'RoomCodeExistsError';
  }
}

class RoomCountExceededError extends Error {
  constructor() {
    super('Room count would exceed room_type.room_count');
    this.name = 'RoomCountExceededError';
  }
}

class RoomUnitsExceedCountError extends Error {
  constructor() {
    super('room_count below existing room unit count');
    this.name = 'RoomUnitsExceedCountError';
  }
}

class RoomTypeMismatchError extends Error {
  constructor() {
    super('Room type does not match reservation');
    this.name = 'RoomTypeMismatchError';
  }
}

class RoomAlreadyAssignedError extends Error {
  constructor() {
    super('Room already assigned to an overlapping reservation');
    this.name = 'RoomAlreadyAssignedError';
  }
}

class RoomNotAssignableError extends Error {
  constructor() {
    super('Reservation status does not allow room assignment');
    this.name = 'RoomNotAssignableError';
  }
}

class RoomNotFoundError extends Error {
  constructor() {
    super('Room not found');
    this.name = 'RoomNotFoundError';
  }
}

class OccupancyExceededError extends Error {
  constructor() {
    super(OCCUPANCY_EXCEEDED);
    this.name = 'OccupancyExceededError';
  }
}

class HoldExpiredError extends Error {
  constructor() {
    super(HOLD_EXPIRED);
    this.name = 'HoldExpiredError';
  }
}

class InquiryExpiredError extends Error {
  constructor() {
    super(INQUIRY_EXPIRED);
    this.name = 'InquiryExpiredError';
  }
}

class RoomOutOfOrderError extends Error {
  constructor() {
    super(ROOM_OUT_OF_ORDER);
    this.name = 'RoomOutOfOrderError';
  }
}

class InvalidCancelPolicyError extends Error {
  constructor() {
    super('invalid_cancel_policy');
    this.name = 'InvalidCancelPolicyError';
  }
}

const STAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CANCEL_PENALTY_TYPES = ['none', 'first_night', 'nights', 'percent', 'full'] as const;
type CancelPenaltyType = (typeof CANCEL_PENALTY_TYPES)[number];

function isCancelPenaltyType(value: string): value is CancelPenaltyType {
  return (CANCEL_PENALTY_TYPES as readonly string[]).includes(value);
}

/** UTC instant of local midnight for `ymd` in `timeZone`. */
function zonedMidnightMs(ymd: string, timeZone: string): number {
  const [ys, ms, ds] = ymd.split('-');
  const utcGuess = Date.UTC(Number(ys), Number(ms) - 1, Number(ds), 0, 0, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const asUtcFromZoned = (instant: number): number => {
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };
  const guess = utcGuess - (asUtcFromZoned(utcGuess) - utcGuess);
  return utcGuess - (asUtcFromZoned(guess) - guess);
}

type RatePlanPolicyFields = {
  cancelPenaltyType: string;
  cancelGraceHours: number;
  cancelPenaltyNights: number | null;
  cancelPenaltyBps: number | null;
  cancelPolicyText: string | null;
};

function normalizeRatePlanPolicy(
  input: {
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    cancelPolicyText?: string | null;
  },
  existing?: RatePlanPolicyFields,
): RatePlanPolicyFields {
  const type = input.cancelPenaltyType ?? existing?.cancelPenaltyType ?? 'none';
  if (!isCancelPenaltyType(type)) throw new InvalidCancelPolicyError();
  const grace = input.cancelGraceHours ?? existing?.cancelGraceHours ?? 0;
  if (!Number.isInteger(grace) || grace < 0 || grace > 8760) throw new InvalidCancelPolicyError();
  let nights: number | null = null;
  let bps: number | null = null;
  if (type === 'nights') {
    nights = input.cancelPenaltyNights !== undefined ? input.cancelPenaltyNights : (existing?.cancelPenaltyNights ?? null);
    if (nights == null || !Number.isInteger(nights) || nights < 1 || nights > 30) {
      throw new InvalidCancelPolicyError();
    }
  } else if (type === 'percent') {
    bps = input.cancelPenaltyBps !== undefined ? input.cancelPenaltyBps : (existing?.cancelPenaltyBps ?? null);
    if (bps == null || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
      throw new InvalidCancelPolicyError();
    }
  }
  const text =
    input.cancelPolicyText !== undefined ? input.cancelPolicyText : (existing?.cancelPolicyText ?? null);
  return {
    cancelPenaltyType: type,
    cancelGraceHours: grace,
    cancelPenaltyNights: nights,
    cancelPenaltyBps: bps,
    cancelPolicyText: text,
  };
}

function mapReservationPreconditionError(e: unknown):
  | { ok: false; error: typeof IDEM_KEY_REUSED }
  | { ok: false; error: typeof NOT_FOUND }
  | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
  | { ok: false; error: typeof NO_AVAILABILITY; date: string }
  | { ok: false; error: typeof UNBOOKABLE; date: string }
  | {
      ok: false;
      error: typeof RESTRICTION_VIOLATED;
      rule: string;
      date: string;
      required?: number;
    }
  | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
  | { ok: false; error: typeof HOLD_EXPIRED }
  | { ok: false; error: typeof INQUIRY_EXPIRED }
  | { ok: false; error: typeof OCCUPANCY_EXCEEDED }
  | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
  | { ok: false; error: typeof RATE_MISSING; date: string }
  | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
  | null {
  if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
  if (e instanceof ProvisionalBusinessDateClosedError) {
    return { ok: false, error: BUSINESS_DATE_CLOSED };
  }
  if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
  if (e instanceof NoAvailabilityError) return { ok: false, error: NO_AVAILABILITY, date: e.date };
  if (e instanceof UnbookableError) return { ok: false, error: UNBOOKABLE, date: e.date };
  if (e instanceof RestrictionViolatedError) {
    return {
      ok: false,
      error: RESTRICTION_VIOLATED,
      rule: e.rule,
      date: e.date,
      ...(e.required !== undefined ? { required: e.required } : {}),
    };
  }
  if (e instanceof LedgerInconsistentError) {
    return { ok: false, error: LEDGER_INCONSISTENT, date: e.date };
  }
  if (e instanceof HoldExpiredError) return { ok: false, error: HOLD_EXPIRED };
  if (e instanceof InquiryExpiredError) return { ok: false, error: INQUIRY_EXPIRED };
  if (e instanceof OccupancyExceededError) return { ok: false, error: OCCUPANCY_EXCEEDED };
  if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
  if (e instanceof RateMissingError) return { ok: false, error: RATE_MISSING, date: e.date };
  if (e instanceof RoomOutOfOrderError) return { ok: false, error: ROOM_OUT_OF_ORDER };
  return null;
}

export const NIGHT_AUDIT_HALTED = 'night_audit_halted' as const;
export const NIGHT_AUDIT_RETRY_STEP_COMMAND = 'night_audit.retry_step' as const;
export const NIGHT_AUDIT_RESOLVE_HALT_COMMAND = 'night_audit.resolve_halt' as const;
export const PROVISIONAL_RESOLVE_EXCEPTION_COMMAND = 'provisional.resolve_exception' as const;

/** §8 night-audit step sequence. `ROLL_BUSINESS_DATE` is the only step that mutates `__meta.business_date` / the horizon. */
export const NIGHT_AUDIT_STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;

export type NightAuditStep = (typeof NIGHT_AUDIT_STEPS)[number];

/** Caller-passes-census — PropertyDO never reads PLATFORM_DB. Required for PRE_CHECK. */
export type NightAuditCensus = { pendingOpenCount: number };

/**
 * Set-reconcile `availability_day` to `[businessDate, businessDate + (HORIZON_DAYS - 1)]`
 * for every *active* room type: INSERT missing dates only, at `physical = room_type.room_count`
 * (all other columns default 0). New rows get `oversell = ledgerOversell` (materialized
 * from DOMAIN config at write time). Never overwrites an existing row's `physical` /
 * `sold` / `held` / `blocked` / `oversell`, and never inserts for an archived type.
 * Idempotent — re-running with the same `businessDate` on an already-reconciled horizon
 * inserts nothing.
 */
export function reconcileHorizon(
  sql: SqlStorageLike,
  businessDate: string,
  ledgerOversell: number,
): { insertedCount: number; fromDate: string; toDate: string } {
  const required = enumerateFromDate(businessDate, HORIZON_DAYS);
  const fromDate = required[0]!;
  const toDate = required[required.length - 1]!;

  const activeRoomTypes = sql
    .exec(`SELECT room_type_id, room_count FROM room_type WHERE status = 'active'`)
    .toArray() as Array<{ room_type_id: string; room_count: number }>;

  let insertedCount = 0;
  for (const rt of activeRoomTypes) {
    const existingRows = sql
      .exec(
        `SELECT stay_date FROM availability_day WHERE room_type_id = ? AND stay_date >= ? AND stay_date <= ?`,
        rt.room_type_id,
        fromDate,
        toDate,
      )
      .toArray() as Array<{ stay_date: string }>;
    const existingDates = new Set(existingRows.map((r) => r.stay_date));

    for (const stayDate of required) {
      if (existingDates.has(stayDate)) continue;
      sql.exec(
        `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
         VALUES (?, ?, ?, 0, 0, 0, ?, 1)`,
        rt.room_type_id,
        stayDate,
        rt.room_count,
        ledgerOversell,
      );
      insertedCount += 1;
    }
  }

  return { insertedCount, fromDate, toDate };
}

/**
 * Offset (ms) such that `atMs + offset` equals the wall-clock instant `atMs`
 * formatted in `timeZone`, reinterpreted as UTC. Standard technique for
 * converting a zoned wall-clock time to an epoch without a TZ database library.
 */
function timeZoneOffsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asIfUtc - atMs;
}

/** Epoch ms for `HH:MM` wall-clock time on `dateStr` (YYYY-MM-DD) in `timeZone`. */
function zonedWallTimeToEpochMs(timeZone: string, dateStr: string, hh: number, mm: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const asUtcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0);
  const offset = timeZoneOffsetMs(timeZone, asUtcGuess);
  return asUtcGuess - offset;
}

/** Next occurrence at or after `instant` of `auditTime` ("HH:MM") in `timeZone`, as epoch ms. */
function nextAuditRunAtMs(timeZone: string, auditTime: string, instant: Date): number {
  const [hh, mm] = auditTime.split(':').map(Number);
  const today = enumerateHorizonDates(timeZone, instant, 1)[0]!;
  const candidate = zonedWallTimeToEpochMs(timeZone, today, hh!, mm!);
  if (candidate > instant.getTime()) return candidate;
  const tomorrow = enumerateFromDate(today, 2)[1]!;
  return zonedWallTimeToEpochMs(timeZone, tomorrow, hh!, mm!);
}

/** Fixed inventory for VERIFY — DO SQLite forbids dynamic table identifiers (SQLITE_AUTH). */
const PROPERTY_PURGE_INVENTORY_TABLES = [
  'alarm_schedule',
  'audit_log',
  'availability_day',
  'charge_code',
  'folio_line',
  'folio_window',
  'housekeeping_assignment',
  'idempotency',
  'night_audit_report',
  'night_audit_run',
  'outbox',
  'payment',
  'property_config',
  'property_config_audit',
  'provisional_exception',
  'rate_day',
  'rate_plan',
  'reservation',
  'restriction_day',
  'room',
  'room_type',
  'shift',
  'tax_rule',
] as const;

/** Literal SQL only — each FROM target is a string constant for the DO authorizer. */
function countPropertyInventoryRows(sql: SqlStorageLike): number {
  const row = sql
    .exec(
      `SELECT
      (SELECT COUNT(*) FROM alarm_schedule) +
      (SELECT COUNT(*) FROM audit_log) +
      (SELECT COUNT(*) FROM availability_day) +
      (SELECT COUNT(*) FROM charge_code) +
      (SELECT COUNT(*) FROM folio_line) +
      (SELECT COUNT(*) FROM folio_window) +
      (SELECT COUNT(*) FROM housekeeping_assignment) +
      (SELECT COUNT(*) FROM idempotency) +
      (SELECT COUNT(*) FROM night_audit_report) +
      (SELECT COUNT(*) FROM night_audit_run) +
      (SELECT COUNT(*) FROM outbox) +
      (SELECT COUNT(*) FROM payment) +
      (SELECT COUNT(*) FROM property_config) +
      (SELECT COUNT(*) FROM property_config_audit) +
      (SELECT COUNT(*) FROM provisional_exception) +
      (SELECT COUNT(*) FROM rate_day) +
      (SELECT COUNT(*) FROM rate_plan) +
      (SELECT COUNT(*) FROM reservation) +
      (SELECT COUNT(*) FROM restriction_day) +
      (SELECT COUNT(*) FROM room) +
      (SELECT COUNT(*) FROM room_type) +
      (SELECT COUNT(*) FROM shift) +
      (SELECT COUNT(*) FROM tax_rule) AS n`,
    )
    .toArray() as Array<{ n: number }>;
  return Number(row[0]?.n ?? 0);
}

export class PropertyDO extends DurableObject<PmsEnv> {
  private readonly scheduler: AlarmScheduler;
  private lanes = new LaneGuard();
  private readonly entitlementCache = new EntitlementDoCache();
  private readonly permissionCache = new PermissionDoCache();


  /**
   * Set only by `setRollFailureForTest`. When non-null, `runRollStepSync` throws
   * *after* advancing `__meta.business_date` and before reconciling the horizon —
   * the only way to exercise a mid-roll failure without a real failing step body.
   */
  private rollFailureForTest: string | null = null;
  private postRoomChargesFailureAfterCountForTest: number | null = null;
  private transportBlockedForTest = false;
  private simulateBugForTest = false;
  private pspSimulateOutcomeForTest: PspSimulateOutcome | null = null;
  /** Vitest only — DO bindings always have simulate on; force the production refuse path. */
  private forcePspUnavailableForTest = false;
  private auditAppendFaultForTest = false;
  private reportsR2UnboundForTest = false;
  private snapshotFailureAfterPutForTest: string | null = null;
  private reportPutCountForTest = 0;
  /**
   * Keyed by businessDate. A Workflow retry and an operator retry of SNAPSHOT can
   * interleave; the outcome is benign (deterministic keys + INSERT OR REPLACE).
   */
  private pendingReportPuts = new Map<
    string,
    Array<{ reportId: string; r2Key: string; sha256: string; generatedAt: number }>
  >();

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    this.scheduler = new AlarmScheduler(ctx.storage.sql, ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...PROPERTY_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
      const rows = ctx.storage.sql
        .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
        .toArray() as Array<{ value_json: string }>;
      if (rows[0]) {
        const expected = JSON.parse(rows[0].value_json) as Jurisdiction | null;
        const actual = (ctx.id as { jurisdiction?: string | null }).jurisdiction ?? null;
        // Local workerd has no DO jurisdiction on ids — skip only under explicit unsafe+simulate.
        if (!(isJurisdictionSimulate(env) && expected !== null && actual === null)) {
          assertJurisdictionMatch(actual, expected);
        }
      }
    });
  }

  private outboxAlarmContext(): OutboxAlarmContext {
    return {
      sql: this.ctx.storage.sql,
      tags: { propertyId: this.getPropertyIdSync() ?? undefined },
      lanes: this.lanes,
      upsertOutboxSchedule: (nextRunAt) => this.scheduler.upsertSchedule('outbox', nextRunAt),
    };
  }

  /**
   * Guard for test helpers that can corrupt the audit calendar or wedge a property
   * (roll the business date backwards, force a permanent halt, rewrite `alarm_schedule`).
   * Same `HOSPAI_UNSAFE_LOCAL=1` marker that gates simulate-jurisdiction / dev-actor auth,
   * so these can never be reached on a real deploy.
   */
  private assertUnsafeLocal(helper: string): void {
    if (this.env.HOSPAI_UNSAFE_LOCAL !== '1') {
      throw new Error(`${helper} requires HOSPAI_UNSAFE_LOCAL=1 (local only)`);
    }
  }

  async setRecordedJurisdiction(jurisdiction: Jurisdiction | null): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.jurisdiction', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(jurisdiction),
      Date.now(),
    );
  }

  async getRecordedJurisdiction(): Promise<Jurisdiction | null | undefined> {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return undefined;
    return JSON.parse(rows[0].value_json) as Jurisdiction | null;
  }

  /** Raw-SQL insert of `__meta.property_id` if absent. Never overwrites an existing value. */
  async ensureMetaPropertyId(propertyId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.property_id', ?, 1, ?)
       ON CONFLICT(key) DO NOTHING`,
      JSON.stringify(propertyId),
      Date.now(),
    );
  }

  /** Raw-SQL insert of `__meta.org_id` if absent. Never overwrites an existing value. */
  async ensureMetaOrgId(orgId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.org_id', ?, 1, ?)
       ON CONFLICT(key) DO NOTHING`,
      JSON.stringify(orgId),
      Date.now(),
    );
  }

  async getOrgId(): Promise<string | null> {
    return this.getOrgIdSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private getOrgIdSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.org_id')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  private async gateCoreEntitlement(
    orgId: string,
  ): Promise<{ ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE } | null> {
    const result = await assertEntitled(this.env, this.entitlementCache, orgId, 'pms.core');
    if (!result.ok) return result;
    return null;
  }

  private async gatePermission(
    actor: ActorContext,
    permission: Permission,
  ): Promise<{ ok: false; error: typeof FORBIDDEN | 'not_member' } | null> {
    if (actor.kind === 'system') return null;

    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: FORBIDDEN };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: FORBIDDEN };

    const role = await this.permissionCache.getEffectiveRole(
      this.env.ORG_DO as unknown as DurableObjectNamespace,
      orgId,
      propertyId,
      actor.userId,
    );
    if (!role) return { ok: false, error: 'not_member' };
    if (!ROLE_GRANTS[role].includes(permission)) {
      return { ok: false, error: FORBIDDEN };
    }
    return null;
  }

  private async gateOrgRef<T>(
    orgId: string,
    invoke: (org: DurableObjectStub<OrgDO>) => T,
  ): Promise<Awaited<T> | { ok: false; error: 'org_unreachable' }> {
    try {
      const org = resolveOrgStub(this.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
      return await invoke(org);
    } catch (e) {
      if (isOrgDoTransportFailure(e)) return { ok: false, error: 'org_unreachable' };
      throw e;
    }
  }

  /**
   * Look up `guestRef` in the org's guest registry — create-only referential integrity check.
   * Never caches; returns the current `piiKeyId` so callers store the looked-up value rather
   * than trusting a client-supplied one.
   */
  private async gateGuestRef(orgId: string, guestRef: string) {
    return this.gateOrgRef(orgId, (org) => org.assertGuestRef(guestRef));
  }

  private async gateStaffRef(orgId: string, staffId: string) {
    return this.gateOrgRef(orgId, (org) => org.assertStaffAssignable(staffId));
  }

  private assertRpcAvailable(): void {
    if (this.simulateBugForTest) {
      throw new Error('simulated_internal_bug');
    }
    if (this.transportBlockedForTest) {
      throw new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE);
    }
  }

  private assertProvisionalBusinessDateOpen(provisional?: ProvisionalContext): void {
    if (!provisional) return;
    const openDate = this.readBusinessDateSync();
    if (openDate && provisional.businessDate < openDate) {
      throw new ProvisionalBusinessDateClosedError(provisional.businessDate, openDate);
    }
  }

  private statusChangeOutboxExtras(provisional?: ProvisionalContext): Record<string, unknown> {
    if (!provisional) return {};
    return {
      issuedAt: provisional.issuedAt,
      replayedAt: new Date().toISOString(),
      provisional: true,
    };
  }

  /** Single binder for module write paths — provisional extras must not be copied per method. */
  private moduleTxnCtx(
    orgId: string,
    propertyId: string,
    provisional?: ProvisionalContext,
  ): ModuleTxnCtx {
    return {
      sql: this.ctx.storage.sql,
      appendOutbox: (evt) =>
        this.appendPropertyOutbox({
          eventId: evt.eventId,
          eventType: evt.eventType,
          payload: { ...evt.payload, ...this.statusChangeOutboxExtras(provisional) },
        }),
      orgId,
      propertyId,
    };
  }

  async getPropertyId(): Promise<string | null> {
    return this.getPropertyIdSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private getPropertyIdSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.property_id')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /** Read the stored `pms.time.time_zone` DOMAIN row directly — never falls back to the register default. */
  async readStoredTimeZone(): Promise<string | null> {
    return this.readStoredTimeZoneSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private readStoredTimeZoneSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.time.time_zone')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /** Read the stored `pms.money.currency_code` DOMAIN row directly — never falls back to the register default. */
  async readStoredLedgerCurrency(): Promise<CurrencyCode | null> {
    return this.readStoredLedgerCurrencySync();
  }

  /** Sync — ledger currency row only; never readConfig default (same as timezone). */
  private readStoredLedgerCurrencySync(): CurrencyCode | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.money.currency_code')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    try {
      return currencyCode(JSON.parse(rows[0].value_json) as string);
    } catch {
      return null;
    }
  }

  /** DOMAIN put of the first-write ledger currency. No-op if a row already exists. */
  async ensureCurrencyIfAbsent(
    currency: string,
    idem: IdempotencyKey,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string } | { ok: true; skipped: true }> {
    if (this.readStoredLedgerCurrencySync() !== null) {
      return { ok: true, skipped: true };
    }
    const code = currencyCode(currency);
    const result = await this.tryPutDomainConfig(
      { kind: 'system', reason: 'provision' },
      'pms.money.currency_code',
      code,
      { reason: 'provision:first-write-currency' },
      idem,
    );
    if (!result.ok) return result;
    return { ok: true, version: result.version };
  }

  /** DOMAIN put of the first-write timezone. No-op if a row already exists — re-provisioning never overwrites. */
  async ensureTimeZoneIfAbsent(
    timeZone: string,
    idem: IdempotencyKey,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string } | { ok: true; skipped: true }> {
    if ((await this.readStoredTimeZone()) !== null) {
      return { ok: true, skipped: true };
    }
    const result = await this.tryPutDomainConfig(
      { kind: 'system', reason: 'provision' },
      'pms.time.time_zone',
      timeZone,
      { reason: 'provision:first-write-timezone' },
      idem,
    );
    if (!result.ok) return result;
    return { ok: true, version: result.version };
  }

  private readBusinessDateSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.business_date')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /** Posting business date for rule selection.
   *
   * The `provisional.businessDate` branch is unreachable-by-construction on replay:
   * `assertProvisionalBusinessDateOpen` runs first and rejects when
   * `provisional.businessDate < openDate`, so a stale queued command never reaches
   * rule selection. Keep the branch for direct callers that pass provisional without
   * the guard, and for clarity vs wall-clock — same class as charge-code §2.3 armor. */
  private resolvePostingBusinessDateSync(provisional?: ProvisionalContext): string {
    if (provisional?.businessDate) return provisional.businessDate;
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) throw new Error(BUSINESS_DATE_UNSET);
    return businessDate;
  }

  private taxRuleWindowOverlaps(
    aFrom: string,
    aTo: string | null,
    bFrom: string,
    bTo: string | null,
  ): boolean {
    const aEnd = aTo ?? '9999-12-31';
    const bEnd = bTo ?? '9999-12-31';
    return aFrom <= bEnd && bFrom <= aEnd;
  }

  private assertTaxOutputCodeExemptSync(outputChargeCode: string): void {
    const rows = this.ctx.storage.sql
      .exec(`SELECT tax_group FROM charge_code WHERE code = ?`, outputChargeCode)
      .toArray() as Array<{ tax_group: string | null }>;
    if (!rows[0]) throw new ChargeCodeNotFoundError();
    if (rows[0].tax_group != null) throw new TaxOutputCodeTaxableError();
  }

  private listApplicableTaxRulesSync(
    taxGroup: string,
    postingDate: string,
  ): Array<{
    tax_rule_id: string;
    rate: string;
    output_charge_code: string;
    rule_type: string;
  }> {
    return this.ctx.storage.sql
      .exec(
        `SELECT tax_rule_id, rate, output_charge_code, rule_type
         FROM tax_rule
         WHERE tax_group = ?
           AND valid_from <= ?
           AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY valid_from, tax_rule_id`,
        taxGroup,
        postingDate,
        postingDate,
      )
      .toArray() as Array<{
      tax_rule_id: string;
      rate: string;
      output_charge_code: string;
      rule_type: string;
    }>;
  }

  private stampTaxForChargeSync(params: {
    parentLineId: string;
    parentAmountMinor: number;
    parentSource: string | null | undefined;
    chargeCode: string;
    reservationId: string;
    folioWindowId: string;
    postingDate: string;
    posted: PostedLineAmount;
  }): void {
    const parentSource = params.parentSource ?? null;
    if (
      parentSource === 'PAYMENT' ||
      parentSource === 'SPLIT_REVERSAL' ||
      parentSource === 'TAX'
    ) {
      return;
    }

    const codeRows = this.ctx.storage.sql
      .exec(`SELECT tax_group FROM charge_code WHERE code = ?`, params.chargeCode)
      .toArray() as Array<{ tax_group: string | null }>;
    const taxGroup = codeRows[0]?.tax_group;
    if (!taxGroup) return;

    const rules = this.listApplicableTaxRulesSync(taxGroup, params.postingDate);
    for (const rule of rules) {
      if (rule.rule_type !== 'PERCENTAGE') continue;
      const taxMinor = computeTax(params.parentAmountMinor, rule.rate);
      if (taxMinor === 0) continue;
      this.insertFolioLineSync({
        folioLineId: `${params.parentLineId}:tax:${rule.tax_rule_id}`,
        folioWindowId: params.folioWindowId,
        reservationId: params.reservationId,
        chargeCode: rule.output_charge_code,
        posted: {
          amountMinor: taxMinor,
          txnCurrency: params.posted.txnCurrency,
          ledgerAmountMinor: taxMinor,
          fxRate: params.posted.fxRate,
          fxRateAt: params.posted.fxRateAt,
        },
        source: 'TAX',
        taxOf: params.parentLineId,
        taxRuleId: rule.tax_rule_id,
      });
    }
  }

  /**
   * Read the stored `__meta.business_date`, or null if never provisioned.
   */
  async readBusinessDate(): Promise<string | null> {
    return this.readBusinessDateSync();
  }

  /**
   * Raw-SQL first-write of `__meta.business_date`: the local calendar date derived
   * from `instant` in `timeZone`. Never overwrites an existing value — re-provisioning
   * or replaying provision with a different instant/timezone must not roll it back.
   */
  async ensureBusinessDateIfAbsent(timeZone: string, instant: Date): Promise<void> {
    const businessDate = enumerateHorizonDates(timeZone, instant, 1)[0]!;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO NOTHING`,
      JSON.stringify(businessDate),
      Date.now(),
    );
  }

  /**
   * Upsert the `night-audit` alarm schedule for the next `pms.night_audit.audit_time`
   * occurrence (register default `02:00`) in `timeZone`, then re-arm from the table.
   * Idempotent to call repeatedly — always recomputes from "now".
   */
  async ensureNightAuditSchedule(timeZone: string, instant: Date): Promise<void> {
    const auditTime = (await this.readConfig('pms.night_audit.audit_time')) as string;
    const nextRunAt = nextAuditRunAtMs(timeZone, auditTime, instant);
    this.scheduler.upsertSchedule('night-audit', nextRunAt);
    await this.scheduler.armFromTable();
  }

  /** First-write outbox sweep schedule — idempotent, mirrors timezone/currency provisioning. */
  async ensureOutboxScheduleIfAbsent(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM alarm_schedule WHERE name = 'outbox' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    if (rows.length > 0) return;
    this.scheduler.upsertSchedule('outbox', Date.now() + OUTBOX_SWEEP_INTERVAL_MS);
    await this.scheduler.armFromTable();
  }

  private rescheduleOutboxAfterFlush(flushed: number, backlog: boolean): void {
    const delay =
      flushed === 0 ? OUTBOX_SWEEP_INTERVAL_MS : backlog ? OUTBOX_BACKLOG_DELAY_MS : OUTBOX_SWEEP_INTERVAL_MS;
    this.scheduler.upsertSchedule('outbox', Date.now() + delay);
  }

  private async flushOutboxToQueue(
    drainOpts?: { maxMessages?: number; maxBytes?: number },
  ): Promise<{ flushed: number; backlog: boolean; rows: OutboxRow[] }> {
    const source = this.outboxSourceSync();
    return this.flushOutbox(async (batch) => {
      await this.env.EVENTS_QUEUE.sendBatch(batch.map((row) => toQueueBatchEntry(row, source)));
    }, drainOpts);
  }

  /**
   * Sync — recompute `night-audit`'s `next_run_at` and upsert it into `alarm_schedule`,
   * without arming `setAlarm` (callers arm after their transaction commits). No-op
   * (returns `false`) if the timezone or business_date is not yet provisioned — an
   * opportunistic reschedule from a config write must never throw on a half-provisioned
   * property; the explicit `rescheduleNightAudit()` entry point fails closed instead.
   */
  private rescheduleNightAuditSync(): boolean {
    const timeZone = this.readStoredTimeZoneSync();
    const businessDate = this.readBusinessDateSync();
    if (!timeZone || !businessDate) return false;

    const now = Date.now();
    const today = enumerateHorizonDates(timeZone, new Date(now), 1)[0]!;
    const nextRunAt =
      businessDate < today ? now : nextAuditRunAtMs(timeZone, this.readAuditTimeSync(), new Date(now));
    this.scheduler.upsertSchedule('night-audit', nextRunAt);
    return true;
  }

  /** Sync raw read of `pms.night_audit.audit_time`, falling back to the register default. */
  private readAuditTimeSync(): string {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.night_audit.audit_time')
      .toArray() as Array<{ value_json: string }>;
    if (rows[0]) return JSON.parse(rows[0].value_json) as string;
    const entry = getConfigEntry('pms.night_audit.audit_time');
    return (entry?.default as string) ?? '02:00';
  }

  /** Sync read of a DOMAIN config value — stored row or register default. */
  private readConfigValueSync(key: string): unknown {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, key)
      .toArray() as Array<{ value_json: string }>;
    if (rows.length > 0) return JSON.parse(rows[0]!.value_json);
    const entry = getConfigEntry(key);
    if (!entry) throw new UndeclaredConfigError(key);
    return entry.default;
  }

  /**
   * Materialize DOMAIN oversell config into `availability_day.oversell` at ledger write
   * time. Book paths read the column only — never add config allowance on top.
   */
  private materializedOversellAllowanceSync(): number {
    if (this.readConfigValueSync('pms.availability.allow_overbooking') !== true) return 0;
    return Number(this.readConfigValueSync('pms.availability.oversell_allowance'));
  }

  private loadRestrictionRowsSync(roomTypeId: string, dates: string[]): Map<string, RestrictionRow> {
    const map = new Map<string, RestrictionRow>();
    for (const stayDate of dates) {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT min_los, max_los, cta, ctd, stop_sell FROM restriction_day
           WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
          roomTypeId,
          TYPE_WIDE_RATE_PLAN,
          stayDate,
        )
        .toArray() as Array<{
        min_los: number | null;
        max_los: number | null;
        cta: number;
        ctd: number;
        stop_sell: number;
      }>;
      const row = rows[0];
      if (!row) continue;
      map.set(stayDate, {
        stayDate,
        minLos: row.min_los,
        maxLos: row.max_los,
        cta: row.cta !== 0,
        ctd: row.ctd !== 0,
        stopSell: row.stop_sell !== 0,
      });
    }
    return map;
  }

  private restrictionFailureSync(
    roomTypeId: string,
    arrivalDate: string,
    departureDate: string,
    nights: string[],
  ): void {
    const dates = [...new Set([...nights, departureDate])];
    const violation = firstRestrictionViolation(
      arrivalDate,
      departureDate,
      nights,
      this.loadRestrictionRowsSync(roomTypeId, dates),
    );
    if (violation) {
      throw new RestrictionViolatedError(violation.rule, violation.date, violation.required);
    }
  }

  /**
   * Rematerialize ledger `oversell` from DOMAIN config on every open horizon row
   * (`stay_date >= business_date`) for **active** room types only — archived types
   * keep `oversell = 0` so ledger readers see unsellable stock without joining
   * `room_type`. Called inside `tryPutDomainConfig` when `consumers.invalidatesAri`.
   */
  private invalidateAriSync(): boolean {
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return false;

    const activeOnly = `room_type_id IN (SELECT room_type_id FROM room_type WHERE status = 'active')`;

    const rangeRows = this.ctx.storage.sql
      .exec(
        `SELECT MIN(stay_date) AS from_date, MAX(stay_date) AS to_date, COUNT(*) AS c
         FROM availability_day WHERE stay_date >= ? AND ${activeOnly}`,
        businessDate,
      )
      .toArray() as Array<{ from_date: string | null; to_date: string | null; c: number }>;
    const range = rangeRows[0];
    if (!range || range.c === 0 || !range.from_date || !range.to_date) return false;

    const ledgerOversell = this.materializedOversellAllowanceSync();
    this.ctx.storage.sql.exec(
      `UPDATE availability_day SET oversell = ?, version = version + 1
       WHERE stay_date >= ? AND ${activeOnly}`,
      ledgerOversell,
      businessDate,
    );

    const propertyId = this.getPropertyIdSync();
    const ariVersion = this.bumpAriVersionSync();
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'availability.changed',
      payload: {
        propertyId,
        fromDate: range.from_date,
        toDate: range.to_date,
        version: ariVersion,
      },
    });
    return true;
  }

  /**
   * Recompute and arm the `night-audit` schedule: `next_run_at = now` if `business_date`
   * is still behind "today" in the property timezone (so the Workflow re-fires immediately
   * rather than waiting for the next calendar `audit_time`), else the next `audit_time`
   * occurrence. Called by the Workflow after a successful run and by the config write hook
   * when `consumers.reschedulesNightAudit`. Fails closed if timezone/business_date are unset.
   */
  async rescheduleNightAudit(): Promise<void> {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) throw new Error(TIMEZONE_UNSET);
    if (!this.readBusinessDateSync()) throw new Error(BUSINESS_DATE_UNSET);
    this.rescheduleNightAuditSync();
    await this.scheduler.armFromTable();
  }

  /**
   * §4.4 alarm entrypoint — the only caller of `ctx.storage.setAlarm` in this class (via
   * `AlarmScheduler`). Multiplexes all named schedules; `night-audit` creates a
   * `NightAuditWorkflow` instance resolved from `__meta.property_id`, never a raw DO id.
   */
  async alarm(): Promise<void> {
    await this.scheduler.run({
      outbox: async () => {
        await runOutboxAlarmStep(
          this.outboxAlarmContext(),
          () => this.flushOutboxToQueue(),
          (flushed, backlog) => this.rescheduleOutboxAfterFlush(flushed, backlog),
        );
      },
      'night-audit': async () => {
        // Always advance to the next calendar audit_time occurrence *before* creating the
        // Workflow — AlarmScheduler.run() always re-arms to MIN(next_run_at), so if this
        // handler left next_run_at in the past (e.g. the Workflow halts/exits early), the
        // very next `armFromTable()` would immediately re-fire and storm duplicate
        // Workflows. Catch-up ("fire now if still behind") remains the Workflow's terminal
        // `rescheduleNightAudit()` after a successful run — this bump is intentionally
        // *not* `now`.
        const timeZone = this.readStoredTimeZoneSync();
        if (timeZone) {
          const nextRunAt = nextAuditRunAtMs(timeZone, this.readAuditTimeSync(), new Date());
          this.scheduler.upsertSchedule('night-audit', nextRunAt);
        }

        // Halted or unprovisioned: skip the Workflow entirely (schedule is already bumped
        // above, so we don't storm) rather than spend a Workflow instance that will just
        // exit early.
        if (await this.isNightAuditHalted()) return;
        const propertyId = this.getPropertyIdSync();
        if (!propertyId) return;
        await this.env.NIGHT_AUDIT_WORKFLOW.create({
          id: `na-${propertyId}-${Date.now()}`,
          params: { propertyId },
        });
      },
    });
  }

  /** Test helper: run the outbox alarm handler path (flush + reschedule). Returns null when deferred. */
  async runOutboxAlarmForTest(opts?: {
    maxMessages?: number;
    maxBytes?: number;
  }): Promise<OutboxFlushResult | null> {
    this.assertUnsafeLocal('runOutboxAlarmForTest');
    return runOutboxAlarmStep(
      this.outboxAlarmContext(),
      () => this.flushOutboxToQueue(opts),
      (flushed, backlog) => this.rescheduleOutboxAfterFlush(flushed, backlog),
    );
  }

  /** Test helper (unsafe-local only): replace LaneGuard (e.g. quietMs override or reset admission state). */
  async resetLaneGuardForTest(opts?: LaneGuardOptions): Promise<void> {
    this.assertUnsafeLocal('resetLaneGuardForTest');
    this.lanes = new LaneGuard(opts);
  }

  async touchInteractiveForTest(): Promise<void> {
    this.assertUnsafeLocal('touchInteractiveForTest');
    this.lanes.touchInteractive();
  }

  async getLaneGuardLastInteractiveAtForTest(): Promise<number> {
    this.assertUnsafeLocal('getLaneGuardLastInteractiveAtForTest');
    return this.lanes.getLastInteractiveAt();
  }

  /**
   * Tenant purge — BULK lane, must not touchInteractive (§4.8).
   * Atomic deleteAll(); constructor remigrates on next wake.
   */
  async purgeStorageForTenant(): Promise<
    { ok: true; deletedApprox: number } | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: 'bulk_not_admitted' };
    }
    const deletedApprox = await this.countNonBookkeepingRows();
    await this.ctx.storage.deleteAll();
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // alarm may already be gone after deleteAll on newer compat dates
    }
    return { ok: true, deletedApprox };
  }

  /**
   * VERIFY helper. Post-deleteAll (no schema_version) → 0 without remigrating.
   * After remigrate, counts tenant inventory via literal SQL (DO authorizer).
   * Unexpected sqlite_master user tables → throw.
   */
  async countNonBookkeepingRows(): Promise<number> {
    this.assertRpcAvailable();
    const schemaPresent =
      (
        this.ctx.storage.sql
          .exec(`SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name = 'schema_version'`)
          .toArray() as Array<{ one: number }>
      ).length > 0;
    if (!schemaPresent) return 0;

    const bookkeeping = new Set(['schema_version', '__cf_kv', 'sqlite_sequence', '_cf_METADATA']);
    const present = (
      this.ctx.storage.sql
        .exec(`SELECT name FROM sqlite_master WHERE type='table'`)
        .toArray() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const name of present) {
      if (bookkeeping.has(name) || name.startsWith('sqlite_') || name.startsWith('_cf')) continue;
      if (!(PROPERTY_PURGE_INVENTORY_TABLES as readonly string[]).includes(name)) {
        throw new Error(`unexpected_table:${name}`);
      }
    }
    return countPropertyInventoryRows(this.ctx.storage.sql);
  }

  /** Test helper (unsafe-local only): clear PermissionDoCache (degraded-mode test 6b). */
  async clearPermissionCacheForTest(): Promise<void> {
    this.assertUnsafeLocal('clearPermissionCacheForTest');
    this.permissionCache.invalidate();
  }

  async clearEntitlementCacheForTest(): Promise<void> {
    this.assertUnsafeLocal('clearEntitlementCacheForTest');
    this.entitlementCache.invalidate();
  }

  /** Vitest fault injection — throws transport-allowlisted error on subsequent command RPCs. */
  async setTransportBlockedForTest(blocked: boolean): Promise<void> {
    this.assertUnsafeLocal('setTransportBlockedForTest');
    this.transportBlockedForTest = blocked;
  }

  /** Vitest fault injection — throws non-transport error on subsequent command RPCs. */
  async setSimulateBugForTest(enabled: boolean): Promise<void> {
    this.assertUnsafeLocal('setSimulateBugForTest');
    this.simulateBugForTest = enabled;
  }

  /** Vitest PSP outcome lever — sticky until cleared (see `setTransportBlockedForTest`). */
  async setPspSimulateOutcomeForTest(outcome: PspSimulateOutcome | null): Promise<void> {
    this.assertUnsafeLocal('setPspSimulateOutcomeForTest');
    this.pspSimulateOutcomeForTest = outcome;
  }

  async setForcePspUnavailableForTest(force: boolean): Promise<void> {
    this.assertUnsafeLocal('setForcePspUnavailableForTest');
    this.forcePspUnavailableForTest = force;
  }

  /** Vitest: throw inside appendAuditLogSync to prove same-txn rollback. */
  async setAuditAppendFaultForTest(fault: boolean): Promise<void> {
    this.assertUnsafeLocal('setAuditAppendFaultForTest');
    this.auditAppendFaultForTest = fault;
  }

  private auditActorSync(actor: ActorContext): string {
    return actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;
  }

  /**
   * Sync — must be called inside the mutation's transactionSync.
   * Never silently prune audit_log; ARCHIVE owns future purge.
   */
  private appendAuditLogSync(input: {
    at?: number;
    actor: string;
    commandId: string;
    entityType: string;
    entityId: string;
    beforeJson?: unknown | null;
    afterJson: unknown;
    shiftId?: string | null;
    reservationId?: string | null;
  }): void {
    if (this.auditAppendFaultForTest) {
      throw new Error('audit_append_fault_for_test');
    }
    if (!input.actor) throw new Error('audit_actor_required');
    const at = input.at ?? Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_log (
         at, actor, command_id, entity_type, entity_id,
         before_json, after_json, shift_id, reservation_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      at,
      input.actor,
      input.commandId,
      input.entityType,
      input.entityId,
      input.beforeJson == null ? null : JSON.stringify(input.beforeJson),
      JSON.stringify(input.afterJson),
      input.shiftId ?? null,
      input.reservationId ?? null,
      at,
    );
  }

  private pspSimulateEnabled(): boolean {
    return !this.forcePspUnavailableForTest && isPspSimulate(this.env);
  }

  /** Test-only: insert rate_day without plan validation (orphan / pre-slice data). */
  async seedOrphanRateDayForTest(row: {
    roomTypeId: string;
    ratePlanId: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
  }): Promise<void> {
    this.assertUnsafeLocal('seedOrphanRateDayForTest');
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_day (room_type_id, rate_plan_id, stay_date, amount_minor, currency, version)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         version = rate_day.version + 1`,
      row.roomTypeId,
      row.ratePlanId,
      row.stayDate,
      row.amountMinor,
      row.currency,
    );
  }

  async recordProvisionalException(
    cmd: ProvisionalCommand,
    reason: string,
    detail: unknown | null,
  ): Promise<void> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO provisional_exception (
        exception_id, idempotency_key, command_type, payload,
        issued_at, business_date, reason, detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      cmd.idempotencyKey,
      cmd.command.type,
      JSON.stringify(cmd.command.payload),
      cmd.issuedAt,
      cmd.businessDate,
      reason,
      detail === null ? null : JSON.stringify(detail),
      now,
    );
  }

  async listProvisionalExceptions(): Promise<{ exceptions: ProvisionalExceptionRow[] }> {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT exception_id, idempotency_key, command_type, payload,
                issued_at, business_date, reason, detail, created_at,
                resolved_at, resolved_by
         FROM provisional_exception
         WHERE resolved_at IS NULL
         ORDER BY created_at DESC`,
      )
      .toArray() as Array<{
        exception_id: string;
        idempotency_key: string;
        command_type: string;
        payload: string;
        issued_at: string;
        business_date: string;
        reason: string;
        detail: string | null;
        created_at: number;
        resolved_at: number | null;
        resolved_by: string | null;
      }>;

    return {
      exceptions: rows.map((row) => ({
        exceptionId: row.exception_id,
        idempotencyKey: row.idempotency_key,
        commandType: row.command_type,
        payload: JSON.parse(row.payload) as unknown,
        issuedAt: row.issued_at,
        businessDate: row.business_date,
        reason: row.reason,
        detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown),
        createdAt: row.created_at,
        resolvedAt: row.resolved_at ?? null,
        resolvedBy: row.resolved_by ?? null,
      })),
    };
  }

  async countProvisionalExceptions(): Promise<number> {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS n FROM provisional_exception WHERE resolved_at IS NULL`)
      .toArray() as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** Test helper (unsafe-local only): invoke the `alarm()` lifecycle callback directly (no real DO alarm clock in vitest-pool-workers). */
  async triggerAlarmForTest(): Promise<void> {
    this.assertUnsafeLocal('triggerAlarmForTest');
    return this.alarm();
  }

  /** Test helper: read a raw `alarm_schedule` row. */
  async getAlarmSchedule(name: string): Promise<{ nextRunAt: number; lastError: string | null } | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT next_run_at, last_error FROM alarm_schedule WHERE name = ?`, name)
      .toArray() as Array<{ next_run_at: number; last_error: string | null }>;
    const row = rows[0];
    if (!row) return null;
    return { nextRunAt: row.next_run_at, lastError: row.last_error };
  }

  /** Test helper (unsafe-local only): force a raw `alarm_schedule.next_run_at`, bypassing the scheduler API. */
  async setAlarmScheduleForTest(name: string, nextRunAt: number): Promise<void> {
    this.assertUnsafeLocal('setAlarmScheduleForTest');
    this.scheduler.upsertSchedule(name, nextRunAt);
  }

  /** Test helper (unsafe-local only): insert a `FAILED` `night_audit_run` row directly, to simulate a halt without needing a real failing step. */
  async forceNightAuditHaltForTest(businessDate: string): Promise<void> {
    this.assertUnsafeLocal('forceNightAuditHaltForTest');
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
       VALUES (?, 'PRE_CHECK', 'FAILED', 1, ?, NULL, 'forced-for-test')
       ON CONFLICT(business_date, step) DO UPDATE SET status = 'FAILED', error = 'forced-for-test'`,
      businessDate,
      now,
    );
  }

  /** Test helper (unsafe-local only): seed a `night_audit_run` row at an arbitrary status. */
  async seedNightAuditRunForTest(
    businessDate: string,
    step: NightAuditStep,
    status: 'RUNNING' | 'FAILED' | 'COMPLETED',
  ): Promise<void> {
    this.assertUnsafeLocal('seedNightAuditRunForTest');
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(business_date, step) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         completed_at = excluded.completed_at`,
      businessDate,
      step,
      status,
      now,
      status === 'COMPLETED' ? now : null,
      status === 'FAILED' ? 'seeded-for-test' : null,
    );
  }

  /** Raw-SQL monotonic counter for `__meta.ari_version`. Never routed through `tryPutDomainConfig` (undeclared key). */
  async readAriVersion(): Promise<number> {
    return this.readAriVersionSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private readAriVersionSync(): number {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.ari_version')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return 0;
    return JSON.parse(rows[0].value_json) as number;
  }

  async bumpAriVersion(): Promise<number> {
    return this.bumpAriVersionSync();
  }

  /** Test helper (unsafe-local only): force `__meta.business_date`, bypassing the insert-only first-write guard. */
  async setBusinessDateForTest(businessDate: string): Promise<void> {
    this.assertUnsafeLocal('setBusinessDateForTest');
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(businessDate),
      Date.now(),
    );
  }

  /** Test helper (unsafe-local only): remove stored property id to exercise unset guards. */
  async clearMetaPropertyIdForTest(): Promise<void> {
    this.assertUnsafeLocal('clearMetaPropertyIdForTest');
    this.ctx.storage.sql.exec(`DELETE FROM property_config WHERE key = '__meta.property_id'`);
  }

  /** Test helper: run horizon set-reconcile directly, without touching `night_audit_run` / ARI / outbox. */
  async reconcileHorizonForTest(
    businessDate: string,
  ): Promise<{ insertedCount: number; fromDate: string; toDate: string }> {
    return reconcileHorizon(
      this.ctx.storage.sql,
      businessDate,
      this.materializedOversellAllowanceSync(),
    );
  }

  /** Any `FAILED` `night_audit_run` row halts new audit runs — derived, not a separate flag. */
  async isNightAuditHalted(): Promise<boolean> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM night_audit_run WHERE status = 'FAILED' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    return rows.length > 0;
  }

  /** Test helper: read a `night_audit_run` row's status, or null if absent. */
  async getNightAuditStepStatus(businessDate: string, step: NightAuditStep): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT status FROM night_audit_run WHERE business_date = ? AND step = ?`,
        businessDate,
        step,
      )
      .toArray() as Array<{ status: string }>;
    return rows[0]?.status ?? null;
  }

  /**
   * Run one §8 audit step for `businessDate`. Idempotent per `(businessDate, step)`:
   * a `COMPLETED` row short-circuits. Emits `night_audit.started` the first time any
   * step for `businessDate` enters `RUNNING`, and `night_audit.completed` when `ARCHIVE`
   * completes. Only `ROLL_BUSINESS_DATE` mutates `__meta.business_date` / the horizon —
   * every other step except `PRE_CHECK` / money / cashier / roll is a no-op stub
   * until later tasks. `PRE_CHECK` requires `census` (caller-passes-census).
   *
   * Three separate transactions, deliberately: the `RUNNING` bookkeeping and the
   * `FAILED` bookkeeping must survive, while the step *body* must roll back whole.
   * A single transaction with an inner `try/catch` commits everything the body wrote
   * before it threw — an advanced `business_date` on a half-reconciled horizon with a
   * `FAILED` row and a permanent halt is exactly the state the spec forbids.
   */
  async runAuditStep(
    businessDate: string,
    step: NightAuditStep,
    census?: NightAuditCensus,
  ): Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string }> {
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT status FROM night_audit_run WHERE business_date = ? AND step = ?`,
        businessDate,
        step,
      )
      .toArray() as Array<{ status: string }>;
    if (existing[0]?.status === 'COMPLETED') {
      return { status: 'COMPLETED' };
    }

    // Txn A — mark RUNNING and emit `night_audit.started` on the first step for this date.
    this.ctx.storage.transactionSync(() => {
      const isFirstStepForDate = (
        this.ctx.storage.sql
          .exec(`SELECT COUNT(*) AS c FROM night_audit_run WHERE business_date = ?`, businessDate)
          .toArray() as Array<{ c: number }>
      )[0]!.c === 0;

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
         VALUES (?, ?, 'RUNNING', 1, ?, NULL, NULL)
         ON CONFLICT(business_date, step) DO UPDATE SET
           status = 'RUNNING', attempt = night_audit_run.attempt + 1, started_at = excluded.started_at, error = NULL`,
        businessDate,
        step,
        now,
      );

      if (isFirstStepForDate) {
        const propertyId = this.getPropertyIdSync();
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'night_audit.started',
          payload: { propertyId, businessDate },
        });
      }
    });

    try {
      if (step === 'SNAPSHOT_REPORTS') {
        await this.snapshotReportsAsync(businessDate);
      } else if (step === 'ARCHIVE') {
        await this.archiveAsync(businessDate);
      }

      // Txn B — step body plus its COMPLETED marker: all of it, or none of it.
      return this.ctx.storage.transactionSync(() => {
        if (step === 'PRE_CHECK') {
          this.runPreCheckSync(businessDate, census);
        } else if (step === 'ROLL_BUSINESS_DATE') {
          this.runRollStepSync(businessDate);
        } else if (step === 'POST_ROOM_CHARGES') {
          this.postRoomChargesSync(businessDate);
        } else if (step === 'CLOSE_CASHIER_SHIFTS') {
          this.forceCloseCashierShiftsSync(businessDate);
        } else if (step === 'PROCESS_NO_SHOWS') {
          this.processNoShowsSync(businessDate);
        } else if (step === 'SNAPSHOT_REPORTS') {
          this.indexReportPutsSync(businessDate);
        } else if (step === 'ARCHIVE') {
          this.indexManifestSync(businessDate);
        }

        const completedAt = Date.now();
        this.ctx.storage.sql.exec(
          `UPDATE night_audit_run SET status = 'COMPLETED', completed_at = ? WHERE business_date = ? AND step = ?`,
          completedAt,
          businessDate,
          step,
        );

        if (step === 'ARCHIVE') {
          const propertyId = this.getPropertyIdSync();
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'night_audit.completed',
            payload: { propertyId, businessDate },
          });
        }

        return { status: 'COMPLETED' as const };
      });
    } catch (e) {
      // Txn C — Txn B rolled back; only the FAILED bookkeeping persists.
      const message = e instanceof Error ? e.message : String(e);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `UPDATE night_audit_run SET status = 'FAILED', error = ? WHERE business_date = ? AND step = ?`,
          message,
          businessDate,
          step,
        );
      });
      return { status: 'FAILED' as const, error: message };
    }
  }

  private runPreCheckSync(businessDate: string, census?: NightAuditCensus): void {
    if (census === undefined) throw new PendingCensusRequiredError();
    if (census.pendingOpenCount > 0) throw new PendingCommandsUndrainedError();
    const open = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS one FROM provisional_exception
         WHERE business_date = ? AND resolved_at IS NULL LIMIT 1`,
        businessDate,
      )
      .toArray();
    if (open.length > 0) throw new ProvisionalExceptionsOpenError();
  }

  /**
   * `PROCESS_NO_SHOWS` body — sync, inside Txn B. Copies tryNoShow inventory+status
   * writes. Does not call tryNoShow. Posts no folio lines.
   */
  private processNoShowsSync(businessDate: string): void {
    const auto = this.readConfigValueSync('pms.night_audit.auto_no_show');
    if (auto === false) return;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date
         FROM reservation
         WHERE status = 'confirmed' AND arrival_date <= ?`,
        businessDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      pii_key_id: string;
      arrival_date: string;
      departure_date: string;
    }>;

    const now = Date.now();
    for (const reservation of rows) {
      const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
      for (const stayDate of nights) {
        const soldRows = this.ctx.storage.sql
          .exec(
            `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
            reservation.room_type_id,
            stayDate,
          )
          .toArray() as Array<{ sold: number }>;
        if (soldRows.length === 0 || soldRows[0]!.sold < 1) {
          throw new LedgerInconsistentError(stayDate);
        }
      }
      for (const stayDate of nights) {
        this.ctx.storage.sql.exec(
          `UPDATE availability_day SET sold = sold - 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
          reservation.room_type_id,
          stayDate,
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET status = 'no_show', updated_at = ? WHERE reservation_id = ?`,
        now,
        reservation.reservation_id,
      );
      const ariVersion = this.bumpAriVersionSync();
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'reservation.status_changed',
        payload: {
          propertyId,
          reservationId: reservation.reservation_id,
          guestRef: reservation.guest_ref,
          piiKeyId: reservation.pii_key_id,
          fromStatus: 'confirmed',
          toStatus: 'no_show',
        },
      });
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: {
          propertyId,
          roomTypeId: reservation.room_type_id,
          fromDate: nights[0]!,
          toDate: nights[nights.length - 1]!,
          version: ariVersion,
        },
      });
      this.appendAuditLogSync({
        actor: 'system:night_audit',
        commandId: 'night_audit.run',
        entityType: 'reservation',
        entityId: reservation.reservation_id,
        beforeJson: { status: 'confirmed', roomTypeId: reservation.room_type_id },
        afterJson: { status: 'no_show', roomTypeId: reservation.room_type_id },
        reservationId: reservation.reservation_id,
      });
    }
  }

  private assertReportsR2Bound(): R2Bucket {
    if (this.reportsR2UnboundForTest || !hasEventLogR2(this.env) || !this.env.EVENT_LOG_R2) {
      throw new Error('reports_r2_unbound');
    }
    return this.env.EVENT_LOG_R2;
  }

  private async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async putReportObject(
    bucket: R2Bucket,
    propertyId: string,
    businessDate: string,
    reportId: string,
    body: unknown,
    generatedAt: number,
  ): Promise<{ reportId: string; r2Key: string; sha256: string; generatedAt: number }> {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const sha256 = await this.sha256Hex(encoded);
    const r2Key = reportObjectKey(propertyId, businessDate, reportId);
    await bucket.put(r2Key, encoded);
    this.reportPutCountForTest += 1;
    return { reportId, r2Key, sha256, generatedAt };
  }

  private async snapshotReportsAsync(businessDate: string): Promise<void> {
    const bucket = this.assertReportsR2Bound();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);
    const generatedAt = Date.now();

    const occupancyAgg = this.ctx.storage.sql
      .exec(
        `SELECT
           COALESCE(SUM(a.physical), 0) AS physical,
           COALESCE(SUM(a.sold), 0) AS sold,
           COALESCE(SUM(a.blocked), 0) AS blocked,
           COALESCE(SUM(a.held), 0) AS held
         FROM availability_day a
         JOIN room_type rt ON rt.room_type_id = a.room_type_id
         WHERE a.stay_date = ? AND rt.status = 'active'`,
        businessDate,
      )
      .toArray() as Array<{ physical: number; sold: number; blocked: number; held: number }>;
    const occ = occupancyAgg[0] ?? { physical: 0, sold: 0, blocked: 0, held: 0 };
    const inHouseCount = Number(
      (
        this.ctx.storage.sql
          .exec(`SELECT COUNT(*) AS n FROM reservation WHERE status = 'checked_in'`)
          .toArray() as Array<{ n: number }>
      )[0]?.n ?? 0,
    );
    const confirmedCount = Number(
      (
        this.ctx.storage.sql
          .exec(
            `SELECT COUNT(*) AS n FROM reservation
             WHERE status = 'confirmed' AND arrival_date <= ? AND departure_date > ?`,
            businessDate,
            businessDate,
          )
          .toArray() as Array<{ n: number }>
      )[0]?.n ?? 0,
    );
    const noShowCount = Number(
      (
        this.ctx.storage.sql
          .exec(
            `SELECT COUNT(*) AS n FROM reservation WHERE status = 'no_show' AND arrival_date <= ?`,
            businessDate,
          )
          .toArray() as Array<{ n: number }>
      )[0]?.n ?? 0,
    );

    const occupancy = {
      businessDate,
      physical: Number(occ.physical),
      sold: Number(occ.sold),
      blocked: Number(occ.blocked),
      held: Number(occ.held),
      inHouseCount,
      confirmedCount,
      noShowCount,
    };

    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    const revenueRows = this.ctx.storage.sql
      .exec(
        `SELECT charge_code, source, COALESCE(SUM(ledger_amount_minor), 0) AS total
         FROM folio_line WHERE business_date = ?
         GROUP BY charge_code, source`,
        businessDate,
      )
      .toArray() as Array<{ charge_code: string; source: string | null; total: number }>;
    const roomNet = revenueRows
      .filter((r) => r.charge_code === 'ROOM' && r.source === 'NIGHT_AUDIT')
      .reduce((sum, r) => sum + Number(r.total), 0);
    const taxTotal = revenueRows
      .filter((r) => r.source === 'TAX')
      .reduce((sum, r) => sum + Number(r.total), 0);
    const revenue = {
      businessDate,
      currency: ledgerCurrency,
      roomNet,
      taxTotal,
      byChargeCodeAndSource: revenueRows.map((r) => ({
        chargeCode: r.charge_code,
        source: r.source,
        ledgerAmountMinor: Number(r.total),
      })),
    };

    const shiftRows = this.ctx.storage.sql
      .exec(
        `SELECT shift_id, cashier_user_id, status, opening_float, closing_count, variance
         FROM shift WHERE business_date = ?`,
        businessDate,
      )
      .toArray() as Array<{
      shift_id: string;
      cashier_user_id: string;
      status: string;
      opening_float: number;
      closing_count: number | null;
      variance: number | null;
    }>;
    const cashier = {
      businessDate,
      unattributedCashCount: this.countUnattributedCashForBusinessDateSync(businessDate),
      shifts: shiftRows.map((s) => ({
        shiftId: s.shift_id,
        cashierUserId: s.cashier_user_id,
        status: s.status,
        openingFloat: s.opening_float,
        closingCount: s.closing_count,
        variance: s.variance,
      })),
    };

    const pending = [
      await this.putReportObject(bucket, propertyId, businessDate, 'occupancy', occupancy, generatedAt),
      await this.putReportObject(bucket, propertyId, businessDate, 'revenue', revenue, generatedAt),
      await this.putReportObject(bucket, propertyId, businessDate, 'cashier', cashier, generatedAt),
    ];
    this.pendingReportPuts.set(businessDate, pending);
    if (this.snapshotFailureAfterPutForTest) {
      throw new Error(this.snapshotFailureAfterPutForTest);
    }
  }

  private async archiveAsync(businessDate: string): Promise<void> {
    const bucket = this.assertReportsR2Bound();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);
    const outboxFlushedAt = Date.now();
    await this.flushOutboxToQueue();
    const archivedAt = Date.now();
    const reportKeys = [
      reportObjectKey(propertyId, businessDate, 'occupancy'),
      reportObjectKey(propertyId, businessDate, 'revenue'),
      reportObjectKey(propertyId, businessDate, 'cashier'),
    ];
    const manifest = {
      businessDate,
      rolledTo: this.readBusinessDateSync(),
      reportKeys,
      outboxFlushedAt,
      archivedAt,
    };
    const pending = [
      await this.putReportObject(bucket, propertyId, businessDate, 'manifest', manifest, archivedAt),
    ];
    this.pendingReportPuts.set(businessDate, pending);
  }

  private indexReportPutsSync(businessDate: string): void {
    const pending = this.pendingReportPuts.get(businessDate) ?? [];
    for (const p of pending) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO night_audit_report
           (business_date, report_id, r2_key, sha256, generated_at)
         VALUES (?, ?, ?, ?, ?)`,
        businessDate,
        p.reportId,
        p.r2Key,
        p.sha256,
        p.generatedAt,
      );
    }
    this.pendingReportPuts.delete(businessDate);
  }

  private indexManifestSync(businessDate: string): void {
    this.indexReportPutsSync(businessDate);
  }

  /**
   * Test helper (unsafe-local only): arm a mid-roll failure. `runRollStepSync` will throw
   * with `message` *after* writing the advanced `__meta.business_date` and before
   * reconciling the horizon, so tests can prove the step body rolls back. Pass `null` to disarm.
   */
  async setRollFailureForTest(message: string | null): Promise<void> {
    this.assertUnsafeLocal('setRollFailureForTest');
    this.rollFailureForTest = message;
  }

  async setPostRoomChargesFailureAfterCountForTest(count: number | null): Promise<void> {
    this.assertUnsafeLocal('setPostRoomChargesFailureAfterCountForTest');
    this.postRoomChargesFailureAfterCountForTest = count;
  }

  async setReportsR2UnboundForTest(unbound: boolean): Promise<void> {
    this.assertUnsafeLocal('setReportsR2UnboundForTest');
    this.reportsR2UnboundForTest = unbound;
  }

  async setSnapshotFailureAfterPutForTest(message: string | null): Promise<void> {
    this.assertUnsafeLocal('setSnapshotFailureAfterPutForTest');
    this.snapshotFailureAfterPutForTest = message;
  }

  async countReportPutsForTest(): Promise<number> {
    this.assertUnsafeLocal('countReportPutsForTest');
    return this.reportPutCountForTest;
  }

  async listNightAuditReportsForTest(
    businessDate: string,
  ): Promise<Array<{ reportId: string; r2Key: string; sha256: string; generatedAt: number }>> {
    this.assertUnsafeLocal('listNightAuditReportsForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT report_id, r2_key, sha256, generated_at FROM night_audit_report WHERE business_date = ?`,
        businessDate,
      )
      .toArray() as Array<{
      report_id: string;
      r2_key: string;
      sha256: string;
      generated_at: number;
    }>;
    return rows.map((r) => ({
      reportId: r.report_id,
      r2Key: r.r2_key,
      sha256: r.sha256,
      generatedAt: r.generated_at,
    }));
  }

  async insertFolioLineRawForTest(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    amountMinor: number;
    source: string;
    businessDate: string;
  }): Promise<void> {
    this.assertUnsafeLocal('insertFolioLineRawForTest');
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO folio_line (
         folio_line_id, folio_window_id, reservation_id, charge_code,
         amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
         source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id
       ) VALUES (?, ?, ?, ?, ?, 'USD', ?, '1', ?, ?, ?, NULL, ?, NULL, NULL, NULL)`,
      input.folioLineId,
      input.folioWindowId,
      input.reservationId,
      input.chargeCode,
      input.amountMinor,
      input.amountMinor,
      now,
      input.source,
      input.businessDate,
      now,
    );
  }

  /**
   * `ROLL_BUSINESS_DATE` body — sync, runs inside `runAuditStep`'s `transactionSync`.
   * Refuses to advance unless `business_date < today` in the property timezone
   * (fail closed if the timezone is missing); a no-op refusal is still COMPLETED.
   * On advance: bump `__meta.business_date` by exactly one day, set-reconcile the
   * horizon onto the *new* business_date, and bump ARI / emit `availability.changed`
   * only if the reconcile actually inserted rows.
   */
  private runRollStepSync(businessDate: string): void {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) throw new Error(TIMEZONE_UNSET);

    const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
    if (businessDate >= today) {
      // Not due yet — no-op success so the Workflow / caller exits clean.
      return;
    }

    const newBusinessDate = enumerateFromDate(businessDate, 2)[1]!;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(newBusinessDate),
      Date.now(),
    );

    if (this.rollFailureForTest) throw new Error(this.rollFailureForTest);

    const { insertedCount, fromDate, toDate } = reconcileHorizon(
      this.ctx.storage.sql,
      newBusinessDate,
      this.materializedOversellAllowanceSync(),
    );
    if (insertedCount > 0) {
      const propertyId = this.getPropertyIdSync();
      const ariVersion = this.bumpAriVersionSync();
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: { propertyId, fromDate, toDate, version: ariVersion },
      });
    }
  }

  /**
   * Run all §8 steps inline for the business date currently being closed. Inline (not
   * via Workflow) so DO-level tests exercise the full sequence without a Workflow binding —
   * Task 5 switches the alarm path to `NightAuditWorkflow` while keeping this for tests.
   * Refuses outright while halted (any `FAILED` row) — never starts a new date's run.
   */
  async startNightAudit(
    census: NightAuditCensus,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (await this.isNightAuditHalted()) {
      return { ok: false, error: NIGHT_AUDIT_HALTED };
    }
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    for (const step of NIGHT_AUDIT_STEPS) {
      const result = await this.runAuditStep(
        businessDate,
        step,
        step === 'PRE_CHECK' ? census : undefined,
      );
      if (result.status === 'FAILED') {
        return { ok: false, error: result.error ?? NIGHT_AUDIT_HALTED };
      }
    }
    return { ok: true };
  }

  async tryResolveProvisionalException(
    actor: ActorContext,
    input: { exceptionId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; alreadyResolved?: true }
    | { ok: false; error: typeof NOT_FOUND | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT exception_id, business_date, resolved_at FROM provisional_exception WHERE exception_id = ?`,
              input.exceptionId,
            )
            .toArray() as Array<{
            exception_id: string;
            business_date: string;
            resolved_at: number | null;
          }>;
          const row = rows[0];
          if (!row) return { ok: false as const, error: NOT_FOUND };
          if (row.resolved_at != null) return { ok: true as const, alreadyResolved: true as const };

          const now = Date.now();
          const resolvedBy = actor.kind === 'user' ? actor.userId : this.auditActorSync(actor);
          this.ctx.storage.sql.exec(
            `UPDATE provisional_exception SET resolved_at = ?, resolved_by = ? WHERE exception_id = ?`,
            now,
            resolvedBy,
            input.exceptionId,
          );
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: PROVISIONAL_RESOLVE_EXCEPTION_COMMAND,
            entityType: 'provisional_exception',
            entityId: input.exceptionId,
            beforeJson: { resolvedAt: null },
            afterJson: { resolvedAt: now, resolvedBy },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'provisional.exception_resolved',
            payload: { propertyId, exceptionId: input.exceptionId, businessDate: row.business_date },
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryRetryAuditStep(
    actor: ActorContext,
    input: { businessDate: string; step: NightAuditStep },
    idem: IdempotencyKey,
    census: NightAuditCensus,
  ): Promise<
    | { ok: true; status: 'COMPLETED' | 'FAILED'; error?: string }
    | { ok: false; error: 'night_audit_step_not_failed' | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const prior = this.lookupIdempotentResponse<{
      ok: true;
      status: 'COMPLETED' | 'FAILED';
      error?: string;
    }>(idem);
    if (prior === 'fingerprint_mismatch') return { ok: false, error: IDEM_KEY_REUSED };
    if (prior) return prior;

    const existing = this.ctx.storage.sql
      .exec(
        `SELECT status FROM night_audit_run WHERE business_date = ? AND step = ?`,
        input.businessDate,
        input.step,
      )
      .toArray() as Array<{ status: string }>;
    if (existing[0]?.status !== 'FAILED') {
      return { ok: false, error: 'night_audit_step_not_failed' };
    }

    const result = await this.runAuditStep(input.businessDate, input.step, census);
    const attempt = (
      this.ctx.storage.sql
        .exec(
          `SELECT attempt FROM night_audit_run WHERE business_date = ? AND step = ?`,
          input.businessDate,
          input.step,
        )
        .toArray() as Array<{ attempt: number }>
    )[0]?.attempt ?? 0;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: NIGHT_AUDIT_RETRY_STEP_COMMAND,
            entityType: 'night_audit_run',
            entityId: `${input.businessDate}:${input.step}`,
            afterJson: { businessDate: input.businessDate, step: input.step, status: result.status, attempt },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'night_audit.step_retried',
            payload: {
              propertyId,
              businessDate: input.businessDate,
              step: input.step,
              attempt,
            },
          });
          return result.status === 'FAILED'
            ? { ok: true as const, status: 'FAILED' as const, error: result.error }
            : { ok: true as const, status: 'COMPLETED' as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryResolveHalt(
    actor: ActorContext,
    input: { businessDate: string },
    idem: IdempotencyKey,
    census: NightAuditCensus,
  ): Promise<
    | { ok: true; status: 'COMPLETED' | 'FAILED'; error?: string; halted: boolean }
    | { ok: false; error: typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const prior = this.lookupIdempotentResponse<{
      ok: true;
      status: 'COMPLETED' | 'FAILED';
      error?: string;
      halted: boolean;
    }>(idem);
    if (prior === 'fingerprint_mismatch') return { ok: false, error: IDEM_KEY_REUSED };
    if (prior) return prior;

    const failedRows = this.ctx.storage.sql
      .exec(
        `SELECT step, error FROM night_audit_run WHERE business_date = ? AND status = 'FAILED'`,
        input.businessDate,
      )
      .toArray() as Array<{ step: string; error: string | null }>;

    if (failedRows.length > 0) {
      for (const step of NIGHT_AUDIT_STEPS) {
        const failed = failedRows.find((r) => r.step === step);
        if (!failed) continue;
        const retried = await this.runAuditStep(input.businessDate, step, census);
        if (retried.status === 'FAILED') {
          return { ok: true, status: 'FAILED', error: retried.error, halted: true };
        }
      }
    }

    for (const step of NIGHT_AUDIT_STEPS) {
      const status = await this.getNightAuditStepStatus(input.businessDate, step);
      if (status === 'COMPLETED') continue;
      const walked = await this.runAuditStep(
        input.businessDate,
        step,
        step === 'PRE_CHECK' ? census : undefined,
      );
      if (walked.status === 'FAILED') {
        return { ok: true, status: 'FAILED', error: walked.error, halted: true };
      }
    }

    const halted = await this.isNightAuditHalted();
    const running = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS one FROM night_audit_run WHERE business_date = ? AND status = 'RUNNING' LIMIT 1`,
        input.businessDate,
      )
      .toArray();

    const payload = { ok: true as const, status: 'COMPLETED' as const, halted };

    if (!halted && running.length === 0) {
      try {
        return this.ctx.storage.transactionSync(() =>
          runIdempotent(this.ctx.storage.sql, idem, () => {
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: NIGHT_AUDIT_RESOLVE_HALT_COMMAND,
              entityType: 'night_audit_run',
              entityId: input.businessDate,
              afterJson: { businessDate: input.businessDate, halted: false },
            });
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'night_audit.halt_resolved',
              payload: { propertyId, businessDate: input.businessDate },
            });
            return payload;
          }),
        );
      } catch (e) {
        if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return payload;
  }

  private lookupIdempotentResponse<T>(idem: IdempotencyKey): T | 'fingerprint_mismatch' | null {
    const prior = this.ctx.storage.sql
      .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
      .toArray() as Array<{ request_fingerprint: string; response: string }>;
    if (prior.length === 0) return null;
    if (prior[0]!.request_fingerprint !== idem.fingerprint) {
      return 'fingerprint_mismatch';
    }
    return JSON.parse(prior[0]!.response) as T;
  }

  async readNightAuditStatus(): Promise<
    | {
        ok: true;
        businessDate: string;
        timelineDate: string;
        halted: boolean;
        closingExceptionCount: number;
        steps: Array<{
          step: NightAuditStep;
          status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
          attempt: number;
          startedAt: number | null;
          completedAt: number | null;
          error: string | null;
        }>;
        reports: Array<{ reportId: string; businessDate: string; generatedAt: number }>;
      }
    | { ok: false; error: typeof BUSINESS_DATE_UNSET }
  > {
    this.assertRpcAvailable();
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    const currentRows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM night_audit_run WHERE business_date = ? LIMIT 1`, businessDate)
      .toArray();
    let timelineDate = businessDate;
    if (currentRows.length === 0) {
      const maxRows = this.ctx.storage.sql
        .exec(`SELECT MAX(business_date) AS d FROM night_audit_run`)
        .toArray() as Array<{ d: string | null }>;
      timelineDate = maxRows[0]?.d ?? businessDate;
    }

    const runRows = this.ctx.storage.sql
      .exec(
        `SELECT step, status, attempt, started_at, completed_at, error
         FROM night_audit_run WHERE business_date = ?`,
        timelineDate,
      )
      .toArray() as Array<{
      step: string;
      status: string;
      attempt: number;
      started_at: number | null;
      completed_at: number | null;
      error: string | null;
    }>;
    const byStep = new Map(runRows.map((r) => [r.step, r]));
    const steps = NIGHT_AUDIT_STEPS.map((step) => {
      const row = byStep.get(step);
      if (!row) {
        return {
          step,
          status: 'PENDING' as const,
          attempt: 0,
          startedAt: null,
          completedAt: null,
          error: null,
        };
      }
      return {
        step,
        status: row.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
        attempt: row.attempt,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error,
      };
    });

    const closingExceptionCount = Number(
      (
        this.ctx.storage.sql
          .exec(
            `SELECT COUNT(*) AS n FROM provisional_exception
             WHERE business_date = ? AND resolved_at IS NULL`,
            businessDate,
          )
          .toArray() as Array<{ n: number }>
      )[0]?.n ?? 0,
    );

    const reportRows = this.ctx.storage.sql
      .exec(
        `SELECT report_id, business_date, generated_at FROM night_audit_report ORDER BY business_date, report_id`,
      )
      .toArray() as Array<{ report_id: string; business_date: string; generated_at: number }>;

    return {
      ok: true,
      businessDate,
      timelineDate,
      halted: await this.isNightAuditHalted(),
      closingExceptionCount,
      steps,
      reports: reportRows.map((r) => ({
        reportId: r.report_id,
        businessDate: r.business_date,
        generatedAt: r.generated_at,
      })),
    };
  }

  async readNightAuditReportIndex(
    businessDate: string,
    reportId: string,
  ): Promise<{ r2Key: string } | null> {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT r2_key FROM night_audit_report WHERE business_date = ? AND report_id = ?`,
        businessDate,
        reportId,
      )
      .toArray() as Array<{ r2_key: string }>;
    const row = rows[0];
    return row ? { r2Key: row.r2_key } : null;
  }

  async tryStartNightAudit(
    actor: ActorContext,
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; businessDate: string }
    | { ok: false; error: typeof NIGHT_AUDIT_HALTED | 'night_audit_not_due' | typeof FORBIDDEN | typeof ENTITLEMENT_REQUIRED | string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    if (await this.isNightAuditHalted()) {
      return { ok: false, error: NIGHT_AUDIT_HALTED };
    }
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
    if (businessDate >= today) {
      return { ok: false, error: 'night_audit_not_due' };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'night_audit.run',
            entityType: 'night_audit_run',
            entityId: businessDate,
            afterJson: { businessDate, started: true },
          });
          return { ok: true as const, businessDate };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private bumpAriVersionSync(): number {
    const next = this.readAriVersionSync() + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.ari_version', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(next),
      Date.now(),
    );
    return next;
  }

  async getSchemaVersion(): Promise<number> {
    this.assertRpcAvailable();
    migrateSql(this.ctx.storage.sql, [...PROPERTY_MIGRATIONS]);
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  /**
   * DOMAIN config write. Caller must pass IdempotencyKey whose fingerprint is
   * fingerprintPayload({ key, value, reason: meta.reason }).
   * `effectiveFrom` is excluded from the fingerprint.
   *
   * Trust boundary: the edge must compute `fingerprintPayload` server-side from the
   * validated request body — only the idempotency *key* may originate from the client.
   */
  async tryPutDomainConfig(
    actor: ActorContext,
    key: string,
    value: unknown,
    meta: { reason: string; effectiveFrom?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; key: string; version: number; events: string[] }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const entry = getConfigEntry(key);
    if (!entry) return { ok: false, error: `undeclared:${key}` };
    if (entry.class !== 'DOMAIN') {
      return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
    }

    const permDenied = await this.gatePermission(actor, requiredPermissionForKey(key));
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const auditActor = actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;

    try {
      const result = this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const parsed = validateConfigWrite(key, value);
          const existing = this.ctx.storage.sql
            .exec(`SELECT version, value_json FROM property_config WHERE key = ?`, key)
            .toArray() as Array<{ version: number; value_json: string }>;
          const previous = existing[0]?.value_json ?? null;
          const version = (existing[0]?.version ?? 0) + 1;
          this.ctx.storage.sql.exec(
            `INSERT INTO property_config (key, value_json, version, effective_from, updated_at, updated_by, reason, previous_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               version = excluded.version,
               effective_from = excluded.effective_from,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by,
               reason = excluded.reason,
               previous_json = excluded.previous_json`,
            key,
            JSON.stringify(parsed),
            version,
            meta.effectiveFrom ?? null,
            Date.now(),
            auditActor,
            meta.reason,
            previous,
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO property_config_audit (key, actor, reason, before_json, after_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            key,
            auditActor,
            meta.reason,
            previous,
            JSON.stringify(parsed),
            Date.now(),
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'config.changed',
            payload: {
              key,
              version,
              consumers: entry.consumers,
              actor: auditActor,
            },
          });
          const rescheduled = entry.consumers.reschedulesNightAudit && this.rescheduleNightAuditSync();
          const events: string[] = ['config.changed'];
          if (entry.consumers.invalidatesAri && this.invalidateAriSync()) {
            events.push('availability.changed');
          }
          return { ok: true as const, key, version, events, rescheduled };
        }),
      );
      if (result.ok && result.rescheduled) {
        await this.scheduler.armFromTable();
      }
      return result;
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) {
        return { ok: false, error: IDEM_KEY_REUSED };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async readConfig(key: string): Promise<unknown> {
    const entry = getConfigEntry(key);
    if (!entry) throw new UndeclaredConfigError(key);
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, key)
      .toArray() as Array<{ value_json: string }>;
    if (rows.length === 0) return entry.default;
    return JSON.parse(rows[0]!.value_json);
  }

  async seedAvailabilityDay(row: {
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked?: number;
    held?: number;
    sold?: number;
    oversell?: number;
  }): Promise<number> {
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT version FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        row.roomTypeId,
        row.stayDate,
      )
      .toArray() as Array<{ version: number }>;
    const version = (existing[0]?.version ?? 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO availability_day
        (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_type_id, stay_date) DO UPDATE SET
         physical = excluded.physical,
         blocked = excluded.blocked,
         held = excluded.held,
         sold = excluded.sold,
         oversell = excluded.oversell,
         version = excluded.version`,
      row.roomTypeId,
      row.stayDate,
      row.physical,
      row.blocked ?? 0,
      row.held ?? 0,
      row.sold ?? 0,
      row.oversell ?? 0,
      version,
    );
    return version;
  }

  async readAvailabilityDay(
    roomTypeId: string,
    stayDate: string,
  ): Promise<{
    room_type_id: string;
    stay_date: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    version: number;
    free: number;
  } | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, physical, blocked, held, sold, oversell, version
         FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
      version: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { ...row, free: freeAvailability(row) };
  }

  async readAvailabilityRange(
    fromDate: string,
    toDate: string,
    roomTypeId?: string,
  ): Promise<{
    ariVersion: number;
    rows: Array<{
      roomTypeId: string;
      stayDate: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
    }>;
  }> {
    this.assertRpcAvailable();
    const ariVersion = this.readAriVersionSync();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id AS roomTypeId, stay_date AS stayDate,
                physical, blocked, held, sold, oversell
           FROM availability_day
          WHERE stay_date >= ? AND stay_date <= ?
            AND (? IS NULL OR room_type_id = ?)
          ORDER BY room_type_id, stay_date`,
        fromDate,
        toDate,
        roomTypeId ?? null,
        roomTypeId ?? null,
      )
      .toArray() as Array<{
      roomTypeId: string;
      stayDate: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
    }>;

    return { ariVersion, rows };
  }

  /**
   * Insert an active `room_type` row and seed the horizon (365 days from "today" in
   * the property's stored timezone) with `availability_day` rows at `physical = roomCount`.
   * Fingerprint allowlist: `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }`.
   */
  async tryAddRoomType(
    actor: ActorContext,
    input: {
      roomTypeId: string;
      code: string;
      name: string;
      roomCount: number;
      maxOccupancy: number;
      maxAdults: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: string }
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    // Preconditions are checked *before* entering runIdempotent: a precondition
    // failure must never be cached under the idempotency key, or fixing the
    // precondition (e.g. provisioning the timezone) and replaying the same key
    // would keep returning the stale cached failure forever.
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const exists = this.ctx.storage.sql
            .exec(`SELECT room_type_id FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray();
          if (exists.length > 0) throw new RoomTypeExistsError();

          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT room_type_id FROM room_type WHERE code = ? AND status = 'active'`, input.code)
            .toArray();
          if (codeTaken.length > 0) throw new RoomTypeCodeExistsError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            input.roomTypeId,
            input.code,
            input.name,
            input.roomCount,
            input.maxOccupancy,
            input.maxAdults,
            now,
            now,
          );

          // Horizon is always anchored to __meta.business_date, never wall clock.
          const dates = enumerateFromDate(businessDate);
          const ledgerOversell = this.materializedOversellAllowanceSync();
          for (const stayDate of dates) {
            this.ctx.storage.sql.exec(
              `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
               VALUES (?, ?, ?, 0, 0, 0, ?, 1)`,
              input.roomTypeId,
              stayDate,
              input.roomCount,
              ledgerOversell,
            );
          }

          const ariVersion = this.bumpAriVersionSync();
          const fromDate = dates[0]!;
          const toDate = dates[dates.length - 1]!;

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'add', at: now },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'availability.changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'inventory.add_room_type',
            entityType: 'room_type',
            entityId: input.roomTypeId,
            beforeJson: null,
            afterJson: {
              roomTypeId: input.roomTypeId,
              code: input.code,
              name: input.name,
              roomCount: input.roomCount,
              maxOccupancy: input.maxOccupancy,
              maxAdults: input.maxAdults,
              status: 'active',
            },
          });

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RoomTypeExistsError) return { ok: false, error: ROOM_TYPE_EXISTS };
      if (e instanceof RoomTypeCodeExistsError) return { ok: false, error: ROOM_TYPE_CODE_EXISTS };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update an active `room_type`'s columns. Never inserts `availability_day` rows —
   * only updates existing rows from "today" forward when `roomCount` changes.
   * Fingerprint allowlist: `{ roomTypeId, code?, name?, roomCount?, maxOccupancy?, maxAdults? }`.
   */
  async tryUpdateRoomType(
    actor: ActorContext,
    input: {
      roomTypeId: string;
      code?: string;
      name?: string;
      roomCount?: number;
      maxOccupancy?: number;
      maxAdults?: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate?: string; toDate?: string }
    | { ok: false; error: typeof OVERSELL; dates: string[] }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN }
    | { ok: false; error: 'not_member' }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: typeof ROOM_TYPE_CODE_EXISTS }
    | { ok: false; error: typeof ROOM_UNITS_EXCEED_COUNT }
    | { ok: false; error: 'internal_error' }
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingRows = this.ctx.storage.sql
            .exec(
              `SELECT code, name, room_count, max_occupancy, max_adults, status FROM room_type WHERE room_type_id = ?`,
              input.roomTypeId,
            )
            .toArray() as Array<{
            code: string;
            name: string;
            room_count: number;
            max_occupancy: number;
            max_adults: number;
            status: string;
          }>;
          const existing = existingRows[0];
          if (!existing || existing.status !== 'active') {
            // Thrown, not returned: a not-found/inactive room type is a precondition
            // failure and must roll back without being cached under the idempotency key.
            throw new RoomTypeNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          const nextRoomCount = input.roomCount ?? existing.room_count;
          const roomCountChanged = input.roomCount !== undefined && input.roomCount !== existing.room_count;

          if (roomCountChanged && nextRoomCount < existing.room_count) {
            const unitCount = Number(
              (
                this.ctx.storage.sql
                  .exec(`SELECT COUNT(*) AS c FROM room WHERE room_type_id = ?`, input.roomTypeId)
                  .toArray() as Array<{ c: number }>
              )[0]?.c ?? 0,
            );
            if (nextRoomCount < unitCount) {
              throw new RoomUnitsExceedCountError();
            }
          }

          let fromDate: string | undefined;
          let toDate: string | undefined;

          if (roomCountChanged) {
            const futureRows = this.ctx.storage.sql
              .exec(
                `SELECT stay_date, physical, blocked, held, sold, oversell FROM availability_day
                 WHERE room_type_id = ? AND stay_date >= ? ORDER BY stay_date`,
                input.roomTypeId,
                today,
              )
              .toArray() as Array<{
              stay_date: string;
              physical: number;
              blocked: number;
              held: number;
              sold: number;
              oversell: number;
            }>;

            const inventoryRows: InventoryRow[] = futureRows.map((row) => ({
              stayDate: row.stay_date,
              physical: row.physical,
              blocked: row.blocked,
              held: row.held,
              sold: row.sold,
              oversell: row.oversell,
            }));
            const overDates = oversellDates(inventoryRows, nextRoomCount);
            if (overDates.length > 0) {
              // Thrown for the same reason: oversell is a precondition failure on the
              // *current* ledger state, and must be retryable with the same idempotency
              // key once the underlying demand or requested roomCount changes.
              throw new OversellError(overDates);
            }

            for (const row of futureRows) {
              this.ctx.storage.sql.exec(
                `UPDATE availability_day SET physical = ?, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
                nextRoomCount,
                input.roomTypeId,
                row.stay_date,
              );
            }
            if (futureRows.length > 0) {
              fromDate = futureRows[0]!.stay_date;
              toDate = futureRows[futureRows.length - 1]!.stay_date;
            }
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room_type SET code = ?, name = ?, room_count = ?, max_occupancy = ?, max_adults = ?, updated_at = ? WHERE room_type_id = ?`,
            input.code ?? existing.code,
            input.name ?? existing.name,
            nextRoomCount,
            input.maxOccupancy ?? existing.max_occupancy,
            input.maxAdults ?? existing.max_adults,
            now,
            input.roomTypeId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'update', at: now },
          });

          // Only writes touched availability_day rows bump the property ARI counter.
          const ariVersion = roomCountChanged ? this.bumpAriVersionSync() : this.readAriVersionSync();
          if (fromDate && toDate) {
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
            });
          }

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'inventory.update_room_type',
            entityType: 'room_type',
            entityId: input.roomTypeId,
            beforeJson: {
              code: existing.code,
              name: existing.name,
              roomCount: existing.room_count,
              maxOccupancy: existing.max_occupancy,
              maxAdults: existing.max_adults,
            },
            afterJson: {
              code: input.code ?? existing.code,
              name: input.name ?? existing.name,
              roomCount: nextRoomCount,
              maxOccupancy: input.maxOccupancy ?? existing.max_occupancy,
              maxAdults: input.maxAdults ?? existing.max_adults,
            },
          });

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof OversellError) return { ok: false, error: OVERSELL, dates: e.dates };
      if (e instanceof RoomUnitsExceedCountError) {
        return { ok: false, error: ROOM_UNITS_EXCEED_COUNT };
      }
      if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: 'internal_error' };
    }
  }

  /**
   * Archive an active `room_type`: guard on committed future demand, then set
   * `status = 'archived'` and zero `physical` on all rows from "today" forward.
   * Fingerprint allowlist: `{ roomTypeId }`.
   */
  async tryDeleteRoomType(
    actor: ActorContext,
    input: { roomTypeId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number }
    | { ok: false; error: typeof ARCHIVE_BLOCKED }
    | { ok: false; error: string }
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string }>;
          if (!existingRows[0] || existingRows[0].status !== 'active') {
            // Thrown, not returned — see tryUpdateRoomType for why.
            throw new RoomTypeNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          const futureRows = this.ctx.storage.sql
            .exec(
              `SELECT stay_date, physical, blocked, held, sold, oversell FROM availability_day
               WHERE room_type_id = ? AND stay_date >= ? ORDER BY stay_date`,
              input.roomTypeId,
              today,
            )
            .toArray() as Array<{
            stay_date: string;
            physical: number;
            blocked: number;
            held: number;
            sold: number;
            oversell: number;
          }>;

          const inventoryRows: InventoryRow[] = futureRows.map((row) => ({
            stayDate: row.stay_date,
            physical: row.physical,
            blocked: row.blocked,
            held: row.held,
            sold: row.sold,
            oversell: row.oversell,
          }));
          if (archiveBlocked(inventoryRows)) {
            throw new ArchiveBlockedError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room_type SET status = 'archived', updated_at = ? WHERE room_type_id = ?`,
            now,
            input.roomTypeId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'archive', at: now },
          });

          // Only touch the ledger / bump ARI / emit availability.changed when there were
          // actually future rows to zero out — an archive with zero future rows still
          // always emits inventory.room_type_changed above, but there is no availability
          // range to report and no ARI-relevant write happened.
          let ariVersion = this.readAriVersionSync();
          if (futureRows.length > 0) {
            this.ctx.storage.sql.exec(
              `UPDATE availability_day SET physical = 0, version = version + 1 WHERE room_type_id = ? AND stay_date >= ?`,
              input.roomTypeId,
              today,
            );
            ariVersion = this.bumpAriVersionSync();
            const fromDate = futureRows[0]!.stay_date;
            const toDate = futureRows[futureRows.length - 1]!.stay_date;
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
            });
          }

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'inventory.delete_room_type',
            entityType: 'room_type',
            entityId: input.roomTypeId,
            beforeJson: { status: 'active' },
            afterJson: { status: 'archived' },
          });

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ArchiveBlockedError) return { ok: false, error: ARCHIVE_BLOCKED };
      if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Create a physical room unit. Implements catalog `rooms.create`.
   * Fingerprint allowlist: `{ roomId, roomTypeId, code, floor? }`.
   * Never touches availability_day / ARI.
   */
  async tryCreateRoom(
    actor: ActorContext,
    input: { roomId: string; roomTypeId: string; code: string; floor?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ROOM_CODE_EXISTS }
    | { ok: false; error: typeof ROOM_COUNT_EXCEEDED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const typeRows = this.ctx.storage.sql
            .exec(
              `SELECT room_count, status FROM room_type WHERE room_type_id = ?`,
              input.roomTypeId,
            )
            .toArray() as Array<{ room_count: number; status: string }>;
          const roomType = typeRows[0];
          if (!roomType || roomType.status !== 'active') {
            throw new RoomTypeNotFoundError();
          }

          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT room_id FROM room WHERE code = ?`, input.code)
            .toArray();
          if (codeTaken.length > 0) throw new RoomCodeExistsError();

          const unitCount = Number(
            (
              this.ctx.storage.sql
                .exec(`SELECT COUNT(*) AS c FROM room WHERE room_type_id = ?`, input.roomTypeId)
                .toArray() as Array<{ c: number }>
            )[0]?.c ?? 0,
          );
          if (unitCount >= roomType.room_count) {
            throw new RoomCountExceededError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
             VALUES (?, ?, ?, 'clean', ?, ?, ?)`,
            input.roomId,
            input.roomTypeId,
            input.code,
            input.floor ?? null,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'room.created',
            payload: {
              propertyId,
              roomId: input.roomId,
              roomTypeId: input.roomTypeId,
              code: input.code,
              floor: input.floor ?? null,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rooms.create',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: null,
            afterJson: {
              roomId: input.roomId,
              roomTypeId: input.roomTypeId,
              code: input.code,
              floor: input.floor ?? null,
            },
          });

          return { ok: true as const, roomId: input.roomId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
      if (e instanceof RoomCodeExistsError) return { ok: false, error: ROOM_CODE_EXISTS };
      if (e instanceof RoomCountExceededError) return { ok: false, error: ROOM_COUNT_EXCEEDED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update room code/floor only. Implements catalog `rooms.update`.
   * Fingerprint allowlist: `{ roomId, code?, floor? }`.
   * Never accepts roomTypeId — room_type_id is immutable after create.
   */
  async tryUpdateRoom(
    actor: ActorContext,
    input: { roomId: string; code?: string; floor?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ROOM_CODE_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(`SELECT code, floor FROM room WHERE room_id = ?`, input.roomId)
            .toArray() as Array<{ code: string; floor: string | null }>;
          const existing = rows[0];
          if (!existing) throw new RoomNotFoundError();

          const nextCode = input.code ?? existing.code;
          const nextFloor = input.floor !== undefined ? input.floor : existing.floor;

          if (input.code !== undefined && input.code !== existing.code) {
            const codeTaken = this.ctx.storage.sql
              .exec(`SELECT room_id FROM room WHERE code = ? AND room_id != ?`, input.code, input.roomId)
              .toArray();
            if (codeTaken.length > 0) throw new RoomCodeExistsError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room SET code = ?, floor = ?, updated_at = ? WHERE room_id = ?`,
            nextCode,
            nextFloor,
            now,
            input.roomId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'room.updated',
            payload: {
              propertyId,
              roomId: input.roomId,
              code: nextCode,
              floor: nextFloor,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rooms.update',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: { code: existing.code, floor: existing.floor },
            afterJson: { code: nextCode, floor: nextFloor },
          });

          return { ok: true as const, roomId: input.roomId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      if (e instanceof RoomCodeExistsError) return { ok: false, error: ROOM_CODE_EXISTS };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update a single room's housekeeping status. Implements `rooms.update_status`.
   * Fingerprint allowlist: `{ roomId, status }`.
   * QUEUE_PROVISIONAL — no entitlement gate.
   */
  async tryUpdateRoomStatus(
    actor: ActorContext,
    input: { roomId: string; status: string },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; roomId: string; status: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' | 'invalid_status' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!isRoomStatus(input.status)) {
      return { ok: false, error: 'invalid_status' };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          return updateRoomStatus(this.moduleTxnCtx(orgId, propertyId, provisional), input);
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Bulk room status update. Implements `rooms.bulk_update_status`.
   * Fingerprint allowlist: `{ updates }` with updates sorted by roomId at the edge.
   * Catalog lane BULK — still uses touchInteractive (no touchBulk on LaneGuard).
   */
  async tryBulkUpdateRoomStatus(
    actor: ActorContext,
    input: { updates: Array<{ roomId: string; status: string }> },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; roomIds: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' | 'invalid_status' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    for (const u of input.updates) {
      if (!isRoomStatus(u.status)) {
        return { ok: false, error: 'invalid_status' };
      }
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          return bulkUpdateRoomStatus(this.moduleTxnCtx(orgId, propertyId, provisional), input);
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Assign a physical room to a reservation. Implements `reservations.assign_room`.
   * Fingerprint allowlist: `{ reservationId, roomId }`.
   * FAIL_CLOSED — no provisional parameter. Overlap uses half-open [arrival, departure).
   */
  async tryAssignRoom(
    actor: ActorContext,
    input: { reservationId: string; roomId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; roomId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ROOM_TYPE_MISMATCH }
    | { ok: false; error: typeof ROOM_ALREADY_ASSIGNED }
    | { ok: false; error: typeof ROOM_NOT_ASSIGNABLE }
    | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, arrival_date, departure_date, status, room_id
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            room_id: string | null;
          }>;
          const reservation = resRows[0];
          if (!reservation) throw new RoomNotFoundError();

          if (
            reservation.status !== 'pending' &&
            reservation.status !== 'confirmed' &&
            reservation.status !== 'checked_in'
          ) {
            throw new RoomNotAssignableError();
          }

          const roomRows = this.ctx.storage.sql
            .exec(`SELECT room_type_id, status FROM room WHERE room_id = ?`, input.roomId)
            .toArray() as Array<{ room_type_id: string; status: string }>;
          const room = roomRows[0];
          if (!room) throw new RoomNotFoundError();

          if (room.status === 'out_of_order') {
            throw new RoomOutOfOrderError();
          }

          if (room.room_type_id !== reservation.room_type_id) {
            throw new RoomTypeMismatchError();
          }

          const conflict = this.ctx.storage.sql
            .exec(
              `SELECT reservation_id FROM reservation
               WHERE room_id = ?
                 AND reservation_id != ?
                 AND status IN ('pending', 'confirmed', 'checked_in')
                 AND arrival_date < ?
                 AND departure_date > ?
               LIMIT 1`,
              input.roomId,
              input.reservationId,
              reservation.departure_date,
              reservation.arrival_date,
            )
            .toArray();
          if (conflict.length > 0) throw new RoomAlreadyAssignedError();

          const now = Date.now();
          const previousRoomId = reservation.room_id;
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET room_id = ?, updated_at = ? WHERE reservation_id = ?`,
            input.roomId,
            now,
            input.reservationId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.room_assigned',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              roomId: input.roomId,
              previousRoomId,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.assign_room',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { roomId: previousRoomId },
            afterJson: { roomId: input.roomId },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            roomId: input.roomId,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      if (e instanceof RoomTypeMismatchError) return { ok: false, error: ROOM_TYPE_MISMATCH };
      if (e instanceof RoomAlreadyAssignedError) return { ok: false, error: ROOM_ALREADY_ASSIGNED };
      if (e instanceof RoomNotAssignableError) return { ok: false, error: ROOM_NOT_ASSIGNABLE };
      if (e instanceof RoomOutOfOrderError) return { ok: false, error: ROOM_OUT_OF_ORDER };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Assign a room to a housekeeper for a business date. Implements `housekeeping.assign`.
   * Fingerprint allowlist: `{ roomId, businessDate, assigneeRef }`.
   * businessDate is format-validated only — deliberately unbounded vs open business date.
   */
  async tryAssignHousekeeping(
    actor: ActorContext,
    input: { roomId: string; businessDate: string; assigneeRef: string },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; assignmentId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' | 'invalid_business_date' | 'invalid_assignee_ref' }
    | {
        ok: false;
        error:
          | 'org_unreachable'
          | typeof STAFF_NOT_FOUND
          | typeof STAFF_EXITED
          | typeof STAFF_NOT_ASSIGNABLE;
      }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!STAY_DATE_RE.test(input.businessDate)) {
      return { ok: false, error: 'invalid_business_date' };
    }
    if (!isStaffRef(input.assigneeRef)) {
      return { ok: false, error: 'invalid_assignee_ref' };
    }

    const staffGate = await this.gateStaffRef(orgId, input.assigneeRef);
    if (!staffGate.ok) return staffGate;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          return assignHousekeeping(this.moduleTxnCtx(orgId, propertyId, provisional), input);
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof InvalidAssigneeRefError) return { ok: false, error: 'invalid_assignee_ref' };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listRooms(filters?: {
    roomTypeId?: string;
    status?: string;
  }): Promise<{
    ok: true;
    rooms: Array<{
      roomId: string;
      roomTypeId: string;
      code: string;
      status: string;
      floor: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
  }> {
    this.assertRpcAvailable();
    const roomTypeId = filters?.roomTypeId ?? null;
    const status = filters?.status ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_id, room_type_id, code, status, floor, created_at, updated_at
         FROM room
         WHERE (? IS NULL OR room_type_id = ?)
           AND (? IS NULL OR status = ?)
         ORDER BY code`,
        roomTypeId,
        roomTypeId,
        status,
        status,
      )
      .toArray() as Array<{
      room_id: string;
      room_type_id: string;
      code: string;
      status: string;
      floor: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return {
      ok: true,
      rooms: rows.map((r) => ({
        roomId: r.room_id,
        roomTypeId: r.room_type_id,
        code: r.code,
        status: r.status,
        floor: r.floor,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async readHousekeepingAssignments(businessDate: string): Promise<
    | {
        ok: true;
        assignments: Array<{
          assignmentId: string;
          roomId: string;
          businessDate: string;
          assigneeRef: string;
          createdAt: number;
          updatedAt: number;
        }>;
      }
    | { ok: false; error: 'invalid_business_date' }
  > {
    this.assertRpcAvailable();
    if (!STAY_DATE_RE.test(businessDate)) {
      return { ok: false, error: 'invalid_business_date' };
    }
    return readAssignments(this.ctx.storage.sql, { businessDate });
  }

  private assertOccupancySync(roomTypeId: string, adults: number, children: number): void {
    const rows = this.ctx.storage.sql
      .exec(`SELECT max_occupancy, max_adults FROM room_type WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ max_occupancy: number; max_adults: number }>;
    const rt = rows[0];
    if (!rt) throw new RoomTypeNotFoundError();
    if (adults > rt.max_adults || adults + children > rt.max_occupancy) {
      throw new OccupancyExceededError();
    }
  }

  private snapshotPenaltyFromPlanSync(ratePlanId: string): {
    cancelPenaltyType: string;
    cancelGraceHours: number;
    cancelPenaltyNights: number | null;
    cancelPenaltyBps: number | null;
  } {
    this.assertActiveRatePlanSync(ratePlanId);
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps
         FROM rate_plan WHERE rate_plan_id = ?`,
        ratePlanId,
      )
      .toArray() as Array<{
      cancel_penalty_type: string;
      cancel_grace_hours: number;
      cancel_penalty_nights: number | null;
      cancel_penalty_bps: number | null;
    }>;
    const row = rows[0];
    if (!row) throw new RatePlanNotFoundError();
    return {
      cancelPenaltyType: row.cancel_penalty_type,
      cancelGraceHours: row.cancel_grace_hours,
      cancelPenaltyNights: row.cancel_penalty_nights,
      cancelPenaltyBps: row.cancel_penalty_bps,
    };
  }

  private rateDayAmountSync(roomTypeId: string, ratePlanId: string, stayDate: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
        roomTypeId,
        ratePlanId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number }>;
    if (!rows[0]) throw new RateMissingError(stayDate);
    return rows[0].amount_minor;
  }

  private stayTotalMinorSync(roomTypeId: string, ratePlanId: string, nights: string[]): number {
    let total = 0;
    for (const stayDate of nights) {
      total += this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate);
    }
    return total;
  }

  /**
   * Snapshotted cancel/no-show penalty in ledger minor units.
   * Inquiry and type `none` are 0; in-grace is 0; missing rate_day throws RateMissingError.
   */
  private penaltyMinor(
    row: {
      status: string;
      arrival_date: string;
      departure_date: string;
      room_type_id: string;
      rate_plan_id: string;
      cancel_penalty_type: string;
      cancel_grace_hours: number;
      cancel_penalty_nights: number | null;
      cancel_penalty_bps: number | null;
    },
    nowMs: number,
    timeZone: string,
  ): number {
    if (row.status === 'inquiry') return 0;
    if (row.cancel_penalty_type === 'none') return 0;
    const arrivalStart = zonedMidnightMs(row.arrival_date, timeZone);
    if (nowMs < arrivalStart - row.cancel_grace_hours * 3_600_000) return 0;

    const nights = enumerateStayDates(row.arrival_date, row.departure_date);
    if (row.cancel_penalty_type === 'first_night') {
      return this.rateDayAmountSync(row.room_type_id, row.rate_plan_id, row.arrival_date);
    }
    if (row.cancel_penalty_type === 'nights') {
      const count = Math.min(row.cancel_penalty_nights ?? 0, nights.length);
      if (count < 1) throw new RateMissingError(row.arrival_date);
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += this.rateDayAmountSync(row.room_type_id, row.rate_plan_id, nights[i]!);
      }
      return total;
    }
    const stayTotal = this.stayTotalMinorSync(row.room_type_id, row.rate_plan_id, nights);
    if (row.cancel_penalty_type === 'full') return stayTotal;
    if (row.cancel_penalty_type === 'percent') {
      const bps = row.cancel_penalty_bps ?? 0;
      return Number(roundHalfAwayFromZero(BigInt(stayTotal) * BigInt(bps), 10000n));
    }
    return 0;
  }

  private postDeskPenaltySync(
    reservationId: string,
    chargeCode: 'CANCEL' | 'NO_SHOW',
    amountMinor: number,
    businessDate: string,
  ): void {
    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) throw new Error(CURRENCY_UNSET);
    this.ensureGuestFolioWindowSync(reservationId);
    const folioWindowId = this.readGuestFolioWindowIdSync(reservationId);
    const fxRateAt = Date.now();
    const posted: PostedLineAmount = {
      amountMinor,
      txnCurrency: ledgerCurrency,
      ledgerAmountMinor: amountMinor,
      fxRate: '1',
      fxRateAt,
    };
    const suffix = chargeCode === 'CANCEL' ? 'cancel' : 'noshow';
    const folioLineId = `${reservationId}:${suffix}:${businessDate}`;
    this.assertChargeCodeSync(chargeCode, { requireActive: true });
    this.insertFolioLineSync({
      folioLineId,
      folioWindowId,
      reservationId,
      chargeCode,
      posted,
      source: 'DESK',
      businessDate,
    });
    this.stampTaxForChargeSync({
      parentLineId: folioLineId,
      parentAmountMinor: amountMinor,
      parentSource: 'DESK',
      chargeCode,
      reservationId,
      folioWindowId,
      postingDate: businessDate,
      posted,
    });
  }

  private commitSoldNightsSync(roomTypeId: string, arrivalDate: string, departureDate: string, nights: string[]): void {
    const rowsByDate = new Map<string, AvailabilitySnapshot>();
    for (const stayDate of nights) {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT physical, blocked, held, sold, oversell FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
          roomTypeId,
          stayDate,
        )
        .toArray() as Array<{
        physical: number;
        blocked: number;
        held: number;
        sold: number;
        oversell: number;
      }>;
      if (rows.length === 0) {
        throw new UnbookableError(stayDate);
      }
      const row = rows[0]!;
      rowsByDate.set(stayDate, {
        stayDate,
        physical: row.physical,
        blocked: row.blocked,
        held: row.held,
        sold: row.sold,
        oversell: row.oversell,
      });
    }
    const unavailable = firstUnavailableNight(nights, rowsByDate);
    if (unavailable) {
      throw new NoAvailabilityError(unavailable);
    }
    this.restrictionFailureSync(roomTypeId, arrivalDate, departureDate, nights);
    for (const stayDate of nights) {
      this.ctx.storage.sql.exec(
        `UPDATE availability_day SET sold = sold + 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        stayDate,
      );
    }
  }

  private releaseSoldNightsSync(roomTypeId: string, nights: string[]): void {
    for (const stayDate of nights) {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
          roomTypeId,
          stayDate,
        )
        .toArray() as Array<{ sold: number }>;
      if (rows.length === 0 || rows[0]!.sold < 1) {
        throw new LedgerInconsistentError(stayDate);
      }
    }
    for (const stayDate of nights) {
      this.ctx.storage.sql.exec(
        `UPDATE availability_day SET sold = sold - 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        stayDate,
      );
    }
  }

  /** Lazy expiry: due pending/inquiry → cancelled. Pending releases sold. Returns the expired kind. */
  private expireIfDueSync(
    reservationId: string,
    nowMs: number,
  ): { kind: 'pending' | 'inquiry'; ariVersion: number; fromDate: string; toDate: string } | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT status, confirm_by, expires_at, room_type_id, arrival_date, departure_date, guest_ref, pii_key_id
         FROM reservation WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{
      status: string;
      confirm_by: number | null;
      expires_at: number | null;
      room_type_id: string;
      arrival_date: string;
      departure_date: string;
      guest_ref: string;
      pii_key_id: string;
    }>;
    const row = rows[0];
    if (!row) return null;
    const pendingDue = row.status === 'pending' && row.confirm_by != null && row.confirm_by <= nowMs;
    const inquiryDue =
      row.status === 'inquiry' && row.expires_at != null && row.expires_at <= nowMs;
    if (!pendingDue && !inquiryDue) return null;

    const nights = enumerateStayDates(row.arrival_date, row.departure_date);
    const fromDate = nights[0]!;
    const toDate = nights[nights.length - 1]!;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    if (pendingDue) {
      this.releaseSoldNightsSync(row.room_type_id, nights);
    }

    this.ctx.storage.sql.exec(
      `UPDATE reservation SET status = 'cancelled', updated_at = ? WHERE reservation_id = ?`,
      nowMs,
      reservationId,
    );

    const ariVersion = pendingDue ? this.bumpAriVersionSync() : this.readAriVersionSync();
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'reservation.status_changed',
      payload: {
        propertyId,
        reservationId,
        guestRef: row.guest_ref,
        piiKeyId: row.pii_key_id,
        fromStatus: row.status,
        toStatus: 'cancelled',
        reason: 'expired',
      },
    });
    if (pendingDue) {
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: { propertyId, roomTypeId: row.room_type_id, fromDate, toDate, version: ariVersion },
      });
    }
    return { kind: pendingDue ? 'pending' : 'inquiry', ariVersion, fromDate, toDate };
  }

  private expiredWire(
    expired: { kind: 'pending' | 'inquiry' } | null,
  ): { ok: false; error: typeof HOLD_EXPIRED } | { ok: false; error: typeof INQUIRY_EXPIRED } | null {
    if (expired?.kind === 'pending') return { ok: false, error: HOLD_EXPIRED };
    if (expired?.kind === 'inquiry') return { ok: false, error: INQUIRY_EXPIRED };
    return null;
  }

  /**
   * Create a confirmed reservation and increment `sold` on every stay night in one atomic
   * write. Implements catalog `reservations.create` / platform gap `availability.book`.
   * Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate, guestRef }`.
   * `piiKeyId` is never accepted from the caller — it is looked up via `gateGuestRef`.
   */
  async tryCreateReservation(
    actor: ActorContext,
    input: {
      reservationId: string;
      roomTypeId: string;
      guestRef: string;
      arrivalDate: string;
      departureDate: string;
      status?: 'inquiry' | 'pending' | 'confirmed';
      adults?: number;
      children?: number;
      ratePlanId?: string;
      confirmBy?: number;
      expiresAt?: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number }
    | { ok: false; error: typeof UNBOOKABLE; date: string }
    | { ok: false; error: typeof RESTRICTION_VIOLATED; rule: string; date: string; required?: number }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
    | { ok: false; error: 'org_unreachable' }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(input.arrivalDate) || !dateRe.test(input.departureDate)) {
      return { ok: false, error: 'invalid_date' };
    }
    if (!input.guestRef) {
      return { ok: false, error: 'guest_ref_required' };
    }
    if (input.arrivalDate >= input.departureDate) {
      return { ok: false, error: 'invalid_stay_range' };
    }

    let nights: string[];
    try {
      nights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: 'invalid_stay_range' };
    }

    const guestGate = await this.gateGuestRef(orgId, input.guestRef);
    if (!guestGate.ok) return guestGate;
    const piiKeyId = guestGate.piiKeyId;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const status = input.status ?? 'confirmed';
          if (status !== 'inquiry' && status !== 'pending' && status !== 'confirmed') {
            throw new Error('invalid_status');
          }
          const adults = input.adults ?? 1;
          const children = input.children ?? 0;
          const ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID;
          const now = Date.now();

          const roomRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string }>;
          if (!roomRows[0] || roomRows[0].status !== 'active') {
            throw new RoomTypeNotFoundError();
          }
          this.assertOccupancySync(input.roomTypeId, adults, children);
          this.assertActiveRatePlanSync(ratePlanId);

          const commitsInventory = status === 'pending' || status === 'confirmed';
          if (commitsInventory) {
            this.commitSoldNightsSync(input.roomTypeId, input.arrivalDate, input.departureDate, nights);
          }

          const snapshot = commitsInventory
            ? this.snapshotPenaltyFromPlanSync(ratePlanId)
            : {
                cancelPenaltyType: 'none',
                cancelGraceHours: 0,
                cancelPenaltyNights: null as number | null,
                cancelPenaltyBps: null as number | null,
              };
          const holdHours = Number(this.readConfigValueSync('pms.reservations.pending_hold_hours') ?? 24);
          const ttlDays = Number(this.readConfigValueSync('pms.reservations.inquiry_ttl_days') ?? 7);
          const confirmBy =
            status === 'pending' ? (input.confirmBy ?? now + holdHours * 3600_000) : null;
          const expiresAt =
            status === 'inquiry' ? (input.expiresAt ?? now + ttlDays * 86_400_000) : null;

          this.ctx.storage.sql.exec(
            `INSERT INTO reservation (
               reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
               status, adults, children, rate_plan_id, cancel_penalty_type, cancel_grace_hours,
               cancel_penalty_nights, cancel_penalty_bps, confirm_by, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.reservationId,
            input.roomTypeId,
            input.guestRef,
            piiKeyId,
            input.arrivalDate,
            input.departureDate,
            status,
            adults,
            children,
            ratePlanId,
            snapshot.cancelPenaltyType,
            snapshot.cancelGraceHours,
            snapshot.cancelPenaltyNights,
            snapshot.cancelPenaltyBps,
            confirmBy,
            expiresAt,
            now,
            now,
          );
          this.ensureGuestFolioWindowSync(input.reservationId);

          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;
          const ariVersion = commitsInventory ? this.bumpAriVersionSync() : this.readAriVersionSync();

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.created',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              roomTypeId: input.roomTypeId,
              guestRef: input.guestRef,
              piiKeyId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
              status,
            },
          });
          if (commitsInventory) {
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
            });
          }

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.create',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: null,
            afterJson: {
              reservationId: input.reservationId,
              roomTypeId: input.roomTypeId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
              status,
            },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            ariVersion,
            fromDate,
            toDate,
          };
        }),
      );
    } catch (e) {
      if (e instanceof NoAvailabilityError) {
        return {
          ok: false,
          error: NO_AVAILABILITY,
          date: e.date,
          ariVersion: this.readAriVersionSync(),
        };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryConfirm(
    actor: ActorContext,
    input: { reservationId: string; ratePlanId?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NOT_FOUND | typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED | typeof INVALID_STATUS_TRANSITION | typeof NO_AVAILABILITY; date?: string; ariVersion?: number }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredErr = this.expiredWire(expired);
          if (expiredErr) return expiredErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, adults, children
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            rate_plan_id: string;
            adults: number;
            children: number;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'inquiry' && reservation.status !== 'pending') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }
          const ratePlanId = input.ratePlanId ?? reservation.rate_plan_id;
          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;
          const now = Date.now();
          const fromInquiry = reservation.status === 'inquiry';
          if (fromInquiry) {
            this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children);
            this.commitSoldNightsSync(
              reservation.room_type_id,
              reservation.arrival_date,
              reservation.departure_date,
              nights,
            );
            const snapshot = this.snapshotPenaltyFromPlanSync(ratePlanId);
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET status = 'confirmed', rate_plan_id = ?, cancel_penalty_type = ?,
               cancel_grace_hours = ?, cancel_penalty_nights = ?, cancel_penalty_bps = ?,
               confirm_by = NULL, expires_at = NULL, updated_at = ? WHERE reservation_id = ?`,
              ratePlanId,
              snapshot.cancelPenaltyType,
              snapshot.cancelGraceHours,
              snapshot.cancelPenaltyNights,
              snapshot.cancelPenaltyBps,
              now,
              input.reservationId,
            );
          } else {
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET status = 'confirmed', confirm_by = NULL, updated_at = ? WHERE reservation_id = ?`,
              now,
              input.reservationId,
            );
          }
          const ariVersion = fromInquiry ? this.bumpAriVersionSync() : this.readAriVersionSync();
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: reservation.status,
              toStatus: 'confirmed',
            },
          });
          if (fromInquiry) {
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: reservation.room_type_id, fromDate, toDate, version: ariVersion },
            });
          }
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.confirm',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: reservation.status },
            afterJson: { status: 'confirmed' },
            reservationId: input.reservationId,
          });
          return { ok: true as const, reservationId: input.reservationId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof NoAvailabilityError) {
        return { ok: false, error: NO_AVAILABILITY, date: e.date, ariVersion: this.readAriVersionSync() };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryHold(
    actor: ActorContext,
    input: { reservationId: string; ratePlanId?: string; confirmBy?: number },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NOT_FOUND | typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED | typeof INVALID_STATUS_TRANSITION | typeof NO_AVAILABILITY; date?: string; ariVersion?: number }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredErr = this.expiredWire(expired);
          if (expiredErr) return expiredErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, adults, children
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            rate_plan_id: string;
            adults: number;
            children: number;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'inquiry') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }
          const ratePlanId = input.ratePlanId ?? reservation.rate_plan_id;
          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children);
          this.commitSoldNightsSync(
            reservation.room_type_id,
            reservation.arrival_date,
            reservation.departure_date,
            nights,
          );
          const snapshot = this.snapshotPenaltyFromPlanSync(ratePlanId);
          const now = Date.now();
          const holdHours = Number(this.readConfigValueSync('pms.reservations.pending_hold_hours') ?? 24);
          const confirmBy = input.confirmBy ?? now + holdHours * 3600_000;
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'pending', rate_plan_id = ?, cancel_penalty_type = ?,
             cancel_grace_hours = ?, cancel_penalty_nights = ?, cancel_penalty_bps = ?,
             confirm_by = ?, expires_at = NULL, updated_at = ? WHERE reservation_id = ?`,
            ratePlanId,
            snapshot.cancelPenaltyType,
            snapshot.cancelGraceHours,
            snapshot.cancelPenaltyNights,
            snapshot.cancelPenaltyBps,
            confirmBy,
            now,
            input.reservationId,
          );
          const ariVersion = this.bumpAriVersionSync();
          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: 'inquiry',
              toStatus: 'pending',
            },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'availability.changed',
            payload: { propertyId, roomTypeId: reservation.room_type_id, fromDate, toDate, version: ariVersion },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.hold',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: 'inquiry' },
            afterJson: { status: 'pending' },
            reservationId: input.reservationId,
          });
          return { ok: true as const, reservationId: input.reservationId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof NoAvailabilityError) {
        return { ok: false, error: NO_AVAILABILITY, date: e.date, ariVersion: this.readAriVersionSync() };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Cancel a confirmed reservation and decrement `sold` on every stay night in one atomic
   * write. Implements catalog `reservations.cancel`. Fingerprint: `{ reservationId }`.
   */
  async tryCancelReservation(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof ALREADY_CANCELLED }
    | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          if (expired) {
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.cancel',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { status: expired.kind },
              afterJson: { status: 'cancelled', reason: 'expired' },
              reservationId: input.reservationId,
            });
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: expired.ariVersion,
              fromDate: expired.fromDate,
              toDate: expired.toDate,
            };
          }
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status,
                      rate_plan_id, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            rate_plan_id: string;
            cancel_penalty_type: string;
            cancel_grace_hours: number;
            cancel_penalty_nights: number | null;
            cancel_penalty_bps: number | null;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (
            reservation.status !== 'confirmed' &&
            reservation.status !== 'pending' &&
            reservation.status !== 'inquiry'
          ) {
            return { ok: false as const, error: ALREADY_CANCELLED };
          }

          if (reservation.status === 'pending' || reservation.status === 'confirmed') {
            const timeZone = this.readStoredTimeZoneSync();
            if (!timeZone) return { ok: false as const, error: TIMEZONE_UNSET };
            const penalty = this.penaltyMinor(reservation, Date.now(), timeZone);
            if (penalty > 0) {
              const businessDate = this.readBusinessDateSync();
              if (!businessDate) return { ok: false as const, error: BUSINESS_DATE_UNSET };
              this.postDeskPenaltySync(input.reservationId, 'CANCEL', penalty, businessDate);
            }
          }

          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const commitsInventory = reservation.status === 'confirmed' || reservation.status === 'pending';
          if (commitsInventory) {
            this.releaseSoldNightsSync(reservation.room_type_id, nights);
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'cancelled', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          const ariVersion = commitsInventory ? this.bumpAriVersionSync() : this.readAriVersionSync();
          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: reservation.status,
              toStatus: 'cancelled',
            },
          });
          if (commitsInventory) {
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: {
                propertyId,
                roomTypeId: reservation.room_type_id,
                fromDate,
                toDate,
                version: ariVersion,
              },
            });
          }

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.cancel',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: reservation.status, roomTypeId: reservation.room_type_id },
            afterJson: { status: 'cancelled', roomTypeId: reservation.room_type_id },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            ariVersion,
            fromDate,
            toDate,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Change a confirmed reservation's room type and/or stay dates by releasing sold on
   * old nights and acquiring on new nights in one atomic write. Implements catalog
   * `reservations.modify`. Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate }`.
   */
  async tryModifyReservation(
    actor: ActorContext,
    input: {
      reservationId: string;
      roomTypeId: string;
      arrivalDate: string;
      departureDate: string;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number }
    | { ok: false; error: typeof UNBOOKABLE; date: string }
    | { ok: false; error: typeof NOT_MODIFIABLE }
    | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
    | { ok: false; error: typeof RESTRICTION_VIOLATED; rule: string; date: string; required?: number }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(input.arrivalDate) || !dateRe.test(input.departureDate)) {
      return { ok: false, error: 'invalid_date' };
    }
    if (input.arrivalDate >= input.departureDate) {
      return { ok: false, error: 'invalid_stay_range' };
    }

    let newNights: string[];
    try {
      newNights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: 'invalid_stay_range' };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredErr = this.expiredWire(expired);
          if (expiredErr) return expiredErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (
            reservation.status !== 'confirmed' &&
            reservation.status !== 'pending' &&
            reservation.status !== 'inquiry'
          ) {
            return { ok: false as const, error: NOT_MODIFIABLE };
          }

          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate
          ) {
            const nights = enumerateStayDates(input.arrivalDate, input.departureDate);
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: this.readAriVersionSync(),
              fromDate: nights[0]!,
              toDate: nights[nights.length - 1]!,
            };
          }

          const roomRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string }>;
          if (!roomRows[0] || roomRows[0].status !== 'active') {
            throw new RoomTypeNotFoundError();
          }

          const oldNights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const oldRoomTypeId = reservation.room_type_id;
          const oldNightSet = new Set(oldNights);
          const sameRoomType = oldRoomTypeId === input.roomTypeId;
          const commitsInventory = reservation.status !== 'inquiry';

          if (commitsInventory) {
            for (const stayDate of oldNights) {
              const rows = this.ctx.storage.sql
                .exec(
                  `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
                  oldRoomTypeId,
                  stayDate,
                )
                .toArray() as Array<{ sold: number }>;
              if (rows.length === 0 || rows[0]!.sold < 1) {
                throw new LedgerInconsistentError(stayDate);
              }
            }

            const rowsByDate = new Map<string, AvailabilitySnapshot>();
            for (const stayDate of newNights) {
              const rows = this.ctx.storage.sql
                .exec(
                  `SELECT physical, blocked, held, sold, oversell FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
                  input.roomTypeId,
                  stayDate,
                )
                .toArray() as Array<{
                physical: number;
                blocked: number;
                held: number;
                sold: number;
                oversell: number;
              }>;
              if (rows.length === 0) {
                throw new UnbookableError(stayDate);
              }
              const row = rows[0]!;
              const releasedSold = sameRoomType && oldNightSet.has(stayDate) ? row.sold - 1 : row.sold;
              rowsByDate.set(stayDate, {
                stayDate,
                physical: row.physical,
                blocked: row.blocked,
                held: row.held,
                sold: releasedSold,
                oversell: row.oversell,
              });
            }

            const unavailable = firstUnavailableNight(newNights, rowsByDate);
            if (unavailable) {
              throw new NoAvailabilityError(unavailable);
            }

            this.restrictionFailureSync(
              input.roomTypeId,
              input.arrivalDate,
              input.departureDate,
              newNights,
            );

            for (const stayDate of oldNights) {
              this.ctx.storage.sql.exec(
                `UPDATE availability_day SET sold = sold - 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
                oldRoomTypeId,
                stayDate,
              );
            }

            for (const stayDate of newNights) {
              this.ctx.storage.sql.exec(
                `UPDATE availability_day SET sold = sold + 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
                input.roomTypeId,
                stayDate,
              );
            }
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET room_type_id = ?, arrival_date = ?, departure_date = ?, updated_at = ? WHERE reservation_id = ?`,
            input.roomTypeId,
            input.arrivalDate,
            input.departureDate,
            now,
            input.reservationId,
          );

          const ariVersion = commitsInventory ? this.bumpAriVersionSync() : this.readAriVersionSync();
          const unionFrom =
            oldNights[0]! < newNights[0]! ? oldNights[0]! : newNights[0]!;
          const unionTo =
            oldNights[oldNights.length - 1]! > newNights[newNights.length - 1]!
              ? oldNights[oldNights.length - 1]!
              : newNights[newNights.length - 1]!;

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.modified',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              from: {
                roomTypeId: reservation.room_type_id,
                arrivalDate: reservation.arrival_date,
                departureDate: reservation.departure_date,
              },
              to: {
                roomTypeId: input.roomTypeId,
                arrivalDate: input.arrivalDate,
                departureDate: input.departureDate,
              },
            },
          });

          if (commitsInventory) {
            if (oldRoomTypeId === input.roomTypeId) {
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'availability.changed',
                payload: {
                  propertyId,
                  roomTypeId: input.roomTypeId,
                  fromDate: unionFrom,
                  toDate: unionTo,
                  version: ariVersion,
                },
              });
            } else {
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'availability.changed',
                payload: {
                  propertyId,
                  roomTypeId: oldRoomTypeId,
                  fromDate: oldNights[0]!,
                  toDate: oldNights[oldNights.length - 1]!,
                  version: ariVersion,
                },
              });
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'availability.changed',
                payload: {
                  propertyId,
                  roomTypeId: input.roomTypeId,
                  fromDate: newNights[0]!,
                  toDate: newNights[newNights.length - 1]!,
                  version: ariVersion,
                },
              });
            }
          }

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.modify',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: {
              roomTypeId: reservation.room_type_id,
              arrivalDate: reservation.arrival_date,
              departureDate: reservation.departure_date,
            },
            afterJson: {
              roomTypeId: input.roomTypeId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
            },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            ariVersion,
            fromDate: unionFrom,
            toDate: unionTo,
          };
        }),
      );
    } catch (e) {
      if (e instanceof NoAvailabilityError) {
        return {
          ok: false,
          error: NO_AVAILABILITY,
          date: e.date,
          ariVersion: this.readAriVersionSync(),
        };
      }
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Check in a confirmed reservation. Implements catalog `reservations.check_in`.
   * Fingerprint: `{ reservationId }`. No ledger mutation.
   */
  async tryCheckIn(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const expiredTouch = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredTouchErr = this.expiredWire(expiredTouch);
          if (expiredTouchErr) return expiredTouchErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT guest_ref, pii_key_id, status FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{ guest_ref: string; pii_key_id: string; status: string }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'confirmed') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'checked_in', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: 'confirmed',
              toStatus: 'checked_in',
              ...this.statusChangeOutboxExtras(provisional),
            },
          });

          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Check out a checked-in reservation. Implements catalog `reservations.check_out`.
   * Fingerprint: `{ reservationId }`. No ledger mutation.
   */
  async tryCheckOut(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const expiredTouch = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredTouchErr = this.expiredWire(expiredTouch);
          if (expiredTouchErr) return expiredTouchErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT guest_ref, pii_key_id, status FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{ guest_ref: string; pii_key_id: string; status: string }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'checked_in') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'checked_out', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: 'checked_in',
              toStatus: 'checked_out',
              ...this.statusChangeOutboxExtras(provisional),
            },
          });

          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reverse an accidental check-in. Implements catalog `reservations.cancel_check_in`.
   * Fingerprint: `{ reservationId }`. No ledger mutation.
   */
  async tryCancelCheckIn(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const expiredTouch = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredTouchErr = this.expiredWire(expiredTouch);
          if (expiredTouchErr) return expiredTouchErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT guest_ref, pii_key_id, status FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{ guest_ref: string; pii_key_id: string; status: string }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'checked_in') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'confirmed', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: 'checked_in',
              toStatus: 'confirmed',
              ...this.statusChangeOutboxExtras(provisional),
            },
          });

          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Mark a confirmed reservation as no-show and release sold inventory.
   * Implements catalog `reservations.no_show`. Fingerprint: `{ reservationId }`.
   */
  async tryNoShow(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof NO_SHOW_BEFORE_ARRIVAL }
    | { ok: false; error: typeof BUSINESS_DATE_UNSET }
    | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expiredNs = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredNsErr = this.expiredWire(expiredNs);
          if (expiredNsErr) return expiredNsErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status,
                      rate_plan_id, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            rate_plan_id: string;
            cancel_penalty_type: string;
            cancel_grace_hours: number;
            cancel_penalty_nights: number | null;
            cancel_penalty_bps: number | null;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'confirmed') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }
          if (businessDate < reservation.arrival_date) {
            return { ok: false as const, error: NO_SHOW_BEFORE_ARRIVAL };
          }

          const timeZone = this.readStoredTimeZoneSync();
          if (!timeZone) return { ok: false as const, error: TIMEZONE_UNSET };
          const penalty = this.penaltyMinor(reservation, Date.now(), timeZone);
          if (penalty > 0) {
            this.postDeskPenaltySync(input.reservationId, 'NO_SHOW', penalty, businessDate);
          }

          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          for (const stayDate of nights) {
            const rows = this.ctx.storage.sql
              .exec(
                `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
                reservation.room_type_id,
                stayDate,
              )
              .toArray() as Array<{ sold: number }>;
            if (rows.length === 0 || rows[0]!.sold < 1) {
              throw new LedgerInconsistentError(stayDate);
            }
          }

          for (const stayDate of nights) {
            this.ctx.storage.sql.exec(
              `UPDATE availability_day SET sold = sold - 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
              reservation.room_type_id,
              stayDate,
            );
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'no_show', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          const ariVersion = this.bumpAriVersionSync();
          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.status_changed',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              fromStatus: 'confirmed',
              toStatus: 'no_show',
            },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'availability.changed',
            payload: {
              propertyId,
              roomTypeId: reservation.room_type_id,
              fromDate,
              toDate,
              version: ariVersion,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'reservations.no_show',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: 'confirmed', roomTypeId: reservation.room_type_id },
            afterJson: { status: 'no_show', roomTypeId: reservation.room_type_id },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            ariVersion,
            fromDate,
            toDate,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Read a single reservation row. No idempotency — plain read RPC. */
  async readReservation(reservationId: string): Promise<
    | {
        ok: true;
        reservation: {
          reservationId: string;
          roomTypeId: string;
          guestRef: string;
          piiKeyId: string;
          arrivalDate: string;
          departureDate: string;
          status: string;
          roomId: string | null;
          ratePlanId: string;
          cancelPenaltyType: string;
          confirmBy: number | null;
          expiresAt: number | null;
          createdAt: number;
          updatedAt: number;
        };
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, room_id, rate_plan_id, cancel_penalty_type, confirm_by, expires_at, created_at, updated_at FROM reservation WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      pii_key_id: string;
      arrival_date: string;
      departure_date: string;
      status: string;
      room_id: string | null;
      rate_plan_id: string;
      cancel_penalty_type: string;
      confirm_by: number | null;
      expires_at: number | null;
      created_at: number;
      updated_at: number;
    }>;
    const row = rows[0];
    if (!row) return { ok: false, error: NOT_FOUND };
    return {
      ok: true,
      reservation: {
        reservationId: row.reservation_id,
        roomTypeId: row.room_type_id,
        guestRef: row.guest_ref,
        piiKeyId: row.pii_key_id,
        arrivalDate: row.arrival_date,
        departureDate: row.departure_date,
        status: row.status,
        roomId: row.room_id,
        ratePlanId: row.rate_plan_id,
        cancelPenaltyType: row.cancel_penalty_type,
        confirmBy: row.confirm_by,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }

  private clampFrontDeskLimit(limit?: number): number {
    const raw = limit ?? 50;
    if (!Number.isFinite(raw) || raw < 1) return 50;
    return Math.min(50, Math.floor(raw));
  }

  private mapFrontDeskListRow(row: {
    reservation_id: string;
    room_type_id: string;
    guest_ref: string;
    arrival_date: string;
    departure_date: string;
    status: string;
    room_id: string | null;
  }) {
    return {
      reservationId: row.reservation_id,
      roomTypeId: row.room_type_id,
      guestRef: row.guest_ref,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
      status: row.status,
      roomId: row.room_id,
    };
  }

  async listArrivals(
    date: string,
    opts?: { limit?: number; cursor?: { reservationId: string } | null },
  ): Promise<
    | {
        ok: true;
        items: Array<{
          reservationId: string;
          roomTypeId: string;
          guestRef: string;
          arrivalDate: string;
          departureDate: string;
          status: string;
          roomId: string | null;
        }>;
        nextCursor: { reservationId: string } | null;
      }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE arrival_date = ? AND status = 'confirmed' AND reservation_id > ?
             ORDER BY reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE arrival_date = ? AND status = 'confirmed'
             ORDER BY reservation_id ASC
             LIMIT ?`,
        ...(cursor ? [date, cursor.reservationId, limit] : [date, limit]),
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      arrival_date: string;
      departure_date: string;
      status: string;
      room_id: string | null;
    }>;
    const items = rows.map((row) => this.mapFrontDeskListRow(row));
    const nextCursor =
      items.length === limit
        ? { reservationId: items[items.length - 1]!.reservationId }
        : null;
    return { ok: true, items, nextCursor };
  }

  async listDepartures(
    date: string,
    opts?: { limit?: number; cursor?: { status: string; reservationId: string } | null },
  ): Promise<
    | {
        ok: true;
        items: Array<{
          reservationId: string;
          roomTypeId: string;
          guestRef: string;
          arrivalDate: string;
          departureDate: string;
          status: string;
          roomId: string | null;
        }>;
        nextCursor: { status: string; reservationId: string } | null;
      }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE departure_date = ?
               AND (status > ? OR (status = ? AND reservation_id > ?))
             ORDER BY status ASC, reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE departure_date = ?
             ORDER BY status ASC, reservation_id ASC
             LIMIT ?`,
        ...(cursor
          ? [date, cursor.status, cursor.status, cursor.reservationId, limit]
          : [date, limit]),
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      arrival_date: string;
      departure_date: string;
      status: string;
      room_id: string | null;
    }>;
    const items = rows.map((row) => this.mapFrontDeskListRow(row));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last ? { status: last.status, reservationId: last.reservationId } : null;
    return { ok: true, items, nextCursor };
  }

  async listInHouse(
    opts?: { limit?: number; cursor?: { departureDate: string; reservationId: string } | null },
  ): Promise<
    | {
        ok: true;
        items: Array<{
          reservationId: string;
          roomTypeId: string;
          guestRef: string;
          arrivalDate: string;
          departureDate: string;
          status: string;
          roomId: string | null;
        }>;
        nextCursor: { departureDate: string; reservationId: string } | null;
      }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE status = 'checked_in'
               AND (departure_date > ? OR (departure_date = ? AND reservation_id > ?))
             ORDER BY departure_date ASC, reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
             FROM reservation
             WHERE status = 'checked_in'
             ORDER BY departure_date ASC, reservation_id ASC
             LIMIT ?`,
        ...(cursor
          ? [cursor.departureDate, cursor.departureDate, cursor.reservationId, limit]
          : [limit]),
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      arrival_date: string;
      departure_date: string;
      status: string;
      room_id: string | null;
    }>;
    const items = rows.map((row) => this.mapFrontDeskListRow(row));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? { departureDate: last.departureDate, reservationId: last.reservationId }
        : null;
    return { ok: true, items, nextCursor };
  }

  private countAttributedCashForShiftSync(shiftId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS n FROM payment
         WHERE shift_id = ? AND tender_type = 'CASH' AND status = 'captured'`,
        shiftId,
      )
      .toArray() as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  async readCurrentOpenShift(actor: ActorContext): Promise<
    | {
        ok: true;
        shift: {
          shiftId: string;
          cashierUserId: string;
          businessDate: string;
          openedAt: number;
          openingFloat: number;
          status: 'OPEN';
          attributedCashCount: number;
        } | null;
      }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: true, shift: null };
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT shift_id, cashier_user_id, business_date, opened_at, opening_float, status
         FROM shift WHERE cashier_user_id = ? AND status = 'OPEN'`,
        actor.userId,
      )
      .toArray() as Array<{
      shift_id: string;
      cashier_user_id: string;
      business_date: string;
      opened_at: number;
      opening_float: number;
      status: string;
    }>;
    const row = rows[0];
    if (!row) return { ok: true, shift: null };
    return {
      ok: true,
      shift: {
        shiftId: row.shift_id,
        cashierUserId: row.cashier_user_id,
        businessDate: row.business_date,
        openedAt: row.opened_at,
        openingFloat: row.opening_float,
        status: 'OPEN',
        attributedCashCount: this.countAttributedCashForShiftSync(row.shift_id),
      },
    };
  }

  async readRecentShiftsForActor(
    actor: ActorContext,
    opts?: { limit?: number },
  ): Promise<{
    ok: true;
    shifts: Array<{
      shiftId: string;
      businessDate: string;
      openedAt: number;
      closedAt: number | null;
      openingFloat: number;
      closingCount: number | null;
      variance: number | null;
      status: 'CLOSED' | 'FORCE_CLOSED';
    }>;
  }> {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: true, shifts: [] };
    const limit = opts?.limit ?? 5;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT shift_id, business_date, opened_at, closed_at, opening_float,
                closing_count, variance, status
         FROM shift
         WHERE cashier_user_id = ?
           AND status IN ('CLOSED', 'FORCE_CLOSED')
         ORDER BY opened_at DESC
         LIMIT ?`,
        actor.userId,
        limit,
      )
      .toArray() as Array<{
      shift_id: string;
      business_date: string;
      opened_at: number;
      closed_at: number | null;
      opening_float: number;
      closing_count: number | null;
      variance: number | null;
      status: string;
    }>;
    return {
      ok: true,
      shifts: rows.map((row) => ({
        shiftId: row.shift_id,
        businessDate: row.business_date,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        openingFloat: row.opening_float,
        closingCount: row.closing_count,
        variance: row.variance,
        status: row.status as 'CLOSED' | 'FORCE_CLOSED',
      })),
    };
  }

  /** Test helper: read reservation status, or null if absent. */
  async getReservationStatus(reservationId: string): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT status FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ status: string }>;
    return rows[0]?.status ?? null;
  }

  /** Test helper: count `availability_day` rows for a room type. */
  async countAvailabilityDays(roomTypeId: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM availability_day WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  /** Test helper: read `room_type` status, or null if it does not exist. */
  async getRoomTypeStatus(roomTypeId: string): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ status: string }>;
    return rows[0]?.status ?? null;
  }

  /** Test helper: list outbox `event_type`s in append order (unacked only). */
  async listOutboxEventTypes(): Promise<string[]> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT event_type FROM outbox WHERE acked = 0 ORDER BY seq`)
      .toArray() as Array<{ event_type: string }>;
    return rows.map((r) => r.event_type);
  }

  /** Test helper: list unacked outbox payloads in append order. */
  async listOutboxPayloads(): Promise<Array<{ eventType: string; payload: string }>> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT event_type, payload FROM outbox WHERE acked = 0 ORDER BY seq`)
      .toArray() as Array<{ event_type: string; payload: string }>;
    return rows.map((r) => ({ eventType: r.event_type, payload: r.payload }));
  }

  /** Test helper: remove all `availability_day` rows on/after `fromDate` — simulates a room type with no future ledger rows. */
  async deleteAvailabilityDaysFrom(roomTypeId: string, fromDate: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM availability_day WHERE room_type_id = ? AND stay_date >= ?`,
      roomTypeId,
      fromDate,
    );
  }

  /** Test helper: remove a single `availability_day` row — simulates a gap in the horizon. */
  async deleteAvailabilityDay(roomTypeId: string, stayDate: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
      roomTypeId,
      stayDate,
    );
  }

  /**
   * Upsert a type-wide or rate-plan-specific `restriction_day` row. Implements catalog
   * `restrictions.upsert_day`. Fingerprint: full input body.
   */
  async tryUpsertRestrictionDay(
    actor: ActorContext,
    input: {
      roomTypeId: string;
      ratePlanId: string;
      stayDate: string;
      minLos: number | null;
      maxLos: number | null;
      cta: boolean;
      ctd: boolean;
      stopSell: boolean;
    },
    idem: IdempotencyKey,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.ctx.storage.sql.exec(
            `INSERT INTO restriction_day (room_type_id, rate_plan_id, stay_date, min_los, max_los, cta, ctd, stop_sell, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
               min_los = excluded.min_los,
               max_los = excluded.max_los,
               cta = excluded.cta,
               ctd = excluded.ctd,
               stop_sell = excluded.stop_sell,
               version = restriction_day.version + 1`,
            input.roomTypeId,
            input.ratePlanId,
            input.stayDate,
            input.minLos,
            input.maxLos,
            input.cta ? 1 : 0,
            input.ctd ? 1 : 0,
            input.stopSell ? 1 : 0,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'restriction.changed',
            payload: {
              propertyId,
              roomTypeId: input.roomTypeId,
              ratePlanId: input.ratePlanId,
              stayDate: input.stayDate,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'restrictions.upsert_day',
            entityType: 'restriction_day',
            entityId: `${input.roomTypeId}:${input.ratePlanId}:${input.stayDate}`,
            afterJson: {
              roomTypeId: input.roomTypeId,
              ratePlanId: input.ratePlanId,
              stayDate: input.stayDate,
              minLos: input.minLos,
              maxLos: input.maxLos,
              cta: input.cta,
              ctd: input.ctd,
              stopSell: input.stopSell,
            },
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Belt-and-braces seed for DEFAULT_RATE_PLAN_ID (migration also inserts BAR). */
  private ensureDefaultRatePlanSync(): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO rate_plan (rate_plan_id, code, name, status, created_at, updated_at)
       VALUES (?, ?, 'Best Available Rate', 'active', ?, ?)`,
      DEFAULT_RATE_PLAN_ID,
      DEFAULT_RATE_PLAN_ID,
      now,
      now,
    );
  }

  private assertActiveRatePlanSync(ratePlanId: string): void {
    if (ratePlanId === DEFAULT_RATE_PLAN_ID) this.ensureDefaultRatePlanSync();
    const rows = this.ctx.storage.sql
      .exec(`SELECT status FROM rate_plan WHERE rate_plan_id = ?`, ratePlanId)
      .toArray() as Array<{ status: string }>;
    if (!rows[0] || rows[0].status !== 'active') {
      throw new RatePlanNotFoundError();
    }
  }

  /** Belt-and-braces seed for system-authored charge codes (migration also inserts). */
  private ensureSystemChargeCodesSync(): void {
    const now = Date.now();
    for (const code of SYSTEM_CHARGE_CODES) {
    const name =
      code === 'ROOM'
        ? 'Room'
        : code === 'CANCEL'
          ? 'Cancellation fee'
          : code === 'NO_SHOW'
            ? 'No-show fee'
            : 'Payment';
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`,
        code,
        name,
        now,
        now,
      );
    }
  }

  private assertChargeCodeSync(code: string, opts: { requireActive: boolean }): void {
    if ((SYSTEM_CHARGE_CODES as readonly string[]).includes(code)) {
      this.ensureSystemChargeCodesSync();
    }
    const rows = this.ctx.storage.sql
      .exec(`SELECT status FROM charge_code WHERE code = ?`, code)
      .toArray() as Array<{ status: string }>;
    const row = rows[0];
    if (!row) throw new ChargeCodeNotFoundError();
    if (opts.requireActive && row.status !== 'active') throw new ChargeCodeNotFoundError();
  }

  /**
   * Create a rate plan. Implements catalog `rates.create_plan`.
   * Fingerprint allowlist: `{ ratePlanId, code, name, cancelPenaltyType?, cancelGraceHours?, cancelPenaltyNights?, cancelPenaltyBps?, cancelPolicyText? }`.
   */
  async tryCreateRatePlan(
    actor: ActorContext,
    input: {
      ratePlanId: string;
      code: string;
      name: string;
      cancelPenaltyType?: string;
      cancelGraceHours?: number;
      cancelPenaltyNights?: number | null;
      cancelPenaltyBps?: number | null;
      cancelPolicyText?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ratePlanId: string }
    | { ok: false; error: typeof RATE_PLAN_ID_EXISTS }
    | { ok: false; error: typeof RATE_PLAN_CODE_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(`SELECT status FROM rate_plan WHERE rate_plan_id = ?`, input.ratePlanId)
            .toArray();
          if (existing.length > 0) throw new RatePlanIdExistsError();

          const codeTaken = this.ctx.storage.sql
            .exec(
              `SELECT rate_plan_id FROM rate_plan WHERE code = ? AND status = 'active'`,
              input.code,
            )
            .toArray();
          if (codeTaken.length > 0) throw new RatePlanCodeExistsError();

          const policy = normalizeRatePlanPolicy(input);
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO rate_plan (
               rate_plan_id, code, name, status, created_at, updated_at,
               cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps, cancel_policy_text
             )
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
            input.ratePlanId,
            input.code,
            input.name,
            now,
            now,
            policy.cancelPenaltyType,
            policy.cancelGraceHours,
            policy.cancelPenaltyNights,
            policy.cancelPenaltyBps,
            policy.cancelPolicyText,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_plan.changed',
            payload: {
              propertyId,
              ratePlanId: input.ratePlanId,
              op: 'create',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.create_plan',
            entityType: 'rate_plan',
            entityId: input.ratePlanId,
            beforeJson: null,
            afterJson: {
              ratePlanId: input.ratePlanId,
              code: input.code,
              name: input.name,
              status: 'active',
              cancelPenaltyType: policy.cancelPenaltyType,
              cancelGraceHours: policy.cancelGraceHours,
            },
          });

          return { ok: true as const, ratePlanId: input.ratePlanId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanIdExistsError) return { ok: false, error: RATE_PLAN_ID_EXISTS };
      if (e instanceof RatePlanCodeExistsError) return { ok: false, error: RATE_PLAN_CODE_EXISTS };
      if (e instanceof InvalidCancelPolicyError) return { ok: false, error: 'invalid_cancel_policy' };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update an active rate plan's code/name. Implements catalog `rates.update_plan`.
   * Fingerprint allowlist: `{ ratePlanId, code?, name?, cancelPenaltyType?, cancelGraceHours?, cancelPenaltyNights?, cancelPenaltyBps?, cancelPolicyText? }`.
   */
  async tryUpdateRatePlan(
    actor: ActorContext,
    input: {
      ratePlanId: string;
      code?: string;
      name?: string;
      cancelPenaltyType?: string;
      cancelGraceHours?: number;
      cancelPenaltyNights?: number | null;
      cancelPenaltyBps?: number | null;
      cancelPolicyText?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ratePlanId: string }
    | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
    | { ok: false; error: typeof RATE_PLAN_CODE_EXISTS }
    | { ok: false; error: typeof DEFAULT_RATE_PLAN_PROTECTED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT code, name, status, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps, cancel_policy_text
               FROM rate_plan WHERE rate_plan_id = ?`,
              input.ratePlanId,
            )
            .toArray() as Array<{
            code: string;
            name: string;
            status: string;
            cancel_penalty_type: string;
            cancel_grace_hours: number;
            cancel_penalty_nights: number | null;
            cancel_penalty_bps: number | null;
            cancel_policy_text: string | null;
          }>;
          const existing = rows[0];
          if (!existing || existing.status !== 'active') {
            throw new RatePlanNotFoundError();
          }

          const nextCode = input.code ?? existing.code;
          const nextName = input.name ?? existing.name;
          const policy = normalizeRatePlanPolicy(input, {
            cancelPenaltyType: existing.cancel_penalty_type,
            cancelGraceHours: existing.cancel_grace_hours,
            cancelPenaltyNights: existing.cancel_penalty_nights,
            cancelPenaltyBps: existing.cancel_penalty_bps,
            cancelPolicyText: existing.cancel_policy_text,
          });

          if (
            input.ratePlanId === DEFAULT_RATE_PLAN_ID &&
            input.code !== undefined &&
            input.code !== DEFAULT_RATE_PLAN_ID
          ) {
            throw new DefaultRatePlanProtectedError();
          }

          if (nextCode !== existing.code) {
            const codeTaken = this.ctx.storage.sql
              .exec(
                `SELECT rate_plan_id FROM rate_plan
                 WHERE code = ? AND status = 'active' AND rate_plan_id != ?`,
                nextCode,
                input.ratePlanId,
              )
              .toArray();
            if (codeTaken.length > 0) throw new RatePlanCodeExistsError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE rate_plan SET code = ?, name = ?, updated_at = ?,
               cancel_penalty_type = ?, cancel_grace_hours = ?, cancel_penalty_nights = ?,
               cancel_penalty_bps = ?, cancel_policy_text = ?
             WHERE rate_plan_id = ?`,
            nextCode,
            nextName,
            now,
            policy.cancelPenaltyType,
            policy.cancelGraceHours,
            policy.cancelPenaltyNights,
            policy.cancelPenaltyBps,
            policy.cancelPolicyText,
            input.ratePlanId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_plan.changed',
            payload: {
              propertyId,
              ratePlanId: input.ratePlanId,
              op: 'update',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.update_plan',
            entityType: 'rate_plan',
            entityId: input.ratePlanId,
            beforeJson: {
              code: existing.code,
              name: existing.name,
              cancelPenaltyType: existing.cancel_penalty_type,
            },
            afterJson: {
              code: nextCode,
              name: nextName,
              cancelPenaltyType: policy.cancelPenaltyType,
            },
          });

          return { ok: true as const, ratePlanId: input.ratePlanId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      if (e instanceof RatePlanCodeExistsError) return { ok: false, error: RATE_PLAN_CODE_EXISTS };
      if (e instanceof DefaultRatePlanProtectedError) {
        return { ok: false, error: DEFAULT_RATE_PLAN_PROTECTED };
      }
      if (e instanceof InvalidCancelPolicyError) return { ok: false, error: 'invalid_cancel_policy' };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Archive a rate plan. Implements catalog `rates.delete_plan`.
   * Fingerprint allowlist: `{ ratePlanId }`. Never hard-deletes. BAR is not archivable.
   */
  async tryDeleteRatePlan(
    actor: ActorContext,
    input: { ratePlanId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ratePlanId: string }
    | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
    | { ok: false; error: typeof DEFAULT_RATE_PLAN_PROTECTED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          if (input.ratePlanId === DEFAULT_RATE_PLAN_ID) {
            throw new DefaultRatePlanProtectedError();
          }

          const rows = this.ctx.storage.sql
            .exec(`SELECT status FROM rate_plan WHERE rate_plan_id = ?`, input.ratePlanId)
            .toArray() as Array<{ status: string }>;
          if (!rows[0] || rows[0].status !== 'active') {
            throw new RatePlanNotFoundError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE rate_plan SET status = 'archived', updated_at = ? WHERE rate_plan_id = ?`,
            now,
            input.ratePlanId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_plan.changed',
            payload: {
              propertyId,
              ratePlanId: input.ratePlanId,
              op: 'archive',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.delete_plan',
            entityType: 'rate_plan',
            entityId: input.ratePlanId,
            beforeJson: { status: 'active' },
            afterJson: { status: 'archived' },
          });

          return { ok: true as const, ratePlanId: input.ratePlanId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      if (e instanceof DefaultRatePlanProtectedError) {
        return { ok: false, error: DEFAULT_RATE_PLAN_PROTECTED };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Active rate plans only. */
  async listRatePlans(): Promise<
    Array<{ ratePlanId: string; code: string; name: string; status: string }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT rate_plan_id, code, name, status FROM rate_plan
         WHERE status = 'active' ORDER BY code`,
      )
      .toArray() as Array<{
      rate_plan_id: string;
      code: string;
      name: string;
      status: string;
    }>;
    return rows.map((r) => ({
      ratePlanId: r.rate_plan_id,
      code: r.code,
      name: r.name,
      status: r.status,
    }));
  }

  /**
   * Create a charge code. Implements catalog `folio.create_charge_code`.
   * Fingerprint allowlist: `{ code, name }`.
   */
  async tryCreateChargeCode(
    actor: ActorContext,
    input: { code: string; name: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; code: string }
    | { ok: false; error: typeof CHARGE_CODE_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(`SELECT code FROM charge_code WHERE code = ?`, input.code)
            .toArray();
          if (existing.length > 0) throw new ChargeCodeExistsError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO charge_code (code, name, status, created_at, updated_at)
             VALUES (?, ?, 'active', ?, ?)`,
            input.code,
            input.name,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'charge_code.changed',
            payload: {
              propertyId,
              code: input.code,
              op: 'create',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.create_charge_code',
            entityType: 'charge_code',
            entityId: input.code,
            beforeJson: null,
            afterJson: { code: input.code, name: input.name, status: 'active' },
          });

          return { ok: true as const, code: input.code };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeExistsError) return { ok: false, error: CHARGE_CODE_EXISTS };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update charge code display name. Implements catalog `folio.update_charge_code`.
   * Fingerprint allowlist: `{ code, name }`.
   */
  async tryUpdateChargeCode(
    actor: ActorContext,
    input: { code: string; name?: string; taxGroup?: string | null },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; code: string }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(`SELECT code, name, tax_group FROM charge_code WHERE code = ?`, input.code)
            .toArray() as Array<{ code: string; name: string; tax_group: string | null }>;
          const existing = rows[0];
          if (!existing) throw new ChargeCodeNotFoundError();

          const now = Date.now();
          const nextName = input.name ?? existing.name;
          const nextTaxGroup = input.taxGroup !== undefined ? input.taxGroup : existing.tax_group;
          if (input.name !== undefined) {
            this.ctx.storage.sql.exec(
              `UPDATE charge_code SET name = ?, updated_at = ? WHERE code = ?`,
              input.name,
              now,
              input.code,
            );
          }
          if (input.taxGroup !== undefined) {
            this.ctx.storage.sql.exec(
              `UPDATE charge_code SET tax_group = ?, updated_at = ? WHERE code = ?`,
              input.taxGroup,
              now,
              input.code,
            );
          }

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'charge_code.changed',
            payload: {
              propertyId,
              code: input.code,
              op: 'update',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.update_charge_code',
            entityType: 'charge_code',
            entityId: input.code,
            beforeJson: { name: existing.name, taxGroup: existing.tax_group },
            afterJson: { name: nextName, taxGroup: nextTaxGroup },
          });

          return { ok: true as const, code: input.code };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Archive or restore a charge code. Implements catalog `folio.set_charge_code_status`.
   * Fingerprint allowlist: `{ code, status }`.
   */
  async trySetChargeCodeStatus(
    actor: ActorContext,
    input: { code: string; status: 'active' | 'archived' },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; code: string; status: 'active' | 'archived' }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof SYSTEM_CHARGE_CODE_PROTECTED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(`SELECT status FROM charge_code WHERE code = ?`, input.code)
            .toArray() as Array<{ status: string }>;
          if (!rows[0]) throw new ChargeCodeNotFoundError();

          if (
            input.status === 'archived' &&
            (SYSTEM_CHARGE_CODES as readonly string[]).includes(input.code)
          ) {
            throw new SystemChargeCodeProtectedError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE charge_code SET status = ?, updated_at = ? WHERE code = ?`,
            input.status,
            now,
            input.code,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'charge_code.changed',
            payload: {
              propertyId,
              code: input.code,
              op: 'status',
              status: input.status,
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.set_charge_code_status',
            entityType: 'charge_code',
            entityId: input.code,
            beforeJson: { status: rows[0]!.status },
            afterJson: { code: input.code, status: input.status },
          });

          return { ok: true as const, code: input.code, status: input.status };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      if (e instanceof SystemChargeCodeProtectedError) {
        return { ok: false, error: SYSTEM_CHARGE_CODE_PROTECTED };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listChargeCodes(
    status: 'active' | 'archived' | 'all' = 'active',
  ): Promise<Array<{ code: string; name: string; status: string; taxGroup: string | null }>> {
    this.assertRpcAvailable();
    const rows =
      status === 'all'
        ? (this.ctx.storage.sql
            .exec(`SELECT code, name, status, tax_group FROM charge_code ORDER BY code`)
            .toArray() as Array<{ code: string; name: string; status: string; tax_group: string | null }>)
        : (this.ctx.storage.sql
            .exec(
              `SELECT code, name, status, tax_group FROM charge_code WHERE status = ? ORDER BY code`,
              status,
            )
            .toArray() as Array<{ code: string; name: string; status: string; tax_group: string | null }>);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      status: r.status,
      taxGroup: r.tax_group,
    }));
  }

  async listAuditLog(
    actor: ActorContext,
    filters: {
      actor?: string;
      shiftId?: string;
      reservationId?: string;
      fromAt?: number;
      toAt?: number;
      limit?: number;
    } = {},
  ): Promise<
    | {
        ok: true;
        rows: Array<{
          seq: number;
          at: number;
          actor: string;
          commandId: string;
          entityType: string;
          entityId: string;
          beforeJson: unknown | null;
          afterJson: unknown;
          shiftId: string | null;
          reservationId: string | null;
          createdAt: number;
        }>;
      }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: 'org_id_unset' }
  > {
    this.assertRpcAvailable();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:read');
    if (permDenied) return permDenied;

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.actor !== undefined) {
      conditions.push('actor = ?');
      params.push(filters.actor);
    }
    if (filters.shiftId !== undefined) {
      conditions.push('shift_id = ?');
      params.push(filters.shiftId);
    }
    if (filters.reservationId !== undefined) {
      conditions.push('reservation_id = ?');
      params.push(filters.reservationId);
    }
    if (filters.fromAt !== undefined) {
      conditions.push('at >= ?');
      params.push(filters.fromAt);
    }
    if (filters.toAt !== undefined) {
      conditions.push('at <= ?');
      params.push(filters.toAt);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT seq, at, actor, command_id, entity_type, entity_id,
                before_json, after_json, shift_id, reservation_id, created_at
         FROM audit_log ${where}
         ORDER BY at DESC, seq DESC
         LIMIT ?`,
        ...params,
        limit,
      )
      .toArray() as Array<{
      seq: number;
      at: number;
      actor: string;
      command_id: string;
      entity_type: string;
      entity_id: string;
      before_json: string | null;
      after_json: string;
      shift_id: string | null;
      reservation_id: string | null;
      created_at: number;
    }>;

    return {
      ok: true,
      rows: rows.map((row) => ({
        seq: row.seq,
        at: row.at,
        actor: row.actor,
        commandId: row.command_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        beforeJson: row.before_json == null ? null : JSON.parse(row.before_json),
        afterJson: JSON.parse(row.after_json),
        shiftId: row.shift_id,
        reservationId: row.reservation_id,
        createdAt: row.created_at,
      })),
    };
  }

  /**
   * Create a tax rule (new rule_key only). Implements catalog `folio.create_tax_rule`.
   */
  async tryCreateTaxRule(
    actor: ActorContext,
    input: {
      taxRuleId: string;
      ruleKey: string;
      name: string;
      ruleType: string;
      rate: string;
      taxGroup: string;
      outputChargeCode: string;
      validFrom: string;
      validTo?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; taxRuleId: string }
    | { ok: false; error: typeof TAX_RULE_KEY_EXISTS }
    | { ok: false; error: typeof TAX_RULE_KEY_OVERLAP }
    | { ok: false; error: typeof TAX_RULE_TYPE_UNSUPPORTED }
    | { ok: false; error: typeof TAX_OUTPUT_CODE_TAXABLE }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (input.ruleType !== 'PERCENTAGE') {
      return { ok: false, error: TAX_RULE_TYPE_UNSUPPORTED };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingKey = this.ctx.storage.sql
            .exec(`SELECT tax_rule_id FROM tax_rule WHERE rule_key = ? LIMIT 1`, input.ruleKey)
            .toArray();
          if (existingKey.length > 0) throw new TaxRuleKeyExistsError();

          this.assertTaxOutputCodeExemptSync(input.outputChargeCode);

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO tax_rule (
               tax_rule_id, rule_key, name, rule_type, rate, tax_group,
               output_charge_code, valid_from, valid_to, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.taxRuleId,
            input.ruleKey,
            input.name,
            input.ruleType,
            input.rate,
            input.taxGroup,
            input.outputChargeCode,
            input.validFrom,
            input.validTo ?? null,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'tax_rule.changed',
            payload: {
              propertyId,
              taxRuleId: input.taxRuleId,
              ruleKey: input.ruleKey,
              op: 'create',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.create_tax_rule',
            entityType: 'tax_rule',
            entityId: input.taxRuleId,
            beforeJson: null,
            afterJson: {
              taxRuleId: input.taxRuleId,
              ruleKey: input.ruleKey,
              ruleType: input.ruleType,
              rate: input.rate,
              taxGroup: input.taxGroup,
              outputChargeCode: input.outputChargeCode,
              validFrom: input.validFrom,
              validTo: input.validTo ?? null,
            },
          });

          return { ok: true as const, taxRuleId: input.taxRuleId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof TaxRuleKeyExistsError) return { ok: false, error: TAX_RULE_KEY_EXISTS };
      if (e instanceof TaxOutputCodeTaxableError) return { ok: false, error: TAX_OUTPUT_CODE_TAXABLE };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Supersede a tax rule (close + insert same rule_key). Implements catalog `folio.supersede_tax_rule`.
   */
  async trySupersedeTaxRule(
    actor: ActorContext,
    input: {
      ruleKey: string;
      taxRuleId: string;
      name: string;
      ruleType: string;
      rate: string;
      taxGroup: string;
      outputChargeCode: string;
      validFrom: string;
      validTo?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; taxRuleId: string }
    | { ok: false; error: typeof TAX_RULE_NOT_FOUND }
    | { ok: false; error: typeof TAX_RULE_KEY_OVERLAP }
    | { ok: false; error: typeof TAX_RULE_TYPE_UNSUPPORTED }
    | { ok: false; error: typeof TAX_OUTPUT_CODE_TAXABLE }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (input.ruleType !== 'PERCENTAGE') {
      return { ok: false, error: TAX_RULE_TYPE_UNSUPPORTED };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(
              `SELECT tax_rule_id, valid_from, valid_to FROM tax_rule WHERE rule_key = ?`,
              input.ruleKey,
            )
            .toArray() as Array<{ tax_rule_id: string; valid_from: string; valid_to: string | null }>;
          if (existing.length === 0) throw new TaxRuleNotFoundError();

          for (const row of existing) {
            const willClose =
              row.valid_from <= input.validFrom &&
              (row.valid_to === null || row.valid_to > input.validFrom);
            if (willClose) continue;
            if (
              this.taxRuleWindowOverlaps(
                row.valid_from,
                row.valid_to,
                input.validFrom,
                input.validTo ?? null,
              )
            ) {
              throw new TaxRuleKeyOverlapError();
            }
          }

          this.assertTaxOutputCodeExemptSync(input.outputChargeCode);

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE tax_rule SET valid_to = ?, updated_at = ?
             WHERE rule_key = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)`,
            input.validFrom,
            now,
            input.ruleKey,
            input.validFrom,
            input.validFrom,
          );

          this.ctx.storage.sql.exec(
            `INSERT INTO tax_rule (
               tax_rule_id, rule_key, name, rule_type, rate, tax_group,
               output_charge_code, valid_from, valid_to, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.taxRuleId,
            input.ruleKey,
            input.name,
            input.ruleType,
            input.rate,
            input.taxGroup,
            input.outputChargeCode,
            input.validFrom,
            input.validTo ?? null,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'tax_rule.changed',
            payload: {
              propertyId,
              taxRuleId: input.taxRuleId,
              ruleKey: input.ruleKey,
              op: 'supersede',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.supersede_tax_rule',
            entityType: 'tax_rule',
            entityId: input.taxRuleId,
            beforeJson: { ruleKey: input.ruleKey },
            afterJson: {
              taxRuleId: input.taxRuleId,
              ruleKey: input.ruleKey,
              ruleType: input.ruleType,
              rate: input.rate,
              taxGroup: input.taxGroup,
              outputChargeCode: input.outputChargeCode,
              validFrom: input.validFrom,
              validTo: input.validTo ?? null,
            },
          });

          return { ok: true as const, taxRuleId: input.taxRuleId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof TaxRuleNotFoundError) return { ok: false, error: TAX_RULE_NOT_FOUND };
      if (e instanceof TaxRuleKeyOverlapError) return { ok: false, error: TAX_RULE_KEY_OVERLAP };
      if (e instanceof TaxOutputCodeTaxableError) return { ok: false, error: TAX_OUTPUT_CODE_TAXABLE };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listTaxRules(
    filters: { taxGroup?: string; effectiveDate?: string } = {},
  ): Promise<
    Array<{
      taxRuleId: string;
      ruleKey: string;
      name: string;
      ruleType: string;
      rate: string;
      taxGroup: string;
      outputChargeCode: string;
      validFrom: string;
      validTo: string | null;
    }>
  > {
    this.assertRpcAvailable();
    let rows: Array<{
      tax_rule_id: string;
      rule_key: string;
      name: string;
      rule_type: string;
      rate: string;
      tax_group: string;
      output_charge_code: string;
      valid_from: string;
      valid_to: string | null;
    }>;
    if (filters.taxGroup && filters.effectiveDate) {
      rows = this.ctx.storage.sql
        .exec(
          `SELECT tax_rule_id, rule_key, name, rule_type, rate, tax_group,
                  output_charge_code, valid_from, valid_to
           FROM tax_rule
           WHERE tax_group = ?
             AND valid_from <= ?
             AND (valid_to IS NULL OR valid_to > ?)
           ORDER BY rule_key, valid_from`,
          filters.taxGroup,
          filters.effectiveDate,
          filters.effectiveDate,
        )
        .toArray() as typeof rows;
    } else if (filters.taxGroup) {
      rows = this.ctx.storage.sql
        .exec(
          `SELECT tax_rule_id, rule_key, name, rule_type, rate, tax_group,
                  output_charge_code, valid_from, valid_to
           FROM tax_rule WHERE tax_group = ? ORDER BY rule_key, valid_from`,
          filters.taxGroup,
        )
        .toArray() as typeof rows;
    } else {
      rows = this.ctx.storage.sql
        .exec(
          `SELECT tax_rule_id, rule_key, name, rule_type, rate, tax_group,
                  output_charge_code, valid_from, valid_to
           FROM tax_rule ORDER BY rule_key, valid_from`,
        )
        .toArray() as typeof rows;
    }
    return rows.map((r) => ({
      taxRuleId: r.tax_rule_id,
      ruleKey: r.rule_key,
      name: r.name,
      ruleType: r.rule_type,
      rate: r.rate,
      taxGroup: r.tax_group,
      outputChargeCode: r.output_charge_code,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));
  }

  /**
   * Materialize a nightly rate. Implements catalog `rates.upsert_day` and
   * `rates.update_room_type_rate`. Fingerprint: `{ roomTypeId, ratePlanId, stayDate, amountMinor, currency }`
   * with ratePlanId already resolved (DEFAULT_RATE_PLAN_ID when omitted).
   */
  async tryUpsertRateDay(
    actor: ActorContext,
    input: {
      roomTypeId: string;
      ratePlanId?: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
      auditCommandId?: 'rates.upsert_day' | 'rates.update_room_type_rate';
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true }
    | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID;
    const auditCommandId = input.auditCommandId ?? 'rates.upsert_day';

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertActiveRatePlanSync(ratePlanId);
          const beforeRows = this.ctx.storage.sql
            .exec(
              `SELECT amount_minor, currency FROM rate_day
               WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
              input.roomTypeId,
              ratePlanId,
              input.stayDate,
            )
            .toArray() as Array<{ amount_minor: number; currency: string }>;
          this.ctx.storage.sql.exec(
            `INSERT INTO rate_day (room_type_id, rate_plan_id, stay_date, amount_minor, currency, version)
             VALUES (?, ?, ?, ?, ?, 1)
             ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
               amount_minor = excluded.amount_minor,
               currency = excluded.currency,
               version = rate_day.version + 1`,
            input.roomTypeId,
            ratePlanId,
            input.stayDate,
            input.amountMinor,
            input.currency,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate.changed',
            payload: {
              propertyId,
              roomTypeId: input.roomTypeId,
              ratePlanId,
              stayDate: input.stayDate,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: auditCommandId,
            entityType: 'rate_day',
            entityId: `${input.roomTypeId}:${ratePlanId}:${input.stayDate}`,
            beforeJson: beforeRows[0]
              ? { amountMinor: beforeRows[0].amount_minor, currency: beforeRows[0].currency }
              : null,
            afterJson: {
              roomTypeId: input.roomTypeId,
              ratePlanId,
              stayDate: input.stayDate,
              amountMinor: input.amountMinor,
              currency: input.currency,
            },
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Bulk rate_day upserts. Implements catalog `rates.bulk_update`.
   * Fingerprint: `{ updates }` with each cell's ratePlanId resolved and updates
   * sorted by (roomTypeId, ratePlanId, stayDate).
   */
  async tryBulkUpdateRates(
    actor: ActorContext,
    input: {
      updates: Array<{
        roomTypeId: string;
        ratePlanId?: string;
        stayDate: string;
        amountMinor: number;
        currency: string;
      }>;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; count: number }
    | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const normalized = input.updates
            .map((u) => ({
              roomTypeId: u.roomTypeId,
              ratePlanId: u.ratePlanId ?? DEFAULT_RATE_PLAN_ID,
              stayDate: u.stayDate,
              amountMinor: u.amountMinor,
              currency: u.currency,
            }))
            .sort((a, b) => {
              const c1 = a.roomTypeId.localeCompare(b.roomTypeId);
              if (c1 !== 0) return c1;
              const c2 = a.ratePlanId.localeCompare(b.ratePlanId);
              if (c2 !== 0) return c2;
              return a.stayDate.localeCompare(b.stayDate);
            });

          for (const cell of normalized) {
            this.assertActiveRatePlanSync(cell.ratePlanId);
            const beforeRows = this.ctx.storage.sql
              .exec(
                `SELECT amount_minor, currency FROM rate_day
                 WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
                cell.roomTypeId,
                cell.ratePlanId,
                cell.stayDate,
              )
              .toArray() as Array<{ amount_minor: number; currency: string }>;
            this.ctx.storage.sql.exec(
              `INSERT INTO rate_day (room_type_id, rate_plan_id, stay_date, amount_minor, currency, version)
               VALUES (?, ?, ?, ?, ?, 1)
               ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
                 amount_minor = excluded.amount_minor,
                 currency = excluded.currency,
                 version = rate_day.version + 1`,
              cell.roomTypeId,
              cell.ratePlanId,
              cell.stayDate,
              cell.amountMinor,
              cell.currency,
            );
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'rate.changed',
              payload: {
                propertyId,
                roomTypeId: cell.roomTypeId,
                ratePlanId: cell.ratePlanId,
                stayDate: cell.stayDate,
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'rates.bulk_update',
              entityType: 'rate_day',
              entityId: `${cell.roomTypeId}:${cell.ratePlanId}:${cell.stayDate}`,
              beforeJson: beforeRows[0]
                ? { amountMinor: beforeRows[0].amount_minor, currency: beforeRows[0].currency }
                : null,
              afterJson: {
                roomTypeId: cell.roomTypeId,
                ratePlanId: cell.ratePlanId,
                stayDate: cell.stayDate,
                amountMinor: cell.amountMinor,
                currency: cell.currency,
              },
            });
          }

          return { ok: true as const, count: normalized.length };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Quote materialized nightly rates for a stay (read-only). */
  async quoteStay(input: {
    roomTypeId: string;
    ratePlanId?: string;
    arrivalDate: string;
    departureDate: string;
  }): Promise<
    | { ok: true; totalMinor: number; currency: string }
    | { ok: false; error: typeof RATE_MISSING; date: string }
    | { ok: false; error: string }
  > {
    let nights: string[];
    try {
      nights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: 'invalid_stay_range' };
    }
    const ratePlanId = input.ratePlanId ?? DEFAULT_RATE_PLAN_ID;
    const amounts = new Map<string, number>();
    let currency = 'USD';
    for (const stayDate of nights) {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT amount_minor, currency FROM rate_day WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
          input.roomTypeId,
          ratePlanId,
          stayDate,
        )
        .toArray() as Array<{ amount_minor: number; currency: string }>;
      const row = rows[0];
      if (!row) return { ok: false, error: RATE_MISSING, date: stayDate };
      amounts.set(stayDate, row.amount_minor);
      currency = row.currency;
    }
    const quoted = quoteStay(nights, amounts);
    if (!quoted.ok) return { ok: false, error: RATE_MISSING, date: quoted.missingDate };
    return { ok: true, totalMinor: quoted.totalMinor, currency };
  }

  /** Test helper: sold-holding reservation count covering a ledger night. */
  async countSoldHoldingReservationsCovering(roomTypeId: string, stayDate: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS c FROM reservation
         WHERE room_type_id = ? AND status IN ('pending', 'confirmed', 'checked_in', 'checked_out')
           AND arrival_date <= ? AND departure_date > ?`,
        roomTypeId,
        stayDate,
        stayDate,
      )
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async countRestrictionDays(roomTypeId: string, stayDate: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS c FROM restriction_day WHERE room_type_id = ? AND stay_date = ? AND rate_plan_id = '*'`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async createFolioWindow(input: {
    folioWindowId: string;
    reservationId: string;
    kind: 'GUEST' | 'COMPANY' | 'MASTER';
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
       VALUES (?, ?, ?, 'OPEN')`,
      input.folioWindowId,
      input.reservationId,
      input.kind,
    );
  }

  private guestFolioWindowId(reservationId: string): string {
    return `${reservationId}:GUEST`;
  }

  private ensureGuestFolioWindowSync(reservationId: string): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO folio_window (folio_window_id, reservation_id, kind, status)
       VALUES (?, ?, 'GUEST', 'OPEN')`,
      this.guestFolioWindowId(reservationId),
      reservationId,
    );
  }

  private readGuestFolioWindowIdSync(reservationId: string): string {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id FROM folio_window WHERE reservation_id = ? AND kind = 'GUEST'`,
        reservationId,
      )
      .toArray() as Array<{ folio_window_id: string }>;
    return rows[0]!.folio_window_id;
  }

  private insertFolioLineSync(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    posted: PostedLineAmount;
    source?: string | null;
    businessDate?: string;
    splitOf?: string;
    paymentId?: string | null;
    taxOf?: string | null;
    taxRuleId?: string | null;
  }): void {
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    if (input.source === 'TAX') {
      if (!input.taxOf || !input.taxRuleId) {
        throw new Error('tax lines require tax_of and tax_rule_id');
      }
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO folio_line (
         folio_line_id, folio_window_id, reservation_id, charge_code,
         amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
         source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.folioLineId,
      input.folioWindowId,
      input.reservationId,
      input.chargeCode,
      input.posted.amountMinor,
      input.posted.txnCurrency,
      input.posted.ledgerAmountMinor,
      input.posted.fxRate,
      input.posted.fxRateAt,
      input.source ?? null,
      input.businessDate ?? null,
      input.splitOf ?? null,
      Date.now(),
      input.paymentId ?? null,
      input.taxOf ?? null,
      input.taxRuleId ?? null,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'folio.line_posted',
      payload: {
        propertyId,
        folioLineId: input.folioLineId,
        folioWindowId: input.folioWindowId,
        reservationId: input.reservationId,
        chargeCode: input.chargeCode,
        amountMinor: input.posted.amountMinor,
        txnCurrency: input.posted.txnCurrency,
        ledgerAmountMinor: input.posted.ledgerAmountMinor,
        fxRate: input.posted.fxRate,
        fxRateAt: input.posted.fxRateAt,
      },
    });
  }

  /**
   * Reverse + N children. Source row untouched. Caller owns rejects for PAYMENT / SPLIT_REVERSAL.
   * Returns inserted line ids (reverse first, then children).
   */
  private splitFolioLineSync(
    source: {
      folio_line_id: string;
      folio_window_id: string;
      reservation_id: string;
      charge_code: string;
      amount_minor: number;
      txn_currency: string;
      ledger_amount_minor: number;
      fx_rate: string;
      fx_rate_at: number;
      source: string | null;
    },
    splits: Array<{ folioLineId: string; amountMinor: number }>,
  ): string[] {
    const txnCurrency = currencyCode(source.txn_currency);
    const childSource = source.source === 'NIGHT_AUDIT' ? null : source.source;
    const folioLineIds: string[] = [];

    this.assertChargeCodeSync(source.charge_code, { requireActive: false });

    const taxLines = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, amount_minor, tax_rule_id, charge_code, ledger_amount_minor
         FROM folio_line WHERE tax_of = ? AND source = 'TAX'`,
        source.folio_line_id,
      )
      .toArray() as Array<{
      folio_line_id: string;
      amount_minor: number;
      tax_rule_id: string;
      charge_code: string;
      ledger_amount_minor: number;
    }>;

    const reverseId = `${source.folio_line_id}:rev:${crypto.randomUUID()}`;
    this.insertFolioLineSync({
      folioLineId: reverseId,
      folioWindowId: source.folio_window_id,
      reservationId: source.reservation_id,
      chargeCode: source.charge_code,
      posted: {
        amountMinor: -source.amount_minor,
        txnCurrency,
        ledgerAmountMinor: -source.ledger_amount_minor,
        fxRate: source.fx_rate,
        fxRateAt: source.fx_rate_at,
      },
      source: 'SPLIT_REVERSAL',
      splitOf: source.folio_line_id,
      paymentId: null,
    });
    folioLineIds.push(reverseId);

    for (const tax of taxLines) {
      const reverseTaxId = `${tax.folio_line_id}:rev:${crypto.randomUUID()}`;
      this.insertFolioLineSync({
        folioLineId: reverseTaxId,
        folioWindowId: source.folio_window_id,
        reservationId: source.reservation_id,
        chargeCode: tax.charge_code,
        posted: {
          amountMinor: -tax.amount_minor,
          txnCurrency,
          ledgerAmountMinor: -tax.ledger_amount_minor,
          fxRate: source.fx_rate,
          fxRateAt: source.fx_rate_at,
        },
        source: 'SPLIT_REVERSAL',
        splitOf: tax.folio_line_id,
        paymentId: null,
      });
      folioLineIds.push(reverseTaxId);
    }

    for (const split of splits) {
      this.insertFolioLineSync({
        folioLineId: split.folioLineId,
        folioWindowId: source.folio_window_id,
        reservationId: source.reservation_id,
        chargeCode: source.charge_code,
        posted: {
          amountMinor: split.amountMinor,
          txnCurrency,
          ledgerAmountMinor: split.amountMinor,
          fxRate: source.fx_rate,
          fxRateAt: source.fx_rate_at,
        },
        source: childSource,
        splitOf: source.folio_line_id,
        paymentId: null,
      });
      folioLineIds.push(split.folioLineId);
    }

    const childAmounts = splits.map((s) => s.amountMinor);
    for (const tax of taxLines) {
      const portions = allocate(tax.amount_minor, childAmounts, { policy: 'LAST' });
      for (let i = 0; i < splits.length; i++) {
        const portion = portions[i]!;
        if (portion === 0) continue;
        const childLineId = splits[i]!.folioLineId;
        this.insertFolioLineSync({
          folioLineId: `${childLineId}:tax:${tax.tax_rule_id}`,
          folioWindowId: source.folio_window_id,
          reservationId: source.reservation_id,
          chargeCode: tax.charge_code,
          posted: {
            amountMinor: portion,
            txnCurrency,
            ledgerAmountMinor: portion,
            fxRate: source.fx_rate,
            fxRateAt: source.fx_rate_at,
          },
          source: 'TAX',
          taxOf: childLineId,
          taxRuleId: tax.tax_rule_id,
          splitOf: source.folio_line_id,
        });
        folioLineIds.push(`${childLineId}:tax:${tax.tax_rule_id}`);
      }
    }

    return folioLineIds;
  }

  private postRoomChargesSync(businessDate: string): void {
    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) throw new Error(CURRENCY_UNSET);

    const reservations = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, rate_plan_id
         FROM reservation
         WHERE status IN ('confirmed', 'checked_in')
           AND arrival_date <= ? AND departure_date > ?`,
        businessDate,
        businessDate,
      )
      .toArray() as Array<{ reservation_id: string; room_type_id: string; rate_plan_id: string }>;

    let postedCount = 0;
    for (const reservation of reservations) {
      const rateRows = this.ctx.storage.sql
        .exec(
          `SELECT amount_minor FROM rate_day
           WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
          reservation.room_type_id,
          reservation.rate_plan_id,
          businessDate,
        )
        .toArray() as Array<{ amount_minor: number }>;
      if (!rateRows[0]) {
        throw new RateMissingError(businessDate);
      }

      this.ensureGuestFolioWindowSync(reservation.reservation_id);
      const folioWindowId = this.readGuestFolioWindowIdSync(reservation.reservation_id);
      const amountMinor = rateRows[0].amount_minor;
      const fxRateAt = Date.now();
      const posted: PostedLineAmount = {
        amountMinor,
        txnCurrency: ledgerCurrency,
        ledgerAmountMinor: amountMinor,
        fxRate: '1',
        fxRateAt,
      };

      this.assertChargeCodeSync('ROOM', { requireActive: true });
      this.insertFolioLineSync({
        folioLineId: `${reservation.reservation_id}:room:${businessDate}`,
        folioWindowId,
        reservationId: reservation.reservation_id,
        chargeCode: 'ROOM',
        posted,
        source: 'NIGHT_AUDIT',
        businessDate,
      });
      this.stampTaxForChargeSync({
        parentLineId: `${reservation.reservation_id}:room:${businessDate}`,
        parentAmountMinor: amountMinor,
        parentSource: 'NIGHT_AUDIT',
        chargeCode: 'ROOM',
        reservationId: reservation.reservation_id,
        folioWindowId,
        postingDate: businessDate,
        posted,
      });
      postedCount += 1;

      if (
        this.postRoomChargesFailureAfterCountForTest !== null &&
        postedCount >= this.postRoomChargesFailureAfterCountForTest
      ) {
        throw new Error('simulated_post_room_charges_failure');
      }
    }
  }

  async addFolioLine(
    input: {
      folioLineId: string;
      reservationId: string;
      chargeCode: string;
      amountMinor: number;
      txnCurrency?: string;
      ledgerAmountMinor?: number;
      fxRate?: string;
      fxRateAt?: number;
      source?: string;
      businessDate?: string;
    },
    idem?: IdempotencyKey,
  ): Promise<void> {
    const key = idem ?? {
      key: `folio-line:${input.folioLineId}`,
      fingerprint: await fingerprintPayload({
        folioLineId: input.folioLineId,
        reservationId: input.reservationId,
        chargeCode: input.chargeCode,
        amountMinor: input.amountMinor,
        txnCurrency: input.txnCurrency,
        ledgerAmountMinor: input.ledgerAmountMinor,
        fxRate: input.fxRate,
        fxRateAt: input.fxRateAt,
        source: input.source,
        businessDate: input.businessDate,
      }),
    };
    const result = await this.tryAddFolioLine({ kind: 'system', reason: 'night_audit' }, input, key);
    if (!result.ok) throw new Error(result.error);
  }

  async tryAddFolioLine(
    actor: ActorContext,
    input: {
      folioLineId: string;
      reservationId: string;
      chargeCode: string;
      amountMinor: number;
      txnCurrency?: string;
      ledgerAmountMinor?: number;
      fxRate?: string;
      fxRateAt?: number;
      source?: string;
      businessDate?: string;
    },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; folioLineId: string; ledgerAmountMinor: number }
    | { ok: false; error: typeof CURRENCY_UNSET }
    | { ok: false; error: typeof FX_RATE_INVALID }
    | { ok: false; error: typeof LEDGER_AMOUNT_MISMATCH }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof CROSS_CURRENCY_UNSUPPORTED }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) return { ok: false, error: CURRENCY_UNSET };

    const moneyCheck = this.resolveFolioLineMoney(input, ledgerCurrency);
    if (!moneyCheck.ok) return moneyCheck;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);

          const resRows = this.ctx.storage.sql
            .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, input.reservationId)
            .toArray() as Array<{ reservation_id: string }>;
          if (!resRows[0]) return { ok: false as const, error: NOT_FOUND };

          this.ensureGuestFolioWindowSync(input.reservationId);
          const folioWindowId = this.readGuestFolioWindowIdSync(input.reservationId);

          this.assertChargeCodeSync(input.chargeCode, { requireActive: true });
          const postingDate = this.resolvePostingBusinessDateSync(provisional);
          this.insertFolioLineSync({
            folioLineId: input.folioLineId,
            folioWindowId,
            reservationId: input.reservationId,
            chargeCode: input.chargeCode,
            posted: moneyCheck.posted,
            source: input.source,
            businessDate: input.businessDate,
          });
          this.stampTaxForChargeSync({
            parentLineId: input.folioLineId,
            parentAmountMinor: moneyCheck.posted.amountMinor,
            parentSource: input.source ?? null,
            chargeCode: input.chargeCode,
            reservationId: input.reservationId,
            folioWindowId,
            postingDate,
            posted: moneyCheck.posted,
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.add_item',
            entityType: 'folio_line',
            entityId: input.folioLineId,
            beforeJson: null,
            afterJson: {
              folioLineId: input.folioLineId,
              chargeCode: input.chargeCode,
              amountMinor: moneyCheck.posted.amountMinor,
              reservationId: input.reservationId,
            },
            reservationId: input.reservationId,
          });

          return {
            ok: true as const,
            folioLineId: input.folioLineId,
            ledgerAmountMinor: moneyCheck.posted.ledgerAmountMinor,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async trySplitFolioLine(
    actor: ActorContext,
    input: {
      sourceFolioLineId: string;
      splits: Array<{ folioLineId: string; amountMinor: number }>;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineIds: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof SPLIT_AMOUNT_MISMATCH }
    | { ok: false; error: typeof LINE_NOT_SPLITTABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const sourceRows = this.ctx.storage.sql
            .exec(
              `SELECT folio_line_id, folio_window_id, reservation_id, charge_code, amount_minor,
                      txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, source
               FROM folio_line WHERE folio_line_id = ?`,
              input.sourceFolioLineId,
            )
            .toArray() as Array<{
            folio_line_id: string;
            folio_window_id: string;
            reservation_id: string;
            charge_code: string;
            amount_minor: number;
            txn_currency: string;
            ledger_amount_minor: number;
            fx_rate: string;
            fx_rate_at: number;
            source: string | null;
          }>;
          const source = sourceRows[0];
          if (!source) return { ok: false as const, error: NOT_FOUND };
          if (source.source === 'PAYMENT') {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }
          if (source.source === 'SPLIT_REVERSAL') {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }
          if (source.source === 'TAX') {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }

          const splitTotal = input.splits.reduce((sum, split) => sum + split.amountMinor, 0);
          if (splitTotal !== source.amount_minor) {
            return { ok: false as const, error: SPLIT_AMOUNT_MISMATCH };
          }

          const folioLineIds = this.splitFolioLineSync(source, input.splits);
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.split_charge',
            entityType: 'folio_line',
            entityId: input.sourceFolioLineId,
            beforeJson: { amountMinor: source.amount_minor },
            afterJson: { sourceFolioLineId: input.sourceFolioLineId, folioLineIds },
            reservationId: source.reservation_id,
          });
          return { ok: true as const, folioLineIds };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private readPaymentRowSync(paymentId: string): PaymentRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
                capture_fingerprint, tender_type, shift_id, created_at, updated_at
         FROM payment WHERE payment_id = ?`,
        paymentId,
      )
      .toArray() as PaymentRow[];
    return rows[0] ?? null;
  }

  private readPaymentByIdempotencyKeySync(idempotencyKey: string): PaymentRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
                capture_fingerprint, tender_type, shift_id, created_at, updated_at
         FROM payment WHERE idempotency_key = ?`,
        idempotencyKey,
      )
      .toArray() as PaymentRow[];
    return rows[0] ?? null;
  }

  private mapPaymentRow(row: PaymentRow): {
    paymentId: string;
    reservationId: string;
    amountMinor: number;
    currency: string;
    status: PaymentStatus;
    gatewayReference: string | null;
    capturedAmountMinor: number | null;
    tenderType: 'CARD' | 'CASH';
    shiftId: string | null;
    createdAt: number;
    updatedAt: number;
  } {
    return {
      paymentId: row.payment_id,
      reservationId: row.reservation_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      gatewayReference: row.gateway_reference,
      capturedAmountMinor: row.captured_amount_minor,
      tenderType: row.tender_type,
      shiftId: row.shift_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private readOpenShiftIdForActorSync(actor: ActorContext): string | null {
    if (actor.kind !== 'user') return null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT shift_id FROM shift WHERE cashier_user_id = ? AND status = 'OPEN'`,
        actor.userId,
      )
      .toArray() as Array<{ shift_id: string }>;
    return rows[0]?.shift_id ?? null;
  }

  private countUnattributedCashForBusinessDateSync(businessDate: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS n FROM payment
         WHERE tender_type = 'CASH'
           AND status = 'captured'
           AND shift_id IS NULL
           AND date(created_at / 1000, 'unixepoch') = ?`,
        businessDate,
      )
      .toArray() as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  private computeShiftExpectedCashSync(shiftId: string, openingFloat: number): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment
         WHERE shift_id = ? AND tender_type = 'CASH' AND status = 'captured'`,
        shiftId,
      )
      .toArray() as Array<{ total: number }>;
    return openingFloat + Number(rows[0]?.total ?? 0);
  }

  private forceCloseCashierShiftsSync(businessDate: string): void {
    const openShifts = this.ctx.storage.sql
      .exec(
        `SELECT shift_id, cashier_user_id, opening_float FROM shift
         WHERE business_date = ? AND status = 'OPEN'`,
        businessDate,
      )
      .toArray() as Array<{ shift_id: string; cashier_user_id: string; opening_float: number }>;

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE shift
       SET status = 'FORCE_CLOSED',
           closed_at = ?,
           closing_count = NULL,
           variance = NULL,
           updated_at = ?
       WHERE business_date = ? AND status = 'OPEN'`,
      now,
      now,
      businessDate,
    );

    for (const shift of openShifts) {
      this.appendAuditLogSync({
        at: now,
        actor: 'system:night_audit',
        commandId: 'night_audit.run',
        entityType: 'shift',
        entityId: shift.shift_id,
        beforeJson: { status: 'OPEN', openingFloat: shift.opening_float },
        afterJson: {
          shiftId: shift.shift_id,
          status: 'FORCE_CLOSED',
          closingCount: null,
          variance: null,
        },
        shiftId: shift.shift_id,
      });
    }
  }

  private mapShiftRow(
    row: ShiftRow,
    extras?: { unattributedCashCount?: number },
  ): {
    shiftId: string;
    cashierUserId: string;
    businessDate: string;
    openedAt: number;
    closedAt: number | null;
    openingFloat: number;
    closingCount: number | null;
    variance: number | null;
    status: ShiftStatus;
    unattributedCashCount?: number;
  } {
    return {
      shiftId: row.shift_id,
      cashierUserId: row.cashier_user_id,
      businessDate: row.business_date,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openingFloat: row.opening_float,
      closingCount: row.closing_count,
      variance: row.variance,
      status: row.status,
      ...(extras?.unattributedCashCount !== undefined
        ? { unattributedCashCount: extras.unattributedCashCount }
        : {}),
    };
  }

  private authorizePaymentSuccessFromRow(row: PaymentRow): {
    ok: true;
    paymentId: string;
    status: PaymentStatus;
    gatewayReference: string | null;
  } {
    return {
      ok: true as const,
      paymentId: row.payment_id,
      status: row.status,
      gatewayReference: row.gateway_reference,
    };
  }

  async tryAuthorizePayment(
    actor: ActorContext,
    input: {
      paymentId: string;
      reservationId: string;
      amountMinor: number;
      idempotencyKey: string;
      requestFingerprint: string;
    },
  ): Promise<
    | { ok: true; paymentId: string; status: PaymentStatus; gatewayReference: string | null }
    | { ok: false; error: typeof NOT_FOUND | typeof PSP_UNAVAILABLE | typeof IDEM_KEY_REUSED | typeof MONEY_INVALID }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: 'psp_adapter_failed' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: MONEY_INVALID };
    }

    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) return { ok: false, error: CURRENCY_UNSET };

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    let txn1Row: PaymentRow | null = null;
    try {
      txn1Row = this.ctx.storage.transactionSync(() => {
        const existing = this.readPaymentByIdempotencyKeySync(input.idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== input.requestFingerprint) {
            throw new IdempotencyKeyReused(input.idempotencyKey);
          }
          return existing;
        }

        this.ensureGuestFolioWindowSync(input.reservationId);
        const folioWindowId = this.readGuestFolioWindowIdSync(input.reservationId);
        const shiftId = this.readOpenShiftIdForActorSync(actor);
        const now = Date.now();
        try {
          this.ctx.storage.sql.exec(
            `INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
               capture_fingerprint, tender_type, shift_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL, 'CARD', ?, ?, ?)`,
            input.paymentId,
            input.reservationId,
            folioWindowId,
            input.amountMinor,
            ledgerCurrency,
            input.idempotencyKey,
            input.requestFingerprint,
            shiftId,
            now,
            now,
          );
        } catch (e) {
          const replay = this.readPaymentByIdempotencyKeySync(input.idempotencyKey);
          if (!replay) throw e;
          if (replay.request_fingerprint !== input.requestFingerprint) {
            throw new IdempotencyKeyReused(input.idempotencyKey);
          }
          return replay;
        }

        const inserted = this.readPaymentRowSync(input.paymentId);
        if (!inserted) throw new Error('payment_insert_failed');
        return inserted;
      });
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (txn1Row.status !== 'pending') {
      return this.authorizePaymentSuccessFromRow(txn1Row);
    }

    const adapterResult = await simulateAuthorize(
      {
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: ledgerCurrency,
      },
      this.pspSimulateOutcomeForTest,
    );

    if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
      return { ok: false, error: 'psp_adapter_failed' };
    }

    let txn2Row: PaymentRow | null = null;
    try {
      txn2Row = this.ctx.storage.transactionSync(() => {
        const now = Date.now();
        if (adapterResult.outcome === 'approved') {
          const updated = this.ctx.storage.sql.exec(
            `UPDATE payment
             SET status = 'authorized', gateway_reference = ?, updated_at = ?
             WHERE payment_id = ? AND status = 'pending'`,
            adapterResult.gatewayReference,
            now,
            input.paymentId,
          );
          if (updated.rowsWritten === 0) {
            const current = this.readPaymentRowSync(input.paymentId);
            if (!current) throw new Error(NOT_FOUND);
            return current;
          }
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.payment_authorized',
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              amountMinor: input.amountMinor,
              currency: ledgerCurrency,
              gatewayReference: adapterResult.gatewayReference,
            },
          });
          const authorizedRow = this.readPaymentRowSync(input.paymentId);
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.authorize',
            entityType: 'payment',
            entityId: input.paymentId,
            beforeJson: null,
            afterJson: {
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              amountMinor: input.amountMinor,
              currency: ledgerCurrency,
              status: 'authorized',
              shiftId: authorizedRow?.shift_id ?? null,
            },
            shiftId: authorizedRow?.shift_id ?? null,
            reservationId: input.reservationId,
          });
        } else if (adapterResult.outcome === 'declined') {
          this.ctx.storage.sql.exec(
            `UPDATE payment SET status = 'declined', updated_at = ? WHERE payment_id = ? AND status = 'pending'`,
            now,
            input.paymentId,
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE payment SET status = 'unknown', updated_at = ? WHERE payment_id = ? AND status = 'pending'`,
            now,
            input.paymentId,
          );
        }

        const current = this.readPaymentRowSync(input.paymentId);
        if (!current) throw new Error(NOT_FOUND);
        return current;
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    return this.authorizePaymentSuccessFromRow(txn2Row);
  }

  async tryCapturePayment(
    actor: ActorContext,
    input: {
      paymentId: string;
      amountMinor: number;
      idempotencyKey: string;
      captureFingerprint: string;
    },
  ): Promise<
    | {
        ok: true;
        paymentId: string;
        status: PaymentStatus;
        gatewayReference: string | null;
        capturedAmountMinor: number;
      }
    | {
        ok: false;
        error:
          | typeof NOT_FOUND
          | typeof PSP_UNAVAILABLE
          | typeof IDEM_KEY_REUSED
          | typeof PAYMENT_NOT_CAPTURABLE
          | typeof MONEY_INVALID;
      }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: MONEY_INVALID };
    }

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };

    if (payment.tender_type === 'CASH') {
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    if (payment.status === 'captured') {
      if (payment.capture_fingerprint === input.captureFingerprint) {
        return {
          ok: true,
          paymentId: payment.payment_id,
          status: payment.status,
          gatewayReference: payment.gateway_reference,
          capturedAmountMinor: payment.captured_amount_minor ?? 0,
        };
      }
      return { ok: false, error: IDEM_KEY_REUSED };
    }

    if (payment.status !== 'authorized') {
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    if (input.amountMinor > payment.amount_minor) {
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    const adapterResult = await simulateCapture(
      {
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        gatewayReference: payment.gateway_reference ?? `sim_${input.paymentId}`,
        currency: payment.currency,
      },
      this.pspSimulateOutcomeForTest,
    );

    if (adapterResult.outcome !== 'approved') {
      if (adapterResult.outcome === 'timeout') {
        this.ctx.storage.sql.exec(
          `UPDATE payment SET status = 'unknown', updated_at = ? WHERE payment_id = ? AND status = 'authorized'`,
          Date.now(),
          input.paymentId,
        );
      }
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    if (adapterResult.capturedAmountMinor > payment.amount_minor) {
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    try {
      return this.ctx.storage.transactionSync(() => {
        const updated = this.ctx.storage.sql.exec(
          `UPDATE payment
           SET status = 'captured',
               captured_amount_minor = ?,
               capture_fingerprint = ?,
               gateway_reference = ?,
               updated_at = ?
           WHERE payment_id = ? AND status = 'authorized'`,
          adapterResult.capturedAmountMinor,
          input.captureFingerprint,
          adapterResult.gatewayReference,
          Date.now(),
          input.paymentId,
        );
        if (updated.rowsWritten === 0) {
          const current = this.readPaymentRowSync(input.paymentId);
          if (!current) return { ok: false as const, error: NOT_FOUND };
          if (current.status === 'captured' && current.capture_fingerprint === input.captureFingerprint) {
            return {
              ok: true as const,
              paymentId: current.payment_id,
              status: current.status,
              gatewayReference: current.gateway_reference,
              capturedAmountMinor: current.captured_amount_minor ?? 0,
            };
          }
          if (current.status === 'captured') {
            return { ok: false as const, error: IDEM_KEY_REUSED };
          }
          return { ok: false as const, error: PAYMENT_NOT_CAPTURABLE };
        }

        const folioLineId = `${input.paymentId}:capture`;
        const fxRateAt = Date.now();
        this.assertChargeCodeSync('PAYMENT', { requireActive: true });
        this.insertFolioLineSync({
          folioLineId,
          folioWindowId: payment.folio_window_id,
          reservationId: payment.reservation_id,
          chargeCode: 'PAYMENT',
          posted: {
            amountMinor: -adapterResult.capturedAmountMinor,
            txnCurrency: currencyCode(payment.currency),
            ledgerAmountMinor: -adapterResult.capturedAmountMinor,
            fxRate: '1',
            fxRateAt,
          },
          source: 'PAYMENT',
          paymentId: input.paymentId,
        });

        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'folio.payment_captured',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            capturedAmountMinor: adapterResult.capturedAmountMinor,
            currency: payment.currency,
            gatewayReference: adapterResult.gatewayReference,
            folioLineId,
          },
        });

        this.appendAuditLogSync({
          actor: this.auditActorSync(actor),
          commandId: 'folio.capture',
          entityType: 'payment',
          entityId: input.paymentId,
          beforeJson: { status: 'authorized', amountMinor: payment.amount_minor },
          afterJson: {
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            status: 'captured',
            capturedAmountMinor: adapterResult.capturedAmountMinor,
            shiftId: payment.shift_id,
          },
          shiftId: payment.shift_id,
          reservationId: payment.reservation_id,
        });

        return {
          ok: true as const,
          paymentId: input.paymentId,
          status: 'captured' as const,
          gatewayReference: adapterResult.gatewayReference,
          capturedAmountMinor: adapterResult.capturedAmountMinor,
        };
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryOpenShift(
    actor: ActorContext,
    input: { shiftId: string; openingFloat: number },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; shiftId: string }
    | { ok: false; error: typeof SHIFT_ALREADY_OPEN }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof PROPERTY_ID_UNSET | typeof BUSINESS_DATE_UNSET | 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;
    if (actor.kind !== 'user') return { ok: false, error: FORBIDDEN };
    if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
      return { ok: false, error: MONEY_INVALID };
    }
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const open = this.readOpenShiftIdForActorSync(actor);
          if (open) throw new ShiftAlreadyOpenError();
          const now = Date.now();
          try {
            this.ctx.storage.sql.exec(
              `INSERT INTO shift (
                 shift_id, cashier_user_id, business_date, opened_at, closed_at,
                 opening_float, closing_count, variance, status, created_at, updated_at
               ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 'OPEN', ?, ?)`,
              input.shiftId,
              actor.userId,
              businessDate,
              now,
              input.openingFloat,
              now,
              now,
            );
          } catch {
            throw new ShiftAlreadyOpenError();
          }
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'shift.changed',
            payload: {
              propertyId,
              shiftId: input.shiftId,
              op: 'open',
              cashierUserId: actor.userId,
              businessDate,
              at: now,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.open_shift',
            entityType: 'shift',
            entityId: input.shiftId,
            beforeJson: null,
            afterJson: {
              shiftId: input.shiftId,
              status: 'OPEN',
              openingFloat: input.openingFloat,
              businessDate,
            },
            shiftId: input.shiftId,
          });
          return { ok: true as const, shiftId: input.shiftId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ShiftAlreadyOpenError) return { ok: false, error: SHIFT_ALREADY_OPEN };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryCloseShift(
    actor: ActorContext,
    input: { shiftId: string; closingCount: number },
    idem: IdempotencyKey,
  ): Promise<
    | {
        ok: true;
        shiftId: string;
        variance: number;
        unattributedCashCount: number;
      }
    | { ok: false; error: typeof SHIFT_NOT_FOUND | typeof SHIFT_NOT_OPEN }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof PROPERTY_ID_UNSET | 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;
    if (actor.kind !== 'user') return { ok: false, error: FORBIDDEN };
    if (!Number.isInteger(input.closingCount) || input.closingCount < 0) {
      return { ok: false, error: MONEY_INVALID };
    }
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT shift_id, cashier_user_id, business_date, opened_at, closed_at,
                      opening_float, closing_count, variance, status, created_at, updated_at
               FROM shift WHERE shift_id = ?`,
              input.shiftId,
            )
            .toArray() as ShiftRow[];
          const row = rows[0];
          if (!row) throw new ShiftNotFoundError();
          if (row.status !== 'OPEN') throw new ShiftNotOpenError();
          if (row.cashier_user_id !== actor.userId) throw new ShiftNotFoundError();

          const expected = this.computeShiftExpectedCashSync(row.shift_id, row.opening_float);
          const variance = expected - input.closingCount;
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE shift
             SET status = 'CLOSED', closed_at = ?, closing_count = ?, variance = ?, updated_at = ?
             WHERE shift_id = ? AND status = 'OPEN'`,
            now,
            input.closingCount,
            variance,
            now,
            input.shiftId,
          );
          const unattributedCashCount = this.countUnattributedCashForBusinessDateSync(
            row.business_date,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'shift.changed',
            payload: {
              propertyId,
              shiftId: input.shiftId,
              op: 'close',
              cashierUserId: actor.userId,
              variance,
              at: now,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.close_shift',
            entityType: 'shift',
            entityId: input.shiftId,
            beforeJson: {
              status: 'OPEN',
              openingFloat: row.opening_float,
            },
            afterJson: {
              shiftId: input.shiftId,
              status: 'CLOSED',
              closingCount: input.closingCount,
              variance,
            },
            shiftId: input.shiftId,
          });
          return {
            ok: true as const,
            shiftId: input.shiftId,
            variance,
            unattributedCashCount,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ShiftNotFoundError) return { ok: false, error: SHIFT_NOT_FOUND };
      if (e instanceof ShiftNotOpenError) return { ok: false, error: SHIFT_NOT_OPEN };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryRecordCashPayment(
    actor: ActorContext,
    input: {
      paymentId: string;
      reservationId: string;
      amountMinor: number;
      idempotencyKey: string;
      requestFingerprint: string;
    },
  ): Promise<
    | {
        ok: true;
        paymentId: string;
        status: 'captured';
        shiftId: string | null;
        folioLineId: string;
      }
    | { ok: false; error: typeof MONEY_INVALID | typeof NOT_FOUND | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof CURRENCY_UNSET | typeof PROPERTY_ID_UNSET | 'org_id_unset' }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    // Highest-risk footgun: must never consult PSP / pspSimulateEnabled.
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: MONEY_INVALID };
    }
    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) return { ok: false, error: CURRENCY_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.readPaymentByIdempotencyKeySync(input.idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== input.requestFingerprint) {
            throw new IdempotencyKeyReused(input.idempotencyKey);
          }
          return {
            ok: true as const,
            paymentId: existing.payment_id,
            status: 'captured' as const,
            shiftId: existing.shift_id,
            folioLineId: `${existing.payment_id}:capture`,
          };
        }

        const resRows = this.ctx.storage.sql
          .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, input.reservationId)
          .toArray();
        if (!resRows[0]) return { ok: false as const, error: NOT_FOUND };

        this.ensureGuestFolioWindowSync(input.reservationId);
        const folioWindowId = this.readGuestFolioWindowIdSync(input.reservationId);
        const shiftId = this.readOpenShiftIdForActorSync(actor);
        const now = Date.now();
        this.ctx.storage.sql.exec(
          `INSERT INTO payment (
             payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
             gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
             capture_fingerprint, tender_type, shift_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'captured', NULL, ?, ?, ?, NULL, 'CASH', ?, ?, ?)`,
          input.paymentId,
          input.reservationId,
          folioWindowId,
          input.amountMinor,
          ledgerCurrency,
          input.amountMinor,
          input.idempotencyKey,
          input.requestFingerprint,
          shiftId,
          now,
          now,
        );

        const folioLineId = `${input.paymentId}:capture`;
        this.assertChargeCodeSync('PAYMENT', { requireActive: true });
        this.insertFolioLineSync({
          folioLineId,
          folioWindowId,
          reservationId: input.reservationId,
          chargeCode: 'PAYMENT',
          posted: {
            amountMinor: -input.amountMinor,
            txnCurrency: ledgerCurrency,
            ledgerAmountMinor: -input.amountMinor,
            fxRate: '1',
            fxRateAt: now,
          },
          source: 'PAYMENT',
          paymentId: input.paymentId,
        });

        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'folio.payment_captured',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: input.reservationId,
            capturedAmountMinor: input.amountMinor,
            currency: ledgerCurrency,
            gatewayReference: null,
            folioLineId,
            tenderType: 'CASH',
            shiftId,
          },
        });

        this.appendAuditLogSync({
          actor: this.auditActorSync(actor),
          commandId: 'folio.record_cash_payment',
          entityType: 'payment',
          entityId: input.paymentId,
          beforeJson: null,
          afterJson: {
            paymentId: input.paymentId,
            reservationId: input.reservationId,
            amountMinor: input.amountMinor,
            currency: ledgerCurrency,
            tenderType: 'CASH',
            status: 'captured',
            shiftId,
          },
          shiftId,
          reservationId: input.reservationId,
        });

        return {
          ok: true as const,
          paymentId: input.paymentId,
          status: 'captured' as const,
          shiftId,
          folioLineId,
        };
      });
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async readShift(shiftId: string): Promise<
    | {
        ok: true;
        shift: {
          shiftId: string;
          cashierUserId: string;
          businessDate: string;
          openedAt: number;
          closedAt: number | null;
          openingFloat: number;
          closingCount: number | null;
          variance: number | null;
          status: ShiftStatus;
          unattributedCashCount: number;
        };
      }
    | { ok: false; error: typeof SHIFT_NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT shift_id, cashier_user_id, business_date, opened_at, closed_at,
                opening_float, closing_count, variance, status, created_at, updated_at
         FROM shift WHERE shift_id = ?`,
        shiftId,
      )
      .toArray() as ShiftRow[];
    const row = rows[0];
    if (!row) return { ok: false, error: SHIFT_NOT_FOUND };
    return {
      ok: true,
      shift: this.mapShiftRow(row, {
        unattributedCashCount: this.countUnattributedCashForBusinessDateSync(row.business_date),
      }) as {
        shiftId: string;
        cashierUserId: string;
        businessDate: string;
        openedAt: number;
        closedAt: number | null;
        openingFloat: number;
        closingCount: number | null;
        variance: number | null;
        status: ShiftStatus;
        unattributedCashCount: number;
      },
    };
  }

  async readPayment(paymentId: string): Promise<
    | {
        ok: true;
        payment: {
          paymentId: string;
          reservationId: string;
          amountMinor: number;
          currency: string;
          status: PaymentStatus;
          gatewayReference: string | null;
          capturedAmountMinor: number | null;
          tenderType: 'CARD' | 'CASH';
          shiftId: string | null;
          createdAt: number;
          updatedAt: number;
        };
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const row = this.readPaymentRowSync(paymentId);
    if (!row) return { ok: false, error: NOT_FOUND };
    return { ok: true, payment: this.mapPaymentRow(row) };
  }

  async listPaymentsForReservation(reservationId: string): Promise<
    | {
        ok: true;
        payments: Array<{
          paymentId: string;
          reservationId: string;
          amountMinor: number;
          currency: string;
          status: PaymentStatus;
          gatewayReference: string | null;
          capturedAmountMinor: number | null;
          createdAt: number;
          updatedAt: number;
        }>;
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const reservationRows = this.ctx.storage.sql
      .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ reservation_id: string }>;
    if (!reservationRows[0]) return { ok: false, error: NOT_FOUND };

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, reservation_id, amount_minor, currency, status, gateway_reference,
                captured_amount_minor, created_at, updated_at
         FROM payment WHERE reservation_id = ?
         ORDER BY created_at ASC`,
        reservationId,
      )
      .toArray() as Array<{
      payment_id: string;
      reservation_id: string;
      amount_minor: number;
      currency: string;
      status: PaymentStatus;
      gateway_reference: string | null;
      captured_amount_minor: number | null;
      created_at: number;
      updated_at: number;
    }>;

    return {
      ok: true,
      payments: rows.map((row) => ({
        paymentId: row.payment_id,
        reservationId: row.reservation_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        gatewayReference: row.gateway_reference,
        capturedAmountMinor: row.captured_amount_minor,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  async trySplitChargePayment(
    actor: ActorContext,
    input: {
      sourceFolioLineId: string;
      splits: Array<{ folioLineId: string; amountMinor: number }>;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineIds: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof SPLIT_AMOUNT_MISMATCH }
    | { ok: false; error: typeof LINE_NOT_SPLITTABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: string }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const sourceRows = this.ctx.storage.sql
            .exec(
              `SELECT folio_line_id, folio_window_id, reservation_id, charge_code, amount_minor,
                      txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, source
               FROM folio_line WHERE folio_line_id = ?`,
              input.sourceFolioLineId,
            )
            .toArray() as Array<{
            folio_line_id: string;
            folio_window_id: string;
            reservation_id: string;
            charge_code: string;
            amount_minor: number;
            txn_currency: string;
            ledger_amount_minor: number;
            fx_rate: string;
            fx_rate_at: number;
            source: string | null;
          }>;
          const source = sourceRows[0];
          if (!source) return { ok: false as const, error: NOT_FOUND };
          if (source.source !== 'PAYMENT') {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }

          const splitTotal = input.splits.reduce((sum, split) => sum + split.amountMinor, 0);
          if (splitTotal !== source.amount_minor) {
            return { ok: false as const, error: SPLIT_AMOUNT_MISMATCH };
          }

          const folioLineIds = this.splitFolioLineSync(source, input.splits);
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.split_charge_payment',
            entityType: 'folio_line',
            entityId: input.sourceFolioLineId,
            beforeJson: { amountMinor: source.amount_minor },
            afterJson: { sourceFolioLineId: input.sourceFolioLineId, folioLineIds },
            reservationId: source.reservation_id,
          });
          return { ok: true as const, folioLineIds };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Test-only: insert a second folio line with the same payment_id (unique index probe). */
  async insertDuplicatePaymentLineForTest(input: {
    folioLineId: string;
    paymentId: string;
    reservationId: string;
    folioWindowId: string;
    amountMinor: number;
  }): Promise<void> {
    this.assertUnsafeLocal('insertDuplicatePaymentLineForTest');
    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) throw new Error(CURRENCY_UNSET);
    const fxRateAt = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO folio_line (
         folio_line_id, folio_window_id, reservation_id, charge_code,
         amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
         source, business_date, split_of, created_at, payment_id
       ) VALUES (?, ?, ?, 'PAYMENT', ?, ?, ?, '1', ?, 'PAYMENT', NULL, NULL, ?, ?)`,
      input.folioLineId,
      input.folioWindowId,
      input.reservationId,
      input.amountMinor,
      ledgerCurrency,
      input.amountMinor,
      fxRateAt,
      Date.now(),
      input.paymentId,
    );
  }

  async readFolio(reservationId: string): Promise<
    | {
        ok: true;
        window: { folioWindowId: string; kind: string; status: string } | null;
        lines: Array<{
          folioLineId: string;
          chargeCode: string;
          amountMinor: number;
          ledgerAmountMinor: number;
          txnCurrency: string;
          source: string | null;
          businessDate: string | null;
          splitOf: string | null;
          createdAt: number;
          paymentId: string | null;
          taxOf: string | null;
          taxRuleId: string | null;
        }>;
        balanceMinor: number;
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const reservationRows = this.ctx.storage.sql
      .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ reservation_id: string }>;
    if (!reservationRows[0]) return { ok: false, error: NOT_FOUND };

    const windowRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, kind, status FROM folio_window WHERE reservation_id = ? AND kind = 'GUEST'`,
        reservationId,
      )
      .toArray() as Array<{ folio_window_id: string; kind: string; status: string }>;

    const lineRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, charge_code, amount_minor, ledger_amount_minor, txn_currency,
                source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id
         FROM folio_line WHERE reservation_id = ?
         ORDER BY created_at ASC`,
        reservationId,
      )
      .toArray() as Array<{
      folio_line_id: string;
      charge_code: string;
      amount_minor: number;
      ledger_amount_minor: number;
      txn_currency: string;
      source: string | null;
      business_date: string | null;
      split_of: string | null;
      created_at: number;
      payment_id: string | null;
      tax_of: string | null;
      tax_rule_id: string | null;
    }>;

    const balanceMinor = lineRows.reduce((sum, row) => sum + row.ledger_amount_minor, 0);
    const windowRow = windowRows[0];

    return {
      ok: true,
      window: windowRow
        ? { folioWindowId: windowRow.folio_window_id, kind: windowRow.kind, status: windowRow.status }
        : null,
      lines: lineRows.map((row) => ({
        folioLineId: row.folio_line_id,
        chargeCode: row.charge_code,
        amountMinor: row.amount_minor,
        ledgerAmountMinor: row.ledger_amount_minor,
        txnCurrency: row.txn_currency,
        source: row.source,
        businessDate: row.business_date,
        splitOf: row.split_of,
        createdAt: row.created_at,
        paymentId: row.payment_id,
        taxOf: row.tax_of,
        taxRuleId: row.tax_rule_id,
      })),
      balanceMinor,
    };
  }

  async insertReservationForTest(input: {
    reservationId: string;
    roomTypeId: string;
    guestRef: string;
    piiKeyId: string;
    arrivalDate: string;
    departureDate: string;
    status?: string;
    roomId?: string;
    adults?: number;
    children?: number;
    frontOfficeComment?: string;
    vipFlag?: boolean;
    ratePlanId?: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    confirmBy?: number;
    expiresAt?: number;
  }): Promise<void> {
    this.assertUnsafeLocal('insertReservationForTest');
    const now = Date.now();
    const hasOptional =
      input.roomId !== undefined ||
      input.adults !== undefined ||
      input.children !== undefined ||
      input.frontOfficeComment !== undefined ||
      input.vipFlag !== undefined ||
      input.ratePlanId !== undefined ||
      input.cancelPenaltyType !== undefined ||
      input.cancelGraceHours !== undefined ||
      input.cancelPenaltyNights !== undefined ||
      input.cancelPenaltyBps !== undefined ||
      input.confirmBy !== undefined ||
      input.expiresAt !== undefined;
    if (!hasOptional) {
      this.ctx.storage.sql.exec(
        `INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.reservationId,
        input.roomTypeId,
        input.guestRef,
        input.piiKeyId,
        input.arrivalDate,
        input.departureDate,
        input.status ?? 'confirmed',
        now,
        now,
      );
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO reservation (
         reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
         status, room_id, adults, children, front_office_comment, vip_flag, rate_plan_id,
         cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps,
         confirm_by, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.reservationId,
      input.roomTypeId,
      input.guestRef,
      input.piiKeyId,
      input.arrivalDate,
      input.departureDate,
      input.status ?? 'confirmed',
      input.roomId ?? null,
      input.adults ?? 1,
      input.children ?? 0,
      input.frontOfficeComment ?? null,
      input.vipFlag ? 1 : 0,
      input.ratePlanId ?? 'BAR',
      input.cancelPenaltyType ?? 'none',
      input.cancelGraceHours ?? 0,
      input.cancelPenaltyNights ?? null,
      input.cancelPenaltyBps ?? null,
      input.confirmBy ?? null,
      input.expiresAt ?? null,
      now,
      now,
    );
  }

  async bumpSoldForTest(roomTypeId: string, stayDate: string, delta: number): Promise<void> {
    this.assertUnsafeLocal('bumpSoldForTest');
    const rt = this.ctx.storage.sql
      .exec(`SELECT room_count FROM room_type WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ room_count: number }>;
    const physical = rt[0]?.room_count ?? 0;
    const oversell = this.materializedOversellAllowanceSync();
    this.ctx.storage.sql.exec(
      `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
       VALUES (?, ?, ?, 0, 0, ?, ?, 1)
       ON CONFLICT(room_type_id, stay_date) DO UPDATE SET
         sold = availability_day.sold + excluded.sold,
         version = availability_day.version + 1`,
      roomTypeId,
      stayDate,
      physical,
      delta,
      oversell,
    );
  }

  async countFolioLinesForReservation(reservationId: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM folio_line WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async countFolioLines(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM folio_line`)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async readGuestFolioWindowForTest(
    reservationId: string,
  ): Promise<{ folioWindowId: string; kind: string; status: string } | null> {
    this.assertUnsafeLocal('readGuestFolioWindowForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, kind, status FROM folio_window WHERE reservation_id = ? AND kind = 'GUEST'`,
        reservationId,
      )
      .toArray() as Array<{ folio_window_id: string; kind: string; status: string }>;
    const row = rows[0];
    return row ? { folioWindowId: row.folio_window_id, kind: row.kind, status: row.status } : null;
  }

  async readNightAuditRunError(businessDate: string, step: NightAuditStep): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT error FROM night_audit_run WHERE business_date = ? AND step = ?`,
        businessDate,
        step,
      )
      .toArray() as Array<{ error: string | null }>;
    return rows[0]?.error ?? null;
  }

  async listFolioLinesForReservation(
    reservationId: string,
  ): Promise<
    Array<{
      folioLineId: string;
      chargeCode: string;
      amountMinor: number;
      source: string | null;
      businessDate: string | null;
      splitOf: string | null;
      taxOf: string | null;
      taxRuleId: string | null;
    }>
  > {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, charge_code, amount_minor, source, business_date, split_of, tax_of, tax_rule_id
         FROM folio_line WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{
      folio_line_id: string;
      charge_code: string;
      amount_minor: number;
      source: string | null;
      business_date: string | null;
      split_of: string | null;
      tax_of: string | null;
      tax_rule_id: string | null;
    }>;
    return rows.map((row) => ({
      folioLineId: row.folio_line_id,
      chargeCode: row.charge_code,
      amountMinor: row.amount_minor,
      source: row.source,
      businessDate: row.business_date,
      splitOf: row.split_of,
      taxOf: row.tax_of,
      taxRuleId: row.tax_rule_id,
    }));
  }

  private resolveFolioLineMoney(
    input: {
      amountMinor: number;
      txnCurrency?: string;
      ledgerAmountMinor?: number;
      fxRate?: string;
      fxRateAt?: number;
    },
    ledgerCurrency: CurrencyCode,
  ):
    | { ok: true; posted: PostedLineAmount }
    | { ok: false; error: typeof CROSS_CURRENCY_UNSUPPORTED }
    | { ok: false; error: typeof FX_RATE_INVALID }
    | { ok: false; error: typeof LEDGER_AMOUNT_MISMATCH }
    | { ok: false; error: typeof MONEY_INVALID } {
    const fxRateAt = input.fxRateAt ?? Date.now();
    if (input.txnCurrency !== undefined && input.txnCurrency !== ledgerCurrency) {
      return { ok: false, error: CROSS_CURRENCY_UNSUPPORTED };
    }
    const normalized = {
      amountMinor: input.amountMinor,
      txnCurrency: input.txnCurrency ?? ledgerCurrency,
      ledgerAmountMinor: input.ledgerAmountMinor ?? input.amountMinor,
      fxRate: input.fxRate ?? '1',
      fxRateAt,
    };
    const validated = this.validateFolioLineMoney(normalized, ledgerCurrency, fxRateAt);
    if (!validated.ok) {
      if (validated.error === FX_RATE_INVALID) return { ok: false, error: FX_RATE_INVALID };
      if (validated.error === LEDGER_AMOUNT_MISMATCH) return { ok: false, error: LEDGER_AMOUNT_MISMATCH };
      return { ok: false, error: MONEY_INVALID };
    }
    return validated;
  }

  private outboxSourceSync(): EventSource {
    const id = this.getPropertyIdSync();
    if (!id) throw new Error(PROPERTY_ID_UNSET);
    return { do: 'property', id };
  }

  private appendPropertyOutbox(row: {
    eventId: string;
    eventType: string;
    payload: unknown;
  }): void {
    appendOutbox(this.ctx.storage.sql, { ...row, source: this.outboxSourceSync() });
  }

  private validateFolioLineMoney(
    input: {
      amountMinor: number;
      txnCurrency: string;
      ledgerAmountMinor: number;
      fxRate: string;
    },
    ledgerCurrency: CurrencyCode,
    fxRateAt: number,
  ): { ok: true; posted: PostedLineAmount } | { ok: false; error: string } {
    try {
      const posted = assertPostedMatches(
        {
          amountMinor: input.amountMinor,
          txnCurrency: input.txnCurrency,
          ledgerAmountMinor: input.ledgerAmountMinor,
          fxRate: input.fxRate,
          fxRateAt,
        },
        ledgerCurrency,
      );
      return { ok: true, posted };
    } catch (e) {
      if (e instanceof InvalidFxRateError) return { ok: false, error: FX_RATE_INVALID };
      if (e instanceof LedgerAmountMismatchError) return { ok: false, error: LEDGER_AMOUNT_MISMATCH };
      if (e instanceof InvalidMoneyError) return { ok: false, error: MONEY_INVALID };
      return { ok: false, error: MONEY_INVALID };
    }
  }

  async listDomainKeys(): Promise<string[]> {
    return domainConfigKeys().map((e) => e.key);
  }

  async outboxUnackedCount(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async getOutboxBacklog(): Promise<{ unackedCount: number; oldestCreatedAt: number | null }> {
    return outboxBacklogSnapshot(this.ctx.storage.sql);
  }

  async drainOutboxBatch(opts?: { maxMessages?: number; maxBytes?: number }): Promise<OutboxRow[]> {
    return drainOutbox(this.ctx.storage.sql, { ...opts, source: this.outboxSourceSync() }).rows;
  }

  async ackOutboxThrough(seq: number): Promise<void> {
    ackOutboxThroughSql(this.ctx.storage.sql, seq);
  }

  async flushOutbox(
    deliver?: (batch: OutboxRow[]) => Promise<void>,
    drainOpts?: { maxMessages?: number; maxBytes?: number },
  ): Promise<{ flushed: number; backlog: boolean; rows: OutboxRow[] }> {
    const { rows: batch, backlog } = drainOutbox(this.ctx.storage.sql, {
      source: this.outboxSourceSync(),
      ...drainOpts,
    });
    if (batch.length === 0) return { flushed: 0, backlog: false, rows: [] };
    if (deliver) await deliver(batch);
    ackOutboxThroughSql(this.ctx.storage.sql, batch[batch.length - 1]!.seq);
    return { flushed: batch.length, backlog, rows: batch };
  }
}
