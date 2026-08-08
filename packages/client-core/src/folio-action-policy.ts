import type { ClientResultClass } from './classify.js';

export type FolioReadState = ClientResultClass | 'pending' | 'live';

export type FolioActionPolicyInput = {
  folioReadClass: FolioReadState;
  reservationReadClass: FolioReadState;
  reservationStatus: string | null;
};

export type FolioActionPolicy = {
  canPostCharge: boolean;
  canPay: boolean;
  canSplit: boolean;
  canCheckout: boolean;
  reasons: {
    charge?: string;
    pay?: string;
    split?: string;
    checkout?: string;
  };
};

function folioReadable(folioReadClass: FolioReadState): boolean {
  return folioReadClass === 'live';
}

export function folioActionPolicy(input: FolioActionPolicyInput): FolioActionPolicy {
  const reasons: FolioActionPolicy['reasons'] = {};
  const pending =
    input.folioReadClass === 'pending' || input.reservationReadClass === 'pending';

  if (pending) {
    return {
      canPostCharge: false,
      canPay: false,
      canSplit: false,
      canCheckout: false,
      reasons: {
        charge: 'Loading…',
        pay: 'Loading…',
        split: 'Loading…',
        checkout: 'Loading…',
      },
    };
  }

  let canPostCharge = true;
  let canPay = true;
  let canSplit = true;

  if (!folioReadable(input.folioReadClass)) {
    canPostCharge = false;
    canPay = false;
    canSplit = false;
    const unread =
      input.folioReadClass === 'fail_closed'
        ? 'Folio unreadable — posting refused while property is unreachable.'
        : 'Folio unavailable — cannot post money without a readable folio.';
    reasons.charge = unread;
    reasons.pay = unread;
    reasons.split = unread;
  }

  let canCheckout = false;
  if (input.reservationReadClass !== 'live' || input.reservationStatus == null) {
    reasons.checkout = 'Reservation status unknown — checkout hidden.';
  } else if (input.reservationStatus !== 'checked_in') {
    reasons.checkout = 'Guest is not checked in.';
  } else {
    canCheckout = true;
    if (input.folioReadClass === 'fail_closed') {
      reasons.checkout =
        'Folio unavailable; checking out will not settle any balance.';
    }
  }

  return { canPostCharge, canPay, canSplit, canCheckout, reasons };
}
