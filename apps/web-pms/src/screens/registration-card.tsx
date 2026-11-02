import type { ReservationRead } from '@hospai/client-core';

import { Badge, Button, SectionLabel } from '@hospai/ui-kit';
import { useFormat } from '../shell/PropertyFormat.js';

export function RegistrationCard({
  propertyName,
  reservation,
  displayName,
  roomLabel,
  roomTypeLabel,
}: {
  propertyName: string | null;
  reservation: ReservationRead | undefined;
  displayName: string | null;
  roomLabel?: string | null;
  roomTypeLabel?: string;
}) {
  const { dateRange } = useFormat();
  const adults = reservation?.adults ?? 1;
  const children = reservation?.children ?? 0;
  const roomText = roomLabel ?? null;
  const confirmationToken = reservation?.reservationId.slice(-8);
  const roomTypeText = roomTypeLabel ?? 'unavailable';
  return (
    <div data-testid="reg-card" className="reg-card">
      <SectionLabel>Registration card</SectionLabel>
      {propertyName ? <p>{propertyName}</p> : null}
      {reservation ? (
        <>
          <p>Confirmation # {confirmationToken}</p>
          {displayName ? <p>{displayName}</p> : null}
          <p>
            {dateRange(reservation.arrivalDate, reservation.departureDate)}
          </p>
          <p>Room type {roomTypeText}</p>
          {roomText ? <p>Room {roomText}</p> : null}
          <p>
            Adults {adults} · Children {children}
          </p>
          <div className="ui-row">
            {reservation.vipFlag ? (
              <Badge rung="attention" data-testid="reg-vip-badge">
                VIP
              </Badge>
            ) : null}
            {reservation.dndFlag ? (
              <Badge rung="neutral" data-testid="reg-dnd-badge">
                DND
              </Badge>
            ) : null}
          </div>
          {reservation.frontOfficeComment ? <p>{reservation.frontOfficeComment}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function PrintRegCardControl({ canPrint }: { canPrint: boolean }) {
  return (
    <div>
      <Button
        type="button"
        data-testid="print-reg-card"
        disabled={!canPrint}
        onClick={() => {
          if (!canPrint) return;
          window.print();
        }}
      >
        Print registration card
      </Button>
      {!canPrint ? (
        <p className="muted">
          Registration card is unavailable while the property is unreachable or room code is unknown.
        </p>
      ) : null}
    </div>
  );
}
