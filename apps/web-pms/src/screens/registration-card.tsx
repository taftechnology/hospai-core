import type { ReservationRead } from '@hospai/client-core';

export function RegistrationCard({
  propertyName,
  reservation,
  displayName,
  roomLabel,
}: {
  propertyName: string | null;
  reservation: ReservationRead | undefined;
  displayName: string | null;
  roomLabel?: string | null;
}) {
  const adults = reservation?.adults ?? 1;
  const children = reservation?.children ?? 0;
  const roomText = roomLabel !== undefined ? roomLabel : reservation?.roomId;
  return (
    <div data-testid="reg-card" className="reg-card">
      <h2>Registration card</h2>
      {propertyName ? <p>{propertyName}</p> : null}
      {reservation ? (
        <>
          <p>Confirmation {reservation.reservationId}</p>
          {displayName ? <p>{displayName}</p> : null}
          <p>
            {reservation.arrivalDate} → {reservation.departureDate}
          </p>
          <p>Room type {reservation.roomTypeId}</p>
          {roomText ? <p>Room {roomText}</p> : null}
          <p>
            Adults {adults} · Children {children}
          </p>
          {reservation.vipFlag ? <p>VIP</p> : null}
          {reservation.dndFlag ? <p>DND</p> : null}
          {reservation.frontOfficeComment ? <p>{reservation.frontOfficeComment}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function PrintRegCardControl({ canPrint }: { canPrint: boolean }) {
  return (
    <div>
      <button
        type="button"
        data-testid="print-reg-card"
        disabled={!canPrint}
        onClick={() => {
          if (!canPrint) return;
          window.print();
        }}
      >
        Print registration card
      </button>
      {!canPrint ? (
        <p className="muted">Registration card is unavailable while the property is unreachable.</p>
      ) : null}
    </div>
  );
}
