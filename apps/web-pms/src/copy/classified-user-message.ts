import {
  type ClassifiedResponse,
  type ClientResultClass,
  permissionForForbidden,
} from '@hospai/client-core';
import { formatMinor } from '../money.js';

const UNKNOWN_MESSAGE = 'Something went wrong — try again or ask a manager.';

const CLASS_MESSAGES: Partial<Record<ClientResultClass, string>> = {
  fail_closed: 'Property unreachable.',
  read_stale: 'Data is stale — try again.',
  provisional: 'Request queued — will apply when the property is reachable.',
  queue_unavailable: 'Could not queue — queue unavailable.',
  not_configured: 'Card payments are not configured for this property.',
  idempotency_key_reused:
    'An earlier submission of this form already posted; refresh the folio to see it.',
  unauthorized: 'Sign in required.',
  entitlement_required: 'Subscription required for this feature.',
  shift_not_open: 'No open shift — open a shift first.',
};

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

function bodyNumberField(body: unknown, key: string): number | undefined {
  if (body && typeof body === 'object' && key in body) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === 'number') return v;
  }
  return undefined;
}

function bodyStringField(body: unknown, key: string): string | undefined {
  if (body && typeof body === 'object' && key in body) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

const DOMAIN_CODE_MESSAGES: Record<string, (body: unknown) => string> = {
  balance_due: (body) => {
    const balanceMinor = bodyNumberField(body, 'balanceMinor');
    if (typeof balanceMinor === 'number') {
      return `Guest owes ${formatMinor(balanceMinor)} — settle on the folio before checkout.`;
    }
    return 'Guest balance is due — settle on the folio before checkout.';
  },
  folio_balance_due: (body) => {
    const balanceMinor = bodyNumberField(body, 'balanceMinor');
    if (typeof balanceMinor === 'number') {
      return `Guest owes ${formatMinor(balanceMinor)} — settle on the folio before generating the invoice.`;
    }
    return 'Folio balance is due — settle before generating the invoice.';
  },
  room_already_assigned: () => 'That room is already assigned — pick another room.',
  room_out_of_order: () => 'Room is out of order — pick another room.',
  room_type_mismatch: () =>
    'That room does not match the booked room type — pick another room.',
  hold_expired: () => 'This hold has expired — create a new booking.',
  inquiry_expired: () => 'This inquiry has expired — create a new booking.',
  invoice_required: () => 'Generate an invoice before checkout.',
  not_modifiable: () => 'This reservation cannot be changed in its current status.',
  no_availability: (body) => {
    const date = bodyStringField(body, 'date');
    if (date) {
      return `No availability on ${date} — pick another room type or date.`;
    }
    return 'No availability — pick another room type or date.';
  },
};

export function classifiedUserMessage(
  classified: ClassifiedResponse,
  context: {
    fallback?: string;
    /** Screen-specific overrides already painted before calling helper */
    knownCode?: string | null;
  },
): string {

  if (classified.class === 'forbidden') {
    const perm = permissionForForbidden(classified.body);
    return perm
      ? `Requires permission ${perm}. Ask a manager.`
      : 'Forbidden — insufficient permission.';
  }

  const code = bodyErrorCode(classified.body);
  const domainMsg = code ? DOMAIN_CODE_MESSAGES[code]?.(classified.body) : undefined;
  if (domainMsg) return domainMsg;

  const mapped = CLASS_MESSAGES[classified.class];
  if (mapped) return mapped;

  return context.fallback ?? UNKNOWN_MESSAGE;
}
