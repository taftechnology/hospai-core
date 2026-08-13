import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ClassifiedError,
  shouldRetry,
  retryDelay,
  type FrontDeskItem,
} from '@hospai/client-core';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { guestLabel } from './guest-row.js';

type DirWindow = 'today' | 'tomorrow' | 'week' | 'all';
const ACTIVE_STATUS = 'inquiry,pending,confirmed,checked_in';
const TERMINAL_STATUS = 'checked_out,cancelled,no_show';

function dateFromSearchParam(raw: string | null): string | null {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function asWindow(raw: string | null): DirWindow {
  if (raw === 'tomorrow' || raw === 'week' || raw === 'all') return raw;
  return 'today';
}

function searchItems(result: unknown): Array<{
  reservationId: string;
  guestRef?: string;
  displayName?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
}> {
  if (!result || typeof result !== 'object') return [];
  const rec = result as { body?: { items?: unknown }; items?: unknown };
  const raw = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.body?.items)
      ? rec.body.items
      : [];
  return raw.filter(
    (row): row is { reservationId: string } =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as { reservationId: unknown }).reservationId === 'string',
  );
}

function tabSearch(window: DirWindow, date: string | null): string {
  const sp = new URLSearchParams();
  sp.set('window', window);
  if (window !== 'all' && date) sp.set('date', date);
  return `?${sp.toString()}`;
}

export function ReservationsDirectoryScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const windowParam = asWindow(params.get('window'));
  const dateParam = dateFromSearchParam(params.get('date'));
  const statusParam = params.get('status');
  const [date, setDate] = useState<string | null>(() => dateParam);
  const seededRef = useRef(windowParam === 'all' || Boolean(dateParam));
  const timeZone = usePropertyTimeZone();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (seededRef.current) return;
    if (windowParam === 'all') {
      seededRef.current = true;
      return;
    }
    if (dateParam) {
      seededRef.current = true;
      setDate(dateParam);
      return;
    }
    if (!timeZone) return;
    const seeded = propertyLocalToday(timeZone);
    seededRef.current = true;
    setDate(seeded);
    navigate({ search: tabSearch(windowParam, seeded) }, { replace: true });
  }, [windowParam, dateParam, timeZone, navigate]);

  const searching = debounced.length > 0;
  const listEnabled = !searching && (windowParam === 'all' || date != null);

  const listQ = useQuery({
    queryKey: [
      'front-desk-directory',
      tenant.propertyId,
      windowParam,
      windowParam === 'all' ? null : date,
      statusParam,
      cursor,
    ],
    queryFn: () =>
      api.getFrontOfficeDirectory(tenant.propertyId, {
        window: windowParam,
        date: windowParam === 'all' ? undefined : date!,
        status: statusParam || undefined,
        cursor,
      }),
    enabled: listEnabled,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  const searchQ = useQuery({
    queryKey: ['reservation-search', tenant.propertyId, debounced],
    queryFn: () => api.searchReservations(tenant.propertyId, debounced),
    enabled: searching,
    retry: false,
  });

  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const me = meQ.data as PropertyMe | undefined;
  const canRooms = Boolean(me && hasPropertyPermission(me, 'housekeeping:read'));

  const roomsQ = useQuery({
    queryKey: ['rooms', tenant.propertyId],
    queryFn: () => api.listRooms(tenant.propertyId),
    enabled: canRooms && listQ.isSuccess,
    retry: false,
  });

  const roomsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roomsQ.data?.rooms ?? []) map.set(r.roomId, r.code);
    return map;
  }, [roomsQ.data]);

  const refs = useMemo(
    () => [...new Set((listQ.data?.items ?? []).map((i) => i.guestRef))],
    [listQ.data],
  );

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => api.postGuestsBatch(tenant.propertyId, refs),
    enabled: refs.length > 0 && listQ.isSuccess && !searching,
    retry: false,
  });

  function setStatus(next: string | null) {
    const sp = new URLSearchParams(params);
    if (next) sp.set('status', next);
    else sp.delete('status');
    setCursor(null);
    navigate({ search: `?${sp.toString()}` }, { replace: true });
  }

  function roomLabel(row: FrontDeskItem): string {
    if (!row.roomId) return '';
    return roomsById.get(row.roomId) ?? (row.roomId.length > 8 ? `${row.roomId.slice(0, 8)}…` : row.roomId);
  }

  if (!searching && listQ.isError) {
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
    return <div className="error">Failed to load directory</div>;
  }

  const items = listQ.data?.items ?? [];
  const states = batchQ.data?.states ?? {};
  const hits = searching ? searchItems(searchQ.data) : [];

  let body: ReactNode;
  if (searching) {
    body =
      hits.length === 0 ? (
        <p className="muted">No reservations in this window.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reservation</th>
              <th>Guest</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit) => (
              <tr key={hit.reservationId}>
                <td translate="no">
                  <Link to={`/folio/${encodeURIComponent(hit.reservationId)}`}>
                    {hit.reservationId}
                  </Link>
                </td>
                <td>{hit.displayName ?? hit.guestRef ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  } else if (windowParam !== 'all' && date == null) {
    body = <p className="muted">Loading…</p>;
  } else if (listQ.isLoading) {
    body = <p className="muted">Loading…</p>;
  } else if (items.length === 0) {
    body = <p className="muted">No reservations in this window.</p>;
  } else {
    body = (
      <table>
        <thead>
          <tr>
            <th>Reservation</th>
            <th>Guest</th>
            <th>Status</th>
            <th>Dates</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.reservationId}>
              <td translate="no">
                <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>{row.reservationId}</Link>
              </td>
              <td>{guestLabel(states[row.guestRef], row.guestRef)}</td>
              <td>{row.status}</td>
              <td className="tabular-nums">
                {row.arrivalDate} → {row.departureDate}
              </td>
              <td className="truncate min-w-0">{roomLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      <header className="board-header">
        <h1 className="board-title">Reservations</h1>
        <nav className="stack-row">
          <Link to={tabSearch('today', date)}>Today</Link>
          <Link to={tabSearch('tomorrow', date)}>Tomorrow</Link>
          <Link to={tabSearch('week', date)}>This Week</Link>
          <Link to={tabSearch('all', date)}>All</Link>
        </nav>
        <div className="stack-row">
          <button type="button" onClick={() => setStatus(null)}>
            All statuses
          </button>
          <button type="button" onClick={() => setStatus(ACTIVE_STATUS)}>
            Active
          </button>
          <button type="button" onClick={() => setStatus(TERMINAL_STATUS)}>
            Terminal
          </button>
        </div>
        <label>
          Search{' '}
          <input
            type="search"
            autoComplete="off"
            placeholder="Reservation id or guest name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </header>
      <div className="panel">
        {body}
        {!searching && listQ.data?.nextCursor ? (
          <button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
            Next page
          </button>
        ) : null}
      </div>
    </div>
  );
}
