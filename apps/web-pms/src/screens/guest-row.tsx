import type { GuestRowState } from '@hospai/client-core';
import { Link } from 'react-router';

export function guestLabel(state: GuestRowState | undefined, guestRef: string): string {
  if (!state || state.kind === 'name_pending') return 'Name pending';
  if (state.kind === 'resolved') return state.displayName;
  if (state.kind === 'erased') return 'Guest erased';
  if (state.kind === 'not_found') return 'Guest unavailable';
  return 'Guest unavailable';
}

export function GuestNameLink({
  state,
  guestRef,
}: {
  state: GuestRowState | undefined;
  guestRef: string;
}) {
  return (
    <Link
      to={`/guests/${encodeURIComponent(guestRef)}`}
      data-testid="guest-profile-link"
      title={guestRef}
    >
      {guestLabel(state, guestRef)}
    </Link>
  );
}
