import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  addCalendarDays,
  ClassifiedError,
  shouldRetry,
  retryDelay,
  type FrontDeskItem,
  type GuestRowState,
} from '@hospai/client-core';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '@hospai/contracts/reservation-status';
import { api, asClassified, tenant } from '../client.js';
import { boardRowSeverity } from '../status/board-row-severity.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { statusClass } from '../status/status-class.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { guestLabel } from './guest-row.js';

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

function inclusiveDates(fromDate: string, toDate: string): string[] {
  if (toDate < fromDate) return [];
  const out: string[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    out.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function formatTapeHeader(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`));
}

function spanStyle(
  startDate: string,
  endExclusive: string,
  fromDate: string,
  toDate: string,
  dates: string[],
): CSSProperties | null {
  const start = startDate < fromDate ? fromDate : startDate;
  const lastNight = addCalendarDays(endExclusive, -1);
  const endNight = lastNight > toDate ? toDate : lastNight;
  if (endNight < fromDate || start > toDate) return null;
  const startIdx = dates.indexOf(start);
  const endNightIdx = dates.indexOf(endNight);
  if (startIdx < 0 || endNightIdx < 0) return null;
  return { gridColumn: `${startIdx + 2} / ${endNightIdx + 3}`, gridRow: 1 };
}

function tapeBlockSeverity(status: ReservationStatus, overstay: boolean) {
  if (status === 'checked_in') {
    return boardRowSeverity({ mode: 'in-house', status, overstay });
  }
  return boardRowSeverity({ mode: 'arrivals', status, overstay: false });
}

type RoomTypeLabel = { roomTypeId: string; name?: string; code?: string };

function typeLabel(id: string, types: RoomTypeLabel[]): string {
  const hit = types.find((t) => t.roomTypeId === id);
  return hit?.name || hit?.code || id;
}

function StayBlock({
  block,
  state,
  style,
  today,
}: {
  block: FrontDeskItem;
  state: GuestRowState | undefined;
  style: CSSProperties;
  today: string | null;
}) {
  const status = asReservationStatus(block.status);
  const overstay =
    today != null &&
    status === 'checked_in' &&
    typeof block.departureDate === 'string' &&
    block.departureDate < today;
  const sev = status ? tapeBlockSeverity(status, overstay) : 'informational';
  return (
    <Link
      to={`/folio/${encodeURIComponent(block.reservationId)}`}
      className={`tape-block min-w-0 truncate ${statusClass(sev)}`}
      style={style}
    >
      <span className="truncate">{guestLabel(state, block.guestRef)}</span>
      {block.vipFlag === true ? <span data-testid="badge-vip"> VIP</span> : null}
      {block.dndFlag === true ? <span data-testid="badge-dnd"> DND</span> : null}
    </Link>
  );
}

export function TapeChartScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fromParam = dateFromSearchParam(params.get('from'));
  const toParam = dateFromSearchParam(params.get('to'));
  const [from, setFrom] = useState<string | null>(() => fromParam);
  const [to, setTo] = useState<string | null>(() => toParam);
  const seededRef = useRef(Boolean(fromParam && toParam));
  const timeZone = usePropertyTimeZone();

  useEffect(() => {
    if (seededRef.current) return;
    if (fromParam && toParam) {
      seededRef.current = true;
      setFrom(fromParam);
      setTo(toParam);
      return;
    }
    if (!timeZone) return;
    const seededFrom = propertyLocalToday(timeZone);
    const seededTo = addCalendarDays(seededFrom, 6);
    seededRef.current = true;
    setFrom(seededFrom);
    setTo(seededTo);
    navigate({ search: `?from=${seededFrom}&to=${seededTo}` }, { replace: true });
  }, [fromParam, toParam, timeZone, navigate]);

  function writeWindow(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    navigate({ search: `?from=${nextFrom}&to=${nextTo}` }, { replace: true });
  }

  const tapeQ = useQuery({
    queryKey: ['front-desk-tape', tenant.propertyId, from, to],
    queryFn: () => api.getFrontOfficeTape(tenant.propertyId, { fromDate: from!, toDate: to! }),
    enabled: from != null && to != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  const typesQ = useQuery({
    queryKey: ['room-types', tenant.propertyId],
    queryFn: () => api.listRoomTypes(tenant.propertyId, { status: 'active' }),
    enabled: tapeQ.isSuccess,
    retry: false,
  });

  const refs = useMemo(
    () => [...new Set((tapeQ.data?.blocks ?? []).map((i) => i.guestRef))],
    [tapeQ.data],
  );

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => api.postGuestsBatch(tenant.propertyId, refs),
    enabled: refs.length > 0 && tapeQ.isSuccess,
    retry: false,
  });

  if (tapeQ.isError) {
    const c = asClassified(tapeQ.error);
    if (c.class === 'fail_closed' || tapeQ.error instanceof ClassifiedError) {
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

  const rooms = tapeQ.data?.rooms ?? [];
  const blocks = tapeQ.data?.blocks ?? [];
  const ooo = tapeQ.data?.ooo ?? [];
  const states = batchQ.data?.states ?? {};
  const typeRows = (typesQ.data?.roomTypes ?? []) as RoomTypeLabel[];
  const dates = from && to ? inclusiveDates(from, to) : [];
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const columns: CSSProperties = {
    gridTemplateColumns: `minmax(7rem, 9rem) repeat(${Math.max(dates.length, 1)}, minmax(4.5rem, 1fr))`,
  };

  const unassigned = blocks.filter((b) => b.roomId == null);
  const assignedByRoom = new Map<string, FrontDeskItem[]>();
  for (const b of blocks) {
    if (b.roomId == null) continue;
    const list = assignedByRoom.get(b.roomId) ?? [];
    list.push(b);
    assignedByRoom.set(b.roomId, list);
  }

  const groups: Array<{ typeId: string; rooms: typeof rooms }> = [];
  const seen = new Set<string>();
  for (const r of rooms) {
    if (seen.has(r.roomTypeId)) continue;
    seen.add(r.roomTypeId);
    groups.push({
      typeId: r.roomTypeId,
      rooms: rooms.filter((x) => x.roomTypeId === r.roomTypeId),
    });
  }

  let body: ReactNode;
  if (from == null || to == null || tapeQ.isLoading) {
    body = <p className="muted">Loading…</p>;
  } else if (rooms.length === 0) {
    body = <p className="muted">No rooms yet — create rooms in Inventory.</p>;
  } else {
    body = (
      <div className="tape-scroller">
        <div className="tape-row" style={columns}>
          <div className="tape-room" style={{ gridColumn: 1, gridRow: 1 }} />
          {dates.map((d, i) => (
            <div
              key={d}
              className="tape-header-cell tabular-nums"
              style={{ gridColumn: i + 2, gridRow: 1 }}
            >
              {formatTapeHeader(d, timeZone ?? 'UTC')}
            </div>
          ))}
        </div>
        {unassigned.length > 0 ? (
          <div data-testid="tape-unassigned" className="tape-row content-visibility-auto" style={columns}>
            <div className="tape-room" style={{ gridColumn: 1, gridRow: 1 }}>
              Unassigned
            </div>
            {dates.map((d, i) => (
              <div key={d} className="tape-cell min-w-0" style={{ gridColumn: i + 2, gridRow: 1 }} />
            ))}
            {unassigned.map((block) => {
              const style = spanStyle(block.arrivalDate ?? from, block.departureDate, from, to, dates);
              if (!style) return null;
              return (
                <StayBlock
                  key={block.reservationId}
                  block={block}
                  state={states[block.guestRef]}
                  style={style}
                  today={today}
                />
              );
            })}
          </div>
        ) : null}
        {groups.map((g) => (
          <section key={g.typeId}>
            <h2 className="tape-type">{typeLabel(g.typeId, typeRows)}</h2>
            {g.rooms.map((room) => (
              <div key={room.roomId} className="tape-row content-visibility-auto" style={columns}>
                <div className="tape-room min-w-0 truncate" style={{ gridColumn: 1, gridRow: 1 }}>
                  {room.code}{' '}
                  <span className="badge">{room.status}</span>
                </div>
                {dates.map((d, i) => (
                  <div
                    key={d}
                    className="tape-cell min-w-0"
                    style={{ gridColumn: i + 2, gridRow: 1 }}
                  />
                ))}
                {(assignedByRoom.get(room.roomId) ?? []).map((block) => {
                  const style = spanStyle(
                    block.arrivalDate ?? from,
                    block.departureDate,
                    from,
                    to,
                    dates,
                  );
                  if (!style) return null;
                  return (
                    <StayBlock
                      key={block.reservationId}
                      block={block}
                      state={states[block.guestRef]}
                      style={style}
                      today={today}
                    />
                  );
                })}
                {ooo
                  .filter((row) => row.roomId === room.roomId)
                  .map((row) => {
                    const style = spanStyle(row.startDate, row.endDate, from, to, dates);
                    if (!style) return null;
                    const label = row.reason?.trim() ? row.reason : 'Out of order';
                    return (
                      <div
                        key={row.oooId}
                        className={`tape-block min-w-0 truncate ${statusClass('attention')}`}
                        style={style}
                        aria-label={label}
                      >
                        {label}
                      </div>
                    );
                  })}
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div>
      <header className="board-header">
        <h1 className="board-title">Board</h1>
        <label>
          From{' '}
          <input
            type="date"
            data-testid="tape-from"
            autoComplete="off"
            value={from ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              if (to) writeWindow(next, to);
              else setFrom(next);
            }}
          />
        </label>
        <label>
          To{' '}
          <input
            type="date"
            data-testid="tape-to"
            autoComplete="off"
            value={to ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              if (from) writeWindow(from, next);
              else setTo(next);
            }}
          />
        </label>
      </header>
      <div className="visually-hidden" aria-live="polite" />
      <div className="panel">{body}</div>
    </div>
  );
}
