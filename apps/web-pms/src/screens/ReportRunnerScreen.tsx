import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ClassifiedError, type GuestRowState } from '@hospai/client-core';
import {
  REPORT_ROW_CAP,
  reportDefinition,
  type ReportColumn,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import {
  Alert,
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
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  StatusBadge,
  Toolbar,
  isReservationStatus,
  reservationStatusWord,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { downloadTextFile } from '../reports/download-file.js';
import {
  REPORT_TOTAL_LABEL,
  buildReportCsv,
  checkReportParams,
  defaultReportParams,
  describeReportParams,
  formatReportCell,
  guestRefsOf,
  reportCsvFileName,
  reportLookupKey,
  reportQueryKey,
  staffFallbackWord,
} from '../reports/report-model.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertyBusinessDate } from '../shell/use-business-date.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { guestLabel } from './guest-row.js';
import { ReportReservationPicker, type PickedStay } from './report-reservation-picker.js';

function isOverCap(err: unknown): boolean {
  if (!(err instanceof ClassifiedError)) return false;
  const body = err.classified.body as { error?: unknown; limit?: unknown } | null;
  return body?.error === 'limit_exceeded' && body.limit === 'rows';
}

function errorCopy(err: unknown): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback: 'Could not run this report.' })
    : 'Could not run this report.';
}

const NUMERIC = new Set(['integer', 'money', 'percent']);
/** Columns set in tabular figures. */
const TABULAR = new Set(['integer', 'money', 'percent', 'date', 'datetime']);

/** `/reports/:reportId` — the form, run, table, print and CSV, all driven by the definition. */
export function ReportRunnerScreen() {
  const { reportId = '' } = useParams();
  const def = reportDefinition(reportId);
  if (!def) return <UnknownReport />;
  return <ReportRunner key={def.id} def={def} />;
}

function UnknownReport() {
  return (
    <div className="board-page">
      <PageHeader title="Report not found" back={<Link to="/reports">Reports</Link>} />
      <Card>
        <CardContent>
          <EmptyState
            data-testid="report-unknown"
            kind="error"
            title="There is no such report"
            description="Pick one from the Reports list."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ReportRunner({ def }: { def: ReportDefinition }) {
  const propertyId = tenant.propertyId;
  const { date, dateTime, money } = useFormat();
  const { subtitle } = usePropertySubtitle(def.description);
  // The open business date (it trails the calendar date until night audit rolls it); the form
  // fills only once it is known, and a date the user has changed is kept.
  const today = usePropertyBusinessDate();

  const [draft, setDraft] = useState<ReportParams | null>(null);
  const [applied, setApplied] = useState<ReportParams | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickedStay, setPickedStay] = useState<PickedStay | null>(null);
  const isStayReport = def.params.kind === 'reservation';
  const isNoParams = def.params.kind === 'none';
  const form: ReportParams | null =
    draft ?? (today || isStayReport || isNoParams ? defaultReportParams(def, today ?? '') : null);

  // Staff names (cashiers, actors) come from the property's member list, only for a viewer who may
  // read staff; otherwise a plain word stands in. Asked only when the report has staff in it.
  const needsStaff =
    def.columns.some((c) => c.type === 'staff') ||
    (def.params.kind === 'range' && def.params.staffFilter !== undefined);
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    enabled: needsStaff,
    staleTime: 60_000,
    retry: false,
  });
  const canReadStaff = Boolean(meQ.data && hasPropertyPermission(meQ.data as PropertyMe, 'staff:read'));
  const membersQ = useQuery({
    queryKey: ['property-members', propertyId],
    queryFn: () => api.listPropertyMembers(propertyId),
    enabled: needsStaff && canReadStaff,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const members = membersQ.data?.members ?? [];
  // Housekeeping staff (attendants, inspectors) are roster people, not users: their names come from
  // the roster, for a viewer who may read it.
  const canReadRoster = Boolean(meQ.data && hasPropertyPermission(meQ.data as PropertyMe, 'roster:read'));
  const rosterQ = useQuery({
    queryKey: reportLookupKey(propertyId, 'roster'),
    queryFn: () => api.listRoster(propertyId),
    enabled: needsStaff && def.group === 'housekeeping' && canReadRoster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const roster = rosterQ.data?.staff ?? [];
  // Rooms and linen items for the form's dropdowns.
  const lookups = def.params.kind === 'range' ? (def.params.lookupFilters ?? []) : [];
  const roomsQ = useQuery({
    queryKey: reportLookupKey(propertyId, 'rooms'),
    queryFn: () => api.listRooms(propertyId),
    enabled: lookups.some((l) => l.source === 'rooms'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const itemsQ = useQuery({
    queryKey: reportLookupKey(propertyId, 'linen_items'),
    queryFn: () => api.getLinenMovements(propertyId),
    enabled: lookups.some((l) => l.source === 'linen_items'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const lookupOptions = (source: 'rooms' | 'linen_items'): Array<{ value: string; label: string }> =>
    source === 'rooms'
      ? [...(roomsQ.data?.rooms ?? [])]
          .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
          .map((r) => ({ value: r.roomId, label: r.code }))
      : (itemsQ.data?.items ?? []).map((i) => ({ value: i.itemId, label: i.name }));
  const lookupName = (name: 'room' | 'item', id: string): string =>
    lookupOptions(name === 'room' ? 'rooms' : 'linen_items').find((o) => o.value === id)?.label ?? id;
  const memberName = (userId: string): string | null => {
    const m = members.find((x) => x.userId === userId);
    return m ? (m.displayName ?? m.email ?? null) : null;
  };
  const rosterName = (staffId: string): string | null => {
    const r = roster.find((x) => x.staffId === staffId);
    return r ? (r.displayName ?? null) : null;
  };
  const staffName = (userId: string) => memberName(userId) ?? rosterName(userId) ?? staffFallbackWord(userId);

  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const propertyName =
    propertyQ.data && 'property' in propertyQ.data ? propertyQ.data.property.name : null;

  const reportQ = useQuery({
    queryKey: reportQueryKey(propertyId, def.id, applied ?? {}),
    queryFn: () => api.getReport(propertyId, def, applied!),
    enabled: applied !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const result: ReportResponse | undefined = reportQ.data;

  const refs = useMemo(() => guestRefsOf(result), [result]);
  const batchQ = useQuery({
    queryKey: ['guests-batch', propertyId, refs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, propertyId, refs),
    enabled: refs.length > 0,
    retry: false,
  });
  const states: Record<string, GuestRowState> = batchQ.data?.states ?? {};
  const guestName = (ref: string) => guestLabel(states[ref], ref);

  // Cashiers are property members; inspectors are roster people.
  const staffFilter = def.params.kind === 'range' ? def.params.staffFilter : undefined;
  const staffOptions: Array<{ value: string; label: string }> =
    staffFilter?.name === 'inspector'
      ? roster
          .filter((r) => r.status === 'active' && r.exitedAt == null)
          .map((r) => ({ value: r.staffId, label: r.displayName ?? staffFallbackWord(r.staffId) }))
      : members.map((m) => ({
          value: m.userId,
          label: m.displayName ?? m.email ?? staffFallbackWord(m.userId),
        }));

  const set = (patch: ReportParams) => setDraft({ ...(form ?? {}), ...patch });

  function run() {
    if (!form) return;
    const checked = checkReportParams(def, form);
    if (!checked.ok) {
      setFormError(checked.message);
      return;
    }
    setFormError(null);
    const same = applied && JSON.stringify(applied) === JSON.stringify(checked.params);
    if (same) void reportQ.refetch();
    else setApplied(checked.params);
  }

  const fmt = { money, date, guest: guestName, dateTime: (ms: number) => dateTime(ms), staff: staffName };
  const canOutput = Boolean(result && result.rows.length > 0);
  const paramsText = result ? describeReportParams(def, result.params, date, staffName, lookupName) : '';

  function downloadCsv() {
    if (!result) return;
    downloadTextFile(
      reportCsvFileName(def, result.params),
      buildReportCsv({
        columns: result.columns,
        rows: result.rows,
        totals: result.totals,
        currency: result.currency,
        guest: guestName,
        staff: staffName,
      }),
    );
  }

  function renderCell(c: ReportColumn, row: ReportRow): ReactNode {
    const raw = row[c.key];
    if (c.type === 'status' && typeof raw === 'string' && isReservationStatus(raw)) {
      return <StatusBadge status={raw} />;
    }
    const text = (
      <span className={TABULAR.has(c.type) ? 'ui-num' : undefined}>
        {formatReportCell(c, row, result!.currency, fmt)}
      </span>
    );
    // Subtotal rows (window totals, tax totals) read as totals.
    return row.subtotal === 1 ? <strong>{text}</strong> : text;
  }

  const unit = def.params.kind === 'range' ? def.params.unit : 'days';
  const hint =
    def.params.kind === 'range' ? `Up to ${def.params.maxSpan} ${unit} at a time.` : undefined;

  let body: ReactNode;
  if (applied === null) {
    body = (
      <EmptyState
        data-testid="report-idle"
        title="Run the report"
        description={
          isStayReport
            ? 'Find a stay above, then press Run.'
            : isNoParams
              ? 'Press Run to read the rooms as they are now.'
              : def.params.kind === 'range'
                ? 'Choose the dates above, then press Run.'
                : 'Choose the date above, then press Run.'
        }
      />
    );
  } else if (reportQ.isError) {
    body = isOverCap(reportQ.error) ? (
      <EmptyState
        data-testid="report-over-cap"
        kind="nomatch"
        title={`More than ${REPORT_ROW_CAP.toLocaleString('en')} rows`}
        description="A single run shows at most that many rows. Narrow the dates or choose a status, then run it again."
      />
    ) : (
      <Alert data-testid="report-error">{errorCopy(reportQ.error)}</Alert>
    );
  } else if (!result) {
    body = <Skeleton />;
  } else if (result.emptyReason === 'no_closed_audit') {
    body = (
      <EmptyState
        data-testid="report-no-audit"
        kind="nomatch"
        title="No completed night audit"
        description={
          result.params.date
            ? `The night audit for ${date(result.params.date)} has not been completed. Choose a date the audit has closed.`
            : 'Choose a date the audit has closed.'
        }
      />
    );
  } else if (result.rows.length === 0) {
    body = (
      <EmptyState
        data-testid="report-empty"
        kind="nomatch"
        title="Nothing to report"
        description={
          isStayReport
            ? 'This stay has nothing posted to its folio yet.'
            : 'No rows match these dates. Change the dates or the filter.'
        }
      />
    );
  } else {
    body = null;
  }

  return (
    <div className="board-page">
      <PageHeader title={def.title} subtitle={subtitle} back={<Link to="/reports">Reports</Link>} />
      <Card>
        <Toolbar>
          {def.params.kind === 'reservation' ? (
            <ReportReservationPicker
              picked={pickedStay}
              onPick={(stay) => {
                setPickedStay(stay);
                setFormError(null);
                setDraft({ reservationId: stay.reservationId });
              }}
              onClear={() => {
                setPickedStay(null);
                setDraft({});
              }}
            />
          ) : def.params.kind === 'none' ? (
            <p className="muted" data-testid="report-no-params">
              This report has no dates. It reads the property as it is now.
            </p>
          ) : def.params.kind === 'date' || def.params.kind === 'closed_date' ? (
            <Field
              label={def.params.label}
              hint={def.params.kind === 'closed_date' ? 'A date the night audit has closed.' : undefined}
              size="sm"
              error={formError ?? undefined}
              control={
                <Input
                  type="date"
                  value={form?.date ?? ''}
                  onChange={(e) => set({ date: e.target.value })}
                />
              }
            />
          ) : (
            <>
              <Field
                label="From"
                size="sm"
                control={
                  <Input
                    type="date"
                    value={form?.from ?? ''}
                    onChange={(e) => set({ from: e.target.value })}
                  />
                }
              />
              <Field
                label="To"
                size="sm"
                error={formError ?? undefined}
                control={
                  <Input
                    type="date"
                    value={form?.to ?? ''}
                    onChange={(e) => set({ to: e.target.value })}
                  />
                }
              />
              {(def.params.filters ?? []).map((f) => (
                <Field
                  key={f.name}
                  label={f.label}
                  size="md"
                  control={
                    <NativeSelect
                      value={(form as Record<string, string | undefined> | null)?.[f.name] ?? ''}
                      onChange={(e) => set({ [f.name]: e.target.value })}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
              ))}
              {lookups.map((l) => {
                const options = lookupOptions(l.source);
                return options.length > 0 ? (
                  <Field
                    key={l.name}
                    label={l.label}
                    size="md"
                    control={
                      <NativeSelect
                        value={form?.[l.name] ?? ''}
                        onChange={(e) => set({ [l.name]: e.target.value })}
                      >
                        <option value="">{l.source === 'rooms' ? 'All rooms' : 'All items'}</option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                ) : null;
              })}
              {staffOptions.length > 0 && staffFilter ? (
                <Field
                  label={staffFilter.label}
                  size="md"
                  control={
                    <NativeSelect
                      value={form?.[staffFilter.name] ?? ''}
                      onChange={(e) => set({ [staffFilter.name]: e.target.value })}
                    >
                      <option value="">{`All ${staffFilter.label.toLowerCase()}s`}</option>
                      {staffOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
              ) : null}
            </>
          )}
        </Toolbar>
        {isStayReport && formError ? (
          <CardContent>
            <Alert data-testid="report-form-error">{formError}</Alert>
          </CardContent>
        ) : null}
        {hint ? (
          <CardContent>
            <p className="muted" data-testid="report-span-hint">
              {hint}
            </p>
          </CardContent>
        ) : null}
        <Toolbar>
          <Button intent="primary" onClick={run} disabled={!form} data-testid="report-run">
            Run
          </Button>
          <Button onClick={() => window.print()} disabled={!canOutput} data-testid="report-print">
            Print
          </Button>
          <Button onClick={downloadCsv} disabled={!canOutput} data-testid="report-csv">
            Download CSV
          </Button>
        </Toolbar>
      </Card>
      {body !== null ? (
        <Card>
          <CardContent>{body}</CardContent>
        </Card>
      ) : (
        <Card>
          <div className="report-card" data-testid="report-card">
            <CardHeader>
              <CardTitle>{def.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="report-card__property" data-testid="report-property">
                {propertyName ?? ''}
              </p>
              {result!.stay ? (
                <div data-testid="report-stay">
                  <p className="report-card__property">
                    {guestName(result!.stay.guest)} · Booking {result!.stay.confirmation}
                  </p>
                  <p className="muted">
                    {[
                      result!.stay.room ? `Room ${result!.stay.room}` : 'No room yet',
                      result!.stay.roomType,
                      `${date(result!.stay.arrival)} to ${date(result!.stay.departure)}`,
                      reservationStatusWord(result!.stay.status),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ) : null}
              {paramsText ? (
                <p className="muted" data-testid="report-params">
                  {paramsText}
                </p>
              ) : null}
              <p className="muted" data-testid="report-generated">
                Generated {dateTime(Date.parse(result!.generatedAt))} · {result!.rows.length}{' '}
                {result!.rows.length === 1 ? 'row' : 'rows'}
              </p>
            </CardContent>
            <CardContent flush>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    {result!.columns.map((c) => (
                      <DataTableHeaderCell key={c.key} align={NUMERIC.has(c.type) ? 'right' : undefined}>
                        {c.label}
                      </DataTableHeaderCell>
                    ))}
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {result!.rows.map((row, i) => (
                    <DataTableRow key={i}>
                      {result!.columns.map((c) => (
                        <DataTableCell key={c.key} align={NUMERIC.has(c.type) ? 'right' : undefined}>
                          {renderCell(c, row)}
                        </DataTableCell>
                      ))}
                    </DataTableRow>
                  ))}
                  {result!.totals ? (
                    <DataTableRow data-testid="report-totals">
                      {result!.columns.map((c, i) => (
                        <DataTableCell key={c.key} align={NUMERIC.has(c.type) ? 'right' : undefined}>
                          <strong>
                            {i === 0 && result!.totals![c.key] == null
                              ? REPORT_TOTAL_LABEL
                              : formatReportCell(c, result!.totals!, result!.currency, fmt)}
                          </strong>
                        </DataTableCell>
                      ))}
                    </DataTableRow>
                  ) : null}
                </DataTableBody>
              </DataTable>
            </CardContent>
          </div>
        </Card>
      )}
    </div>
  );
}
