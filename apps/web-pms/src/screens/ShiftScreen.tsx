import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionForForbidden } from '@hospai/client-core';
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { formatMinor, formatVarianceMinor, parseMajorToMinor } from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { shiftSeverity } from '../status/shift-severity.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';

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

export function ShiftScreen() {
  const { shiftId: routeShiftId } = useParams();
  if (routeShiftId) {
    return <ShiftReceipt shiftId={routeShiftId} />;
  }
  return <ShiftCloseForm />;
}

function ShiftCloseForm() {
  const propertyId = tenant.propertyId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [closingMajor, setClosingMajor] = useState('0.00');
  const [message, setMessage] = useState<string | null>(null);

  const openQ = useQuery({
    queryKey: ['open-shift', propertyId],
    queryFn: () => api.getOpenShift(propertyId),
  });

  const closeMut = useMutation({
    mutationFn: async (shiftId: string) => {
      return api.closeShift(propertyId, shiftId, {
        closingCount: parseMajorToMinor(closingMajor),
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
    return <p className="muted">Loading shift…</p>;
  }

  if (openQ.isError) {
    const c = asClassified(openQ.error);
    if (c.class === 'fail_closed') {
      return <Alert>Shift unavailable — property unreachable</Alert>;
    }
    return <p className="muted">Shift status unavailable</p>;
  }

  const open = openQ.data as
    | {
        ok?: boolean;
        shift?: { shiftId: string; businessDate?: string; openingFloat?: number } | null;
      }
    | undefined;
  if (!open?.shift) {
    return (
      <>
        <PageHeader title="Close shift" />
        <Card className="stack">
        <p className="muted">
          No open shift. Open one from the strip above, or review a recent shift from the force-close
          callout when shown.
        </p>
        <Link to="/arrivals">Back to board</Link>
      </Card>
      </>
    );
  }

  const shiftId = open.shift.shiftId;
  const { businessDate, openingFloat } = open.shift;

  return (
    <>
      <PageHeader title="Close shift" />
      <Card className="stack">
      <p>
        {businessDate ? (
          <>
            Business date <strong>{businessDate}</strong>
            {openingFloat != null ? (
              <>
                {' '}
                · opening float <strong>{formatMinor(openingFloat)}</strong>
              </>
            ) : null}
            {' '}
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
          label="Closing count"
          control={
            <Input
              aria-label="closing-count"
              value={closingMajor}
              onChange={(e) => setClosingMajor(e.target.value)}
            />
          }
        />
        <Button type="submit" disabled={closeMut.isPending}>
          Close shift
        </Button>
      </form>
      {message ? <p className="muted">{message}</p> : null}
    </Card>
    </>
  );
}

function ShiftReceipt({ shiftId }: { shiftId: string }) {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const localToday = timeZone ? propertyLocalToday(timeZone) : null;

  const q = useQuery({
    queryKey: ['shift', propertyId, shiftId],
    queryFn: () => api.getShiftById(propertyId, shiftId) as Promise<ShiftBody>,
  });

  if (q.isPending) return <p className="muted">Loading receipt…</p>;
  if (q.isError) {
    const c = asClassified(q.error);
    return (
      <Alert>{classifiedUserMessage(c, { fallback: 'Could not load shift' })}</Alert>
    );
  }

  const shift = q.data?.shift;
  if (!shift) return <p className="muted">Shift not found</p>;

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

  const varianceCopy =
    shift.status === 'FORCE_CLOSED'
      ? 'never counted'
      : shift.variance == null
        ? '—'
        : formatVarianceMinor(shift.variance);

  return (
    <>
      <PageHeader title="Shift receipt" />
      <Card className="stack" data-testid="shift-receipt">
      <Badge rung={sev} data-testid="receipt-status">
        {shift.status}
      </Badge>
      <dl>
        <div>
          <dt>Business date</dt>
          <dd>{shift.businessDate}</dd>
        </div>
        <div>
          <dt>Opening float</dt>
          <dd>{formatMinor(shift.openingFloat)}</dd>
        </div>
        <div>
          <dt>Closing count</dt>
          <dd>{shift.closingCount == null ? '—' : formatMinor(shift.closingCount)}</dd>
        </div>
        <div>
          <dt>Variance</dt>
          <dd data-testid="receipt-variance">{varianceCopy}</dd>
        </div>
        <div>
          <dt>Unattributed cash posts</dt>
          <dd data-testid="receipt-unattributed">{shift.unattributedCashCount}</dd>
        </div>
      </dl>
      {shift.status === 'FORCE_CLOSED' ? (
        <Badge rung="exception">Drawer never counted.</Badge>
      ) : null}
      <Link to="/arrivals">Back to board</Link>
    </Card>
    </>
  );
}
