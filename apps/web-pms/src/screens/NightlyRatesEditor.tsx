import type { AlertIntent } from '@hospai/ui-kit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
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
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { parseAmountToMinor } from '../money.js';
import { minorToMajor } from './settings-tax-format.js';
import { useFormat } from '../shell/PropertyFormat.js';

export type NightlyRateRow = {
  stayDate: string;
  amountMinor: number | null;
  ratePlanId: string | null;
  isOverride: boolean;
  posted: boolean;
};

export type NightlyRateDraft = {
  dirty: boolean;
  reason: string;
  nights: Array<{ stayDate: string; amountMinor: number }>;
  totalMinor: number | null;
};

type Props = {
  propertyId: string;
  /** Persisted stay. The editor loads and saves this reservation. */
  reservationId?: string;
  /** Booking preview. Parent owns the quote; there is no Save. */
  preview?: { currency: string; nights: NightlyRateRow[] };
  canOverride?: boolean;
  collapsedDefault?: boolean;
  onDraftChange?: (draft: NightlyRateDraft) => void;
};

/** Plan name from the screen's rate-plans query. Unknown names stay the id. */
export function ratePlanDisplayName(
  ratePlanId: string | null,
  plans: ReadonlyArray<{ ratePlanId: string; name?: string | null }>,
): string {
  if (!ratePlanId) return '—';
  const name = plans.find((plan) => plan.ratePlanId === ratePlanId)?.name?.trim();
  return name || ratePlanId;
}

const EMPTY_NIGHTS: NightlyRateRow[] = [];

function rateOverrideOpId(
  reservationId: string,
  nights: Array<{ stayDate: string; amountMinor: number }>,
  reason: string,
): string {
  const sorted = [...nights].sort((a, b) => (a.stayDate < b.stayDate ? -1 : a.stayDate > b.stayDate ? 1 : 0));
  return `rate-override:${reservationId}:${reason}:${sorted.map((n) => `${n.stayDate}=${n.amountMinor}`).join(',')}`;
}

export function NightlyRatesEditor({
  propertyId,
  reservationId,
  preview,
  canOverride,
  collapsedDefault = false,
  onDraftChange,
}: Props) {
  const queryClient = useQueryClient();
  const { date, money, fmt } = useFormat();
  const [open, setOpen] = useState(!collapsedDefault);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<{ intent: AlertIntent; text: string } | null>(null);

  const persisted = reservationId != null && preview == null;
  const nightsQ = useQuery({
    queryKey: ['reservation-rate-nights', propertyId, reservationId],
    queryFn: () => api.getReservationRateNights(propertyId, reservationId!),
    enabled: persisted,
  });
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    enabled: canOverride === undefined,
  });
  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    retry: false,
  });
  const allowed =
    canOverride ?? Boolean(meQ.data && hasPropertyPermission(meQ.data, 'rates:override'));

  const responseCurrency = (preview != null ? preview.currency : (nightsQ.data?.currency ?? '')).trim();
  const headerCurrency = responseCurrency || fmt.currency || '';
  const amountHeader = headerCurrency ? `Amount (${headerCurrency})` : 'Amount';
  const plans = (plansQ.data?.plans ?? []) as Array<{ ratePlanId: string; name?: string | null }>;
  const nights = preview?.nights ?? nightsQ.data?.nights ?? EMPTY_NIGHTS;
  const nightsKey = nights
    .map((night) => `${night.stayDate}:${night.amountMinor ?? ''}:${night.posted ? 1 : 0}`)
    .join('|');
  const nightsRef = useRef(nights);
  nightsRef.current = nights;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const night of nightsRef.current) {
      next[night.stayDate] = night.amountMinor == null ? '' : minorToMajor(night.amountMinor, 2);
    }
    setDrafts(next);
    setReason('');
  }, [nightsKey]);

  const draft = useMemo((): NightlyRateDraft => {
    const changed: Array<{ stayDate: string; amountMinor: number }> = [];
    let total = 0;
    let complete = true;
    for (const night of nights) {
      if (night.posted) {
        total += night.amountMinor ?? 0;
        continue;
      }
      const raw = drafts[night.stayDate] ?? '';
      const minor = raw.trim() === '' ? null : parseAmountToMinor(raw);
      if (minor == null) {
        complete = false;
        continue;
      }
      total += minor;
      if (night.amountMinor == null || minor !== night.amountMinor) {
        changed.push({ stayDate: night.stayDate, amountMinor: minor });
      }
    }
    changed.sort((a, b) => (a.stayDate < b.stayDate ? -1 : a.stayDate > b.stayDate ? 1 : 0));
    return {
      dirty: changed.length > 0,
      reason: reason.trim(),
      nights: changed,
      totalMinor: complete ? total : null,
    };
  }, [nights, drafts, reason]);

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current?.(draft);
  }, [draft]);

  const save = useMutation({
    mutationFn: () => {
      if (!reservationId) throw new Error('no reservation');
      return api.overrideReservationNightRates(
        propertyId,
        reservationId,
        rateOverrideOpId(reservationId, draft.nights, draft.reason),
        { nights: draft.nights, reason: draft.reason },
      );
    },
    onSuccess: () => {
      if (!reservationId) return;
      void queryClient.invalidateQueries({
        queryKey: ['reservation-rate-nights', propertyId, reservationId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
      setAlert({ intent: 'settled', text: 'Nightly rates saved.' });
    },
    onError: (err) => {
      setAlert({
        intent: 'exception',
        text: classifiedUserMessage(asClassified(err), { fallback: 'Could not save nightly rates' }),
      });
    },
  });

  const reasonMissing = draft.dirty && draft.reason.length === 0;

  return (
    <div className="ui-stack" data-testid="nightly-rates">
      {collapsedDefault ? (
        <Button type="button" data-testid="nightly-rates-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide nightly rates' : 'Show nightly rates'}
        </Button>
      ) : null}
      {open ? (
        <>
          {persisted && nightsQ.isError ? (
            <Alert>
              {classifiedUserMessage(asClassified(nightsQ.error), {
                fallback: 'Could not load nightly rates.',
              })}
            </Alert>
          ) : null}
          <DataTable data-testid="nightly-rates-table">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>{amountHeader}</DataTableHeaderCell>
                <DataTableHeaderCell>Plan</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {nights.map((night) => {
                const editable = allowed && !night.posted;
                const formatted =
                  night.amountMinor == null
                    ? '—'
                    : money(night.amountMinor, responseCurrency || undefined);
                return (
                  <DataTableRow key={night.stayDate}>
                    <DataTableCell>{date(night.stayDate)}</DataTableCell>
                    <DataTableCell>
                      {editable ? (
                        <Field
                          label={<VisuallyHidden>{`Amount ${night.stayDate}`}</VisuallyHidden>}
                          control={
                            <Input
                              data-testid={`night-amount-${night.stayDate}`}
                              value={drafts[night.stayDate] ?? ''}
                              onChange={(e) =>
                                setDrafts((prev) => ({ ...prev, [night.stayDate]: e.target.value }))
                              }
                            />
                          }
                        />
                      ) : (
                        formatted
                      )}
                    </DataTableCell>
                    <DataTableCell>{ratePlanDisplayName(night.ratePlanId, plans)}</DataTableCell>
                    <DataTableCell>
                      {night.posted ? <Badge rung="settled">Posted</Badge> : null}{' '}
                      {night.isOverride ? <Badge rung="attention">Overridden</Badge> : null}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTableBody>
          </DataTable>
          {allowed && persisted ? (
            <>
              <Field
                label="Reason"
                control={
                  <Input
                    data-testid="nightly-rate-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                }
              />
              <Button
                type="button"
                intent="primary"
                data-testid="nightly-rates-save"
                disabled={save.isPending || !draft.dirty || reasonMissing || draft.totalMinor == null}
                onClick={() => save.mutate()}
              >
                Save
              </Button>
            </>
          ) : null}
          {allowed && preview ? (
            <Field
              label="Reason"
              control={
                <Input
                  data-testid="nightly-rate-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              }
            />
          ) : null}
          {alert ? <Alert intent={alert.intent}>{alert.text}</Alert> : null}
        </>
      ) : null}
    </div>
  );
}

export { rateOverrideOpId };
