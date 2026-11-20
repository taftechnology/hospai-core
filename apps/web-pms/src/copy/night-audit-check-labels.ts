import type { NightAuditCheckId, NightAuditCheckSeverity, NightAuditFixedCheckId } from '@hospai/contracts';

export const CHECK_LABELS: Record<NightAuditCheckId | NightAuditFixedCheckId, string> = {
  queued_commands: 'Queued commands',
  open_exceptions: 'Open exceptions',
  arrivals_not_checked_in: 'Arrivals not checked in',
  departures_not_checked_out: 'Departures not checked out',
  cashier_shift_open: 'Cashier shifts still open',
  dirty_room_assigned: 'Arrivals assigned a dirty room',
  departed_with_balance: 'Departed with a balance',
  id_proof_missing: 'In-house guests with no ID document recorded',
};

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
  if (severity === 'off') return 'Off';
  if (count == null || count <= 0) return 'Clear';
  if (severity === 'fail') return 'Fail';
  if (severity === 'warn') return 'Warn';
  return 'Info';
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
