import {
  foldFolioLines,
  folioActionPolicy,
  partitionQueuedByReservation,
  permissionForForbidden,
  type FolioLine,
  type FolioPaymentRow,
  type FolioReadState,
} from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useMemo, useState } from 'react';
import { api, asClassified, queuedCommands, tenant } from '../client.js';
import { guestLabel } from './guest-row.js';

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

function formatMinor(n: number): string {
  return (n / 100).toFixed(2);
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

  function onClassifiedError(err: unknown, fallback: string, routeId: string) {
    const c = asClassified(err);
    if (c.class === 'forbidden') {
      const perm = permissionForForbidden(c.body, routeId);
      setMessage(
        perm
          ? `Requires permission ${perm}. Ask a manager.`
          : 'Forbidden — insufficient permission.',
      );
      return;
    }
    if (c.class === 'not_configured') {
      setMessage('Card payments are not configured for this property.');
      return;
    }
    if (c.class === 'idempotency_key_reused') {
      setMessage('An earlier submission of this form already posted; refresh the folio to see it.');
      return;
    }
    if (c.class === 'fail_closed') {
      setMessage('Property unreachable.');
      return;
    }
    if (c.class === 'queue_unavailable') {
      setMessage('Could not queue — queue unavailable.');
      return;
    }
    setMessage(`${fallback} (${c.class})`);
  }

  const addCharge = useMutation({
    mutationFn: () => {
      if (!policy.canPostCharge) {
        throw new Error('policy_blocked_charge');
      }
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
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_charge') {
        setMessage(policy.reasons.charge ?? 'Charge refused.');
        return;
      }
      onClassifiedError(err, 'Charge failed', 'post_folio_lines');
    },
  });

  const cashPay = useMutation({
    mutationFn: () => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      const amountMinor = Math.round(Number(cashAmount) * 100);
      const paymentId = `pay_${cashOpId}`;
      return api.recordCashPayment(
        propertyId,
        reservationId,
        { paymentId, amountMinor },
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
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Payment refused.');
        return;
      }
      onClassifiedError(err, 'Cash failed', 'post_cash_payment');
    },
  });

  const authorize = useMutation({
    mutationFn: () => {
      if (!policy.canPay) throw new Error('policy_blocked_pay');
      const amountMinor = Math.round(Number(authAmount) * 100);
      const paymentId = `pay_${authOpId}`;
      return api.authorizePayment(
        propertyId,
        reservationId,
        { paymentId, amountMinor },
        authOpId,
      );
    },
    onSuccess: () => {
      setMessage('Card authorized.');
      void queryClient.invalidateQueries({
        queryKey: ['folio-payments', propertyId, reservationId],
      });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Authorize refused.');
        return;
      }
      onClassifiedError(err, 'Authorize failed', 'post_folio_authorize');
    },
  });

  const capture = useMutation({
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
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_pay') {
        setMessage(policy.reasons.pay ?? 'Capture refused.');
        return;
      }
      onClassifiedError(err, 'Capture failed', 'post_folio_capture');
    },
  });

  function splitPayload() {
    const a = Math.round(Number(splitA) * 100);
    const b = Math.round(Number(splitB) * 100);
    return {
      splits: [
        { folioLineId: `${splitLineId}:a`, amountMinor: a },
        { folioLineId: `${splitLineId}:b`, amountMinor: b },
      ],
    };
  }

  const split = useMutation({
    mutationFn: () => {
      if (!policy.canSplit) throw new Error('policy_blocked_split');
      const opId = `split:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioLine(propertyId, splitLineId, splitPayload(), opId);
    },
    onSuccess: () => {
      setMessage('Split posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_split') {
        setMessage(policy.reasons.split ?? 'Split refused.');
        return;
      }
      onClassifiedError(err, 'Split failed', 'post_folio_split');
    },
  });

  const splitPayment = useMutation({
    mutationFn: () => {
      if (!policy.canSplit) throw new Error('policy_blocked_split');
      const opId = `splitpay:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioPayment(propertyId, splitLineId, splitPayload(), opId);
    },
    onSuccess: () => {
      setMessage('Payment split posted.');
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'policy_blocked_split') {
        setMessage(policy.reasons.split ?? 'Split refused.');
        return;
      }
      onClassifiedError(err, 'Split payment failed', 'post_folio_split_payment');
    },
  });

  const checkOut = useMutation({
    mutationFn: () => {
      if (!policy.canCheckout) throw new Error('policy_blocked_checkout');
      if (
        typeof balanceMinor === 'number' &&
        balanceMinor !== 0 &&
        !window.confirm(
          `Depart with open balance ${formatMinor(balanceMinor)}? Checkout does not require settlement.`,
        )
      ) {
        throw new Error('checkout_cancelled');
      }
      return api.checkOut(propertyId, reservationId, `checkout:${reservationId}`);
    },
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Checkout queued — applies when the connection restores.');
      } else {
        setMessage('Checked out.');
      }
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'checkout_cancelled') return;
      if (err instanceof Error && err.message === 'policy_blocked_checkout') {
        setMessage(policy.reasons.checkout ?? 'Checkout unavailable.');
        return;
      }
      onClassifiedError(err, 'Checkout failed', 'post_reservation_check_out');
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

      {folioQ.isError ? (
        <p className="error" data-testid="folio-unread">
          Folio unreadable — property unreachable
          {policy.reasons.charge ? ` · ${policy.reasons.charge}` : ''}
        </p>
      ) : (
        <p data-testid="folio-balance">
          Balance {typeof balanceMinor === 'number' ? formatMinor(balanceMinor) : '…'}
          {held > 0 ? ` · ${formatMinor(held)} held on card` : ''}
        </p>
      )}

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
                  </li>
                );
              })}
          </ul>
        )}
      </section>

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
        <input
          aria-label="cash-amount"
          value={cashAmount}
          onChange={(e) => setCashAmount(e.target.value)}
          disabled={!policy.canPay}
        />
        <button
          type="button"
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
        <button
          type="button"
          disabled={!policy.canSplit || split.isPending || !splitLineId}
          onClick={() => split.mutate()}
        >
          Split
        </button>
        <button
          type="button"
          disabled={!policy.canSplit || splitPayment.isPending || !splitLineId}
          onClick={() => splitPayment.mutate()}
        >
          Split payment
        </button>
        {!policy.canSplit && policy.reasons.split ? (
          <p className="muted">{policy.reasons.split}</p>
        ) : null}
      </section>

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
