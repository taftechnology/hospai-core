import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCalendarDays,
  ClassifiedError,
  shouldRetry,
  retryDelay,
} from '@hospai/client-core';
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
  DateRange,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  RoomStatus,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { bookHref } from '../status/book-href.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { PlusIcon } from '../shell/icons.js';
import { BoardSummary } from './board-summary.js';
import { TapeLegend } from './tape/TapeLegend.js';
import { TapeGrid } from './tape/TapeGrid.js';

function dateFromSearchParam(raw: string | null): string | null {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
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

const MAX_TAPE_UI_DAYS = 14;

function inclusiveDayCount(from: string, to: string): number {
  if (to < from) return 0;
  let count = 0;
  let cur = from;
  while (cur <= to) {
    count++;
    cur = addCalendarDays(cur, 1);
  }
  return count;
}

function clampTapeWindow(from: string, to: string): { from: string; to: string; clamped: boolean } {
  if (inclusiveDayCount(from, to) <= MAX_TAPE_UI_DAYS) {
    return { from, to, clamped: false };
  }
  return {
    from: addCalendarDays(to, -(MAX_TAPE_UI_DAYS - 1)),
    to,
    clamped: true,
  };
}

type RoomTypeLabel = { roomTypeId: string; name?: string; code?: string };

function typeLabel(id: string, types: RoomTypeLabel[]): string {
  const hit = types.find((t) => t.roomTypeId === id);
  return hit?.name || hit?.code || 'Room type unavailable';
}

export function TapeChartScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fromParam = dateFromSearchParam(params.get('from'));
  const toParam = dateFromSearchParam(params.get('to'));
  const view = params.get('view') === 'available' ? 'available' : 'tape';
  const [from, setFrom] = useState<string | null>(() => fromParam);
  const [to, setTo] = useState<string | null>(() => toParam);
  const [tapeWindowHint, setTapeWindowHint] = useState<string | null>(null);
  const seededRef = useRef(false);
  const timeZone = usePropertyTimeZone();
  const { dateHeading, dateRange } = useFormat();

  useEffect(() => {
    if (fromParam && toParam) {
      if (!seededRef.current) {
        seededRef.current = true;
        const clamped = clampTapeWindow(fromParam, toParam);
        setFrom(clamped.from);
        setTo(clamped.to);
        setTapeWindowHint(clamped.clamped ? 'Room plan shows up to 14 days.' : null);
        if (clamped.clamped) {
          void navigate({ search: windowSearch(clamped.from, clamped.to, view) }, { replace: true });
        }
      }
      return;
    }
    if (!timeZone) return;
    if (seededRef.current) return;
    const seededFrom = propertyLocalToday(timeZone);
    const seededTo = addCalendarDays(seededFrom, 6);
    seededRef.current = true;
    setFrom(seededFrom);
    setTo(seededTo);
    void navigate({ search: windowSearch(seededFrom, seededTo, view) }, { replace: true });
  }, [fromParam, toParam, timeZone, navigate, view]);

  function windowSearch(nextFrom: string, nextTo: string, nextView: 'tape' | 'available'): string {
    const sp = new URLSearchParams();
    sp.set('from', nextFrom);
    sp.set('to', nextTo);
    if (nextView === 'available') sp.set('view', 'available');
    return `?${sp.toString()}`;
  }

  function writeWindow(nextFrom: string, nextTo: string) {
    const clamped = clampTapeWindow(nextFrom, nextTo);
    setFrom(clamped.from);
    setTo(clamped.to);
    setTapeWindowHint(clamped.clamped ? 'Room plan shows up to 14 days.' : null);
    void navigate({ search: windowSearch(clamped.from, clamped.to, view) }, { replace: true });
  }

  const stepDays = from && to ? inclusiveDayCount(from, to) : 7;

  const tapeQ = useQuery({
    queryKey: ['front-desk-tape', tenant.propertyId, from, to],
    queryFn: () => api.getFrontOfficeTape(tenant.propertyId, { fromDate: from!, toDate: to! }),
    enabled: view === 'tape' && from != null && to != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  const availableQ = useQuery({
    queryKey: ['front-desk-available', tenant.propertyId, from, to],
    queryFn: () => api.getAvailableRooms(tenant.propertyId, { fromDate: from!, toDate: to! }),
    enabled: view === 'available' && from != null && to != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  const typesQ = useQuery({
    queryKey: ['room-types', tenant.propertyId],
    queryFn: () => api.listRoomTypes(tenant.propertyId, { status: 'active' }),
    enabled: tapeQ.isSuccess || availableQ.isSuccess,
    retry: false,
  });

  const refs = useMemo(
    () => [...new Set((tapeQ.data?.blocks ?? []).map((i) => i.guestRef))],
    [tapeQ.data],
  );

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, tenant.propertyId, refs),
    enabled: refs.length > 0 && tapeQ.isSuccess,
    retry: false,
  });

  const activeError = view === 'available' ? availableQ.error : tapeQ.error;
  const activeIsError = view === 'available' ? availableQ.isError : tapeQ.isError;
  if (activeIsError && activeError) {
    const c = asClassified(activeError);
    if (c.class === 'fail_closed' || activeError instanceof ClassifiedError) {
      return (
        <Alert data-testid="tape-fail-closed">
          Property unreachable — board cannot load. This is not an empty day.
        </Alert>
      );
    }
    if (c.class === 'unauthorized') {
      window.location.assign('/sign-in');
      return null;
    }
    return <Alert>Failed to load board</Alert>;
  }

  const rooms = tapeQ.data?.rooms ?? [];
  const blocks = tapeQ.data?.blocks ?? [];
  const ooo = tapeQ.data?.ooo ?? [];
  const states = batchQ.data?.states ?? {};
  const typeRows = (typesQ.data?.roomTypes ?? []) as RoomTypeLabel[];
  const dates = from && to ? inclusiveDates(from, to) : [];
  const today = timeZone ? propertyLocalToday(timeZone) : null;

  let body: ReactNode;
  if (from == null || to == null || (view === 'tape' ? tapeQ.isLoading : availableQ.isLoading)) {
    body = <Skeleton label="Loading the room plan" lines={5} />;
  } else if (view === 'available') {
    const free = availableQ.data?.rooms ?? [];
    if (free.length === 0) {
      body = (
        <EmptyState
          kind="nomatch"
          title="No rooms free for these dates."
          action={
            <Link to="/book" className="ui-link-btn ui-link-btn--sm">
              Book
            </Link>
          }
        />
      );
    } else {
      body = (
        <>
          <p className="available-note muted">
            Vacant sellable inventory{' '}
            {from === to ? `on ${dateHeading(from)}.` : `for ${dateRange(from, to)}.`}
          </p>
          <div className="ui-table-scroll">
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {free.map((r) => (
                  <DataTableRow key={r.roomId}>
                    <DataTableCell>
                      <span className="ui-num">{r.code}</span>
                    </DataTableCell>
                    <DataTableCell>{typeLabel(r.roomTypeId, typeRows)}</DataTableCell>
                    <DataTableCell>
                      <RoomStatus status={r.status} />
                    </DataTableCell>
                    <DataTableCell align="right">
                      <Link
                        className="ui-link-btn ui-link-btn--sm"
                        aria-label={`Book ${r.code}`}
                        to={bookHref({
                          arrival: from,
                          departure: to > from ? to : addCalendarDays(from, 1),
                          roomTypeId: r.roomTypeId,
                        })}
                      >
                        Book
                      </Link>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
        </>
      );
    }
  } else if (rooms.length === 0) {
    body = <EmptyState kind="empty" title="No rooms yet — create rooms in Inventory." />;
  } else {
    body = (
      <TapeGrid
        from={from}
        to={to}
        dates={dates}
        today={today}
        rooms={rooms}
        blocks={blocks}
        ooo={ooo}
        states={states}
        typeRows={typeRows}
      />
    );
  }

  const tapeHref = from && to ? windowSearch(from, to, 'tape') : '/board';
  const availableHref =
    from && to ? windowSearch(from, to, 'available') : '/board?view=available';

  function jumpToday() {
    if (!timeZone || !from || !to) return;
    const t = propertyLocalToday(timeZone);
    writeWindow(t, addCalendarDays(t, 6));
  }

  return (
    <div className="room-plan">
      <PageHeader
        title="Room Plan"
        lead={today ? <BoardSummary layout="strip" date={today} /> : undefined}
        actions={
          <Link className="ui-link-btn ui-link-btn--primary" to="/book">
            <PlusIcon /> New booking
          </Link>
        }
      />
      <div className="room-plan-controls">
        <Tabs label="Room Plan views">
          <Link
            className="ui-tab"
            to={tapeHref}
            aria-current={view === 'tape' ? 'page' : undefined}
          >
            Tape
          </Link>
          <Link
            className="ui-tab"
            to={availableHref}
            aria-current={view === 'available' ? 'page' : undefined}
          >
            Available
          </Link>
        </Tabs>
        <TapeLegend />
        <div className="room-plan-controls__end">
          {from && to ? (
            <DateRange
              label="Tape date range"
              from={from}
              to={to}
              stepDays={stepDays}
              fromTestId="tape-from"
              toTestId="tape-to"
              onChange={(nextFrom, nextTo) => writeWindow(nextFrom, nextTo)}
            />
          ) : null}
          <Button type="button" size="sm" onClick={jumpToday} disabled={!timeZone}>
            Today
          </Button>
        </div>
      </div>
      {tapeWindowHint ? <p className="muted room-plan-hint">{tapeWindowHint}</p> : null}
      <Card className="tape-wrap">
        {view === 'available' && availableQ.isSuccess ? (
          <CardHeader>
            <CardTitle>Available Rooms</CardTitle>
            <Badge rung="settled">{availableQ.data?.rooms.length ?? 0} vacant</Badge>
          </CardHeader>
        ) : null}
        <CardContent flush>{body}</CardContent>
      </Card>
    </div>
  );
}
