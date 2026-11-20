import { UPI_REFERENCE_RE } from '@hospai/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Input,
  NativeSelect,
  StatField,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { parseAmountToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';

export type AdvancePaymentsContext = 'book' | 'stay' | 'check-in' | 'folio';

export type AdvanceDraftRow = {
  rowKey: string;
  method: 'CASH' | 'UPI' | 'CARD';
  amountInput: string;
  upiReference: string;
  opId: string;
  status: 'draft' | 'pending' | 'ok' | 'error';
  errorMessage?: string;
};

export type AdvancePaymentsProps = {
  propertyId: string;
  reservationId: string | null;
  context: AdvancePaymentsContext;
  status?: 'pending' | 'confirmed' | 'checked_in' | string;
  quoteTotalMinor?: number | null;
  canPay?: boolean;
  payBlockedReason?: string;
  /** Folio Advanced cash-currency override. When unset, omit — ledger default. */
  payCurrency?: string;
  onAdvanceSuccess?: (sumMinor: number) => void;
  draftRows?: AdvanceDraftRow[];
  onDraftRowsChange?: (rows: AdvanceDraftRow[]) => void;
  postCommitMode?: boolean;
};

const ELIGIBLE = new Set(['pending', 'confirmed', 'checked_in']);
const ROW_CAP = 8;

function newRowKey(): string {
  return crypto.randomUUID();
}

function makeOpId(reservationId: string | null, rowKey: string): string {
  return `advance:${reservationId ?? ''}:${rowKey}:${crypto.randomUUID()}`;
}

/** D3: posted opIds must be `advance:{reservationId}:{rowKey}:{uuid}` with a real reservation id. */
export function ensureAdvanceOpIdForPost(
  row: AdvanceDraftRow,
  reservationId: string,
): AdvanceDraftRow {
  const parts = row.opId.split(':');
  const reservationSegment =
    parts[0] === 'advance' && parts.length >= 4 ? (parts[1] ?? '') : '';
  if (reservationSegment !== '') {
    return row;
  }
  return { ...row, opId: makeOpId(reservationId, row.rowKey) };
}

export function createAdvanceDraftRow(reservationId: string | null): AdvanceDraftRow {
  const rowKey = newRowKey();
  return {
    rowKey,
    method: 'CASH',
    amountInput: '',
    upiReference: '',
    opId: makeOpId(reservationId, rowKey),
    status: 'draft',
  };
}

function createDraftRow(reservationId: string | null): AdvanceDraftRow {
  return createAdvanceDraftRow(reservationId);
}

function rotateOpId(row: AdvanceDraftRow, reservationId: string | null): AdvanceDraftRow {
  return { ...row, opId: makeOpId(reservationId, row.rowKey) };
}

function isOkProforma(body: unknown): body is {
  ok: true;
  totals: {
    estimatedTotalMinor: number;
    advancePaidMinor: number;
    balanceMinor: number;
  };
} {
  if (!body || typeof body !== 'object') return false;
  const b = body as { ok?: unknown; totals?: unknown };
  if (b.ok !== true || !b.totals || typeof b.totals !== 'object') return false;
  const t = b.totals as Record<string, unknown>;
  return (
    typeof t.estimatedTotalMinor === 'number' &&
    typeof t.advancePaidMinor === 'number' &&
    typeof t.balanceMinor === 'number'
  );
}

function rowAmountMinor(row: AdvanceDraftRow): number | null {
  return parseAmountToMinor(row.amountInput);
}

function rowUpiValid(row: AdvanceDraftRow): boolean {
  if (row.method !== 'UPI') return true;
  return UPI_REFERENCE_RE.test(row.upiReference.trim());
}

function rowReady(row: AdvanceDraftRow): boolean {
  if (row.status === 'ok' || row.status === 'pending') return false;
  const amount = rowAmountMinor(row);
  if (amount == null || amount <= 0) return false;
  if (row.method === 'UPI' && !rowUpiValid(row)) return false;
  return true;
}

export function AdvancePayments(props: AdvancePaymentsProps) {
  const {
    propertyId,
    reservationId,
    context,
    status,
    quoteTotalMinor,
    canPay = true,
    payBlockedReason,
    payCurrency,
    onAdvanceSuccess,
    draftRows: controlledRows,
    onDraftRowsChange,
    postCommitMode = false,
  } = props;

  if (status != null && status !== '' && !ELIGIBLE.has(status)) {
    return null;
  }

  return (
    <AdvancePaymentsInner
      propertyId={propertyId}
      reservationId={reservationId}
      context={context}
      quoteTotalMinor={quoteTotalMinor}
      canPay={canPay}
      payBlockedReason={payBlockedReason}
      payCurrency={payCurrency}
      onAdvanceSuccess={onAdvanceSuccess}
      controlledRows={controlledRows}
      onDraftRowsChange={onDraftRowsChange}
      postCommitMode={postCommitMode}
    />
  );
}

function AdvancePaymentsInner(props: {
  propertyId: string;
  reservationId: string | null;
  context: AdvancePaymentsContext;
  quoteTotalMinor?: number | null;
  canPay: boolean;
  payBlockedReason?: string;
  payCurrency?: string;
  onAdvanceSuccess?: (sumMinor: number) => void;
  controlledRows?: AdvanceDraftRow[];
  onDraftRowsChange?: (rows: AdvanceDraftRow[]) => void;
  postCommitMode: boolean;
}) {
  const {
    propertyId,
    reservationId,
    context,
    quoteTotalMinor,
    canPay,
    payBlockedReason,
    payCurrency,
    onAdvanceSuccess,
    controlledRows,
    onDraftRowsChange,
    postCommitMode,
  } = props;
  const currencyFields = payCurrency ? { currency: payCurrency } : {};
  const { money } = useFormat();
  const queryClient = useQueryClient();
  const uid = useId();
  const [localRows, setLocalRows] = useState<AdvanceDraftRow[]>(() => [
    createDraftRow(reservationId),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [settledCashUpiMinor, setSettledCashUpiMinor] = useState<number | null>(null);
  const [settledCardMinor, setSettledCardMinor] = useState<number | null>(null);
  const offerCard = context !== 'folio';

  const controlled = controlledRows != null && onDraftRowsChange != null;
  const rows = controlled ? controlledRows! : localRows;

  const setRows = useCallback(
    (next: AdvanceDraftRow[] | ((prev: AdvanceDraftRow[]) => AdvanceDraftRow[])) => {
      if (controlled) {
        const resolved = typeof next === 'function' ? next(controlledRows!) : next;
        onDraftRowsChange!(resolved);
      } else {
        setLocalRows(next);
      }
    },
    [controlled, controlledRows, onDraftRowsChange],
  );

  const proformaQ = useQuery({
    queryKey: ['reservation-proforma', propertyId, reservationId],
    queryFn: () => api.getReservationProforma(propertyId, reservationId!),
    staleTime: 0,
    enabled: Boolean(reservationId),
    retry: false,
  });

  const proformaOk = isOkProforma(proformaQ.data) ? proformaQ.data : null;
  const panelError =
    Boolean(reservationId) &&
    (proformaQ.isError || (proformaQ.isSuccess && !proformaOk));

  const actionable = rows.filter((r) => r.status === 'draft' || r.status === 'error');
  const hasInvalidUpi = actionable.some(
    (r) =>
      r.method === 'UPI' &&
      r.upiReference.trim() !== '' &&
      !UPI_REFERENCE_RE.test(r.upiReference.trim()),
  );
  const readyRows = actionable.filter(rowReady);
  const firstReadyMethod = readyRows[0]?.method ?? actionable[0]?.method ?? 'CASH';
  const submitTestId =
    firstReadyMethod === 'UPI'
      ? 'record-upi'
      : firstReadyMethod === 'CARD'
        ? 'record-card'
        : 'record-cash';

  const canSubmit =
    canPay &&
    !submitting &&
    reservationId != null &&
    readyRows.length > 0 &&
    !hasInvalidUpi &&
    !postCommitMode;

  const failedRows = rows.filter((r) => r.status === 'error');
  const canRetry = canPay && !submitting && reservationId != null && failedRows.length > 0;

  async function postRows(targets: AdvanceDraftRow[]) {
    if (!reservationId || targets.length === 0) return;
    setSubmitting(true);
    setSettledCashUpiMinor(null);
    setSettledCardMinor(null);
    let cashUpiMinor = 0;
    let cardMinor = 0;
    const working = rows.map((r) => ({ ...r }));

    const updateWorking = (rowKey: string, patch: Partial<AdvanceDraftRow>) => {
      const idx = working.findIndex((r) => r.rowKey === rowKey);
      if (idx >= 0) working[idx] = { ...working[idx]!, ...patch };
      setRows([...working]);
    };

    for (const target of targets) {
      const amountMinor = rowAmountMinor(target);
      if (amountMinor == null || amountMinor <= 0) continue;
      if (target.method === 'UPI' && !rowUpiValid(target)) {
        updateWorking(target.rowKey, {
          status: 'error',
          errorMessage: classifiedUserMessage(
            {
              class: 'client_error',
              status: 422,
              body: { error: 'invalid_upi_reference' },
              retryAfterMs: null,
            },
            { fallback: 'UPI reference is not valid.' },
          ),
        });
        continue;
      }

      updateWorking(target.rowKey, { status: 'pending', errorMessage: undefined });
      const opId = target.opId;
      const paymentId = `pay_adv:${opId}`;

      try {
        if (target.method === 'CASH') {
          await api.recordCashPayment(
            propertyId,
            reservationId,
            { paymentId, amountMinor, ...currencyFields },
            opId,
          );
          cashUpiMinor += amountMinor;
        } else if (target.method === 'UPI') {
          await api.recordUpiPayment(
            propertyId,
            reservationId,
            {
              paymentId,
              amountMinor,
              reference: target.upiReference.trim(),
              ...currencyFields,
            },
            opId,
          );
          cashUpiMinor += amountMinor;
        } else {
          await api.authorizePayment(
            propertyId,
            reservationId,
            { paymentId, amountMinor, purpose: 'STAY', ...currencyFields },
            opId,
          );
          cardMinor += amountMinor;
        }
        const idx = working.findIndex((r) => r.rowKey === target.rowKey);
        if (idx >= 0) {
          working[idx] = rotateOpId(
            {
              ...working[idx]!,
              status: 'ok',
              errorMessage: undefined,
              amountInput: '',
              upiReference: '',
            },
            reservationId,
          );
          setRows([...working]);
        }
        void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
        void queryClient.invalidateQueries({
          queryKey: ['folio-payments', propertyId, reservationId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['reservation-proforma', propertyId, reservationId],
        });
        void queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] });
      } catch (err) {
        updateWorking(target.rowKey, {
          status: 'error',
          errorMessage: classifiedUserMessage(asClassified(err), {
            fallback: 'Advance payment failed.',
          }),
        });
      }
    }

    setSubmitting(false);
    const sumMinor = cashUpiMinor + cardMinor;
    if (sumMinor > 0) {
      setSettledCashUpiMinor(cashUpiMinor > 0 ? cashUpiMinor : null);
      setSettledCardMinor(cardMinor > 0 ? cardMinor : null);
      onAdvanceSuccess?.(sumMinor);
      if (!postCommitMode) {
        let remaining = working.filter((r) => r.status !== 'ok');
        if (remaining.length === 0) {
          remaining = [createDraftRow(reservationId)];
        }
        setRows(remaining);
      }
    }
  }

  function updateRow(rowKey: string, patch: Partial<AdvanceDraftRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const next = { ...r, ...patch };
        if (patch.method != null && patch.method !== 'UPI') {
          next.upiReference = '';
        }
        if (
          r.status === 'error' &&
          (patch.amountInput != null || patch.method != null || patch.upiReference != null)
        ) {
          next.status = 'draft';
          next.errorMessage = undefined;
        }
        return next;
      }),
    );
  }

  const settledVisible = settledCashUpiMinor != null || settledCardMinor != null;

  return (
    <div className="ui-stack" data-testid="advance-payments" data-uid={uid}>
      {reservationId == null ? (
        <div data-testid="advance-panel-quote">
          {typeof quoteTotalMinor === 'number' ? (
            <StatField label="Estimated total" value={money(quoteTotalMinor)} />
          ) : null}
        </div>
      ) : panelError ? (
        <Alert intent="exception" data-testid="advance-panel-error">
          {proformaQ.isError
            ? classifiedUserMessage(asClassified(proformaQ.error), {
                fallback: 'Could not load advance totals.',
              })
            : 'Could not load advance totals.'}
        </Alert>
      ) : proformaOk ? (
        <div className="ui-row" data-testid="advance-panel">
          <span data-testid="advance-panel-estimated">
            <StatField
              label="Estimated bill"
              value={money(proformaOk.totals.estimatedTotalMinor)}
            />
          </span>
          <span data-testid="advance-panel-advance">
            <StatField
              label="Advance paid"
              value={money(proformaOk.totals.advancePaidMinor)}
            />
          </span>
          <span data-testid="advance-panel-balance">
            <StatField label="Balance" value={money(proformaOk.totals.balanceMinor)} />
          </span>
        </div>
      ) : (
        <p className="muted" data-testid="advance-panel-loading">
          Loading advance totals…
        </p>
      )}

      {reservationId == null ? (
        <p className="muted" data-testid="advance-book-hint">
          Payments are recorded after Hold or Confirm.
        </p>
      ) : null}

      {!canPay && payBlockedReason ? (
        <Alert intent="attention" data-testid="advance-pay-blocked">
          {payBlockedReason}
        </Alert>
      ) : null}

      {settledVisible ? (
        <Alert intent="settled" data-testid="advance-settled">
          {[
            settledCashUpiMinor != null
              ? `Advance of ${money(settledCashUpiMinor)} recorded.`
              : null,
            settledCardMinor != null
              ? `Card hold of ${money(settledCardMinor)} authorized.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </Alert>
      ) : null}

      {rows.map((row, index) => {
        const showUpiInvalid =
          row.method === 'UPI' &&
          row.upiReference.trim() !== '' &&
          !UPI_REFERENCE_RE.test(row.upiReference.trim());
        const rowDisabled =
          !canPay || row.status === 'pending' || row.status === 'ok' || submitting;
        const tenderTestId = index === 0 ? 'payment-tender' : `payment-tender-${index}`;
        const upiTestId = index === 0 ? 'upi-reference' : `upi-reference-${index}`;
        const paymentSuffix =
          index > 0 ? <VisuallyHidden>{`, payment ${index + 1}`}</VisuallyHidden> : null;
        return (
          <div
            key={row.rowKey}
            className="ui-stack"
            data-testid={`advance-row-${index}`}
            data-op-id={row.opId}
            data-status={row.status}
          >
            <div className="ui-row">
              <Field
                size="xs"
                label={<>Method{paymentSuffix}</>}
                control={
                  <NativeSelect
                    data-testid={tenderTestId}
                    value={row.method === 'CARD' && !offerCard ? 'CASH' : row.method}
                    disabled={rowDisabled || postCommitMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      const method =
                        v === 'UPI' ? 'UPI' : v === 'CARD' && offerCard ? 'CARD' : 'CASH';
                      updateRow(row.rowKey, { method });
                    }}
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    {offerCard ? <option value="CARD">Card</option> : null}
                  </NativeSelect>
                }
              />
              <Field
                size="xs"
                label={<>Amount{paymentSuffix}</>}
                control={
                  <Input
                    value={row.amountInput}
                    onChange={(e) => updateRow(row.rowKey, { amountInput: e.target.value })}
                    disabled={rowDisabled || postCommitMode}
                  />
                }
              />
              {row.method === 'UPI' ? (
                <Field
                  size="sm"
                  label={<>UPI reference{paymentSuffix}</>}
                  control={
                    <Input
                      data-testid={upiTestId}
                      value={row.upiReference}
                      onChange={(e) => updateRow(row.rowKey, { upiReference: e.target.value })}
                      disabled={rowDisabled || postCommitMode}
                    />
                  }
                />
              ) : null}
              {!postCommitMode && rows.length > 1 && row.status !== 'ok' ? (
                <Button
                  type="button"
                  intent="ghost"
                  data-testid={`advance-remove-row-${index}`}
                  disabled={submitting || row.status === 'pending'}
                  onClick={() => setRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {showUpiInvalid ? (
              <Alert
                intent="exception"
                data-testid={
                  index === 0 ? 'upi-reference-invalid' : `upi-reference-invalid-${index}`
                }
              >
                {classifiedUserMessage(
                  {
                    class: 'client_error',
                    status: 422,
                    body: { error: 'invalid_upi_reference' },
                    retryAfterMs: null,
                  },
                  { fallback: 'UPI reference is not valid.' },
                )}
              </Alert>
            ) : null}
            {row.status === 'error' && row.errorMessage ? (
              <Alert intent="exception" data-testid={`advance-row-error-${index}`}>
                {row.errorMessage}
              </Alert>
            ) : null}
            {row.status === 'ok' && postCommitMode ? (
              <Alert intent="settled" data-testid={`advance-row-ok-${index}`}>
                Recorded.
              </Alert>
            ) : null}
          </div>
        );
      })}

      <div className="ui-row">
        {!postCommitMode ? (
          <Button
            type="button"
            intent="ghost"
            data-testid="advance-add-row"
            disabled={!canPay || submitting || rows.length >= ROW_CAP}
            onClick={() => {
              if (rows.length >= ROW_CAP) return;
              setRows((prev) => [...prev, createDraftRow(reservationId)]);
            }}
          >
            Add row
          </Button>
        ) : null}
        {!postCommitMode && reservationId != null ? (
          <Button
            type="button"
            data-testid={submitTestId}
            disabled={!canSubmit}
            onClick={() => {
              void postRows(readyRows);
            }}
          >
            Record advance
          </Button>
        ) : null}
        {canRetry || (postCommitMode && failedRows.length > 0) ? (
          <Button
            type="button"
            data-testid="advance-retry"
            disabled={!canPay || submitting || failedRows.length === 0}
            onClick={() => {
              void postRows(failedRows.filter(rowReady));
            }}
          >
            Retry failed
          </Button>
        ) : null}
      </div>
    </div>
  );
}
