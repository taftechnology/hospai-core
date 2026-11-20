import { addCalendarDays, type FrontDeskItem, type GuestRowState } from '@hospai/client-core';
import { Link } from 'react-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { RoomStatus } from '@hospai/ui-kit';
import { bookHref } from '../../status/book-href.js';
import { useFormat } from '../../shell/PropertyFormat.js';
import { assignLanes, stayTracks, type StayTrackSpan } from './stay-tracks.js';
import { BlockedBar, StayBar } from './StayBar.js';
import { TapeFreeRow } from './TapeFreeRow.js';

type RoomRow = {
  roomId: string;
  roomTypeId: string;
  code: string;
  status: string;
};

type OooRow = {
  oooId: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

type RoomTypeLabel = { roomTypeId: string; name?: string; code?: string };

function typeLabel(id: string, types: RoomTypeLabel[]): string {
  const hit = types.find((t) => t.roomTypeId === id);
  return hit?.name || hit?.code || 'Room type unavailable';
}

function blockTypeId(block: FrontDeskItem): string {
  const rt = block.roomTypeId;
  return typeof rt === 'string' ? rt : '';
}

type FocusCell = { row: number; col: number };

function spanCoversDay(span: StayTrackSpan, dayIndex: number): boolean {
  const cellStart = 2 + dayIndex * 2;
  const cellEnd = cellStart + 2;
  return span.colStart < cellEnd && span.colEnd > cellStart;
}

function cellTabIndexFor(
  rowIndex: number,
  col: number,
  focus: FocusCell,
  barSpans: StayTrackSpan[],
): number {
  if (focus.row !== rowIndex || focus.col !== col) return -1;
  if (barSpans.some((span) => spanCoversDay(span, col))) return -1;
  return 0;
}

function barTabIndexFor(rowIndex: number, focus: FocusCell, span: StayTrackSpan): number {
  if (focus.row !== rowIndex) return -1;
  return spanCoversDay(span, focus.col) ? 0 : -1;
}

function oooBarLabel(reason: string | null): string {
  const trimmed = reason?.trim();
  return trimmed ? `Out of order · ${trimmed}` : 'Out of order';
}

export function TapeGrid({
  from,
  to,
  dates,
  today,
  rooms,
  blocks,
  ooo,
  states,
  typeRows,
}: {
  from: string;
  to: string;
  dates: string[];
  today: string | null;
  rooms: RoomRow[];
  blocks: FrontDeskItem[];
  ooo: OooRow[];
  states: Record<string, GuestRowState | undefined>;
  typeRows: RoomTypeLabel[];
}) {
  const { date, tapeDay } = useFormat();
  const tapeCols = String(Math.max(dates.length, 1));
  const roomTypeIdsOnTape = useMemo(() => new Set(rooms.map((r) => r.roomTypeId)), [rooms]);

  const groups: Array<{ typeId: string; rooms: RoomRow[] }> = [];
  const seen = new Set<string>();
  for (const r of rooms) {
    if (seen.has(r.roomTypeId)) continue;
    seen.add(r.roomTypeId);
    groups.push({
      typeId: r.roomTypeId,
      rooms: rooms.filter((x) => x.roomTypeId === r.roomTypeId),
    });
  }

  const assignedByRoom = new Map<string, FrontDeskItem[]>();
  const unassignedByType = new Map<string, FrontDeskItem[]>();
  for (const b of blocks) {
    if (b.roomId == null) {
      const tid = blockTypeId(b) || groups[0]?.typeId || '';
      const list = unassignedByType.get(tid) ?? [];
      list.push(b);
      unassignedByType.set(tid, list);
    } else {
      const list = assignedByRoom.get(b.roomId) ?? [];
      list.push(b);
      assignedByRoom.set(b.roomId, list);
    }
  }

  let totalDataRows = 1;
  for (const g of groups) {
    const unassigned = unassignedByType.get(g.typeId) ?? [];
    if (unassigned.length > 0) {
      const withSpans = unassigned
        .map((block) => {
          const span = stayTracks(block.arrivalDate ?? from, block.departureDate, dates);
          if (!span) return null;
          return { block, span, colStart: span.colStart, colEnd: span.colEnd, arrivalDate: block.arrivalDate ?? from };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      totalDataRows += assignLanes(withSpans).length;
    }
    totalDataRows += g.rooms.length;
  }
  const [focus, setFocus] = useState<FocusCell>({ row: 1, col: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const skipMountFocus = useRef(true);

  useEffect(() => {
    if (skipMountFocus.current) {
      skipMountFocus.current = false;
      return;
    }
    const root = scrollerRef.current;
    if (!root) return;
    const target = root.querySelector('[tabindex="0"]');
    if (target instanceof HTMLElement) target.focus();
  }, [focus]);

  const moveFocus = useCallback(
    (next: FocusCell) => {
      const row = Math.max(1, Math.min(totalDataRows - 1, next.row));
      const col = Math.max(0, Math.min(dates.length - 1, next.col));
      setFocus({ row, col });
    },
    [dates.length, totalDataRows],
  );

  function onGridKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveFocus({ row: focus.row, col: focus.col + 1 });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocus({ row: focus.row, col: focus.col - 1 });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus({ row: focus.row + 1, col: focus.col });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus({ row: focus.row - 1, col: focus.col });
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus({ row: focus.row, col: 0 });
    } else if (e.key === 'End') {
      e.preventDefault();
      moveFocus({ row: focus.row, col: dates.length - 1 });
    }
  }

  let renderRow = 1;

  return (
    <div
      ref={scrollerRef}
      className="tape-scroller"
      role="grid"
      aria-label="Room plan"
      onKeyDown={onGridKeyDown}
    >
      <div
        className="tape-row tape-row--head"
        role="row"
        style={{ ['--tape-cols' as string]: tapeCols }}
      >
        <div className="tape-room tape-corner" role="columnheader">
          Room
        </div>
        {dates.map((d, i) => (
          <div
            key={d}
            className={`tape-header-cell tabular-nums${d === today ? ' tape-header-cell--today' : ''}`}
            role="columnheader"
            style={{ ['--tape-col' as string]: String(2 + i * 2) }}
          >
            {tapeDay(d, dates.length <= 7)}
          </div>
        ))}
      </div>

      {groups.map((g) => {
        const typeName = typeLabel(g.typeId, typeRows);
        const unassigned = unassignedByType.get(g.typeId) ?? [];
        const withSpans = unassigned
          .map((block) => {
            const span = stayTracks(block.arrivalDate ?? from, block.departureDate, dates);
            if (!span) return null;
            return {
              block,
              span,
              colStart: span.colStart,
              colEnd: span.colEnd,
              arrivalDate: block.arrivalDate ?? from,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null);
        const unassignedLanes = assignLanes(withSpans);

        return (
          <section key={g.typeId}>
            <div className="tape-band" role="row">
              <div className="tape-band__label" role="rowheader">
                {typeName}
              </div>
            </div>
            {unassignedLanes.map((lane, li) => {
              const rIdx = renderRow++;
              const laneBarSpans = lane.map(({ span }) => span);
              return (
                <div
                  key={`un-${g.typeId}-${li}`}
                  data-testid={li === 0 ? 'tape-unassigned' : undefined}
                  className="tape-row content-visibility-auto"
                  role="row"
                  style={{ ['--tape-cols' as string]: tapeCols }}
                >
                  <div className="tape-room" role="rowheader">
                    Unassigned
                  </div>
                  {dates.map((d, i) => {
                    const bookable = today != null && d >= today;
                    const col = i;
                    if (bookable) {
                      return (
                        <Link
                          key={d}
                          to={bookHref({
                            arrival: d,
                            departure: addCalendarDays(d, 1),
                            roomTypeId: g.typeId,
                          })}
                          aria-label={`Book ${typeName} on ${date(d)}`}
                          className={`tape-cell tape-cell--bookable${d === today ? ' tape-cell--today' : ''}`}
                          role="gridcell"
                          tabIndex={cellTabIndexFor(rIdx, col, focus, laneBarSpans)}
                          onFocus={() => setFocus({ row: rIdx, col })}
                          style={{ ['--tape-col' as string]: String(2 + i * 2) }}
                        />
                      );
                    }
                    return (
                      <div
                        key={d}
                        className={`tape-cell${d === today ? ' tape-cell--today' : ''}`}
                        role="gridcell"
                        tabIndex={cellTabIndexFor(rIdx, col, focus, laneBarSpans)}
                        onFocus={() => setFocus({ row: rIdx, col })}
                        style={{ ['--tape-col' as string]: String(2 + i * 2) }}
                      />
                    );
                  })}
                  {lane.map(({ block, span }) => (
                    <StayBar
                      key={block.reservationId}
                      block={block}
                      state={states[block.guestRef]}
                      span={span}
                      today={today}
                      roomTypeName={typeName}
                      tabIndex={barTabIndexFor(rIdx, focus, span)}
                      onFocus={() => {
                        const col =
                          focus.row === rIdx && spanCoversDay(span, focus.col)
                            ? focus.col
                            : dates.findIndex((_, dayIdx) => spanCoversDay(span, dayIdx));
                        if (col >= 0) setFocus({ row: rIdx, col });
                      }}
                    />
                  ))}
                </div>
              );
            })}
            {g.rooms.map((room) => {
              const rIdx = renderRow++;
              const roomBlocks = assignedByRoom.get(room.roomId) ?? [];
              const roomBarSpans = roomBlocks
                .map((block) => stayTracks(block.arrivalDate ?? from, block.departureDate, dates))
                .filter((span): span is StayTrackSpan => span != null);
              return (
                <div
                  key={room.roomId}
                  className="tape-row content-visibility-auto"
                  role="row"
                  style={{ ['--tape-cols' as string]: tapeCols }}
                >
                  <div className="tape-room min-w-0" role="rowheader">
                    <b>{room.code}</b>
                    <RoomStatus status={room.status} />
                  </div>
                  {dates.map((d, i) => {
                    const bookable = today != null && d >= today;
                    const col = i;
                    if (bookable) {
                      return (
                        <Link
                          key={d}
                          to={bookHref({
                            arrival: d,
                            departure: addCalendarDays(d, 1),
                            roomTypeId: room.roomTypeId,
                            roomId: room.roomId,
                          })}
                          aria-label={`Book ${typeName} on ${date(d)}`}
                          className={`tape-cell tape-cell--bookable${d === today ? ' tape-cell--today' : ''}`}
                          role="gridcell"
                          tabIndex={cellTabIndexFor(rIdx, col, focus, roomBarSpans)}
                          onFocus={() => setFocus({ row: rIdx, col })}
                          style={{ ['--tape-col' as string]: String(2 + i * 2) }}
                        />
                      );
                    }
                    return (
                      <div
                        key={d}
                        className={`tape-cell${d === today ? ' tape-cell--today' : ''}`}
                        role="gridcell"
                        tabIndex={cellTabIndexFor(rIdx, col, focus, roomBarSpans)}
                        onFocus={() => setFocus({ row: rIdx, col })}
                        style={{ ['--tape-col' as string]: String(2 + i * 2) }}
                      />
                    );
                  })}
                  {roomBlocks.map((block) => {
                    const span = stayTracks(block.arrivalDate ?? from, block.departureDate, dates);
                    if (!span) return null;
                    return (
                      <StayBar
                        key={block.reservationId}
                        block={block}
                        state={states[block.guestRef]}
                        span={span}
                        today={today}
                        roomCode={room.code}
                        roomTypeName={typeName}
                        tabIndex={barTabIndexFor(rIdx, focus, span)}
                        onFocus={() => {
                          const col =
                            focus.row === rIdx && spanCoversDay(span, focus.col)
                              ? focus.col
                              : dates.findIndex((_, dayIdx) => spanCoversDay(span, dayIdx));
                          if (col >= 0) setFocus({ row: rIdx, col });
                        }}
                      />
                    );
                  })}
                  {ooo
                    .filter((row) => row.roomId === room.roomId)
                    .map((row) => {
                      const span = stayTracks(row.startDate, row.endDate, dates);
                      if (!span) return null;
                      return (
                        <BlockedBar key={row.oooId} label={oooBarLabel(row.reason)} span={span} />
                      );
                    })}
                </div>
              );
            })}
          </section>
        );
      })}

      <TapeFreeRow
        dates={dates}
        tapeCols={tapeCols}
        roomTypeIdsOnTape={roomTypeIdsOnTape}
        from={from}
        to={to}
      />
    </div>
  );
}
