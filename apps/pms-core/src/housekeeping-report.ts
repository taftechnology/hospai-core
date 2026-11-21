import {
  LIMIT_EXCEEDED,
  NOT_FOUND,
  REPORT_ROW_CAP,
  ROOM_BOARD_CONDITION_WORDS,
  guestAuditLineDiffers,
  reportCodeWord,
  reportDefinition,
  roundedRatio,
  type HousekeepingRequestType,
  type ModuleSql,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import {
  readAmenityDispatches,
  readAttendantWorkload,
  readGuestAudit,
  readGuestAudits,
  readHousekeepingCases,
  readHousekeepingRequests,
  readInspections,
  readLinenMovements,
  readLostItems,
  readMinibarReconciliation,
  readRoomBoardRooms,
  readRoomOooEvents,
  readRoomStatusHistoryRows,
} from '@hospai/pms-housekeeping';

/**
 * Housekeeping operational reports (R4.14 Part C). Each report runs the same module read as the
 * tab or screen it mirrors, with the same filters, so the rows are the tab list's rows; only the
 * wording and the columns are the report's. A module read that cut its list short (`truncated`)
 * makes the report an over-the-cap run rather than a quiet partial one. Guests and staff are
 * `guestRef`s and user ids; the SPA resolves names.
 * Spec: docs/superpowers/specs/2026-11-20-reports-c-night-audit-housekeeping-design.md
 */

export type HousekeepingReportDeps = {
  sql: ModuleSql;
  businessDate: string;
  currency: string;
  /** The `pms.housekeeping.request_types` list, for request labels. */
  requestTypes: readonly HousekeepingRequestType[];
  /** Instant of local midnight at the start of a calendar date in the property time zone. */
  dayStartMs(date: string): number;
};

export type HousekeepingReportResult =
  | ReportResponse
  | { ok: false; error: typeof LIMIT_EXCEEDED; limit: 'rows'; max: number }
  | { ok: false; error: typeof NOT_FOUND };

type Built = { rows: ReportRow[]; totals: ReportRow | null };
/** A build that ran past the row cap (or whose module read was cut short). */
const OVER_CAP = null;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const word = reportCodeWord;
const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

const STATUS_SOURCE_WORD: Record<string, string> = {
  desk: 'Front desk',
  bulk: 'Bulk update',
  check_out: 'Check-out',
  room_move: 'Room move',
  stay_change: 'Stay change',
  ooo: 'Room block',
  task_release: 'Task release',
};

const OOO_EVENT_WORD: Record<string, string> = {
  created: 'Created',
  updated: 'Changed',
  released: 'Released',
};

const MINIBAR_STATUS_WORD: Record<string, string> = {
  posted: 'Charged',
  complimentary: 'Complimentary',
};

const MINIBAR_FOLIO_WORD: Record<string, string> = {
  posted: 'Posted',
  moved: 'Moved to another window',
  missing: 'Missing',
  none: 'No charge',
};

const STOCK_STATUS_WORD: Record<string, string> = {
  pending: 'Pending',
  posted: 'Posted',
  not_linked: 'Not linked',
};

// ---------------------------------------------------------------------------------------------
// 1. Room status (the live room view's read)
// ---------------------------------------------------------------------------------------------

function buildRoomStatus(deps: HousekeepingReportDeps): Built {
  const { rooms } = readRoomBoardRooms(deps.sql, deps.businessDate);
  return {
    rows: rooms.map((r) => ({
      room: r.code,
      floor: r.floor,
      roomType: r.roomTypeName || null,
      status: word(r.housekeepingStatus),
      condition: ROOM_BOARD_CONDITION_WORDS[r.condition],
      block: r.ooo ? (r.ooo.reason ?? 'Blocked') : null,
      blockUntil: r.ooo?.endDate ?? null,
      guest: r.inHouse?.guestRef ?? null,
    })),
    totals: null,
  };
}

function roomCodes(deps: HousekeepingReportDeps): Map<string, string> {
  const rows = deps.sql.exec(`SELECT room_id, code FROM room`).toArray() as Array<{
    room_id: string;
    code: string;
  }>;
  return new Map(rows.map((r) => [r.room_id, r.code]));
}

// ---------------------------------------------------------------------------------------------
// 2. Status-change history
// ---------------------------------------------------------------------------------------------

function buildStatusHistory(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; room?: string },
): Built | typeof OVER_CAP {
  const { rows, truncated } = readRoomStatusHistoryRows(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.room ? { roomId: p.room } : {}),
    limit: REPORT_ROW_CAP,
  });
  if (truncated) return OVER_CAP;
  const codes = roomCodes(deps);
  return {
    rows: rows.map((r) => ({
      at: r.createdAt,
      businessDate: r.businessDate,
      room: codes.get(r.roomId) ?? null,
      from: word(r.fromStatus),
      to: word(r.toStatus),
      source: STATUS_SOURCE_WORD[r.source] ?? word(r.source),
      reason: r.reason,
      comment: r.comment,
      actor: r.actor,
    })),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Blocks (room_ooo_event)
// ---------------------------------------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function buildBlocks(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string },
): Built | typeof OVER_CAP {
  const { events, truncated } = readRoomOooEvents(deps.sql, {
    fromMs: deps.dayStartMs(p.from),
    toMs: deps.dayStartMs(addDays(p.to, 1)),
    limit: REPORT_ROW_CAP,
  });
  if (truncated) return OVER_CAP;
  const codes = roomCodes(deps);
  return {
    rows: events.map((e) => {
      // A release has no "after": the block it ended is the "before".
      const state = (e.kind === 'released' ? e.before : e.after) ?? e.before ?? {};
      const start = str(state.startTime);
      const end = str(state.endTime);
      return {
        at: e.at,
        room: codes.get(e.roomId) ?? null,
        event: OOO_EVENT_WORD[e.kind] ?? word(e.kind),
        blockType: state.blockType ? word(String(state.blockType)) : null,
        startDate: str(state.startDate),
        endDate: str(state.endDate),
        times: start && end ? `${start} to ${end}` : (start ?? end),
        reason: e.reason ?? str(state.reason),
        actor: e.actor,
      };
    }),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Attendant workload
// ---------------------------------------------------------------------------------------------

function buildWorkload(deps: HousekeepingReportDeps, p: { from: string; to: string }): Built | typeof OVER_CAP {
  const list = readAttendantWorkload(deps.sql, { ...p, today: deps.businessDate });
  if (list.length > REPORT_ROW_CAP) return OVER_CAP;
  const rows: ReportRow[] = list.map((w) => ({
    date: w.businessDate,
    attendant: w.assigneeRef,
    assigned: w.assigned,
    completed: w.completed,
    reviewed: w.reviewed,
    open: w.open,
    overdue: w.overdue,
    rooms: w.rooms,
  }));
  const sum = (k: keyof (typeof list)[number]) => list.reduce((n, w) => n + Number(w[k]), 0);
  return {
    rows,
    totals: {
      date: null,
      attendant: null,
      assigned: sum('assigned'),
      completed: sum('completed'),
      reviewed: sum('reviewed'),
      open: sum('open'),
      overdue: sum('overdue'),
      rooms: sum('rooms'),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 5. Inspection scores
// ---------------------------------------------------------------------------------------------

function buildInspections(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; room?: string; inspector?: string },
): Built | typeof OVER_CAP {
  const list = readInspections(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.room ? { roomId: p.room } : {}),
    ...(p.inspector ? { inspectorRef: p.inspector } : {}),
  });
  if (list.truncated) return OVER_CAP;
  const rows: ReportRow[] = list.inspections.map((i) => ({
    date: i.businessDate,
    room: i.roomCode,
    template: i.templateName,
    inspector: i.inspectorRef,
    attendant: i.attendantRef,
    score: i.scorePercent,
    threshold: i.passThreshold,
    result: word(i.result),
  }));
  // The average per inspector is a display statistic: the shared half-up rule, never stored.
  const byInspector = new Map<string, { sum: number; n: number }>();
  for (const i of list.inspections) {
    const cur = byInspector.get(i.inspectorRef) ?? { sum: 0, n: 0 };
    cur.sum += i.scorePercent;
    cur.n += 1;
    byInspector.set(i.inspectorRef, cur);
  }
  const subtotal = (inspector: string | null, label: string, sum: number, n: number): ReportRow => ({
    date: null,
    room: label,
    template: null,
    inspector,
    attendant: null,
    score: roundedRatio(sum, n),
    threshold: null,
    result: `${n} ${n === 1 ? 'inspection' : 'inspections'}`,
    subtotal: 1,
  });
  for (const [inspector, v] of [...byInspector.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(subtotal(inspector, 'Average', v.sum, v.n));
  }
  if (byInspector.size > 1) {
    const all = [...byInspector.values()].reduce((a, v) => ({ sum: a.sum + v.sum, n: a.n + v.n }), { sum: 0, n: 0 });
    rows.push(subtotal(null, 'Average, all inspectors', all.sum, all.n));
  }
  return { rows, totals: null };
}

// ---------------------------------------------------------------------------------------------
// 6. Guest audit
// ---------------------------------------------------------------------------------------------

function buildGuestAudit(deps: HousekeepingReportDeps, p: { from: string; to: string }): Built | typeof OVER_CAP {
  const list = readGuestAudits(deps.sql, { from: p.from, to: p.to });
  if (list.truncated) return OVER_CAP;
  const rows: ReportRow[] = [];
  for (const s of list.sessions) {
    const detail = readGuestAudit(deps.sql, s.sessionId);
    const variance = detail.lines.filter(guestAuditLineDiffers);
    const session = word(s.status);
    if (variance.length === 0) {
      rows.push({
        date: s.businessDate,
        session,
        room: null,
        frontOffice: null,
        housekeeping: null,
        difference: null,
        reason: s.countedCount > 0 ? 'No differences' : 'No rooms counted yet',
        evidence: null,
        countedBy: null,
      });
      continue;
    }
    for (const l of variance) {
      const fo = l.frontOfficeAdults + l.frontOfficeChildren;
      const hk = (l.housekeepingAdults ?? 0) + (l.housekeepingChildren ?? 0);
      rows.push({
        date: s.businessDate,
        session,
        room: l.roomCode,
        frontOffice: fo,
        housekeeping: hk,
        difference: hk - fo,
        reason: l.varianceReason,
        evidence: l.evidenceNote,
        countedBy: l.countedBy,
      });
    }
  }
  return { rows, totals: null };
}

// ---------------------------------------------------------------------------------------------
// 7. Requests
// ---------------------------------------------------------------------------------------------

function buildRequests(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; status?: string; department?: string },
): Built | typeof OVER_CAP {
  const list = readHousekeepingRequests(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.status ? { status: p.status } : {}),
    ...(p.department ? { department: p.department } : {}),
    today: deps.businessDate,
  });
  if (list.truncated) return OVER_CAP;
  const labels = new Map(deps.requestTypes.map((t) => [t.code, t.label]));
  return {
    rows: list.requests.map((r) => ({
      date: r.businessDate,
      room: r.roomCode,
      guest: r.guestRef,
      type: labels.get(r.requestType) ?? word(r.requestType),
      department: word(r.department),
      status: word(r.status),
      note: r.note,
      assignee: r.assigneeRef,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution ?? r.cancelReason,
    })),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 8. Lost and found register
// ---------------------------------------------------------------------------------------------

function buildLostFound(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; status?: string },
): Built | typeof OVER_CAP {
  const list = readLostItems(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.status ? { status: p.status } : {}),
    monthRangeMs: null,
  });
  if (list.truncated) return OVER_CAP;
  return {
    rows: list.items.map((i) => ({
      date: i.businessDate,
      item: i.description,
      category: word(i.category),
      room: i.roomCode,
      foundWhere: i.foundWhere,
      foundBy: i.foundByRef,
      storage: i.storageLocation,
      status: word(i.status),
      handedTo: i.handedToRef,
      handedOverAt: i.handedOverAt,
      claimant: i.claimantGuestRef,
      claimedAt: i.claimedAt,
      disposedAt: i.disposedAt,
      disposeReason: i.disposeReason,
      closedAt: i.closedAt,
    })),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 9. Damage and missing cases
// ---------------------------------------------------------------------------------------------

function buildCases(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; status?: string },
): Built | typeof OVER_CAP {
  const list = readHousekeepingCases(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.status ? { status: p.status } : {}),
  });
  if (list.truncated) return OVER_CAP;
  return {
    rows: list.cases.map((c) => ({
      date: c.businessDate,
      kind: c.kind === 'damaged' ? 'Damage' : 'Missing item',
      room: c.roomCode,
      guest: c.guestRef,
      item: c.item,
      detail: c.inspectionDetail,
      returned: word(c.returnedStatus),
      status: word(c.status),
      closedAt: c.closedAt,
      closureNote: c.closureNote,
    })),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 10. Linen log
// ---------------------------------------------------------------------------------------------

function buildLinen(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; item?: string; kind?: string },
): Built | typeof OVER_CAP {
  const list = readLinenMovements(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.item ? { itemId: p.item } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
  });
  if (list.truncated) return OVER_CAP;
  return {
    rows: list.movements.map((m) => ({
      date: m.businessDate,
      item: m.itemName,
      kind: word(m.kind),
      quantity: m.quantity,
      onHandAfter: m.onHandAfter,
      room: m.roomCode,
      attendant: m.attendantRef,
      actor: m.actorRef,
      note: m.note,
    })),
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 11. Minibar
// ---------------------------------------------------------------------------------------------

function buildMinibar(deps: HousekeepingReportDeps, p: { from: string; to: string }): Built | typeof OVER_CAP {
  const list = readMinibarReconciliation(deps.sql, { from: p.from, to: p.to });
  if (list.truncated) return OVER_CAP;
  const charged = list.rows.filter((r) => r.status === 'posted');
  return {
    rows: list.rows.map((r) => ({
      date: r.businessDate,
      room: r.roomCode,
      guest: r.guestRef,
      product: r.productName,
      quantity: r.quantity,
      unitAmount: r.unitAmountMinor,
      amount: r.amountMinor,
      status: MINIBAR_STATUS_WORD[r.status] ?? word(r.status),
      folio: MINIBAR_FOLIO_WORD[r.folioState] ?? word(r.folioState),
      stock: r.stockTracked ? yesNo(r.stockMovement) : 'Not tracked',
      attendant: r.attendantRef,
    })),
    totals: {
      date: null,
      quantity: charged.reduce((n, r) => n + r.quantity, 0),
      amount: charged.reduce((n, r) => n + r.amountMinor, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 12. Amenity dispatches
// ---------------------------------------------------------------------------------------------

function buildAmenities(
  deps: HousekeepingReportDeps,
  p: { from: string; to: string; status?: string },
): Built | typeof OVER_CAP {
  const list = readAmenityDispatches(deps.sql, {
    from: p.from,
    to: p.to,
    ...(p.status ? { status: p.status } : {}),
  });
  if (list.truncated) return OVER_CAP;
  const rows: ReportRow[] = [];
  for (const d of list.dispatches) {
    for (const l of d.lines) {
      rows.push({
        date: d.businessDate,
        room: d.roomCode,
        rule: d.ruleName,
        when: word(d.when),
        amenity: l.unit ? `${l.amenityName} (${l.unit})` : l.amenityName,
        expected: l.expectedQuantity,
        actual: l.actualQuantity,
        status: word(d.status),
        exception: d.exceptionReason,
        confirmedAt: d.confirmedAt,
        confirmedBy: d.confirmedBy,
      });
    }
  }
  return { rows, totals: null };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** Fills the business-date defaults the route left open. */
export function resolveHousekeepingParams(
  def: ReportDefinition,
  params: ReportParams,
  businessDate: string,
): ReportParams {
  if (def.params.kind === 'none') return {};
  if (def.params.kind !== 'range') return { date: params.date ?? businessDate };
  const from = params.from ?? businessDate;
  const to = params.to ?? addDays(from, def.params.defaultSpan - 1);
  const out: ReportParams = { from, to };
  for (const k of ['status', 'department', 'kind', 'room', 'item', 'inspector'] as const) {
    if (params[k]) out[k] = params[k];
  }
  return out;
}

export function readHousekeepingReport(
  deps: HousekeepingReportDeps,
  reportId: string,
  rawParams: ReportParams,
  now: Date = new Date(),
): HousekeepingReportResult {
  const def = reportDefinition(reportId);
  if (!def || def.routeId !== 'get_housekeeping_report') return { ok: false, error: NOT_FOUND };
  const params = resolveHousekeepingParams(def, rawParams, deps.businessDate);
  const range = { from: params.from ?? '', to: params.to ?? '' };

  let built: Built | typeof OVER_CAP;
  switch (def.id) {
    case 'housekeeping_room_status':
      built = buildRoomStatus(deps);
      break;
    case 'housekeeping_status_history':
      built = buildStatusHistory(deps, { ...range, ...(params.room ? { room: params.room } : {}) });
      break;
    case 'housekeeping_blocks':
      built = buildBlocks(deps, range);
      break;
    case 'housekeeping_attendant_workload':
      built = buildWorkload(deps, range);
      break;
    case 'housekeeping_inspection_scores':
      built = buildInspections(deps, {
        ...range,
        ...(params.room ? { room: params.room } : {}),
        ...(params.inspector ? { inspector: params.inspector } : {}),
      });
      break;
    case 'housekeeping_guest_audit':
      built = buildGuestAudit(deps, range);
      break;
    case 'housekeeping_requests':
      built = buildRequests(deps, {
        ...range,
        ...(params.status ? { status: params.status } : {}),
        ...(params.department ? { department: params.department } : {}),
      });
      break;
    case 'housekeeping_lost_found':
      built = buildLostFound(deps, { ...range, ...(params.status ? { status: params.status } : {}) });
      break;
    case 'housekeeping_cases':
      built = buildCases(deps, { ...range, ...(params.status ? { status: params.status } : {}) });
      break;
    case 'housekeeping_linen':
      built = buildLinen(deps, {
        ...range,
        ...(params.item ? { item: params.item } : {}),
        ...(params.kind ? { kind: params.kind } : {}),
      });
      break;
    case 'housekeeping_minibar':
      built = buildMinibar(deps, range);
      break;
    case 'housekeeping_amenities':
      built = buildAmenities(deps, { ...range, ...(params.status ? { status: params.status } : {}) });
      break;
    default:
      return { ok: false, error: NOT_FOUND };
  }
  if (!built || built.rows.length > REPORT_ROW_CAP) {
    return { ok: false, error: LIMIT_EXCEEDED, limit: 'rows', max: REPORT_ROW_CAP };
  }
  return {
    ok: true,
    reportId: def.id,
    generatedAt: now.toISOString(),
    businessDate: deps.businessDate,
    currency: deps.currency,
    params,
    columns: def.columns,
    rows: built.rows,
    totals: def.hasTotals ? built.totals : null,
  };
}
