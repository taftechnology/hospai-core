import { describe, expect, it } from 'vitest';
import { bookHref } from './book-href.js';

describe('bookHref', () => {
  it('builds /book with arrival, departure and room type', () => {
    expect(bookHref({ arrival: '2026-10-28', departure: '2026-10-29', roomTypeId: 'rt_king' })).toBe(
      '/book?arrival=2026-10-28&departure=2026-10-29&roomTypeId=rt_king',
    );
  });

  it('omits the room type when none is given', () => {
    expect(bookHref({ arrival: '2026-10-28', departure: '2026-10-29' })).toBe(
      '/book?arrival=2026-10-28&departure=2026-10-29',
    );
  });
});
