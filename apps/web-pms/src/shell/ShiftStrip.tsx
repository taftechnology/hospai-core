import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionForForbidden } from '@hospai/client-core';
import { Button, Field, Input, Alert } from '@hospai/ui-kit';
import { useState } from 'react';
import { canShowShellOpen, type Authority } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  isCurrentOrPreviousBusinessDate,
  parseAmountToMinor,
  parseMajorToMinor,
} from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { statusClass } from '../status/status-class.js';
import { useFormat, usePropertyTimeZone } from './PropertyFormat.js';

/** Empty and non-numeric floats are invalid. Zero is a valid opening float. */
function openingFloatMinor(raw: string): number | null {
  return parseAmountToMinor(raw);
}

export function ShiftStrip({ authority }: { authority: Authority }) {
  const propertyId = tenant.propertyId;
  const showOpen = canShowShellOpen(authority);
  const queryClient = useQueryClient();
  const timeZone = usePropertyTimeZone();
  const { money, date } = useFormat();
  const localToday = timeZone ? propertyLocalToday(timeZone) : null;
  const [floatMajor, setFloatMajor] = useState('');
  const floatMinor = openingFloatMinor(floatMajor);
  const [message, setMessage] = useState<string | null>(null);
  /** §2.7 — mint once when the open form is prepared; remint only after success. */
  const [openShiftId, setOpenShiftId] = useState(() => `shift_${crypto.randomUUID()}`);

  const openQ = useQuery({
    queryKey: ['open-shift', propertyId],
    queryFn: () => api.getOpenShift(propertyId),
    retry: (count, err) => count < 1 && asClassified(err).class === 'read_stale',
  });

  const recentQ = useQuery({
    queryKey: ['recent-shifts', propertyId],
    queryFn: () => api.getRecentShifts(propertyId),
    retry: (count, err) => count < 1 && asClassified(err).class === 'read_stale',
  });

  const openMut = useMutation({
    mutationFn: () =>
      api.openShift(propertyId, {
        shiftId: openShiftId,
        openingFloat: parseMajorToMinor(floatMajor),
      }),
    onSuccess: async () => {
      setMessage(null);
      setOpenShiftId(`shift_${crypto.randomUUID()}`);
      await queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] });
    },
    onError: (err) => {
      const c = asClassified(err);
      if (c.class === 'shift_already_open') {
        setMessage('You already have an open shift');
        void queryClient.invalidateQueries({ queryKey: ['open-shift', propertyId] });
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
      setMessage(classifiedUserMessage(c, { fallback: 'Open shift failed' }));
    },
  });

  if (openQ.isError) {
    const c = asClassified(openQ.error);
    if (c.class === 'fail_closed') {
      return <div className="shift-strip error">Shift unavailable — property unreachable</div>;
    }
    return <div className="shift-strip muted">Shift status unavailable</div>;
  }

  if (openQ.isPending) {
    return <div className="shift-strip muted">Loading shift…</div>;
  }

  const body = openQ.data as
    | { ok?: boolean; shift?: {
        shiftId: string;
        businessDate: string;
        openingFloat: number;
        attributedCashCount: number;
        status: 'OPEN';
      } | null }
    | undefined;

  const newest = recentQ.data?.shifts?.[0];
  const showForceCloseCallout =
    newest?.status === 'FORCE_CLOSED' &&
    isCurrentOrPreviousBusinessDate(newest.businessDate, localToday);

  const callout = showForceCloseCallout ? (
    <div className={`shift-callout ${statusClass('exception')}`} data-testid="force-close-callout">
      Drawer never counted for {date(newest.businessDate)}.{' '}
      <Link to={`/shift/${encodeURIComponent(newest.shiftId)}`}>View shift</Link>
    </div>
  ) : null;

  if (!body || body.shift == null) {
    return (
      <div className="shift-strip">
        <span className={statusClass('neutral')}>No open shift</span>
        {showOpen ? (
          <form
            className="shift-open-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (floatMinor == null) return;
              openMut.mutate();
            }}
          >
            <Field
              label="Opening float"
              control={
                <Input
                  aria-label="opening-float"
                  value={floatMajor}
                  onChange={(e) => setFloatMajor(e.target.value)}
                />
              }
            />
            <Button type="submit" intent="primary" disabled={openMut.isPending || floatMinor == null}>
              Open shift
            </Button>
            {floatMinor == null ? <span className="muted">Enter an opening float.</span> : null}
          </form>
        ) : null}
        {message ? <Alert data-testid="shift-strip-message">{message}</Alert> : null}
        {callout}
      </div>
    );
  }

  const shift = body.shift;

  return (
    <div className="shift-strip">
      <span className="shift-strip__dot" aria-hidden="true" />
      <span data-testid="open-shift-badge">
        Shift open · float {money(shift.openingFloat)} · {shift.attributedCashCount} cash posts
      </span>
      <Link className="shift-strip__close" to="/shift">
        Close shift
      </Link>
      {message ? <Alert data-testid="shift-strip-message">{message}</Alert> : null}
      {callout}
    </div>
  );
}
