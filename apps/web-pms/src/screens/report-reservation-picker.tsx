import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Skeleton } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { useFormat } from '../shell/PropertyFormat.js';

export type PickedStay = {
  reservationId: string;
  displayName: string | null;
  roomCode: string | null;
  status: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
};

type Hit = {
  reservationId: string;
  displayName?: string | null;
  roomCode?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
};

function hitsOf(result: unknown): Hit[] {
  if (!result || typeof result !== 'object') return [];
  const rec = result as { body?: { items?: unknown }; items?: unknown };
  const raw = Array.isArray(rec.items) ? rec.items : Array.isArray(rec.body?.items) ? rec.body.items : [];
  return raw.filter(
    (row): row is Hit =>
      Boolean(row) && typeof row === 'object' && typeof (row as Hit).reservationId === 'string',
  );
}

/**
 * Picks one stay for a single-stay report through the desk search the top bar uses (guest name,
 * room or booking id). The choice is the reservation id; the name shown beside it is only for the
 * person reading the form.
 */
export function ReportReservationPicker({
  picked,
  onPick,
  onClear,
}: {
  picked: PickedStay | null;
  onPick: (stay: PickedStay) => void;
  onClear: () => void;
}) {
  const propertyId = tenant.propertyId;
  const { dateRange } = useFormat();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ['report-reservation-search', propertyId, debounced],
    queryFn: () => api.searchDesk(propertyId, debounced),
    enabled: debounced.length > 0 && picked === null,
    retry: false,
  });

  if (picked) {
    const parts = [
      picked.displayName ?? 'Guest unavailable',
      picked.roomCode ? `Room ${picked.roomCode}` : 'No room yet',
      picked.arrivalDate && picked.departureDate ? dateRange(picked.arrivalDate, picked.departureDate) : null,
      picked.status ? reservationStatusLabel(picked.status) : null,
    ].filter(Boolean);
    return (
      <div className="report-picker" data-testid="report-reservation-picked">
        <p>{parts.join(' · ')}</p>
        <Button size="sm" onClick={onClear} data-testid="report-reservation-change">
          Choose another stay
        </Button>
      </div>
    );
  }

  const waiting = q.trim().length > 0 && q.trim() !== debounced;
  const hits = !waiting && searchQ.isSuccess ? hitsOf(searchQ.data) : [];
  return (
    <div className="report-picker">
      <Field
        label="Find a stay"
        size="lg"
        control={
          <Input
            type="search"
            data-testid="report-reservation-search"
            placeholder="Guest name, room or booking ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />
      {waiting || (debounced.length > 0 && searchQ.isPending) ? <Skeleton label="Searching stays" lines={2} /> : null}
      {!waiting && searchQ.isError ? (
        <Alert data-testid="report-reservation-error">
          {classifiedUserMessage(asClassified(searchQ.error), { fallback: 'Search failed.' })}
        </Alert>
      ) : null}
      {!waiting && searchQ.isSuccess && hits.length === 0 ? (
        <p className="muted" data-testid="report-reservation-none">
          No stay matches “{debounced}”. Try a full name, room number or booking ID.
        </p>
      ) : null}
      {hits.length > 0 ? (
        <ul className="report-picker__hits" data-testid="report-reservation-hits">
          {hits.map((hit) => (
            <li key={hit.reservationId}>
              <Button
                size="sm"
                onClick={() =>
                  onPick({
                    reservationId: hit.reservationId,
                    displayName: hit.displayName ?? null,
                    roomCode: hit.roomCode ?? null,
                    status: hit.status ?? null,
                    arrivalDate: hit.arrivalDate ?? null,
                    departureDate: hit.departureDate ?? null,
                  })
                }
              >
                {[
                  hit.displayName ?? 'Guest unavailable',
                  hit.roomCode ? `Room ${hit.roomCode}` : 'No room yet',
                  hit.arrivalDate && hit.departureDate ? dateRange(hit.arrivalDate, hit.departureDate) : null,
                  hit.status ? reservationStatusLabel(hit.status) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
