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
} from '@hospai/ui-kit';
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
  reportQueryKey,
} from '../reports/report-model.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertyBusinessDate } from '../shell/use-business-date.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { guestLabel } from './guest-row.js';

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
const TABULAR = new Set(['integer', 'money', 'percent', 'date']);

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
  const form: ReportParams | null = draft ?? (today ? defaultReportParams(def, today) : null);

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

  const fmt = { money, date, guest: guestName };
  const canOutput = Boolean(result && result.rows.length > 0);

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
      }),
    );
  }

  function renderCell(c: ReportColumn, row: ReportRow): ReactNode {
    const raw = row[c.key];
    if (c.type === 'status' && typeof raw === 'string' && isReservationStatus(raw)) {
      return <StatusBadge status={raw} />;
    }
    return (
      <span className={TABULAR.has(c.type) ? 'ui-num' : undefined}>
        {formatReportCell(c, row, result!.currency, fmt)}
      </span>
    );
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
        description="Choose the dates above, then press Run."
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
  } else if (result.rows.length === 0) {
    body = (
      <EmptyState
        data-testid="report-empty"
        kind="nomatch"
        title="Nothing to report"
        description="No rows match these dates. Change the dates or the filter."
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
          {def.params.kind === 'date' ? (
            <Field
              label="Date"
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
            </>
          )}
        </Toolbar>
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
              <p className="muted" data-testid="report-params">
                {describeReportParams(def, result!.params, date)}
              </p>
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
