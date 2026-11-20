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
  /**
   * When set, `room_already_assigned` is a type-change move into an occupied
   * room (not the stay's own room booked on an extension).
   */
  roomCode?: string;
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
  room_already_assigned: (_body, context) => {
    if (context.roomCode) {
      return `Room ${context.roomCode} is still occupied or booked for these nights. Pick another room.`;
    }
    return 'That room is already assigned — move the guest first or pick another room.';
  },
  room_move_reason_required: () => 'Give a reason for the room move.',
  room_not_ready: () => 'That room is not ready yet — pick a clean or inspected room.',
  prepayment_required: () =>
    'This hotel requires a card hold or payment before check-in. Authorize a card or take a payment on the folio.',
  id_document_required: () => 'Record an identity document before check-in.',
  aadhaar_full_number_not_allowed: () => 'Aadhaar stores the last four digits only.',
  aadhaar_scan_not_allowed: () => 'Aadhaar scans are not stored.',
  consent_notice_not_configured: () => 'Set a consent notice version in Settings before recording consent.',
  scan_type_not_allowed: () => 'That file type is not allowed. Use a JPEG, PNG, or PDF.',
  room_out_of_order: () => 'Room is out of order — pick another room.',
  room_type_mismatch: () =>
    'That room does not match the booked room type — pick another room.',
  hold_expired: () => 'This hold has expired — create a new booking.',
  inquiry_expired: () => 'This inquiry has expired — create a new booking.',
  invoice_required: () => 'An invoice is required before checkout.',
  invoice_number_invalid: () =>
    'That invoice number is not valid for this series. Shorten the prefix or suffix, or switch back to one continuous series.',
  not_modifiable: () => 'This reservation cannot be changed in its current status.',
  not_in_house: () => 'Only an in-house stay can be changed this way.',
  use_early_depart: () => 'To shorten the stay use Early departure on the folio.',
  room_id_required: () => 'Pick a room of the new type when changing room type.',
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
  invalid_request: () => 'Check the nights and try again.',
  reason_required: () => 'Give a reason for this change.',
  rate_override_not_allowed: () =>
    'Nightly rates can be changed on a pending, confirmed, or in-house stay.',
  night_outside_stay: () => 'That date is outside this stay.',
  night_already_posted: () => 'That night is already on the folio. Correct it there.',
  override_below_inclusions: () => 'That amount is below what is included in the rate.',
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
  package_price_below_components: () =>
    'Package price is below the total of its components — raise the price or lower component amounts.',
  package_plan_has_added_inclusions: () =>
    'That rate plan has add-on inclusions. Packages need a plan without ADDED inclusions.',
  package_not_found: () => 'That package no longer exists — refresh the list.',
  package_id_exists: () => 'A package with that id already exists.',
  package_code_exists: () => 'A package with that code already exists.',
  package_already_applied: () => 'This stay already has a package applied.',
  package_mismatch: () =>
    'Room type, rate plan, or nights do not match the package — adjust the stay first.',
  package_nights_posted: () =>
    'A night of this stay is already posted — packages can only be applied before the first night audit.',
  date_outside_stay: () => 'One or more chosen dates fall outside the stay.',
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
  duplicate_upi_reference: () => 'This UPI reference is already recorded on another payment.',
  invalid_upi_reference: () => 'UPI reference must be 6 to 35 letters or digits.',
  no_availability: (body, context) => {
    const date = bodyStringField(body, 'date');
    if (date) {
      return `No availability on ${formatDate(date, context.fmt ?? FALLBACK_FORMAT)} — pick another room type or date.`;
    }
    return 'No availability — pick another room type or date.';
  },
  open_folio_disabled: () =>
    'Open folio is off for this property. Turn it on in Settings → Folio.',
  hold_already_active: () => 'This stay already has an open-folio hold.',
  no_active_hold: () => 'There is no active open-folio hold on this stay.',
  checked_out_requires_hold: () =>
    'Place an open-folio hold to post charges after checkout.',
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
