import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ClassifiedError,
  shouldRetry,
  retryDelay,
  type FrontDeskItem,
} from '@hospai/client-core';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  PageHeader,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { GuestNameLink } from './guest-row.js';

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
    return roomsById.get(row.roomId) ?? '';
  }

  if (!searching && listQ.isError) {
    const c = asClassified(listQ.error);
    if (c.class === 'fail_closed' || listQ.error instanceof ClassifiedError) {
      return (
        <Alert>Property unreachable — board cannot load. This is not an empty day.</Alert>
      );
    }
    if (c.class === 'unauthorized') {
      window.location.assign('/sign-in');
      return null;
    }
    return <Alert>Failed to load directory</Alert>;
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
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Reservation</DataTableHeaderCell>
              <DataTableHeaderCell>Guest</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {hits.map((hit) => (
              <DataTableRow key={hit.reservationId}>
                <DataTableCell>
                  <Link to={`/folio/${encodeURIComponent(hit.reservationId)}`}>
                    View folio
                  </Link>
                </DataTableCell>
                <DataTableCell>
                  {hit.guestRef ? (
                    <GuestNameLink
                      state={
                        hit.displayName
                          ? { kind: 'resolved', displayName: hit.displayName }
                          : undefined
                      }
                      guestRef={hit.guestRef}
                    />
                  ) : (
                    (hit.displayName ?? '')
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      );
  } else if (windowParam !== 'all' && date == null) {
    body = <p className="muted">Loading…</p>;
  } else if (listQ.isLoading) {
    body = <p className="muted">Loading…</p>;
  } else if (items.length === 0) {
    body = <p className="muted">No reservations in this window.</p>;
  } else {
    body = (
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Reservation</DataTableHeaderCell>
            <DataTableHeaderCell>Guest</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell>Dates</DataTableHeaderCell>
            <DataTableHeaderCell>Room</DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {items.map((row) => (
            <DataTableRow key={row.reservationId}>
              <DataTableCell>
                <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>View folio</Link>
              </DataTableCell>
              <DataTableCell>
                <GuestNameLink state={states[row.guestRef]} guestRef={row.guestRef} />
              </DataTableCell>
              <DataTableCell>{reservationStatusLabel(row.status)}</DataTableCell>
              <DataTableCell>
                {row.arrivalDate} → {row.departureDate}
              </DataTableCell>
              <DataTableCell>{roomLabel(row)}</DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    );
  }

  return (
    <div>
      <PageHeader title="Reservations" />
      <Card>
        <CardHeader>
          <header className="board-header">
            <nav className="stack-row">
              <Link to={tabSearch('today', date)}>Today</Link>
              <Link to={tabSearch('tomorrow', date)}>Tomorrow</Link>
              <Link to={tabSearch('week', date)}>This Week</Link>
              <Link to={tabSearch('all', date)}>All</Link>
            </nav>
            <div className="stack-row">
              <Button type="button" onClick={() => setStatus(null)}>
                All statuses
              </Button>
              <Button type="button" onClick={() => setStatus(ACTIVE_STATUS)}>
                Active
              </Button>
              <Button type="button" onClick={() => setStatus(TERMINAL_STATUS)}>
                Terminal
              </Button>
            </div>
            <Field
              label="Search"
              control={
                <Input
                  type="search"
                  autoComplete="off"
                  placeholder="Reservation id or guest name…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              }
            />
          </header>
        </CardHeader>
        <CardContent>
          {body}
          {!searching && listQ.data?.nextCursor ? (
            <Button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
              Next page
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
