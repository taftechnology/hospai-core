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
  UNBOOKABLE,
  ALREADY_CANCELLED,
  LEDGER_INCONSISTENT,
  NOT_MODIFIABLE,
  RESTRICTION_VIOLATED,
  RATE_MISSING,
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
  });

  it('treats undefined object values as absent, matching JSON.stringify semantics', async () => {
    const a = await fingerprintPayload({ a: 1, b: undefined });
    const b = await fingerprintPayload({ a: 1 });
    expect(a).toBe(b);
  });
});
