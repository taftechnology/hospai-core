import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  PageHeader,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { STEP_LABELS } from '../copy/night-audit-step-labels.js';
import { formatMinor } from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import {
  nightAuditBannerSeverity,
  nightAuditStepSeverity,
} from '../status/night-audit-severity.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';

const MONEY_KEYS = new Set([
  'roomNet',
  'taxTotal',
  'openingFloat',
  'closingCount',
  'variance',
  'ledgerAmountMinor',
]);

type NightAuditStatus = {
  ok: true;
  businessDate: string;
  timelineDate: string;
  halted: boolean;
  pendingOpenCount: number;
  closingExceptionCount: number;
  steps: Array<{
    step: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    attempt: number;
    startedAt: number | null;
    completedAt: number | null;
    error: string | null;
  }>;
  reports: Array<{ reportId: string; businessDate: string; generatedAt: number }>;
};

const REPORT_KEY_LABELS: Record<string, string> = {
  roomNet: 'Room net',
  taxTotal: 'Tax',
  businessDate: 'Business date',
};

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

function runDisabledReason(
  status: NightAuditStatus | undefined,
  today: string | null,
  anyRunning: boolean,
): string | null {
  if (!status) return 'Loading night audit status…';
  if (status.halted) return 'Night audit is halted — resolve the failed step first.';
  if (anyRunning) return 'Night audit is already running.';
  if (today == null) return 'Property time zone unavailable.';
  if (status.businessDate >= today) return 'Business date is already current — nothing to roll.';
  return null;
}

function formatReportCell(key: string, value: unknown): string {
  if (typeof value === 'number' && (MONEY_KEYS.has(key) || key.endsWith('Minor'))) {
    return formatMinor(value);
  }
  if (value == null) return '';
  if (typeof value === 'object') return '';
  return String(value);
}

export function NightAuditScreen() {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const timeZone = usePropertyTimeZone();
  const [openReport, setOpenReport] = useState<{
    businessDate: string;
    reportId: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['night-audit', propertyId],
    queryFn: () => api.getNightAudit(propertyId),
    retry: false,
  });

  const reportQuery = useQuery({
    queryKey: [
      'night-audit-report',
      propertyId,
      openReport?.businessDate,
      openReport?.reportId,
    ],
    queryFn: () =>
      api.getNightAuditReport(propertyId, openReport!.businessDate, openReport!.reportId),
    enabled: openReport != null,
    retry: false,
  });

  const status = statusQuery.data as NightAuditStatus | undefined;
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const anyRunning = Boolean(status?.steps.some((s) => s.status === 'RUNNING'));
  const failedStep = status?.steps.find((s) => s.status === 'FAILED');
  const runDisabled =
    !status ||
    status.halted ||
    anyRunning ||
    today == null ||
    status.businessDate >= today;
  const runDisabledCopy = runDisabledReason(status, today, anyRunning);
  const resumeEnabled = Boolean(status && (status.halted || anyRunning));
  const bannerSev = status
    ? nightAuditBannerSeverity({
        halted: status.halted,
        pendingOpenCount: status.pendingOpenCount,
      })
    : 'neutral';

  const runMutation = useMutation({
    mutationFn: () =>
      api.runNightAudit(propertyId, `night-audit:run:${propertyId}:${status!.businessDate}`),
    onSuccess: () => setMessage('Night audit started.'),
    onError: (err) =>
      setMessage(classifiedUserMessage(asClassified(err), { fallback: 'Night audit failed.' })),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['night-audit', propertyId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (step: string) =>
      api.retryNightAuditStep(
        propertyId,
        { businessDate: status!.timelineDate, step },
        `night-audit:retry:${propertyId}:${status!.timelineDate}:${step}`,
      ),
    onSuccess: () => setMessage('Step retry queued.'),
    onError: (err) =>
      setMessage(classifiedUserMessage(asClassified(err), { fallback: 'Retry failed.' })),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['night-audit', propertyId] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      api.resolveNightAuditHalt(
        propertyId,
        status!.timelineDate,
        `night-audit:resolve-halt:${propertyId}:${status!.timelineDate}`,
      ),
    onSuccess: () => setMessage('Night audit resumed.'),
    onError: (err) =>
      setMessage(classifiedUserMessage(asClassified(err), { fallback: 'Resume failed.' })),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['night-audit', propertyId] });
    },
  });

  return (
    <div className="ui-page-stack night-audit-screen">
      <PageHeader
        title="Night audit"
        subtitle={
          status ? (
            <>
              Business date {status.businessDate}
              <span className="sep">·</span>
              roll to {status.timelineDate}
            </>
          ) : undefined
        }
        actions={
          status ? (
            <div className="ui-row ui-row--nowrap">
              <Button
                type="button"
                intent="primary"
                disabled={runDisabled}
                onClick={() => runMutation.mutate()}
              >
                Run night audit
              </Button>
              {runDisabledCopy ? <p className="muted">{runDisabledCopy}</p> : null}
            </div>
          ) : undefined
        }
      />
      {message ? <Alert data-testid="night-audit-message">{message}</Alert> : null}
      <Card data-testid="night-audit-screen">
        {statusQuery.isLoading ? (
          <CardContent>
            <p className="muted">Loading…</p>
          </CardContent>
        ) : null}
        {status ? (
          <>
            <CardHeader>
              <CardTitle>Audit steps</CardTitle>
            </CardHeader>
            <CardContent>
              {status.halted || status.pendingOpenCount > 0 || anyRunning ? (
                <Badge rung={bannerSev} data-testid="audit-banner">
                  {status.halted
                    ? 'Night audit halted — review the failed step, then Retry or Resume.'
                    : status.pendingOpenCount > 0
                      ? 'Pending commands still open'
                      : 'Night audit running'}
                </Badge>
              ) : null}
              <p>
                Closing {status.businessDate}
                {' · '}
                {status.closingExceptionCount} open exceptions.{' '}
                <Link
                  to={`/exceptions?resolution=open&businessDateFrom=${encodeURIComponent(status.businessDate)}&businessDateTo=${encodeURIComponent(status.businessDate)}`}
                >
                  Open exceptions
                </Link>
              </p>
              <p>
                <Button
                  type="button"
                  disabled={!resumeEnabled}
                  onClick={() => resumeMutation.mutate()}
                >
                  Resume
                </Button>
              </p>
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
                    {status.steps.map((step) => (
                      <DataTableRow key={step.step}>
                        <DataTableCell>
                          <span title={step.step}>{STEP_LABELS[step.step] ?? step.step}</span>
                        </DataTableCell>
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
                          {step.error ??
                            (step.attempt > 0 ? (
                              `Attempt ${step.attempt}`
                            ) : (
                              <span className="muted">—</span>
                            ))}
                        </DataTableCell>
                        <DataTableCell>
                          {failedStep?.step === step.step ? (
                            <Button type="button" onClick={() => retryMutation.mutate(step.step)}>
                              Retry
                            </Button>
                          ) : null}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
          </>
        ) : null}
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="night-audit__reports">
              {status.reports.map((r) => (
                <li key={`${r.businessDate}:${r.reportId}`}>
                  <Button
                    type="button"
                    onClick={() =>
                      setOpenReport({ businessDate: r.businessDate, reportId: r.reportId })
                    }
                  >
                    {titleCaseReportId(r.reportId)}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
          {reportQuery.data ? (
            <CardContent flush>
              <div className="night-audit__report-table">
                <DataTable data-testid="report-table">
                  <DataTableBody>
                    {Object.entries(reportQuery.data)
                      .filter(([, v]) => typeof v !== 'object' || v === null)
                      .map(([key, value]) => (
                        <DataTableRow key={key}>
                          <DataTableHeaderCell>{REPORT_KEY_LABELS[key] ?? key}</DataTableHeaderCell>
                          <DataTableCell>{formatReportCell(key, value)}</DataTableCell>
                        </DataTableRow>
                      ))}
                  </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
