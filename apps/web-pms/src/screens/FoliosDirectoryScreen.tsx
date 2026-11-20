import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClassifiedError, type FrontDeskItem, type GuestRowState } from '@hospai/client-core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RowActions,
  Skeleton,
  isReservationStatus,
  StatusBadge,
  type StatusRung,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { GuestNameLink, guestLabel } from './guest-row.js';

type SearchHit = {
  reservationId: string;
  guestRef?: string;
  displayName?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
};

function searchHits(result: unknown): SearchHit[] {
  if (!result || typeof result !== 'object') return [];
  const rec = result as { body?: { items?: unknown }; items?: unknown };
  const raw = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.body?.items)
      ? rec.body.items
      : [];
  return raw.filter(
    (row): row is SearchHit =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as { reservationId: unknown }).reservationId === 'string',
  );
}

function stayBadge(departureDate: string, today: string | null): { rung: StatusRung; label: string } {
  if (today && departureDate < today) return { rung: 'exception', label: 'Overstay' };
  if (today && departureDate === today) return { rung: 'attention', label: 'Due out today' };
  return { rung: 'informational', label: 'In house' };
}

function errorCopy(err: unknown, fallback: string): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback })
    : fallback;
}

function matches(row: FrontDeskItem, state: GuestRowState | undefined, needle: string): boolean {
  if (row.reservationId.toLowerCase().includes(needle)) return true;
  return state?.kind === 'resolved' && guestLabel(state, row.guestRef).toLowerCase().includes(needle);
}

function OpenFolio({ reservationId }: { reservationId: string }) {
  return (
    <RowActions>
      <Link
        className="ui-link-btn ui-link-btn--sm"
        to={`/folio/${encodeURIComponent(reservationId)}`}
      >
        Open folio
      </Link>
    </RowActions>
  );
}

/**
 * Folio directory (roadmap R1.2): in-house and due-out stays, filtered by guest
 * name or reservation id, each opening the existing FolioScreen. Reads only —
 * no folio balances here; the folio screen owns the money view.
 */
export function FoliosDirectoryScreen() {
  const timeZone = usePropertyTimeZone();
  const { dateRange, date, money } = useFormat();
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const { subtitle } = usePropertySubtitle('In-house and due-out stays');
  const propertyId = tenant.propertyId;
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const openFoliosQ = useQuery({
    queryKey: ['open-folios', propertyId],
    queryFn: () => api.listOpenFolios(propertyId),
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const listQ = useQuery({
    queryKey: ['board', 'in-house', tenant.propertyId, null, cursor],
    queryFn: () => api.getInHouse(tenant.propertyId, cursor),
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const items = listQ.data?.items ?? [];

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

  const openFolioItems = openFoliosQ.data?.items ?? [];
  const refs = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) set.add(i.guestRef);
    for (const i of openFolioItems) {
      if (i.guestRef) set.add(i.guestRef);
    }
    return [...set];
  }, [items, openFolioItems]);
  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, tenant.propertyId, refs),
    enabled: refs.length > 0 && (listQ.isSuccess || openFoliosQ.isSuccess),
    retry: false,
  });
  const states = batchQ.data?.states ?? {};

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? items.filter((row) => matches(row, states[row.guestRef], needle))
    : items;

  const searchQ = useQuery({
    queryKey: ['reservation-search', tenant.propertyId, debounced],
    queryFn: () => api.searchReservations(tenant.propertyId, debounced),
    enabled: debounced.length > 0 && listQ.isSuccess && filtered.length === 0,
    retry: false,
  });
  const hits = searchHits(searchQ.data);

  let body: ReactNode;
  let flush = false;
  if (listQ.isError) {
    body = (
      <Alert data-testid="folios-error">
        {errorCopy(listQ.error, 'Could not load in-house stays.')}
      </Alert>
    );
  } else if (!listQ.isSuccess) {
    body = <Skeleton />;
  } else if (items.length === 0 && !needle) {
    body = <EmptyState data-testid="folios-empty" title="No guests in house" />;
  } else if (filtered.length > 0) {
    flush = true;
    body = (
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Guest</DataTableHeaderCell>
            <DataTableHeaderCell>Room</DataTableHeaderCell>
            <DataTableHeaderCell>Dates</DataTableHeaderCell>
            <DataTableHeaderCell>Stay</DataTableHeaderCell>
            <DataTableHeaderCell align="right">
              <VisuallyHidden>Actions</VisuallyHidden>
            </DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {filtered.map((row) => {
            const badge = stayBadge(row.departureDate, today);
            return (
              <DataTableRow key={row.reservationId}>
                <DataTableCell>
                  <GuestNameLink state={states[row.guestRef]} guestRef={row.guestRef} />
                </DataTableCell>
                <DataTableCell>
                  {row.roomId == null ? (
                    <span className="muted">Unassigned</span>
                  ) : (
                    (roomsById.get(row.roomId) ?? '')
                  )}
                </DataTableCell>
                <DataTableCell>
                  <span className="ui-num">
                    {row.arrivalDate && row.departureDate
                      ? dateRange(row.arrivalDate, row.departureDate)
                      : ''}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <Badge rung={badge.rung}>{badge.label}</Badge>
                </DataTableCell>
                <DataTableCell align="right">
                  <OpenFolio reservationId={row.reservationId} />
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTableBody>
      </DataTable>
    );
  } else if (debounced.length === 0 || searchQ.isLoading) {
    body = <Skeleton />;
  } else if (hits.length > 0) {
    flush = true;
    body = (
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Guest</DataTableHeaderCell>
            <DataTableHeaderCell>Reservation</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell align="right">
              <VisuallyHidden>Actions</VisuallyHidden>
            </DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {hits.map((hit) => (
            <DataTableRow key={hit.reservationId}>
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
              <DataTableCell>{hit.reservationId}</DataTableCell>
              <DataTableCell>
                {hit.status && isReservationStatus(hit.status) ? (
                  <StatusBadge status={hit.status} />
                ) : hit.status ? (
                  reservationStatusLabel(hit.status)
                ) : (
                  ''
                )}
              </DataTableCell>
              <DataTableCell align="right">
                <OpenFolio reservationId={hit.reservationId} />
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    );
  } else {
    body = (
      <p className="muted" data-testid="folios-no-match">
        No stay matches “{q.trim()}”. Search covers in-house guests by name, and any
        reservation by its exact id.
      </p>
    );
  }

  let openBody: ReactNode;
  let openFlush = false;
  if (openFoliosQ.isError) {
    openBody = (
      <Alert data-testid="open-folios-error">
        {errorCopy(openFoliosQ.error, 'Could not load open folios.')}
      </Alert>
    );
  } else if (!openFoliosQ.isSuccess) {
    openBody = <Skeleton />;
  } else if ((openFoliosQ.data.items ?? []).length === 0) {
    openBody = <EmptyState data-testid="open-folios-empty" title="No open folios" />;
  } else {
    openFlush = true;
    openBody = (
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Guest</DataTableHeaderCell>
            <DataTableHeaderCell>Room</DataTableHeaderCell>
            <DataTableHeaderCell>Departure</DataTableHeaderCell>
            <DataTableHeaderCell>Balance</DataTableHeaderCell>
            <DataTableHeaderCell>Follow-up</DataTableHeaderCell>
            <DataTableHeaderCell>Close-by</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell align="right">
              <VisuallyHidden>Actions</VisuallyHidden>
            </DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {openFoliosQ.data.items.map((row) => (
            <DataTableRow key={row.holdId}>
              <DataTableCell>
                <GuestNameLink state={states[row.guestRef]} guestRef={row.guestRef} />
              </DataTableCell>
              <DataTableCell>
                {row.roomCode == null ? <span className="muted">Unassigned</span> : row.roomCode}
              </DataTableCell>
              <DataTableCell>
                <span className="ui-num">{date(row.departureDate)}</span>
              </DataTableCell>
              <DataTableCell>
                <span className="ui-num">{money(row.balanceMinor)}</span>
              </DataTableCell>
              <DataTableCell>
                <span className="ui-num">{date(row.followUpDate)}</span>
              </DataTableCell>
              <DataTableCell>
                <span className="ui-num">{date(row.closeByDate)}</span>
              </DataTableCell>
              <DataTableCell>
                {row.overdue ? <Badge rung="exception">Overdue</Badge> : null}
              </DataTableCell>
              <DataTableCell align="right">
                <OpenFolio reservationId={row.reservationId} />
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    );
  }

  return (
    <div className="board-page">
      <PageHeader title="Folios" subtitle={subtitle} />
      <Card id="open-folios" data-testid="open-folios">
        <CardHeader>
          <CardTitle>Open folios</CardTitle>
        </CardHeader>
        <CardContent flush={openFlush}>{openBody}</CardContent>
      </Card>
      <Card>
        <div className="ui-toolbar">
          <div className="directory-search">
            <Field
              label="Search"
              size="full"
              control={
                <Input
                  type="search"
                  autoComplete="off"
                  placeholder="Guest name or reservation id"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              }
            />
          </div>
        </div>
        <CardContent flush={flush}>{body}</CardContent>
        {listQ.data?.nextCursor ? (
          <CardFooter>
            <Button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
              Next page
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
