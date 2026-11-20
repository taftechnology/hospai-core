import { useQuery } from '@tanstack/react-query';
import { getConfigEntry } from '@hospai/contracts';
import type { ReservationRead } from '@hospai/client-core';

import { Badge, Button, SectionLabel, StatField } from '@hospai/ui-kit';
import { api, tenant } from '../client.js';
import { useFormat } from '../shell/PropertyFormat.js';

export type RegistrationCardShow = {
  ratePlan: boolean;
  inclusions: boolean;
  specialRequests: boolean;
  idDocument: boolean;
  signature: boolean;
};

export type RegistrationCardPresentation = {
  template: 'STANDARD' | 'COMPACT';
  headerText: string;
  footerText: string;
  show: RegistrationCardShow;
};

/** Successful `getReservationRegistrationCard` body (guest fields hydrated by HTTP). */
export type RegistrationCardData = {
  ok: true;
  confirmationToken: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  adults: number;
  children: number;
  roomTypeName: string | null;
  roomCode: string | null;
  ratePlanName: string | null;
  packageName?: string | null;
  inclusionLabels?: string[];
  specialRequests: string | null;
  vipFlag: boolean;
  presentation?: unknown;
  guestDisplayName: string | null;
  idDocument?: { type: string; maskedNumber: string } | null;
};

function defaultCardPresentation(): RegistrationCardPresentation {
  const d = getConfigEntry('pms.documents.registration_card')?.default as RegistrationCardPresentation;
  return {
    template: d?.template === 'COMPACT' ? 'COMPACT' : 'STANDARD',
    headerText: typeof d?.headerText === 'string' ? d.headerText : '',
    footerText: typeof d?.footerText === 'string' ? d.footerText : '',
    show: {
      ratePlan: d?.show?.ratePlan !== false,
      inclusions: d?.show?.inclusions !== false,
      specialRequests: d?.show?.specialRequests !== false,
      idDocument: d?.show?.idDocument !== false,
      signature: d?.show?.signature !== false,
    },
  };
}

export function asRegistrationCardPresentation(value: unknown): RegistrationCardPresentation {
  const d = defaultCardPresentation();
  if (!value || typeof value !== 'object') return d;
  const v = value as Partial<RegistrationCardPresentation>;
  const show = (v.show ?? {}) as Partial<RegistrationCardShow>;
  return {
    template: v.template === 'COMPACT' ? 'COMPACT' : 'STANDARD',
    headerText: typeof v.headerText === 'string' ? v.headerText : d.headerText,
    footerText: typeof v.footerText === 'string' ? v.footerText : d.footerText,
    show: {
      ratePlan: show.ratePlan ?? d.show.ratePlan,
      inclusions: show.inclusions ?? d.show.inclusions,
      specialRequests: show.specialRequests ?? d.show.specialRequests,
      idDocument: show.idDocument ?? d.show.idDocument,
      signature: show.signature ?? d.show.signature,
    },
  };
}

/**
 * Room type and rate plan names for the legacy Folio bridge card, on the same query keys the
 * Check-in, stay card and Rates screens use. Missing or unknown ids read as undefined.
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
 * Printed guest registration card from `get_reservation_registration_card` (R4.13 B4).
 * Never renders reservationId or room UUID — confirmation token + room **code** only.
 */
export function RegistrationCardDocument({
  propertyName,
  data,
  templateOverride,
}: {
  propertyName: string | null;
  data: RegistrationCardData;
  templateOverride?: 'STANDARD' | 'COMPACT';
}) {
  const { date } = useFormat();
  const presentation = asRegistrationCardPresentation(data.presentation);
  const template = templateOverride ?? presentation.template;
  const show = presentation.show;
  const compact = template === 'COMPACT';

  return (
    <div
      data-testid="reg-card"
      data-template={template}
      className={
        compact
          ? 'reg-card print-doc reg-card--compact'
          : 'reg-card print-doc reg-card--standard'
      }
    >
      <div className="reg-card__head">
        <SectionLabel>Registration card</SectionLabel>
        {propertyName ? <p className="reg-card__property">{propertyName}</p> : null}
      </div>
      {presentation.headerText ? (
        <p className="reg-card__header-text" data-testid="reg-card-header">
          {presentation.headerText}
        </p>
      ) : null}
      <div className={compact ? 'reg-card__compact-grid' : 'ui-stat-grid'}>
        <StatField label="Guest" value={data.guestDisplayName ?? '—'} />
        <StatField label="Confirmation" value={data.confirmationToken} />
        <StatField label="Arrival" value={date(data.arrivalDate)} />
        <StatField label="Departure" value={date(data.departureDate)} />
        <StatField label="Nights" value={data.nights} />
        <StatField label="Guests" value={partyText(data.adults, data.children)} />
        <StatField label="Room type" value={data.roomTypeName || '—'} />
        <StatField label="Room" value={data.roomCode || 'Not assigned'} />
        {show.ratePlan ? (
          <StatField label="Rate plan" value={data.ratePlanName || '—'} />
        ) : null}
        {data.packageName ? <StatField label="Package" value={data.packageName} /> : null}
      </div>
      {data.vipFlag ? (
        <div className="ui-row">
          <Badge rung="attention" data-testid="reg-vip-badge">
            VIP
          </Badge>
        </div>
      ) : null}
      {show.inclusions && (data.inclusionLabels?.length ?? 0) > 0 ? (
        <StatField label="Inclusions" value={(data.inclusionLabels ?? []).join(', ')} />
      ) : null}
      {show.specialRequests && data.specialRequests ? (
        <StatField label="Special requests" value={data.specialRequests} />
      ) : null}
      {show.idDocument && data.idDocument ? (
        <StatField
          label="ID document"
          value={`${data.idDocument.type} ${data.idDocument.maskedNumber}`}
        />
      ) : null}
      {show.signature ? (
        <div className="reg-card__signature" data-testid="reg-card-signature">
          <span>Guest signature</span>
          <span>Date</span>
        </div>
      ) : null}
      {presentation.footerText ? (
        <p className="reg-card__footer-text" data-testid="reg-card-footer">
          {presentation.footerText}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Legacy Folio bridge: assembles a card from reservation read + labels.
 * Prefer `RegistrationCardDocument` + the registration-card route for new screens.
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
  if (!reservation) {
    return (
      <div data-testid="reg-card" className="reg-card print-doc reg-card--standard" data-template="STANDARD" />
    );
  }
  const adults = reservation.adults ?? 1;
  const children = reservation.children ?? 0;
  const confirmationToken = reservation.reservationId.slice(-8);
  const data: RegistrationCardData = {
    ok: true,
    confirmationToken,
    arrivalDate: reservation.arrivalDate,
    departureDate: reservation.departureDate,
    nights: nightsBetween(reservation.arrivalDate, reservation.departureDate),
    adults,
    children,
    roomTypeName: roomTypeLabel ?? null,
    roomCode: roomLabel ?? null,
    ratePlanName: ratePlanLabel ?? null,
    specialRequests: reservation.frontOfficeComment ?? null,
    vipFlag: reservation.vipFlag === true,
    guestDisplayName: displayName,
    presentation: defaultCardPresentation(),
  };
  return <RegistrationCardDocument propertyName={propertyName} data={data} />;
}

export function PrintDocumentControl({
  canPrint,
  reason,
  label = 'Print',
  testId = 'print-doc',
}: {
  canPrint: boolean;
  reason?: string | null;
  label?: string;
  testId?: string;
}) {
  return (
    <div>
      <Button
        type="button"
        data-testid={testId}
        disabled={!canPrint}
        onClick={() => {
          if (!canPrint) return;
          window.print();
        }}
      >
        {label}
      </Button>
      {!canPrint && reason ? <p className="muted">{reason}</p> : null}
    </div>
  );
}

export function PrintRegCardControl({
  canPrint,
  reason,
}: {
  canPrint: boolean;
  reason?: string | null;
}) {
  return (
    <PrintDocumentControl
      canPrint={canPrint}
      reason={
        reason ??
        (!canPrint
          ? 'Registration card is unavailable while the property is unreachable or room code is unknown.'
          : null)
      }
      label="Print registration card"
      testId="print-reg-card"
    />
  );
}
