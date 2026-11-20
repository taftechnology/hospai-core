import type {
  GuestAuditCountInput,
  GuestAuditDetail,
  GuestAuditLine,
  GuestAuditLineEvent,
  GuestAuditSession,
  GuestAuditSessionList,
  GuestAuditStatus,
  GuestAuditTotals,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';
import {
  guestAuditLineDiffers,
  HK_AUDIT_COUNT_LINES_MAX,
  HK_AUDIT_COUNT_MAX,
  HK_AUDIT_EVENTS_MAX,
  HK_AUDIT_EVIDENCE_MAX,
  HK_AUDIT_NOTES_MAX,
  HK_AUDIT_REASON_MAX,
  HK_AUDITS_LIST_MAX,
} from '@hospai/contracts';
import {
  HousekeepingAuditSessionOpenError,
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingReasonRequiredError,
  HousekeepingRecordNotFoundError,
} from '../domain/errors.js';
import { optionalText } from '../domain/task.js';
import { BUSINESS_DATE_RE } from './stay-link.js';

type SessionDbRow = {
  session_id: string;
  business_date: string;
  status: string;
  started_by: string;
  started_at: number;
  closed_by: string | null;
  closed_at: number | null;
  notes: string | null;
};

const SESSION_COLS =
  'session_id, business_date, status, started_by, started_at, closed_by, closed_at, notes';

function mapSession(r: SessionDbRow): GuestAuditSession {
  return {
    sessionId: r.session_id,
    businessDate: r.business_date,
    status: r.status as GuestAuditStatus,
    startedBy: r.started_by,
    startedAt: r.started_at,
    closedBy: r.closed_by,
    closedAt: r.closed_at,
    notes: r.notes,
  };
}

function loadSession(sql: ModuleSql, sessionId: string): SessionDbRow | null {
  const rows = sql
    .exec(`SELECT ${SESSION_COLS} FROM housekeeping_guest_audit_session WHERE session_id = ?`, sessionId)
    .toArray() as SessionDbRow[];
  return rows[0] ?? null;
}

type LineDbRow = {
  line_id: string;
  session_id: string;
  room_id: string;
  room_code: string;
  floor: string | null;
  room_type_id: string;
  room_type_name: string;
  fo_adults: number;
  fo_children: number;
  hk_adults: number | null;
  hk_children: number | null;
  variance_reason: string | null;
  evidence_note: string | null;
  counted_by: string | null;
  counted_at: number | null;
};

function mapLine(r: LineDbRow): GuestAuditLine {
  return {
    lineId: r.line_id,
    sessionId: r.session_id,
    roomId: r.room_id,
    roomCode: r.room_code,
    floor: r.floor,
    roomTypeId: r.room_type_id,
    roomTypeName: r.room_type_name,
    frontOfficeAdults: Number(r.fo_adults),
    frontOfficeChildren: Number(r.fo_children),
    housekeepingAdults: r.hk_adults === null ? null : Number(r.hk_adults),
    housekeepingChildren: r.hk_children === null ? null : Number(r.hk_children),
    varianceReason: r.variance_reason,
    evidenceNote: r.evidence_note,
    countedBy: r.counted_by,
    countedAt: r.counted_at,
  };
}

function loadLines(sql: ModuleSql, sessionId: string): GuestAuditLine[] {
  const rows = sql
    .exec(
      `SELECT l.line_id, l.session_id, l.room_id, m.code AS room_code, m.floor AS floor,
              m.room_type_id AS room_type_id, t.name AS room_type_name,
              l.fo_adults, l.fo_children, l.hk_adults, l.hk_children, l.variance_reason,
              l.evidence_note, l.counted_by, l.counted_at
       FROM housekeeping_guest_audit_line l
       JOIN room m ON m.room_id = l.room_id
       JOIN room_type t ON t.room_type_id = m.room_type_id
       WHERE l.session_id = ?
       ORDER BY m.floor, m.code`,
      sessionId,
    )
    .toArray() as LineDbRow[];
  return rows.map(mapLine);
}

function totals(
  lines: GuestAuditLine[],
  keyOf: (l: GuestAuditLine) => string | null,
  labelOf: (key: string | null) => string,
): GuestAuditTotals[] {
  const map = new Map<string | null, GuestAuditTotals>();
  for (const l of lines) {
    const key = keyOf(l);
    const t = map.get(key) ?? { key, label: labelOf(key), rooms: 0, countedRooms: 0, frontOffice: 0, housekeeping: 0, variance: 0 };
    const fo = l.frontOfficeAdults + l.frontOfficeChildren;
    t.rooms += 1;
    if (l.housekeepingAdults !== null && l.housekeepingChildren !== null) {
      t.countedRooms += 1;
      t.frontOffice += fo;
      const hk = l.housekeepingAdults + l.housekeepingChildren;
      t.housekeeping += hk;
      t.variance += hk - fo;
    }
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function readGuestAudit(sql: ModuleSql, sessionId: string): GuestAuditDetail {
  const session = loadSession(sql, sessionId);
  if (!session) throw new HousekeepingRecordNotFoundError();
  const lines = loadLines(sql, sessionId);
  const events = (
    sql
      .exec(
        `SELECT event_id, line_id, room_id, adults, children, variance_reason, evidence_note, actor, at
         FROM housekeeping_guest_audit_line_event WHERE session_id = ?
         ORDER BY at, rowid LIMIT ?`,
        sessionId,
        HK_AUDIT_EVENTS_MAX,
      )
      .toArray() as Array<{
      event_id: string;
      line_id: string;
      room_id: string;
      adults: number;
      children: number;
      variance_reason: string | null;
      evidence_note: string | null;
      actor: string;
      at: number;
    }>
  ).map(
    (e): GuestAuditLineEvent => ({
      eventId: e.event_id,
      lineId: e.line_id,
      roomId: e.room_id,
      adults: Number(e.adults),
      children: Number(e.children),
      varianceReason: e.variance_reason,
      evidenceNote: e.evidence_note,
      actor: e.actor,
      at: e.at,
    }),
  );
  const typeNames = new Map(lines.map((l) => [l.roomTypeId, l.roomTypeName]));
  return {
    ok: true,
    session: mapSession(session),
    lines,
    events,
    totalsByFloor: totals(lines, (l) => l.floor, (k) => k ?? 'No floor'),
    totalsByType: totals(lines, (l) => l.roomTypeId, (k) => (k ? typeNames.get(k) ?? k : 'Unknown type')),
  };
}

export function readGuestAudits(
  sql: ModuleSql,
  filters: { from?: string; to?: string; status?: string },
): GuestAuditSessionList {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.from) {
    where.push('s.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('s.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.status) {
    where.push('s.status = ?');
    binds.push(filters.status);
  }
  const rows = sql
    .exec(
      `SELECT ${SESSION_COLS.split(',')
        .map((c) => `s.${c.trim()}`)
        .join(', ')},
        (SELECT COUNT(*) FROM housekeeping_guest_audit_line l WHERE l.session_id = s.session_id) AS room_count,
        (SELECT COUNT(*) FROM housekeeping_guest_audit_line l
           WHERE l.session_id = s.session_id AND l.hk_adults IS NOT NULL) AS counted_count,
        (SELECT COUNT(*) FROM housekeeping_guest_audit_line l
           WHERE l.session_id = s.session_id AND l.hk_adults IS NOT NULL
             AND (l.hk_adults <> l.fo_adults OR l.hk_children <> l.fo_children)) AS variance_count
       FROM housekeeping_guest_audit_session s
       WHERE ${where.join(' AND ')}
       ORDER BY s.business_date DESC, s.started_at DESC, s.session_id LIMIT ?`,
      ...binds,
      HK_AUDITS_LIST_MAX + 1,
    )
    .toArray() as Array<SessionDbRow & { room_count: number; counted_count: number; variance_count: number }>;
  return {
    ok: true,
    sessions: rows.slice(0, HK_AUDITS_LIST_MAX).map((r) => ({
      ...mapSession(r),
      roomCount: Number(r.room_count),
      countedCount: Number(r.counted_count),
      varianceCount: Number(r.variance_count),
    })),
    truncated: rows.length > HK_AUDITS_LIST_MAX,
  };
}

export type StartGuestAuditInput = {
  businessDate: string;
  notes?: string | null;
  /** The property's business date when it is set; a session can only start for that date. */
  today: string | null;
  actorRef: string;
};

export function startGuestAudit(
  ctx: ModuleTxnCtx,
  input: StartGuestAuditInput,
): { ok: true; detail: GuestAuditDetail } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  if (input.today !== null && input.businessDate !== input.today) {
    throw new HousekeepingInvalidRequestError();
  }
  const notes = optionalText(input.notes, HK_AUDIT_NOTES_MAX) ?? null;
  const open = ctx.sql
    .exec(
      `SELECT session_id FROM housekeeping_guest_audit_session WHERE business_date = ? AND status = 'open'`,
      input.businessDate,
    )
    .toArray();
  if (open.length > 0) throw new HousekeepingAuditSessionOpenError();

  const sessionId = `gas_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_guest_audit_session (session_id, business_date, status, started_by, started_at, notes)
     VALUES (?, ?, 'open', ?, ?, ?)`,
    sessionId,
    input.businessDate,
    input.actorRef,
    now,
    notes,
  );
  // Front-office counts: the adults and children of every checked-in stay, summed per room.
  const occupied = ctx.sql
    .exec(
      `SELECT room_id, SUM(adults) AS adults, SUM(children) AS children
       FROM reservation WHERE status = 'checked_in' AND room_id IS NOT NULL
       GROUP BY room_id`,
    )
    .toArray() as Array<{ room_id: string; adults: number; children: number }>;
  for (const row of occupied) {
    ctx.sql.exec(
      `INSERT INTO housekeeping_guest_audit_line (line_id, session_id, room_id, fo_adults, fo_children)
       VALUES (?, ?, ?, ?, ?)`,
      `gal_${crypto.randomUUID()}`,
      sessionId,
      row.room_id,
      Number(row.adults),
      Number(row.children),
    );
  }
  return { ok: true as const, detail: readGuestAudit(ctx.sql, sessionId) };
}

export function recordGuestAuditCount(
  ctx: ModuleTxnCtx,
  input: { sessionId: string; lines: GuestAuditCountInput[]; actorRef: string },
): { ok: true; detail: GuestAuditDetail; before: GuestAuditDetail } {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new HousekeepingInvalidRequestError();
  if (input.lines.length > HK_AUDIT_COUNT_LINES_MAX) throw new HousekeepingLimitError();
  const session = loadSession(ctx.sql, input.sessionId);
  if (!session) throw new HousekeepingRecordNotFoundError();
  if (session.status !== 'open') throw new HousekeepingInvalidRequestError();
  const before = readGuestAudit(ctx.sql, input.sessionId);
  const byRoom = new Map(before.lines.map((l) => [l.roomId, l]));

  const seen = new Set<string>();
  const now = Date.now();
  for (const raw of input.lines) {
    const line = raw as GuestAuditCountInput | null;
    if (
      !line ||
      typeof line.roomId !== 'string' ||
      seen.has(line.roomId) ||
      !Number.isInteger(line.adults) ||
      !Number.isInteger(line.children) ||
      line.adults < 0 ||
      line.children < 0 ||
      line.adults > HK_AUDIT_COUNT_MAX ||
      line.children > HK_AUDIT_COUNT_MAX
    ) {
      throw new HousekeepingInvalidRequestError();
    }
    seen.add(line.roomId);
    const existing = byRoom.get(line.roomId);
    if (!existing) throw new HousekeepingInvalidRequestError();
    const reason = optionalText(line.varianceReason, HK_AUDIT_REASON_MAX) ?? null;
    const evidence = optionalText(line.evidenceNote, HK_AUDIT_EVIDENCE_MAX) ?? null;
    const differs = guestAuditLineDiffers({
      frontOfficeAdults: existing.frontOfficeAdults,
      frontOfficeChildren: existing.frontOfficeChildren,
      housekeepingAdults: line.adults,
      housekeepingChildren: line.children,
    });
    if (differs && !reason) throw new HousekeepingReasonRequiredError();

    ctx.sql.exec(
      `UPDATE housekeeping_guest_audit_line
       SET hk_adults = ?, hk_children = ?, variance_reason = ?, evidence_note = ?, counted_by = ?, counted_at = ?
       WHERE line_id = ?`,
      line.adults,
      line.children,
      reason,
      evidence,
      input.actorRef,
      now,
      existing.lineId,
    );
    ctx.sql.exec(
      `INSERT INTO housekeeping_guest_audit_line_event (
         event_id, line_id, session_id, room_id, adults, children, variance_reason, evidence_note, actor, at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `gae_${crypto.randomUUID()}`,
      existing.lineId,
      input.sessionId,
      line.roomId,
      line.adults,
      line.children,
      reason,
      evidence,
      input.actorRef,
      now,
    );
  }
  return { ok: true as const, detail: readGuestAudit(ctx.sql, input.sessionId), before };
}

export function closeGuestAudit(
  ctx: ModuleTxnCtx,
  input: { sessionId: string; notes?: string | null; actorRef: string },
): { ok: true; detail: GuestAuditDetail; before: GuestAuditDetail } {
  const session = loadSession(ctx.sql, input.sessionId);
  if (!session) throw new HousekeepingRecordNotFoundError();
  if (session.status !== 'open') throw new HousekeepingInvalidRequestError();
  const notes = optionalText(input.notes, HK_AUDIT_NOTES_MAX);
  const before = readGuestAudit(ctx.sql, input.sessionId);
  for (const line of before.lines) {
    // Uncounted rooms, or a difference with no reason, keep the session open.
    if (line.housekeepingAdults === null || line.housekeepingChildren === null) {
      throw new HousekeepingInvalidRequestError();
    }
    if (guestAuditLineDiffers(line) && !line.varianceReason) throw new HousekeepingInvalidRequestError();
  }
  ctx.sql.exec(
    `UPDATE housekeeping_guest_audit_session SET status = 'closed', closed_by = ?, closed_at = ?, notes = ?
     WHERE session_id = ?`,
    input.actorRef,
    Date.now(),
    notes === undefined ? session.notes : notes,
    input.sessionId,
  );
  return { ok: true as const, detail: readGuestAudit(ctx.sql, input.sessionId), before };
}
