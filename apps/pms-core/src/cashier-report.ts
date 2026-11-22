import type { SqlStorageLike } from '@hospai/do-runtime';
import {
  LIMIT_EXCEEDED,
  NOT_FOUND,
  REPORT_ROW_CAP,
  reportDefinition,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
  type ReportStay,
} from '@hospai/contracts';
import { reservationConfirmation } from './front-office-report.js';

/**
 * Cashier and financial operational reports (R4.14 Part B). Pure reads over the folio ledger
 * (`folio_line.ledger_amount_minor`, always in the ledger currency), payments, shifts, invoices,
 * holds, city-ledger entries and the audit log. Nothing here posts, converts or rounds: every figure
 * is a sum of amounts that already exist. Guests are `guestRef`s and staff are user ids; the SPA
 * resolves names.
 * Spec: docs/superpowers/specs/2026-11-20-reports-b-cashier-financial-design.md
 */

type TenderTotals = { cardMinor: number; upiMinor: number; cashMinor?: number };

/** What the PropertyDO lends the reads: the shift and folio helpers stay private to the DO. */
export type CashierReportDeps = {
  sql: SqlStorageLike;
  businessDate: string;
  currency: string;
  /** Property-local calendar date of an instant (the folio screen's date for a line with no business date). */
  dateOfInstant(ms: number): string;
  guestWindowId(reservationId: string): string;
  /** `windowBalanceMinorSync` */
  windowBalanceMinor(folioWindowId: string): number;
  /** `netAdvancePaidMinor` over the window's PAYMENT lines (the proforma rule). */
  advancePaidMinor(folioWindowId: string): number;
  /** The shift read's tender totals: an OPEN shift omits cash (blind count). */
  shiftTenderTotals(shiftId: string, status: string): TenderTotals;
  /** The shift close's expected cash: opening float plus captured cash. */
  shiftExpectedCash(shiftId: string, openingFloat: number): number;
};

export type CashierReportResult =
  | ReportResponse
  | { ok: false; error: typeof LIMIT_EXCEEDED; limit: 'rows'; max: number }
  | { ok: false; error: typeof NOT_FOUND };

type Built = { rows: ReportRow[]; totals: ReportRow | null; stay?: ReportStay };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const TENDER_WORD: Record<string, string> = { CARD: 'Card', CASH: 'Cash', UPI: 'UPI' };
const tenderWord = (t: string | null | undefined): string => (t ? (TENDER_WORD[t] ?? t) : '');
const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');
const SHIFT_WORD: Record<string, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  FORCE_CLOSED: 'Force closed',
};

/** Operator words for a folio window (the folio screen's wording). */
export function windowWord(kind: string, billedParty: string | null): string {
  if (kind === 'GUEST') return 'Guest';
  if (kind === 'COMPANY') {
    const name = billedParty?.trim();
    return name ? `Company · ${name}` : 'Company';
  }
  if (kind === 'MASTER') return 'Master';
  return 'Other';
}

const WINDOW_RANK: Record<string, number> = { GUEST: 0, COMPANY: 1, MASTER: 2 };

// ---------------------------------------------------------------------------------------------
// The folio ledger, loaded once per run
// ---------------------------------------------------------------------------------------------

export type Line = {
  seq: number;
  id: string;
  windowId: string;
  windowKind: string;
  billedParty: string | null;
  reservationId: string;
  code: string;
  ledger: number;
  source: string | null;
  businessDate: string | null;
  createdAt: number;
  paymentId: string | null;
  taxOf: string | null;
  splitOf: string | null;
  externalReference: string | null;
  /** Report date: the business date, else (tax children) the parent's, else the local date of `createdAt`. */
  date: string;
  tax: boolean;
};

export type Ledger = {
  lines: Line[];
  byId: Map<string, Line>;
};

const REVERSAL_SOURCES = new Set(['SPLIT_REVERSAL', 'TRANSFER_REVERSAL']);

/** What the ledger load needs from the caller: the report deps, or the night audit's own reads. */
export type LedgerDeps = Pick<CashierReportDeps, 'sql' | 'dateOfInstant'>;

/** Every folio line, each with its report date and tax flag: the one ledger every report and the journal read. */
export function loadLedger(deps: LedgerDeps): Ledger {
  const raw = deps.sql
    .exec(
      `SELECT fl.rowid AS seq, fl.folio_line_id, fl.folio_window_id, fw.kind AS window_kind,
              fw.billed_party, fl.reservation_id, fl.charge_code, fl.ledger_amount_minor,
              fl.source, fl.business_date, fl.created_at, fl.payment_id, fl.tax_of, fl.split_of,
              fl.external_reference
         FROM folio_line fl
         JOIN folio_window fw ON fw.folio_window_id = fl.folio_window_id
        ORDER BY fl.rowid`,
    )
    .toArray() as Array<{
    seq: number;
    folio_line_id: string;
    folio_window_id: string;
    window_kind: string;
    billed_party: string | null;
    reservation_id: string;
    charge_code: string;
    ledger_amount_minor: number;
    source: string | null;
    business_date: string | null;
    created_at: number;
    payment_id: string | null;
    tax_of: string | null;
    split_of: string | null;
    external_reference: string | null;
  }>;
  const lines: Line[] = raw.map((r) => ({
    seq: Number(r.seq),
    id: r.folio_line_id,
    windowId: r.folio_window_id,
    windowKind: r.window_kind,
    billedParty: r.billed_party,
    reservationId: r.reservation_id,
    code: r.charge_code,
    ledger: Number(r.ledger_amount_minor),
    source: r.source,
    businessDate: r.business_date,
    createdAt: Number(r.created_at),
    paymentId: r.payment_id,
    taxOf: r.tax_of,
    splitOf: r.split_of,
    externalReference: r.external_reference,
    date: '',
    tax: false,
  }));
  const byId = new Map(lines.map((l) => [l.id, l]));
  // A tax line is a tax child, or the reversal (split / transfer) of one.
  for (const l of lines) {
    l.tax =
      l.taxOf != null ||
      (l.source != null &&
        REVERSAL_SOURCES.has(l.source) &&
        l.splitOf != null &&
        byId.get(l.splitOf)?.taxOf != null);
  }
  for (const l of lines) {
    l.date = l.businessDate ?? deps.dateOfInstant(l.createdAt);
  }
  // Tax children sit on their parent's date, as the folio screen shows them.
  for (const l of lines) {
    if (l.taxOf == null) continue;
    const parent = byId.get(l.taxOf);
    if (parent && l.businessDate == null) l.date = parent.date;
  }
  return { lines, byId };
}

/**
 * The tender of a PAYMENT line. A refund or chargeback line carries no payment id: its tender is the
 * original capture line's, found through `splitOf` (at most three hops). Null when none resolves.
 * The journal and the day statistics share this rule.
 */
export function tenderOfLine(
  line: Pick<Line, 'paymentId' | 'splitOf'>,
  byId: ReadonlyMap<string, Pick<Line, 'paymentId' | 'splitOf'>>,
  payments: ReadonlyMap<string, { tender: string }>,
): string | null {
  let cur: Pick<Line, 'paymentId' | 'splitOf'> | undefined = line;
  for (let hop = 0; cur !== undefined && hop < 3; hop++) {
    const tender = cur.paymentId ? payments.get(cur.paymentId)?.tender : undefined;
    if (tender) return tender;
    cur = cur.splitOf ? byId.get(cur.splitOf) : undefined;
  }
  return null;
}

type Column = 'charges' | 'taxes' | 'payments' | 'adjustments' | 'transfers';
const ADJUSTMENT_CODES = new Set(['DISCOUNT', 'FX_GAIN', 'FX_LOSS', 'CHARGEBACK_FEE']);

/**
 * The one movement column a ledger line belongs to. Every line lands in exactly one, so
 * opening + movements = closing by construction:
 *   payments    - charge code PAYMENT (payments, refunds, chargeback reversals)
 *   taxes       - tax children and the reversals of them
 *   transfers   - TRANSFER and TRANSFER_REVERSAL legs (net zero inside the combined ledger)
 *   adjustments - DISCOUNT, FX gain / loss and chargeback fee lines
 *   charges     - everything else (room, misc, fees, damage, split reversals and their parts)
 */
export function movementColumn(l: {
  code: string;
  source: string | null;
  tax: boolean;
}): Column {
  if (l.code === 'PAYMENT') return 'payments';
  if (l.tax) return 'taxes';
  if (l.source === 'TRANSFER' || l.source === 'TRANSFER_REVERSAL') return 'transfers';
  if (ADJUSTMENT_CODES.has(l.code)) return 'adjustments';
  return 'charges';
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

export type PaymentInfo = {
  paymentId: string;
  reservationId: string;
  amountMinor: number;
  currency: string;
  tender: string;
  shiftId: string | null;
  externalReference: string | null;
};

export function loadPayments(deps: Pick<CashierReportDeps, 'sql'>): Map<string, PaymentInfo> {
  const rows = deps.sql
    .exec(
      `SELECT payment_id, reservation_id, amount_minor, currency, tender_type, shift_id, external_reference
         FROM payment`,
    )
    .toArray() as Array<{
    payment_id: string;
    reservation_id: string;
    amount_minor: number;
    currency: string;
    tender_type: string;
    shift_id: string | null;
    external_reference: string | null;
  }>;
  return new Map(
    rows.map((r) => [
      r.payment_id,
      {
        paymentId: r.payment_id,
        reservationId: r.reservation_id,
        amountMinor: Number(r.amount_minor),
        currency: r.currency,
        tender: r.tender_type,
        shiftId: r.shift_id,
        externalReference: r.external_reference,
      },
    ]),
  );
}

type StayInfo = {
  reservationId: string;
  guestRef: string;
  status: string;
  arrival: string;
  departure: string;
  room: string | null;
  roomType: string | null;
};

const STAY_SQL = `SELECT r.reservation_id, r.guest_ref, r.status, r.arrival_date, r.departure_date,
        rm.code AS room_code, COALESCE(rt_alloc.name, rt_book.name) AS room_type_name
   FROM reservation r
   LEFT JOIN room rm ON rm.room_id = r.room_id
   LEFT JOIN room_type rt_alloc ON rt_alloc.room_type_id = r.allocated_room_type_id
   LEFT JOIN room_type rt_book ON rt_book.room_type_id = r.room_type_id`;

type StayRow = {
  reservation_id: string;
  guest_ref: string;
  status: string;
  arrival_date: string;
  departure_date: string;
  room_code: string | null;
  room_type_name: string | null;
};

const stayOf = (r: StayRow): StayInfo => ({
  reservationId: r.reservation_id,
  guestRef: r.guest_ref,
  status: r.status,
  arrival: r.arrival_date,
  departure: r.departure_date,
  room: r.room_code,
  roomType: r.room_type_name,
});

function stayLookup(deps: CashierReportDeps): (reservationId: string | null) => StayInfo | null {
  const cache = new Map<string, StayInfo | null>();
  return (id) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id)!;
    const rows = deps.sql.exec(`${STAY_SQL} WHERE r.reservation_id = ?`, id).toArray() as StayRow[];
    const info = rows[0] ? stayOf(rows[0]) : null;
    cache.set(id, info);
    return info;
  };
}

/** Charge code to operator name, for reports that show a category (cashier and night-audit reports). */
export function chargeCodeNames(deps: { sql: SqlStorageLike }): Map<string, string> {
  const rows = deps.sql.exec(`SELECT code, name FROM charge_code`).toArray() as Array<{
    code: string;
    name: string;
  }>;
  return new Map(rows.map((r) => [r.code, r.name]));
}

type AuditEvent = {
  seq: number;
  at: number;
  actor: string;
  commandId: string;
  entityId: string;
  after: Record<string, unknown>;
  shiftId: string | null;
  reservationId: string | null;
};

function readAudit(deps: CashierReportDeps, commandIds: readonly string[]): AuditEvent[] {
  const rows = deps.sql
    .exec(
      `SELECT seq, at, actor, command_id, entity_id, after_json, shift_id, reservation_id
         FROM audit_log
        WHERE command_id IN (${commandIds.map(() => '?').join(', ')})
        ORDER BY seq`,
      ...commandIds,
    )
    .toArray() as Array<{
    seq: number;
    at: number;
    actor: string;
    command_id: string;
    entity_id: string;
    after_json: string;
    shift_id: string | null;
    reservation_id: string | null;
  }>;
  return rows.map((r) => {
    let after: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(r.after_json) as unknown;
      if (parsed && typeof parsed === 'object') after = parsed as Record<string, unknown>;
    } catch {
      /* an unreadable payload reads as empty */
    }
    return {
      seq: Number(r.seq),
      at: Number(r.at),
      actor: r.actor,
      commandId: r.command_id,
      entityId: r.entity_id,
      after,
      shiftId: r.shift_id,
      reservationId: r.reservation_id,
    };
  });
}

function shiftOpenedAtMap(deps: CashierReportDeps): Map<string, number> {
  const rows = deps.sql.exec(`SELECT shift_id, opened_at FROM shift`).toArray() as Array<{
    shift_id: string;
    opened_at: number;
  }>;
  return new Map(rows.map((r) => [r.shift_id, Number(r.opened_at)]));
}

// ---------------------------------------------------------------------------------------------
// 1. Cashier summary
// ---------------------------------------------------------------------------------------------

function buildCashierSummary(deps: CashierReportDeps, p: { from: string; to: string }): Built | null {
  const shifts = deps.sql
    .exec(
      `SELECT shift_id, cashier_user_id, business_date, opened_at, closed_at, opening_float,
              closing_count, variance, status
         FROM shift
        WHERE business_date >= ? AND business_date <= ?
        ORDER BY opened_at, shift_id
        LIMIT ?`,
      p.from,
      p.to,
      REPORT_ROW_CAP + 1,
    )
    .toArray() as Array<{
    shift_id: string;
    cashier_user_id: string;
    business_date: string;
    opened_at: number;
    closed_at: number | null;
    opening_float: number;
    closing_count: number | null;
    variance: number | null;
    status: string;
  }>;
  if (shifts.length > REPORT_ROW_CAP) return null;
  const sums = {
    openingFloat: 0,
    expectedCash: 0,
    countedCash: 0,
    variance: 0,
    cash: 0,
    card: 0,
    upi: 0,
  };
  const rows = shifts.map((s) => {
    const tender = deps.shiftTenderTotals(s.shift_id, s.status);
    const open = s.status === 'OPEN';
    // An open shift keeps its cash hidden (blind count), here as on the shift screen.
    const cash = open ? null : (tender.cashMinor ?? 0);
    const expected = open ? null : deps.shiftExpectedCash(s.shift_id, Number(s.opening_float));
    sums.openingFloat += Number(s.opening_float);
    if (expected !== null) sums.expectedCash += expected;
    if (s.closing_count !== null) sums.countedCash += Number(s.closing_count);
    if (s.variance !== null) sums.variance += Number(s.variance);
    if (cash !== null) sums.cash += cash;
    sums.card += tender.cardMinor;
    sums.upi += tender.upiMinor;
    return {
      cashier: s.cashier_user_id,
      businessDate: s.business_date,
      status: SHIFT_WORD[s.status] ?? s.status,
      openedAt: Number(s.opened_at),
      closedAt: s.closed_at === null ? null : Number(s.closed_at),
      openingFloat: Number(s.opening_float),
      expectedCash: expected,
      countedCash: s.closing_count === null ? null : Number(s.closing_count),
      variance: s.variance === null ? null : Number(s.variance),
      cash,
      card: tender.cardMinor,
      upi: tender.upiMinor,
    };
  });
  return { rows, totals: sums };
}

// ---------------------------------------------------------------------------------------------
// 2. Cashier audit and 3. corrections (both read the audit log, with amounts from the ledger)
// ---------------------------------------------------------------------------------------------

const PAYMENT_RECEIVED_COMMANDS = new Set([
  'folio.capture',
  'folio.record_cash_payment',
  'folio.record_upi_payment',
]);

/** Refund lines of a payment, oldest first (`<payment>:refund:<n>`). */
function refundLinesByPayment(ledger: Ledger): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const l of ledger.lines) {
    if (l.source !== 'PAYMENT_REFUND' || l.splitOf == null) continue;
    const capture = ledger.byId.get(l.splitOf);
    const paymentId = capture?.paymentId ?? l.id.split(':refund:')[0]!;
    const list = out.get(paymentId) ?? [];
    list.push(l);
    out.set(paymentId, list);
  }
  return out;
}

function captureLineByPayment(ledger: Ledger): Map<string, Line> {
  const out = new Map<string, Line>();
  for (const l of ledger.lines) {
    if (l.source === 'PAYMENT' && l.paymentId != null && !out.has(l.paymentId)) out.set(l.paymentId, l);
  }
  return out;
}

type PaymentSideEvent = {
  at: number;
  seq: number;
  date: string;
  actor: string;
  shiftId: string | null;
  kind: 'received' | 'refund' | 'hold' | 'voided' | 'discount';
  payment: PaymentInfo | null;
  reservationId: string | null;
  /** Ledger-currency amount, signed as cash moves (received +, refund -); null when unknown. */
  amount: number | null;
  reference: string | null;
  reason: string | null;
};

/** Payment-side events from the audit log, each joined to its ledger line for the amount. */
function paymentSideEvents(deps: CashierReportDeps, ledger: Ledger): PaymentSideEvent[] {
  const audit = readAudit(deps, [
    'folio.authorize',
    'folio.capture',
    'folio.record_cash_payment',
    'folio.record_upi_payment',
    'folio.refund',
    'folio.void',
    'folio.post_discount',
  ]);
  const payments = loadPayments(deps);
  const captures = captureLineByPayment(ledger);
  const refunds = refundLinesByPayment(ledger);
  const refundSeen = new Map<string, number>();
  const events: PaymentSideEvent[] = [];
  for (const a of audit) {
    const payment = payments.get(a.entityId) ?? null;
    const sameCurrency = payment !== null && payment.currency === deps.currency;
    if (PAYMENT_RECEIVED_COMMANDS.has(a.commandId)) {
      const line = captures.get(a.entityId);
      events.push({
        at: a.at,
        seq: a.seq,
        date: line?.date ?? deps.dateOfInstant(a.at),
        actor: a.actor,
        shiftId: a.shiftId ?? payment?.shiftId ?? null,
        kind: 'received',
        payment,
        reservationId: a.reservationId ?? payment?.reservationId ?? null,
        amount: line ? -line.ledger : null,
        reference: payment?.externalReference ?? null,
        reason: null,
      });
    } else if (a.commandId === 'folio.refund') {
      const n = refundSeen.get(a.entityId) ?? 0;
      refundSeen.set(a.entityId, n + 1);
      const line = refunds.get(a.entityId)?.[n];
      events.push({
        at: a.at,
        seq: a.seq,
        date: line?.date ?? deps.dateOfInstant(a.at),
        actor: a.actor,
        // A refund is not attributed to a shift.
        shiftId: a.shiftId,
        kind: 'refund',
        payment,
        reservationId: a.reservationId ?? payment?.reservationId ?? null,
        amount: line ? -line.ledger : null,
        reference: line?.externalReference ?? null,
        reason: null,
      });
    } else if (a.commandId === 'folio.authorize') {
      events.push({
        at: a.at,
        seq: a.seq,
        date: deps.dateOfInstant(a.at),
        actor: a.actor,
        shiftId: a.shiftId ?? payment?.shiftId ?? null,
        kind: 'hold',
        payment,
        reservationId: a.reservationId ?? payment?.reservationId ?? null,
        amount: sameCurrency ? payment!.amountMinor : null,
        reference: null,
        reason: null,
      });
    } else if (a.commandId === 'folio.void') {
      events.push({
        at: a.at,
        seq: a.seq,
        date: deps.dateOfInstant(a.at),
        actor: a.actor,
        shiftId: a.shiftId,
        kind: 'voided',
        payment,
        reservationId: a.reservationId ?? payment?.reservationId ?? null,
        amount: sameCurrency ? payment!.amountMinor : null,
        reference: null,
        reason: a.after.automated === true ? 'Hold lapsed and was released automatically' : null,
      });
    } else if (a.commandId === 'folio.post_discount') {
      const line = ledger.byId.get(a.entityId);
      events.push({
        at: a.at,
        seq: a.seq,
        date: line?.date ?? deps.dateOfInstant(a.at),
        actor: a.actor,
        shiftId: null,
        kind: 'discount',
        payment: null,
        reservationId: a.reservationId ?? line?.reservationId ?? null,
        amount: line ? line.ledger : null,
        reference: null,
        reason: typeof a.after.reason === 'string' ? a.after.reason : null,
      });
    }
  }
  return events;
}

const AUDIT_KIND_WORD: Record<string, string> = {
  received: 'Payment received',
  refund: 'Refund',
  hold: 'Card hold placed',
  voided: 'Card hold voided',
};

function buildCashierAudit(
  deps: CashierReportDeps,
  ledger: Ledger,
  p: { from: string; to: string; tender?: string; cashier?: string },
): Built | null {
  const stay = stayLookup(deps);
  const opened = shiftOpenedAtMap(deps);
  const events = paymentSideEvents(deps, ledger)
    .filter((e) => e.kind !== 'discount')
    .filter((e) => e.date >= p.from && e.date <= p.to)
    .filter((e) => (p.tender ? e.payment?.tender === p.tender : true))
    .filter((e) => (p.cashier ? e.actor === p.cashier : true))
    .sort((a, b) => a.at - b.at || a.seq - b.seq);
  if (events.length > REPORT_ROW_CAP) return null;
  let net = 0;
  const rows = events.map((e) => {
    if ((e.kind === 'received' || e.kind === 'refund') && e.amount !== null) net += e.amount;
    const s = stay(e.reservationId);
    return {
      at: e.at,
      businessDate: e.date,
      cashier: e.actor,
      shiftOpenedAt: e.shiftId ? (opened.get(e.shiftId) ?? null) : null,
      tender: tenderWord(e.payment?.tender),
      kind: AUDIT_KIND_WORD[e.kind] ?? e.kind,
      amount: e.amount,
      reservation: e.reservationId ? reservationConfirmation(e.reservationId) : null,
      guest: s?.guestRef ?? null,
      reference: e.reference,
    };
  });
  return { rows, totals: { amount: net } };
}

function buildCorrections(
  deps: CashierReportDeps,
  ledger: Ledger,
  p: { from: string; to: string },
): Built | null {
  const stay = stayLookup(deps);
  type Row = { at: number; seq: number; row: ReportRow };
  const out: Row[] = [];
  const push = (
    at: number,
    seq: number,
    kind: string,
    actor: string,
    reservationId: string | null,
    amount: number | null,
    reason: string | null,
    reference: string | null,
  ) => {
    const s = stay(reservationId);
    out.push({
      at,
      seq,
      row: {
        kind,
        at,
        actor,
        reservation: reservationId ? reservationConfirmation(reservationId) : null,
        guest: s?.guestRef ?? null,
        amount,
        reason,
        reference,
      },
    });
  };
  for (const e of paymentSideEvents(deps, ledger)) {
    if (e.date < p.from || e.date > p.to) continue;
    if (e.kind === 'voided') {
      push(e.at, e.seq, 'Payment voided', e.actor, e.reservationId, e.amount, e.reason, tenderWord(e.payment?.tender) || null);
    } else if (e.kind === 'refund') {
      push(e.at, e.seq, 'Refund', e.actor, e.reservationId, e.amount, null, e.reference);
    } else if (e.kind === 'discount') {
      push(e.at, e.seq, 'Discount', e.actor, e.reservationId, e.amount, e.reason, null);
    }
  }
  const invoices = readAudit(deps, ['invoice.void']);
  for (const a of invoices) {
    const date = deps.dateOfInstant(a.at);
    if (date < p.from || date > p.to) continue;
    const inv = deps.sql
      .exec(`SELECT invoice_number, reservation_id FROM invoice WHERE invoice_id = ?`, a.entityId)
      .toArray() as Array<{ invoice_number: string; reservation_id: string }>;
    push(
      a.at,
      a.seq,
      'Invoice voided',
      a.actor,
      a.reservationId ?? inv[0]?.reservation_id ?? null,
      null,
      typeof a.after.reason === 'string' ? a.after.reason : null,
      inv[0]?.invoice_number ?? null,
    );
  }
  for (const a of readAudit(deps, ['reservations.undo_check_out'])) {
    const date = deps.dateOfInstant(a.at);
    if (date < p.from || date > p.to) continue;
    push(
      a.at,
      a.seq,
      'Check-out undone',
      a.actor,
      a.reservationId ?? a.entityId,
      null,
      typeof a.after.reason === 'string' ? a.after.reason : null,
      null,
    );
  }
  out.sort((x, y) => x.at - y.at || x.seq - y.seq);
  if (out.length > REPORT_ROW_CAP) return null;
  return { rows: out.map((o) => o.row), totals: null };
}

// ---------------------------------------------------------------------------------------------
// 4. Deposit activity, 5. Deposit ledger
// ---------------------------------------------------------------------------------------------

function buildDepositActivity(
  deps: CashierReportDeps,
  ledger: Ledger,
  p: { from: string; to: string },
): Built | null {
  const stay = stayLookup(deps);
  const payments = loadPayments(deps);
  const firstCheckIn = new Map<string, number>();
  for (const a of readAudit(deps, ['reservations.check_in'])) {
    const id = a.reservationId ?? a.entityId;
    if (!firstCheckIn.has(id)) firstCheckIn.set(id, a.at);
  }
  // Received before the stay checked in; a stay checked in with no record of when counts a payment
  // dated before its arrival.
  const preArrival = (line: Line): boolean => {
    const s = stay(line.reservationId);
    if (!s) return false;
    const at = firstCheckIn.get(line.reservationId);
    if (at !== undefined) return line.createdAt < at;
    if (s.status === 'checked_in' || s.status === 'checked_out') return line.date < s.arrival;
    return true;
  };
  const candidates = ledger.lines
    .filter(
      (l) =>
        l.windowKind === 'GUEST' &&
        l.code === 'PAYMENT' &&
        (l.source === 'PAYMENT' || l.source === 'PAYMENT_REFUND') &&
        l.date >= p.from &&
        l.date <= p.to,
    )
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt || a.seq - b.seq : a.date < b.date ? -1 : 1));
  const rows: ReportRow[] = [];
  let net = 0;
  for (const l of candidates) {
    const capture = l.source === 'PAYMENT_REFUND' && l.splitOf ? ledger.byId.get(l.splitOf) : l;
    if (!capture || !preArrival(capture)) continue;
    const payment = capture.paymentId ? payments.get(capture.paymentId) : undefined;
    const s = stay(l.reservationId);
    const amount = -l.ledger;
    net += amount;
    rows.push({
      date: l.date,
      kind: l.source === 'PAYMENT_REFUND' ? 'Advance refunded' : 'Advance received',
      reservation: reservationConfirmation(l.reservationId),
      guest: s?.guestRef ?? null,
      arrival: s?.arrival ?? null,
      tender: tenderWord(payment?.tender),
      amount,
    });
  }
  if (rows.length > REPORT_ROW_CAP) return null;
  return { rows, totals: { amount: net } };
}

function buildDepositLedger(deps: CashierReportDeps, date: string): Built | null {
  const stays = deps.sql
    .exec(
      `${STAY_SQL}
        WHERE r.status IN ('pending', 'confirmed') AND r.arrival_date > ?
        ORDER BY r.arrival_date, r.reservation_id`,
      date,
    )
    .toArray() as StayRow[];
  const rows: ReportRow[] = [];
  let total = 0;
  for (const r of stays) {
    const advance = deps.advancePaidMinor(deps.guestWindowId(r.reservation_id));
    if (advance <= 0) continue;
    total += advance;
    rows.push({
      reservation: reservationConfirmation(r.reservation_id),
      guest: r.guest_ref,
      arrival: r.arrival_date,
      departure: r.departure_date,
      advance,
    });
  }
  if (rows.length > REPORT_ROW_CAP) return null;
  return { rows, totals: { advance: total } };
}

// ---------------------------------------------------------------------------------------------
// 6. Detailed folio
// ---------------------------------------------------------------------------------------------

function buildDetailedFolio(
  deps: CashierReportDeps,
  ledger: Ledger,
  reservationId: string,
): Built | { notFound: true } | null {
  const stays = deps.sql
    .exec(`${STAY_SQL} WHERE r.reservation_id = ?`, reservationId)
    .toArray() as StayRow[];
  if (!stays[0]) return { notFound: true };
  const s = stayOf(stays[0]);
  const names = chargeCodeNames(deps);
  const payments = loadPayments(deps);
  const nameOf = (code: string) => names.get(code) ?? code;

  const mine = ledger.lines.filter((l) => l.reservationId === reservationId);
  const windows = new Map<string, { kind: string; billedParty: string | null; lines: Line[] }>();
  for (const l of mine) {
    const w = windows.get(l.windowId) ?? { kind: l.windowKind, billedParty: l.billedParty, lines: [] };
    w.lines.push(l);
    windows.set(l.windowId, w);
  }
  // A window with no lines yet still belongs in the statement; it has nothing to show.
  const orderedWindows = [...windows.entries()].sort(
    ([ida, a], [idb, b]) =>
      (WINDOW_RANK[a.kind] ?? 3) - (WINDOW_RANK[b.kind] ?? 3) || (ida < idb ? -1 : ida > idb ? 1 : 0),
  );

  const describe = (l: Line): string => {
    if (l.code === 'PAYMENT') {
      const capture = l.source === 'PAYMENT_REFUND' && l.splitOf ? ledger.byId.get(l.splitOf) : l;
      const tender = capture?.paymentId ? payments.get(capture.paymentId)?.tender : undefined;
      const word = tenderWord(tender);
      if (l.source === 'PAYMENT_REFUND') return `${word ? `${word} ` : ''}refund`.replace(/^./, (c) => c.toUpperCase());
      if (l.source === 'CHARGEBACK') return 'Chargeback';
      return `${word ? `${word} ` : ''}payment`.replace(/^./, (c) => c.toUpperCase());
    }
    if (l.taxOf != null) {
      const parent = ledger.byId.get(l.taxOf);
      return `Tax · ${parent ? nameOf(parent.code) : nameOf(l.code)}`;
    }
    if (l.tax) return `Tax · ${nameOf(l.code)} (reversed)`;
    if (l.source === 'SPLIT_REVERSAL') return `${nameOf(l.code)} · split reversal`;
    if (l.source === 'TRANSFER_REVERSAL') return `${nameOf(l.code)} · moved to another window`;
    if (l.source === 'TRANSFER') return `${nameOf(l.code)} · moved from another window`;
    return nameOf(l.code);
  };

  const rows: ReportRow[] = [];
  const stay = { charge: 0, tax: 0, payment: 0 };
  for (const [, w] of orderedWindows) {
    const label = windowWord(w.kind, w.billedParty);
    const ordered = [...w.lines].sort((a, b) =>
      a.date === b.date ? a.createdAt - b.createdAt || a.seq - b.seq : a.date < b.date ? -1 : 1,
    );
    // Tax children follow their parent line, as the folio screen shows them.
    const children = new Map<string, Line[]>();
    const roots: Line[] = [];
    for (const l of ordered) {
      if (l.taxOf != null && w.lines.some((p) => p.id === l.taxOf)) {
        const list = children.get(l.taxOf) ?? [];
        list.push(l);
        children.set(l.taxOf, list);
      } else {
        roots.push(l);
      }
    }
    const seq: Line[] = [];
    for (const r of roots) {
      seq.push(r);
      seq.push(...(children.get(r.id) ?? []));
    }
    const sub = { charge: 0, tax: 0, payment: 0 };
    let running = 0;
    for (const l of seq) {
      const isPayment = l.code === 'PAYMENT';
      const col = isPayment ? 'payment' : l.tax ? 'tax' : 'charge';
      sub[col] += l.ledger;
      running += l.ledger;
      rows.push({
        date: l.date,
        window: label,
        code: nameOf(l.code),
        description: describe(l),
        charge: col === 'charge' ? l.ledger : null,
        tax: col === 'tax' ? l.ledger : null,
        payment: col === 'payment' ? l.ledger : null,
        balance: running,
      });
    }
    stay.charge += sub.charge;
    stay.tax += sub.tax;
    stay.payment += sub.payment;
    if (seq.length > 0) {
      rows.push({
        subtotal: 1,
        date: null,
        window: label,
        code: null,
        description: 'Window total',
        charge: sub.charge,
        tax: sub.tax,
        payment: sub.payment,
        balance: running,
      });
    }
  }
  if (rows.length > REPORT_ROW_CAP) return null;
  return {
    rows,
    totals: {
      description: 'Stay total',
      charge: stay.charge,
      tax: stay.tax,
      payment: stay.payment,
      balance: stay.charge + stay.tax + stay.payment,
    },
    stay: {
      confirmation: reservationConfirmation(s.reservationId),
      guest: s.guestRef,
      arrival: s.arrival,
      departure: s.departure,
      status: s.status,
      room: s.room,
      roomType: s.roomType,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 7. Open-folio register
// ---------------------------------------------------------------------------------------------

function buildOpenFolioRegister(deps: CashierReportDeps, date: string): Built | null {
  const holds = deps.sql
    .exec(
      `SELECT h.hold_id, h.reservation_id, h.folio_window_id, h.status, h.reason, h.follow_up_date,
              h.close_by_date, h.placed_at, h.ended_at,
              r.guest_ref, r.departure_date, rm.code AS room_code
         FROM folio_hold h
         JOIN reservation r ON r.reservation_id = h.reservation_id
         LEFT JOIN room rm ON rm.room_id = r.room_id
        ORDER BY h.close_by_date, h.hold_id`,
    )
    .toArray() as Array<{
    hold_id: string;
    reservation_id: string;
    folio_window_id: string;
    status: string;
    reason: string;
    follow_up_date: string;
    close_by_date: string;
    placed_at: number;
    ended_at: number | null;
    guest_ref: string;
    departure_date: string;
    room_code: string | null;
  }>;
  const active = holds.filter((h) => {
    if (deps.dateOfInstant(Number(h.placed_at)) > date) return false;
    if (h.status === 'ACTIVE') return true;
    return h.ended_at !== null && deps.dateOfInstant(Number(h.ended_at)) > date;
  });
  if (active.length === 0) return { rows: [], totals: { balance: 0 } };
  // The balance as at the end of the date; today's is the live window balance.
  let asOf: Map<string, number> | null = null;
  if (date < deps.businessDate) {
    asOf = new Map();
    for (const l of loadLedger(deps).lines) {
      if (l.date <= date) asOf.set(l.windowId, (asOf.get(l.windowId) ?? 0) + l.ledger);
    }
  }
  let total = 0;
  const rows = active.map((h) => {
    const balance = asOf ? (asOf.get(h.folio_window_id) ?? 0) : deps.windowBalanceMinor(h.folio_window_id);
    total += balance;
    return {
      reservation: reservationConfirmation(h.reservation_id),
      guest: h.guest_ref,
      room: h.room_code,
      departure: h.departure_date,
      reason: h.reason,
      followUp: h.follow_up_date,
      closeBy: h.close_by_date,
      overdue: yesNo(h.close_by_date < date),
      balance,
    };
  });
  if (rows.length > REPORT_ROW_CAP) return null;
  return { rows, totals: { balance: total } };
}

// ---------------------------------------------------------------------------------------------
// 8. Tax report
// ---------------------------------------------------------------------------------------------

function buildTaxReport(
  deps: CashierReportDeps,
  ledger: Ledger,
  p: { from: string; to: string },
): Built | null {
  const names = chargeCodeNames(deps);
  const nameOf = (code: string) => names.get(code) ?? code;
  // Non-tax reversal lines by (original line, source): the reversed parent of a reversed tax line.
  const reversalParents = new Map<string, Line>();
  for (const l of ledger.lines) {
    if (!l.tax && l.source != null && REVERSAL_SOURCES.has(l.source) && l.splitOf != null) {
      reversalParents.set(`${l.splitOf}|${l.source}`, l);
    }
  }
  type Cell = { date: string; code: string; taxable: number; tax: number; parents: Set<string> };
  const cells = new Map<string, Cell>();
  for (const l of ledger.lines) {
    if (!l.tax || l.date < p.from || l.date > p.to) continue;
    let parent: Line | undefined;
    if (l.taxOf != null) {
      parent = ledger.byId.get(l.taxOf);
    } else if (l.splitOf != null && l.source != null) {
      const original = ledger.byId.get(l.splitOf);
      if (original?.taxOf != null) parent = reversalParents.get(`${original.taxOf}|${l.source}`);
    }
    const key = `${l.date}|${l.code}`;
    const cell = cells.get(key) ?? { date: l.date, code: l.code, taxable: 0, tax: 0, parents: new Set() };
    cell.tax += l.ledger;
    if (parent && !cell.parents.has(parent.id)) {
      cell.parents.add(parent.id);
      cell.taxable += parent.ledger;
    }
    cells.set(key, cell);
  }
  const sorted = [...cells.values()]
    .filter((c) => c.tax !== 0 || c.taxable !== 0)
    .sort((a, b) => (a.date === b.date ? (a.code < b.code ? -1 : 1) : a.date < b.date ? -1 : 1));
  const rows: ReportRow[] = sorted.map((c) => ({
    date: c.date,
    taxCode: nameOf(c.code),
    taxable: c.taxable,
    tax: c.tax,
  }));
  // A totals row for each tax, after the dated rows.
  const perCode = new Map<string, { taxable: number; tax: number }>();
  let taxTotal = 0;
  for (const c of sorted) {
    const t = perCode.get(c.code) ?? { taxable: 0, tax: 0 };
    t.taxable += c.taxable;
    t.tax += c.tax;
    perCode.set(c.code, t);
    taxTotal += c.tax;
  }
  for (const [code, t] of [...perCode.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push({ subtotal: 1, date: null, taxCode: `${nameOf(code)} total`, taxable: t.taxable, tax: t.tax });
  }
  if (rows.length > REPORT_ROW_CAP) return null;
  return { rows, totals: { tax: taxTotal } };
}

// ---------------------------------------------------------------------------------------------
// 9. Trial balance, 10. Guest trial balance
// ---------------------------------------------------------------------------------------------

function buildTrialBalance(
  deps: CashierReportDeps,
  ledger: Ledger,
  p: { from: string; to: string },
): Built | null {
  const zero = () => ({ charges: 0, taxes: 0, payments: 0, adjustments: 0, transfers: 0 });
  const byDate = new Map<string, ReturnType<typeof zero>>();
  let opening = 0;
  for (const l of ledger.lines) {
    if (l.date < p.from) {
      opening += l.ledger;
    } else if (l.date <= p.to) {
      const m = byDate.get(l.date) ?? zero();
      m[movementColumn(l)] += l.ledger;
      byDate.set(l.date, m);
    }
  }
  // City ledger entries: a receivable (charge, adjustment) is posted for a COMPANY window with no
  // folio line, so the window keeps its balance. It leaves the guest ledger here, as a transfer to
  // the city ledger dated by the entry's business date, so the two sections never count it twice.
  const entries = deps.sql
    .exec(`SELECT kind, amount_minor, business_date FROM city_ledger_entry`)
    .toArray() as Array<{ kind: string; amount_minor: number; business_date: string }>;
  let arOpening = 0;
  let receivablesBefore = 0;
  const arByDate = new Map<string, { receivables: number; settlements: number }>();
  for (const e of entries) {
    const amount = Number(e.amount_minor);
    const signed = e.kind === 'payment' ? -amount : amount;
    if (e.business_date < p.from) {
      arOpening += signed;
      if (e.kind !== 'payment') receivablesBefore += amount;
    } else if (e.business_date <= p.to) {
      const cell = arByDate.get(e.business_date) ?? { receivables: 0, settlements: 0 };
      if (e.kind === 'payment') cell.settlements += amount;
      else cell.receivables += amount;
      arByDate.set(e.business_date, cell);
    }
  }
  const rows: ReportRow[] = [];
  let running = opening - receivablesBefore;
  for (const d of dateRange(p.from, p.to)) {
    const m = byDate.get(d) ?? zero();
    m.transfers -= arByDate.get(d)?.receivables ?? 0;
    const closing = running + m.charges + m.taxes + m.payments + m.adjustments + m.transfers;
    rows.push({
      section: 'Guest ledger',
      date: d,
      opening: running,
      charges: m.charges,
      taxes: m.taxes,
      payments: m.payments,
      adjustments: m.adjustments,
      transfers: m.transfers,
      closing,
    });
    running = closing;
  }
  let arRunning = arOpening;
  for (const d of dateRange(p.from, p.to)) {
    const cell = arByDate.get(d) ?? { receivables: 0, settlements: 0 };
    const closing = arRunning + cell.receivables - cell.settlements;
    rows.push({
      section: 'City ledger',
      date: d,
      opening: arRunning,
      charges: cell.receivables,
      taxes: null,
      payments: -cell.settlements,
      adjustments: null,
      transfers: null,
      closing,
    });
    arRunning = closing;
  }
  return { rows, totals: null };
}

function buildGuestTrialBalance(deps: CashierReportDeps, ledger: Ledger, date: string): Built | null {
  const balances = new Map<string, { balance: number; line: Line }>();
  for (const l of ledger.lines) {
    if (l.date > date) continue;
    const cur = balances.get(l.windowId);
    if (cur) cur.balance += l.ledger;
    else balances.set(l.windowId, { balance: l.ledger, line: l });
  }
  // A receivable posted to the city ledger for a window has left the guest ledger (see the trial balance).
  const entries = deps.sql
    .exec(
      `SELECT folio_window_id, SUM(amount_minor) AS total FROM city_ledger_entry
        WHERE kind != 'payment' AND folio_window_id IS NOT NULL AND business_date <= ?
        GROUP BY folio_window_id`,
      date,
    )
    .toArray() as Array<{ folio_window_id: string; total: number }>;
  for (const e of entries) {
    const cur = balances.get(e.folio_window_id);
    if (cur) cur.balance -= Number(e.total);
  }
  const open = [...balances.values()].filter((b) => b.balance !== 0);
  if (open.length === 0) return { rows: [], totals: { balance: 0 } };
  const stays = deps.sql.exec(`${STAY_SQL}`).toArray() as StayRow[];
  const stayById = new Map(stays.map((r) => [r.reservation_id, stayOf(r)]));
  const sorted = open.sort((a, b) => {
    const sa = stayById.get(a.line.reservationId);
    const sb = stayById.get(b.line.reservationId);
    const ra = sa?.room ?? '￿';
    const rb = sb?.room ?? '￿';
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (a.line.reservationId !== b.line.reservationId) return a.line.reservationId < b.line.reservationId ? -1 : 1;
    return (WINDOW_RANK[a.line.windowKind] ?? 3) - (WINDOW_RANK[b.line.windowKind] ?? 3);
  });
  let total = 0;
  const rows = sorted.map((b) => {
    const s = stayById.get(b.line.reservationId);
    total += b.balance;
    return {
      reservation: reservationConfirmation(b.line.reservationId),
      guest: s?.guestRef ?? null,
      room: s?.room ?? null,
      status: s?.status ?? null,
      window: windowWord(b.line.windowKind, b.line.billedParty),
      balance: b.balance,
    };
  });
  if (rows.length > REPORT_ROW_CAP) return null;
  return { rows, totals: { balance: total } };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** Fills the business-date defaults the route left open. */
export function resolveCashierParams(
  def: ReportDefinition,
  params: ReportParams,
  businessDate: string,
): ReportParams {
  if (def.params.kind === 'date') return { date: params.date ?? businessDate };
  if (def.params.kind === 'reservation') return { reservationId: params.reservationId ?? '' };
  if (def.params.kind !== 'range') return {};
  const from = params.from ?? businessDate;
  const to = params.to ?? addDays(from, def.params.defaultSpan - 1);
  const out: ReportParams = { from, to };
  if (params.tender) out.tender = params.tender;
  if (params.cashier) out.cashier = params.cashier;
  return out;
}

/** Runs one cashier / financial report; the definition (columns, totals) is the contracts registry's. */
export function readCashierReport(
  deps: CashierReportDeps,
  reportId: string,
  rawParams: ReportParams,
  now: Date = new Date(),
): CashierReportResult {
  const def = reportDefinition(reportId);
  if (!def || def.routeId !== 'get_cashier_report') return { ok: false, error: NOT_FOUND };
  const params = resolveCashierParams(def, rawParams, deps.businessDate);
  const range = { from: params.from ?? '', to: params.to ?? '' };
  const date = params.date ?? deps.businessDate;

  let built: Built | { notFound: true } | null;
  switch (def.id) {
    case 'cashier_summary':
      built = buildCashierSummary(deps, range);
      break;
    case 'cashier_audit':
      built = buildCashierAudit(deps, loadLedger(deps), {
        ...range,
        ...(params.tender ? { tender: params.tender } : {}),
        ...(params.cashier ? { cashier: params.cashier } : {}),
      });
      break;
    case 'cashier_corrections':
      built = buildCorrections(deps, loadLedger(deps), range);
      break;
    case 'cashier_deposit_activity':
      built = buildDepositActivity(deps, loadLedger(deps), range);
      break;
    case 'cashier_deposit_ledger':
      built = buildDepositLedger(deps, date);
      break;
    case 'cashier_detailed_folio':
      built = buildDetailedFolio(deps, loadLedger(deps), params.reservationId ?? '');
      break;
    case 'cashier_open_folio_register':
      built = buildOpenFolioRegister(deps, date);
      break;
    case 'cashier_tax_report':
      built = buildTaxReport(deps, loadLedger(deps), range);
      break;
    case 'cashier_trial_balance':
      built = buildTrialBalance(deps, loadLedger(deps), range);
      break;
    case 'cashier_guest_trial_balance':
      built = buildGuestTrialBalance(deps, loadLedger(deps), date);
      break;
    default:
      return { ok: false, error: NOT_FOUND };
  }
  if (built && 'notFound' in built) return { ok: false, error: NOT_FOUND };
  if (!built) return { ok: false, error: LIMIT_EXCEEDED, limit: 'rows', max: REPORT_ROW_CAP };
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
    ...(built.stay ? { stay: built.stay } : {}),
  };
}
