import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCalendarDays,
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
  Field,
  NativeSelect,
  Tabs,
  Toolbar,
  RoomStatus,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { ROOM_CONDITION_ORDER, isRoomCondition, roomConditionWord } from '../status/room-condition.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { bookHref } from '../status/book-href.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { PlusIcon } from '../shell/icons.js';
import { BoardSummary } from './board-summary.js';
import { TapeLegend } from './tape/TapeLegend.js';
import { TapeGrid } from './tape/TapeGrid.js';
import {
  filterRoomsByCondition,
  filterRoomsByType,
  tapeRoomConditions,
  type TapeCondition,
} from './tape/tape-filter.js';

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
  const typeFilter = params.get('type') ?? '';
  const statusRaw = params.get('status') ?? '';
  const statusFilter: TapeCondition | '' =
    isRoomCondition(statusRaw) && statusRaw !== 'unavailable' ? statusRaw : '';
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
    if (typeFilter) sp.set('type', typeFilter);
    if (statusFilter) sp.set('status', statusFilter);
    return `?${sp.toString()}`;
  }

  function writeWindow(nextFrom: string, nextTo: string) {
    const clamped = clampTapeWindow(nextFrom, nextTo);
    setFrom(clamped.from);
    setTo(clamped.to);
    setTapeWindowHint(clamped.clamped ? 'Room plan shows up to 14 days.' : null);
    void navigate({ search: windowSearch(clamped.from, clamped.to, view) }, { replace: true });
  }

  function writeFilters(next: { type?: string; status?: string }) {
    const sp = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    void navigate({ search: `?${sp.toString()}` }, { replace: true });
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
  if (activeIsError && activeError && asClassified(activeError).class === 'unauthorized') {
    window.location.assign('/sign-in');
    return null;
  }
  const loadError =
    activeIsError && activeError ? asClassified(activeError) : null;

  const rooms = tapeQ.data?.rooms ?? [];
  const blocks = tapeQ.data?.blocks ?? [];
  const ooo = tapeQ.data?.ooo ?? [];
  const states = batchQ.data?.states ?? {};
  const typeRows = (typesQ.data?.roomTypes ?? []) as RoomTypeLabel[];
  const dates = from && to ? inclusiveDates(from, to) : [];
  const today = timeZone ? propertyLocalToday(timeZone) : null;

  const todayInWindow = today != null && from != null && to != null && today >= from && today <= to;
  const conditions =
    todayInWindow && today ? tapeRoomConditions({ rooms, blocks, ooo, today }) : null;
  const roomsOfType = filterRoomsByType(rooms, typeFilter);
  const shownRooms = filterRoomsByCondition(roomsOfType, statusFilter, conditions);
  const typeOptionMap = new Map<string, string>();
  for (const r of rooms) {
    if (!typeOptionMap.has(r.roomTypeId)) typeOptionMap.set(r.roomTypeId, typeLabel(r.roomTypeId, typeRows));
  }
  const typeOptions = [...typeOptionMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const availabilityTypeIds = new Set(roomsOfType.map((r) => r.roomTypeId));
  const filtering = typeFilter !== '' || statusFilter !== '';

  let body: ReactNode;
  if (loadError) {
    body = (
      <Alert data-testid="tape-fail-closed">
        {classifiedUserMessage(loadError, { fallback: 'Failed to load board.' })}
      </Alert>
    );
  } else if (from == null || to == null || (view === 'tape' ? tapeQ.isLoading : availableQ.isLoading)) {
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
                          roomId: r.roomId,
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
  } else if (shownRooms.length === 0) {
    body = (
      <EmptyState
        kind="nomatch"
        data-testid="tape-no-match"
        title="No rooms match these filters."
        action={
          <Button type="button" size="sm" onClick={() => writeFilters({ type: '', status: '' })}>
            Clear filters
          </Button>
        }
      />
    );
  } else {
    body = (
      <TapeGrid
        from={from}
        to={to}
        dates={dates}
        today={today}
        rooms={shownRooms}
        conditions={conditions}
        availabilityTypeIds={availabilityTypeIds}
        hideUnassigned={statusFilter !== ''}
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
      <TapeLegend />
      {tapeWindowHint ? <p className="muted room-plan-hint">{tapeWindowHint}</p> : null}
      <Card className="tape-wrap">
        {view === 'tape' && rooms.length > 0 ? (
          <Toolbar>
            <div className="tape-filters" data-testid="tape-filters">
              <Field
                label="Room type"
                control={
                  <NativeSelect
                    data-testid="tape-filter-type"
                    value={typeFilter}
                    onChange={(e) => writeFilters({ type: e.target.value })}
                  >
                    <option value="">All room types</option>
                    {typeOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                    {typeFilter && !typeOptions.some(([id]) => id === typeFilter) ? (
                      <option value={typeFilter}>Room type unavailable</option>
                    ) : null}
                  </NativeSelect>
                }
              />
              <Field
                label="Status today"
                hint={
                  conditions == null && today != null
                    ? 'Today is outside this date range.'
                    : undefined
                }
                control={
                  <NativeSelect
                    data-testid="tape-filter-status"
                    value={statusFilter}
                    disabled={conditions == null}
                    onChange={(e) => writeFilters({ status: e.target.value })}
                  >
                    <option value="">All statuses</option>
                    {ROOM_CONDITION_ORDER.filter((c) => c !== 'unavailable').map((c) => (
                      <option key={c} value={c}>
                        {roomConditionWord(c)}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              {filtering ? (
                <Button type="button" size="sm" onClick={() => writeFilters({ type: '', status: '' })}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </Toolbar>
        ) : null}
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
