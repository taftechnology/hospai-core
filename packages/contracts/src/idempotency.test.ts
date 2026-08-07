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
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
  GUEST_ALREADY_ERASED,
  PSP_UNAVAILABLE,
  PAYMENT_NOT_CAPTURABLE,
  LINE_NOT_SPLITTABLE,
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

  it('treats undefined object values as absent, matching JSON.stringify semantics', async () => {
    const a = await fingerprintPayload({ a: 1, b: undefined });
    const b = await fingerprintPayload({ a: 1 });
    expect(a).toBe(b);
  });
});
