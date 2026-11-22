import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ClassifiedError } from '@hospai/client-core';
import type { AccountingJournalDay } from '@hospai/contracts';
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
import {
  accountingJournalCsvFileName,
  accountingJournalQueryKey,
  accountingRangeProblem,
  buildAccountingJournalCsv,
  missingDays,
  recordedDays,
} from '../reports/accounting-journal-model.js';
import { downloadTextFile } from '../reports/download-file.js';
import { addDaysIso } from '../reports/report-model.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertyBusinessDate } from '../shell/use-business-date.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

function errorCopy(err: unknown): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback: 'Could not load the journal.' })
    : 'Could not load the journal.';
}

/**
 * `/accounting` — the daily journal night audit stored when each date closed (R4.12 Part A). This
 * screen reads and lays out the stored rows; nothing here is recomputed. The CSV is built here, in
 * the browser, like the report CSVs.
 */
export function AccountingScreen() {
  const propertyId = tenant.propertyId;
  const { date, money } = useFormat();
  const { subtitle } = usePropertySubtitle('Daily journal');
  // The open business date trails the calendar until night audit rolls it; the last closed date is the day before.
  const businessDate = usePropertyBusinessDate();
  const defaultDate = businessDate ? addDaysIso(businessDate, -1) : null;

  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = draft ?? (defaultDate ? { from: defaultDate, to: defaultDate } : { from: '', to: '' });
  const run = applied ?? (defaultDate ? { from: defaultDate, to: defaultDate } : null);

  const journalQ = useQuery({
    queryKey: accountingJournalQueryKey(propertyId, run?.from ?? '', run?.to ?? ''),
    queryFn: () => api.getAccountingJournal(propertyId, run!),
    enabled: run !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const result = journalQ.data;

  function apply() {
    const problem = accountingRangeProblem(form.from, form.to);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    if (run && form.from === run.from && form.to === run.to) void journalQ.refetch();
    else setApplied(form);
  }

  const canDownload = Boolean(result && recordedDays(result).length > 0);

  function downloadCsv() {
    if (!result || !run) return;
    downloadTextFile(accountingJournalCsvFileName(run.from, run.to), buildAccountingJournalCsv(result));
  }

  function dayCard(day: AccountingJournalDay) {
    return (
      <Card key={day.businessDate} data-testid={`accounting-day-${day.businessDate}`}>
        <CardHeader>
          <CardTitle>{date(day.businessDate)}</CardTitle>
        </CardHeader>
        {day.status === 'not_recorded' ? (
          <CardContent>
            <p className="muted" data-testid={`accounting-none-${day.businessDate}`}>
              No journal was stored for this date. Dates closed before the journal existed have none.
            </p>
          </CardContent>
        ) : (
          <>
            {day.status === 'unbalanced' ? (
              <CardContent>
                <Alert intent="exception" data-testid={`accounting-unbalanced-${day.businessDate}`}>
                  <span className="ui-alert__title">This day does not balance</span>
                  <span>
                    Debits {money(day.debitTotalMinor)} and credits {money(day.creditTotalMinor)} differ. Check the
                    folio lines of this date before you post it.
                  </span>
                </Alert>
              </CardContent>
            ) : null}
            <CardContent flush>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Account key</DataTableHeaderCell>
                    <DataTableHeaderCell>Ledger</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Debit</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Credit</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {day.lines.map((l) => (
                    <DataTableRow key={l.accountKey} data-testid={`accounting-line-${day.businessDate}-${l.accountKey}`}>
                      <DataTableCell>{l.accountKey}</DataTableCell>
                      <DataTableCell>
                        {l.ledgerName === '' ? <span className="muted">Not mapped</span> : l.ledgerName}
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{l.debitMinor === 0 ? '' : money(l.debitMinor)}</span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{l.creditMinor === 0 ? '' : money(l.creditMinor)}</span>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                  <DataTableRow data-testid={`accounting-total-${day.businessDate}`}>
                    <DataTableHeaderCell colSpan={2}>Total</DataTableHeaderCell>
                    <DataTableCell align="right">
                      <span className="ui-num">{money(day.debitTotalMinor)}</span>
                    </DataTableCell>
                    <DataTableCell align="right">
                      <span className="ui-num">{money(day.creditTotalMinor)}</span>
                    </DataTableCell>
                  </DataTableRow>
                </DataTableBody>
              </DataTable>
            </CardContent>
          </>
        )}
      </Card>
    );
  }

  let body;
  if (journalQ.isError) {
    body = (
      <Card>
        <CardContent>
          <Alert data-testid="accounting-error">{errorCopy(journalQ.error)}</Alert>
        </CardContent>
      </Card>
    );
  } else if (!result) {
    body = (
      <Card>
        <CardContent>
          <Skeleton />
        </CardContent>
      </Card>
    );
  } else if (recordedDays(result).length === 0) {
    body = (
      <Card>
        <CardContent>
          <EmptyState
            data-testid="accounting-none"
            kind="nomatch"
            title="No journal for these dates"
            description="Night audit stores the journal when it closes a date. Choose dates the audit has closed since the journal was introduced."
          />
        </CardContent>
      </Card>
    );
  } else {
    body = (
      <>
        {result.unmappedKeys.length > 0 ? (
          <Alert intent="attention" data-testid="accounting-unmapped">
            <span className="ui-alert__title">Some accounts have no ledger name</span>
            <span data-testid="accounting-unmapped-keys">{result.unmappedKeys.join(', ')}</span>
            <span>
              Name them in <Link to="/settings/accounting">Settings, Accounting</Link>. They export with an empty
              ledger.
            </span>
          </Alert>
        ) : null}
        {missingDays(result).length > 0 ? (
          <Alert intent="informational" data-testid="accounting-missing">
            <span>
              No journal for {missingDays(result).map((d) => date(d.businessDate)).join(', ')}.
            </span>
          </Alert>
        ) : null}
        {result.days.map(dayCard)}
      </>
    );
  }

  return (
    <div className="board-page">
      <PageHeader title="Accounting" subtitle={subtitle} />
      <Card>
        <Toolbar>
          <Field
            label="From"
            hint="A date the night audit has closed."
            size="sm"
            error={formError ?? undefined}
            control={
              <Input
                type="date"
                value={form.from}
                data-testid="accounting-from"
                onChange={(e) => setDraft({ ...form, from: e.target.value })}
              />
            }
          />
          <Field
            label="To"
            hint="At most 31 days."
            size="sm"
            control={
              <Input
                type="date"
                value={form.to}
                data-testid="accounting-to"
                onChange={(e) => setDraft({ ...form, to: e.target.value })}
              />
            }
          />
        </Toolbar>
        <Toolbar>
          <Button intent="primary" onClick={apply} disabled={run === null && form.from === ''} data-testid="accounting-run">
            Show
          </Button>
          <Button onClick={downloadCsv} disabled={!canDownload} data-testid="accounting-csv">
            Download CSV
          </Button>
        </Toolbar>
      </Card>
      {body}
    </div>
  );
}
