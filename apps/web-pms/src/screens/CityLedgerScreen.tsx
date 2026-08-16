import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { formatMinor, parseMajorToMinor } from '../money.js';

type AgingBuckets = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  totalOpenMinor: number;
};

type AccountSummary = {
  accountId: string;
  name: string;
  status: 'active' | 'archived';
  creditLimitMinor: number;
  termsDays: number;
  openBalanceMinor: number;
  aging: AgingBuckets;
};

type AccountEntry = {
  entryId: string;
  kind: 'charge' | 'payment' | 'adjustment';
  amountMinor: number;
  businessDate: string;
  dueDate: string;
  daysOverdue: number;
  source: string;
  reference: string | null;
  createdAt: number;
};

type AccountDetail = AccountSummary & {
  entries: AccountEntry[];
};

function asAccountList(body: unknown): AccountSummary[] {
  if (!body || typeof body !== 'object') return [];
  const accounts = (body as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.filter((row): row is AccountSummary => {
    if (!row || typeof row !== 'object') return false;
    const r = row as AccountSummary;
    return typeof r.accountId === 'string' && typeof r.name === 'string';
  });
}

function asAccountDetail(body: unknown): AccountDetail | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as AccountDetail & { ok?: boolean };
  if (r.ok === false) return null;
  if (typeof r.accountId !== 'string' || typeof r.name !== 'string') return null;
  return {
    ...r,
    entries: Array.isArray(r.entries) ? r.entries : [],
  };
}

function statusRung(status: AccountSummary['status']): 'neutral' | 'informational' {
  return status === 'archived' ? 'informational' : 'neutral';
}

export function CityLedgerScreen() {
  const { accountId } = useParams();
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCreditLimit, setCreateCreditLimit] = useState('0.00');
  const [createTermsDays, setCreateTermsDays] = useState('30');
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [statementJson, setStatementJson] = useState<string | null>(null);

  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
  });
  const canRead = meQ.data ? hasPropertyPermission(meQ.data, 'folio:read') : false;
  const canAdjust = meQ.data ? hasPropertyPermission(meQ.data, 'folio:adjust') : false;

  const listQ = useQuery({
    queryKey: ['city-ledger-accounts', propertyId],
    queryFn: () => api.fetchCityLedgerAccounts(propertyId, { status: 'all' }),
    enabled: Boolean(propertyId) && meQ.isSuccess && canRead,
  });

  const detailQ = useQuery({
    queryKey: ['city-ledger-account', propertyId, accountId],
    queryFn: () => api.fetchCityLedgerAccount(propertyId, accountId!),
    enabled: Boolean(accountId) && meQ.isSuccess && canRead,
  });

  const createAccount = useMutation({
    mutationFn: () =>
      api.createCityLedgerAccount(propertyId, {
        name: createName.trim(),
        creditLimitMinor: parseMajorToMinor(createCreditLimit),
        termsDays: Number(createTermsDays),
        idempotencyKey: `city-ledger:create:${createName.trim()}:${crypto.randomUUID()}`,
      }),
    onSuccess: (result) => {
      const body = result.body as { accountId?: string; name?: string };
      setShowCreate(false);
      setCreateName('');
      setCreateCreditLimit('0.00');
      setCreateTermsDays('30');
      setMessage(`Account "${body.name ?? createName}" created.`);
      void queryClient.invalidateQueries({ queryKey: ['city-ledger-accounts', propertyId] });
      if (typeof body.accountId === 'string') {
        navigate(`/city-ledger/${encodeURIComponent(body.accountId)}`);
      }
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? `Create failed: ${JSON.stringify(err.classified.body)}`
          : 'Create account failed.',
      );
    },
  });

  const receivePayment = useMutation({
    mutationFn: () =>
      api.receiveCityLedgerPayment(propertyId, accountId!, {
        amountMinor: parseMajorToMinor(paymentAmount),
        reference: paymentReference.trim() || null,
        idempotencyKey: `city-ledger:payment:${accountId}:${crypto.randomUUID()}`,
      }),
    onSuccess: () => {
      setShowPayment(false);
      setPaymentAmount('');
      setPaymentReference('');
      setMessage('Payment recorded.');
      void queryClient.invalidateQueries({
        queryKey: ['city-ledger-account', propertyId, accountId],
      });
      void queryClient.invalidateQueries({ queryKey: ['city-ledger-accounts', propertyId] });
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? `Payment failed: ${JSON.stringify(err.classified.body)}`
          : 'Receive payment failed.',
      );
    },
  });

  const generateStatement = useMutation({
    mutationFn: () =>
      api.generateCityLedgerStatement(propertyId, accountId!, {
        idempotencyKey: `city-ledger:statement:${accountId}:${crypto.randomUUID()}`,
      }),
    onSuccess: (result) => {
      const body = result.body as { snapshot?: unknown; statementId?: string };
      setStatementJson(JSON.stringify(body.snapshot ?? body, null, 2));
      setMessage(
        typeof body.statementId === 'string'
          ? `Statement ${body.statementId} generated.`
          : 'Statement generated.',
      );
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? `Statement failed: ${JSON.stringify(err.classified.body)}`
          : err instanceof Error
            ? err.message
            : 'Generate statement failed.',
      );
    },
  });

  const archiveAccount = useMutation({
    mutationFn: () => {
      if (!window.confirm('Archive this account? It cannot receive new charges.')) {
        throw new Error('archive_cancelled');
      }
      return api.archiveCityLedgerAccount(propertyId, accountId!, {
        idempotencyKey: `city-ledger:archive:${accountId}:${crypto.randomUUID()}`,
      });
    },
    onSuccess: () => {
      setMessage('Account archived.');
      void queryClient.invalidateQueries({
        queryKey: ['city-ledger-account', propertyId, accountId],
      });
      void queryClient.invalidateQueries({ queryKey: ['city-ledger-accounts', propertyId] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'archive_cancelled') return;
      setMessage(
        err instanceof ClassifiedError
          ? `Archive failed: ${JSON.stringify(err.classified.body)}`
          : 'Archive account failed.',
      );
    },
  });

  if (!canRead && meQ.isSuccess) {
    return (
      <Card data-testid="city-ledger-screen">
        <Alert>You do not have permission to view city ledger accounts.</Alert>
      </Card>
    );
  }

  if (accountId) {
    const detail = asAccountDetail(detailQ.data?.body);
    const failClosed =
      detailQ.isError &&
      (asClassified(detailQ.error).class === 'fail_closed' ||
        detailQ.error instanceof ClassifiedError);

    return (
      <Card data-testid="city-ledger-detail">
        <header className="board-header">
          <h1>
            <Link to="/city-ledger">City ledger</Link>
            {detail ? ` · ${detail.name}` : ''}
          </h1>
          {detail ? (
            <Badge rung={statusRung(detail.status)}>{detail.status}</Badge>
          ) : null}
        </header>

        {message ? (
          <p role="status" data-testid="city-ledger-message">
            {message}
          </p>
        ) : null}

        {detailQ.isLoading ? <p className="muted">Loading…</p> : null}
        {failClosed ? (
          <Alert>City ledger unavailable — property unreachable.</Alert>
        ) : null}
        {detailQ.isError && !failClosed ? (
          <Alert>Could not load account.</Alert>
        ) : null}

        {detail ? (
          <>
            <dl className="stack-row">
              <div>
                <dt className="muted">Credit limit</dt>
                <dd>{formatMinor(detail.creditLimitMinor)}</dd>
              </div>
              <div>
                <dt className="muted">Terms (days)</dt>
                <dd>{detail.termsDays}</dd>
              </div>
              <div>
                <dt className="muted">Open balance</dt>
                <dd data-testid="city-ledger-open-balance">
                  {formatMinor(detail.openBalanceMinor)}
                </dd>
              </div>
            </dl>

            <h2>Aging</h2>
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Current</DataTableHeaderCell>
                  <DataTableHeaderCell>30</DataTableHeaderCell>
                  <DataTableHeaderCell>60</DataTableHeaderCell>
                  <DataTableHeaderCell>90+</DataTableHeaderCell>
                  <DataTableHeaderCell>Total</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                <DataTableRow>
                  <DataTableCell>{formatMinor(detail.aging.currentMinor)}</DataTableCell>
                  <DataTableCell>{formatMinor(detail.aging.days30Minor)}</DataTableCell>
                  <DataTableCell>{formatMinor(detail.aging.days60Minor)}</DataTableCell>
                  <DataTableCell>{formatMinor(detail.aging.days90PlusMinor)}</DataTableCell>
                  <DataTableCell>{formatMinor(detail.aging.totalOpenMinor)}</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>

            <h2>Open entries</h2>
            {detail.entries.length === 0 ? (
              <p className="muted">No entries yet.</p>
            ) : (
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Date</DataTableHeaderCell>
                    <DataTableHeaderCell>Kind</DataTableHeaderCell>
                    <DataTableHeaderCell>Amount</DataTableHeaderCell>
                    <DataTableHeaderCell>Due</DataTableHeaderCell>
                    <DataTableHeaderCell>Overdue</DataTableHeaderCell>
                    <DataTableHeaderCell>Source</DataTableHeaderCell>
                    <DataTableHeaderCell>Reference</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {detail.entries.map((entry) => (
                    <DataTableRow key={entry.entryId}>
                      <DataTableCell>{entry.businessDate}</DataTableCell>
                      <DataTableCell>{entry.kind}</DataTableCell>
                      <DataTableCell>{formatMinor(entry.amountMinor)}</DataTableCell>
                      <DataTableCell>{entry.dueDate}</DataTableCell>
                      <DataTableCell>{entry.daysOverdue}</DataTableCell>
                      <DataTableCell>{entry.source}</DataTableCell>
                      <DataTableCell>{entry.reference ?? ''}</DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}

            {canAdjust ? (
              <p className="stack-row">
                <Button
                  type="button"
                  data-testid="city-ledger-payment-open"
                  disabled={detail.status === 'archived'}
                  onClick={() => setShowPayment(true)}
                >
                  Receive payment
                </Button>
                <Button
                  type="button"
                  data-testid="city-ledger-statement"
                  disabled={generateStatement.isPending}
                  onClick={() => generateStatement.mutate()}
                >
                  Generate statement
                </Button>
                <Button
                  type="button"
                  intent="destructive"
                  data-testid="city-ledger-archive"
                  disabled={
                    detail.status === 'archived' ||
                    detail.openBalanceMinor > 0 ||
                    archiveAccount.isPending
                  }
                  onClick={() => archiveAccount.mutate()}
                >
                  Archive
                </Button>
              </p>
            ) : null}
          </>
        ) : null}

        {showPayment ? (
          <div
            role="dialog"
            aria-modal="true"
            className="panel overscroll-contain"
            data-testid="city-ledger-payment"
          >
            <h2>Receive payment</h2>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                receivePayment.mutate();
              }}
            >
              <Field
                label="Amount"
                control={
                  <Input
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Reference"
                control={
                  <Input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
              <p className="stack-row">
                <Button type="button" onClick={() => setShowPayment(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  intent="primary"
                  disabled={receivePayment.isPending || !paymentAmount.trim()}
                >
                  {receivePayment.isPending ? 'Posting…' : 'Post payment'}
                </Button>
              </p>
            </form>
          </div>
        ) : null}

        {statementJson ? (
          <div
            role="dialog"
            aria-modal="true"
            className="panel overscroll-contain"
            data-testid="city-ledger-statement-view"
          >
            <h2>Statement snapshot</h2>
            <pre>{statementJson}</pre>
            <Button type="button" onClick={() => setStatementJson(null)}>
              Close
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  const accounts = asAccountList(listQ.data?.body);
  const listFailClosed =
    listQ.isError &&
    (asClassified(listQ.error).class === 'fail_closed' || listQ.error instanceof ClassifiedError);

  return (
    <Card data-testid="city-ledger-list">
      <header className="board-header">
        <h1>City ledger</h1>
        {canAdjust ? (
          <Button type="button" onClick={() => setShowCreate(true)}>
            Create account
          </Button>
        ) : null}
      </header>

      {message ? (
        <p role="status" data-testid="city-ledger-message">
          {message}
        </p>
      ) : null}

      {listQ.isLoading || meQ.isLoading ? <p className="muted">Loading…</p> : null}
      {listFailClosed ? (
        <Alert>City ledger unavailable — property unreachable.</Alert>
      ) : null}

      {!listQ.isLoading &&
      meQ.isSuccess &&
      accounts.length === 0 &&
      !listFailClosed ? (
        <p className="muted">No city ledger accounts yet.</p>
      ) : null}

      {accounts.length > 0 ? (
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Name</DataTableHeaderCell>
              <DataTableHeaderCell>Status</DataTableHeaderCell>
              <DataTableHeaderCell>Credit limit</DataTableHeaderCell>
              <DataTableHeaderCell>Open balance</DataTableHeaderCell>
              <DataTableHeaderCell>Current</DataTableHeaderCell>
              <DataTableHeaderCell>30</DataTableHeaderCell>
              <DataTableHeaderCell>60</DataTableHeaderCell>
              <DataTableHeaderCell>90+</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {accounts.map((account) => (
              <DataTableRow key={account.accountId}>
                <DataTableCell>
                  <Link to={`/city-ledger/${encodeURIComponent(account.accountId)}`}>
                    {account.name}
                  </Link>
                </DataTableCell>
                <DataTableCell rung={statusRung(account.status)}>{account.status}</DataTableCell>
                <DataTableCell>{formatMinor(account.creditLimitMinor)}</DataTableCell>
                <DataTableCell>{formatMinor(account.openBalanceMinor)}</DataTableCell>
                <DataTableCell>{formatMinor(account.aging.currentMinor)}</DataTableCell>
                <DataTableCell>{formatMinor(account.aging.days30Minor)}</DataTableCell>
                <DataTableCell>{formatMinor(account.aging.days60Minor)}</DataTableCell>
                <DataTableCell>{formatMinor(account.aging.days90PlusMinor)}</DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : null}

      {showCreate ? (
        <div
          role="dialog"
          aria-modal="true"
          className="panel overscroll-contain"
          data-testid="city-ledger-create"
        >
          <h2>Create account</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createAccount.mutate();
            }}
          >
            <Field
              label="Account name"
              control={
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Credit limit"
              control={
                <Input
                  value={createCreditLimit}
                  onChange={(e) => setCreateCreditLimit(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Terms (days)"
              control={
                <Input
                  value={createTermsDays}
                  onChange={(e) => setCreateTermsDays(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <p className="stack-row">
              <Button type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                intent="primary"
                disabled={createAccount.isPending || !createName.trim()}
              >
                {createAccount.isPending ? 'Creating…' : 'Create'}
              </Button>
            </p>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
