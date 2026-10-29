import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
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
  NativeSelect,
  PageHeader,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
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
  const [statementSnapshot, setStatementSnapshot] = useState<Record<string, unknown> | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

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
        void navigate(`/city-ledger/${encodeURIComponent(body.accountId)}`);
      }
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? classifiedUserMessage(err.classified, { fallback: 'Create account failed.' })
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
          ? classifiedUserMessage(err.classified, { fallback: 'Receive payment failed.' })
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
      const body = result.body as { snapshot?: Record<string, unknown>; statementId?: string };
      setStatementSnapshot(body.snapshot ?? (body as Record<string, unknown>));
      setMessage(
        typeof body.statementId === 'string'
          ? `Statement ${body.statementId} generated.`
          : 'Statement generated.',
      );
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? classifiedUserMessage(err.classified, { fallback: 'Generate statement failed.' })
          : err instanceof Error
            ? err.message
            : 'Generate statement failed.',
      );
    },
  });

  const archiveAccount = useMutation({
    mutationFn: () =>
      api.archiveCityLedgerAccount(propertyId, accountId!, {
        idempotencyKey: `city-ledger:archive:${accountId}:${crypto.randomUUID()}`,
      }),
    onSuccess: () => {
      setArchiveConfirmOpen(false);
      setMessage('Account archived.');
      void queryClient.invalidateQueries({
        queryKey: ['city-ledger-account', propertyId, accountId],
      });
      void queryClient.invalidateQueries({ queryKey: ['city-ledger-accounts', propertyId] });
    },
    onError: (err) => {
      setMessage(
        err instanceof ClassifiedError
          ? classifiedUserMessage(err.classified, { fallback: 'Archive account failed.' })
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
      <div className="ui-page-stack city-ledger-screen">
        <PageHeader
          title="City ledger"
          subtitle={detail?.name}
          back={<Link to="/city-ledger">← City ledger</Link>}
          actions={
            detail ? <Badge rung={statusRung(detail.status)}>{badgeStatusWord(detail.status)}</Badge> : undefined
          }
        />
        <Card data-testid="city-ledger-detail">

        {message ? (
          <Alert data-testid="city-ledger-message">
            {message}
          </Alert>
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
                  data-testid="city-ledger-archive"
                  disabled={
                    detail.status === 'archived' ||
                    detail.openBalanceMinor > 0 ||
                    archiveAccount.isPending
                  }
                  onClick={() => setArchiveConfirmOpen(true)}
                >
                  Archive
                </Button>
              </p>
            ) : null}
          </>
        ) : null}

        {showPayment ? (
          <Card
            role="dialog"
            aria-modal="true"
            className="overscroll-contain"
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
          </Card>
        ) : null}

        {statementSnapshot ? (
          <Card
            role="dialog"
            aria-modal="true"
            className="overscroll-contain"
            data-testid="city-ledger-statement-view"
          >
            <h2>Statement snapshot</h2>
            <DataTable>
              <DataTableBody>
                {Object.entries(statementSnapshot)
                  .filter(([, v]) => typeof v !== 'object' || v === null)
                  .map(([key, value]) => (
                    <DataTableRow key={key}>
                      <DataTableHeaderCell>{key}</DataTableHeaderCell>
                      <DataTableCell>{value == null ? '' : String(value)}</DataTableCell>
                    </DataTableRow>
                  ))}
              </DataTableBody>
            </DataTable>
            <Button type="button" onClick={() => setStatementSnapshot(null)}>
              Close
            </Button>
          </Card>
        ) : null}
        {archiveConfirmOpen ? (
          <ConfirmDialog
            title="Archive this account?"
            description="It cannot receive new charges."
            confirmLabel="Archive"
            intent="destructive"
            onCancel={() => setArchiveConfirmOpen(false)}
            onConfirm={() => archiveAccount.mutate()}
          />
        ) : null}
      </Card>
    </div>
  );
}

  const accounts = asAccountList(listQ.data?.body);
  const listFailClosed =
    listQ.isError &&
    (asClassified(listQ.error).class === 'fail_closed' || listQ.error instanceof ClassifiedError);

  return (
    <div className="ui-page-stack city-ledger-screen">
      <PageHeader
        title="City ledger"
        subtitle="Company accounts"
        actions={
          canAdjust ? (
            <Button type="button" intent="primary" onClick={() => setShowCreate(true)}>
              Create account
            </Button>
          ) : undefined
        }
/>

      {showCreate ? (
        <Card
          role="dialog"
          aria-modal="true"
          className="overscroll-contain"
          data-testid="city-ledger-create"
        >
          <CardHeader>
            <CardTitle>Create account</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="city-ledger__create-form"
              onSubmit={(e) => {
                e.preventDefault();
                createAccount.mutate();
              }}
            >
              <Field
                label="Account name"
                control={
                  <Input
                    placeholder="Company or account name"
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
                    placeholder="0.00"
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
                    placeholder="30"
                    value={createTermsDays}
                    onChange={(e) => setCreateTermsDays(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
              <p className="stack-row city-ledger__create-actions">
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
          </CardContent>
        </Card>
      ) : null}
<Card data-testid="city-ledger-list">
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>

        {message || listQ.isLoading || meQ.isLoading || listFailClosed || accounts.length === 0 ? (
          <CardContent>
            {message ? (
              <Alert data-testid="city-ledger-message">
                {message}
              </Alert>
            ) : null}

            {listQ.isLoading || meQ.isLoading ? <p className="muted">Loading…</p> : null}
            {listFailClosed ? (
              <Alert>City ledger unavailable — property unreachable.</Alert>
            ) : null}

            {!listQ.isLoading && meQ.isSuccess && accounts.length === 0 && !listFailClosed ? (
              <p className="muted">No city ledger accounts yet.</p>
            ) : null}
          </CardContent>
        ) : null}

      {accounts.length > 0 ? (
        <CardContent flush>
          <div className="city-ledger__table">
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Credit limit</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Open balance</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Current</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">30</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">60</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">90+</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {accounts.map((account) => (
                  <DataTableRow key={account.accountId}>
                    <DataTableCell>
                      <Link className="city-ledger__account-name" to={`/city-ledger/${encodeURIComponent(account.accountId)}`}>
                        {account.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>
                      <Badge rung={statusRung(account.status)}>{badgeStatusWord(account.status)}</Badge>
                    </DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.creditLimitMinor)}</DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.openBalanceMinor)}</DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.aging.currentMinor)}</DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.aging.days30Minor)}</DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.aging.days60Minor)}</DataTableCell>
                    <DataTableCell align="right">{formatMinor(account.aging.days90PlusMinor)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
        </CardContent>
) : null}

      </Card>
    </div>
  );
}
