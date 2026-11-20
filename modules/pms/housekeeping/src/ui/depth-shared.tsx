import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Field, Input, NativeSelect } from '@hospai/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import type { HousekeepingApi, HousekeepingGuests, HousekeepingRosterPerson } from './housekeeping-types.js';

/** `guestRef` -> name through the host's property-scoped batch. Never a name from this module's reads. */
export function useGuestLabels(
  propertyId: string,
  guests: HousekeepingGuests | undefined,
  refs: ReadonlyArray<string | null | undefined>,
): (ref: string) => string {
  const unique = useMemo(
    () => [...new Set(refs.filter((r): r is string => typeof r === 'string' && r.length > 0))].sort(),
    [refs],
  );
  const query = useQuery({
    queryKey: ['housekeeping-guest-labels', propertyId, unique.join('|')],
    queryFn: () => guests!.labels(unique),
    enabled: Boolean(guests) && unique.length > 0,
    retry: false,
  });
  return (ref) => {
    if (!guests) return 'Guest';
    const label = query.data?.[ref];
    if (label) return label;
    return query.isError ? 'Guest unavailable' : 'Name pending';
  };
}

export function GuestLink({ guestRef, label }: { guestRef: string; label: string }) {
  return (
    <Link to={`/guests/${encodeURIComponent(guestRef)}`} data-testid="guest-profile-link">
      {label}
    </Link>
  );
}

/** Staff names by id, for words instead of `staff_…` refs. Empty without roster access. */
export function useStaffRoster(api: HousekeepingApi, propertyId: string, canReadRoster: boolean) {
  const query = useQuery({
    queryKey: ['roster', propertyId, 'any'],
    queryFn: () => api.listRoster(propertyId),
    enabled: canReadRoster,
  });
  const staff = useMemo(() => query.data?.staff ?? [], [query.data]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of staff) if (p.displayName) map.set(p.staffId, p.displayName);
    return map;
  }, [staff]);
  return { staff, names, loading: query.isLoading, loaded: query.isSuccess };
}

export function activeStaff(
  staff: readonly HousekeepingRosterPerson[],
  kind?: 'housekeeper' | 'maintenance',
): HousekeepingRosterPerson[] {
  return staff
    .filter((p) => p.status === 'active' && p.exitedAt == null && (!kind || p.kinds.includes(kind)))
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
}

export function staffName(names: ReadonlyMap<string, string>, ref: string | null | undefined): string {
  if (!ref) return '—';
  return names.get(ref) ?? 'Staff member';
}

/**
 * Link a record to the stay that is in the chosen room right now (the room board's in-house stay).
 * Renders nothing when the board is unavailable or the room has nobody in it. The caller clears
 * the value whenever the room changes.
 */
export function StayPicker({
  propertyId,
  api,
  roomId,
  value,
  onChange,
  labelFor,
  guests,
}: {
  propertyId: string;
  api: HousekeepingApi;
  roomId: string;
  value: string;
  onChange: (reservationId: string) => void;
  labelFor: (ref: string) => string;
  guests: HousekeepingGuests | undefined;
}) {
  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard) && Boolean(roomId),
    retry: false,
  });
  const stay = board.data?.rooms.find((r) => r.roomId === roomId)?.inHouse ?? null;
  if (!stay) return null;
  return (
    <Field
      label="Stay"
      control={
        <NativeSelect aria-label="Stay" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not linked to a stay</option>
          <option value={stay.reservationId}>
            {guests ? `In-house stay of ${labelFor(stay.guestRef)}` : 'The in-house stay'}
          </option>
        </NativeSelect>
      }
    />
  );
}

/** Property-scoped guest search; picks a guest record. A typed name is never stored. */
export function GuestPicker({
  propertyId,
  guests,
  selected,
  onSelect,
}: {
  propertyId: string;
  guests: HousekeepingGuests;
  selected: { guestRef: string; label: string } | null;
  onSelect: (guest: { guestRef: string; label: string } | null) => void;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text.trim()), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const results = useQuery({
    queryKey: ['housekeeping-guest-search', propertyId, debounced],
    queryFn: () => guests.search(debounced),
    enabled: debounced.length >= 2,
    retry: false,
  });
  return (
    <div className="ui-stack" data-testid="guest-picker">
      {selected ? (
        <div className="ui-row">
          <span data-testid="picked-guest">{selected.label}</span>
          <Button type="button" intent="ghost" onClick={() => onSelect(null)}>
            Change guest
          </Button>
        </div>
      ) : (
        <>
          <Field
            label="Find the guest"
            hint="Search the guest directory by name, email or phone."
            control={
              <Input
                aria-label="Search guests"
                value={text}
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
            }
          />
          {results.isError ? <p className="muted">Could not search guests.</p> : null}
          {results.isSuccess && results.data.length === 0 ? (
            <p className="muted">No guests match that search.</p>
          ) : null}
          {results.data && results.data.length > 0 ? (
            <ul className="ui-stack" aria-label="Guest results">
              {results.data.map((g) => (
                <li key={g.guestRef}>
                  <Button type="button" onClick={() => onSelect(g)}>
                    {g.label}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
