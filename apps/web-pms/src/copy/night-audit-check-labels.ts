import {
  NIGHT_AUDIT_CHECK_LABELS,
  nightAuditCheckOutcomeWord,
  type NightAuditCheckId,
  type NightAuditCheckSeverity,
  type NightAuditFixedCheckId,
} from '@hospai/contracts';

export const CHECK_LABELS: Record<NightAuditCheckId | NightAuditFixedCheckId, string> =
  NIGHT_AUDIT_CHECK_LABELS;

/** What the check counts, in operator language. Settings shows this beside the select. */
export const CHECK_DESCRIPTIONS: Record<NightAuditCheckId | NightAuditFixedCheckId, string> = {
  queued_commands: 'Commands still queued for this property.',
  open_exceptions: 'Unresolved exceptions for the closing date.',
  arrivals_not_checked_in:
    'Confirmed or pending stays whose arrival date is on or before the closing date.',
  departures_not_checked_out:
    'In-house stays whose departure date is on or before the closing date, including overstays.',
  cashier_shift_open: 'Cashier shifts still open on the closing date.',
  dirty_room_assigned: 'Arrivals not checked in that have a dirty room assigned.',
  departed_with_balance:
    'Stays checked out on the closing date whose guest window still has a balance.',
  id_proof_missing: 'In-house stays with no identity document recorded at this property.',
  arrival_deposit_missing:
    'Confirmed or pending arrivals on or before the closing date with no stay guarantee, only when require prepayment is on.',
  open_folio_unsettled: 'Active open-folio holds whose guest window balance is greater than zero.',
  open_folio_past_close_by: 'Active open-folio holds whose close-by date is before the closing date.',
  open_folio_zero_balance: 'Active open-folio holds whose guest window balance is zero.',
  form_c_overdue:
    'Foreign nationals whose Form C is not filed 24 hours after check-in. Only India properties have any.',
};

export const SEVERITY_WORD: Record<NightAuditCheckSeverity | 'clear', string> = {
  off: 'Off',
  fail: 'Fail',
  warn: 'Warn',
  info: 'Info',
  clear: 'Clear',
};

export function checkOutcomeWord(
  severity: NightAuditCheckSeverity,
  count: number | null,
): 'Off' | 'Clear' | 'Fail' | 'Warn' | 'Info' {
  return nightAuditCheckOutcomeWord(severity, count);
}

export const NIGHT_AUDIT_CHECK_HINT_ANY_FAIL =
  'Fail also stops the automatic night run. The business date will not roll until someone clears it and retries.';

export const NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW =
  'Auto no-show runs after this check, so these guests must be checked in or marked no-show by hand first.';

/** Same point as the auto no-show hint, for auto extend. The spec does not quote this sentence. */
export const NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND =
  'Auto extend runs after this check, so these guests must be checked out or extended by hand first.';

export const STEP_ERROR_COPY: Record<string, string> = {
  night_audit_checks_failed: 'Fail checks stopped the audit. See Checks.',
  pending_commands_undrained: 'Queued commands are still open. See Checks.',
  provisional_exceptions_open: 'Open exceptions are still unresolved. See Checks.',
};
