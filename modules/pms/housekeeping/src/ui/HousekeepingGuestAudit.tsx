import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_AUDIT_COUNT_MAX,
  HK_AUDIT_EVIDENCE_MAX,
  HK_AUDIT_NOTES_MAX,
  HK_AUDIT_REASON_MAX,
  guestAuditLineDiffers,
  type GuestAuditDetail,
  type GuestAuditLine,
  type GuestAuditSessionListRow,
  type GuestAuditTotals,
} from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RowActions,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useMemo, useState } from 'react';
import { GUEST_AUDIT_STATUS_LABEL, eventBy } from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi } from './housekeeping-types.js';
import { useBusinessDate } from './use-business-date.js';

export function guestAuditsKey(propertyId: string, from: string, to: string) {
  return ['housekeeping-guest-audits', propertyId, from, to] as const;
}

export function guestAuditKey(propertyId: string, sessionId: string) {
  return ['housekeeping-guest-audit', propertyId, sessionId] as const;
}

type Draft = { adults: string; children: string; reason: string; evidence: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The count as words: `2 adults, 1 child`. */
function peopleWords(adults: number, children: number): string {
  return `${plural(adults, 'adult', 'adults')}, ${plural(children, 'child', 'children')}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function parseCount(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= HK_AUDIT_COUNT_MAX ? n : null;
}

function draftOf(line: GuestAuditLine): Draft {
  return {
    adults: line.housekeepingAdults === null ? '' : String(line.housekeepingAdults),
    children: line.housekeepingChildren === null ? '' : String(line.housekeepingChildren),
    reason: line.varianceReason ?? '',
    evidence: line.evidenceNote ?? '',
  };
}

type RowState = {
  adults: number | null;
  children: number | null;
  differs: boolean;
  needsReason: boolean;
  complete: boolean;
};

function rowState(line: GuestAuditLine, draft: Draft): RowState {
  const adults = parseCount(draft.adults);
  const children = parseCount(draft.children);
  const complete = adults !== null && children !== null;
  const differs =
    complete &&
    guestAuditLineDiffers({
      frontOfficeAdults: line.frontOfficeAdults,
      frontOfficeChildren: line.frontOfficeChildren,
      housekeepingAdults: adults,
      housekeepingChildren: children,
    });
  return { adults, children, complete, differs, needsReason: differs && draft.reason.trim().length === 0 };
}

type DateFormat = {
  dateHeading: (iso: string) => string;
  date?: (iso: string) => string;
  dateTime: (ms: number) => string;
};

function TotalsTable({ title, testId, rows }: { title: string; testId: string; rows: GuestAuditTotals[] }) {
  return (
    <DataTable data-testid={testId}>
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>{title}</DataTableHeaderCell>
          <DataTableHeaderCell>Counted</DataTableHeaderCell>
          <DataTableHeaderCell>Front office</DataTableHeaderCell>
          <DataTableHeaderCell>Housekeeping</DataTableHeaderCell>
          <DataTableHeaderCell>Difference</DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {rows.map((r) => (
          <DataTableRow key={r.key ?? 'none'}>
            <DataTableCell>{r.label}</DataTableCell>
            <DataTableCell>
              {r.countedRooms} of {r.rooms}
            </DataTableCell>
            {r.countedRooms === 0 ? (
              <DataTableCell colSpan={3}>Not counted yet</DataTableCell>
            ) : (
              <>
                <DataTableCell>{plural(r.frontOffice, 'guest', 'guests')}</DataTableCell>
                <DataTableCell>{plural(r.housekeeping, 'guest', 'guests')}</DataTableCell>
                <DataTableCell>
                  {r.variance === 0 ? (
                    'None'
                  ) : (
                    <Badge rung="exception">
                      {signed(r.variance)} {Math.abs(r.variance) === 1 ? 'guest' : 'guests'}
                    </Badge>
                  )}
                </DataTableCell>
              </>
            )}
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}

export function HousekeepingGuestAudit({
  propertyId,
  defaultBusinessDate,
  api,
  canWrite,
  actorLabel,
  subtitle,
  formatError,
  format,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canWrite: boolean;
  actorLabel?: (actor: string) => string | null | undefined;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: DateFormat;
}) {
  const queryClient = useQueryClient();
  const [businessDate] = useBusinessDate(defaultBusinessDate);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const dateOf = format.date ?? format.dateHeading;
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;

  const sessionsQuery = useQuery({
    queryKey: guestAuditsKey(propertyId, from, to),
    queryFn: () =>
      api.getGuestAudits(propertyId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }),
  });
  const sessions = sessionsQuery.data?.sessions ?? [];
  const openToday = sessions.find((s) => s.status === 'open' && s.businessDate === businessDate);
  // The open audit of the business date is the one to work on until another is picked.
  const activeId = selectedId ?? openToday?.sessionId ?? null;

  const detailQuery = useQuery({
    queryKey: guestAuditKey(propertyId, activeId ?? ''),
    queryFn: () => api.getGuestAudit(propertyId, activeId!),
    enabled: Boolean(activeId),
  });
  const detail: GuestAuditDetail | undefined = detailQuery.data;
  const editable = Boolean(detail && detail.session.status === 'open' && canWrite);

  const invalidate = async (sessionId: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['housekeeping-guest-audits', propertyId] }),
      sessionId
        ? queryClient.invalidateQueries({ queryKey: guestAuditKey(propertyId, sessionId) })
        : Promise.resolve(),
    ]);
  };

  const start = useMutation({
    mutationFn: () => api.startGuestAudit(propertyId, { businessDate }, crypto.randomUUID()),
    onSuccess: async (result) => {
      const created = (result as { body?: { detail?: GuestAuditDetail } } | undefined)?.body?.detail;
      setNotice(null);
      setDrafts({});
      setSelectedId(created?.session.sessionId ?? null);
      setDone(
        created
          ? `Audit started: ${created.lines.length} occupied ${created.lines.length === 1 ? 'room' : 'rooms'} to count.`
          : 'Audit started.',
      );
      await invalidate(created?.session.sessionId ?? null);
    },
    onError: (err) => {
      setDone(null);
      setNotice(failure(err, 'Could not start the audit.'));
    },
  });

  const save = useMutation({
    mutationFn: (lines: Array<{ roomId: string; adults: number; children: number; reason: string; evidence: string }>) =>
      api.recordGuestAuditCount(
        propertyId,
        activeId!,
        {
          lines: lines.map((l) => ({
            roomId: l.roomId,
            adults: l.adults,
            children: l.children,
            ...(l.reason.trim() ? { varianceReason: l.reason.trim() } : {}),
            ...(l.evidence.trim() ? { evidenceNote: l.evidence.trim() } : {}),
          })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, lines) => {
      setNotice(null);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const l of lines) delete next[l.roomId];
        return next;
      });
      setDone(`${plural(lines.length, 'room', 'rooms')} counted.`);
      await invalidate(activeId);
    },
    onError: (err) => {
      setDone(null);
      setNotice(failure(err, 'Could not save the counts.'));
    },
  });

  const close = useMutation({
    mutationFn: () =>
      api.closeGuestAudit(
        propertyId,
        activeId!,
        closeNotes.trim() ? { notes: closeNotes.trim() } : {},
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setClosing(false);
      setCloseError(null);
      setCloseNotes('');
      setNotice(null);
      setDone('Audit closed. Its counts are now read-only.');
      await invalidate(activeId);
    },
    onError: (err) => setCloseError(failure(err, 'Could not close the audit.')),
  });

  const lines = detail?.lines ?? [];
  const states = useMemo(() => {
    const map = new Map<string, { draft: Draft; state: RowState; edited: boolean }>();
    for (const line of lines) {
      const edited = line.roomId in drafts;
      const draft = drafts[line.roomId] ?? draftOf(line);
      map.set(line.roomId, { draft, state: rowState(line, draft), edited });
    }
    return map;
  }, [lines, drafts]);

  const edited = lines.filter((l) => states.get(l.roomId)?.edited);
  const savable = edited.every((l) => {
    const s = states.get(l.roomId)!;
    return s.state.complete && !s.state.needsReason;
  });
  const uncounted = lines.filter((l) => l.housekeepingAdults === null).length;
  const missingReason = lines.filter(
    (l) => guestAuditLineDiffers(l) && !l.varianceReason,
  ).length;
  const closeBlocked =
    edited.length > 0
      ? 'Save the counts you changed first.'
      : uncounted > 0
        ? `${plural(uncounted, 'room is', 'rooms are')} not counted yet.`
        : missingReason > 0
          ? `${plural(missingReason, 'difference needs', 'differences need')} a reason.`
          : null;

  function setDraft(line: GuestAuditLine, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [line.roomId]: { ...(prev[line.roomId] ?? draftOf(line)), ...patch } }));
  }

  function submitCounts() {
    if (!savable || edited.length === 0 || save.isPending) return;
    save.mutate(
      edited.map((l) => {
        const s = states.get(l.roomId)!;
        return {
          roomId: l.roomId,
          adults: s.state.adults!,
          children: s.state.children!,
          reason: s.draft.reason,
          evidence: s.draft.evidence,
        };
      }),
    );
  }

  function openSession(row: GuestAuditSessionListRow) {
    setSelectedId(row.sessionId);
    setDrafts({});
    setDone(null);
    setNotice(null);
  }

  const busy = start.isPending || save.isPending || close.isPending;
  const rangeSet = Boolean(from || to);

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Guest audit"
        subtitle={subtitle ?? <>{businessDate ? format.dateHeading(businessDate) : ''} · front office against housekeeping</>}
      />
      <HousekeepingNav view="audit" />
      {done ? (
        <Alert intent="settled" data-testid="hk-audit-settled">
          {done}
        </Alert>
      ) : null}
      {notice ? (
        <Alert intent="exception" data-testid="hk-audit-notice">
          {notice}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view audits but not change them.</Alert> : null}

      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={
              <Input type="date" aria-label="Audits from" value={from} onChange={(e) => setFrom(e.target.value)} />
            }
          />
          <Field
            size="xs"
            label="To"
            control={<Input type="date" aria-label="Audits to" value={to} onChange={(e) => setTo(e.target.value)} />}
          />
          <Button
            type="button"
            intent="primary"
            disabled={!canWrite || busy || !businessDate || Boolean(openToday)}
            onClick={() => start.mutate()}
          >
            Start audit
          </Button>
        </Toolbar>
        <CardContent flush>
          {sessionsQuery.isLoading ? <Skeleton label="Loading audits" /> : null}
          {sessionsQuery.isError ? (
            <Alert intent="exception">{failure(sessionsQuery.error, 'Could not load audits.')}</Alert>
          ) : null}
          {sessionsQuery.isSuccess && sessions.length === 0 && !rangeSet ? (
            <EmptyState
              kind="empty"
              title="No guest audits yet."
              description={canWrite ? 'Use Start audit to count the guests in every occupied room.' : undefined}
            />
          ) : null}
          {sessionsQuery.isSuccess && sessions.length === 0 && rangeSet ? (
            <EmptyState kind="nomatch" title="No audits in this date range." />
          ) : null}
          {openToday ? (
            <Alert intent="informational">An audit is open for this business date. Finish it before starting another.</Alert>
          ) : null}
          {sessions.length > 0 ? (
            <DataTable data-testid="hk-audits">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Rooms</DataTableHeaderCell>
                  <DataTableHeaderCell>Counted</DataTableHeaderCell>
                  <DataTableHeaderCell>Differences</DataTableHeaderCell>
                  <DataTableHeaderCell>Started by</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {sessions.map((s) => (
                  <DataTableRow key={s.sessionId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{dateOf(s.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>
                      <Badge rung={s.status === 'open' ? 'attention' : 'settled'}>
                        {GUEST_AUDIT_STATUS_LABEL[s.status]}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell>{s.roomCount}</DataTableCell>
                    <DataTableCell>{s.countedCount}</DataTableCell>
                    <DataTableCell>{s.varianceCount}</DataTableCell>
                    <DataTableCell>{eventBy(s.startedBy, actorLabel)}</DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        <Button
                          type="button"
                          intent="ghost"
                          aria-label={`${s.status === 'open' ? 'Work on' : 'View'} audit of ${dateOf(s.businessDate)}`}
                          onClick={() => openSession(s)}
                        >
                          {s.status === 'open' ? 'Work on' : 'View'}
                        </Button>
                      </RowActions>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {activeId ? (
        <Card>
          <CardContent>
            {detailQuery.isLoading ? <Skeleton label="Loading the audit" /> : null}
            {detailQuery.isError ? (
              <Alert intent="exception">{failure(detailQuery.error, 'Could not load the audit.')}</Alert>
            ) : null}
            {detail ? (
              <div className="ui-stack" data-testid="hk-audit-detail">
                <p>
                  <strong>
                    Audit of {dateOf(detail.session.businessDate)} ·{' '}
                    {GUEST_AUDIT_STATUS_LABEL[detail.session.status]}
                  </strong>
                  {' · '}Started {format.dateTime(detail.session.startedAt)} by{' '}
                  {eventBy(detail.session.startedBy, actorLabel)}
                  {detail.session.closedAt
                    ? ` · Closed ${format.dateTime(detail.session.closedAt)} by ${eventBy(detail.session.closedBy ?? '', actorLabel)}`
                    : ''}
                  {detail.session.notes ? ` · ${detail.session.notes}` : ''}
                </p>
                {lines.length === 0 ? (
                  <EmptyState
                    kind="empty"
                    title="No occupied rooms were found when this audit started."
                    description="Nothing to count."
                  />
                ) : (
                  <>
                    <div className="ui-row">
                      <TotalsTable title="Floor" testId="hk-audit-totals-floor" rows={detail.totalsByFloor} />
                      <TotalsTable title="Room type" testId="hk-audit-totals-type" rows={detail.totalsByType} />
                    </div>
                    <DataTable data-testid="hk-audit-lines">
                      <DataTableHead>
                        <DataTableRow>
                          <DataTableHeaderCell>Room</DataTableHeaderCell>
                          <DataTableHeaderCell>Floor</DataTableHeaderCell>
                          <DataTableHeaderCell>Type</DataTableHeaderCell>
                          <DataTableHeaderCell>Front office</DataTableHeaderCell>
                          <DataTableHeaderCell>Adults counted</DataTableHeaderCell>
                          <DataTableHeaderCell>Children counted</DataTableHeaderCell>
                          <DataTableHeaderCell>Result</DataTableHeaderCell>
                          <DataTableHeaderCell>Reason and evidence</DataTableHeaderCell>
                        </DataTableRow>
                      </DataTableHead>
                      <DataTableBody>
                        {lines.map((line) => {
                          const row = states.get(line.roomId)!;
                          const { state, draft } = row;
                          const counted = line.housekeepingAdults !== null && !row.edited;
                          return (
                            <DataTableRow key={line.lineId}>
                              <DataTableCell>{line.roomCode}</DataTableCell>
                              <DataTableCell>{line.floor ?? '—'}</DataTableCell>
                              <DataTableCell>{line.roomTypeName}</DataTableCell>
                              <DataTableCell>
                                {peopleWords(line.frontOfficeAdults, line.frontOfficeChildren)}
                              </DataTableCell>
                              <DataTableCell>
                                {editable ? (
                                  <Input
                                    type="number"
                                    min={0}
                                    max={HK_AUDIT_COUNT_MAX}
                                    aria-label={`Adults counted in room ${line.roomCode}`}
                                    value={draft.adults}
                                    onChange={(e) => setDraft(line, { adults: e.target.value })}
                                  />
                                ) : (
                                  (line.housekeepingAdults ?? '—')
                                )}
                              </DataTableCell>
                              <DataTableCell>
                                {editable ? (
                                  <Input
                                    type="number"
                                    min={0}
                                    max={HK_AUDIT_COUNT_MAX}
                                    aria-label={`Children counted in room ${line.roomCode}`}
                                    value={draft.children}
                                    onChange={(e) => setDraft(line, { children: e.target.value })}
                                  />
                                ) : (
                                  (line.housekeepingChildren ?? '—')
                                )}
                              </DataTableCell>
                              <DataTableCell>
                                {!state.complete ? (
                                  <Badge rung="neutral">{counted || row.edited ? 'Enter both counts' : 'Not counted'}</Badge>
                                ) : state.differs ? (
                                  <Badge rung="exception">
                                    Differs: {peopleWords(state.adults!, state.children!)}
                                  </Badge>
                                ) : (
                                  <Badge rung="settled">Matches</Badge>
                                )}
                                {row.edited ? <span className="muted"> · not saved</span> : null}
                              </DataTableCell>
                              <DataTableCell>
                                {editable ? (
                                  <div className="ui-stack">
                                    <Input
                                      aria-label={`Variance reason for room ${line.roomCode}`}
                                      placeholder={state.differs ? 'Why does it differ?' : 'Reason (only if it differs)'}
                                      value={draft.reason}
                                      maxLength={HK_AUDIT_REASON_MAX}
                                      onChange={(e) => setDraft(line, { reason: e.target.value })}
                                    />
                                    {state.needsReason ? (
                                      <span className="muted">Give a reason for the difference.</span>
                                    ) : null}
                                    <Input
                                      aria-label={`Evidence note for room ${line.roomCode}`}
                                      placeholder="Evidence note (optional)"
                                      value={draft.evidence}
                                      maxLength={HK_AUDIT_EVIDENCE_MAX}
                                      onChange={(e) => setDraft(line, { evidence: e.target.value })}
                                    />
                                  </div>
                                ) : (
                                  [line.varianceReason, line.evidenceNote].filter(Boolean).join(' · ') || '—'
                                )}
                              </DataTableCell>
                            </DataTableRow>
                          );
                        })}
                      </DataTableBody>
                    </DataTable>
                    {editable ? (
                      <div className="ui-row">
                        <Button
                          type="button"
                          intent="primary"
                          disabled={busy || edited.length === 0 || !savable}
                          onClick={submitCounts}
                        >
                          Save counts
                        </Button>
                        <Button
                          type="button"
                          disabled={busy || closeBlocked !== null}
                          onClick={() => {
                            setCloseError(null);
                            setClosing(true);
                          }}
                        >
                          Close audit
                        </Button>
                        {closeBlocked ? <span className="muted">{closeBlocked}</span> : null}
                      </div>
                    ) : null}
                    {detail.events.length > 0 ? (
                      <div className="ui-stack">
                        <strong>Count history</strong>
                        <ul className="ui-stack" aria-label="Count history" data-testid="hk-audit-events">
                          {detail.events.map((e) => {
                            const room = lines.find((l) => l.roomId === e.roomId)?.roomCode ?? 'Room';
                            return (
                              <li key={e.eventId}>
                                Room {room}: {peopleWords(e.adults, e.children)} · {format.dateTime(e.at)} ·{' '}
                                {eventBy(e.actor, actorLabel)}
                                {e.varianceReason ? ` · ${e.varianceReason}` : ''}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {closing ? (
        <Dialog
          open
          title="Close this audit?"
          onClose={() => setClosing(false)}
          footer={
            <>
              <Button type="button" onClick={() => setClosing(false)}>
                Keep open
              </Button>
              <Button intent="primary" disabled={close.isPending} onClick={() => close.mutate()}>
                Close audit
              </Button>
            </>
          }
        >
          <form
            className="ui-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!close.isPending) close.mutate();
            }}
          >
            {closeError ? <Alert intent="exception">{closeError}</Alert> : null}
            <p>Every room is counted. Once closed, the counts cannot be changed.</p>
            <Field
              label="Notes (optional)"
              control={
                <Textarea
                  aria-label="Audit closing notes"
                  value={closeNotes}
                  maxLength={HK_AUDIT_NOTES_MAX}
                  onChange={(e) => setCloseNotes(e.target.value)}
                />
              }
            />
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
