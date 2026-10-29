import { reservationStatusWord } from '@hospai/ui-kit';

/** Words live on StatusBadge. This stays so sentence copy and search meta share them. */
export function reservationStatusLabel(status: string): string {
  return reservationStatusWord(status);
}
