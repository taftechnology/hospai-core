import { describe, expect, it } from 'vitest';
import { accumulatePage } from '../src/paging.js';

describe('opaque paging', () => {
  it('accumulates without client-side duplicates and passes cursor through', () => {
    const page1 = {
      items: [
        { id: '1', reservationId: '1' },
        { id: '2', reservationId: '2' },
      ],
      nextCursor: 'opaque-page-2',
    };
    const acc1 = accumulatePage([], page1, (t) => t.id);
    expect(acc1.nextCursor).toBe('opaque-page-2');
    expect(acc1.items).toHaveLength(2);

    const page2 = {
      items: [
        { id: '2', reservationId: '2' },
        { id: '3', reservationId: '3' },
      ],
      nextCursor: null,
    };
    const acc2 = accumulatePage(acc1.items, page2, (t) => t.id);
    expect(acc2.items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(acc2.nextCursor).toBeNull();
  });
});
