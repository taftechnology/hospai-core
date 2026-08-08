import type { ReservationStatus } from '@hospai/contracts/reservation-status';
import type { BoardMode } from './board-mode.js';
import type { StatusSeverity } from './types.js';

export function boardRowSeverity(input: {
  mode: BoardMode;
  status: ReservationStatus;
  overstay: boolean;
}): StatusSeverity {
  const { mode, status, overstay } = input;
  if (mode === 'in-house' && overstay) return 'exception';

  if (mode === 'departures') {
    switch (status) {
      case 'checked_in':
        return 'attention';
      case 'checked_out':
        return 'neutral';
      case 'cancelled':
        return 'informational';
      case 'no_show':
      case 'confirmed':
        return 'attention';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  if (mode === 'arrivals') {
    switch (status) {
      case 'confirmed':
        return 'neutral';
      case 'cancelled':
      case 'checked_in':
      case 'checked_out':
      case 'no_show':
        return 'informational';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  switch (status) {
    case 'checked_in':
      return 'neutral';
    case 'confirmed':
    case 'cancelled':
    case 'checked_out':
    case 'no_show':
      return 'informational';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
