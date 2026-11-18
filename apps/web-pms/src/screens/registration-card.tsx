import { useQuery } from '@tanstack/react-query';
import type { ReservationRead } from '@hospai/client-core';

import { Badge, Button, SectionLabel, StatField } from '@hospai/ui-kit';
import { api, tenant } from '../client.js';
import { useFormat } from '../shell/PropertyFormat.js';

/**
 * Room type and rate plan names for the card, on the same query keys the Check-in, stay card
 * and Rates screens use, so the cache is shared. Missing or unknown ids read as undefined.
 */
export function useRegCardLabels(reservation: ReservationRead | undefined): {
  roomTypeLabel: string | undefined;
  ratePlanLabel: string | undefined;
} {
  const propertyId = tenant.propertyId;
  const typesQ = useQuery({
    queryKey: ['room-types', propertyId, 'active'],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    enabled: Boolean(reservation),
    retry: false,
  });
  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    enabled: Boolean(reservation?.ratePlanId),
    retry: false,
  });
  const typeId = reservation?.allocatedRoomTypeId || reservation?.roomTypeId;
  const type = (
    (typesQ.data?.roomTypes ?? []) as Array<{ roomTypeId: string; code: string; name: string }>
  ).find((t) => t.roomTypeId === typeId);
  const plan = (
    (plansQ.data?.plans ?? []) as Array<{ ratePlanId: string; code: string; name: string }>
  ).find((p) => p.ratePlanId === reservation?.ratePlanId);
  return {
    roomTypeLabel: type?.name || type?.code || undefined,
    ratePlanLabel: plan?.name || plan?.code || undefined,
  };
}

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

function partyText(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  if (children === 0) return a;
  return `${a} · ${children} ${children === 1 ? 'child' : 'children'}`;
}

/**
 * Printed guest registration card (R2.4). Only `.reg-card` prints (styles.css @media print).
 * Fields follow the prototype's card that we keep: guest, stay dates and nights, party, room
 * type, room **code** (never the room UUID), rate plan name, confirmation, flags, requests and a
 * signature line. Templates and uploads are R4.13. No balance, no card data.
 */
export function RegistrationCard({
  propertyName,
  reservation,
  displayName,
  roomLabel,
  roomTypeLabel,
  ratePlanLabel,
}: {
  propertyName: string | null;
  reservation: ReservationRead | undefined;
  displayName: string | null;
  roomLabel?: string | null;
  roomTypeLabel?: string | null;
  ratePlanLabel?: string | null;
}) {
  const { date } = useFormat();
  const adults = reservation?.adults ?? 1;
  const children = reservation?.children ?? 0;
  const confirmationToken = reservation?.reservationId.slice(-8);
  return (
    <div data-testid="reg-card" className="reg-card">
      <div className="reg-card__head">
        <SectionLabel>Registration card</SectionLabel>
        {propertyName ? <p className="reg-card__property">{propertyName}</p> : null}
      </div>
      {reservation ? (
        <>
          <div className="ui-stat-grid">
            <StatField label="Guest" value={displayName ?? '—'} />
            <StatField label="Confirmation" value={confirmationToken} />
            <StatField label="Arrival" value={date(reservation.arrivalDate)} />
            <StatField label="Departure" value={date(reservation.departureDate)} />
            <StatField
              label="Nights"
              value={nightsBetween(reservation.arrivalDate, reservation.departureDate)}
            />
            <StatField label="Guests" value={partyText(adults, children)} />
            <StatField label="Room type" value={roomTypeLabel || '—'} />
            <StatField label="Room" value={roomLabel || 'Not assigned'} />
            <StatField label="Rate plan" value={ratePlanLabel || '—'} />
          </div>
          {reservation.vipFlag || reservation.dndFlag ? (
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
          ) : null}
          {reservation.frontOfficeComment ? (
            <StatField label="Special requests" value={reservation.frontOfficeComment} />
          ) : null}
          <div className="reg-card__signature" data-testid="reg-card-signature">
            <span>Guest signature</span>
            <span>Date</span>
          </div>
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
