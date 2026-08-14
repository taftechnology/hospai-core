import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, tenant } from '../client.js';
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
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['night-audit', propertyId] });
    },
  });

  return (
    <section data-testid="night-audit-screen" className="panel">
      <h1>Night audit</h1>
      {statusQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {status ? (
        <>
          <Badge rung={bannerSev} data-testid="audit-banner">
            {status.halted
              ? 'Night audit halted'
              : status.pendingOpenCount > 0
                ? 'Pending commands still open'
                : 'Night audit idle'}
          </Badge>
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
            <Button type="button" disabled={runDisabled} onClick={() => runMutation.mutate()}>
              Run night audit
            </Button>{' '}
            <Button
              type="button"
              disabled={!resumeEnabled}
              onClick={() => resumeMutation.mutate()}
            >
              Resume
            </Button>
          </p>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Step</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell />
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {status.steps.map((step) => (
                <DataTableRow key={step.step}>
                  <DataTableCell>{step.step}</DataTableCell>
                  <DataTableCell rung={nightAuditStepSeverity(step.status)}>
                    {step.status}
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
          <h2>Reports</h2>
          <ul>
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
          {reportQuery.data ? (
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
          ) : null}
        </>
      ) : null}
    </section>
  );
}
