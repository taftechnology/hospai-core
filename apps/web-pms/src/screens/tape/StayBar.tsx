import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useRef, useState } from 'react';
import type { FrontDeskItem, GuestRowState } from '@hospai/client-core';
import { Popover, StatField, StatusBadge, StayButton, isReservationStatus } from '@hospai/ui-kit';
import { addCalendarDays } from '@hospai/client-core';
import { api, tenant } from '../../client.js';
import { hasPropertyPermission } from '../../auth/me.js';
import { guestLabel } from '../guest-row.js';
import { GuestNameLink } from '../guest-row.js';
import { useFormat } from '../../shell/PropertyFormat.js';
import { AlertCircleIcon, LogOutIcon } from '../../shell/icons.js';
import { STAY_STATE_WORD, stayState, type StayState } from '../../status/stay-state.js';
import type { StayTrackSpan } from './stay-tracks.js';

function compactGuestName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return full;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${first[0]}. ${last}`;
}

function calendarNights(arrival: string, departure: string): number {
  let count = 0;
  let cur = arrival;
  while (cur < departure) {
    count++;
    cur = addCalendarDays(cur, 1);
  }
  return count;
}

function blockRoomTypeId(block: FrontDeskItem): string | null {
  const rt = block.roomTypeId;
  return typeof rt === 'string' ? rt : null;
}

export function StayBar({
  block,
  state,
  span,
  today,
  roomCode,
  roomTypeName,
  tabIndex = -1,
  onFocus,
}: {
  block: FrontDeskItem;
  state: GuestRowState | undefined;
  span: StayTrackSpan;
  today: string | null;
  roomCode?: string;
  roomTypeName?: string;
  tabIndex?: number;
  onFocus?: () => void;
}) {
  const { date, money } = useFormat();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const arrival = block.arrivalDate ?? today ?? '';
  const departure = block.departureDate;
  const stateKey = stayState(block.status, departure, today);
  const guestName = guestLabel(state, block.guestRef);
  const narrow = span.colEnd - span.colStart <= 2;
  const visibleName = narrow ? compactGuestName(guestName) : guestName;
  const word = stateKey ? STAY_STATE_WORD[stateKey] : block.status;
  const ariaName = `${guestName}, ${word}, ${date(arrival)} – ${date(departure)}`;

  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    staleTime: 60_000,
  });
  const canFolio = meQ.data ? hasPropertyPermission(meQ.data, 'folio:read') : false;

  const folioQ = useQuery({
    queryKey: ['folio', tenant.propertyId, block.reservationId],
    queryFn: () => api.getFolio(tenant.propertyId, block.reservationId),
    enabled: open && canFolio,
    retry: false,
  });

  if (stateKey == null) return null;
  const cssState: StayState = stateKey;
  const showDueIcon = stateKey === 'due';
  const showOverstayIcon = stateKey === 'overstay';

  const checkInLink =
    (block.status === 'confirmed' || block.status === 'pending') &&
    today != null &&
    arrival === today;

  return (
    <>
      <StayButton
        ref={anchorRef}
        state={cssState}
        colStart={span.colStart}
        colEnd={span.colEnd}
        cutStart={span.cutStart}
        cutEnd={span.cutEnd}
        aria-label={ariaName}
        aria-haspopup="dialog"
        aria-expanded={open}
        tabIndex={tabIndex === 0 ? 0 : -1}
        onFocus={onFocus}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          // Prevent the native key-to-click so the popover opens once, also where keys don't click.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {showDueIcon ? <LogOutIcon /> : null}
        {showOverstayIcon ? <AlertCircleIcon /> : null}
        <span>{visibleName}</span>
        {block.vipFlag === true ? (
          <span className="ui-badge status-vip" data-testid="badge-vip">
            VIP
          </span>
        ) : null}
        {block.dndFlag === true ? (
          <span className="ui-badge status-neutral" data-testid="badge-dnd">
            DND
          </span>
        ) : null}
      </StayButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label="Stay details"
        data-testid="stay-popover"
      >
        <div className="stay-popover-panel">
          <div className="stay-popover-head">
            <GuestNameLink state={state} guestRef={block.guestRef} />
            {isReservationStatus(block.status) ? (
              <StatusBadge status={block.status} />
            ) : null}
          </div>
          <div className="stay-popover-stats ui-stat-grid">
            <StatField
              label="Room"
              value={
                roomCode
                  ? `${roomCode} · ${roomTypeName ?? blockRoomTypeId(block) ?? '—'}`
                  : 'Unassigned'
              }
            />
            <StatField label="Nights" value={String(calendarNights(arrival, departure))} />
            <StatField label="Dates" value={`${date(arrival)} – ${date(departure)}`} />
            {canFolio ? (
              <StatField
                label="Balance"
                value={
                  folioQ.isError
                    ? 'Balance unavailable'
                    : folioQ.data?.balanceMinor != null
                      ? money(folioQ.data.balanceMinor)
                      : '…'
                }
              />
            ) : null}
          </div>
          <div className="stay-popover-actions">
            <Link
              className="ui-link-btn ui-link-btn--primary ui-link-btn--sm"
              to={`/folio/${encodeURIComponent(block.reservationId)}`}
            >
              Open folio
            </Link>
            {checkInLink ? (
              <Link
                className="ui-link-btn ui-link-btn--sm"
                to={`/check-in/${encodeURIComponent(block.reservationId)}`}
              >
                Check in
              </Link>
            ) : null}
          </div>
        </div>
      </Popover>
    </>
  );
}

export function BlockedBar({
  label,
  span,
}: {
  label: string;
  span: StayTrackSpan;
}) {
  return (
    <div
      className="ui-stay ui-stay--blocked"
      style={{
        ['--tape-col-start' as string]: String(span.colStart),
        ['--tape-col-end' as string]: String(span.colEnd),
      }}
      {...(span.cutStart ? { 'data-cut-start': true } : {})}
      {...(span.cutEnd ? { 'data-cut-end': true } : {})}
      aria-label={label}
      tabIndex={-1}
    >
      <span>{label}</span>
    </div>
  );
}
