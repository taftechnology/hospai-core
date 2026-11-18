import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { NightAuditCheckLog } from '@hospai/contracts';
import type { NightAuditStatus } from '@hospai/client-core';
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
  EmptyState,
  Field,
  NativeSelect,
  PageHeader,
  Skeleton,
  Tabs,
  type StatusRung,
} from '@hospai/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  CHECK_LABELS,
  SEVERITY_WORD,
  STEP_ERROR_COPY,
  checkOutcomeWord,
} from '../copy/night-audit-check-labels.js';
import { STEP_LABELS } from '../copy/night-audit-step-labels.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { nightAuditStepSeverity } from '../status/night-audit-severity.js';

const MONEY_KEYS = new Set([
  'roomNet',
  'taxTotal',
  'openingFloat',
  'closingCount',
  'variance',
  'ledgerAmountMinor',
]);

const REPORT_KEY_LABELS: Record<string, string> = {
  roomNet: 'Room net',
  taxTotal: 'Tax',
  businessDate: 'Business date',
};

type Stage = 'checks' | 'run' | 'close-out';

type Notice = { text: string; intent: 'settled' | 'exception' };

type OutcomeWord = 'Off' | 'Clear' | 'Fail' | 'Warn' | 'Info';

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'checks', label: 'Checks' },
  { id: 'run', label: 'Run' },
  { id: 'close-out', label: 'Close-out' },
];

function titleCaseReportId(id: string): string {
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function auditStepLabel(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'Complete';
    case 'PENDING':
      return 'Pending';
    case 'RUNNING':
      return 'Running';
    case 'FAILED':
      return 'Failed';
    default:
      return status;
  }
}

/** Some steps done, none failed: a Retry that passed, or a run between steps. Resume finishes it. */
function isPartWay(status: NightAuditStatus): boolean {
  const steps = status.steps;
  return (
    steps.some((step) => step.status === 'COMPLETED') &&
    steps.some((step) => step.status !== 'COMPLETED') &&
    !steps.some((step) => step.status === 'FAILED')
  );
}

function preferredStage(status: NightAuditStatus | undefined): Stage {
  if (!status) return 'checks';
  const busy =
    status.halted ||
    isPartWay(status) ||
    status.steps.some((step) => step.status === 'RUNNING' || step.status === 'FAILED');
  return busy ? 'run' : 'checks';
}

function stepFailedCopy(error: string | null | undefined): string {
  return (error && STEP_ERROR_COPY[error]) || 'The step failed again. See the audit steps.';
}

function failCheckReason(status: NightAuditStatus): string | null {
  const names: string[] = [];
  if (status.pendingOpenCount > 0) names.push(CHECK_LABELS.queued_commands);
  if (status.closingExceptionCount > 0) names.push(CHECK_LABELS.open_exceptions);
  for (const row of status.checks) {
    if (row.severity === 'fail' && (row.count ?? 0) > 0) {
      names.push(CHECK_LABELS[row.checkId]);
    }
  }
  if (names.length === 0) return null;
  return `Clear Fail checks before running: ${names.join(', ')}.`;
}

function runDisabledReason(
  status: NightAuditStatus | undefined,
  today: string | null,
  anyRunning: boolean,
): string | null {
  if (!status) return 'Loading night audit status…';
  if (status.halted) return 'Night audit is halted — resolve the failed step first.';
  if (anyRunning) return 'Night audit is already running.';
  if (today == null) return 'Property time zone unavailable.';
  if (isPartWay(status)) return 'A run is part-way through. Use Resume to finish it.';
  if (status.businessDate >= today) return 'Business date is already current — nothing to roll.';
  return failCheckReason(status);
}

function formatReportCell(
  key: string,
  value: unknown,
  money: (minor: number) => string,
  date: (iso: string) => string,
): string {
  if (typeof value === 'number' && (MONEY_KEYS.has(key) || key.endsWith('Minor'))) {
    return money(value);
  }
  if (value == null) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value);
  return String(value);
}

function outcomeRung(word: OutcomeWord): StatusRung {
  switch (word) {
    case 'Clear':
      return 'settled';
    case 'Fail':
      return 'exception';
    case 'Warn':
      return 'attention';
    case 'Info':
      return 'informational';
    default:
      return 'neutral';
  }
}

function actionFor(
  checkId: string,
  businessDate: string,
): { to: string; label: string } | null {
  const date = encodeURIComponent(businessDate);
  switch (checkId) {
    case 'queued_commands':
      return null;
    case 'open_exceptions':
      return {
        to: `/exceptions?resolution=open&businessDateFrom=${date}&businessDateTo=${date}`,
        label: 'Open exceptions',
      };
    case 'arrivals_not_checked_in':
      return { to: `/arrivals?date=${date}`, label: 'Arrivals' };
    case 'dirty_room_assigned':
      return { to: '/housekeeping', label: 'Housekeeping' };
    case 'departures_not_checked_out':
    case 'departed_with_balance':
      return { to: `/departures?date=${date}`, label: 'Departures' };
    case 'cashier_shift_open':
      return { to: '/shift', label: 'Shift' };
    default:
      return null;
  }
}

function stepDetail(error: string | null, attempt: number): string | null {
  if (error) return STEP_ERROR_COPY[error] ?? error;
  if (attempt > 0) return `Attempt ${attempt}`;
  return null;
}

function warnLabels(status: NightAuditStatus): string[] {
  return status.checks
    .filter((row) => row.severity === 'warn' && (row.count ?? 0) > 0)
    .map((row) => CHECK_LABELS[row.checkId]);
}

/**
 * Prefixes of the date-scoped desk queries a rolled business date leaves stale.
 * Board keys are `['board', mode, propertyId, date, cursor]` (BoardScreen, Dashboard).
 * Summary is `['front-desk-summary', propertyId, date]` (board-summary).
 * Tape and available rooms are `['front-desk-tape'|'front-desk-available', propertyId, from, to]`.
 * Housekeeping dates are `['housekeeping-assignments'|'housekeeping-priorities', propertyId, businessDate]`.
 * ShiftStrip reads `['open-shift', propertyId]` and `['recent-shifts', propertyId]`.
 */
function invalidateDateScopedDesk(queryClient: QueryClient, propertyId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['board'] });
  void queryClient.invalidateQueries({ queryKey: ['front-desk-summary', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['front-desk-free', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['front-desk-available', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['housekeeping-priorities', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['recent-shifts', propertyId] });
}

function invalidateNightAudit(queryClient: QueryClient, propertyId: string): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['night-audit', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['night-audit-check-log', propertyId] }),
  ]).then(() => undefined);
}

export function NightAuditScreen() {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const timeZone = usePropertyTimeZone();
  const { money, date } = useFormat();
  const [stageChoice, setStageChoice] = useState<Stage | null>(null);
  const [openReport, setOpenReport] = useState<{
    businessDate: string;
    reportId: string;
  } | null>(null);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [runEnded, setRunEnded] = useState<Notice | null>(null);
  const previousStatus = useRef<NightAuditStatus | null>(null);
  // The Workflow has gaps between steps with nothing RUNNING, and the first read after
  // Run may show none of it yet, so a started run polls until it rolls or stops.
  const startedRun = useRef<{ businessDate: string; until: number } | null>(null);

  const statusQuery = useQuery({
    queryKey: ['night-audit', propertyId],
    queryFn: () => api.getNightAudit(propertyId),
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const data = query.state.data as NightAuditStatus | undefined;
      if (!data) return false;
      if (data.steps.some((step) => step.status === 'RUNNING')) return 5_000;
      const started = startedRun.current;
      if (!started || Date.now() >= started.until) return false;
      const stopped = data.steps.some((step) => step.status === 'FAILED');
      const finished =
        data.businessDate !== started.businessDate &&
        data.steps.every((step) => step.status === 'COMPLETED');
      return stopped || finished ? false : 5_000;
    },
  });

  const status = statusQuery.data;
  const stage = stageChoice ?? preferredStage(status);

  const logQuery = useQuery({
    queryKey: ['night-audit-check-log', propertyId],
    queryFn: () => api.getNightAuditCheckLog(propertyId),
    enabled: stage === 'close-out',
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const canConfigure = Boolean(
    meQuery.data && hasPropertyPermission(meQuery.data as PropertyMe, 'settings:configure'),
  );

  const reportQuery = useQuery({
    queryKey: ['night-audit-report', propertyId, openReport?.businessDate, openReport?.reportId],
    queryFn: () =>
      api.getNightAuditReport(propertyId, openReport!.businessDate, openReport!.reportId),
    enabled: openReport != null,
    retry: false,
  });

  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const anyRunning = Boolean(status?.steps.some((step) => step.status === 'RUNNING'));
  const failedStep = status?.steps.find((step) => step.status === 'FAILED');
  const blockedByChecks = status ? failCheckReason(status) != null : false;
  const runDisabled =
    !status ||
    status.halted ||
    anyRunning ||
    today == null ||
    isPartWay(status) ||
    status.businessDate >= today ||
    blockedByChecks;
  const runDisabledCopy = runDisabledReason(status, today, anyRunning);
  const resumeEnabled = Boolean(status && (status.halted || anyRunning || isPartWay(status)));
  const warns = status ? warnLabels(status) : [];

  useEffect(() => {
    if (!status) return;
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (!previous) return;
    const newlyFailed = status.steps.find(
      (step) =>
        step.status === 'FAILED' &&
        previous.steps.find((prior) => prior.step === step.step)?.status !== 'FAILED',
    );
    if (status.businessDate !== previous.businessDate) {
      setMessage(null);
      setRunEnded({ intent: 'settled', text: `Business date is now ${date(status.businessDate)}.` });
      invalidateDateScopedDesk(queryClient, propertyId);
      void queryClient.invalidateQueries({ queryKey: ['night-audit-check-log', propertyId] });
    } else if (newlyFailed) {
      const label = STEP_LABELS[newlyFailed.step] ?? newlyFailed.step;
      setMessage(null);
      setRunEnded({ intent: 'exception', text: `Night audit stopped at ${label}.` });
      void queryClient.invalidateQueries({ queryKey: ['night-audit-check-log', propertyId] });
    }
  }, [status, queryClient, propertyId]);

  const runMutation = useMutation({
    mutationFn: () =>
      api.runNightAudit(propertyId, `night-audit:run:${propertyId}:${status!.businessDate}`),
    onSuccess: () => {
      startedRun.current = { businessDate: status!.businessDate, until: Date.now() + 600_000 };
      setRunEnded(null);
      setMessage({ text: 'Night audit started.', intent: 'settled' });
    },
    onError: (err) =>
      setMessage({
        text: classifiedUserMessage(asClassified(err), { fallback: 'Night audit failed.' }),
        intent: 'exception',
      }),
    onSettled: () => invalidateNightAudit(queryClient, propertyId),
  });

  const retryMutation = useMutation({
    mutationFn: (step: string) =>
      api.retryNightAuditStep(
        propertyId,
        { businessDate: status!.timelineDate, step },
        // A fresh key per click: the server stores a FAILED retry, so a reused key
        // would replay that result and never re-run the step after the cause is cleared.
        `night-audit:retry:${propertyId}:${status!.timelineDate}:${step}:${crypto.randomUUID()}`,
      ),
    onSuccess: (res) => {
      setRunEnded(null);
      const out = res.body as { status?: string; error?: string | null };
      setMessage(
        out.status === 'FAILED'
          ? { text: stepFailedCopy(out.error), intent: 'exception' }
          : { text: 'Step passed. Use Resume to finish the audit.', intent: 'settled' },
      );
    },
    onError: (err) =>
      setMessage({
        text: classifiedUserMessage(asClassified(err), { fallback: 'Retry failed.' }),
        intent: 'exception',
      }),
    onSettled: () => invalidateNightAudit(queryClient, propertyId),
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      api.resolveNightAuditHalt(
        propertyId,
        status!.timelineDate,
        `night-audit:resolve-halt:${propertyId}:${status!.timelineDate}:${crypto.randomUUID()}`,
      ),
    onSuccess: (res) => {
      setRunEnded(null);
      const out = res.body as { status?: string; error?: string | null };
      setMessage(
        out.status === 'FAILED'
          ? { text: stepFailedCopy(out.error), intent: 'exception' }
          : { text: 'Night audit resumed.', intent: 'settled' },
      );
    },
    onError: (err) =>
      setMessage({
        text: classifiedUserMessage(asClassified(err), { fallback: 'Resume failed.' }),
        intent: 'exception',
      }),
    onSettled: () => invalidateNightAudit(queryClient, propertyId),
  });

  // A hotel gains several reports a night, so one date shows at a time, newest first.
  const reportDates = [...new Set(status?.reports.map((report) => report.businessDate))]
    .sort()
    .reverse();
  const shownReportDate =
    reportDate && reportDates.includes(reportDate) ? reportDate : (reportDates[0] ?? null);
  const reports = (status?.reports ?? [])
    .filter((report) => report.businessDate === shownReportDate)
    .sort((a, b) => b.generatedAt - a.generatedAt);

  return (
    <div className="ui-page-stack night-audit-screen" data-testid="night-audit-screen">
      <PageHeader
        title="Night audit"
        subtitle={
          status ? (
            <>
              Business date {date(status.businessDate)}
            </>
          ) : undefined
        }
      />
      <Tabs label="Night audit">
        {STAGES.map((item) => (
          <Link
            key={item.id}
            className="ui-tab"
            to="/night-audit"
            aria-current={stage === item.id ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              setStageChoice(item.id);
            }}
          >
            {item.label}
          </Link>
        ))}
      </Tabs>
      {message ? (
        <Alert intent={message.intent} data-testid="night-audit-message">
          {message.text}
        </Alert>
      ) : null}
      {runEnded ? (
        <Alert intent={runEnded.intent} data-testid="night-audit-run-ended">
          {runEnded.text}
        </Alert>
      ) : null}
      {statusQuery.isPending && !status ? (
        <Card>
          <CardContent>
            <Skeleton label="Loading night audit" lines={5} />
          </CardContent>
        </Card>
      ) : null}
      {statusQuery.isError && !status ? (
        <Alert data-testid="night-audit-status-error">
          {classifiedUserMessage(asClassified(statusQuery.error), {
            fallback: 'Could not load night audit status.',
          })}
        </Alert>
      ) : null}
      {status && stage === 'checks' ? (
        <ChecksStage
          status={status}
          today={today}
          canConfigure={canConfigure}
          onRefresh={() => void statusQuery.refetch()}
        />
      ) : null}
      {status && stage === 'run' ? (
        <Card>
          <CardHeader>
            <CardTitle>Audit steps for {status.timelineDate}</CardTitle>
          </CardHeader>
          <CardContent>
            {status.halted ? (
              <Alert data-testid="audit-banner">
                Night audit halted — review the failed step, then Retry or Resume.
              </Alert>
            ) : null}
            {anyRunning && !status.halted ? (
              <Badge rung="attention" data-testid="audit-banner">
                Night audit running
              </Badge>
            ) : null}
            {warns.length > 0 ? (
              <Alert intent="attention" data-testid="night-audit-warn">
                These checks still need attention: {warns.join(', ')}.
              </Alert>
            ) : null}
            <div className="ui-row">
              <Button
                type="button"
                intent="primary"
                disabled={runDisabled}
                onClick={() => runMutation.mutate()}
              >
                Run night audit
              </Button>
              <Button type="button" disabled={!resumeEnabled} onClick={() => resumeMutation.mutate()}>
                Resume
              </Button>
              {runDisabledCopy ? <p className="muted">{runDisabledCopy}</p> : null}
            </div>
          </CardContent>
          <CardContent flush>
            <div className="night-audit__table">
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Step</DataTableHeaderCell>
                    <DataTableHeaderCell>Status</DataTableHeaderCell>
                    <DataTableHeaderCell>Detail</DataTableHeaderCell>
                    <DataTableHeaderCell />
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {status.steps.map((step) => {
                    const detail = stepDetail(step.error, step.attempt);
                    return (
                      <DataTableRow key={step.step}>
                        <DataTableCell>{STEP_LABELS[step.step] ?? step.step}</DataTableCell>
                        <DataTableCell>
                          <Badge
                            rung={
                              step.status === 'PENDING'
                                ? 'attention'
                                : nightAuditStepSeverity(step.status)
                            }
                          >
                            {auditStepLabel(step.status)}
                          </Badge>
                        </DataTableCell>
                        <DataTableCell>
                          {detail ?? <span className="muted">—</span>}
                        </DataTableCell>
                        <DataTableCell>
                          {failedStep?.step === step.step ? (
                            <Button type="button" onClick={() => retryMutation.mutate(step.step)}>
                              Retry
                            </Button>
                          ) : null}
                        </DataTableCell>
                      </DataTableRow>
                    );
                  })}
                </DataTableBody>
              </DataTable>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {stage === 'close-out' ? (
        <>
          {status ? (
            <Card>
              <CardHeader>
                <CardTitle>Reports</CardTitle>
              </CardHeader>
              <CardContent>
                {reports.length === 0 ? (
                  <EmptyState data-testid="night-audit-reports-empty" title="No reports yet." />
                ) : (
                  <div className="ui-stack">
                    <Field
                      label="Report date"
                      control={
                        <NativeSelect
                          value={shownReportDate ?? ''}
                          onChange={(event) => {
                            setReportDate(event.target.value);
                            setOpenReport(null);
                          }}
                        >
                          {reportDates.map((reportDay) => (
                            <option key={reportDay} value={reportDay}>
                              {date(reportDay)}
                            </option>
                          ))}
                        </NativeSelect>
                      }
                    />
                    <ul className="night-audit__reports">
                      {reports.map((report) => (
                        <li key={`${report.businessDate}:${report.reportId}`}>
                          <Button
                            type="button"
                            onClick={() =>
                              setOpenReport({
                                businessDate: report.businessDate,
                                reportId: report.reportId,
                              })
                            }
                          >
                            {titleCaseReportId(report.reportId)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
              {reportQuery.data ? (
                <CardContent flush>
                  <div className="night-audit__report-table">
                    <DataTable data-testid="report-table">
                      <DataTableBody>
                        {Object.entries(reportQuery.data)
                          .filter(([, value]) => typeof value !== 'object' || value === null)
                          .map(([key, value]) => (
                            <DataTableRow key={key}>
                              <DataTableHeaderCell>
                                {REPORT_KEY_LABELS[key] ?? key}
                              </DataTableHeaderCell>
                              <DataTableCell>{formatReportCell(key, value, money, date)}</DataTableCell>
                            </DataTableRow>
                          ))}
                      </DataTableBody>
                    </DataTable>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Check log</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckLog
                isError={logQuery.isError}
                isSuccess={logQuery.isSuccess}
                error={logQuery.error}
                log={logQuery.data}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ChecksStage(props: {
  status: NightAuditStatus;
  today: string | null;
  canConfigure: boolean;
  onRefresh: () => void;
}) {
  const { date } = useFormat();
  const { status } = props;
  const dayStillOpen = props.today != null && status.businessDate >= props.today;
  const rows: Array<{
    id: string;
    count: number | null;
    outcome: OutcomeWord;
    action: { to: string; label: string } | null;
  }> = [
    {
      id: 'queued_commands',
      count: status.pendingOpenCount,
      outcome: status.pendingOpenCount > 0 ? 'Fail' : 'Clear',
      action: null,
    },
    {
      id: 'open_exceptions',
      count: status.closingExceptionCount,
      outcome: status.closingExceptionCount > 0 ? 'Fail' : 'Clear',
      action: actionFor('open_exceptions', status.businessDate),
    },
    ...status.checks.map((row) => ({
      id: row.checkId,
      count: row.severity === 'off' ? null : row.count,
      outcome: checkOutcomeWord(row.severity, row.count),
      action: actionFor(row.checkId, status.businessDate),
    })),
  ];

  return (
    <Card data-testid="night-audit-checks">
      <CardHeader>
        <CardTitle>Checks</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Closing date {date(status.businessDate)}</p>
        {dayStillOpen ? (
          <Alert intent="informational">The day is still open and the counts will change.</Alert>
        ) : null}
        <div className="ui-row">
          <Button type="button" onClick={props.onRefresh}>
            Refresh
          </Button>
          {props.canConfigure ? (
            <Link className="ui-link-btn" to="/settings/property">
              Settings
            </Link>
          ) : null}
        </div>
      </CardContent>
      <CardContent flush>
        <div className="night-audit__table">
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Check</DataTableHeaderCell>
                <DataTableHeaderCell>Count</DataTableHeaderCell>
                <DataTableHeaderCell>Outcome</DataTableHeaderCell>
                <DataTableHeaderCell>Action</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    {CHECK_LABELS[row.id as keyof typeof CHECK_LABELS] ?? row.id}
                  </DataTableCell>
                  <DataTableCell>
                    {row.outcome === 'Off' || row.count == null ? null : row.count}
                  </DataTableCell>
                  <DataTableCell>
                    <Badge rung={outcomeRung(row.outcome)}>{row.outcome}</Badge>
                  </DataTableCell>
                  <DataTableCell>
                    {row.action ? (
                      <Link className="ui-link-btn ui-link-btn--sm" to={row.action.to}>
                        {row.action.label}
                      </Link>
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      </CardContent>
    </Card>
  );
}

function CheckLog(props: {
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  log: NightAuditCheckLog | undefined;
}) {
  const { date } = useFormat();
  if (props.isError) {
    return (
      <Alert data-testid="night-audit-check-log-error">
        {classifiedUserMessage(asClassified(props.error), {
          fallback: 'Could not load the check log.',
        })}
      </Alert>
    );
  }
  if (!props.isSuccess || !props.log) {
    return <Skeleton data-testid="night-audit-check-log-loading" />;
  }
  if (props.log.dates.length === 0) {
    return <EmptyState data-testid="night-audit-check-log-empty" title="No check log yet." />;
  }
  return (
    <div className="night-audit__table">
      <DataTable data-testid="night-audit-check-log">
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Date</DataTableHeaderCell>
            <DataTableHeaderCell>Attempt</DataTableHeaderCell>
            <DataTableHeaderCell>Result</DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {props.log.dates.flatMap((dateRow) =>
            dateRow.attempts.map((attempt) => {
              const open = attempt.checks.filter((check) => check.count > 0);
              return (
                <DataTableRow key={`${dateRow.businessDate}:${attempt.attempt}`}>
                  <DataTableCell>{date(dateRow.businessDate)}</DataTableCell>
                  <DataTableCell>{attempt.attempt}</DataTableCell>
                  <DataTableCell>
                    {open.length === 0 ? (
                      'All clear'
                    ) : (
                      <ul>
                        {open.map((check) => (
                          <li key={check.checkId}>
                            {CHECK_LABELS[check.checkId] ?? check.checkId}: {check.count}{' '}
                            {SEVERITY_WORD[check.severity]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </DataTableCell>
                </DataTableRow>
              );
            }),
          )}
        </DataTableBody>
      </DataTable>
    </div>
  );
}
