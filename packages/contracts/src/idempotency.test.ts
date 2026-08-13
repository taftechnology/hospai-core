import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
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
  CHARGE_CODE_NOT_FOUND,
  CHARGE_CODE_EXISTS,
  SYSTEM_CHARGE_CODE_PROTECTED,
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
  GUEST_ALREADY_ERASED,
  PSP_UNAVAILABLE,
  PAYMENT_NOT_CAPTURABLE,
  LINE_NOT_SPLITTABLE,
  TAX_RULE_NOT_FOUND,
  TAX_RULE_KEY_EXISTS,
  TAX_RULE_KEY_OVERLAP,
  TAX_RULE_TYPE_UNSUPPORTED,
  TAX_OUTPUT_CODE_TAXABLE,
  PENDING_CENSUS_REQUIRED,
  PENDING_COMMANDS_UNDRAINED,
  PROVISIONAL_EXCEPTIONS_OPEN,
  HOLD_EXPIRED,
  INQUIRY_EXPIRED,
  ROOM_REQUIRED,
  ROOM_NOT_READY,
  ROOM_OUT_OF_ORDER,
  BALANCE_DUE,
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
  LINE_NOT_DISCOUNTABLE,
  PAYMENT_NOT_VOIDABLE,
  PAYMENT_NOT_REFUNDABLE,
  DISCOUNT_REASON_REQUIRED,
  OOO_VIA_RANGE,
  OOO_ROOM_ASSIGNED,
  OOO_RANGE_OVERLAP,
  OOO_INVALID_RANGE,
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
    expect(CHARGE_CODE_NOT_FOUND).toBe('charge_code_not_found');
    expect(CHARGE_CODE_EXISTS).toBe('charge_code_exists');
    expect(SYSTEM_CHARGE_CODE_PROTECTED).toBe('system_charge_code_protected');
  });

  it('exports guest wire codes', () => {
    expect(GUEST_EXISTS).toBe('guest_exists');
    expect(GUEST_NOT_FOUND).toBe('guest_not_found');
    expect(GUEST_ALREADY_ERASED).toBe('guest_already_erased');
  });

  it('exports payment wire codes', () => {
    expect(PSP_UNAVAILABLE).toBe('psp_unavailable');
    expect(PAYMENT_NOT_CAPTURABLE).toBe('payment_not_capturable');
    expect(LINE_NOT_SPLITTABLE).toBe('line_not_splittable');
  });

  it('exports tax rule wire codes', () => {
    expect(TAX_RULE_NOT_FOUND).toBe('tax_rule_not_found');
    expect(TAX_RULE_KEY_EXISTS).toBe('tax_rule_key_exists');
    expect(TAX_RULE_KEY_OVERLAP).toBe('tax_rule_key_overlap');
    expect(TAX_RULE_TYPE_UNSUPPORTED).toBe('tax_rule_type_unsupported');
    expect(TAX_OUTPUT_CODE_TAXABLE).toBe('tax_output_code_taxable');
  });

  it('night-audit PRE_CHECK wire codes', () => {
    expect(PENDING_CENSUS_REQUIRED).toBe('pending_census_required');
    expect(PENDING_COMMANDS_UNDRAINED).toBe('pending_commands_undrained');
    expect(PROVISIONAL_EXCEPTIONS_OPEN).toBe('provisional_exceptions_open');
  });

  it('reservation lifecycle wire codes', () => {
    expect(HOLD_EXPIRED).toBe('hold_expired');
    expect(INQUIRY_EXPIRED).toBe('inquiry_expired');
    expect(ROOM_REQUIRED).toBe('room_required');
    expect(ROOM_NOT_READY).toBe('room_not_ready');
    expect(ROOM_OUT_OF_ORDER).toBe('room_out_of_order');
    expect(BALANCE_DUE).toBe('balance_due');
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
    expect(LINE_NOT_DISCOUNTABLE).toBe('line_not_discountable');
    expect(PAYMENT_NOT_VOIDABLE).toBe('payment_not_voidable');
    expect(PAYMENT_NOT_REFUNDABLE).toBe('payment_not_refundable');
    expect(DISCOUNT_REASON_REQUIRED).toBe('discount_reason_required');
  });

  it('treats undefined object values as absent, matching JSON.stringify semantics', async () => {
    const a = await fingerprintPayload({ a: 1, b: undefined });
    const b = await fingerprintPayload({ a: 1 });
    expect(a).toBe(b);
  });
});
