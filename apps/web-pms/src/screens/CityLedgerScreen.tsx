import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  DataTable,
  FieldGroup,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
} from '@hospai/ui-kit';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
import { parseMajorToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';

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
  const { money, date } = useFormat();
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
  const paymentFormRef = useRef<HTMLFormElement>(null);
  const createFormRef = useRef<HTMLFormElement>(null);

  function openPaymentDialog() {
    setStatementSnapshot(null);
    setShowCreate(false);
    setArchiveConfirmOpen(false);
    setShowPayment(true);
  }

  function openCreateDialog() {
    setShowPayment(false);
    setStatementSnapshot(null);
    setArchiveConfirmOpen(false);
    setShowCreate(true);
  }

  function openArchiveConfirm() {
    setShowPayment(false);
    setStatementSnapshot(null);
    setShowCreate(false);
    setArchiveConfirmOpen(true);
  }

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
      setShowPayment(false);
      setShowCreate(false);
      setArchiveConfirmOpen(false);
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

    return (
      <div className="ui-page-stack city-ledger-screen">
        <PageHeader
          title="City ledger"
          subtitle={detail?.name}
          back={<Link to="/city-ledger">City ledger</Link>}
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

        {detailQ.isLoading ? <Skeleton label="Loading city ledger account" lines={5} /> : null}
        {detailQ.isError ? (
          <Alert>
            {classifiedUserMessage(asClassified(detailQ.error), {
              fallback: 'Could not load account.',
            })}
          </Alert>
        ) : null}

        {detail ? (
          <>
            <dl className="ui-row">
              <div>
                <dt className="muted">Credit limit</dt>
                <dd>{money(detail.creditLimitMinor)}</dd>
              </div>
              <div>
                <dt className="muted">Terms (days)</dt>
                <dd>{detail.termsDays}</dd>
              </div>
              <div>
                <dt className="muted">Open balance</dt>
                <dd data-testid="city-ledger-open-balance">
                  {money(detail.openBalanceMinor)}
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
                  <DataTableCell>{money(detail.aging.currentMinor)}</DataTableCell>
                  <DataTableCell>{money(detail.aging.days30Minor)}</DataTableCell>
                  <DataTableCell>{money(detail.aging.days60Minor)}</DataTableCell>
                  <DataTableCell>{money(detail.aging.days90PlusMinor)}</DataTableCell>
                  <DataTableCell>{money(detail.aging.totalOpenMinor)}</DataTableCell>
                </DataTableRow>
              </DataTableBody>
            </DataTable>

            <h2>Open entries</h2>
            {detail.entries.length === 0 ? (
              <EmptyState kind="empty" title="No entries yet." />
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
                      <DataTableCell>{date(entry.businessDate)}</DataTableCell>
                      <DataTableCell>{entry.kind}</DataTableCell>
                      <DataTableCell>{money(entry.amountMinor)}</DataTableCell>
                      <DataTableCell>{date(entry.dueDate)}</DataTableCell>
                      <DataTableCell>{entry.daysOverdue}</DataTableCell>
                      <DataTableCell>{entry.source}</DataTableCell>
                      <DataTableCell>{entry.reference ?? ''}</DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}

            {canAdjust ? (
              <p className="ui-row">
                <Button
                  type="button"
                  data-testid="city-ledger-payment-open"
                  disabled={detail.status === 'archived'}
                  onClick={() => openPaymentDialog()}
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
                  onClick={() => openArchiveConfirm()}
                >
                  Archive
                </Button>
              </p>
            ) : null}
          </>
        ) : null}

        <Dialog
          open={showPayment}
          title="Receive payment"
          onClose={() => setShowPayment(false)}
          data-testid="city-ledger-payment"
          footer={
            <>
              <Button type="button" onClick={() => setShowPayment(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={receivePayment.isPending || !paymentAmount.trim()}
                onClick={() => paymentFormRef.current?.requestSubmit()}
              >
                {receivePayment.isPending ? 'Posting…' : 'Post payment'}
              </Button>
            </>
          }
        >
          <form
            ref={paymentFormRef}
            className="ui-stack"
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
          </form>
        </Dialog>

        <Dialog
          open={statementSnapshot != null}
          wide
          title="Statement snapshot"
          onClose={() => setStatementSnapshot(null)}
          data-testid="city-ledger-statement-view"
          footer={
            <Button type="button" onClick={() => setStatementSnapshot(null)}>
              Close
            </Button>
          }
        >
          {statementSnapshot ? (
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
          ) : null}
        </Dialog>
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

  return (
    <div className="ui-page-stack city-ledger-screen">
      <PageHeader
        title="City ledger"
        subtitle="Company accounts"
        actions={
          canAdjust ? (
            <Button type="button" intent="primary" onClick={() => openCreateDialog()}>
              Create account
            </Button>
          ) : undefined
        }
/>

      <Dialog
        open={showCreate}
        title="Create account"
        onClose={() => setShowCreate(false)}
        data-testid="city-ledger-create"
        footer={
          <div className="ui-row">
            <Button type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              intent="primary"
              disabled={createAccount.isPending || !createName.trim()}
              onClick={() => createFormRef.current?.requestSubmit()}
            >
              {createAccount.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        }
      >
        <form
          ref={createFormRef}
          onSubmit={(e) => {
            e.preventDefault();
            createAccount.mutate();
          }}
        >
          <FieldGroup inline>
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
          </FieldGroup>
        </form>
      </Dialog>
<Card data-testid="city-ledger-list">
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>

        {message || listQ.isLoading || meQ.isLoading || listQ.isError || accounts.length === 0 ? (
          <CardContent>
            {message ? (
              <Alert data-testid="city-ledger-message">
                {message}
              </Alert>
            ) : null}

            {listQ.isLoading || meQ.isLoading ? (
              <Skeleton label="Loading city ledger accounts" lines={5} />
            ) : null}
            {listQ.isError ? (
              <Alert>
                {classifiedUserMessage(asClassified(listQ.error), {
                  fallback: 'Could not load city ledger.',
                })}
              </Alert>
            ) : null}

            {!listQ.isLoading && meQ.isSuccess && accounts.length === 0 && !listQ.isError ? (
              <p className="muted">No city ledger accounts yet.</p>
            ) : null}
          </CardContent>
        ) : null}

      {accounts.length > 0 ? (
        <CardContent flush>
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
                    <DataTableCell align="right">{money(account.creditLimitMinor)}</DataTableCell>
                    <DataTableCell align="right">{money(account.openBalanceMinor)}</DataTableCell>
                    <DataTableCell align="right">{money(account.aging.currentMinor)}</DataTableCell>
                    <DataTableCell align="right">{money(account.aging.days30Minor)}</DataTableCell>
                    <DataTableCell align="right">{money(account.aging.days60Minor)}</DataTableCell>
                    <DataTableCell align="right">{money(account.aging.days90PlusMinor)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
        </CardContent>
) : null}

      </Card>
    </div>
  );
}
