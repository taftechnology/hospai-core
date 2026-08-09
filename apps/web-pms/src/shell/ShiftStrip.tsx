import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionForForbidden } from '@hospai/client-core';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import {
  formatMinor,
  isCurrentOrPreviousBusinessDate,
  parseMajorToMinor,
} from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { shiftSeverity } from '../status/shift-severity.js';
import { statusClass } from '../status/status-class.js';
import { usePropertyTimeZone } from './PropertyTimeZone.js';

export function ShiftStrip() {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const timeZone = usePropertyTimeZone();
  const localToday = timeZone ? propertyLocalToday(timeZone) : null;
  const [floatMajor, setFloatMajor] = useState('100.00');
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
      setMessage(`Open shift failed (${c.class})`);
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
      Drawer never counted for {newest.businessDate}.{' '}
      <Link to={`/shift/${encodeURIComponent(newest.shiftId)}`}>View shift</Link>
    </div>
  ) : null;

  if (!body || body.shift == null) {
    return (
      <div className="shift-strip">
        <span className={statusClass('neutral')}>No open shift</span>
        <form
          className="shift-open-form"
          onSubmit={(e) => {
            e.preventDefault();
            openMut.mutate();
          }}
        >
          <label>
            Opening float
            <input
              aria-label="opening-float"
              value={floatMajor}
              onChange={(e) => setFloatMajor(e.target.value)}
            />
          </label>
          <button type="submit" disabled={openMut.isPending}>
            Open shift
          </button>
        </form>
        {message ? <p className="muted">{message}</p> : null}
        {callout}
      </div>
    );
  }

  const shift = body.shift;
  const sev = shiftSeverity({
    kind: 'open',
    businessDate: shift.businessDate,
    propertyLocalToday: localToday,
  });

  return (
    <div className="shift-strip">
      <span className={statusClass(sev)} data-testid="open-shift-badge">
        Open shift <strong>{shift.shiftId}</strong> · float {formatMinor(shift.openingFloat)} · cash
        posts {shift.attributedCashCount}
      </span>
      <Link to="/shift">Close</Link>
      {message ? <p className="muted">{message}</p> : null}
      {callout}
    </div>
  );
}
