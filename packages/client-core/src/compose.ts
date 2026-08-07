export type GuestRowState =
  | { kind: 'resolved'; displayName: string }
  | { kind: 'erased' }
  | { kind: 'not_found' }
  | { kind: 'decrypt_unresolved' }
  | { kind: 'name_pending' };

function mapEntry(guestId: string, entry: unknown): GuestRowState {
  if (entry === null || typeof entry !== 'object') return { kind: 'name_pending' };
  const e = entry as Record<string, unknown>;
  if (e.ok === false) {
    if (e.error === 'decrypt_unresolved') return { kind: 'decrypt_unresolved' };
    if (e.error === 'guest_not_found') return { kind: 'not_found' };
    return { kind: 'name_pending' };
  }
  if (e.erased === true) return { kind: 'erased' };
  const profile = e.profile as Record<string, unknown> | null | undefined;
  const displayName = typeof profile?.displayName === 'string' ? profile.displayName : guestId;
  return { kind: 'resolved', displayName };
}

export function composeGuestStates(
  refs: string[],
  batch: { ok: true; guests: Record<string, unknown> } | { ok: false; wholesaleFailure: true },
): Record<string, GuestRowState> {
  const out: Record<string, GuestRowState> = {};
  if (!batch.ok) {
    for (const ref of refs) out[ref] = { kind: 'name_pending' };
    return out;
  }
  for (const ref of refs) {
    out[ref] = mapEntry(ref, batch.guests[ref]);
  }
  return out;
}
