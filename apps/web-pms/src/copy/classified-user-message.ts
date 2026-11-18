import {
  FALLBACK_FORMAT,
  formatDate,
  formatMoney,
  permissionForForbidden,
  type ClassifiedResponse,
  type ClientResultClass,
  type PropertyFormat,
} from '@hospai/client-core';

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

type MessageContext = {
  fallback?: string;
  /** Screen-specific overrides already painted before calling helper */
  knownCode?: string | null;
  fmt?: PropertyFormat;
};

const DOMAIN_CODE_MESSAGES: Record<string, (body: unknown, context: MessageContext) => string> = {
  balance_due: (body, context) => {
    const balanceMinor = bodyNumberField(body, 'balanceMinor');
    if (typeof balanceMinor === 'number') {
      const fmt = context.fmt ?? FALLBACK_FORMAT;
      return `Guest owes ${formatMoney(balanceMinor, fmt)} — settle on the folio before checkout.`;
    }
    return 'Guest balance is due — settle on the folio before checkout.';
  },
  folio_balance_due: (body, context) => {
    const balanceMinor = bodyNumberField(body, 'balanceMinor');
    if (typeof balanceMinor === 'number') {
      const fmt = context.fmt ?? FALLBACK_FORMAT;
      return `Guest owes ${formatMoney(balanceMinor, fmt)} — settle on the folio before generating the invoice.`;
    }
    return 'Folio balance is due — settle before generating the invoice.';
  },
  room_already_assigned: () => 'That room is already assigned — pick another room.',
  room_move_reason_required: () => 'Give a reason for the room move.',
  room_not_ready: () => 'That room is not ready yet — pick a clean or inspected room.',
  prepayment_required: () =>
    'This hotel requires a card hold or payment before check-in. Authorize a card or take a payment on the folio.',
  room_out_of_order: () => 'Room is out of order — pick another room.',
  room_type_mismatch: () =>
    'That room does not match the booked room type — pick another room.',
  hold_expired: () => 'This hold has expired — create a new booking.',
  inquiry_expired: () => 'This inquiry has expired — create a new booking.',
  invoice_required: () => 'Generate an invoice before checkout.',
  invoice_number_invalid: () =>
    'That invoice number is not valid for this series. Shorten the prefix or suffix, or switch back to one continuous series.',
  not_modifiable: () => 'This reservation cannot be changed in its current status.',
  no_show_before_arrival: () =>
    'No-show is only allowed on or after the arrival business date.',
  already_cancelled: () => 'This reservation is already cancelled.',
  invalid_cancel_policy: () =>
    "The cancellation policy isn't valid, so the charge can't be posted.",
  occupancy_exceeded: () => 'That party is larger than the room type allows.',
  invalid_status_transition: () => "That status change isn't allowed.",
  invalid_stay_range: () => 'Departure must be after arrival.',
  unbookable: (body, context) => {
    const date = bodyStringField(body, 'date');
    if (date) {
      return `Those dates aren't bookable on ${formatDate(date, context.fmt ?? FALLBACK_FORMAT)}.`;
    }
    return "Those dates aren't bookable.";
  },
  rate_missing: (body, context) => {
    const date = bodyStringField(body, 'date');
    if (date) {
      return `No rate is set for ${formatDate(date, context.fmt ?? FALLBACK_FORMAT)}.`;
    }
    return 'No rate is set for those dates.';
  },
  restriction_violated: (body, context) => {
    const date = bodyStringField(body, 'date');
    const rule = bodyStringField(body, 'rule');
    const when = date ? ` on ${formatDate(date, context.fmt ?? FALLBACK_FORMAT)}` : '';
    const which = rule ? ` (${rule})` : '';
    return `A stay restriction blocks those dates${when}${which}.`;
  },
  charge_code_not_postable: () =>
    'That charge code cannot be used for a product — pick an active, non-system code.',
  category_exists: () => 'A category with that id already exists.',
  product_exists: () => 'A product with that id already exists.',
  sku_taken: () => 'Another product already uses that SKU.',
  invalid_amount: () => 'Enter a price of zero or more, with at most two decimals.',
  category_not_found: () => 'That category is missing or archived — pick an active category.',
  product_not_found: () => 'That product no longer exists — refresh the list.',
  product_not_postable: () =>
    'That product cannot be scheduled — it is archived, or its category or charge code is not postable.',
  reservation_not_active: () => 'Recurring charges can be added only on a confirmed or in-house stay.',
  recurring_charge_dates_invalid: () =>
    'Those nights are outside the stay. Start on or after today and arrival, and end on or before the last night.',
  recurring_charge_exists: () => 'A recurring charge with that id already exists.',
  inventory_item_not_found: () => 'That inventory item no longer exists — refresh the list.',
  inventory_item_exists: () => 'An item with that name or id already exists.',
  inventory_item_archived: () => 'Archived items cannot be adjusted — unarchive or pick another item.',
  insufficient_stock: () => 'Not enough on hand for that issue quantity.',
  ticket_not_found: () => 'That maintenance ticket no longer exists — refresh the list.',
  ticket_closed: () => 'This ticket is already closed and cannot be changed.',
  invalid_ticket_transition: () => 'That status change is not allowed for this ticket.',
  task_type_not_found: () => 'That task type no longer exists — refresh settings.',
  limit_exceeded: () => 'This property has reached the catalog limit.',
  config_code_removed: () =>
    'Codes stay on the list so past stays can still show them. Archive a code instead of removing it.',
  config_key_not_writable: () => 'That setting cannot be changed.',
  guest_email_required: () => 'Email is required on new guest profiles.',
  guest_phone_required: () => 'Phone is required on new guest profiles.',
  guest_duplicate: (body) => {
    const match = bodyStringField(body, 'match');
    if (match === 'email') {
      return 'A guest with this email is already on file at this property. Search for them instead.';
    }
    if (match === 'phone') {
      return 'A guest with this phone is already on file at this property. Search for them instead.';
    }
    return 'A guest with this email or phone is already on file at this property. Search for them instead.';
  },
  no_availability: (body, context) => {
    const date = bodyStringField(body, 'date');
    if (date) {
      return `No availability on ${formatDate(date, context.fmt ?? FALLBACK_FORMAT)} — pick another room type or date.`;
    }
    return 'No availability — pick another room type or date.';
  },
};

export function classifiedUserMessage(
  classified: ClassifiedResponse,
  context: MessageContext,
): string {

  if (classified.class === 'forbidden') {
    const perm = permissionForForbidden(classified.body);
    return perm
      ? `Requires permission ${perm}. Ask a manager.`
      : 'Forbidden — insufficient permission.';
  }

  const code = bodyErrorCode(classified.body);
  const domainMsg = code ? DOMAIN_CODE_MESSAGES[code]?.(classified.body, context) : undefined;
  if (domainMsg) return domainMsg;

  const mapped = CLASS_MESSAGES[classified.class];
  if (mapped) return mapped;

  return context.fallback ?? UNKNOWN_MESSAGE;
}
