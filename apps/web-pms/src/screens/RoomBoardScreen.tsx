import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  addCalendarDays,
  ClassifiedError,
  type GuestRowState,
} from '@hospai/client-core';
import type { RoomBoardResponse, RoomBoardRoom } from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
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
  NativeSelect,
  PageHeader,
  RoomStatus,
  Skeleton,
  Toolbar,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { roomBoardKey } from '../front-office-query-keys.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { bookHref } from '../status/book-href.js';
import { ROOM_CONDITION_ORDER, roomConditionWord } from '../status/room-condition.js';
import { BoardSummary } from './board-summary.js';
import { GuestNameLink } from './guest-row.js';

type GroupBy = 'condition' | 'type';

function errorCopy(err: unknown, fallback: string): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback })
    : fallback;
}

const CONDITION_CLASS: Record<string, string> = {
  available: 'room-cond room-cond--available',
  reserved: 'room-cond room-cond--reserved',
  occupied: 'room-cond room-cond--occupied',
  dirty: 'room-cond room-cond--dirty',
  maintenance: 'room-cond room-cond--maintenance',
  billed: 'room-cond room-cond--billed',
  unavailable: 'room-cond room-cond--unavailable',
};

function Condition({ condition }: { condition: string }) {
  return (
    <span className={CONDITION_CLASS[condition] ?? 'room-cond'}>{roomConditionWord(condition)}</span>
  );
}

type Can = (permission: Parameters<typeof hasPropertyPermission>[1]) => boolean;

function RoomActions({
  room,
  businessDate,
  can,
}: {
  room: RoomBoardRoom;
  businessDate: string;
  can: Can;
}) {
  const links: ReactNode[] = [];
  if (room.condition === 'available' && can('reservations:write')) {
    links.push(
      <Link
        key="book"
        className="ui-link-btn ui-link-btn--sm"
        to={bookHref({
          arrival: businessDate,
          departure: addCalendarDays(businessDate, 1),
          roomTypeId: room.roomTypeId,
          roomId: room.roomId,
        })}
      >
        Book
      </Link>,
    );
  }
  if (room.condition === 'reserved' && room.arrival && can('reservations:write')) {
    links.push(
      <Link
        key="check-in"
        className="ui-link-btn ui-link-btn--sm"
        to={`/check-in/${encodeURIComponent(room.arrival.reservationId)}`}
      >
        Check in
      </Link>,
    );
  }
  if ((room.condition === 'occupied' || room.condition === 'billed') && room.inHouse && can('folio:read')) {
    links.push(
      <Link
        key="folio"
        className="ui-link-btn ui-link-btn--sm"
        to={`/folio/${encodeURIComponent(room.inHouse.reservationId)}`}
      >
        Folio
      </Link>,
    );
  }
  if (room.condition === 'maintenance' && can('maintenance:read')) {
    links.push(
      <Link key="release" className="ui-link-btn ui-link-btn--sm" to="/maintenance">
        Release
      </Link>,
    );
  }
  if (links.length === 0) return null;
  return <div className="live-room__actions">{links}</div>;
}

function RoomTile({
  room,
  states,
  showType,
  businessDate,
  can,
}: {
  room: RoomBoardRoom;
  states: Record<string, GuestRowState>;
  showType: boolean;
  businessDate: string;
  can: Can;
}) {
  const { date } = useFormat();
  const stay = room.inHouse;
  const arrival = room.arrival;
  return (
    <li className="live-room" data-testid="live-room" data-room-code={room.code}>
      <div className="live-room__head">
        <span className="live-room__code">Room {room.code}</span>
        <div className="live-room__badges">
          <Condition condition={room.condition} />
          <RoomStatus status={room.housekeepingStatus} />
        </div>
      </div>
      {showType ? <p className="live-room__line muted">{room.roomTypeName}</p> : null}
      {stay ? (
        <>
          <p className="live-room__line">
            <GuestNameLink state={states[stay.guestRef]} guestRef={stay.guestRef} />
            {stay.vip ? ' · VIP' : ''}
          </p>
          <p className="live-room__line muted">
            Departs <span className="ui-num">{date(stay.departureDate)}</span>
            {stay.dueOutToday ? <> <Badge rung="attention">Due out today</Badge></> : null}
          </p>
        </>
      ) : null}
      {!stay && arrival ? (
        <>
          <p className="live-room__line">
            <GuestNameLink state={states[arrival.guestRef]} guestRef={arrival.guestRef} />
          </p>
          <p className="live-room__line muted">
            Arrives <span className="ui-num">{date(businessDate)}</span>
          </p>
        </>
      ) : null}
      {room.condition === 'maintenance' ? (
        <p className="live-room__line muted">
          {room.ooo
            ? `${room.ooo.reason ? `${room.ooo.reason} · ` : ''}Until ${date(room.ooo.endDate)}`
            : 'Out of order'}
        </p>
      ) : null}
      <RoomActions room={room} businessDate={businessDate} can={can} />
    </li>
  );
}

type Group = { key: string; title: string; rooms: RoomBoardRoom[] };

function buildGroups(rooms: RoomBoardRoom[], groupBy: GroupBy): Group[] {
  if (groupBy === 'condition') {
    return ROOM_CONDITION_ORDER.map((c) => ({
      key: c,
      title: roomConditionWord(c),
      rooms: rooms.filter((r) => r.condition === c),
    })).filter((g) => g.rooms.length > 0);
  }
  const byType = new Map<string, Group>();
  for (const r of rooms) {
    const g = byType.get(r.roomTypeId) ?? { key: r.roomTypeId, title: r.roomTypeName, rooms: [] };
    g.rooms.push(r);
    byType.set(r.roomTypeId, g);
  }
  return [...byType.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Live room view (roadmap R4.27): every room for today, grouped by condition or room type.
 * One property-scoped read (`get_room_board`); condition is decided on the server. Capacity and
 * occupancy numbers come from `BoardSummary` (`get_front_desk_summary`), never from this list.
 * This is not a date grid: the tape at /board owns dates.
 */
export function RoomBoardScreen() {
  const { subtitle } = usePropertySubtitle('Rooms today');
  const { date } = useFormat();
  const propertyId = tenant.propertyId;
  const [roomTypeId, setRoomTypeId] = useState('');
  const [condition, setCondition] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('condition');

  const boardQ = useQuery({
    queryKey: roomBoardKey(propertyId),
    queryFn: () => api.getRoomBoard(propertyId),
    staleTime: 60_000,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const board: RoomBoardResponse | undefined = boardQ.data;

  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const me = meQ.data as PropertyMe | undefined;
  const can: Can = (permission) => Boolean(me && hasPropertyPermission(me, permission));

  const refs = useMemo(() => {
    const set = new Set<string>();
    for (const r of board?.rooms ?? []) {
      if (r.inHouse) set.add(r.inHouse.guestRef);
      else if (r.arrival) set.add(r.arrival.guestRef);
    }
    for (const a of board?.unassignedArrivals ?? []) set.add(a.guestRef);
    return [...set];
  }, [board]);
  const batchQ = useQuery({
    queryKey: ['guests-batch', propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, propertyId, refs),
    enabled: refs.length > 0,
    retry: false,
  });
  const states = batchQ.data?.states ?? {};

  const rooms = board?.rooms ?? [];
  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rooms) seen.set(r.roomTypeId, r.roomTypeName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rooms]);
  const conditionOptions = ROOM_CONDITION_ORDER.filter((c) => rooms.some((r) => r.condition === c));

  const filtered = rooms.filter(
    (r) => (!roomTypeId || r.roomTypeId === roomTypeId) && (!condition || r.condition === condition),
  );
  const groups = buildGroups(filtered, groupBy);

  let body: ReactNode;
  if (boardQ.isError) {
    body = (
      <Alert data-testid="room-board-error">
        {errorCopy(boardQ.error, 'Could not load the live room view.')}
      </Alert>
    );
  } else if (!board) {
    body = <Skeleton />;
  } else if (rooms.length === 0) {
    body = <EmptyState data-testid="room-board-empty" title="No rooms yet" />;
  } else if (filtered.length === 0) {
    body = (
      <div data-testid="room-board-no-match">
        <p className="muted">No room matches these filters.</p>
        <Button
          type="button"
          onClick={() => {
            setRoomTypeId('');
            setCondition('');
          }}
        >
          Clear filters
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        {groups.map((g) => (
          <section key={g.key} className="live-rooms__group" data-testid={`live-group-${g.key}`}>
            <h3 className="live-rooms__group-title">
              {g.title} <span className="muted">· {g.rooms.length}</span>
            </h3>
            <ul className="live-rooms__grid">
              {g.rooms.map((r) => (
                <RoomTile
                  key={r.roomId}
                  room={r}
                  states={states}
                  showType={groupBy === 'condition'}
                  businessDate={board.businessDate}
                  can={can}
                />
              ))}
            </ul>
          </section>
        ))}
      </>
    );
  }

  const unassigned = board?.unassignedArrivals ?? [];

  return (
    <div className="board-page">
      <PageHeader title="Live rooms" subtitle={subtitle} />
      <BoardSummary date={board?.businessDate ?? null} />
      <Card>
        <Toolbar>
          <Field
            label="Room type"
            control={
              <NativeSelect
                data-testid="live-filter-type"
                value={roomTypeId}
                onChange={(e) => setRoomTypeId(e.target.value)}
              >
                <option value="">All room types</option>
                {typeOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Condition"
            control={
              <NativeSelect
                data-testid="live-filter-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                <option value="">All conditions</option>
                {conditionOptions.map((c) => (
                  <option key={c} value={c}>
                    {roomConditionWord(c)}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Group by"
            control={
              <NativeSelect
                data-testid="live-group-by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value === 'type' ? 'type' : 'condition')}
              >
                <option value="condition">Condition</option>
                <option value="type">Room type</option>
              </NativeSelect>
            }
          />
        </Toolbar>
        <CardHeader>
          <CardTitle>{board ? `Rooms on ${date(board.businessDate)}` : 'Rooms today'}</CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
      {unassigned.length > 0 ? (
        <Card data-testid="live-unassigned">
          <CardHeader>
            <CardTitle>Arrivals without a room</CardTitle>
          </CardHeader>
          <CardContent flush>
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Guest</DataTableHeaderCell>
                  <DataTableHeaderCell>Room type</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {unassigned.map((a) => (
                  <DataTableRow key={a.reservationId}>
                    <DataTableCell>
                      <GuestNameLink state={states[a.guestRef]} guestRef={a.guestRef} />
                    </DataTableCell>
                    <DataTableCell>{a.roomTypeName}</DataTableCell>
                    <DataTableCell align="right">
                      {can('reservations:write') && board ? (
                        <Link
                          className="ui-link-btn ui-link-btn--sm"
                          to={`/arrivals?date=${encodeURIComponent(board.businessDate)}`}
                        >
                          Assign
                        </Link>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
