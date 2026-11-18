import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionForForbidden } from '@hospai/client-core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  StatField,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { formatVarianceMinor, parseAmountToMinor } from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { shiftSeverity } from '../status/shift-severity.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';

type ShiftBody = {
  ok: true;
  shift: {
    shiftId: string;
    businessDate: string;
    openingFloat: number;
    closingCount: number | null;
    variance: number | null;
    status: 'OPEN' | 'CLOSED' | 'FORCE_CLOSED';
    unattributedCashCount: number;
  };
};

const SHIFT_STATUS_WORD: Record<ShiftBody['shift']['status'], string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  FORCE_CLOSED: 'Force closed',
};

export function ShiftScreen() {
  const { shiftId: routeShiftId } = useParams();
  if (routeShiftId) {
    return <ShiftReceipt shiftId={routeShiftId} />;
  }
  return <ShiftCloseForm />;
}

function ShiftCloseForm() {
  const propertyId = tenant.propertyId;
  const { money, date, fmt } = useFormat();
  const ledgerCode = fmt.currency;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [closingMajor, setClosingMajor] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const openQ = useQuery({
    queryKey: ['open-shift', propertyId],
    queryFn: () => api.getOpenShift(propertyId),
  });

  const closingMinor = parseAmountToMinor(closingMajor);

  const closeMut = useMutation({
    mutationFn: async (shiftId: string) => {
      const closingCount = parseAmountToMinor(closingMajor);
      if (closingCount == null) return Promise.reject(new Error('invalid_amount'));
      return api.closeShift(propertyId, shiftId, {
        closingCount,
      });
    },
    onSuccess: async (_data, shiftId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] }),
        queryClient.invalidateQueries({ queryKey: ['recent-shifts', propertyId] }),
      ]);
      void navigate(`/shift/${encodeURIComponent(shiftId)}`);
    },
    onError: async (err, shiftId) => {
      const c = asClassified(err);
      if (c.class === 'shift_not_open') {
        setMessage(
          'Your shift was force-closed by the night audit. This count was not recorded.',
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] }),
          queryClient.invalidateQueries({ queryKey: ['recent-shifts', propertyId] }),
        ]);
        void navigate(`/shift/${encodeURIComponent(shiftId)}`);
        return;
      }
      if (c.class === 'forbidden') {
        const perm = permissionForForbidden(c.body);
        setMessage(
          perm
            ? `Requires permission ${perm}. Ask a manager.`
            : 'Forbidden — insufficient permission.',
        );
        return;
      }
      setMessage(classifiedUserMessage(c, { fallback: 'Close shift failed' }));
    },
  });

  if (openQ.isPending) {
    return <Skeleton label="Loading shift" />;
  }

  if (openQ.isError) {
    const c = asClassified(openQ.error);
    if (c.class === 'fail_closed') {
      return <Alert>Shift unavailable — property unreachable</Alert>;
    }
    return <Alert>{classifiedUserMessage(c, { fallback: 'Shift status unavailable' })}</Alert>;
  }

  const open = openQ.data as
    | {
        ok?: boolean;
        shift?: { shiftId: string; businessDate?: string; openingFloat?: number } | null;
      }
    | undefined;
  if (!open?.shift) {
    return (
      <div className="ui-page-stack">
        <PageHeader title="Close shift" />
        <Card>
          <CardContent>
            <p className="muted">
              No open shift. Open one from the strip above, or review a recent shift from the force-close
              callout when shown.
            </p>
            <Link className="ui-link-btn" to="/arrivals">
              Back to board
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const shiftId = open.shift.shiftId;
  const { businessDate, openingFloat } = open.shift;

  return (
    <div className="ui-page-stack">
      <PageHeader title="Close shift" />
      <Card>
        <CardContent>
          <p>
            {businessDate ? (
              <>
                Business date <strong>{date(businessDate)}</strong>
                {openingFloat != null ? (
                  <>
                    {' '}
                    · opening float <strong>{money(openingFloat)}</strong>
                  </>
                ) : null}{' '}
                — enter closing count (blind; expected cash is not shown).
              </>
            ) : (
              <>Enter closing count (blind; expected cash is not shown).</>
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              closeMut.mutate(shiftId);
            }}
          >
            <Field
              label={ledgerCode ? `Closing count (${ledgerCode})` : 'Closing count'}
              hint={
                ledgerCode
                  ? `Count foreign-currency cash at its ${ledgerCode} value as posted on the folio.`
                  : 'Count foreign-currency cash at its ledger-currency value as posted on the folio.'
              }
              control={
                <Input
                  aria-label="closing-count"
                  value={closingMajor}
                  onChange={(e) => setClosingMajor(e.target.value)}
                />
              }
            />
            <Button type="submit" disabled={closeMut.isPending || closingMinor == null}>
              Close shift
            </Button>
          </form>
          {message ? <Alert>{message}</Alert> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ShiftReceipt({ shiftId }: { shiftId: string }) {
  const propertyId = tenant.propertyId;
  const { money, date, fmt } = useFormat();
  const timeZone = usePropertyTimeZone();
  const localToday = timeZone ? propertyLocalToday(timeZone) : null;

  const q = useQuery({
    queryKey: ['shift', propertyId, shiftId],
    queryFn: () => api.getShiftById(propertyId, shiftId) as Promise<ShiftBody>,
  });

  if (q.isPending) return <Skeleton label="Loading receipt" lines={3} />;
  if (q.isError) {
    const c = asClassified(q.error);
    return (
      <Alert>{classifiedUserMessage(c, { fallback: 'Could not load shift' })}</Alert>
    );
  }

  const shift = q.data?.shift;
  if (!shift) {
    return (
      <div className="ui-page-stack">
        <PageHeader title="Shift receipt" />
        <EmptyState
          kind="empty"
          title="Shift not found."
          action={
            <Link className="ui-link-btn" to="/arrivals">
              Back to board
            </Link>
          }
        />
      </div>
    );
  }

  const sev =
    shift.status === 'OPEN'
      ? shiftSeverity({
          kind: 'open',
          businessDate: shift.businessDate,
          propertyLocalToday: localToday,
        })
      : shiftSeverity({
          kind: 'closed',
          status: shift.status,
          variance: shift.variance,
        });

  // Expected cash is blind until the count is in; after a counted close it is count + variance.
  const expectedCash =
    shift.status === 'CLOSED' && shift.closingCount != null && shift.variance != null
      ? shift.closingCount + shift.variance
      : null;
  const unattributed = shift.unattributedCashCount;

  const varianceCopy =
    shift.status === 'FORCE_CLOSED'
      ? 'never counted'
      : shift.variance == null
        ? '—'
        : formatVarianceMinor(shift.variance, fmt);

  return (
    <div className="ui-page-stack">
      <PageHeader title="Shift receipt" />
      <Card data-testid="shift-receipt">
        <CardHeader>
          <CardTitle>Shift</CardTitle>
          <Badge rung={sev} data-testid="receipt-status">
            {SHIFT_STATUS_WORD[shift.status]}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="ui-stat-grid">
            <StatField label="Business date" value={date(shift.businessDate)} />
            <StatField label="Opening float" value={money(shift.openingFloat)} />
            <StatField
              label="Closing count"
              value={shift.closingCount == null ? '—' : money(shift.closingCount)}
            />
            {expectedCash != null ? (
              <StatField
                label="Expected cash"
                value={<span data-testid="receipt-expected">{money(expectedCash)}</span>}
              />
            ) : null}
            <StatField
              label="Variance"
              value={<span data-testid="receipt-variance">{varianceCopy}</span>}
            />
            <StatField
              label="Cash with no shift"
              value={<span data-testid="receipt-unattributed">{unattributed}</span>}
            />
          </div>
          {unattributed > 0 ? (
            <Alert intent="attention" data-testid="receipt-unattributed-alert">
              {unattributed === 1
                ? `1 cash payment on ${date(shift.businessDate)} was taken with no shift open.`
                : `${unattributed} cash payments on ${date(shift.businessDate)} were taken with no shift open.`}{' '}
              {unattributed === 1 ? 'It is' : 'They are'} not in any drawer's expected cash.
            </Alert>
          ) : null}
          {shift.status === 'FORCE_CLOSED' ? <Alert>Drawer never counted.</Alert> : null}
        </CardContent>
        <CardFooter>
          <Link className="ui-link-btn" to="/arrivals">
            Back to board
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
