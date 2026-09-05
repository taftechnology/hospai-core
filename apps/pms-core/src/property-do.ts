import { DurableObject } from 'cloudflare:workers';
import { zonedWallClockMs } from './zoned-wall-clock.js';
import {
  ARCHIVE_BLOCKED,
  CONSTITUENT_IN_USE,
  ALREADY_RESOLVED,
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
  FRONT_OFFICE_COMMENT_TOO_LONG,
  NOT_FOUND,
  NOTE_TOO_LONG,
  NOTE_LIMIT,
  NO_AVAILABILITY,
  OVERSELL,
  PROPERTY_ID_UNSET,
  ROOM_TYPE_EXISTS,
  ROOM_TYPE_CODE_EXISTS,
  ROOM_TYPE_KIND_IMMUTABLE,
  TIMEZONE_UNSET,
  VIRTUAL_CONSTITUENT_NOT_PHYSICAL,
  VIRTUAL_CONSTITUENTS_DUPLICATE,
  VIRTUAL_CONSTITUENTS_MIN_TWO,
  VIRTUAL_CONSTITUENTS_ON_PHYSICAL,
  VIRTUAL_CONSTITUENTS_REQUIRED,
  VIRTUAL_NESTED_FORBIDDEN,
  VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS,
  VIRTUAL_ROOM_COUNT_MUST_BE_ZERO,
  VIRTUAL_TYPE_NO_ROOMS,
  UNBOOKABLE,
  ALREADY_CANCELLED,
  LEDGER_INCONSISTENT,
  NOT_MODIFIABLE,
  INVALID_STATUS_TRANSITION,
  NO_SHOW_BEFORE_ARRIVAL,
  RESTRICTION_VIOLATED,
  RATE_MISSING,
  INVALID_CANCEL_POLICY,
  ROOM_OUT_OF_ORDER,
  OOO_VIA_RANGE,
  OOO_ROOM_ASSIGNED,
  OOO_RANGE_OVERLAP,
  OOO_INVALID_RANGE,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_UNITS_EXCEED_COUNT,
  ROOM_TYPE_MISMATCH,
  ROOM_ALREADY_ASSIGNED,
  ROOM_NOT_ASSIGNABLE,
  ROOM_REQUIRED,
  ROOM_NOT_READY,
  BALANCE_DUE,
  FOLIO_BALANCE_DUE,
  INVOICE_ALREADY_EXISTS,
  INVOICE_NOT_FOUND,
  INVOICE_REQUIRED,
  INVOICE_R2_UNBOUND,
  INVOICE_VOIDED,
  CITY_LEDGER_ACCOUNT_NOT_FOUND,
  CITY_LEDGER_ACCOUNT_EXISTS,
  CITY_LEDGER_ACCOUNT_ARCHIVED,
  CITY_LEDGER_CREDIT_LIMIT_EXCEEDED,
  CITY_LEDGER_BILLED_PARTY_INVALID,
  CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE,
  CITY_LEDGER_STATEMENT_NOT_FOUND,
  CITY_LEDGER_R2_UNBOUND,
  CITY_LEDGER_CHARGE_ALREADY_POSTED,
  WINDOW_CLOSED,
  WINDOW_NOT_CLOSABLE,
  WINDOW_BALANCE_DUE,
  WINDOW_NOT_REOPENABLE,
  WINDOW_NOT_OPENABLE,
  GUEST_WINDOW_NOT_OPENABLE,
  TRANSFER_CROSS_RESERVATION,
  TRANSFER_SAME_WINDOW,
  LINE_NOT_TRANSFERABLE,
  LINE_ALREADY_TRANSFERRED,
  LINE_NOT_DISCOUNTABLE,
  DISCOUNT_REASON_REQUIRED,
  RATE_PLAN_NOT_FOUND,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  DEFAULT_RATE_PLAN_PROTECTED,
  DERIVED_RATE_PLAN_INVALID,
  DERIVED_RATE_PLAN_WRITE_FORBIDDEN,
  PROMO_NOT_FOUND,
  PROMO_NOT_APPLICABLE,
  PROMO_CODE_EXISTS,
  CHARGE_CODE_NOT_FOUND,
  CHARGE_CODE_EXISTS,
  ROUTING_RULE_CONFLICT,
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
  FX_RATE_MISSING,
  FX_RATE_NOT_LEDGER,
  FX_RATE_OPEN_EXISTS,
  FX_REASON_REQUIRED,
  PAYMENT_NOT_CHARGEBACKABLE,
  SPLIT_AMOUNT_MISMATCH,
  LINE_NOT_SPLITTABLE,
  PSP_UNAVAILABLE,
  PSP_ADAPTER_FAILED,
  PAYMENT_INSERT_FAILED,
  VALIDATION_ERROR,
  INVALID_VOID_REASON,
  BULK_NOT_ADMITTED,
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_RECONCILABLE,
  PAYMENT_NOT_VOIDABLE,
  PAYMENT_NOT_REFUNDABLE,
  REFUND_EXCEEDS_REMAINING,
  SHIFT_NOT_FOUND,
  SHIFT_ALREADY_OPEN,
  SHIFT_NOT_OPEN,
  FORBIDDEN,
  CONFIG_CLASS_NOT_DOMAIN,
  ORG_ID_UNSET,
  NOT_MEMBER,
  NIGHT_AUDIT_HALTED,
  NIGHT_AUDIT_STEP_NOT_FAILED,
  NIGHT_AUDIT_NOT_DUE,
  UNKNOWN_COMMAND,
  INVALID_STATUS,
  INVALID_BUSINESS_DATE,
  INVALID_ASSIGNEE_REF,
  INVALID_DATE,
  GUEST_REF_REQUIRED,
  INVALID_STAY_RANGE,
  INVALID_WINDOW,
  INVALID_DATE_RANGE,
  INVALID_PROMO_CODE,
  INVALID_PROMO_WINDOW,
  INVALID_PROMO_KIND_FIELD,
  PROMO_ID_EXISTS,
  INVOICE_COUNTER_RACE,
  ORG_UNREACHABLE,
  INTERNAL_ERROR,
  DOMAIN_ERROR,
  LIMIT_EXCEEDED,
  RATES_BULK_UPDATE_MAX,
  ROOMS_BULK_STATUS_MAX,
  FOLIO_SPLIT_MAX,
  configUndeclared,
  isCommandError,
  type CommandError,
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
  deleteFutureHousekeepingAssignments,
  HousekeepingOooViaRangeError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
  InvalidAssigneeRefError,
  isCleanlinessStatus,
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
import { REPLAY_DISPATCH } from './replay-dispatch.js';
import {
  allocateVirtualConstituent,
  archiveBlocked,
  enumerateFromDate,
  enumerateHorizonDates,
  HORIZON_DAYS,
  oversellDates,
  sumConstituentFree,
  type ConstituentAvailabilityRow,
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
  ledgerToTxn,
  money,
  postToLedger,
  InvalidFxRateError,
  InvalidMoneyError,
  validateFxRate,
  LedgerAmountMismatchError,
  roundHalfAwayFromZero,
  applyPromoToAmountMinor,
  type CurrencyCode,
  type PromoApplyInput,
  type PostedLineAmount,
} from '@hospai/money';
import { isJurisdictionSimulate, isPspSimulate, type PmsEnv } from './env.js';
import {
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  type PspSimulateOutcome,
} from './psp-simulate.js';
import type { OrgDO } from './org-do.js';
import {
  isOrgDoTransportFailure,
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
} from './org-do-transport.js';
import { PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE } from './property-do-transport.js';
import { runOutboxAlarmStep, type OutboxAlarmContext, type OutboxFlushResult } from './outbox-observability.js';
import {
  cityLedgerStatementObjectKey,
  hasEventLogR2,
  invoiceObjectKey,
  reportObjectKey,
} from './event-log.js';

type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'declined'
  | 'captured'
  | 'unknown'
  | 'voided'
  | 'refunded'
  | 'chargeback';
type CheckOutAutoCapture = 'captured' | 'failed' | 'skipped' | 'disabled';

const AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS = 3_600_000;

const FRONT_OFFICE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FRONT_OFFICE_OUTBOX_TYPES = new Set([
  'reservation.created',
  'reservation.modified',
  'reservation.status_changed',
  'reservation.room_assigned',
  'reservation.front_office_updated',
  'room.created',
  'room.updated',
  'room.status_changed',
  'room.ooo_changed',
]);
const FRONT_OFFICE_MAX_SOCKETS = 50;
const FRONT_OFFICE_REAUTH_INTERVAL_MS = 30_000;
const FRONT_OFFICE_WS_CLOSE_POLICY = 4403;
const FRONT_OFFICE_WS_CLOSE_REASON = 'policy_violation';
const OCCUPYING_STATUSES = new Set(['pending', 'confirmed', 'checked_in']);

type FrontOfficeAttachment = {
  propertyId: string;
  userId: string;
  fromDate: string | null;
  toDate: string | null;
  authCheckedAt: number;
};

type FrontOfficeDelta = {
  rooms?: Array<{
    roomId: string;
    roomTypeId: string;
    code: string;
    status: string;
    floor: string | null;
  }>;
  blocks?: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
  ooo?: Array<{ oooId: string; roomId: string; startDate: string; endDate: string; reason: string | null }>;
  removedBlockIds?: string[];
  removedOooIds?: string[];
};

function isInclusiveTapeWindow(fromDate: string, toDate: string): boolean {
  if (!FRONT_OFFICE_ISO_DATE.test(fromDate) || !FRONT_OFFICE_ISO_DATE.test(toDate)) return false;
  if (fromDate > toDate) return false;
  const maxTo = enumerateFromDate(fromDate, 90)[89];
  return maxTo != null && toDate <= maxTo;
}

function stayOverlapsWindow(
  fromDate: string,
  toDate: string,
  arrivalDate: string,
  departureDate: string,
): boolean {
  return arrivalDate <= toDate && departureDate > fromDate;
}

function oooOverlapsWindow(
  fromDate: string,
  toDate: string,
  startDate: string,
  endDate: string,
): boolean {
  const toExclusive = enumerateFromDate(toDate, 2)[1];
  return toExclusive != null && startDate < toExclusive && endDate > fromDate;
}

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
  purpose: 'STAY' | 'DAMAGE';
  refunded_amount_minor: number | null;
  void_fingerprint: string | null;
  refund_fingerprint: string | null;
  fx_rate: string | null;
  fx_rate_at: number | null;
  balance_at_risk: number;
  last_payment_event_id: string | null;
  card_last4: string | null;
  card_brand: string | null;
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

type PromoRow = {
  promo_id: string;
  code: string;
  name: string;
  status: string;
  kind: 'percent' | 'fixed_per_night';
  bps: number | null;
  amount_minor: number | null;
  valid_from: string | null;
  valid_to: string | null;
  rate_plan_id: string | null;
};

type PromoSnapshotRow = Pick<PromoRow, 'kind' | 'bps' | 'amount_minor'>;

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

class DerivedRatePlanInvalidError extends Error {
  constructor() {
    super(DERIVED_RATE_PLAN_INVALID);
    this.name = 'DerivedRatePlanInvalidError';
  }
}

class DerivedRatePlanWriteForbiddenError extends Error {
  constructor() {
    super(DERIVED_RATE_PLAN_WRITE_FORBIDDEN);
    this.name = 'DerivedRatePlanWriteForbiddenError';
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

class PromoNotFoundError extends Error {
  constructor() {
    super(PROMO_NOT_FOUND);
    this.name = 'PromoNotFoundError';
  }
}

class PromoNotApplicableError extends Error {
  constructor() {
    super(PROMO_NOT_APPLICABLE);
    this.name = 'PromoNotApplicableError';
  }
}

class PromoCodeExistsError extends Error {
  constructor() {
    super(PROMO_CODE_EXISTS);
    this.name = 'PromoCodeExistsError';
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

class RoutingRuleConflictError extends Error {
  constructor() {
    super(ROUTING_RULE_CONFLICT);
    this.name = 'RoutingRuleConflictError';
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

class FxRateNotLedgerError extends Error {
  constructor() {
    super(FX_RATE_NOT_LEDGER);
    this.name = 'FxRateNotLedgerError';
  }
}

class FxRateOpenExistsError extends Error {
  constructor() {
    super(FX_RATE_OPEN_EXISTS);
    this.name = 'FxRateOpenExistsError';
  }
}

class PaymentNotChargebackableError extends Error {
  constructor() {
    super(PAYMENT_NOT_CHARGEBACKABLE);
    this.name = 'PaymentNotChargebackableError';
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

class FrontOfficeCommentTooLongError extends Error {
  constructor() {
    super(FRONT_OFFICE_COMMENT_TOO_LONG);
    this.name = 'FrontOfficeCommentTooLongError';
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

class OooInvalidRangeError extends Error {
  constructor() {
    super(OOO_INVALID_RANGE);
    this.name = 'OooInvalidRangeError';
  }
}

class OooRangeOverlapError extends Error {
  constructor() {
    super(OOO_RANGE_OVERLAP);
    this.name = 'OooRangeOverlapError';
  }
}

class OooRoomAssignedError extends Error {
  constructor(public readonly reservationId?: string) {
    super(OOO_ROOM_ASSIGNED);
    this.name = 'OooRoomAssignedError';
  }
}

class RoomRequiredError extends Error {
  constructor() {
    super(ROOM_REQUIRED);
    this.name = 'RoomRequiredError';
  }
}

class RoomNotReadyError extends Error {
  constructor() {
    super(ROOM_NOT_READY);
    this.name = 'RoomNotReadyError';
  }
}

class BalanceDueError extends Error {
  constructor(public readonly balanceMinor: number) {
    super(BALANCE_DUE);
    this.name = 'BalanceDueError';
  }
}

class InvoiceAlreadyExistsError extends Error {
  constructor() {
    super(INVOICE_ALREADY_EXISTS);
    this.name = 'InvoiceAlreadyExistsError';
  }
}
class InvoiceR2UnboundError extends Error {
  constructor() {
    super(INVOICE_R2_UNBOUND);
    this.name = 'InvoiceR2UnboundError';
  }
}
class FolioBalanceDueError extends Error {
  constructor(public balanceMinor: number) {
    super(FOLIO_BALANCE_DUE);
    this.name = 'FolioBalanceDueError';
  }
}
class InvoiceNotFoundError extends Error {
  constructor() {
    super(INVOICE_NOT_FOUND);
    this.name = 'InvoiceNotFoundError';
  }
}
class InvoiceVoidedError extends Error {
  constructor() {
    super(INVOICE_VOIDED);
    this.name = 'InvoiceVoidedError';
  }
}

class InvoiceRequiredError extends Error {
  constructor() {
    super(INVOICE_REQUIRED);
    this.name = 'InvoiceRequiredError';
  }
}

class CityLedgerError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'CityLedgerError';
  }
}

class CityLedgerCreditLimitExceededError extends Error {
  constructor() {
    super(CITY_LEDGER_CREDIT_LIMIT_EXCEEDED);
    this.name = 'CityLedgerCreditLimitExceededError';
  }
}

class CityLedgerBilledPartyInvalidError extends Error {
  constructor() {
    super(CITY_LEDGER_BILLED_PARTY_INVALID);
    this.name = 'CityLedgerBilledPartyInvalidError';
  }
}

class CityLedgerR2UnboundError extends Error {
  constructor() {
    super(CITY_LEDGER_R2_UNBOUND);
    this.name = 'CityLedgerR2UnboundError';
  }
}

class CityLedgerStatementNotFoundError extends Error {
  constructor() {
    super(CITY_LEDGER_STATEMENT_NOT_FOUND);
    this.name = 'CityLedgerStatementNotFoundError';
  }
}

type CityLedgerAgingBuckets = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  totalOpenMinor: number;
};

type CityLedgerEntryForAging = {
  entryId: string;
  kind: 'charge' | 'payment' | 'adjustment';
  amountMinor: number;
  businessDate: string;
  createdAt: number;
};

function cityLedgerCalendarDaysBetween(fromYmd: string, toYmd: string): number {
  const fromMs = Date.parse(`${fromYmd}T00:00:00Z`);
  const toMs = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function cityLedgerAddCalendarDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`invalid date: ${isoDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function buildAgingBucketsSync(
  entries: CityLedgerEntryForAging[],
  termsDays: number,
  asOfDate: string,
): CityLedgerAgingBuckets {
  const sorted = [...entries].sort((a, b) =>
    a.businessDate !== b.businessDate ? a.businessDate.localeCompare(b.businessDate) : a.createdAt - b.createdAt,
  );

  type Receivable = {
    openMinor: number;
    dueDate: string;
  };
  const receivables: Receivable[] = [];
  let paymentPoolMinor = 0;

  for (const entry of sorted) {
    if (entry.kind === 'payment') {
      paymentPoolMinor += entry.amountMinor;
      continue;
    }
    if (entry.kind === 'charge') {
      receivables.push({
        openMinor: entry.amountMinor,
        dueDate: cityLedgerAddCalendarDays(entry.businessDate, termsDays),
      });
      continue;
    }
    if (entry.amountMinor >= 0) {
      receivables.push({
        openMinor: entry.amountMinor,
        dueDate: cityLedgerAddCalendarDays(entry.businessDate, termsDays),
      });
    } else {
      paymentPoolMinor += -entry.amountMinor;
    }
  }

  let remainingPaymentMinor = paymentPoolMinor;
  for (const receivable of receivables) {
    if (remainingPaymentMinor <= 0) break;
    const applied = Math.min(receivable.openMinor, remainingPaymentMinor);
    receivable.openMinor -= applied;
    remainingPaymentMinor -= applied;
  }

  const buckets: CityLedgerAgingBuckets = {
    currentMinor: 0,
    days30Minor: 0,
    days60Minor: 0,
    days90PlusMinor: 0,
    totalOpenMinor: 0,
  };

  for (const receivable of receivables) {
    if (receivable.openMinor <= 0) continue;
    buckets.totalOpenMinor += receivable.openMinor;
    const daysOverdue = Math.max(0, cityLedgerCalendarDaysBetween(receivable.dueDate, asOfDate));
    if (daysOverdue === 0) buckets.currentMinor += receivable.openMinor;
    else if (daysOverdue <= 30) buckets.days30Minor += receivable.openMinor;
    else if (daysOverdue <= 60) buckets.days60Minor += receivable.openMinor;
    else buckets.days90PlusMinor += receivable.openMinor;
  }

  return buckets;
}

class WindowClosedError extends Error {
  constructor() {
    super(WINDOW_CLOSED);
    this.name = 'WindowClosedError';
  }
}

class FolioWindowError extends Error {
  constructor(
    readonly code:
      | typeof WINDOW_NOT_CLOSABLE
      | typeof WINDOW_BALANCE_DUE
      | typeof WINDOW_NOT_REOPENABLE
      | typeof WINDOW_NOT_OPENABLE
      | typeof GUEST_WINDOW_NOT_OPENABLE
      | typeof NOT_FOUND
      | typeof TRANSFER_CROSS_RESERVATION
      | typeof TRANSFER_SAME_WINDOW
      | typeof LINE_NOT_TRANSFERABLE
      | typeof LINE_ALREADY_TRANSFERRED
      | typeof LINE_NOT_DISCOUNTABLE
      | typeof DISCOUNT_REASON_REQUIRED
      | typeof SPLIT_AMOUNT_MISMATCH
      | typeof LINE_NOT_SPLITTABLE,
  ) {
    super(code);
    this.name = 'FolioWindowError';
  }
}

/** Spec §3.6: lowercase `[a-z0-9]+`; other chars → `_`; collapse. */
function billedPartySlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
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
  return zonedWallClockMs(ymd, timeZone, 0, 0);
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
  | { ok: false; error: typeof FRONT_OFFICE_COMMENT_TOO_LONG }
  | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
  | { ok: false; error: typeof PROMO_NOT_FOUND }
  | { ok: false; error: typeof PROMO_NOT_APPLICABLE }
  | { ok: false; error: typeof RATE_MISSING; date: string }
  | { ok: false; error: typeof INVALID_CANCEL_POLICY }
  | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
  | { ok: false; error: typeof OOO_INVALID_RANGE }
  | { ok: false; error: typeof OOO_RANGE_OVERLAP }
  | { ok: false; error: typeof OOO_ROOM_ASSIGNED; reservationId?: string }
  | { ok: false; error: typeof ROOM_REQUIRED }
  | { ok: false; error: typeof ROOM_NOT_READY }
  | { ok: false; error: typeof ROOM_ALREADY_ASSIGNED }
  | { ok: false; error: typeof ROOM_TYPE_MISMATCH }
  | { ok: false; error: typeof BALANCE_DUE }
  | { ok: false; error: typeof FOLIO_BALANCE_DUE }
  | { ok: false; error: typeof INVOICE_ALREADY_EXISTS }
  | { ok: false; error: typeof INVOICE_REQUIRED }
  | { ok: false; error: typeof INVOICE_R2_UNBOUND }
  | { ok: false; error: typeof INVOICE_NOT_FOUND }
  | { ok: false; error: typeof INVOICE_VOIDED }
  | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
  | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_EXISTS }
  | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_ARCHIVED }
  | { ok: false; error: typeof CITY_LEDGER_CREDIT_LIMIT_EXCEEDED }
  | { ok: false; error: typeof CITY_LEDGER_BILLED_PARTY_INVALID }
  | { ok: false; error: typeof CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE }
  | { ok: false; error: typeof CITY_LEDGER_STATEMENT_NOT_FOUND }
  | { ok: false; error: typeof CITY_LEDGER_R2_UNBOUND }
  | { ok: false; error: typeof CITY_LEDGER_CHARGE_ALREADY_POSTED }
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
  if (e instanceof FrontOfficeCommentTooLongError) return { ok: false, error: FRONT_OFFICE_COMMENT_TOO_LONG };
  if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
  if (e instanceof PromoNotFoundError) return { ok: false, error: PROMO_NOT_FOUND };
  if (e instanceof PromoNotApplicableError) return { ok: false, error: PROMO_NOT_APPLICABLE };
  if (e instanceof RateMissingError) return { ok: false, error: RATE_MISSING, date: e.date };
  if (e instanceof InvalidCancelPolicyError) return { ok: false, error: INVALID_CANCEL_POLICY };
  if (e instanceof RoomOutOfOrderError) return { ok: false, error: ROOM_OUT_OF_ORDER };
  if (e instanceof OooInvalidRangeError) return { ok: false, error: OOO_INVALID_RANGE };
  if (e instanceof OooRangeOverlapError) return { ok: false, error: OOO_RANGE_OVERLAP };
  if (e instanceof OooRoomAssignedError) {
    return { ok: false, error: OOO_ROOM_ASSIGNED, reservationId: e.reservationId };
  }
  if (e instanceof RoomRequiredError) return { ok: false, error: ROOM_REQUIRED };
  if (e instanceof RoomNotReadyError) return { ok: false, error: ROOM_NOT_READY };
  if (e instanceof RoomAlreadyAssignedError) return { ok: false, error: ROOM_ALREADY_ASSIGNED };
  if (e instanceof RoomTypeMismatchError) return { ok: false, error: ROOM_TYPE_MISMATCH };
  if (e instanceof BalanceDueError) return { ok: false, error: BALANCE_DUE };
  if (e instanceof FolioBalanceDueError) return { ok: false, error: FOLIO_BALANCE_DUE };
  if (e instanceof InvoiceAlreadyExistsError) return { ok: false, error: INVOICE_ALREADY_EXISTS };
  if (e instanceof InvoiceRequiredError) return { ok: false, error: INVOICE_REQUIRED };
  if (e instanceof InvoiceR2UnboundError) return { ok: false, error: INVOICE_R2_UNBOUND };
  if (e instanceof InvoiceNotFoundError) return { ok: false, error: INVOICE_NOT_FOUND };
  if (e instanceof InvoiceVoidedError) return { ok: false, error: INVOICE_VOIDED };
  if (e instanceof CityLedgerError) return { ok: false, error: e.code as typeof CITY_LEDGER_ACCOUNT_NOT_FOUND };
  if (e instanceof CityLedgerCreditLimitExceededError) {
    return { ok: false, error: CITY_LEDGER_CREDIT_LIMIT_EXCEEDED };
  }
  if (e instanceof CityLedgerBilledPartyInvalidError) {
    return { ok: false, error: CITY_LEDGER_BILLED_PARTY_INVALID };
  }
  if (e instanceof CityLedgerR2UnboundError) return { ok: false, error: CITY_LEDGER_R2_UNBOUND };
  if (e instanceof CityLedgerStatementNotFoundError) {
    return { ok: false, error: CITY_LEDGER_STATEMENT_NOT_FOUND };
  }
  return null;
}

function mapPropertyCommandError(
  e: unknown,
): NonNullable<ReturnType<typeof mapReservationPreconditionError>> | { ok: false; error: CommandError } | null {
  const precondition = mapReservationPreconditionError(e);
  if (precondition) return precondition;

  if (!(e instanceof Error)) return null;
  const msg = e.message;

  if (
    msg === 'simulated_internal_bug' ||
    msg === 'audit_append_fault_for_test' ||
    msg === 'simulated_post_room_charges_failure'
  ) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  if (isCommandError(msg)) {
    return { ok: false, error: msg };
  }

  return null;
}

export { NIGHT_AUDIT_HALTED } from '@hospai/contracts';
export const NIGHT_AUDIT_RETRY_STEP_COMMAND = 'night_audit.retry_step' as const;
export const NIGHT_AUDIT_RESOLVE_HALT_COMMAND = 'night_audit.resolve_halt' as const;
export const PROVISIONAL_RESOLVE_EXCEPTION_COMMAND = 'provisional.resolve_exception' as const;
export const PROVISIONAL_RETRY_EXCEPTION_COMMAND = 'provisional.retry_exception' as const;
export const PROVISIONAL_ASSIGN_EXCEPTION_COMMAND = 'provisional.assign_exception' as const;
export const PROVISIONAL_ADD_EXCEPTION_NOTE_COMMAND = 'provisional.add_exception_note' as const;

export type AffectedRefs = {
  reservationId: string | null;
  roomId: string | null;
  guestRef: string | null;
  folioLineId: string | null;
};

export type ProvisionalExceptionListItem = ProvisionalExceptionRow & {
  assignedTo: string | null;
  assignedAt: number | null;
  assignedBy: string | null;
  openRetryKey: string | null;
  affected: AffectedRefs;
};

export type ProvisionalExceptionListFilters = {
  resolution?: 'open' | 'resolved' | 'all';
  commandType?: string;
  reason?: string;
  businessDateFrom?: string;
  businessDateTo?: string;
  assigned?: 'all' | 'unassigned' | 'assigned';
  assignedTo?: string;
  limit?: number;
  cursor?: { createdAt: number; exceptionId: string } | null;
};

type ProvisionalExceptionSqlRow = {
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
  assigned_to: string | null;
  assigned_at: number | null;
  assigned_by: string | null;
  open_retry_key: string | null;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Never throws; missing keys are null. GuestRef is filled by a later reservation hydrate. */
export function affectedFromPayload(commandType: string, payload: unknown): AffectedRefs {
  const rec = payloadRecord(payload);
  const empty: AffectedRefs = { reservationId: null, roomId: null, guestRef: null, folioLineId: null };
  try {
    switch (commandType) {
      case 'reservations.check_in':
      case 'reservations.check_out':
      case 'reservations.cancel_check_in':
      case 'reservations.update_status':
        return {
          reservationId: optionalString(rec.reservationId),
          roomId: optionalString(rec.roomId),
          guestRef: null,
          folioLineId: null,
        };
      case 'folio.add_item':
        return {
          reservationId: optionalString(rec.reservationId),
          roomId: null,
          guestRef: null,
          folioLineId: optionalString(rec.folioLineId),
        };
      case 'rooms.update_status':
        return {
          reservationId: null,
          roomId: optionalString(rec.roomId),
          guestRef: null,
          folioLineId: null,
        };
      case 'rooms.bulk_update_status': {
        const updates = rec.updates;
        const first =
          Array.isArray(updates) && updates[0] && typeof updates[0] === 'object' && !Array.isArray(updates[0])
            ? (updates[0] as Record<string, unknown>)
            : null;
        return {
          reservationId: null,
          roomId: optionalString(first?.roomId),
          guestRef: null,
          folioLineId: null,
        };
      }
      case 'housekeeping.assign':
        return {
          reservationId: null,
          roomId: optionalString(rec.roomId),
          guestRef: null,
          folioLineId: null,
        };
      default:
        return empty;
    }
  } catch {
    return empty;
  }
}

function mapProvisionalExceptionRow(row: ProvisionalExceptionSqlRow): ProvisionalExceptionListItem {
  const payload = JSON.parse(row.payload) as unknown;
  return {
    exceptionId: row.exception_id,
    idempotencyKey: row.idempotency_key,
    commandType: row.command_type,
    payload,
    issuedAt: row.issued_at,
    businessDate: row.business_date,
    reason: row.reason,
    detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    assignedTo: row.assigned_to ?? null,
    assignedAt: row.assigned_at ?? null,
    assignedBy: row.assigned_by ?? null,
    openRetryKey: row.open_retry_key ?? null,
    affected: affectedFromPayload(row.command_type, payload),
  };
}

function hydrateGuestRefs(sql: SqlStorageLike, items: ProvisionalExceptionListItem[]): void {
  const ids = [
    ...new Set(
      items
        .map((item) => item.affected.reservationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (ids.length === 0) return;
  const rows = sql
    .exec(
      `SELECT reservation_id, guest_ref FROM reservation WHERE reservation_id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    )
    .toArray() as Array<{ reservation_id: string; guest_ref: string | null }>;
  const byId = new Map(rows.map((r) => [r.reservation_id, r.guest_ref]));
  for (const item of items) {
    const reservationId = item.affected.reservationId;
    if (!reservationId) continue;
    item.affected.guestRef = byId.get(reservationId) ?? null;
  }
}

/** §8 night-audit step sequence. `ROLL_BUSINESS_DATE` is the only step that mutates `__meta.business_date` / the horizon. */
export const NIGHT_AUDIT_STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'AUTO_TRANSFER',
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
    .exec(`SELECT room_type_id, room_count FROM room_type WHERE status = 'active' AND kind = 'physical'`)
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

    const oooRanges = sql
      .exec(
        `SELECT ooo.start_date, ooo.end_date, COUNT(*) AS room_count
           FROM room_ooo ooo
           JOIN room r ON r.room_id = ooo.room_id
          WHERE r.room_type_id = ?
            AND ooo.end_date > ?
            AND ooo.start_date <= ?
          GROUP BY ooo.start_date, ooo.end_date`,
        rt.room_type_id,
        fromDate,
        toDate,
      )
      .toArray() as Array<{ start_date: string; end_date: string; room_count: number }>;

    const oooCountByDate = new Map<string, number>();
    for (const range of oooRanges) {
      const rangeStart = range.start_date > fromDate ? range.start_date : fromDate;
      const lastBlocked = cityLedgerAddCalendarDays(range.end_date, -1);
      const rangeEnd = lastBlocked < toDate ? lastBlocked : toDate;
      if (rangeStart > rangeEnd) continue;
      const dayCount = cityLedgerCalendarDaysBetween(rangeStart, rangeEnd) + 1;
      for (const stayDate of enumerateFromDate(rangeStart, dayCount)) {
        oooCountByDate.set(stayDate, (oooCountByDate.get(stayDate) ?? 0) + Number(range.room_count));
      }
    }

    for (const stayDate of required) {
      if (existingDates.has(stayDate)) continue;
      const blockedBorn = oooCountByDate.get(stayDate) ?? 0;
      sql.exec(
        `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
         VALUES (?, ?, ?, ?, 0, 0, ?, 1)`,
        rt.room_type_id,
        stayDate,
        rt.room_count,
        blockedBorn,
        ledgerOversell,
      );
      insertedCount += 1;
    }
  }

  return { insertedCount, fromDate, toDate };
}

/** Next occurrence at or after `instant` of `auditTime` ("HH:MM") in `timeZone`, as epoch ms. */
function nextAuditRunAtMs(timeZone: string, auditTime: string, instant: Date): number {
  const [hh, mm] = auditTime.split(':').map(Number);
  const today = enumerateHorizonDates(timeZone, instant, 1)[0]!;
  const candidate = zonedWallClockMs(today, timeZone, hh!, mm!);
  if (candidate > instant.getTime()) return candidate;
  const tomorrow = enumerateFromDate(today, 2)[1]!;
  return zonedWallClockMs(tomorrow, timeZone, hh!, mm!);
}

/** Fixed inventory for VERIFY — DO SQLite forbids dynamic table identifiers (SQLITE_AUTH). */
const PROPERTY_PURGE_INVENTORY_TABLES = [
  'alarm_schedule',
  'audit_log',
  'availability_day',
  'charge_code',
  'city_ledger_account',
  'city_ledger_entry',
  'folio_routing_rule',
  'folio_line',
  'folio_window',
  'fx_rate',
  'housekeeping_assignment',
  'idempotency',
  'invoice',
  'night_audit_report',
  'night_audit_run',
  'outbox',
  'payment',
  'payment_dispute',
  'payment_event',
  'property_config',
  'property_config_audit',
  'provisional_exception',
  'promo',
  'rate_day',
  'rate_plan',
  'reservation',
  'reservation_rate_night',
  'restriction_day',
      'room',
  'room_ooo',
  'room_type_constituent',
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
      (SELECT COUNT(*) FROM city_ledger_account) +
      (SELECT COUNT(*) FROM city_ledger_entry) +
      (SELECT COUNT(*) FROM folio_routing_rule) +
      (SELECT COUNT(*) FROM folio_line) +
      (SELECT COUNT(*) FROM folio_window) +
      (SELECT COUNT(*) FROM fx_rate) +
      (SELECT COUNT(*) FROM housekeeping_assignment) +
      (SELECT COUNT(*) FROM idempotency) +
      (SELECT COUNT(*) FROM invoice) +
      (SELECT COUNT(*) FROM night_audit_report) +
      (SELECT COUNT(*) FROM night_audit_run) +
      (SELECT COUNT(*) FROM outbox) +
      (SELECT COUNT(*) FROM payment) +
      (SELECT COUNT(*) FROM payment_dispute) +
      (SELECT COUNT(*) FROM payment_event) +
      (SELECT COUNT(*) FROM property_config) +
      (SELECT COUNT(*) FROM property_config_audit) +
      (SELECT COUNT(*) FROM provisional_exception) +
      (SELECT COUNT(*) FROM promo) +
      (SELECT COUNT(*) FROM rate_day) +
      (SELECT COUNT(*) FROM rate_plan) +
      (SELECT COUNT(*) FROM reservation) +
      (SELECT COUNT(*) FROM reservation_rate_night) +
      (SELECT COUNT(*) FROM restriction_day) +
      (SELECT COUNT(*) FROM room) +
      (SELECT COUNT(*) FROM room_ooo) +
      (SELECT COUNT(*) FROM room_type_constituent) +
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

  /**
   * Local-only helper: INSERT OR IGNORE `availability_day` rows for nights
   * before `__meta.business_date` so `commitSoldNightsSync` can book arrivals
   * that started before the horizon. Does not bump business_date, ARI, or emit.
   */
  async ensurePastAvailabilityDays(
    fromDate: string,
    toExclusive: string,
  ): Promise<{ inserted: number }> {
    this.assertUnsafeLocal('ensurePastAvailabilityDays');
    if (
      !FRONT_OFFICE_ISO_DATE.test(fromDate) ||
      !FRONT_OFFICE_ISO_DATE.test(toExclusive) ||
      fromDate >= toExclusive
    ) {
      throw new Error('invalid_date_range');
    }

    const activeRoomTypes = this.ctx.storage.sql
      .exec(`SELECT room_type_id, room_count FROM room_type WHERE status = 'active'`)
      .toArray() as Array<{ room_type_id: string; room_count: number }>;

    let inserted = 0;
    for (const rt of activeRoomTypes) {
      for (let stayDate = fromDate; stayDate < toExclusive; ) {
        const result = this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO availability_day
            (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
           VALUES (?, ?, ?, 0, 0, 0, 0, 1)`,
          rt.room_type_id,
          stayDate,
          rt.room_count,
        );
        inserted += result.rowsWritten;
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stayDate);
        if (!parts) throw new Error('invalid_date_range');
        const next = new Date(
          Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + 1),
        );
        stayDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
      }
    }
    return { inserted };
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
  ): Promise<
    | { ok: true; version: number }
    | { ok: true; skipped: true }
    | Exclude<Awaited<ReturnType<PropertyDO['tryPutDomainConfig']>>, { ok: true }>
  > {
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
  ): Promise<
    | { ok: true; version: number }
    | { ok: true; skipped: true }
    | Exclude<Awaited<ReturnType<PropertyDO['tryPutDomainConfig']>>, { ok: true }>
  > {
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
      parentSource === 'TAX' ||
      parentSource === 'PAYMENT_REFUND' ||
      parentSource === 'CHARGEBACK' ||
      parentSource === 'TRANSFER_REVERSAL'
    ) {
      return;
    }
    if (
      params.chargeCode === 'FX_GAIN' ||
      params.chargeCode === 'FX_LOSS' ||
      params.chargeCode === 'CHARGEBACK_FEE'
    ) {
      return;
    }

    const codeRows = this.ctx.storage.sql
      .exec(`SELECT tax_group FROM charge_code WHERE code = ?`, params.chargeCode)
      .toArray() as Array<{ tax_group: string | null }>;
    const taxGroup = codeRows[0]?.tax_group;
    if (!taxGroup) return;

    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) return;

    const rules = this.listApplicableTaxRulesSync(taxGroup, params.postingDate);
    for (const rule of rules) {
      if (rule.rule_type !== 'PERCENTAGE') continue;
      const taxMinor = computeTax(params.posted.ledgerAmountMinor, rule.rate);
      if (taxMinor === 0) continue;
      this.insertFolioLineSync({
        folioLineId: `${params.parentLineId}:tax:${rule.tax_rule_id}`,
        folioWindowId: params.folioWindowId,
        reservationId: params.reservationId,
        chargeCode: rule.output_charge_code,
        posted: {
          amountMinor: taxMinor,
          txnCurrency: ledgerCurrency,
          ledgerAmountMinor: taxMinor,
          fxRate: '1',
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

  /** First-write auth-hold-lapse sweep schedule — idempotent, mirrors outbox provisioning. */
  async ensureAuthHoldLapseScheduleIfAbsent(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM alarm_schedule WHERE name = 'auth-hold-lapse' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    if (rows.length > 0) return;
    this.scheduler.upsertSchedule('auth-hold-lapse', Date.now() + AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS);
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
    await this.ensureAuthHoldLapseScheduleIfAbsent();
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
      'auth-hold-lapse': async () => {
        await this.runAuthHoldLapseSync();
        this.scheduler.upsertSchedule('auth-hold-lapse', Date.now() + AUTH_HOLD_LAPSE_SWEEP_INTERVAL_MS);
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
    { ok: true; deletedApprox: number } | { ok: false; error: typeof BULK_NOT_ADMITTED }
  > {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: BULK_NOT_ADMITTED };
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
   * Guest purge — BULK lane, must not touchInteractive.
   * Nulls declared PropertyDO guest-PII columns for this guest's reservations.
   */
  async purgeGuestPiiColumns(
    guestRef: string,
  ): Promise<{ ok: true; deleted: number } | { ok: false; error: typeof BULK_NOT_ADMITTED }> {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: BULK_NOT_ADMITTED };
    }
    const updated = this.ctx.storage.sql.exec(
      `UPDATE folio_window SET billed_party = NULL
       WHERE billed_party IS NOT NULL
         AND reservation_id IN (SELECT reservation_id FROM reservation WHERE guest_ref = ?)`,
      guestRef,
    );
    return { ok: true, deleted: updated.rowsWritten };
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

  async setRoomStatusRawForTest(input: { roomId: string; status: string }): Promise<void> {
    this.assertUnsafeLocal('setRoomStatusRawForTest');
    this.ctx.storage.sql.exec(
      `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
      input.status,
      Date.now(),
      input.roomId,
    );
  }

  async stampFolioWindowClosedForTest(folioWindowId: string, closedAtMs?: number): Promise<void> {
    this.assertUnsafeLocal('stampFolioWindowClosedForTest');
    this.ctx.storage.sql.exec(
      `UPDATE folio_window SET status = 'CLOSED', closed_at = ? WHERE folio_window_id = ?`,
      closedAtMs ?? Date.now(),
      folioWindowId,
    );
  }

  async setPaymentCreatedAtForTest(paymentId: string, createdAtMs: number): Promise<void> {
    this.assertUnsafeLocal('setPaymentCreatedAtForTest');
    this.ctx.storage.sql.exec(
      `UPDATE payment SET created_at = ? WHERE payment_id = ?`,
      createdAtMs,
      paymentId,
    );
  }

  async readFolioWindowForTest(
    folioWindowId: string,
  ): Promise<{
    folioWindowId: string;
    reservationId: string;
    kind: string;
    status: string;
    billedParty: string | null;
    closedAt: number | null;
  } | null> {
    this.assertUnsafeLocal('readFolioWindowForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, reservation_id, kind, status, billed_party, closed_at
         FROM folio_window WHERE folio_window_id = ?`,
        folioWindowId,
      )
      .toArray() as Array<{
      folio_window_id: string;
      reservation_id: string;
      kind: string;
      status: string;
      billed_party: string | null;
      closed_at: number | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      folioWindowId: row.folio_window_id,
      reservationId: row.reservation_id,
      kind: row.kind,
      status: row.status,
      billedParty: row.billed_party,
      closedAt: row.closed_at,
    };
  }

  private auditActorSync(actor: ActorContext): string {
    return actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;
  }

  /** Permission actor may be system; audit attributes admission operator when replaying. */
  private auditActorForCommandSync(actor: ActorContext, provisional?: ProvisionalContext): string {
    if (provisional?.auditUserId) return provisional.auditUserId;
    return this.auditActorSync(actor);
  }

  /**
   * Sync — must be called inside the mutation's transactionSync.
   * Never silently prune audit_log; ARCHIVE owns future purge.
   *
   * Folio money-ops audit writers (methods land in later tasks):
   * 'folio.open_window' 'folio.close_window' 'folio.reopen_window'
   * 'folio.transfer_charge' 'folio.split_charge' 'folio.void'
   * 'folio.refund' 'folio.post_discount' 'folio.capture_due'
   *
   * Multi-currency folio audit writers (methods land in later tasks):
   * 'folio.create_fx_rate' 'folio.supersede_fx_rate'
   * 'folio.post_fx_adjustment' 'folio.record_chargeback'
   *
   * Room OOO audit writer (method lands in a later task):
   * 'rooms.set_ooo_range'
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

  async deleteRateDayForTest(roomTypeId: string, ratePlanId: string, stayDate: string): Promise<void> {
    this.assertUnsafeLocal('deleteRateDayForTest');
    this.ctx.storage.sql.exec(
      `DELETE FROM rate_day WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
      roomTypeId,
      ratePlanId,
      stayDate,
    );
  }

  async listRateDaysForTest(input: {
    roomTypeId: string;
    ratePlanId: string;
    fromDate: string;
    toDate: string;
  }): Promise<Array<{ stayDate: string; amountMinor: number; currency: string; ratePlanId: string }>> {
    this.assertUnsafeLocal('listRateDaysForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT stay_date, amount_minor, currency, rate_plan_id
         FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date >= ? AND stay_date <= ?
         ORDER BY stay_date`,
        input.roomTypeId,
        input.ratePlanId,
        input.fromDate,
        input.toDate,
      )
      .toArray() as Array<{
      stay_date: string;
      amount_minor: number;
      currency: string;
      rate_plan_id: string;
    }>;
    return rows.map((r) => ({
      stayDate: r.stay_date,
      amountMinor: r.amount_minor,
      currency: r.currency,
      ratePlanId: r.rate_plan_id,
    }));
  }

  async listReservationRateNightsForTest(reservationId: string): Promise<
    Array<{ stayDate: string; amountMinor: number; currency: string; ratePlanId: string }>
  > {
    this.assertUnsafeLocal('listReservationRateNightsForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT stay_date, amount_minor, currency, rate_plan_id
         FROM reservation_rate_night WHERE reservation_id = ? ORDER BY stay_date`,
        reservationId,
      )
      .toArray() as Array<{
      stay_date: string;
      amount_minor: number;
      currency: string;
      rate_plan_id: string;
    }>;
    return rows.map((r) => ({
      stayDate: r.stay_date,
      amountMinor: r.amount_minor,
      currency: r.currency,
      ratePlanId: r.rate_plan_id,
    }));
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
        issued_at, business_date, reason, detail, created_at, actor_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      cmd.idempotencyKey,
      cmd.command.type,
      JSON.stringify(cmd.command.payload),
      cmd.issuedAt,
      cmd.businessDate,
      reason,
      detail === null ? null : JSON.stringify(detail),
      now,
      cmd.actor.userId,
    );
  }

  async readProvisionalExceptionActorUserIdForTest(idempotencyKey: string): Promise<string | null> {
    this.assertUnsafeLocal('readProvisionalExceptionActorUserIdForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT actor_user_id FROM provisional_exception WHERE idempotency_key = ? LIMIT 1`,
        idempotencyKey,
      )
      .toArray() as Array<{ actor_user_id: string | null }>;
    return rows[0]?.actor_user_id ?? null;
  }

  async listProvisionalExceptions(
    filters?: ProvisionalExceptionListFilters,
  ): Promise<{
    ok: true;
    exceptions: ProvisionalExceptionListItem[];
    nextCursor: { createdAt: number; exceptionId: string } | null;
  }> {
    this.assertRpcAvailable();
    const resolution = filters?.resolution ?? 'open';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (resolution === 'open') conditions.push('resolved_at IS NULL');
    else if (resolution === 'resolved') conditions.push('resolved_at IS NOT NULL');

    if (filters?.commandType !== undefined) {
      conditions.push('command_type = ?');
      params.push(filters.commandType);
    }
    if (filters?.reason !== undefined) {
      conditions.push('reason = ?');
      params.push(filters.reason);
    }
    if (filters?.businessDateFrom !== undefined) {
      conditions.push('business_date >= ?');
      params.push(filters.businessDateFrom);
    }
    if (filters?.businessDateTo !== undefined) {
      conditions.push('business_date <= ?');
      params.push(filters.businessDateTo);
    }
    if (filters?.assigned === 'unassigned') conditions.push('assigned_to IS NULL');
    else if (filters?.assigned === 'assigned') conditions.push('assigned_to IS NOT NULL');
    if (filters?.assignedTo !== undefined) {
      conditions.push('assigned_to = ?');
      params.push(filters.assignedTo);
    }
    if (filters?.cursor) {
      conditions.push('(created_at < ? OR (created_at = ? AND exception_id < ?))');
      params.push(filters.cursor.createdAt, filters.cursor.createdAt, filters.cursor.exceptionId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitSql = filters?.limit !== undefined ? ' LIMIT ?' : '';
    const limitParams = filters?.limit !== undefined ? [filters.limit] : [];

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT exception_id, idempotency_key, command_type, payload,
                issued_at, business_date, reason, detail, created_at,
                resolved_at, resolved_by, assigned_to, assigned_at, assigned_by, open_retry_key
         FROM provisional_exception
         ${where}
         ORDER BY created_at DESC, exception_id DESC${limitSql}`,
        ...params,
        ...limitParams,
      )
      .toArray() as ProvisionalExceptionSqlRow[];

    const exceptions = rows.map(mapProvisionalExceptionRow);
    hydrateGuestRefs(this.ctx.storage.sql, exceptions);

    const nextCursor =
      filters?.limit !== undefined && exceptions.length === filters.limit
        ? {
            createdAt: exceptions[exceptions.length - 1]!.createdAt,
            exceptionId: exceptions[exceptions.length - 1]!.exceptionId,
          }
        : null;

    return { ok: true, exceptions, nextCursor };
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
    this.assertUnsafeLocal('reconcileHorizonForTest');
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
          if (this.readConfigValueSync('pms.night_audit.auto_extend') === true) {
            this.runAutoExtendSync(businessDate);
          }
          this.postRoomChargesSync(businessDate);
        } else if (step === 'CLOSE_CASHIER_SHIFTS') {
          this.forceCloseCashierShiftsSync(businessDate);
        } else if (step === 'PROCESS_NO_SHOWS') {
          this.processNoShowsSync(businessDate);
        } else if (step === 'AUTO_TRANSFER') {
          this.runAutoTransferSync(businessDate);
        } else if (step === 'SNAPSHOT_REPORTS') {
          this.indexReportPutsSync(businessDate);
          this.postPendingCityLedgerChargesForBusinessDateSync(businessDate);
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
   * Reverse NIGHT_AUDIT ROOM (+ TAX dependents) with deterministic SPLIT_REVERSAL ids.
   * Does not call splitFolioLineSync — that helper mints random reverse ids and writes
   * caller-provided child splits; split semantics ≠ reversal semantics.
   */
  private reverseNightAuditRoomSync(reservationId: string, businessDate: string): void {
    const roomRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, folio_window_id, amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at
         FROM folio_line
         WHERE reservation_id = ? AND business_date = ? AND charge_code = 'ROOM' AND source = 'NIGHT_AUDIT'`,
        reservationId,
        businessDate,
      )
      .toArray() as Array<{
      folio_line_id: string;
      folio_window_id: string;
      amount_minor: number;
      txn_currency: string;
      ledger_amount_minor: number;
      fx_rate: string;
      fx_rate_at: number;
    }>;
    const source = roomRows[0];
    if (!source) return;

    const reverseId = `${reservationId}:noshow:audit:${businessDate}:room-rev`;
    const already = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM folio_line WHERE folio_line_id = ?`, reverseId)
      .toArray();
    if (already.length > 0) return;

    const txnCurrency = currencyCode(source.txn_currency);
    this.insertFolioLineSync({
      folioLineId: reverseId,
      folioWindowId: source.folio_window_id,
      reservationId,
      chargeCode: 'ROOM',
      posted: {
        amountMinor: -source.amount_minor,
        txnCurrency,
        ledgerAmountMinor: -source.ledger_amount_minor,
        fxRate: source.fx_rate,
        fxRateAt: source.fx_rate_at,
      },
      source: 'SPLIT_REVERSAL',
      businessDate,
      splitOf: source.folio_line_id,
    });

    const taxLines = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, amount_minor, charge_code, ledger_amount_minor
         FROM folio_line WHERE tax_of = ? AND source = 'TAX'`,
        source.folio_line_id,
      )
      .toArray() as Array<{
      folio_line_id: string;
      amount_minor: number;
      charge_code: string;
      ledger_amount_minor: number;
    }>;
    for (const tax of taxLines) {
      this.insertFolioLineSync({
        folioLineId: `${tax.folio_line_id}:noshow:audit:${businessDate}:tax-rev`,
        folioWindowId: source.folio_window_id,
        reservationId,
        chargeCode: tax.charge_code,
        posted: {
          amountMinor: -tax.amount_minor,
          txnCurrency,
          ledgerAmountMinor: -tax.ledger_amount_minor,
          fxRate: source.fx_rate,
          fxRateAt: source.fx_rate_at,
        },
        source: 'SPLIT_REVERSAL',
        businessDate,
        splitOf: tax.folio_line_id,
      });
    }
  }

  private postAuditNoShowPenaltySync(
    reservationId: string,
    amountMinor: number,
    businessDate: string,
  ): void {
    const folioLineId = `${reservationId}:noshow:audit:${businessDate}`;
    const existing = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM folio_line WHERE folio_line_id = ?`, folioLineId)
      .toArray();
    if (existing.length > 0) return;

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
    this.assertChargeCodeSync('NO_SHOW', { requireActive: true });
    this.insertFolioLineSync({
      folioLineId,
      folioWindowId,
      reservationId,
      chargeCode: 'NO_SHOW',
      posted,
      source: 'NIGHT_AUDIT',
      businessDate,
    });
    this.stampTaxForChargeSync({
      parentLineId: folioLineId,
      parentAmountMinor: amountMinor,
      parentSource: 'NIGHT_AUDIT',
      chargeCode: 'NO_SHOW',
      reservationId,
      folioWindowId,
      postingDate: businessDate,
      posted,
    });
  }

  private reconcileNoShowPenaltySync(
    reservation: {
      reservation_id: string;
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
    businessDate: string,
    nowMs: number,
    timeZone: string,
  ): void {
    const rRows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS r
         FROM folio_line
         WHERE reservation_id = ? AND business_date = ? AND charge_code = 'ROOM' AND source = 'NIGHT_AUDIT'`,
        reservation.reservation_id,
        businessDate,
      )
      .toArray() as Array<{ r: number }>;
    const roomPosted = Number(rRows[0]?.r ?? 0);
    const penalty = this.penaltyMinor(reservation, nowMs, timeZone);
    if (penalty === 0) {
      if (roomPosted > 0) this.reverseNightAuditRoomSync(reservation.reservation_id, businessDate);
      return;
    }
    if (penalty === roomPosted) return;
    if (roomPosted > 0) this.reverseNightAuditRoomSync(reservation.reservation_id, businessDate);
    this.postAuditNoShowPenaltySync(reservation.reservation_id, penalty, businessDate);
  }

  private expirePendingAndInquirySync(businessDate: string, nowMs: number): void {
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    const pending = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date
         FROM reservation
         WHERE status = 'pending'
           AND (
             (confirm_by IS NOT NULL AND confirm_by <= ?)
             OR (confirm_by IS NULL AND arrival_date <= ?)
           )`,
        nowMs,
        businessDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
      guest_ref: string;
      pii_key_id: string;
      arrival_date: string;
      departure_date: string;
    }>;
    for (const row of pending) {
      const nights = enumerateStayDates(row.arrival_date, row.departure_date);
      const ledgerId = row.allocated_room_type_id || row.room_type_id;
      if (ledgerId) this.releaseSoldNightsSync(ledgerId, nights);
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET status = 'cancelled', updated_at = ? WHERE reservation_id = ?`,
        nowMs,
        row.reservation_id,
      );
      const ariVersion = this.bumpAriVersionSync();
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'reservation.status_changed',
        payload: {
          propertyId,
          reservationId: row.reservation_id,
          guestRef: row.guest_ref,
          piiKeyId: row.pii_key_id,
          fromStatus: 'pending',
          toStatus: 'cancelled',
          reason: 'expired',
        },
      });
      if (ledgerId) {
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'availability.changed',
          payload: {
            propertyId,
            roomTypeId: ledgerId,
            fromDate: nights[0]!,
            toDate: nights[nights.length - 1]!,
            version: ariVersion,
          },
        });
      }
      this.appendAuditLogSync({
        actor: 'system:night_audit',
        commandId: 'night_audit.run',
        entityType: 'reservation',
        entityId: row.reservation_id,
        beforeJson: { status: 'pending', roomTypeId: row.room_type_id },
        afterJson: { status: 'cancelled', roomTypeId: row.room_type_id, reason: 'expired' },
        reservationId: row.reservation_id,
      });
    }

    const inquiries = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, pii_key_id
         FROM reservation
         WHERE status = 'inquiry' AND (
           (expires_at IS NOT NULL AND expires_at <= ?) OR arrival_date <= ?
         )`,
        nowMs,
        businessDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      guest_ref: string;
      pii_key_id: string;
    }>;
    for (const row of inquiries) {
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET status = 'cancelled', updated_at = ? WHERE reservation_id = ?`,
        nowMs,
        row.reservation_id,
      );
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'reservation.status_changed',
        payload: {
          propertyId,
          reservationId: row.reservation_id,
          guestRef: row.guest_ref,
          piiKeyId: row.pii_key_id,
          fromStatus: 'inquiry',
          toStatus: 'cancelled',
          reason: 'expired',
        },
      });
      this.appendAuditLogSync({
        actor: 'system:night_audit',
        commandId: 'night_audit.run',
        entityType: 'reservation',
        entityId: row.reservation_id,
        beforeJson: { status: 'inquiry', roomTypeId: row.room_type_id },
        afterJson: { status: 'cancelled', roomTypeId: row.room_type_id, reason: 'expired' },
        reservationId: row.reservation_id,
      });
    }
  }

  /**
   * `PROCESS_NO_SHOWS` body — sync, inside Txn B. Expires due pending/inquiry always
   * (inventory hygiene). auto_no_show gates only the confirmed no-show loop.
   * Does not call tryNoShow. P/R reconciliation never throws ledger_inconsistent.
   */
  private processNoShowsSync(businessDate: string): void {
    const now = Date.now();
    this.expirePendingAndInquirySync(businessDate, now);

    const auto = this.readConfigValueSync('pms.night_audit.auto_no_show');
    if (auto === false) return;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) throw new Error(TIMEZONE_UNSET);

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
                status, rate_plan_id, cancel_penalty_type, cancel_grace_hours,
                cancel_penalty_nights, cancel_penalty_bps
         FROM reservation
         WHERE status = 'confirmed' AND arrival_date <= ?`,
        businessDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
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

    for (const reservation of rows) {
      const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
      const ledgerId = reservation.allocated_room_type_id || reservation.room_type_id;
      if (ledgerId) this.releaseSoldNightsSync(ledgerId, nights);
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET status = 'no_show', updated_at = ? WHERE reservation_id = ?`,
        now,
        reservation.reservation_id,
      );
      this.reconcileNoShowPenaltySync(reservation, businessDate, now, timeZone);
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
      if (ledgerId) {
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'availability.changed',
          payload: {
            propertyId,
            roomTypeId: ledgerId,
            fromDate: nights[0]!,
            toDate: nights[nights.length - 1]!,
            version: ariVersion,
          },
        });
      }
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

  private runAutoExtendSync(businessDate: string): { extendedCount: number; skippedCount: number } {
    const dueOutDate = enumerateFromDate(businessDate, 2)[1]!;
    const candidates = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, allocated_room_type_id, arrival_date, departure_date,
                rate_plan_id, guest_ref, pii_key_id, room_id
         FROM reservation
         WHERE status = 'checked_in' AND departure_date = ?
         ORDER BY reservation_id ASC`,
        dueOutDate,
      )
      .toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
      arrival_date: string;
      departure_date: string;
      rate_plan_id: string;
      guest_ref: string;
      pii_key_id: string;
      room_id: string | null;
    }>;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

    let extendedCount = 0;
    let skippedCount = 0;

    for (const reservation of candidates) {
      const newDeparture = enumerateFromDate(reservation.departure_date, 2)[1]!;
      const addedNight = dueOutDate;
      const allocatedId = reservation.allocated_room_type_id || reservation.room_type_id;
      const oldNights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
      const newNights = enumerateStayDates(reservation.arrival_date, newDeparture);

      if (reservation.room_id) {
        try {
          this.assertRoomAssignableSync(reservation.room_id, {
            reservationId: reservation.reservation_id,
            allocatedRoomTypeId: allocatedId,
            arrivalDate: reservation.arrival_date,
            departureDate: newDeparture,
          });
        } catch {
          skippedCount++;
          continue;
        }
      }

      try {
        this.rateDayAmountSync(reservation.room_type_id, reservation.rate_plan_id, addedNight);
      } catch (e) {
        if (e instanceof RateMissingError) {
          skippedCount++;
          continue;
        }
        throw e;
      }

      try {
        this.commitSoldNightsSync(allocatedId, reservation.arrival_date, newDeparture, [addedNight]);
      } catch (e) {
        if (
          e instanceof NoAvailabilityError ||
          e instanceof UnbookableError ||
          e instanceof RestrictionViolatedError
        ) {
          skippedCount++;
          continue;
        }
        throw e;
      }

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE reservation SET departure_date = ?, updated_at = ? WHERE reservation_id = ?`,
        newDeparture,
        now,
        reservation.reservation_id,
      );

      this.syncReservationRateNightsOnModifySync(
        reservation.reservation_id,
        reservation.room_type_id,
        reservation.rate_plan_id,
        oldNights,
        newNights,
      );

      const ariVersion = this.bumpAriVersionSync();
      const unionFrom = oldNights[0]! < newNights[0]! ? oldNights[0]! : newNights[0]!;
      const unionTo =
        oldNights[oldNights.length - 1]! > newNights[newNights.length - 1]!
          ? oldNights[oldNights.length - 1]!
          : newNights[newNights.length - 1]!;

      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'reservation.modified',
        payload: {
          propertyId,
          reservationId: reservation.reservation_id,
          guestRef: reservation.guest_ref,
          piiKeyId: reservation.pii_key_id,
          from: {
            roomTypeId: reservation.room_type_id,
            arrivalDate: reservation.arrival_date,
            departureDate: reservation.departure_date,
          },
          to: {
            roomTypeId: reservation.room_type_id,
            arrivalDate: reservation.arrival_date,
            departureDate: newDeparture,
          },
        },
      });

      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: {
          propertyId,
          roomTypeId: allocatedId,
          fromDate: unionFrom,
          toDate: unionTo,
          version: ariVersion,
        },
      });

      this.appendAuditLogSync({
        actor: this.auditActorSync({ kind: 'system', reason: 'night_audit' }),
        commandId: 'reservations.modify',
        entityType: 'reservation',
        entityId: reservation.reservation_id,
        beforeJson: {
          roomTypeId: reservation.room_type_id,
          arrivalDate: reservation.arrival_date,
          departureDate: reservation.departure_date,
        },
        afterJson: {
          roomTypeId: reservation.room_type_id,
          arrivalDate: reservation.arrival_date,
          departureDate: newDeparture,
          automated: true,
        },
        reservationId: reservation.reservation_id,
      });

      extendedCount++;
    }

    return { extendedCount, skippedCount };
  }

  private runAutoTransferSync(businessDate: string): { transferredCount: number; skippedCount: number } {
    const activeRules = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM folio_routing_rule WHERE status = 'active' LIMIT 1`)
      .toArray();
    if (activeRules.length === 0) return { transferredCount: 0, skippedCount: 0 };

    const candidates = this.ctx.storage.sql
      .exec(
        `SELECT fl.folio_line_id, fl.reservation_id, rr.rule_id, rr.dest_window_kind
         FROM folio_line fl
         JOIN folio_window fw ON fl.folio_window_id = fw.folio_window_id
         JOIN folio_routing_rule rr ON fl.charge_code = rr.charge_code AND rr.status = 'active'
         WHERE fl.business_date = ?
           AND fw.kind = 'GUEST'
           AND fw.status = 'OPEN'
           AND (fl.source IS NULL OR fl.source NOT IN ('TAX', 'SPLIT_REVERSAL', 'TRANSFER_REVERSAL', 'CHARGEBACK'))
           AND fl.charge_code NOT IN ('FX_GAIN', 'FX_LOSS', 'CHARGEBACK_FEE')`,
        businessDate,
      )
      .toArray() as Array<{
      folio_line_id: string;
      reservation_id: string;
      rule_id: string;
      dest_window_kind: string;
    }>;

    let transferredCount = 0;
    let skippedCount = 0;
    for (const candidate of candidates) {
      const destWindowId = this.resolveAutoTransferDestWindowSync(
        candidate.reservation_id,
        candidate.dest_window_kind,
      );
      if (!destWindowId) {
        skippedCount++;
        continue;
      }
      this.transferFolioLineSync({
        sourceFolioLineId: candidate.folio_line_id,
        destinationFolioWindowId: destWindowId,
        auditContext: { automated: true, ruleId: candidate.rule_id, businessDate },
      });
      transferredCount++;
    }
    return { transferredCount, skippedCount };
  }

  private resolveAutoTransferDestWindowSync(
    reservationId: string,
    destWindowKind: string,
  ): string | null {
    if (destWindowKind === 'MASTER') {
      const folioWindowId = `${reservationId}:MASTER`;
      const window = this.readFolioWindowRowSync(folioWindowId);
      if (!window || window.status !== 'OPEN') return null;
      return folioWindowId;
    }
    if (destWindowKind === 'COMPANY') {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT folio_window_id FROM folio_window
           WHERE reservation_id = ? AND kind = 'COMPANY' AND status = 'OPEN'`,
          reservationId,
        )
        .toArray() as Array<{ folio_window_id: string }>;
      if (rows.length !== 1) return null;
      return rows[0]!.folio_window_id;
    }
    return null;
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
    const pendingCount = Number(
      (
        this.ctx.storage.sql
          .exec(
            `SELECT COUNT(*) AS n FROM reservation
             WHERE status = 'pending' AND arrival_date <= ? AND departure_date > ?`,
            businessDate,
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
      pendingCount,
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
      .filter(
        (r) =>
          r.charge_code === 'ROOM' && (r.source === 'NIGHT_AUDIT' || r.source === 'SPLIT_REVERSAL'),
      )
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
    const tenderRows = this.ctx.storage.sql
      .exec(
        `SELECT txn_currency, source, amount_minor
         FROM folio_line
         WHERE business_date = ? AND charge_code = 'PAYMENT'`,
        businessDate,
      )
      .toArray() as Array<{ txn_currency: string; source: string | null; amount_minor: number }>;
    const tenders = new Map<string, { currency: string; capturedMinor: number; refundedMinor: number }>();
    for (const row of tenderRows) {
      const currency = row.txn_currency;
      const bucket = tenders.get(currency) ?? { currency, capturedMinor: 0, refundedMinor: 0 };
      if (row.source === 'PAYMENT_REFUND' || row.source === 'CHARGEBACK') {
        bucket.refundedMinor += Math.abs(row.amount_minor);
      } else if (row.amount_minor < 0) {
        bucket.capturedMinor += Math.abs(row.amount_minor);
      }
      tenders.set(currency, bucket);
    }
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
      tendersByCurrency: [...tenders.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
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

  private readInvoiceCounterSync(): number {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.invoice_counter')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) {
      const start = Number(this.readConfigValueSync('pms.invoice.starting_idx') ?? 1);
      return start - 1;
    }
    return JSON.parse(rows[0].value_json) as number;
  }

  private bumpInvoiceCounterSync(expectedNext: number): void {
    const current = this.readInvoiceCounterSync();
    if (current + 1 !== expectedNext) throw new Error('invoice_counter_race');
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.invoice_counter', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(expectedNext),
      Date.now(),
    );
  }

  private formatInvoiceNumberSync(counter: number): string {
    const prefix = String(this.readConfigValueSync('pms.invoice.prefix') ?? 'INV-');
    const suffix = String(this.readConfigValueSync('pms.invoice.suffix') ?? '');
    return `${prefix}${String(counter).padStart(6, '0')}${suffix}`;
  }

  private async putInvoiceObject(
    propertyId: string,
    invoiceNumber: string,
    body: unknown,
  ): Promise<{ r2Key: string; sha256: string }> {
    let bucket: R2Bucket;
    try {
      bucket = this.assertReportsR2Bound();
    } catch (e) {
      if (e instanceof Error && e.message === 'reports_r2_unbound') {
        throw new InvoiceR2UnboundError();
      }
      throw e;
    }
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const sha256 = await this.sha256Hex(encoded);
    const r2Key = invoiceObjectKey(propertyId, invoiceNumber);
    await bucket.put(r2Key, encoded);
    return { r2Key, sha256 };
  }

  private hasActiveInvoiceForWindowSync(reservationId: string, folioWindowId: string): boolean {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT 1 FROM invoice WHERE reservation_id = ? AND folio_window_id = ? AND voided_at IS NULL LIMIT 1`,
        reservationId,
        folioWindowId,
      )
      .toArray();
    return rows.length > 0;
  }

  private buildInvoiceSnapshotSync(input: {
    invoiceId: string;
    invoiceNumber: string;
    propertyId: string;
    reservationId: string;
    folioWindowId: string;
    generatedAt: number;
    autoGenerated: boolean;
  }): Record<string, unknown> {
    const reservationRows = this.ctx.storage.sql
      .exec(
        `SELECT guest_ref, pii_key_id, arrival_date, departure_date, room_id, rate_plan_id, status, promo_id
         FROM reservation WHERE reservation_id = ?`,
        input.reservationId,
      )
      .toArray() as Array<{
      guest_ref: string;
      pii_key_id: string;
      arrival_date: string;
      departure_date: string;
      room_id: string | null;
      rate_plan_id: string | null;
      status: string;
      promo_id: string | null;
    }>;
    const reservation = reservationRows[0]!;

    const lineRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, charge_code, amount_minor, ledger_amount_minor, txn_currency, fx_rate,
                business_date, source, tax_of, tax_rule_id, payment_id, created_at
         FROM folio_line
         WHERE reservation_id = ? AND folio_window_id = ?
         ORDER BY created_at ASC`,
        input.reservationId,
        input.folioWindowId,
      )
      .toArray() as Array<{
      folio_line_id: string;
      charge_code: string;
      amount_minor: number;
      ledger_amount_minor: number;
      txn_currency: string;
      fx_rate: string;
      business_date: string | null;
      source: string | null;
      tax_of: string | null;
      tax_rule_id: string | null;
      payment_id: string | null;
      created_at: number;
    }>;

    const chargeCodes = new Map<string, string>();
    for (const code of [...new Set(lineRows.map((row) => row.charge_code))]) {
      const ccRows = this.ctx.storage.sql
        .exec(`SELECT name FROM charge_code WHERE code = ?`, code)
        .toArray() as Array<{ name: string }>;
      chargeCodes.set(code, ccRows[0]?.name ?? code);
    }

    const lines = lineRows.map((row) => ({
      folioLineId: row.folio_line_id,
      chargeCode: row.charge_code,
      chargeName: chargeCodes.get(row.charge_code) ?? row.charge_code,
      amountMinor: row.amount_minor,
      ledgerAmountMinor: row.ledger_amount_minor,
      txnCurrency: row.txn_currency,
      fxRate: row.fx_rate,
      businessDate: row.business_date,
      source: row.source,
      taxOf: row.tax_of,
      taxRuleId: row.tax_rule_id,
      paymentId: row.payment_id,
    }));

    const taxSummaryMap = new Map<string, { taxRuleId: string; label: string; amountMinor: number }>();
    for (const row of lineRows) {
      if (row.source !== 'TAX' && !row.tax_of) continue;
      const taxRuleId = row.tax_rule_id ?? row.charge_code;
      const bucket = taxSummaryMap.get(taxRuleId) ?? {
        taxRuleId,
        label: chargeCodes.get(row.charge_code) ?? row.charge_code,
        amountMinor: 0,
      };
      bucket.amountMinor += row.ledger_amount_minor;
      taxSummaryMap.set(taxRuleId, bucket);
    }

    let chargesMinor = 0;
    let taxMinor = 0;
    let paymentsMinor = 0;
    for (const row of lineRows) {
      if (row.source === 'TAX' || row.tax_of) {
        taxMinor += row.ledger_amount_minor;
      } else if (row.charge_code === 'PAYMENT') {
        paymentsMinor += row.ledger_amount_minor;
      } else {
        chargesMinor += row.ledger_amount_minor;
      }
    }
    const balanceMinor = lineRows.reduce((sum, row) => sum + row.ledger_amount_minor, 0);

    const dateRule = String(this.readConfigValueSync('pms.invoice.date_rule') ?? 'CHECKOUT');
    const invoiceDate =
      dateRule === 'CHECKOUT'
        ? reservation.departure_date
        : (this.readBusinessDateSync() ?? reservation.departure_date);

    const presentation = {
      title: this.readConfigValueSync('pms.invoice.title'),
      footer: this.readConfigValueSync('pms.invoice.footer'),
      showCompany: this.readConfigValueSync('pms.invoice.show_company'),
      showRoom: this.readConfigValueSync('pms.invoice.show_room'),
      showTaxfee: this.readConfigValueSync('pms.invoice.show_taxfee'),
      showDuedate: this.readConfigValueSync('pms.invoice.show_duedate'),
      showPackage: this.readConfigValueSync('pms.invoice.show_package'),
      compact: this.readConfigValueSync('pms.invoice.compact'),
      language: this.readConfigValueSync('pms.invoice.language'),
      guestLang: this.readConfigValueSync('pms.invoice.guest_lang'),
      titleLang: this.readConfigValueSync('pms.invoice.title_lang'),
    };

    return {
      schemaVersion: 1,
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      folioWindowId: input.folioWindowId,
      generatedAt: input.generatedAt,
      invoiceDate,
      guestRef: reservation.guest_ref,
      piiKeyId: reservation.pii_key_id,
      reservation: {
        arrivalDate: reservation.arrival_date,
        departureDate: reservation.departure_date,
        roomId: reservation.room_id,
        ratePlanId: reservation.rate_plan_id,
        status: reservation.status,
        ...(reservation.promo_id ? { promoId: reservation.promo_id } : {}),
      },
      presentation,
      ledgerCurrency: this.readStoredLedgerCurrencySync(),
      lines,
      taxSummary: [...taxSummaryMap.values()],
      totals: { chargesMinor, taxMinor, paymentsMinor, balanceMinor },
      autoGenerated: input.autoGenerated,
    };
  }

  async writeConfigValueForTest(key: string, value: unknown): Promise<void> {
    this.assertUnsafeLocal('writeConfigValueForTest');
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      Date.now(),
    );
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
    this.syncOooStatusAllRoomsSync();
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
  ): Promise<{ ok: true } | { ok: false; error: CommandError }> {
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
        const stepError = result.error;
        return {
          ok: false,
          error: stepError && isCommandError(stepError) ? stepError : NIGHT_AUDIT_HALTED,
        };
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
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private loadProvisionalExceptionRow(exceptionId: string): ProvisionalExceptionSqlRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT exception_id, idempotency_key, command_type, payload,
                issued_at, business_date, reason, detail, created_at,
                resolved_at, resolved_by, assigned_to, assigned_at, assigned_by, open_retry_key
         FROM provisional_exception WHERE exception_id = ?`,
        exceptionId,
      )
      .toArray() as ProvisionalExceptionSqlRow[];
    return rows[0] ?? null;
  }

  async readProvisionalException(exceptionId: string): Promise<
    | {
        ok: true;
        exception: ProvisionalExceptionListItem;
        actions: Array<{
          at: number;
          actor: string;
          commandId: string;
          action: 'resolved' | 'retried' | 'retry_failed' | 'assigned' | 'noted';
          afterJson: unknown;
        }>;
        notes: Array<{ noteId: string; at: number; actor: string; text: string }>;
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const row = this.loadProvisionalExceptionRow(exceptionId);
    if (!row) return { ok: false, error: NOT_FOUND };

    const exception = mapProvisionalExceptionRow(row);
    hydrateGuestRefs(this.ctx.storage.sql, [exception]);

    const auditRows = this.ctx.storage.sql
      .exec(
        `SELECT at, actor, command_id, after_json
         FROM audit_log
         WHERE entity_type = 'provisional_exception' AND entity_id = ?
         ORDER BY at ASC, seq ASC`,
        exceptionId,
      )
      .toArray() as Array<{ at: number; actor: string; command_id: string; after_json: string }>;

    const actions: Array<{
      at: number;
      actor: string;
      commandId: string;
      action: 'resolved' | 'retried' | 'retry_failed' | 'assigned' | 'noted';
      afterJson: unknown;
    }> = [];
    const notes: Array<{ noteId: string; at: number; actor: string; text: string }> = [];

    for (const audit of auditRows) {
      const afterJson = JSON.parse(audit.after_json) as unknown;
      const afterRec =
        afterJson !== null && typeof afterJson === 'object' && !Array.isArray(afterJson)
          ? (afterJson as Record<string, unknown>)
          : {};
      let action: (typeof actions)[number]['action'] | null = null;
      if (audit.command_id === PROVISIONAL_RESOLVE_EXCEPTION_COMMAND) action = 'resolved';
      else if (audit.command_id === PROVISIONAL_RETRY_EXCEPTION_COMMAND) {
        action = afterRec.action === 'retried' ? 'retried' : 'retry_failed';
      } else if (audit.command_id === PROVISIONAL_ASSIGN_EXCEPTION_COMMAND) action = 'assigned';
      else if (audit.command_id === PROVISIONAL_ADD_EXCEPTION_NOTE_COMMAND) action = 'noted';
      if (!action) continue;
      actions.push({
        at: audit.at,
        actor: audit.actor,
        commandId: audit.command_id,
        action,
        afterJson,
      });
      if (action === 'noted') {
        notes.push({
          noteId: typeof afterRec.noteId === 'string' ? afterRec.noteId : '',
          at: audit.at,
          actor: audit.actor,
          text: typeof afterRec.text === 'string' ? afterRec.text : '',
        });
      }
    }

    return { ok: true, exception, actions, notes };
  }

  async tryRetryProvisionalException(
    actor: ActorContext,
    input: { exceptionId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; retried: true }
    | ({
        ok: false;
        retried?: false;
      } & (
        | { error: typeof NOT_FOUND }
        | { error: typeof ALREADY_RESOLVED }
        | { error: typeof UNKNOWN_COMMAND }
        | { error: typeof ORG_UNREACHABLE }
        | { error: typeof FORBIDDEN | typeof NOT_MEMBER }
        | { error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
        | { error: typeof ORG_ID_UNSET }
        | { error: typeof PROPERTY_ID_UNSET }
        | { error: typeof IDEM_KEY_REUSED }
        | { error: CommandError }
        | NonNullable<ReturnType<typeof mapPropertyCommandError>>
      ))
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const existing = this.loadProvisionalExceptionRow(input.exceptionId);
    if (!existing) return { ok: false, error: NOT_FOUND };
    if (existing.resolved_at != null) return { ok: false, error: ALREADY_RESOLVED };

    const dispatch = REPLAY_DISPATCH[existing.command_type];
    if (!dispatch) return { ok: false, error: UNKNOWN_COMMAND };

    if (existing.open_retry_key === null) {
      const minted = `provisional-retry:${input.exceptionId}:${crypto.randomUUID()}`;
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `UPDATE provisional_exception SET open_retry_key = ? WHERE exception_id = ? AND open_retry_key IS NULL`,
          minted,
          input.exceptionId,
        );
      });
    }

    const keyed = this.loadProvisionalExceptionRow(input.exceptionId);
    if (!keyed || keyed.resolved_at != null) return { ok: false, error: ALREADY_RESOLVED };
    const openRetryKey = keyed.open_retry_key;
    if (!openRetryKey) return { ok: false, error: INTERNAL_ERROR };

    const payload = JSON.parse(keyed.payload) as unknown;
    const fingerprint = await fingerprintPayload(dispatch.fingerprintInput(payload));
    const operator = actor.kind === 'user' ? actor : { kind: 'user' as const, userId: this.auditActorSync(actor) };

    const inner = await dispatch.invoke(
      this,
      operator,
      payload,
      { key: openRetryKey, fingerprint },
      { issuedAt: keyed.issued_at, businessDate: keyed.business_date },
    );

    if (inner.error === ORG_UNREACHABLE) return { ok: false, error: ORG_UNREACHABLE };

    const resolvedBy = actor.kind === 'user' ? actor.userId : this.auditActorSync(actor);

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const row = this.loadProvisionalExceptionRow(input.exceptionId);
          if (!row) return { ok: false as const, error: NOT_FOUND };

          if (inner.ok) {
            if (row.resolved_at != null) return { ok: true as const, retried: true as const };
            const now = Date.now();
            this.ctx.storage.sql.exec(
              `UPDATE provisional_exception
               SET resolved_at = ?, resolved_by = ?, open_retry_key = NULL
               WHERE exception_id = ?`,
              now,
              resolvedBy,
              input.exceptionId,
            );
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: PROVISIONAL_RETRY_EXCEPTION_COMMAND,
              entityType: 'provisional_exception',
              entityId: input.exceptionId,
              beforeJson: { resolvedAt: null },
              afterJson: { action: 'retried', resolvedAt: now, resolvedBy },
            });
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'provisional.exception_retried',
              payload: {
                propertyId,
                exceptionId: input.exceptionId,
                businessDate: row.business_date,
                action: 'retried',
              },
            });
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'provisional.exception_resolved',
              payload: {
                propertyId,
                exceptionId: input.exceptionId,
                businessDate: row.business_date,
                action: 'retried',
              },
            });
            return { ok: true as const, retried: true as const };
          }

          const reason: CommandError =
            inner.error === BUSINESS_DATE_CLOSED
              ? BUSINESS_DATE_CLOSED
              : inner.error && isCommandError(inner.error)
                ? inner.error
                : DOMAIN_ERROR;
          this.ctx.storage.sql.exec(
            `UPDATE provisional_exception
             SET reason = ?, detail = ?, open_retry_key = NULL
             WHERE exception_id = ?`,
            reason,
            JSON.stringify(inner),
            input.exceptionId,
          );
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: PROVISIONAL_RETRY_EXCEPTION_COMMAND,
            entityType: 'provisional_exception',
            entityId: input.exceptionId,
            beforeJson: { reason: row.reason },
            afterJson: { action: 'retry_failed', reason, detail: inner },
          });
          return { ok: false as const, error: reason, retried: false as const };
        }),
      );
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR, retried: false };
    }
  }

  async tryAssignProvisionalException(
    actor: ActorContext,
    input: { exceptionId: string; assignedTo: string | null },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ALREADY_RESOLVED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const assignedBy = actor.kind === 'user' ? actor.userId : this.auditActorSync(actor);

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const row = this.loadProvisionalExceptionRow(input.exceptionId);
          if (!row) return { ok: false as const, error: NOT_FOUND };
          if (row.resolved_at != null) return { ok: false as const, error: ALREADY_RESOLVED };

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE provisional_exception
             SET assigned_to = ?, assigned_at = ?, assigned_by = ?
             WHERE exception_id = ?`,
            input.assignedTo,
            now,
            assignedBy,
            input.exceptionId,
          );
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: PROVISIONAL_ASSIGN_EXCEPTION_COMMAND,
            entityType: 'provisional_exception',
            entityId: input.exceptionId,
            beforeJson: { assignedTo: row.assigned_to },
            afterJson: { assignedTo: input.assignedTo, assignedAt: now, assignedBy },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'provisional.exception_assigned',
            payload: { propertyId, exceptionId: input.exceptionId, assignedTo: input.assignedTo },
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryAddExceptionNote(
    actor: ActorContext,
    input: { exceptionId: string; noteId: string; text: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof NOTE_TOO_LONG }
    | { ok: false; error: typeof NOTE_LIMIT }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'night_audit:run');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const text = input.text.trim();
    if (text.length > 2000) return { ok: false, error: NOTE_TOO_LONG };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const row = this.loadProvisionalExceptionRow(input.exceptionId);
          if (!row) return { ok: false as const, error: NOT_FOUND };

          const countRows = this.ctx.storage.sql
            .exec(
              `SELECT COUNT(*) AS n FROM audit_log
               WHERE entity_type = 'provisional_exception' AND entity_id = ? AND command_id = ?`,
              input.exceptionId,
              PROVISIONAL_ADD_EXCEPTION_NOTE_COMMAND,
            )
            .toArray() as Array<{ n: number }>;
          if ((countRows[0]?.n ?? 0) >= 50) return { ok: false as const, error: NOTE_LIMIT };

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: PROVISIONAL_ADD_EXCEPTION_NOTE_COMMAND,
            entityType: 'provisional_exception',
            entityId: input.exceptionId,
            afterJson: { noteId: input.noteId, text },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'provisional.exception_noted',
            payload: { propertyId, exceptionId: input.exceptionId, noteId: input.noteId },
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryRetryAuditStep(
    actor: ActorContext,
    input: { businessDate: string; step: NightAuditStep },
    idem: IdempotencyKey,
    census: NightAuditCensus,
  ): Promise<
    | { ok: true; status: 'COMPLETED' | 'FAILED'; error?: string }
    | { ok: false; error: typeof NIGHT_AUDIT_STEP_NOT_FAILED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      return { ok: false, error: NIGHT_AUDIT_STEP_NOT_FAILED };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryResolveHalt(
    actor: ActorContext,
    input: { businessDate: string },
    idem: IdempotencyKey,
    census: NightAuditCensus,
  ): Promise<
    | { ok: true; status: 'COMPLETED' | 'FAILED'; error?: string; halted: boolean }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
        const mapped = mapPropertyCommandError(e);
        if (mapped) return mapped;
        return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof NIGHT_AUDIT_HALTED }
    | { ok: false; error: typeof NIGHT_AUDIT_NOT_DUE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof BUSINESS_DATE_UNSET }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      return { ok: false, error: NIGHT_AUDIT_NOT_DUE };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: `undeclared:${string}` }
    | { ok: false; error: typeof CONFIG_CLASS_NOT_DOMAIN; gotClass: string }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const entry = getConfigEntry(key);
    if (!entry) return { ok: false, error: configUndeclared(key) };
    if (entry.class !== 'DOMAIN') {
      return { ok: false, error: CONFIG_CLASS_NOT_DOMAIN, gotClass: entry.class };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
      free?: number;
    }>;
  }> {
    this.assertRpcAvailable();
    const ariVersion = this.readAriVersionSync();
    const physicalRows = this.loadAvailabilityDayRowsSync(fromDate, toDate, roomTypeId);

    if (roomTypeId) {
      const kindRows = this.ctx.storage.sql
        .exec(`SELECT kind FROM room_type WHERE room_type_id = ?`, roomTypeId)
        .toArray() as Array<{ kind: string }>;
      if (kindRows[0]?.kind === 'virtual') {
        const constituentIds = this.readVirtualConstituentIdsSync(roomTypeId);
        const constituentRows = this.loadAvailabilityDayRowsForTypesSync(fromDate, toDate, constituentIds);
        const physicalByTypeDate = this.buildPhysicalAvailabilityMap(constituentRows);
        const synthetic = this.syntheticVirtualRowsForRange(
          fromDate,
          toDate,
          roomTypeId,
          constituentIds,
          physicalByTypeDate,
        );
        return { ariVersion, rows: synthetic };
      }
      return { ariVersion, rows: physicalRows };
    }

    const physicalByTypeDate = this.buildPhysicalAvailabilityMap(physicalRows);
    const virtuals = this.readVirtualTypesWithConstituentsSync();
    const syntheticRows = virtuals.flatMap((v) =>
      this.syntheticVirtualRowsForRange(fromDate, toDate, v.virtualId, v.constituentIds, physicalByTypeDate),
    );
    return { ariVersion, rows: [...physicalRows, ...syntheticRows] };
  }

  private loadAvailabilityDayRowsSync(
    fromDate: string,
    toDate: string,
    roomTypeId?: string,
  ): Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
  }> {
    return this.ctx.storage.sql
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
  }

  private loadAvailabilityDayRowsForTypesSync(
    fromDate: string,
    toDate: string,
    roomTypeIds: string[],
  ): Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
  }> {
    if (roomTypeIds.length === 0) return [];
    const placeholders = roomTypeIds.map(() => '?').join(', ');
    return this.ctx.storage.sql
      .exec(
        `SELECT room_type_id AS roomTypeId, stay_date AS stayDate,
                physical, blocked, held, sold, oversell
           FROM availability_day
          WHERE stay_date >= ? AND stay_date <= ?
            AND room_type_id IN (${placeholders})
          ORDER BY room_type_id, stay_date`,
        fromDate,
        toDate,
        ...roomTypeIds,
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
  }

  private readVirtualTypesWithConstituentsSync(): Array<{
    virtualId: string;
    constituentIds: string[];
  }> {
    const virtuals = this.ctx.storage.sql
      .exec(`SELECT room_type_id FROM room_type WHERE status = 'active' AND kind = 'virtual'`)
      .toArray() as Array<{ room_type_id: string }>;
    return virtuals.map((v) => ({
      virtualId: v.room_type_id,
      constituentIds: this.readVirtualConstituentIdsSync(v.room_type_id),
    }));
  }

  private buildPhysicalAvailabilityMap(
    physicalRows: Array<{
      roomTypeId: string;
      stayDate: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
    }>,
  ): Map<string, Map<string, ConstituentAvailabilityRow>> {
    const map = new Map<string, Map<string, ConstituentAvailabilityRow>>();
    for (const row of physicalRows) {
      let byDate = map.get(row.roomTypeId);
      if (!byDate) {
        byDate = new Map();
        map.set(row.roomTypeId, byDate);
      }
      byDate.set(row.stayDate, {
        physical: row.physical,
        blocked: row.blocked,
        held: row.held,
        sold: row.sold,
        oversell: row.oversell,
      });
    }
    return map;
  }

  private syntheticVirtualRowsForRange(
    fromDate: string,
    toDate: string,
    virtualId: string,
    constituentIds: string[],
    physicalByTypeDate: Map<string, Map<string, ConstituentAvailabilityRow>>,
  ): Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    free: number;
  }> {
    const out: Array<{
      roomTypeId: string;
      stayDate: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
      free: number;
    }> = [];
    let stayDate = fromDate;
    while (stayDate <= toDate) {
      out.push({
        roomTypeId: virtualId,
        stayDate,
        physical: 0,
        blocked: 0,
        held: 0,
        sold: 0,
        oversell: 0,
        free: sumConstituentFree(constituentIds, stayDate, physicalByTypeDate),
      });
      stayDate = enumerateFromDate(stayDate, 2)[1]!;
    }
    return out;
  }

  private validateVirtualConstituentsSync(ids: string[] | undefined): string[] {
    if (!ids || ids.length === 0) throw new Error(VIRTUAL_CONSTITUENTS_REQUIRED);
    const sorted = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    if (sorted.length !== ids.length) throw new Error(VIRTUAL_CONSTITUENTS_DUPLICATE);
    if (sorted.length < 2) throw new Error(VIRTUAL_CONSTITUENTS_MIN_TWO);
    for (const id of sorted) {
      const rows = this.ctx.storage.sql
        .exec(`SELECT kind, status FROM room_type WHERE room_type_id = ?`, id)
        .toArray() as Array<{ kind: string; status: string }>;
      const row = rows[0];
      if (row?.kind === 'virtual') throw new Error(VIRTUAL_NESTED_FORBIDDEN);
      if (!row || row.status !== 'active' || row.kind !== 'physical') {
        throw new Error(VIRTUAL_CONSTITUENT_NOT_PHYSICAL);
      }
    }
    return sorted;
  }

  private assertVirtualOccupancyWithinConstituentsSync(
    maxOccupancy: number,
    maxAdults: number,
    constituentIds: string[],
  ): void {
    let minOccupancy = Infinity;
    let minAdults = Infinity;
    for (const id of constituentIds) {
      const rows = this.ctx.storage.sql
        .exec(`SELECT max_occupancy, max_adults FROM room_type WHERE room_type_id = ?`, id)
        .toArray() as Array<{ max_occupancy: number; max_adults: number }>;
      const row = rows[0];
      if (!row) continue;
      minOccupancy = Math.min(minOccupancy, row.max_occupancy);
      minAdults = Math.min(minAdults, row.max_adults);
    }
    if (maxOccupancy > minOccupancy || maxAdults > minAdults) {
      throw new Error(VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS);
    }
  }

  private readVirtualConstituentIdsSync(virtualRoomTypeId: string): string[] {
    return (
      this.ctx.storage.sql
        .exec(
          `SELECT physical_room_type_id FROM room_type_constituent WHERE virtual_room_type_id = ? ORDER BY physical_room_type_id`,
          virtualRoomTypeId,
        )
        .toArray() as Array<{ physical_room_type_id: string }>
    ).map((row) => row.physical_room_type_id);
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
      kind?: 'physical' | 'virtual';
      roomCount?: number;
      maxOccupancy: number;
      maxAdults: number;
      constituentRoomTypeIds?: string[];
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof BUSINESS_DATE_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ROOM_TYPE_EXISTS }
    | { ok: false; error: typeof ROOM_TYPE_CODE_EXISTS }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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

          const kind = input.kind ?? 'physical';
          if (kind === 'virtual') {
            if (input.roomCount !== undefined && input.roomCount !== 0) {
              throw new Error(VIRTUAL_ROOM_COUNT_MUST_BE_ZERO);
            }
            const constituents = this.validateVirtualConstituentsSync(input.constituentRoomTypeIds);
            this.assertVirtualOccupancyWithinConstituentsSync(
              input.maxOccupancy,
              input.maxAdults,
              constituents,
            );
            const now = Date.now();
            this.ctx.storage.sql.exec(
              `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, kind, created_at, updated_at)
               VALUES (?, ?, ?, 0, ?, ?, 'active', 'virtual', ?, ?)`,
              input.roomTypeId,
              input.code,
              input.name,
              input.maxOccupancy,
              input.maxAdults,
              now,
              now,
            );
            for (const physicalId of constituents) {
              this.ctx.storage.sql.exec(
                `INSERT INTO room_type_constituent (virtual_room_type_id, physical_room_type_id, created_at)
                 VALUES (?, ?, ?)`,
                input.roomTypeId,
                physicalId,
                now,
              );
            }
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'inventory.room_type_changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, op: 'add', at: now },
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
                kind: 'virtual',
                roomCount: 0,
                maxOccupancy: input.maxOccupancy,
                maxAdults: input.maxAdults,
                constituentRoomTypeIds: constituents,
                status: 'active',
              },
            });
            return {
              ok: true as const,
              roomTypeId: input.roomTypeId,
              ariVersion: this.readAriVersionSync(),
              fromDate: '',
              toDate: '',
            };
          }

          const roomCount = input.roomCount!;
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            input.roomTypeId,
            input.code,
            input.name,
            roomCount,
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
              roomCount,
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
              roomCount,
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Update an active `room_type`'s columns. Never inserts `availability_day` rows —
   * only updates existing rows from "today" forward when `roomCount` changes.
   * Fingerprint allowlist: `{ roomTypeId, code?, name?, roomCount?, maxOccupancy?, maxAdults?, constituentRoomTypeIds? }`.
   */
  async tryUpdateRoomType(
    actor: ActorContext,
    input: {
      roomTypeId: string;
      code?: string;
      name?: string;
      kind?: 'physical' | 'virtual';
      roomCount?: number;
      maxOccupancy?: number;
      maxAdults?: number;
      constituentRoomTypeIds?: string[];
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate?: string; toDate?: string }
    | { ok: false; error: typeof OVERSELL; dates: string[] }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof ROOM_TYPE_CODE_EXISTS }
    | { ok: false; error: typeof ROOM_UNITS_EXCEED_COUNT }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
              `SELECT code, name, room_count, max_occupancy, max_adults, status, kind FROM room_type WHERE room_type_id = ?`,
              input.roomTypeId,
            )
            .toArray() as Array<{
            code: string;
            name: string;
            room_count: number;
            max_occupancy: number;
            max_adults: number;
            status: string;
            kind: string;
          }>;
          const existing = existingRows[0];
          if (!existing || existing.status !== 'active') {
            // Thrown, not returned: a not-found/inactive room type is a precondition
            // failure and must roll back without being cached under the idempotency key.
            throw new RoomTypeNotFoundError();
          }

          const existingKind = existing.kind ?? 'physical';
          if (input.kind !== undefined && input.kind !== existingKind) {
            throw new Error(ROOM_TYPE_KIND_IMMUTABLE);
          }
          if (existingKind === 'physical' && input.constituentRoomTypeIds !== undefined) {
            throw new Error(VIRTUAL_CONSTITUENTS_ON_PHYSICAL);
          }
          if (existingKind === 'virtual' && input.roomCount !== undefined && input.roomCount !== 0) {
            throw new Error(VIRTUAL_ROOM_COUNT_MUST_BE_ZERO);
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          const nextRoomCount =
            existingKind === 'virtual' ? 0 : (input.roomCount ?? existing.room_count);
          const roomCountChanged =
            existingKind === 'physical' &&
            input.roomCount !== undefined &&
            input.roomCount !== existing.room_count;

          if (roomCountChanged && nextRoomCount < existing.room_count) {
            const unitCount = Number(
              (
                this.ctx.storage.sql
                  .exec(
                    `SELECT COUNT(*) AS c FROM room WHERE room_type_id = ? AND archived_at IS NULL`,
                    input.roomTypeId,
                  )
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

          const nextMaxOccupancy = input.maxOccupancy ?? existing.max_occupancy;
          const nextMaxAdults = input.maxAdults ?? existing.max_adults;

          let constituentIds: string[] | undefined;
          if (existingKind === 'virtual') {
            constituentIds =
              input.constituentRoomTypeIds !== undefined
                ? this.validateVirtualConstituentsSync(input.constituentRoomTypeIds)
                : this.readVirtualConstituentIdsSync(input.roomTypeId);
            this.assertVirtualOccupancyWithinConstituentsSync(
              nextMaxOccupancy,
              nextMaxAdults,
              constituentIds,
            );
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room_type SET code = ?, name = ?, room_count = ?, max_occupancy = ?, max_adults = ?, updated_at = ? WHERE room_type_id = ?`,
            input.code ?? existing.code,
            input.name ?? existing.name,
            nextRoomCount,
            nextMaxOccupancy,
            nextMaxAdults,
            now,
            input.roomTypeId,
          );

          if (existingKind === 'virtual' && input.constituentRoomTypeIds !== undefined) {
            this.ctx.storage.sql.exec(
              `DELETE FROM room_type_constituent WHERE virtual_room_type_id = ?`,
              input.roomTypeId,
            );
            for (const physicalId of constituentIds!) {
              this.ctx.storage.sql.exec(
                `INSERT INTO room_type_constituent (virtual_room_type_id, physical_room_type_id, created_at)
                 VALUES (?, ?, ?)`,
                input.roomTypeId,
                physicalId,
                now,
              );
            }
          }

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'update', at: now },
          });

          // Only writes touched availability_day rows bump the property ARI counter.
          const ariVersion = roomCountChanged ? this.bumpAriVersionSync() : this.readAriVersionSync();
          if (fromDate && toDate && existingKind === 'physical') {
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
              ...(existingKind === 'virtual'
                ? { kind: 'virtual', constituentRoomTypeIds: this.readVirtualConstituentIdsSync(input.roomTypeId) }
                : {}),
            },
            afterJson: {
              code: input.code ?? existing.code,
              name: input.name ?? existing.name,
              roomCount: nextRoomCount,
              maxOccupancy: nextMaxOccupancy,
              maxAdults: nextMaxAdults,
              ...(existingKind === 'virtual'
                ? { kind: 'virtual', constituentRoomTypeIds: constituentIds ?? [] }
                : {}),
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof NOT_FOUND }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
            .exec(`SELECT status, kind FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string; kind: string }>;
          if (!existingRows[0] || existingRows[0].status !== 'active') {
            // Thrown, not returned — see tryUpdateRoomType for why.
            throw new RoomTypeNotFoundError();
          }

          const kind = existingRows[0].kind ?? 'physical';
          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          let futureRows: Array<{
            stay_date: string;
            physical: number;
            blocked: number;
            held: number;
            sold: number;
            oversell: number;
          }> = [];

          if (kind === 'virtual') {
            const live = this.ctx.storage.sql
              .exec(
                `SELECT 1 FROM reservation WHERE room_type_id = ? AND status IN ('inquiry','pending','confirmed','checked_in') LIMIT 1`,
                input.roomTypeId,
              )
              .toArray();
            if (live.length > 0) throw new ArchiveBlockedError();
          } else {
            futureRows = this.ctx.storage.sql
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

            const constituent = this.ctx.storage.sql
              .exec(
                `SELECT 1 FROM room_type_constituent c
                   JOIN room_type v ON v.room_type_id = c.virtual_room_type_id
                  WHERE c.physical_room_type_id = ? AND v.status = 'active' LIMIT 1`,
                input.roomTypeId,
              )
              .toArray();
            if (constituent.length > 0) throw new Error(CONSTITUENT_IN_USE);
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
          if (kind === 'physical' && futureRows.length > 0) {
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Archive a physical room unit. Implements catalog `rooms.delete`.
   * Fingerprint allowlist: `{ roomId }`.
   * Never touches availability_day / ARI.
   */
  async tryDeleteRoom(
    actor: ActorContext,
    input: { roomId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomId: string }
    | { ok: false; error: typeof ARCHIVE_BLOCKED }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof TIMEZONE_UNSET }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof NOT_FOUND }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT room_id, room_type_id, code, status, floor, archived_at
               FROM room WHERE room_id = ?`,
              input.roomId,
            )
            .toArray() as Array<{
            room_id: string;
            room_type_id: string;
            code: string;
            status: string;
            floor: string | null;
            archived_at: number | null;
          }>;
          const existing = rows[0];
          if (!existing || existing.archived_at != null) {
            throw new RoomNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;

          const liveRes = this.ctx.storage.sql
            .exec(
              `SELECT 1 FROM reservation
               WHERE room_id = ? AND status IN ('inquiry','pending','confirmed','checked_in')
               LIMIT 1`,
              input.roomId,
            )
            .toArray();
          if (liveRes.length > 0) throw new ArchiveBlockedError();

          const futureOoo = this.ctx.storage.sql
            .exec(
              `SELECT 1 FROM room_ooo WHERE room_id = ? AND end_date > ? LIMIT 1`,
              input.roomId,
              today,
            )
            .toArray();
          if (futureOoo.length > 0) throw new ArchiveBlockedError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room SET archived_at = ?, updated_at = ? WHERE room_id = ?`,
            now,
            now,
            input.roomId,
          );

          deleteFutureHousekeepingAssignments(this.moduleTxnCtx(orgId, propertyId), {
            roomId: input.roomId,
            businessDate: today,
          });

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'room.archived',
            payload: {
              propertyId,
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rooms.delete',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: {
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
              floor: existing.floor,
              status: existing.status,
              archivedAt: null,
            },
            afterJson: {
              roomId: input.roomId,
              roomTypeId: existing.room_type_id,
              code: existing.code,
              floor: existing.floor,
              status: existing.status,
              archivedAt: now,
            },
          });

          return { ok: true as const, roomId: input.roomId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ArchiveBlockedError) return { ok: false, error: ARCHIVE_BLOCKED };
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
              `SELECT room_count, status, kind FROM room_type WHERE room_type_id = ?`,
              input.roomTypeId,
            )
            .toArray() as Array<{ room_count: number; status: string; kind: string }>;
          const roomType = typeRows[0];
          if (!roomType || roomType.status !== 'active') {
            throw new RoomTypeNotFoundError();
          }
          if (roomType.kind === 'virtual') throw new Error(VIRTUAL_TYPE_NO_ROOMS);

          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT room_id FROM room WHERE code = ? AND archived_at IS NULL`, input.code)
            .toArray();
          if (codeTaken.length > 0) throw new RoomCodeExistsError();

          const unitCount = Number(
            (
              this.ctx.storage.sql
                .exec(
                  `SELECT COUNT(*) AS c FROM room WHERE room_type_id = ? AND archived_at IS NULL`,
                  input.roomTypeId,
                )
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
            .exec(`SELECT code, floor, archived_at FROM room WHERE room_id = ?`, input.roomId)
            .toArray() as Array<{ code: string; floor: string | null; archived_at: number | null }>;
          const existing = rows[0];
          if (!existing || existing.archived_at != null) throw new RoomNotFoundError();

          const nextCode = input.code ?? existing.code;
          const nextFloor = input.floor !== undefined ? input.floor : existing.floor;

          if (input.code !== undefined && input.code !== existing.code) {
            const codeTaken = this.ctx.storage.sql
              .exec(
                `SELECT room_id FROM room WHERE code = ? AND archived_at IS NULL AND room_id != ?`,
                input.code,
                input.roomId,
              )
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private oooNights(startDate: string, endDate: string): string[] {
    return enumerateStayDates(startDate, endDate);
  }

  private setDifference(a: string[], b: string[]): string[] {
    const drop = new Set(b);
    return a.filter((d) => !drop.has(d));
  }

  private placeholderStatusBeforeSync(roomId: string, liveStatus: string): string {
    if (liveStatus === 'clean' || liveStatus === 'dirty' || liveStatus === 'inspected') return liveStatus;
    const openDate = this.readBusinessDateSync();
    if (!openDate) return 'clean';
    const covering = this.ctx.storage.sql
      .exec(
        `SELECT status_before FROM room_ooo
          WHERE room_id = ? AND start_date <= ? AND end_date > ?
          LIMIT 1`,
        roomId,
        openDate,
        openDate,
      )
      .toArray() as Array<{ status_before: string }>;
    return covering[0]?.status_before ?? 'clean';
  }

  private applyBlockedDeltaSync(
    roomTypeId: string,
    nightsToAdd: string[],
    nightsToRemove: string[],
  ): { fromDate: string; toDate: string } | null {
    const openDate = this.readBusinessDateSync();
    if (!openDate) throw new Error(BUSINESS_DATE_UNSET);
    const horizon = enumerateFromDate(openDate, HORIZON_DAYS);
    const horizonEnd = horizon[horizon.length - 1]!;
    const touched: string[] = [];
    for (const d of nightsToAdd) {
      if (d < openDate) throw new OooInvalidRangeError();
      if (d > horizonEnd) continue;
      const row = this.ctx.storage.sql
        .exec(
          `SELECT blocked FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
          roomTypeId,
          d,
        )
        .toArray() as Array<{ blocked: number }>;
      if (!row[0]) throw new LedgerInconsistentError(d);
      this.ctx.storage.sql.exec(
        `UPDATE availability_day SET blocked = blocked + 1, version = version + 1
          WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        d,
      );
      touched.push(d);
    }
    for (const d of nightsToRemove) {
      if (d < openDate || d > horizonEnd) continue;
      const row = this.ctx.storage.sql
        .exec(
          `SELECT blocked FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
          roomTypeId,
          d,
        )
        .toArray() as Array<{ blocked: number }>;
      if (!row[0] || row[0].blocked < 1) throw new LedgerInconsistentError(d);
      this.ctx.storage.sql.exec(
        `UPDATE availability_day SET blocked = blocked - 1, version = version + 1
          WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        d,
      );
      touched.push(d);
    }
    if (touched.length === 0) return null;
    touched.sort();
    return { fromDate: touched[0]!, toDate: touched[touched.length - 1]! };
  }

  private syncOooStatusForRoomSync(roomId: string, releasedStatusBefore?: string): void {
    const openDate = this.readBusinessDateSync();
    if (!openDate) return;
    const room = this.ctx.storage.sql
      .exec(`SELECT status, room_type_id FROM room WHERE room_id = ?`, roomId)
      .toArray() as Array<{ status: string; room_type_id: string }>;
    if (!room[0]) return;
    const covering = this.ctx.storage.sql
      .exec(
        `SELECT ooo_id, status_before FROM room_ooo
          WHERE room_id = ? AND start_date <= ? AND end_date > ?
          LIMIT 1`,
        roomId,
        openDate,
        openDate,
      )
      .toArray() as Array<{ ooo_id: string; status_before: string }>;
    const desiredOoo = covering.length > 0;
    const currentlyOoo = room[0].status === 'out_of_order';
    const propertyId = this.getPropertyIdSync();
    const now = Date.now();
    if (desiredOoo && !currentlyOoo) {
      this.ctx.storage.sql.exec(
        `UPDATE room_ooo SET status_before = ?, updated_at = ? WHERE ooo_id = ?`,
        room[0].status,
        now,
        covering[0]!.ooo_id,
      );
      this.ctx.storage.sql.exec(
        `UPDATE room SET status = 'out_of_order', updated_at = ? WHERE room_id = ?`,
        now,
        roomId,
      );
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'room.status_changed',
        payload: {
          propertyId,
          roomId,
          fromStatus: room[0].status,
          toStatus: 'out_of_order',
        },
      });
    } else if (!desiredOoo && currentlyOoo) {
      let restore = releasedStatusBefore;
      if (restore == null) {
        const justEnded = this.ctx.storage.sql
          .exec(
            `SELECT status_before FROM room_ooo
              WHERE room_id = ? AND start_date <= ?
              ORDER BY end_date DESC
              LIMIT 1`,
            roomId,
            openDate,
          )
          .toArray() as Array<{ status_before: string }>;
        restore = justEnded[0]?.status_before ?? 'clean';
      }
      this.ctx.storage.sql.exec(
        `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
        restore,
        now,
        roomId,
      );
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'room.status_changed',
        payload: { propertyId, roomId, fromStatus: 'out_of_order', toStatus: restore },
      });
    }
  }

  private syncOooStatusAllRoomsSync(): void {
    const rows = this.ctx.storage.sql.exec(`SELECT room_id FROM room`).toArray() as Array<{ room_id: string }>;
    for (const r of rows) this.syncOooStatusForRoomSync(r.room_id);
  }

  /**
   * Create / edit / release a per-room OOO range. Implements `rooms.set_ooo_range`.
   * Fingerprint allowlist: `{ roomId, startDate, endDate, oooId? }`.
   * FAIL_CLOSED — inventory:write + pms.core.
   */
  async trySetOooRange(
    actor: ActorContext,
    input: {
      roomId: string;
      startDate: string;
      endDate: string;
      oooId?: string;
      reason?: string;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomId: string; oooId: string; alreadyApplied?: true }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof OOO_INVALID_RANGE }
    | { ok: false; error: typeof OOO_RANGE_OVERLAP }
    | { ok: false; error: typeof OOO_ROOM_ASSIGNED; reservationId?: string }
    | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
    | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'inventory:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() => {
        const prior = this.ctx.storage.sql
          .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
          .toArray() as Array<{ request_fingerprint: string; response: string }>;
        if (prior.length > 0) {
          if (prior[0]!.request_fingerprint !== idem.fingerprint) {
            throw new IdempotencyKeyReused(idem.key);
          }
          const cached = JSON.parse(prior[0]!.response) as
            | { ok: true; roomId: string; oooId: string }
            | { ok: false; error: CommandError; reservationId?: string; date?: string };
          if (cached.ok === true) {
            return { ...cached, alreadyApplied: true as const };
          }
          return cached;
        }
        return runIdempotent(this.ctx.storage.sql, idem, () => {
          const openDate = this.readBusinessDateSync();
          if (!openDate) throw new Error(BUSINESS_DATE_UNSET);
          if (!STAY_DATE_RE.test(input.startDate) || !STAY_DATE_RE.test(input.endDate)) {
            throw new OooInvalidRangeError();
          }

          const roomRows = this.ctx.storage.sql
            .exec(
              `SELECT r.room_id, r.room_type_id, r.status, r.archived_at, t.status AS type_status
               FROM room r JOIN room_type t ON t.room_type_id = r.room_type_id
               WHERE r.room_id = ?`,
              input.roomId,
            )
            .toArray() as Array<{
            room_id: string;
            room_type_id: string;
            status: string;
            archived_at: number | null;
            type_status: string;
          }>;
          const room = roomRows[0];
          if (!room || room.type_status !== 'active' || room.archived_at != null) {
            throw new RoomNotFoundError();
          }

          let reason: string | null = null;
          if (input.reason !== undefined) {
            const trimmed = input.reason.trim();
            if (trimmed.length > 256) throw new OooInvalidRangeError();
            reason = trimmed.length === 0 ? null : trimmed;
          }

          type OooRow = {
            ooo_id: string;
            room_id: string;
            start_date: string;
            end_date: string;
            reason: string | null;
            status_before: string;
          };
          let old: OooRow | null = null;
          let oooId = input.oooId;
          const isEdit = Boolean(input.oooId);
          if (isEdit) {
            const existing = this.ctx.storage.sql
              .exec(`SELECT ooo_id, room_id, start_date, end_date, reason, status_before FROM room_ooo WHERE ooo_id = ?`, input.oooId)
              .toArray() as OooRow[];
            if (!existing[0] || existing[0].room_id !== input.roomId) throw new RoomNotFoundError();
            old = existing[0];
            oooId = old.ooo_id;
          } else {
            oooId = `ooo_${crypto.randomUUID()}`;
          }

          const isRelease = isEdit && input.startDate >= input.endDate;
          if (!isEdit && input.startDate >= input.endDate) throw new OooInvalidRangeError();
          if (!isEdit && input.startDate < openDate) throw new OooInvalidRangeError();

          const nextReason = input.reason !== undefined ? reason : (old?.reason ?? null);
          const oldNights = old ? this.oooNights(old.start_date, old.end_date) : [];
          const newNights = isRelease ? [] : this.oooNights(input.startDate, input.endDate);
          const nightsToAdd = this.setDifference(newNights, oldNights);
          const nightsToRemove = this.setDifference(oldNights, newNights);

          if (
            old &&
            !isRelease &&
            old.start_date === input.startDate &&
            old.end_date === input.endDate
          ) {
            return { ok: true as const, roomId: input.roomId, oooId: oooId!, alreadyApplied: true as const };
          }

          if (!isRelease) {
            const overlap = this.ctx.storage.sql
              .exec(
                `SELECT ooo_id FROM room_ooo
                  WHERE room_id = ?
                    AND ooo_id != ?
                    AND start_date < ?
                    AND end_date > ?
                  LIMIT 1`,
                input.roomId,
                oooId,
                input.endDate,
                input.startDate,
              )
              .toArray();
            if (overlap.length > 0) throw new OooRangeOverlapError();
          }

          if (nightsToAdd.length > 0) {
            const added = [...nightsToAdd].sort();
            const addStart = added[0]!;
            const addEnd = enumerateFromDate(added[added.length - 1]!, 2)[1]!;
            const assigned = this.ctx.storage.sql
              .exec(
                `SELECT reservation_id FROM reservation
                  WHERE room_id = ?
                    AND status IN ('pending', 'confirmed', 'checked_in')
                    AND arrival_date < ?
                    AND departure_date > ?
                  LIMIT 1`,
                input.roomId,
                addEnd,
                addStart,
              )
              .toArray() as Array<{ reservation_id: string }>;
            if (assigned[0]) throw new OooRoomAssignedError(assigned[0].reservation_id);
          }

          const span = this.applyBlockedDeltaSync(room.room_type_id, nightsToAdd, nightsToRemove);
          const now = Date.now();
          const oldJson = old
            ? { oooId: old.ooo_id, startDate: old.start_date, endDate: old.end_date, reason: old.reason }
            : null;
          let action: 'created' | 'updated' | 'released';
          let releasedStatusBefore: string | undefined;

          if (isRelease) {
            releasedStatusBefore = old!.status_before;
            this.ctx.storage.sql.exec(`DELETE FROM room_ooo WHERE ooo_id = ?`, oooId);
            action = 'released';
          } else if (old) {
            this.ctx.storage.sql.exec(
              `UPDATE room_ooo SET start_date = ?, end_date = ?, reason = ?, updated_at = ? WHERE ooo_id = ?`,
              input.startDate,
              input.endDate,
              nextReason,
              now,
              oooId,
            );
            action = 'updated';
          } else {
            const placeholder = this.placeholderStatusBeforeSync(input.roomId, room.status);
            this.ctx.storage.sql.exec(
              `INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              oooId,
              input.roomId,
              input.startDate,
              input.endDate,
              nextReason,
              placeholder,
              now,
              now,
            );
            action = 'created';
          }

          this.syncOooStatusForRoomSync(input.roomId, releasedStatusBefore);

          if (span) {
            const ariVersion = this.bumpAriVersionSync();
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: {
                propertyId,
                roomTypeId: room.room_type_id,
                fromDate: span.fromDate,
                toDate: span.toDate,
                version: ariVersion,
              },
            });
          }

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'room.ooo_changed',
            payload: {
              propertyId,
              roomId: input.roomId,
              roomTypeId: room.room_type_id,
              oooId,
              startDate: isRelease ? old!.start_date : input.startDate,
              endDate: isRelease ? old!.end_date : input.endDate,
              action,
              reason: nextReason,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rooms.set_ooo_range',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: oldJson,
            afterJson: isRelease
              ? null
              : { oooId, startDate: input.startDate, endDate: input.endDate, reason: nextReason },
          });

          return { ok: true as const, roomId: input.roomId, oooId: oooId! };
        });
      });
    } catch (e) {
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof OOO_VIA_RANGE }
    | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
    | { ok: false; error: typeof ORG_ID_UNSET | typeof INVALID_STATUS }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!isRoomStatus(input.status)) {
      return { ok: false, error: INVALID_STATUS };
    }
    if (!isCleanlinessStatus(input.status)) {
      return { ok: false, error: OOO_VIA_RANGE };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const fromRows = this.ctx.storage.sql
            .exec(`SELECT status, archived_at FROM room WHERE room_id = ?`, input.roomId)
            .toArray() as Array<{ status: string; archived_at: number | null }>;
          if (!fromRows[0] || fromRows[0].archived_at != null) throw new RoomNotFoundError();
          const fromStatus = fromRows[0].status;
          const result = updateRoomStatus(this.moduleTxnCtx(orgId, propertyId, provisional), input);
          this.appendAuditLogSync({
            actor: this.auditActorForCommandSync(actor, provisional),
            commandId: 'rooms.update_status',
            entityType: 'room',
            entityId: input.roomId,
            beforeJson: { status: fromStatus },
            afterJson: { status: input.status },
          });
          return result;
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      if (e instanceof HousekeepingRoomOutOfOrderError) return { ok: false, error: ROOM_OUT_OF_ORDER };
      if (e instanceof HousekeepingOooViaRangeError) return { ok: false, error: OOO_VIA_RANGE };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof LIMIT_EXCEEDED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof OOO_VIA_RANGE }
    | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
    | { ok: false; error: typeof ORG_ID_UNSET | typeof INVALID_STATUS }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (input.updates.length > ROOMS_BULK_STATUS_MAX) {
      return { ok: false, error: LIMIT_EXCEEDED };
    }

    for (const u of input.updates) {
      if (!isRoomStatus(u.status)) {
        return { ok: false, error: INVALID_STATUS };
      }
      if (!isCleanlinessStatus(u.status)) {
        return { ok: false, error: OOO_VIA_RANGE };
      }
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const fromByRoom = new Map<string, string>();
          for (const u of input.updates) {
            const rows = this.ctx.storage.sql
              .exec(`SELECT status, archived_at FROM room WHERE room_id = ?`, u.roomId)
              .toArray() as Array<{ status: string; archived_at: number | null }>;
            if (!rows[0] || rows[0].archived_at != null) throw new RoomNotFoundError();
            fromByRoom.set(u.roomId, rows[0].status);
          }
          const result = bulkUpdateRoomStatus(this.moduleTxnCtx(orgId, propertyId, provisional), input);
          for (const u of input.updates) {
            this.appendAuditLogSync({
              actor: this.auditActorForCommandSync(actor, provisional),
              commandId: 'rooms.bulk_update_status',
              entityType: 'room',
              entityId: u.roomId,
              beforeJson: { status: fromByRoom.get(u.roomId) },
              afterJson: { status: u.status },
            });
          }
          return result;
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      if (e instanceof HousekeepingRoomOutOfOrderError) return { ok: false, error: ROOM_OUT_OF_ORDER };
      if (e instanceof HousekeepingOooViaRangeError) return { ok: false, error: OOO_VIA_RANGE };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Assign a physical room to a reservation. Implements `reservations.assign_room`.
   * Fingerprint allowlist: `{ reservationId, roomId }`.
   * FAIL_CLOSED — no provisional parameter. Overlap uses half-open [arrival, departure).
   */
  private assertRoomAssignableSync(
    roomId: string,
    reservation: {
      reservationId: string;
      allocatedRoomTypeId: string;
      arrivalDate: string;
      departureDate: string;
    },
  ): { room_type_id: string; status: string } {
    const roomRows = this.ctx.storage.sql
      .exec(`SELECT room_type_id, status, archived_at FROM room WHERE room_id = ?`, roomId)
      .toArray() as Array<{ room_type_id: string; status: string; archived_at: number | null }>;
    const room = roomRows[0];
    if (!room || room.archived_at != null) throw new RoomNotFoundError();
    if (room.status === 'out_of_order') throw new RoomOutOfOrderError();
    if (room.room_type_id !== reservation.allocatedRoomTypeId) throw new RoomTypeMismatchError();
    const conflict = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id FROM reservation
         WHERE room_id = ?
           AND reservation_id != ?
           AND status IN ('pending', 'confirmed', 'checked_in')
           AND arrival_date < ?
           AND departure_date > ?
         LIMIT 1`,
        roomId,
        reservation.reservationId,
        reservation.departureDate,
        reservation.arrivalDate,
      )
      .toArray();
    if (conflict.length > 0) throw new RoomAlreadyAssignedError();
    const oooHit = this.ctx.storage.sql
      .exec(
        `SELECT ooo_id FROM room_ooo
          WHERE room_id = ?
            AND start_date < ?
            AND end_date > ?
          LIMIT 1`,
        roomId,
        reservation.departureDate,
        reservation.arrivalDate,
      )
      .toArray();
    if (oooHit.length > 0) throw new RoomOutOfOrderError();
    return room;
  }

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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
              `SELECT room_type_id, allocated_room_type_id, arrival_date, departure_date, status, room_id
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            allocated_room_type_id: string;
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

          const allocatedRoomTypeId =
            reservation.allocated_room_type_id || reservation.room_type_id;
          this.assertRoomAssignableSync(input.roomId, {
            reservationId: input.reservationId,
            allocatedRoomTypeId,
            arrivalDate: reservation.arrival_date,
            departureDate: reservation.departure_date,
          });

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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | {
        ok: false;
        error:
          | typeof ORG_ID_UNSET
          | typeof INVALID_BUSINESS_DATE
          | typeof INVALID_ASSIGNEE_REF
          | typeof ORG_UNREACHABLE
          | typeof STAFF_NOT_FOUND
          | typeof STAFF_EXITED
          | typeof STAFF_NOT_ASSIGNABLE;
      }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'housekeeping:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!STAY_DATE_RE.test(input.businessDate)) {
      return { ok: false, error: INVALID_BUSINESS_DATE };
    }
    if (!isStaffRef(input.assigneeRef)) {
      return { ok: false, error: INVALID_ASSIGNEE_REF };
    }

    const staffGate = await this.gateStaffRef(orgId, input.assigneeRef);
    if (!staffGate.ok) return staffGate;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const result = assignHousekeeping(this.moduleTxnCtx(orgId, propertyId, provisional), input);
          this.appendAuditLogSync({
            actor: this.auditActorForCommandSync(actor, provisional),
            commandId: 'housekeeping.assign',
            entityType: 'room',
            entityId: input.roomId,
            afterJson: {
              roomId: input.roomId,
              businessDate: input.businessDate,
              assigneeRef: input.assigneeRef,
            },
          });
          return result;
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof InvalidAssigneeRefError) return { ok: false, error: INVALID_ASSIGNEE_REF };
      if (e instanceof HousekeepingRoomNotFoundError || e instanceof RoomNotFoundError) {
        return { ok: false, error: NOT_FOUND };
      }
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
      oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
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
           AND archived_at IS NULL
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

    const oooRows = this.ctx.storage.sql
      .exec(`SELECT ooo_id, room_id, start_date, end_date, reason FROM room_ooo`)
      .toArray() as Array<{
      ooo_id: string;
      room_id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
    }>;
    const oooByRoom = new Map<
      string,
      Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>
    >();
    for (const o of oooRows) {
      const list = oooByRoom.get(o.room_id) ?? [];
      list.push({
        oooId: o.ooo_id,
        startDate: o.start_date,
        endDate: o.end_date,
        reason: o.reason,
      });
      oooByRoom.set(o.room_id, list);
    }

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
        oooRanges: oooByRoom.get(r.room_id) ?? [],
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

  private applyNoPostIfPresentSync(reservationId: string, noPost: boolean | undefined): void {
    if (noPost === undefined) return;
    this.ctx.storage.sql.exec(
      `UPDATE reservation SET no_post = ? WHERE reservation_id = ?`,
      noPost ? 1 : 0,
      reservationId,
    );
  }

  private snapshotRateNightsSync(
    reservationId: string,
    roomTypeId: string,
    ratePlanId: string,
    nights: string[],
    promo: PromoSnapshotRow | null = null,
  ): void {
    const currency = this.readStoredLedgerCurrencySync();
    if (!currency) throw new Error(CURRENCY_UNSET);
    const promoInput = promo ? this.promoApplyInputFromRowSync(promo) : null;
    for (const stayDate of nights) {
      let amount = this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate);
      if (promoInput) {
        amount = applyPromoToAmountMinor(amount, promoInput);
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO reservation_rate_night (reservation_id, stay_date, amount_minor, currency, rate_plan_id)
         VALUES (?, ?, ?, ?, ?)`,
        reservationId,
        stayDate,
        amount,
        currency,
        ratePlanId,
      );
    }
  }

  private rateNightAmountSync(
    reservationId: string,
    roomTypeId: string,
    ratePlanId: string,
    stayDate: string,
  ): number {
    const snap = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`,
        reservationId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number }>;
    if (snap[0]) return snap[0].amount_minor;
    const amount = this.rateDayAmountSync(roomTypeId, ratePlanId, stayDate);
    const currency = this.readStoredLedgerCurrencySync();
    if (!currency) throw new Error(CURRENCY_UNSET);
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO reservation_rate_night (reservation_id, stay_date, amount_minor, currency, rate_plan_id)
       VALUES (?, ?, ?, ?, ?)`,
      reservationId,
      stayDate,
      amount,
      currency,
      ratePlanId,
    );
    return amount;
  }

  /**
   * Snapshotted cancel/no-show penalty in ledger minor units.
   * Inquiry and type `none` are 0; in-grace is 0; missing rate_day throws RateMissingError.
   */
  private penaltyMinor(
    row: {
      reservation_id: string;
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
      return this.rateNightAmountSync(row.reservation_id, row.room_type_id, row.rate_plan_id, row.arrival_date);
    }
    if (row.cancel_penalty_type === 'nights') {
      const count = Math.min(row.cancel_penalty_nights ?? 0, nights.length);
      if (count < 1) throw new InvalidCancelPolicyError();
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += this.rateNightAmountSync(row.reservation_id, row.room_type_id, row.rate_plan_id, nights[i]!);
      }
      return total;
    }
    let stayTotal = 0;
    for (const stayDate of nights) {
      stayTotal += this.rateNightAmountSync(row.reservation_id, row.room_type_id, row.rate_plan_id, stayDate);
    }
    if (row.cancel_penalty_type === 'full') return stayTotal;
    if (row.cancel_penalty_type === 'percent') {
      const bps = row.cancel_penalty_bps ?? 0;
      return Number(roundHalfAwayFromZero(BigInt(stayTotal) * BigInt(bps), 10000n));
    }
    return 0;
  }

  private syncReservationRateNightsOnModifySync(
    reservationId: string,
    roomTypeId: string,
    ratePlanId: string,
    oldNights: string[],
    newNights: string[],
  ): void {
    const newSet = new Set(newNights);
    const oldSet = new Set(oldNights);
    for (const stayDate of oldNights) {
      if (newSet.has(stayDate)) continue;
      const consumed = this.ctx.storage.sql
        .exec(
          `SELECT 1 AS hit FROM folio_line
           WHERE reservation_id = ? AND business_date = ? AND charge_code IN ('ROOM', 'NO_SHOW')
           LIMIT 1`,
          reservationId,
          stayDate,
        )
        .toArray() as Array<{ hit: number }>;
      if (consumed[0]) continue;
      this.ctx.storage.sql.exec(
        `DELETE FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`,
        reservationId,
        stayDate,
      );
    }
    const added = newNights.filter((d) => !oldSet.has(d));
    if (added.length > 0) {
      const promoRows = this.ctx.storage.sql
        .exec(`SELECT promo_id FROM reservation WHERE reservation_id = ?`, reservationId)
        .toArray() as Array<{ promo_id: string | null }>;
      const promoId = promoRows[0]?.promo_id ?? null;
      const promoRow = this.resolveStoredPromoForSnapshotSync(promoId, ratePlanId, added);
      this.snapshotRateNightsSync(reservationId, roomTypeId, ratePlanId, added, promoRow);
    }
  }

  private resnapshotRateNightsForPlanChangeSync(
    reservationId: string,
    roomTypeId: string,
    ratePlanId: string,
    nights: string[],
  ): void {
    const reservable: string[] = [];
    for (const stayDate of nights) {
      const consumed = this.ctx.storage.sql
        .exec(
          `SELECT 1 AS hit FROM folio_line
           WHERE reservation_id = ? AND business_date = ? AND charge_code IN ('ROOM', 'NO_SHOW')
           LIMIT 1`,
          reservationId,
          stayDate,
        )
        .toArray() as Array<{ hit: number }>;
      if (!consumed[0]) reservable.push(stayDate);
    }
    for (const stayDate of reservable) {
      this.ctx.storage.sql.exec(
        `DELETE FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`,
        reservationId,
        stayDate,
      );
    }
    if (reservable.length === 0) return;
    const promoRows = this.ctx.storage.sql
      .exec(`SELECT promo_id FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ promo_id: string | null }>;
    const promoId = promoRows[0]?.promo_id ?? null;
    const promoRow = this.resolveStoredPromoForSnapshotSync(promoId, ratePlanId, reservable);
    this.snapshotRateNightsSync(reservationId, roomTypeId, ratePlanId, reservable, promoRow);
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

  private loadConstituentAvailabilityMapsSync(
    constituentIds: string[],
    nights: string[],
  ): Map<string, Map<string, ConstituentAvailabilityRow>> {
    const map = new Map<string, Map<string, ConstituentAvailabilityRow>>();
    for (const constituentId of constituentIds) {
      const byDate = new Map<string, ConstituentAvailabilityRow>();
      map.set(constituentId, byDate);
      for (const stayDate of nights) {
        const rows = this.ctx.storage.sql
          .exec(
            `SELECT physical, blocked, held, sold, oversell FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
            constituentId,
            stayDate,
          )
          .toArray() as Array<{
          physical: number;
          blocked: number;
          held: number;
          sold: number;
          oversell: number;
        }>;
        const row = rows[0];
        if (row) {
          byDate.set(stayDate, row);
        }
      }
    }
    return map;
  }

  private resolveInventoryCommitSync(input: {
    soldRoomTypeId: string;
    arrivalDate: string;
    departureDate: string;
    nights: string[];
  }): { allocatedRoomTypeId: string; ledgerRoomTypeId: string } {
    const kindRows = this.ctx.storage.sql
      .exec(`SELECT kind FROM room_type WHERE room_type_id = ?`, input.soldRoomTypeId)
      .toArray() as Array<{ kind: string }>;
    const kind = kindRows[0]?.kind ?? 'physical';
    if (kind === 'physical') {
      return { allocatedRoomTypeId: input.soldRoomTypeId, ledgerRoomTypeId: input.soldRoomTypeId };
    }

    this.restrictionFailureSync(input.soldRoomTypeId, input.arrivalDate, input.departureDate, input.nights);

    const constituents = this.readVirtualConstituentIdsSync(input.soldRoomTypeId);
    const availabilityByConstituent = this.loadConstituentAvailabilityMapsSync(constituents, input.nights);
    const result = allocateVirtualConstituent({
      nights: input.nights,
      constituentIds: constituents,
      availabilityByConstituent,
      restrictionClean: (constituentId) => {
        try {
          this.restrictionFailureSync(constituentId, input.arrivalDate, input.departureDate, input.nights);
          return true;
        } catch (e) {
          if (e instanceof RestrictionViolatedError) return false;
          throw e;
        }
      },
    });
    if (!result.ok) {
      if (result.error === 'restriction_violated') {
        for (const constituentId of constituents) {
          const freeEveryNight = input.nights.every((night) => {
            const row = availabilityByConstituent.get(constituentId)?.get(night);
            return row ? freeAvailability(row) >= 1 : false;
          });
          if (!freeEveryNight) continue;
          try {
            this.restrictionFailureSync(
              constituentId,
              input.arrivalDate,
              input.departureDate,
              input.nights,
            );
          } catch (e) {
            if (e instanceof RestrictionViolatedError) throw e;
            throw e;
          }
        }
      }
      throw new NoAvailabilityError(input.nights[0]!);
    }
    return { allocatedRoomTypeId: result.allocatedRoomTypeId, ledgerRoomTypeId: result.allocatedRoomTypeId };
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
        `SELECT status, confirm_by, expires_at, room_type_id, allocated_room_type_id, arrival_date, departure_date, guest_ref, pii_key_id
         FROM reservation WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{
      status: string;
      confirm_by: number | null;
      expires_at: number | null;
      room_type_id: string;
      allocated_room_type_id: string;
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
      const ledgerId = row.allocated_room_type_id || row.room_type_id;
      if (ledgerId) this.releaseSoldNightsSync(ledgerId, nights);
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
      const ledgerId = row.allocated_room_type_id || row.room_type_id;
      if (ledgerId) {
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'availability.changed',
          payload: { propertyId, roomTypeId: ledgerId, fromDate, toDate, version: ariVersion },
        });
      }
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
      promoCode?: string;
      confirmBy?: number;
      expiresAt?: number;
      noPost?: boolean;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number }
    | { ok: false; error: typeof UNBOOKABLE; date: string }
    | { ok: false; error: typeof RESTRICTION_VIOLATED; rule: string; date: string; required?: number }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
    | { ok: false; error: typeof ORG_UNREACHABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      return { ok: false, error: INVALID_DATE };
    }
    if (!input.guestRef) {
      return { ok: false, error: GUEST_REF_REQUIRED };
    }
    if (input.arrivalDate >= input.departureDate) {
      return { ok: false, error: INVALID_STAY_RANGE };
    }

    let nights: string[];
    try {
      nights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: INVALID_STAY_RANGE };
    }

    const guestGate = await this.gateGuestRef(orgId, input.guestRef);
    if (!guestGate.ok) return guestGate;
    const piiKeyId = guestGate.piiKeyId;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const status = input.status ?? 'confirmed';
          if (status !== 'inquiry' && status !== 'pending' && status !== 'confirmed') {
            throw new Error(INVALID_STATUS);
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
          let promoId: string | null;
          let promoRow: NonNullable<ReturnType<PropertyDO['loadPromoByIdSync']>> | null;
          try {
            ({ promoId, row: promoRow } = this.resolvePromoForBookSync(
              input.promoCode,
              ratePlanId,
              nights,
            ));
          } catch (e) {
            if (e instanceof PromoNotFoundError) {
              return { ok: false as const, error: PROMO_NOT_FOUND };
            }
            if (e instanceof PromoNotApplicableError) {
              return { ok: false as const, error: PROMO_NOT_APPLICABLE };
            }
            throw e;
          }

          const commitsInventory = status === 'pending' || status === 'confirmed';
          let allocatedRoomTypeId = '';
          let ledgerRoomTypeId = input.roomTypeId;
          if (commitsInventory) {
            const commit = this.resolveInventoryCommitSync({
              soldRoomTypeId: input.roomTypeId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
              nights,
            });
            allocatedRoomTypeId = commit.allocatedRoomTypeId;
            ledgerRoomTypeId = commit.ledgerRoomTypeId;
            this.commitSoldNightsSync(ledgerRoomTypeId, input.arrivalDate, input.departureDate, nights);
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
               status, adults, children, rate_plan_id, promo_id, cancel_penalty_type, cancel_grace_hours,
               cancel_penalty_nights, cancel_penalty_bps, confirm_by, expires_at, no_post,
               allocated_room_type_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            promoId,
            snapshot.cancelPenaltyType,
            snapshot.cancelGraceHours,
            snapshot.cancelPenaltyNights,
            snapshot.cancelPenaltyBps,
            confirmBy,
            expiresAt,
            input.noPost === true ? 1 : 0,
            allocatedRoomTypeId,
            now,
            now,
          );
          if (commitsInventory) {
            this.snapshotRateNightsSync(
              input.reservationId,
              input.roomTypeId,
              ratePlanId,
              nights,
              promoRow,
            );
          }
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
              payload: { propertyId, roomTypeId: ledgerRoomTypeId, fromDate, toDate, version: ariVersion },
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryConfirm(
    actor: ActorContext,
    input: { reservationId: string; ratePlanId?: string; noPost?: boolean },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NOT_FOUND | typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED | typeof INVALID_STATUS_TRANSITION | typeof NO_AVAILABILITY; date?: string; ariVersion?: number }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, promo_id, adults, children
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
            promo_id: string | null;
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
          let ledgerRoomTypeId = reservation.room_type_id;
          if (fromInquiry) {
            this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children);
            const commit = this.resolveInventoryCommitSync({
              soldRoomTypeId: reservation.room_type_id,
              arrivalDate: reservation.arrival_date,
              departureDate: reservation.departure_date,
              nights,
            });
            ledgerRoomTypeId = commit.ledgerRoomTypeId;
            this.commitSoldNightsSync(
              ledgerRoomTypeId,
              reservation.arrival_date,
              reservation.departure_date,
              nights,
            );
            const snapshot = this.snapshotPenaltyFromPlanSync(ratePlanId);
            const promoRow = this.resolveStoredPromoForSnapshotSync(
              reservation.promo_id,
              ratePlanId,
              nights,
            );
            this.snapshotRateNightsSync(
              input.reservationId,
              reservation.room_type_id,
              ratePlanId,
              nights,
              promoRow,
            );
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET status = 'confirmed', rate_plan_id = ?, cancel_penalty_type = ?,
               cancel_grace_hours = ?, cancel_penalty_nights = ?, cancel_penalty_bps = ?,
               confirm_by = NULL, expires_at = NULL, allocated_room_type_id = ?, updated_at = ?
               WHERE reservation_id = ?`,
              ratePlanId,
              snapshot.cancelPenaltyType,
              snapshot.cancelGraceHours,
              snapshot.cancelPenaltyNights,
              snapshot.cancelPenaltyBps,
              commit.allocatedRoomTypeId,
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
          this.applyNoPostIfPresentSync(input.reservationId, input.noPost);
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
              payload: { propertyId, roomTypeId: ledgerRoomTypeId, fromDate, toDate, version: ariVersion },
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryHold(
    actor: ActorContext,
    input: { reservationId: string; ratePlanId?: string; confirmBy?: number; noPost?: boolean },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NOT_FOUND | typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED | typeof INVALID_STATUS_TRANSITION | typeof NO_AVAILABILITY; date?: string; ariVersion?: number }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
              `SELECT room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, promo_id, adults, children
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
            promo_id: string | null;
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
          const commit = this.resolveInventoryCommitSync({
            soldRoomTypeId: reservation.room_type_id,
            arrivalDate: reservation.arrival_date,
            departureDate: reservation.departure_date,
            nights,
          });
          const ledgerRoomTypeId = commit.ledgerRoomTypeId;
          this.commitSoldNightsSync(
            ledgerRoomTypeId,
            reservation.arrival_date,
            reservation.departure_date,
            nights,
          );
          const snapshot = this.snapshotPenaltyFromPlanSync(ratePlanId);
          const promoRow = this.resolveStoredPromoForSnapshotSync(
            reservation.promo_id,
            ratePlanId,
            nights,
          );
          this.snapshotRateNightsSync(
            input.reservationId,
            reservation.room_type_id,
            ratePlanId,
            nights,
            promoRow,
          );
          const now = Date.now();
          const holdHours = Number(this.readConfigValueSync('pms.reservations.pending_hold_hours') ?? 24);
          const confirmBy = input.confirmBy ?? now + holdHours * 3600_000;
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'pending', rate_plan_id = ?, cancel_penalty_type = ?,
             cancel_grace_hours = ?, cancel_penalty_nights = ?, cancel_penalty_bps = ?,
             confirm_by = ?, expires_at = NULL, allocated_room_type_id = ?, updated_at = ? WHERE reservation_id = ?`,
            ratePlanId,
            snapshot.cancelPenaltyType,
            snapshot.cancelGraceHours,
            snapshot.cancelPenaltyNights,
            snapshot.cancelPenaltyBps,
            confirmBy,
            commit.allocatedRoomTypeId,
            now,
            input.reservationId,
          );
          this.applyNoPostIfPresentSync(input.reservationId, input.noPost);
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
            payload: { propertyId, roomTypeId: ledgerRoomTypeId, fromDate, toDate, version: ariVersion },
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
              `SELECT room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status,
                      rate_plan_id, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            allocated_room_type_id: string;
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
            const penalty = this.penaltyMinor(
              { ...reservation, reservation_id: input.reservationId },
              Date.now(),
              timeZone,
            );
            if (penalty > 0) {
              const businessDate = this.readBusinessDateSync();
              if (!businessDate) return { ok: false as const, error: BUSINESS_DATE_UNSET };
              this.postDeskPenaltySync(input.reservationId, 'CANCEL', penalty, businessDate);
            }
          }

          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const commitsInventory = reservation.status === 'confirmed' || reservation.status === 'pending';
          const ledgerId = reservation.allocated_room_type_id || reservation.room_type_id;
          if (commitsInventory && ledgerId) {
            this.releaseSoldNightsSync(ledgerId, nights);
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
                roomTypeId: ledgerId,
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Change a confirmed reservation's room type and/or stay dates by releasing sold on
   * old nights and acquiring on new nights in one atomic write. Implements catalog
   * `reservations.modify`. Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate, adults?, children?, ratePlanId?, noPost? }`.
   */
  async tryModifyReservation(
    actor: ActorContext,
    input: {
      reservationId: string;
      roomTypeId: string;
      arrivalDate: string;
      departureDate: string;
      adults?: number;
      children?: number;
      ratePlanId?: string;
      noPost?: boolean;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number }
    | { ok: false; error: typeof UNBOOKABLE; date: string }
    | { ok: false; error: typeof NOT_MODIFIABLE }
    | { ok: false; error: typeof LEDGER_INCONSISTENT; date: string }
    | { ok: false; error: typeof RESTRICTION_VIOLATED; rule: string; date: string; required?: number }
    | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
    | { ok: false; error: typeof ROOM_ALREADY_ASSIGNED }
    | { ok: false; error: typeof ROOM_TYPE_MISMATCH }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      return { ok: false, error: INVALID_DATE };
    }
    if (input.arrivalDate >= input.departureDate) {
      return { ok: false, error: INVALID_STAY_RANGE };
    }

    let newNights: string[];
    try {
      newNights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: INVALID_STAY_RANGE };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredErr = this.expiredWire(expired);
          if (expiredErr) return expiredErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, rate_plan_id, room_id, adults, children, no_post FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            allocated_room_type_id: string;
            guest_ref: string;
            pii_key_id: string;
            arrival_date: string;
            departure_date: string;
            status: string;
            rate_plan_id: string;
            room_id: string | null;
            adults: number;
            children: number;
            no_post: number;
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

          const nextRatePlanId = input.ratePlanId ?? reservation.rate_plan_id;
          if (input.ratePlanId !== undefined) {
            this.assertActiveRatePlanSync(input.ratePlanId);
          }

          const nextAdults = input.adults ?? reservation.adults;
          const nextChildren = input.children ?? reservation.children;
          this.assertOccupancySync(input.roomTypeId, nextAdults, nextChildren);

          this.applyNoPostIfPresentSync(input.reservationId, input.noPost);

          const nextNoPost =
            input.noPost !== undefined ? input.noPost : reservation.no_post === 1;

          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate &&
            nextAdults === reservation.adults &&
            nextChildren === reservation.children &&
            nextRatePlanId === reservation.rate_plan_id &&
            nextNoPost === (reservation.no_post === 1)
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

          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate &&
            nextAdults === reservation.adults &&
            nextChildren === reservation.children &&
            nextRatePlanId !== reservation.rate_plan_id
          ) {
            const nowPlan = Date.now();
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET rate_plan_id = ?, updated_at = ? WHERE reservation_id = ?`,
              nextRatePlanId,
              nowPlan,
              input.reservationId,
            );
            const nights = enumerateStayDates(input.arrivalDate, input.departureDate);
            this.resnapshotRateNightsForPlanChangeSync(
              input.reservationId,
              input.roomTypeId,
              nextRatePlanId,
              nights,
            );
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
                  adults: reservation.adults,
                  children: reservation.children,
                  ratePlanId: reservation.rate_plan_id,
                },
                to: {
                  roomTypeId: input.roomTypeId,
                  arrivalDate: input.arrivalDate,
                  departureDate: input.departureDate,
                  adults: nextAdults,
                  children: nextChildren,
                  ratePlanId: nextRatePlanId,
                },
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.modify',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { ratePlanId: reservation.rate_plan_id },
              afterJson: { ratePlanId: nextRatePlanId },
              reservationId: input.reservationId,
            });
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: this.readAriVersionSync(),
              fromDate: nights[0]!,
              toDate: nights[nights.length - 1]!,
            };
          }

          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate &&
            nextAdults === reservation.adults &&
            nextChildren === reservation.children &&
            nextRatePlanId === reservation.rate_plan_id &&
            input.noPost !== undefined &&
            nextNoPost !== (reservation.no_post === 1)
          ) {
            const nights = enumerateStayDates(input.arrivalDate, input.departureDate);
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
                  adults: reservation.adults,
                  children: reservation.children,
                  noPost: reservation.no_post === 1,
                },
                to: {
                  roomTypeId: input.roomTypeId,
                  arrivalDate: input.arrivalDate,
                  departureDate: input.departureDate,
                  adults: nextAdults,
                  children: nextChildren,
                  noPost: nextNoPost,
                },
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.modify',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { noPost: reservation.no_post === 1 },
              afterJson: { noPost: nextNoPost },
              reservationId: input.reservationId,
            });
            return {
              ok: true as const,
              reservationId: input.reservationId,
              ariVersion: this.readAriVersionSync(),
              fromDate: nights[0]!,
              toDate: nights[nights.length - 1]!,
            };
          }

          if (
            reservation.room_type_id === input.roomTypeId &&
            reservation.arrival_date === input.arrivalDate &&
            reservation.departure_date === input.departureDate
          ) {
            const nowParty = Date.now();
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET adults = ?, children = ?, updated_at = ? WHERE reservation_id = ?`,
              nextAdults,
              nextChildren,
              nowParty,
              input.reservationId,
            );
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
                  adults: reservation.adults,
                  children: reservation.children,
                },
                to: {
                  roomTypeId: input.roomTypeId,
                  arrivalDate: input.arrivalDate,
                  departureDate: input.departureDate,
                  adults: nextAdults,
                  children: nextChildren,
                },
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'reservations.modify',
              entityType: 'reservation',
              entityId: input.reservationId,
              beforeJson: { adults: reservation.adults, children: reservation.children },
              afterJson: { adults: nextAdults, children: nextChildren },
              reservationId: input.reservationId,
            });
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

          if (reservation.room_id) {
            const allocatedRoomTypeId =
              reservation.allocated_room_type_id || reservation.room_type_id;
            this.assertRoomAssignableSync(reservation.room_id, {
              reservationId: input.reservationId,
              allocatedRoomTypeId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
            });
          }

          const oldNights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const oldRoomTypeId = reservation.room_type_id;
          const oldNightSet = new Set(oldNights);
          const commitsInventory = reservation.status !== 'inquiry';
          const allocatedId = reservation.allocated_room_type_id || reservation.room_type_id;
          const soldSkuChanged = reservation.room_type_id !== input.roomTypeId;
          let nextAllocatedRoomTypeId = allocatedId;
          let newLedgerRoomTypeId = allocatedId;
          let oldLedgerRoomTypeId = allocatedId;

          if (commitsInventory) {
            if (!soldSkuChanged && reservation.room_type_id === input.roomTypeId) {
              for (const stayDate of oldNights) {
                const rows = this.ctx.storage.sql
                  .exec(
                    `SELECT sold FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
                    allocatedId,
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
                    allocatedId,
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
                const releasedSold = oldNightSet.has(stayDate) ? row.sold - 1 : row.sold;
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
                  allocatedId,
                  stayDate,
                );
              }

              for (const stayDate of newNights) {
                this.ctx.storage.sql.exec(
                  `UPDATE availability_day SET sold = sold + 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
                  allocatedId,
                  stayDate,
                );
              }
            } else {
              oldLedgerRoomTypeId = allocatedId;
              if (oldLedgerRoomTypeId) {
                this.releaseSoldNightsSync(oldLedgerRoomTypeId, oldNights);
              }

              const commit = this.resolveInventoryCommitSync({
                soldRoomTypeId: input.roomTypeId,
                arrivalDate: input.arrivalDate,
                departureDate: input.departureDate,
                nights: newNights,
              });
              nextAllocatedRoomTypeId = commit.allocatedRoomTypeId;
              newLedgerRoomTypeId = commit.ledgerRoomTypeId;
              this.commitSoldNightsSync(
                newLedgerRoomTypeId,
                input.arrivalDate,
                input.departureDate,
                newNights,
              );
            }
          }

          const now = Date.now();
          if (soldSkuChanged) {
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET room_type_id = ?, allocated_room_type_id = ?, arrival_date = ?, departure_date = ?,
               adults = COALESCE(?, adults), children = COALESCE(?, children),
               rate_plan_id = COALESCE(?, rate_plan_id), updated_at = ?
               WHERE reservation_id = ?`,
              input.roomTypeId,
              nextAllocatedRoomTypeId,
              input.arrivalDate,
              input.departureDate,
              input.adults ?? null,
              input.children ?? null,
              input.ratePlanId ?? null,
              now,
              input.reservationId,
            );
          } else {
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET room_type_id = ?, arrival_date = ?, departure_date = ?,
               adults = COALESCE(?, adults), children = COALESCE(?, children),
               rate_plan_id = COALESCE(?, rate_plan_id), updated_at = ?
               WHERE reservation_id = ?`,
              input.roomTypeId,
              input.arrivalDate,
              input.departureDate,
              input.adults ?? null,
              input.children ?? null,
              input.ratePlanId ?? null,
              now,
              input.reservationId,
            );
          }

          if (commitsInventory) {
            this.syncReservationRateNightsOnModifySync(
              input.reservationId,
              input.roomTypeId,
              nextRatePlanId,
              oldNights,
              newNights,
            );
            if (nextRatePlanId !== reservation.rate_plan_id) {
              this.resnapshotRateNightsForPlanChangeSync(
                input.reservationId,
                input.roomTypeId,
                nextRatePlanId,
                newNights,
              );
            }
          }

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
            if (!soldSkuChanged) {
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'availability.changed',
                payload: {
                  propertyId,
                  roomTypeId: newLedgerRoomTypeId,
                  fromDate: unionFrom,
                  toDate: unionTo,
                  version: ariVersion,
                },
              });
            } else {
              if (oldLedgerRoomTypeId) {
                this.appendPropertyOutbox({
                  eventId: crypto.randomUUID(),
                  eventType: 'availability.changed',
                  payload: {
                    propertyId,
                    roomTypeId: oldLedgerRoomTypeId,
                    fromDate: oldNights[0]!,
                    toDate: oldNights[oldNights.length - 1]!,
                    version: ariVersion,
                  },
                });
              }
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'availability.changed',
                payload: {
                  propertyId,
                  roomTypeId: newLedgerRoomTypeId,
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private pickAutoAssignRoomSync(
    reservation: {
      reservation_id: string;
      room_type_id: string;
      allocated_room_type_id: string;
      arrival_date: string;
      departure_date: string;
    },
    input: { overrideCleanliness?: boolean },
  ): string | null {
    const allocatedRoomTypeId = reservation.allocated_room_type_id || reservation.room_type_id;
    const candidates = this.ctx.storage.sql
      .exec(
        `SELECT room_id, status FROM room WHERE room_type_id = ? AND archived_at IS NULL ORDER BY code ASC`,
        allocatedRoomTypeId,
      )
      .toArray() as Array<{ room_id: string; status: string }>;

    const cleanliness = this.readConfigValueSync('pms.reservations.check_in_cleanliness') ?? 'strict';
    const allowDirtyOverride =
      this.readConfigValueSync('pms.reservations.allow_dirty_check_in_override') !== false;
    const requireInspection =
      this.readConfigValueSync('pms.housekeeping.require_inspection') === true;

    for (const candidate of candidates) {
      try {
        this.assertRoomAssignableSync(candidate.room_id, {
          reservationId: reservation.reservation_id,
          allocatedRoomTypeId,
          arrivalDate: reservation.arrival_date,
          departureDate: reservation.departure_date,
        });
      } catch {
        continue;
      }
      if (
        candidate.status === 'dirty' &&
        cleanliness === 'strict' &&
        !(input.overrideCleanliness === true && allowDirtyOverride)
      ) {
        continue;
      }
      if (
        requireInspection &&
        cleanliness === 'strict' &&
        candidate.status === 'clean' &&
        !(input.overrideCleanliness === true && allowDirtyOverride)
      ) {
        continue;
      }
      return candidate.room_id;
    }
    return null;
  }

  /**
   * Check in a confirmed reservation. Implements catalog `reservations.check_in`.
   * Fingerprint: `{ reservationId, roomId?, overrideCleanliness? }`.
   */
  async tryCheckIn(
    actor: ActorContext,
    input: { reservationId: string; roomId?: string; overrideCleanliness?: boolean },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof ROOM_REQUIRED }
    | { ok: false; error: typeof ROOM_NOT_READY }
    | { ok: false; error: typeof ROOM_OUT_OF_ORDER }
    | { ok: false; error: typeof ROOM_ALREADY_ASSIGNED }
    | { ok: false; error: typeof ROOM_TYPE_MISMATCH }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
              `SELECT guest_ref, pii_key_id, status, room_id, room_type_id, allocated_room_type_id, arrival_date, departure_date, adults, children
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            guest_ref: string;
            pii_key_id: string;
            status: string;
            room_id: string | null;
            room_type_id: string;
            allocated_room_type_id: string;
            arrival_date: string;
            departure_date: string;
            adults: number;
            children: number;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'confirmed') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }

          let resolvedRoomId = input.roomId ?? reservation.room_id ?? null;
          let autoAssigned = false;

          if (!resolvedRoomId) {
            if (this.readConfigValueSync('pms.ops.auto_assign_rooms') === true) {
              const picked = this.pickAutoAssignRoomSync(
                { ...reservation, reservation_id: input.reservationId },
                input,
              );
              if (picked) {
                resolvedRoomId = picked;
                autoAssigned = true;
              }
            }
          }

          if (!resolvedRoomId) throw new RoomRequiredError();

          if (resolvedRoomId !== reservation.room_id) {
            const allocatedRoomTypeId =
              reservation.allocated_room_type_id || reservation.room_type_id;
            this.assertRoomAssignableSync(resolvedRoomId, {
              reservationId: input.reservationId,
              allocatedRoomTypeId,
              arrivalDate: reservation.arrival_date,
              departureDate: reservation.departure_date,
            });
            const nowAssign = Date.now();
            const previousRoomId = reservation.room_id;
            this.ctx.storage.sql.exec(
              `UPDATE reservation SET room_id = ?, updated_at = ? WHERE reservation_id = ?`,
              resolvedRoomId,
              nowAssign,
              input.reservationId,
            );
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'reservation.room_assigned',
              payload: {
                propertyId,
                reservationId: input.reservationId,
                roomId: resolvedRoomId,
                previousRoomId,
              },
            });
          }

          this.assertOccupancySync(reservation.room_type_id, reservation.adults, reservation.children);

          const roomRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room WHERE room_id = ?`, resolvedRoomId)
            .toArray() as Array<{ status: string }>;
          const room = roomRows[0];
          if (!room) throw new RoomNotFoundError();
          if (room.status === 'out_of_order') throw new RoomOutOfOrderError();
          const oooHit = this.ctx.storage.sql
            .exec(
              `SELECT ooo_id FROM room_ooo
                WHERE room_id = ?
                  AND start_date < ?
                  AND end_date > ?
                LIMIT 1`,
              resolvedRoomId,
              reservation.departure_date,
              reservation.arrival_date,
            )
            .toArray();
          if (oooHit.length > 0) throw new RoomOutOfOrderError();
          const cleanliness = this.readConfigValueSync('pms.reservations.check_in_cleanliness') ?? 'strict';
          const allowDirtyOverride =
            this.readConfigValueSync('pms.reservations.allow_dirty_check_in_override') !== false;
          if (
            room.status === 'dirty' &&
            cleanliness === 'strict' &&
            !(input.overrideCleanliness === true && allowDirtyOverride)
          ) {
            throw new RoomNotReadyError();
          }
          const requireInspection =
            this.readConfigValueSync('pms.housekeeping.require_inspection') === true;
          if (
            requireInspection &&
            cleanliness === 'strict' &&
            room.status === 'clean' &&
            !(input.overrideCleanliness === true && allowDirtyOverride)
          ) {
            throw new RoomNotReadyError();
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

          this.appendAuditLogSync({
            actor: this.auditActorForCommandSync(actor, provisional),
            commandId: 'reservations.check_in',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: 'confirmed', roomId: reservation.room_id },
            afterJson: {
              status: 'checked_in',
              roomId: resolvedRoomId,
              ...(input.overrideCleanliness ? { overrideCleanliness: true } : {}),
              ...(autoAssigned ? { autoAssigned: true } : {}),
            },
            reservationId: input.reservationId,
          });

          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RoomNotFoundError) return { ok: false, error: NOT_FOUND };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Check out a checked-in reservation. Implements catalog `reservations.check_out`.
   * Fingerprint: `{ reservationId, overrideBalance? }`.
   */
  async tryCheckOut(
    actor: ActorContext,
    input: { reservationId: string; overrideBalance?: boolean },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string; autoCapture: CheckOutAutoCapture }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof BALANCE_DUE }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    const prior = this.ctx.storage.sql
      .exec(`SELECT request_fingerprint FROM idempotency WHERE key = ?`, idem.key)
      .toArray() as Array<{ request_fingerprint: string }>;
    const cacheHit = Boolean(prior[0] && prior[0].request_fingerprint === idem.fingerprint);

    try {
      const result = this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const expiredTouch = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredTouchErr = this.expiredWire(expiredTouch);
          if (expiredTouchErr) return expiredTouchErr;
          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT guest_ref, pii_key_id, status, room_id FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            guest_ref: string;
            pii_key_id: string;
            status: string;
            room_id: string | null;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (reservation.status !== 'checked_in') {
            return { ok: false as const, error: INVALID_STATUS_TRANSITION };
          }

          const guestWindowId = this.guestFolioWindowId(input.reservationId);
          const balanceMinor = this.windowBalanceMinorSync(guestWindowId);
          const requireZero =
            this.readConfigValueSync('pms.reservations.check_out_require_zero_balance') !== false;
          const allowOverride =
            this.readConfigValueSync('pms.reservations.allow_balance_override') !== false;
          if (requireZero && balanceMinor > 0 && !(input.overrideBalance === true && allowOverride)) {
            throw new BalanceDueError(balanceMinor);
          }

          if (this.readConfigValueSync('pms.invoice.gen_mode') === 'Automatically') {
            const guestWindowId = this.guestFolioWindowId(input.reservationId);
            if (!this.hasActiveInvoiceForWindowSync(input.reservationId, guestWindowId)) {
              throw new InvoiceRequiredError();
            }
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'checked_out', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );

          if (reservation.room_id) {
            const roomRows = this.ctx.storage.sql
              .exec(`SELECT status FROM room WHERE room_id = ?`, reservation.room_id)
              .toArray() as Array<{ status: string }>;
            const fromStatus = roomRows[0]?.status ?? 'clean';
            if (fromStatus !== 'out_of_order') {
              this.ctx.storage.sql.exec(
                `UPDATE room SET status = 'dirty', updated_at = ? WHERE room_id = ?`,
                now,
                reservation.room_id,
              );
              this.appendPropertyOutbox({
                eventId: crypto.randomUUID(),
                eventType: 'room.status_changed',
                payload: {
                  propertyId,
                  roomId: reservation.room_id,
                  fromStatus,
                  toStatus: 'dirty',
                },
              });
            }
          }

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

          if (balanceMinor > 0) {
            const currency = this.readStoredLedgerCurrencySync();
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'folio.balance_due',
              payload: {
                propertyId,
                reservationId: input.reservationId,
                balanceMinor,
                currency,
                overridden: Boolean(input.overrideBalance && allowOverride),
              },
            });
          }

          this.appendAuditLogSync({
            actor: this.auditActorForCommandSync(actor, provisional),
            commandId: 'reservations.check_out',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: { status: 'checked_in', roomId: reservation.room_id },
            afterJson: {
              status: 'checked_out',
              roomId: reservation.room_id,
              ...(input.overrideBalance ? { overrideBalance: true } : {}),
            },
            reservationId: input.reservationId,
          });

          for (const row of this.listCompanyFolioWindowsForReservationSync(input.reservationId)) {
            const syncResult = this.syncCityLedgerArForWindowSync({
              folioWindowId: row.folio_window_id,
              source: 'check_out',
              actor,
            });
            if (!syncResult.ok) throw new CityLedgerError(syncResult.error);
          }

          if (this.readConfigValueSync('pms.folio.close_window_on_check_out') === true && balanceMinor === 0) {
            const guestWindow = this.readFolioWindowRowSync(guestWindowId);
            if (guestWindow?.status === 'OPEN') {
              this.closeFolioWindowSync(guestWindowId, now, propertyId, input.reservationId);
            }
          }

          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
      if (!result.ok) return result;
      const autoCapture = await this.resolveCheckOutAutoCapture({
        cacheHit,
        provisional: Boolean(provisional),
        reservationId: input.reservationId,
        actor,
      });
      return { ...result, autoCapture };
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private async resolveCheckOutAutoCapture(input: {
    cacheHit: boolean;
    provisional: boolean;
    reservationId: string;
    actor: ActorContext;
  }): Promise<CheckOutAutoCapture> {
    const enabled = this.readConfigValueSync('pms.folio.auto_capture_on_check_out') === true;
    if (!enabled) return 'disabled';
    if (input.provisional) return 'skipped';
    if (input.cacheHit) return this.recomputeCheckOutAutoCapture(input.reservationId);
    try {
      const captured = await this.captureDueHoldsAfterCheckout(input.actor, input.reservationId);
      return captured.length > 0 ? 'captured' : 'skipped';
    } catch {
      return 'failed';
    }
  }

  private recomputeCheckOutAutoCapture(reservationId: string): CheckOutAutoCapture {
    const captured = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS hit FROM payment
         WHERE reservation_id = ? AND status = 'captured' AND purpose = 'STAY'
         LIMIT 1`,
        reservationId,
      )
      .toArray();
    if (captured[0]) return 'captured';
    const authorized = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS hit FROM payment
         WHERE reservation_id = ? AND status = 'authorized' AND purpose = 'STAY'
         LIMIT 1`,
        reservationId,
      )
      .toArray();
    if (authorized[0]) return 'failed';
    return 'skipped';
  }

  /** Same capture seam as `folio.capture_due`, but skips permission re-entry (check-out already gated `reservations:write`). */
  private async captureDueHoldsAfterCheckout(actor: ActorContext, reservationId: string): Promise<string[]> {
    return this.captureDueHoldsInner(actor, reservationId, { skipGates: true, throwOnFailure: true });
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
              `SELECT room_type_id, allocated_room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status,
                      rate_plan_id, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            room_type_id: string;
            allocated_room_type_id: string;
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
          const penalty = this.penaltyMinor(
            { ...reservation, reservation_id: input.reservationId },
            Date.now(),
            timeZone,
          );
          if (penalty > 0) {
            this.postDeskPenaltySync(input.reservationId, 'NO_SHOW', penalty, businessDate);
          }

          const nights = enumerateStayDates(reservation.arrival_date, reservation.departure_date);
          const ledgerId = reservation.allocated_room_type_id || reservation.room_type_id;
          if (ledgerId) this.releaseSoldNightsSync(ledgerId, nights);

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
              roomTypeId: ledgerId,
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Front-office comment, VIP flag, DND flag, no-post. Implements catalog `reservations.update_status`.
   * Fingerprint: `{ reservationId, frontOfficeComment?, vipFlag?, dndFlag?, noPost? }`. QUEUE_PROVISIONAL, ungated.
   */
  async tryUpdateFrontOffice(
    actor: ActorContext,
    input: {
      reservationId: string;
      frontOfficeComment?: string;
      vipFlag?: boolean;
      dndFlag?: boolean;
      noPost?: boolean;
    },
    idem: IdempotencyKey,
    provisional?: ProvisionalContext,
  ): Promise<
    | { ok: true; reservationId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof NOT_MODIFIABLE }
    | { ok: false; error: typeof FRONT_OFFICE_COMMENT_TOO_LONG }
    | { ok: false; error: typeof HOLD_EXPIRED | typeof INQUIRY_EXPIRED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertProvisionalBusinessDateOpen(provisional);
          const expired = this.expireIfDueSync(input.reservationId, Date.now());
          const expiredErr = this.expiredWire(expired);
          if (expiredErr) return expiredErr;

          const resRows = this.ctx.storage.sql
            .exec(
              `SELECT guest_ref, pii_key_id, status, front_office_comment, vip_flag, dnd_flag, no_post
               FROM reservation WHERE reservation_id = ?`,
              input.reservationId,
            )
            .toArray() as Array<{
            guest_ref: string;
            pii_key_id: string;
            status: string;
            front_office_comment: string | null;
            vip_flag: number;
            dnd_flag: number;
            no_post: number;
          }>;
          const reservation = resRows[0];
          if (!reservation) return { ok: false as const, error: NOT_FOUND };
          if (
            reservation.status === 'cancelled' ||
            reservation.status === 'no_show' ||
            reservation.status === 'checked_out'
          ) {
            return { ok: false as const, error: NOT_MODIFIABLE };
          }

          const nextComment =
            input.frontOfficeComment !== undefined ? input.frontOfficeComment : reservation.front_office_comment;
          const nextVip = input.vipFlag !== undefined ? (input.vipFlag ? 1 : 0) : reservation.vip_flag;
          const nextDnd = input.dndFlag !== undefined ? (input.dndFlag ? 1 : 0) : reservation.dnd_flag;
          const nextNoPost = input.noPost !== undefined ? (input.noPost ? 1 : 0) : reservation.no_post;
          if (typeof nextComment === 'string' && nextComment.length > 2000) {
            throw new FrontOfficeCommentTooLongError();
          }
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET front_office_comment = ?, vip_flag = ?, dnd_flag = ?, no_post = ?, updated_at = ? WHERE reservation_id = ?`,
            nextComment,
            nextVip,
            nextDnd,
            nextNoPost,
            now,
            input.reservationId,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'reservation.front_office_updated',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              guestRef: reservation.guest_ref,
              piiKeyId: reservation.pii_key_id,
              frontOfficeComment: nextComment,
              vipFlag: nextVip === 1,
              dndFlag: nextDnd === 1,
              noPost: nextNoPost === 1,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorForCommandSync(actor, provisional),
            commandId: 'reservations.update_status',
            entityType: 'reservation',
            entityId: input.reservationId,
            beforeJson: {
              frontOfficeComment: reservation.front_office_comment,
              vipFlag: reservation.vip_flag === 1,
              dndFlag: reservation.dnd_flag === 1,
              noPost: reservation.no_post === 1,
            },
            afterJson: {
              frontOfficeComment: nextComment,
              vipFlag: nextVip === 1,
              dndFlag: nextDnd === 1,
              noPost: nextNoPost === 1,
            },
            reservationId: input.reservationId,
          });
          return { ok: true as const, reservationId: input.reservationId };
        }),
      );
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
          adults: number;
          children: number;
          frontOfficeComment: string | null;
          vipFlag: boolean;
          dndFlag: boolean;
          ratePlanId: string;
          promoId: string | null;
          cancelPenaltyType: string;
          confirmBy: number | null;
          expiresAt: number | null;
          allocatedRoomTypeId: string;
          createdAt: number;
          updatedAt: number;
        };
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, room_id,
                adults, children, front_office_comment, vip_flag, dnd_flag, rate_plan_id, promo_id, cancel_penalty_type,
                confirm_by, expires_at, allocated_room_type_id, created_at, updated_at
         FROM reservation WHERE reservation_id = ?`,
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
      adults: number;
      children: number;
      front_office_comment: string | null;
      vip_flag: number;
      dnd_flag: number;
      rate_plan_id: string;
      promo_id: string | null;
      cancel_penalty_type: string;
      confirm_by: number | null;
      expires_at: number | null;
      allocated_room_type_id: string;
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
        adults: row.adults,
        children: row.children,
        frontOfficeComment: row.front_office_comment,
        vipFlag: row.vip_flag === 1,
        dndFlag: row.dnd_flag === 1,
        ratePlanId: row.rate_plan_id,
        promoId: row.promo_id ?? null,
        cancelPenaltyType: row.cancel_penalty_type,
        confirmBy: row.confirm_by,
        expiresAt: row.expires_at,
        allocatedRoomTypeId: row.allocated_room_type_id,
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
    adults: number;
    children: number;
    front_office_comment: string | null;
    vip_flag: number;
    dnd_flag: number;
    confirm_by: number | null;
    rate_plan_id: string;
  }) {
    return {
      reservationId: row.reservation_id,
      roomTypeId: row.room_type_id,
      guestRef: row.guest_ref,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
      status: row.status,
      roomId: row.room_id,
      adults: row.adults,
      children: row.children,
      frontOfficeComment: row.front_office_comment,
      vipFlag: row.vip_flag === 1,
      dndFlag: row.dnd_flag === 1,
      confirmBy: row.confirm_by,
      ratePlanId: row.rate_plan_id,
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
          adults: number;
          children: number;
          frontOfficeComment: string | null;
          vipFlag: boolean;
          dndFlag: boolean;
          confirmBy: number | null;
          ratePlanId: string;
        }>;
        nextCursor: { reservationId: string } | null;
      }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
             FROM reservation
             WHERE arrival_date = ? AND status IN ('confirmed', 'pending') AND reservation_id > ?
             ORDER BY reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
             FROM reservation
             WHERE arrival_date = ? AND status IN ('confirmed', 'pending')
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
      adults: number;
      children: number;
      front_office_comment: string | null;
      vip_flag: number;
      dnd_flag: number;
      confirm_by: number | null;
      rate_plan_id: string;
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
          adults: number;
          children: number;
          frontOfficeComment: string | null;
          vipFlag: boolean;
          dndFlag: boolean;
          confirmBy: number | null;
          ratePlanId: string;
        }>;
        nextCursor: { status: string; reservationId: string } | null;
      }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
             FROM reservation
             WHERE departure_date = ?
               AND (status > ? OR (status = ? AND reservation_id > ?))
             ORDER BY status ASC, reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
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
      adults: number;
      children: number;
      front_office_comment: string | null;
      vip_flag: number;
      dnd_flag: number;
      confirm_by: number | null;
      rate_plan_id: string;
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
          adults: number;
          children: number;
          frontOfficeComment: string | null;
          vipFlag: boolean;
          dndFlag: boolean;
          confirmBy: number | null;
          ratePlanId: string;
        }>;
        nextCursor: { departureDate: string; reservationId: string } | null;
      }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    const limit = this.clampFrontDeskLimit(opts?.limit);
    const cursor = opts?.cursor ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        cursor
          ? `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
             FROM reservation
             WHERE status = 'checked_in'
               AND (departure_date > ? OR (departure_date = ? AND reservation_id > ?))
             ORDER BY departure_date ASC, reservation_id ASC
             LIMIT ?`
          : `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
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
      adults: number;
      children: number;
      front_office_comment: string | null;
      vip_flag: number;
      dnd_flag: number;
      confirm_by: number | null;
      rate_plan_id: string;
    }>;
    const items = rows.map((row) => this.mapFrontDeskListRow(row));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? { departureDate: last.departureDate, reservationId: last.reservationId }
        : null;
    return { ok: true, items, nextCursor };
  }

  /** Sync SQL search candidates. No OrgDO. Dispatcher hydrates names. */
  async searchReservations(q: string): Promise<{
    ok: true;
    items: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
    mode: 'exact' | 'name';
  }> {
    this.assertRpcAvailable();
    const trimmed = q.trim();
    const frontDeskSelect = `reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                    adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id`;
    const exact = this.ctx.storage.sql
      .exec(`SELECT ${frontDeskSelect} FROM reservation WHERE reservation_id = ?`, trimmed)
      .toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
    if (exact[0]) {
      return { ok: true, items: exact.map((row) => this.mapFrontDeskListRow(row)), mode: 'exact' };
    }
    if (trimmed.length < 2) {
      return { ok: true, items: [], mode: 'name' };
    }
    const openDate = this.readBusinessDateSync();
    const rows = (
      openDate
        ? this.ctx.storage.sql.exec(
            `SELECT ${frontDeskSelect} FROM reservation
             WHERE status IN ('inquiry','pending','confirmed','checked_in')
                OR (status IN ('checked_out','cancelled','no_show') AND departure_date >= date(?, '-7 days'))
             ORDER BY arrival_date DESC, reservation_id
             LIMIT 200`,
            openDate,
          )
        : this.ctx.storage.sql.exec(
            `SELECT ${frontDeskSelect} FROM reservation
             WHERE status IN ('inquiry','pending','confirmed','checked_in')
             ORDER BY arrival_date DESC, reservation_id
             LIMIT 200`,
          )
    ).toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
    return { ok: true, items: rows.map((row) => this.mapFrontDeskListRow(row)), mode: 'name' };
  }

  async listReservationsByGuestRef(
    guestRef: string,
    input: { cursor?: { arrivalDate: string; reservationId: string }; limit: number },
  ): Promise<{
    items: Array<{
      reservationId: string;
      roomTypeId: string;
      arrivalDate: string;
      departureDate: string;
      status: string;
      roomId: string | null;
      adults: number;
      children: number;
      vipFlag: boolean;
      dndFlag: boolean;
      ratePlanId: string | null;
    }>;
    nextCursor: { arrivalDate: string; reservationId: string } | null;
  }> {
    this.assertRpcAvailable();
    const limit = input.limit;
    const cursor = input.cursor;
    const rows = (
      cursor
        ? this.ctx.storage.sql.exec(
            `SELECT reservation_id, room_type_id, arrival_date, departure_date, status,
                    room_id, adults, children, vip_flag, dnd_flag, rate_plan_id
               FROM reservation
              WHERE guest_ref = ?
                AND (arrival_date, reservation_id) < (?, ?)
              ORDER BY arrival_date DESC, reservation_id DESC
              LIMIT ?`,
            guestRef,
            cursor.arrivalDate,
            cursor.reservationId,
            limit,
          )
        : this.ctx.storage.sql.exec(
            `SELECT reservation_id, room_type_id, arrival_date, departure_date, status,
                    room_id, adults, children, vip_flag, dnd_flag, rate_plan_id
               FROM reservation
              WHERE guest_ref = ?
              ORDER BY arrival_date DESC, reservation_id DESC
              LIMIT ?`,
            guestRef,
            limit,
          )
    ).toArray() as Array<{
      reservation_id: string;
      room_type_id: string;
      arrival_date: string;
      departure_date: string;
      status: string;
      room_id: string | null;
      adults: number;
      children: number;
      vip_flag: number;
      dnd_flag: number;
      rate_plan_id: string | null;
    }>;

    const items = rows.map((row) => ({
      reservationId: row.reservation_id,
      roomTypeId: row.room_type_id,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
      status: row.status,
      roomId: row.room_id,
      adults: row.adults,
      children: row.children,
      vipFlag: row.vip_flag === 1,
      dndFlag: row.dnd_flag === 1,
      ratePlanId: row.rate_plan_id,
    }));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? { arrivalDate: last.arrivalDate, reservationId: last.reservationId }
        : null;
    return { items, nextCursor };
  }

  async readFrontOfficeTape(
    fromDate: string,
    toDate: string,
    roomTypeId?: string,
  ): Promise<{
    ok: true;
    fromDate: string;
    toDate: string;
    asOf: number;
    rooms: Array<{
      roomId: string;
      roomTypeId: string;
      code: string;
      status: string;
      floor: string | null;
    }>;
    blocks: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
    ooo: Array<{ oooId: string; roomId: string; startDate: string; endDate: string; reason: string | null }>;
  }> {
    this.assertRpcAvailable();
    const typeId = roomTypeId ?? null;
    const roomRows = this.ctx.storage.sql
      .exec(
        `SELECT room_id, room_type_id, code, status, floor
         FROM room
         WHERE (? IS NULL OR room_type_id = ?)
           AND archived_at IS NULL
         ORDER BY code`,
        typeId,
        typeId,
      )
      .toArray() as Array<{
      room_id: string;
      room_type_id: string;
      code: string;
      status: string;
      floor: string | null;
    }>;
    const blockRows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
         FROM reservation
         WHERE status IN ('pending', 'confirmed', 'checked_in')
           AND arrival_date <= ?
           AND departure_date > ?`,
        toDate,
        fromDate,
      )
      .toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
    const toExclusive = enumerateFromDate(toDate, 2)[1]!;
    const oooRows = this.ctx.storage.sql
      .exec(
        `SELECT ooo_id, room_id, start_date, end_date, reason
         FROM room_ooo
         WHERE start_date < ? AND end_date > ?`,
        toExclusive,
        fromDate,
      )
      .toArray() as Array<{
      ooo_id: string;
      room_id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
    }>;
    return {
      ok: true,
      fromDate,
      toDate,
      asOf: Date.now(),
      rooms: roomRows.map((r) => ({
        roomId: r.room_id,
        roomTypeId: r.room_type_id,
        code: r.code,
        status: r.status,
        floor: r.floor,
      })),
      blocks: blockRows.map((row) => this.mapFrontDeskListRow(row)),
      ooo: oooRows.map((o) => ({
        oooId: o.ooo_id,
        roomId: o.room_id,
        startDate: o.start_date,
        endDate: o.end_date,
        reason: o.reason,
      })),
    };
  }

  async listFrontOfficeDirectory(q: {
    window: 'today' | 'tomorrow' | 'week' | 'all';
    date?: string;
    statuses?: string[];
    limit?: number;
    cursor?: { arrivalDate: string; reservationId: string } | null;
  }): Promise<
    | {
        ok: true;
        items: Array<ReturnType<PropertyDO['mapFrontDeskListRow']>>;
        nextCursor: { arrivalDate: string; reservationId: string } | null;
      }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    const win = q.window;
    if (win !== 'today' && win !== 'tomorrow' && win !== 'week' && win !== 'all') {
      return { ok: false, error: INVALID_WINDOW };
    }
    if (win !== 'all' && (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date))) {
      return { ok: false, error: INVALID_DATE };
    }
    const limit = this.clampFrontDeskLimit(q.limit);
    const where: string[] = [];
    const params: unknown[] = [];
    if (win === 'today') {
      where.push('arrival_date = ?');
      params.push(q.date);
    } else if (win === 'tomorrow') {
      where.push(`arrival_date = date(?, '+1 day')`);
      params.push(q.date);
    } else if (win === 'week') {
      where.push(`arrival_date >= ? AND arrival_date <= date(?, '+6 days')`);
      params.push(q.date, q.date);
    }
    if (q.statuses && q.statuses.length > 0) {
      where.push(`status IN (${q.statuses.map(() => '?').join(',')})`);
      params.push(...q.statuses);
    }
    if (q.cursor) {
      where.push('(arrival_date < ? OR (arrival_date = ? AND reservation_id < ?))');
      params.push(q.cursor.arrivalDate, q.cursor.arrivalDate, q.cursor.reservationId);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
         FROM reservation
         ${whereSql}
         ORDER BY arrival_date DESC, reservation_id DESC
         LIMIT ?`,
        ...params,
        limit,
      )
      .toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
    const items = rows.map((row) => this.mapFrontDeskListRow(row));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? { arrivalDate: last.arrivalDate, reservationId: last.reservationId }
        : null;
    return { ok: true, items, nextCursor };
  }

  async listAvailableRooms(q: {
    fromDate: string;
    toDate: string;
    roomTypeId?: string;
  }): Promise<{
    ok: true;
    fromDate: string;
    toDate: string;
    asOf: number;
    rooms: Array<{
      roomId: string;
      roomTypeId: string;
      code: string;
      status: string;
      floor: string | null;
    }>;
  }> {
    this.assertRpcAvailable();
    const typeId = q.roomTypeId ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_id, room_type_id, code, status, floor
         FROM room
         WHERE (? IS NULL OR room_type_id = ?)
           AND archived_at IS NULL
           AND status != 'out_of_order'
           AND room_id NOT IN (
             SELECT room_id FROM reservation
             WHERE room_id IS NOT NULL
               AND status IN ('pending', 'confirmed', 'checked_in')
               AND arrival_date < ?
               AND departure_date > ?
           )
           AND room_id NOT IN (
             SELECT room_id FROM room_ooo
             WHERE start_date < ? AND end_date > ?
           )
         ORDER BY code`,
        typeId,
        typeId,
        q.toDate,
        q.fromDate,
        q.toDate,
        q.fromDate,
      )
      .toArray() as Array<{
      room_id: string;
      room_type_id: string;
      code: string;
      status: string;
      floor: string | null;
    }>;
    return {
      ok: true,
      fromDate: q.fromDate,
      toDate: q.toDate,
      asOf: Date.now(),
      rooms: rows.map((r) => ({
        roomId: r.room_id,
        roomTypeId: r.room_type_id,
        code: r.code,
        status: r.status,
        floor: r.floor,
      })),
    };
  }

  async readFrontOfficeSummary(date: string): Promise<{
    ok: true;
    date: string;
    asOf: number;
    arrivals: number;
    departuresDue: number;
    departed: number;
    inHouse: number;
    overstay: number;
    occupancy: { occupiedRooms: number; sellableRooms: number };
  }> {
    this.assertRpcAvailable();
    const count = (sql: string, ...bind: unknown[]): number => {
      const rows = this.ctx.storage.sql.exec(sql, ...bind).toArray() as Array<{ n: number }>;
      return Number(rows[0]?.n ?? 0);
    };
    const arrivals = count(
      `SELECT COUNT(*) AS n FROM reservation
       WHERE arrival_date = ? AND status IN ('confirmed', 'pending')`,
      date,
    );
    const departuresDue = count(
      `SELECT COUNT(*) AS n FROM reservation WHERE departure_date = ? AND status = 'checked_in'`,
      date,
    );
    const departed = count(
      `SELECT COUNT(*) AS n FROM reservation WHERE departure_date = ? AND status = 'checked_out'`,
      date,
    );
    const inHouse = count(`SELECT COUNT(*) AS n FROM reservation WHERE status = 'checked_in'`);
    const overstay = count(
      `SELECT COUNT(*) AS n FROM reservation WHERE status = 'checked_in' AND departure_date < ?`,
      date,
    );
    const occupiedRooms = count(
      `SELECT COUNT(DISTINCT room_id) AS n FROM reservation
       WHERE status IN ('pending', 'confirmed', 'checked_in')
         AND arrival_date <= ?
         AND departure_date > ?
         AND room_id IS NOT NULL`,
      date,
      date,
    );
    const sellableRooms = count(
      `SELECT COUNT(*) AS n FROM room
       WHERE archived_at IS NULL
         AND room_id NOT IN (
         SELECT room_id FROM room_ooo WHERE start_date <= ? AND end_date > ?
       )`,
      date,
      date,
    );
    return {
      ok: true,
      date,
      asOf: Date.now(),
      arrivals,
      departuresDue,
      departed,
      inHouse,
      overstay,
      occupancy: { occupiedRooms, sellableRooms },
    };
  }

  private async assertFrontOfficeStreamAuthorized(
    userId: string,
  ): Promise<{ ok: true } | { ok: false }> {
    if (!userId) return { ok: false };
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false };
    const permDenied = await this.gatePermission({ kind: 'user', userId }, 'reservations:read');
    if (permDenied) return { ok: false };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return { ok: false };
    return { ok: true };
  }

  private peekFrontOfficeStreamAuthorizedSync(userId: string): boolean {
    if (!userId) return false;
    const orgId = this.getOrgIdSync();
    const propertyId = this.getPropertyIdSync();
    if (!orgId || !propertyId) return false;
    const role = this.permissionCache.peekEffectiveRole(userId, propertyId);
    if (!role || !ROLE_GRANTS[role].includes('reservations:read')) return false;
    const entitled = this.entitlementCache.peekEntitled(orgId, 'pms.core');
    if (entitled !== true) return false;
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    this.assertRpcAvailable();
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/front-desk/stream')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const upgrade = request.headers.get('Upgrade');
    if (upgrade?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'expected_websocket' }, { status: 400 });
    }

    const userId = request.headers.get('x-hospai-ws-actor') ?? '';
    if (this.ctx.getWebSockets('front-office').length >= FRONT_OFFICE_MAX_SOCKETS) {
      return Response.json({ error: 'front_office_stream_capacity' }, { status: 503 });
    }
    const gate = await this.assertFrontOfficeStreamAuthorized(userId);
    if (!gate.ok) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ['front-office']);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));

    const fromDate = url.searchParams.get('fromDate');
    const toDate = url.searchParams.get('toDate');
    const valid = Boolean(fromDate && toDate && isInclusiveTapeWindow(fromDate, toDate));
    const attachment: FrontOfficeAttachment = {
      propertyId: this.getPropertyIdSync() ?? '',
      userId,
      fromDate: valid ? fromDate : null,
      toDate: valid ? toDate : null,
      authCheckedAt: Date.now(),
    };
    server.serializeAttachment(attachment);
    if (valid && fromDate && toDate) {
      const tape = await this.readFrontOfficeTape(fromDate, toDate);
      server.send(JSON.stringify({ type: 'snapshot', ...tape }));
    }

    const headers = new Headers();
    const offered = request.headers.get('Sec-WebSocket-Protocol');
    if (offered?.split(',').map((s) => s.trim()).includes('front-office')) {
      headers.set('Sec-WebSocket-Protocol', 'front-office');
    }
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const msg = parsed as { type?: unknown; fromDate?: unknown; toDate?: unknown };
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', asOf: Date.now() }));
      return;
    }
    if (msg.type !== 'subscribe') return;
    const fromDate = typeof msg.fromDate === 'string' ? msg.fromDate : '';
    const toDate = typeof msg.toDate === 'string' ? msg.toDate : '';
    if (!isInclusiveTapeWindow(fromDate, toDate)) {
      ws.send(JSON.stringify({ type: 'error', error: 'date_range_exceeds_max' }));
      return;
    }
    const prev = (ws.deserializeAttachment() ?? {}) as FrontOfficeAttachment;
    const userId = prev.userId ?? '';
    const gate = await this.assertFrontOfficeStreamAuthorized(userId);
    if (!gate.ok) {
      ws.close(FRONT_OFFICE_WS_CLOSE_POLICY, FRONT_OFFICE_WS_CLOSE_REASON);
      return;
    }
    ws.serializeAttachment({
      propertyId: prev.propertyId ?? this.getPropertyIdSync() ?? '',
      userId,
      fromDate,
      toDate,
      authCheckedAt: Date.now(),
    });
    const tape = await this.readFrontOfficeTape(fromDate, toDate);
    ws.send(JSON.stringify({ type: 'snapshot', ...tape }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* already closed */
    }
  }

  private broadcastFrontOffice(delta: FrontOfficeDelta): void {
    const sockets = this.ctx.getWebSockets('front-office');
    if (sockets.length === 0) return;
    const frame = JSON.stringify({ type: 'delta', asOf: Date.now(), ...delta });
    const now = Date.now();
    for (const ws of sockets) {
      const att = (ws.deserializeAttachment() ?? null) as FrontOfficeAttachment | null;
      if (!att) continue;
      if (now - (att.authCheckedAt ?? 0) >= FRONT_OFFICE_REAUTH_INTERVAL_MS) {
        if (!this.peekFrontOfficeStreamAuthorizedSync(att.userId)) {
          ws.close(FRONT_OFFICE_WS_CLOSE_POLICY, FRONT_OFFICE_WS_CLOSE_REASON);
          continue;
        }
        ws.serializeAttachment({ ...att, authCheckedAt: now });
      }
      if (!att.fromDate || !att.toDate) continue;
      if (delta.rooms && delta.rooms.length > 0) {
        ws.send(frame);
        continue;
      }
      if ((delta.removedBlockIds && delta.removedBlockIds.length > 0) || (delta.removedOooIds && delta.removedOooIds.length > 0)) {
        ws.send(frame);
        continue;
      }
      const blockHit = delta.blocks?.some((b) =>
        stayOverlapsWindow(att.fromDate!, att.toDate!, b.arrivalDate, b.departureDate),
      );
      const oooHit = delta.ooo?.some((o) =>
        oooOverlapsWindow(att.fromDate!, att.toDate!, o.startDate, o.endDate),
      );
      if (blockHit || oooHit) ws.send(frame);
    }
  }

  private maybeBroadcastFrontOffice(eventType: string, payload: unknown): void {
    if (!FRONT_OFFICE_OUTBOX_TYPES.has(eventType)) return;
    const delta = this.frontOfficeDeltaFromOutbox(eventType, payload);
    if (!delta) return;
    this.broadcastFrontOffice(delta);
  }

  private frontOfficeDeltaFromOutbox(eventType: string, payload: unknown): FrontOfficeDelta | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (eventType.startsWith('reservation.')) {
      const reservationId = typeof p.reservationId === 'string' ? p.reservationId : null;
      if (!reservationId) return null;
      const row = this.selectFrontDeskReservationSync(reservationId);
      if (!row || !OCCUPYING_STATUSES.has(row.status)) {
        return { removedBlockIds: [reservationId] };
      }
      return { blocks: [this.mapFrontDeskListRow(row)] };
    }
    if (eventType === 'room.ooo_changed') {
      const oooId = typeof p.oooId === 'string' ? p.oooId : null;
      if (!oooId) return null;
      if (p.action === 'released') {
        return { removedOooIds: [oooId] };
      }
      const roomId = typeof p.roomId === 'string' ? p.roomId : '';
      const startDate = typeof p.startDate === 'string' ? p.startDate : '';
      const endDate = typeof p.endDate === 'string' ? p.endDate : '';
      const reason = typeof p.reason === 'string' || p.reason === null ? (p.reason as string | null) : null;
      return { ooo: [{ oooId, roomId, startDate, endDate, reason }] };
    }
    if (eventType === 'room.created' || eventType === 'room.updated' || eventType === 'room.status_changed') {
      const roomId = typeof p.roomId === 'string' ? p.roomId : null;
      if (!roomId) return null;
      const room = this.selectFrontOfficeRoomSync(roomId);
      if (!room) return null;
      return { rooms: [room] };
    }
    return null;
  }

  private selectFrontDeskReservationSync(reservationId: string): Parameters<PropertyDO['mapFrontDeskListRow']>[0] | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
                adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id
         FROM reservation WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<Parameters<PropertyDO['mapFrontDeskListRow']>[0]>;
    return rows[0] ?? null;
  }

  private selectFrontOfficeRoomSync(roomId: string): {
    roomId: string;
    roomTypeId: string;
    code: string;
    status: string;
    floor: string | null;
  } | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_id, room_type_id, code, status, floor FROM room WHERE room_id = ?`,
        roomId,
      )
      .toArray() as Array<{
      room_id: string;
      room_type_id: string;
      code: string;
      status: string;
      floor: string | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      roomId: r.room_id,
      roomTypeId: r.room_type_id,
      code: r.code,
      status: r.status,
      floor: r.floor,
    };
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
  ): Promise<{ ok: true } | NonNullable<ReturnType<typeof mapPropertyCommandError>>> {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      return { ok: false, error: INTERNAL_ERROR };
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

  private normalizeDerivedPlanFields(input: {
    parentRatePlanId?: string | null;
    deriveBps?: number | null;
  }): { parentRatePlanId: string | null; deriveBps: number | null } {
    const parent = input.parentRatePlanId ?? null;
    const bps = input.deriveBps ?? null;
    const parentSet = parent != null && parent !== '';
    const bpsSet = bps != null;
    if (parentSet !== bpsSet) throw new DerivedRatePlanInvalidError();
    if (!parentSet) return { parentRatePlanId: null, deriveBps: null };
    if (bps! < -9900 || bps! > 10_000) throw new DerivedRatePlanInvalidError();
    return { parentRatePlanId: parent, deriveBps: bps };
  }

  private assertDerivedParentEligibleSync(parentRatePlanId: string, childRatePlanId?: string): void {
    if (childRatePlanId && parentRatePlanId === childRatePlanId) throw new DerivedRatePlanInvalidError();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT status, parent_rate_plan_id FROM rate_plan WHERE rate_plan_id = ?`,
        parentRatePlanId,
      )
      .toArray() as Array<{ status: string; parent_rate_plan_id: string | null }>;
    const parent = rows[0];
    if (!parent || parent.status !== 'active' || parent.parent_rate_plan_id != null) {
      throw new DerivedRatePlanInvalidError();
    }
  }

  private isDerivedRatePlanSync(ratePlanId: string): boolean {
    const rows = this.ctx.storage.sql
      .exec(`SELECT parent_rate_plan_id FROM rate_plan WHERE rate_plan_id = ?`, ratePlanId)
      .toArray() as Array<{ parent_rate_plan_id: string | null }>;
    return rows[0]?.parent_rate_plan_id != null;
  }

  private computeDerivedAmountMinorSync(parentMinor: number, deriveBps: number): number {
    const child = Number(
      roundHalfAwayFromZero(BigInt(parentMinor) * BigInt(10_000 + deriveBps), 10_000n),
    );
    if (!Number.isSafeInteger(child)) throw new InvalidMoneyError('derived amount overflow');
    return child;
  }

  private upsertDerivedChildRateDaySync(
    actor: ActorContext,
    propertyId: string,
    roomTypeId: string,
    childRatePlanId: string,
    stayDate: string,
    amountMinor: number,
    currency: string,
  ): void {
    const beforeRows = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor, currency FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
        roomTypeId,
        childRatePlanId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number; currency: string }>;
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_day (room_type_id, rate_plan_id, stay_date, amount_minor, currency, version)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         version = rate_day.version + 1`,
      roomTypeId,
      childRatePlanId,
      stayDate,
      amountMinor,
      currency,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'rate.changed',
      payload: { propertyId, roomTypeId, ratePlanId: childRatePlanId, stayDate },
    });
    this.appendAuditLogSync({
      actor: this.auditActorSync(actor),
      commandId: 'rates.upsert_day',
      entityType: 'rate_day',
      entityId: `${roomTypeId}:${childRatePlanId}:${stayDate}`,
      beforeJson: beforeRows[0]
        ? { amountMinor: beforeRows[0].amount_minor, currency: beforeRows[0].currency }
        : null,
      afterJson: { roomTypeId, ratePlanId: childRatePlanId, stayDate, amountMinor, currency },
    });
  }

  private rematerializeDerivedChildrenSync(
    actor: ActorContext,
    propertyId: string,
    parentRatePlanId: string,
    roomTypeId: string,
    stayDate: string,
  ): void {
    const parentRows = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor, currency FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
        roomTypeId,
        parentRatePlanId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number; currency: string }>;
    const parentCell = parentRows[0];
    if (!parentCell) return;
    const children = this.ctx.storage.sql
      .exec(
        `SELECT rate_plan_id, derive_bps FROM rate_plan
         WHERE status = 'active' AND parent_rate_plan_id = ?`,
        parentRatePlanId,
      )
      .toArray() as Array<{ rate_plan_id: string; derive_bps: number }>;
    for (const child of children) {
      const amountMinor = this.computeDerivedAmountMinorSync(
        parentCell.amount_minor,
        child.derive_bps,
      );
      this.upsertDerivedChildRateDaySync(
        actor,
        propertyId,
        roomTypeId,
        child.rate_plan_id,
        stayDate,
        amountMinor,
        parentCell.currency,
      );
    }
  }

  private backfillDerivedPlanSync(actor: ActorContext, propertyId: string, childRatePlanId: string): void {
    const childRows = this.ctx.storage.sql
      .exec(
        `SELECT parent_rate_plan_id, derive_bps FROM rate_plan WHERE rate_plan_id = ?`,
        childRatePlanId,
      )
      .toArray() as Array<{ parent_rate_plan_id: string | null; derive_bps: number | null }>;
    const child = childRows[0];
    if (!child?.parent_rate_plan_id || child.derive_bps == null) return;
    const parentDays = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, amount_minor, currency FROM rate_day WHERE rate_plan_id = ?`,
        child.parent_rate_plan_id,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      amount_minor: number;
      currency: string;
    }>;
    for (const day of parentDays) {
      const amountMinor = this.computeDerivedAmountMinorSync(day.amount_minor, child.derive_bps);
      this.upsertDerivedChildRateDaySync(
        actor,
        propertyId,
        day.room_type_id,
        childRatePlanId,
        day.stay_date,
        amountMinor,
        day.currency,
      );
    }
  }

  private static readonly PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

  private normalizePromoCodeSync(raw: string): string {
    return raw.trim().toUpperCase();
  }

  private assertPromoCodeCharsetSync(code: string): void {
    if (!PropertyDO.PROMO_CODE_CHARSET.test(code)) {
      throw new Error(INVALID_PROMO_CODE);
    }
  }

  private resolvePromoByCodeSync(code: string): PromoRow | null {
    const normalized = this.normalizePromoCodeSync(code);
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT promo_id, code, name, status, kind, bps, amount_minor, valid_from, valid_to, rate_plan_id
         FROM promo WHERE code = ? AND status = 'active'`,
        normalized,
      )
      .toArray();
    return (rows[0] as PromoRow | undefined) ?? null;
  }

  private loadPromoByIdSync(promoId: string): PromoRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT promo_id, code, name, status, kind, bps, amount_minor, valid_from, valid_to, rate_plan_id
         FROM promo WHERE promo_id = ?`,
        promoId,
      )
      .toArray();
    return (rows[0] as PromoRow | undefined) ?? null;
  }

  private promoApplyInputFromRowSync(row: PromoSnapshotRow): PromoApplyInput {
    if (row.kind === 'percent') {
      return { kind: 'percent', bps: row.bps! };
    }
    return { kind: 'fixed_per_night', amountMinor: row.amount_minor! };
  }

  private assertPromoApplicableSync(
    promo: PromoRow,
    ratePlanId: string,
    nights: string[],
  ): void {
    if (promo.status !== 'active') throw new PromoNotApplicableError();
    if (promo.rate_plan_id != null && promo.rate_plan_id !== ratePlanId) {
      throw new PromoNotApplicableError();
    }
    if (promo.valid_from != null && promo.valid_to != null) {
      for (const night of nights) {
        if (night < promo.valid_from || night > promo.valid_to) throw new PromoNotApplicableError();
      }
    }
  }

  private resolvePromoForBookSync(
    promoCode: string | undefined,
    ratePlanId: string,
    nights: string[],
  ): {
    promoId: string | null;
    row: PromoRow | null;
  } {
    if (promoCode == null || promoCode.trim() === '') {
      return { promoId: null, row: null };
    }
    const normalized = this.normalizePromoCodeSync(promoCode);
    if (!PropertyDO.PROMO_CODE_CHARSET.test(normalized)) throw new PromoNotFoundError();
    const row = this.resolvePromoByCodeSync(normalized);
    if (!row) throw new PromoNotFoundError();
    this.assertPromoApplicableSync(row, ratePlanId, nights);
    return { promoId: row.promo_id, row };
  }

  private resolveStoredPromoForSnapshotSync(
    promoId: string | null,
    ratePlanId: string,
    nights: string[],
  ): PromoSnapshotRow | null {
    if (!promoId) return null;
    const row = this.loadPromoByIdSync(promoId);
    if (!row) throw new PromoNotApplicableError();
    this.assertPromoApplicableSync(row, ratePlanId, nights);
    return { kind: row.kind, bps: row.bps, amount_minor: row.amount_minor };
  }

  /**
   * Create a promo code. Implements catalog `rates.create_promo`.
   */
  async tryCreatePromo(
    actor: ActorContext,
    input: {
      promoId: string;
      code: string;
      name: string;
      kind: 'percent' | 'fixed_per_night';
      bps?: number;
      amountMinor?: number;
      validFrom?: string | null;
      validTo?: string | null;
      ratePlanId?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; promoId: string }
    | { ok: false; error: typeof PROMO_CODE_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const code = this.normalizePromoCodeSync(input.code);
    try {
      this.assertPromoCodeCharsetSync(code);
    } catch {
      return { ok: false, error: INVALID_PROMO_CODE };
    }

    const validFrom = input.validFrom ?? null;
    const validTo = input.validTo ?? null;
    if ((validFrom == null) !== (validTo == null)) {
      return { ok: false, error: INVALID_PROMO_WINDOW };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingId = this.ctx.storage.sql
            .exec(`SELECT promo_id FROM promo WHERE promo_id = ?`, input.promoId)
            .toArray();
          if (existingId.length > 0) throw new Error(PROMO_ID_EXISTS);

          const codeTaken = this.ctx.storage.sql
            .exec(`SELECT promo_id FROM promo WHERE code = ? AND status = 'active'`, code)
            .toArray();
          if (codeTaken.length > 0) throw new PromoCodeExistsError();

          const now = Date.now();
          const bps = input.kind === 'percent' ? (input.bps ?? null) : null;
          const amountMinor = input.kind === 'fixed_per_night' ? (input.amountMinor ?? null) : null;

          this.ctx.storage.sql.exec(
            `INSERT INTO promo (
               promo_id, code, name, status, kind, bps, amount_minor,
               valid_from, valid_to, rate_plan_id, created_at, updated_at
             ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.promoId,
            code,
            input.name,
            input.kind,
            bps,
            amountMinor,
            validFrom,
            validTo,
            input.ratePlanId ?? null,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_promo.changed',
            payload: { propertyId, promoId: input.promoId, op: 'create', at: now },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.create_promo',
            entityType: 'promo',
            entityId: input.promoId,
            beforeJson: null,
            afterJson: { promoId: input.promoId, code, name: input.name, kind: input.kind },
          });

          return { ok: true as const, promoId: input.promoId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof PromoCodeExistsError) return { ok: false, error: PROMO_CODE_EXISTS };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Update an active promo. Implements catalog `rates.update_promo`.
   * Code and kind are immutable after create.
   */
  async tryUpdatePromo(
    actor: ActorContext,
    input: {
      promoId: string;
      name?: string;
      bps?: number;
      amountMinor?: number;
      validFrom?: string | null;
      validTo?: string | null;
      ratePlanId?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; promoId: string }
    | { ok: false; error: typeof PROMO_NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const row = this.loadPromoByIdSync(input.promoId) as {
            promo_id: string;
            code: string;
            name: string;
            status: string;
            kind: 'percent' | 'fixed_per_night';
            bps: number | null;
            amount_minor: number | null;
            valid_from: string | null;
            valid_to: string | null;
            rate_plan_id: string | null;
          } | null;
          if (!row || row.status !== 'active') throw new PromoNotFoundError();

          const nextName = input.name ?? row.name;
          const validFrom = input.validFrom !== undefined ? input.validFrom : row.valid_from;
          const validTo = input.validTo !== undefined ? input.validTo : row.valid_to;
          if ((validFrom == null) !== (validTo == null)) {
            throw new Error(INVALID_PROMO_WINDOW);
          }

          const nextRatePlanId =
            input.ratePlanId !== undefined ? input.ratePlanId : row.rate_plan_id;
          let nextBps = row.bps;
          let nextAmountMinor = row.amount_minor;
          if (row.kind === 'percent') {
            if (input.amountMinor !== undefined) throw new Error(INVALID_PROMO_KIND_FIELD);
            nextBps = input.bps ?? row.bps;
          } else {
            if (input.bps !== undefined) throw new Error(INVALID_PROMO_KIND_FIELD);
            nextAmountMinor = input.amountMinor ?? row.amount_minor;
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE promo SET name = ?, bps = ?, amount_minor = ?, valid_from = ?, valid_to = ?,
               rate_plan_id = ?, updated_at = ?
             WHERE promo_id = ?`,
            nextName,
            nextBps,
            nextAmountMinor,
            validFrom,
            validTo,
            nextRatePlanId,
            now,
            input.promoId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_promo.changed',
            payload: { propertyId, promoId: input.promoId, op: 'update', at: now },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.update_promo',
            entityType: 'promo',
            entityId: input.promoId,
            beforeJson: { name: row.name, bps: row.bps, amountMinor: row.amount_minor },
            afterJson: { name: nextName, bps: nextBps, amountMinor: nextAmountMinor },
          });

          return { ok: true as const, promoId: input.promoId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof PromoNotFoundError) return { ok: false, error: PROMO_NOT_FOUND };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Archive a promo. Implements catalog `rates.archive_promo`.
   */
  async tryArchivePromo(
    actor: ActorContext,
    input: { promoId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; promoId: string }
    | { ok: false; error: typeof PROMO_NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const row = this.loadPromoByIdSync(input.promoId) as { status: string } | null;
          if (!row || row.status !== 'active') throw new PromoNotFoundError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE promo SET status = 'archived', updated_at = ? WHERE promo_id = ?`,
            now,
            input.promoId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'rate_promo.changed',
            payload: { propertyId, promoId: input.promoId, op: 'archive', at: now },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'rates.archive_promo',
            entityType: 'promo',
            entityId: input.promoId,
            beforeJson: { status: 'active' },
            afterJson: { status: 'archived' },
          });

          return { ok: true as const, promoId: input.promoId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof PromoNotFoundError) return { ok: false, error: PROMO_NOT_FOUND };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** Active promos only. */
  async listRatePromos(): Promise<
    Array<{
      promoId: string;
      code: string;
      name: string;
      kind: 'percent' | 'fixed_per_night';
      bps: number | null;
      amountMinor: number | null;
      validFrom: string | null;
      validTo: string | null;
      ratePlanId: string | null;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT promo_id, code, name, kind, bps, amount_minor, valid_from, valid_to, rate_plan_id
         FROM promo
         WHERE status = 'active' ORDER BY code`,
      )
      .toArray() as Array<{
      promo_id: string;
      code: string;
      name: string;
      kind: 'percent' | 'fixed_per_night';
      bps: number | null;
      amount_minor: number | null;
      valid_from: string | null;
      valid_to: string | null;
      rate_plan_id: string | null;
    }>;
    return rows.map((r) => ({
      promoId: r.promo_id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      bps: r.bps,
      amountMinor: r.amount_minor,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      ratePlanId: r.rate_plan_id,
    }));
  }

  /**
   * Create a rate plan. Implements catalog `rates.create_plan`.
   * Fingerprint allowlist: `{ ratePlanId, code, name, cancelPenaltyType?, cancelGraceHours?, cancelPenaltyNights?, cancelPenaltyBps?, cancelPolicyText?, parentRatePlanId?, deriveBps? }`.
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
      parentRatePlanId?: string | null;
      deriveBps?: number | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ratePlanId: string }
    | { ok: false; error: typeof RATE_PLAN_ID_EXISTS }
    | { ok: false; error: typeof RATE_PLAN_CODE_EXISTS }
    | { ok: false; error: typeof DERIVED_RATE_PLAN_INVALID }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
          const derived = this.normalizeDerivedPlanFields(input);
          if (derived.parentRatePlanId) {
            this.assertDerivedParentEligibleSync(derived.parentRatePlanId, input.ratePlanId);
          }
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO rate_plan (
               rate_plan_id, code, name, status, created_at, updated_at,
               cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps, cancel_policy_text,
               parent_rate_plan_id, derive_bps
             )
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            derived.parentRatePlanId,
            derived.deriveBps,
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

          if (derived.parentRatePlanId) {
            this.backfillDerivedPlanSync(actor, propertyId, input.ratePlanId);
          }

          return { ok: true as const, ratePlanId: input.ratePlanId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanIdExistsError) return { ok: false, error: RATE_PLAN_ID_EXISTS };
      if (e instanceof RatePlanCodeExistsError) return { ok: false, error: RATE_PLAN_CODE_EXISTS };
      if (e instanceof DerivedRatePlanInvalidError) {
        return { ok: false, error: DERIVED_RATE_PLAN_INVALID };
      }
      if (e instanceof InvalidCancelPolicyError) return { ok: false, error: INVALID_CANCEL_POLICY };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Update an active rate plan's code/name. Implements catalog `rates.update_plan`.
   * Fingerprint allowlist: `{ ratePlanId, code?, name?, cancelPenaltyType?, cancelGraceHours?, cancelPenaltyNights?, cancelPenaltyBps?, cancelPolicyText?, parentRatePlanId?, deriveBps? }`.
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
      parentRatePlanId?: string | null;
      deriveBps?: number | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ratePlanId: string }
    | { ok: false; error: typeof RATE_PLAN_NOT_FOUND }
    | { ok: false; error: typeof RATE_PLAN_CODE_EXISTS }
    | { ok: false; error: typeof DEFAULT_RATE_PLAN_PROTECTED }
    | { ok: false; error: typeof DERIVED_RATE_PLAN_INVALID }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
              `SELECT code, name, status, cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps, cancel_policy_text,
                      parent_rate_plan_id, derive_bps
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
            parent_rate_plan_id: string | null;
            derive_bps: number | null;
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

          const derivedInput =
            input.parentRatePlanId !== undefined || input.deriveBps !== undefined
              ? {
                  parentRatePlanId:
                    input.parentRatePlanId !== undefined
                      ? input.parentRatePlanId
                      : existing.parent_rate_plan_id,
                  deriveBps:
                    input.deriveBps !== undefined ? input.deriveBps : existing.derive_bps,
                }
              : {
                  parentRatePlanId: existing.parent_rate_plan_id,
                  deriveBps: existing.derive_bps,
                };
          const derived = this.normalizeDerivedPlanFields(derivedInput);
          if (derived.parentRatePlanId) {
            this.assertDerivedParentEligibleSync(derived.parentRatePlanId, input.ratePlanId);
          }
          const derivedChanged =
            derived.parentRatePlanId !== existing.parent_rate_plan_id ||
            derived.deriveBps !== existing.derive_bps;

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE rate_plan SET code = ?, name = ?, updated_at = ?,
               cancel_penalty_type = ?, cancel_grace_hours = ?, cancel_penalty_nights = ?,
               cancel_penalty_bps = ?, cancel_policy_text = ?,
               parent_rate_plan_id = ?, derive_bps = ?
             WHERE rate_plan_id = ?`,
            nextCode,
            nextName,
            now,
            policy.cancelPenaltyType,
            policy.cancelGraceHours,
            policy.cancelPenaltyNights,
            policy.cancelPenaltyBps,
            policy.cancelPolicyText,
            derived.parentRatePlanId,
            derived.deriveBps,
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

          if (derivedChanged && derived.parentRatePlanId) {
            this.backfillDerivedPlanSync(actor, propertyId, input.ratePlanId);
          }

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
      if (e instanceof DerivedRatePlanInvalidError) {
        return { ok: false, error: DERIVED_RATE_PLAN_INVALID };
      }
      if (e instanceof InvalidCancelPolicyError) return { ok: false, error: INVALID_CANCEL_POLICY };
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof ARCHIVE_BLOCKED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
            .exec(`SELECT status FROM rate_plan WHERE rate_plan_id = ?`, input.ratePlanId)
            .toArray() as Array<{ status: string }>;
          if (!rows[0] || rows[0].status !== 'active') {
            throw new RatePlanNotFoundError();
          }

          const activeChildren = this.ctx.storage.sql
            .exec(
              `SELECT rate_plan_id FROM rate_plan
               WHERE parent_rate_plan_id = ? AND status = 'active'`,
              input.ratePlanId,
            )
            .toArray();
          if (activeChildren.length > 0) throw new ArchiveBlockedError();

          if (input.ratePlanId === DEFAULT_RATE_PLAN_ID) {
            throw new DefaultRatePlanProtectedError();
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
      if (e instanceof ArchiveBlockedError) return { ok: false, error: ARCHIVE_BLOCKED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** Active rate plans only. */
  async listRatePlans(): Promise<
    Array<{
      ratePlanId: string;
      code: string;
      name: string;
      status: string;
      cancelPenaltyType: 'none' | 'first_night' | 'nights' | 'percent' | 'full';
      cancelGraceHours: number;
      cancelPenaltyNights: number | null;
      cancelPenaltyBps: number | null;
      cancelPolicyText: string | null;
      parentRatePlanId: string | null;
      deriveBps: number | null;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT rate_plan_id, code, name, status,
                cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights,
                cancel_penalty_bps, cancel_policy_text,
                parent_rate_plan_id, derive_bps
         FROM rate_plan
         WHERE status = 'active' ORDER BY code`,
      )
      .toArray() as Array<{
      rate_plan_id: string;
      code: string;
      name: string;
      status: string;
      cancel_penalty_type: 'none' | 'first_night' | 'nights' | 'percent' | 'full';
      cancel_grace_hours: number;
      cancel_penalty_nights: number | null;
      cancel_penalty_bps: number | null;
      cancel_policy_text: string | null;
      parent_rate_plan_id: string | null;
      derive_bps: number | null;
    }>;
    return rows.map((r) => ({
      ratePlanId: r.rate_plan_id,
      code: r.code,
      name: r.name,
      status: r.status,
      cancelPenaltyType: r.cancel_penalty_type,
      cancelGraceHours: r.cancel_grace_hours,
      cancelPenaltyNights: r.cancel_penalty_nights,
      cancelPenaltyBps: r.cancel_penalty_bps,
      cancelPolicyText: r.cancel_policy_text,
      parentRatePlanId: r.parent_rate_plan_id,
      deriveBps: r.derive_bps,
    }));
  }

  async listRoomTypes(status: 'active' | 'archived' | 'all' = 'active'): Promise<
    Array<{
      roomTypeId: string;
      code: string;
      name: string;
      kind: 'physical' | 'virtual';
      roomCount: number;
      maxOccupancy: number;
      maxAdults: number;
      status: 'active' | 'archived';
      constituentRoomTypeIds: string[];
      createdAt: number;
      updatedAt: number;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, code, name, room_count, max_occupancy, max_adults,
                status, kind, created_at, updated_at
         FROM room_type
         WHERE (? = 'all' OR status = ?)
         ORDER BY code`,
        status,
        status,
      )
      .toArray() as Array<{
      room_type_id: string;
      code: string;
      name: string;
      room_count: number;
      max_occupancy: number;
      max_adults: number;
      status: 'active' | 'archived';
      kind: 'physical' | 'virtual';
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => {
      const kind = r.kind ?? 'physical';
      const constituentRoomTypeIds =
        kind === 'virtual'
          ? this.readVirtualConstituentIdsSync(r.room_type_id).sort((a, b) => a.localeCompare(b))
          : [];
      return {
        roomTypeId: r.room_type_id,
        code: r.code,
        name: r.name,
        kind,
        roomCount: r.room_count,
        maxOccupancy: r.max_occupancy,
        maxAdults: r.max_adults,
        status: r.status,
        constituentRoomTypeIds,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async listRateDays(q: {
    fromDate: string;
    toDate: string;
    roomTypeId?: string;
    ratePlanId?: string;
  }): Promise<
    Array<{
      roomTypeId: string;
      ratePlanId: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
      version: number;
    }>
  > {
    this.assertRpcAvailable();
    const ratePlanId = q.ratePlanId ?? DEFAULT_RATE_PLAN_ID;
    const roomTypeId = q.roomTypeId ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, rate_plan_id, stay_date, amount_minor, currency, version
         FROM rate_day
         WHERE stay_date >= ? AND stay_date <= ?
           AND rate_plan_id = ?
           AND (? IS NULL OR room_type_id = ?)
         ORDER BY room_type_id, stay_date`,
        q.fromDate,
        q.toDate,
        ratePlanId,
        roomTypeId,
        roomTypeId,
      )
      .toArray() as Array<{
      room_type_id: string;
      rate_plan_id: string;
      stay_date: string;
      amount_minor: number;
      currency: string;
      version: number;
    }>;
    return rows.map((r) => ({
      roomTypeId: r.room_type_id,
      ratePlanId: r.rate_plan_id,
      stayDate: r.stay_date,
      amountMinor: r.amount_minor,
      currency: r.currency,
      version: r.version,
    }));
  }

  async listRestrictionDays(q: {
    fromDate: string;
    toDate: string;
    roomTypeId?: string;
  }): Promise<
    Array<{
      roomTypeId: string;
      stayDate: string;
      minLos: number | null;
      maxLos: number | null;
      cta: boolean;
      ctd: boolean;
      stopSell: boolean;
      version: number;
    }>
  > {
    this.assertRpcAvailable();
    const roomTypeId = q.roomTypeId ?? null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, min_los, max_los, cta, ctd, stop_sell, version
         FROM restriction_day
         WHERE stay_date >= ? AND stay_date <= ?
           AND rate_plan_id = ?
           AND (? IS NULL OR room_type_id = ?)
         ORDER BY room_type_id, stay_date`,
        q.fromDate,
        q.toDate,
        TYPE_WIDE_RATE_PLAN,
        roomTypeId,
        roomTypeId,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      min_los: number | null;
      max_los: number | null;
      cta: number;
      ctd: number;
      stop_sell: number;
      version: number;
    }>;
    return rows.map((r) => ({
      roomTypeId: r.room_type_id,
      stayDate: r.stay_date,
      minLos: r.min_los,
      maxLos: r.max_los,
      cta: r.cta !== 0,
      ctd: r.ctd !== 0,
      stopSell: r.stop_sell !== 0,
      version: r.version,
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      return { ok: false, error: INTERNAL_ERROR };
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

  async listFolioRoutingRules(
    status: 'active' | 'archived' | 'all' = 'active',
  ): Promise<
    Array<{
      ruleId: string;
      chargeCode: string;
      destWindowKind: string;
      status: string;
      createdAt: number;
    }>
  > {
    this.assertRpcAvailable();
    const rows =
      status === 'all'
        ? (this.ctx.storage.sql
            .exec(
              `SELECT rule_id, charge_code, dest_window_kind, status, created_at
               FROM folio_routing_rule ORDER BY charge_code, rule_id`,
            )
            .toArray() as Array<{
            rule_id: string;
            charge_code: string;
            dest_window_kind: string;
            status: string;
            created_at: number;
          }>)
        : (this.ctx.storage.sql
            .exec(
              `SELECT rule_id, charge_code, dest_window_kind, status, created_at
               FROM folio_routing_rule WHERE status = ? ORDER BY charge_code, rule_id`,
              status,
            )
            .toArray() as Array<{
            rule_id: string;
            charge_code: string;
            dest_window_kind: string;
            status: string;
            created_at: number;
          }>);
    return rows.map((r) => ({
      ruleId: r.rule_id,
      chargeCode: r.charge_code,
      destWindowKind: r.dest_window_kind,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  /**
   * Upsert a folio routing rule. Implements catalog `folio.upsert_routing_rule`.
   * Fingerprint allowlist: `{ ruleId, chargeCode, destWindowKind }`.
   */
  async tryUpsertRoutingRule(
    actor: ActorContext,
    input: { ruleId: string; chargeCode: string; destWindowKind: 'COMPANY' | 'MASTER' },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ruleId: string }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof ROUTING_RULE_CONFLICT }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.assertChargeCodeSync(input.chargeCode, { requireActive: true });

          const conflict = this.ctx.storage.sql
            .exec(
              `SELECT rule_id FROM folio_routing_rule
               WHERE charge_code = ? AND status = 'active' AND rule_id != ?`,
              input.chargeCode,
              input.ruleId,
            )
            .toArray();
          if (conflict.length > 0) throw new RoutingRuleConflictError();

          const now = Date.now();
          const existing = this.ctx.storage.sql
            .exec(`SELECT rule_id FROM folio_routing_rule WHERE rule_id = ?`, input.ruleId)
            .toArray();
          const op = existing.length > 0 ? 'update' : 'create';
          if (existing.length > 0) {
            this.ctx.storage.sql.exec(
              `UPDATE folio_routing_rule
               SET charge_code = ?, dest_window_kind = ?, status = 'active'
               WHERE rule_id = ?`,
              input.chargeCode,
              input.destWindowKind,
              input.ruleId,
            );
          } else {
            this.ctx.storage.sql.exec(
              `INSERT INTO folio_routing_rule (rule_id, charge_code, dest_window_kind, status, created_at)
               VALUES (?, ?, ?, 'active', ?)`,
              input.ruleId,
              input.chargeCode,
              input.destWindowKind,
              now,
            );
          }

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.routing_rule_changed',
            payload: {
              propertyId,
              ruleId: input.ruleId,
              chargeCode: input.chargeCode,
              destWindowKind: input.destWindowKind,
              op,
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.upsert_routing_rule',
            entityType: 'folio_routing_rule',
            entityId: input.ruleId,
            beforeJson: null,
            afterJson: {
              ruleId: input.ruleId,
              chargeCode: input.chargeCode,
              destWindowKind: input.destWindowKind,
              status: 'active',
            },
          });

          return { ok: true as const, ruleId: input.ruleId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      if (e instanceof RoutingRuleConflictError) return { ok: false, error: ROUTING_RULE_CONFLICT };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Archive a folio routing rule. Implements catalog `folio.archive_routing_rule`.
   * Fingerprint allowlist: `{ ruleId }`.
   */
  async tryArchiveRoutingRule(
    actor: ActorContext,
    input: { ruleId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; ruleId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
            .exec(
              `SELECT rule_id, charge_code, dest_window_kind, status FROM folio_routing_rule WHERE rule_id = ?`,
              input.ruleId,
            )
            .toArray() as Array<{
            rule_id: string;
            charge_code: string;
            dest_window_kind: string;
            status: string;
          }>;
          const existing = rows[0];
          if (!existing) throw new FolioWindowError(NOT_FOUND);

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE folio_routing_rule SET status = 'archived' WHERE rule_id = ?`,
            input.ruleId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.routing_rule_changed',
            payload: {
              propertyId,
              ruleId: input.ruleId,
              chargeCode: existing.charge_code,
              destWindowKind: existing.dest_window_kind,
              op: 'archive',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.archive_routing_rule',
            entityType: 'folio_routing_rule',
            entityId: input.ruleId,
            beforeJson: { status: existing.status },
            afterJson: {
              ruleId: input.ruleId,
              chargeCode: existing.charge_code,
              destWindowKind: existing.dest_window_kind,
              status: 'archived',
            },
          });

          return { ok: true as const, ruleId: input.ruleId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: INTERNAL_ERROR };
    }
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    this.assertRpcAvailable();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
      return { ok: false, error: INTERNAL_ERROR };
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

  /** Current quote for `from` → `to` at instant `at` (epoch ms). Miss → null. */
  private lookupFxRateSync(
    fromCurrency: string,
    toCurrency: string,
    at: number,
  ): { quoteId: string; rate: string; effectiveFrom: number } | null {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT quote_id, rate, effective_from FROM fx_rate
         WHERE from_currency = ? AND to_currency = ?
           AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
         ORDER BY effective_from DESC LIMIT 1`,
        from,
        to,
        at,
        at,
      )
      .toArray() as Array<{ quote_id: string; rate: string; effective_from: number }>;
    const row = rows[0];
    if (!row) return null;
    return { quoteId: row.quote_id, rate: row.rate, effectiveFrom: row.effective_from };
  }

  async listFxRates(): Promise<
    Array<{
      quoteId: string;
      fromCurrency: string;
      toCurrency: string;
      rate: string;
      effectiveFrom: number;
      effectiveTo: number | null;
      createdAt: number;
      createdBy: string | null;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT quote_id, from_currency, to_currency, rate, effective_from, effective_to, created_at, created_by
         FROM fx_rate
         ORDER BY from_currency, to_currency, effective_from`,
      )
      .toArray() as Array<{
      quote_id: string;
      from_currency: string;
      to_currency: string;
      rate: string;
      effective_from: number;
      effective_to: number | null;
      created_at: number;
      created_by: string | null;
    }>;
    return rows.map((r) => ({
      quoteId: r.quote_id,
      fromCurrency: r.from_currency,
      toCurrency: r.to_currency,
      rate: r.rate,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
  }

  async tryCreateFxRate(
    actor: ActorContext,
    input: {
      quoteId: string;
      fromCurrency: string;
      toCurrency: string;
      rate: string;
      effectiveFrom: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; quoteId: string }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof FX_RATE_NOT_LEDGER }
    | { ok: false; error: typeof FX_RATE_OPEN_EXISTS }
    | { ok: false; error: typeof FX_RATE_INVALID }
    | { ok: false; error: typeof CURRENCY_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const ledger = this.readStoredLedgerCurrencySync();
    if (!ledger) return { ok: false, error: CURRENCY_UNSET };

    try {
      const from = currencyCode(input.fromCurrency);
      const to = currencyCode(input.toCurrency);
      if (from === to) return { ok: false, error: MONEY_INVALID };
      if (to !== ledger) return { ok: false, error: FX_RATE_NOT_LEDGER };
      const rate = validateFxRate(input.rate);
      if (rate === '0' || rate === '-0') return { ok: false, error: FX_RATE_INVALID };

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const open = this.ctx.storage.sql
            .exec(
              `SELECT quote_id FROM fx_rate
               WHERE from_currency = ? AND to_currency = ? AND effective_to IS NULL LIMIT 1`,
              from,
              to,
            )
            .toArray();
          if (open.length > 0) throw new FxRateOpenExistsError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO fx_rate (
               quote_id, from_currency, to_currency, rate, effective_from, effective_to, created_at, created_by
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
            input.quoteId,
            from,
            to,
            rate,
            input.effectiveFrom,
            now,
            this.auditActorSync(actor),
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'fx_rate.changed',
            payload: {
              propertyId,
              quoteId: input.quoteId,
              fromCurrency: from,
              toCurrency: to,
              op: 'create',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.create_fx_rate',
            entityType: 'fx_rate',
            entityId: input.quoteId,
            beforeJson: null,
            afterJson: {
              quoteId: input.quoteId,
              fromCurrency: from,
              toCurrency: to,
              rate,
              effectiveFrom: input.effectiveFrom,
            },
          });

          return { ok: true as const, quoteId: input.quoteId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FxRateOpenExistsError) return { ok: false, error: FX_RATE_OPEN_EXISTS };
      if (e instanceof FxRateNotLedgerError) return { ok: false, error: FX_RATE_NOT_LEDGER };
      if (e instanceof InvalidFxRateError || e instanceof InvalidMoneyError) {
        return { ok: false, error: FX_RATE_INVALID };
      }
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async trySupersedeFxRate(
    actor: ActorContext,
    input: {
      quoteId: string;
      supersedeQuoteId: string;
      rate: string;
      effectiveFrom: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; quoteId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof FX_RATE_NOT_LEDGER }
    | { ok: false; error: typeof FX_RATE_INVALID }
    | { ok: false; error: typeof CURRENCY_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, 'settings:configure');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const ledger = this.readStoredLedgerCurrencySync();
    if (!ledger) return { ok: false, error: CURRENCY_UNSET };

    try {
      const rate = validateFxRate(input.rate);
      if (rate === '0' || rate === '-0') return { ok: false, error: FX_RATE_INVALID };

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(
              `SELECT quote_id, from_currency, to_currency, effective_to FROM fx_rate WHERE quote_id = ?`,
              input.supersedeQuoteId,
            )
            .toArray() as Array<{
            quote_id: string;
            from_currency: string;
            to_currency: string;
            effective_to: number | null;
          }>;
          const prior = existing[0];
          if (!prior || prior.effective_to !== null) throw new Error(NOT_FOUND);
          if (prior.to_currency !== ledger) throw new FxRateNotLedgerError();

          const now = Date.now();
          const closeAt = input.effectiveFrom;
          this.ctx.storage.sql.exec(
            `UPDATE fx_rate SET effective_to = ? WHERE quote_id = ?`,
            closeAt,
            input.supersedeQuoteId,
          );

          this.ctx.storage.sql.exec(
            `INSERT INTO fx_rate (
               quote_id, from_currency, to_currency, rate, effective_from, effective_to, created_at, created_by
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
            input.quoteId,
            prior.from_currency,
            prior.to_currency,
            rate,
            input.effectiveFrom,
            now,
            this.auditActorSync(actor),
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'fx_rate.changed',
            payload: {
              propertyId,
              quoteId: input.quoteId,
              supersedeQuoteId: input.supersedeQuoteId,
              op: 'supersede',
              at: now,
            },
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.supersede_fx_rate',
            entityType: 'fx_rate',
            entityId: input.quoteId,
            beforeJson: { quoteId: input.supersedeQuoteId },
            afterJson: {
              quoteId: input.quoteId,
              supersedeQuoteId: input.supersedeQuoteId,
              rate,
              effectiveFrom: input.effectiveFrom,
            },
          });

          return { ok: true as const, quoteId: input.quoteId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FxRateNotLedgerError) return { ok: false, error: FX_RATE_NOT_LEDGER };
      if (e instanceof InvalidFxRateError || e instanceof InvalidMoneyError) {
        return { ok: false, error: FX_RATE_INVALID };
      }
      if (e instanceof Error && e.message === NOT_FOUND) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: INTERNAL_ERROR };
    }
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
    | { ok: false; error: typeof DERIVED_RATE_PLAN_WRITE_FORBIDDEN }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

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
          if (this.isDerivedRatePlanSync(ratePlanId)) {
            throw new DerivedRatePlanWriteForbiddenError();
          }
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
          this.rematerializeDerivedChildrenSync(
            actor,
            propertyId,
            ratePlanId,
            input.roomTypeId,
            input.stayDate,
          );
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      if (e instanceof DerivedRatePlanWriteForbiddenError) {
        return { ok: false, error: DERIVED_RATE_PLAN_WRITE_FORBIDDEN };
      }
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof DERIVED_RATE_PLAN_WRITE_FORBIDDEN }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof LIMIT_EXCEEDED }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'rates:write');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (input.updates.length > RATES_BULK_UPDATE_MAX) {
      return { ok: false, error: LIMIT_EXCEEDED };
    }

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
            if (this.isDerivedRatePlanSync(cell.ratePlanId)) {
              throw new DerivedRatePlanWriteForbiddenError();
            }
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
            this.rematerializeDerivedChildrenSync(
              actor,
              propertyId,
              cell.ratePlanId,
              cell.roomTypeId,
              cell.stayDate,
            );
          }

          return { ok: true as const, count: normalized.length };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof RatePlanNotFoundError) return { ok: false, error: RATE_PLAN_NOT_FOUND };
      if (e instanceof DerivedRatePlanWriteForbiddenError) {
        return { ok: false, error: DERIVED_RATE_PLAN_WRITE_FORBIDDEN };
      }
      return { ok: false, error: INTERNAL_ERROR };
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
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    let nights: string[];
    try {
      nights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: INVALID_STAY_RANGE };
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
         WHERE allocated_room_type_id = ? AND allocated_room_type_id != ''
           AND status IN ('pending', 'confirmed', 'checked_in', 'checked_out')
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
    this.assertUnsafeLocal('createFolioWindow');
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

  private readFolioWindowRowSync(folioWindowId: string): {
    folioWindowId: string;
    reservationId: string;
    kind: string;
    status: string;
    billedParty: string | null;
    closedAt: number | null;
  } | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, reservation_id, kind, status, billed_party, closed_at
         FROM folio_window WHERE folio_window_id = ?`,
        folioWindowId,
      )
      .toArray() as Array<{
      folio_window_id: string;
      reservation_id: string;
      kind: string;
      status: string;
      billed_party: string | null;
      closed_at: number | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      folioWindowId: row.folio_window_id,
      reservationId: row.reservation_id,
      kind: row.kind,
      status: row.status,
      billedParty: row.billed_party,
      closedAt: row.closed_at,
    };
  }

  private windowBalanceMinorSync(folioWindowId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS balance FROM folio_line WHERE folio_window_id = ?`,
        folioWindowId,
      )
      .toArray() as Array<{ balance: number }>;
    return Number(rows[0]?.balance ?? 0);
  }

  private closeFolioWindowSync(
    folioWindowId: string,
    now: number,
    propertyId: string,
    reservationId: string,
  ): void {
    this.ctx.storage.sql.exec(
      `UPDATE folio_window SET status = 'CLOSED', closed_at = ? WHERE folio_window_id = ?`,
      now,
      folioWindowId,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'folio.window_closed',
      payload: { propertyId, reservationId, folioWindowId },
    });
  }

  async tryOpenFolioWindow(
    actor: ActorContext,
    input: { reservationId: string; kind: 'GUEST' | 'COMPANY' | 'MASTER'; billedParty?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioWindowId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof GUEST_WINDOW_NOT_OPENABLE }
    | { ok: false; error: typeof WINDOW_NOT_OPENABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          if (input.kind === 'GUEST') throw new FolioWindowError(GUEST_WINDOW_NOT_OPENABLE);

          const resRows = this.ctx.storage.sql
            .exec(`SELECT status FROM reservation WHERE reservation_id = ?`, input.reservationId)
            .toArray() as Array<{ status: string }>;
          const reservation = resRows[0];
          if (!reservation) throw new FolioWindowError(NOT_FOUND);
          if (reservation.status === 'inquiry') throw new FolioWindowError(WINDOW_NOT_OPENABLE);

          let folioWindowId: string;
          let billedParty: string | null = null;
          if (input.kind === 'COMPANY') {
            const raw = input.billedParty?.trim() ?? '';
            if (!raw || raw.length > 128) throw new FolioWindowError(WINDOW_NOT_OPENABLE);
            const slug = billedPartySlug(raw);
            if (!slug) throw new FolioWindowError(WINDOW_NOT_OPENABLE);
            folioWindowId = `${input.reservationId}:COMPANY:${slug}`;
            billedParty = raw;
          } else {
            folioWindowId = `${input.reservationId}:MASTER`;
          }

          const existing = this.readFolioWindowRowSync(folioWindowId);
          if (existing) return { ok: true as const, folioWindowId };

          this.ctx.storage.sql.exec(
            `INSERT INTO folio_window (folio_window_id, reservation_id, kind, billed_party, status)
             VALUES (?, ?, ?, ?, 'OPEN')`,
            folioWindowId,
            input.reservationId,
            input.kind,
            billedParty,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.window_opened',
            payload: { propertyId, reservationId: input.reservationId, folioWindowId, kind: input.kind },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.open_window',
            entityType: 'folio_window',
            entityId: folioWindowId,
            beforeJson: null,
            afterJson: { folioWindowId, kind: input.kind, billedParty, status: 'OPEN' },
            reservationId: input.reservationId,
          });
          return { ok: true as const, folioWindowId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryCloseFolioWindow(
    actor: ActorContext,
    input: { folioWindowId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; alreadyClosed?: true }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof WINDOW_NOT_CLOSABLE }
    | { ok: false; error: typeof WINDOW_BALANCE_DUE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const window = this.readFolioWindowRowSync(input.folioWindowId);
          if (!window) throw new FolioWindowError(NOT_FOUND);
          if (window.status === 'CLOSED') return { ok: true as const, alreadyClosed: true as const };

          const balance = this.windowBalanceMinorSync(input.folioWindowId);
          if (window.kind === 'GUEST') {
            const resRows = this.ctx.storage.sql
              .exec(`SELECT status FROM reservation WHERE reservation_id = ?`, window.reservationId)
              .toArray() as Array<{ status: string }>;
            const status = resRows[0]?.status;
            if (status !== 'checked_out' && status !== 'cancelled' && status !== 'no_show') {
              throw new FolioWindowError(WINDOW_NOT_CLOSABLE);
            }
            if (balance !== 0) throw new FolioWindowError(WINDOW_BALANCE_DUE);
          } else if (window.kind === 'MASTER') {
            if (balance !== 0) throw new FolioWindowError(WINDOW_BALANCE_DUE);
          }

          if (window.kind === 'COMPANY') {
            const syncResult = this.syncCityLedgerArForWindowSync({
              folioWindowId: input.folioWindowId,
              source: 'window_close',
              actor,
            });
            if (!syncResult.ok) throw new CityLedgerError(syncResult.error);
          }

          const now = Date.now();
          this.closeFolioWindowSync(input.folioWindowId, now, propertyId, window.reservationId);
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.close_window',
            entityType: 'folio_window',
            entityId: input.folioWindowId,
            beforeJson: { status: 'OPEN' },
            afterJson: { status: 'CLOSED', closedAt: now },
            reservationId: window.reservationId,
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryReopenFolioWindow(
    actor: ActorContext,
    input: { folioWindowId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; alreadyOpen?: true }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof WINDOW_NOT_REOPENABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const window = this.readFolioWindowRowSync(input.folioWindowId);
          if (!window) throw new FolioWindowError(NOT_FOUND);
          if (window.status === 'OPEN') return { ok: true as const, alreadyOpen: true as const };
          if (window.status !== 'CLOSED') throw new FolioWindowError(WINDOW_NOT_REOPENABLE);

          this.ctx.storage.sql.exec(
            `UPDATE folio_window SET status = 'OPEN', closed_at = NULL WHERE folio_window_id = ?`,
            input.folioWindowId,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.window_reopened',
            payload: { propertyId, reservationId: window.reservationId, folioWindowId: input.folioWindowId },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.reopen_window',
            entityType: 'folio_window',
            entityId: input.folioWindowId,
            beforeJson: { status: 'CLOSED' },
            afterJson: { status: 'OPEN', closedAt: null },
            reservationId: window.reservationId,
          });
          return { ok: true as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: INTERNAL_ERROR };
    }
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

    const win = this.ctx.storage.sql
      .exec(`SELECT status FROM folio_window WHERE folio_window_id = ?`, input.folioWindowId)
      .toArray() as Array<{ status: string }>;
    if (!win[0]) throw new Error(NOT_FOUND);
    if (win[0].status === 'CLOSED') throw new WindowClosedError();

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
  private assertFolioWindowOpenSync(folioWindowId: string): {
    folioWindowId: string;
    reservationId: string;
    status: string;
  } {
    const window = this.readFolioWindowRowSync(folioWindowId);
    if (!window) throw new FolioWindowError(NOT_FOUND);
    if (window.status !== 'OPEN') throw new WindowClosedError();
    return window;
  }

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
    splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>,
    opts?: { reverseId?: string },
  ): string[] {
    this.assertFolioWindowOpenSync(source.folio_window_id);
    for (const split of splits) {
      const destWindowId = split.folioWindowId ?? source.folio_window_id;
      if (destWindowId === source.folio_window_id) continue;
      const dest = this.assertFolioWindowOpenSync(destWindowId);
      if (dest.reservationId !== source.reservation_id) {
        throw new FolioWindowError(TRANSFER_CROSS_RESERVATION);
      }
    }

    const txnCurrency = currencyCode(source.txn_currency);
    const folioLineIds: string[] = [];

    this.assertChargeCodeSync(source.charge_code, { requireActive: false });

    const taxLines = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, amount_minor, tax_rule_id, charge_code, ledger_amount_minor,
                txn_currency, fx_rate, fx_rate_at
         FROM folio_line WHERE tax_of = ? AND source = 'TAX'`,
        source.folio_line_id,
      )
      .toArray() as Array<{
      folio_line_id: string;
      amount_minor: number;
      tax_rule_id: string;
      charge_code: string;
      ledger_amount_minor: number;
      txn_currency: string;
      fx_rate: string;
      fx_rate_at: number;
    }>;

    const reverseId = opts?.reverseId ?? `${source.folio_line_id}:rev:${crypto.randomUUID()}`;
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
          txnCurrency: currencyCode(tax.txn_currency),
          ledgerAmountMinor: -tax.ledger_amount_minor,
          fxRate: tax.fx_rate,
          fxRateAt: tax.fx_rate_at,
        },
        source: 'SPLIT_REVERSAL',
        splitOf: tax.folio_line_id,
        paymentId: null,
      });
      folioLineIds.push(reverseTaxId);
    }

    const absWeights = splits.map((s) => Math.abs(s.amountMinor));
    const txnSign = source.amount_minor < 0 ? -1 : 1;
    const ledgerSign = source.ledger_amount_minor < 0 ? -1 : 1;
    const txnPortions = allocate(Math.abs(source.amount_minor), absWeights, { policy: 'LAST' });
    const ledgerPortions = allocate(Math.abs(source.ledger_amount_minor), absWeights, { policy: 'LAST' });

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i]!;
      const destWindowId = split.folioWindowId ?? source.folio_window_id;
      const childSource =
        destWindowId !== source.folio_window_id
          ? 'TRANSFER'
          : source.source === 'NIGHT_AUDIT'
            ? null
            : source.source;
      this.insertFolioLineSync({
        folioLineId: split.folioLineId,
        folioWindowId: destWindowId,
        reservationId: source.reservation_id,
        chargeCode: source.charge_code,
        posted: {
          amountMinor: txnSign * txnPortions[i]!,
          txnCurrency,
          ledgerAmountMinor: ledgerSign * ledgerPortions[i]!,
          fxRate: source.fx_rate,
          fxRateAt: source.fx_rate_at,
        },
        source: childSource,
        splitOf: source.folio_line_id,
        paymentId: null,
      });
      folioLineIds.push(split.folioLineId);
    }

    for (const tax of taxLines) {
      const taxTxnSign = tax.amount_minor < 0 ? -1 : 1;
      const taxLedgerSign = tax.ledger_amount_minor < 0 ? -1 : 1;
      const taxTxnPortions = allocate(Math.abs(tax.amount_minor), absWeights, { policy: 'LAST' });
      const taxLedgerPortions = allocate(Math.abs(tax.ledger_amount_minor), absWeights, { policy: 'LAST' });
      const taxCurrency = currencyCode(tax.txn_currency);
      for (let i = 0; i < splits.length; i++) {
        const txnPortion = taxTxnSign * taxTxnPortions[i]!;
        const ledgerPortion = taxLedgerSign * taxLedgerPortions[i]!;
        if (txnPortion === 0 && ledgerPortion === 0) continue;
        const childLineId = splits[i]!.folioLineId;
        const destWindowId = splits[i]!.folioWindowId ?? source.folio_window_id;
        this.insertFolioLineSync({
          folioLineId: `${childLineId}:tax:${tax.tax_rule_id}`,
          folioWindowId: destWindowId,
          reservationId: source.reservation_id,
          chargeCode: tax.charge_code,
          posted: {
            amountMinor: txnPortion,
            txnCurrency: taxCurrency,
            ledgerAmountMinor: ledgerPortion,
            fxRate: tax.fx_rate,
            fxRateAt: tax.fx_rate_at,
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

  private recordNightAuditRoomChargeExceptionSync(
    reservationId: string,
    businessDate: string,
    stayDate: string,
  ): void {
    this.appendAuditLogSync({
      actor: 'system:night_audit',
      commandId: 'night_audit.run',
      entityType: 'reservation',
      entityId: reservationId,
      reservationId,
      afterJson: {
        step: 'POST_ROOM_CHARGES',
        reason: RATE_MISSING,
        businessDate,
        stayDate,
      },
    });
  }

  private postRoomChargesSync(businessDate: string): { postedCount: number; failedCount: number } {
    const ledgerCurrency = this.readStoredLedgerCurrencySync();
    if (!ledgerCurrency) throw new Error(CURRENCY_UNSET);

    const autoNoShow = this.readConfigValueSync('pms.night_audit.auto_no_show');
    const statusPredicate =
      autoNoShow === false
        ? `status = 'checked_in'`
        : `status IN ('confirmed', 'checked_in')`;

    const reservations = this.ctx.storage.sql
      .exec(
        `SELECT reservation_id, room_type_id, rate_plan_id
         FROM reservation
         WHERE ${statusPredicate}
           AND COALESCE(no_post, 0) = 0
           AND arrival_date <= ? AND departure_date > ?`,
        businessDate,
        businessDate,
      )
      .toArray() as Array<{ reservation_id: string; room_type_id: string; rate_plan_id: string }>;

    this.assertChargeCodeSync('ROOM', { requireActive: true });

    let postedCount = 0;
    let failedCount = 0;

    for (const reservation of reservations) {
      try {
        const amountMinor = this.rateNightAmountSync(
          reservation.reservation_id,
          reservation.room_type_id,
          reservation.rate_plan_id,
          businessDate,
        );

        this.ensureGuestFolioWindowSync(reservation.reservation_id);
        const folioWindowId = this.readGuestFolioWindowIdSync(reservation.reservation_id);
        const fxRateAt = Date.now();
        const posted: PostedLineAmount = {
          amountMinor,
          txnCurrency: ledgerCurrency,
          ledgerAmountMinor: amountMinor,
          fxRate: '1',
          fxRateAt,
        };

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
      } catch (e) {
        if (e instanceof RateMissingError) {
          this.recordNightAuditRoomChargeExceptionSync(
            reservation.reservation_id,
            businessDate,
            e.date,
          );
          failedCount += 1;
          continue;
        }
        throw e;
      }
    }

    return { postedCount, failedCount };
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
    | { ok: false; error: typeof FX_RATE_MISSING }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof CHARGE_CODE_NOT_FOUND }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof BUSINESS_DATE_CLOSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
            actor: this.auditActorForCommandSync(actor, provisional),
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ChargeCodeNotFoundError) return { ok: false, error: CHARGE_CODE_NOT_FOUND };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryPostDiscount(
    actor: ActorContext,
    input: {
      sourceFolioLineId?: string;
      reservationId?: string;
      kind: 'percent' | 'fixed';
      bps?: number;
      amountMinor?: number;
      reason: string;
      folioLineId: string;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof DISCOUNT_REASON_REQUIRED }
    | { ok: false; error: typeof LINE_NOT_DISCOUNTABLE }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 500) {
      return { ok: false, error: DISCOUNT_REASON_REQUIRED };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          if (!input.sourceFolioLineId) {
            if (!input.reservationId) throw new Error('invalid_body');

            const resRows = this.ctx.storage.sql
              .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, input.reservationId)
              .toArray() as Array<{ reservation_id: string }>;
            if (!resRows[0]) throw new FolioWindowError(NOT_FOUND);

            const guestWindowId = this.guestFolioWindowId(input.reservationId);
            const windowRow = this.readFolioWindowRowSync(guestWindowId);
            if (!windowRow) throw new FolioWindowError(NOT_FOUND);
            this.assertFolioWindowOpenSync(guestWindowId);

            const BASE_EXCLUDE =
              'TAX,PAYMENT,PAYMENT_REFUND,SPLIT_REVERSAL,TRANSFER_REVERSAL,CHARGEBACK,FX_GAIN,FX_LOSS,CHARGEBACK_FEE';
            const baseRows = this.ctx.storage.sql
              .exec(
                `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS base
                 FROM folio_line
                 WHERE folio_window_id = ?
                   AND NOT (
                     COALESCE(source, '') IN (${BASE_EXCLUDE.split(',').map(() => '?').join(',')})
                     OR charge_code IN (${BASE_EXCLUDE.split(',').map(() => '?').join(',')})
                   )`,
                guestWindowId,
                ...BASE_EXCLUDE.split(','),
                ...BASE_EXCLUDE.split(','),
              )
              .toArray() as Array<{ base: number }>;
            const baseLedger = Number(baseRows[0]?.base ?? 0);

            let discountMinor: number;
            if (input.kind === 'percent') {
              const bps = input.bps;
              if (!Number.isInteger(bps) || bps === undefined || bps < 1 || bps > 10000) {
                throw new Error(MONEY_INVALID);
              }
              discountMinor = Number(roundHalfAwayFromZero(BigInt(baseLedger) * BigInt(bps), 10000n));
            } else {
              const amountMinor = input.amountMinor;
              if (
                !Number.isInteger(amountMinor) ||
                amountMinor === undefined ||
                amountMinor <= 0 ||
                amountMinor > baseLedger
              ) {
                throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);
              }
              discountMinor = amountMinor;
            }
            if (baseLedger <= 0 || discountMinor <= 0) throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);

            this.assertChargeCodeSync('DISCOUNT', { requireActive: true });
            const ledger = this.readStoredLedgerCurrencySync();
            if (!ledger) throw new Error(CURRENCY_UNSET);
            const fxRateAt = Date.now();
            const posted = postToLedger(money(-discountMinor, ledger), ledger, '1', fxRateAt);

            this.insertFolioLineSync({
              folioLineId: input.folioLineId,
              folioWindowId: guestWindowId,
              reservationId: input.reservationId,
              chargeCode: 'DISCOUNT',
              posted,
              source: 'DESK',
            });

            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'folio.post_discount',
              entityType: 'folio_line',
              entityId: input.folioLineId,
              beforeJson: null,
              afterJson: {
                folioLineId: input.folioLineId,
                reservationId: input.reservationId,
                amountMinor: -discountMinor,
                reason,
              },
              reservationId: input.reservationId,
            });
            return { ok: true as const, folioLineId: input.folioLineId };
          }

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
          if (!source) throw new FolioWindowError(NOT_FOUND);
          const blocked = new Set([
            'SPLIT_REVERSAL',
            'TAX',
            'PAYMENT',
            'PAYMENT_REFUND',
            'TRANSFER_REVERSAL',
            'DISCOUNT',
            'CHARGEBACK',
            'FX_GAIN',
            'FX_LOSS',
            'CHARGEBACK_FEE',
          ]);
          if (blocked.has(source.source ?? '') || blocked.has(source.charge_code)) {
            throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);
          }
          if (!(source.amount_minor > 0)) throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);
          this.assertFolioWindowOpenSync(source.folio_window_id);

          let discountMinor: number;
          if (input.kind === 'percent') {
            const bps = input.bps;
            if (!Number.isInteger(bps) || bps === undefined || bps < 1 || bps > 10000) {
              throw new Error(MONEY_INVALID);
            }
            discountMinor = Number(roundHalfAwayFromZero(BigInt(source.amount_minor) * BigInt(bps), 10000n));
          } else {
            const amountMinor = input.amountMinor;
            if (
              !Number.isInteger(amountMinor) ||
              amountMinor === undefined ||
              amountMinor <= 0 ||
              amountMinor > source.amount_minor
            ) {
              throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);
            }
            discountMinor = amountMinor;
          }
          if (discountMinor <= 0) throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);

          this.assertChargeCodeSync('DISCOUNT', { requireActive: true });
          const txnCurrency = currencyCode(source.txn_currency);
          const ledger = this.readStoredLedgerCurrencySync();
          if (!ledger) throw new Error(CURRENCY_UNSET);
          const posted = postToLedger(
            money(-discountMinor, txnCurrency),
            ledger,
            source.fx_rate,
            source.fx_rate_at,
          );
          this.insertFolioLineSync({
            folioLineId: input.folioLineId,
            folioWindowId: source.folio_window_id,
            reservationId: source.reservation_id,
            chargeCode: 'DISCOUNT',
            posted,
            source: 'DESK',
            splitOf: source.folio_line_id,
          });

          this.stampTaxForChargeSync({
            parentLineId: input.folioLineId,
            parentAmountMinor: posted.amountMinor,
            parentSource: 'DESK',
            chargeCode: source.charge_code,
            reservationId: source.reservation_id,
            folioWindowId: source.folio_window_id,
            postingDate: this.resolvePostingBusinessDateSync(),
            posted,
          });

          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.post_discount',
            entityType: 'folio_line',
            entityId: input.folioLineId,
            beforeJson: null,
            afterJson: {
              folioLineId: input.folioLineId,
              sourceFolioLineId: source.folio_line_id,
              amountMinor: -discountMinor,
              reason,
            },
            reservationId: source.reservation_id,
          });
          return { ok: true as const, folioLineId: input.folioLineId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async trySplitFolioLine(
    actor: ActorContext,
    input: {
      sourceFolioLineId: string;
      splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineIds: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof SPLIT_AMOUNT_MISMATCH }
    | { ok: false; error: typeof LINE_NOT_SPLITTABLE }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof TRANSFER_CROSS_RESERVATION }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof LIMIT_EXCEEDED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;

    if (input.splits.length > FOLIO_SPLIT_MAX) {
      return { ok: false, error: LIMIT_EXCEEDED };
    }

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
          if (
            source.source === 'SPLIT_REVERSAL' ||
            source.source === 'TAX' ||
            source.source === 'CHARGEBACK' ||
            source.charge_code === 'FX_GAIN' ||
            source.charge_code === 'FX_LOSS' ||
            source.charge_code === 'CHARGEBACK_FEE'
          ) {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }

          const splitTotal = input.splits.reduce((sum, split) => sum + split.amountMinor, 0);
          if (splitTotal !== source.amount_minor) {
            return { ok: false as const, error: SPLIT_AMOUNT_MISMATCH };
          }

          const folioLineIds = this.splitFolioLineSync(source, input.splits, {
            reverseId: `${source.folio_line_id}:split-rev`,
          });
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
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private transferFolioLineSync(input: {
    sourceFolioLineId: string;
    destinationFolioWindowId: string;
    auditContext?: { automated: true; ruleId: string; businessDate: string };
    deskActor?: ActorContext;
  }): { reverseFolioLineId: string; destFolioLineId: string; cityLedgerSynced?: boolean } {
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) throw new Error(PROPERTY_ID_UNSET);

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
    if (!source) throw new FolioWindowError(NOT_FOUND);

    const destFolioLineId = `${source.folio_line_id}:xfer:${input.destinationFolioWindowId}`;
    const reverseFolioLineId = `${source.folio_line_id}:xfer-rev:${input.destinationFolioWindowId}`;
    const existingDest = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM folio_line WHERE folio_line_id = ?`, destFolioLineId)
      .toArray();
    if (existingDest.length > 0) {
      return { reverseFolioLineId, destFolioLineId, cityLedgerSynced: false };
    }

    const txnCurrency = currencyCode(source.txn_currency);
    this.insertFolioLineSync({
      folioLineId: reverseFolioLineId,
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
      source: 'TRANSFER_REVERSAL',
      splitOf: source.folio_line_id,
      paymentId: null,
    });

    const taxLines = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, amount_minor, tax_rule_id, charge_code, ledger_amount_minor,
                txn_currency, fx_rate, fx_rate_at
         FROM folio_line WHERE tax_of = ? AND source = 'TAX'`,
        source.folio_line_id,
      )
      .toArray() as Array<{
      folio_line_id: string;
      amount_minor: number;
      tax_rule_id: string;
      charge_code: string;
      ledger_amount_minor: number;
      txn_currency: string;
      fx_rate: string;
      fx_rate_at: number;
    }>;
    for (const tax of taxLines) {
      this.insertFolioLineSync({
        folioLineId: `${tax.folio_line_id}:xfer-rev:${input.destinationFolioWindowId}`,
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
        source: 'TRANSFER_REVERSAL',
        splitOf: tax.folio_line_id,
        paymentId: null,
      });
    }

    this.insertFolioLineSync({
      folioLineId: destFolioLineId,
      folioWindowId: input.destinationFolioWindowId,
      reservationId: source.reservation_id,
      chargeCode: source.charge_code,
      posted: {
        amountMinor: source.amount_minor,
        txnCurrency,
        ledgerAmountMinor: source.ledger_amount_minor,
        fxRate: source.fx_rate,
        fxRateAt: source.fx_rate_at,
      },
      source: 'TRANSFER',
      splitOf: source.folio_line_id,
      paymentId: null,
    });

    for (const tax of taxLines) {
      this.insertFolioLineSync({
        folioLineId: `${tax.folio_line_id}:xfer:${input.destinationFolioWindowId}`,
        folioWindowId: input.destinationFolioWindowId,
        reservationId: source.reservation_id,
        chargeCode: tax.charge_code,
        posted: {
          amountMinor: tax.amount_minor,
          txnCurrency: currencyCode(tax.txn_currency),
          ledgerAmountMinor: tax.ledger_amount_minor,
          fxRate: tax.fx_rate,
          fxRateAt: tax.fx_rate_at,
        },
        source: 'TAX',
        taxOf: destFolioLineId,
        taxRuleId: tax.tax_rule_id,
        splitOf: source.folio_line_id,
        paymentId: null,
      });
    }

    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'folio.charge_transferred',
      payload: {
        propertyId,
        reservationId: source.reservation_id,
        sourceFolioLineId: source.folio_line_id,
        sourceWindowId: source.folio_window_id,
        destWindowId: input.destinationFolioWindowId,
        destFolioLineId,
        amountMinor: source.amount_minor,
      },
    });

    const auditActor = input.auditContext
      ? this.auditActorSync({ kind: 'system', reason: 'night_audit.auto_transfer' })
      : this.auditActorSync(input.deskActor!);
    const afterJson = input.auditContext
      ? {
          destWindowId: input.destinationFolioWindowId,
          destFolioLineId,
          reverseFolioLineId,
          automated: true as const,
          ruleId: input.auditContext.ruleId,
          businessDate: input.auditContext.businessDate,
        }
      : {
          destWindowId: input.destinationFolioWindowId,
          destFolioLineId,
          reverseFolioLineId,
        };

    this.appendAuditLogSync({
      actor: auditActor,
      commandId: 'folio.transfer_charge',
      entityType: 'folio_line',
      entityId: source.folio_line_id,
      beforeJson: { folioWindowId: source.folio_window_id },
      afterJson,
      reservationId: source.reservation_id,
    });

    const destWindow = this.readFolioWindowRowSync(input.destinationFolioWindowId);
    let cityLedgerSynced = false;
    if (destWindow?.kind === 'COMPANY') {
      const sync = this.syncCityLedgerArForWindowSync({
        folioWindowId: input.destinationFolioWindowId,
        source: 'transfer',
        actor: input.deskActor ?? { kind: 'system', reason: 'night_audit.auto_transfer' },
      });
      if (!sync.ok) throw new CityLedgerError(sync.error);
      cityLedgerSynced = sync.arSynced;
    }

    return { reverseFolioLineId, destFolioLineId, cityLedgerSynced };
  }

  async tryTransferCharge(
    actor: ActorContext,
    input: { sourceFolioLineId: string; destinationFolioWindowId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reverseFolioLineId: string; destFolioLineId: string; cityLedgerSynced?: boolean }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof TRANSFER_CROSS_RESERVATION }
    | { ok: false; error: typeof TRANSFER_SAME_WINDOW }
    | { ok: false; error: typeof LINE_NOT_TRANSFERABLE }
    | { ok: false; error: typeof LINE_ALREADY_TRANSFERRED }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
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
          if (!source) throw new FolioWindowError(NOT_FOUND);
          if (
            source.source === 'TAX' ||
            source.source === 'SPLIT_REVERSAL' ||
            source.source === 'TRANSFER_REVERSAL' ||
            source.source === 'CHARGEBACK' ||
            source.charge_code === 'FX_GAIN' ||
            source.charge_code === 'FX_LOSS' ||
            source.charge_code === 'CHARGEBACK_FEE'
          ) {
            throw new FolioWindowError(LINE_NOT_TRANSFERABLE);
          }
          if (source.folio_window_id === input.destinationFolioWindowId) {
            throw new FolioWindowError(TRANSFER_SAME_WINDOW);
          }

          this.assertFolioWindowOpenSync(source.folio_window_id);
          const destWindow = this.assertFolioWindowOpenSync(input.destinationFolioWindowId);
          if (destWindow.reservationId !== source.reservation_id) {
            throw new FolioWindowError(TRANSFER_CROSS_RESERVATION);
          }

          const destFolioLineId = `${input.sourceFolioLineId}:xfer:${input.destinationFolioWindowId}`;
          const existingDest = this.ctx.storage.sql
            .exec(`SELECT 1 AS one FROM folio_line WHERE folio_line_id = ?`, destFolioLineId)
            .toArray();
          if (existingDest.length === 0) {
            const priorReverse = this.ctx.storage.sql
              .exec(
                `SELECT 1 AS one FROM folio_line
                 WHERE split_of = ? AND source = 'TRANSFER_REVERSAL' LIMIT 1`,
                input.sourceFolioLineId,
              )
              .toArray();
            if (priorReverse.length > 0) {
              throw new FolioWindowError(LINE_ALREADY_TRANSFERRED);
            }

            const otherDest = this.ctx.storage.sql
              .exec(
                `SELECT folio_window_id FROM folio_line
                 WHERE split_of = ? AND source = 'TRANSFER'
                   AND folio_window_id != ?
                 LIMIT 1`,
                input.sourceFolioLineId,
                input.destinationFolioWindowId,
              )
              .toArray() as Array<{ folio_window_id: string }>;
            if (otherDest.length > 0) {
              throw new FolioWindowError(LINE_ALREADY_TRANSFERRED);
            }
          }

          const xfer = this.transferFolioLineSync({
            sourceFolioLineId: input.sourceFolioLineId,
            destinationFolioWindowId: input.destinationFolioWindowId,
            deskActor: actor,
          });
          return {
            ok: true as const,
            reverseFolioLineId: xfer.reverseFolioLineId,
            destFolioLineId: xfer.destFolioLineId,
            cityLedgerSynced: xfer.cityLedgerSynced,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private readPaymentRowSync(paymentId: string): PaymentRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
                capture_fingerprint, tender_type, shift_id, purpose, refunded_amount_minor,
                void_fingerprint, refund_fingerprint,
                fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
                card_last4, card_brand, created_at, updated_at
         FROM payment WHERE payment_id = ?`,
        paymentId,
      )
      .toArray() as PaymentRow[];
    return rows[0] ?? null;
  }

  private readPaymentDisputeSync(paymentId: string): {
    disputeId: string;
    status: 'open' | 'closed';
    reason: string;
    openedAt: number;
  } | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT dispute_id, status, reason, opened_at FROM payment_dispute WHERE payment_id = ? LIMIT 1`,
        paymentId,
      )
      .toArray() as Array<{
      dispute_id: string;
      status: 'open' | 'closed';
      reason: string;
      opened_at: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      disputeId: row.dispute_id,
      status: row.status,
      reason: row.reason,
      openedAt: row.opened_at,
    };
  }

  private readPaymentByIdempotencyKeySync(idempotencyKey: string): PaymentRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
                capture_fingerprint, tender_type, shift_id, purpose, refunded_amount_minor,
                void_fingerprint, refund_fingerprint,
                fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
                card_last4, card_brand, created_at, updated_at
         FROM payment WHERE idempotency_key = ?`,
        idempotencyKey,
      )
      .toArray() as PaymentRow[];
    return rows[0] ?? null;
  }

  private resolveCapturePostedSync(
    txnAmountMinor: number,
    txnCurrency: string,
    at: number,
  ): PostedLineAmount {
    const ledger = this.readStoredLedgerCurrencySync();
    if (!ledger) throw new Error(CURRENCY_UNSET);
    const code = currencyCode(txnCurrency);
    if (code === ledger) {
      return postToLedger(money(-txnAmountMinor, code), ledger, '1', at);
    }
    const quote = this.lookupFxRateSync(code, ledger, at);
    if (!quote) throw new Error(FX_RATE_MISSING);
    return postToLedger(money(-txnAmountMinor, code), ledger, quote.rate, at);
  }

  private recordPaymentEventRowSync(input: {
    eventId: string;
    eventType: string;
    gatewayReference: string | null;
    paymentId: string | null;
  }): 'applied' | 'duplicate' {
    const byId = this.ctx.storage.sql
      .exec(`SELECT event_id FROM payment_event WHERE event_id = ?`, input.eventId)
      .toArray();
    if (byId.length > 0) return 'duplicate';
    if (input.gatewayReference) {
      const byGw = this.ctx.storage.sql
        .exec(
          `SELECT event_id FROM payment_event WHERE event_type = ? AND gateway_reference = ?`,
          input.eventType,
          input.gatewayReference,
        )
        .toArray();
      if (byGw.length > 0) return 'duplicate';
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO payment_event (event_id, event_type, gateway_reference, payment_id, applied_at)
       VALUES (?, ?, ?, ?, ?)`,
      input.eventId,
      input.eventType,
      input.gatewayReference,
      input.paymentId,
      Date.now(),
    );
    return 'applied';
  }

  private applyPaymentEventSync(event: {
    type:
      | 'payment.authorized'
      | 'payment.captured'
      | 'payment.refunded'
      | 'payment.failed'
      | 'payment.chargeback_received';
    eventId: string;
    gatewayReference: string | null;
    payload: {
      propertyId: string;
      paymentId: string;
      reservationId: string;
      amountMinor?: number;
      capturedAmountMinor?: number;
      currency?: string;
      folioLineId?: string;
      purpose?: 'STAY' | 'DAMAGE';
      stage?: 'authorize' | 'capture';
      reason?: string;
      feeLedgerMinor?: number;
    };
  }): { applied: boolean; folioLineId?: string } {
    const recorded = this.recordPaymentEventRowSync({
      eventId: event.eventId,
      eventType: event.type,
      gatewayReference: event.gatewayReference,
      paymentId: event.payload.paymentId,
    });
    if (recorded === 'duplicate') {
      return { applied: false };
    }

    const now = Date.now();
    if (event.type === 'payment.authorized') {
      const row = this.readPaymentRowSync(event.payload.paymentId);
      if (row?.status === 'captured') {
        this.ctx.storage.sql.exec(
          `UPDATE payment SET last_payment_event_id = ?, balance_at_risk = 0, updated_at = ? WHERE payment_id = ?`,
          event.eventId,
          now,
          event.payload.paymentId,
        );
        return { applied: true };
      }
      this.ctx.storage.sql.exec(
        `UPDATE payment
         SET status = CASE WHEN status IN ('captured', 'refunded', 'chargeback') THEN status ELSE 'authorized' END,
             gateway_reference = COALESCE(?, gateway_reference),
             last_payment_event_id = ?,
             balance_at_risk = 0,
             updated_at = ?
         WHERE payment_id = ?`,
        event.gatewayReference,
        event.eventId,
        now,
        event.payload.paymentId,
      );
      return { applied: true };
    }

    if (event.type === 'payment.failed') {
      this.ctx.storage.sql.exec(
        `UPDATE payment
         SET status = CASE
               WHEN ? = 'authorize' AND status = 'pending' THEN CASE WHEN ? = 'declined' THEN 'declined' ELSE 'unknown' END
               ELSE status
             END,
             balance_at_risk = 1,
             last_payment_event_id = ?,
             updated_at = ?
         WHERE payment_id = ?`,
        event.payload.stage ?? 'authorize',
        event.payload.reason ?? 'unknown',
        event.eventId,
        now,
        event.payload.paymentId,
      );
      return { applied: true };
    }

    if (event.type === 'payment.captured') {
      const capturedTxn = event.payload.capturedAmountMinor;
      if (capturedTxn == null || capturedTxn <= 0) throw new Error(MONEY_INVALID);
      const currency = event.payload.currency;
      if (!currency) throw new Error(MONEY_INVALID);
      const posted = this.resolveCapturePostedSync(capturedTxn, currency, now);
      const folioLineId = event.payload.folioLineId ?? `${event.payload.paymentId}:capture`;
      const existingLine = this.ctx.storage.sql
        .exec(`SELECT folio_line_id FROM folio_line WHERE folio_line_id = ?`, folioLineId)
        .toArray();
      const row = this.readPaymentRowSync(event.payload.paymentId);
      if (!row) {
        this.ensureGuestFolioWindowSync(event.payload.reservationId);
        const folioWindowId = this.readGuestFolioWindowIdSync(event.payload.reservationId);
        this.ctx.storage.sql.exec(
          `INSERT INTO payment (
             payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
             gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
             capture_fingerprint, tender_type, purpose, fx_rate, fx_rate_at, balance_at_risk,
             last_payment_event_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, NULL, 'CARD', 'STAY', ?, ?, 0, ?, ?, ?)`,
          event.payload.paymentId,
          event.payload.reservationId,
          folioWindowId,
          capturedTxn,
          currency,
          event.gatewayReference,
          capturedTxn,
          `evt:${event.eventId}`,
          event.eventId,
          posted.fxRate,
          posted.fxRateAt,
          event.eventId,
          now,
          now,
        );
      } else if (row.status !== 'captured') {
        this.ctx.storage.sql.exec(
          `UPDATE payment
           SET status = 'captured',
               captured_amount_minor = ?,
               gateway_reference = COALESCE(?, gateway_reference),
               fx_rate = ?,
               fx_rate_at = ?,
               balance_at_risk = 0,
               last_payment_event_id = ?,
               updated_at = ?
           WHERE payment_id = ?`,
          capturedTxn,
          event.gatewayReference,
          posted.fxRate,
          posted.fxRateAt,
          event.eventId,
          now,
          event.payload.paymentId,
        );
      }
      if (existingLine.length === 0) {
        const payment = this.readPaymentRowSync(event.payload.paymentId);
        if (!payment) throw new Error(NOT_FOUND);
        this.assertChargeCodeSync('PAYMENT', { requireActive: true });
        this.insertFolioLineSync({
          folioLineId,
          folioWindowId: payment.folio_window_id,
          reservationId: payment.reservation_id,
          chargeCode: 'PAYMENT',
          posted,
          source: 'PAYMENT',
          paymentId: event.payload.paymentId,
          businessDate: this.resolvePostingBusinessDateSync(),
        });
      }
      return { applied: true, folioLineId };
    }

    if (event.type === 'payment.refunded') {
      const payment = this.readPaymentRowSync(event.payload.paymentId);
      if (!payment || (payment.status !== 'captured' && payment.status !== 'refunded')) {
        throw new Error(PAYMENT_NOT_REFUNDABLE);
      }
      const captureLineId = `${event.payload.paymentId}:capture`;
      const captureRows = this.ctx.storage.sql
        .exec(
          `SELECT folio_line_id, amount_minor, ledger_amount_minor, txn_currency, fx_rate, fx_rate_at
           FROM folio_line WHERE folio_line_id = ? OR payment_id = ? LIMIT 1`,
          captureLineId,
          event.payload.paymentId,
        )
        .toArray() as Array<{
        folio_line_id: string;
        amount_minor: number;
        ledger_amount_minor: number;
        txn_currency: string;
        fx_rate: string;
        fx_rate_at: number;
      }>;
      const capture = captureRows[0];
      if (!capture) throw new Error(NOT_FOUND);

      const rawRefundTxn = event.payload.amountMinor;
      if (
        rawRefundTxn === undefined ||
        !Number.isInteger(rawRefundTxn) ||
        rawRefundTxn <= 0
      ) {
        throw new Error(MONEY_INVALID);
      }
      const refundTxn = rawRefundTxn;
      const capturedBase = payment.captured_amount_minor ?? payment.amount_minor;
      const refundedBase = payment.refunded_amount_minor ?? 0;
      const remaining = capturedBase - refundedBase;
      if (refundTxn > remaining) throw new Error(REFUND_EXCEEDS_REMAINING);

      let refundLineId = event.payload.folioLineId;
      if (!refundLineId) {
        const countRows = this.ctx.storage.sql
          .exec(
            `SELECT COUNT(*) AS c FROM folio_line
             WHERE source = 'PAYMENT_REFUND' AND split_of = ?`,
            capture.folio_line_id,
          )
          .toArray() as Array<{ c: number }>;
        const n = Number(countRows[0]?.c ?? 0) + 1;
        refundLineId = `${event.payload.paymentId}:refund:${n}`;
      }

      const ledgerRatio =
        Math.abs(capture.amount_minor) > 0
          ? Math.abs(capture.ledger_amount_minor) / Math.abs(capture.amount_minor)
          : 1;
      const ledgerRefundMinor = Math.round(refundTxn * ledgerRatio);

      this.assertChargeCodeSync('PAYMENT', { requireActive: true });
      this.insertFolioLineSync({
        folioLineId: refundLineId,
        folioWindowId: payment.folio_window_id,
        reservationId: payment.reservation_id,
        chargeCode: 'PAYMENT',
        posted: {
          amountMinor: refundTxn,
          txnCurrency: currencyCode(capture.txn_currency),
          ledgerAmountMinor: ledgerRefundMinor,
          fxRate: capture.fx_rate,
          fxRateAt: capture.fx_rate_at,
        },
        source: 'PAYMENT_REFUND',
        splitOf: capture.folio_line_id,
        paymentId: null,
        businessDate: this.resolvePostingBusinessDateSync(),
      });

      const newRefunded = refundedBase + refundTxn;
      const terminal = newRefunded >= capturedBase;
      this.ctx.storage.sql.exec(
        `UPDATE payment
         SET refunded_amount_minor = ?,
             status = ?,
             last_payment_event_id = ?,
             updated_at = ?
         WHERE payment_id = ?`,
        newRefunded,
        terminal ? 'refunded' : 'captured',
        event.eventId,
        now,
        event.payload.paymentId,
      );
      return { applied: true, folioLineId: refundLineId };
    }

    if (event.type === 'payment.chargeback_received') {
      const payment = this.readPaymentRowSync(event.payload.paymentId);
      if (!payment || payment.status !== 'captured') {
        throw new PaymentNotChargebackableError();
      }
      const captureLineId = `${event.payload.paymentId}:capture`;
      const captureRows = this.ctx.storage.sql
        .exec(
          `SELECT folio_line_id, amount_minor, ledger_amount_minor, txn_currency, fx_rate, fx_rate_at
           FROM folio_line WHERE folio_line_id = ? OR payment_id = ? LIMIT 1`,
          captureLineId,
          event.payload.paymentId,
        )
        .toArray() as Array<{
        folio_line_id: string;
        amount_minor: number;
        ledger_amount_minor: number;
        txn_currency: string;
        fx_rate: string;
        fx_rate_at: number;
      }>;
      const capture = captureRows[0];
      if (!capture) throw new Error(NOT_FOUND);
      const reversalId = `${event.payload.paymentId}:chargeback`;
      const existingReversal = this.ctx.storage.sql
        .exec(`SELECT folio_line_id FROM folio_line WHERE folio_line_id = ?`, reversalId)
        .toArray();
      if (existingReversal.length === 0) {
        this.assertChargeCodeSync('PAYMENT', { requireActive: true });
        this.insertFolioLineSync({
          folioLineId: reversalId,
          folioWindowId: payment.folio_window_id,
          reservationId: payment.reservation_id,
          chargeCode: 'PAYMENT',
          posted: {
            amountMinor: -capture.amount_minor,
            txnCurrency: currencyCode(capture.txn_currency),
            ledgerAmountMinor: -capture.ledger_amount_minor,
            fxRate: capture.fx_rate,
            fxRateAt: capture.fx_rate_at,
          },
          source: 'CHARGEBACK',
          splitOf: capture.folio_line_id,
          paymentId: null,
          businessDate: this.resolvePostingBusinessDateSync(),
        });
      }
      const feeLedgerMinor = event.payload.feeLedgerMinor ?? 0;
      if (!Number.isInteger(feeLedgerMinor) || feeLedgerMinor < 0) throw new Error(MONEY_INVALID);
      const feeId = `${event.payload.paymentId}:chargeback-fee`;
      const ledger = this.readStoredLedgerCurrencySync();
      if (!ledger) throw new Error(CURRENCY_UNSET);
      const existingFee = this.ctx.storage.sql
        .exec(`SELECT folio_line_id FROM folio_line WHERE folio_line_id = ?`, feeId)
        .toArray();
      if (existingFee.length === 0) {
        this.assertChargeCodeSync('CHARGEBACK_FEE', { requireActive: true });
        this.insertFolioLineSync({
          folioLineId: feeId,
          folioWindowId: payment.folio_window_id,
          reservationId: payment.reservation_id,
          chargeCode: 'CHARGEBACK_FEE',
          posted: {
            amountMinor: feeLedgerMinor,
            txnCurrency: ledger,
            ledgerAmountMinor: feeLedgerMinor,
            fxRate: '1',
            fxRateAt: now,
          },
          source: 'CHARGEBACK',
          businessDate: this.resolvePostingBusinessDateSync(),
        });
      }
      const existingDispute = this.ctx.storage.sql
        .exec(`SELECT dispute_id FROM payment_dispute WHERE payment_id = ?`, event.payload.paymentId)
        .toArray();
      if (existingDispute.length === 0) {
        this.ctx.storage.sql.exec(
          `INSERT INTO payment_dispute (
             dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status
           ) VALUES (?, ?, ?, ?, ?, ?, 'open')`,
          crypto.randomUUID(),
          event.payload.paymentId,
          reversalId,
          feeId,
          event.payload.reason ?? '',
          now,
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE payment SET status = 'chargeback', last_payment_event_id = ?, updated_at = ? WHERE payment_id = ?`,
        event.eventId,
        now,
        event.payload.paymentId,
      );
      return { applied: true, folioLineId: reversalId };
    }

    return { applied: true };
  }

  async applyPaymentEventForTest(event: {
    type:
      | 'payment.authorized'
      | 'payment.captured'
      | 'payment.refunded'
      | 'payment.failed'
      | 'payment.chargeback_received';
    eventId: string;
    gatewayReference: string | null;
    payload: {
      propertyId: string;
      paymentId: string;
      reservationId: string;
      amountMinor?: number;
      capturedAmountMinor?: number;
      currency?: string;
      folioLineId?: string;
      purpose?: 'STAY' | 'DAMAGE';
      stage?: 'authorize' | 'capture';
      reason?: string;
      feeLedgerMinor?: number;
    };
  }): Promise<{ applied: boolean; folioLineId?: string }> {
    this.assertUnsafeLocal('applyPaymentEventForTest');
    return this.ctx.storage.transactionSync(() => this.applyPaymentEventSync(event));
  }

  private mapPaymentRow(row: PaymentRow): {
    paymentId: string;
    reservationId: string;
    amountMinor: number;
    currency: string;
    status: PaymentStatus;
    gatewayReference: string | null;
    capturedAmountMinor: number | null;
    refundedAmountMinor: number;
    tenderType: 'CARD' | 'CASH';
    shiftId: string | null;
    cardLast4: string | null;
    cardBrand: string | null;
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
      refundedAmountMinor: row.refunded_amount_minor ?? 0,
      tenderType: row.tender_type,
      shiftId: row.shift_id,
      cardLast4: row.card_last4,
      cardBrand: row.card_brand,
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
      currency?: string;
      idempotencyKey: string;
      requestFingerprint: string;
      purpose?: 'STAY' | 'DAMAGE';
    },
  ): Promise<
    | { ok: true; paymentId: string; status: PaymentStatus; gatewayReference: string | null }
    | { ok: false; error: typeof NOT_FOUND | typeof PSP_UNAVAILABLE | typeof IDEM_KEY_REUSED | typeof MONEY_INVALID }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof PSP_ADAPTER_FAILED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
    const txnCurrency = input.currency ? currencyCode(input.currency) : ledgerCurrency;

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
               capture_fingerprint, tender_type, shift_id, purpose, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL, 'CARD', ?, ?, ?, ?)`,
            input.paymentId,
            input.reservationId,
            folioWindowId,
            input.amountMinor,
            txnCurrency,
            input.idempotencyKey,
            input.requestFingerprint,
            shiftId,
            input.purpose ?? 'STAY',
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
        if (!inserted) throw new Error(PAYMENT_INSERT_FAILED);
        return inserted;
      });
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }

    if (txn1Row.status !== 'pending') {
      return this.authorizePaymentSuccessFromRow(txn1Row);
    }

    const adapterResult = await simulateAuthorize(
      {
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: txnCurrency,
      },
      this.pspSimulateOutcomeForTest,
    );

    if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
      return { ok: false, error: PSP_ADAPTER_FAILED };
    }

    let txn2Row: PaymentRow | null = null;
    try {
      txn2Row = this.ctx.storage.transactionSync(() => {
        const now = Date.now();
        if (adapterResult.outcome === 'approved') {
          const updated = this.ctx.storage.sql.exec(
            `UPDATE payment
             SET status = 'authorized',
                 gateway_reference = ?,
                 card_last4 = ?,
                 card_brand = ?,
                 updated_at = ?
             WHERE payment_id = ? AND status = 'pending'`,
            adapterResult.gatewayReference,
            adapterResult.cardLast4,
            adapterResult.cardBrand,
            now,
            input.paymentId,
          );
          if (updated.rowsWritten === 0) {
            const current = this.readPaymentRowSync(input.paymentId);
            if (!current) throw new Error(NOT_FOUND);
            return current;
          }
          const authEventId = crypto.randomUUID();
          this.applyPaymentEventSync({
            type: 'payment.authorized',
            eventId: authEventId,
            gatewayReference: adapterResult.gatewayReference,
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              amountMinor: input.amountMinor,
              currency: txnCurrency,
              purpose: input.purpose ?? 'STAY',
            },
          });
          this.appendPropertyOutbox({
            eventId: authEventId,
            eventType: 'folio.payment_authorized',
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              amountMinor: input.amountMinor,
              currency: txnCurrency,
              gatewayReference: adapterResult.gatewayReference,
            },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'payment.authorized',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              amountMinor: input.amountMinor,
              currency: txnCurrency,
              purpose: input.purpose ?? 'STAY',
              eventId: authEventId,
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
              currency: txnCurrency,
              status: 'authorized',
              shiftId: authorizedRow?.shift_id ?? null,
            },
            shiftId: authorizedRow?.shift_id ?? null,
            reservationId: input.reservationId,
          });
        } else if (adapterResult.outcome === 'declined') {
          const failEventId = crypto.randomUUID();
          this.applyPaymentEventSync({
            type: 'payment.failed',
            eventId: failEventId,
            gatewayReference: null,
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              stage: 'authorize',
              reason: 'declined',
            },
          });
          this.appendPropertyOutbox({
            eventId: failEventId,
            eventType: 'payment.failed',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              stage: 'authorize',
              reason: 'declined',
            },
          });
        } else {
          const failEventId = crypto.randomUUID();
          this.applyPaymentEventSync({
            type: 'payment.failed',
            eventId: failEventId,
            gatewayReference: null,
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              stage: 'authorize',
              reason: adapterResult.outcome === 'timeout' ? 'timeout' : 'unknown',
            },
          });
          this.appendPropertyOutbox({
            eventId: failEventId,
            eventType: 'payment.failed',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: input.reservationId,
              stage: 'authorize',
              reason: adapterResult.outcome === 'timeout' ? 'timeout' : 'unknown',
            },
          });
        }

        const current = this.readPaymentRowSync(input.paymentId);
        if (!current) throw new Error(NOT_FOUND);
        return current;
      });
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }

    return this.authorizePaymentSuccessFromRow(txn2Row);
  }

  /**
   * Operator-asserted exit from authorize-timeout `unknown`. Implements catalog `folio.reconcile_payment`.
   * Fingerprint allowlist: `{ paymentId, outcome, gatewayReference? }`.
   * Never calls PSP — must not gate on pspSimulateEnabled().
   */
  async tryReconcilePayment(
    actor: ActorContext,
    input: { paymentId: string; outcome: 'authorized' | 'declined'; gatewayReference?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; paymentId: string; status: 'authorized' | 'declined'; gatewayReference: string | null }
    | { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_RECONCILABLE | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof PROPERTY_ID_UNSET | typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const payment = this.readPaymentRowSync(input.paymentId);
          if (!payment) throw new Error(NOT_FOUND);

          if (payment.status !== 'unknown') {
            throw new Error(PAYMENT_NOT_RECONCILABLE);
          }

          const now = Date.now();

          if (input.outcome === 'authorized') {
            const gwBind = input.gatewayReference ?? null;
            const updated = this.ctx.storage.sql.exec(
              `UPDATE payment
               SET status = 'authorized',
                   gateway_reference = COALESCE(?, gateway_reference),
                   balance_at_risk = 0,
                   updated_at = ?
               WHERE payment_id = ? AND status = 'unknown'`,
              gwBind,
              now,
              input.paymentId,
            );
            if (updated.rowsWritten === 0) {
              const current = this.readPaymentRowSync(input.paymentId);
              if (!current) throw new Error(NOT_FOUND);
              if (current.status === 'authorized') {
                return {
                  ok: true as const,
                  paymentId: current.payment_id,
                  status: 'authorized' as const,
                  gatewayReference: current.gateway_reference,
                };
              }
              throw new Error(PAYMENT_NOT_RECONCILABLE);
            }

            const row = this.readPaymentRowSync(input.paymentId)!;
            const authEventId = crypto.randomUUID();
            this.appendPropertyOutbox({
              eventId: authEventId,
              eventType: 'folio.payment_authorized',
              payload: {
                propertyId,
                paymentId: input.paymentId,
                reservationId: row.reservation_id,
                amountMinor: row.amount_minor,
                currency: row.currency,
                gatewayReference: row.gateway_reference,
              },
            });
            this.appendPropertyOutbox({
              eventId: crypto.randomUUID(),
              eventType: 'payment.authorized',
              payload: {
                version: 1,
                propertyId,
                paymentId: input.paymentId,
                reservationId: row.reservation_id,
                amountMinor: row.amount_minor,
                currency: row.currency,
                purpose: row.purpose ?? 'STAY',
                eventId: authEventId,
                gatewayReference: row.gateway_reference,
              },
            });
            this.appendAuditLogSync({
              actor: this.auditActorSync(actor),
              commandId: 'folio.reconcile_payment',
              entityType: 'payment',
              entityId: input.paymentId,
              beforeJson: { paymentId: input.paymentId, status: 'unknown' },
              afterJson: {
                paymentId: input.paymentId,
                status: 'authorized',
                gatewayReference: row.gateway_reference,
              },
              shiftId: row.shift_id,
              reservationId: row.reservation_id,
            });
            return {
              ok: true as const,
              paymentId: input.paymentId,
              status: 'authorized' as const,
              gatewayReference: row.gateway_reference,
            };
          }

          const declinedUpdated = this.ctx.storage.sql.exec(
            `UPDATE payment
             SET status = 'declined',
                 balance_at_risk = 0,
                 updated_at = ?
             WHERE payment_id = ? AND status = 'unknown'`,
            now,
            input.paymentId,
          );
          if (declinedUpdated.rowsWritten === 0) {
            const current = this.readPaymentRowSync(input.paymentId);
            if (!current) throw new Error(NOT_FOUND);
            if (current.status === 'declined') {
              return {
                ok: true as const,
                paymentId: current.payment_id,
                status: 'declined' as const,
                gatewayReference: current.gateway_reference,
              };
            }
            throw new Error(PAYMENT_NOT_RECONCILABLE);
          }

          const row = this.readPaymentRowSync(input.paymentId)!;
          const failEventId = crypto.randomUUID();
          this.appendPropertyOutbox({
            eventId: failEventId,
            eventType: 'payment.failed',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: row.reservation_id,
              stage: 'authorize',
              reason: 'declined',
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.reconcile_payment',
            entityType: 'payment',
            entityId: input.paymentId,
            beforeJson: { paymentId: input.paymentId, status: 'unknown' },
            afterJson: { paymentId: input.paymentId, status: 'declined' },
            shiftId: row.shift_id,
            reservationId: row.reservation_id,
          });
          return {
            ok: true as const,
            paymentId: input.paymentId,
            status: 'declined' as const,
            gatewayReference: row.gateway_reference,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof Error && e.message === NOT_FOUND) return { ok: false, error: NOT_FOUND };
      if (e instanceof Error && e.message === PAYMENT_NOT_RECONCILABLE) {
        return { ok: false, error: PAYMENT_NOT_RECONCILABLE };
      }
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryCapturePayment(
    actor: ActorContext,
    input: {
      paymentId: string;
      amountMinor: number;
      idempotencyKey: string;
      captureFingerprint: string;
    },
    opts?: { skipGates?: boolean },
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
          | typeof MONEY_INVALID
          | typeof FX_RATE_MISSING;
      }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    if (!opts?.skipGates) {
      const denied = await this.gateCoreEntitlement(orgId);
      if (denied) return denied;

      const permDenied = await this.gatePermission(actor, 'folio:post');
      if (permDenied) return permDenied;
    }

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

    try {
      this.resolveCapturePostedSync(input.amountMinor, payment.currency, Date.now());
    } catch (e) {
      if (e instanceof Error && e.message === FX_RATE_MISSING) {
        return { ok: false, error: FX_RATE_MISSING };
      }
      throw e;
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
      const failEventId = crypto.randomUUID();
      this.ctx.storage.transactionSync(() => {
        this.applyPaymentEventSync({
          type: 'payment.failed',
          eventId: failEventId,
          gatewayReference: payment.gateway_reference,
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            stage: 'capture',
            reason: adapterResult.outcome === 'timeout' ? 'timeout' : adapterResult.outcome === 'declined' ? 'declined' : 'unknown',
          },
        });
        this.appendPropertyOutbox({
          eventId: failEventId,
          eventType: 'payment.failed',
          payload: {
            version: 1,
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            stage: 'capture',
            reason: adapterResult.outcome === 'timeout' ? 'timeout' : adapterResult.outcome === 'declined' ? 'declined' : 'unknown',
          },
        });
        if (adapterResult.outcome === 'timeout') {
          this.ctx.storage.sql.exec(
            `UPDATE payment SET status = 'unknown', updated_at = ? WHERE payment_id = ? AND status = 'authorized'`,
            Date.now(),
            input.paymentId,
          );
        }
      });
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
      return { ok: false, error: PSP_ADAPTER_FAILED };
    }

    if (adapterResult.capturedAmountMinor > payment.amount_minor) {
      return { ok: false, error: PAYMENT_NOT_CAPTURABLE };
    }

    try {
      return this.ctx.storage.transactionSync(() => {
        const postedPreview = this.resolveCapturePostedSync(
          adapterResult.capturedAmountMinor,
          payment.currency,
          Date.now(),
        );
        const updated = this.ctx.storage.sql.exec(
          `UPDATE payment
           SET status = 'captured',
               captured_amount_minor = ?,
               capture_fingerprint = ?,
               gateway_reference = ?,
               fx_rate = ?,
               fx_rate_at = ?,
               balance_at_risk = 0,
               updated_at = ?
           WHERE payment_id = ? AND status = 'authorized'`,
          adapterResult.capturedAmountMinor,
          input.captureFingerprint,
          adapterResult.gatewayReference,
          postedPreview.fxRate,
          postedPreview.fxRateAt,
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
        const captureEventId = crypto.randomUUID();
        const applied = this.applyPaymentEventSync({
          type: 'payment.captured',
          eventId: captureEventId,
          gatewayReference: adapterResult.gatewayReference,
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            capturedAmountMinor: adapterResult.capturedAmountMinor,
            currency: payment.currency,
            folioLineId,
          },
        });

        this.appendPropertyOutbox({
          eventId: captureEventId,
          eventType: 'folio.payment_captured',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            capturedAmountMinor: adapterResult.capturedAmountMinor,
            currency: payment.currency,
            gatewayReference: adapterResult.gatewayReference,
            folioLineId: applied.folioLineId ?? folioLineId,
          },
        });
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'payment.captured',
          payload: {
            version: 1,
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            capturedAmountMinor: adapterResult.capturedAmountMinor,
            currency: payment.currency,
            folioLineId: applied.folioLineId ?? folioLineId,
            eventId: captureEventId,
            gatewayReference: adapterResult.gatewayReference,
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
      if (e instanceof Error && e.message === FX_RATE_MISSING) {
        return { ok: false, error: FX_RATE_MISSING };
      }
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private async voidAuthorizedCardHoldSync(
    actor: ActorContext,
    input: { paymentId: string; voidFingerprint: string },
    opts?: { automated?: boolean },
  ): Promise<
    | { ok: true; paymentId: string; status: 'voided' }
    | { ok: false; error: typeof NOT_FOUND | typeof PAYMENT_NOT_VOIDABLE | typeof PSP_UNAVAILABLE | typeof PSP_ADAPTER_FAILED }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };
    if (payment.status === 'voided' && payment.void_fingerprint === input.voidFingerprint) {
      return { ok: true, paymentId: payment.payment_id, status: 'voided' };
    }
    if (payment.tender_type === 'CASH' || payment.status !== 'authorized') {
      return { ok: false, error: PAYMENT_NOT_VOIDABLE };
    }

    const adapterResult = await simulateVoid(
      {
        paymentId: input.paymentId,
        gatewayReference: payment.gateway_reference ?? `sim_${input.paymentId}`,
      },
      this.pspSimulateOutcomeForTest,
    );
    if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
      return { ok: false, error: PSP_ADAPTER_FAILED };
    }
    if (adapterResult.outcome !== 'approved') {
      return { ok: false, error: PAYMENT_NOT_VOIDABLE };
    }

    try {
      return this.ctx.storage.transactionSync(() => {
        const updated = this.ctx.storage.sql.exec(
          `UPDATE payment
           SET status = 'voided', void_fingerprint = ?, updated_at = ?
           WHERE payment_id = ? AND status = 'authorized'`,
          input.voidFingerprint,
          Date.now(),
          input.paymentId,
        );
        if (updated.rowsWritten === 0) {
          const current = this.readPaymentRowSync(input.paymentId);
          if (!current) return { ok: false as const, error: NOT_FOUND };
          if (current.status === 'voided' && current.void_fingerprint === input.voidFingerprint) {
            return { ok: true as const, paymentId: current.payment_id, status: 'voided' as const };
          }
          return { ok: false as const, error: PAYMENT_NOT_VOIDABLE };
        }
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'folio.payment_voided',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: payment.reservation_id,
            gatewayReference: adapterResult.gatewayReference,
          },
        });
        this.appendAuditLogSync({
          actor: this.auditActorSync(actor),
          commandId: 'folio.void',
          entityType: 'payment',
          entityId: input.paymentId,
          beforeJson: { status: 'authorized' },
          afterJson: {
            status: 'voided',
            ...(opts?.automated ? { automated: true } : {}),
          },
          reservationId: payment.reservation_id,
        });
        return { ok: true as const, paymentId: input.paymentId, status: 'voided' as const };
      });
    } catch (e) {
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private async runAuthHoldLapseSync(): Promise<void> {
    const hours = Number(this.readConfigValueSync('pms.payments.auth_hold_hours') ?? 72);
    const cutoff = Date.now() - hours * 3_600_000;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT payment_id FROM payment
         WHERE status = 'authorized' AND tender_type = 'CARD' AND created_at <= ?`,
        cutoff,
      )
      .toArray() as Array<{ payment_id: string }>;

    const actor: ActorContext = { kind: 'system', reason: 'auth_hold_lapse' };
    for (const row of rows) {
      const paymentId = row.payment_id;
      const voidFingerprint = `auth_hold_lapse:${paymentId}`;
      const result = await this.voidAuthorizedCardHoldSync(
        actor,
        { paymentId, voidFingerprint },
        { automated: true },
      );
      if (!result.ok) {
        console.warn('[auth-hold-lapse] skip', paymentId, result.error);
      }
    }
  }

  async tryVoidPayment(
    actor: ActorContext,
    input: { paymentId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; paymentId: string; status: 'voided' }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof PAYMENT_NOT_VOIDABLE }
    | { ok: false; error: typeof PSP_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;
    if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };
    if (payment.status === 'voided') {
      if (payment.void_fingerprint === idem.fingerprint) {
        return { ok: true, paymentId: payment.payment_id, status: 'voided' };
      }
      return { ok: false, error: IDEM_KEY_REUSED };
    }
    if (payment.tender_type === 'CASH' || payment.status !== 'authorized') {
      return { ok: false, error: PAYMENT_NOT_VOIDABLE };
    }

    const core = await this.voidAuthorizedCardHoldSync(
      actor,
      { paymentId: input.paymentId, voidFingerprint: idem.fingerprint },
    );
    if (!core.ok) {
      if (core.error === IDEM_KEY_REUSED) return { ok: false, error: IDEM_KEY_REUSED };
      return core;
    }
    return core;
  }

  async tryRefundPayment(
    actor: ActorContext,
    input: { paymentId: string; amountMinor: number },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; paymentId: string; status: 'captured' | 'refunded'; refundedAmountMinor: number }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof PAYMENT_NOT_REFUNDABLE }
    | { ok: false; error: typeof REFUND_EXCEEDS_REMAINING }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof PSP_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: MONEY_INVALID };
    }

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };

    const capturedBase = payment.captured_amount_minor ?? payment.amount_minor;
    const refundedBase = payment.refunded_amount_minor ?? 0;
    const remainingMinor = capturedBase - refundedBase;

    if (payment.status === 'refunded') {
      if (payment.refund_fingerprint === idem.fingerprint) {
        return {
          ok: true,
          paymentId: payment.payment_id,
          status: 'refunded',
          refundedAmountMinor: capturedBase,
        };
      }
      return { ok: false, error: IDEM_KEY_REUSED };
    }

    if (input.amountMinor > remainingMinor) {
      return { ok: false, error: REFUND_EXCEEDS_REMAINING };
    }

    if (payment.status !== 'captured') {
      return { ok: false, error: PAYMENT_NOT_REFUNDABLE };
    }

    const prior = this.lookupIdempotentResponse<{
      ok: true;
      paymentId: string;
      status: 'captured' | 'refunded';
      refundedAmountMinor: number;
    }>(idem);
    if (prior === 'fingerprint_mismatch') {
      return { ok: false, error: IDEM_KEY_REUSED };
    }
    if (prior) {
      return prior;
    }

    if (payment.tender_type === 'CARD') {
      if (!this.pspSimulateEnabled()) return { ok: false, error: PSP_UNAVAILABLE };
      const adapterResult = await simulateRefund(
        {
          paymentId: input.paymentId,
          amountMinor: input.amountMinor,
          gatewayReference: payment.gateway_reference ?? `sim_${input.paymentId}`,
          currency: payment.currency,
        },
        this.pspSimulateOutcomeForTest,
      );
      if (this.pspSimulateOutcomeForTest?.failAfterAdapter) {
        return { ok: false, error: PSP_ADAPTER_FAILED };
      }
      if (adapterResult.outcome !== 'approved') {
        return { ok: false, error: PAYMENT_NOT_REFUNDABLE };
      }
    }

    try {
      return this.ctx.storage.transactionSync(() => {
        return runIdempotent(this.ctx.storage.sql, idem, () => {
          const current = this.readPaymentRowSync(input.paymentId);
          if (!current) return { ok: false as const, error: NOT_FOUND };

          const currentCapturedBase = current.captured_amount_minor ?? current.amount_minor;
          const currentRefundedBase = current.refunded_amount_minor ?? 0;
          const currentRemaining = currentCapturedBase - currentRefundedBase;

          if (current.status === 'refunded') {
            if (current.refund_fingerprint === idem.fingerprint) {
              return {
                ok: true as const,
                paymentId: current.payment_id,
                status: 'refunded' as const,
                refundedAmountMinor: currentCapturedBase,
              };
            }
            throw new IdempotencyKeyReused(idem.key);
          }
          if (current.status !== 'captured') {
            throw new Error(PAYMENT_NOT_REFUNDABLE);
          }
          if (input.amountMinor > currentRemaining) {
            throw new Error(REFUND_EXCEEDS_REMAINING);
          }

          const captureLineId = `${input.paymentId}:capture`;
          const captureRows = this.ctx.storage.sql
            .exec(
              `SELECT folio_line_id FROM folio_line WHERE folio_line_id = ? OR payment_id = ? LIMIT 1`,
              captureLineId,
              input.paymentId,
            )
            .toArray() as Array<{ folio_line_id: string }>;
          const captureFolioLineId = captureRows[0]?.folio_line_id;
          if (!captureFolioLineId) throw new Error(NOT_FOUND);

          const countRows = this.ctx.storage.sql
            .exec(
              `SELECT COUNT(*) AS c FROM folio_line
               WHERE source = 'PAYMENT_REFUND' AND split_of = ?`,
              captureFolioLineId,
            )
            .toArray() as Array<{ c: number }>;
          const refundLineId = `${input.paymentId}:refund:${Number(countRows[0]?.c ?? 0) + 1}`;

          const refundEventId = crypto.randomUUID();
          const refundGatewayReference = `${payment.gateway_reference ?? `sim_${input.paymentId}`}:${refundLineId}`;
          const applied = this.applyPaymentEventSync({
            type: 'payment.refunded',
            eventId: refundEventId,
            gatewayReference: refundGatewayReference,
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: payment.reservation_id,
              amountMinor: input.amountMinor,
              currency: payment.currency,
              folioLineId: refundLineId,
            },
          });
          if (!applied.applied) {
            throw new Error(PAYMENT_NOT_REFUNDABLE);
          }
          const appliedRefundLineId = applied.folioLineId ?? refundLineId;

          this.ctx.storage.sql.exec(
            `UPDATE payment SET refund_fingerprint = ? WHERE payment_id = ?`,
            idem.fingerprint,
            input.paymentId,
          );

          const updated = this.readPaymentRowSync(input.paymentId)!;
          const newRefundedAmountMinor = updated.refunded_amount_minor ?? 0;
          const terminalStatus = updated.status === 'refunded' ? 'refunded' : 'captured';

          this.appendPropertyOutbox({
            eventId: refundEventId,
            eventType: 'folio.payment_refunded',
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: payment.reservation_id,
              amountMinor: input.amountMinor,
              currency: payment.currency,
              folioLineId: appliedRefundLineId,
            },
          });
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'payment.refunded',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: payment.reservation_id,
              amountMinor: input.amountMinor,
              currency: payment.currency,
              folioLineId: appliedRefundLineId,
              eventId: refundEventId,
              gatewayReference: payment.gateway_reference,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.refund',
            entityType: 'payment',
            entityId: input.paymentId,
            beforeJson: { status: 'captured', refundedAmountMinor: currentRefundedBase },
            afterJson: {
              status: terminalStatus,
              amountMinor: input.amountMinor,
              refundedAmountMinor: newRefundedAmountMinor,
            },
            reservationId: payment.reservation_id,
          });

          return {
            ok: true as const,
            paymentId: input.paymentId,
            status: terminalStatus,
            refundedAmountMinor: newRefundedAmountMinor,
          };
        });
      });
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryRecordChargeback(
    actor: ActorContext,
    input: { paymentId: string; feeLedgerMinor: number; reason: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; paymentId: string; status: 'chargeback' }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof PAYMENT_NOT_CHARGEBACKABLE }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (!Number.isInteger(input.feeLedgerMinor) || input.feeLedgerMinor < 0) {
      return { ok: false, error: MONEY_INVALID };
    }

    const payment = this.readPaymentRowSync(input.paymentId);
    if (!payment) return { ok: false, error: NOT_FOUND };
    if ((payment.refunded_amount_minor ?? 0) > 0) {
      return { ok: false, error: PAYMENT_NOT_CHARGEBACKABLE };
    }
    if (payment.status !== 'captured' && payment.status !== 'chargeback') {
      return { ok: false, error: PAYMENT_NOT_CHARGEBACKABLE };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const current = this.readPaymentRowSync(input.paymentId);
          if (!current) throw new Error(NOT_FOUND);
          if (current.status === 'chargeback') throw new PaymentNotChargebackableError();
          if (current.status !== 'captured') throw new PaymentNotChargebackableError();

          const eventId = crypto.randomUUID();
          const applied = this.applyPaymentEventSync({
            type: 'payment.chargeback_received',
            eventId,
            gatewayReference: current.gateway_reference,
            payload: {
              propertyId,
              paymentId: input.paymentId,
              reservationId: current.reservation_id,
              amountMinor: current.captured_amount_minor ?? current.amount_minor,
              currency: current.currency,
              feeLedgerMinor: input.feeLedgerMinor,
              reason: input.reason,
            },
          });

          this.appendPropertyOutbox({
            eventId,
            eventType: 'payment.chargeback_received',
            payload: {
              version: 1,
              propertyId,
              paymentId: input.paymentId,
              reservationId: current.reservation_id,
              amountMinor: current.captured_amount_minor ?? current.amount_minor,
              currency: current.currency,
              feeLedgerMinor: input.feeLedgerMinor,
              reason: input.reason,
              eventId,
              gatewayReference: current.gateway_reference,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.record_chargeback',
            entityType: 'payment',
            entityId: input.paymentId,
            beforeJson: { status: 'captured' },
            afterJson: {
              status: 'chargeback',
              feeLedgerMinor: input.feeLedgerMinor,
              reason: input.reason,
              folioLineId: applied.folioLineId,
            },
            reservationId: current.reservation_id,
          });
          return { ok: true as const, paymentId: input.paymentId, status: 'chargeback' as const };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof PaymentNotChargebackableError) {
        return { ok: false, error: PAYMENT_NOT_CHARGEBACKABLE };
      }
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryPostFxAdjustment(
    actor: ActorContext,
    input: {
      reservationId: string;
      folioWindowId: string;
      kind: 'gain' | 'loss';
      amountMinor: number;
      reason: string;
      sourcePaymentId?: string;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineId: string }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof FX_REASON_REQUIRED }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof MONEY_INVALID }
    | { ok: false; error: typeof CURRENCY_UNSET }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 500) {
      return { ok: false, error: FX_REASON_REQUIRED };
    }
    if (input.kind !== 'gain' && input.kind !== 'loss') {
      return { ok: false, error: MONEY_INVALID };
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: MONEY_INVALID };
    }

    const ledger = this.readStoredLedgerCurrencySync();
    if (!ledger) return { ok: false, error: CURRENCY_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const window = this.assertFolioWindowOpenSync(input.folioWindowId);
          if (window.reservationId !== input.reservationId) throw new Error(NOT_FOUND);

          const folioLineId = crypto.randomUUID();
          const signed = input.kind === 'gain' ? -input.amountMinor : input.amountMinor;
          const chargeCode = input.kind === 'gain' ? 'FX_GAIN' : 'FX_LOSS';
          this.assertChargeCodeSync(chargeCode, { requireActive: true });
          this.insertFolioLineSync({
            folioLineId,
            folioWindowId: input.folioWindowId,
            reservationId: input.reservationId,
            chargeCode,
            posted: {
              amountMinor: signed,
              txnCurrency: ledger,
              ledgerAmountMinor: signed,
              fxRate: '1',
              fxRateAt: Date.now(),
            },
            source: 'DESK',
          });

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'folio.fx_adjusted',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              folioWindowId: input.folioWindowId,
              folioLineId,
              kind: input.kind,
              amountMinor: signed,
              reason,
              sourcePaymentId: input.sourcePaymentId ?? null,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.post_fx_adjustment',
            entityType: 'folio_line',
            entityId: folioLineId,
            beforeJson: null,
            afterJson: {
              folioLineId,
              kind: input.kind,
              amountMinor: signed,
              reason,
              sourcePaymentId: input.sourcePaymentId ?? null,
            },
            reservationId: input.reservationId,
          });
          return { ok: true as const, folioLineId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryCaptureDueHolds(
    actor: ActorContext,
    input: { reservationId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; captured: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof PSP_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;

    const prior = this.ctx.storage.sql
      .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
      .toArray() as Array<{ request_fingerprint: string; response: string }>;
    if (prior[0]) {
      if (prior[0].request_fingerprint !== idem.fingerprint) {
        return { ok: false, error: IDEM_KEY_REUSED };
      }
      return JSON.parse(prior[0].response) as { ok: true; captured: string[] };
    }

    try {
      const captured = await this.captureDueHoldsInner(actor, input.reservationId);
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => ({ ok: true as const, captured })),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  private async captureDueHoldsInner(
    actor: ActorContext,
    reservationId: string,
    opts?: { skipGates?: boolean; throwOnFailure?: boolean },
  ): Promise<string[]> {
    const resRows = this.ctx.storage.sql
      .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray();
    if (!resRows[0]) throw new Error(NOT_FOUND);

    const balanceRow = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS balance FROM folio_line WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{ balance: number }>;
    let remaining = Number(balanceRow[0]?.balance ?? 0);
    if (remaining <= 0) return [];

    const holds = this.ctx.storage.sql
      .exec(
        `SELECT payment_id, amount_minor, currency FROM payment
         WHERE reservation_id = ? AND status = 'authorized' AND purpose = 'STAY' AND tender_type = 'CARD'
         ORDER BY created_at ASC, payment_id ASC`,
        reservationId,
      )
      .toArray() as Array<{ payment_id: string; amount_minor: number; currency: string }>;

    const ledger = this.readStoredLedgerCurrencySync();
    if (!ledger) throw new Error(CURRENCY_UNSET);

    const captured: string[] = [];
    for (const hold of holds) {
      if (remaining <= 0) break;
      const now = Date.now();
      const txnCurrency = currencyCode(hold.currency);
      const rate =
        txnCurrency === ledger
          ? '1'
          : this.lookupFxRateSync(txnCurrency, ledger, now)?.rate;
      if (!rate) continue;
      const availableLedger = postToLedger(
        money(hold.amount_minor, txnCurrency),
        ledger,
        rate,
        now,
      ).ledgerAmountMinor;
      const takeLedger = Math.min(availableLedger, remaining);
      const takeTxn =
        takeLedger === availableLedger
          ? hold.amount_minor
          : ledgerToTxn(takeLedger, txnCurrency, ledger, rate);
      if (takeTxn <= 0) continue;
      const result = await this.tryCapturePayment(
        actor,
        {
          paymentId: hold.payment_id,
          amountMinor: takeTxn,
          idempotencyKey: `capture-due:${hold.payment_id}`,
          captureFingerprint: await fingerprintPayload({
            paymentId: hold.payment_id,
            amountMinor: takeTxn,
            source: 'capture_due',
          }),
        },
        { skipGates: opts?.skipGates },
      );
      if (result.ok) {
        captured.push(hold.payment_id);
        const posted = this.ctx.storage.sql
          .exec(
            `SELECT ledger_amount_minor FROM folio_line WHERE folio_line_id = ?`,
            `${hold.payment_id}:capture`,
          )
          .toArray() as Array<{ ledger_amount_minor: number }>;
        remaining -= Math.abs(Number(posted[0]?.ledger_amount_minor ?? 0));
      } else if (opts?.throwOnFailure) {
        throw new Error(result.error);
      }
    }
    return captured;
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
    | { ok: false; error: typeof PROPERTY_ID_UNSET | typeof BUSINESS_DATE_UNSET | typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
    | { ok: false; error: typeof PROPERTY_ID_UNSET | typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryRecordCashPayment(
    actor: ActorContext,
    input: {
      paymentId: string;
      reservationId: string;
      amountMinor: number;
      currency?: string;
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
    | { ok: false; error: typeof MONEY_INVALID | typeof NOT_FOUND | typeof IDEM_KEY_REUSED | typeof FX_RATE_MISSING }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof CURRENCY_UNSET | typeof PROPERTY_ID_UNSET | typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
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
    const txnCurrency = input.currency ? currencyCode(input.currency) : ledgerCurrency;
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
        const posted = this.resolveCapturePostedSync(input.amountMinor, txnCurrency, now);
        this.ctx.storage.sql.exec(
          `INSERT INTO payment (
             payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
             gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
             capture_fingerprint, tender_type, shift_id, fx_rate, fx_rate_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'captured', NULL, ?, ?, ?, NULL, 'CASH', ?, ?, ?, ?, ?)`,
          input.paymentId,
          input.reservationId,
          folioWindowId,
          input.amountMinor,
          txnCurrency,
          input.amountMinor,
          input.idempotencyKey,
          input.requestFingerprint,
          shiftId,
          posted.fxRate,
          posted.fxRateAt,
          now,
          now,
        );

        const folioLineId = `${input.paymentId}:capture`;
        const cashEventId = crypto.randomUUID();
        this.applyPaymentEventSync({
          type: 'payment.captured',
          eventId: cashEventId,
          gatewayReference: null,
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: input.reservationId,
            capturedAmountMinor: input.amountMinor,
            currency: txnCurrency,
            folioLineId,
          },
        });

        this.appendPropertyOutbox({
          eventId: cashEventId,
          eventType: 'folio.payment_captured',
          payload: {
            propertyId,
            paymentId: input.paymentId,
            reservationId: input.reservationId,
            capturedAmountMinor: input.amountMinor,
            currency: txnCurrency,
            gatewayReference: null,
            folioLineId,
            tenderType: 'CASH',
            shiftId,
          },
        });
        this.appendPropertyOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'payment.captured',
          payload: {
            version: 1,
            propertyId,
            paymentId: input.paymentId,
            reservationId: input.reservationId,
            capturedAmountMinor: input.amountMinor,
            currency: txnCurrency,
            folioLineId,
            eventId: cashEventId,
            gatewayReference: null,
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
      if (e instanceof Error && e.message === FX_RATE_MISSING) {
        return { ok: false, error: FX_RATE_MISSING };
      }
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
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
          refundedAmountMinor: number;
          tenderType: 'CARD' | 'CASH';
          shiftId: string | null;
          cardLast4: string | null;
          cardBrand: string | null;
          createdAt: number;
          updatedAt: number;
          dispute: {
            disputeId: string;
            status: 'open' | 'closed';
            reason: string;
            openedAt: number;
          } | null;
        };
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const row = this.readPaymentRowSync(paymentId);
    if (!row) return { ok: false, error: NOT_FOUND };
    return { ok: true, payment: { ...this.mapPaymentRow(row), dispute: this.readPaymentDisputeSync(paymentId) } };
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
          purpose: 'STAY' | 'DAMAGE';
          gatewayReference: string | null;
          capturedAmountMinor: number | null;
          refundedAmountMinor: number;
          createdAt: number;
          updatedAt: number;
          tenderType: 'CARD' | 'CASH';
          cardLast4: string | null;
          cardBrand: string | null;
          dispute: {
            disputeId: string;
            status: 'open' | 'closed';
            reason: string;
            openedAt: number;
          } | null;
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
        `SELECT payment_id, reservation_id, amount_minor, currency, status, purpose, gateway_reference,
                captured_amount_minor, refunded_amount_minor, created_at, updated_at, tender_type, card_last4, card_brand
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
      purpose: 'STAY' | 'DAMAGE';
      gateway_reference: string | null;
      captured_amount_minor: number | null;
      refunded_amount_minor: number | null;
      created_at: number;
      updated_at: number;
      tender_type: 'CARD' | 'CASH';
      card_last4: string | null;
      card_brand: string | null;
    }>;

    return {
      ok: true,
      payments: rows.map((row) => ({
        paymentId: row.payment_id,
        reservationId: row.reservation_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        purpose: row.purpose,
        gatewayReference: row.gateway_reference,
        capturedAmountMinor: row.captured_amount_minor,
        refundedAmountMinor: row.refunded_amount_minor ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tenderType: row.tender_type,
        cardLast4: row.card_last4,
        cardBrand: row.card_brand,
        dispute: this.readPaymentDisputeSync(row.payment_id),
      })),
    };
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
        window: { folioWindowId: string; kind: string; status: string; closedAt: number | null } | null;
        windows: Array<{
          folioWindowId: string;
          kind: string;
          status: string;
          billedParty: string | null;
          closedAt: number | null;
          balanceMinor: number;
        }>;
        lines: Array<{
          folioLineId: string;
          folioWindowId: string;
          chargeCode: string;
          amountMinor: number;
          ledgerAmountMinor: number;
          txnCurrency: string;
          fxRate: string;
          fxRateAt: number;
          source: string | null;
          businessDate: string | null;
          splitOf: string | null;
          createdAt: number;
          paymentId: string | null;
          taxOf: string | null;
          taxRuleId: string | null;
        }>;
        balanceMinor: number;
        ledgerCurrency: string | null;
        balanceAtRisk: boolean;
        txnBalances: Array<{ currency: string; amountMinor: number }>;
        noPost: boolean;
      }
    | { ok: false; error: typeof NOT_FOUND }
  > {
    this.assertRpcAvailable();
    const reservationRows = this.ctx.storage.sql
      .exec(`SELECT reservation_id, no_post FROM reservation WHERE reservation_id = ?`, reservationId)
      .toArray() as Array<{ reservation_id: string; no_post: number }>;
    if (!reservationRows[0]) return { ok: false, error: NOT_FOUND };

    const windowRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, kind, status, billed_party, closed_at
         FROM folio_window WHERE reservation_id = ?`,
        reservationId,
      )
      .toArray() as Array<{
      folio_window_id: string;
      kind: string;
      status: string;
      billed_party: string | null;
      closed_at: number | null;
    }>;

    const windowBalances = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, COALESCE(SUM(ledger_amount_minor), 0) AS balance
         FROM folio_line WHERE reservation_id = ?
         GROUP BY folio_window_id`,
        reservationId,
      )
      .toArray() as Array<{ folio_window_id: string; balance: number }>;
    const balanceByWindow = new Map(windowBalances.map((row) => [row.folio_window_id, Number(row.balance)]));

    const lineRows = this.ctx.storage.sql
      .exec(
        `SELECT folio_line_id, folio_window_id, charge_code, amount_minor, ledger_amount_minor, txn_currency,
                fx_rate, fx_rate_at, source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id
         FROM folio_line WHERE reservation_id = ?
         ORDER BY created_at ASC`,
        reservationId,
      )
      .toArray() as Array<{
      folio_line_id: string;
      folio_window_id: string;
      charge_code: string;
      amount_minor: number;
      ledger_amount_minor: number;
      txn_currency: string;
      fx_rate: string;
      fx_rate_at: number;
      source: string | null;
      business_date: string | null;
      split_of: string | null;
      created_at: number;
      payment_id: string | null;
      tax_of: string | null;
      tax_rule_id: string | null;
    }>;

    const balanceMinor = lineRows.reduce((sum, row) => sum + row.ledger_amount_minor, 0);
    const guestWindow = windowRows.find((row) => row.kind === 'GUEST');
    const atRiskRows = this.ctx.storage.sql
      .exec(
        `SELECT 1 AS n FROM payment WHERE reservation_id = ? AND balance_at_risk = 1 LIMIT 1`,
        reservationId,
      )
      .toArray();
    const txnBalanceMap = new Map<string, number>();
    for (const row of lineRows) {
      txnBalanceMap.set(row.txn_currency, (txnBalanceMap.get(row.txn_currency) ?? 0) + row.amount_minor);
    }

    return {
      ok: true,
      window: guestWindow
        ? {
            folioWindowId: guestWindow.folio_window_id,
            kind: guestWindow.kind,
            status: guestWindow.status,
            closedAt: guestWindow.closed_at,
          }
        : null,
      windows: windowRows.map((row) => ({
        folioWindowId: row.folio_window_id,
        kind: row.kind,
        status: row.status,
        billedParty: row.billed_party,
        closedAt: row.closed_at,
        balanceMinor: balanceByWindow.get(row.folio_window_id) ?? 0,
      })),
      lines: lineRows.map((row) => ({
        folioLineId: row.folio_line_id,
        folioWindowId: row.folio_window_id,
        chargeCode: row.charge_code,
        amountMinor: row.amount_minor,
        ledgerAmountMinor: row.ledger_amount_minor,
        txnCurrency: row.txn_currency,
        fxRate: row.fx_rate,
        fxRateAt: row.fx_rate_at,
        source: row.source,
        businessDate: row.business_date,
        splitOf: row.split_of,
        createdAt: row.created_at,
        paymentId: row.payment_id,
        taxOf: row.tax_of,
        taxRuleId: row.tax_rule_id,
      })),
      balanceMinor,
      ledgerCurrency: this.readStoredLedgerCurrencySync(),
      balanceAtRisk: atRiskRows.length > 0 && balanceMinor > 0,
      txnBalances: [...txnBalanceMap.entries()].map(([currency, amountMinor]) => ({
        currency,
        amountMinor,
      })),
      noPost: reservationRows[0].no_post === 1,
    };
  }

  async tryGenerateInvoice(
    actor: ActorContext,
    input: {
      reservationId: string;
      folioWindowId?: string;
      generatedBy?: 'checkout' | 'desk';
    },
    idem: IdempotencyKey,
  ): Promise<
    | {
        ok: true;
        invoiceId: string;
        invoiceNumber: string;
        reservationId: string;
        folioWindowId: string;
        r2Key: string;
        sha256: string;
        generatedAt: number;
      }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof INVALID_STATUS_TRANSITION }
    | { ok: false; error: typeof INVOICE_ALREADY_EXISTS }
    | { ok: false; error: typeof FOLIO_BALANCE_DUE }
    | { ok: false; error: typeof INVOICE_R2_UNBOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:post');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const resolvedWindow = input.folioWindowId ?? this.guestFolioWindowId(input.reservationId);

    type GenerateOk = {
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      reservationId: string;
      folioWindowId: string;
      r2Key: string;
      sha256: string;
      generatedAt: number;
    };

    const prior = this.lookupIdempotentResponse<GenerateOk>(idem);
    if (prior === 'fingerprint_mismatch') return { ok: false, error: IDEM_KEY_REUSED };
    if (prior) return prior;

    type PrepareOk = {
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      nextCounter: number;
      snapshot: Record<string, unknown>;
    };
    type PrepareErr = { ok: false; error: typeof NOT_FOUND | typeof INVALID_STATUS_TRANSITION };

    let prepared: PrepareOk | PrepareErr;
    try {
      prepared = this.ctx.storage.transactionSync(() => {
        const resRows = this.ctx.storage.sql
          .exec(`SELECT status FROM reservation WHERE reservation_id = ?`, input.reservationId)
          .toArray() as Array<{ status: string }>;
        if (!resRows[0]) return { ok: false as const, error: NOT_FOUND };

        const status = resRows[0].status;
        if (input.generatedBy === 'checkout') {
          if (status !== 'checked_in') return { ok: false as const, error: INVALID_STATUS_TRANSITION };
        } else if (status !== 'checked_in' && status !== 'checked_out') {
          return { ok: false as const, error: INVALID_STATUS_TRANSITION };
        }

        const window = this.readFolioWindowRowSync(resolvedWindow);
        if (!window || window.reservationId !== input.reservationId) {
          return { ok: false as const, error: NOT_FOUND };
        }

        if (this.hasActiveInvoiceForWindowSync(input.reservationId, resolvedWindow)) {
          throw new InvoiceAlreadyExistsError();
        }

        const balanceMinor = this.windowBalanceMinorSync(resolvedWindow);
        const allowPending = this.readConfigValueSync('pms.invoice.allow_pending') === true;
        if (balanceMinor > 0 && !allowPending) {
          throw new FolioBalanceDueError(balanceMinor);
        }

        const nextCounter = this.readInvoiceCounterSync() + 1;
        const invoiceNumber = this.formatInvoiceNumberSync(nextCounter);
        const invoiceId = crypto.randomUUID();
        const generatedAt = Date.now();
        const snapshot = this.buildInvoiceSnapshotSync({
          invoiceId,
          invoiceNumber,
          propertyId,
          reservationId: input.reservationId,
          folioWindowId: resolvedWindow,
          generatedAt,
          autoGenerated: input.generatedBy === 'checkout',
        });

        return {
          ok: true as const,
          invoiceId,
          invoiceNumber,
          nextCounter,
          snapshot,
        };
      });
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }

    if (!prepared.ok) return prepared;

    let put: { r2Key: string; sha256: string };
    try {
      put = await this.putInvoiceObject(propertyId, prepared.invoiceNumber, prepared.snapshot);
    } catch (e) {
      if (e instanceof InvoiceR2UnboundError) return { ok: false, error: INVOICE_R2_UNBOUND };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          if (this.hasActiveInvoiceForWindowSync(input.reservationId, resolvedWindow)) {
            throw new InvoiceAlreadyExistsError();
          }
          this.bumpInvoiceCounterSync(prepared.nextCounter);
          const generatedAt = Date.now();
          const generatedBy =
            input.generatedBy === 'checkout' ? 'system:checkout' : this.auditActorSync(actor);
          this.ctx.storage.sql.exec(
            `INSERT INTO invoice (invoice_id, invoice_number, reservation_id, folio_window_id, r2_key, sha256, generated_at, generated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            prepared.invoiceId,
            prepared.invoiceNumber,
            input.reservationId,
            resolvedWindow,
            put.r2Key,
            put.sha256,
            generatedAt,
            generatedBy,
          );
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'invoice.generated',
            payload: {
              propertyId,
              invoiceId: prepared.invoiceId,
              invoiceNumber: prepared.invoiceNumber,
              reservationId: input.reservationId,
              folioWindowId: resolvedWindow,
              r2Key: put.r2Key,
              sha256: put.sha256,
              generatedAt,
            },
          });
          this.appendAuditLogSync({
            actor: generatedBy,
            commandId: 'invoice.generate',
            entityType: 'invoice',
            entityId: prepared.invoiceId,
            beforeJson: null,
            afterJson: {
              invoiceId: prepared.invoiceId,
              invoiceNumber: prepared.invoiceNumber,
              reservationId: input.reservationId,
              folioWindowId: resolvedWindow,
            },
            reservationId: input.reservationId,
          });
          return {
            ok: true as const,
            invoiceId: prepared.invoiceId,
            invoiceNumber: prepared.invoiceNumber,
            reservationId: input.reservationId,
            folioWindowId: resolvedWindow,
            r2Key: put.r2Key,
            sha256: put.sha256,
            generatedAt,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryVoidInvoice(
    actor: ActorContext,
    input: { invoiceId: string; reason?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; invoiceId: string; voidedAt: number }
    | { ok: false; error: typeof INVOICE_NOT_FOUND }
    | { ok: false; error: typeof INVOICE_VOIDED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof INVALID_VOID_REASON }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    if (input.reason !== undefined) {
      const trimmed = input.reason.trim();
      if (trimmed.length < 1 || trimmed.length > 500) {
        return { ok: false, error: INVALID_VOID_REASON };
      }
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(
              `SELECT invoice_id, invoice_number, reservation_id, folio_window_id, voided_at
               FROM invoice WHERE invoice_id = ?`,
              input.invoiceId,
            )
            .toArray() as Array<{
            invoice_id: string;
            invoice_number: string;
            reservation_id: string;
            folio_window_id: string;
            voided_at: number | null;
          }>;
          const row = rows[0];
          if (!row) throw new InvoiceNotFoundError();
          if (row.voided_at != null) throw new InvoiceVoidedError();

          const voidedAt = Date.now();
          const voidedBy = this.auditActorSync(actor);
          this.ctx.storage.sql.exec(
            `UPDATE invoice SET voided_at = ?, voided_by = ? WHERE invoice_id = ? AND voided_at IS NULL`,
            voidedAt,
            voidedBy,
            input.invoiceId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'invoice.voided',
            payload: {
              propertyId,
              invoiceId: row.invoice_id,
              invoiceNumber: row.invoice_number,
              reservationId: row.reservation_id,
              folioWindowId: row.folio_window_id,
              voidedAt,
              ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
            },
          });
          this.appendAuditLogSync({
            actor: voidedBy,
            commandId: 'invoice.void',
            entityType: 'invoice',
            entityId: row.invoice_id,
            beforeJson: { voidedAt: null },
            afterJson: {
              voidedAt,
              ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
            },
            reservationId: row.reservation_id,
          });

          return { ok: true as const, invoiceId: row.invoice_id, voidedAt };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async readInvoiceIndex(invoiceId: string): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    reservationId: string;
    folioWindowId: string;
    r2Key: string;
    sha256: string;
    generatedAt: number;
    generatedBy: string;
    voidedAt: number | null;
    voidedBy: string | null;
  } | null> {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT invoice_id, invoice_number, reservation_id, folio_window_id, r2_key, sha256,
                generated_at, generated_by, voided_at, voided_by
         FROM invoice WHERE invoice_id = ?`,
        invoiceId,
      )
      .toArray() as Array<{
      invoice_id: string;
      invoice_number: string;
      reservation_id: string;
      folio_window_id: string;
      r2_key: string;
      sha256: string;
      generated_at: number;
      generated_by: string;
      voided_at: number | null;
      voided_by: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      reservationId: row.reservation_id,
      folioWindowId: row.folio_window_id,
      r2Key: row.r2_key,
      sha256: row.sha256,
      generatedAt: row.generated_at,
      generatedBy: row.generated_by,
      voidedAt: row.voided_at,
      voidedBy: row.voided_by,
    };
  }

  async readInvoicesForReservation(reservationId: string): Promise<
    Array<{
      invoiceId: string;
      invoiceNumber: string;
      folioWindowId: string;
      generatedAt: number;
      voidedAt: number | null;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT invoice_id, invoice_number, folio_window_id, generated_at, voided_at
         FROM invoice WHERE reservation_id = ?
         ORDER BY generated_at ASC`,
        reservationId,
      )
      .toArray() as Array<{
      invoice_id: string;
      invoice_number: string;
      folio_window_id: string;
      generated_at: number;
      voided_at: number | null;
    }>;
    return rows.map((row) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      folioWindowId: row.folio_window_id,
      generatedAt: row.generated_at,
      voidedAt: row.voided_at,
    }));
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
    dndFlag?: boolean;
    ratePlanId?: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    confirmBy?: number;
    expiresAt?: number;
    noPost?: boolean;
  }): Promise<void> {
    this.assertUnsafeLocal('insertReservationForTest');
    const now = Date.now();
    const hasOptional =
      input.roomId !== undefined ||
      input.adults !== undefined ||
      input.children !== undefined ||
      input.frontOfficeComment !== undefined ||
      input.vipFlag !== undefined ||
      input.dndFlag !== undefined ||
      input.ratePlanId !== undefined ||
      input.cancelPenaltyType !== undefined ||
      input.cancelGraceHours !== undefined ||
      input.cancelPenaltyNights !== undefined ||
      input.cancelPenaltyBps !== undefined ||
      input.confirmBy !== undefined ||
      input.expiresAt !== undefined ||
      input.noPost !== undefined;
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
         status, room_id, adults, children, front_office_comment, vip_flag, dnd_flag, rate_plan_id,
         cancel_penalty_type, cancel_grace_hours, cancel_penalty_nights, cancel_penalty_bps,
         confirm_by, expires_at, no_post, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.dndFlag ? 1 : 0,
      input.ratePlanId ?? 'BAR',
      input.cancelPenaltyType ?? 'none',
      input.cancelGraceHours ?? 0,
      input.cancelPenaltyNights ?? null,
      input.cancelPenaltyBps ?? null,
      input.confirmBy ?? null,
      input.expiresAt ?? null,
      input.noPost ? 1 : 0,
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
    | { ok: false; error: typeof FX_RATE_MISSING }
    | { ok: false; error: typeof FX_RATE_INVALID }
    | { ok: false; error: typeof LEDGER_AMOUNT_MISMATCH }
    | { ok: false; error: typeof MONEY_INVALID } {
    const fxRateAt = input.fxRateAt ?? Date.now();
    const txnCurrency = input.txnCurrency ?? ledgerCurrency;

    if (txnCurrency === ledgerCurrency) {
      const normalized = {
        amountMinor: input.amountMinor,
        txnCurrency,
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

    try {
      const txn = money(input.amountMinor, currencyCode(txnCurrency));
      if (input.fxRate !== undefined) {
        const posted = postToLedger(txn, ledgerCurrency, input.fxRate, fxRateAt);
        if (
          input.ledgerAmountMinor !== undefined &&
          input.ledgerAmountMinor !== posted.ledgerAmountMinor
        ) {
          return { ok: false, error: LEDGER_AMOUNT_MISMATCH };
        }
        return { ok: true, posted };
      }
      const quote = this.lookupFxRateSync(txnCurrency, ledgerCurrency, fxRateAt);
      if (!quote) return { ok: false, error: FX_RATE_MISSING };
      const posted = postToLedger(txn, ledgerCurrency, quote.rate, fxRateAt);
      if (
        input.ledgerAmountMinor !== undefined &&
        input.ledgerAmountMinor !== posted.ledgerAmountMinor
      ) {
        return { ok: false, error: LEDGER_AMOUNT_MISMATCH };
      }
      return { ok: true, posted };
    } catch (e) {
      if (e instanceof InvalidFxRateError) return { ok: false, error: FX_RATE_INVALID };
      if (e instanceof LedgerAmountMismatchError) return { ok: false, error: LEDGER_AMOUNT_MISMATCH };
      if (e instanceof InvalidMoneyError) return { ok: false, error: MONEY_INVALID };
      return { ok: false, error: MONEY_INVALID };
    }
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
    this.maybeBroadcastFrontOffice(row.eventType, row.payload);
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
  ): { ok: true; posted: PostedLineAmount } | { ok: false; error: typeof FX_RATE_INVALID | typeof LEDGER_AMOUNT_MISMATCH | typeof MONEY_INVALID } {
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

  async listDomainConfig(): Promise<
    Array<{
      key: string;
      value: unknown;
      source: 'stored' | 'default' | 'unset';
      version: number | null;
      permission: string;
      consumersExempt: boolean;
    }>
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(`SELECT key, value_json, version FROM property_config`)
      .toArray() as Array<{ key: string; value_json: string; version: number }>;
    const stored = new Map(rows.map((r) => [r.key, r]));
    return domainConfigKeys().map((entry) => {
      const row = stored.get(entry.key);
      if (row) {
        return {
          key: entry.key,
          value: JSON.parse(row.value_json) as unknown,
          source: 'stored' as const,
          version: row.version,
          permission: entry.permission,
          consumersExempt: Boolean(entry.consumersExempt),
        };
      }
      if (entry.key === 'pms.money.currency_code' || entry.key === 'pms.time.time_zone') {
        return {
          key: entry.key,
          value: null,
          source: 'unset' as const,
          version: null,
          permission: entry.permission,
          consumersExempt: Boolean(entry.consumersExempt),
        };
      }
      return {
        key: entry.key,
        value: entry.default,
        source: 'default' as const,
        version: null,
        permission: entry.permission,
        consumersExempt: Boolean(entry.consumersExempt),
      };
    });
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

  private readCityLedgerAsOfDateSync(asOfDate?: string): string {
    if (asOfDate) return asOfDate;
    return this.readBusinessDateSync() ?? new Date().toISOString().slice(0, 10);
  }

  private readCityLedgerAccountRowSync(accountId: string): {
    accountId: string;
    name: string;
    status: 'active' | 'archived';
    creditLimitMinor: number;
    termsDays: number;
    createdAt: number;
    updatedAt: number;
  } | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT account_id, name, status, credit_limit_minor, terms_days, created_at, updated_at
         FROM city_ledger_account WHERE account_id = ?`,
        accountId,
      )
      .toArray() as Array<{
      account_id: string;
      name: string;
      status: 'active' | 'archived';
      credit_limit_minor: number;
      terms_days: number;
      created_at: number;
      updated_at: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      accountId: row.account_id,
      name: row.name,
      status: row.status,
      creditLimitMinor: row.credit_limit_minor,
      termsDays: row.terms_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private readCityLedgerEntriesForAccountSync(accountId: string): CityLedgerEntryForAging[] {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT entry_id, kind, amount_minor, business_date, created_at
         FROM city_ledger_entry
         WHERE account_id = ?
         ORDER BY business_date ASC, created_at ASC`,
        accountId,
      )
      .toArray() as Array<{
      entry_id: string;
      kind: 'charge' | 'payment' | 'adjustment';
      amount_minor: number;
      business_date: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      entryId: row.entry_id,
      kind: row.kind,
      amountMinor: row.amount_minor,
      businessDate: row.business_date,
      createdAt: row.created_at,
    }));
  }

  private openBalanceMinorSync(accountId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(
           CASE
             WHEN kind = 'charge' THEN amount_minor
             WHEN kind = 'payment' THEN -amount_minor
             WHEN kind = 'adjustment' THEN amount_minor
             ELSE 0
           END
         ), 0) AS total
         FROM city_ledger_entry WHERE account_id = ?`,
        accountId,
      )
      .toArray() as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  private closedAtBusinessDateSync(closedAtMs: number): string {
    const timeZone = this.readStoredTimeZoneSync() ?? 'UTC';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(closedAtMs));
  }

  private postedReceivableMinorSync(folioWindowId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS total
         FROM folio_line
         WHERE folio_window_id = ? AND charge_code != 'PAYMENT'`,
        folioWindowId,
      )
      .toArray() as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  private postedArMinorForWindowSync(folioWindowId: string): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM city_ledger_entry
         WHERE folio_window_id = ? AND kind IN ('charge', 'adjustment')`,
        folioWindowId,
      )
      .toArray() as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  private listCompanyFolioWindowsForReservationSync(
    reservationId: string,
  ): Array<{ folio_window_id: string }> {
    return this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id FROM folio_window
         WHERE reservation_id = ? AND kind = 'COMPANY'`,
        reservationId,
      )
      .toArray() as Array<{ folio_window_id: string }>;
  }

  private syncCityLedgerArForWindowSync(input: {
    folioWindowId: string;
    source: 'transfer' | 'window_close' | 'check_out' | 'night_audit';
    actor: ActorContext;
  }):
    | { ok: true; postedMinor: number; arSynced: boolean; alreadySynced?: true; entryId?: string }
    | {
        ok: false;
        error:
          | typeof NOT_FOUND
          | typeof CITY_LEDGER_ACCOUNT_NOT_FOUND
          | typeof CITY_LEDGER_ACCOUNT_ARCHIVED;
      } {
    const window = this.readFolioWindowRowSync(input.folioWindowId);
    if (!window || window.kind !== 'COMPANY') return { ok: false, error: NOT_FOUND };

    const targetMinor = this.postedReceivableMinorSync(input.folioWindowId);
    if (targetMinor <= 0) {
      return { ok: true, postedMinor: 0, arSynced: false };
    }

    const billedParty = window.billedParty?.trim() ?? '';
    const account = this.resolveCityLedgerAccountSync(billedParty);
    if (!account) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };
    if (account.status === 'archived') return { ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED };

    const postedMinor = this.postedArMinorForWindowSync(input.folioWindowId);
    const deltaMinor = targetMinor - postedMinor;
    if (deltaMinor === 0) {
      return { ok: true, postedMinor, arSynced: false, alreadySynced: true };
    }

    const accountRow = this.readCityLedgerAccountRowSync(account.accountId);
    if (!accountRow) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };

    const open = this.openBalanceMinorSync(account.accountId);
    if (accountRow.creditLimitMinor > 0 && open + deltaMinor > accountRow.creditLimitMinor) {
      throw new CityLedgerCreditLimitExceededError();
    }

    const businessDate = this.readBusinessDateSync() ?? new Date().toISOString().slice(0, 10);
    const currency = this.readStoredLedgerCurrencySync() ?? 'USD';
    const propertyId = this.getPropertyIdSync();
    const now = Date.now();

    const existingCharge = this.ctx.storage.sql
      .exec(
        `SELECT entry_id FROM city_ledger_entry
         WHERE folio_window_id = ? AND kind = 'charge' LIMIT 1`,
        input.folioWindowId,
      )
      .toArray() as Array<{ entry_id: string }>;

    if (!existingCharge[0]) {
      const entryId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        `INSERT INTO city_ledger_entry
         (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
          business_date, source, reference, created_at)
         VALUES (?, ?, ?, ?, 'charge', ?, ?, ?, ?, NULL, ?)`,
        entryId,
        account.accountId,
        window.reservationId,
        input.folioWindowId,
        targetMinor,
        currency,
        businessDate,
        input.source,
        now,
      );
      this.appendPropertyOutbox({
        eventId: crypto.randomUUID(),
        eventType: 'city_ledger.charge_posted',
        payload: {
          propertyId,
          entryId,
          folioWindowId: input.folioWindowId,
          accountId: account.accountId,
          amountMinor: targetMinor,
          source: input.source,
          reservationId: window.reservationId,
        },
      });
      return { ok: true, postedMinor: targetMinor, arSynced: true, entryId };
    }

    const entryId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO city_ledger_entry
       (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
        business_date, source, reference, created_at)
       VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?)`,
      entryId,
      account.accountId,
      window.reservationId,
      input.folioWindowId,
      deltaMinor,
      currency,
      businessDate,
      input.source,
      existingCharge[0].entry_id,
      now,
    );
    return { ok: true, postedMinor: postedMinor + deltaMinor, arSynced: true, entryId };
  }

  private postCityLedgerChargeSync(input: {
    folioWindowId: string;
    source: 'window_close' | 'night_audit';
    actor: ActorContext;
  }):
    | { ok: true; entryId: string; alreadyPosted?: true }
    | {
        ok: false;
        error:
          | typeof NOT_FOUND
          | typeof CITY_LEDGER_ACCOUNT_NOT_FOUND
          | typeof CITY_LEDGER_ACCOUNT_ARCHIVED;
      } {
    const sync = this.syncCityLedgerArForWindowSync(input);
    if (!sync.ok) return sync;
    if (sync.arSynced && sync.entryId) return { ok: true as const, entryId: sync.entryId };
    if (sync.alreadySynced) {
      const row = this.ctx.storage.sql
        .exec(
          `SELECT entry_id FROM city_ledger_entry WHERE folio_window_id = ? AND kind = 'charge' LIMIT 1`,
          input.folioWindowId,
        )
        .toArray() as Array<{ entry_id: string }>;
      return { ok: true as const, entryId: row[0]?.entry_id ?? '', alreadyPosted: true as const };
    }
    return { ok: true as const, entryId: '' };
  }

  private postPendingCityLedgerChargesForBusinessDateSync(businessDate: string): void {
    const windows = this.ctx.storage.sql
      .exec(
        `SELECT folio_window_id, closed_at FROM folio_window fw
         WHERE fw.kind = 'COMPANY' AND fw.status = 'CLOSED' AND fw.closed_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM city_ledger_entry e
             WHERE e.folio_window_id = fw.folio_window_id AND e.kind = 'charge'
           )`,
      )
      .toArray() as Array<{ folio_window_id: string; closed_at: number }>;
    for (const w of windows) {
      if (this.closedAtBusinessDateSync(w.closed_at) !== businessDate) continue;
      const result = this.postCityLedgerChargeSync({
        folioWindowId: w.folio_window_id,
        source: 'night_audit',
        actor: { kind: 'system', reason: 'night_audit' },
      });
      if (!result.ok) throw new CityLedgerError(result.error);
    }
  }

  private resolveCityLedgerAccountSync(
    raw: string,
  ): { accountId: string; name: string; status: 'active' | 'archived' } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT account_id, name, status FROM city_ledger_account
         WHERE account_id = ? OR name = ?
         LIMIT 1`,
        trimmed,
        trimmed,
      )
      .toArray() as Array<{ account_id: string; name: string; status: 'active' | 'archived' }>;
    const row = rows[0];
    return row ? { accountId: row.account_id, name: row.name, status: row.status } : null;
  }

  private hasGrandfatheredCompanyBilledPartySync(billedParty: string): boolean {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT 1 FROM folio_window WHERE kind = 'COMPANY' AND billed_party = ? LIMIT 1`,
        billedParty,
      )
      .toArray();
    return rows.length > 0;
  }

  private buildCityLedgerStatementSnapshotSync(input: {
    accountId: string;
    statementId: string;
    asOfDate: string;
    propertyId: string;
  }): Record<string, unknown> {
    const account = this.readCityLedgerAccountRowSync(input.accountId);
    if (!account) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_NOT_FOUND);

    const entries = this.readCityLedgerEntriesForAccountSync(input.accountId);
    const aging = buildAgingBucketsSync(entries, account.termsDays, input.asOfDate);

    const detailRows = this.ctx.storage.sql
      .exec(
        `SELECT entry_id, kind, amount_minor, business_date, reservation_id, folio_window_id, source, reference, created_at
         FROM city_ledger_entry
         WHERE account_id = ?
         ORDER BY business_date ASC, created_at ASC`,
        input.accountId,
      )
      .toArray() as Array<{
      entry_id: string;
      kind: 'charge' | 'payment' | 'adjustment';
      amount_minor: number;
      business_date: string;
      reservation_id: string | null;
      folio_window_id: string | null;
      source: string;
      reference: string | null;
      created_at: number;
    }>;

    const openEntries = detailRows.map((row) => {
      const dueDate = cityLedgerAddCalendarDays(row.business_date, account.termsDays);
      const daysOverdue = Math.max(0, cityLedgerCalendarDaysBetween(dueDate, input.asOfDate));
      return {
        entryId: row.entry_id,
        kind: row.kind,
        amountMinor: row.amount_minor,
        businessDate: row.business_date,
        dueDate,
        daysOverdue,
        reservationId: row.reservation_id,
        folioWindowId: row.folio_window_id,
        source: row.source,
        reference: row.reference,
        createdAt: row.created_at,
      };
    });

    let chargesMinor = 0;
    let paymentsMinor = 0;
    let adjustmentsMinor = 0;
    for (const entry of entries) {
      if (entry.kind === 'charge') chargesMinor += entry.amountMinor;
      else if (entry.kind === 'payment') paymentsMinor += entry.amountMinor;
      else adjustmentsMinor += entry.amountMinor;
    }

    return {
      schemaVersion: 1,
      statementId: input.statementId,
      accountId: input.accountId,
      propertyId: input.propertyId,
      asOfDate: input.asOfDate,
      generatedAt: Date.now(),
      account: {
        name: account.name,
        termsDays: account.termsDays,
        creditLimitMinor: account.creditLimitMinor,
        status: account.status,
      },
      ledgerCurrency: this.readStoredLedgerCurrencySync(),
      aging,
      entries: openEntries,
      totals: {
        chargesMinor,
        paymentsMinor,
        adjustmentsMinor,
        openMinor: aging.totalOpenMinor,
      },
    };
  }

  private async putCityLedgerStatementObject(
    propertyId: string,
    accountId: string,
    statementId: string,
    body: unknown,
  ): Promise<{ r2Key: string; sha256: string }> {
    let bucket: R2Bucket;
    try {
      bucket = this.assertReportsR2Bound();
    } catch (e) {
      if (e instanceof Error && e.message === 'reports_r2_unbound') {
        throw new CityLedgerR2UnboundError();
      }
      throw e;
    }
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const sha256 = await this.sha256Hex(encoded);
    const r2Key = cityLedgerStatementObjectKey(propertyId, accountId, statementId);
    await bucket.put(r2Key, encoded);
    return { r2Key, sha256 };
  }

  async tryCreateCityLedgerAccount(
    actor: ActorContext,
    input: { name: string; creditLimitMinor?: number; termsDays?: number },
    idem: IdempotencyKey,
  ): Promise<
    | {
        ok: true;
        accountId: string;
        name: string;
        status: 'active';
        creditLimitMinor: number;
        termsDays: number;
      }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_EXISTS }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof VALIDATION_ERROR }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const normalizedName = input.name.trim();
    if (normalizedName.length < 1 || normalizedName.length > 128) {
      return { ok: false, error: VALIDATION_ERROR };
    }
    const creditLimitMinor = input.creditLimitMinor ?? 0;
    const termsDays = input.termsDays ?? 30;
    if (!Number.isInteger(creditLimitMinor) || creditLimitMinor < 0) {
      return { ok: false, error: VALIDATION_ERROR };
    }
    if (!Number.isInteger(termsDays) || termsDays < 0) {
      return { ok: false, error: VALIDATION_ERROR };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(`SELECT account_id FROM city_ledger_account WHERE name = ?`, normalizedName)
            .toArray();
          if (existing.length > 0) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_EXISTS);

          const accountId = crypto.randomUUID();
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO city_ledger_account
             (account_id, name, status, credit_limit_minor, terms_days, created_at, updated_at)
             VALUES (?, ?, 'active', ?, ?, ?, ?)`,
            accountId,
            normalizedName,
            creditLimitMinor,
            termsDays,
            now,
            now,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'city_ledger.account_created',
            payload: { propertyId, accountId, name: normalizedName, creditLimitMinor, termsDays },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'city_ledger.create_account',
            entityType: 'city_ledger_account',
            entityId: accountId,
            beforeJson: null,
            afterJson: {
              accountId,
              name: normalizedName,
              status: 'active',
              creditLimitMinor,
              termsDays,
            },
          });

          return {
            ok: true as const,
            accountId,
            name: normalizedName,
            status: 'active' as const,
            creditLimitMinor,
            termsDays,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryUpdateCityLedgerAccount(
    actor: ActorContext,
    input: {
      accountId: string;
      name?: string;
      creditLimitMinor?: number;
      termsDays?: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | {
        ok: true;
        accountId: string;
        name: string;
        status: 'active' | 'archived';
        creditLimitMinor: number;
        termsDays: number;
      }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_EXISTS }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_ARCHIVED }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof VALIDATION_ERROR }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const account = this.readCityLedgerAccountRowSync(input.accountId);
          if (!account) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_NOT_FOUND);
          if (account.status === 'archived') throw new CityLedgerError(CITY_LEDGER_ACCOUNT_ARCHIVED);

          const nextName = input.name !== undefined ? input.name.trim() : account.name;
          if (nextName.length < 1 || nextName.length > 128) {
            throw new Error(VALIDATION_ERROR);
          }
          const nextCreditLimitMinor = input.creditLimitMinor ?? account.creditLimitMinor;
          const nextTermsDays = input.termsDays ?? account.termsDays;
          if (!Number.isInteger(nextCreditLimitMinor) || nextCreditLimitMinor < 0) {
            throw new Error(VALIDATION_ERROR);
          }
          if (!Number.isInteger(nextTermsDays) || nextTermsDays < 0) {
            throw new Error(VALIDATION_ERROR);
          }

          if (nextName !== account.name) {
            const collision = this.ctx.storage.sql
              .exec(
                `SELECT account_id FROM city_ledger_account WHERE name = ? AND account_id != ?`,
                nextName,
                input.accountId,
              )
              .toArray();
            if (collision.length > 0) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_EXISTS);
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE city_ledger_account
             SET name = ?, credit_limit_minor = ?, terms_days = ?, updated_at = ?
             WHERE account_id = ?`,
            nextName,
            nextCreditLimitMinor,
            nextTermsDays,
            now,
            input.accountId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'city_ledger.account_updated',
            payload: {
              propertyId,
              accountId: input.accountId,
              name: nextName,
              creditLimitMinor: nextCreditLimitMinor,
              termsDays: nextTermsDays,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'city_ledger.update_account',
            entityType: 'city_ledger_account',
            entityId: input.accountId,
            beforeJson: {
              name: account.name,
              creditLimitMinor: account.creditLimitMinor,
              termsDays: account.termsDays,
            },
            afterJson: {
              name: nextName,
              creditLimitMinor: nextCreditLimitMinor,
              termsDays: nextTermsDays,
            },
          });

          return {
            ok: true as const,
            accountId: input.accountId,
            name: nextName,
            status: account.status,
            creditLimitMinor: nextCreditLimitMinor,
            termsDays: nextTermsDays,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryArchiveCityLedgerAccount(
    actor: ActorContext,
    input: { accountId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; accountId: string; status: 'archived' }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
    | { ok: false; error: typeof CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const account = this.readCityLedgerAccountRowSync(input.accountId);
          if (!account) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_NOT_FOUND);
          if (account.status === 'archived') {
            return { ok: true as const, accountId: input.accountId, status: 'archived' as const };
          }

          const openBalanceMinor = this.openBalanceMinorSync(input.accountId);
          if (openBalanceMinor !== 0) {
            throw new CityLedgerError(CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE);
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE city_ledger_account SET status = 'archived', updated_at = ? WHERE account_id = ?`,
            now,
            input.accountId,
          );

          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'city_ledger.account_archived',
            payload: { propertyId, accountId: input.accountId },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'city_ledger.archive_account',
            entityType: 'city_ledger_account',
            entityId: input.accountId,
            beforeJson: { status: 'active' },
            afterJson: { status: 'archived' },
          });

          return { ok: true as const, accountId: input.accountId, status: 'archived' as const };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryReceiveCityLedgerPayment(
    actor: ActorContext,
    input: {
      accountId: string;
      amountMinor: number;
      businessDate?: string;
      reference?: string | null;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; entryId: string; openBalanceMinor: number }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_ARCHIVED }
    | { ok: false; error: typeof CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | { ok: false; error: typeof VALIDATION_ERROR }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:adjust');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const businessDate = input.businessDate ?? this.readCityLedgerAsOfDateSync();
    const reference = input.reference?.trim() ?? null;
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: VALIDATION_ERROR };
    }
    if (reference != null && (reference.length < 1 || reference.length > 128)) {
      return { ok: false, error: VALIDATION_ERROR };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const account = this.readCityLedgerAccountRowSync(input.accountId);
          if (!account) throw new CityLedgerError(CITY_LEDGER_ACCOUNT_NOT_FOUND);
          if (account.status === 'archived') throw new CityLedgerError(CITY_LEDGER_ACCOUNT_ARCHIVED);

          const openBalanceMinor = this.openBalanceMinorSync(input.accountId);
          if (input.amountMinor > openBalanceMinor) {
            throw new CityLedgerError(CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE);
          }

          const entryId = crypto.randomUUID();
          const now = Date.now();
          const currency = this.readStoredLedgerCurrencySync() ?? 'USD';
          this.ctx.storage.sql.exec(
            `INSERT INTO city_ledger_entry
             (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
              business_date, source, reference, created_at)
             VALUES (?, ?, NULL, NULL, 'payment', ?, ?, ?, 'desk', ?, ?)`,
            entryId,
            input.accountId,
            input.amountMinor,
            currency,
            businessDate,
            reference,
            now,
          );

          const nextOpenBalanceMinor = openBalanceMinor - input.amountMinor;
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'city_ledger.payment_received',
            payload: {
              propertyId,
              accountId: input.accountId,
              entryId,
              amountMinor: input.amountMinor,
              openBalanceMinor: nextOpenBalanceMinor,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'city_ledger.receive_payment',
            entityType: 'city_ledger_entry',
            entityId: entryId,
            beforeJson: null,
            afterJson: {
              accountId: input.accountId,
              amountMinor: input.amountMinor,
              businessDate,
              reference,
            },
          });

          return { ok: true as const, entryId, openBalanceMinor: nextOpenBalanceMinor };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryGenerateCityLedgerStatement(
    actor: ActorContext,
    input: { accountId: string; asOfDate?: string },
    idem: IdempotencyKey,
  ): Promise<
    | {
        ok: true;
        statementId: string;
        r2Key: string;
        sha256: string;
        snapshot: Record<string, unknown>;
      }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
    | { ok: false; error: typeof CITY_LEDGER_R2_UNBOUND }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapPropertyCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };
    const permDenied = await this.gatePermission(actor, 'folio:read');
    if (permDenied) return permDenied;
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const asOfDate = input.asOfDate ?? this.readCityLedgerAsOfDateSync();

    type GenerateOk = {
      ok: true;
      statementId: string;
      r2Key: string;
      sha256: string;
      snapshot: Record<string, unknown>;
    };

    const prior = this.lookupIdempotentResponse<GenerateOk>(idem);
    if (prior === 'fingerprint_mismatch') return { ok: false, error: IDEM_KEY_REUSED };
    if (prior) return prior;

    const account = this.readCityLedgerAccountRowSync(input.accountId);
    if (!account) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };

    const statementId = crypto.randomUUID();
    const snapshot = this.buildCityLedgerStatementSnapshotSync({
      accountId: input.accountId,
      statementId,
      asOfDate,
      propertyId,
    });

    let put: { r2Key: string; sha256: string };
    try {
      put = await this.putCityLedgerStatementObject(propertyId, input.accountId, statementId, snapshot);
    } catch (e) {
      if (e instanceof CityLedgerR2UnboundError) return { ok: false, error: CITY_LEDGER_R2_UNBOUND };
      const mapped = mapPropertyCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          this.appendPropertyOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'city_ledger.statement_generated',
            payload: {
              propertyId,
              accountId: input.accountId,
              statementId,
              asOfDate,
              r2Key: put.r2Key,
              sha256: put.sha256,
            },
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'city_ledger.generate_statement',
            entityType: 'city_ledger_statement',
            entityId: statementId,
            beforeJson: null,
            afterJson: { accountId: input.accountId, statementId, asOfDate, r2Key: put.r2Key },
          });
          return {
            ok: true as const,
            statementId,
            r2Key: put.r2Key,
            sha256: put.sha256,
            snapshot,
          };
        }),
      );
    } catch (e) {
      const mapped = mapReservationPreconditionError(e) ?? mapPropertyCommandError(e);
      if (mapped) return mapped;
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async readCityLedgerAccounts(input?: { status?: 'active' | 'all' }): Promise<
    | {
        ok: true;
        accounts: Array<{
          accountId: string;
          name: string;
          status: 'active' | 'archived';
          creditLimitMinor: number;
          termsDays: number;
          openBalanceMinor: number;
          aging: CityLedgerAgingBuckets;
        }>;
      }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
  > {
    this.assertRpcAvailable();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const status = input?.status ?? 'active';
    const asOfDate = this.readCityLedgerAsOfDateSync();
    const rows = this.ctx.storage.sql
      .exec(
        status === 'all'
          ? `SELECT account_id, name, status, credit_limit_minor, terms_days
             FROM city_ledger_account ORDER BY name ASC`
          : `SELECT account_id, name, status, credit_limit_minor, terms_days
             FROM city_ledger_account WHERE status = 'active' ORDER BY name ASC`,
      )
      .toArray() as Array<{
      account_id: string;
      name: string;
      status: 'active' | 'archived';
      credit_limit_minor: number;
      terms_days: number;
    }>;

    const accounts = rows.map((row) => {
      const entries = this.readCityLedgerEntriesForAccountSync(row.account_id);
      const openBalanceMinor = this.openBalanceMinorSync(row.account_id);
      const aging = buildAgingBucketsSync(entries, row.terms_days, asOfDate);
      return {
        accountId: row.account_id,
        name: row.name,
        status: row.status,
        creditLimitMinor: row.credit_limit_minor,
        termsDays: row.terms_days,
        openBalanceMinor,
        aging,
      };
    });

    return { ok: true, accounts };
  }

  async readCityLedgerAccount(accountId: string): Promise<
    | {
        ok: true;
        accountId: string;
        name: string;
        status: 'active' | 'archived';
        creditLimitMinor: number;
        termsDays: number;
        openBalanceMinor: number;
        aging: CityLedgerAgingBuckets;
        entries: Array<{
          entryId: string;
          kind: 'charge' | 'payment' | 'adjustment';
          amountMinor: number;
          businessDate: string;
          dueDate: string;
          daysOverdue: number;
          source: string;
          reference: string | null;
          createdAt: number;
        }>;
      }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_NOT_FOUND }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
  > {
    this.assertRpcAvailable();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const account = this.readCityLedgerAccountRowSync(accountId);
    if (!account) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };

    const asOfDate = this.readCityLedgerAsOfDateSync();
    const rawEntries = this.ctx.storage.sql
      .exec(
        `SELECT entry_id, kind, amount_minor, business_date, source, reference, created_at
         FROM city_ledger_entry
         WHERE account_id = ?
         ORDER BY business_date ASC, created_at ASC`,
        accountId,
      )
      .toArray() as Array<{
      entry_id: string;
      kind: 'charge' | 'payment' | 'adjustment';
      amount_minor: number;
      business_date: string;
      source: string;
      reference: string | null;
      created_at: number;
    }>;

    const entries = rawEntries.map((row) => {
      const dueDate = cityLedgerAddCalendarDays(row.business_date, account.termsDays);
      const daysOverdue = Math.max(0, cityLedgerCalendarDaysBetween(dueDate, asOfDate));
      return {
        entryId: row.entry_id,
        kind: row.kind,
        amountMinor: row.amount_minor,
        businessDate: row.business_date,
        dueDate,
        daysOverdue,
        source: row.source,
        reference: row.reference,
        createdAt: row.created_at,
      };
    });

    const agingEntries = rawEntries.map((row) => ({
      entryId: row.entry_id,
      kind: row.kind,
      amountMinor: row.amount_minor,
      businessDate: row.business_date,
      createdAt: row.created_at,
    }));

    return {
      ok: true,
      accountId: account.accountId,
      name: account.name,
      status: account.status,
      creditLimitMinor: account.creditLimitMinor,
      termsDays: account.termsDays,
      openBalanceMinor: this.openBalanceMinorSync(accountId),
      aging: buildAgingBucketsSync(agingEntries, account.termsDays, asOfDate),
      entries,
    };
  }

  async readCityLedgerStatement(input: {
    accountId: string;
    statementId: string;
  }): Promise<
    | {
        ok: true;
        statementId: string;
        accountId: string;
        r2Key: string;
        snapshot: Record<string, unknown>;
      }
    | { ok: false; error: typeof CITY_LEDGER_STATEMENT_NOT_FOUND }
    | { ok: false; error: typeof CITY_LEDGER_R2_UNBOUND }
    | { ok: false; error: typeof PROPERTY_ID_UNSET }
  > {
    this.assertRpcAvailable();
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    let bucket: R2Bucket;
    try {
      bucket = this.assertReportsR2Bound();
    } catch {
      return { ok: false, error: CITY_LEDGER_R2_UNBOUND };
    }

    const r2Key = cityLedgerStatementObjectKey(propertyId, input.accountId, input.statementId);
    const obj = await bucket.get(r2Key);
    if (!obj) return { ok: false, error: CITY_LEDGER_STATEMENT_NOT_FOUND };

    const snapshot = JSON.parse(await obj.text()) as Record<string, unknown>;
    return {
      ok: true,
      statementId: input.statementId,
      accountId: input.accountId,
      r2Key,
      snapshot,
    };
  }

  async validateCityLedgerBilledParty(input: { billedParty: string }): Promise<
    | { ok: true; billedParty: string; accountId?: string; grandfathered?: true }
    | { ok: false; error: typeof CITY_LEDGER_BILLED_PARTY_INVALID }
    | { ok: false; error: typeof CITY_LEDGER_ACCOUNT_ARCHIVED }
  > {
    this.assertRpcAvailable();
    const raw = input.billedParty.trim();
    if (!raw || raw.length > 128) {
      return { ok: false, error: CITY_LEDGER_BILLED_PARTY_INVALID };
    }

    const resolved = this.resolveCityLedgerAccountSync(raw);
    if (resolved) {
      if (resolved.status === 'archived') {
        return { ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED };
      }
      return { ok: true, billedParty: resolved.name, accountId: resolved.accountId };
    }

    if (this.hasGrandfatheredCompanyBilledPartySync(raw)) {
      return { ok: true, billedParty: raw, grandfathered: true };
    }

    return { ok: false, error: CITY_LEDGER_BILLED_PARTY_INVALID };
  }

  async seedCityLedgerEntryForTest(input: {
    accountId: string;
    kind: 'charge' | 'payment' | 'adjustment';
    amountMinor: number;
    businessDate: string;
    source?: string;
    reference?: string | null;
  }): Promise<void> {
    this.assertUnsafeLocal('seedCityLedgerEntryForTest');
    const currency = this.readStoredLedgerCurrencySync() ?? 'USD';
    this.ctx.storage.sql.exec(
      `INSERT INTO city_ledger_entry
       (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
        business_date, source, reference, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.accountId,
      input.kind,
      input.amountMinor,
      currency,
      input.businessDate,
      input.source ?? 'desk',
      input.reference ?? null,
      Date.now(),
    );
  }

  async readCityLedgerChargeForWindowForTest(folioWindowId: string): Promise<{
    entryId: string;
    accountId: string;
    reservationId: string | null;
    folioWindowId: string | null;
    kind: string;
    source: string;
    amountMinor: number;
  } | null> {
    this.assertUnsafeLocal('readCityLedgerChargeForWindowForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT entry_id, account_id, reservation_id, folio_window_id, kind, source, amount_minor
         FROM city_ledger_entry
         WHERE folio_window_id = ? AND kind = 'charge'
         LIMIT 1`,
        folioWindowId,
      )
      .toArray() as Array<{
      entry_id: string;
      account_id: string;
      reservation_id: string | null;
      folio_window_id: string | null;
      kind: string;
      source: string;
      amount_minor: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      entryId: row.entry_id,
      accountId: row.account_id,
      reservationId: row.reservation_id,
      folioWindowId: row.folio_window_id,
      kind: row.kind,
      source: row.source,
      amountMinor: row.amount_minor,
    };
  }

  async setCityLedgerAccountArchivedForTest(accountId: string): Promise<void> {
    this.assertUnsafeLocal('setCityLedgerAccountArchivedForTest');
    this.ctx.storage.sql.exec(
      `UPDATE city_ledger_account SET status = 'archived', updated_at = ? WHERE account_id = ?`,
      Date.now(),
      accountId,
    );
  }

  async seedLegacyCompanyWindowForTest(reservationId: string, billedParty: string): Promise<void> {
    this.assertUnsafeLocal('seedLegacyCompanyWindowForTest');
    const slug = billedPartySlug(billedParty);
    const folioWindowId = `${reservationId}:COMPANY:${slug}`;
    this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS folio_window_billed_party_city_ledger_insert`);
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO folio_window (folio_window_id, reservation_id, kind, billed_party, status)
         VALUES (?, ?, 'COMPANY', ?, 'OPEN')`,
        folioWindowId,
        reservationId,
        billedParty,
      );
    } finally {
      this.ctx.storage.sql.exec(`
        CREATE TRIGGER folio_window_billed_party_city_ledger_insert
        BEFORE INSERT ON folio_window
        WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
          WHERE NOT EXISTS (
            SELECT 1 FROM city_ledger_account
            WHERE status = 'active'
              AND (name = NEW.billed_party OR account_id = NEW.billed_party)
          )
          AND NOT EXISTS (
            SELECT 1 FROM folio_window fw
            WHERE fw.kind = 'COMPANY' AND fw.billed_party = NEW.billed_party
          );
        END`);
    }
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
