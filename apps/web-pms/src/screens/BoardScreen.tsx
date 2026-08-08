import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import { ClassifiedError } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { guestLabel } from './guest-row.js';

export type BoardMode = 'arrivals' | 'departures' | 'in-house';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BoardScreen({ mode }: { mode: BoardMode }) {
  const [date, setDate] = useState(todayUtc());
  const [cursor, setCursor] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['board', mode, tenant.propertyId, date, cursor],
    queryFn: async () => {
      if (mode === 'arrivals') return api.getArrivals(tenant.propertyId, date, cursor);
      if (mode === 'departures') return api.getDepartures(tenant.propertyId, date, cursor);
      return api.getInHouse(tenant.propertyId, cursor);
    },
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const refs = useMemo(
    () => [...new Set((listQ.data?.items ?? []).map((i) => i.guestRef))],
    [listQ.data],
  );

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => api.postGuestsBatch(tenant.propertyId, refs),
    enabled: refs.length > 0 && listQ.isSuccess,
    retry: false,
  });

  if (listQ.isError) {
    const c = asClassified(listQ.error);
    if (c.class === 'fail_closed' || listQ.error instanceof ClassifiedError) {
      return (
        <div className="error" role="alert">
          Property unreachable — board cannot load. This is not an empty day.
        </div>
      );
    }
    if (c.class === 'unauthorized') {
      window.location.assign('/sign-in');
      return null;
    }
    return <div className="error">Failed to load board</div>;
  }

  const items = listQ.data?.items ?? [];
  const states = batchQ.data?.states ?? {};

  return (
    <div>
      <header className="board-header">
        <h1 className="board-title">{mode.replace('-', ' ')}</h1>
        {mode !== 'in-house' ? (
          <label>
            Date{' '}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setCursor(null);
                setDate(e.target.value);
              }}
            />
          </label>
        ) : null}
      </header>

      <div className="panel">
        {listQ.isLoading ? <p className="muted">Loading…</p> : null}
        {!listQ.isLoading && items.length === 0 ? (
          <p className="muted">No reservations for this view</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Guest</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.reservationId}>
                  <td>{row.reservationId}</td>
                  <td>{guestLabel(states[row.guestRef], row.guestRef)}</td>
                  <td>
                    {mode === 'arrivals' ? (
                      <Link to={`/check-in/${encodeURIComponent(row.reservationId)}`}>Check in</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {listQ.data?.nextCursor ? (
          <button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
            Next page
          </button>
        ) : null}
      </div>
    </div>
  );
}
