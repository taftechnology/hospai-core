import {
  foldFolioLines,
  folioActionPolicy,
  partitionQueuedByReservation,
  ClassifiedError,
  type FolioLine,
  type FolioPaymentRow,
  type FolioReadState,
  type FolioTransferResult,
  type RecurringCharge,
} from '@hospai/client-core';
import {
  Alert,
  AlertTitle,
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
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  VisuallyHidden,
  Skeleton,
  StatField,
  Total,
  isReservationStatus,
  StatusBadge,
} from '@hospai/ui-kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, queuedCommands, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { FormDialog } from '../shell/FormDialog.js';
import { queuedCommandLine } from '../copy/queued-command-line.js';
import { minorToMajorInput, parseAmountToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { tenderLabel, tenderMethod, tenderStatusLabel } from './tender-label.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { GuestNameLink } from './guest-row.js';
import { usePostableProducts } from './product-picker.js';
import { useFolioActionMutation } from './use-folio-action-mutation.js';
import { FrontOfficeEditor } from './front-office-editor.js';
import { PrintRegCardControl, RegistrationCard, useRegCardLabels } from './registration-card.js';

function folioBackTarget(status: string | undefined): { to: string; label: string } {
  if (status === 'checked_in') return { to: '/in-house', label: 'In house' };
  if (status === 'checked_out') return { to: '/departures', label: 'Departures' };
  return { to: '/arrivals', label: 'Arrivals' };
}

const TERMINAL_STATUSES = new Set(['cancelled', 'checked_out', 'no_show']);

function readState(q: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isSuccess: boolean;
}): FolioReadState {
  if (q.isPending) return 'pending';
  if (q.isSuccess) return 'live';
  if (q.isError) return asClassified(q.error).class;
  return 'pending';
}

/** Open hold for one purpose. A damage deposit never pays the stay, so it is counted apart. */
function heldAmount(payments: FolioPaymentRow[], purpose: 'STAY' | 'DAMAGE'): number {
  let sum = 0;
  for (const p of payments) {
    if (p.status === 'authorized' && (p.purpose === 'DAMAGE' ? 'DAMAGE' : 'STAY') === purpose) {
      const captured = p.capturedAmountMinor ?? 0;
      sum += Math.max(0, p.amountMinor - captured);
    }
  }
  return sum;
}

function chargeDescription(
  chargeCode: string,
  codes: Array<{ code: string; name: string }> | undefined,
): string {
  const hit = codes?.find((c) => c.code === chargeCode);
  return hit?.name ?? chargeCode;
}

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

function configBool(
  keys: Array<{ key: string; value: unknown }> | undefined,
  key: string,
  fallback = false,
): boolean {
  const row = keys?.find((k) => k.key === key);
  if (row?.value === true) return true;
  if (row?.value === false) return false;
  return fallback;
}

function configStr(
  keys: Array<{ key: string; value: unknown }> | undefined,
  key: string,
  fallback: string,
): string {
  const row = keys?.find((k) => k.key === key);
  return typeof row?.value === 'string' ? row.value : fallback;
}

type InvoiceSnapshotLine = {
  chargeName?: string;
  chargeCode?: string;
  amountMinor?: number;
  ledgerAmountMinor?: number;
};

type InvoiceSnapshot = {
  invoiceNumber?: string;
  invoiceDate?: string;
  lines?: InvoiceSnapshotLine[];
  taxSummary?: Array<{ label?: string; amountMinor?: number; taxRuleId?: string }>;
  totals?: {
    chargesMinor?: number;
    taxMinor?: number;
    paymentsMinor?: number;
    balanceMinor?: number;
  };
  presentation?: Record<string, unknown>;
};

function presentationFlag(presentation: Record<string, unknown> | undefined, key: string): boolean {
  if (!presentation) return true;
  const camel = presentation[key];
  if (typeof camel === 'boolean') return camel;
  const snake = presentation[key.replace(/([A-Z])/g, '_$1').toLowerCase()];
  if (typeof snake === 'boolean') return snake;
  return true;
}

type LedgerRow = {
  key: string;
  sortKey: number;
  date: string;
  code: string;
  description: ReactNode;
  chargeMinor: number;
  paymentMinor: number;
};

function defaultRecurringFrom(arrival: string | undefined, businessDate: string | null): string {
  if (arrival && businessDate) return arrival > businessDate ? arrival : businessDate;
  return arrival ?? businessDate ?? '';
}

function RecurringChargesCard(props: {
  propertyId: string;
  reservationId: string;
  arrivalDate: string | undefined;
  businessDate: string | null;
  status: string | null;
  canRead: boolean;
  canPost: boolean;
}) {
  const { propertyId, reservationId, arrivalDate, businessDate, status, canRead, canPost } = props;
  const { money, date } = useFormat();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const setMessage = (text: string | null) => setNotice(text === null ? null : { text, ok: false });
  const setSuccess = (text: string) => setNotice({ text, ok: true });
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [fromDate, setFromDate] = useState('');
  const [untilMode, setUntilMode] = useState<'departure' | 'date'>('departure');
  const [untilDate, setUntilDate] = useState('');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const canAdd = canPost && (status === 'confirmed' || status === 'checked_in');
  const products = usePostableProducts(canRead && canAdd);
  const recurringQ = useQuery({
    queryKey: ['recurring-charges', propertyId, reservationId],
    queryFn: () => api.listRecurringCharges(propertyId, reservationId),
    enabled: canRead && Boolean(reservationId),
  });

  const fromValue = fromDate || defaultRecurringFrom(arrivalDate, businessDate);
  const charges = recurringQ.data?.charges ?? [];

  function invalidateRecurring() {
    void queryClient.invalidateQueries({
      queryKey: ['recurring-charges', propertyId, reservationId],
    });
    void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
  }

  const schedule = useFolioActionMutation({
    fallback: 'Could not add the recurring charge.',
    setMessage,
    mutationFn: (input: {
      recurringChargeId: string;
      productId: string;
      quantity: number;
      startDate: string;
      endDate: string | null;
    }) =>
      api.scheduleRecurringCharge(
        propertyId,
        reservationId,
        input,
        `recurring-add:${input.recurringChargeId}`,
      ),
    onSuccess: () => {
      setSuccess('Recurring charge added.');
      setQuantity('1');
      setUntilMode('departure');
      setUntilDate('');
      invalidateRecurring();
    },
  });

  const cancel = useFolioActionMutation({
    fallback: 'Could not cancel the recurring charge.',
    setMessage,
    mutationFn: (recurringChargeId: string) =>
      api.cancelRecurringCharge(
        propertyId,
        reservationId,
        recurringChargeId,
        `recurring-cancel:${recurringChargeId}`,
      ),
    onSuccess: () => {
      setSuccess('Recurring charge cancelled. Nights already posted stay on the folio.');
      invalidateRecurring();
    },
  });

  if (!canRead) return null;

  function nightsLabel(charge: RecurringCharge): string {
    if (charge.endDate) return `${date(charge.startDate)} – ${date(charge.endDate)}`;
    return `${date(charge.startDate)} – departure`;
  }

  return (
    <Card data-testid="recurring-charges-card">
      <CardHeader>
        <CardTitle>Recurring charges</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="ui-stack">
          {notice ? (
            <Alert intent={notice.ok ? 'settled' : 'exception'} data-testid="recurring-message">
              {notice.text}
            </Alert>
          ) : null}
          {recurringQ.isError ? (
            <Alert>
              {classifiedUserMessage(asClassified(recurringQ.error), {
                fallback: 'Could not load recurring charges.',
              })}
            </Alert>
          ) : null}
          {recurringQ.isSuccess && charges.length === 0 ? (
            <EmptyState
              title="No recurring charges"
              description="Nothing is scheduled to post each night of this stay."
            />
          ) : null}
          {charges.length > 0 ? (
            <DataTable data-testid="recurring-charges-table">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Product</DataTableHeaderCell>
                  <DataTableHeaderCell>Per night</DataTableHeaderCell>
                  <DataTableHeaderCell>Nights</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {charges.map((charge) => (
                  <DataTableRow key={charge.recurringChargeId}>
                    <DataTableCell>{charge.description}</DataTableCell>
                    <DataTableCell>
                      {money(charge.unitAmountMinor)} × {charge.quantity}
                    </DataTableCell>
                    <DataTableCell>{nightsLabel(charge)}</DataTableCell>
                    <DataTableCell>{charge.status === 'active' ? 'Active' : 'Cancelled'}</DataTableCell>
                    <DataTableCell>
                      {canAdd && charge.status === 'active' ? (
                        <Button
                          type="button"
                          intent="destructive"
                          data-testid={`recurring-cancel-${charge.recurringChargeId}`}
                          onClick={() => setPendingCancelId(charge.recurringChargeId)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
          {canAdd ? (
            <div className="ui-stack">
              <div className="ui-row">
                <Field
                  size="xs"
                  label="Product"
                  control={
                    <NativeSelect
                      aria-label="recurring-product"
                      data-testid="recurring-product"
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                    >
                      <option value="">Choose a product</option>
                      {products.groups.flatMap((group) =>
                        group.items.map((item) => (
                          <option key={item.productId} value={item.productId}>
                            {item.name}
                          </option>
                        )),
                      )}
                    </NativeSelect>
                  }
                />
                <Field
                  size="xs"
                  label="Quantity"
                  control={
                    <Input
                      aria-label="recurring-quantity"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  }
                />
                <Field
                  size="xs"
                  label="From"
                  control={
                    <Input
                      type="date"
                      aria-label="recurring-from"
                      value={fromValue}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  }
                />
                <Field
                  size="xs"
                  label="Until"
                  control={
                    <NativeSelect
                      aria-label="recurring-until"
                      data-testid="recurring-until"
                      value={untilMode}
                      onChange={(e) => setUntilMode(e.target.value === 'date' ? 'date' : 'departure')}
                    >
                      <option value="departure">Until departure</option>
                      <option value="date">Until a date</option>
                    </NativeSelect>
                  }
                />
                {untilMode === 'date' ? (
                  <Field
                    size="xs"
                    label="Until date"
                    control={
                      <Input
                        type="date"
                        aria-label="recurring-until-date"
                        value={untilDate}
                        onChange={(e) => setUntilDate(e.target.value)}
                      />
                    }
                  />
                ) : null}
                <Button
                  type="button"
                  data-testid="recurring-add"
                  disabled={schedule.isPending || productId === ''}
                  onClick={() => {
                    const qty = Number(quantity);
                    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
                      setMessage('Quantity must be a whole number from 1 to 99.');
                      return;
                    }
                    if (untilMode === 'date' && untilDate === '') {
                      setMessage('Choose the last night, or leave it until departure.');
                      return;
                    }
                    const recurringChargeId = `rc_${crypto.randomUUID()}`;
                    schedule.mutate({
                      recurringChargeId,
                      productId,
                      quantity: qty,
                      startDate: fromValue,
                      endDate: untilMode === 'date' ? untilDate : null,
                    });
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
      {pendingCancelId ? (
        <ConfirmDialog
          title="Cancel recurring charge?"
          description="Nights already posted stay on the folio. Later nights will not post."
          confirmLabel="Cancel charge"
          intent="destructive"
          onCancel={() => setPendingCancelId(null)}
          onConfirm={() => {
            const id = pendingCancelId;
            setPendingCancelId(null);
            cancel.mutate(id);
          }}
        />
      ) : null}
    </Card>
  );
}

export function FolioScreen() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const { money, date, dateRange, instantDate, fmt } = useFormat();
  const queryClient = useQueryClient();
  const [message, setMessageText] = useState<string | null>(null);
  const [messageIntent, setMessageIntent] = useState<'exception' | 'attention'>('exception');
  const setMessage = (text: string | null) => {
    setMessageIntent('exception');
    setMessageText(text);
  };
  const setQueuedNotice = (text: string) => {
    setMessageIntent('attention');
    setMessageText(text);
  };
  const [chargeCode, setChargeCode] = useState('MISC');
  const [chargeAmount, setChargeAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [authAmount, setAuthAmount] = useState('');
  const [authPurpose, setAuthPurpose] = useState<'STAY' | 'DAMAGE'>('STAY');
  const [splitLineId, setSplitLineId] = useState('');
  const [splitA, setSplitA] = useState('');
  const [splitB, setSplitB] = useState('');
  const [splitDestA, setSplitDestA] = useState('');
  const [splitDestB, setSplitDestB] = useState('');
  const [companyBilledParty, setCompanyBilledParty] = useState('');
  const [billedPartyHint, setBilledPartyHint] = useState<string | null>(null);
  const [discountLineId, setDiscountLineId] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountKind, setDiscountKind] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [transferDest, setTransferDest] = useState<Record<string, string>>({});
  const [captureDueRetry, setCaptureDueRetry] = useState(false);
  const [captureAmounts, setCaptureAmounts] = useState<Record<string, string>>({});
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [chargeOpId] = useState(() => `charge:${reservationId}:${crypto.randomUUID()}`);
  const [cashOpId] = useState(() => `cash:${reservationId}:${crypto.randomUUID()}`);
  const [authOpId] = useState(() => `auth:${reservationId}:${crypto.randomUUID()}`);
  const [payCurrency, setPayCurrency] = useState('');
  const [chargebackPaymentId, setChargebackPaymentId] = useState('');
  const [chargebackFee, setChargebackFee] = useState('0.00');
  const [chargebackReason, setChargebackReason] = useState('');
  const [fxKind, setFxKind] = useState<'gain' | 'loss'>('loss');
  const [fxAmount, setFxAmount] = useState('');
  const [fxReason, setFxReason] = useState('');
  const [fxFrom, setFxFrom] = useState('EUR');
  const [fxRate, setFxRate] = useState('');
  const [voidInvoiceOpen, setVoidInvoiceOpen] = useState(false);
  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);
  const [releasePaymentId, setReleasePaymentId] = useState<string | null>(null);
  const [forfeitPaymentId, setForfeitPaymentId] = useState<string | null>(null);
  const [forfeitAmount, setForfeitAmount] = useState('');
  const [forfeitPostedMinor, setForfeitPostedMinor] = useState<number | null>(null);
  const [forfeitNote, setForfeitNote] = useState<string | null>(null);
  const [forfeitPending, setForfeitPending] = useState(false);
  const [checkoutOverrideOpen, setCheckoutOverrideOpen] = useState(false);
  const [earlyDepartOpen, setEarlyDepartOpen] = useState(false);
  const [closeWindowId, setCloseWindowId] = useState<string | null>(null);
  const [chargeCodesRequested, setChargeCodesRequested] = useState(false);
  const [fxRatesEditorOpen, setFxRatesEditorOpen] = useState(false);
  const [domainConfigRequested, setDomainConfigRequested] = useState(false);
  const [folioAdvancedOpen, setFolioAdvancedOpen] = useState(false);

  const folioQ = useQuery({
    queryKey: ['folio', propertyId, reservationId],
    queryFn: () => api.getFolio(propertyId, reservationId),
    enabled: Boolean(reservationId),
  });
  const reservationQ = useQuery({
    queryKey: ['reservation', propertyId, reservationId],
    queryFn: () => api.getReservation(propertyId, reservationId),
    enabled: Boolean(reservationId),
  });
  const paymentsQ = useQuery({
    queryKey: ['folio-payments', propertyId, reservationId],
    queryFn: () => api.getFolioPayments(propertyId, reservationId),
    enabled: Boolean(reservationId),
  });
  const fxRatesQ = useQuery({
    queryKey: ['fx-rates', propertyId],
    queryFn: () => api.listFxRates(propertyId),
    enabled: Boolean(propertyId) && fxRatesEditorOpen,
  });
  const openShiftQ = useQuery({
    queryKey: ['open-shift', propertyId],
    queryFn: () => api.getOpenShift(propertyId),
  });
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
  });

  const guestRef = reservationQ.data?.guestRef;
  const guestsQ = useQuery({
    queryKey: ['folio-guest', propertyId, guestRef],
    queryFn: () => api.postGuestsBatch(propertyId, guestRef ? [guestRef] : []),
    enabled: Boolean(guestRef),
  });
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const roomsQ = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
    enabled: Boolean(propertyId) && reservationQ.isSuccess && Boolean(reservationQ.data?.roomId),
  });
  const products = usePostableProducts(chargeCodesRequested);
  const [chargeProductId, setChargeProductId] = useState('');
  const chargeCodesQ = useQuery({
    queryKey: ['charge-codes', propertyId],
    queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
    enabled: Boolean(propertyId) && chargeCodesRequested,
  });
  const domainConfigQ = useQuery({
    queryKey: ['domain-config', propertyId],
    queryFn: () => api.listDomainConfig(propertyId),
    enabled: Boolean(propertyId) && domainConfigRequested,
    retry: false,
  });

  const configKeys = domainConfigQ.data?.keys as Array<{ key: string; value: unknown }> | undefined;
  const invoiceGenMode = configStr(configKeys, 'pms.invoice.gen_mode', 'Automatically');
  const invoiceAllowPending = configBool(configKeys, 'pms.invoice.allow_pending', false);

  const activeInvoiceKey = ['invoice-active', propertyId, reservationId] as const;
  const activeInvoiceQ = useQuery<string | null>({
    queryKey: activeInvoiceKey,
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const activeInvoiceId = activeInvoiceQ.data ?? null;

  const invoiceQ = useQuery({
    queryKey: ['invoice', propertyId, activeInvoiceId],
    queryFn: () => api.getInvoice(propertyId, activeInvoiceId!),
    enabled: Boolean(activeInvoiceId),
  });

  const policy = folioActionPolicy({
    folioReadClass: readState(folioQ),
    reservationReadClass: readState(reservationQ),
    reservationStatus: reservationQ.data?.status ?? null,
  });

  const meShell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data as PropertyMe | undefined,
    classified: meQ.isError ? asClassified(meQ.error) : undefined,
  });
  const adjustDenied =
    meShell.kind === 'authority' &&
    meShell.authority.kind === 'live' &&
    !hasPropertyPermission(meShell.authority.me, 'folio:adjust');
  const canSplit = policy.canSplit && !adjustDenied;
  const canAdjust = !adjustDenied;
  const postDenied =
    meShell.kind === 'authority' &&
    meShell.authority.kind === 'live' &&
    !hasPropertyPermission(meShell.authority.me, 'folio:post');
  const writeDenied =
    meShell.kind === 'authority' &&
    meShell.authority.kind === 'live' &&
    !hasPropertyPermission(meShell.authority.me, 'reservations:write');
  const canPost = !postDenied;
  const canWrite = !writeDenied;
  const configureDenied =
    meShell.kind === 'authority' &&
    meShell.authority.kind === 'live' &&
    !hasPropertyPermission(meShell.authority.me, 'settings:configure');
  const canConfigureFx = !configureDenied;

  const cityLedgerAccountsQ = useQuery({
    queryKey: ['city-ledger-accounts-active', propertyId],
    queryFn: () => api.fetchCityLedgerAccounts(propertyId, { status: 'active' }),
    enabled: Boolean(propertyId) && canAdjust && folioAdvancedOpen,
    retry: false,
  });

  const cityLedgerAccounts = useMemo(() => {
    if (!cityLedgerAccountsQ.isSuccess) return [];
    const body = cityLedgerAccountsQ.data?.body as {
      accounts?: Array<{ accountId: string; name: string; status: string }>;
    };
    return body?.accounts ?? [];
  }, [cityLedgerAccountsQ.data, cityLedgerAccountsQ.isSuccess]);

  const cityLedgerPickerAvailable = cityLedgerAccountsQ.isSuccess;

  useEffect(() => {
    const trimmed = companyBilledParty.trim();
    if (!trimmed || cityLedgerPickerAvailable) {
      setBilledPartyHint(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.validateCityLedgerBilledParty(propertyId, trimmed);
        if (cancelled) return;
        const body = result.body as { ok?: boolean; billedParty?: string };
        if (body.ok && body.billedParty) {
          setBilledPartyHint(`Valid account: ${body.billedParty}`);
        } else {
          setBilledPartyHint('Not an active account — may still work for grandfathered labels.');
        }
      } catch {
        if (!cancelled) setBilledPartyHint(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyBilledParty, cityLedgerPickerAvailable, propertyId]);

  const folioLive = folioQ.isSuccess && paymentsQ.isSuccess;
  const ledgerCurrency = folioQ.data?.ledgerCurrency ?? fxRatesQ.data?.ledgerCurrency ?? 'USD';
  const chargeMinor = parseAmountToMinor(chargeAmount);
  const cashMinor = parseAmountToMinor(cashAmount);
  const authMinor = parseAmountToMinor(authAmount);
  const fxAmountMinor = parseAmountToMinor(fxAmount);
  const fxRateTrimmed = fxRate.trim();
  const fxRateValid = fxRateTrimmed !== '' && !Number.isNaN(Number(fxRateTrimmed));
  const discountTrimmed = discountValue.trim();
  const discountValueValid = discountTrimmed !== '' && !Number.isNaN(Number(discountTrimmed));
  const openFxFrom = (fxRatesQ.data?.rates ?? [])
    .filter((r) => r.effectiveTo === null)
    .map((r) => r.fromCurrency);
  const payCurrencies = Array.from(new Set([ledgerCurrency, ...openFxFrom]));
  const selectedPayCurrency = payCurrency || ledgerCurrency;
  const splitReason = adjustDenied
    ? 'Requires permission folio:adjust. Ask a manager.'
    : policy.reasons.split;

  const fold = useMemo(() => {
    const lines = (folioQ.data?.lines ?? []) as FolioLine[];
    return foldFolioLines(
      lines.map((l) => ({
        ...l,
        taxOf: l.taxOf ?? null,
        taxRuleId: l.taxRuleId ?? null,
      })),
    );
  }, [folioQ.data?.lines]);

  const queued = useMemo(() => {
    return partitionQueuedByReservation(queuedCommands.entries(), reservationId);
  }, [reservationId, message, folioQ.dataUpdatedAt, paymentsQ.dataUpdatedAt]);

  const payments = paymentsQ.data?.payments ?? [];
  const held = heldAmount(payments, 'STAY');
  const damageHeld = heldAmount(payments, 'DAMAGE');
  const balanceMinor = folioQ.data?.balanceMinor;
  const windows = folioQ.data?.windows ?? [];
  const openWindows = windows.filter((w) => w.status === 'OPEN');
  const guestWindowId =
    windows.find((w) => w.kind === 'GUEST')?.folioWindowId ?? `${reservationId}:GUEST`;
  const reservationTerminal = TERMINAL_STATUSES.has(reservationQ.data?.status ?? '');
  const reservationStatus = reservationQ.data?.status ?? null;
  const invoiceReadsLive =
    readState(folioQ) === 'live' && readState(reservationQ) === 'live';
  const canGenerateInvoice =
    canPost &&
    invoiceReadsLive &&
    folioQ.isSuccess &&
    reservationQ.isSuccess &&
    (reservationStatus === 'checked_in' || reservationStatus === 'checked_out') &&
    !activeInvoiceId &&
    ((balanceMinor ?? 0) === 0 || invoiceAllowPending);
  const noPost = Boolean(folioQ.data?.noPost);
  const stayAuthorized = payments.some(
    (p) => p.status === 'authorized' && (p.purpose ?? 'STAY') === 'STAY',
  );
  const showCaptureDue =
    canPost && (captureDueRetry || (stayAuthorized && (balanceMinor ?? 0) > 0));

  function windowCloseDisabled(w: {
    kind: string;
    status: string;
    balanceMinor: number;
  }): boolean {
    if (w.status !== 'OPEN') return true;
    if (w.balanceMinor !== 0) return true;
    if (w.kind === 'GUEST' && !reservationTerminal) return true;
    return false;
  }

  function transferDestsFor(sourceWindowId: string | undefined) {
    return openWindows.filter((w) => w.folioWindowId !== sourceWindowId);
  }

  function splitPayload() {
    const a = Math.round(Number(splitA) * 100);
    const b = Math.round(Number(splitB) * 100);
    const destA = splitDestA || guestWindowId;
    const destB = splitDestB || guestWindowId;
    return {
      splits: [
        { folioLineId: `${splitLineId}:a`, amountMinor: a, folioWindowId: destA },
        { folioLineId: `${splitLineId}:b`, amountMinor: b, folioWindowId: destB },
      ],
    };
  }

  const addCharge = useFolioActionMutation({
    fallback: 'Charge failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_charge') {
        setMessage(policy.reasons.charge ?? 'Charge refused.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!policy.canPostCharge) throw new Error('policy_blocked_charge');
      const amountMinor = parseAmountToMinor(chargeAmount);
      if (amountMinor == null) throw new Error('invalid_amount');
      return api.addFolioLine(
        propertyId,
        reservationId,
        { chargeCode, amountMinor },
        chargeOpId,
      );
    },
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setQueuedNotice(queuedWriteCopy());
      } else {
        setMessage('Charge posted.');
      }
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const cashPay = useFolioActionMutation({
    fallback: 'Cash failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Payment refused.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      const amountMinor = parseAmountToMinor(cashAmount);
      if (amountMinor == null) throw new Error('invalid_amount');
      return api.recordCashPayment(
        propertyId,
        reservationId,
        {
          paymentId: `pay_${cashOpId}`,
          amountMinor,
          ...(selectedPayCurrency !== ledgerCurrency ? { currency: selectedPayCurrency } : {}),
        },
        cashOpId,
      );
    },
    onSuccess: () => {
      setMessage('Cash payment recorded.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const authorize = useFolioActionMutation({
    fallback: 'Authorize failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Authorize refused.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      const amountMinor = parseAmountToMinor(authAmount);
      if (amountMinor == null) throw new Error('invalid_amount');
      const opId = `${authOpId}:${authPurpose}:${amountMinor}:${selectedPayCurrency}`;
      return api.authorizePayment(
        propertyId,
        reservationId,
        {
          paymentId: `pay_${opId}`,
          amountMinor,
          purpose: authPurpose,
          ...(selectedPayCurrency !== ledgerCurrency ? { currency: selectedPayCurrency } : {}),
        },
        opId,
      );
    },
    onSuccess: () => {
      setMessage('Card authorized.');
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  async function submitForfeit() {
    const payment = (paymentsQ.data?.payments ?? []).find((p) => p.paymentId === forfeitPaymentId);
    if (!payment) return;
    const holdMinor = payment.amountMinor - (payment.capturedAmountMinor ?? 0);
    const typed = parseAmountToMinor(forfeitAmount);
    const amountMinor = forfeitPostedMinor ?? typed;
    if (amountMinor == null || amountMinor <= 0 || amountMinor > holdMinor) {
      setForfeitNote('Enter an amount up to the hold.');
      return;
    }
    const lineOp = `damage-forfeit:${payment.paymentId}:${amountMinor}:line`;
    const captureOp = `damage-forfeit:${payment.paymentId}:${amountMinor}:capture`;
    setForfeitPending(true);
    setForfeitNote(null);
    let linePosted = forfeitPostedMinor != null;
    try {
      if (!linePosted) {
        const posted = await api.addFolioLine(
          propertyId,
          reservationId,
          { chargeCode: 'DAMAGE', amountMinor },
          lineOp,
        );
        if (isQueuedResult(posted)) {
          setQueuedNotice(queuedWriteCopy());
          setForfeitPaymentId(null);
          return;
        }
        linePosted = true;
        setForfeitPostedMinor(amountMinor);
      }
      await api.capturePayment(propertyId, payment.paymentId, { amountMinor }, captureOp);
      setMessage('Damage deposit forfeited.');
      setForfeitPaymentId(null);
      setForfeitPostedMinor(null);
      setForfeitNote(null);
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({ queryKey: ['folio-payments', propertyId, reservationId] });
    } catch (err) {
      if (linePosted) {
        setForfeitNote(
          'The damage charge was posted, but capturing the hold failed. Retry capture only.',
        );
      } else {
        setForfeitNote(classifiedUserMessage(asClassified(err), { fallback: 'Forfeit failed', fmt }));
      }
    } finally {
      setForfeitPending(false);
    }
  }

  const chargeback = useFolioActionMutation({
    fallback: 'Chargeback failed',
    setMessage,
    mutationFn: () => {
      const feeLedgerMinor = Math.round(Number(chargebackFee) * 100);
      return api.recordChargeback(
        propertyId,
        chargebackPaymentId,
        { feeLedgerMinor, reason: chargebackReason },
        `cb:${chargebackPaymentId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Chargeback recorded.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const fxAdjust = useFolioActionMutation({
    fallback: 'FX adjustment failed',
    setMessage,
    mutationFn: () => {
      const amountMinor = parseAmountToMinor(fxAmount);
      if (amountMinor == null) throw new Error('invalid_amount');
      return api.postFxAdjustment(
        propertyId,
        reservationId,
        {
          folioWindowId: guestWindowId,
          kind: fxKind,
          amountMinor,
          reason: fxReason,
        },
        `fxadj:${reservationId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('FX adjustment posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const createFx = useFolioActionMutation({
    fallback: 'FX rate create failed',
    setMessage,
    mutationFn: () => {
      if (!fxRateValid) throw new Error('invalid_fx_rate');
      return api.createFxRate(
        propertyId,
        {
          quoteId: crypto.randomUUID(),
          fromCurrency: fxFrom,
          toCurrency: ledgerCurrency,
          rate: fxRateTrimmed,
          effectiveFrom: Date.now(),
        },
        `fxcreate:${propertyId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('FX rate created.');
      void queryClient.invalidateQueries({ queryKey: ['fx-rates', propertyId] });
    },
  });

  const capture = useFolioActionMutation({
    fallback: 'Capture failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Capture refused.');
        return true;
      }
      return false;
    },
    mutationFn: (input: { paymentId: string; amountMinor: number; opId: string }) => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      return api.capturePayment(
        propertyId,
        input.paymentId,
        { amountMinor: input.amountMinor },
        input.opId,
      );
    },
    onSuccess: () => {
      setMessage('Capture posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const split = useFolioActionMutation({
    fallback: 'Split failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_split') {
        setMessage(splitReason ?? 'Split refused.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!canSplit) throw new Error('policy_blocked_split');
      const opId = `split:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioLine(propertyId, splitLineId, splitPayload(), opId);
    },
    onSuccess: () => {
      setMessage('Split posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const splitPayment = useFolioActionMutation({
    fallback: 'Split payment failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_split') {
        setMessage(splitReason ?? 'Split refused.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!canSplit) throw new Error('policy_blocked_split');
      const opId = `splitpay:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioLine(propertyId, splitLineId, splitPayload(), opId);
    },
    onSuccess: () => {
      setMessage('Payment split posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const checkOut = useFolioActionMutation({
    fallback: 'Checkout failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_checkout') {
        setMessage(policy.reasons.checkout ?? 'Checkout unavailable.');
        return true;
      }
      return false;
    },
    mutationFn: async (overrideBalance: boolean) => {
      if (!policy.canCheckout) throw new Error('policy_blocked_checkout');
      if (invoiceGenMode === 'Automatically') {
        const gen = await generateInvoiceForFolio(`invoice:checkout:${reservationId}`);
        const invoiceId = invoiceIdFromGenerateResult(gen);
        if (invoiceId) setActiveInvoiceId(invoiceId);
      }
      return api.checkOut(
        propertyId,
        reservationId,
        `checkout:${reservationId}`,
        overrideBalance ? { overrideBalance: true } : undefined,
      );
    },
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setQueuedNotice('Checkout queued — applies when the connection restores.');
      } else {
        const autoCapture =
          result.body &&
          typeof result.body === 'object' &&
          'autoCapture' in result.body
            ? (result.body as { autoCapture?: string }).autoCapture
            : undefined;
        if (autoCapture === 'failed') {
          setCaptureDueRetry(true);
          setMessage('Checkout succeeded but auto-capture failed. Retry capture-due.');
        } else {
          setMessage('Checked out.');
        }
        if (autoCapture === 'captured') {
          void queryClient.invalidateQueries({
            queryKey: ['folio', propertyId, reservationId],
          });
          void queryClient.invalidateQueries({
            queryKey: ['folio-payments', propertyId, reservationId],
          });
        }
      }
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
      if (!isQueuedResult(result)) {
        void queryClient.invalidateQueries({ queryKey: ['board'] });
        void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] });
        void queryClient.invalidateQueries({ queryKey: ['front-desk-free', propertyId] });
      }
    },
  });

  const closeWindow = useFolioActionMutation({
    fallback: 'Close window failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'close_cancelled') return true;
      return false;
    },
    mutationFn: (folioWindowId: string) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.closeFolioWindow(
        propertyId,
        folioWindowId,
        `close-win:${folioWindowId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Window closed.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const reopenWindow = useFolioActionMutation({
    fallback: 'Reopen window failed',
    setMessage,
    mutationFn: (folioWindowId: string) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.reopenFolioWindow(
        propertyId,
        folioWindowId,
        `reopen-win:${folioWindowId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Window reopened.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const openCompany = useFolioActionMutation({
    fallback: 'Open company folio failed',
    setMessage,
    mutationFn: () => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.openFolioWindow(
        propertyId,
        reservationId,
        { kind: 'COMPANY', billedParty: companyBilledParty.trim() || undefined },
        `open-co:${reservationId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('COMPANY window opened.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const transferLine = useFolioActionMutation<
    FolioTransferResult,
    { folioLineId: string; destinationFolioWindowId: string }
  >({
    fallback: 'Transfer failed',
    setMessage,
    mutationFn: (input) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.transferFolioLine(
        propertyId,
        input.folioLineId,
        { destinationFolioWindowId: input.destinationFolioWindowId },
        `xfer:${input.folioLineId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: (result, input) => {
      const destWindow = windows.find((w) => w.folioWindowId === input.destinationFolioWindowId);
      const destIsCompany = destWindow?.kind === 'COMPANY';
      if (destIsCompany && result.cityLedgerSynced === true) {
        setMessage('Charge transferred.');
      } else if (destIsCompany) {
        setMessage('Moved to company folio.');
      } else {
        setMessage('Charge transferred.');
      }
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  const voidPay = useFolioActionMutation({
    fallback: 'Void failed',
    setMessage,
    mutationFn: (paymentId: string) => {
      if (!canPost) throw new Error('policy_blocked_post');
      return api.voidPayment(
        propertyId,
        paymentId,
        `void:${paymentId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: (_data, paymentId) => {
      const voided = (paymentsQ.data?.payments ?? []).find((p) => p.paymentId === paymentId);
      setMessage(voided?.purpose === 'DAMAGE' ? 'Damage deposit released.' : 'Payment voided.');
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const reconcilePay = useFolioActionMutation({
    fallback: 'Reconcile failed',
    setMessage,
    mutationFn: (input: { paymentId: string; outcome: 'authorized' | 'declined' }) => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      return api.reconcilePayment(
        propertyId,
        input.paymentId,
        { outcome: input.outcome },
        `reconcile:${input.paymentId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: (_data, input) => {
      setMessage(
        input.outcome === 'authorized' ? 'Payment marked authorized.' : 'Payment marked declined.',
      );
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const refundPay = useFolioActionMutation({
    fallback: 'Refund failed',
    setMessage,
    mutationFn: ({ paymentId, amountMinor }: { paymentId: string; amountMinor: number }) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.refundPayment(
        propertyId,
        paymentId,
        amountMinor,
        `refund:${paymentId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Payment refunded.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const discount = useFolioActionMutation({
    fallback: 'Discount failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'discount_reason_required') {
        setMessage('Discount requires a reason.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      const reason = discountReason.trim();
      if (!reason) throw new Error('discount_reason_required');
      if (!discountValueValid) throw new Error('invalid_discount_value');
      const sourceId = discountLineId || splitLineId;
      const parsed = Number(discountTrimmed);
      const payload = {
        kind: discountKind,
        reason,
        ...(discountKind === 'percent'
          ? { bps: Math.round(parsed * 100) }
          : { amountMinor: Math.round(parsed * 100) }),
      };
      if (!sourceId) {
        return api.postStayDiscount(
          propertyId,
          reservationId,
          {
            ...payload,
            folioLineId: `${reservationId}:stay-disc:${crypto.randomUUID()}`,
          },
          `stay-disc:${reservationId}:${crypto.randomUUID()}`,
        );
      }
      return api.postDiscount(
        propertyId,
        sourceId,
        {
          ...payload,
          folioLineId: `${sourceId}:disc:${crypto.randomUUID()}`,
        },
        `disc:${sourceId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Discount posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });

  function setActiveInvoiceId(invoiceId: string | null) {
    queryClient.setQueryData(activeInvoiceKey, invoiceId);
  }

  function invoiceIdFromGenerateResult(result: {
    body: unknown;
    classified: { class: string; status?: number; body?: unknown };
  }): string | null {
    const body = result.body;
    if (body && typeof body === 'object' && 'invoiceId' in body) {
      const id = (body as { invoiceId?: unknown }).invoiceId;
      if (typeof id === 'string' && id.length > 0) return id;
    }
    return null;
  }

  async function generateInvoiceForFolio(idempotencyKey?: string) {
    try {
      return await api.generateInvoice(propertyId, {
        reservationId,
        idempotencyKey,
      });
    } catch (err) {
      if (err instanceof ClassifiedError) {
        const body = err.classified.body;
        if (
          err.classified.status === 409 &&
          body &&
          typeof body === 'object' &&
          'error' in body &&
          (body as { error?: string }).error === 'invoice_already_exists' &&
          'invoiceId' in body &&
          typeof (body as { invoiceId?: unknown }).invoiceId === 'string'
        ) {
          return { classified: err.classified, body };
        }
      }
      throw err;
    }
  }

  const generateInv = useFolioActionMutation({
    fallback: 'Invoice generation failed',
    setMessage,
    mutationFn: () => generateInvoiceForFolio(`invoice:desk:${reservationId}:${crypto.randomUUID()}`),
    onSuccess: (result) => {
      const invoiceId = invoiceIdFromGenerateResult(result);
      if (invoiceId) {
        setActiveInvoiceId(invoiceId);
        setMessage('Invoice opened.');
      } else {
        setMessage('Invoice generation failed.');
      }
    },
  });

  const voidInv = useFolioActionMutation({
    fallback: 'Void invoice failed',
    setMessage,
    mutationFn: () => {
      if (!activeInvoiceId) throw new Error('no_active_invoice');
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.voidInvoice(propertyId, activeInvoiceId, {
        idempotencyKey: `void:${activeInvoiceId}:${crypto.randomUUID()}`,
      });
    },
    onSuccess: () => {
      setActiveInvoiceId(null);
      void queryClient.removeQueries({ queryKey: ['invoice', propertyId, activeInvoiceId] });
      setMessage('Invoice voided.');
    },
  });

  const captureDueHolds = useFolioActionMutation({
    fallback: 'Capture-due failed',
    setMessage,
    mutationFn: () => {
      if (!canPost) throw new Error('policy_blocked_post');
      return api.captureDue(
        propertyId,
        reservationId,
        `capture-due:${reservationId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setCaptureDueRetry(false);
      setMessage('Due holds captured.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const toggleNoPost = useFolioActionMutation({
    fallback: 'No-post update failed',
    setMessage,
    mutationFn: () => {
      if (!canWrite) throw new Error('policy_blocked_write');
      return api.updateFrontOffice(
        propertyId,
        reservationId,
        `no-post:${reservationId}:${crypto.randomUUID()}`,
        { noPost: !noPost },
      );
    },
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setQueuedNotice(queuedWriteCopy());
      } else {
        setMessage(noPost ? 'No-post cleared.' : 'No-post set.');
      }
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
  });

  const guestState = guestRef ? guestsQ.data?.states[guestRef] : undefined;
  const guestResolved = guestState?.kind === 'resolved';
  const propertyTz = propertyQ.data?.property?.timeZone ?? 'UTC';
  const businessDate = propertyLocalToday(propertyTz);
  const showRemainingNightsWarn =
    reservationQ.data?.departureDate != null &&
    businessDate != null &&
    reservationQ.data.departureDate > businessDate &&
    policy.canCheckout;

  const earlyDepart = useFolioActionMutation({
    fallback: 'Early depart failed',
    setMessage,
    onLocalError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_early_depart') {
        setMessage('Early depart unavailable.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!showRemainingNightsWarn) throw new Error('policy_blocked_early_depart');
      return api.earlyDepart(propertyId, reservationId, `early-depart:${reservationId}`);
    },
    onSuccess: () => {
      setMessage('Stay shortened to today. Guest remains in house until checkout.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });

  const regCardLabels = useRegCardLabels(reservationQ.data);
  const roomCode = (() => {
    const roomId = reservationQ.data?.roomId;
    if (!roomId) return undefined;
    const code = roomsQ.data?.rooms.find((r) => r.roomId === roomId)?.code;
    return code && code.length > 0 ? code : undefined;
  })();
  const hasRoomLabel = !reservationQ.data?.roomId || roomCode != null;
  const canPrint = reservationQ.isSuccess && guestResolved && hasRoomLabel;
  const editorDisabled =
    writeDenied ||
    Boolean(reservationQ.data && TERMINAL_STATUSES.has(reservationQ.data.status));
  const chargeCodes = (chargeCodesQ.data?.codes ?? []) as Array<{ code: string; name: string }>;

  const tenderPayments = useMemo(
    () =>
      payments.filter(
        (p) => p.status === 'authorized' || p.status === 'captured' || p.status === 'unknown',
      ),
    [payments],
  );

  const ledgerRows = useMemo(() => {
    const chargeCodesLocal = (chargeCodesQ.data?.codes ?? []) as Array<{ code: string; name: string }>;
    const tenderPayments = payments.filter(
      (p) => p.status === 'authorized' || p.status === 'captured' || p.status === 'unknown',
    );
    const rows: LedgerRow[] = [];
    const tenderById = new Map<string, FolioPaymentRow>();
    for (const p of tenderPayments) tenderById.set(p.paymentId, p);
    for (const node of fold.roots) {
      const line = node.line;
      if (line.paymentId != null && tenderById.has(line.paymentId)) continue;
      const rowDate = line.businessDate
        ? date(line.businessDate)
        : instantDate(line.createdAt);
      const sortKey = line.businessDate
        ? Date.parse(`${line.businessDate}T00:00:00Z`)
        : line.createdAt;
      const parentDesc = chargeDescription(line.chargeCode, chargeCodesLocal);
      rows.push({
        key: line.folioLineId,
        sortKey,
        date: rowDate,
        code: line.chargeCode,
        description: node.orphanTax ? (
          <>
            <strong className="error">Orphan tax (data defect) </strong>
            {parentDesc}
          </>
        ) : (
          parentDesc
        ),
        chargeMinor: line.ledgerAmountMinor > 0 ? line.ledgerAmountMinor : 0,
        paymentMinor: line.ledgerAmountMinor < 0 ? line.ledgerAmountMinor : 0,
      });
      for (const t of node.taxes) {
        rows.push({
          key: t.line.folioLineId,
          sortKey,
          date: rowDate,
          code: 'TAX',
          description: `Tax · ${parentDesc}`,
          chargeMinor: t.line.ledgerAmountMinor > 0 ? t.line.ledgerAmountMinor : 0,
          paymentMinor: 0,
        });
      }
    }
    for (const p of tenderById.values()) {
      const cash = tenderMethod(p) === 'Cash';
      rows.push({
        key: `pay-${p.paymentId}`,
        sortKey: p.createdAt,
        date: instantDate(p.createdAt),
        code: cash ? 'CASH' : 'CARD',
        description: cash ? 'Cash payment' : `Card payment · ${tenderLabel(p)}`,
        chargeMinor: 0,
        paymentMinor: -p.amountMinor,
      });
    }
    rows.sort((a, b) => a.sortKey - b.sortKey);
    return rows;
  }, [fold, payments, chargeCodesQ.data, date, instantDate]);

  const invoiceBody = invoiceQ.data?.body as
    | { snapshot?: InvoiceSnapshot; presentation?: Record<string, unknown> }
    | undefined;
  const invoiceSnapshot = invoiceBody?.snapshot;
  const invoicePresentation =
    invoiceSnapshot?.presentation ?? invoiceBody?.presentation;
  const showInvoiceTax = presentationFlag(invoicePresentation, 'showTaxfee');
  const invoiceTitleRaw = invoicePresentation?.title;
  const invoiceHeadingTitle =
    typeof invoiceTitleRaw === 'string' && invoiceTitleRaw.trim().length > 0
      ? invoiceTitleRaw.trim()
      : 'Invoice';
  const invoiceHeadingNumber = invoiceSnapshot?.invoiceNumber;
  const invoiceCardTitle = invoiceHeadingNumber
    ? `${invoiceHeadingTitle} ${invoiceHeadingNumber}`
    : invoiceHeadingTitle;
  const invoiceFooterRaw = invoicePresentation?.footer;
  const invoiceFooter =
    typeof invoiceFooterRaw === 'string' && invoiceFooterRaw.trim().length > 0
      ? invoiceFooterRaw.trim()
      : null;
  const folioDegraded = readState(folioQ) === 'fail_closed' || readState(reservationQ) === 'fail_closed';

  const ledgerChargesMinor = ledgerRows.reduce((sum, r) => sum + r.chargeMinor, 0);
  const ledgerPaymentsMinor = ledgerRows.reduce((sum, r) => sum + Math.max(0, -r.paymentMinor), 0);
  const folioBack = folioBackTarget(reservationQ.data?.status);
  const checkoutNeedsOverride = typeof balanceMinor === 'number' && balanceMinor > 0;

  return (
    <>
      <PageHeader
        back={
          <Link to={folioBack.to}>{folioBack.label}</Link>
        }
        title={guestRef ? <GuestNameLink state={guestState} guestRef={guestRef} /> : 'Guest'}
        subtitle={
          reservationQ.data
            ? (() => {
                const res = reservationQ.data;
                return (
                  <>
                    {isReservationStatus(res.status) ? (
                      <StatusBadge status={res.status} vip={res.vipFlag === true} />
                    ) : (
                      reservationStatusLabel(res.status)
                    )}
                    {roomCode ? (
                      <>
                        <span className="sep">·</span> Room {roomCode}
                      </>
                    ) : null}
                    <span className="sep">·</span>
                    {dateRange(res.arrivalDate, res.departureDate)}
                    <span className="sep">·</span>{' '}
                    {nightsBetween(res.arrivalDate, res.departureDate)} nights
                  </>
                );
              })()
            : undefined
        }
        actions={
          <>
            {guestRef ? (
              <Link className="ui-link-btn" to={`/book?guestRef=${encodeURIComponent(guestRef)}`}>
                Book for guest
              </Link>
            ) : null}
            {policy.canCheckout ? (
              <Button
                type="button"
                intent="primary"
                data-testid="check-out"
                disabled={checkOut.isPending}
                onClick={() => {
                  if (checkoutNeedsOverride) {
                    setCheckoutOverrideOpen(true);
                    return;
                  }
                  checkOut.mutate(false);
                }}
              >
                Check out
              </Button>
            ) : null}
            {showRemainingNightsWarn ? (
              <Button
                type="button"
                intent="default"
                data-testid="early-depart"
                disabled={earlyDepart.isPending}
                onClick={() => setEarlyDepartOpen(true)}
              >
                Early depart
              </Button>
            ) : null}
          </>
        }
      />

      {folioQ.isError ? (
        <Alert data-testid="folio-unread">
          {classifiedUserMessage(asClassified(folioQ.error), {
            fallback: 'Could not load this folio.',
          })}
          {policy.reasons.charge ? ` · ${policy.reasons.charge}` : ''}
        </Alert>
      ) : null}
      {reservationQ.isError ? (
        <Alert data-testid="folio-reservation-error">
          {classifiedUserMessage(asClassified(reservationQ.error), {
            fallback: 'Could not load this reservation.',
          })}
        </Alert>
      ) : null}

      {showRemainingNightsWarn ? (
        <Alert intent="informational" data-testid="checkout-remaining-nights-warn">
          Checkout does not release remaining nights — shorten the stay first.
        </Alert>
      ) : null}

      {typeof balanceMinor === 'number' && balanceMinor < 0 ? (
        <Alert intent="informational" data-testid="folio-credit-notice">
          <AlertTitle>Guest credit {money(Math.abs(balanceMinor))}</AlertTitle>
          <span>The folio is overpaid. Issue a refund after departure if the guest asks for one.</span>
        </Alert>
      ) : null}

      {policy.canCheckout && folioQ.isError ? (
        <Alert data-testid="checkout-outage-copy">
          {policy.reasons.checkout ??
            'Folio unavailable; checking out will not settle any balance.'}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Charges &amp; payments</CardTitle>
        </CardHeader>
        <CardContent flush>
          {folioQ.isError ? (
            <Alert>
              {classifiedUserMessage(asClassified(folioQ.error), {
                fallback: 'Could not load folio lines.',
              })}
            </Alert>
          ) : (
            <div className="ui-table-scroll">
              <DataTable data-testid="folio-lines">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Date</DataTableHeaderCell>
                    <DataTableHeaderCell>Code</DataTableHeaderCell>
                    <DataTableHeaderCell>Description</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Charge</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Payment</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {ledgerRows.map((row) => (
                    <DataTableRow key={row.key}>
                      <DataTableCell>
                        <span className="ui-num">{row.date}</span>
                      </DataTableCell>
                      <DataTableCell>
                        <span className="ui-code">{row.code}</span>
                      </DataTableCell>
                      <DataTableCell>{row.description}</DataTableCell>
                      <DataTableCell align="right">
                        {row.chargeMinor > 0 ? money(row.chargeMinor) : '—'}
                      </DataTableCell>
                      <DataTableCell align="right">
                        {row.paymentMinor < 0 ? money(row.paymentMinor) : '—'}
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </CardContent>
        {!folioQ.isError ? (
          <CardFooter>
            <div className="ui-summary">
              <StatField label="Charges" value={money(ledgerChargesMinor)} />
              <StatField label="Payments" value={money(-ledgerPaymentsMinor)} />
            </div>
          </CardFooter>
        ) : null}
      </Card>

      <div className="app-two-col">
        <Card onFocusCapture={() => setChargeCodesRequested(true)}>
          <CardHeader>
            <CardTitle>Post a charge</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-row">
              {products.hasProducts ? (
                <Field
                  size="sm"
                  label="Product"
                  control={
                    <NativeSelect
                      aria-label="charge-product"
                      value={chargeProductId}
                      disabled={!policy.canPostCharge}
                      onChange={(e) => {
                        const item = products.byId.get(e.target.value);
                        setChargeProductId(e.target.value);
                        if (item) {
                          setChargeCode(item.chargeCode);
                          setChargeAmount(minorToMajorInput(item.defaultAmountMinor));
                        }
                      }}
                    >
                      <option value="">Choose a product</option>
                      {products.groups.map((g) => (
                        <optgroup key={g.category.categoryId} label={g.category.name}>
                          {g.items.map((i) => (
                            <option key={i.productId} value={i.productId}>
                              {i.name} · {money(i.defaultAmountMinor)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </NativeSelect>
                  }
                />
              ) : null}
              <Field
                size="sm"
                label="Charge code"
                control={
                  chargeCodesRequested && chargeCodesQ.isPending ? (
                    <Skeleton aria-label="Loading charge codes" />
                  ) : (
                  <NativeSelect
                    aria-label="charge-code"
                    value={chargeCode}
                    onChange={(e) => setChargeCode(e.target.value)}
                    onFocus={() => setChargeCodesRequested(true)}
                    disabled={!policy.canPostCharge}
                  >
                    {(chargeCodes.length > 0 ? chargeCodes : [{ code: chargeCode, name: chargeCode }]).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </NativeSelect>
                  )
                }
              />
              <Field
                size="xs"
                label="Amount"
                control={
                  <Input
                    aria-label="charge-amount"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                    disabled={!policy.canPostCharge}
                  />
                }
              />
              <Button
                type="button"
                data-testid="add-charge"
                disabled={!policy.canPostCharge || addCharge.isPending || chargeMinor == null}
                onFocus={() => setChargeCodesRequested(true)}
                onClick={() => {
                  setChargeCodesRequested(true);
                  addCharge.mutate();
                }}
              >
                Post charge
              </Button>
            </div>
            {!policy.canPostCharge && policy.reasons.charge ? (
              <p className="muted">{policy.reasons.charge}</p>
            ) : null}
          </CardContent>
        </Card>

        <RecurringChargesCard
          propertyId={propertyId}
          reservationId={reservationId}
          arrivalDate={reservationQ.data?.arrivalDate}
          businessDate={businessDate}
          status={reservationQ.data?.status ?? null}
          canRead={
            meShell.kind !== 'authority' ||
            meShell.authority.kind !== 'live' ||
            hasPropertyPermission(meShell.authority.me, 'folio:read')
          }
          canPost={!postDenied}
        />

        <Card>
          <CardHeader>
            <CardTitle>Take a payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-stack">
              {openShiftQ.isSuccess &&
              (openShiftQ.data as { shift?: unknown } | undefined)?.shift == null ? (
                <p className="muted" data-testid="cash-no-shift-warn">
                  No open cashier shift.
                </p>
              ) : null}
              <div className="ui-row">
                <Field
                  size="xs"
                  label="Cash"
                  control={
                    <Input
                      aria-label="cash-amount"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      disabled={!policy.canPay}
                    />
                  }
                />
                <Button
                  type="button"
                  data-testid="record-cash"
                  disabled={!policy.canPay || cashPay.isPending || cashMinor == null}
                  onClick={() => cashPay.mutate()}
                >
                  Record cash
                </Button>
              </div>
              <div className="ui-row">
                <Field
                  size="xs"
                  label="Card"
                  control={
                    <Input
                      aria-label="auth-amount"
                      value={authAmount}
                      onChange={(e) => setAuthAmount(e.target.value)}
                      disabled={!policy.canPay}
                    />
                  }
                />
                <Field
                  label="Purpose"
                  control={
                    <NativeSelect
                      data-testid="authorize-purpose"
                      aria-label="authorize-purpose"
                      value={authPurpose}
                      disabled={!policy.canPay}
                      onChange={(e) => setAuthPurpose(e.target.value === 'DAMAGE' ? 'DAMAGE' : 'STAY')}
                    >
                      <option value="STAY">Stay</option>
                      <option value="DAMAGE">Damage deposit</option>
                    </NativeSelect>
                  }
                />
                <Button
                  type="button"
                  data-testid="authorize-card"
                  disabled={!policy.canPay || authorize.isPending || authMinor == null}
                  onClick={() => authorize.mutate()}
                >
                  Charge card
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div data-testid="folio-balance">
            <Total
              label="Balance due"
              tone={
                typeof balanceMinor !== 'number'
                  ? 'neutral'
                  : balanceMinor < 0
                    ? 'credit'
                    : 'due'
              }
              value={
                typeof balanceMinor === 'number'
                  ? balanceMinor < 0
                    ? `${money(Math.abs(balanceMinor))} credit`
                    : money(balanceMinor)
                  : '…'
              }
            />
            {held > 0 || damageHeld > 0 || noPost || folioQ.data?.balanceAtRisk ? (
              <div className="ui-row">
                {held > 0 ? (
                  <span className="muted">{money(held)} held on card</span>
                ) : null}
                {damageHeld > 0 ? (
                  <span className="muted" data-testid="damage-held">
                    {money(damageHeld)} damage deposit held
                  </span>
                ) : null}
                {noPost ? (
                  <Badge rung="informational" data-testid="no-post-chip">
                    No-post
                  </Badge>
                ) : null}
                {folioQ.data?.balanceAtRisk ? (
                  <Badge rung="informational" data-testid="balance-at-risk">
                    Balance at risk
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle>Tenders</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsQ.isError ? (
            <Alert>
              {classifiedUserMessage(asClassified(paymentsQ.error), {
                fallback: 'Could not load payments.',
              })}
            </Alert>
          ) : tenderPayments.length === 0 ? (
            <p className="muted">No tenders</p>
          ) : (
            <DataTable data-testid="folio-tenders">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Method</DataTableHeaderCell>
                  <DataTableHeaderCell>Amount</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {tenderPayments.map((p) => {
                  const remaining = p.amountMinor - (p.capturedAmountMinor ?? 0);
                  const defaultAmt = minorToMajorInput(remaining);
                  const value = captureAmounts[p.paymentId] ?? defaultAmt;
                  const capturedBase = p.capturedAmountMinor ?? p.amountMinor;
                  const refundedBase = p.refundedAmountMinor ?? 0;
                  const remainingMinor = capturedBase - refundedBase;
                  const defaultRefund = minorToMajorInput(remainingMinor);
                  const refundValue = refundAmounts[p.paymentId] ?? defaultRefund;
                  return (
                    <DataTableRow key={p.paymentId}>
                      <DataTableCell>{tenderLabel(p)}</DataTableCell>
                      <DataTableCell>{money(p.amountMinor)}</DataTableCell>
                      <DataTableCell>{tenderStatusLabel(p)}</DataTableCell>
                      <DataTableCell>
                        {p.status === 'unknown' ? (
                          <>
                            <Button
                              type="button"
                              disabled={!policy.canPay || reconcilePay.isPending}
                              onClick={() =>
                                reconcilePay.mutate({
                                  paymentId: p.paymentId,
                                  outcome: 'authorized',
                                })
                              }
                            >
                              Mark authorized
                            </Button>
                            <Button
                              type="button"
                              disabled={!policy.canPay || reconcilePay.isPending}
                              onClick={() =>
                                reconcilePay.mutate({
                                  paymentId: p.paymentId,
                                  outcome: 'declined',
                                })
                              }
                            >
                              Mark declined
                            </Button>
                          </>
                        ) : null}
                        {p.status === 'authorized' && p.purpose === 'DAMAGE' ? (
                          <>
                            {canPost ? (
                              <Button
                                type="button"
                                intent="destructive"
                                data-testid={`release-payment-${p.paymentId}`}
                                disabled={voidPay.isPending}
                                onClick={() => setReleasePaymentId(p.paymentId)}
                              >
                                Release
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              data-testid={`forfeit-payment-${p.paymentId}`}
                              disabled={!policy.canPay || !policy.canPostCharge || forfeitPending}
                              onClick={() => {
                                setForfeitPaymentId(p.paymentId);
                                setForfeitAmount(minorToMajorInput(p.amountMinor - (p.capturedAmountMinor ?? 0)));
                                setForfeitPostedMinor(null);
                                setForfeitNote(null);
                              }}
                            >
                              Forfeit
                            </Button>
                          </>
                        ) : null}
                        {p.status === 'authorized' && p.purpose !== 'DAMAGE' ? (
                          <>
                            <Input
                              aria-label={`capture-amount-${p.paymentId}`}
                              value={value}
                              onChange={(e) =>
                                setCaptureAmounts((prev) => ({
                                  ...prev,
                                  [p.paymentId]: e.target.value,
                                }))
                              }
                              disabled={!policy.canPay}
                            />
                            <Button
                              type="button"
                              disabled={!policy.canPay || capture.isPending}
                              onClick={() =>
                                capture.mutate({
                                  paymentId: p.paymentId,
                                  amountMinor: Math.round(Number(value) * 100),
                                  opId: `capture:${p.paymentId}:${crypto.randomUUID()}`,
                                })
                              }
                            >
                              Capture
                            </Button>
                            {canPost ? (
                              <Button
                                type="button"
                                intent="destructive"
                                data-testid={`void-payment-${p.paymentId}`}
                                disabled={voidPay.isPending}
                                onClick={() => setVoidPaymentId(p.paymentId)}
                              >
                                Void
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        {p.status === 'captured' && canAdjust ? (
                          <>
                            <Input
                              aria-label={`refund-amount-${p.paymentId}`}
                              value={refundValue}
                              onChange={(e) =>
                                setRefundAmounts((prev) => ({
                                  ...prev,
                                  [p.paymentId]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              intent="destructive"
                              data-testid={`refund-payment-${p.paymentId}`}
                              disabled={refundPay.isPending}
                              onClick={() =>
                                refundPay.mutate({
                                  paymentId: p.paymentId,
                                  amountMinor: Math.round(Number(refundValue) * 100),
                                })
                              }
                            >
                              Refund
                            </Button>
                          </>
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          )}
        </CardContent>
      </Card>

      {canGenerateInvoice ? (
        <section>
          <Button
            type="button"
            data-testid="invoice-generate"
            disabled={generateInv.isPending}
            onClick={() => {
              setDomainConfigRequested(true);
              generateInv.mutate();
            }}
          >
            Generate invoice
          </Button>
        </section>
      ) : null}

      {activeInvoiceId && invoiceQ.isSuccess ? (
        <Card data-testid="invoice-view">
          <CardHeader>
            <CardTitle>{invoiceCardTitle}</CardTitle>
          </CardHeader>
          <CardContent>
          {invoiceSnapshot?.invoiceDate ? (
            <p className="muted">{date(invoiceSnapshot.invoiceDate)}</p>
          ) : null}
          {invoiceSnapshot?.lines && invoiceSnapshot.lines.length > 0 ? (
            <ul className="ui-list">
              {invoiceSnapshot.lines.map((line, i) => (
                <li key={`${line.chargeName ?? line.chargeCode ?? 'line'}-${i}`}>
                  {line.chargeName ?? line.chargeCode ?? 'Line'}{' '}
                  {money(
                    typeof line.ledgerAmountMinor === 'number'
                      ? line.ledgerAmountMinor
                      : (line.amountMinor ?? 0),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No lines</p>
          )}
          {showInvoiceTax && invoiceSnapshot?.taxSummary && invoiceSnapshot.taxSummary.length > 0 ? (
            <ul className="ui-list">
              {invoiceSnapshot.taxSummary.map((t, i) => (
                <li key={`${t.taxRuleId ?? t.label ?? 'tax'}-${i}`}>
                  {t.label ?? 'Tax'} {money(t.amountMinor ?? 0)}
                </li>
              ))}
            </ul>
          ) : null}
          {invoiceSnapshot?.totals ? (
            <p>
              Charges {money(invoiceSnapshot.totals.chargesMinor ?? 0)}
              {showInvoiceTax && typeof invoiceSnapshot.totals.taxMinor === 'number'
                ? ` · Tax ${money(invoiceSnapshot.totals.taxMinor)}`
                : ''}
              {' · Balance '}
              {money(invoiceSnapshot.totals.balanceMinor ?? 0)}
            </p>
          ) : null}
          {invoiceFooter ? <p className="muted">{invoiceFooter}</p> : null}
          {canAdjust ? (
            <Button
              type="button"
              intent="destructive"
              data-testid="invoice-void"
              disabled={voidInv.isPending || folioDegraded}
              onClick={() => setVoidInvoiceOpen(true)}
            >
              Void invoice
            </Button>
          ) : null}
          </CardContent>
        </Card>
      ) : null}

      {message ? (
        <Alert intent={messageIntent} data-testid="folio-message">
          {message}
        </Alert>
      ) : null}

      <details
        className="folio-advanced"
        data-testid="folio-advanced"
        onToggle={(e) => setFolioAdvancedOpen(e.currentTarget.open)}
      >
        <summary>Advanced</summary>
        <div className="folio-advanced__body">
          {canWrite ? (
            <div className="folio-advanced__actions">
              <Button
                type="button"
                data-testid="toggle-no-post"
                disabled={toggleNoPost.isPending}
                onClick={() => toggleNoPost.mutate()}
              >
                {noPost ? 'Clear no-post' : 'Set no-post'}
              </Button>
            </div>
          ) : null}

          {reservationQ.isSuccess ? (
            <FrontOfficeEditor
              reservationId={reservationId}
              frontOfficeComment={reservationQ.data.frontOfficeComment}
              vipFlag={reservationQ.data.vipFlag}
              dndFlag={reservationQ.data.dndFlag}
              sourceCode={reservationQ.data.sourceCode}
              marketSegmentCode={reservationQ.data.marketSegmentCode}
              disabled={editorDisabled}
              actions={<PrintRegCardControl canPrint={canPrint} />}
            />
          ) : (
            <PrintRegCardControl canPrint={canPrint} />
          )}
          <RegistrationCard
            propertyName={propertyQ.data?.property?.name ?? null}
            reservation={reservationQ.data}
            displayName={guestState?.kind === 'resolved' ? guestState.displayName : null}
            roomLabel={roomCode ?? null}
            roomTypeLabel={regCardLabels.roomTypeLabel ?? null}
            ratePlanLabel={regCardLabels.ratePlanLabel ?? null}
          />

          {windows.length > 0 ? (
            <section className="folio-advanced__section">
            <h2>Windows</h2>
            <ul className="folio-advanced__window-list" data-testid="folio-windows">
              {windows.map((w) => (
                <li key={w.folioWindowId}>
                  <Badge
                    rung={w.status === 'CLOSED' ? 'informational' : 'neutral'}
                    data-testid={`window-chip-${w.folioWindowId}`}
                  >
                    {w.kind} {w.status} · {money(w.balanceMinor)}
                  </Badge>
                  {canAdjust && w.status === 'OPEN' ? (
                    <Button
                      type="button"
                      data-testid={`close-window-${w.folioWindowId}`}
                      disabled={windowCloseDisabled(w) || closeWindow.isPending}
                      onClick={() => setCloseWindowId(w.folioWindowId)}
                    >
                      Close
                    </Button>
                  ) : null}
                  {canAdjust && w.status === 'CLOSED' ? (
                    <Button
                      type="button"
                      data-testid={`reopen-window-${w.folioWindowId}`}
                      disabled={reopenWindow.isPending}
                      onClick={() => reopenWindow.mutate(w.folioWindowId)}
                    >
                      Reopen
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canAdjust ? (
              <div className="folio-advanced__actions">
                {cityLedgerPickerAvailable ? (
                  <NativeSelect
                    aria-label="company-billed-party"
                    data-testid="company-account-picker"
                    value={companyBilledParty}
                    onChange={(e) => {
                      setCompanyBilledParty(e.target.value);
                      setBilledPartyHint(null);
                    }}
                  >
                    <option value="">Select city ledger account…</option>
                    {cityLedgerAccounts.map((account) => (
                      <option key={account.accountId} value={account.name}>
                        {account.name} ({account.status})
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <>
                    <Input
                      aria-label="company-billed-party"
                      data-testid="company-account-picker"
                      placeholder="Company or agency name"
                      value={companyBilledParty}
                      onChange={(e) => setCompanyBilledParty(e.target.value)}
                    />
                    {billedPartyHint ? <span className="muted">{billedPartyHint}</span> : null}
                  </>
                )}
                <Button
                  type="button"
                  data-testid="open-company-window"
                  disabled={openCompany.isPending}
                  onClick={() => openCompany.mutate()}
                >
                  Open company folio
                </Button>
              </div>
            ) : null}
            </section>
          ) : canAdjust ? (
            <section className="folio-advanced__section">
            <h2>Windows</h2>
            {cityLedgerPickerAvailable ? (
              <NativeSelect
                aria-label="company-billed-party"
                data-testid="company-account-picker"
                value={companyBilledParty}
                onChange={(e) => {
                  setCompanyBilledParty(e.target.value);
                  setBilledPartyHint(null);
                }}
              >
                <option value="">Select city ledger account…</option>
                {cityLedgerAccounts.map((account) => (
                  <option key={account.accountId} value={account.name}>
                    {account.name} ({account.status})
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <>
                <Input
                  aria-label="company-billed-party"
                  data-testid="company-account-picker"
                  placeholder="Company or agency name"
                  value={companyBilledParty}
                  onChange={(e) => setCompanyBilledParty(e.target.value)}
                />
                {billedPartyHint ? <span className="muted">{billedPartyHint}</span> : null}
              </>
            )}
            <Button
              type="button"
              data-testid="open-company-window"
              disabled={openCompany.isPending}
              onClick={() => openCompany.mutate()}
            >
              Open company folio
            </Button>
            </section>
          ) : null}

          {showCaptureDue ? (
            <div className="folio-advanced__actions">
              <Button
                type="button"
                data-testid="capture-due"
                disabled={captureDueHolds.isPending}
                onClick={() => captureDueHolds.mutate()}
              >
                Capture due
              </Button>
            </div>
          ) : null}

        <ul className="folio-advanced__line-actions">
          {fold.roots.map((node) => (
            <li key={`adv-${node.line.folioLineId}`}>
              {node.line.txnCurrency !== ledgerCurrency ||
              (node.line.fxRate && node.line.fxRate !== '1') ? (
                <span data-testid="line-fx">
                  {money(node.line.amountMinor, node.line.txnCurrency)} →{' '}
                  {money(node.line.ledgerAmountMinor)} @ {node.line.fxRate ?? '1'}
                </span>
              ) : null}
              {canAdjust && transferDestsFor(node.line.folioWindowId).length > 0 ? (
                <>
                  <NativeSelect
                    data-testid={`transfer-dest-${node.line.folioLineId}`}
                    aria-label={`transfer-dest-${node.line.folioLineId}`}
                    value={
                      transferDest[node.line.folioLineId] ??
                      transferDestsFor(node.line.folioWindowId)[0]?.folioWindowId ??
                      ''
                    }
                    onChange={(e) =>
                      setTransferDest((prev) => ({
                        ...prev,
                        [node.line.folioLineId]: e.target.value,
                      }))
                    }
                  >
                    {transferDestsFor(node.line.folioWindowId).map((w) => (
                      <option key={w.folioWindowId} value={w.folioWindowId}>
                        {w.kind}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    data-testid={`transfer-line-${node.line.folioLineId}`}
                    disabled={transferLine.isPending}
                    onClick={() => {
                      const dest =
                        transferDest[node.line.folioLineId] ??
                        transferDestsFor(node.line.folioWindowId)[0]?.folioWindowId;
                      if (!dest) return;
                      transferLine.mutate({
                        folioLineId: node.line.folioLineId,
                        destinationFolioWindowId: dest,
                      });
                    }}
                  >
                    Transfer
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>

        <section className="folio-advanced__section">
          <h2>Queued this reservation</h2>
          {queued.forReservation.length === 0 ? (
            <p className="muted">None</p>
          ) : (
            <ul>
              {queued.forReservation.map((e) => (
                <li key={`${e.commandId}-${e.idempotencyKey}`}>
                  {queuedCommandLine(e, fmt)}
                </li>
              ))}
            </ul>
          )}
          {queued.other.length > 0 ? (
            <>
              <h3>Other queued commands</h3>
              <ul>
                {queued.other.map((e) => (
                  <li key={`${e.commandId}-${e.idempotencyKey}`}>
                    {queuedCommandLine(e, fmt)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="folio-advanced__section folio-advanced__form-row">
          <h2>Split charge</h2>
          <Input
            aria-label="split-line-id"
            placeholder="folio line id"
            value={splitLineId}
            onChange={(e) => setSplitLineId(e.target.value)}
          />
          <Input
            aria-label="split-a"
            placeholder="amount a"
            value={splitA}
            onChange={(e) => setSplitA(e.target.value)}
          />
          <Input
            aria-label="split-b"
            placeholder="amount b"
            value={splitB}
            onChange={(e) => setSplitB(e.target.value)}
          />
          <NativeSelect
            aria-label="split-dest-a"
            value={splitDestA || guestWindowId}
            onChange={(e) => setSplitDestA(e.target.value)}
          >
            {openWindows.map((w) => (
              <option key={w.folioWindowId} value={w.folioWindowId}>
                {w.kind}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="split-dest-b"
            value={splitDestB || guestWindowId}
            onChange={(e) => setSplitDestB(e.target.value)}
          >
            {openWindows.map((w) => (
              <option key={w.folioWindowId} value={w.folioWindowId}>
                {w.kind}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            data-testid="split-charge"
            disabled={!canSplit || split.isPending || !splitLineId}
            onClick={() => split.mutate()}
          >
            Split
          </Button>
          <Button
            type="button"
            data-testid="split-payment"
            disabled={!canSplit || splitPayment.isPending || !splitLineId}
            onClick={() => splitPayment.mutate()}
          >
            Split payment
          </Button>
          {!canSplit && splitReason ? <p className="muted">{splitReason}</p> : null}
        </section>

        {canAdjust ? (
          <section className="folio-advanced__section folio-advanced__form-row">
            <h2>Discount</h2>
            <Input
              aria-label="discount-line-id"
              placeholder="folio line id"
              value={discountLineId}
              onChange={(e) => setDiscountLineId(e.target.value)}
            />
            <Input
              aria-label="discount-reason"
              placeholder="reason"
              value={discountReason}
              onChange={(e) => setDiscountReason(e.target.value)}
            />
            <NativeSelect
              aria-label="discount-kind"
              value={discountKind}
              onChange={(e) => setDiscountKind(e.target.value as 'percent' | 'fixed')}
            >
              <option value="percent">percent</option>
              <option value="fixed">fixed</option>
            </NativeSelect>
            <Input
              aria-label="discount-value"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
            <Button
              type="button"
              data-testid="post-discount"
              disabled={!discountReason.trim() || discount.isPending || !discountValueValid}
              onClick={() => discount.mutate()}
            >
              Post discount
            </Button>
          </section>
        ) : null}

        {canAdjust ? (
          <section
            className="folio-advanced__section folio-advanced__form-row"
            data-testid="chargeback-form"
          >
            <h2>Chargeback</h2>
            <Input
              aria-label="chargeback-payment-id"
              placeholder="payment id"
              value={chargebackPaymentId}
              onChange={(e) => setChargebackPaymentId(e.target.value)}
              disabled={!folioLive}
            />
            <Input
              aria-label="chargeback-fee"
              value={chargebackFee}
              onChange={(e) => setChargebackFee(e.target.value)}
              disabled={!folioLive}
            />
            <Input
              aria-label="chargeback-reason"
              placeholder="reason"
              value={chargebackReason}
              onChange={(e) => setChargebackReason(e.target.value)}
              disabled={!folioLive}
            />
            <Button
              type="button"
              data-testid="record-chargeback"
              disabled={
                !folioLive || !chargebackPaymentId || !chargebackReason.trim() || chargeback.isPending
              }
              onClick={() => chargeback.mutate()}
            >
              Record chargeback
            </Button>
          </section>
        ) : null}

        {canAdjust ? (
          <section
            className="folio-advanced__section folio-advanced__form-row"
            data-testid="fx-adjustment-form"
          >
            <h2>FX adjustment</h2>
            <NativeSelect
              aria-label="fx-kind"
              value={fxKind}
              onChange={(e) => setFxKind(e.target.value as 'gain' | 'loss')}
              disabled={!folioLive}
            >
              <option value="loss">Loss</option>
              <option value="gain">Gain</option>
            </NativeSelect>
            <Input
              aria-label="fx-amount"
              value={fxAmount}
              onChange={(e) => setFxAmount(e.target.value)}
              disabled={!folioLive}
            />
            <Input
              aria-label="fx-reason"
              placeholder="reason"
              value={fxReason}
              onChange={(e) => setFxReason(e.target.value)}
              disabled={!folioLive}
            />
            <Button
              type="button"
              data-testid="post-fx-adjustment"
              disabled={!folioLive || !fxReason.trim() || fxAdjust.isPending || fxAmountMinor == null}
              onClick={() => fxAdjust.mutate()}
            >
              Post FX adjustment
            </Button>
          </section>
        ) : null}

        {canConfigureFx ? (
          <details
            className="folio-advanced__subsection"
            data-testid="fx-rates-editor"
            onToggle={(e) => setFxRatesEditorOpen(e.currentTarget.open)}
          >
            <summary>FX rates</summary>
            {fxRatesEditorOpen && fxRatesQ.isPending ? (
              <Skeleton label="Loading FX rates" />
            ) : (
            <>
            <ul className="ui-list">
              {(fxRatesQ.data?.rates ?? [])
                .filter((r) => r.effectiveTo === null)
                .map((r) => (
                  <li key={r.quoteId}>
                    {r.fromCurrency}→{r.toCurrency} @ {r.rate}
                  </li>
                ))}
            </ul>
            <div className="ui-row">
              <Input
                aria-label="fx-from"
                value={fxFrom}
                onChange={(e) => setFxFrom(e.target.value)}
                disabled={!folioLive}
              />
              <Input
                aria-label="fx-rate"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                disabled={!folioLive}
              />
            </div>
            <Button
              type="button"
              data-testid="create-fx-rate"
              disabled={!folioLive || createFx.isPending || !fxRateValid}
              onClick={() => createFx.mutate()}
            >
              Create FX rate
            </Button>
            </>
            )}
          </details>
        ) : null}

        <div className="folio-advanced__currency-grid">
          <Field
            label="Cash currency"
            control={
              <NativeSelect
                aria-label="cash-currency"
                data-testid="cash-currency"
                value={selectedPayCurrency}
                disabled={!policy.canPay || !folioLive}
                onChange={(e) => setPayCurrency(e.target.value)}
              >
                {payCurrencies.map((c) => (
                  <option key={`cash-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Card authorization currency"
            control={
              <NativeSelect
                aria-label="authorize-currency"
                data-testid="authorize-currency"
                value={selectedPayCurrency}
                disabled={!policy.canPay || !folioLive}
                onChange={(e) => setPayCurrency(e.target.value)}
              >
                {payCurrencies.map((c) => (
                  <option key={`auth-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {selectedPayCurrency !== ledgerCurrency ? (
            <p className="muted">Indicative — captured at the rate in force at capture.</p>
            ) : null}
        </div>
        </div>
      </details>
      {voidInvoiceOpen ? (
        <ConfirmDialog
          title="Void this invoice?"
          description="This cannot be undone."
          confirmLabel="Void invoice"
          intent="destructive"
          onCancel={() => setVoidInvoiceOpen(false)}
          onConfirm={() => {
            setVoidInvoiceOpen(false);
            voidInv.mutate();
          }}
        />
      ) : null}
      {voidPaymentId ? (
        <ConfirmDialog
          title="Void this payment?"
          description="This cannot be undone."
          confirmLabel="Void payment"
          intent="destructive"
          onCancel={() => setVoidPaymentId(null)}
          onConfirm={() => {
            const paymentId = voidPaymentId;
            setVoidPaymentId(null);
            voidPay.mutate(paymentId);
          }}
        />
      ) : null}
      {releasePaymentId ? (
        <ConfirmDialog
          title="Release damage deposit"
          description="Release the damage deposit hold?"
          confirmLabel="Release"
          intent="destructive"
          onCancel={() => setReleasePaymentId(null)}
          onConfirm={() => {
            const paymentId = releasePaymentId;
            setReleasePaymentId(null);
            voidPay.mutate(paymentId);
          }}
        />
      ) : null}
      {forfeitPaymentId ? (
        <FormDialog
          title="Forfeit damage deposit"
          onClose={() => {
            if (forfeitPending) return;
            setForfeitPaymentId(null);
          }}
          actions={
            <>
            <Button type="button" disabled={forfeitPending} onClick={() => setForfeitPaymentId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              intent="destructive"
              data-testid="forfeit-submit"
              disabled={forfeitPending}
              onClick={() => {
                void submitForfeit();
              }}
            >
              {forfeitPostedMinor != null ? 'Retry capture' : 'Forfeit'}
            </Button>
            </>
          }
        >
          <p className="muted">
            Posts a damage charge for this amount to the folio, then takes it from the hold. The
            rest of the hold is released.
          </p>
          <Field
            label="Amount"
            control={
              <Input
                data-testid="forfeit-amount"
                value={forfeitAmount}
                disabled={forfeitPostedMinor != null}
                onChange={(e) => setForfeitAmount(e.target.value)}
              />
            }
          />
          {forfeitNote ? <Alert data-testid="forfeit-note">{forfeitNote}</Alert> : null}
        </FormDialog>
      ) : null}
      {checkoutOverrideOpen ? (
        <ConfirmDialog
          title="Depart with open balance?"
          description={`Depart with open balance ${money(balanceMinor ?? 0)}? This posts checkout with a balance override.`}
          confirmLabel="Check out"
          onCancel={() => setCheckoutOverrideOpen(false)}
          onConfirm={() => {
            setCheckoutOverrideOpen(false);
            checkOut.mutate(true);
          }}
        />
      ) : null}
      {earlyDepartOpen ? (
        <ConfirmDialog
          title="Early depart today?"
          description="Shorten the stay to today's business date. Remaining nights are released from inventory. The guest stays in house until checkout."
          confirmLabel="Early depart"
          onCancel={() => setEarlyDepartOpen(false)}
          onConfirm={() => {
            setEarlyDepartOpen(false);
            earlyDepart.mutate();
          }}
        />
      ) : null}
      {closeWindowId ? (
        <ConfirmDialog
          title="Close this folio window?"
          description="This closes the folio window on the stay."
          confirmLabel="Close window"
          onCancel={() => setCloseWindowId(null)}
          onConfirm={() => {
            const id = closeWindowId;
            setCloseWindowId(null);
            closeWindow.mutate(id);
          }}
        />
      ) : null}
    </>
  );
}
