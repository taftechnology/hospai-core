export type IdempotencyKey = {
  key: string;
  fingerprint: string;
};

/** Wire / HTTP mapping code — not for `instanceof` across a DO stub. */
export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const;
export type IdemKeyReusedCode = typeof IDEM_KEY_REUSED;

/** Inventory wire codes */
export const TIMEZONE_UNSET = 'timezone_unset' as const;
export const ROOM_TYPE_EXISTS = 'room_type_exists' as const;
export const ROOM_TYPE_CODE_EXISTS = 'room_type_code_exists' as const;
export const OVERSELL = 'oversell' as const;
export const ARCHIVE_BLOCKED = 'archive_blocked' as const;
export const VIRTUAL_CONSTITUENTS_REQUIRED = 'virtual_constituents_required' as const;
export const VIRTUAL_CONSTITUENTS_MIN_TWO = 'virtual_constituents_min_two' as const;
export const VIRTUAL_CONSTITUENTS_DUPLICATE = 'virtual_constituents_duplicate' as const;
export const VIRTUAL_CONSTITUENT_NOT_PHYSICAL = 'virtual_constituent_not_physical' as const;
export const VIRTUAL_ROOM_COUNT_MUST_BE_ZERO = 'virtual_room_count_must_be_zero' as const;
export const VIRTUAL_NESTED_FORBIDDEN = 'virtual_nested_forbidden' as const;
export const VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS = 'virtual_occupancy_exceeds_constituents' as const;
export const ROOM_TYPE_KIND_IMMUTABLE = 'room_type_kind_immutable' as const;
export const VIRTUAL_CONSTITUENTS_ON_PHYSICAL = 'virtual_constituents_on_physical' as const;
export const CONSTITUENT_IN_USE = 'constituent_in_use' as const;
export const VIRTUAL_TYPE_NO_ROOMS = 'virtual_type_no_rooms' as const;
export const NOT_FOUND = 'not_found' as const;
export const PROPERTY_ID_UNSET = 'property_id_unset' as const;
export const BUSINESS_DATE_UNSET = 'business_date_unset' as const;
/** Replay rejected — operator's believed business date is before the DO open date. */
export const BUSINESS_DATE_CLOSED = 'business_date_closed' as const;

/** Org / scope / transport wire codes */
export const ORG_ID_UNSET = 'org_id_unset' as const;
export const NOT_MEMBER = 'not_member' as const;
export const SCOPE_MISMATCH = 'scope_mismatch' as const;
export const ORG_UNREACHABLE = 'org_unreachable' as const;
export const BULK_NOT_ADMITTED = 'bulk_not_admitted' as const;
export const UNKNOWN_COMMAND = 'unknown_command' as const;
export const INTERNAL_ERROR = 'internal_error' as const;
export const DOMAIN_ERROR = 'domain_error' as const;
export const TENANT_NOT_ACTIVE = 'tenant_not_active' as const;

/** Night-audit PRE_CHECK wire codes */
export const PENDING_COMMANDS_UNDRAINED = 'pending_commands_undrained' as const;
export const PROVISIONAL_EXCEPTIONS_OPEN = 'provisional_exceptions_open' as const;
export const PENDING_CENSUS_REQUIRED = 'pending_census_required' as const;
export const ALREADY_RESOLVED = 'already_resolved' as const;
export const NOTE_TOO_LONG = 'note_too_long' as const;
export const NOTE_LIMIT = 'note_limit' as const;
export const NIGHT_AUDIT_HALTED = 'night_audit_halted' as const;
export const NIGHT_AUDIT_STEP_NOT_FAILED = 'night_audit_step_not_failed' as const;
export const NIGHT_AUDIT_NOT_DUE = 'night_audit_not_due' as const;
export const NIGHT_AUDIT_WORKFLOW_EXISTS = 'night_audit_workflow_exists' as const;

/** Reservations wire codes */
export const NO_AVAILABILITY = 'no_availability' as const;
export const UNBOOKABLE = 'unbookable' as const;
export const ALREADY_CANCELLED = 'already_cancelled' as const;
export const LEDGER_INCONSISTENT = 'ledger_inconsistent' as const;
export const NOT_MODIFIABLE = 'not_modifiable' as const;
export const NOT_EARLY_DEPARTABLE = 'not_early_departable' as const;
export const INVALID_STATUS_TRANSITION = 'invalid_status_transition' as const;
export const NO_SHOW_BEFORE_ARRIVAL = 'no_show_before_arrival' as const;
export const RESTRICTION_VIOLATED = 'restriction_violated' as const;
export const RATE_MISSING = 'rate_missing' as const;
export const SPLIT_AMOUNT_MISMATCH = 'split_amount_mismatch' as const;
export const HOLD_EXPIRED = 'hold_expired' as const;
export const INQUIRY_EXPIRED = 'inquiry_expired' as const;
export const ROOM_REQUIRED = 'room_required' as const;
export const ROOM_NOT_READY = 'room_not_ready' as const;
export const ROOM_OUT_OF_ORDER = 'room_out_of_order' as const;
export const BALANCE_DUE = 'balance_due' as const;
export const OCCUPANCY_EXCEEDED = 'occupancy_exceeded' as const;
export const FRONT_OFFICE_COMMENT_TOO_LONG = 'front_office_comment_too_long' as const;
export const INVALID_STATUS = 'invalid_status' as const;
export const INVALID_BUSINESS_DATE = 'invalid_business_date' as const;
export const INVALID_ASSIGNEE_REF = 'invalid_assignee_ref' as const;
export const INVALID_DATE = 'invalid_date' as const;
export const GUEST_REF_REQUIRED = 'guest_ref_required' as const;
export const INVALID_STAY_RANGE = 'invalid_stay_range' as const;
export const INVALID_WINDOW = 'invalid_window' as const;
export const INVALID_DATE_RANGE = 'invalid_date_range' as const;
export const VALIDATION_ERROR = 'validation_error' as const;

/** Folio money-ops wire codes */
export const WINDOW_CLOSED = 'window_closed' as const;
export const WINDOW_NOT_CLOSABLE = 'window_not_closable' as const;
export const WINDOW_BALANCE_DUE = 'window_balance_due' as const;
export const WINDOW_NOT_REOPENABLE = 'window_not_reopenable' as const;
export const WINDOW_NOT_OPENABLE = 'window_not_openable' as const;
export const GUEST_WINDOW_NOT_OPENABLE = 'guest_window_not_openable' as const;
export const TRANSFER_CROSS_RESERVATION = 'transfer_cross_reservation' as const;
export const TRANSFER_SAME_WINDOW = 'transfer_same_window' as const;
export const LINE_NOT_TRANSFERABLE = 'line_not_transferable' as const;
export const LINE_ALREADY_TRANSFERRED = 'line_already_transferred' as const;
export const LINE_NOT_DISCOUNTABLE = 'line_not_discountable' as const;
export const PAYMENT_NOT_VOIDABLE = 'payment_not_voidable' as const;
export const PAYMENT_NOT_REFUNDABLE = 'payment_not_refundable' as const;
export const DISCOUNT_REASON_REQUIRED = 'discount_reason_required' as const;
export const FX_REASON_REQUIRED = 'fx_reason_required' as const;
export const PAYMENT_NOT_CHARGEBACKABLE = 'payment_not_chargebackable' as const;
export const REFUND_EXCEEDS_REMAINING = 'refund_exceeds_remaining' as const;

/** Payment wire codes */
export const PSP_UNAVAILABLE = 'psp_unavailable' as const;
export const PAYMENT_NOT_CAPTURABLE = 'payment_not_capturable' as const;
export const PAYMENT_NOT_RECONCILABLE = 'payment_not_reconcilable' as const;
export const LINE_NOT_SPLITTABLE = 'line_not_splittable' as const;
export const INVALID_VOID_REASON = 'invalid_void_reason' as const;
export const PSP_ADAPTER_FAILED = 'psp_adapter_failed' as const;
export const PAYMENT_INSERT_FAILED = 'payment_insert_failed' as const;

/** Room / housekeeping wire codes */
export const ROOM_CODE_EXISTS = 'room_code_exists' as const;
export const ROOM_COUNT_EXCEEDED = 'room_count_exceeded' as const;
export const ROOM_UNITS_EXCEED_COUNT = 'room_units_exceed_count' as const;
export const ROOM_TYPE_MISMATCH = 'room_type_mismatch' as const;
export const ROOM_ALREADY_ASSIGNED = 'room_already_assigned' as const;
export const ROOM_NOT_ASSIGNABLE = 'room_not_assignable' as const;
export const OOO_VIA_RANGE = 'ooo_via_range' as const;
export const OOO_ROOM_ASSIGNED = 'ooo_room_assigned' as const;
export const OOO_RANGE_OVERLAP = 'ooo_range_overlap' as const;
export const OOO_INVALID_RANGE = 'ooo_invalid_range' as const;

export const RATE_PLAN_NOT_FOUND = 'rate_plan_not_found' as const;
export const RATE_PLAN_CODE_EXISTS = 'rate_plan_code_exists' as const;
export const RATE_PLAN_ID_EXISTS = 'rate_plan_id_exists' as const;
export const DEFAULT_RATE_PLAN_PROTECTED = 'default_rate_plan_protected' as const;
export const DERIVED_RATE_PLAN_INVALID = 'derived_rate_plan_invalid' as const;
export const DERIVED_RATE_PLAN_WRITE_FORBIDDEN = 'derived_rate_plan_write_forbidden' as const;
export const INVALID_CANCEL_POLICY = 'invalid_cancel_policy' as const;

export const PROMO_NOT_FOUND = 'promo_not_found' as const;
export const PROMO_NOT_APPLICABLE = 'promo_not_applicable' as const;
export const PROMO_CODE_EXISTS = 'promo_code_exists' as const;
export const INVALID_PROMO_CODE = 'invalid_promo_code' as const;
export const INVALID_PROMO_WINDOW = 'invalid_promo_window' as const;
export const INVALID_PROMO_KIND_FIELD = 'invalid_promo_kind_field' as const;
export const PROMO_ID_EXISTS = 'promo_id_exists' as const;

export const INVOICE_ALREADY_EXISTS = 'invoice_already_exists' as const;
export const INVOICE_NOT_FOUND = 'invoice_not_found' as const;
export const INVOICE_VOIDED = 'invoice_voided' as const;
export const INVOICE_R2_UNBOUND = 'invoice_r2_unbound' as const;
export const INVOICE_COUNTER_RACE = 'invoice_counter_race' as const;
export const REPORTS_R2_UNBOUND = 'reports_r2_unbound' as const;
export const INVOICE_REQUIRED = 'invoice_required' as const;
export const FOLIO_BALANCE_DUE = 'folio_balance_due' as const;

export const CITY_LEDGER_ACCOUNT_NOT_FOUND = 'city_ledger_account_not_found' as const;
export const CITY_LEDGER_ACCOUNT_EXISTS = 'city_ledger_account_exists' as const;
export const CITY_LEDGER_ACCOUNT_ARCHIVED = 'city_ledger_account_archived' as const;
export const CITY_LEDGER_CREDIT_LIMIT_EXCEEDED = 'city_ledger_credit_limit_exceeded' as const;
export const CITY_LEDGER_BILLED_PARTY_INVALID = 'city_ledger_billed_party_invalid' as const;
export const CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE = 'city_ledger_payment_exceeds_balance' as const;
export const CITY_LEDGER_STATEMENT_NOT_FOUND = 'city_ledger_statement_not_found' as const;
export const CITY_LEDGER_R2_UNBOUND = 'city_ledger_r2_unbound' as const;
export const CITY_LEDGER_CHARGE_ALREADY_POSTED = 'city_ledger_charge_already_posted' as const;

export const CHARGE_CODE_NOT_FOUND = 'charge_code_not_found' as const;
export const CHARGE_CODE_EXISTS = 'charge_code_exists' as const;
export const ROUTING_RULE_CONFLICT = 'routing_rule_conflict' as const;
export const SYSTEM_CHARGE_CODE_PROTECTED = 'system_charge_code_protected' as const;

/** Config wire codes */
export const CONFIG_CLASS_NOT_DOMAIN = 'config_class_not_domain' as const;

/** Tax rule wire codes */
export const TAX_RULE_NOT_FOUND = 'tax_rule_not_found' as const;
export const TAX_RULE_KEY_EXISTS = 'tax_rule_key_exists' as const;
export const TAX_RULE_KEY_OVERLAP = 'tax_rule_key_overlap' as const;
export const TAX_RULE_TYPE_UNSUPPORTED = 'tax_rule_type_unsupported' as const;
export const TAX_OUTPUT_CODE_TAXABLE = 'tax_output_code_taxable' as const;

/** Shift / cashiering wire codes */
export const SHIFT_NOT_FOUND = 'shift_not_found' as const;
export const SHIFT_ALREADY_OPEN = 'shift_already_open' as const;
export const SHIFT_NOT_OPEN = 'shift_not_open' as const;

/** Guest / PII wire codes */
export const GUEST_NOT_FOUND = 'guest_not_found' as const;
export const GUEST_ALREADY_ERASED = 'guest_already_erased' as const;
export const GUEST_EXISTS = 'guest_exists' as const;

export const STAFF_NOT_FOUND = 'staff_not_found' as const;
export const STAFF_EXITED = 'staff_exited' as const;
export const STAFF_NOT_ASSIGNABLE = 'staff_not_assignable' as const;
export const INVALID_KINDS = 'invalid_kinds' as const;
export const EMPTY_KINDS = 'empty_kinds' as const;
export const INVALID_ROLE = 'invalid_role' as const;
export const ALREADY_MEMBER = 'already_member' as const;
export const LAST_OWNER = 'last_owner' as const;
export const PROPERTY_REF_NOT_FOUND = 'property_ref_not_found' as const;
export const DECRYPT_UNRESOLVED = 'decrypt_unresolved' as const;
export const KEY_SHRED_FAILED = 'key_shred_failed' as const;

/** Sorted-key canonical JSON. Client/edge only — never call from a DO command path. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function fingerprintPayload(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Idempotency fingerprint for a catalog command + the exact payload sent to try*. */
export async function commandFingerprint(
  commandId: string,
  payload: unknown,
): Promise<string> {
  return fingerprintPayload({ commandId, payload });
}
