import {
  foldFolioLines,
  folioActionPolicy,
  partitionQueuedByReservation,
  type FolioLine,
  type FolioPaymentRow,
  type FolioReadState,
} from '@hospai/client-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useMemo, useState } from 'react';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, queuedCommands, tenant } from '../client.js';
import { formatMinor } from '../money.js';
import { statusClass } from '../status/status-class.js';
import { guestLabel } from './guest-row.js';
import { useFolioActionMutation } from './use-folio-action-mutation.js';

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

function heldAmount(payments: FolioPaymentRow[]): number {
  let sum = 0;
  for (const p of payments) {
    if (p.status === 'authorized') {
      const captured = p.capturedAmountMinor ?? 0;
      sum += Math.max(0, p.amountMinor - captured);
    }
  }
  return sum;
}

export function FolioScreen() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [chargeCode, setChargeCode] = useState('MISC');
  const [chargeAmount, setChargeAmount] = useState('10.00');
  const [cashAmount, setCashAmount] = useState('10.00');
  const [authAmount, setAuthAmount] = useState('50.00');
  const [splitLineId, setSplitLineId] = useState('');
  const [splitA, setSplitA] = useState('');
  const [splitB, setSplitB] = useState('');
  const [splitDestA, setSplitDestA] = useState('');
  const [splitDestB, setSplitDestB] = useState('');
  const [companyBilledParty, setCompanyBilledParty] = useState('');
  const [discountLineId, setDiscountLineId] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountKind, setDiscountKind] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('10');
  const [transferDest, setTransferDest] = useState<Record<string, string>>({});
  const [captureDueRetry, setCaptureDueRetry] = useState(false);
  const [captureAmounts, setCaptureAmounts] = useState<Record<string, string>>({});
  const [chargeOpId] = useState(() => `charge:${reservationId}:${crypto.randomUUID()}`);
  const [cashOpId] = useState(() => `cash:${reservationId}:${crypto.randomUUID()}`);
  const [authOpId] = useState(() => `auth:${reservationId}:${crypto.randomUUID()}`);

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
  const held = heldAmount(payments);
  const balanceMinor = folioQ.data?.balanceMinor;
  const windows = folioQ.data?.windows ?? [];
  const openWindows = windows.filter((w) => w.status === 'OPEN');
  const guestWindowId =
    windows.find((w) => w.kind === 'GUEST')?.folioWindowId ?? `${reservationId}:GUEST`;
  const reservationTerminal = TERMINAL_STATUSES.has(reservationQ.data?.status ?? '');
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
      const amountMinor = Math.round(Number(chargeAmount) * 100);
      return api.addFolioLine(
        propertyId,
        reservationId,
        { chargeCode, amountMinor },
        chargeOpId,
      );
    },
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Charge queued (provisional).');
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
      const amountMinor = Math.round(Number(cashAmount) * 100);
      return api.recordCashPayment(
        propertyId,
        reservationId,
        { paymentId: `pay_${cashOpId}`, amountMinor },
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
      const amountMinor = Math.round(Number(authAmount) * 100);
      return api.authorizePayment(
        propertyId,
        reservationId,
        { paymentId: `pay_${authOpId}`, amountMinor },
        authOpId,
      );
    },
    onSuccess: () => {
      setMessage('Card authorized.');
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
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
      return api.splitFolioLineV2(propertyId, splitLineId, splitPayload(), opId);
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
      return api.splitFolioPayment(propertyId, splitLineId, splitPayload(), opId);
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
      if (err instanceof Error && err.message === 'checkout_cancelled') return true;
      if (err instanceof Error && err.message === 'policy_blocked_checkout') {
        setMessage(policy.reasons.checkout ?? 'Checkout unavailable.');
        return true;
      }
      return false;
    },
    mutationFn: () => {
      if (!policy.canCheckout) throw new Error('policy_blocked_checkout');
      const overrideBalance =
        typeof balanceMinor === 'number' && balanceMinor !== 0;
      if (
        overrideBalance &&
        !window.confirm(
          `Depart with open balance ${formatMinor(balanceMinor)}? This posts checkout with a balance override.`,
        )
      ) {
        throw new Error('checkout_cancelled');
      }
      return api.checkOut(
        propertyId,
        reservationId,
        `checkout:${reservationId}`,
        overrideBalance ? { overrideBalance: true } : undefined,
      );
    },
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Checkout queued — applies when the connection restores.');
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
    },
  });

  const closeWindow = useFolioActionMutation({
    fallback: 'Close window failed',
    setMessage,
    onLocalError: (err) => err instanceof Error && err.message === 'close_cancelled',
    mutationFn: (folioWindowId: string) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      if (!window.confirm('Close this folio window?')) throw new Error('close_cancelled');
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
    fallback: 'Open COMPANY failed',
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

  const transferLine = useFolioActionMutation({
    fallback: 'Transfer failed',
    setMessage,
    mutationFn: (input: { folioLineId: string; destinationFolioWindowId: string }) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.transferFolioLine(
        propertyId,
        input.folioLineId,
        { destinationFolioWindowId: input.destinationFolioWindowId },
        `xfer:${input.folioLineId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Charge transferred.');
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
    onSuccess: () => {
      setMessage('Payment voided.');
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
  });

  const refundPay = useFolioActionMutation({
    fallback: 'Refund failed',
    setMessage,
    mutationFn: (paymentId: string) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.refundPayment(
        propertyId,
        paymentId,
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
      const sourceId = discountLineId || splitLineId;
      const parsed = Number(discountValue);
      return api.postDiscount(
        propertyId,
        sourceId,
        {
          kind: discountKind,
          reason,
          folioLineId: `${sourceId}:disc:${crypto.randomUUID()}`,
          ...(discountKind === 'percent'
            ? { bps: Math.round(parsed * 100) }
            : { amountMinor: Math.round(parsed * 100) }),
        },
        `disc:${sourceId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: () => {
      setMessage('Discount posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
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
    onSuccess: () => {
      setMessage(noPost ? 'No-post cleared.' : 'No-post set.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
  });

  const guestState = guestRef ? guestsQ.data?.states[guestRef] : undefined;

  return (
    <div className="panel">
      <p>
        <Link to="/in-house">← In house</Link>
      </p>
      <h1>Folio</h1>
      <p>
        {guestRef ? guestLabel(guestState, guestRef) : reservationId}
        {reservationQ.data
          ? ` · ${reservationQ.data.arrivalDate} → ${reservationQ.data.departureDate} · ${reservationQ.data.status}`
          : null}
        {reservationQ.data?.roomId ? ` · room ${reservationQ.data.roomId}` : null}
      </p>
      {guestRef ? (
        <p>
          <Link to={`/book?guestRef=${encodeURIComponent(guestRef)}`}>Book for guest</Link>
        </p>
      ) : null}

      {folioQ.isError ? (
        <p className="error" data-testid="folio-unread">
          Folio unreadable — property unreachable
          {policy.reasons.charge ? ` · ${policy.reasons.charge}` : ''}
        </p>
      ) : (
        <p data-testid="folio-balance">
          Balance {typeof balanceMinor === 'number' ? formatMinor(balanceMinor) : '…'}
          {held > 0 ? ` · ${formatMinor(held)} held on card` : ''}
          {noPost ? (
            <span data-testid="no-post-chip" className={statusClass('informational')}>
              {' '}
              No-post
            </span>
          ) : null}
        </p>
      )}
      {canWrite ? (
        <button
          type="button"
          data-testid="toggle-no-post"
          disabled={toggleNoPost.isPending}
          onClick={() => toggleNoPost.mutate()}
        >
          {noPost ? 'Clear no-post' : 'Set no-post'}
        </button>
      ) : null}

      {windows.length > 0 ? (
        <section>
          <h2>Windows</h2>
          <ul data-testid="folio-windows">
            {windows.map((w) => (
              <li key={w.folioWindowId}>
                <span
                  data-testid={`window-chip-${w.folioWindowId}`}
                  className={statusClass(w.status === 'CLOSED' ? 'informational' : 'neutral')}
                >
                  {w.kind} {w.status} · {formatMinor(w.balanceMinor)}
                </span>
                {canAdjust && w.status === 'OPEN' ? (
                  <button
                    type="button"
                    data-testid={`close-window-${w.folioWindowId}`}
                    disabled={windowCloseDisabled(w) || closeWindow.isPending}
                    onClick={() => closeWindow.mutate(w.folioWindowId)}
                  >
                    Close
                  </button>
                ) : null}
                {canAdjust && w.status === 'CLOSED' ? (
                  <button
                    type="button"
                    data-testid={`reopen-window-${w.folioWindowId}`}
                    disabled={reopenWindow.isPending}
                    onClick={() => reopenWindow.mutate(w.folioWindowId)}
                  >
                    Reopen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canAdjust ? (
            <div className="stack-row">
              <input
                aria-label="company-billed-party"
                placeholder="billed party"
                value={companyBilledParty}
                onChange={(e) => setCompanyBilledParty(e.target.value)}
              />
              <button
                type="button"
                data-testid="open-company-window"
                disabled={openCompany.isPending}
                onClick={() => openCompany.mutate()}
              >
                Open COMPANY
              </button>
            </div>
          ) : null}
        </section>
      ) : canAdjust ? (
        <section className="stack-row">
          <h2>Windows</h2>
          <input
            aria-label="company-billed-party"
            placeholder="billed party"
            value={companyBilledParty}
            onChange={(e) => setCompanyBilledParty(e.target.value)}
          />
          <button
            type="button"
            data-testid="open-company-window"
            disabled={openCompany.isPending}
            onClick={() => openCompany.mutate()}
          >
            Open COMPANY
          </button>
        </section>
      ) : null}

      <section>
        <h2>Holds</h2>
        {paymentsQ.isError ? (
          <p className="muted">Payments unavailable</p>
        ) : payments.filter((p) => p.status === 'authorized').length === 0 ? (
          <p className="muted">No authorized holds</p>
        ) : (
          <ul>
            {payments
              .filter((p) => p.status === 'authorized')
              .map((p) => {
                const remaining = p.amountMinor - (p.capturedAmountMinor ?? 0);
                const defaultAmt = formatMinor(remaining);
                const value = captureAmounts[p.paymentId] ?? defaultAmt;
                return (
                  <li key={p.paymentId}>
                    {p.paymentId} · {formatMinor(p.amountMinor)} · {p.status}
                    {p.gatewayReference ? ` · ${p.gatewayReference}` : ''}
                    <input
                      aria-label={`capture-amount-${p.paymentId}`}
                      value={value}
                      onChange={(e) =>
                        setCaptureAmounts((prev) => ({ ...prev, [p.paymentId]: e.target.value }))
                      }
                      disabled={!policy.canPay}
                    />
                    <button
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
                    </button>
                    {canPost ? (
                      <button
                        type="button"
                        data-testid={`void-payment-${p.paymentId}`}
                        disabled={voidPay.isPending}
                        onClick={() => voidPay.mutate(p.paymentId)}
                      >
                        Void
                      </button>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {payments.some((p) => p.status === 'captured') ? (
        <section>
          <h2>Captured</h2>
          <ul>
            {payments
              .filter((p) => p.status === 'captured')
              .map((p) => (
                <li key={p.paymentId}>
                  {p.paymentId} · {formatMinor(p.amountMinor)} · captured
                  {canAdjust ? (
                    <button
                      type="button"
                      data-testid={`refund-payment-${p.paymentId}`}
                      disabled={refundPay.isPending}
                      onClick={() => refundPay.mutate(p.paymentId)}
                    >
                      Refund
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {showCaptureDue ? (
        <button
          type="button"
          data-testid="capture-due"
          disabled={captureDueHolds.isPending}
          onClick={() => captureDueHolds.mutate()}
        >
          Capture due
        </button>
      ) : null}

      <section>
        <h2>Lines</h2>
        {folioQ.isError ? (
          <p className="muted">Lines unavailable</p>
        ) : (
          <ul data-testid="folio-lines">
            {fold.roots.map((node) => (
              <li key={node.line.folioLineId}>
                {node.orphanTax ? (
                  <strong className="error">Orphan tax (data defect) </strong>
                ) : null}
                {node.line.chargeCode} {formatMinor(node.line.ledgerAmountMinor)}
                {node.line.source ? ` · ${node.line.source}` : ''}
                {canAdjust && transferDestsFor(node.line.folioWindowId).length > 0 ? (
                  <>
                    <select
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
                    </select>
                    <button
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
                    </button>
                  </>
                ) : null}
                {node.taxes.length > 0 ? (
                  <ul>
                    {node.taxes.map((t) => (
                      <li key={t.line.folioLineId}>
                        tax {formatMinor(t.line.ledgerAmountMinor)}
                        {t.line.taxRuleId ? ` · ${t.line.taxRuleId}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Queued this reservation</h2>
        {queued.forReservation.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {queued.forReservation.map((e) => (
              <li key={`${e.commandId}-${e.idempotencyKey}`}>
                {e.commandId} · {e.idempotencyKey.slice(0, 8)}…
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
                  {e.commandId}
                  {e.reservationId ? ` · ${e.reservationId}` : ' · (untagged)'}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="stack-row">
        <h2>Add charge</h2>
        <input
          aria-label="charge-code"
          value={chargeCode}
          onChange={(e) => setChargeCode(e.target.value)}
          disabled={!policy.canPostCharge}
        />
        <input
          aria-label="charge-amount"
          value={chargeAmount}
          onChange={(e) => setChargeAmount(e.target.value)}
          disabled={!policy.canPostCharge}
        />
        <button
          type="button"
          data-testid="add-charge"
          disabled={!policy.canPostCharge || addCharge.isPending}
          onClick={() => addCharge.mutate()}
        >
          Add charge
        </button>
        {!policy.canPostCharge && policy.reasons.charge ? (
          <p className="muted">{policy.reasons.charge}</p>
        ) : null}
      </section>

      <section className="stack-row">
        <h2>Cash</h2>
        {openShiftQ.isSuccess &&
        (openShiftQ.data as { shift?: unknown } | undefined)?.shift == null ? (
          <p className="muted" data-testid="cash-no-shift-warn">
            No open shift — this payment will be unattributed until close discloses the count.
          </p>
        ) : null}
        <input
          aria-label="cash-amount"
          value={cashAmount}
          onChange={(e) => setCashAmount(e.target.value)}
          disabled={!policy.canPay}
        />
        <button
          type="button"
          data-testid="record-cash"
          disabled={!policy.canPay || cashPay.isPending}
          onClick={() => cashPay.mutate()}
        >
          Record cash
        </button>
      </section>

      <section className="stack-row">
        <h2>Authorize card</h2>
        <input
          aria-label="auth-amount"
          value={authAmount}
          onChange={(e) => setAuthAmount(e.target.value)}
          disabled={!policy.canPay}
        />
        <button
          type="button"
          data-testid="authorize-card"
          disabled={!policy.canPay || authorize.isPending}
          onClick={() => authorize.mutate()}
        >
          Authorize
        </button>
      </section>

      <section className="stack-row">
        <h2>Split charge</h2>
        <input
          aria-label="split-line-id"
          placeholder="folio line id"
          value={splitLineId}
          onChange={(e) => setSplitLineId(e.target.value)}
        />
        <input
          aria-label="split-a"
          placeholder="amount a"
          value={splitA}
          onChange={(e) => setSplitA(e.target.value)}
        />
        <input
          aria-label="split-b"
          placeholder="amount b"
          value={splitB}
          onChange={(e) => setSplitB(e.target.value)}
        />
        <select
          aria-label="split-dest-a"
          value={splitDestA || guestWindowId}
          onChange={(e) => setSplitDestA(e.target.value)}
        >
          {openWindows.map((w) => (
            <option key={w.folioWindowId} value={w.folioWindowId}>
              {w.kind}
            </option>
          ))}
        </select>
        <select
          aria-label="split-dest-b"
          value={splitDestB || guestWindowId}
          onChange={(e) => setSplitDestB(e.target.value)}
        >
          {openWindows.map((w) => (
            <option key={w.folioWindowId} value={w.folioWindowId}>
              {w.kind}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="split-charge"
          disabled={!canSplit || split.isPending || !splitLineId}
          onClick={() => split.mutate()}
        >
          Split
        </button>
        <button
          type="button"
          data-testid="split-payment"
          disabled={!canSplit || splitPayment.isPending || !splitLineId}
          onClick={() => splitPayment.mutate()}
        >
          Split payment
        </button>
        {!canSplit && splitReason ? <p className="muted">{splitReason}</p> : null}
      </section>

      {canAdjust ? (
        <section className="stack-row">
          <h2>Discount</h2>
          <input
            aria-label="discount-line-id"
            placeholder="folio line id"
            value={discountLineId}
            onChange={(e) => setDiscountLineId(e.target.value)}
          />
          <input
            aria-label="discount-reason"
            placeholder="reason"
            value={discountReason}
            onChange={(e) => setDiscountReason(e.target.value)}
          />
          <select
            aria-label="discount-kind"
            value={discountKind}
            onChange={(e) => setDiscountKind(e.target.value as 'percent' | 'fixed')}
          >
            <option value="percent">percent</option>
            <option value="fixed">fixed</option>
          </select>
          <input
            aria-label="discount-value"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
          <button
            type="button"
            data-testid="post-discount"
            disabled={!discountReason.trim() || discount.isPending}
            onClick={() => discount.mutate()}
          >
            Post discount
          </button>
        </section>
      ) : null}

      <section>
        {policy.canCheckout ? (
          <>
            {folioQ.isError ? (
              <p className="error" data-testid="checkout-outage-copy">
                {policy.reasons.checkout ??
                  'Folio unavailable; checking out will not settle any balance.'}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="check-out"
              disabled={checkOut.isPending}
              onClick={() => checkOut.mutate()}
            >
              Check out
            </button>
          </>
        ) : null}
      </section>

      {message ? <p data-testid="folio-message">{message}</p> : null}
    </div>
  );
}
