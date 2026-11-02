import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useMemo } from 'react';
import { addCalendarDays, ClassifiedError } from '@hospai/client-core';
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  StatField,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { ArrowUpRightIcon, CheckIcon, NightAuditIcon, PlusIcon, RoomPlanIcon } from '../shell/icons.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { BoardSummary } from './board-summary.js';
import { GuestNameLink } from './guest-row.js';

function errorCopy(err: unknown, fallback: string): string {
  return err instanceof ClassifiedError
    ? classifiedUserMessage(err.classified, { fallback })
    : fallback;
}

/**
 * Dashboard Hub (roadmap R1.1). Composes existing reads only: the front-desk
 * summary, tonight's available rooms and today's arrivals. No trend chart and
 * no occupancy calculation of its own (ARCHITECTURE §7.1, §7.8).
 */
export function DashboardScreen() {
  const timeZone = usePropertyTimeZone();
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const tomorrow = today ? addCalendarDays(today, 1) : null;
  const { subtitle } = usePropertySubtitle('Today at a glance');

  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const me = meQ.data as PropertyMe | undefined;
  const canRunAudit = Boolean(me && hasPropertyPermission(me, 'night_audit:run'));
  const canReadDesk = Boolean(me && hasPropertyPermission(me, 'reservations:read'));
  const canBook = Boolean(me && hasPropertyPermission(me, 'reservations:write'));

  const availableQ = useQuery({
    queryKey: ['front-desk-available', tenant.propertyId, today, tomorrow],
    queryFn: () =>
      api.getAvailableRooms(tenant.propertyId, { fromDate: today!, toDate: tomorrow! }),
    enabled: today != null && tomorrow != null,
    retry: false,
  });

  const arrivalsQ = useQuery({
    queryKey: ['board', 'arrivals', tenant.propertyId, today, null],
    queryFn: () => api.getArrivals(tenant.propertyId, today!, null),
    enabled: today != null,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const vipArrivals = useMemo(
    () => (arrivalsQ.data?.items ?? []).filter((row) => row.vipFlag === true),
    [arrivalsQ.data],
  );
  const vipRefs = useMemo(
    () => [...new Set(vipArrivals.map((row) => row.guestRef))],
    [vipArrivals],
  );

  const batchQ = useQuery({
    queryKey: ['guests-batch', tenant.propertyId, vipRefs.join('|')],
    queryFn: () => fetchGuestStatesChunked(api.postGuestsBatch, tenant.propertyId, vipRefs),
    enabled: vipRefs.length > 0,
    retry: false,
  });
  const states = batchQ.data?.states ?? {};

  const availableHref =
    today && tomorrow
      ? `/board?${new URLSearchParams({ from: today, to: tomorrow, view: 'available' }).toString()}`
      : '/board?view=available';

  return (
    <div className="dashboard-page">
      <PageHeader title="Dashboard" subtitle={subtitle} />

      {canBook || canReadDesk || canRunAudit ? (
        <div className="ui-quick-actions">
          {canBook ? (
            <Link className="ui-quick-action" to="/book">
              <span className="ui-quick-action__icon">
                <PlusIcon />
              </span>
              <span className="ui-quick-action__arrow">
                <ArrowUpRightIcon />
              </span>
              <span className="ui-quick-action__label">New booking</span>
            </Link>
          ) : null}
          {canReadDesk ? (
            <Link className="ui-quick-action" to="/arrivals">
              <span className="ui-quick-action__icon">
                <CheckIcon />
              </span>
              <span className="ui-quick-action__arrow">
                <ArrowUpRightIcon />
              </span>
              <span className="ui-quick-action__label">Arrivals</span>
            </Link>
          ) : null}
          {canReadDesk ? (
            <Link className="ui-quick-action" to="/board">
              <span className="ui-quick-action__icon">
                <RoomPlanIcon />
              </span>
              <span className="ui-quick-action__arrow">
                <ArrowUpRightIcon />
              </span>
              <span className="ui-quick-action__label">Room plan</span>
            </Link>
          ) : null}
          {canRunAudit ? (
            <Link className="ui-quick-action" to="/night-audit">
              <span className="ui-quick-action__icon">
                <NightAuditIcon />
              </span>
              <span className="ui-quick-action__arrow">
                <ArrowUpRightIcon />
              </span>
              <span className="ui-quick-action__label">Night audit</span>
            </Link>
          ) : null}
        </div>
      ) : null}

      <BoardSummary date={today} />

      <div className="dashboard__grid">
        <Card>
          <CardHeader eyebrow="Front office / Today">
            <CardTitle>Rooms available tonight</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-stack">
              {availableQ.isError ? (
                <Alert data-testid="dashboard-available-error">
                  {errorCopy(availableQ.error, 'Could not load available rooms.')}
                </Alert>
              ) : availableQ.isSuccess ? (
                <StatField
                  data-testid="dashboard-available-rooms"
                  label="Vacant, not out of order"
                  value={availableQ.data.rooms.length}
                />
              ) : (
                <Skeleton />
              )}
              <div>
                <Link className="ui-link-btn ui-link-btn--sm" to={availableHref}>
                  View available rooms
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>VIP arrivals today</CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="dashboard-vip-arrivals">
              {arrivalsQ.isError ? (
                <Alert>{errorCopy(arrivalsQ.error, 'Could not load arrivals.')}</Alert>
              ) : arrivalsQ.isSuccess ? (
                vipArrivals.length === 0 ? (
                  <EmptyState title="No VIP arrivals today" />
                ) : (
                  <ul className="ui-stack">
                    {vipArrivals.map((row) => (
                      <li key={row.reservationId}>
                        <GuestNameLink state={states[row.guestRef]} guestRef={row.guestRef} />
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <Skeleton />
              )}
              {arrivalsQ.data?.nextCursor && today ? (
                <p className="muted">
                  More arrivals on the{' '}
                  <Link to={`/arrivals?date=${encodeURIComponent(today)}`}>Front Desk</Link>.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
