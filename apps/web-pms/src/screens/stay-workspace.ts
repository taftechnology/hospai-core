import type { ReservationCancellation } from '@hospai/client-core';

export type StayModifyBody = {
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  ratePlanId?: string;
};

/** Prefixes the desk screens actually subscribe to. */
export function stayMutationQueryKeys(propertyId: string, reservationId: string): unknown[][] {
  return [
    ['reservation', propertyId, reservationId],
    ['reservation-rate-nights', propertyId, reservationId],
    ['folio', propertyId, reservationId],
    ['folio-payments', propertyId, reservationId],
    ['board'],
    ['front-desk-tape', propertyId],
    ['front-desk-free', propertyId],
    ['front-desk-available', propertyId],
    ['front-desk-summary', propertyId],
    ['front-desk-directory', propertyId],
    ['reservation-search', propertyId],
    ['availability', propertyId],
    ['guest-stays', propertyId],
  ];
}

export function invalidateStayMutations(
  queryClient: { invalidateQueries: (filters: { queryKey: unknown[] }) => unknown },
  propertyId: string,
  reservationId: string,
): void {
  for (const queryKey of stayMutationQueryKeys(propertyId, reservationId)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function modifyReservationOpId(reservationId: string, body: StayModifyBody): string {
  return [
    'modify',
    reservationId,
    body.roomTypeId,
    body.arrivalDate,
    body.departureDate,
    String(body.adults),
    String(body.children),
    body.ratePlanId ?? '',
  ].join(':');
}

export function confirmReservationOpId(reservationId: string): string {
  return `confirm:${reservationId}`;
}

export function cancelReservationOpId(reservationId: string): string {
  return `cancel:${reservationId}`;
}

export function noShowReservationOpId(reservationId: string): string {
  return `noshow:${reservationId}`;
}

/** Check-in bumps `updatedAt`, so a later cancel-check-in is a new operation. */
export function cancelCheckInOpId(reservationId: string, updatedAt: number): string {
  return `cancel-check-in:${reservationId}:${updatedAt}`;
}

export function stayNights(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

const TERMINAL = new Set(['checked_out', 'cancelled', 'no_show']);

export function isTerminalStay(status: string): boolean {
  return TERMINAL.has(status);
}

export function checkInBlockReason(status: string): string | null {
  if (status === 'confirmed') return null;
  if (status === 'pending') return 'Confirm the booking before check-in.';
  if (status === 'inquiry') return 'Only a confirmed booking can be checked in.';
  if (status === 'checked_in') return 'Guest is already in house.';
  return 'Only a confirmed booking can be checked in.';
}

export function noShowBlockReason(arrivalDate: string, businessDate: string | null): string | null {
  if (businessDate == null) return "Business date isn't available yet.";
  if (businessDate < arrivalDate) return 'No-show is available on the arrival business date.';
  return null;
}

export const IN_HOUSE_MODIFY_REASON =
  "Dates and room type of an in-house stay can't be changed here yet.";

export type InHouseChangeDraft = {
  departureDate: string;
  roomTypeId: string;
  roomId: string;
  ratePlanId: string;
  adults: number;
  children: number;
  reason: string;
};

/** One-line preview for the in-house change dialog. */
export function inHouseChangePreview(
  current: {
    departureDate: string;
    roomTypeId: string;
    ratePlanId: string;
    adults: number;
    children: number;
  },
  draft: InHouseChangeDraft,
  labels: {
    roomTypeName?: string;
    roomCode?: string;
    ratePlanName?: string;
    formatDate: (iso: string) => string;
  },
): string | null {
  const parts: string[] = [];
  if (draft.departureDate > current.departureDate) {
    const nights = stayNights(current.departureDate, draft.departureDate);
    parts.push(
      `Adds ${nights} night${nights === 1 ? '' : 's'} · departs ${labels.formatDate(draft.departureDate)}`,
    );
  }
  if (draft.roomTypeId !== current.roomTypeId) {
    const name = labels.roomTypeName ?? draft.roomTypeId;
    if (draft.roomId && labels.roomCode) {
      parts.push(`Moves to ${name} ${labels.roomCode} from tonight`);
    } else if (draft.roomId) {
      parts.push(`Moves to ${name} from tonight`);
    } else {
      parts.push(`Moves to ${name} from tonight — pick a room`);
    }
  }
  if (draft.ratePlanId !== current.ratePlanId) {
    const plan = labels.ratePlanName ?? draft.ratePlanId;
    parts.push(`Rate plan ${plan} applies from tonight`);
  }
  if (draft.adults !== current.adults || draft.children !== current.children) {
    parts.push(`Party ${draft.adults} adults, ${draft.children} children`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function changeInHouseStayOpId(reservationId: string, attemptId: string): string {
  return `in-house-change:${reservationId}:${attemptId}`;
}

function penaltyKind(cancellation: ReservationCancellation): string {
  switch (cancellation.penaltyType) {
    case 'first_night':
      return 'first night';
    case 'nights': {
      const n = cancellation.penaltyNights ?? 0;
      return n === 1 ? '1 night' : `${n} nights`;
    }
    case 'percent':
      return `${(cancellation.penaltyBps ?? 0) / 100}% of the stay`;
    case 'full':
      return 'the full stay';
    default:
      return 'no charge';
  }
}

export function cancellationPolicySentence(
  cancellation: ReservationCancellation | undefined,
  money: (minor: number, currency?: string) => string,
  dateTime: (ms: number) => string,
  nowMs: number,
): string {
  if (!cancellation || cancellation.penaltyType === 'none') return 'No cancellation charge.';
  const kind = penaltyKind(cancellation);
  if (cancellation.freeUntil != null && nowMs < cancellation.freeUntil) {
    return `Free cancellation until ${dateTime(cancellation.freeUntil)}. After that: ${kind}.`;
  }
  if (cancellation.cancelNowMinor == null) return "The cancellation charge can't be worked out.";
  if (cancellation.cancelNowMinor === 0) return 'No cancellation charge.';
  return `Cancellation charge now: ${kind} (${money(cancellation.cancelNowMinor, cancellation.currency)} before tax).`;
}

export function cancelChargeSentence(
  amount: number | null | undefined,
  money: (minor: number, currency?: string) => string,
  currency?: string,
): string {
  if (amount == null) {
    return "The cancellation charge can't be worked out from this booking's policy, so cancelling may be refused.";
  }
  if (amount === 0) return 'No cancellation charge applies.';
  return `Cancelling now posts a cancellation charge of ${money(amount, currency)}, before tax, to the guest folio.`;
}

export function noShowChargeSentence(
  amount: number | null | undefined,
  money: (minor: number, currency?: string) => string,
  currency?: string,
): string {
  if (amount == null) {
    return "The no-show charge can't be worked out from this booking's policy, so marking a no-show may be refused.";
  }
  if (amount === 0) return 'No no-show charge applies.';
  return `Marking a no-show posts a no-show charge of ${money(amount, currency)}, before tax, to the guest folio.`;
}

export function damageHoldWord(status: string): string {
  if (status === 'authorized') return 'Authorized';
  if (status === 'voided') return 'Released';
  if (status === 'captured') return 'Captured';
  return status;
}
