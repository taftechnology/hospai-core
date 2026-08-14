import type { ReservationStatus } from '@hospai/contracts/reservation-status';

const LABELS: Record<ReservationStatus, string> = {
  inquiry: 'Inquiry',
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'In house',
  checked_out: 'Departed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export function reservationStatusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}
