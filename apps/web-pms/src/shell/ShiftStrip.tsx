import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionForForbidden } from '@hospai/client-core';
import { Button, Input, Skeleton, VisuallyHidden, Alert } from '@hospai/ui-kit';
import { useId, useState } from 'react';
import { canShowShellOpen, type Authority } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  isCurrentOrPreviousBusinessDate,
  parseAmountToMinor,
  parseMajorToMinor,
} from '../money.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { useBand } from './Band.js';
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
  const floatHintId = useId();
  const floatId = useId();
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

  const newest = recentQ.data?.shifts?.[0];
  const showForceCloseCallout =
    openQ.isSuccess &&
    newest?.status === 'FORCE_CLOSED' &&
    isCurrentOrPreviousBusinessDate(newest.businessDate, localToday);

  useBand(
    'shift-strip-message',
    message
      ? {
          intent: 'exception',
          message,
          testId: 'shift-strip-message',
          role: 'alert',
        }
      : null,
  );
  useBand(
    'force-close-callout',
    showForceCloseCallout && newest
      ? {
          intent: 'exception',
          message: `Drawer never counted for ${date(newest.businessDate)}.`,
          link: {
            to: `/shift/${encodeURIComponent(newest.shiftId)}`,
            label: 'View shift',
          },
          testId: 'force-close-callout',
        }
      : null,
  );

  if (openQ.isError) {
    return (
      <div className="shift-strip">
        <Alert>
          {classifiedUserMessage(asClassified(openQ.error), {
            fallback: 'Shift status unavailable.',
          })}
        </Alert>
      </div>
    );
  }

  if (openQ.isPending) {
    return (
      <div className="shift-strip">
        <Skeleton label="Loading shift" width="8rem" height="0.75rem" />
      </div>
    );
  }

  const body = openQ.data as
    | { ok?: boolean; shift?: {
        shiftId: string;
        businessDate: string;
        openingFloat: number;
        attributedCashCount: number;
        tenderTotals?: { cardMinor: number; upiMinor: number };
        status: 'OPEN';
      } | null }
    | undefined;

  if (!body || body.shift == null) {
    return (
      <div className="shift-strip">
        <span>No open shift</span>
        {showOpen ? (
          <form
            className="shift-open-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (floatMinor == null) return;
              openMut.mutate();
            }}
          >
            <VisuallyHidden>
              <label htmlFor={floatId}>Opening float</label>
            </VisuallyHidden>
            <Input
              id={floatId}
              aria-label="opening-float"
              placeholder="Opening float"
              value={floatMajor}
              onChange={(e) => setFloatMajor(e.target.value)}
            />
            {floatMinor == null ? (
              <VisuallyHidden>
                <span id={floatHintId}>Enter an opening float.</span>
              </VisuallyHidden>
            ) : null}
            <Button
              type="submit"
              intent="primary"
              disabled={openMut.isPending || floatMinor == null}
              aria-describedby={floatMinor == null ? floatHintId : undefined}
            >
              Open shift
            </Button>
          </form>
        ) : null}
      </div>
    );
  }

  const shift = body.shift;
  const badgeText = shift.tenderTotals
    ? `Shift open · float ${money(shift.openingFloat)} · ${shift.attributedCashCount} cash posts · Card ${money(shift.tenderTotals.cardMinor)} · UPI ${money(shift.tenderTotals.upiMinor)}`
    : `Shift open · float ${money(shift.openingFloat)} · ${shift.attributedCashCount} cash posts`;

  return (
    <div className="shift-strip">
      <span className="shift-strip__dot" aria-hidden="true" />
      <Link
        className="shift-strip__badge"
        data-testid="open-shift-badge"
        to="/shift"
        title={badgeText}
      >
        {badgeText}
      </Link>
      <Link className="shift-strip__close" to="/shift">
        Close shift
      </Link>
    </div>
  );
}
