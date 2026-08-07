import type { GuestRowState } from '@hospai/client-core';

export function guestLabel(state: GuestRowState | undefined, guestRef: string): string {
  if (!state || state.kind === 'name_pending') return `${guestRef} (name pending)`;
  if (state.kind === 'resolved') return state.displayName;
  if (state.kind === 'erased') return `${guestRef} (erased)`;
  if (state.kind === 'not_found') return `${guestRef} (not found)`;
  return `${guestRef} (decrypt unresolved)`;
}
