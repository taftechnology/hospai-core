import { useQuery } from '@tanstack/react-query';
import type {
  HousekeepingAttentionRow,
  HousekeepingDashboard,
  HousekeepingDashboardSearchRoom,
} from '@hospai/contracts';
import { HK_DASHBOARD_ROOM_SEARCH_LEN_MAX } from '@hospai/contracts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
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
  Metrics,
  PageHeader,
  RoomStatus,
  Skeleton,
  Toolbar,
} from '@hospai/ui-kit';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { GuestLink, useGuestLabels } from './depth-shared.js';
import { ATTENTION_KIND_LABEL, roomConditionLabel } from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingGuests } from './housekeeping-types.js';
import { useBusinessDate } from './use-business-date.js';

/** The one cache key of the supervisor dashboard (R4.31). The web-pms mutation cache invalidates its prefix. */
export function housekeepingDashboardKey(propertyId: string, businessDate: string, search: string) {
  return ['housekeeping-dashboard', propertyId, businessDate, search] as const;
}

const SEARCH_DEBOUNCE_MS = 300;

type DateFormat = { dateHeading: (iso: string) => string; date?: (iso: string) => string };

function attentionSubject(row: HousekeepingAttentionRow, date: (iso: string) => string): string {
  const on = row.date ? date(row.date) : '';
  switch (row.kind) {
    case 'occupied_out_of_order':
      return `A guest is in a room under a block${row.subject ? `: ${row.subject}` : ''}${on ? `, until ${on}` : ''}`;
    case 'occupied_counted_vacant':
      return 'Counted empty in today’s guest audit, but front office has guests in it';
    case 'arrival_not_ready':
      return 'Arrives today and the room is not ready';
    case 'overdue_task':
      return `${row.subject ?? 'Task'}${on ? `, due ${on}` : ''}`;
    case 'active_block':
      return `${row.subject ?? 'Blocked'}${on ? `, until ${on}` : ''}`;
    case 'open_request':
    case 'open_case':
      return `${row.subject ?? ''}${on ? `, from ${on}` : ''}`;
    default:
      return row.subject ?? '';
  }
}

/** The existing screen each kind of row opens. */
function attentionLink(row: HousekeepingAttentionRow): { to: string; label: string } {
  switch (row.kind) {
    case 'occupied_out_of_order':
      return { to: '/rooms/live', label: 'Live rooms' };
    case 'occupied_counted_vacant':
      return row.reservationId
        ? { to: `/folio/${encodeURIComponent(row.reservationId)}`, label: 'Folio' }
        : { to: '/housekeeping/guest-audit', label: 'Guest audit' };
    case 'arrival_not_ready':
      return { to: '/rooms/live', label: 'Live rooms' };
    case 'overdue_task':
      return { to: '/housekeeping/tasks', label: 'Tasks' };
    case 'active_block':
      return { to: '/maintenance', label: 'Maintenance' };
    case 'open_request':
      return { to: '/housekeeping/requests', label: 'Requests' };
    case 'open_case':
      return { to: '/housekeeping/cases', label: 'Cases' };
  }
}

function kindRung(kind: string): 'exception' | 'attention' | 'informational' {
  if (kind === 'occupied_out_of_order' || kind === 'occupied_counted_vacant') return 'exception';
  if (kind === 'arrival_not_ready' || kind === 'overdue_task' || kind === 'open_case') return 'attention';
  return 'informational';
}

/** A count card that is itself the link to its tab: plain text title that wraps, the number below. */
function CountLink({ to, label, value, testId }: { to: string; label: string; value: number | null; testId: string }) {
  return (
    <Link className="ui-metric" to={to} data-testid={testId}>
      {label}
      <span className="ui-metric__value">{value ?? '—'}</span>
    </Link>
  );
}

export function HousekeepingOverview({
  propertyId,
  defaultBusinessDate,
  api,
  guests,
  subtitle,
  formatError,
  format,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  guests?: HousekeepingGuests;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: DateFormat;
}) {
  const [businessDate] = useBusinessDate(defaultBusinessDate);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const date = format.date ?? format.dateHeading;

  useEffect(() => {
    const handle = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [typed]);

  const query = useQuery({
    queryKey: housekeepingDashboardKey(propertyId, businessDate, search),
    queryFn: () => api.getHousekeepingDashboard(propertyId, search ? { room: search } : undefined),
    enabled: Boolean(businessDate),
    placeholderData: (previous) => previous,
  });
  const data: HousekeepingDashboard | undefined = query.data;

  const guestRefs = useMemo(() => {
    if (!data) return [];
    return [
      ...data.arrivals.map((a) => a.guestRef),
      ...data.departures.map((d) => d.guestRef),
      ...data.attention.map((a) => a.guestRef),
      ...(data.roomSearch?.rooms.flatMap((r) => [r.inHouse?.guestRef, r.nextArrival?.guestRef]) ?? []),
    ];
  }, [data]);
  const labelFor = useGuestLabels(propertyId, guests, guestRefs);
  const guestCell = (ref: string | null | undefined) =>
    ref ? <GuestLink guestRef={ref} label={labelFor(ref)} /> : '—';

  const failure = query.isError
    ? (formatError?.(query.error) ?? 'Could not load the housekeeping overview.')
    : null;

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Housekeeping"
        subtitle={
          subtitle ?? (
            <>
              {data ? format.dateHeading(data.businessDate) : ''} <span className="sep">·</span> today at a glance
            </>
          )
        }
      />
      <HousekeepingNav view="overview" />
      {query.isLoading ? <Skeleton label="Loading the overview" /> : null}
      {failure ? <Alert intent="exception">{failure}</Alert> : null}
      {data && data.readiness.rooms === 0 ? (
        <EmptyState kind="empty" title="No rooms are set up yet." description="Add rooms in Settings to see readiness here." />
      ) : null}
      {data && data.readiness.rooms > 0 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Rooms ready:{' '}
                <span data-testid="hk-ov-readiness">{data.readiness.readinessPercent}%</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                {data.readiness.ready} of {data.readiness.rooms - data.readiness.underMaintenance} rooms ready
                {data.readiness.underMaintenance > 0
                  ? `, not counting ${data.readiness.underMaintenance} under a block`
                  : ''}
                {data.requireInspection ? '. A room is ready once inspected.' : '. A room is ready once clean.'}
              </p>
              <div data-testid="hk-ov-counts">
                <Metrics>
                  <CountLink to="/housekeeping/board" label="Dirty rooms" value={data.counts.dirtyRooms} testId="hk-ov-dirty" />
                  <CountLink to="/housekeeping/tasks" label="Open tasks" value={data.counts.openTasks} testId="hk-ov-open-tasks" />
                  <CountLink to="/housekeeping/tasks" label="Overdue tasks" value={data.counts.overdueTasks} testId="hk-ov-overdue-tasks" />
                  <CountLink to="/housekeeping/board" label="Active blocks" value={data.counts.activeBlocks} testId="hk-ov-blocks" />
                  <CountLink to="/housekeeping/requests" label="Open requests" value={data.counts.openRequests} testId="hk-ov-requests" />
                  <CountLink to="/housekeeping/lost-found" label="Unclaimed items" value={data.counts.unclaimedItems} testId="hk-ov-unclaimed" />
                  <CountLink to="/housekeeping/cases" label="Open damage and missing cases" value={data.counts.openCases} testId="hk-ov-cases" />
                  <CountLink
                    to="/housekeeping/guest-audit"
                    label="Guest audit differences"
                    value={data.counts.auditVariance}
                    testId="hk-ov-audit"
                  />
                </Metrics>
              </div>
              {data.counts.auditVariance === null ? <p>No guest audit has been started today.</p> : null}
            </CardContent>
            <CardContent flush>
              <DataTable data-testid="hk-ov-floors">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Floor</DataTableHeaderCell>
                    <DataTableHeaderCell>Rooms</DataTableHeaderCell>
                    <DataTableHeaderCell>Ready</DataTableHeaderCell>
                    <DataTableHeaderCell>Dirty</DataTableHeaderCell>
                    <DataTableHeaderCell>Under a block</DataTableHeaderCell>
                    <DataTableHeaderCell>With a guest</DataTableHeaderCell>
                    <DataTableHeaderCell>Rooms ready</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {data.floors.map((f) => (
                    <DataTableRow key={f.floor ?? 'none'}>
                      <DataTableCell>{f.floor ?? 'No floor'}</DataTableCell>
                      <DataTableCell>{f.rooms}</DataTableCell>
                      <DataTableCell>{f.ready}</DataTableCell>
                      <DataTableCell>{f.dirty}</DataTableCell>
                      <DataTableCell>{f.underMaintenance}</DataTableCell>
                      <DataTableCell>{f.occupiedRooms}</DataTableCell>
                      <DataTableCell>{f.readinessPercent}%</DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardContent flush>
              {data.attention.length === 0 ? (
                <EmptyState kind="empty" title="Nothing needs attention right now." />
              ) : (
                <DataTable data-testid="hk-ov-attention">
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>What</DataTableHeaderCell>
                      <DataTableHeaderCell>Room</DataTableHeaderCell>
                      <DataTableHeaderCell>Detail</DataTableHeaderCell>
                      <DataTableHeaderCell>Guest</DataTableHeaderCell>
                      <DataTableHeaderCell>Open</DataTableHeaderCell>
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {data.attention.map((row, i) => {
                      const link = attentionLink(row);
                      return (
                        <DataTableRow key={`${row.kind}-${row.roomId}-${i}`}>
                          <DataTableCell>
                            <Badge rung={kindRung(row.kind)}>{ATTENTION_KIND_LABEL[row.kind] ?? row.kind}</Badge>
                          </DataTableCell>
                          <DataTableCell>{row.roomCode}</DataTableCell>
                          <DataTableCell>{attentionSubject(row, date)}</DataTableCell>
                          <DataTableCell>{guestCell(row.guestRef)}</DataTableCell>
                          <DataTableCell>
                            <Link className="ui-link-btn ui-link-btn--sm" to={link.to}>
                              {link.label}
                            </Link>
                          </DataTableCell>
                        </DataTableRow>
                      );
                    })}
                  </DataTableBody>
                </DataTable>
              )}
              {data.attentionTruncated ? (
                <Alert intent="attention">Only the first 100 items are shown.</Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Arrivals today</CardTitle>
            </CardHeader>
            <CardContent flush>
              {data.arrivals.length === 0 ? (
                <EmptyState kind="empty" title="No arrivals expected today." />
              ) : (
                <DataTable data-testid="hk-ov-arrivals">
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Guest</DataTableHeaderCell>
                      <DataTableHeaderCell>Room</DataTableHeaderCell>
                      <DataTableHeaderCell>Room status</DataTableHeaderCell>
                      <DataTableHeaderCell>Ready</DataTableHeaderCell>
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {data.arrivals.map((a) => (
                      <DataTableRow key={a.reservationId}>
                        <DataTableCell>{guestCell(a.guestRef)}</DataTableCell>
                        <DataTableCell>{a.roomCode ?? 'Unassigned'}</DataTableCell>
                        <DataTableCell>
                          {a.roomStatus ? (
                            <>
                              <RoomStatus status={a.roomStatus} /> · {roomConditionLabel(a.condition)}
                            </>
                          ) : (
                            '—'
                          )}
                        </DataTableCell>
                        <DataTableCell>{a.ready === null ? '—' : a.ready ? 'Ready' : 'Not ready'}</DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              )}
              {data.arrivalsTruncated ? <Alert intent="attention">Only the first 200 arrivals are shown.</Alert> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Departures today</CardTitle>
            </CardHeader>
            <CardContent flush>
              {data.departures.length === 0 ? (
                <EmptyState kind="empty" title="No departures expected today." />
              ) : (
                <DataTable data-testid="hk-ov-departures">
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Guest</DataTableHeaderCell>
                      <DataTableHeaderCell>Room</DataTableHeaderCell>
                      <DataTableHeaderCell>Room status</DataTableHeaderCell>
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {data.departures.map((d) => (
                      <DataTableRow key={d.reservationId}>
                        <DataTableCell>{guestCell(d.guestRef)}</DataTableCell>
                        <DataTableCell>{d.roomCode}</DataTableCell>
                        <DataTableCell>
                          <RoomStatus status={d.roomStatus} /> · {roomConditionLabel(d.condition)}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              )}
              {data.departuresTruncated ? <Alert intent="attention">Only the first 200 departures are shown.</Alert> : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Find a room</CardTitle>
        </CardHeader>
        <Toolbar>
          <Field
            size="sm"
            label="Room number"
            control={
              <Input
                aria-label="Find a room"
                placeholder="Start of a room number"
                value={typed}
                maxLength={HK_DASHBOARD_ROOM_SEARCH_LEN_MAX}
                onChange={(e) => setTyped(e.target.value)}
                data-testid="hk-ov-search"
              />
            }
          />
        </Toolbar>
        <CardContent>
          {!search ? <p>Type the start of a room number to see who is in it and what is next.</p> : null}
          {search && data?.roomSearch?.query === search && data.roomSearch.rooms.length === 0 ? (
            <EmptyState kind="nomatch" title="No room starts with that." />
          ) : null}
          {search && data?.roomSearch?.query === search && data.roomSearch.rooms.length > 0 ? (
            <div data-testid="hk-ov-search-results">
              {data.roomSearch.rooms.map((room) => (
                <SearchRoomCard key={room.roomId} room={room} guestCell={guestCell} date={date} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SearchRoomCard({
  room,
  guestCell,
  date,
}: {
  room: HousekeepingDashboardSearchRoom;
  guestCell: (ref: string | null | undefined) => ReactNode;
  date: (iso: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Room {room.code}
          {room.floor ? ` · floor ${room.floor}` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          <RoomStatus status={room.housekeepingStatus} /> · {roomConditionLabel(room.condition)}
        </p>
        <p>
          In the room: {room.inHouse ? <>{guestCell(room.inHouse.guestRef)}, leaving {date(room.inHouse.departureDate)}</> : 'nobody'}
        </p>
        <p>
          Next arrival:{' '}
          {room.nextArrival ? <>{guestCell(room.nextArrival.guestRef)}, {date(room.nextArrival.arrivalDate)}</> : 'none booked'}
        </p>
        <p>
          Open tasks: {room.openTasks} · Open requests: {room.openRequests}
        </p>
      </CardContent>
    </Card>
  );
}
