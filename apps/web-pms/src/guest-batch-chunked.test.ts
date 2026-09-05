import { describe, expect, it } from 'vitest';
import { chunkGuestRefs, GUEST_BATCH_MAX } from './guest-batch-chunked.js';

describe('guest-batch-chunked', () => {
  it('GUEST_BATCH_MAX is 50', () => {
    expect(GUEST_BATCH_MAX).toBe(50);
  });

  it('chunkGuestRefs splits 51 into [50, 1]', () => {
    const refs = Array.from({ length: 51 }, (_, i) => `g_${i}`);
    expect(chunkGuestRefs(refs)).toEqual([refs.slice(0, 50), refs.slice(50, 51)]);
  });

  it('chunkGuestRefs dedupes preserving first occurrence order', () => {
    expect(chunkGuestRefs(['a', 'b', 'a', 'c'])).toEqual([['a', 'b', 'c']]);
  });

  it('chunkGuestRefs empty → []', () => {
    expect(chunkGuestRefs([])).toEqual([]);
  });
});
