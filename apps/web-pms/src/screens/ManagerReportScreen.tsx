import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ClassifiedError } from '@hospai/client-core';
import { MANAGER_REPORT_CATALOG_ENTRY, type ManagerReportColumnId } from '@hospai/contracts';
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
  PageHeader,
  Skeleton,
  Toolbar,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { downloadTextFile } from '../reports/download-file.js';
import {
  MANAGER_COLUMN_IDS,
  MANAGER_COLUMN_WORDS,
  buildManagerReportCsv,
  formatManagerValue,
  managerColumn,
  managerReportCsvFileName,
  managerReportQueryKey,
  managerSections,
  notRecordedNotes,
  nothingRecorded,
  type ManagerCellFormat,
} from '../reports/manager-report-model.js';
import { addDaysIso } from '../reports/report-model.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertyBusinessDate } from '../shell/use-business-date.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Dates listed in a not-recorded note before it says "and N more". */
const NOTE_DATE_LIMIT = 8;

function errorCopy(err: unknown): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback: 'Could not run the Manager Report.' })
    : 'Could not run the Manager Report.';
}

/**
 * `/reports/manager` — Day, month to date and fiscal year to date for one closed business date
 * (R4.32). The figures are the statistics rows night audit stored when each date closed; this
 * screen only reads and lays them out. Print and CSV as the other reports.
 */
export function ManagerReportScreen() {
  const propertyId = tenant.propertyId;
  const { date, dateTime, money, fmt } = useFormat();
  const { subtitle } = usePropertySubtitle(MANAGER_REPORT_CATALOG_ENTRY.description);
  // The open business date trails the calendar until night audit rolls it; the last closed date is the day before.
  const businessDate = usePropertyBusinessDate();
  const defaultDate = businessDate ? addDaysIso(businessDate, -1) : null;

  const [draft, setDraft] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const formDate = draft ?? defaultDate ?? '';
  const runDate = applied ?? defaultDate;

  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const propertyName = propertyQ.data && 'property' in propertyQ.data ? propertyQ.data.property.name : null;

  const reportQ = useQuery({
    queryKey: managerReportQueryKey(propertyId, runDate ?? ''),
    queryFn: () => api.getManagerReport(propertyId, runDate!),
    enabled: runDate !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const result = reportQ.data;

  const cell: ManagerCellFormat = {
    money,
    ratioMoney: (minor, decimals) => {
      try {
        return new Intl.NumberFormat(fmt.locale, {
          style: 'currency',
          currency: result?.currency ?? fmt.currency ?? 'USD',
          currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
          .format(minor / 100)
          .replace(/\u00a0/g, ' ');
      } catch {
        return money(minor);
      }
    },
  };

  function run() {
    if (!ISO_DATE.test(formDate)) {
      setFormError('Choose a date.');
      return;
    }
    setFormError(null);
    if (formDate === runDate) void reportQ.refetch();
    else setApplied(formDate);
  }

  const canOutput = Boolean(result && !nothingRecorded(result));

  function downloadCsv() {
    if (!result) return;
    downloadTextFile(managerReportCsvFileName(result.date), buildManagerReportCsv(result));
  }

  function columnHead(id: ManagerReportColumnId): ReactNode {
    const c = managerColumn(result!, id);
    return (
      <>
        {MANAGER_COLUMN_WORDS[id]}
        <br />
        <span className="muted">{c.from === c.to ? date(c.to) : `${date(c.from)} to ${date(c.to)}`}</span>
      </>
    );
  }

  let body: ReactNode = null;
  if (reportQ.isError) {
    body = <Alert data-testid="manager-error">{errorCopy(reportQ.error)}</Alert>;
  } else if (!result) {
    body = <Skeleton />;
  } else if (nothingRecorded(result)) {
    body = (
      <EmptyState
        data-testid="manager-none"
        kind="nomatch"
        title="Nothing recorded for this date"
        description={`Night audit has not stored statistics for ${date(result.date)}. Choose a date the audit has closed.`}
      />
    );
  }

  const notes = result ? notRecordedNotes(result) : [];

  return (
    <div className="board-page">
      <PageHeader
        title={MANAGER_REPORT_CATALOG_ENTRY.title}
        subtitle={subtitle}
        back={<Link to="/reports">Reports</Link>}
      />
      <Card>
        <Toolbar>
          <Field
            label="Business date"
            hint="A date the night audit has closed."
            size="sm"
            error={formError ?? undefined}
            control={
              <Input
                type="date"
                value={formDate}
                data-testid="manager-date"
                onChange={(e) => setDraft(e.target.value)}
              />
            }
          />
        </Toolbar>
        <Toolbar>
          <Button intent="primary" onClick={run} disabled={runDate === null && formDate === ''} data-testid="manager-run">
            Run
          </Button>
          <Button onClick={() => window.print()} disabled={!canOutput} data-testid="manager-print">
            Print
          </Button>
          <Button onClick={downloadCsv} disabled={!canOutput} data-testid="manager-csv">
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
          <div className="report-card" data-testid="manager-card">
            <CardHeader>
              <CardTitle>{MANAGER_REPORT_CATALOG_ENTRY.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="report-card__property" data-testid="manager-property">
                {propertyName ?? ''}
              </p>
              <p className="muted" data-testid="manager-params">
                {date(result!.date)} · fiscal year from {date(result!.fiscalYearStart)}
              </p>
              <p className="muted" data-testid="manager-generated">
                Generated {dateTime(Date.parse(result!.generatedAt))} · month and year columns total each day, so
                room and guest counts are nights
              </p>
              {notes.length > 0 ? (
                <Alert intent="attention" data-testid="manager-not-recorded">
                  <span className="ui-alert__title">Some days are not recorded</span>
                  {notes.map((n) => (
                    <span key={n.id} data-testid={`manager-not-recorded-${n.id}`}>
                      {MANAGER_COLUMN_WORDS[n.id]}: {n.dates.slice(0, NOTE_DATE_LIMIT).map((d) => date(d)).join(', ')}
                      {n.dates.length > NOTE_DATE_LIMIT ? ` and ${n.dates.length - NOTE_DATE_LIMIT} more` : ''}. Days
                      closed before these statistics existed have no figures.
                    </span>
                  ))}
                </Alert>
              ) : null}
            </CardContent>
            <CardContent flush>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Row</DataTableHeaderCell>
                    {MANAGER_COLUMN_IDS.map((id) => (
                      <DataTableHeaderCell key={id} align="right">
                        {columnHead(id)}
                      </DataTableHeaderCell>
                    ))}
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {managerSections(result!.rows).map((s) => (
                    <SectionRows key={s.section} title={s.title} testId={s.section}>
                      {s.rows.map((row, i) => (
                        <DataTableRow key={`${row.rowId}-${i}`} data-testid={`manager-row-${row.rowId}`}>
                          <DataTableCell>{row.label}</DataTableCell>
                          {MANAGER_COLUMN_IDS.map((id) => (
                            <DataTableCell key={id} align="right">
                              <span className="ui-num">{formatManagerValue(row, row.values[id], cell)}</span>
                            </DataTableCell>
                          ))}
                        </DataTableRow>
                      ))}
                    </SectionRows>
                  ))}
                </DataTableBody>
              </DataTable>
            </CardContent>
          </div>
        </Card>
      )}
    </div>
  );
}

function SectionRows(props: { title: string; testId: string; children: ReactNode }) {
  return (
    <>
      <DataTableRow data-testid={`manager-section-${props.testId}`}>
        <DataTableHeaderCell colSpan={4} scope="colgroup">
          {props.title}
        </DataTableHeaderCell>
      </DataTableRow>
      {props.children}
    </>
  );
}
