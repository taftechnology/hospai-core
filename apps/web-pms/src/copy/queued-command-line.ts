import type { QueuedCommandEntry } from '@hospai/client-core';

const COMMAND_ID_LABELS: Record<string, string> = {
  'reservations.check_in': 'Check-in',
  'reservations.check_out': 'Checkout',
  'reservations.assign_room': 'Room assignment',
  'reservations.update_status': 'Reservation update',
  'reservations.cancel_check_in': 'Cancel check-in',
  'folio.add_item': 'Folio charge',
  'folio.add_line': 'Folio charge',
  post_folio_charge: 'Folio charge',
  'folio.record_cash_payment': 'Cash payment',
  'folio.open_shift': 'Open shift',
  'folio.close_shift': 'Close shift',
  'rooms.update_status': 'Room status update',
  'rooms.bulk_update_status': 'Bulk room status',
  'housekeeping.assign': 'Housekeeping assignment',
};

export function queuedCommandLine(entry: QueuedCommandEntry): string {
  const date = entry.businessDate ?? entry.issuedAt.slice(0, 10);
  const label = COMMAND_ID_LABELS[entry.commandId] ?? 'Queued action';
  const suffix =
    entry.reservationId != null && entry.reservationId !== ''
      ? ` · #${entry.reservationId.slice(-8)}`
      : '';
  return `${label} · ${date}${suffix}`;
}
