import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
  CONSTITUENT_IN_USE,
  commandFingerprint,
  fingerprintPayload,
  IDEM_KEY_REUSED,
  NOT_FOUND,
  OVERSELL,
  NO_AVAILABILITY,
  PROPERTY_ID_UNSET,
  TIMEZONE_UNSET,
  ROOM_TYPE_EXISTS,
  ROOM_TYPE_CODE_EXISTS,
  UNBOOKABLE,
  ALREADY_CANCELLED,
  LEDGER_INCONSISTENT,
  NOT_MODIFIABLE,
  RESTRICTION_VIOLATED,
  RATE_MISSING,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_UNITS_EXCEED_COUNT,
  ROOM_TYPE_MISMATCH,
  ROOM_ALREADY_ASSIGNED,
  ROOM_NOT_ASSIGNABLE,
  RATE_PLAN_NOT_FOUND,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  DEFAULT_RATE_PLAN_PROTECTED,
  DERIVED_RATE_PLAN_INVALID,
  DERIVED_RATE_PLAN_WRITE_FORBIDDEN,
  PROMO_NOT_FOUND,
  PROMO_NOT_APPLICABLE,
  PROMO_CODE_EXISTS,
  INVOICE_ALREADY_EXISTS,
  INVOICE_NOT_FOUND,
  INVOICE_VOIDED,
  INVOICE_R2_UNBOUND,
  INVOICE_NUMBER_INVALID,
  INVOICE_REQUIRED,
  FOLIO_BALANCE_DUE,
  CITY_LEDGER_ACCOUNT_NOT_FOUND,
  CITY_LEDGER_ACCOUNT_EXISTS,
  CITY_LEDGER_ACCOUNT_ARCHIVED,
  CITY_LEDGER_CREDIT_LIMIT_EXCEEDED,
  CITY_LEDGER_BILLED_PARTY_INVALID,
  CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE,
  CITY_LEDGER_STATEMENT_NOT_FOUND,
  CITY_LEDGER_R2_UNBOUND,
  CITY_LEDGER_CHARGE_ALREADY_POSTED,
  CHARGE_CODE_NOT_FOUND,
  CHARGE_CODE_EXISTS,
  ROUTING_RULE_CONFLICT,
  SYSTEM_CHARGE_CODE_PROTECTED,
  GUEST_DUPLICATE,
  GUEST_EMAIL_REQUIRED,
  GUEST_EXISTS,
  GUEST_PHONE_REQUIRED,
  GUEST_NOT_FOUND,
  GUEST_ALREADY_ERASED,
  PSP_UNAVAILABLE,
  DUPLICATE_UPI_REFERENCE,
  INVALID_UPI_REFERENCE,
  PAYMENT_NOT_CAPTURABLE,
  LINE_NOT_SPLITTABLE,
  TAX_RULE_NOT_FOUND,
  TAX_RULE_KEY_EXISTS,
  TAX_RULE_KEY_OVERLAP,
  TAX_RULE_TYPE_UNSUPPORTED,
  TAX_OUTPUT_CODE_TAXABLE,
  TAX_INCLUSIVE_COMPOUND_UNSUPPORTED,
  TAX_INCLUSIVE_SLAB_CONFLICT,
  PENDING_CENSUS_REQUIRED,
  NIGHT_AUDIT_CHECKS_FAILED,
  PENDING_COMMANDS_UNDRAINED,
  PROVISIONAL_EXCEPTIONS_OPEN,
  HOLD_EXPIRED,
  INQUIRY_EXPIRED,
  ROOM_REQUIRED,
  ROOM_NOT_READY,
  ROOM_MOVE_REASON_REQUIRED,
  ROOM_OUT_OF_ORDER,
  BALANCE_DUE,
  PREPAYMENT_REQUIRED,
  OCCUPANCY_EXCEEDED,
  FRONT_OFFICE_COMMENT_TOO_LONG,
  WINDOW_CLOSED,
  WINDOW_NOT_CLOSABLE,
  WINDOW_BALANCE_DUE,
  WINDOW_NOT_REOPENABLE,
  WINDOW_NOT_OPENABLE,
  GUEST_WINDOW_NOT_OPENABLE,
  TRANSFER_CROSS_RESERVATION,
  TRANSFER_SAME_WINDOW,
  LINE_NOT_TRANSFERABLE,
  LINE_ALREADY_TRANSFERRED,
  LINE_NOT_DISCOUNTABLE,
  PAYMENT_NOT_VOIDABLE,
  PAYMENT_NOT_REFUNDABLE,
  DISCOUNT_REASON_REQUIRED,
  FX_REASON_REQUIRED,
  PAYMENT_NOT_CHARGEBACKABLE,
  REFUND_EXCEEDS_REMAINING,
  OOO_VIA_RANGE,
  OOO_ROOM_ASSIGNED,
  OOO_RANGE_OVERLAP,
  OOO_INVALID_RANGE,
  OOO_BEYOND_HORIZON,
  ROOM_TYPE_KIND_IMMUTABLE,
  VIRTUAL_CONSTITUENT_NOT_PHYSICAL,
  VIRTUAL_CONSTITUENTS_DUPLICATE,
  VIRTUAL_CONSTITUENTS_MIN_TWO,
  VIRTUAL_CONSTITUENTS_ON_PHYSICAL,
  VIRTUAL_CONSTITUENTS_REQUIRED,
  VIRTUAL_NESTED_FORBIDDEN,
  VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS,
  VIRTUAL_ROOM_COUNT_MUST_BE_ZERO,
  VIRTUAL_TYPE_NO_ROOMS,
  ORG_ID_UNSET,
  NOT_MEMBER,
  NIGHT_AUDIT_HALTED,
  CONFIG_CLASS_NOT_DOMAIN,
  INTERNAL_ERROR,
} from './idempotency.js';

describe('fingerprintPayload', () => {
  it('is stable under key reordering', async () => {
    const a = await fingerprintPayload({ b: 1, a: 2 });
    const b = await fingerprintPayload({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs when values differ', async () => {
    const a = await fingerprintPayload({ key: 'k', value: true });
    const b = await fingerprintPayload({ key: 'k', value: false });
    expect(a).not.toBe(b);
  });

  it('exports the wire error code', () => {
    expect(IDEM_KEY_REUSED).toBe('idempotency_key_reused');
  });

  it('exports inventory wire codes', () => {
    expect(TIMEZONE_UNSET).toBe('timezone_unset');
    expect(ROOM_TYPE_EXISTS).toBe('room_type_exists');
    expect(ROOM_TYPE_CODE_EXISTS).toBe('room_type_code_exists');
    expect(OVERSELL).toBe('oversell');
    expect(ARCHIVE_BLOCKED).toBe('archive_blocked');
    expect(VIRTUAL_CONSTITUENTS_REQUIRED).toBe('virtual_constituents_required');
    expect(VIRTUAL_CONSTITUENTS_MIN_TWO).toBe('virtual_constituents_min_two');
    expect(VIRTUAL_CONSTITUENTS_DUPLICATE).toBe('virtual_constituents_duplicate');
    expect(VIRTUAL_CONSTITUENT_NOT_PHYSICAL).toBe('virtual_constituent_not_physical');
    expect(VIRTUAL_ROOM_COUNT_MUST_BE_ZERO).toBe('virtual_room_count_must_be_zero');
    expect(VIRTUAL_NESTED_FORBIDDEN).toBe('virtual_nested_forbidden');
    expect(VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS).toBe('virtual_occupancy_exceeds_constituents');
    expect(ROOM_TYPE_KIND_IMMUTABLE).toBe('room_type_kind_immutable');
    expect(VIRTUAL_CONSTITUENTS_ON_PHYSICAL).toBe('virtual_constituents_on_physical');
    expect(CONSTITUENT_IN_USE).toBe('constituent_in_use');
    expect(VIRTUAL_TYPE_NO_ROOMS).toBe('virtual_type_no_rooms');
    expect(NOT_FOUND).toBe('not_found');
    expect(PROPERTY_ID_UNSET).toBe('property_id_unset');
    expect(NO_AVAILABILITY).toBe('no_availability');
    expect(UNBOOKABLE).toBe('unbookable');
    expect(ALREADY_CANCELLED).toBe('already_cancelled');
    expect(LEDGER_INCONSISTENT).toBe('ledger_inconsistent');
    expect(NOT_MODIFIABLE).toBe('not_modifiable');
    expect(RESTRICTION_VIOLATED).toBe('restriction_violated');
    expect(RATE_MISSING).toBe('rate_missing');
    expect(ROOM_CODE_EXISTS).toBe('room_code_exists');
    expect(ROOM_COUNT_EXCEEDED).toBe('room_count_exceeded');
    expect(ROOM_UNITS_EXCEED_COUNT).toBe('room_units_exceed_count');
    expect(ROOM_TYPE_MISMATCH).toBe('room_type_mismatch');
    expect(ROOM_ALREADY_ASSIGNED).toBe('room_already_assigned');
    expect(ROOM_NOT_ASSIGNABLE).toBe('room_not_assignable');
    expect(RATE_PLAN_NOT_FOUND).toBe('rate_plan_not_found');
    expect(RATE_PLAN_CODE_EXISTS).toBe('rate_plan_code_exists');
    expect(RATE_PLAN_ID_EXISTS).toBe('rate_plan_id_exists');
    expect(DEFAULT_RATE_PLAN_PROTECTED).toBe('default_rate_plan_protected');
    expect(DERIVED_RATE_PLAN_INVALID).toBe('derived_rate_plan_invalid');
    expect(DERIVED_RATE_PLAN_WRITE_FORBIDDEN).toBe('derived_rate_plan_write_forbidden');
    expect(PROMO_NOT_FOUND).toBe('promo_not_found');
    expect(PROMO_NOT_APPLICABLE).toBe('promo_not_applicable');
    expect(PROMO_CODE_EXISTS).toBe('promo_code_exists');
    expect(INVOICE_ALREADY_EXISTS).toBe('invoice_already_exists');
    expect(INVOICE_NOT_FOUND).toBe('invoice_not_found');
    expect(INVOICE_VOIDED).toBe('invoice_voided');
    expect(INVOICE_R2_UNBOUND).toBe('invoice_r2_unbound');
    expect(INVOICE_NUMBER_INVALID).toBe('invoice_number_invalid');
    expect(INVOICE_REQUIRED).toBe('invoice_required');
    expect(FOLIO_BALANCE_DUE).toBe('folio_balance_due');
    expect(CITY_LEDGER_ACCOUNT_NOT_FOUND).toBe('city_ledger_account_not_found');
    expect(CITY_LEDGER_ACCOUNT_EXISTS).toBe('city_ledger_account_exists');
    expect(CITY_LEDGER_ACCOUNT_ARCHIVED).toBe('city_ledger_account_archived');
    expect(CITY_LEDGER_CREDIT_LIMIT_EXCEEDED).toBe('city_ledger_credit_limit_exceeded');
    expect(CITY_LEDGER_BILLED_PARTY_INVALID).toBe('city_ledger_billed_party_invalid');
    expect(CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE).toBe('city_ledger_payment_exceeds_balance');
    expect(CITY_LEDGER_STATEMENT_NOT_FOUND).toBe('city_ledger_statement_not_found');
    expect(CITY_LEDGER_R2_UNBOUND).toBe('city_ledger_r2_unbound');
    expect(CITY_LEDGER_CHARGE_ALREADY_POSTED).toBe('city_ledger_charge_already_posted');
    expect(CHARGE_CODE_NOT_FOUND).toBe('charge_code_not_found');
    expect(CHARGE_CODE_EXISTS).toBe('charge_code_exists');
    expect(ROUTING_RULE_CONFLICT).toBe('routing_rule_conflict');
    expect(SYSTEM_CHARGE_CODE_PROTECTED).toBe('system_charge_code_protected');
  });

  it('exports guest wire codes', () => {
    expect(GUEST_EXISTS).toBe('guest_exists');
    expect(GUEST_NOT_FOUND).toBe('guest_not_found');
    expect(GUEST_ALREADY_ERASED).toBe('guest_already_erased');
    expect(GUEST_EMAIL_REQUIRED).toBe('guest_email_required');
    expect(GUEST_PHONE_REQUIRED).toBe('guest_phone_required');
    expect(GUEST_DUPLICATE).toBe('guest_duplicate');
  });

  it('exports payment wire codes', () => {
    expect(PSP_UNAVAILABLE).toBe('psp_unavailable');
    expect(PAYMENT_NOT_CAPTURABLE).toBe('payment_not_capturable');
    expect(DUPLICATE_UPI_REFERENCE).toBe('duplicate_upi_reference');
    expect(INVALID_UPI_REFERENCE).toBe('invalid_upi_reference');
    expect(LINE_NOT_SPLITTABLE).toBe('line_not_splittable');
  });

  it('exports tax rule wire codes', () => {
    expect(TAX_RULE_NOT_FOUND).toBe('tax_rule_not_found');
    expect(TAX_RULE_KEY_EXISTS).toBe('tax_rule_key_exists');
    expect(TAX_RULE_KEY_OVERLAP).toBe('tax_rule_key_overlap');
    expect(TAX_RULE_TYPE_UNSUPPORTED).toBe('tax_rule_type_unsupported');
    expect(TAX_OUTPUT_CODE_TAXABLE).toBe('tax_output_code_taxable');
    expect(TAX_INCLUSIVE_COMPOUND_UNSUPPORTED).toBe('tax_inclusive_compound_unsupported');
    expect(TAX_INCLUSIVE_SLAB_CONFLICT).toBe('tax_inclusive_slab_conflict');
  });

  it('night-audit PRE_CHECK wire codes', () => {
    expect(PENDING_CENSUS_REQUIRED).toBe('pending_census_required');
    expect(PENDING_COMMANDS_UNDRAINED).toBe('pending_commands_undrained');
    expect(PROVISIONAL_EXCEPTIONS_OPEN).toBe('provisional_exceptions_open');
    expect(NIGHT_AUDIT_CHECKS_FAILED).toBe('night_audit_checks_failed');
  });

  it('reservation lifecycle wire codes', () => {
    expect(HOLD_EXPIRED).toBe('hold_expired');
    expect(INQUIRY_EXPIRED).toBe('inquiry_expired');
    expect(ROOM_REQUIRED).toBe('room_required');
    expect(ROOM_NOT_READY).toBe('room_not_ready');
    expect(ROOM_MOVE_REASON_REQUIRED).toBe('room_move_reason_required');
    expect(ROOM_OUT_OF_ORDER).toBe('room_out_of_order');
    expect(BALANCE_DUE).toBe('balance_due');
    expect(PREPAYMENT_REQUIRED).toBe('prepayment_required');
    expect(OCCUPANCY_EXCEEDED).toBe('occupancy_exceeded');
  });

  it('front-office comment too long wire code', () => {
    expect(FRONT_OFFICE_COMMENT_TOO_LONG).toBe('front_office_comment_too_long');
  });

  it('room OOO wire codes', () => {
    expect(OOO_VIA_RANGE).toBe('ooo_via_range');
    expect(OOO_ROOM_ASSIGNED).toBe('ooo_room_assigned');
    expect(OOO_RANGE_OVERLAP).toBe('ooo_range_overlap');
    expect(OOO_INVALID_RANGE).toBe('ooo_invalid_range');
    expect(OOO_BEYOND_HORIZON).toBe('ooo_beyond_horizon');
  });

  it('folio money-ops wire codes', () => {
    expect(WINDOW_CLOSED).toBe('window_closed');
    expect(WINDOW_NOT_CLOSABLE).toBe('window_not_closable');
    expect(WINDOW_BALANCE_DUE).toBe('window_balance_due');
    expect(WINDOW_NOT_REOPENABLE).toBe('window_not_reopenable');
    expect(WINDOW_NOT_OPENABLE).toBe('window_not_openable');
    expect(GUEST_WINDOW_NOT_OPENABLE).toBe('guest_window_not_openable');
    expect(TRANSFER_CROSS_RESERVATION).toBe('transfer_cross_reservation');
    expect(TRANSFER_SAME_WINDOW).toBe('transfer_same_window');
    expect(LINE_NOT_TRANSFERABLE).toBe('line_not_transferable');
    expect(LINE_ALREADY_TRANSFERRED).toBe('line_already_transferred');
    expect(LINE_NOT_DISCOUNTABLE).toBe('line_not_discountable');
    expect(PAYMENT_NOT_VOIDABLE).toBe('payment_not_voidable');
    expect(PAYMENT_NOT_REFUNDABLE).toBe('payment_not_refundable');
    expect(DISCOUNT_REASON_REQUIRED).toBe('discount_reason_required');
    expect(FX_REASON_REQUIRED).toBe('fx_reason_required');
    expect(PAYMENT_NOT_CHARGEBACKABLE).toBe('payment_not_chargebackable');
  });

  it('exports payment refund wire codes', () => {
    expect(REFUND_EXCEEDS_REMAINING).toBe('refund_exceeds_remaining');
    expect(PAYMENT_NOT_CHARGEBACKABLE).toBe('payment_not_chargebackable');
  });

  it('exports FX rate money wire codes', async () => {
    const { FX_RATE_MISSING, FX_RATE_NOT_LEDGER, FX_RATE_OPEN_EXISTS } = await import('./money.js');
    expect(FX_RATE_MISSING).toBe('fx_rate_missing');
    expect(FX_RATE_NOT_LEDGER).toBe('fx_rate_not_ledger');
    expect(FX_RATE_OPEN_EXISTS).toBe('fx_rate_open_exists');
  });

  it('treats undefined object values as absent, matching JSON.stringify semantics', async () => {
    const a = await fingerprintPayload({ a: 1, b: undefined });
    const b = await fingerprintPayload({ a: 1 });
    expect(a).toBe(b);
  });

  it('exports D1 wire codes (Phase D smoke)', () => {
    expect(ORG_ID_UNSET).toBe('org_id_unset');
    expect(NOT_MEMBER).toBe('not_member');
    expect(NIGHT_AUDIT_HALTED).toBe('night_audit_halted');
    expect(CONFIG_CLASS_NOT_DOMAIN).toBe('config_class_not_domain');
    expect(INTERNAL_ERROR).toBe('internal_error');
  });

  it('pins idempotency export const count', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./idempotency.ts', import.meta.url), 'utf8');
    const count = (src.match(/^export const /gm) ?? []).length;
    expect(count).toBe(209);
  });
});

describe('commandFingerprint (N2)', () => {
  it('T12: cancel vs no-show same reservationId → different digests', async () => {
    const reservationId = 'res_alias_test';
    const cancel = await commandFingerprint('reservations.cancel', { reservationId });
    const noShow = await commandFingerprint('reservations.no_show', { reservationId });
    expect(cancel).not.toBe(noShow);
    expect(cancel).toMatch(/^[a-f0-9]{64}$/);
  });

  it('includes commandId — payload-only hash differs', async () => {
    const payload = { reservationId: 'res_x' };
    const withCommand = await commandFingerprint('reservations.cancel', payload);
    const payloadOnly = await fingerprintPayload(payload);
    expect(withCommand).not.toBe(payloadOnly);
  });
});
