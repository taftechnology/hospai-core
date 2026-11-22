import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ACCOUNTING_JOURNAL_MAX_DAYS,
  ACCOUNTING_LEDGER_MAP_KEY,
  ACCOUNTING_LEDGER_NAME_MAX,
  AccountingLedgerMapSchema,
  readAccountingLedgerMap,
  type AccountingLedgerMap,
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
  Field,
  Input,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  accountingJournalKeyPrefix,
  accountingJournalQueryKey,
  journalAccountKeys,
  settingsAccountKeys,
} from '../reports/accounting-journal-model.js';
import { addDaysIso } from '../reports/report-model.js';
import { usePropertyBusinessDate } from '../shell/use-business-date.js';
import type { DomainKey } from './settings-domain-fields.js';

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

type Draft = Record<string, { ledgerName: string; ledgerGroup: string }>;

function toDraft(map: AccountingLedgerMap): Draft {
  return Object.fromEntries(
    map.ledgers.map((e) => [e.accountKey, { ledgerName: e.ledgerName, ledgerGroup: e.ledgerGroup ?? '' }]),
  );
}

/** A map in a form that does not depend on the order of its rows. */
function canon(map: AccountingLedgerMap): string {
  return JSON.stringify(
    [...map.ledgers]
      .sort((a, b) => (a.accountKey < b.accountKey ? -1 : 1))
      .map((e) => [e.accountKey, e.ledgerName, e.ledgerGroup ?? '']),
  );
}

/** The map to store: only keys with a ledger name, in the order the table lists them. */
function toMap(draft: Draft, order: readonly string[]): AccountingLedgerMap {
  const ledgers: AccountingLedgerMap['ledgers'] = [];
  for (const accountKey of order) {
    const row = draft[accountKey];
    const ledgerName = row?.ledgerName.trim() ?? '';
    if (!row || ledgerName === '') continue;
    const ledgerGroup = row.ledgerGroup.trim();
    ledgers.push(ledgerGroup === '' ? { accountKey, ledgerName } : { accountKey, ledgerName, ledgerGroup });
  }
  return { ledgers };
}

/**
 * Settings → Accounting (R4.12 Part A). Edits the key `accounting.ledger_map`, which names each
 * HospAI account key in the hotel's own books. It lists the fixed keys and every key the last 31
 * days' journals used. Reason-required, like the other domain settings. Names apply to every export
 * from now on; stored journals do not change.
 */
export function AccountingSettings(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void | Promise<void>;
  reasonControl: ReactNode;
}) {
  const queryClient = useQueryClient();
  const stored = useMemo(
    () => readAccountingLedgerMap(lookup(props.keys, ACCOUNTING_LEDGER_MAP_KEY)),
    [props.keys],
  );
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setDraft(toDraft(stored)), [stored]);

  const businessDate = usePropertyBusinessDate();
  const to = businessDate ? addDaysIso(businessDate, -1) : '';
  const from = to ? addDaysIso(to, -(ACCOUNTING_JOURNAL_MAX_DAYS - 1)) : '';
  const seenQ = useQuery({
    queryKey: accountingJournalQueryKey(props.propertyId, from, to),
    queryFn: () => api.getAccountingJournal(props.propertyId, { from, to }),
    enabled: to !== '',
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const seen = journalAccountKeys(seenQ.data);
  const order = useMemo(() => settingsAccountKeys(seen, stored), [seen.join('|'), stored]);

  const next = toMap(draft, order);
  const dirty = canon(next) !== canon(stored);
  const reasonOk = props.reason.trim().length > 0;
  const parsed = AccountingLedgerMapSchema.safeParse(next);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: ACCOUNTING_LEDGER_MAP_KEY,
        value: next,
        reason: props.reason,
      }),
    onSuccess: async () => {
      setError(null);
      setNotice('Accounting settings saved.');
      await props.onSaved();
      await queryClient.invalidateQueries({ queryKey: accountingJournalKeyPrefix(props.propertyId) });
    },
    onError: (err) => {
      setNotice(null);
      setError(classifiedUserMessage(asClassified(err), { fallback: 'Could not save the accounting settings.' }));
    },
  });

  const setRow = (accountKey: string, patch: Partial<Draft[string]>) =>
    setDraft({
      ...draft,
      [accountKey]: { ledgerName: '', ledgerGroup: '', ...draft[accountKey], ...patch },
    });

  const blocker = parsed.success ? null : 'A ledger name or group is too long, or a key is repeated.';

  return (
    <>
      <Alert intent="attention">
        <span className="ui-alert__title">A reason is required before saving</span>
        <span>Every configuration change is written to the audit log with this note.</span>
      </Alert>
      <Card>
        <CardContent>{props.reasonControl}</CardContent>
      </Card>

      {error ? <Alert intent="exception" data-testid="accounting-settings-error">{error}</Alert> : null}
      {notice ? <Alert intent="settled" data-testid="accounting-settings-success">{notice}</Alert> : null}
      {seenQ.isError ? (
        <Alert intent="informational" data-testid="accounting-settings-keys-note">
          <span>
            The accounts used in recent days could not be read, so only the fixed accounts are listed. The{' '}
            <Link to="/accounting">Accounting</Link> page needs the accounting permission.
          </span>
        </Alert>
      ) : null}

      <Card data-testid="accounting-settings-ledgers">
        <CardHeader>
          <CardTitle>Ledger names</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="muted">
            Each account key is one line in the daily journal. Give it the name your books use. A key left empty
            exports with no ledger name and is listed as unmapped. Stored days keep their figures; only the names
            change.
          </p>
        </CardContent>
        <CardContent flush>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Account key</DataTableHeaderCell>
                <DataTableHeaderCell>Ledger name</DataTableHeaderCell>
                <DataTableHeaderCell>Group</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {order.map((accountKey) => (
                <DataTableRow key={accountKey} data-testid={`accounting-settings-row-${accountKey}`}>
                  <DataTableCell>{accountKey}</DataTableCell>
                  <DataTableCell>
                    <Field
                      label={<VisuallyHidden>Ledger name for {accountKey}</VisuallyHidden>}
                      control={
                        <Input
                          value={draft[accountKey]?.ledgerName ?? ''}
                          maxLength={ACCOUNTING_LEDGER_NAME_MAX}
                          autoComplete="off"
                          onChange={(e) => setRow(accountKey, { ledgerName: e.target.value })}
                        />
                      }
                    />
                  </DataTableCell>
                  <DataTableCell>
                    <Field
                      label={<VisuallyHidden>Group for {accountKey}</VisuallyHidden>}
                      control={
                        <Input
                          value={draft[accountKey]?.ledgerGroup ?? ''}
                          maxLength={ACCOUNTING_LEDGER_NAME_MAX}
                          autoComplete="off"
                          onChange={(e) => setRow(accountKey, { ledgerGroup: e.target.value })}
                        />
                      }
                    />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </CardContent>
      </Card>

      {blocker ? <Alert intent="attention" data-testid="accounting-settings-blocker">{blocker}</Alert> : null}
      {dirty && !reasonOk ? <p className="muted settings-property__status">Enter a reason to save changes.</p> : null}
      <div>
        <Button
          type="button"
          intent="primary"
          data-testid="accounting-settings-save"
          disabled={!dirty || !reasonOk || blocker !== null || save.isPending}
          onClick={() => {
            setNotice(null);
            save.mutate();
          }}
        >
          Save accounting settings
        </Button>
      </div>
    </>
  );
}
