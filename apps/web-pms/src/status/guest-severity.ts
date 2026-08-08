import type { GuestRowState } from '@hospai/client-core';
import type { StatusSeverity } from './types.js';

export function guestSeverity(state: GuestRowState): StatusSeverity {
  switch (state.kind) {
    case 'resolved':
    case 'name_pending':
      return 'neutral';
    case 'erased':
      return 'informational';
    case 'not_found':
    case 'decrypt_unresolved':
      return 'exception';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
