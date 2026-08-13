import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClassifiedError,
  type FrontDeskItem,
  type GuestRowState,
} from '@hospai/client-core';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '@hospai/contracts/reservation-status';
import { api, asClassified, tenant } from '../client.js';
import type { BoardMode } from '../status/board-mode.js';
import { boardRowSeverity } from '../status/board-row-severity.js';
import { guestSeverity } from '../status/guest-severity.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { statusClass } from '../status/status-class.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { guestLabel } from './guest-row.js';

export type { BoardMode };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateFromSearchParam(raw: string | null): string | null {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function asReservationStatus(value: unknown): ReservationStatus | null {
  if (typeof value !== 'string') return null;
  return (RESERVATION_STATUSES as readonly string[]).includes(value)
    ? (value as ReservationStatus)
    : null;
}

function partitionDepartures(items: FrontDeskItem[]) {
  const dueOut: FrontDeskItem[] = [];
  const departed: FrontDeskItem[] = [];
  const other: FrontDeskItem[] = [];
  for (const row of items) {
    const status = asReservationStatus(row.status);
    if (status === 'checked_in') dueOut.push(row);
    else if (status === 'checked_out') departed.push(row);
    else other.push(row);
  }
  return { dueOut, departed, other };
}

function ConfirmPendingButton({ reservationId }: { reservationId: string }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () =>
      api.confirmReservation(
        tenant.propertyId,
        reservationId,
        `confirm:${reservationId}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['arrivals'] });
    },
  });
  return (
    <button
      type="button"
      disabled={confirm.isPending}
      onClick={() => confirm.mutate()}
    >
      Confirm
    </button>
  );
}

function BoardTable({
  mode,
  items,
  states,
  timeZone,
}: {
  mode: BoardMode;
  items: FrontDeskItem[];
  states: Record<string, GuestRowState>;
  timeZone: string | null;
}) {
  const today = timeZone ? propertyLocalToday(timeZone) : null;

  return (
    <table>
      <thead>
        <tr>
          <th>Reservation</th>
          <th>Guest</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((row) => {
          const status = asReservationStatus(row.status);
          const overstay =
            mode === 'in-house' &&
            today != null &&
            typeof row.departureDate === 'string' &&
            row.departureDate < today;
          // Unrecognized wire status → informational (not a silent neutral/confirmed).
          const rowSev = status
            ? boardRowSeverity({ mode, status, overstay })
            : 'informational';
          const guestState = states[row.guestRef] ?? { kind: 'name_pending' as const };
          const guestSev = guestSeverity(guestState);
          return (
            <tr key={row.reservationId} className={statusClass(rowSev)}>
              <td>
                {row.reservationId}
                {overstay ? ' (overstay)' : ''}
              </td>
              <td className={statusClass(guestSev)}>{guestLabel(guestState, row.guestRef)}</td>
              <td>
                {mode === 'arrivals' && status === 'pending' ? (
                  <ConfirmPendingButton reservationId={row.reservationId} />
                ) : null}
                {mode === 'arrivals' && status !== 'pending' ? (
                  <Link to={`/check-in/${encodeURIComponent(row.reservationId)}`}>Check in</Link>
                ) : null}{' '}
                <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>Folio</Link>{' '}
                <Link to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}>
                  Book for guest
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DeparturesBoard({
  items,
  states,
  timeZone,
}: {
  items: FrontDeskItem[];
  states: Record<string, GuestRowState>;
  timeZone: string | null;
}) {
  const { dueOut, departed, other } = partitionDepartures(items);
  const sections: Array<{ title: string; rows: FrontDeskItem[] }> = [
    { title: 'Due out', rows: dueOut },
    { title: 'Departed', rows: departed },
    { title: 'Other', rows: other },
  ];

  return (
    <>
      {sections.map((section) => (
        <section key={section.title} className="board-group">
          <h2 className="board-group-title">{section.title}</h2>
          {section.rows.length === 0 ? (
            <p className="muted">None</p>
          ) : (
            <BoardTable
              mode="departures"
              items={section.rows}
              states={states}
              timeZone={timeZone}
            />
          )}
        </section>
      ))}
    </>
  );
}

export function BoardScreen({ mode }: { mode: BoardMode }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dateParam = dateFromSearchParam(params.get('date'));
  const [date, setDate] = useState(() => dateParam ?? todayUtc());
  const [cursor, setCursor] = useState<string | null>(null);
  const timeZone = usePropertyTimeZone();
  const [createdBanner, setCreatedBanner] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { createdReservationId?: string } | null;
    const id = state?.createdReservationId;
    if (!id) return;
    setCreatedBanner(id);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);

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

  let body: ReactNode;
  if (listQ.isLoading) {
    body = <p className="muted">Loading…</p>;
  } else if (items.length === 0) {
    body = <p className="muted">No reservations for this view</p>;
  } else if (mode === 'departures') {
    body = <DeparturesBoard items={items} states={states} timeZone={timeZone} />;
  } else {
    body = <BoardTable mode={mode} items={items} states={states} timeZone={timeZone} />;
  }

  return (
    <div>
      <header className="board-header">
        <h1 className="board-title">{mode.replace('-', ' ')}</h1>
        {mode !== 'in-house' ? (
          <label>
            Date{' '}
            <input
              type="date"
              data-testid="board-date"
              value={date}
              onChange={(e) => {
                setCursor(null);
                setDate(e.target.value);
              }}
            />
          </label>
        ) : null}
      </header>

      {createdBanner ? (
        <p className="panel" role="status" data-testid="created-banner">
          Reservation {createdBanner} created
        </p>
      ) : null}

      <div className="panel">
        {body}
        {listQ.data?.nextCursor ? (
          <button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
            Next page
          </button>
        ) : null}
      </div>
    </div>
  );
}
