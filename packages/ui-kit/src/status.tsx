import clsx from 'clsx';
import type { TestIdProps } from './types.js';
import { RESERVATION_STATUSES, type ReservationStatus, type RoomHkStatus } from './types.js';

const STATUS_WORD: Record<ReservationStatus, string> = {
  inquiry: 'Inquiry',
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'In house',
  checked_out: 'Checked out',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const STATUS_TONE: Record<ReservationStatus, string> = {
  inquiry: 'status-neutral',
  pending: 'stay-pending',
  confirmed: 'stay-confirmed',
  checked_in: 'stay-inhouse',
  checked_out: 'status-cancelled',
  cancelled: 'status-cancelled',
  no_show: 'status-exception',
};

const ROOM_WORD: Record<RoomHkStatus, string> = {
  clean: 'Clean',
  dirty: 'Dirty',
  inspected: 'Inspected',
  out_of_order: 'Out of order',
};

export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

/** One source for the reservation life-cycle words. Unknown values pass through. */
export function reservationStatusWord(status: string): string {
  return isReservationStatus(status) ? STATUS_WORD[status] : status;
}

export function isRoomHkStatus(value: string): value is RoomHkStatus {
  return value === 'clean' || value === 'dirty' || value === 'inspected' || value === 'out_of_order';
}

export function roomStatusWord(status: string): string {
  return isRoomHkStatus(status) ? ROOM_WORD[status] : status;
}

export type StatusBadgeProps = TestIdProps & {
  status: ReservationStatus;
  vip?: boolean;
};

export function StatusBadge({ status, vip, 'data-testid': dataTestId }: StatusBadgeProps) {
  return (
    <span className="ui-status-badge">
      <span className={clsx('ui-badge', STATUS_TONE[status])} data-testid={dataTestId}>
        {STATUS_WORD[status]}
      </span>
      {vip ? (
        <span className="ui-badge status-vip" data-testid="badge-vip">
          VIP
        </span>
      ) : null}
    </span>
  );
}

export type RoomStatusProps = {
  /** Known HK states render a dot and a word. Anything else is the raw text. */
  status: RoomHkStatus | (string & {});
};

export function RoomStatus({ status }: RoomStatusProps) {
  if (!isRoomHkStatus(status)) {
    return <span className="ui-badge status-neutral">{status}</span>;
  }
  return (
    <span className="ui-room-status">
      <span className={clsx('ui-room-status__dot', `ui-room-status__dot--${status}`)} />
      {ROOM_WORD[status]}
    </span>
  );
}
