import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCalendarDays,
  type FrontDeskItem,
  type GuestRowState,
} from '@hospai/client-core';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '@hospai/contracts/reservation-status';
import {
  Alert,
  Badge,
  Button,
  isReservationStatus,
  StatusBadge,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Skeleton,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Input,
  VisuallyHidden,
  PageHeader,
  RowActions,
} from '@hospai/ui-kit';
import type { BoardMode } from '../status/board-mode.js';

import { boardPageTitle } from '../status/board-page-title.js';
import { guestSeverity } from '../status/guest-severity.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { GuestNameLink, guestLabel } from './guest-row.js';
import { BoardSummary } from './board-summary.js';
import { AssignRoomDialog, MoveRoomDialog, PostChargeDialog } from './board-dialogs.js';
import { bookHref } from '../status/book-href.js';

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

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
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
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
      Confirm
    </Button>
  );
}

type RowAction = (row: FrontDeskItem) => void;

function BoardTable({
  mode,
  items,
  states,
  timeZone,
  roomsById,
  onAssign,
  onMove,
  onPostCharge,
}: {
  mode: BoardMode;
  items: FrontDeskItem[];
  states: Record<string, GuestRowState>;
  timeZone: string | null;
  roomsById: Map<string, string>;
  onAssign?: RowAction;
  onMove?: RowAction;
  onPostCharge?: RowAction;
}) {
  const { date } = useFormat();
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const showDeparture = mode === 'in-house';

  return (
    <DataTable>
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>Guest</DataTableHeaderCell>
          <DataTableHeaderCell>Room</DataTableHeaderCell>
          <DataTableHeaderCell align="right">
            {showDeparture ? 'Departure' : 'Nights'}
          </DataTableHeaderCell>
          <DataTableHeaderCell>Status</DataTableHeaderCell>
          <DataTableHeaderCell align="right">
            <VisuallyHidden>Actions</VisuallyHidden>
          </DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {items.map((row) => {
          const status = asReservationStatus(row.status);
          const overstay =
            mode === 'in-house' &&
            today != null &&
            typeof row.departureDate === 'string' &&
            row.departureDate < today;
          const guestState = states[row.guestRef] ?? { kind: 'name_pending' as const };
          const guestSev = guestSeverity(guestState);
          const roomCode = row.roomId ? (roomsById.get(row.roomId) ?? '') : '';
          const nights =
            typeof row.arrivalDate === 'string'
              ? nightsBetween(row.arrivalDate, row.departureDate)
              : null;
          return (
            <DataTableRow key={row.reservationId}>
              <DataTableCell rung={guestSev}>
                <GuestNameLink state={guestState} guestRef={row.guestRef} />
                {overstay ? ' (overstay)' : ''}
                {row.dndFlag === true ? (
                  <span data-testid="badge-dnd"> DND</span>
                ) : null}
              </DataTableCell>
              <DataTableCell>
                {roomCode || (mode === 'arrivals' ? <span className="muted">Unassigned</span> : '')}
              </DataTableCell>
              <DataTableCell align="right">
                <span className="ui-num">
                  {showDeparture
                    ? date(row.departureDate)
                    : nights != null
                      ? nights
                      : '—'}
                </span>
              </DataTableCell>
              <DataTableCell>
                {status && isReservationStatus(status) ? (
                  <StatusBadge status={status} vip={row.vipFlag === true} />
                ) : (
                  row.status
                )}
              </DataTableCell>
              <DataTableCell align="right">
                {mode === 'arrivals' && status === 'pending' ? (
                  <RowActions>
                    <ConfirmPendingButton reservationId={row.reservationId} />
                    {onAssign && row.roomId == null ? (
                      <Button type="button" size="sm" onClick={() => onAssign(row)}>
                        Assign room
                      </Button>
                    ) : null}
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/folio/${encodeURIComponent(row.reservationId)}`}
                    >
                      Folio
                    </Link>
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}
                    >
                      Book for guest
                    </Link>
                  </RowActions>
                ) : mode === 'arrivals' ? (
                  <RowActions>
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/check-in/${encodeURIComponent(row.reservationId)}`}
                    >
                      Check in
                    </Link>
                    {onAssign && row.roomId == null ? (
                      <Button type="button" size="sm" onClick={() => onAssign(row)}>
                        Assign room
                      </Button>
                    ) : null}
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/folio/${encodeURIComponent(row.reservationId)}`}
                    >
                      Folio
                    </Link>
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}
                    >
                      Book for guest
                    </Link>
                  </RowActions>
                ) : (
                  <RowActions>
                    {mode === 'in-house' && onMove && status === 'checked_in' && row.roomId ? (
                      <Button type="button" size="sm" onClick={() => onMove(row)}>
                        Move room
                      </Button>
                    ) : null}
                    {onPostCharge && status === 'checked_in' ? (
                      <Button type="button" size="sm" onClick={() => onPostCharge(row)}>
                        Post charge
                      </Button>
                    ) : null}
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/folio/${encodeURIComponent(row.reservationId)}`}
                    >
                      Folio
                    </Link>
                    <Link
                      className="ui-link-btn ui-link-btn--sm"
                      to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}
                    >
                      Book for guest
                    </Link>
                  </RowActions>
                )}
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}

function DeparturesBoard({
  items,
  states,
  timeZone,
  roomsById,
  onPostCharge,
}: {
  items: FrontDeskItem[];
  states: Record<string, GuestRowState>;
  timeZone: string | null;
  roomsById: Map<string, string>;
  onPostCharge?: RowAction;
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
        <section key={section.title} className="board-group board-group--flush">
          <h2 className="board-group-title">{section.title}</h2>
          {section.rows.length === 0 ? (
            <EmptyState title="None" />
          ) : (
            <BoardTable
              mode="departures"
              items={section.rows}
              states={states}
              timeZone={timeZone}
              roomsById={roomsById}
              onPostCharge={onPostCharge}
            />
          )}
        </section>
      ))}
    </>
  );
}

function SectionCard({
  title,
  badge,
  isLoading,
  error,
  empty,
  next,
  onNext,
  children,
}: {
  title: string;
  badge?: ReactNode;
  isLoading?: boolean;
  error?: string | null;
  empty?: string | null;
  next?: string | null;
  onNext?: () => void;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {badge}
      </CardHeader>
      {error ? (
        <CardContent>
          <Alert>{error}</Alert>
        </CardContent>
      ) : isLoading ? (
        <CardContent>
          <Skeleton label="Loading section" lines={3} />
        </CardContent>
      ) : empty ? (
        <CardContent>
          <EmptyState title={empty} />
        </CardContent>
      ) : (
        <>
          <CardContent flush>{children}</CardContent>
          {next ? (
            <CardFooter>
              <Button type="button" onClick={onNext}>
                Next page
              </Button>
            </CardFooter>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function BoardScreen({ mode }: { mode: BoardMode }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dateParam = dateFromSearchParam(params.get('date'));
  const [date, setDate] = useState<string | null>(() => dateParam);
  const seededRef = useRef(Boolean(dateParam));
  const [cursor, setCursor] = useState<string | null>(null);
  const timeZone = usePropertyTimeZone();
  const { dateHeading } = useFormat();
  const [createdBanner, setCreatedBanner] = useState<string | null>(null);
  const vipOnly = params.get('vip') === '1';
  const [assignFor, setAssignFor] = useState<FrontDeskItem | null>(null);
  const [moveFor, setMoveFor] = useState<FrontDeskItem | null>(null);
  const [chargeFor, setChargeFor] = useState<FrontDeskItem | null>(null);
  const [boardMessage, setBoardMessageText] = useState<string | null>(null);
  const [boardIntent, setBoardIntent] = useState<'settled' | 'attention'>('settled');
  function setBoardMessage(text: string, intent: 'settled' | 'attention' = 'settled') {
    setBoardIntent(intent);
    setBoardMessageText(text);
  }

  function setVipOnly(next: boolean) {
    const sp = new URLSearchParams(params);
    if (next) sp.set('vip', '1');
    else sp.delete('vip');
    const qs = sp.toString();
    void navigate({ search: qs ? `?${qs}` : '' }, { replace: true });
  }

  useEffect(() => {
    if (seededRef.current) return;
    if (dateParam) {
      seededRef.current = true;
      setDate(dateParam);
      return;
    }
    if (!timeZone) return;
    const seeded = propertyLocalToday(timeZone);
    seededRef.current = true;
    setDate(seeded);
    void navigate({ search: `?date=${seeded}` }, { replace: true });
  }, [dateParam, timeZone, navigate]);

  useEffect(() => {
    const state = location.state as { createdReservationId?: string } | null;
    const id = state?.createdReservationId;
    if (!id) return;
    setCreatedBanner(id);
    void navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);

  const listQ = useQuery({
    queryKey: ['board', mode, tenant.propertyId, date, cursor],
    queryFn: async () => {
      if (mode === 'arrivals') return api.getArrivals(tenant.propertyId, date!, cursor);
      if (mode === 'departures') return api.getDepartures(tenant.propertyId, date!, cursor);
      return api.getInHouse(tenant.propertyId, cursor);
    },
    enabled: mode === 'in-house' || date != null,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const [depCursor, setDepCursor] = useState<string | null>(null);
  const [inHouseCursor, setInHouseCursor] = useState<string | null>(null);

  const departuresQ = useQuery({
    queryKey: ['board', 'departures', tenant.propertyId, date, depCursor],
    queryFn: () => api.getDepartures(tenant.propertyId, date!, depCursor),
    enabled: mode === 'arrivals' && date != null,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const inHouseQ = useQuery({
    queryKey: ['board', 'in-house', tenant.propertyId, null, inHouseCursor],
    queryFn: () => api.getInHouse(tenant.propertyId, inHouseCursor),
    enabled: mode === 'arrivals',
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const roomsQ = useQuery({
    queryKey: ['rooms', tenant.propertyId],
    queryFn: () => api.listRooms(tenant.propertyId),
    retry: false,
  });
  const roomsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roomsQ.data?.rooms ?? []) map.set(r.roomId, r.code);
    return map;
  }, [roomsQ.data]);

  const refs = useMemo(() => {
    const all = [
      ...(listQ.data?.items ?? []),
      ...(departuresQ.data?.items ?? []),
      ...(inHouseQ.data?.items ?? []),
    ];
    return [...new Set(all.map((i) => i.guestRef))];
  }, [listQ.data, departuresQ.data, inHouseQ.data]);

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, tenant.propertyId, refs),
    enabled:
      refs.length > 0 && (listQ.isSuccess || departuresQ.isSuccess || inHouseQ.isSuccess),
    retry: false,
  });

  if (listQ.isError && asClassified(listQ.error).class === 'unauthorized') {
    window.location.assign('/sign-in');
    return null;
  }
  const listLoadError = listQ.isError ? asClassified(listQ.error) : null;

  const vipFilter = (rows: FrontDeskItem[]) =>
    vipOnly ? rows.filter((row) => row.vipFlag === true) : rows;
  const items = vipFilter(listQ.data?.items ?? []);
  const states = batchQ.data?.states ?? {};
  const nameOf = (row: FrontDeskItem) => guestLabel(states[row.guestRef], row.guestRef);

  const dateLoading = (mode === 'arrivals' || mode === 'departures') && date == null;

  let body: ReactNode;
  if (listLoadError) {
    body = (
      <Alert>
        {classifiedUserMessage(listLoadError, { fallback: 'Failed to load board.' })}
      </Alert>
    );
  } else if (dateLoading) {
    body = <Skeleton label="Loading board" lines={5} />;
  } else if (listQ.isLoading) {
    body = <Skeleton label="Loading board" lines={5} />;
  } else if (mode === 'arrivals') {
    const depItems = vipFilter(departuresQ.data?.items ?? []);
    const inHouseItems = vipFilter(inHouseQ.data?.items ?? []);
    const dueOutCount = partitionDepartures(depItems).dueOut.length;
    body = (
      <>
        <SectionCard
          title="Arrivals"
          badge={<Badge rung="neutral">{items.length} expected</Badge>}
          isLoading={listQ.isLoading}
          error={listQ.isError ? 'Arrivals unavailable' : null}
          empty={
            items.length === 0
              ? vipOnly
                ? 'No VIP arrivals for this date'
                : 'No arrivals for this date'
              : null
          }
          next={listQ.data?.nextCursor}
          onNext={() => setCursor(listQ.data!.nextCursor!)}
        >
          <BoardTable
            mode="arrivals"
            items={items}
            states={states}
            timeZone={timeZone}
            roomsById={roomsById}
            onAssign={setAssignFor}
          />
        </SectionCard>
        <SectionCard
          title="Departures"
          badge={<Badge rung="attention">{dueOutCount} due out</Badge>}
          isLoading={departuresQ.isLoading}
          error={departuresQ.isError ? 'Departures unavailable' : null}
          empty={
            depItems.length === 0
              ? vipOnly
                ? 'No VIP departures for this date'
                : 'No departures for this date'
              : null
          }
          next={departuresQ.data?.nextCursor}
          onNext={() => setDepCursor(departuresQ.data!.nextCursor!)}
        >
          <DeparturesBoard
            items={depItems}
            states={states}
            timeZone={timeZone}
            roomsById={roomsById}
            onPostCharge={setChargeFor}
          />
        </SectionCard>
        <SectionCard
          title="In House"
          badge={<Badge rung="informational">{inHouseItems.length} guests</Badge>}
          isLoading={inHouseQ.isLoading}
          error={inHouseQ.isError ? 'In-house unavailable' : null}
          empty={
            inHouseItems.length === 0
              ? vipOnly
                ? 'No VIP guests in house'
                : 'No guests in house'
              : null
          }
          next={inHouseQ.data?.nextCursor}
          onNext={() => setInHouseCursor(inHouseQ.data!.nextCursor!)}
        >
          <BoardTable
            mode="in-house"
            items={inHouseItems}
            states={states}
            timeZone={timeZone}
            roomsById={roomsById}
            onPostCharge={setChargeFor}
          />
        </SectionCard>
      </>
    );
  } else if (items.length === 0) {
    body = (
      <SectionCard
        title={mode === 'departures' ? 'Departures' : 'In House'}
        badge={
          mode === 'departures' ? (
            <Badge rung="attention">0 due out</Badge>
          ) : (
            <Badge rung="informational">0 guests</Badge>
          )
        }
        empty={vipOnly ? 'No VIP guests for this view' : 'No reservations for this view'}
      />
    );
  } else if (mode === 'departures') {
    const dueOutCount = partitionDepartures(items).dueOut.length;
    body = (
      <SectionCard
        title="Departures"
        badge={<Badge rung="attention">{dueOutCount} due out</Badge>}
        next={listQ.data?.nextCursor}
        onNext={() => setCursor(listQ.data!.nextCursor!)}
      >
        <DeparturesBoard
          items={items}
          states={states}
          timeZone={timeZone}
          roomsById={roomsById}
          onPostCharge={setChargeFor}
        />
      </SectionCard>
    );
  } else {
    body = (
      <SectionCard
        title="In House"
        badge={<Badge rung="informational">{items.length} guests</Badge>}
        next={listQ.data?.nextCursor}
        onNext={() => setCursor(listQ.data!.nextCursor!)}
      >
        <BoardTable
          mode="in-house"
          items={items}
          states={states}
          timeZone={timeZone}
          roomsById={roomsById}
          onMove={setMoveFor}
          onPostCharge={setChargeFor}
        />
      </SectionCard>
    );
  }

  const summaryDate = date ?? (timeZone ? propertyLocalToday(timeZone) : null);
  const headerDate = summaryDate;
  const localToday = timeZone ? propertyLocalToday(timeZone) : null;

  return (
    <div className="board-page">
      {createdBanner ? (
        <Card role="status" data-testid="created-banner">
          Reservation {createdBanner} created
        </Card>
      ) : null}

      <PageHeader
        title={boardPageTitle(mode)}
        lead={<BoardSummary layout="strip" date={summaryDate} />}
        subtitle={
          headerDate
            ? `${dateHeading(headerDate)} · ${boardPageTitle(mode).toLowerCase()} for the business date`
            : undefined
        }
        actions={
          <>
            {mode !== 'in-house' ? (
              <Field
                size="xs"
                label={<VisuallyHidden>Business date</VisuallyHidden>}
                control={
                  <Input
                    type="date"
                    data-testid="board-date"
                    aria-label="Business date"
                    value={date ?? ''}
                    onChange={(e) => {
                      setCursor(null);
                      setDepCursor(null);
                      setDate(e.target.value);
                    }}
                  />
                }
              />
            ) : null}
            <Field
              label="VIP only"
              control={
                <Checkbox checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />
              }
            />
            {localToday ? (
              <Link
                className="ui-link-btn"
                to={bookHref({ arrival: localToday, departure: addCalendarDays(localToday, 1) })}
              >
                Walk-in
              </Link>
            ) : null}
            <Link className="ui-link-btn ui-link-btn--primary" to="/book">
              New booking
            </Link>
          </>
        }
      />
      {boardMessage ? (
        <Alert intent={boardIntent} data-testid="board-message">
          {boardMessage}
        </Alert>
      ) : null}
      {body}
      {assignFor ? (
        <AssignRoomDialog
          row={assignFor}
          guestName={nameOf(assignFor)}
          onClose={() => setAssignFor(null)}
          onDone={(message, intent) => {
            setAssignFor(null);
            setBoardMessage(message, intent);
          }}
        />
      ) : null}
      {moveFor ? (
        <MoveRoomDialog
          row={moveFor}
          guestName={nameOf(moveFor)}
          onClose={() => setMoveFor(null)}
          onDone={(message, intent) => {
            setMoveFor(null);
            setBoardMessage(message, intent);
          }}
        />
      ) : null}
      {chargeFor ? (
        <PostChargeDialog
          row={chargeFor}
          guestName={nameOf(chargeFor)}
          onClose={() => setChargeFor(null)}
          onDone={(message, intent) => {
            setChargeFor(null);
            setBoardMessage(message, intent);
          }}
        />
      ) : null}
    </div>
  );
}
