import { describe, expect, it } from 'vitest';
import { composeGuestStates } from '../src/compose.js';

describe('composeGuestStates', () => {
  it('maps erased and decrypt_unresolved distinctly', () => {
    const states = composeGuestStates(['a', 'b', 'c'], {
      ok: true,
      guests: {
        a: { ok: true, guestId: 'a', erased: false, profile: { displayName: 'Ann' } },
        b: { ok: true, guestId: 'b', erased: true, profile: null },
        c: { ok: false, guestId: 'c', error: 'decrypt_unresolved' },
      },
    });
    expect(states.a).toEqual({ kind: 'resolved', displayName: 'Ann' });
    expect(states.b).toEqual({ kind: 'erased' });
    expect(states.c).toEqual({ kind: 'decrypt_unresolved' });
  });

  it('wholesale failure yields name_pending for all refs', () => {
    const states = composeGuestStates(['a', 'b'], { ok: false, wholesaleFailure: true });
    expect(states).toEqual({
      a: { kind: 'name_pending' },
      b: { kind: 'name_pending' },
    });
  });
});
