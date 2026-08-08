import { describe, expect, it } from 'vitest';
import { guestSeverity } from './guest-severity.js';

describe('guestSeverity', () => {
  it('maps every GuestRowState kind', () => {
    expect(guestSeverity({ kind: 'resolved', displayName: 'Ann' })).toBe('neutral');
    expect(guestSeverity({ kind: 'name_pending' })).toBe('neutral');
    expect(guestSeverity({ kind: 'erased' })).toBe('informational');
    expect(guestSeverity({ kind: 'not_found' })).toBe('exception');
    expect(guestSeverity({ kind: 'decrypt_unresolved' })).toBe('exception');
  });
});
